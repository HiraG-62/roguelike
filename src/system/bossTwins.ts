import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { damagePlayer } from "./combat";
import { shake, spawnBurst } from "./effects";
import { createEnemy, moveEnemy, scaledWindup } from "./enemies";
import { fanDirections, fireEnemyBullet } from "./enemyTraits";
import { circlesOverlap, overlapsWall } from "./physics";
import { inflictOnPlayer, isSilenced } from "./statusEffects";
import { phaseShift } from "./boss";

/**
 * ボス: 双子の騎士（docs/ideas/enemies.md B2）。兄（剣と盾の突進）と妹（弓の扇）が連携する。
 * 第 1 段階 = 2 人 / 第 2 段階 = 相方が倒れ、形見を拾って両方の技を交互に使う（溜めは長め）/
 * 第 3 段階 = 残った方の HP が rageRatio を切ると激昂（攻撃間隔が縮み、矢が増える）。
 * 兄はガードブレイク、妹は弓を引く溜め（強靭 1.5）が怯みの窓
 */

const STAGE_PAIRED = 1;
const STAGE_BEREAVED = 2;
const STAGE_RAGE = 3;
/** ai.move: 次に出す技 */
export const TWIN_MOVE_LUNGE = 0;
export const TWIN_MOVE_VOLLEY = 1;
/** 妹を兄の横に置く距離 */
const SISTER_OFFSET = 48;
/** 突進を始める距離（これより遠ければ寄る） */
const LUNGE_REACH = 110;
const BEREAVED_TEXT = "形見を拾った";
const RAGE_TEXT = "激昂";
const RAGE_COLOR = "#ff6060";

/** 兄の隣に妹を置き、互いを相方として結ぶ */
export function spawnTwinSister(state: GameState, brother: Enemy): void {
  const def = enemyDef("twinSister");
  const want = add(brother.body.pos, { x: -SISTER_OFFSET, y: 0 });
  const pos = overlapsWall(state, want.x, want.y, def.radius) ? add(brother.body.pos, { x: SISTER_OFFSET, y: 0 }) : want;
  const sister = createEnemy(state, def, pos, brother.roomIndex, false);
  sister.leaderId = brother.id;
  brother.leaderId = sister.id;
  if (sister.ai) sister.ai.move = TWIN_MOVE_VOLLEY;
  state.enemies.push(sister);
}

/** 相方（生きていれば） */
export function twinPartner(state: GameState, e: Enemy): Enemy | undefined {
  if (e.leaderId === undefined) return undefined;
  return state.enemies.find((o) => o.id === e.leaderId && o !== e && o.hp > 0);
}

/** 自分の得意技（兄 = 突進 / 妹 = 弓） */
function ownMove(def: EnemyDef): number {
  return def.behavior === "twinBlade" ? TWIN_MOVE_LUNGE : TWIN_MOVE_VOLLEY;
}

export function updateTwin(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  advanceStage(state, e);
  const toPlayer = sub(state.player.body.pos, e.body.pos);
  const d = length(toPlayer);
  const dir = normalize(toPlayer);
  switch (e.phase) {
    case "chase":
      if (dir.x !== 0) e.facing = dir;
      approach(state, e, def, dir, d, dt);
      if (e.attackCooldown > 0) return;
      if (ai.move === TWIN_MOVE_LUNGE && d > LUNGE_REACH) return;
      beginWindup(state, e, def, dir);
      return;
    case "windup":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) beginStrike(state, e, def, dir);
      return;
    case "strike":
      tickStrike(state, e, def, dt);
      return;
    case "recover":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) endRecover(e, def);
      return;
    default:
      return;
  }
}

/** 段階の移行: 相方が倒れたら形見を拾う、HP が減ったら激昂 */
function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const t = BOSS.twinKnights;
  if (ai.stage === STAGE_PAIRED && !twinPartner(state, e)) {
    phaseShift(state, e, BEREAVED_TEXT, t.color, STAGE_BEREAVED);
    return;
  }
  if (ai.stage === STAGE_BEREAVED && e.hp <= e.maxHp * t.rageRatio) phaseShift(state, e, RAGE_TEXT, RAGE_COLOR, STAGE_RAGE);
}

/** 突進役は寄り、弓役は距離を保つ（形見を拾った後は次の技で決める） */
function approach(state: GameState, e: Enemy, def: EnemyDef, dir: Vec, d: number, dt: number): void {
  const t = BOSS.twinKnights;
  const lunge = e.ai?.move === TWIN_MOVE_LUNGE;
  const radial = lunge ? 1 : d < t.keepAway * 0.8 ? -1 : d > t.keepAway * 1.3 ? 1 : 0;
  const perp = { x: -dir.y, y: dir.x };
  const move = add(scale(dir, radial), scale(perp, Math.sin(e.animTime) * 0.5));
  moveEnemy(state, e, def, move.x * def.speed * dt, move.y * def.speed * dt);
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void {
  const bereaved = (e.ai?.stage ?? STAGE_PAIRED) >= STAGE_BEREAVED;
  e.phase = "windup";
  e.phaseTimer = scaledWindup(def.windup * (bereaved ? BOSS.twinKnights.bereavedWindupMul : 1), state.depth);
  e.strikeDir = dir;
  pushSfx(state, "enemyWindup");
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void {
  // 予備動作の終わりで狙いを更新する（完全追尾ではなく、避けた側が勝つ）
  e.strikeDir = normalize(dir, e.strikeDir);
  if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
  e.phase = "strike";
  e.phaseTimer = def.strikeTime;
  if (e.ai?.move === TWIN_MOVE_VOLLEY) fireArrows(state, e);
  else spawnBurst(state, e.body.pos, def.color, 8, 80, 0.2, 1.5);
}

/** 弓: 扇に矢を放つ（沈黙中は撃てない） */
function fireArrows(state: GameState, e: Enemy): void {
  if (isSilenced(e)) return;
  const t = BOSS.twinKnights;
  const rage = e.ai?.stage === STAGE_RAGE;
  const count = rage ? t.rageArrowCount : t.arrowCount;
  const damage = t.arrowDamage + depthDamageBonus(state.depth);
  for (const dir of fanDirections(e.strikeDir, count, t.arrowSpreadDeg * (rage ? 2 : 1))) {
    const pos = add(e.body.pos, scale(dir, e.body.radius + 2));
    fireEnemyBullet(state, { pos, dir, speed: t.arrowSpeed, damage, color: t.color, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  e.phaseTimer -= dt;
  if (e.ai?.move === TWIN_MOVE_LUNGE) {
    const speed = def.speed * BOSS.twinKnights.lungeSpeedMul;
    const hit = moveEnemy(state, e, def, e.strikeDir.x * speed * dt, e.strikeDir.y * speed * dt);
    if (hit.hitX || hit.hitY || touch(state, e, def)) e.phaseTimer = 0;
  }
  if (e.phaseTimer > 0) return;
  e.phase = "recover";
  e.phaseTimer = def.recover;
}

/** 突進が触れたら当てる。当たったか（無敵で無視されたかも含む）を返す */
function touch(state: GameState, e: Enemy, def: EnemyDef): boolean {
  const p = state.player.body;
  if (!circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, p.pos.x, p.pos.y, p.radius)) return false;
  const result = damagePlayer(state, def.contactDamage + depthDamageBonus(state.depth), e.body.pos, e);
  if (result === "hit") {
    inflictOnPlayer(state, e, "contact");
    shake(state, FEEL.shakeHeavy);
  }
  return result !== "ignored";
}

/** 隙の終わり: 次の技を決める（形見を拾った後は自分の技と相方の技を交互に） */
function endRecover(e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  e.phase = "chase";
  const rage = ai?.stage === STAGE_RAGE;
  e.attackCooldown = def.attackInterval * (rage ? BOSS.twinKnights.rageIntervalMul : 1);
  if (!ai) return;
  if (ai.stage === STAGE_PAIRED) {
    ai.move = ownMove(def);
    return;
  }
  ai.move = ai.move === TWIN_MOVE_LUNGE ? TWIN_MOVE_VOLLEY : TWIN_MOVE_LUNGE;
}

/** 予備動作中の予告の種類（突進は線、弓は ! だけ） */
export function twinTelegraphIsLine(e: Enemy): boolean {
  return e.ai?.move === TWIN_MOVE_LUNGE;
}

