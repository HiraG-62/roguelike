import { ENEMIES } from "../data/enemies";
import { ARC, ROOM_KIND } from "../data/tuning";
import { CONTRACTOR_KEYS, CONTRACTORS, type ContractorKey } from "../system/contractors";
import type { RunEventKey } from "../system/runEvents";
import type { RunMetaSetup } from "../system/runMeta";
import type { CodexSave } from "./codex";
import { QUESTS, type QuestKey, type QuestSave, isQuestCompleted } from "./quests";

/**
 * 解放制（docs/ideas/meta-impl.md 2-5）。契約者・追加の部屋・ランイベントは、最初は一部だけがランに出て、
 * 章ボスの撃破（図鑑）と依頼の達成で増える。条件は既存の保存データ（図鑑・依頼）から導くだけで、新しい保存値は持たない
 * （今までのセーブにも効く。データは消えず、図鑑・依頼が進めば戻る）。
 * 封じる側（ランの中）は state.runMeta の lockedRooms / lockedContractors / lockedEvents を読む
 */

export type UnlockCondition = { kind: "start" } | { kind: "chapterBoss"; chapter: number } | { kind: "quest"; quest: QuestKey };

/** 追加の部屋の種類（ROOM_KIND.extra の key） */
export type ExtraRoomKind = keyof typeof ROOM_KIND.extra;

const START: UnlockCondition = { kind: "start" };
const chapterBoss = (chapter: number): UnlockCondition => ({ kind: "chapterBoss", chapter });
const quest = (key: QuestKey): UnlockCondition => ({ kind: "quest", quest: key });

/** 契約者 9 人: 行商・修理屋・占いが最初から。残りは依頼の達成で現れる */
export const CONTRACTOR_UNLOCKS: Readonly<Record<ContractorKey, UnlockCondition>> = {
  peddler: START,
  mender: START,
  seer: START,
  notary: quest("lairHunter"),
  bookie: quest("deepDiver"),
  bard: quest("pathfinder"),
  smith: quest("burnout"),
  guide: quest("chainForms"),
  ferryman: quest("thunderRing"),
};

/** 追加の部屋 20 種: 最初から 5、章 1 の主で 5、章 2 の主で 6、章 3 の主で 4 */
export const ROOM_UNLOCKS: Readonly<Record<ExtraRoomKind, UnlockCondition>> = {
  library: START,
  gamble: START,
  dummyHall: START,
  altar: START,
  watchtower: START,
  forge: chapterBoss(1),
  exchange: chapterBoss(1),
  vault: chapterBoss(1),
  escape: chapterBoss(1),
  arena: chapterBoss(1),
  elementAltar: chapterBoss(2),
  resonance: chapterBoss(2),
  tideRoom: chapterBoss(2),
  fogRoom: chapterBoss(2),
  escort: chapterBoss(2),
  nest: chapterBoss(2),
  mirror: chapterBoss(3),
  invertHall: chapterBoss(3),
  reaperNest: chapterBoss(3),
  curseShrine: chapterBoss(3),
};

/** ランイベント 28 種: 最初から 9、章 1 の主で 7、章 2 の主で 7、章 3 の主で 5 */
export const EVENT_UNLOCKS: Readonly<Record<RunEventKey, UnlockCondition>> = {
  reinforce: START,
  bounty: START,
  quake: START,
  treasureRain: START,
  momentum: START,
  meteor: START,
  blackout: START,
  bats: START,
  duel: START,
  manaDrought: chapterBoss(1),
  timeRift: chapterBoss(1),
  curseWind: chapterBoss(1),
  fog: chapterBoss(1),
  sluggish: chapterBoss(1),
  echoVein: chapterBoss(1),
  lifeFlow: chapterBoss(1),
  bloodMoon: chapterBoss(2),
  frenzyMoon: chapterBoss(2),
  shrink: chapterBoss(2),
  curseVoice: chapterBoss(2),
  flood: chapterBoss(2),
  silence: chapterBoss(2),
  thiefChase: chapterBoss(2),
  reactionSurge: chapterBoss(3),
  thunderstorm: chapterBoss(3),
  elementStorm: chapterBoss(3),
  reaperPass: chapterBoss(3),
  boonReroll: chapterBoss(3),
};

export interface UnlockSources {
  codex: Readonly<CodexSave>;
  quests: Readonly<QuestSave>;
}

/** ランに持ち込む封じの 3 つ組（RunMetaSetup の一部） */
export type UnlockLocked = Pick<RunMetaSetup, "lockedRooms" | "lockedContractors" | "lockedEvents">;

/** 章ボスの key（ARC.chapters は 1 章から順） */
function chapterBossKey(chapter: number): string | null {
  return ARC.chapters[chapter - 1]?.boss ?? null;
}

export function isUnlocked(cond: UnlockCondition, src: UnlockSources): boolean {
  switch (cond.kind) {
    case "start":
      return true;
    case "chapterBoss": {
      const boss = chapterBossKey(cond.chapter);
      return boss !== null && (src.codex.enemyKills[boss] ?? 0) > 0;
    }
    case "quest":
      return isQuestCompleted(src.quests, cond.quest);
  }
}

/** 表の順（オブジェクトの key の順）に、まだ開いていない key を返す */
function lockedKeys<K extends string>(table: Readonly<Record<K, UnlockCondition>>, src: UnlockSources): K[] {
  return (Object.keys(table) as K[]).filter((k) => !isUnlocked(table[k], src));
}

/** ランに封じさせる中身。表の順なので同じ保存データなら同じ並び（記録にもそのまま載る） */
export function lockedRunContent(src: UnlockSources): UnlockLocked {
  return {
    lockedRooms: lockedKeys(ROOM_UNLOCKS, src),
    lockedContractors: lockedKeys(CONTRACTOR_UNLOCKS, src),
    lockedEvents: lockedKeys(EVENT_UNLOCKS, src),
  };
}

/** 解放の条件の一言（図鑑の未踏の部屋に添える）。最初から開いているものは空 */
export function unlockHint(cond: UnlockCondition): string {
  switch (cond.kind) {
    case "start":
      return "";
    case "chapterBoss": {
      const key = chapterBossKey(cond.chapter);
      const def = ENEMIES.find((d) => d.key === key);
      return def ? `${def.bossTitle ?? def.name}を倒すと現れる` : "";
    }
    case "quest":
      return `依頼「${QUESTS[cond.quest].name}」の達成で現れる`;
  }
}

/** 依頼を達成すると開く契約者の文（依頼の一覧の説明に添える）。無ければ空配列 */
export function questUnlockLabels(key: QuestKey): string[] {
  return CONTRACTOR_KEYS.filter((c) => {
    const cond = CONTRACTOR_UNLOCKS[c];
    return cond.kind === "quest" && cond.quest === key;
  }).map((c) => `契約者「${CONTRACTORS[c].name}」がランに現れる`);
}

/** before では封じていて after では封じていない key */
function newlyOpened<K extends string>(before: readonly K[], after: readonly K[]): K[] {
  return before.filter((k) => !after.includes(k));
}

/**
 * 死亡画面の知らせ（前後の封じの差）。死亡画面の行数に限りがあるので 1 行にまとめる。無ければ空配列。
 * 例: `新しく現れる: 契約者「渡し守」・部屋 5・出来事 7`
 */
export function unlockNewsLines(before: UnlockLocked, after: UnlockLocked): string[] {
  const parts: string[] = [];
  const contractors = newlyOpened(before.lockedContractors, after.lockedContractors);
  if (contractors.length > 0) parts.push(`契約者${contractors.map((c) => `「${CONTRACTORS[c].name}」`).join("")}`);
  const rooms = newlyOpened(before.lockedRooms, after.lockedRooms).length;
  if (rooms > 0) parts.push(`部屋 ${rooms}`);
  const events = newlyOpened(before.lockedEvents, after.lockedEvents).length;
  if (events > 0) parts.push(`出来事 ${events}`);
  return parts.length === 0 ? [] : [`新しく現れる: ${parts.join("・")}`];
}
