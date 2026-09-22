import { type Rng, createRng } from "../core/rng";
import { SKILL, SKILL_DEFS, SKILL_WEIGHTS, canAttach } from "./data";
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type SkillKey, type SkillStone, type VariantRoll } from "./types";

/**
 * スキル石の生成。レベル・tier は持たず、ロールされるのは変異軸とリンク数だけ。
 * 外から渡された rng からは seed を 1 回だけ引き、中身は seed から決定的に作る。
 */

export interface StoneOptions {
  foundDepth: number;
  /** epoch ms。id と foundAt の表示用（決定性に影響しない） */
  now: number;
  /** 指定すれば種類を固定する */
  skillKey?: SkillKey;
}

const SEED_MAX = 0x7fffffff;
const ID_RADIX = 36;

function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** -1..1 を 0.01 刻みで。0 は得失が無いので避ける */
function rollVariantValue(rng: Rng): number {
  const raw = rng.next() * 2 - 1;
  const v = Math.round(raw * SKILL.variantPrecision) / SKILL.variantPrecision;
  if (v !== 0) return v;
  return 1 / SKILL.variantPrecision;
}

function rollVariants(rng: Rng, skillKey: SkillKey): VariantRoll[] {
  const pool = [...SKILL_DEFS[skillKey].axes];
  const count = Math.min(pool.length, weightedIndex(rng, SKILL.variantCountWeights));
  const out: VariantRoll[] = [];
  for (let i = 0; i < count; i++) {
    const idx = rng.int(0, pool.length - 1);
    const [axis] = pool.splice(idx, 1);
    if (!axis) break;
    out.push({ axis, value: rollVariantValue(rng) });
  }
  return out;
}

/** SKILL_WEIGHTS に従ってスキルの種類を選ぶ */
function rollSkillKey(rng: Rng): SkillKey {
  const idx = weightedIndex(
    rng,
    SKILL_KEYS.map((k) => SKILL_WEIGHTS[k]),
  );
  return SKILL_KEYS[idx] ?? SKILL_KEYS[0];
}

/** seed から石を作る（同じ seed なら id / foundAt 以外は同じ） */
export function stoneFromSeed(seed: number, opts: StoneOptions): SkillStone {
  const rng = createRng(seed);
  const skillKey = opts.skillKey ?? rollSkillKey(rng);
  const links = weightedIndex(rng, SKILL.linkWeights);
  const variants = rollVariants(rng, skillKey);
  return {
    id: `s${seed.toString(ID_RADIX)}-${opts.now.toString(ID_RADIX)}`,
    seed,
    skillKey,
    variants,
    links,
    foundDepth: opts.foundDepth,
    foundAt: opts.now,
  };
}

export function generateSkillStone(rng: Rng, opts: StoneOptions): SkillStone {
  return stoneFromSeed(rng.int(1, SEED_MAX), opts);
}

/** 刻印符の種類: 装着中スキルのどれかに付けられるものから一様。装着が無ければ全種 */
export function rollRuneModifier(rng: Rng, equipped: readonly SkillKey[]): ModifierKey {
  const pool = MODIFIER_KEYS.filter((k) => equipped.some((s) => canAttach(SKILL_DEFS[s], k)));
  return rng.pick(pool.length > 0 ? pool : MODIFIER_KEYS);
}

