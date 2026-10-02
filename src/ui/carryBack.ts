import { keyLabel } from "../core/input";
import { VIEW_W } from "../core/view";
import type { RunEnd } from "../loot/runGear";
import type { Item } from "../loot/types";

/**
 * 持ち帰りの画面（ランの終わり。docs/ideas/run-arc.md 2-4）。DOM 非依存。描画は src/render/carryBackUi.ts。
 * ラン内で拾った遺物（袋と装備中のラン内の遺物）を縦に並べ、枠（limit）の数まで選ぶ。最後の行「決める」で終える。
 * 選ばなかった遺物は消える。拠点から持ち込んだ遺物は並ばない（拠点の装備に戻る）
 */

export interface CarryBackScreen {
  items: readonly Item[];
  /** 装備中のラン内の遺物の id（行に「装備中」を出す） */
  equippedIds: readonly string[];
  /** 持ち帰れる数（loot/runGear.ts の carryBackLimit） */
  limit: number;
  end: RunEnd;
  /** 0..items.length - 1 = 遺物の行、items.length = 決める */
  cursor: number;
  /** 選んだ遺物の id（選んだ順） */
  chosen: string[];
  /** 一覧の先頭に見えている行 */
  scroll: number;
  /** 一覧に見せる行の数（文字の大きさで変わる。fitCarryBack が毎フレーム合わせる） */
  rows: number;
  /** 枠が満杯で選べなかった知らせの残り秒 */
  fullFlash: number;
}

/** 「持ち帰りの枠が満杯」を出す秒 */
const FULL_FLASH_SECONDS = 1.2;

/** 知らせの秒を進める */
export function tickCarryBack(ui: CarryBackScreen, dt: number): void {
  ui.fullFlash = Math.max(0, ui.fullFlash - dt);
}

export function createCarryBack(items: readonly Item[], limit: number, end: RunEnd, equippedIds: readonly string[] = []): CarryBackScreen {
  return {
    items: [...items],
    equippedIds: [...equippedIds],
    limit: Math.max(0, Math.floor(limit)),
    end,
    cursor: 0,
    chosen: [],
    scroll: 0,
    rows: carryBackVisibleRows(CARRY_BACK_LAYOUT.minRowGap),
    fullFlash: 0,
  };
}

/** 「決める」の行の添字 */
export function doneIndex(ui: Readonly<CarryBackScreen>): number {
  return ui.items.length;
}

/** カーソルの遺物（決めるの行なら null） */
export function cursorItem(ui: Readonly<CarryBackScreen>): Item | null {
  return ui.items[ui.cursor] ?? null;
}

export function isChosen(ui: Readonly<CarryBackScreen>, id: string): boolean {
  return ui.chosen.includes(id);
}

/** 矢印 1 回（端で反対側へ回る）。動いたら true */
export function moveCarryBack(ui: CarryBackScreen, dy: number): boolean {
  if (dy === 0) return false;
  const rows = ui.items.length + 1;
  const before = ui.cursor;
  ui.cursor = (((ui.cursor + Math.sign(dy)) % rows) + rows) % rows;
  followCursor(ui);
  return before !== ui.cursor;
}

/** 選ぶ / 外すの結果。full = 枠が埋まっていて選べない */
export type CarryBackToggle = "on" | "off" | "full";

/** index の遺物を選ぶ / 外す（枠を超えては選べない） */
export function toggleCarryBack(ui: CarryBackScreen, index: number): CarryBackToggle | null {
  const item = ui.items[index];
  if (!item) return null;
  if (isChosen(ui, item.id)) {
    ui.chosen = ui.chosen.filter((id) => id !== item.id);
    return "off";
  }
  if (ui.chosen.length >= ui.limit) {
    ui.fullFlash = FULL_FLASH_SECONDS;
    return "full";
  }
  ui.chosen = [...ui.chosen, item.id];
  return "on";
}

/** 決定（Enter・クリック）。カーソルが決めるなら "done"、遺物なら選ぶ / 外す */
export function pressCarryBack(ui: CarryBackScreen): CarryBackToggle | "done" | null {
  if (ui.cursor === doneIndex(ui)) return "done";
  return toggleCarryBack(ui, ui.cursor);
}

/** 持ち帰る遺物の id（loot/runGear.ts の settleRun へ渡す） */
export function chosenCarryIds(ui: Readonly<CarryBackScreen>): string[] {
  return [...ui.chosen];
}

// ---------------------------------------------------------------------------
// レイアウト（描画と当たり判定で共有）
// ---------------------------------------------------------------------------

export const CARRY_BACK_LAYOUT = {
  titleY: 18,
  subtitleY: 34,
  listX: 16,
  listY: 46,
  listW: 200,
  minRowGap: 13,
  /** 一覧の下端と「決める」の行の間 */
  doneGap: 4,
  detailX: 228,
  detailY: 46,
  detailBottom: 236,
  doneY: 216,
  doneW: 200,
  doneH: 16,
  hintY: 262,
} as const;

export function carryBackRowGap(lineHeight: number): number {
  return Math.max(CARRY_BACK_LAYOUT.minRowGap, lineHeight);
}

/** 行の間隔で一覧に入る行の数（「決める」の行に重ならない数。最低 1） */
export function carryBackVisibleRows(rowGap: number): number {
  const L = CARRY_BACK_LAYOUT;
  return Math.max(1, Math.floor((L.doneY - L.doneGap - L.listY) / Math.max(1, rowGap)));
}

/** 文字の大きさに合わせて一覧の行の数を決め直す（描画と当たりの前に毎フレーム） */
export function fitCarryBack(ui: CarryBackScreen, rowGap: number): void {
  ui.rows = carryBackVisibleRows(rowGap);
  followCursor(ui);
}

/** 一覧の i 行目（items の添字）の上端。見えていなければ null */
export function carryBackRowTop(ui: Readonly<CarryBackScreen>, index: number, rowGap: number): number | null {
  const row = index - ui.scroll;
  if (row < 0 || row >= ui.rows) return null;
  return CARRY_BACK_LAYOUT.listY + row * rowGap;
}

/** カーソルが一覧の窓の外なら窓を送る */
function followCursor(ui: CarryBackScreen): void {
  if (ui.cursor >= ui.items.length) return;
  if (ui.cursor < ui.scroll) ui.scroll = ui.cursor;
  else if (ui.cursor >= ui.scroll + ui.rows) ui.scroll = ui.cursor - ui.rows + 1;
}

/** 画面座標の点がどの行か（決めるは doneIndex。無ければ null） */
export function carryBackRowAt(ui: Readonly<CarryBackScreen>, x: number, y: number, rowGap: number): number | null {
  const L = CARRY_BACK_LAYOUT;
  if (x < L.listX || x >= L.listX + L.listW) return null;
  if (y >= L.doneY && y < L.doneY + L.doneH) return doneIndex(ui);
  const row = Math.floor((y - L.listY) / rowGap);
  if (row < 0 || row >= ui.rows) return null;
  const index = ui.scroll + row;
  return index < ui.items.length ? index : null;
}

/** 行を指す（マウス）。動いたら true */
export function pointCarryBack(ui: CarryBackScreen, index: number): boolean {
  if (index < 0 || index > doneIndex(ui) || index === ui.cursor) return false;
  ui.cursor = index;
  followCursor(ui);
  return true;
}

/** ホイールで一覧の窓を送る（カーソルは動かさない） */
export function scrollCarryBack(ui: CarryBackScreen, dir: number): void {
  const max = Math.max(0, ui.items.length - ui.rows);
  ui.scroll = Math.max(0, Math.min(max, ui.scroll + Math.sign(dir)));
}

// ---------------------------------------------------------------------------
// 表示の文字列
// ---------------------------------------------------------------------------

export const CARRY_BACK_TITLE = "持ち帰る遺物を選ぶ";
export const CARRY_BACK_DONE = "決める";
export const CARRY_BACK_EQUIPPED = "装備中";

const END_LABEL: Readonly<Record<RunEnd, string>> = {
  fallen: "力尽きた",
  cleared: "踏破",
};

/** 「踏破: 3 つまで持ち帰れる。選ばなかった遺物は消える」 */
export function carryBackSubtitle(ui: Readonly<CarryBackScreen>): string {
  return `${END_LABEL[ui.end]}: ${ui.limit} つまで持ち帰れる。選ばなかった遺物は消える`;
}

/** 「選んだ 1 / 3」 */
export function carryBackCount(ui: Readonly<CarryBackScreen>): string {
  return `選んだ ${ui.chosen.length} / ${ui.limit}`;
}

/** 選べないときの知らせ */
export const CARRY_BACK_FULL = "持ち帰りの枠が満杯";

export function carryBackHint(): string {
  const ok = keyLabel("confirm", { first: true });
  return `↑↓ 移る　${ok} 選ぶ / 外す　${ok}（${CARRY_BACK_DONE}）終える　Esc 戻る`;
}

/** 詳細欄の幅 */
export function carryBackDetailW(): number {
  return VIEW_W - CARRY_BACK_LAYOUT.detailX - CARRY_BACK_LAYOUT.listX;
}
