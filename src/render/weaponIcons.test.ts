import { describe, expect, it } from "vitest";
import { ACTOR_SHEETS } from "../data/actorSheets.gen";
import { MOVESET_KEYS } from "../data/weapons";
import { ACTOR_ART_SCALE } from "./actorSprites";
import { ICON_BOX_H, ICON_BOX_W, weaponIconSheetDir, weaponIconSize } from "./weaponIcons";

const BOX_DOTS_W = ICON_BOX_W * ACTOR_ART_SCALE;
const BOX_DOTS_H = ICON_BOX_H * ACTOR_ART_SCALE;
const RECT_STRIDE = 6;
/** 手に持つ絵がまだ無い武器種（render/actorSprites.test.ts の UNDRAWN_WEAPONS と同じ。カードは旧い絵で代わりに描く） */
const UNDRAWN: readonly string[] = ["kunai", "shuriken"];

describe("武器掛けのアイコン（手に持つ絵からの切り出し）", () => {
  it("全武器種に .held のシートがあり、向きの番号がシートの範囲に入る", () => {
    for (const moveset of MOVESET_KEYS) {
      const pick = weaponIconSheetDir(moveset);
      if (UNDRAWN.includes(moveset)) {
        expect(pick, `${moveset} は絵ができたので UNDRAWN から消す`).toBeUndefined();
        continue;
      }
      expect(pick, `${moveset} の .held のシート`).toBeDefined();
      if (!pick) continue;
      const sheet = ACTOR_SHEETS[pick.key];
      expect(sheet, `${pick.key} のシート定義`).toBeDefined();
      expect(pick.dir, `${moveset} の向き`).toBeGreaterThanOrEqual(0);
      expect(pick.dir, `${moveset} の向き`).toBeLessThan(sheet?.dirs ?? 0);
    }
  });

  it("選んだ向きの矩形がアイコン枠（44x26 論理 px = 88x52 ドット）に収まる", () => {
    for (const moveset of MOVESET_KEYS) {
      const pick = weaponIconSheetDir(moveset);
      const sheet = pick ? ACTOR_SHEETS[pick.key] : undefined;
      if (!pick || !sheet) continue;
      const i = pick.dir * sheet.frames * RECT_STRIDE;
      const w = sheet.rects[i + 2] ?? 0;
      const h = sheet.rects[i + 3] ?? 0;
      expect(w, `${moveset} の幅`).toBeGreaterThan(0);
      expect(w, `${moveset} の幅 ${w} ドット`).toBeLessThanOrEqual(BOX_DOTS_W);
      expect(h, `${moveset} の高さ ${h} ドット`).toBeLessThanOrEqual(BOX_DOTS_H);
    }
  });

  it("等倍の大きさはドットの 1 / ACTOR_ART_SCALE（縮小しない）", () => {
    expect(weaponIconSize({ w: 40, h: 26 }), "40x26 ドット").toEqual({ w: 20, h: 13 });
  });
});
