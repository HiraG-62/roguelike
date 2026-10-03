import type { FrameInput } from "../core/input";
import type { Enemy, GameState } from "../core/state";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { enemyDef } from "../data/enemies";
import { DOJO } from "../data/tuning";
import type { MovesetKey } from "../data/weapons";
import type { Profile } from "../loot/types";
import { type DojoLayout, type DojoOpenSpotKey, buildDojoMap } from "../map/dojoMap";
import type { SkillProfile } from "../skills/types";
import { updateCamera } from "./camera";
import { COLOR_HEAL } from "./combat";
import {
  DOJO_ROWS,
  type DojoConfig,
  type DojoMeterView,
  type DojoRowKey,
  type DojoValueRowKey,
  dojoRowRespawns,
  isDojoActionRow,
} from "./dojoConfig";
import { type DojoMeter, createDojoMeter, dojoMeterSnapshot, recordDojoDamage, recordDojoKills, recordDojoTaken } from "./dojoMeter";
import { addHeadLabel, spawnBurst } from "./effects";
import { makeElite } from "./elites";
import { createEnemy } from "./enemies";
import { spawnSpot } from "./enemyTraits";
import { applyTrialMoveset, enforceTrialMoveset, fillResourcesOf } from "./hub";
import { refreshRunStats } from "./runSetup";
import { createSandboxState, simulateSandbox } from "./sandbox";
import { DUMMY_KEY } from "./specialRooms";
import { pushSfx } from "../core/state";

/**
 * 稽古の間（docs/ideas/dojo.md）。拠点と同じ箱庭の state に、稽古帳の設定（system/dojoConfig.ts）どおりに敵を湧かせ、
 * simulateSandbox の前後で敵の動き・攻め・生命と自分の資源を直す（本編の敵の処理には手を入れない）。
 * 与えた傷は state.damageTap から汲み出して計測（system/dojoMeter.ts）に入れる。乱数は state.rng だけ
 */

export interface DojoRun {
  layout: DojoLayout;
  config: DojoConfig;
  /** DOJO.interactRadius 以内で一番近い台（rack / board / exit） */
  near: DojoOpenSpotKey | null;
  trialMoveset: MovesetKey | null;
  /** 銃の家系を試すときの弾の器（拠点の HubRun.trialBase と同じ） */
  trialBase: string | null;
  trialKeystone: string | null;
  meter: DojoMeter;
  /** 稽古の間が湧かせた敵の id（倒れない敵の作り直しの対象。召喚・取り巻きは入らない） */
  spawned: number[];
  /** 全滅してから湧き直すまでの残り秒（0 = 待っていない） */
  respawnTimer: number;
  /** 手水鉢が次に満たせるまでの残り秒 */
  springTimer: number;
}

export interface DojoSession {
  state: GameState;
  dojo: DojoRun;
}

export type DojoAction = { kind: "none" } | { kind: "open"; spot: DojoOpenSpotKey };

export interface DojoCreateOptions {
  profile: Profile;
  skillProfile: SkillProfile;
  hitstopScale: number;
  config: DojoConfig;
  trialMoveset: MovesetKey | null;
  trialBase: string | null;
  trialKeystone: string | null;
}

const NONE: DojoAction = { kind: "none" };
/** 稽古の間の部屋は 1 つだけ */
const DOJO_ROOM = 0;
const OPEN_SPOTS: readonly DojoOpenSpotKey[] = ["rack", "board", "exit"];
/** 攻めない敵の攻撃間隔の時計を止めておく値（ステップの後に元の値へ戻す） */
const HELD_COOLDOWN = 1e6;
/** 散らばりの低食い違い列（R2 列）の係数。乱数を使わずに重なりにくい配置を作る */
const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;
/** 散らばりの横幅は奥行きの何倍か */
const SCATTER_WIDE = 2;
/** 攻めない設定で鬼火を自分から離しておく隙間（px）。1 ステップに自分のダッシュと鬼火の足で詰まる分より広い */
const WISP_KEEP_OFF = 12;
const SPRING_LABEL = "回復";
const SPRING_PARTICLES = 16;
const SPRING_PARTICLE_SPEED = 80;
const SPRING_PARTICLE_LIFE = 0.5;

export function createDojo(opts: DojoCreateOptions): DojoSession {
  const layout = buildDojoMap();
  // profile は本物の参照（装備画面の付け替えが効くように。拠点と同じ扱いで、ここでの行動は保存しない）
  const state = createSandboxState({
    profile: opts.profile,
    skillProfile: opts.skillProfile,
    map: layout.map,
    start: layout.playerStart,
    seed: DOJO.seed,
    hitstopScale: opts.hitstopScale,
  });
  state.damageTap = [];
  state.hurtTap = [];
  const dojo: DojoRun = {
    layout,
    config: opts.config,
    near: null,
    trialMoveset: opts.trialMoveset,
    trialBase: opts.trialBase,
    trialKeystone: opts.trialKeystone,
    meter: createDojoMeter(),
    spawned: [],
    respawnTimer: 0,
    springTimer: 0,
  };
  const session: DojoSession = { state, dojo };
  state.runKeystones = opts.trialKeystone ? [opts.trialKeystone] : [];
  applyDepth(session);
  respawnDojo(session);
  return session;
}

/**
 * 深さは湧いた敵の生命・怯みだけでなく、敵の威力・予備動作の秒（実行時に state.depth を読む）にも効くので state ごと替える。
 * 自分の地金も今の深度で決め直す（その階に潜ったときと同じ数字で測る）
 */
function applyDepth(session: DojoSession): void {
  const { state, dojo } = session;
  state.depth = dojo.config.depth;
  if (dojo.trialMoveset === null) {
    refreshRunStats(state);
    return;
  }
  applyTrialMoveset(state, dojo.trialMoveset, dojo.trialBase);
}

// -----------------------------------------------------------------------------
// 1 ステップ
// -----------------------------------------------------------------------------

/** ステップ前の写し（ステップの後に敵と自分を直す材料） */
interface StepSnapshot {
  hp: number;
  live: Enemy[];
  pos: Map<number, Vec>;
  cooldown: Map<number, number>;
}

export function stepDojo(session: DojoSession, input: FrameInput, dt: number): DojoAction {
  const { state, dojo } = session;
  if (state.paused) return NONE;
  enforceTrialMoveset(state, dojo.trialMoveset, dojo.trialBase);
  if (state.hitstop > 0) {
    state.hitstop -= 1;
    updateCamera(state, dt, VIEW_W, VIEW_H);
    return NONE;
  }
  const gdt = dt * dojo.config.timeScale;
  const snap = beforeStep(session);
  simulateSandbox(state, input, gdt, true);
  afterStep(session, snap);
  updateSpring(session, gdt);
  updateRespawn(session, gdt);
  dojo.near = nearestDojoSpot(session);
  if (dojo.near && input.interactPressed) return { kind: "open", spot: dojo.near };
  return NONE;
}

function holdsStill(config: DojoConfig): boolean {
  return config.behavior === "anchored" || config.behavior === "still";
}

function holdsAttack(config: DojoConfig): boolean {
  return config.behavior === "passive" || config.behavior === "still";
}

function beforeStep(session: DojoSession): StepSnapshot {
  const { state, dojo } = session;
  const config = dojo.config;
  // ステップの外（湧き直しの間など）で倒れていた敵も、撃破と倒れない敵の作り直しの対象に入れる
  const live = [...state.enemies];
  const pos = new Map<number, Vec>();
  const cooldown = new Map<number, number>();
  for (const e of live) {
    if (e.hp <= 0) continue;
    if (config.undying) {
      e.hp = e.maxHp;
      e.lastHp = e.hp;
    }
    if (holdsStill(config)) pos.set(e.id, { ...e.body.pos });
    cooldown.set(e.id, e.attackCooldown);
    if (!holdsAttack(config)) continue;
    // 攻めない敵は攻撃間隔の時計を止め、潜って姿を消す敵も出しておく（潜ったままでは殴れない）
    e.attackCooldown = HELD_COOLDOWN;
    e.hidden = false;
  }
  return { hp: state.player.hp, live, pos, cooldown };
}

function afterStep(session: DojoSession, snap: StepSnapshot): void {
  const { state, dojo } = session;
  const config = dojo.config;
  for (const e of state.enemies) {
    // 召喚・取り巻きも撃破数・ドロップに数えない（拠点の木人と同じ）
    e.revived = true;
    const before = snap.cooldown.get(e.id);
    if (holdsAttack(config)) disarmEnemy(e, before);
    else if (before !== undefined) applyTempo(e, before, config.tempo);
    const pos = snap.pos.get(e.id);
    if (pos) pinEnemy(e, pos);
    if (holdsAttack(config)) keepBodyOff(state, e);
  }
  if (holdsAttack(config)) clearEnemyAttacks(state);
  noteTaken(session, snap.hp);
  noteKills(session, snap.live);
  if (config.undying) rebuildFallen(session, snap.live);
  fillInfinite(session);
  const tap = state.damageTap;
  if (tap && tap.length > 0) {
    recordDojoDamage(dojo.meter, tap, state.time);
    state.damageTap = [];
  }
}

/** 攻めない敵: 時計を元へ戻し、入った予備動作・攻撃・隙は取り消して追う動きに戻す */
function disarmEnemy(e: Enemy, cooldown: number | undefined): void {
  e.attackCooldown = cooldown ?? e.attackCooldown;
  if (e.phase !== "windup" && e.phase !== "strike" && e.phase !== "recover") return;
  e.phase = "chase";
  e.phaseTimer = 0;
  e.windupTotal = 0;
  if (e.ai) e.ai.counter = 0;
}

/** 攻めの速さ: このステップで減った攻撃間隔の時計を tempo 倍にする（予備動作に入って時計が戻ったステップは触らない） */
function applyTempo(e: Enemy, before: number, tempo: number): void {
  if (tempo === 1) return;
  const spent = before - e.attackCooldown;
  if (spent <= 0) return;
  e.attackCooldown = Math.max(0, before - spent * tempo);
}

/** 動かない敵: 位置を戻し、速さと吹き飛びも消す */
function pinEnemy(e: Enemy, pos: Vec): void {
  e.body.pos = { ...pos };
  e.body.vel = { x: 0, y: 0 };
  e.knock = { x: 0, y: 0 };
}

/**
 * 体が触れるだけで傷を与える敵（鬼火。予備動作を通らず追う間も触れれば燃やす）は、攻めない設定では自分から
 * WISP_KEEP_OFF だけ離しておく（次のステップで自分と鬼火が詰める分より広くとり、触れる判定の時点で重ならないように）
 */
function keepBodyOff(state: GameState, e: Enemy): void {
  if (enemyDef(e.defKey).behavior !== "wisp") return;
  const p = state.player.body;
  const away = sub(e.body.pos, p.pos);
  const need = e.body.radius + p.radius + WISP_KEEP_OFF;
  if (length(away) >= need) return;
  e.body.pos = add(p.pos, scale(normalize(away), need));
  e.body.vel = { x: 0, y: 0 };
}

/** 攻めない設定のとき、敵の弾・地面の攻撃・地形の予約を消す（骨の壁は攻撃ではないので残す） */
function clearEnemyAttacks(state: GameState): void {
  state.projectiles = state.projectiles.filter((p) => p.owner !== "enemy");
  state.hazards = state.hazards.filter((h) => h.kind === "boneWall");
  if (state.terrainSeeds) state.terrainSeeds = [];
}

/**
 * 受けた傷（state.hurtTap。1 発ずつの量）を汲み出して計測に入れ、無傷なら生命を戻す。
 * 生命を払うスキルの代償は hurtTap に入らないので、数えず戻さない
 */
function noteTaken(session: DojoSession, hpBefore: number): void {
  const { state, dojo } = session;
  const p = state.player;
  const tap = state.hurtTap;
  if (!tap || tap.length === 0) return;
  recordDojoTaken(dojo.meter, tap.reduce((sum, v) => sum + v, 0), tap.length);
  state.hurtTap = [];
  if (!dojo.config.invincible) return;
  p.hp = Math.max(p.hp, hpBefore);
  p.deferredDamage = [];
}

function noteKills(session: DojoSession, live: readonly Enemy[]): void {
  const fallen = live.filter((e) => e.hp <= 0 && e.vanished !== true).length;
  if (fallen > 0) recordDojoKills(session.dojo.meter, fallen);
}

/** 倒れない設定で 1 ステップのうちに倒れた敵（満タンから一撃で削り切られた）を同じ位置に作り直す */
function rebuildFallen(session: DojoSession, live: readonly Enemy[]): void {
  const { state, dojo } = session;
  for (const e of live) {
    if (e.hp > 0) continue;
    const i = dojo.spawned.indexOf(e.id);
    if (i < 0) continue;
    const again = spawnOne(session, e.defKey, e.body.pos, false);
    dojo.spawned[i] = again.id;
  }
  state.enemies = state.enemies.filter((e) => e.hp > 0);
}

function fillInfinite(session: DojoSession): void {
  const { state, dojo } = session;
  const p = state.player;
  if (dojo.config.infiniteMana) p.mana = state.stats.maxMana;
  if (dojo.config.infiniteEnergy) p.energy = p.maxEnergy;
}

/** 手水鉢に触れたら満たす（DOJO.springCooldown 秒に 1 回。満ちているときは何もしない） */
function updateSpring(session: DojoSession, dt: number): void {
  const { state, dojo } = session;
  dojo.springTimer = Math.max(0, dojo.springTimer - dt);
  if (dojo.springTimer > 0) return;
  const p = state.player;
  if (dist(p.body.pos, dojo.layout.spots.spring) > DOJO.springRadius) return;
  if (isFull(state)) return;
  fillResourcesOf(state);
  dojo.springTimer = DOJO.springCooldown;
  addHeadLabel(state, p.body.pos, SPRING_LABEL, COLOR_HEAL);
  spawnBurst(state, p.body.pos, COLOR_HEAL, SPRING_PARTICLES, SPRING_PARTICLE_SPEED, SPRING_PARTICLE_LIFE, 2);
  pushSfx(state, "fountainHeal");
}

function isFull(state: GameState): boolean {
  const p = state.player;
  return p.hp >= p.maxHp && p.mana >= state.stats.maxMana && p.energy >= p.maxEnergy;
}

/** 全滅したら DOJO.respawnDelay 秒後に湧き直す */
function updateRespawn(session: DojoSession, dt: number): void {
  const { state, dojo } = session;
  if (!dojo.config.respawn) {
    dojo.respawnTimer = 0;
    return;
  }
  if (dojo.respawnTimer > 0) {
    dojo.respawnTimer = Math.max(0, dojo.respawnTimer - dt);
    if (dojo.respawnTimer <= 0) respawnDojo(session);
    return;
  }
  if (state.enemies.some((e) => e.hp > 0)) return;
  dojo.respawnTimer = DOJO.respawnDelay;
}

/** DOJO.interactRadius 以内で一番近い、開ける台 */
export function nearestDojoSpot(session: DojoSession): DojoOpenSpotKey | null {
  const { state, dojo } = session;
  const pos = state.player.body.pos;
  let best: DojoOpenSpotKey | null = null;
  let bestDist: number = DOJO.interactRadius;
  for (const key of OPEN_SPOTS) {
    const d = dist(pos, dojo.layout.spots[key]);
    if (d > bestDist) continue;
    best = key;
    bestDist = d;
  }
  return best;
}

// -----------------------------------------------------------------------------
// 湧き
// -----------------------------------------------------------------------------

/** 並びの各点（px。壁に掛かるかは見ない）。乱数を使わないので、湧き直しのたびに同じ配置になる */
export function dojoSpawnPoints(layout: DojoLayout, config: DojoConfig): Vec[] {
  const n = Math.max(0, config.count);
  const { anchor, facing } = layout;
  const side: Vec = { x: -facing.y, y: facing.x };
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    if (config.formation === "ring") {
      const a = Math.atan2(facing.y, facing.x) + (Math.PI * 2 * i) / n;
      out.push(add(anchor, scale(fromAngle(a), config.distance)));
      continue;
    }
    const [forward, lateral] = config.formation === "line" ? lineOffset(i, n) : scatterOffset(i, n);
    out.push(add(anchor, add(scale(facing, config.distance + forward), scale(side, lateral))));
  }
  return out;
}

/** 横一列: 向きに直交して DOJO.spacing 間隔、中央揃え */
function lineOffset(i: number, n: number): [number, number] {
  return [0, (i - (n - 1) / 2) * DOJO.spacing];
}

/** 散らばり: 間合いの先の矩形に R2 列で置く（奥行きは数の平方根ぶん、横幅はその SCATTER_WIDE 倍） */
function scatterOffset(i: number, n: number): [number, number] {
  const span = DOJO.spacing * Math.ceil(Math.sqrt(n));
  const u = (0.5 + i * R2_A) % 1;
  const v = (0.5 + i * R2_B) % 1;
  return [v * span, (u - 0.5) * span * SCATTER_WIDE];
}

/** 今の設定で敵を湧き直す（今いる敵・敵の弾・地面の攻撃は消す） */
export function respawnDojo(session: DojoSession): void {
  const { state, dojo } = session;
  state.enemies = [];
  state.projectiles = state.projectiles.filter((p) => p.owner !== "enemy");
  state.hazards = [];
  state.corpses = [];
  if (state.terrainSeeds) state.terrainSeeds = [];
  dojo.respawnTimer = 0;
  dojo.spawned = dojoSpawnPoints(dojo.layout, dojo.config).map((pos) => spawnOne(session, dojo.config.enemy, pos, true).id);
}

/** 敵を 1 体置く。木人は湧きの演出なし（拠点の木人と同じ）。他は湧きの演出の後に気付いた状態（追う）になる */
function spawnOne(session: DojoSession, key: string, want: Vec, intro: boolean): Enemy {
  const { state, dojo } = session;
  const def = enemyDef(key);
  const pos = spawnSpot(state, want, want, def.radius);
  const dummy = key === DUMMY_KEY;
  const e = createEnemy(state, def, pos, DOJO_ROOM, intro && !dummy);
  if (!dummy && e.phase === "idle") e.phase = "chase";
  if (dojo.config.elite !== null) makeElite(e, dojo.config.elite);
  e.revived = true;
  state.enemies.push(e);
  return e;
}

// -----------------------------------------------------------------------------
// 設定・動作の行
// -----------------------------------------------------------------------------

function isValueRow(key: DojoRowKey): key is DojoValueRowKey {
  return !isDojoActionRow(key);
}

/** 設定を替える。湧き直しの行（dojoRowRespawns）が変わっていたら湧き直す。他の行は今いる敵にそのまま効く */
export function setDojoConfig(session: DojoSession, config: DojoConfig): void {
  const prev = session.dojo.config;
  session.dojo.config = config;
  const changed = DOJO_ROWS.filter(isValueRow).some((key) => dojoRowRespawns(key) && prev[key] !== config[key]);
  if (!changed) return;
  if (prev.depth !== config.depth) applyDepth(session);
  respawnDojo(session);
}

export function resetDojoMeter(session: DojoSession): void {
  session.dojo.meter = createDojoMeter();
  session.state.damageTap = [];
  session.state.hurtTap = [];
}

/** 生命・気力・奥義ゲージを満たす */
export function restoreDojoPlayer(session: DojoSession): void {
  fillResourcesOf(session.state);
}

/** 武器掛けで試す武器種を替える（null で装備のものに戻す）。base は銃の家系の弾の器 */
export function setDojoTrialWeapon(session: DojoSession, moveset: MovesetKey | null, base: string | null = null): void {
  session.dojo.trialMoveset = moveset;
  session.dojo.trialBase = moveset === null ? null : base;
  applyTrialMoveset(session.state, moveset, session.dojo.trialBase);
}

export function dojoMeterView(session: DojoSession): DojoMeterView {
  return dojoMeterSnapshot(session.dojo.meter, session.state.time);
}
