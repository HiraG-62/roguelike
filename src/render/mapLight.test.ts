import { describe, expect, it } from "vitest";
import { terrainCode } from "../core/terrain";
import { MAP_LIGHT } from "../data/tuning";
import { Tile, createMap, toIndex } from "../map/grid";
import type { GameMap } from "../map/grid";
import { ensureTerrainLayer, placeTerrain } from "../system/terrain";
import { arena } from "../system/testHelpers";
import {
  LIGHT_STEPS,
  LIGHT_Y_STRETCH,
  MapLightLayer,
  type LightView,
  buildStampPixels,
  mapDarkFor,
  mapLights,
  parseHexColor,
  stepRadiusRatios,
} from "./mapLight";
import { mapThemeFor } from "./mapTheme";
import type { MapLight } from "./mapTypes";

const VIEW: LightView = { x: 0, y: 0, w: 480, h: 270 };
const TILE = 16;

/** 全部を床にした地図に差し替えた state（プレイヤーは (200, 120)） */
function openState(width = 60, height = 40) {
  const state = arena(5);
  const map: GameMap = createMap(width, height);
  map.tiles.fill(Tile.Floor);
  state.map = map;
  state.player.body.pos.x = 200;
  state.player.body.pos.y = 120;
  ensureTerrainLayer(state);
  return state;
}

const THEME = mapThemeFor(3, "cave");

describe("章の暗さ（mapDarkFor）", () => {
  it("章 1 < 2 < 3 < 4 で、値は MAP_LIGHT.chapterDark と同じ", () => {
    const dark = (depth: number): number => mapThemeFor(depth, "cave").dark;
    expect(dark(1), "章 1").toBe(MAP_LIGHT.chapterDark[0]);
    expect(dark(6), "章 2").toBe(MAP_LIGHT.chapterDark[1]);
    expect(dark(11), "章 3").toBe(MAP_LIGHT.chapterDark[2]);
    expect(dark(16), "章 4").toBe(MAP_LIGHT.chapterDark[3]);
    expect(dark(1)).toBeLessThan(dark(6));
    expect(dark(6)).toBeLessThan(dark(11));
    expect(dark(11)).toBeLessThan(dark(16));
  });

  it("廃城の霜と炎は同じ暗さ", () => {
    expect(mapDarkFor("castleFrost", 11), "霜").toBe(mapDarkFor("castleFire", 11));
  });

  it("最深の間は finalDark、深みは deepDark（章 4 とはテーマの key も分かれる）", () => {
    expect(mapDarkFor("final", 21), "最深の間").toBe(MAP_LIGHT.finalDark);
    expect(mapDarkFor("deep", 22), "深み").toBe(MAP_LIGHT.deepDark);
    expect(mapDarkFor("deep", 16), "章 4").toBe(MAP_LIGHT.chapterDark[3]);
    expect(mapThemeFor(16, "cave").key, "章 4 と深みで同じテーマを共有しない").not.toBe(mapThemeFor(22, "cave").key);
    expect(mapThemeFor(21, "cave").dark, "最深の間は章 4 より明るい").toBeLessThan(mapThemeFor(16, "cave").dark);
  });
});

describe("段つきの円", () => {
  it("強さ 0.55 は 0.12 と 0.38 の 2 段だけ抜け、0.7 の段は出ない。0.12 以下は何も抜けない", () => {
    const ratios = stepRadiusRatios(0.55);
    expect(ratios[0], "外の段").toBeGreaterThan(ratios[1] ?? 0);
    expect(ratios[1], "中の段").toBeGreaterThan(0);
    expect(ratios[2], "内の段は強さが足りない").toBe(0);
    expect(stepRadiusRatios(0.12).every((r) => r === 0), "閾値ちょうど以下").toBe(true);
    expect(stepRadiusRatios(1).every((r) => r > 0), "強さ 1 は 3 段とも").toBe(true);
  });

  it("画素の alpha は 段の量（1/3・2/3・1）だけで、中心ほど濃く、半径の外は透明", () => {
    const radius = 64;
    const pix = buildStampPixels(radius, 1, { r: 10, g: 20, b: 30 }, 1);
    const allowed = new Set([0, ...LIGHT_STEPS.map((s) => Math.round(s.level * 255))]);
    for (let i = 3; i < pix.data.length; i += 4) expect(allowed.has(pix.data[i] ?? -1), "alpha は段の値だけ").toBe(true);
    const cx = Math.ceil(radius);
    const cy = Math.ceil(radius / LIGHT_Y_STRETCH);
    const at = (x: number, y: number): number => pix.data[(y * pix.width + x) * 4 + 3] ?? 0;
    expect(at(cx, cy), "中心は最大").toBe(255);
    expect(at(0, cy), "半径の端は透明").toBe(0);
    expect(at(cx, 0), "縦の端も透明").toBe(0);
    expect(at(cx + Math.round(radius * 0.8), cy), "外側は薄い").toBeLessThan(at(cx, cy));
    expect(pix.data[(cy * pix.width + cx) * 4], "色は一定").toBe(10);
  });

  it("縦は 1/1.15 に潰れた楕円（縦の半径が横より小さい）", () => {
    const radius = 60;
    const pix = buildStampPixels(radius, 1, { r: 0, g: 0, b: 0 }, 1);
    expect(pix.height, "縦の画素数は横より少ない").toBeLessThan(pix.width);
    expect(pix.height).toBe(Math.ceil(radius / LIGHT_Y_STRETCH) * 2 + 1);
  });

  it("alphaScale で濃さが変わる（光の色の重ね用）", () => {
    const full = buildStampPixels(20, 1, { r: 1, g: 1, b: 1 }, 1);
    const tint = buildStampPixels(20, 1, { r: 1, g: 1, b: 1 }, 0.3);
    const maxAlpha = (p: { data: Uint8ClampedArray }): number => Math.max(...Array.from({ length: p.data.length / 4 }, (_, i) => p.data[i * 4 + 3] ?? 0));
    expect(maxAlpha(tint), "0.3 倍").toBe(Math.round(0.3 * 255));
    expect(maxAlpha(full)).toBe(255);
  });

  it("色文字列を分ける。読めない文字列は黒", () => {
    expect(parseHexColor("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHexColor("rgb(1,2,3)")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("mapLights（光源）", () => {
  it("先頭はいつもプレイヤー。MAP_LIGHT の半径と強さ", () => {
    const state = openState();
    const lights = mapLights(state, VIEW, THEME, []);
    expect(lights[0]?.x, "プレイヤーの x").toBe(200);
    expect(lights[0]?.y, "プレイヤーの y").toBe(120);
    expect(lights[0]?.r).toBe(MAP_LIGHT.playerLightRadius);
    expect(lights[0]?.strength).toBe(MAP_LIGHT.playerLightStrength);
    expect(lights.length, "ほかに光源が無ければプレイヤーだけ").toBe(1);
  });

  it("画面外の光は含まない（円が画面に掛かるものは含む）", () => {
    const state = openState();
    const inside: MapLight = { x: 100, y: 100, r: 20, strength: 0.6, color: "#ffffff" };
    const touching: MapLight = { x: 490, y: 100, r: 20, strength: 0.6, color: "#ffffff" };
    const outside: MapLight = { x: 700, y: 100, r: 20, strength: 0.6, color: "#ffffff" };
    const lights = mapLights(state, VIEW, THEME, [inside, touching, outside]);
    expect(lights, "画面内").toContain(inside);
    expect(lights, "縁に掛かる").toContain(touching);
    expect(lights, "画面外").not.toContain(outside);
  });

  it("maxLights で切り、残るのはプレイヤーに近い順", () => {
    const state = openState();
    const many: MapLight[] = [];
    for (let i = 0; i < MAP_LIGHT.maxLights * 2; i++) many.push({ x: 20 + i * 4, y: 120, r: 10, strength: 0.6, color: "#ffffff" });
    const lights = mapLights(state, VIEW, THEME, many);
    expect(lights.length, "上限").toBe(MAP_LIGHT.maxLights);
    const dists = lights.slice(1).map((l) => Math.abs(l.x - 200));
    expect(dists, "近い順").toEqual([...dists].sort((a, b) => a - b));
    const farthest = Math.max(...dists);
    const dropped = many.filter((l) => !lights.includes(l));
    for (const l of dropped) expect(Math.abs(l.x - 200), "捨てたのは残したより遠い").toBeGreaterThanOrEqual(farthest);
  });

  it("溶岩の地形は 2 マスおき（市松）に光る。炎・階段・泉も光る", () => {
    const state = openState();
    placeTerrain(state, 200, 100, "lava", TILE * 3, 0);
    const lava = terrainCode("lava");
    let lavaTiles = 0;
    for (const k of state.terrain.kinds) if (k === lava) lavaTiles++;
    expect(lavaTiles, "溶岩が複数マスにある").toBeGreaterThan(4);
    const lights = mapLights(state, VIEW, THEME, []).slice(1);
    expect(lights.length, "半分ほど").toBeLessThan(lavaTiles);
    expect(lights.length).toBeGreaterThan(0);
    for (const l of lights) {
      expect(l.r, "溶岩の半径").toBe(MAP_LIGHT.lavaLightRadius);
      expect((Math.floor(l.x / TILE) + Math.floor(l.y / TILE)) % 2, "x + y が偶数のマスだけ").toBe(0);
    }

    const other = openState();
    placeTerrain(other, 200, 100, "fire", 1, 0);
    expect(mapLights(other, VIEW, THEME, []).length, "炎の光が足される").toBeGreaterThan(1);

    const tiles = openState();
    tiles.map.tiles[toIndex(tiles.map, 14, 8)] = Tile.StairsDown;
    tiles.map.tiles[toIndex(tiles.map, 16, 8)] = Tile.Fountain;
    const radii = mapLights(tiles, VIEW, THEME, []).slice(1).map((l) => l.r).sort((a, b) => a - b);
    expect(radii, "階段と泉").toEqual([MAP_LIGHT.springLightRadius, MAP_LIGHT.stairsLightRadius].sort((a, b) => a - b));
  });

  it("溶岩の穴（溶岩の章のバイオーム）は光り、水の穴は光らない", () => {
    const state = openState();
    for (let x = 10; x < 20; x++) for (let y = 5; y < 10; y++) state.map.tiles[toIndex(state.map, x, y)] = Tile.Pit;
    const lavaTheme = mapThemeFor(8, "forge");
    expect(lavaTheme.pit, "前提: forge は溶岩の穴").toBe("lava");
    expect(mapLights(state, VIEW, lavaTheme, []).length, "溶岩の穴の光").toBeGreaterThan(1);
    const waterTheme = mapThemeFor(3, "swamp");
    expect(waterTheme.pit, "前提: swamp は溶岩でない").not.toBe("lava");
    expect(mapLights(state, VIEW, waterTheme, []).length, "水の穴は光らない").toBe(1);
  });

  it("決定的で、state.rng を引かず state も変えない（炎のゆらぎは state.time）", () => {
    const state = openState();
    placeTerrain(state, 200, 100, "fire", TILE, 0);
    let draws = 0;
    const spy = (): number => {
      draws++;
      return 0;
    };
    state.rng = { next: spy, int: spy, chance: () => (spy(), false), pick: <T>(arr: readonly T[]) => (spy(), arr[0] as T) };
    const kinds = Array.from(state.terrain.kinds);
    const a = mapLights(state, VIEW, THEME, []);
    const b = mapLights(state, VIEW, THEME, []);
    expect(b, "同じ入力で同じ結果").toEqual(a);
    expect(draws, "乱数を引かない").toBe(0);
    expect(Array.from(state.terrain.kinds), "地形は変わらない").toEqual(kinds);
    state.time += 0.1;
    const c = mapLights(state, VIEW, THEME, []);
    expect(c.map((l) => l.strength), "時間で炎の強さが動く").not.toEqual(a.map((l) => l.strength));
  });
});

// ---------------------------------------------------------------------------
// 光の層（偽の canvas で呼び出しの順と回数を見る）
// ---------------------------------------------------------------------------

interface Op {
  target: string;
  kind: string;
  composite: string;
  fillStyle?: string;
  w?: number;
  h?: number;
}

function fakeFactory(ops: Op[]): { make: (w: number, h: number) => HTMLCanvasElement; created: () => number } {
  let n = 0;
  const make = (width: number, height: number): HTMLCanvasElement => {
    const name = `c${n++}`;
    const ctx = {
      globalCompositeOperation: "source-over",
      globalAlpha: 1,
      fillStyle: "",
      imageSmoothingEnabled: true,
      clearRect: () => ops.push({ target: name, kind: "clear", composite: ctx.globalCompositeOperation }),
      fillRect: (_x: number, _y: number, w: number, h: number) => ops.push({ target: name, kind: "fill", composite: ctx.globalCompositeOperation, fillStyle: String(ctx.fillStyle), w, h }),
      drawImage: () => ops.push({ target: name, kind: "draw", composite: ctx.globalCompositeOperation }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => ops.push({ target: name, kind: "put", composite: ctx.globalCompositeOperation }),
      save: () => {},
      restore: () => {},
    };
    return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  };
  return { make, created: () => n };
}

function fakeTarget(ops: Op[]): CanvasRenderingContext2D {
  const ctx = {
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save: () => {},
    restore: () => {},
    drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => ops.push({ target: "world", kind: "draw", composite: ctx.globalCompositeOperation, w, h }),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe("MapLightLayer（光の層）", () => {
  const lights: MapLight[] = [
    { x: 100, y: 100, r: 32, strength: 0.55, color: "#ffe8c0" },
    { x: 200, y: 120, r: 42, strength: 0.7, color: "#ff6a20" },
    { x: 300, y: 80, r: 30, strength: 0.05, color: "#ffffff" },
  ];

  it("960x540 の層を作り、暗さを塗って光を destination-out で抜き、world へ 暗がり → 色の円（soft-light）の順に描く", () => {
    const ops: Op[] = [];
    const fake = fakeFactory(ops);
    const layer = new MapLightLayer(fake.make);
    const world = fakeTarget(ops);
    layer.draw(world, VIEW, lights, 0.3);
    const fills = ops.filter((o) => o.kind === "fill");
    expect(fills.length, "暗さの塗りは 1 回").toBe(1);
    expect(fills[0]?.fillStyle, "黒の不透明度が暗さ").toBe("rgba(0,0,0,0.3)");
    expect(fills[0]?.w, "密度 2 の幅").toBe(960);
    expect(fills[0]?.h, "密度 2 の高さ").toBe(540);
    const cut = ops.filter((o) => o.kind === "draw" && o.target === "c0");
    expect(cut.length, "強さ 0.12 以下の光は抜かない").toBe(2);
    expect(cut.every((o) => o.composite === "destination-out"), "光は destination-out").toBe(true);
    const toWorld = ops.filter((o) => o.target === "world");
    expect(toWorld.length, "world へは 暗がり 1 回 + 色の円 2 回").toBe(3);
    expect(toWorld[0]?.composite, "先に暗がり").toBe("source-over");
    expect(toWorld[0]?.w, "論理サイズで描く").toBe(480);
    expect(toWorld[0]?.h).toBe(270);
    expect(toWorld[1]?.composite, "次に色の円").toBe("soft-light");
    expect(toWorld[2]?.composite).toBe("soft-light");
    expect(toWorld[1]?.w, "色の円は密度 2 の円を半分の大きさで").toBeLessThan(120);
  });

  it("作り置き: 同じ半径と強さの円は 2 フレーム目に作り直さない", () => {
    const ops: Op[] = [];
    const fake = fakeFactory(ops);
    const layer = new MapLightLayer(fake.make);
    const world = fakeTarget(ops);
    layer.draw(world, VIEW, lights, 0.3);
    const created = fake.created();
    const stamps = layer.stampCount();
    layer.draw(world, { ...VIEW, x: 17 }, lights, 0.3);
    expect(fake.created(), "canvas は増えない").toBe(created);
    expect(layer.stampCount(), "作り置きは増えない").toBe(stamps);
  });

  it("強さの揺らぎは刻みにまとまり、作り置きが増え続けない", () => {
    const ops: Op[] = [];
    const layer = new MapLightLayer(fakeFactory(ops).make);
    const world = fakeTarget(ops);
    for (let i = 0; i < 200; i++) {
      layer.draw(world, VIEW, [{ x: 100, y: 100, r: 30, strength: 0.5 + 0.1 * Math.sin(i), color: "#ff9a40" }], 0.3);
    }
    expect(layer.stampCount(), "強さ 0.4〜0.6 の刻みだけ（暗がり用 + 色用）").toBeLessThanOrEqual(2 * 6);
  });
});
