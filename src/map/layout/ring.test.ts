import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { Tile } from "../grid";
import { NEIGHBORS_4, NEIGHBORS_8 } from "../regions";
import { finalizeLayout } from "./finalize";
import { generateLayoutMap, layoutFrameFor } from "./index";
import { generateRing, ringCoreCount } from "./ring";
import { Cell, type LayoutDraft, type LayoutFrame } from "./types";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** 生成 1 回あたりの平均の上限（ms。設計の予算は 40ms。CI のぶれを見込んで 150ms で落とす） */
const MAX_AVG_MS = 150;
/** 桟道（幅 2 前後）の両側の穴を探す距離（マス） */
const PLANK_REACH = 4;

/** 毎回作り直す（決定性の確認用） */
function freshDraft(area: number, seed: number): { draft: LayoutDraft | null; frame: LayoutFrame } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  const rng = createRng(seed);
  const frame = layoutFrameFor(o.width, o.height, rng.int(0, 0x7fffffff));
  return { draft: generateRing(rng, frame), frame };
}

const draftCache = new Map<string, { draft: LayoutDraft | null; frame: LayoutFrame }>();

/** 下書きは読むだけなので (面積, seed) ごとに 1 回だけ作って使い回す（テスト全体の時間を抑える） */
function draftOf(area: number, seed: number): { draft: LayoutDraft | null; frame: LayoutFrame } {
  const key = `${area}:${seed}`;
  const hit = draftCache.get(key);
  if (hit) return hit;
  const made = freshDraft(area, seed);
  draftCache.set(key, made);
  return made;
}

function countCells(draft: LayoutDraft, cell: Cell): number {
  let n = 0;
  for (const c of draft.cells) if (c === cell) n++;
  return n;
}

describe("ringCoreCount（芯の数）", () => {
  it("countMul が増えると 1 → 2（8 の字）→ 3（鎖）と増える", () => {
    expect(ringCoreCount(1, 0)).toBe(1);
    expect(ringCoreCount(1.3, 0)).toBe(1);
    expect(ringCoreCount(1.3, 0.9)).toBe(2);
    expect(ringCoreCount(2, 0)).toBe(2);
    expect(ringCoreCount(2.27, 0.9)).toBe(3);
  });

  it("3 つを超えない・1 つを下回らない", () => {
    expect(ringCoreCount(10, 0.99)).toBe(3);
    expect(ringCoreCount(0.1, 0)).toBe(1);
  });
});

describe("generateRing（環状）", () => {
  it("開始と主の間が 1 つずつで、所属タイルを持つ部屋が 8 以上あり、タイルは床だけで部屋どうしで重ならない", () => {
    for (const area of [1, 3.5, 5]) {
      for (const seed of SEEDS) {
        const { draft } = draftOf(area, seed);
        if (!draft) continue;
        const where = `面積 ${area} seed=${seed}`;
        expect(draft.nodes.filter((n) => n.role === "start").length, `${where} の開始`).toBe(1);
        expect(draft.nodes.filter((n) => n.role === "lord").length, `${where} の主の間`).toBe(1);
        expect(draft.nodes.length, `${where} の部屋数`).toBeGreaterThanOrEqual(8);
        const seen = new Set<number>();
        for (const node of draft.nodes) {
          for (const t of node.tiles ?? []) {
            expect(draft.cells[t], `${where} のタイルは床`).toBe(Cell.Floor);
            expect(seen.has(t), `${where} のタイルが 2 つの部屋に入っている`).toBe(false);
            seen.add(t);
          }
        }
      }
    }
  });

  it("作れない（null）のは稀で、面積 3.5 倍で 20 seed のうち 1 つ以下", () => {
    const nulls = SEEDS.filter((seed) => draftOf(3.5, seed).draft === null).length;
    expect(nulls, "null の数").toBeLessThanOrEqual(1);
  });

  it("池（穴）の芯と大岩の芯の両方が出る", () => {
    const ponds = SEEDS.filter((seed) => {
      const { draft } = draftOf(3.5, seed);
      return draft !== null && countCells(draft, Cell.Pit) > 0;
    });
    expect(ponds.length, "池の seed").toBeGreaterThan(0);
    expect(ponds.length, "大岩の seed").toBeLessThan(SEEDS.length);
  });

  it("池の縁は輪の道（床）に囲まれ、外の部屋は輪から離れている", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { draft, frame } = draftOf(3.5, seed);
      if (!draft || countCells(draft, Cell.Pit) === 0) continue;
      checked++;
      let edge = 0;
      let floorEdge = 0;
      for (let i = 0; i < draft.cells.length; i++) {
        if (draft.cells[i] !== Cell.Pit) continue;
        const x = i % frame.width;
        const y = Math.floor(i / frame.width);
        for (const [dx, dy] of NEIGHBORS_4) {
          const c = draft.cells[(y + dy) * frame.width + x + dx];
          if (c === Cell.Pit) continue;
          edge++;
          if (c === Cell.Floor) floorEdge++;
        }
      }
      expect(floorEdge / edge, `seed=${seed} の池の縁の床の割合`).toBeGreaterThanOrEqual(0.95);
      for (const node of draft.nodes) {
        for (const t of node.tiles ?? []) {
          const x = t % frame.width;
          const y = Math.floor(t / frame.width);
          for (const [dx, dy] of NEIGHBORS_8) {
            expect(draft.cells[(y + dy) * frame.width + x + dx], `seed=${seed} の部屋のタイルが池に接している`).not.toBe(Cell.Pit);
          }
        }
      }
    }
    expect(checked, "池のある seed").toBeGreaterThan(0);
  });

  it("池の芯には近道の桟道（両側に穴がある床）が架かる", () => {
    for (const seed of SEEDS) {
      const { draft, frame } = draftOf(3.5, seed);
      if (!draft || countCells(draft, Cell.Pit) === 0) continue;
      const pitWithin = (i: number, step: number): boolean => {
        for (let k = 1; k <= PLANK_REACH; k++) if (draft.cells[i + step * k] === Cell.Pit) return true;
        return false;
      };
      let planks = 0;
      for (let y = PLANK_REACH; y < frame.height - PLANK_REACH; y++) {
        for (let x = PLANK_REACH; x < frame.width - PLANK_REACH; x++) {
          const i = y * frame.width + x;
          if (draft.cells[i] !== Cell.Floor) continue;
          if ((pitWithin(i, -1) && pitWithin(i, 1)) || (pitWithin(i, -frame.width) && pitWithin(i, frame.width))) planks++;
        }
      }
      expect(planks, `seed=${seed} の桟道のマス`).toBeGreaterThan(0);
    }
  });

  it("面積が広いほど外の部屋が増える（部屋の数は countMul 倍）", () => {
    const mean = (area: number): number => {
      const counts = SEEDS.map((seed) => draftOf(area, seed).draft?.nodes.length ?? 0).filter((n) => n > 0);
      return counts.reduce((a, b) => a + b, 0) / counts.length;
    };
    expect(mean(5), "面積 5 倍の平均の部屋数").toBeGreaterThan(mean(1) * 1.3);
  });

  it("同じ rng・枠なら同じ下書きになる", () => {
    for (const seed of [1, 2, 3]) {
      const a = freshDraft(3.5, seed).draft;
      const b = freshDraft(3.5, seed).draft;
      expect(a === null, `seed=${seed}`).toBe(b === null);
      if (!a || !b) continue;
      expect(Array.from(a.cells), `seed=${seed} のセル`).toEqual(Array.from(b.cells));
      expect(a.nodes, `seed=${seed} のノード`).toEqual(b.nodes);
    }
  });

  it("共通の後処理と検査（8 項目）に通り、型が記録される。面積 1 / 3.5 / 5 倍の 20 seed で作り直しも含めて全部作れる", () => {
    for (const area of [1, 3.5, 5]) {
      const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
      for (const seed of SEEDS) {
        const map = generateLayoutMap("ring", createRng(seed), o.width, o.height);
        expect(map, `面積 ${area} seed=${seed}`).not.toBeNull();
        if (!map) continue;
        expect(validateLayout(map), `面積 ${area} seed=${seed}`).toBeNull();
        expect(map.layout).toBe("ring");
        expect(map.tiles.includes(Tile.StairsDown)).toBe(true);
      }
    }
  });

  it("下書きから finalize した直後の検査の落ち（作り直し）が 20 seed の 3 割未満", () => {
    let fails = 0;
    for (const seed of SEEDS) {
      const { draft, frame } = draftOf(3.5, seed);
      const map = draft ? finalizeLayout("ring", draft, frame) : null;
      if (!map || validateLayout(map) !== null) fails++;
    }
    expect(fails / SEEDS.length, "最初の試行の失敗率").toBeLessThan(0.3);
  });

  it("面積 5 倍で 1 階の生成（形づくり + 後処理 + 検査）が平均 150ms 以下", () => {
    const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, 5);
    const start = performance.now();
    for (const seed of SEEDS.slice(0, 10)) generateLayoutMap("ring", createRng(seed), o.width, o.height);
    expect((performance.now() - start) / 10, "1 階あたりの ms").toBeLessThan(MAX_AVG_MS);
  });
});
