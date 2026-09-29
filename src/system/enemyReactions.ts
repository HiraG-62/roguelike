import type { Enemy, GameState } from "../core/state";
import { type Vec, add, angle, dist, fromAngle, scale, sub } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { roleOf } from "../data/enemyRoles";
import { PLAYER, REACTION } from "../data/tuning";
import { attackCommitted, isStaggered } from "./poise";

/**
 * 敵の反応ルール（docs/ideas/jin-impl.md 2-3）。behaviors/base.ts の 3 フック（onStruck / attackCooldownRate / slotTarget）の
 * 既定の実装。乱数を使わず、プレイヤーと仲間の位置・状態だけで決まるので決定的。
 * enemies.ts を import しない（behaviors → ここ → enemies の循環を作らないため）。
 */

const FULL_TURN = Math.PI * 2;
const PUNISH_ROLES: ReadonlySet<string> = new Set(REACTION.punishRoles);
const SLOT_ROLES: ReadonlySet<string> = new Set(REACTION.slotRoles);
/** プレイヤーの近接の終撃の段（player.ts の FINISHER_COMBO と同じ。最後の段の硬直が最も危ない） */
const FINISHER_COMBO = PLAYER.melee.length - 1;

/**
 * プレイヤーが隙を晒しているか: 終撃の硬直・ダッシュの再使用中（残り 0）・受け流しの外し。
 * 「3 段目の後が最も危ない」を敵の側から表す
 */
export function playerExposed(state: GameState): boolean {
  const p = state.player;
  if (p.attack.phase === "recover" && p.attack.combo === FINISHER_COMBO) return true;
  if (p.dashChargesLeft === 0) return true;
  return p.parry.recover > 0;
}

// ---------------------------------------------------------------------------
// 間合い取り（onStruck）
// ---------------------------------------------------------------------------

/**
 * 殴られた。窓の中で役割ごとの回数殴られたら、追跡中か隙の間だけ 0.25 秒プレイヤーから離れる（殴り続けられない）。
 * 怯んでいる・攻撃が確定している（コミット）敵は動かさない
 */
export function reactStruck(_state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (e.hp <= 0 || !ai) return;
  // 窓が尽きていたら数え直す（窓の減衰は tickReaction。ここでも見るのは、眠りや停止で減衰が止まっていた敵のため）
  if ((ai.hitWindow ?? 0) <= 0) ai.hitCount = 0;
  ai.hitCount = (ai.hitCount ?? 0) + 1;
  ai.hitWindow = REACTION.hitWindowSec;

  const need = REACTION.retreatHits[roleOf(def)];
  if (need <= 0 || ai.hitCount < need) return;
  if (e.phase !== "chase" && e.phase !== "recover") return;
  if (isStaggered(e) || attackCommitted(e)) return;
  ai.retreat = REACTION.retreatSec;
  ai.hitCount = 0;
}

/** 毎ステップ、被弾の窓を減らす（尽きたら数を 0 に戻す） */
export function tickReaction(e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || ai.hitWindow === undefined || ai.hitWindow <= 0) return;
  ai.hitWindow = Math.max(0, ai.hitWindow - dt);
  if (ai.hitWindow === 0) ai.hitCount = 0;
}

/**
 * 間合い取りで今ステップに離れる距離（px）。取っていなければ 0。
 * 速さは敵の速さに依らず一定（離れる距離を秒で割った値）で、残りが dt に満たないステップは残りの分だけ動く
 */
export function takeRetreatStep(e: Enemy, dt: number): number {
  const ai = e.ai;
  const left = ai?.retreat ?? 0;
  if (!ai || left <= 0) return 0;
  const used = Math.min(dt, left);
  ai.retreat = left - used;
  return (REACTION.retreatDist / REACTION.retreatSec) * used;
}

// ---------------------------------------------------------------------------
// 隙を狙う（attackCooldownRate）
// ---------------------------------------------------------------------------

/** 攻撃間隔の時計の進む速さ。前衛・突撃はプレイヤーの隙で速くなる（乱数なし・上限なし。「入りやすい」を時計の速さで表す） */
export function reactCooldownRate(state: GameState, _e: Enemy, def: EnemyDef): number {
  if (!PUNISH_ROLES.has(roleOf(def))) return 1;
  return playerExposed(state) ? 1 + REACTION.punishBias : 1;
}

// ---------------------------------------------------------------------------
// 囲む（slotTarget）
// ---------------------------------------------------------------------------

/** 囲みの仲間として数える位相（攻撃中・隙の間も数えて、持ち場の割り当てを交戦のあいだ安定させる） */
const SLOT_PEER_PHASES: ReadonlySet<string> = new Set(["chase", "windup", "strike", "recover"]);

/** 囲みの仲間: 同じ陣（陣に属さなければ slotRange 以内）の、交戦中で同じ役割の自分以外の敵 */
function slotPeers(state: GameState, e: Enemy, role: string): Enemy[] {
  const peers: Enemy[] = [];
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || !SLOT_PEER_PHASES.has(o.phase) || o.hidden) continue;
    if (e.jinId !== undefined ? o.jinId !== e.jinId : dist(o.body.pos, e.body.pos) > REACTION.slotRange) continue;
    if (roleOf(enemyDef(o.defKey)) === role) peers.push(o);
  }
  return peers;
}

/** 角度の差を -π..π に丸める */
function wrapAngle(a: number): number {
  return a - FULL_TURN * Math.round(a / FULL_TURN);
}

/**
 * 追跡の目標点（囲む回り込み）。仲間が slotMinPeers 以上いれば、仲間を id の昇順に並べた自分の順位 k と人数 n から
 * プレイヤーの周りの等間隔の持ち場（角度 = 基準 + k × 2π / n）を決める。基準は最小 id の敵が今いる側
 * （その敵は動かず、他が左右へ回り込む）。
 * 返すのは持ち場そのものではなく、「今の角度から持ち場の向きへ slotLead だけ進んだ輪の上の点」: 輪は攻撃距離のすぐ外
 * （engageRange + slotMargin）なので、輪をなぞって回り込み、持ち場の近くまで来たら undefined（共通の直進で殴りに行く）。
 * 囲めないときも undefined。突撃は含めない（直線で横移動を罰する役）
 */
export function reactSlotTarget(state: GameState, e: Enemy, def: EnemyDef): Vec | undefined {
  const role = roleOf(def);
  if (!SLOT_ROLES.has(role)) return undefined;
  const peers = slotPeers(state, e, role);
  if (peers.length < REACTION.slotMinPeers) return undefined;

  let first = e;
  let rank = 0;
  for (const o of peers) {
    if (o.id < e.id) rank++;
    if (o.id < first.id) first = o;
  }
  const player = state.player.body.pos;
  const slotAngle = angle(sub(first.body.pos, player)) + (rank * FULL_TURN) / (peers.length + 1);
  const here = angle(sub(e.body.pos, player));
  const delta = wrapAngle(slotAngle - here);
  if (Math.abs(delta) <= REACTION.slotAngleTol) return undefined;
  const lead = Math.max(-REACTION.slotLead, Math.min(REACTION.slotLead, delta));
  const ring = Math.max(REACTION.slotRadius, def.engageRange + REACTION.slotMargin);
  return add(player, scale(fromAngle(here + lead), ring));
}
