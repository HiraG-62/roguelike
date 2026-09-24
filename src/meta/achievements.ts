import { isDailySeedText } from "../core/replay";
import { ENEMIES } from "../data/enemies";
import { JOB_KEYS, type JobKey, isJobKey } from "../data/jobs";
import type { ProfileMeta } from "../loot/types";
import { BOONS, type BoonKey } from "../system/boonDefs";
import { FLOOR_KINDS } from "../system/biomes";
import { ORIGIN_KEYS } from "../system/runSetup";
import { CHAIN_SEPARATOR, CODEX_ENEMIES, type CodexSave } from "./codex";
import { QUEST_KEYS, type QuestKey, type QuestSave, completedQuestCount, isOriginUnlocked, isQuestKey, questTitles } from "./quests";
import { isRecord, readJson, sanitizeCount, writeJson } from "./storage";

/**
 * 実績と称号（docs/ideas/meta-and-weapons.md 4-1・4-7、docs/ideas/synergy-web.md 5-f）。
 * 図鑑・依頼・履歴から判定する。報酬は称号（表示名）だけで、効果は持たない。称号はタイトル画面に 1 つ出せる
 */

export const ACHIEVEMENTS_KEY = "roguelike.achievements.v1";
const CURRENT_VERSION = 1;

export interface AchievementContext {
  codex: Readonly<CodexSave>;
  quests: Readonly<QuestSave>;
  meta: Readonly<ProfileMeta>;
  /** 探索を終えたことのあるジョブ（AchievementSave.jobsPlayed。noteJobPlayed で積む）。省略は無し */
  jobsPlayed?: readonly string[];
}

export interface AchievementDef {
  key: string;
  /** 実績名。解除するとそのまま称号として名乗れる */
  name: string;
  desc: string;
  check: (ctx: AchievementContext) => boolean;
}

/** 実績「長い夜」の 1 ランの長さ（秒） */
const LONG_RUN_SECONDS = 20 * 60;

/** 実績「百芸の旅人」の対象（見習いは数えない） */
const PLAYABLE_JOBS: readonly JobKey[] = JOB_KEYS.filter((j) => j !== "none");

const BOSS_KEYS: readonly string[] = ENEMIES.filter((d) => d.boss === true).map((d) => d.key);

function killedKinds(ctx: AchievementContext): number {
  return Object.keys(ctx.codex.enemyKills).length;
}

function seenKinds(ctx: AchievementContext): number {
  return new Set([...ctx.codex.enemiesSeen, ...Object.keys(ctx.codex.enemyKills)]).size;
}

function bossesKilled(ctx: AchievementContext): number {
  return BOSS_KEYS.filter((k) => (ctx.codex.enemyKills[k] ?? 0) > 0).length;
}

function cursedBoonsTaken(ctx: AchievementContext): number {
  return ctx.codex.boons.filter((k) => Object.hasOwn(BOONS, k) && BOONS[k as BoonKey].cursed).length;
}

function reactionKinds(ctx: AchievementContext): number {
  return Object.keys(ctx.codex.reactions).length;
}

function longestChain(ctx: AchievementContext): number {
  return Object.keys(ctx.codex.chains).reduce((max, k) => Math.max(max, k.split(CHAIN_SEPARATOR).length), 0);
}

function history(ctx: AchievementContext): NonNullable<ProfileMeta["history"]> {
  return ctx.meta.history ?? [];
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { key: "firstRun", name: "初めの一歩", desc: "探索を 1 回終える。", check: (c) => c.meta.runs >= 1 },
  { key: "tenRuns", name: "常連", desc: "探索を 10 回終える。", check: (c) => c.meta.runs >= 10 },
  { key: "fiftyRuns", name: "潜り慣れた者", desc: "探索を 50 回終える。", check: (c) => c.meta.runs >= 50 },
  { key: "depth3", name: "地下の住人", desc: "地下 3 階へ着く。", check: (c) => c.meta.bestDepth >= 3 },
  { key: "depth6", name: "深層の歩き手", desc: "地下 6 階へ着く。", check: (c) => c.meta.bestDepth >= 6 },
  { key: "depth10", name: "奈落の縁", desc: "地下 10 階へ着く。", check: (c) => c.meta.bestDepth >= 10 },
  { key: "kills100", name: "百の屍", desc: "通算で 100 体倒す。", check: (c) => c.meta.totalKills >= 100 },
  { key: "kills1000", name: "千の屍", desc: "通算で 1000 体倒す。", check: (c) => c.meta.totalKills >= 1000 },
  { key: "seen10", name: "見聞を広げる", desc: "敵を 10 種類見る。", check: (c) => seenKinds(c) >= 10 },
  { key: "seen30", name: "魔物学者", desc: "敵を 30 種類見る。", check: (c) => seenKinds(c) >= 30 },
  { key: "killed50", name: "図鑑の番人", desc: "敵を 50 種類倒す。", check: (c) => killedKinds(c) >= 50 },
  { key: "enemyAll", name: "万物の狩人", desc: "図鑑の敵をすべて倒す。", check: (c) => CODEX_ENEMIES.every((d) => (c.codex.enemyKills[d.key] ?? 0) > 0) },
  { key: "boss1", name: "首級", desc: "ボスを倒す。", check: (c) => bossesKilled(c) >= 1 },
  { key: "bossAll", name: "王たちの墓標", desc: "すべての種類のボスを倒す。", check: (c) => BOSS_KEYS.length > 0 && bossesKilled(c) >= BOSS_KEYS.length },
  { key: "relic1", name: "名を知る者", desc: "名のある遺物を 1 つ手に入れる。", check: (c) => c.codex.relics.length >= 1 },
  { key: "relic10", name: "蒐集家", desc: "名のある遺物を 10 種類手に入れる。", check: (c) => c.codex.relics.length >= 10 },
  { key: "relic25", name: "宝物庫の主", desc: "名のある遺物を 25 種類手に入れる。", check: (c) => c.codex.relics.length >= 25 },
  { key: "boon20", name: "祝福を知る", desc: "祝福を 20 種類受ける。", check: (c) => c.codex.boons.length >= 20 },
  { key: "boon60", name: "祝福の書", desc: "祝福を 60 種類受ける。", check: (c) => c.codex.boons.length >= 60 },
  { key: "cursed5", name: "呪いの友", desc: "呪い付きの祝福を 5 種類受ける。", check: (c) => cursedBoonsTaken(c) >= 5 },
  { key: "reaction1", name: "化学反応", desc: "状態異常の反応を初めて起こす。", check: (c) => reactionKinds(c) >= 1 },
  { key: "reaction8", name: "反応の探求者", desc: "反応を 8 種類起こす。", check: (c) => reactionKinds(c) >= 8 },
  { key: "reaction16", name: "錬金の目", desc: "反応を 16 種類起こす。", check: (c) => reactionKinds(c) >= 16 },
  { key: "vaporize100", name: "蒸気の主", desc: "蒸発を通算 100 回起こす。", check: (c) => (c.codex.reactions.vaporize ?? 0) >= 100 },
  { key: "chain1", name: "縁をつなぐ", desc: "連鎖を初めてつなぐ。", check: (c) => Object.keys(c.codex.chains).length >= 1 },
  { key: "chain10", name: "網を編む者", desc: "連鎖を 10 種類つなぐ。", check: (c) => Object.keys(c.codex.chains).length >= 10 },
  { key: "chain3", name: "三段の糸", desc: "3 語以上の連鎖をつなぐ。", check: (c) => longestChain(c) >= 3 },
  { key: "biomeAll", name: "旅人", desc: "すべての種類の階を歩く。", check: (c) => FLOOR_KINDS.every((k) => c.codex.floorKinds.includes(k)) },
  { key: "rooms10", name: "部屋巡り", desc: "部屋を 10 種類巡る。", check: (c) => c.codex.roomKinds.length >= 10 },
  { key: "quest1", name: "依頼人", desc: "依頼を 1 つ達成する。", check: (c) => completedQuestCount(c.quests) >= 1 },
  { key: "quest10", name: "請負人", desc: "依頼を 10 達成する。", check: (c) => completedQuestCount(c.quests) >= 10 },
  { key: "questAll", name: "何でも屋", desc: "すべての依頼を達成する。", check: (c) => completedQuestCount(c.quests) >= QUEST_KEYS.length },
  { key: "originsAll", name: "百の出自", desc: "すべての起点を解放する。", check: (c) => ORIGIN_KEYS.every((o) => isOriginUnlocked(c.quests, o)) },
  { key: "jobsAll", name: "百芸の旅人", desc: "見習い以外のすべてのジョブで探索を終える。", check: (c) => PLAYABLE_JOBS.every((j) => c.jobsPlayed?.includes(j) === true) },
  { key: "daily", name: "日課", desc: "デイリーシードに挑む。", check: (c) => history(c).some((h) => isDailySeedText(h.seedText)) },
  { key: "combo50", name: "途切れぬ手", desc: "1 回の探索で 50 コンボをつなぐ。", check: (c) => history(c).some((h) => h.bestCombo >= 50) },
  { key: "longRun", name: "長い夜", desc: "1 回の探索を 20 分以上続ける。", check: (c) => history(c).some((h) => h.durationSec >= LONG_RUN_SECONDS) },
];

const ACHIEVEMENT_KEYS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map((a) => a.key));

export function achievementDef(key: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.key === key);
}

// -----------------------------------------------------------------------------
// 保存データ
// -----------------------------------------------------------------------------

export interface AchievementSave {
  version: 1;
  /** 解除した実績 → 解除した時刻（epoch ms。表示にだけ使う） */
  unlocked: Record<string, number>;
  /** 名乗っている称号（titleId の形）。無ければ null */
  title: string | null;
  /** 探索を終えたことのあるジョブ（実績「百芸の旅人」。旧データには無く、読むときに [] で補う） */
  jobsPlayed: JobKey[];
}

export function createAchievementSave(): AchievementSave {
  return { version: 1, unlocked: {}, title: null, jobsPlayed: [] };
}

/** ラン終了時に、そのランのジョブを記録する（保存データを書き換える）。戻り値は記録後の一覧 */
export function noteJobPlayed(save: AchievementSave, job: JobKey): readonly JobKey[] {
  if (!save.jobsPlayed.includes(job)) save.jobsPlayed.push(job);
  return save.jobsPlayed;
}

export function parseAchievementSave(parsed: unknown): AchievementSave | null {
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return null;
  const save = createAchievementSave();
  const unlocked = isRecord(parsed.unlocked) ? parsed.unlocked : {};
  for (const [key, at] of Object.entries(unlocked)) {
    if (ACHIEVEMENT_KEYS.has(key)) save.unlocked[key] = sanitizeCount(at);
  }
  save.title = typeof parsed.title === "string" && parseTitleId(parsed.title) !== null ? parsed.title : null;
  save.jobsPlayed = Array.isArray(parsed.jobsPlayed) ? [...new Set(parsed.jobsPlayed.filter(isJobKey))] : [];
  return save;
}

export function loadAchievements(storage?: Storage): AchievementSave {
  return parseAchievementSave(readJson(ACHIEVEMENTS_KEY, storage)) ?? createAchievementSave();
}

export function saveAchievements(save: AchievementSave, storage?: Storage): void {
  writeJson(ACHIEVEMENTS_KEY, save, storage);
}

/** 条件を満たした実績を解除する（保存データを書き換える）。戻り値は今回解除した key */
export function evaluateAchievements(ctx: AchievementContext, save: AchievementSave, now: number): string[] {
  const out: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (save.unlocked[def.key] !== undefined || !def.check(ctx)) continue;
    save.unlocked[def.key] = now;
    out.push(def.key);
  }
  return out;
}

export function isAchievementUnlocked(save: Readonly<AchievementSave>, key: string): boolean {
  return save.unlocked[key] !== undefined;
}

// -----------------------------------------------------------------------------
// 称号（実績の名前 + 依頼の報酬の称号）
// -----------------------------------------------------------------------------

/** 称号の id。実績は「a:key」、依頼の報酬は「q:key」 */
export type TitleId = `a:${string}` | `q:${QuestKey}`;

export interface TitleOption {
  id: TitleId;
  label: string;
  /** どこで得たか（一覧の右に出す） */
  from: string;
}

type ParsedTitle = { kind: "achievement"; key: string } | { kind: "quest"; key: QuestKey };

function parseTitleId(id: string): ParsedTitle | null {
  const [prefix, key] = [id.slice(0, 2), id.slice(2)];
  if (prefix === "a:" && ACHIEVEMENT_KEYS.has(key)) return { kind: "achievement", key };
  if (prefix === "q:" && isQuestKey(key)) return { kind: "quest", key };
  return null;
}

/** 今名乗れる称号の一覧（実績の順 → 依頼の順） */
export function availableTitles(ach: Readonly<AchievementSave>, quests: Readonly<QuestSave>): TitleOption[] {
  const out: TitleOption[] = [];
  for (const def of ACHIEVEMENTS) {
    if (isAchievementUnlocked(ach, def.key)) out.push({ id: `a:${def.key}`, label: def.name, from: "実績" });
  }
  for (const t of questTitles(quests)) out.push({ id: `q:${t.key}`, label: t.title, from: "依頼" });
  return out;
}

/** 名乗っている称号の表示名。解除が消えた（データが壊れた）などで名乗れなければ null */
export function currentTitleLabel(ach: Readonly<AchievementSave>, quests: Readonly<QuestSave>): string | null {
  if (ach.title === null) return null;
  return availableTitles(ach, quests).find((t) => t.id === ach.title)?.label ?? null;
}

/** 称号を名乗る（null で外す）。名乗れない id は無視して false */
export function selectTitle(ach: AchievementSave, quests: Readonly<QuestSave>, id: string | null): boolean {
  if (id === null) {
    ach.title = null;
    return true;
  }
  if (!availableTitles(ach, quests).some((t) => t.id === id)) return false;
  ach.title = id;
  return true;
}
