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

/** スキルの数値。docs/ideas/skills.md「7-5」 */
export const SKILL = {
  slots: 2,
  /** リンク 1 本ごとに素の CD に足す割合 */
  linkCooldownPenalty: 0.15,
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
  whirl: { cooldown: 5, duration: 0.45, hits: 4, radius: 28, damage: 7, knockback: 60, moveMul: 0.6, recover: 0.15 },
  lunge: { cooldown: 4, distance: 90, time: 0.14, hitPad: 10, damage: 16, knockback: 200, wallStun: 0.25, comboLinkWindow: 0.3 },
  frag: { cooldown: 6, maxRange: 120, flight: 0.35, fuse: 0.5, radius: 36, damage: 26, knockback: 240, selfDamageFraction: 0.1, spread: 14, wallProbe: 2 },
  railshot: { cooldown: 5, aim: 0.35, damage: 30, knockback: 180, recoil: 120, stepPx: 2, maxLength: 400, halfWidth: 3, cancelRefund: 0.5, spreadRad: 0.1 },
  parry: { cooldown: 3, window: 0.22, failLock: 0.35, radius: 40, damage: 12, knockback: 260, catchPad: 4 },
  bloodPact: { cooldown: 12, hpFraction: 0.12, duration: 4, speedMul: 1.35, lifesteal: 0.08 },
  /** 地裂き: 溜めて前方扇に衝撃波。溜め中の被弾で中断（CD は消費） */
  quake: { cooldown: 5, windup: 0.35, recover: 0.2, radius: 56, halfAngle: 0.6, damage: 22, knockback: 220 },
  /** 雷撃: カーソル地点に遅れて落雷、中心の敵から連鎖雷 */
  thunder: { cooldown: 5, maxRange: 140, delay: 0.5, radius: 22, damage: 24, shockMul: 0.5, extraGap: 0.12, extraOffset: 22 },
  /** 引力球: 範囲の敵（と敵弾）を中心へ引き、最後に弾ける */
  gravityWell: {
    cooldown: 9,
    maxRange: 120,
    duration: 2,
    radius: 50,
    pull: 70,
    core: 6,
    tickEvery: 0.5,
    tickDamage: 3,
    burstDamage: 18,
    burstKnockback: 80,
  },
  /** 地雷: 足元に設置、起動後に敵が踏むと爆発 */
  mines: { cooldown: 3, arm: 0.4, life: 20, maxAlive: 3, trigger: 10, radius: 30, damage: 20, knockback: 160 },
  /** 加速: ダッシュ CD 0 + 移動速度。切れた後はダッシュ不可 */
  haste: { cooldown: 11, duration: 3, moveBonus: 0.3, exhaust: 1.5 },
  /** 鎖鎌: 鎖を伸ばし、刺さった敵を手元へ引き寄せる（ボスなら自分が飛ぶ） */
  chainHook: { cooldown: 4, range: 110, extendTime: 0.18, recover: 0.25, hitPad: 3, damage: 14, knockback: 40, landGap: 2 },
  /** 回転弾幕: 自分中心に螺旋状の弾。発射中は移動 40%、近接・射撃不可 */
  spiral: {
    cooldown: 7,
    duration: 1,
    bullets: 24,
    bulletsPerCount: 4,
    arms: 2,
    turns: 2,
    speed: 160,
    life: 0.6,
    radius: 2.5,
    damage: 5,
    knockback: 30,
    moveMul: 0.4,
  },
  /** 氷結地帯: 中の敵を chill + 継続ダメージ。自分も中では遅くなる */
  frostField: {
    cooldown: 8,
    maxRange: 110,
    duration: 3,
    radius: 40,
    tickEvery: 0.5,
    tickDamage: 4,
    slow: 0.5,
    maxSlow: 0.8,
    chillTime: 0.6,
    selfMoveMul: 0.8,
  },
  modifier: {
    multiCharge: { extraCharges: 2, damageMul: 0.7, cooldownMul: 1.3 },
    bloodPrice: { hpFraction: 0.06, damageMul: 1.6, potencyMul: 1.6 },
    comboFuel: { perStack: 0.04, cap: 1.2, emptyMul: 0.8 },
    echo: { delay: 0.8, damageMul: 0.5, cooldownMul: 1.25 },
    pierce: { count: 3, areaMul: 0.8 },
    recoil: { speed: 220, invuln: 0.1, damageMul: 0.85 },
    chainReset: { cooldownMul: 1.35 },
    curse: { duration: 4, bonus: 0.35, damageMul: 0.85 },
    delay: { time: 0.8, damageMul: 1.8 },
    expand: { areaMul: 1.5, cooldownMul: 1.4 },
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

export const SKILL_DEFS: Record<SkillKey, SkillDef> = {
  whirl: {
    key: "whirl",
    name: "Whirlwind",
    icon: "W",
    verb: "Spin and slash everything around you",
    tags: ["melee", "area"],
    damageKind: "melee",
    cooldown: SKILL.whirl.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage", "countVsDamage"],
  },
  lunge: {
    key: "lunge",
    name: "Lunge",
    icon: "L",
    verb: "Dash-slash toward the cursor (no i-frames)",
    tags: ["melee", "movement"],
    damageKind: "melee",
    cooldown: SKILL.lunge.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage"],
  },
  frag: {
    key: "frag",
    name: "Frag Grenade",
    icon: "G",
    verb: "Lob a grenade that blows up after a fuse",
    tags: ["area", "projectile", "placed"],
    damageKind: "ranged",
    cooldown: SKILL.frag.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage", "countVsDamage"],
  },
  railshot: {
    key: "railshot",
    name: "Railshot",
    icon: "R",
    verb: "Aim, then fire a piercing beam to the wall",
    tags: ["projectile"],
    damageKind: "ranged",
    cooldown: SKILL.railshot.cooldown,
    charges: 1,
    axes: ["cooldownVsDamage", "speedVsDamage", "countVsDamage"],
  },
  parry: {
    key: "parry",
    name: "Parry",
    icon: "P",
    verb: "Brace: a blocked hit counts as JUST and refunds CD",
    tags: ["defense", "melee"],
    damageKind: "melee",
    cooldown: SKILL.parry.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "cooldownVsDamage"],
  },
  bloodPact: {
    key: "bloodPact",
    name: "Blood Pact",
    icon: "B",
    verb: "Pay HP for attack speed and lifesteal",
    tags: ["buff"],
    damageKind: "none",
    cooldown: SKILL.bloodPact.cooldown,
    charges: 1,
    axes: ["durationVsPotency"],
  },
  quake: {
    key: "quake",
    name: "Earthsplitter",
    icon: "Q",
    verb: "Wind up, then crack the ground in a cone (getting hit cancels)",
    tags: ["melee", "area"],
    damageKind: "melee",
    cooldown: SKILL.quake.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "speedVsDamage", "cooldownVsDamage"],
  },
  thunder: {
    key: "thunder",
    name: "Thunderstrike",
    icon: "T",
    verb: "Call lightning on the cursor after a delay",
    tags: ["lightning", "area", "placed"],
    damageKind: "ranged",
    cooldown: SKILL.thunder.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "speedVsDamage", "countVsDamage"],
  },
  gravityWell: {
    key: "gravityWell",
    name: "Gravity Well",
    icon: "O",
    verb: "Drop a well that drags enemies (and bullets) inward",
    tags: ["area", "placed"],
    damageKind: "ranged",
    cooldown: SKILL.gravityWell.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "durationVsPotency", "cooldownVsDamage"],
  },
  mines: {
    key: "mines",
    name: "Landmine",
    icon: "M",
    verb: "Plant a mine at your feet that blows when stepped on",
    tags: ["placed", "area"],
    damageKind: "ranged",
    cooldown: SKILL.mines.cooldown,
    charges: 1,
    axes: ["countVsDamage", "areaVsDamage", "cooldownVsDamage"],
  },
  haste: {
    key: "haste",
    name: "Haste",
    icon: "H",
    verb: "Dash without cooldown and move faster; exhausted after",
    tags: ["buff", "movement"],
    damageKind: "none",
    cooldown: SKILL.haste.cooldown,
    charges: 1,
    axes: ["durationVsPotency", "cooldownVsPotency"],
  },
  chainHook: {
    key: "chainHook",
    name: "Chain Sickle",
    icon: "K",
    verb: "Throw a chain that drags the first enemy to you",
    tags: ["melee", "projectile"],
    damageKind: "melee",
    cooldown: SKILL.chainHook.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "speedVsDamage", "cooldownVsDamage"],
  },
  spiral: {
    key: "spiral",
    name: "Bullet Spiral",
    icon: "S",
    verb: "Spin out a spiral of bullets (slowed, no attacks)",
    tags: ["projectile", "channel"],
    damageKind: "ranged",
    cooldown: SKILL.spiral.cooldown,
    charges: 1,
    axes: ["countVsDamage", "speedVsDamage", "cooldownVsDamage"],
  },
  frostField: {
    key: "frostField",
    name: "Frost Field",
    icon: "F",
    verb: "Freeze the ground: chills and bites enemies (slows you too)",
    tags: ["cold", "area", "placed"],
    damageKind: "ranged",
    cooldown: SKILL.frostField.cooldown,
    charges: 1,
    axes: ["areaVsDamage", "durationVsPotency", "cooldownVsDamage"],
  },
};

const M = SKILL.modifier;

export const MODIFIERS: Record<ModifierKey, ModifierDef> = {
  multiCharge: {
    key: "multiCharge",
    name: "Multi",
    verb: `+${M.multiCharge.extraCharges} charges, damage x${M.multiCharge.damageMul}, CD x${M.multiCharge.cooldownMul}`,
    color: "#ffffff",
    excludesTags: [],
    apply: (p) => ({
      ...p,
      charges: p.charges + M.multiCharge.extraCharges,
      damageMul: p.damageMul * M.multiCharge.damageMul,
      cooldownMul: p.cooldownMul * M.multiCharge.cooldownMul,
    }),
  },
  bloodPrice: {
    key: "bloodPrice",
    name: "Blood Price",
    verb: `Damage x${M.bloodPrice.damageMul}, costs ${M.bloodPrice.hpFraction * 100}% max HP`,
    color: "#ff4040",
    excludesTags: [],
    apply: (p) => ({
      ...p,
      hpCostFraction: p.hpCostFraction + M.bloodPrice.hpFraction,
      damageMul: p.damageMul * M.bloodPrice.damageMul,
      potencyMul: p.potencyMul * M.bloodPrice.potencyMul,
    }),
  },
  comboFuel: {
    key: "comboFuel",
    name: "Combo Fuel",
    verb: `Consume combo: +${M.comboFuel.perStack * 100}%/hit (0 combo: x${M.comboFuel.emptyMul})`,
    color: "#ffd75f",
    excludesTags: [],
    apply: (p) => ({
      ...p,
      comboFuel: { perStack: M.comboFuel.perStack, cap: M.comboFuel.cap, emptyMul: M.comboFuel.emptyMul },
    }),
  },
  echo: {
    key: "echo",
    name: "Echo",
    verb: `Recast after ${M.echo.delay}s at ${M.echo.damageMul * 100}%, CD x${M.echo.cooldownMul}`,
    color: "#c080ff",
    excludesTags: ["defense", "buff"],
    apply: (p) => ({
      ...p,
      echo: { delay: M.echo.delay, damageMul: M.echo.damageMul },
      cooldownMul: p.cooldownMul * M.echo.cooldownMul,
    }),
  },
  pierce: {
    key: "pierce",
    name: "Pierce",
    verb: `Bullets / chains pass through +${M.pierce.count}, area x${M.pierce.areaMul}`,
    color: "#80ffc0",
    excludesTags: ["placed"],
    requiresTags: ["projectile"],
    // 撃ち抜きは元から全貫通
    excludesSkills: ["railshot"],
    apply: (p) => ({ ...p, pierce: p.pierce + M.pierce.count, areaMul: p.areaMul * M.pierce.areaMul }),
  },
  recoil: {
    key: "recoil",
    name: "Recoil",
    verb: `Hop back on cast (${M.recoil.invuln}s i-frames), damage x${M.recoil.damageMul}`,
    color: "#a0c0ff",
    // buff は威力を持たないので代償が空振りになる
    excludesTags: ["movement", "defense", "buff"],
    apply: (p) => ({ ...p, recoil: Math.max(p.recoil, M.recoil.speed), damageMul: p.damageMul * M.recoil.damageMul }),
  },
  chainReset: {
    key: "chainReset",
    name: "Chain",
    verb: `Kills with this skill refund a charge, CD x${M.chainReset.cooldownMul}`,
    color: "#ffff80",
    excludesTags: ["buff", "defense"],
    apply: (p) => ({ ...p, killRefund: true, cooldownMul: p.cooldownMul * M.chainReset.cooldownMul }),
  },
  curse: {
    key: "curse",
    name: "Curse",
    verb: `Hits curse ${M.curse.duration}s: +${M.curse.bonus * PERCENT_UNIT}% skill damage taken, damage x${M.curse.damageMul}`,
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
    name: "Delay",
    verb: `Goes off ${M.delay.time}s later where cast, damage x${M.delay.damageMul}`,
    color: "#ff80c0",
    excludesTags: ["defense", "buff", "movement", "channel"],
    apply: (p) => ({ ...p, delay: { time: M.delay.time, damageMul: M.delay.damageMul } }),
  },
  expand: {
    key: "expand",
    name: "Expand",
    verb: `Area x${M.expand.areaMul}, CD x${M.expand.cooldownMul}`,
    color: "#60a0ff",
    excludesTags: [],
    requiresTags: ["area"],
    apply: (p) => ({ ...p, areaMul: p.areaMul * M.expand.areaMul, cooldownMul: p.cooldownMul * M.expand.cooldownMul }),
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
    cooldownMul: 1,
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
  };
}

function applyVariant(p: CastParams, roll: VariantRoll): CastParams {
  const v = roll.value;
  const c = VARIANT_COEF[roll.axis];
  switch (roll.axis) {
    case "areaVsDamage":
      return { ...p, areaMul: p.areaMul * (1 + c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "cooldownVsDamage":
      return { ...p, cooldownMul: p.cooldownMul * (1 - c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "speedVsDamage":
      return { ...p, timeMul: p.timeMul * (1 - c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "countVsDamage":
      return { ...p, countBonus: p.countBonus + Math.round(c.gain * v), damageMul: p.damageMul * (1 - c.cost * v) };
    case "durationVsPotency":
      return { ...p, durationMul: p.durationMul * (1 + c.gain * v), potencyMul: p.potencyMul * (1 - c.cost * v) };
    case "cooldownVsPotency":
      return { ...p, cooldownMul: p.cooldownMul * (1 - c.gain * v), potencyMul: p.potencyMul * (1 - c.cost * v) };
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
  p = { ...p, cooldownMul: p.cooldownMul * (1 + SKILL.linkCooldownPenalty * stone.links) };
  for (const key of activeModifiers(def, stone.links, modifiers)) p = MODIFIERS[key].apply(p);
  return p;
}

/** CD の秒数（stats の CD 短縮は未実装なので def × params のみ） */
export function castCooldown(def: SkillDef, params: Readonly<CastParams>): number {
  return def.cooldown * params.cooldownMul;
}

const AXIS_LABEL: Record<VariantAxis, readonly [string, string]> = {
  areaVsDamage: ["Area", "Damage"],
  cooldownVsDamage: ["Cooldown", "Damage"],
  speedVsDamage: ["Speed", "Damage"],
  countVsDamage: ["Count", "Damage"],
  durationVsPotency: ["Duration", "Potency"],
  cooldownVsPotency: ["Cooldown", "Potency"],
};

const PERCENT = PERCENT_UNIT;

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** ツールチップ用の 1 行。例: "Area +24% / Damage -18%" */
export function formatVariant(roll: VariantRoll): string {
  const c = VARIANT_COEF[roll.axis];
  const [gainLabel, costLabel] = AXIS_LABEL[roll.axis];
  const v = roll.value;
  const cost = `${costLabel} ${signed(Math.round(-c.cost * v * PERCENT))}%`;
  if (roll.axis === "countVsDamage") return `${gainLabel} ${signed(Math.round(c.gain * v))} / ${cost}`;
  // CD は短くなる向きが「伸びる」側
  const shrinks = roll.axis === "cooldownVsDamage" || roll.axis === "cooldownVsPotency" || roll.axis === "speedVsDamage";
  const gainSign = shrinks ? -1 : 1;
  const label = roll.axis === "speedVsDamage" ? "Cast time" : gainLabel;
  return `${label} ${signed(Math.round(gainSign * c.gain * v * PERCENT))}% / ${cost}`;
}

/** 石の表示名: スキル名 + リンク記号 */
export function stoneLabel(stone: SkillStone): string {
  return `${SKILL_DEFS[stone.skillKey].name} ${"◆".repeat(stone.links)}${"◇".repeat(SKILL.maxLinks - stone.links)}`;
}
