import { ARC, HEAL } from "../data/tuning";

/**
 * ランの章立て（docs/ideas/economy-impl.md 2-8）。深度 1〜5 が章 1、6〜10 が章 2 …。
 * 各章の最後の階に章ボス、章の 1 階目（深度 1 を除く）は休符（階の主なし・泉あり）。
 * 最後の章より深い階（深み）は最後の章のまま、ボスは boss.ts の回転に回る
 */

const FIRST_CHAPTER = 1;

/** 深度の章（1 始まり。ARC.maxChapter で頭打ち）。深度 0 以下（拠点など）は章 1 */
export function chapterOf(depth: number): number {
  const floors = Math.max(1, ARC.floorsPerChapter);
  const chapter = Math.floor((Math.max(1, depth) - 1) / floors) + FIRST_CHAPTER;
  return Math.min(ARC.maxChapter, chapter);
}

/** 章の階数を超えない（深みにならない）最後の階 */
function lastChapterFloor(): number {
  return ARC.floorsPerChapter * ARC.maxChapter;
}

/** 章ボスの階（各章の最後の階。深みは含まない） */
export function isChapterBossDepth(depth: number): boolean {
  return depth > 0 && depth <= lastChapterFloor() && depth % ARC.floorsPerChapter === 0;
}

/** 章の境の休符（章の 1 階目。深度 1 は除く。深みは含まない） */
export function isChapterRest(depth: number): boolean {
  return depth > 1 && depth <= lastChapterFloor() && (depth - 1) % ARC.floorsPerChapter === 0;
}

/** 章ボスの key。章ボスの階でなければ null（boss.ts が従来の回転へ回す） */
export function chapterBossKey(depth: number): string | null {
  if (!isChapterBossDepth(depth)) return null;
  return ARC.chapters[chapterOf(depth) - FIRST_CHAPTER]?.boss ?? null;
}

/** この階は階の主を出さない（章の休符。ARC.lordSkipFirstFloor） */
export function skipsFloorLord(depth: number): boolean {
  return ARC.lordSkipFirstFloor && isChapterRest(depth);
}

/** この階は泉を必ず 1 つ置く（章の休符。ARC.restFountain） */
export function hasRestFountain(depth: number): boolean {
  return ARC.restFountain && isChapterRest(depth);
}

/** 部屋制圧のハートの確率（章ごと。章より深い階は最後の値） */
export function heartChanceOf(depth: number): number {
  const table = HEAL.heartChanceByChapter;
  return table[chapterOf(depth) - FIRST_CHAPTER] ?? table[table.length - 1] ?? 0;
}
