import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Attributes } from "../loot/types";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { BOON, PLAYER, STATUS } from "../data/tuning";
import { scaled } from "./attributes";
import {
  BOONS,
  boonAttackManaMul,
  boonNormalAttackBonus,
  boonWeight,
  createBoonRunState,
  equipmentTags,
  foldBoonStats,
  grantBoon,
  onBoonShatter,
  rollBoonOptions,
  updateBoons,
} from "./boons";
import { damageEnemy } from "./combat";
import { applyStagger } from "./poise";
import { applyStatus, findStatus, hasStatus, statusStacks } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

const HUGE = 100_000;

function withEff(eff: Partial<Attributes>): PlayerStats {
  return { ...DEFAULT_STATS, attributesEff: { ...DEFAULT_STATS.attributesEff, ...eff } };
}

describe("祝福（ステータス）: 偏重 lopsided", () => {
  it("最も高い実効値が 1.25 倍、最も低いものが 0 になる", () => {
    const out = foldBoonStats(withEff({ str: 20, spi: 3 }), ["lopsided"], createBoonRunState());
    expect(out.attributesEff.str).toBeCloseTo(20 * BOON.lopsidedHighMul);
    expect(out.attributesEff.spi, "最低は 0").toBe(0);
    expect(out.attributesEff.dex, "中間はそのまま").toBe(5);
  });

  it("全部同じなら偏りが無いので何も変えない（基礎値のままのラン開始で壊れない）", () => {
    const out = foldBoonStats(DEFAULT_STATS, ["lopsided"], createBoonRunState());
    expect(out.attributesEff).toEqual(DEFAULT_STATS.attributesEff);
  });

  it("入力の stats は書き換えない", () => {
    const input = withEff({ str: 20, spi: 3 });
    foldBoonStats(input, ["lopsided"], createBoonRunState());
    expect(input.attributesEff.str).toBe(20);
    expect(input.attributesEff.spi).toBe(3);
  });

  it("ステータスの性質が無い装備には出ない（requires attr）", () => {
    expect(boonWeight(BOONS.lopsided, equipmentTags(DEFAULT_STATS), [])).toBe(0);
    const tags = equipmentTags({ ...DEFAULT_STATS, attributes: { ...DEFAULT_STATS.attributes, dex: 12 } });
    expect(boonWeight(BOONS.lopsided, tags, [])).toBeGreaterThan(0);
  });
});

describe("祝福（ステータス）: 持ち替え swapHands", () => {
  it("筋力と技巧の実効値を入れ替え、近接は技巧で伸びる", () => {
    const stats = withEff({ str: 5, dex: 15 });
    const out = foldBoonStats(stats, ["swapHands"], createBoonRunState());
    expect(out.attributesEff.str).toBe(15);
    expect(out.attributesEff.dex).toBe(5);
    expect(scaled(out, PLAYER.melee[0].scaling), "近接が技巧 15 で伸びる").toBeCloseTo(scaled(withEff({ str: 15 }), PLAYER.melee[0].scaling));
    expect(scaled(out, PLAYER.shoot.scaling), "射撃は筋力 5 で決まる").toBeCloseTo(scaled(withEff({ dex: 5 }), PLAYER.shoot.scaling));
  });

  it("派生（移動・怯み値倍率）は元のステータスのまま", () => {
    const stats = { ...withEff({ str: 5, dex: 15 }), moveSpeedMul: 1.05, poiseDamageMul: 1 };
    const out = foldBoonStats(stats, ["swapHands"], createBoonRunState());
    expect(out.moveSpeedMul).toBe(1.05);
    expect(out.poiseDamageMul).toBe(1);
  });

  it("持ち替え → 偏重 の順に畳み込む", () => {
    const out = foldBoonStats(withEff({ str: 5, dex: 15, spi: 2 }), ["lopsided", "swapHands"], createBoonRunState());
    expect(out.attributesEff.str, "入れ替え後の最高（筋力側）が伸びる").toBeCloseTo(15 * BOON.lopsidedHighMul);
    expect(out.attributesEff.spi).toBe(0);
  });
});

describe("祝福（ステータス）: 霊刃 spiritBlade", () => {
  it("通常攻撃に霊力 × 0.3 が加わり、通常攻撃のマナ回収が半分になる", () => {
    const state = arena(5, { attributesEff: { ...DEFAULT_STATS.attributesEff, spi: 10 } });
    expect(boonNormalAttackBonus(state)).toBe(0);
    expect(boonAttackManaMul(state)).toBe(1);
    state.boons.push("spiritBlade");
    expect(boonNormalAttackBonus(state)).toBeCloseTo(BOON.spiritBladeSpi * 10);
    expect(boonAttackManaMul(state)).toBe(BOON.spiritBladeManaMul);
  });
});

describe("祝福（状態異常）: 疫病 plague", () => {
  function setup(withBoon: boolean) {
    const state = arena(7);
    const dying = placeEnemy(state, "golem", 30, 0);
    const near = placeEnemy(state, "golem", 30, 20);
    const far = placeEnemy(state, "golem", 30 + BOON.plagueRadius * 3, 0);
    if (withBoon) state.boons.push("plague");
    applyStatus(state, { kind: "enemy", enemy: dying }, { kind: "poison", stacks: 3, duration: STATUS.poison.duration, potency: 0 }, "player");
    damageEnemy(state, dying, HUGE, { x: 1, y: 0 }, 0);
    return { state, near, far };
  }

  it("毒の敵が死ぬと、半径内の敵に同じスタック数の毒を引き継ぐ", () => {
    const { near, far } = setup(true);
    expect(statusStacks(near.status, "poison")).toBe(3);
    expect(hasStatus(far.status, "poison"), "半径外には届かない").toBe(false);
  });

  it("祝福が無ければ引き継がない", () => {
    const { near } = setup(false);
    expect(hasStatus(near.status, "poison")).toBe(false);
  });

  it("毒の性質が無い装備には出ない（requires poison）", () => {
    expect(boonWeight(BOONS.plague, equipmentTags(DEFAULT_STATS), [])).toBe(0);
    const stats: PlayerStats = {
      ...DEFAULT_STATS,
      statusProcs: [{ kind: "poison", chance: 0.2, stacks: 1, duration: 5, potency: 0, on: "any" }],
    };
    expect(equipmentTags(stats).has("poison")).toBe(true);
    expect(boonWeight(BOONS.plague, equipmentTags(stats), [])).toBeGreaterThan(0);
  });
});

describe("祝福（状態異常）: 血煙 bloodMist", () => {
  it("出血の敵を倒すと、自分の出血が消えて HP が回復する", () => {
    const state = arena(7);
    state.boons.push("bloodMist");
    state.player.hp = 50;
    applyStatus(state, { kind: "player" }, { kind: "bleed", stacks: 1, duration: STATUS.bleed.duration, potency: 1 }, "enemy");
    expect(hasStatus(state.player.status, "bleed")).toBe(true);
    const e = placeEnemy(state, "slime", 30);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "bleed", stacks: 1, duration: STATUS.bleed.duration, potency: 1 }, "player");
    damageEnemy(state, e, HUGE, { x: 1, y: 0 }, 0);
    expect(hasStatus(state.player.status, "bleed"), "自分の出血が消える").toBe(false);
    expect(state.player.hp).toBe(50 + BOON.bloodMistHeal);
  });

  it("出血していない敵を倒しても何も起きない", () => {
    const state = arena(7);
    state.boons.push("bloodMist");
    state.player.hp = 50;
    const e = placeEnemy(state, "slime", 30);
    damageEnemy(state, e, HUGE, { x: 1, y: 0 }, 0);
    expect(state.player.hp).toBe(50);
  });
});

describe("祝福（状態異常）: 崩し crumble", () => {
  it("怯ませた敵に脆弱が付き、同じ怯みの間は 1 度だけ", () => {
    const state = arena(7);
    grantBoon(state, "crumble");
    const e = placeEnemy(state, "golem", 30);
    applyStagger(state, e, 0.5);
    updateBoons(state, FIXED_DT);
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
    // 脆弱を外しても、同じ怯みの間は付け直さない
    e.status.effects = e.status.effects.filter((s) => s.kind !== "vulnerable");
    updateBoons(state, FIXED_DT);
    expect(hasStatus(e.status, "vulnerable")).toBe(false);
  });

  it("自傷の怯み（壁激突）には付かない", () => {
    const state = arena(7);
    grantBoon(state, "crumble");
    const e = placeEnemy(state, "boar", 30);
    applyStagger(state, e, 0.5, { selfInflicted: true });
    updateBoons(state, FIXED_DT);
    expect(hasStatus(e.status, "vulnerable")).toBe(false);
  });

  it("祝福が無ければ付かない", () => {
    const state = arena(7);
    const e = placeEnemy(state, "golem", 30);
    applyStagger(state, e, 0.5);
    updateBoons(state, FIXED_DT);
    expect(hasStatus(e.status, "vulnerable")).toBe(false);
  });
});

describe("祝福（状態異常）: 凍て刺し frostPierce", () => {
  it("砕きで周囲の敵に冷気 2 を重ねる（本人と半径外は除く）", () => {
    const state = arena(7);
    state.boons.push("frostPierce");
    const shattered = placeEnemy(state, "golem", 30, 0);
    const near = placeEnemy(state, "golem", 30, 20);
    const far = placeEnemy(state, "golem", 30 + BOON.frostPierceRadius * 3, 0);
    onBoonShatter(state, shattered);
    expect(statusStacks(near.status, "chill")).toBe(BOON.frostPierceStacks);
    expect(hasStatus(far.status, "chill")).toBe(false);
    expect(hasStatus(shattered.status, "chill")).toBe(false);
  });

  it("祝福が無ければ何もしない", () => {
    const state = arena(7);
    const shattered = placeEnemy(state, "golem", 30, 0);
    const near = placeEnemy(state, "golem", 30, 20);
    onBoonShatter(state, shattered);
    expect(findStatus(near.status, "chill")).toBeUndefined();
  });
});

describe("装備タグと抽選", () => {
  it("筋力の性質は attr と stagger、出血の proc は bleed のタグになる", () => {
    const tags = equipmentTags({
      ...DEFAULT_STATS,
      attributes: { ...DEFAULT_STATS.attributes, str: 9 },
      statusProcs: [{ kind: "bleed", chance: 0.2, stacks: 1, duration: 4, potency: 1, on: "melee" }],
    });
    expect(tags.has("attr")).toBe(true);
    expect(tags.has("stagger")).toBe(true);
    expect(tags.has("bleed")).toBe(true);
    expect(tags.has("poison")).toBe(false);
  });

  it("タグが一致すると重みが上がる（崩しは stagger で上がる）", () => {
    const base = boonWeight(BOONS.crumble, equipmentTags(DEFAULT_STATS), []);
    const tagged = boonWeight(BOONS.crumble, equipmentTags({ ...DEFAULT_STATS, poiseDamageMul: 1.2 }), []);
    expect(tagged).toBeGreaterThan(base);
  });

  it("同じ seed なら新しい祝福を含む抽選も同じ結果", () => {
    const procs: PlayerStats["statusProcs"] = [
      { kind: "poison", chance: 0.2, stacks: 1, duration: 5, potency: 0, on: "any" },
      { kind: "bleed", chance: 0.2, stacks: 1, duration: 4, potency: 1, on: "any" },
    ];
    const roll = (): string[][] => {
      const state = createGame(42);
      state.stats = { ...state.stats, statusProcs: procs, attributes: { ...state.stats.attributes, spi: 12 } };
      return Array.from({ length: 5 }, () => rollBoonOptions(state));
    };
    expect(roll()).toEqual(roll());
  });
});
