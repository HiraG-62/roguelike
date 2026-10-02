import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOAT_KANJI, WARM_GLYPHS } from "./warmGlyphs";

const ROOT = join(__dirname, "..", "..");
/** 浮き文字を出すロジックの置き場所（system/floatingText.test.ts と同じ走査） */
const SCAN_DIRS = ["src/system", "src/skills"];
const FLOAT_LITERAL = /addFloatingText\([^;]*?"([^"]+)"/g;
const TEXT_CONST = /const [A-Z_]*TEXT = "([^"]+)"/g;
/** 漢字（CJK 統合漢字） */
const KANJI = /[一-鿿]/u;

function floatTextChars(): Set<string> {
  const chars = new Set<string>();
  for (const dir of SCAN_DIRS) {
    const files = readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
      .filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".test.ts"))
      .map((d) => join(d.parentPath, d.name));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const re of [FLOAT_LITERAL, TEXT_CONST]) {
        for (const m of src.matchAll(re)) for (const ch of m[1] ?? "") chars.add(ch);
      }
    }
  }
  return chars;
}

describe("先に焼く字", () => {
  it("浮き文字の文字列に出る漢字はすべて FLOAT_KANJI にある", () => {
    const missing = [...floatTextChars()].filter((ch) => KANJI.test(ch) && !FLOAT_KANJI.includes(ch));
    expect(missing.join(""), "warmGlyphs.ts の FLOAT_KANJI に足す").toBe("");
  });

  it("浮き文字のかな・英数字・記号もすべて先に焼く字に入っている", () => {
    const missing = [...floatTextChars()].filter((ch) => !KANJI.test(ch) && !WARM_GLYPHS.includes(ch));
    expect(missing.join(""), "warmGlyphs.ts の SYMBOLS に足す").toBe("");
  });

  it("同じ字を二度並べない（焼く手間の無駄）", () => {
    const list = [...WARM_GLYPHS];
    expect(new Set(list).size).toBe(list.length);
  });
});
