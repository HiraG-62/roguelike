import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { type GameMap, Tile, isPassableTile } from "../grid";
import { generateCourt } from "./court";
import { generateLayoutMap, layoutFrameFor, scaledSize } from "./index";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** 生成 1 回あたりの平均の上限（ms）。設計の目標は 40ms だが、並列の CI でぶれるので設計書（2-5）の 150ms で落とす */
const MAX_AVG_MS = 150;

function sizeFor(area: number): { width: number; height: number } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  return { width: o.width, height: o.height };
}

function courtMaps(area: number): GameMap[] {
  const { width, height } = sizeFor(area);
  const maps: GameMap[] = [];
  for (const seed of SEEDS) {
    const map = generateLayoutMap("court", createRng(seed), width, height);
    if (map) maps.push(map);
  }
  return maps;
}

/** 部屋のタイルの重心（マス） */
function centroid(map: GameMap, room: number): { x: number; y: number } {
  const tiles = map.roomTiles?.[room] ?? [];
  let x = 0;
  let y = 0;
  for (const t of tiles) {
    x += t % map.width;
    y += Math.floor(t / map.width);
  }
  return { x: x / Math.max(1, tiles.length), y: y / Math.max(1, tiles.length) };
}

function floorRatio(map: GameMap): number {
  let n = 0;
  for (const t of map.tiles) if (isPassableTile(t)) n++;
  return n / map.tiles.length;
}

describe("court（中庭・寺院）", () => {
  it("面積 1 / 3.5 / 5 倍で、ほぼ全 seed が作れて検査（8 項目）に通る", () => {
    for (const area of [1, 3.5, 5]) {
      const maps = courtMaps(area);
      expect(maps.length, `面積 ${area} 倍で作れた数`).toBeGreaterThanOrEqual(SEEDS.length - 1);
      for (const map of maps) expect(validateLayout(map), `面積 ${area} 倍`).toBeNull();
    }
  });

  it("本堂（主の間）は軸の奥にある: 開始から主の間までが長い軸の長さの 6 割以上離れている", () => {
    for (const map of courtMaps(3.5)) {
      const start = centroid(map, 0);
      const lord = centroid(map, map.rooms.length - 1);
      const along = Math.max(Math.abs(lord.x - start.x) / map.width, Math.abs(lord.y - start.y) / map.height);
      expect(along, "軸方向の離れ").toBeGreaterThanOrEqual(0.6);
    }
  });

  it("軸の向きが縦と横の両方で出て、開始が軸のどちらの端にも出る", () => {
    const vertical: boolean[] = [];
    const startLow: boolean[] = [];
    for (const map of courtMaps(3.5)) {
      const start = centroid(map, 0);
      const lord = centroid(map, map.rooms.length - 1);
      const isVertical = Math.abs(lord.y - start.y) / map.height > Math.abs(lord.x - start.x) / map.width;
      vertical.push(isVertical);
      startLow.push(isVertical ? start.y < lord.y : start.x < lord.x);
    }
    expect(vertical.includes(true) && vertical.includes(false), "縦と横").toBe(true);
    expect(startLow.includes(true) && startLow.includes(false), "開始が軸の低い側・高い側の両方").toBe(true);
  });

  it("床の割合が下限（minFloorRatio）を割らず、部屋が validate.minRooms 以上ある", () => {
    for (const area of [1, 3.5, 5]) {
      for (const map of courtMaps(area)) {
        expect(floorRatio(map), `面積 ${area} 倍の床の割合`).toBeGreaterThanOrEqual(MAP_LAYOUT.validate.minFloorRatio);
        const big = (map.roomTiles ?? []).filter((t) => t.length >= MAP_LAYOUT.validate.roomMinTiles).length;
        expect(big, `面積 ${area} 倍の部屋数`).toBeGreaterThanOrEqual(MAP_LAYOUT.validate.minRooms);
      }
    }
  });

  it("面積が広いほど部屋が増える（個数は countMul・長さは unit で伸びる）", () => {
    const mean = (maps: GameMap[]): number => maps.reduce((s, m) => s + m.rooms.length, 0) / Math.max(1, maps.length);
    expect(mean(courtMaps(5)), "面積 5 倍の部屋数の平均").toBeGreaterThan(mean(courtMaps(1)));
  });

  it("池（穴）と柱（壁）が中庭にあり、穴の上に部屋のタイルが無い", () => {
    let pits = 0;
    for (const map of courtMaps(3.5)) {
      for (const t of map.tiles) if (t === Tile.Pit) pits++;
      for (const tiles of map.roomTiles ?? []) {
        for (const tile of tiles) expect(map.tiles[tile], "部屋のタイルは床か階段").not.toBe(Tile.Pit);
      }
    }
    expect(pits, "池を持つ地図が 1 つ以上ある").toBeGreaterThan(0);
  });

  it("下書きは同じ rng・同じ枠なら同じ（決定性）で、部屋の所属タイルを持つ", () => {
    const { width, height } = scaledSize("court", sizeFor(3.5).width, sizeFor(3.5).height);
    const frame = layoutFrameFor(width, height, 123);
    const a = generateCourt(createRng(7), frame);
    const b = generateCourt(createRng(7), frame);
    expect(a, "下書きが作れる").not.toBeNull();
    expect(Array.from(a?.cells ?? [])).toEqual(Array.from(b?.cells ?? []));
    expect(a?.nodes.every((n) => (n.tiles?.length ?? 0) > 0), "全ノードが所属タイルを持つ").toBe(true);
    expect(a?.nodes.filter((n) => n.role === "start").length).toBe(1);
    expect(a?.nodes.filter((n) => n.role === "lord").length).toBe(1);
  });

  it("面積 5 倍の生成（下書き → 後処理 → 検査）の平均が上限以下", () => {
    const { width, height } = sizeFor(5);
    generateLayoutMap("court", createRng(999), width, height); // 初回の JIT を除く
    const t0 = performance.now();
    for (const seed of SEEDS) generateLayoutMap("court", createRng(seed), width, height);
    const avg = (performance.now() - t0) / SEEDS.length;
    expect(avg, `平均 ${avg.toFixed(1)}ms`).toBeLessThanOrEqual(MAX_AVG_MS);
  });
});
