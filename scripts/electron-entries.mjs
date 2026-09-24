/** electron:dev / electron:build 共通: dist-electron/ を作り直し、main（ESM）と preload（CJS）を束ねる */
import fs from "node:fs";
import path from "node:path";
import { build } from "vite";

const CONFIGS = ["electron/vite.main.config.ts", "electron/vite.preload.config.ts"];

export async function buildElectronEntries(root) {
  // 2 つのビルドは出力先を共有して emptyOutDir: false にしているので、古い出力はここで消す
  fs.rmSync(path.join(root, "dist-electron"), { recursive: true, force: true });
  for (const config of CONFIGS) await build({ configFile: path.join(root, config), logLevel: "warn" });
}
