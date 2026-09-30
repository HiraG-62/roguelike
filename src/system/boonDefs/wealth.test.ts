import { describe, expect, it } from "vitest";
import type { EventKind, GameEvent } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE } from "../../data/tuning";
import { BOON_ACTIONS, BOONS, type BoonDef } from "../boonDefs";
import { applyModifiers } from "../modifiers";
import { resolveRules } from "../rules";
import { arena, placeEnemy } from "../testHelpers";
import { BOONS_WEALTH, BOON_KEYS_WEALTH } from "./wealth";

/** 財宝の 11 枚（docs/ideas/boon-impl.md 2-6、economy-core.md 9-2）の構成と、各札の効果が 1 本ずつ起きることの検査 */

const W = BOON_LINEAGE.wealth;
const CARDS: readonly BoonDef[] = BOON_KEYS_WEALTH.map((k) => BOONS_WEALTH[k]);
const NEAR = 20;
const BIG_HP = 10_000;
const MELEE = new Set(["melee"] as const);

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

function sturdy(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "slime", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

function eventOf(state: GameState, kind: EventKind, target?: Enemy, amount?: number): GameEvent {
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return {
    kind,
    actor: "player",
    pos,
    depth: 0,
    source: { kind: "player", key: "test" },
    ...(target ? { targetId: target.id } : {}),
    ...(amount !== undefined ? { amount } : {}),
  };
}

function fireCard(state: GameState, def: BoonDef, ev: GameEvent): void {
  state.events.push(ev);
  resolveRules(state, 0, def.rules ?? []);
}

describe("財宝の札の構成", () => {
  it("11 枚: 加護 5（行動ごとに 1 枚）・摂理 3・研鑽 2・真髄 1、全て財宝", () => {
    expect(CARDS.length).toBe(11);
    const count = (card: string): number => CARDS.filter((d) => d.card === card).length;
    expect([count("grace"), count("law"), count("temper"), count("apex")]).toEqual([5, 3, 2, 1]);
    expect(CARDS.filter((d) => d.card === "grace").map((d) => d.action).sort()).toEqual([...BOON_ACTIONS].sort());
    for (const d of CARDS) {
      expect(d.lineage, `${d.key}`).toBe("wealth");
      expect(d.changes, `${d.key}`).toBeDefined();
      expect(d.keywords, `${d.key}`).toBeDefined();
    }
  });

  it("研鑽は稼ぎ・払いの総額の「〜につき」を持つ（数えはプレイヤーの稼ぎと払い）", () => {
    for (const d of CARDS.filter((x) => x.card === "temper")) {
      const kinds = (d.modifiers ?? []).map((m) => m.per?.count.kind);
      expect(kinds.some((k) => k === "coinsEarned" || k === "coinsSpent" || k === "tally"), `${d.key}`).toBe(true);
    }
  });

  it("守銭・拾銭は旧 key のまま財宝へ写し、BOONS がこちらの定義を引く", () => {
    expect(BOONS.miser).toBe(BOONS_WEALTH.miser);
    expect(BOONS.coinGleaner).toBe(BOONS_WEALTH.coinGleaner);
  });
});

describe("財宝の札の効果", () => {
  it("銭吐き: 左の命中で銭を得る。右の命中では得ない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    state.player.attack.lane = "secondary";
    fireCard(state, BOONS_WEALTH.coinSpit, eventOf(state, "onSwingHit", e));
    expect(state.economy.coins, "右").toBe(0);
    state.player.attack.lane = "primary";
    fireCard(state, BOONS_WEALTH.coinSpit, eventOf(state, "onSwingHit", e));
    expect(state.economy.coins, "左").toBe(Math.round(W.coinSpit.coins * state.stats.coinGainMul));
  });

  it("投銭: 戦意を使うと持ち金の割合を払い、額 × perCoin の弾を投げる", () => {
    const state = cleanArena();
    state.economy.coins = 100;
    const before = state.projectiles.length;
    fireCard(state, BOONS_WEALTH.coinToss, eventOf(state, "onRelease"));
    const paid = Math.floor(100 * W.coinToss.share);
    expect(state.economy.coins).toBe(100 - paid);
    expect(state.projectiles[before]?.damage).toBe(paid * W.coinToss.perCoin);
  });

  it("掏り: ダッシュの終わりに周りの敵 1 体につき銭を得る", () => {
    const state = cleanArena();
    sturdy(state, NEAR);
    sturdy(state, -NEAR);
    sturdy(state, W.pickpocket.radius * 3);
    fireCard(state, BOONS_WEALTH.pickpocket, eventOf(state, "onDashEnd"));
    expect(state.economy.coins, "周りの 2 体").toBe(Math.round(W.pickpocket.coins * 2 * state.stats.coinGainMul));
  });

  it("銭払い: スキルを撃つと銭を払って気力を取り戻し、足りなければ何もしない", () => {
    const state = cleanArena();
    state.economy.coins = W.coinPay.cost + 1;
    state.player.mana = 0;
    fireCard(state, BOONS_WEALTH.coinPay, eventOf(state, "onSkillCast"));
    expect(state.economy.coins, "払う").toBe(1);
    expect(state.player.mana, "戻る").toBeCloseTo(W.coinPay.mana * state.stats.manaGainMul);
    state.time += 1;
    const mana = state.player.mana;
    fireCard(state, BOONS_WEALTH.coinPay, eventOf(state, "onSkillCast"));
    expect(state.economy.coins, "足りない").toBe(1);
    expect(state.player.mana, "戻らない").toBe(mana);
  });

  it("散財: 奥義で持ち金を全て払い、払う前の額に比例した爆発。銭が無ければ何もしない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR / 2);
    fireCard(state, BOONS_WEALTH.squander, eventOf(state, "onBurst"));
    expect(e.hp, "銭なし").toBe(BIG_HP);
    state.economy.coins = 50;
    state.time += 1;
    fireCard(state, BOONS_WEALTH.squander, eventOf(state, "onBurst"));
    expect(state.economy.coins, "全部払う").toBe(0);
    expect(e.hp, "爆発").toBeLessThan(BIG_HP);
  });

  it("守銭: 持ち金 every につき与ダメの増（上限 cap）", () => {
    const state = cleanArena();
    state.economy.coins = W.miser.every * 2;
    const out = applyModifiers(state, { tags: MELEE }, null, BOONS_WEALTH.miser.modifiers);
    expect(out.increased).toBeCloseTo(Math.min(W.miser.cap, W.miser.perStep * 2));
  });

  it("拾銭: 銭を拾うと移動速度が上がる", () => {
    const state = cleanArena();
    fireCard(state, BOONS_WEALTH.coinGleaner, eventOf(state, "onCoinPickup", undefined, 1));
    expect(state.player.buffs.speed.time).toBeGreaterThan(0);
    expect(state.player.buffs.speed.mul).toBeGreaterThan(1);
  });

  it("戻り銭: こぼれた額の ratio がすぐ戻る", () => {
    const state = cleanArena();
    const spilled = 20;
    fireCard(state, BOONS_WEALTH.changeBack, eventOf(state, "onCoinSpill", undefined, spilled));
    expect(state.economy.coins).toBe(Math.round(spilled * W.changeBack.ratio * state.stats.coinGainMul));
  });

  it("稼: 稼いだ総額 every につき与ダメの増", () => {
    const state = cleanArena();
    state.economy.earned.kill = W.earnTally.every * 3;
    const out = applyModifiers(state, { tags: MELEE }, null, BOONS_WEALTH.earnTally.modifiers);
    expect(out.increased).toBeCloseTo(W.earnTally.amount * 3);
  });

  it("散: 使った総額 every につき与ダメの倍", () => {
    const state = cleanArena();
    state.economy.spent.flask = W.spendTally.every * 2;
    const out = applyModifiers(state, { tags: MELEE }, null, BOONS_WEALTH.spendTally.modifiers);
    expect(out.more[0]?.mul).toBeCloseTo(1 + W.spendTally.amount * 2);
  });

  it("黄金律: 持ち金が base の 2 倍を超えるたび倍が 1 段上がり、被弾でこぼれる銭が増える", () => {
    const state = cleanArena();
    state.economy.coins = W.goldenRule.base * 2;
    const out = applyModifiers(state, { tags: MELEE }, null, BOONS_WEALTH.goldenRule.modifiers);
    expect(out.more[0]?.mul, "base → 1 段、2 倍 → 2 段").toBeCloseTo(1 + W.goldenRule.amount * 2);
    const coins = state.economy.coins;
    fireCard(state, BOONS_WEALTH.goldenRule, eventOf(state, "onCoinSpill", undefined, 1));
    expect(state.economy.coins, "さらに撒く").toBe(coins - Math.floor(coins * W.goldenRule.spillShare));
  });
});

describe("財宝の決定性", () => {
  it("同じ seed で同じ札を同じ順に流すと同じ結果", () => {
    const run = (): { coins: number; hp: number; rng: number } => {
      const state = cleanArena(9);
      const e = sturdy(state, NEAR);
      state.economy.coins = 200;
      state.player.attack.lane = "primary";
      for (const key of BOON_KEYS_WEALTH) {
        for (const kind of ["onSwingHit", "onRelease", "onDashEnd", "onSkillCast", "onBurst", "onCoinSpill"] as const) {
          fireCard(state, BOONS_WEALTH[key], eventOf(state, kind, e, 10));
        }
      }
      return { coins: state.economy.coins, hp: e.hp, rng: state.rng.next() };
    };
    expect(run()).toEqual(run());
  });
});
