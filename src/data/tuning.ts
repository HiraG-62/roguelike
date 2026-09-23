/** プレイヤーの手触りに関わる定数。ここをいじって調整する */
export const PLAYER = {
  radius: 5,
  maxHp: 100,
  speed: 120,
  /** 攻撃中の移動速度倍率 */
  attackMoveMul: 0.35,
  /** 怯み（被弾硬直）中の移動速度倍率。攻撃・射撃・ダッシュ・バーストは出せない（docs/COMBAT_DESIGN.md D-5） */
  staggerMoveMul: 0.3,
  dash: {
    time: 0.16,
    speed: 400,
    /** 連打で無敵を繋げないよう、無敵（invulnTime）より十分長くする（docs/COMBAT_DESIGN.md C-1） */
    cooldown: 0.45,
    /** ダッシュ後に少しだけ残る無敵（回避猶予）。無効化手段を絞るため 0 */
    graceInvuln: 0,
    /** ダッシュ開始からの無敵秒（docs/COMBAT_DESIGN.md C-1）。ダッシュの後半は被弾する */
    invulnTime: 0.1,
  },
  /** 被弾後の無敵時間（docs/COMBAT_DESIGN.md C-1: 0.7 → 0.5） */
  hurtInvuln: 0.5,
  hurtKnockback: 220,
  /**
   * 近接 3 段。scaling は威力の係数（docs/COMBAT_DESIGN.md A-6。基礎値で 9 / 9 / 18）、
   * poise は基礎怯み値（D-2）、heavy は重いヒットストップと壁叩きつけを起こす段
   */
  melee: [
    { windup: 0.05, active: 0.1, recover: 0.16, scaling: { base: 6, str: 0.6 }, poise: 8, reach: 16, size: 26, knockback: 140, heavy: false },
    { windup: 0.05, active: 0.1, recover: 0.16, scaling: { base: 6, str: 0.6 }, poise: 8, reach: 18, size: 28, knockback: 160, heavy: false },
    { windup: 0.08, active: 0.12, recover: 0.3, scaling: { base: 12, str: 1.2 }, poise: 22, reach: 22, size: 38, knockback: 320, heavy: true },
  ],
  /** コンボ最終段の後、次の 1 段目まで待たせる時間 */
  comboLockout: 0.18,
  /** recover 中のこの割合を過ぎたら次段の先行入力を受け付ける */
  bufferWindow: 0.35,
  shoot: {
    cooldown: 0.17,
    speed: 300,
    /** 1 発の威力（基礎値で 5）と怯み値 */
    scaling: { base: 3.5, dex: 0.3 },
    poise: 2,
    life: 0.9,
    radius: 2,
    /** 発射時に少しだけ後ろに下がる反動 */
    recoil: 30,
  },
  special: {
    cost: 100,
    /** 威力（基礎値で 34）と怯み値 */
    scaling: { base: 24, mnd: 1, spi: 1 },
    poise: 60,
    radius: 64,
    knockback: 380,
    /** 発動後の無敵（秒）。弾消しは維持するので短め（docs/COMBAT_DESIGN.md C-1 の 10） */
    invuln: 0.15,
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
  // ---- 以下は docs/COMBAT_DESIGN.md E-2 / E-3 の統一状態異常（段階 1 の L3 が読む） ----
  /** 拘束上限: 行動停止系（怯み・凍結・麻痺・恐怖）は直近 ccWindow 秒に合計 ccBudget 秒まで */
  ccWindow: 3,
  ccBudget: 2,
  chill: {
    /** 1 スタックあたりの遅さ */
    slowPerStack: 0.12,
    maxStacks: 5,
    playerMaxStacks: 3,
    duration: 2,
    /** ボスは凍結しない代わりに遅さをここで止める */
    bossMaxSlow: 0.4,
  },
  freeze: {
    duration: 1.2,
    /** 砕き: 凍結中の被弾の与ダメ倍率と追加の怯み値 */
    shatterDamageMul: 1.5,
    shatterPoise: 20,
    /** 解除後の冷気免疫（秒） */
    chillImmuneAfter: 3,
  },
  shock: {
    /** 連鎖の周期（秒）と届く半径 */
    interval: 0.6,
    radius: 50,
    maxStacks: 3,
    duration: 2.5,
  },
  paralyze: {
    duration: 0.5,
    bossDuration: 0.2,
    /** 解除後の感電免疫（秒） */
    shockImmuneAfter: 3,
  },
  poison: {
    /** 最大 HP に対する 1 スタック / 秒の割合 */
    hpRatioPerSec: 0.01,
    bossHpRatioPerSec: 0.003,
    playerHpRatioPerSec: 0.005,
    maxStacks: 5,
    playerMaxStacks: 3,
    duration: 5,
  },
  bleed: {
    /** この移動距離（px）ごとに potency × スタックのダメージ */
    distance: 10,
    maxStacks: 3,
    duration: 4,
    /** 毒がある間の出血ダメージ倍率 */
    poisonMul: 1.5,
  },
  vulnerable: {
    /** 受けるダメージ倍率 */
    mul: 1.2,
    duration: 4,
  },
  weaken: {
    /** 与えるダメージの減少割合（× (1 − mul)） */
    mul: 0.25,
    duration: 4,
  },
  fear: {
    duration: 2,
    /** 解除後の恐怖免疫（秒） */
    immuneAfter: 6,
    /** 鬼火（怯まない）は恐怖が長く効く */
    wispMul: 2,
  },
  silence: {
    enemyDuration: 3,
    playerDuration: 1.5,
  },
  /** 蒸発（燃焼 × 冷気）: 燃焼の残りダメージのうち即時に与える割合 */
  vaporizeRatio: 0.5,
} as const;

/**
 * ステータス（docs/COMBAT_DESIGN.md A）。基礎値は全員 base。
 * 派生は「実効値 − base」の差分で既存の PlayerStats に畳み込むので、基礎値なら何も変わらない
 */
export const ATTR = {
  base: 5,
  /** 逓減: knee1 までは等倍、knee2 までは slope1、それ以降は slope2 */
  knee1: 20,
  slope1: 0.5,
  knee2: 40,
  slope2: 0.25,
  /** 筋力: 怯み値倍率・ノックバック（1 点あたりの割合） */
  strPoise: 0.03,
  strKnockback: 0.02,
  /** 技巧: 移動・連射・ダッシュ CD 短縮（1 点あたりの割合）と CD 倍率の下限 */
  dexMove: 0.005,
  dexFireRate: 0.01,
  dexDashCooldown: 0.01,
  dexDashCooldownMin: 0.7,
  /** 体力: 最大 HP（1 点あたり）と、受ける状態異常の持続 100 / (100 + k × d) の k・下限 */
  vitMaxHp: 4,
  vitStatusTaken: 3,
  vitStatusTakenBase: 100,
  vitStatusTakenMin: 0.5,
  /** 精神: 最大マナ・マナ自然回復（毎秒）・会心率（1 点あたり） */
  mndMaxMana: 6,
  mndManaRegen: 0.3,
  mndCrit: 0.004,
  /** 霊力: 状態異常の効果量・buff 系スキルの効果量（1 点あたりの割合） */
  spiStatusPotency: 0.03,
  spiBuffPotency: 0.02,
} as const;

/** ステータスの入手（共鳴）とラン内の振り分け（docs/COMBAT_DESIGN.md A-3） */
export const ATTR_GAIN = {
  /** 共鳴: 支配はその色のステータス、二重は 2 色それぞれ、散光は全ステータスに加算 */
  resonanceDominant: 3,
  resonanceDual: 2,
  resonanceScatter: 1,
  /** ラン内: 階層到達ごと・ボス撃破後の階段で得る振り分け点 */
  perFloor: 1,
  perBoss: 2,
  /** 振り分けパネルが出てから入力を受け付けるまで（秒）。祝福の選択キーの押しっぱなしで誤爆しない */
  allocInputDelay: 0.25,
} as const;

/** マナ（docs/COMBAT_DESIGN.md B-1）。スキルの資源 */
export const MANA = {
  /** 精神 base のときの最大マナと自然回復 / 秒 */
  baseMax: 100,
  baseRegen: 3.5,
  /** 封鎖されていない部屋・通路での自然回復倍率（待ち時間を作らない） */
  idleRegenMul: 4,
  /** 近接各段の命中 1 体ごと */
  onMelee: [4, 4, 7],
  /** 近接 1 振りで回収する敵の上限 */
  meleeTargetCap: 3,
  onDashAttack: 5,
  /** カウンターヒットなら倍 */
  onCounterMul: 2,
  /** 射撃弾の命中 1 体ごとと、1 回の射撃で回収できる上限（発数） */
  onShot: 1.5,
  shotVolleyCap: 3,
  onJust: 15,
  onKill: 2,
  /** ラン開始と階層到達で満タン */
  startFull: true,
} as const;

/** 怯み（docs/COMBAT_DESIGN.md D-1）。段階 1 の L3 が読む */
export const POISE = {
  /** 最後に怯み値を受けてから減衰が始まるまで（秒）と、耐性に対する毎秒の減衰割合 */
  decayDelay: 1,
  decayRate: 0.3,
  /** 堅守: 怯みが解けた直後の持続と受け怯み値倍率 */
  guardedTime: 2,
  guardedMul: 0.5,
  bossGuardedTime: 6,
  bossGuardedMul: 0.25,
  /** ボスはダウンのたびに耐性 × bossPoiseGrowth（上限 × bossPoiseGrowthMax） */
  bossPoiseGrowth: 1.5,
  bossPoiseGrowthMax: 3,
  bossDownDamageMul: 1.25,
  /** 耐性 × (1 + depthScale × (深度 − 1)) */
  depthScale: 0.08,
  eliteMul: 1.5,
  /** 怯んでいない敵へのノックバック倍率 */
  knockbackUnstaggered: 0.35,
  /** 盾騎士が正面の近接をブロックしたときに溜まる怯み値の割合 */
  blockMul: 0.5,
  /** 猪の壁激突の自傷怯み（秒） */
  chargerWallStagger: 0.9,
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
  /** 効果 invuln の持続の上限（秒）。被弾時・ゲージ満タンの無敵で常時無敵にしない（docs/COMBAT_DESIGN.md C-1 の 13） */
  invulnMax: 0.4,
} as const;

/** キーストーンの数値 */
export const KEYSTONE = {
  blinkRadius: 40,
  blinkDamage: 20,
  blinkColor: "#c080ff",
  gamblerMin: 0.2,
  gamblerMax: 3,
  berserkerHealMul: 0.5,
  /** ks_overdraw（過負荷）: 足りないマナ 1 あたりに払う HP と、払った後に残す HP の下限（自滅させない） */
  overdrawHpPerMana: 0.5,
  overdrawMinHp: 1,
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
  justDodgeSlowmo: 0.35,
  slowmoScale: 0.3,
  comboWindow: 2.2,
} as const;

export const ROOM = {
  /** 部屋に入ったと判定する余白（px）。扉を跨いでいる間はロックしない */
  enterMargin: 10,
  baseEnemies: 2,
  /** 敵数 = baseEnemies + floor(depth * enemiesPerDepth) */
  enemiesPerDepth: 0.8,
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
    deathExplodeRadius: 26,
    deathExplodeDamage: 10,
    /** 死亡から爆発までの猶予（秒）。テレグラフを見て離れられるように即時にしない */
    deathExplodeFuse: 0.35,
    color: "#60c0ff",
  },
} as const;

/** エリート修飾子 */
export const ELITE = {
  minDepth: 3,
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
  /** 出現までの猶予（秒）の基礎値。実際の猶予は appearAfter + 部屋数 * appearPerRoom */
  appearAfter: 90,
  /** 部屋 1 つにつき出現猶予に足す秒数（treasure/shrine は数えない） */
  appearPerRoom: 12,
  /** 出現のこの秒前から HUD に残り時間を出す */
  warnMargin: 30,
  /** 出現後の追跡速度（旧 28 の 85%） */
  speed: 23.8,
  radius: 9,
  damage: 25,
  /** 出現位置はプレイヤーからこの距離 */
  spawnDist: 180,
  color: "#8040c0",
} as const;

/** 部屋の種類（src/system/roomTypes.ts） */
export const ROOM_KIND = {
  treasureChance: 0.35,
  treasureItemsMin: 2,
  treasureItemsMax: 3,
  /** 宝物庫の床アイテムの rarityBoost（部屋クリア報酬より高め） */
  treasureRarityBoost: 1.2,
  /** 宝物庫のアイテムを中心から並べる距離（px） */
  treasureItemSpread: 14,
  treasureCoinParticles: 28,
  treasureCoinColor: "#ffd040",
  challengeMinDepth: 2,
  challengeChance: 0.35,
  challengeWaves: 3,
  /** 波ごとの湧き数（通常部屋の敵数に対する倍率） */
  challengeWaveMul: 0.75,
  challengeRareBoost: 6,
  challengeRareAttempts: 40,
  challengeColor: "#ff9040",
  shrineMinDepth: 2,
  shrineChance: 0.3,
  /** 泉に触れたと判定する半径（px） */
  fountainRadius: 8,
  shrineColor: "#60c0ff",
  /** 呪い中に次の部屋でエリート抽選を行う回数（2 = エリート率およそ 2 倍） */
  cursedEliteRolls: 2,
  cursedColor: "#c060ff",
  ambushMinDepth: 3,
  ambushChance: 0.25,
  ambushMax: 2,
  /** 伏兵部屋で入った瞬間に湧く数（通常部屋の敵数に対する倍率） */
  ambushEnemyMul: 2,
} as const;

/** フロア種別（src/system/roomTypes.ts の chooseFloorKind） */
export const FLOOR_KIND = {
  /** depth % caveInterval === caveRemainder かつ caveMinDepth 以上なら洞窟 */
  caveInterval: 3,
  caveRemainder: 1,
  caveMinDepth: 4,
  darkMinDepth: 4,
  darkChance: 0.25,
  /** 暗闇でプレイヤー周りだけ明るい半径（px） */
  darkLightRadius: 90,
  /** 光の縁のぼかし幅（半径に対する割合） */
  darkFeather: 0.35,
  darkAlpha: 0.94,
} as const;

/** ミニマップ */
export const MINIMAP = {
  /** プレイヤー周囲この半径（タイル）を探索済みにする */
  revealRadius: 6,
} as const;

/** アクション手触り（docs/ideas/action-feel.md「まず入れるべき 5 つ」+ 壁叩きつけ・ダッシュ攻撃） */
export const ACTION = {
  /** カウンターヒット: 敵の windup 中に近接を当てる */
  counter: {
    damageMul: 1.5,
    /** 怯み値の倍率。確定の怯みではなく、敵の強靭（攻撃中 ×0.5）と相殺して等倍になる値 */
    poiseMul: 2,
    /** 通常の hitstop に足すステップ */
    hitstopBonus: 2,
    text: "カウンター！",
    color: "#ff9040",
    textScale: 1.6,
    textLife: 0.7,
    particles: 12,
  },
  /** ラストキル・スロー: ロック中の部屋で最後の敵を倒した瞬間 */
  lastKill: {
    /** スローモーション（実時間秒） */
    slowmo: 0.5,
    flash: 0.85,
    text: "殲滅",
    color: "#ffffff",
    textScale: 2.6,
    textLife: 1.2,
    /** テキストを倒した敵の少し上に出す（px） */
    textOffsetY: 14,
    ringRadius: 60,
    ringLife: 0.45,
    particles: 30,
  },
  /** リゲイン: 被弾後しばらく近接ヒットで HP を取り戻す */
  regain: {
    /** 取り戻せる猶予（秒） */
    window: 3,
    /** 近接 1 ヒットで戻る量（被ダメに対する割合） */
    perHitRatio: 0.15,
    /** 取り戻せる合計（被ダメに対する割合）。C-1 で 0.6 → 0.5 */
    poolRatio: 0.5,
    color: "#b0ffb0",
    particles: 4,
  },
  /** 見切り斬り（祝福 justSlash）: JUST 回避直後に攻撃で回避した敵へ瞬間移動斬り */
  justCounter: {
    /** JUST 回避後に攻撃を受け付ける秒数 */
    window: 0.4,
    /** 近接 3 段目のダメージに掛ける倍率 */
    damageMul: 1.5,
    /** 基礎怯み値（docs/COMBAT_DESIGN.md D-2） */
    poise: 60,
    /** この距離より遠い敵へは飛ばない（px） */
    maxRange: 160,
    /** 敵の縁からこの距離だけ手前で止まる（px） */
    gap: 2,
    hitstopBonus: 3,
    text: "ジャストカウンター",
    color: "#60e0ff",
    textScale: 1.7,
    textLife: 0.8,
    lineLife: 0.2,
    particles: 16,
  },
  /** 弾返し（祝福 reflect）: 近接の active で敵弾を斬るとプレイヤー弾として反射 */
  reflect: {
    speedMul: 1.3,
    damageMul: 2,
    energy: 8,
    /** 反射弾の貫通数 */
    pierce: 2,
    /** 反射弾の残り寿命の下限（秒） */
    minLife: 1,
    text: "パリィ",
    color: "#ffe080",
    textScale: 1.2,
    textLife: 0.5,
    particles: 8,
  },
  /** 壁叩きつけ: 近接 3 段目などで吹き飛んだ敵が壁に激突 */
  wallSplat: {
    damage: 10,
    /** 基礎怯み値（強靭を無視する。docs/COMBAT_DESIGN.md D-2） */
    poise: 20,
    color: "#c0c0c0",
    particles: 12,
    hitstop: 3,
  },
  /** ダッシュ攻撃: ダッシュ中に攻撃 → ダッシュ終了と同時に前方へ長い一閃（1 段目と 2 段目の間の性能） */
  dashAttack: {
    windup: 0.03,
    active: 0.1,
    recover: 0.18,
    /** 威力（基礎値で 13）と怯み値 */
    scaling: { base: 9, str: 0.8 },
    poise: 12,
    reach: 26,
    size: 30,
    knockback: 220,
    heavy: false,
  },
  /** 弾斬り（性質 bulletCut）: 近接の active で敵弾を消す */
  bulletCut: {
    color: "#c0e0ff",
    particles: 4,
  },
} as const;

/** ラン内限定の祝福 3 択（src/system/boons.ts）。docs/ideas/run-structure.md「祝福 3 択」 */
export const BOON = {
  /** 3 択の枚数 */
  choiceCount: 3,
  /** 呪い付き祝福が 1 枚混ざる確率 */
  cursedChance: 0.4,
  /** 提示直後、連打の誤選択を防ぐ入力無視時間（実時間秒） */
  inputDelay: 0.35,
  /** 装備タグ 1 つ一致ごとの重み加算（1 + tagBonus × 一致数） */
  tagBonus: 1.5,
  rarityWeight: { common: 60, rare: 30, epic: 10 },
  rarityColor: { common: "#c0c0c0", rare: "#6a8cff", epic: "#c070ff" },
  cursedColor: "#ff5050",
  /** 衝撃波（3 段目 / コンボ 20）: 近接段ダメージに対する倍率 */
  waveDamageRatio: 0.6,
  waveSpeed: 240,
  waveLife: 0.4,
  waveRadius: 5,
  wavePierce: 99,
  waveColor: "#ffe0a0",
  comboWaveThreshold: 20,
  /** 弾返し（reflect）で撃ち返したときの必殺ゲージ倍率 */
  parryEnergyMul: 3,
  /** 部屋ロック中 / 非ロック中の移動速度倍率 */
  lockdownFastMul: 1.3,
  lockdownSlowMul: 0.9,
  /** HP 1 の代わりに JUST 窓（ダッシュ無敵・JUST 後の猶予）を何倍にするか */
  glassJustMul: 2,
  glassJustMaxHp: 1,
  heartBurnTime: 10,
  heartBurnMul: 2,
  reviveHpRatio: 0.3,
  reviveInvuln: 2,
  bossHpMul: 0.75,
  mobHpMul: 1.25,
  /** ダッシュ終点の爆発: 近接 1 段目ダメージに対する倍率 */
  dashBlastRatio: 0.8,
  dashBlastRadius: 28,
  clearInvulnTime: 5,
  clearHealMaxHpMul: 0.7,
  /** 背面撃ち: 追加弾のダメージ倍率 */
  rearShotDamageMul: 1,
  /** 静止射撃: この速度未満なら「止まっている」 */
  standStillSpeed: 8,
  standPierceBonus: 3,
  standSpeedMul: 1.5,
  triggerHappyFireMul: 2,
  guardTime: 0.35,
  guardColor: "#a0e0ff",
  comboClockEvery: 10,
  /** コンボ受付時間に掛ける倍率（comboWindowBonus で引く） */
  comboClockWindowMul: 0.5,
  overchargeRadius: 24,
  overchargeRatio: 0.5,
  overchargeIcd: 0.25,
  /** バースト 1 キルあたりの必殺ゲージ返還 */
  burstRefundPerKill: 25,
  burnSpreadRadius: 40,
  shatterShards: 6,
  shatterDamage: 6,
  shatterSpeed: 200,
  shatterLife: 0.4,
  shatterColor: "#a0e0ff",
  /** ダッシュ開始時の連鎖雷ダメージ（近接 1 段目に対する倍率） */
  dashShockRatio: 0.7,
  critChainRatio: 0.5,
  critChainIcd: 0.2,
  feastHeal: 3,
  frostLockSlow: 0.8,
  frostLockTime: 3,
} as const;
