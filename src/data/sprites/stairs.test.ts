import { describe, expect, it } from "vitest";
import { MAP_PROP_CLEAR, MAP_PROP_ROLES } from "./mapProps";
import { STAIRS_DOTS, STAIRS_ROLES, STAIRS_SPRITES, type StairsSprite } from "./stairs";
import { TOWN_PROP_ROLES } from "./townProps";

const OUTLINE = "k";
const STYLES = ["moss", "temple", "castleFire", "castleFrost", "deep", "final"] as const;
const entries = Object.entries(STAIRS_SPRITES) as [string, StairsSprite][];

function at(rows: readonly string[], x: number, y: number): string {
  return rows[y]?.[x] ?? MAP_PROP_CLEAR;
}

describe("stairs: 下りの階段の章別の絵", () => {
  it("迷宮の様式すべてに絵がある（拠点は今の絵のまま）", () => {
    expect(Object.keys(STAIRS_SPRITES).sort()).toEqual([...STYLES].sort());
  });

  it("1 マス（32x32 ドット）に収まり、透明だけの絵は無い", () => {
    for (const [key, s] of entries) {
      expect(s.rows.length, `${key} の高さ`).toBe(STAIRS_DOTS);
      for (const row of s.rows) expect(row.length, `${key} の行の幅`).toBe(STAIRS_DOTS);
      expect(s.rows.some((r) => /[^.]/.test(r)), `${key} が空`).toBe(true);
    }
  });

  it("文字は透明か階段の役の文字だけ", () => {
    const roles = new Set(Object.keys(STAIRS_ROLES));
    for (const [key, s] of entries) {
      for (const ch of s.rows.join("")) {
        if (ch !== MAP_PROP_CLEAR) expect(roles.has(ch), `${key} の文字 '${ch}' が役の表に無い`).toBe(true);
      }
    }
  });

  it("輪郭が閉じている（透明に接する画素は k だけ）", () => {
    for (const [key, s] of entries) {
      s.rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === MAP_PROP_CLEAR || ch === OUTLINE) return;
          const near = [at(s.rows, x - 1, y), at(s.rows, x + 1, y), at(s.rows, x, y - 1), at(s.rows, x, y + 1)];
          expect(near.includes(MAP_PROP_CLEAR), `${key} の (${x},${y}) '${ch}' が透明に接する`).toBe(false);
        });
      });
    }
  });

  it("どの章も底に奥の闇（z）があり、マスの中心が透明でない（階段の光と出口の予告がマスの中心に乗る）", () => {
    const c = STAIRS_DOTS / 2;
    for (const [key, s] of entries) {
      expect(s.rows.join("").includes("z"), `${key} に奥の闇`).toBe(true);
      expect(at(s.rows, c, c), `${key} の中心`).not.toBe(MAP_PROP_CLEAR);
    }
  });

  it("置物の役はそのまま引き継ぎ、足した役（y / z）は置物にも門前町の役にも無い文字", () => {
    for (const [ch, role] of Object.entries(MAP_PROP_ROLES)) expect(STAIRS_ROLES[ch as keyof typeof STAIRS_ROLES], `役 ${ch}`).toEqual(role);
    for (const ch of ["y", "z"]) {
      expect(ch in MAP_PROP_ROLES, `${ch} が置物の役と重なる`).toBe(false);
      expect(ch in TOWN_PROP_ROLES, `${ch} が門前町の役と重なる`).toBe(false);
    }
  });
});
