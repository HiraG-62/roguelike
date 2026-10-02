import { KEYWORDS, type Keyword, profileKeywords } from "../core/keywords";
import type { GameState } from "../core/state";
import { MODIFIERS, SKILL } from "../skills/data";
import type { ModifierKey } from "../skills/types";
import { runeMoveBlock } from "../system/skills";
import type { HandOptionAxis, HandOptions, HandSort, RuneKind } from "./menuState";

/**
 * 手持ちの刻印符（SkillRunState.hand）の見せ方（DOM 非依存。スキルの頁 ui/skillPage.ts と render/skillPageUi.ts が使う）。
 * 同じ符は 1 枚にまとめて数を出す。絞り込み（種類 / 系統 / 付けられる物だけ）と並び（新着 / 名前 / 種類）は
 * 候補の頁（ui/candidates.ts）と同じく「札を決定するたびに次の値へ送る」作り。state は読むだけ
 */

/** まとめた 1 枚。count = 手持ちの同じ符の枚数 */
export interface HandGroup {
  key: ModifierKey;
  count: number;
}

/** 種類の送る順と表示名（変形 = shape / 循環 = cycle / 型替え = reshape。docs/GLOSSARY.md「刻印符」） */
export const RUNE_KIND_ORDER: readonly RuneKind[] = ["shape", "cycle", "reshape"];
export const RUNE_KIND_LABEL: Readonly<Record<RuneKind, string>> = { shape: "変形", cycle: "循環", reshape: "型替え" };
/** 種類を持たない符（変形でも循環でも型替えでもない物）の表示名 */
export const RUNE_PLAIN_LABEL = "刻印符";

/** 並びの送る順と表示名 */
export const HAND_SORT_ORDER: readonly HandSort[] = ["new", "name", "kind"];
export const HAND_SORT_LABEL: Readonly<Record<HandSort, string>> = { new: "新着順", name: "名前順", kind: "種類順" };

/** 符の種類（型替えは family を持たないので先に見る。どれでもなければ null） */
export function runeKindOf(key: ModifierKey): RuneKind | null {
  const def = MODIFIERS[key];
  if (def.reshape === true) return "reshape";
  return def.family ?? null;
}

/** 符の種類の表示名（種類を持たない符は「刻印符」） */
export function runeKindLabel(key: ModifierKey): string {
  const kind = runeKindOf(key);
  return kind === null ? RUNE_PLAIN_LABEL : RUNE_KIND_LABEL[kind];
}

/** 符が関わる語（系統の絞り込みと札の丸印の元） */
export function runeKeywords(key: ModifierKey): Keyword[] {
  return profileKeywords(MODIFIERS[key].keywords);
}

/** 今のスキルのどれかに付けられるか（石が無い・相性が合わない・リンクが空いていない・型替えが埋まっている、を含めて） */
export function fitsAnySlot(state: Readonly<GameState>, key: ModifierKey): boolean {
  for (let i = 0; i < SKILL.slots; i++) if (runeMoveBlock(state.skills, i, key) === null) return true;
  return false;
}

/** 手持ちの同じ符を束ねる（拾った順に最初に出た位置で並べる） */
export function bundledHand(hand: readonly ModifierKey[]): HandGroup[] {
  const out: HandGroup[] = [];
  for (const key of hand) {
    const found = out.find((g) => g.key === key);
    if (found === undefined) out.push({ key, count: 1 });
    else found.count += 1;
  }
  return out;
}

function passes(state: Readonly<GameState>, key: ModifierKey, options: Readonly<HandOptions>): boolean {
  if (options.kind !== null && runeKindOf(key) !== options.kind) return false;
  if (options.keyword !== null && !runeKeywords(key).includes(options.keyword)) return false;
  return !options.fitOnly || fitsAnySlot(state, key);
}

function kindRank(key: ModifierKey): number {
  const kind = runeKindOf(key);
  return kind === null ? RUNE_KIND_ORDER.length : RUNE_KIND_ORDER.indexOf(kind);
}

function byName(a: ModifierKey, b: ModifierKey): number {
  const an = MODIFIERS[a].name;
  const bn = MODIFIERS[b].name;
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/** 手持ちを束ねて絞り込み、並べた物（新着 = 最後に拾った符が先頭 / 名前 / 種類 → 名前） */
export function handGroups(state: Readonly<GameState>, options: Readonly<HandOptions>): HandGroup[] {
  const hand = state.skills.hand;
  const groups = bundledHand(hand).filter((g) => passes(state, g.key, options));
  if (options.sort === "new") {
    return groups.sort((a, b) => hand.lastIndexOf(b.key) - hand.lastIndexOf(a.key));
  }
  if (options.sort === "kind") {
    return groups.sort((a, b) => kindRank(a.key) - kindRank(b.key) || byName(a.key, b.key));
  }
  return groups.sort((a, b) => byName(a.key, b.key));
}

/** 札が送る値の順（null = 絞らない を先頭に）。系統は手持ちに出てくる語だけを KEYWORDS の順で */
export function handKeywordChoices(state: Readonly<GameState>): (Keyword | null)[] {
  const present = new Set<Keyword>();
  for (const key of state.skills.hand) for (const k of runeKeywords(key)) present.add(k);
  return [null, ...KEYWORDS.filter((k) => present.has(k))];
}

/** 次の値。null（絞らない）も値の 1 つなので、`??` で current へ逃がさず添字の範囲で判定する */
function nextOf<T>(list: readonly T[], current: T): T {
  const next = (list.indexOf(current) + 1) % list.length;
  return next < list.length ? (list[next] as T) : current;
}

/** 札を 1 つ送った次の設定 */
export function nextHandOptions(state: Readonly<GameState>, options: Readonly<HandOptions>, axis: HandOptionAxis): HandOptions {
  switch (axis) {
    case "sort":
      return { ...options, sort: nextOf(HAND_SORT_ORDER, options.sort) };
    case "kind":
      return { ...options, kind: nextOf<RuneKind | null>([null, ...RUNE_KIND_ORDER], options.kind) };
    case "keyword":
      return { ...options, keyword: nextOf(handKeywordChoices(state), options.keyword) };
    case "fit":
      return { ...options, fitOnly: !options.fitOnly };
  }
}

/** 絞り込みが 1 つでも掛かっているか（並びは数えない） */
export function isHandFiltered(options: Readonly<HandOptions>): boolean {
  return options.kind !== null || options.keyword !== null || options.fitOnly;
}
