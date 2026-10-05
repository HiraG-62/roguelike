import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { type GameMap, Tile } from "../grid";
import { GENERATE_ATTEMPTS, LAYOUT_GENERATORS, generateLayoutMap, layoutFrameFor, scaledSize } from "./index";
import { disc, line, makeGrid } from "./shapes";
import { Cell, LAYOUT_KINDS, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutKind, type LayoutNode } from "./types";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const AREAS = [1, 3.5, 5] as const;
/** 型の失敗率（旧生成器に落ちる割合）の上限 */
const MAX_FAIL_RATE = 0.05;
/** 同じ rng なら同じ地図かを見る seed の数（全 seed を 2 回作ると重いので先頭だけ） */
const DETERMINISM_SEEDS = 5;

function sizeFor(area: number): { width: number; height: number } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  return { width: o.width, height: o.height };
}

describe("layoutFrameFor（拡縮の規則）", () => {
  it("見本の大きさ（64x40）なら unit = 1・countMul = 1", () => {
    const f = layoutFrameFor(MAP_LAYOUT.previewWidth, MAP_LAYOUT.previewHeight, 7);
    expect(f.unit).toBeCloseTo(1, 9);
    expect(f.countMul).toBeCloseTo(1, 9);
    expect(f.noiseSeed).toBe(7);
  });

  it("地図の面積を広げると長さと個数の倍率がともに増える", () => {
    let previousUnit = 1;
    let previousCountMul = 1;
    for (const area of AREAS) {
      const { width, height } = sizeFor(area);
      const f = layoutFrameFor(width, height);
      expect(f.unit, `面積 ${area} の長さの倍率`).toBeGreaterThan(previousUnit);
      expect(f.countMul, `面積 ${area} の個数の倍率`).toBeGreaterThan(previousCountMul);
      expect(f.width).toBe(width);
      expect(f.height).toBe(height);
      previousUnit = f.unit;
      previousCountMul = f.countMul;
    }
  });

  it("個数の倍率は S² ÷ u²（長さの倍率の分だけ個数は控えめになる）", () => {
    const f = layoutFrameFor(200, 115);
    const s = Math.sqrt((200 * 115) / (MAP_LAYOUT.previewWidth * MAP_LAYOUT.previewHeight));
    expect(f.countMul).toBeCloseTo((s * s) / (f.unit * f.unit), 9);
    expect(f.unit).toBeCloseTo(s ** MAP_LAYOUT.unitExp, 9);
  });

  it("主の間の半径は既定で階の主の広場の半径、引数で変えられる", () => {
    expect(layoutFrameFor(96, 56).lordRadius).toBeGreaterThan(0);
    expect(layoutFrameFor(96, 56, 0, 9).lordRadius).toBe(9);
  });
});

describe("scaledSize（型ごとの面積の縮み）", () => {
  it("areaScale の無い型はそのまま、court・prefab は √ 倍に縮む", () => {
    expect(scaledSize("cavern", 200, 100)).toEqual({ width: 200, height: 100 });
    const court = scaledSize("court", 200, 100);
    expect(court.width).toBeLessThan(200);
    expect(court.width).toBe(Math.round(200 * Math.sqrt(MAP_LAYOUT.areaScale.court)));
    expect(scaledSize("prefab", 200, 100).height).toBeLessThan(100);
  });
});

/** 検査に通る手作りの下書き: 4 x 3 の格子状に円の部屋を置いて廊下でつなぐ。生成器のテスト用の模型 */
function latticeDraft(frame: LayoutFrame): LayoutDraft {
  const cols = 4;
  const rows = 3;
  const g = makeGrid(frame.width, frame.height, Cell.Wall);
  const sx = frame.width / (cols + 1);
  const sy = frame.height / (rows + 1);
  const r = 0.46 * Math.min(sx, sy);
  const nodes: LayoutNode[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = sx * (col + 1);
      const y = sy * (row + 1);
      disc(g, x, y, r, Cell.Floor);
      if (col > 0) line(g, x - sx, y, x, y, 2, Cell.Floor);
      if (row > 0) line(g, x, y - sy, x, y, 2, Cell.Floor);
      const role = row === 0 && col === 0 ? "start" : row === rows - 1 && col === cols - 1 ? "lord" : "room";
      nodes.push({ x, y, role, grow: role === "lord" ? 8 : 6 });
    }
  }
  return { cells: g.cells, shallow: new Uint8Array(frame.width * frame.height), nodes };
}

function generatorsWith(kind: LayoutKind, generator: LayoutGenerator): Record<LayoutKind, LayoutGenerator> {
  return { ...LAYOUT_GENERATORS, [kind]: generator };
}

describe("generateLayoutMap（生成 → 後処理 → 検査 → 作り直し）", () => {
  const { width, height } = sizeFor(1);

  it("検査に通る下書きなら GameMap にして、型を記録する", () => {
    const map = generateLayoutMap("cavern", createRng(1), width, height, generatorsWith("cavern", (_rng, frame) => latticeDraft(frame)));
    expect(map, "手作りの下書きは検査に通る").not.toBeNull();
    expect(map?.layout).toBe("cavern");
    expect(map && validateLayout(map)).toBeNull();
    expect(map?.tiles.includes(Tile.StairsDown)).toBe(true);
  });

  it("生成器が null を返し続けたら GENERATE_ATTEMPTS 回で諦めて null（呼び出し側が旧生成器へ落ちる）", () => {
    let calls = 0;
    const map = generateLayoutMap(
      "river",
      createRng(1),
      width,
      height,
      generatorsWith("river", () => {
        calls++;
        return null;
      }),
    );
    expect(map).toBeNull();
    expect(calls).toBe(GENERATE_ATTEMPTS);
  });

  it("途中で落ちても同じ rng のまま作り直し、成功した回で止まる", () => {
    let calls = 0;
    const map = generateLayoutMap(
      "ring",
      createRng(2),
      width,
      height,
      generatorsWith("ring", (_rng, frame) => {
        calls++;
        return calls < 3 ? null : latticeDraft(frame);
      }),
    );
    expect(map).not.toBeNull();
    expect(calls).toBe(3);
  });

  it("検査に落ちる下書き（全部壁）は作り直しても通らず null", () => {
    let calls = 0;
    const map = generateLayoutMap(
      "isle",
      createRng(3),
      width,
      height,
      generatorsWith("isle", (_rng, frame) => {
        calls++;
        return { cells: new Uint8Array(frame.width * frame.height).fill(Cell.Wall), shallow: new Uint8Array(frame.width * frame.height), nodes: [] };
      }),
    );
    expect(map).toBeNull();
    expect(calls).toBe(GENERATE_ATTEMPTS);
  });

  it("試行ごとに noiseSeed を rng から 1 回引き、生成器へ枠として渡す（毎回違う）", () => {
    const seeds: number[] = [];
    generateLayoutMap(
      "drunk",
      createRng(4),
      width,
      height,
      generatorsWith("drunk", (_rng, frame) => {
        seeds.push(frame.noiseSeed);
        return null;
      }),
    );
    expect(seeds.length).toBe(GENERATE_ATTEMPTS);
    expect(new Set(seeds).size).toBe(GENERATE_ATTEMPTS);
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0x7fffffff);
    }
  });

  it("同じ rng・同じ生成器なら同じ地図", () => {
    const gens = generatorsWith("terrace", (_rng, frame) => latticeDraft(frame));
    const a = generateLayoutMap("terrace", createRng(5), width, height, gens);
    const b = generateLayoutMap("terrace", createRng(5), width, height, gens);
    expect(Array.from(a?.tiles ?? [])).toEqual(Array.from(b?.tiles ?? []));
    expect(a?.roomTiles).toEqual(b?.roomTiles);
  });

  it("areaScale のある型は縮んだ大きさで生成器に枠を渡す", () => {
    const sizes: number[] = [];
    generateLayoutMap(
      "court",
      createRng(6),
      width,
      height,
      generatorsWith("court", (_rng, frame) => {
        sizes.push(frame.width);
        return null;
      }),
    );
    expect(sizes[0]).toBe(scaledSize("court", width, height).width);
    expect(sizes[0]).toBeLessThan(width);
  });
});

// ---------------------------------------------------------------------------
// 8 型 × seed × 面積の表
// ---------------------------------------------------------------------------

describe.each(LAYOUT_KINDS)("階の型 %s", (kind) => {
  describe.each(AREAS)("面積 %s 倍", (area) => {
    const { width, height } = sizeFor(area);
    let cache: (GameMap | null)[] | undefined;
    const maps = (): (GameMap | null)[] => {
      cache ??= SEEDS.map((seed) => generateLayoutMap(kind, createRng(seed), width, height));
      return cache;
    };

    it("作れた地図は 8 項目の検査に通り、型が記録されている", () => {
      for (const [i, map] of maps().entries()) {
        if (!map) continue;
        expect(validateLayout(map), `seed=${SEEDS[i]}`).toBeNull();
        expect(map.layout).toBe(kind);
      }
    });

    it("同じ rng なら同じタイル列・同じ部屋になる", () => {
      for (const seed of SEEDS.slice(0, DETERMINISM_SEEDS)) {
        const a = generateLayoutMap(kind, createRng(seed), width, height);
        const b = generateLayoutMap(kind, createRng(seed), width, height);
        expect(Array.from(a?.tiles ?? []), `seed=${seed}`).toEqual(Array.from(b?.tiles ?? []));
        expect(a?.roomTiles, `seed=${seed}`).toEqual(b?.roomTiles);
        expect(a?.rooms, `seed=${seed}`).toEqual(b?.rooms);
      }
    });

    it("旧生成器に落ちる割合（失敗率）が 5% 以下", () => {
      const failures = maps().filter((m) => m === null).length;
      expect(failures / SEEDS.length, `${SEEDS.length} seed 中 ${failures} 失敗`).toBeLessThanOrEqual(MAX_FAIL_RATE);
    });
  });
});
