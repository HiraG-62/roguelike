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

export interface FormationDef {
  key: FormationKey;
  layout: FormationLayout;
  minDepth: number;
  /** 部屋に置く陣形の抽選の重み。0 は抽選に出ない（長蛇・物見） */
  weight: number;
  spacing: number;
  /** 大将のスロット。無ければ大将のいない陣（Jin.leaderId は null） */
  leader?: FormationLeader;
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
  return v.leader === undefined ? def : { ...def, leader: leaderOf(v.leader, `${where}.leader`) };
}

/** JSON に書かれた陣形（JSON の並び順）。3a は魚鱗・鶴翼・雁行・長蛇、3b で偃月・方円・物見 */
export const FORMATION_DEFS: readonly FormationDef[] = Object.entries(FORMATION as Raw).map(([key, v]) => defOf(key, v));

/** JSON に無い陣形（まだ実装していない）は undefined */
export function formationDef(key: FormationKey): FormationDef | undefined {
  return FORMATION_DEFS.find((d) => d.key === key);
}

/** 部屋に置く陣形の候補（その深度で解禁され、重みが正のもの） */
export function roomFormations(depth: number): FormationDef[] {
  return FORMATION_DEFS.filter((d) => d.weight > 0 && d.minDepth <= depth);
}
