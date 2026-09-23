/**
 * フル QA（`npm run qa:full`）。SIM_FULL=1 を付けて src/qa のシミュレーションを実行し、
 * 標準出力のマーカー間（<<<QA_REPORT_START>>> 〜 <<<QA_REPORT_END>>>）を src/qa/report.md に書き出す。
 * simulation.test.ts は @types/node が無く fs に触れないため、書き出しはこのスクリプトの責務。
 *
 * 使い方:
 *   npm run qa:full              # 実行して report.md を上書き
 *   npm run qa:full -- --no-write  # 実行だけ（report.md を変えない）
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const REPORT_PATH = path.join(ROOT, "src", "qa", "report.md");
const REPORT_START = "<<<QA_REPORT_START>>>";
const REPORT_END = "<<<QA_REPORT_END>>>";
const noWrite = process.argv.includes("--no-write");

// AI エージェント配下では vitest が agent reporter を選び、成功したテストの console 出力を隠すため明示する
const VITEST_ARGS = ["run", "src/qa", "--reporter=default", "--silent=false"];
const child = spawn(process.execPath, [VITEST, ...VITEST_ARGS], {
  cwd: ROOT,
  env: { ...process.env, SIM_FULL: "1" },
  stdio: ["inherit", "pipe", "inherit"],
});

let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  process.stdout.write(chunk);
});

child.on("error", (err) => {
  console.error(`[qa:full] vitest を起動できなかった: ${err.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  const start = stdout.indexOf(REPORT_START);
  const end = stdout.indexOf(REPORT_END, start + 1);
  if (start < 0 || end < 0) {
    console.error("[qa:full] レポートのマーカーが出力に見つからない。report.md は更新しない");
    process.exit(code === 0 ? 1 : (code ?? 1));
  }
  const report = stdout.slice(start + REPORT_START.length, end).trim().replace(/\r\n/g, "\n") + "\n";
  if (noWrite) {
    console.log("[qa:full] --no-write のため report.md は更新しない");
  } else {
    writeFileSync(REPORT_PATH, report, "utf8");
    console.log(`[qa:full] ${path.relative(ROOT, REPORT_PATH)} を更新した`);
  }
  process.exit(code ?? 1);
});
