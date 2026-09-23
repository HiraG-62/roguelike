import { VIEW_W } from "../core/view";
import type { QuestKey } from "../meta/quests";

/**
 * 依頼の 3 択（起点画面の後の 1 画面）。DOM 非依存。描画は src/render/questUi.ts。
 * 札を 1 枚選んで受けるか、「受けずに出発」を選ぶ。Esc で起点画面へ戻る
 */

export interface QuestChoiceScreen {
  offers: QuestKey[];
  /** 0..offers.length - 1 = 札、offers.length = 受けずに出発 */
  cursor: number;
}

export function createQuestChoice(offers: readonly QuestKey[], carried: QuestKey | null = null): QuestChoiceScreen {
  // 引き継いだ依頼が候補にあれば、そこにカーソルを置く（Enter 連打で同じ依頼を続けられる）
  const index = carried === null ? -1 : offers.indexOf(carried);
  return { offers: [...offers], cursor: index === -1 ? 0 : index };
}

export function skipIndex(ui: Readonly<QuestChoiceScreen>): number {
  return ui.offers.length;
}

/** 矢印 1 回。←→ で札を巡り、↓ で「受けずに出発」、↑ で札へ戻る。動いたら true */
export function moveQuestChoice(ui: QuestChoiceScreen, dx: number, dy: number): boolean {
  const skip = skipIndex(ui);
  const before = ui.cursor;
  if (dy > 0) ui.cursor = skip;
  else if (dy < 0 && ui.cursor === skip) ui.cursor = 0;
  else if (dx !== 0 && ui.cursor !== skip && ui.offers.length > 0) {
    ui.cursor = (((ui.cursor + dx) % ui.offers.length) + ui.offers.length) % ui.offers.length;
  }
  return before !== ui.cursor;
}

/** 決定した依頼（受けずに出発なら null） */
export function chosenQuest(ui: Readonly<QuestChoiceScreen>): QuestKey | null {
  return ui.offers[ui.cursor] ?? null;
}

// ---------------------------------------------------------------------------
// レイアウト（描画と当たり判定で共有）
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const QUEST_CHOICE_LAYOUT = {
  titleY: 18,
  subtitleY: 34,
  cardTop: 44,
  cardH: 164,
  cardGap: 8,
  marginX: 12,
  skipW: 140,
  skipH: 18,
  skipTop: 218,
  hintY: 262,
} as const;

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** 札の矩形（横に並べる） */
export function questCardRects(count: number): Rect[] {
  const L = QUEST_CHOICE_LAYOUT;
  const n = Math.max(1, count);
  const w = (VIEW_W - L.marginX * 2 - L.cardGap * (n - 1)) / n;
  return Array.from({ length: count }, (_, i) => ({ x: L.marginX + i * (w + L.cardGap), y: L.cardTop, w, h: L.cardH }));
}

export function questSkipRect(): Rect {
  const L = QUEST_CHOICE_LAYOUT;
  return { x: (VIEW_W - L.skipW) / 2, y: L.skipTop, w: L.skipW, h: L.skipH };
}

/** 座標が指す項目（札の添字か、受けずに出発 = offers.length）。無ければ null */
export function questChoiceItemAt(ui: Readonly<QuestChoiceScreen>, x: number, y: number): number | null {
  const card = questCardRects(ui.offers.length).findIndex((r) => pointInRect(x, y, r));
  if (card !== -1) return card;
  return pointInRect(x, y, questSkipRect()) ? skipIndex(ui) : null;
}
