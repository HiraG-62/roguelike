import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame, step } from "../core/game";
import { EMPTY_INPUT } from "../core/input";
import { FIXED_DT } from "../core/loop";
import { type Enemy, type GameState, type Jin, ROAMING_ROOM } from "../core/state";
import type { Vec } from "../core/vec";
import { dist } from "../core/vec";
import { ENEMIES, enemyDef } from "../data/enemies";
import { roleOf } from "../data/enemyRoles";
import { FORMATION_DEFS } from "../data/formations";
import { ENEMY_TEMPO, HONJIN, JIN, JINZU } from "../data/tuning";
import { Tile } from "../map/grid";
import { invalidatePathing } from "../map/pathing";
import { safeSpotExists } from "../map/jinzuShape";
import { initJinMorale, jinBonusMul, noteJinDeath } from "./jin";
import { spawnJin } from "./jinSpawn";
import {
  freshStrokeCount,
  honjinCount,
  jinzuHoldsAttack,
  makeHonjin,
  planStrokes,
  surgeStrikerSlot,
  updateJinzu,
} from "./jinzu";
import { canLeadHonjin, pickHonjinLeader } from "./jinzuSquads";
import { applyStagger, poiseTakenMul } from "./poise";
import { removeStatus, applyStatus } from "./statusEffects";
import { arena, placeEnemy, withTuning } from "./testHelpers";
import { stirSleepingJin } from "./jin";

/** 本陣と陣図（system/jinzu.ts・jinzuRun.ts・jinzuSquads.ts。docs/ideas/jinzu-impl.md） */

const ROOM_A = 1;
const ROOM_B = 2;
/** 鶴翼の本陣の広場: 大将から的（プレイヤー）まで */
const REACH = 150;
const TRIAL_BACKUP = HONJIN.trial.depth;
const DEPTH4_BACKUP = (HONJIN.countByDepth as Record<string, number>)["4"];

afterEach(() => {
  // モジュールの数値を書き換えたテストは元に戻す
  (HONJIN.trial as { depth: number }).depth = TRIAL_BACKUP;
  (HONJIN.countByDepth as Record<string, number>)["4"] = DEPTH4_BACKUP ?? 1;
});

// -----------------------------------------------------------------------------
// 広場づくり
// -----------------------------------------------------------------------------

interface Field {
  state: GameState;
  jin: Jin;
  leader: Enemy;
  /** 走る隊の候補（slime） */
  runners: Enemy[];
  /** 大将以外の射手（eye） */
  shooters: Enemy[];
}

/** 壁の無い広場。地図の全タイルを床にする（壁で画が切れない） */
function openField(state: GameState): void {
  state.map.tiles.fill(Tile.Floor);
  invalidatePathing(state.map);
}

function member(state: GameState, jin: Jin, key: string, at: Vec): Enemy {
  const p = state.player.body.pos;
  const e = placeEnemy(state, key, at.x - p.x, at.y - p.y);
  e.roomIndex = jin.roomIndex;
  e.jinId = jin.id;
  e.phase = "chase";
  e.attackCooldown = 99;
  return e;
}

/**
 * 鶴翼の本陣。プレイヤーは広場の中央、大将は REACH だけ西（奥の頂点）に立ち、翼が前（東）へ開く。
 * 左右の翼に 3 人ずつ（外 2・内 1）の slime、大将の脇に射手 2 人。群勢は満ち、起きてから十分に経っている
 */
function field(seed = 7): Field {
  const state = arena(seed);
  state.depth = 4;
  openField(state);
  const pl = { x: Math.floor(state.map.width / 2) * 16, y: Math.floor(state.map.height / 2) * 16 };
  state.player.body.pos = { ...pl };
  state.player.invulnTimer = 999;
  state.player.maxHp = 9999;
  state.player.hp = 9999;
  state.jins = [];
  for (const i of [ROOM_A, ROOM_B]) {
    const room = state.rooms[i];
    if (!room) throw new Error(`部屋 ${i} が無い`);
    room.locked = false;
    room.engaged = false;
    room.cleared = false;
  }
  const L = { x: pl.x - REACH, y: pl.y };
  const jin: Jin = {
    id: 1,
    roomIndex: ROOM_A,
    formation: "craneWing",
    center: { x: L.x + 20, y: L.y },
    facing: { x: 1, y: 0 },
    leaderId: null,
    hpMul: 1,
    morale: 0,
    moraleMax: 0,
    phase: "engaged",
    engagedAt: state.time - 10,
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
  };
  state.jins.push(jin);
  const leader = member(state, jin, "eye", L);
  const shooters = [member(state, jin, "eye", { x: L.x + 8, y: L.y + 14 }), member(state, jin, "eye", { x: L.x + 8, y: L.y - 14 })];
  const runners: Enemy[] = [];
  for (const side of [1, -1]) {
    for (const [du, dv] of [
      [60, 62],
      [60, 42],
      [40, 22],
    ] as const) {
      runners.push(member(state, jin, "slime", { x: L.x + du, y: L.y + side * dv }));
    }
  }
  expect(makeHonjin(state, jin), "本陣にできる").toBe(true);
  expect(jin.leaderId, "座（奥）に最も近い射手が大将").toBe(leader.id);
  leader.attackCooldown = 99;
  return { state, jin, leader, runners, shooters };
}

function tick(state: GameState, steps = 1): void {
  for (let i = 0; i < steps; i++) step(state, EMPTY_INPUT, FIXED_DT);
}

/** 条件が満ちるまで進める（上限を超えたら失敗） */
function until(state: GameState, ok: () => boolean, maxSec: number, what: string): void {
  const limit = Math.ceil(maxSec / FIXED_DT);
  for (let i = 0; i < limit; i++) {
    if (ok()) return;
    tick(state);
  }
  expect(ok(), what).toBe(true);
}

function jz(f: Field): NonNullable<Jin["jinzu"]> {
  const z = f.jin.jinzu;
  if (!z) throw new Error("陣図が無い");
  return z;
}

/** k 番目（0 始まり）の画が下絵（sketch）になるまで進める */
function untilSketch(f: Field, k: number): void {
  until(f.state, () => jz(f).strokes[k]?.state === "sketch", 8, `${k + 1} 画目が出る`);
}

function untilPhase(f: Field, phase: NonNullable<Jin["jinzu"]>["phase"], maxSec = 10): void {
  until(f.state, () => jz(f).phase === phase, maxSec, `段 ${phase} に入る`);
}

/** 走った敵の id の入れ物（tickRecording が毎ステップ記録する。走りが一瞬で終わる敵も取りこぼさない） */
function trackRunners(_f: Field): Set<number> {
  return new Set<number>();
}

function tickRecording(f: Field, ran: Set<number>, steps: number): void {
  for (let i = 0; i < steps; i++) {
    tick(f.state);
    for (const e of f.state.enemies) if (e.jinzuRun?.mode === "run" && e.phase === "strike") ran.add(e.id);
  }
}

function staggerLeader(f: Field): void {
  expect(applyStagger(f.state, f.leader, 1.5), "怯ませられる").toBe(true);
}

// -----------------------------------------------------------------------------
// 本陣の選び方
// -----------------------------------------------------------------------------

describe("本陣の数", () => {
  it("章 1 は深度 4 だけ 1、休符・ボス階・最深の間は 0、章 2 以降は章の値（上限 4）", () => {
    expect([1, 2, 3, 4, 5].map(honjinCount), "章 1").toEqual([0, 0, 0, 1, 0]);
    expect(honjinCount(6), "章 2 の休符").toBe(0);
    expect([7, 8, 9].map(honjinCount), "章 2").toEqual([2, 2, 2]);
    expect(honjinCount(10), "章 2 のボス階").toBe(0);
    expect([12, 13, 14].map(honjinCount), "章 3").toEqual([2, 2, 2]);
    expect([17, 18, 19].map(honjinCount), "章 4").toEqual([3, 3, 3]);
    expect(honjinCount(21), "最深の間").toBe(0);
    expect(honjinCount(24), "深み").toBe(3);
    for (let d = 1; d <= 30; d++) expect(honjinCount(d), `深度 ${d}`).toBeLessThanOrEqual(HONJIN.max);
  });
});

describe("本陣の選び方（planHonjin）", () => {
  const FLOOR4 = { startDepth: 4 };

  function floor4(seed: number): GameState {
    return createGame(seed, String(seed), undefined, undefined, { origin: "wanderer", modifiers: [], ...FLOOR4 });
  }

  it("深度 4 の階に本陣が 1 つ立ち、同じ seed で 2 回作ると同じ陣・同じ大将", () => {
    let found = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const a = floor4(seed);
      const b = floor4(seed);
      const ja = a.jins.filter((j) => j.honjin);
      const jb = b.jins.filter((j) => j.honjin);
      expect(ja.length, `seed=${seed} 本陣は 1 つまで`).toBeLessThanOrEqual(1);
      expect(ja.map((j) => [j.id, j.roomIndex, j.leaderId]), `seed=${seed} 決定的`).toEqual(jb.map((j) => [j.id, j.roomIndex, j.leaderId]));
      found += ja.length;
      for (const j of ja) {
        expect(j.formation, "章 1 は鶴翼だけ").toBe("craneWing");
        expect(j.jinzu?.phase, "待ちで始まる").toBe("ready");
        expect(j.roomIndex, "開始の塊でも最初の戦いの塊でもない").toBeGreaterThanOrEqual(2);
      }
    }
    expect(found, "鶴翼の陣がある階には本陣が立つ").toBeGreaterThan(0);
  });

  it("本陣の数 0 と 1 で、敵の key・位置・生命は大将の格上げ以外すべて同じで、乱数も引いていない", () => {
    const table = HONJIN.countByDepth as Record<string, number>;
    let compared = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      table["4"] = 0;
      const without = floor4(seed);
      table["4"] = 1;
      const withHonjin = floor4(seed);
      const leaderId = withHonjin.jins.find((j) => j.honjin)?.leaderId;
      if (leaderId === null || leaderId === undefined) continue;
      compared++;
      expect(without.jins.some((j) => j.honjin), "数 0 なら本陣は無い").toBe(false);
      expect(withHonjin.enemies.length, `seed=${seed} 敵の数`).toBe(without.enemies.length);
      for (const [i, e] of withHonjin.enemies.entries()) {
        const o = without.enemies[i];
        expect(o, `seed=${seed} 同じ並び`).toBeDefined();
        expect(e.defKey, "key").toBe(o?.defKey);
        expect(e.body.pos, "位置").toEqual(o?.body.pos);
        expect(e.jinId, "陣").toBe(o?.jinId);
        if (e.id === leaderId) continue;
        expect(e.maxHp, `seed=${seed} 大将以外の生命`).toBe(o?.maxHp);
      }
      expect(withHonjin.rng.next(), `seed=${seed} 乱数を 1 つも引いていない`).toBe(without.rng.next());
    }
    expect(compared, "比べた盤がある").toBeGreaterThan(0);
  });

  it("本陣の大将は、陣の人数の多い順・奥の塊の本陣に付き、本陣どうしは minSpacing 以上離れる", () => {
    const table = HONJIN.countByDepth as Record<string, number>;
    table["4"] = 4;
    for (const seed of [4, 5, 6, 7]) {
      const state = floor4(seed);
      const honjin = state.jins.filter((j) => j.honjin);
      for (let i = 0; i < honjin.length; i++) {
        for (let k = i + 1; k < honjin.length; k++) {
          expect(dist(honjin[i]!.center, honjin[k]!.center), `seed=${seed} 本陣の間`).toBeGreaterThanOrEqual(HONJIN.minSpacing);
        }
      }
    }
  });

  it("試し陣（HONJIN.trial）はその深度の最初の戦いの塊のすぐ奥の陣を鶴翼の本陣にする", () => {
    (HONJIN.trial as { depth: number }).depth = 4;
    for (const seed of [1, 2, 3]) {
      const state = floor4(seed);
      const honjin = state.jins.filter((j) => j.honjin);
      expect(honjin.length, `seed=${seed} 本陣がある`).toBeGreaterThanOrEqual(1);
      expect(honjin[0]?.formation, "鶴翼").toBe("craneWing");
      const rooms = state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM && j.roomIndex >= 2).map((j) => j.roomIndex);
      expect(honjin[0]?.roomIndex, "最初の戦いの塊のすぐ奥").toBe(Math.min(...rooms));
    }
  });

  it("本陣は歩き出さない（長蛇にならない）。素の陣は歩き出す", () => {
    const f = field();
    f.jin.phase = "sleeping";
    f.state.floorTime = JIN.stir.delay + 1;
    for (const e of f.state.enemies) e.phase = "idle";
    f.state.rooms[ROOM_A]!.cleared = false;
    expect(stirSleepingJin(f.state), "本陣しかいなければ歩かせない").toBe(false);
    expect(f.jin.stirred).toBeUndefined();
    f.jin.honjin = undefined;
    expect(stirSleepingJin(f.state), "素の陣なら歩かせる").toBe(true);
  });
});

describe("大将の格上げ", () => {
  function plain(state: GameState, key: string, at: Vec): Enemy {
    const e = placeEnemy(state, key, at.x, at.y);
    return e;
  }

  it("部屋主・仇・群れ・潜る敵・障壁 / 堅牢 / 見切り / 号令の精鋭は大将にならない", () => {
    const state = arena();
    const lair = ENEMIES.find((d) => d.lairMaster === true);
    const swarm = ENEMIES.find((d) => roleOf(d) === "swarm" && d.boss !== true);
    expect(lair, "部屋主の敵がいる").toBeDefined();
    expect(swarm, "群れの役割の敵がいる").toBeDefined();
    const ok = plain(state, "slime", { x: 0, y: 0 });
    expect(canLeadHonjin(ok, enemyDef("slime")), "並の前衛は大将になれる").toBe(true);
    expect(canLeadHonjin(plain(state, lair!.key, { x: 30, y: 0 }), lair!), "部屋主").toBe(false);
    expect(canLeadHonjin(plain(state, swarm!.key, { x: 60, y: 0 }), swarm!), "群れ").toBe(false);
    const nemesis = plain(state, "slime", { x: 90, y: 0 });
    nemesis.nemesis = true;
    expect(canLeadHonjin(nemesis, enemyDef("slime")), "仇").toBe(false);
    const hidden = plain(state, "slime", { x: 120, y: 0 });
    hidden.hidden = true;
    expect(canLeadHonjin(hidden, enemyDef("slime")), "潜る敵").toBe(false);
    for (const kind of HONJIN.leaderExclude) {
      const e = plain(state, "slime", { x: 150, y: 0 });
      e.elite = kind as Enemy["elite"];
      expect(canLeadHonjin(e, enemyDef("slime")), `精鋭 ${kind}`).toBe(false);
    }
    const second = plain(state, "slime", { x: 180, y: 0 });
    second.eliteExtra = "shielded";
    expect(canLeadHonjin(second, enemyDef("slime")), "2 つ目の修飾子にも見る").toBe(false);
    const fine = plain(state, "slime", { x: 210, y: 0 });
    fine.elite = "hasted";
    expect(canLeadHonjin(fine, enemyDef("slime")), "止めにくくない精鋭は可").toBe(true);
  });

  it("座（奥）に最も近い大将にできる 1 人が大将になり、並なら猛になる。精鋭の修飾子は付かない", () => {
    const f = field();
    expect(f.leader.grade, "並の射手は猛へ").toBe("strong");
    expect(f.leader.elite, "精鋭の修飾子は付けない").toBeUndefined();
    expect(f.jin.moraleMax, "群勢は数え直す（大将の重さを含む）").toBe(
      f.state.enemies.reduce((sum, e) => sum + (e.id === f.leader.id ? JIN.gradeWeight.leader : JIN.gradeWeight[e.grade === "strong" ? "strong" : "normal"]), 0),
    );
    // 奥の頂点の大将が不適格なら、次に奥の適格な 1 人
    const g = field();
    g.leader.nemesis = true;
    g.jin.leaderId = null;
    expect(pickHonjinLeader(g.state, g.jin, "rear")?.id, "仇は飛ばして次の射手").toBe(g.shooters[0]?.id);
  });
});

// -----------------------------------------------------------------------------
// 陣図の形（全陣形の安全地帯・隊の割り振り）
// -----------------------------------------------------------------------------

describe("陣図の作図（planStrokes）", () => {
  it("全陣形 × 的の距離 3 通り × 向き 8 通りで、画が minStrokes 以上あり、安全地帯が届く所にある。画は上限以下で隊は重ならない", () => {
    const reachMul = 120;
    for (const def of FORMATION_DEFS.filter((d) => d.jinzu)) {
      for (const dist3 of [60, 150, 220]) {
        for (let k = 0; k < 8; k++) {
          const state = arena(11);
          state.depth = 4;
          openField(state);
          state.jins = [];
          const center = { x: Math.floor(state.map.width / 2) * 16 + 400, y: Math.floor(state.map.height / 2) * 16 };
          const a = (k / 8) * Math.PI * 2;
          const facing = { x: Math.cos(a), y: Math.sin(a) };
          const jin = spawnJin(state, ROOM_A, def, 16, center, facing, () => true, () => true);
          expect(jin, `${def.key} 陣が置ける`).not.toBeNull();
          if (!jin) continue;
          jin.phase = "engaged";
          for (const e of state.enemies) if (e.jinId === jin.id) e.phase = "chase";
          expect(makeHonjin(state, jin), `${def.key} 本陣にできる`).toBe(true);
          const leader = state.enemies.find((e) => e.id === jin.leaderId)!;
          const target = { x: leader.body.pos.x + Math.cos(a + 1) * dist3, y: leader.body.pos.y + Math.sin(a + 1) * dist3 };
          const planned = planStrokes(state, jin, leader, target);
          const where = `${def.key} 距離 ${dist3} 向き ${k}`;
          expect(planned.length, `${where} 画の数`).toBeGreaterThanOrEqual(JINZU.minStrokes);
          expect(planned.length, `${where} 画の上限`).toBeLessThanOrEqual(JINZU.maxStrokes);
          const ids = planned.flatMap((p) => p.squad);
          expect(new Set(ids).size, `${where} 隊は重ならない`).toBe(ids.length);
          expect(ids.includes(leader.id), `${where} 大将は隊に入らない`).toBe(false);
          const reach = reachMul * (JINZU.holdSec + (def.jinzu?.strokeSec ?? JINZU.strokeSec));
          expect(
            safeSpotExists(planned.map((p) => p.points), target, reach, JINZU.bandHalf),
            `${where} 安全地帯`,
          ).toBe(true);
        }
      }
    }
  });

  it("鶴翼の筆順どおりに隊を取る: 左右の外・内の 4 本は走る兵、5 本目は射手の射線", () => {
    const f = field();
    const planned = planStrokes(f.state, f.jin, f.leader, { ...f.state.player.body.pos });
    expect(planned.map((p) => p.kind), "鉤 鉤 脇抜け 脇抜け 射線").toEqual(["hook", "hook", "flank", "flank", "volley"]);
    const last = planned[4]!;
    expect(last.squad.sort(), "射線は大将以外の射手").toEqual(f.shooters.map((e) => e.id).sort());
    for (const p of planned.slice(0, 4)) {
      for (const id of p.squad) expect(f.runners.some((r) => r.id === id), "走る隊は slime").toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// 発生条件（R4）
// -----------------------------------------------------------------------------

describe("総掛かりの発生条件", () => {
  it("条件がそろえば掲げる: 的は掲げた瞬間のプレイヤーの位置、隊は持ち場で止まる、大将は筆を持つ", () => {
    const f = field();
    const at = { ...f.state.player.body.pos };
    tick(f.state);
    const z = jz(f);
    expect(z.phase, "掲げ").toBe("raise");
    expect(z.target, "的").toEqual(at);
    expect(z.surges, "1 回目").toBe(1);
    expect(f.leader.jinzuRun?.mode, "大将は筆を持つ").toBe("brush");
    const standing = f.state.enemies.filter((e) => e.jinzuRun?.mode === "stand");
    expect(standing.length, "隊の兵は持ち場で止まる").toBeGreaterThan(0);
    const before = standing.map((e) => ({ ...e.body.pos }));
    tick(f.state, 20);
    standing.forEach((e, i) => expect(dist(e.body.pos, before[i]!), "動かない").toBeLessThan(1));
  });

  it("群勢が minMoraleRatio 未満（削った本陣）なら掲げない", () => {
    const f = field();
    f.jin.morale = f.jin.moraleMax * (JINZU.minMoraleRatio - 0.05);
    tick(f.state, 30);
    expect(jz(f).phase).toBe("ready");
    f.jin.morale = f.jin.moraleMax * JINZU.minMoraleRatio;
    tick(f.state);
    expect(jz(f).phase, "ちょうどなら掲げる").toBe("raise");
  });

  it("起きてから firstDelay の間（後詰の前）は掲げない", () => {
    const f = field();
    f.jin.engagedAt = f.state.time;
    tick(f.state, Math.floor((JINZU.firstDelay - 0.2) / FIXED_DT));
    expect(jz(f).phase).toBe("ready");
    tick(f.state, Math.ceil(0.5 / FIXED_DT));
    expect(jz(f).phase, "過ぎれば掲げる").toBe("raise");
  });

  it("範囲の外・視線が通らないときは掲げない", () => {
    const far = field();
    far.state.player.body.pos.x += JINZU.triggerRange;
    tick(far.state, 20);
    expect(jz(far).phase, "範囲の外").toBe("ready");

    const blocked = field();
    const p = blocked.state.player.body.pos;
    const tx = Math.floor((p.x - REACH / 2) / 16);
    for (let y = Math.floor(p.y / 16) - 6; y <= Math.floor(p.y / 16) + 6; y++) blocked.state.map.tiles[y * blocked.state.map.width + tx] = Tile.Wall;
    invalidatePathing(blocked.state.map);
    tick(blocked.state, 20);
    expect(jz(blocked).phase, "視線が通らない").toBe("ready");
  });

  it("掲げは 2 回で尽きる（1 回目の後は立て直しと surgeCooldown の間は掲げない）", () => {
    const f = field();
    tick(f.state);
    const z = jz(f);
    z.surges = JINZU.maxSurges - 1;
    z.phase = "ready";
    z.readyAt = 0;
    f.leader.jinzuRun = undefined;
    for (const e of f.state.enemies) e.jinzuRun = undefined;
    tick(f.state);
    expect(z.surges, "2 回目").toBe(JINZU.maxSurges);
    // 終わらせて次を待つ
    z.phase = "regroup";
    z.t = JINZU.regroupSec;
    tick(f.state);
    expect(z.phase, "回数が尽きれば spent").toBe("spent");
    tick(f.state, 30);
    expect(z.phase, "もう掲げない").toBe("spent");
  });

  it("前の立て直しの終わりから surgeCooldown の間は次を掲げない", () => {
    const f = field();
    untilPhase(f, "brush");
    staggerLeader(f);
    tick(f.state);
    expect(jz(f).phase, "0 画で折れたので立て直し").toBe("regroup");
    expect(jz(f).readyAt, "次に掲げてよい時刻は立て直し + 間隔").toBeCloseTo(f.state.time + JINZU.regroupSec + JINZU.surgeCooldown, 1);
  });

  it("他の本陣が掲げ〜総掛かりにいる間は、別の本陣は掲げない（同時に 1 つ）", () => {
    const f = field();
    const other: Jin = { ...f.jin, id: 2, leaderId: null, honjin: undefined, jinzu: undefined, center: { x: 5000, y: 5000 } };
    f.state.jins.push(other);
    const lead = placeEnemy(f.state, "eye", 40, 40);
    lead.roomIndex = ROOM_B;
    lead.jinId = 2;
    lead.phase = "chase";
    lead.attackCooldown = 99;
    other.leaderId = lead.id;
    other.honjin = true;
    other.jinzu = { phase: "ready", t: 0, strokeSec: JINZU.strokeSec, target: { x: 0, y: 0 }, origin: { x: 0, y: 0 }, strokes: [], surges: 0, readyAt: 0 };
    jz(f).phase = "brush";
    updateJinzu(f.state, FIXED_DT);
    expect(other.jinzu.phase, "先に掲げている本陣がいる間は待つ").toBe("ready");
  });

  it("封鎖した部屋の中にいるときは掲げない", () => {
    const f = field();
    f.state.rooms[ROOM_B]!.locked = true;
    // 部屋の更新（敵のいない封鎖は解ける）を挟まず、陣図の見張りだけを回す
    for (let i = 0; i < 20; i++) updateJinzu(f.state, FIXED_DT);
    expect(jz(f).phase, "封鎖中は待つ").toBe("ready");
    f.state.rooms[ROOM_B]!.locked = false;
    updateJinzu(f.state, FIXED_DT);
    expect(jz(f).phase, "解ければ掲げる").toBe("raise");
  });
});

// -----------------------------------------------------------------------------
// 筆（R3-a・b・e）
// -----------------------------------------------------------------------------

describe("筆と筆折れ", () => {
  it("画は strokeSec ごとに 1 本ずつ出て、前の画は墨になる。全部に墨が入れば構えへ", () => {
    const f = field();
    untilSketch(f, 0);
    expect(jz(f).strokes.map((s) => s.state), "1 画目だけ下絵").toEqual(["sketch", "pending", "pending", "pending", "pending"]);
    untilSketch(f, 2);
    expect(jz(f).strokes.map((s) => s.state).slice(0, 3), "2 画目まで墨").toEqual(["ink", "ink", "sketch"]);
    untilPhase(f, "hold");
    expect(jz(f).strokes.every((s) => s.state === "ink"), "全部に墨").toBe(true);
    expect(f.state.time - (jz(f).strokes[0]?.inkedAt ?? 0), "1 画目から構えまで 4 画 + 掲げの分は経っている").toBeGreaterThan(JINZU.strokeSec * 3);
  });

  it("k 画目の下絵の間に大将を怯ませると、1〜k−1 画目の隊だけが走り、k 画目以降の隊は走らない", () => {
    const f = field();
    const ran = trackRunners(f);
    untilSketch(f, 2);
    staggerLeader(f);
    tick(f.state);
    expect(jz(f).strokes.map((s) => s.state), "墨 墨 消 消 消").toEqual(["ink", "ink", "erased", "erased", "erased"]);
    expect(jz(f).phase, "墨の画があれば構えへ").toBe("hold");
    const inked = new Set(jz(f).strokes.slice(0, 2).flatMap((s) => s.squad));
    const erased = new Set(jz(f).strokes.slice(2).flatMap((s) => s.squad));
    for (const id of erased) {
      const e = f.state.enemies.find((o) => o.id === id);
      expect(e?.jinzuRun, "消えた画の隊は解かれる").toBeUndefined();
    }
    tickRecording(f, ran, Math.ceil(4 / FIXED_DT));
    for (const id of inked) expect(ran.has(id), "墨の画の隊は走る").toBe(true);
    for (const id of erased) expect(ran.has(id), "消えた画の隊は走らない").toBe(false);
  });

  it("恐怖でも筆が折れる", () => {
    const f = field();
    untilSketch(f, 1);
    expect(applyStatus(f.state, { kind: "enemy", enemy: f.leader }, { kind: "fear", stacks: 1, duration: 2, potency: 0 }, "player")).toBe(true);
    tick(f.state);
    expect(jz(f).strokes.map((s) => s.state), "墨 消 消 消 消").toEqual(["ink", "erased", "erased", "erased", "erased"]);
  });

  it("0 画で折れたら（掲げ・1 画目の下絵の間）総掛かりは起きず、立て直しへ", () => {
    const f = field();
    const ran = trackRunners(f);
    untilSketch(f, 0);
    staggerLeader(f);
    tick(f.state);
    expect(jz(f).phase, "立て直し").toBe("regroup");
    expect(jz(f).strokes.every((s) => s.state === "erased"), "全部消える").toBe(true);
    tickRecording(f, ran, Math.ceil(3 / FIXED_DT));
    expect(ran.size, "誰も走らない").toBe(0);
    expect(f.state.enemies.some((e) => e.jinzuRun?.jin === f.jin.id && e.id !== f.leader.id), "隊は解かれている").toBe(false);
  });

  it("筆折れで群勢が breakMoraleLoss ぶん減る", () => {
    const f = field();
    untilSketch(f, 1);
    const before = f.jin.morale;
    staggerLeader(f);
    tick(f.state);
    expect(before - f.jin.morale, "最大の割合ぶん").toBeCloseTo(f.jin.moraleMax * JINZU.breakMoraleLoss, 5);
  });

  it("掲げ・筆の間の大将は怯み値を多く受け、集まっている間の強化（群勢が高いほど怯みにくい）も掛からない", () => {
    const f = field();
    const calm = poiseTakenMul(f.leader);
    expect(jinBonusMul(f.state, f.leader, "poiseTaken"), "筆の前: 群勢が満ちていれば怯みにくい").toBe(JIN.morale.highPoiseTakenMul);
    tick(f.state);
    expect(f.leader.jinzuRun?.mode).toBe("brush");
    expect(poiseTakenMul(f.leader) / calm, "筆の間の倍率").toBeCloseTo(JINZU.brushPoiseTakenMul, 6);
    expect(jinBonusMul(f.state, f.leader, "poiseTaken"), "強化は掛からない").toBe(1);
    expect(f.leader.phase, "強靭の掛かる予備動作にはならない（chase のまま）").toBe("chase");
  });

  it("凍結の間は筆の時計が止まり、解けたら続きから書く", () => {
    const f = field();
    untilSketch(f, 1);
    const frozenAt = jz(f).t;
    expect(applyStatus(f.state, { kind: "enemy", enemy: f.leader }, { kind: "freeze", stacks: 1, duration: 5, potency: 0 }, "env")).toBe(true);
    tick(f.state, 60);
    expect(jz(f).t, "凍っている間は進まない").toBeCloseTo(frozenAt, 6);
    expect(jz(f).phase, "折れもしない").toBe("brush");
    removeStatus(f.state, { kind: "enemy", enemy: f.leader }, "freeze");
    tick(f.state, 30);
    expect(jz(f).t, "解ければ続きから").toBeGreaterThan(frozenAt);
  });
});

// -----------------------------------------------------------------------------
// 構え・総掛かり（R3-c・d、R5、R6）
// -----------------------------------------------------------------------------

describe("構えと総掛かり", () => {
  it("墨の画は、構えの間に大将が怯んでも必ず走る（フェイントにしない）", () => {
    const f = field();
    const ran = trackRunners(f);
    untilPhase(f, "hold");
    staggerLeader(f);
    tickRecording(f, ran, Math.ceil(4 / FIXED_DT));
    const hooks = new Set(jz(f).strokes.filter((s) => s.kind !== "volley").flatMap((s) => s.squad));
    for (const id of hooks) expect(ran.has(id), "全部の画の隊が走る").toBe(true);
    expect(f.state.enemies.find((e) => e.id === f.leader.id)?.jinzuRun?.mode, "大将は筆を持たない").not.toBe("brush");
  });

  it("走る兵は strike の扱いで、先頭の兵が怯むとその隊は詰まり、残りは通常に戻る", () => {
    const f = field();
    untilPhase(f, "charge");
    const stroke = jz(f).strokes.find((s) => s.kind !== "volley" && s.squad.length >= 2)!;
    const head = f.state.enemies.find((e) => e.id === stroke.squad[0])!;
    tick(f.state, 3);
    expect(head.phase, "走る兵は strike").toBe("strike");
    expect(applyStagger(f.state, head, 1)).toBe(true);
    tick(f.state, 2);
    expect(stroke.jammed, "隊は先頭で詰まる").toBe(true);
    for (const id of stroke.squad) {
      const e = f.state.enemies.find((o) => o.id === id);
      expect(e?.jinzuRun, "隊の走りは止まる").toBeUndefined();
      if (e && e !== head) expect(e.phase, "残りは通常に戻る").not.toBe("strike");
    }
    expect(stroke.state, "画は終わる").toBe("done");
  });

  it("走る兵が怯み・撃破で止まっても、その兵だけ（隊頭でなければ隊は走り続ける）", () => {
    const f = field();
    untilPhase(f, "charge");
    const stroke = jz(f).strokes.find((s) => s.kind !== "volley" && s.squad.length >= 2)!;
    const tail = f.state.enemies.find((e) => e.id === stroke.squad[1])!;
    const head = f.state.enemies.find((e) => e.id === stroke.squad[0])!;
    tick(f.state, 8);
    expect(applyStagger(f.state, tail, 1)).toBe(true);
    tick(f.state, 2);
    expect(stroke.jammed, "隊頭が無事なら詰まらない").toBe(false);
    expect(tail.jinzuRun, "止まった兵は走りを外れる").toBeUndefined();
    expect(head.jinzuRun === undefined ? head.phase !== "strike" || stroke.finished.includes(head.id) : head.jinzuRun.mode === "run", "隊頭は走り続ける").toBe(true);
  });

  it("走る兵は当たったら走りを終え（1 人 1 回まで）、当たった隊は空を切った数えにならない", () => {
    const f = field();
    f.state.player.invulnTimer = 0;
    untilPhase(f, "charge");
    const stroke = jz(f).strokes.find((s) => s.kind !== "volley" && s.squad.length >= 2)!;
    // 的の脇を通る鉤の道の上へ立つ（的そのものは鉤に空を切られる）。隊が走ってきて当たる
    f.state.player.body.pos = { ...stroke.points[Math.floor(stroke.points.length / 2)]! };
    until(f.state, () => jz(f).strokes.some((s) => s.hit), 3, "どこかの隊が当たる");
    const hitStroke = jz(f).strokes.find((s) => s.hit)!;
    for (const id of hitStroke.finished) {
      const e = f.state.enemies.find((o) => o.id === id);
      expect(e?.jinzuRun, "走り終えた兵は走りを外れる").toBeUndefined();
    }
    tick(f.state, Math.ceil(2.5 / FIXED_DT));
    for (const s of jz(f).strokes) expect(new Set(s.finished).size, "同じ兵が 2 回走り終えない").toBe(s.finished.length);
    expect(stroke.state, "画は終わる").toBe("done");
    expect(f.state.player.hp, "当たれば傷は受ける").toBeLessThan(9999);
    const loss = f.jin.moraleMax * JINZU.missMoraleLoss;
    expect(f.jin.morale, "当たった隊の分は減らない").toBeGreaterThan(f.jin.moraleMax - loss * jz(f).strokes.length - 1e-9);
  });

  it("構えの間に怯んだ隊の兵は、総掛かりで持ち場を解かれる（立ったまま残らない）", () => {
    const f = field();
    untilPhase(f, "hold");
    const stroke = jz(f).strokes.find((s) => s.state === "ink" && s.kind !== "volley")!;
    const id = stroke.squad[0]!;
    const stunned = f.state.enemies.find((e) => e.id === id)!;
    expect(stunned.jinzuRun?.mode, "構えの間は持ち場").toBe("stand");
    expect(applyStagger(f.state, stunned, 3)).toBe(true);
    untilPhase(f, "charge");
    expect(stunned.jinzuRun, "走れない兵の持ち場は解く").toBeUndefined();
    expect(stroke.squad, "隊から外れる").not.toContain(id);
  });

  it("空を切った隊は群勢が missMoraleLoss ぶん減る。当たった隊・隊頭が詰まった隊は減らない", () => {
    const f = field();
    untilPhase(f, "charge");
    // 的の位置から離れて、走り抜ける道に当たらない所へ（安全地帯）
    f.state.player.body.pos = { x: f.state.player.body.pos.x - 10, y: f.state.player.body.pos.y + 260 };
    const before = f.jin.morale;
    untilPhase(f, "regroup", 6);
    const squads = jz(f).strokes.filter((s) => s.kind !== "volley" && s.finished.length > 0 && !s.hit && !s.jammed).length;
    expect(squads, "空を切った隊がある").toBeGreaterThan(0);
    expect(before - f.jin.morale, "隊の数 × 最大の割合").toBeCloseTo(f.jin.moraleMax * JINZU.missMoraleLoss * squads, 5);
  });

  it("構え・総掛かりの間、周りの敵は新しい予備動作に入らない。既に予備動作の敵はそのまま出す", () => {
    const f = field();
    const other = member(f.state, f.jin, "slime", { x: f.state.player.body.pos.x + 30, y: f.state.player.body.pos.y + 90 });
    other.jinId = undefined;
    expect(jinzuHoldsAttack(f.state, other), "待ちの間は止めない").toBe(false);
    untilPhase(f, "hold");
    other.attackCooldown = 0;
    expect(jinzuHoldsAttack(f.state, other), "構えの間は止める").toBe(true);
    tick(f.state, 3);
    expect(other.phase, "新しい予備動作に入らない").toBe("chase");
    expect(other.attackCooldown, "攻撃開始を延ばす").toBeGreaterThan(0);
    const windupEnemy = member(f.state, f.jin, "slime", { x: f.state.player.body.pos.x - 30, y: f.state.player.body.pos.y + 90 });
    windupEnemy.jinId = undefined;
    windupEnemy.phase = "windup";
    windupEnemy.windupTotal = 0.4;
    windupEnemy.phaseTimer = 0.05;
    tick(f.state, 5);
    expect(windupEnemy.phase, "既に予備動作の敵はそのまま出す").toBe("strike");
  });

  it("走る兵は 1 人ずつでなく総掛かり 1 つで 1 枠。走っている最中でも周りの敵は同時攻撃の上限に阻まれない", () => {
    const f = field();
    untilPhase(f, "charge");
    tick(f.state, 3);
    const running = f.state.enemies.filter((e) => e.jinzuRun?.mode === "run" && e.phase === "strike");
    expect(running.length, "3 人以上が同時に走っている").toBeGreaterThanOrEqual(3);
    expect(surgeStrikerSlot(f.state), "総掛かりで 1 枠").toBe(1);
    // 他の敵の予備動作が終わっても、走る兵の数ぶんの枠は使われていない
    const other = member(f.state, f.jin, "slime", { x: f.state.player.body.pos.x, y: f.state.player.body.pos.y + 120 });
    other.jinId = undefined;
    other.phase = "windup";
    other.windupTotal = 0.4;
    other.phaseTimer = 0.0;
    expect(running.length, "上限（2 + 起きている敵 ÷ 3）より多く走っていても").toBeGreaterThan(ENEMY_TEMPO.strikerBase);
    tick(f.state, 2);
    expect(other.phase, "枠が空いていて strike に進む").toBe("strike");
  });

  it("画が出て telegraphWindow の間は予告の上限に 1 つと数え、周りの予備動作が待つ", () => {
    const f = field();
    untilSketch(f, 0);
    expect(freshStrokeCount(f.state), "出たばかり").toBe(1);
    // 他の敵が出たばかりの予告を cap − 1 だけ出している
    const p = f.state.player.body.pos;
    for (let i = 0; i < ENEMY_TEMPO.telegraphCap - 1; i++) {
      const e = member(f.state, f.jin, "slime", { x: p.x + 20 * i, y: p.y + 80 });
      e.jinId = undefined;
      e.phase = "windup";
      e.windupTotal = 1;
      e.phaseTimer = 0.95;
    }
    const waiting = member(f.state, f.jin, "slime", { x: p.x, y: p.y + 40 });
    waiting.jinId = undefined;
    waiting.attackCooldown = 0;
    tick(f.state);
    expect(waiting.phase, "画が出たばかりの間は新しい予備動作に入らない").toBe("chase");
    const z = jz(f);
    z.t = (z.strokes[0]?.appearAt ?? 0) + ENEMY_TEMPO.telegraphWindow + 0.05;
    expect(freshStrokeCount(f.state), "0.3 秒過ぎたら数えない").toBe(0);
  });

  it("大将の撃破で全画が消え、走りが止まり、旗が倒れる（敗走）", () => {
    const f = field();
    untilPhase(f, "charge");
    tick(f.state, 3);
    // 崩れたとき全員が逃げる抽選に固定（一部が背水で残る形は jin.test.ts）
    vi.spyOn(f.state.rng, "chance").mockReturnValue(true);
    f.leader.hp = 0;
    noteJinDeath(f.state, f.leader);
    expect(jz(f).phase, "畳む").toBe("spent");
    expect(jz(f).strokes, "全部の画が消える").toEqual([]);
    expect(f.state.enemies.some((e) => e.jinzuRun !== undefined), "誰も陣図に動かされていない").toBe(false);
    expect(f.state.enemies.some((e) => e.phase === "strike" && e.hp > 0), "走りは止まる（敗走）").toBe(false);
    expect(f.jin.flagFall, "旗倒れの印").toBeDefined();
    expect(f.jin.phase, "敗走で決着").toBe("settled");
  });

  it("走りの途中で敗走の線を切れば走りも止まる", () => {
    const f = field();
    untilPhase(f, "charge");
    tick(f.state, 3);
    f.jin.morale = f.jin.moraleMax * JIN.morale.routRatio - 0.1;
    vi.spyOn(f.state.rng, "chance").mockReturnValue(true);
    // 1 体倒して noteJinDeath で線を切らせる
    const victim = f.runners[0]!;
    victim.hp = 0;
    noteJinDeath(f.state, victim);
    expect(f.state.enemies.some((e) => e.jinzuRun !== undefined && e.hp > 0), "走りは止まる").toBe(false);
    expect(f.jin.phase).toBe("settled");
  });
});

describe("旗倒れ", () => {
  function otherJin(f: Field, id: number, at: Vec, phase: Jin["phase"] = "engaged"): Jin {
    const jin: Jin = {
      id,
      roomIndex: ROOM_B,
      formation: "fishScale",
      center: { ...at },
      facing: { x: 1, y: 0 },
      leaderId: null,
      hpMul: 1,
      morale: 0,
      moraleMax: 0,
      phase,
      secondWaveAt: null,
      deathsTick: -1,
      deathsInTick: 0,
    };
    f.state.jins.push(jin);
    for (let i = 0; i < 6; i++) {
      const e = placeEnemy(f.state, "slime", at.x - f.state.player.body.pos.x + i * 14, at.y - f.state.player.body.pos.y);
      e.roomIndex = ROOM_B;
      e.jinId = id;
      e.phase = phase === "sleeping" ? "idle" : "chase";
      e.attackCooldown = 99;
    }
    initJinMorale(f.state, jin);
    return jin;
  }

  it("近くの交戦中の素の陣の群勢が flagFall.moraleLoss ぶん落ち、遠い陣・眠っている陣・他の本陣には効かない", () => {
    const f = field();
    const lp = f.leader.body.pos;
    const near = otherJin(f, 2, { x: lp.x + 100, y: lp.y + 100 });
    const far = otherJin(f, 3, { x: lp.x + JINZU.flagFall.radius + 200, y: lp.y });
    const asleep = otherJin(f, 4, { x: lp.x - 100, y: lp.y - 100 }, "sleeping");
    const rival = otherJin(f, 5, { x: lp.x + 100, y: lp.y - 100 });
    rival.honjin = true;
    const nearMax = near.moraleMax;
    f.leader.hp = 0;
    noteJinDeath(f.state, f.leader);
    expect(near.morale, "近くの交戦中の陣").toBeCloseTo(nearMax * (1 - JINZU.flagFall.moraleLoss), 5);
    expect(far.morale, "遠い陣").toBe(far.moraleMax);
    expect(asleep.morale, "眠っている陣").toBe(asleep.moraleMax);
    expect(rival.morale, "他の本陣（連鎖させない）").toBe(rival.moraleMax);
  });

  it("崩れかけの陣は旗倒れで敗走の線を切って、その場で背を向ける", () => {
    const f = field();
    const lp = f.leader.body.pos;
    const shaky = otherJin(f, 2, { x: lp.x + 80, y: lp.y + 80 });
    shaky.morale = shaky.moraleMax * (JIN.morale.routRatio + JINZU.flagFall.moraleLoss * 0.5);
    vi.spyOn(f.state.rng, "chance").mockReturnValue(true);
    f.leader.hp = 0;
    noteJinDeath(f.state, f.leader);
    expect(shaky.phase, "敗走で決着").toBe("settled");
    expect(shaky.settledBy).toBe("rout");
    expect(f.state.enemies.filter((e) => e.jinId === 2).length, "陣から外れた").toBe(0);
  });

  it("本陣の決着で鍵を必ず落とす（keyChance）", () => {
    withTuning(HONJIN, { keyChance: 1 }, () => {
      const f = field();
      const keys0 = f.state.pickups.filter((p) => p.kind === "key").length;
      const chance = vi.spyOn(f.state.rng, "chance").mockReturnValue(true);
      f.leader.hp = 0;
      noteJinDeath(f.state, f.leader);
      expect(f.jin.phase, "本陣が決着する").toBe("settled");
      expect(chance, "本陣の鍵の確率で抽選する").toHaveBeenCalledWith(1);
      expect(f.state.pickups.filter((p) => p.kind === "key").length, "鍵が落ちる").toBe(keys0 + 1);
    });
  });
});
