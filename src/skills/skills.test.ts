import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { PROFILE_KEY } from "../loot/profile";
import {
  BODY_SKILL_KEYS,
  MODIFIERS,
  SKILL,
  SKILL_DEFS,
  SKILL_MIN_DEPTH,
  SKILL_WEIGHTS,
  activeModifiers,
  canAttach,
  castBurden,
  formatVariant,
  modifierLinkCost,
  modifierVerb,
  resolveCast,
} from "./data";
import { COMBOS } from "./combos";
import { generateSkillStone, skillWeight, rollRuneDrop, rollRuneModifier, runeDropChance, stoneFromSeed } from "./generator";
import {
  SKILL_PROFILE_KEY,
  addStone,
  createDefaultSkillProfile,
  equipStone,
  loadSkillProfile,
  salvageStone,
  saveSkillProfile,
} from "./persistence";
import { LEGACY_SKILL_KEYS, MODIFIER_KEYS, SKILL_KEYS, type LegacySkillKey, type ModifierKey, type SkillKey, type SkillStone } from "./types";

/** テスト用の最小 Storage */
class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function stone(skillKey: SkillKey, links: number, overrides: Partial<SkillStone> = {}): SkillStone {
  return { ...stoneFromSeed(1, { foundDepth: 1, now: 0, skillKey }), variants: [], links, ...overrides };
}

const SAMPLE_COUNT = 300;
const COOLDOWN_SKILLS = new Set<LegacySkillKey>(["parry", "bloodPact", "haste", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm"]);

describe("スキル石の生成", () => {
  it("同じ seed なら同じ石になる（決定性）", () => {
    const a = generateSkillStone(createRng(42), { foundDepth: 3, now: 1000 });
    const b = generateSkillStone(createRng(42), { foundDepth: 3, now: 1000 });
    expect(a).toEqual(b);
  });

  it("リンクは石に持たず（0）、変異軸はスキルが許す軸から重複なしで 0..2 本、値は -1..1", () => {
    const rng = createRng(7);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const s = generateSkillStone(rng, { foundDepth: 1, now: 0 });
      expect(s.links).toBe(0);
      expect(s.variants.length).toBeLessThanOrEqual(2);
      const axes = s.variants.map((v) => v.axis);
      expect(new Set(axes).size).toBe(axes.length);
      for (const v of s.variants) {
        expect(SKILL_DEFS[s.skillKey].axes).toContain(v.axis);
        expect(Math.abs(v.value)).toBeLessThanOrEqual(1);
        expect(v.value).not.toBe(0);
      }
    }
  });

  it("刻印符は装着中スキルに付けられるものだけから選ぶ", () => {
    const rng = createRng(3);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const key = rollRuneModifier(rng, ["parry", "bloodPact"]);
      expect(key).not.toBe("echo");
    }
  });
});

describe("スキルの分類（マナ型 / CD 型）", () => {
  it("手書き 45 はマナ型 36 / CD 型 9（段取り 7c で行為の列で書けるものは技へ吸収した）", () => {
    const mana = LEGACY_SKILL_KEYS.filter((k) => SKILL_DEFS[k].resource === "mana");
    expect(mana, "マナ型の数").toHaveLength(36);
    expect(LEGACY_SKILL_KEYS.length - mana.length, "CD 型の数").toBe(9);
  });

  it.each(LEGACY_SKILL_KEYS)("%s: 資源の型と負担が定義に一致する", (key) => {
    const def = SKILL_DEFS[key];
    const burden = castBurden(def, resolveCast(def, stone(key, 0), []));
    expect(def.resource, `${key} の資源型`).toBe(COOLDOWN_SKILLS.has(key) ? "cooldown" : "mana");
    expect(def.minInterval, `${key} の最低間隔`).toBeGreaterThan(0);
    expect(def.poise, `${key} の怯み値`).toBeGreaterThanOrEqual(0);
    if (def.resource === "mana") {
      expect(burden.cost, `${key} のコスト`).toBeGreaterThan(0);
      expect(burden.cooldown, `${key} はマナ型`).toBe(0);
      expect(def.charges, `${key} はチャージを使わない`).toBe(1);
    } else {
      expect(burden.cost, `${key} は CD 型`).toBe(0);
      expect(burden.cooldown, `${key} の CD`).toBeCloseTo(def.cooldown);
      expect(burden.cooldown, `${key} の CD`).toBeGreaterThan(0);
    }
  });

  it("付与: 既存 5 種と第 2 弾（濡れ・油膜・烙印・彩痕・宣告）の表どおり。他は付与なし", () => {
    const kinds = (key: SkillKey): string[] => (SKILL_DEFS[key].applies ?? []).map((a) => `${a.kind}:${a.stacks}`);
    const table: Partial<Record<SkillKey, string[]>> = {
      gravityWell: ["silence:1"],
      chainHook: ["bleed:1"],
      powderKeg: ["burn:1"],
      iceBreaker: ["chill:2"],
      verdict: ["silence:1"],
      waterJar: ["wet:2"],
      oilPot: ["oiled:1"],
      brandSear: ["brand:2"],
      hueEtch: ["hue:1"],
      doomSentence: ["doom:1"],
    };
    for (const key of LEGACY_SKILL_KEYS) {
      const want = table[key];
      if (want) expect(kinds(key), key).toEqual(want);
      else expect(SKILL_DEFS[key].applies, `${key} に付与がある`).toBeUndefined();
    }
  });

  it("アイコンは 1 文字で重複しない", () => {
    const icons = LEGACY_SKILL_KEYS.map((k) => SKILL_DEFS[k].icon);
    for (const icon of icons) expect([...icon], icon).toHaveLength(1);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("resolveCast", () => {
  it("リンクは負担に効かない（石の links を変えても基本のコスト / CD のまま）。CD 型はコスト 0", () => {
    const grudge = SKILL_DEFS.grudge;
    for (const links of [0, 1, 2, 3]) {
      expect(castBurden(grudge, resolveCast(grudge, stone("grudge", links), [])).cost, `links ${links}`).toBeCloseTo(SKILL.grudge.cost);
    }
    const lunge = SKILL_DEFS.commonLunge;
    const cd = castBurden(lunge, resolveCast(lunge, stone("commonLunge", 2), []));
    expect(cd.cooldown).toBeCloseTo(SKILL_DEFS.commonLunge.cooldown);
    expect(cd.cost, "CD 型はコスト 0").toBe(0);
  });

  it("変異は得失が釣り合う（範囲 x1.4 なら威力 x0.7）", () => {
    const p = resolveCast(SKILL_DEFS.grudge, stone("grudge", 0, { variants: [{ axis: "areaVsDamage", value: 1 }] }), []);
    expect(p.areaMul).toBeCloseTo(1.4);
    expect(p.damageMul).toBeCloseTo(0.7);
  });

  it("スキルに無い変異軸は無視する", () => {
    const p = resolveCast(SKILL_DEFS.bloodPact, stone("bloodPact", 0, { variants: [{ axis: "areaVsDamage", value: 1 }] }), []);
    expect(p.areaMul).toBe(1);
    expect(p.damageMul).toBe(1);
  });

  it("修飾子はスロットのリンク数まで・付けられるものだけ効く（リンク 2 本のスロット 4 では 3 枚目は効かない）", () => {
    const def = SKILL_DEFS.grudge;
    const mods: ModifierKey[] = ["focus", "streak", "echo"];
    const p = resolveCast(def, stone("grudge", 0), mods, 3);
    expect(p.areaMul, "1 枚目は効く").toBeCloseTo(SKILL.modifier.focus.areaMul);
    expect(p.streak, "2 枚目までは効く").toBe(true);
    expect(p.echo, "3 枚目は 2 本に収まらず効かない").toBeNull();
    expect(resolveCast(def, stone("grudge", 0), mods, 0).echo, "リンク 4 本のスロット 1 なら効く").not.toBeNull();
    expect(activeModifiers(SKILL_DEFS.parry, 3, ["echo", "offering"])).toEqual(["offering"]);
  });

  it("反響は defense / buff に付かない", () => {
    expect(canAttach(SKILL_DEFS.parry, "echo")).toBe(false);
    expect(canAttach(SKILL_DEFS.bloodPact, "echo")).toBe(false);
    expect(canAttach(SKILL_DEFS.grudge, "echo")).toBe(true);
  });

  it("修飾子 2 個の組み合わせ（収束 + 巡り）", () => {
    const p = resolveCast(SKILL_DEFS.grudge, stone("grudge", 2), ["focus", "refund"]);
    const m = SKILL.modifier;
    expect(p.damageMul).toBeCloseTo(m.focus.damageMul * m.refund.damageMul);
    expect(p.areaMul).toBeCloseTo(m.focus.areaMul);
    expect(p.refundPerHit).toBeCloseTo(m.refund.perHit);
  });

  it("反響・分身・地形化は負担に掛かる（マナ型ならコスト、CD 型なら再使用）", () => {
    const m = SKILL.modifier;
    const echo = resolveCast(SKILL_DEFS.mines, stone("mines", 1), ["echo"]);
    expect(castBurden(SKILL_DEFS.mines, echo).cost).toBeCloseTo(SKILL.mines.cost * m.echo.burdenMul);
    const ghost = resolveCast(SKILL_DEFS.commonLunge, stone("commonLunge", 1), ["ghost"]);
    expect(castBurden(SKILL_DEFS.commonLunge, ghost).cooldown).toBeCloseTo(SKILL_DEFS.commonLunge.cooldown * m.ghost.burdenMul);
    const ley = resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["leyline"]);
    expect(castBurden(SKILL_DEFS.grudge, ley).cost).toBeCloseTo(SKILL.grudge.cost * m.leyline.burdenMul);
  });

  it("刻印符の説明はマナ型で読み替えたものを出す", () => {
    expect(modifierVerb("echo", SKILL_DEFS.mines)).toBe(MODIFIERS.echo.manaVerb);
    expect(modifierVerb("echo", SKILL_DEFS.commonLunge)).toBe(MODIFIERS.echo.verb);
    expect(modifierVerb("pierce", SKILL_DEFS.rout), "読み替えの無いものは verb のまま").toBe(MODIFIERS.pierce.verb);
  });

  it("全スキル・全修飾子に定義がある。刻印符は 30（変形 20・循環 10）", () => {
    for (const key of LEGACY_SKILL_KEYS) expect(SKILL_DEFS[key].key).toBe(key);
    expect(LEGACY_SKILL_KEYS).toHaveLength(45);
    expect(SKILL_KEYS, "手書き 45 + 共通技 60").toHaveLength(105);
    expect(Object.keys(COMBOS), "連携は 14").toHaveLength(14);
    expect(Object.keys(MODIFIERS)).toEqual([...MODIFIER_KEYS]);
    expect(MODIFIER_KEYS).toHaveLength(30);
    for (const key of MODIFIER_KEYS) expect(MODIFIERS[key].key).toBe(key);
    const family = (f: string): number => MODIFIER_KEYS.filter((k) => MODIFIERS[k].family === f).length;
    expect(family("shape"), "変形").toBe(20);
    expect(family("cycle"), "循環").toBe(10);
  });

  it("新スキルの変異軸は 2〜3 本で、すべて得失が効くパラメータを持つ", () => {
    const added: SkillKey[] = ["gravityWell", "mines", "haste", "chainHook", "frostField"];
    for (const key of added) {
      const def = SKILL_DEFS[key];
      expect(def.axes.length).toBeGreaterThanOrEqual(2);
      expect(def.axes.length).toBeLessThanOrEqual(3);
      // buff は威力を持たないので Damage 側の軸を持たない
      if (def.damageKind === "none") for (const a of def.axes) expect(a.endsWith("Potency")).toBe(true);
    }
  });

  it("cooldownVsPotency: 負担 x0.7 なら効果量 x0.75", () => {
    const p = resolveCast(SKILL_DEFS.haste, stone("haste", 0, { variants: [{ axis: "cooldownVsPotency", value: 1 }] }), []);
    expect(p.burdenMul).toBeCloseTo(0.7);
    expect(p.potencyMul).toBeCloseTo(0.75);
    expect(formatVariant({ axis: "cooldownVsPotency", value: 1 }, SKILL_DEFS.haste)).toBe("再使用 -30% / 効果量 -25%");
  });

  it("負担の変異軸の表示はマナ型で「コスト」、CD 型で「CD」", () => {
    const roll = { axis: "cooldownVsDamage", value: 1 } as const;
    expect(formatVariant(roll, SKILL_DEFS.grudge)).toBe("コスト -30% / ダメージ -25%");
    expect(formatVariant(roll, SKILL_DEFS.commonLunge)).toBe("再使用 -30% / ダメージ -25%");
  });

  it("刻印符の効果（貫き・遅延・収束・分身・連鎖・爆ぜ）", () => {
    const m = SKILL.modifier;
    const rout = resolveCast(SKILL_DEFS.rout, stone("rout", 1), ["pierce"]);
    expect(rout.pierce).toBe(m.pierce.count);
    const delay = resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["delay"]);
    expect(delay.delay).toEqual({ time: m.delay.time, damageMul: m.delay.damageMul });
    const focus = resolveCast(SKILL_DEFS.frostField, stone("frostField", 1), ["focus"]);
    expect(focus.areaMul).toBeCloseTo(m.focus.areaMul);
    expect(focus.damageMul).toBeCloseTo(m.focus.damageMul);
    const ghost = resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["ghost"]);
    expect(ghost.ghost).toEqual({ delay: m.ghost.delay, damageMul: m.ghost.damageMul });
    expect(resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["chain"]).chain).toBe(true);
    expect(resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["burst"]).burst).toBe(true);
  });

  it("溜め: resolveCast 自体は素通し（実際の倍率は発動時に system/skills.ts が掛ける）", () => {
    const p = resolveCast(SKILL_DEFS.mines, stone("mines", 1), ["charge"]);
    expect(p.damageMul).toBe(1);
    expect(p.areaMul).toBe(1);
  });
});

describe("刻印符の型替え・循環（resolveCast）", () => {
  const m = SKILL.modifier;

  it("型替え符はリンクを 2 本使い、1 スロットに 1 枚まで", () => {
    expect(modifierLinkCost("toTarget")).toBe(2);
    expect(modifierLinkCost("focus")).toBe(1);
    expect(activeModifiers(SKILL_DEFS.exploit, 1, ["toTarget"]), "リンク 1 では効かない").toEqual([]);
    expect(activeModifiers(SKILL_DEFS.exploit, 4, ["toTarget", "linger"]), "2 枚目の型替え符は効かない").toEqual(["toTarget"]);
    expect(activeModifiers(SKILL_DEFS.exploit, 3, ["focus", "toTarget"]), "1 + 2 = 3 本").toEqual(["focus", "toTarget"]);
    expect(activeModifiers(SKILL_DEFS.exploit, 2, ["focus", "toTarget"]), "残り 1 本には入らない").toEqual(["focus"]);
  });

  it("旋回と戻り刃は同時に効かない（古い方が効く）", () => {
    expect(activeModifiers(SKILL_DEFS.commonKnifeFan, 3, ["recall", "orbit"])).toEqual(["recall"]);
  });

  it("循環の刻印符は旗を立てる（実際の倍率は発動時に system/skills.ts が読む）", () => {
    const p = resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["bloodPrice", "spillover", "streak", "overheat"]);
    expect([p.bloodPrice, p.spillover, p.streak, p.overheat]).toEqual([true, true, true, true]);
    const q = resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["patience", "sympathy", "desperate", "offering"]);
    expect([q.patience, q.sympathy, q.desperate, q.offering]).toEqual([true, true, true, true]);
    expect(resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["ledger"]).ledger).toBe(true);
    const refund = resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["refund"]);
    expect(refund.refundPerHit).toBeCloseTo(m.refund.perHit);
    expect(refund.damageMul).toBeCloseTo(m.refund.damageMul);
  });

  it("手繰りはノックバックの倍率を負にする（向きを反転する印）", () => {
    const p = resolveCast(SKILL_DEFS.grudge, stone("grudge", 1), ["tether"]);
    expect(p.knockbackMul).toBeLessThan(0);
  });

  it("照準起点: 手書きの置くものは投げ込み（持続・発動時間を縮めて威力を上げる）、近接は投げ刃、技は行為の列の transform", () => {
    const l = m.toTarget.lobbed;
    const lobbed = resolveCast(SKILL_DEFS.gravityWell, stone("gravityWell", 2), ["toTarget"]);
    expect(lobbed.reshape).toBe("toLobbed");
    expect(lobbed.durationMul).toBeCloseTo(l.durationMul);
    expect(lobbed.damageMul).toBeCloseTo(l.damageMul);
    expect(resolveCast(SKILL_DEFS.exploit, stone("exploit", 2), ["toTarget"]).reshape).toBe("toThrown");
    const art = resolveCast(SKILL_DEFS.commonWhirl, stone("commonWhirl", 2), ["toTarget"]);
    expect(art.reshape, "技は型替えにしない").toBeNull();
    expect(art.artTransforms).toEqual(["toTarget"]);
  });

  it("据え置きは手書きにも技にも型替え（罠）として効く", () => {
    expect(resolveCast(SKILL_DEFS.exploit, stone("exploit", 2), ["linger"]).reshape).toBe("toTrap");
    expect(resolveCast(SKILL_DEFS.commonWhirl, stone("commonWhirl", 2), ["linger"]).reshape).toBe("toTrap");
  });

  it("背水・分身の説明はマナ型で読み替える", () => {
    expect(modifierVerb("desperate", SKILL_DEFS.grudge)).toContain("コスト");
    expect(modifierVerb("desperate", SKILL_DEFS.commonLunge)).toContain("再使用時間");
    expect(modifierVerb("ghost", SKILL_DEFS.grudge)).toContain("コスト");
  });
});

describe("相性表", () => {
  /**
   * 付けられない組み合わせ（これ以外はすべて付く）。行為の列を変える符（分裂・旋回・重ね打ち・戻り刃・軌跡）は
   * 技にだけ付くので手書きのスキルには付かない（段取り 7c。docs/ideas/skills-7c-plan.md 4 章）
   */
  const FORBIDDEN: Record<ModifierKey, readonly LegacySkillKey[]> = {
    delay: ["parry", "bloodPact", "haste", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    echo: ["parry", "bloodPact", "haste", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    charge: ["parry", "bloodPact", "haste", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    pierce: ["parry", "bloodPact", "gravityWell", "mines", "haste", "frostField", "contagion", "kindle", "powderKeg", "swordGrave", "iceBreaker", "bloodlet", "discharge", "verdict", "exploit", "lastStand", "comboChain", "grudge", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "levelGround", "brandSear", "brandBlast", "flashFreeze", "hueEtch", "hueRelease", "doomSentence", "shiftingEdge", "wardStake", "mire", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    tether: ["bloodPact", "haste", "contagion", "backflow", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    focus: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    ghost: ["parry", "bloodPact", "haste", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    chain: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    burst: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    leyline: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    bloodPrice: ["parry", "bloodPact", "haste", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm"],
    spillover: ["parry", "bloodPact", "haste", "contagion", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    streak: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    refund: ["parry", "bloodPact", "haste", "contagion", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    overheat: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    patience: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    sympathy: ["bloodPact", "haste", "contagion", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    desperate: ["lastStand"],
    offering: [],
    ledger: [],
    split: LEGACY_SKILL_KEYS,
    orbit: LEGACY_SKILL_KEYS,
    tripleHit: LEGACY_SKILL_KEYS,
    recall: LEGACY_SKILL_KEYS,
    trail: LEGACY_SKILL_KEYS,
    toTarget: ["parry", "bloodPact", "haste", "contagion", "unravel", "kindle", "bloodlet", "harvest", "discharge", "rout", "strip", "grudge", "backflow", "scarRoar", "manaSpring", "levelGround", "emberDraw", "brandBlast", "flashFreeze", "hueRelease", "doomSentence", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    toNova: ["parry", "bloodPact", "mines", "haste", "chainHook", "contagion", "unravel", "kindle", "iceBreaker", "bloodlet", "harvest", "discharge", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "grudge", "backflow", "scarRoar", "manaSpring", "levelGround", "emberDraw", "brandSear", "brandBlast", "flashFreeze", "hueEtch", "hueRelease", "doomSentence", "shiftingEdge", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    linger: ["parry", "bloodPact", "gravityWell", "mines", "haste", "frostField", "contagion", "kindle", "powderKeg", "swordGrave", "bloodlet", "discharge", "grudge", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "levelGround", "brandBlast", "flashFreeze", "hueRelease", "doomSentence", "wardStake", "mire", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    autoFinisher: ["wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    autoRiposte: ["wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
  };

  it("全スキル x 全刻印符が表どおり", () => {
    for (const mod of MODIFIER_KEYS) {
      for (const key of LEGACY_SKILL_KEYS) {
        expect({ mod, key, ok: canAttach(SKILL_DEFS[key], mod) }).toEqual({ mod, key, ok: !FORBIDDEN[mod].includes(key) });
      }
    }
  });

  it("どのスキルにも付く刻印符が 3 つ以上ある（拾っても死に札になりにくい）", () => {
    for (const key of LEGACY_SKILL_KEYS) {
      expect(MODIFIER_KEYS.filter((m) => canAttach(SKILL_DEFS[key], m)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("付けられない刻印符はリンクがあっても効かない", () => {
    const p = resolveCast(SKILL_DEFS.exploit, stone("exploit", 2), ["pierce", "split"]);
    expect(p.pierce).toBe(0);
    expect(p.artTransforms).toEqual([]);
  });
});

describe("同時発動の排他グループ", () => {
  it("SKILL.gcd（全スロット共通の最低間隔）は無い", () => {
    expect("gcd" in SKILL, "共通最低間隔の定数は廃止").toBe(false);
  });

  it("body は BODY_SKILL_KEYS のスキルだけに付き、ほかは省略（並行して撃てる）", () => {
    for (const key of LEGACY_SKILL_KEYS) {
      const expected = BODY_SKILL_KEYS.includes(key) ? "body" : undefined;
      expect(SKILL_DEFS[key].exclusiveGroup, key).toBe(expected);
    }
  });

  it("構え・鎖・連続突きの本動作は body、設置・強化・一瞬の技は body でない", () => {
    for (const key of ["parry", "chainHook", "comboChain"] as const) {
      expect(SKILL_DEFS[key].exclusiveGroup, `${key} は本動作`).toBe("body");
    }
    for (const key of ["mines", "powderKeg", "haste", "bloodPact", "turret", "exploit"] as const) {
      expect(SKILL_DEFS[key].exclusiveGroup, `${key} は並行可`).toBeUndefined();
    }
  });
});

describe("刻印符のドロップ（rollRuneDrop）", () => {
  it("エリート・ボス・図書館・巣窟は通常の敵より出やすく、通常の敵は深度で少し増える（上限あり）", () => {
    const normal = runeDropChance(1, "normal");
    for (const source of ["elite", "boss", "library", "nest"] as const) {
      expect(runeDropChance(1, source), source).toBeGreaterThan(normal);
    }
    expect(runeDropChance(10, "normal"), "深いほど増える").toBeGreaterThan(normal);
    expect(runeDropChance(1000, "normal"), "上限").toBeCloseTo(SKILL.drop.runeOnKill.normal + SKILL.drop.runeOnKillDepthCap);
  });

  it("確率 1 なら装着中スキルに付けられる種類が出て、0 なら null。外れでも乱数は 1 回だけ引く", () => {
    const hit = rollRuneDrop({ ...createRng(3), chance: () => true }, 1, "boss", ["mines"]);
    expect(hit).not.toBeNull();
    if (hit) expect(canAttach(SKILL_DEFS.mines, hit)).toBe(true);
    let calls = 0;
    const rng = createRng(3);
    const counted = { ...rng, chance: (p: number) => (calls++, rng.chance(0 * p)) };
    expect(rollRuneDrop(counted, 1, "normal")).toBeNull();
    expect(calls).toBe(1);
  });

  it("同じ seed なら同じ結果（決定性）", () => {
    const a = Array.from({ length: 50 }, (_, i) => rollRuneDrop(createRng(i), 5, "elite"));
    const b = Array.from({ length: 50 }, (_, i) => rollRuneDrop(createRng(i), 5, "elite"));
    expect(a).toEqual(b);
  });
});

describe("生成の重み", () => {
  it("深い層では手書きの 45 種がすべて出る。重みに沿って最小実装からの 7 種がやや多い", () => {
    const rng = createRng(123);
    const counts = new Map<SkillKey, number>();
    const n = 24000;
    for (let i = 0; i < n; i++) {
      const s = generateSkillStone(rng, { foundDepth: 5, now: 0 });
      counts.set(s.skillKey, (counts.get(s.skillKey) ?? 0) + 1);
    }
    for (const key of LEGACY_SKILL_KEYS) expect(counts.get(key) ?? 0).toBeGreaterThan(0);
    const total = SKILL_KEYS.reduce((sum, k) => sum + skillWeight(k, undefined), 0);
    for (const key of LEGACY_SKILL_KEYS) {
      const expected = (SKILL_WEIGHTS[key] / total) * n;
      expect(Math.abs((counts.get(key) ?? 0) - expected)).toBeLessThan(expected * 0.25);
    }
  });

  it("浅い層では SKILL_MIN_DEPTH より深いスキルが出ない", () => {
    const rng = createRng(77);
    for (let i = 0; i < SAMPLE_COUNT * 3; i++) {
      const s = generateSkillStone(rng, { foundDepth: 1, now: 0 });
      expect(SKILL_MIN_DEPTH[s.skillKey], s.skillKey).toBeLessThanOrEqual(1);
    }
  });

  it("新スキルの石も seed から決定的（変異軸はそのスキルの軸だけ）", () => {
    for (const key of ["chainHook", "haste", "frostField"] as const) {
      const a = stoneFromSeed(77, { foundDepth: 2, now: 5, skillKey: key });
      expect(stoneFromSeed(77, { foundDepth: 2, now: 5, skillKey: key })).toEqual(a);
      for (const v of a.variants) expect(SKILL_DEFS[key].axes).toContain(v.axis);
    }
  });

  it("初期プロフィールは旋風斬り + 炸裂玉（段取り 7c で手書きから技へ写した）", () => {
    expect(createDefaultSkillProfile().stones.map((s) => s.skillKey)).toEqual(["commonWhirl", "commonBomb"]);
  });

  it("刻印符の抽選は装着スキルに付くものだけ（加速 + 血の契約なら背水・捧げ・帳・連動 2 種だけ）", () => {
    const rng = createRng(4);
    const seen = new Set<ModifierKey>();
    for (let i = 0; i < SAMPLE_COUNT; i++) seen.add(rollRuneModifier(rng, ["haste", "bloodPact"]));
    expect([...seen].sort()).toEqual(["autoFinisher", "autoRiposte", "desperate", "ledger", "offering"]);
  });

  it("型替え符は通常の刻印符より出にくい", () => {
    const rng = createRng(8);
    const counts = new Map<ModifierKey, number>();
    for (let i = 0; i < 20000; i++) {
      const k = rollRuneModifier(rng, ["exploit"]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.get("toTarget") ?? 0, "照準起点も出る").toBeGreaterThan(0);
    expect(counts.get("toTarget") ?? 0, "型替え符は通常の半分未満").toBeLessThan((counts.get("focus") ?? 0) / 2);
  });
});

describe("スキル石の永続化", () => {
  it("round-trip で同じ内容が戻る", () => {
    const storage = new MemoryStorage();
    const profile = createDefaultSkillProfile();
    const extra = generateSkillStone(createRng(9), { foundDepth: 4, now: 123 });
    expect(addStone(profile, extra)).toBe(true);
    equipStone(profile, extra.id, 1);
    saveSkillProfile(profile, storage);
    expect(loadSkillProfile(storage)).toEqual(profile);
  });

  it("壊れた JSON・version 違いは初期プロフィール（旋風斬りと炸裂玉を装着）", () => {
    const storage = new MemoryStorage();
    storage.setItem(SKILL_PROFILE_KEY, "{broken");
    const a = loadSkillProfile(storage);
    expect(a.stones.map((s) => s.skillKey)).toEqual(["commonWhirl", "commonBomb"]);
    expect(a.loadout).toEqual([...a.stones.map((s) => s.id), null, null]);
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 99, stones: [], loadout: [] }));
    expect(loadSkillProfile(storage)).toEqual(createDefaultSkillProfile());
  });

  it("壊れた石は捨て、loadout の不正な id は空にする", () => {
    const storage = new MemoryStorage();
    const good = stone("commonLunge", 2, { id: "good" });
    storage.setItem(
      SKILL_PROFILE_KEY,
      JSON.stringify({ version: 1, loadout: ["missing", "good"], stones: [good, { id: "bad", skillKey: "nope" }] }),
    );
    const loaded = loadSkillProfile(storage);
    expect(loaded.stones, "石の links は読まないので 0").toEqual([{ ...good, links: 0 }]);
    expect(loaded.loadout).toEqual([null, "good", null, null]);
  });

  it("旧 2 スロットの loadout は 4 スロットに null で埋まる（装着はそのまま）", () => {
    const storage = new MemoryStorage();
    const a = stone("commonWhirl", 1, { id: "a" });
    const b = stone("commonBomb", 1, { id: "b" });
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["a", "b"], stones: [a, b] }));
    const loaded = loadSkillProfile(storage);
    expect(loaded.loadout, "2 要素が 4 要素に").toEqual(["a", "b", null, null]);
    expect(loaded.loadout).toHaveLength(SKILL.slots);
    expect(equipStone(loaded, "a", 3), "新しいスロット 4 にも装着できる").toBe(true);
    expect(loaded.loadout).toEqual([null, "b", null, "a"]);
  });

  it("初期プロフィールも 4 スロット（3 / 4 は空）", () => {
    const profile = createDefaultSkillProfile();
    expect(profile.loadout).toHaveLength(SKILL.slots);
    expect(profile.loadout.slice(2)).toEqual([null, null]);
  });

  it("装備プロフィール（roguelike.profile.v1）には触れない", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, "equipment");
    saveSkillProfile(createDefaultSkillProfile(), storage);
    expect(storage.getItem(PROFILE_KEY)).toBe("equipment");
    expect(storage.length).toBe(2);
  });

  it("分解すると装着も外れる", () => {
    const profile = createDefaultSkillProfile();
    const id = profile.loadout[0];
    if (!id) throw new Error("starter missing");
    expect(salvageStone(profile, id)).toBe(true);
    expect(profile.loadout[0]).toBeNull();
    expect(profile.stones.some((s) => s.id === id)).toBe(false);
  });
});
