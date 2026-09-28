// Spriteloom（ローカルの画像生成サーバー、https://github.com/vkarach/spriteloom）の WebSocket クライアント。
// Aseprite の拡張と同じ JSON をしゃべる。サーバーは Spriteloom.exe の START か start-server.bat で先に立ち上げておく
import { readFileSync } from "node:fs";
import { join } from "node:path";

export { VIEW_TEMPLATES, assemblePrompt } from "./prompt.mjs";

/** Spriteloom の既定のポート。設定ファイル（%APPDATA%/Spriteloom/config.json）の port があればそちら */
const DEFAULT_PORT = 8765;
/** モデルの読み込み待ちで ping を打つ間隔（ms） */
const PING_INTERVAL_MS = 2000;
/** 読み込み待ちの上限（ms）。温まった状態で約 25 秒、冷えていると数分かかる */
const LOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** 1 回の生成の上限（ms） */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

function configuredPort() {
  const appData = process.env.APPDATA;
  if (!appData) return DEFAULT_PORT;
  try {
    const port = JSON.parse(readFileSync(join(appData, "Spriteloom", "config.json"), "utf8")).port;
    return Number.isInteger(port) ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

function url(port) {
  return `ws://127.0.0.1:${port ?? configuredPort()}`;
}

/** 1 本の接続で 1 往復（ping や生成）する。onMessage が値を返したら終わる */
function exchange(port, payload, onMessage, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url(port));
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Spriteloom の応答が ${timeoutMs / 1000} 秒で返らない`));
    }, timeoutMs);
    const finish = (fn) => {
      clearTimeout(timer);
      ws.close();
      fn();
    };
    ws.addEventListener("open", () => ws.send(JSON.stringify(payload)));
    ws.addEventListener("error", () => finish(() => reject(new Error(`Spriteloom のサーバー（${url(port)}）に繋がらない。Spriteloom.exe で START するか start-server.bat を起動する`))));
    ws.addEventListener("message", (ev) => {
      let data;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (data.type === "error") {
        finish(() => reject(new Error(`Spriteloom: ${data.message}`)));
        return;
      }
      const done = onMessage(data);
      if (done !== undefined) finish(() => resolvePromise(done));
    });
  });
}

/** モデルが GPU に載るまで待つ */
export async function waitReady(port, log = console.error) {
  const start = Date.now();
  for (;;) {
    const pong = await exchange(port, { type: "ping" }, (d) => (d.type === "pong" ? d : undefined), PING_INTERVAL_MS * 5);
    if (pong.model === "ready") return;
    if (Date.now() - start > LOAD_TIMEOUT_MS) throw new Error("Spriteloom のモデルの読み込みが終わらない");
    log(`モデル読み込み中… ${Math.round((pong.progress ?? 0) * 100)}%${pong.stage ? `（${pong.stage}）` : ""}`);
    await new Promise((r) => setTimeout(r, PING_INTERVAL_MS));
  }
}

/**
 * 生成 / 指示で編集を頼む。
 * req: { mode: "generate" | "edit", prompt, width, height, variants, seed?, background, palette?: [r,g,b][], imagePngB64? }
 * 戻り値: { images: { width, height, rgba }[], seeds: number[] }
 */
export async function requestSprites(port, req, log = console.error) {
  await waitReady(port, log);
  const payload = {
    id: `cli-${process.pid}`,
    mode: req.mode,
    prompt: req.prompt,
    target_size: [req.width, req.height],
    variants: req.variants,
    background: req.background,
    ...(req.seed === undefined ? {} : { seed: req.seed }),
    ...(req.palette ? { palette: req.palette } : {}),
    ...(req.imagePngB64 ? { frames: [{ image: req.imagePngB64 }] } : {}),
  };
  let lastPct = -1;
  const result = await exchange(
    port,
    payload,
    (d) => {
      if (d.type === "progress") {
        const pct = Math.round((d.value ?? 0) * 100);
        if (d.stage) log(d.stage);
        else if (pct !== lastPct && pct % 10 === 0) log(`${pct}%`);
        lastPct = pct;
        return undefined;
      }
      return d.type === "result" ? d : undefined;
    },
    REQUEST_TIMEOUT_MS,
  );
  const images = result.images.map((im) => ({ width: im.w, height: im.h, rgba: new Uint8Array(Buffer.from(im.px, "base64")) }));
  return { images, seeds: result.seeds ?? [] };
}
