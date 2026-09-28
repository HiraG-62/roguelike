// ブラウザから Spriteloom（ローカルの画像生成サーバー）へ WebSocket でつなぐ。
// Node 版は scripts/sprite/spriteloom.mjs。ブラウザは %APPDATA% の設定を読めないのでポートは画面から受け取る
import { parseServerMessage, type RgbaImage, type ServerMessage, type SpriteloomRequest } from "./spriteGenCore";

/** この PC の Spriteloom のポート（8765 は別のツールが使う。docs/recipes/sprite.md） */
export const DEFAULT_SPRITELOOM_PORT = 8766;
/** モデルの読み込み待ちで ping を打つ間隔（ms） */
const PING_INTERVAL_MS = 2000;
const PING_TIMEOUT_MS = PING_INTERVAL_MS * 5;
/** 読み込み待ちの上限（ms）。温まった状態で約 25 秒、冷えていると数分かかる */
const LOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** 1 回の生成の上限（ms） */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MODEL_READY = "ready";

export type Log = (msg: string) => void;

function url(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

/** 1 本の接続で 1 往復する。onMessage が値を返したら終わる */
function exchange<T>(port: number, payload: object, onMessage: (m: ServerMessage) => T | undefined, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(port));
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`Spriteloom の応答が ${timeoutMs / 1000} 秒で返らない`))), timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify(payload)));
    ws.addEventListener("error", () =>
      finish(() => reject(new Error(`Spriteloom（${url(port)}）に繋がらない。Spriteloom の start-server.bat を起動する（docs/recipes/sprite.md）`))),
    );
    ws.addEventListener("message", (ev) => {
      const msg = parseServerMessage(String(ev.data));
      if (!msg) return;
      if (msg.type === "error") {
        finish(() => reject(new Error(`Spriteloom: ${msg.message}`)));
        return;
      }
      const done = onMessage(msg);
      if (done !== undefined) finish(() => resolve(done));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** モデルが GPU に載るまで待つ */
export async function waitReady(port: number, log: Log): Promise<void> {
  const start = Date.now();
  for (;;) {
    const pong = await exchange(port, { type: "ping" }, (m) => (m.type === "pong" ? m : undefined), PING_TIMEOUT_MS);
    if (pong.model === MODEL_READY) return;
    if (Date.now() - start > LOAD_TIMEOUT_MS) throw new Error("Spriteloom のモデルの読み込みが終わらない");
    log(`モデル読み込み中… ${Math.round(pong.progress * 100)}%${pong.stage ? `（${pong.stage}）` : ""}`);
    await sleep(PING_INTERVAL_MS);
  }
}

/** 生成 / 指示で編集を頼む */
export async function requestSprites(port: number, req: SpriteloomRequest, log: Log): Promise<{ images: RgbaImage[]; seeds: number[] }> {
  await waitReady(port, log);
  return exchange(
    port,
    req,
    (m) => {
      if (m.type === "progress") {
        log(m.stage || `${Math.round(m.value * 100)}%`);
        return undefined;
      }
      return m.type === "result" ? { images: m.images, seeds: m.seeds } : undefined;
    },
    REQUEST_TIMEOUT_MS,
  );
}
