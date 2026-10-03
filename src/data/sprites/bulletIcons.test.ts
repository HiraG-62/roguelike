import { describe, expect, it } from "vitest";
import { BASES, baseFamily } from "../../loot/bases";
import { PALETTE } from "../sprites";
import { BULLET_ICON_KEYS, BULLET_ICON_SPRITES } from "./bulletIcons";
import { SPRITE_DOTS } from "./dots";

/** 弾のアイコンの寸法（ドット）。論理 24x14 を密度 2 で描く */
const ICON_W = 48;
const ICON_H = 28;
const ICON_DOTS = 2;
const PREFIX = "bulletIcon.";

describe("銃の器の弾のアイコン", () => {
  const gunBases = BASES.filter((b) => baseFamily(b) === "gun");

  it("銃の家系の器すべてにアイコンがあり、余分なキーが無い", () => {
    const expected = gunBases.map((b) => `${PREFIX}${b.key}`).sort();
    expect([...BULLET_ICON_KEYS].sort()).toEqual(expected);
  });

  it.each(BULLET_ICON_KEYS.map((k) => [k]))("%s は 48x28 の 1 フレームで、PALETTE の文字だけを使い、密度 2 で登録されている", (key) => {
    const frames = BULLET_ICON_SPRITES[key] ?? [];
    expect(frames.length).toBe(1);
    const frame = frames[0] ?? [];
    expect(frame.length).toBe(ICON_H);
    for (const row of frame) {
      expect(row.length).toBe(ICON_W);
      for (const ch of row) if (ch !== ".") expect(ch in PALETTE, `${key} の ${ch}`).toBe(true);
    }
    expect(frame.some((row) => row.replaceAll(".", "").length > 0)).toBe(true);
    expect(SPRITE_DOTS[key]).toBe(ICON_DOTS);
  });
});
