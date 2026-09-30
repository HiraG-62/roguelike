/**
 * 祝福の定義表の集約（データのみ）。札の本体は系譜ごとのファイル src/system/boonDefs/<系譜>.ts
 * （9 系譜 × 11 枚・融合 12・呪い付き 6・芯 4。docs/ideas/boon-impl.md 2-6）。
 * ロジックは system/boons.ts（抽選・選択・残っているフック）と system/boonRules.ts（Rule で書けない効果）。
 * 「〜時: 〜」で書ける効果は rules（統一ルール文法）に置き、src/system/rules.ts の resolveRules がステップ末に照合する
 */

import type { KeywordProfile } from "../core/keywords";
import type { Modifier, Rule } from "../core/rules";
import type { JobKey } from "../data/jobs";
import type { BulletFeature, MovesetKey } from "../data/weapons";
import type { PlayerStats } from "../loot/types";
import type { ModifierKey } from "../skills/types";
import { BOONS_ASH, BOON_KEYS_ASH } from "./boonDefs/ash";
import { BOONS_FROST, BOON_KEYS_FROST } from "./boonDefs/frost";
import { BOONS_THUNDER, BOON_KEYS_THUNDER } from "./boonDefs/thunder";
import { BOONS_MOON, BOON_KEYS_MOON } from "./boonDefs/moon";
import { BOONS_EARTH, BOON_KEYS_EARTH } from "./boonDefs/earth";
import { BOONS_BLADE, BOON_KEYS_BLADE } from "./boonDefs/blade";
import { BOONS_CYCLE, BOON_KEYS_CYCLE } from "./boonDefs/cycle";
import { BOONS_HORDE, BOON_KEYS_HORDE } from "./boonDefs/horde";
import { BOONS_WEALTH, BOON_KEYS_WEALTH } from "./boonDefs/wealth";
import { BOONS_FUSION, BOON_KEYS_FUSION } from "./boonDefs/fusion";
import { BOONS_CURSED, BOON_KEYS_CURSED } from "./boonDefs/cursed";

/** 全ての祝福の key（系譜の札 → 融合 → 呪い付き・芯の順。図鑑と抽選の並び） */
const ALL_BOON_KEYS = [
  ...BOON_KEYS_ASH,
  ...BOON_KEYS_FROST,
  ...BOON_KEYS_THUNDER,
  ...BOON_KEYS_MOON,
  ...BOON_KEYS_EARTH,
  ...BOON_KEYS_BLADE,
  ...BOON_KEYS_CYCLE,
  ...BOON_KEYS_HORDE,
  ...BOON_KEYS_WEALTH,
  ...BOON_KEYS_FUSION,
  ...BOON_KEYS_CURSED,
] as const;

export type BoonKey = (typeof ALL_BOON_KEYS)[number];

export const BOON_KEYS: readonly BoonKey[] = ALL_BOON_KEYS;

export type BoonTag =
  | "melee"
  | "ranged"
  | "dash"
  | "just"
  | "combo"
  | "energy"
  | "burn"
  | "chill"
  | "shock"
  | "explode"
  | "crit"
  | "hp"
  | "room"
  | "loot"
  | "boss"
  | "attr"
  | "poison"
  | "bleed"
  | "stagger"
  | "mana"
  | "freeze"
  | "paralyze"
  | "vulnerable"
  | "weaken"
  | "fear"
  | "silence"
  | "guarded"
  | "counter"
  | "skill"
  | "placed"
  | "reaper"
  /** 属性（docs/COMBAT_DESIGN.md A-8）。属性の変換を持つ装備と、燃焼・冷気・感電の系譜・属性の轍を結ぶ */
  | "element"
  /** 地形（水たまり・油・氷床…）を踏む・撒く・広げる祝福。祝福が出すタグとして重みに乗る */
  | "terrain";

/**
 * 系譜（docs/ideas/boon-impl.md 2-1）。出口の予告で系譜を選び、その系譜の札だけが 3 枚並ぶ。
 * 灰燼・霜枷・雷鳴・月蝕・大地・刃鳴・輪廻・眷属・財宝の 9
 */
export type LineageKey =
  | "ash"
  | "frost"
  | "thunder"
  | "moon"
  | "earth"
  | "blade"
  | "cycle"
  | "horde"
  | "wealth";

/** 全ての系譜（表示と抽選の並び順） */
export const LINEAGE_KEYS: readonly LineageKey[] = [
  "ash",
  "frost",
  "thunder",
  "moon",
  "earth",
  "blade",
  "cycle",
  "horde",
  "wealth",
];

/** 札の種類（boon-impl 2-1）: 加護 = 行動に宿る / 摂理 = 常時 / 研鑽 = ラン中に育つ / 真髄 = 系譜の頂点 */
export type BoonCard = "grace" | "law" | "temper" | "apex";

/** 加護が宿る行動（左 / 右 / ダッシュ / スキル / 奥義） */
export type BoonAction = "primary" | "secondary" | "dash" | "skill" | "ultimate";

/** 全ての行動（加護の枠・融合の判定・表示の並び順） */
export const BOON_ACTIONS: readonly BoonAction[] = ["primary", "secondary", "dash", "skill", "ultimate"];

/** 行動の見出し（「左 1/2」の頭。キー名ではなく行動の名前） */
export const BOON_ACTION_LABEL: Readonly<Record<BoonAction, string>> = {
  primary: "左",
  secondary: "右",
  dash: "ダッシュ",
  skill: "スキル",
  ultimate: "奥義",
};

/** 札の種類の表示名 */
export const BOON_CARD_LABEL: Readonly<Record<BoonCard, string>> = {
  grace: "加護",
  law: "摂理",
  temper: "研鑽",
  apex: "真髄",
};

/** 柱 7 の審査: その札で何が変わるか（押すもの / 押す時 / 立つ場所 / 狙う相手 / 見るもの） */
export type BoonChange = "press" | "timing" | "position" | "target" | "watch";

/** 系譜の表示名（カードと HUD の注記） */
export const LINEAGE_LABEL: Readonly<Record<LineageKey, string>> = {
  ash: "灰燼",
  frost: "霜枷",
  thunder: "雷鳴",
  moon: "月蝕",
  earth: "大地",
  blade: "刃鳴",
  cycle: "輪廻",
  horde: "眷属",
  wealth: "財宝",
};

/** 武器種・弾の性質・ジョブで出る祝福の条件。どれかの列を持つなら、その列のどれかに当てはまるときだけ 3 択に出る */
export interface BoonLoadout {
  movesets?: readonly MovesetKey[];
  /** 今の弾がこのどれかの性質を持つ（設置弾・溜め撃ちなど） */
  bullets?: readonly BulletFeature[];
  jobs?: readonly JobKey[];
}

export interface BoonDef {
  key: BoonKey;
  name: string;
  desc: string;
  /** HUD のアイコン文字（1 文字） */
  icon: string;
  tags: readonly BoonTag[];
  /** その祝福が作り出すもの（燃焼・脆弱など）。持っていると、それを食う祝福の重みが上がる */
  gives?: readonly BoonTag[];
  /** 呪い付き（強い効果 + 代償）。3 択のうち 1 枠に確率で混ざる */
  cursed: boolean;
  /** このタグを装備（またはスキル石）が持っていないと出ない（burn の無い装備に燃焼祝福を出さない） */
  requires?: BoonTag;
  /** 系譜（呪い付き・芯・融合は持たない） */
  lineage?: LineageKey;
  /** 札の種類（boon-impl 2-1）。系譜を持つ通常の札は持つ */
  card?: BoonCard;
  /** 加護が宿る行動（card === "grace" のとき） */
  action?: BoonAction;
  /** 融合（2 系譜の加護が同じ行動に乗ると確定で出る）。どちらの系譜の枚数にも数える */
  fusion?: readonly [LineageKey, LineageKey];
  /** その札で何が変わるか（量の方針 boon-impl 2-12） */
  changes?: BoonChange;
  /** 今の武器種・銃の弾・ジョブがこれに当てはまらないと出ない（大剣を持たない者に大剣の祝福を出さない） */
  loadout?: BoonLoadout;
  /** 統一ルール（src/core/rules.ts）。取得順に src/system/rules.ts の resolveRules が照合する */
  rules?: readonly Rule[];
  /** 常時の増・倍・条件付き・〜につき（core/rules.ts の Modifier。system/modifiers.ts が取得順に集める） */
  modifiers?: readonly Modifier[];
  /** 共通語彙（docs/ideas/synergy-web.md 1 章）。tags / gives より細かい「出す・食う・強める」 */
  keywords: KeywordProfile;
  /** 芯（1 ランに 1 つ、深度 BOON.coreDepth の最初の提示だけに出る。通常の 3 択には出ない） */
  core?: true;
  /** 格の対象を明示する（省略時は boonGrade.ts の isGraded が Rule の効果量から自動で決める。フック型は true で opt-in） */
  graded?: boolean;
  /** スキルの加護: 全スロットに刻印符を 1 枚足す（boon-impl 2-1。付け方は 2-9 と共有） */
  grantsModifier?: ModifierKey;
  /** 研鑽が stats に効くとき（foldBoonStats が boonRun.tallies から畳む） */
  temperStat?: TemperStat;
  /** 持っている間ずっと stats に足す量（stats の単位のまま。Modifier に無い項目: 連鎖の戻り・コンボの猶予など） */
  addStats?: Readonly<Partial<Record<NumericStatKey, number>>>;
}

/** PlayerStats のうち数値の項目（研鑽が足せるもの） */
export type NumericStatKey = { [K in keyof PlayerStats]: PlayerStats[K] extends number ? K : never }[keyof PlayerStats];

/**
 * 研鑽の stats への効き（boon-impl 2-1）: stats[stat] += per × floor(tallies[tally] / every)。
 * cap があれば足す量をそこで止める（分身は 3 まで など）
 */
export interface TemperStat {
  /** 読む数えの key（Rule 効果 tally の key） */
  tally: string;
  stat: NumericStatKey;
  /** 1 段あたりに足す量（stats の単位のまま。倍率なら 0.05 = +5%） */
  per: number;
  /** 何数えで 1 段か（1 以上） */
  every: number;
  /** 足す量の上限（省略 = 上限なし） */
  cap?: number;
}

export const BOONS: Readonly<Record<BoonKey, BoonDef>> = {
  ...BOONS_ASH,
  ...BOONS_FROST,
  ...BOONS_THUNDER,
  ...BOONS_MOON,
  ...BOONS_EARTH,
  ...BOONS_BLADE,
  ...BOONS_CYCLE,
  ...BOONS_HORDE,
  ...BOONS_WEALTH,
  ...BOONS_FUSION,
  ...BOONS_CURSED,
};
