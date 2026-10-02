/**
 * 型検査 → テスト → ビルドを順に実行する（`npm run check`）。
 * どれかが失敗した時点で非 0 で終了する。`--fast`（`npm run check:fast`）は並列レーンの途中確認用で、
 * 重い QA シミュレーション（src/qa/simulation.test.ts）・Electron の型検査・ビルドを省く。コミット前は必ず全段を回す。Windows でも動くよう、シェルを介さず
 * node で各ツールのエントリを直接起動する（npx / cross-env に依存しない）。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (rel) => path.join(ROOT, "node_modules", rel);

const FAST = process.argv.includes("--fast");

const ALL_STEPS = [
  // エージェント資料（CLAUDE.md / .claude / AI_WORKFLOW）がコードとずれていないか。速いので最初に回す
  { label: "audit docs", entry: path.join(ROOT, "scripts", "audit-agent-docs.mjs"), args: [] },
  { label: "tsc", entry: bin("typescript/bin/tsc"), args: ["--noEmit"] },
  { label: "tsc (electron)", entry: bin("typescript/bin/tsc"), args: ["-p", "tsconfig.electron.json", "--noEmit"], full: true },
  // --fast の vitest は重い QA シミュレーションを省く（vitest.config.ts が VITEST_FAST を読む）
  { label: "vitest", entry: bin("vitest/vitest.mjs"), args: ["run"], env: FAST ? { VITEST_FAST: "1" } : {} },
  { label: "vite build", entry: bin("vite/bin/vite.js"), args: ["build"], full: true },
];
const STEPS = ALL_STEPS.filter((step) => !(FAST && step.full));

for (const step of STEPS) {
  console.log(`\n=== ${step.label} ===`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [step.entry, ...step.args], { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...step.env } });
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
console.log(FAST ? "\n[check] 速い検査は成功（コミット前は npm run check を回す）" : "\n[check] すべて成功");
