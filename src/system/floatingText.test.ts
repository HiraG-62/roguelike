import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 浮き文字（状態表示）は名詞・体言止め（docs/GLOSSARY.md「表示文字列の書き方」）。
 * 資料を読まずに文の形（「奥義が終わった」「鎧が砕けた」）で足しても、ここで落ちるようにする
 */

const ROOT = join(__dirname, "..", "..");
/** 浮き文字を出すロジックの置き場所 */
const SCAN_DIRS = ["src/system", "src/skills"];
/** addFloatingText に直接渡した文字列 */
const FLOAT_LITERAL = /addFloatingText\([^;]*?"([^"]+)"/g;
/** 浮き文字に渡す定数（XXX_TEXT） */
const TEXT_CONST = /const [A-Z_]*TEXT = "([^"]+)"/g;
/** 文の終わり（動詞の過去・終止形、断定、否定、です・ます） */
const SENTENCE_END = /(た|だ|る|ない|ます|です)[!！。]?$/;
/** 体言止めにしないもの。足すときは理由を書く */
const ALLOW = new Set([
  // ボスの台詞（フレーバーは雰囲気を残してよい）
  "手下ども、出番だ",
  // 迫る脅威の予告。今の状態ではなく、これから起きることの警告
  "死神が来る",
  "狙われている",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".test.ts"))
    .map((d) => join(d.parentPath, d.name));
}

function sentenceTexts(): string[] {
  const found: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      for (const re of [FLOAT_LITERAL, TEXT_CONST]) {
        for (const m of src.matchAll(re)) {
          const text = m[1];
          if (text === undefined || ALLOW.has(text) || !SENTENCE_END.test(text)) continue;
          found.push(`${relative(ROOT, file)}: 「${text}」`);
        }
      }
    }
  }
  return found;
}

describe("浮き文字の表記", () => {
  it("状態の浮き文字は文にせず体言止めにする（奥義終了・鎧破壊 など）", () => {
    expect(sentenceTexts(), "GLOSSARY の「状態表示は名詞・体言止め」に直す").toEqual([]);
  });
});
