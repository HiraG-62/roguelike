import type { FrameInput } from "../core/input";
import type { GameState } from "../core/state";
import { MODIFIERS } from "../skills/data";
import type { ModifierKey } from "../skills/types";
import { moveRunModifier, removeRunModifier, runeMoveBlock, slotModifierView } from "../system/skills";
import { type Rect, STASH_HEADER_H, STASH_ROW_H, clamp, pointInRect } from "./inventoryLayout";

/**
 * 装備画面スキルタブの「刻印符」列（DOM 非依存の状態と入力）。
 * 刻印符はラン内だけの物（セーブしない）。選択中スロットに付いている符を、別のスロットへ移す / 外す（外すと消える）。
 * マウス・キー・パッドのどれでも操作できる。移す / 外すは slot.runModifiers を直接書き、
 * slot.modifiers へは次のステップの syncSlotModifiers が反映する
 */

/** 列の 1 行: 選択中スロットの符。run = 拾って付けた符（動かせる）、false = 祝福が足した符（動かせない） */
export interface RuneEntry {
  key: ModifierKey;
  active: boolean;
  run: boolean;
}

export interface RuneRowLayout extends RuneEntry {
  rect: Rect;
  /** 列全体（スクロール前）の中の番号。カーソルと同じ数え方 */
  index: number;
}

export interface RuneListLayout {
  header: Rect;
  rows: RuneRowLayout[];
  entries: RuneEntry[];
  maxScroll: number;
}

export interface RuneUi {
  /** キー・パッドのカーソル（entries の番号）。マウスが乗ればそこへ動く */
  cursor: number;
  scroll: number;
  /** ツールチップを出す符の key（マウスかカーソル） */
  focusKey: ModifierKey | null;
  /** 移動入力のエッジ検出用（前フレームの向き。-1 / 0 / 1） */
  navX: number;
  navY: number;
}

/** スティック・WASD をメニューの 1 マス移動として読むしきい値 */
const NAV_THRESHOLD = 0.5;

export function createRuneUi(): RuneUi {
  return { cursor: 0, scroll: 0, focusKey: null, navX: 0, navY: 0 };
}

/** 並び: スロットの符の並び順（拾った順 → 祝福の符）。効かない符も含めて出す */
export function runeEntries(state: GameState, slot: number): RuneEntry[] {
  return slotModifierView(state, slot);
}

export function layoutRuneList(state: GameState, slot: number, ui: RuneUi, area: Rect): RuneListLayout {
  const header: Rect = { x: area.x, y: area.y, w: area.w, h: STASH_HEADER_H };
  const entries = runeEntries(state, slot);
  const visible = Math.max(0, Math.floor((area.h - STASH_HEADER_H) / STASH_ROW_H));
  const maxScroll = Math.max(0, entries.length - visible);
  const scroll = clamp(ui.scroll, 0, maxScroll);
  const rows: RuneRowLayout[] = [];
  for (let row = 0; row < visible; row++) {
    const index = row + scroll;
    const entry = entries[index];
    if (!entry) break;
    rows.push({ ...entry, index, rect: { x: area.x, y: area.y + STASH_HEADER_H + row * STASH_ROW_H, w: area.w, h: STASH_ROW_H } });
  }
  return { header, rows, entries, maxScroll };
}

/** 移す / 外すを止める理由。granted = 祝福の符 / noTarget = 移せるスロットが無い / missing = 符が見つからない */
export type RuneBlockReason = "granted" | "noTarget" | "missing";

/** 移す / 外すの結果（UI のメッセージと効果音の出し分け用） */
export type RuneOpResult =
  | { kind: "moved"; name: string; to: number }
  | { kind: "removed"; name: string }
  | { kind: "blocked"; reason: RuneBlockReason };

/** 符の移し先: from の次のスロットから順に、付けられる最初のスロット（無ければ null）。ボタン 1 つで巡るための決め方 */
export function moveTarget(state: GameState, from: number, modifier: ModifierKey): number | null {
  const count = state.skills.slots.length;
  for (let step = 1; step < count; step++) {
    const to = (from + step) % count;
    if (runeMoveBlock(state.skills, to, modifier) === null) return to;
  }
  return null;
}

/** 選択中スロットの符を別のスロットへ移す。remove なら外して消す（祝福の符は動かせない） */
export function operateRune(state: GameState, slot: number, entry: RuneEntry, remove: boolean): RuneOpResult {
  const name = MODIFIERS[entry.key].name;
  if (!entry.run) return { kind: "blocked", reason: "granted" };
  if (remove) {
    return removeRunModifier(state.skills, slot, entry.key) ? { kind: "removed", name } : { kind: "blocked", reason: "missing" };
  }
  const to = moveTarget(state, slot, entry.key);
  if (to === null) return { kind: "blocked", reason: "noTarget" };
  return moveRunModifier(state.skills, slot, to, entry.key) === "ok" ? { kind: "moved", name, to } : { kind: "blocked", reason: "missing" };
}

/** 動かせない理由の表示文（docs/GLOSSARY.md「刻印符」） */
export const RUNE_BLOCK_TEXT: Readonly<Record<RuneBlockReason, string>> = {
  granted: "祝福の刻印符は動かせません",
  noTarget: "移せるスロットがありません",
  missing: "刻印符が見つかりません",
};

/** 移動入力を 1 マスずつの操作に変える（押した瞬間だけ -1 / 1、押しっぱなしは 0） */
export function readNav(ui: RuneUi, input: FrameInput): { dx: number; dy: number } {
  const x = axisDir(input.move.x);
  const y = axisDir(input.move.y);
  const dx = x !== 0 && ui.navX === 0 ? x : 0;
  const dy = y !== 0 && ui.navY === 0 ? y : 0;
  ui.navX = x;
  ui.navY = y;
  return { dx, dy };
}

function axisDir(v: number): number {
  if (v > NAV_THRESHOLD) return 1;
  if (v < -NAV_THRESHOLD) return -1;
  return 0;
}

/** カーソルを列の範囲に収めるだけ（スクロールは動かさない）。ホイールでスクロールした後の範囲外参照を防ぐ */
export function clampRuneCursor(ui: RuneUi, entryCount: number): void {
  if (entryCount === 0) {
    ui.cursor = 0;
    return;
  }
  ui.cursor = clamp(ui.cursor, 0, entryCount - 1);
}

/** カーソルを動かし、見える範囲に収まるようスクロールを合わせる */
export function moveRuneCursor(ui: RuneUi, layout: RuneListLayout, dy: number): void {
  const count = layout.entries.length;
  if (count === 0) {
    ui.cursor = 0;
    return;
  }
  ui.cursor = clamp(ui.cursor + dy, 0, count - 1);
  const visible = layout.rows.length > 0 ? layout.rows.length : 1;
  if (ui.cursor < ui.scroll) ui.scroll = ui.cursor;
  if (ui.cursor >= ui.scroll + visible) ui.scroll = ui.cursor - visible + 1;
  ui.scroll = clamp(ui.scroll, 0, layout.maxScroll);
}

/** マウスが乗っている行（無ければ null） */
export function hoveredRuneRow(layout: RuneListLayout, aim: FrameInput["aimScreen"]): RuneRowLayout | null {
  if (!aim) return null;
  return layout.rows.find((r) => pointInRect(aim, r.rect)) ?? null;
}
