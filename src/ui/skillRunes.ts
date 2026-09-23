import type { FrameInput } from "../core/input";
import { MODIFIERS } from "../skills/data";
import {
  type RuneAttachBlock,
  attachRuneToStone,
  detachRuneFromStone,
  discardRune,
  ownedRunes,
  runeAttachBlock,
  stoneRunes,
} from "../skills/persistence";
import type { RuneItem, SkillProfile, SkillStone } from "../skills/types";
import { type Rect, STASH_HEADER_H, STASH_ROW_H, clamp, pointInRect } from "./inventoryLayout";

/**
 * 装備画面スキルタブの「刻印符」列（DOM 非依存の状態と入力）。
 * 所持刻印符を、選択中スロットの石に付ける / 外す。マウス・キー・パッドのどれでも操作できる。
 * 付け外しは石（SkillStone.runes）に残るので、スロットを入れ替えても符は石と一緒に動く
 */

/** 列の 1 行: 選択中の石に付いている符（attached）か、所持品の符か */
export interface RuneEntry {
  rune: RuneItem;
  attached: boolean;
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
  /** ツールチップを出す符（マウスかカーソル） */
  focusId: string | null;
  /** 移動入力のエッジ検出用（前フレームの向き。-1 / 0 / 1） */
  navX: number;
  navY: number;
}

/** スティック・WASD をメニューの 1 マス移動として読むしきい値 */
const NAV_THRESHOLD = 0.5;

export function createRuneUi(): RuneUi {
  return { cursor: 0, scroll: 0, focusId: null, navX: 0, navY: 0 };
}

/** 並び: 選択中の石に付いた符（付けた順）→ 所持品（新しい順）。付けた符を上に置き、外す操作を近くにする */
export function runeEntries(profile: SkillProfile, stone: SkillStone | null): RuneEntry[] {
  const attached = stone ? stoneRunes(stone).map((rune) => ({ rune, attached: true })) : [];
  const owned = [...ownedRunes(profile)].sort((a, b) => b.foundAt - a.foundAt).map((rune) => ({ rune, attached: false }));
  return [...attached, ...owned];
}

export function layoutRuneList(profile: SkillProfile, stone: SkillStone | null, ui: RuneUi, area: Rect): RuneListLayout {
  const header: Rect = { x: area.x, y: area.y, w: area.w, h: STASH_HEADER_H };
  const entries = runeEntries(profile, stone);
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

/** 付け外しの結果（UI のメッセージと効果音の出し分け用） */
export type RuneToggleResult =
  | { kind: "attached"; name: string }
  | { kind: "detached"; name: string }
  | { kind: "discarded"; name: string }
  | { kind: "blocked"; reason: RuneAttachBlock | "noStone" | "missing" };

/** 所持品の符なら石に付け、付いている符なら外す。discard なら所持品の符を捨てる（付いている符は捨てない） */
export function toggleRune(profile: SkillProfile, stone: SkillStone | null, entry: RuneEntry, discard = false): RuneToggleResult {
  const name = MODIFIERS[entry.rune.modifier].name;
  if (discard) {
    if (entry.attached || !discardRune(profile, entry.rune.id)) return { kind: "blocked", reason: "missing" };
    return { kind: "discarded", name };
  }
  if (!stone) return { kind: "blocked", reason: "noStone" };
  if (entry.attached) {
    return detachRuneFromStone(profile, stone.id, entry.rune.id) ? { kind: "detached", name } : { kind: "blocked", reason: "missing" };
  }
  const result = attachRuneToStone(profile, entry.rune.id, stone.id);
  return result === "ok" ? { kind: "attached", name } : { kind: "blocked", reason: result };
}

/** 付けられない理由の表示文（docs/GLOSSARY.md「刻印符」） */
export const RUNE_BLOCK_TEXT: Readonly<Record<RuneAttachBlock | "noStone" | "missing", string>> = {
  notFit: "このスキルには付けられない",
  duplicate: "同じ刻印符が付いている",
  noLinks: "リンクの空きが無い",
  reshape: "型替え符は 1 枚まで",
  clash: "付いている刻印符と排他",
  noStone: "スロットにスキル石が無い",
  missing: "刻印符が見つからない",
};

/** 選択中の石に付けられない理由（付けられる / 付いている符なら null）。ツールチップ用 */
export function entryBlock(stone: SkillStone | null, entry: RuneEntry): RuneAttachBlock | "noStone" | null {
  if (entry.attached) return null;
  if (!stone) return "noStone";
  return runeAttachBlock(stone, entry.rune.modifier);
}

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
