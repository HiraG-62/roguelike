import { describe, expect, it, vi } from "vitest";
import { createRng } from "../../core/rng";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { type GameMap, isPassableTile } from "../grid";
import { generateCavern } from "./cavern";
import { generateLayoutMap, layoutFrameFor } from "./index";
import { Cell, type LayoutDraft, type LayoutFrame } from "./types";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** 面積 5 倍の生成（後処理・検査を含む）の平均の上限（ms）。設計の目標は 40ms で、CI のぶれを見て 150ms で落とす（map-gen-impl.md 2-5） */
const MAX_AVG_MS = 150;
/** 失敗率（旧生成器へ落ちる割合）の上限 */
const MAX_FAIL_RATE = 0.05;

function sizeFor(area: number): { width: number; height: number } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  return { width: o.width, height: o.height };
}

function draftOf(area: number, seed: number): { draft: LayoutDraft; frame: LayoutFrame } {
  const { width, height } = sizeFor(area);
  const rng = createRng(seed);
  const frame = layoutFrameFor(width, height, rng.int(0, 0x7fffffff));
  const draft = generateCavern(rng, frame);
  if (!draft) throw new Error(`seed=${seed} 面積 ${area} で下書きが作れなかった`);
  return { draft, frame };
}

function mapOf(area: number, seed: number): GameMap | null {
  const { width, height } = sizeFor(area);
  return generateLayoutMap("cavern", createRng(seed), width, height);
}

function floorRatio(map: GameMap): number {
  let n = 0;
  for (const t of map.tiles) if (isPassableTile(t)) n++;
  return n / map.tiles.length;
}

describe("大洞窟の下書き", () => {
  it("同じ rng・同じ枠なら同じ下書き（セル・ノード）になる", () => {
    const a = draftOf(3.5, 7);
    const b = draftOf(3.5, 7);
    expect(Array.from(a.draft.cells)).toEqual(Array.from(b.draft.cells));
    expect(a.draft.nodes).toEqual(b.draft.nodes);
  });

  it("Math.random に依存しない（乱数は渡された rng だけ）", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random が呼ばれた");
    });
    try {
      expect(() => draftOf(5, 3)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it("セルは床か壁だけ（穴は使わない）で、外周はすべて壁", () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const { draft, frame } = draftOf(3.5, seed);
      const { width: w, height: h } = frame;
      for (let i = 0; i < draft.cells.length; i++) {
        const cell = draft.cells[i];
        expect(cell === Cell.Floor || cell === Cell.Wall, `seed=${seed} i=${i}`).toBe(true);
        const x = i % w;
        const y = Math.floor(i / w);
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) expect(cell, `seed=${seed} 外周 (${x},${y})`).toBe(Cell.Wall);
      }
    }
  });

  it("開始と主の間のノードがちょうど 1 つずつあり、主の間の広がりは主の半径が入る分を下回らない", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const { draft, frame } = draftOf(3.5, seed);
      expect(draft.nodes.filter((n) => n.role === "start").length, `seed=${seed} 開始`).toBe(1);
      const lords = draft.nodes.filter((n) => n.role === "lord");
      expect(lords.length, `seed=${seed} 主の間`).toBe(1);
      expect(lords[0]?.grow ?? 0, `seed=${seed} 主の間の広がり`).toBeGreaterThanOrEqual(frame.lordRadius);
    }
  });

  it("部屋のノード（広間 + 小洞）の数は面積に応じて増える（個数は countMul 倍）", () => {
    const mean = (area: number): number => SEEDS.reduce((s, seed) => s + draftOf(area, seed).draft.nodes.length, 0) / SEEDS.length;
    expect(mean(5), "面積 5 倍").toBeGreaterThan(mean(1));
    expect(mean(3.5), "面積 3.5 倍は広間と小洞で 8 つ以上").toBeGreaterThanOrEqual(8);
  });
});

describe("大洞窟の地図（生成 → 後処理 → 検査）", () => {
  it.each([3.5, 5])("面積 %s 倍: 検査に通り、床は地図の 3〜7 割、部屋が 8 以上ある", (area) => {
    for (const seed of SEEDS) {
      const map = mapOf(area, seed);
      expect(map, `seed=${seed}`).not.toBeNull();
      if (!map) continue;
      expect(validateLayout(map), `seed=${seed}`).toBeNull();
      expect(map.layout).toBe("cavern");
      const ratio = floorRatio(map);
      expect(ratio, `seed=${seed} 床の割合`).toBeGreaterThan(0.3);
      expect(ratio, `seed=${seed} 床の割合`).toBeLessThan(0.7);
      expect(map.rooms.length, `seed=${seed} 部屋の数`).toBeGreaterThanOrEqual(8);
    }
  });

  it("大広間がある: 最も大きい部屋は面積に応じて大きくなる（長さは unit 倍）", () => {
    const biggest = (area: number): number => {
      let sum = 0;
      for (const seed of SEEDS) sum += Math.max(...(mapOf(area, seed)?.roomTiles ?? [[]]).map((t) => t.length));
      return sum / SEEDS.length;
    };
    expect(biggest(5)).toBeGreaterThan(biggest(1));
    expect(biggest(3.5), "大広間は小洞より十分に大きい（200 タイル以上）").toBeGreaterThan(200);
  });

  it("失敗率（旧生成器へ落ちる割合）が 5% 以下", () => {
    for (const area of [1, 3.5, 5]) {
      const failures = SEEDS.filter((seed) => mapOf(area, seed) === null).length;
      expect(failures / SEEDS.length, `面積 ${area} 倍: ${failures} 失敗`).toBeLessThanOrEqual(MAX_FAIL_RATE);
    }
  });

  it("面積 5 倍の生成が平均で十分に速い（後処理・検査を含む）", () => {
    mapOf(5, 1); // 初回の JIT を除く
    const t0 = performance.now();
    for (const seed of SEEDS) mapOf(5, seed);
    const avg = (performance.now() - t0) / SEEDS.length;
    expect(avg, `平均 ${avg.toFixed(1)}ms`).toBeLessThan(MAX_AVG_MS);
  });
});
