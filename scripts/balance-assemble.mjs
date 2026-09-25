/**
 * バランス数値のディレクトリ（src/data/balance/<ファイル>/…）を走査し、全 JSON を明示的な import で組み立てる
 * `src/data/balance/assembled.gen.ts` を書き出す（`npm run balance:gen`）。
 * import.meta.glob ではなく明示の import にするのは、JSON ごとの厳密な型推論を BALANCE の型へそのまま通すため。
 *
 * 配置の決まり（docs/BALANCE.md「ファイルの配置」）:
 * - ディレクトリ = 1 つのオブジェクト。`_index.json` にそのオブジェクトの `_note` / `_fields`、ディレクトリに直接置く値、
 *   キーの並び `_order` を書く
 * - `<key>.json` はその key の値。`<key>/` は値がさらにディレクトリに分かれたもの
 * - キーの並びは `_order` が正（BALANCE_HASH と、敵の一覧などの並びがキー順に依存するため）。
 *   `_order` に無い key は生成時に末尾へ足して `_index.json` を書き直す（--check では落とす）
 *
 * 使い方: node scripts/balance-assemble.mjs [--check]
 *   --check: 書き出さず、生成物とディレクトリの食い違い・`_order` の漏れを報告して非 0 で終わる（audit:docs が呼ぶ）
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BALANCE_DIR = join(ROOT, "src/data/balance");
const OUT_FILE = join(BALANCE_DIR, "assembled.gen.ts");
const INDEX_FILE = "_index.json";
const ORDER_KEY = "_order";
const JSON_EXT = ".json";
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INDENT = "  ";

const isMetaKey = (key) => key.startsWith("_");

function readJson(abs, problems) {
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    problems.push(`${rel(abs)}: JSON として読めない（${e instanceof Error ? e.message : String(e)}）`);
    return undefined;
  }
}

function rel(abs) {
  return relative(ROOT, abs).split("\\").join("/");
}

/** `_order` の配列を 1 行で書く（生成時に書き直す形と移行時の形をそろえる） */
export function formatOrder(keys) {
  return `[${keys.map((k) => JSON.stringify(k)).join(", ")}]`;
}

/** `_index.json` の `_order` だけを書き換える（手で整えた他の行の書式を崩さない） */
function rewriteOrder(indexAbs, keys) {
  const text = readFileSync(indexAbs, "utf8");
  const next = text.replace(/"_order"\s*:\s*\[[^\]]*\]/, `"${ORDER_KEY}": ${formatOrder(keys)}`);
  writeFileSync(indexAbs, next);
}

/**
 * 1 つのディレクトリを 1 つのオブジェクトとして読む。
 * 戻り値: { indexRel, metaKeys, children: [{ key, kind: "inline" | "file" | "dir", fileRel?, node? }] }
 */
function scanDir(abs, ctx) {
  const indexAbs = join(abs, INDEX_FILE);
  if (!existsSync(indexAbs)) {
    ctx.problems.push(`${rel(abs)}/: ${INDEX_FILE} が無い（_order を書いた ${INDEX_FILE} を置く）`);
    return undefined;
  }
  const index = readJson(indexAbs, ctx.problems);
  if (typeof index !== "object" || index === null || Array.isArray(index)) {
    if (index !== undefined) ctx.problems.push(`${rel(indexAbs)}: オブジェクトであること`);
    return undefined;
  }
  ctx.files.push(rel(indexAbs));
  const order = index[ORDER_KEY];
  if (!Array.isArray(order) || order.some((k) => typeof k !== "string")) {
    ctx.problems.push(`${rel(indexAbs)}: ${ORDER_KEY} は key の文字列の配列であること`);
    return undefined;
  }

  /** key → 値の置き場所 */
  const sources = new Map();
  const addSource = (key, source) => {
    const prev = sources.get(key);
    if (prev) {
      ctx.problems.push(`${rel(abs)}/: key "${key}" が ${prev.kind} と ${source.kind} の両方にある（どちらか一方に置く）`);
      return;
    }
    sources.set(key, source);
  };
  for (const key of Object.keys(index)) {
    if (!isMetaKey(key)) addSource(key, { kind: "inline" });
  }
  for (const name of readdirSync(abs).sort()) {
    if (name === INDEX_FILE || name.startsWith(".")) continue;
    const childAbs = join(abs, name);
    if (statSync(childAbs).isDirectory()) {
      addSource(name, { kind: "dir", abs: childAbs });
      continue;
    }
    if (!name.endsWith(JSON_EXT)) {
      // 最上位には index.ts などのコードが同居する。下の階層は JSON だけ
      if (!ctx.top) ctx.problems.push(`${rel(childAbs)}: JSON 以外のファイルは置かない`);
      continue;
    }
    const key = name.slice(0, -JSON_EXT.length);
    if (isMetaKey(key)) {
      ctx.problems.push(`${rel(childAbs)}: _ で始まるファイルは ${INDEX_FILE} だけ（_note / _fields は ${INDEX_FILE} に書く）`);
      continue;
    }
    addSource(key, { kind: "file", abs: childAbs });
  }

  const seen = new Set();
  for (const key of order) {
    if (seen.has(key)) ctx.problems.push(`${rel(indexAbs)}: ${ORDER_KEY} に "${key}" が 2 回ある`);
    seen.add(key);
    if (!sources.has(key)) ctx.problems.push(`${rel(indexAbs)}: ${ORDER_KEY} の "${key}" に値が無い（ファイル・ディレクトリ・${INDEX_FILE} の項目のどれも無い）`);
  }
  const missing = [...sources.keys()].filter((k) => !seen.has(k)).sort();
  let finalOrder = order;
  if (missing.length > 0) {
    if (ctx.write) {
      finalOrder = [...order, ...missing];
      rewriteOrder(indexAbs, finalOrder);
      ctx.log.push(`${rel(indexAbs)}: ${ORDER_KEY} の末尾へ足した: ${missing.join(", ")}`);
    } else {
      ctx.problems.push(`${rel(indexAbs)}: ${ORDER_KEY} に無い key: ${missing.join(", ")}（npm run balance:gen で末尾へ足す）`);
    }
  }

  const children = [];
  for (const key of finalOrder) {
    const source = sources.get(key);
    if (!source || children.some((c) => c.key === key)) continue;
    if (source.kind === "inline") children.push({ key, kind: "inline" });
    if (source.kind === "file") {
      ctx.files.push(rel(source.abs));
      children.push({ key, kind: "file", fileRel: rel(source.abs) });
    }
    if (source.kind === "dir") {
      const node = scanDir(source.abs, { ...ctx, top: false });
      if (node) children.push({ key, kind: "dir", node });
    }
  }
  const metaKeys = Object.keys(index).filter((k) => isMetaKey(k) && k !== ORDER_KEY);
  return { indexRel: rel(indexAbs), metaKeys, children };
}

/** import する JSON の相対パス → 識別子 */
class ImportTable {
  constructor() {
    this.byPath = new Map();
    this.used = new Set();
  }
  ident(fileRel) {
    const hit = this.byPath.get(fileRel);
    if (hit) return hit;
    const inner = relative("src/data/balance", fileRel).replace(/\.json$/, "");
    const base = `j_${inner.replace(/[^A-Za-z0-9]/g, "_")}`;
    let name = base;
    for (let n = 2; this.used.has(name); n++) name = `${base}_${n}`;
    this.used.add(name);
    this.byPath.set(fileRel, name);
    return name;
  }
}

function emitObject(node, depth, imports) {
  const pad = INDENT.repeat(depth + 1);
  const lines = [];
  const needsIndex = node.metaKeys.length > 0 || node.children.some((c) => c.kind === "inline");
  const indexId = needsIndex ? imports.ident(node.indexRel) : "";
  for (const key of node.metaKeys) lines.push(`${pad}${JSON.stringify(key)}: ${indexId}[${JSON.stringify(key)}],`);
  for (const child of node.children) {
    const k = JSON.stringify(child.key);
    if (child.kind === "inline") lines.push(`${pad}${k}: ${indexId}[${k}],`);
    if (child.kind === "file") lines.push(`${pad}${k}: ${imports.ident(child.fileRel)},`);
    if (child.kind === "dir") lines.push(`${pad}${k}: ${emitObject(child.node, depth + 1, imports)},`);
  }
  return `{\n${lines.join("\n")}\n${INDENT.repeat(depth)}}`;
}

/** 生成物の本文と問題の一覧を返す。write のとき _order の漏れを書き足す */
export function assembleBalance({ write = false } = {}) {
  const problems = [];
  const log = [];
  const files = [];
  const tops = readdirSync(BALANCE_DIR)
    .filter((name) => statSync(join(BALANCE_DIR, name)).isDirectory())
    .sort();
  const imports = new ImportTable();
  const exportsSrc = [];
  for (const name of tops) {
    if (!IDENTIFIER_RE.test(name)) {
      problems.push(`src/data/balance/${name}/: 最上位のディレクトリ名は識別子にする`);
      continue;
    }
    const node = scanDir(join(BALANCE_DIR, name), { problems, log, files, write, top: true });
    if (!node) continue;
    exportsSrc.push(`export const ${name} = ${emitObject(node, 0, imports)};`);
  }
  const importLines = [...imports.byPath.entries()].map(
    ([fileRel, id]) => `import ${id} from "./${relative("src/data/balance", fileRel).split("\\").join("/")}";`,
  );
  const fileList = files
    .map((f) => relative("src/data/balance", f).split("\\").join("/"))
    .sort()
    .map((f) => `  ${JSON.stringify(f)},`);
  const text = [
    "// 自動生成（scripts/balance-assemble.mjs）。手で直さない。JSON を足したり消したりしたら `npm run balance:gen`",
    "// 配置の決まりは docs/BALANCE.md「ファイルの配置」",
    ...importLines,
    "",
    ...exportsSrc.flatMap((s) => [s, ""]),
    "/** 組み立てに使った JSON（src/data/balance からの相対。_index.json を含む）。生成し忘れの検査に使う */",
    "export const BALANCE_SOURCE_FILES: readonly string[] = [",
    ...fileList,
    "];",
    "",
  ].join("\n");
  return { text, problems, log };
}

/** --check 用: 生成物がディレクトリと食い違っていないか */
export function checkBalanceAssembly() {
  const { text, problems } = assembleBalance({ write: false });
  if (problems.length > 0) return problems;
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== text) return [`${rel(OUT_FILE)} が JSON のディレクトリと食い違っている（npm run balance:gen で作り直す）`];
  return [];
}

function main() {
  if (process.argv.includes("--check")) {
    const problems = checkBalanceAssembly();
    if (problems.length === 0) {
      console.log("[balance:gen] OK（生成物は最新）");
      process.exit(0);
    }
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const { text, problems, log } = assembleBalance({ write: true });
  for (const l of log) console.log(`[balance:gen] ${l}`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  writeFileSync(OUT_FILE, text);
  console.log(`[balance:gen] ${rel(OUT_FILE)} を書き出した`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
