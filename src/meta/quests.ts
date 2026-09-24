import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { JOBS, JOB_KEYS, type JobKey } from "../data/jobs";
import { META } from "../data/tuning";
import { uniqueDef } from "../loot/named";
import { BOONS } from "../system/boonDefs";
import { ORIGINS, ORIGIN_KEYS, type OriginKey, runTier } from "../system/runSetup";
import { CODEX_TAB_LABEL, type CodexTab } from "./codex";
import { type LinkKind, linkId } from "./links";

/**
 * 依頼（docs/ideas/meta-and-weapons.md 5 章）。ラン開始時に 3 択で 1 つ受け、ラン中の出来事を state.questRun に数える
 * （src/meta/runRecord.ts。ゲーム進行には効かない）。ラン終了時に main.ts が recordQuest で達成を判定して保存する。
 * 報酬は強さではなく選択肢と表現（起点・ジョブの解放・名のある遺物の抽選・図鑑の頁・称号）
 */

// -----------------------------------------------------------------------------
// ラン中の数え上げ（state.questRun）
// -----------------------------------------------------------------------------

export interface QuestCounters {
  kills: number;
  burnKills: number;
  /** 冷気か凍結が付いたまま倒した */
  chillKills: number;
  poisonKills: number;
  bleedKills: number;
  shockKills: number;
  staggers: number;
  counters: number;
  justDodges: number;
  crits: number;
  bursts: number;
  skillCasts: number;
  /** 通常の射撃（スキルの射撃は数えない） */
  shots: number;
  hurts: number;
  reactions: number;
  vaporizes: number;
  /** スキルの連携（skills/combos.ts）の成立 */
  skillCombos: number;
  /** 2 語以上の連鎖の成立 */
  chains: number;
  maxChainLen: number;
  roomsCleared: number;
  hordesCleared: number;
  challengesCleared: number;
  /** 被弾 0 のまま階段で降りた階の数 */
  floorsNoHurt: number;
  bossKills: number;
  /** 通常の射撃を 1 度も撃たずに倒したボス */
  bossNoShot: number;
  lairKills: number;
  /** 死神が出ている間に階段で降りた */
  reaperEscapes: number;
  /** ラン中に持った誓約の数の最大（階ごとに見る） */
  maxKeystones: number;
}

export type QuestCounterKey = keyof QuestCounters;

export function createQuestCounters(): QuestCounters {
  return {
    kills: 0,
    burnKills: 0,
    chillKills: 0,
    poisonKills: 0,
    bleedKills: 0,
    shockKills: 0,
    staggers: 0,
    counters: 0,
    justDodges: 0,
    crits: 0,
    bursts: 0,
    skillCasts: 0,
    shots: 0,
    hurts: 0,
    reactions: 0,
    vaporizes: 0,
    skillCombos: 0,
    chains: 0,
    maxChainLen: 0,
    roomsCleared: 0,
    hordesCleared: 0,
    challengesCleared: 0,
    floorsNoHurt: 0,
    bossKills: 0,
    bossNoShot: 0,
    lairKills: 0,
    reaperEscapes: 0,
    maxKeystones: 0,
  };
}

export interface QuestRun {
  /** このランで受けた依頼。受けていなければ null */
  key: QuestKey | null;
  counters: QuestCounters;
  /** 起こした反応の種類 */
  reactionKinds: Set<string>;
  /** プレイヤーが敵に付けた状態異常の種類 */
  statusKinds: Set<string>;
  /** このランで成立した連携（src/meta/links.ts の id。スキルの連携・反応・連鎖） */
  linkKinds: Set<string>;
  /** そのうち図鑑に無かった（初めて見つけた）連携 */
  newLinks: Set<string>;
  /** 今の階で受けた被弾の回数 */
  floorHurt: number;
  /** 前ステップの深さ（階段で降りたことを差分で拾う） */
  lastDepth: number;
  /** 前ステップに死神が出ていたか */
  reaperOut: boolean;
}

export function createQuestRun(key: QuestKey | null = null): QuestRun {
  return {
    key,
    counters: createQuestCounters(),
    reactionKinds: new Set(),
    statusKinds: new Set(),
    linkKinds: new Set(),
    newLinks: new Set(),
    floorHurt: 0,
    lastDepth: 1,
    reaperOut: false,
  };
}

/** 進行の判定に使う値（数え上げ + ラン終了時点の状態） */
export interface QuestSnapshot extends QuestCounters {
  depth: number;
  keystones: number;
  cursedBoons: number;
  tier: number;
  reactionKinds: number;
  statusKinds: number;
  /** このランで成立した連携の種類（3 系統の合計）と系統ごとの内訳 */
  linkKinds: number;
  comboKinds: number;
  chainKinds: number;
  /** 図鑑に無かった連携の数 / そのうち反応の数 */
  newLinks: number;
  newReactions: number;
}

/** id の集合のうち、その系統（「系統:」で始まる）の数 */
function countKind(ids: ReadonlySet<string>, kind: LinkKind): number {
  const prefix = linkId(kind, "");
  return [...ids].filter((id) => id.startsWith(prefix)).length;
}

export type QuestSnapshotSource = Pick<GameState, "questRun" | "depth" | "stats" | "boons" | "modifiers">;

export function questSnapshot(state: QuestSnapshotSource): QuestSnapshot {
  const run = state.questRun;
  return {
    ...run.counters,
    depth: state.depth,
    keystones: Math.max(run.counters.maxKeystones, state.stats.keystones.length),
    cursedBoons: state.boons.filter((k) => BOONS[k].cursed).length,
    tier: runTier(state.modifiers),
    reactionKinds: run.reactionKinds.size,
    statusKinds: run.statusKinds.size,
    linkKinds: run.linkKinds.size,
    comboKinds: countKind(run.linkKinds, "combo"),
    chainKinds: countKind(run.linkKinds, "chain"),
    newLinks: run.newLinks.size,
    newReactions: countKind(run.newLinks, "reaction"),
  };
}

// -----------------------------------------------------------------------------
// 依頼の定義
// -----------------------------------------------------------------------------

export const QUEST_KEYS = [
  "burnout",
  "steamHand",
  "shaker",
  "oathless",
  "alchemist",
  "comboArtist",
  "hordeBreaker",
  "kingslayer",
  "bladeOnly",
  "untouched",
  "justDancer",
  "counterman",
  "plague",
  "cursedDepth",
  "highStakes",
  "reaperDance",
  "chainWeaver",
  "deepChain",
  "frostbite",
  "venomGarden",
  "bloodPath",
  "critStorm",
  "spellweaver",
  "deepDiver",
  "trialWalker",
  "lairHunter",
  "thunderRing",
  "burstMaster",
  "pathfinder",
  "newReaction",
  "comboForms",
  "chainForms",
  "linkWeb",
] as const;
export type QuestKey = (typeof QUEST_KEYS)[number];

export type QuestReward =
  | { kind: "origin"; origin: OriginKey }
  | { kind: "job"; job: JobKey }
  | { kind: "relic"; relic: string }
  | { kind: "page"; page: CodexTab }
  | { kind: "title"; title: string };

export interface QuestDef {
  name: string;
  /** 達成条件の文 */
  desc: string;
  goal: number;
  /** 今の進行（goal 以上で達成） */
  measure: (s: QuestSnapshot) => number;
  reward: QuestReward;
}

/** 条件付きの深さ（条件を満たしていなければ 0） */
function depthIf(ok: boolean, depth: number): number {
  return ok ? depth : 0;
}

export const QUESTS: Readonly<Record<QuestKey, QuestDef>> = {
  burnout: { name: "燃え尽き", desc: "燃焼中の敵を 50 体倒す。", goal: 50, measure: (s) => s.burnKills, reward: { kind: "title", title: "灰を撒く者" } },
  steamHand: { name: "蒸気の手", desc: "蒸発（燃焼 + 冷気）を 10 回起こす。", goal: 10, measure: (s) => s.vaporizes, reward: { kind: "page", page: "link" } },
  shaker: { name: "揺さぶり", desc: "敵を 100 回怯ませる。", goal: 100, measure: (s) => s.staggers, reward: { kind: "relic", relic: "unshakenScale" } },
  oathless: {
    name: "誓約を持たずに",
    desc: "誓約を一度も持たずに地下 5 階へ着く。",
    goal: 5,
    measure: (s) => depthIf(s.keystones === 0, s.depth),
    reward: { kind: "title", title: "誓わぬ者" },
  },
  alchemist: { name: "反応の目録", desc: "状態異常の反応を 10 種類起こす。", goal: 10, measure: (s) => s.reactionKinds, reward: { kind: "origin", origin: "chanter" } },
  comboArtist: { name: "連携の稽古", desc: "スキルの連携を 5 回決める。", goal: 5, measure: (s) => s.skillCombos, reward: { kind: "relic", relic: "chantRosary" } },
  hordeBreaker: { name: "巣窟崩し", desc: "巣窟を 3 つ制圧する。", goal: 3, measure: (s) => s.hordesCleared, reward: { kind: "relic", relic: "lastBell" } },
  kingslayer: { name: "王殺し", desc: "ボスを 2 体倒す。", goal: 2, measure: (s) => s.bossKills, reward: { kind: "relic", relic: "kingslayerCollar" } },
  bladeOnly: { name: "刃のみ", desc: "射撃を 1 度も撃たずにボスを倒す。", goal: 1, measure: (s) => s.bossNoShot, reward: { kind: "title", title: "刃一筋" } },
  untouched: { name: "無傷の階", desc: "1 度も被弾せずに階段を降りる。", goal: 1, measure: (s) => s.floorsNoHurt, reward: { kind: "page", page: "enemy" } },
  justDancer: { name: "見切りの舞", desc: "見切りを 15 回決める。", goal: 15, measure: (s) => s.justDodges, reward: { kind: "job", job: "shadow" } },
  counterman: { name: "返し手", desc: "カウンターを 10 回決める。", goal: 10, measure: (s) => s.counters, reward: { kind: "relic", relic: "returningSwallow" } },
  plague: { name: "五重苦", desc: "敵に状態異常を 5 種類付ける。", goal: 5, measure: (s) => s.statusKinds, reward: { kind: "relic", relic: "contagionFang" } },
  cursedDepth: {
    name: "呪いを抱く",
    desc: "呪い付きの祝福を 2 つ持ったまま地下 4 階へ着く。",
    goal: 4,
    measure: (s) => depthIf(s.cursedBoons >= 2, s.depth),
    reward: { kind: "origin", origin: "cursedOne" },
  },
  highStakes: {
    name: "大博打",
    desc: "位階 3 以上の縛りで地下 3 階へ着く。",
    goal: 3,
    measure: (s) => depthIf(s.tier >= 3, s.depth),
    reward: { kind: "origin", origin: "gambler" },
  },
  reaperDance: { name: "死神と踊る", desc: "死神が出ている間に階段を降りる。", goal: 1, measure: (s) => s.reaperEscapes, reward: { kind: "origin", origin: "reaperFriend" } },
  chainWeaver: { name: "連鎖の糸", desc: "連鎖を 20 回つなぐ。", goal: 20, measure: (s) => s.chains, reward: { kind: "job", job: "invoker" } },
  deepChain: { name: "三段の連鎖", desc: "3 段の連鎖をつなぐ。", goal: 3, measure: (s) => s.maxChainLen, reward: { kind: "job", job: "alchemist" } },
  frostbite: { name: "凍てつく刃", desc: "冷気か凍結の付いた敵を 30 体倒す。", goal: 30, measure: (s) => s.chillKills, reward: { kind: "title", title: "霜の手" } },
  venomGarden: { name: "毒の庭", desc: "毒の付いた敵を 30 体倒す。", goal: 30, measure: (s) => s.poisonKills, reward: { kind: "page", page: "relic" } },
  bloodPath: { name: "血の道", desc: "出血中の敵を 30 体倒す。", goal: 30, measure: (s) => s.bleedKills, reward: { kind: "job", job: "hexer" } },
  critStorm: { name: "急所読み", desc: "会心を 150 回出す。", goal: 150, measure: (s) => s.crits, reward: { kind: "job", job: "lancer" } },
  spellweaver: { name: "詠唱の道", desc: "スキルを 60 回使う。", goal: 60, measure: (s) => s.skillCasts, reward: { kind: "page", page: "place" } },
  deepDiver: { name: "深みへ", desc: "地下 8 階へ着く。", goal: 8, measure: (s) => s.depth, reward: { kind: "title", title: "深淵を覗く者" } },
  trialWalker: { name: "試練を越えて", desc: "試練の部屋を 2 つ制圧する。", goal: 2, measure: (s) => s.challengesCleared, reward: { kind: "page", page: "boon" } },
  lairHunter: { name: "部屋主狩り", desc: "部屋主を 3 体倒す。", goal: 3, measure: (s) => s.lairKills, reward: { kind: "title", title: "主狩り" } },
  thunderRing: { name: "雷の狩り", desc: "感電中の敵を 30 体倒す。", goal: 30, measure: (s) => s.shockKills, reward: { kind: "title", title: "雷を纏う者" } },
  burstMaster: { name: "全力解放", desc: "バーストを 8 回放つ。", goal: 8, measure: (s) => s.bursts, reward: { kind: "title", title: "解き放つ者" } },
  // ---- 発見の依頼（docs/ideas/synergy-web.md 5-e）。図鑑の既知はラン開始時の写し ----
  pathfinder: { name: "未踏の連携", desc: "図鑑に無い連携を 2 種見つける。", goal: 2, measure: (s) => s.newLinks, reward: { kind: "title", title: "未踏を拓く者" } },
  newReaction: { name: "新しい反応", desc: "図鑑に無い反応を 1 種起こす。", goal: 1, measure: (s) => s.newReactions, reward: { kind: "title", title: "錬金の徒" } },
  comboForms: { name: "連携の型", desc: "スキルの連携を 3 種決める。", goal: 3, measure: (s) => s.comboKinds, reward: { kind: "title", title: "型の探究者" } },
  chainForms: { name: "糸の綾", desc: "連鎖を 4 種類つなぐ。", goal: 4, measure: (s) => s.chainKinds, reward: { kind: "title", title: "糸を手繰る者" } },
  linkWeb: { name: "網の目", desc: "1 回の探索で連携を 10 種成立させる。", goal: 10, measure: (s) => s.linkKinds, reward: { kind: "page", page: "link" } },
};

export function isQuestKey(v: unknown): v is QuestKey {
  return typeof v === "string" && (QUEST_KEYS as readonly string[]).includes(v);
}

/** 進行（goal で頭打ち）と達成 */
export function questProgress(key: QuestKey, snap: QuestSnapshot): { value: number; goal: number; done: boolean } {
  const def = QUESTS[key];
  const value = Math.max(0, Math.min(def.goal, Math.floor(def.measure(snap))));
  return { value, goal: def.goal, done: value >= def.goal };
}

/** 報酬の表示文 */
export function questRewardLabel(reward: QuestReward): string {
  switch (reward.kind) {
    case "origin":
      return `起点「${ORIGINS[reward.origin].name}」を解放`;
    case "job":
      return `ジョブ「${JOBS[reward.job].name}」を解放`;
    case "relic":
      return `名のある遺物「${uniqueDef(reward.relic)?.name ?? reward.relic}」が抽選に加わる`;
    case "page":
      return `図鑑の頁「${CODEX_TAB_LABEL[reward.page]}」（未発見の手がかりが増える）`;
    case "title":
      return `称号「${reward.title}」`;
  }
}

// -----------------------------------------------------------------------------
// 保存データ（src/meta/questStore.ts が読み書き）と、そこから読む解放
// -----------------------------------------------------------------------------

export interface QuestSave {
  version: 1;
  /** 達成した依頼 → 達成した時刻（epoch ms。表示にだけ使う） */
  completed: Partial<Record<QuestKey, number>>;
  /** 受けたまま未達成の依頼。やり直し・同じシードでの再挑戦は起点画面を通らないので、これを引き継ぐ */
  active: QuestKey | null;
}

export function createQuestSave(): QuestSave {
  return { version: 1, completed: {}, active: null };
}

export function isQuestCompleted(save: Readonly<QuestSave>, key: QuestKey): boolean {
  return save.completed[key] !== undefined;
}

export function completedQuestCount(save: Readonly<QuestSave>): number {
  return QUEST_KEYS.filter((k) => isQuestCompleted(save, k)).length;
}

/** 起点が解放済みか。unlockedBy の無い起点は最初から使える */
export function isOriginUnlocked(save: Readonly<QuestSave>, origin: OriginKey): boolean {
  const by = ORIGINS[origin].unlockedBy;
  return by === undefined || isQuestCompleted(save, by);
}

export function lockedOrigins(save: Readonly<QuestSave>): Set<OriginKey> {
  return new Set(ORIGIN_KEYS.filter((o) => !isOriginUnlocked(save, o)));
}

/** ジョブが解放済みか。unlockedBy の無いジョブは最初から使える */
export function isJobUnlocked(save: Readonly<QuestSave>, job: JobKey): boolean {
  const by = JOBS[job].unlockedBy;
  return by === undefined || isQuestCompleted(save, by);
}

export function lockedJobs(save: Readonly<QuestSave>): Set<JobKey> {
  return new Set(JOB_KEYS.filter((j) => !isJobUnlocked(save, j)));
}

/** 達成済みの依頼が与えた図鑑の頁 */
export function codexPages(save: Readonly<QuestSave>): Set<CodexTab> {
  const pages = new Set<CodexTab>();
  for (const key of QUEST_KEYS) {
    const reward = QUESTS[key].reward;
    if (reward.kind === "page" && isQuestCompleted(save, key)) pages.add(reward.page);
  }
  return pages;
}

/**
 * まだ抽選に出ない名のある遺物（依頼の報酬で、未達成のもの）。
 * 装備の生成（src/loot/generator.ts）がこれを除けば「抽選の解放」になる（拾得レーンの統合待ち）
 */
export function lockedRelicKeys(save: Readonly<QuestSave>): string[] {
  const out: string[] = [];
  for (const key of QUEST_KEYS) {
    const reward = QUESTS[key].reward;
    if (reward.kind === "relic" && !isQuestCompleted(save, key)) out.push(reward.relic);
  }
  return out;
}

/** 達成済みの依頼が与えた称号（key と表示名） */
export function questTitles(save: Readonly<QuestSave>): { key: QuestKey; title: string }[] {
  const out: { key: QuestKey; title: string }[] = [];
  for (const key of QUEST_KEYS) {
    const reward = QUESTS[key].reward;
    if (reward.kind === "title" && isQuestCompleted(save, key)) out.push({ key, title: reward.title });
  }
  return out;
}

// -----------------------------------------------------------------------------
// 3 択の抽選と、ラン終了時の判定
// -----------------------------------------------------------------------------

/** 抽選の種をランの seed から離す（同じ seed でもゲームの乱数列とは別の並びにする） */
const OFFER_SALT = 0x51e57;

/**
 * 3 択の候補。未達成を優先し、足りなければ達成済みで埋める（達成済みは報酬なしで受けられる）。
 * seed はランのシード（hashSeed）。state.rng は使わない（ゲームの乱数列を動かさない）
 */
export function pickQuestOffers(save: Readonly<QuestSave>, seed: number, count: number = META.questOffers): QuestKey[] {
  const rng = createRng((seed ^ OFFER_SALT) >>> 0);
  const open = QUEST_KEYS.filter((k) => !isQuestCompleted(save, k));
  const done = QUEST_KEYS.filter((k) => isQuestCompleted(save, k));
  const out: QuestKey[] = [];
  for (const pool of [open, done]) {
    const rest = [...pool];
    while (out.length < count && rest.length > 0) {
      const index = rng.int(0, rest.length - 1);
      const [picked] = rest.splice(index, 1);
      if (picked !== undefined) out.push(picked);
    }
  }
  return out;
}

export interface QuestOutcome {
  key: QuestKey;
  value: number;
  goal: number;
  done: boolean;
  /** 今回初めて達成した（報酬が入った） */
  newlyCompleted: boolean;
}

/**
 * ラン終了時に 1 回呼ぶ。受けた依頼を判定し、達成なら保存データへ記録する（保存データを書き換える）。
 * 未達成なら active に残し、次のやり直しへ引き継ぐ
 */
export function recordQuest(state: QuestSnapshotSource, save: QuestSave, now: number): QuestOutcome | null {
  const key = state.questRun.key;
  if (key === null) return null;
  const progress = questProgress(key, questSnapshot(state));
  const already = isQuestCompleted(save, key);
  if (progress.done) {
    if (!already) save.completed[key] = now;
    save.active = null;
  } else {
    save.active = key;
  }
  return { key, ...progress, newlyCompleted: progress.done && !already };
}

/** 引き継ぐ依頼（達成済みになっていたら引き継がない） */
export function carriedQuest(save: Readonly<QuestSave>): QuestKey | null {
  const key = save.active;
  if (key === null || isQuestCompleted(save, key)) return null;
  return key;
}
