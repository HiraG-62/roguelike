/**
 * 大拡張（docs/ideas/skills-expansion.md）のスキル・刻印符・連携の数値。
 * data.ts の SKILL に展開して読む（SKILL.contagion.radius など）ので、ロジックからは SKILL 経由で参照する。
 *
 * 目安: マナ型のコストは既存の一律 ×0.85 後の水準 10〜25。威力は Scaling（ステータス基礎値 各 5 で評価）で、
 * 単発の主力は 25〜30、多段は 1 ヒット 6〜10、状態異常の消費系は「素の威力は低く、消費で伸びる」に揃える。
 * 強いものには条件（満タン / 枯渇 / 状態異常の有無）か上限を付けて、単一最強を作らない。
 */

import { MANA } from "../data/tuning";

export const EXTRA_SKILL_TUNING = {
  /** 伝染: カーソル近くの敵の状態異常を、半径内の他の敵へ持続を減らして写す（消費しない） */
  contagion: {
    cost: 14,
    minInterval: 0.6,
    poise: 0,
    maxRange: 140,
    radius: 56,
    /** 写す元の敵を探す、照準地点からの半径 */
    pickRadius: 36,
    durationMul: 0.5,
    /** 写す持続の下限（短すぎて見えないのを避ける） */
    minDuration: 1,
  },
  /** 綻び: 命中した敵の状態異常を全部消費し、種類数に比例した威力 */
  unravel: {
    cost: 16,
    minInterval: 0.6,
    /** 1 種あたりの怯み値（0 種なら poiseEmpty） */
    poise: 8,
    poiseEmpty: 4,
    speed: 230,
    life: 0.7,
    radius: 4,
    damage: { base: 6, spi: 1.2 },
    perKind: { base: 5, spi: 1 },
    knockback: 60,
    /** 伝染 → 綻びの連携で、命中点から広げる半径 */
    comboRadius: 56,
  },
  /** 燃え種爆ぜ: 半径内の燃焼を消費し、残りの燃焼ダメージを爆発として撒く */
  kindle: {
    cost: 14,
    minInterval: 0.6,
    poise: 10,
    maxRange: 140,
    radius: 52,
    /** 燃焼 1 体ごとの爆発の半径 */
    burstRadius: 30,
    /** 燃焼の残りダメージ（potency × 残り秒）のうち爆発に回す割合 */
    burnRatio: 0.8,
    /** 燃焼の残量 1 あたりの追加の怯み値と上限 */
    poisePerBurn: 0.5,
    maxPoise: 40,
    damage: { base: 4, spi: 0.6 },
    knockback: 120,
  },
  /** 五彩の礫: 支配共鳴の色で性質が変わる礫 3 個 */
  prismShard: {
    cost: 12,
    minInterval: 0.5,
    poise: 8,
    count: 3,
    spreadRad: 0.16,
    speed: 210,
    life: 0.6,
    radius: 3,
    damage: { base: 5, dex: 0.6, spi: 0.6 },
    knockback: 50,
    /** 蒼: 弾速倍率 */
    azureSpeedMul: 1.3,
    /** 翠: 命中 1 回の回復 */
    jadeHeal: 1,
    /** 金: 貫通数の加算 */
    goldPierce: 1,
    bleedTime: 4,
    bleedPotency: 1,
    shockPotency: 2,
    vulnerableTime: 2,
  },
  /** 満月の砲: マナ満タンでだけ撃てる。全量を払い、払った量に比例した太さ・威力の貫通ビーム */
  fullMoon: {
    /** 名目のコスト（基礎の最大マナ）。実際に払うのは発動時の最大マナ全量（system/skills.ts の manaRuleCost） */
    cost: MANA.baseMax,
    minInterval: 1,
    poise: 40,
    damage: { base: 30, mnd: 2, spi: 2 },
    /** このマナを払ったとき威力 ×1 */
    refMana: MANA.baseMax,
    halfWidth: 3,
    /** 払ったマナ 1 あたりの太さの加算 */
    widthPerMana: 0.08,
    maxLength: 400,
    stepPx: 2,
    knockback: 220,
    vulnerableTime: 2,
    /** 満タン判定の許容（浮動小数の誤差） */
    fullEpsilon: 0.01,
  },
  /** 枯渇の刃: マナが最大の lowRatio 未満のときだけ撃てる、コスト 0 の 3 連斬 */
  dregsBlade: {
    cost: 0,
    minInterval: 0.6,
    poise: 8,
    lowRatio: 0.2,
    hits: 3,
    duration: 0.3,
    radius: 30,
    halfAngle: 0.9,
    damage: { base: 5, str: 0.8, spi: 0.4 },
    knockback: 60,
    recover: 0.12,
  },
  /** 影渡り: カーソル近くの敵の背後へ瞬間移動。直後の近接 1 回が背面ヒット */
  shadowStep: {
    cost: 10,
    minInterval: 0.5,
    poise: 0,
    maxRange: 170,
    pickRadius: 44,
    /** 背後へ出る距離の余白 */
    gap: 3,
    backstabTime: 0.6,
    /** 背面ヒットの怯み値の上乗せ（近接 1 回ぶん） */
    backstabPoise: 18,
    invuln: 0.08,
  },
  /** 爆薬樽: 近接で叩くと転がり、射撃・敵弾で撃つとその場で爆発 */
  powderKeg: {
    cost: 12,
    minInterval: 0.4,
    poise: 35,
    maxRange: 100,
    maxAlive: 2,
    life: 14,
    /** 叩き・撃ちの当たり判定 */
    size: 5,
    /** 近接で叩ける距離と、攻撃の向きからの角度（近接の当たり箱のおおよそ） */
    meleeReach: 28,
    meleeHalfAngle: 1.1,
    rollSpeed: 190,
    rollTime: 0.7,
    radius: 40,
    damage: { base: 14, dex: 1.2, spi: 1.2 },
    knockback: 220,
    burnTime: 3,
    burnPotency: 3,
  },
  /** 剣の墓標: 刺した剣が、自分の近接 3 段目の命中に合わせて回転斬り */
  swordGrave: {
    cost: 16,
    minInterval: 0.5,
    poise: 12,
    maxRange: 120,
    maxAlive: 3,
    life: 10,
    radius: 28,
    damage: { base: 5, str: 0.8, spi: 0.6 },
    knockback: 90,
    /** 1 振りで何度も回らないための間隔 */
    spinGap: 0.2,
    spinShow: 0.25,
  },
  /** 砕氷槌: 前方を叩く。凍結を砕くと破片が周りへ冷気 */
  iceBreaker: {
    cost: 16,
    minInterval: 0.6,
    poise: 35,
    radius: 38,
    halfAngle: 0.7,
    damage: { base: 10, str: 1.4, spi: 0.4 },
    knockback: 160,
    chillStacks: 2,
    shardRadius: 44,
    shardDamage: { base: 3, str: 0.4 },
    /** 氷結地帯 → 砕氷槌の連携で足す冷気と範囲倍率 */
    comboChill: 2,
    comboAreaMul: 1.3,
  },
  /** 血抜き: 周囲の出血を全部消費して回復 */
  bloodlet: {
    cost: 12,
    minInterval: 0.6,
    poise: 5,
    radius: 60,
    damage: { base: 4, str: 0.5, spi: 0.5 },
    knockback: 40,
    /** 出血 1 スタック × potency あたりの回復 */
    healPerStack: 3,
    /** 1 回の回復の上限（最大 HP の割合） */
    healCapRatio: 0.15,
  },
  /** 毒の収穫: 命中した敵の毒を消費し、残り時間ぶんのダメージを即時に */
  harvest: {
    cost: 14,
    minInterval: 0.5,
    poise: 6,
    speed: 240,
    life: 0.7,
    radius: 3,
    damage: { base: 4, dex: 0.6, spi: 0.6 },
    knockback: 40,
    bossMul: 0.5,
  },
  /** 放電: 近くの感電中の敵すべてから自分へ雷が戻る。戻り道の敵にもダメージ */
  discharge: {
    cost: 18,
    minInterval: 0.8,
    poise: 15,
    range: 200,
    damage: { base: 8, dex: 0.8, spi: 1.2 },
    /** 感電 1 スタックあたりの威力の上乗せ */
    perStack: 0.25,
    /** 戻り道の線上の敵への威力倍率と線の太さ */
    lineMul: 0.5,
    lineHalfWidth: 6,
    knockback: 0,
  },
  /** 追い討ち: 短刀 3 本。恐怖中の敵は恐怖を消費して怯み値 ×3 */
  rout: {
    cost: 10,
    minInterval: 0.4,
    poise: 6,
    count: 3,
    spreadRad: 0.12,
    speed: 270,
    life: 0.5,
    radius: 3,
    damage: { base: 4, dex: 0.8 },
    knockback: 40,
    fearPoiseMul: 3,
    fearDamageMul: 1.5,
  },
  /** 処断: 沈黙中の敵に大ダメージ（沈黙を消費）。沈黙が無ければ沈黙を付けるだけ */
  verdict: {
    cost: 18,
    minInterval: 0.7,
    poise: 35,
    radius: 36,
    halfAngle: 0.55,
    damage: { base: 18, str: 2, spi: 1.2 },
    /** 沈黙していない敵への威力倍率と怯み値 */
    unsilencedMul: 0.3,
    unsilencedPoise: 10,
    silenceTime: 1.2,
    knockback: 120,
  },
  /** 刺し穿ち: 短い突き。脆弱を消費して会心確定 + 怯み ×2 */
  exploit: {
    cost: 12,
    minInterval: 0.5,
    poise: 20,
    length: 38,
    halfWidth: 7,
    damage: { base: 9, dex: 1, str: 0.6 },
    knockback: 100,
    poiseMul: 2,
  },
  /** 剥奪: 弱体を消費し、消費した秒数だけ自分の与ダメが上がる */
  strip: {
    cost: 12,
    minInterval: 0.5,
    poise: 6,
    speed: 240,
    life: 0.7,
    radius: 3,
    damage: { base: 5, spi: 1 },
    knockback: 40,
    buffMul: 1.2,
    maxBuffTime: 5,
  },
  /** 背水の一閃: 失った HP の割合で威力が伸びる突き。HP が多いとコストが重い */
  lastStand: {
    cost: 16,
    minInterval: 0.7,
    poise: 30,
    length: 46,
    halfWidth: 9,
    damage: { base: 10, str: 1.6 },
    knockback: 180,
    /** 失った HP の割合がこれに達すると最大倍率（HP 30% 以下で ×2.5） */
    fullAt: 0.7,
    maxBonus: 1.5,
    /** この HP 割合以上ではコスト倍率が掛かる */
    heavyCostAt: 0.7,
    heavyCostMul: 1.5,
  },
  /** 連環撃: コンボ 10 ごとに段数 +1 の多段突き。1 段でも外すとコンボが途切れる */
  comboChain: {
    cost: 14,
    minInterval: 0.6,
    poise: 6,
    comboPerStage: 10,
    maxStages: 6,
    gap: 0.07,
    length: 40,
    halfWidth: 7,
    damage: { base: 4, dex: 0.6, str: 0.4 },
    knockback: 30,
  },
  /** 恨み返し: 直近に受けたダメージの合計 × 2 を前方扇へ返す */
  grudge: {
    cost: 16,
    minInterval: 0.7,
    poise: 5,
    window: 3,
    hurtMul: 2,
    /** 受けたダメージ 1 あたりの怯み値の上乗せと上限 */
    poisePerHurt: 0.5,
    maxPoise: 45,
    radius: 50,
    halfAngle: 0.8,
    damage: { base: 4, vit: 0.8, str: 0.6 },
    knockback: 140,
  },
  /** 断頭振り: 溜めて縦に振り下ろす。刃先だけ威力 ×2 */
  guillotine: {
    cost: 18,
    minInterval: 0.7,
    poise: 35,
    windup: 0.3,
    recover: 0.2,
    length: 48,
    halfWidth: 8,
    /** この距離より先（刃先）が強い */
    sweetFrom: 36,
    sweetMul: 2,
    damage: { base: 10, str: 1.8 },
    knockback: 200,
  },
  /** 跳弾: 壁で跳ねるたびに威力が伸びる弾 */
  ricochet: {
    cost: 12,
    minInterval: 0.5,
    poise: 10,
    speed: 220,
    life: 1.3,
    radius: 3,
    bounces: 3,
    bounceBonus: 0.3,
    damage: { base: 7, dex: 1 },
    knockback: 60,
  },
  /** 風切り: 前方へ飛ぶ斬撃。敵弾を相殺し、相殺するたびに射程が伸びる */
  galeSlash: {
    cost: 12,
    minInterval: 0.5,
    poise: 12,
    speed: 200,
    range: 90,
    radius: 8,
    rangePerCut: 20,
    damage: { base: 7, str: 0.8, dex: 0.6 },
    knockback: 90,
  },
  /** 散弾符: 前方へ 7 発の扇。1 体に 5 発以上当てると怯み値が上乗せ */
  scatterSigil: {
    cost: 14,
    minInterval: 0.6,
    poise: 4,
    count: 7,
    fanRad: 0.7,
    speed: 240,
    life: 0.35,
    radius: 2.5,
    damage: { base: 2.5, dex: 0.5 },
    knockback: 30,
    focusHits: 5,
    /** 集中したときの怯み値の上乗せ（1 発の怯み値 × この数） */
    focusPoiseMul: 5,
  },
  /** 震脚: 足元に衝撃。周囲に高い怯み値、足元の敵弾を消す。自分は少し動けない */
  stomp: {
    cost: 14,
    minInterval: 0.8,
    poise: 40,
    radius: 40,
    damage: { base: 3, str: 0.5, vit: 0.5 },
    knockback: 160,
    root: 0.3,
    /** 手繰り糸 → 震脚の連携の怯み値・範囲の倍率 */
    comboPoiseMul: 1.5,
    comboAreaMul: 1.3,
  },
  /** 手繰り糸: カーソルから自分へ糸を張り、少し後に巻き取って糸に触れた敵を手前へ引く */
  threadReel: {
    cost: 14,
    minInterval: 0.7,
    poise: 8,
    maxRange: 130,
    delay: 0.3,
    halfWidth: 6,
    gap: 3,
    recover: 0.15,
    damage: { base: 4, str: 0.5, dex: 0.5 },
    weakenTime: 3,
  },
  /** 墜星: 跳び上がり、少し後にカーソル地点へ落下して範囲攻撃 */
  meteorDive: {
    cost: 22,
    minInterval: 1,
    poise: 45,
    maxRange: 130,
    air: 0.4,
    radius: 40,
    damage: { base: 16, str: 1.6, spi: 1.2 },
    knockback: 220,
  },
  /** 燕返し（CD 型）: カーソル方向へ跳び、着地の瞬間に元の位置へ斬撃が戻る */
  swallowFlip: {
    cooldown: 5,
    minInterval: 0.3,
    poise: 15,
    distance: 70,
    time: 0.12,
    hitPad: 8,
    halfWidth: 8,
    damage: { base: 6, str: 0.8, dex: 0.8 },
    knockback: 120,
  },
  /** 骨片の輪（CD 型）: 自分の周りを骨片が回り、敵弾を 1 発ずつ止める */
  boneRing: {
    cooldown: 10,
    minInterval: 0.3,
    bones: 3,
    duration: 6,
    orbit: 16,
    spin: 3,
    catchRadius: 4,
  },
  /** 巻き戻し（CD 型）: 少し前にいた位置へ戻り、その間に受けたダメージの一部を取り戻す */
  backflow: {
    cooldown: 12,
    minInterval: 0.3,
    poise: 5,
    rewind: 1.5,
    record: 0.1,
    healRatio: 0.4,
    halfWidth: 8,
    damage: { base: 4, dex: 0.6, vit: 0.6 },
    knockback: 60,
    invuln: 0.15,
  },
  /** 傷返し（CD 型）: 自分の状態異常をすべて剥がし、周囲の敵へ付け、種類ごとに衝撃 */
  scarRoar: {
    cooldown: 10,
    minInterval: 0.3,
    /** 1 種あたりの怯み値（0 種でも 1 種ぶん） */
    poise: 10,
    radius: 56,
    damage: { base: 4, vit: 0.6, spi: 0.6 },
    knockback: 140,
    /** 敵へ写す持続の下限 */
    minDuration: 2,
  },
  /** 湧き石（CD 型）: 足元の石の半径内で、近接の命中ごとにマナが余分に戻る */
  manaSpring: {
    cooldown: 14,
    minInterval: 0.3,
    duration: 6,
    radius: 40,
    /** 近接 1 命中ごとの追加マナ（manaGainMul は gainMana が掛ける） */
    manaPerHit: 2,
  },
  /** 砲台: 自分が射撃するたび、砲台もカーソル方向へ 1 発撃つ */
  turret: {
    cost: 18,
    minInterval: 0.6,
    poise: 3,
    maxRange: 100,
    maxAlive: 2,
    life: 8,
    speed: 240,
    shotLife: 0.8,
    radius: 2.5,
    damage: { base: 3, dex: 0.6, spi: 0.4 },
    knockback: 30,
    /** 照準の遠さ（自分の向きのこの先を狙う） */
    aimReach: 200,
  },
} as const;

/** 大拡張の刻印符の数値（SKILL.modifier に展開する） */
export const EXTRA_MODIFIER_TUNING = {
  deferred: { delay: 1.5, costMul: 1.3, hpPerMana: 0.004 },
  refund: { perHit: 0.12, cap: 0.6, damageMul: 0.85 },
  bloodTithe: { costMul: 1.1, hpPerMana: 0.003 },
  spillover: { fullMul: 1.5, otherMul: 0.9 },
  dryFire: { lowRatio: 0.3, damageMul: 1.5, costMul: 1.3 },
  bladeFeed: { window: 2, costMul: 0.6, missMul: 1.2 },
  timeLock: { cooldownPerCost: 0.3, intervalMul: 1.5 },
  fuelize: { costPerCooldown: 5 },
  overheat: { stepMul: 0.75, maxStacks: 3, lockTime: 2, window: 2 },
  heavy: { poiseMul: 2, damageMul: 0.8, intervalMul: 1.5 },
  feather: { burdenMul: 0.6 },
  repel: { knockbackMul: 2.5, damageMul: 0.85 },
  tether: { damageMul: 0.9 },
  linger: { durationMul: 2, damageMul: 0.8 },
  spread: { radius: 60, durationMul: 0.5 },
  followUp: { time: 1.5, powerRatio: 0.3, damageMul: 0.9 },
  lastGasp: { damageMul: 0.3, burdenMul: 1.2, maxPerCast: 3, delay: 0.12 },
  sustain: { durationMul: 1.6, potencyMul: 0.8 },
  landing: { radius: 30, poise: 15, burdenMul: 1.15, damage: { base: 3, str: 0.4 }, knockback: 100 },
  desperate: { hpRatio: 0.5, lowMul: 1.4, highMul: 0.9 },
  attune: { matchMul: 1.3, missMul: 0.85 },
  cycle: { freshMul: 0.5, repeatMul: 1.3 },
  flank: { backMul: 1.5, frontMul: 0.8 },
  pointBlank: { range: 40, nearMul: 1.5, farMul: 0.7 },
  longshot: { range: 150, nearMul: 0.6, farMul: 1.6 },
  toThrown: { flight: 0.3, knockbackMul: 0.5 },
  toLobbed: { durationMul: 0.3, timeMul: 0.3, damageMul: 1.2 },
  /** 段階溜め: 各段に達する秒と、2 段目・3 段目の倍率。溜め中の移動倍率 */
  toStaged: {
    stages: [0.4, 0.9, 1.5],
    stage2: { areaMul: 1.5, damageMul: 1.2 },
    stage3: { areaMul: 1.5, damageMul: 1.3, countBonus: 2, pierce: 2 },
    moveMul: 0.5,
  },
  /** 型替え符のリンク消費と、刻印符の抽選で型替え符を引く重み（通常の刻印符は 1） */
  reshapeLinkCost: 2,
  reshapeWeight: 0.25,
} as const;

/** 連携（docs/ideas/skills-expansion.md 4 章）の受付秒と効果の数値 */
export const COMBO_TUNING = {
  wellThunder: { window: 2.5, shockBonus: 1 },
  hookWhirl: { window: 0.8, areaMul: 1.2 },
  parryRail: { window: 1, damageMul: 1.5, aimMul: 0 },
  diveQuake: { window: 0.6, windupMul: 0.05, areaMul: 1.2 },
  contagionUnravel: { window: 1.5 },
  pactWhirl: { window: 4, bleedStacks: 1, bleedTime: 4, bleedPotency: 1 },
  frostBreaker: { window: 3 },
  shadowExploit: { window: 0.8 },
  hasteSpiral: { window: 3 },
  reelStomp: { window: 1 },
  color: "#ffe070",
  textScale: 1,
  textLife: 0.7,
} as const;
