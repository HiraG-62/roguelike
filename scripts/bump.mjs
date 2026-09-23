/**
 * バージョンを上げる（`node scripts/bump.mjs patch|minor|major [--note "..."]`）。
 * package.json / package-lock.json / src/version.ts / CHANGELOG.md を更新し、
 * その 4 ファイルだけを `chore: v0.0.2α` の形でコミットして `v0.0.2` タグを付ける。
 *
 * ルール（CLAUDE.md「バージョニング」）:
 * - α 期間（src/version.ts の RELEASE_PHASE = "alpha"）は 0.0.xx で進める。patch / minor はどちらもパッチ番号を上げる
 * - α を抜けるときだけ --end-alpha（minor なら 0.1.0、major なら 1.0.0 になる）
 * - major はユーザーの指示があるときだけ。--force-major が無ければ拒否する
 *
 * オプション:
 *   --note "..."   CHANGELOG の新バージョンに 1 行追加（複数可）
 *   --end-alpha    α 期間を終える
 *   --force-major  major を許可する
 *   --dry-run      何も書き換えず、結果だけ表示する
 *   --no-git       ファイルだけ更新し、コミットとタグを作らない
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  pkg: "package.json",
  lock: "package-lock.json",
  version: "src/version.ts",
  changelog: "CHANGELOG.md",
};
const LEVELS = ["patch", "minor", "major"];
const ALPHA_SUFFIX = "α";
const UNRELEASED_HEADING = "## [Unreleased]";
const JSON_INDENT = 2;

function fail(message) {
  console.error(`[bump] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { level: null, notes: [], endAlpha: false, forceMajor: false, dryRun: false, git: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (LEVELS.includes(arg)) opts.level = arg;
    else if (arg === "--note") {
      const note = argv[++i];
      if (!note) fail("--note の後に文を指定する");
      opts.notes.push(note);
    } else if (arg === "--end-alpha") opts.endAlpha = true;
    else if (arg === "--force-major") opts.forceMajor = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-git") opts.git = false;
    else fail(`不明な引数: ${arg}`);
  }
  if (!opts.level) fail("使い方: node scripts/bump.mjs patch|minor|major [--note \"...\"] [--end-alpha] [--force-major] [--dry-run] [--no-git]");
  return opts;
}

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const write = (rel, text) => writeFileSync(path.join(ROOT, rel), text, "utf8");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function parseSemver(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!m) fail(`package.json の version が x.y.z ではない: ${text}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function currentPhase(versionTs) {
  const m = /RELEASE_PHASE: ReleasePhase = "(alpha|stable)"/.exec(versionTs);
  if (!m) fail("src/version.ts に RELEASE_PHASE が見つからない");
  return m[1];
}

/** 次の semver と段階を決める */
function nextVersion([major, minor, patch], level, phase, opts) {
  if (level === "major" && !opts.forceMajor) fail("major はユーザーの指示があるときだけ上げる。指示があるなら --force-major を付ける");
  if (phase === "alpha" && !opts.endAlpha) {
    if (level !== "patch") console.log(`[bump] α 期間なので ${level} もパッチ番号を上げる（0.0.xx）`);
    if (level === "major") fail("α 期間中の major は --end-alpha と一緒に指定する");
    return { semver: [major, minor, patch + 1], phase };
  }
  const nextPhase = opts.endAlpha ? "stable" : phase;
  if (level === "major") return { semver: [major + 1, 0, 0], phase: nextPhase };
  if (level === "minor") return { semver: [major, minor + 1, 0], phase: nextPhase };
  if (opts.endAlpha) fail("--end-alpha は minor か major と一緒に指定する");
  return { semver: [major, minor, patch + 1], phase: nextPhase };
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** [Unreleased] の中身を新しいバージョン節へ移し、[Unreleased] を空にする */
function updateChangelog(text, display, notes) {
  const start = text.indexOf(UNRELEASED_HEADING);
  if (start < 0) fail(`CHANGELOG.md に "${UNRELEASED_HEADING}" が無い`);
  const bodyStart = start + UNRELEASED_HEADING.length;
  const nextHeading = text.indexOf("\n## [", bodyStart);
  const bodyEnd = nextHeading < 0 ? text.length : nextHeading;
  const body = text.slice(bodyStart, bodyEnd).trim();
  const noteLines = notes.map((n) => `- ${n}`).join("\n");
  const content = [body, noteLines].filter((s) => s.length > 0).join("\n\n");
  if (!content) fail("CHANGELOG の [Unreleased] が空で --note も無い。変更内容を書いてから上げる");
  const section = `${UNRELEASED_HEADING}\n\n## [${display}] - ${today()}\n\n${content}\n`;
  return text.slice(0, start) + section + text.slice(bodyEnd);
}

function updateVersionTs(text, semverText, display, phase) {
  return text
    .replace(/export const APP_VERSION = "[^"]*";/, `export const APP_VERSION = "${display}";`)
    .replace(/export const APP_VERSION_SEMVER = "[^"]*";/, `export const APP_VERSION_SEMVER = "${semverText}";`)
    .replace(/RELEASE_PHASE: ReleasePhase = "[^"]*"/, `RELEASE_PHASE: ReleasePhase = "${phase}"`);
}

function updateJsonVersion(text, semverText, isLock) {
  const json = JSON.parse(text);
  json.version = semverText;
  if (isLock && json.packages?.[""]) json.packages[""].version = semverText;
  return JSON.stringify(json, null, JSON_INDENT) + "\n";
}

const opts = parseArgs(process.argv.slice(2));
const pkgText = read(FILES.pkg);
const versionTs = read(FILES.version);
const current = parseSemver(JSON.parse(pkgText).version);
const { semver, phase } = nextVersion(current, opts.level, currentPhase(versionTs), opts);
const semverText = semver.join(".");
const display = phase === "alpha" ? `${semverText}${ALPHA_SUFFIX}` : semverText;
const tag = `v${semverText}`;

if (opts.git) {
  const existing = git("tag", "--list", tag);
  if (existing) fail(`タグ ${tag} は既にある`);
}

const updates = {
  [FILES.pkg]: updateJsonVersion(pkgText, semverText, false),
  [FILES.lock]: updateJsonVersion(read(FILES.lock), semverText, true),
  [FILES.version]: updateVersionTs(versionTs, semverText, display, phase),
  [FILES.changelog]: updateChangelog(read(FILES.changelog), display, opts.notes),
};

console.log(`[bump] ${current.join(".")} → ${display}（タグ ${tag}）`);
if (opts.dryRun) {
  console.log("[bump] --dry-run のため書き換えない");
  process.exit(0);
}
for (const [rel, text] of Object.entries(updates)) write(rel, text);
console.log(`[bump] 更新: ${Object.keys(updates).join(", ")}`);

if (!opts.git) process.exit(0);
const paths = Object.values(FILES);
git("add", "--", ...paths);
// パスを指定したコミットなので、他にステージ済みの変更があっても混ざらない
git("commit", "-m", `chore: v${display}`, "--", ...paths);
git("tag", tag);
console.log(`[bump] コミット chore: v${display} とタグ ${tag} を作成した（push はしていない）`);
