/**
 * 開発用ページを Chromium で開くスクリプト（map-shot.mjs / hitch-probe.mjs）の共通部品。
 * playwright の探し方と、vite の起こし方（すでに起きていれば使い回す）。
 */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_TIMEOUT_MS = 60_000;
const POLL_MS = 300;
/** クラウドの環境で Chromium を置いている場所（ローカルでは使わない） */
const CLOUD_BROWSERS_PATH = "/opt/pw-browsers";

/** playwright を PLAYWRIGHT_MODULE（パス）→ リポジトリの node_modules → `npm root -g` の順で探す */
export function findPlaywright() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(CLOUD_BROWSERS_PATH)) process.env.PLAYWRIGHT_BROWSERS_PATH = CLOUD_BROWSERS_PATH;
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push(path.join(ROOT, "node_modules", "playwright"));
  try {
    candidates.push(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {
    // npm が無ければ次の候補へ
  }
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`playwright が見つからない。探した場所: ${candidates.join(", ")}`);
  return createRequire(path.join(found, "package.json"))(found);
}

async function responds(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

/**
 * url を返す vite を用意する。すでに起きていればそれを使い（止めない）、無ければ子で起こす。
 * 戻り値の stop() で、自分で起こした vite だけ止める
 */
export async function ensureVite(port, url) {
  if (await responds(url)) return { stop: () => {} };
  const entry = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [entry, "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  const started = Date.now();
  while (Date.now() - started < SERVER_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`vite が終了した（exit ${child.exitCode}）`);
    if (await responds(url)) return { stop: () => child.kill() };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  child.kill();
  throw new Error("vite が時間内に起動しなかった");
}
