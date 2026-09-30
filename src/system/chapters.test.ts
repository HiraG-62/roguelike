import { describe, expect, it } from "vitest";
import { ARC } from "../data/tuning";
import { chapterOf } from "./chapters";

/** 章立て（system/chapters.ts） */

describe("chapterOf", () => {
  it("深度 1〜5 は章 1、6〜10 は章 2", () => {
    expect([1, 5, 6, 10, 11, 16].map(chapterOf)).toEqual([1, 1, 2, 2, 3, 4]);
  });

  it("最後の章より深い階（深み）は最後の章のまま", () => {
    expect(chapterOf(ARC.floorsPerChapter * ARC.maxChapter + 1)).toBe(ARC.maxChapter);
    expect(chapterOf(99)).toBe(ARC.maxChapter);
  });

  it("深度 0 以下（拠点）は章 1", () => {
    expect(chapterOf(0)).toBe(1);
  });
});
