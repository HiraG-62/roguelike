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
   * 近接 3 段。scaling は威力の係数（docs/COMBAT_DESIGN.md A-6。基礎値で 7.8 / 7.8 / 15.6）、
   * poise は基礎怯み値（D-2）、heavy は重いヒットストップと壁叩きつけを起こす段
   * base は 6 / 6 / 12 → ×0.8（QA 2026-09-23: スキル由来与ダメ比率 30.8%＜目標 55〜65%、
   * 通常攻撃の威力を落として相対的にスキル比率を上げる。docs/COMBAT_DESIGN.md B-7 段階 3）
   */
  melee: [
    { windup: 0.05, active: 0.1, recover: 0.16, scaling: { base: 4.8, str: 0.6 }, poise: 8, reach: 16, size: 26, knockback: 140, heavy: false },
    { windup: 0.05, active: 0.1, recover: 0.16, scaling: { base: 4.8, str: 0.6 }, poise: 8, reach: 18, size: 28, knockback: 160, heavy: false },
    { windup: 0.08, active: 0.12, recover: 0.3, scaling: { base: 9.6, str: 1.2 }, poise: 22, reach: 22, size: 38, knockback: 320, heavy: true },
  ],
  /** コンボ最終段の後、次の 1 段目まで待たせる時間 */
  comboLockout: 0.18,
  /** recover 中のこの割合を過ぎたら次段の先行入力を受け付ける */
  bufferWindow: 0.35,
  shoot: {
    cooldown: 0.17,
    speed: 300,
    /** 1 発の威力（基礎値で 4.3）と怯み値。base 3.5 → ×0.8（QA 2026-09-23、B-7 段階 3） */
    scaling: { base: 2.8, dex: 0.3 },
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
  // ---- 以下は docs/ideas/status-and-terrain.md（2026-09-24 追加の状態異常・反応・昇華） ----
  /** 燃焼の積み重ね（灼熱への昇華用。dps は強い方を採用のまま） */
  burnMaxStacks: 5,
  /** 同じ反応を同じ対象で起こせる間隔（秒） */
  reactionIcd: 0.5,
  /** 語彙「直前に消えた状態異常」を参照できる秒 */
  lastEndedWindow: 1,
  /** 語彙「異常数」「総スタック」の頭打ち */
  statusCountCap: 5,
  totalStacksCap: 15,
  /** 語彙「良い状態の数」の頭打ち */
  goodCountCap: 4,
  wet: {
    maxStacks: 3,
    duration: 5,
    /** 濡れている敵の感電の連鎖半径の倍率 */
    shockRadiusMul: 1.5,
  },
  soaked: {
    duration: 4,
    /** 移動と行動の遅さ（冷気と同じ掛け方） */
    slow: 0.3,
  },
  oiled: { duration: 6 },
  blaze: {
    duration: 4,
    /** 元の燃焼 dps に掛ける倍率と下限 */
    dpsMul: 2,
    minDps: 4,
    spreadRadius: 40,
    spreadInterval: 1,
  },
  corrode: {
    maxStacks: 5,
    duration: 6,
    /** 敵: 1 スタックあたり受ける怯み値 +8% */
    poisePerStack: 0.08,
    /** 自: 1 スタックあたり被ダメ +3% */
    playerTakenPerStack: 0.03,
  },
  brand: {
    maxStacks: 5,
    duration: 4,
    /** 起爆: 1 スタックあたりのダメージ（potency 0 のとき）と怯み値。怯み中なら × staggeredMul */
    damagePerStack: 6,
    poisePerStack: 6,
    staggeredMul: 1.5,
  },
  broken: {
    duration: 3,
    /** 受ける怯み値の倍率と、崩落（崩勢中に怯む）の怯み時間の倍率 */
    poiseMul: 1.3,
    staggerMul: 1.5,
  },
  doom: {
    duration: 4,
    /** 付与中に減った HP のうち、切れた瞬間にまとめて与える割合（脆弱中は vulnerableRatio） */
    ratio: 0.3,
    vulnerableRatio: 0.5,
  },
  siphon: {
    duration: 5,
    /** この敵への命中 1 回で回収するマナと、沈黙中の倍率（魔断） */
    manaPerHit: 1,
    silencedMul: 2,
    /** 倒したとき残り秒あたりに回収するマナ */
    manaPerSecOnKill: 2,
  },
  hue: {
    duration: 6,
    /** 共鳴の色と同じ色の彩痕なら受けるダメージ倍率 */
    takenMul: 1.15,
    /** 色爆: 紅 = 燃焼の残りのこの割合を即時 / 蒼 = 冷気 + chill / 翠 = HP 回復 / 冥 = 宣告の持続 */
    burstBurnRatio: 1,
    burstChill: 2,
    burstHeal: 3,
    burstDoomDuration: 4,
  },
  scorch: {
    duration: 4,
    dpsMul: 2,
    spreadRadius: 40,
    spreadInterval: 1,
    /** 灼熱に冷気を当てたときの蒸発の倍率 */
    vaporizeMul: 2,
  },
  venom: {
    duration: 4,
    damageMul: 1.5,
    /** 猛毒の敵が死ぬと残す毒沼の半径（px） */
    deathTerrainRadius: 24,
  },
  hemorrhage: {
    duration: 3,
    /** 静止していても毎秒 potency × スタック × perSec */
    perSec: 3,
  },
  encase: {
    /** 凍結中に冷気がこの回数入ると氷棺 */
    threshold: 3,
    /** 砕けたときの破片: 半径・本体の最大 HP に対する割合・上限・怯み値 */
    shardRadius: 50,
    shardHpRatio: 0.15,
    shardMax: 60,
    shardPoise: 15,
    /** 融解（燃焼で解ける）で残す水たまりの半径（px） */
    thawRadius: 20,
  },
  exposed: {
    /** 脆弱中に脆弱をこの回数付け直すと露呈 */
    threshold: 3,
    duration: 4,
    /** 受けるダメージ倍率（脆弱の 1.2 を置き換える） */
    mul: 1.4,
  },
  enfeeble: {
    threshold: 3,
    duration: 4,
    /** 与えるダメージ倍率（弱体の 0.75 を置き換える） */
    mul: 0.5,
  },
  haste: {
    duration: 3,
    moveMul: 1.2,
    /** 攻撃が当たるたびに延びる秒と、延長の上限 */
    extendOnHit: 0.5,
    maxTime: 6,
    /** 奮起: 冷気を 1 つ食って延びる秒 */
    chillExtend: 1,
  },
  harden: {
    duration: 2,
    takenMul: 0.8,
    moveMul: 0.85,
    /** 氷鎧: 冷気 1 スタックごとの追加軽減 */
    iceArmorPerChill: 0.05,
  },
  wrath: {
    maxStacks: 5,
    duration: 6,
    /** 1 スタックあたり与える怯み値 +10% */
    poisePerStack: 0.1,
    /** 被弾で +1、自分が怯むと +2（逆上） */
    onHurt: 1,
    onStagger: 2,
  },
  fury: {
    duration: 4,
    poiseMul: 1.5,
    damageMul: 1.15,
    takenMul: 1.2,
  },
  charged: {
    maxStacks: 6,
    duration: 5,
    /** 近接 1 回の放電ダメージ（potency 0 のとき） */
    damage: 6,
    /** 放電（濡れ + 帯電）: 半径の倍率と自分への小ダメージ */
    wetRadiusMul: 2,
    wetSelfDamage: 1,
  },
  steam: {
    /** 蒸気: 周囲の敵に弱体 */
    radius: 40,
    weakenDuration: 2,
  },
  conduct: {
    /** 拡散: 濡れた敵に感電が入った瞬間の連鎖（半径倍率・追加の対象数・potency 0 のときのダメージ） */
    radiusMul: 2,
    extraTargets: 2,
    damage: 4,
  },
  kindle: { dps: 3, duration: 3 },
  /** 急冷: 濡れを消費して冷気 + chillBonus。濡れが上限（3）なら凍結の閾値まで一気に積む */
  quench: { chillBonus: 2 },
  miasma: {
    /** 毒霧: 毒沼を置く半径（px）と周囲の敵へ毒 1 を配る半径 */
    terrainRadius: 24,
    radius: 50,
    duration: 4,
  },
  shatterBleed: {
    /** 砕血: 出血スタック × potency × 残り秒 × perStackSec を即時。周囲 1 体へ出血 1 */
    perStackSec: 4,
    spreadRadius: 60,
  },
  cauterize: {
    /** 焼灼: 出血スタック × potency × 残り秒 × perStackSec を即時（自分にも起きる） */
    perStackSec: 3,
    /** プレイヤーに起きたときの倍率（燃える床で出血を止める代わりの小ダメージにとどめる） */
    playerMul: 0.25,
  },
  panic: { bleedMul: 2 },
  lacerate: { extraStacks: 2 },
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
  /** 6 → 5（2026-09-24 プレイ所見: 回復が早すぎコストが機能していない。最大マナの伸びは装備・祝福に置く） */
  mndMaxMana: 5,
  /** 0.3 → 0.45（QA 2026-09-23: スキル由来与ダメ比率 33.4%＜目標 55〜65%。マナ回復を上げて発動頻度を底上げ）。
   * 0.45 → 0.12（2026-09-24 プレイ所見: 回復が早すぎコストが機能していない。精神を振っても自然回復だけでは撃ち放題にならないようにする） */
  mndManaRegen: 0.12,
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
} as const;

/** マナ（docs/COMBAT_DESIGN.md B-1）。スキルの資源 */
export const MANA = {
  /**
   * 精神 base のときの最大マナと自然回復 / 秒。3.5 → 4.5（QA 2026-09-23: マナ不足不発 20 回/180 run と少ないため、不発を増やさない範囲でスキル使用頻度を上げる）。
   * 最大 100 → 80、回復 4.5 → 1.2（2026-09-24 プレイ所見: 回復が早すぎコストが機能していない。序盤は満タンから 3〜4 発でほぼ空になり、
   * 回復・軽減は装備の性質と祝福で伸ばす）
   */
  baseMax: 80,
  baseRegen: 1.2,
  /** 封鎖されていない部屋・通路での自然回復倍率（待ち時間を作らない）。4 → 2.5（2026-09-24 プレイ所見: 回復が早すぎコストが機能していない） */
  idleRegenMul: 2.5,
  /**
   * 近接各段の命中 1 体ごと。[4,4,7] → [5,5,8]（QA 2026-09-23: スキル由来与ダメ比率 30.8%＜目標のため回収を強化）。
   * [5,5,8] → [3,3,5]、上限 3 → 2 体、ダッシュ攻撃 5 → 3（2026-09-24 プレイ所見: 回復が早すぎコストが機能していない。1 振りで大きく戻らず、殴り続けて少しずつ貯める）
   */
  onMelee: [3, 3, 5],
  /** 近接 1 振りで回収する敵の上限 */
  meleeTargetCap: 2,
  onDashAttack: 3,
  /** カウンターヒットなら倍 */
  onCounterMul: 2,
  /** 射撃弾の命中 1 体ごとと、1 回の射撃で回収できる上限（発数） */
  /** 1.5 → 1、ジャスト 15 → 12（2026-09-24 プレイ所見: 回復が早すぎコストが機能していない）。撃破は 2 → 4（倒し切る価値を上げ、回収の主軸を撃破にも置く） */
  onShot: 1,
  shotVolleyCap: 3,
  onJust: 12,
  onKill: 4,
  /** 装備・祝福で下げられるコスト倍率の下限（0 コストにはしない） */
  costMulMin: 0.4,
  /**
   * 最大マナの下限。涸れ井戸の性質の重ね掛け・精神低下・虚ろの器で 0 になると、
   * スキルのコストが最大マナで切り詰められて 0（撃ち放題）になるため
   */
  maxMin: 20,
  /** ラン開始で満タン */
  startFull: true,
  /** 階層到達で最大のこの割合まで回復（既に上回っていれば何もしない）。満タン回復は階段が補給所になりすぎるのでやめた（2026-09-24 プレイ所見: 回復が早すぎコストが機能していない） */
  descendRefill: 0.5,
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
  /** 怯んでいない敵へのノックバック倍率。0.35 → 0.45（QA 2026-09-23: 1 対 1 被弾 9.33 回/60 秒＞目標 1〜3、
   * 怯まない敵を押し返しやすくして密着を崩す） */
  knockbackUnstaggered: 0.45,
  /** 盾騎士が正面の近接をブロックしたときに溜まる怯み値の割合 */
  blockMul: 0.5,
  /** 猪の壁激突の自傷怯み（秒） */
  chargerWallStagger: 0.9,
  // ---- 怯みの拡張（docs/ideas/status-and-terrain.md 4 章、2026-09-24） ----
  /** 処刑: 怯み中で HP がこの割合以下の敵に、怯み値 executeMinPoise 以上の一撃（近接 3 段目など）で即死。ボスは除く */
  executeHpRatio: 0.25,
  executeMinPoise: 20,
  executeMana: 10,
  /** 処刑の瞬間、周囲の敵に恐怖 */
  executeFearRadius: 60,
  executeFearDuration: 0.5,
  /** 背面の一撃: 敵の向きの背後（内積がこれ未満）からの怯み値は堅守を無視して × backstabMul */
  backstabDot: -0.3,
  backstabMul: 1.25,
  /** 怯みの伝播: 怯んだ瞬間、周囲の敵に怯み値（連鎖はしない） */
  spreadRadius: 40,
  spreadPoise: 15,
} as const;

/** 地形の層（docs/ideas/status-and-terrain.md 3 章）。src/system/terrain.ts と src/map/generator.ts の planTerrain が読む */
export const TERRAIN = {
  /** 上に立つ者へ効果を入れる周期（秒） */
  tickInterval: 0.5,
  water: { wetStacks: 1 },
  oil: { oiledStacks: 1 },
  /** 溶岩: QA bot が固まらないよう軽め。ダッシュ中は無傷 */
  lava: { damage: 1, enemyDamage: 3, burnDps: 2, burnDuration: 1.5 },
  /** 毒沼: 周期ごとに毒 1、corrodeEvery 回に 1 回腐食 1 */
  bog: { poisonDuration: 3, corrodeEvery: 3 },
  /** 氷床: chillEvery 回に 1 回冷気 1。滑り = 入力への追従の速さ（1/秒） */
  ice: { chillEvery: 4, chillDuration: 2, accel: 5 },
  /** 炎: 上に立つと燃焼。油・草に燃え移る。燃え尽きると何も残らない */
  fire: {
    burnDps: 3,
    burnDuration: 2,
    /** 油・草が燃えている秒 */
    oilBurnTime: 3,
    grassBurnTime: 2,
    /** 隣のセルへ燃え移るまでの秒 */
    spreadOil: 0.3,
    spreadGrass: 0.8,
  },
  /** placeTerrain で置いた地形の既定の持続（秒）。0 は消えない */
  placedDuration: { none: 0, water: 8, oil: 10, lava: 6, bog: 6, ice: 6, grass: 0, fire: 3 },
  /** マップ生成時の配置 */
  gen: {
    patchesBase: 1,
    patchesPerDepth: 0.5,
    patchesMax: 6,
    /** 1 つの塊の半径（タイル） */
    radiusMin: 1,
    radiusMax: 2,
    /** 種類ごとの出始める深度と重み */
    minDepth: { water: 1, grass: 1, oil: 2, ice: 3, bog: 3, lava: 5 },
    weight: { water: 3, grass: 3, oil: 2, ice: 2, bog: 2, lava: 1 },
  },
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
  // ---- 文法の拡張（docs/ideas/loot-expansion.md 6 章） ----
  /** 条件 manaLow: 最大マナに対するこの割合未満 */
  manaLowRatio: 0.25,
  /** 条件 targetMultiStatus: 対象の状態異常の種類数 */
  multiStatusKinds: 2,
  /** 効果 extendStatus: 延ばした後の残り秒の上限（付け直しの延命を青天井にしない） */
  extendMax: 8,
  /** 効果 volley: 2 発以上のときの扇の角度（ラジアン、隣との間隔） */
  volleySpread: 0.12,
  /** 効果 inflict: 行動停止系の持続の上限（秒）。拘束上限とは別に 1 回の長さを抑える */
  inflictHaltMax: 1.2,
  /** 効果 inflict の効果量（燃焼 = dps、出血 = 10px あたり、感電 = 連鎖ダメージ）。他は STATUS の既定値 */
  inflictBurnDps: 5,
  inflictBleed: 1.5,
  inflictShock: 6,
  /** 性質のルール変更（system/traitHooks.ts） */
  trait: {
    /** 底打ち: 最大マナに対するこの割合未満を「少ない」とみなす */
    lowManaRatio: 0.25,
    /** 身代わり: 払えたときの被ダメージ倍率 */
    manaShieldMul: 0.5,
    manaShieldColor: "#80c0ff",
    /** 崩れの反響: 怯ませた敵の周囲の半径。基本の「怯みの伝播」（POISE.spreadRadius）より広く届く */
    staggerQuakeRadius: 72,
    /** 楔: 蓄積がこの割合以上の敵に強く効く */
    wedgeRatio: 0.5,
    /** 与ダメージ・怯み値の性質の倍率の下限（減少を重ねても 0 にしない） */
    minMul: 0.1,
  },
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
  // ---- 2026-09 追加の誓約（docs/ideas/loot-expansion.md 2 章） ----
  /** ks_wedgeOath（楔の誓い）: 怯み値の倍率と、怯んでいない敵への与ダメージ倍率 */
  wedgePoiseMul: 2.5,
  wedgeUnstaggeredMul: 0.6,
  /** ks_unshaken（揺るがぬ誓い）: 与ダメージの上乗せと、怯み値の上昇分をダメージへ移す割合 */
  unshakenDamageBonus: 0.35,
  unshakenPoiseToDamage: 0.5,
  /** ks_chokehold（締め上げの誓い）: 怯み値の倍率（堅守は無視する） */
  chokeholdPoiseMul: 0.7,
  /** ks_readOath（読み勝ちの誓い）: 予備動作中の敵への近接の怯み値倍率と、それ以外への近接の与ダメージ倍率 */
  readPoiseMul: 10,
  readOffWindupDamageMul: 0.7,
  /** ks_backwater（背水の誓い）: 封鎖中の与ダメージ倍率と、制圧時に取り戻す「失った HP」の割合（%） */
  backwaterDamageMul: 1.15,
  backwaterClearHealPct: 50,
  /** ks_reaperOath（死神の誓い）: 死神の時計の進みの倍率と与ダメージ倍率（出る前 / 出た後） */
  reaperOathClockMul: 2,
  reaperOathDamageMul: 1.15,
  reaperOathHuntedMul: 1.4,
  /** ks_chant（詠唱の誓い）: 近接・射撃の与ダメージ倍率 / 通常攻撃のマナ回収倍率 / スキル威力の上乗せ */
  chantAttackDamageMul: 0.3,
  chantManaMul: 4,
  chantSkillBonus: 0.5,
  /** ks_blight（蝕みの誓約）: 付与確率の倍率と、受ける状態異常の持続の倍率 */
  blightChanceMul: 2,
  blightTakenMul: 2,
  /** ks_contagion（病みの誓い）: 直接ダメージ倍率と、死んだ敵の状態異常が移る半径 */
  contagionDamageMul: 0.6,
  contagionRadius: 60,
  /** ks_monochrome（単色の誓い）: 支配の閾値と、支配色以外の性質の係数 */
  monochromeRatio: 0.35,
  monochromeDamping: 0.5,
  /** ks_colorless（無色の誓い）: 共鳴を捨てた代わりの性質の値の倍率 */
  colorlessTraitMul: 1.2,
  /** ks_discipline（修行の誓い）: 来歴の進みの倍率と与ダメージ倍率 */
  disciplineProgress: 3,
  disciplineDamageMul: 0.8,
  /** ks_oblivion（忘却の誓い）: 装備全体の余白 1 につき全ステータス */
  oblivionAttrPerMargin: 1,
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
  /** 2 → 3（QA 2026-09-23: depth 1/2 到達率 100% / 88.9% で前回比 0% / −6.4%、目標 −10〜−20% に対し下げ不足。
   * bat 群れは既に minDepth 1 で出現済みのため許可では効果が薄く、baseEnemies を上げて全 depth 一律の
   * 湧き数を +1 する方を採った）
   */
  baseEnemies: 3,
  /**
   * 敵数 = baseEnemies + floor(depth * enemiesPerDepth)。0.8 → 1.0（QA 2026-09-23: depth 2/3 到達率
   * 82.8% / 58.9%、前回比 -6.9% / -1.8% で目標 -10〜-20% に届かず。depth 1: 3+1、depth 2: 3+2 になる）
   */
  enemiesPerDepth: 1.0,
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
  // ---- 以下 2026-09-24 敵の量産（docs/ideas/enemies.md） ----
  /** 射撃の弾・死に際の弾の共通 */
  volley: {
    bulletLife: 3,
    bulletRadius: 3,
  },
  /** 狼の回り込み: この距離より遠いときだけ横へ回る（近づいたら素直に飛びかかる） */
  flank: { minDist: 60 },
  /** 金色スライム: 逃げる速さの倍率と、消えるときの色 */
  timid: { fleeMul: 1, color: "#f8d848" },
  /** 腐肉蝿などの死に際の弾・逃げ足 */
  deathBurst: { life: 2 },
  /** 角甲虫が壁に激突したときの落石（予告の影 → 爆発扱いの落下） */
  rockfall: { count: 3, spread: 44, radius: 16, damage: 14, fuse: 0.9 },
  /** 自爆の予告の円は explode.radius。窓は windup */
  kamikaze: { color: "#ff8030" },
  /** 残像打ち: delay 秒前のプレイヤーの位置を狙う */
  echoStriker: {
    delay: 1.5,
    sampleInterval: 0.1,
    radius: 26,
    damage: 16,
    /** この距離を保つ */
    keepAway: 110,
    color: "#b090ff",
  },
  /** 群れの長: 倒れると取り巻きが怯える秒 */
  packLeader: { fearTime: 3 },
  /** 骨の楽団長: 指揮の弾（扇） */
  conductor: { bulletCount: 5, spreadDeg: 60, bulletSpeed: 105, bulletDamage: 8, keepAway: 110, color: "#c060e0" },
  /** マナ喰い: 1 噛みで奪うマナと、倒したときに返す倍率 */
  manaLeech: { steal: 20, returnMul: 1.5 },
  /** 死骸（骨拾い・墓守の鐘・貪食の が使う） */
  corpse: { lifetime: 12, max: 24 },
  /** 骨拾い: 死骸を探す半径、食べる秒、1 段ごとの伸び、段の上限 */
  scavenger: {
    seekRadius: 180,
    eatRange: 10,
    eatTime: 1.0,
    maxGrowth: 3,
    hpPerGrowth: 0.35,
    damagePerGrowth: 0.3,
    radiusPerGrowth: 1,
    color: "#b0f0a0",
  },
  /** 墓守の鐘: 何回鳴ると死骸を蘇らせるか */
  graveBell: { rings: 3, color: "#f8d848" },
  /** 沈黙の修道士: 予告の円の半径と、炸裂で付く沈黙の秒 */
  silencer: { radius: 50, duration: 3, keepAway: 100, color: "#c060e0" },
  /** 霜砕き: 冷気・凍結のプレイヤーにだけ出す砕きの衝撃波 */
  frostCrusher: { ringRadius: 55, damage: 30, color: "#8fd0ff" },
  /** 双子の影: 片方が倒れてから蘇るまでの猶予と、蘇ったときの HP 割合 */
  twinShade: { reviveTime: 3, reviveHpRatio: 0.6, color: "#b090ff" },
  /** 喰らう宝箱: 舌の薙ぎ払い（短いレーザー）と噛みつきの突進倍率 */
  mimic: { tongueLength: 90, tongueDamage: 16, biteSpeedMul: 5, color: "#e04848" },
  /** 鎧の中身: 叩きつけの衝撃波と、鎧が割れたときの怯み */
  hollowArmor: { ringRadius: 60, damage: 22, breakStagger: 2, color: "#c8c8d0" },
} as const;

/**
 * 敵の攻撃テンポ（docs/COMBAT_DESIGN.md C-2）: 深度による予備動作短縮・連携ずらし・連続攻撃。
 * 予備動作は深度と迅速エリートを掛けても基準の windupFloor 倍を下回らない（読める長さを守る）
 */
export const ENEMY_TEMPO = {
  /** 予備動作 × max(windupDepthMin, 1 − windupDepthStep × (深度 − 1))。0.02 → 0.015（QA 2026-09-23:
   * 1 対 1 被弾 9.33 回/60 秒＞目標 1〜3。深度による予備動作短縮を緩め、下限 windupFloor は維持） */
  windupDepthStep: 0.015,
  windupDepthMin: 0.75,
  /** 深度・エリートを掛けた後の下限（基準に対する割合） */
  windupFloor: 0.6,
  /** 連携ずらし: 1 体が予備動作に入ると、この半径内で攻撃間隔の残りが coordCooldownMax 以下の敵を遅らせる */
  coordRadius: 90,
  coordCooldownMax: 0.4,
  coordDelay: 0.2,
  /** 蝙蝠の群れは噛みをこの秒ずつずらす */
  batCoordDelay: 0.15,
  /**
   * 連続攻撃（敵 key ごと）。count = 追加の撃数、windup = 2 撃目以降の予備動作（これも深度で縮む）。
   * onWallOnly は猪: 壁に激突したときだけ反転してもう 1 回（それ以外の終わり方では続けない）
   */
  followUps: {
    slime: { minDepth: 4, count: 1, windup: 0.25, onWallOnly: false },
    knight: { minDepth: 1, count: 1, windup: 0.3, onWallOnly: false },
    boar: { minDepth: 6, count: 1, windup: 0.35, onWallOnly: true },
    golem: { minDepth: 1, count: 1, windup: 0.5, onWallOnly: false },
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
  // ---- 以下 2026-09-24 追加の修飾子（docs/ideas/enemies.md 4 章） ----
  /** 残響の: 攻撃の後、この予備動作でもう一度同じ攻撃を繰り返す */
  echoWindup: 0.8,
  /** 堅牢の: 怯み耐性の追加倍率（eliteMul に掛ける）、怯みの延長倍率、怯んだときの脆弱の秒 */
  bulwarkPoiseMul: 2,
  bulwarkStaggerMul: 2,
  bulwarkVulnerableTime: 3,
  /** 報復の: 怯んでから衝撃波を返すまでの秒と、衝撃波の半径・威力 */
  retaliateDelay: 0.4,
  retaliateRadius: 56,
  retaliateDamage: 14,
  /** 分光の: 受けた状態異常への免疫の秒 */
  prismaticImmune: 5,
  /** 刻限の: 時計の秒と、切れた後の怯み耐性の倍率（速さは迅速と同じ） */
  timedClock: 12,
  timedPoiseMul: 2,
  /** 寄生の: 倒れたときに出る蝙蝠の数と HP */
  parasiteCount: 4,
  parasiteHp: 3,
  /** 不動の: 移動の倍率 */
  anchoredSpeedMul: 0.7,
  /** 貪食の: 死骸を吸う距離と、1 体で回復する最大 HP の割合 */
  devourRange: 48,
  devourHeal: 0.25,
  /** 群長の: 連れて湧く小型の数と HP の割合 */
  packedCount: 2,
  packedHpRatio: 0.5,
  packedOffset: 16,
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
  /** 双子の騎士（兄 = 剣と盾 / 妹 = 弓）。相方が倒れると形見を拾って両方の技を使う */
  twinKnights: {
    /** 兄の突進（def.speed に掛ける） */
    lungeSpeedMul: 6,
    /** 妹の矢 */
    arrowSpeed: 160,
    arrowDamage: 10,
    arrowCount: 3,
    arrowSpreadDeg: 24,
    /** 第 3 段階の矢の数 */
    rageArrowCount: 5,
    /** 妹の保ちたい距離 */
    keepAway: 120,
    /** 相方を失った後の予備動作の倍率（形見の技は溜めが長い） */
    bereavedWindupMul: 1.2,
    /** この HP 割合を切ると第 3 段階（激昂） */
    rageRatio: 0.35,
    /** 第 3 段階の攻撃間隔の倍率 */
    rageIntervalMul: 0.7,
    color: "#e0e0ff",
  },
  /** 霜の巨人: 叩きつけ → つらら → 氷の鎧 */
  frostGiant: {
    slamRadius: 80,
    slamDamage: 22,
    /** 叩きつけの真下の判定（半径に対する割合） */
    slamCoreRatio: 0.35,
    /** 第 2 段階へ（つららを混ぜる） */
    phase2Ratio: 0.6,
    /** 第 3 段階へ（氷の鎧と氷柱） */
    phase3Ratio: 0.25,
    icicleCount: 6,
    icicleRadius: 18,
    icicleDamage: 14,
    /** 予告の影が出てから落ちるまで */
    icicleFall: 1.1,
    /** プレイヤーの周りに落とす範囲 */
    icicleSpread: 70,
    pillarCount: 4,
    pillarDistance: 64,
    /** 氷柱を全部割ったときのダウン */
    armorBreakDown: 3,
    color: "#8fd0ff",
  },
} as const;

/** 追跡者（Reaper） */
export const REAPER = {
  /**
   * 出現までの猶予（秒）の基礎値。実際の猶予は appearAfter + 部屋数 * appearPerRoom。
   * 90 → 105（QA 2026-09-24: マナ経済の締め直しで各階層の滞在が約 10 秒伸び、Reaper 出現が 2 倍近くに増えたため猶予を補正）
   */
  appearAfter: 105,
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
    text: "弾返し",
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
    /** 威力（基礎値で 11.2）と怯み値。base 9 → ×0.8（QA 2026-09-23、B-7 段階 3） */
    scaling: { base: 7.2, str: 0.8 },
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
  /** 偏重: 最も高いステータスの実効値に掛ける倍率（最も低いものは 0 として扱う） */
  lopsidedHighMul: 1.25,
  /** 霊刃: 通常攻撃に加わる霊力の係数と、通常攻撃のマナ回収倍率 */
  spiritBladeSpi: 0.3,
  spiritBladeManaMul: 0.5,
  /** 疫病: 毒の敵が死んだとき毒を引き継ぐ半径 */
  plagueRadius: 48,
  plagueColor: "#80d040",
  /** 血煙: 出血の敵を倒したときの回復量 */
  bloodMistHeal: 3,
  bloodMistColor: "#d04050",
  /** 凍て刺し: 砕きで周囲に付ける冷気のスタックと半径 */
  frostPierceStacks: 2,
  frostPierceRadius: 44,
  /** 湧水: 制圧で満タンにしたときの浮き文字の色 */
  springWellColor: "#60c0ff",
  /** 血の対価: この HP 割合以下でスキルのコストに掛ける倍率 */
  bloodManaHpRatio: 0.5,
  bloodManaCostMul: 0.6,
  /** 屠りの盃: 撃破で戻るマナ（MANA.onKill に加算）と、自然回復の倍率 */
  reaperCupKillMana: 10,
  reaperCupRegenMul: 0.5,
  /** 見切りの息: ジャスト回避で戻るマナ（MANA.onJust に加算） */
  keenBreathJustMana: 25,
  /** 循環: スキル命中 1 回で戻るマナと、1 回の発動で戻せる上限 */
  circulationPerHit: 2,
  circulationCap: 8,
  /** 虚ろの器: コスト倍率・最大マナ倍率・通常攻撃のマナ回収倍率 */
  hollowVesselCostMul: 0.65,
  hollowVesselMaxManaMul: 0.6,
  hollowVesselAttackManaMul: 0.5,
  // ---- 祝福の拡張（docs/ideas/boons-expansion.md。system/boonRules.ts） ----
  /** 呪いを受けて 4 択にしたときの枚数 */
  choiceCountWithCurse: 4,
  /** 取得済み祝福の「出す」タグ 1 つ一致ごとの重み加算（装備タグ tagBonus の半分） */
  givesTagBonus: 0.75,
  /** 系譜の前段を持つときの次段 / 結びの重み倍率 */
  lineageWeightMul: 2,
  duoWeightMul: 3,
  /** 祝福が付ける燃焼の dps / 感電の強さ（近接 1 段目に対する割合。装備の値が大きければそちら） */
  emberDpsRatio: 0.4,
  shockPotencyRatio: 0.5,
  /** 延焼: 燃焼を移す半径と、移す間隔の下限（秒） */
  wildfireRadius: 32,
  wildfireIcd: 0.3,
  /** 灰積もり: 灰の寿命・同時に残る数・拾う半径・溜められる回数・燃焼の倍率・粒子の間隔（tick） */
  ashLife: 8,
  ashMax: 6,
  ashPickupRadius: 10,
  ashMaxCharges: 3,
  ashBurnMul: 2,
  ashFxEvery: 12,
  ashColor: "#a09080",
  /** 焦土: 起爆する半径と、残りの燃焼ダメージに掛ける倍率 */
  scorchRadius: 160,
  scorchMul: 1.5,
  /** 霜息: 射撃で付ける冷気の遅さ（装備の値が大きければそちら） */
  frostBreathSlow: 0.12,
  /** 凍て足: この冷気のスタック以上で予備動作に掛ける倍率 */
  frostFeetStacks: 3,
  frostFeetMul: 1.4,
  /** 砕氷の鐘: 連鎖して砕く半径と、砕く一撃（近接 1 段目に対する割合） */
  bellRadius: 40,
  bellRatio: 0.5,
  /** 永冬: ジャスト回避で凍結させる半径 */
  winterRadius: 64,
  /** 抜き胴 / 静電気: すり抜け判定の余白・威力（近接 1 段目に対する割合）・怯み値 */
  passCutReach: 4,
  passCutRatio: 0.6,
  passCutPoise: 10,
  chargedBladeIcd: 0.3,
  /** 落雷予告: 予告の秒数・半径・威力（近接 1 段目に対する割合）・怯み値・同時の上限・稲妻の長さ */
  markDelay: 1,
  markRadius: 20,
  markRatio: 1.2,
  markPoise: 15,
  markMax: 8,
  markBoltHeight: 60,
  /** 雷神の鼓: コンボの区切り・起点を探す半径・起点の上限 */
  drumEvery: 10,
  drumRadius: 200,
  drumMaxSources: 6,
  /** 月読: 沈黙の秒数 */
  moonReadSilence: 0.5,
  /** 満ち潮: マナ満タン中の通常攻撃 1 命中で溜まる必殺ゲージ */
  highTideEnergy: 3,
  /** 新月 / 月蝕 / 明鏡: 払ったマナが戻る窓（秒）。月蝕の成立に必要な装着数 */
  newMoonWindow: 2,
  eclipseWindow: 2,
  eclipseMinSlots: 2,
  mirrorWindow: 1.5,
  /** 奪弾: 奪う半径・威力倍率・最低速度・最低寿命・色 */
  stealRadius: 48,
  stealDamageMul: 1.5,
  stealMinSpeed: 180,
  stealMinLife: 0.6,
  stealColor: "#ffe080",
  /** 口封じ / 睨み / 威圧 / 狩り立て / 神経断ち / 傷の記憶: 付ける状態異常の秒数（威圧は半径も） */
  silenceShotTime: 1.5,
  glareTime: 4,
  intimidateRadius: 48,
  intimidateTime: 0.8,
  huntFearTime: 0.6,
  nerveCutTime: 3,
  woundTime: 4,
  /** 死神遊び: ジャスト回避で死神が止まる秒数 */
  reaperStunTime: 3,
  /** 起き上がり狙い: 怯みが解けてからカウンターになる秒数 */
  wakeupWindow: 0.4,
  /** 属性の轍: 帯を置く間隔・寿命・半径・同じ敵への付与間隔・点の上限・既定の燃焼 dps / 冷気の遅さ */
  trailDropInterval: 0.05,
  trailLife: 0.8,
  trailRadius: 8,
  trailIcd: 0.3,
  trailMaxPoints: 40,
  trailBurnDps: 4,
  trailChillSlow: 0.12,
  /** 呼び戻し: 連発の下限（秒）と戻る弾の最低速度 */
  recallIcd: 0.5,
  recallMinSpeed: 200,
  /** 両輪: 次のマナのスキルのコスト倍率 / クールダウンの短縮（秒） */
  twinCostMul: 0.5,
  twinCdCut: 1,
  /** 氷伝い: 冷気の敵を経由したときに延びる連鎖の回数 */
  iceRelayJumps: 2,
  /** 片翼: 3 段目で出す弾の最低数と扇の間隔（度） */
  oneWingMinShots: 3,
  oneWingSpreadDeg: 12,
  oneWingColor: "#ffd0a0",
  /** 跳弾 / 炸裂弾頭 / 狙い目 */
  ricochetDamageMul: 1.3,
  warheadRadius: 20,
  warheadRatio: 0.5,
  weakSpotPierce: 2,
  /** 燠火: 燃焼の残り時間の延長（秒） */
  embersExtend: 1,
  /** 裂傷: 消費に必要な出血のスタックと、1 スタックあたり何回ぶんの出血ダメージを即時に与えるか */
  lacerationStacks: 3,
  lacerationUnits: 10,
  /** 綻び広げ: 脆弱を移す先を探す半径 */
  frayRange: 120,
  /** 静寂の間: 沈黙中の敵を探す半径とコスト倍率 */
  quietHallRadius: 200,
  quietHallCostMul: 0.7,
  keenEyeMana: 8,
  /** 崩し連鎖: 同じ部屋の敵の怯み耐性に対して足す割合 */
  collapseRatio: 0.2,
  /** 立て直し狩り: 必殺ゲージの最大値に対して足す割合 */
  regroupEnergyRatio: 0.3,
  edgeStrikeWindow: 0.3,
  edgeStrikePoiseMul: 2,
  cashOutManaPerCombo: 2,
  reaperShadowMana: 10,
  reaperShadowEnergy: 10,
  stallTimeDelay: 10,
  deathRushMaxHpMul: 0.5,
  deathRushInvuln: 0.5,
  burdenMoveMul: 0.75,
  burdenPoiseMul: 2,
  /** 業の火: 燃焼 dps の倍率・自分が燃える半径・間隔・燃焼の秒数と dps */
  karmaBurnMul: 2,
  karmaRadius: 32,
  karmaIcd: 1,
  karmaBurnTime: 2,
  karmaBurnDps: 2,
  afterglowWindow: 0.6,
  afterglowManaMul: 2,
  usurpPoiseMul: 2,
  /** 綱渡り: 被弾時の追加ダメージ = コンボ数 / この値 */
  tightropeComboDiv: 5,
  /** 飛燕: 空振りの斬撃波の威力（近接 1 段目に対する割合） */
  swallowFlightRatio: 0.4,
  chantReturnManaMul: 3,
  /** 満月撃ち: 満タンで撃ってから命中を数える秒数 */
  fullMoonWindow: 1,
  /** 燕返し: 斬り渡る上限・届く距離・威力（近接 1 段目に対する割合）・怯み値 */
  swallowMaxTargets: 5,
  swallowRange: 120,
  swallowRatio: 1,
  swallowPoise: 15,
  thunderBlastStacks: 2,
  /** 総崩れ: 脆弱が伝わる半径 */
  collapseSpreadRadius: 40,
  hollowBladeMul: 2,
  winterNestMul: 1.2,
  /** 臨界: バースト後に過充填の爆発が続く秒数 */
  criticalWindow: 3,
  /** 瞬停: ダッシュの残りがこの秒数以下なら静止扱い */
  stillDashWindow: 0.2,
  /** 浮き文字 */
  ruleTextColor: "#ffd75f",
} as const;
