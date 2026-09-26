import type { Keyword, KeywordProfile } from "../core/keywords";
import type { StatusKind, StatusProc } from "../core/status";
import { ENEMIES } from "../data/enemies";
import { MOVESETS } from "../data/weapons";
import { ATTR_COLOR, ATTR_TRAIT_PREFIX, formatAffix } from "./affixes";
import { traitColorOf } from "./colors";
import { CALM_FLUX_LIMIT, WAVER_FLUX_LIMIT, fluxMagnitude } from "./flux";
import { baseDef } from "./bases";
import { milestoneDef } from "./provenance";
import { baseName, dominantColor } from "./names";
import { ATTR_LABEL, colorWeights } from "./resonance";
import { computeStats } from "./stats";
import { profileGaps, statsKeywords } from "../system/keywords";
import {
  ATTR_KEYS,
  RARITY_LABEL,
  SLOTS,
  TRAIT_COLORS,
  TRAIT_COLOR_HEX,
  TRAIT_COLOR_LABEL,
  type AffixRoll,
  type AttrKey,
  type Equipment,
  type Item,
  type Provenance,
  type TraitColor,
} from "./types";

/**
 * 装備の表示情報（UI 担当が使う）。docs/LOOT_DESIGN.md「ツールチップ」。
 * 数値のスコアや DPS は出さない。性質は動詞で語り、揺らぎは段階（0..3）だけを渡す。
 */

/** 揺らぎの段階。0 = 静 / 1 = 揺 / 2 = 荒 / 3 = 反転（UI の波形アイコン用） */
export type FluxLevel = 0 | 1 | 2 | 3;

export interface TraitLine {
  text: string;
  /** 性質の色（表示色の hex） */
  color: string;
  /** 色の key（色の無い性質は undefined） */
  hue?: TraitColor;
  inverted?: boolean;
  /** 芽吹いた性質 */
  grown?: boolean;
  fluxLevel: FluxLevel;
}

export interface ColorBarSegment {
  color: TraitColor;
  /** 0..1（合計 1） */
  ratio: number;
}

export interface ItemDescription {
  name: string;
  /** 種類（武器は武器種名、それ以外はベース名）・揺らぎの分類・発見深度 */
  subtitle: string;
  /** ベースの表示名（「打刀」）。武器は種類の名前が武器種名になるので、詳しくの頁でだけ出す */
  baseName: string;
  /** 性質の組み合わせから作る一言（動詞） */
  summary: string;
  /** implicit の説明（無ければ undefined） */
  implicit?: string;
  colorBar: ColorBarSegment[];
  lines: TraitLine[];
  /** 余白（残りの成長枠）の説明 */
  marginText: string;
  provenanceLines: string[];
  inscription?: string;
}

const UNCOLORED = "#c0c0c0";
const INVERTED_PREFIX = "反転 ";
const GROWN_PREFIX = "芽 ";
/** 残響の操作の印（脱色・張り）。色や値が定義と違う理由を行の頭で見せる */
const COLORLESS_PREFIX = "無色 ";
const TENSED_PREFIX = "張り ";
const TOP_ENEMIES = 3;

function fluxLevelOf(roll: AffixRoll): FluxLevel {
  if (roll.inverted === true) return 3;
  const m = fluxMagnitude(roll);
  if (m < CALM_FLUX_LIMIT) return 0;
  if (m < WAVER_FLUX_LIMIT) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// ステータスの一言（docs/COMBAT_DESIGN.md A-10）
// ---------------------------------------------------------------------------

/**
 * ステータスが何を伸ばすかの一言（動詞）。装備の性質の行と装備画面のステータス表示で共有する。
 * ステータスそのものの効果は体の性能（技巧 → 移動・ダッシュ、体力 → 生命・状態異常への抵抗、精神 → 気力）だけで、
 * 威力・怯み値などは行動ごとの係数で決まる。どの行動が参照するかは詳細欄の計算式の頁（ui/scalingText.ts）に出す
 */
export const ATTRIBUTE_HINT: Readonly<Record<AttrKey, string>> = {
  str: "係数で参照する行動だけが上がる",
  dex: "移動・ダッシュと参照する行動が上がる",
  vit: "生命・状態異常への抵抗と参照する行動が上がる",
  mnd: "気力・気力の回復と参照する行動が上がる",
  spi: "係数で参照する行動だけが上がる",
  def: "防御力・魔防と参照する行動が上がる",
};

export interface AttributeDescription {
  key: AttrKey;
  /** 表示名（筋力 など） */
  label: string;
  hint: string;
  color: TraitColor;
  /** 色の hex */
  hex: string;
}

/** ステータス 1 つの表示情報 */
export function describeAttribute(key: AttrKey): AttributeDescription {
  const color = ATTR_COLOR[key];
  return { key, label: ATTR_LABEL[key], hint: ATTRIBUTE_HINT[key], color, hex: TRAIT_COLOR_HEX[color] };
}

function isAttrKey(text: string): text is AttrKey {
  return (ATTR_KEYS as readonly string[]).includes(text);
}

/** ステータスの性質（attr_str など）なら一言を返す */
function attributeHintOfKey(key: string): string | undefined {
  if (!key.startsWith(ATTR_TRAIT_PREFIX)) return undefined;
  const attr = key.slice(ATTR_TRAIT_PREFIX.length);
  return isAttrKey(attr) ? ATTRIBUTE_HINT[attr] : undefined;
}

// ---------------------------------------------------------------------------
// 状態異常の付与（PlayerStats.statusProcs）の説明
// ---------------------------------------------------------------------------

/** 状態異常を付ける動詞（docs/COMBAT_DESIGN.md E-2 の表記） */
/** 状態異常を付ける動詞（docs/GLOSSARY.md の表示名に合わせる） */
const STATUS_VERB: Readonly<Record<StatusKind, string>> = {
  burn: "燃焼させる",
  chill: "冷気で凍えさせる",
  freeze: "凍結させる",
  shock: "感電させる",
  paralyze: "麻痺させる",
  poison: "毒を与える",
  bleed: "出血させる",
  vulnerable: "脆弱にする",
  weaken: "弱体にする",
  fear: "恐怖させる",
  silence: "沈黙させる",
  stagger: "怯ませる",
  guarded: "堅守を与える",
  wet: "濡らす",
  oiled: "油をかける",
  corrode: "腐食させる",
  brand: "烙印を刻む",
  broken: "崩勢にする",
  doom: "宣告を刻む",
  siphon: "吸魔の印を付ける",
  hue: "彩痕を付ける",
  scorch: "灼熱させる",
  blaze: "炎上させる",
  venom: "猛毒を与える",
  hemorrhage: "大出血させる",
  encase: "氷棺に閉じ込める",
  exposed: "露呈させる",
  enfeeble: "無力にする",
  soaked: "浸水させる",
  haste: "加速する",
  harden: "硬化する",
  wrath: "怒気を得る",
  fury: "激昂する",
  charged: "帯電する",
};

const PROC_TRIGGER_TEXT: Readonly<Record<StatusProc["on"], string>> = {
  melee: "近接命中時",
  ranged: "射撃命中時",
  skill: "スキル命中時",
  any: "命中時",
};
const CRIT_TRIGGER_TEXT = "会心時";
const PERCENT = 100;
const PERCENT_DECIMALS = 1;

/** 例「近接命中時 12% で出血させる」「会心時 30% で恐怖させる」 */
export function describeStatusProc(proc: StatusProc): string {
  const head = proc.requiresCrit === true ? CRIT_TRIGGER_TEXT : PROC_TRIGGER_TEXT[proc.on];
  const chance = Number((proc.chance * PERCENT).toFixed(PERCENT_DECIMALS));
  return `${head} ${chance}% で${STATUS_VERB[proc.kind]}`;
}

/** 性質 1 つの表示行 */
export function describeTrait(roll: AffixRoll): TraitLine {
  const hue = traitColorOf(roll);
  const inverted = roll.inverted === true;
  const grown = roll.origin === "bud";
  const marks = `${roll.colorless === true ? COLORLESS_PREFIX : ""}${roll.tensed === true ? TENSED_PREFIX : ""}`;
  const prefix = `${grown ? GROWN_PREFIX : ""}${inverted ? INVERTED_PREFIX : ""}${marks}`;
  const hint = attributeHintOfKey(roll.key);
  const line: TraitLine = {
    text: `${prefix}${formatAffix(roll)}${hint === undefined ? "" : `（${hint}）`}`,
    color: hue === undefined ? UNCOLORED : TRAIT_COLOR_HEX[hue],
    fluxLevel: fluxLevelOf(roll),
  };
  if (hue !== undefined) line.hue = hue;
  if (inverted) line.inverted = true;
  if (grown) line.grown = true;
  return line;
}

/** 性質の色の配合（アイテム単体）。0 の色は含めない。TRAIT_COLORS 順 */
export function itemColorBar(affixes: readonly AffixRoll[]): ColorBarSegment[] {
  const weights = colorWeights(affixes);
  const total = TRAIT_COLORS.reduce((sum, c) => sum + weights[c], 0);
  if (total <= 0) return [];
  return TRAIT_COLORS.filter((c) => weights[c] > 0).map((c) => ({ color: c, ratio: weights[c] / total }));
}

/** 色ごとの得意分野（名詞）。一言の要約に使う */
const COLOR_VERB: Readonly<Record<TraitColor, string>> = {
  crimson: "近接",
  azure: "射撃・機動",
  jade: "守り・回復",
  gold: "会心・連撃",
  umbra: "代償",
};
const EMPTY_SUMMARY = "特色なし";
/** 色 2 つの区切り。色の中の「・」と見分けるため別の記号にする */
const SUMMARY_JOINER = " / ";

/** 多い色 2 つの得意分野を並べた一言（例「近接 / 守り・回復」） */
export function itemSummary(affixes: readonly AffixRoll[]): string {
  const bar = [...itemColorBar(affixes)].sort((a, b) => b.ratio - a.ratio);
  const verbs = bar.slice(0, 2).map((s) => COLOR_VERB[s.color]);
  return verbs.length === 0 ? EMPTY_SUMMARY : verbs.join(SUMMARY_JOINER);
}

function enemyName(key: string): string {
  return ENEMIES.find((e) => e.key === key)?.name ?? key;
}

/** 来歴の年表（UI にそのまま出す） */
export function provenanceLines(item: Item): string[] {
  const lines = [`地下 ${item.foundDepth} 階で入手`];
  const p: Provenance | undefined = item.provenance;
  if (p !== undefined) {
    if (p.kills > 0) {
      const top = Object.entries(p.killsByEnemy)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_ENEMIES)
        .map(([key, n]) => `${enemyName(key)} ${n}`);
      lines.push(`撃破 ${p.kills}（${top.join("・")}）`);
    }
    if (p.bosses > 0) lines.push(`ボス撃破 ${p.bosses}`);
    if (p.justDodges > 0) lines.push(`見切り ${p.justDodges}`);
    if (p.hurtTaken > 0) lines.push(`被弾 ${p.hurtTaken}`);
    if (p.roomsCleared > 0) lines.push(`部屋制圧 ${p.roomsCleared}`);
    if (p.floorsCleared > 0) lines.push(`階層踏破 ${p.floorsCleared}（最深 ${p.deepest}）`);
  }
  for (const bud of item.buds ?? []) {
    const label = milestoneDef(bud.milestone)?.label ?? bud.milestone;
    const chosen = bud.options[bud.chosen];
    lines.push(`${label} で芽吹いた: ${formatAffix(chosen)}`);
  }
  if (item.budOffer !== null && item.budOffer !== undefined) {
    const label = milestoneDef(item.budOffer.milestone)?.label ?? item.budOffer.milestone;
    lines.push(`${label}: 芽あり（未選択）`);
  }
  return lines;
}

function marginText(item: Item): string {
  const margin = item.margin ?? 0;
  if (item.inscription !== undefined && margin <= 0) return `銘 ${item.inscription}`;
  if (margin <= 0) return "余白なし";
  return `余白 ${margin}`;
}

/**
 * 遺物の種類の名前。武器（武器種を持つベース）は武器種名（「刀」）、それ以外の部位はベース名（「革鎧」）。
 * 同じ武器種でもベース名が違う（打刀・太刀）ので、何ができるかが分かる武器種の側に揃える
 */
export function itemKindName(item: Pick<Item, "baseKey">): string {
  const moveset = baseDef(item.baseKey)?.moveset;
  return moveset === undefined ? baseName(item.baseKey) : MOVESETS[moveset].name;
}

/** アイテム 1 つの表示情報 */
export function describeItem(item: Item): ItemDescription {
  const dominant = dominantColor(item.affixes);
  const hueText = dominant === undefined ? "" : `・${TRAIT_COLOR_LABEL[dominant]}`;
  const desc: ItemDescription = {
    name: item.loaned === true ? `${item.name}（借り物）` : item.name,
    subtitle: `${itemKindName(item)}・${RARITY_LABEL[item.rarity]}${hueText}・地下 ${item.foundDepth} 階`,
    baseName: baseName(item.baseKey),
    summary: itemSummary(item.affixes),
    colorBar: itemColorBar(item.affixes),
    lines: item.affixes.map(describeTrait),
    marginText: marginText(item),
    provenanceLines: provenanceLines(item),
  };
  if (item.implicit !== null) desc.implicit = formatAffix(item.implicit);
  if (item.inscription !== undefined) desc.inscription = item.inscription;
  return desc;
}

export { describeResonance } from "./resonance";

// -----------------------------------------------------------------------------
// 「ここに噛む」（docs/ideas/synergy-web.md 4-b）。スコアにせず、語と相手の名前だけを返す
// -----------------------------------------------------------------------------

/** ビルドを構成する 1 要素。item = 装備中の遺物、resonance = 装備の組み合わせでだけ現れる語（共鳴など） */
export type SynergyElementKind = "item" | "resonance" | "skill" | "boon";

export interface SynergyElement {
  kind: SynergyElementKind;
  name: string;
  keywords: KeywordProfile;
}

/** 今のビルド。profile は elements の語を合わせたもの */
export interface SynergyBuild {
  profile: KeywordProfile;
  elements: readonly SynergyElement[];
}

export interface SynergyDescription {
  /** このアイテムが出す語（KEYWORDS 順） */
  produces: Keyword[];
  /** このアイテムが食う語 */
  consumes: Keyword[];
  /** 出す語のうち、今のビルドが飢えているもの（穴を埋める） */
  fills: Keyword[];
  /** 食う語のうち、今のビルドが余らせているもの（流れを太くする） */
  feeds: Keyword[];
  /** 噛み合う装着中のスキル石・祝福の名前（要素の並び順、最大 SYNERGY_PARTNER_MAX） */
  partners: string[];
}

/** ツールチップに出す相手の名前の上限（1〜2 行に収める） */
export const SYNERGY_PARTNER_MAX = 3;
const PARTNER_KINDS: ReadonlySet<SynergyElementKind> = new Set(["skill", "boon"]);

function emptyEquipment(): Equipment {
  return Object.fromEntries(SLOTS.map((s) => [s, null])) as Equipment;
}

/** アイテム単体の語（そのスロットに 1 つだけ装備したときの stats から推論する） */
export function itemKeywords(item: Item): KeywordProfile {
  const equipment = emptyEquipment();
  equipment[item.slot] = item;
  return statsKeywords(computeStats(equipment));
}

function overlaps(a: readonly Keyword[], b: readonly Keyword[]): boolean {
  return a.some((k) => b.includes(k));
}

/**
 * item が build とどう噛むか。build は item を外した（同じスロットを空けた）ビルドを渡す想定。
 * 相手 = item の出す語を食う、または item の食う語を出すスキル石・祝福
 */
export function describeSynergy(item: Item, build: Readonly<SynergyBuild>): SynergyDescription {
  const own = itemKeywords(item);
  const gaps = profileGaps(build.profile);
  const partners = build.elements
    .filter((e) => PARTNER_KINDS.has(e.kind))
    .filter((e) => overlaps(own.produces, e.keywords.consumes) || overlaps(own.consumes, e.keywords.produces))
    .slice(0, SYNERGY_PARTNER_MAX)
    .map((e) => e.name);
  return {
    produces: own.produces,
    consumes: own.consumes,
    fills: own.produces.filter((k) => gaps.hunger.includes(k)),
    feeds: own.consumes.filter((k) => gaps.surplus.includes(k)),
    partners,
  };
}
