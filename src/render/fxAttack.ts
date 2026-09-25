/**
 * 攻撃エフェクト（斬撃の軌跡・命中の斬り裂き線・銃口の閃光・弾の尾・着弾・爆発の段階・焦げ跡・稲妻・属性の粒）。
 * state は読むだけで、state.rng も Math.random も使わない。ばらつきは fxMath.ts / renderMath.ts の座標ハッシュ。
 *
 * 命中・発射・着弾は state に積まず、描画側で「前の tick からの変化」（敵の hitFlash の立ち上がり・弾の出現と消滅・
 * 爆発の輪の出現）を見て作る。時刻は state.time で数えるので、ヒットストップ中は火花も止まる
 */
import type { Enemy, GameState, Particle, Projectile, ShapeFx } from "../core/state";
import { ELEMENT_FX_COLOR, deathColor, hitElement, isBlastShape } from "../system/effects";
import { currentMeleeStep, isAttacking } from "../system/player";
import { FX_ATTACK, STATUS } from "../data/tuning";
import { type BulletFeature, type HitShape, bulletFeatures } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { COLOR_THUNDER } from "../skills/placed";
import type { GameMap } from "../map/grid";
import { critFlashActive } from "./effectsUi";
import { clamp01, easeOutCubic, hash01, swingSign } from "./renderMath";
import {
  type Point,
  arcTrailSamples,
  blastStage,
  boltBranch,
  boltPoints,
  coastDistance,
  crescentProfile,
  mixColor,
  radialAngle,
} from "./fxMath";

/** 加算の丸い光（レンダラーの事前生成した光を借りる。effectsUi の FxSprites.glow と同じ形） */
export type GlowFn = (x: number, y: number, color: string, r: number, alpha: number) => void;

const COLOR_WHITE = "#ffffff";
const LIGHTER = "lighter";
const SOURCE_OVER = "source-over";
/** hitFlash の立ち上がりとみなす増え幅（減衰の誤差を拾わない） */
const FLASH_RISE_EPS = 1e-4;
/** look.glow の弾の光の半径の倍率 */
const LOOK_GLOW_MUL = 1.6;
/** look.trail の弾の尾に散る粒の数・濃さ・横ぶれ（px）・ちらつきの升目（px。弾がこれだけ進むと粒の並びが変わる） */
const LOOK_SPARKS = 3;
const LOOK_SPARK_ALPHA = 0.8;
const LOOK_SPARK_SPREAD = 2;
const LOOK_SPARK_CELL = 3;
/** これ以下の残り寿命で消えた弾は「尽きた」（命中・壁ではない） */
const FIZZLE_LIFE_LEFT = 1 / 30;
/** 近接の命中とみなす距離の余裕（px。当たり判定の外周からのはみ出し） */
const MELEE_REACH_PAD = 12;
/** 弱点の割れの印を「今の命中」とみなす経過秒と距離 */
const WEAK_MARK_AGE = 0.05;
const WEAK_MARK_DIST = 2;
/** 1 tick に同じ場所から出た弾の銃口の閃光は 1 つにまとめる（散弾・二丁拳銃） */
const MUZZLE_MERGE_PX = 3;
/** 弾が消えた位置は最後に見た位置から 1 tick ぶん進めた所（壁・敵の手前で止まって見えないように） */
const VANISH_LEAD = 0.6;
const SIXTY = 1 / 60;

// -----------------------------------------------------------------------------
// 描画側の記録（GameState ごと。state には書かない）
// -----------------------------------------------------------------------------

type FxEventKind = "slashSpark" | "impact" | "muzzle" | "fizzle";

interface FxEvent {
  kind: FxEventKind;
  x: number;
  y: number;
  angle: number;
  born: number;
  life: number;
  color: string;
  scale: number;
  seed: number;
  crit: boolean;
  style: BulletStyle;
}

interface Scorch {
  x: number;
  y: number;
  r: number;
  born: number;
  seed: number;
}

interface ShotSeen {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  owner: Projectile["owner"];
  style: BulletStyle;
}

/** 弾の見た目の系統（弾の性質から 1 つ） */
export type BulletStyle = "plain" | "spread" | "pierce" | "charge" | "lob" | "mine";

interface Layer {
  tick: number;
  time: number;
  map: GameMap | null;
  flashes: Map<number, number>;
  enemies: Map<number, { x: number; y: number }>;
  shots: Map<number, ShotSeen>;
  blasts: WeakSet<ShapeFx>;
  events: FxEvent[];
  scorches: Scorch[];
}

const layers = new WeakMap<GameState, Layer>();

function layerOf(state: GameState): Layer {
  const hit = layers.get(state);
  if (hit) return hit;
  const made: Layer = {
    tick: -1,
    time: state.time,
    map: null,
    flashes: new Map(),
    enemies: new Map(),
    shots: new Map(),
    blasts: new WeakSet(),
    events: [],
    scorches: [],
  };
  layers.set(state, made);
  return made;
}

const styleCache = new Map<string, BulletStyle>();

/** 性質の並びから見た目の系統を選ぶ（爆発するもの > 溜め > 貫通 > 散弾） */
export function bulletStyleOf(features: readonly BulletFeature[]): BulletStyle {
  if (features.includes("mine")) return "mine";
  if (features.includes("lob")) return "lob";
  if (features.includes("charge")) return "charge";
  if (features.includes("pierce")) return "pierce";
  if (features.includes("spread")) return "spread";
  return "plain";
}

function projectileStyle(pr: Projectile): BulletStyle {
  const key = pr.shot?.key;
  if (!key) return "plain";
  const cached = styleCache.get(key);
  if (cached) return cached;
  const def = BULLETS[key];
  const style = def ? bulletStyleOf(bulletFeatures(def)) : "plain";
  styleCache.set(key, style);
  return style;
}

function pushEvent(layer: Layer, ev: FxEvent): void {
  layer.events.push(ev);
  const max = FX_ATTACK.maxEvents;
  if (layer.events.length > max) layer.events.splice(0, layer.events.length - max);
}

function baseEvent(kind: FxEventKind, x: number, y: number, born: number, life: number): FxEvent {
  return { kind, x, y, angle: 0, born, life, color: COLOR_WHITE, scale: 1, seed: Math.round(x * 31 + y * 17 + born * 997), crit: false, style: "plain" };
}

/** 今の命中が近接の振りによるものか（振りの active 中で、当たり判定の届く範囲にいる） */
function meleeHitInfo(state: GameState, e: Enemy): { angle: number; heavy: boolean } | undefined {
  const p = state.player;
  if (!isAttacking(p) || p.attack.phase !== "active") return undefined;
  const step = currentMeleeStep(state);
  if (!step) return undefined;
  const dx = e.body.pos.x - p.body.pos.x;
  const dy = e.body.pos.y - p.body.pos.y;
  if (Math.hypot(dx, dy) > step.reach + step.size + e.body.radius + MELEE_REACH_PAD) return undefined;
  const dir = Math.atan2(p.attack.dir.y, p.attack.dir.x);
  // 突きは攻撃の向きに、振りは刃の進む向き（自分から敵への向きに直交）に光の線を引く
  const toward = dx === 0 && dy === 0 ? dir : Math.atan2(dy, dx);
  const angle = step.shape.kind === "thrust" ? dir : toward + (Math.PI / 2) * swingSign(p.attack.step);
  return { angle, heavy: step.heavy };
}

function isWeakHitNow(state: GameState, e: Enemy): boolean {
  const marks = state.effects?.marks;
  if (!marks) return false;
  return marks.some(
    (m) => m.kind === "weakCrack" && m.age <= WEAK_MARK_AGE && Math.abs(m.pos.x - e.body.pos.x) <= WEAK_MARK_DIST && Math.abs(m.pos.y - e.body.pos.y) <= WEAK_MARK_DIST,
  );
}

function hitColor(state: GameState, melee: boolean): string {
  const element = hitElement(state, melee ? "melee" : "ranged", false);
  return element === "none" ? COLOR_WHITE : ELEMENT_FX_COLOR[element];
}

function onEnemyHit(state: GameState, layer: Layer, e: Enemy): void {
  const c = FX_ATTACK.hitSpark;
  const crit = critFlashActive(state, e.id);
  const weak = isWeakHitNow(state, e);
  const melee = meleeHitInfo(state, e);
  const mul = (crit ? c.critMul : 1) * (weak ? c.weakMul : 1);
  if (melee) {
    const ev = baseEvent("slashSpark", e.body.pos.x, e.body.pos.y, state.time, c.life * (crit ? 1.3 : 1));
    ev.angle = melee.angle;
    ev.scale = mul * (melee.heavy ? c.heavyMul : 1);
    ev.color = crit ? c.critColor : hitColor(state, true);
    ev.crit = crit || weak;
    ev.seed += e.id * 7;
    pushEvent(layer, ev);
    return;
  }
  const ev = baseEvent("impact", e.body.pos.x, e.body.pos.y, state.time, FX_ATTACK.impact.life * (crit ? 1.3 : 1));
  ev.scale = mul;
  ev.color = crit ? c.critColor : hitColor(state, false);
  ev.crit = crit || weak;
  ev.seed += e.id * 7;
  pushEvent(layer, ev);
}

function onEnemyGone(state: GameState, layer: Layer, id: number, pos: { x: number; y: number }): void {
  const ev = baseEvent("impact", pos.x, pos.y, state.time, FX_ATTACK.impact.life * FX_ATTACK.impact.killMul);
  ev.scale = FX_ATTACK.impact.killMul;
  ev.crit = true;
  ev.seed += id * 13;
  pushEvent(layer, ev);
}

function syncEnemies(state: GameState, layer: Layer, emit: boolean): void {
  const seen = new Set<number>();
  for (const e of state.enemies) {
    seen.add(e.id);
    const prev = layer.flashes.get(e.id) ?? 0;
    if (emit && e.hitFlash > prev + FLASH_RISE_EPS) onEnemyHit(state, layer, e);
    layer.flashes.set(e.id, e.hitFlash);
    if (!e.hidden && e.hp > 0) layer.enemies.set(e.id, { x: e.body.pos.x, y: e.body.pos.y });
  }
  for (const [id, pos] of layer.enemies) {
    if (seen.has(id)) continue;
    if (emit) onEnemyGone(state, layer, id, pos);
    layer.enemies.delete(id);
    layer.flashes.delete(id);
  }
}

function onShotBorn(state: GameState, layer: Layer, pr: Projectile, style: BulletStyle, merged: Point[]): void {
  if (pr.owner !== "player") return;
  if (merged.some((m) => Math.abs(m.x - pr.pos.x) <= MUZZLE_MERGE_PX && Math.abs(m.y - pr.pos.y) <= MUZZLE_MERGE_PX)) return;
  merged.push({ x: pr.pos.x, y: pr.pos.y });
  const ev = baseEvent("muzzle", pr.pos.x, pr.pos.y, state.time, FX_ATTACK.muzzle.life);
  ev.angle = Math.atan2(pr.vel.y, pr.vel.x);
  ev.color = pr.color;
  ev.style = style;
  pushEvent(layer, ev);
}

function onShotGone(state: GameState, layer: Layer, s: ShotSeen, dt: number): void {
  // 爆発する弾は spawnBlast の輪が描く
  if (s.style === "mine" || s.style === "lob") return;
  const lead = dt * VANISH_LEAD;
  const x = s.x + s.vx * lead;
  const y = s.y + s.vy * lead;
  const fizzle = s.life <= FIZZLE_LIFE_LEFT;
  const kind: FxEventKind = fizzle ? "fizzle" : "impact";
  const life = fizzle ? FX_ATTACK.impact.fizzleLife : FX_ATTACK.impact.life;
  const ev = baseEvent(kind, x, y, state.time, life);
  ev.angle = Math.atan2(s.vy, s.vx);
  ev.color = s.owner === "enemy" ? FX_ATTACK.bullet.enemyColor : s.color;
  ev.style = s.style;
  ev.scale = s.style === "charge" ? FX_ATTACK.muzzle.chargeMul : s.style === "spread" ? 0.7 : 1;
  pushEvent(layer, ev);
}

function syncShots(state: GameState, layer: Layer, emit: boolean, dt: number): void {
  const seen = new Set<number>();
  const merged: Point[] = [];
  for (const pr of state.projectiles) {
    seen.add(pr.id);
    const known = layer.shots.get(pr.id);
    const style = known?.style ?? projectileStyle(pr);
    if (!known && emit) onShotBorn(state, layer, pr, style, merged);
    layer.shots.set(pr.id, { x: pr.pos.x, y: pr.pos.y, vx: pr.vel.x, vy: pr.vel.y, life: pr.life, color: pr.color, owner: pr.owner, style });
  }
  for (const [id, s] of layer.shots) {
    if (seen.has(id)) continue;
    if (emit) onShotGone(state, layer, s, dt);
    layer.shots.delete(id);
  }
}

function syncBlasts(state: GameState, layer: Layer): void {
  const c = FX_ATTACK.blast;
  for (const s of state.shapes) {
    if (!isBlastShape(s) || layer.blasts.has(s)) continue;
    layer.blasts.add(s);
    layer.scorches.push({ x: s.pos.x, y: s.pos.y, r: s.radius * c.scorchRatio, born: state.time, seed: Math.round(s.pos.x * 7 + s.pos.y * 13) });
  }
  layer.scorches = layer.scorches.filter((sc) => state.time - sc.born < c.scorchLife);
}

/**
 * 前の tick からの変化を拾う（1 tick に 1 回だけ働く。描画の各所から呼んでよい）。
 * 最初の 1 回と階の切り替わりは記録だけして、演出は出さない
 */
export function syncAttackFx(state: GameState): void {
  syncLayer(state);
}

function syncLayer(state: GameState): Layer {
  const layer = layerOf(state);
  if (layer.tick === state.tick) return layer;
  const mapChanged = layer.map !== state.map;
  const emit = layer.tick >= 0 && !mapChanged;
  if (mapChanged) {
    layer.map = state.map;
    layer.flashes.clear();
    layer.enemies.clear();
    layer.shots.clear();
    layer.events = [];
    layer.scorches = [];
  }
  const dt = Math.max(SIXTY, state.time - layer.time);
  syncEnemies(state, layer, emit);
  syncShots(state, layer, emit, dt);
  syncBlasts(state, layer);
  layer.events = layer.events.filter((ev) => state.time - ev.born < ev.life);
  layer.tick = state.tick;
  layer.time = state.time;
  return layer;
}

// -----------------------------------------------------------------------------
// 焦げ跡（地面）
// -----------------------------------------------------------------------------

const SCORCH_SPECKS = 6;
const SCORCH_RY = 0.55;

/** 爆発の焦げ跡。敵より先（地面の層）に描く */
export function drawAttackGround(ctx: CanvasRenderingContext2D, state: GameState): void {
  const layer = syncLayer(state);
  if (layer.scorches.length === 0) return;
  const c = FX_ATTACK.blast;
  ctx.fillStyle = c.scorchColor;
  for (const sc of layer.scorches) {
    const u = clamp01((state.time - sc.born) / c.scorchLife);
    const a = c.scorchAlpha * (1 - u * u);
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.ellipse(sc.x, sc.y, sc.r, sc.r * SCORCH_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < SCORCH_SPECKS; i++) {
      const ang = radialAngle(i, SCORCH_SPECKS, sc.seed);
      const d = sc.r * (0.9 + hash01(sc.seed + i, i * 3) * 0.5);
      ctx.fillRect(Math.round(sc.x + Math.cos(ang) * d), Math.round(sc.y + Math.sin(ang) * d * SCORCH_RY), 2, 1);
    }
  }
  ctx.globalAlpha = 1;
}

// -----------------------------------------------------------------------------
// 命中・銃口・着弾（空中）
// -----------------------------------------------------------------------------

/** 中心から ±len（angle 向き）、幅 ±w の菱形（鋭い光の線） */
function fillLens(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, w: number): void {
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(x + cx * len, y + cy * len);
  ctx.lineTo(x - cy * w, y + cx * w);
  ctx.lineTo(x - cx * len, y - cy * len);
  ctx.lineTo(x + cy * w, y - cx * w);
  ctx.closePath();
  ctx.fill();
}

/** 片側だけ伸びる菱形（銃口の炎）。根元 back px 後ろから先端 len px 前まで */
function fillFlame(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, w: number, back: number): void {
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  const mx = x + cx * len * 0.3;
  const my = y + cy * len * 0.3;
  ctx.beginPath();
  ctx.moveTo(x - cx * back, y - cy * back);
  ctx.lineTo(mx - cy * w, my + cx * w);
  ctx.lineTo(x + cx * len, y + cy * len);
  ctx.lineTo(mx + cy * w, my - cx * w);
  ctx.closePath();
  ctx.fill();
}

function drawSparkDots(ctx: CanvasRenderingContext2D, ev: FxEvent, age: number, count: number, speed: number, spread: number, twoWay: boolean): void {
  for (let i = 0; i < count; i++) {
    const h = hash01(ev.seed + i * 11, i * 5 + 1);
    const back = twoWay && i % 2 === 1 ? Math.PI : 0;
    const a = ev.angle + back + (h - 0.5) * spread;
    const d = coastDistance(speed * (0.5 + h), age, ev.life);
    const tail = d * 0.55;
    ctx.strokeStyle = i % 2 === 0 ? COLOR_WHITE : ev.color;
    ctx.beginPath();
    ctx.moveTo(ev.x + Math.cos(a) * tail, ev.y + Math.sin(a) * tail);
    ctx.lineTo(ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d);
    ctx.stroke();
  }
}

/** 斬り裂き線: 刃の進む向きに鋭い光が走り、細りながら消える。会心・弱点は十字に割れて輪が広がる */
function drawSlashSpark(ctx: CanvasRenderingContext2D, ev: FxEvent, age: number, glow: GlowFn): void {
  const c = FX_ATTACK.hitSpark;
  const u = clamp01(age / ev.life);
  const grow = easeOutCubic(Math.min(1, u * 4));
  const len = c.length * ev.scale * (0.5 + 0.5 * grow + 0.25 * u);
  const w = Math.max(0.5, c.width * ev.scale * (1 - u));
  glow(ev.x, ev.y, ev.color, Math.round(c.glow * ev.scale), 0.7 * (1 - u));
  ctx.globalCompositeOperation = LIGHTER;
  ctx.globalAlpha = 0.6 * (1 - u);
  ctx.fillStyle = ev.color;
  fillLens(ctx, ev.x, ev.y, ev.angle, len * 1.15, w * 2.2);
  ctx.globalAlpha = 1 - u;
  ctx.fillStyle = COLOR_WHITE;
  fillLens(ctx, ev.x, ev.y, ev.angle, len, w);
  if (ev.crit) {
    fillLens(ctx, ev.x, ev.y, ev.angle + Math.PI / 2, len * 0.55, w * 0.8);
    ctx.strokeStyle = ev.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9 * (1 - u);
    ctx.beginPath();
    ctx.arc(ev.x, ev.y, 3 + c.length * 0.7 * ev.scale * easeOutCubic(u), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1 - u;
  drawSparkDots(ctx, ev, age, Math.round(c.sparks * (ev.crit ? 2 : 1)), c.sparkSpeed * ev.scale, 0.9, true);
  ctx.globalCompositeOperation = SOURCE_OVER;
}

/** 着弾: 放射の短い光と広がる輪、中心の白い点 */
function drawImpact(ctx: CanvasRenderingContext2D, ev: FxEvent, age: number, glow: GlowFn): void {
  const c = FX_ATTACK.impact;
  const u = clamp01(age / ev.life);
  const reach = c.length * ev.scale * easeOutCubic(Math.min(1, u * 2));
  glow(ev.x, ev.y, ev.color, Math.round(FX_ATTACK.hitSpark.glow * ev.scale * 0.8), 0.6 * (1 - u));
  ctx.globalCompositeOperation = LIGHTER;
  ctx.globalAlpha = 1 - u;
  ctx.lineWidth = 1;
  const rays = Math.round(c.rays * (ev.crit ? 1.6 : 1));
  for (let i = 0; i < rays; i++) {
    const a = radialAngle(i, rays, ev.seed);
    ctx.strokeStyle = i % 2 === 0 ? COLOR_WHITE : ev.color;
    ctx.beginPath();
    ctx.moveTo(ev.x + Math.cos(a) * reach * 0.35, ev.y + Math.sin(a) * reach * 0.35);
    ctx.lineTo(ev.x + Math.cos(a) * reach, ev.y + Math.sin(a) * reach);
    ctx.stroke();
  }
  ctx.strokeStyle = ev.color;
  ctx.globalAlpha = 0.8 * (1 - u);
  ctx.beginPath();
  ctx.arc(ev.x, ev.y, 1 + c.ring * ev.scale * easeOutCubic(u), 0, Math.PI * 2);
  ctx.stroke();
  if (u < 0.4) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOR_WHITE;
    ctx.fillRect(Math.round(ev.x - 1), Math.round(ev.y - 1), 2, 2);
  }
  ctx.globalCompositeOperation = SOURCE_OVER;
}

/** 弾が尽きた: 小さな煙の 3 点 */
function drawFizzle(ctx: CanvasRenderingContext2D, ev: FxEvent, age: number): void {
  const u = clamp01(age / ev.life);
  ctx.globalAlpha = 0.7 * (1 - u);
  ctx.fillStyle = ev.color;
  for (let i = 0; i < 3; i++) {
    const a = radialAngle(i, 3, ev.seed);
    const d = 1 + 3 * u;
    ctx.fillRect(Math.round(ev.x + Math.cos(a) * d), Math.round(ev.y + Math.sin(a) * d), 1, 1);
  }
}

/** 銃口の閃光: 前へ伸びる炎と左右の小さな花弁。散弾は太く、貫通は細長く、溜め撃ちは大きく輪を伴う */
function drawMuzzle(ctx: CanvasRenderingContext2D, ev: FxEvent, age: number, glow: GlowFn): void {
  const c = FX_ATTACK.muzzle;
  const u = clamp01(age / ev.life);
  const big = ev.style === "charge" ? c.chargeMul : 1;
  const len = c.length * big * (ev.style === "pierce" ? c.pierceLengthMul : 1) * (1 - u * 0.4);
  const w = c.width * big * (ev.style === "spread" ? c.spreadWidthMul : 1) * (ev.style === "pierce" ? 0.6 : 1) * (1 - u * 0.5);
  glow(ev.x, ev.y, ev.color, Math.round(c.glow * big), 0.8 * (1 - u));
  ctx.globalCompositeOperation = LIGHTER;
  ctx.globalAlpha = 0.8 * (1 - u);
  ctx.fillStyle = ev.color;
  fillFlame(ctx, ev.x, ev.y, ev.angle, len, w, 2);
  const petal = ev.style === "spread" ? 0.7 : 1;
  fillFlame(ctx, ev.x, ev.y, ev.angle - petal, len * 0.45, w * 0.45, 0);
  fillFlame(ctx, ev.x, ev.y, ev.angle + petal, len * 0.45, w * 0.45, 0);
  ctx.globalAlpha = 1 - u;
  ctx.fillStyle = COLOR_WHITE;
  fillFlame(ctx, ev.x, ev.y, ev.angle, len * 0.6, w * 0.45, 1);
  if (ev.style === "charge") {
    ctx.strokeStyle = ev.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ev.x, ev.y, 3 + 8 * easeOutCubic(u), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = SOURCE_OVER;
}

/** 命中の斬り裂き線・着弾・銃口の閃光。粒・文字より先、形（輪・線）の後に描く */
export function drawAttackAir(ctx: CanvasRenderingContext2D, state: GameState, glow: GlowFn): void {
  const layer = syncLayer(state);
  for (const ev of layer.events) {
    const age = state.time - ev.born;
    if (age < 0 || age >= ev.life) continue;
    switch (ev.kind) {
      case "slashSpark":
        drawSlashSpark(ctx, ev, age, glow);
        break;
      case "impact":
        drawImpact(ctx, ev, age, glow);
        break;
      case "muzzle":
        drawMuzzle(ctx, ev, age, glow);
        break;
      case "fizzle":
        drawFizzle(ctx, ev, age);
        break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.globalCompositeOperation = SOURCE_OVER;
}

// -----------------------------------------------------------------------------
// 斬撃の軌跡
// -----------------------------------------------------------------------------

export interface SlashTrailInput {
  /** 振りの中心（自分の位置） */
  ox: number;
  oy: number;
  /** 攻撃の向き（単位ベクトル） */
  dx: number;
  dy: number;
  shape: HitShape;
  reach: number;
  size: number;
  /** 弧の半径（reach × 軌跡の比） */
  radius: number;
  /** 段（振る向きの左右） */
  step: number;
  /** 振りの進み 0..1 */
  progress: number;
  /** 振り終わりの尾の残り 0..1（active 中は 1） */
  fade: number;
  /** 重い段・終撃・溜め */
  heavy: boolean;
  /** 武器種の軌跡の太さ（WEAPON_TRAIL_WIDTH） */
  trailWidth: number;
  whip: boolean;
  /** 鎌は内側にもう 1 本の三日月 */
  doubleArc: boolean;
  color: string;
}

/** 尾の端の濃さ（先端を 1 とした割合） */
const RIBBON_TAIL_ALPHA = 0.3;

interface RibbonPoint {
  x: number;
  y: number;
  /** 外縁（刃の通り道）への法線 */
  nx: number;
  ny: number;
  thick: number;
  f: number;
}

/** 帯を区切りごとの四角で塗る（尾ほど薄く）。外縁は (x, y)、内側へ thick + grow だけ太る（grow < 0 で外縁寄りの細い帯） */
function fillRibbon(ctx: CanvasRenderingContext2D, pts: readonly RibbonPoint[], color: string, alpha: number, grow: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const ta = Math.max(0, a.thick + grow);
    const tb = Math.max(0, b.thick + grow);
    if (ta <= 0 && tb <= 0) continue;
    ctx.globalAlpha = alpha * (RIBBON_TAIL_ALPHA + (1 - RIBBON_TAIL_ALPHA) * b.f);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x - b.nx * tb, b.y - b.ny * tb);
    ctx.lineTo(a.x - a.nx * ta, a.y - a.ny * ta);
    ctx.closePath();
    ctx.fill();
  }
}

/** 外縁の先端寄りに白い芯を引く */
function strokeCore(ctx: CanvasRenderingContext2D, pts: readonly RibbonPoint[], from: number, alpha: number, width: number): void {
  ctx.strokeStyle = COLOR_WHITE;
  ctx.lineWidth = width;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b || b.f < from) continue;
    ctx.globalAlpha = alpha * clamp01((b.f - from) / Math.max(0.01, 1 - from));
    ctx.beginPath();
    ctx.moveTo(a.x - a.nx * width * 0.5, a.y - a.ny * width * 0.5);
    ctx.lineTo(b.x - b.nx * width * 0.5, b.y - b.ny * width * 0.5);
    ctx.stroke();
  }
}

function arcRibbon(cx: number, cy: number, radius: number, from: number, sweep: number, progress: number, thick: number): RibbonPoint[] {
  const c = FX_ATTACK.slash;
  // 1 周する回転斬りは区切りが粗いと角ばるので、振り幅（半周ごと）に合わせて増やす
  const count = c.segments * Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI));
  return arcTrailSamples(from, sweep, progress, c.tailRatio, thick, count).map((s) => {
    const nx = Math.cos(s.angle);
    const ny = Math.sin(s.angle);
    return { x: cx + nx * radius, y: cy + ny * radius, nx, ny, thick: s.thick, f: s.f };
  });
}

/** 突き: 手元から穂先へ細く伸び、穂先の手前で最も太い槍の光 */
function thrustRibbon(input: SlashTrailInput, thick: number): RibbonPoint[] {
  const c = FX_ATTACK.slash;
  const n = c.segments;
  const reach = input.reach * easeOutCubic(input.progress);
  const start = input.reach * 0.1;
  const out: RibbonPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const d = start + (reach - start) * f;
    const t = thick * crescentProfile(f) * 0.5;
    // 帯を中心線の両側へ振り分けるため、外縁を中心線から t だけ外に置く
    out.push({ x: input.ox + input.dx * d - input.dy * t, y: input.oy + input.dy * d + input.dx * t, nx: -input.dy, ny: input.dx, thick: t * 2, f });
  }
  return out;
}

/** 鞭: しなる曲線に沿った細い帯 */
function whipRibbon(input: SlashTrailInput, thick: number): RibbonPoint[] {
  const c = FX_ATTACK.slash;
  const n = c.segments;
  const ex = input.ox + input.dx * input.reach;
  const ey = input.oy + input.dy * input.reach;
  const bend = Math.sin((1 - input.progress) * Math.PI) * 10;
  const mx = (input.ox + ex) / 2 - input.dy * bend;
  const my = (input.oy + ey) / 2 + input.dx * bend;
  const out: RibbonPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * clamp01(input.progress * 1.5);
    const k = 1 - f;
    const x = k * k * input.ox + 2 * k * f * mx + f * f * ex;
    const y = k * k * input.oy + 2 * k * f * my + f * f * ey;
    out.push({ x, y, nx: -input.dy, ny: input.dx, thick: thick * 0.5 * crescentProfile(i / n), f: i / n });
  }
  return out;
}

/** 箱の当たり判定（剣など）は、箱の手前を通る弧として振る */
const BOX_ARC_DEG = 110;
const BOX_ARC_RATIO = 0.5;
const CIRCLE_RADIUS_RATIO = 0.42;

function slashRibbons(input: SlashTrailInput, thick: number): RibbonPoint[][] {
  if (input.whip) return [whipRibbon(input, thick)];
  if (input.shape.kind === "thrust") return [thrustRibbon(input, thick)];
  const dir = Math.atan2(input.dy, input.dx);
  const sign = swingSign(input.step);
  if (input.shape.kind === "circle") {
    // 回転斬り: 当たり判定の円を 1 周する三日月
    const cx = input.ox + input.dx * input.reach;
    const cy = input.oy + input.dy * input.reach;
    return [arcRibbon(cx, cy, input.size * CIRCLE_RADIUS_RATIO, dir, sign * Math.PI * 2, input.progress, thick)];
  }
  const deg = input.shape.kind === "arc" ? input.shape.deg : BOX_ARC_DEG;
  const radius = input.shape.kind === "arc" ? input.radius : input.reach + input.size * BOX_ARC_RATIO;
  const half = (deg * Math.PI) / 360;
  const from = dir - sign * half;
  const main = arcRibbon(input.ox, input.oy, radius, from, sign * 2 * half, input.progress, thick);
  if (!input.doubleArc) return [main];
  return [main, arcRibbon(input.ox, input.oy, radius * 0.8, from, sign * 2 * half, input.progress, thick * 0.6)];
}

/**
 * 振りの軌跡（Hades 風の三日月）: 色の帯 → 加算の光の帯 → 先端寄りの白い芯 → 先端の光。
 * 尾ほど薄く細く、重い段・終撃は太く明るい。振り終わりは fade で数フレームかけて消える
 */
export function drawSlashTrail(ctx: CanvasRenderingContext2D, input: SlashTrailInput, glow: GlowFn): void {
  const c = FX_ATTACK.slash;
  const fade = clamp01(input.fade);
  if (fade <= 0 || input.progress <= 0) return;
  const heavyMul = input.heavy ? c.heavyMul : 1;
  const thick = (c.thickness + input.trailWidth * c.widthMul) * heavyMul;
  const ribbons = slashRibbons(input, thick);
  for (const pts of ribbons) {
    fillRibbon(ctx, pts, input.color, c.alpha * fade, 0);
    ctx.globalCompositeOperation = LIGHTER;
    fillRibbon(ctx, pts, input.color, c.glowAlpha * fade, -thick * 0.45);
    strokeCore(ctx, pts, c.coreFrom, c.coreAlpha * fade, input.heavy ? 2 : 1);
    ctx.globalCompositeOperation = SOURCE_OVER;
  }
  const head = ribbons[0]?.[ribbons[0].length - 1];
  if (head) glow(head.x - head.nx * thick * 0.3, head.y - head.ny * thick * 0.3, input.color, input.heavy ? c.heavyTipGlow : c.tipGlow, 0.8 * fade);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

// -----------------------------------------------------------------------------
// 弾の尾
// -----------------------------------------------------------------------------

/**
 * 弾の尾と光（弾の絵より先に描く）。hx / hy は描く位置（曲射は持ち上げた位置）、dx / dy は進む向き。
 * 貫通は長く細い針、溜め撃ちは太く大きな光、散弾は短く、曲射は短い煙の尾
 */
export function drawBulletTrail(
  ctx: CanvasRenderingContext2D,
  pr: Projectile,
  hx: number,
  hy: number,
  dx: number,
  dy: number,
  color: string,
  glow: GlowFn,
): void {
  const c = FX_ATTACK.bullet;
  const style = projectileStyle(pr);
  const player = pr.owner === "player";
  // 弾の見た目（BulletDef.look）: 尾の色（射撃の属性の色より優先）と光の大きさ。当たり方には関わらない
  const look = player ? pr.shot?.look : undefined;
  const tint = look ? (look.trail ?? look.color) : color;
  const speed = Math.hypot(pr.vel.x, pr.vel.y);
  const styleLen = style === "pierce" ? c.pierceTrailMul : style === "spread" ? 0.6 : style === "lob" || style === "mine" ? 0.35 : 1;
  const len = Math.min(c.maxTrail * styleLen, speed * c.trailTime * styleLen);
  const w = Math.max(1, pr.radius * (style === "charge" ? 1.3 : style === "pierce" ? 0.7 : 1));
  const glowR = Math.round((c.glow * (style === "charge" ? c.chargeGlowMul : 1) + pr.radius) * (look?.glow ? LOOK_GLOW_MUL : 1));
  if (player) glow(hx, hy, tint, glowR, c.glowAlpha);
  else glow(hx, hy, c.enemyColor, glowR, c.enemyGlowAlpha);
  if (len < 1) return;
  const tx = hx - dx * len;
  const ty = hy - dy * len;
  if (look?.trail) drawLookSparks(ctx, pr, hx, hy, dx, dy, len, look.trail);
  ctx.globalAlpha = c.trailAlpha;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.moveTo(hx - dy * w, hy + dx * w);
  ctx.lineTo(tx, ty);
  ctx.lineTo(hx + dy * w, hy - dx * w);
  ctx.closePath();
  ctx.fill();
  if (player) {
    ctx.globalCompositeOperation = LIGHTER;
    ctx.globalAlpha = c.coreAlpha;
    ctx.strokeStyle = COLOR_WHITE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - dx * len * 0.55, hy - dy * len * 0.55);
    ctx.stroke();
    ctx.globalCompositeOperation = SOURCE_OVER;
  }
  ctx.globalAlpha = 1;
}

/**
 * look.trail を持つ弾の尾に散る粒（火の粉・氷の欠片）。尾に沿った位置と横ぶれは弾の id と今の位置の座標ハッシュで決める
 * （state.rng を使わない。弾が動くと位置が変わってちらつく）
 */
function drawLookSparks(ctx: CanvasRenderingContext2D, pr: Projectile, hx: number, hy: number, dx: number, dy: number, len: number, color: string): void {
  ctx.globalAlpha = LOOK_SPARK_ALPHA;
  ctx.fillStyle = color;
  const cellX = Math.floor(pr.pos.x / LOOK_SPARK_CELL);
  const cellY = Math.floor(pr.pos.y / LOOK_SPARK_CELL);
  for (let i = 0; i < LOOK_SPARKS; i++) {
    const along = hash01(pr.id * LOOK_SPARKS + i, cellX) * len;
    const side = (hash01(cellY, pr.id * LOOK_SPARKS + i) - 0.5) * 2 * LOOK_SPARK_SPREAD;
    const x = hx - dx * along - dy * side;
    const y = hy - dy * along + dx * side;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  ctx.globalAlpha = 1;
}

// -----------------------------------------------------------------------------
// 輪・線（ShapeFx）
// -----------------------------------------------------------------------------

/** 爆発の段階: 煙の輪（下）→ 火球 → 閃光 → 衝撃の白い輪 → 破片 */
function drawBlast(ctx: CanvasRenderingContext2D, s: ShapeFx, glow: GlowFn): void {
  const c = FX_ATTACK.blast;
  const u = 1 - clamp01(s.life / s.maxLife);
  const st = blastStage(u, c.flashEnd, c.fireEnd);
  const R = s.radius;
  const seed = Math.round(s.pos.x * 7 + s.pos.y * 13);
  if (st.smoke > 0) {
    ctx.globalAlpha = c.smokeAlpha * st.smoke;
    ctx.fillStyle = c.smokeColor;
    const puffs = 8;
    for (let i = 0; i < puffs; i++) {
      const a = radialAngle(i, puffs, seed);
      const d = R * st.smokeR * 0.75;
      const pr = (2 + hash01(seed + i, i) * 3) * (1 + u);
      ctx.beginPath();
      ctx.arc(s.pos.x + Math.cos(a) * d, s.pos.y + Math.sin(a) * d * 0.8, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (st.fireball > 0) {
    ctx.globalAlpha = 0.85 * st.fireball;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, R * st.fireballR * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = LIGHTER;
    ctx.globalAlpha = st.fireball;
    ctx.fillStyle = mixColor(s.color, c.fireCore, 0.5);
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, R * st.fireballR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = st.fireball * st.fireball;
    ctx.fillStyle = c.fireCore;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, R * st.fireballR * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = SOURCE_OVER;
  }
  if (st.flash > 0) {
    glow(s.pos.x, s.pos.y, COLOR_WHITE, Math.round(R * 0.8), st.flash);
    ctx.globalCompositeOperation = LIGHTER;
    ctx.globalAlpha = st.flash;
    ctx.fillStyle = COLOR_WHITE;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, R * st.flashR * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = SOURCE_OVER;
  }
  ctx.globalAlpha = 0.8 * (1 - u);
  ctx.strokeStyle = COLOR_WHITE;
  ctx.lineWidth = u < 0.3 ? 2 : 1;
  ctx.beginPath();
  ctx.arc(s.pos.x, s.pos.y, Math.max(1, R * st.shockR), 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (let i = 0; i < c.debris; i++) {
    const a = radialAngle(i, c.debris, seed + 5);
    const d = R * c.debrisReach * easeOutCubic(u) * (0.6 + 0.4 * hash01(seed + i * 3, i));
    const size = u < 0.5 ? 2 : 1;
    ctx.globalAlpha = st.debris;
    ctx.fillStyle = i % 3 === 0 ? s.color : c.debrisColor;
    ctx.fillRect(Math.round(s.pos.x + Math.cos(a) * d), Math.round(s.pos.y + Math.sin(a) * d), size, size);
  }
}

/** 広がる輪: 外側の淡い光の帯・本体・生まれた瞬間の中の光 */
function drawRing(ctx: CanvasRenderingContext2D, s: ShapeFx): void {
  const c = FX_ATTACK.ring;
  const t = clamp01(s.life / s.maxLife);
  const age = s.maxLife - s.life;
  const r = s.radius * (1 - t * 0.6);
  if (age < c.flashTime) {
    ctx.globalCompositeOperation = LIGHTER;
    ctx.globalAlpha = c.flashAlpha * (1 - age / c.flashTime);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = SOURCE_OVER;
  }
  ctx.strokeStyle = s.color;
  ctx.globalCompositeOperation = LIGHTER;
  ctx.globalAlpha = c.glowAlpha * t;
  ctx.lineWidth = c.glowWidth;
  ctx.beginPath();
  ctx.arc(s.pos.x, s.pos.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalCompositeOperation = SOURCE_OVER;
  ctx.globalAlpha = t;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = COLOR_WHITE;
  ctx.globalAlpha = t * t * 0.7;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 稲妻として描く線の色（雷の属性・感電・雷のスキル・感電死） */
const BOLT_COLORS: ReadonlySet<string> = new Set([ELEMENT_FX_COLOR.lightning, STATUS.shockColor, deathColor("discharge"), COLOR_THUNDER].map((c) => c.toLowerCase()));

export function isBoltColor(color: string): boolean {
  return BOLT_COLORS.has(color.toLowerCase());
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: readonly Point[]): void {
  const first = pts[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/** 稲妻: 折れ線（光の帯 + 白い芯）と枝。形は時間で細かく瞬く */
function drawBolt(ctx: CanvasRenderingContext2D, s: ShapeFx): void {
  const c = FX_ATTACK.bolt;
  const t = clamp01(s.life / s.maxLife);
  const seed = Math.floor(s.life * c.flicker) * 101 + Math.round(s.pos.x) * 31 + Math.round(s.pos.y) * 17;
  const pts = boltPoints(s.pos, s.to, c.segments, c.jitter, seed);
  const len = Math.hypot(s.to.x - s.pos.x, s.to.y - s.pos.y);
  ctx.globalCompositeOperation = LIGHTER;
  ctx.strokeStyle = s.color;
  ctx.globalAlpha = c.glowAlpha * t;
  ctx.lineWidth = c.glowWidth;
  strokePolyline(ctx, pts);
  ctx.globalAlpha = t;
  ctx.lineWidth = 1;
  for (let b = 0; b < c.branches; b++) {
    const index = 1 + Math.floor(hash01(seed + b * 3, b) * Math.max(1, pts.length - 2));
    const branch = boltBranch(pts, index, seed + b, len * c.branchRatio);
    if (branch) strokePolyline(ctx, boltPoints(branch[0], branch[1], 3, c.jitter * 0.5, seed + b * 7));
  }
  ctx.strokeStyle = COLOR_WHITE;
  strokePolyline(ctx, pts);
  ctx.globalCompositeOperation = SOURCE_OVER;
}

const PLAIN_LINE_GLOW = 0.5;

/** 雷以外の線: 中点を揺らした線に淡い光の帯を重ねる */
function drawLine(ctx: CanvasRenderingContext2D, s: ShapeFx): void {
  const t = clamp01(s.life / s.maxLife);
  const mx = (s.pos.x + s.to.x) / 2 + Math.sin(s.life * 90) * 4;
  const my = (s.pos.y + s.to.y) / 2 + Math.cos(s.life * 90) * 4;
  const pts: Point[] = [s.pos, { x: mx, y: my }, s.to];
  ctx.strokeStyle = s.color;
  ctx.globalCompositeOperation = LIGHTER;
  // 斬撃の残像・鎖などにも使う線なので、稲妻より控えめに光らせる
  ctx.globalAlpha = FX_ATTACK.bolt.glowAlpha * PLAIN_LINE_GLOW * t;
  ctx.lineWidth = FX_ATTACK.bolt.glowWidth;
  strokePolyline(ctx, pts);
  ctx.globalCompositeOperation = SOURCE_OVER;
  ctx.globalAlpha = t;
  ctx.lineWidth = 1;
  strokePolyline(ctx, pts);
}

/** state.shapes（輪・線・爆発）を描く */
export function drawShapeFx(ctx: CanvasRenderingContext2D, shapes: readonly ShapeFx[], glow: GlowFn): void {
  for (const s of shapes) {
    if (s.kind === "ring") {
      if (isBlastShape(s)) drawBlast(ctx, s, glow);
      else drawRing(ctx, s);
      continue;
    }
    if (isBoltColor(s.color)) drawBolt(ctx, s);
    else drawLine(ctx, s);
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.globalCompositeOperation = SOURCE_OVER;
}

// -----------------------------------------------------------------------------
// 粒（属性ごとの形）
// -----------------------------------------------------------------------------

/** 粒の形: 炎 = 冷めていく火の粉、氷 = 結晶片、雷 = 瞬く火花、毒 = 泡、闇 = 芯の暗い粒、光 = 十字のきらめき */
export type ParticleLook = "square" | "ember" | "shard" | "spark" | "bubble" | "mote" | "glint";

const LOOK_BY_COLOR: ReadonlyMap<string, ParticleLook> = new Map<string, ParticleLook>(
  (
    [
      [ELEMENT_FX_COLOR.fire, "ember"],
      [STATUS.burnColor, "ember"],
      [STATUS.explodeColor, "ember"],
      [deathColor("ash"), "square"],
      [ELEMENT_FX_COLOR.ice, "shard"],
      [STATUS.chillColor, "shard"],
      [deathColor("shatter"), "shard"],
      [ELEMENT_FX_COLOR.lightning, "spark"],
      [STATUS.shockColor, "spark"],
      [ELEMENT_FX_COLOR.poison, "bubble"],
      [deathColor("melt"), "bubble"],
      [ELEMENT_FX_COLOR.dark, "mote"],
      [deathColor("void"), "mote"],
      [ELEMENT_FX_COLOR.light, "glint"],
      [deathColor("holy"), "glint"],
    ] as const
  ).map(([color, look]) => [color.toLowerCase(), look]),
);

export function particleLook(color: string): ParticleLook {
  return LOOK_BY_COLOR.get(color.toLowerCase()) ?? "square";
}

const MOTE_CORE = "#200830";
const SPARK_FLICKER = 40;

function drawStreak(ctx: CanvasRenderingContext2D, p: Particle, color: string, size: number): void {
  const c = FX_ATTACK.particle;
  const speed = Math.hypot(p.vel.x, p.vel.y);
  if (speed < c.streakMinSpeed) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.round(size * 0.6));
  ctx.beginPath();
  ctx.moveTo(p.pos.x - p.vel.x * c.streakTime, p.pos.y - p.vel.y * c.streakTime);
  ctx.lineTo(p.pos.x, p.pos.y);
  ctx.stroke();
}

function drawOneParticle(ctx: CanvasRenderingContext2D, p: Particle, time: number): void {
  const a = clamp01(p.life / p.maxLife);
  const s = Math.max(1, Math.ceil(p.size));
  const x = Math.round(p.pos.x - s / 2);
  const y = Math.round(p.pos.y - s / 2);
  ctx.globalAlpha = a;
  switch (particleLook(p.color)) {
    case "ember": {
      const c = FX_ATTACK.particle;
      const color = a > 0.7 ? c.emberHot : a > 0.3 ? p.color : c.emberCool;
      drawStreak(ctx, p, color, s);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, s, s);
      return;
    }
    case "shard": {
      drawStreak(ctx, p, p.color, 1);
      ctx.fillStyle = p.color;
      const cx = Math.round(p.pos.x);
      const cy = Math.round(p.pos.y);
      ctx.fillRect(cx - 1, cy, 3, 1);
      ctx.fillRect(cx, cy - 1, 1, 3);
      if (a > 0.5) {
        ctx.fillStyle = COLOR_WHITE;
        ctx.fillRect(cx, cy, 1, 1);
      }
      return;
    }
    case "spark": {
      drawStreak(ctx, p, p.color, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, s, s);
      const flick = hash01(Math.floor(time * SPARK_FLICKER) + p.pos.x, p.pos.y) < 0.5 ? -1 : 1;
      ctx.fillStyle = COLOR_WHITE;
      ctx.fillRect(x + flick, y - flick, 1, 1);
      return;
    }
    case "bubble": {
      ctx.fillStyle = p.color;
      if (s < 3) {
        ctx.fillRect(x, y, s, s);
        return;
      }
      ctx.fillRect(x + 1, y, s - 2, 1);
      ctx.fillRect(x + 1, y + s - 1, s - 2, 1);
      ctx.fillRect(x, y + 1, 1, s - 2);
      ctx.fillRect(x + s - 1, y + 1, 1, s - 2);
      return;
    }
    case "mote": {
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, s, s);
      if (s >= 2) {
        ctx.fillStyle = MOTE_CORE;
        ctx.fillRect(Math.round(p.pos.x), Math.round(p.pos.y), 1, 1);
      }
      return;
    }
    case "glint": {
      const arm = Math.max(1, Math.round(s * a));
      const cx = Math.round(p.pos.x);
      const cy = Math.round(p.pos.y);
      ctx.fillStyle = p.color;
      ctx.fillRect(cx - arm, cy, arm * 2 + 1, 1);
      ctx.fillRect(cx, cy - arm, 1, arm * 2 + 1);
      return;
    }
    case "square":
      drawStreak(ctx, p, p.color, s);
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, s, s);
      return;
  }
}

/** state.particles を属性ごとの形で描く。速い粒は速度の向きに短い尾を引く */
export function drawParticleFx(ctx: CanvasRenderingContext2D, particles: readonly Particle[], time: number): void {
  for (const p of particles) drawOneParticle(ctx, p, time);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

/** 今残っている演出の数（種類ごと）と焦げ跡の数。テストと QA の読み取り窓口 */
export function attackFxCounts(state: GameState): { events: Readonly<Record<FxEventKind, number>>; scorches: number } {
  const layer = syncLayer(state);
  const events: Record<FxEventKind, number> = { slashSpark: 0, impact: 0, muzzle: 0, fizzle: 0 };
  for (const ev of layer.events) events[ev.kind] += 1;
  return { events, scorches: layer.scorches.length };
}
