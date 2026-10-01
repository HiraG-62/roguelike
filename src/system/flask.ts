import { pushEvent, playerSource } from "../core/events";
import type { FrameInput } from "../core/input";
import { type GameState, pushSfx } from "../core/state";
import { ECONOMY } from "../data/tuning";
import { addFloatingText } from "./effects";
import { healPlayer } from "./combat";
import { flaskCapacity, gainFlasks } from "./economy";

// 本数の出し入れは economy.ts（壺の落とす床の瓶も同じ経路で拾うため。combat.ts から循環せずに読める）
export { flaskCapacity, gainFlasks };

/**
 * 瓶（持ち運べる回復。docs/ideas/economy-impl.md 2-3）。
 * - 本数は Player.flasks、上限は stats.flaskMax。泉で満ち（refillFlasks）、市で買う（gainFlasks）
 * - 飲むと最大生命の healRatio 回復。戦闘中の回復の上限（HEAL.sustainCapRatio）は通さない
 *   （瓶は「使う」判断のある回復で、命中・撃破の回復と同じ枠で絞ると窮地の 1 本が効かないため）
 */

const TEXT_LIFT = 12;
const TEXT_SCALE = 1;

export type DrinkBlocker = "notPlaying" | "empty" | "cooldown" | "busy" | "full";

/** 今の状態で飲めない理由。飲めるなら null（HUD・bot が同じ判定を使う） */
export function drinkBlocker(state: GameState): DrinkBlocker | null {
  const p = state.player;
  if (state.status !== "playing") return "notPlaying";
  if (p.flasks <= 0) return "empty";
  if (state.time < p.flaskReadyAt) return "cooldown";
  // 振りの構え・打ち込みの最中とダッシュ中は飲めない（skills.ts の requestCast と同じ。先行入力は持たない）
  if (p.dashTimer > 0 || attackCommitted(state)) return "busy";
  if (p.hp >= p.maxHp) return "full";
  return null;
}

function attackCommitted(state: GameState): boolean {
  const phase = state.player.attack.phase;
  return phase === "windup" || phase === "active";
}

/**
 * step の player 更新の前に呼ぶ。flaskPressed で 1 本飲む。飲めたら true。
 * 満タンでは飲まない（押し間違いで貴重な 1 本を捨てない）。回復の数字・粒子・効果音は healPlayer が出す
 */
export function tryDrink(state: GameState, input: FrameInput): boolean {
  if (!input.flaskPressed) return false;
  if (drinkBlocker(state) !== null) return false;
  const p = state.player;
  p.flasks -= 1;
  p.flaskReadyAt = state.time + ECONOMY.flask.cooldown;
  pushSfx(state, "flaskDrink");
  const healed = healPlayer(state, p.maxHp * ECONOMY.flask.healRatio);
  addFloatingText(state, { x: p.body.pos.x, y: p.body.pos.y - TEXT_LIFT }, "瓶", ECONOMY.flask.color, TEXT_SCALE, ECONOMY.flask.textLife);
  pushEvent(state, { kind: "onFlask", actor: "player", pos: { ...p.body.pos }, source: playerSource("flask"), amount: healed });
  return true;
}

/** 瓶を上限まで満たす（章の境の泉）。増えた本数を返す */
export function refillFlasks(state: GameState): number {
  return gainFlasks(state, flaskCapacity(state) - state.player.flasks);
}
