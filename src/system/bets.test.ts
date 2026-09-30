import { describe, expect, it } from "vitest";
import { pushEvent } from "../core/events";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Rng } from "../core/rng";
import type { GameState, Jin } from "../core/state";
import { CONTRACT, ECONOMY, SYNERGY } from "../data/tuning";
import { DEFAULT_STATS } from "../loot/types";
import {
  type BetOffer,
  LUCK_BETS,
  SKILL_BETS,
  betHudLine,
  doubleUpGo,
  doubleUpStop,
  onBetJinSettled,
  onBetsFloorReached,
  onJinEngaged,
  parriesTarget,
  payoutOf,
  placeBet,
  planBookieBets,
  stakeFor,
  updateBets,
} from "./bets";
import { type ContractOffer, pactHudLines, standContractor, updateContractors } from "./contractors";
import { buildFloor } from "./floor";
import { updateJins, wakeJin } from "./jin";

const B = ECONOMY.bet;
const DT = FIXED_DT;
const SEEDS = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
/** 必ず勝つ / 必ず負ける乱数（chance(p) は next() < p） */
const ALWAYS_WIN = 0;
const ALWAYS_LOSE = 0.999999;

function fixedRng(value: number): Rng {
  return {
    next: () => value,
    int: (min) => min,
    chance: (p) => value < p,
    pick: (arr) => {
      const v = arr[0];
      if (v === undefined) throw new Error("空の配列");
      return v;
    },
  };
}

function gameAt(depth = 4, seed = 3): GameState {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state, "rooms");
  state.player.invulnTimer = 1e9;
  return state;
}

function offer(kind: BetOffer["kind"], stake: number, extra: Partial<BetOffer> = {}): BetOffer {
  const def = B[kind];
  const mul = "mul" in def ? def.mul : 1.5;
  return { kind, tier: null, target: 0, mul, jackpot: false, stake, ...extra };
}

/** 陣の形だけ（判定は id・大将・起きた時刻しか読まない） */
function fakeJin(id: number, engagedAt: number, leaderId: number | null = null): Jin {
  return {
    id,
    roomIndex: 1,
    formation: "blob" as Jin["formation"],
    center: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    leaderId,
    morale: 1,
    moraleMax: 1,
    phase: "engaged",
    engagedAt,
    hpMul: 1,
    secondWaveAt: null,
    deathsTick: 0,
    deathsInTick: 0,
  };
}

/** 回廊の階に賭場の主を立たせる（立てられる seed を探す） */
function withBookie(coins = 100): GameState {
  for (const seed of SEEDS) {
    const state = gameAt(4, seed);
    state.runEvents.room = null;
    state.runEvents.floor = null;
    state.runEvents.cooldown = 1e9;
    state.runEvents.timedCheck = 1e9;
    state.economy.coins = coins;
    if (standContractor(state, "bookie")) return state;
  }
  throw new Error("賭場の主を立てられる seed が無い");
}

function touch(state: GameState, target: ContractOffer): void {
  const who = state.contracts.contractor;
  if (!who) throw new Error("契約者がいない");
  state.player.body.pos = { x: who.pos.x, y: who.pos.y - CONTRACT.standOffset * 16 };
  updateContractors(state, DT);
  state.player.body.pos = { ...target.pos };
  updateContractors(state, DT);
}

function betOffers(state: GameState): ContractOffer[] {
  return state.contracts.contractor?.offers.filter((o) => o.kind === "bet") ?? [];
}

describe("賭け: 数値", () => {
  it("運の型の期待値（倍率 × 確率）は 0.9〜1.0", () => {
    for (const kind of LUCK_BETS) {
      const ev = B[kind].mul * B[kind].chance;
      expect(ev, `${kind} の期待値`).toBeGreaterThanOrEqual(0.9);
      expect(ev, `${kind} の期待値`).toBeLessThanOrEqual(1.0 + 1e-9);
    }
  });

  it("丁半は持ち金の 20%（最低 10）、一か八かは全額", () => {
    expect(stakeFor("chohan", 100), "100 の 20%").toBe(20);
    expect(stakeFor("chohan", 20), "最低額").toBe(B.chohan.stakeMin);
    expect(stakeFor("allIn", 57), "全額").toBe(57);
    expect(stakeFor("longshot", 100), "大穴は 10%").toBe(10);
  });
});

describe("賭け: 運の型", () => {
  it("丁半は勝てば賭け金の 2 倍が戻り、負ければ何も戻らない", () => {
    const win = gameAt();
    win.rng = fixedRng(ALWAYS_WIN);
    expect(placeBet(win, offer("chohan", 20)), "勝ち").toBe("won");
    expect(win.economy.earned.bet, "払い戻し").toBe(40);
    expect(win.economy.betStats.chohan, "記録").toMatchObject({ placed: 1, won: 1, staked: 20, paid: 40 });

    const lose = gameAt();
    lose.rng = fixedRng(ALWAYS_LOSE);
    expect(placeBet(lose, offer("chohan", 20)), "負け").toBe("lost");
    expect(lose.economy.earned.bet, "払い戻しなし").toBe(0);
    expect(lose.economy.bet, "賭けは残らない").toBeNull();
  });

  it("大穴は勝てば 10 倍", () => {
    const state = gameAt();
    state.rng = fixedRng(ALWAYS_WIN);
    placeBet(state, offer("longshot", 5));
    expect(state.economy.earned.bet).toBe(5 * B.longshot.mul);
  });

  it("倍々勝負は続けるたび倍、負けると 0、降りれば今の倍率で戻る", () => {
    const state = gameAt();
    state.rng = fixedRng(ALWAYS_WIN);
    expect(placeBet(state, offer("doubleUp", 20)), "1 回目に勝つと賭けが残る").toBe("open");
    expect(state.economy.bet?.mul, "×2").toBe(2);
    expect(doubleUpGo(state), "続けて勝つ").toBe(true);
    expect(state.economy.bet?.mul, "×4").toBe(4);
    doubleUpStop(state);
    expect(state.economy.bet, "降りた").toBeNull();
    expect(state.economy.earned.bet, "20 × 4").toBe(80);

    const lose = gameAt();
    lose.rng = fixedRng(ALWAYS_WIN);
    placeBet(lose, offer("doubleUp", 20));
    lose.rng = fixedRng(ALWAYS_LOSE);
    expect(doubleUpGo(lose), "続けて負ける").toBe(false);
    expect(lose.economy.bet, "賭けが消える").toBeNull();
    expect(lose.economy.earned.bet, "何も戻らない").toBe(0);
  });
});

describe("賭け: 腕の型", () => {
  it("無傷は張った後に最初に起きた陣に束縛され、被弾なしで決着すれば倍率ぶん戻る", () => {
    const state = gameAt();
    state.time = 10;
    placeBet(state, offer("unscathed", 30, { mul: B.unscathed.tiers.easy.mul }));
    // 張る前から戦っている陣は束縛しない
    onJinEngaged(state, fakeJin(1, 5));
    expect(state.economy.bet?.jinId, "張る前の陣").toBeNull();
    state.time = 12;
    onJinEngaged(state, fakeJin(2, 12, 99));
    expect(state.economy.bet?.jinId, "次に起きた陣").toBe(2);
    expect(state.economy.bet?.tier, "大将のいる陣は難").toBe("hard");
    // 別の陣の決着では決まらない
    onBetJinSettled(state, fakeJin(3, 12));
    expect(state.economy.bet, "別の陣").not.toBeNull();
    state.time = 20;
    onBetJinSettled(state, fakeJin(2, 12, 99));
    expect(state.economy.bet, "決着").toBeNull();
    expect(state.economy.earned.bet, "30 × 2").toBe(payoutOf(30, B.unscathed.tiers.hard.mul));
    expect(state.economy.betStats.unscathed?.tiers.hard, "難の記録").toEqual({ settled: 1, won: 1 });
  });

  it("無傷は張った後に被弾するとその場で負け", () => {
    const state = gameAt();
    state.time = 10;
    placeBet(state, offer("unscathed", 30));
    state.time = 11;
    state.recent.onHurt = { lastTime: 11, count: 1 };
    updateBets(state);
    expect(state.economy.bet, "負けて消える").toBeNull();
    expect(state.economy.earned.bet, "何も戻らない").toBe(0);
  });

  it("速攻は束縛した陣の起床から N 秒以内に決着すれば勝ち、過ぎればその場で負け", () => {
    const easy = B.swift.tiers.easy;
    const win = gameAt();
    win.time = 10;
    placeBet(win, offer("swift", 30, { tier: "easy", target: easy.target, mul: easy.mul }));
    const jin = fakeJin(7, 11);
    win.jins.push(jin);
    win.time = 11;
    onJinEngaged(win, jin);
    win.time = 11 + easy.target - 1;
    updateBets(win);
    onBetJinSettled(win, jin);
    expect(win.economy.earned.bet, "勝ち").toBe(payoutOf(30, easy.mul));

    const lose = gameAt();
    lose.time = 10;
    placeBet(lose, offer("swift", 30, { tier: "easy", target: easy.target, mul: easy.mul }));
    const jin2 = fakeJin(8, 11);
    lose.jins.push(jin2);
    lose.time = 11;
    onJinEngaged(lose, jin2);
    lose.time = 11 + easy.target + 1;
    updateBets(lose);
    expect(lose.economy.bet, "時間切れ").toBeNull();
    expect(lose.economy.earned.bet, "何も戻らない").toBe(0);
  });

  it("本物の陣でも起床で束縛し、全滅の決着で判定する", () => {
    const state = gameAt();
    const jin = state.jins.find((j) => j.phase === "sleeping");
    if (!jin) throw new Error("眠っている陣が無い");
    state.time = 10;
    placeBet(state, offer("unscathed", 30));
    wakeJin(state, jin);
    expect(state.economy.bet?.jinId, "束縛").toBe(jin.id);
    state.enemies = state.enemies.filter((e) => e.jinId !== jin.id);
    updateJins(state);
    expect(state.economy.bet, "決着").toBeNull();
    expect(state.economy.betStats.unscathed?.won, "勝ち").toBe(1);
  });

  it("凌ぎは受け流しと見切りを数え、階を降りるときに判定する", () => {
    const state = gameAt();
    state.time = 10;
    placeBet(state, offer("parries", 30, { tier: "easy", target: 3, mul: 1.5 }));
    const parry = (): void => pushEvent(state, { kind: "onParry", actor: "player", source: { kind: "player", key: "parry" }, pos: { x: 0, y: 0 } });
    parry();
    pushEvent(state, { kind: "onJustDodge", actor: "player", source: { kind: "player", key: "just" }, pos: { x: 0, y: 0 } });
    updateBets(state);
    expect(state.economy.bet?.count, "受け流し 1 + 見切り 1").toBe(2);
    // 同じ時刻に 2 回（数え直しの窓の中）
    parry();
    parry();
    updateBets(state);
    expect(state.economy.bet?.count, "続けて 2 回").toBe(4);
    // 窓を越えてから 1 回
    state.time += SYNERGY.recentWindow + 1;
    parry();
    updateBets(state);
    expect(state.economy.bet?.count, "数え直しても数える").toBe(5);
    onBetsFloorReached(state);
    expect(state.economy.bet, "降りて判定").toBeNull();
    expect(state.economy.earned.bet, "勝ち").toBe(payoutOf(30, 1.5));
  });

  it("凌ぎは回数が足りなければ負け", () => {
    const state = gameAt();
    placeBet(state, offer("parries", 30, { tier: "hard", target: 10, mul: 2 }));
    onBetsFloorReached(state);
    expect(state.economy.bet).toBeNull();
    expect(state.economy.earned.bet).toBe(0);
    expect(state.economy.betStats.parries?.tiers.hard, "難の記録").toEqual({ settled: 1, won: 0 });
  });

  it("見切りの語を持つビルドは凌ぎの必要回数が 1.5 倍（切り上げ）", () => {
    const state = gameAt();
    const base = B.parries.tiers.easy.target;
    expect(parriesTarget(state, "easy"), "語なし").toBe(base);
    state.boonRun.baseStats = null;
    state.stats = { ...state.stats, justDodgeDamageMul: DEFAULT_STATS.justDodgeDamageMul + 0.5 };
    expect(parriesTarget(state, "easy"), "語あり").toBe(Math.ceil(base * B.parryKeywordMul));
  });

  it("階を降りると、倍々勝負は降りた扱いで戻り、束縛した陣を置いた無傷は負け、まだ陣が起きていなければ持ち越す", () => {
    const dbl = gameAt();
    dbl.rng = fixedRng(ALWAYS_WIN);
    placeBet(dbl, offer("doubleUp", 20));
    onBetsFloorReached(dbl);
    expect(dbl.economy.earned.bet, "×2 で戻る").toBe(40);

    const bound = gameAt();
    placeBet(bound, offer("unscathed", 30));
    onJinEngaged(bound, fakeJin(1, bound.time));
    onBetsFloorReached(bound);
    expect(bound.economy.bet, "陣を置いて降りた").toBeNull();
    expect(bound.economy.earned.bet).toBe(0);

    const carried = gameAt();
    placeBet(carried, offer("unscathed", 30));
    onBetsFloorReached(carried);
    expect(carried.economy.bet?.kind, "持ち越し").toBe("unscathed");
  });
});

describe("賭け: 品書き", () => {
  it("運 2 + 腕 2 を重複なしで並べ、同じ seed なら同じ品書き", () => {
    const a = planBookieBets(gameAt(4, 5));
    const b = planBookieBets(gameAt(4, 5));
    expect(a, "決定性").toEqual(b);
    const luck = a.filter((o) => (LUCK_BETS as readonly string[]).includes(o.kind));
    const skill = a.filter((o) => (SKILL_BETS as readonly string[]).includes(o.kind));
    expect(luck.length).toBe(B.luckOffers);
    expect(skill.length).toBe(B.skillOffers);
    expect(new Set(a.map((o) => o.kind)).size, "重複なし").toBe(a.length);
  });

  it("大穴の陣は章に 1 回だけ出る（腕の 1 つ目を置き換える）", () => {
    const state = gameAt(2);
    const first = planBookieBets(state);
    expect(first.filter((o) => o.jackpot).length, "章 1 の 1 回目").toBe(B.jackpotPerChapter);
    expect(first.find((o) => o.jackpot)?.mul).toBe(B.jackpotMul);
    expect(planBookieBets(state).some((o) => o.jackpot), "章 1 の 2 回目").toBe(false);
    state.depth = 7;
    expect(planBookieBets(state).some((o) => o.jackpot), "章 2").toBe(true);
  });

  it("台座の賭け金は今の持ち金から毎ステップ引き直す", () => {
    const state = withBookie(100);
    const first = betOffers(state)[0];
    if (!first?.bet) throw new Error("賭けの台座が無い");
    updateContractors(state, DT);
    expect(first.cost, "100 のとき").toBe(stakeFor(first.bet.kind, 100));
    state.economy.coins = 300;
    updateContractors(state, DT);
    expect(first.cost, "300 のとき").toBe(stakeFor(first.bet.kind, 300));
  });

  it("1 つ張ると品書きの賭けは全部閉じ、張っている間は別の賭場でも張れない", () => {
    const state = withBookie(100);
    const skill = betOffers(state).find((o) => o.bet && !(LUCK_BETS as readonly string[]).includes(o.bet.kind));
    if (!skill) throw new Error("腕の賭けが無い");
    touch(state, skill);
    expect(state.economy.bet, "張った").not.toBeNull();
    expect(betOffers(state).every((o) => o.used), "品書きが閉じる").toBe(true);
    expect(pactHudLines(state).length, "HUD に賭けの行").toBe(1);
    expect(betHudLine(state), "HUD の行").not.toBeNull();

    // 次の賭場（同じ階に立て直す）
    standContractor(state, "bookie");
    const coins = state.economy.coins;
    const next = betOffers(state)[0];
    if (!next) throw new Error("台座が無い");
    touch(state, next);
    expect(next.used, "張れない").toBe(false);
    expect(state.economy.coins, "払わない").toBe(coins);
  });

  it("倍々勝負に勝つと台座が「続ける / 降りる」に変わり、降りると払い戻して消える", () => {
    const state = withBookie(100);
    const first = betOffers(state)[0];
    if (!first?.bet) throw new Error("台座が無い");
    first.key = "doubleUp";
    first.bet = { ...first.bet, kind: "doubleUp", tier: null, target: 0, mul: B.doubleUp.mul, jackpot: false };
    state.rng = fixedRng(ALWAYS_WIN);
    touch(state, first);
    const offers = state.contracts.contractor?.offers ?? [];
    const go = offers.find((o) => o.kind === "betGo");
    const stop = offers.find((o) => o.kind === "betStop");
    if (!go || !stop) throw new Error("続ける / 降りるが無い");
    const stake = state.economy.bet?.stake ?? 0;
    touch(state, go);
    expect(go.used, "勝てば続けられる").toBe(false);
    expect(state.economy.bet?.mul, "×4").toBe(4);
    touch(state, stop);
    expect(state.economy.bet, "降りた").toBeNull();
    expect(state.economy.earned.bet, "賭け金 × 4").toBe(payoutOf(stake, 4));
    updateContractors(state, DT);
    expect(go.used && stop.used, "台座が消える").toBe(true);
  });
});
