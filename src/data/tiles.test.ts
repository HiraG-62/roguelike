import { describe, expect, it } from "vitest";
import type { Sprite, SpriteAtlas } from "../render/sprites";
import { mergeAtlas } from "../render/sprites";
// 循環 import（keywords → roomTypes → biomes）を踏まないよう、全体の入口を先に読む
import "../core/game";
import { propSpriteKey } from "../render/runUi";
import { SHEETS, SHEET_SIZE, TILE_SPRITES } from "./tiles";

const sourceKeys = new Set(TILE_SPRITES.map((d) => d.key));

describe("TILE_SPRITES", () => {
  it("キーは重複しない", () => {
    const keys = TILE_SPRITES.map((d) => d.key);
    expect(new Set(keys).size, "重複したキーがある").toBe(keys.length);
  });

  it("矩形は 16 の倍数", () => {
    for (const def of TILE_SPRITES) {
      expect(def.x % 16, `${def.key} x`).toBe(0);
      expect(def.y % 16, `${def.key} y`).toBe(0);
      expect(def.w % 16, `${def.key} w`).toBe(0);
      expect(def.h % 16, `${def.key} h`).toBe(0);
    }
  });

  it("全フレームの矩形がシートの実寸に収まる", () => {
    for (const def of TILE_SPRITES) {
      const size = SHEET_SIZE[def.sheet];
      const frames = def.frames ?? 1;
      expect(def.x + def.w * frames, `${def.key} が右にはみ出す`).toBeLessThanOrEqual(size.w);
      expect(def.y + def.h, `${def.key} が下にはみ出す`).toBeLessThanOrEqual(size.h);
    }
  });

  it("読み込むシート（SHEETS）に載っているものだけを使う", () => {
    const loaded = new Set(SHEETS.map((s) => s.key));
    for (const def of TILE_SPRITES) expect(loaded.has(def.sheet), `${def.key} のシート ${def.sheet} を読まない`).toBe(true);
  });

  it("URL は先頭に / を付けない（file:// でも index.html からの相対で引ける）", () => {
    for (const sheet of SHEETS) expect(sheet.url.startsWith("/"), sheet.url).toBe(false);
  });

  it("床・壁・拠点の設備の素材は持たない（迷宮は焼き付け、門前町は手続きで描く）", () => {
    const stale = [...sourceKeys].filter((k) => k.startsWith("tile.") || k.startsWith("hub.") || k.startsWith("terrain.") || k === "door");
    expect(stale, "捨てたはずのキー").toEqual([]);
  });
});

describe("台座", () => {
  it("切り出し表の prop.* は propSpriteKey で引けるキーと一致する", () => {
    const kinds = ["keystone", "rune", "lever", "anvil", "exchange", "curse", "chest", "ascend", "vein", "seal", "element", "inverter"] as const;
    for (const kind of kinds) expect(sourceKeys.has(propSpriteKey({ kind })), kind).toBe(true);
  });
});

describe("mergeAtlas", () => {
  const fake = (): Sprite => ({ frames: [], white: [], w: 16, h: 16 });

  it("同名キーを上書きし、無いキーは残す", () => {
    const base: SpriteAtlas = { floor: fake(), wall: fake() };
    const over: SpriteAtlas = { floor: fake() };
    const merged = mergeAtlas(base, over);
    expect(merged.floor).toBe(over.floor);
    expect(merged.wall).toBe(base.wall);
  });
});
