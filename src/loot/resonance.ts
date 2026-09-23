import { isTriggerKey } from "./triggers";
import { OPPOSITE_COLOR, traitColorOf } from "./colors";
import { ATTR_GAIN, KEYSTONE } from "../data/tuning";
import {
  ATTR_KEYS,
  TRAIT_COLORS,
  type AttrKey,
  type Attributes,
  TRAIT_COLOR_LABEL,
  createEmptyResonance,
  type AffixRoll,
  type PlayerStats,
  type Resonance,
  type TraitColor,
  type TriggeredEffect,
} from "./types";

/**
 * 共鳴: 装備全体の色の配合で、同時に 1 つだけ発現する効果。docs/LOOT_DESIGN.md「色と共鳴」。
 * 判定順は 支配 → 二重 → 三和音 → 散光 → なし。誓約（色の誓約）と一部の性質は判定の規則を変える（ResonanceRules）。
 * 数値効果は computeStats（stats.ts）が段階適用の後・ソフトキャップの前に畳み込み、
 * メカニクスはトリガー文法（TriggeredEffect）で表す（戦闘側の追加実装なしで動く）。
 */

/** 支配: 1 色が全体のこの比率以上 */
export const DOMINANT_RATIO = 0.5;
/** 二重: 上位 2 色がそれぞれこの比率以上 */
export const DUAL_MIN_RATIO = 0.3;
/** 支配中、支配色以外の性質の値に掛かる係数 */
export const OFF_COLOR_DAMPING = 0.75;
/** 三和音: 上位 3 色がそれぞれこの比率以上（4 色目はこの比率未満） */
export const TRIAD_MIN_RATIO = 0.22;
/** 散光: すべての色がこの比率未満 */
export const SCATTER_MAX_RATIO = 0.3;
/** 二重の成立条件を下げる性質（橋渡し・双頭の指輪）でも、これより下げない */
export const DUAL_MIN_RATIO_FLOOR = 0.2;
/** 三和音のステータス加算（3 色それぞれ。散光と同じ小ささ） */
export const TRIAD_ATTR_GAIN = ATTR_GAIN.resonanceScatter;
const PERCENT = 100;

/**
 * 共鳴の判定の規則。既定は docs/LOOT_DESIGN.md の表のとおり。
 * 誓約（単色・無色・鏡）と性質（橋渡し・双頭の指輪）が変える
 */
export interface ResonanceRules {
  dominantRatio: number;
  dualMinRatio: number;
  allowDual: boolean;
  allowTriad: boolean;
  allowScatter: boolean;
  /** 支配中、支配色以外の性質に掛ける係数 */
  offColorDamping: number;
  /** 共鳴の効果を何回畳むか（単色の誓いは 2） */
  effectRepeats: number;
  /** 鏡の誓い: 色を反対色として数え、冥は数えない */
  mirror: boolean;
  /** 無色の誓い: 共鳴しない */
  disabled: boolean;
  /** 無色の誓い: 性質（誓約を除く）の値に掛ける倍率 */
  traitMul: number;
}

export const DEFAULT_RESONANCE_RULES: Readonly<ResonanceRules> = {
  dominantRatio: DOMINANT_RATIO,
  dualMinRatio: DUAL_MIN_RATIO,
  allowDual: true,
  allowTriad: true,
  allowScatter: true,
  offColorDamping: OFF_COLOR_DAMPING,
  effectRepeats: 1,
  mirror: false,
  disabled: false,
  traitMul: 1,
};

/** 規則を変える key（誓約・性質・implicit） */
const RULE_KEYS = {
  monochrome: "ks_monochrome",
  colorless: "ks_colorless",
  mirror: "ks_mirror",
  bridge: "bridge",
  twinRing: "implicit.twinRing",
} as const;

/**
 * 装備中のロール（implicit を含む。誓約は排他を解決済み）から判定の規則を作る。
 * 橋渡しは最も低い値、双頭の指輪は値の分だけ二重の条件を下げる（下限 DUAL_MIN_RATIO_FLOOR）
 */
export function resonanceRules(rolls: readonly AffixRoll[]): ResonanceRules {
  const rules: ResonanceRules = { ...DEFAULT_RESONANCE_RULES };
  for (const roll of rolls) {
    if (roll.key === RULE_KEYS.bridge && roll.value > 0) {
      rules.dualMinRatio = Math.min(rules.dualMinRatio, roll.value / PERCENT);
      rules.allowScatter = false;
    }
    if (roll.key === RULE_KEYS.twinRing) rules.dualMinRatio -= Math.max(0, roll.value) / PERCENT;
  }
  rules.dualMinRatio = Math.max(DUAL_MIN_RATIO_FLOOR, rules.dualMinRatio);
  const keys = new Set(rolls.map((r) => r.key));
  if (keys.has(RULE_KEYS.monochrome)) {
    rules.dominantRatio = KEYSTONE.monochromeRatio;
    rules.allowDual = false;
    rules.allowTriad = false;
    rules.allowScatter = false;
    rules.offColorDamping = KEYSTONE.monochromeDamping;
    rules.effectRepeats = 2;
  }
  if (keys.has(RULE_KEYS.colorless)) {
    rules.disabled = true;
    rules.traitMul = KEYSTONE.colorlessTraitMul;
  }
  if (keys.has(RULE_KEYS.mirror)) rules.mirror = true;
  return rules;
}

/** 配合に数える色。鏡の誓いは反対色（冥は数えない = undefined） */
export function countedColor(roll: AffixRoll, rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES): TraitColor | undefined {
  const color = traitColorOf(roll);
  if (color === undefined || !rules.mirror) return color;
  return color === "umbra" ? undefined : OPPOSITE_COLOR[color];
}
/** 反転した性質は色の重みが 2 倍（呪いは強く響く） */
export const INVERTED_COLOR_WEIGHT = 2;
/** 重みの合計がこれ未満なら共鳴しない（性質 1〜2 個で支配にならないように） */
export const MIN_RESONANCE_WEIGHT = 3;
/** 性質 1 つの重み = |value / nominal| をこの範囲に収める（強く振れた性質ほど強く響く） */
export const TRAIT_WEIGHT_MIN = 0.25;
export const TRAIT_WEIGHT_MAX = 3;
const DEFAULT_TRAIT_WEIGHT = 1;

export type ColorWeights = Record<TraitColor, number>;

function emptyWeights(): ColorWeights {
  return { crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0 };
}

/** 性質 1 つが配合に与える重み */
export function traitWeight(roll: AffixRoll): number {
  const nominal = roll.nominal;
  const base =
    nominal === undefined || nominal === 0
      ? DEFAULT_TRAIT_WEIGHT
      : Math.min(TRAIT_WEIGHT_MAX, Math.max(TRAIT_WEIGHT_MIN, Math.abs(roll.value / nominal)));
  return roll.inverted === true ? base * INVERTED_COLOR_WEIGHT : base;
}

/** 色ごとの重みの合計。色を持たないもの（implicit・旧マーカー）は数えない */
export function colorWeights(rolls: readonly AffixRoll[], rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES): ColorWeights {
  const weights = emptyWeights();
  for (const roll of rolls) {
    const color = countedColor(roll, rules);
    if (color !== undefined) weights[color] += traitWeight(roll);
  }
  return weights;
}

function toRatios(weights: Readonly<ColorWeights>): { ratios: ColorWeights; total: number } {
  const total = TRAIT_COLORS.reduce((sum, c) => sum + weights[c], 0);
  const ratios = emptyWeights();
  if (total <= 0) return { ratios, total };
  for (const c of TRAIT_COLORS) ratios[c] = weights[c] / total;
  return { ratios, total };
}

/** 配合比の大きい順（同率は TRAIT_COLORS 順） */
function rankColors(ratios: Readonly<ColorWeights>): TraitColor[] {
  return [...TRAIT_COLORS].sort((a, b) => ratios[b] - ratios[a] || TRAIT_COLORS.indexOf(a) - TRAIT_COLORS.indexOf(b));
}

function inPaletteOrder(colors: readonly TraitColor[]): TraitColor[] {
  return [...colors].sort((a, b) => TRAIT_COLORS.indexOf(a) - TRAIT_COLORS.indexOf(b));
}

/** 重みから共鳴を 1 つ決める（支配 → 二重 → 三和音 → 散光 → なし。規則で止められたものは飛ばす） */
export function resolveResonance(weights: Readonly<ColorWeights>, rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES): Resonance {
  const { ratios, total } = toRatios(weights);
  const none: Resonance = { ...createEmptyResonance(), ratios };
  if (rules.disabled || total < MIN_RESONANCE_WEIGHT) return none;
  const [first, second, third, fourth] = rankColors(ratios);
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) return none;
  if (ratios[first] >= rules.dominantRatio) return { kind: "dominant", colors: [first], ratios };
  if (rules.allowDual && ratios[first] >= rules.dualMinRatio && ratios[second] >= rules.dualMinRatio) {
    return { kind: "dual", colors: inPaletteOrder([first, second]), ratios };
  }
  // 三和音はちょうど 3 色が強いとき（4 色目まで強ければ散光の側に残す）
  if (rules.allowTriad && ratios[third] >= TRIAD_MIN_RATIO && ratios[fourth] < TRIAD_MIN_RATIO) {
    return { kind: "triad", colors: inPaletteOrder([first, second, third]), ratios };
  }
  if (rules.allowScatter && TRAIT_COLORS.every((c) => ratios[c] < SCATTER_MAX_RATIO)) {
    return { kind: "scatter", colors: [], ratios };
  }
  return none;
}

export function computeResonance(rolls: readonly AffixRoll[], rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES): Resonance {
  return resolveResonance(colorWeights(rolls, rules), rules);
}

// ---------------------------------------------------------------------------
// 性質の値への作用（支配の減衰・虚極の反転無効）
// ---------------------------------------------------------------------------

function scaled(roll: AffixRoll, factor: number): AffixRoll {
  // トリガーの value2 は発動確率と持続のエンコードなので触らない
  if (isTriggerKey(roll.key) || roll.value2 === undefined) return { ...roll, value: roll.value * factor };
  return { ...roll, value: roll.value * factor, value2: roll.value2 * factor };
}

function absolute(roll: AffixRoll): AffixRoll {
  if (roll.inverted !== true) return roll;
  const out: AffixRoll = { ...roll, value: Math.abs(roll.value) };
  if (roll.value2 !== undefined) out.value2 = Math.abs(roll.value2);
  return out;
}

/** 散光: 反転した性質の値をこの倍率にする（0 = 代償を完全に打ち消す。虚極と違い正の効果には転じない） */
export const SCATTER_INVERSION_CANCEL = 0;

/**
 * 共鳴に応じて性質の値を調整したコピーを返す（元の roll は変えない）。
 * - 支配: 支配色以外の色を持つ性質を OFF_COLOR_DAMPING 倍（色を持たない implicit は対象外）
 * - 冥の支配（虚極）: 反転した性質の負の値を正として扱う
 * - 散光: 反転した性質の値を 0 にする（負の値としての代償を打ち消すだけで、虚極のように正へは転じない）
 */
export function adjustForResonance(
  rolls: readonly AffixRoll[],
  resonance: Resonance,
  rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES,
): AffixRoll[] {
  const boosted = rules.traitMul === 1 ? [...rolls] : rolls.map((roll) => boostTrait(roll, rules.traitMul));
  if (resonance.kind === "scatter") {
    return boosted.map((roll) => (roll.inverted === true ? scaled(roll, SCATTER_INVERSION_CANCEL) : roll));
  }
  if (resonance.kind !== "dominant") return boosted;
  const dominant = resonance.colors[0];
  return boosted.map((roll) => {
    const color = countedColor(roll, rules);
    const base = dominant === "umbra" ? absolute(roll) : roll;
    if (color === undefined || color === dominant) return base;
    return scaled(base, rules.offColorDamping);
  });
}

/** 無色の誓い: 色を持つ性質（implicit と誓約以外）の値を倍にする */
function boostTrait(roll: AffixRoll, mul: number): AffixRoll {
  if (traitColorOf(roll) === undefined || roll.key.startsWith(KEYSTONE_PREFIX)) return roll;
  return scaled(roll, mul);
}
const KEYSTONE_PREFIX = "ks_";

// ---------------------------------------------------------------------------
// 共鳴の効果（支配 5 + 二重 10 + 散光 1）
// ---------------------------------------------------------------------------

export interface ResonanceEffect {
  name: string;
  /** 動詞で語る説明（UI にそのまま出す） */
  lines: readonly string[];
  apply: (stats: PlayerStats) => void;
}

function trigger(effect: TriggeredEffect): (stats: PlayerStats) => void {
  return (stats) => {
    stats.triggers.push({ ...effect });
  };
}

function both(...fns: ((stats: PlayerStats) => void)[]): (stats: PlayerStats) => void {
  return (stats) => {
    for (const fn of fns) fn(stats);
  };
}

export const DOMINANT_EFFECTS: Readonly<Record<TraitColor, ResonanceEffect>> = {
  crimson: {
    name: "灼極",
    lines: ["3 回に 1 回の近接攻撃で、周囲の敵を燃やす", "近接の一撃が少し重くなる"],
    apply: both(
      trigger({ trigger: "everyNthMeleeHit", every: 3, condition: "always", effect: "burnNearby", magnitude: 6, duration: 3, chance: 1 }),
      (s) => {
        s.meleeDamageMul += 0.1;
      },
    ),
  },
  azure: {
    name: "氷極",
    lines: ["射撃のたびに 25% の確率で、周囲の敵を凍らせる", "弾が速く飛ぶ"],
    apply: both(
      trigger({ trigger: "onShoot", condition: "always", effect: "freezeNearby", magnitude: 40, duration: 2, chance: 0.25 }),
      (s) => {
        s.projectileSpeedMul += 0.15;
      },
    ),
  },
  jade: {
    name: "森極",
    lines: ["被弾すると 50% の確率で HP を 8 回復する", "傷が少しずつ塞がる"],
    apply: both(trigger({ trigger: "onHurt", condition: "always", effect: "heal", magnitude: 8, chance: 0.5 }), (s) => {
      s.hpRegen += 0.5;
    }),
  },
  gold: {
    name: "雷極",
    lines: ["10 コンボ以上の近接命中で、30% の確率で連鎖雷を呼ぶ", "会心が出やすくなる"],
    apply: both(
      trigger({ trigger: "onMeleeHit", condition: "comboAbove10", effect: "chainLightning", magnitude: 14, chance: 0.3 }),
      (s) => {
        s.critChance += 0.05;
      },
    ),
  },
  umbra: {
    name: "虚極",
    // QA（report.md）: 反転（inversion）は発見深度 13 以降にしか出ないため、そこに届く前の
    // 大半のランでは「反転を正として扱う」効果が一切働かず、damageTakenMul の代償だけが残って
    // 純粋な弱化になっていた。深度に関係なく効く energyGainMul を足して、
    // 反転に出会う前でも選ぶ理由を持たせる（虚 = 何もない代わりに力を吸い出す、の方向）
    lines: ["反転した性質の負の値を、正の値として扱う", "受けた傷から力を吸い、エネルギーが少し貯まりやすくなる", "代わりに受ける傷が少し深くなる"],
    apply: (s) => {
      s.energyGainMul += 0.15;
      s.damageTakenMul += 0.1;
    },
  },
};

/** 二重の効果。key は TRAIT_COLORS 順の "a+b" */
export const DUAL_EFFECTS: Readonly<Record<string, ResonanceEffect>> = {
  "crimson+azure": {
    name: "蒸気",
    lines: ["射撃時に 20% の確率で、周囲の敵を燃やす", "攻撃に冷気が混じり、敵を凍らせやすくなる"],
    apply: both(
      trigger({ trigger: "onShoot", condition: "always", effect: "burnNearby", magnitude: 5, duration: 3, chance: 0.2 }),
      (s) => {
        s.chillChance += 0.05;
      },
    ),
  },
  "crimson+jade": {
    name: "血潮",
    lines: ["命中のたびに HP を 1 吸う", "撃破時に 30% の確率で、4 秒間ダメージ +20%"],
    apply: both(
      trigger({ trigger: "onKill", condition: "always", effect: "damageBuff", magnitude: 20, duration: 4, chance: 0.3 }),
      (s) => {
        s.lifeOnHit += 1;
      },
    ),
  },
  "crimson+gold": {
    name: "閃火",
    lines: ["会心の一撃がさらに深く入る", "攻撃が燃え移りやすくなる"],
    apply: (s) => {
      s.critMul += 0.25;
      s.burnChance += 0.1;
    },
  },
  "crimson+umbra": {
    name: "焦身",
    lines: ["被弾すると 50% の確率で、3 秒間ダメージ +40%", "最大 HP が 10 減る"],
    apply: both(
      trigger({ trigger: "onHurt", condition: "always", effect: "damageBuff", magnitude: 40, duration: 3, chance: 0.5 }),
      (s) => {
        s.maxHp -= 10;
      },
    ),
  },
  "azure+jade": {
    name: "潮流",
    lines: ["ダッシュ時に 50% の確率で HP を 3 回復する", "足取りが軽くなる"],
    apply: both(trigger({ trigger: "onDash", condition: "always", effect: "heal", magnitude: 3, chance: 0.5 }), (s) => {
      s.moveSpeedMul += 0.08;
    }),
  },
  "azure+gold": {
    name: "霜雷",
    // 元は chillChance/shockChance を足すだけの数値効果だったが、QA での指摘（二重の固有効果に
    // 「遊び方が変わる」ものを最低 1 つ）を受けて、JUST 回避を避けるだけの防御行動から
    // 攻めにも使える行動に変える。数値ボーナスは半分にして帳尻を合わせる
    lines: ["ジャスト回避の瞬間、周囲へ凍雷の弾をばら撒く", "攻撃が敵を凍らせ・感電させやすくなる"],
    apply: both(
      trigger({ trigger: "onJustDodge", condition: "always", effect: "spawnBullets", magnitude: 8, count: 6, chance: 0.5 }),
      (s) => {
        s.chillChance += 0.05;
        s.shockChance += 0.05;
      },
    ),
  },
  "azure+umbra": {
    name: "影弾",
    lines: ["弾が敵を 1 体多く貫く", "代わりに受ける傷が少し深くなる"],
    apply: (s) => {
      s.pierce += 1;
      s.damageTakenMul += 0.1;
    },
  },
  "jade+gold": {
    name: "活脈",
    lines: ["ジャスト回避で 60% の確率で、エネルギーを 15 得る", "コンボが途切れにくくなる"],
    apply: both(
      trigger({ trigger: "onJustDodge", condition: "always", effect: "energy", magnitude: 15, chance: 0.6 }),
      (s) => {
        s.comboWindowBonus += 0.3;
      },
    ),
  },
  "jade+umbra": {
    name: "澱",
    lines: ["被弾すると 60% の確率で、エネルギーを 12 得る", "最大 HP が 20 増える"],
    apply: both(trigger({ trigger: "onHurt", condition: "always", effect: "energy", magnitude: 12, chance: 0.6 }), (s) => {
      s.maxHp += 20;
    }),
  },
  "gold+umbra": {
    name: "賭け",
    lines: ["会心が出やすく、深く入るようになる", "代わりに受ける傷が深くなる"],
    apply: (s) => {
      s.critChance += 0.1;
      s.critMul += 0.5;
      s.damageTakenMul += 0.15;
    },
  },
};

/**
 * QA（report.md）: 散光の到達depthが支配/二重よりかなり高かった（7.55 対 5.35 / 5.18）ため、
 * 全ステータス底上げの倍率を半分にした（0.05→0.025、energyGainMul は 0.1→0.05）。
 * 代わりに散光にしか無い質的な利点として、反転した性質の代償を打ち消す
 * （SCATTER_INVERSION_CANCEL、adjustForResonance）を追加する。
 * 「単色の極みと混色の器用さが競合する」設計哲学に対し、散光の器用さは
 * 「呪いを恐れず尖った性質を拾いに行ける」方向に寄せる
 */
export const SCATTER_EFFECT: ResonanceEffect = {
  name: "虹",
  lines: [
    "近接・射撃・攻撃速度・連射・移動が少しずつ伸びる",
    "エネルギーが少し溜まりやすくなる",
    "反転した性質の代償を打ち消す（正の効果には転じない）",
  ],
  apply: (s) => {
    s.meleeDamageMul += 0.025;
    s.rangedDamageMul += 0.025;
    s.attackSpeedMul += 0.025;
    s.fireRateMul += 0.025;
    s.moveSpeedMul += 0.025;
    s.energyGainMul += 0.05;
  },
};


/** 三和音の効果。key は TRAIT_COLORS 順の "a+b+c"（docs/ideas/loot-expansion.md 9-1） */
export const TRIAD_EFFECTS: Readonly<Record<string, ResonanceEffect>> = {
  "crimson+azure+jade": {
    name: "四季",
    lines: ["3 回に 1 回の近接で周囲を燃やす", "ダッシュ時に 50% の確率で周囲を凍らせる", "部屋を制圧すると HP を 8 回復する"],
    apply: both(
      trigger({ trigger: "everyNthMeleeHit", every: 3, condition: "always", effect: "burnNearby", magnitude: 5, duration: 3, chance: 1 }),
      trigger({ trigger: "onDash", condition: "always", effect: "freezeNearby", magnitude: 30, duration: 2, chance: 0.5 }),
      trigger({ trigger: "onRoomClear", condition: "always", effect: "heal", magnitude: 8, chance: 1 }),
    ),
  },
  "crimson+azure+gold": {
    name: "雷雨",
    lines: ["状態異常が 2 種以上の敵を殴ると、35% の確率で連鎖雷を呼ぶ", "攻撃が感電させやすくなる"],
    apply: both(
      trigger({ trigger: "onMeleeHit", condition: "targetMultiStatus", effect: "chainLightning", magnitude: 12, chance: 0.35 }),
      (s) => {
        s.shockChance += 0.05;
      },
    ),
  },
  "crimson+azure+umbra": {
    name: "煤",
    lines: ["状態異常が 2 種以上の敵を殴ると、50% の確率で脆弱にする", "炎上が少し熱くなる"],
    apply: both(
      trigger({ trigger: "onMeleeHit", condition: "targetMultiStatus", effect: "inflict", status: "vulnerable", magnitude: 3, chance: 0.5 }),
      (s) => {
        s.burnDps += 2;
      },
    ),
  },
  "crimson+jade+gold": {
    name: "祭",
    lines: ["10 回に 1 回の近接で HP を 5 回復し、エネルギーを 8 得る"],
    apply: both(
      trigger({ trigger: "everyNthMeleeHit", every: 10, condition: "always", effect: "heal", magnitude: 5, chance: 1 }),
      trigger({ trigger: "everyNthMeleeHit", every: 10, condition: "always", effect: "energy", magnitude: 8, chance: 1 }),
    ),
  },
  "crimson+jade+umbra": {
    name: "血肉",
    lines: ["命中のたびに HP を 1 吸う", "HP が半分を切っている間の撃破で HP を 6 回復する"],
    apply: both(trigger({ trigger: "onKill", condition: "belowHalfHp", effect: "heal", magnitude: 6, chance: 1 }), (s) => {
      s.lifeOnHit += 1;
    }),
  },
  "crimson+gold+umbra": {
    name: "賭場",
    lines: ["敵を怯ませると、50% の確率でその場が爆発する", "会心が少し出やすくなる"],
    apply: both(
      trigger({ trigger: "onStagger", condition: "always", effect: "explode", magnitude: 20, chance: 0.5 }),
      (s) => {
        s.critChance += 0.03;
      },
    ),
  },
  "azure+jade+gold": {
    name: "凪",
    lines: ["マナが満タンの間の撃破でエネルギーを 10 得る", "傷が少しずつ塞がる"],
    apply: both(trigger({ trigger: "onKill", condition: "manaFull", effect: "energy", magnitude: 10, chance: 1 }), (s) => {
      s.hpRegen += 0.3;
    }),
  },
  "azure+jade+umbra": {
    name: "沼",
    lines: ["射撃のたびに 20% の確率で、近くの敵を毒にする", "冷気の遅さが少し深くなる"],
    apply: both(
      trigger({ trigger: "onShoot", condition: "always", effect: "inflict", status: "poison", magnitude: 3, chance: 0.2 }),
      (s) => {
        s.chillSlow += 0.05;
      },
    ),
  },
  "azure+gold+umbra": {
    name: "流星",
    lines: ["ジャスト回避でマナを 8 回収する", "ジャスト回避の瞬間、50% の確率で弾をばら撒く"],
    apply: both(
      trigger({ trigger: "onJustDodge", condition: "always", effect: "restoreMana", magnitude: 8, chance: 1 }),
      trigger({ trigger: "onJustDodge", condition: "always", effect: "spawnBullets", magnitude: 6, count: 5, chance: 0.5 }),
    ),
  },
  "jade+gold+umbra": {
    name: "輪廻",
    lines: ["撃破時に 40% の確率で、周囲の敵を弱体にする", "コンボが途切れにくくなる"],
    apply: both(
      trigger({ trigger: "onKill", condition: "always", effect: "inflict", status: "weaken", magnitude: 3, chance: 0.4 }),
      (s) => {
        s.comboWindowBonus += 0.2;
      },
    ),
  },
};

export function dualKey(a: TraitColor, b: TraitColor): string {
  const [x, y] = inPaletteOrder([a, b]);
  return `${x ?? a}+${y ?? b}`;
}

/** 三和音の key（TRAIT_COLORS 順の "a+b+c"） */
export function triadKey(colors: readonly TraitColor[]): string {
  return inPaletteOrder(colors).join("+");
}

/** 発現中の共鳴の効果定義。なしは undefined */
export function resonanceEffect(resonance: Resonance): ResonanceEffect | undefined {
  switch (resonance.kind) {
    case "dominant": {
      const color = resonance.colors[0];
      return color === undefined ? undefined : DOMINANT_EFFECTS[color];
    }
    case "dual": {
      const [a, b] = resonance.colors;
      return a === undefined || b === undefined ? undefined : DUAL_EFFECTS[dualKey(a, b)];
    }
    case "triad":
      return resonance.colors.length === 3 ? TRIAD_EFFECTS[triadKey(resonance.colors)] : undefined;
    case "scatter":
      return SCATTER_EFFECT;
    case "none":
      return undefined;
  }
}

/** 共鳴の数値効果・トリガー・ステータス加算を stats に畳み込む（単色の誓いは効果を 2 回） */
export function applyResonanceEffect(
  stats: PlayerStats,
  resonance: Resonance,
  rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES,
): void {
  for (let i = 0; i < rules.effectRepeats; i++) resonanceEffect(resonance)?.apply(stats);
  const bonus = resonanceAttributes(resonance);
  for (const k of ATTR_KEYS) stats.attributes[k] += bonus[k];
}

// ---------------------------------------------------------------------------
// ステータス加算（docs/COMBAT_DESIGN.md A-3）
// ---------------------------------------------------------------------------

/** 色とステータスの対応。docs/LOOT_DESIGN.md の 5 色の意味（紅 = 近接 … 冥 = 呪い）に揃える */
export const COLOR_ATTR: Readonly<Record<TraitColor, AttrKey>> = {
  crimson: "str",
  azure: "dex",
  jade: "vit",
  gold: "mnd",
  umbra: "spi",
};

/** ステータスの表示名（docs/GLOSSARY.md）。共鳴の説明と装備画面・振り分けパネルで共有する */
export const ATTR_LABEL: Readonly<Record<AttrKey, string>> = {
  str: "筋力",
  dex: "技巧",
  vit: "体力",
  mnd: "精神",
  spi: "霊力",
};

function zeroAttributes(): Attributes {
  return { str: 0, dex: 0, vit: 0, mnd: 0, spi: 0 };
}

/** 共鳴が足すステータス（逓減前の生の値）。支配: その色 / 二重: 2 色それぞれ / 散光: 全部 */
export function resonanceAttributes(resonance: Resonance): Attributes {
  const out = zeroAttributes();
  switch (resonance.kind) {
    case "dominant":
      for (const c of resonance.colors) out[COLOR_ATTR[c]] += ATTR_GAIN.resonanceDominant;
      return out;
    case "dual":
      for (const c of resonance.colors) out[COLOR_ATTR[c]] += ATTR_GAIN.resonanceDual;
      return out;
    case "triad":
      for (const c of resonance.colors) out[COLOR_ATTR[c]] += TRIAD_ATTR_GAIN;
      return out;
    case "scatter":
      for (const k of ATTR_KEYS) out[k] += ATTR_GAIN.resonanceScatter;
      return out;
    case "none":
      return out;
  }
}

/** 「筋力 +3」「全ステータス +1」の 1 行。加算が無ければ undefined */
function resonanceAttributeLine(resonance: Resonance): string | undefined {
  if (resonance.kind === "scatter") return `全ステータス +${ATTR_GAIN.resonanceScatter}`;
  const bonus = resonanceAttributes(resonance);
  const parts = ATTR_KEYS.filter((k) => bonus[k] > 0).map((k) => `${ATTR_LABEL[k]} +${bonus[k]}`);
  return parts.length === 0 ? undefined : parts.join(" / ");
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

const PERCENT_SCALE = 100;
const NONE_LINES: readonly string[] = [
  "共鳴なし",
  "1 色を半分以上に寄せるか、2 色をそれぞれ 3 割以上に揃えるか、全色を散らすと共鳴する",
];

function headline(resonance: Resonance, effect: ResonanceEffect): string {
  const labels = resonance.colors.map((c) => TRAIT_COLOR_LABEL[c]);
  switch (resonance.kind) {
    case "dominant":
      return `共鳴 ${effect.name}（${labels.join("")}の支配）`;
    case "dual":
      return `共鳴 ${effect.name}（${labels.join("と")}の二重）`;
    case "triad":
      return `共鳴 ${effect.name}（${labels.join("・")}の三和音）`;
    case "scatter":
      return `共鳴 ${effect.name}（散光）`;
    case "none":
      return effect.name;
  }
}

/**
 * 共鳴の説明（UI 用）。1 行目が名前、以降は動詞で語る効果。単一の強さの指標は出さない。
 * 支配中は減衰の注意も添える
 */
export function describeResonance(resonance: Resonance): string[] {
  const effect = resonanceEffect(resonance);
  if (effect === undefined) return [...NONE_LINES];
  const lines = [headline(resonance, effect), ...effect.lines];
  const attrLine = resonanceAttributeLine(resonance);
  if (attrLine !== undefined) lines.push(attrLine);
  if (resonance.kind === "dominant") {
    lines.push(`支配していない色の性質は ${Math.round(OFF_COLOR_DAMPING * PERCENT_SCALE)}% に弱まる`);
  }
  return lines;
}
