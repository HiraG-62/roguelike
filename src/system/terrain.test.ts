import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { TERRAIN_KINDS, terrainCode } from "../core/terrain";
import { STATUS, TERRAIN } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, setTile } from "../map/grid";
import { generateRoomsAndCorridors, DEFAULT_GENERATOR_OPTIONS, planTerrain } from "../map/generator";
import { descend } from "./floor";
import { applyBurn, findStatus, hasStatus, statusStacks } from "./statusEffects";
import {
  ensureTerrainLayer,
  igniteTerrainAt,
  placeTerrain,
  smokeAt,
  terrainAt,
  terrainMoveMul,
  terrainSlide,
  updateTerrain,
} from "./terrain";
import { TERRAIN_MUD_SMOKE, TERRAIN_RUBBLE } from "../data/tuning";
import { lineOfSight } from "../map/pathing";
import { fireEnemyBullet } from "./enemyTraits";
import { updateProjectiles } from "./projectiles";
import { updateEnemies } from "./enemies";
import { applyStatus } from "./statusEffects";
import { FIXED_DT } from "../core/loop";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { updatePlayer } from "./player";

/** 地形の層（docs/ideas/status-and-terrain.md 3 章） */

const BIG_HP = 100000;

/** 地形の効果が 1 回入るまで進める（周期 TERRAIN.tickInterval） */
function tickOnce(state: GameState): void {
  updateTerrain(state, TERRAIN.tickInterval);
}

/** 自然配置を済ませてから、テスト用に地形を全部消す（決まった場所だけで確かめる） */
function cleanLayer(state: GameState): void {
  updateTerrain(state, 0);
  const layer = ensureTerrainLayer(state);
  layer.kinds.fill(0);
  layer.time.fill(0);
  layer.active.clear();
  layer.tickTimer = 0;
}

function playerPos(state: GameState): { x: number; y: number } {
  return state.player.body.pos;
}

describe("地形の配置（planTerrain）", () => {
  it("同じ rng なら同じ配置になり、床タイルの上にだけ置かれ、除外した部屋には置かない", () => {
    const map = generateRoomsAndCorridors(createRng(3), DEFAULT_GENERATOR_OPTIONS);
    const skip = new Set([0, map.rooms.length - 1]);
    const a = planTerrain(createRng(9), map, 6, skip);
    const b = planTerrain(createRng(9), map, 6, skip);
    expect([...a]).toEqual([...b]);
    expect(a.some((k) => k !== 0), "深度 6 なら何か置かれる").toBe(true);
    a.forEach((code, i) => {
      if (code === 0) return;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      expect(getTile(map, x, y), `(${x}, ${y}) は床`).toBe(Tile.Floor);
      for (const r of [0, map.rooms.length - 1]) {
        const room = map.rooms[r];
        if (!room) continue;
        const inside = x >= room.x && y >= room.y && x < room.x + room.w && y < room.y + room.h;
        expect(inside, `除外した部屋 ${r} には置かない`).toBe(false);
      }
    });
  });

  it("溶岩は minDepth より浅い階には出ない", () => {
    const map = generateRoomsAndCorridors(createRng(3), DEFAULT_GENERATOR_OPTIONS);
    const lava = terrainCode("lava");
    for (let seed = 0; seed < 30; seed++) {
      const kinds = planTerrain(createRng(seed), map, TERRAIN.gen.minDepth.lava - 1, new Set([0]));
      expect(kinds.includes(lava), `seed ${seed}`).toBe(false);
    }
  });

  it("updateTerrain はフロアごとに 1 回だけ自然配置し、階を降りると層を作り直す", () => {
    const state = arena();
    updateTerrain(state, 0);
    const layer = ensureTerrainLayer(state);
    expect(layer.map).toBe(state.map);
    expect(layer.planned).toBe(true);
    const before = [...layer.kinds];
    updateTerrain(state, 0);
    expect([...layer.kinds], "2 回目は置き直さない").toEqual(before);
    descend(state);
    expect(terrainAt(state, playerPos(state).x, playerPos(state).y), "新しい階では層が古い").toBe("none");
    updateTerrain(state, 0);
    expect(state.terrain.map).toBe(state.map);
    expect(state.terrain.kinds.length).toBe(state.map.width * state.map.height);
  });

  it("開始部屋には自然配置の地形が無い", () => {
    const state = arena();
    state.depth = 8;
    state.terrain.map = null;
    updateTerrain(state, 0);
    const start = state.map.rooms[0];
    if (!start) throw new Error("開始部屋が無い");
    for (let y = start.y; y < start.y + start.h; y++) {
      for (let x = start.x; x < start.x + start.w; x++) {
        expect(terrainAt(state, (x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE)).toBe("none");
      }
    }
  });
});

describe("置く・時間で消える・燃え広がる", () => {
  it("placeTerrain は半径内の床に置き、持続が切れると消える", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    const placed = placeTerrain(state, p.x, p.y, "water", TILE_SIZE, 1);
    expect(placed).toBeGreaterThan(1);
    expect(terrainAt(state, p.x, p.y)).toBe("water");
    updateTerrain(state, 1.01);
    expect(terrainAt(state, p.x, p.y)).toBe("none");
  });

  it("階段・泉のタイルには置かない（自然配置と同じく床だけ）", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    const tx = Math.floor(p.x / TILE_SIZE) + 2;
    const ty = Math.floor(p.y / TILE_SIZE);
    setTile(state.map, tx, ty, Tile.StairsDown);
    setTile(state.map, tx + 1, ty, Tile.Fountain);
    const cx = (tx + 0.5) * TILE_SIZE;
    const cy = (ty + 0.5) * TILE_SIZE;
    expect(placeTerrain(state, cx, cy, "lava", 0, 0), "階段の上").toBe(0);
    expect(placeTerrain(state, cx + TILE_SIZE, cy, "water", 0, 0), "泉の上").toBe(0);
    placeTerrain(state, cx, cy, "oil", TILE_SIZE * 2, 0);
    expect(terrainAt(state, cx, cy), "広く撒いても階段は空ける").toBe("none");
    expect(terrainAt(state, cx - TILE_SIZE, cy), "隣の床には置く").toBe("oil");
  });

  it("持続 0 の地形は消えない", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "grass", 0, 0);
    updateTerrain(state, 30);
    expect(terrainAt(state, p.x, p.y)).toBe("grass");
  });

  it("油に火がつくと隣の油へ燃え移り、燃え尽きると何も残らない", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    const far = { x: p.x + TILE_SIZE * 3, y: p.y };
    placeTerrain(state, p.x, p.y, "oil", TILE_SIZE * 4, 0);
    igniteTerrainAt(state, p.x, p.y, 0);
    expect(terrainAt(state, p.x, p.y)).toBe("fire");
    expect(terrainAt(state, far.x, far.y), "まだ燃え移っていない").toBe("oil");
    for (let i = 0; i < 10; i++) updateTerrain(state, TERRAIN.fire.spreadOil);
    expect(terrainAt(state, far.x, far.y), "3 マス先まで燃え移る").toBe("fire");
    updateTerrain(state, TERRAIN.fire.oilBurnTime + 1);
    expect(terrainAt(state, p.x, p.y), "燃え尽きた").toBe("none");
  });

  it("炎は氷を溶かして水たまりにし、水の上には置けない。溶岩の上には何も置けない", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "ice", 0);
    placeTerrain(state, p.x, p.y, "fire", 0);
    expect(terrainAt(state, p.x, p.y)).toBe("water");
    expect(placeTerrain(state, p.x, p.y, "fire", 0)).toBe(0);
    placeTerrain(state, p.x, p.y, "lava", 0, 0);
    expect(placeTerrain(state, p.x, p.y, "water", 0)).toBe(0);
    expect(terrainAt(state, p.x, p.y)).toBe("lava");
  });

  it("燃えている者が草の上に立つと草に火がつく", () => {
    const state = arena();
    cleanLayer(state);
    const e = placeEnemy(state, "golem", 40);
    e.hp = BIG_HP;
    placeTerrain(state, e.body.pos.x, e.body.pos.y, "grass", 0, 0);
    applyBurn(state, e, 3, 3);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y)).toBe("fire");
  });
});

describe("上に立つ者への効果（プレイヤーと敵の両方）", () => {
  it("水たまり: 濡れ。冷えている者が立つと氷床になる", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "water", 0, 0);
    tickOnce(state);
    expect(statusStacks(state.player.status, "wet")).toBe(TERRAIN.water.wetStacks);
    state.player.status.effects = [];
    state.player.status.effects.push({ kind: "chill", stacks: 1, time: 2, maxTime: 2, potency: 0, source: "enemy", acc: 0, tick: 0 });
    tickOnce(state);
    expect(terrainAt(state, p.x, p.y)).toBe("ice");
  });

  it("油: 油膜。毒沼: 毒と、数回に 1 回の腐食", () => {
    const state = arena();
    cleanLayer(state);
    const oil = placeEnemy(state, "golem", 40);
    const bog = placeEnemy(state, "golem", 40, 40);
    for (const e of [oil, bog]) e.hp = BIG_HP;
    placeTerrain(state, oil.body.pos.x, oil.body.pos.y, "oil", 0, 0);
    placeTerrain(state, bog.body.pos.x, bog.body.pos.y, "bog", 0, 0);
    for (let i = 0; i < TERRAIN.bog.corrodeEvery; i++) tickOnce(state);
    expect(hasStatus(oil.status, "oiled")).toBe(true);
    expect(hasStatus(bog.status, "poison")).toBe(true);
    expect(hasStatus(bog.status, "corrode")).toBe(true);
  });

  it("溶岩: 燃焼と小ダメージ。プレイヤーはダッシュ中なら無傷", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "lava", 0, 0);
    state.player.dashTimer = 0.1;
    const hp = state.player.hp;
    tickOnce(state);
    expect(state.player.hp).toBe(hp);
    state.player.dashTimer = 0;
    tickOnce(state);
    expect(hp - state.player.hp).toBe(TERRAIN.lava.damage);
    expect(findStatus(state.player.status, "burn")?.potency).toBe(TERRAIN.lava.burnDps);
  });

  it("溶岩: 被弾後の無敵中・無敵バフ中も無傷（燃焼も付かない）", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "lava", 0, 0);
    const hp = state.player.hp;
    state.player.invulnTimer = 1;
    tickOnce(state);
    state.player.invulnTimer = 0;
    state.player.buffs.invuln = 1;
    tickOnce(state);
    expect(state.player.hp, "無敵の間は削れない").toBe(hp);
    expect(hasStatus(state.player.status, "burn"), "無敵の間は燃えない").toBe(false);
  });

  it("壁に押し付けた軸の速度は残さない（氷床の滑りが壁への速度を引き継がない）", () => {
    const state = arena();
    cleanLayer(state);
    const room = state.map.rooms[0];
    if (!room) throw new Error("no room");
    const body = state.player.body;
    body.pos = { x: room.x * TILE_SIZE + body.radius + 0.5, y: (room.y + room.h / 2) * TILE_SIZE };
    placeTerrain(state, body.pos.x, body.pos.y, "ice", TILE_SIZE, 0);
    for (let i = 0; i < 30; i++) updatePlayer(state, withInput({ move: { x: -1, y: 0 } }), 1 / 60);
    expect(body.vel.x, "壁の向きの速度は 0").toBe(0);
    updatePlayer(state, withInput({ move: { x: 1, y: 0 } }), 1 / 60);
    expect(body.vel.x, "離れる入力がすぐ効く").toBeGreaterThan(0);
  });

  it("溶岩は敵にも効き、押し込めば削れる", () => {
    const state = arena();
    cleanLayer(state);
    const e = placeEnemy(state, "golem", 40);
    e.hp = BIG_HP;
    placeTerrain(state, e.body.pos.x, e.body.pos.y, "lava", 0, 0);
    tickOnce(state);
    expect(BIG_HP - e.hp).toBe(TERRAIN.lava.enemyDamage);
    expect(hasStatus(e.status, "burn")).toBe(true);
  });

  it("氷床: 数回に 1 回冷気。入力にすぐ追従せず滑る（氷床の外ではそのまま）", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "ice", 0, 0);
    for (let i = 0; i < TERRAIN.ice.chillEvery; i++) tickOnce(state);
    expect(statusStacks(state.player.status, "chill")).toBe(1);
    const slid = terrainSlide(state, p, { x: 100, y: 0 }, { x: -100, y: 0 }, 1 / 60);
    expect(slid.x, "前の速度が残る").toBeGreaterThan(0);
    const dry = terrainSlide(state, { x: p.x + TILE_SIZE * 4, y: p.y }, { x: 100, y: 0 }, { x: -100, y: 0 }, 1 / 60);
    expect(dry.x).toBe(-100);
  });

  it("炎の上では燃焼", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "fire", 0, 5);
    tickOnce(state);
    expect(findStatus(state.player.status, "burn")?.potency).toBe(TERRAIN.fire.burnDps);
  });

  it("濡れた者は炎の上でも燃えない（蒸気）", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    state.player.status.effects.push({ kind: "wet", stacks: 2, time: STATUS.wet.duration, maxTime: STATUS.wet.duration, potency: 0, source: "env", acc: 0, tick: 0 });
    placeTerrain(state, p.x, p.y, "fire", 0, 5);
    tickOnce(state);
    expect(hasStatus(state.player.status, "burn")).toBe(false);
    expect(statusStacks(state.player.status, "wet")).toBe(1);
  });
});

describe("決定性", () => {
  it("同じ seed なら自然配置も燃え広がりも同じ", () => {
    function run(): string {
      const state = arena(21);
      state.depth = 7;
      state.terrain.map = null;
      updateTerrain(state, 0);
      const p = playerPos(state);
      placeTerrain(state, p.x, p.y, "oil", TILE_SIZE * 2, 0);
      igniteTerrainAt(state, p.x, p.y, 0);
      for (let i = 0; i < 120; i++) updateTerrain(state, 1 / 60);
      return [...state.terrain.kinds].join("");
    }
    expect(run()).toBe(run());
  });

  it("地形の種類の一覧は none から始まる（0 = 地形なし）", () => {
    expect(TERRAIN_KINDS[0]).toBe("none");
  });
});

// -----------------------------------------------------------------------------
// 泥と煙（docs/ideas/enemies.md E2 / V10）
// -----------------------------------------------------------------------------

/** 燃焼を 1 つ付ける（付与の瞬間に足元の地形へ火が入る） */
function burnEnemy(state: GameState, e: ReturnType<typeof placeEnemy>): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 3, potency: 1 }, "player");
}

describe("泥", () => {
  it("泥の中はプレイヤーの歩きと敵の足が moveMul 倍になり、泥の外では等倍", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    const desired = { x: 100, y: 0 };
    expect(terrainSlide(state, p, { x: 0, y: 0 }, desired, FIXED_DT).x, "泥の外").toBe(100);
    placeTerrain(state, p.x, p.y, "mud", 0, 0);
    expect(terrainAt(state, p.x, p.y)).toBe("mud");
    expect(terrainSlide(state, p, { x: 0, y: 0 }, desired, FIXED_DT).x, "泥の中").toBeCloseTo(100 * TERRAIN_MUD_SMOKE.mud.moveMul);
    expect(terrainMoveMul(state, p)).toBe(TERRAIN_MUD_SMOKE.mud.moveMul);
  });

  it("泥の中の敵に燃焼が入ると泥が固まって消え、その敵が短く麻痺する", () => {
    const state = arena();
    cleanLayer(state);
    const e = placeEnemy(state, "golem", 40);
    e.hp = BIG_HP;
    placeTerrain(state, e.body.pos.x, e.body.pos.y, "mud", 0, 0);
    burnEnemy(state, e);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y), "泥が固まって消える").toBe("none");
    expect(hasStatus(e.status, "paralyze"), "中の敵は麻痺").toBe(true);
    expect(state.sfx).toContain("mudHarden");
  });

  it("泥に炎を置くと炎は付かずに泥が固まり、泥の外の敵は麻痺しない", () => {
    const state = arena();
    cleanLayer(state);
    const inside = placeEnemy(state, "golem", 40);
    const outside = placeEnemy(state, "golem", 40, 80);
    for (const e of [inside, outside]) e.hp = BIG_HP;
    const pos = inside.body.pos;
    placeTerrain(state, pos.x, pos.y, "mud", 0, 0);
    placeTerrain(state, pos.x, pos.y, "fire", 0, 3);
    expect(terrainAt(state, pos.x, pos.y)).toBe("none");
    expect(hasStatus(inside.status, "paralyze")).toBe(true);
    expect(hasStatus(outside.status, "paralyze")).toBe(false);
  });

  it("冷えた者が泥に立つと凍って氷床になる", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "mud", 0, 0);
    state.player.status.effects.push({ kind: "chill", stacks: 1, time: 2, maxTime: 2, potency: 0, source: "enemy", acc: 0, tick: 0 });
    tickOnce(state);
    expect(terrainAt(state, p.x, p.y)).toBe("ice");
  });

  it("持続を省くと TERRAIN.placedDuration.mud 秒で消える", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "mud", 0);
    updateTerrain(state, TERRAIN.placedDuration.mud - 0.1);
    expect(terrainAt(state, p.x, p.y)).toBe("mud");
    updateTerrain(state, 0.2);
    expect(terrainAt(state, p.x, p.y)).toBe("none");
  });
});

describe("煙", () => {
  it("煙は床の地形に重なって漂い、晴れると下の油が残る", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "oil", 0, 0);
    placeTerrain(state, p.x, p.y, "smoke", 0);
    expect(smokeAt(state, p.x, p.y)).toBe(true);
    expect(terrainAt(state, p.x, p.y), "床の地形は油のまま").toBe("oil");
    updateTerrain(state, TERRAIN.placedDuration.smoke + 0.1);
    expect(smokeAt(state, p.x, p.y), "持続が切れると晴れる").toBe(false);
    expect(terrainAt(state, p.x, p.y)).toBe("oil");
  });

  it("煙は視線を遮る（晴れれば通る）", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    const far = { x: p.x + 64, y: p.y };
    expect(lineOfSight(state.map, p, far), "煙の無い床は見通せる").toBe(true);
    placeTerrain(state, p.x + 32, p.y, "smoke", 0, 2);
    expect(lineOfSight(state.map, p, far), "間に煙").toBe(false);
    updateTerrain(state, 2.1);
    expect(lineOfSight(state.map, p, far), "晴れた").toBe(true);
  });

  it("煙の向こうの敵はプレイヤーに気付かない", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    const e = placeEnemy(state, "slime", 64);
    e.phase = "idle";
    placeTerrain(state, p.x + 32, p.y, "smoke", 0, 0);
    updateEnemies(state, FIXED_DT);
    expect(e.phase, "煙越しには気付かない").toBe("idle");
    const layer = ensureTerrainLayer(state);
    layer.smoke.fill(0);
    layer.smokeCells.clear();
    updateEnemies(state, FIXED_DT);
    expect(e.phase, "煙が無ければ気付く").toBe("chase");
  });

  it("プレイヤーの弾と敵の弾は煙に入ると消える", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x + 40, p.y, "smoke", 0, 0);
    fireEnemyBullet(state, { pos: { x: p.x + 70, y: p.y }, dir: { x: -1, y: 0 }, speed: 120, damage: 5, color: "#fff" });
    state.projectiles.push({
      id: 9999,
      owner: "player",
      pos: { x: p.x + 10, y: p.y },
      vel: { x: 120, y: 0 },
      radius: 2,
      damage: 5,
      life: 2,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    const hp = state.player.hp;
    for (let i = 0; i < 40; i++) updateProjectiles(state, FIXED_DT);
    expect(state.projectiles.length, "どちらの弾も煙の中で消える").toBe(0);
    expect(state.player.hp, "敵の弾は届かない").toBe(hp);
  });

  it("煙は炎・燃焼で即座に晴れ、炎の上には漂わない", () => {
    const state = arena();
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "smoke", 0, 0);
    placeTerrain(state, p.x, p.y, "fire", 0, 3);
    expect(smokeAt(state, p.x, p.y), "炎を置くと晴れる").toBe(false);
    expect(terrainAt(state, p.x, p.y), "炎はそのまま置ける").toBe("fire");
    placeTerrain(state, p.x, p.y, "smoke", 0, 0);
    expect(smokeAt(state, p.x, p.y), "炎の上には漂わない").toBe(false);

    const e = placeEnemy(state, "golem", 48);
    e.hp = BIG_HP;
    placeTerrain(state, e.body.pos.x, e.body.pos.y, "smoke", 0, 0);
    burnEnemy(state, e);
    expect(smokeAt(state, e.body.pos.x, e.body.pos.y), "燃焼の付いた者の周りは晴れる").toBe(false);
    placeTerrain(state, e.body.pos.x, e.body.pos.y, "smoke", 0, 0);
    igniteTerrainAt(state, e.body.pos.x, e.body.pos.y, 4);
    expect(smokeAt(state, e.body.pos.x, e.body.pos.y)).toBe(false);
  });
});

describe("崩れる床（rubble。地裂きの刻印符「地崩れ」が作る）", () => {
  function rubbleArena(): { state: GameState; e: ReturnType<typeof placeEnemy> } {
    const state = arena(5);
    cleanLayer(state);
    const e = placeEnemy(state, "golem", 40);
    e.hp = BIG_HP;
    e.maxHp = BIG_HP;
    e.phase = "idle";
    placeTerrain(state, e.body.pos.x, e.body.pos.y, "rubble", 0, TERRAIN_RUBBLE.duration);
    return { state, e };
  }

  function steps(state: GameState, seconds: number): void {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) updateTerrain(state, FIXED_DT);
  }

  it("敵が 1 秒乗り続けると床が抜け、落下ダメージと怯み。床は空に戻る", () => {
    const { state, e } = rubbleArena();
    steps(state, TERRAIN_RUBBLE.fallDelay - 0.1);
    expect(e.hp, "予告の間は無傷").toBe(BIG_HP);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y)).toBe("rubble");
    steps(state, 0.15);
    expect(e.hp, "落下ダメージ").toBeLessThan(BIG_HP);
    expect(hasStatus(e.status, "stagger"), "落ちて怯む").toBe(true);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y), "抜けた床は空").toBe("none");
    expect(state.sfx).toContain("rubbleFall");
  });

  it("途中で降りると溜まりは戻り、乗り直すとまた 1 秒かかる", () => {
    const { state, e } = rubbleArena();
    const on = { ...e.body.pos };
    steps(state, TERRAIN_RUBBLE.fallDelay * 0.6);
    e.body.pos = { x: on.x + TILE_SIZE * 4, y: on.y };
    steps(state, FIXED_DT * 2);
    e.body.pos = on;
    steps(state, TERRAIN_RUBBLE.fallDelay * 0.6);
    expect(e.hp, "合計では 1 秒を超えても、続けて乗っていなければ抜けない").toBe(BIG_HP);
    steps(state, TERRAIN_RUBBLE.fallDelay * 0.5);
    expect(e.hp).toBeLessThan(BIG_HP);
  });

  it("プレイヤーは乗っても落ちない", () => {
    const state = arena(5);
    cleanLayer(state);
    const p = playerPos(state);
    placeTerrain(state, p.x, p.y, "rubble", 0, TERRAIN_RUBBLE.duration);
    const hp = state.player.hp;
    steps(state, TERRAIN_RUBBLE.fallDelay * 2);
    expect(state.player.hp).toBe(hp);
    expect(terrainAt(state, p.x, p.y)).toBe("rubble");
  });

  it("ボスは怯まず、怯み値だけが入る", () => {
    const state = arena(5);
    cleanLayer(state);
    const boss = placeEnemy(state, "kingSlime", 50);
    boss.hp = BIG_HP;
    boss.maxHp = BIG_HP;
    boss.poise.max = BIG_HP;
    placeTerrain(state, boss.body.pos.x, boss.body.pos.y, "rubble", 0, TERRAIN_RUBBLE.duration);
    steps(state, TERRAIN_RUBBLE.fallDelay + 0.05);
    expect(boss.hp).toBeLessThan(BIG_HP);
    expect(boss.poise.damage, "怯み値").toBeGreaterThan(0);
    expect(hasStatus(boss.status, "stagger")).toBe(false);
  });

  it("持続が切れると消える", () => {
    const state = arena(5);
    cleanLayer(state);
    const at = { x: playerPos(state).x + TILE_SIZE * 3, y: playerPos(state).y };
    placeTerrain(state, at.x, at.y, "rubble", 0, TERRAIN_RUBBLE.duration);
    steps(state, TERRAIN_RUBBLE.duration + 0.1);
    expect(terrainAt(state, at.x, at.y)).toBe("none");
  });
});
