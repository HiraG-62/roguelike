import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { playerSource, pushEvent } from "../core/events";
import type { Rng } from "../core/rng";
import { type Modifier, type Rule, SCOPE_ANY } from "../core/rules";
import { type GameState, type Jin, type Pickup, type RoomState } from "../core/state";
import { ECONOMY } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { damageEnemy, damagePlayer, damagePlayerDot } from "./combat";
import {
  chapterScale,
  createEconomyState,
  dropCoins,
  gainCoins,
  killCoinMean,
  onRoomClearedCoins,
  spendCoins,
  totalEarned,
  totalSpent,
  updateCoinPickups,
} from "./economy";
import { descend } from "./floor";
import { updateJins } from "./jin";
import { applyModifiers } from "./modifiers";
import { resolveRules } from "./rules";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 銭の芯（system/economy.ts。docs/ideas/economy-impl.md 2-2・2-10） */

const FAR = 60;
const RIGHT = { x: 1, y: 0 };
const KILL_DAMAGE = 1e6;
const IDLE = withInput({});

/** いつも同じ値を返す乱数（抽選の結果を固定する） */
function fixedRng(v: number): Rng {
  return {
    next: () => v,
    int: (min) => min,
    chance: (p) => v < p,
    pick: <T>(arr: readonly T[]) => arr[0] as T,
  };
}

function coinsOnFloor(state: GameState): Pickup[] {
  return state.pickups.filter((pk) => pk.kind === "coin");
}

/** 床の銭・鍵だけを seconds 秒進める */
function tick(state: GameState, seconds: number): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) updateCoinPickups(state, FIXED_DT);
}

function coinAt(state: GameState, dx: number, value: number, extra: Partial<Pickup> = {}): Pickup {
  const p = state.player.body.pos;
  const pk: Pickup = { id: state.nextId++, kind: "coin", pos: { x: p.x + dx, y: p.y }, radius: ECONOMY.coin.radius, bobTime: 0, value, life: ECONOMY.coin.life, ...extra };
  state.pickups.push(pk);
  return pk;
}

function addJin(state: GameState, leaderId: number | null): Jin {
  const jin: Jin = {
    id: 900 + state.jins.length,
    roomIndex: 1,
    formation: "fishScale",
    center: { ...state.player.body.pos },
    facing: { x: 1, y: 0 },
    leaderId,
    hpMul: 1,
    morale: 0,
    moraleMax: 0,
    phase: "engaged",
    engagedAt: state.time,
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
  };
  state.jins.push(jin);
  return jin;
}

function jinArena(): GameState {
  const state = arena();
  state.jins = [];
  state.pickups = [];
  return state;
}

describe("銭の器", () => {
  it("初期の銭・鍵は 0 で、源と用途の集計がすべて 0 から始まる", () => {
    const eco = createEconomyState();
    expect(eco.coins).toBe(0);
    expect(eco.keys).toBe(0);
    expect(totalEarned(eco)).toBe(0);
    expect(totalSpent(eco)).toBe(0);
    // 市の商人は buildFloor が立たせる（system/merchants.ts）ので、器の初期値としては空と比べる
    expect({ ...createGame(1).economy, merchants: [] }, "createGame が作る").toEqual(eco);
  });

  it("gainCoins は稼ぎに積み、spill の拾い直しは積まない。coinGainMul は賭け・拾い直しに掛けない", () => {
    const state = arena();
    gainCoins(state, 10, "kill");
    gainCoins(state, 4, "spill");
    expect(state.economy.coins).toBe(14);
    expect(state.economy.earned.kill).toBe(10);
    expect(totalEarned(state.economy), "拾い直しは稼ぎでない").toBe(10);
    state.stats.coinGainMul = 2;
    gainCoins(state, 5, "jin");
    gainCoins(state, 5, "bet");
    expect(state.economy.earned.jin, "稼ぎは倍").toBe(10);
    expect(state.economy.earned.bet, "賭けは倍にしない").toBe(5);
  });

  it("spendCoins は足りなければ何もせず false、足りれば用途別に積んで onCoinSpend を出す", () => {
    const state = arena();
    state.economy.coins = 5;
    expect(spendCoins(state, 6, "contract")).toBe(false);
    expect(state.economy.coins).toBe(5);
    state.events.length = 0;
    expect(spendCoins(state, 5, "contract")).toBe(true);
    expect(state.economy.coins).toBe(0);
    expect(state.economy.spent.contract).toBe(5);
    expect(state.events.some((e) => e.kind === "onCoinSpend" && e.amount === 5)).toBe(true);
  });
});

describe("撃破の銭", () => {
  it("撃破の銭の平均は格で決まる（並 / 猛 / 精鋭 / 大将 / ボス）。群れは減り、敗走中は増え、章で伸びる", () => {
    const state = jinArena();
    const k = ECONOMY.income.kill;
    const slime = placeEnemy(state, "slime", FAR);
    expect(killCoinMean(state, slime), "並").toBeCloseTo(k.normal);
    slime.grade = "strong";
    expect(killCoinMean(state, slime), "猛").toBeCloseTo(k.strong);
    slime.elite = "reflective";
    expect(killCoinMean(state, slime), "精鋭").toBeCloseTo(k.elite);
    const leader = placeEnemy(state, "slime", FAR);
    const jin = addJin(state, leader.id);
    leader.jinId = jin.id;
    expect(killCoinMean(state, leader), "大将").toBeCloseTo(k.leader);
    expect(killCoinMean(state, placeEnemy(state, "kingSlime", FAR)), "ボス").toBeCloseTo(k.boss);
    expect(killCoinMean(state, placeEnemy(state, "bat", FAR)), "群れ").toBeCloseTo(k.normal * ECONOMY.income.swarmMul);
    const fleeing = placeEnemy(state, "slime", FAR);
    fleeing.rout = { fromJin: jin.id, toJin: null, dest: null, time: 1, recheck: 1, turnCd: 1, dropCd: 1 };
    expect(killCoinMean(state, fleeing), "敗走中").toBeCloseTo(k.normal * ECONOMY.income.routMul);
    state.depth = 6;
    expect(killCoinMean(state, placeEnemy(state, "slime", FAR)), "章 2").toBeCloseTo(k.normal * ECONOMY.chapterMul);
    expect(chapterScale(1)).toBe(1);
  });

  it("撃破で格に応じた銭が落ち、8 秒で消える（消えた額は expired に積む）", () => {
    const state = jinArena();
    const e = placeEnemy(state, "slime", FAR);
    e.elite = "reflective";
    damageEnemy(state, e, KILL_DAMAGE, RIGHT, 0);
    const coins = coinsOnFloor(state);
    expect(coins.length, "実体 1 つ").toBe(1);
    const value = coins[0]?.value ?? 0;
    const mean = ECONOMY.income.kill.elite;
    expect(value).toBeGreaterThanOrEqual(Math.floor(mean * ECONOMY.income.spread.low));
    expect(value).toBeLessThanOrEqual(Math.ceil(mean * ECONOMY.income.spread.high));
    expect(state.economy.dropped).toBe(value);
    tick(state, ECONOMY.coin.life - ECONOMY.coin.blinkSec + FIXED_DT);
    const blinking = coinsOnFloor(state)[0];
    expect(blinking, "まだ残る").toBeDefined();
    expect(blinking?.life ?? 99, "消える前 2 秒は life が blinkSec 以下").toBeLessThanOrEqual(ECONOMY.coin.blinkSec);
    tick(state, ECONOMY.coin.blinkSec);
    expect(coinsOnFloor(state).length, "消えた").toBe(0);
    expect(state.economy.expired).toBe(value);
    expect(state.economy.coins, "拾っていない").toBe(0);
  });

  it("鐘の蘇生体は銭を落とさない", () => {
    const state = jinArena();
    const e = placeEnemy(state, "slime", FAR);
    e.elite = "reflective";
    e.revived = true;
    dropCoins(state, e);
    expect(coinsOnFloor(state).length).toBe(0);
  });

  it("ボスは額を割って散らし、合計は 1 回の抽選の額", () => {
    const state = jinArena();
    const boss = placeEnemy(state, "kingSlime", FAR);
    dropCoins(state, boss);
    const coins = coinsOnFloor(state);
    expect(coins.length).toBe(ECONOMY.coin.splitPieces);
    expect(coins.reduce((s, c) => s + (c.value ?? 0), 0)).toBe(state.economy.dropped);
  });

  it("1.5m 以内の銭は引き寄せられて拾え、遠い銭は寄らない", () => {
    const state = jinArena();
    const r = state.player.body.radius;
    const near = coinAt(state, r + ECONOMY.coin.magnetRadius - 1, 3);
    const far = coinAt(state, r + ECONOMY.coin.magnetRadius + 30, 4);
    const farX = far.pos.x;
    tick(state, 0.5);
    expect(state.pickups.includes(near), "近い銭は拾った").toBe(false);
    expect(state.economy.coins).toBe(3);
    expect(state.economy.earned.kill).toBe(3);
    expect(far.pos.x, "遠い銭は動かない").toBe(farX);
  });

  it("coinMagnetMul で引き寄せの半径が伸びる", () => {
    const state = jinArena();
    state.stats.coinMagnetMul = 3;
    coinAt(state, state.player.body.radius + ECONOMY.coin.magnetRadius * 2, 2);
    tick(state, 1);
    expect(state.economy.coins).toBe(2);
  });

  it("実体が上限を超えると、最も新しい銭に額が足される", () => {
    const state = jinArena();
    for (let i = 0; i < ECONOMY.coin.maxCoins; i++) coinAt(state, 200, 1);
    const newest = coinsOnFloor(state).at(-1);
    const e = placeEnemy(state, "slime", FAR);
    e.elite = "reflective";
    dropCoins(state, e);
    expect(coinsOnFloor(state).length, "実体は増えない").toBe(ECONOMY.coin.maxCoins);
    expect(newest?.value).toBe(1 + state.economy.dropped);
  });

  it("同じ seed なら撃破の銭の額が同じ（決定性）", () => {
    const run = (): number[] => {
      const state = jinArena();
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const e = placeEnemy(state, "slime", FAR);
        e.grade = "strong";
        dropCoins(state, e);
      }
      for (const c of coinsOnFloor(state)) out.push(c.value ?? 0);
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe("被弾でこぼれる", () => {
  function hurt(state: GameState): void {
    const p = state.player.body.pos;
    expect(damagePlayer(state, 1, { x: p.x - 10, y: p.y })).toBe("hit");
  }

  it("被弾で持ち金の 5%（最低 1）がこぼれ、settle の間は拾えず、拾い直せば戻り、稼ぎには数えない", () => {
    const state = jinArena();
    state.economy.coins = 100;
    state.events.length = 0;
    hurt(state);
    const lost = Math.round(100 * ECONOMY.spill.ratio);
    expect(state.economy.coins).toBe(100 - lost);
    expect(state.economy.spilled).toBe(lost);
    expect(state.events.some((e) => e.kind === "onCoinSpill" && e.amount === lost)).toBe(true);
    const spilled = coinsOnFloor(state);
    expect(spilled.length).toBe(Math.min(ECONOMY.spill.pieces, lost));
    expect(spilled.every((c) => c.spilled === true)).toBe(true);
    tick(state, ECONOMY.spill.settle / 2);
    expect(state.economy.coins, "settle の間は戻らない").toBe(100 - lost);
    tick(state, ECONOMY.spill.settle);
    for (const c of spilled) {
      state.player.body.pos = { ...c.pos };
      tick(state, FIXED_DT);
    }
    expect(state.economy.coins, "拾い直して戻る").toBe(100);
    expect(state.economy.recovered).toBe(lost);
    expect(totalEarned(state.economy), "稼ぎには数えない").toBe(0);
  });

  it("こぼれた銭は spill.life 秒で消え、消えた額は expired に数えない", () => {
    const state = jinArena();
    state.economy.coins = 100;
    hurt(state);
    tick(state, ECONOMY.spill.life + FIXED_DT);
    expect(coinsOnFloor(state).length).toBe(0);
    expect(state.economy.expired).toBe(0);
  });

  it("持ち金が少なくても最低 1 がこぼれ、0 ならこぼれない", () => {
    const state = jinArena();
    state.economy.coins = 3;
    hurt(state);
    expect(state.economy.coins).toBe(3 - ECONOMY.spill.min);
    const empty = jinArena();
    hurt(empty);
    expect(empty.economy.spilled).toBe(0);
    expect(coinsOnFloor(empty).length).toBe(0);
  });

  it("coinSpillMul 0 ならこぼれない", () => {
    const state = jinArena();
    state.stats.coinSpillMul = 0;
    state.economy.coins = 100;
    hurt(state);
    expect(state.economy.coins).toBe(100);
  });

  it("継続ダメージ・受け流しではこぼれない", () => {
    const state = jinArena();
    state.economy.coins = 100;
    damagePlayerDot(state, 1);
    expect(state.economy.coins, "継続ダメージ").toBe(100);
    const p = state.player;
    p.facing = { x: 1, y: 0 };
    p.parry.window = 1;
    expect(damagePlayer(state, 1, { x: p.body.pos.x + 10, y: p.body.pos.y })).toBe("parried");
    expect(state.economy.coins, "受け流し").toBe(100);
  });
});

describe("陣・部屋・階の銭", () => {
  it("交戦した陣の決着で銭、無傷の決着は 2 倍", () => {
    const hurtState = jinArena();
    hurtState.rng = fixedRng(0.5);
    const hurtJin = addJin(hurtState, null);
    hurtState.recent.onHurt = { lastTime: hurtJin.engagedAt ?? 0, count: 1 };
    updateJins(hurtState);
    const clean = jinArena();
    clean.rng = fixedRng(0.5);
    addJin(clean, null);
    updateJins(clean);
    const base = hurtState.economy.earned.jin;
    expect(base, "陣の決着で銭").toBeGreaterThan(0);
    expect(Math.abs(clean.economy.earned.jin - base * ECONOMY.income.jinUnscathedMul), "無傷は 2 倍").toBeLessThanOrEqual(1);
  });

  it("眠ったまま居なくなった陣は銭を出さない", () => {
    const state = jinArena();
    const jin = addJin(state, null);
    jin.phase = "sleeping";
    updateJins(state);
    expect(state.economy.earned.jin).toBe(0);
  });

  it("大将のいる陣は鍵が 50%、いない陣は 12%（拾うと鍵 +1）", () => {
    const roll = (leader: boolean, v: number): number => {
      const state = jinArena();
      state.rng = fixedRng(v);
      addJin(state, leader ? 1 : null);
      updateJins(state);
      tick(state, FIXED_DT);
      return state.economy.keys;
    };
    const just = (p: number): number => p - 0.01;
    expect(roll(true, just(ECONOMY.key.leaderJinChance)), "大将のいる陣").toBe(1);
    expect(roll(true, ECONOMY.key.leaderJinChance + 0.01), "大将のいる陣の外れ").toBe(0);
    expect(roll(false, just(ECONOMY.key.leaderJinChance)), "大将のいない陣は低い").toBe(0);
    expect(roll(false, just(ECONOMY.key.jinChance)), "大将のいない陣の当たり").toBe(1);
  });

  it("部屋の制圧: 陣を持たない部屋は陣の決着と同じ額、陣を持つ部屋は種類の上乗せだけ", () => {
    const state = jinArena();
    state.rng = fixedRng(0.5);
    const room = state.rooms[1] as RoomState;
    room.kind = "ambush";
    onRoomClearedCoins(state, room, 1);
    expect(state.economy.earned.room, "陣を持たない部屋").toBeGreaterThan(0);
    addJin(state, null);
    const before = state.economy.earned.room;
    onRoomClearedCoins(state, room, 1);
    expect(state.economy.earned.room, "陣を持つ普通の部屋は出ない").toBe(before);
    room.kind = "horde";
    onRoomClearedCoins(state, room, 1);
    expect(state.economy.earned.room, "上乗せの部屋").toBeGreaterThan(before);
  });

  it("陣を持たない部屋の制圧は clearRoom で銭（封鎖して全滅させる）", () => {
    const state = createGame(7);
    state.runEvents.room = null;
    state.runEvents.floor = null;
    state.runEvents.cooldown = 1e9;
    state.runEvents.timedCheck = 1e9;
    const index = state.rooms.findIndex((r, i) => i > 0 && i < state.rooms.length - 1 && r.kind === "normal" && r.doorTiles.length > 0 && state.enemies.some((e) => e.roomIndex === i));
    const room = state.rooms[index];
    expect(room, "敵のいる部屋").toBeDefined();
    if (!room) return;
    room.kind = "ambush";
    state.jins = state.jins.filter((j) => j.roomIndex !== index);
    for (const e of state.enemies) if (e.roomIndex === index) e.jinId = undefined;
    state.player.invulnTimer = 1e9;
    state.player.body.pos = rectCenterPx(room.rect);
    for (let i = 0; i < 3 && !room.locked; i++) step(state, IDLE, FIXED_DT);
    for (let i = 0; i < 120 && !room.cleared; i++) {
      for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
      step(state, IDLE, FIXED_DT);
    }
    expect(room.cleared, "制圧した").toBe(true);
    expect(state.economy.earned.room).toBeGreaterThan(0);
  });

  it("初めて着いた階で floor の銭", () => {
    const state = arena();
    const before = state.economy.earned.floor;
    descend(state);
    expect(state.economy.earned.floor - before).toBe(ECONOMY.income.floor);
  });
});

describe("通貨のビルドの口", () => {
  const owner = { kind: "boon" as const, key: "test" };
  const melee = { tags: new Set(["melee" as const]) };

  it("PerCounter coins は持ち金 20 につき 1 段、上限 25%", () => {
    const state = arena();
    const mod: Modifier = { id: "t", kind: "increased", tag: "all", amount: 0.01, per: { count: { kind: "coins" }, every: 20, cap: 0.25 }, if: [], owner };
    state.economy.coins = 100;
    expect(applyModifiers(state, melee, null, [mod]).increased).toBeCloseTo(0.05);
    state.economy.coins = 10_000;
    expect(applyModifiers(state, melee, null, [mod]).increased).toBeCloseTo(0.25);
  });

  it("PerCounter coinsEarned / coinsSpent は稼いだ・使った総額を数える", () => {
    const state = arena();
    gainCoins(state, 40, "kill");
    spendCoins(state, 30, "contract");
    const per = (kind: "coinsEarned" | "coinsSpent"): Modifier => ({ id: kind, kind: "increased", tag: "all", amount: 0.01, per: { count: { kind }, every: 10 }, if: [], owner });
    expect(applyModifiers(state, melee, null, [per("coinsEarned")]).increased).toBeCloseTo(0.04);
    expect(applyModifiers(state, melee, null, [per("coinsSpent")]).increased).toBeCloseTo(0.03);
  });

  it("coinsAtLeast 50 の Modifier は 49 で効かず 50 で効く", () => {
    const state = arena();
    const mod: Modifier = { id: "t", kind: "increased", tag: "all", amount: 0.12, if: [{ kind: "coinsAtLeast", amount: 50 }], owner };
    state.economy.coins = 49;
    expect(applyModifiers(state, melee, null, [mod]).increased).toBe(0);
    state.economy.coins = 50;
    expect(applyModifiers(state, melee, null, [mod]).increased).toBeCloseTo(0.12);
  });

  function ruleOf(kind: "gainCoins" | "spendCoins" | "scatterCoins", magnitude: number): Rule {
    return { id: `t:${kind}`, when: "onKill", if: [], then: { kind, magnitude }, chance: 1, icd: 0, scope: SCOPE_ANY, owner, direct: true };
  }

  function fire(state: GameState, rule: Rule): void {
    pushEvent(state, { kind: "onKill", actor: "player", pos: { ...state.player.body.pos }, source: playerSource("kill") });
    resolveRules(state, FIXED_DT, [rule]);
  }

  it("gainCoins / spendCoins の Rule 効果が economy を動かす（足りなければ払わない）", () => {
    const state = arena();
    fire(state, ruleOf("gainCoins", 5));
    expect(state.economy.coins).toBe(5);
    expect(state.economy.earned.rule).toBe(5);
    fire(state, ruleOf("spendCoins", 8));
    expect(state.economy.coins, "足りない").toBe(5);
    fire(state, ruleOf("spendCoins", 3));
    expect(state.economy.coins).toBe(2);
    expect(state.economy.spent.rule).toBe(3);
  });

  it("scatterCoins は持ち金の割合を床へ撒き、拾い直しは稼ぎに数えない", () => {
    const state = arena();
    state.pickups = [];
    state.economy.coins = 40;
    fire(state, ruleOf("scatterCoins", 0.5));
    expect(state.economy.coins).toBe(20);
    expect(coinsOnFloor(state).reduce((s, c) => s + (c.value ?? 0), 0)).toBe(20);
    expect(coinsOnFloor(state).every((c) => c.spilled === true)).toBe(true);
  });
});
