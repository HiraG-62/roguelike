import { type Enemy, type GameState, allocId, pushSfx } from "../core/state";
import type { Element } from "../core/element";
import type { StatusApply } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { STATUS } from "../data/tuning";
import { type Scaling, TRAIT_COLORS, type TraitColor } from "../loot/types";
import { TILE_SIZE } from "../map/grid";
import { addFloatingText, shake, spawnBurst, spawnLine, spawnRing, addHeadLabel } from "../system/effects";
import { applyStatus, convertStatus, enemiesInRadius, findStatus, hasStatus, removeStatus } from "../system/statusEffects";
import { placeTerrain, terrainAt } from "../system/terrain";
import type { CastCtx } from "./actions";
import { SKILL } from "./data";
import { enemiesInCone, enemiesOnSegment, enemyNear, rayEnd } from "./geom";
import { resonanceHueIndex, skillHit, skillPower } from "./hit";
import { spawnShot } from "./shots";
import type { CastParams, Wave2SkillKey, WardStake } from "./types";

/**
 * スキル第 2 弾の発動（地形・新しい状態異常・属性・空間。docs/ideas/skills-expansion.md）。
 * actions.ts と同じく「発動地点・向き・照準地点」を受け取り、remote（反響・遅延・照準起点・据え置き）なら
 * プレイヤーを動かさずその地点で即時に起こす。
 * 地形は system/terrain.ts の placeTerrain / terrainAt を呼ぶだけ（地形の規則はあちらが持つ）
 */

const COLOR_WATER = "#60a0ff";
const COLOR_OIL = "#806040";
const COLOR_FIRE = "#ff7030";
const COLOR_ICE = "#a0e0ff";
const COLOR_STONE = "#b0a080";
const COLOR_MUD = "#8a6a40";
const COLOR_BRAND = "#ff9040";
const COLOR_HUE = "#f0a0ff";
const COLOR_DOOM = "#a060e0";

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
  brandBlast: SKILL.brandBlast.maxRange,
  hueRelease: SKILL.hueRelease.maxRange,
  doomSentence: SKILL.doomSentence.maxRange,
  wardStake: SKILL.wardStake.maxRange,
  mire: SKILL.mire.maxRange,
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
  levelGround: castLevelGround,
  emberDraw: castEmberDraw,
  brandSear: (state, ctx) => coneStrike(state, ctx, SKILL.brandSear, COLOR_BRAND),
  brandBlast: castBrandBlast,
  flashFreeze: castFlashFreeze,
  hueEtch: castHueEtch,
  hueRelease: castHueRelease,
  doomSentence: castDoomSentence,
  shiftingEdge: castShiftingEdge,
  wardStake: (state, ctx) => placeStake(state, ctx.target, ctx.params),
  mire: castMire,
};

// ---- 共通の形 ----

interface SplashBlock {
  radius: number;
  terrainRadius: number;
  terrainTime: number;
  damage: Readonly<Scaling>;
  knockback: number;
}

/** 照準地点で弾けて周りに当て、床に地形を残す（水瓶・油流し・泥沼） */
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

/** 泥沼: 照準地点に泥を広げ、中の敵に怯み値を入れ続ける領域を置く（領域の周期は skills/placed.ts） */
function castMire(state: GameState, ctx: CastCtx): void {
  const m = SKILL.mire;
  splashTerrain(state, ctx, m, "mud", COLOR_MUD);
  const zones = state.skills.mires ?? [];
  state.skills.mires = zones;
  zones.push({ pos: { ...ctx.target }, timer: m.terrainTime * ctx.params.durationMul, tick: m.tickEvery, params: ctx.params, map: state.map });
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
  if (broken > 0) addHeadLabel(state, ctx.origin, `地均し ${broken}`, COLOR_STONE, TEXT_LIFE);
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
  if (cells > 0) addHeadLabel(state, ctx.origin, `火吸い ${cells}`, COLOR_FIRE, TEXT_LIFE);
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

// ---- 瞬凍 ----

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
  // 状態異常の語が共鳴していないときは色をくじで決める（state.rng）
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

// ---- 宣告 ----

function castDoomSentence(state: GameState, ctx: CastCtx): void {
  const d = SKILL.doomSentence;
  const center = enemyNear(state, ctx.target, d.pickRadius);
  if (!center) return;
  const at = { ...center.body.pos };
  const radius = d.radius * ctx.params.areaMul;
  const power = skillPower(state, d.damage, ctx.params);
  spawnRing(state, at, radius, COLOR_DOOM, RING_LIFE * 2);
  pushSfx(state, "hitHeavy");
  addFloatingText(state, at, "宣告", COLOR_DOOM, TEXT_SCALE, TEXT_LIFE, "status");
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
