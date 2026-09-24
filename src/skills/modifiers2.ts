import { kw } from "../core/keywords";
import type { StatusApply } from "../core/status";
import { STATUS } from "../data/tuning";
import { EXTRA_MODIFIER_TUNING } from "./tuning";
import { WAVE2_MODIFIER_TUNING as M } from "./tuning2";
import type { ModifierDef, ModifierKey, SkillKey, Wave2ModifierKey } from "./types";

/**
 * スキル第 2 弾の刻印符（属性・地形・ジョブ・変身）と型替え符（自己中心化・罠化）。data.ts の MODIFIERS に展開する。
 * apply は CastParams に旗や倍率を立てるだけ。発動時の状態で変わるもの（心得・武器写し・化身）は system/skills.ts の
 * wave2CastState が、命中ごとのもの（属性の付与・彩り・地染め）は skills/hit.ts が読む
 */

/** 属性を自前で決めるスキル。属性の刻印符と武器写しは付けても意味が無い */
const OWN_ELEMENT: readonly SkillKey[] = ["shiftingEdge", "weaponArt"];

/** 属性を差し替える刻印符同士は同時に効かない（古い方が効く） */
const ELEMENT_SETTERS: readonly ModifierKey[] = ["fireInfuse", "iceInfuse", "stormInfuse", "venomInfuse", "weaponBond"];

function othersOf(self: ModifierKey): ModifierKey[] {
  return ELEMENT_SETTERS.filter((k) => k !== self);
}

const INFUSE_APPLIES = {
  fire: [{ kind: "burn", stacks: 1, duration: M.fireInfuse.burnTime, potency: M.fireInfuse.burnPotency }],
  ice: [{ kind: "chill", stacks: M.iceInfuse.chillStacks, duration: STATUS.chill.duration, potency: 0 }],
  storm: [{ kind: "shock", stacks: 1, duration: STATUS.shock.duration, potency: M.stormInfuse.shockPotency }],
  venom: [{ kind: "poison", stacks: M.venomInfuse.poisonStacks, duration: STATUS.poison.duration, potency: 0 }],
  broken: [{ kind: "broken", stacks: 1, duration: STATUS.broken.duration, potency: 0 }],
} as const satisfies Record<string, readonly StatusApply[]>;

export const WAVE2_MODIFIERS: Record<Wave2ModifierKey, ModifierDef> = {
  // ---- 属性 ----
  fireInfuse: {
    key: "fireInfuse",
    name: "炎化",
    verb: `属性を炎にし、命中で燃焼を付ける。ダメージ x${M.fireInfuse.damageMul}`,
    color: "#ff7040",
    keywords: kw(["burn", "elFire"]),
    excludesTags: [],
    requiresDamage: true,
    excludesSkills: OWN_ELEMENT,
    excludesModifiers: othersOf("fireInfuse"),
    apply: (p) => ({ ...p, element: "fire", extraApplies: [...p.extraApplies, ...INFUSE_APPLIES.fire], damageMul: p.damageMul * M.fireInfuse.damageMul }),
  },
  iceInfuse: {
    key: "iceInfuse",
    name: "氷化",
    verb: `属性を氷にし、命中で冷気を付ける。ダメージ x${M.iceInfuse.damageMul}`,
    color: "#80d0ff",
    keywords: kw(["chill", "elIce"]),
    excludesTags: [],
    requiresDamage: true,
    excludesSkills: OWN_ELEMENT,
    excludesModifiers: othersOf("iceInfuse"),
    apply: (p) => ({ ...p, element: "ice", extraApplies: [...p.extraApplies, ...INFUSE_APPLIES.ice], damageMul: p.damageMul * M.iceInfuse.damageMul }),
  },
  stormInfuse: {
    key: "stormInfuse",
    name: "雷化",
    verb: `属性を雷にし、命中で感電を付ける。ダメージ x${M.stormInfuse.damageMul}`,
    color: "#ffe060",
    keywords: kw(["shock", "elLightning"]),
    excludesTags: [],
    requiresDamage: true,
    excludesSkills: OWN_ELEMENT,
    excludesModifiers: othersOf("stormInfuse"),
    apply: (p) => ({
      ...p,
      element: "lightning",
      extraApplies: [...p.extraApplies, ...INFUSE_APPLIES.storm],
      damageMul: p.damageMul * M.stormInfuse.damageMul,
    }),
  },
  venomInfuse: {
    key: "venomInfuse",
    name: "毒化",
    verb: `属性を毒にし、命中で毒を付ける。ダメージ x${M.venomInfuse.damageMul}`,
    color: "#90e040",
    keywords: kw(["poison", "elPoison"]),
    excludesTags: [],
    requiresDamage: true,
    excludesSkills: OWN_ELEMENT,
    excludesModifiers: othersOf("venomInfuse"),
    apply: (p) => ({
      ...p,
      element: "poison",
      extraApplies: [...p.extraApplies, ...INFUSE_APPLIES.venom],
      damageMul: p.damageMul * M.venomInfuse.damageMul,
    }),
  },
  // ---- 状態異常 ----
  breakInfuse: {
    key: "breakInfuse",
    name: "揺さぶり",
    verb: `命中で崩勢を付ける（受ける怯み値が増え、怯みが長く、解けても堅守が付かない）。ダメージ x${M.breakInfuse.damageMul}`,
    color: "#e0a060",
    keywords: kw(["stagger"], [], ["stagger"]),
    excludesTags: [],
    requiresDamage: true,
    // 崩し蹴りは同じ付与を内蔵している
    excludesSkills: ["breakKick"],
    apply: (p) => ({ ...p, extraApplies: [...p.extraApplies, ...INFUSE_APPLIES.broken], damageMul: p.damageMul * M.breakInfuse.damageMul }),
  },
  hueInfuse: {
    key: "hueInfuse",
    name: "彩り",
    verb: `命中で装備の共鳴の色の彩痕を付ける（共鳴が無ければ付かない）。ダメージ x${M.hueInfuse.damageMul}`,
    color: "#f0a0ff",
    keywords: kw(["reaction"], ["crimson", "azure", "jade", "gold", "umbra"]),
    excludesTags: [],
    requiresDamage: true,
    // 彩刻は同じ付与を内蔵している
    excludesSkills: ["hueEtch"],
    apply: (p) => ({ ...p, hueInfuse: true, damageMul: p.damageMul * M.hueInfuse.damageMul }),
  },
  // ---- 地形 ----
  leyline: {
    key: "leyline",
    name: "地染め",
    verb: `命中した位置に属性の地形が湧く（炎 炎 / 氷 氷床 / 雷・光 水たまり / 毒 毒沼 / 闇 油 / 無 草むら。1回の発動で${M.leyline.maxPerCast}か所まで）、再使用時間 x${M.leyline.burdenMul}`,
    manaVerb: `命中した位置に属性の地形が湧く（炎 炎 / 氷 氷床 / 雷・光 水たまり / 毒 毒沼 / 闇 油 / 無 草むら。1回の発動で${M.leyline.maxPerCast}か所まで）、コスト x${M.leyline.burdenMul}`,
    color: "#a0c070",
    keywords: kw(["placed"], [], ["burn", "chill", "poison"]),
    excludesTags: [],
    requiresDamage: true,
    apply: (p) => ({ ...p, leyline: true, burdenMul: p.burdenMul * M.leyline.burdenMul }),
  },
  // ---- ジョブ・武器種 ----
  jobMastery: {
    key: "jobMastery",
    name: "心得",
    verb: `ジョブの得意な武器種を持っていれば威力・効果量 x${M.jobMastery.favoredMul}（得意でなければ x${M.jobMastery.otherMul}）`,
    color: "#ffc860",
    keywords: kw([], [], ["melee"]),
    excludesTags: [],
    apply: (p) => ({ ...p, jobMastery: true }),
  },
  weaponBond: {
    key: "weaponBond",
    name: "武器写し",
    verb: `属性を近接の武器に揃える。武器が無属性なら素の冴えでダメージ x${M.weaponBond.plainMul}`,
    color: "#d0d0d0",
    keywords: kw([], [], ["melee"]),
    excludesTags: [],
    requiresDamage: true,
    excludesSkills: OWN_ELEMENT,
    excludesModifiers: othersOf("weaponBond"),
    apply: (p) => ({ ...p, weaponBond: true }),
  },
  // ---- 変身 ----
  formSurge: {
    key: "formSurge",
    name: "化身",
    verb: `変身中は威力・効果量 x${M.formSurge.formMul}（変身していなければ x${M.formSurge.otherMul}）`,
    color: "#ff90d0",
    keywords: kw([], [], ["melee"]),
    excludesTags: ["form"],
    apply: (p) => ({ ...p, formSurge: true }),
  },
  formLinger: {
    key: "formLinger",
    name: "深化",
    verb: `変身の持続 x${M.formLinger.durationMul}、切れた後の反動も x${M.formLinger.recoverMul}、再使用時間 x${M.formLinger.burdenMul}`,
    manaVerb: `変身の持続 x${M.formLinger.durationMul}、切れた後の反動も x${M.formLinger.recoverMul}、コスト x${M.formLinger.burdenMul}`,
    color: "#d070ff",
    keywords: kw([], [], ["melee"]),
    excludesTags: [],
    requiresTags: ["form"],
    apply: (p) => ({
      ...p,
      formDurationMul: p.formDurationMul * M.formLinger.durationMul,
      formRecoverMul: p.formRecoverMul * M.formLinger.recoverMul,
      burdenMul: p.burdenMul * M.formLinger.burdenMul,
    }),
  },
  // ---- 型替え符（リンク 2 本・1 スロットに 1 枚） ----
  toNova: {
    key: "toNova",
    name: "自己中心化",
    verb: `【型替え】カーソル地点ではなく自分の足元で起きる。範囲 x${M.toNova.areaMul}`,
    color: "#fff0c0",
    keywords: kw(["area"], [], ["placed"]),
    excludesTags: ["movement"],
    requiresTags: ["placed"],
    // 地雷・湧き石はもともと足元に置く。グレネードは足元で爆ぜると自分も巻き込まれる
    excludesSkills: ["mines", "manaSpring", "frag"],
    linkCost: EXTRA_MODIFIER_TUNING.reshapeLinkCost,
    reshape: "toNova",
    apply: (p) => ({ ...p, reshape: "toNova", areaMul: p.areaMul * M.toNova.areaMul }),
  },
  toTrap: {
    key: "toTrap",
    name: "罠化",
    verb: `【型替え】撃たずにカーソル地点へ罠を置く（最大${M.toTrap.maxAlive}）。敵が踏むと罠の位置から最寄りの敵へ向けて発動（ダメージ x${M.toTrap.damageMul}）`,
    color: "#c0a0ff",
    keywords: kw(["placed"], [], ["area"]),
    excludesTags: ["placed", "movement", "defense", "buff", "form", "channel"],
    requiresTags: ["melee", "projectile"],
    // 恨み返しは自分が受けたダメージを返す技なので、離れた罠では意味が無い
    excludesSkills: ["grudge"],
    linkCost: EXTRA_MODIFIER_TUNING.reshapeLinkCost,
    reshape: "toTrap",
    apply: (p) => ({ ...p, reshape: "toTrap", damageMul: p.damageMul * M.toTrap.damageMul }),
  },
};

/** 属性の刻印符の内訳（テスト・UI 用） */
export const INFUSE_STATUS: Readonly<Record<"fireInfuse" | "iceInfuse" | "stormInfuse" | "venomInfuse" | "breakInfuse", readonly StatusApply[]>> = {
  fireInfuse: INFUSE_APPLIES.fire,
  iceInfuse: INFUSE_APPLIES.ice,
  stormInfuse: INFUSE_APPLIES.storm,
  venomInfuse: INFUSE_APPLIES.venom,
  breakInfuse: INFUSE_APPLIES.broken,
};
