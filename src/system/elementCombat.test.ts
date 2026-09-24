import { describe, expect, it } from "vitest";
import { attack } from "../core/element";
import type { GameState } from "../core/state";
import { enemyGuard } from "../data/enemyCombat";
import { enemyResistTable, enemyWeaknesses } from "../data/enemyDefense";
import { ELEMENT } from "../data/tuning";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { mitigate, rollOutgoing } from "./combat";
import {
  effectiveResist,
  elementShares,
  enemyAttackOf,
  enemyDefenseMul,
  outgoingElement,
  playerMitigationMul,
  resolveAttack,
} from "./elementCombat";
import { arena, placeEnemy } from "./testHelpers";

/** 会心で数値が揺れないようにする */
function noCrit(stats: Partial<PlayerStats> = {}): GameState {
  return arena(5, { critChance: 0, ...stats });
}

const BIG_HP = 100_000;

function target(state: GameState, key: string) {
  const e = placeEnemy(state, key, 30);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

describe("攻撃の素性（ジャンル・属性）の既定", () => {
  it("近接は武器種、射撃は射撃の型、proc は素性なし、スキルは無属性の物理", () => {
    const s = DEFAULT_STATS;
    expect(resolveAttack(s, "melee", false), "剣").toEqual(attack("melee", "physical"));
    expect(resolveAttack(s, "ranged", false), "単発").toEqual(attack("ranged", "physical"));
    expect(resolveAttack(s, "proc", false), "proc").toBeNull();
    expect(resolveAttack(s, "ranged", true), "素性を渡さないスキル").toEqual(attack("ranged", "physical"));
    expect(resolveAttack({ ...s, moveset: "scythe" }, "melee", false)?.element, "大鎌は闇").toBe("dark");
  });

  it("明示した素性が優先し、null なら素性なし", () => {
    expect(resolveAttack(DEFAULT_STATS, "melee", false, attack("area", "arcane", "fire"))?.genre.quality).toBe("arcane");
    expect(resolveAttack(DEFAULT_STATS, "melee", false, null)).toBeNull();
  });
});

describe("与ダメ: 敵の防御・魔防", () => {
  it("既定ステータス・無属性で、防御も耐性も持たない敵へは現行の威力と一致する", () => {
    const state = noCrit();
    const e = target(state, "slime");
    expect(rollOutgoing(state, e, 10, "melee").amount, "近接").toBe(10);
    expect(rollOutgoing(state, e, 10, "ranged").amount, "射撃").toBe(10);
    expect(rollOutgoing(state, e, 10, "melee").affinity, "弱点でも耐性でもない").toBe("neutral");
  });

  it("物理は防御、魔法は魔防、混成は平均で受ける", () => {
    const state = noCrit();
    const e = target(state, "golem");
    const g = enemyGuard("golem");
    expect(g.defense, "ゴーレムは物理に硬い").toBeGreaterThan(0);
    expect(g.warding, "ゴーレムは魔法に弱い").toBeLessThan(0);
    expect(enemyDefenseMul(e, "physical")).toBeCloseTo(1 - g.defense / 100);
    expect(enemyDefenseMul(e, "arcane")).toBeCloseTo(1 - g.warding / 100);
    expect(enemyDefenseMul(e, "hybrid")).toBeCloseTo(1 - (g.defense + g.warding) / 2 / 100);
    const phys = rollOutgoing(state, e, 100, "melee", { attack: attack("melee", "physical") }).amount;
    const arc = rollOutgoing(state, e, 100, "melee", { attack: attack("melee", "arcane") }).amount;
    expect(arc, "鎧には魔法がよく通る").toBeGreaterThan(phys);
  });

  it("proc（反射・継続ダメージなど）は防御も耐性も受けない", () => {
    const state = noCrit();
    const e = target(state, "frostGolem");
    expect(rollOutgoing(state, e, 10, "proc").amount).toBe(10);
  });
});

describe("与ダメ: 属性耐性と弱点", () => {
  it("弱点の属性は増え、耐性の属性は減る（防御の後に掛かる）", () => {
    const state = noCrit();
    const e = target(state, "frostGolem");
    const table = enemyResistTable(enemyGuard("frostGolem"));
    expect(table.fire, "霜ゴーレムの弱点は炎").toBeLessThan(0);
    expect(table.ice, "霜ゴーレムは氷に強い").toBeGreaterThan(0);
    const def = enemyDefenseMul(e, "physical");
    const fire = rollOutgoing(state, e, 100, "melee", { attack: attack("melee", "physical", "fire") });
    expect(fire.amount).toBe(Math.round(100 * def * (1 - table.fire / 100)));
    expect(fire.affinity).toBe("weak");
    const ice = rollOutgoing(state, e, 100, "melee", { attack: attack("melee", "physical", "ice") });
    expect(ice.amount).toBe(Math.round(100 * def * (1 - table.ice / 100)));
    expect(ice.affinity).toBe("resist");
  });

  it("弱点に当たると浮き文字「弱点」と効果音。近くに残っている間は重ねない", () => {
    const state = noCrit();
    const e = target(state, "frostGolem");
    rollOutgoing(state, e, 10, "melee", { attack: attack("melee", "physical", "fire") });
    rollOutgoing(state, e, 10, "melee", { attack: attack("melee", "physical", "fire") });
    expect(state.texts.filter((t) => t.text === ELEMENT.weakText).length, "浮き文字は 1 つ").toBe(1);
    expect(state.sfx.filter((s) => s === "weakHit").length, "効果音も 1 回").toBe(1);
    rollOutgoing(state, e, 10, "melee", { attack: attack("melee", "physical", "ice") });
    expect(state.texts.some((t) => t.text === ELEMENT.resistText), "耐性").toBe(true);
    expect(state.sfx).toContain("resistHit");
  });

  it("変換は通常攻撃の威力の一部をその属性として耐性を按分する", () => {
    const stats = { ...DEFAULT_STATS, infuse: { ...DEFAULT_STATS.infuse, fire: 0.5 } };
    const shares = elementShares(stats, attack("melee", "physical"), false);
    expect(shares).toEqual([
      { element: "none", share: 0.5 },
      { element: "fire", share: 0.5 },
    ]);
    const state = noCrit({ infuse: stats.infuse });
    const e = target(state, "frostGolem");
    const table = enemyResistTable(enemyGuard("frostGolem"));
    const out = outgoingElement(state.stats, e, attack("melee", "physical"), false);
    expect(out.mul).toBeCloseTo(enemyDefenseMul(e, "physical") * (0.5 + 0.5 * (1 - table.fire / 100)));
    expect(elementShares(stats, attack("ranged", "arcane", "ice"), true), "スキルには通常攻撃の変換が掛からない").toEqual([
      { element: "ice", share: 1 },
    ]);
  });

  it("無の刻印はスキルの属性を無属性へ戻す", () => {
    const stats = { ...DEFAULT_STATS, skillNeutral: 1 };
    expect(elementShares(stats, attack("area", "arcane", "fire"), true)).toEqual([{ element: "none", share: 1 }]);
  });

  it("ボスは段階ごとに弱点が変わる", () => {
    const giant = enemyGuard("frostGiant");
    expect(enemyWeaknesses(giant, 1), "段階 1").toEqual(["fire"]);
    expect(enemyWeaknesses(giant, 2), "段階 2").toEqual(["lightning"]);
  });
});

describe("被ダメ: 防御・魔防・耐性", () => {
  it("素性なし（罠・地形）と物理・無属性は現行の armor 式と一致する", () => {
    const state = arena(5, { armor: 50 });
    expect(mitigate(state, 100)).toBe(50);
    expect(mitigate(state, 100, attack("melee", "physical"))).toBe(50);
  });

  it("魔法は魔防で受け、防御は効かない。混成は平均", () => {
    const stats: PlayerStats = { ...DEFAULT_STATS, armor: 50, warding: 0 };
    expect(playerMitigationMul(stats, attack("ranged", "arcane"))).toBeCloseTo(1);
    expect(playerMitigationMul({ ...stats, warding: 50 }, attack("ranged", "arcane"))).toBeCloseTo(0.5);
    expect(playerMitigationMul(stats, attack("melee", "hybrid"))).toBeCloseTo(0.75);
  });

  it("耐性はソフトキャップ（50 を超えた分は半分、上限 75、下限 −100）", () => {
    expect(effectiveResist(40)).toBe(40);
    expect(effectiveResist(60)).toBe(55);
    expect(effectiveResist(200)).toBe(ELEMENT.resistMax);
    expect(effectiveResist(-300)).toBe(ELEMENT.resistMin);
  });

  it("敵の攻撃の属性はプレイヤーの耐性で軽減される（氷眼の氷の魔法弾）", () => {
    const state = arena(5, { resist: { ...DEFAULT_STATS.resist, ice: 50 } });
    const eye = placeEnemy(state, "frostEye", 60);
    const atk = enemyAttackOf(eye);
    expect(atk?.element).toBe("ice");
    expect(atk?.genre.quality).toBe("arcane");
    expect(mitigate(state, 100, atk)).toBe(50);
  });
});
