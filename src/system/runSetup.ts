import type { GameState } from "../core/state";
import type { JobKey } from "../data/jobs";
import type { QuestKey } from "../meta/quests";
import { ORIGIN, RUN_MOD } from "../data/tuning";
import { KEYSTONES, keystoneDef } from "../loot/affixes";
import { computeStats } from "../loot/stats";
import { type PlayerStats, createEmptyEquipment } from "../loot/types";
import { SKILL } from "../skills/data";
import { rollRuneModifier } from "../skills/generator";
import { stoneInSlot } from "../skills/persistence";
import type { SkillKey } from "../skills/types";
import { grantAttributePoints } from "../ui/attributeAlloc";
import { BOONS, BOON_KEYS, type BoonKey, grantBoon, hasBoon } from "./boons";
import { applyStats } from "./player";
import { applyJobStats, jobChangesStats } from "./jobs";
import { attachRune } from "./skills";

/**
 * 起点（ラン開始時の出発条件）とラン修飾子（自分で積む縛り。点の合計が位階）。
 * docs/ideas/run-expansion.md 7 章・8 章。ラン内の報酬はルール変更か一時効果で、永続の装備は書き換えない
 */

// -----------------------------------------------------------------------------
// 起点
// -----------------------------------------------------------------------------

export const ORIGIN_KEYS = ["wanderer", "swordPilgrim", "cursedOne", "unarmed", "chanter", "gambler", "reaperFriend"] as const;
export type OriginKey = (typeof ORIGIN_KEYS)[number];

export interface OriginDef {
  name: string;
  /** 何が変わるか（ハンデと報酬を並べて語る） */
  desc: string;
  /** このランだけ付く誓約 */
  keystones: readonly string[];
  /** この依頼を達成すると選べる（src/meta/quests.ts）。無ければ最初から選べる */
  unlockedBy?: QuestKey;
}

export const ORIGINS: Readonly<Record<OriginKey, OriginDef>> = {
  wanderer: { name: "放浪者", desc: "何も変えずに出発する。", keystones: [] },
  swordPilgrim: {
    name: "剣の巡礼者",
    desc: "誓約「剣の誓い」を背負い、近接の祝福を 1 つ持って出発する。",
    keystones: ["ks_bladeOath"],
  },
  cursedOne: {
    name: "呪われた者",
    desc: "呪い付きの祝福を 2 つ抱えて出発する。代わりにステータスの振り分け点を 4 得る。",
    keystones: [],
    unlockedBy: "cursedDepth",
  },
  unarmed: {
    name: "素手",
    desc: "地下 3 階に着くまで装備が封印される。代わりに振り分け点を 3 得る。",
    keystones: [],
  },
  chanter: {
    name: "詠み手",
    desc: "刻印符を 2 つ差して出発する。最大生命が 2 割減る。",
    keystones: [],
    unlockedBy: "alchemist",
  },
  gambler: {
    name: "賭博師",
    desc: "誓約「賭博師」を背負う。賭博の部屋が毎階に出る。",
    keystones: ["ks_gambler"],
    unlockedBy: "highStakes",
  },
  reaperFriend: {
    name: "死神の友",
    desc: "死神が最初から追ってくる（足は半分）。階段を降りるたびに振り分け点を 1 余分に得る。",
    keystones: [],
    unlockedBy: "reaperDance",
  },
};

export function isOriginKey(v: unknown): v is OriginKey {
  return typeof v === "string" && (ORIGIN_KEYS as readonly string[]).includes(v);
}

// -----------------------------------------------------------------------------
// ラン修飾子（縛り）
// -----------------------------------------------------------------------------

export const RUN_MOD_KEYS = [
  "thickHide",
  "quickHands",
  "eliteSwarm",
  "dryFountain",
  "hastyReaper",
  "eternalNight",
  "endlessReinforce",
  "roughLand",
  "doubleLinger",
  "hourglass",
  "glassBody",
] as const;
export type RunModKey = (typeof RUN_MOD_KEYS)[number];

export interface RunModDef {
  name: string;
  desc: string;
  /** 位階に足す点 */
  points: number;
}

export const RUN_MODS: Readonly<Record<RunModKey, RunModDef>> = {
  thickHide: { name: "厚い皮", desc: "敵の生命が 3 割増える。", points: 1 },
  quickHands: { name: "早い手", desc: "敵の予備動作が 1 割縮む。", points: 2 },
  eliteSwarm: { name: "精鋭", desc: "精鋭の抽選が 2 回になる。", points: 1 },
  dryFountain: { name: "乾いた泉", desc: "泉が湧かず、ハートが落ちない。", points: 2 },
  hastyReaper: { name: "急かす死神", desc: "死神の猶予が 3 割縮む。", points: 2 },
  eternalNight: { name: "常夜", desc: "すべての階が暗闇になる。", points: 2 },
  endlessReinforce: { name: "絶えぬ増援", desc: "封鎖するたびに増援が来る。", points: 2 },
  roughLand: { name: "荒れた大地", desc: "バイオームの地形が 2 倍になる。", points: 1 },
  doubleLinger: { name: "長居の二重苦", desc: "長居の代償が浅い階から、早く来る。", points: 3 },
  hourglass: { name: "部屋の砂時計", desc: "封鎖が長引くと増援が来る。", points: 2 },
  glassBody: { name: "薄氷", desc: "最大生命が 3 割減る。", points: 2 },
};

export function isRunModKey(v: unknown): v is RunModKey {
  return typeof v === "string" && (RUN_MOD_KEYS as readonly string[]).includes(v);
}

/** 位階 = 積んだ縛りの点の合計 */
export function runTier(modifiers: readonly RunModKey[]): number {
  return modifiers.reduce((sum, key) => sum + RUN_MODS[key].points, 0);
}

export function hasMod(state: Pick<GameState, "modifiers">, key: RunModKey): boolean {
  return state.modifiers.includes(key);
}

// -----------------------------------------------------------------------------
// ランの出発条件（createGame とリプレイが受け取る）
// -----------------------------------------------------------------------------

export interface RunSetup {
  origin: OriginKey;
  modifiers: RunModKey[];
  /** ジョブ（src/data/jobs.ts）。省略は見習い（旧データ・QA bot の既定） */
  job?: JobKey;
  /**
   * このランで抽選に出ない名のある遺物（依頼の報酬で未達成のもの。src/meta/quests.ts の lockedRelicKeys）。
   * ラン開始時に確定させ、ラン中に依頼を達成しても変えない（決定性）。省略は []
   */
  lockedRelics?: readonly string[];
}

export function defaultRunSetup(): RunSetup {
  return { origin: "wanderer", modifiers: [] };
}

/** 保存データから読む。未知の key は黙って落とし、重複は 1 つにする */
export function sanitizeRunSetup(origin: unknown, modifiers: unknown): RunSetup {
  const mods = Array.isArray(modifiers) ? modifiers.filter(isRunModKey) : [];
  return { origin: isOriginKey(origin) ? origin : "wanderer", modifiers: [...new Set(mods)] };
}

/** 保存データの除外遺物を読む。文字列以外は落とし、重複は 1 つにする */
export function sanitizeLockedRelics(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((k): k is string => typeof k === "string"))];
}

/** 起点が最初から付ける誓約（createGame の初期値） */
export function originKeystones(origin: OriginKey): string[] {
  return [...ORIGINS[origin].keystones];
}

// -----------------------------------------------------------------------------
// stats への畳み込み（system/player.ts の applyStats が最初に通す）
// -----------------------------------------------------------------------------

/** 素手の封印中か */
export function equipmentSealed(state: Pick<GameState, "origin" | "depth">): boolean {
  return state.origin === "unarmed" && state.depth < ORIGIN.unarmedUnsealDepth;
}

function maxHpMul(state: GameState): number {
  const origin = state.origin === "chanter" ? ORIGIN.chanterHpMul : 1;
  const mod = hasMod(state, "glassBody") ? RUN_MOD.glassBodyHpMul : 1;
  return origin * mod;
}

/**
 * 装備の stats に、起点・ジョブ・縛り・祭壇の誓約を畳み込む。何も無ければ同じオブジェクトを返す（従来と完全に同じ結果）。
 * 誓約は装備の誓約と排他グループがぶつかるなら足さない（装備側が勝つ。祭壇は候補の時点で除いている）
 */
export function applyRunStats(state: GameState, equipStats: PlayerStats): PlayerStats {
  const sealed = equipmentSealed(state);
  const hpMul = maxHpMul(state);
  const job = jobChangesStats(state.job);
  if (!sealed && hpMul === 1 && state.runKeystones.length === 0 && !job) return equipStats;
  const stats = structuredClone(sealed ? computeStats(createEmptyEquipment()) : equipStats);
  for (const key of state.runKeystones) addRunKeystone(stats, key);
  // ジョブの偏りは生値に足す（逓減は applyStats の deriveAttributes がまとめて掛ける）。倍率は誓約の後に掛ける
  if (job) applyJobStats(stats, state.job);
  stats.maxHp = Math.max(1, stats.maxHp * hpMul);
  return stats;
}

function addRunKeystone(stats: PlayerStats, key: string): void {
  const def = keystoneDef(key);
  if (!def || stats.keystones.includes(key)) return;
  const taken = new Set(stats.keystones.map((k) => keystoneDef(k)?.exclusiveGroup));
  if (taken.has(def.exclusiveGroup)) return;
  def.apply(stats);
  stats.keystones.push(key);
}

/** 起点・祭壇で誓約や封印が変わったとき、装備から stats を畳み直す */
export function refreshRunStats(state: GameState): void {
  applyStats(state, computeStats(state.profile.equipment));
}

/** 祭壇に並べられる誓約: 装備・ランの誓約と排他グループがぶつからないもの */
export function altarKeystoneCandidates(state: GameState): string[] {
  const taken = new Set(state.stats.keystones.map((k) => keystoneDef(k)?.exclusiveGroup));
  return KEYSTONES.filter((d) => !taken.has(d.exclusiveGroup) && !state.runKeystones.includes(d.key)).map((d) => d.key);
}

// -----------------------------------------------------------------------------
// 出発時・階段での処理
// -----------------------------------------------------------------------------

/** 起点の初期効果。createGame が applyStats・マナの充填の後、buildFloor の前に呼ぶ */
export function startOrigin(state: GameState): void {
  switch (state.origin) {
    case "swordPilgrim":
      grantRandomBoon(state, (key) => !BOONS[key].cursed && BOONS[key].tags.includes("melee"));
      return;
    case "cursedOne":
      for (let i = 0; i < ORIGIN.cursedBoons; i++) grantRandomBoon(state, (key) => BOONS[key].cursed);
      grantAttributePoints(state, ORIGIN.cursedPoints);
      return;
    case "unarmed":
      grantAttributePoints(state, ORIGIN.unarmedPoints);
      return;
    case "chanter":
      for (let i = 0; i < ORIGIN.chanterRunes; i++) attachRune(state, rollRuneModifier(state.rng, equippedSkillKeys(state)));
      return;
    default:
      return;
  }
}

/** 前提（系譜の前段・結び・装備のタグ）の要らない祝福から 1 つ */
function grantRandomBoon(state: GameState, filter: (key: BoonKey) => boolean): void {
  const pool = BOON_KEYS.filter((key) => {
    const def = BOONS[key];
    return filter(key) && !hasBoon(state, key) && !def.after && !def.duo && !def.requires;
  });
  if (pool.length === 0) return;
  grantBoon(state, state.rng.pick(pool));
}

export function equippedSkillKeys(state: GameState): SkillKey[] {
  const keys: SkillKey[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    const stone = stoneInSlot(state.skills.profile, i);
    if (stone) keys.push(stone.skillKey);
  }
  return keys;
}

/** 階段を降りた直後（新しい階の depth になってから）の起点の処理 */
export function onOriginDescend(state: GameState): void {
  if (state.origin === "reaperFriend") grantAttributePoints(state, ORIGIN.reaperFriendPoints);
  if (state.origin === "unarmed" && state.depth === ORIGIN.unarmedUnsealDepth) refreshRunStats(state);
}

/** 階段で得るスコアに掛ける位階の上乗せ */
export function tierScoreMul(state: Pick<GameState, "modifiers">): number {
  return 1 + runTier(state.modifiers) * RUN_MOD.scorePerTier;
}
