/**
 * `npm run electron:build`: Web 版の dist/ と main / preload を作り、electron-builder で
 * release/win-unpacked/（Steam にそのまま上げられる展開済みフォルダ）を作る
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { buildElectronEntries } from "./electron-entries.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({ root: ROOT });
await buildElectronEntries(ROOT);

const cli = path.join(ROOT, "node_modules", "electron-builder", "cli.js");
const result = spawnSync(process.execPath, [cli, "--win", "--dir", "--config", "electron-builder.yml"], { cwd: ROOT, stdio: "inherit" });
if (result.error) {
  console.error(`[electron:build] electron-builder を起動できなかった: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
