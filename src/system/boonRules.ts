import type { StatusKind } from "../core/status";
import {
  type AttackPhase,
  type DamageKind,
  type Enemy,
  type GameState,
  type Projectile,
  type RoomState,
  allocId,
  pushSfx,
} from "../core/state";
import { type Vec, angle, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { type EnemyBehavior, enemyDef } from "../data/enemies";
import { ACTION, BOON, FEEL, PLAYER, STATUS } from "../data/tuning";
import { stoneInSlot } from "../skills/persistence";
import type { SkillResource } from "../skills/types";
import { boonGradeMul } from "./boonGrade";
import { boonNormalAttackBonus, hasBoon } from "./boons";
import { damageEnemy, gainEnergy, healSustained, pacifistMercyClamp, rollOutgoing } from "./combat";
import { addFloatingText, spawnBurst, spawnLine, spawnRing } from "./effects";
import { engagedRoomIndex } from "./engagement";
import { scaled } from "./attributes";
import { gainMana } from "./mana";
import { circlesOverlap, overlapsWall } from "./physics";
import { shotDamage } from "./player";
import { addPoise, isStaggered } from "./poise";
import { ROAMING_ROOM } from "./spawner";
import {
  applyBurn,
  applyChill,
  applyStatus,
  chainLightning,
  enemiesInRadius,
  explodeAt,
  findStatus,
  hasStatus,
  isFeared,
  removeStatus,
  statusCount,
  statusStacks,
} from "./statusEffects";

/**
 * 祝福の拡張で足したルール（docs/ideas/boons-expansion.md）。系譜・結び・単体の祝福の効果をここに集める。
 * 既存のフック（boons.ts の onBoonKill など）から呼ばれる関数と、各 system へ 1〜2 行で差し込む新しいフックを持つ。
 * 「〜時: 〜」で書ける祝福は BoonDef.rules（boonDefs.ts の directRules）へ移した。ここに残るのは
 * 祝福内部の状態（窓・回数・目印）を持つもの、ダメージや判定の途中に割り込むもの、文法に無い効果を使うもの
 * 暴走しないよう、連鎖するものは ICD・上限・再入防止のどれかを必ず持つ
 */

const LAST_COMBO = PLAYER.melee.length - 1;
const DEG_TO_RAD = Math.PI / 180;
const TEXT_SCALE = 1.1;
const TEXT_LIFE = 0.6;
/** マナ満タンの判定の許容（浮動小数の端数で満タンにならないのを防ぐ） */
const FULL_EPS = 1e-6;
/** 射撃弾の目印（projFlags のビット） */
const FLAG_WAVE = 1;
const FLAG_BOUNCED = 2;
const FLAG_WEAKSPOT = 4;
const FLAG_FIREWALK = 8;
/** 沈黙で予備動作を取り消せる敵（statusEffects.ts の SILENCEABLE_WINDUP と同じ。口封じの対象） */
const SILENCEABLE: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["shooter", "laser", "bomber"]);

type Element = "burn" | "chill" | "shock";

const ELEMENT_COLOR: Readonly<Record<Element, string>> = {
  burn: STATUS.burnColor,
  chill: STATUS.chillColor,
  shock: STATUS.shockColor,
};

interface TrailPoint {
  pos: Vec;
  time: number;
  kind: Element;
}

interface AshPile {
  pos: Vec;
  time: number;
}

interface ThunderMark {
  pos: Vec;
  timer: number;
}

/** 拡張ルールのラン内の作業領域（BoonRunState.rules） */
export interface BoonRuleState {
  /** 見定め: 1・2 段目を当てた敵と、何段目まで当てたか */
  appraise: { targetId: number; stage: number };
  /** 力の簒奪: 次の近接の怯み値 ×2 の残り回数 */
  usurpCharges: number;
  /** 飛燕: 前ステップの近接の段階（active → recover の空振りを見つける） */
  prevAttackPhase: AttackPhase;
  /** 抜き胴 / 静電気: 今のダッシュで既にすり抜けた敵 */
  dashHits: number[];
  trail: TrailPoint[];
  trailIcd: Map<number, number>;
  trailDropTimer: number;
  /** 弾の目印（跳ね返り済み・衝撃波など）。弾が消えたら掃除する */
  projFlags: Map<number, number>;
  /** 火渡り: 弾が運んでいる燃焼の dps（付与前の値） */
  fireCarry: Map<number, number>;
  shootHeldPrev: boolean;
  recallCd: number;
  ashes: AshPile[];
  ashCharges: number;
  wildfireCd: number;
  /** 落雷予告 / 神経断ち: 前ステップに麻痺していた敵 */
  paralyzedIds: number[];
  marks: ThunderMark[];
  /** 雷神の鼓の連鎖中（連鎖のコンボで再び鳴らない） */
  drumActive: boolean;
  lastCastResource: SkillResource | null;
  /** 両輪: この発動で既に報酬を得たか */
  castRewarded: boolean;
  twinDiscount: boolean;
  newMoonTimer: number;
  prevMana: number;
  eclipseTimer: number;
  castSeq: number[];
  mirrorTimer: number;
  afterglowTimer: number;
  fullMoonTimer: number;
  /** 起き上がり狙い: 怯みが解けた敵 id → 残り秒 */
  wakeup: Map<number, number>;
  /** 崩し連鎖の処理中（連鎖で怯んだ敵から再び広げない） */
  collapseActive: boolean;
  /** 霜読み: 次の怯み値の計算をカウンター扱いにする敵 */
  pendingCounterId: number | null;
  reaperStun: number;
  /** 時間稼ぎ: この階で死神の出現を遅らせる秒 */
  reaperDelay: number;
  /** 持ち越し: 次の封鎖までコンボを保つ */
  carryCombo: boolean;
  karmaCd: number;
  // ---- 第 2 弾 ----
  /** 倒れた徘徊の敵 id → 覚えておく残り秒（条件 targetRoamer。撃破の照合は敵が配列から消えた後に起きる） */
  roamerKills: Map<number, number>;
  /** 織り交ぜ: 直前にスキルを撃ったスロット（-1 = まだ撃っていない） */
  lastCastSlot: number;
  /** 満ち溢れ: 溜めた溢れの気力 */
  overflow: number;
}

export function createBoonRuleState(): BoonRuleState {
  return {
    appraise: { targetId: -1, stage: 0 },
    usurpCharges: 0,
    prevAttackPhase: "none",
    dashHits: [],
    trail: [],
    trailIcd: new Map(),
    trailDropTimer: 0,
    projFlags: new Map(),
    fireCarry: new Map(),
    shootHeldPrev: false,
    recallCd: 0,
    ashes: [],
    ashCharges: 0,
    wildfireCd: 0,
    paralyzedIds: [],
    marks: [],
    drumActive: false,
    lastCastResource: null,
    castRewarded: false,
    twinDiscount: false,
    newMoonTimer: 0,
    prevMana: 0,
    eclipseTimer: 0,
    castSeq: [],
    mirrorTimer: 0,
    afterglowTimer: 0,
    fullMoonTimer: 0,
    wakeup: new Map(),
    collapseActive: false,
    pendingCounterId: null,
    reaperStun: 0,
    reaperDelay: 0,
    carryCombo: false,
    karmaCd: 0,
    roamerKills: new Map(),
    lastCastSlot: -1,
    overflow: 0,
  };
}

function rules(state: GameState): BoonRuleState {
  return state.boonRun.rules;
}

// -----------------------------------------------------------------------------
// 共通
// -----------------------------------------------------------------------------

/** 近接 1 段目の装備・ステータス込みダメージ（祝福の威力は装備 stat に比例させる） */
export function slashBase(state: GameState): number {
  const s = state.stats;
  const base = scaled(s, PLAYER.melee[0]!.scaling);
  return Math.round((base + s.meleeDamageFlat) * s.meleeDamageMul);
}

/** 付与済みの potency（霊力の倍率込み）を付与前の値へ割り戻す。applyStatus が player 由来に再度掛けるため */
function rawPotency(state: GameState, potency: number): number {
  return potency / Math.max(Number.EPSILON, state.stats.statusPotencyMul);
}

function inflict(state: GameState, e: Enemy, kind: StatusKind, duration: number, stacks = 1, potency = 0): boolean {
  return applyStatus(state, { kind: "enemy", enemy: e }, { kind, stacks, duration, potency }, "player");
}

/** 祝福の燃焼の dps。装備の燃焼が強ければそちらを使う */
function emberDps(state: GameState): number {
  return Math.max(state.stats.burnDps, slashBase(state) * BOON.emberDpsRatio);
}

/** 祝福の感電の強さ。装備の雷が強ければそちらを使う */
function shockPotency(state: GameState): number {
  return Math.max(state.stats.shockDamage, slashBase(state) * BOON.shockPotencyRatio);
}

/** pos から近い順に count 体（出現中・死亡を除く） */
function nearestEnemies(state: GameState, pos: Vec, radius: number, count: number, excludeId?: number): Enemy[] {
  return enemiesInRadius(state, pos, radius)
    .filter((e) => e.id !== excludeId)
    .sort((a, b) => dist(pos, a.body.pos) - dist(pos, b.body.pos) || a.id - b.id)
    .slice(0, count);
}

function hitProc(state: GameState, e: Enemy, base: number, from: Vec, poise = 0): void {
  const out = rollOutgoing(state, e, base, "proc");
  damageEnemy(state, e, out.amount, sub(e.body.pos, from), 0, { hitstopSteps: 0, poise: poise * state.stats.poiseDamageMul });
}

function flagOf(state: GameState, pr: Projectile): number {
  return rules(state).projFlags.get(pr.id) ?? 0;
}

function setFlag(state: GameState, pr: Projectile, flag: number): void {
  rules(state).projFlags.set(pr.id, flagOf(state, pr) | flag);
}

function manaFull(state: GameState): boolean {
  return state.player.mana >= state.stats.maxMana - FULL_EPS;
}

function say(state: GameState, pos: Vec, text: string, color: string = BOON.ruleTextColor): void {
  addFloatingText(state, pos, text, color, TEXT_SCALE, TEXT_LIFE);
}

/** 衝撃波（断裂波・連撃波・飛燕）。波返しのために目印を付ける */
export function spawnBoonWave(state: GameState, dir: Vec, damage: number): void {
  const p = state.player;
  const pr: Projectile = {
    id: allocId(state),
    owner: "player",
    pos: { ...p.body.pos },
    vel: scale(dir, BOON.waveSpeed),
    radius: BOON.waveRadius,
    damage,
    life: BOON.waveLife,
    color: BOON.waveColor,
    kind: "melee",
    hitIds: new Set(),
    pierceLeft: BOON.wavePierce,
  };
  state.projectiles.push(pr);
  setFlag(state, pr, FLAG_WAVE);
}

// -----------------------------------------------------------------------------
// 毎ステップ（boons.ts の updateBoons から）
// -----------------------------------------------------------------------------

export function updateBoonRules(state: GameState, dt: number): void {
  tickRuleTimers(rules(state), dt);
  updateDashThrough(state);
  updateTrail(state, dt);
  updateMissedSwing(state);
  updateAshes(state, dt);
  updateParalyzeWatch(state);
  updateMarks(state, dt);
  updateComboHold(state);
  updateKarmaFire(state);
  updateNewMoonWatch(state);
  pruneProjectileMarks(state);
}

function tickRuleTimers(r: BoonRuleState, dt: number): void {
  r.recallCd = Math.max(0, r.recallCd - dt);
  r.wildfireCd = Math.max(0, r.wildfireCd - dt);
  r.newMoonTimer = Math.max(0, r.newMoonTimer - dt);
  r.eclipseTimer = Math.max(0, r.eclipseTimer - dt);
  r.mirrorTimer = Math.max(0, r.mirrorTimer - dt);
  r.afterglowTimer = Math.max(0, r.afterglowTimer - dt);
  r.fullMoonTimer = Math.max(0, r.fullMoonTimer - dt);
  r.reaperStun = Math.max(0, r.reaperStun - dt);
  r.karmaCd = Math.max(0, r.karmaCd - dt);
  tickMap(r.wakeup, dt);
  tickMap(r.trailIcd, dt);
  tickMap(r.roamerKills, dt);
}

function tickMap(map: Map<number, number>, dt: number): void {
  for (const [id, t] of map) {
    if (t - dt <= 0) map.delete(id);
    else map.set(id, t - dt);
  }
}

/** 抜き胴 / 静電気: ダッシュ中に重なった敵へ 1 回ずつ */
function updateDashThrough(state: GameState): void {
  const pass = hasBoon(state, "passCut");
  const zap = hasBoon(state, "staticDash");
  const p = state.player;
  if ((!pass && !zap) || p.dashTimer <= 0) return;
  const r = rules(state);
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning" || r.dashHits.includes(e.id)) continue;
    const reach = p.body.radius + BOON.passCutReach;
    if (!circlesOverlap(p.body.pos.x, p.body.pos.y, reach, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    r.dashHits.push(e.id);
    if (zap) inflict(state, e, "shock", STATUS.shock.duration, 1, shockPotency(state));
    if (pass) hitProc(state, e, slashBase(state) * BOON.passCutRatio * boonGradeMul(state, "passCut"), p.body.pos, BOON.passCutPoise);
  }
}

/** 装備で最も強い元素（燃焼 / 冷気 / 感電）。同率・無しは燃焼 */
export function trailElement(state: GameState): Element {
  const s = state.stats;
  if (s.chillChance > s.burnChance && s.chillChance >= s.shockChance) return "chill";
  if (s.shockChance > s.burnChance && s.shockChance > s.chillChance) return "shock";
  return "burn";
}

function updateTrail(state: GameState, dt: number): void {
  const r = rules(state);
  for (const t of r.trail) t.time -= dt;
  r.trail = r.trail.filter((t) => t.time > 0);
  if (!hasBoon(state, "elementTrail")) {
    r.trail = [];
    return;
  }
  if (state.player.dashTimer > 0) {
    r.trailDropTimer -= dt;
    if (r.trailDropTimer <= 0) {
      r.trailDropTimer = BOON.trailDropInterval;
      dropTrail(state);
    }
  } else {
    r.trailDropTimer = 0;
  }
  applyTrail(state);
}

function dropTrail(state: GameState): void {
  const r = rules(state);
  const kind = trailElement(state);
  const pos = { ...state.player.body.pos };
  r.trail.push({ pos, time: BOON.trailLife, kind });
  if (r.trail.length > BOON.trailMaxPoints) r.trail.shift();
  spawnBurst(state, pos, ELEMENT_COLOR[kind], 2, 15, BOON.trailLife, 2);
}

function applyTrail(state: GameState): void {
  const r = rules(state);
  if (r.trail.length === 0) return;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning" || r.trailIcd.has(e.id)) continue;
    const hit = r.trail.find((t) => circlesOverlap(t.pos.x, t.pos.y, BOON.trailRadius, e.body.pos.x, e.body.pos.y, e.body.radius));
    if (!hit) continue;
    r.trailIcd.set(e.id, BOON.trailIcd);
    applyElement(state, e, hit.kind);
  }
}

function applyElement(state: GameState, e: Enemy, kind: Element): void {
  const s = state.stats;
  if (kind === "burn") applyBurn(state, e, Math.max(s.burnDps, BOON.trailBurnDps * boonGradeMul(state, "elementTrail")), STATUS.burnDuration);
  if (kind === "chill") applyChill(state, e, Math.max(s.chillSlow, BOON.trailChillSlow), STATUS.chillDuration);
  if (kind === "shock") inflict(state, e, "shock", STATUS.shock.duration, 1, shockPotency(state));
}

/** 飛燕: 当てずに振り終えた（active → recover）斬撃から斬撃波を出す */
function updateMissedSwing(state: GameState): void {
  const r = rules(state);
  const p = state.player;
  const prev = r.prevAttackPhase;
  r.prevAttackPhase = p.attack.phase;
  if (!hasBoon(state, "swallowFlight") || prev !== "active" || p.attack.phase !== "recover") return;
  if (p.attack.hitIds.size > 0 || p.dashStrike) return;
  spawnBoonWave(state, p.attack.dir, slashBase(state) * BOON.swallowFlightRatio);
}

/** 灰積もり: 灰の寿命と拾い上げ */
function updateAshes(state: GameState, dt: number): void {
  const r = rules(state);
  if (!hasBoon(state, "ashBed")) {
    r.ashes = [];
    return;
  }
  const p = state.player.body;
  for (const a of r.ashes) {
    a.time -= dt;
    if (state.tick % BOON.ashFxEvery === 0) spawnBurst(state, a.pos, BOON.ashColor, 1, 10, 0.5, 1.5);
    if (dist(a.pos, p.pos) > BOON.ashPickupRadius + p.radius) continue;
    a.time = 0;
    r.ashCharges = Math.min(BOON.ashMaxCharges, r.ashCharges + 1);
    say(state, p.pos, "灰", BOON.ashColor);
  }
  r.ashes = r.ashes.filter((a) => a.time > 0);
}

/** 落雷予告 / 神経断ち: 麻痺の始まりと終わりを見つける */
function updateParalyzeWatch(state: GameState): void {
  const r = rules(state);
  const mark = hasBoon(state, "thunderMark");
  const nerve = hasBoon(state, "nerveCut");
  if (!mark && !nerve) {
    r.paralyzedIds = [];
    return;
  }
  const prev = new Set(r.paralyzedIds);
  const now: number[] = [];
  for (const e of state.enemies) {
    if (e.hp <= 0 || !hasStatus(e.status, "paralyze")) continue;
    now.push(e.id);
    if (!prev.has(e.id) && mark) placeMark(state, e.body.pos);
  }
  if (nerve) {
    const current = new Set(now);
    for (const e of state.enemies) {
      if (e.hp > 0 && prev.has(e.id) && !current.has(e.id)) inflict(state, e, "weaken", BOON.nerveCutTime);
    }
  }
  r.paralyzedIds = now;
}

function placeMark(state: GameState, pos: Vec): void {
  const r = rules(state);
  if (r.marks.length >= BOON.markMax) return;
  r.marks.push({ pos: { ...pos }, timer: BOON.markDelay });
  spawnRing(state, pos, BOON.markRadius, STATUS.shockColor, BOON.markDelay);
}

function updateMarks(state: GameState, dt: number): void {
  const r = rules(state);
  if (r.marks.length === 0) return;
  for (const m of r.marks) {
    m.timer -= dt;
    if (m.timer <= 0) strikeMark(state, m.pos);
  }
  r.marks = r.marks.filter((m) => m.timer > 0);
}

function strikeMark(state: GameState, pos: Vec): void {
  spawnLine(state, { x: pos.x, y: pos.y - BOON.markBoltHeight }, pos, STATUS.shockColor, STATUS.fxLife);
  spawnBurst(state, pos, STATUS.shockColor, 10, 90, 0.3, 2);
  pushSfx(state, "shock");
  for (const e of enemiesInRadius(state, pos, BOON.markRadius)) {
    hitProc(state, e, slashBase(state) * BOON.markRatio * boonGradeMul(state, "thunderMark"), pos, BOON.markPoise);
  }
}

/** 綱渡り / 持ち越し: コンボの受付時間を満額に保つ（時間切れを起こさない） */
function updateComboHold(state: GameState): void {
  const r = rules(state);
  const hold = hasBoon(state, "tightrope") || (r.carryCombo && hasBoon(state, "carryOver"));
  if (!hold || state.combo.count <= 0) return;
  state.combo.timer = Math.max(state.combo.timer, FEEL.comboWindow + state.stats.comboWindowBonus);
}

/** 業の火: 近くに燃える敵がいると自分も燃える */
function updateKarmaFire(state: GameState): void {
  const r = rules(state);
  if (!hasBoon(state, "karmaFire") || r.karmaCd > 0) return;
  const p = state.player.body.pos;
  if (!enemiesInRadius(state, p, BOON.karmaRadius).some((e) => hasStatus(e.status, "burn"))) return;
  r.karmaCd = BOON.karmaIcd;
  applyStatus(state, { kind: "player" }, { kind: "burn", stacks: 1, duration: BOON.karmaBurnTime, potency: BOON.karmaBurnDps }, "env");
}

/** 新月: マナが 0 になった瞬間から窓を開く */
function updateNewMoonWatch(state: GameState): void {
  const r = rules(state);
  const mana = state.player.mana;
  if (hasBoon(state, "newMoon") && r.prevMana > 0 && mana <= 0) r.newMoonTimer = BOON.newMoonWindow;
  r.prevMana = mana;
}

function pruneProjectileMarks(state: GameState): void {
  const r = rules(state);
  if (r.projFlags.size === 0 && r.fireCarry.size === 0) return;
  const alive = new Set(state.projectiles.map((p) => p.id));
  for (const id of r.projFlags.keys()) if (!alive.has(id)) r.projFlags.delete(id);
  for (const id of r.fireCarry.keys()) if (!alive.has(id)) r.fireCarry.delete(id);
}

/** 新しい階: 階ごとのもの（灰・予告・轍・死神の遅れ）を捨てる */
export function resetBoonRulesForFloor(state: GameState): void {
  const r = rules(state);
  r.ashes = [];
  r.marks = [];
  r.trail = [];
  r.reaperDelay = 0;
  r.reaperStun = 0;
  r.carryCombo = false;
  r.roamerKills.clear();
}

// -----------------------------------------------------------------------------
// 既存フックの拡張（boons.ts から）
// -----------------------------------------------------------------------------

/** 振り始め（旧フック）。片翼はダッシュ終わり（onBoonDashEndRules）へ移した。今は何もしない */
export function onBoonSwingRules(_state: GameState, _combo: number, _dashStrike: boolean): void {}

/** ダッシュ終わり: 片翼 */
export function onBoonDashEndRules(state: GameState): void {
  if (!hasBoon(state, "oneWing")) return;
  oneWingVolley(state);
}

/** 片翼: 射撃の弾（弾数・威力・貫通は装備のまま）をダッシュの終わりに扇状に出す */
function oneWingVolley(state: GameState): void {
  const s = state.stats;
  const p = state.player;
  const count = Math.max(BOON.oneWingMinShots, s.projectileCount);
  const base = angle(p.facing);
  const damage = shotDamage(s) + boonNormalAttackBonus(state);
  const speed = PLAYER.shoot.speed * s.projectileSpeedMul;
  const center = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const a = base + (i - center) * BOON.oneWingSpreadDeg * DEG_TO_RAD;
    state.projectiles.push({
      id: allocId(state),
      owner: "player",
      pos: { ...p.body.pos },
      vel: scale(fromAngle(a), speed),
      radius: PLAYER.shoot.radius,
      damage,
      life: PLAYER.shoot.life,
      color: BOON.oneWingColor,
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: s.pierce,
      poise: PLAYER.shoot.poise * s.poiseDamageMul,
    });
  }
  pushSfx(state, "shoot");
}

/** ダッシュ開始: すり抜けの記録を空にする */
export function onBoonDashRules(state: GameState): void {
  rules(state).dashHits = [];
}

/**
 * 近接 1 ヒットの後。燠火・帯電の刃・狩りの血・看破（カウンター）・満ち潮・過充填・臨界は
 * BoonDef.rules（onSwingHit / onCounter）へ移した。ここに残るのは祝福内部の状態を持つものと、弾の命中と ICD を分け合う延焼
 */
export function onBoonMeleeHitRules(state: GameState, e: Enemy, _counter = false): void {
  trackAppraise(state, e);
  if (hasBoon(state, "wildfire")) spreadWildfire(state, e);
  meleeBurn(state, e);
  fillOverflow(state);
}

/** 満ち溢れ: 気力が満ちている間の近接で、溢れた分を上限まで溜める */
function fillOverflow(state: GameState): void {
  if (!hasBoon(state, "overflowCup") || !manaFull(state)) return;
  const r = rules(state);
  const cap = state.stats.maxMana * BOON.overflowCapRatio;
  r.overflow = Math.min(cap, r.overflow + BOON.overflowPerHit);
}

/** 見定め: 1 段目 → 2 段目を同じ敵に当てたかを数える */
function trackAppraise(state: GameState, e: Enemy): void {
  const p = state.player;
  if (!hasBoon(state, "appraise") || p.dashStrike) return;
  const a = rules(state).appraise;
  const combo = p.attack.combo;
  if (combo === 0) {
    a.targetId = e.id;
    a.stage = 1;
    return;
  }
  if (combo === 1 && a.stage === 1 && a.targetId === e.id) {
    a.stage = 2;
    return;
  }
  if (combo === LAST_COMBO && a.targetId === e.id) a.stage = 0;
}

/** 延焼: 燃焼中の敵に当てると周囲へ燃焼を移す（全体で ICD） */
function spreadWildfire(state: GameState, e: Enemy): void {
  const r = rules(state);
  const burn = findStatus(e.status, "burn");
  if (!burn || r.wildfireCd > 0) return;
  r.wildfireCd = BOON.wildfireIcd;
  const dps = rawPotency(state, burn.potency);
  for (const o of enemiesInRadius(state, e.body.pos, BOON.wildfireRadius)) {
    if (o.id !== e.id) applyBurn(state, o, dps, STATUS.burnDuration);
  }
  spawnRing(state, e.body.pos, BOON.wildfireRadius, STATUS.burnColor, STATUS.fxLife);
}

/** 火種（3 段目）と灰積もり（拾った灰 1 つで次の近接 1 回）の燃焼 */
function meleeBurn(state: GameState, e: Enemy): void {
  const p = state.player;
  const r = rules(state);
  const seed = hasBoon(state, "emberSeed") && p.attack.combo === LAST_COMBO && !p.dashStrike;
  const ash = hasBoon(state, "ashBed") && r.ashCharges > 0;
  if (!seed && !ash) return;
  if (ash) r.ashCharges -= 1;
  applyBurn(state, e, emberDps(state) * (ash ? BOON.ashBurnMul : 1), STATUS.burnDuration);
}

/** 満ち潮: マナ満タンの間、射撃の命中で必殺ゲージ（近接の命中は BoonDef.rules の onSwingHit） */
function highTide(state: GameState): void {
  if (!hasBoon(state, "highTide") || !manaFull(state)) return;
  gainEnergy(state, BOON.highTideEnergy);
}

/**
 * 撃破時（boons.ts の onBoonKill の先頭から。回復系の祝福より前の HP / マナを見る）。
 * 威圧・綻び広げ・立て直しの狩り・取り返し・死神の影・死に急ぎは BoonDef.rules（onKill）へ移した
 */
export function onBoonKillRules(state: GameState, enemy: Enemy): void {
  if (enemy.roomIndex === ROAMING_ROOM) rules(state).roamerKills.set(enemy.id, BOON.roamerKillMemory);
  feastCup(state);
  if (hasBoon(state, "usurp") && hasStatus(enemy.status, "weaken")) rules(state).usurpCharges = 1;
  if (hasBoon(state, "ashBed") && hasStatus(enemy.status, "burn")) leaveAsh(state, enemy.body.pos);
}

/** 饗宴の盃: HP 満タンならマナを、マナ満タンなら回復を上乗せする */
function feastCup(state: GameState): void {
  if (!hasBoon(state, "feastCup")) return;
  const p = state.player;
  const hpFull = p.hp >= p.maxHp;
  const full = manaFull(state);
  if (hpFull) gainMana(state, BOON.reaperCupKillMana);
  if (full) healSustained(state, BOON.feastHeal, { silent: true });
}

function leaveAsh(state: GameState, pos: Vec): void {
  const r = rules(state);
  r.ashes.push({ pos: { ...pos }, time: BOON.ashLife });
  if (r.ashes.length > BOON.ashMax) r.ashes.shift();
}

/**
 * 血裂き: 出血 3 の敵への会心で出血を消費し、その分を即時に与える。
 * damageEnemy の内側（撃破判定の前）で呼ばれるので、再入させず HP を直接減らす（撃破は外側の判定に任せる）
 */
export function onBoonCritRules(state: GameState, enemy: Enemy): void {
  if (!hasBoon(state, "laceration") || enemy.hp <= 0) return;
  const bleed = findStatus(enemy.status, "bleed");
  if (!bleed || bleed.stacks < BOON.lacerationStacks) return;
  const raw = Math.round(bleed.stacks * bleed.potency * BOON.lacerationUnits);
  removeStatus(state, { kind: "enemy", enemy }, "bleed");
  if (raw <= 0) return;
  const amount = pacifistMercyClamp(state, enemy, raw);
  if (amount <= 0) return;
  enemy.hp -= amount;
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - 8 }, `血裂き ${amount}`, BOON.bloodMistColor, TEXT_SCALE, TEXT_LIFE);
}

/**
 * ジャスト回避の瞬間（一掃の前）: 奪弾。消す前に周囲の敵弾を自分の弾へ変える
 */
export function onBoonJustSteal(state: GameState): void {
  if (!hasBoon(state, "bulletSteal")) return;
  const p = state.player;
  let stolen = 0;
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (dist(pr.pos, p.body.pos) > BOON.stealRadius) continue;
    const speed = Math.max(length(pr.vel), BOON.stealMinSpeed);
    pr.owner = "player";
    pr.vel = scale(p.facing, speed);
    pr.damage *= BOON.stealDamageMul * boonGradeMul(state, "bulletSteal");
    pr.kind = "ranged";
    pr.color = BOON.stealColor;
    pr.hitIds.clear();
    pr.pierceLeft = 0;
    pr.sourceId = undefined;
    pr.life = Math.max(pr.life, BOON.stealMinLife);
    stolen += 1;
  }
  if (stolen > 0) say(state, p.body.pos, "奪弾", BOON.stealColor);
}

/**
 * ジャスト回避の後（一掃の後）。wiped = 回避一掃で消した敵弾の数。
 * 睨み・見切り返し・乾坤・永冬は BoonDef.rules（onJustDodge）へ移した
 */
export function onBoonJustRules(state: GameState, wiped: number): void {
  if (hasBoon(state, "swallowReturn")) swallowReturn(state, wiped);
  if (hasBoon(state, "clearMirror")) rules(state).mirrorTimer = BOON.mirrorWindow;
}

/** 燕渡り: 消した敵弾の数だけ近い敵を斬り渡る */
function swallowReturn(state: GameState, wiped: number): void {
  const count = Math.min(BOON.swallowMaxTargets, wiped);
  if (count <= 0) return;
  const p = state.player;
  let from = { ...p.body.pos };
  const j = ACTION.justCounter;
  for (const e of nearestEnemies(state, p.body.pos, BOON.swallowRange, count)) {
    spawnLine(state, from, e.body.pos, j.color, j.lineLife);
    hitProc(state, e, slashBase(state) * BOON.swallowRatio * boonGradeMul(state, "swallowReturn"), from, BOON.swallowPoise);
    from = { ...e.body.pos };
  }
  pushSfx(state, "counter");
}

/** コンボ加算の後: 雷神の鼓 */
export function onBoonComboHitRules(state: GameState): void {
  const r = rules(state);
  if (!hasBoon(state, "thunderDrum") || r.drumActive) return;
  if (state.combo.count <= 0 || state.combo.count % BOON.drumEvery !== 0) return;
  const sources = nearestEnemies(state, state.player.body.pos, BOON.drumRadius, BOON.drumMaxSources).filter((e) =>
    hasStatus(e.status, "shock"),
  );
  if (sources.length === 0) return;
  // 連鎖雷の命中でコンボが増え、また 10 の倍数に届いても鳴らさない
  r.drumActive = true;
  for (const e of sources) {
    const shock = findStatus(e.status, "shock");
    if (shock && e.hp > 0) chainLightning(state, e.body.pos, shock.potency, e.id);
  }
  r.drumActive = false;
  say(state, state.player.body.pos, "雷鼓", STATUS.shockColor);
}

/** スキル発動（払った後）。resource が null なら種類不明（テストの直接呼び出し） */
export function onBoonSkillCastRules(state: GameState, slot: number, resource: SkillResource | null, manaPaid: number): void {
  const r = rules(state);
  const p = state.player;
  r.lastCastResource = resource;
  r.castRewarded = false;
  if (hasBoon(state, "afterglow")) r.afterglowTimer = BOON.afterglowWindow;
  // 払う前が満タンだったか（払った額を足し戻して見る）
  if (manaPaid > 0 && p.mana + manaPaid >= state.stats.maxMana - FULL_EPS) r.fullMoonTimer = BOON.fullMoonWindow;
  if (resource === "mana") r.twinDiscount = false;
  if (manaPaid > 0 && takeRefund(state)) {
    p.mana = Math.min(state.stats.maxMana, p.mana + manaPaid);
    say(state, p.body.pos, "還流", BOON.springWellColor);
  }
  if (slot >= 0 && hasBoon(state, "eclipse")) trackEclipse(state, slot);
  if (manaPaid > 0) refundOverflow(state, manaPaid);
  if (slot >= 0) r.lastCastSlot = slot;
}

/** 満ち溢れ: 払った気力のうち、溜めた溢れの分だけを返す */
function refundOverflow(state: GameState, manaPaid: number): void {
  const r = rules(state);
  if (!hasBoon(state, "overflowCup") || r.overflow <= 0) return;
  const p = state.player;
  const back = Math.min(r.overflow, manaPaid);
  r.overflow -= back;
  p.mana = Math.min(state.stats.maxMana, p.mana + back);
  say(state, p.body.pos, "溢れ", BOON.springWellColor);
}

/**
 * 条件 targetRoamer: 敵 id が徘徊か。生きていれば今の所属、倒れた後は撃破の記録
 * （撃破の照合は敵が配列から消えた後に起きるので、BOON.roamerKillMemory 秒の間だけ覚えている）
 */
export function isRoamerTarget(state: GameState, id: number): boolean {
  const live = state.enemies.find((e) => e.id === id && e.hp > 0);
  if (live !== undefined) return live.roomIndex === ROAMING_ROOM;
  return rules(state).roamerKills.has(id);
}

/** 払ったマナが戻るか。月蝕は窓の間ずっと、新月・明鏡は 1 回で窓を閉じる */
function takeRefund(state: GameState): boolean {
  const r = rules(state);
  if (r.eclipseTimer > 0) return true;
  if (r.newMoonTimer > 0) {
    r.newMoonTimer = 0;
    return true;
  }
  if (r.mirrorTimer > 0) {
    r.mirrorTimer = 0;
    return true;
  }
  return false;
}

/**
 * 月蝕: 装着中のスキルを重複なく続けて全部撃ったら窓を開く。
 * 窓の中の（無料の）発動は数えない。数えると 2 スロットを交互に撃つだけで窓が開き直し、マナを払わず撃ち続けられる
 */
function trackEclipse(state: GameState, slot: number): void {
  const r = rules(state);
  if (r.eclipseTimer > 0) return;
  const equipped = equippedSlotCount(state);
  r.castSeq.push(slot);
  if (r.castSeq.length > equipped) r.castSeq.shift();
  if (equipped < BOON.eclipseMinSlots || r.castSeq.length < equipped) return;
  if (new Set(r.castSeq).size !== equipped) return;
  r.castSeq = [];
  r.eclipseTimer = BOON.eclipseWindow;
  say(state, state.player.body.pos, "月蝕", BOON.rarityColor.epic);
}

export function equippedSlotCount(state: GameState): number {
  const rs = state.skills;
  let n = 0;
  for (let i = 0; i < rs.slots.length; i++) if (stoneInSlot(rs.profile, i)) n += 1;
  return n;
}

/** スキル命中: 月読 / 満月撃ち / 両輪 */
export function onBoonSkillHitRules(state: GameState, e: Enemy | undefined): void {
  const r = rules(state);
  if (e && hasBoon(state, "moonRead") && r.lastCastResource === "mana") inflict(state, e, "silence", BOON.moonReadSilence);
  if (e && hasBoon(state, "fullMoonShot") && r.fullMoonTimer > 0) inflict(state, e, "vulnerable", STATUS.vulnerable.duration);
  if (!hasBoon(state, "twinWheels") || r.castRewarded || r.lastCastResource === null) return;
  r.castRewarded = true;
  if (r.lastCastResource === "cooldown") {
    r.twinDiscount = true;
    return;
  }
  for (const slot of state.skills.slots) slot.cooldownLeft = Math.max(0, slot.cooldownLeft - BOON.twinCdCut);
}

/** スキルのマナコスト倍率への上乗せ（両輪 / 静寂の間 / 織り交ぜ / 一念）。slot は -1 なら不明（スロット別の倍率を掛けない） */
export function boonRuleCostMul(state: GameState, slot = -1): number {
  let mul = 1;
  if (hasBoon(state, "twinWheels") && rules(state).twinDiscount) mul *= BOON.twinCostMul;
  if (hasBoon(state, "quietHall") && silencedNearby(state)) mul *= quietHallCostMul(state);
  return mul * slotCostMul(state, slot);
}

/** 静寂の間の倍率。格は「下げる幅」に掛ける（0.7 → 大祝福 0.55）。0 未満にはしない */
function quietHallCostMul(state: GameState): number {
  return Math.max(0, 1 - (1 - BOON.quietHallCostMul) * boonGradeMul(state, "quietHall"));
}

/** スロット別のコスト倍率（織り交ぜ: 直前と同じか / 一念: スロット 1 か） */
export function slotCostMul(state: GameState, slot: number): number {
  if (slot < 0) return 1;
  let mul = 1;
  const last = rules(state).lastCastSlot;
  if (hasBoon(state, "weave") && last >= 0) mul *= last === slot ? BOON.weaveSameMul : BOON.weaveOtherMul;
  if (hasBoon(state, "singleMind")) mul *= slot === 0 ? BOON.singleMindMainMul : BOON.singleMindOtherMul;
  return mul;
}

function silencedNearby(state: GameState): boolean {
  return enemiesInRadius(state, state.player.body.pos, BOON.quietHallRadius).some((e) => hasStatus(e.status, "silence"));
}

/** 通常攻撃のマナ回収倍率への上乗せ（余韻 / 詠唱返し / 乾坤） */
export function boonRuleAttackManaMul(state: GameState): number {
  if (hasBoon(state, "heavenEarth")) return 0;
  let mul = 1;
  if (hasBoon(state, "afterglow") && rules(state).afterglowTimer > 0) mul *= BOON.afterglowManaMul;
  if (hasBoon(state, "chantReturn") && hasStatus(state.player.status, "silence")) mul *= BOON.chantReturnManaMul;
  return mul;
}

/** 部屋の制圧: 時間稼ぎ / 持ち越し。伏兵返し・試練の徒・狩場の王は BoonDef.rules（onRoomClear）へ移した */
export function onBoonRoomClearRules(state: GameState): void {
  const r = rules(state);
  if (hasBoon(state, "stallTime") && state.reaper === null) r.reaperDelay += BOON.stallTimeDelay;
  if (hasBoon(state, "carryOver")) r.carryCombo = true;
}

/** 波で湧く部屋（巣窟の主が見る。狩場の王は boonDefsWave2.ts の条件 eventTagIn に同じ並びを持つ） */
const WAVE_ROOMS: ReadonlySet<RoomState["kind"]> = new Set<RoomState["kind"]>(["horde", "challenge", "arena"]);

/** 徘徊の敵か（どの部屋にも属さない。rules.ts の roomEnemies が読む。spawner を rules.ts から直に読むと初期化順の循環を起こす） */
export function isRoamingEnemy(e: Enemy): boolean {
  return e.roomIndex === ROAMING_ROOM;
}

/** 波が始まった（封鎖の最初の波は onBoonRoomLock、2 波目以降は floor.ts の updateLockedRoom から）。巣窟の主 */
export function onBoonWaveStart(state: GameState, room: RoomState | undefined): void {
  if (!room || !WAVE_ROOMS.has(room.kind) || !hasBoon(state, "hordeLord")) return;
  const p = state.player;
  gainEnergy(state, BOON.hordeLordEnergy);
  gainMana(state, BOON.hordeLordMana);
  say(state, p.body.pos, "巣窟の主", BOON.rarityColor.rare);
}

/** 部屋の封鎖: 持ち越しは次の封鎖で終わる */
export function onBoonRoomLockRules(state: GameState): void {
  rules(state).carryCombo = false;
}

/** 綱渡り: 被弾でコンボ数 / 5 の追加ダメージ。damagePlayer の途中なので倒れる判定は呼び出し側に任せる */
export function tightropePenalty(state: GameState): void {
  if (!hasBoon(state, "tightrope")) return;
  const extra = Math.floor(state.combo.count / BOON.tightropeComboDiv);
  if (extra <= 0) return;
  const p = state.player;
  p.hp = Math.max(0, p.hp - extra);
}

// -----------------------------------------------------------------------------
// 新しいフック（各 system から 1〜2 行で呼ぶ）
// -----------------------------------------------------------------------------

/** combat.ts rollOutgoing: 乱数の会心に外れたとき、祝福で会心にするか（背討ち / 見定め / 病み喰い） */
export function boonForcesCrit(state: GameState, enemy: Enemy | null, kind: DamageKind): boolean {
  if (!enemy || kind === "proc") return false;
  if (hasBoon(state, "backstab") && isFeared(enemy)) return true;
  // 病み喰い（芯）: 悪い状態異常を plagueEaterStatuses 種以上持つ敵には必ず会心
  if (hasBoon(state, "corePlagueEater") && statusCount(enemy.status) >= BOON.plagueEaterStatuses) return true;
  if (!hasBoon(state, "appraise") || kind !== "melee") return false;
  const p = state.player;
  const a = rules(state).appraise;
  return p.attack.phase === "active" && p.attack.combo === LAST_COMBO && !p.dashStrike && a.stage === 2 && a.targetId === enemy.id;
}

/**
 * combat.ts damageEnemy: 祝福で変わる最終の怯み値（際打ち / 重荷 / 力の簒奪 / 霜読み）。
 * 力の簒奪の回数はここで消費する
 */
export function boonPoise(state: GameState, enemy: Enemy, kind: DamageKind, poise: number): number {
  const r = rules(state);
  const counter = r.pendingCounterId === enemy.id;
  r.pendingCounterId = null;
  if (poise <= 0) return poise;
  let mul = counter ? ACTION.counter.poiseMul : 1;
  const edge = state.combo.count > 0 && state.combo.timer <= BOON.edgeStrikeWindow;
  if (kind !== "proc" && edge && hasBoon(state, "edgeStrike")) mul *= BOON.edgeStrikePoiseMul;
  if (kind === "melee" && hasBoon(state, "burden")) mul *= BOON.burdenPoiseMul;
  if (kind === "melee" && r.usurpCharges > 0) {
    r.usurpCharges -= 1;
    mul *= BOON.usurpPoiseMul;
  }
  return poise * mul;
}

/** player.ts meleeHitEnemy: 予備動作以外でもカウンターになるか（起き上がり狙い） */
export function boonCounterable(state: GameState, e: Enemy): boolean {
  return hasBoon(state, "wakeupHunt") && rules(state).wakeup.has(e.id);
}

/** poise.ts: 敵が怯んだ瞬間（崩し連鎖。見逃さぬは BoonDef.rules の onStagger へ移した） */
export function onBoonStagger(state: GameState, e: Enemy): void {
  if (hasBoon(state, "collapseChain")) collapseChain(state, e);
}

/** 崩し連鎖: 同じ部屋で怯み値が溜まっている敵へ上乗せ。連鎖で怯んだ敵からは広げない */
function collapseChain(state: GameState, e: Enemy): void {
  const r = rules(state);
  if (r.collapseActive) return;
  r.collapseActive = true;
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || o.roomIndex !== e.roomIndex || o.poise.damage <= 0 || isStaggered(o)) continue;
    addPoise(state, o, o.poise.max * BOON.collapseRatio);
  }
  r.collapseActive = false;
}

/** poise.ts onStaggerEnd: 怯みが解けた瞬間（起き上がり狙い） */
export function onBoonStaggerEnd(state: GameState, e: Enemy): void {
  if (hasBoon(state, "wakeupHunt")) rules(state).wakeup.set(e.id, BOON.wakeupWindow);
}

/** poise.ts onStaggerEnd: 堅守を付けないか（毒崩し: 毒の敵） */
export function boonSkipsGuarded(state: GameState, e: Enemy): boolean {
  return hasBoon(state, "venomBreak") && hasStatus(e.status, "poison");
}

/**
 * projectiles.ts: プレイヤー弾が敵に当たる直前。与ダメの倍率を返す（霜読みのカウンター）。
 * 口封じ・霜息・狙い目・火渡り・延焼・満ち潮の副作用もここで起こす
 */
export function onBoonProjectileHit(state: GameState, pr: Projectile, e: Enemy): number {
  if (pr.owner !== "player") return 1;
  const r = rules(state);
  r.pendingCounterId = null;
  const ranged = pr.kind === "ranged";
  const counter = ranged && hasBoon(state, "frostRead") && e.phase === "windup" && hasStatus(e.status, "chill");
  if (counter) {
    say(state, e.body.pos, ACTION.counter.text, ACTION.counter.color);
    if (hasBoon(state, "insight")) inflict(state, e, "vulnerable", STATUS.vulnerable.duration);
  }
  if (ranged && hasBoon(state, "silenceShot") && e.phase === "windup" && SILENCEABLE.has(enemyDef(e.defKey).behavior)) {
    inflict(state, e, "silence", BOON.silenceShotTime);
  }
  // on-hit の ICD が空いているときだけ冷気を付ける（連射で即凍結させない）
  if (ranged && hasBoon(state, "frostBreath") && e.status.procIcd <= 0) {
    applyChill(state, e, Math.max(state.stats.chillSlow, BOON.frostBreathSlow), STATUS.chillDuration);
  }
  weakSpot(state, pr, e);
  fireWalk(state, pr, e);
  if (hasBoon(state, "wildfire")) spreadWildfire(state, e);
  if (ranged) highTide(state);
  if (!counter) return 1;
  // 副作用（蒸発など）の被弾で消費されないよう、目印は最後に立てる
  r.pendingCounterId = e.id;
  return ACTION.counter.damageMul;
}

function weakSpot(state: GameState, pr: Projectile, e: Enemy): void {
  if (!hasBoon(state, "weakSpot") || !hasStatus(e.status, "vulnerable")) return;
  if ((flagOf(state, pr) & FLAG_WEAKSPOT) !== 0) return;
  pr.pierceLeft += BOON.weakSpotPierce;
  setFlag(state, pr, FLAG_WEAKSPOT);
}

/** 火渡り: 燃える敵を通った弾は貫通 +1 して燃焼を運び、次の燃えていない敵へ移す */
function fireWalk(state: GameState, pr: Projectile, e: Enemy): void {
  if (!hasBoon(state, "fireWalk")) return;
  const r = rules(state);
  const burn = findStatus(e.status, "burn");
  const carry = r.fireCarry.get(pr.id);
  if (carry !== undefined && !burn) {
    applyBurn(state, e, carry, STATUS.burnDuration);
    r.fireCarry.delete(pr.id);
    return;
  }
  if (!burn || (flagOf(state, pr) & FLAG_FIREWALK) !== 0) return;
  pr.pierceLeft += 1;
  setFlag(state, pr, FLAG_FIREWALK);
  r.fireCarry.set(pr.id, rawPotency(state, burn.potency));
}

/**
 * projectiles.ts: プレイヤー弾が壁に当たった。跳ね返ったら true（弾は生き残る）。
 * 跳ね返らなければ炸裂弾頭の爆発だけ起こして false
 */
export function onBoonProjectileWall(state: GameState, pr: Projectile, dt: number): boolean {
  if (pr.owner !== "player") return false;
  const flags = flagOf(state, pr);
  const bounced = (flags & FLAG_BOUNCED) !== 0;
  const wave = (flags & FLAG_WAVE) !== 0;
  if (!bounced && wave && hasBoon(state, "waveReturn")) {
    bounceProjectile(state, pr, dt);
    return true;
  }
  if (pr.kind !== "ranged") return false;
  if (!bounced && hasBoon(state, "ricochet")) {
    bounceProjectile(state, pr, dt);
    pr.damage *= BOON.ricochetDamageMul * boonGradeMul(state, "ricochet");
    pr.hitIds.clear();
    return true;
  }
  if (hasBoon(state, "warhead")) explodeAt(state, pr.pos, BOON.warheadRadius, pr.damage * BOON.warheadRatio);
  return false;
}

/** 1 ステップ前の位置へ戻し、ぶつかった軸の速度を反転する */
function bounceProjectile(state: GameState, pr: Projectile, dt: number): void {
  const prev = { x: pr.pos.x - pr.vel.x * dt, y: pr.pos.y - pr.vel.y * dt };
  const hitX = overlapsWall(state, pr.pos.x, prev.y, pr.radius);
  const hitY = overlapsWall(state, prev.x, pr.pos.y, pr.radius);
  const both = !hitX && !hitY;
  pr.pos = prev;
  pr.vel = { x: hitX || both ? -pr.vel.x : pr.vel.x, y: hitY || both ? -pr.vel.y : pr.vel.y };
  setFlag(state, pr, FLAG_BOUNCED);
  spawnBurst(state, pr.pos, pr.color, 3, 50, 0.15, 1.5);
}

/** player.ts: 銃の左押し（射撃）の押しっぱなし。離した瞬間に呼び戻す */
export function onBoonShootInput(state: GameState, held: boolean): void {
  const r = rules(state);
  const released = r.shootHeldPrev && !held;
  r.shootHeldPrev = held;
  if (!released || r.recallCd > 0 || !hasBoon(state, "recall")) return;
  const p = state.player.body.pos;
  let recalled = 0;
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.kind !== "ranged" || pr.life <= 0) continue;
    const to = sub(p, pr.pos);
    const d = length(to);
    if (d < 1) continue;
    const speed = Math.max(length(pr.vel), BOON.recallMinSpeed);
    pr.vel = scale(normalize(to), speed);
    // 手元に着いたら消える（持ち主を突き抜けて飛び続けない）
    pr.life = d / speed;
    pr.hitIds.clear();
    recalled += 1;
  }
  if (recalled === 0) return;
  r.recallCd = BOON.recallIcd;
  pushSfx(state, "reflect");
}

/** enemies.ts startWindup: 予備動作の長さの倍率（凍て足 / 冬籠り）。伸ばすだけで縮めない */
export function boonWindupMul(state: GameState, e: Enemy): number {
  let mul = 1;
  if (hasBoon(state, "frostFeet") && statusStacks(e.status, "chill") >= BOON.frostFeetStacks) mul *= BOON.frostFeetMul;
  if (hasBoon(state, "winterNest") && inEngagedRoom(state, e)) mul *= BOON.winterNestMul;
  return mul;
}

/** 冬籠り: 今いる交戦中の部屋に属する敵か（徘徊の敵 roomIndex = -1 は含めない） */
function inEngagedRoom(state: GameState, e: Enemy): boolean {
  return e.roomIndex >= 0 && e.roomIndex === engagedRoomIndex(state);
}

/** statusEffects.ts chainLightning: 冷気の敵に届いたとき延びる連鎖の回数（氷伝い） */
export function boonChainExtension(state: GameState, target: Enemy): number {
  if (!hasBoon(state, "iceRelay") || !hasStatus(target.status, "chill")) return 0;
  return BOON.iceRelayJumps;
}

/** reaper.ts: 死神の接触でもジャスト回避が成立するか（死神遊び） */
export function boonReaperJust(state: GameState): boolean {
  return hasBoon(state, "reaperPlay");
}

/** reaper.ts: 死神の攻撃をジャスト回避した */
export function onBoonReaperDodged(state: GameState): void {
  rules(state).reaperStun = BOON.reaperStunTime;
  const pos = state.reaper?.pos ?? state.player.body.pos;
  say(state, pos, "足止め", BOON.rarityColor.epic);
}

/** reaper.ts: 死神が止まっているか */
export function boonReaperHalted(state: GameState): boolean {
  return rules(state).reaperStun > 0;
}

/** reaper.ts: 死神の出現の遅れ（秒。時間稼ぎ） */
export function boonReaperDelay(state: GameState): number {
  return rules(state).reaperDelay;
}
