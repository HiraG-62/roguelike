import type { StatusApply } from "../core/status";
import { STATUS } from "../data/tuning";
import { EXTRA_SKILL_DEFS } from "./defs";
import { EXTRA_MODIFIERS, RESOURCE_CONVERTERS } from "./modifiers";
import { EXTRA_MODIFIER_TUNING, EXTRA_SKILL_TUNING } from "./tuning";
import type {
  BASE_MODIFIER_KEYS,
  BASE_SKILL_KEYS,
  CastParams,
  ModifierDef,
  ModifierKey,
  SkillDef,
  SkillKey,
  SkillResource,
  SkillStone,
  VariantAxis,
  VariantRoll,
} from "./types";

type BaseSkillKey = (typeof BASE_SKILL_KEYS)[number];
type BaseModifierKey = (typeof BASE_MODIFIER_KEYS)[number];

/** 割合 → % 表記 */
const PERCENT_UNIT = 100;

/**
 * スキルの数値。docs/ideas/skills.md「7-5」、docs/COMBAT_DESIGN.md B-2 / B-4。
 * damage は Scaling（base + 係数 × ステータス実効値）。ステータスが基礎値（各 5）のとき旧来の固定値と一致する
 *
 * マナ型（resource: "mana"）スキル全種は QA 2026-09-23 時点でスキル由来与ダメ比率 33.4%（目標 55〜65%）と
 * 未達だったため、以下 2 点を一律で適用した（bot 側は射程判定の不具合も同時に修正済み、別途 src/qa/bot.ts 参照）。
 * - cost（マナコスト）を一律 ×0.85（-15%）: 発動頻度を上げてスキル比重を増やす
 * - damage.base を一律 ×1.15（+15%）: 前回サイクルの +10% と合わせて元の値から約 +26%
 */
export const SKILL = {
  slots: 4,
  /** 共通最低間隔: どのスキルを撃った後も全スロット共通でこの秒は撃てない */
  gcd: 0.15,
  /** マナ不足の不発で HUD のマナバーを点滅させる秒 */
  manaFlashTime: 0.3,
  /** リンク 1 本ごとに足す負担の割合（マナ型はコスト、CD 型は CD） */
  linkBurdenPenalty: 0.15,
  maxLinks: 3,
  /** リンク数 0..3 の重み */
  linkWeights: [30, 45, 20, 5],
  /** 変異軸の本数 0..2 の重み */
  variantCountWeights: [35, 45, 20],
  /** 変異値の丸め（0.01 刻み） */
  variantPrecision: 100,
  /** ダッシュ中・近接中に押したスキルを保持する秒 */
  inputBuffer: 0.25,
  notReadyTextInterval: 0.6,
  stashCapacity: 60,
  // ---- マナ型は cost / minInterval、CD 型は cooldown / minInterval。poise は 1 ヒットの基礎怯み値 ----
  whirl: {
    cost: 15.3, // 18 → 15.3（-15%）
    minInterval: 0.6,
    poise: 6,
    duration: 0.45,
    hits: 4,
    radius: 28,
    damage: { base: 3.8, str: 0.4, spi: 0.4 }, // base 3.3 → 3.8（+15%、通算 +26%）
    knockback: 60,
    moveMul: 0.6,
    recover: 0.15,
  },
  lunge: {
    cooldown: 3,
    minInterval: 0.3,
    poise: 20,
    distance: 90,
    time: 0.14,
    hitPad: 10,
    damage: { base: 8, str: 1, dex: 0.6 },
    knockback: 200,
    wallStun: 0.25,
    comboLinkWindow: 0.3,
  },
  frag: {
    cost: 18.7, // 22 → 18.7（-15%）
    minInterval: 0.5,
    poise: 30,
    maxRange: 120,
    flight: 0.35,
    fuse: 0.5,
    radius: 36,
    damage: { base: 15.2, dex: 1.4, spi: 1.4 }, // base 13.2 → 15.2（+15%）
    knockback: 240,
    selfDamageFraction: 0.1,
    spread: 14,
    wallProbe: 2,
  },
  railshot: {
    cost: 21.3, // 25 → 21.3（-15%）
    minInterval: 0.8,
    poise: 25,
    aim: 0.35,
    damage: { base: 17.7, dex: 2, spi: 1.2 }, // base 15.4 → 17.7（+15%）
    knockback: 180,
    recoil: 120,
    stepPx: 2,
    maxLength: 400,
    halfWidth: 3,
    /** 照準中のダッシュキャンセルで、払ったマナのこの割合を返す */
    cancelRefund: 0.5,
    spreadRad: 0.1,
    /** 命中した敵を脆弱にする秒 */
    vulnerableTime: 3,
  },
  /** パリィ（CD 型）。窓・失敗硬直・成功時の CD 回復は docs/COMBAT_DESIGN.md C-1 の 7 */
  parry: {
    cooldown: 3.5,
    minInterval: 0.3,
    poise: 40,
    window: 0.16,
    failLock: 0.45,
    /** 成功時に戻す CD の割合 */
    successRefund: 0.5,
    radius: 40,
    damage: { base: 6, str: 0.6, spi: 0.6 },
    knockback: 260,
    catchPad: 4,
  },
  bloodPact: { cooldown: 12, minInterval: 0.3, hpFraction: 0.12, duration: 4, speedMul: 1.35, lifesteal: 0.08 },
  /** 地裂き: 溜めて前方扇に衝撃波。溜め中の被弾で中断（マナは消費済み） */
  quake: {
    cost: 20.4, // 24 → 20.4（-15%）
    minInterval: 0.6,
    poise: 45,
    windup: 0.35,
    recover: 0.2,
    radius: 56,
    halfAngle: 0.6,
    damage: { base: 12.7, str: 1.6, spi: 0.8 }, // base 11 → 12.7（+15%）
    knockback: 220,
  },
  /** 雷撃: カーソル地点に遅れて落雷、中心の敵から連鎖雷。命中した敵に感電 */
  thunder: {
    cost: 17, // 20 → 17（-15%）
    minInterval: 0.5,
    poise: 15,
    maxRange: 140,
    delay: 0.5,
    radius: 22,
    damage: { base: 12.7, dex: 1.2, spi: 1.6 }, // base 11 → 12.7（+15%）
    shockMul: 0.5,
    extraGap: 0.12,
    extraOffset: 22,
    shockStacks: 2,
    /** 感電の連鎖 1 回のダメージ（状態異常の potency） */
    shockPotency: 3,
  },
  /** 引力球: 範囲の敵（と敵弾）を中心へ引き、最後に弾ける。引き寄せ中の敵は沈黙 */
  gravityWell: {
    cost: 25.5, // 30 → 25.5（-15%）
    minInterval: 1,
    /** 破裂の怯み値（tick は 0） */
    poise: 20,
    maxRange: 120,
    duration: 2,
    radius: 50,
    pull: 70,
    core: 6,
    tickEvery: 0.5,
    tickDamage: { base: 1.3, spi: 0.4 }, // base 1.1 → 1.3（+15%）
    burstDamage: { base: 10.1, spi: 2 }, // base 8.8 → 10.1（+15%）
    burstKnockback: 80,
    /** tick ごとに付け直す沈黙の秒（tick 間隔より少し長く、引いている間は切れない） */
    silenceTime: 0.6,
  },
  /** 地雷: 足元に設置、起動後に敵が踏むと爆発 */
  mines: {
    cost: 10.2, // 12 → 10.2（-15%）
    minInterval: 0.3,
    poise: 25,
    arm: 0.4,
    life: 20,
    maxAlive: 3,
    trigger: 10,
    radius: 30,
    damage: { base: 10.1, dex: 1.2, spi: 1.2 }, // base 8.8 → 10.1（+15%）
    knockback: 160,
  },
  /** 加速: ダッシュ CD 0 + 移動速度。切れた後はダッシュ不可 */
  haste: { cooldown: 11, minInterval: 0.3, duration: 3, moveBonus: 0.3, exhaust: 1.5 },
  /** 鎖鎌: 鎖を伸ばし、刺さった敵を手元へ引き寄せる（ボスなら自分が飛ぶ）。命中した敵に出血 */
  chainHook: {
    cost: 11.9, // 14 → 11.9（-15%）
    minInterval: 0.5,
    poise: 15,
    range: 110,
    extendTime: 0.18,
    recover: 0.25,
    hitPad: 3,
    damage: { base: 7.6, str: 1, dex: 0.6 }, // base 6.6 → 7.6（+15%）
    knockback: 40,
    landGap: 2,
    bleedStacks: 1,
    bleedTime: 4,
    /** 出血の 10px あたりダメージ（状態異常の potency） */
    bleedPotency: 1,
  },
  /** 回転弾幕: 自分中心に螺旋状の弾。発射中は移動 40%、近接・射撃不可 */
  spiral: {
    cost: 23.8, // 28 → 23.8（-15%）
    minInterval: 1.1,
    poise: 2,
    duration: 1,
    bullets: 24,
    bulletsPerCount: 4,
    arms: 2,
    turns: 2,
    speed: 160,
    life: 0.6,
    radius: 2.5,
    damage: { base: 2.5, dex: 0.3, spi: 0.3 }, // base 2.2 → 2.5（+15%）
    knockback: 30,
    moveMul: 0.4,
  },
  /** 氷結地帯: 中の敵を chill + 継続ダメージ。自分も中では遅くなる */
  frostField: {
    cost: 22.1, // 26 → 22.1（-15%）
    minInterval: 0.8,
    poise: 0,
    maxRange: 110,
    duration: 3,
    radius: 40,
    tickEvery: 0.5,
    tickDamage: { base: 1.3, spi: 0.6 }, // base 1.1 → 1.3（+15%）
    slow: 0.5,
    maxSlow: 0.8,
    chillTime: 0.6,
    selfMoveMul: 0.8,
  },
  modifier: {
    /** CD 型: チャージ +2・負担 ×1.3。マナ型: コスト ×0.6・最低間隔 ×0.5。どちらも威力 ×0.7 */
    multiCharge: { extraCharges: 2, damageMul: 0.7, burdenMul: 1.3, manaBurdenMul: 0.6, intervalMul: 0.5 },
    /** マナ型は血でマナを肩代わりしてコスト ×0.5 */
    bloodPrice: { hpFraction: 0.06, damageMul: 1.6, potencyMul: 1.6, manaBurdenMul: 0.5 },
    comboFuel: { perStack: 0.04, cap: 1.2, emptyMul: 0.8 },
    echo: { delay: 0.8, damageMul: 0.5, burdenMul: 1.25 },
    pierce: { count: 3, areaMul: 0.8 },
    recoil: { speed: 220, invuln: 0.1, damageMul: 0.85 },
    /** CD 型: 撃破でチャージ +1・負担 ×1.35。マナ型: 撃破でコストの manaRefund を返す・負担 ×1.2 */
    chainReset: { burdenMul: 1.35, manaBurdenMul: 1.2, manaRefund: 0.5 },
    curse: { duration: 4, bonus: 0.35, damageMul: 0.85 },
    delay: { time: 0.8, damageMul: 1.8 },
    expand: { areaMul: 1.5, burdenMul: 1.4 },
    /** 溜め: 離した瞬間に発動。押していた秒数(0..maxTime)に応じて威力・範囲が伸びる */
    charge: { maxTime: 1.2, minTime: 0.15, maxDamageMul: 2.2, maxAreaMul: 1.5, moveMul: 0.6 },
    // 大拡張の刻印符・型替え符（skills/tuning.ts）
    ...EXTRA_MODIFIER_TUNING,
  },
  // 大拡張のスキル（skills/tuning.ts）
  ...EXTRA_SKILL_TUNING,
  drop: {
    stoneOnKill: 0.03,
    stoneOnDepth: 0.2,
    runeOnRoomClear: 0.3,
    stoneColor: "#b080ff",
    runeColor: "#ffb040",
    /** 部屋中央の装備報酬と重ならないようずらす */
    runeOffsetX: 14,
    depthOffsetY: 14,
    pickupRadius: 8,
    pickupDelay: 0.3,
  },
} as const;

/** 変異軸の係数。value v に対して「伸びる側 x(1 + gain v)」「縮む側 x(1 - cost v)」 */
export const VARIANT_COEF: Record<VariantAxis, { gain: number; cost: number }> = {
  areaVsDamage: { gain: 0.4, cost: 0.3 },
  cooldownVsDamage: { gain: 0.3, cost: 0.25 },
  speedVsDamage: { gain: 0.3, cost: 0.2 },
  countVsDamage: { gain: 2, cost: 0.3 },
  durationVsPotency: { gain: 0.5, cost: 0.3 },
  cooldownVsPotency: { gain: 0.3, cost: 0.25 },
};

/**
 * スキル石の抽選の重み。初期の 6 を少し厚めにし、追加スキルは 1 種あたりやや薄くする
 * （序盤に見慣れたスキルが出にくくなりすぎないように）
 */
export const SKILL_WEIGHTS: Record<SkillKey, number> = {
  whirl: 10,
  lunge: 10,
  frag: 10,
  railshot: 10,
  parry: 10,
  bloodPact: 10,
  quake: 8,
  thunder: 8,
  gravityWell: 7,
  mines: 8,
  haste: 7,
  chainHook: 8,
  spiral: 8,
  frostField: 7,
  // 大拡張: 1 種あたりは既存より薄く（種類が多いので合計では十分出る）
  contagion: 6,
  unravel: 6,
  kindle: 6,
  prismShard: 6,
  fullMoon: 5,
  dregsBlade: 5,
  shadowStep: 6,
  powderKeg: 6,
  swordGrave: 6,
  iceBreaker: 6,
  bloodlet: 5,
  harvest: 5,
  discharge: 5,
  rout: 5,
  verdict: 5,
  exploit: 5,
  strip: 5,
  lastStand: 6,
  comboChain: 6,
  grudge: 5,
  guillotine: 6,
  ricochet: 6,
  galeSlash: 6,
  scatterSigil: 6,
  stomp: 6,
  threadReel: 6,
  meteorDive: 5,
  swallowFlip: 6,
  boneRing: 5,
  backflow: 5,
  scarRoar: 5,
  manaSpring: 5,
  turret: 5,
};

/**
 * この深度から拾えるスキル。状態異常を「食う」スキルは、装備や祝福で状態異常を「出す」手段が
 * 揃い始める 2 層目から。変わり種（召喚・特殊な資源）は 3 層目から
 */
export const SKILL_MIN_DEPTH: Record<SkillKey, number> = {
  whirl: 1,
  lunge: 1,
  frag: 1,
  railshot: 1,
  parry: 1,
  bloodPact: 1,
  quake: 1,
  thunder: 1,
  gravityWell: 1,
  mines: 1,
  haste: 1,
  chainHook: 1,
  spiral: 1,
  frostField: 1,
  contagion: 2,
  unravel: 2,
  kindle: 2,
  prismShard: 1,
  fullMoon: 1,
  dregsBlade: 1,
  shadowStep: 1,
  powderKeg: 1,
  swordGrave: 2,
  iceBreaker: 1,
  bloodlet: 2,
  harvest: 2,
  discharge: 2,
  rout: 2,
  verdict: 2,
  exploit: 2,
  strip: 2,
  lastStand: 1,
  comboChain: 1,
  grudge: 1,
  guillotine: 1,
  ricochet: 1,
  galeSlash: 1,
  scatterSigil: 1,
  stomp: 1,
  threadReel: 1,
  meteorDive: 2,
  swallowFlip: 1,
  boneRing: 2,
  backflow: 3,
  scarRoar: 3,
  manaSpring: 2,
  turret: 3,
};

/** マナ型の共通項: CD とチャージは使わない（docs/COMBAT_DESIGN.md B-4） */
function manaSkill(block: { cost: number; minInterval: number; poise: number }) {
  return {
    resource: "mana",
    cooldown: 0,
    charges: 1,
    manaCost: block.cost,
    minInterval: block.minInterval,
    poise: block.poise,
  } as const;
}

/** CD 型の共通項: コスト 0、既存の CD とチャージ制 */
function cooldownSkill(block: { cooldown: number; minInterval: number }, poise: number) {
  return {
    resource: "cooldown",
    cooldown: block.cooldown,
    charges: 1,
    manaCost: 0,
    minInterval: block.minInterval,
    poise,
  } as const;
}

/** 命中した敵に付ける状態異常（docs/COMBAT_DESIGN.md B-4 の「付与」列） */
const APPLIES = {
  railshot: [{ kind: "vulnerable", stacks: 1, duration: SKILL.railshot.vulnerableTime, potency: 0 }],
  thunder: [{ kind: "shock", stacks: SKILL.thunder.shockStacks, duration: STATUS.shock.duration, potency: SKILL.thunder.shockPotency }],
  gravityWell: [{ kind: "silence", stacks: 1, duration: SKILL.gravityWell.silenceTime, potency: 0 }],
  chainHook: [
    { kind: "bleed", stacks: SKILL.chainHook.bleedStacks, duration: SKILL.chainHook.bleedTime, potency: SKILL.chainHook.bleedPotency },
  ],
} as const satisfies Partial<Record<SkillKey, readonly StatusApply[]>>;

const BASE_SKILL_DEFS: Record<BaseSkillKey, SkillDef> = {
  whirl: {
    key: "whirl",
    name: "旋風斬り",
    icon: "W",
    verb: "回転して周囲の敵を斬り払う",
    tags: ["melee", "area"],
    damageKind: "melee",
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage", "countVsDamage"],
    ...manaSkill(SKILL.whirl),
    combos: ["hookWhirl", "pactWhirl"],
  },
  lunge: {
    key: "lunge",
    name: "突進斬り",
    icon: "L",
    verb: "カーソル方向へ突進して斬る（無敵時間なし）",
    tags: ["melee", "movement"],
    damageKind: "melee",
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage"],
    ...cooldownSkill(SKILL.lunge, SKILL.lunge.poise),
  },
  frag: {
    key: "frag",
    name: "グレネード",
    icon: "G",
    verb: "導火線付きの手榴弾を投げ、少し遅れて爆発させる",
    tags: ["area", "projectile", "placed"],
    damageKind: "ranged",
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage", "countVsDamage"],
    ...manaSkill(SKILL.frag),
  },
  railshot: {
    key: "railshot",
    name: "撃ち抜き",
    icon: "R",
    verb: "照準してから、壁まで貫通するビームを撃つ",
    tags: ["projectile"],
    damageKind: "ranged",
    axes: ["cooldownVsDamage", "speedVsDamage", "countVsDamage"],
    ...manaSkill(SKILL.railshot),
    combos: ["parryRail"],
    applies: APPLIES.railshot,
  },
  parry: {
    key: "parry",
    name: "パリィ",
    icon: "P",
    verb: "構える。防いだ一撃はJUST扱いになり、CDが戻る",
    tags: ["defense", "melee"],
    damageKind: "melee",
    axes: ["areaVsDamage", "cooldownVsDamage"],
    ...cooldownSkill(SKILL.parry, SKILL.parry.poise),
  },
  bloodPact: {
    key: "bloodPact",
    name: "血の契約",
    icon: "B",
    verb: "HPを払って攻撃速度と吸血を得る",
    tags: ["buff"],
    damageKind: "none",
    axes: ["durationVsPotency"],
    ...cooldownSkill(SKILL.bloodPact, 0),
  },
  quake: {
    key: "quake",
    name: "地裂き",
    icon: "Q",
    verb: "溜めてから前方扇状に衝撃波を放つ（溜め中の被弾で中断）",
    tags: ["melee", "area"],
    damageKind: "melee",
    axes: ["areaVsDamage", "speedVsDamage", "cooldownVsDamage"],
    ...manaSkill(SKILL.quake),
    combos: ["diveQuake"],
  },
  thunder: {
    key: "thunder",
    name: "雷撃",
    icon: "T",
    verb: "カーソル地点に遅れて雷を落とす",
    tags: ["lightning", "area", "placed"],
    damageKind: "ranged",
    axes: ["areaVsDamage", "speedVsDamage", "countVsDamage"],
    ...manaSkill(SKILL.thunder),
    combos: ["wellThunder"],
    applies: APPLIES.thunder,
  },
  gravityWell: {
    key: "gravityWell",
    name: "引力球",
    icon: "O",
    verb: "設置した場所へ範囲内の敵（と敵弾）を引き寄せる",
    tags: ["area", "placed"],
    damageKind: "ranged",
    axes: ["areaVsDamage", "durationVsPotency", "cooldownVsDamage"],
    ...manaSkill(SKILL.gravityWell),
    applies: APPLIES.gravityWell,
  },
  mines: {
    key: "mines",
    name: "地雷",
    icon: "M",
    verb: "足元に地雷を設置する。起動後、敵が踏むと爆発する",
    tags: ["placed", "area"],
    damageKind: "ranged",
    axes: ["countVsDamage", "areaVsDamage", "cooldownVsDamage"],
    ...manaSkill(SKILL.mines),
  },
  haste: {
    key: "haste",
    name: "加速",
    icon: "H",
    verb: "ダッシュがCD無しになり移動速度が上がる。切れた後はダッシュ不可",
    tags: ["buff", "movement"],
    damageKind: "none",
    axes: ["durationVsPotency", "cooldownVsPotency"],
    ...cooldownSkill(SKILL.haste, 0),
  },
  chainHook: {
    key: "chainHook",
    name: "鎖鎌",
    icon: "K",
    verb: "鎖を伸ばし、最初に当たった敵を手元へ引き寄せる",
    tags: ["melee", "projectile"],
    damageKind: "melee",
    axes: ["areaVsDamage", "speedVsDamage", "cooldownVsDamage"],
    ...manaSkill(SKILL.chainHook),
    applies: APPLIES.chainHook,
  },
  spiral: {
    key: "spiral",
    name: "回転弾幕",
    icon: "S",
    verb: "自分を中心に螺旋状の弾を放つ（発射中は移動が遅くなり、近接・射撃不可）",
    tags: ["projectile", "channel"],
    damageKind: "ranged",
    axes: ["countVsDamage", "speedVsDamage", "cooldownVsDamage"],
    ...manaSkill(SKILL.spiral),
    combos: ["hasteSpiral"],
  },
  frostField: {
    key: "frostField",
    name: "氷結地帯",
    icon: "F",
    verb: "地面を凍らせ、中の敵を凍結させながら継続ダメージを与える（自分も遅くなる）",
    tags: ["cold", "area", "placed"],
    damageKind: "ranged",
    axes: ["areaVsDamage", "durationVsPotency", "cooldownVsDamage"],
    ...manaSkill(SKILL.frostField),
  },
};

export const SKILL_DEFS: Record<SkillKey, SkillDef> = { ...BASE_SKILL_DEFS, ...EXTRA_SKILL_DEFS };

const M = SKILL.modifier;

const BASE_MODIFIERS: Record<BaseModifierKey, ModifierDef> = {
  multiCharge: {
    key: "multiCharge",
    name: "多重",
    verb: `チャージ +${M.multiCharge.extraCharges}、ダメージ x${M.multiCharge.damageMul}、CD x${M.multiCharge.burdenMul}`,
    manaVerb: `コスト x${M.multiCharge.manaBurdenMul}、連打間隔 x${M.multiCharge.intervalMul}、ダメージ x${M.multiCharge.damageMul}`,
    color: "#ffffff",
    excludesTags: [],
    apply: (p) =>
      p.resource === "mana"
        ? {
            ...p,
            burdenMul: p.burdenMul * M.multiCharge.manaBurdenMul,
            intervalMul: p.intervalMul * M.multiCharge.intervalMul,
            damageMul: p.damageMul * M.multiCharge.damageMul,
          }
        : {
            ...p,
            charges: p.charges + M.multiCharge.extraCharges,
            damageMul: p.damageMul * M.multiCharge.damageMul,
            burdenMul: p.burdenMul * M.multiCharge.burdenMul,
          },
  },
  bloodPrice: {
    key: "bloodPrice",
    name: "血の代償",
    verb: `ダメージ x${M.bloodPrice.damageMul}、最大HPの${M.bloodPrice.hpFraction * PERCENT_UNIT}%を消費`,
    manaVerb: `ダメージ x${M.bloodPrice.damageMul}、最大HPの${M.bloodPrice.hpFraction * PERCENT_UNIT}%を消費してコスト x${M.bloodPrice.manaBurdenMul}`,
    color: "#ff4040",
    excludesTags: [],
    apply: (p) => ({
      ...p,
      hpCostFraction: p.hpCostFraction + M.bloodPrice.hpFraction,
      damageMul: p.damageMul * M.bloodPrice.damageMul,
      potencyMul: p.potencyMul * M.bloodPrice.potencyMul,
      // 血でマナを肩代わりする（CD 型は現行どおり CD に触れない）
      burdenMul: p.resource === "mana" ? p.burdenMul * M.bloodPrice.manaBurdenMul : p.burdenMul,
    }),
  },
  comboFuel: {
    key: "comboFuel",
    name: "コンボ燃料",
    verb: `コンボを消費: 1ヒットにつき+${M.comboFuel.perStack * 100}%（コンボ0ならx${M.comboFuel.emptyMul}）`,
    color: "#ffd75f",
    excludesTags: [],
    apply: (p) => ({
      ...p,
      comboFuel: { perStack: M.comboFuel.perStack, cap: M.comboFuel.cap, emptyMul: M.comboFuel.emptyMul },
    }),
  },
  echo: {
    key: "echo",
    name: "反響",
    verb: `${M.echo.delay}秒後に${M.echo.damageMul * PERCENT_UNIT}%の威力で再発動、CD x${M.echo.burdenMul}`,
    manaVerb: `${M.echo.delay}秒後に${M.echo.damageMul * PERCENT_UNIT}%の威力で再発動、コスト x${M.echo.burdenMul}`,
    color: "#c080ff",
    excludesTags: ["defense", "buff"],
    // 影渡りは自分が動くだけで、発動地点での再発動に意味が無い
    excludesSkills: ["shadowStep"],
    apply: (p) => ({
      ...p,
      echo: { delay: M.echo.delay, damageMul: M.echo.damageMul },
      burdenMul: p.burdenMul * M.echo.burdenMul,
    }),
  },
  pierce: {
    key: "pierce",
    name: "貫通",
    verb: `弾・鎖が+${M.pierce.count}体貫通、範囲 x${M.pierce.areaMul}`,
    color: "#80ffc0",
    excludesTags: ["placed"],
    requiresTags: ["projectile"],
    // 撃ち抜き・満月の砲・風切り・手繰り糸は元から全員に当たる
    excludesSkills: ["railshot", "fullMoon", "galeSlash", "threadReel"],
    apply: (p) => ({ ...p, pierce: p.pierce + M.pierce.count, areaMul: p.areaMul * M.pierce.areaMul }),
  },
  recoil: {
    key: "recoil",
    name: "反動",
    verb: `発動時に後方へ跳ぶ（${M.recoil.invuln}秒無敵）、ダメージ x${M.recoil.damageMul}`,
    color: "#a0c0ff",
    // buff は威力を持たないので代償が空振りになる
    excludesTags: ["movement", "defense", "buff"],
    apply: (p) => ({ ...p, recoil: Math.max(p.recoil, M.recoil.speed), damageMul: p.damageMul * M.recoil.damageMul }),
  },
  chainReset: {
    key: "chainReset",
    name: "連鎖",
    verb: `このスキルでの撃破でチャージが1回復、CD x${M.chainReset.burdenMul}`,
    manaVerb: `このスキルでの撃破でコストの${M.chainReset.manaRefund * PERCENT_UNIT}%を返す、コスト x${M.chainReset.manaBurdenMul}`,
    color: "#ffff80",
    excludesTags: ["buff", "defense"],
    apply: (p) =>
      p.resource === "mana"
        ? { ...p, killManaRefund: M.chainReset.manaRefund, burdenMul: p.burdenMul * M.chainReset.manaBurdenMul }
        : { ...p, killRefund: true, burdenMul: p.burdenMul * M.chainReset.burdenMul },
  },
  curse: {
    key: "curse",
    name: "呪い",
    verb: `命中した敵を${M.curse.duration}秒間呪う: スキル被ダメージ +${M.curse.bonus * PERCENT_UNIT}%、ダメージ x${M.curse.damageMul}`,
    color: "#b040ff",
    excludesTags: ["buff"],
    apply: (p) => ({
      ...p,
      curse: { duration: M.curse.duration, bonus: M.curse.bonus },
      damageMul: p.damageMul * M.curse.damageMul,
    }),
  },
  delay: {
    key: "delay",
    name: "遅延",
    verb: `発動地点で${M.delay.time}秒後に発動、ダメージ x${M.delay.damageMul}`,
    color: "#ff80c0",
    excludesTags: ["defense", "buff", "movement", "channel"],
    apply: (p) => ({ ...p, delay: { time: M.delay.time, damageMul: M.delay.damageMul } }),
  },
  expand: {
    key: "expand",
    name: "拡大",
    verb: `範囲 x${M.expand.areaMul}、CD x${M.expand.burdenMul}`,
    manaVerb: `範囲 x${M.expand.areaMul}、コスト x${M.expand.burdenMul}`,
    color: "#60a0ff",
    excludesTags: [],
    requiresTags: ["area"],
    apply: (p) => ({ ...p, areaMul: p.areaMul * M.expand.areaMul, burdenMul: p.burdenMul * M.expand.burdenMul }),
  },
  charge: {
    key: "charge",
    name: "溜め",
    verb: `長押しで溜める（最大${M.charge.maxTime}秒）: ダメージ x1〜${M.charge.maxDamageMul}、範囲 x1〜${M.charge.maxAreaMul}`,
    manaVerb: `長押しで溜める（最大${M.charge.maxTime}秒）: ダメージ x1〜${M.charge.maxDamageMul}、範囲 x1〜${M.charge.maxAreaMul}。コストは離した瞬間に払う`,
    color: "#ffd060",
    // パリィ/血の契約/加速は「押した瞬間」に意味がある即応スキル、回転弾幕はチャネル系で「溜めて離す」と噛み合わない
    excludesTags: ["defense", "buff", "channel"],
    excludesModifiers: ["toStaged"],
    // 実際の倍率は system/skills.ts が発動時の経過秒から計算して CastParams に掛けるので、ここでは素通し
    apply: (p) => p,
  },
};

export const MODIFIERS: Record<ModifierKey, ModifierDef> = { ...BASE_MODIFIERS, ...EXTRA_MODIFIERS };

/** 相性表: 除外タグ・必須タグ・個別除外・資源・付与の有無のすべてを満たすか */
export function canAttach(def: SkillDef, key: ModifierKey): boolean {
  const m = MODIFIERS[key];
  if (m.excludesTags.some((t) => def.tags.includes(t))) return false;
  if (m.requiresTags && !m.requiresTags.some((t) => def.tags.includes(t))) return false;
  if (m.requiresResource && m.requiresResource !== def.resource) return false;
  if (m.requiresApplies && !def.applies) return false;
  return !(m.excludesSkills?.includes(def.key) ?? false);
}

/** 刻印符が使うリンクの本数（型替え符は 2） */
export function modifierLinkCost(key: ModifierKey): number {
  return MODIFIERS[key].linkCost ?? 1;
}

/** a と b が同じスロットで同時に効かないか（どちらかが相手を excludesModifiers に持つ） */
function modifiersClash(a: ModifierKey, b: ModifierKey): boolean {
  return (MODIFIERS[a].excludesModifiers?.includes(b) ?? false) || (MODIFIERS[b].excludesModifiers?.includes(a) ?? false);
}

/**
 * スロットの修飾子のうち実際に効くもの。付けられるものを古い順に、リンクの残りに収まる限り採る。
 * 型替え符は 1 枚まで、排他の組は古い方だけが効く
 */
export function activeModifiers(def: SkillDef, links: number, modifiers: readonly ModifierKey[]): ModifierKey[] {
  const out: ModifierKey[] = [];
  let used = 0;
  for (const key of modifiers) {
    if (!canAttach(def, key)) continue;
    const cost = modifierLinkCost(key);
    if (used + cost > links) continue;
    if (MODIFIERS[key].reshape && out.some((k) => MODIFIERS[k].reshape)) continue;
    if (out.some((k) => modifiersClash(k, key))) continue;
    out.push(key);
    used += cost;
  }
  return out;
}

export function baseCastParams(def: SkillDef): CastParams {
  return {
    damageMul: 1,
    potencyMul: 1,
    areaMul: 1,
    timeMul: 1,
    durationMul: 1,
    burdenMul: 1,
    charges: def.charges,
    countBonus: 0,
    hpCostFraction: 0,
    comboFuel: null,
    echo: null,
    pierce: 0,
    recoil: 0,
    killRefund: false,
    curse: null,
    delay: null,
    slot: -1,
    intervalMul: 1,
    killManaRefund: 0,
    skillKey: def.key,
    manaPaid: 0,
    refundPool: { left: 0 },
    resource: def.resource,
    baseCost: def.manaCost,
    baseCooldown: def.cooldown,
    poiseMul: 1,
    knockbackMul: 1,
    repel: false,
    statusDurationMul: 1,
    spread: false,
    refundPerHit: 0,
    hitRefundPool: { left: 0 },
    followUp: false,
    lastGasp: null,
    landing: false,
    flank: false,
    rangeBias: null,
    attuneCrit: false,
    deferredMul: 0,
    bloodTithe: false,
    spillover: false,
    dryFire: false,
    bladeFeed: false,
    overheat: false,
    desperate: false,
    attune: false,
    cycle: false,
    reshape: null,
    combo: null,
    origin: { x: 0, y: 0 },
    hitLog: new Set(),
    gaspPool: { left: 0 },
  };
}

function applyVariant(p: CastParams, roll: VariantRoll): CastParams {
  const v = roll.value;
  const c = VARIANT_COEF[roll.axis];
  switch (roll.axis) {
    case "areaVsDamage":
      return { ...p, areaMul: p.areaMul * (1 + c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "cooldownVsDamage":
      return { ...p, burdenMul: p.burdenMul * (1 - c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "speedVsDamage":
      return { ...p, timeMul: p.timeMul * (1 - c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "countVsDamage":
      return { ...p, countBonus: p.countBonus + Math.round(c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "durationVsPotency":
      return { ...p, durationMul: p.durationMul * (1 + c.gain * v), potencyMul: p.potencyMul * (1 - c.cost * v) };
    case "cooldownVsPotency":
      return { ...p, burdenMul: p.burdenMul * (1 - c.gain * v), potencyMul: p.potencyMul * (1 - c.cost * v) };
  }
}

/**
 * 1 回の発動パラメータを決める純関数。stats は発動時に rollOutgoing 経由で掛けるのでここでは扱わない。
 * スキルに無い変異軸は無視する（壊れたセーブ対策）
 */
export function resolveCast(def: SkillDef, stone: SkillStone, modifiers: readonly ModifierKey[]): CastParams {
  let p = baseCastParams(def);
  for (const roll of stone.variants) {
    if (def.axes.includes(roll.axis)) p = applyVariant(p, roll);
  }
  p = { ...p, burdenMul: p.burdenMul * (1 + SKILL.linkBurdenPenalty * stone.links) };
  const active = activeModifiers(def, stone.links, modifiers);
  // 資源を差し替える刻印符（定刻・燃料化）を先に当て、多重・連鎖などが差し替え後の資源で読み替えるようにする
  const ordered = [...active.filter((k) => RESOURCE_CONVERTERS.includes(k)), ...active.filter((k) => !RESOURCE_CONVERTERS.includes(k))];
  for (const key of ordered) p = MODIFIERS[key].apply(p, def);
  return p;
}

/** 1 回の発動の負担。マナ型はコスト（CD 0）、CD 型は CD の秒数（コスト 0）。docs/COMBAT_DESIGN.md B-6 */
export interface CastBurden {
  cost: number;
  cooldown: number;
}

/** 資源は params.resource（定刻・燃料化で def.resource から差し替わる）。基準値も params が持つ */
export function castBurden(_def: SkillDef, params: Readonly<CastParams>): CastBurden {
  if (params.resource === "mana") return { cost: params.baseCost * params.burdenMul, cooldown: 0 };
  return { cost: 0, cooldown: params.baseCooldown * params.burdenMul };
}

/** このスロットだけの連打下限（秒）。多重（マナ型）で縮む */
export function castInterval(def: SkillDef, params: Readonly<CastParams>): number {
  return def.minInterval * params.intervalMul;
}

/**
 * 刻印符の説明文。マナ型で読み替えるものは manaVerb を使う。
 * resource は実際に使う資源（定刻・燃料化で def.resource から差し替わるので CastParams.resource を渡す）
 */
export function modifierVerb(key: ModifierKey, def: Readonly<SkillDef>, resource: SkillResource = def.resource): string {
  const m = MODIFIERS[key];
  return resource === "mana" ? (m.manaVerb ?? m.verb) : m.verb;
}

/** 負担の軸（cooldownVs*）の表示名。マナ型は「コスト」、CD 型は「CD」 */
export const BURDEN_LABEL: Record<SkillResource, string> = { mana: "コスト", cooldown: "CD" };

const AXIS_LABEL: Record<VariantAxis, readonly [string, string]> = {
  areaVsDamage: ["範囲", "ダメージ"],
  cooldownVsDamage: ["CD", "ダメージ"],
  speedVsDamage: ["速度", "ダメージ"],
  countVsDamage: ["回数", "ダメージ"],
  durationVsPotency: ["持続", "効果量"],
  cooldownVsPotency: ["CD", "効果量"],
};

const PERCENT = PERCENT_UNIT;

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/**
 * ツールチップ用の 1 行。例: "範囲 +24% / ダメージ -18%"。負担の軸は資源で「コスト」「CD」を出し分ける
 * （resource は定刻・燃料化で差し替わった後の CastParams.resource を渡す）
 */
export function formatVariant(roll: VariantRoll, def: Readonly<SkillDef>, resource: SkillResource = def.resource): string {
  const c = VARIANT_COEF[roll.axis];
  const [axisGain, costLabel] = AXIS_LABEL[roll.axis];
  const burdenAxis = roll.axis === "cooldownVsDamage" || roll.axis === "cooldownVsPotency";
  const gainLabel = burdenAxis ? BURDEN_LABEL[resource] : axisGain;
  const v = roll.value;
  const cost = `${costLabel} ${signed(Math.round(-c.cost * v * PERCENT))}%`;
  if (roll.axis === "countVsDamage") return `${gainLabel} ${signed(Math.round(c.gain * v))} / ${cost}`;
  // 負担（CD / コスト）と発動時間は短くなる向きが「伸びる」側
  const shrinks = burdenAxis || roll.axis === "speedVsDamage";
  const gainSign = shrinks ? -1 : 1;
  const label = roll.axis === "speedVsDamage" ? "発動時間" : gainLabel;
  return `${label} ${signed(Math.round(gainSign * c.gain * v * PERCENT))}% / ${cost}`;
}

/** 石の表示名: スキル名 + リンク記号 */
export function stoneLabel(stone: SkillStone): string {
  return `${SKILL_DEFS[stone.skillKey].name} ${"◆".repeat(stone.links)}${"◇".repeat(SKILL.maxLinks - stone.links)}`;
}
