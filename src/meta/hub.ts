/**
 * 拠点の成長。建っている設備と飾りを、既存の保存データ（図鑑・実績・プロファイル・スキル石）から導く。
 * 保存値を増やさず、強さにも触れない（docs/ideas/hub-design.md 3 章「拠点を育てる」）
 */
import { ENEMIES } from "../data/enemies";
import { HUB, HUB_DECOR } from "../data/tuning";
import type { HubLotKey, HubSpotKey } from "../map/hubMap";
import { hallBossKeys } from "../system/bossHallKeys";
import { type AchievementSave, currentTitleLabel } from "./achievements";
import { type CodexSave, type CodexTab, codexTabCount } from "./codex";
import type { HubSave } from "./hubStore";
import { type QuestSave, createQuestSave } from "./quests";
import { steleLabel } from "./tierRewards";

export const FACILITY_KEYS = ["well", "board", "forge", "archive", "rack", "library", "training", "altar", "garden", "hall"] as const;
export type FacilityKey = (typeof FACILITY_KEYS)[number];

/** 表示名は門前町の建物名（内部 key は据え置き。docs/GLOSSARY.md） */
export const FACILITY_NAME: Readonly<Record<FacilityKey, string>> = {
  well: "井戸",
  board: "高札",
  forge: "鍛冶屋",
  archive: "記録の蔵",
  rack: "武器掛け",
  library: "書庫",
  training: "稽古場",
  altar: "社",
  garden: "庭",
  hall: "御堂",
};

/** 門前町の敷地（HubLotKey）と設備の対応。社 = 祭壇・御堂 = ボスの間・武器小屋 = 武器掛け・稽古場の区画 = 訓練場 */
export const FACILITY_OF_LOT: Readonly<Record<HubLotKey, FacilityKey>> = {
  shrine: "altar",
  hall: "hall",
  forge: "forge",
  library: "library",
  well: "well",
  board: "board",
  archive: "archive",
  garden: "garden",
  rackShed: "rack",
  yard: "training",
};

/**
 * 未建設の設備に近づいたとき出す解放の手がかり（1 行）。builtFacilities の条件と揃える。
 * 最初から建っている設備は出る場面が無いが、全設備に持たせて表の抜けを型で防ぐ
 */
export const FACILITY_HINT: Readonly<Record<FacilityKey, string>> = {
  well: "はじめから建っている",
  board: "はじめから建っている",
  forge: "はじめから建っている",
  archive: "はじめから建っている",
  rack: "はじめから建っている",
  library: "スキル石を手にすると建つ",
  training: `試し場を見つけるか、${HUB.trainingRuns} 回探索すると建つ`,
  altar: "祭壇の部屋を見つけると建つ",
  garden: "芽の出た装備を持つと建つ",
  hall: "章ボスか最深の主を倒すと建つ",
};

/** history・codex・achievements は archive */
export const FACILITY_OF_SPOT: Readonly<Record<HubSpotKey, FacilityKey>> = {
  well: "well",
  board: "board",
  forge: "forge",
  library: "library",
  altar: "altar",
  garden: "garden",
  history: "archive",
  codex: "archive",
  achievements: "archive",
  rack: "rack",
  hall: "hall",
};

/** 最初から建っている設備。建った演出は出さない（初回に 4 枚のバナーが並ばないように） */
export const STARTER_FACILITIES: readonly FacilityKey[] = ["well", "board", "forge", "archive", "rack"];

/** 訓練場の解放に数える部屋（試し場） */
const TRAINING_ROOM = "dummyHall";
/** 祭壇の解放に数える部屋 */
const ALTAR_ROOM = "altar";
/** 書架の段数に数える図鑑のタブ。連携は総数が無いので除く */
const SHELF_TABS: readonly CodexTab[] = ["enemy", "relic", "boon", "place"];

export interface HubProgressSource {
  runs: number;
  codex: CodexSave;
  stoneCount: number;
  hasBud: boolean;
  achievements: AchievementSave;
  /** 依頼の報酬の称号を名乗っているときに名前を引くため。省略時は実績の称号だけ引ける */
  quests?: QuestSave;
  /** 踏破の回数と最高位階（踏破の碑。profile.meta の写し。省略は踏破なし） */
  clears?: number;
  bestClearTier?: number;
}

/** 建っている設備。既存の保存データから導く純関数で、stats には触れない */
export function builtFacilities(src: HubProgressSource): FacilityKey[] {
  const built = new Set<FacilityKey>(STARTER_FACILITIES);
  if (src.stoneCount > 0) built.add("library");
  if (src.codex.roomKinds.includes(TRAINING_ROOM) || src.runs >= HUB.trainingRuns) built.add("training");
  if (src.codex.roomKinds.includes(ALTAR_ROOM)) built.add("altar");
  if (src.hasBud) built.add("garden");
  if (hallBossKeys().some((k) => (src.codex.enemyKills[k] ?? 0) > 0)) built.add("hall");
  // 表示順を安定させるため FACILITY_KEYS の順で返す
  return FACILITY_KEYS.filter((k) => built.has(k));
}

/** 建っている設備に属する台。training は台を持たない */
export function availableSpots(built: readonly FacilityKey[]): Set<HubSpotKey> {
  const has = new Set(built);
  const out = new Set<HubSpotKey>();
  for (const [spot, facility] of Object.entries(FACILITY_OF_SPOT) as [HubSpotKey, FacilityKey][]) {
    if (has.has(facility)) out.add(spot);
  }
  return out;
}

export interface HubDecor {
  key: string;
  label: string;
}

/** 倒したボスの記念品。bossPart（双子の片割れ）は本体と重ねないので除く */
function trophyDecor(codex: CodexSave): HubDecor[] {
  const out: HubDecor[] = [];
  for (const def of ENEMIES) {
    if (def.boss !== true) continue;
    if ((codex.enemyKills[def.key] ?? 0) <= 0) continue;
    out.push({ key: `trophy:${def.key}`, label: `${def.bossTitle ?? def.name}の記念品` });
  }
  return out;
}

/** 図鑑の埋まり具合（0〜1）から書架の段数を決める。1 段も無ければ飾らない */
export function shelfCount(codex: CodexSave): number {
  let known = 0;
  let total = 0;
  for (const tab of SHELF_TABS) {
    const count = codexTabCount(codex, tab);
    known += count.known;
    total += count.total ?? 0;
  }
  if (total <= 0) return 0;
  return Math.min(HUB_DECOR.shelfMax, Math.floor((known / total) * HUB_DECOR.shelfMax));
}

function shelfDecor(codex: CodexSave): HubDecor[] {
  const shelves = shelfCount(codex);
  if (shelves <= 0) return [];
  return [{ key: "shelf", label: `記録室の書架 ${shelves} 段` }];
}

function titleDecor(src: HubProgressSource): HubDecor[] {
  const label = currentTitleLabel(src.achievements, src.quests ?? createQuestSave());
  if (label === null) return [];
  return [{ key: "title", label: `看板「${label}」` }];
}

/** 踏破の碑。踏破したことがあるときだけ（飾りは数行しか出ないので先頭に置く） */
function steleDecor(src: HubProgressSource): HubDecor[] {
  const label = steleLabel({ clears: src.clears, bestClearTier: src.bestClearTier });
  return label === null ? [] : [{ key: "stele", label }];
}

/** 拠点の飾り。踏破の碑 → ボスの記念品 → 書架 → 称号の看板の順 */
export function hubDecorations(src: HubProgressSource): HubDecor[] {
  return [...steleDecor(src), ...trophyDecor(src.codex), ...shelfDecor(src.codex), ...titleDecor(src)];
}

/** まだ「建った」演出を見せていない設備（最初から建っているものは除く） */
export function newlyBuilt(built: readonly FacilityKey[], save: HubSave): FacilityKey[] {
  const seen = new Set(save.seenFacilities);
  return built.filter((k) => !seen.has(k) && !STARTER_FACILITIES.includes(k));
}

/** 「建った」バナーの文言。無ければ null */
export function facilityBuiltBanner(keys: readonly FacilityKey[]): string | null {
  if (keys.length === 0) return null;
  return `${keys.map((k) => FACILITY_NAME[k]).join("・")}が建った`;
}
