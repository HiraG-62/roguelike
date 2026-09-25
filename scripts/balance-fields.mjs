/**
 * TS の interface の JSDoc から、バランス JSON の `_fields`（項目の説明）の雛形を標準出力へ出す（移行専用ツール）。
 * TS 7 の npm パッケージには JS の compiler API が無いので、正規表現で `/** … *\/ name?: type;` を拾うだけ。
 * 出てきた説明に単位・目安を足してから JSON に貼る（推測で埋めず、読んでいる system のコードで確かめる）。
 * JSDoc の無い項目は空文字で出す（空のまま貼ると balance.test.ts の validateFieldDocs が落とす）。
 *
 * 使い方: node scripts/balance-fields.mjs src/data/enemies.ts EnemyDef
 * `_fields` の全ファイル化（docs/ideas/oop-migration.md 4.5）が終わったら削除してよい
 */
import { readFileSync } from "node:fs";

/** interface 名 { の直後から対応する } までの本文 */
function interfaceBody(source, name) {
  const head = new RegExp(`interface\\s+${name}\\b[^{]*\\{`).exec(source);
  if (!head) return undefined;
  let depth = 1;
  const start = head.index + head[0].length;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return source.slice(start, i);
  }
  return undefined;
}

/** `/** … *\/` の中身を 1 行にする */
function docText(comment) {
  return comment
    .replace(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line !== "")
    .join(" ");
}

/** 1 行の inline object 型（`{ min: number; max: number }`）の key 一覧 */
function inlineKeys(type) {
  const inner = /^\{(.*)\}$/.exec(type.trim());
  if (!inner) return [];
  return [...inner[1].matchAll(/([A-Za-z0-9_]+)\??\s*:/g)].map((m) => m[1]);
}

/** i から始まる型を、括弧の外の `;` か改行まで読む。[型, 次の位置] */
function readType(body, i) {
  let depth = 0;
  let j = i;
  for (; j < body.length; j++) {
    const ch = body[j];
    if (ch === "{" || ch === "(" || ch === "[" || ch === "<") depth++;
    // `=>` の > は括弧ではない
    if (ch === "}" || ch === ")" || ch === "]" || (ch === ">" && body[j - 1] !== "=")) depth--;
    if (depth <= 0 && (ch === ";" || ch === "\n")) break;
  }
  return [body.slice(i, j).trim(), j + 1];
}

/**
 * 本文を頭から member 単位で読む。直前の JSDoc をその member の説明にする。
 * 型が 1 行の inline object なら `親.子` のドット表記に展開する
 */
function collectFields(body) {
  const fields = {};
  const headRe = /\s*(\/\*\*[\s\S]*?\*\/)?\s*(?:\/\/[^\n]*\n\s*)*(?:readonly\s+)?([A-Za-z0-9_]+)\??\s*:\s*/y;
  let i = 0;
  while (i < body.length) {
    headRe.lastIndex = i;
    const m = headRe.exec(body);
    if (!m) {
      // 行コメントや空行など member でない行は飛ばす
      const next = body.indexOf("\n", i);
      i = next < 0 ? body.length : next + 1;
      continue;
    }
    const [type, next] = readType(body, headRe.lastIndex);
    const doc = m[1] ? docText(m[1]) : "";
    const children = inlineKeys(type);
    if (children.length === 0) fields[m[2]] = doc;
    for (const child of children) fields[`${m[2]}.${child}`] = doc;
    i = next;
  }
  return fields;
}

function main() {
  const [file, name] = process.argv.slice(2);
  if (!file || !name) {
    console.error("使い方: node scripts/balance-fields.mjs <TS ファイル> <interface 名>");
    process.exit(1);
  }
  const body = interfaceBody(readFileSync(file, "utf8"), name);
  if (body === undefined) {
    console.error(`${file} に interface ${name} が見つからない`);
    process.exit(1);
  }
  console.log(JSON.stringify({ _fields: collectFields(body) }, null, 2));
}

main();
