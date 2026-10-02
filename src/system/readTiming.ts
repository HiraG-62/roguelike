import type { Enemy, GameState } from "../core/state";
import { attackCommitted } from "./poise";

/**
 * 「ある時刻に、その敵の予告は下絵だったか」（読み合いの核。docs/ideas/reading-core-impl.md 2-2）。
 * 出端は命中の瞬間の色ではなく、振り始め / 撃った時刻の色で決める。そのために敵ごとに
 * 予備動作の始まりと、墨入れになった時刻を残す。乱数も実時間も使わない
 */

/** 時刻が未記録の印（state.time は 0 以上なので、どの実時刻よりも前） */
export const NEVER_TIME = -1;

/** 予備動作に入った。`e.phase = "windup"` を書く全ての所で呼ぶ（漏れは readTiming.test が縛る） */
export function markWindupStart(state: GameState, e: Enemy): void {
  e.windupAt = state.time;
  e.committedAt = NEVER_TIME;
}

/**
 * 初めて墨入れ（攻撃が確定）を見たステップで時刻を書く。updateEnemies の後に呼ぶ。
 * 同じステップの前半（updatePlayer）で押した入力は下絵を見て押したことになるので、yellowAt は `>=` で比べる
 */
export function noteCommit(state: GameState, e: Enemy): void {
  if (e.phase !== "windup" && e.phase !== "strike") return;
  const windupAt = e.windupAt ?? NEVER_TIME;
  // 予備動作の記録が無い敵・すでに墨入れを記録した敵は書かない
  if ((e.committedAt ?? NEVER_TIME) >= windupAt) return;
  if (!attackCommitted(e)) return;
  e.committedAt = state.time;
}

/**
 * 時刻 t に、この敵の予告が下絵（まだ殴って止められる）だったか。
 * 予備動作か攻撃中で、t より前に予備動作が始まっていて（同じステップに始まった予告はまだ見えていない）、
 * まだ墨入れでない、または墨入れになったのが t 以降。
 * 予備動作の記録が無い敵（markWindupStart を通らず phase を置かれた敵。テストの手置きなど）は、時刻を問えないので今の色で答える
 */
export function yellowAt(e: Enemy, t: number): boolean {
  if (e.phase !== "windup" && e.phase !== "strike") return false;
  const windupAt = e.windupAt ?? NEVER_TIME;
  const committedAt = e.committedAt ?? NEVER_TIME;
  if (windupAt === NEVER_TIME) return e.phase === "windup" && !attackCommitted(e);
  if (windupAt >= t) return false;
  const notYetRed = committedAt < windupAt;
  return notYetRed || committedAt >= t;
}
