import { ENEMIES } from "../data/enemies";
import { formatAffix } from "./affixes";
import { traitColorOf } from "./colors";
import { CALM_FLUX_LIMIT, WAVER_FLUX_LIMIT, fluxMagnitude } from "./flux";
import { milestoneDef } from "./provenance";
import { baseName, dominantColor } from "./names";
import { colorWeights } from "./resonance";
import {
  RARITY_LABEL,
  TRAIT_COLORS,
  TRAIT_COLOR_HEX,
  TRAIT_COLOR_LABEL,
  type AffixRoll,
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
  /** ベース名・揺らぎの分類・発見深度 */
  subtitle: string;
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
const TOP_ENEMIES = 3;

function fluxLevelOf(roll: AffixRoll): FluxLevel {
  if (roll.inverted === true) return 3;
  const m = fluxMagnitude(roll);
  if (m < CALM_FLUX_LIMIT) return 0;
  if (m < WAVER_FLUX_LIMIT) return 1;
  return 2;
}

/** 性質 1 つの表示行 */
export function describeTrait(roll: AffixRoll): TraitLine {
  const hue = traitColorOf(roll);
  const inverted = roll.inverted === true;
  const grown = roll.origin === "bud";
  const prefix = `${grown ? GROWN_PREFIX : ""}${inverted ? INVERTED_PREFIX : ""}`;
  const line: TraitLine = {
    text: `${prefix}${formatAffix(roll)}`,
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

/** 色ごとの「振る舞い」。一言の要約に使う */
const COLOR_VERB: Readonly<Record<TraitColor, string>> = {
  crimson: "斬り伏せる",
  azure: "撃ち抜き駆け抜ける",
  jade: "耐えて癒える",
  gold: "閃いて連ねる",
  umbra: "代償を背負う",
};
const EMPTY_SUMMARY = "まだ何も語らない";

/** 多い色 2 つの振る舞いを並べた一言（例「斬り伏せる・耐えて癒える」） */
export function itemSummary(affixes: readonly AffixRoll[]): string {
  const bar = [...itemColorBar(affixes)].sort((a, b) => b.ratio - a.ratio);
  const verbs = bar.slice(0, 2).map((s) => COLOR_VERB[s.color]);
  return verbs.length === 0 ? EMPTY_SUMMARY : verbs.join("・");
}

function enemyName(key: string): string {
  return ENEMIES.find((e) => e.key === key)?.name ?? key;
}

/** 来歴の年表（UI にそのまま出す） */
export function provenanceLines(item: Item): string[] {
  const lines = [`深さ ${item.foundDepth} で拾った`];
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
    if (p.justDodges > 0) lines.push(`ジャスト回避 ${p.justDodges}`);
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
    lines.push(`${label} で芽が出ている（選ぶと育つ）`);
  }
  return lines;
}

function marginText(item: Item): string {
  const margin = item.margin ?? 0;
  if (item.inscription !== undefined && margin <= 0) return `銘 ${item.inscription}（育ち切った）`;
  if (margin <= 0) return "余白なし（これ以上は芽吹かない）";
  return `余白 ${margin}（あと ${margin} 回芽吹ける）`;
}

/** アイテム 1 つの表示情報 */
export function describeItem(item: Item): ItemDescription {
  const dominant = dominantColor(item.affixes);
  const hueText = dominant === undefined ? "" : `・${TRAIT_COLOR_LABEL[dominant]}`;
  const desc: ItemDescription = {
    name: item.name,
    subtitle: `${baseName(item.baseKey)}・${RARITY_LABEL[item.rarity]}${hueText}・深さ ${item.foundDepth}`,
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
