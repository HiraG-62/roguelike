import type { StatusKind } from "../core/status";
import { affixDef, isKeystoneKey, type AffixDef, type AffixTag } from "./affixes";
import { INFLICT_COLOR, decodeTriggerRoll, inflictKindsOfColor, type TriggerShape } from "./triggers";
import type { AffixRoll, TraitColor, TriggeredEffect } from "./types";

/**
 * 性質の色（響き）。docs/LOOT_DESIGN.md「色と共鳴」。
 * - 紅 crimson: 近接・与ダメージ・炎
 * - 蒼 azure: 射撃・機動・冷気・マナ
 * - 翠 jade: 生存・回復
 * - 金 gold: 必殺・コンボ・会心・雷
 * - 冥 umbra: 誓約（旧キーストーン）・呪い（重い代償）・反転した性質
 */

/** tags → 色。上から順に最初に当たった規則を使う（定義に color があればそちらが優先） */
const TAG_COLOR_RULES: readonly { tags: readonly AffixTag[]; color: TraitColor }[] = [
  // マナは蒼（スキルの資源）。代償（tradeoff）や他タグより先に決める
  { tags: ["mana"], color: "azure" },
  { tags: ["critical", "combo", "burst"], color: "gold" },
  { tags: ["life", "defense"], color: "jade" },
  { tags: ["melee"], color: "crimson" },
  { tags: ["ranged", "mobility"], color: "azure" },
  { tags: ["damage", "elemental"], color: "crimson" },
];
const FALLBACK_COLOR: TraitColor = "crimson";

export function colorFromTags(tags: readonly AffixTag[]): TraitColor {
  for (const rule of TAG_COLOR_RULES) {
    if (rule.tags.some((t) => tags.includes(t))) return rule.color;
  }
  return FALLBACK_COLOR;
}

/** 性質の定義の既定色 */
export function affixColor(def: AffixDef): TraitColor {
  return def.color ?? colorFromTags(def.tags);
}

/** 付ける状態異常が決まっていない inflict（文法の組み合わせ段階）の色 */
const UNDECIDED_INFLICT_COLOR: TraitColor = "umbra";

/** トリガーの色を決める入力。inflict は付ける状態異常（status）で色が変わる */
export type TriggerColorInput = Pick<TriggeredEffect, "trigger" | "condition" | "effect"> & { status?: StatusKind };

function effectColor(effect: TriggerColorInput): TraitColor | undefined {
  switch (effect.effect) {
    case "heal":
    case "invuln":
    case "cleanse":
    case "healMissing":
      return "jade";
    case "freezeNearby":
    case "restoreMana":
    case "skillHaste":
    case "volley":
      return "azure";
    case "chainLightning":
    case "energy":
      return "gold";
    case "burnNearby":
    case "explode":
    case "addPoise":
      return "crimson";
    case "extendStatus":
      return "umbra";
    case "inflict":
      return effect.status === undefined ? UNDECIDED_INFLICT_COLOR : (INFLICT_COLOR[effect.status] ?? UNDECIDED_INFLICT_COLOR);
    default:
      return undefined;
  }
}

/** トリガー文法の性質の色。代償的な条件 → 効果 → 条件 → 起点の順に決める */
export function triggerColor(effect: TriggerColorInput): TraitColor {
  if (effect.condition === "belowHalfHp" || effect.condition === "selfAfflicted") return "umbra";
  const byEffect = effectColor(effect);
  if (byEffect !== undefined) return byEffect;
  if (effect.condition === "comboAbove10" || effect.condition === "fullEnergy") return "gold";
  if (effect.condition === "manaFull" || effect.condition === "manaLow") return "azure";
  if (effect.condition === "targetInWindup") return "gold";
  switch (effect.trigger) {
    case "onShoot":
    case "onDash":
      return "azure";
    case "onHurt":
    case "onRoomClear":
      return "jade";
    case "onJustDodge":
      return "gold";
    case "onMeleeHit":
    case "everyNthMeleeHit":
    case "onKill":
    case "onStagger":
      return "crimson";
    case "onCounter":
      return "gold";
  }
}

/**
 * 組み合わせがその色の性質として出せるか（芽・染めで色を指定して引くとき）。
 * inflict は付ける状態異常をその色から選べば色が合う
 */
export function triggerCanBeColor(shape: TriggerShape, color: TraitColor): boolean {
  if (shape.effect !== "inflict") return triggerColor(shape) === color;
  const kinds = inflictKindsOfColor(color);
  const sample = kinds[0];
  return sample !== undefined && INFLICT_COLOR[sample] === color && triggerColor({ ...shape, status: sample }) === color;
}

/** key の既定色。未知の key（旧マーカー等）は undefined（配合に数えない） */
export function defaultColorOfKey(key: string): TraitColor | undefined {
  if (isKeystoneKey(key)) return "umbra";
  const def = affixDef(key);
  if (def !== undefined) return affixColor(def);
  const trigger = decodeTriggerRoll({ key, value: 0 });
  if (trigger !== null) return triggerColor(trigger);
  return undefined;
}

/** ロール済みの性質の色。脱色済みは無色、反転していれば冥、次に保存された色、無ければ既定色 */
export function traitColorOf(roll: AffixRoll): TraitColor | undefined {
  if (roll.colorless === true) return undefined;
  if (roll.inverted === true) return "umbra";
  return roll.color ?? defaultColorOfKey(roll.key);
}

/** ベースの色の傾き。生成時、この色の性質の抽選重みが BASE_LEAN_WEIGHT 倍になる */
export const BASE_LEAN: Readonly<Record<string, TraitColor>> = {
  dagger: "gold",
  shortsword: "crimson",
  longsword: "crimson",
  spear: "crimson",
  greatsword: "crimson",
  twinblades: "gold",
  warpick: "crimson",
  pistol: "azure",
  smg: "azure",
  rifle: "azure",
  shotgun: "crimson",
  revolver: "gold",
  railgun: "azure",
  cloth: "jade",
  leather: "azure",
  chain: "jade",
  plate: "jade",
  berserkerHide: "umbra",
  sandals: "azure",
  boots: "azure",
  greaves: "jade",
  wingedBoots: "azure",
  lungingBoots: "crimson",
  ironRing: "jade",
  rubyRing: "crimson",
  sapphireRing: "azure",
  goldRing: "gold",
  bloodRing: "umbra",
  voidBand: "umbra",
  jadeAmulet: "jade",
  amberAmulet: "gold",
  onyxAmulet: "umbra",
  lapisAmulet: "azure",
  coralAmulet: "jade",
  duskAmulet: "gold",
  machete: "crimson",
  rapier: "gold",
  staff: "azure",
  scythe: "umbra",
  throwingKnives: "gold",
  blowgun: "umbra",
  matchlock: "crimson",
  rags: "jade",
  robe: "azure",
  scale: "jade",
  spiked: "crimson",
  tabi: "azure",
  ironGeta: "jade",
  snowBoots: "azure",
  boneRing: "umbra",
  signet: "gold",
  twinRing: "gold",
  blackIronRing: "umbra",
  rosary: "azure",
  fangNecklace: "crimson",
  bell: "umbra",
  // 武器種・銃の弾の器（src/data/weapons.ts）
  gauntlets: "crimson",
  whip: "gold",
  wand: "azure",
  ricochetGun: "gold",
  mineLauncher: "crimson",
  // 2026-09 第 2 弾
  katana: "gold",
  zanbato: "crimson",
  twinDaggers: "gold",
  halberd: "crimson",
  sickle: "umbra",
  cestus: "crimson",
  chainWhip: "gold",
  shakujo: "azure",
  crystalWand: "gold",
  blunderbuss: "crimson",
  crossbow: "azure",
  chakram: "azure",
  handCannon: "crimson",
  caltrops: "jade",
  seekerOrb: "umbra",
  mino: "jade",
  // 2026-09-24 レーン B（新しい武器種・銃の弾の器）
  wakizashi: "gold",
  tachi: "crimson",
  handAxe: "crimson",
  battleAxe: "umbra",
  towerShield: "jade",
  kiteShield: "jade",
  kusarigama: "gold",
  weightedChain: "gold",
  mallet: "crimson",
  maul: "crimson",
  twinPistols: "azure",
  twinRevolvers: "gold",
  broadCleaver: "crimson",
  burstRifle: "azure",
  tripleCrossbow: "gold",
  returnChakram: "azure",
  flyingBlade: "gold",
  mortar: "crimson",
  grenadeLauncher: "crimson",
};
export const BASE_LEAN_WEIGHT = 2;

export function baseLean(baseKey: string): TraitColor | undefined {
  return BASE_LEAN[baseKey];
}

/**
 * 反対色。芽の 2 択の「もう片方」に使う（攻め ↔ 守り、近 ↔ 遠、呪い → 生）。
 * 5 色なので対にならない組がある（冥の反対は翠、翠の反対は金）
 */
export const OPPOSITE_COLOR: Readonly<Record<TraitColor, TraitColor>> = {
  crimson: "azure",
  azure: "crimson",
  jade: "gold",
  gold: "jade",
  umbra: "jade",
};

/** 色の形容（無銘のアイテム名に使う。「紅を帯びた長剣」） */
export const COLOR_ADJECTIVE: Readonly<Record<TraitColor, string>> = {
  crimson: "紅を帯びた",
  azure: "蒼く冴えた",
  jade: "翠に芽吹く",
  gold: "金に閃く",
  umbra: "冥く淀んだ",
};
