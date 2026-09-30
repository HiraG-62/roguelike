import type { FrameInput } from "../core/input";
import { type GameState, allocId, pushSfx } from "../core/state";
import { STATUS_LABEL, type StatusKind } from "../core/status";
import { formatMeters } from "../core/units";
import { type Vec, dist, isZero, normalize, scale } from "../core/vec";
import { type DashForm, JOBS } from "../data/jobs";
import { BOON, DASH_FORM, PLAYER } from "../data/tuning";
import { isGun, laneLength } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { scaled } from "./attributes";
import { cancelAttack } from "./combat";
import { spawnRing } from "./effects";
import { circlesOverlap, moveBody, overlapsWall } from "./physics";
import { dashTime, isDashing, playerMoveset } from "./player";
import { applyStatus, hasStatus } from "./statusEffects";
import { placeTerrain } from "./terrain";

/**
 * 流儀のダッシュの形（docs/ideas/weapon-forms-impl.md 3-7）。定義は data/jobs.ts の JobDef.dash、数値は DASH_FORM。
 * player.ts の tryDash が差し替え（不退）・向き（退き足）・連撃の引き継ぎ（詰め足）・秒と無敵と始まりの効果（runDashForm）を
 * ここへ 1 行ずつ委ね、updateMovement が速さ（dashSpeed）、tickTimers が通過の効果（tickDashForm）を読む
 */

/** 動くダッシュの形（不退はダッシュの代わりにその場で構えるので距離・秒を持たない） */
type MovingForm = Exclude<DashForm, "brace">;

/** 退き足が足元に置く設置弾（置き撃ち筒の弾を流用する） */
const LEAP_TRAP_BULLET = "mineLauncher";
/** 霧隠れがすり抜けた敵に付ける状態異常 */
const MIST_STATUS: StatusKind = "weaken";
/** 瓶投げが元いた所に撒く地形（反応の火種になる油） */
const FLASK_TERRAIN = "oil";
/** 護り足の結界の輪（不退の構えと同じ色で「守られている」と読ませる） */
const WARD_RING_SEC = 0.3;
const WARD_RING_SCALE = 2.5;
const PERCENT = 100;

export function dashFormOf(state: Readonly<GameState>): DashForm {
  return JOBS[state.job].dash;
}

function motionOf(form: MovingForm): (typeof DASH_FORM)[MovingForm] {
  return DASH_FORM[form];
}

/** 詰め足は振りの持続・硬直の途中でもダッシュを出せる（発生は取り消せない。player.ts の canDashCancel） */
export function dashIgnoresSwingLock(state: Readonly<GameState>): boolean {
  return dashFormOf(state) === "step" && state.player.attack.phase !== "windup";
}

/**
 * 詰め足は取り消した振りの続きの段へ戻る（ダッシュ中に押した左をダッシュ攻撃にしない。player.ts の releaseDashAttack）。
 * 銃の家系の左は連撃ではなく射撃なので、ダッシュ中の押下は従来どおり反転撃ち
 */
export function dashKeepsChain(state: GameState): boolean {
  return dashFormOf(state) === "step" && !isGun(playerMoveset(state));
}

/** 影潜りで潜っている間は攻撃・派生を出せない（player.ts の readActions） */
export function dashLocksActions(state: Readonly<GameState>): boolean {
  return dashFormOf(state) === "shadow" && isDashing(state.player);
}

/**
 * ダッシュそのものを差し替える（不退）。差し替えたら true（tryDash はここで終わる）
 */
export function replaceDash(state: GameState): boolean {
  if (dashFormOf(state) !== "brace") return false;
  braceInPlace(state, DASH_FORM.brace.guardSec);
  return true;
}

/**
 * 不退: その場で構える。構えの残り秒は boonRun.guardTimer に置き、
 * 移動 0（boonMoveMul）と構えの中の被弾の見切り（boonJustEligible）を効かせる
 */
function braceInPlace(state: GameState, sec: number): void {
  const p = state.player;
  cancelAttack(state);
  state.boonRun.guardTimer = Math.max(state.boonRun.guardTimer, sec);
  p.invulnTimer = Math.max(p.invulnTimer, sec);
  p.dodgedThisDash = false;
  p.knock = { x: 0, y: 0 };
  spawnRing(state, p.body.pos, p.body.radius * 2, BOON.guardColor, sec);
  pushSfx(state, "dash");
}

/** ダッシュの向き。退き足は入力と逆（入力が無ければ向きと逆）へ跳ぶ */
export function dashDirection(state: Readonly<GameState>, input: FrameInput): Vec {
  const p = state.player;
  const forward = isZero(input.move) ? { ...p.facing } : normalize(input.move);
  return dashFormOf(state) === "leap" ? scale(forward, -1) : forward;
}

/**
 * 詰め足: 振りの途中で出したら次の段を覚え、ダッシュの後の左で続きを出せるよう入力列の窓を延ばす
 * （player.ts の tryDash が cancelAttack の前に呼ぶ。cancelAttack は段カウンタを触らない）
 */
export function keepChainThroughDash(state: GameState): void {
  if (!dashKeepsChain(state)) return;
  const p = state.player;
  const a = p.attack;
  const swinging = a.phase !== "none" && a.branch < 0 && a.chargeLevel === 0 && !p.dashStrike;
  if (swinging) {
    const next = a.step + 1;
    a.step = next < laneLength(playerMoveset(state), "primary") ? next : 0;
  }
  a.inputTimer = Math.max(a.inputTimer, dashTime(state.stats) * DASH_FORM.step.timeMul + DASH_FORM.step.keepChainSec);
}

/** ダッシュ中の速さ（距離 ÷ 秒）。updateMovement が読む */
export function dashSpeed(state: Readonly<GameState>): number {
  const form = dashFormOf(state);
  if (form === "brace") return PLAYER.dash.speed;
  const m = motionOf(form);
  return m.timeMul > 0 ? (PLAYER.dash.speed * m.distanceMul) / m.timeMul : PLAYER.dash.speed;
}

/**
 * ダッシュを始める（player.ts の tryDash。誓約「瞬歩」でないとき）。形ごとの秒・無敵を立て、始まりの効果を出す。
 * 転移は秒を持たずその場で移る
 */
export function runDashForm(state: GameState): void {
  const form = dashFormOf(state);
  if (form === "brace") return;
  const p = state.player;
  const from = { ...p.body.pos };
  const m = motionOf(form);
  const invuln = (PLAYER.dash.invulnTime + state.stats.dashInvulnBonus) * m.invulnMul + m.invulnAdd;
  if (form === "blink") {
    const distance = PLAYER.dash.speed * dashTime(state.stats) * m.distanceMul;
    moveBody(state, p.body, p.dashDir.x * distance, p.dashDir.y * distance);
    p.invulnTimer = Math.max(p.invulnTimer, invuln);
    return;
  }
  // 入れ替わりは相手がいれば秒を持たずその場で移る。いなければ駆け（下の通常のダッシュ）
  if (form === "swap" && swapWithNearest(state)) {
    p.invulnTimer = Math.max(p.invulnTimer, DASH_FORM.swap.swapInvulnSec);
    return;
  }
  const time = dashTime(state.stats) * m.timeMul;
  p.dashTimer = time;
  // 無敵はダッシュの前半だけ。後半は被弾するので、ダッシュを押すタイミングが問われる
  p.invulnTimer = Math.max(p.invulnTimer, Math.min(time, invuln));
  p.dodgedThisDash = false;
  startFormEffect(state, form, from, time);
}

/** 形ごとの始まりの効果（退き足の罠・跳び越えの着地の一撃・影潜りの背面・瓶投げの油） */
function startFormEffect(state: GameState, form: MovingForm, from: Vec, time: number): void {
  const p = state.player;
  switch (form) {
    case "leap":
      // 跳んだ向きの逆（元の向き）を見たまま下がる
      p.facing = scale(p.dashDir, -1);
      dropTrap(state, from);
      return;
    case "vault":
      // 着地の瞬間にダッシュ攻撃（releaseDashAttack）
      p.dashAttackQueued = true;
      return;
    case "shadow":
      p.moment.backstabUntil = state.time + time + DASH_FORM.shadow.backstabSec;
      return;
    case "flask":
      placeTerrain(state, from.x, from.y, FLASK_TERRAIN, DASH_FORM.flask.terrainRadius, DASH_FORM.flask.terrainSec);
      return;
    case "ward":
      raiseWard(state);
      spawnRing(state, p.body.pos, p.body.radius * WARD_RING_SCALE, BOON.guardColor, WARD_RING_SEC);
      return;
    default:
      return;
  }
}

/** 退き足: 元いた足元に設置弾を置く（射撃ではないので onShoot・反動・弾倉を起こさない） */
function dropTrap(state: GameState, at: Vec): void {
  const def = bulletDef(LEAP_TRAP_BULLET);
  const mine = def.mine;
  if (!mine) return;
  state.projectiles.push({
    id: allocId(state),
    owner: "player",
    pos: { ...at },
    vel: { x: 0, y: 0 },
    radius: def.radius,
    damage: scaled(state.stats, def.scaling ?? PLAYER.shoot.scaling) * def.damageMul * DASH_FORM.leap.trapDamageMul,
    life: mine.fuse,
    color: mine.color,
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
    poise: PLAYER.shoot.poise * def.poiseMul * state.stats.poiseDamageMul,
    shot: { key: def.key },
    attack: def.attack,
  });
}

/**
 * 入れ替わり: 範囲内で最も近い自分の設置物・従魔と位置を入れ替える。入れ替えたら true。
 * 着地点が壁に埋まる相手は飛ばして次に近い相手を選ぶ（設置物は壁際にも置けるが、体は埋まれない）
 */
function swapWithNearest(state: GameState): boolean {
  const p = state.player;
  const near = swapCandidates(state)
    .map((c) => ({ c, d: dist(p.body.pos, c.pos) }))
    .filter((e) => e.d <= DASH_FORM.swap.range)
    .sort((a, b) => a.d - b.d);
  for (const { c } of near) {
    if (overlapsWall(state, c.pos.x, c.pos.y, p.body.radius)) continue;
    const from = { ...p.body.pos };
    p.body.pos = { ...c.pos };
    p.body.vel = { x: 0, y: 0 };
    c.pos = from;
    return true;
  }
  return false;
}

/**
 * 入れ替われる相手（自分の設置物）。従魔（鈴の命令で動く体）が足されたらここに並べる。
 * 泥沼の領域は地面に染みたもので位置を持ち運べないので数えない
 */
function swapCandidates(state: Readonly<GameState>): { pos: Vec }[] {
  const s = state.skills;
  return [...s.wells, ...s.mines, ...s.fields, ...s.kegs, ...s.graves, ...s.turrets, ...s.springs];
}

/** 結界を今から wardSec 秒に伸ばす（ダッシュ中は毎ステップ呼ぶので、着地からちょうど wardSec 秒残る） */
function raiseWard(state: GameState): void {
  state.player.moment.wardUntil = state.time + DASH_FORM.ward.wardSec;
}

/** 結界の中の被ダメージの倍率（全方位。combat.ts の damagePlayer が掛ける）。無ければ 1 */
export function wardIncomingMul(state: Readonly<GameState>): number {
  return state.time < state.player.moment.wardUntil ? DASH_FORM.ward.incomingMul : 1;
}

/**
 * ダッシュ中の毎ステップ（player.ts の tickTimers）。霧隠れはすり抜けた敵を弱体にする（同じ敵に重ねない）、
 * 護り足は結界を保つ（ダッシュが終わった瞬間から wardSec 秒で切れる）
 */
export function tickDashForm(state: GameState): void {
  if (!isDashing(state.player)) return;
  const form = dashFormOf(state);
  if (form === "ward") raiseWard(state);
  if (form === "mist") weakenPassedEnemies(state);
}

function weakenPassedEnemies(state: GameState): void {
  const p = state.player;
  const reach = p.body.radius + DASH_FORM.mist.touchRadius;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden || hasStatus(e.status, MIST_STATUS)) continue;
    if (!circlesOverlap(p.body.pos.x, p.body.pos.y, reach, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: MIST_STATUS, stacks: 1, duration: DASH_FORM.mist.statusSec, potency: 0 }, "player");
  }
}

// -----------------------------------------------------------------------------
// 表示（起点画面の説明。何ができるか）
// -----------------------------------------------------------------------------

const DASH_FORM_TEXT: Readonly<Record<DashForm, string>> = {
  standard: "前へ駆け抜ける。駆け出しは無敵",
  step: "短く踏み込む。振りの途中でも出せ、次の左で連撃の続きの段が出る",
  leap: "入力と逆へ跳び退き、元いた足元に設置弾を置く",
  slip: "短く潜る。無敵が長く、見切りを取りやすい",
  brace: "動かずその場で構える。構えの中の被弾は見切りになる",
  mist: `すり抜けた敵を${STATUS_LABEL[MIST_STATUS]}にする。無敵は短い`,
  vault: "長く跳び、着地でダッシュ攻撃を出す。跳んでいる間は無敵",
  blink: "ダッシュの距離を一瞬で移る。無敵は無い",
  shadow: "長く潜って移動する。潜っている間は攻撃できず、出た直後の一撃は背面から当たる",
  flask: "短く駆け、元いた所に油を撒く",
  swap: `${formatMeters(DASH_FORM.swap.range)} 以内で最も近い自分の設置物・従魔と位置を入れ替える。無いときは前へ駆ける`,
  ward: `短く駆け、着地から ${DASH_FORM.ward.wardSec} 秒の結界を張る。結界の中は全方位からの被ダメージが ${Math.round((1 - DASH_FORM.ward.incomingMul) * PERCENT)}% 減る`,
};

export function dashFormText(form: DashForm): string {
  return DASH_FORM_TEXT[form];
}
