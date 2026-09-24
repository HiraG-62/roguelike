/**
 * バランス数値(JSON)の実行時検査。範囲(負の hp など)は見ない。
 * 各領域の固定値テスト(system/mana.test.ts など)が既に範囲を守っており、ここに範囲チェックを足すと
 * 領域ごとの例外が増えて嘘になる(docs/ideas/data-externalization.md 4.2)
 */

export interface BalanceIssue {
  path: string;
  message: string;
}

const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 汎用検査: 数値は有限、null 禁止、_note は文字列、空オブジェクト禁止、キーは識別子(英数と _) */
export function validateBalanceShape(root: unknown, file: string): BalanceIssue[] {
  const issues: BalanceIssue[] = [];
  walk(root, file, issues);
  return issues;
}

function walk(value: unknown, path: string, issues: BalanceIssue[]): void {
  if (value === null) {
    issues.push({ path, message: "null は禁止" });
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push({ path, message: "有限数でない" });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, issues));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      issues.push({ path, message: "空オブジェクトは禁止" });
      return;
    }
    for (const key of keys) {
      if (key === "_note") {
        if (typeof value[key] !== "string") issues.push({ path: `${path}._note`, message: "_note は文字列であること" });
        continue;
      }
      // _fields の key はドット表記を許すので識別子の検査に掛けない（形は validateFieldDocs が見る）
      if (key === FIELD_DOCS_KEY) continue;
      if (!IDENTIFIER_RE.test(key)) issues.push({ path: `${path}.${key}`, message: "キーは英数と _ のみ" });
      walk(value[key], `${path}.${key}`, issues);
    }
    return;
  }
  // string / boolean はそのまま許可(union 文字列・色・フラグは TS 側の型が絞る)
}

/** 表同士のキー集合が一致するか(JSON 側の余分・TS 側の余分の両方を報告) */
export function diffKeySets(label: string, jsonKeys: Iterable<string>, tsKeys: Iterable<string>): BalanceIssue[] {
  const jsonSet = new Set(jsonKeys);
  const tsSet = new Set(tsKeys);
  const issues: BalanceIssue[] = [];
  for (const key of jsonSet) if (!tsSet.has(key)) issues.push({ path: label, message: `JSON にあるが TS に無い key: ${key}` });
  for (const key of tsSet) if (!jsonSet.has(key)) issues.push({ path: label, message: `TS にあるが JSON に無い key: ${key}` });
  return issues;
}

// -----------------------------------------------------------------------------
// 項目の説明（_fields）。設計は docs/ideas/oop-migration.md 3 章
// -----------------------------------------------------------------------------

/** 項目の説明を置くキー。「項目名 → 説明」の文字列表。表では親に 1 回書き、子の行が引き継ぐ */
export const FIELD_DOCS_KEY = "_fields";

/** 説明の key: 識別子をドットでつないだもの（`swarm.min`） */
const FIELD_PATH_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

/** _ で始まるキー（_note / _fields）は数値の項目ではない */
function isMetaKey(key: string): boolean {
  return key.startsWith("_");
}

/**
 * obj 自身と子孫のどの行から見ても書ける相対 path の集合（配列の添字は落とす）。
 * 各節点の「obj からのキー列」の後ろ部分を全部入れれば、どの子孫の行から見た path も揃う
 */
function describablePaths(obj: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const visit = (value: unknown, segs: readonly string[]): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v, segs);
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (isMetaKey(key)) continue;
      const next = [...segs, key];
      for (let i = 0; i < next.length; i++) out.add(next.slice(i).join("."));
      visit(child, next);
    }
  };
  visit(obj, []);
  return out;
}

/** _fields の形: 文字列値のオブジェクト、空文字禁止、key は自分か子の行のどれかにある項目（無ければ stale） */
export function validateFieldDocs(root: unknown, file: string): BalanceIssue[] {
  const issues: BalanceIssue[] = [];
  visitObjects(root, file, (obj, path) => checkFieldDocs(obj, path, issues));
  return issues;
}

function checkFieldDocs(obj: Record<string, unknown>, path: string, issues: BalanceIssue[]): void {
  if (!(FIELD_DOCS_KEY in obj)) return;
  const docs = obj[FIELD_DOCS_KEY];
  const docsPath = `${path}.${FIELD_DOCS_KEY}`;
  if (!isPlainObject(docs) || Object.keys(docs).length === 0) {
    issues.push({ path: docsPath, message: "_fields は空でないオブジェクトであること" });
    return;
  }
  const known = describablePaths(obj);
  for (const [key, text] of Object.entries(docs)) {
    const at = `${docsPath}.${key}`;
    if (typeof text !== "string" || text.trim() === "") issues.push({ path: at, message: "説明は空でない文字列であること" });
    if (!FIELD_PATH_RE.test(key)) {
      issues.push({ path: at, message: "項目名は英数と _ をドットでつないだもの" });
      continue;
    }
    if (!known.has(key)) issues.push({ path: at, message: `兄弟にも子の行にも無い項目（stale）: ${key}` });
  }
}

/** 全オブジェクトを path 付きで訪れる（_ で始まるキーの中には入らない） */
function visitObjects(value: unknown, path: string, fn: (obj: Record<string, unknown>, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => visitObjects(v, `${path}[${i}]`, fn));
    return;
  }
  if (!isPlainObject(value)) return;
  fn(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (!isMetaKey(key)) visitObjects(child, `${path}.${key}`, fn);
  }
}

/** 祖先の _fields（持ち主の深さ = キー列の長さ） */
interface FieldScope {
  depth: number;
  docs: Readonly<Record<string, unknown>>;
}

function scopeOf(obj: Record<string, unknown>, depth: number): FieldScope | undefined {
  const docs = obj[FIELD_DOCS_KEY];
  return isPlainObject(docs) ? { depth, docs } : undefined;
}

/**
 * キー列 segs の項目の説明。内側の _fields ほど優先（行に置いた説明が親の説明を上書きする）。
 * 持ち主より下のどの行から見た相対 path でもよく、途中のオブジェクト名（`resist`）の説明はその下の葉全部に効く
 */
function lookupDescription(scopes: readonly FieldScope[], segs: readonly string[]): string | undefined {
  for (let s = scopes.length - 1; s >= 0; s--) {
    const scope = scopes[s];
    if (!scope) continue;
    // 葉そのものの説明を途中のオブジェクト名の説明より、長い（具体的な）path を短い path より優先する
    for (let j = segs.length; j > scope.depth; j--) {
      for (let i = scope.depth; i < j; i++) {
        const text = scope.docs[segs.slice(i, j).join(".")];
        if (typeof text === "string") return text;
      }
    }
  }
  return undefined;
}

/** 説明の無い数値・真偽の葉の path 一覧（祖先のどこかの _fields に無いもの。色などの文字列は対象外） */
export function undocumentedLeaves(root: unknown, file: string): string[] {
  const out: string[] = [];
  const visit = (value: unknown, path: string, segs: readonly string[], scopes: readonly FieldScope[]): void => {
    if (typeof value === "number" || typeof value === "boolean") {
      if (lookupDescription(scopes, segs) === undefined) out.push(path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`, segs, scopes));
      return;
    }
    if (!isPlainObject(value)) return;
    const own = scopeOf(value, segs.length);
    const inner = own ? [...scopes, own] : scopes;
    for (const [key, child] of Object.entries(value)) {
      if (!isMetaKey(key)) visit(child, `${path}.${key}`, [...segs, key], inner);
    }
  };
  visit(root, file, [], []);
  return out;
}

/**
 * root からキー列 segs（配列の添字は含めない）でたどった項目の説明。無ければ undefined。
 * 人が読む道具（将来の JSON Schema 生成など）とテストのための入口
 */
export function fieldDescription(root: unknown, segs: readonly string[]): string | undefined {
  const scopes: FieldScope[] = [];
  let node: unknown = root;
  for (let depth = 0; depth <= segs.length; depth++) {
    while (Array.isArray(node)) node = node[0];
    if (!isPlainObject(node)) break;
    const own = scopeOf(node, depth);
    if (own) scopes.push(own);
    const key = segs[depth];
    if (key === undefined) break;
    node = node[key];
  }
  return lookupDescription(scopes, segs);
}
