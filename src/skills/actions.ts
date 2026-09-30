import { type Enemy, type GameState, pushSfx } from "../core/state";
import { GOOD_STATUS_KINDS, NEUTRAL_STATUS_KINDS, type StatusApply, type StatusKind } from "../core/status";
import { type Vec, add, normalize, scale, sub } from "../core/vec";
import { STATUS } from "../data/tuning";
import { healPlayer } from "../system/combat";
import { addFloatingText, shake, spawnBlast, spawnBurst, spawnLine, spawnRing } from "../system/effects";
import { overlapsWall } from "../system/physics";
import { blastMulAt } from "../system/blast";
import { applyStatus, enemiesInRadius, findStatus, hasStatus, removeStatus } from "../system/statusEffects";
import { SKILL } from "./data";
import { enemiesInCone, enemiesOnSegment, enemyNear, rayEnd } from "./geom";
import { skillHit, skillPower } from "./hit";
import { type ShotSpec, harmfulKinds, spawnFan, spawnShot } from "./shots";
import { placeGrave, placeKeg, placeSpring, placeTurret } from "./summons";
import type { ActiveCast, CastParams, ExtraSkillKey } from "./types";

/**
 * 大拡張のスキルの発動（docs/ideas/skills-expansion.md 1 章）。
 * どのスキルも「発動地点・向き・照準地点」を受け取り、remote（反響・遅延・投げ刃・散り際）ならプレイヤーを動かさず
 * その地点で即時に起こす。時間のかかる本動作は SkillRunState.active に載せ、updateExtraActive が進める。
 */

export interface CastCtx {
  slot: number;
  params: CastParams;
  origin: Vec;
  dir: Vec;
  target: Vec;
  /** 反響・遅延・投げ刃・散り際の写し（プレイヤーを動かさない・本動作を待たない） */
  remote: boolean;
}

const COLOR_CONTAGION = "#b0ff60";
const COLOR_KINDLE = "#ff8030";
const COLOR_ICE = "#a0e0ff";
const COLOR_BLOOD = "#c02040";
/** 放電の雷の線の色（render/fxAttack.ts が稲妻として描く色に数える） */
export const COLOR_SHOCK = "#ffff60";
const COLOR_VERDICT = "#d0a0ff";
const COLOR_THRUST = "#ffffff";
const COLOR_GRUDGE = "#ff4060";
const COLOR_SCAR = "#ff80a0";
const COLOR_REWIND = "#c0e0ff";
const COLOR_LANDING = "#d0b070";

const RING_LIFE = 0.2;
const LINE_LIFE = 0.15;
const BURST_PARTICLES = 12;
const BURST_SPEED = 120;
const BURST_LIFE = 0.35;
const BURST_SIZE = 2;
const SMALL_PARTICLES = 4;
const TEXT_SCALE = 1;
const TEXT_LIFE = 0.6;
const SHAKE_HEAVY = 4;
const SHAKE_LIGHT = 2;

/** 照準地点を使うスキルの最大射程（system/skills.ts の CAST_RANGE に足す） */
export const EXTRA_CAST_RANGE: Partial<Record<ExtraSkillKey, number>> = {
  contagion: SKILL.contagion.maxRange,
  kindle: SKILL.kindle.maxRange,
  powderKeg: SKILL.powderKeg.maxRange,
  swordGrave: SKILL.swordGrave.maxRange,
  turret: SKILL.turret.maxRange,
};

// ---------------------------------------------------------------------------
// 発動前の確認（払う前に弾く。対象がいない消費系は何も払わない）
// ---------------------------------------------------------------------------

/** 撃てない理由（浮き文字）。撃てるなら null。手動の発動だけが呼ぶ */
export function extraCastBlock(state: GameState, key: ExtraSkillKey, target: Vec, params: Readonly<CastParams>): string | null {
  switch (key) {
    case "contagion": {
      const src = enemyNear(state, target, SKILL.contagion.pickRadius);
      return src && harmfulKinds(src).length > 0 ? null : "対象なし";
    }
    case "kindle":
      return enemiesInRadius(state, target, SKILL.kindle.radius * params.areaMul).some((e) => hasStatus(e.status, "burn")) ? null : "燃焼なし";
    case "bloodlet":
      return enemiesInRadius(state, state.player.body.pos, SKILL.bloodlet.radius * params.areaMul).some((e) => hasStatus(e.status, "bleed"))
        ? null
        : "出血なし";
    case "discharge":
      return shockedInRange(state, state.player.body.pos, params).length > 0 ? null : "感電なし";
    case "backflow":
      return rewindEntry(state) ? null : "戻り先なし";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 発動
// ---------------------------------------------------------------------------

type ExtraCastFn = (state: GameState, ctx: CastCtx) => void;

export const EXTRA_CAST: Record<ExtraSkillKey, ExtraCastFn> = {
  contagion: castContagion,
  unravel: (state, ctx) => spawnShot(state, ctx.origin, ctx.dir, ctx.params, shotSpec(state, ctx.params, "unravel")),
  kindle: castKindle,
  powderKeg: (state, ctx) => placeKeg(state, ctx.target, ctx.params),
  swordGrave: (state, ctx) => placeGrave(state, ctx.target, ctx.params),
  iceBreaker: castIceBreaker,
  bloodlet: castBloodlet,
  harvest: (state, ctx) => spawnShot(state, ctx.origin, ctx.dir, ctx.params, shotSpec(state, ctx.params, "harvest")),
  discharge: castDischarge,
  rout: (state, ctx) =>
    spawnFan(state, ctx.origin, ctx.dir, ctx.params, Math.max(1, SKILL.rout.count + ctx.params.countBonus), SKILL.rout.spreadRad, () =>
      shotSpec(state, ctx.params, "rout"),
    ),
  verdict: castVerdict,
  exploit: castExploit,
  strip: (state, ctx) => spawnShot(state, ctx.origin, ctx.dir, ctx.params, shotSpec(state, ctx.params, "strip")),
  lastStand: castLastStand,
  comboChain: castComboChain,
  grudge: castGrudge,
  backflow: castBackflow,
  scarRoar: castScarRoar,
  manaSpring: (state, ctx) => placeSpring(state, ctx.origin, ctx.params),
  turret: (state, ctx) => placeTurret(state, ctx.target, ctx.params),
};

/** 射撃弾の仕様（効果ごとの数値を SKILL から引く） */
function shotSpec(state: GameState, params: CastParams, effect: "unravel" | "harvest" | "rout" | "strip"): ShotSpec {
  switch (effect) {
    case "unravel": {
      const u = SKILL.unravel;
      return { effect, power: skillPower(state, u.damage, params), speed: u.speed, life: u.life, radius: u.radius, knockback: u.knockback };
    }
    case "harvest": {
      const h = SKILL.harvest;
      return { effect, power: skillPower(state, h.damage, params), speed: h.speed, life: h.life, radius: h.radius, knockback: h.knockback };
    }
    case "rout": {
      const r = SKILL.rout;
      return { effect, power: skillPower(state, r.damage, params), speed: r.speed, life: r.life, radius: r.radius, knockback: r.knockback };
    }
    case "strip": {
      const s = SKILL.strip;
      return { effect, power: skillPower(state, s.damage, params), speed: s.speed, life: s.life, radius: s.radius, knockback: s.knockback };
    }
  }
}

/** 連環撃: 手動なら段ごとに時間をかけて突く本動作を active に載せ、写しなら即時に全段を突く */
function castComboChain(state: GameState, ctx: CastCtx): void {
  const stages = comboChainStages(state, ctx.params);
  if (ctx.remote) {
    for (let i = 0; i < stages; i++) thrust(state, ctx.origin, ctx.dir, ctx.params);
    return;
  }
  const time = stages * SKILL.comboChain.gap * ctx.params.timeMul;
  state.skills.active = {
    slot: ctx.slot,
    skillKey: "comboChain",
    phase: "main",
    timer: time,
    total: time,
    params: ctx.params,
    dir: { ...ctx.dir },
    origin: { ...ctx.origin },
    hitIds: new Set(),
    hitsDone: 0,
    reach: 0,
  };
}

// ---- 伝染 ----

function castContagion(state: GameState, ctx: CastCtx): void {
  const c = SKILL.contagion;
  const src = enemyNear(state, ctx.target, c.pickRadius);
  if (!src) return;
  const radius = c.radius * ctx.params.areaMul;
  const effects = src.status.effects.filter((eff) => eff.time > 0 && harmfulKinds(src).includes(eff.kind));
  spawnRing(state, src.body.pos, radius, COLOR_CONTAGION, RING_LIFE * 2);
  pushSfx(state, "skillCast");
  for (const e of enemiesInRadius(state, src.body.pos, radius)) {
    if (e.id === src.id) continue;
    spawnLine(state, src.body.pos, e.body.pos, COLOR_CONTAGION, LINE_LIFE);
    for (const eff of effects) {
      const duration = Math.max(c.minDuration, eff.time * c.durationMul * ctx.params.durationMul);
      // 彩痕の potency は色の番号なので効果量を掛けない
      const potency = eff.kind === "hue" ? eff.potency : eff.potency * ctx.params.potencyMul;
      applyStatus(state, { kind: "enemy", enemy: e }, { kind: eff.kind, stacks: eff.stacks, duration, potency }, "player");
    }
  }
}

// ---- 燃え種爆ぜ ----

function castKindle(state: GameState, ctx: CastCtx): void {
  const k = SKILL.kindle;
  const radius = k.radius * ctx.params.areaMul;
  spawnRing(state, ctx.target, radius, COLOR_KINDLE, RING_LIFE);
  const burning = enemiesInRadius(state, ctx.target, radius).filter((e) => hasStatus(e.status, "burn"));
  for (const e of burning) {
    const burn = findStatus(e.status, "burn");
    if (!burn) continue;
    const remaining = burn.potency * burn.time;
    const at = { ...e.body.pos };
    removeStatus(state, { kind: "enemy", enemy: e }, "burn");
    kindleBurst(state, at, remaining, ctx.params);
  }
}

/** 燃焼 1 体ぶんの爆発。残りの燃焼が多いほど強く怯ませる */
function kindleBurst(state: GameState, at: Vec, remaining: number, params: CastParams): void {
  const k = SKILL.kindle;
  const radius = k.burstRadius * params.areaMul;
  spawnBlast(state, at, radius, COLOR_KINDLE, RING_LIFE * 2);
  spawnBurst(state, at, COLOR_KINDLE, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_LIGHT);
  pushSfx(state, "explode");
  const power = skillPower(state, k.damage, params) + remaining * k.burnRatio * params.damageMul;
  const poise = Math.min(k.maxPoise, k.poise + remaining * k.poisePerBurn);
  for (const e of enemiesInRadius(state, at, radius)) {
    const mul = blastMulAt(at, radius, e.body.pos, e.body.radius);
    skillHit(state, e, params, { base: power * mul, kind: "ranged", dir: sub(e.body.pos, at), knockback: k.knockback * mul, stagger: true, poise: poise * mul, from: at });
  }
}

// ---- 砕氷槌 ----

function castIceBreaker(state: GameState, ctx: CastCtx): void {
  const ib = SKILL.iceBreaker;
  const radius = ib.radius * state.stats.meleeReachMul * ctx.params.areaMul;
  const chill = ib.chillStacks + (ctx.params.combo === "frostBreaker" ? ib.comboChill : 0);
  const applies: readonly StatusApply[] = [{ kind: "chill", stacks: chill, duration: STATUS.chill.duration, potency: 0 }];
  const power = skillPower(state, ib.damage, ctx.params);
  spawnRing(state, add(ctx.origin, scale(ctx.dir, radius / 2)), radius / 2, COLOR_ICE, RING_LIFE);
  shake(state, SHAKE_LIGHT);
  pushSfx(state, "hitHeavy");
  for (const e of enemiesInCone(state, ctx.origin, ctx.dir, radius, ib.halfAngle)) {
    const frozen = hasStatus(e.status, "freeze");
    const at = { ...e.body.pos };
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: sub(e.body.pos, ctx.origin), knockback: ib.knockback, stagger: true, applies, from: ctx.origin });
    if (frozen) iceShards(state, at, e.id, ctx.params, applies);
  }
}

/** 凍結を砕いた破片: 周りの敵へ小さなダメージと冷気 */
function iceShards(state: GameState, at: Vec, excludeId: number, params: CastParams, applies: readonly StatusApply[]): void {
  const ib = SKILL.iceBreaker;
  spawnBurst(state, at, COLOR_ICE, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  pushSfx(state, "freeze");
  const power = skillPower(state, ib.shardDamage, params);
  for (const e of enemiesInRadius(state, at, ib.shardRadius * params.areaMul)) {
    if (e.id === excludeId) continue;
    skillHit(state, e, params, { base: power, kind: "ranged", dir: sub(e.body.pos, at), knockback: 0, stagger: false, poise: 0, applies, from: at });
  }
}

// ---- 血抜き ----

function castBloodlet(state: GameState, ctx: CastCtx): void {
  const b = SKILL.bloodlet;
  const radius = b.radius * ctx.params.areaMul;
  const power = skillPower(state, b.damage, ctx.params);
  let drained = 0;
  spawnRing(state, ctx.origin, radius, COLOR_BLOOD, RING_LIFE);
  for (const e of enemiesInRadius(state, ctx.origin, radius)) {
    const bleed = findStatus(e.status, "bleed");
    if (bleed) {
      drained += bleed.stacks * bleed.potency;
      spawnLine(state, e.body.pos, ctx.origin, COLOR_BLOOD, LINE_LIFE);
      removeStatus(state, { kind: "enemy", enemy: e }, "bleed");
    }
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: sub(e.body.pos, ctx.origin), knockback: b.knockback, stagger: false, from: ctx.origin });
  }
  if (drained <= 0) return;
  const heal = Math.min(drained * b.healPerStack * ctx.params.potencyMul, state.player.maxHp * b.healCapRatio);
  healPlayer(state, heal);
}

// ---- 放電 ----

function shockedInRange(state: GameState, center: Vec, params: Readonly<CastParams>): Enemy[] {
  return enemiesInRadius(state, center, SKILL.discharge.range * params.areaMul).filter((e) => hasStatus(e.status, "shock"));
}

function castDischarge(state: GameState, ctx: CastCtx): void {
  const d = SKILL.discharge;
  const shocked = shockedInRange(state, ctx.origin, ctx.params);
  const base = skillPower(state, d.damage, ctx.params);
  const lineHit = new Set<number>(shocked.map((e) => e.id));
  pushSfx(state, "shock");
  for (const e of shocked) {
    const stacks = findStatus(e.status, "shock")?.stacks ?? 1;
    const from = { ...e.body.pos };
    removeStatus(state, { kind: "enemy", enemy: e }, "shock");
    spawnLine(state, from, ctx.origin, COLOR_SHOCK, LINE_LIFE);
    skillHit(state, e, ctx.params, { base: base * (1 + d.perStack * stacks), kind: "ranged", dir: sub(from, ctx.origin), knockback: d.knockback, stagger: true, from: ctx.origin });
    for (const other of enemiesOnSegment(state, from, ctx.origin, d.lineHalfWidth)) {
      if (lineHit.has(other.id)) continue;
      lineHit.add(other.id);
      skillHit(state, other, ctx.params, { base: base * d.lineMul, kind: "ranged", dir: sub(other.body.pos, from), knockback: 0, stagger: false, from });
    }
  }
}

// ---- 処断 ----

function castVerdict(state: GameState, ctx: CastCtx): void {
  const v = SKILL.verdict;
  const radius = v.radius * state.stats.meleeReachMul * ctx.params.areaMul;
  const power = skillPower(state, v.damage, ctx.params);
  pushSfx(state, "slash3");
  for (const e of enemiesInCone(state, ctx.origin, ctx.dir, radius, v.halfAngle)) {
    const dir = sub(e.body.pos, ctx.origin);
    if (hasStatus(e.status, "silence")) {
      removeStatus(state, { kind: "enemy", enemy: e }, "silence");
      addFloatingText(state, e.body.pos, "処断", COLOR_VERDICT, TEXT_SCALE, TEXT_LIFE);
      skillHit(state, e, ctx.params, { base: power, kind: "melee", dir, knockback: v.knockback, stagger: true, applies: null, from: ctx.origin });
      continue;
    }
    skillHit(state, e, ctx.params, { base: power * v.unsilencedMul, kind: "melee", dir, knockback: 0, stagger: false, poise: v.unsilencedPoise, from: ctx.origin });
  }
  spawnRing(state, add(ctx.origin, scale(ctx.dir, radius / 2)), radius / 2, COLOR_VERDICT, RING_LIFE);
}

// ---- 突き（刺し穿ち・背水の一閃・連環撃） ----

function thrustEnd(state: GameState, origin: Vec, dir: Vec, length: number, params: Readonly<CastParams>): Vec {
  return rayEnd(state, origin, dir, length * state.stats.meleeReachMul * params.areaMul);
}

function castExploit(state: GameState, ctx: CastCtx): void {
  const x = SKILL.exploit;
  const end = thrustEnd(state, ctx.origin, ctx.dir, x.length, ctx.params);
  const power = skillPower(state, x.damage, ctx.params);
  const shadow = ctx.params.combo === "shadowExploit";
  spawnLine(state, ctx.origin, end, COLOR_THRUST, LINE_LIFE);
  pushSfx(state, "slash2");
  for (const e of enemiesOnSegment(state, ctx.origin, end, x.halfWidth)) {
    const vulnerable = hasStatus(e.status, "vulnerable");
    if (vulnerable) removeStatus(state, { kind: "enemy", enemy: e }, "vulnerable");
    const sure = vulnerable || shadow;
    skillHit(state, e, ctx.params, {
      base: power,
      kind: "melee",
      dir: ctx.dir,
      knockback: x.knockback,
      stagger: sure,
      poise: sure ? x.poise * x.poiseMul : undefined,
      forceCrit: sure,
      from: ctx.origin,
    });
  }
}

/** 背水の一閃の威力倍率: 失った HP の割合で伸び、fullAt で最大 */
export function lastStandMul(state: GameState): number {
  const l = SKILL.lastStand;
  const p = state.player;
  const missing = p.maxHp > 0 ? 1 - p.hp / p.maxHp : 0;
  return 1 + l.maxBonus * Math.min(1, Math.max(0, missing) / l.fullAt);
}

function castLastStand(state: GameState, ctx: CastCtx): void {
  const l = SKILL.lastStand;
  const end = thrustEnd(state, ctx.origin, ctx.dir, l.length, ctx.params);
  const power = skillPower(state, l.damage, ctx.params) * lastStandMul(state);
  spawnLine(state, ctx.origin, end, COLOR_GRUDGE, LINE_LIFE * 2);
  shake(state, SHAKE_LIGHT);
  pushSfx(state, "slash3");
  for (const e of enemiesOnSegment(state, ctx.origin, end, l.halfWidth)) {
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: ctx.dir, knockback: l.knockback, stagger: true, from: ctx.origin });
  }
}

/** 連環撃の段数: コンボ comboPerStage ごとに +1（上限あり） */
export function comboChainStages(state: GameState, params: Readonly<CastParams>): number {
  const c = SKILL.comboChain;
  const stages = 1 + Math.floor(state.combo.count / c.comboPerStage) + params.countBonus;
  return Math.max(1, Math.min(c.maxStages, stages));
}

/** 1 段の突き。誰にも当たらなければコンボが途切れる（外したときの代償） */
function thrust(state: GameState, origin: Vec, dir: Vec, params: CastParams): void {
  const c = SKILL.comboChain;
  const end = thrustEnd(state, origin, dir, c.length, params);
  spawnLine(state, origin, end, COLOR_THRUST, LINE_LIFE);
  pushSfx(state, "slash1");
  const hits = enemiesOnSegment(state, origin, end, c.halfWidth);
  if (hits.length === 0) {
    state.combo.count = 0;
    state.combo.timer = 0;
    return;
  }
  const power = skillPower(state, c.damage, params);
  for (const e of hits) skillHit(state, e, params, { base: power, kind: "melee", dir, knockback: c.knockback, stagger: false, from: origin });
}

// ---- 恨み返し ----

/** 直近 window 秒に受けたダメージの合計 */
export function recentHurt(state: GameState): number {
  const rs = state.skills;
  const since = rs.clock - SKILL.grudge.window;
  return rs.hurtLog.reduce((sum, h) => (h.at >= since ? sum + h.amount : sum), 0);
}

function castGrudge(state: GameState, ctx: CastCtx): void {
  const g = SKILL.grudge;
  const hurt = ctx.remote ? 0 : recentHurt(state);
  // 返したぶんは消える（連打で同じ被ダメを何度も返さない）
  if (!ctx.remote) state.skills.hurtLog = [];
  const radius = g.radius * state.stats.meleeReachMul * ctx.params.areaMul;
  const power = skillPower(state, g.damage, ctx.params) + hurt * g.hurtMul * ctx.params.damageMul;
  const poise = Math.min(g.maxPoise, g.poise + hurt * g.poisePerHurt);
  spawnRing(state, add(ctx.origin, scale(ctx.dir, radius / 2)), radius / 2, COLOR_GRUDGE, RING_LIFE * 2);
  if (hurt > 0) shake(state, SHAKE_HEAVY);
  pushSfx(state, hurt > 0 ? "hitHeavy" : "slash2");
  for (const e of enemiesInCone(state, ctx.origin, ctx.dir, radius, g.halfAngle)) {
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: sub(e.body.pos, ctx.origin), knockback: g.knockback, stagger: hurt > 0, poise, from: ctx.origin });
  }
}

// ---- 巻き戻し ----

/** 巻き戻し先: rewind 秒前にいちばん近い履歴（無ければ null） */
export function rewindEntry(state: GameState): { pos: Vec; hp: number } | null {
  const rs = state.skills;
  const since = rs.clock - SKILL.backflow.rewind;
  return rs.history.find((h) => h.at >= since) ?? null;
}

function castBackflow(state: GameState, ctx: CastCtx): void {
  if (ctx.remote) return;
  const b = SKILL.backflow;
  const entry = rewindEntry(state);
  if (!entry) return;
  const p = state.player;
  const from = { ...p.body.pos };
  if (!overlapsWall(state, entry.pos.x, entry.pos.y, p.body.radius)) p.body.pos = { ...entry.pos };
  p.invulnTimer = Math.max(p.invulnTimer, b.invuln);
  const lost = entry.hp - p.hp;
  if (lost > 0) healPlayer(state, lost * b.healRatio * ctx.params.potencyMul);
  state.skills.history = [];
  spawnBurst(state, from, COLOR_REWIND, BURST_PARTICLES, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
  const power = skillPower(state, b.damage, ctx.params);
  const dir = normalize(sub(p.body.pos, from), p.facing);
  spawnLine(state, from, p.body.pos, COLOR_REWIND, LINE_LIFE * 2);
  for (const e of enemiesOnSegment(state, from, p.body.pos, b.halfWidth * ctx.params.areaMul)) {
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir, knockback: b.knockback, stagger: false, from });
  }
  landingShock(state, p.body.pos, ctx.params);
}

// ---- 傷返し ----

function castScarRoar(state: GameState, ctx: CastCtx): void {
  const s = SKILL.scarRoar;
  const p = state.player;
  const effects = p.status.effects.filter((eff) => eff.time > 0 && harmfulKind(eff.kind));
  for (const eff of effects) removeStatus(state, { kind: "player" }, eff.kind);
  const kinds = Math.max(1, effects.length);
  const radius = s.radius * ctx.params.areaMul;
  const power = skillPower(state, s.damage, ctx.params) * kinds;
  spawnRing(state, ctx.origin, radius, COLOR_SCAR, RING_LIFE * 2);
  shake(state, SHAKE_HEAVY);
  pushSfx(state, "explode");
  if (effects.length > 0) addFloatingText(state, p.body.pos, `傷返し ${effects.length}`, COLOR_SCAR, TEXT_SCALE, TEXT_LIFE);
  for (const e of enemiesInRadius(state, ctx.origin, radius)) {
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: sub(e.body.pos, ctx.origin), knockback: s.knockback, stagger: true, poise: s.poise * kinds, from: ctx.origin });
    for (const eff of effects) {
      applyStatus(state, { kind: "enemy", enemy: e }, { kind: eff.kind, stacks: eff.stacks, duration: Math.max(s.minDuration, eff.time), potency: eff.potency }, "player");
    }
  }
}

/** 悪い状態異常か（良い状態・怯み・堅守は剥がさない） */
function harmfulKind(kind: StatusKind): boolean {
  return !GOOD_STATUS_KINDS.has(kind) && !NEUTRAL_STATUS_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// 着地衝撃（刻印符）
// ---------------------------------------------------------------------------

export function landingShock(state: GameState, pos: Vec, params: CastParams): void {
  if (!params.landing) return;
  const l = SKILL.modifier.landing;
  spawnRing(state, pos, l.radius, COLOR_LANDING, RING_LIFE);
  spawnBurst(state, pos, COLOR_LANDING, SMALL_PARTICLES, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
  const power = skillPower(state, l.damage, params);
  for (const e of enemiesInRadius(state, pos, l.radius)) {
    skillHit(state, e, params, { base: power, kind: "melee", dir: sub(e.body.pos, pos), knockback: l.knockback, stagger: true, poise: l.poise, applies: null, from: pos });
  }
}

// ---------------------------------------------------------------------------
// 発動中の更新
// ---------------------------------------------------------------------------

/** active.skillKey が大拡張のもの（連環撃）なら進めて true */
export function updateExtraActive(state: GameState, a: ActiveCast, dt: number): boolean {
  if (a.skillKey !== "comboChain") return false;
  updateComboChain(state, a, dt);
  return true;
}

function updateComboChain(state: GameState, a: ActiveCast, dt: number): void {
  a.timer -= dt;
  const gap = SKILL.comboChain.gap * a.params.timeMul;
  const stages = Math.max(1, Math.round(a.total / Math.max(gap, Number.EPSILON)));
  const elapsed = a.total - a.timer;
  while (a.hitsDone < stages && elapsed >= a.hitsDone * gap) {
    thrust(state, state.player.body.pos, state.player.facing, a.params);
    a.hitsDone += 1;
  }
  if (a.timer <= 0 && a.hitsDone >= stages) state.skills.active = null;
}
