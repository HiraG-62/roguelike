import { describe, expect, it } from "vitest";
import { TOWN_PROPS, TOWN_PROP_CLEAR, TOWN_PROP_OUTLINE, TOWN_PROP_ROLES } from "../data/sprites/townProps";
import { TILE_SIZE } from "../map/grid";
import { HUB_LOT_KEYS } from "../map/hubMap";
import { MAP_DOTS } from "./mapTypes";
import { TOWN_LOT_TILES, type TownObjectKind, townObjectGlows, townObjectPixels } from "./townArt";

const TILE_DOTS = TILE_SIZE * MAP_DOTS;

const LOT_KINDS: TownObjectKind[] = HUB_LOT_KEYS.flatMap((lot) => [
  { type: "lot", lot, built: true },
  { type: "lot", lot, built: false },
]);

/** 全種（範囲外の段・章・位階・番号も含めて、例外なく描けるかを見る） */
const ALL_KINDS: TownObjectKind[] = [
  ...LOT_KINDS,
  ...[-1, 0, 1, 2, 3, 9].map((tier): TownObjectKind => ({ type: "well", tier })),
  { type: "torii" },
  { type: "lantern" },
  ...[0, 1, 2, 3, 4, 7].map((chapter): TownObjectKind => ({ type: "trophy", chapter })),
  ...[0, 1, 4, 5, 10, 15, 20, 99].map((tier): TownObjectKind => ({ type: "stele", tier })),
  ...[-1, 0, 1, 2, 3, 4, 5, 6, 13].map((index): TownObjectKind => ({ type: "clutter", index })),
];

function label(k: TownObjectKind): string {
  return JSON.stringify(k);
}

function opaqueCount(px: Uint32Array): number {
  let n = 0;
  for (const v of px) if (v !== 0) n++;
  return n;
}

function samePixels(a: Uint32Array, b: Uint32Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

describe("門前町の絵（townObjectPixels）", () => {
  it("全種が例外なく描け、寸法と anchor が範囲内で、透明でない画素がある", () => {
    for (const k of ALL_KINDS) {
      const p = townObjectPixels(k);
      expect(p.w, label(k)).toBeGreaterThan(0);
      expect(p.h, label(k)).toBeGreaterThan(0);
      expect(p.pixels.length, label(k)).toBe(p.w * p.h);
      expect(p.anchor.x, label(k)).toBeGreaterThanOrEqual(0);
      expect(p.anchor.x, label(k)).toBeLessThanOrEqual(p.w);
      expect(p.anchor.y, label(k)).toBe(p.h);
      expect(opaqueCount(p.pixels), label(k)).toBeGreaterThan(0);
    }
  });

  it("同じ入力なら同じ画素", () => {
    for (const k of ALL_KINDS) expect(samePixels(townObjectPixels(k).pixels, townObjectPixels(k).pixels), label(k)).toBe(true);
  });

  it("敷地の絵は敷地の幅で、足元の中央が anchor。建つ前と後で寸法が同じ", () => {
    for (const lot of HUB_LOT_KEYS) {
      const built = townObjectPixels({ type: "lot", lot, built: true });
      const empty = townObjectPixels({ type: "lot", lot, built: false });
      const tiles = TOWN_LOT_TILES[lot];
      if (lot !== "well") expect(built.w, lot).toBe(tiles.w * TILE_DOTS);
      expect(built.h, lot).toBeGreaterThanOrEqual((tiles.h + 1) * TILE_DOTS);
      expect(built.anchor.x, lot).toBe(Math.round(built.w / 2));
      expect([empty.w, empty.h], lot).toEqual([built.w, built.h]);
    }
  });

  it("built true と false で絵が違う", () => {
    for (const lot of HUB_LOT_KEYS) {
      const a = townObjectPixels({ type: "lot", lot, built: true }).pixels;
      const b = townObjectPixels({ type: "lot", lot, built: false }).pixels;
      expect(samePixels(a, b), lot).toBe(false);
    }
  });

  it("井戸の 4 段・幟の 4 章・碑の位階の段はそれぞれ絵が違う", () => {
    const distinct = (kinds: TownObjectKind[]): number => new Set(kinds.map((k) => townObjectPixels(k).pixels.join(","))).size;
    expect(distinct([0, 1, 2, 3].map((tier) => ({ type: "well", tier })))).toBe(4);
    expect(distinct([1, 2, 3, 4].map((chapter) => ({ type: "trophy", chapter })))).toBe(4);
    expect(distinct([1, 5, 10, 15, 20].map((tier) => ({ type: "stele", tier })))).toBe(5);
  });
});

describe("門前町の灯（townObjectGlows）", () => {
  it("灯の位置は絵の中にある", () => {
    for (const k of ALL_KINDS) {
      const p = townObjectPixels(k);
      for (const g of townObjectGlows(k)) {
        expect(g.x, label(k)).toBeGreaterThanOrEqual(0);
        expect(g.x, label(k)).toBeLessThan(p.w);
        expect(g.y, label(k)).toBeGreaterThanOrEqual(0);
        expect(g.y, label(k)).toBeLessThan(p.h);
      }
    }
  });

  it("使える建物には提灯が灯り、建つ前の空き地には灯が無い", () => {
    const lanterned = HUB_LOT_KEYS.filter((lot) => lot !== "well" && lot !== "yard");
    for (const lot of lanterned) expect(townObjectGlows({ type: "lot", lot, built: true }).some((g) => g.kind === "lantern"), lot).toBe(true);
    for (const lot of HUB_LOT_KEYS) expect(townObjectGlows({ type: "lot", lot, built: false }), lot).toEqual([]);
  });

  it("記録の蔵は窓が 5 つ（描画レーンが archiveLights 個だけ灯す）、鳥居は石段の奥に灯の位置を持つ", () => {
    expect(townObjectGlows({ type: "lot", lot: "archive", built: true }).filter((g) => g.kind === "window")).toHaveLength(5);
    expect(townObjectGlows({ type: "torii" }).filter((g) => g.kind === "gate")).toHaveLength(1);
  });
});

describe("設備の印と小物の手描き（townProps）", () => {
  const roles = new Set(Object.keys(TOWN_PROP_ROLES));
  const fill = (ch: string | undefined): boolean => ch !== undefined && ch !== TOWN_PROP_CLEAR && ch !== TOWN_PROP_OUTLINE;

  it("全行が同じ幅で、文字はすべて役の文字か透明", () => {
    for (const [key, sp] of Object.entries(TOWN_PROPS)) {
      expect(sp.rows.length, key).toBe(sp.h);
      for (const row of sp.rows) {
        expect(row.length, key).toBe(sp.w);
        for (const ch of row) expect(ch === TOWN_PROP_CLEAR || roles.has(ch), `${key} の '${ch}'`).toBe(true);
      }
      expect(sp.anchor[0], key).toBeLessThanOrEqual(sp.w);
      expect(sp.anchor[1], key).toBeLessThanOrEqual(sp.h);
    }
  });

  it("外周の輪郭 k が閉じている（塗りが透明に接していない）", () => {
    for (const [key, sp] of Object.entries(TOWN_PROPS)) {
      const at = (x: number, y: number): string => sp.rows[y]?.[x] ?? TOWN_PROP_CLEAR;
      for (let y = 0; y < sp.h; y++) {
        for (let x = 0; x < sp.w; x++) {
          if (!fill(at(x, y))) continue;
          const open = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n === TOWN_PROP_CLEAR);
          expect(open, `${key} (${x},${y})`).toBe(false);
        }
      }
    }
  });

  it("役の色は #rrggbb", () => {
    for (const [ch, hex] of Object.entries(TOWN_PROP_ROLES)) expect(hex, ch).toMatch(/^#[0-9a-f]{6}$/);
  });
});
