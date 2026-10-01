import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { terrainCode } from "../../core/terrain";
import { MAP_LAYOUT } from "../../data/tuning";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { type GameMap, Tile, isPassableTile } from "../grid";
import { generateLayoutMap, layoutFrameFor, scaledSize } from "./index";
import { doorsOf, generatePrefab, orient } from "./prefab";
import { PIECE_CHARS, PREFABS, type PieceKey } from "./prefabPieces";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const PIECE_KEYS = Object.keys(PREFABS) as PieceKey[];
/** 生成 1 回あたりの平均の上限（ms）。設計の目標は 40ms だが、並列の CI でぶれるので設計書（2-5）の 150ms で落とす */
const MAX_AVG_MS = 150;

function sizeFor(area: number): { width: number; height: number } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  return { width: o.width, height: o.height };
}

function prefabMaps(area: number): GameMap[] {
  const { width, height } = sizeFor(area);
  const maps: GameMap[] = [];
  for (const seed of SEEDS) {
    const map = generateLayoutMap("prefab", createRng(seed), width, height);
    if (map) maps.push(map);
  }
  return maps;
}

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

describe("prefabPieces（断片の文字の格子）", () => {
  it("どの断片も行の長さがそろい、使う文字は決められた 6 種だけ", () => {
    const allowed = new Set<string>(Object.values(PIECE_CHARS));
    for (const key of PIECE_KEYS) {
      const rows = PREFABS[key].rows;
      const width = rows[0]?.length ?? 0;
      for (const row of rows) {
        expect(row.length, `${key} の行の長さ`).toBe(width);
        for (const c of row) expect(allowed.has(c), `${key} の文字 '${c}'`).toBe(true);
      }
    }
  });

  it("扉は縁にあり、必ず 2 マス幅の組（4 近傍でちょうど 1 つの扉と隣り合う）", () => {
    for (const key of PIECE_KEYS) {
      const rows = PREFABS[key].rows;
      const h = rows.length;
      const w = rows[0]?.length ?? 0;
      let doors = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (rows[y]?.[x] !== PIECE_CHARS.door) continue;
          doors++;
          expect(x === 0 || y === 0 || x === w - 1 || y === h - 1, `${key} (${x},${y}) の扉は縁`).toBe(true);
          const near = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].filter(([dx = 0, dy = 0]) => rows[y + dy]?.[x + dx] === PIECE_CHARS.door).length;
          expect(near, `${key} (${x},${y}) の扉の隣`).toBe(1);
        }
      }
      expect(doors, `${key} の扉の数`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("orient / doorsOf（回転・反転・拡大）", () => {
  it("90 度を 4 回回すと元に戻り、1 回で幅と高さが入れ替わる", () => {
    for (const key of PIECE_KEYS) {
      const base = orient(key, 0, false, 1);
      expect(orient(key, 4, false, 1).grid, `${key} の 4 回転`).toEqual(base.grid);
      const rotated = orient(key, 1, false, 1);
      expect([rotated.w, rotated.h]).toEqual([base.h, base.w]);
    }
  });

  it("2 倍に拡大すると寸法が 2 倍で、元の 1 マスが 2x2 になる", () => {
    for (const key of PIECE_KEYS) {
      const base = orient(key, 0, false, 1);
      const big = orient(key, 0, false, 2);
      expect([big.w, big.h]).toEqual([base.w * 2, base.h * 2]);
      for (let y = 0; y < big.h; y++) {
        for (let x = 0; x < big.w; x++) expect(big.grid[y]?.[x], `${key} (${x},${y})`).toBe(base.grid[Math.floor(y / 2)]?.[Math.floor(x / 2)]);
      }
    }
  });

  it("扉の始点は扉の文字の上で、縁の外の点は断片の外にある（どの向き・拡大でも）", () => {
    for (const key of PIECE_KEYS) {
      for (let rot = 0; rot < 4; rot++) {
        for (const mirror of [false, true]) {
          for (const scale of [1, 2]) {
            const o = orient(key, rot, mirror, scale);
            for (const d of doorsOf(o)) {
              const label = `${key} rot=${rot} mirror=${mirror} scale=${scale}`;
              expect(o.grid[d.iy]?.[d.ix], `${label} の扉の始点`).toBe(PIECE_CHARS.door);
              expect(d.ox < 0 || d.oy < 0 || d.ox >= o.w || d.oy >= o.h, `${label} の外の点`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe("prefab（断片の組み合わせ）", () => {
  it("面積 1 / 3.5 / 5 倍で、ほぼ全 seed が作れて検査（8 項目）に通る", () => {
    for (const area of [1, 3.5, 5]) {
      const maps = prefabMaps(area);
      expect(maps.length, `面積 ${area} 倍で作れた数`).toBeGreaterThanOrEqual(SEEDS.length - 1);
      for (const map of maps) expect(validateLayout(map), `面積 ${area} 倍`).toBeNull();
    }
  });

  it("床の割合が下限を割らず、部屋が validate.minRooms 以上ある", () => {
    for (const area of [1, 3.5, 5]) {
      for (const map of prefabMaps(area)) {
        const floors = map.tiles.filter((t) => isPassableTile(t)).length;
        expect(floors / map.tiles.length, `面積 ${area} 倍の床の割合`).toBeGreaterThanOrEqual(MAP_LAYOUT.validate.minFloorRatio);
        const big = (map.roomTiles ?? []).filter((t) => t.length >= MAP_LAYOUT.validate.roomMinTiles).length;
        expect(big, `面積 ${area} 倍の部屋数`).toBeGreaterThanOrEqual(MAP_LAYOUT.validate.minRooms);
      }
    }
  });

  it("開始と主の間は地図の向かい合う端の近くにある", () => {
    for (const map of prefabMaps(3.5)) {
      const start = centroid(map, 0);
      const lord = centroid(map, map.rooms.length - 1);
      const apart = Math.max(Math.abs(lord.x - start.x) / map.width, Math.abs(lord.y - start.y) / map.height);
      expect(apart, "端どうしの離れ").toBeGreaterThanOrEqual(0.4);
    }
  });

  it("面積が広いほど部屋が増える（個数は countMul で伸びる）", () => {
    const mean = (maps: GameMap[]): number => maps.reduce((s, m) => s + m.rooms.length, 0) / Math.max(1, maps.length);
    expect(mean(prefabMaps(5)), "面積 5 倍の部屋数の平均").toBeGreaterThan(mean(prefabMaps(1)));
  });

  it("池の穴と浅い地形（水たまり）が出て、浅い地形は床の上にだけ写る", () => {
    let pits = 0;
    let shallows = 0;
    const water = terrainCode("water");
    for (const map of prefabMaps(3.5)) {
      for (const t of map.tiles) if (t === Tile.Pit) pits++;
      for (let i = 0; i < (map.shallow?.length ?? 0); i++) {
        if (map.shallow?.[i] !== water) continue;
        shallows++;
        expect(map.tiles[i], "浅い地形は床の上").toBe(Tile.Floor);
      }
    }
    expect(pits, "穴のある地図").toBeGreaterThan(0);
    expect(shallows, "浅い地形のあるマス").toBeGreaterThan(0);
  });

  it("下書きは同じ rng・同じ枠なら同じ（決定性）で、断片ごとに所属タイルを持つ", () => {
    const { width, height } = scaledSize("prefab", sizeFor(3.5).width, sizeFor(3.5).height);
    const frame = layoutFrameFor(width, height, 321);
    const a = generatePrefab(createRng(5), frame);
    const b = generatePrefab(createRng(5), frame);
    expect(a, "下書きが作れる").not.toBeNull();
    expect(Array.from(a?.cells ?? [])).toEqual(Array.from(b?.cells ?? []));
    expect(a?.nodes.every((n) => (n.tiles?.length ?? 0) > 0), "全ノードが所属タイルを持つ").toBe(true);
    expect(a?.nodes[0]?.role).toBe("start");
    expect(a?.nodes[1]?.role).toBe("lord");
  });

  it("面積 5 倍の生成（下書き → 後処理 → 検査）の平均が上限以下", () => {
    const { width, height } = sizeFor(5);
    generateLayoutMap("prefab", createRng(999), width, height); // 初回の JIT を除く
    const t0 = performance.now();
    for (const seed of SEEDS) generateLayoutMap("prefab", createRng(seed), width, height);
    const avg = (performance.now() - t0) / SEEDS.length;
    expect(avg, `平均 ${avg.toFixed(1)}ms`).toBeLessThanOrEqual(MAX_AVG_MS);
  });
});
