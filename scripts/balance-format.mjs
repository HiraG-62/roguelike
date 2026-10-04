/**
 * バランス数値の JSON（src/data/balance/**\/*.json）を「1 項目 1 行」にそろえる（`npm run balance:fmt`）。
 * 1 行に何項目も並ぶと人の手で調整するときに目で追えないため。ただし値だけの小さいオブジェクト・配列
 * （`{ "base": 1.6, "dex": 0.25 }` や `["primary", "secondary"]`）は 1 行に収まるなら 1 行に残す。
 *
 * 使い方: node scripts/balance-format.mjs [--check]
 *   --check: 書き出さず、整形がずれているファイルを報告して非 0 で終わる
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BALANCE_DIR = join(ROOT, "src/data/balance");
const JSON_EXT = ".json";
const INDENT = "  ";
/** 1 行に畳んでよい行の幅（字下げ・キー・末尾のカンマを含む） */
const MAX_INLINE_WIDTH = 100;
/** 1 行に畳んでよいオブジェクトの項目数。これを超えたら幅に収まっても 1 項目 1 行にする */
const MAX_INLINE_OBJECT_ENTRIES = 4;

/** これ以上のコードポイントは全角として 2 字に数える（CJK・全角記号。エディタでの見た目の幅に合わせる） */
const WIDE_CHAR_FROM = 0x2e80;

const isContainer = (v) => typeof v === "object" && v !== null;

/** 見た目の幅（全角は 2） */
function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) >= WIDE_CHAR_FROM ? 2 : 1;
  return width;
}

/** 中身が数値・文字列などの値だけ（入れ子が無い）なら畳む候補 */
function inlineForm(value) {
  if (Array.isArray(value)) {
    if (value.some(isContainer)) return undefined;
    return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_INLINE_OBJECT_ENTRIES || entries.some(([, v]) => isContainer(v))) return undefined;
  return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
}

/** prefixWidth: 同じ行で値の前に来る文字数（字下げ + `"key": `） */
function formatValue(value, depth, prefixWidth) {
  if (!isContainer(value)) return JSON.stringify(value);
  const isArray = Array.isArray(value);
  const items = isArray ? value.map((v) => [undefined, v]) : Object.entries(value);
  if (items.length === 0) return isArray ? "[]" : "{}";
  const inline = inlineForm(value);
  // 末尾のカンマの 1 字も幅に数える
  if (inline !== undefined && prefixWidth + displayWidth(inline) + 1 <= MAX_INLINE_WIDTH) return inline;
  const pad = INDENT.repeat(depth + 1);
  const lines = items.map(([key, v]) => {
    const head = key === undefined ? pad : `${pad}${JSON.stringify(key)}: `;
    return `${head}${formatValue(v, depth + 1, displayWidth(head))}`;
  });
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  return `${open}\n${lines.join(",\n")}\n${INDENT.repeat(depth)}${close}`;
}

/** JSON の値を整形した文字列（末尾に改行）にする */
export function formatBalanceJson(value) {
  return `${formatValue(value, 0, 0)}\n`;
}

/** 整形し直した文字列。読めない JSON は例外 */
export function formatBalanceText(text) {
  return formatBalanceJson(JSON.parse(text));
}

function listJsonFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listJsonFiles(abs));
    else if (name.endsWith(JSON_EXT)) out.push(abs);
  }
  return out;
}

const rel = (abs) => relative(ROOT, abs).split("\\").join("/");

/** 整形がずれているファイル（ROOT からの相対パス） */
export function findUnformatted() {
  return listJsonFiles(BALANCE_DIR).filter((abs) => {
    const text = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
    return formatBalanceText(text) !== text;
  }).map(rel);
}

function main() {
  if (process.argv.includes("--check")) {
    const bad = findUnformatted();
    if (bad.length === 0) {
      console.log("[balance:fmt] OK（整形済み）");
      process.exit(0);
    }
    for (const f of bad) console.error(`  - ${f}（npm run balance:fmt で整形する）`);
    process.exit(1);
  }
  let changed = 0;
  for (const abs of listJsonFiles(BALANCE_DIR)) {
    const text = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
    const next = formatBalanceText(text);
    if (next === text) continue;
    writeFileSync(abs, next);
    changed++;
  }
  console.log(`[balance:fmt] ${changed} ファイルを整形した`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
