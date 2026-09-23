import { isTriggerKey } from "./triggers";
import { traitColorOf } from "./colors";
import {
  TRAIT_COLORS,
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
 * 判定順は 支配 → 二重 → 散光 → なし。
 * 数値効果は computeStats（stats.ts）が段階適用の後・ソフトキャップの前に畳み込み、
 * メカニクスはトリガー文法（TriggeredEffect）で表す（戦闘側の追加実装なしで動く）。
 */

/** 支配: 1 色が全体のこの比率以上 */
export const DOMINANT_RATIO = 0.5;
/** 二重: 上位 2 色がそれぞれこの比率以上 */
export const DUAL_MIN_RATIO = 0.3;
/** 散光: すべての色がこの比率未満 */
export const SCATTER_MAX_RATIO = 0.3;
/** 支配中、支配色以外の性質の値に掛かる係数 */
export const OFF_COLOR_DAMPING = 0.75;
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
export function colorWeights(rolls: readonly AffixRoll[]): ColorWeights {
  const weights = emptyWeights();
  for (const roll of rolls) {
    const color = traitColorOf(roll);
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

/** 重みから共鳴を 1 つ決める（支配 → 二重 → 散光 → なし） */
export function resolveResonance(weights: Readonly<ColorWeights>): Resonance {
  const { ratios, total } = toRatios(weights);
  const none: Resonance = { ...createEmptyResonance(), ratios };
  if (total < MIN_RESONANCE_WEIGHT) return none;
  const [first, second] = rankColors(ratios);
  if (first === undefined || second === undefined) return none;
  if (ratios[first] >= DOMINANT_RATIO) return { kind: "dominant", colors: [first], ratios };
  if (ratios[first] >= DUAL_MIN_RATIO && ratios[second] >= DUAL_MIN_RATIO) {
    return { kind: "dual", colors: inPaletteOrder([first, second]), ratios };
  }
  if (TRAIT_COLORS.every((c) => ratios[c] < SCATTER_MAX_RATIO)) return { kind: "scatter", colors: [], ratios };
  return none;
}

export function computeResonance(rolls: readonly AffixRoll[]): Resonance {
  return resolveResonance(colorWeights(rolls));
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

/**
 * 共鳴に応じて性質の値を調整したコピーを返す（元の roll は変えない）。
 * - 支配: 支配色以外の色を持つ性質を OFF_COLOR_DAMPING 倍（色を持たない implicit は対象外）
 * - 冥の支配（虚極）: 反転した性質の負の値を正として扱う
 */
export function adjustForResonance(rolls: readonly AffixRoll[], resonance: Resonance): AffixRoll[] {
  if (resonance.kind !== "dominant") return [...rolls];
  const dominant = resonance.colors[0];
  return rolls.map((roll) => {
    const color = traitColorOf(roll);
    const base = dominant === "umbra" ? absolute(roll) : roll;
    if (color === undefined || color === dominant) return base;
    return scaled(base, OFF_COLOR_DAMPING);
  });
}

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
    lines: ["反転した性質の負の値を、正の値として扱う", "代わりに受ける傷が少し深くなる"],
    apply: (s) => {
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
    lines: ["攻撃が敵を凍らせやすくなる", "攻撃が感電を起こしやすくなる"],
    apply: (s) => {
      s.chillChance += 0.1;
      s.shockChance += 0.1;
    },
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

export const SCATTER_EFFECT: ResonanceEffect = {
  name: "虹",
  lines: ["近接・射撃・攻撃速度・連射・移動が少しずつ伸びる", "エネルギーが溜まりやすくなる"],
  apply: (s) => {
    s.meleeDamageMul += 0.05;
    s.rangedDamageMul += 0.05;
    s.attackSpeedMul += 0.05;
    s.fireRateMul += 0.05;
    s.moveSpeedMul += 0.05;
    s.energyGainMul += 0.1;
  },
};

export function dualKey(a: TraitColor, b: TraitColor): string {
  const [x, y] = inPaletteOrder([a, b]);
  return `${x ?? a}+${y ?? b}`;
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
    case "scatter":
      return SCATTER_EFFECT;
    case "none":
      return undefined;
  }
}

/** 共鳴の数値効果・トリガーを stats に畳み込む */
export function applyResonanceEffect(stats: PlayerStats, resonance: Resonance): void {
  resonanceEffect(resonance)?.apply(stats);
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
  if (resonance.kind === "dominant") {
    lines.push(`支配していない色の性質は ${Math.round(OFF_COLOR_DAMPING * PERCENT_SCALE)}% に弱まる`);
  }
  return lines;
}
