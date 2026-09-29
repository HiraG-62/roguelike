import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus } from "../data/enemies";
import { ENEMY_AI, FEEL, JIN } from "../data/tuning";
import { lineOfSight } from "../map/pathing";
import { damagePlayer } from "./combat";
import { shake, spawnBurst } from "./effects";
import { contactDamageOf } from "./enemyBehaviors";
import { onRallyContact } from "./enemyTerrain";
import { findFreeSpot } from "./enemyTraits";
import { spawnLanding } from "./hazards";
import { inflictOnPlayer } from "./statusEffects";

/**
 * 跳躍（leaper。docs/ideas/jin-impl.md 2-4 の語彙「跳躍」）: 予備動作の始まりに着地点を決めて影で予告し、
 * strike の間に跳んで、着地で円の範囲に当てる。
 * - 着地点は予備動作の始まりで固定（避けた側が勝つ）。影は予備動作と滞空の間ずっと同じ場所に出る（フェイントしない）
 * - 跳んでいる間も当たり判定を持つ（無敵にしない。空中の敵を殴って落とす読み合いを残す）
 * ai.target = 着地点。状態は e.ai だけに置く（behavior のクラスは凍結されている）
 */

/** 攻撃を始めてよいか: 着地点までの間に壁が無いとき（壁越しに跳ばない） */
export function canLeap(state: GameState, e: Enemy): boolean {
  return lineOfSight(state.map, e.body.pos, state.player.body.pos);
}

/** 予備動作の始まり: 着地点を決め、予備動作 + 滞空の間だけ影を置く */
export function planLeap(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const l = ENEMY_AI.leaper;
  const toPlayer = sub(state.player.body.pos, e.body.pos);
  const reach = Math.min(length(toPlayer), l.maxLeap);
  const want = add(e.body.pos, scale(normalize(toPlayer, e.facing), reach));
  ai.target = findFreeSpot(state, want, def.radius) ?? { ...e.body.pos };
  const shadow = spawnLanding(state, ai.target, l.radius, e.phaseTimer + def.strikeTime, e.id);
  shadow.airTime = def.strikeTime;
}

/**
 * strike の 1 ステップ（phaseTimer は減らした後）: 残りの時間で着地点へ着くように寄せ、時間が尽きたら着地する。
 * 押し合い・吹き飛びで位置がずれても、次のステップで着地点へ寄せ直す（着地は必ず影の上）
 */
export function stepLeap(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const target = e.ai?.target;
  if (!target) return;
  if (e.phaseTimer > 0) {
    const frac = Math.min(1, dt / (e.phaseTimer + dt));
    e.body.pos = add(e.body.pos, scale(sub(target, e.body.pos), frac));
    return;
  }
  land(state, e, def, target);
}

/** 着地: 影を消し、円の中のプレイヤーに当てる（接触攻撃と同じ扱い: 受け流せる・接触の状態異常が付く） */
function land(state: GameState, e: Enemy, def: EnemyDef, at: Vec): void {
  const l = ENEMY_AI.leaper;
  e.body.pos = { ...at };
  endShadow(state, e);
  spawnBurst(state, at, def.color, l.particles, 70, 0.3, 2);
  shake(state, FEEL.shakeLight);
  pushSfx(state, "oilSplash");
  const p = state.player.body;
  if (dist(p.pos, at) >= l.radius + p.radius) return;
  const result = damagePlayer(state, landingDamage(state, e, def), at, e);
  if (result !== "hit") return;
  inflictOnPlayer(state, e, "contact");
  onRallyContact(state, e);
}

/** 着地の威力 = 接触ダメージ（格「猛」の倍率込み）+ 深度の加算 */
export function landingDamage(state: GameState, e: Enemy, def: EnemyDef): number {
  const strongMul = e.grade === "strong" ? JIN.strong.damageMul : 1;
  return Math.round(contactDamageOf(e, def) * strongMul) + depthDamageBonus(state.depth);
}

/** 着いた跳躍の影を消す（連撃で次の予備動作に入っても、前の影が残らないように） */
function endShadow(state: GameState, e: Enemy): void {
  for (const h of state.hazards) {
    if (h.kind === "landing" && h.sourceId === e.id && h.airTime !== undefined) h.spent = true;
  }
}
