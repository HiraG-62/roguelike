/**
 * 型検査 → テスト → ビルドを順に実行する（`npm run check`）。
 * どれかが失敗した時点で非 0 で終了する。Windows でも動くよう、シェルを介さず
 * node で各ツールのエントリを直接起動する（npx / cross-env に依存しない）。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (rel) => path.join(ROOT, "node_modules", rel);

const STEPS = [
  { label: "tsc", entry: bin("typescript/bin/tsc"), args: ["--noEmit"] },
  { label: "tsc (electron)", entry: bin("typescript/bin/tsc"), args: ["-p", "tsconfig.electron.json", "--noEmit"] },
  { label: "vitest", entry: bin("vitest/vitest.mjs"), args: ["run"] },
  { label: "vite build", entry: bin("vite/bin/vite.js"), args: ["build"] },
];

for (const step of STEPS) {
  console.log(`\n=== ${step.label} ===`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [step.entry, ...step.args], { cwd: ROOT, stdio: "inherit" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error) {
    console.error(`[check] ${step.label} を起動できなかった: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n[check] ${step.label} が失敗した（exit ${result.status}, ${seconds}s）`);
    process.exit(result.status ?? 1);
  }
  console.log(`[check] ${step.label} OK（${seconds}s）`);
}
console.log("\n[check] すべて成功");
