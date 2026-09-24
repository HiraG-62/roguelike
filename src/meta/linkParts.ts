import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import { REACTION_LABEL, type ReactionKey, STATUS_KINDS, STATUS_LABEL, type StatusKind } from "../core/status";

/**
 * 連携の材料（反応の構成と連鎖の語）。図鑑（codex.ts）の常時の反応の検出がモジュールの読み込み時に使うので、
 * スキルなど重い依存を持たない軽いモジュールに分けている（循環 import の途中でも空にならない）
 */

/** 連鎖の保存 key の区切り（語の key は英字だけなので衝突しない） */
export const CHAIN_SEPARATOR = ">";
const CHAIN_ARROW = "→";
const UNKNOWN_PART = "？";

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_KINDS);

export function isKeyword(key: string): key is Keyword {
  return Object.hasOwn(KEYWORD_DEFS, key);
}

export function isStatusKind(key: string): key is StatusKind {
  return STATUS_SET.has(key);
}

/** 連鎖の key として成り立つか（既知の語が 2 つ以上） */
export function isChainKey(k: string): boolean {
  const words = k.split(CHAIN_SEPARATOR);
  return words.length >= 2 && words.every(isKeyword);
}

/** 連鎖の並びの表示（語の名前を矢印でつなぐ） */
export function chainLabel(chainKey: string): string {
  return chainKey
    .split(CHAIN_SEPARATOR)
    .map((w) => (isKeyword(w) ? KEYWORD_DEFS[w].label : w))
    .join(CHAIN_ARROW);
}

// -----------------------------------------------------------------------------
// 反応の構成（未発見のヒント「燃焼 + ？」と、常時の反応の検出に使う）
// -----------------------------------------------------------------------------

/** 状態異常以外の反応の材料 */
export type ReactionExtraPart = "hit" | "hueMatch";
export type ReactionPart = StatusKind | ReactionExtraPart;

const EXTRA_PART_LABEL: Readonly<Record<ReactionExtraPart, string>> = {
  hit: "射撃・スキルの命中",
  hueMatch: "色の合う状態異常",
};

export interface ReactionParts {
  /** [出す側, 食う側]（src/system/statusReactions.ts のコメントと同じ並び）。ヒントは 1 つ目だけ見せる */
  parts: readonly [ReactionPart, ReactionPart];
  /** 常時の反応（イベントを出さない）。両方が同時に付いたら起きたとみなす */
  constant?: boolean;
}

export const REACTION_PARTS: Readonly<Record<ReactionKey, ReactionParts>> = {
  vaporize: { parts: ["burn", "chill"] },
  steam: { parts: ["wet", "burn"] },
  quench: { parts: ["wet", "chill"] },
  conduct: { parts: ["wet", "shock"] },
  ignite: { parts: ["oiled", "burn"] },
  kindle: { parts: ["oiled", "shock"] },
  miasma: { parts: ["poison", "burn"] },
  shatterBleed: { parts: ["bleed", "freeze"] },
  cauterize: { parts: ["bleed", "burn"] },
  dissolve: { parts: ["corrode", "poison"], constant: true },
  lacerate: { parts: ["corrode", "bleed"], constant: true },
  collapse: { parts: ["broken", "stagger"], constant: true },
  exposeDoom: { parts: ["doom", "vulnerable"] },
  wither: { parts: ["weaken", "vulnerable"], constant: true },
  frostPoison: { parts: ["chill", "poison"], constant: true },
  panic: { parts: ["fear", "bleed"], constant: true },
  brandBurst: { parts: ["brand", "hit"] },
  thaw: { parts: ["encase", "burn"] },
  rage: { parts: ["stagger", "wrath"] },
  discharge: { parts: ["wet", "charged"] },
  iceArmor: { parts: ["harden", "chill"], constant: true },
  hueBurst: { parts: ["hue", "hueMatch"] },
  manaCut: { parts: ["siphon", "silence"], constant: true },
  rally: { parts: ["chill", "haste"] },
};

export function reactionPartLabel(part: ReactionPart): string {
  if (isStatusKind(part)) return STATUS_LABEL[part];
  return EXTRA_PART_LABEL[part];
}

/** 反応のヒント。page（連携の頁）があれば両側を見せる */
export function reactionHint(key: ReactionKey, known: boolean, page: boolean): string {
  const [a, b] = REACTION_PARTS[key].parts;
  if (known) return `${reactionPartLabel(a)} + ${reactionPartLabel(b)} = ${REACTION_LABEL[key]}`;
  if (page) return `${reactionPartLabel(a)} + ${reactionPartLabel(b)} = ${UNKNOWN_PART}`;
  return `${reactionPartLabel(a)} + ${UNKNOWN_PART}`;
}

