import { describe, expect, it } from "vitest";
import { enemyDef } from "../data/enemies";
import { ARC, HEAL } from "../data/tuning";
import { isBossDepth } from "./boss";
import { chapterBossKey, chapterOf, hasRestFountain, heartChanceOf, isChapterBossDepth, isChapterRest, skipsFloorLord } from "./chapters";

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

describe("章ボスと休符", () => {
  it("章ボスの階は 5 / 10 / 15 / 20 で、それ以外と深み（21 以降）は違う", () => {
    const bossDepths = Array.from({ length: 30 }, (_, i) => i + 1).filter(isChapterBossDepth);
    expect(bossDepths).toEqual([5, 10, 15, 20]);
    expect(isChapterBossDepth(0), "拠点").toBe(false);
  });

  it("章ボスは表どおり（5 スライム王 / 10 盗賊王 / 15 油壺の王 / 20 鏡の騎士）で、章ボスの階でなければ null", () => {
    expect([5, 10, 15, 20].map(chapterBossKey)).toEqual(["kingSlime", "thiefKing", "oilKing", "mirrorKnight"]);
    expect([1, 4, 6, 19, 21].map(chapterBossKey)).toEqual([null, null, null, null, null]);
    expect(chapterBossKey(25), "深みは回転（boss.ts）に任せる").toBeNull();
  });

  it("章ボスの階は階層ボスの階（BOSS.interval の倍数）と重なり、ARC の章ボスは実在の敵定義", () => {
    for (let depth = 1; depth <= ARC.floorsPerChapter * ARC.maxChapter; depth++) {
      if (!isChapterBossDepth(depth)) continue;
      expect(isBossDepth(depth), `深度 ${depth}`).toBe(true);
      expect(enemyDef(chapterBossKey(depth) ?? "").boss, `深度 ${depth}`).toBeTruthy();
    }
    expect(ARC.chapters).toHaveLength(ARC.maxChapter);
  });

  it("休符は章の 1 階目（6 / 11 / 16）。深度 1 と深み（21）は休符ではない", () => {
    const rests = Array.from({ length: 30 }, (_, i) => i + 1).filter(isChapterRest);
    expect(rests).toEqual([6, 11, 16]);
    expect(isChapterRest(1)).toBe(false);
    expect(isChapterRest(21)).toBe(false);
  });

  it("階の主を出さない階と泉を置く階は休符（フラグを切ると外れる）", () => {
    expect([5, 6, 7, 11].map(skipsFloorLord)).toEqual([false, true, false, true]);
    expect([5, 6, 7, 11].map(hasRestFountain)).toEqual([false, true, false, true]);
    const arc = ARC as { lordSkipFirstFloor: boolean; restFountain: boolean };
    const saved = { ...arc };
    try {
      arc.lordSkipFirstFloor = false;
      arc.restFountain = false;
      expect(skipsFloorLord(6)).toBe(false);
      expect(hasRestFountain(6)).toBe(false);
    } finally {
      Object.assign(arc, saved);
    }
  });
});

describe("heartChanceOf（章ごとのハートの確率）", () => {
  it("章 1〜4 で 0.1 / 0.08 / 0.06 / 0.04 と下がり、深みは最後の値のまま", () => {
    expect([1, 6, 11, 16].map(heartChanceOf)).toEqual(HEAL.heartChanceByChapter.slice(0, 4));
    expect(heartChanceOf(1)).toBeGreaterThan(heartChanceOf(16));
    expect(heartChanceOf(40)).toBe(heartChanceOf(16));
  });
});
