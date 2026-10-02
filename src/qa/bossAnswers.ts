import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { dist, normalize, sub } from "../core/vec";
import { BOSS, PARRY } from "../data/tuning";
import { bossEnemy } from "../system/boss";
import { KS_BITE, KS_CENTER, KS_JUMP, crownOf } from "../system/bossKingSlime";
import { attackCommitted } from "../system/poise";
import { MELEE_RANGE, worldToScreen } from "./bot";

/**
 * ボスの答えの定跡（docs/ideas/boss-reading-impl.md 4-7。最小形）。
 * 連打の bot（qa/bot.ts の botInput）が作った入力を、スライム王の「読める場面」だけ上書きする。
 * - mash: 上書きしない（今の連打の bot）
 * - read: 影が黄のうちに跳んだ王へ詰めて振る（墜落）/ 赤なら影から離れる / 王が跳んでいる間に冠へ詰めて振る（冠落ち）/
 *   噛みの着地の直前に受け流す（呑み損ね）
 * 人に無理な答えを通さないよう、予告を見てから REACT_SEC 秒は反応しない。乱数は使わない
 */

export type AnswerMode = "mash" | "read";

/** 予告が始まってから反応するまでの秒（12 ステップ = 0.2 秒。人の反応の目安） */
const REACT_STEPS = 12;
const REACT_SEC = REACT_STEPS * FIXED_DT;
/** 噛みの着地のこの秒前に受け流しを押す（窓の長さの手前から。早すぎると窓が閉じ、遅すぎると噛まれる） */
const PARRY_LEAD_SEC = PARRY.windowSec * 0.5;
/** 近づいて振る距離 / 止まる距離（px。MELEE_RANGE に対する割合） */
const SWING_REACH = MELEE_RANGE;
const HOLD_RANGE_RATIO = 0.7;
/** 噛みの当たりに受け流しの余裕を足した距離（px） */
const PARRY_MARGIN = 14;

function noMove(input: FrameInput): FrameInput {
  return { ...input, move: { x: 0, y: 0 }, dashPressed: false, parryPressed: false, attackPressed: false, attackHeld: false, shootHeld: false };
}

/** 目標へ詰めて、振れる距離なら振る（王へも冠へも同じ） */
function approachAndSwing(state: GameState, base: FrameInput, target: Enemy): FrameInput {
  const pos = state.player.body.pos;
  const d = dist(target.body.pos, pos);
  const input = noMove(base);
  input.aimScreen = worldToScreen(state, target.body.pos);
  if (d > SWING_REACH * HOLD_RANGE_RATIO) input.move = normalize(sub(target.body.pos, pos));
  input.attackPressed = d <= SWING_REACH;
  return input;
}

/** 赤になった影から離れる（落下の衝撃波の縁を越える向きへ。間に合わなければダッシュ） */
function leaveShadow(state: GameState, base: FrameInput, king: Enemy): FrameInput {
  const pos = state.player.body.pos;
  const input = noMove(base);
  input.move = normalize(sub(pos, king.body.pos), { x: -1, y: 0 });
  input.dashPressed = dist(pos, king.body.pos) < BOSS.kingSlime.shockRadius;
  return input;
}

/** 王の技が高い跳躍で、見てから REACT_SEC 経っているか（連撃の続きは答えが無いので除く） */
function readableJump(state: GameState, king: Enemy): boolean {
  const ai = king.ai;
  if (!ai || (ai.move !== KS_JUMP && ai.move !== KS_CENTER) || (ai.chain ?? 0) > 0) return false;
  if (king.phase !== "windup" && king.phase !== "strike") return false;
  return state.time - (king.windupAt ?? state.time) >= REACT_SEC;
}

/** 連打の入力 base を、読める場面だけ答えに替える。mash・スライム王でない・読める場面でないなら base のまま */
export function answerInput(state: GameState, mode: AnswerMode, base: FrameInput): FrameInput {
  if (mode === "mash") return base;
  const king = bossEnemy(state);
  if (!king || king.defKey !== "kingSlime" || !king.ai || state.status !== "playing") return base;
  const ai = king.ai;
  const pos = state.player.body.pos;

  if (ai.move === KS_BITE && king.phase === "strike") {
    const near = dist(pos, king.ai.target) < BOSS.kingSlime.biteRadius + PARRY_MARGIN;
    return near && king.phaseTimer <= PARRY_LEAD_SEC ? { ...noMove(base), parryPressed: true } : noMove(base);
  }
  if (readableJump(state, king)) {
    // 黄: 影の上の王を殴って落とす。赤（落下）: 影から離れる
    return attackCommitted(king) ? leaveShadow(state, base, king) : approachAndSwing(state, base, king);
  }
  // 王が跳んでいる間（予備動作・攻撃中）は、晒された冠へ詰めて割る
  const crown = crownOf(state, king);
  if (crown && (king.phase === "windup" || king.phase === "strike")) return approachAndSwing(state, base, crown);
  return base;
}
