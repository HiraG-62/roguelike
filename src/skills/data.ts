import { type AttackProfile, attack } from "../core/element";
import { kw } from "../core/keywords";
import type { StatusApply } from "../core/status";
import { BALANCE } from "../data/balance";
import { STATUS } from "../data/tuning";
import { EXTRA_SKILL_DEFS } from "./defs";
import { WAVE2_SKILL_DEFS } from "./defs2";
import { WAVE3_SKILL_DEFS } from "./defs3";
import { EXTRA_MODIFIERS, RESOURCE_CONVERTERS } from "./modifiers";
import { WAVE2_MODIFIERS } from "./modifiers2";
import { IRON_SWING_STEP, WOLF_BITE_STEP } from "./reshapes";
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
import { cooldownSkill, manaSkill } from "./resource";

type BaseSkillKey = (typeof BASE_SKILL_KEYS)[number];
type BaseModifierKey = (typeof BASE_MODIFIER_KEYS)[number];

/** 割合 → % 表記 */
const PERCENT_UNIT = 100;

const B = BALANCE.skills;

/** 使い込み（skills/wear.ts）の芽の数値。docs/ideas/skills-expansion.md 5 章。数値は data/balance/skills.json の WEAR_TUNING */
const WEAR_TUNING = B.WEAR_TUNING;

/**
 * スキルの数値。数値本体は data/balance/skills.json（docs/ideas/skills.md「7-5」、docs/COMBAT_DESIGN.md B-2 / B-4 の解説や
 * QA での調整履歴は各エントリの _note に転記済み）。damage は Scaling（base + 係数 × ステータス実効値）。
 * ステータスが基礎値（各 5）のとき旧来の固定値と一致する。
 * wolfForm.bite / ironForm.swing だけは union 文字列（HitShape の kind）を含むため skills/reshapes.ts の TS 定数から合流させる
 * （docs/ideas/data-externalization.md 2 章の境界規則）
 */
export const SKILL = {
  ...B.SKILL,
  ...B.EXTRA_SKILL_TUNING,
  ...B.WAVE2_SKILL_TUNING,
  ...B.WAVE3_SKILL_TUNING,
  wolfForm: { ...B.WAVE3_SKILL_TUNING.wolfForm, bite: WOLF_BITE_STEP },
  ironForm: { ...B.WAVE3_SKILL_TUNING.ironForm, swing: IRON_SWING_STEP },
  modifier: { ...B.SKILL.modifier, ...B.EXTRA_MODIFIER_TUNING, ...B.WAVE2_MODIFIER_TUNING },
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
  // 第 2 弾: 大拡張と同じく 1 種あたりは薄め。変身は珍しめ
  waterJar: 6,
  oilPot: 6,
  scorchLine: 6,
  iceSlide: 5,
  levelGround: 5,
  emberDraw: 5,
  bogCall: 5,
  brandSear: 6,
  brandBlast: 5,
  breakKick: 6,
  collapseHammer: 5,
  tideSlash: 6,
  flashFreeze: 5,
  hueEtch: 5,
  hueRelease: 5,
  siphonMark: 5,
  doomSentence: 5,
  shiftingEdge: 6,
  weaponArt: 6,
  titanForm: 4,
  swiftForm: 4,
  spiritForm: 4,
  wardStake: 5,
  mire: 5,
  wolfForm: 3,
  wraithForm: 3,
  siegeForm: 3,
  ironForm: 3,
  pyreForm: 3,
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
  // 第 2 弾: 地形・素直な付与は 1 層目から、それを「食う」技と変身・空間は 2〜3 層目から
  waterJar: 1,
  oilPot: 1,
  scorchLine: 1,
  iceSlide: 1,
  levelGround: 2,
  emberDraw: 2,
  bogCall: 2,
  brandSear: 1,
  brandBlast: 2,
  breakKick: 1,
  collapseHammer: 2,
  tideSlash: 1,
  flashFreeze: 2,
  hueEtch: 2,
  hueRelease: 2,
  siphonMark: 2,
  doomSentence: 3,
  shiftingEdge: 1,
  weaponArt: 1,
  titanForm: 3,
  swiftForm: 3,
  spiritForm: 3,
  wardStake: 2,
  mire: 2,
  wolfForm: 3,
  wraithForm: 3,
  siegeForm: 3,
  ironForm: 3,
  pyreForm: 3,
};

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
    keywords: kw(["melee", "area"]),
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
    keywords: kw(["melee", "dash"]),
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
    keywords: kw(["explode", "area"]),
    damageKind: "ranged",
    axes: ["areaVsDamage", "cooldownVsDamage", "speedVsDamage", "countVsDamage"],
    ...manaSkill(SKILL.frag),
    combos: ["wellFrag"],
  },
  railshot: {
    key: "railshot",
    name: "撃ち抜き",
    icon: "R",
    verb: "照準してから、壁まで貫通するビームを撃つ",
    tags: ["projectile"],
    keywords: kw(["ranged", "bullet"]),
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
    verb: "構える。受け止めた攻撃は見切りになり、再使用時間が戻る",
    tags: ["defense", "melee"],
    keywords: kw(["just", "counter"], ["hurt"]),
    damageKind: "melee",
    axes: ["areaVsDamage", "cooldownVsDamage"],
    ...cooldownSkill(SKILL.parry, SKILL.parry.poise),
  },
  bloodPact: {
    key: "bloodPact",
    name: "血の契約",
    icon: "B",
    verb: "生命を払って攻撃速度と吸血を得る",
    tags: ["buff"],
    keywords: kw(["lowHp", "heal"], [], ["melee"]),
    damageKind: "none",
    axes: ["durationVsPotency"],
    ...cooldownSkill(SKILL.bloodPact, 0),
    buffScaling: SKILL.bloodPact.buff,
  },
  quake: {
    key: "quake",
    name: "地裂き",
    icon: "Q",
    verb: "溜めてから前方扇状に衝撃波を放つ（溜め中の被弾で中断）",
    tags: ["melee", "area"],
    keywords: kw(["area", "wall", "stagger", "still"]),
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
    keywords: kw(["placed", "area"]),
    damageKind: "ranged",
    axes: ["areaVsDamage", "speedVsDamage", "countVsDamage"],
    ...manaSkill(SKILL.thunder),
    combos: ["wellThunder", "frostThunder"],
    applies: APPLIES.thunder,
  },
  gravityWell: {
    key: "gravityWell",
    name: "引力球",
    icon: "O",
    verb: "設置した場所へ範囲内の敵（と敵弾）を引き寄せる",
    tags: ["area", "placed"],
    keywords: kw(["placed", "area"]),
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
    keywords: kw(["placed", "explode"]),
    damageKind: "ranged",
    axes: ["countVsDamage", "areaVsDamage", "cooldownVsDamage"],
    ...manaSkill(SKILL.mines),
  },
  haste: {
    key: "haste",
    name: "加速",
    icon: "H",
    verb: "ダッシュの再使用時間が無くなり移動速度が上がる。切れた後はダッシュ不可",
    tags: ["buff", "movement"],
    keywords: kw(["dash"], [], ["dash"]),
    damageKind: "none",
    axes: ["durationVsPotency", "cooldownVsPotency"],
    ...cooldownSkill(SKILL.haste, 0),
    buffScaling: SKILL.haste.buff,
  },
  chainHook: {
    key: "chainHook",
    name: "鎖鎌",
    icon: "K",
    verb: "鎖を伸ばし、最初に当たった敵を手元へ引き寄せる",
    tags: ["melee", "projectile"],
    keywords: kw(["melee"]),
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
    keywords: kw(["ranged", "bullet", "still"]),
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
    keywords: kw(["chill", "placed", "area"]),
    damageKind: "ranged",
    axes: ["areaVsDamage", "durationVsPotency", "cooldownVsDamage"],
    ...manaSkill(SKILL.frostField),
  },
};

/**
 * 排他グループ body（体を使う本動作）のスキル。SkillRunState.active を使うもの（近接・移動・照準の本動作）と、
 * プレイヤー自身を瞬間移動させる影渡り。active は 1 つだけなので、active を使うスキルは必ずここに入れる
 * （system/skills.test.ts が全スキルを撃って active の有無と突き合わせる）。docs/COMBAT_DESIGN.md B-9
 */
export const BODY_SKILL_KEYS: readonly SkillKey[] = [
  "whirl",
  "lunge",
  "railshot",
  "parry",
  "quake",
  "chainHook",
  "spiral",
  "dregsBlade",
  "comboChain",
  "guillotine",
  "stomp",
  "threadReel",
  "meteorDive",
  "swallowFlip",
  "shadowStep",
  "iceSlide",
];

function withExclusiveGroups(defs: Record<SkillKey, SkillDef>): Record<SkillKey, SkillDef> {
  const out = { ...defs };
  for (const key of BODY_SKILL_KEYS) out[key] = { ...out[key], exclusiveGroup: "body" };
  return out;
}

export const SKILL_DEFS: Record<SkillKey, SkillDef> = withExclusiveGroups({ ...BASE_SKILL_DEFS, ...EXTRA_SKILL_DEFS, ...WAVE2_SKILL_DEFS, ...WAVE3_SKILL_DEFS });

const M = SKILL.modifier;

const BASE_MODIFIERS: Record<BaseModifierKey, ModifierDef> = {
  multiCharge: {
    key: "multiCharge",
    name: "多重",
    verb: `チャージ +${M.multiCharge.extraCharges}、ダメージ x${M.multiCharge.damageMul}、再使用時間 x${M.multiCharge.burdenMul}`,
    manaVerb: `コスト x${M.multiCharge.manaBurdenMul}、連打間隔 x${M.multiCharge.intervalMul}、ダメージ x${M.multiCharge.damageMul}`,
    color: "#ffffff",
    keywords: kw([], [], ["mana"]),
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
    verb: `ダメージ x${M.bloodPrice.damageMul}、最大生命の${M.bloodPrice.hpFraction * PERCENT_UNIT}%を消費`,
    manaVerb: `ダメージ x${M.bloodPrice.damageMul}、最大生命の${M.bloodPrice.hpFraction * PERCENT_UNIT}%を消費してコスト x${M.bloodPrice.manaBurdenMul}`,
    color: "#ff4040",
    keywords: kw(["lowHp"]),
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
    keywords: kw([], ["combo"]),
    excludesTags: [],
    apply: (p) => ({
      ...p,
      comboFuel: { perStack: M.comboFuel.perStack, cap: M.comboFuel.cap, emptyMul: M.comboFuel.emptyMul },
    }),
  },
  echo: {
    key: "echo",
    name: "反響",
    verb: `${M.echo.delay}秒後に${M.echo.damageMul * PERCENT_UNIT}%の威力で再発動、再使用時間 x${M.echo.burdenMul}`,
    manaVerb: `${M.echo.delay}秒後に${M.echo.damageMul * PERCENT_UNIT}%の威力で再発動、コスト x${M.echo.burdenMul}`,
    color: "#c080ff",
    keywords: kw([], [], ["area"]),
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
    keywords: kw([], [], ["bullet"]),
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
    keywords: kw(["dash", "ward"]),
    // buff は威力を持たないので代償が空振りになる
    excludesTags: ["movement", "defense", "buff"],
    apply: (p) => ({ ...p, recoil: Math.max(p.recoil, M.recoil.speed), damageMul: p.damageMul * M.recoil.damageMul }),
  },
  chainReset: {
    key: "chainReset",
    name: "連鎖",
    verb: `このスキルでの撃破でチャージが1回復、再使用時間 x${M.chainReset.burdenMul}`,
    manaVerb: `このスキルでの撃破でコストの${M.chainReset.manaRefund * PERCENT_UNIT}%を返す、コスト x${M.chainReset.manaBurdenMul}`,
    color: "#ffff80",
    keywords: kw(["mana"], ["kill"]),
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
    keywords: kw(["vulnerable"]),
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
    keywords: kw(["placed"]),
    // 変身は発動地点で後から起こしても変身しない（衝撃だけになる）
    excludesTags: ["defense", "buff", "movement", "channel", "form"],
    apply: (p) => ({ ...p, delay: { time: M.delay.time, damageMul: M.delay.damageMul } }),
  },
  expand: {
    key: "expand",
    name: "拡大",
    verb: `範囲 x${M.expand.areaMul}、再使用時間 x${M.expand.burdenMul}`,
    manaVerb: `範囲 x${M.expand.areaMul}、コスト x${M.expand.burdenMul}`,
    color: "#60a0ff",
    keywords: kw([], [], ["area"]),
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
    keywords: kw(["still"]),
    // パリィ/血の契約/加速は「押した瞬間」に意味がある即応スキル、回転弾幕はチャネル系で「溜めて離す」と噛み合わない
    excludesTags: ["defense", "buff", "channel"],
    excludesModifiers: ["toStaged"],
    // 実際の倍率は system/skills.ts が発動時の経過秒から計算して CastParams に掛けるので、ここでは素通し
    apply: (p) => p,
  },
};

export const MODIFIERS: Record<ModifierKey, ModifierDef> = { ...BASE_MODIFIERS, ...EXTRA_MODIFIERS, ...WAVE2_MODIFIERS };

/** 相性表: 除外タグ・必須タグ・個別除外・資源・付与の有無・与ダメの有無のすべてを満たすか */
export function canAttach(def: SkillDef, key: ModifierKey): boolean {
  const m = MODIFIERS[key];
  if (m.excludesTags.some((t) => def.tags.includes(t))) return false;
  if (m.requiresTags && !m.requiresTags.some((t) => def.tags.includes(t))) return false;
  if (m.requiresResource && m.requiresResource !== def.resource) return false;
  if (m.requiresApplies && !def.applies) return false;
  if (m.requiresDamage && def.damageKind === "none") return false;
  if (m.onlySkills && !m.onlySkills.includes(def.key)) return false;
  return !(m.excludesSkills?.includes(def.key) ?? false);
}

/** 刻印符が使うリンクの本数（型替え符は 2） */
export function modifierLinkCost(key: ModifierKey): number {
  return MODIFIERS[key].linkCost ?? 1;
}

/** a と b が同じスロットで同時に効かないか（どちらかが相手を excludesModifiers に持つ） */
export function modifiersClash(a: ModifierKey, b: ModifierKey): boolean {
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
    element: null,
    extraApplies: [],
    hueInfuse: false,
    leyline: false,
    leyPool: { left: 0 },
    crumble: false,
    jobMastery: false,
    weaponBond: false,
    formSurge: false,
    formDurationMul: 1,
    formRecoverMul: 1,
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
  // 使い込みの芽: 枠の芽で増えたリンクは負担に数えない、威力の芽は威力と効果量を伸ばす
  const wear = wearPowerMul(stone);
  p = {
    ...p,
    burdenMul: p.burdenMul * (1 + SKILL.linkBurdenPenalty * burdenLinks(stone)),
    damageMul: p.damageMul * wear,
    potencyMul: p.potencyMul * wear,
  };
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
export const BURDEN_LABEL: Record<SkillResource, string> = { mana: "コスト", cooldown: "再使用" };

const AXIS_LABEL: Record<VariantAxis, readonly [string, string]> = {
  areaVsDamage: ["範囲", "ダメージ"],
  cooldownVsDamage: ["再使用", "ダメージ"],
  speedVsDamage: ["速度", "ダメージ"],
  countVsDamage: ["回数", "ダメージ"],
  durationVsPotency: ["持続", "効果量"],
  cooldownVsPotency: ["再使用", "効果量"],
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

/** 石の表示名: スキル名 + リンク記号（使い込みの枠の芽で上限を超えたリンクも ◆ で出す） */
export function stoneLabel(stone: SkillStone): string {
  return `${SKILL_DEFS[stone.skillKey].name} ${"◆".repeat(stone.links)}${"◇".repeat(Math.max(0, SKILL.maxLinks - stone.links))}`;
}

// ---------------------------------------------------------------------------
// 使い込み（docs/ideas/skills-expansion.md 5 章）の純粋な読み出し。記録は skills/wear.ts
// ---------------------------------------------------------------------------

/** 出た芽のうち、この種類の数 */
export function wearBudCount(stone: Readonly<SkillStone>, bud: "link" | "power"): number {
  return (stone.wear?.buds ?? []).filter((b) => b === bud).length;
}

/** 枠の芽で増えたリンク（上限は WEAR_TUNING.maxBonusLinks） */
export function wearBonusLinks(stone: Readonly<SkillStone>): number {
  return Math.min(WEAR_TUNING.maxBonusLinks, wearBudCount(stone, "link"));
}

/** 威力の芽の倍率 */
export function wearPowerMul(stone: Readonly<SkillStone>): number {
  return 1 + WEAR_TUNING.powerPerBud * wearBudCount(stone, "power");
}

/** 負担（リンク 1 本ごとの +15%）に数えるリンク。枠の芽のぶんは数えない */
export function burdenLinks(stone: Readonly<SkillStone>): number {
  return Math.max(0, stone.links - wearBonusLinks(stone));
}

/** この石が持てるリンクの上限（基本の上限 + 枠の芽） */
export function maxStoneLinks(stone: Readonly<SkillStone>): number {
  return SKILL.maxLinks + wearBonusLinks(stone);
}

// ---------------------------------------------------------------------------
// 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）
// ---------------------------------------------------------------------------

/**
 * スキルごとの攻撃の素性。null は与ダメを持たないスキル（強化・移動・設置の補助）。
 * ジャンルは Scaling の参照ステータスと揃える（主か副を必ず含む。skills/skills.test.ts が検査する）。
 * 体力で伸びる震脚・恨み返し・巻き戻し・傷返しは「体を張る」系で、既定表の副（範囲・物理 = 体力）か筋力で揃えている
 */
export const SKILL_ATTACK: Readonly<Record<SkillKey, AttackProfile | null>> = {
  whirl: attack("melee", "hybrid"),
  lunge: attack("melee", "physical"),
  frag: attack("area", "hybrid", "fire"),
  railshot: attack("ranged", "hybrid", "light"),
  parry: attack("melee", "hybrid"),
  bloodPact: null,
  quake: attack("area", "physical"),
  thunder: attack("area", "arcane", "lightning"),
  gravityWell: attack("area", "arcane", "dark"),
  mines: attack("area", "hybrid", "fire"),
  haste: null,
  chainHook: attack("melee", "physical"),
  spiral: attack("ranged", "hybrid"),
  frostField: attack("area", "arcane", "ice"),
  contagion: null,
  unravel: attack("ranged", "arcane"),
  kindle: attack("area", "arcane", "fire"),
  prismShard: attack("ranged", "hybrid"),
  fullMoon: attack("ranged", "arcane", "light"),
  dregsBlade: attack("melee", "hybrid"),
  shadowStep: null,
  powderKeg: attack("area", "hybrid", "fire"),
  swordGrave: attack("melee", "hybrid"),
  iceBreaker: attack("melee", "physical", "ice"),
  bloodlet: attack("melee", "hybrid", "dark"),
  harvest: attack("ranged", "hybrid", "poison"),
  discharge: attack("area", "arcane", "lightning"),
  rout: attack("ranged", "physical"),
  verdict: attack("melee", "hybrid", "light"),
  exploit: attack("melee", "physical"),
  strip: attack("ranged", "arcane", "dark"),
  lastStand: attack("melee", "physical"),
  comboChain: attack("melee", "physical"),
  grudge: attack("melee", "physical"),
  guillotine: attack("melee", "physical"),
  ricochet: attack("ranged", "physical"),
  galeSlash: attack("ranged", "physical"),
  scatterSigil: attack("ranged", "physical"),
  stomp: attack("area", "physical"),
  threadReel: attack("ranged", "physical"),
  meteorDive: attack("area", "hybrid", "fire"),
  swallowFlip: attack("melee", "physical"),
  boneRing: null,
  backflow: attack("melee", "physical"),
  scarRoar: attack("area", "arcane"),
  manaSpring: null,
  turret: attack("ranged", "physical"),
  // 第 2 弾（移ろい刃・奥義は発動時に属性を差し替える。ここは名目の無属性）
  waterJar: attack("area", "arcane"),
  oilPot: attack("area", "hybrid"),
  scorchLine: attack("area", "arcane", "fire"),
  iceSlide: attack("melee", "physical", "ice"),
  levelGround: attack("area", "physical"),
  emberDraw: attack("ranged", "arcane", "fire"),
  bogCall: attack("area", "arcane", "poison"),
  brandSear: attack("melee", "hybrid", "fire"),
  brandBlast: attack("area", "arcane", "fire"),
  breakKick: attack("melee", "physical"),
  collapseHammer: attack("melee", "physical"),
  tideSlash: attack("ranged", "physical"),
  flashFreeze: attack("area", "arcane", "ice"),
  hueEtch: attack("melee", "hybrid"),
  hueRelease: attack("area", "arcane"),
  siphonMark: attack("ranged", "arcane", "dark"),
  doomSentence: attack("area", "arcane", "dark"),
  shiftingEdge: attack("melee", "hybrid"),
  weaponArt: attack("melee", "hybrid"),
  titanForm: attack("area", "physical"),
  swiftForm: attack("melee", "physical"),
  spiritForm: attack("area", "arcane", "light"),
  wardStake: attack("area", "hybrid"),
  mire: attack("area", "arcane"),
  // 第 3 弾の変身（噛みつき・重い振りは近接の仕組みで当てるので、変身そのものは与ダメを持たない。砲撃だけが持つ）
  wolfForm: null,
  wraithForm: null,
  siegeForm: attack("ranged", "physical"),
  ironForm: null,
  pyreForm: null,
};

/** スキルの攻撃の素性（与ダメを持たないスキルは null） */
export function skillAttack(key: SkillKey): AttackProfile | null {
  return SKILL_ATTACK[key];
}
