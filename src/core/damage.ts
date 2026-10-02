import type { Element } from "./element";
import type { DamageKind } from "./state";
import { TRIGGER } from "../data/tuning";

/**
 * 与ダメの「増」と「倍」（docs/ideas/scaling-impl.md 2-1）。型と純関数だけを置き、system は import しない。
 * 最終の与ダメ = 基礎 × (1 + Σ増) × Π倍 × 敵側。
 * - 増: 性質・地金・共鳴・流儀の偏りの数値。同じ 1 撃に効く増はすべて足してから 1 回掛ける（積むほど 1 点の価値が下がる）
 * - 倍: 誓約・芯・奥義・状態異常・コンボ・会心など出所が 1 つのもの。出所ごとに掛け合わせる（ビルドの顔）
 */

/** 増の壺のタグ。1 撃は複数を持つ（近接 + 炎 + 怯み中 …） */
export const DAMAGE_TAGS = [
  "melee",
  "ranged",
  "skill",
  "ultimate",
  "proc",
  "dot",
  "area",
  "placed",
  "minion",
  "fire",
  "ice",
  "lightning",
  "poison",
  "dark",
  "light",
  "vsStaggered",
  "vsBoss",
  "vsElite",
  "counter",
  "backstab",
  "reaction",
  "critMulti",
  "poise",
  /** 放出の一撃（戦意を使った振り・弾。system/morale.ts） */
  "release",
] as const;
export type DamageTag = (typeof DAMAGE_TAGS)[number];

/** 増の表（0.1 = +10%） */
export type IncreasedTable = Record<DamageTag, number>;

/** 属性のタグ。1 撃の属性の割合（share）の重みで足す */
const ELEMENT_TAGS: Readonly<Partial<Record<Element, DamageTag>>> = {
  fire: "fire",
  ice: "ice",
  lightning: "lightning",
  poison: "poison",
  dark: "dark",
  light: "light",
};

const ELEMENT_TAG_SET: ReadonlySet<DamageTag> = new Set(Object.values(ELEMENT_TAGS));

/**
 * 倍。source は同じ出所を 1 つに畳む鍵（"keystone:ks_glassCannon" / "boon:coreGlassHeart" / "combo" / "crit"）、
 * label は表示名（内訳の 1 行）。tags があれば、1 撃がそのどれかを持つときだけ掛かる（省略 = すべての 1 撃）
 */
export interface MoreMul {
  source: string;
  label: string;
  mul: number;
  tags?: readonly DamageTag[];
}

/** 1 撃の属性の割合（system/elementCombat.ts の ElementShare と同じ形） */
export interface DamageElementShare {
  element: Element;
  share: number;
}

/** 1 撃の文脈。system/damageMods.ts が増・倍を集めるときの入力 */
export interface DamageContext {
  kind: DamageKind;
  tags: ReadonlySet<DamageTag>;
  /** 属性の割合（0..1。増の属性タグはこの重みで足す） */
  elementShares: ReadonlyArray<DamageElementShare>;
  enemyId: number | null;
  crit: boolean;
}

/** 1 撃の内訳（表示・テスト・QA 用） */
export interface DamageBreakdown {
  base: number;
  /** Σ増（表示は「増 +X%」）。性質の条件付きの加算（traitHooks）も含む */
  increased: number;
  /** 掛かった倍（出所ごと 1 要素） */
  more: readonly MoreMul[];
  /** 防御・耐性・弱点 */
  enemyMul: number;
  amount: number;
}

/** 増の合計に掛ける下限（1 + Σ増 がこれを下回らない。代償の − を積んでも 0 にしない） */
export const MIN_INCREASED_MUL = TRIGGER.trait.minMul;

/** 全部 0 の増の表 */
export function createIncreased(): IncreasedTable {
  const out = {} as IncreasedTable;
  for (const tag of DAMAGE_TAGS) out[tag] = 0;
  return out;
}

/**
 * 1 撃に効く増の合計。属性以外のタグは ctx.tags にあれば足し、属性タグは属性の割合の重みで足す。
 * 下限は MIN_INCREASED_MUL − 1（呼び出し側で他の加算と合わせてもう一度下限を掛ける）
 */
export function sumIncreased(inc: Readonly<IncreasedTable>, ctx: Pick<DamageContext, "tags" | "elementShares">): number {
  let sum = 0;
  for (const tag of ctx.tags) {
    if (!ELEMENT_TAG_SET.has(tag)) sum += inc[tag];
  }
  for (const { element, share } of ctx.elementShares) {
    const tag = ELEMENT_TAGS[element];
    if (tag !== undefined) sum += inc[tag] * share;
  }
  return Math.max(MIN_INCREASED_MUL - 1, sum);
}

/** 1 つのタグだけの増の倍率（奥義の威力のように 1 撃の文脈を作らない量） */
export function increasedMul(inc: Readonly<IncreasedTable>, tag: DamageTag): number {
  return Math.max(MIN_INCREASED_MUL, 1 + inc[tag]);
}

/** 同じ source は後勝ちで 1 つに畳む（同じ札を 2 枚積んでも 2 乗にしない）。並びは最初に現れた順 */
export function dedupeMore(more: readonly MoreMul[]): MoreMul[] {
  const bySource = new Map<string, MoreMul>();
  for (const m of more) bySource.set(m.source, m);
  return [...bySource.values()];
}

/** 倍の積（同じ source は後勝ちで 1 つ）。負にはしない */
export function productMore(more: readonly MoreMul[]): number {
  let mul = 1;
  for (const m of dedupeMore(more)) mul *= m.mul;
  return Math.max(0, mul);
}

/** その倍が 1 撃のタグに掛かるか（tags 省略 = すべて） */
export function moreApplies(m: Readonly<MoreMul>, tags: ReadonlySet<DamageTag>): boolean {
  if (m.tags === undefined) return true;
  return m.tags.some((t) => tags.has(t));
}

/** 倍を 1 つ足した新しい列（stats の列は共有されうるので書き換えない） */
export function withMore(more: readonly MoreMul[], entry: MoreMul): MoreMul[] {
  return [...more, entry];
}

/** そのタグだけの 1 撃に掛かる倍の積（装備画面・祝福の威力の見積もり用） */
export function moreMulFor(more: readonly MoreMul[], tag: DamageTag): number {
  const tags: ReadonlySet<DamageTag> = new Set([tag]);
  return productMore(more.filter((m) => moreApplies(m, tags)));
}
