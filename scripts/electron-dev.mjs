/**
 * `npm run electron:dev`: main / preload を束ね、Vite の dev サーバを起動してから Electron を開く。
 * renderer は dev サーバから読むので HMR がそのまま効く。Electron を閉じたら dev サーバも止める
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import electronPath from "electron";
import { buildElectronEntries } from "./electron-entries.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await buildElectronEntries(ROOT);

const server = await createServer({ root: ROOT });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) {
  console.error("[electron:dev] dev サーバの URL を得られなかった");
  await server.close();
  process.exit(1);
}
console.log(`[electron:dev] ${url}`);

const child = spawn(String(electronPath), [ROOT], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
