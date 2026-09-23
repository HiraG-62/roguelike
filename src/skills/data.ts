import type { StatusApply } from "../core/status";
import { STATUS } from "../data/tuning";
import type {
  CastParams,
  ModifierDef,
  ModifierKey,
  SkillDef,
  SkillKey,
  SkillStone,
  VariantAxis,
  VariantRoll,
} from "./types";

/** 割合 → % 表記 */
const PERCENT_UNIT = 100;

/**
 * スキルの数値。docs/ideas/skills.md「7-5」、docs/COMBAT_DESIGN.md B-2 / B-4。
 * damage は Scaling（base + 係数 × ステータス実効値）。ステータスが基礎値（各 5）のとき旧来の固定値と一致する
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
    cost: 18,
    minInterval: 0.6,
    poise: 6,
    duration: 0.45,
    hits: 4,
    radius: 28,
    damage: { base: 3, str: 0.4, spi: 0.4 },
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
    cost: 22,
    minInterval: 0.5,
    poise: 30,
    maxRange: 120,
    flight: 0.35,
    fuse: 0.5,
    radius: 36,
    damage: { base: 12, dex: 1.4, spi: 1.4 },
    knockback: 240,
    selfDamageFraction: 0.1,
    spread: 14,
    wallProbe: 2,
  },
  railshot: {
    cost: 25,
    minInterval: 0.8,
    poise: 25,
    aim: 0.35,
    damage: { base: 14, dex: 2, spi: 1.2 },
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
    cost: 24,
    minInterval: 0.6,
    poise: 45,
    windup: 0.35,
    recover: 0.2,
    radius: 56,
    halfAngle: 0.6,
    damage: { base: 10, str: 1.6, spi: 0.8 },
    knockback: 220,
  },
  /** 雷撃: カーソル地点に遅れて落雷、中心の敵から連鎖雷。命中した敵に感電 */
  thunder: {
    cost: 20,
    minInterval: 0.5,
    poise: 15,
    maxRange: 140,
    delay: 0.5,
    radius: 22,
    damage: { base: 10, dex: 1.2, spi: 1.6 },
    shockMul: 0.5,
    extraGap: 0.12,
    extraOffset: 22,
    shockStacks: 2,
    /** 感電の連鎖 1 回のダメージ（状態異常の potency） */
    shockPotency: 3,
  },
  /** 引力球: 範囲の敵（と敵弾）を中心へ引き、最後に弾ける。引き寄せ中の敵は沈黙 */
  gravityWell: {
    cost: 30,
    minInterval: 1,
    /** 破裂の怯み値（tick は 0） */
    poise: 20,
    maxRange: 120,
    duration: 2,
    radius: 50,
    pull: 70,
    core: 6,
    tickEvery: 0.5,
    tickDamage: { base: 1, spi: 0.4 },
    burstDamage: { base: 8, spi: 2 },
    burstKnockback: 80,
    /** tick ごとに付け直す沈黙の秒（tick 間隔より少し長く、引いている間は切れない） */
    silenceTime: 0.6,
  },
  /** 地雷: 足元に設置、起動後に敵が踏むと爆発 */
  mines: {
    cost: 12,
    minInterval: 0.3,
    poise: 25,
    arm: 0.4,
    life: 20,
    maxAlive: 3,
    trigger: 10,
    radius: 30,
    damage: { base: 8, dex: 1.2, spi: 1.2 },
    knockback: 160,
  },
  /** 加速: ダッシュ CD 0 + 移動速度。切れた後はダッシュ不可 */
  haste: { cooldown: 11, minInterval: 0.3, duration: 3, moveBonus: 0.3, exhaust: 1.5 },
  /** 鎖鎌: 鎖を伸ばし、刺さった敵を手元へ引き寄せる（ボスなら自分が飛ぶ）。命中した敵に出血 */
  chainHook: {
    cost: 14,
    minInterval: 0.5,
    poise: 15,
    range: 110,
    extendTime: 0.18,
    recover: 0.25,
    hitPad: 3,
    damage: { base: 6, str: 1, dex: 0.6 },
    knockback: 40,
    landGap: 2,
    bleedStacks: 1,
    bleedTime: 4,
    /** 出血の 10px あたりダメージ（状態異常の potency） */
    bleedPotency: 1,
  },
  /** 回転弾幕: 自分中心に螺旋状の弾。発射中は移動 40%、近接・射撃不可 */
  spiral: {
    cost: 28,
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
    damage: { base: 2, dex: 0.3, spi: 0.3 },
    knockback: 30,
    moveMul: 0.4,
  },
  /** 氷結地帯: 中の敵を chill + 継続ダメージ。自分も中では遅くなる */
  frostField: {
    cost: 26,
    minInterval: 0.8,
    poise: 0,
    maxRange: 110,
    duration: 3,
    radius: 40,
    tickEvery: 0.5,
    tickDamage: { base: 1, spi: 0.6 },
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
  },
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

export const SKILL_DEFS: Record<SkillKey, SkillDef> = {
  whirl: {
    key: "whirl",
    name: "旋風斬り",
    icon: "W",
    verb: "回転して周囲の敵を斬り払う",
    tags: ["melee", "area"],
    damageKind: "melee",
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage", "countVsDamage"],
    ...manaSkill(SKILL.whirl),
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

const M = SKILL.modifier;

export const MODIFIERS: Record<ModifierKey, ModifierDef> = {
  multiCharge: {
    key: "multiCharge",
    name: "多重",
    verb: `チャージ +${M.multiCharge.extraCharges}、ダメージ x${M.multiCharge.damageMul}、CD x${M.multiCharge.burdenMul}`,
    manaVerb: `コスト x${M.multiCharge.manaBurdenMul}、連打間隔 x${M.multiCharge.intervalMul}、ダメージ x${M.multiCharge.damageMul}`,
    color: "#ffffff",
    excludesTags: [],
    apply: (p, def) =>
      def.resource === "mana"
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
    apply: (p, def) => ({
      ...p,
      hpCostFraction: p.hpCostFraction + M.bloodPrice.hpFraction,
      damageMul: p.damageMul * M.bloodPrice.damageMul,
      potencyMul: p.potencyMul * M.bloodPrice.potencyMul,
      // 血でマナを肩代わりする（CD 型は現行どおり CD に触れない）
      burdenMul: def.resource === "mana" ? p.burdenMul * M.bloodPrice.manaBurdenMul : p.burdenMul,
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
    // 撃ち抜きは元から全貫通
    excludesSkills: ["railshot"],
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
    apply: (p, def) =>
      def.resource === "mana"
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
    // 実際の倍率は system/skills.ts が発動時の経過秒から計算して CastParams に掛けるので、ここでは素通し
    apply: (p) => p,
  },
};

/** 相性表: 除外タグ・必須タグ・個別除外のすべてを満たすか */
export function canAttach(def: SkillDef, key: ModifierKey): boolean {
  const m = MODIFIERS[key];
  if (m.excludesTags.some((t) => def.tags.includes(t))) return false;
  if (m.requiresTags && !m.requiresTags.some((t) => def.tags.includes(t))) return false;
  return !(m.excludesSkills?.includes(def.key) ?? false);
}

/** スロットの修飾子のうち実際に効くもの: 付けられるものを古い順にリンク数まで */
export function activeModifiers(def: SkillDef, links: number, modifiers: readonly ModifierKey[]): ModifierKey[] {
  return modifiers.filter((k) => canAttach(def, k)).slice(0, Math.max(0, links));
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
  for (const key of activeModifiers(def, stone.links, modifiers)) p = MODIFIERS[key].apply(p, def);
  return p;
}

/** 1 回の発動の負担。マナ型はコスト（CD 0）、CD 型は CD の秒数（コスト 0）。docs/COMBAT_DESIGN.md B-6 */
export interface CastBurden {
  cost: number;
  cooldown: number;
}

export function castBurden(def: SkillDef, params: Readonly<CastParams>): CastBurden {
  if (def.resource === "mana") return { cost: def.manaCost * params.burdenMul, cooldown: 0 };
  return { cost: 0, cooldown: def.cooldown * params.burdenMul };
}

/** このスロットだけの連打下限（秒）。多重（マナ型）で縮む */
export function castInterval(def: SkillDef, params: Readonly<CastParams>): number {
  return def.minInterval * params.intervalMul;
}

/** 刻印符の説明文。マナ型で読み替えるものは manaVerb を使う */
export function modifierVerb(key: ModifierKey, def: Readonly<SkillDef>): string {
  const m = MODIFIERS[key];
  return def.resource === "mana" ? (m.manaVerb ?? m.verb) : m.verb;
}

/** 負担の軸（cooldownVs*）の表示名。マナ型は「コスト」、CD 型は「CD」 */
const BURDEN_LABEL: Record<SkillDef["resource"], string> = { mana: "コスト", cooldown: "CD" };

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

/** ツールチップ用の 1 行。例: "範囲 +24% / ダメージ -18%"。負担の軸は def の資源で「コスト」「CD」を出し分ける */
export function formatVariant(roll: VariantRoll, def: Readonly<SkillDef>): string {
  const c = VARIANT_COEF[roll.axis];
  const [axisGain, costLabel] = AXIS_LABEL[roll.axis];
  const burdenAxis = roll.axis === "cooldownVsDamage" || roll.axis === "cooldownVsPotency";
  const gainLabel = burdenAxis ? BURDEN_LABEL[def.resource] : axisGain;
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
