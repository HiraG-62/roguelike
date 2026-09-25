import { type Rng, createRng } from "../core/rng";
import type { MovesetKey } from "../data/weapons";
import { artWeightFor } from "./arts";
import { MODIFIERS, SKILL, SKILL_DEFS, SKILL_MIN_DEPTH, SKILL_WEIGHTS, canAttach } from "./data";
import { modifierWeight } from "./modifiers";
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type RuneItem, type SkillKey, type SkillStone, type VariantRoll } from "./types";

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
  /** 装備中の武器種。その武器種の武器技を出やすくする（省略はどの武器技も同じ薄さ） */
  moveset?: MovesetKey;
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

/** 抽選の重み。武器技は装備中の武器種なら厚く、違う武器種なら薄く（skills/arts/index.ts の artWeightFor） */
export function skillWeight(key: SkillKey, moveset: MovesetKey | undefined): number {
  return artWeightFor(key, moveset) ?? SKILL_WEIGHTS[key];
}

/** SKILL_WEIGHTS に従ってスキルの種類を選ぶ。拾った深度より深い層から出るスキル（SKILL_MIN_DEPTH）は除く */
function rollSkillKey(rng: Rng, depth: number, moveset: MovesetKey | undefined): SkillKey {
  const pool = SKILL_KEYS.filter((k) => SKILL_MIN_DEPTH[k] <= Math.max(1, depth));
  const idx = weightedIndex(
    rng,
    pool.map((k) => skillWeight(k, moveset)),
  );
  return pool[idx] ?? SKILL_KEYS[0];
}

/** seed から石を作る（同じ seed なら id / foundAt 以外は同じ） */
export function stoneFromSeed(seed: number, opts: StoneOptions): SkillStone {
  const rng = createRng(seed);
  const skillKey = opts.skillKey ?? rollSkillKey(rng, opts.foundDepth, opts.moveset);
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

/**
 * 刻印符の種類: 装着中スキルのどれかに付けられるものから選ぶ（装着が無ければ全種）。
 * 型替え符は珍しい（modifierWeight）。通常の刻印符どうしは同じ重み
 */
export function rollRuneModifier(rng: Rng, equipped: readonly SkillKey[]): ModifierKey {
  const fits = MODIFIER_KEYS.filter((k) => equipped.some((s) => canAttach(SKILL_DEFS[s], k)));
  const pool = fits.length > 0 ? fits : [...MODIFIER_KEYS];
  const idx = weightedIndex(
    rng,
    pool.map((k) => modifierWeight(MODIFIERS[k])),
  );
  return pool[idx] ?? MODIFIER_KEYS[0];
}


/** 撃破時の刻印符ドロップの出どころ。エリート・ボス・図書館・巣窟は出やすい */
export type RuneDropSource = keyof typeof SKILL.drop.runeOnKill;

/** 撃破時に刻印符が落ちる確率。通常の敵だけ深度で少し増える */
export function runeDropChance(depth: number, source: RuneDropSource): number {
  const d = SKILL.drop;
  if (source !== "normal") return d.runeOnKill[source];
  return d.runeOnKill.normal + Math.min(d.runeOnKillDepthCap, Math.max(0, depth) * d.runeOnKillPerDepth);
}

/**
 * 撃破時の刻印符ドロップの抽選。落ちるなら種類、落ちなければ null。
 * 乱数は必ず 1 回引き（落ちたときだけ種類でもう 1 回）、呼び出し側の乱数列を出どころで揺らさない
 */
export function rollRuneDrop(
  rng: Rng,
  depth: number,
  source: RuneDropSource = "normal",
  equipped: readonly SkillKey[] = [],
): ModifierKey | null {
  if (!rng.chance(runeDropChance(depth, source))) return null;
  return rollRuneModifier(rng, equipped);
}

/** 所持品の刻印符を作る。idSeed は床の刻印符の id など（now と合わせて一意にする。決定性に影響しない） */
export function makeRuneItem(modifier: ModifierKey, idSeed: number, now: number): RuneItem {
  return { id: `r${idSeed.toString(ID_RADIX)}-${now.toString(ID_RADIX)}`, modifier, foundAt: now };
}
