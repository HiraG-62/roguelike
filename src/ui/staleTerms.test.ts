import { describe, expect, it } from "vitest";

/**
 * 表示文字列の旧用語（docs/GLOSSARY.md。2026-09-25 に奥義へ改めた語）。
 * 資料側は scripts/audit-agent-docs.mjs の STALE_TERMS が見るので、ここは src の文字列リテラルだけを見る。
 * コメントは内部の説明（「旧バースト」など）なので対象外
 */
const STALE_UI_TERMS = ["バースト", "必殺ゲージ", "固有技"] as const;

/** 本体の .ts（テストを除く）の中身 */
const SOURCES = import.meta.glob<string>(["../**/*.ts", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true });

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** 行コメント（直前が文字列の区切りや : でないもの。URL の // を残す） */
const LINE_COMMENT = /(^|[^:"'`])\/\/[^\n]*/g;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/** コメントを消し、行番号が変わらないよう改行だけ残す */
function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, (m) => m.replace(/[^\n]/g, "")).replace(LINE_COMMENT, "$1");
}

function staleHits(path: string, text: string): string[] {
  const code = stripComments(text);
  const hits: string[] = [];
  for (const m of code.matchAll(STRING_LITERAL)) {
    const term = STALE_UI_TERMS.find((t) => m[0].includes(t));
    if (term === undefined) continue;
    const line = code.slice(0, m.index).split("\n").length;
    hits.push(`${path}:${line} 「${term}」`);
  }
  return hits;
}

describe("表示文字列の用語", () => {
  it("本体のソースを読めている", () => {
    expect(Object.keys(SOURCES).length, "src の .ts").toBeGreaterThan(100);
  });

  it("表示文字列に バースト / 必殺ゲージ / 固有技 が残っていない（audit:docs の旧用語）", () => {
    const hits = Object.entries(SOURCES).flatMap(([path, text]) => staleHits(path, text));
    expect(hits, "奥義 / 奥義ゲージ / 攻撃 2（右）に直す（docs/GLOSSARY.md）").toEqual([]);
  });
});
