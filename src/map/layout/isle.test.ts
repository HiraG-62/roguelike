import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { DEFAULT_GENERATOR_OPTIONS, scaleGeneratorOptions } from "../generator";
import { type GameMap, Tile } from "../grid";
import { NEIGHBORS_8 } from "../regions";
import { generateLayoutMap as generate, layoutFrameFor } from "./index";
import { generateIsle } from "./isle";
import { Cell, type LayoutDraft } from "./types";
import { validateLayout } from "./validate";

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
/**
 * 扉（島に属さない床で島に接する所）の周りに穴がなければならない範囲（チェビシェフ距離）。
 * 桟道は穴の上に架かる幅 3 以下の床なので、島の縁をかすめる桟道でも 3 マス以内に穴がある。
 * 島の内側に残った「部屋から外れた床」（桟道でない扉）は、島が大きいのでこの範囲に穴が無い
 */
const PLANK_NEAR_PIT = 3;

function sizeFor(area: number): { width: number; height: number } {
  const o = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, area);
  return { width: o.width, height: o.height };
}

function generateLayoutMap(seed: number, w: number, h: number): GameMap | null {
  return generate("isle", createRng(seed), w, h);
}

function generateIsleDraft(seed: number, w: number, h: number): LayoutDraft | null {
  const rng = createRng(seed);
  return generateIsle(rng, layoutFrameFor(w, h, rng.int(0, 0x7fffffff)));
}

/** 島の扉: どの部屋にも属さない通れる床のうち、8 近傍のどこかが部屋のタイルのマス */
function doorTiles(map: GameMap): number[] {
  const owner = new Uint8Array(map.tiles.length);
  for (const tiles of map.roomTiles ?? []) for (const t of tiles) owner[t] = 1;
  const doors: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    const tile = map.tiles[i];
    if (owner[i] || (tile !== Tile.Floor && tile !== Tile.StairsDown)) continue;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    const touches = NEIGHBORS_8.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && owner[ny * map.width + nx] === 1;
    });
    if (touches) doors.push(i);
  }
  return doors;
}

function pitWithin(map: GameMap, i: number, radius: number): boolean {
  const x = i % map.width;
  const y = Math.floor(i / map.width);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (map.tiles[ny * map.width + nx] === Tile.Pit) return true;
    }
  }
  return false;
}

describe("isle（島と桟道）", () => {
  const { width, height } = sizeFor(5);

  it("島の外はすべて穴（岩の壁は外周だけ）。浅瀬は無い", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const draft = generateIsleDraft(seed, width, height);
      expect(draft, `seed=${seed}`).not.toBeNull();
      if (!draft) continue;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          expect(draft.cells[y * width + x], `seed=${seed} (${x},${y}) は床か穴`).not.toBe(Cell.Wall);
        }
      }
      expect(
        draft.shallow.every((v) => v === 0),
        `seed=${seed} 浅瀬`,
      ).toBe(true);
    }
  });

  it("島の扉は桟道の上だけ: 島に属さない床で島に接するマスは、必ず近くに穴がある（穴の上に架かる床）", () => {
    let doors = 0;
    for (const seed of SEEDS) {
      const map = generateLayoutMap(seed, width, height);
      if (!map) continue;
      for (const i of doorTiles(map)) {
        doors++;
        expect(pitWithin(map, i, PLANK_NEAR_PIT), `seed=${seed} 扉 (${i % map.width},${Math.floor(i / map.width)}) の近くに穴がない`).toBe(true);
      }
    }
    expect(doors, "扉（桟道の端）が 1 つもない").toBeGreaterThan(0);
  });

  it("島は部屋: 通れる床のほとんど（9 割以上）がどれかの島（部屋）に属し、島の数は 8 以上", () => {
    let generated = 0;
    for (const seed of SEEDS) {
      const map = generateLayoutMap(seed, width, height);
      if (!map) continue;
      generated++;
      const inRoom = new Set((map.roomTiles ?? []).flat());
      let floor = 0;
      for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === Tile.Floor || map.tiles[i] === Tile.StairsDown) floor++;
      expect(inRoom.size / floor, `seed=${seed} 島の床の割合`).toBeGreaterThanOrEqual(0.9);
      expect(map.rooms.length, `seed=${seed} 島の数`).toBeGreaterThanOrEqual(8);
    }
    expect(generated, "島の地図が生成される").toBeGreaterThan(0);
  });

  it("島の数が 2 系統に分かれる: 多島（小島がたくさん）と大島（大きな島が少し）の両方が出る", () => {
    const counts = SEEDS.map((seed) => generateIsleDraft(seed, width, height)?.nodes.length ?? 0).filter((n) => n > 0);
    expect(Math.max(...counts), "多島の島の数").toBeGreaterThanOrEqual(24);
    expect(Math.min(...counts), "大島の島の数").toBeLessThanOrEqual(22);
  });

  it("開始と主の間は別の島で、検査（階段・幅 2 の道・部屋の間隔など）に通る", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const map = generateLayoutMap(seed, width, height);
      if (!map) continue;
      expect(validateLayout(map), `seed=${seed}`).toBeNull();
      expect(map.rooms.length, `seed=${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("面積 5 倍の生成は 1 階あたり平均 150ms 以下（目標は 40ms。CI のぶれ対策で緩い）", () => {
    for (const seed of SEEDS.slice(0, 5)) generateLayoutMap(seed + 100, width, height); // 初回の JIT を除く
    const t0 = performance.now();
    for (const seed of SEEDS) generateLayoutMap(seed, width, height);
    const mean = (performance.now() - t0) / SEEDS.length;
    expect(mean, `平均 ${mean.toFixed(1)}ms`).toBeLessThanOrEqual(150);
  });
});

describe("isle の決定性", () => {
  it("同じ rng・同じ大きさなら下書きのセルもノードも同じ", () => {
    const { width, height } = sizeFor(3.5);
    const a = generateIsleDraft(7, width, height);
    const b = generateIsleDraft(7, width, height);
    expect(Array.from(a?.cells ?? [])).toEqual(Array.from(b?.cells ?? []));
    expect(a?.nodes).toEqual(b?.nodes);
  });
});
