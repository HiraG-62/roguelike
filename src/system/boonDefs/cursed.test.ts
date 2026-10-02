import { describe, expect, it } from "vitest";
import type { EventKind, GameEvent } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import { BOONS, type BoonDef } from "../boonDefs";
import { coreBlocksHearts, coreCursedForced, foldCoreStats } from "../boonCores";
import { isGraded } from "../boonGrade";
import { applyModifiers } from "../modifiers";
import { resolveRules } from "../rules";
import { hasStatus } from "../statusEffects";
import { arena, placeEnemy } from "../testHelpers";
import { BOONS_CURSED, BOON_KEYS_CURSED } from "./cursed";

/** 呪い付き 6 と芯 8（docs/ideas/boon-impl.md 2-6）の件数と、各札の効果が 1 本ずつ起きることの検査 */

const K = BOON_LINEAGE.cursed;
const CARDS: readonly BoonDef[] = BOON_KEYS_CURSED.map((k) => BOONS_CURSED[k]);
const CURSED = CARDS.filter((d) => d.cursed);
const CORES = CARDS.filter((d) => d.core === true);
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

function sturdy(state: GameState, dx: number): Enemy {
  const e = placeEnemy(state, "slime", dx);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

function eventOf(state: GameState, kind: EventKind, target?: Enemy, tag?: string): GameEvent {
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return {
    kind,
    actor: "player",
    pos,
    depth: 0,
    source: { kind: "player", key: "test" },
    ...(target ? { targetId: target.id } : {}),
    ...(tag !== undefined ? { tag } : {}),
  };
}

function fireCard(state: GameState, def: BoonDef, ev: GameEvent): void {
  state.events.push(ev);
  resolveRules(state, 0, def.rules ?? []);
}

describe("呪い付きと芯の構成", () => {
  it("呪い付き 6・芯 8。どちらも系譜・札の種類・行動を持たない", () => {
    expect(CURSED.length, "呪い付き").toBe(6);
    expect(CORES.length, "芯").toBe(8);
    expect(CURSED.length + CORES.length, "他の札を混ぜない").toBe(CARDS.length);
    for (const d of CARDS) {
      expect(d.lineage, d.key).toBeUndefined();
      expect(d.card, d.key).toBeUndefined();
      expect(d.action, d.key).toBeUndefined();
      expect(d.fusion, d.key).toBeUndefined();
      expect(isGraded(d), `${d.key} は格を持たない`).toBe(false);
    }
  });

  it("旧 key のまま写し、BOONS がこちらの定義を引く", () => {
    for (const key of BOON_KEYS_CURSED) expect(BOONS[key], key).toBe(BOONS_CURSED[key]);
  });
});

describe("呪い付きの効果（効果と代償）", () => {
  it("血染めの地: 地形に踏み込むと奥義ゲージ、代わりに自分が出血", () => {
    const state = cleanArena();
    state.player.energy = 0;
    fireCard(state, BOONS_CURSED.bloodSoil, eventOf(state, "onTerrainEnter"));
    expect(state.player.energy, "ゲージ").toBeGreaterThan(0);
    expect(hasStatus(state.player.status, "bleed"), "出血").toBe(true);
  });

  it("一念: 系譜が 1 つだけなら倍、2 つ以上なら代償の倍", () => {
    const state = cleanArena();
    const mul = (): number => applyModifiers(state, { tags: MELEE }, null, BOONS_CURSED.singleMind.modifiers).more.reduce((m, x) => m * x.mul, 1);
    state.boons = ["singleMind", "moonRead"];
    expect(mul(), "輪廻だけ").toBeCloseTo(K.singleMind.mainMul);
    state.boons = ["singleMind", "moonRead", "miser"];
    expect(mul(), "輪廻と財宝").toBeCloseTo(K.singleMind.otherMul);
  });

  it("焦がれ刃: 近接の命中で燃焼、代わりに撃破で自分が燃える", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_CURSED.scorchBlade, eventOf(state, "onMeleeHit", e));
    expect(hasStatus(e.status, "burn"), "敵が燃える").toBe(true);
    fireCard(state, BOONS_CURSED.scorchBlade, eventOf(state, "onKill"));
    expect(hasStatus(state.player.status, "burn"), "自分が燃える").toBe(true);
  });

  it("狂い咲き: 反応で衝撃波、代わりに自分が弱体", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_CURSED.madBloom, eventOf(state, "onReaction", e));
    expect(e.hp, "衝撃波").toBeLessThan(BIG_HP);
    expect(hasStatus(state.player.status, "weaken"), "弱体").toBe(true);
  });

  it("重き誓い: 大剣を溜めずに当てると自分が弱体、大剣でなければ何もしない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    state.stats = { ...state.stats, moveset: "sword" };
    fireCard(state, BOONS_CURSED.heavyOath, eventOf(state, "onMeleeHit", e));
    expect(hasStatus(state.player.status, "weaken"), "大剣でない").toBe(false);
    state.stats = { ...state.stats, moveset: "greatsword" };
    fireCard(state, BOONS_CURSED.heavyOath, eventOf(state, "onMeleeHit", e));
    expect(hasStatus(state.player.status, "weaken"), "溜めずに当てた").toBe(true);
  });

  it("濡れ鼠: 水たまりで気力が戻り、代わりに自分が濡れる。水以外では起きない", () => {
    const state = cleanArena();
    state.player.mana = 0;
    fireCard(state, BOONS_CURSED.drenched, eventOf(state, "onTerrainEnter", undefined, "oil"));
    expect(state.player.mana, "水以外").toBe(0);
    fireCard(state, BOONS_CURSED.drenched, eventOf(state, "onTerrainEnter", undefined, "water"));
    expect(state.player.mana, "気力").toBeGreaterThan(0);
    expect(hasStatus(state.player.status, "wet"), "濡れ").toBe(true);
  });
});

describe("芯の効果", () => {
  it("呪い喰い: 呪い付きを必ず混ぜる（割り込み）", () => {
    const state = cleanArena();
    expect(coreCursedForced(state)).toBe(false);
    state.boons.push("coreCurseEater");
    expect(coreCursedForced(state)).toBe(true);
  });

  it("拍の刻: コンボの倍率を上書きし、被弾でコンボが 0 になる", () => {
    const state = cleanArena();
    expect(foldCoreStats(state.stats, ["coreTempo"]).comboDamagePerStack).toBe(BOON.tempoPerStack);
    state.combo.count = 10;
    fireCard(state, BOONS_CURSED.coreTempo, eventOf(state, "onHurt"));
    expect(state.combo.count).toBe(0);
  });

  it("血の巡り: 命中の回収が増え、ハートを拾えない", () => {
    const state = cleanArena();
    expect(foldCoreStats(state.stats, ["coreBloodLoop"]).lifeOnHit).toBe(state.stats.lifeOnHit + BOON.bloodLoopLifeOnHit);
    state.boons.push("coreBloodLoop");
    expect(coreBlocksHearts(state)).toBe(true);
  });

  it("逃げ水: ダッシュ回数が増え、ダッシュの終わりに爆発", () => {
    const state = cleanArena();
    expect(foldCoreStats(state.stats, ["coreMirage"]).dashCharges).toBe(state.stats.dashCharges + BOON.mirageCharges);
    const e = sturdy(state, NEAR / 2);
    fireCard(state, BOONS_CURSED.coreMirage, eventOf(state, "onDashEnd"));
    expect(e.hp).toBeLessThan(BIG_HP);
  });

  it("硝子の刃: 与ダメージの倍が付き、代わりに被ダメージが増える", () => {
    const state = cleanArena();
    state.boons = ["coreGlass"];
    const more = applyModifiers(state, { tags: MELEE }, null, BOONS_CURSED.coreGlass.modifiers).more.reduce((m, x) => m * x.mul, 1);
    expect(more, "与ダメの倍").toBeCloseTo(BOON.glassDamageMore);
    const out = foldCoreStats(state.stats, ["coreGlass"]);
    expect(out.damageTakenMul, "被ダメ").toBeCloseTo(state.stats.damageTakenMul * BOON.glassDamageTakenMul);
    expect(out.maxHp, "最大生命は変わらない").toBe(state.stats.maxHp);
  });

  it("重心: 怯み値とノックバックが増え、代わりに攻撃速度が落ちる", () => {
    const state = cleanArena();
    const out = foldCoreStats(state.stats, ["coreHeavy"]);
    expect(out.poiseDamageMul).toBeCloseTo(state.stats.poiseDamageMul * BOON.heavyPoiseMul);
    expect(out.knockbackMul).toBeCloseTo(state.stats.knockbackMul * BOON.heavyKnockbackMul);
    expect(out.attackSpeedMul, "攻撃速度").toBeCloseTo(state.stats.attackSpeedMul * BOON.heavyAttackSpeedMul);
    expect(out.attackSpeedMul, "遅くなる").toBeLessThan(state.stats.attackSpeedMul);
  });

  it("気の泉: 最大気力と気力の獲得が増え、代わりに最大生命が減る", () => {
    const state = cleanArena();
    const out = foldCoreStats(state.stats, ["coreWellspring"]);
    expect(out.maxMana, "最大気力").toBe(state.stats.maxMana + BOON.wellspringMana);
    expect(out.manaGainMul, "気力の獲得").toBeCloseTo(state.stats.manaGainMul * BOON.wellspringManaGainMul);
    expect(out.maxHp, "最大生命").toBe(Math.round(state.stats.maxHp * BOON.wellspringHpMul));
    expect(out.maxHp, "減る").toBeLessThan(state.stats.maxHp);
  });

  it("銭の亡者: 銭の獲得と引き寄せが増え、代わりに被弾でこぼれる銭が増える", () => {
    const state = cleanArena();
    const out = foldCoreStats(state.stats, ["coreGreed"]);
    expect(out.coinGainMul, "銭の獲得").toBeCloseTo(state.stats.coinGainMul * BOON.greedCoinGainMul);
    expect(out.coinMagnetMul, "引き寄せ").toBeCloseTo(state.stats.coinMagnetMul * BOON.greedMagnetMul);
    expect(out.coinSpillMul, "こぼれる銭").toBeCloseTo(state.stats.coinSpillMul * BOON.greedSpillMul);
  });

  it("芯の畳み込みは元の stats を書き換えない", () => {
    const state = cleanArena();
    const before = { ...state.stats };
    foldCoreStats(state.stats, ["coreGlass", "coreHeavy", "coreWellspring", "coreGreed"]);
    expect(state.stats, "元の stats").toEqual(before);
  });
});

describe("呪い付き・芯の決定性", () => {
  it("同じ seed で同じ札を同じ順に流すと同じ結果", () => {
    const run = (): { hp: number; mana: number; energy: number; rng: number } => {
      const state = cleanArena(9);
      const e = sturdy(state, NEAR);
      for (const key of BOON_KEYS_CURSED) {
        for (const kind of ["onTerrainEnter", "onMeleeHit", "onKill", "onReaction", "onHurt", "onDashEnd"] as const) {
          fireCard(state, BOONS_CURSED[key], eventOf(state, kind, e, "water"));
        }
      }
      return { hp: e.hp, mana: state.player.mana, energy: state.player.energy, rng: state.rng.next() };
    };
    expect(run()).toEqual(run());
  });
});
