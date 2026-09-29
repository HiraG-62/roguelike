/**
 * 戦闘の基準値の計測（`npm run qa:probe`）。SIM_PROBE=1 を付けて src/qa/combatProbe.test.ts の重い版を実行し、
 * 標準出力のマーカー間（<<<QA_PROBE_START>>> 〜 <<<QA_PROBE_END>>>）を src/qa/probe.md に書き出す。
 * combatProbe.test.ts は @types/node が無く fs に触れないため、書き出しはこのスクリプトの責務
 * （scripts/qa-full.mjs と同じ方式）。
 *
 * 使い方:
 *   npm run qa:probe              # 実行して probe.md を上書き
 *   npm run qa:probe -- --no-write  # 実行だけ（probe.md を変えない）
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const PROBE_PATH = path.join(ROOT, "src", "qa", "probe.md");
const PROBE_START = "<<<QA_PROBE_START>>>";
const PROBE_END = "<<<QA_PROBE_END>>>";
const noWrite = process.argv.includes("--no-write");

// AI エージェント配下では vitest が agent reporter を選び、成功したテストの console 出力を隠すため明示する
const VITEST_ARGS = ["run", "src/qa/combatProbe.test.ts", "--reporter=default", "--silent=false"];
const child = spawn(process.execPath, [VITEST, ...VITEST_ARGS], {
  cwd: ROOT,
  env: { ...process.env, SIM_PROBE: "1" },
  stdio: ["inherit", "pipe", "inherit"],
});

let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  process.stdout.write(chunk);
});

child.on("error", (err) => {
  console.error(`[qa:probe] vitest を起動できなかった: ${err.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  const start = stdout.indexOf(PROBE_START);
  const end = stdout.indexOf(PROBE_END, start + 1);
  if (start < 0 || end < 0) {
    console.error("[qa:probe] 表のマーカーが出力に見つからない。probe.md は更新しない");
    process.exit(code === 0 ? 1 : (code ?? 1));
  }
  const report = stdout.slice(start + PROBE_START.length, end).trim().replace(/\r\n/g, "\n") + "\n";
  if (noWrite) {
    console.log("[qa:probe] --no-write のため probe.md は更新しない");
  } else {
    writeFileSync(PROBE_PATH, report, "utf8");
    console.log(`[qa:probe] ${path.relative(ROOT, PROBE_PATH)} を更新した`);
  }
  process.exit(code ?? 1);
});
