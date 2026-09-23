import { defaultColorOfKey } from "./colors";
import { isKeystoneKey } from "./affixes";
import { SLOTS, type AffixRoll, type Equipment, type Provenance, type TraitStats } from "./types";

/**
 * 性質が「自分の外」を読むための文脈（docs/ideas/loot-expansion.md 1-e）。
 * - 来歴で育つ性質（古傷・歴戦 …）: その遺物の来歴から段数を出し、値に掛けてから適用する
 * - 装備全体を見る性質（若木・銘の重み・裏の糧 …）: computeStats が適用の前に TraitStats の gear* へ入れる
 * どちらも純関数。state.rng は使わない
 */

interface ProvenanceStep {
  /** 1 段あたりに要る来歴の量 */
  per: number;
  /** 段の上限 */
  max: number;
  read: (p: Provenance) => number;
}

/** 来歴で育つ性質の key → 段の決め方。表示の「〜ごとに」「〜段まで」と揃える */
export const PROVENANCE_STEPS: Readonly<Record<string, ProvenanceStep>> = {
  oldScars: { per: 100, max: 5, read: (p) => p.hurtTaken },
  veteran: { per: 100, max: 8, read: (p) => p.kills },
  wayfarer: { per: 3, max: 6, read: (p) => p.floorsCleared },
  kingslayerMark: { per: 1, max: 5, read: (p) => p.bosses },
  keenMemory: { per: 25, max: 4, read: (p) => p.justDodges },
};

/** 来歴から段数（0..max） */
export function provenanceSteps(key: string, provenance: Provenance | undefined): number | undefined {
  const step = PROVENANCE_STEPS[key];
  if (step === undefined) return undefined;
  if (provenance === undefined) return 0;
  return Math.min(step.max, Math.floor(step.read(provenance) / step.per));
}

/** 来歴で育つ性質なら、値（と value2）を段数倍にしたコピー。それ以外はそのまま */
export function scaleByProvenance(roll: AffixRoll, provenance: Provenance | undefined): AffixRoll {
  const steps = provenanceSteps(roll.key, provenance);
  if (steps === undefined) return roll;
  const out: AffixRoll = { ...roll, value: roll.value * steps };
  if (roll.value2 !== undefined) out.value2 = roll.value2 * steps;
  return out;
}

/** 異色: 保存された色が既定の色と違う（反転と誓約は数えない） */
export function isOffColor(roll: AffixRoll): boolean {
  if (roll.inverted === true || isKeystoneKey(roll.key) || roll.color === undefined) return false;
  const base = defaultColorOfKey(roll.key);
  return base !== undefined && base !== roll.color;
}

export type GearContext = Pick<TraitStats, "gearMargin" | "gearItems" | "gearInscribed" | "gearInverted" | "gearOffColor">;

/** 文脈を持たない状態（畳み込み後の stats に残さない） */
export function gearContextCleared(): GearContext {
  return { gearMargin: 0, gearItems: 0, gearInscribed: 0, gearInverted: 0, gearOffColor: 0 };
}

/** 装備全体の文脈（余白・銘・反転・異色の数） */
export function gearContext(equipment: Equipment): GearContext {
  const ctx = gearContextCleared();
  for (const slot of SLOTS) {
    const item = equipment[slot];
    if (item === null) continue;
    ctx.gearItems += 1;
    ctx.gearMargin += Math.max(0, item.margin ?? 0);
    if (item.inscription !== undefined && item.inscription.length > 0) ctx.gearInscribed += 1;
    for (const roll of item.affixes) {
      if (roll.inverted === true) ctx.gearInverted += 1;
      if (isOffColor(roll)) ctx.gearOffColor += 1;
    }
  }
  return ctx;
}
