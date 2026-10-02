import type { Enemy, GameState, Jin } from "../core/state";
import { dist } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { roleOf } from "../data/enemyRoles";
import { formationDef } from "../data/formations";
import { REACTION } from "../data/tuning";

/**
 * 陣形ごとの動き（docs/ideas/jin-impl.md 2-6）。behavior 共通のフック（behaviors/base.ts の onRecoverEnd）から呼ばれ、
 * 特定の陣形のメンバーだけが働く。乱数なし・プレイヤーと同じ陣の仲間の位置と状態だけで決まるので決定的。
 * enemies.ts・poise.ts・statusEffects.ts を import しない（behaviors → ここ → system の循環を作らないため。怯み中の仲間も数えるが、怯みの間は時計が止まるので害はない）
 */

/**
 * 衡軛の列の入れ替え: 前列の前衛が攻撃の隙を終えたら、少し下がって次の攻撃まで間を置き（restMul）、
 * 後ろにいる同じ陣の前衛のうち最もプレイヤーに近い者が前へ出て、間を縮める（stepInCooldown）。
 * 入れ替わる相手がいなければ何もしない（1 人しか残っていない・後ろが攻撃中や怯み中）。
 * 呼ぶのは toChase の後（attackCooldown の再設定に上書きされないように）
 */
export function rotateYokeRow(state: GameState, e: Enemy, def: EnemyDef): void {
  const rotate = formationDef("yoke")?.rotate;
  if (!rotate || !e.ai || e.rout || e.hp <= 0 || roleOf(def) !== "vanguard") return;
  const jin = jinOf(state, e);
  if (jin?.formation !== "yoke" || jin.phase !== "engaged") return;
  const partner = stepInPartner(state, e, jin);
  if (!partner) return;
  partner.attackCooldown = Math.min(partner.attackCooldown, rotate.stepInCooldown);
  e.attackCooldown = Math.max(e.attackCooldown, def.attackInterval * rotate.restMul);
  // 下がる動きは間合い取りと同じ仕組み（ai.retreat。chase の頭で処理される）
  e.ai.retreat = Math.max(e.ai.retreat ?? 0, REACTION.retreatSec);
}

function jinOf(state: GameState, e: Enemy): Jin | undefined {
  return e.jinId === undefined ? undefined : state.jins.find((j) => j.id === e.jinId);
}

/** 前へ出る相手: e より後ろ（プレイヤーから遠い）で追跡中の同じ陣の前衛のうち、最もプレイヤーに近い者（同距離は id の小さい方） */
function stepInPartner(state: GameState, e: Enemy, jin: Jin): Enemy | null {
  const p = state.player.body.pos;
  const mine = dist(e.body.pos, p);
  let best: Enemy | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of state.enemies) {
    if (o === e || o.jinId !== jin.id || o.hp <= 0 || o.phase !== "chase" || o.hidden || o.rout) continue;
    if (roleOf(enemyDef(o.defKey)) !== "vanguard") continue;
    const d = dist(o.body.pos, p);
    if (d <= mine || d > bestD || (d === bestD && best !== null && o.id > best.id)) continue;
    best = o;
    bestD = d;
  }
  return best;
}
