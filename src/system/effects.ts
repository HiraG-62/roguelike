import type { Element } from "../core/element";
import { type DamageKind, type DeathFxKind, type EffectsState, type Enemy, type FloatTextKind, type FxMarkKind, type GameState, type Particle, type Projectile, type ShapeFx, type UltFx, type UltFxPart, pushSfx } from "../core/state";
import type { ReactionKey, StatusKind } from "../core/status";
import { type Vec, fromAngle, scale } from "../core/vec";
import { EFFECTS, FX_ATTACK, FX_WAVE3, REAPER } from "../data/tuning";
import { type BulletFeature, type BulletNumbers, type MovesetKey, bulletFeatures } from "../data/weapons";
import { weaponHitName } from "../audio/weaponHitNames";
import type { SfxName } from "../audio/sfxNames";
import { TRAIT_COLORS, type Item, type TraitColor } from "../loot/types";
import { colorWeights } from "../loot/resonance";
import { type ElementAffinity, dominantElement, elementShares, outgoingElement, resolveAttack } from "./elementCombat";
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

/**
 * 作った時点の出来事（芽の提示・満タンの気力・過去のカウンター）は「今起きた」ことにしない。
 * 遅延で作るので、作る前から続いている状態で演出や音を出さないため
 */
function createEffectsState(state: GameState): EffectsState {
  return {
    seed: (state.seed ^ FX_SEED_SALT) >>> 0,
    deaths: [],
    marks: [],
    ults: [],
    lastDropId: -1,
    lastChainTime: -1,
    ghostTimer: 0,
    executedId: -1,
    counterMono: 0,
    lastCounterTime: state.recent.onCounter?.lastTime ?? -1,
    dots: [],
    lastBudKey: budKey(state),
    manaFull: manaIsFull(state),
    reaperWarnLeft: null,
    reaperThreat: 0,
    heartbeatTimer: 0,
  };
}

/** 演出の状態（無ければ作る。createGame を触らずに済むよう遅延で作る） */
export function fxState(state: GameState): EffectsState {
  if (!state.effects) state.effects = createEffectsState(state);
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

/** kind はダメージ文字の種類（7-19）。ダメージ以外の文字は省略する */
export function addFloatingText(
  state: GameState,
  pos: Vec,
  text: string,
  color: string,
  scale = 1,
  life = 0.6,
  kind?: FloatTextKind,
): void {
  state.texts.push({
    pos: { x: pos.x + (fxRandom(state) - 0.5) * 6, y: pos.y - 8 },
    vel: { x: (fxRandom(state) - 0.5) * 20, y: -40 },
    text,
    color,
    life,
    maxLife: life,
    scale,
    ...(kind ? { kind } : {}),
  });
  capList(state.texts, EFFECTS.maxTexts);
}

export function shake(state: GameState, amount: number): void {
  state.camera.shake = Math.max(state.camera.shake, amount);
}

export function hitstop(state: GameState, steps: number): void {
  // hitstopScale 0 は無効化（丸めると 0 ステップになり積まれない）。将来のマルチプレイではここを 0 固定にする想定
  state.hitstop = Math.max(state.hitstop, Math.round(steps * state.hitstopScale));
}

/** 広がるリング（衝撃波・爆発） */
export function spawnRing(state: GameState, pos: Vec, radius: number, color: string, life: number): void {
  state.shapes.push({ kind: "ring", pos: { ...pos }, to: { ...pos }, radius, life, maxLife: life, color });
  capList(state.shapes, EFFECTS.maxShapes);
}

/** 2 点を結ぶ稲妻線 */
export function spawnLine(state: GameState, from: Vec, to: Vec, color: string, life: number, swingTrail = false): void {
  const shape: ShapeFx = { kind: "line", pos: { ...from }, to: { ...to }, radius: 0, life, maxLife: life, color };
  if (swingTrail) shape.swingTrail = true;
  state.shapes.push(shape);
  capList(state.shapes, EFFECTS.maxShapes);
}

/**
 * 爆発の輪として描く ShapeFx（src/render/fxAttack.ts が閃光 → 火球 → 煙 → 破片で描く）。
 * 見た目だけの印なので state の型は増やさず、輪のオブジェクトそのものに印を付ける（弱参照なので消えた輪は残らない）
 */
const blastShapes = new WeakSet<ShapeFx>();

export function isBlastShape(shape: ShapeFx): boolean {
  return blastShapes.has(shape);
}

/**
 * 爆発（spawnRing の代わりに 1 行で呼ぶ）。輪は段階を見せるため FX_ATTACK.blast.life 以上に延ばし、
 * 火の粉を少し上へ散らす。粒は演出専用の乱数なのでゲームの乱数列は変わらない
 */
export function spawnBlast(state: GameState, pos: Vec, radius: number, color: string, life = FX_ATTACK.blast.life): ShapeFx {
  const c = FX_ATTACK.blast;
  const span = Math.max(life, c.life);
  const shape: ShapeFx = { kind: "ring", pos: { ...pos }, to: { ...pos }, radius, life: span, maxLife: span, color };
  state.shapes.push(shape);
  blastShapes.add(shape);
  capList(state.shapes, EFFECTS.maxShapes);
  spawnDirectional(state, pos, { x: 0, y: -1 }, color, c.embers, c.emberSpeed, 1.2, span);
  return shape;
}

// -----------------------------------------------------------------------------
// スプライトの描き分けのための目印（docs/ideas/fx-sprites.md 9 章）。
// state の型は増やさず、演出のオブジェクトそのものに弱参照で印を付ける（消えたものは残らない。ロジックは読まない）
// -----------------------------------------------------------------------------

/** 爆発の輪 → 炸裂した弾（弾の専用スプライトの爆発で描く） */
const blastShots = new WeakMap<ShapeFx, Projectile>();

/** 弾の炸裂の輪に、炸裂した弾を結ぶ */
export function markBlastShot(shape: ShapeFx, pr: Projectile): void {
  blastShots.set(shape, pr);
}

export function blastShotOf(shape: ShapeFx): Projectile | undefined {
  return blastShots.get(shape);
}

/**
 * 撃った弾 → 弾の key。性質の無い弾（拳銃など）は作業領域（Projectile.shot）を持たず key が引けないので、
 * 描画が弾の専用スプライトを選べるよう撃った所で結ぶ
 */
const shotBullets = new WeakMap<Projectile, string>();

export function markShotBullet(pr: Projectile, key: string): void {
  shotBullets.set(pr, key);
}

/** 弾の key（作業領域の key、無ければ撃った所で結んだ key） */
export function shotBulletOf(pr: Projectile): string | undefined {
  return pr.shot?.key || shotBullets.get(pr);
}

/** 奥義の行為が出した弾の、奥義と行為 */
export interface UltimateShot {
  readonly key: string;
  readonly index: number;
}

const ultimateShapes = new WeakSet<ShapeFx | Particle>();
const ultimateShots = new WeakMap<Projectile, UltimateShot>();

/** 奥義が出した輪・線・粒か（奥義の専用スプライトがあるとき、描画側が手続きの描画を省く） */
export function isUltimateFx(obj: ShapeFx | Particle): boolean {
  return ultimateShapes.has(obj);
}

export function ultimateShotOf(pr: Projectile): UltimateShot | undefined {
  return ultimateShots.get(pr);
}

/**
 * 奥義の 1 行為（か発動の合図）を出す間に増えた輪・線・弾に印を付ける。particles なら粒にも付ける
 * （行為の間は命中・撃破の粒も出るので、奥義そのものの演出だけを囲んだときに限る）。
 * 出す側の関数（spawnRing・emitVolley など）は共通なので、前後の差で拾う（奥義は稀なので数百件の走査で足りる）
 */
export function withUltimateFx<T>(state: GameState, key: string, index: number, run: () => T, particles = false): T {
  const shapes = new Set<object>(state.shapes);
  const before = new Set<object>(particles ? state.particles : []);
  const shots = new Set<object>(state.projectiles);
  const out = run();
  for (const s of state.shapes) if (!shapes.has(s)) ultimateShapes.add(s);
  if (particles) for (const p of state.particles) if (!before.has(p)) ultimateShapes.add(p);
  for (const pr of state.projectiles) if (!shots.has(pr) && pr.owner === "player") ultimateShots.set(pr, { key, index });
  return out;
}

/** 奥義の見た目の出来事を積む（寿命は FX_ATTACK.sprite.ultEventLife。描く長さは絵ごとの life で決まる） */
export function addUltFx(state: GameState, key: string, part: UltFxPart, index: number, pos: Vec, opts: { to?: Vec; angle?: number; size?: number } = {}): void {
  const fx = fxState(state);
  const ev: UltFx = {
    key,
    part,
    index,
    pos: { ...pos },
    to: { ...(opts.to ?? pos) },
    angle: opts.angle ?? 0,
    size: opts.size ?? 0,
    age: 0,
    life: FX_ATTACK.sprite.ultEventLife,
  };
  fx.ults.push(ev);
  capList(fx.ults, FX_ATTACK.sprite.maxUltEvents);
}

/** 時間で消える演出の印を置く */
export function addMark(state: GameState, kind: FxMarkKind, pos: Vec, life: number, color: string, value = 0): void {
  const fx = fxState(state);
  fx.marks.push({ kind, pos: { ...pos }, age: 0, life, color, value });
  capList(fx.marks, EFFECTS.maxMarks);
}

// -----------------------------------------------------------------------------
// 属性・武器種・銃の弾ごとの色と音
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
  katana: "swingKatana",
  axe: "swingAxe",
  shield: "swingShield",
  chainSickle: "swingChainSickle",
  hammer: "swingHammer",
  gunner: "swingGunner",
  sidearm: "swingSidearm",
  longarm: "swingLongarm",
  cannon: "swingCannon",
  thrown: "swingThrown",
  grenade: "swingGrenade",
  trapper: "swingTrapper",
  warRing: "swingWarRing",
  // 武器 Wave 4: 既存の振り音を流用（爪 = 双剣、チェーンアレイ = 戦鎚、チャクラム = 剣、扇子 = 鞭）
  claws: "swingTwinBlades",
  flail: "swingHammer",
  ringBlades: "swingSword",
  fan: "swingWhip",
};

export function swingSfxName(moveset: MovesetKey): SfxName {
  return SWING_SFX[moveset];
}

/** 命中音の質感（刃・打撃・刺突・鞭打）。銃の家系は近接（ダッシュ攻撃・固有技）でこの系統を使う */
export type HitFamily = "slash" | "blunt" | "pierce" | "lash";
/** 命中音の重さ。段が進む / 怯ませる / 終撃・溜め・重い派生ほど重い */
export type HitWeight = "light" | "mid" | "heavy";

const HIT_FAMILY: Readonly<Record<MovesetKey, HitFamily>> = {
  sword: "slash",
  greatsword: "slash",
  twinBlades: "slash",
  spear: "pierce",
  scythe: "slash",
  fists: "blunt",
  whip: "lash",
  cleaver: "slash",
  staff: "blunt",
  wand: "pierce",
  katana: "slash",
  axe: "slash",
  shield: "blunt",
  chainSickle: "slash",
  hammer: "blunt",
  gunner: "pierce",
  sidearm: "pierce",
  longarm: "pierce",
  cannon: "blunt",
  thrown: "slash",
  grenade: "blunt",
  trapper: "slash",
  warRing: "slash",
  claws: "slash",
  flail: "blunt",
  ringBlades: "slash",
  fan: "blunt",
};

export function hitFamily(moveset: MovesetKey): HitFamily {
  return HIT_FAMILY[moveset];
}

const HIT_SFX: Readonly<Record<HitFamily, Readonly<Record<HitWeight, SfxName>>>> = {
  slash: { light: "hitSlashLight", mid: "hitSlashMid", heavy: "hitSlashHeavy" },
  blunt: { light: "hitBluntLight", mid: "hitBluntMid", heavy: "hitBluntHeavy" },
  pierce: { light: "hitPierceLight", mid: "hitPierceMid", heavy: "hitPierceHeavy" },
  lash: { light: "hitLashLight", mid: "hitLashMid", heavy: "hitLashHeavy" },
};

/** 低域のドン（hitThump）を重ねない系統。高域が主役の刃・鞭打はドンに埋もれて鈍く聞こえるため */
const NO_THUMP_FAMILIES: ReadonlySet<HitFamily> = new Set<HitFamily>(["slash", "lash"]);

/** 近接命中で hitThump を重ねないか（系統が未指定なら重ねる） */
export function skipsThump(family: HitFamily | undefined): boolean {
  return family !== undefined && NO_THUMP_FAMILIES.has(family);
}

/** 近接命中の音。武器種の系統（刃・打撃・刺突）× 重さで選ぶ（docs/recipes/audio.md） */
export function hitSfxName(family: HitFamily, weight: HitWeight, weapon?: MovesetKey): SfxName {
  // 武器種が分かれば武器ごとに作り分けた命中音（audio/weaponHits.ts。重さ・ニュアンスが武器で違う）
  if (weapon !== undefined) return weaponHitName(weapon, weight);
  return HIT_SFX[family][weight];
}

/** 弾の性質ごとの発射音。複数持つ弾は bulletFeatures の並びで最初の性質の音、性質の無い弾は shoot */
const SHOT_SFX: Readonly<Record<BulletFeature, SfxName>> = {
  rapid: "shotRapid",
  spread: "shotSpread",
  pierce: "shotPierce",
  homing: "shotHoming",
  ricochet: "shotRicochet",
  charge: "shotCharge",
  mine: "shotMine",
  burst: "shotBurst",
  boomerang: "shotBoomerang",
  lob: "shotLob",
};

export function shotSfxName(bullet: Readonly<BulletNumbers>): SfxName {
  const feature = bulletFeatures(bullet)[0];
  return feature === undefined ? "shoot" : SHOT_SFX[feature];
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

/** 属性の弱点 / 耐性に当たったか（素性なしは neutral）。outgoingElement は乱数を使わないので演出から読んでよい */
function hitAffinity(state: GameState, enemy: Enemy, kind: DamageKind, skill: boolean): ElementAffinity {
  const atk = resolveAttack(state.stats, kind, skill);
  if (!atk) return "neutral";
  return outgoingElement(state.stats, enemy, atk, skill).affinity;
}

function isWeakHit(state: GameState, enemy: Enemy, kind: DamageKind, skill: boolean): boolean {
  return hitAffinity(state, enemy, kind, skill) === "weak";
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

/** 溜めの段が上がった（player.ts の onChargeLevelUp から 1 行で呼ぶ）。段の音程の 1 音（8-7）もここで積む */
export function chargeUpFx(state: GameState, level: number, color: string): void {
  addMark(state, "chargeUp", state.player.body.pos, EFFECTS.chargeUp.life, color, level);
  pushSfx(state, chargeStepSfxName(level));
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
  for (const u of fx.ults) u.age += dt;
  fx.ults = fx.ults.filter((u) => u.age < u.life);
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
    // 継続ダメージの数字は減速させず、小さく上へ漂わせる（7-19）
    if (t.kind !== "dot") t.vel.y *= 0.92;
  }
  state.texts = state.texts.filter((t) => t.life > 0);

  state.flash = Math.max(0, state.flash - dt * 4);

  const fx = fxState(state);
  ageEffects(fx, dt);
  watchDrops(state, fx);
  watchChains(state, fx);
  placeDashGhosts(state, fx, dt);
  updateWave3Effects(state, fx, dt);
}

/** 階が変わったら演出を捨てる（前の階の座標の死骸や波を持ち越さない） */
export function resetFloorEffects(state: GameState): void {
  const fx = fxState(state);
  fx.deaths = [];
  fx.marks = [];
  fx.ults = [];
  fx.dots = [];
}

// -----------------------------------------------------------------------------
// 演出と音の第 3 弾（docs/ideas/meta-and-weapons.md 7-10 / 7-15 / 7-19 / 8-4 / 8-7〜8-9 / 8-14）
// -----------------------------------------------------------------------------

function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---- 7-19 ダメージ文字の種類 ----

/** 反応のダメージか: 素性なし（proc）の一撃で、直前に同じ敵で反応が起きている（反応のダメージは hurtEnemy が proc で与える） */
function isReactionHit(state: GameState, enemy: Enemy, kind: DamageKind, skill: boolean): boolean {
  if (kind !== "proc" || skill) return false;
  const last = enemy.status.lastReaction;
  return last !== undefined && state.tick - last.tick <= FX_WAVE3.damageText.reaction.ticks;
}

/** ダメージ文字の種類。会心 > 反応 > 弱点 > 耐性 の順に 1 つ選ぶ（combat.ts の showHit が浮き文字に渡す） */
export function damageTextKind(state: GameState, enemy: Enemy, info: Readonly<HitFxInfo>): FloatTextKind {
  const kind = info.kind ?? "proc";
  const skill = info.skill === true;
  if (info.crit) return "crit";
  if (isReactionHit(state, enemy, kind, skill)) return "reaction";
  const affinity = hitAffinity(state, enemy, kind, skill);
  if (affinity === "weak") return "weak";
  if (affinity === "resist") return "resist";
  return "normal";
}

export interface TextLook {
  color: string;
  scale: number;
}

/** 種類ごとの字色と大きさ。会心・通常は base（コンボの色と大きさを畳んだもの）をそのまま使う */
export function damageTextLook(kind: FloatTextKind, base: Readonly<TextLook>): TextLook {
  const c = FX_WAVE3.damageText;
  switch (kind) {
    case "weak":
      return { color: c.weak.color, scale: base.scale * c.weak.scale };
    case "resist":
      return { color: c.resist.color, scale: base.scale * c.resist.scale };
    case "reaction":
      return { color: c.reaction.color, scale: base.scale * c.reaction.scale };
    case "dot":
      return { color: base.color, scale: c.dot.scale };
    case "crit":
    case "normal":
      return { color: base.color, scale: base.scale };
  }
}

/** 継続ダメージの字色を決める状態異常（先に書いたものほど優先） */
const DOT_COLOR_OF: readonly (readonly [StatusKind, string])[] = [
  ["blaze", FX_WAVE3.damageText.dot.burn],
  ["scorch", FX_WAVE3.damageText.dot.burn],
  ["burn", FX_WAVE3.damageText.dot.burn],
  ["venom", FX_WAVE3.damageText.dot.poison],
  ["poison", FX_WAVE3.damageText.dot.poison],
  ["corrode", FX_WAVE3.damageText.dot.poison],
  ["hemorrhage", FX_WAVE3.damageText.dot.bleed],
  ["bleed", FX_WAVE3.damageText.dot.bleed],
];

export function dotTextColor(statuses: ReadonlySet<StatusKind>): string {
  return DOT_COLOR_OF.find(([kind]) => statuses.has(kind))?.[1] ?? FX_WAVE3.damageText.dot.other;
}

/**
 * 継続ダメージ（combat.ts の damageEnemy の silent）を敵ごとに束ねる。燃焼・毒は 1 ダメージずつ毎 tick 入るので、
 * そのまま数字を出すと画面が埋まる。dot.interval 秒ごとに合計を 1 つの小さな数字にする
 */
export function noteDotDamage(state: GameState, enemy: Enemy, amount: number): void {
  if (amount <= 0) return;
  const fx = fxState(state);
  const tally = fx.dots.find((d) => d.enemyId === enemy.id);
  if (tally) {
    tally.amount += amount;
    tally.pos = { ...enemy.body.pos };
    return;
  }
  const color = dotTextColor(new Set(enemy.status.effects.map((e) => e.kind)));
  fx.dots.push({ enemyId: enemy.id, pos: { ...enemy.body.pos }, amount, color, age: 0 });
  capList(fx.dots, FX_WAVE3.damageText.dot.maxTallies);
}

function addDotText(state: GameState, amount: number, pos: Vec, color: string): void {
  const c = FX_WAVE3.damageText.dot;
  state.texts.push({
    pos: { x: pos.x + (fxRandom(state) - 0.5) * 4, y: pos.y - 10 },
    vel: { x: 0, y: -c.rise },
    text: String(Math.round(amount)),
    color,
    life: c.life,
    maxLife: c.life,
    scale: c.scale,
    kind: "dot",
  });
  capList(state.texts, EFFECTS.maxTexts);
}

function flushDots(state: GameState, fx: EffectsState, dt: number): void {
  if (fx.dots.length === 0) return;
  const interval = FX_WAVE3.damageText.dot.interval;
  for (const d of fx.dots) d.age += dt;
  const ready = fx.dots.filter((d) => d.age >= interval);
  if (ready.length === 0) return;
  fx.dots = fx.dots.filter((d) => d.age < interval);
  for (const d of ready) addDotText(state, d.amount, d.pos, d.color);
}

// ---- 8-4 反応の音 ----

/** 反応の系統ごとの音（水と熱 = 蒸気、氷 = 砕け、炎 = 燃え上がり、雷 = 火花、腐り・崩れ = 濁り、心 = 高ぶり） */
const REACTION_SFX: Readonly<Record<ReactionKey, SfxName>> = {
  vaporize: "reactionSteam",
  steam: "reactionSteam",
  quench: "reactionSteam",
  thaw: "reactionSteam",
  shatterBleed: "reactionShatter",
  iceArmor: "reactionShatter",
  frostPoison: "reactionShatter",
  ignite: "reactionBlaze",
  kindle: "reactionBlaze",
  cauterize: "reactionBlaze",
  brandBurst: "reactionBlaze",
  hueBurst: "reactionBlaze",
  conduct: "reactionSpark",
  discharge: "reactionSpark",
  manaCut: "reactionSpark",
  miasma: "reactionBlight",
  dissolve: "reactionBlight",
  lacerate: "reactionBlight",
  collapse: "reactionBlight",
  exposeDoom: "reactionBlight",
  wither: "reactionBlight",
  panic: "reactionSurge",
  rage: "reactionSurge",
  rally: "reactionSurge",
};

export function reactionSfxName(key: ReactionKey): SfxName {
  return REACTION_SFX[key];
}

// ---- 8-7 溜めの段の音程 ----

const CHARGE_STEP_SFX: readonly SfxName[] = ["chargeStep1", "chargeStep2", "chargeStep3"];

/** 段（1 始まり）→ 音。段が足りなければ最後の音 */
export function chargeStepSfxName(level: number): SfxName {
  const index = Math.min(CHARGE_STEP_SFX.length, Math.max(1, Math.floor(level))) - 1;
  return CHARGE_STEP_SFX[index] ?? "chargeStep1";
}

// ---- 7-10 カウンターの白黒 ----

/** onCounter（player.ts が積む）が新しく起きたら白黒を始める。player.ts を触らずに成立を拾うため直近の記録を読む */
function watchCounter(state: GameState, fx: EffectsState, dt: number): void {
  fx.counterMono = Math.max(0, fx.counterMono - dt);
  const last = state.recent.onCounter;
  if (!last || last.lastTime <= fx.lastCounterTime) return;
  fx.lastCounterTime = last.lastTime;
  fx.counterMono = FX_WAVE3.counterMono.time;
}

// ---- 7-15 芽吹き / 8-9 芽と銘 ----

function budKey(state: GameState): string {
  const b = state.pendingBud;
  return b ? `${b.itemId}|${b.milestone}` : "";
}

/** 芽が出た瞬間（pendingBud が新しい芽に変わった）: 双葉の粒と短い光柱、上昇の分散和音 */
export function budBloomFx(state: GameState): void {
  const c = FX_WAVE3.budBloom;
  const pos = state.player.body.pos;
  addMark(state, "budBloom", pos, c.life, c.color);
  spawnDirectional(state, pos, { x: 0, y: -1 }, c.leafColor, c.particles, c.speed, 0.9, c.life * 0.6);
  pushSfx(state, "budSprout");
}

function watchBud(state: GameState, fx: EffectsState): void {
  const key = budKey(state);
  if (key === fx.lastBudKey) return;
  fx.lastBudKey = key;
  if (key !== "") budBloomFx(state);
}

/** 銘が刻まれた瞬間（system/loot.ts の chooseBud から 1 行で呼ぶ）: 金の輪と鐘 */
export function inscribeFx(state: GameState): void {
  const c = FX_WAVE3.inscribe;
  const pos = state.player.body.pos;
  addMark(state, "inscribe", pos, c.life, c.color);
  spawnBurst(state, pos, c.color, c.particles, 90, 0.5, 1.5);
  pushSfx(state, "inscribe");
}

// ---- 8-8 気力満タン ----

function manaIsFull(state: GameState): boolean {
  const max = state.stats.maxMana;
  return max > 0 && state.player.mana >= max;
}

/** 満タンに達した瞬間だけ鈴を鳴らす（mana.ts の増やし口が複数あるので、結果の状態の変わり目で拾う） */
function watchManaFull(state: GameState, fx: EffectsState): void {
  const full = manaIsFull(state);
  if (full && !fx.manaFull) pushSfx(state, "manaFull");
  fx.manaFull = full;
}

// ---- 8-14 死神の接近の鼓動 ----

/** reaper.ts が毎ステップ書く: 警告中なら出現までの残り秒、警告していなければ null */
export function noteReaperWarning(state: GameState, left: number | null): void {
  fxState(state).reaperWarnLeft = left;
}

/**
 * 死神の近さ 0..1（0 は鳴らさない）。出現後は距離（far 以遠で chaseMin、near で 1）、
 * 警告中は残り時間（警告の始まりで warnMin、出現の直前で warnMax）
 */
export function reaperThreat(warnLeft: number | null, reaperDist: number | null): number {
  const c = FX_WAVE3.heartbeat;
  if (reaperDist !== null) return c.chaseMin + (1 - c.chaseMin) * clampUnit((c.far - reaperDist) / (c.far - c.near));
  if (warnLeft === null) return 0;
  return c.warnMin + (c.warnMax - c.warnMin) * (1 - clampUnit(warnLeft / REAPER.warnMargin));
}

/** 鼓動の間隔（秒）。近いほど短い */
export function heartbeatInterval(threat: number): number {
  const c = FX_WAVE3.heartbeat;
  return c.slow + (c.fast - c.slow) * clampUnit(threat);
}

/** 追ってくる死神までの距離（双子は近い方）。去った取り立て屋・不在は null */
function reaperDistance(state: GameState): number | null {
  const r = state.reaper;
  if (!r || r.departed) return null;
  const p = state.player.body.pos;
  const d = Math.hypot(r.pos.x - p.x, r.pos.y - p.y);
  return r.twin ? Math.min(d, Math.hypot(r.twin.x - p.x, r.twin.y - p.y)) : d;
}

function currentThreat(state: GameState, fx: EffectsState): number {
  if (state.status !== "playing") return 0;
  if (state.reaper) {
    const dist = reaperDistance(state);
    return dist === null ? 0 : reaperThreat(null, dist);
  }
  return reaperThreat(fx.reaperWarnLeft, null);
}

/** 近さを state に持ち、間隔が来たら鼓動を積む。ゲーム時間で数えるのでスロー中は鼓動もゆっくりになる */
function updateHeartbeat(state: GameState, fx: EffectsState, dt: number): void {
  fx.reaperThreat = currentThreat(state, fx);
  if (fx.reaperThreat <= 0) {
    fx.heartbeatTimer = 0;
    return;
  }
  fx.heartbeatTimer -= dt;
  if (fx.heartbeatTimer > 0) return;
  fx.heartbeatTimer = heartbeatInterval(fx.reaperThreat);
  pushSfx(state, "reaperHeartbeat");
}

function updateWave3Effects(state: GameState, fx: EffectsState, dt: number): void {
  watchCounter(state, fx, dt);
  flushDots(state, fx, dt);
  watchBud(state, fx);
  watchManaFull(state, fx);
  updateHeartbeat(state, fx, dt);
}
