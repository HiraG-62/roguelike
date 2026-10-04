/**
 * バランスの数値を少し動かしてテストを回し、落ちたテストをファイルごとに数える（`pnpm run test:perturb`）。
 * 数値の調整で落ちてよいのは「制約のテスト」だけ。数値の写し・指紋・数値を暗黙の前提にしたテストを見つけるための検査（docs/TESTING.md）。
 * JSON は書き換えない（vitest.config.ts が BALANCE_PERTURB を読み、読み込み時に小数を倍率で動かす）。重い QA シミュレーションは省く。
 *
 * 使い方: node scripts/test-perturb.mjs [--mul 1.1] [テストのファイルやパターン…]
 *   --mul: 小数に掛ける倍率（既定 1.1。下げる向きも見るなら 0.9）
 *   ファイルを渡すとそれだけ回す（並列レーンの担当分の確認）
 * 落ちたテストがあれば非 0 で終わる。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const DEFAULT_MUL = "1.1";
/** 1 ファイルあたり表示する落ちたテストの名前の数 */
const NAMES_PER_FILE = 3;

const argv = process.argv.slice(2);
const mulIndex = argv.indexOf("--mul");
const mul = mulIndex >= 0 ? argv[mulIndex + 1] ?? DEFAULT_MUL : DEFAULT_MUL;
const mulValueIndex = mulIndex >= 0 ? mulIndex + 1 : -1;
const filters = argv.filter((arg, i) => !arg.startsWith("--") && i !== mulValueIndex);

const outFile = path.join(mkdtempSync(path.join(tmpdir(), "perturb-")), "result.json");
const result = spawnSync(process.execPath, [VITEST, "run", "--reporter=json", `--outputFile=${outFile}`, ...filters], {
  cwd: ROOT,
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, BALANCE_PERTURB: mul, VITEST_FAST: "1" },
});
if (result.error) {
  console.error(`[perturb] vitest を起動できなかった: ${result.error.message}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(outFile, "utf8"));
const failedByFile = [];
for (const file of report.testResults) {
  const failed = file.assertionResults.filter((t) => t.status === "failed");
  // 読み込みで落ちたファイルは assertionResults が空のまま status が failed になる
  if (failed.length === 0 && file.status !== "failed") continue;
  const rel = path.relative(ROOT, file.name).replaceAll("\\", "/");
  failedByFile.push({ rel, failed, message: failed.length === 0 ? file.message : "" });
}
failedByFile.sort((a, b) => b.failed.length - a.failed.length);

console.log(`倍率 ×${mul}: ${report.numFailedTests} 件 / ${failedByFile.length} ファイルが落ちた（全 ${report.numTotalTests} 件）`);
for (const { rel, failed, message } of failedByFile) {
  console.log(`  ${String(failed.length).padStart(4)}  ${rel}`);
  if (message) console.log(`        読み込みで失敗: ${message.split("\n")[0]}`);
  for (const t of failed.slice(0, NAMES_PER_FILE)) console.log(`        - ${t.fullName}`);
}
process.exit(failedByFile.length > 0 ? 1 : 0);
