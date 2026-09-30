import type { EliteKind, Enemy } from "../core/state";
import type { EnemyBehavior, EnemyDef } from "./enemies";

// enemies.ts は EnemyRole を、ここは EnemyDef / EnemyBehavior を type import するだけ（実行時の循環を作らない）。

/** 敵の役割。陣形のスロットと反応ルールの単位（docs/ideas/jin-impl.md 2-1） */
export const ENEMY_ROLES = ["vanguard", "charge", "shooter", "disruptor", "support", "blast", "swarm"] as const;
export type EnemyRole = (typeof ENEMY_ROLES)[number];

export const ROLE_LABEL: Record<EnemyRole, string> = {
  vanguard: "前衛",
  charge: "突撃",
  shooter: "射手",
  disruptor: "妨害",
  support: "支援",
  blast: "爆発",
  swarm: "群れ",
};

/**
 * behavior → 役割の表。Record なので behavior を足して書き忘れると型エラーになる。
 * ボス behavior は陣に入らないので使われない（表を埋めるだけ）
 */
export const ROLE_BY_BEHAVIOR: Readonly<Record<EnemyBehavior, EnemyRole>> = {
  chaser: "vanguard",
  knight: "vanguard",
  golem: "vanguard",
  hollowArmor: "vanguard",
  twinShade: "vanguard",
  scavenger: "vanguard",
  flameEater: "vanguard",
  crossGolem: "vanguard",
  frostCrusher: "vanguard",
  mimic: "vanguard",
  packLeader: "vanguard",
  charger: "charge",
  hollow: "charge",
  burrower: "charge",
  dropper: "charge",
  shadowStalker: "charge",
  leaper: "charge",
  shooter: "shooter",
  laser: "shooter",
  lobber: "shooter",
  turret: "shooter",
  turretMaster: "shooter",
  echoStriker: "shooter",
  scribeImp: "shooter",
  absorber: "shooter",
  silencer: "disruptor",
  chainWarden: "disruptor",
  basilisk: "disruptor",
  windSprite: "disruptor",
  manaLeech: "disruptor",
  homunculus: "disruptor",
  giantToad: "disruptor",
  conductor: "support",
  graveBell: "support",
  bellImp: "support",
  bannerBearer: "support",
  inert: "support",
  merchant: "support",
  egg: "support",
  forgeMaster: "support",
  bomber: "blast",
  kamikaze: "blast",
  wisp: "blast",
  mineLayer: "blast",
  mine: "blast",
  oiler: "blast",
  bat: "swarm",
  kingSlime: "vanguard",
  boneLord: "vanguard",
  twinBlade: "vanguard",
  twinBow: "vanguard",
  frostGiant: "vanguard",
  oilKing: "vanguard",
  broodMother: "vanguard",
  librarian: "vanguard",
  mirrorKnight: "vanguard",
  thiefKing: "vanguard",
};

/**
 * 敵の役割。上から順に最初に当たったもの:
 * 明示の role → swarm（群れ）→ explode / deathBomb（爆発）→ behavior の表
 */
export function roleOf(def: EnemyDef): EnemyRole {
  if (def.role !== undefined) return def.role;
  if (def.swarm !== undefined) return "swarm";
  if (def.explode !== undefined || def.deathBomb !== undefined) return "blast";
  return ROLE_BY_BEHAVIOR[def.behavior];
}

/** 敵の格。並は無印、強は Enemy.grade、精鋭は Enemy.elite */
export type EnemyGrade = "normal" | "strong" | "elite";

export const GRADE_LABEL: Record<EnemyGrade, string> = {
  normal: "並",
  strong: "猛",
  elite: "精鋭",
};

/** 精鋭が優先（精鋭で強の敵は精鋭として数える） */
export function gradeOf(e: Pick<Enemy, "elite" | "grade">): EnemyGrade {
  if (e.elite !== undefined) return "elite";
  if (e.grade === "strong") return "strong";
  return "normal";
}

/**
 * 役割ごとに付けない精鋭修飾子（eliteKindsFor の後段で外す。docs/ideas/jin-impl.md 2-2）。
 * 動けない射手は的になる・爆ぜる前に倒せなくなる、など役割の読みを壊す組み合わせ
 */
export const ROLE_ELITE_EXCLUDE: Readonly<Record<EnemyRole, readonly EliteKind[]>> = {
  vanguard: ["evasive", "greedy"],
  charge: ["anchored"],
  shooter: ["reflective", "retaliating", "bulwark", "anchored"],
  disruptor: [],
  support: ["explosive", "packed"],
  blast: ["shielded", "bulwark", "linked"],
  swarm: ["shielded", "bulwark", "commanding", "greedy"],
};
