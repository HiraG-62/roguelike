import { type AttackProfile, type Element, type ElementTable, attack, uniformElements } from "../core/element";
import { BALANCE } from "./balance";
import { ELEMENT, GENRE } from "./tuning";

/**
 * 敵の防御・魔防・属性耐性と、敵の攻撃の素性（docs/COMBAT_DESIGN.md A-8）。
 * src/data/enemyCombat.ts の ENEMY_COMBAT に畳み込む（ENEMIES の全 key を持つことを data/enemyCombat.test.ts が検査する）。
 * - 防御 / 魔防は % の軽減（負は柔らかい）。体つきの型（SOFT / ARMORED …）で決める
 * - 耐性は土地の属性に強く、弱点を 1 つ持つ（BIOME_*）。バイオームに属さない敵は種族の属性で決める
 * - ボスは段階（ai.stage）ごとに弱点を変えてよい（stages）
 * - attack はこの敵の攻撃の質（プレイヤーの防御 / 魔防のどちらで受けるか）と属性（プレイヤーの耐性）
 *
 * 体つき・土地の属性・敵ごとの body/biome/resist/stages は src/data/balance/enemies.json の "defense"
 * （数値だけなので変更したい場合はそこを編集する）。attack は union 文字列を含むため TS 側（ENEMY_ATTACK）に残す
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

const CONTACT = attack("melee", "physical");
const contact = (e: Element): AttackProfile => attack("melee", "physical", e);
const bolt = (e: Element): AttackProfile => attack("ranged", "arcane", e);
const shot = (e: Element): AttackProfile => attack("ranged", "physical", e);
const blast = (e: Element): AttackProfile => attack("area", "physical", e);
const spell = (e: Element): AttackProfile => attack("area", "arcane", e);

/** 敵の攻撃の質と属性（union 文字列を含むため JSON に出さず TS に残す。docs/ideas/data-externalization.md 2 章） */
const ENEMY_ATTACK: Readonly<Record<string, AttackProfile>> = {
  // ---- 初期の敵 ----
  slime: CONTACT,
  eye: bolt("none"),
  boar: CONTACT,
  knight: CONTACT,
  bomber: blast("fire"),
  laserEye: bolt("fire"),
  golem: blast("none"),
  bat: CONTACT,
  wisp: bolt("fire"),
  kingSlime: blast("poison"),
  boneLord: bolt("dark"),
  // ---- 再配色種 ----
  poisonSlime: contact("poison"),
  iceSlime: contact("ice"),
  fireSlime: blast("fire"),
  goldSlime: CONTACT,
  boneBoar: CONTACT,
  boarDouble: CONTACT,
  curseEye: bolt("dark"),
  frostEye: bolt("ice"),
  blackKnight: CONTACT,
  lavaGolem: blast("fire"),
  frostGolem: blast("ice"),
  crystalGolem: blast("none"),
  frostWisp: bolt("ice"),
  purpleLaser: bolt("dark"),
  flyingBook: CONTACT,
  ashBat: contact("fire"),
  sproutSlime: CONTACT,
  spikeRat: CONTACT,
  twinEye: bolt("none"),
  triLaser: bolt("fire"),
  shadowBat: contact("dark"),
  wolf: CONTACT,
  multiBomber: blast("fire"),
  spearman: CONTACT,
  hornBeetle: blast("none"),
  netter: shot("ice"),
  carrionFly: contact("poison"),
  thunderWisp: bolt("lightning"),
  skeleton: CONTACT,
  fuseRat: blast("fire"),
  // 氷窟と油の坑道の両方に出るので、どちらの土地の属性（氷 / 雷）も弱点にしない
  crystalMite: blast("none"),
  echoStriker: spell("dark"),
  packLeader: CONTACT,
  manaLeech: contact("dark"),
  scavenger: CONTACT,
  graveBell: spell("dark"),
  silencer: spell("light"),
  frostCrusher: blast("ice"),
  twinShade: contact("dark"),
  // ---- 部屋主 ----
  mimic: CONTACT,
  hollowArmor: blast("none"),
  hollowWraith: contact("dark"),
  boneConductor: bolt("dark"),
  // ---- ボス（段階で弱点が変わる） ----
  twinBrother: CONTACT,
  twinSister: shot("none"),
  frostGiant: blast("ice"),
  icePillar: CONTACT,
  trainingDummy: CONTACT,
  mirrorSelf: CONTACT,
  // ---- Wave 3 ----
  mudman: CONTACT,
  toad: shot("poison"),
  oiler: CONTACT,
  flameEater: contact("fire"),
  windSprite: spell("none"),
  mineLayer: blast("fire"),
  enemyMine: blast("fire"),
  bellImp: spell("none"),
  bannerBearer: CONTACT,
  banner: CONTACT,
  burrower: blast("none"),
  dropper: blast("none"),
  absorber: bolt("dark"),
  homunculus: spell("dark"),
  scribeImp: bolt("dark"),
  crossGolem: bolt("light"),
  chainWarden: blast("none"),
  hollow: contact("dark"),
  lurker: contact("dark"),
  iceBoar: contact("ice"),
  sootBomber: blast("fire"),
  mossGolem: blast("poison"),
  swampWisp: bolt("poison"),
  frostToad: shot("ice"),
  magmaToad: shot("fire"),
  oilSlime: CONTACT,
  stormEye: bolt("lightning"),
  emberRat: blast("fire"),
  giantToad: blast("poison"),
  forgeMaster: bolt("fire"),
  anvil: CONTACT,
  turretMaster: shot("none"),
  turret: shot("none"),
  basilisk: CONTACT,
  shadowStalker: blast("dark"),
  oilKing: blast("fire"),
  broodMother: contact("poison"),
  broodEgg: CONTACT,
  librarian: bolt("dark"),
  mirrorKnight: attack("melee", "hybrid", "light"),
  thiefKing: blast("none"),
  thief: CONTACT,
  mirrorImage: CONTACT,
  reaperShade: contact("dark"),
};

interface DefenseBody {
  readonly defense: number;
  readonly warding: number;
}

interface DefenseEnemyEntry {
  readonly body: string;
  readonly biome?: string;
  readonly resist?: Readonly<Partial<ElementTable>>;
  readonly stages?: readonly Readonly<Partial<ElementTable>>[];
}

// JSON の型はエントリごとに個別の形を推論する（キーが違えば別の型）。104 体ぶんの union を素通しにせず、
// 「body/biome/resist/stages を持つ表」という一枚の形にそろえてから読む（存在は balance.test.ts が検査する）
const BODIES = BALANCE.enemies.defense.bodies as Readonly<Record<string, DefenseBody>>;
const BIOMES = BALANCE.enemies.defense.biomes as Readonly<Record<string, Partial<ElementTable>>>;
const DEFENSE_ENTRIES = BALANCE.enemies.defense.enemies as Readonly<Record<string, DefenseEnemyEntry>>;

function resistOf(entry: DefenseEnemyEntry): Partial<ElementTable> {
  const biome = entry.biome ? BIOMES[entry.biome] : undefined;
  return { ...(biome ?? {}), ...(entry.resist ?? {}) };
}

function buildDefense(key: string, entry: DefenseEnemyEntry): EnemyDefenseDef {
  const body = BODIES[entry.body];
  const attackProfile = ENEMY_ATTACK[key];
  if (!body) throw new Error(`enemyDefense: ${key} の body "${entry.body}" が bodies に無い`);
  if (!attackProfile) throw new Error(`enemyDefense: ${key} の attack が ENEMY_ATTACK に無い`);
  return {
    defense: body.defense,
    warding: body.warding,
    resist: resistOf(entry),
    attack: attackProfile,
    ...(entry.stages ? { stages: entry.stages } : {}),
  };
}

export const ENEMY_DEFENSE: Readonly<Record<string, EnemyDefenseDef>> = Object.fromEntries(
  Object.entries(DEFENSE_ENTRIES).map(([key, entry]) => [key, buildDefense(key, entry)]),
);

/** 表に無い敵（新しく足した直後など）は無防備・無属性の物理 */
const FALLBACK: EnemyDefenseDef = { defense: 0, warding: 0, resist: {}, attack: CONTACT };

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
