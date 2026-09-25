import { type Enemy, type GameState, type UltimateState, pushSfx } from "../core/state";
import type { StatusApply } from "../core/status";
import { type Vec, add, angle, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { pushPlayerEvent } from "../core/events";
import { enemyDef } from "../data/enemies";
import { FEEL, ULTIMATE } from "../data/tuning";
import type { LungeAct, NovaAct, PullAct, BuffAct, SustainDef, SustainPatch, UltimateAct, UltimateDef } from "../data/ultimates";
import { ultimateDef } from "../data/ultimates";
import {
  type ActionStepDef,
  type BulletDef,
  type MeleeChargeDef,
  type MeleeStepDef,
  type MovesetDef,
  type MovesetKey,
  type ThrowArtDef,
  DEFAULT_MOVESET,
  MOVESETS,
} from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { ultimateChoice } from "../loot/profile";
import type { AttrRatio, PlayerStats, Scaling } from "../loot/types";
import { scaled, withRatio } from "./attributes";
import { onBoonBurstKills } from "./boons";
import { cancelAttack, damageEnemy, healPlayer, rollOutgoing } from "./combat";
import { addFloatingText, hitstop, shake, spawnBlast, spawnBurst, spawnLine, spawnRing } from "./effects";
import { gainMana } from "./mana";
import { boxCircleOverlap, circlesOverlap, moveBody } from "./physics";
import { emitVolley, spreadOffsets } from "./player";
import { applyStatus, hasStatus } from "./statusEffects";
import { placeTerrain } from "./terrain";
import { detonateOwnMines, recallShots } from "./weaponArts";
import { endShape } from "../skills/forms";

/**
 * 奥義（F。docs/ideas/ougi-and-dual-actions.md 3.2）。奥義ゲージが満タンなら、選んだ奥義を出す。
 * 一撃（instant）は行為の列を発動の瞬間に出し切り、持続（sustain）はゲージが減る間 Player.ultimate.active に key を置く。
 * 持続中の倍率・差し替えは player.ts / combat.ts の 1 行の呼び出し（ultimateMoveset / ultimateOutgoingMul など）から効く
 */

/** 奥義を終えた理由（手動 = もう一度 F / 尽きた = ゲージ 0 / 変身 = 変身を撃った） */
export type UltimateEndReason = "manual" | "drained" | "form";

const NOT_READY_TEXT = "未充填";
const NOT_READY_COLOR = "#808080";
const NOT_READY_SCALE = 0.9;
const NOT_READY_LIFE = 0.4;
const CAST_TEXT_SCALE = 1.8;
const CAST_TEXT_LIFE = 0.8;
const END_TEXT = "奥義が終わった";
const END_TEXT_SCALE = 1;
const END_TEXT_LIFE = 0.6;
const FLASH_WHITE = "#ffffff";
const BURST_PARTICLES = 40;
const BURST_SPEED = 260;
const BURST_LIFE = 0.5;
const BURST_SIZE = 3;
const FLASH_PARTICLES = 20;
const FLASH_SPEED = 120;
const FLASH_LIFE = 0.3;
const FLASH_SIZE = 2;
const SCREEN_FLASH = 0.5;
/** 持続の始まりは一撃より控えめ（ここから殴り続けるので画面を白く飛ばしすぎない） */
const SUSTAIN_FLASH = 0.3;
const SUSTAIN_HITSTOP = 4;
const SUSTAIN_RING_MUL = 4;
const RING_LIFE = 0.45;
const LINE_LIFE = 0.3;
const BLAST_COLOR = "#ffb040";
const AURA_COLOR = "#fff080";
/** 命中の衝撃波（鉄槌の律）の色と粒 */
const QUAKE_COLOR = "#ffc070";
const QUAKE_PARTICLES = 16;
const QUAKE_PARTICLE_SPEED = 180;
const AURA_LIFE = 0.2;
/** 突進の残像の粒（通り道に等間隔に置く） */
const LUNGE_GHOSTS = 6;
const GHOST_LIFE = 0.25;
const GHOST_SIZE = 4;
const DEG_TO_RAD = Math.PI / 180;
const STILL_SPEED = 1;
const DEFAULT_HITS = 1;
const NO_ENEMY_DISTANCE = Number.POSITIVE_INFINITY;

export function createUltimateState(): UltimateState {
  return { active: null, elapsed: 0, kills: 0, auraTick: 0, quakeCooldown: 0 };
}

/** 装備の武器種（変身中も変身前の武器種。武器なし・旧形式は既定） */
function equippedMoveset(state: GameState): MovesetKey {
  const key = state.stats.moveset;
  return MOVESETS[key] ? key : DEFAULT_MOVESET;
}

/** 今の武器種で選んでいる奥義。選択が無い・壊れている・武器種違いなら 1 本目（規則は loot/profile.ts の ultimateChoice） */
export function chosenUltimate(state: GameState): UltimateDef {
  return ultimateChoice(state.profile, equippedMoveset(state));
}

type SustainUltimate = UltimateDef & { kind: "sustain" };

/** 今選んでいる奥義を出すのに要る奥義ゲージ（奥義ごとの cost） */
export function ultimateCost(state: GameState): number {
  return chosenUltimate(state).cost;
}

/** 奥義ゲージが今選んでいる奥義の cost に届いているか（HUD の満タン表示・「ゲージ満タン」の条件もこれ） */
export function ultimateReady(state: GameState): boolean {
  return state.player.energy >= ultimateCost(state);
}

/** 持続中の奥義（無ければ undefined） */
function activeSustain(state: GameState): SustainUltimate | undefined {
  const key = state.player.ultimate.active;
  if (key === null) return undefined;
  const def = ultimateDef(key);
  return def?.kind === "sustain" ? def : undefined;
}

/** 奥義の行為の威力（係数表の評価 × burstDamageMul）。sustain 中の通常攻撃には掛けない */
export function ultimateDamage(stats: Readonly<PlayerStats>, scaling: Scaling): number {
  return scaled(stats, scaling) * stats.burstDamageMul;
}

/**
 * F の押下（player.ts の readActions から）。出した・終えたら true（呼び出し側がスキルをキャンセルする）。
 * 持続中に押したら終える（残りのゲージは保つ）
 */
export function tryUltimate(state: GameState): boolean {
  const p = state.player;
  if (p.ultimate.active !== null) {
    endUltimate(state, "manual");
    return true;
  }
  const def = chosenUltimate(state);
  if (p.energy < def.cost) {
    addFloatingText(state, p.body.pos, NOT_READY_TEXT, NOT_READY_COLOR, NOT_READY_SCALE, NOT_READY_LIFE);
    return false;
  }
  if (def.kind === "sustain") {
    startSustain(state, def);
    return true;
  }
  castInstant(state, def);
  return true;
}

// ---------------------------------------------------------------------------
// 一撃（instant）
// ---------------------------------------------------------------------------

/** 一撃の奥義: ゲージを cost だけ払い、振りを止めて行為の列を出す。発動時に onBurst（量 = 倒した数） */
function castInstant(state: GameState, def: UltimateDef & { kind: "instant" }): void {
  const p = state.player;
  p.energy = Math.max(0, p.energy - def.cost);
  cancelAttack(state);
  let kills = 0;
  for (const act of def.acts) kills += runAct(state, def, act);
  if (def.healPerKill !== undefined && kills > 0) healPlayer(state, p.maxHp * def.healPerKill * kills);
  castFx(state, def.name);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeSpecial);
  state.flash = Math.max(state.flash, SCREEN_FLASH);
  p.invulnTimer = Math.max(p.invulnTimer, def.invuln);
  pushSfx(state, "burst");
  onBoonBurstKills(state, kills);
  pushPlayerEvent(state, "onBurst", "burst", { amount: kills });
}

/** 発動の合図（奥義名の浮き文字と金の粒） */
function castFx(state: GameState, name: string): void {
  const pos = state.player.body.pos;
  const color = ULTIMATE.common.textColor;
  spawnBurst(state, pos, color, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  spawnBurst(state, pos, FLASH_WHITE, FLASH_PARTICLES, FLASH_SPEED, FLASH_LIFE, FLASH_SIZE);
  addFloatingText(state, pos, name, color, CAST_TEXT_SCALE, CAST_TEXT_LIFE);
}

/** 行為を 1 つ出す。倒した数を返す */
function runAct(state: GameState, def: UltimateDef, act: UltimateAct): number {
  switch (act.kind) {
    case "nova":
      return runNova(state, def, act);
    case "swing":
      return runSwing(state, def, act.step);
    case "lunge":
      return runLunge(state, def, act);
    case "volley":
      runVolley(state, act.throw);
      return 0;
    case "pull":
      runPull(state, act);
      return 0;
    case "buff":
      runBuff(state, act);
      return 0;
    case "detonate":
      runDetonate(state, act.damageMul ?? 1);
      return 0;
  }
}

/** 1 ヒットぶんの数値（ステータスと倍率を評価済み） */
interface HitSpec {
  damage: number;
  poise: number;
  knockback: number;
  heavy: boolean;
  hits: number;
  applies: readonly StatusApply[];
  pull: boolean;
}

interface HitSource {
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
  readonly knockback: number;
  readonly heavy?: boolean;
  readonly hits?: number;
  readonly applies?: readonly StatusApply[];
  readonly pull?: boolean;
}

function hitSpec(state: GameState, src: HitSource): HitSpec {
  const s = state.stats;
  return {
    damage: ultimateDamage(s, src.scaling),
    poise: withRatio(s, src.poise, src.poiseRatio) * s.poiseDamageMul,
    knockback: src.knockback * s.knockbackMul,
    heavy: src.heavy === true,
    hits: Math.max(DEFAULT_HITS, src.hits ?? DEFAULT_HITS),
    applies: src.applies ?? [],
    pull: src.pull === true,
  };
}

/** 敵 1 体へ hits 回当てる（素性は奥義のもの）。倒したら true */
function strikeEnemy(state: GameState, def: UltimateDef, e: Enemy, spec: HitSpec, from: Vec): boolean {
  const away = normalize(sub(e.body.pos, from), state.player.facing);
  const dir = spec.pull ? scale(away, -1) : away;
  const hitstopSteps = spec.heavy ? FEEL.hitstopHeavy : FEEL.hitstopLight;
  let killed = false;
  for (let i = 0; i < spec.hits && !killed; i++) {
    if (spec.heavy) e.wallSplat = true;
    const out = rollOutgoing(state, e, spec.damage, "proc", { attack: def.attack });
    killed = damageEnemy(state, e, out.amount, dir, spec.knockback, { poise: spec.poise, hitstopSteps, crit: out.crit });
  }
  if (!killed) for (const apply of spec.applies) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
  return killed;
}

function isBoss(e: Enemy): boolean {
  const def = enemyDef(e.defKey);
  return def.boss === true || def.bossPart === true;
}

/** 生命が割合以下の敵（ボスを除く）を倒す。倒したら true */
function tryExecute(state: GameState, e: Enemy, ratio: number, dir: Vec): boolean {
  if (e.hp <= 0 || isBoss(e) || e.hp > e.maxHp * ratio) return false;
  return damageEnemy(state, e, e.hp, dir, 0, { hitstopSteps: FEEL.hitstopHeavy });
}

/**
 * 周囲攻撃（円月など）。半径に burstRadiusMul、威力に burstDamageMul。distance があれば照準の先（近くの敵へ寄せる）に
 * count 個の爆発として出す。clearsBullets なら範囲内の敵弾を消す
 */
function runNova(state: GameState, def: UltimateDef, act: NovaAct): number {
  const s = state.stats;
  const radius = act.radius * s.burstRadiusMul;
  const spec = hitSpec(state, act);
  const centers = novaCenters(state, act);
  const struck = new Set<number>();
  let kills = 0;
  for (const c of centers) {
    novaFx(state, act, c, radius);
    for (const e of state.enemies) {
      if (e.hp <= 0 || struck.has(e.id) || !circlesOverlap(c.x, c.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
      struck.add(e.id);
      if (strikeEnemy(state, def, e, spec, c)) kills += 1;
      else if (act.execute !== undefined && tryExecute(state, e, act.execute, sub(e.body.pos, c))) kills += 1;
    }
    if (act.terrain !== undefined) placeTerrain(state, c.x, c.y, act.terrain, radius, act.terrainDuration);
    if (act.clearsBullets) clearEnemyBullets(state, c, radius);
  }
  return kills;
}

/** 周囲攻撃の中心。distance が無ければ自分、あれば照準の先（自動照準）に count 個を扇に並べる */
function novaCenters(state: GameState, act: NovaAct): Vec[] {
  const p = state.player;
  if (act.distance === undefined) return [{ ...p.body.pos }];
  const target = autoAim(state, act.distance);
  const d = target ? length(sub(target, p.body.pos)) : act.distance;
  const base = target ? angle(sub(target, p.body.pos)) : angle(p.facing);
  return spreadOffsets(act.count ?? DEFAULT_HITS, act.spreadDeg ?? 0).map((o) => add(p.body.pos, scale(fromAngle(base + o), d)));
}

/** 照準方向の近くにいる最も近い敵の位置（いなければ undefined）。着弾の爆発を当てやすくする */
function autoAim(state: GameState, distance: number): Vec | undefined {
  const p = state.player;
  const facing = angle(p.facing);
  let best: Vec | undefined;
  let bestDist = NO_ENEMY_DISTANCE;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden) continue;
    const rel = sub(e.body.pos, p.body.pos);
    const d = length(rel);
    if (d > distance * ULTIMATE.common.autoAimRangeMul || d >= bestDist) continue;
    if (Math.abs(angleDiff(angle(rel), facing)) > ULTIMATE.common.autoAimDeg * DEG_TO_RAD) continue;
    best = { ...e.body.pos };
    bestDist = d;
  }
  return best;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function novaFx(state: GameState, act: NovaAct, c: Vec, radius: number): void {
  if (act.distance === undefined) {
    spawnRing(state, c, radius, ULTIMATE.common.textColor, RING_LIFE);
    return;
  }
  spawnLine(state, state.player.body.pos, c, BLAST_COLOR, LINE_LIFE);
  spawnBlast(state, c, radius, BLAST_COLOR);
  pushSfx(state, "explode");
}

function clearEnemyBullets(state: GameState, c: Vec, radius: number): void {
  for (const pr of state.projectiles) {
    if (pr.owner === "enemy" && circlesOverlap(c.x, c.y, radius, pr.pos.x, pr.pos.y, pr.radius)) pr.life = 0;
  }
}

/** 一瞬の振り（形は step の shape）。照準方向へ出し切る */
function runSwing(state: GameState, def: UltimateDef, step: MeleeStepDef): number {
  const p = state.player;
  const origin = { ...p.body.pos };
  const dir = { ...p.facing };
  const spec = hitSpec(state, step);
  let kills = 0;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !inStrike(origin, dir, step, e.body.pos, e.body.radius)) continue;
    if (strikeEnemy(state, def, e, spec, origin)) kills += 1;
  }
  swingFx(state, origin, dir, step);
  return kills;
}

/** 振りの形（player.ts の meleeContact と同じ意味の reach / size）に円が入っているか */
function inStrike(origin: Vec, dir: Vec, step: MeleeStepDef, pos: Vec, radius: number): boolean {
  const shape = step.shape;
  switch (shape.kind) {
    case "box": {
      const c = add(origin, scale(dir, step.reach));
      return boxCircleOverlap({ x: c.x - step.size / 2, y: c.y - step.size / 2, w: step.size, h: step.size }, pos.x, pos.y, radius);
    }
    case "circle": {
      const c = add(origin, scale(dir, step.reach));
      return circlesOverlap(c.x, c.y, step.size / 2, pos.x, pos.y, radius);
    }
    case "arc": {
      const rel = sub(pos, origin);
      const d = length(rel);
      if (d > step.reach + radius) return false;
      if (d <= radius) return true;
      const slack = Math.asin(Math.min(1, radius / d));
      return Math.abs(angleDiff(angle(rel), angle(dir))) <= (shape.deg * DEG_TO_RAD) / 2 + slack;
    }
    case "thrust":
      return inBand(origin, dir, step.reach, step.size, pos, radius);
  }
}

/** 帯（突き・突進の通り道）: origin から dir へ長さ len、幅 width */
function inBand(origin: Vec, dir: Vec, len: number, width: number, pos: Vec, radius: number): boolean {
  const rel = sub(pos, origin);
  const along = rel.x * dir.x + rel.y * dir.y;
  const across = Math.abs(rel.x * dir.y - rel.y * dir.x);
  return along >= -radius && along <= len + radius && across <= width / 2 + radius;
}

/** 振りの見た目（形に沿った線と輪） */
function swingFx(state: GameState, origin: Vec, dir: Vec, step: MeleeStepDef): void {
  const color = step.trail ?? ULTIMATE.common.textColor;
  const shape = step.shape;
  if (shape.kind === "circle" || shape.kind === "box") {
    spawnRing(state, add(origin, scale(dir, step.reach)), step.size / 2, color, RING_LIFE);
    return;
  }
  const base = angle(dir);
  const half = shape.kind === "arc" ? (shape.deg * DEG_TO_RAD) / 2 : 0;
  const rays = half > 0 ? [base - half, base - half / 2, base, base + half / 2, base + half] : [base];
  for (const a of rays) spawnLine(state, origin, add(origin, scale(fromAngle(a), step.reach)), color, LINE_LIFE);
}

/** 突進: 照準方向へ distance 進み（壁の手前で止まる）、通り道の帯にいる敵を斬る。踏み込みの間は無敵 */
function runLunge(state: GameState, def: UltimateDef, act: LungeAct): number {
  const p = state.player;
  const start = { ...p.body.pos };
  const dir = { ...p.facing };
  moveBody(state, p.body, dir.x * act.distance, dir.y * act.distance);
  const travelled = length(sub(p.body.pos, start));
  p.invulnTimer = Math.max(p.invulnTimer, act.invuln);
  const spec = hitSpec(state, act.step);
  let kills = 0;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !inBand(start, dir, travelled, act.step.size, e.body.pos, e.body.radius)) continue;
    if (strikeEnemy(state, def, e, spec, start)) kills += 1;
  }
  lungeFx(state, start, p.body.pos, act.step.trail ?? ULTIMATE.common.textColor);
  return kills;
}

function lungeFx(state: GameState, from: Vec, to: Vec, color: string): void {
  spawnLine(state, from, to, color, LINE_LIFE);
  spawnLine(state, from, to, FLASH_WHITE, LINE_LIFE / 2);
  for (let i = 0; i <= LUNGE_GHOSTS; i++) {
    const t = i / LUNGE_GHOSTS;
    const pos = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    state.particles.push({ pos, vel: { x: 0, y: 0 }, life: GHOST_LIFE, maxLife: GHOST_LIFE, color, size: GHOST_SIZE, drag: 1 });
  }
}

/** 弾を出す（射撃扱い）。威力は係数 × burstDamageMul、曲射は近くの敵までの距離に落とす */
function runVolley(state: GameState, t: ThrowArtDef): void {
  const s = state.stats;
  const target = autoAim(state, Number.POSITIVE_INFINITY);
  const aim = target ? length(sub(target, state.player.body.pos)) : undefined;
  emitVolley(state, t.bullet, 0, aim, {
    damage: ultimateDamage(s, t.scaling),
    poise: withRatio(s, t.poise, t.poiseRatio) * s.poiseDamageMul,
    count: t.count,
    spreadDeg: t.spreadDeg,
    attack: t.attack,
    recoil: false,
    sprite: t.sprite,
  });
}

/** 引き寄せ: 半径（burstRadiusMul）内の敵を toDistance まで寄せる（壁の手前で止まる）。single なら最も近い 1 体 */
function runPull(state: GameState, act: PullAct): void {
  const p = state.player;
  const radius = act.radius * state.stats.burstRadiusMul;
  const inRange = state.enemies.filter(
    (e) => e.hp > 0 && !e.hidden && circlesOverlap(p.body.pos.x, p.body.pos.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius),
  );
  const targets = act.single ? nearest(p.body.pos, inRange) : inRange;
  for (const e of targets) {
    const from = { ...e.body.pos };
    const rel = sub(e.body.pos, p.body.pos);
    const d = length(rel);
    if (d > act.toDistance) {
      const move = scale(normalize(rel), act.toDistance - d);
      moveBody(state, e.body, move.x, move.y);
    }
    spawnLine(state, from, e.body.pos, ULTIMATE.common.textColor, LINE_LIFE);
    for (const apply of act.applies ?? []) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
  }
}

function nearest(pos: Vec, enemies: readonly Enemy[]): Enemy[] {
  let best: Enemy | undefined;
  let bestDist = NO_ENEMY_DISTANCE;
  for (const e of enemies) {
    const d = length(sub(e.body.pos, pos));
    if (d >= bestDist) continue;
    best = e;
    bestDist = d;
  }
  return best ? [best] : [];
}

/** 自分への効果（与ダメ・移動の強化、無敵、回復、気力、反動） */
function runBuff(state: GameState, act: BuffAct): void {
  const p = state.player;
  if (act.damageMul !== undefined && act.duration > 0) p.buffs.damage = { mul: act.damageMul, time: act.duration };
  if (act.speedMul !== undefined && act.duration > 0) p.buffs.speed = { mul: act.speedMul, time: act.duration };
  if (act.invuln !== undefined) p.buffs.invuln = Math.max(p.buffs.invuln, act.invuln);
  if (act.heal !== undefined) healPlayer(state, p.maxHp * act.heal);
  if (act.mana !== undefined) gainMana(state, act.mana);
  if (act.selfKnock !== undefined) p.knock = sub(p.knock, scale(p.facing, act.selfKnock));
}

/** 床の自分の設置弾を強めてから全部起爆する（炸裂は projectiles.ts の信管切れの経路） */
function runDetonate(state: GameState, damageMul: number): void {
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.life <= 0 || pr.shot?.detonated) continue;
    if (pr.shot && BULLETS[pr.shot.key]?.mine) pr.damage *= damageMul;
  }
  detonateOwnMines(state);
}

// ---------------------------------------------------------------------------
// 持続（sustain）
// ---------------------------------------------------------------------------

/** 持続の奥義を始める（ゲージはそのまま減り始める）。変身中なら変身を解く（同時には立てない） */
function startSustain(state: GameState, def: SustainUltimate): void {
  if (state.skills.shape) endShape(state, "manual");
  const u = state.player.ultimate;
  // 持続は必要量（cost）ぶんのゲージを使い切るまで続く。cost の低い持続が満タンから出して長く続かないように
  state.player.energy = Math.min(state.player.energy, def.cost);
  u.active = def.key;
  u.elapsed = 0;
  u.kills = 0;
  u.auraTick = 0;
  u.quakeCooldown = 0;
  const pos = state.player.body.pos;
  castFx(state, def.name);
  spawnRing(state, pos, state.player.body.radius * SUSTAIN_RING_MUL, ULTIMATE.common.textColor, RING_LIFE);
  hitstop(state, SUSTAIN_HITSTOP);
  shake(state, FEEL.shakeHeavy);
  state.flash = Math.max(state.flash, SUSTAIN_FLASH);
  pushSfx(state, "burst");
}

/**
 * 持続の奥義を終える。終わりの行為（反動など）を出し、差し替えた段の振りの途中なら止め、
 * onBurst（量 = 持続中の撃破数）を積む。持続中でなければ何もしない
 */
export function endUltimate(state: GameState, _reason: UltimateEndReason): void {
  const u = state.player.ultimate;
  if (u.active === null) return;
  const def = activeSustain(state);
  const kills = u.kills;
  u.active = null;
  u.elapsed = 0;
  u.kills = 0;
  u.auraTick = 0;
  u.quakeCooldown = 0;
  if (def) {
    for (const act of def.sustain.onEnd ?? []) runAct(state, def, act);
    // 差し替えた段は装備の型では引けないので、振りの途中なら止める（変身の endShape と同じ）
    if (changesMoveset(def.sustain) && state.player.attack.phase !== "none") cancelAttack(state);
    addFloatingText(state, state.player.body.pos, END_TEXT, ULTIMATE.common.endTextColor, END_TEXT_SCALE, END_TEXT_LIFE);
    pushSfx(state, "formShift");
  }
  onBoonBurstKills(state, kills);
  pushPlayerEvent(state, "onBurst", "burst", { amount: kills });
}

/** 奥義の時間を進める（player.ts の updatePlayer で updateArt の直後）。持続中はゲージを減らし、纏い・手元返しを出し、尽きたら終える */
export function updateUltimate(state: GameState, dt: number): void {
  const def = activeSustain(state);
  if (!def) return;
  const p = state.player;
  const before = p.ultimate.elapsed;
  p.ultimate.elapsed += dt;
  p.energy = Math.max(0, p.energy - def.sustain.drainPerSec * dt);
  p.ultimate.quakeCooldown = Math.max(0, p.ultimate.quakeCooldown - dt);
  tickAura(state, def, dt);
  const recall = def.sustain.recall;
  if (recall && crossed(before, p.ultimate.elapsed, recall.interval)) recallShots(state, recall);
  if (def.sustain.minePull) pullToMines(state, def.sustain.minePull, dt);
  if (p.energy <= 0 && p.ultimate.elapsed >= def.sustain.minSec) endUltimate(state, "drained");
}

/** 経過が interval の倍数をまたいだか（決定的な周期。乱数も実時間も使わない） */
function crossed(before: number, after: number, interval: number): boolean {
  if (interval <= 0) return false;
  return Math.floor(after / interval) > Math.floor(before / interval);
}

/** 纏い: interval 秒ごとに周り（burstRadiusMul）の敵へ当てる */
function tickAura(state: GameState, def: SustainUltimate, dt: number): void {
  const aura = def.sustain.aura;
  if (!aura) return;
  const u = state.player.ultimate;
  u.auraTick -= dt;
  if (u.auraTick > 0) return;
  u.auraTick += aura.interval;
  const pos = state.player.body.pos;
  const radius = aura.radius * state.stats.burstRadiusMul;
  const spec = hitSpec(state, { scaling: aura.scaling, poise: aura.poise, knockback: 0 });
  spawnRing(state, pos, radius, AURA_COLOR, AURA_LIFE);
  for (const e of state.enemies) {
    if (e.hp <= 0 || !circlesOverlap(pos.x, pos.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    strikeEnemy(state, def, e, spec, pos);
  }
}

/**
 * 振り始め（player.ts の beginSwing から）。持続の swingVolley があれば、左の振りのたびに体の前（銃口の位置）から照準方向へ撃つ。
 * Rule の onSwing → volley は体の中心から撃つ拳銃の弾で、近接の間合いの敵に当たってすぐ消えて見えなかった
 */
export function ultimateOnSwing(state: GameState): void {
  const t = activeSustain(state)?.sustain.swingVolley;
  if (!t || state.player.attack.lane !== "primary") return;
  const s = state.stats;
  emitVolley(state, t.bullet, 0, undefined, {
    damage: scaled(s, t.scaling),
    poise: withRatio(s, t.poise, t.poiseRatio) * s.poiseDamageMul,
    count: t.count,
    spreadDeg: t.spreadDeg,
    attack: t.attack,
    recoil: false,
  });
}

/** 近接の命中（player.ts の meleeHitEnemy から）。持続の hitQuake があれば、当てた敵の位置で衝撃波を起こす（icd 秒に 1 回） */
export function ultimateOnSwingHit(state: GameState, target: Enemy): void {
  const def = activeSustain(state);
  const quake = def?.sustain.hitQuake;
  const u = state.player.ultimate;
  if (!def || !quake || u.quakeCooldown > 0) return;
  u.quakeCooldown = quake.icd;
  const c = { ...target.body.pos };
  const radius = quake.radius * state.stats.burstRadiusMul;
  const spec = hitSpec(state, { scaling: quake.scaling, poise: quake.poise, poiseRatio: quake.poiseRatio, knockback: quake.knockback });
  spawnRing(state, c, radius, QUAKE_COLOR, RING_LIFE);
  spawnBlast(state, c, radius, QUAKE_COLOR);
  spawnBurst(state, c, QUAKE_COLOR, QUAKE_PARTICLES, QUAKE_PARTICLE_SPEED, BURST_LIFE, BURST_SIZE);
  hitstop(state, quake.hitstop);
  shake(state, quake.shake);
  pushSfx(state, "explode");
  for (const e of state.enemies) {
    if (e.hp <= 0 || !circlesOverlap(c.x, c.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    strikeEnemy(state, def, e, spec, c);
  }
}

/** 床の自分の設置弾が近くの敵を引き寄せる（壁の手前で止まる） */
function pullToMines(state: GameState, pull: NonNullable<SustainDef["minePull"]>, dt: number): void {
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.life <= 0 || !pr.shot || pr.shot.detonated || !BULLETS[pr.shot.key]?.mine) continue;
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.hidden) continue;
      const rel = sub(pr.pos, e.body.pos);
      const d = length(rel);
      if (d > pull.radius || d <= e.body.radius) continue;
      const step = scale(normalize(rel), Math.min(d, pull.speed * dt));
      moveBody(state, e.body, step.x, step.y);
    }
  }
}

// ---------------------------------------------------------------------------
// 持続中の差し替え（player.ts / combat.ts から 1 行で呼ぶ）
// ---------------------------------------------------------------------------

/** 型を差し替える持続か（段の差し替え・命中付与・振りの速さ・怯み値） */
function changesMoveset(s: SustainDef): boolean {
  return s.patch !== undefined || (s.applies?.length ?? 0) > 0 || s.mul.attackSpeed !== undefined || s.mul.poise !== undefined;
}

/** 入力の型 × 奥義の key ごとの合成済みの型（毎ステップ新しいオブジェクトを作らない。中身は定義から決まるので決定性に影響しない） */
const MOVESET_CACHE = new WeakMap<MovesetDef, Map<string, MovesetDef>>();

/** 持続中の型の差し替え（player.ts の playerMoveset が変身の次に通す）。持続中でなければ base をそのまま返す */
export function ultimateMoveset(state: GameState, base: MovesetDef): MovesetDef {
  const def = activeSustain(state);
  if (!def || !changesMoveset(def.sustain)) return base;
  let byKey = MOVESET_CACHE.get(base);
  if (!byKey) {
    byKey = new Map();
    MOVESET_CACHE.set(base, byKey);
  }
  const cached = byKey.get(def.key);
  if (cached) return cached;
  const merged = patchMoveset(base, def.sustain);
  byKey.set(def.key, merged);
  return merged;
}

function patchMoveset(base: MovesetDef, s: SustainDef): MovesetDef {
  const p = s.patch ?? {};
  const moveMul = p.attackMoveMul ?? 1;
  const step = (st: MeleeStepDef): MeleeStepDef => patchStep(st, s);
  const charge = (c: MeleeChargeDef): MeleeChargeDef => ({
    ...c,
    moveMul: c.moveMul * moveMul,
    step: step(c.step),
    levels: c.levels.map((l) => ({ ...l, time: l.time * (p.chargeTimeMul ?? 1) })),
  });
  const action = (a: ActionStepDef): ActionStepDef => {
    if (a.kind === "swing") return { ...a, step: step(a.step) };
    if (a.kind === "charge") return { ...a, charge: charge(a.charge) };
    if (a.kind === "volley") return { ...a, throw: moreCasts(a.throw, p) };
    return a;
  };
  const [first, ...rest] = base.steps2;
  return {
    ...base,
    steps: base.steps.map(step),
    dashAttack: step(base.dashAttack),
    charge: base.charge ? charge(base.charge) : undefined,
    tip: base.tip && p.tipAll ? { ...base.tip, ratio: 1 } : base.tip,
    attackMoveMul: base.attackMoveMul * moveMul,
    steps2: [action(first), ...rest.map(action)],
    branches: base.branches.map((b) => ({ ...b, step: step(b.step) })),
  };
}

function patchStep(st: MeleeStepDef, s: SustainDef): MeleeStepDef {
  const p = s.patch ?? {};
  const speed = s.mul.attackSpeed ?? 1;
  const poiseMul = s.mul.poise ?? 1;
  const extra = s.applies ?? [];
  return {
    ...st,
    windup: st.windup / speed,
    active: st.active / speed,
    recover: st.recover / speed,
    poise: st.poise * poiseMul,
    poiseRatio: scaleRatio(st.poiseRatio, poiseMul),
    reach: st.reach * (p.reachMul ?? 1),
    size: st.size * (p.sizeMul ?? 1),
    hits: p.hitsAdd !== undefined ? (st.hits ?? DEFAULT_HITS) + p.hitsAdd : st.hits,
    heavy: p.heavy ?? st.heavy,
    pull: p.pull ?? st.pull,
    trail: p.trail ?? st.trail,
    applies: extra.length > 0 ? [...(st.applies ?? []), ...extra] : st.applies,
    cast: st.cast ? { ...st.cast, throw: moreCasts(st.cast.throw, p) } : st.cast,
  };
}

/** 詠唱: 弾数を castCountAdd 足し、扇を castSpreadDeg 以上に開く（1 発撃ちの魔法が同じ線に重ならない） */
function moreCasts(t: ThrowArtDef, p: SustainPatch): ThrowArtDef {
  const add = p.castCountAdd ?? 0;
  if (add <= 0) return t;
  return { ...t, count: t.count + add, spreadDeg: Math.max(t.spreadDeg, p.castSpreadDeg ?? 0) };
}

function scaleRatio(r: AttrRatio | undefined, mul: number): AttrRatio | undefined {
  if (r === undefined || mul === 1) return r;
  const out: AttrRatio = {};
  for (const [k, v] of Object.entries(r) as [keyof AttrRatio, number][]) out[k] = v * mul;
  return out;
}

/** 持続中の射撃の弾（key はそのまま。周回（円環の理）のほかは弾の挙動は変えず数だけ差し替える）。player.ts の fireVolley から */
export function ultimateShot(state: GameState, shot: BulletDef): BulletDef {
  const mod = activeSustain(state)?.sustain.shot;
  if (!mod) return shot;
  return {
    ...shot,
    pellets: shot.pellets + (mod.pelletsAdd ?? 0),
    pierceBonus: shot.pierceBonus + (mod.pierceAdd ?? 0),
    speedMul: shot.speedMul * (mod.speedMul ?? 1),
    damageMul: shot.damageMul * (mod.damageMul ?? 1),
    recoilMul: shot.recoilMul * (mod.recoilMul ?? 1),
    mine: shot.mine ? { ...shot.mine, fuse: shot.mine.fuse * (mod.fuseMul ?? 1) } : undefined,
    bounce: shot.bounce ? { ...shot.bounce, count: shot.bounce.count + (mod.bounceAdd ?? 0) } : undefined,
    orbit: mod.orbit ?? shot.orbit,
  };
}

/** 持続中の射撃の速さ（間隔の逆数）の倍率。立ち止まっていれば stillFireRate も掛ける */
export function ultimateFireRateMul(state: GameState): number {
  const s = activeSustain(state)?.sustain;
  if (!s) return 1;
  const still = s.stillFireRate !== undefined && length(state.player.body.vel) < STILL_SPEED ? s.stillFireRate : 1;
  return (s.mul.fireRate ?? 1) * still;
}

/**
 * 持続中の与ダメの倍率（近接・射撃。無ければ 1）。combat.ts の rollOutgoing から。
 * burstDamageMul は掛けない（奥義の行為だけに掛ける。通常攻撃への二重掛けを避ける）
 */
export function ultimateOutgoingMul(state: GameState, enemy: Enemy | null): number {
  const s = activeSustain(state)?.sustain;
  if (!s) return 1;
  let mul = s.mul.damage ?? 1;
  if (enemy && s.vsWindup !== undefined && enemy.phase === "windup") mul *= s.vsWindup;
  if (enemy && s.vsStatus && hasStatus(enemy.status, s.vsStatus.status)) mul *= s.vsStatus.mul;
  if (enemy && s.pointBlank) mul *= pointBlankMul(state, enemy, s.pointBlank);
  return mul;
}

/** 零距離の倍率: 敵の縁までの距離 0 で mul、range で 1 へ直線に下がる */
function pointBlankMul(state: GameState, enemy: Enemy, pb: NonNullable<SustainDef["pointBlank"]>): number {
  if (pb.range <= 0) return 1;
  const gap = Math.max(0, length(sub(enemy.body.pos, state.player.body.pos)) - enemy.body.radius);
  const t = Math.max(0, 1 - gap / pb.range);
  return 1 + (pb.mul - 1) * t;
}

/** 持続中の会心率の上乗せ（無ければ 0）。combat.ts の rollOutgoing から */
export function ultimateCritBonus(state: GameState): number {
  return activeSustain(state)?.sustain.critAdd ?? 0;
}

/** 持続中の被ダメの倍率（無ければ 1）。正面の守り（guard）は fromPos の向きで決める。combat.ts の damagePlayer から */
export function ultimateIncomingMul(state: GameState, fromPos: Vec): number {
  const s = activeSustain(state)?.sustain;
  if (!s) return 1;
  const mul = s.mul.incoming ?? 1;
  const guard = s.guard;
  if (guard === undefined) return mul;
  const p = state.player;
  const inFront = Math.abs(angleDiff(angle(sub(fromPos, p.body.pos)), angle(p.facing))) <= (guard.arcDeg * DEG_TO_RAD) / 2;
  return inFront ? mul * guard.mul : mul;
}

/** 持続中の移動速度の倍率（無ければ 1）。player.ts の updateMovement から */
export function ultimateMoveMul(state: GameState): number {
  return activeSustain(state)?.sustain.mul.moveSpeed ?? 1;
}

/** 持続中は奥義ゲージを貯めない（殴り続けて持続が終わらなくなるのを防ぐ）。combat.ts の gainEnergy から */
export function ultimateBlocksEnergy(state: GameState): boolean {
  return state.player.ultimate.active !== null;
}

/** 撃破を数える（持続中だけ。combat.ts の撃破分岐から） */
export function noteUltimateKill(state: GameState): void {
  const u = state.player.ultimate;
  if (u.active !== null) u.kills += 1;
}
