import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Jin } from "../core/state";
import type { Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { JIN } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { lineOfSight } from "../map/pathing";
import { NOTICE_RANGE, updateEnemies } from "./enemies";
import { damageEnemy } from "./combat";
import { LOOKOUT_BELL_SFX, emitNoise, wakeByNoise } from "./noise";
import { overlapsWall } from "./physics";
import { explodeAt } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 音で起きる（system/noise.ts。docs/ideas/jin-impl.md 3c の I） */

const ROOM_A = 1;
const ANGLE_STEPS = 32;
/** 幾何の検証用の小さな音の半径（開始部屋に収まる距離。実際の半径は JIN.noise で別に検査する） */
const TEST_RADIUS = 60;

/** 半径を指定して音を積む（部屋の広さに依らず内外を分けるため） */
function ring(state: GameState, pos: Vec, radius = TEST_RADIUS): void {
  state.noises.push({ pos: { ...pos }, radius });
}

/** from から半径 r の点で、視線が通り壁に埋まらない点 */
function openSpot(state: GameState, from: Vec, r: number): Vec {
  for (let k = 0; k < ANGLE_STEPS; k++) {
    const a = (k / ANGLE_STEPS) * 2 * Math.PI;
    const p = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
    if (!overlapsWall(state, p.x, p.y, state.player.body.radius) && lineOfSight(state.map, from, p)) return p;
  }
  throw new Error("見通せる点が無い");
}

/** プレイヤーから見通せる距離 r の点に、眠っている敵を置く */
function sleeper(state: GameState, r: number, key = "slime"): Enemy {
  const e = placeEnemy(state, key, 0);
  e.body.pos = openSpot(state, state.player.body.pos, r);
  e.phase = "idle";
  return e;
}

function addJin(state: GameState, id: number, formation: Jin["formation"], center: Vec): Jin {
  const jin: Jin = {
    id,
    roomIndex: ROOM_A,
    formation,
    center: { ...center },
    facing: { x: 1, y: 0 },
    leaderId: null,
    hpMul: 1,
    morale: 0,
    moraleMax: 0,
    phase: "sleeping",
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
  };
  state.jins.push(jin);
  return jin;
}

/** 陣のメンバー（眠っている） */
function jinMember(state: GameState, jin: Jin, at: Vec): Enemy {
  const e = placeEnemy(state, "slime", 0);
  e.body.pos = { ...at };
  e.roomIndex = jin.roomIndex;
  e.jinId = jin.id;
  e.phase = "idle";
  return e;
}

describe("音を積む", () => {
  it("種類ごとの半径で積み、1 ステップの上限を超えた分は捨てる", () => {
    const state = arena();
    emitNoise(state, { x: 10, y: 20 }, "dash");
    expect(state.noises).toEqual([{ pos: { x: 10, y: 20 }, radius: JIN.noise.dash }]);
    for (let i = 0; i < JIN.noise.maxPerStep + 5; i++) emitNoise(state, { x: i, y: 0 }, "hit");
    expect(state.noises, "上限で止まる").toHaveLength(JIN.noise.maxPerStep);
  });

  it("積んだ位置は呼び出し側の座標と別のコピー（後から動いても音は動かない）", () => {
    const state = arena();
    const pos = { x: 5, y: 5 };
    emitNoise(state, pos, "explode");
    pos.x = 999;
    expect(state.noises[0]?.pos.x).toBe(5);
  });
});

describe("音源", () => {
  it("ダッシュの音で気付く距離の外の眠っている敵が起きる。歩きでは起きない", () => {
    const state = arena();
    state.player.invulnTimer = 999;
    // 気付く距離（NOTICE_RANGE）の外、ダッシュの音の内側
    expect(JIN.noise.dash, "ダッシュの音は気付く距離より遠くまで届く").toBeGreaterThan(NOTICE_RANGE + 10);
    const e = sleeper(state, NOTICE_RANGE + 10);
    step(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
    expect(e.phase, "歩き").toBe("idle");
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(e.phase, "ダッシュ").not.toBe("idle");
  });

  it("近接・射撃の命中で敵の位置に音が鳴る。継続ダメージ（silent）と素性なし（proc）では鳴らない", () => {
    const state = arena();
    const target = placeEnemy(state, "slime", 60);
    target.hp = target.maxHp = 9999;
    damageEnemy(state, target, 1, { x: 1, y: 0 }, 0, { kind: "proc" });
    damageEnemy(state, target, 1, { x: 1, y: 0 }, 0, { kind: "melee", silent: true });
    expect(state.noises, "proc / silent").toHaveLength(0);
    damageEnemy(state, target, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(state.noises).toHaveLength(1);
    expect(state.noises[0]?.pos).toEqual(target.body.pos);
    state.noises = [];
    damageEnemy(state, target, 1, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(state.noises, "射撃").toHaveLength(1);
  });

  it("爆発で爆心に音が鳴る", () => {
    const state = arena();
    explodeAt(state, { x: 100, y: 100 }, 30, 1);
    expect(state.noises.some((n) => n.radius === JIN.noise.explode && n.pos.x === 100)).toBe(true);
  });
});

describe("眠っている敵が聞きつける", () => {
  it("半径の内側の眠っている敵だけ起き、外の敵は眠ったまま。音は空になる", () => {
    const state = arena();
    const near = sleeper(state, TEST_RADIUS - 20);
    const far = sleeper(state, TEST_RADIUS + 30);
    ring(state, state.player.body.pos);
    wakeByNoise(state);
    expect(near.phase, "半径の内側").toBe("chase");
    expect(far.phase, "半径の外").toBe("idle");
    expect(state.noises).toHaveLength(0);
  });

  it("音が無ければ眠ったまま（歩きの近くの敵は起こさない）", () => {
    const state = arena();
    const e = sleeper(state, TEST_RADIUS - 20);
    wakeByNoise(state);
    expect(e.phase).toBe("idle");
  });

  it("updateEnemies の頭で聞かれ、更新の後に鳴った音は次のステップまで残る", () => {
    const state = arena();
    const e = sleeper(state, TEST_RADIUS - 20);
    ring(state, state.player.body.pos);
    updateEnemies(state, FIXED_DT);
    expect(e.phase).not.toBe("idle");
    expect(state.noises).toHaveLength(0);
  });

  it("壁で遮られていれば聞こえない", () => {
    const state = arena();
    const e = sleeper(state, TEST_RADIUS - 20);
    // 敵の周りで、半径の内側なのに視線が通らない点（壁の向こう）を探す
    let blocked: Vec | null = null;
    const reach = JIN.noise.hit - 20;
    for (let dy = -reach; dy <= reach && !blocked; dy += 10) {
      for (let dx = -reach; dx <= reach && !blocked; dx += 10) {
        const p = { x: e.body.pos.x + dx, y: e.body.pos.y + dy };
        const inMap = p.x > 0 && p.y > 0 && p.x < state.map.width * TILE_SIZE && p.y < state.map.height * TILE_SIZE;
        if (inMap && Math.hypot(dx, dy) < reach && !lineOfSight(state.map, p, e.body.pos)) blocked = p;
      }
    }
    expect(blocked, "視線の通らない音源の点").not.toBeNull();
    if (!blocked) return;
    ring(state, blocked, JIN.noise.hit);
    wakeByNoise(state);
    expect(e.phase).toBe("idle");
  });

  it("ボスは音では動かない", () => {
    const state = arena();
    const boss = sleeper(state, TEST_RADIUS - 20, "frostGiant");
    expect(enemyDef(boss.defKey).boss, "ボスの定義").toBe(true);
    ring(state, state.player.body.pos);
    wakeByNoise(state);
    expect(boss.phase).toBe("idle");
  });
});

describe("陣は wakeJin の流れで起きる", () => {
  it("聞きつけた者の近くだけ起き、遠いメンバーは眠ったまま（後詰は時間では出ない）", () => {
    const state = arena();
    state.jins = [];
    const room = state.rooms[ROOM_A];
    if (room) {
      room.locked = false;
      room.engaged = false;
    }
    const p = state.player.body.pos;
    const jin = addJin(state, 1, "fishScale", p);
    const heard = jinMember(state, jin, openSpot(state, p, TEST_RADIUS - 20));
    // 聞こえた者から wake.radius の外、かつ音の半径の外にいるメンバー
    const straggler = jinMember(state, jin, { x: heard.body.pos.x + JIN.wake.radius + 400, y: heard.body.pos.y });
    ring(state, p);
    wakeByNoise(state);
    expect(heard.phase).toBe("chase");
    expect(jin.phase).toBe("engaged");
    expect(straggler.phase, "遠いメンバーはまだ眠る").toBe("idle");
    expect(jin.secondWaveAt, "後詰の時刻は入らない").toBeNull();
  });
});

describe("物見の鐘", () => {
  it("音で物見が起きると鐘が鳴り、最も近い眠っている陣も起きる", () => {
    const state = arena();
    state.jins = [];
    const p = state.player.body.pos;
    const lookout = addJin(state, 1, "lookout", p);
    const other = addJin(state, 2, "fishScale", { x: p.x + 500, y: p.y });
    const watcher = jinMember(state, lookout, openSpot(state, p, TEST_RADIUS - 20));
    const sleeper2 = jinMember(state, other, { x: p.x + 500, y: p.y });
    state.sfx = [];
    ring(state, p);
    wakeByNoise(state);
    expect(watcher.phase).toBe("chase");
    expect(other.phase, "近い陣").toBe("engaged");
    expect(sleeper2.phase, "陣のメンバーの近くだけ").toBe("chase");
    expect(state.sfx, "鐘").toContain(LOOKOUT_BELL_SFX);
  });
});
