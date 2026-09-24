/**
 * スキル第 2 弾（地形・新しい状態異常・属性・武器種・ジョブ・変身・空間）の数値。
 * data.ts の SKILL に展開して読む（SKILL.waterJar など）ので、ロジックからは SKILL 経由で参照する。
 *
 * 目安は tuning.ts と同じ: マナ型のコスト 11〜22（マナ型全体の平均を既存の水準 16〜17 に保ち、満タンから 3〜4 発に揃える。
 * system/mana.test.ts が平均を見ている）、単発の主力は基礎値で 20〜30、状態異常や地形を「出す」技は
 * 素の威力を低くし、出したものを「食う」技（烙火・瞬凍・色解き・崩落槌）が伸びる形に揃える。
 */

import { STATUS } from "../data/tuning";

export const WAVE2_SKILL_TUNING = {
  // ---- 地形を作る・壊す・燃やす ----
  /** 水瓶: カーソル地点で割れて水たまり + 濡れ。炎の床は水で消える */
  waterJar: {
    cost: 14,
    minInterval: 0.5,
    poise: 5,
    maxRange: 120,
    radius: 32,
    terrainRadius: 24,
    terrainTime: 8,
    damage: { base: 3, spi: 0.6, mnd: 0.4 },
    knockback: 40,
    wetStacks: 2,
  },
  /** 油流し: カーソル地点に油を流し、敵に油膜。火が入ると燃え広がる */
  oilPot: {
    cost: 13,
    minInterval: 0.5,
    poise: 4,
    maxRange: 120,
    radius: 32,
    terrainRadius: 28,
    terrainTime: 10,
    damage: { base: 2, str: 0.3, spi: 0.3 },
    knockback: 20,
  },
  /** 焼き払い: 前方へ炎の帯。通り道の床を炎にする（油・草は燃え広がる） */
  scorchLine: {
    cost: 19,
    minInterval: 0.7,
    poise: 10,
    length: 90,
    halfWidth: 8,
    /** 炎の床を置き始める距離（自分の足元を燃やさない）・間隔・半径・持続 */
    fireStart: 16,
    fireStep: 12,
    fireRadius: 6,
    fireTime: 3,
    damage: { base: 6, spi: 1.2, mnd: 0.6 },
    knockback: 60,
    burnPotency: 3,
  },
  /** 凍て道（CD 型）: カーソル方向へ滑り、通った床を氷床にする */
  iceSlide: {
    cooldown: 7,
    minInterval: 0.3,
    poise: 12,
    distance: 80,
    time: 0.22,
    hitPad: 6,
    iceRadius: 8,
    iceTime: 4,
    iceStep: 10,
    damage: { base: 4, str: 0.6, dex: 0.6 },
    knockback: 90,
  },
  /** 地均し: 前方の床の地形を砕いて消し、砕いた数だけ強く打つ（溶岩は砕けない） */
  levelGround: {
    cost: 19,
    minInterval: 0.7,
    poise: 30,
    length: 100,
    halfWidth: 9,
    /** 地形を探る間隔（px）と、1 か所で消す半径 */
    probeStep: 8,
    clearRadius: 6,
    /** 砕いた 1 マスごとの威力の上乗せと上限 */
    perCell: 0.08,
    maxBonus: 0.8,
    damage: { base: 6, str: 1.2, vit: 0.8 },
    knockback: 160,
  },
  /** 火吸い: 周りの炎の床と自分の燃焼を吸い込み、吸った数だけ大きな火球を撃つ */
  emberDraw: {
    cost: 15,
    minInterval: 0.5,
    poise: 8,
    drawRadius: 48,
    perCell: 0.15,
    maxBonus: 2,
    /** 自分の燃焼を吸ったとき何マスぶんに数えるか */
    selfBurnCells: 2,
    speed: 200,
    life: 0.8,
    radius: 4,
    radiusPerCell: 0.5,
    maxRadius: 10,
    damage: { base: 4, spi: 1, mnd: 0.5 },
    knockback: 80,
    burnPotency: 3,
  },
  /** 沼呼び: カーソル地点に毒沼を湧かせる */
  bogCall: {
    cost: 20,
    minInterval: 0.8,
    poise: 0,
    maxRange: 120,
    radius: 32,
    terrainRadius: 32,
    terrainTime: 6,
    damage: { base: 2, spi: 0.6, mnd: 0.3 },
    knockback: 0,
  },
  // ---- 新しい状態異常を出す・食う ----
  /** 焼き印: 前方を焼きつけて烙印 2 */
  brandSear: {
    cost: 14,
    minInterval: 0.5,
    poise: 10,
    radius: 32,
    halfAngle: 0.7,
    damage: { base: 5, str: 0.8, spi: 0.5 },
    knockback: 60,
    brandStacks: 2,
  },
  /** 烙火: 照準の周りの烙印を倍にしてから起爆する */
  brandBlast: {
    cost: 18,
    minInterval: 0.6,
    poise: 10,
    maxRange: 140,
    radius: 48,
    damage: { base: 4, spi: 0.8, mnd: 0.4 },
    /** 烙印の無い敵への威力倍率 */
    plainMul: 0.4,
    knockback: 80,
    /** 焼き印 → 烙火の連携で足す烙印 */
    comboStacks: 2,
  },
  /** 崩し蹴り: 怯み値の高い蹴りで崩勢。崩勢中の敵は壁まで吹き飛ぶ */
  breakKick: {
    cost: 13,
    minInterval: 0.5,
    poise: 28,
    length: 30,
    halfWidth: 9,
    damage: { base: 5, str: 0.8, dex: 0.4 },
    knockback: 220,
  },
  /** 崩落槌: 崩勢中の敵を即座に怯ませる（崩勢の効果で長く、解けても堅守が付かない） */
  collapseHammer: {
    cost: 19,
    minInterval: 0.7,
    poise: 35,
    radius: 38,
    halfAngle: 0.8,
    damage: { base: 9, str: 1.5, vit: 0.5 },
    brokenMul: 1.3,
    knockback: 140,
  },
  /** 水刃: 前方へ飛ぶ水の斬撃。濡れ 2 */
  tideSlash: {
    cost: 14,
    minInterval: 0.5,
    poise: 10,
    speed: 200,
    life: 0.5,
    radius: 6,
    pierce: 1,
    damage: { base: 5, dex: 0.8, str: 0.4 },
    knockback: 70,
    wetStacks: 2,
  },
  /** 瞬凍: 周りの濡れた敵を凍らせ、水たまりを氷床に変える */
  flashFreeze: {
    cost: 19,
    minInterval: 0.7,
    poise: 15,
    radius: 56,
    damage: { base: 4, spi: 0.8, mnd: 0.5 },
    knockback: 40,
    /** 凍結の秒 = base + 濡れ 1 スタックごとに perStack */
    freezeBase: 0.8,
    freezePerStack: 0.3,
    /** 地形を探る間隔（px） */
    probeStep: 8,
    iceTime: 6,
    /** 水瓶 → 瞬凍の連携の範囲と凍結の倍率 */
    comboAreaMul: 1.4,
    comboFreezeMul: 1.5,
  },
  /** 彩刻: 前方を斬り、装備の共鳴の色の彩痕を刻む */
  hueEtch: {
    cost: 15,
    minInterval: 0.5,
    poise: 8,
    radius: 34,
    halfAngle: 0.8,
    damage: { base: 5, str: 0.6, spi: 0.6 },
    knockback: 60,
  },
  /** 色解き: 照準の周りの彩痕を、色に対応する状態異常で弾けさせる（色爆） */
  hueRelease: {
    cost: 18,
    minInterval: 0.6,
    poise: 12,
    maxRange: 140,
    radius: 50,
    damage: { base: 4, spi: 0.8, mnd: 0.4 },
    hueMul: 1.5,
    knockback: 60,
    burnPotency: 3,
    shockPotency: 2,
    vulnerableTime: 3,
    /** 彩刻 → 色解きの連携の範囲倍率 */
    comboAreaMul: 1.5,
  },
  /** 吸魔の矢: 当てた敵に吸魔（命中でマナ、倒すと残り秒ぶんのマナ） */
  siphonMark: {
    cost: 11,
    minInterval: 0.5,
    poise: 4,
    speed: 230,
    life: 0.7,
    radius: 3,
    damage: { base: 3, spi: 0.6, mnd: 0.4 },
    knockback: 30,
  },
  /** 死の宣告: 照準の敵とその周りに宣告（切れたとき、付けてから減った HP の一部をまとめて与える） */
  doomSentence: {
    cost: 18,
    minInterval: 0.8,
    poise: 6,
    maxRange: 150,
    pickRadius: 40,
    radius: 24,
    damage: { base: 4, spi: 0.8, mnd: 0.4 },
    knockback: 0,
  },
  // ---- 属性・武器種 ----
  /** 移ろい刃: 撃つたびに属性が 炎 → 氷 → 雷 → 毒 と巡る斬撃 */
  shiftingEdge: {
    cost: 15,
    minInterval: 0.5,
    poise: 10,
    radius: 34,
    halfAngle: 0.8,
    damage: { base: 6, str: 0.8, spi: 0.6 },
    knockback: 70,
    burnPotency: 3,
    shockPotency: 2,
  },
  /** 極意: 装備中の武器種で形が変わる（形の数値は WEAPON_ART） */
  weaponArt: {
    cost: 22,
    minInterval: 0.8,
    poise: 25,
    damage: { base: 10, str: 1.4, spi: 0.6 },
    knockback: 120,
  },
  // ---- 変身（CD 型。一定秒だけ武器種が変わり、切れた後は少し遅くなる） ----
  /** 剛の型: 大剣になる */
  titanForm: {
    cooldown: 18,
    minInterval: 0.3,
    poise: 30,
    duration: 6,
    radius: 44,
    damage: { base: 6, str: 1, vit: 0.6 },
    knockback: 200,
  },
  /** 迅の型: 双剣になる */
  swiftForm: {
    cooldown: 16,
    minInterval: 0.3,
    poise: 12,
    duration: 6,
    radius: 32,
    damage: { base: 4, dex: 0.8, str: 0.4 },
    knockback: 90,
  },
  /** 霊の型: 杖になる */
  spiritForm: {
    cooldown: 16,
    minInterval: 0.3,
    poise: 15,
    duration: 6,
    radius: 40,
    damage: { base: 4, spi: 0.8, mnd: 0.4 },
    knockback: 120,
  },
  // ---- 空間 ----
  /** 結界杭: カーソル地点に杭（最大 3）。杭同士を結ぶ線に触れた敵へ周期ダメージ、3 本の内側は脆弱 */
  wardStake: {
    cost: 15,
    minInterval: 0.4,
    poise: 3,
    maxRange: 120,
    maxAlive: 3,
    life: 8,
    tickEvery: 0.5,
    lineHalfWidth: 4,
    damage: { base: 2, dex: 0.3, spi: 0.4 },
    knockback: 0,
    vulnerableTime: 0.8,
  },
  // ---- 第 4 弾（見送っていた泥沼） ----
  /**
   * 泥沼: カーソル地点に泥（中の敵は歩きも突進も遅い）。中にいる敵へ tickEvery ごとに怯み値。
   * 燃焼が入ると泥が固まって中の敵が麻痺する（system/terrain.ts の bakeMud）
   */
  mire: {
    cost: 18,
    minInterval: 0.8,
    poise: 0,
    maxRange: 120,
    radius: 30,
    terrainRadius: 30,
    terrainTime: 4,
    damage: { base: 1, spi: 0.3, vit: 0.3 },
    knockback: 0,
    tickEvery: 0.5,
    tickDamage: { base: 0.5, spi: 0.1, vit: 0.2 },
    tickPoise: 7,
  },
} as const;

/** 変身の共通: 変身先の武器種がジョブの得意なら持続を伸ばす / 切れた後の移動倍率と秒 */
export const FORM_TUNING = {
  favoredDurationMul: 1.3,
  recoverTime: 1,
  recoverMoveMul: 0.7,
} as const;

/** 極意の形（武器種ごと）。cone = 扇 / circle = 自分の周り / thrust = 突き / tip = 先端だけ強い突き / shots = 魔弾 */
export const WEAPON_ART = {
  sword: { kind: "cone", name: "十文字", radius: 36, halfAngle: 0.9, hits: 2, mul: 0.6 },
  greatsword: { kind: "circle", name: "大車輪", radius: 44, hits: 1, mul: 1.4 },
  twinBlades: { kind: "thrust", name: "乱れ突き", length: 40, halfWidth: 7, hits: 5, mul: 0.3 },
  spear: { kind: "thrust", name: "槍衾", length: 72, halfWidth: 6, hits: 1, mul: 1.2 },
  scythe: { kind: "cone", name: "大刈り", radius: 48, halfAngle: 1.2, hits: 1, mul: 0.9, pull: true },
  fists: { kind: "thrust", name: "猛打", length: 26, halfWidth: 9, hits: 4, mul: 0.35 },
  whip: { kind: "tip", name: "先端打ち", length: 80, halfWidth: 5, tipFrom: 0.75, tipMul: 1.6, mul: 0.5 },
  cleaver: { kind: "cone", name: "唐竹割り", radius: 34, halfAngle: 0.5, hits: 1, mul: 1.3, bleed: 2 },
  staff: { kind: "circle", name: "大回し", radius: 40, hits: 1, mul: 1, knockbackMul: 1.8 },
  wand: { kind: "shots", name: "魔弾", count: 3, spreadRad: 0.2, speed: 220, life: 0.6, radius: 3, mul: 0.5 },
  // 2026-09-24 レーン B の武器種（docs/ideas/combat-feel-design.md 5 章）
  katana: { kind: "thrust", name: "一閃", length: 60, halfWidth: 5, hits: 1, mul: 1.3 },
  axe: { kind: "cone", name: "大斧振り", radius: 40, halfAngle: 1, hits: 1, mul: 1.1, bleed: 2 },
  shield: { kind: "circle", name: "盾撃", radius: 36, hits: 1, mul: 0.9, knockbackMul: 2 },
  chainSickle: { kind: "tip", name: "鎖返し", length: 76, halfWidth: 5, tipFrom: 0.7, tipMul: 1.5, mul: 0.5 },
  hammer: { kind: "circle", name: "大地割り", radius: 50, hits: 1, mul: 1.5 },
  gunner: { kind: "shots", name: "乱れ撃ち", count: 5, spreadRad: 0.25, speed: 240, life: 0.6, radius: 2, mul: 0.35 },
} as const;

/** 極意の出血（鉈）の持続と 10px あたりダメージ */
export const WEAPON_ART_BLEED = { duration: STATUS.bleed.duration, potency: 1 } as const;

/** 第 2 弾の刻印符の数値（SKILL.modifier に展開する） */
export const WAVE2_MODIFIER_TUNING = {
  /** 属性の刻印符: 属性を差し替え、命中で状態異常を 1 つ付ける。威力は少し下がる */
  fireInfuse: { damageMul: 0.9, burnPotency: 2, burnTime: 3 },
  iceInfuse: { damageMul: 0.9, chillStacks: 1 },
  stormInfuse: { damageMul: 0.9, shockPotency: 2 },
  venomInfuse: { damageMul: 0.9, poisonStacks: 1 },
  /** 揺さぶり: 命中で崩勢 */
  breakInfuse: { damageMul: 0.85 },
  /** 彩り: 命中で共鳴の色の彩痕 */
  hueInfuse: { damageMul: 0.9 },
  /** 地崩れ（地裂き専用）: 命中した敵までの線（+ extend px 先まで）に崩れる床を time 秒 */
  crumble: { burdenMul: 1.2, time: 5, extend: 16, step: 8 },
  /** 地染め: 命中した位置に属性の地形（1 回の発動で maxPerCast か所まで） */
  leyline: { burdenMul: 1.15, radius: 10, time: 4, maxPerCast: 3 },
  /** 心得: ジョブの得意な武器種を持っていれば強い */
  jobMastery: { favoredMul: 1.3, otherMul: 0.85 },
  /** 武器写し: 属性を近接の武器に揃える。武器が無属性なら素の冴えで威力が伸びる */
  weaponBond: { plainMul: 1.15 },
  /**
   * 化身: 変身中は強い。1.35 → 1.3（2026-09-24 第 3 弾の変身と合わせた見直し）: 武器写し（無属性 x1.15）と積むと
   * 1.35 × 1.15 ≈ 1.55 で 1.5 を超えていたので、積んでも 1.5 以内（1.3 × 1.15 ≈ 1.50）に収める
   */
  formSurge: { formMul: 1.3, otherMul: 0.9 },
  /** 深化: 変身の持続と、切れた後の反動がどちらも伸びる */
  formLinger: { durationMul: 1.5, recoverMul: 1.5, burdenMul: 1.2 },
  /** 自己中心化（型替え）: 照準地点ではなく自分の足元で起きる */
  toNova: { areaMul: 1.3 },
  /** 罠化（型替え）: カーソル地点に罠。敵が踏むと罠の位置から最寄りの敵へ向けて発動 */
  toTrap: { arm: 0.5, life: 12, trigger: 18, maxAlive: 3, damageMul: 1.1 },
} as const;

/** 第 2 弾の連携の受付秒と効果 */
export const WAVE2_COMBO_TUNING = {
  waterFreeze: { window: 2.5 },
  oilScorch: { window: 3, lengthMul: 1.5, damageMul: 1.2 },
  brandChain: { window: 2 },
  breakCollapse: { window: 1.5, areaMul: 1.3, poiseMul: 1.5 },
  hueBloom: { window: 2 },
  /** 空間: 引力球の中へ投げたグレネードは球の中心で、範囲 ×areaMul で爆ぜる */
  wellFrag: { window: 6, areaMul: 1.3 },
  /** 空間: 氷結地帯の中へ落とした雷撃は、地帯の中の敵すべてへ落ちる */
  frostThunder: { window: 6 },
  /** 変身中の極意（時間は見ない） */
  formArt: { window: 0, damageMul: 1.4 },
  levelMeteor: { window: 2, areaMul: 1.3 },
} as const;

/**
 * スキル石の使い込み（docs/ideas/skills-expansion.md 5 章）。発動回数の節目で芽が 1 つ出る。
 * 1 発で多くに当てる使い方の石は「威力」、撃ち続けた石（命中が少ない・強化）は「枠」（刻印符のリンク +1）の芽になる。
 * 芽は石ごとに milestones の数まで、枠の芽は maxBonusLinks まで（それ以降の枠の芽は威力に替わる）
 */
export const WEAR_TUNING = {
  milestones: [40, 160],
  spreadHitsPerCast: 1.5,
  powerPerBud: 0.1,
  maxBonusLinks: 1,
  color: "#c0f080",
} as const;
