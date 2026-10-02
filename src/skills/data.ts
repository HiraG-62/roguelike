import { type AttackProfile, attack } from "../core/element";
import { kw } from "../core/keywords";
import type { StatusApply } from "../core/status";
import { BALANCE } from "../data/balance";
import type { FormKey } from "../data/weaponForms";
import { ART_ATTACK, ART_DEFS, ART_MIN_DEPTH, ART_SKILL_DEFS, ART_WEIGHTS, isArtKey } from "./arts";
import { formTransformLine } from "./arts/transform";
import { EXTRA_SKILL_DEFS } from "./defs";
import { WAVE2_SKILL_DEFS } from "./defs2";
import { WAVE3_SKILL_DEFS } from "./defs3";
import { BASE_MODIFIERS, EXTRA_MODIFIERS } from "./modifiers";
import { WAVE2_MODIFIERS } from "./modifiers2";
import { IRON_SWING_STEP, WOLF_BITE_STEP } from "./reshapes";
import type {
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

/** 割合 → % 表記 */
const PERCENT_UNIT = 100;

const B = BALANCE.skills;

/** 使い込み（skills/wear.ts）の芽の数値。docs/ideas/skills-expansion.md 5 章。数値は data/balance/skills/ の WEAR_TUNING */
const WEAR_TUNING = B.WEAR_TUNING;

/**
 * スキルの数値。数値本体は data/balance/skills/（docs/ideas/skills.md「7-5」、docs/COMBAT_DESIGN.md B-2 / B-4 の解説や
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
 * スキル石の抽選の重み。最小実装からの 7 を少し厚めにし、追加スキルは 1 種あたりやや薄くする
 * （序盤に見慣れたスキルが出にくくなりすぎないように）
 */
export const SKILL_WEIGHTS: Record<SkillKey, number> = {
  parry: 10,
  bloodPact: 10,
  gravityWell: 7,
  mines: 8,
  haste: 7,
  chainHook: 8,
  frostField: 7,
  // 大拡張: 1 種あたりは既存より薄く（種類が多いので合計では十分出る）
  contagion: 6,
  unravel: 6,
  kindle: 6,
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
  backflow: 5,
  scarRoar: 5,
  manaSpring: 5,
  turret: 5,
  // 第 2 弾: 大拡張と同じく 1 種あたりは薄め。変身は珍しめ
  waterJar: 6,
  oilPot: 6,
  levelGround: 5,
  emberDraw: 5,
  brandSear: 6,
  brandBlast: 5,
  flashFreeze: 5,
  hueEtch: 5,
  hueRelease: 5,
  doomSentence: 5,
  shiftingEdge: 6,
  wardStake: 5,
  mire: 5,
  wolfForm: 3,
  wraithForm: 3,
  siegeForm: 3,
  ironForm: 3,
  pyreForm: 3,
  // 技（skills/arts/）: 共通技 1 種あたりの重み（ART.weight。武器種に依らない）
  ...ART_WEIGHTS,
};

/**
 * この深度から拾えるスキル。状態異常を「食う」スキルは、装備や祝福で状態異常を「出す」手段が
 * 揃い始める 2 層目から。変わり種（召喚・特殊な資源）は 3 層目から
 */
export const SKILL_MIN_DEPTH: Record<SkillKey, number> = {
  parry: 1,
  bloodPact: 1,
  gravityWell: 1,
  mines: 1,
  haste: 1,
  chainHook: 1,
  frostField: 1,
  contagion: 2,
  unravel: 2,
  kindle: 2,
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
  backflow: 3,
  scarRoar: 3,
  manaSpring: 2,
  turret: 3,
  // 第 2 弾: 地形・素直な付与は 1 層目から、それを「食う」技と変身・空間は 2〜3 層目から
  waterJar: 1,
  oilPot: 1,
  levelGround: 2,
  emberDraw: 2,
  brandSear: 1,
  brandBlast: 2,
  flashFreeze: 2,
  hueEtch: 2,
  hueRelease: 2,
  doomSentence: 3,
  shiftingEdge: 1,
  wardStake: 2,
  mire: 2,
  wolfForm: 3,
  wraithForm: 3,
  siegeForm: 3,
  ironForm: 3,
  pyreForm: 3,
  ...ART_MIN_DEPTH,
};

/** 命中した敵に付ける状態異常（docs/COMBAT_DESIGN.md B-4 の「付与」列） */
const APPLIES = {
  gravityWell: [{ kind: "silence", stacks: 1, duration: SKILL.gravityWell.silenceTime, potency: 0 }],
  chainHook: [
    { kind: "bleed", stacks: SKILL.chainHook.bleedStacks, duration: SKILL.chainHook.bleedTime, potency: SKILL.chainHook.bleedPotency, ratio: SKILL.chainHook.bleedPotencyRatio },
  ],
} as const satisfies Partial<Record<SkillKey, readonly StatusApply[]>>;

const BASE_SKILL_DEFS: Record<BaseSkillKey, SkillDef> = {
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
 * 排他グループ body（体を使う本動作）のスキル。SkillRunState.active を使うもの（構え・鎖・連続突き）。
 * active は 1 つだけなので、active を使うスキルは必ずここに入れる
 * （system/skills.test.ts が全スキルを撃って active の有無と突き合わせる）。docs/COMBAT_DESIGN.md B-9
 */
export const BODY_SKILL_KEYS: readonly SkillKey[] = ["parry", "chainHook", "comboChain"];

function withExclusiveGroups(defs: Record<SkillKey, SkillDef>): Record<SkillKey, SkillDef> {
  const out = { ...defs };
  for (const key of BODY_SKILL_KEYS) out[key] = { ...out[key], exclusiveGroup: "body" };
  return out;
}

export const SKILL_DEFS: Record<SkillKey, SkillDef> = withExclusiveGroups({
  ...BASE_SKILL_DEFS,
  ...EXTRA_SKILL_DEFS,
  ...WAVE2_SKILL_DEFS,
  ...WAVE3_SKILL_DEFS,
  ...ART_SKILL_DEFS,
});

export const MODIFIERS: Record<ModifierKey, ModifierDef> = { ...BASE_MODIFIERS, ...EXTRA_MODIFIERS, ...WAVE2_MODIFIERS };

/**
 * 相性表。技（行為の列で書くスキル）への行為の列を変える符（transform / fitsArt を持つ）は行為の列で決め（fitsArtAct）、
 * それ以外はタグ・資源・与ダメの有無・個別除外で決める。行為の列を変える符は手書きのスキルには付かない
 * （型替え符〔reshape〕は手書きには apply の型替えで効くので、手書きにはタグで決める）
 */
export function canAttach(def: SkillDef, key: ModifierKey): boolean {
  const m = MODIFIERS[key];
  if (m.requiresResource && m.requiresResource !== def.resource) return false;
  if (m.requiresDamage && def.damageKind === "none") return false;
  if (m.excludesSkills?.includes(def.key)) return false;
  const actsModifier = m.transform !== undefined || m.fitsArt !== undefined;
  if (actsModifier && isArtKey(def.key)) return fitsArtAct(key, def.key);
  if (actsModifier && !m.reshape) return false;
  if (m.excludesTags.some((t) => def.tags.includes(t))) return false;
  return !m.requiresTags || m.requiresTags.some((t) => def.tags.includes(t));
}

/** 行為の列を変える符が技に付くか（読み込み時の行為の列で 1 回だけ判定して覚える。純関数の結果なので決定性に関わらない） */
const artFitCache = new Map<string, boolean>();

function fitsArtAct(key: ModifierKey, art: SkillKey): boolean {
  if (!isArtKey(art)) return false;
  const id = `${key}:${art}`;
  const hit = artFitCache.get(id);
  if (hit !== undefined) return hit;
  const m = MODIFIERS[key];
  const acts = ART_DEFS[art].acts;
  // fitsArt が無い符は、当てて行為の列が変わるなら付く（変わらない技に付けても空振りなので）
  const fits = m.fitsArt ? m.fitsArt(acts) : m.transform !== undefined && JSON.stringify(m.transform(acts, NO_NUMBERS)) !== JSON.stringify(acts);
  artFitCache.set(id, fits);
  return fits;
}

/** 刻印符の transform は自分の数値をそれぞれの定義で読むので、変形の数値の表は空で渡す */
export const NO_NUMBERS: Readonly<Record<string, number>> = {};

/** 刻印符が使うリンクの本数（型替え符は 2） */
export function modifierLinkCost(key: ModifierKey): number {
  return MODIFIERS[key].linkCost ?? 1;
}

/** スロット（0 始まり）に付けられるリンクの本数。石ごとには持たず、スロットで固定（SKILL.slotLinks） */
export function slotLinks(slot: number): number {
  return SKILL.slotLinks[slot] ?? 0;
}

/** a と b が同じスロットで同時に効かないか（どちらかが相手を excludesModifiers に持つ） */
export function modifiersClash(a: ModifierKey, b: ModifierKey): boolean {
  return (MODIFIERS[a].excludesModifiers?.includes(b) ?? false) || (MODIFIERS[b].excludesModifiers?.includes(a) ?? false);
}

/**
 * スロットの修飾子のうち実際に効くもの。付けられるものを古い順に、リンクの残りに収まる限り採る。
 * 型替え符は 1 枚まで、排他の組は古い方だけが効く。
 * dwell は石の宿り符（docs/ideas/skill-stone-hunt.md）: リンクを使わずに先頭で効き、ぶつかる符より優先する。
 * 同じ符をラン内で付けても重ねて効かせず、そちらはリンクも使わない
 */
export function activeModifiers(def: SkillDef, links: number, modifiers: readonly ModifierKey[], dwell?: ModifierKey): ModifierKey[] {
  const out: ModifierKey[] = dwell !== undefined && canAttach(def, dwell) ? [dwell] : [];
  let used = 0;
  for (const key of modifiers) {
    if (key === dwell) continue;
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
    echo: null,
    ghost: null,
    pierce: 0,
    delay: null,
    slot: -1,
    intervalMul: 1,
    skillKey: def.key,
    manaPaid: 0,
    refundPool: { left: 0 },
    resource: def.resource,
    baseCost: def.manaCost,
    baseCooldown: def.cooldown,
    poiseMul: 1,
    knockbackMul: 1,
    statusDurationMul: 1,
    refundPerHit: 0,
    hitRefundPool: { left: 0 },
    bloodPrice: false,
    spillover: false,
    streak: false,
    overheat: false,
    patience: false,
    sympathy: false,
    desperate: false,
    offering: false,
    ledger: false,
    reshape: null,
    combo: null,
    origin: { x: 0, y: 0 },
    hitLog: new Set(),
    element: null,
    leyline: false,
    leyPool: { left: 0 },
    chain: false,
    chainPool: { left: 0 },
    burst: false,
    burstPool: { left: 0 },
    artTransforms: [],
    shotPath: null,
    trail: false,
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
 * スキルに無い変異軸は無視する（壊れたセーブ対策）。刻印符の本数の上限は slot のリンク（省略はスキル 1 の枠）
 */
export function resolveCast(def: SkillDef, stone: SkillStone, modifiers: readonly ModifierKey[], slot = 0): CastParams {
  let p = baseCastParams(def);
  for (const roll of stone.variants) {
    if (def.axes.includes(roll.axis)) p = applyVariant(p, roll);
  }
  // 使い込みの芽: 威力と効果量を伸ばす
  const wear = wearPowerMul(stone);
  p = { ...p, damageMul: p.damageMul * wear, potencyMul: p.potencyMul * wear };
  for (const key of activeModifiers(def, slotLinks(slot), modifiers, stone.dwell)) p = MODIFIERS[key].apply(p, def);
  return p;
}

/** 1 回の発動の負担。マナ型はコスト（CD 0）、CD 型は CD の秒数（コスト 0）。docs/COMBAT_DESIGN.md B-6 */
export interface CastBurden {
  cost: number;
  cooldown: number;
}

/** 資源は params.resource。基準値も params が持つ */
export function castBurden(_def: SkillDef, params: Readonly<CastParams>): CastBurden {
  if (params.resource === "mana") return { cost: params.baseCost * params.burdenMul, cooldown: 0 };
  return { cost: 0, cooldown: params.baseCooldown * params.burdenMul };
}

/** このスロットだけの連打下限（秒） */
export function castInterval(def: SkillDef, params: Readonly<CastParams>): number {
  return def.minInterval * params.intervalMul;
}

/**
 * 刻印符の説明文。マナ型で読み替えるものは manaVerb を使う。
 * resource は実際に使う資源（CastParams.resource を渡す）
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
 * （resource は CastParams.resource を渡す）
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

/** 変異が変える量 1 つ（候補の札の 2 段目・差の欄）。good = 遊び手にとって伸びる向きか */
export interface VariantEffect {
  label: string;
  /** % の増減（回数だけは個数） */
  amount: number;
  unit: "%" | "";
  good: boolean;
}

/** 札に収まるよう短くした名前（書付の formatVariant は長い名前のまま） */
const EFFECT_LABEL = { area: "範囲", time: "発動", count: "回数", duration: "持続", damage: "威力", potency: "効果量" } as const;

function pctOf(after: number, before: number): number {
  return before === 0 ? 0 : Math.round((after / before - 1) * PERCENT);
}

/**
 * 石の変異をまとめた増減（軸をまたいで同じ量に掛かる分は掛け合わせる）。伸びる側を先に、大きい順。
 * 0 になった量は出さない。resource は負担の名前（コスト / 再使用）を出し分ける
 */
export function variantEffects(stone: Readonly<SkillStone>, resource?: SkillResource): VariantEffect[] {
  const def = SKILL_DEFS[stone.skillKey];
  const base = baseCastParams(def);
  let p = base;
  for (const roll of stone.variants) {
    if (def.axes.includes(roll.axis)) p = applyVariant(p, roll);
  }
  const burden = BURDEN_LABEL[resource ?? def.resource];
  const raw: VariantEffect[] = [
    { label: EFFECT_LABEL.area, amount: pctOf(p.areaMul, base.areaMul), unit: "%", good: p.areaMul > base.areaMul },
    { label: burden, amount: pctOf(p.burdenMul, base.burdenMul), unit: "%", good: p.burdenMul < base.burdenMul },
    { label: EFFECT_LABEL.time, amount: pctOf(p.timeMul, base.timeMul), unit: "%", good: p.timeMul < base.timeMul },
    { label: EFFECT_LABEL.count, amount: p.countBonus - base.countBonus, unit: "", good: p.countBonus > base.countBonus },
    { label: EFFECT_LABEL.duration, amount: pctOf(p.durationMul, base.durationMul), unit: "%", good: p.durationMul > base.durationMul },
    { label: EFFECT_LABEL.damage, amount: pctOf(p.damageMul, base.damageMul), unit: "%", good: p.damageMul > base.damageMul },
    { label: EFFECT_LABEL.potency, amount: pctOf(p.potencyMul, base.potencyMul), unit: "%", good: p.potencyMul > base.potencyMul },
  ];
  return raw.filter((e) => e.amount !== 0).sort((a, b) => Number(b.good) - Number(a.good) || Math.abs(b.amount) - Math.abs(a.amount));
}

/** 変異の量 1 つの短い文「範囲+24%」 */
export function variantEffectText(e: Readonly<VariantEffect>): string {
  return `${e.label}${signed(e.amount)}${e.unit}`;
}

/** 宿り符の短い印「宿 連鎖」（無ければ null） */
export function dwellLabel(stone: Readonly<SkillStone>): string | null {
  return stone.dwell === undefined ? null : `宿 ${MODIFIERS[stone.dwell].name}`;
}

/** 石の表示名（リンクはスロットの物なので石には出さない） */
export function stoneLabel(stone: SkillStone): string {
  return SKILL_DEFS[stone.skillKey].name;
}

/**
 * 技の石のツールチップの 1 行「今の型: 重打（範囲 ×1.3・段 −1）」（skills/arts/transform.ts）。技でないスキルは null。
 * 型は呼び出し側が system/morale.ts の currentForm(state).key で引いて渡す（data.ts から system を読まない）
 */
export function transformLabel(form: FormKey, key: SkillKey): string | null {
  return isArtKey(key) ? formTransformLine(form) : null;
}

// ---------------------------------------------------------------------------
// 使い込み（docs/ideas/skills-expansion.md 5 章）の純粋な読み出し。記録は skills/wear.ts
// ---------------------------------------------------------------------------

/** 出た芽の数（芽は威力だけ） */
export function wearBudCount(stone: Readonly<SkillStone>): number {
  return stone.wear?.buds.length ?? 0;
}

/** 威力の芽の倍率 */
export function wearPowerMul(stone: Readonly<SkillStone>): number {
  return 1 + WEAR_TUNING.powerPerBud * wearBudCount(stone);
}

// ---------------------------------------------------------------------------
// 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）
// ---------------------------------------------------------------------------

/**
 * スキルごとの攻撃の素性。null は与ダメを持たないスキル（強化・移動・設置の補助）。
 * ジャンルは Scaling の参照ステータスと揃える（主か副を必ず含む。skills/skills.test.ts が検査する）。
 * 体力で伸びる恨み返し・巻き戻し・傷返しは「体を張る」系で、既定表の副（範囲・物理 = 体力）か筋力で揃えている
 */
export const SKILL_ATTACK: Readonly<Record<SkillKey, AttackProfile | null>> = {
  parry: attack("melee", "hybrid"),
  bloodPact: null,
  gravityWell: attack("area", "arcane", "dark"),
  mines: attack("area", "hybrid", "fire"),
  haste: null,
  chainHook: attack("melee", "physical"),
  frostField: attack("area", "arcane", "ice"),
  contagion: null,
  unravel: attack("ranged", "arcane"),
  kindle: attack("area", "arcane", "fire"),
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
  backflow: attack("melee", "physical"),
  scarRoar: attack("area", "arcane"),
  manaSpring: null,
  turret: attack("ranged", "physical"),
  // 第 2 弾（移ろい刃は発動時に属性を差し替える。ここは名目の無属性）
  waterJar: attack("area", "arcane"),
  oilPot: attack("area", "hybrid"),
  levelGround: attack("area", "physical"),
  emberDraw: attack("ranged", "arcane", "fire"),
  brandSear: attack("melee", "hybrid", "fire"),
  brandBlast: attack("area", "arcane", "fire"),
  flashFreeze: attack("area", "arcane", "ice"),
  hueEtch: attack("melee", "hybrid"),
  hueRelease: attack("area", "arcane"),
  doomSentence: attack("area", "arcane", "dark"),
  shiftingEdge: attack("melee", "hybrid"),
  wardStake: attack("area", "hybrid"),
  mire: attack("area", "arcane"),
  // 第 3 弾の変身（噛みつき・重い振りは近接の仕組みで当てるので、変身そのものは与ダメを持たない。砲撃だけが持つ）
  wolfForm: null,
  wraithForm: null,
  siegeForm: attack("ranged", "physical"),
  ironForm: null,
  pyreForm: null,
  // 技（skills/arts/ の各定義の attack）
  ...ART_ATTACK,
};

/** スキルの攻撃の素性（与ダメを持たないスキルは null） */
export function skillAttack(key: SkillKey): AttackProfile | null {
  return SKILL_ATTACK[key];
}
