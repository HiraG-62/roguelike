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
} as const;

/**
 * 回復の上限と条件（docs/COMBAT_DESIGN.md「回復の設計」。system/combat.ts）。
 * memo 2026-09-24: 回復手段が豊富すぎて死ににくいので、戦闘中の回復を 1 つの上限に束ねる
 */
export const HEAL = {
  /** 戦闘中の回復（命中時・撃破時・祝福の撃破回復）を束ねる窓（秒） */
  sustainWindow: 1,
  /** その窓の間に回復できる合計（最大 HP に対する割合）。多段ヒット・連続撃破で回復し放題にしない */
  sustainCapRatio: 0.04,
  /** 撃破時HP回復が発動するコンボ数の下限（雑に 1 体倒すだけでは回復しない） */
  killHealMinCombo: 5,
  // HP 自然回復を止める「戦闘中」の判定はマナと同じ（封鎖中 or MANA.combatRadius 内に生きた敵。system/combat.ts）
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
   * この半径（px）に生きた敵がいる間は idleRegenMul を掛けない（戦闘中は等倍）。
   * 開放型フロア（2026-09-24）で「封鎖中」の代わりに使う。気付かれる距離（110）より少し広い
   */
  combatRadius: 140,
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
  /**
   * 通常攻撃のマナ回収に掛かる倍率（誓約 × 祝福 × 性質「底打ち」）の積の上限。
   * 詠唱の誓い × 余韻 × 詠唱返しなどを重ねると 24 倍に届き、数発で満タンになるため
   */
  attackGainMulMax: 6,
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
    /** 余韻斬り: 衝撃波を出す最低のコンボ数と、数えるコンボの上限 */
    comboBreakMin: 3,
    comboBreakCap: 30,
    /** 撃ち込み杭: 1 体に刺さる弾の上限 */
    stakeMax: 8,
    stakeColor: "#ffd060",
    /** 形見: 乗せる状態異常の持続（秒） */
    inheritDuration: 3,
    /** 杭打ち: 怯ませた敵からこの距離の設置物を延ばす */
    placedExtendRadius: 80,
    /** 血の署名: HP の割合がこれ未満で効く */
    lowHpRatio: 0.5,
    /** 祝福の響き: 色に対応しない祝福 1 つにつきの与ダメージの減少 */
    boonEchoOffPenalty: 0.02,
    // ---- 2026-09 第 2 弾（属性・武器種・地形・持ち替え。system/traitHooks.ts） ----
    /** 散弾の「近い敵」の距離（px、縁どうしではなく中心間） */
    spreadCloseRange: 48,
    /** 持ち替え（天秤）の重なりが途切れるまでの秒 */
    alternateWindow: 2,
    /** 地形の衝撃波の半径と、状態異常の秒・内部クールダウン */
    terrainBlastRadius: 56,
    terrainBlastStatusSec: 3,
    terrainBlastIcd: 0.4,
    /** 燃えている敵を倒したときに置く炎の半径（px） */
    burningKillFireRadius: 12,
    /** ダッシュの氷の轍の半径（px） */
    iceTrailRadius: 8,
    /** 連射の烙印 1 つの秒とスタック */
    rapidBrandSec: 4,
    /** 属性の性質・誓約の倍率の下限（減少を重ねても 0 にしない） */
    elementMinMul: 0.1,
  },
} as const;

/**
 * 統一ルール文法とイベント（src/core/events.ts / src/core/rules.ts / src/system/rules.ts）。
 * docs/ideas/synergy-web.md 3 章・6 章 C7（世代減衰）
 */
export const SYNERGY = {
  /** この深さ以上のイベントは Rule を起こさない（環が回っても 3 段で止まる） */
  maxDepth: 3,
  /** 深さ 1 段ごとに効果量へ掛ける倍率 */
  chainDecay: 0.5,
  /** 条件 recent と state.recent の数え直しの窓（秒） */
  recentWindow: 3,
  /** 1 語が keywordWindow 秒あたりに起こせる効果の回数（環を 2 本重ねても爆発が倍にならない） */
  keywordBudget: 6,
  keywordWindow: 1,
  /** Rule の ICD の既定（装備トリガーの TRIGGER.icd と同じ） */
  defaultIcd: 0.4,
  /** 条件 lowHp: 最大 HP に対するこの割合以下 */
  lowHpRatio: 0.5,
  /** state.chains に残す件数 */
  chainLog: 8,
  /** 1 ステップに積めるイベントの上限（バーストで大量に倒したときの暴走止め） */
  maxEventsPerStep: 256,
  /** 次ステップへ持ち越せるイベントの上限 */
  maxPendingEvents: 64,
} as const;

/** キーストーンの数値 */
export const KEYSTONE = {
  blinkRadius: 40,
  blinkDamage: 20,
  blinkColor: "#c080ff",
  gamblerMin: 0.2,
  gamblerMax: 3,
  berserkerHealMul: 0.5,
  /** ks_vampire（吸血）: 与ダメージのうち回復する割合（%）。HEAL.sustainCapRatio の上限は受ける */
  vampireLeechPct: 5,
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
  /** 50 → 30（memo 2026-09-24: 回復系の数値を 30〜50% 下げる） */
  backwaterClearHealPct: 30,
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
  // ---- 2026-09 第 2 弾: 属性 / 武器 / 地形の排他グループ ----
  /** ks_oneElement（一色の誓い）: 近接・射撃の与ダメージの上乗せと、全属性耐性の減少（%） */
  oneElementDamageBonus: 0.2,
  oneElementResistLoss: 15,
  /** ks_weakOath（弱点の誓い）: 弱点を突いた命中 / 突かなかった命中の倍率 */
  weakOathWeakMul: 1.4,
  weakOathOtherMul: 0.8,
  /** ks_nullOath（無の誓い）: 近接・射撃の与ダメージの上乗せと、状態異常の効果量の倍率 */
  nullOathDamageBonus: 0.1,
  nullOathPotencyMul: 0.75,
  /** ks_ironOath（鉄の誓い）: 得意武器の近接の与ダメージ・怯み値の倍率 / 得意でない武器の近接の与ダメージ倍率 */
  ironFavoredMul: 1.3,
  ironFavoredPoiseMul: 1.2,
  ironUnfavoredMul: 0.7,
  /** ks_chargeOath（溜めの誓い）: 溜めの段 1 つにつきの近接の上乗せ / 溜めを持つ武器で溜めずに振った近接の倍率 */
  chargeOathPerLevel: 0.25,
  chargeOathUnchargedMul: 0.75,
  /** ks_stanceOath（構えの誓い）: 攻撃の振り（予備動作〜攻撃判定）の間 / それ以外の被ダメージ倍率 */
  stanceGuardMul: 0.6,
  stanceExposedMul: 1.2,
  /** ks_earthOath（土の誓い）: 地形の上に立つ間の毎秒の回復 */
  earthRegenPerSec: 2,
  /** ks_slickOath（滑りの誓い）: 水たまり・氷床の上 / それ以外の与ダメージ倍率 */
  slickOnMul: 1.35,
  slickOffMul: 0.9,
  /** ks_emberOath（熾火の誓い）: 燃えている敵か燃える地形の上の敵 / それ以外への与ダメージ倍率、炎耐性の減少、置く炎の秒 */
  emberOnMul: 1.3,
  emberOffMul: 0.85,
  emberFireResistLoss: 25,
  emberKillFireSec: 4,
} as const;

/**
 * 共鳴の拡張（docs/ideas/loot-expansion.md 9-2〜9-4。src/loot/resonance.ts）。
 * 陰画・拮抗は共鳴の変形、星座は 6 部位の主色の並びで成立する別の層
 */
export const RESONANCE = {
  /** 陰画: 反転した性質の重みが全体のこの割合以上で、反転していない性質の中に支配色があれば成立 */
  negativeInvertedRatio: 0.35,
  /** 拮抗: 反対色の組がそれぞれこの割合以上で、差がこの割合以内 */
  balanceMinRatio: 0.25,
  balanceMaxGap: 0.05,
  /** 天秤（紅と蒼の拮抗）: 近接と射撃を交互に当てるたびの与ダメージと上限 */
  balanceStep: 0.08,
  balanceCap: 0.32,
  /** 表裏（翠と金の拮抗）: 生命が半分以上の与ダメージ / 半分未満の被ダメージの減少 */
  twoFacesDamage: 0.1,
  twoFacesGuard: 0.15,
  /** 冷たい炎（紅の陰画）: 燃焼の確率を冷気へ移す割合と、近接の上乗せを射撃へ移す量 */
  coldFlameShift: 0.1,
  /** 熱い氷（蒼の陰画）: 射撃で周囲を燃やす確率・dps・秒 */
  hotIceChance: 0.25,
  hotIceDps: 5,
  hotIceSec: 3,
  /** 枯れ森（翠の陰画）: 回復の倍率と、被弾時の衝撃波のダメージ */
  witheredHealMul: 0.5,
  witheredWave: 14,
  /** 暗雷（金の陰画）: 感電の確率の上乗せと、近接で呼ぶ連鎖雷の確率・ダメージ */
  darkThunderShock: 0.1,
  darkThunderChance: 0.35,
  darkThunderDamage: 12,
  // ---- 星座 ----
  /** 双子: 近接と射撃の上乗せのうち、もう片方にも効く割合と、代償の攻撃速度・連射の減少 */
  twinsShare: 0.25,
  twinsTempoLoss: 0.05,
  /** 対岸: 持ち替えた命中の怯み値 / 同じ手段が続いた命中の減少 */
  shoresPoise: 0.4,
  shoresRepeat: 0.15,
  /** 背骨: 被ダメージの減少と、代償の移動速度の減少 */
  spineGuard: 0.1,
  spineSlow: 0.06,
  /** 環: 全ステータスの上乗せと、代償の最大気力の減少 */
  ringAttr: 2,
  ringManaLoss: 10,
  /** 鏡像: トリガーの内部クールダウンを縮める割合と、代償の最大生命の減少 */
  mirrorIcdCut: 0.25,
  mirrorHpLoss: 15,
  /** 虚空: 主色が冥の遺物の数と、代償の被ダメージの増加 */
  voidMinUmbra: 3,
  voidExposure: 0.08,
  /** 鎖: 持ち替えて当てるたびの気力と、代償の気力回収の減少 */
  chainMana: 2,
  chainGainLoss: 0.1,
} as const;

/** 装備ドロップ */
export const LOOT_DROP = {
  depthChanceBonus: 0.005,
  /**
   * 通常敵のドロップ確率に掛ける倍率。添字 0 = 深度 1、表より深ければ最後の値。
   * エリート・ボス・巣窟の主（dropChance 1）には掛けない（memo 2026-09-24: 「たくさん倒しても出ない、強敵を倒すと出る」）
   */
  /** [0.1..0.2] → [0.18..0.35]（QA 0.0.8α: 拾得数が 0.0.7α 比 31〜46% と目標 60〜70% より絞りすぎ） */
  mobDropMulByDepth: [0.18, 0.22, 0.27, 0.35],
  /**
   * 徘徊・増援（roomIndex = ROAMING_ROOM。開放型フロアの時間湧き）の通常敵に、さらに掛ける倍率。
   * 増援は時間とともに湧き続けるので、倒した数でドロップの母数が膨らまないよう絞る（エリートは掛けない）
   */
  roamingDropMul: 0.5,
  /**
   * エリートのドロップ確率に掛ける倍率（elites.ts の追加抽選も enemyDropChance を通るので両方に効く）。
   * エリートは深度 1 でも約 1 割が混ざり、撃破起因のドロップの大半を占めていた（QA 0.0.7α）。
   * 通常敵よりは十分高いまま（×0.1〜0.2 に対して ×0.35）残す。ボス・巣窟の主（確定）には掛けない
   */
  eliteDropMul: 0.35,
  /**
   * 部屋制圧の報酬が出る確率（添字 0 = 深度 1、表より深ければ最後の値。旧: 常に 1 個）。
   * 開放型フロアは塊が多く制圧の回数が増えたので [0.35, 0.45, 0.55, 0.7] から下げた（QA 0.0.7α: 拾得数が前回比 1.5〜2.6 倍）
   */
  roomClearChanceByDepth: [0.2, 0.25, 0.3, 0.4],
  /** 階層到達の報酬が出る確率（旧: 常に 1 個。同上の理由で絞る） */
  depthArrivalChance: 0.6,
  /** itemLevel = depth + rng(0..spread) */
  itemLevelSpread: 2,
  rarityBoostPerDepth: 0.02,
  roomClearRarityBoost: 0.3,
  depthArrivalRarityBoost: 0.15,
  /** 撃破位置から弾ける距離（px） */
  scatter: 10,
  /** 階層到達時にプレイヤーから離して置く距離 */
  arrivalOffset: 18,
} as const;

/**
 * 床の遺物・スキル石をカーソルで注目してインタラクトで拾う（memo 2026-09-24）。
 * ハート・刻印符など消耗品系は従来どおり触れて拾う
 */
export const PICKUP = {
  /** 照準（カーソル / 照準スティックの先）からこの半径以内のドロップ品を注目する（px） */
  focusRadius: 14,
  /** プレイヤーからこの距離以内の注目品だけ拾える（px）。遠いものは近づく必要がある */
  reach: 48,
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
  /** 0.5 → 0.2、回復量 25 → 18（memo 2026-09-24: 部屋突破のハートが死ななさの主因） */
  heartDropChance: 0.2,
  heartHeal: 18,
  clearBonus: 50,
} as const;

/** 追加敵の行動パラメータ */
export const ENEMY_AI = {
  /**
   * 同時に攻撃の出だし（strike）に入れる敵の数。超えた敵は予備動作のまま strikerHoldTime ずつ待つ（予告は出たまま）。
   * QA 0.0.7α: 1 対 1 被弾 9.74 回/60 秒。囲まれたときに予告の重なりで避けられない瞬間を作らない（テレグラフ原則）
   */
  maxSimultaneousStrikers: 2,
  strikerHoldTime: 0.1,
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
    /** 倒されたとき持っていた爆弾が爆ぜるまでの秒（予告の影を見てから避けられる長さ） */
    deathFuse: 0.5,
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
  // ---- 以下 Wave 3（docs/ideas/enemies.md。地形を作る敵を優先。敵の地形は敵にも効く） ----
  /** 敵が作る地形: 予告の影を出してから置くまでの秒（テレグラフ原則）。持続は地形ごとの TERRAIN.placedDuration */
  terrainSeed: { delay: 0.6 },
  /** 敵の爆発が敵にも当たるときの威力の倍率 */
  friendlyBlastMul: 1,
  /** H8: プレイヤーが沈黙している間の通常攻撃のマナ回収の倍率（撃てない時間を溜める時間にする） */
  silencedAttackManaMul: 1.5,
  /** 山なりに吐く（毒吐き蛙・霜蛙・熔岩蛙）: 保つ距離 */
  lobber: { keepAway: 90 },
  /** 油壺運び: 油を撒く間隔と半径 */
  oiler: { dropInterval: 1.4, dropRadius: 14 },
  /** 呼び鈴小鬼: 鐘の届く半径・急かしの秒・急かし中の攻撃間隔の進みの倍率・保つ距離 */
  bellImp: { radius: 100, rallyTime: 6, hasteMul: 2, keepAway: 100, color: "#f8d848" },
  /** 旗持ち: 旗の加護の半径・被ダメージ倍率・加護の持続（毎ステップ掛け直す）・保つ距離 */
  banner: { radius: 80, takenMul: 0.7, rallyTime: 0.3, keepAway: 90, color: "#f8d848" },
  /** 帯電の鼓舞（雷鬼火が倒れると周りの敵が帯電）: 半径・秒・帯電した敵が倒れたときの連鎖雷の威力 */
  charged: { radius: 60, time: 5, deathChainDamage: 8, contactShock: 2, color: "#fff4a0" },
  /** 土潜り: 潜って動く速さの倍率・飛び出しの半径と威力・飛び出した後に晒す秒・土煙の間隔 */
  burrower: { burrowSpeedMul: 1.4, emergeRadius: 20, damage: 14, exposeTime: 1.4, dustInterval: 0.15, color: "#8a6a40" },
  /** 天井吊り: 気付く距離・落下の半径と威力 */
  dropper: { noticeRange: 70, radius: 22, damage: 14, color: "#5a4a40" },
  /** 吸い込み蟲: 吸い込む半径・溜められる弾の上限・吐き返す扇の広がりと速さと威力 */
  absorber: { radius: 44, maxShots: 8, spreadDeg: 70, bulletSpeed: 120, bulletDamage: 8, color: "#c0a0ff" },
  /** ホムンクルス: 炸裂の数・広がり・半径・威力・吸えないときの既定の弱体の秒・保つ距離 */
  homunculus: { blasts: 3, spread: 36, radius: 18, damage: 10, fallbackDuration: 2.5, keepAway: 100, color: "#e080c0" },
  /** 写本の小悪魔: 写しの技（元の技の弱い版）の数値と保つ距離 */
  scribeImp: {
    keepAway: 120,
    bulletCount: 5,
    spreadDeg: 50,
    bulletSpeed: 115,
    bulletDamage: 7,
    ringRadius: 50,
    ringDamage: 12,
    blastCount: 3,
    blastSpread: 40,
    blastRadius: 20,
    blastDamage: 10,
    color: "#e0d8c0",
  },
  /** 十字ゴーレム: 十字の線の長さと威力 */
  crossGolem: { length: 110, damage: 20 },
  /** 風吹き: 扇の届く距離と広さ・押す強さ（加速度）と上限・弾を押す強さ・保つ距離 */
  windSprite: { range: 120, arcDeg: 50, push: 520, maxPush: 170, bulletPush: 260, keepAway: 90, color: "#d0f0ff" },
  /** 地雷撒き: 撒く間隔・同時に置ける数・保つ距離 */
  mineLayer: { dropInterval: 2, max: 4, keepAway: 110 },
  /** 敵の地雷: 踏んだと見なす距離・爆発の半径と威力 */
  mine: { trigger: 16, radius: 30, damage: 16, color: "#ff6060" },
  /** 鎖の番人: 鎖の長さ・当たったときの引き寄せ・叩きつけの予備動作と半径と威力 */
  chainWarden: { length: 140, pull: 380, pullDamage: 6, slamWindup: 0.5, slamRadius: 40, slamDamage: 18, color: "#a0a0b0" },
  /** 虚ろ: 照準がこの角度以内に入ると固まる */
  hollow: { freezeArcDeg: 50, color: "#9090a0" },
  /** 火喰い: 火を探す半径・食べる距離・食べて戻る HP の割合・1 段の伸び・段の上限 */
  flameEater: { seekRadius: 160, eatRadius: 12, eatCooldown: 0.6, heal: 0.15, radiusPerGrowth: 1, maxGrowth: 3, color: "#ff9040" },
  /** 苔ゴーレム: 被弾で胞子（小さな毒沼）を出す間隔と半径 */
  spore: { cooldown: 1.2, radius: 10 },
  /** 沼鬼火: 水たまり・毒沼の上での速さの倍率 */
  swampWisp: { speedMul: 2 },
  /** 氷猪: 突進の跡に氷床を置く半径 */
  iceTrail: { radius: 8 },
  /** 部屋主: 大蝦蟇（舌で引き寄せて噛む。周りに水たまり） */
  giantToad: { tongueLength: 130, pull: 420, biteRadius: 30, biteDamage: 22, pondRadius: 40, color: "#58d058" },
  /** 部屋主: 炎の鍛冶（金床を叩くと燃える刃。金床を壊すと怯んで怒る） */
  forgeMaster: { keepAway: 100, bladeCount: 3, spreadDeg: 40, bladeSpeed: 130, bladeDamage: 12, fireRadius: 30, enrageMul: 0.6, anvilBreakStagger: 2, color: "#ff8030" },
  /** 部屋主: 砲台長（四隅の砲台。砲台が壊れるたびに怯む） */
  turretMaster: { turrets: 4, turretBreakStagger: 1, orbSpeed: 90, orbDamage: 10, color: "#c0c0c0" },
  /** 砲台の弾 */
  turret: { bulletSpeed: 150, bulletDamage: 8 },
  /** 部屋主: 石化の蜥蜴（睨んだ扇の中で止まっていると冷気が溜まる） */
  basilisk: { range: 130, arcDeg: 60, stillSpeed: 12, chillEvery: 0.3, biteTime: 0.35, color: "#a0e0a0" },
  /** 部屋主: 影踏み（影に潜って背後から出る） */
  shadowStalker: { behind: 26, radius: 26, damage: 20, exposeTime: 0.8, color: "#5a4a8a" },
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
  // ---- 以下 Wave 3 の修飾子（docs/ideas/enemies.md 4 章 M5 / M6 / M7 / M10 / M18） ----
  /** 灼熱の: 通った跡に炎を置く間隔・半径・炎の持続 */
  searingInterval: 0.25,
  searingRadius: 6,
  searingDuration: 1.5,
  /** 封魔の: 輪の半径（中ではマナの自然回復が止まる） */
  hexRadius: 70,
  /** 号令の: 号令が届く半径と、号令に応じる敵の攻撃間隔の残りの上限 */
  commandRadius: 110,
  commandCooldownMax: 1.2,
  /** 見切りの: 跳ぶ距離と間隔 */
  evadeDist: 40,
  evadeCooldown: 4,
  /** 鎖縛の: 結ぶ数・結ぶ半径・鎖に触れたときの冷気の秒・触れ直しの間隔・鎖の太さ */
  chainCount: 2,
  chainRadius: 100,
  chainChillTime: 2,
  chainTouchIcd: 1,
  chainWidth: 3,
  /** 相乗の組（2 つ重ねる）: この深度から、エリートになった敵のうちこの割合 */
  pairMinDepth: 8,
  pairChance: 0.25,
  /** 炎の柱（灼熱の + 不動の）: 足元に炎の輪を置く間隔と半径 */
  pyreInterval: 2.5,
  pyreRadius: 22,
  /** 封魔の + 障壁の: 障壁がある間は輪の中でマナが減っていく（毎秒） */
  hexDrain: 6,
  /** 見切りの + 迅速の: 跳ぶ距離と間隔の倍率 */
  evadeHasteDistMul: 1.6,
  evadeHasteCooldownMul: 0.5,
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
    /** 22 → 17: QA 0.0.7α で死因単独 2 位（18 件）。被ダメの 7 割が着地の衝撃波で、
     * 深度 3 で他ボスの約 2 倍の速さでプレイヤーを倒していたため（頻度・範囲は変えず 1 回の重さを下げる） */
    shockDamage: 17,
    phase2Ratio: 0.5,
    /** 4 → 3: 第 2 段階の囲まれ方を和らげる（分裂の意味は残す） */
    splitCount: 3,
    phase2SpeedMul: 1.6,
    /** 着地までの空中時間の最小（フェーズ 2）。0.65 → 0.8: 影を見てから走って抜けられる長さにする（テレグラフ原則） */
    phase2JumpTime: 0.8,
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
    /** 骨の壁の耐久（H6: 爆発・壁叩きつけ・弾で壊せる。叩きつけは一撃で崩す） */
    wallHp: 30,
    /** グレネードなど爆発する技が骨の壁を削る半径 */
    wallBlastRadius: 30,
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
  // ---- Wave 3 のボス（docs/ideas/enemies.md 3 章。各 src/system/boss<Name>.ts） ----
  /** 油壺の王: 油壺を投げ、突進し、火を点ける。燃える床に立つと引火して怯む（部屋のギミック） */
  oilKing: {
    jarCount: 3,
    jarSpread: 50,
    jarRadius: 24,
    jarBlast: 18,
    jarDamage: 10,
    jarFall: 1.0,
    chargeSpeedMul: 5.5,
    chargeTime: 0.7,
    wallStagger: 1.2,
    fireBombRadius: 34,
    fireBombDamage: 16,
    trailInterval: 0.2,
    trailRadius: 10,
    slamRadius: 70,
    slamDamage: 20,
    igniteStagger: 2,
    igniteCooldown: 8,
    phase2Ratio: 0.6,
    phase3Ratio: 0.3,
    color: "#c09050",
  },
  /** 群れの母: 卵を産み、跳び、壁から群れを呼ぶ。卵を割ると母に怯み値が入る */
  broodMother: {
    eggCount: 3,
    eggHatch: 4,
    eggSpread: 70,
    layTime: 1.2,
    biteSpeedMul: 5,
    biteTime: 0.45,
    jumpTime: 0.9,
    landRadius: 50,
    landDamage: 18,
    acidRadius: 24,
    swarmInterval: 6,
    swarmCount: 3,
    eggBreakPoise: 60,
    phase2Ratio: 0.6,
    phase3Ratio: 0.25,
    color: "#a0c040",
  },
  /** 図書館の司書: 本棚で部屋を区切り、禁書を読み、本棚を倒す。禁書を読む間に沈黙・怯みで止めるとダウン */
  librarian: {
    keepAway: 110,
    shelfLength: 5,
    shelfFall: 0.8,
    pageCount: 7,
    pageSpread: 90,
    pageSpeed: 110,
    pageDamage: 8,
    readTime: 1.2,
    readDropStagger: 2.5,
    thunderCount: 4,
    thunderSpread: 60,
    thunderRadius: 20,
    thunderDamage: 14,
    pullRadius: 110,
    pullForce: 320,
    pullRingDamage: 12,
    toppleLength: 7,
    toppleSpacing: 16,
    toppleRadius: 14,
    toppleDamage: 18,
    toppleFall: 1.0,
    phase2Ratio: 0.65,
    phase3Ratio: 0.3,
    color: "#c0a0ff",
  },
  /** 鏡の騎士: 正面の弾を返し、第 2 段階からプレイヤーの装備の状態異常を写し、第 3 段階で写し身を呼ぶ */
  mirrorKnight: {
    lungeSpeedMul: 6,
    lungeTime: 0.45,
    wallStagger: 1.5,
    waveCount: 3,
    waveSpread: 30,
    waveSpeed: 140,
    waveDamage: 10,
    reflectDamage: 10,
    procDuration: 3,
    procMax: 2,
    images: 2,
    imageHpRatio: 0.08,
    /** 写し身が残っている間に本体が受けるダメージの倍率 */
    imageGuardMul: 0.5,
    phase2Ratio: 0.6,
    phase3Ratio: 0.3,
    color: "#c0e0ff",
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
  /** バリアント（docs/ideas/enemies.md 6 章。src/system/reaper.ts の chooseReaperVariant） */
  variants: {
    /** 鎖の死神: 足は遅いが、interval 秒ごとに charge 秒の予告線を出して鎖を投げ、当たると引き寄せる */
    chain: { minDepth: 7, speedMul: 0.8, interval: 6, charge: 1, length: 170, width: 6, pull: 360, damage: 10, color: "#a080e0" },
    /** 取り立て屋（呪い付きの祝福を持つとき）: 速い。輪の中に offerTime 秒留まると HP の tollRatio を取って去る */
    collector: { speedMul: 1.3, offerRadius: 40, offerTime: 1.5, tollRatio: 0.3, color: "#e0c048" },
    /** 双子の死神: 2 体に分かれ、それぞれ遅い */
    twin: { minDepth: 12, speedMul: 0.75, spread: 140 },
    /** 影の死神（暗闇）: 本体は出ず、倒せる影が群れで追う。respawn 秒ごとに数を戻す */
    shadow: { shades: 5, respawn: 8, ring: 120 },
    /** 静かな死神（死神の友）: 予告なく、プレイヤーが動いている間だけ近づく */
    silent: { moveThreshold: 8 },
  },
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
  /** 泉が出得る深度。1 ランに最大でこの数まで（memo 2026-09-24: 全回復を 1〜2 回に絞る） */
  shrineDepths: [3, 6] as readonly number[],
  /** 0.3 → 0.6（出る深度を絞った分、その深度では出やすくして平均 1 回強にする） */
  shrineChance: 0.6,
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
  // ---- ラン構造の拡張（src/system/specialRooms.ts。docs/ideas/run-expansion.md 2 章）----
  /** 追加の部屋種類は 1 フロアにこの数まで（多すぎると戦闘部屋が消える） */
  extraMax: 3,
  /** 追加の部屋種類ごとの出る確率と出始める深度（抽選はこの並び順） */
  extra: {
    altar: { chance: 0.18, minDepth: 3 },
    library: { chance: 0.22, minDepth: 2 },
    arena: { chance: 0.15, minDepth: 4 },
    gamble: { chance: 0.2, minDepth: 2 },
    forge: { chance: 0.15, minDepth: 2 },
    exchange: { chance: 0.15, minDepth: 2 },
    curseShrine: { chance: 0.15, minDepth: 3 },
    resonance: { chance: 0.2, minDepth: 2 },
    escort: { chance: 0.15, minDepth: 3 },
    escape: { chance: 0.12, minDepth: 3 },
    reaperNest: { chance: 0.1, minDepth: 4 },
    nest: { chance: 0.15, minDepth: 4 },
    mirror: { chance: 0.08, minDepth: 5 },
    watchtower: { chance: 0.15, minDepth: 2 },
    // ---- 第 2 弾（docs/ideas/run-expansion.md 2 章の残り）----
    vault: { chance: 0.12, minDepth: 3 },
    elementAltar: { chance: 0.15, minDepth: 2 },
    dummyHall: { chance: 0.1, minDepth: 2 },
    fogRoom: { chance: 0.12, minDepth: 2 },
    tideRoom: { chance: 0.12, minDepth: 3 },
    invertHall: { chance: 0.08, minDepth: 4 },
  },
  /** 台座に触れたと判定する半径（px）と、台座どうしの間隔（タイル） */
  propRadius: 9,
  propSpacing: 3,
  /** 台座の上に出す名前を読める距離（px） */
  propLabelRange: 56,
  altarColor: "#d08cff",
  libraryColor: "#80c0ff",
  /** 闘技場: 波の数・波ごとの湧き倍率・報酬の rarityBoost */
  arenaWaves: 4,
  arenaWaveMul: 0.8,
  arenaColor: "#ff6040",
  /** 賭博: 1 回に払う最大 HP の割合・回せる回数・当たりの重み */
  gambleHpCost: 0.1,
  gambleUses: 3,
  gambleColor: "#ffd040",
  gambleWeights: { item: 35, hearts: 20, rune: 15, ambush: 15, curse: 15 },
  gambleRarityBoost: 2,
  gambleHearts: 2,
  /** 鍛冶場: 得る残響の数と、炉の熱で付く燃焼 */
  forgeEchoes: 3,
  forgeBurnDuration: 3,
  forgeBurnDps: 2,
  forgeColor: "#ff9040",
  /** 交換所: 置いてある遺物の数と、残響への換算倍率 */
  exchangeItems: 2,
  exchangeMul: 1.5,
  exchangeColor: "#60e0c0",
  curseShrineColor: "#a040ff",
  /** 共鳴炉: 色が合ったときの追加の部屋報酬の回数 */
  resonanceBonusDrops: 2,
  /** 護衛: 対象の HP（プレイヤーの最大 HP に対する倍率）・敵がこの距離にいると削れる・1 体あたりの毎秒ダメージ */
  escortHpMul: 1.5,
  escortRadius: 36,
  escortDps: 3,
  escortColor: "#80ff80",
  /** 逃走: 床が崩れる（溶岩になる）広がる速さ（px/秒）・溶岩の残る秒・宝箱の報酬 */
  escapeSpeed: 22,
  escapeLavaTime: 6,
  escapeTickInterval: 0.5,
  escapeColor: "#ff6030",
  /** 死神の巣: 箱の遺物の深度の上乗せ */
  reaperNestDepthBonus: 3,
  /** 巣: 部屋主の HP 倍率と、付けるエリート修飾子の数 */
  nestHpMul: 2.5,
  nestElites: 2,
  nestColor: "#e06040",
  /** 鏡: 写しの HP（プレイヤーの最大 HP に対する倍率）・祝福いくつでエリート修飾子 1 つか・上限 */
  mirrorHpMul: 4,
  mirrorBoonsPerElite: 3,
  mirrorEliteMax: 2,
  mirrorColor: "#c0e0ff",
  /** 見張り台: 鐘を鳴らすと死神の猶予が縮む秒 */
  watchtowerReaperCost: 20,
  watchtowerColor: "#e0e0a0",
  // ---- 第 2 弾の部屋（src/system/specialRooms.ts）----
  /** 封印庫: 解錠に払う欠片と、中の遺物の数 */
  vaultCost: 5,
  vaultDrops: 2,
  vaultColor: "#b0f0ff",
  /** 属性の祭壇: 並べる属性の数と、この階の間だけ通常攻撃に乗る属性の割合 */
  elementAltarChoices: 3,
  elementAltarShare: 0.5,
  elementAltarColor: "#ffe890",
  /** 試し場: 木人の数と、木人を並べる間隔（タイル） */
  dummyCount: 3,
  dummySpacing: 2.5,
  dummyColor: "#c8a070",
  /** 霧の部屋: 中にいる間だけ見える半径（px）と、制圧の上乗せの欠片 */
  fogRoomRadius: 72,
  fogRoomColor: "#c8ccd8",
  /** 潮の間: 封鎖すると部屋の中心から水が広がる。広がる速さ（px/秒）・置き直す間隔（秒）・水が残る秒 */
  tideRoomSpeed: 14,
  tideRoomInterval: 0.8,
  tideRoomWaterTime: 30,
  tideRoomColor: "#60a0ff",
  /** 反転の間: 置いてある遺物の数と、1 つの性質が反転するまで煽り直す上限回数 */
  invertHallItems: 2,
  invertHallAttempts: 24,
  invertHallColor: "#a060e0",
  // ---- 巣窟（モンスターハウス。開放型フロアでたまに出る、入ると封鎖される部屋）----
  /** 巣窟が出始める深度・2 つ目が出始める深度・1 つあたりの出る確率 */
  hordeMinDepth: 2,
  hordeSecondDepth: 5,
  hordeChance: 0.6,
  /** 巣窟にする塊の最小タイル数（狭い塊に大量に湧くと避けようがない） */
  hordeMinTiles: 60,
  /** 波の数と、波ごとの湧き数（通常の敵数に対する倍率） */
  hordeWaves: 3,
  hordeWaveMul: 1.2,
  hordeColor: "#ff5070",
  /**
   * 入ると封鎖する種類（開放型フロア。それ以外は入っても封鎖せず、塊の敵を全滅させたら制圧）。
   * 護衛・鏡は封鎖の瞬間に湧く仕組みなので封鎖のまま。ボス部屋は種類に関係なく封鎖する
   */
  locks: {
    normal: false,
    treasure: false,
    challenge: true,
    shrine: false,
    ambush: true,
    altar: false,
    library: false,
    arena: true,
    gamble: false,
    forge: false,
    exchange: false,
    curseShrine: false,
    resonance: false,
    escort: true,
    escape: false,
    reaperNest: false,
    nest: true,
    mirror: true,
    watchtower: false,
    horde: true,
    vault: false,
    elementAltar: false,
    dummyHall: false,
    fogRoom: false,
    tideRoom: true,
    invertHall: false,
  },
} as const;

/** フロア種別（src/system/roomTypes.ts の chooseFloorKind） */
export const FLOOR_KIND = {
  /** 暗闇でプレイヤー周りだけ明るい半径（px） */
  darkLightRadius: 90,
  /** 光の縁のぼかし幅（半径に対する割合） */
  darkFeather: 0.35,
  darkAlpha: 0.94,
  // ---- バイオームと分岐路（src/system/biomes.ts）----
  /** フロア種別の抽選の重み（出始める深度は biomeMinDepth） */
  /** 2026-09-24 の開放型フロアで洞窟を基本にした（memo/20260924-1.md）。1 階は洞窟だけ、回廊（部屋 + 通路）は 2 階から少なめに出る */
  weight: { rooms: 1, cave: 3, dark: 1, forge: 1, ossuary: 1, swamp: 1, glacier: 1, mine: 1, meadow: 1 },
  biomeMinDepth: { rooms: 2, cave: 1, dark: 4, forge: 4, ossuary: 3, swamp: 2, glacier: 3, mine: 2, meadow: 2 },
  /** バイオームの地形: 部屋 1 つあたりの塊の数と半径（px） */
  patchesPerRoom: 2,
  patchRadiusMin: 20,
  patchRadiusMax: 40,
  /** 溶岩は踏むと痛いので小さく */
  lavaRadiusMul: 0.6,
  /** 出やすい敵ファミリーの重み倍率 */
  familyMul: 3,
  /** 骨の墓所: 部屋ごとに最初から転がっている死骸の数と、死骸が残る秒 */
  ossuaryCorpses: 3,
  ossuaryCorpseTime: 600,
  /** 床に重ねる色調の不透明度 */
  tintAlpha: 0.16,
  /** 分岐路: 最後の部屋に置く階段の数と、中心からの距離（タイル） */
  forkMin: 2,
  forkMax: 3,
  forkOffset: 4,
  // ---- 階層構造（docs/ideas/run-expansion.md 4 章 #4〜#6）----
  /** 反転層: この深度から。バイオームの重みが逆順になり、敵はエリート抽選を 1 回多く引き、落ちた遺物は反転の抽選をもう 1 回受ける */
  invertedDepth: 20,
  invertedColor: "#a060e0",
  /** 無限の深み: この深度からは敵の HP の伸びを deepHpSlope まで寝かせ、部屋の敵数の上限を deepMaxEnemiesBonus だけ外す */
  deepDepth: 30,
  deepHpSlope: 0.05,
  deepMaxEnemiesBonus: 4,
  /** 無限の深み: mutationEvery 階ごとに「変異」（階のランイベントの常時化）を 1 つ積む */
  mutationEvery: 10,
  /** 上り階段（戻る）: 出始める深度・1 ランで戻れる回数・触れ続ける秒 */
  ascendMinDepth: 3,
  ascendMaxReturns: 2,
  ascendHold: 1.2,
  /** 戻った階は死神の猶予をこの秒だけ進めて始まり、敵は半分 */
  revisitReaperHeadStart: 40,
  ascendColor: "#90e0ff",
} as const;

/**
 * 洞窟の生成（src/map/cave.ts）。base が既定、biome がフロア種別ごとの上書き（無い種別は base のまま）。
 * 塊の数 = minRooms〜maxRooms、塊の大きさ = openDist / minRoomTiles / roomGrow、通路の太さ = widen（細い所を削る回数）。
 * fillChance が低いほど開けて、高いほど細い道が増える
 */
export const CAVE = {
  base: {
    fillChance: 0.45,
    smoothSteps: 5,
    wallBirth: 5,
    wallSurvive: 4,
    openDist: 3,
    minRoomTiles: 12,
    roomGrow: 3,
    maxRooms: 9,
    minRooms: 3,
    widen: 0,
  },
  biome: {
    /** 沼: 小さな溜まりが多い */
    swamp: { fillChance: 0.44, minRoomTiles: 10, maxRooms: 11 },
    /** 氷窟: 大きな空洞が少なく、道は太い */
    glacier: { fillChance: 0.43, openDist: 4, minRoomTiles: 16, roomGrow: 4, maxRooms: 7, widen: 1 },
    /** 草原: 開けていて走り回れる（fillChance を下げすぎると塊が 1 つに繋がり部屋が足りなくなるので openDist で分ける） */
    meadow: { fillChance: 0.42, openDist: 4, maxRooms: 8 },
    /** 熔鉱炉: 細い道が入り組む */
    forge: { fillChance: 0.47, minRoomTiles: 10, maxRooms: 10 },
    /** 暗闇: 視界が狭いので空洞は小さめで数が多い */
    dark: { fillChance: 0.46, maxRooms: 10 },
  },
} as const;

/** 開放型フロアの徘徊と増援（src/system/spawner.ts）。塊に置いた敵の一部が塊の間を歩き回り、時間で少しずつ増える */
export const ROAM = {
  /** 塊に置いた敵のうち徘徊にする割合（開始の塊・封鎖する部屋・ボス部屋の敵は除く） */
  fraction: 0.25,
  /** 徘徊の歩く速さ（def.speed に対する倍率） */
  speedMul: 0.4,
  /** 目的地に着いたとみなす距離（px） */
  reach: 12,
  /** この秒だけ目的地へ進めなければ目的地を選び直す */
  stuckTime: 2.5,
  /** 最初の増援までの秒と、以後の間隔（秒） */
  reinforceDelay: 30,
  reinforceInterval: 18,
  /** 徘徊の数の上限 = capBase + floor(depth * capPerDepth)、最大 capMax。これ以上は増援しない */
  capBase: 3,
  capPerDepth: 0.5,
  capMax: 8,
  /** 増援はプレイヤーの画面の外（この距離より遠い所）に出す。画面の半幅 240 より少し大きい（px） */
  minSpawnDist: 260,
  /** 増援の位置を探す回数 */
  spawnAttempts: 24,
  /** 増援はカメラの表示範囲（480x270）からさらにこの px 外に出す（画面の角に湧かせない） */
  offscreenMargin: 24,
  /** 開放型: 部屋の外でも、その部屋の気付いた敵がこの距離（px）以内にいれば交戦中（system/engagement.ts） */
  engageLeash: 160,
} as const;

/** ランイベント（src/system/runEvents.ts。docs/ideas/run-expansion.md 3 章）。すべて予告してから始まる */
export const RUN_EVENT = {
  /** この深度からイベントが起きる */
  minDepth: 2,
  /** 予告（HUD の 1 行 + 効果音）から始まるまでの秒 */
  warnTime: 1.8,
  /** 1 つ終わってから次が起きるまでの最短秒 */
  cooldown: 20,
  /** 封鎖時に起きる確率 */
  lockChance: {
    reinforce: 0.1,
    blackout: 0.06,
    meteor: 0.05,
    manaDrought: 0.06,
    shrink: 0.04,
    timeRift: 0.05,
    // ---- 第 2 弾（条件を満たさない種類は抽選しない）----
    curseVoice: 0.08,
    duel: 0.06,
    sluggish: 0.04,
    flood: 0.04,
    silence: 0.04,
    reactionSurge: 0.04,
    thunderstorm: 0.04,
  },
  /** 階に入ったときに起きる確率（霧は沼・草原・氷窟では fogBiomeChance） */
  floorChance: { bounty: 0.12, bloodMoon: 0.05, frenzyMoon: 0.05, fog: 0.03, elementStorm: 0.05 },
  fogBiomeChance: 0.2,
  /** 時間で起きる: この秒を過ぎてから checkInterval ごとに抽選 */
  timedAfter: 40,
  checkInterval: 10,
  timedChance: { quake: 0.08, curseWind: 0.06, reaperPass: 0.08, echoVein: 0.06, bats: 0.05, lifeFlow: 0.04 },
  /** 制圧時に起きる確率 */
  clearChance: { treasureRain: 0.04, momentum: 0.12, boonReroll: 0.03 },
  /** 増援: 湧かせる抽選回数（通常部屋の敵数に対する倍率）と、この秒以内に倒すと報酬 */
  reinforceMul: 0.6,
  reinforceBonusTime: 8,
  /** 賞金首: 撃破のスコア */
  bountyScore: 300,
  /** 停電: 長くてもこの秒で明かりが戻る */
  blackoutMax: 25,
  /** 地震・流星群: 続く秒・落下の間隔・予告の秒・半径・ダメージ・プレイヤーからのばらつき（px） */
  quake: { duration: 6, interval: 0.45, telegraph: 0.9, radius: 14, damage: 8, spread: 90 },
  meteor: { duration: 8, interval: 0.7, telegraph: 1.2, radius: 22, damage: 12, spread: 110 },
  /** 落下物が敵に与えるダメージの倍率（地形を武器にする） */
  impactEnemyMul: 2.5,
  /** 宝の雨: 降る遺物とハートの数・散らばる距離（px） */
  rainItems: 3,
  rainHearts: 2,
  rainSpread: 40,
  rainRarityBoost: 0.8,
  /** マナ枯渇: 毎秒抜けるマナ。制圧でマナが満ちる */
  manaDrainPerSec: 4,
  /** 刻の裂け目: 出ている秒・触れる半径・止める秒 */
  riftTime: 6,
  riftRadius: 10,
  riftFreeze: 3,
  /** 霧: 続く秒と見える半径（px） */
  fogDuration: 40,
  fogRadius: 110,
  /** 呪いの風: HUD に残す秒 */
  curseWindShow: 3,
  /** 血の月: 撃破で戻る HP と、湧く敵の HP 倍率 */
  bloodMoonHeal: 2,
  bloodMoonHpMul: 1.3,
  /** 縮みの呪い: 敵の HP 倍率と、足す湧きの抽選回数（倍率） */
  shrinkHpMul: 0.5,
  shrinkExtraMul: 1,
  /** 勢いの風: この秒以内に次の部屋へ入ると移動速度が上がり、敵が 1 体減る */
  momentumWindow: 5,
  momentumSpeedMul: 1.3,
  momentumSpeedTime: 6,
  /** HUD の色 */
  warnColor: "#ffb040",
  activeColor: "#ff7050",
  impactColor: "#ff9040",
  // ---- 第 2 弾のイベント ----
  /** 鈍重: ダッシュの再使用が dashCdMul 倍、ダッシュの直後 buffTime 秒の与ダメが dashDamageMul 倍 */
  sluggish: { dashCdMul: 2, dashDamageMul: 2, buffTime: 0.6 },
  /** 地形の氾濫: 続く秒・広げる間隔・広がる速さ（px/秒）・最大半径・地形が残る秒 */
  flood: { duration: 10, interval: 1, growth: 9, maxRadius: 72, terrainTime: 20 },
  /** 決闘: 他の敵が止まる秒（麻痺）と、決闘に勝ったとき他の敵に付く恐怖の秒 */
  duel: { holdTime: 5, fearTime: 4 },
  /** 静寂: 部屋の敵に付く沈黙の秒 */
  silenceTime: 30,
  /** 反応の共振: 反応が起きた点から半径 radius に damage（+ 深度ごとに perDepth 倍ずつ）。同じ点で連鎖し続けないよう icd 秒あける */
  surge: { radius: 40, damage: 10, perDepth: 0.1, icd: 0.25, color: "#ffe060" },
  /** 雷鳴の刻: 続く秒・落雷の間隔・予告・半径・ダメージ・プレイヤーからのばらつき（px）・当たった敵の感電 */
  thunder: { duration: 10, interval: 0.8, telegraph: 1, radius: 18, damage: 6, spread: 100, shockStacks: 1, shockDuration: 3, color: "#c0e0ff" },
  /** 呪詛の声: 制圧までに要るコンボ */
  curseVoiceCombo: 20,
  /** 属性の嵐: 通常攻撃に乗る属性の割合 */
  elementStormShare: 0.5,
  /** 死神の通り道: 死神の猶予のこの割合を過ぎてから起きる。横切る速さ（px/秒）・横切る長さの半分（px）・当たり・ダメージ・通過後の冥の残響 */
  reaperPass: { minRatio: 0.5, speed: 240, span: 300, radius: 12, damage: 30, echoes: 2 },
  /** 生命の逆流: 続く秒と、生命 ⇔ 気力の換算 */
  lifeFlow: { duration: 30, ratio: 1 },
  /** 蝙蝠の渡り: 続く秒・湧く数・撃破 1 体で戻る気力 */
  bats: { duration: 20, count: 6, manaPerKill: 6 },
  /** 残響の鉱脈: 触れられる回数・1 回の残響・1 回ごとに寄ってくる増援の抽選回数 */
  vein: { uses: 4, echoes: 1, reinforce: 1, color: "#80ffe0" },
} as const;

/** 長居の代償（死神以外。src/system/linger.ts。docs/ideas/run-expansion.md 5 章） */
export const LINGER = {
  minDepth: 3,
  /** 死神の猶予に対する、代償が始まる時刻の割合（長居の二重苦では doubleRatio） */
  startRatio: 0.6,
  doubleRatio: 0.35,
  /** 始まるこの秒前から HUD に予告を出す */
  warnMargin: 15,
  /** 影の自分: 何秒前の軌跡をなぞるか・影どうしの遅れの差・新しい影が出る間隔・上限・記録の間隔・当たり */
  shadowDelay: 10,
  shadowGap: 2.5,
  shadowInterval: 12,
  shadowMax: 4,
  trailStep: 0.1,
  shadowRadius: 6,
  shadowDamage: 10,
  shadowColor: "#402060",
  /** 天井の崩落: 落石の間隔（最初 → 最短）・縮む速さ（秒/秒）・予告・半径・ダメージ・ばらつき（px） */
  collapseInterval: 3,
  collapseMinInterval: 1.1,
  collapseAccel: 0.03,
  collapseTelegraph: 1,
  collapseRadius: 14,
  collapseDamage: 10,
  collapseSpread: 28,
  /** 潮: 水が広がる速さ（px/秒）・置き直す間隔・満潮までの秒・満潮後に水の上で受ける毎秒ダメージ */
  tideSpeed: 18,
  tideInterval: 1,
  tideFullAfter: 40,
  tideDrownDps: 3,
} as const;

/** 起点（ラン開始時の選択。src/system/runSetup.ts） */
export const ORIGIN = {
  /** 呪われた者: 最初に受ける呪い付き祝福の数と、代わりに得る振り分け点 */
  cursedBoons: 2,
  cursedPoints: 4,
  /** 素手: 装備が封印される階（この深度に着くと解ける）と、代わりに得る振り分け点 */
  unarmedUnsealDepth: 3,
  unarmedPoints: 3,
  /** 詠み手: 最初に差す刻印符の数と、最大 HP の倍率 */
  chanterRunes: 2,
  chanterHpMul: 0.8,
  /** 死神の友: 死神の速さの倍率と、階ごとに追加で得る振り分け点 */
  reaperFriendSpeedMul: 0.5,
  reaperFriendPoints: 1,
} as const;

/** ジョブ（src/data/jobs.ts / src/system/jobs.ts。docs/COMBAT_DESIGN.md A-9） */
export const JOB = {
  /** 得意な武器種を持っている間の近接の威力・攻撃速度の倍率 */
  favoredMeleeMul: 1.1,
  favoredAttackSpeedMul: 1.08,
  /** 初期スキル石の刻印符の枠 */
  starterStoneLinks: 1,
  // ---- 剣士 ----
  swordsmanFinisherPoise: 14,
  swordsmanJustBuffPct: 25,
  swordsmanJustBuffSec: 3,
  swordsmanRangedMul: 0.8,
  // ---- 狩人 ----
  hunterWindupPoise: 10,
  hunterVulnerableSec: 2.5,
  hunterEliteIcd: 1,
  hunterHpMul: 0.85,
  // ---- 拳闘士 ----
  brawlerEveryHits: 6,
  brawlerShockwaveRatio: 0.8,
  brawlerHurtBuffPct: 30,
  brawlerHurtBuffSec: 3,
  brawlerRangedMul: 0.7,
  // ---- 盾持ち ----
  shieldHurtInvulnSec: 0.4,
  shieldHurtIcd: 6,
  shieldCounterRatio: 1,
  shieldMoveMul: 0.92,
  // ---- 呪術師 ----
  hexerStatusMana: 2,
  hexerStatusIcd: 0.3,
  hexerSpreadRadius: 56,
  hexerSpreadSec: 4,
  hexerMeleeMul: 0.85,
  // ---- 槍兵 ----
  lancerGuardPoise: 16,
  lancerStaggerEnergy: 8,
  lancerDashCdMul: 1.15,
  // ---- 術士 ----
  invokerCastBuffPct: 15,
  invokerCastBuffSec: 2,
  invokerLowManaKill: 6,
  invokerHpMul: 0.85,
  // ---- 影 ----
  shadowAfterDashSec: 0.5,
  shadowVulnerableSec: 2,
  shadowVulnerableIcd: 0.5,
  shadowJustSpeedPct: 30,
  shadowJustSpeedSec: 2,
  shadowHpMul: 0.8,
  // ---- 錬金術師 ----
  alchemistReactionEnergy: 6,
  alchemistBlastRatio: 0.6,
  alchemistBlastIcd: 1,
  alchemistAttackSpeedMul: 0.9,
} as const;

/** メタ進行（図鑑・依頼・実績。src/meta/）。ゲーム進行には効かない */
export const META = {
  /** ラン開始時に並べる依頼の数 */
  questOffers: 3,
  /** 今いる部屋の種類を図鑑に記録する間隔（ステップ）。毎ステップ部屋を探さないため */
  roomSampleTicks: 15,
} as const;

/** ラン修飾子（縛り）。点の合計が位階（src/system/runSetup.ts） */
/** 契約者・契約・欠片（src/system/contractors.ts。docs/ideas/run-expansion.md 0 章・6 章） */
export const CONTRACT = {
  /** 契約者が階の入口（開始部屋）に立つ深度と確率。ボスを倒した次の階は必ず立つ */
  minDepth: 2,
  appearChance: 0.4,
  /** 契約者の出る重み */
  weights: { notary: 3, peddler: 3, mender: 2, seer: 2, bookie: 2, bard: 2, smith: 2, guide: 2, ferryman: 2 },
  /** 立ち位置（開始部屋の中心から上へ、タイル）・台座の列（中心から上へ、タイル）・台座の間隔（タイル） */
  standOffset: 3,
  offerOffset: 1.6,
  offerSpacing: 2.5,
  /** 近づくと一言を出す距離（px） */
  greetRange: 56,
  color: "#d8d0b8",
  pactColor: "#c0b0a0",
  // ---- 欠片（ラン内だけの小さな資源）----
  /** 部屋の制圧で得る欠片。波の部屋・巣・鏡などは bonusRoom を上乗せ */
  shardsPerClear: 1,
  shardsBonusRoom: 2,
  /** 初めて着いた階で得る欠片 */
  shardsPerFloor: 1,
  /** 賞金首・決闘で得る欠片 */
  shardsBounty: 3,
  shardsDuel: 2,
  shardColor: "#b0f0ff",
  // ---- 灰の公証人（契約）----
  pactSlayerKills: 12,
  pactSwiftTime: 75,
  pactSwiftPenalty: 30,
  pactSwiftPoints: 2,
  pactUnscathedShards: 3,
  pactSilentShards: 5,
  pactSilentPenaltyShards: 3,
  // ---- 行商 ----
  peddlerItemCost: 4,
  peddlerItemBoost: 2,
  peddlerEchoCost: 3,
  peddlerEchoes: 4,
  peddlerSalveCost: 2,
  peddlerSalveHeal: 0.35,
  // ---- 修理屋 ----
  menderStitchCost: 2,
  menderStitchHeal: 0.5,
  menderUncurseCost: 4,
  menderCleanseCost: 1,
  // ---- 占い ----
  seerReadCost: 1,
  seerWardCost: 3,
  seerMapCost: 2,
  // ---- 賭場の主 ----
  bookieBet: 3,
  bookieWinChance: 0.5,
  bookieLifeCost: 0.2,
  bookieLifeWinChance: 0.5,
  // ---- 語り部 ----
  bardTaleCost: 2,
  bardTales: 4,
  bardWitnessTime: 60,
  // ---- 鍛冶 ----
  smithCost: 3,
  smithShare: 0.3,
  smithChoices: 3,
  // ---- 案内人 ----
  guideForkCost: 1,
  guideRevealCost: 1,
  // ---- 渡し守 ----
  ferryLifeCost: 0.15,
  ferryShardCost: 3,
  ferryTime: 30,
  ferryMaxUses: 3,
} as const;

export const RUN_MOD = {
  thickHideHpMul: 1.3,
  /** 早い手: 予備動作が縮む割合（下限は基準の 60% を守る） */
  quickHandsCut: 0.1,
  /** 急かす死神: 猶予の倍率 */
  hastyReaperMul: 0.7,
  /** 部屋の砂時計: 封鎖からこの秒で増援、以後この間隔で繰り返す */
  hourglassTime: 25,
  /** 薄氷: 最大 HP の倍率 */
  glassBodyHpMul: 0.7,
  /** 位階 1 あたりの、階段で得るスコアの上乗せ */
  scorePerTier: 0.1,
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
    /** 近接 1 ヒットで戻る量（被ダメに対する割合）。0.15 → 0.1（memo 2026-09-24） */
    perHitRatio: 0.1,
    /** 取り戻せる合計（被ダメに対する割合）。C-1 で 0.6 → 0.5、memo 2026-09-24 で 0.5 → 0.3 */
    poolRatio: 0.3,
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
    text: "見切り斬り！",
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
  /** 血の代償: 制圧で回復する割合（最大 HP に対する）。全回復 → 0.6（memo 2026-09-24） */
  clearHealRatio: 0.6,
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
  /** 血の饗宴・饗宴の盃の撃破回復。3 → 2（memo 2026-09-24。HEAL.sustainCapRatio の上限も受ける） */
  feastHeal: 2,
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
  /** 血煙: 出血の敵を倒したときの回復量。3 → 2（memo 2026-09-24） */
  bloodMistHeal: 2,
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
  /** 共通語彙: 候補が今のビルドの「飢え」（食うのに誰も出さない語）を 1 つでも埋めるときの重み倍率 */
  affinityWeightMul: 1.5,
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
  // ---- 祝福 第 2 弾（統一ルール文法の拡張で書いたもの。src/system/boonDefs.ts） ----
  /** 文法の地形の効果の既定半径・ダッシュ回数が戻った浮き文字 */
  ruleTerrainRadius: 16,
  ruleDashRefillText: "再駆",
  ruleTextScale: 1.1,
  ruleTextLife: 0.6,
  /** 第 2 弾の Rule の ICD の下限（毎ヒットで回る効果も同じ瞬間の多重発火を抑える） */
  ruleMinIcd: 0.1,
  /** 倒れた徘徊の敵を条件 targetRoamer が覚えておく秒（撃破の照合は同じステップの後で起きる） */
  roamerKillMemory: 1,
  /** 系譜「大地」: 地脈 / 足場崩し / 油撒き / 大地の怒り */
  leyLineMana: 6,
  leyLineIcd: 1.5,
  footBreakPoise: 10,
  oilSpillRadius: 12,
  oilSpillTime: 8,
  oilSpillIcd: 1,
  earthWrathRadius: 32,
  earthWrathIcd: 1.5,
  earthWrathBurstRadius: 64,
  /** 系譜「刃鳴」: 刃鳴 / 重ね刃 / 溜め鳴り / 百刃 */
  bladeHumMana: 4,
  bladeHumIcd: 0.4,
  /** 重ね刃: 武器種の段（0 始まり）がこれ以上の振り */
  layeredEdgeStep: 3,
  layeredEdgeRatio: 0.4,
  layeredEdgeIcd: 0.4,
  chargeRingBroken: 3,
  hundredBladesRatio: 0.8,
  hundredBladesIcd: 0.3,
  hundredBladesEnergy: 5,
  /** 武器種: 岩の構え / 影分身 / 穂先貫き / 鎌の実り / 連打の熱 / 鞭の脅し / 叩き割り / 棍の響き / 杖の灯 */
  rockStanceTime: 2,
  rockStanceWrath: 2,
  rockStanceIcd: 1,
  /** 影分身: 双剣の 5 段目（段 4）以上 */
  twinShadowStep: 4,
  twinShadowRatio: 0.6,
  spearPierceRatio: 0.7,
  spearPierceIcd: 0.5,
  scytheReapMana: 6,
  scytheReapBleed: 3,
  scytheReapIcd: 0.5,
  fistsHeatCombo: 15,
  fistsHeatEnergy: 2,
  fistsHeatIcd: 0.1,
  whipThreatFear: 0.6,
  whipThreatIcd: 1.5,
  cleaverSplitBroken: 3,
  cleaverSplitIcd: 1,
  staffRingRatio: 0.5,
  staffRingIcd: 0.5,
  wandLampMana: 1,
  wandLampIcd: 0.15,
  /** 射撃の型: 油の地雷 / 撃ち離れ / 毒蜂 / 礫雨 */
  oilMineRadius: 16,
  oilMineTime: 8,
  oilMineIcd: 1,
  chargeRecoilIcd: 2,
  venomBeePoison: 3,
  pebbleRainPoise: 3,
  /** 属性: 弱点突き / 耐性崩し / 油火斬り / 属性の奔流 / 闇喰らい / 光刺し / 水面の雷 */
  weakStrikeMeleeMana: 3,
  weakStrikeRangedMana: 2,
  weakStrikeIcd: 0.3,
  resistBreakVulnerable: 3,
  resistBreakIcd: 1,
  oilSlashBurn: 3,
  oilSlashIcd: 0.5,
  elementTorrentEnergy: 4,
  elementTorrentIcd: 0.5,
  darkFeastHeal: 2,
  lightPierceVulnerable: 2,
  lightPierceIcd: 0.5,
  waterThunderRadius: 40,
  waterThunderTime: 2,
  waterThunderIcd: 1,
  /** 地形: 氷滑り / 野焼き / 水走り / 凍て水 */
  iceSkateHaste: 2,
  iceSkateIcd: 3,
  fieldBurnBurn: 3,
  fieldBurnIcd: 0.5,
  waterRunnerStacks: 2,
  waterRunnerTime: 5,
  waterRunnerIcd: 2,
  frozenWaterFreeze: 1,
  frozenWaterIcd: 3,
  /** ジョブ: 得物の誉れ / 無名の誇り / 他流 */
  favoredPrideEnergy: 6,
  favoredPrideIcd: 0.3,
  namelessMana: 3,
  namelessEnergy: 3,
  otherStyleMana: 2,
  otherStyleIcd: 0.5,
  /** 部屋: 巣窟の主 / 群れ喰らい / 徘徊狩り / 迷い討ち / 旅慣れ / 口火 */
  hordeLordEnergy: 30,
  hordeLordMana: 20,
  hordeEaterHeal: 1,
  hordeEaterEnergy: 2,
  roamHuntMana: 10,
  roamHuntEnergy: 10,
  strayMarkVulnerable: 3,
  wayfarerEnergy: 5,
  wayfarerIcd: 2,
  wayfarerClearMana: 15,
  engageSparkFear: 0.6,
  /** 反応: 反応の余熱 / 蒸気隠れ */
  reactionEmberMana: 3,
  reactionEmberIcd: 0.5,
  steamVeilHaste: 2,
  steamVeilIcd: 3,
  /** 気力: 織り交ぜ（K02）/ 満ち溢れ（K06 を払い戻しの形に） */
  weaveOtherMul: 0.75,
  weaveSameMul: 1.25,
  overflowPerHit: 4,
  /** 満ち溢れ: 溜められる上限（最大気力に対する割合） */
  overflowCapRatio: 0.5,
  /** 呪い: 血染めの地 / 一念 / 焦がれ刃 / 狂い咲き / 野良の賞金 / 重き誓い / 濡れ鼠 */
  bloodSoilEnergy: 15,
  bloodSoilBleedTime: 3,
  bloodSoilBleed: 1,
  bloodSoilIcd: 2,
  singleMindMainMul: 0.5,
  singleMindOtherMul: 2,
  scorchBladeBurn: 2,
  scorchBladeIcd: 0.3,
  scorchBladeSelfTime: 1.5,
  scorchBladeSelfDps: 2,
  scorchBladeSelfIcd: 1,
  madBloomRatio: 0.6,
  madBloomWeaken: 1.5,
  madBloomIcd: 0.5,
  strayBountyEnergy: 100,
  strayBountyWeaken: 3,
  strayBountyIcd: 1,
  heavyOathPoise: 30,
  heavyOathWeaken: 1,
  heavyOathIcd: 1,
  drenchedMana: 100,
  drenchedWetStacks: 3,
  drenchedWetTime: 6,
  drenchedIcd: 6,
  /** 結び: 油火爆 / 氷上の舞 / 雷雨 / 地走り / 狩場の王 / 弱点連鎖 */
  oilBlastRatio: 1,
  oilBlastIcd: 1,
  iceDanceFreeze: 1,
  iceDanceIcd: 3,
  thunderRainRatio: 0.8,
  thunderRainIcd: 1.5,
  groundRendRadius: 24,
  groundRendIcd: 1.5,
  huntLordFear: 1.5,
  weakChainRatio: 0.6,
  weakChainIcd: 0.8,
} as const;

/**
 * 武器種（src/data/weapons.ts）と射撃の型の数値。docs/COMBAT_DESIGN.md「武器種」/ docs/ideas/meta-and-weapons.md 1〜2 章。
 * 剣（sword）と単発（single）の威力・形は PLAYER.melee / ACTION.dashAttack / PLAYER.shoot をそのまま使う。
 * 威力の scaling は基礎値（各 5）で剣の秒間期待値から大きく離れないよう揃え、
 * 差は「形・リーチ・怯み値・マナ回収・移動」で付ける（単一最強を作らない）
 */
export const WEAPON = {
  /** 溜めの段（0 = 段なし）ごとのプレイヤーの周りの環の色 */
  chargeRingColors: ["#ffffff", "#ffd75f", "#ff9040", "#ff4060"],
  /** 溜めの環の半径（段なし）と段ごとの加算 */
  chargeRingRadius: 9,
  chargeRingStep: 3,
  /**
   * 派生の入力列を覚えておく秒数。最後の入力からこの秒数が過ぎ、振っていなければ列を捨てる
   * （撃ってから斬る「右→左」の派生が、撃ち終えてしばらく後の斬りに化けないように）
   */
  chainWindow: 0.5,
  /** 派生列の長さの上限（最長の派生に足りる長さ） */
  chainMaxInputs: 5,
  /** 残像（trail）の線の寿命 */
  trailLife: 0.12,
  /**
   * 段の手触り（任意）: hits = 1 振りの多段ヒット数（active を等分）、hitstop = ヒットストップ（ステップ。省略は light / heavy）、
   * shake = 命中時の画面揺れ、lunge = windup + active の間に前へ踏み込む距離（px）、trail = 残像の線の色
   */
  movesets: {
    sword: {
      attackMoveMul: PLAYER.attackMoveMul,
      /** 剣の段そのものは PLAYER.melee（QA で調整済みの基準線）。派生だけを足す */
      branches: {
        crossCut: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.06, active: 0.12, recover: 0.3, scaling: { base: 10, str: 1.3 }, poise: 24, reach: 22, size: 40, knockback: 340, heavy: true, mana: 5, shape: { kind: "box" }, hitstop: 6, shake: 3, lunge: 8, trail: "#ffffff" },
        },
        steppingCut: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.04, active: 0.1, recover: 0.16, scaling: { base: 5.5, str: 0.7, dex: 0.2 }, poise: 10, reach: 30, size: 16, knockback: 200, heavy: false, mana: 3, shape: { kind: "thrust" }, lunge: 24, trail: "#c0e0ff" },
        },
      },
    },
    greatsword: {
      attackMoveMul: 0.2,
      steps: [
        { windup: 0.14, active: 0.12, recover: 0.3, scaling: { base: 8, str: 0.9, vit: 0.3 }, poise: 16, reach: 30, size: 30, knockback: 180, heavy: false, mana: 3, shape: { kind: "arc", deg: 150 }, hitstop: 3, shake: 1.5, lunge: 6, trail: "#e0d0b0" },
        { windup: 0.14, active: 0.12, recover: 0.3, scaling: { base: 8, str: 0.9, vit: 0.3 }, poise: 16, reach: 30, size: 30, knockback: 180, heavy: false, mana: 3, shape: { kind: "arc", deg: 150 }, hitstop: 3, shake: 1.5, lunge: 6, trail: "#e0d0b0" },
        { windup: 0.16, active: 0.14, recover: 0.34, scaling: { base: 10, str: 1.1, vit: 0.4 }, poise: 20, reach: 32, size: 32, knockback: 220, heavy: false, mana: 4, shape: { kind: "arc", deg: 200 }, hitstop: 4, shake: 2, lunge: 8, trail: "#e0d0b0" },
        { windup: 0.2, active: 0.14, recover: 0.45, scaling: { base: 14, str: 1.6, vit: 0.6 }, poise: 34, reach: 0, size: 60, knockback: 340, heavy: true, mana: 5, shape: { kind: "circle" }, hitstop: 6, shake: 4 },
      ],
      dashAttack: { windup: 0.05, active: 0.14, recover: 0.28, scaling: { base: 8, str: 1 }, poise: 18, reach: 0, size: 44, knockback: 240, heavy: false, mana: 3, shape: { kind: "circle" }, hitstop: 4, shake: 2 },
      /** 3 段階の溜め（攻撃キーの長押し）。time は押し始めからの秒。段に届かず離すと通常の振り */
      charge: {
        moveMul: 0.4,
        step: { windup: 0.06, active: 0.14, recover: 0.4, scaling: { base: 10, str: 1.2, vit: 0.4 }, poise: 24, reach: 34, size: 34, knockback: 300, heavy: true, mana: 6, shape: { kind: "arc", deg: 180 }, hitstop: 7, shake: 5, lunge: 10, trail: "#ffd75f" },
        levels: [
          { time: 0.4, damageMul: 1.3, poiseMul: 1.5, reachMul: 1.1 },
          { time: 0.8, damageMul: 1.9, poiseMul: 2.2, reachMul: 1.25 },
          { time: 1.2, damageMul: 2.8, poiseMul: 3.2, reachMul: 1.4 },
        ],
      },
      branches: {
        /** 右クリック単独の薙ぎ払い（大剣は右も近接）。続けて左で 3 段目へ */
        sweep: {
          sequence: ["secondary"],
          next: 2,
          step: { windup: 0.12, active: 0.14, recover: 0.34, scaling: { base: 9, str: 1, vit: 0.4 }, poise: 20, reach: 36, size: 36, knockback: 260, heavy: false, mana: 4, shape: { kind: "arc", deg: 240 }, hitstop: 4, shake: 2.5, trail: "#e0d0b0" },
        },
        helmSplitter: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.18, active: 0.12, recover: 0.5, scaling: { base: 16, str: 2, vit: 0.6 }, poise: 40, reach: 24, size: 30, knockback: 380, heavy: true, mana: 6, shape: { kind: "box" }, hitstop: 8, shake: 5, lunge: 14, trail: "#ffd75f" },
        },
      },
    },
    twinBlades: {
      attackMoveMul: 0.7,
      steps: [
        { windup: 0.03, active: 0.07, recover: 0.09, scaling: { base: 2.4, dex: 0.45 }, poise: 4, reach: 14, size: 22, knockback: 70, heavy: false, mana: 1.5, shape: { kind: "box" }, hitstop: 1, lunge: 3, trail: "#c0ffe0" },
        { windup: 0.03, active: 0.07, recover: 0.09, scaling: { base: 2.4, dex: 0.45 }, poise: 4, reach: 14, size: 22, knockback: 70, heavy: false, mana: 1.5, shape: { kind: "box" }, hitstop: 1, lunge: 3, trail: "#c0ffe0" },
        { windup: 0.03, active: 0.1, recover: 0.1, scaling: { base: 1.6, dex: 0.3 }, poise: 3, reach: 14, size: 24, knockback: 50, heavy: false, mana: 1, shape: { kind: "box" }, hits: 2, hitstop: 1, trail: "#c0ffe0" },
        { windup: 0.03, active: 0.07, recover: 0.09, scaling: { base: 2.4, dex: 0.45 }, poise: 4, reach: 14, size: 22, knockback: 70, heavy: false, mana: 1.5, shape: { kind: "box" }, hitstop: 1, lunge: 3, trail: "#c0ffe0" },
        { windup: 0.05, active: 0.1, recover: 0.22, scaling: { base: 5, dex: 0.9 }, poise: 12, reach: 16, size: 30, knockback: 200, heavy: true, mana: 3, shape: { kind: "box" }, hitstop: 4, shake: 2, lunge: 8, trail: "#ffffff" },
      ],
      /** すれ違い斬り: 前方へ細長く */
      dashAttack: { windup: 0.02, active: 0.1, recover: 0.16, scaling: { base: 5, dex: 0.8 }, poise: 8, reach: 34, size: 14, knockback: 120, heavy: false, mana: 2, shape: { kind: "thrust" }, trail: "#c0ffe0" },
      branches: {
        flurry: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.04, active: 0.24, recover: 0.26, scaling: { base: 2, dex: 0.4 }, poise: 4, reach: 0, size: 36, knockback: 60, heavy: false, mana: 1, shape: { kind: "circle" }, hits: 4, hitstop: 1, shake: 1, trail: "#c0ffe0" },
        },
        crossing: {
          sequence: ["primary", "primary", "primary", "secondary"],
          step: { windup: 0.04, active: 0.12, recover: 0.26, scaling: { base: 4, dex: 0.8 }, poise: 10, reach: 16, size: 34, knockback: 220, heavy: true, mana: 2, shape: { kind: "box" }, hits: 2, hitstop: 4, shake: 2.5, lunge: 6, trail: "#ffffff" },
        },
        shadowStep: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.02, active: 0.1, recover: 0.14, scaling: { base: 4, dex: 0.7 }, poise: 6, reach: 34, size: 14, knockback: 100, heavy: false, mana: 2, shape: { kind: "thrust" }, lunge: 28, trail: "#c0ffe0" },
        },
      },
    },
    spear: {
      attackMoveMul: 0.35,
      /** 穂先（先端 1/3）: 怯み値 ×2、マナ ×1.5 */
      tip: { ratio: 0.34, damageMul: 1.15, poiseMul: 2, manaMul: 1.5, offDamageMul: 1, offManaMul: 1 },
      steps: [
        { windup: 0.07, active: 0.08, recover: 0.2, scaling: { base: 4, dex: 0.4, str: 0.3 }, poise: 8, reach: 38, size: 10, knockback: 180, heavy: false, mana: 3, shape: { kind: "thrust" }, hitstop: 2, lunge: 4, trail: "#e0f0ff" },
        { windup: 0.07, active: 0.08, recover: 0.2, scaling: { base: 4, dex: 0.4, str: 0.3 }, poise: 8, reach: 40, size: 10, knockback: 180, heavy: false, mana: 3, shape: { kind: "thrust" }, hitstop: 2, lunge: 4, trail: "#e0f0ff" },
        /** 二連突き */
        { windup: 0.08, active: 0.14, recover: 0.22, scaling: { base: 3, dex: 0.3, str: 0.2 }, poise: 6, reach: 40, size: 10, knockback: 120, heavy: false, mana: 2, shape: { kind: "thrust" }, hits: 2, hitstop: 2, trail: "#e0f0ff" },
        { windup: 0.1, active: 0.12, recover: 0.32, scaling: { base: 8, dex: 0.8, str: 0.5 }, poise: 18, reach: 44, size: 12, knockback: 320, heavy: true, mana: 5, shape: { kind: "thrust" }, hitstop: 5, shake: 2, lunge: 10, trail: "#ffffff" },
      ],
      /** 突進突き: 押し込んで壁に叩きつける */
      dashAttack: { windup: 0.03, active: 0.1, recover: 0.2, scaling: { base: 6.5, dex: 0.6, str: 0.4 }, poise: 14, reach: 46, size: 12, knockback: 300, heavy: true, mana: 3, shape: { kind: "thrust" }, hitstop: 4, shake: 1.5, trail: "#e0f0ff" },
      branches: {
        /** 槍で唯一の範囲 */
        spearSweep: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.08, active: 0.12, recover: 0.3, scaling: { base: 5, str: 0.6, dex: 0.3 }, poise: 14, reach: 0, size: 50, knockback: 220, heavy: false, mana: 3, shape: { kind: "circle" }, hitstop: 3, shake: 2, trail: "#e0f0ff" },
        },
        divingThrust: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.05, active: 0.1, recover: 0.2, scaling: { base: 6, dex: 0.6, str: 0.3 }, poise: 14, reach: 48, size: 12, knockback: 280, heavy: true, mana: 3, shape: { kind: "thrust" }, hitstop: 4, shake: 1.5, lunge: 30, trail: "#ffffff" },
        },
      },
    },
    scythe: {
      attackMoveMul: 0.3,
      /** pull の段は敵を手前へ引き寄せる */
      steps: [
        { windup: 0.1, active: 0.12, recover: 0.24, scaling: { base: 4.5, spi: 0.5, str: 0.3 }, poise: 8, reach: 30, size: 30, knockback: 120, heavy: false, mana: 2, shape: { kind: "arc", deg: 160 }, pull: true, hitstop: 2, trail: "#b080ff" },
        { windup: 0.1, active: 0.12, recover: 0.24, scaling: { base: 4.5, spi: 0.5, str: 0.3 }, poise: 8, reach: 30, size: 30, knockback: 120, heavy: false, mana: 2, shape: { kind: "arc", deg: 160 }, pull: true, hitstop: 2, trail: "#b080ff" },
        { windup: 0.1, active: 0.16, recover: 0.26, scaling: { base: 3, spi: 0.35, str: 0.2 }, poise: 5, reach: 32, size: 32, knockback: 90, heavy: false, mana: 1.5, shape: { kind: "arc", deg: 200 }, pull: true, hits: 2, hitstop: 1, trail: "#b080ff" },
        { windup: 0.14, active: 0.14, recover: 0.36, scaling: { base: 9, spi: 1, str: 0.5 }, poise: 18, reach: 34, size: 34, knockback: 260, heavy: true, mana: 5, shape: { kind: "arc", deg: 270 }, hitstop: 5, shake: 3, trail: "#e0c0ff" },
      ],
      dashAttack: { windup: 0.03, active: 0.12, recover: 0.2, scaling: { base: 6, spi: 0.7, str: 0.3 }, poise: 10, reach: 30, size: 30, knockback: 150, heavy: false, mana: 3, shape: { kind: "arc", deg: 220 }, pull: true, trail: "#b080ff" },
      branches: {
        reaping: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.14, active: 0.16, recover: 0.4, scaling: { base: 10, spi: 1.2, str: 0.4 }, poise: 18, reach: 36, size: 36, knockback: 280, heavy: true, mana: 5, shape: { kind: "arc", deg: 360 }, hitstop: 5, shake: 3, trail: "#e0c0ff" },
        },
        hookPull: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.06, active: 0.1, recover: 0.2, scaling: { base: 5, spi: 0.6 }, poise: 8, reach: 44, size: 16, knockback: 200, heavy: false, mana: 2, shape: { kind: "thrust" }, pull: true, hitstop: 2, trail: "#b080ff" },
        },
      },
    },
    fists: {
      /** 殴りながらでも減速しない（張り付く型） */
      attackMoveMul: 1,
      steps: [
        { windup: 0.02, active: 0.06, recover: 0.08, scaling: { base: 2.2, vit: 0.3, str: 0.3 }, poise: 6, reach: 10, size: 18, knockback: 60, heavy: false, mana: 3, shape: { kind: "box" }, hitstop: 1, lunge: 4 },
        { windup: 0.02, active: 0.06, recover: 0.08, scaling: { base: 2.2, vit: 0.3, str: 0.3 }, poise: 6, reach: 10, size: 18, knockback: 60, heavy: false, mana: 3, shape: { kind: "box" }, hitstop: 1, lunge: 4 },
        { windup: 0.02, active: 0.06, recover: 0.08, scaling: { base: 2.2, vit: 0.3, str: 0.3 }, poise: 6, reach: 10, size: 18, knockback: 60, heavy: false, mana: 3, shape: { kind: "box" }, hitstop: 1, lunge: 4 },
        /** 連打 */
        { windup: 0.03, active: 0.15, recover: 0.12, scaling: { base: 1.4, vit: 0.2, str: 0.2 }, poise: 4, reach: 10, size: 18, knockback: 30, heavy: false, mana: 1.5, shape: { kind: "box" }, hits: 3, hitstop: 1 },
        { windup: 0.04, active: 0.08, recover: 0.2, scaling: { base: 5, vit: 0.6, str: 0.6 }, poise: 16, reach: 12, size: 20, knockback: 260, heavy: true, mana: 5, shape: { kind: "box" }, hitstop: 5, shake: 3, lunge: 8, trail: "#ffb080" },
      ],
      /** 投げ: 掴んで背後へ放る（壁叩きつけ） */
      dashAttack: { windup: 0.02, active: 0.08, recover: 0.22, scaling: { base: 6, vit: 0.6, str: 0.6 }, poise: 20, reach: 12, size: 20, knockback: 380, heavy: true, mana: 3, shape: { kind: "box" }, throw: true, hitstop: 5, shake: 3 },
      branches: {
        uppercut: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.04, active: 0.08, recover: 0.26, scaling: { base: 6, vit: 0.6, str: 0.6 }, poise: 26, reach: 12, size: 20, knockback: 300, heavy: true, mana: 5, shape: { kind: "box" }, hitstop: 6, shake: 3, trail: "#ffb080" },
        },
        hundredFists: {
          sequence: ["primary", "primary", "primary", "primary", "secondary"],
          step: { windup: 0.04, active: 0.3, recover: 0.3, scaling: { base: 1.6, vit: 0.2, str: 0.2 }, poise: 4, reach: 12, size: 22, knockback: 40, heavy: false, mana: 1, shape: { kind: "box" }, hits: 6, hitstop: 1, shake: 1 },
        },
        steppingFist: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.03, active: 0.08, recover: 0.12, scaling: { base: 3.5, vit: 0.4, str: 0.4 }, poise: 10, reach: 12, size: 18, knockback: 150, heavy: false, mana: 3, shape: { kind: "box" }, hitstop: 2, lunge: 26 },
        },
      },
    },
    whip: {
      attackMoveMul: 0.5,
      /** 先端（1/4）だけ満額。根元は半分でマナも戻らない */
      tip: { ratio: 0.25, damageMul: 1, poiseMul: 1.5, manaMul: 1, offDamageMul: 0.5, offManaMul: 0 },
      steps: [
        { windup: 0.1, active: 0.08, recover: 0.22, scaling: { base: 5, dex: 0.5, spi: 0.3 }, poise: 6, reach: 56, size: 6, knockback: 100, heavy: false, mana: 3, shape: { kind: "thrust" }, hitstop: 2, trail: "#d0a060" },
        { windup: 0.08, active: 0.1, recover: 0.2, scaling: { base: 3.5, dex: 0.4, spi: 0.2 }, poise: 5, reach: 44, size: 44, knockback: 90, heavy: false, mana: 2, shape: { kind: "arc", deg: 120 }, hitstop: 1, trail: "#d0a060" },
        /** 返しの多段 */
        { windup: 0.08, active: 0.16, recover: 0.22, scaling: { base: 2.5, dex: 0.3, spi: 0.2 }, poise: 4, reach: 48, size: 48, knockback: 70, heavy: false, mana: 1.5, shape: { kind: "arc", deg: 180 }, hits: 2, hitstop: 1, trail: "#d0a060" },
        { windup: 0.12, active: 0.1, recover: 0.3, scaling: { base: 8, dex: 0.8, spi: 0.5 }, poise: 14, reach: 60, size: 6, knockback: 200, heavy: false, mana: 4, shape: { kind: "thrust" }, hitstop: 4, shake: 2, trail: "#ffffff" },
      ],
      dashAttack: { windup: 0.03, active: 0.12, recover: 0.2, scaling: { base: 5, dex: 0.5, spi: 0.3 }, poise: 6, reach: 0, size: 70, knockback: 150, heavy: false, mana: 2, shape: { kind: "circle" }, trail: "#d0a060" },
      branches: {
        whirl: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.06, active: 0.3, recover: 0.3, scaling: { base: 2.5, dex: 0.3, spi: 0.2 }, poise: 4, reach: 0, size: 80, knockback: 120, heavy: false, mana: 1, shape: { kind: "circle" }, hits: 3, hitstop: 1, shake: 1, trail: "#d0a060" },
        },
        crack: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.1, active: 0.1, recover: 0.24, scaling: { base: 7, dex: 0.7, spi: 0.4 }, poise: 12, reach: 64, size: 8, knockback: 220, heavy: false, mana: 3, shape: { kind: "thrust" }, hitstop: 3, shake: 1.5, trail: "#ffffff" },
        },
      },
    },
    cleaver: {
      attackMoveMul: 0.25,
      /** 全段が壁叩きつけを起こす重い振り */
      steps: [
        { windup: 0.1, active: 0.1, recover: 0.26, scaling: { base: 6.5, str: 0.9 }, poise: 12, reach: 18, size: 28, knockback: 260, heavy: true, mana: 3, shape: { kind: "box" }, hitstop: 4, shake: 2, lunge: 5, trail: "#ff9070" },
        { windup: 0.1, active: 0.1, recover: 0.26, scaling: { base: 6.5, str: 0.9 }, poise: 12, reach: 18, size: 28, knockback: 260, heavy: true, mana: 3, shape: { kind: "box" }, hitstop: 4, shake: 2, lunge: 5, trail: "#ff9070" },
        { windup: 0.12, active: 0.1, recover: 0.3, scaling: { base: 7, str: 1 }, poise: 14, reach: 20, size: 30, knockback: 280, heavy: true, mana: 3, shape: { kind: "box" }, hitstop: 4, shake: 2.5, lunge: 6, trail: "#ff9070" },
        { windup: 0.16, active: 0.12, recover: 0.42, scaling: { base: 13, str: 1.6 }, poise: 26, reach: 22, size: 34, knockback: 420, heavy: true, mana: 5, shape: { kind: "box" }, hitstop: 7, shake: 4, lunge: 8, trail: "#ffffff" },
      ],
      dashAttack: { windup: 0.04, active: 0.1, recover: 0.24, scaling: { base: 8, str: 1 }, poise: 14, reach: 24, size: 30, knockback: 320, heavy: true, mana: 3, shape: { kind: "box" }, hitstop: 5, shake: 3, trail: "#ff9070" },
      branches: {
        slamDown: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.2, active: 0.12, recover: 0.5, scaling: { base: 15, str: 1.8 }, poise: 30, reach: 20, size: 40, knockback: 460, heavy: true, mana: 5, shape: { kind: "circle" }, hitstop: 8, shake: 5, trail: "#ffffff" },
        },
        shoulderCharge: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.05, active: 0.1, recover: 0.2, scaling: { base: 6, str: 0.8 }, poise: 16, reach: 12, size: 24, knockback: 360, heavy: true, mana: 3, shape: { kind: "box" }, hitstop: 5, shake: 3, lunge: 22 },
        },
      },
    },
    staff: {
      attackMoveMul: 0.4,
      /** 威力は低いが範囲・怯み値・マナ回収が高い（スキルを回す型） */
      steps: [
        { windup: 0.06, active: 0.1, recover: 0.2, scaling: { base: 3.5, mnd: 0.4, str: 0.2 }, poise: 10, reach: 26, size: 26, knockback: 150, heavy: false, mana: 4.5, shape: { kind: "arc", deg: 180 }, hitstop: 2, trail: "#a0c0ff" },
        { windup: 0.06, active: 0.1, recover: 0.2, scaling: { base: 3.5, mnd: 0.4, str: 0.2 }, poise: 10, reach: 26, size: 26, knockback: 150, heavy: false, mana: 4.5, shape: { kind: "arc", deg: 180 }, hitstop: 2, trail: "#a0c0ff" },
        { windup: 0.06, active: 0.1, recover: 0.2, scaling: { base: 3.5, mnd: 0.4, str: 0.2 }, poise: 12, reach: 36, size: 12, knockback: 200, heavy: false, mana: 4.5, shape: { kind: "thrust" }, hitstop: 2, lunge: 6, trail: "#a0c0ff" },
        { windup: 0.1, active: 0.12, recover: 0.34, scaling: { base: 6, mnd: 0.7, str: 0.3 }, poise: 22, reach: 0, size: 56, knockback: 280, heavy: false, mana: 7, shape: { kind: "circle" }, hitstop: 4, shake: 2.5, trail: "#ffffff" },
      ],
      dashAttack: { windup: 0.03, active: 0.1, recover: 0.2, scaling: { base: 4.5, mnd: 0.5, str: 0.2 }, poise: 12, reach: 36, size: 12, knockback: 200, heavy: false, mana: 4, shape: { kind: "thrust" }, trail: "#a0c0ff" },
      branches: {
        tempest: {
          sequence: ["primary", "primary", "secondary"],
          step: { windup: 0.08, active: 0.3, recover: 0.3, scaling: { base: 2.5, mnd: 0.3, str: 0.1 }, poise: 8, reach: 0, size: 64, knockback: 180, heavy: false, mana: 3, shape: { kind: "circle" }, hits: 3, hitstop: 1, shake: 1.5, trail: "#a0c0ff" },
        },
        upswing: {
          sequence: ["secondary", "primary"],
          next: 1,
          step: { windup: 0.05, active: 0.1, recover: 0.2, scaling: { base: 4, mnd: 0.5, str: 0.2 }, poise: 14, reach: 28, size: 28, knockback: 200, heavy: false, mana: 4, shape: { kind: "arc", deg: 180 }, hitstop: 2, lunge: 10, trail: "#a0c0ff" },
        },
      },
    },
    /** 杖: 左が射撃（銃の型をそのまま撃つ）、右が杖打ちの連撃。「撃って打つ」を 1 本の武器でやる */
    wand: {
      attackMoveMul: 0.5,
      steps: [
        { windup: 0.05, active: 0.08, recover: 0.18, scaling: { base: 3, mnd: 0.4, spi: 0.3 }, poise: 8, reach: 14, size: 22, knockback: 150, heavy: false, mana: 5, shape: { kind: "box" }, hitstop: 2, trail: "#80a0ff" },
        { windup: 0.05, active: 0.08, recover: 0.18, scaling: { base: 3, mnd: 0.4, spi: 0.3 }, poise: 8, reach: 14, size: 22, knockback: 150, heavy: false, mana: 5, shape: { kind: "box" }, hitstop: 2, trail: "#80a0ff" },
        { windup: 0.05, active: 0.1, recover: 0.2, scaling: { base: 3.5, mnd: 0.5, spi: 0.3 }, poise: 10, reach: 16, size: 26, knockback: 170, heavy: false, mana: 5, shape: { kind: "box" }, hitstop: 2, lunge: 4, trail: "#80a0ff" },
        { windup: 0.1, active: 0.12, recover: 0.3, scaling: { base: 5, mnd: 0.6, spi: 0.4 }, poise: 18, reach: 0, size: 48, knockback: 260, heavy: false, mana: 7, shape: { kind: "circle" }, hitstop: 4, shake: 2, trail: "#ffffff" },
      ],
      dashAttack: { windup: 0.03, active: 0.1, recover: 0.2, scaling: { base: 4, mnd: 0.5, spi: 0.3 }, poise: 10, reach: 0, size: 40, knockback: 220, heavy: false, mana: 4, shape: { kind: "circle" }, trail: "#80a0ff" },
      branches: {
        /** 撃ってから打つ: 魔力を込めた一撃 */
        arcaneStrike: {
          sequence: ["primary", "secondary"],
          step: { windup: 0.06, active: 0.12, recover: 0.3, scaling: { base: 6, mnd: 0.8, spi: 0.5 }, poise: 16, reach: 18, size: 30, knockback: 260, heavy: false, mana: 6, shape: { kind: "box" }, hitstop: 4, shake: 2, lunge: 8, trail: "#c0d0ff" },
        },
        staffSweep: {
          sequence: ["secondary", "secondary", "primary"],
          step: { windup: 0.06, active: 0.12, recover: 0.28, scaling: { base: 4, mnd: 0.5, spi: 0.3 }, poise: 10, reach: 30, size: 30, knockback: 200, heavy: false, mana: 4, shape: { kind: "arc", deg: 200 }, hitstop: 3, shake: 1.5, trail: "#80a0ff" },
        },
      },
    },
  },
  shots: {
    single: { cooldownMul: 1, damageMul: 1, speedMul: 1, lifeMul: 1, radius: PLAYER.shoot.radius, poiseMul: 1, recoilMul: 1, pellets: 0, spreadDeg: PLAYER.projectileSpreadDeg, pierceBonus: 0 },
    /** 連射: 間隔が短く 1 発が軽い。弾筋が揺れる（sway は tick の正弦で決まり乱数を使わない） */
    rapid: { cooldownMul: 0.5, damageMul: 0.55, speedMul: 1.05, lifeMul: 1, radius: 2, poiseMul: 0.5, recoilMul: 0.5, pellets: 0, spreadDeg: 8, pierceBonus: 0, sway: { deg: 6, freq: 0.9 } },
    /** 散弾: 3 発の扇（散弾銃の implicit の弾数と合わせて 5〜6 発）、射程が短い。撃つと自分が後ろへ跳ねる */
    spread: { cooldownMul: 1.6, damageMul: 0.55, speedMul: 0.9, lifeMul: 0.4, radius: 2, poiseMul: 0.8, recoilMul: 5, pellets: 2, spreadDeg: 9, pierceBonus: 0 },
    /** 貫通: 間隔が長いが重く速い弾が敵を 2 体抜ける */
    pierce: { cooldownMul: 1.5, damageMul: 1.5, speedMul: 1.5, lifeMul: 1, radius: 2, poiseMul: 2, recoilMul: 1.5, pellets: 0, spreadDeg: 8, pierceBonus: 2 },
    /** 追尾: 遅い弾が近くの敵へ曲がる（旋回は毎秒 turnRate ラジアンまで） */
    homing: { cooldownMul: 1.3, damageMul: 1.1, speedMul: 0.6, lifeMul: 2, radius: 3, poiseMul: 1, recoilMul: 0.5, pellets: 0, spreadDeg: 14, pierceBonus: 0, homing: { turnRate: 5, range: 120 } },
    /** 跳弾: 壁で 2 回跳ね、跳ねるたびに威力と怯み値が mul 倍 */
    ricochet: { cooldownMul: 1.2, damageMul: 0.85, speedMul: 1, lifeMul: 1.6, radius: 2, poiseMul: 1, recoilMul: 1, pellets: 0, spreadDeg: 8, pierceBonus: 0, bounce: { count: 2, mul: 1.3 } },
    /** チャージ: 射撃キーを押している間溜め、離して撃つ。段に届かない tap は弱い 1 発 */
    charge: {
      cooldownMul: 1,
      damageMul: 0.6,
      speedMul: 1.1,
      lifeMul: 1.2,
      radius: 2,
      poiseMul: 1,
      recoilMul: 1,
      pellets: 0,
      spreadDeg: 8,
      pierceBonus: 0,
      charge: {
        levels: [
          { time: 0.35, damageMul: 1.4, radius: 3, pierceBonus: 0, poiseMul: 2 },
          { time: 0.7, damageMul: 2.4, radius: 4, pierceBonus: 1, poiseMul: 4 },
          { time: 1.1, damageMul: 3.8, radius: 5, pierceBonus: 2, poiseMul: 8 },
        ],
      },
    },
    /** 設置弾: 床で止まり、敵が近づくか fuse 秒で炸裂する */
    mine: {
      cooldownMul: 2.8,
      damageMul: 3,
      speedMul: 0.6,
      lifeMul: 1,
      radius: 3,
      poiseMul: 4,
      recoilMul: 0.5,
      pellets: 0,
      spreadDeg: 12,
      pierceBonus: 0,
      mine: { fuse: 3, drag: 6, blastRadius: 30, triggerRadius: 10, color: "#ffb040" },
    },
  },
} as const;

/**
 * 攻撃ジャンル（docs/COMBAT_DESIGN.md A-8）。範囲軸 × 質軸。参照ステータスの既定表は system/attributes.ts の GENRE_ATTRS
 */
export const GENRE = {
  /** genreScaling: 副ステータスの係数 = 主の係数 × この比 */
  secondaryRatio: 0.5,
  /** 混成（hybrid）の防御: 防御と魔防をこの比で混ぜる（0.5 = 平均） */
  hybridMix: 0.5,
  /** 敵の防御 / 魔防（%）の範囲。負は「柔らかい」（被ダメ増） */
  enemyDefenseMin: -50,
  enemyDefenseMax: 75,
} as const;

/**
 * 属性（docs/COMBAT_DESIGN.md A-8）。耐性は %、正で軽減・負で弱点。
 * プレイヤーの耐性は resistKnee を超えた分を resistSlope で鈍らせ、resistMax で止める（ソフトキャップ）
 */
export const ELEMENT = {
  resistMin: -100,
  resistMax: 75,
  resistKnee: 50,
  resistSlope: 0.5,
  /** 敵の耐性の範囲（ソフトキャップは掛けない。表の値そのまま） */
  enemyResistMin: -100,
  enemyResistMax: 75,
  /** 弱点 / 耐性の浮き文字 */
  weakText: "弱点",
  resistText: "耐性",
  weakColor: "#ffb040",
  resistColor: "#9098a8",
  textScale: 0.9,
  textLife: 0.5,
  /** 同じ敵の近くに同じ浮き文字が残っている間は重ねない（多段ヒットで埋め尽くさない） */
  textDedupeRadius: 18,
  /** 属性の攻撃が関係の深い状態異常を付けることがある（同一視はしない。確率は低め） */
  affinity: {
    chance: 0.1,
    duration: 2,
    /** 属性の割合がこれ以上のときだけ（変換で一部だけ炎にした攻撃は燃やさない） */
    minShare: 0.5,
    potency: { burn: 3, chill: 0, shock: 4, poison: 0, weaken: 0, vulnerable: 0 },
  },
  /** 敵の頭上の弱点の印 */
  mark: {
    offsetY: 6,
    size: 5,
    unknownGlyph: "？",
    unknownColor: "#a0a0a0",
  },
} as const;

/**
 * 演出（src/system/effects.ts / src/render/effectsUi.ts / src/render/statusUi.ts）。見た目だけで、ロジックの結果に影響しない。
 * 粒は演出専用の乱数を使うので、ここの数を変えてもゲームの乱数列は変わらない
 */
export const EFFECTS = {
  /** 同時に存在できる数の上限。超えたら古いものから消す（1 フレームの描画を重くしない） */
  maxParticles: 500,
  maxTexts: 80,
  maxShapes: 120,
  maxDeaths: 32,
  maxMarks: 64,
  /** 状態異常の見た目: 敵 1 体に描く状態の数と、1 状態あたりの疑似粒の数（毎フレームの描画量の上限） */
  statusKindsPerEnemy: 2,
  statusParticlesPerKind: 2,
  /** 状態異常の色調を重ねる濃さ */
  statusTintAlpha: 0.4,
  /** 撃破の演出（死に方ごとの長さと粒の数） */
  death: {
    life: { burst: 0, ash: 0.9, shatter: 0.5, discharge: 0.6, melt: 0.9, blood: 0.6, sever: 0.7, void: 0.6, holy: 0.9 },
    particles: 10,
    shardSpeed: 170,
    ashRise: 18,
    severGap: 10,
    dischargeHop: 6,
    bloodSpeed: 150,
  },
  /** 属性の命中の火花 */
  hitSpark: { count: 3, speed: 110, life: 0.3 },
  /** コンボ数に応じた浮き文字（min 以上で scale と色）。高い段ほど後ろに置く */
  comboTiers: [
    { min: 10, scale: 1.1, color: "#fff0a0" },
    { min: 25, scale: 1.2, color: "#ffd060" },
    { min: 50, scale: 1.3, color: "#ff9040" },
    { min: 100, scale: 1.45, color: "#ff5080" },
  ],
  comboMilestones: [10, 25, 50, 100, 200],
  comboMilestoneScale: 1.7,
  comboMilestoneLife: 1,
  comboMilestoneRise: 18,
  /** 部屋の制圧の波: 最後の撃破地点から床が順に光る */
  clearWave: { life: 1.1, speed: 240, band: 22, alpha: 0.4, color: "#ffe8a0", edgeAlpha: 0.7 },
  /** 精鋭の撃破: 色の輪と短い画面の色づき */
  eliteBurst: { life: 0.55, radius: 46, tintAlpha: 0.18, particles: 16 },
  /** ボス撃破: 画面全体の光と光条 */
  bossLight: { life: 1.8, rays: 12, rayWidth: 0.08, alpha: 0.55, color: "#fff4c0" },
  /** 見切り: 広がる輪と放射線 */
  justRing: { life: 0.4, radius: 30, lines: 8, color: "#60e0ff" },
  /** 連携成立の残光 */
  synergyGlow: { life: 0.7, radius: 24, color: "#ffd060" },
  /** 弱点ヒットの割れ（ひびの線） */
  weakCrack: { life: 0.4, size: 9, lines: 5, color: "#fff080" },
  /** 会心の反転（色反転の短い閃き） */
  critFlash: { life: 0.07 },
  /** 封鎖の扉（格子が落ちる） */
  doorSlam: { life: 0.45, drop: 12, color: "#ff6060", hordeColor: "#ff9040" },
  /** 溜めの段が上がった瞬間の輪 */
  chargeUp: { life: 0.3, radius: 20 },
  /** 遺物ドロップの光柱が空から落ちる */
  dropBeam: { life: 0.55, height: 140, width: 6 },
  /** ダッシュの残像（置く間隔と残る時間） */
  dashGhost: { interval: 0.03, life: 0.22, alpha: 0.45, color: "#80e0ff" },
  /** 階層到達の名札（地下 n 階・バイオーム名） */
  floorCard: { delay: 0.35, fadeIn: 0.25, hold: 1.2, fadeOut: 0.5 },
  /** 武器種ごとの振りの軌跡（太さ・濃さ）。未指定は既定 */
  trailAlpha: 0.35,
} as const;

/** 音楽（src/audio/music.ts）。曲の中身（音階・旋律）は music.ts の表、ここは混ぜ方と時間 */
export const MUSIC = {
  /** 効果音に対する音楽の基準の大きさ（設定の音量 × 音楽の音量 × これ） */
  gain: 0.32,
  defaultVolume: 0.5,
  /** 先読みで予約する秒（main のフレームが多少遅れても途切れない） */
  lookahead: 0.3,
  /** 曲の切り替えのフェード秒 */
  crossfade: 1.2,
  /** 交戦で打楽器の層が入る / 抜けるフェード秒 */
  percFade: 0.35,
  /** 制圧の解決の和音の長さ */
  resolveTime: 1.8,
  /** ボスのダウン中のテンポ倍率 */
  bossDownTempoMul: 1.2,
  /** 曲の途中から予約が遅れたときに打ち直す猶予（タブが裏にあった等） */
  resyncGap: 0.5,
} as const;
