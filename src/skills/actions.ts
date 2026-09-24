import { type Enemy, type GameState, pushSfx } from "../core/state";
import { GOOD_STATUS_KINDS, NEUTRAL_STATUS_KINDS, type StatusApply, type StatusKind } from "../core/status";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { STATUS } from "../data/tuning";
import { TRAIT_COLORS, TRAIT_COLOR_HEX, type TraitColor } from "../loot/types";
import { healPlayer } from "../system/combat";
import { addFloatingText, shake, spawnBurst, spawnLine, spawnRing } from "../system/effects";
import { moveBody, overlapsWall } from "../system/physics";
import { blastMulAt } from "../system/blast";
import { applyStatus, enemiesInRadius, findStatus, hasStatus, removeStatus } from "../system/statusEffects";
import { SKILL } from "./data";
import { distToSegment, enemiesInCone, enemiesOnSegment, enemyNear, rayEnd } from "./geom";
import { skillHit, skillPower } from "./hit";
import { PIERCE_ALL, type ShotSpec, harmfulKinds, spawnFan, spawnShot } from "./shots";
import { placeGrave, placeKeg, placeSpring, placeTurret, startBoneRing } from "./summons";
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

type ExtraActiveKey = Extract<
  ActiveCast["skillKey"],
  "dregsBlade" | "comboChain" | "guillotine" | "stomp" | "threadReel" | "meteorDive" | "swallowFlip"
>;

const COLOR_CONTAGION = "#b0ff60";
const COLOR_KINDLE = "#ff8030";
const COLOR_MOON = "#e0f0ff";
const COLOR_BLADE = "#e0e0e0";
const COLOR_SHADOW = "#6040a0";
const COLOR_ICE = "#a0e0ff";
const COLOR_BLOOD = "#c02040";
const COLOR_SHOCK = "#ffff60";
const COLOR_VERDICT = "#d0a0ff";
const COLOR_THRUST = "#ffffff";
const COLOR_GRUDGE = "#ff4060";
const COLOR_STOMP = "#d0a060";
const COLOR_THREAD = "#e0d0b0";
const COLOR_METEOR = "#ffb060";
const COLOR_SWALLOW = "#c0e0ff";
const COLOR_SCAR = "#ff80a0";
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
  threadReel: SKILL.threadReel.maxRange,
  meteorDive: SKILL.meteorDive.maxRange,
  turret: SKILL.turret.maxRange,
  shadowStep: SKILL.shadowStep.maxRange,
};

// ---------------------------------------------------------------------------
// 発動前の確認（払う前に弾く。対象がいない消費系・影渡りは何も払わない）
// ---------------------------------------------------------------------------

/** 撃てない理由（浮き文字）。撃てるなら null。手動の発動だけが呼ぶ */
export function extraCastBlock(state: GameState, key: ExtraSkillKey, target: Vec, params: Readonly<CastParams>): string | null {
  switch (key) {
    case "shadowStep":
      return enemyNear(state, target, SKILL.shadowStep.pickRadius) ? null : "対象なし";
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
  prismShard: castPrism,
  fullMoon: castFullMoon,
  dregsBlade: (state, ctx) => timedOrInstant(state, ctx, "dregsBlade", SKILL.dregsBlade.duration * ctx.params.timeMul),
  shadowStep: castShadowStep,
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
  comboChain: (state, ctx) => timedOrInstant(state, ctx, "comboChain", comboChainStages(state, ctx.params) * SKILL.comboChain.gap * ctx.params.timeMul),
  grudge: castGrudge,
  guillotine: (state, ctx) => timedOrInstant(state, ctx, "guillotine", SKILL.guillotine.windup * ctx.params.timeMul),
  ricochet: (state, ctx) => spawnShot(state, ctx.origin, ctx.dir, ctx.params, shotSpec(state, ctx.params, "ricochet")),
  galeSlash: (state, ctx) => spawnShot(state, ctx.origin, ctx.dir, ctx.params, shotSpec(state, ctx.params, "gale")),
  scatterSigil: castScatter,
  stomp: castStomp,
  threadReel: (state, ctx) => timedOrInstant(state, ctx, "threadReel", SKILL.threadReel.delay * ctx.params.timeMul),
  meteorDive: (state, ctx) => timedOrInstant(state, ctx, "meteorDive", SKILL.meteorDive.air * ctx.params.timeMul),
  swallowFlip: (state, ctx) => timedOrInstant(state, ctx, "swallowFlip", SKILL.swallowFlip.time * ctx.params.timeMul),
  boneRing: (state, ctx) => startBoneRing(state, ctx.params),
  backflow: castBackflow,
  scarRoar: castScarRoar,
  manaSpring: (state, ctx) => placeSpring(state, ctx.origin, ctx.params),
  turret: (state, ctx) => placeTurret(state, ctx.target, ctx.params),
};

/** 射撃弾の仕様（効果ごとの数値を SKILL から引く） */
function shotSpec(state: GameState, params: CastParams, effect: "unravel" | "harvest" | "rout" | "strip" | "ricochet" | "gale"): ShotSpec {
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
    case "ricochet": {
      const r = SKILL.ricochet;
      return {
        effect,
        power: skillPower(state, r.damage, params),
        speed: r.speed,
        life: r.life,
        radius: r.radius,
        knockback: r.knockback,
        bounces: Math.max(0, r.bounces + params.countBonus),
      };
    }
    case "gale": {
      const g = SKILL.galeSlash;
      return {
        effect,
        power: skillPower(state, g.damage, params),
        speed: g.speed,
        life: (g.range * params.areaMul) / g.speed,
        radius: g.radius * params.areaMul,
        knockback: g.knockback,
        pierce: PIERCE_ALL,
      };
    }
  }
}

/** 本動作に時間がかかるスキル: 手動なら active に載せ、写しなら即時に結果だけ起こす */
function timedOrInstant(state: GameState, ctx: CastCtx, key: ExtraActiveKey, time: number): void {
  if (ctx.remote) {
    instantActive(state, ctx, key);
    return;
  }
  const target = key === "threadReel" || key === "meteorDive" ? ctx.target : add(ctx.origin, scale(ctx.dir, swallowDistance(state)));
  state.skills.active = {
    slot: ctx.slot,
    skillKey: key,
    phase: "main",
    timer: time,
    total: time,
    params: ctx.params,
    dir: { ...ctx.dir },
    origin: { ...ctx.origin },
    hitIds: new Set(),
    hitsDone: 0,
    startHp: state.player.hp,
    reach: 0,
    target: { ...target },
  };
  if (key === "meteorDive") spawnRing(state, ctx.target, meteorRadius(ctx.params), COLOR_METEOR, RING_LIFE);
}

function instantActive(state: GameState, ctx: CastCtx, key: ExtraActiveKey): void {
  const p = ctx.params;
  switch (key) {
    case "dregsBlade":
      for (let i = 0; i < dregsHitCount(p); i++) dregsHit(state, ctx.origin, ctx.dir, p);
      return;
    case "comboChain":
      for (let i = 0; i < comboChainStages(state, p); i++) thrust(state, ctx.origin, ctx.dir, p);
      return;
    case "guillotine":
      guillotineStrike(state, ctx.origin, ctx.dir, p);
      return;
    case "stomp":
      stompImpact(state, ctx.origin, p);
      return;
    case "threadReel":
      reel(state, ctx.target, ctx.origin, ctx.dir, p);
      return;
    case "meteorDive":
      meteorImpact(state, ctx.target, p);
      return;
    case "swallowFlip": {
      const end = rayEnd(state, ctx.origin, ctx.dir, swallowDistance(state));
      swallowSlash(state, ctx.origin, end, p, new Set());
      swallowSlash(state, end, ctx.origin, p, new Set());
      return;
    }
  }
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
  spawnRing(state, at, radius, COLOR_KINDLE, RING_LIFE * 2);
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

// ---- 五彩の礫 ----

/** 礫 i の色。支配 = 全部その色、二重・三和音 = 順番に、散光 = 1 個ずつ別の色、共鳴なし = 無色 */
export function prismColor(state: GameState, index: number, scatterStart: number): TraitColor | null {
  const r = state.stats.resonance;
  switch (r.kind) {
    case "dominant":
      return r.colors[0] ?? null;
    case "dual":
    case "triad":
      return r.colors[index % r.colors.length] ?? null;
    case "scatter":
      return TRAIT_COLORS[(scatterStart + index) % TRAIT_COLORS.length] ?? null;
    case "none":
      return null;
  }
}

function prismApplies(color: TraitColor | null): readonly StatusApply[] | null {
  const ps = SKILL.prismShard;
  switch (color) {
    case "crimson":
      return [{ kind: "bleed", stacks: 1, duration: ps.bleedTime, potency: ps.bleedPotency }];
    case "azure":
      return [{ kind: "shock", stacks: 1, duration: STATUS.shock.duration, potency: ps.shockPotency }];
    case "umbra":
      return [{ kind: "vulnerable", stacks: 1, duration: ps.vulnerableTime, potency: 0 }];
    case "jade":
    case "gold":
    case null:
      return null;
  }
}

function castPrism(state: GameState, ctx: CastCtx): void {
  const ps = SKILL.prismShard;
  const count = Math.max(1, ps.count + ctx.params.countBonus);
  const start = state.rng.int(0, TRAIT_COLORS.length - 1);
  const power = skillPower(state, ps.damage, ctx.params);
  spawnFan(state, ctx.origin, ctx.dir, ctx.params, count, ps.spreadRad, (i) => {
    const color = prismColor(state, i, start);
    return {
      effect: "prism",
      power,
      speed: ps.speed * (color === "azure" ? ps.azureSpeedMul : 1),
      life: ps.life,
      radius: ps.radius,
      knockback: ps.knockback,
      color: color ? TRAIT_COLOR_HEX[color] : undefined,
      pierce: color === "gold" ? ps.goldPierce : 0,
      applies: prismApplies(color),
      heal: color === "jade" ? ps.jadeHeal : 0,
    };
  });
}

// ---- 満月の砲 ----

/** 払ったマナに比例した太さ */
export function moonHalfWidth(params: Readonly<CastParams>): number {
  const m = SKILL.fullMoon;
  return (m.halfWidth + params.manaPaid * m.widthPerMana) * params.areaMul;
}

function castFullMoon(state: GameState, ctx: CastCtx): void {
  const m = SKILL.fullMoon;
  const end = rayEnd(state, ctx.origin, ctx.dir, m.maxLength, m.stepPx);
  const half = moonHalfWidth(ctx.params);
  const power = skillPower(state, m.damage, ctx.params) * (ctx.params.manaPaid / m.refMana);
  spawnLine(state, ctx.origin, end, COLOR_MOON, LINE_LIFE * 2);
  spawnBurst(state, ctx.origin, COLOR_MOON, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_HEAVY);
  pushSfx(state, "railshot");
  for (const e of enemiesOnSegment(state, ctx.origin, end, half)) {
    skillHit(state, e, ctx.params, { base: power, kind: "ranged", dir: ctx.dir, knockback: m.knockback, stagger: true, from: ctx.origin });
  }
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (distToSegment(pr.pos, ctx.origin, end) <= pr.radius + half) pr.life = 0;
  }
}

// ---- 枯渇の刃 ----

function dregsHitCount(params: Readonly<CastParams>): number {
  return Math.max(1, SKILL.dregsBlade.hits + params.countBonus);
}

function dregsHit(state: GameState, center: Vec, dir: Vec, params: CastParams): void {
  const d = SKILL.dregsBlade;
  const radius = d.radius * state.stats.meleeReachMul * params.areaMul;
  spawnRing(state, center, radius, COLOR_BLADE, RING_LIFE / 2);
  const power = skillPower(state, d.damage, params);
  for (const e of enemiesInCone(state, center, dir, radius, d.halfAngle)) {
    skillHit(state, e, params, { base: power, kind: "melee", dir: sub(e.body.pos, center), knockback: d.knockback, stagger: false, from: center });
  }
  pushSfx(state, "slash1");
}

// ---- 影渡り ----

function castShadowStep(state: GameState, ctx: CastCtx): void {
  if (ctx.remote) return;
  const s = SKILL.shadowStep;
  const target = enemyNear(state, ctx.target, s.pickRadius);
  if (!target) return;
  const p = state.player;
  const from = { ...p.body.pos };
  const dest = behindSpot(state, target);
  p.body.pos = dest;
  p.facing = normalize(sub(target.body.pos, dest), p.facing);
  p.invulnTimer = Math.max(p.invulnTimer, s.invuln);
  state.skills.backstabTimer = s.backstabTime * ctx.params.durationMul;
  spawnBurst(state, from, COLOR_SHADOW, BURST_PARTICLES, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
  spawnBurst(state, dest, COLOR_SHADOW, BURST_PARTICLES, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
  landingShock(state, dest, ctx.params);
}

/** 敵の向きの反対側。壁なら左右、それも駄目なら手前（自分側） */
function behindSpot(state: GameState, e: Enemy): Vec {
  const s = SKILL.shadowStep;
  const p = state.player;
  const gap = e.body.radius + p.body.radius + s.gap;
  const back = normalize(scale(e.facing, -1), sub(e.body.pos, p.body.pos));
  const side = { x: -back.y, y: back.x };
  const toMe = normalize(sub(p.body.pos, e.body.pos), back);
  for (const d of [back, side, scale(side, -1), toMe]) {
    const spot = add(e.body.pos, scale(d, gap));
    if (!overlapsWall(state, spot.x, spot.y, p.body.radius)) return spot;
  }
  return { ...p.body.pos };
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

// ---- 断頭振り ----

function guillotineStrike(state: GameState, origin: Vec, dir: Vec, params: CastParams): void {
  const g = SKILL.guillotine;
  const reach = state.stats.meleeReachMul * params.areaMul;
  const end = rayEnd(state, origin, dir, g.length * reach);
  const power = skillPower(state, g.damage, params);
  spawnLine(state, origin, end, COLOR_THRUST, LINE_LIFE * 2);
  shake(state, SHAKE_HEAVY);
  pushSfx(state, "slash3");
  for (const e of enemiesOnSegment(state, origin, end, g.halfWidth)) {
    const sweet = length(sub(e.body.pos, origin)) >= g.sweetFrom * reach;
    if (sweet) addFloatingText(state, e.body.pos, "刃先", COLOR_THRUST, TEXT_SCALE, TEXT_LIFE);
    skillHit(state, e, params, { base: power * (sweet ? g.sweetMul : 1), kind: "melee", dir, knockback: g.knockback, stagger: true, from: origin });
  }
}

// ---- 散弾符 ----

function castScatter(state: GameState, ctx: CastCtx): void {
  const s = SKILL.scatterSigil;
  const count = Math.max(2, s.count + ctx.params.countBonus);
  const volley = new Map<number, number>();
  const power = skillPower(state, s.damage, ctx.params);
  const spread = (s.fanRad * ctx.params.areaMul) / (count - 1);
  spawnFan(state, ctx.origin, ctx.dir, ctx.params, count, spread, () => ({
    effect: "scatter",
    power,
    speed: s.speed,
    life: s.life,
    radius: s.radius,
    knockback: s.knockback,
    volley,
  }));
  pushSfx(state, "shoot");
}

// ---- 震脚 ----

export function stompRadius(params: Readonly<CastParams>): number {
  return SKILL.stomp.radius * params.areaMul;
}

function castStomp(state: GameState, ctx: CastCtx): void {
  stompImpact(state, ctx.origin, ctx.params);
  if (ctx.remote) return;
  // 自分は少しの間動けない（本動作は終わっていて、硬直だけを active に載せる）
  const root = SKILL.stomp.root;
  timedOrInstant(state, ctx, "stomp", 0);
  const a = state.skills.active;
  if (!a) return;
  a.phase = "recover";
  a.timer = root;
  a.total = root;
}

function stompImpact(state: GameState, center: Vec, params: CastParams): void {
  const s = SKILL.stomp;
  const radius = stompRadius(params);
  spawnRing(state, center, radius, COLOR_STOMP, RING_LIFE * 2);
  spawnBurst(state, center, COLOR_STOMP, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_HEAVY);
  pushSfx(state, "explode");
  const power = skillPower(state, s.damage, params);
  for (const e of enemiesInRadius(state, center, radius)) {
    skillHit(state, e, params, { base: power, kind: "melee", dir: sub(e.body.pos, center), knockback: s.knockback, stagger: true, from: center });
  }
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0 || dist(pr.pos, center) > radius + pr.radius) continue;
    pr.life = 0;
  }
}

// ---- 手繰り糸 ----

/** 糸（target → anchor）に触れた敵を anchor の手前へ引き、当てる。ボスは引かない */
function reel(state: GameState, target: Vec, anchor: Vec, dir: Vec, params: CastParams): void {
  const t = SKILL.threadReel;
  const half = t.halfWidth * params.areaMul;
  spawnLine(state, target, anchor, COLOR_THREAD, LINE_LIFE * 2);
  pushSfx(state, "hitHeavy");
  const power = skillPower(state, t.damage, params);
  const toward = normalize(sub(target, anchor), dir);
  for (const e of enemiesOnSegment(state, target, anchor, half)) {
    if (state.boss?.enemyId !== e.id) {
      const gap = state.player.body.radius + e.body.radius + t.gap;
      const dest = add(anchor, scale(toward, gap));
      moveBody(state, e.body, dest.x - e.body.pos.x, dest.y - e.body.pos.y);
    }
    skillHit(state, e, params, { base: power, kind: "ranged", dir: scale(toward, -1), knockback: 0, stagger: true, from: anchor });
  }
}

// ---- 墜星 ----

export function meteorRadius(params: Readonly<CastParams>): number {
  return SKILL.meteorDive.radius * params.areaMul;
}

function meteorImpact(state: GameState, center: Vec, params: CastParams): void {
  const m = SKILL.meteorDive;
  const radius = meteorRadius(params);
  spawnRing(state, center, radius, COLOR_METEOR, RING_LIFE * 2);
  spawnBurst(state, center, COLOR_METEOR, BURST_PARTICLES * 2, BURST_SPEED * 1.5, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_HEAVY * 2);
  pushSfx(state, "explode");
  const power = skillPower(state, m.damage, params);
  for (const e of enemiesInRadius(state, center, radius)) {
    skillHit(state, e, params, { base: power, kind: "melee", dir: sub(e.body.pos, center), knockback: m.knockback, stagger: true, from: center });
  }
}

// ---- 燕返し ----

function swallowDistance(state: GameState): number {
  return SKILL.swallowFlip.distance * state.stats.dashDistanceMul;
}

/** from → to の斬撃。hitIds に入っていない敵に当てる */
function swallowSlash(state: GameState, from: Vec, to: Vec, params: CastParams, hitIds: Set<number>): void {
  const s = SKILL.swallowFlip;
  const power = skillPower(state, s.damage, params);
  const dir = normalize(sub(to, from), state.player.facing);
  spawnLine(state, from, to, COLOR_SWALLOW, LINE_LIFE);
  for (const e of enemiesOnSegment(state, from, to, s.halfWidth * params.areaMul)) {
    if (hitIds.has(e.id)) continue;
    hitIds.add(e.id);
    skillHit(state, e, params, { base: power, kind: "melee", dir, knockback: s.knockback, stagger: true, from });
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
  spawnBurst(state, from, COLOR_SWALLOW, BURST_PARTICLES, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
  const power = skillPower(state, b.damage, ctx.params);
  const dir = normalize(sub(p.body.pos, from), p.facing);
  spawnLine(state, from, p.body.pos, COLOR_SWALLOW, LINE_LIFE * 2);
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

/** 大拡張の本動作の移動倍率 */
export function extraActiveMoveMul(a: Readonly<ActiveCast>): number {
  switch (a.skillKey) {
    case "dregsBlade":
      return a.phase === "main" ? SKILL.whirl.moveMul : 1;
    default:
      return 0;
  }
}

function toRecover(a: ActiveCast, time: number): void {
  a.phase = "recover";
  a.timer = time;
  a.total = time;
}

/** 硬直中なら時間を進めて true（終われば active を外す） */
function stepRecover(state: GameState, a: ActiveCast, dt: number): boolean {
  if (a.phase !== "recover") return false;
  a.timer -= dt;
  if (a.timer <= 0) state.skills.active = null;
  return true;
}

/** active.skillKey が大拡張のものなら進めて true */
export function updateExtraActive(state: GameState, a: ActiveCast, dt: number): boolean {
  switch (a.skillKey) {
    case "dregsBlade":
      updateDregs(state, a, dt);
      return true;
    case "comboChain":
      updateComboChain(state, a, dt);
      return true;
    case "guillotine":
      updateGuillotine(state, a, dt);
      return true;
    case "stomp":
      stepRecover(state, a, dt);
      return true;
    case "threadReel":
      updateThreadReel(state, a, dt);
      return true;
    case "meteorDive":
      updateMeteor(state, a, dt);
      return true;
    case "swallowFlip":
      updateSwallow(state, a, dt);
      return true;
    default:
      return false;
  }
}

function updateDregs(state: GameState, a: ActiveCast, dt: number): void {
  if (stepRecover(state, a, dt)) return;
  a.timer -= dt;
  const hits = dregsHitCount(a.params);
  const interval = a.total / hits;
  const elapsed = a.total - a.timer;
  while (a.hitsDone < hits && elapsed >= a.hitsDone * interval) {
    dregsHit(state, state.player.body.pos, state.player.facing, a.params);
    a.hitsDone += 1;
  }
  if (a.timer <= 0) toRecover(a, SKILL.dregsBlade.recover);
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

/** 溜め中は照準に追従し、溜め終わりで振り下ろす */
function updateGuillotine(state: GameState, a: ActiveCast, dt: number): void {
  if (stepRecover(state, a, dt)) return;
  a.dir = { ...state.player.facing };
  a.timer -= dt;
  if (a.timer > 0) return;
  guillotineStrike(state, state.player.body.pos, a.dir, a.params);
  toRecover(a, SKILL.guillotine.recover);
}

function updateThreadReel(state: GameState, a: ActiveCast, dt: number): void {
  if (stepRecover(state, a, dt)) return;
  a.timer -= dt;
  if (a.timer > 0) return;
  reel(state, a.target, state.player.body.pos, a.dir, a.params);
  toRecover(a, SKILL.threadReel.recover);
}

/** 空中の間は動けない。落ちた瞬間に落下点へ移って周りを打つ */
function updateMeteor(state: GameState, a: ActiveCast, dt: number): void {
  a.timer -= dt;
  if (a.timer > 0) return;
  const p = state.player;
  state.skills.active = null;
  if (!overlapsWall(state, a.target.x, a.target.y, p.body.radius)) p.body.pos = { ...a.target };
  meteorImpact(state, p.body.pos, a.params);
  landingShock(state, p.body.pos, a.params);
  // 連携（墜星 → 地裂き）の受付は着地から数える
  const last = state.skills.lastCast;
  if (last && last.skillKey === "meteorDive") last.at = state.skills.clock;
}

/** 行きは突進のように当て、着地の瞬間に元の位置へ向けて斬撃が戻る */
function updateSwallow(state: GameState, a: ActiveCast, dt: number): void {
  const p = state.player;
  const total = Math.max(a.total, Number.EPSILON);
  const speed = swallowDistance(state) / total;
  const step = speed * Math.min(dt, Math.max(0, a.timer));
  a.timer -= dt;
  const before = { ...p.body.pos };
  const hit = moveBody(state, p.body, a.dir.x * step, a.dir.y * step);
  swallowSlash(state, before, p.body.pos, a.params, a.hitIds);
  if (a.timer > 0 && !hit.hitX && !hit.hitY) return;
  state.skills.active = null;
  swallowSlash(state, p.body.pos, a.origin, a.params, new Set());
  pushSfx(state, "slash3");
  landingShock(state, p.body.pos, a.params);
}
