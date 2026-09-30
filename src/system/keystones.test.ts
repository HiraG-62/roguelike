import { describe, expect, it } from "vitest";
import { createIncreased } from "../core/damage";
import { playerSource, pushEvent } from "../core/events";
import { ECONOMY, KEYSTONE, PLAYER } from "../data/tuning";
import { KEYSTONES, keystoneDef } from "../loot/affixes";
import { computeStats } from "../loot/stats";
import { DEFAULT_STATS, createEmptyEquipment, type Item } from "../loot/types";
import { registerComboHit } from "./combat";
import { gainCoins, spendCoins } from "./economy";
import { applyModifiers } from "./modifiers";
import { collectRules, resolveRules } from "./rules";
import { hasStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";
import {
  KEYSTONE_NAME,
  KS,
  attackManaMul,
  canAffordSkill,
  keystoneModifiers,
  keystoneRules,
  manaRegenAllowed,
  mushinMul,
  overdrawHpCost,
  paySkillCost,
  type ManaPayer,
} from "./keystones";

const COST = 30;

/** 支払いの判定に要る部分だけの state（GameState 全体は他の system に依存するので作らない） */
function payer(keystones: string[] = []): ManaPayer {
  return { stats: { keystones }, player: { mana: 0, hp: PLAYER.maxHp } };
}

describe("誓約の判定ヘルパー（マナ）", () => {
  it("過負荷 / 静寂の誓いの key と表示名が affixes.ts の定義と揃っている", () => {
    for (const key of [KS.overdraw, KS.silentVow, KS.chant]) {
      expect(keystoneDef(key)?.name, key).toBe(KEYSTONE_NAME[key]);
    }
  });

  it("誓約なし: マナが足りなければ払えず、何も減らない", () => {
    const state = payer();
    state.player.mana = 10;
    const hp = state.player.hp;
    expect(canAffordSkill(state, COST)).toBe(false);
    expect(paySkillCost(state, COST)).toBe(false);
    expect(state.player.mana).toBe(10);
    expect(state.player.hp).toBe(hp);
  });

  it("誓約なし: 足りればマナだけ減る", () => {
    const state = payer();
    state.player.mana = 50;
    const hp = state.player.hp;
    expect(paySkillCost(state, COST)).toBe(true);
    expect(state.player.mana).toBe(50 - COST);
    expect(state.player.hp).toBe(hp);
  });

  it("過負荷: 不足分をマナ 1 = HP 0.5 で払う", () => {
    const state = payer([KS.overdraw]);
    state.player.mana = 10;
    const hp = state.player.hp;
    expect(overdrawHpCost(state, COST)).toBeCloseTo((COST - 10) * KEYSTONE.overdrawHpPerMana);
    expect(paySkillCost(state, COST)).toBe(true);
    expect(state.player.mana).toBe(0);
    expect(state.player.hp).toBeCloseTo(hp - (COST - 10) * KEYSTONE.overdrawHpPerMana);
  });

  it("過負荷: HP で払うと下限を割るなら不発（自傷で死なない）", () => {
    const state = payer([KS.overdraw]);
    state.player.mana = 0;
    state.player.hp = KEYSTONE.overdrawMinHp + COST * KEYSTONE.overdrawHpPerMana - 1;
    const hp = state.player.hp;
    expect(canAffordSkill(state, COST)).toBe(false);
    expect(paySkillCost(state, COST)).toBe(false);
    expect(state.player.hp).toBe(hp);
  });

  it("過負荷: マナが足りていれば HP は減らない", () => {
    const state = payer([KS.overdraw]);
    state.player.mana = 80;
    const hp = state.player.hp;
    expect(paySkillCost(state, COST)).toBe(true);
    expect(state.player.hp).toBe(hp);
  });

  it("静寂の誓い: 通常攻撃のマナ回収倍率が 0、誓約なしは 1", () => {
    expect(attackManaMul(payer())).toBe(1);
    expect(attackManaMul(payer([KS.silentVow]))).toBe(0);
  });

  it("自然回復を止める誓約は無い（渇きの誓約は段取り 7d で消えた）", () => {
    for (const def of KEYSTONES) expect(manaRegenAllowed(payer([def.key])), def.key).toBe(true);
  });

  it("コスト 0（CD 型）は常に払える", () => {
    const state = payer();
    state.player.mana = 0;
    expect(canAffordSkill(state, 0)).toBe(true);
    expect(paySkillCost(state, 0)).toBe(true);
  });
});

describe("誓約の判定ヘルパー（2026-09 追加）", () => {
  it("KS の全 key が affixes.ts の定義と表示名で揃っている", () => {
    for (const key of Object.values(KS)) {
      expect(keystoneDef(key)?.name, key).toBe(KEYSTONE_NAME[key]);
    }
  });

  it("詠唱の誓い: 通常攻撃のマナ回収が KEYSTONE.chantManaMul 倍", () => {
    expect(attackManaMul({ stats: { keystones: [KS.chant] } })).toBe(KEYSTONE.chantManaMul);
    expect(attackManaMul({ stats: { keystones: [] } })).toBe(1);
  });
});

describe("誓約 20（段取り 7d）", () => {
  it("20 種あり、系統は 7（body / tempo / style / mana / status / poise / coin）", () => {
    expect(KEYSTONES.length).toBe(20);
    expect(new Set(KEYSTONES.map((k) => k.exclusiveGroup))).toEqual(new Set(["body", "tempo", "style", "mana", "status", "poise", "coin"]));
  });

  it("虚心: コンボが加算されない", () => {
    const state = arena(5, { keystones: [KS.mushin] });
    registerComboHit(state);
    expect(state.combo.count, "虚心").toBe(0);
    const plain = arena(5);
    registerComboHit(plain);
    expect(plain.combo.count, "誓約なし").toBe(1);
  });

  it("虚心: 当てずに mushinIdleSec 秒たった後の近接・射撃だけ倍。直前に当てていれば等倍、スキル・proc は等倍", () => {
    const state = arena(5, { keystones: [KS.mushin] });
    state.player.moment.lastHitAt = 0;
    state.time = KEYSTONE.mushinIdleSec;
    expect(mushinMul(state, "melee", false), "溜まった近接").toBe(KEYSTONE.mushinMul);
    expect(mushinMul(state, "ranged", false), "溜まった射撃").toBe(KEYSTONE.mushinMul);
    expect(mushinMul(state, "melee", true), "スキル").toBe(1);
    expect(mushinMul(state, "proc", false), "proc").toBe(1);
    state.player.moment.lastHitAt = state.time;
    expect(mushinMul(state, "melee", false), "当てた直後").toBe(1);
    expect(mushinMul(arena(5), "melee", false), "誓約なし").toBe(1);
  });

  it("刹那: 見切りの瞬間、近くの敵を凍結させる（遠い敵は凍らない）", () => {
    const state = arena(5, { keystones: [KS.instant] });
    const near = placeEnemy(state, "boar", KEYSTONE.instantRadius / 2);
    const far = placeEnemy(state, "boar", KEYSTONE.instantRadius * 3);
    expect(collectRules(state).some((r) => r.owner.key === KS.instant), "Rule が集まる").toBe(true);
    pushEvent(state, { kind: "onJustDodge", actor: "player", pos: { ...state.player.body.pos }, source: playerSource("just") });
    resolveRules(state, 0);
    expect(hasStatus(near.status, "freeze"), "近い敵").toBe(true);
    expect(hasStatus(far.status, "freeze"), "遠い敵").toBe(false);
  });

  it("遠間の誓い: 境目以内の敵へ farOathNearMul、遠い敵へ farOathFarMul の倍", () => {
    const state = arena(5, { keystones: [KS.farOath] });
    const near = placeEnemy(state, "boar", KEYSTONE.farOathRangePx / 2);
    const far = placeEnemy(state, "boar", KEYSTONE.farOathRangePx * 4);
    const mulOf = (e: typeof near): number => applyModifiers(state, { tags: new Set(["melee"]) }, e).more.reduce((m, x) => m * x.mul, 1);
    expect(mulOf(near), "近い敵").toBeCloseTo(KEYSTONE.farOathNearMul);
    expect(mulOf(far), "遠い敵").toBeCloseTo(KEYSTONE.farOathFarMul);
  });

  it("清貧: 拾った銭は持てず気力に換わり、与ダメの増を持つ", () => {
    const state = arena(5, { keystones: [KS.poverty] });
    state.player.mana = 0;
    const got = gainCoins(state, 10, "kill");
    expect(got, "得た銭").toBe(0);
    expect(state.economy.coins, "持ち金").toBe(0);
    expect(state.player.mana, "気力に換わる").toBeGreaterThan(0);
    const inc = keystoneModifiers([KS.poverty]).reduce((sum, m) => sum + (m.kind === "increased" ? m.amount : 0), 0);
    expect(inc).toBeCloseTo(KEYSTONE.povertyIncreased);
  });

  it("黄金の檻: 持ち金 goldCageEvery につき倍が 1 段、こぼれる銭の倍率が上がる", () => {
    const state = arena(5, { keystones: [KS.goldCage] });
    state.economy.coins = KEYSTONE.goldCageEvery * 2;
    const more = applyModifiers(state, { tags: new Set(["melee"]) }, null).more.reduce((m, x) => m * x.mul, 1);
    expect(more).toBeCloseTo(1 + (KEYSTONE.goldCageMul - 1) * 2);
    const def = keystoneDef(KS.goldCage);
    const stats = { ...DEFAULT_STATS, keystones: [], increased: createIncreased(), more: [] };
    def?.apply(stats);
    expect(stats.coinSpillMul * ECONOMY.spill.ratio).toBeCloseTo(KEYSTONE.goldCageSpillRatio);
  });

  it("喜捨: 銭を払うと払った額に応じて回復し、与ダメの強化が付く", () => {
    const state = arena(5, { keystones: [KS.alms] });
    state.economy.coins = 100;
    state.player.hp = 10;
    expect(keystoneRules([KS.alms]).length).toBe(2);
    expect(spendCoins(state, 20, "item")).toBe(true);
    resolveRules(state, 0);
    expect(state.player.hp, "回復").toBeGreaterThan(10);
    expect(state.player.buffs.damage.time, "強化の秒").toBeGreaterThan(0);
  });

  it("誓約を持つ遺物で computeStats すると keystones に積まれる（黄金の檻）", () => {
    const eq = createEmptyEquipment();
    const ring: Item = {
      id: "ks-ring",
      seed: 1,
      baseKey: "ironRing",
      slot: "ring",
      rarity: "magic",
      itemLevel: 1,
      name: "檻の指輪",
      implicit: null,
      affixes: [{ key: KS.goldCage, value: 0, color: "umbra" }],
      foundDepth: 1,
      foundAt: 0,
    };
    eq.ring = ring;
    expect(computeStats(eq).keystones).toEqual([KS.goldCage]);
  });
});
