import { VIEW_W } from "../core/view";
import {
  ORIGINS,
  ORIGIN_KEYS,
  type OriginKey,
  RUN_MODS,
  RUN_MOD_KEYS,
  type RunModKey,
  type RunSetup,
  defaultRunSetup,
  runTier,
} from "../system/runSetup";

/**
 * 起点画面（タイトル → 起点 → ラン開始）の状態と入力。DOM 非依存。
 * 左の列で起点を 1 つ選び、右の列で縛り（ラン修飾子）を積む。左の列の最後の行「出発」で始める
 */

export type OriginColumn = "origin" | "modifier";
export type OriginRow = OriginKey | "start";

export const ORIGIN_ROWS: readonly OriginRow[] = [...ORIGIN_KEYS, "start"];
export const START_LABEL = "出発";

export interface OriginScreen {
  column: OriginColumn;
  /** 左の列（ORIGIN_ROWS）のカーソル */
  originCursor: number;
  /** 右の列（RUN_MOD_KEYS）のカーソル */
  modCursor: number;
  origin: OriginKey;
  modifiers: RunModKey[];
}

/** 前回の選択を引き継いで開く。カーソルは「出発」に置く（Enter 連打ですぐ始められる） */
export function createOriginScreen(prev: RunSetup = defaultRunSetup()): OriginScreen {
  return {
    column: "origin",
    originCursor: ORIGIN_ROWS.length - 1,
    modCursor: 0,
    origin: prev.origin,
    modifiers: [...prev.modifiers],
  };
}

export function originSetup(ui: Readonly<OriginScreen>): RunSetup {
  // 縛りの並びは RUN_MOD_KEYS の順にそろえる（リプレイや記録で同じ組を同じ表記にする）
  return { origin: ui.origin, modifiers: RUN_MOD_KEYS.filter((k) => ui.modifiers.includes(k)) };
}

export function originTier(ui: Readonly<OriginScreen>): number {
  return runTier(ui.modifiers);
}

function wrap(index: number, delta: number, length: number): number {
  return (((index + delta) % length) + length) % length;
}

/** 矢印の 1 回ぶん。dx で列を切り替え、dy で列の中を動く。動いたら true */
export function moveOriginCursor(ui: OriginScreen, dx: number, dy: number): boolean {
  if (dx !== 0) {
    ui.column = ui.column === "origin" ? "modifier" : "origin";
    return true;
  }
  if (dy === 0) return false;
  if (ui.column === "origin") ui.originCursor = wrap(ui.originCursor, dy, ORIGIN_ROWS.length);
  else ui.modCursor = wrap(ui.modCursor, dy, RUN_MOD_KEYS.length);
  return true;
}

export type OriginResult = "none" | "changed" | "start";

/** 決定: 起点の行は選択、「出発」は開始、縛りの行は積む / 外す */
export function activateOriginCursor(ui: OriginScreen): OriginResult {
  if (ui.column === "modifier") {
    const key = RUN_MOD_KEYS[ui.modCursor];
    if (!key) return "none";
    toggleModifier(ui, key);
    return "changed";
  }
  const row = ORIGIN_ROWS[ui.originCursor];
  if (!row) return "none";
  if (row === "start") return "start";
  ui.origin = row;
  return "changed";
}

export function toggleModifier(ui: OriginScreen, key: RunModKey): void {
  ui.modifiers = ui.modifiers.includes(key) ? ui.modifiers.filter((k) => k !== key) : [...ui.modifiers, key];
}

/** カーソルの行の名前と説明（画面下の説明欄） */
export function cursorDescription(ui: Readonly<OriginScreen>): { name: string; desc: string } {
  if (ui.column === "modifier") {
    const key = RUN_MOD_KEYS[ui.modCursor];
    if (!key) return { name: "", desc: "" };
    const def = RUN_MODS[key];
    return { name: `${def.name}（${def.points} 点）`, desc: def.desc };
  }
  const row = ORIGIN_ROWS[ui.originCursor];
  if (!row) return { name: "", desc: "" };
  if (row === "start") return { name: START_LABEL, desc: `起点「${ORIGINS[ui.origin].name}」・位階 ${originTier(ui)} で潜る。` };
  return { name: ORIGINS[row].name, desc: ORIGINS[row].desc };
}

// ---------------------------------------------------------------------------
// レイアウト（描画 render/originUi.ts とマウスの当たり判定で共有する。行間は呼び出し側が textLineHeight から渡す）
// ---------------------------------------------------------------------------

export const ORIGIN_LAYOUT = {
  titleY: 20,
  headerY: 42,
  listY: 56,
  leftX: 24,
  colW: 200,
  rightX: VIEW_W / 2 + 16,
  descY: 228,
  hintY: 262,
  minRowGap: 13,
} as const;

export function originRowGap(lineHeight: number): number {
  return Math.max(ORIGIN_LAYOUT.minRowGap, lineHeight);
}

/** 行の矩形の上端（文字の基準線は上端 + 行間 - 3 あたり。描画側が合わせる） */
export function originRowTop(index: number, rowGap: number): number {
  return ORIGIN_LAYOUT.listY + index * rowGap;
}

/** 画面座標の点がどの行か（無ければ null） */
export function originItemAt(x: number, y: number, rowGap: number): { column: OriginColumn; row: number } | null {
  const row = Math.floor((y - ORIGIN_LAYOUT.listY) / rowGap);
  if (row < 0) return null;
  const inLeft = x >= ORIGIN_LAYOUT.leftX && x < ORIGIN_LAYOUT.leftX + ORIGIN_LAYOUT.colW;
  const inRight = x >= ORIGIN_LAYOUT.rightX && x < ORIGIN_LAYOUT.rightX + ORIGIN_LAYOUT.colW;
  if (inLeft && row < ORIGIN_ROWS.length) return { column: "origin", row };
  if (inRight && row < RUN_MOD_KEYS.length) return { column: "modifier", row };
  return null;
}

/** マウスで行を指す（カーソルを移す）。変わったら true */
export function pointOriginRow(ui: OriginScreen, hit: { column: OriginColumn; row: number }): boolean {
  const before = `${ui.column}:${ui.originCursor}:${ui.modCursor}`;
  ui.column = hit.column;
  if (hit.column === "origin") ui.originCursor = hit.row;
  else ui.modCursor = hit.row;
  return before !== `${ui.column}:${ui.originCursor}:${ui.modCursor}`;
}
