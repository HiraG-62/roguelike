import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import { type Vec, angle, length, normalize, scale, sub } from "../core/vec";
import { enemyTarget, pushEvent } from "../core/events";
import { WEAPON } from "../data/tuning";
import {
  type ActionStepDef,
  type AimArtDef,
  type BranchDef,
  type BranchShots,
  type HoldArtDef,
  type RecallArtDef,
  type StrikeExtras,
  type SwingActionStep,
  type ThrowArtDef,
  actionCooldown,
  laneLength,
  laneVolley,
  releaseBranchIndex,
} from "../data/weapons";
import { scaled, withRatio } from "./attributes";
import { cancelAttack, gainEnergy } from "./combat";
import { addFloatingText, spawnBurst } from "./effects";
import { currentShot, emitVolley, isAttacking, isDashing, isPlayerStaggered, logButton, playerMoveset, startArtBranch } from "./player";
import { addPoise } from "./poise";
import { onTraitCounter } from "./traitHooks";
import { BULLETS } from "../loot/bullets";

/**
 * 右レーン（アクション 2。docs/ideas/ougi-and-dual-actions.md 4 章）の振り以外の段: hold（受け流し・構え）/ volley（弾を出す）/
 * recall（弾を戻す）/ aim（短銃の狙い撃ち）と、段の key ごとの再使用・受け流しを外した硬直・派生の弾と付随効果。
 * 振りの段と刀の居合（近接の溜め）は player.ts の連撃・溜めの経路をそのまま使う。
 * 振り以外の段は押した瞬間に始まり、終わったら左右共有の段カウンタ（AttackState.step）を 1 つ進める
 */

const A = WEAPON.artDefaults;
const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN = Math.PI * 2;
const PARRY_TEXT_SCALE = 1.4;
const PARRY_TEXT_LIFE = 0.6;
const FX_SPEED = 120;
const FX_LIFE = 0.3;
const FX_SIZE = 2;
const AIM_READY_PARTICLES = 6;
/** 手元返しで向け直さない距離（手元に重なっている弾） */
const RECALL_MIN_DIST = 1;

/** 構え・狙いを押している右レーンの段（段カウンタが指す段）。構えていなければ undefined */
function currentHoldStep(state: GameState): ActionStepDef | undefined {
  if (!state.player.art.holding) return undefined;
  return playerMoveset(state).steps2[state.player.attack.step];
}

/** 押している間の構え（受け流し・盾の構え）。今の段が構えでなければ undefined */
function currentHold(state: GameState): HoldArtDef | undefined {
  const s = currentHoldStep(state);
  return s?.kind === "hold" ? s.hold : undefined;
}

/** 短銃の狙い撃ち。今の段が狙い撃ちでなければ undefined */
function currentAim(state: GameState): AimArtDef | undefined {
  const s = currentHoldStep(state);
  return s?.kind === "aim" ? s.aim : undefined;
}

/** 押した瞬間に完結する段（弾・手元返し）。振りの最中の recover を打ち切って出し、共有の間（laneGap）を置く */
export function isInstantStep(s: ActionStepDef): boolean {
  return s.kind === "volley" || s.kind === "recall";
}

function stepKey(s: ActionStepDef): string | undefined {
  return s.key === undefined || s.key === "" ? undefined : s.key;
}

/** 右レーンの段の再使用の残り秒（段の key ごと。弾・手元返しの段は共有の間も見る） */
export function actionCooldownLeft(state: GameState, s: ActionStepDef): number {
  const key = stepKey(s);
  const own = key === undefined ? 0 : (state.player.art.cooldowns.get(key) ?? 0);
  const gap = isInstantStep(s) ? state.player.art.cooldown : 0;
  return Math.max(own, gap);
}

function startCooldown(state: GameState, s: ActionStepDef): void {
  const key = stepKey(s);
  const sec = actionCooldown(s);
  if (key !== undefined && sec > 0) state.player.art.cooldowns.set(key, sec);
}

/** 段の key ごとの再使用と共有の間を進める（切れた key は消す。Map の並びは挿入順なので決定的） */
function tickCooldowns(state: GameState, dt: number): void {
  const art = state.player.art;
  art.cooldown = Math.max(0, art.cooldown - dt);
  for (const [key, left] of art.cooldowns) {
    const next = left - dt;
    if (next <= 0) art.cooldowns.delete(key);
    else art.cooldowns.set(key, next);
  }
}

/**
 * 右レーンの index 段目を終えて段カウンタを 1 つ進める。右レーンの最終段なら連撃の終わり（1 段目へ戻り、入力列を捨てる）。
 * 続くなら入力の窓を開け直す（構えを長く押しても、離した直後の押下で連撃が続く）
 */
function advanceLane(state: GameState, index: number): void {
  const a = state.player.attack;
  const next = index + 1;
  if (next >= laneLength(playerMoveset(state), "secondary")) {
    a.step = 0;
    a.inputs.length = 0;
    return;
  }
  a.step = next;
  a.inputTimer = Math.max(a.inputTimer, WEAPON.chainWindow);
}

/** 受け流しを外した硬直中か（攻撃・技・射撃のボタンを受け付けない） */
export function artLocksActions(state: GameState): boolean {
  return state.player.art.recover > 0;
}

/** 振りの最中なら段を出せない。recover 中は振りを打ち切って出す（先行入力と同じ手触り） */
function freeForArt(state: GameState): boolean {
  const p = state.player;
  if (isDashing(p)) return false;
  if (!isAttacking(p)) return true;
  if (p.attack.phase !== "recover") return false;
  cancelAttack(state);
  return true;
}

/**
 * 右レーンの振り以外・溜め以外の段（構え・狙い・弾・手元返し）を index 段目として始める（player.ts の右の押下から）。
 * 構え・狙いは離す（窓が閉じる）まで段カウンタを保ち、弾・手元返しはすぐ段を進める。出したら true
 */
export function startLaneArt(state: GameState, s: ActionStepDef, index: number): boolean {
  if (s.kind === "swing" || s.kind === "charge") return false;
  if (!freeForArt(state)) return false;
  const p = state.player;
  p.attack.step = index;
  switch (s.kind) {
    case "hold":
      beginHold(state);
      logButton(p, "secondary");
      // 受け流しは押した瞬間に再使用を立てる（連打で窓を繋げない）。構えは離したときに立てる
      if (s.hold.parry) startCooldown(state, s);
      return true;
    case "aim":
      beginHold(state);
      logButton(p, "secondary");
      return true;
    case "volley":
      if (!emitArtVolley(state, s.throw)) return false;
      logButton(p, "secondary");
      finishInstant(state, s, index);
      return true;
    case "recall":
      recallShots(state, s.recall);
      logButton(p, "secondary");
      finishInstant(state, s, index);
      return true;
  }
}

function finishInstant(state: GameState, s: ActionStepDef, index: number): void {
  startCooldown(state, s);
  state.player.art.cooldown = A.laneGap;
  advanceLane(state, index);
}

function beginHold(state: GameState): void {
  const a = state.player.art;
  a.holding = true;
  a.holdTime = 0;
}

/** 構え・狙いを何も出さずに解く（ダッシュ・怯み・武器種の差し替え）。受け流しの窓もここで閉じる（硬直は付けない）。段は進めない */
export function endArtHold(state: GameState): void {
  const a = state.player.art;
  a.holding = false;
  a.holdTime = 0;
}

/** 構え・狙いを解いて段を進める（押している最中の次の押下・受け流しの成功と窓の終わり）。構えていなければ何もしない */
export function finishArtHold(state: GameState): void {
  if (!state.player.art.holding) return;
  const index = state.player.attack.step;
  endArtHold(state);
  advanceLane(state, index);
}

/** 右レーンの段の時間を進める。player.ts の updatePlayer から溜めの直後に毎ステップ呼ぶ */
export function updateArt(state: GameState, input: FrameInput, dt: number): void {
  const p = state.player;
  tickCooldowns(state, dt);
  p.art.recover = Math.max(0, p.art.recover - dt);
  if (!p.art.holding) return;
  if (isPlayerStaggered(p) || isDashing(p)) {
    endArtHold(state);
    return;
  }
  const hold = currentHold(state);
  if (hold?.parry) {
    updateParry(state, hold.parry, dt);
    return;
  }
  if (hold) {
    updateGuard(state, hold, input.shootHeld, dt);
    return;
  }
  const aim = currentAim(state);
  if (aim) {
    updateAim(state, aim, input.shootHeld, dt);
    return;
  }
  // 武器種が変わって技の種類が変わった（変身・装備変更）
  endArtHold(state);
}

/** 受け流し: 窓（押してから windowSec）を過ぎても被弾を受け流していなければ外れ。recoverSec の硬直を付けて段を進める */
function updateParry(state: GameState, parry: NonNullable<HoldArtDef["parry"]>, dt: number): void {
  const a = state.player.art;
  a.holdTime += dt;
  if (a.holdTime < parry.windowSec) return;
  finishArtHold(state);
  a.recover = parry.recoverSec;
}

/** 盾の構え: 離すか maxSec を過ぎたら解き、盾押し（release の派生。その後の段は releaseNext）を出す */
function updateGuard(state: GameState, hold: HoldArtDef, held: boolean, dt: number): void {
  const a = state.player.art;
  a.holdTime += dt;
  if (held && a.holdTime < hold.maxSec) return;
  const s = currentHoldStep(state);
  endArtHold(state);
  if (s) startCooldown(state, s);
  const index = releaseBranchIndex(playerMoveset(state));
  if (index !== undefined) startArtBranch(state, index);
}

/** 狙い撃ち: 押している間溜め、離したら撃つ。time に届いていれば強めた 1 発、届かなければ普通の 1 発 */
function updateAim(state: GameState, aim: AimArtDef, held: boolean, dt: number): void {
  const a = state.player.art;
  if (held) {
    const before = a.holdTime;
    a.holdTime += dt;
    if (before < aim.time && a.holdTime >= aim.time) onAimReady(state);
    return;
  }
  const ready = a.holdTime >= aim.time;
  const s = currentHoldStep(state);
  finishArtHold(state);
  const fired = emitVolley(state, currentShot(state.stats), 0, state.player.aimDistance, ready ? { count: 1, damageMul: aim.damageMul, pierceBonus: aim.pierceBonus } : { count: 1 });
  if (fired && s) startCooldown(state, s);
}

/** 狙いが定まった合図（離すタイミングを目と耳で計れるように） */
function onAimReady(state: GameState): void {
  const color = WEAPON.chargeRingColors[1] ?? A.parryColor;
  spawnBurst(state, state.player.body.pos, color, AIM_READY_PARTICLES, FX_SPEED, FX_LIFE, FX_SIZE);
  pushSfx(state, "chargeLevel");
}

/** 構え・狙い中の移動速度倍率（構えていなければ 1） */
export function artMoveMul(state: GameState): number {
  if (!state.player.art.holding) return 1;
  const hold = currentHold(state);
  if (hold) return hold.moveMul;
  return currentAim(state)?.moveMul ?? 1;
}

/**
 * 受け流し（combat.ts の damagePlayer が無敵判定の直後に呼ぶ）。窓の中の被弾を無効にし、
 * 攻撃した敵に怯み値を入れてカウンター扱いにする（onCounter を発火。刀のルールや祝福が乗る）。受け流したら true
 */
export function tryParry(state: GameState, attacker?: Enemy): boolean {
  const p = state.player;
  const parry = currentHold(state)?.parry;
  if (!parry || !p.art.holding || p.art.holdTime >= parry.windowSec) return false;
  finishArtHold(state);
  p.invulnTimer = Math.max(p.invulnTimer, A.parryInvuln);
  addFloatingText(state, p.body.pos, A.parryText, A.parryColor, PARRY_TEXT_SCALE, PARRY_TEXT_LIFE);
  spawnBurst(state, p.body.pos, A.parryColor, A.parryParticles, FX_SPEED, FX_LIFE, FX_SIZE);
  pushSfx(state, "counter");
  if (attacker && attacker.hp > 0) counterAttacker(state, attacker, parry.staggerPoise);
  return true;
}

function counterAttacker(state: GameState, e: Enemy, poise: number): void {
  addPoise(state, e, poise * state.stats.poiseDamageMul, { ignoreSuperArmor: true });
  onTraitCounter(state, e);
  pushEvent(state, { kind: "onCounter", actor: "player", source: { kind: "player", key: "counter" }, ...enemyTarget(e) });
}

/**
 * 盾の構え（combat.ts の damagePlayer が被ダメに掛ける）。向きから arcDeg の内側から来た被弾は damageMul 倍にし、
 * 受けるたびに奥義ゲージを溜める。構えていない・後ろからの被弾は 1
 */
export function guardDamageMul(state: GameState, fromPos: Vec): number {
  const p = state.player;
  const guard = currentHold(state)?.guard;
  if (!guard || !p.art.holding) return 1;
  if (!inFront(p.body.pos, p.facing, fromPos, guard.arcDeg)) return 1;
  gainEnergy(state, guard.energyGain);
  spawnBurst(state, p.body.pos, A.guardColor, A.guardParticles, FX_SPEED, FX_LIFE, FX_SIZE);
  return guard.damageMul;
}

/** from が向き facing から arcDeg の扇の内側か。真上に重なっている（向きが無い）なら前とみなす */
function inFront(origin: Vec, facing: Vec, from: Vec, arcDeg: number): boolean {
  const rel = sub(from, origin);
  if (length(rel) === 0) return true;
  let diff = (angle(rel) - angle(facing)) % FULL_TURN;
  if (diff > Math.PI) diff -= FULL_TURN;
  if (diff < -Math.PI) diff += FULL_TURN;
  return Math.abs(diff) <= (arcDeg * DEG_TO_RAD) / 2;
}

/** 弾を出す段の数の差し替え（派生の shots が弾数・扇・貫通・威力の倍率を変える） */
export interface ArtVolleyOverride {
  count?: number;
  spreadDeg?: number;
  pierceBonus?: number;
  damageMul?: number;
}

/**
 * 弾を出す段（斧の投擲・杖の魔弾・乱れ撃ち）。弾は段自身が持ち（ThrowArtDef.bullet）、威力・怯み値・弾数は段のもの。
 * 射撃扱い（射撃の性質・onRangedHit が乗る）。出したら true
 */
export function emitArtVolley(state: GameState, t: ThrowArtDef, over: ArtVolleyOverride = {}): boolean {
  return emitVolley(state, t.bullet, 0, state.player.aimDistance, {
    damage: scaled(state.stats, t.scaling) * (over.damageMul ?? 1),
    poise: withRatio(state.stats, t.poise, t.poiseRatio) * state.stats.poiseDamageMul,
    count: over.count ?? t.count,
    spreadDeg: over.spreadDeg ?? t.spreadDeg,
    pierceBonus: over.pierceBonus,
    attack: t.attack,
    recoil: false,
    sprite: t.sprite,
    applies: t.applies,
  });
}

/**
 * 手元返し: 飛んでいる自分の弾（床に据えた設置弾・山なりの曲射を除く）をすべて手元へ向け直す。
 * 戻りの弾は威力 returnDamageMul 倍で、当てた敵を忘れてもう一度当たる。向け直した数を返す
 */
export function recallShots(state: GameState, recall: RecallArtDef): number {
  const hand = state.player.body.pos;
  let count = 0;
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.life <= 0 || isGrounded(pr.shot?.key)) continue;
    const toHand = sub(hand, pr.pos);
    const d = length(toHand);
    if (d < RECALL_MIN_DIST) continue;
    const speed = Math.max(A.recallMinSpeed, length(pr.vel)) * recall.speedMul;
    pr.vel = scale(normalize(toHand), speed);
    pr.damage *= recall.returnDamageMul;
    pr.hitIds.clear();
    // 手元に届くまでは消えない。回転刃は戻りの扱いにして手元で収める
    pr.life = Math.max(pr.life, d / speed);
    markRecalled(pr, recall);
    count += 1;
  }
  if (count > 0) pushSfx(state, "reflect");
  return count;
}

/**
 * 戻りの印を付ける。追尾のある手元返しは作業領域に旋回を写す（projectiles.ts の steerShot が近くの敵へ曲げる）。
 * 挙動の性質を持たない弾は作業領域が無いので、key 空の作業領域を足して旋回だけ持たせる
 */
function markRecalled(pr: Projectile, recall: RecallArtDef): void {
  if (!pr.shot && !recall.homing) return;
  pr.shot ??= { key: "" };
  pr.shot.returning = true;
  if (recall.homing) pr.shot.recallHoming = { ...recall.homing };
}

function isGrounded(key: string | undefined): boolean {
  if (key === undefined) return false;
  const def = BULLETS[key];
  return def !== undefined && (def.mine !== undefined || def.lob !== undefined);
}

/** 右レーンの振りの段を振り始めたとき（player.ts の beginSwing から）。再使用を立て、付随効果（零距離砲の反動・起爆）を出す */
export function onLaneSwingStart(state: GameState, s: SwingActionStep): void {
  startCooldown(state, s);
  if (s.extras) applyStrikeExtras(state, s.extras);
}

/** 派生を振り始めたとき（player.ts の startBranch から）。付随効果と弾（二連・光条など）を出す */
export function onBranchStart(state: GameState, branch: BranchDef): void {
  if (branch.extras) applyStrikeExtras(state, branch.extras);
  if (branch.shots) emitBranchShots(state, branch.shots);
}

/** 派生の弾。from が lane なら右レーンの弾の段の弾、省略は装備の銃の弾（射撃として当たる） */
function emitBranchShots(state: GameState, shots: BranchShots): void {
  const over = { count: shots.count, spreadDeg: shots.spreadDeg, pierceBonus: shots.pierceBonus, damageMul: shots.damageMul };
  if (shots.from !== "lane") {
    emitVolley(state, currentShot(state.stats), 0, state.player.aimDistance, over);
    return;
  }
  const t = laneVolley(playerMoveset(state));
  if (t) emitArtVolley(state, t, over);
}

function applyStrikeExtras(state: GameState, extras: StrikeExtras): void {
  const p = state.player;
  if (extras.selfKnock !== undefined) p.knock = sub(p.knock, scale(p.facing, extras.selfKnock));
  if (extras.detonateMines) detonateOwnMines(state);
}

/** 床の自分の設置弾を次のステップで炸裂させる（寿命を尽きかけにし、projectiles.ts の信管切れの経路で炸裂させる） */
export function detonateOwnMines(state: GameState): void {
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.life <= 0 || pr.shot?.detonated) continue;
    if (pr.shot && BULLETS[pr.shot.key]?.mine) pr.life = Math.min(pr.life, A.detonateLife);
  }
}
