import { describe, expect, it } from "vitest";
import type { Sprite, SpriteAtlas } from "../render/sprites";
import { mergeAtlas } from "../render/sprites";
import { hubSpriteKey } from "../render/hubUi";
import { HUB_SPOT_KEYS } from "../map/hubMap";
import { propSpriteKey } from "../render/runUi";
import {
  BIOME_TILESET,
  DERIVED_SPRITES,
  SHEETS,
  SHEET_SIZE,
  TILE_SPRITES,
  WALL_MASK_COUNT,
  biomeTileSuffixes,
  punyWallCell,
} from "./tiles";

const sourceKeys = new Set(TILE_SPRITES.map((d) => d.key));
const allKeys = new Set([...sourceKeys, ...DERIVED_SPRITES.map((d) => d.key)]);

describe("TILE_SPRITES", () => {
  it("キーは重複しない（派生スプライトを含めて）", () => {
    const keys = [...TILE_SPRITES.map((d) => d.key), ...DERIVED_SPRITES.map((d) => d.key)];
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
});

describe("BIOME_TILESET（拠点だけ）", () => {
  it("拠点の組だけを持つ（迷宮の床・壁は焼き付けが描く）", () => {
    expect(Object.keys(BIOME_TILESET), "拠点だけ").toEqual(["hub"]);
  });

  it("拠点に床と壁 16 種の派生がある", () => {
    expect(biomeTileSuffixes().length, "床 1 + 壁 16").toBe(1 + WALL_MASK_COUNT);
    for (const suffix of biomeTileSuffixes()) expect(allKeys.has(`tile.hub.${suffix}`), `hub の ${suffix}`).toBe(true);
  });

  it("拠点の素材の組は床と壁 16 種を切り出している", () => {
    const source = BIOME_TILESET.hub.source;
    for (const suffix of biomeTileSuffixes()) expect(sourceKeys.has(`tile.${source}.${suffix}`), `${source} の ${suffix}`).toBe(true);
  });

  it("迷宮のバイオームの派生・下水の水面・封鎖の扉の素材は持たない", () => {
    const stale = [...allKeys].filter((k) => /^tile\.(?!puny\.|hub\.)/.test(k) || k.startsWith("terrain.") || k === "door");
    expect(stale, "捨てたはずのキー").toEqual([]);
  });
});

describe("DERIVED_SPRITES", () => {
  it("派生元はすべて切り出し表にある", () => {
    for (const d of DERIVED_SPRITES) expect(sourceKeys.has(d.from), `${d.key} の元 ${d.from}`).toBe(true);
  });
});

describe("拠点の設備", () => {
  it("全設備に素材がある", () => {
    for (const spot of HUB_SPOT_KEYS) expect(sourceKeys.has(hubSpriteKey(spot)), spot).toBe(true);
  });
});

describe("台座", () => {
  it("切り出し表の prop.* は propSpriteKey で引けるキーと一致する", () => {
    const kinds = ["keystone", "rune", "lever", "anvil", "exchange", "curse", "chest", "ascend", "vein", "seal", "element", "inverter"] as const;
    for (const kind of kinds) expect(sourceKeys.has(propSpriteKey({ kind })), kind).toBe(true);
  });
});

describe("punyWallCell", () => {
  it("16 通りのマスクが 4x4 の別々のマスに割り当たる", () => {
    const cells = new Set<string>();
    for (let mask = 0; mask < WALL_MASK_COUNT; mask++) {
      const { col, row } = punyWallCell(mask);
      expect(col >= 0 && col < 4 && row >= 0 && row < 4, `mask ${mask}`).toBe(true);
      cells.add(`${col},${row}`);
    }
    expect(cells.size, "重なるマスがある").toBe(WALL_MASK_COUNT);
  });

  it("四方が壁なら中央、四方が床なら孤立、南だけ床なら手前面の段", () => {
    expect(punyWallCell(0)).toEqual({ col: 2, row: 1 });
    expect(punyWallCell(15)).toEqual({ col: 0, row: 3 });
    expect(punyWallCell(4)).toEqual({ col: 2, row: 2 });
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
