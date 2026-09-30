import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamage } from "../data/enemies";
import { ENEMY_AI, FEEL, JIN } from "../data/tuning";
import { lineOfSight } from "../map/pathing";
import { damagePlayer } from "./combat";
import { shake, spawnBurst } from "./effects";
import { contactDamageOf } from "./enemyBehaviors";
import { onRallyContact } from "./enemyTerrain";
import { findFreeSpot } from "./enemyTraits";
import { spawnLanding } from "./hazards";
import { moveBody, overlapsWall } from "./physics";
import { inflictOnPlayer } from "./statusEffects";

/**
 * 跳躍（leaper。docs/ideas/jin-impl.md 2-4 の語彙「跳躍」）: 予備動作の始まりに着地点を決めて影で予告し、
 * strike の間に跳んで、着地で円の範囲に当てる。
 * - 着地点は予備動作の始まりで固定（避けた側が勝つ）。影は予備動作と滞空の間ずっと同じ場所に出る（フェイントしない）
 * - 跳んでいる間も当たり判定を持つ（無敵にしない。空中の敵を殴って落とす読み合いを残す）
 * ai.target = 着地点。状態は e.ai だけに置く（behavior のクラスは凍結されている）
 */

/** 跳ぶ道筋を調べる刻み（px）。体の半径より十分小さく、壁の角を飛び越えない */
const LEAP_PATH_STEP = 2;

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
  const free = findFreeSpot(state, want, def.radius) ?? { ...e.body.pos };
  ai.target = clearLeapEnd(state, e.body.pos, free, e.body.radius);
  const shadow = spawnLanding(state, ai.target, l.radius, e.phaseTimer + def.strikeTime, e.id);
  shadow.airTime = def.strikeTime;
}

/**
 * from から to へ体（半径 radius）を運ぶとき、壁に掛からずに届く最も遠い点。
 * canLeap の視線は中心の線だけを見るので、体の幅が壁の角を削る道筋はここで手前に切る（空中で壁にめり込ませない）
 */
function clearLeapEnd(state: GameState, from: Vec, to: Vec, radius: number): Vec {
  const delta = sub(to, from);
  const steps = Math.ceil(length(delta) / LEAP_PATH_STEP);
  let last = { ...from };
  for (let i = 1; i <= steps; i++) {
    const p = add(from, scale(delta, i / steps));
    if (overlapsWall(state, p.x, p.y, radius)) return last;
    last = p;
  }
  return { ...to };
}

/**
 * strike の 1 ステップ（phaseTimer は減らした後）: 残りの時間で着地点へ着くように寄せ、時間が尽きたら着地する。
 * 押し合い・吹き飛びで位置がずれても、次のステップで着地点へ寄せ直す（着地は、着地点が塞がっていなければ影の上）
 */
export function stepLeap(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const target = e.ai?.target;
  if (!target) return;
  if (e.phaseTimer > 0) {
    const frac = Math.min(1, dt / (e.phaseTimer + dt));
    const step = scale(sub(target, e.body.pos), frac);
    // 押し合い・吹き飛びでずれた位置からの寄せ直しは壁の角を通りうるので、壁で止まる移動にする
    moveBody(state, e.body, step.x, step.y);
    return;
  }
  land(state, e, def, target);
}

/** 着地: 影を消し、円の中のプレイヤーに当てる（接触攻撃と同じ扱い: 受け流せる・接触の状態異常が付く） */
function land(state: GameState, e: Enemy, def: EnemyDef, at: Vec): void {
  const l = ENEMY_AI.leaper;
  // 予備動作の間に部屋の扉が閉じる（floor.ts の lockRoom）などで着地点が塞がっていたら、今いる所から届く手前で降りる
  const landAt = clearLeapEnd(state, e.body.pos, at, e.body.radius);
  e.body.pos = { ...landAt };
  endShadow(state, e);
  spawnBurst(state, landAt, def.color, l.particles, 70, 0.3, 2);
  shake(state, FEEL.shakeLight);
  pushSfx(state, "oilSplash");
  const p = state.player.body;
  if (dist(p.pos, landAt) >= l.radius + p.radius) return;
  const result = damagePlayer(state, landingDamage(state, e, def), landAt, e);
  if (result !== "hit") return;
  inflictOnPlayer(state, e, "contact");
  onRallyContact(state, e);
}

/** 着地の威力 = 接触ダメージ（格「猛」の倍率込み）+ 深度の加算 */
export function landingDamage(state: GameState, e: Enemy, def: EnemyDef): number {
  const strongMul = e.grade === "strong" ? JIN.strong.damageMul : 1;
  return depthDamage(Math.round(contactDamageOf(e, def) * strongMul), state.depth);
}

/** 着いた跳躍の影を消す（連撃で次の予備動作に入っても、前の影が残らないように） */
function endShadow(state: GameState, e: Enemy): void {
  for (const h of state.hazards) {
    if (h.kind === "landing" && h.sourceId === e.id && h.airTime !== undefined) h.spent = true;
  }
}
