import type { GameState } from "../core/state";
import { VIEW_W } from "../core/view";
import { questStatusLine } from "../meta/screens";
import type { QuestSnapshotSource } from "../meta/quests";
import { Minimap } from "./minimap";
import { TEXT, drawTextShadow, textLineHeight } from "./pixelText";

/**
 * 受けている依頼の進みを右上に 1 行出す（ポーズ画面まで開かなくても見えるように）。
 * 右上の欄（階層・スコア・シード〜起点の行）の 1 行下に置く。依頼を受けていなければ何も描かない
 */

/** 右上の欄は Minimap.bottom + 10 から行送り。階層・スコア・シード（0〜2）、死神・呪い・共鳴・起点（3〜6）の次の行 */
const HUD_RIGHT_GAP = 10;
const HUD_RIGHT_LINE = 10;
const HUD_QUEST_LINE = 7;
const HUD_RIGHT_X_PAD = 8;
const COLOR_QUEST = "#e0c878";
const COLOR_QUEST_DONE = "#80ff80";
const COLOR_SHADOW = "#000000";
const DONE_MARK = "（達成）";

/** HUD の文（受けていなければ null）。進みと達成は questStatusLine と同じ文 */
export function questHudText(state: QuestSnapshotSource): string | null {
  const line = questStatusLine(state);
  return line === "" ? null : line;
}

export function drawQuestHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  const text = questHudText(state);
  if (text === null) return;
  const line = Math.max(HUD_RIGHT_LINE, textLineHeight(TEXT.SMALL));
  const y = Minimap.bottom(state) + HUD_RIGHT_GAP + line * HUD_QUEST_LINE;
  const color = text.endsWith(DONE_MARK) ? COLOR_QUEST_DONE : COLOR_QUEST;
  drawTextShadow(ctx, text, VIEW_W - HUD_RIGHT_X_PAD, y, TEXT.SMALL, color, COLOR_SHADOW, "right");
}
