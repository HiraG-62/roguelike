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
