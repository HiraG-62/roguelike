/**
 * 装備パターンの行列（`pnpm run qa:gear`）。src/qa/gearMatrix.ts のパターンを seed の列で bot に遊ばせ、
 * 標準との差を src/qa/gear.md（表）と src/qa/gear.json（集計。次の回の「前回比」の元）に書き出す。
 * ランは vitest のプロセスを並べて分け合う（SIM_GEAR=run）。集計は最後に 1 プロセスで行う（SIM_GEAR=report）。
 * 全ランの記録は src/qa/gear.runs.json（.gitignore）に残し、--only で測り直したパターンだけ差し替える。
 *
 * 使い方:
 *   pnpm run qa:gear                       # 全パターン × 20 seed（並列。約 30〜60 分）
 *   ppnpm run qa:gear --only weapon,job  # 軸（standard / carry / slots / quality / weapon / job）か key（weapon.spear）で絞る。標準は常に測る
 *   ppnpm run qa:gear --seeds 10 --steps 90000 --jobs 8
 *   ppnpm run qa:gear --no-write         # 書き出さない（gear.runs.json も変えない）
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const TEST_FILE = "src/qa/gearMatrix.test.ts";
const QA_DIR = path.join(ROOT, "src", "qa");
const REPORT_PATH = path.join(QA_DIR, "gear.md");
const SUMMARY_PATH = path.join(QA_DIR, "gear.json");
const RUNS_PATH = path.join(QA_DIR, "gear.runs.json");
/** 集計に渡す今回の全ランと前回の集計（書き出さないときも集計はするので一時ファイルに置く） */
const TMP_RUNS_PATH = path.join(os.tmpdir(), `qa-gear-runs-${process.pid}.json`);
const TMP_PREV_PATH = path.join(os.tmpdir(), `qa-gear-prev-${process.pid}.json`);
/** シャードごとの記録（1 行 1 ラン）。途中で止まっても残るよう一時フォルダに置き、場所を最初に出す */
const shardOutPath = (shard) => path.join(os.tmpdir(), `qa-gear-shard-${process.pid}-${shard}.jsonl`);
/** 進み具合を出す間隔 */
const PROGRESS_MS = 60_000;
const REPORT_START = "<<<GEAR_REPORT_START>>>";
const REPORT_END = "<<<GEAR_REPORT_END>>>";
const SUMMARY_START = "<<<GEAR_SUMMARY_START>>>";
const SUMMARY_END = "<<<GEAR_SUMMARY_END>>>";
const DEFAULT_SEEDS = 20;
const DEFAULT_STEPS = 180_000;
/** 並べるプロセスの数の既定（CPU の数から、操作が固まらない程度に 2 つ残す） */
const RESERVED_CPUS = 2;
// AI エージェント配下では vitest が agent reporter を選び、成功したテストの console 出力を隠すため明示する
const VITEST_ARGS = ["run", TEST_FILE, "--reporter=default", "--silent=false"];

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function argInt(name, fallback) {
  const v = Number(argValue(name));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

const noWrite = process.argv.includes("--no-write");
const only = argValue("--only");
const seeds = argInt("--seeds", DEFAULT_SEEDS);
const steps = argInt("--steps", DEFAULT_STEPS);
const jobs = argInt("--jobs", Math.max(1, os.availableParallelism() - RESERVED_CPUS));

/** vitest を 1 本走らせ、標準出力を行ごとに onLine へ渡す。終了コードを返す */
function runVitest(env, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [VITEST, ...VITEST_ARGS], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let rest = "";
    child.stdout.on("data", (chunk) => {
      const text = rest + chunk.toString();
      const lines = text.split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (rest !== "") onLine(rest);
      resolve(code ?? 1);
    });
  });
}

function readShard(shard) {
  const file = shardOutPath(shard);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

async function runShards() {
  let failed = 0;
  const started = Date.now();
  const shardIds = Array.from({ length: jobs }, (_, shard) => shard);
  console.log(`[qa:gear] シャードの記録: ${shardOutPath("*")}`);
  const timer = setInterval(() => {
    const done = shardIds.reduce((n, s) => n + readShard(s).length, 0);
    console.log(`[qa:gear] ${done} ラン済み（${((Date.now() - started) / 60_000).toFixed(1)} 分）`);
  }, PROGRESS_MS);
  const shards = shardIds.map((shard) =>
    runVitest(
      { SIM_GEAR: "run", GEAR_SHARD: String(shard), GEAR_SHARDS: String(jobs), GEAR_SEEDS: String(seeds), GEAR_STEPS: String(steps), GEAR_ONLY: only ?? "", GEAR_OUT: shardOutPath(shard) },
      () => {},
    ).then((code) => {
      if (code !== 0) failed++;
    }),
  );
  await Promise.all(shards);
  clearInterval(timer);
  return { records: shardIds.flatMap(readShard), failed };
}

/** 前回の全ランから、今回測ったパターンの記録を除いて今回の分を足す */
function mergeRecords(fresh) {
  if (!existsSync(RUNS_PATH)) return fresh;
  const measured = new Set(fresh.map((r) => r.pattern));
  const old = JSON.parse(readFileSync(RUNS_PATH, "utf8")).records ?? [];
  const kept = old.filter((r) => !measured.has(r.pattern));
  if (kept.length > 0) console.log(`[qa:gear] 前回の記録から ${new Set(kept.map((r) => r.pattern)).size} パターン（${kept.length} ラン）を引き継ぐ`);
  return [...kept, ...fresh];
}

function between(text, start, end) {
  const s = text.indexOf(start);
  const e = text.indexOf(end, s + 1);
  if (s < 0 || e < 0) return null;
  return text.slice(s + start.length, e).trim().replace(/\r\n/g, "\n");
}

async function aggregate(records) {
  const runs = { meta: { seeds, maxSteps: steps }, records };
  writeFileSync(TMP_RUNS_PATH, JSON.stringify(runs), "utf8");
  if (existsSync(SUMMARY_PATH)) copyFileSync(SUMMARY_PATH, TMP_PREV_PATH);
  let out = "";
  const code = await runVitest({ SIM_GEAR: "report", GEAR_RUNS: TMP_RUNS_PATH, GEAR_PREV: TMP_PREV_PATH }, (line) => {
    out += line + "\n";
  });
  const report = between(out, REPORT_START, REPORT_END);
  const summary = between(out, SUMMARY_START, SUMMARY_END);
  if (code !== 0 || report === null || summary === null) {
    console.error(out);
    throw new Error("集計に失敗した（上の出力を参照）");
  }
  return { runs, report, summary };
}

const t0 = Date.now();
console.log(`[qa:gear] ${jobs} 並列・${seeds} seed・最大 ${steps} step${only ? `・--only ${only}` : ""}`);
const { records, failed } = await runShards();
if (failed > 0) console.error(`[qa:gear] ${failed} 本のシャードが非 0 で終わった（例外のランがあっても記録は集計する）`);
const merged = noWrite ? records : mergeRecords(records);
const { runs, report, summary } = await aggregate(merged);
console.log(report);
if (noWrite) {
  console.log("[qa:gear] --no-write のため書き出さない");
} else {
  writeFileSync(RUNS_PATH, JSON.stringify(runs), "utf8");
  writeFileSync(REPORT_PATH, report + "\n", "utf8");
  writeFileSync(SUMMARY_PATH, summary + "\n", "utf8");
  console.log(`[qa:gear] ${path.relative(ROOT, REPORT_PATH)} / ${path.relative(ROOT, SUMMARY_PATH)} を更新した`);
}
console.log(`[qa:gear] ${((Date.now() - t0) / 60_000).toFixed(1)} 分`);
process.exit(failed > 0 ? 1 : 0);
