import { isTriggerKey } from "./triggers";
import { OPPOSITE_COLOR, traitColorOf } from "./colors";
import { scaleFlat } from "./flux";
import { ATTR_GAIN, KEYSTONE, RESONANCE } from "../data/tuning";
import {
  ATTR_KEYS,
  TRAIT_COLORS,
  type ConstellationKey,
  type Equipment,
  type Slot,
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
 * 判定順は 冥の支配 → 陰画 → 支配 → 二重 → 三和音 → 散光 → 拮抗 → なし。誓約（色の誓約）と一部の性質は判定の規則を変える（ResonanceRules）。
 * 星座（6 部位の主色の並び）は共鳴とは別の層で、同時に 1 つだけ成立する（CONSTELLATIONS）。
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
/** 共鳴の倍率・確率の加算を係数で縮めたときの小数桁 */
const FRAC_DECIMALS = 4;

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

/**
 * 陰画の判定の入力。反転した性質の重みの合計と、反転していない性質だけの色の重み
 * （反転は冥に数えられるので、裏返る前の「表の支配色」は反転を除いた配合で見る）
 */
export interface NegativeInput {
  invertedWeight: number;
  upright: ColorWeights;
}

/** 陰画にならない入力（反転なし） */
const NO_NEGATIVE: NegativeInput = { invertedWeight: 0, upright: emptyWeights() };

/** 陰画: 反転の重みが全体の RESONANCE.negativeInvertedRatio 以上で、反転を除いた配合に冥以外の支配色がある */
function negativeColor(input: NegativeInput, total: number, rules: Readonly<ResonanceRules>): TraitColor | undefined {
  if (rules.mirror || total <= 0 || input.invertedWeight / total < RESONANCE.negativeInvertedRatio) return undefined;
  const { ratios } = toRatios(input.upright);
  const top = rankColors(ratios)[0];
  if (top === undefined || top === "umbra" || ratios[top] < rules.dominantRatio) return undefined;
  return top;
}

/** 比率の比較の誤差 */
const FLOAT_EPSILON = 1e-9;

/** 拮抗の組（反対色）。紅と蒼、翠と金 */
const BALANCE_PAIRS: readonly (readonly [TraitColor, TraitColor])[] = [
  ["crimson", "azure"],
  ["jade", "gold"],
];

/** 拮抗: 反対色の組がそれぞれ RESONANCE.balanceMinRatio 以上で、差が RESONANCE.balanceMaxGap 以内（先の組が優先） */
function balancePair(ratios: Readonly<ColorWeights>): readonly [TraitColor, TraitColor] | undefined {
  return BALANCE_PAIRS.find(
    ([a, b]) =>
      ratios[a] >= RESONANCE.balanceMinRatio &&
      ratios[b] >= RESONANCE.balanceMinRatio &&
      Math.abs(ratios[a] - ratios[b]) <= RESONANCE.balanceMaxGap + FLOAT_EPSILON,
  );
}

/**
 * 重みから共鳴を 1 つ決める（冥の支配（虚極）→ 陰画 → 支配 → 二重 → 三和音 → 散光 → 拮抗 → なし。規則で止められたものは飛ばす）。
 * 陰画は kind = dominant・form = negative、拮抗は kind = dual・form = balance で返す（kind で分岐する他の仕組みを壊さない）
 */
export function resolveResonance(
  weights: Readonly<ColorWeights>,
  rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES,
  negative: Readonly<NegativeInput> = NO_NEGATIVE,
): Resonance {
  const { ratios, total } = toRatios(weights);
  const none: Resonance = { ...createEmptyResonance(), ratios };
  if (rules.disabled || total < MIN_RESONANCE_WEIGHT) return none;
  const [first, second, third, fourth] = rankColors(ratios);
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) return none;
  const umbraDominant = first === "umbra" && ratios[first] >= rules.dominantRatio;
  const flipped = umbraDominant ? undefined : negativeColor(negative, total, rules);
  if (flipped !== undefined) return { kind: "dominant", colors: [flipped], ratios, form: "negative" };
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
  // 拮抗は他のどの共鳴も成立しないときだけ（「共鳴なし」の隙間を埋める。散光・二重を奪わない）
  const pair = rules.allowDual ? balancePair(ratios) : undefined;
  if (pair !== undefined) return { kind: "dual", colors: inPaletteOrder(pair), ratios, form: "balance" };
  return none;
}

/** 陰画の入力（反転の重みと、反転を除いた配合）。配合に数えない反転（鏡の誓い）は数えない */
export function negativeInput(rolls: readonly AffixRoll[], rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES): NegativeInput {
  let invertedWeight = 0;
  for (const roll of rolls) {
    if (roll.inverted === true && countedColor(roll, rules) !== undefined) invertedWeight += traitWeight(roll);
  }
  return { invertedWeight, upright: colorWeights(rolls.filter((r) => r.inverted !== true), rules) };
}

export function computeResonance(rolls: readonly AffixRoll[], rules: Readonly<ResonanceRules> = DEFAULT_RESONANCE_RULES): Resonance {
  return resolveResonance(colorWeights(rolls, rules), rules, negativeInput(rolls, rules));
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

/**
 * 共鳴・三和音の効果値に装備の強さの係数（flux.ts の FLUX.globalScale）を掛ける（memo 2026-09-24）。
 * amt は整数の量（回復量・ダメージ・エネルギー…）、frac は倍率・確率の加算。
 * 代償（被ダメ増・最大 HP 減・貫通数）と発動確率・回数は係数の外に置く
 */
function amt(v: number): number {
  return scaleFlat(v);
}

function frac(v: number): number {
  return scaleFlat(v, FRAC_DECIMALS);
}

export const DOMINANT_EFFECTS: Readonly<Record<TraitColor, ResonanceEffect>> = {
  crimson: {
    name: "灼極",
    lines: ["3 回に 1 回の近接攻撃で、周囲の敵を燃やす", "近接ダメージが少し上がる"],
    apply: both(
      trigger({ trigger: "everyNthMeleeHit", every: 3, condition: "always", effect: "burnNearby", magnitude: amt(6), duration: 3, chance: 1 }),
      (s) => {
        s.meleeDamageMul += frac(0.1);
      },
    ),
  },
  azure: {
    name: "氷極",
    lines: ["射撃のたびに 25% の確率で、周囲の敵を凍らせる", "弾速が上がる"],
    apply: both(
      trigger({ trigger: "onShoot", condition: "always", effect: "freezeNearby", magnitude: amt(40), duration: 2, chance: 0.25 }),
      (s) => {
        s.projectileSpeedMul += frac(0.15);
      },
    ),
  },
  jade: {
    name: "森極",
    lines: [`被弾すると 50% の確率で生命を ${amt(8)} 回復する`, "敵が近くにいない間、生命が少しずつ回復する"],
    apply: both(trigger({ trigger: "onHurt", condition: "always", effect: "heal", magnitude: amt(8), chance: 0.5 }), (s) => {
      s.hpRegen += frac(0.5);
    }),
  },
  gold: {
    name: "雷極",
    lines: ["10 コンボ以上の近接命中で、30% の確率で連鎖雷を呼ぶ", "会心率が上がる"],
    apply: both(
      trigger({ trigger: "onMeleeHit", condition: "comboAbove10", effect: "chainLightning", magnitude: amt(14), chance: 0.3 }),
      (s) => {
        s.critChance += frac(0.05);
      },
    ),
  },
  umbra: {
    name: "虚極",
    // QA（report.md）: 反転（inversion）は発見深度 13 以降にしか出ないため、そこに届く前の
    // 大半のランでは「反転を正として扱う」効果が一切働かず、damageTakenMul の代償だけが残って
    // 純粋な弱化になっていた。深度に関係なく効く energyGainMul を足して、
    // 反転に出会う前でも選ぶ理由を持たせる（虚 = 何もない代わりに力を吸い出す、の方向）
    lines: ["反転した性質の負の値を、正の値として扱う", "必殺ゲージが少し溜まりやすくなる", "代わりに被ダメージが少し増える"],
    apply: (s) => {
      s.energyGainMul += frac(0.15);
      s.damageTakenMul += 0.1;
    },
  },
};

/** 二重の効果。key は TRAIT_COLORS 順の "a+b" */
export const DUAL_EFFECTS: Readonly<Record<string, ResonanceEffect>> = {
  "crimson+azure": {
    name: "蒸気",
    lines: ["射撃時に 20% の確率で、周囲の敵を燃やす", "攻撃で敵を冷気にしやすくなる"],
    apply: both(
      trigger({ trigger: "onShoot", condition: "always", effect: "burnNearby", magnitude: amt(5), duration: 3, chance: 0.2 }),
      (s) => {
        s.chillChance += frac(0.05);
      },
    ),
  },
  "crimson+jade": {
    name: "血潮",
    lines: [`命中のたびに与ダメの ${frac(1)}% を回復する`, `撃破時に 30% の確率で、4 秒間ダメージ +${amt(20)}%`],
    apply: both(
      trigger({ trigger: "onKill", condition: "always", effect: "damageBuff", magnitude: amt(20), duration: 4, chance: 0.3 }),
      (s) => {
        s.lifeOnHit += frac(1);
      },
    ),
  },
  "crimson+gold": {
    name: "閃火",
    lines: ["会心倍率が上がる", "攻撃で敵を燃焼させやすくなる"],
    apply: (s) => {
      s.critMul += frac(0.25);
      s.burnChance += frac(0.1);
    },
  },
  "crimson+umbra": {
    name: "焦身",
    lines: [`被弾すると 50% の確率で、3 秒間ダメージ +${amt(40)}%`, "最大生命が 10 減る"],
    apply: both(
      trigger({ trigger: "onHurt", condition: "always", effect: "damageBuff", magnitude: amt(40), duration: 3, chance: 0.5 }),
      (s) => {
        s.maxHp -= 10;
      },
    ),
  },
  "azure+jade": {
    name: "潮流",
    lines: [`ダッシュ時に 50% の確率で生命を ${amt(3)} 回復する`, "移動速度が少し上がる"],
    apply: both(trigger({ trigger: "onDash", condition: "always", effect: "heal", magnitude: amt(3), chance: 0.5 }), (s) => {
      s.moveSpeedMul += frac(0.08);
    }),
  },
  "azure+gold": {
    name: "霜雷",
    // 元は chillChance/shockChance を足すだけの数値効果だったが、QA での指摘（二重の固有効果に
    // 「遊び方が変わる」ものを最低 1 つ）を受けて、JUST 回避を避けるだけの防御行動から
    // 攻めにも使える行動に変える。数値ボーナスは半分にして帳尻を合わせる
    lines: ["見切りの瞬間、50% の確率で周囲へ凍雷の弾をばら撒く", "攻撃で敵を冷気・感電にしやすくなる"],
    apply: both(
      trigger({ trigger: "onJustDodge", condition: "always", effect: "spawnBullets", magnitude: amt(8), count: 6, chance: 0.5 }),
      (s) => {
        s.chillChance += frac(0.05);
        s.shockChance += frac(0.05);
      },
    ),
  },
  "azure+umbra": {
    name: "影弾",
    lines: ["弾の貫通 +1", "代わりに被ダメージが少し増える"],
    apply: (s) => {
      s.pierce += 1;
      s.damageTakenMul += 0.1;
    },
  },
  "jade+gold": {
    name: "活脈",
    lines: [`見切りで 60% の確率で、必殺ゲージを ${amt(15)} 得る`, "コンボが途切れにくくなる"],
    apply: both(
      trigger({ trigger: "onJustDodge", condition: "always", effect: "energy", magnitude: amt(15), chance: 0.6 }),
      (s) => {
        s.comboWindowBonus += frac(0.3);
      },
    ),
  },
  "jade+umbra": {
    name: "澱",
    lines: [`被弾すると 60% の確率で、必殺ゲージを ${amt(12)} 得る`, `最大生命が ${amt(20)} 増える`],
    apply: both(trigger({ trigger: "onHurt", condition: "always", effect: "energy", magnitude: amt(12), chance: 0.6 }), (s) => {
      s.maxHp += amt(20);
    }),
  },
  "gold+umbra": {
    name: "賭け",
    lines: ["会心率と会心倍率が上がる", "代わりに被ダメージが増える"],
    apply: (s) => {
      s.critChance += frac(0.1);
      s.critMul += frac(0.5);
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
    "近接・射撃・攻撃速度・連射速度・移動速度が少し上がる",
    "必殺ゲージが少し溜まりやすくなる",
    "反転した性質の代償を打ち消す（正の効果には転じない）",
  ],
  apply: (s) => {
    s.meleeDamageMul += frac(0.025);
    s.rangedDamageMul += frac(0.025);
    s.attackSpeedMul += frac(0.025);
    s.fireRateMul += frac(0.025);
    s.moveSpeedMul += frac(0.025);
    s.energyGainMul += frac(0.05);
  },
};


/** 三和音の効果。key は TRAIT_COLORS 順の "a+b+c"（docs/ideas/loot-expansion.md 9-1） */
export const TRIAD_EFFECTS: Readonly<Record<string, ResonanceEffect>> = {
  "crimson+azure+jade": {
    name: "四季",
    lines: ["3 回に 1 回の近接で周囲を燃やす", "ダッシュ時に 50% の確率で周囲を凍らせる", `部屋を制圧すると生命を ${amt(8)} 回復する`],
    apply: both(
      trigger({ trigger: "everyNthMeleeHit", every: 3, condition: "always", effect: "burnNearby", magnitude: amt(5), duration: 3, chance: 1 }),
      trigger({ trigger: "onDash", condition: "always", effect: "freezeNearby", magnitude: amt(30), duration: 2, chance: 0.5 }),
      trigger({ trigger: "onRoomClear", condition: "always", effect: "heal", magnitude: amt(8), chance: 1 }),
    ),
  },
  "crimson+azure+gold": {
    name: "雷雨",
    lines: ["状態異常が 2 種以上の敵に近接を当てると、35% の確率で連鎖雷を呼ぶ", "攻撃で敵を感電させやすくなる"],
    apply: both(
      trigger({ trigger: "onMeleeHit", condition: "targetMultiStatus", effect: "chainLightning", magnitude: amt(12), chance: 0.35 }),
      (s) => {
        s.shockChance += frac(0.05);
      },
    ),
  },
  "crimson+azure+umbra": {
    name: "煤",
    lines: ["状態異常が 2 種以上の敵に近接を当てると、50% の確率で脆弱にする", "燃焼ダメージが少し上がる"],
    apply: both(
      trigger({ trigger: "onMeleeHit", condition: "targetMultiStatus", effect: "inflict", status: "vulnerable", magnitude: 3, chance: 0.5 }),
      (s) => {
        s.burnDps += amt(2);
      },
    ),
  },
  "crimson+jade+gold": {
    name: "祭",
    lines: [`10 回に 1 回の近接で生命を ${amt(5)} 回復し、必殺ゲージを ${amt(8)} 得る`],
    apply: both(
      trigger({ trigger: "everyNthMeleeHit", every: 10, condition: "always", effect: "heal", magnitude: amt(5), chance: 1 }),
      trigger({ trigger: "everyNthMeleeHit", every: 10, condition: "always", effect: "energy", magnitude: amt(8), chance: 1 }),
    ),
  },
  "crimson+jade+umbra": {
    name: "血肉",
    lines: [`命中のたびに与ダメの ${frac(1)}% を回復する`, `生命が半分を切っている間の撃破で生命を ${amt(6)} 回復する`],
    apply: both(trigger({ trigger: "onKill", condition: "belowHalfHp", effect: "heal", magnitude: amt(6), chance: 1 }), (s) => {
      s.lifeOnHit += frac(1);
    }),
  },
  "crimson+gold+umbra": {
    name: "賭場",
    lines: ["敵を怯ませると、50% の確率でその場が爆発する", "会心率が少し上がる"],
    apply: both(
      trigger({ trigger: "onStagger", condition: "always", effect: "explode", magnitude: amt(20), chance: 0.5 }),
      (s) => {
        s.critChance += frac(0.03);
      },
    ),
  },
  "azure+jade+gold": {
    name: "凪",
    lines: [`気力が満タンの間の撃破で必殺ゲージを ${amt(10)} 得る`, "敵が近くにいない間、生命が少しずつ回復する"],
    apply: both(trigger({ trigger: "onKill", condition: "manaFull", effect: "energy", magnitude: amt(10), chance: 1 }), (s) => {
      s.hpRegen += frac(0.3);
    }),
  },
  "azure+jade+umbra": {
    name: "沼",
    lines: ["射撃のたびに 20% の確率で、近くの敵を毒にする", "冷気の減速が少し強くなる"],
    apply: both(
      trigger({ trigger: "onShoot", condition: "always", effect: "inflict", status: "poison", magnitude: 3, chance: 0.2 }),
      (s) => {
        s.chillSlow += frac(0.05);
      },
    ),
  },
  "azure+gold+umbra": {
    name: "流星",
    lines: [`見切りで気力を ${amt(8)} 回収する`, "見切りの瞬間、50% の確率で弾をばら撒く"],
    apply: both(
      trigger({ trigger: "onJustDodge", condition: "always", effect: "restoreMana", magnitude: amt(8), chance: 1 }),
      trigger({ trigger: "onJustDodge", condition: "always", effect: "spawnBullets", magnitude: amt(6), count: 5, chance: 0.5 }),
    ),
  },
  "jade+gold+umbra": {
    name: "輪廻",
    lines: ["撃破時に 40% の確率で、周囲の敵を弱体にする", "コンボが途切れにくくなる"],
    apply: both(
      trigger({ trigger: "onKill", condition: "always", effect: "inflict", status: "weaken", magnitude: 3, chance: 0.4 }),
      (s) => {
        s.comboWindowBonus += frac(0.2);
      },
    ),
  },
};

/** 陰画の効果（紅・蒼・翠・金。冥の支配は虚極のまま）。docs/ideas/loot-expansion.md 9-2 */
export const NEGATIVE_EFFECTS: Readonly<Record<Exclude<TraitColor, "umbra">, ResonanceEffect>> = {
  crimson: {
    name: "冷たい炎",
    lines: ["燃焼の確率が、すべて冷気の確率に変わる", "射撃ダメージが少し上がる"],
    apply: (s) => {
      s.chillChance += Math.max(0, s.burnChance);
      s.burnChance = 0;
      s.rangedDamageMul += frac(RESONANCE.coldFlameShift);
    },
  },
  azure: {
    name: "熱い氷",
    lines: ["冷気の確率が、すべて燃焼の確率に変わる", `射撃のたびに ${Math.round(RESONANCE.hotIceChance * PERCENT)}% の確率で、周囲の敵を燃やす`],
    apply: both(
      (s) => {
        s.burnChance += Math.max(0, s.chillChance);
        s.chillChance = 0;
      },
      trigger({
        trigger: "onShoot",
        condition: "always",
        effect: "burnNearby",
        magnitude: amt(RESONANCE.hotIceDps),
        duration: RESONANCE.hotIceSec,
        chance: RESONANCE.hotIceChance,
      }),
    ),
  },
  jade: {
    name: "枯れ森",
    lines: ["命中・撃破・自然回復で戻る生命が半分になる", `被弾すると周囲に衝撃波を放つ（${amt(RESONANCE.witheredWave)} ダメージ）`],
    apply: both(
      (s) => {
        s.lifeOnHit *= RESONANCE.witheredHealMul;
        s.lifeOnKill *= RESONANCE.witheredHealMul;
        s.hpRegen *= RESONANCE.witheredHealMul;
      },
      trigger({ trigger: "onHurt", condition: "always", effect: "shockwave", magnitude: amt(RESONANCE.witheredWave), chance: 1 }),
    ),
  },
  gold: {
    name: "暗雷",
    lines: ["会心が出なくなる", `攻撃で敵を感電させやすくなり、近接で ${Math.round(RESONANCE.darkThunderChance * PERCENT)}% の確率で連鎖雷を呼ぶ`],
    apply: both(
      (s) => {
        s.critChance = 0;
        s.shockChance += frac(RESONANCE.darkThunderShock);
      },
      trigger({
        trigger: "onMeleeHit",
        condition: "always",
        effect: "chainLightning",
        magnitude: amt(RESONANCE.darkThunderDamage),
        chance: RESONANCE.darkThunderChance,
      }),
    ),
  },
};

/** 拮抗の効果。key は TRAIT_COLORS 順の "a+b"（紅と蒼 / 翠と金）。docs/ideas/loot-expansion.md 9-3 */
export const BALANCE_EFFECTS: Readonly<Record<string, ResonanceEffect>> = {
  "crimson+azure": {
    name: "天秤",
    lines: [
      `近接と射撃を交互に当てるたび与ダメージ +${Math.round(RESONANCE.balanceStep * PERCENT)}%（交互に当て続ける間は重なる。上限 +${Math.round(RESONANCE.balanceCap * PERCENT)}%）`,
    ],
    apply: (s) => {
      s.traits.alternateDamageStep += frac(RESONANCE.balanceStep);
      s.traits.alternateDamageCap = Math.max(s.traits.alternateDamageCap, frac(RESONANCE.balanceCap));
    },
  },
  "jade+gold": {
    name: "表裏",
    lines: [
      `生命が半分以上なら与ダメージ +${Math.round(RESONANCE.twoFacesDamage * PERCENT)}%`,
      `生命が半分未満なら被ダメージ -${Math.round(RESONANCE.twoFacesGuard * PERCENT)}%`,
    ],
    apply: (s) => {
      s.traits.highHpDamageMul += frac(RESONANCE.twoFacesDamage);
      s.traits.lowHpGuard += frac(RESONANCE.twoFacesGuard);
    },
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
  const variant = formEffect(resonance);
  if (variant !== undefined) return variant;
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

/** 陰画・拮抗の効果（変形でなければ undefined） */
function formEffect(resonance: Resonance): ResonanceEffect | undefined {
  if (resonance.form === "negative") {
    const color = resonance.colors[0];
    return color === undefined || color === "umbra" ? undefined : NEGATIVE_EFFECTS[color];
  }
  if (resonance.form === "balance") {
    const [a, b] = resonance.colors;
    return a === undefined || b === undefined ? undefined : BALANCE_EFFECTS[dualKey(a, b)];
  }
  return undefined;
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
  if (resonance.form === "negative") return `共鳴 ${effect.name}（${labels.join("")}の陰画）`;
  if (resonance.form === "balance") return `共鳴 ${effect.name}（${labels.join("と")}の拮抗）`;
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
  return [...describeColorResonance(resonance), ...describeConstellation(resonance.constellation)];
}

function describeColorResonance(resonance: Resonance): string[] {
  const effect = resonanceEffect(resonance);
  if (effect === undefined) return [...NONE_LINES];
  const lines = [headline(resonance, effect), ...effect.lines];
  const attrLine = resonanceAttributeLine(resonance);
  if (attrLine !== undefined) lines.push(attrLine);
  if (resonance.kind === "dominant") {
    lines.push(`ほかの色の性質は効果が ${Math.round(OFF_COLOR_DAMPING * PERCENT_SCALE)}% に下がる`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 星座（6 部位の主色の並び。docs/ideas/loot-expansion.md 9-4）
// ---------------------------------------------------------------------------

/** 部位の輪（右手 - 左手 - 首飾り - 鎧 - 靴 - 指輪 - 右手）。隣り合い・向かい合いはこの並びで見る */
export const CONSTELLATION_RING: readonly Slot[] = ["mainHand", "offHand", "amulet", "armor", "boots", "ring"];
/** 輪で向かい合う 3 組 */
const OPPOSED_SLOTS: readonly (readonly [Slot, Slot])[] = [
  ["mainHand", "armor"],
  ["offHand", "boots"],
  ["amulet", "ring"],
];

export type MainColors = Readonly<Record<Slot, TraitColor | undefined>>;

/**
 * 遺物 1 つの主色: 性質（implicit を除く）の色の重みが最も大きい色。同点なら先に付いた性質の色。
 * 色を持たない（脱色済み・性質なし）なら undefined
 */
export function itemMainColor(affixes: readonly AffixRoll[]): TraitColor | undefined {
  const weights = colorWeights(affixes);
  const best = Math.max(...TRAIT_COLORS.map((c) => weights[c]));
  if (best <= 0) return undefined;
  for (const roll of affixes) {
    const color = traitColorOf(roll);
    if (color !== undefined && Math.abs(weights[color] - best) < FLOAT_EPSILON) return color;
  }
  return undefined;
}

/** 装備の部位ごとの主色（空き部位は undefined） */
export function mainColors(equipment: Equipment): MainColors {
  const out: Record<Slot, TraitColor | undefined> = {
    mainHand: undefined,
    offHand: undefined,
    armor: undefined,
    boots: undefined,
    ring: undefined,
    amulet: undefined,
  };
  for (const slot of CONSTELLATION_RING) {
    const item = equipment[slot];
    if (item !== null) out[slot] = itemMainColor(item.affixes);
  }
  return out;
}

function same(a: TraitColor | undefined, b: TraitColor | undefined): boolean {
  return a !== undefined && a === b;
}

/** 輪の上の隣り合う 2 部位（最後と最初も隣り合う） */
function ringNeighbors(): (readonly [Slot, Slot])[] {
  return CONSTELLATION_RING.map((slot, i) => [slot, CONSTELLATION_RING[(i + 1) % CONSTELLATION_RING.length] ?? slot] as const);
}

type ConstellationRule = (main: MainColors) => boolean;

const CONSTELLATION_RULES: Readonly<Record<ConstellationKey, ConstellationRule>> = {
  // 左手（offHand）は今はベースが無く常に空なので、twins / shores は「銃なし」のときと同じく成立しない
  twins: (m) => same(m.mainHand, m.offHand),
  shores: (m) =>
    m.mainHand !== undefined && m.offHand !== undefined && (OPPOSITE_COLOR[m.mainHand] === m.offHand || OPPOSITE_COLOR[m.offHand] === m.mainHand),
  spine: (m) => same(m.amulet, m.armor) && same(m.armor, m.boots),
  ring: (m) => new Set(CONSTELLATION_RING.map((s) => m[s]).filter((c) => c !== undefined)).size === TRAIT_COLORS.length,
  mirror: (m) => OPPOSED_SLOTS.every(([a, b]) => same(m[a], m[b])),
  void: (m) =>
    CONSTELLATION_RING.filter((s) => m[s] === "umbra").length >= RESONANCE.voidMinUmbra &&
    ringNeighbors().every(([a, b]) => !(m[a] === "umbra" && m[b] === "umbra")),
  chain: (m) =>
    CONSTELLATION_RING.every((s) => m[s] !== undefined) && ringNeighbors().every(([a, b]) => m[a] !== m[b]),
};

/** 判定の順（表の順で最初に成立したもの 1 つ） */
const CONSTELLATION_ORDER: readonly ConstellationKey[] = ["twins", "shores", "spine", "ring", "mirror", "void", "chain"];

/** 主色の並びから星座を 1 つ決める。成立しなければ undefined */
export function resolveConstellation(main: MainColors): ConstellationKey | undefined {
  return CONSTELLATION_ORDER.find((key) => CONSTELLATION_RULES[key](main));
}

export interface ConstellationDef {
  name: string;
  /** 並びの条件（UI） */
  pattern: string;
  /** 動詞で語る効果。最後の行が代償 */
  lines: readonly string[];
  apply: (stats: PlayerStats) => void;
}

const pctText = (ratio: number): number => Math.round(ratio * PERCENT);

/** 星座の効果。すべて代償を持つ（単一の最強の並びを作らない） */
export const CONSTELLATIONS: Readonly<Record<ConstellationKey, ConstellationDef>> = {
  twins: {
    name: "双子",
    pattern: "武器と銃が同じ主色",
    lines: [
      `近接と射撃のダメージ上昇の ${pctText(RESONANCE.twinsShare)}% が、もう片方にも乗る`,
      `代償: 攻撃速度・連射速度 -${pctText(RESONANCE.twinsTempoLoss)}%`,
    ],
    apply: (s) => {
      const melee = Math.max(0, s.meleeDamageMul - 1);
      const ranged = Math.max(0, s.rangedDamageMul - 1);
      s.meleeDamageMul += ranged * RESONANCE.twinsShare;
      s.rangedDamageMul += melee * RESONANCE.twinsShare;
      s.attackSpeedMul -= RESONANCE.twinsTempoLoss;
      s.fireRateMul -= RESONANCE.twinsTempoLoss;
    },
  },
  shores: {
    name: "対岸",
    pattern: "武器と銃が反対色",
    lines: [
      `直前と違う攻撃手段で当てると怯み値 +${pctText(RESONANCE.shoresPoise)}%`,
      `代償: 同じ手段が続くと怯み値 -${pctText(RESONANCE.shoresRepeat)}%`,
    ],
    apply: (s) => {
      s.traits.alternatePoiseMul += RESONANCE.shoresPoise;
      s.traits.repeatPoisePenalty += RESONANCE.shoresRepeat;
    },
  },
  spine: {
    name: "背骨",
    pattern: "首飾り・鎧・靴が同じ主色",
    lines: [`被ダメージ -${pctText(RESONANCE.spineGuard)}%`, `代償: 移動速度 -${pctText(RESONANCE.spineSlow)}%`],
    apply: (s) => {
      s.damageTakenMul -= RESONANCE.spineGuard;
      s.moveSpeedMul -= RESONANCE.spineSlow;
    },
  },
  ring: {
    name: "環",
    pattern: "6 部位の主色に 5 色すべてがそろう",
    lines: [`全ステータス +${RESONANCE.ringAttr}`, `代償: 最大気力 -${RESONANCE.ringManaLoss}`],
    apply: (s) => {
      for (const k of ATTR_KEYS) s.attributes[k] += RESONANCE.ringAttr;
      s.maxMana -= RESONANCE.ringManaLoss;
    },
  },
  mirror: {
    name: "鏡像",
    pattern: "輪で向かい合う 3 組（武器と鎧・銃と靴・首飾りと指輪）が同じ主色",
    lines: [`装備のトリガーの発動間隔 -${pctText(RESONANCE.mirrorIcdCut)}%`, `代償: 最大生命 -${RESONANCE.mirrorHpLoss}`],
    apply: (s) => {
      s.traits.triggerIcdCut = Math.max(s.traits.triggerIcdCut, RESONANCE.mirrorIcdCut);
      s.maxHp -= RESONANCE.mirrorHpLoss;
    },
  },
  void: {
    name: "虚空",
    pattern: `主色が冥の遺物が ${RESONANCE.voidMinUmbra} つ以上で、隣り合わない`,
    lines: ["反転した性質の負の値が 0 になる", `代償: 被ダメージ +${pctText(RESONANCE.voidExposure)}%`],
    // 反転の打ち消しは性質の適用前に掛ける（stats.ts が cancelInversions を呼ぶ）。ここは代償だけ
    apply: (s) => {
      s.damageTakenMul += RESONANCE.voidExposure;
    },
  },
  chain: {
    name: "鎖",
    pattern: "隣り合う部位がすべて違う主色（6 部位すべて）",
    lines: [`直前と違う攻撃手段で当てるたびに気力 +${RESONANCE.chainMana}`, `代償: 気力回収 -${pctText(RESONANCE.chainGainLoss)}%`],
    apply: (s) => {
      s.traits.switchMana += RESONANCE.chainMana;
      s.manaGainMul -= RESONANCE.chainGainLoss;
    },
  },
};

/** 虚空: 反転した性質の値を 0 にしたコピー（散光の打ち消しと同じ扱い） */
export function cancelInversions(rolls: readonly AffixRoll[]): AffixRoll[] {
  return rolls.map((roll) => (roll.inverted === true ? scaled(roll, SCATTER_INVERSION_CANCEL) : roll));
}

export function applyConstellation(stats: PlayerStats, key: ConstellationKey): void {
  CONSTELLATIONS[key].apply(stats);
}

function describeConstellation(key: ConstellationKey | undefined): string[] {
  if (key === undefined) return [];
  const def = CONSTELLATIONS[key];
  return [`星座 ${def.name}（${def.pattern}）`, ...def.lines];
}
