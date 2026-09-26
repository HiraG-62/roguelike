import { ELEMENTS, type Element } from "../core/element";
import type { Rng } from "../core/rng";
import { INNATE } from "../data/tuning";
import { movesetMainAttrs, type MovesetKey } from "../data/weapons";
import { ATTR_TRAIT_PREFIX, RESIST_TRAIT_PREFIX } from "./affixes";
import type { BaseItemDef } from "./bases";
import { BULLETS } from "./bullets";
import { ATTR_KEYS, type AffixRoll, type AttrKey, type Equipment, type Item, SLOTS, type Slot } from "./types";

/**
 * 地金（じがね。内部 innate）: ベースに既定で宿るステータス・防御力・属性耐性。性質（affixes）とは別の層で、
 * 余白・色の配合・共鳴・クラフトの対象外。数値は src/data/balance/loot/INNATE/。
 *
 * 予算（点）を深度で抽選してから「項目数 × 値」に配るので、値も項目数も両方多い遺物は出にくい。
 * 防具（右手以外）は防御力が必ず付く（予算を使わない）。武器は防御力の確定行を持たない。
 * 抽選は generateItem の item 専用 rng の末尾で行う（state.rng の消費数は変えない）
 */

/** 地金の行の key（既存の性質の定義の apply をそのまま使う） */
export const INNATE_ARMOR_KEY = "armorFlat";
/** 防御力の端数の桁（小数 1 桁） */
const ARMOR_DECIMALS = 1;

type ArmorSlot = keyof typeof INNATE.armor.base;
type ResistElement = Exclude<Element, "none">;

const RESIST_ELEMENTS: readonly ResistElement[] = ELEMENTS.filter((e): e is ResistElement => e !== "none");

type InnatePick =
  | { kind: "attr"; key: AttrKey }
  | { kind: "resist"; key: ResistElement }
  | { kind: "armor" };

interface Candidate {
  pick: InnatePick;
  weight: number;
}

function isAttrKey(v: string): v is AttrKey {
  return (ATTR_KEYS as readonly string[]).includes(v);
}

function isArmorSlot(slot: Slot): slot is ArmorSlot {
  return Object.hasOwn(INNATE.armor.base, slot);
}

function roundTo(v: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(v * scale) / scale;
}

// ---------------------------------------------------------------------------
// 予算
// ---------------------------------------------------------------------------

/** 深度ごとの予算の倍率（INNATE.depthScale を線形補間。範囲外は端の値） */
export function innateDepthScale(depth: number): number {
  const points = [...INNATE.depthScale].sort((a, b) => a.depth - b.depth);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return 1;
  if (depth <= first.depth) return first.scale;
  if (depth >= last.depth) return last.scale;
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1];
    const hi = points[i];
    if (lo === undefined || hi === undefined || depth > hi.depth) continue;
    const t = (depth - lo.depth) / (hi.depth - lo.depth);
    return lo.scale + (hi.scale - lo.scale) * t;
  }
  return last.scale;
}

/** 予算の期待値（点） */
export function innateMeanBudget(depth: number): number {
  const b = INNATE.budget;
  return Math.min(Math.max(0, b.base + b.perDepth * depth), b.cap) * innateDepthScale(depth);
}

/** 予算の絶対上限（点） */
export function innateHardCap(depth: number): number {
  return INNATE.hardCap.base + INNATE.hardCap.perDepth * depth;
}

/** 三角分布（下端 low・頂 mode・上端 high）。幅 0 なら mode */
function triangular(rng: Rng, low: number, mode: number, high: number): number {
  const u = rng.next();
  if (high - low <= 0) return mode;
  const f = (mode - low) / (high - low);
  if (u < f) return low + Math.sqrt(u * (high - low) * (mode - low));
  return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

/** 予算を抽選する（0 以上の整数点）。boost はボス・宝物庫などの上振れ */
export function rollInnateBudget(rng: Rng, depth: number, boost: number): number {
  const mean = innateMeanBudget(depth);
  const b = INNATE.budget;
  const raw = triangular(rng, mean * b.lowScale, mean, mean * b.highScale + Math.max(0, boost) * b.boostScale);
  return Math.max(0, Math.min(Math.round(raw), innateHardCap(depth)));
}

// ---------------------------------------------------------------------------
// 項目の種類
// ---------------------------------------------------------------------------

/** 武器の出やすいステータス: 武器種の全行動（銃は弾も）の係数の合計の上位 */
export function weaponLeanAttrs(base: BaseItemDef): AttrKey[] {
  const moveset: MovesetKey | undefined = base.moveset;
  if (moveset === undefined) return [];
  const bullet = BULLETS[base.key]?.scaling;
  return movesetMainAttrs(moveset, INNATE.weaponLeanTop, bullet === undefined ? [] : [bullet]);
}

/** 部位の出やすいステータス（右手は武器種から） */
export function innateLeanAttrs(base: BaseItemDef): AttrKey[] {
  if (base.slot === "mainHand") return weaponLeanAttrs(base);
  const lean: readonly string[] = (INNATE.slotLean as Readonly<Partial<Record<Slot, readonly string[]>>>)[base.slot] ?? [];
  return lean.filter(isAttrKey);
}

function candidatesFor(base: BaseItemDef): Candidate[] {
  const lean = innateLeanAttrs(base);
  const attrs: Candidate[] = ATTR_KEYS.map((key) => ({
    pick: { kind: "attr", key },
    weight: lean.includes(key) ? INNATE.leanWeight : 1,
  }));
  if (!isArmorSlot(base.slot)) return attrs;
  const resists: Candidate[] = RESIST_ELEMENTS.map((key) => ({ pick: { kind: "resist", key }, weight: INNATE.resistWeight }));
  return [...attrs, ...resists, { pick: { kind: "armor" }, weight: 1 }];
}

function resistLimit(slot: Slot): number {
  return (INNATE.resistLines as Readonly<Partial<Record<Slot, number>>>)[slot] ?? 0;
}

function maxLinesOf(slot: Slot): number {
  return (INNATE.maxLines as Readonly<Partial<Record<Slot, number>>>)[slot] ?? 0;
}

/** 重み付きで 1 つ選ぶ（重み合計 0 以下なら undefined） */
function weightedTake(rng: Rng, pool: readonly Candidate[]): number | undefined {
  const total = pool.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  if (total <= 0) return undefined;
  let r = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= Math.max(0, pool[i]?.weight ?? 0);
    if (r < 0) return i;
  }
  return pool.length - 1;
}

/** 重み付きで n 個（重複なし）。属性耐性は部位の上限に達したら候補から外す */
function pickKinds(rng: Rng, base: BaseItemDef, n: number): InnatePick[] {
  let pool = candidatesFor(base);
  const picks: InnatePick[] = [];
  const limit = resistLimit(base.slot);
  while (picks.length < n) {
    const index = weightedTake(rng, pool);
    const chosen = index === undefined ? undefined : pool[index];
    if (chosen === undefined) break;
    picks.push(chosen.pick);
    pool = pool.filter((_, i) => i !== index);
    if (picks.filter((p) => p.kind === "resist").length >= limit) pool = pool.filter((c) => c.pick.kind !== "resist");
  }
  return picks;
}

/** 項目数: 1 + floor(予算 / linesPerPoint) + 確率で 1。部位の上限と予算（1 項目 1 点以上）で締める */
function rollLineCount(rng: Rng, slot: Slot, budget: number): number {
  const extra = rng.chance(INNATE.extraLineChance) ? 1 : 0;
  const n = 1 + Math.floor(budget / INNATE.linesPerPoint) + extra;
  return Math.min(n, maxLinesOf(slot), budget);
}

/** 各項目に 1 点、残りを 1 点ずつ一様に配る */
function distribute(rng: Rng, budget: number, n: number): number[] {
  const points = Array.from({ length: n }, () => 1);
  for (let left = budget - n; left > 0; left--) {
    const i = rng.int(0, n - 1);
    points[i] = (points[i] ?? 0) + 1;
  }
  return points;
}

// ---------------------------------------------------------------------------
// 生成本体
// ---------------------------------------------------------------------------

function innateRoll(key: string, value: number): AffixRoll {
  return { key, value, origin: "innate" };
}

/** 点 → 行。順は 防御力 → ステータス（ATTR_KEYS 順）→ 属性耐性（ELEMENTS 順） */
function toRolls(base: BaseItemDef, picks: readonly InnatePick[], points: readonly number[]): AffixRoll[] {
  const slot = base.slot;
  let armor = isArmorSlot(slot) ? INNATE.armor.base[slot] : 0;
  const attrs = new Map<AttrKey, number>();
  const resists = new Map<ResistElement, number>();
  picks.forEach((pick, i) => {
    const p = points[i] ?? 0;
    if (pick.kind === "armor" && isArmorSlot(slot)) armor += p * INNATE.armor.perPoint[slot];
    if (pick.kind === "attr") attrs.set(pick.key, p * INNATE.pointValue.attr);
    if (pick.kind === "resist") resists.set(pick.key, p * INNATE.pointValue.resist);
  });
  const rolls: AffixRoll[] = [];
  if (isArmorSlot(slot)) rolls.push(innateRoll(INNATE_ARMOR_KEY, roundTo(armor, ARMOR_DECIMALS)));
  for (const k of ATTR_KEYS) {
    const v = attrs.get(k);
    if (v !== undefined) rolls.push(innateRoll(`${ATTR_TRAIT_PREFIX}${k}`, v));
  }
  for (const e of RESIST_ELEMENTS) {
    const v = resists.get(e);
    if (v !== undefined) rolls.push(innateRoll(`${RESIST_TRAIT_PREFIX}${e}`, v));
  }
  return rolls;
}

/**
 * 地金を抽選する（純関数。rng は item 専用のものを渡す）。plain（借り物・初期武器）は空。
 * 予算 0 の防具は防御力の確定行だけ
 */
export function rollInnate(rng: Rng, base: BaseItemDef, depth: number, boost: number, plain: boolean): AffixRoll[] {
  if (plain) return [];
  const budget = rollInnateBudget(rng, depth, boost);
  if (budget <= 0) return toRolls(base, [], []);
  const picks = pickKinds(rng, base, rollLineCount(rng, base.slot, budget));
  return toRolls(base, picks, distribute(rng, budget, picks.length));
}

/** 装備中の地金（SLOTS 順）。旧セーブ・リプレイのスナップショットは innate が無いので空として読む */
export function collectInnate(equipment: Equipment): AffixRoll[] {
  return SLOTS.flatMap((slot) => equipment[slot]?.innate ?? []);
}

/** アイテムの地金（無ければ空） */
export function itemInnate(item: Pick<Item, "innate">): readonly AffixRoll[] {
  return item.innate ?? [];
}
