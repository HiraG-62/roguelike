import type { Rng } from "../core/rng";
import { affixDef } from "./affixes";
import type { BaseItemDef } from "./bases";
import type { AffixRoll, Rarity } from "./types";

/** rare 名の 1 語目 */
export const RARE_FIRST_WORDS: readonly string[] = [
  "嵐", "黄昏", "血", "氷", "雷", "骸", "夜", "星", "鉄", "炎",
  "闇", "灰", "月", "狂", "深淵", "朱", "蒼", "獣", "亡霊", "業",
  "辺境", "氷雪", "大地", "荒野", "幻影", "絶望", "烈風", "常闇", "天空", "無限",
];

/** rare 名の 2 語目 */
export const RARE_SECOND_WORDS: readonly string[] = [
  "牙", "囁き", "誓い", "爪", "歌", "影", "鎖", "眼", "翼", "心",
  "剣", "盾", "王冠", "涙", "息吹", "咆哮", "遺灰", "残響", "刃", "蜜",
  "呪い", "番人", "使者", "鼓動", "果て", "標", "記憶", "契約", "波動", "静寂",
];

/** rare 名の連結記号 */
const RARE_NAME_CONNECTOR = "の";
/** magic 名で suffix を base に続けるときの区切り */
const MAGIC_SUFFIX_CONNECTOR = "・";

function affixName(roll: AffixRoll | undefined): string | undefined {
  if (roll === undefined) return undefined;
  const def = affixDef(roll.key);
  if (def === undefined) return undefined;
  return def.kind === "prefix" ? def.prefixName : def.suffixName;
}

/**
 * 「{prefix}{Base}」「{Base}・{suffix}」「{prefix}{Base}・{suffix}」。
 * prefix は形容詞的な語（例: 「獰猛な」）でベース名に直接続ける。suffix は「・」で区切る
 */
function magicName(base: BaseItemDef, affixes: readonly AffixRoll[]): string {
  const pre = affixName(affixes.find((a) => a.kind === "prefix"));
  const suf = affixName(affixes.find((a) => a.kind === "suffix"));
  const core = pre === undefined ? base.name : `${pre}${base.name}`;
  return suf === undefined ? core : `${core}${MAGIC_SUFFIX_CONNECTOR}${suf}`;
}

function rareName(rng: Rng): string {
  return `${rng.pick(RARE_FIRST_WORDS)}${RARE_NAME_CONNECTOR}${rng.pick(RARE_SECOND_WORDS)}`;
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
