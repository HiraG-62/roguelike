/**
 * 戦闘の基準値の計測（`npm run qa:probe`）。SIM_PROBE=1 を付けて src/qa/combatProbe.test.ts の重い版を実行し、
 * 標準出力のマーカー間（<<<QA_PROBE_START>>> 〜 <<<QA_PROBE_END>>>）を src/qa/probe.md に書き出す。
 * combatProbe.test.ts は @types/node が無く fs に触れないため、書き出しはこのスクリプトの責務
 * （scripts/qa-full.mjs と同じ方式）。
 *
 * 使い方:
 *   npm run qa:probe              # 武器種 × 敵の表を除いて実行し、probe.md を上書き（武器種の節は今の内容を残す。約 1 分）
 *   npm run qa:probe -- --weapons   # 武器種 × 敵の表（27 武器種 × 敵 3 × 深度 2 × seed 3。約 2 分）だけ測り、probe.md のその節だけ差し替える
 *   npm run qa:probe -- --bosses    # 章ボス 4 と最深の主を 1 体ずつ測り（5 体 × seed 5。約 1 分）、probe.md の「## ボス」の節だけ差し替える
 *   npm run qa:probe -- --deep      # 深み（深度 21〜40 の曲線・到達の届き方・壊れたビルドの重さ。src/qa/deepProbe.ts）だけ測り、probe.md の「## 深み」の節だけ差し替える
 *   npm run qa:probe -- --no-write  # 実行だけ（probe.md を変えない）。--weapons / --bosses / --deep と併用できる
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const PROBE_PATH = path.join(ROOT, "src", "qa", "probe.md");
const PROBE_START = "<<<QA_PROBE_START>>>";
const PROBE_END = "<<<QA_PROBE_END>>>";
const WEAPONS_START = "<<<QA_PROBE_WEAPONS_START>>>";
const WEAPONS_END = "<<<QA_PROBE_WEAPONS_END>>>";
const BOSSES_START = "<<<QA_PROBE_BOSSES_START>>>";
const BOSSES_END = "<<<QA_PROBE_BOSSES_END>>>";
/** 武器種 × 敵の節の見出しと、その直後に続く節（重い計測を毎回回さないため、節だけ差し替える） */
const WEAPONS_HEADING = "## 武器種 × 敵";
const POWER_HEADING = "## 地力 ÷ 敵の生命";
/** ボスの節の見出し（末尾に置く。節だけ差し替える） */
const BOSSES_HEADING = "## ボス";
const noWrite = process.argv.includes("--no-write");
const weaponsOnly = process.argv.includes("--weapons");
const bossesOnly = process.argv.includes("--bosses");
const deepOnly = process.argv.includes("--deep");
const DEEP_START = "<<<QA_PROBE_DEEP_START>>>";
const DEEP_END = "<<<QA_PROBE_DEEP_END>>>";
/** 深みの節の見出し。無ければ末尾に足す（他の節は触らない） */
const DEEP_HEADING = "## 深み";

/** md から見出し行が `heading` で始まる節（次の `## ` の直前まで）の [開始, 終了) の文字位置を返す。無ければ null（見出しの後ろに補足が続いてもよい） */
function findSection(md, heading) {
  const lines = md.split("\n");
  let offset = 0;
  let start = -1;
  for (const line of lines) {
    if (start < 0 && line.startsWith(heading)) start = offset;
    else if (start >= 0 && line.startsWith("## ")) return [start, offset];
    offset += line.length + 1;
  }
  return start < 0 ? null : [start, md.length];
}

/** heading の節を差し替える（無ければ beforeHeading の節の直前、それも無ければ末尾に入れる）。section は末尾が改行の 1 節 */
function replaceSection(md, heading, section, beforeHeading) {
  const body = `${section.trimEnd()}\n`;
  const found = findSection(md, heading);
  if (found) return `${md.slice(0, found[0])}${body}\n${md.slice(found[1])}`;
  const before = beforeHeading ? findSection(md, beforeHeading) : null;
  if (before) return `${md.slice(0, before[0])}${body}\n${md.slice(before[0])}`;
  return md.endsWith("\n") ? `${md}\n${body}` : `${md}\n\n${body}`;
}

/** 武器種の節を差し替える（無ければ地力の節の直前） */
function replaceWeaponsSection(md, section) {
  return replaceSection(md, WEAPONS_HEADING, section, POWER_HEADING);
}

/** ボスの節を差し替える（無ければ末尾） */
function replaceBossesSection(md, section) {
  return replaceSection(md, BOSSES_HEADING, section);
}

/** 深みの節を差し替える（無ければ末尾） */
function replaceDeepSection(md, section) {
  return replaceSection(md, DEEP_HEADING, section);
}

// AI エージェント配下では vitest が agent reporter を選び、成功したテストの console 出力を隠すため明示する
const PROBE_TEST = bossesOnly ? "src/qa/bossProbe.test.ts" : deepOnly ? "src/qa/deepProbe.test.ts" : "src/qa/combatProbe.test.ts";
const VITEST_ARGS = ["run", PROBE_TEST, "--reporter=default", "--silent=false"];
const child = spawn(process.execPath, [VITEST, ...VITEST_ARGS], {
  cwd: ROOT,
  env: { ...process.env, SIM_PROBE: bossesOnly ? "bosses" : deepOnly ? "deep" : weaponsOnly ? "weapons" : "1" },
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
  const report = bossesOnly ? bossesReport() : deepOnly ? deepReport() : weaponsOnly ? weaponsReport() : fullReport();
  if (report === null) {
    console.error("[qa:probe] 表のマーカーが出力に見つからない。probe.md は更新しない");
    process.exit(code === 0 ? 1 : (code ?? 1));
  }
  if (noWrite) {
    console.log("[qa:probe] --no-write のため probe.md は更新しない");
  } else {
    writeFileSync(PROBE_PATH, report, "utf8");
    console.log(`[qa:probe] ${path.relative(ROOT, PROBE_PATH)} を更新した`);
  }
  process.exit(code ?? 1);
});

function between(startMarker, endMarker) {
  const start = stdout.indexOf(startMarker);
  const end = stdout.indexOf(endMarker, start + 1);
  if (start < 0 || end < 0) return null;
  return stdout.slice(start + startMarker.length, end).trim().replace(/\r\n/g, "\n") + "\n";
}

function currentProbe() {
  return existsSync(PROBE_PATH) ? readFileSync(PROBE_PATH, "utf8") : "";
}

/** 通常の実行: 新しい報告に、今の probe.md にある武器種・ボス・深みの節をそのまま残す（重い計測を毎回回さないため） */
function fullReport() {
  const report = between(PROBE_START, PROBE_END);
  if (report === null) return null;
  const old = currentProbe();
  const weapons = findSection(old, WEAPONS_HEADING);
  const withWeapons = weapons ? replaceWeaponsSection(report, old.slice(weapons[0], weapons[1])) : report;
  const bosses = findSection(old, BOSSES_HEADING);
  const withBosses = bosses ? replaceBossesSection(withWeapons, old.slice(bosses[0], bosses[1])) : withWeapons;
  const deep = findSection(old, DEEP_HEADING);
  return deep ? replaceDeepSection(withBosses, old.slice(deep[0], deep[1])) : withBosses;
}

/** --weapons: 今の probe.md の武器種の節だけを差し替える（probe.md が無ければ節だけの報告になる） */
function weaponsReport() {
  const section = between(WEAPONS_START, WEAPONS_END);
  if (section === null) return null;
  return replaceWeaponsSection(currentProbe(), section);
}

/** --bosses: 今の probe.md のボスの節だけを差し替える（probe.md が無ければ節だけの報告になる） */
function bossesReport() {
  const section = between(BOSSES_START, BOSSES_END);
  if (section === null) return null;
  return replaceBossesSection(currentProbe(), section);
}

/** --deep: 今の probe.md の「## 深み」の節だけを差し替える（probe.md が無ければ節だけの報告になる） */
function deepReport() {
  const section = between(DEEP_START, DEEP_END);
  if (section === null) return null;
  return replaceDeepSection(currentProbe(), section);
}
