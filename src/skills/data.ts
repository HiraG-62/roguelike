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
  modifier: {
    multiCharge: { extraCharges: 2, damageMul: 0.7, cooldownMul: 1.3 },
    bloodPrice: { hpFraction: 0.06, damageMul: 1.6, potencyMul: 1.6 },
    comboFuel: { perStack: 0.04, cap: 1.2, emptyMul: 0.8 },
    echo: { delay: 0.8, damageMul: 0.5, cooldownMul: 1.25 },
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
};

export function canAttach(def: SkillDef, key: ModifierKey): boolean {
  return !MODIFIERS[key].excludesTags.some((t) => def.tags.includes(t));
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
};

const PERCENT = 100;

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
  const gainSign = roll.axis === "cooldownVsDamage" || roll.axis === "speedVsDamage" ? -1 : 1;
  const label = roll.axis === "speedVsDamage" ? "Cast time" : gainLabel;
  return `${label} ${signed(Math.round(gainSign * c.gain * v * PERCENT))}% / ${cost}`;
}

/** 石の表示名: スキル名 + リンク記号 */
export function stoneLabel(stone: SkillStone): string {
  return `${SKILL_DEFS[stone.skillKey].name} ${"◆".repeat(stone.links)}${"◇".repeat(SKILL.maxLinks - stone.links)}`;
}
