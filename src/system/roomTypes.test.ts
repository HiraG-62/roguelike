import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import type { GameState, RoomKind } from "../core/state";
import { ENEMIES } from "../data/enemies";
import { FLOOR_KIND, MINIMAP, ROOM, ROOM_KIND } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, isWalkable, rectCenterPx, toIndex } from "../map/grid";
import { isBossDepth } from "./boss";
import { buildFloor, descend, enemyCount, insideRoom } from "./floor";
import { applyCurse, chooseFloorKind, fountainPx, isCaveDepth, isDark } from "./roomTypes";
import { placeEnemy, withInput } from "./testHelpers";

const SEARCH_SEEDS = 300;
const IDLE = withInput({});

/** 指定 depth で kind の部屋が出るフロアを seed 総当たりで探す */
function floorWith(kind: RoomKind, depth: number): { state: GameState; index: number } {
  for (let seed = 0; seed < SEARCH_SEEDS; seed++) {
    const state = createGame(seed);
    state.depth = depth;
    buildFloor(state);
    const index = state.rooms.findIndex((r) => r.kind === kind);
    if (index >= 0) return { state, index };
  }
  throw new Error(`no ${kind} room found`);
}

function enterRoom(state: GameState, index: number): void {
  const room = state.rooms[index];
  if (!room) throw new Error("room missing");
  state.player.body.pos = rectCenterPx(room.rect);
  state.player.invulnTimer = 999;
  step(state, IDLE, FIXED_DT);
}

function killRoom(state: GameState, index: number): void {
  for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
  step(state, IDLE, FIXED_DT);
}

function aliveIn(state: GameState, index: number): number {
  return state.enemies.filter((e) => e.roomIndex === index && e.hp > 0).length;
}

describe("フロア種別", () => {
  it("ボス階は必ず rooms、depth 4, 7, 10 は cave、浅い階は rng を消費しない", () => {
    for (let depth = 1; depth <= 30; depth++) {
      const kind = chooseFloorKind(depth, createRng(depth));
      if (isBossDepth(depth)) expect(kind, `depth=${depth}`).toBe("rooms");
      else if (isCaveDepth(depth)) expect(kind, `depth=${depth}`).toBe("cave");
      else expect(kind, `depth=${depth}`).not.toBe("cave");
    }
    expect(isCaveDepth(4) && isCaveDepth(7) && isCaveDepth(10)).toBe(true);
    for (let depth = 1; depth < FLOOR_KIND.darkMinDepth; depth++) {
      const a = createRng(1);
      chooseFloorKind(depth, a);
      expect(a.next()).toBe(createRng(1).next());
    }
  });

  it("dark は depth 4 以降の非ボス・非洞窟階でだいたい 25%", () => {
    let dark = 0;
    const samples = 400;
    for (let seed = 0; seed < samples; seed++) {
      if (chooseFloorKind(5, createRng(seed)) === "dark") dark++;
    }
    expect(dark / samples).toBeGreaterThan(FLOOR_KIND.darkChance - 0.08);
    expect(dark / samples).toBeLessThan(FLOOR_KIND.darkChance + 0.08);
    for (let seed = 0; seed < 50; seed++) expect(chooseFloorKind(2, createRng(seed))).toBe("rooms");
  });

  it("dark フロアでは isDark が true になる", () => {
    for (let seed = 0; seed < SEARCH_SEEDS; seed++) {
      const state = createGame(seed);
      state.depth = 5;
      buildFloor(state);
      if (state.floorKind !== "dark") continue;
      expect(isDark(state)).toBe(true);
      return;
    }
    throw new Error("no dark floor found");
  });

  it("洞窟フロア: 塊の部屋に入るとロックされ、扉の内側から外へ出られない", () => {
    const state = createGame(3);
    state.depth = 3;
    descend(state);
    expect(state.depth).toBe(4);
    expect(state.floorKind).toBe("cave");
    const index = state.rooms.findIndex((r, i) => i > 0 && r.kind === "normal");
    const room = state.rooms[index];
    expect(room?.tiles).toBeDefined();
    if (!room?.tiles) return;
    enterRoom(state, index);
    expect(room.locked).toBe(true);
    // 部屋内の任意のタイルから、ロックされていない床だけを辿っても部屋の外に出られない
    const map = state.map;
    const start = [...room.tiles][0] ?? 0;
    const seen = new Set([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head] ?? 0;
      expect(room.tiles.has(i)).toBe(true);
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!isWalkable(map, x + dx, y + dy)) continue;
        const ni = toIndex(map, x + dx, y + dy);
        if (seen.has(ni) || state.lockedTiles.has(ni)) continue;
        seen.add(ni);
        queue.push(ni);
      }
    }
  });
});

describe("洞窟フロアの湧きとロック", () => {
  function caveState(seed: number): GameState {
    const state = createGame(seed);
    state.depth = 3;
    descend(state);
    return state;
  }

  it("敵は塊の所属タイル全体に湧き、AABB が扉タイルに掛からない（ロックで壁に埋まらない）", () => {
    for (let seed = 0; seed < 5; seed++) {
      const state = caveState(seed);
      if (state.floorKind !== "cave" || !state.map.roomTiles) continue;
      for (const e of state.enemies) {
        const room = state.rooms[e.roomIndex];
        if (!room?.tiles) continue;
        const r = e.body.radius;
        for (const [dx, dy] of [
          [-r, -r],
          [r, -r],
          [-r, r],
          [r, r],
        ] as const) {
          const tx = Math.floor((e.body.pos.x + dx) / TILE_SIZE);
          const ty = Math.floor((e.body.pos.y + dy) / TILE_SIZE);
          expect(room.tiles.has(toIndex(state.map, tx, ty)), `seed=${seed} enemy=${e.id}`).toBe(true);
        }
      }
    }
  });

  it("入室判定を満たした位置では、プレイヤーの AABB がロックした扉に重ならない", () => {
    const state = caveState(3);
    const index = state.rooms.findIndex((r, i) => i > 0 && r.kind === "normal");
    const room = state.rooms[index];
    if (!room?.tiles) throw new Error("cave room missing");
    const half = state.player.body.radius;
    for (const t of room.tiles) {
      const tx = t % state.map.width;
      const ty = Math.floor(t / state.map.width);
      for (let oy = 0; oy < TILE_SIZE; oy += 2) {
        for (let ox = 0; ox < TILE_SIZE; ox += 2) {
          const px = tx * TILE_SIZE + ox;
          const py = ty * TILE_SIZE + oy;
          if (!insideRoom(state, room, px, py, ROOM.enterMargin)) continue;
          for (const [dx, dy] of [
            [-half, -half],
            [half - 0.001, -half],
            [-half, half - 0.001],
            [half - 0.001, half - 0.001],
          ] as const) {
            const i = toIndex(state.map, Math.floor((px + dx) / TILE_SIZE), Math.floor((py + dy) / TILE_SIZE));
            expect(room.doorTiles.includes(i), `tile=${t} (${ox},${oy})`).toBe(false);
          }
        }
      }
    }
  });
});

describe("部屋の種類", () => {
  it("開始部屋・最初の部屋・最後の部屋は normal。特別な部屋は各 0〜1 個で深さ制限を守る", () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const depth of [1, 2, 5]) {
        const state = createGame(seed);
        state.depth = depth;
        buildFloor(state);
        const kinds = state.rooms.map((r) => r.kind);
        expect(kinds[0]).toBe("normal");
        expect(kinds[1]).toBe("normal");
        expect(kinds[kinds.length - 1]).toBe("normal");
        for (const k of ["treasure", "challenge", "shrine"] as const) {
          expect(kinds.filter((x) => x === k).length).toBeLessThanOrEqual(1);
        }
        expect(kinds.filter((x) => x === "ambush").length).toBeLessThanOrEqual(ROOM_KIND.ambushMax);
        if (depth < ROOM_KIND.challengeMinDepth) expect(kinds).not.toContain("challenge");
        if (depth < ROOM_KIND.ambushMinDepth) expect(kinds).not.toContain("ambush");
      }
    }
  });

  it("treasure: 敵がおらず、入ると 2〜3 個の床アイテムが出てロックされない", () => {
    const { state, index } = floorWith("treasure", 2);
    expect(state.enemies.filter((e) => e.roomIndex === index)).toHaveLength(0);
    const before = state.floorItems.length;
    enterRoom(state, index);
    const room = state.rooms[index];
    expect(room?.cleared).toBe(true);
    expect(room?.locked).toBe(false);
    const added = state.floorItems.length - before;
    expect(added).toBeGreaterThanOrEqual(ROOM_KIND.treasureItemsMin);
    expect(added).toBeLessThanOrEqual(ROOM_KIND.treasureItemsMax);
    expect(state.texts.some((t) => t.text === "宝物庫")).toBe(true);
  });

  it("challenge: 3 波の増援。全滅で rare 確定 + ハート", () => {
    const { state, index } = floorWith("challenge", 3);
    const room = state.rooms[index];
    if (!room) throw new Error("room missing");
    expect(aliveIn(state, index)).toBe(0);
    enterRoom(state, index);
    expect(room.locked).toBe(true);
    expect(room.wave).toBe(1);
    expect(aliveIn(state, index)).toBeGreaterThan(0);
    for (let wave = 2; wave <= ROOM_KIND.challengeWaves; wave++) {
      killRoom(state, index);
      expect(room.wave).toBe(wave);
      expect(room.locked).toBe(true);
      expect(state.texts.some((t) => t.text === `第${wave}波/${ROOM_KIND.challengeWaves}`)).toBe(true);
      expect(aliveIn(state, index)).toBeGreaterThan(0);
    }
    const hearts = state.pickups.length;
    // 部屋の中心に落ちるハートを即拾わないよう、隅へ寄せておく
    state.player.body.pos = { x: (room.rect.x + 1.5) * TILE_SIZE, y: (room.rect.y + 1.5) * TILE_SIZE };
    killRoom(state, index);
    expect(room.cleared).toBe(true);
    expect(room.locked).toBe(false);
    expect(state.pickups.length).toBe(hearts + 1);
    expect(state.floorItems.some((fi) => fi.item.rarity === "rare" || fi.item.rarity === "unique")).toBe(true);
  });

  it("shrine: 泉で HP 全回復は 1 回だけ。代わりに呪い", () => {
    const { state, index } = floorWith("shrine", 3);
    const room = state.rooms[index];
    if (!room) throw new Error("room missing");
    expect(room.cleared).toBe(true);
    expect(state.enemies.filter((e) => e.roomIndex === index)).toHaveLength(0);
    const f = fountainPx(room);
    expect(getTile(state.map, Math.floor(f.x / TILE_SIZE), Math.floor(f.y / TILE_SIZE))).toBe(Tile.Fountain);
    const p = state.player;
    p.hp = 10;
    p.body.pos = { ...f };
    step(state, IDLE, FIXED_DT);
    expect(p.hp).toBe(p.maxHp);
    expect(room.used).toBe(true);
    expect(state.cursed).toBe(true);
    p.hp = 10;
    step(state, IDLE, FIXED_DT);
    expect(p.hp).toBe(10);
  });

  it("呪い: 次の部屋でエリート抽選が 1 回増え、呪いは消える", () => {
    const state = createGame(1);
    state.depth = 20;
    state.enemies = [];
    const n = 300;
    for (let i = 0; i < n; i++) placeEnemy(state, "slime", 1000 + i, 0);
    state.cursed = true;
    applyCurse(state, 0);
    expect(state.cursed).toBe(false);
    const elites = state.enemies.filter((e) => e.elite).length;
    // eliteChance(20) = 0.28 → 1 回ぶんの追加抽選でおよそ 84 体
    expect(elites).toBeGreaterThan(n * 0.18);
    expect(elites).toBeLessThan(n * 0.4);
  });

  it("呪いでエリート化した敵は満タンに戻らず、被弾していた HP 割合を維持する", () => {
    const state = createGame(1);
    state.depth = 20;
    state.enemies = [];
    const n = 300;
    const ratio = 0.4;
    for (let i = 0; i < n; i++) {
      const e = placeEnemy(state, "slime", 1000 + i, 0);
      e.hp = Math.round(e.maxHp * ratio);
    }
    state.cursed = true;
    applyCurse(state, 0);
    const elites = state.enemies.filter((e) => e.elite);
    expect(elites.length).toBeGreaterThan(0);
    for (const e of elites) {
      expect(e.hp).toBeLessThan(e.maxHp);
      expect(e.hp / e.maxHp).toBeCloseTo(ratio, 1);
    }
  });

  it("ambush: 最初は無人で、入った瞬間に通常の 2 倍の敵が telegraph 付きで湧く", () => {
    const { state, index } = floorWith("ambush", 4);
    expect(aliveIn(state, index)).toBe(0);
    enterRoom(state, index);
    expect(state.rooms[index]?.locked).toBe(true);
    const spawned = state.enemies.filter((e) => e.roomIndex === index);
    expect(spawned.length).toBeGreaterThanOrEqual(enemyCount(state) * ROOM_KIND.ambushEnemyMul - 2);
    expect(spawned.every((e) => e.phase === "spawning")).toBe(true);
    expect(state.texts.some((t) => t.text === "伏兵！")).toBe(true);
  });

  it("ambush: depth 10 のように 2 倍湧きが maxEnemies を超えても、群れ込みの実体数が maxEnemies + 群れの最大サイズ以下に収まる", () => {
    const maxSwarm = Math.max(1, ...ENEMIES.filter((e) => e.swarm).map((e) => e.swarm!.max));
    const { state, index } = floorWith("ambush", 10);
    // 2 倍湧き（enemyCount(depth10) * ambushEnemyMul）は maxEnemies を優に超える想定
    expect(enemyCount(state) * ROOM_KIND.ambushEnemyMul).toBeGreaterThan(ROOM.maxEnemies);
    enterRoom(state, index);
    const spawned = state.enemies.filter((e) => e.roomIndex === index);
    expect(spawned.length).toBeLessThanOrEqual(ROOM.maxEnemies + maxSwarm);
  });
});

describe("探索済みタイル（ミニマップ）", () => {
  it("開始時にプレイヤー周囲だけ探索済みで、移動すると増え、次の階でリセットされる", () => {
    const state = createGame(11);
    const p = state.player.body.pos;
    const tile = toIndex(state.map, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
    expect(state.explored.length).toBe(state.map.tiles.length);
    expect(state.explored[tile]).toBe(1);
    const initial = state.exploredLog.length;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThanOrEqual((MINIMAP.revealRadius * 2 + 1) ** 2);
    expect(state.explored.reduce((s, v) => s + v, 0)).toBe(initial);

    const far = state.rooms[1];
    if (!far) throw new Error("room missing");
    state.player.body.pos = rectCenterPx(far.rect);
    step(state, IDLE, FIXED_DT);
    expect(state.exploredLog.length).toBeGreaterThan(initial);
    // 差分ログに重複はない
    expect(new Set(state.exploredLog).size).toBe(state.exploredLog.length);

    descend(state);
    expect(state.exploredLog.length).toBeLessThanOrEqual((MINIMAP.revealRadius * 2 + 1) ** 2);
  });
});

describe("決定性", () => {
  it("同じ seed なら同じフロア種別・部屋の種類・地形になる", () => {
    const run = (): string[] => {
      const state = createGame(77);
      const out: string[] = [];
      for (let i = 0; i < 9; i++) {
        out.push(
          [
            state.depth,
            state.floorKind,
            state.rooms.map((r) => r.kind).join(","),
            Array.from(state.map.tiles).join(""),
            state.enemies.length,
          ].join("|"),
        );
        descend(state);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
