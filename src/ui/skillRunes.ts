import type { GameState } from "../core/state";
import type { ModifierKey } from "../skills/types";
import { runeMoveBlock, slotModifierView } from "../system/skills";

/**
 * 刻印符の操作の部品（DOM 非依存。スキルの頁 ui/skillPage.ts が使う）。
 * 刻印符はラン内だけの物（セーブしない）。スロットに付いている符を別のスロットへ移す / 外す（外すと消える）。
 * 移す / 外すは slot.runModifiers を直接書き、slot.modifiers へは次のステップの syncSlotModifiers が反映する
 */

/** スロットの符の 1 つ。run = 拾って付けた符（動かせる）、false = 祝福が足した符（動かせない）。active = 今の石に効いている */
export interface RuneEntry {
  key: ModifierKey;
  active: boolean;
  run: boolean;
}

/** 並び: スロットの符の並び順（拾った順 → 祝福の符）。効かない符も含めて出す */
export function runeEntries(state: GameState, slot: number): RuneEntry[] {
  return slotModifierView(state, slot);
}

/** 移す / 外すを止める理由。granted = 祝福の符 / noTarget = 移せるスロットが無い / missing = 符が見つからない */
export type RuneBlockReason = "granted" | "noTarget" | "missing";

/** 符の移し先: from の次のスロットから順に、付けられる最初のスロット（無ければ null）。持ち上げたときの最初の焦点の決め方 */
export function moveTarget(state: GameState, from: number, modifier: ModifierKey): number | null {
  const count = state.skills.slots.length;
  for (let step = 1; step < count; step++) {
    const to = (from + step) % count;
    if (runeMoveBlock(state.skills, to, modifier) === null) return to;
  }
  return null;
}

/** 動かせない理由の表示文（docs/GLOSSARY.md「刻印符」） */
export const RUNE_BLOCK_TEXT: Readonly<Record<RuneBlockReason, string>> = {
  granted: "祝福の刻印符は動かせません",
  noTarget: "移せるスロットがありません",
  missing: "刻印符が見つかりません",
};
