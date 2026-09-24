import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, angle, length, normalize, scale, sub } from "../core/vec";
import { enemyTarget, pushEvent } from "../core/events";
import { WEAPON } from "../data/tuning";
import {
  type AimArtDef,
  type HoldArtDef,
  type MovesetDef,
  type RecallArtDef,
  type StrikeExtras,
  type ThrowArtDef,
  matchBranch,
  releaseBranchIndex,
} from "../data/weapons";
import { scaled, withRatio } from "./attributes";
import { boonBlocksShoot } from "./boonRules";
import { cancelAttack, gainEnergy } from "./combat";
import { addFloatingText, spawnBurst } from "./effects";
import { currentShot, emitVolley, isAttacking, isDashing, isPlayerStaggered, playerMoveset, startArtBranch } from "./player";
import { addPoise } from "./poise";
import { onTraitCounter } from "./traitHooks";
import { BULLETS } from "../loot/bullets";

/**
 * 右クリックの固有技（docs/ideas/weapon-redesign.md 3 章）。strike の技は派生として player.ts の tryBranch が出すので、
 * ここは hold（受け流し・構え）/ throw（弾を出す）/ recall（弾を戻す）/ 短銃の狙い撃ちの経路と、再使用・硬直の時間を持つ。
 * 刀の居合（近接の溜め）は player.ts の溜めの経路をそのまま使う
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

/** 押している間の構え（受け流し・盾の構え）。今の武器種の技が構えでなければ undefined */
function currentHold(state: GameState): HoldArtDef | undefined {
  const art = playerMoveset(state).art;
  return art.kind === "hold" ? art.hold : undefined;
}

/** 短銃の狙い撃ち。今の武器種の技が狙い撃ちでなければ undefined */
function currentAim(state: GameState): AimArtDef | undefined {
  const art = playerMoveset(state).art;
  return art.kind === "charge" ? art.aim : undefined;
}

/**
 * 右を押した瞬間に、入力列（押した右を積んだ後）が固有技そのものに当たり、しかも技が使えない（再使用中・硬直中）か。
 * 真なら何も起こさず、入力列にも積まない。「左左右」の十字断ちのように技ではない派生に当たるなら妨げない
 */
export function artInputBlocked(state: GameState, moveset: MovesetDef): boolean {
  const p = state.player;
  if (p.art.cooldown <= 0 && p.art.recover <= 0) return false;
  const index = matchBranch(moveset, p.attack.inputs);
  const branch = index === undefined ? undefined : moveset.branches[index];
  return branch === undefined || branch.art !== undefined;
}

/** 受け流しを外した硬直中か（攻撃・技・射撃のボタンを受け付けない） */
export function artLocksActions(state: GameState): boolean {
  return state.player.art.recover > 0;
}

/** 振りの最中なら技を出せない。recover 中は振りを打ち切って出す（先行入力と同じ手触り） */
function freeForArt(state: GameState): boolean {
  const p = state.player;
  if (isDashing(p)) return false;
  if (!isAttacking(p)) return true;
  if (p.attack.phase !== "recover") return false;
  cancelAttack(state);
  return true;
}

/**
 * 右の押下で、strike 以外の固有技を始める（strike は派生として tryBranch が出す。居合は player.ts の溜めの経路）。
 * 出したら true
 */
export function startArt(state: GameState): boolean {
  const art = playerMoveset(state).art;
  if (art.kind === "strike" || (art.kind === "charge" && art.charge)) return false;
  if (!freeForArt(state)) return false;
  const p = state.player;
  switch (art.kind) {
    case "hold":
      beginHold(state);
      // 受け流しは押した瞬間に再使用を立てる（連打で窓を繋げない）。構えは離したときに立てる
      if (art.hold.parry) p.art.cooldown = art.cooldown;
      return true;
    case "charge":
      beginHold(state);
      return true;
    case "throw":
      if (!emitArtVolley(state, art.throw)) return false;
      p.art.cooldown = art.cooldown;
      return true;
    case "recall":
      recallShots(state, art.recall);
      p.art.cooldown = art.cooldown;
      return true;
  }
}

function beginHold(state: GameState): void {
  const a = state.player.art;
  a.holding = true;
  a.holdTime = 0;
}

/** 構え・狙いを何も出さずに解く（左の押下・ダッシュ・怯み）。受け流しの窓もここで閉じる（硬直は付けない） */
export function endArtHold(state: GameState): void {
  const a = state.player.art;
  a.holding = false;
  a.holdTime = 0;
}

/** 固有技の時間を進める。player.ts の updatePlayer から溜めの直後に毎ステップ呼ぶ */
export function updateArt(state: GameState, input: FrameInput, dt: number): void {
  const p = state.player;
  p.art.cooldown = Math.max(0, p.art.cooldown - dt);
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

/** 受け流し: 窓（押してから windowSec）を過ぎても被弾を受け流していなければ外れ。recoverSec の硬直 */
function updateParry(state: GameState, parry: NonNullable<HoldArtDef["parry"]>, dt: number): void {
  const a = state.player.art;
  a.holdTime += dt;
  if (a.holdTime < parry.windowSec) return;
  endArtHold(state);
  a.recover = parry.recoverSec;
}

/** 盾の構え: 離すか maxSec を過ぎたら解き、盾押し（release）を出す */
function updateGuard(state: GameState, hold: HoldArtDef, held: boolean, dt: number): void {
  const a = state.player.art;
  a.holdTime += dt;
  if (held && a.holdTime < hold.maxSec) return;
  endArtHold(state);
  a.cooldown = playerMoveset(state).art.cooldown;
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
  endArtHold(state);
  if (boonBlocksShoot(state)) return;
  const fired = emitVolley(state, currentShot(state.stats), 0, undefined, ready ? { count: 1, damageMul: aim.damageMul, pierceBonus: aim.pierceBonus } : { count: 1 });
  if (fired) a.cooldown = playerMoveset(state).art.cooldown;
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
  endArtHold(state);
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
 * 受けるたびに必殺ゲージを溜める。構えていない・後ろからの被弾は 1
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

/**
 * 弾を出す技（斧の投擲・杖の魔弾・乱れ撃ち）。弾は技自身が持ち（ThrowArtDef.bullet）、威力・怯み値・弾数は技のもの。
 * 射撃扱い（射撃の性質・onRangedHit が乗る）。射撃を禁じる祝福・剣の誓いでは出ない。出したら true
 */
export function emitArtVolley(state: GameState, t: ThrowArtDef): boolean {
  if (boonBlocksShoot(state)) return false;
  return emitVolley(state, t.bullet, 0, undefined, {
    damage: scaled(state.stats, t.scaling),
    poise: withRatio(state.stats, t.poise, t.poiseRatio) * state.stats.poiseDamageMul,
    count: t.count,
    spreadDeg: t.spreadDeg,
    attack: t.attack,
    recoil: false,
    sprite: t.sprite,
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
    if (pr.shot) pr.shot.returning = true;
    count += 1;
  }
  if (count > 0) pushSfx(state, "reflect");
  return count;
}

function isGrounded(key: string | undefined): boolean {
  if (key === undefined) return false;
  const def = BULLETS[key];
  return def !== undefined && (def.mine !== undefined || def.lob !== undefined);
}

/**
 * 1 振りの技を振り始めたとき（player.ts の startBranch から）。再使用を立て、付随効果（砲の零距離砲の反動・設置弾の起爆）を出す
 */
export function onArtStrike(state: GameState): void {
  const art = playerMoveset(state).art;
  if (art.kind !== "strike") return;
  state.player.art.cooldown = art.cooldown;
  if (art.extras) applyStrikeExtras(state, art.extras);
}

function applyStrikeExtras(state: GameState, extras: StrikeExtras): void {
  const p = state.player;
  if (extras.selfKnock !== undefined) p.knock = sub(p.knock, scale(p.facing, extras.selfKnock));
  if (extras.detonateMines) detonateOwnMines(state);
}

/** 床の自分の設置弾を次のステップで炸裂させる（寿命を尽きかけにし、projectiles.ts の信管切れの経路で炸裂させる） */
function detonateOwnMines(state: GameState): void {
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.life <= 0 || pr.shot?.detonated) continue;
    if (pr.shot && BULLETS[pr.shot.key]?.mine) pr.life = Math.min(pr.life, A.detonateLife);
  }
}
