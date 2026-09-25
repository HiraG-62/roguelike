/**
 * エージェント資料（CLAUDE.md / docs/CODE_MAP.md / docs/recipes / .claude/agents / .claude/skills / docs/AI_WORKFLOW.md）が
 * コードの現状からずれていないかを機械で検査する（`npm run audit:docs`。`npm run check` の最初の段）。
 *
 * 検査するのは「実在するか」「数が合うか」「登録されているか」だけ。説明文の正しさは
 * `/agent-docs`（人と Agent の仕事）。ここで落ちたら資料を直す。検査を緩めない。
 *
 * 1. 資料が参照するパス（src/ docs/ scripts/ electron/ .claude/ と `xxx.ts` の裸のファイル名）が実在する
 * 2. 資料が参照する大文字の識別子（`BOON_KEYS` など）が src / scripts / electron のどこかにある
 * 3. src の本体ファイル（テスト以外）が docs/CODE_MAP.md に載っている
 * 4. docs/CODE_MAP.md の「`XXX`、N 種 / N 体」の N が配列の要素数と一致する
 * 5. .claude/skills / .claude/agents / docs/recipes が CLAUDE.md に登録され、frontmatter が形式どおり
 * 6. 用語集で置き換えた旧用語が「旧〜」の形以外で残っていない
 * 7. CLAUDE.md が行数の上限を超えていない（詳細は docs/ 側へ分けて参照させる）
 * 8. バランス数値の組み立て（src/data/balance/assembled.gen.ts）が JSON のディレクトリと食い違っていない（`npm run balance:gen`）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBalanceAssembly } from "./balance-assemble.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 資料として検査するファイル */
const DOC_FILES = ["CLAUDE.md", "docs/CODE_MAP.md", "docs/AI_WORKFLOW.md"];
const RECIPES_DIR = "docs/recipes";
/** CLAUDE.md は入口の索引。これを超えたら docs/ 側へ分割する */
const MAX_CLAUDE_LINES = 150;
const SKILLS_DIR = ".claude/skills";
const AGENTS_DIR = ".claude/agents";
/** 識別子を探す範囲 */
const SOURCE_DIRS = ["src", "scripts", "electron"];
/** 地図に載せなくてよいもの（テスト・雛形）。増やすときは理由を書く */
const MAP_EXEMPT = new Set([]);
/** 大文字の識別子だがコードではない語 */
const IDENT_ALLOW = new Set(["DEPTHBREAKER", "APPDATA", "SIM_FULL", "YYYYMMDD"]);
/** GLOSSARY で置き換えた旧用語。「旧アフィックス」のように 旧 を前置した説明だけ許す */
const STALE_TERMS = ["アフィックス", "ユニーク", "キーストーン", "エリート", "ジャスト回避", "マナ", "スタガー", "バースト", "必殺ゲージ", "固有技"];
/** プレースホルダを含む参照は検査しない */
const PLACEHOLDER = /xxx|foo|<|\*|…/i;
/** agents の model に許す値 */
const AGENT_MODELS = new Set(["fable", "opus", "sonnet", "haiku"]);

const problems = [];
const note = (file, msg) => problems.push(`${file}: ${msg}`);

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const sourceFiles = SOURCE_DIRS.flatMap((d) => walk(d));
const sourceText = sourceFiles.filter((f) => /\.(ts|mjs|json)$/.test(f)).map((f) => read(f)).join("\n");
const byBasename = new Map();
for (const f of sourceFiles) {
  const list = byBasename.get(basename(f)) ?? [];
  list.push(f);
  byBasename.set(basename(f), list);
}

const skillFiles = walk(SKILLS_DIR).filter((f) => f.endsWith("SKILL.md"));
const agentFiles = walk(AGENTS_DIR).filter((f) => f.endsWith(".md"));
const recipeFiles = walk(RECIPES_DIR).filter((f) => f.endsWith(".md"));
const docs = [...DOC_FILES, ...recipeFiles, ...skillFiles, ...agentFiles].map((rel) => ({ rel, text: read(rel) }));
const claudeMd = read("CLAUDE.md");
const codeMap = read("docs/CODE_MAP.md");

// ---------- 1. パス ----------
function checkPaths({ rel, text }) {
  const seen = new Set();
  // ディレクトリ付きの参照（src/... docs/... など）
  for (const m of text.matchAll(/(?:src|docs|scripts|electron|memo|\.claude)\/[A-Za-z0-9_./-]+/g)) {
    let token = m[0].replace(/[.]+$/, "");
    if (PLACEHOLDER.test(token) || seen.has(token)) continue;
    seen.add(token);
    const target = join(ROOT, token);
    if (existsSync(target)) continue;
    // 末尾の "/" で切れた（プレースホルダの手前）ならディレクトリとして見る
    if (token.endsWith("/")) {
      if (!existsSync(target)) note(rel, `ディレクトリが無い: ${token}`);
      continue;
    }
    note(rel, `パスが無い: ${token}`);
  }
  // 裸のファイル名（`sfxNames.ts` / `data/tuning.ts` のような src 直下からの相対）
  for (const m of text.matchAll(/`([A-Za-z0-9_/-]+\.(?:ts|mjs|json))`/g)) {
    const token = m[1];
    if (PLACEHOLDER.test(token) || seen.has(token)) continue;
    seen.add(token);
    if (token.includes("/")) {
      if (existsSync(join(ROOT, token)) || existsSync(join(ROOT, "src", token))) continue;
      note(rel, `パスが無い: ${token}（src/ からの相対でも見つからない）`);
      continue;
    }
    if (byBasename.has(token) || existsSync(join(ROOT, token))) continue;
    note(rel, `ファイルが無い: ${token}`);
  }
}

// ---------- 2. 識別子 ----------
function checkIdentifiers({ rel, text }) {
  const seen = new Set();
  const candidates = [
    ...[...text.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?<![A-Za-z0-9_`])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?![A-Za-z0-9_`])/g)].map((m) => m[1]),
  ];
  for (const id of candidates) {
    if (seen.has(id) || IDENT_ALLOW.has(id) || PLACEHOLDER.test(id)) continue;
    if (id.length < 5 && !id.includes("_")) continue;
    // 文書名（docs/STATS_AND_SCALING.md など）は識別子ではない
    if (new RegExp(`${id}\\.md`).test(text)) continue;
    seen.add(id);
    if (new RegExp(`\\b${id}\\b`).test(sourceText)) continue;
    note(rel, `識別子がコードに無い: ${id}`);
  }
}

// ---------- 3. 地図の網羅 ----------
function checkMapCoverage() {
  for (const f of sourceFiles) {
    if (!f.startsWith("src/") || !f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const name = basename(f, ".ts");
    if (MAP_EXEMPT.has(f)) continue;
    const re = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);
    if (re.test(codeMap)) continue;
    note("docs/CODE_MAP.md", `地図に無いファイル: ${f}（該当する層の行に 1 行足す。消したファイルなら行を消す）`);
  }
}

// ---------- 4. 件数 ----------
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** `[` の位置から、深さ 1 の要素数を数える（文字列・入れ子を考慮） */
function countElements(src, openIdx) {
  let depth = 0;
  let count = 0;
  let hasContent = false;
  let inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; hasContent = true; continue; }
    if (ch === "[" || ch === "{" || ch === "(") { depth++; if (depth > 1) hasContent = true; continue; }
    if (ch === "]" || ch === "}" || ch === ")") {
      depth--;
      if (depth === 0) return hasContent ? count + 1 : count;
      continue;
    }
    if (depth === 1 && ch === ",") { if (hasContent) count++; hasContent = false; continue; }
    if (depth === 1 && !/\s/.test(ch)) hasContent = true;
  }
  return count;
}

function checkCounts() {
  for (const m of codeMap.matchAll(/`([A-Z][A-Z0-9_]+)`、(\d+) (?:種|体|件)/g)) {
    const [, name, expected] = m;
    const defRe = new RegExp(`(?:export )?const ${name}(?:\\s*:[^=\\n]+)?\\s*=\\s*\\[`);
    const file = sourceFiles.find((f) => f.endsWith(".ts") && defRe.test(stripComments(read(f))));
    if (!file) { note("docs/CODE_MAP.md", `件数の参照先が無い: ${name}（配列の定義が見つからない）`); continue; }
    const src = stripComments(read(file));
    const idx = src.search(defRe);
    // 型注釈の `[]` ではなく `=` の後の `[` から数える
    const open = idx + (src.slice(idx).match(defRe)?.[0].length ?? 1) - 1;
    const actual = countElements(src, open);
    if (actual !== Number(expected)) note("docs/CODE_MAP.md", `件数のずれ: ${name} は ${actual}（資料は ${expected}。${file}）`);
  }
}

// ---------- 5. skill / agent の登録 ----------
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

function checkRegistrations() {
  for (const f of skillFiles) {
    const dir = basename(dirname(f));
    const fm = frontmatter(read(f));
    if (!fm?.name || !fm.description) { note(f, "frontmatter に name / description が無い"); continue; }
    if (fm.name !== dir) note(f, `frontmatter の name（${fm.name}）とディレクトリ名（${dir}）が違う`);
    if (!claudeMd.includes(`\`/${dir}\``)) note("CLAUDE.md", `skill が未登録: /${dir}（「並列開発の作法」の skill 一覧に足す）`);
  }
  for (const f of agentFiles) {
    const name = basename(f, ".md");
    const fm = frontmatter(read(f));
    if (!fm?.name || !fm.description || !fm.model) { note(f, "frontmatter に name / description / model が無い"); continue; }
    if (fm.name !== name) note(f, `frontmatter の name（${fm.name}）とファイル名（${name}）が違う`);
    if (!AGENT_MODELS.has(fm.model)) note(f, `model が想定外: ${fm.model}`);
    const listed = new RegExp(`(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`).test(claudeMd);
    if (!listed) note("CLAUDE.md", `agent が未登録: ${name}（「並列開発の作法」のモデルの行に足す）`);
  }
  for (const f of recipeFiles) {
    if (!claudeMd.includes(`\`${f}\``)) note("CLAUDE.md", `レシピが未登録: ${f}（「要素の足し方」の表に足す）`);
  }
}

// ---------- 7. CLAUDE.md の長さ ----------
function checkClaudeLength() {
  const n = claudeMd.split("\n").length;
  if (n > MAX_CLAUDE_LINES) note("CLAUDE.md", `${n} 行（上限 ${MAX_CLAUDE_LINES}）。詳細は docs/（CODE_MAP / recipes / AI_WORKFLOW）へ分けて、ここには参照だけ残す`);
}

// ---------- 6. 旧用語 ----------
function checkStaleTerms({ rel, text }) {
  for (const term of STALE_TERMS) {
    const re = new RegExp(`(?<!旧)(?<!旧 )${term}`, "g");
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      note(rel, `旧用語「${term}」（${line} 行目）。GLOSSARY の表記に直す（説明で触れるなら「旧${term}」）`);
    }
  }
}

// ---------- 8. バランス数値の組み立て ----------
function checkBalanceAssemblyUpToDate() {
  for (const p of checkBalanceAssembly()) note("src/data/balance", p);
}

for (const doc of docs) {
  checkPaths(doc);
  checkIdentifiers(doc);
  checkStaleTerms(doc);
}
checkMapCoverage();
checkCounts();
checkRegistrations();
checkClaudeLength();
checkBalanceAssemblyUpToDate();

if (problems.length === 0) {
  console.log(`[audit:docs] OK（資料 ${docs.length} 件、src の本体ファイルは CODE_MAP に網羅、CLAUDE.md ${claudeMd.split("\n").length} 行）`);
  process.exit(0);
}
console.error(`[audit:docs] ${problems.length} 件のずれ。資料をコードに合わせて直す（判断が要るものは /agent-docs）\n`);
for (const p of problems) console.error("  - " + p);
process.exit(1);
