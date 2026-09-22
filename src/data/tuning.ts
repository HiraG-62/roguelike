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
  /** 複数弾の扇の間隔（度） */
  projectileSpreadDeg: 8,
  /** クリティカル時に足すヒットストップ（ステップ） */
  critHitstopBonus: 1,
  critTextScale: 1.6,
  critColor: "#ffe040",
  /** ks_overclock: 1 振り / 3 発ごとの HP コスト */
  overclockHpCost: 1,
  /** ks_overclock: 射撃はこの発数ごとに overclockHpCost を消費する（近接は 1 振りごと） */
  overclockShootInterval: 3,
  /** lifeOnHit の連続回復を抑える窓（秒） */
  lifeOnHitWindow: 0.1,
  /** その窓の間に回復できる上限（lifeOnHit の何倍か） */
  lifeOnHitCapMul: 3,
} as const;

/** armor の被ダメ軽減（PoE 風の逓減式）。reduction = armor / (armor + ARMOR_K)、上限 ARMOR_MAX_REDUCTION */
export const ARMOR_K = 50;
export const ARMOR_MAX_REDUCTION = 0.75;

/** 永続 stash（装備画面の倉庫）の上限アイテム数 */
export const STASH_CAPACITY = 400;

/** 状態異常 */
export const STATUS = {
  burnDuration: 3,
  /** burn の炎粒子を出す間隔（ステップ） */
  burnParticleInterval: 6,
  burnColor: "#ff8030",
  chillColor: "#80c8ff",
  chillDuration: 2,
  /** 付与する slow の上限（止まりきらないように）。computeStats の chillSlow クランプもこれを使う */
  maxSlow: 0.8,
  /** burn / chill / shock の on-hit 判定は同じ敵に対してこの秒数に 1 回まで */
  onHitIcd: 0.2,
  shockRadius: 60,
  shockMaxTargets: 3,
  shockColor: "#c0e0ff",
  explodeRadius: 40,
  explodeColor: "#ffb040",
  explodeKnockback: 200,
  fxLife: 0.25,
} as const;

/** トリガー効果 */
export const TRIGGER = {
  /** 同じトリガー定義の内部クールダウン（秒） */
  icd: 0.4,
  shockwaveRadius: 50,
  shockwaveKnockback: 260,
  shockwaveColor: "#ffffff",
  nearbyRadius: 60,
  bulletSpeed: 240,
  bulletLife: 0.7,
  bulletColor: "#ffe080",
  comboThreshold: 10,
  /** バフの magnitude は % で入っている */
  percent: 100,
  /** duration が無い効果の既定持続秒 */
  defaultDuration: 3,
} as const;

/** キーストーンの数値 */
export const KEYSTONE = {
  blinkRadius: 40,
  blinkDamage: 20,
  blinkColor: "#c080ff",
  gamblerMin: 0.2,
  gamblerMax: 3,
  berserkerHealMul: 0.5,
} as const;

/** 装備ドロップ */
export const LOOT_DROP = {
  depthChanceBonus: 0.005,
  /** itemLevel = depth + rng(0..spread) */
  itemLevelSpread: 2,
  rarityBoostPerDepth: 0.02,
  roomClearRarityBoost: 0.3,
  depthArrivalRarityBoost: 0.15,
  /** 撃破位置から弾ける距離（px） */
  scatter: 10,
  pickupRadius: 8,
  /** 落ちてから拾えるようになるまで（秒） */
  pickupDelay: 0.3,
  /** 階層到達時にプレイヤーから離して置く距離 */
  arrivalOffset: 18,
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

/** 追加敵の行動パラメータ */
export const ENEMY_AI = {
  knight: {
    /** 盾で防ぐ正面の角度（度） */
    blockArcDeg: 120,
    blockColor: "#c0d0ff",
    /** 防いだとき攻撃側へ返す小さな跳ね返り（敵自身の後退量） */
    blockPushback: 40,
    /** 突進の速度倍率（def.speed に掛ける） */
    lungeSpeedMul: 6,
  },
  bomber: {
    /** この距離より近いと離れる */
    keepAway: 60,
    fuse: 2,
    radius: 36,
    damage: 18,
    /** 爆弾を置く先（プレイヤーへの方向にこの距離だけ投げる） */
    throwDist: 40,
    color: "#ff4040",
  },
  laser: {
    width: 8,
    length: 260,
    damage: 16,
    /** チャージのうち細い予告線を出す割合（残りは太い赤線） */
    thinRatio: 0.6,
    color: "#ff3030",
  },
  golem: {
    ringRadius: 70,
    /** 衝撃波の広がる時間（秒） */
    ringTime: 0.55,
    /** リングの縁の判定幅（px） */
    ringThickness: 8,
    damage: 20,
    color: "#d0c8a0",
  },
  bat: {
    zigzagFreq: 9,
    zigzagAmount: 0.9,
    /** 噛んだ後に離れる速度倍率 */
    retreatMul: 1.2,
  },
  wisp: {
    /** 触れたプレイヤーに炎をまとわせる演出時間（秒）。ダメージは contactDamage */
    burnDuration: 2,
    deathExplodeRadius: 26,
    deathExplodeDamage: 10,
    color: "#60c0ff",
  },
} as const;

/** エリート修飾子 */
export const ELITE = {
  minDepth: 2,
  baseChance: 0.1,
  chancePerDepth: 0.01,
  maxChance: 0.35,
  scoreMul: 3,
  dropMul: 3,
  hpMul: 1.4,
  speedMul: 1.5,
  /** Hasted のテレグラフ短縮倍率 */
  windupMul: 0.6,
  /** Shielded のシールド量（最大 HP に対する割合） */
  shieldRatio: 0.6,
  shieldBreakStagger: 0.6,
  explodeRadius: 40,
  explodeDamage: 18,
  /** Explosive の死亡から爆発までの猶予（秒） */
  explodeFuse: 1,
  explodeColor: "#ff8030",
  reflectColor: "#e0e0ff",
  reflectDamage: 8,
  linkColor: "#ff80ff",
  /** 足元オーラの不透明度 */
  auraAlpha: 0.45,
} as const;

/** ボス */
export const BOSS = {
  /** この階ごとにボス部屋が出る */
  interval: 3,
  roomMinW: 18,
  roomMinH: 14,
  introTime: 2,
  defeatSlowmo: 1.5,
  rareDrops: 2,
  rareDropBoost: 6,
  rareDropAttempts: 40,
  kingSlime: {
    jumpTime: 0.9,
    shockRadius: 60,
    shockDamage: 22,
    phase2Ratio: 0.5,
    splitCount: 4,
    phase2SpeedMul: 1.6,
    /** 着地までの空中時間の最小（フェーズ 2） */
    phase2JumpTime: 0.65,
  },
  boneLord: {
    bulletSpeed: 110,
    bulletDamage: 10,
    bulletDirs: 8,
    /** 弾幕 1 回の斉射数と間隔 */
    volleys: 5,
    volleyInterval: 0.22,
    /** 斉射ごとの回転量（rad） */
    volleySpin: 0.2,
    wallDuration: 4,
    wallLength: 5,
    teleportRatio: 0.3,
    teleportInterval: 1.8,
    color: "#c0ffb0",
  },
} as const;

/** 追跡者（Reaper） */
export const REAPER = {
  appearAfter: 90,
  /** この秒数を過ぎたら HUD に残り時間を出す */
  warnAfter: 60,
  speed: 28,
  radius: 9,
  damage: 25,
  /** 出現位置はプレイヤーからこの距離 */
  spawnDist: 180,
  color: "#8040c0",
} as const;
