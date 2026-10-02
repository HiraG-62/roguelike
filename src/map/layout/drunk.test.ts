import { describe, expect, it, vi } from "vitest";
import { createRng } from "../../core/rng";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { type GameMap, isPassableTile } from "../grid";
import { generateDrunk } from "./drunk";
import { generateLayoutMap, layoutFrameFor } from "./index";
import { Cell, type LayoutDraft, type LayoutFrame } from "./types";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** 面積 5 倍の生成（後処理・検査を含む）の平均の上限（ms）。設計の目標は 40ms で、CI のぶれを見て 150ms で落とす（map-gen-impl.md 2-5） */
const MAX_AVG_MS = 150;
const MAX_FAIL_RATE = 0.05;
/** 開始と主の間が「反対の端」にあるとみなす、端からの距離（タイル。EDGE_PAD 4 + 余裕） */
const EDGE_REACH = 8;

function sizeFor(area: number): { width: number; height: number } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  return { width: o.width, height: o.height };
}

function draftOf(area: number, seed: number): { draft: LayoutDraft; frame: LayoutFrame } {
  const { width, height } = sizeFor(area);
  const rng = createRng(seed);
  const frame = layoutFrameFor(width, height, rng.int(0, 0x7fffffff));
  const draft = generateDrunk(rng, frame);
  if (!draft) throw new Error(`seed=${seed} 面積 ${area} で下書きが作れなかった`);
  return { draft, frame };
}

function mapOf(area: number, seed: number): GameMap | null {
  const { width, height } = sizeFor(area);
  return generateLayoutMap("drunk", createRng(seed), width, height);
}

function floorRatio(map: GameMap): number {
  let n = 0;
  for (const t of map.tiles) if (isPassableTile(t)) n++;
  return n / map.tiles.length;
}

/** 幅 1 の細道（どの 2x2 の窓にも入らない床）が通れる床に占める割合 */
function narrowShare(map: GameMap): number {
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.width && y < map.height && isPassableTile(map.tiles[y * map.width + x] ?? 1);
  const fatAt = (x: number, y: number): boolean => open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x + 1, y + 1);
  let floor = 0;
  let narrow = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!open(x, y)) continue;
      floor++;
      if (!fatAt(x, y) && !fatAt(x - 1, y) && !fatAt(x, y - 1) && !fatAt(x - 1, y - 1)) narrow++;
    }
  }
  return narrow / floor;
}

describe("掘り手の迷い道の下書き", () => {
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

  it("開始と主の間がちょうど 1 つずつあり、反対の端にある", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const { draft, frame } = draftOf(3.5, seed);
      const starts = draft.nodes.filter((n) => n.role === "start");
      const lords = draft.nodes.filter((n) => n.role === "lord");
      expect(starts.length, `seed=${seed} 開始`).toBe(1);
      expect(lords.length, `seed=${seed} 主の間`).toBe(1);
      const s = starts[0];
      const l = lords[0];
      if (!s || !l) continue;
      const acrossX = Math.abs(s.x - l.x) > frame.width - 2 * EDGE_REACH;
      const acrossY = Math.abs(s.y - l.y) > frame.height - 2 * EDGE_REACH;
      expect(acrossX || acrossY, `seed=${seed} 開始 (${s.x}, ${s.y}) 主の間 (${l.x}, ${l.y})`).toBe(true);
    }
  });

  it("部屋のノード（溜まり）の数は面積に応じて増える（個数は countMul 倍）", () => {
    const mean = (area: number): number => SEEDS.reduce((s, seed) => s + draftOf(area, seed).draft.nodes.length, 0) / SEEDS.length;
    expect(mean(5), "面積 5 倍").toBeGreaterThan(mean(1));
  });
});

describe("掘り手の迷い道の地図（生成 → 後処理 → 検査）", () => {
  it.each([3.5, 5])("面積 %s 倍: 検査に通り、床は 4 割前後、部屋が 8 以上ある", (area) => {
    for (const seed of SEEDS) {
      const map = mapOf(area, seed);
      expect(map, `seed=${seed}`).not.toBeNull();
      if (!map) continue;
      expect(validateLayout(map), `seed=${seed}`).toBeNull();
      expect(map.layout).toBe("drunk");
      const ratio = floorRatio(map);
      expect(ratio, `seed=${seed} 床の割合`).toBeGreaterThan(0.38);
      expect(ratio, `seed=${seed} 床の割合`).toBeLessThan(0.5);
      expect(map.rooms.length, `seed=${seed} 部屋の数`).toBeGreaterThanOrEqual(8);
    }
  });

  it("細道の網がある: 幅 1 の細道が床の数 % を占める（掘る幅は据え置きで広がらない）", () => {
    for (const area of [3.5, 5]) {
      let sum = 0;
      for (const seed of SEEDS.slice(0, 10)) {
        const map = mapOf(area, seed);
        if (map) sum += narrowShare(map);
      }
      expect(sum / 10, `面積 ${area} 倍`).toBeGreaterThan(0.03);
    }
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
