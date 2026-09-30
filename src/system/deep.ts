import type { GameState } from "../core/state";
import { pushLog } from "../core/state";
import { DEEP } from "../data/tuning";
import { addFloatingText } from "./effects";

/** 深みの告知の浮き文字の大きさ・秒 */
export const DEEP_TEXT_SCALE = 2;
export const DEEP_TEXT_LIFE = 1.6;

/** 浮き文字の持ち上げ（頭の少し上に出す。floor.ts の階の告知と同じ） */
const DEEP_TEXT_LIFT = 10;

/** 深みに初めて着いた告知。呼ぶのは floor.ts（深み 1 層目の初回だけ） */
export function announceDeep(state: GameState): void {
  const pos = state.player.body.pos;
  addFloatingText(state, { x: pos.x, y: pos.y - DEEP_TEXT_LIFT }, "深み", DEEP.color, DEEP_TEXT_SCALE, DEEP_TEXT_LIFE);
  pushLog(state, "更なる深みへ……。深淵が汝の力を解放する", DEEP.color);
}
