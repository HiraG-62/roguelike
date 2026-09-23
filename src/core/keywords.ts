/**
 * 共通語彙（語 / Keyword）。docs/ideas/synergy-web.md 1 章。
 * 装備・祝福・スキル石・刻印符・敵・部屋がすべて同じ言葉で「何を出し、何を食い、何を強めるか」を語るための型。
 * データのみ（推論・集計は system/keywords.ts）。反復順は常に KEYWORDS の配列順に揃える（決定性）
 */

export const KEYWORDS = [
  "melee",
  "ranged",
  "dash",
  "just",
  "combo",
  "finisher",
  "counter",
  "still",
  "mana",
  "energy",
  "lowHp",
  "heal",
  "hurt",
  "ward",
  "burn",
  "chill",
  "shock",
  "poison",
  "bleed",
  "vulnerable",
  "weaken",
  "fear",
  "silence",
  "stagger",
  "reaction",
  "placed",
  "area",
  "bullet",
  "explode",
  "wall",
  "crit",
  "kill",
  "clear",
  "elite",
  "crimson",
  "azure",
  "jade",
  "gold",
  "umbra",
  "inverted",
] as const;

export type Keyword = (typeof KEYWORDS)[number];

export interface KeywordDef {
  /** 表示名（docs/GLOSSARY.md の表記） */
  label: string;
  /** 1 文字の字形（状態異常の STATUS_GLYPH と同じ作り） */
  glyph: string;
  color: string;
}

export const KEYWORD_DEFS: Readonly<Record<Keyword, KeywordDef>> = {
  melee: { label: "近接", glyph: "剣", color: "#e0e0e0" },
  ranged: { label: "射撃", glyph: "射", color: "#a0d8ff" },
  dash: { label: "ダッシュ", glyph: "駆", color: "#80ffd0" },
  just: { label: "ジャスト", glyph: "見", color: "#ffffff" },
  combo: { label: "コンボ", glyph: "連", color: "#ffd75f" },
  finisher: { label: "終撃", glyph: "終", color: "#ffb040" },
  counter: { label: "カウンター", glyph: "返", color: "#ff9060" },
  still: { label: "静止", glyph: "静", color: "#9090c0" },
  mana: { label: "マナ", glyph: "魔", color: "#6080ff" },
  energy: { label: "必殺ゲージ", glyph: "必", color: "#ffe040" },
  lowHp: { label: "低HP", glyph: "瀕", color: "#c03030" },
  heal: { label: "回復", glyph: "癒", color: "#60ff80" },
  hurt: { label: "被弾", glyph: "傷", color: "#ff6060" },
  ward: { label: "障壁", glyph: "護", color: "#c0e0ff" },
  burn: { label: "燃焼", glyph: "炎", color: "#ff7030" },
  chill: { label: "冷気", glyph: "氷", color: "#80d0ff" },
  shock: { label: "感電", glyph: "雷", color: "#ffff60" },
  poison: { label: "毒", glyph: "毒", color: "#90e040" },
  bleed: { label: "出血", glyph: "血", color: "#e02040" },
  vulnerable: { label: "脆弱", glyph: "脆", color: "#ff80c0" },
  weaken: { label: "弱体", glyph: "弱", color: "#a080a0" },
  fear: { label: "恐怖", glyph: "怖", color: "#b060ff" },
  silence: { label: "沈黙", glyph: "黙", color: "#8080ff" },
  stagger: { label: "怯み", glyph: "怯", color: "#ffc080" },
  reaction: { label: "反応", glyph: "応", color: "#ff60ff" },
  placed: { label: "設置物", glyph: "置", color: "#c0a060" },
  area: { label: "範囲", glyph: "円", color: "#60c0c0" },
  bullet: { label: "弾", glyph: "弾", color: "#d0d0ff" },
  explode: { label: "爆発", glyph: "爆", color: "#ff9020" },
  wall: { label: "壁", glyph: "壁", color: "#a09080" },
  crit: { label: "会心", glyph: "会", color: "#fff0a0" },
  kill: { label: "撃破", glyph: "撃", color: "#ff4040" },
  clear: { label: "制圧", glyph: "制", color: "#80ff80" },
  elite: { label: "大物", glyph: "大", color: "#ffa0ff" },
  crimson: { label: "紅", glyph: "紅", color: "#e04848" },
  azure: { label: "蒼", glyph: "蒼", color: "#4890e0" },
  jade: { label: "翠", glyph: "翠", color: "#48c070" },
  gold: { label: "金", glyph: "金", color: "#e0c048" },
  umbra: { label: "冥", glyph: "冥", color: "#9058c0" },
  inverted: { label: "反転", glyph: "逆", color: "#c0c0c0" },
};

/** 語への関わり方の 3 動詞。produces = 出す / consumes = 食う / amplifies = 強める */
export interface KeywordProfile {
  produces: Keyword[];
  consumes: Keyword[];
  amplifies: Keyword[];
}

export const KEYWORD_VERBS = ["produces", "consumes", "amplifies"] as const;
export type KeywordVerb = (typeof KEYWORD_VERBS)[number];

const KEYWORD_ORDER: Readonly<Record<Keyword, number>> = Object.fromEntries(KEYWORDS.map((k, i) => [k, i])) as Record<
  Keyword,
  number
>;

/** 重複を除き KEYWORDS の順に並べる（Set の反復順に依存させない） */
export function normalizeKeywords(list: Iterable<Keyword>): Keyword[] {
  const seen = new Set(list);
  return [...seen].sort((a, b) => KEYWORD_ORDER[a] - KEYWORD_ORDER[b]);
}

export function emptyProfile(): KeywordProfile {
  return { produces: [], consumes: [], amplifies: [] };
}

/** 定義表に 1 行で書くための組み立て（出す / 食う / 強める の順） */
export function kw(
  produces: readonly Keyword[],
  consumes: readonly Keyword[] = [],
  amplifies: readonly Keyword[] = [],
): KeywordProfile {
  return {
    produces: normalizeKeywords(produces),
    consumes: normalizeKeywords(consumes),
    amplifies: normalizeKeywords(amplifies),
  };
}

export function mergeProfiles(...profiles: readonly Readonly<KeywordProfile>[]): KeywordProfile {
  return kw(
    profiles.flatMap((p) => p.produces),
    profiles.flatMap((p) => p.consumes),
    profiles.flatMap((p) => p.amplifies),
  );
}

/** どの動詞でも関わっている語（1 つも無い要素は網から漏れている） */
export function profileKeywords(p: Readonly<KeywordProfile>): Keyword[] {
  return normalizeKeywords([...p.produces, ...p.consumes, ...p.amplifies]);
}
