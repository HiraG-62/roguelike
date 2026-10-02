import { FORMATION } from "./tuning";
import { ENEMY_ROLES, type EnemyGrade, type EnemyRole } from "./enemyRoles";

/**
 * 陣形（八陣）の定義。形の種類・key・表示名は TS、人数・格・解禁深度・重み・間隔は
 * JSON（src/data/balance/enemies/FORMATION/）。JSON の role / grade / layout の打ち間違いは読み込み時に throw する
 * （skills/arts/build.ts と同じ方針。docs/ideas/jin-impl.md 2-6）
 */

export const FORMATION_KEYS = ["fishScale", "craneWing", "crescent", "arrowhead", "circle", "geese", "column", "yoke", "lookout"] as const;
export type FormationKey = (typeof FORMATION_KEYS)[number];

export const FORMATION_LABEL: Readonly<Record<FormationKey, string>> = {
  fishScale: "魚鱗",
  craneWing: "鶴翼",
  crescent: "偃月",
  arrowhead: "鋒矢",
  circle: "方円",
  geese: "雁行",
  column: "長蛇",
  yoke: "衡軛",
  lookout: "物見",
};

/** 並べ方（map/formation.ts の layoutOffsets） */
export const FORMATION_LAYOUTS = ["wedge", "vee", "arc", "line", "ring", "diagonal", "column", "twoRows", "single"] as const;
export type FormationLayout = (typeof FORMATION_LAYOUTS)[number];

const GRADES: readonly EnemyGrade[] = ["normal", "strong", "elite"];

export interface FormationSlot {
  role: EnemyRole;
  grade: EnemyGrade;
  /** 予算のうちこのスロットに回す割合 */
  share: number;
  min: number;
  /** 省略で上限なし */
  max?: number;
}

/**
 * 大将のスロット。陣形の先頭（正面）に立ち、必ず精鋭の修飾子を 1 つ持つ（解禁前の深度では付かない）。
 * 部屋主（lairMaster）が階の主の候補にいれば lairChance でそれを大将にし、外れたら role・grade の敵を大将にする
 */
export interface FormationLeader {
  role: EnemyRole;
  /** 部屋主でない大将の格（強を推奨。深度が解禁に足りなければ並） */
  grade: EnemyGrade;
  /** 部屋主を大将にする確率（0..1）。候補がいなければ引かない */
  lairChance: number;
}

/** 陣図の画の形（map/jinzuShape.ts）。hook = 的を回り込んで背後で閉じる鉤 / flank = 的の脇を真っすぐ抜ける / thrust = 的を貫く突き / volley = 射手の射線（走らず撃つ） */
export const JINZU_PATH_KINDS = ["hook", "flank", "thrust", "volley"] as const;
export type JinzuPathKind = (typeof JINZU_PATH_KINDS)[number];

/** 画の隊の選び方（system/jinzuSquads.ts。大将から的への向きで左右・前後を決める） */
export const JINZU_SQUAD_KEYS = [
  "outerLeft",
  "outerRight",
  "innerLeft",
  "innerRight",
  "center",
  "front",
  "midLeft",
  "midRight",
  "backLeft",
  "backRight",
  "head",
  "tail",
] as const;
export type JinzuSquadKey = (typeof JINZU_SQUAD_KEYS)[number];

/** 本陣の大将の座（陣の向きに対する位置に最も近いメンバー 1 人を格上げする） */
export const JINZU_LEADER_SEATS = ["rear", "front", "center"] as const;
export type JinzuLeaderSeat = (typeof JINZU_LEADER_SEATS)[number];

/** 陣図の画 1 本の定義 */
export interface FormationJinzuStroke {
  squad: JinzuSquadKey;
  path: JinzuPathKind;
  /** 的の脇を通る間合い。px。左の隊は左へ、右の隊は右へ（隊の名に左右が無ければ符号つきでそのまま） */
  pass: number;
  /** 的を越えて走る長さ。px */
  beyond: number;
}

/** 陣形の陣図（本陣になったときだけ使う。省略した陣形は本陣になれない） */
export interface FormationJinzu {
  leaderSeat: JinzuLeaderSeat;
  /** 1 画の下絵の秒。省略は JINZU.strokeSec */
  strokeSec?: number;
  /** 筆順（最大 JINZU.maxStrokes） */
  strokes: readonly FormationJinzuStroke[];
}

/** 列の入れ替え（衡軛）。system/jinFormations.ts が読む */
export interface FormationRotate {
  /** 入れ替わって下がる側の次の攻撃までの間（攻撃間隔に掛ける） */
  restMul: number;
  /** 前へ出る側の次の攻撃までの間の上限。秒 */
  stepInCooldown: number;
}

export interface FormationDef {
  key: FormationKey;
  layout: FormationLayout;
  minDepth: number;
  /** 部屋に置く陣形の抽選の重み。0 は抽選に出ない（長蛇・物見） */
  weight: number;
  spacing: number;
  /** 大将のスロット。無ければ大将のいない陣（Jin.leaderId は null） */
  leader?: FormationLeader;
  /** 列の後ろほど最初の攻撃間隔を遅らせる秒（鋒矢）。省略は遅らせない */
  cooldownStagger?: number;
  /** 前列と後列の入れ替え（衡軛）。省略は入れ替えない */
  rotate?: FormationRotate;
  /** 本陣になったときの陣図。無ければこの陣形は本陣にならない */
  jinzu?: FormationJinzu;
  /** 正面から置く順（大将がいれば大将の次から） */
  slots: readonly FormationSlot[];
}

type Raw = Readonly<Record<string, unknown>>;

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(where: string, msg: string): never {
  throw new Error(`enemies/FORMATION ${where}: ${msg}`);
}

function num(r: Raw, k: string, where: string): number {
  const v = r[k];
  if (typeof v !== "number") fail(where, `数値 ${k} が無い`);
  return v;
}

function oneOf<T extends string>(list: readonly T[], v: unknown, what: string, where: string): T {
  const hit = list.find((x) => x === v);
  if (hit === undefined) fail(where, `${what} が不正: ${String(v)}`);
  return hit;
}

function slotOf(v: unknown, where: string): FormationSlot {
  if (!isRaw(v)) fail(where, "slot は { role, grade, share, min, max? } の形");
  const max = v.max;
  if (max !== undefined && typeof max !== "number") fail(where, "max は数値");
  const slot: FormationSlot = {
    role: oneOf(ENEMY_ROLES, v.role, "role", where),
    grade: oneOf(GRADES, v.grade, "grade", where),
    share: num(v, "share", where),
    min: num(v, "min", where),
  };
  return max === undefined ? slot : { ...slot, max };
}

function leaderOf(v: unknown, where: string): FormationLeader {
  if (!isRaw(v)) fail(where, "leader は { role, grade, lairChance } の形");
  return {
    role: oneOf(ENEMY_ROLES, v.role, "role", where),
    grade: oneOf(GRADES, v.grade, "grade", where),
    lairChance: num(v, "lairChance", where),
  };
}

function rotateOf(v: unknown, where: string): FormationRotate {
  if (!isRaw(v)) fail(where, "rotate は { restMul, stepInCooldown } の形");
  return { restMul: num(v, "restMul", where), stepInCooldown: num(v, "stepInCooldown", where) };
}

function jinzuStrokeOf(v: unknown, where: string): FormationJinzuStroke {
  if (!isRaw(v)) fail(where, "stroke は { squad, path, pass, beyond } の形");
  return {
    squad: oneOf(JINZU_SQUAD_KEYS, v.squad, "squad", where),
    path: oneOf(JINZU_PATH_KINDS, v.path, "path", where),
    pass: num(v, "pass", where),
    beyond: num(v, "beyond", where),
  };
}

function jinzuOf(v: unknown, where: string): FormationJinzu {
  if (!isRaw(v)) fail(where, "jinzu は { leaderSeat, strokes } の形");
  const strokes = v.strokes;
  if (!Array.isArray(strokes) || strokes.length === 0) fail(where, "strokes は空でない配列");
  const strokeSec = v.strokeSec;
  if (strokeSec !== undefined && typeof strokeSec !== "number") fail(where, "strokeSec は数値");
  const jinzu: FormationJinzu = {
    leaderSeat: oneOf(JINZU_LEADER_SEATS, v.leaderSeat, "leaderSeat", where),
    strokes: strokes.map((st, i) => jinzuStrokeOf(st, `${where}.strokes[${i}]`)),
  };
  return strokeSec === undefined ? jinzu : { ...jinzu, strokeSec };
}

function defOf(key: string, v: unknown): FormationDef {
  const where = key;
  const formationKey = oneOf(FORMATION_KEYS, key, "key", where);
  if (!isRaw(v)) fail(where, "陣形はオブジェクト");
  const slots = v.slots;
  if (!Array.isArray(slots) || slots.length === 0) fail(where, "slots は空でない配列");
  const def: FormationDef = {
    key: formationKey,
    layout: oneOf(FORMATION_LAYOUTS, v.layout, "layout", where),
    minDepth: num(v, "minDepth", where),
    weight: num(v, "weight", where),
    spacing: num(v, "spacing", where),
    slots: slots.map((s, i) => slotOf(s, `${where}.slots[${i}]`)),
  };
  return {
    ...def,
    ...(v.leader === undefined ? {} : { leader: leaderOf(v.leader, `${where}.leader`) }),
    ...(v.cooldownStagger === undefined ? {} : { cooldownStagger: num(v, "cooldownStagger", where) }),
    ...(v.rotate === undefined ? {} : { rotate: rotateOf(v.rotate, `${where}.rotate`) }),
    ...(v.jinzu === undefined ? {} : { jinzu: jinzuOf(v.jinzu, `${where}.jinzu`) }),
  };
}

/** JSON に書かれた陣形（JSON の並び順）。3a は魚鱗・鶴翼・雁行・長蛇、3b で偃月・方円・物見、3c で鋒矢・衡軛 */
export const FORMATION_DEFS: readonly FormationDef[] = Object.entries(FORMATION as Raw).map(([key, v]) => defOf(key, v));

/** JSON に無い陣形（まだ実装していない）は undefined */
export function formationDef(key: FormationKey): FormationDef | undefined {
  return FORMATION_DEFS.find((d) => d.key === key);
}

/** 部屋に置く陣形の候補（その深度で解禁され、重みが正のもの） */
export function roomFormations(depth: number): FormationDef[] {
  return FORMATION_DEFS.filter((d) => d.weight > 0 && d.minDepth <= depth);
}
