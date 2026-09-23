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
  /**
   * 攻撃間隔（秒）。recover と合わせて全敵を旧値の ×0.8 にしてある（docs/COMBAT_DESIGN.md C-2）:
   * 手数を増やし反撃の窓を狭めて、1 対 1 でも被弾が起きるようにする
   */
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
    name: "スライム",
    sprite: "slime",
    radius: 6,
    hp: 20,
    speed: 55,
    behavior: "chaser",
    contactDamage: 10,
    windup: 0.35,
    strikeTime: 0.22,
    recover: 0.36,
    engageRange: 44,
    attackInterval: 0.16,
    score: 10,
    minDepth: 1,
    weight: 10,
    color: "#40c040",
    dropChance: 0.08,
  },
  {
    key: "eye",
    name: "浮遊眼",
    sprite: "eye",
    radius: 6,
    hp: 14,
    speed: 42,
    behavior: "shooter",
    contactDamage: 0,
    windup: 0.4,
    strikeTime: 0.05,
    recover: 0.28,
    engageRange: 150,
    attackInterval: 1.12,
    score: 15,
    minDepth: 1,
    weight: 6,
    color: "#b050d0",
    dropChance: 0.08,
  },
  {
    key: "boar",
    name: "猪",
    sprite: "boar",
    radius: 7,
    hp: 60,
    speed: 38,
    behavior: "charger",
    contactDamage: 20,
    windup: 0.6,
    strikeTime: 0.7,
    recover: 0.48,
    engageRange: 130,
    attackInterval: 0.8,
    score: 40,
    minDepth: 2,
    weight: 3,
    color: "#e08030",
    dropChance: 0.25,
  },
  {
    key: "knight",
    name: "盾騎士",
    sprite: "knight",
    radius: 7,
    hp: 55,
    speed: 30,
    behavior: "knight",
    contactDamage: 16,
    windup: 0.55,
    strikeTime: 0.25,
    recover: 0.56,
    engageRange: 40,
    attackInterval: 0.88,
    score: 35,
    minDepth: 3,
    weight: 3,
    color: "#a0a8c0",
    dropChance: 0.2,
  },
  {
    key: "bomber",
    name: "爆弾ゴブリン",
    sprite: "bomber",
    radius: 6,
    hp: 26,
    speed: 50,
    behavior: "bomber",
    contactDamage: 0,
    windup: 0.45,
    strikeTime: 0.1,
    recover: 0.4,
    engageRange: 110,
    attackInterval: 1.76,
    score: 25,
    minDepth: 2,
    weight: 4,
    color: "#70b040",
    dropChance: 0.12,
  },
  {
    key: "laserEye",
    name: "光線眼",
    sprite: "laserEye",
    radius: 6,
    hp: 24,
    speed: 30,
    behavior: "laser",
    contactDamage: 0,
    windup: 1.2,
    strikeTime: 0.4,
    recover: 0.48,
    engageRange: 170,
    attackInterval: 1.92,
    score: 30,
    minDepth: 3,
    weight: 3,
    color: "#ff5050",
    dropChance: 0.15,
  },
  {
    key: "golem",
    name: "ゴーレム",
    sprite: "golem",
    radius: 10,
    hp: 140,
    speed: 22,
    behavior: "golem",
    contactDamage: 22,
    windup: 1.0,
    strikeTime: 0.6,
    recover: 0.96,
    engageRange: 60,
    attackInterval: 1.28,
    score: 60,
    minDepth: 4,
    weight: 2,
    color: "#a8a290",
    dropChance: 0.3,
  },
  {
    key: "bat",
    name: "蝙蝠",
    sprite: "bat",
    radius: 4,
    hp: 7,
    speed: 95,
    behavior: "bat",
    contactDamage: 6,
    windup: 0.25,
    strikeTime: 0.25,
    recover: 0.4,
    engageRange: 36,
    attackInterval: 0.48,
    score: 6,
    minDepth: 1,
    weight: 3,
    color: "#8060a0",
    dropChance: 0.03,
    swarm: { min: 3, max: 5 },
  },
  {
    key: "wisp",
    name: "鬼火",
    sprite: "wisp",
    radius: 5,
    hp: 18,
    speed: 40,
    behavior: "wisp",
    contactDamage: 8,
    windup: 0.3,
    strikeTime: 0.3,
    recover: 0.48,
    engageRange: 30,
    attackInterval: 0.96,
    score: 20,
    minDepth: 3,
    weight: 3,
    color: "#60c0ff",
    dropChance: 0.1,
    phasing: true,
  },
  {
    key: "kingSlime",
    name: "スライム王",
    sprite: "kingSlime",
    radius: 14,
    hp: 700,
    speed: 45,
    behavior: "kingSlime",
    contactDamage: 18,
    windup: 0.9,
    strikeTime: 0.7,
    recover: 0.64,
    engageRange: 400,
    attackInterval: 0.96,
    score: 1000,
    minDepth: 99,
    weight: 0,
    color: "#40c040",
    dropChance: 0,
    boss: true,
  },
  {
    key: "boneLord",
    name: "骸骨卿",
    sprite: "boneLord",
    radius: 12,
    hp: 900,
    speed: 35,
    behavior: "boneLord",
    contactDamage: 16,
    windup: 0.8,
    strikeTime: 1.2,
    recover: 0.64,
    engageRange: 400,
    attackInterval: 0.8,
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
