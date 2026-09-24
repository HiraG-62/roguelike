/**
 * 拠点の台から開く画面の対応表と、main.ts の拠点まわりの小さな状態（DOM 非依存）。
 * 設備は既存の画面を開く近道で、閉じたら拠点へ戻る（docs/ideas/hub-design.md 4 章 レーン C）
 */
import type { GameState } from "../core/state";
import { MOVESETS, MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { KEYSTONES } from "../loot/affixes";
import type { Item, Profile } from "../loot/types";
import type { HubSpotKey } from "../map/hubMap";
import type { AchievementSave } from "../meta/achievements";
import type { CodexSave } from "../meta/codex";
import type { HubProgressSource } from "../meta/hub";
import type { ListEntry, ListTab } from "../meta/listScreen";
import type { QuestSave } from "../meta/quests";
import type { SkillProfile } from "../skills/types";
import { closeBudModal } from "./bud";
import type { InventoryTab, InventoryUi } from "./inventory";

/** 台から開く、拠点の外の画面 */
export type HubScreenKind = "origin" | "questBoard" | "codex" | "achievements" | "history";

export type HubOpen =
  | { kind: "inventory"; tab: InventoryTab; bud?: boolean }
  | { kind: "screen"; screen: HubScreenKind }
  | { kind: "altar" }
  | { kind: "rack" };

const HUB_OPEN: Readonly<Record<HubSpotKey, HubOpen>> = {
  well: { kind: "screen", screen: "origin" },
  board: { kind: "screen", screen: "questBoard" },
  forge: { kind: "inventory", tab: "echo" },
  library: { kind: "inventory", tab: "skills" },
  altar: { kind: "altar" },
  garden: { kind: "inventory", tab: "equipment", bud: true },
  history: { kind: "screen", screen: "history" },
  codex: { kind: "screen", screen: "codex" },
  achievements: { kind: "screen", screen: "achievements" },
  rack: { kind: "rack" },
};

export function hubOpenFor(spot: HubSpotKey): HubOpen {
  return HUB_OPEN[spot];
}

/**
 * 装備画面を指定のタブで開く。庭は芽があれば 2 択のモーダルも開く（バナーをクリックする手間を省く）。
 * 拠点の state を止めるのは、装備画面を開いている間に拠点の時間を進めないため（ランの Tab と同じ）
 */
export function openInventoryAt(state: GameState, ui: InventoryUi, tab: InventoryTab, bud = false): void {
  ui.open = true;
  ui.tab = tab;
  closeBudModal(ui.bud);
  if (bud && state.pendingBud !== null) ui.bud.open = true;
  state.paused = true;
}

/** 祭壇の一覧で「誓約を外す」行の key（誓約の key は ks_ で始まるので重ならない） */
export const NO_TRIAL_KEY = "none";

/** 祭壇の一覧。全誓約を並べ、試している誓約に marked を付ける。持っていない誓約も試せる */
export function altarTabs(current: string | null): ListTab[] {
  const clear: ListEntry = {
    key: NO_TRIAL_KEY,
    known: true,
    name: "誓約を外す",
    info: "",
    detail: "試している誓約を外す。",
    marked: current === null,
  };
  const entries: ListEntry[] = KEYSTONES.map((d) => ({
    key: d.key,
    known: true,
    name: d.name,
    info: current === d.key ? "試している" : "",
    detail: `${d.description} 決定で試す（拠点を出ると消える）。`,
    marked: current === d.key,
  }));
  return [{ label: `誓約 ${KEYSTONES.length}`, entries: [clear, ...entries] }];
}

/** 祭壇の行 key → setTrialKeystone に渡す誓約（「誓約を外す」は null） */
export function trialKeyOfEntry(key: string): string | null {
  return key === NO_TRIAL_KEY ? null : key;
}

/**
 * 武器掛けの行が指すもの。key が null の行は「装備のものに戻す」。
 * 銃の家系（sidearm / longarm / cannon / thrown / gunner）も武器種の列に並ぶ（docs/ideas/weapon-redesign.md 5.4）
 */
export type RackRow = { kind: "moveset"; key: MovesetKey | null };

const RACK_MOVESET = "moveset";
const RACK_SEP = ":";
const RACK_HINT = "決定で試す。長押しで素の器を借りて出撃できる（ランが終わると消える）。";

function rackKey(key: string): string {
  return `${RACK_MOVESET}${RACK_SEP}${key}`;
}

function rackClearEntry(current: string | null): ListEntry {
  return {
    key: rackKey(NO_TRIAL_KEY),
    known: true,
    name: "装備のまま",
    info: "",
    detail: "試している武器種を外し、装備の右手に戻す。",
    marked: current === null,
  };
}

function movesetDetail(key: MovesetKey): string {
  const def = MOVESETS[key];
  const branches = def.branches.map((b) => b.name);
  const branchText = branches.length > 0 ? ` 派生: ${branches.join("・")}。` : "";
  return `${def.desc}。${branchText} ${RACK_HINT}`;
}

/**
 * 武器掛けの一覧。武器種のタブに全種（銃の家系を含む）を並べ、試しているものに marked を付ける。
 * 行の key は moveset:<key>（rackEntryOf で戻す）
 */
export function rackTabs(trialMoveset: MovesetKey | null): ListTab[] {
  const movesets: ListEntry[] = MOVESET_KEYS.map((k) => ({
    key: rackKey(k),
    known: true,
    name: MOVESETS[k].name,
    info: trialMoveset === k ? "試している" : "",
    detail: movesetDetail(k),
    marked: trialMoveset === k,
  }));
  return [{ label: `武器種 ${MOVESET_KEYS.length}`, entries: [rackClearEntry(trialMoveset), ...movesets] }];
}

function isMovesetKey(v: string): v is MovesetKey {
  return (MOVESET_KEYS as readonly string[]).includes(v);
}

/** 武器掛けの行 key → 何を試す / 借りるか。知らない key は null */
export function rackEntryOf(key: string): RackRow | null {
  const sep = key.indexOf(RACK_SEP);
  if (sep < 0) return null;
  const kind = key.slice(0, sep);
  const rest = key.slice(sep + 1);
  if (kind !== RACK_MOVESET) return null;
  const clear = rest === NO_TRIAL_KEY;
  return clear ? { kind: "moveset", key: null } : isMovesetKey(rest) ? { kind: "moveset", key: rest } : null;
}

function hasEverBudded(item: Item): boolean {
  return (item.budOffer !== null && item.budOffer !== undefined) || (item.buds?.length ?? 0) > 0;
}

/** 拠点の成長を導く材料を既存の保存データから集める */
export function hubProgressSource(
  profile: Profile,
  skillProfile: SkillProfile,
  codex: CodexSave,
  achievements: AchievementSave,
  quests: QuestSave,
): HubProgressSource {
  const equipped = Object.values(profile.equipment).filter((it): it is Item => it !== null && it !== undefined);
  return {
    runs: profile.meta.runs,
    codex,
    stoneCount: skillProfile.stones.length,
    hasBud: [...equipped, ...profile.stash].some(hasEverBudded),
    achievements,
    quests,
  };
}

/**
 * 決定キーの長押しを数え始めてよいか。拠点に入った瞬間に押していたキー（タイトルの Enter など）は、
 * 一度離すまで数えない。離さずに押し続けると入った直後に出撃してしまうため
 */
export interface HoldLatch {
  armed: boolean;
}

export function createHoldLatch(): HoldLatch {
  return { armed: false };
}

export function resetHoldLatch(latch: HoldLatch): void {
  latch.armed = false;
}

/** 今フレームの押しっぱなし（down）を、一度離した後の押しっぱなしだけに絞る */
export function latchedHold(latch: HoldLatch, down: boolean): boolean {
  if (!down) {
    latch.armed = true;
    return false;
  }
  return latch.armed;
}
