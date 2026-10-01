import { describe, expect, it } from "vitest";
import { MAP_PROP_CLEAR, MAP_PROP_ROLES, MAP_PROP_SPRITES, type MapPropSprite, isMapPropSpriteKind } from "./mapProps";

const OUTLINE = "k";
/** 地面から浮く置物（足元が絵より下） */
const FLOATING = new Set(["orb"]);
const HEX = /^#[0-9a-f]{6}$/;

const entries = Object.entries(MAP_PROP_SPRITES) as [string, MapPropSprite][];

function at(rows: readonly string[], x: number, y: number): string {
  return rows[y]?.[x] ?? MAP_PROP_CLEAR;
}

describe("mapProps: 置物の絵", () => {
  it("全行が同じ幅で、透明だけの絵は無い", () => {
    for (const [key, s] of entries) {
      const w = s.rows[0]?.length ?? 0;
      expect(w, `${key} の幅`).toBeGreaterThan(0);
      for (const row of s.rows) expect(row.length, `${key} の行の幅`).toBe(w);
      expect(s.rows.some((r) => /[^.]/.test(r)), `${key} が空`).toBe(true);
    }
  });

  it("文字は透明か役の文字だけ", () => {
    const roles = new Set(Object.keys(MAP_PROP_ROLES));
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

  it("足元は絵の幅の内で、置く物は最下段のすぐ下・浮く物はそれより下", () => {
    for (const [key, s] of entries) {
      const [ax, ay] = s.anchor;
      expect(ax, `${key} の足元 x`).toBeGreaterThanOrEqual(0);
      expect(ax, `${key} の足元 x`).toBeLessThan(s.rows[0]?.length ?? 0);
      if (FLOATING.has(key)) expect(ay, `${key} の足元 y`).toBeGreaterThan(s.rows.length);
      else expect(ay, `${key} の足元 y`).toBe(s.rows.length);
      expect(/[^.]/.test(s.rows[s.rows.length - 1] ?? ""), `${key} の最下段が空`).toBe(true);
      expect(s.shadow, `${key} の影`).toBeGreaterThanOrEqual(0);
    }
  });

  it("光の中心は光る役の画素の上にある", () => {
    const lit = new Set(["Y", "L", "l"]);
    const withLight = entries.filter(([, s]) => s.light);
    expect(withLight.map(([k]) => k).sort()).toEqual(["andon", "brazier", "crystal", "hokora", "lantern", "mush", "orb"]);
    for (const [key, s] of withLight) {
      const [lx, ly] = s.light ?? [0, 0];
      expect(lit.has(at(s.rows, lx, ly)), `${key} の光 (${lx},${ly}) が '${at(s.rows, lx, ly)}'`).toBe(true);
    }
  });

  it("役の色は MapPalette のキーか固定色で、寄せは -1..1", () => {
    for (const [ch, role] of Object.entries(MAP_PROP_ROLES)) {
      if (role.from.startsWith("#")) expect(role.from, `役 ${ch}`).toMatch(HEX);
      expect(Math.abs(role.shade), `役 ${ch} の寄せ`).toBeLessThanOrEqual(1);
    }
  });

  it("絵で描く置物と手続きで描く置物を見分ける", () => {
    expect(isMapPropSpriteKind("lantern")).toBe(true);
    expect(isMapPropSpriteKind("torii")).toBe(true);
    expect(isMapPropSpriteKind("pillar")).toBe(false);
    expect(isMapPropSpriteKind("stone")).toBe(false);
    expect(isMapPropSpriteKind("spear")).toBe(false);
  });
});
