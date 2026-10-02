import { describe, expect, it } from "vitest";
import { createIncreased } from "../core/damage";
import type { Modifier } from "../core/rules";
import type { GameState } from "../core/state";
import { FEEL, KEYSTONE, PLAYER, TRIGGER } from "../data/tuning";
import { applyRoll } from "../loot/affixes";
import { meleeScaling } from "../data/weapons";
import { scaled } from "./attributes";
import { slashBase } from "./boonRules";
import { damageEnemy, rollOutgoing } from "./combat";
import { buildContext, poiseIncreasedMul } from "./damageMods";
import { KS } from "./keystones";
import { BOONS, BOON_KEYS, type BoonKey, type LineageKey } from "./boonDefs";
import { applyModifiers, coinsLogSteps, collectModifiers, countPer, estimateModifiers } from "./modifiers";
import { applyStagger } from "./poise";
import { applyStatus } from "./statusEffects";
import { keystoneMore } from "./traitHooks";
import { arena, placeEnemy } from "./testHelpers";

/** Modifier（常時の増・倍と「〜につき」。system/modifiers.ts）の検査 */

const BASE = 100;
const STAGGER_TIME = 2;
const OWNER = { kind: "boon", key: "test" } as const;

/** 生命を大きくした、倒れない敵 */
function sturdy(state: GameState): ReturnType<typeof placeEnemy> {
  const e = placeEnemy(state, "slime", 20);
  e.hp = 10_000;
  e.maxHp = 10_000;
  return e;
}

/** テストの中だけの見本: コンボ 10 につき増 +2%（上限 100%） */
const COMBO_STEP: Modifier = {
  id: "boon:test:0",
  kind: "increased",
  tag: "all",
  amount: 0.02,
  per: { count: { kind: "combo" }, every: 10, cap: 1.0 },
  if: [],
  owner: OWNER,
};

function modifier(partial: Partial<Modifier>): Modifier {
  return { id: "boon:test:1", kind: "more", tag: "all", amount: 1.5, if: [], owner: OWNER, ...partial };
}

describe("移行の見本: 遠間の誓い（誓約の常時の倍 → Modifier）", () => {
  it("境目より遠い敵への近接・射撃だけ上がり、近い敵へは下がる（proc には掛けない）", () => {
    const state = arena(5, { keystones: [KS.farOath] });
    const far = placeEnemy(state, "slime", KEYSTONE.farOathRangePx * 4);
    far.hp = 10_000;
    far.maxHp = 10_000;
    const melee = rollOutgoing(state, far, BASE, "melee");
    expect(melee.amount, "遠い敵への近接").toBe(Math.round(BASE * KEYSTONE.farOathFarMul));
    expect(rollOutgoing(state, far, BASE, "ranged").amount, "遠い敵への射撃").toBe(Math.round(BASE * KEYSTONE.farOathFarMul));
    expect(rollOutgoing(state, far, BASE, "proc").amount, "proc には掛けない").toBe(BASE);
    expect(melee.breakdown.more.map((m) => m.source), "出所は Modifier").toEqual(["mod:keystone:ks_farOath:2"]);
    expect(melee.breakdown.more[0]?.label, "表示名は誓約の名").toBe("遠間の誓い");
    const near = sturdy(state);
    expect(rollOutgoing(state, near, BASE, "melee").amount, "近い敵").toBe(Math.round(BASE * KEYSTONE.farOathNearMul));
  });

  it("対象のいない 1 撃には掛からない", () => {
    const state = arena(5, { keystones: [KS.farOath] });
    expect(rollOutgoing(state, null, BASE, "melee").amount, "対象なし").toBe(BASE);
  });

  it("誓約の分岐（keystoneMore）には遠間が無い（二重に掛からない）", () => {
    const state = arena(5, { keystones: [KS.farOath] });
    const e = sturdy(state);
    expect(keystoneMore(state, e, "melee")).toEqual([]);
  });
});

describe("性質の条件の族（Modifier。docs/ideas/relics-7d-plan.md 9 章 5・6）", () => {
  it("先読み: 予備動作中の敵にだけ増が乗る", () => {
    const state = arena(5);
    applyRoll(state.stats, { key: "readAhead", value: 30 });
    const e = sturdy(state);
    e.phase = "idle";
    expect(applyModifiers(state, buildContext(e, "melee"), e).increased, "予備動作でない").toBe(0);
    e.phase = "windup";
    expect(applyModifiers(state, buildContext(e, "melee"), e).increased, "予備動作中").toBeCloseTo(0.3);
  });

  it("先制の後: 先制が起きた窓の中だけ増が乗る（その一撃の後から効く）", () => {
    const state = arena(5);
    applyRoll(state.stats, { key: "firstStrikeEdge", value: 20 });
    const e = sturdy(state);
    expect(applyModifiers(state, buildContext(e, "melee"), e).increased, "先制の前").toBe(0);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(applyModifiers(state, buildContext(e, "melee"), e).increased, "先制の後").toBeCloseTo(0.2);
    state.time += TRIGGER.trait.momentWindowSec + 1;
    expect(applyModifiers(state, buildContext(e, "melee"), e).increased, "窓の外").toBe(0);
  });

  it("コンボ 10 につき増（上限あり）", () => {
    const state = arena(5);
    applyRoll(state.stats, { key: "comboDamage", value: 5, value2: 12 });
    state.combo.count = TRIGGER.trait.comboEvery * 2;
    expect(applyModifiers(state, buildContext(null, "melee"), null).increased).toBeCloseTo(0.1);
    state.combo.count = TRIGGER.trait.comboEvery * 5;
    expect(applyModifiers(state, buildContext(null, "melee"), null).increased, "上限").toBeCloseTo(0.12);
  });
});

describe("ジョブは与ダメの倍を持たない（得意武器の倍は段取り 5c で流儀のダッシュ・気力に置き換えた）", () => {
  it("剣士の剣・狩人の長銃でも近接・射撃・見積もりは等倍", () => {
    const state = arena(5, { moveset: "sword" });
    state.job = "swordsman";
    expect(rollOutgoing(state, null, BASE, "melee").amount, "剣士の剣の近接").toBe(BASE);
    const first = PLAYER.melee[0];
    if (!first) throw new Error("近接 1 段目が無い");
    const raw = scaled(state.stats, meleeScaling(first.scaling)) + state.stats.meleeDamageFlat;
    expect(slashBase(state), "祝福の威力の見積もり").toBe(Math.round(raw));
    state.job = "hunter";
    state.stats = { ...state.stats, moveset: "longarm" };
    expect(rollOutgoing(state, null, BASE, "ranged").amount, "狩人の長銃の射撃").toBe(BASE);
    expect(collectModifiers(state).some((m) => m.owner.key.startsWith("job.")), "ジョブの Modifier が無い").toBe(false);
  });
});

describe("「〜につき」（per）", () => {
  it("コンボ 10 につき増 +2%、上限 100%", () => {
    const state = arena();
    const ctx = buildContext(null, "melee");
    const inc = (combo: number): number => {
      state.combo.count = combo;
      return applyModifiers(state, ctx, null, [COMBO_STEP]).increased;
    };
    expect(inc(0), "コンボ 0").toBe(0);
    expect(inc(9), "10 に満たない").toBe(0);
    expect(inc(25), "コンボ 25 は 2 つ分").toBeCloseTo(0.04);
    expect(inc(1000), "上限 100%").toBeCloseTo(1);
  });

  it("装備の Modifier として与ダメの増に足される", () => {
    const state = arena(5, { modifiers: [COMBO_STEP] });
    state.combo.count = 50;
    const out = rollOutgoing(state, null, BASE, "melee");
    expect(out.amount).toBe(Math.round(BASE * 1.1));
    expect(out.breakdown.increased, "Σ増").toBeCloseTo(0.1);
  });

  it("倍の「〜につき」は 1 + amount × 数（上限つき）", () => {
    const state = arena();
    state.combo.count = 30;
    const m = modifier({ amount: 0.1, per: { count: { kind: "combo" }, every: 10, cap: 0.25 } });
    const out = applyModifiers(state, buildContext(null, "melee"), null, [m]);
    expect(out.more.map((x) => x.mul), "上限で ×1.25").toEqual([1.25]);
    state.combo.count = 10;
    expect(applyModifiers(state, buildContext(null, "melee"), null, [m]).more[0]?.mul).toBeCloseTo(1.1);
  });

  it("数え方: 失った生命・撃破数・会心率・状態異常の種類・周りの敵", () => {
    const state = arena(5, { critChance: 0.25 });
    state.player.hp = state.player.maxHp * 0.65;
    state.kills = 7;
    expect(countPer(state, { kind: "missingHpTenths" }, null), "失った生命 35% は 3").toBe(3);
    expect(countPer(state, { kind: "runKills" }, null)).toBe(7);
    expect(countPer(state, { kind: "stat", stat: "critChance" }, null), "会心率 25%").toBeCloseTo(25);
    const e = sturdy(state);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 3, potency: 1 }, "player");
    applyStagger(state, e, STAGGER_TIME);
    expect(countPer(state, { kind: "targetStatusKinds" }, e), "対象の状態異常 2 種").toBe(2);
    expect(countPer(state, { kind: "targetStatusKinds" }, null), "対象なしは 0").toBe(0);
    expect(countPer(state, { kind: "nearbyEnemies", radius: 40 }, null), "周りの敵").toBe(1);
    expect(countPer(state, { kind: "chainVisits" }, null), "連鎖の外は 0").toBe(0);
  });
});

describe("タグと条件", () => {
  it("tag が 1 撃のタグに合わなければ無視する", () => {
    const state = arena(5, { modifiers: [modifier({ tag: "ranged" })] });
    expect(rollOutgoing(state, null, BASE, "melee").amount, "近接").toBe(BASE);
    expect(rollOutgoing(state, null, BASE, "ranged").amount, "射撃").toBe(Math.round(BASE * 1.5));
  });

  it("poise タグは怯み値だけに効き、与ダメには効かない", () => {
    const poise: Modifier[] = [modifier({ kind: "increased", tag: "poise", amount: 0.5 }), modifier({ id: "boon:test:2", tag: "poise", amount: 2 })];
    const state = arena(5, { modifiers: poise, increased: createIncreased() });
    const e = sturdy(state);
    expect(rollOutgoing(state, e, BASE, "melee").amount, "与ダメ").toBe(BASE);
    expect(poiseIncreasedMul(state, e), "怯み値は (1 + 0.5) × 2").toBeCloseTo(3);
  });

  it("条件を満たさなければ効かない（対象の状態異常）", () => {
    const m = modifier({ if: [{ kind: "targetHas", status: "burn" }] });
    const state = arena(5, { modifiers: [m] });
    const e = sturdy(state);
    expect(rollOutgoing(state, e, BASE, "melee").amount, "燃えていない").toBe(BASE);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 3, potency: 1 }, "player");
    expect(applyModifiers(state, buildContext(e, "melee"), e).more.map((x) => x.mul), "燃えている").toEqual([1.5]);
  });

  it("見積もり（estimateModifiers）は対象を見る Modifier を入れない", () => {
    const state = arena(5, { modifiers: [modifier({ if: [{ kind: "not", condition: { kind: "targetHas", status: "stagger" } }] }), modifier({ id: "boon:test:3", amount: 2 })] });
    expect(estimateModifiers(state, "melee").more.map((x) => x.mul)).toEqual([2]);
  });
});

describe("集め方", () => {
  it("装備 → 誓約の固定順に集める（ジョブは Modifier を持たない）", () => {
    const state = arena(5, { modifiers: [COMBO_STEP], keystones: [KS.poverty], moveset: "sword" });
    state.job = "swordsman";
    const ids = collectModifiers(state).map((m) => m.id);
    expect(ids).toEqual(["boon:test:0", "keystone:ks_poverty:0"]);
  });
});

describe("祝福の中身で足した数え方（boon-impl 2-6）", () => {
  /** 系譜を持ち融合でない札を、違う系譜から 1 枚ずつ */
  function cardOf(lineage: LineageKey): BoonKey {
    const key = BOON_KEYS.find((k) => BOONS[k].lineage === lineage && BOONS[k].fusion === undefined);
    if (key === undefined) throw new Error(`${lineage} の札が無い`);
    return key;
  }

  it("coinsLog は base 未満 0、base で 1、以後 2 倍ごとに +1", () => {
    const base = 50;
    expect([0, 49, 50, 99, 100, 199, 200, 400].map((c) => coinsLogSteps(c, base))).toEqual([0, 0, 1, 1, 2, 2, 3, 4]);
    expect(coinsLogSteps(100, 0), "base 0 は 0").toBe(0);
    const state = arena();
    state.economy.coins = 200;
    expect(countPer(state, { kind: "coinsLog", base }, null)).toBe(3);
  });

  it("lineageCards / lineagesOwned は持っている札の系譜を数える", () => {
    const state = arena();
    const ash = cardOf("ash");
    const frost = cardOf("frost");
    state.boons = [ash, frost];
    expect(countPer(state, { kind: "lineageCards", lineage: "ash" }, null)).toBe(1);
    expect(countPer(state, { kind: "lineagesOwned" }, null), "灰燼と霜枷").toBe(2);
    state.boons = [ash];
    expect(countPer(state, { kind: "lineagesOwned" }, null), "灰燼だけ").toBe(1);
  });

  it("stat の maxMana / maxHp はそのまま、comboWindow は 0.1 秒ごと", () => {
    const state = arena();
    expect(countPer(state, { kind: "stat", stat: "maxMana" }, null)).toBe(state.stats.maxMana);
    expect(countPer(state, { kind: "stat", stat: "maxHp" }, null)).toBe(state.stats.maxHp);
    expect(countPer(state, { kind: "stat", stat: "comboWindow" }, null)).toBeCloseTo((FEEL.comboWindow + state.stats.comboWindowBonus) * 10);
  });

  it("minions は設置物と味方の敵の数", () => {
    const state = arena();
    expect(countPer(state, { kind: "minions" }, null)).toBe(0);
    const e = placeEnemy(state, "slime", 20);
    e.allyUntil = state.time + 1;
    expect(countPer(state, { kind: "minions" }, null)).toBe(1);
  });

  it("targetWithin の Modifier は対象のいない 1 撃では効かず、近い敵にだけ効く", () => {
    const state = arena();
    const zone: Modifier = { id: "boon:test:zone", kind: "more", tag: "all", amount: 1.2, if: [{ kind: "targetWithin", radius: 60 }], owner: OWNER };
    const tags = { tags: new Set(["melee"] as const) };
    expect(applyModifiers(state, tags, null, [zone]).more.length, "対象なし").toBe(0);
    const near = placeEnemy(state, "slime", 20);
    const far = placeEnemy(state, "slime", 200);
    expect(applyModifiers(state, tags, near, [zone]).more[0]?.mul, "近い").toBe(1.2);
    expect(applyModifiers(state, tags, far, [zone]).more.length, "遠い").toBe(0);
  });
});
