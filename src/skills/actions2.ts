import { type Enemy, type GameState, allocId, pushSfx } from "../core/state";
import type { Element } from "../core/element";
import type { StatusApply } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { enemyCombat } from "../data/enemyCombat";
import { JOBS } from "../data/jobs";
import { STATUS } from "../data/tuning";
import { MOVESETS, type MovesetKey } from "../data/weapons";
import { type Scaling, TRAIT_COLORS, type TraitColor } from "../loot/types";
import { TILE_SIZE } from "../map/grid";
import { cancelAttack } from "../system/combat";
import { addFloatingText, shake, spawnBurst, spawnLine, spawnRing } from "../system/effects";
import { moveBody } from "../system/physics";
import { applyStagger, isStaggered } from "../system/poise";
import { applyStatus, convertStatus, enemiesInRadius, findStatus, hasStatus, removeStatus } from "../system/statusEffects";
import { placeTerrain, terrainAt } from "../system/terrain";
import { type CastCtx, landingShock } from "./actions";
import { SKILL } from "./data";
import { enemiesInCone, enemiesOnSegment, enemyNear, rayEnd } from "./geom";
import { resonanceHueIndex, skillHit, skillPower } from "./hit";
import { spawnFan, spawnShot } from "./shots";
import { FORM_TUNING as F, WAVE2_COMBO_TUNING as C2, WEAPON_ART, WEAPON_ART_BLEED } from "./tuning2";
import type { ActiveCast, CastParams, FormSkillKey, Wave2SkillKey, WardStake } from "./types";
import { carryContractPatch } from "../system/contractors";

/**
 * スキル第 2 弾の発動（地形・新しい状態異常・属性・武器種・変身・空間。docs/ideas/skills-expansion.md）。
 * actions.ts と同じく「発動地点・向き・照準地点」を受け取り、remote（反響・遅延・投げ刃・散り際・罠）なら
 * プレイヤーを動かさずその地点で即時に起こす。変身は remote だと衝撃だけ（変身しない）。
 * 地形は system/terrain.ts の placeTerrain / terrainAt を呼ぶだけ（地形の規則はあちらが持つ）
 */

const COLOR_WATER = "#60a0ff";
const COLOR_OIL = "#806040";
const COLOR_FIRE = "#ff7030";
const COLOR_ICE = "#a0e0ff";
const COLOR_STONE = "#b0a080";
const COLOR_BOG = "#80a040";
const COLOR_BRAND = "#ff9040";
const COLOR_BREAK = "#e0a060";
const COLOR_HUE = "#f0a0ff";
const COLOR_DOOM = "#a060e0";
const COLOR_SIPHON = "#6080ff";
const COLOR_ART = "#ffffff";
const COLOR_FORM = "#ff90d0";

const RING_LIFE = 0.2;
const LINE_LIFE = 0.15;
const BURST_PARTICLES = 12;
const BURST_SPEED = 120;
const BURST_LIFE = 0.35;
const BURST_SIZE = 2;
const TEXT_SCALE = 1;
const TEXT_LIFE = 0.6;
const SHAKE_HEAVY = 4;
const SHAKE_LIGHT = 2;
/** 地形を 1 マスだけ書き換える半径（placeTerrain は中心のマスを必ず含む） */
const ONE_TILE = 0;
/** 地形を消すときの持続（0 は消えない。none を置くのでマスが空になる） */
const NO_TIME = 0;

/** 照準地点を使うスキルの最大射程（system/skills.ts の CAST_RANGE に足す） */
export const WAVE2_CAST_RANGE: Partial<Record<Wave2SkillKey, number>> = {
  waterJar: SKILL.waterJar.maxRange,
  oilPot: SKILL.oilPot.maxRange,
  bogCall: SKILL.bogCall.maxRange,
  brandBlast: SKILL.brandBlast.maxRange,
  hueRelease: SKILL.hueRelease.maxRange,
  doomSentence: SKILL.doomSentence.maxRange,
  wardStake: SKILL.wardStake.maxRange,
};

// ---------------------------------------------------------------------------
// 発動前の確認（払う前に弾く。食う対象がいない消費系は何も払わない）
// ---------------------------------------------------------------------------

export function wave2CastBlock(state: GameState, key: Wave2SkillKey, target: Vec, params: Readonly<CastParams>): string | null {
  switch (key) {
    case "brandBlast":
      return enemiesInRadius(state, target, brandBlastRadius(params)).some((e) => hasStatus(e.status, "brand")) ? null : "烙印なし";
    case "hueRelease":
      return enemiesInRadius(state, target, hueReleaseRadius(params)).some((e) => hasStatus(e.status, "hue")) ? null : "彩痕なし";
    case "flashFreeze":
      return freezeTargets(state, state.player.body.pos, flashFreezeRadius(params)) ? null : "濡れなし";
    case "doomSentence":
      return enemyNear(state, target, SKILL.doomSentence.pickRadius) ? null : "対象なし";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 発動
// ---------------------------------------------------------------------------

type Wave2CastFn = (state: GameState, ctx: CastCtx) => void;

export const WAVE2_CAST: Record<Wave2SkillKey, Wave2CastFn> = {
  waterJar: (state, ctx) => splashTerrain(state, ctx, SKILL.waterJar, "water", COLOR_WATER),
  oilPot: (state, ctx) => splashTerrain(state, ctx, SKILL.oilPot, "oil", COLOR_OIL),
  scorchLine: castScorchLine,
  iceSlide: castIceSlide,
  levelGround: castLevelGround,
  emberDraw: castEmberDraw,
  bogCall: (state, ctx) => splashTerrain(state, ctx, SKILL.bogCall, "bog", COLOR_BOG),
  brandSear: (state, ctx) => coneStrike(state, ctx, SKILL.brandSear, COLOR_BRAND),
  brandBlast: castBrandBlast,
  breakKick: castBreakKick,
  collapseHammer: castCollapseHammer,
  tideSlash: castTideSlash,
  flashFreeze: castFlashFreeze,
  hueEtch: castHueEtch,
  hueRelease: castHueRelease,
  siphonMark: castSiphonMark,
  doomSentence: castDoomSentence,
  shiftingEdge: castShiftingEdge,
  weaponArt: castWeaponArt,
  titanForm: (state, ctx) => castForm(state, ctx, "titanForm"),
  swiftForm: (state, ctx) => castForm(state, ctx, "swiftForm"),
  spiritForm: (state, ctx) => castForm(state, ctx, "spiritForm"),
  wardStake: (state, ctx) => placeStake(state, ctx.target, ctx.params),
};

// ---- 共通の形 ----

interface SplashBlock {
  radius: number;
  terrainRadius: number;
  terrainTime: number;
  damage: Readonly<Scaling>;
  knockback: number;
}

/** 照準地点で弾けて周りに当て、床に地形を残す（水瓶・油流し・沼呼び） */
function splashTerrain(state: GameState, ctx: CastCtx, block: SplashBlock, kind: TerrainKind, color: string): void {
  const at = ctx.target;
  const radius = block.radius * ctx.params.areaMul;
  spawnRing(state, at, radius, color, RING_LIFE * 2);
  spawnBurst(state, at, color, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  pushSfx(state, "oilSplash");
  placeTerrain(state, at.x, at.y, kind, block.terrainRadius * ctx.params.areaMul, block.terrainTime * ctx.params.durationMul);
  const power = skillPower(state, block.damage, ctx.params);
  for (const e of enemiesInRadius(state, at, radius)) {
    skillHit(state, e, ctx.params, { base: power, kind: "ranged", dir: sub(e.body.pos, at), knockback: block.knockback, stagger: false, from: at });
  }
}

interface ConeBlock {
  radius: number;
  halfAngle: number;
  damage: Readonly<Scaling>;
  knockback: number;
}

/** 前方の扇に当てる（焼き印・彩刻・移ろい刃）。applies を渡せば付与を差し替える */
function coneStrike(
  state: GameState,
  ctx: CastCtx,
  block: ConeBlock,
  color: string,
  applies?: readonly StatusApply[] | null,
): void {
  const radius = block.radius * state.stats.meleeReachMul * ctx.params.areaMul;
  const power = skillPower(state, block.damage, ctx.params);
  spawnRing(state, add(ctx.origin, scale(ctx.dir, radius / 2)), radius / 2, color, RING_LIFE);
  pushSfx(state, "slash2");
  for (const e of enemiesInCone(state, ctx.origin, ctx.dir, radius, block.halfAngle)) {
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: sub(e.body.pos, ctx.origin), knockback: block.knockback, stagger: false, applies, from: ctx.origin });
  }
}

/** center の周り radius 以内のマスの中心を順に返す（地形を読む・書くための走査。行優先で決定的） */
function tileCentersInRadius(center: Vec, radius: number): Vec[] {
  const out: Vec[] = [];
  const reach = Math.ceil(radius / TILE_SIZE);
  const cx = Math.floor(center.x / TILE_SIZE);
  const cy = Math.floor(center.y / TILE_SIZE);
  for (let ty = cy - reach; ty <= cy + reach; ty++) {
    for (let tx = cx - reach; tx <= cx + reach; tx++) {
      const p = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
      if (tx === cx && ty === cy) out.push(p);
      else if (dist(p, center) <= radius) out.push(p);
    }
  }
  return out;
}

/** 線分 from → to の上にあるマスの中心（重複なし、from に近い順） */
function tileCentersOnSegment(from: Vec, to: Vec, step: number): Vec[] {
  const out: Vec[] = [];
  const seen = new Set<string>();
  const total = length(sub(to, from));
  const dir = normalize(sub(to, from), { x: 1, y: 0 });
  for (let d = 0; d <= total; d += step) {
    const p = add(from, scale(dir, d));
    const tx = Math.floor(p.x / TILE_SIZE);
    const ty = Math.floor(p.y / TILE_SIZE);
    const key = `${tx},${ty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE });
  }
  return out;
}

// ---- 焼き払い ----

function scorchLength(params: Readonly<CastParams>): number {
  const combo = params.combo === "oilScorch" ? C2.oilScorch.lengthMul : 1;
  return SKILL.scorchLine.length * params.areaMul * combo;
}

function castScorchLine(state: GameState, ctx: CastCtx): void {
  const s = SKILL.scorchLine;
  const end = rayEnd(state, ctx.origin, ctx.dir, scorchLength(ctx.params));
  const power = skillPower(state, s.damage, ctx.params);
  spawnLine(state, ctx.origin, end, COLOR_FIRE, LINE_LIFE * 2);
  pushSfx(state, "burn");
  // 自分の足元のマスは燃やさない（撃った本人が焼けないように）
  const start = add(ctx.origin, scale(ctx.dir, s.fireStart));
  for (let d = 0; d <= length(sub(end, start)); d += s.fireStep) {
    const p = add(start, scale(normalize(sub(end, start), ctx.dir), d));
    placeTerrain(state, p.x, p.y, "fire", s.fireRadius, s.fireTime * ctx.params.durationMul);
  }
  for (const e of enemiesOnSegment(state, ctx.origin, end, s.halfWidth * ctx.params.areaMul)) {
    skillHit(state, e, ctx.params, { base: power, kind: "ranged", dir: ctx.dir, knockback: s.knockback, stagger: false, from: ctx.origin });
  }
}

// ---- 凍て道 ----

function slideDistance(state: GameState): number {
  return SKILL.iceSlide.distance * state.stats.dashDistanceMul;
}

function castIceSlide(state: GameState, ctx: CastCtx): void {
  if (ctx.remote) {
    const end = rayEnd(state, ctx.origin, ctx.dir, slideDistance(state));
    iceTrail(state, ctx.origin, end, ctx.params, new Set());
    return;
  }
  const time = SKILL.iceSlide.time * ctx.params.timeMul;
  state.skills.active = {
    slot: ctx.slot,
    skillKey: "iceSlide",
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
    target: { ...ctx.target },
  };
  pushSfx(state, "dash");
}

/** from → to の床を氷床にし、通り道の敵に当てる（hitIds で 1 回ずつ） */
function iceTrail(state: GameState, from: Vec, to: Vec, params: CastParams, hitIds: Set<number>): void {
  const s = SKILL.iceSlide;
  for (const p of tileCentersOnSegment(from, to, s.iceStep)) placeTerrain(state, p.x, p.y, "ice", s.iceRadius, s.iceTime * params.durationMul);
  const power = skillPower(state, s.damage, params);
  const dir = normalize(sub(to, from), state.player.facing);
  const half = state.player.body.radius + s.hitPad * params.areaMul;
  for (const e of enemiesOnSegment(state, from, to, half)) {
    if (hitIds.has(e.id)) continue;
    hitIds.add(e.id);
    skillHit(state, e, params, { base: power, kind: "melee", dir, knockback: s.knockback, stagger: true, from });
  }
}

function updateIceSlide(state: GameState, a: ActiveCast, dt: number): void {
  const p = state.player;
  const total = Math.max(a.total, Number.EPSILON);
  const step = (slideDistance(state) / total) * Math.min(dt, Math.max(0, a.timer));
  a.timer -= dt;
  const before = { ...p.body.pos };
  const hit = moveBody(state, p.body, a.dir.x * step, a.dir.y * step);
  iceTrail(state, before, p.body.pos, a.params, a.hitIds);
  if (a.timer > 0 && !hit.hitX && !hit.hitY) return;
  state.skills.active = null;
  landingShock(state, p.body.pos, a.params);
}

// ---- 地均し ----

/** from → to の上の地形を砕く（溶岩は砕けない）。砕いたマスの数を返す */
function breakTerrainAlong(state: GameState, from: Vec, to: Vec): number {
  let broken = 0;
  for (const p of tileCentersOnSegment(from, to, SKILL.levelGround.probeStep)) {
    const kind = terrainAt(state, p.x, p.y);
    if (kind === "none" || kind === "lava") continue;
    placeTerrain(state, p.x, p.y, "none", ONE_TILE, NO_TIME);
    spawnBurst(state, p, COLOR_STONE, BURST_PARTICLES / 2, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
    broken += 1;
  }
  return broken;
}

/** 砕いたマスの数による威力の倍率 */
export function levelGroundMul(broken: number): number {
  const l = SKILL.levelGround;
  return 1 + Math.min(l.maxBonus, l.perCell * broken);
}

function castLevelGround(state: GameState, ctx: CastCtx): void {
  const l = SKILL.levelGround;
  const end = rayEnd(state, ctx.origin, ctx.dir, l.length * ctx.params.areaMul);
  const broken = breakTerrainAlong(state, ctx.origin, end);
  const power = skillPower(state, l.damage, ctx.params) * levelGroundMul(broken);
  spawnLine(state, ctx.origin, end, COLOR_STONE, LINE_LIFE * 2);
  shake(state, broken > 0 ? SHAKE_HEAVY : SHAKE_LIGHT);
  pushSfx(state, "explode");
  if (broken > 0) addFloatingText(state, end, `地均し ${broken}`, COLOR_STONE, TEXT_SCALE, TEXT_LIFE);
  for (const e of enemiesOnSegment(state, ctx.origin, end, l.halfWidth * ctx.params.areaMul)) {
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: ctx.dir, knockback: l.knockback, stagger: true, from: ctx.origin });
  }
}

// ---- 火吸い ----

/** 周りの炎の床を消して数える（溶岩は吸えない） */
function drawFire(state: GameState, center: Vec, radius: number): number {
  let drawn = 0;
  for (const p of tileCentersInRadius(center, radius)) {
    if (terrainAt(state, p.x, p.y) !== "fire") continue;
    placeTerrain(state, p.x, p.y, "none", ONE_TILE, NO_TIME);
    spawnLine(state, p, center, COLOR_FIRE, LINE_LIFE);
    drawn += 1;
  }
  return drawn;
}

/** 自分の燃焼を吸う（remote は自分を触らない）。吸えたら何マスぶんかを返す */
function drawSelfBurn(state: GameState, remote: boolean): number {
  if (remote || !hasStatus(state.player.status, "burn")) return 0;
  removeStatus(state, { kind: "player" }, "burn");
  return SKILL.emberDraw.selfBurnCells;
}

function castEmberDraw(state: GameState, ctx: CastCtx): void {
  const m = SKILL.emberDraw;
  const cells = drawFire(state, ctx.origin, m.drawRadius * ctx.params.areaMul) + drawSelfBurn(state, ctx.remote);
  const bonus = Math.min(m.maxBonus, m.perCell * cells);
  const power = skillPower(state, m.damage, ctx.params) * (1 + bonus);
  const radius = Math.min(m.maxRadius, m.radius + m.radiusPerCell * cells) * ctx.params.areaMul;
  if (cells > 0) addFloatingText(state, ctx.origin, `火吸い ${cells}`, COLOR_FIRE, TEXT_SCALE, TEXT_LIFE);
  pushSfx(state, "burn");
  const applies: readonly StatusApply[] = [{ kind: "burn", stacks: 1, duration: STATUS.burnDuration, potency: m.burnPotency }];
  spawnShot(state, ctx.origin, ctx.dir, ctx.params, {
    effect: "plain",
    power,
    speed: m.speed / ctx.params.timeMul,
    life: m.life,
    radius,
    knockback: m.knockback,
    color: COLOR_FIRE,
    applies,
  });
}

// ---- 烙火 ----

function brandBlastRadius(params: Readonly<CastParams>): number {
  return SKILL.brandBlast.radius * params.areaMul;
}

function castBrandBlast(state: GameState, ctx: CastCtx): void {
  const b = SKILL.brandBlast;
  const radius = brandBlastRadius(ctx.params);
  const power = skillPower(state, b.damage, ctx.params);
  const extra = ctx.params.combo === "brandChain" ? b.comboStacks : 0;
  spawnRing(state, ctx.target, radius, COLOR_BRAND, RING_LIFE * 2);
  pushSfx(state, "explode");
  for (const e of enemiesInRadius(state, ctx.target, radius)) {
    const brand = findStatus(e.status, "brand");
    // 起爆はスキルの命中で起きる（烙爆の反応）。その前に烙印を倍にしておく
    if (brand) doubleBrand(state, e, brand.stacks + extra, brand.potency);
    const base = brand ? power : power * b.plainMul;
    skillHit(state, e, ctx.params, { base, kind: "ranged", dir: sub(e.body.pos, ctx.target), knockback: b.knockback, stagger: brand !== undefined, from: ctx.target });
  }
}

function doubleBrand(state: GameState, e: Enemy, stacks: number, potency: number): void {
  if (stacks <= 0) return;
  applyStatus(state, { kind: "enemy", enemy: e }, { kind: "brand", stacks, duration: STATUS.brand.duration, potency }, "player");
  spawnBurst(state, e.body.pos, COLOR_BRAND, BURST_PARTICLES / 2, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
}

// ---- 崩し蹴り・崩落槌 ----

function castBreakKick(state: GameState, ctx: CastCtx): void {
  const k = SKILL.breakKick;
  const end = rayEnd(state, ctx.origin, ctx.dir, k.length * state.stats.meleeReachMul * ctx.params.areaMul);
  const power = skillPower(state, k.damage, ctx.params);
  spawnLine(state, ctx.origin, end, COLOR_BREAK, LINE_LIFE);
  pushSfx(state, "hitHeavy");
  for (const e of enemiesOnSegment(state, ctx.origin, end, k.halfWidth)) {
    // 崩勢中の敵は踏ん張れず、壁まで飛んで叩きつけられる
    if (hasStatus(e.status, "broken")) e.wallSplat = true;
    skillHit(state, e, ctx.params, { base: power, kind: "melee", dir: ctx.dir, knockback: k.knockback, stagger: true, from: ctx.origin });
  }
}

function castCollapseHammer(state: GameState, ctx: CastCtx): void {
  const c = SKILL.collapseHammer;
  const radius = c.radius * state.stats.meleeReachMul * ctx.params.areaMul;
  const power = skillPower(state, c.damage, ctx.params);
  spawnRing(state, add(ctx.origin, scale(ctx.dir, radius / 2)), radius / 2, COLOR_BREAK, RING_LIFE * 2);
  shake(state, SHAKE_HEAVY);
  pushSfx(state, "hitHeavy");
  for (const e of enemiesInCone(state, ctx.origin, ctx.dir, radius, c.halfAngle)) {
    const broken = hasStatus(e.status, "broken");
    skillHit(state, e, ctx.params, { base: power * (broken ? c.brokenMul : 1), kind: "melee", dir: sub(e.body.pos, ctx.origin), knockback: c.knockback, stagger: true, from: ctx.origin });
    // 崩勢は怯みを長くし、解けたとき堅守を付けずに消える（崩落）。怯み値を待たずにその場で崩す
    if (broken && e.hp > 0 && !isStaggered(e)) applyStagger(state, e, enemyCombat(e.defKey).staggerTime);
  }
}

// ---- 水刃・瞬凍 ----

function castTideSlash(state: GameState, ctx: CastCtx): void {
  const t = SKILL.tideSlash;
  pushSfx(state, "slash2");
  spawnShot(state, ctx.origin, ctx.dir, ctx.params, {
    effect: "plain",
    power: skillPower(state, t.damage, ctx.params),
    speed: t.speed / ctx.params.timeMul,
    life: t.life,
    radius: t.radius * ctx.params.areaMul,
    knockback: t.knockback,
    color: COLOR_WATER,
    pierce: t.pierce,
  });
}

function flashFreezeRadius(params: Readonly<CastParams>): number {
  const combo = params.combo === "waterFreeze" ? SKILL.flashFreeze.comboAreaMul : 1;
  return SKILL.flashFreeze.radius * params.areaMul * combo;
}

/** 凍らせる相手（濡れた敵か水たまり）があるか */
function freezeTargets(state: GameState, center: Vec, radius: number): boolean {
  if (enemiesInRadius(state, center, radius).some((e) => hasStatus(e.status, "wet"))) return true;
  return tileCentersInRadius(center, radius).some((p) => terrainAt(state, p.x, p.y) === "water");
}

/** 濡れのスタックから凍結の秒 */
export function flashFreezeTime(stacks: number, params: Readonly<CastParams>): number {
  const f = SKILL.flashFreeze;
  const combo = params.combo === "waterFreeze" ? f.comboFreezeMul : 1;
  return (f.freezeBase + f.freezePerStack * stacks) * params.durationMul * combo;
}

const CHILL_ONE: readonly StatusApply[] = [{ kind: "chill", stacks: 1, duration: STATUS.chill.duration, potency: 0 }];

function castFlashFreeze(state: GameState, ctx: CastCtx): void {
  const f = SKILL.flashFreeze;
  const radius = flashFreezeRadius(ctx.params);
  const power = skillPower(state, f.damage, ctx.params);
  spawnRing(state, ctx.origin, radius, COLOR_ICE, RING_LIFE * 2);
  pushSfx(state, "freeze");
  for (const p of tileCentersInRadius(ctx.origin, radius)) {
    if (terrainAt(state, p.x, p.y) === "water") placeTerrain(state, p.x, p.y, "ice", ONE_TILE, f.iceTime * ctx.params.durationMul);
  }
  for (const e of enemiesInRadius(state, ctx.origin, radius)) {
    const wet = findStatus(e.status, "wet");
    // 先に当ててから凍らせる（凍らせた直後に当てると砕けてしまう）
    skillHit(state, e, ctx.params, { base: power, kind: "ranged", dir: sub(e.body.pos, ctx.origin), knockback: wet ? 0 : f.knockback, stagger: false, applies: wet ? null : CHILL_ONE, from: ctx.origin });
    if (!wet || e.hp <= 0) continue;
    convertStatus(state, { kind: "enemy", enemy: e }, "wet", "freeze", flashFreezeTime(wet.stacks, ctx.params), "player");
  }
}

// ---- 彩刻・色解き ----

function castHueEtch(state: GameState, ctx: CastCtx): void {
  // 共鳴の色が定まらない（散光・共鳴なし）ときは色をくじで決める（state.rng）
  const index = resonanceHueIndex(state) ?? state.rng.int(0, TRAIT_COLORS.length - 1);
  const applies: readonly StatusApply[] = [{ kind: "hue", stacks: 1, duration: STATUS.hue.duration, potency: index }];
  coneStrike(state, ctx, SKILL.hueEtch, COLOR_HUE, applies);
}

function hueReleaseRadius(params: Readonly<CastParams>): number {
  const combo = params.combo === "hueBloom" ? SKILL.hueRelease.comboAreaMul : 1;
  return SKILL.hueRelease.radius * params.areaMul * combo;
}

/**
 * 彩痕の色に合う状態異常（色爆の引き金）。system/statusReactions.ts の HUE_TRIGGER と同じ対応。
 * ずれたら skills/expansion.test.ts の「色解き」が色ごとに気付く
 */
export const HUE_RELEASE_TRIGGER: Readonly<Record<TraitColor, StatusApply>> = {
  crimson: { kind: "burn", stacks: 1, duration: STATUS.burnDuration, potency: SKILL.hueRelease.burnPotency },
  azure: { kind: "chill", stacks: 1, duration: STATUS.chill.duration, potency: 0 },
  jade: { kind: "poison", stacks: 1, duration: STATUS.poison.duration, potency: 0 },
  gold: { kind: "shock", stacks: 1, duration: STATUS.shock.duration, potency: SKILL.hueRelease.shockPotency },
  umbra: { kind: "vulnerable", stacks: 1, duration: SKILL.hueRelease.vulnerableTime, potency: 0 },
};

function hueColorOf(e: Enemy): TraitColor | undefined {
  const hue = findStatus(e.status, "hue");
  return hue ? TRAIT_COLORS[Math.round(hue.potency)] : undefined;
}

function castHueRelease(state: GameState, ctx: CastCtx): void {
  const h = SKILL.hueRelease;
  const radius = hueReleaseRadius(ctx.params);
  const power = skillPower(state, h.damage, ctx.params);
  spawnRing(state, ctx.target, radius, COLOR_HUE, RING_LIFE * 2);
  pushSfx(state, "explode");
  for (const e of enemiesInRadius(state, ctx.target, radius)) {
    const color = hueColorOf(e);
    const applies = color ? [HUE_RELEASE_TRIGGER[color]] : null;
    skillHit(state, e, ctx.params, { base: power * (color ? h.hueMul : 1), kind: "ranged", dir: sub(e.body.pos, ctx.target), knockback: h.knockback, stagger: color !== undefined, applies, from: ctx.target });
  }
}

// ---- 吸魔の印・宣告 ----

function castSiphonMark(state: GameState, ctx: CastCtx): void {
  const s = SKILL.siphonMark;
  pushSfx(state, "shoot");
  spawnShot(state, ctx.origin, ctx.dir, ctx.params, {
    effect: "plain",
    power: skillPower(state, s.damage, ctx.params),
    speed: s.speed / ctx.params.timeMul,
    life: s.life,
    radius: s.radius,
    knockback: s.knockback,
    color: COLOR_SIPHON,
  });
}

function castDoomSentence(state: GameState, ctx: CastCtx): void {
  const d = SKILL.doomSentence;
  const center = enemyNear(state, ctx.target, d.pickRadius);
  if (!center) return;
  const at = { ...center.body.pos };
  const radius = d.radius * ctx.params.areaMul;
  const power = skillPower(state, d.damage, ctx.params);
  spawnRing(state, at, radius, COLOR_DOOM, RING_LIFE * 2);
  pushSfx(state, "hitHeavy");
  addFloatingText(state, at, "宣告", COLOR_DOOM, TEXT_SCALE, TEXT_LIFE);
  for (const e of enemiesInRadius(state, at, radius)) {
    skillHit(state, e, ctx.params, { base: power, kind: "ranged", dir: sub(e.body.pos, at), knockback: d.knockback, stagger: false, from: at });
  }
}

// ---- 移ろい刃 ----

/** 巡る属性の順（炎 → 氷 → 雷 → 毒） */
export const SHIFT_CYCLE: readonly Element[] = ["fire", "ice", "lightning", "poison"];

const SHIFT_APPLIES: Readonly<Partial<Record<Element, readonly StatusApply[]>>> = {
  fire: [{ kind: "burn", stacks: 1, duration: STATUS.burnDuration, potency: SKILL.shiftingEdge.burnPotency }],
  ice: [{ kind: "chill", stacks: 1, duration: STATUS.chill.duration, potency: 0 }],
  lightning: [{ kind: "shock", stacks: 1, duration: STATUS.shock.duration, potency: SKILL.shiftingEdge.shockPotency }],
  poison: [{ kind: "poison", stacks: 1, duration: STATUS.poison.duration, potency: 0 }],
};

/** 次に撃つ属性（HUD・テスト用） */
export function shiftElement(step: number): Element {
  return SHIFT_CYCLE[((step % SHIFT_CYCLE.length) + SHIFT_CYCLE.length) % SHIFT_CYCLE.length] ?? "fire";
}

function castShiftingEdge(state: GameState, ctx: CastCtx): void {
  const slot = state.skills.slots[ctx.slot];
  const step = slot?.elementStep ?? 0;
  // 写し（反響など）は手動の発動と同じ属性（手動の発動で番号はもう進んでいる）
  const element = shiftElement(ctx.remote ? step - 1 : step);
  if (!ctx.remote && slot) slot.elementStep = (step + 1) % SHIFT_CYCLE.length;
  const params = { ...ctx.params, element };
  coneStrike(state, { ...ctx, params }, SKILL.shiftingEdge, COLOR_ELEMENT[element], SHIFT_APPLIES[element] ?? null);
}

const COLOR_ELEMENT: Readonly<Record<Element, string>> = {
  none: "#ffffff",
  fire: "#ff7030",
  ice: "#80d0ff",
  lightning: "#ffe060",
  poison: "#90e040",
  dark: "#a060e0",
  light: "#fff4c0",
};

// ---- 極意 ----

function currentArtKey(state: GameState): MovesetKey {
  return MOVESETS[state.stats.moveset] ? state.stats.moveset : "sword";
}

/** 今の武器種の極意の名前（HUD・ツールチップ用） */
export function weaponArtName(state: GameState): string {
  return WEAPON_ART[currentArtKey(state)].name;
}

function castWeaponArt(state: GameState, ctx: CastCtx): void {
  const key = currentArtKey(state);
  const art = WEAPON_ART[key];
  const element = MOVESETS[key].attack.element;
  // 属性は武器に揃う（無属性の武器なら SKILL_ATTACK の無属性のまま）
  const params = { ...ctx.params, element: element === "none" ? ctx.params.element : element };
  const base = skillPower(state, SKILL.weaponArt.damage, params) * art.mul;
  const reach = state.stats.meleeReachMul * params.areaMul;
  addFloatingText(state, ctx.origin, art.name, COLOR_ART, TEXT_SCALE, TEXT_LIFE);
  shake(state, SHAKE_LIGHT);
  pushSfx(state, "slash3");
  const kb = SKILL.weaponArt.knockback;
  switch (art.kind) {
    case "cone": {
      const radius = art.radius * reach;
      const applies = "bleed" in art ? [{ kind: "bleed" as const, stacks: art.bleed, duration: WEAPON_ART_BLEED.duration, potency: WEAPON_ART_BLEED.potency }] : undefined;
      const pull = "pull" in art && art.pull;
      spawnRing(state, add(ctx.origin, scale(ctx.dir, radius / 2)), radius / 2, COLOR_ART, RING_LIFE);
      for (let i = 0; i < art.hits; i++) {
        for (const e of enemiesInCone(state, ctx.origin, ctx.dir, radius, art.halfAngle)) {
          const to = sub(e.body.pos, ctx.origin);
          skillHit(state, e, params, { base, kind: "melee", dir: pull ? scale(to, -1) : to, knockback: kb, stagger: true, applies, from: ctx.origin });
        }
      }
      return;
    }
    case "circle": {
      const radius = art.radius * reach;
      const knock = kb * ("knockbackMul" in art ? art.knockbackMul : 1);
      spawnRing(state, ctx.origin, radius, COLOR_ART, RING_LIFE * 2);
      for (const e of enemiesInRadius(state, ctx.origin, radius)) {
        skillHit(state, e, params, { base, kind: "melee", dir: sub(e.body.pos, ctx.origin), knockback: knock, stagger: true, from: ctx.origin });
      }
      return;
    }
    case "thrust": {
      const end = rayEnd(state, ctx.origin, ctx.dir, art.length * reach);
      spawnLine(state, ctx.origin, end, COLOR_ART, LINE_LIFE);
      for (let i = 0; i < art.hits; i++) {
        for (const e of enemiesOnSegment(state, ctx.origin, end, art.halfWidth)) {
          skillHit(state, e, params, { base, kind: "melee", dir: ctx.dir, knockback: kb / art.hits, stagger: art.hits === 1, from: ctx.origin });
        }
      }
      return;
    }
    case "tip": {
      const total = art.length * reach;
      const end = rayEnd(state, ctx.origin, ctx.dir, total);
      spawnLine(state, ctx.origin, end, COLOR_ART, LINE_LIFE);
      for (const e of enemiesOnSegment(state, ctx.origin, end, art.halfWidth)) {
        const tip = length(sub(e.body.pos, ctx.origin)) >= total * art.tipFrom;
        skillHit(state, e, params, { base: base * (tip ? art.tipMul : 1), kind: "melee", dir: ctx.dir, knockback: kb, stagger: tip, from: ctx.origin });
      }
      return;
    }
    case "shots":
      spawnFan(state, ctx.origin, ctx.dir, params, art.count, art.spreadRad, () => ({
        effect: "plain",
        power: base,
        speed: art.speed,
        life: art.life,
        radius: art.radius,
        knockback: kb / art.count,
        color: COLOR_ELEMENT[params.element ?? "none"],
      }));
      return;
  }
}

// ---- 変身 ----

/** 変身先の武器種 */
export const FORM_MOVESET: Readonly<Record<FormSkillKey, MovesetKey>> = {
  titanForm: "greatsword",
  swiftForm: "twinBlades",
  spiritForm: "wand",
};

const FORM_TEXT: Readonly<Record<FormSkillKey, string>> = {
  titanForm: "剛の型",
  swiftForm: "迅の型",
  spiritForm: "霊の型",
};

function castForm(state: GameState, ctx: CastCtx, key: FormSkillKey): void {
  formBurst(state, ctx.origin, ctx.params, key);
  if (ctx.remote) return;
  startForm(state, key, ctx.params);
}

/** 変身の瞬間の衝撃（効果量の変異は衝撃の威力に掛かる） */
function formBurst(state: GameState, center: Vec, params: CastParams, key: FormSkillKey): void {
  const f = SKILL[key];
  const radius = f.radius * params.areaMul;
  const power = skillPower(state, f.damage, params) * params.potencyMul;
  spawnRing(state, center, radius, COLOR_FORM, RING_LIFE * 2);
  spawnBurst(state, center, COLOR_FORM, BURST_PARTICLES * 2, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_HEAVY);
  pushSfx(state, "burst");
  for (const e of enemiesInRadius(state, center, radius)) {
    skillHit(state, e, params, { base: power, kind: "melee", dir: sub(e.body.pos, center), knockback: f.knockback, stagger: true, from: center });
  }
}

/** 変身先がジョブの得意な武器種か（持続が伸びる） */
export function formFavored(state: GameState, key: FormSkillKey): boolean {
  return JOBS[state.job].favored.includes(FORM_MOVESET[key]);
}

/** 変身の持続（持続の変異・深化・得意の武器種を畳む） */
export function formDuration(state: GameState, key: FormSkillKey, params: Readonly<CastParams>): number {
  const favored = formFavored(state, key) ? F.favoredDurationMul : 1;
  return SKILL[key].duration * params.durationMul * params.formDurationMul * favored;
}

/** 変身を始める（別の型の最中なら上書き。変身前の武器種は最初の変身のものを覚えたまま） */
export function startForm(state: GameState, key: FormSkillKey, params: Readonly<CastParams>): void {
  const rs = state.skills;
  const base = rs.form ? rs.form.base : state.stats.moveset;
  const total = formDuration(state, key, params);
  const moveset = FORM_MOVESET[key];
  rs.form = { skillKey: key, moveset, base, timer: total, total, recover: F.recoverTime * params.formRecoverMul };
  rs.formRecover = 0;
  if (state.player.attack.phase !== "none") cancelAttack(state);
  setMoveset(state, moveset);
  addFloatingText(state, state.player.body.pos, FORM_TEXT[key], COLOR_FORM, TEXT_SCALE, TEXT_LIFE * 2);
}

/** stats の武器種だけを差し替える（ほかの値は装備のまま。装備を替えると applyStats が作り直すので毎ステップ確かめる） */
function setMoveset(state: GameState, moveset: MovesetKey): void {
  if (state.stats.moveset === moveset) return;
  const prev = state.stats;
  state.stats = { ...prev, moveset };
  // 鍛冶・祭壇の属性の上乗せは写しにも入っているので、足し直させない
  carryContractPatch(prev, state.stats);
}

/**
 * 変身の時間経過（updateSkills が毎ステップ呼ぶ）。装備を替えて stats が作り直されたら変身前の武器種を更新して差し直す。
 * 切れたら武器種を戻し、振りの途中なら止め、少しの間遅くなる
 */
export function updateForm(state: GameState, dt: number): void {
  const rs = state.skills;
  rs.formRecover = Math.max(0, rs.formRecover - dt);
  const form = rs.form;
  if (!form) return;
  if (state.stats.moveset !== form.moveset) {
    form.base = state.stats.moveset;
    setMoveset(state, form.moveset);
  }
  form.timer -= dt;
  if (form.timer > 0) return;
  endForm(state);
}

export function endForm(state: GameState): void {
  const rs = state.skills;
  const form = rs.form;
  if (!form) return;
  rs.form = null;
  if (state.player.attack.phase !== "none") cancelAttack(state);
  setMoveset(state, form.base);
  rs.formRecover = form.recover;
  addFloatingText(state, state.player.body.pos, "変身が解けた", COLOR_FORM, TEXT_SCALE, TEXT_LIFE);
}

/** 変身が切れた後の反動の移動倍率 */
export function formRecoverMoveMul(state: GameState): number {
  return state.skills.formRecover > 0 ? F.recoverMoveMul : 1;
}

// ---- 結界杭 ----

function maxStakes(params: Readonly<CastParams>): number {
  return Math.max(2, SKILL.wardStake.maxAlive + params.countBonus);
}

export function placeStake(state: GameState, pos: Vec, params: CastParams): void {
  const rs = state.skills;
  const life = SKILL.wardStake.life * params.durationMul;
  rs.stakes.push({ id: allocId(state), pos: { ...pos }, life, total: life, params });
  spawnBurst(state, pos, COLOR_STONE, BURST_PARTICLES / 2, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
  pushSfx(state, "hit");
  const limit = maxStakes(params);
  while (rs.stakes.length > limit) rs.stakes.shift();
}

/** 杭を結ぶ線（置いた順に結び、3 本以上なら最後と最初も結ぶ） */
export function stakeSegments(stakes: readonly WardStake[]): [WardStake, WardStake][] {
  const out: [WardStake, WardStake][] = [];
  for (let i = 0; i + 1 < stakes.length; i++) {
    const a = stakes[i];
    const b = stakes[i + 1];
    if (a && b) out.push([a, b]);
  }
  const first = stakes[0];
  const last = stakes[stakes.length - 1];
  if (stakes.length >= 3 && first && last) out.push([last, first]);
  return out;
}

/** 点が杭の囲み（3 本以上の多角形）の内側か（交差数の偶奇） */
export function insideStakes(stakes: readonly WardStake[], p: Vec): boolean {
  if (stakes.length < 3) return false;
  let inside = false;
  for (const [a, b] of stakeSegments(stakes)) {
    const crosses = a.pos.y > p.y !== b.pos.y > p.y;
    if (!crosses) continue;
    const x = a.pos.x + ((p.y - a.pos.y) / (b.pos.y - a.pos.y)) * (b.pos.x - a.pos.x);
    if (p.x < x) inside = !inside;
  }
  return inside;
}

/** 杭の時間経過と、周期ごとの線の当たり・内側の脆弱 */
export function updateStakes(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const s of rs.stakes) s.life -= dt;
  rs.stakes = rs.stakes.filter((s) => s.life > 0);
  if (rs.stakes.length < 2) {
    rs.stakeTick = 0;
    return;
  }
  rs.stakeTick += dt;
  const w = SKILL.wardStake;
  if (rs.stakeTick < w.tickEvery) return;
  rs.stakeTick -= w.tickEvery;
  stakeTickHits(state);
}

function stakeTickHits(state: GameState): void {
  const w = SKILL.wardStake;
  const stakes = state.skills.stakes;
  const hit = new Set<number>();
  for (const [a, b] of stakeSegments(stakes)) {
    const params = b.params;
    const half = w.lineHalfWidth * params.areaMul;
    const power = skillPower(state, w.damage, params);
    spawnLine(state, a.pos, b.pos, COLOR_STONE, LINE_LIFE);
    for (const e of enemiesOnSegment(state, a.pos, b.pos, half)) {
      if (hit.has(e.id)) continue;
      hit.add(e.id);
      skillHit(state, e, params, { base: power, kind: "ranged", dir: sub(e.body.pos, a.pos), knockback: w.knockback, stagger: false, from: a.pos });
    }
  }
  const newest = stakes[stakes.length - 1];
  if (!newest) return;
  const vulnerable: StatusApply = { kind: "vulnerable", stacks: 1, duration: w.vulnerableTime, potency: 0 };
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning" || !insideStakes(stakes, e.body.pos)) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { ...vulnerable, duration: vulnerable.duration * newest.params.statusDurationMul }, "player");
  }
}

// ---------------------------------------------------------------------------
// 発動中の更新
// ---------------------------------------------------------------------------

/** active.skillKey が第 2 弾のものなら進めて true */
export function updateWave2Active(state: GameState, a: ActiveCast, dt: number): boolean {
  if (a.skillKey !== "iceSlide") return false;
  updateIceSlide(state, a, dt);
  return true;
}
