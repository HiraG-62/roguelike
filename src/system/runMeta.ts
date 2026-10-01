import type { EliteKind, RoomKind } from "../core/state";
import { ROOM_KIND } from "../data/tuning";
import type { ContractorKey } from "./contractors";
import { nemesisEligible } from "./deathCause";
import { ELITE_KINDS } from "./elites";
import type { RunEventKey } from "./runEvents";

/**
 * ランの外から持ち込む中身（仇・解放の封じ・位階の見返り。docs/ideas/meta-impl.md 2-8）。
 * RunSetup.runMeta → ReplayData.runMeta → GameState.runMeta の道で写す（lockedRelics と同じ）。
 * 空なら今と同じ乱数消費になる（REPLAY_VERSION を上げない根拠）。
 * contractors / runEvents / specialRooms からは値を import しない（それらが state.runMeta を読むので輪を作らない）
 */

export const TIER_PERKS = ["market", "exit"] as const;
export type TierPerk = (typeof TIER_PERKS)[number];

/** 仇の種: 敵の key・記録の修飾子（主 → 添え）・倒された深度 */
export interface NemesisSpec {
  key: string;
  elites: EliteKind[];
  depth: number;
}

export interface RunMetaSetup {
  nemesis: NemesisSpec | null;
  /** 置かない追加の部屋の種類（ROOM_KIND.extra の key だけ） */
  lockedRooms: RoomKind[];
  lockedContractors: ContractorKey[];
  lockedEvents: RunEventKey[];
  perks: TierPerk[];
}

/** 仇の修飾子の上限（主 + 添え） */
const NEMESIS_ELITES_MAX = 2;

/**
 * 契約者・ランイベントの key の一覧。値の import を避けるため型から写す（Record なので key の過不足は型検査で落ちる。
 * 一覧が contractors.ts / runEvents.ts と一致することは runMeta.test.ts が縛る）
 */
const CONTRACTOR_KEY_SET: Readonly<Record<ContractorKey, true>> = {
  notary: true,
  peddler: true,
  mender: true,
  seer: true,
  bookie: true,
  bard: true,
  smith: true,
  guide: true,
  ferryman: true,
};

const RUN_EVENT_KEY_SET: Readonly<Record<RunEventKey, true>> = {
  reinforce: true,
  bounty: true,
  blackout: true,
  quake: true,
  treasureRain: true,
  manaDrought: true,
  timeRift: true,
  fog: true,
  curseWind: true,
  bloodMoon: true,
  frenzyMoon: true,
  meteor: true,
  shrink: true,
  momentum: true,
  curseVoice: true,
  duel: true,
  sluggish: true,
  flood: true,
  silence: true,
  reactionSurge: true,
  thunderstorm: true,
  elementStorm: true,
  reaperPass: true,
  echoVein: true,
  bats: true,
  lifeFlow: true,
  boonReroll: true,
  thiefChase: true,
};

/** 型から写した一覧（テストが contractors.ts / runEvents.ts の一覧と突き合わせる） */
export const RUN_META_CONTRACTOR_KEYS = Object.keys(CONTRACTOR_KEY_SET) as ContractorKey[];
export const RUN_META_EVENT_KEYS = Object.keys(RUN_EVENT_KEY_SET) as RunEventKey[];

export function emptyRunMeta(): RunMetaSetup {
  return { nemesis: null, lockedRooms: [], lockedContractors: [], lockedEvents: [], perks: [] };
}

export function isEmptyRunMeta(m: Readonly<RunMetaSetup>): boolean {
  return m.nemesis === null && m.lockedRooms.length === 0 && m.lockedContractors.length === 0 && m.lockedEvents.length === 0 && m.perks.length === 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isExtraRoomKind(v: unknown): v is RoomKind {
  return typeof v === "string" && Object.hasOwn(ROOM_KIND.extra, v);
}

function isContractorKey(v: unknown): v is ContractorKey {
  return typeof v === "string" && Object.hasOwn(CONTRACTOR_KEY_SET, v);
}

function isRunEventKey(v: unknown): v is RunEventKey {
  return typeof v === "string" && Object.hasOwn(RUN_EVENT_KEY_SET, v);
}

function isTierPerk(v: unknown): v is TierPerk {
  return typeof v === "string" && (TIER_PERKS as readonly string[]).includes(v);
}

export function isEliteKind(v: unknown): v is EliteKind {
  return typeof v === "string" && (ELITE_KINDS as readonly string[]).includes(v);
}

/** 通る値だけを、最初に出た順に 1 つずつ残す */
function uniqueOf<T>(v: unknown, test: (x: unknown) => x is T): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    if (test(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

/** 仇の種を読む。仇になれない key・深度の壊れた値は null、未知の修飾子は捨てる */
export function sanitizeNemesisSpec(v: unknown): NemesisSpec | null {
  if (!isRecord(v) || typeof v.key !== "string" || !nemesisEligible(v.key)) return null;
  if (typeof v.depth !== "number" || !Number.isFinite(v.depth) || v.depth < 1) return null;
  const elites = uniqueOf(v.elites, isEliteKind).slice(0, NEMESIS_ELITES_MAX);
  return { key: v.key, elites, depth: Math.floor(v.depth) };
}

/** 保存データ・リプレイから読む。未知の key・壊れた値は黙って捨て、重複は 1 つにする */
export function sanitizeRunMeta(v: unknown): RunMetaSetup {
  if (!isRecord(v)) return emptyRunMeta();
  return {
    nemesis: sanitizeNemesisSpec(v.nemesis),
    lockedRooms: uniqueOf(v.lockedRooms, isExtraRoomKind),
    lockedContractors: uniqueOf(v.lockedContractors, isContractorKey),
    lockedEvents: uniqueOf(v.lockedEvents, isRunEventKey),
    perks: uniqueOf(v.perks, isTierPerk),
  };
}
