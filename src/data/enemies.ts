export type EnemyBehavior = "chaser" | "shooter" | "charger";

export interface EnemyDef {
  key: string;
  name: string;
  sprite: string;
  radius: number;
  hp: number;
  speed: number;
  behavior: EnemyBehavior;
  /** strike 中に接触したときのダメージ */
  contactDamage: number;
  /** 攻撃の予備動作時間（秒）。長いほど避けやすい */
  windup: number;
  strikeTime: number;
  recover: number;
  /** 攻撃を始める距離（px） */
  engageRange: number;
  /** 攻撃間隔（秒） */
  attackInterval: number;
  score: number;
  minDepth: number;
  /** 出現の重み */
  weight: number;
  color: string;
  /** 撃破時の装備ドロップ基本確率 */
  dropChance: number;
}

export const ENEMIES: readonly EnemyDef[] = [
  {
    key: "slime",
    name: "slime",
    sprite: "slime",
    radius: 6,
    hp: 20,
    speed: 55,
    behavior: "chaser",
    contactDamage: 10,
    windup: 0.35,
    strikeTime: 0.22,
    recover: 0.45,
    engageRange: 44,
    attackInterval: 0.2,
    score: 10,
    minDepth: 1,
    weight: 10,
    color: "#40c040",
    dropChance: 0.08,
  },
  {
    key: "eye",
    name: "floating eye",
    sprite: "eye",
    radius: 6,
    hp: 14,
    speed: 42,
    behavior: "shooter",
    contactDamage: 0,
    windup: 0.4,
    strikeTime: 0.05,
    recover: 0.35,
    engageRange: 150,
    attackInterval: 1.4,
    score: 15,
    minDepth: 1,
    weight: 6,
    color: "#b050d0",
    dropChance: 0.08,
  },
  {
    key: "boar",
    name: "boar",
    sprite: "boar",
    radius: 7,
    hp: 60,
    speed: 38,
    behavior: "charger",
    contactDamage: 20,
    windup: 0.6,
    strikeTime: 0.7,
    recover: 0.6,
    engageRange: 130,
    attackInterval: 1.0,
    score: 40,
    minDepth: 2,
    weight: 3,
    color: "#e08030",
    dropChance: 0.25,
  },
];

export function enemyDef(key: string): EnemyDef {
  const def = ENEMIES.find((e) => e.key === key);
  if (!def) throw new Error(`unknown enemy: ${key}`);
  return def;
}

export function enemiesForDepth(depth: number): EnemyDef[] {
  return ENEMIES.filter((e) => depth >= e.minDepth);
}

/** 深さによるステータス倍率 */
export function depthHpScale(depth: number): number {
  return 1 + (depth - 1) * 0.18;
}

export function depthDamageBonus(depth: number): number {
  return Math.floor((depth - 1) / 2) * 2;
}
