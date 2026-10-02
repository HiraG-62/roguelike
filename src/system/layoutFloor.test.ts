import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import type { GameState, RoomState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { MAP_SIZE } from "../data/tuning";
import { TILE_SIZE, Tile, createMap, getTile, toIndex } from "../map/grid";
import { GENERATE_ATTEMPTS, LAYOUT_GENERATORS, layoutFrameFor } from "../map/layout/index";
import { chooseLayout, withFixedLayout } from "../map/layout/select";
import { Cell, type FloorLayout, LAYOUT_KINDS, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutKind, type LayoutNode } from "../map/layout/types";
import { isBossDepth } from "./boss";
import { createEnemy } from "./enemies";
import { buildFloor, floorLayoutContext, generateFloorMap, updateRooms, withBaseAreaMul } from "./floor";

/**
 * 階の型 8 種と floor の結線（docs/ideas/map-gen-impl.md 2-6 の「結線のテスト」）。
 * 型の生成器がまだスタブ（null）なら旧生成器に落ちることを、地図を返すようになれば中身を同じ検査で見る
 */

const SEED = 7;
/** 生成器のスタブを見分けるために試す seed の数 */
const STUB_PROBES = 3;
const NOISE_SEED_MAX = 0x7fffffff;

/** 生成器が試した seed で 1 度も下書きを返さない（スタブ） */
function isStub(kind: LayoutKind): boolean {
  const frame = layoutFrameFor(MAP_SIZE.baseWidth, MAP_SIZE.baseHeight, 1);
  for (let s = 1; s <= STUB_PROBES; s++) {
    if (LAYOUT_GENERATORS[kind](createRng(s), frame)) return false;
  }
  return true;
}

/** fn の間だけ kind の生成器を差し替える（モジュールの表を書き換えるので必ず戻す） */
function withGenerator<T>(kind: LayoutKind, gen: LayoutGenerator, fn: () => T): T {
  const saved = LAYOUT_GENERATORS[kind];
  LAYOUT_GENERATORS[kind] = gen;
  try {
    return fn();
  } finally {
    LAYOUT_GENERATORS[kind] = saved;
  }
}

function tileUnder(state: GameState, pos: { x: number; y: number }): number {
  return getTile(state.map, Math.floor(pos.x / TILE_SIZE), Math.floor(pos.y / TILE_SIZE));
}

/** 結線の共通の検査: 型の記録・扉・穴の上の湧き・陣 */
function expectSaneFloor(state: GameState, label: string): void {
  expect(state.floorLayout, `${label}: 記録した型は地図の型`).toBe(state.map.layout);
  state.rooms.forEach((room, i) => {
    if (i === 0) return;
    expect(room.doorTiles.length, `${label}: 部屋 ${i} に扉がある`).toBeGreaterThan(0);
  });
  for (const e of state.enemies) {
    expect(tileUnder(state, e.body.pos), `${label}: 敵 ${e.defKey} が穴の上に湧かない`).not.toBe(Tile.Pit);
  }
  for (const p of [...state.pickups, ...state.floorItems, ...state.skills.floorStones]) {
    expect(tileUnder(state, p.pos), `${label}: 拾い物が穴の上に無い`).not.toBe(Tile.Pit);
  }
  if (!isBossDepth(state.depth)) expect(state.jins.length, `${label}: 陣が 1 つ以上`).toBeGreaterThan(0);
}

/** 盤面の要約（同じ seed で同じ結果かを見る） */
function summary(state: GameState): string {
  const enemies = state.enemies.map((e) => `${e.defKey}@${e.body.pos.x.toFixed(3)},${e.body.pos.y.toFixed(3)}`).join(";");
  return [state.floorLayout, state.map.width, state.map.height, state.map.tiles.join(""), enemies, state.rng.next()].join("|");
}

describe("階の型と floor の結線", () => {
  for (const kind of LAYOUT_KINDS) {
    it(`${kind} を固定して階を作る（作れなければ旧生成器に落ちる）`, () => {
      const state = withFixedLayout(kind, () => createGame(SEED));
      expect([kind, "legacy"], "型か旧生成器のどちらか").toContain(state.floorLayout);
      if (isStub(kind)) expect(state.floorLayout, "スタブの型は旧生成器に落ちる").toBe("legacy");
      expectSaneFloor(state, kind);
      if (state.floorLayout === kind) {
        // 生成器が地図を返した: 型の地図のまま floor が組み上がる
        expect(state.rooms.length, "部屋の数は地図と同じ").toBe(state.map.rooms.length);
      }
    });
  }

  it("同じ seed・同じ型なら同じ階になる", () => {
    for (const kind of ["cavern", "river"] as const) {
      const a = withFixedLayout(kind, () => createGame(SEED));
      const b = withFixedLayout(kind, () => createGame(SEED));
      expect(summary(a), kind).toBe(summary(b));
    }
  });

  it("型の生成が全部落ちたら同じ乱数のまま旧生成器へ（試行ごとに雑音の種を 1 回だけ引く）", () => {
    const failing = (): LayoutDraft | null => null;
    const a = withBaseAreaMul(() => createGame(SEED));
    const b = withBaseAreaMul(() => createGame(SEED));
    const mapA = withGenerator("cavern", failing, () => generateFloorMap(a, "cavern"));
    for (let i = 0; i < GENERATE_ATTEMPTS; i++) b.rng.int(0, NOISE_SEED_MAX);
    const mapB = generateFloorMap(b, "legacy");
    expect(mapA.layout).toBe("legacy");
    expect(mapA.tiles.join(""), "旧生成器と同じ地図").toBe(mapB.tiles.join(""));
    expect(a.rng.next(), "乱数の消費も同じ").toBe(b.rng.next());
  });

  it("ボス階は型の抽選でも地図の生成でも乱数を引かず、\"lordHall\" を記録する", () => {
    const bossDepth = 5;
    expect(isBossDepth(bossDepth), "深度 5 はボス階").toBe(true);
    const a = withBaseAreaMul(() => createGame(SEED));
    const b = withBaseAreaMul(() => createGame(SEED));
    a.depth = bossDepth;
    b.depth = bossDepth;
    expect(chooseLayout(a.rng, floorLayoutContext(a))).toBe("lordHall");
    expect(generateFloorMap(a, "lordHall").layout).toBe("lordHall");
    expect(a.rng.next(), "型の抽選と地図の生成で乱数を消費しない").toBe(b.rng.next());
    buildFloor(a);
    expect(a.floorLayout).toBe("lordHall");
  });

  it("前の階の型を文脈に渡し、同じ型を続けない", () => {
    const state = withBaseAreaMul(() => createGame(SEED));
    for (const previous of LAYOUT_KINDS) {
      state.floorLayout = previous;
      const ctx = floorLayoutContext(state);
      expect(ctx.previous, "前の階の型を読む").toBe(previous);
      for (let s = 1; s <= 40; s++) {
        expect(chooseLayout(createRng(s), ctx), `seed=${s} 前の階 ${previous}`).not.toBe(previous);
      }
    }
  });

  it("続けて降りても、型の地図が続くときは同じ型が並ばない", () => {
    const state = createGame(SEED);
    const seen: (FloorLayout | undefined)[] = [state.floorLayout];
    for (let depth = 2; depth <= 4; depth++) {
      state.depth = depth;
      buildFloor(state);
      seen.push(state.floorLayout);
      expectSaneFloor(state, `深度 ${depth}`);
    }
    for (let i = 1; i < seen.length; i++) {
      const prev = seen[i - 1];
      const cur = seen[i];
      if (prev === "legacy" || cur === "legacy") continue;
      expect(cur, `${i} 階目と前の階`).not.toBe(prev);
    }
  });
});

// -----------------------------------------------------------------------------
// 手で作った穴入りの下書き
// -----------------------------------------------------------------------------

const GRID_COLS = [14, 37, 60, 83] as const;
const GRID_ROWS = [11, 28, 45] as const;
const ROOM_HALF_W = 7;
const ROOM_HALF_H = 5;
const CORRIDOR_HALF = 2;
/** 部屋 (37, 28) の中の穴の池（半幅） */
const POND = { x: 37, y: 28, halfW: 2, halfH: 1 } as const;

function fillRect(cells: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, v: Cell): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells[y * w + x] = v;
  }
}

/** 4 x 3 の格子の部屋を幅 5 の廊下でつなぎ、真ん中の部屋に穴の池を置いた下書き。左上が開始、右下が主の間 */
const pitGridGenerator: LayoutGenerator = (_rng, frame: LayoutFrame) => {
  const { width: w, height: h } = frame;
  const cells = new Uint8Array(w * h).fill(Cell.Wall);
  for (const y of GRID_ROWS) fillRect(cells, w, GRID_COLS[0], y - CORRIDOR_HALF, GRID_COLS[3], y + CORRIDOR_HALF, Cell.Floor);
  for (const x of GRID_COLS) fillRect(cells, w, x - CORRIDOR_HALF, GRID_ROWS[0], x + CORRIDOR_HALF, GRID_ROWS[2], Cell.Floor);
  const nodes: LayoutNode[] = [];
  GRID_ROWS.forEach((cy, r) => {
    GRID_COLS.forEach((cx, c) => {
      fillRect(cells, w, cx - ROOM_HALF_W, cy - ROOM_HALF_H, cx + ROOM_HALF_W, cy + ROOM_HALF_H, Cell.Floor);
      const first = r === 0 && c === 0;
      const last = r === GRID_ROWS.length - 1 && c === GRID_COLS.length - 1;
      nodes.push({ x: cx + 0.5, y: cy + 0.5, role: first ? "start" : last ? "lord" : "room", grow: 0, tiles: [] });
    });
  });
  fillRect(cells, w, POND.x - POND.halfW, POND.y - POND.halfH, POND.x + POND.halfW, POND.y + POND.halfH, Cell.Pit);
  // 部屋のタイル = 矩形の床（穴を除く）。廊下はどの部屋にも属さない
  for (const node of nodes) {
    const cx = Math.floor(node.x);
    const cy = Math.floor(node.y);
    const tiles: number[] = [];
    for (let y = cy - ROOM_HALF_H; y <= cy + ROOM_HALF_H; y++) {
      for (let x = cx - ROOM_HALF_W; x <= cx + ROOM_HALF_W; x++) {
        if (cells[y * w + x] === Cell.Floor) tiles.push(y * w + x);
      }
    }
    node.tiles = tiles;
  }
  return { cells, shallow: new Uint8Array(w * h), nodes };
};

describe("手で作った穴入りの下書きで floor を通す", () => {
  const build = (seed: number): GameState =>
    withGenerator("cavern", pitGridGenerator, () => withFixedLayout("cavern", () => withBaseAreaMul(() => createGame(seed))));

  it("型の地図のまま階ができ、穴は残り、扉・湧き・陣が成り立つ", () => {
    const state = build(SEED);
    expect(state.floorLayout, "生成器の地図を使う").toBe("cavern");
    expect(state.map.width).toBe(MAP_SIZE.baseWidth);
    expect(state.map.tiles[toIndex(state.map, POND.x, POND.y)], "穴が残る").toBe(Tile.Pit);
    expect(state.rooms.length, "格子の部屋の数").toBe(GRID_COLS.length * GRID_ROWS.length);
    expectSaneFloor(state, "手で作った下書き");
    expect(state.boss?.roomIndex, "階の主は最後の部屋（主の間）").toBe(state.rooms.length - 1);
    const lordRect = state.rooms[state.rooms.length - 1]?.rect;
    expect(lordRect && lordRect.x > GRID_COLS[2] && lordRect.y > GRID_ROWS[1], "主の間は右下").toBe(true);
  });

  it("同じ seed なら同じ結果", () => {
    expect(summary(build(SEED))).toBe(summary(build(SEED)));
  });
});

// -----------------------------------------------------------------------------
// 封鎖中に穴の向こう岸へ残った敵を寄せる
// -----------------------------------------------------------------------------

const ROW_TOP = 5;
const ROW_BOTTOM = 8;
const A_LEFT = 5;
const A_RIGHT = 8;
const PIT_COLUMN = 9;
const B_RIGHT = 13;
const STRAY_CHECK_TICKS = Math.round(1 / FIXED_DT);
const OFF_BEAT_TICK = 1;

function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

/** 塊の部屋を穴の 1 列（どの部屋にも属さない）が左右に分ける。穴は扉にならない */
function pitSplitState(): { state: GameState; room: RoomState } {
  const state = createGame(1);
  const map = createMap(24, 14);
  const tiles: number[] = [];
  for (let y = ROW_TOP; y <= ROW_BOTTOM; y++) {
    for (let x = A_LEFT; x <= B_RIGHT; x++) {
      const i = toIndex(map, x, y);
      if (x === PIT_COLUMN) {
        map.tiles[i] = Tile.Pit;
        continue;
      }
      map.tiles[i] = Tile.Floor;
      tiles.push(i);
    }
  }
  state.map = map;
  const room: RoomState = {
    rect: { x: A_LEFT, y: ROW_TOP, w: B_RIGHT - A_LEFT + 1, h: ROW_BOTTOM - ROW_TOP + 1 },
    cleared: false,
    locked: false,
    doorTiles: [],
    kind: "challenge",
    wave: 0,
    used: false,
    tiles: new Set(tiles),
  };
  state.rooms = [room];
  state.lockedTiles = new Set();
  state.enemies = [];
  state.player.body.pos = tileCenter(6, 6);
  return { state, room };
}

describe("封鎖中に穴の向こう岸に残った敵", () => {
  it("1 秒ごとの見回りで、歩いて届く側の一番近いタイルへ寄せられる", () => {
    const { state, room } = pitSplitState();
    state.tick = OFF_BEAT_TICK;
    updateRooms(state, FIXED_DT);
    expect(room.locked, "部屋が封鎖される").toBe(true);
    state.enemies = [];
    const stray = createEnemy(state, enemyDef("slime"), tileCenter(11, 6), 0, false);
    state.enemies.push(stray);

    state.tick = STRAY_CHECK_TICKS;
    updateRooms(state, FIXED_DT);
    expect(stray.body.pos, "穴の手前（x=8, y=6）へ寄せる").toEqual(tileCenter(A_RIGHT, 6));
  });
});

// -----------------------------------------------------------------------------
// 計測
// -----------------------------------------------------------------------------

const BUILD_RUNS = 10;
/** CI のぶれで落ちないよう緩い上限（実際の数字はログに出す） */
const BUILD_BUDGET_MS = 2000;

describe("階の生成の時間", () => {
  it(`createGame の後に buildFloor を ${BUILD_RUNS} 回`, () => {
    const state = createGame(SEED);
    const t0 = performance.now();
    for (let i = 0; i < BUILD_RUNS; i++) {
      state.depth = 1 + i;
      buildFloor(state);
    }
    const avg = (performance.now() - t0) / BUILD_RUNS;
    console.info(`[layoutFloor] buildFloor 平均 ${avg.toFixed(1)}ms（${BUILD_RUNS} 回、深度 1〜${BUILD_RUNS}）`);
    expect(avg, "1 階の生成の平均").toBeLessThan(BUILD_BUDGET_MS);
  });
});
