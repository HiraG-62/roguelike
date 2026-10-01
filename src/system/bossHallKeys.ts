import { ARC, BOSS_HALL } from "../data/tuning";

/**
 * ボスの間の候補と深度（docs/ideas/meta-impl.md 2-7）。data/tuning だけを読む軽い部分で、
 * 拠点の設備（meta/hub.ts）や一覧（ui/bossHall.ts）から読む。createGame を持つ bossHall.ts を
 * そこから import すると、core/game の依存の輪の途中で初期化が走って壊れるので分けている
 */

/** 章ボスの 1 章目（ARC.chapters の添字 0 が深度 floorsPerChapter） */
const FIRST_CHAPTER = 1;

/** 挑めるボスの候補。章ボス（章の順）→ 最深の主。重複は最初の 1 つ */
export function hallBossKeys(): string[] {
  const keys = [...ARC.chapters.map((c) => c.boss), ARC.finalBoss];
  return [...new Set(keys)];
}

/** そのボスの階の深度。章ボスは章 × floorsPerChapter、最深の主は最深の間。候補でなければ null */
export function hallDepthOf(key: string): number | null {
  const chapter = ARC.chapters.findIndex((c) => c.boss === key);
  if (chapter >= 0) return (chapter + FIRST_CHAPTER) * ARC.floorsPerChapter;
  if (key === ARC.finalBoss) return ARC.floorsPerChapter * ARC.maxChapter + 1;
  return null;
}

/** 階を作る seed の文字列。同じボスは毎回同じ部屋になる（練習の場なので覚えられる方がよい） */
export function hallSeedText(key: string): string {
  return `${BOSS_HALL.seedPrefix}${key}`;
}
