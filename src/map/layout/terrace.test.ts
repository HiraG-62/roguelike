import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { Tile } from "../grid";
import { finalizeLayout } from "./finalize";
import { generateLayoutMap, layoutFrameFor } from "./index";
import { generateTerrace, terraceBandCount } from "./terrace";
import { Cell, type LayoutDraft, type LayoutFrame } from "./types";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** 縦穴の有無を見分けるために多めに回す seed */
const MANY_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
/** 生成 1 回あたりの平均の上限（ms。設計の予算は 40ms。CI のぶれを見込んで 150ms で落とす） */
const MAX_AVG_MS = 150;

/** 毎回作り直す（決定性の確認用） */
function freshDraft(area: number, seed: number): { draft: LayoutDraft | null; frame: LayoutFrame } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  const rng = createRng(seed);
  const frame = layoutFrameFor(o.width, o.height, rng.int(0, 0x7fffffff));
  return { draft: generateTerrace(rng, frame), frame };
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

function ownerOf(draft: LayoutDraft, size: number): Int16Array {
  const owner = new Int16Array(size).fill(-1);
  draft.nodes.forEach((node, id) => {
    for (const t of node.tiles ?? []) owner[t] = id;
  });
  return owner;
}

describe("terraceBandCount（段の数）", () => {
  it("段の数 = 地図の高さ ÷ (40 × unit) × 3〜5。面積が広いほど多い", () => {
    const small = layoutFrameFor(96, 56);
    const large = layoutFrameFor(215, 125);
    const ratio = (f: LayoutFrame): number => f.height / (MAP_LAYOUT.previewHeight * f.unit);
    expect(terraceBandCount(large, 0)).toBe(Math.round(ratio(large) * 3));
    expect(terraceBandCount(large, 0.99)).toBe(Math.round(ratio(large) * 5));
    expect(terraceBandCount(large, 0.5)).toBeGreaterThan(terraceBandCount(small, 0.5) - 1);
    expect(terraceBandCount(large, 0.99)).toBeGreaterThan(terraceBandCount(large, 0));
  });

  it("どんな枠でも 3 段以上", () => {
    expect(terraceBandCount(layoutFrameFor(40, 24), 0)).toBeGreaterThanOrEqual(3);
  });
});

describe("generateTerrace（縦穴・段々）", () => {
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

  it("開始は上の段、主の間は下の段にあり、坂とはしごで降りていく", () => {
    for (const seed of SEEDS) {
      const { draft, frame } = draftOf(3.5, seed);
      if (!draft) continue;
      const start = draft.nodes.find((n) => n.role === "start");
      const lord = draft.nodes.find((n) => n.role === "lord");
      expect(start?.y ?? Infinity, `seed=${seed} の開始の高さ`).toBeLessThan(frame.height / 3);
      expect(lord?.y ?? 0, `seed=${seed} の主の間の高さ`).toBeGreaterThan((frame.height * 2) / 3);
    }
  });

  it("1 つの段は区切りの縦の列（扉）で部屋に分かれ、区切りの列は部屋に入らない", () => {
    for (const seed of SEEDS) {
      const { draft, frame } = draftOf(3.5, seed);
      if (!draft) continue;
      const owner = ownerOf(draft, frame.width * frame.height);
      let doors = 0;
      for (let y = 0; y < frame.height; y++) {
        for (let x = 1; x < frame.width - 1; x++) {
          const i = y * frame.width + x;
          if (draft.cells[i] !== Cell.Floor || (owner[i] ?? -1) >= 0) continue;
          const left = owner[i - 1] ?? -1;
          const right = owner[i + 1] ?? -1;
          if (left >= 0 && right >= 0 && left !== right) doors++;
        }
      }
      expect(doors, `seed=${seed} の区切りの列のマス`).toBeGreaterThanOrEqual(10);
    }
  });

  it("段の幅 ÷ 18u の数だけ部屋ができる（面積 5 倍は 1 段に複数の部屋）", () => {
    for (const seed of SEEDS) {
      const { draft, frame } = draftOf(5, seed);
      if (!draft) continue;
      expect(draft.nodes.length, `seed=${seed} の部屋数`).toBeGreaterThanOrEqual(terraceBandCount(frame, 0) * 3);
    }
  });

  it("3 割強の階には縦穴（穴）があり、穴のある階は各段に橋（上が穴の床の行）が架かる", () => {
    let shafts = 0;
    for (const seed of MANY_SEEDS) {
      const { draft, frame } = draftOf(3.5, seed);
      if (!draft) continue;
      let pits = 0;
      for (const c of draft.cells) if (c === Cell.Pit) pits++;
      if (pits === 0) continue;
      shafts++;
      const planks = new Set<number>();
      for (let y = 1; y < frame.height - 1; y++) {
        for (let x = 1; x < frame.width - 1; x++) {
          const i = y * frame.width + x;
          if (draft.cells[i] === Cell.Floor && draft.cells[i - frame.width] === Cell.Pit) planks.add(y);
        }
      }
      expect(planks.size, `seed=${seed} の橋の行`).toBeGreaterThanOrEqual(terraceBandCount(frame, 0));
    }
    expect(shafts, "縦穴のある seed").toBeGreaterThan(0);
    expect(shafts, "縦穴のない seed も出る").toBeLessThan(MANY_SEEDS.length);
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
        const map = generateLayoutMap("terrace", createRng(seed), o.width, o.height);
        expect(map, `面積 ${area} seed=${seed}`).not.toBeNull();
        if (!map) continue;
        expect(validateLayout(map), `面積 ${area} seed=${seed}`).toBeNull();
        expect(map.layout).toBe("terrace");
        expect(map.tiles.includes(Tile.StairsDown)).toBe(true);
      }
    }
  });

  it("下書きから finalize した直後の検査の落ち（作り直し）が 20 seed の 3 割未満", () => {
    let fails = 0;
    for (const seed of SEEDS) {
      const { draft, frame } = draftOf(3.5, seed);
      const map = draft ? finalizeLayout("terrace", draft, frame) : null;
      if (!map || validateLayout(map) !== null) fails++;
    }
    expect(fails / SEEDS.length, "最初の試行の失敗率").toBeLessThan(0.3);
  });

  it("面積 5 倍で 1 階の生成（形づくり + 後処理 + 検査）が平均 150ms 以下", () => {
    const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, 5);
    const start = performance.now();
    for (const seed of SEEDS.slice(0, 10)) generateLayoutMap("terrace", createRng(seed), o.width, o.height);
    expect((performance.now() - start) / 10, "1 階あたりの ms").toBeLessThan(MAX_AVG_MS);
  });
});
