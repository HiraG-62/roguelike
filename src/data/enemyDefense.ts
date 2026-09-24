import { type AttackProfile, type Element, type ElementTable, attack, uniformElements } from "../core/element";
import { ELEMENT, GENRE } from "./tuning";

/**
 * 敵の防御・魔防・属性耐性と、敵の攻撃の素性（docs/COMBAT_DESIGN.md A-8）。
 * src/data/enemyCombat.ts の ENEMY_COMBAT に畳み込む（ENEMIES の全 key を持つことを data/enemyCombat.test.ts が検査する）。
 * - 防御 / 魔防は % の軽減（負は柔らかい）。体つきの型（SOFT / ARMORED …）で決める
 * - 耐性は土地の属性に強く、弱点を 1 つ持つ（BIOME_*）。バイオームに属さない敵は種族の属性で決める
 * - ボスは段階（ai.stage）ごとに弱点を変えてよい（stages）
 * - attack はこの敵の攻撃の質（プレイヤーの防御 / 魔防のどちらで受けるか）と属性（プレイヤーの耐性）
 */

export interface EnemyDefenseDef {
  /** 物理の軽減 %（GENRE.enemyDefenseMin〜Max） */
  readonly defense: number;
  /** 魔法の軽減 % */
  readonly warding: number;
  /** 属性耐性 %（書かない属性は 0）。正で軽減、負で弱点 */
  readonly resist: Readonly<Partial<ElementTable>>;
  /** ボスの段階ごとの耐性の上書き（stages[0] が段階 1） */
  readonly stages?: readonly Readonly<Partial<ElementTable>>[];
  /** この敵の攻撃（接触・弾・爆発・衝撃波で共通） */
  readonly attack: AttackProfile;
}

// ---- 体つき（防御 / 魔防） ----
type Body = { readonly defense: number; readonly warding: number };
/** 柔らかい（スライム・小動物・蟲） */
const SOFT: Body = { defense: 0, warding: 0 };
/** 獣・骨（素の体。物理・魔法とも等倍。怯みや体力で硬さを出す） */
const BEAST: Body = { defense: 0, warding: 0 };
/** 兵（鎧を着た人型の軽装） */
const GUARD: Body = { defense: 20, warding: -10 };
/** 鎧・岩（物理に強く魔法に弱い） */
const ARMORED: Body = { defense: 30, warding: -15 };
/** 霊（物理がすり抜ける。魔法に弱い） */
const SPIRIT: Body = { defense: 35, warding: -20 };
/** 術者（物理に弱く魔法に強い） */
const CASTER: Body = { defense: -10, warding: 20 };
/** 設置物（どちらにも少し硬い） */
const FIXTURE: Body = { defense: 20, warding: 20 };
/** 部屋主・大物 */
const ELITE: Body = { defense: 20, warding: 10 };
/** 階層ボス */
const BOSS: Body = { defense: 15, warding: 15 };

// ---- 土地の属性（強い属性と弱点 1 つ） ----
const STRONG = 50;
const MILD = 25;
const WEAK = -50;
/** 浅い弱点（写し身の無属性など、ボスの取り巻きで大きく崩さない） */
const SOFT_SPOT = -25;
const NEAR_IMMUNE = 75;
const BIOME_FORGE = { fire: STRONG, ice: WEAK };
const BIOME_GLACIER = { ice: STRONG, fire: WEAK };
const BIOME_SWAMP = { poison: STRONG, lightning: WEAK };
const BIOME_OSSUARY = { dark: STRONG, light: WEAK };
const BIOME_DARK = { dark: STRONG, none: MILD, light: WEAK };
const BIOME_MINE = { lightning: MILD, fire: WEAK };
const BIOME_MEADOW = { poison: MILD, ice: WEAK };

/** 表を短く書く */
function d(body: Body, resist: Partial<ElementTable>, atk: AttackProfile, stages?: readonly Partial<ElementTable>[]): EnemyDefenseDef {
  return { ...body, resist, attack: atk, ...(stages ? { stages } : {}) };
}

const CONTACT = attack("melee", "physical");
const contact = (e: Element): AttackProfile => attack("melee", "physical", e);
const bolt = (e: Element): AttackProfile => attack("ranged", "arcane", e);
const shot = (e: Element): AttackProfile => attack("ranged", "physical", e);
const blast = (e: Element): AttackProfile => attack("area", "physical", e);
const spell = (e: Element): AttackProfile => attack("area", "arcane", e);

export const ENEMY_DEFENSE: Readonly<Record<string, EnemyDefenseDef>> = {
  // ---- 初期の敵 ----
  slime: d(SOFT, BIOME_SWAMP, CONTACT),
  eye: d(CASTER, { light: MILD, dark: WEAK }, bolt("none")),
  boar: d(BEAST, BIOME_MEADOW, CONTACT),
  knight: d(ARMORED, { lightning: WEAK }, CONTACT),
  bomber: d(SOFT, BIOME_FORGE, blast("fire")),
  laserEye: d(CASTER, { fire: MILD, ice: WEAK }, bolt("fire")),
  golem: d(ARMORED, BIOME_MINE, blast("none")),
  bat: d(SOFT, BIOME_MEADOW, CONTACT),
  wisp: d(SPIRIT, { fire: NEAR_IMMUNE, ice: WEAK }, bolt("fire")),
  kingSlime: d(BOSS, { poison: MILD }, blast("poison"), [{ lightning: WEAK }, { fire: WEAK }]),
  boneLord: d(BOSS, { dark: STRONG }, bolt("dark"), [{ light: WEAK }, { fire: WEAK }]),
  // ---- 再配色種 ----
  poisonSlime: d(SOFT, BIOME_SWAMP, contact("poison")),
  iceSlime: d(SOFT, BIOME_GLACIER, contact("ice")),
  fireSlime: d(SOFT, BIOME_FORGE, blast("fire")),
  goldSlime: d(SOFT, { light: MILD, lightning: WEAK }, CONTACT),
  boneBoar: d(BEAST, BIOME_OSSUARY, CONTACT),
  curseEye: d(CASTER, BIOME_OSSUARY, bolt("dark")),
  frostEye: d(CASTER, BIOME_GLACIER, bolt("ice")),
  blackKnight: d(ARMORED, { dark: MILD, lightning: WEAK }, CONTACT),
  lavaGolem: d(ARMORED, BIOME_FORGE, blast("fire")),
  frostGolem: d(ARMORED, BIOME_GLACIER, blast("ice")),
  crystalGolem: d(ARMORED, { ice: MILD, light: MILD, lightning: WEAK }, blast("none")),
  frostWisp: d(SPIRIT, { ice: NEAR_IMMUNE, fire: WEAK }, bolt("ice")),
  purpleLaser: d(CASTER, { dark: MILD, light: WEAK }, bolt("dark")),
  flyingBook: d(CASTER, { light: MILD, fire: WEAK }, CONTACT),
  ashBat: d(SOFT, BIOME_FORGE, contact("fire")),
  sproutSlime: d(SOFT, BIOME_SWAMP, CONTACT),
  spikeRat: d(SOFT, BIOME_MINE, CONTACT),
  twinEye: d(CASTER, { light: MILD, dark: WEAK }, bolt("none")),
  triLaser: d(CASTER, { fire: MILD, ice: WEAK }, bolt("fire")),
  shadowBat: d(SOFT, BIOME_DARK, contact("dark")),
  wolf: d(BEAST, BIOME_MEADOW, CONTACT),
  multiBomber: d(SOFT, BIOME_FORGE, blast("fire")),
  spearman: d(GUARD, { lightning: WEAK }, CONTACT),
  hornBeetle: d(ARMORED, BIOME_MINE, blast("none")),
  netter: d(SOFT, { ice: MILD, fire: WEAK }, shot("ice")),
  carrionFly: d(SOFT, BIOME_SWAMP, contact("poison")),
  thunderWisp: d(SPIRIT, { lightning: NEAR_IMMUNE, ice: WEAK }, bolt("lightning")),
  skeleton: d(BEAST, BIOME_OSSUARY, CONTACT),
  fuseRat: d(SOFT, BIOME_FORGE, blast("fire")),
  // 氷窟と油の坑道の両方に出るので、どちらの土地の属性（氷 / 雷）も弱点にしない
  crystalMite: d(SOFT, { ice: MILD, fire: WEAK }, blast("none")),
  echoStriker: d(CASTER, { dark: MILD, light: WEAK }, spell("dark")),
  packLeader: d(BEAST, BIOME_MEADOW, CONTACT),
  manaLeech: d(CASTER, BIOME_SWAMP, contact("dark")),
  scavenger: d(BEAST, BIOME_OSSUARY, CONTACT),
  graveBell: d(FIXTURE, BIOME_OSSUARY, spell("dark")),
  silencer: d(CASTER, { light: STRONG, dark: WEAK }, spell("light")),
  frostCrusher: d(ARMORED, BIOME_GLACIER, blast("ice")),
  twinShade: d(SPIRIT, BIOME_DARK, contact("dark")),
  // ---- 部屋主 ----
  mimic: d(ELITE, { poison: MILD, fire: WEAK }, CONTACT),
  hollowArmor: d(ARMORED, { dark: MILD, light: WEAK }, blast("none")),
  hollowWraith: d(SPIRIT, { dark: STRONG, light: WEAK }, contact("dark")),
  boneConductor: d(ELITE, BIOME_OSSUARY, bolt("dark")),
  // ---- ボス（段階で弱点が変わる） ----
  twinBrother: d(BOSS, { fire: MILD }, CONTACT, [{ lightning: WEAK }, { ice: WEAK }]),
  twinSister: d(BOSS, { light: MILD }, shot("none"), [{ fire: WEAK }, { dark: WEAK }]),
  frostGiant: d(BOSS, { ice: NEAR_IMMUNE }, blast("ice"), [{ fire: WEAK }, { lightning: WEAK }]),
  icePillar: d(FIXTURE, { ice: NEAR_IMMUNE, fire: WEAK }, CONTACT),
  trainingDummy: d(FIXTURE, { fire: WEAK }, CONTACT),
  mirrorSelf: d(ELITE, { light: STRONG, dark: WEAK }, CONTACT),
  // ---- Wave 3 ----
  mudman: d(SOFT, { ...BIOME_SWAMP, none: MILD }, CONTACT),
  toad: d(SOFT, BIOME_SWAMP, shot("poison")),
  oiler: d(SOFT, BIOME_MINE, CONTACT),
  flameEater: d(BEAST, { fire: NEAR_IMMUNE, ice: WEAK }, contact("fire")),
  windSprite: d(SPIRIT, { ice: MILD, fire: WEAK }, spell("none")),
  mineLayer: d(SOFT, BIOME_MINE, blast("fire")),
  enemyMine: d(FIXTURE, BIOME_MINE, blast("fire")),
  bellImp: d(CASTER, BIOME_MEADOW, spell("none")),
  bannerBearer: d(GUARD, BIOME_OSSUARY, CONTACT),
  banner: d(FIXTURE, { fire: WEAK }, CONTACT),
  burrower: d(BEAST, BIOME_MINE, blast("none")),
  dropper: d(SOFT, BIOME_OSSUARY, blast("none")),
  absorber: d(CASTER, { dark: MILD, light: WEAK }, bolt("dark")),
  homunculus: d(CASTER, BIOME_OSSUARY, spell("dark")),
  scribeImp: d(CASTER, { dark: MILD, fire: WEAK }, bolt("dark")),
  crossGolem: d(ARMORED, BIOME_MINE, bolt("light")),
  chainWarden: d(ARMORED, { dark: MILD, lightning: WEAK }, blast("none")),
  hollow: d(SPIRIT, BIOME_DARK, contact("dark")),
  lurker: d(SPIRIT, BIOME_DARK, contact("dark")),
  iceBoar: d(BEAST, BIOME_GLACIER, contact("ice")),
  sootBomber: d(SOFT, BIOME_MINE, blast("fire")),
  mossGolem: d(ARMORED, BIOME_SWAMP, blast("poison")),
  swampWisp: d(SPIRIT, { poison: NEAR_IMMUNE, lightning: WEAK }, bolt("poison")),
  frostToad: d(SOFT, BIOME_GLACIER, shot("ice")),
  magmaToad: d(SOFT, BIOME_FORGE, shot("fire")),
  oilSlime: d(SOFT, BIOME_MINE, CONTACT),
  stormEye: d(CASTER, { lightning: STRONG, poison: WEAK }, bolt("lightning")),
  emberRat: d(SOFT, BIOME_FORGE, blast("fire")),
  giantToad: d(ELITE, BIOME_SWAMP, blast("poison")),
  forgeMaster: d(ELITE, BIOME_FORGE, bolt("fire")),
  anvil: d(FIXTURE, BIOME_FORGE, CONTACT),
  turretMaster: d(ELITE, BIOME_MINE, shot("none")),
  turret: d(FIXTURE, BIOME_MINE, shot("none")),
  basilisk: d(ELITE, BIOME_GLACIER, CONTACT),
  shadowStalker: d(ELITE, BIOME_DARK, blast("dark")),
  oilKing: d(BOSS, { poison: MILD }, blast("fire"), [{ ice: WEAK }, { fire: WEAK }]),
  broodMother: d(BOSS, { poison: STRONG }, contact("poison"), [{ fire: WEAK }, { ice: WEAK }]),
  broodEgg: d(FIXTURE, { poison: MILD, fire: WEAK }, CONTACT),
  librarian: d(BOSS, { dark: MILD }, bolt("dark"), [{ fire: WEAK }, { light: WEAK }]),
  mirrorKnight: d(BOSS, { light: STRONG }, attack("melee", "hybrid", "light"), [{ dark: WEAK }, { lightning: WEAK }]),
  mirrorImage: d(ELITE, { light: STRONG, dark: STRONG, none: SOFT_SPOT }, CONTACT),
  reaperShade: d(SPIRIT, { dark: NEAR_IMMUNE, light: WEAK }, contact("dark")),
};

/** 表に無い敵（新しく足した直後など）は無防備・無属性の物理 */
const FALLBACK: EnemyDefenseDef = d(SOFT, {}, CONTACT);

export function enemyDefense(key: string): EnemyDefenseDef {
  return ENEMY_DEFENSE[key] ?? FALLBACK;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * 段階（1 始まり。ボス以外は 0 / undefined）を反映した耐性の表。範囲外の値は ELEMENT の範囲に収める。
 * 表より先の段階（3 段階のボスの段階 3 など）は最後の段階の表を使う（基底に戻して弱点を消さない）
 */
export function enemyResistTable(def: EnemyDefenseDef, stage = 0): ElementTable {
  const table = { ...uniformElements(0), ...def.resist, ...stageResist(def, stage) };
  for (const e of Object.keys(table) as Element[]) table[e] = clamp(table[e], ELEMENT.enemyResistMin, ELEMENT.enemyResistMax);
  return table;
}

function stageResist(def: EnemyDefenseDef, stage: number): Readonly<Partial<ElementTable>> | undefined {
  const stages = def.stages;
  if (stage <= 0 || !stages || stages.length === 0) return undefined;
  return stages[Math.min(stage, stages.length) - 1];
}

/** 弱点（耐性が負の属性）。表示用。耐性の低い順 */
export function enemyWeaknesses(def: EnemyDefenseDef, stage = 0): Element[] {
  const table = enemyResistTable(def, stage);
  return (Object.keys(table) as Element[]).filter((e) => table[e] < 0).sort((a, b) => table[a] - table[b]);
}

/** 防御 / 魔防を範囲に収める */
export function clampEnemyDefense(v: number): number {
  return clamp(v, GENRE.enemyDefenseMin, GENRE.enemyDefenseMax);
}
