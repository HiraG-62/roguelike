/** プレイヤーの手触りに関わる定数。ここをいじって調整する */
export const PLAYER = {
  radius: 5,
  maxHp: 100,
  speed: 120,
  /** 攻撃中の移動速度倍率 */
  attackMoveMul: 0.35,
  dash: {
    time: 0.16,
    speed: 400,
    cooldown: 0.32,
    /** ダッシュ後に少しだけ残る無敵（回避猶予） */
    graceInvuln: 0.04,
  },
  /** 被弾後の無敵時間 */
  hurtInvuln: 0.7,
  hurtKnockback: 220,
  melee: [
    { windup: 0.05, active: 0.1, recover: 0.16, damage: 9, reach: 16, size: 26, knockback: 140, stagger: false },
    { windup: 0.05, active: 0.1, recover: 0.16, damage: 9, reach: 18, size: 28, knockback: 160, stagger: false },
    { windup: 0.08, active: 0.12, recover: 0.3, damage: 18, reach: 22, size: 38, knockback: 320, stagger: true },
  ],
  /** コンボ最終段の後、次の 1 段目まで待たせる時間 */
  comboLockout: 0.18,
  /** recover 中のこの割合を過ぎたら次段の先行入力を受け付ける */
  bufferWindow: 0.35,
  shoot: {
    cooldown: 0.17,
    speed: 300,
    damage: 5,
    life: 0.9,
    radius: 2,
    /** 発射時に少しだけ後ろに下がる反動 */
    recoil: 30,
  },
  special: {
    cost: 100,
    damage: 34,
    radius: 64,
    knockback: 380,
  },
  maxEnergy: 100,
  /** 近接ヒット 1 回あたりの必殺ゲージ */
  energyPerHit: 12,
} as const;

export const FEEL = {
  hitstopLight: 2,
  hitstopHeavy: 5,
  hitstopKill: 4,
  shakeLight: 2,
  shakeHeavy: 5,
  shakeHurt: 7,
  shakeSpecial: 10,
  /** ジャスト回避のスローモーション（実時間秒）と倍率 */
  justDodgeSlowmo: 0.45,
  slowmoScale: 0.3,
  comboWindow: 2.2,
} as const;

export const ROOM = {
  /** 部屋に入ったと判定する余白（px）。扉を跨いでいる間はロックしない */
  enterMargin: 10,
  baseEnemies: 2,
  enemiesPerDepth: 1,
  maxEnemies: 12,
  /** ロック時に追加で湧く敵の割合 */
  reinforcementRatio: 0.5,
  spawnTelegraph: 0.7,
  heartDropChance: 0.5,
  heartHeal: 25,
  clearBonus: 50,
} as const;
