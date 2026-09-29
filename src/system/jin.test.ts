import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { type Enemy, type GameState, type Jin, ROAMING_ROOM } from "../core/state";
import type { Vec } from "../core/vec";
import { dist } from "../core/vec";
import { JIN_TEXT } from "../data/actionText";
import { enemyDef } from "../data/enemies";
import { JIN } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { emptyJinSettle, recordJinSettle } from "../qa/jinMetrics";
import { updateEnemies } from "./enemies";
import {
  initJinMorale,
  jinBonusMul,
  memberWeight,
  noteJinDeath,
  roomClearText,
  stepRout,
  stirSleepingJin,
  stirsDue,
  updateJins,
  wakeJin,
} from "./jin";
import { enemyDropChance } from "./loot";
import { addPoise } from "./poise";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 群勢と敗走・後詰・増援の代わり（system/jin.ts。docs/ideas/jin-impl.md 2-5・2-7） */

const ROOM_A = 1;
const ROOM_B = 2;

/** 陣の無い開始部屋に立った状態。部屋 1・2 を「封鎖しない・未交戦・未制圧」にしておく */
function jinArena(): GameState {
  const state = arena();
  state.jins = [];
  for (const i of [ROOM_A, ROOM_B]) {
    const room = state.rooms[i];
    if (!room) throw new Error(`部屋 ${i} が無い`);
    room.locked = false;
    room.engaged = false;
    room.cleared = false;
  }
  state.player.invulnTimer = 999;
  return state;
}

function addJin(state: GameState, id: number, roomIndex: number, center: Vec, phase: Jin["phase"] = "engaged"): Jin {
  const jin: Jin = {
    id,
    roomIndex,
    formation: "fishScale",
    center: { ...center },
    facing: { x: 1, y: 0 },
    leaderId: null,
    morale: 0,
    moraleMax: 0,
    phase,
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
  };
  state.jins.push(jin);
  return jin;
}

/** プレイヤーから (dx, dy) に陣のメンバーを置く */
function member(state: GameState, jin: Jin, dx: number, dy = 0, key = "slime"): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.roomIndex = jin.roomIndex;
  e.jinId = jin.id;
  e.phase = jin.phase === "sleeping" ? "idle" : "chase";
  return e;
}

/** 撃破を 1 体ぶん起こす（handleDeaths → onEnemyDeath と同じ順で noteJinDeath を呼ぶ） */
function kill(state: GameState, e: Enemy): void {
  e.hp = 0;
  noteJinDeath(state, e);
}

describe("群勢の初期値", () => {
  it("群勢の最大はメンバーの重さの合計（並 1・猛 2・大将 4）", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos);
    member(state, jin, 20);
    const strong = member(state, jin, 40);
    strong.grade = "strong";
    const leader = member(state, jin, 60);
    jin.leaderId = leader.id;
    initJinMorale(state, jin);
    const want = JIN.gradeWeight.normal + JIN.gradeWeight.strong + JIN.gradeWeight.leader;
    expect(jin.moraleMax).toBe(want);
    expect(jin.morale, "満ちた状態で始まる").toBe(want);
    expect(memberWeight(jin, leader)).toBe(JIN.gradeWeight.leader);
  });
});

describe("群勢の減り", () => {
  it("撃破で重さぶん減り、処刑と同じ tick の 2 体目以降は余分に減る", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos);
    const list = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200].map((dx) => member(state, jin, dx));
    initJinMorale(state, jin);
    const max = jin.moraleMax;
    kill(state, list[0]!);
    expect(jin.morale, "並 1 体").toBe(max - JIN.gradeWeight.normal);
    state.tick += 1;
    list[1]!.executed = true;
    kill(state, list[1]!);
    expect(jin.morale, "処刑は executeBonus を足す").toBe(max - 2 * JIN.gradeWeight.normal - JIN.morale.executeBonus);
    state.tick += 1;
    const before = jin.morale;
    kill(state, list[2]!);
    kill(state, list[3]!);
    expect(jin.morale, "同じ tick の 2 体目は multiKillBonus を足す").toBe(before - 2 * JIN.gradeWeight.normal - JIN.morale.multiKillBonus);
    expect(jin.phase, "まだ崩れない").toBe("engaged");
  });

  it("routRatio を切ると生き残りが敗走し、陣は敗走で決着する", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos);
    const list = [20, 40, 60].map((dx) => member(state, jin, dx));
    initJinMorale(state, jin);
    kill(state, list[0]!);
    expect(jin.phase, "3 → 2 はまだ").toBe("engaged");
    kill(state, list[1]!);
    expect(jin.morale).toBeLessThanOrEqual(jin.moraleMax * JIN.morale.routRatio);
    expect(jin.phase).toBe("settled");
    expect(jin.settledBy).toBe("rout");
    const survivor = list[2]!;
    expect(survivor.rout, "生き残りは敗走中").toBeDefined();
    expect(survivor.jinId, "陣から外れる").toBeUndefined();
    expect(survivor.roomIndex, "部屋の生存者から外れる").toBe(ROAMING_ROOM);
    expect(survivor.phase, "殴れるよう chase のまま").toBe("chase");
    expect(jin.routTally?.fled).toBe(1);
    expect(roomClearText(state, ROOM_A), "部屋の制圧の文字は敗走").toBe(JIN_TEXT.rout);
    expect(roomClearText(state, ROOM_B), "敗走の無い部屋は制圧").toBe(JIN_TEXT.wipe);
  });

  it("大将を倒すと leaderBreakRatio まで落ちて必ず敗走する", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos);
    const leader = member(state, jin, 20);
    jin.leaderId = leader.id;
    for (let i = 0; i < 8; i++) member(state, jin, 40 + i * 10);
    initJinMorale(state, jin);
    kill(state, leader);
    expect(jin.leaderFell).toBe(true);
    expect(jin.settledBy).toBe("rout");
    expect(jin.routTally?.fled).toBe(8);
  });

  it("塊に乗らない陣は交戦して決着したときだけハートの抽選をする（眠ったまま居なくなった陣は乱数を引かない）", () => {
    const state = jinArena();
    let draws = 0;
    const base = state.rng;
    state.rng = { ...base, chance: (p) => (draws++, base.chance(p)) };
    const sleeping = addJin(state, 1, ROAMING_ROOM, state.player.body.pos, "sleeping");
    const fought = addJin(state, 2, ROAMING_ROOM, state.player.body.pos, "engaged");
    updateJins(state);
    expect([sleeping.settledBy, fought.settledBy]).toEqual(["wipe", "wipe"]);
    expect(draws, "交戦した 1 陣だけ").toBe(1);
  });

  it("最後の 1 体の撃破は敗走にせず、updateJins が全滅で決着する", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos);
    const only = member(state, jin, 20);
    initJinMorale(state, jin);
    kill(state, only);
    expect(jin.phase, "生き残りがいなければ敗走しない").toBe("engaged");
    updateJins(state);
    expect(jin.settledBy).toBe("wipe");
  });
});

describe("敗走した敵", () => {
  /** 陣 1（崩れる側）と、少し離れた陣 2（逃げ込み先）。陣 1 の生き残りを 1 体返す */
  function routedPair(state: GameState, refugeDx: number): { from: Jin; to: Jin; router: Enemy; host: Enemy } {
    const from = addJin(state, 1, ROOM_A, state.player.body.pos);
    const to = addJin(state, 2, ROOM_B, state.player.body.pos);
    const a = member(state, from, 20);
    const b = member(state, from, 30);
    const router = member(state, from, 40);
    const host = member(state, to, refugeDx);
    member(state, to, refugeDx + 10);
    initJinMorale(state, from);
    initJinMorale(state, to);
    kill(state, a);
    kill(state, b);
    return { from, to, router, host };
  }

  it("最も近い他の陣へ向かい、着くと合流して群勢を足す（上限 moraleMax × mergeCapRatio）", () => {
    const state = jinArena();
    const { from, to, router } = routedPair(state, 60);
    expect(router.rout?.toJin, "行き先は陣 2").toBe(to.id);
    const before = to.morale;
    const def = enemyDef(router.defKey);
    for (let i = 0; i < 200 && router.rout; i++) stepRout(state, router, def, FIXED_DT, def.speed);
    expect(router.rout, "合流した").toBeUndefined();
    expect(router.jinId).toBe(to.id);
    expect(router.roomIndex).toBe(ROOM_B);
    expect(to.morale).toBe(Math.min(before + JIN.gradeWeight.normal, to.moraleMax * JIN.morale.mergeCapRatio));
    expect(from.routTally?.merged).toBe(1);
  });

  it("封鎖した部屋の陣へは逃げ込まない", () => {
    const state = jinArena();
    state.rooms[ROOM_B]!.locked = true;
    const { router } = routedPair(state, 60);
    expect(router.rout?.toJin, "行き先なし").toBeNull();
  });

  it("行き先が無ければ時計が尽きた後、プレイヤーから離れていれば消える（逃げ切り）", () => {
    const state = jinArena();
    const from = addJin(state, 1, ROOM_A, state.player.body.pos);
    const list = [20, 30, 40].map((dx) => member(state, from, dx));
    initJinMorale(state, from);
    kill(state, list[0]!);
    kill(state, list[1]!);
    const router = list[2]!;
    expect(router.rout?.toJin).toBeNull();
    const def = enemyDef(router.defKey);
    router.rout!.time = 0;
    stepRout(state, router, def, FIXED_DT, def.speed);
    expect(router.hp, "プレイヤーの近くでは消えない").toBeGreaterThan(0);
    state.player.body.pos = { x: router.body.pos.x + 2000, y: router.body.pos.y };
    stepRout(state, router, def, FIXED_DT, def.speed);
    expect(router.vanished, "逃げ切り").toBe(true);
    expect(router.hp).toBe(0);
    expect(from.routTally?.escaped).toBe(1);
  });

  it("逃げる敵は攻撃を始めず、プレイヤーから離れる", () => {
    const state = jinArena();
    const from = addJin(state, 1, ROOM_A, state.player.body.pos);
    const list = [20, 24, 28].map((dx) => member(state, from, dx));
    initJinMorale(state, from);
    kill(state, list[0]!);
    kill(state, list[1]!);
    state.enemies = state.enemies.filter((e) => e.hp > 0);
    const router = list[2]!;
    router.attackCooldown = 0;
    const d0 = dist(router.body.pos, state.player.body.pos);
    for (let i = 0; i < 30; i++) updateEnemies(state, FIXED_DT);
    expect(router.phase, "予備動作に入らない").toBe("chase");
    expect(dist(router.body.pos, state.player.body.pos), "離れる").toBeGreaterThan(d0);
  });

  it("敗走中に倒すと討伐として数え、ドロップ率が dropMul 倍になる", () => {
    const state = jinArena();
    const { from, router } = routedPair(state, 60);
    const routed = enemyDropChance(state, router);
    const saved = router.rout;
    router.rout = undefined;
    const plain = enemyDropChance(state, router);
    router.rout = saved;
    expect(routed).toBeCloseTo(plain * JIN.rout.dropMul);
    kill(state, router);
    expect(from.routTally?.killed).toBe(1);
  });
});

describe("集まっている間の強化", () => {
  it("群勢が highRatio 以上の交戦中の陣だけ、攻撃間隔と受ける怯み値が縮む", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos);
    const e = member(state, jin, 30);
    member(state, jin, 50);
    initJinMorale(state, jin);
    expect(jinBonusMul(state, e, "attackInterval")).toBe(JIN.morale.highAttackIntervalMul);
    expect(jinBonusMul(state, e, "poiseTaken")).toBe(JIN.morale.highPoiseTakenMul);
    jin.morale = jin.moraleMax * JIN.morale.highRatio - 0.01;
    expect(jinBonusMul(state, e, "attackInterval"), "崩れかけは 1").toBe(1);
    jin.morale = jin.moraleMax;
    jin.phase = "sleeping";
    expect(jinBonusMul(state, e, "attackInterval"), "眠っている陣は 1").toBe(1);
  });

  it("受ける怯み値に倍率が掛かる（poise.ts の addPoise）", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos);
    const inJin = member(state, jin, 30);
    initJinMorale(state, jin);
    const loner = placeEnemy(state, "slime", -30);
    loner.phase = "chase";
    const amount = Math.min(inJin.poise.max, loner.poise.max) * 0.1;
    addPoise(state, inJin, amount);
    addPoise(state, loner, amount);
    expect(inJin.poise.damage / loner.poise.damage).toBeCloseTo(JIN.morale.highPoiseTakenMul);
  });
});

describe("起床と後詰", () => {
  it("気付いた者の近くだけ起き、残りは secondWaveDelay 後に後詰として起きる", () => {
    const state = jinArena();
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos, "sleeping");
    const near = member(state, jin, 20);
    const mid = member(state, jin, 20 + JIN.wake.radius - 10);
    const far = member(state, jin, 20 + JIN.wake.radius + 60);
    initJinMorale(state, jin);
    wakeJin(state, jin);
    expect(jin.phase).toBe("engaged");
    expect([near.phase, mid.phase], "近くは起きる").toEqual(["chase", "chase"]);
    expect(far.phase, "遠くは眠ったまま").toBe("idle");
    expect(jin.secondWaveAt).toBeCloseTo(state.floorTime + JIN.wake.secondWaveDelay);
    updateJins(state);
    expect(far.phase, "時刻の前は起きない").toBe("idle");
    state.floorTime += JIN.wake.secondWaveDelay;
    updateJins(state);
    expect(far.phase, "後詰").toBe("chase");
    expect(jin.secondWaveAt).toBeNull();
  });

  it("封鎖した部屋の陣は全員起きる", () => {
    const state = jinArena();
    state.rooms[ROOM_A]!.locked = true;
    const jin = addJin(state, 1, ROOM_A, state.player.body.pos, "sleeping");
    member(state, jin, 20);
    const far = member(state, jin, 20 + JIN.wake.radius + 60);
    initJinMorale(state, jin);
    wakeJin(state, jin);
    expect(far.phase).toBe("chase");
    expect(jin.secondWaveAt).toBeNull();
  });
});

describe("増援の代わり（眠っている陣が歩き出す）", () => {
  it("stir.delay を過ぎると interval ごとに 1 つずつ増える", () => {
    expect(stirsDue(JIN.stir.delay)).toBe(0);
    expect(stirsDue(JIN.stir.delay + 0.1)).toBe(1);
    expect(stirsDue(JIN.stir.delay + JIN.stir.interval + 0.1)).toBe(2);
  });

  it("プレイヤーに最も近い眠っている陣から長蛇に変わり、プレイヤーの位置へ向かう", () => {
    const state = jinArena();
    const p = state.player.body.pos;
    const nearJin = addJin(state, 1, ROOM_A, { x: p.x + 100, y: p.y }, "sleeping");
    const farJin = addJin(state, 2, ROOM_B, { x: p.x + 900, y: p.y }, "sleeping");
    const a = member(state, nearJin, 100);
    const b = member(state, farJin, 900);
    initJinMorale(state, nearJin);
    initJinMorale(state, farJin);
    state.floorTime = JIN.stir.delay;
    expect(stirSleepingJin(state), "delay の前は歩かせない").toBe(false);
    state.floorTime = JIN.stir.delay + 0.1;
    expect(stirSleepingJin(state)).toBe(true);
    expect(nearJin.stirred).toBe(true);
    expect(nearJin.formation).toBe("column");
    expect(a.ai?.roam, "プレイヤーの位置へ").toEqual(p);
    expect(a.roomIndex, "塊のまま（倒し切れば制圧の報酬）").toBe(ROOM_A);
    expect(stirSleepingJin(state), "1 回ぶんは済んだ").toBe(false);
    expect(farJin.stirred).toBeUndefined();
    state.floorTime = JIN.stir.delay + JIN.stir.interval + 0.1;
    expect(stirSleepingJin(state)).toBe(true);
    expect(b.ai?.roam).toEqual(p);
  });

  it("交戦中・制圧済みの塊の陣は歩かせない", () => {
    const state = jinArena();
    const p = state.player.body.pos;
    const jin = addJin(state, 1, ROOM_A, { x: p.x + 100, y: p.y }, "sleeping");
    member(state, jin, 100);
    initJinMorale(state, jin);
    state.rooms[ROOM_A]!.engaged = true;
    state.floorTime = JIN.stir.delay + 0.1;
    expect(stirSleepingJin(state)).toBe(false);
  });
});

describe("実際の階での敗走（step を通す）", () => {
  it("部屋の陣が敗走すると同じステップで部屋が制圧済みになる", () => {
    const state = createGame(4);
    const jin = state.jins.find((j) => j.roomIndex !== ROAMING_ROOM && state.enemies.filter((e) => e.jinId === j.id).length >= 4);
    if (!jin) throw new Error("4 人以上の部屋の陣が無い");
    const room = state.rooms[jin.roomIndex]!;
    state.player.body.pos = rectCenterPx(room.rect);
    state.player.invulnTimer = 9999;
    step(state, withInput({}), FIXED_DT);
    expect(jin.phase).toBe("engaged");
    for (let i = 0; i < 40 && jin.phase !== "settled"; i++) {
      const target = state.enemies.filter((e) => e.jinId === jin.id && e.hp > 0).sort((x, y) => x.id - y.id)[0];
      if (!target) break;
      target.hp = 0;
      step(state, withInput({}), FIXED_DT);
    }
    expect(jin.settledBy, "全滅の前に崩れる").toBe("rout");
    expect(room.cleared, "部屋は制圧済み").toBe(true);
    expect(state.enemies.some((e) => e.rout?.fromJin === jin.id), "逃げている敵がいる").toBe(true);
  });

  it("同じ seed と入力なら敗走の結果が同じ（決定性）", () => {
    const run = (): string => {
      const state = createGame(4);
      const jin = state.jins.find((j) => j.roomIndex !== ROAMING_ROOM && state.enemies.filter((e) => e.jinId === j.id).length >= 4)!;
      state.player.body.pos = rectCenterPx(state.rooms[jin.roomIndex]!.rect);
      state.player.invulnTimer = 9999;
      for (let i = 0; i < 120; i++) {
        if (i % 10 === 0) {
          const target = state.enemies.find((e) => e.jinId === jin.id && e.hp > 0);
          if (target) target.hp = 0;
        }
        step(state, withInput({}), FIXED_DT);
      }
      return JSON.stringify(state.enemies.map((e) => [e.id, Math.round(e.body.pos.x), Math.round(e.body.pos.y), e.rout?.toJin ?? -1]));
    };
    expect(run()).toBe(run());
  });
});

describe("QA の決着の内訳（qa/jinMetrics.ts）", () => {
  it("全滅・敗走・大将撃破・敗走した敵の行く末を数える", () => {
    const t = emptyJinSettle();
    const state = jinArena();
    const a = addJin(state, 1, ROOM_A, state.player.body.pos);
    a.phase = "settled";
    a.settledBy = "wipe";
    const b = addJin(state, 2, ROOM_B, state.player.body.pos);
    b.phase = "settled";
    b.settledBy = "rout";
    b.leaderFell = true;
    b.routTally = { fled: 4, merged: 1, killed: 2, escaped: 1 };
    addJin(state, 3, ROAMING_ROOM, state.player.body.pos, "sleeping");
    recordJinSettle(t, state.jins);
    expect(t).toEqual({ wipe: 1, rout: 1, leaderFell: 1, unsettled: 1, fled: 4, merged: 1, killed: 2, escaped: 1 });
  });
});
