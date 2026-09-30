import { ELEMENTS, type Element } from "../core/element";
import type { Rng } from "../core/rng";
import { curveAt, triangular } from "../core/scale";
import { ENEMY_SCALE, INNATE } from "../data/tuning";
import { movesetMainAttrs, type MovesetKey } from "../data/weapons";
import { ATTR_TRAIT_PREFIX, RESIST_TRAIT_PREFIX } from "./affixes";
import type { BaseItemDef } from "./bases";
import { BULLETS } from "./bullets";
import { ATTR_KEYS, type AffixRoll, type AttrKey, type Equipment, type Item, SLOTS, type Slot } from "./types";

/**
 * 地金（じがね。内部 innate）: ベースに既定で宿るステータス・防御力・属性耐性。性質（affixes）とは別の層で、
 * 余白・共鳴の数え・クラフトの対象外。数値は src/data/balance/loot/INNATE/。
 *
 * 予算（点）を深度で抽選してから「項目数 × 値」に配るので、値も項目数も両方多い遺物は出にくい。
 * 防具（右手以外）は防御力が必ず付く（予算を使わない）。武器は防御力の確定行を持たない。
 * 抽選は generateItem の item 専用 rng の末尾で行う（state.rng の消費数は変えない）
 *
 * 持ち込み（docs/ideas/core-synthesis.md 3-1「地金はどう伸びるか」）: Item.innate は拾った深度での行として残し、
 * 実際に効く値は innateAt が「今の深度の期待値 × 拾った時の上振れ（innateLuck）」を拾った時の配分で配り直して作る。
 * 深い階で拾った遺物を浅い階へ持ち込んでも序盤が壊れず、浅い階の遺物も深みで腐らない
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

/**
 * 予算の期待値（点）。base + perDepth × 深度 に depthScale を掛ける。上限は持たず、深み（ENEMY_SCALE.deepDepth 以降）は
 * 敵の生命と同じ指数（deepHpGrowth）で伸ばす（敵の曲線に地金が置いていかれないように）
 */
export function innateMeanBudget(depth: number): number {
  const b = INNATE.budget;
  // curveAt は base + perDepth × (d − 1) なので、深度 1 の値 base + perDepth を基準に渡す
  const curve = { base: b.base + b.perDepth, perDepth: b.perDepth, deepDepth: ENEMY_SCALE.deepDepth, deepGrowth: ENEMY_SCALE.deepHpGrowth };
  return Math.max(0, curveAt(curve, depth)) * innateDepthScale(depth);
}

/** 予算の抽選値（丸める前の点）。boost はボス・宝物庫などの上振れ */
function rollRawBudget(rng: Rng, depth: number, boost: number): number {
  const mean = innateMeanBudget(depth);
  const b = INNATE.budget;
  return triangular(rng, mean * b.lowScale, mean, mean * b.highScale + Math.max(0, boost) * b.boostScale);
}

/** 予算を抽選する（0 以上の整数点）。boost はボス・宝物庫などの上振れ */
export function rollInnateBudget(rng: Rng, depth: number, boost: number): number {
  return Math.max(0, Math.round(rollRawBudget(rng, depth, boost)));
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

/** 地金の抽選結果。luck = 抽選した予算（丸める前）÷ その深度の期待値。遺物の個性として Item.innateLuck に残す */
export interface InnateRoll {
  rolls: AffixRoll[];
  luck: number;
}

/** 上振れの既定（地金を持たない遺物・期待値 0 の深度）。どの深度でも期待値どおり */
const DEFAULT_LUCK = 1;

/**
 * 地金を抽選する（純関数。rng は item 専用のものを渡す）。plain（借り物・初期武器）は空。
 * 予算 0 の防具は防御力の確定行だけ
 */
export function rollInnate(rng: Rng, base: BaseItemDef, depth: number, boost: number, plain: boolean): InnateRoll {
  if (plain) return { rolls: [], luck: DEFAULT_LUCK };
  const raw = rollRawBudget(rng, depth, boost);
  const mean = innateMeanBudget(depth);
  const luck = mean > 0 ? raw / mean : DEFAULT_LUCK;
  const budget = Math.max(0, Math.round(raw));
  if (budget <= 0) return { rolls: toRolls(base, [], []), luck };
  const picks = pickKinds(rng, base, rollLineCount(rng, base.slot, budget));
  return { rolls: toRolls(base, picks, distribute(rng, budget, picks.length)), luck };
}

// ---------------------------------------------------------------------------
// 持ち込み: 今の深度で決め直す（rng を引かない）
// ---------------------------------------------------------------------------

/** 地金の行 1 つの読み方。点 = その行に配られた予算（防御力の確定分は数えない）。unknown は配り直さずそのまま残す */
interface InnateRow {
  kind: "attr" | "resist" | "armor" | "unknown";
  roll: AffixRoll;
  points: number;
}

/** 生成時の「点 × 1 点の値」を割り戻す。小数は防御力の丸めの端数なので四捨五入する */
function pointsOf(value: number, perPoint: number): number {
  if (perPoint <= 0) return 0;
  return Math.max(0, Math.round(value / perPoint));
}

function readRow(roll: AffixRoll, slot: Slot): InnateRow {
  if (roll.key === INNATE_ARMOR_KEY && isArmorSlot(slot)) {
    return { kind: "armor", roll, points: pointsOf(roll.value - INNATE.armor.base[slot], INNATE.armor.perPoint[slot]) };
  }
  if (roll.key.startsWith(ATTR_TRAIT_PREFIX)) return { kind: "attr", roll, points: pointsOf(roll.value, INNATE.pointValue.attr) };
  if (roll.key.startsWith(RESIST_TRAIT_PREFIX)) return { kind: "resist", roll, points: pointsOf(roll.value, INNATE.pointValue.resist) };
  return { kind: "unknown", roll, points: 0 };
}

type InnateSource = Pick<Item, "innate" | "innateLuck" | "itemLevel" | "slot">;

/**
 * 上振れを行から復元する（innateLuck を持たない旧アイテム）。点の合計 ÷ 拾った深度の期待値。
 * 地金が無ければ既定（配る先が無いので値は効かない）
 */
export function recoverInnateLuck(item: Pick<Item, "innate" | "itemLevel" | "slot">): number {
  const rows = item.innate ?? [];
  if (rows.length === 0) return DEFAULT_LUCK;
  const mean = innateMeanBudget(item.itemLevel);
  if (mean <= 0) return DEFAULT_LUCK;
  const total = rows.reduce((sum, r) => sum + readRow(r, item.slot).points, 0);
  return total / mean;
}

/** 遺物の上振れ。保存値が無い・壊れていれば行から復元する */
export function innateLuckOf(item: InnateSource): number {
  const stored = item.innateLuck;
  if (stored !== undefined && Number.isFinite(stored) && stored >= 0) return stored;
  return recoverInnateLuck(item);
}

/**
 * 最大剰余法: total 点を weights の比で整数に配る。整数の演算だけで決め（浮動小数の誤差で配りがぶれない）、
 * 端数の大きい順（同じなら重いほう・前のほう）に 1 点ずつ。重み 0 の行は 0 のまま（拾った時に無かった項目は増えない）
 */
function apportion(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((w * total) / sum));
  let left = total - out.reduce((a, v) => a + v, 0);
  const order = weights
    .map((w, i) => ({ i, w, rem: (w * total) % sum }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    out[o.i] = (out[o.i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/** 配り直した点から行を作る。ステータス・耐性は 0 点なら行ごと消す（防御力の確定行は残す） */
function rebuildRow(row: InnateRow, points: number, slot: Slot): AffixRoll | null {
  if (row.kind === "unknown") return row.roll;
  if (row.kind === "armor") {
    if (!isArmorSlot(slot)) return row.roll;
    return innateRoll(INNATE_ARMOR_KEY, roundTo(INNATE.armor.base[slot] + points * INNATE.armor.perPoint[slot], ARMOR_DECIMALS));
  }
  if (points <= 0) return null;
  const perPoint = row.kind === "attr" ? INNATE.pointValue.attr : INNATE.pointValue.resist;
  return innateRoll(row.roll.key, points * perPoint);
}

/**
 * 深度 depth での地金の行（純関数・rng を引かない）。配分は Item.innate の点の比、予算は innateMeanBudget(depth) × 上振れ。
 * 拾った深度（itemLevel）では Item.innate と同じ行になる
 */
export function innateAt(item: InnateSource, depth: number): AffixRoll[] {
  const source = item.innate ?? [];
  if (source.length === 0) return [];
  const rows = source.map((r) => readRow(r, item.slot));
  const total = Math.max(0, Math.round(innateMeanBudget(depth) * innateLuckOf(item)));
  const points = apportion(
    rows.map((r) => r.points),
    total,
  );
  return rows.map((row, i) => rebuildRow(row, points[i] ?? 0, item.slot)).filter((r): r is AffixRoll => r !== null);
}

/** 装備中の地金を深度 depth で決め直したもの（SLOTS 順）。旧セーブ・リプレイのスナップショットは innate が無いので空として読む */
export function collectInnate(equipment: Equipment, depth: number): AffixRoll[] {
  return SLOTS.flatMap((slot) => {
    const item = equipment[slot];
    return item ? innateAt(item, depth) : [];
  });
}

/** アイテムの地金（無ければ空） */
export function itemInnate(item: Pick<Item, "innate">): readonly AffixRoll[] {
  return item.innate ?? [];
}
