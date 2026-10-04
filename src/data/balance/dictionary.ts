/**
 * バランス数値の辞書（docs/BALANCE_DICTIONARY.md）を各 JSON の `_fields` / `_note` から組み立てる。
 * 説明の正は JSON の `_fields` のまま（辞書はその写し）にして、二重に書いた説明がずれないようにする。
 * 同じ形の行が並ぶ表（敵の表・武器種の表・配列の段）は `*` / `[]` に畳み、項目を 1 回だけ載せる。
 * 書き出しは `npm run balance:dict`（dictionary.test.ts が BALANCE_DICT_WRITE=1 で書く）
 */
import { fieldDescription } from "./validate";

/** 表とみなす子の数の下限（2 つだけなら別々のブロックとして載せる） */
const TABLE_MIN_ROWS = 3;
/** 子のキー集合の重なり。和集合 ÷ 延べ数がこれ以下なら同じ形の行が並ぶ表とみなす */
const TABLE_OVERLAP_RATIO = 0.7;
/** ブロックの _note から載せる長さ（最初の文まで。長ければここで切る） */
const NOTE_MAX_CHARS = 120;
const UNDOCUMENTED = "（未記入）";
const ROW_MARK = "*";
const ARRAY_MARK = "[]";

type Json = unknown;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isMetaKey = (key: string): boolean => key.startsWith("_");
const isContainer = (v: unknown): boolean => typeof v === "object" && v !== null;
const dataEntries = (obj: Record<string, unknown>): [string, unknown][] => Object.entries(obj).filter(([k]) => !isMetaKey(k));

/** 子がすべて入れ物で、キーの形がよく重なるなら表（行ごとに同じ項目を持つ） */
function isTable(obj: Record<string, unknown>): boolean {
  const rows = dataEntries(obj).map(([, v]) => v);
  if (rows.length < TABLE_MIN_ROWS || !rows.every(isContainer)) return false;
  const union = new Set<string>();
  let total = 0;
  for (const row of rows) {
    const keys = isPlainObject(row) ? Object.keys(row).filter((k) => !isMetaKey(k)) : [ARRAY_MARK];
    total += keys.length;
    for (const k of keys) union.add(k);
  }
  return total > 0 && union.size <= total * TABLE_OVERLAP_RATIO;
}

export interface DictEntry {
  /** ブロックからの相対の表示 path（`*.windup` / `steps[].scaling`） */
  path: string;
  description: string | undefined;
}

export interface DictSection {
  /** `weapons/WEAPON` のような JSON の置き場所 */
  title: string;
  note: string | undefined;
  entries: DictEntry[];
}

/** _note の最初の文（長ければ切る） */
function firstSentence(note: unknown): string | undefined {
  if (typeof note !== "string" || note.trim() === "") return undefined;
  const end = note.indexOf("。");
  const head = end >= 0 ? note.slice(0, end + 1) : note;
  return head.length > NOTE_MAX_CHARS ? `${head.slice(0, NOTE_MAX_CHARS)}…` : head;
}

/**
 * 1 ブロックの葉を集める。segs は説明を引く実際のキー列（root から）、shown は表示 path の部品。
 * 親のオブジェクト名の説明（`resist`）で足りる葉は親の 1 行にまとめる
 */
function collect(
  root: Json,
  value: Json,
  segs: readonly string[],
  shown: readonly string[],
  coveredBy: string | undefined,
  out: Map<string, string | undefined>,
): void {
  const push = (description: string | undefined): void => {
    const key = shown.join(".").replace(/\.\[\]/g, ARRAY_MARK);
    if (!out.has(key) || (out.get(key) === undefined && description !== undefined)) out.set(key, description);
  };
  if (Array.isArray(value)) {
    if (!value.some(isContainer)) {
      push(fieldDescription(root, segs));
      return;
    }
    for (const el of value) collect(root, el, segs, [...shown, ARRAY_MARK], coveredBy, out);
    return;
  }
  if (!isPlainObject(value)) {
    const description = fieldDescription(root, segs);
    if (description !== undefined && description === coveredBy) return;
    push(description);
    return;
  }
  const own = segs.length > 0 ? fieldDescription(root, segs) : undefined;
  let covered = coveredBy;
  if (own !== undefined && own !== coveredBy) {
    push(own);
    covered = own;
  }
  if (isTable(value)) {
    for (const [key, row] of dataEntries(value)) collect(root, row, [...segs, key], [...shown, ROW_MARK], covered, out);
    return;
  }
  for (const [key, child] of dataEntries(value)) collect(root, child, [...segs, key], [...shown, key], covered, out);
}

/**
 * 説明が同じで段数と末尾の名前が同じ項目を 1 行にまとめ、食い違う段を `*` にする。
 * 形が奥義ごとに違う表（ultimates の defs）は表として畳めないため、同じ説明の行がずらりと並ぶのを防ぐ
 */
function mergeSameDescription(entries: readonly DictEntry[]): DictEntry[] {
  const groups = new Map<string, string[][]>();
  const order: string[] = [];
  const keyOf = (e: DictEntry, segs: readonly string[]): string =>
    e.description === undefined ? `?${e.path}` : `${segs.length}\u0000${segs[segs.length - 1] ?? ""}\u0000${e.description}`;
  for (const e of entries) {
    const segs = e.path.split(".");
    const key = keyOf(e, segs);
    const group = groups.get(key);
    if (group) group.push(segs);
    else {
      groups.set(key, [segs]);
      order.push(key);
    }
  }
  const byPath = new Map(entries.map((e) => [e.path, e.description]));
  const out: DictEntry[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    const group = groups.get(key) ?? [];
    const first = group[0] ?? [];
    const path = first.map((seg, i) => (group.every((g) => g[i] === seg) ? seg : ROW_MARK)).join(".");
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, description: byPath.get(first.join(".")) });
  }
  return out;
}

/** 最上位のディレクトリ 1 つ（combat など）をブロックごとの節にする */
export function buildSections(dir: string, root: Json): DictSection[] {
  if (!isPlainObject(root)) return [];
  const sections: DictSection[] = [];
  const loose = new Map<string, string | undefined>();
  for (const [block, value] of dataEntries(root)) {
    if (!isContainer(value)) {
      collect(root, value, [block], [block], undefined, loose);
      continue;
    }
    const out = new Map<string, string | undefined>();
    const note = isPlainObject(value) ? firstSentence(value._note) : undefined;
    collect(root, value, [block], [], undefined, out);
    sections.push({ title: `${dir}/${block}`, note, entries: mergeSameDescription([...out].map(([path, description]) => ({ path, description }))) });
  }
  if (loose.size > 0) {
    const note = firstSentence(root._note);
    sections.unshift({ title: `${dir}/_index.json`, note, entries: [...loose].map(([path, description]) => ({ path, description })) });
  }
  return sections;
}

/** 表のセルで崩れる文字を逃がす */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** 辞書の Markdown 全体 */
export function renderDictionary(dirs: readonly (readonly [string, Json])[]): string {
  const sections = dirs.flatMap(([dir, root]) => buildSections(dir, root));
  const total = sections.reduce((n, s) => n + s.entries.length, 0);
  const missing = sections.reduce((n, s) => n + s.entries.filter((e) => e.description === undefined).length, 0);
  const lines = [
    "# バランス数値の辞書",
    "",
    "<!-- 自動生成（npm run balance:dict）。手で直さない。説明は各 JSON の _fields を直してから生成し直す -->",
    "",
    "`src/data/balance/` の JSON の各項目が何に効くかの一覧。説明の正は各 JSON の `_fields`（書き方は `docs/BALANCE.md`「項目の意味を読む / 書く」）。",
    "",
    "- 節の見出し `weapons/WEAPON` は `src/data/balance/weapons/WEAPON/`（ディレクトリ）か `….json`（ファイル）",
    `- \`${ROW_MARK}\` は同じ形の行が並ぶ表の行（敵の key・武器種など）、\`${ARRAY_MARK}\` は配列の各要素（\`_id\` で探す）`,
    "- オブジェクト名だけの行（`resist` など）は、その中の項目すべてに効く",
    `- ${UNDOCUMENTED} は \`_fields\` に説明がまだ無い項目`,
    "",
    `項目 ${total}（うち${UNDOCUMENTED} ${missing}）`,
    "",
  ];
  for (const s of sections) {
    lines.push(`## ${s.title}`, "");
    if (s.note) lines.push(cell(s.note), "");
    lines.push("| 項目 | 意味 |", "| --- | --- |");
    for (const e of s.entries) lines.push(`| \`${e.path}\` | ${cell(e.description ?? UNDOCUMENTED)} |`);
    lines.push("");
  }
  return lines.join("\n");
}
