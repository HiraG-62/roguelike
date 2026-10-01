import { KEYWORDS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { MENU_BUDGET, RESONANCE } from "../data/tuning";
import { SLOTS, type Item, type Slot } from "../loot/types";
import type { ModifierKey, SkillKey } from "../skills/types";
import {
  RESONANCE_EXCLUDED,
  easeOfRing,
  relicProfileOf,
  resonanceBySourceOf,
  resonanceEaseOf,
  resonanceOrigins,
  stoneProfileOf,
  type KeywordOrigins,
  type OriginProfile,
  type ResonanceBySource,
  type ResonanceOrigin,
  type ResonanceOriginKind,
} from "../system/resonance";
import { equipmentSealed } from "../system/runSetup";

/**
 * 持ち物メニューの「試着」と紋の帯の並び（docs/ideas/inventory-v2/E-merged.md 5 章・11 章 段 1）。
 * 「この部位（スキル石の枠）をこの物に替えたら、系統ごとの段がどう変わるか」を、出どころの列を作り直して数え直すだけで答える。
 * state は読むだけで変えない（付け替えは今の loadoutDirty → captureLoadout の経路。決定性・リプレイには触れない）
 */

// -----------------------------------------------------------------------------
// 紋の帯の並び
// -----------------------------------------------------------------------------

/** 紋の帯 1 本（系統 1 つ）。undercurrent = 伏流（源か糧を 1 つ以上持つが段の立っていない系統） */
export interface CrestBand {
  keyword: Keyword;
  step: number;
  produces: number;
  consumes: number;
  amplifies: number;
  /** 段が立つまでに足りない源 + 糧の数（段の立った系統は 0）。伏流の並びの鍵 */
  short: number;
  undercurrent: boolean;
  origins: KeywordOrigins;
}

const EXCLUDED: ReadonlySet<Keyword> = new Set(RESONANCE_EXCLUDED);
const KEYWORD_RANK: ReadonlyMap<Keyword, number> = new Map(KEYWORDS.map((k, i) => [k, i]));

function rankOf(k: Keyword): number {
  return KEYWORD_RANK.get(k) ?? KEYWORDS.length;
}

function totalOf(r: Readonly<KeywordOrigins>): number {
  return r.produces.length + r.consumes.length + r.amplifies.length;
}

/** 段が立つまでに足りない源 + 糧の数 */
function shortOf(r: Readonly<KeywordOrigins>): number {
  return Math.max(0, RESONANCE.minSources - r.produces.length) + Math.max(0, RESONANCE.minSinks - r.consumes.length);
}

function bandOf(by: ResonanceBySource, keyword: Keyword, undercurrent: boolean): CrestBand {
  const r = by[keyword];
  return {
    keyword,
    step: r.step,
    produces: r.produces.length,
    consumes: r.consumes.length,
    amplifies: r.amplifies.length,
    short: undercurrent ? shortOf(r) : 0,
    undercurrent,
    origins: { produces: r.produces, consumes: r.consumes, amplifies: r.amplifies },
  };
}

/**
 * 紋の帯の並び: 段の立った系統（段の高い順 → 出どころの多い順 → KEYWORDS 順）を MENU_BUDGET.bands.stepped 本、
 * 続けて伏流（足りない数の少ない順 → 出どころの多い順 → KEYWORDS 順）を MENU_BUDGET.bands.undercurrent 本。
 * 数えない語（色・反転・無属性）は帯にしない
 */
export function crestBands(by: Readonly<ResonanceBySource>): CrestBand[] {
  const counted = KEYWORDS.filter((k) => !EXCLUDED.has(k));
  const stepped = counted
    .filter((k) => by[k].step > 0)
    .sort((a, b) => by[b].step - by[a].step || totalOf(by[b]) - totalOf(by[a]) || rankOf(a) - rankOf(b));
  const under = counted
    .filter((k) => by[k].step === 0 && (by[k].produces.length > 0 || by[k].consumes.length > 0))
    .sort((a, b) => shortOf(by[a]) - shortOf(by[b]) || totalOf(by[b]) - totalOf(by[a]) || rankOf(a) - rankOf(b));
  return [
    ...stepped.slice(0, MENU_BUDGET.bands.stepped).map((k) => bandOf(by, k, false)),
    ...under.slice(0, MENU_BUDGET.bands.undercurrent).map((k) => bandOf(by, k, true)),
  ];
}

/** 1 本の帯の珠の 1 列（源・糧・強め）。畳んだ珠は shown の最後の 1 つぶんを使い、残りの出どころの数を folded に持つ */
export interface BeadColumn {
  shown: ResonanceOrigin[];
  /** 畳んだ出どころの数（0 = 畳まない） */
  folded: number;
  /** 畳んだ珠の点の数（1〜3） */
  foldDots: number;
}

const MAX_FOLD_DOTS = 3;

/** 珠を上限で畳む。上限を超えたら、畳んだ珠 1 つぶんの枠を空けて残りを畳む（珠の見た目の数は上限のまま） */
export function foldBeads(list: readonly ResonanceOrigin[], limit: number): BeadColumn {
  if (list.length <= limit) return { shown: [...list], folded: 0, foldDots: 0 };
  const keep = Math.max(0, limit - 1);
  const folded = list.length - keep;
  return { shown: list.slice(0, keep), folded, foldDots: Math.min(MAX_FOLD_DOTS, folded) };
}

/** 帯 1 本の珠 3 列（源・糧・強め）を予算の上限で畳んだもの */
export function beadsOfBand(band: Readonly<CrestBand>): { source: BeadColumn; sink: BeadColumn; amplifier: BeadColumn } {
  return {
    source: foldBeads(band.origins.produces, MENU_BUDGET.beads.source),
    sink: foldBeads(band.origins.consumes, MENU_BUDGET.beads.sink),
    amplifier: foldBeads(band.origins.amplifies, MENU_BUDGET.beads.amplifier),
  };
}

/** 同じ出どころか（種類・識別子・部位・枠の位置が全部同じ） */
export function sameOrigin(a: Readonly<ResonanceOrigin>, b: Readonly<ResonanceOrigin>): boolean {
  return a.kind === b.kind && a.id === b.id && a.slot === b.slot && a.index === b.index;
}

/** その出どころが（どの動詞でも）関わっている系統。部位を指したとき紋で光らせる帯を引く */
export function keywordsOfOrigin(by: Readonly<ResonanceBySource>, origin: Readonly<ResonanceOrigin>): Keyword[] {
  return KEYWORDS.filter((k) => {
    const r = by[k];
    return [...r.produces, ...r.consumes, ...r.amplifies].some((o) => sameOrigin(o, origin));
  });
}

// -----------------------------------------------------------------------------
// 試着
// -----------------------------------------------------------------------------

/** 試着の基準（今のビルドの出どころ列）。state から 1 回作り、候補ごとに tryOn へ渡す */
export interface TryOnBase {
  sources: readonly OriginProfile[];
  /** 双頭の指輪が成立させる語の数 */
  ease: number;
  /** 素手の封印中は遺物が効かないので、遺物の試着は何も変えない */
  sealed: boolean;
  /** 枠ごとの刻印符（石を替えても符は枠に付いたまま） */
  stoneModifiers: readonly (readonly ModifierKey[])[];
}

export function tryOnBase(state: Readonly<GameState>): TryOnBase {
  return {
    sources: resonanceOrigins(state),
    ease: resonanceEaseOf(state),
    sealed: equipmentSealed(state),
    stoneModifiers: state.skills.slots.map((s) => s.modifiers),
  };
}

/** 替える先。item / skillKey が null なら外す（「外すと細る帯」を引く） */
export type TryOnTarget =
  | { kind: "relic"; slot: Slot; item: Readonly<Item> | null }
  | { kind: "stone"; index: number; skillKey: SkillKey | null };

const KIND_ORDER: readonly ResonanceOriginKind[] = ["relic", "stone", "boon", "job", "form", "reforge", "keystone"];

function kindRank(o: Readonly<ResonanceOrigin>): number {
  return KIND_ORDER.indexOf(o.kind);
}

/** 同じ種類の中の並び（遺物は SLOTS 順、石は枠の順） */
function placeRank(o: Readonly<ResonanceOrigin>): number {
  if (o.kind === "relic") return o.slot === undefined ? 0 : SLOTS.indexOf(o.slot);
  return o.index ?? 0;
}

function occupiesTarget(o: Readonly<ResonanceOrigin>, target: Readonly<TryOnTarget>): boolean {
  if (target.kind === "relic") return o.kind === "relic" && o.slot === target.slot;
  return o.kind === "stone" && o.index === target.index;
}

function insertionIndex(list: readonly OriginProfile[], origin: Readonly<ResonanceOrigin>): number {
  const at = list.findIndex((e) => {
    const k = kindRank(e.origin) - kindRank(origin);
    return k > 0 || (k === 0 && placeRank(e.origin) > placeRank(origin));
  });
  return at < 0 ? list.length : at;
}

function replacement(base: Readonly<TryOnBase>, target: Readonly<TryOnTarget>): OriginProfile | null {
  if (target.kind === "relic") {
    if (target.item === null || base.sealed) return null;
    return { origin: { kind: "relic", id: target.item.id, slot: target.slot }, profile: relicProfileOf(target.item) };
  }
  if (target.skillKey === null) return null;
  const modifiers = base.stoneModifiers[target.index] ?? [];
  return { origin: { kind: "stone", id: target.skillKey, index: target.index }, profile: stoneProfileOf(target.skillKey, modifiers) };
}

/** 替えた後の出どころ列と ease。基準は変えない */
export function sourcesAfter(base: Readonly<TryOnBase>, target: Readonly<TryOnTarget>): { sources: OriginProfile[]; ease: number } {
  // 封印中の遺物は元から並びに無いので、外す側（occupiesTarget）も空振りする
  const kept = base.sources.filter((e) => !occupiesTarget(e.origin, target));
  const next = replacement(base, target);
  if (next !== null) kept.splice(insertionIndex(kept, next.origin), 0, next);
  const ease = target.kind === "relic" && target.slot === "ring" && !base.sealed ? easeOfRing(target.item) : base.ease;
  return { sources: kept, ease };
}

/** 帯の動き。up = 太る / crack = ひび（段が下がる） / gone = 消える / new = 新しく立つ / same = 動かない */
export type BandChange = "up" | "crack" | "gone" | "new" | "same";

export interface BandDelta {
  keyword: Keyword;
  from: number;
  to: number;
  change: BandChange;
}

function changeOf(from: number, to: number): BandChange {
  if (to > from) return from === 0 ? "new" : "up";
  if (to < from) return to === 0 ? "gone" : "crack";
  return "same";
}

/** 試着の集計。合（噛み合う順）の並びの鍵になる（画面の行数で切らず、全系統で数える） */
export interface TryOnSummary {
  /** 消える系統の数 */
  lost: number;
  /** ひびの入る系統の数 */
  cracked: number;
  /** 太る・新しく立つ系統の数 */
  gained: number;
}

export interface TryOnResult {
  /** 替える前・替えた後の紋の帯 */
  before: CrestBand[];
  after: CrestBand[];
  /** 動く紋の行（MENU_BUDGET.morphRows まで。動く帯を必ず残す） */
  deltas: BandDelta[];
  summary: TryOnSummary;
}

/** 動かない行から後ろ側を落として上限に収める（動く帯は必ず残す） */
function fitMorphRows(rows: readonly BandDelta[], max: number): BandDelta[] {
  const out = [...rows];
  while (out.length > max) {
    let drop = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]?.change === "same") {
        drop = i;
        break;
      }
    }
    if (drop < 0) break;
    out.splice(drop, 1);
  }
  return out.slice(0, max);
}

function summarize(before: Readonly<ResonanceBySource>, after: Readonly<ResonanceBySource>): TryOnSummary {
  const summary: TryOnSummary = { lost: 0, cracked: 0, gained: 0 };
  for (const k of KEYWORDS) {
    const change = changeOf(before[k].step, after[k].step);
    if (change === "gone") summary.lost += 1;
    else if (change === "crack") summary.cracked += 1;
    else if (change === "up" || change === "new") summary.gained += 1;
  }
  return summary;
}

/** 数え直した結果から、動く紋を組む。前の帯の行 + 後に新しく段が立った帯を、前の並びを保って並べる */
export function compareBands(beforeBy: Readonly<ResonanceBySource>, afterBy: Readonly<ResonanceBySource>): TryOnResult {
  const before = crestBands(beforeBy);
  const after = crestBands(afterBy);
  const keywords = before.map((b) => b.keyword);
  for (const b of after) if (!b.undercurrent && !keywords.includes(b.keyword)) keywords.push(b.keyword);
  const rows = keywords.map((keyword): BandDelta => {
    const from = beforeBy[keyword].step;
    const to = afterBy[keyword].step;
    return { keyword, from, to, change: changeOf(from, to) };
  });
  return { before, after, deltas: fitMorphRows(rows, MENU_BUDGET.morphRows), summary: summarize(beforeBy, afterBy) };
}

/** 基準のビルドで、target に替えたら（null なら外したら）系統の段がどう変わるか。state を変えない純関数 */
export function tryOn(base: Readonly<TryOnBase>, target: Readonly<TryOnTarget>): TryOnResult {
  const after = sourcesAfter(base, target);
  return compareBands(resonanceBySourceOf(base.sources, base.ease), resonanceBySourceOf(after.sources, after.ease));
}

/** 合（噛み合う順）: 失う系統が少ない → ひびが少ない → 太る・新しく立つ系統が多い */
export function compareFit(a: Readonly<TryOnSummary>, b: Readonly<TryOnSummary>): number {
  return a.lost - b.lost || a.cracked - b.cracked || b.gained - a.gained;
}

/** 外すと細る系統（ひび・消える）。部位を指したときの荷札と紋の写しの点滅に使う */
export function thinnedKeywords(result: Readonly<TryOnResult>): BandDelta[] {
  return result.deltas.filter((d) => d.change === "crack" || d.change === "gone");
}
