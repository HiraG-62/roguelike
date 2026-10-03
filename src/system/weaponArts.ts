import type { FrameInput } from "../core/input";
import type { Enemy, GameState } from "../core/state";
import { type Vec, angle, length, scale, sub } from "../core/vec";
import { FORM, WEAPON } from "../data/tuning";
import {
  type ActionStepDef,
  type BulletDef,
  type ButtonKey,
  type BranchDef,
  type BranchShots,
  type HoldArtDef,
  type StrikeExtras,
  type SwingActionStep,
  type ThrowArtDef,
  actionCooldown,
  laneChainWindow,
  laneLength,
  laneVolley,
  releaseBranchIndex,
} from "../data/weapons";
import { scaled, withRatio } from "./attributes";
import { cancelAttack, gainEnergy } from "./combat";
import { spawnBurst } from "./effects";
import { nextFireHand, spendRounds } from "./magazine";
import { currentShot, emitShotRounds, emitVolley, isAttacking, isDashing, isPlayerStaggered, logButton, playerMoveset, startArtBranch } from "./player";
import { type ShotRelease, gainMorale, isPlacedShot, swingShotRelease } from "./morale";
import { noteRiposte } from "./moments";
import { onManaSource } from "./manaSources";
import { attackCommitted } from "./poise";
import { parryLocksActions, parryMoveMul, parrySucceed, tryWindowParry } from "./parry";
import { BULLETS } from "../loot/bullets";

/**
 * 右レーン（アクション 2。docs/ideas/ougi-and-dual-actions.md 4 章）の振り以外の段: hold（受け流し・構え）/ volley（弾を出す）と、段の key ごとの再使用・受け流しを外した硬直・派生の弾と付随効果。
 * 振りの段と刀の居合（近接の溜め）は player.ts の連撃・溜めの経路をそのまま使う。
 * 振り以外の段は押した瞬間に始まり、終わったら左右共有の段カウンタ（AttackState.step）を 1 つ進める
 */

const A = WEAPON.artDefaults;
const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN = Math.PI * 2;
const FX_SPEED = 120;
const FX_LIFE = 0.3;
const FX_SIZE = 2;

/** 構えを押している右レーンの段（段カウンタが指す段）。構えていなければ undefined */
function currentHoldStep(state: GameState): ActionStepDef | undefined {
  if (!state.player.art.holding) return undefined;
  return playerMoveset(state).steps2[state.player.attack.step];
}

/** 押している間の構え（受け流し・盾の構え）。今の段が構えでなければ undefined */
function currentHold(state: GameState): HoldArtDef | undefined {
  const s = currentHoldStep(state);
  return s?.kind === "hold" ? s.hold : undefined;
}

/** 押した瞬間に完結する段（弾）。振りの最中の recover を打ち切って出し、共有の間（laneGap）を置く */
export function isInstantStep(s: ActionStepDef): boolean {
  return s.kind === "volley";
}

function stepKey(s: ActionStepDef): string | undefined {
  return s.key === undefined || s.key === "" ? undefined : s.key;
}

/** 右レーンの段の再使用の残り秒（段の key ごと。弾の段は共有の間も見る） */
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
  // 段ごとの窓の上書き（杖の氷の連射）。再使用・共有の間が明けてから押す猶予を残す
  a.inputTimer = Math.max(a.inputTimer, laneChainWindow(playerMoveset(state).steps2[index]));
}

/** 受け流しを外した硬直中か（攻撃・技・射撃のボタンを受け付けない）。共通の受け流し（parry.ts）の窓と硬直も含む */
export function artLocksActions(state: GameState): boolean {
  return state.player.art.recover > 0 || parryLocksActions(state);
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
 * 右レーンの振り以外・溜め以外の段（構え・弾）を index 段目として始める（player.ts の右の押下から）。
 * 構えは離す（窓が閉じる）まで段カウンタを保ち、弾はすぐ段を進める。出したら true
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
    case "volley":
      if (!emitArtVolley(state, s.throw)) return false;
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

/** 構えを何も出さずに解く（ダッシュ・怯み・武器種の差し替え）。受け流しの窓もここで閉じる（硬直は付けない）。段は進めない */
export function endArtHold(state: GameState): void {
  const a = state.player.art;
  a.holding = false;
  a.holdTime = 0;
}

/** 構えを解いて段を進める（押している最中の次の押下・受け流しの成功と窓の終わり）。構えていなければ何もしない */
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

/** 構え・共通の受け流し中の移動速度倍率（どれでもなければ 1） */
export function artMoveMul(state: GameState): number {
  const parry = parryMoveMul(state);
  if (parry !== 1) return parry;
  if (!state.player.art.holding) return 1;
  const hold = currentHold(state);
  return hold?.moveMul ?? 1;
}

/**
 * 受け流し（combat.ts の damagePlayer が無敵判定の直後に呼ぶ）。剣の右 1 段目の構えの窓、なければ共通の受け流しの窓（parry.ts）の
 * 中の被弾を無効にし、攻撃した敵を止めてカウンター扱いにする（onCounter を発火。刀のルールや祝福が乗る）。受け流したら true。
 * fromPos は攻撃の出どころ（共通の受け流しの向きの判定に使う）
 */
export function tryParry(state: GameState, attacker?: Enemy, fromPos?: Vec): boolean {
  const p = state.player;
  const parry = currentHold(state)?.parry;
  if (!parry || !p.art.holding || p.art.holdTime >= parry.windowSec) return tryWindowParry(state, fromPos, attacker);
  finishArtHold(state);
  parrySucceed(state, attacker, parry.staggerPoise);
  return true;
}

/**
 * 盾の構え（combat.ts の damagePlayer が被ダメに掛ける）。向きから arcDeg の内側から来た被弾は damageMul 倍にし、
 * 受けるたびに奥義ゲージを溜める。構えていない・後ろからの被弾は 1
 */
export function guardDamageMul(state: GameState, fromPos: Vec, amount = 0, attacker?: Enemy): number {
  const p = state.player;
  const guard = currentHold(state)?.guard;
  if (!guard || !p.art.holding) return 1;
  if (!inFront(p.body.pos, p.facing, fromPos, guard.arcDeg)) return 1;
  noteGuardBlock(state, amount, attacker);
  gainEnergy(state, guard.energyGain);
  spawnBurst(state, p.body.pos, A.guardColor, A.guardParticles, FX_SPEED, FX_LIFE, FX_SIZE);
  return guard.damageMul;
}

/**
 * 構えで受けた（盾の受け溜め）。受けた元のダメージが戦意になり、応手（guardBlock）は attacker がコミットした攻撃のときだけ
 * （blockOnlyCommitted。弾が出た後の敵は攻撃が確定していないので、置き弾や敵弾を受けただけでは応手にしない）
 */
function noteGuardBlock(state: GameState, amount: number, attacker?: Enemy): void {
  gainMorale(state, "guardBlock", amount);
  // 構えで受けた量は盾持ちの気力の源（system/manaSources.ts）
  onManaSource(state, "guardBlock", amount);
  if (FORM.bulwark.blockOnlyCommitted && !(attacker && attackCommitted(attacker))) return;
  noteRiposte(state, "guardBlock", attacker);
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

/** 弾を出す段の数の差し替え（派生の shots が回数・扇・貫通・威力の倍率を変える） */
export interface ArtVolleyOverride {
  count?: number;
  spreadDeg?: number;
  /** 段の 1 回を count 回、spreadDeg（度）ずつ扇にずらして同時に出す（派生の弾。省略は 1 回） */
  fan?: { count: number; spreadDeg: number };
  pierceBonus?: number;
  damageMul?: number;
  /** 撃ったレーン（双撃の判定。省略は右 = 右レーンの弾の段） */
  lane?: ButtonKey;
  /** 放出の弾（終撃・会心。Projectile.release へ写す） */
  release?: { finisher: boolean; crit: boolean };
}

/** 放出の倍率（戦意）を弾の差し替えに写す。放出でなければ空 */
function releaseOverride(r: ShotRelease | undefined): ArtVolleyOverride {
  if (!r) return {};
  return { damageMul: r.mul.damageMul, pierceBonus: r.mul.pierceAdd, release: { finisher: r.finisher, crit: r.crit } };
}

/** 振りの詠唱（cast）の魔弾の差し替え。放出の振り（杖の 3 手の派生）が撃つ魔弾は放出の弾にする（player.ts の updateAttack） */
export function castOverride(state: GameState, lane: ButtonKey): ArtVolleyOverride {
  return { lane, ...releaseOverride(swingShotRelease(state)) };
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
    ...(t.lineGap !== undefined ? { lineGap: t.lineGap } : {}),
    lane: over.lane ?? "secondary",
    release: over.release,
    ...(over.fan ? { fan: over.fan } : {}),
  });
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

/**
 * 派生の弾（docs/ideas/gun-bases-review.md 0-3 の A 案）。count は「普段の 1 回を何回撃つか」で、回ごとに扇へ spreadDeg ずつずらす。
 * 省略は装備の銃の弾の 1 回（1 + 装備の弾数 + 散弾の粒、三点の器は回の向きごとに三点の続き）、from が lane なら右レーンの弾の段の 1 回
 */
function emitBranchShots(state: GameState, shots: BranchShots): void {
  // 派生の弾のレーンは派生の最後のボタン（beginSwing が attack.lane に置いた値）
  const over = { pierceBonus: shots.pierceBonus, damageMul: shots.damageMul, lane: state.player.attack.lane, ...(shots.applies ? { applies: shots.applies } : {}) };
  // 派生の弾も弾倉を撃つ回数ぶん減らし、足りなければ残りの分だけ撃つ（振りは出る。docs/ideas/gun-bases-review.md 0-3）
  const count = branchRounds(state, Math.max(1, shots.count));
  if (count <= 0) return;
  if (shots.from !== "lane") {
    emitShotRounds(state, shotWithLife(currentShot(state.stats), shots.lifeMul), { count, spreadDeg: shots.spreadDeg }, over);
    return;
  }
  const t = laneVolley(playerMoveset(state));
  if (t) emitArtVolley(state, t, { ...over, fan: { count, spreadDeg: shots.spreadDeg ?? t.spreadDeg } });
}

/** 弾の寿命を縮めた弾（足元へ投げる影留め。lifeMul が無ければそのまま） */
function shotWithLife(shot: BulletDef, lifeMul: number | undefined): BulletDef {
  return lifeMul === undefined ? shot : { ...shot, lifeMul: shot.lifeMul * lifeMul };
}

/** 派生の弾で撃てる回数（弾倉から使えた回数。弾倉が働かない武器種はそのまま） */
function branchRounds(state: GameState, count: number): number {
  const hand = nextFireHand(state);
  return hand === undefined ? 0 : spendRounds(state, hand, count);
}

function applyStrikeExtras(state: GameState, extras: StrikeExtras): void {
  const p = state.player;
  if (extras.selfKnock !== undefined) p.knock = sub(p.knock, scale(p.facing, extras.selfKnock));
  if (extras.detonateMines) detonateOwnMines(state);
}

/** 床の自分の設置弾（まだ炸裂していない）のうち from に一番近い位置（無ければ undefined。罠蹴りの蹴り込み先）。曲射弾は数えない */
export function nearestOwnMine(state: GameState, from: Vec): Vec | undefined {
  let best: Vec | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const pr of state.projectiles) {
    if (!isPlacedShot(pr) || !pr.shot || BULLETS[pr.shot.key]?.mine === undefined) continue;
    const d = length(sub(pr.pos, from));
    if (d >= bestDist) continue;
    best = pr.pos;
    bestDist = d;
  }
  return best;
}

/**
 * 床の自分の設置弾・曲射弾を次のステップで炸裂させる（寿命を尽きかけにし、projectiles.ts の信管切れの経路で炸裂させる）。
 * 起爆した数を返す（砲の放出の量。system/morale.ts の placedShotCount と同じ数え方）
 */
export function detonateOwnMines(state: GameState): number {
  let count = 0;
  for (const pr of state.projectiles) {
    if (!isPlacedShot(pr)) continue;
    pr.life = Math.min(pr.life, A.detonateLife);
    count += 1;
  }
  return count;
}
