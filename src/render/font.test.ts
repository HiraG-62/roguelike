import { describe, expect, it } from "vitest";
import { UI_FONT_FAMILY, uiFont, wrapByWidth } from "./font";

describe("uiFont", () => {
  it("既定は bold で、サイズとフォント族を含む", () => {
    expect(uiFont(8)).toBe(`bold 8px ${UI_FONT_FAMILY}`);
  });

  it("太さを指定できる", () => {
    expect(uiFont(9, "normal")).toBe(`normal 9px ${UI_FONT_FAMILY}`);
  });

  it("日本語フォントを先頭側に含み sans-serif で終わる", () => {
    expect(UI_FONT_FAMILY.startsWith('"Noto Sans JP"')).toBe(true);
    expect(UI_FONT_FAMILY).toContain('"Yu Gothic UI"');
    expect(UI_FONT_FAMILY.endsWith("sans-serif")).toBe(true);
  });

  it("同じ引数なら同じ文字列を返す", () => {
    expect(uiFont(12)).toBe(uiFont(12));
  });
});

describe("wrapByWidth", () => {
  /** 1 文字 = 1 幅 */
  const measure = (s: string): number => [...s].length;

  it("英文は単語単位で折り返す", () => {
    expect(wrapByWidth("aa bb cc", 5, measure)).toEqual(["aa bb", "cc"]);
  });

  it("日本語は文字単位で折り返す", () => {
    expect(wrapByWidth("あいうえおか", 4, measure)).toEqual(["あいうえ", "おか"]);
  });

  it("句読点は行頭に置かない", () => {
    expect(wrapByWidth("あいうえ。お", 4, measure)).toEqual(["あいうえ。", "お"]);
  });

  it("1 単語が幅を超えても空行を作らない", () => {
    expect(wrapByWidth("abcdefg hi", 3, measure)).toEqual(["abcdefg", "hi"]);
  });

  it("空文字は空配列", () => {
    expect(wrapByWidth("", 10, measure)).toEqual([]);
  });
});
