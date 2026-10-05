import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { terrainCode } from "../../core/terrain";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { type GameMap, Tile } from "../grid";
import { NEIGHBORS_4 } from "../regions";
import { generateLayoutMap as generate, layoutFrameFor } from "./index";
import { generateRiver } from "./river";
import type { LayoutDraft } from "./types";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** 面積の倍率 → 地図の大きさ（本体の階の大きさと同じ式） */
function sizeFor(area: number): { width: number; height: number } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  return { width: o.width, height: o.height };
}

function generateLayoutMap(kind: "river", seed: number, w: number, h: number): GameMap | null {
  return generate(kind, createRng(seed), w, h);
}

/** 型の下書きだけ（後処理・検査の前）。枠は generateLayoutMap と同じ作り方 */
function generateRiverDraft(seed: number, w: number, h: number): LayoutDraft | null {
  const rng = createRng(seed);
  return generateRiver(rng, layoutFrameFor(w, h, rng.int(0, 0x7fffffff)));
}

/** 4 近傍で連結な、条件を満たすマスの塊の数 */
function countComponents(width: number, height: number, test: (i: number) => boolean): number {
  const seen = new Uint8Array(width * height);
  let count = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !test(start)) continue;
    count++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (seen[ni] || !test(ni)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return count;
}

/** 川（穴）が橋と浅瀬で何個の欠片に切られているか（渡り場所の数 + 1 に近い） */
function pitPieces(map: GameMap): number {
  return countComponents(map.width, map.height, (i) => map.tiles[i] === Tile.Pit);
}

/** 渡り場所（橋・浅瀬）のマス: 穴が左右（または上下）の 3 マス以内に両側ある床。川の上に架かる床だけが当てはまる */
function crossingTiles(map: GameMap): Uint8Array {
  const reach = 3;
  const out = new Uint8Array(map.tiles.length);
  const pitAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.width && y < map.height && map.tiles[y * map.width + x] === Tile.Pit;
  const near = (x: number, y: number, dx: number, dy: number): boolean => {
    for (let k = 1; k <= reach; k++) if (pitAt(x + dx * k, y + dy * k)) return true;
    return false;
  };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      if (map.tiles[i] !== Tile.Floor) continue;
      const shallow = (map.shallow?.[i] ?? 0) !== 0;
      const between = (near(x, y, -1, 0) && near(x, y, 1, 0)) || (near(x, y, 0, -1) && near(x, y, 0, 1)) || (near(x, y, -1, -1) && near(x, y, 1, 1)) || (near(x, y, -1, 1) && near(x, y, 1, -1));
      if (shallow || between) out[i] = 1;
    }
  }
  return out;
}

describe("river（谷・川筋）", () => {
  const { width, height } = sizeFor(5);

  it("川は穴で、河原と洞は床。床と穴の両方があり、穴は地図の上下の外周のマスに乗らない（外周は後処理が壁で閉じる）", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const draft = generateRiverDraft(seed, width, height);
      expect(draft, `seed=${seed}`).not.toBeNull();
      if (!draft) continue;
      const kinds = new Set(draft.cells);
      expect(kinds.has(0) && kinds.has(2), `seed=${seed} 床と穴の両方がある`).toBe(true);
      for (let x = 0; x < width; x++) {
        expect(draft.cells[x], `seed=${seed} 上の外周`).not.toBe(2);
        expect(draft.cells[(height - 1) * width + x], `seed=${seed} 下の外周`).not.toBe(2);
      }
    }
  });

  it("渡り場所が 3 か所以上（橋 2 本以上 + 浅瀬 1 か所以上）: 川の穴が 4 つ以上の欠片に切られ、浅瀬（水の地形）がある", () => {
    const water = terrainCode("water");
    for (const seed of SEEDS) {
      const map = generateLayoutMap("river", seed, width, height);
      expect(map, `seed=${seed}`).not.toBeNull();
      if (!map) continue;
      expect(pitPieces(map), `seed=${seed} 穴の欠片`).toBeGreaterThanOrEqual(4);
      const shallow = map.shallow;
      expect(shallow, `seed=${seed} 浅瀬の下書きが写っている`).toBeDefined();
      const cells = Array.from(shallow ?? []).filter((v) => v !== 0);
      expect(cells.length, `seed=${seed} 浅瀬のマス`).toBeGreaterThan(0);
      expect(
        cells.every((v) => v === water),
        `seed=${seed} 浅瀬は水の地形番号`,
      ).toBe(true);
      // 浅瀬は床の上にだけある
      (shallow ?? []).forEach((v, i) => {
        if (v !== 0) expect(map.tiles[i], `seed=${seed} 浅瀬は床の上`).toBe(Tile.Floor);
      });
    }
  });

  it("渡り場所を塞ぐと両岸に分かれ、開始と主の間は別の岸にあり、どちらの岸にも部屋が 3 つ以上ある", () => {
    for (const seed of SEEDS) {
      const map = generateLayoutMap("river", seed, width, height);
      expect(map, `seed=${seed}`).not.toBeNull();
      if (!map) continue;
      const cross = crossingTiles(map);
      const label = new Int32Array(map.tiles.length).fill(-1);
      let comps = 0;
      for (let s = 0; s < label.length; s++) {
        if (label[s] !== -1 || cross[s] || map.tiles[s] === Tile.Wall || map.tiles[s] === Tile.Pit) continue;
        const stack: number[] = [s];
        label[s] = comps;
        while (stack.length > 0) {
          const i: number = stack.pop() ?? 0;
          const x: number = i % map.width;
          const y: number = Math.floor(i / map.width);
          for (const [dx, dy] of NEIGHBORS_4) {
            const ni = (y + dy) * map.width + x + dx;
            if (label[ni] !== -1 || cross[ni] || map.tiles[ni] === Tile.Wall || map.tiles[ni] === Tile.Pit) continue;
            label[ni] = comps;
            stack.push(ni);
          }
        }
        comps++;
      }
      const rooms = map.roomTiles ?? [];
      const bankOf = (tiles: readonly number[] | undefined): number => label[tiles?.find((t) => label[t] !== -1) ?? 0] ?? -1;
      const start = bankOf(rooms[0]);
      const lord = bankOf(rooms[rooms.length - 1]);
      expect(start, `seed=${seed} 開始の岸`).toBeGreaterThanOrEqual(0);
      expect(lord, `seed=${seed} 主の間の岸`).toBeGreaterThanOrEqual(0);
      expect(start, `world.MAP_LAYOUT.river: seed=${seed} 開始と主の間は別の岸`).not.toBe(lord);
      const perBank = new Map<number, number>();
      for (const tiles of rooms) {
        const bank = bankOf(tiles);
        perBank.set(bank, (perBank.get(bank) ?? 0) + 1);
      }
      expect(perBank.get(start) ?? 0, `seed=${seed} 開始の岸の部屋数`).toBeGreaterThanOrEqual(3);
      expect(perBank.get(lord) ?? 0, `seed=${seed} 主の間の岸の部屋数`).toBeGreaterThanOrEqual(3);
    }
  });

  it("橋の本数は川の長さに比例して増える（面積 5 倍は面積 1 倍より渡り場所が多い）", () => {
    const small = sizeFor(1);
    const mean = (w: number, h: number): number => {
      let total = 0;
      let n = 0;
      for (const seed of SEEDS) {
        const map = generateLayoutMap("river", seed, w, h);
        if (!map) continue;
        total += pitPieces(map);
        n++;
      }
      return total / Math.max(1, n);
    };
    expect(mean(width, height), "面積 5 倍の穴の欠片の平均").toBeGreaterThan(mean(small.width, small.height));
  });

  it("作れた地図は共通の検査（階段・幅 2 の道・部屋の間隔など）に通る", () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const map = generateLayoutMap("river", seed, width, height);
      expect(map && validateLayout(map), `seed=${seed}`).toBeNull();
    }
  });

  it("面積 5 倍の生成は 1 階あたり平均 150ms 以下（目標は 40ms。CI のぶれ対策で緩い）", () => {
    for (const seed of SEEDS.slice(0, 5)) generateLayoutMap("river", seed + 100, width, height); // 初回の JIT を除く
    const t0 = performance.now();
    for (const seed of SEEDS) generateLayoutMap("river", seed, width, height);
    const mean = (performance.now() - t0) / SEEDS.length;
    expect(mean, `平均 ${mean.toFixed(1)}ms`).toBeLessThanOrEqual(150);
  });
});

describe("river の決定性", () => {
  it("同じ rng・同じ大きさなら下書きのセルも浅瀬もノードも同じ", () => {
    const { width, height } = sizeFor(3.5);
    const a = generateRiverDraft(7, width, height);
    const b = generateRiverDraft(7, width, height);
    expect(Array.from(a?.cells ?? [])).toEqual(Array.from(b?.cells ?? []));
    expect(Array.from(a?.shallow ?? [])).toEqual(Array.from(b?.shallow ?? []));
    expect(a?.nodes).toEqual(b?.nodes);
  });
});
