export type EnemyBehavior =
  | "chaser"
  | "shooter"
  | "charger"
  | "knight"
  | "bomber"
  | "laser"
  | "golem"
  | "bat"
  | "wisp"
  | "kingSlime"
  | "boneLord";

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
  /** ボス。通常の抽選には出ず、エリートにもならない */
  boss?: boolean;
  /** 群れで湧く数（min..max）。抽選 1 回でこの数だけ出る */
  swarm?: { min: number; max: number };
  /** 壁をすり抜けて移動する */
  phasing?: boolean;
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
  {
    key: "knight",
    name: "shield knight",
    sprite: "knight",
    radius: 7,
    hp: 55,
    speed: 30,
    behavior: "knight",
    contactDamage: 16,
    windup: 0.55,
    strikeTime: 0.25,
    recover: 0.7,
    engageRange: 40,
    attackInterval: 1.1,
    score: 35,
    minDepth: 3,
    weight: 3,
    color: "#a0a8c0",
    dropChance: 0.2,
  },
  {
    key: "bomber",
    name: "bomber goblin",
    sprite: "bomber",
    radius: 6,
    hp: 26,
    speed: 50,
    behavior: "bomber",
    contactDamage: 0,
    windup: 0.45,
    strikeTime: 0.1,
    recover: 0.5,
    engageRange: 110,
    attackInterval: 2.2,
    score: 25,
    minDepth: 2,
    weight: 4,
    color: "#70b040",
    dropChance: 0.12,
  },
  {
    key: "laserEye",
    name: "laser eye",
    sprite: "laserEye",
    radius: 6,
    hp: 24,
    speed: 30,
    behavior: "laser",
    contactDamage: 0,
    windup: 1.2,
    strikeTime: 0.4,
    recover: 0.6,
    engageRange: 170,
    attackInterval: 2.4,
    score: 30,
    minDepth: 3,
    weight: 3,
    color: "#ff5050",
    dropChance: 0.15,
  },
  {
    key: "golem",
    name: "golem",
    sprite: "golem",
    radius: 10,
    hp: 140,
    speed: 22,
    behavior: "golem",
    contactDamage: 22,
    windup: 1.0,
    strikeTime: 0.6,
    recover: 1.2,
    engageRange: 60,
    attackInterval: 1.6,
    score: 60,
    minDepth: 4,
    weight: 2,
    color: "#a8a290",
    dropChance: 0.3,
  },
  {
    key: "bat",
    name: "bat",
    sprite: "bat",
    radius: 4,
    hp: 7,
    speed: 95,
    behavior: "bat",
    contactDamage: 6,
    windup: 0.25,
    strikeTime: 0.25,
    recover: 0.5,
    engageRange: 36,
    attackInterval: 0.6,
    score: 6,
    minDepth: 1,
    weight: 3,
    color: "#8060a0",
    dropChance: 0.03,
    swarm: { min: 3, max: 5 },
  },
  {
    key: "wisp",
    name: "wisp",
    sprite: "wisp",
    radius: 5,
    hp: 18,
    speed: 40,
    behavior: "wisp",
    contactDamage: 8,
    windup: 0.3,
    strikeTime: 0.3,
    recover: 0.6,
    engageRange: 30,
    attackInterval: 1.2,
    score: 20,
    minDepth: 3,
    weight: 3,
    color: "#60c0ff",
    dropChance: 0.1,
    phasing: true,
  },
  {
    key: "kingSlime",
    name: "King Slime",
    sprite: "kingSlime",
    radius: 14,
    hp: 700,
    speed: 45,
    behavior: "kingSlime",
    contactDamage: 18,
    windup: 0.9,
    strikeTime: 0.7,
    recover: 0.8,
    engageRange: 400,
    attackInterval: 1.2,
    score: 1000,
    minDepth: 99,
    weight: 0,
    color: "#40c040",
    dropChance: 0,
    boss: true,
  },
  {
    key: "boneLord",
    name: "Bone Lord",
    sprite: "boneLord",
    radius: 12,
    hp: 900,
    speed: 35,
    behavior: "boneLord",
    contactDamage: 16,
    windup: 0.8,
    strikeTime: 1.2,
    recover: 0.8,
    engageRange: 400,
    attackInterval: 1.0,
    score: 2000,
    minDepth: 99,
    weight: 0,
    color: "#d0c8a8",
    dropChance: 0,
    boss: true,
  },
];

export function enemyDef(key: string): EnemyDef {
  const def = ENEMIES.find((e) => e.key === key);
  if (!def) throw new Error(`unknown enemy: ${key}`);
  return def;
}

export function enemiesForDepth(depth: number): EnemyDef[] {
  return ENEMIES.filter((e) => !e.boss && depth >= e.minDepth);
}

/** 深さによるステータス倍率 */
export function depthHpScale(depth: number): number {
  return 1 + (depth - 1) * 0.18;
}

export function depthDamageBonus(depth: number): number {
  return Math.floor((depth - 1) / 2) * 2;
}
