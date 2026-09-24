import type { Element } from "../core/element";
import { type DamageKind, type DeathFxKind, type EffectsState, type Enemy, type FxMarkKind, type GameState, pushSfx } from "../core/state";
import type { StatusKind } from "../core/status";
import { type Vec, fromAngle, scale } from "../core/vec";
import { EFFECTS } from "../data/tuning";
import type { MovesetKey, ShotKey } from "../data/weapons";
import type { SfxName } from "../audio/sfxNames";
import { TRAIT_COLORS, type Item, type TraitColor } from "../loot/types";
import { colorWeights } from "../loot/resonance";
import { dominantElement, elementShares, outgoingElement, resolveAttack } from "./elementCombat";
import { ELITE_COLOR } from "./elites";

/**
 * パーティクル・テキスト・揺れなど「気持ちよさ」担当。ロジックには影響しない。
 * 粒のばらつきは演出専用の乱数（EffectsState.seed）で作り、state.rng を消費しない。
 * そのため粒の数や上限（EFFECTS）を変えてもゲームの乱数列・結果は変わらない
 */

// -----------------------------------------------------------------------------
// 演出専用の状態と乱数
// -----------------------------------------------------------------------------

/** 演出の乱数の初期値を seed から離す（ゲームの rng と同じ列にしない） */
const FX_SEED_SALT = 0x9e3779b9;

function createEffectsState(seed: number): EffectsState {
  return { seed: (seed ^ FX_SEED_SALT) >>> 0, deaths: [], marks: [], lastDropId: -1, lastChainTime: -1, ghostTimer: 0, executedId: -1 };
}

/** 演出の状態（無ければ作る。createGame を触らずに済むよう遅延で作る） */
export function fxState(state: GameState): EffectsState {
  if (!state.effects) state.effects = createEffectsState(state.seed);
  return state.effects;
}

/** 演出専用の [0, 1)（mulberry32 と同じ混ぜ方） */
export function fxRandom(state: GameState): number {
  const fx = fxState(state);
  fx.seed = (fx.seed + 0x6d2b79f5) >>> 0;
  let t = fx.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 上限を超えた分を古い方から捨てる */
function capList<T>(list: T[], max: number): void {
  if (list.length > max) list.splice(0, list.length - max);
}

// -----------------------------------------------------------------------------
// 既存の基本演出（粒・文字・揺れ）
// -----------------------------------------------------------------------------

export function spawnBurst(
  state: GameState,
  pos: Vec,
  color: string,
  count: number,
  speed: number,
  life = 0.35,
  size = 2,
): void {
  for (let i = 0; i < count; i++) {
    const dir = fromAngle(fxRandom(state) * Math.PI * 2);
    const v = scale(dir, speed * (0.4 + fxRandom(state) * 0.8));
    state.particles.push({
      pos: { ...pos },
      vel: v,
      life,
      maxLife: life,
      color,
      size: size * (0.6 + fxRandom(state) * 0.8),
      drag: 0.9,
    });
  }
  capList(state.particles, EFFECTS.maxParticles);
}

/** 方向性のある飛沫（斬撃ヒットなど） */
export function spawnDirectional(
  state: GameState,
  pos: Vec,
  dir: Vec,
  color: string,
  count: number,
  speed: number,
  spread = 0.7,
  life = 0.3,
): void {
  const base = Math.atan2(dir.y, dir.x);
  for (let i = 0; i < count; i++) {
    const a = base + (fxRandom(state) - 0.5) * spread * 2;
    const v = scale(fromAngle(a), speed * (0.5 + fxRandom(state) * 0.9));
    state.particles.push({
      pos: { ...pos },
      vel: v,
      life,
      maxLife: life,
      color,
      size: 1.5 + fxRandom(state) * 1.5,
      drag: 0.88,
    });
  }
  capList(state.particles, EFFECTS.maxParticles);
}

export function addFloatingText(
  state: GameState,
  pos: Vec,
  text: string,
  color: string,
  scale = 1,
  life = 0.6,
): void {
  state.texts.push({
    pos: { x: pos.x + (fxRandom(state) - 0.5) * 6, y: pos.y - 8 },
    vel: { x: (fxRandom(state) - 0.5) * 20, y: -40 },
    text,
    color,
    life,
    maxLife: life,
    scale,
  });
  capList(state.texts, EFFECTS.maxTexts);
}

export function shake(state: GameState, amount: number): void {
  state.camera.shake = Math.max(state.camera.shake, amount);
}

export function hitstop(state: GameState, steps: number): void {
  state.hitstop = Math.max(state.hitstop, steps);
}

/** 広がるリング（衝撃波・爆発） */
export function spawnRing(state: GameState, pos: Vec, radius: number, color: string, life: number): void {
  state.shapes.push({ kind: "ring", pos: { ...pos }, to: { ...pos }, radius, life, maxLife: life, color });
  capList(state.shapes, EFFECTS.maxShapes);
}

/** 2 点を結ぶ稲妻線 */
export function spawnLine(state: GameState, from: Vec, to: Vec, color: string, life: number): void {
  state.shapes.push({ kind: "line", pos: { ...from }, to: { ...to }, radius: 0, life, maxLife: life, color });
  capList(state.shapes, EFFECTS.maxShapes);
}

/** 時間で消える演出の印を置く */
export function addMark(state: GameState, kind: FxMarkKind, pos: Vec, life: number, color: string, value = 0): void {
  const fx = fxState(state);
  fx.marks.push({ kind, pos: { ...pos }, age: 0, life, color, value });
  capList(fx.marks, EFFECTS.maxMarks);
}

// -----------------------------------------------------------------------------
// 属性・武器種・射撃の型ごとの色と音
// -----------------------------------------------------------------------------

/** 属性の火花の色（src/core/element.ts の ELEMENT_COLOR より少し明るくして闇でも見える） */
export const ELEMENT_FX_COLOR: Readonly<Record<Element, string>> = {
  none: "#ffffff",
  fire: "#ff7a30",
  ice: "#9ce0ff",
  lightning: "#fff070",
  poison: "#90f050",
  dark: "#b070ff",
  light: "#fff8d0",
};

const ELEMENT_HIT_SFX: Readonly<Record<Element, SfxName | null>> = {
  none: null,
  fire: "hitFire",
  ice: "hitIce",
  lightning: "hitLightning",
  poison: "hitPoison",
  dark: "hitDark",
  light: "hitLight",
};

export function elementHitSfx(element: Element): SfxName | null {
  return ELEMENT_HIT_SFX[element];
}

const SWING_SFX: Readonly<Record<MovesetKey, SfxName>> = {
  sword: "swingSword",
  greatsword: "swingGreatsword",
  twinBlades: "swingTwinBlades",
  spear: "swingSpear",
  scythe: "swingScythe",
  fists: "swingFists",
  whip: "swingWhip",
  cleaver: "swingCleaver",
  staff: "swingStaff",
  wand: "swingWand",
};

export function swingSfxName(moveset: MovesetKey): SfxName {
  return SWING_SFX[moveset];
}

const SHOT_SFX: Readonly<Record<ShotKey, SfxName>> = {
  single: "shoot",
  rapid: "shotRapid",
  spread: "shotSpread",
  pierce: "shotPierce",
  homing: "shotHoming",
  ricochet: "shotRicochet",
  charge: "shotCharge",
  mine: "shotMine",
};

export function shotSfxName(shot: ShotKey): SfxName {
  return SHOT_SFX[shot];
}

/** 振り始め: 武器種ごとの振り音（段の斬撃音 slash1〜3 に重ねる） */
export function onSwingFx(state: GameState): void {
  pushSfx(state, swingSfxName(state.stats.moveset));
}

/** 状態異常の付与音。燃焼・冷気・感電・凍結は statusEffects.ts が鳴らすので null */
const STATUS_SFX: Partial<Record<StatusKind, SfxName>> = {
  poison: "statusPoison",
  venom: "statusPoison",
  corrode: "statusPoison",
  bleed: "statusBleed",
  hemorrhage: "statusBleed",
  paralyze: "statusParalyze",
  fear: "statusFear",
  vulnerable: "statusCurse",
  weaken: "statusCurse",
  silence: "statusCurse",
  brand: "statusCurse",
  broken: "statusCurse",
  doom: "statusCurse",
  siphon: "statusCurse",
  exposed: "statusCurse",
  enfeeble: "statusCurse",
  wet: "statusWet",
  soaked: "statusWet",
  oiled: "statusWet",
  haste: "statusBuff",
  harden: "statusBuff",
  wrath: "statusBuff",
  fury: "statusBuff",
  charged: "statusBuff",
  stagger: "stagger",
};

/** 付与音の名前（ボスの怯み = ダウンは銅鑼） */
export function statusSfxName(kind: StatusKind, boss: boolean): SfxName | null {
  if (kind === "stagger" && boss) return "bossDown";
  return STATUS_SFX[kind] ?? null;
}

/** 状態異常が付いた直後（statusEffects.ts の applyStatus から 1 行で呼ぶ）。enemy が null ならプレイヤー */
export function onStatusAppliedFx(state: GameState, enemy: Enemy | null, kind: StatusKind, boss = false): void {
  const name = statusSfxName(kind, boss);
  if (!name) return;
  // プレイヤーが受けた悪い状態は被弾音で足りる。良い状態の付与音だけ鳴らす
  if (!enemy && name !== "statusBuff") return;
  if (enemy && name === "statusBuff") return;
  pushSfx(state, name);
}

// -----------------------------------------------------------------------------
// 響き（ドロップの色）
// -----------------------------------------------------------------------------

/** 遺物の支配色（配合の最も大きい色。色を持たないものは undefined） */
export function itemTraitColor(item: Readonly<Item>): TraitColor | undefined {
  const weights = colorWeights(item.affixes);
  let best: TraitColor | undefined;
  let bestWeight = 0;
  for (const c of TRAIT_COLORS) {
    if (weights[c] > bestWeight) {
      best = c;
      bestWeight = weights[c];
    }
  }
  return best;
}

const DROP_SFX: Readonly<Record<TraitColor, SfxName>> = {
  crimson: "dropCrimson",
  azure: "dropAzure",
  jade: "dropJade",
  gold: "dropGold",
  umbra: "dropUmbra",
};

export function dropSfxName(color: TraitColor): SfxName {
  return DROP_SFX[color];
}

// -----------------------------------------------------------------------------
// 命中の演出（属性の火花・弱点の割れ・会心の反転・コンボ）
// -----------------------------------------------------------------------------

export interface HitFxInfo {
  kind?: DamageKind;
  crit?: boolean;
  skill?: boolean;
  silent?: boolean;
}

/** プレイヤーの攻撃の主な属性（素性なしは none） */
export function hitElement(state: GameState, kind: DamageKind, skill: boolean): Element {
  const atk = resolveAttack(state.stats, kind, skill);
  if (!atk) return "none";
  return dominantElement(elementShares(state.stats, atk, skill))?.element ?? "none";
}

function isWeakHit(state: GameState, enemy: Enemy, kind: DamageKind, skill: boolean): boolean {
  const atk = resolveAttack(state.stats, kind, skill);
  if (!atk) return false;
  return outgoingElement(state.stats, enemy, atk, skill).affinity === "weak";
}

/** コンボ数の段（EFFECTS.comboTiers の最後に満たした段）。無ければ undefined */
export function comboTier(count: number): (typeof EFFECTS.comboTiers)[number] | undefined {
  let found: (typeof EFFECTS.comboTiers)[number] | undefined;
  for (const tier of EFFECTS.comboTiers) if (count >= tier.min) found = tier;
  return found;
}

/** ダメージ数字の色と大きさ。会心の色は残し、大きさだけコンボで伸ばす */
export function comboDamageText(count: number, color: string, textScale: number, crit: boolean): { color: string; scale: number } {
  const tier = comboTier(count);
  if (!tier) return { color, scale: textScale };
  return { color: crit ? color : tier.color, scale: textScale * tier.scale };
}

/** コンボが節目に届いたら大きな文字と音 */
function comboMilestoneFx(state: GameState, enemy: Enemy): void {
  const count = state.combo.count;
  if (!EFFECTS.comboMilestones.some((m) => m === count)) return;
  const color = comboTier(count)?.color ?? "#ffffff";
  const pos = { x: state.player.body.pos.x, y: state.player.body.pos.y - EFFECTS.comboMilestoneRise };
  addFloatingText(state, pos, `${count} コンボ！`, color, EFFECTS.comboMilestoneScale, EFFECTS.comboMilestoneLife);
  spawnRing(state, enemy.body.pos, EFFECTS.justRing.radius, color, EFFECTS.justRing.life);
  pushSfx(state, "comboMilestone");
}

/** 属性ごとの火花の形（炎は上へ昇り、氷は四方に砕け、雷は線、毒は垂れ、闇は内へ、光は十字） */
function elementSparks(state: GameState, enemy: Enemy, element: Element): void {
  const c = EFFECTS.hitSpark;
  const color = ELEMENT_FX_COLOR[element];
  const pos = enemy.body.pos;
  if (element === "fire") {
    spawnDirectional(state, pos, { x: 0, y: -1 }, color, c.count + 1, c.speed * 0.6, 0.6, c.life * 1.5);
    return;
  }
  if (element === "lightning") {
    const a = fxRandom(state) * Math.PI * 2;
    const r = enemy.body.radius + 6;
    spawnLine(state, { x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r }, pos, color, c.life * 0.5);
    spawnBurst(state, pos, color, c.count, c.speed, c.life * 0.6, 1.5);
    return;
  }
  if (element === "poison") {
    spawnDirectional(state, pos, { x: 0, y: 1 }, color, c.count, c.speed * 0.4, 0.9, c.life * 1.6);
    return;
  }
  if (element === "dark" || element === "light") {
    spawnRing(state, pos, enemy.body.radius + 8, color, c.life);
    spawnBurst(state, pos, color, c.count, c.speed * 0.7, c.life, 1.5);
    return;
  }
  spawnBurst(state, pos, color, c.count + 1, c.speed * 1.2, c.life * 0.8, 1.5);
}

/** 命中の直後（combat.ts の damageEnemy から 1 行で呼ぶ）。数字・揺れは combat.ts が出すので、ここは上乗せの見た目と音だけ */
export function onHitFx(state: GameState, enemy: Enemy, info: HitFxInfo): void {
  if (info.silent) return;
  const kind = info.kind ?? "proc";
  const skill = info.skill === true;
  const element = hitElement(state, kind, skill);
  if (element !== "none") {
    elementSparks(state, enemy, element);
    const sfx = elementHitSfx(element);
    if (sfx) pushSfx(state, sfx);
  }
  if (kind !== "proc" && isWeakHit(state, enemy, kind, skill)) {
    addMark(state, "weakCrack", enemy.body.pos, EFFECTS.weakCrack.life, EFFECTS.weakCrack.color);
  }
  if (info.crit) {
    addMark(state, "critFlash", enemy.body.pos, EFFECTS.critFlash.life, "#ffffff", enemy.id);
    pushSfx(state, "crit");
  }
  comboMilestoneFx(state, enemy);
}

// -----------------------------------------------------------------------------
// 撃破の演出（死に方）
// -----------------------------------------------------------------------------

export interface DeathCause {
  /** 撃破の瞬間に付いていた状態異常 */
  statuses: ReadonlySet<StatusKind>;
  element: Element;
  executed: boolean;
  /** 継続ダメージ（燃焼・毒などの tick）で倒れた */
  silent: boolean;
  kind: DamageKind;
  crit: boolean;
}

const ELEMENT_DEATH: Readonly<Record<Element, DeathFxKind>> = {
  none: "burst",
  fire: "ash",
  ice: "shatter",
  lightning: "discharge",
  poison: "melt",
  dark: "void",
  light: "holy",
};

/** 状態異常から決まる死に方（先に書いたものほど優先） */
const STATUS_DEATH: readonly (readonly [StatusKind, DeathFxKind])[] = [
  ["encase", "shatter"],
  ["freeze", "shatter"],
  ["blaze", "ash"],
  ["scorch", "ash"],
  ["burn", "ash"],
  ["venom", "melt"],
  ["poison", "melt"],
  ["corrode", "melt"],
  ["hemorrhage", "blood"],
  ["bleed", "blood"],
  ["paralyze", "discharge"],
  ["shock", "discharge"],
  ["charged", "discharge"],
  ["doom", "void"],
];

function statusDeath(statuses: ReadonlySet<StatusKind>): DeathFxKind | undefined {
  return STATUS_DEATH.find(([kind]) => statuses.has(kind))?.[1];
}

/**
 * 死に方を決める純関数。処刑 = 両断、凍っていれば砕け、継続ダメージなら状態異常の死に方、
 * 次に最後の一撃の属性、状態異常、会心の近接 = 両断、残りは従来の飛び散り
 */
export function deathKindOf(cause: Readonly<DeathCause>): DeathFxKind {
  if (cause.executed) return "sever";
  if (cause.statuses.has("freeze") || cause.statuses.has("encase")) return "shatter";
  const byStatus = statusDeath(cause.statuses);
  if (cause.silent) return byStatus ?? "burst";
  if (cause.element !== "none") return ELEMENT_DEATH[cause.element];
  if (byStatus) return byStatus;
  if (cause.crit && cause.kind === "melee") return "sever";
  return "burst";
}

/** 処刑された（poise.ts の tryExecute から 1 行で呼ぶ）。次の撃破演出を両断にする */
export function markExecuted(state: GameState, enemy: Enemy): void {
  fxState(state).executedId = enemy.id;
}

function deathCauseOf(state: GameState, enemy: Enemy, info: HitFxInfo): DeathCause {
  const kind = info.kind ?? "proc";
  return {
    statuses: new Set(enemy.status.effects.map((e) => e.kind)),
    element: info.silent ? "none" : hitElement(state, kind, info.skill === true),
    executed: fxState(state).executedId === enemy.id,
    silent: info.silent === true,
    kind,
    crit: info.crit === true,
  };
}

const DEATH_COLOR: Readonly<Record<DeathFxKind, string>> = {
  burst: "#ffffff",
  ash: "#707070",
  shatter: "#c0f0ff",
  discharge: "#fff070",
  melt: "#80e040",
  blood: "#d02030",
  sever: "#ffffff",
  void: "#a060e0",
  holy: "#fff4c0",
};

export function deathColor(kind: DeathFxKind): string {
  return DEATH_COLOR[kind];
}

/** 死に方ごとの粒（形はレンダラーがスプライトで描く。ここは散る粒だけ） */
function deathParticles(state: GameState, kind: DeathFxKind, pos: Vec, angle: number): void {
  const d = EFFECTS.death;
  const color = DEATH_COLOR[kind];
  switch (kind) {
    case "ash":
      spawnDirectional(state, pos, { x: 0, y: -1 }, color, d.particles, d.ashRise * 2, 0.8, 0.8);
      return;
    case "shatter":
      spawnBurst(state, pos, color, d.particles + 4, d.shardSpeed, 0.45, 2.5);
      pushSfx(state, "freeze");
      return;
    case "discharge":
      for (let i = 0; i < 3; i++) {
        const a = fxRandom(state) * Math.PI * 2;
        spawnLine(state, pos, { x: pos.x + Math.cos(a) * 18, y: pos.y + Math.sin(a) * 18 }, color, 0.2);
      }
      return;
    case "melt":
      spawnDirectional(state, pos, { x: 0, y: 1 }, color, d.particles, 40, 1.2, 0.7);
      return;
    case "blood":
      spawnDirectional(state, pos, fromAngle(angle), color, d.particles + 4, d.bloodSpeed, 0.5, 0.45);
      return;
    case "sever":
      spawnDirectional(state, pos, fromAngle(angle + Math.PI / 2), "#ffffff", d.particles / 2, 160, 0.2, 0.25);
      pushSfx(state, "execute");
      return;
    case "void":
      spawnRing(state, pos, 22, color, 0.4);
      return;
    case "holy":
      spawnDirectional(state, pos, { x: 0, y: -1 }, color, d.particles, 60, 0.3, 0.8);
      return;
    case "burst":
      return;
  }
}

/** 撃破の直前（combat.ts の damageEnemy が killEnemy を呼ぶ前に 1 行で呼ぶ） */
export function spawnDeathFx(state: GameState, enemy: Enemy, info: HitFxInfo): void {
  const fx = fxState(state);
  const kind = deathKindOf(deathCauseOf(state, enemy, info));
  fx.executedId = -1;
  const p = state.player.body.pos;
  const angle = Math.atan2(enemy.body.pos.y - p.y, enemy.body.pos.x - p.x);
  if (kind !== "burst") {
    fx.deaths.push({
      kind,
      defKey: enemy.defKey,
      pos: { ...enemy.body.pos },
      flip: enemy.facing.x < 0,
      angle,
      age: 0,
      life: EFFECTS.death.life[kind],
    });
    capList(fx.deaths, EFFECTS.maxDeaths);
  }
  deathParticles(state, kind, enemy.body.pos, angle);
  if (enemy.elite) eliteKillFx(state, enemy);
}

function eliteKillFx(state: GameState, enemy: Enemy): void {
  if (!enemy.elite) return;
  const c = EFFECTS.eliteBurst;
  const color = ELITE_COLOR[enemy.elite];
  addMark(state, "eliteBurst", enemy.body.pos, c.life, color);
  spawnBurst(state, enemy.body.pos, color, c.particles, 200, 0.5, 2.5);
}

/** ボス撃破（boss.ts の onBossDeath から 1 行で呼ぶ）: 画面全体の光と光条 */
export function bossKillFx(state: GameState, pos: Vec): void {
  const c = EFFECTS.bossLight;
  addMark(state, "bossLight", pos, c.life, c.color);
}

// -----------------------------------------------------------------------------
// 見切り・溜め・部屋・連携
// -----------------------------------------------------------------------------

/** 見切り（combat.ts の justDodge から 1 行で呼ぶ）: 広がる輪と放射線 */
export function justFx(state: GameState): void {
  const c = EFFECTS.justRing;
  addMark(state, "justRing", state.player.body.pos, c.life, c.color);
}

/** 溜めの段が上がった（player.ts の onChargeLevelUp から 1 行で呼ぶ） */
export function chargeUpFx(state: GameState, level: number, color: string): void {
  addMark(state, "chargeUp", state.player.body.pos, EFFECTS.chargeUp.life, color, level);
}

/** 部屋の封鎖（floor.ts の lockRoom から 1 行で呼ぶ）: 扉に格子が落ちる。巣窟は色と音を変える */
export function roomLockFx(state: GameState, roomIndex: number, horde: boolean): void {
  const c = EFFECTS.doorSlam;
  addMark(state, "doorSlam", state.player.body.pos, c.life, horde ? c.hordeColor : c.color, roomIndex);
  if (horde) pushSfx(state, "hordeSeal");
}

/** 部屋の制圧（floor.ts の clearRoom から 1 行で呼ぶ）: 最後の撃破地点から床が光る波 */
export function roomClearFx(state: GameState, roomIndex: number): void {
  const fx = fxState(state);
  const last = fx.deaths[fx.deaths.length - 1];
  const origin = last && last.age < EFFECTS.clearWave.life ? last.pos : state.player.body.pos;
  addMark(state, "clearWave", origin, EFFECTS.clearWave.life, EFFECTS.clearWave.color, roomIndex);
}

// -----------------------------------------------------------------------------
// 毎ステップの更新
// -----------------------------------------------------------------------------

/** 新しく落ちた遺物ごとに、響きの色の音と光柱の落下 */
function watchDrops(state: GameState, fx: EffectsState): void {
  let maxId = fx.lastDropId;
  for (const fi of state.floorItems) {
    if (fi.id <= fx.lastDropId) continue;
    maxId = Math.max(maxId, fi.id);
    const color = itemTraitColor(fi.item);
    if (!color) continue;
    pushSfx(state, dropSfxName(color));
    addMark(state, "dropBeam", fi.pos, EFFECTS.dropBeam.life, "#ffffff", TRAIT_COLORS.indexOf(color));
  }
  fx.lastDropId = maxId;
}

/** 連携が成立したら、プレイヤーの周りに残光 */
function watchChains(state: GameState, fx: EffectsState): void {
  const last = state.chains[state.chains.length - 1];
  if (!last || last.time <= fx.lastChainTime) return;
  fx.lastChainTime = last.time;
  const c = EFFECTS.synergyGlow;
  addMark(state, "synergyGlow", state.player.body.pos, c.life, c.color);
}

/** ダッシュ中は一定間隔で残像を置く */
function placeDashGhosts(state: GameState, fx: EffectsState, dt: number): void {
  const p = state.player;
  if (p.dashTimer <= 0) {
    fx.ghostTimer = 0;
    return;
  }
  fx.ghostTimer -= dt;
  if (fx.ghostTimer > 0) return;
  const c = EFFECTS.dashGhost;
  fx.ghostTimer = c.interval;
  addMark(state, "dashGhost", p.body.pos, c.life, c.color, p.facing.x < 0 ? 1 : 0);
}

function ageEffects(fx: EffectsState, dt: number): void {
  for (const m of fx.marks) m.age += dt;
  fx.marks = fx.marks.filter((m) => m.age < m.life);
  for (const d of fx.deaths) d.age += dt;
  fx.deaths = fx.deaths.filter((d) => d.age < d.life);
}

export function updateEffects(state: GameState, dt: number): void {
  for (const s of state.shapes) s.life -= dt;
  state.shapes = state.shapes.filter((s) => s.life > 0);

  for (const p of state.particles) {
    p.life -= dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.vel.x *= p.drag;
    p.vel.y *= p.drag;
  }
  state.particles = state.particles.filter((p) => p.life > 0);

  for (const t of state.texts) {
    t.life -= dt;
    t.pos.x += t.vel.x * dt;
    t.pos.y += t.vel.y * dt;
    t.vel.y *= 0.92;
  }
  state.texts = state.texts.filter((t) => t.life > 0);

  state.flash = Math.max(0, state.flash - dt * 4);

  const fx = fxState(state);
  ageEffects(fx, dt);
  watchDrops(state, fx);
  watchChains(state, fx);
  placeDashGhosts(state, fx, dt);
}

/** 階が変わったら演出を捨てる（前の階の座標の死骸や波を持ち越さない） */
export function resetFloorEffects(state: GameState): void {
  const fx = fxState(state);
  fx.deaths = [];
  fx.marks = [];
}
