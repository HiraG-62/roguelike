import { ARC } from "../data/tuning";

/**
 * ランの章立て（docs/ideas/economy-impl.md 2-8）。深度 1〜5 が章 1、6〜10 が章 2 …。
 * 最後の章より深い階（深み）は最後の章のまま。章ボス・休符は段取り 6b で足す
 */

const FIRST_CHAPTER = 1;

/** 深度の章（1 始まり。ARC.maxChapter で頭打ち）。深度 0 以下（拠点など）は章 1 */
export function chapterOf(depth: number): number {
  const floors = Math.max(1, ARC.floorsPerChapter);
  const chapter = Math.floor((Math.max(1, depth) - 1) / floors) + FIRST_CHAPTER;
  return Math.min(ARC.maxChapter, chapter);
}
