import { ENEMIES } from "../data/enemies";
import { baseDef } from "./bases";
import { COLOR_ADJECTIVE, traitColorOf } from "./colors";
import { uniqueDef } from "./named";
import { TRAIT_COLORS, type AffixRoll, type Item, type Provenance, type TraitColor } from "./types";

/**
 * 名前。docs/LOOT_DESIGN.md「名前と銘」。
 * - 銘があれば銘（余白を使い切ったときに来歴から刻まれる）
 * - 名のある遺物は固有名
 * - それ以外は無銘: 「{最も多い色の形容}{ベース名}」（性質が無ければベース名だけ）
 */

/** 性質の色ごとの数が最も多い色。同数は TRAIT_COLORS 順。性質が無ければ undefined */
export function dominantColor(affixes: readonly AffixRoll[]): TraitColor | undefined {
  const counts = new Map<TraitColor, number>();
  for (const roll of affixes) {
    const color = traitColorOf(roll);
    if (color !== undefined) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let best: TraitColor | undefined;
  let bestCount = 0;
  for (const color of TRAIT_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

/** ベースの表示名（未知の key は key のまま） */
export function baseName(baseKey: string): string {
  return baseDef(baseKey)?.name ?? baseKey;
}

/** 表示名を決める。銘 → 固有名 → 無銘の順 */
export function nameItem(item: Pick<Item, "baseKey" | "affixes" | "inscription" | "namedKey">): string {
  if (item.inscription !== undefined && item.inscription.length > 0) return item.inscription;
  if (item.namedKey !== undefined) {
    const named = uniqueDef(item.namedKey);
    if (named !== undefined) return named.name;
  }
  const color = dominantColor(item.affixes);
  const base = baseName(item.baseKey);
  return color === undefined ? base : `${COLOR_ADJECTIVE[color]}${base}`;
}

// ---------------------------------------------------------------------------
// 銘: 来歴から刻む
// ---------------------------------------------------------------------------

/** 銘の部品。head は修飾（「〜の」まで含む）、tail は名詞 */
interface EngravingPart {
  head: string;
  tail: string;
  /** 来歴の目立ち具合（閾値で割った値）。大きいほど銘に選ばれる */
  score: number;
}

/** 各来歴を「目立つ」とみなす基準量（銘の選択用。節目の閾値とは別） */
export const ENGRAVING_SCALE = {
  enemyKills: 100,
  justDodges: 40,
  hurtTaken: 80,
  bosses: 2,
  floorsCleared: 20,
  roomsCleared: 60,
} as const;

/** 来歴が 1 つも無いときの銘（seed で選ぶ） */
export const QUIET_ENGRAVINGS: readonly string[] = ["名もなき誓い", "静かな証", "語らぬ友", "空の器"];

function enemyName(key: string): string {
  return ENEMIES.find((e) => e.key === key)?.name ?? key;
}

/** 最も多く倒した敵種（同数は key の辞書順で先） */
function topEnemy(provenance: Provenance): { key: string; count: number } | undefined {
  const entries = Object.entries(provenance.killsByEnemy).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = entries[0];
  return top === undefined ? undefined : { key: top[0], count: top[1] };
}

function engravingParts(provenance: Provenance): EngravingPart[] {
  const parts: EngravingPart[] = [];
  const enemy = topEnemy(provenance);
  if (enemy !== undefined) {
    const name = enemyName(enemy.key);
    parts.push({ head: `${name}喰らいの`, tail: `${name}喰らい`, score: enemy.count / ENGRAVING_SCALE.enemyKills });
  }
  parts.push(
    { head: "見切りの", tail: "見切り", score: provenance.justDodges / ENGRAVING_SCALE.justDodges },
    { head: "傷だらけの", tail: "不屈", score: provenance.hurtTaken / ENGRAVING_SCALE.hurtTaken },
    { head: "王殺しの", tail: "王殺し", score: provenance.bosses / ENGRAVING_SCALE.bosses },
    { head: "深淵を歩いた", tail: "深潜り", score: provenance.floorsCleared / ENGRAVING_SCALE.floorsCleared },
    { head: "封鎖を破る", tail: "破城", score: provenance.roomsCleared / ENGRAVING_SCALE.roomsCleared },
  );
  return parts.filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
}

/**
 * 来歴から銘を作る（純関数）。最も目立つ来歴を名詞に、2 番目を修飾にする。
 * 例: 「傷だらけのスライム喰らい」「見切りの王殺し」。来歴が 1 つだけなら名詞のみ、無ければ QUIET_ENGRAVINGS
 */
export function engraveName(provenance: Provenance, seed: number): string {
  const [first, second] = engravingParts(provenance);
  if (first === undefined) return QUIET_ENGRAVINGS[seed % QUIET_ENGRAVINGS.length] ?? QUIET_ENGRAVINGS[0] ?? "";
  if (second === undefined) return first.tail;
  return `${second.head}${first.tail}`;
}
