import type { Rng } from "../core/rng";
import { affixDef } from "./affixes";
import type { BaseItemDef } from "./bases";
import type { AffixRoll, Rarity } from "./types";

/** rare 名の 1 語目 */
export const RARE_FIRST_WORDS: readonly string[] = [
  "Storm", "Dusk", "Grim", "Blood", "Ash", "Iron", "Rune", "Hollow", "Ember", "Frost",
  "Night", "Bone", "Gloom", "Thunder", "Viper", "Raven", "Doom", "Shadow", "Sun", "Void",
  "Crimson", "Wraith", "Onyx", "Feral", "Molten", "Silent", "Cursed", "Astral", "Savage", "Winter",
];

/** rare 名の 2 語目 */
export const RARE_SECOND_WORDS: readonly string[] = [
  "Fang", "Whisper", "Bane", "Song", "Edge", "Heart", "Grasp", "Call", "Veil", "Spiral",
  "Brand", "Coil", "Mark", "Howl", "Thirst", "Ward", "Stride", "Crown", "Shard", "Wake",
  "Fury", "Requiem", "Talon", "Omen", "Ruin", "Chime", "Maw", "Verdict", "Pact", "Drift",
];

function affixName(roll: AffixRoll | undefined): string | undefined {
  if (roll === undefined) return undefined;
  const def = affixDef(roll.key);
  if (def === undefined) return undefined;
  return def.kind === "prefix" ? def.prefixName : def.suffixName;
}

/** "{Prefix} {Base} {of Suffix}"。どちらか欠けていても成立する */
function magicName(base: BaseItemDef, affixes: readonly AffixRoll[]): string {
  const pre = affixName(affixes.find((a) => a.kind === "prefix"));
  const suf = affixName(affixes.find((a) => a.kind === "suffix"));
  return [pre, base.name, suf].filter((part): part is string => part !== undefined).join(" ");
}

function rareName(rng: Rng): string {
  return `${rng.pick(RARE_FIRST_WORDS)} ${rng.pick(RARE_SECOND_WORDS)}`;
}

/**
 * アイテム名を決める。
 * rare は 2 語の生成名（ベース名は UI が別途小さく出す）、unique は uniqueName を使う。
 */
export function nameItem(
  rng: Rng,
  base: BaseItemDef,
  rarity: Rarity,
  affixes: readonly AffixRoll[],
  uniqueName?: string,
): string {
  switch (rarity) {
    case "normal":
      return base.name;
    case "magic":
      return magicName(base, affixes);
    case "rare":
      return rareName(rng);
    case "unique":
      return uniqueName ?? base.name;
  }
}
