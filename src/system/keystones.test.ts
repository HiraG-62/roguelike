import { describe, expect, it } from "vitest";
import { KEYSTONE, PLAYER } from "../data/tuning";
import { keystoneDef } from "../loot/affixes";
import { arena, engageStartRoom } from "./testHelpers";
import {
  KEYSTONE_NAME,
  KS,
  attackManaMul,
  canAffordSkill,
  healMul,
  manaRegenAllowed,
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
    for (const key of [KS.overdraw, KS.silentVow, KS.thirst]) {
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

  it("渇きの誓約: 通常攻撃のマナ回収倍率が 3 になり、自然回復が止まる", () => {
    expect(attackManaMul(payer([KS.thirst]))).toBe(3);
    expect(manaRegenAllowed(payer([KS.thirst]))).toBe(false);
    expect(manaRegenAllowed(payer())).toBe(true);
  });

  it("コスト 0（CD 型）は常に払える", () => {
    const state = payer();
    state.player.mana = 0;
    expect(canAffordSkill(state, 0)).toBe(true);
    expect(paySkillCost(state, 0)).toBe(true);
  });
});

describe("誓約の判定ヘルパー（2026-09 追加）", () => {
  it("背水の誓い: 封鎖しない部屋でも交戦中は回復が効かない。交戦していなければ効く", () => {
    const state = arena(5, { keystones: [KS.backwater] });
    for (const r of state.rooms) r.locked = false;
    expect(healMul(state), "交戦前").toBe(1);
    engageStartRoom(state);
    expect(healMul(state), "開放型の交戦中").toBe(0);
  });

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
