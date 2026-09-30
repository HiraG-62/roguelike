import { enemyDef } from "../data/enemies";
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

/** 最深の間（章の階数 × 章の数 + 1 = 深度 21）。章ボスの次の階で、ここが踏破の場になる */
export function isFinalDepth(depth: number): boolean {
  return depth === lastChapterFloor() + 1;
}

/** 深み（最深の間の次の階 = 深度 22 から）。深みの規則（敵数・変異・上限の解放・表示）はこれだけを見る */
export function isDeepDepth(depth: number): boolean {
  return depth > lastChapterFloor() + 1;
}

/** 深みの何層目か（深度 22 で 1）。深みでなければ 0 */
export function deepFloorOf(depth: number): number {
  return isDeepDepth(depth) ? depth - (lastChapterFloor() + 1) : 0;
}

/** 最深の主を倒したランか（bossLog に ARC.finalBoss がある）。踏破の数えで、深みへ降りて力尽きても踏破に数える */
export function conqueredBy(bossLog: readonly { readonly key: string }[]): boolean {
  return bossLog.some((record) => record.key === ARC.finalBoss);
}

/** 最深の間の主の key（ARC.finalBoss。最深の間でなければ null） */
export function finalBossKey(depth: number): string | null {
  return isFinalDepth(depth) ? ARC.finalBoss : null;
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

/**
 * 次の山（死亡画面。docs/ideas/meta-impl.md 2-2）: depth 以上で最初の章ボスの階か最深の間と、その主の key。
 * 最深の間より深い（深み）なら null
 */
export function nextPeakOf(depth: number): { depth: number; key: string } | null {
  const final = lastChapterFloor() + 1;
  if (depth > final) return null;
  const floors = Math.max(1, ARC.floorsPerChapter);
  const bossDepth = Math.ceil(Math.max(1, depth) / floors) * floors;
  if (bossDepth <= lastChapterFloor()) {
    const key = chapterBossKey(bossDepth);
    if (key !== null) return { depth: bossDepth, key };
  }
  return { depth: final, key: ARC.finalBoss };
}

function bossLabel(key: string): string {
  const def = enemyDef(key);
  return def.bossTitle ?? def.name;
}

/**
 * 章の休符（6 / 11 / 16）に着いたときの予習の文。この章の主の階と名を告げ、最後の章の休符ではさらに最深の間の主も告げる
 * （準備が効くようにする。docs/ideas/boss-impl.md 2-6）。休符でなければ空
 */
export function chapterAheadLines(depth: number): string[] {
  if (!isChapterRest(depth)) return [];
  const chapter = chapterOf(depth);
  const lines: string[] = [];
  const key = ARC.chapters[chapter - FIRST_CHAPTER]?.boss;
  if (key) lines.push(`この章の主: 地下 ${chapter * ARC.floorsPerChapter} 階 ${bossLabel(key)}`);
  if (chapter === ARC.maxChapter) lines.push(`最深の主: 地下 ${lastChapterFloor() + 1} 階 ${bossLabel(ARC.finalBoss)}`);
  return lines;
}
