import type { HurtKind } from "../core/hurt";
import { isDailySeedText } from "../core/replay";
import type { GameState } from "../core/state";
import { STATUS_LABEL } from "../core/status";
import { TERRAIN_LABEL } from "../core/terrain";
import { ENEMIES, type EnemyDef } from "../data/enemies";
import type { HistoryKiller, ProfileMeta, RunHistoryEntry } from "../loot/types";
import { nextPeakOf } from "../system/chapters";
import { grudgeOf, killerOf } from "../system/deathCause";
import { ELITE_PREFIX, NEMESIS_PREFIX } from "../system/elites";
import { LINGER_LABEL } from "../system/linger";
import { RUN_EVENTS } from "../system/runEvents";
import { runTier } from "../system/runSetup";
import type { CodexSave } from "./codex";
import { nextTierRewardLine } from "./tierRewards";

/**
 * 死亡画面の「死因 / 次の山 / 前回比」と、履歴に残す任意項目（docs/ideas/meta-impl.md 2-2）。
 * 表示だけでゲーム進行には効かない
 */

/** RunHistoryEntry.cause の値（ui/title.ts の runCause と同じ） */
const CAUSE_DEFEATED = "defeated";
const CAUSE_CLEARED = "cleared";
const CAUSE_ABANDONED = "abandoned";
/** 見習い（既定のジョブ）は履歴に書かない */
const DEFAULT_JOB = "none";
/** 死亡画面の行の上限（titleUi.ts の場所が 3 行ぶん） */
export const DEATH_REPORT_MAX_LINES = 3;

const DEF_BY_KEY: ReadonlyMap<string, EnemyDef> = new Map(ENEMIES.map((d) => [d.key, d]));

/** 敵から受けたときの種類の語（「{敵名}の{語}」） */
const HURT_KIND_WORD: Readonly<Partial<Record<HurtKind, string>>> = {
  strike: "一撃",
  shot: "射撃",
  blast: "爆発",
  hazard: "余波",
};

/** 出どころの分からない被弾の名（撃ち手の消えた敵弾 = 流れ弾） */
const UNKNOWN_SOURCE_LABEL: Readonly<Partial<Record<HurtKind, string>>> = {
  strike: "一撃",
  shot: "流れ弾",
  blast: "爆発",
  hazard: "余波",
  fall: "落下物",
  status: "状態異常",
  terrain: "地形",
  event: "ランイベント",
};

/** 敵でない出どころの固定の名 */
const FIXED_KIND_LABEL: Readonly<Partial<Record<HurtKind, string>>> = {
  fall: "落下物",
  reaper: "死神",
  linger: "長居の代償",
  deferred: "遅れて来る傷",
};

/** 状態異常の反応の即時ダメージ（statusEffects.ts の hurtTarget）の key */
const REACTION_KEY = "reaction";
const REACTION_LABEL = "反応";
/** 潮（長居の代償）で沈むのは水の上だけなので、水は潮と呼ぶ */
const TIDE_TERRAIN_KEY = "water";

function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function enemyName(def: EnemyDef): string {
  return def.bossTitle ?? def.name;
}

/** 敵でない出どころの名（状態異常名・地形名・ランイベント名…） */
function sourceLabel(kind: HurtKind, key: string): string {
  const fixed = FIXED_KIND_LABEL[kind];
  if (fixed !== undefined) return fixed;
  if (kind === "status") return key === REACTION_KEY ? REACTION_LABEL : (lookup(STATUS_LABEL, key) ?? UNKNOWN_SOURCE_LABEL.status ?? "");
  if (kind === "terrain") return key === TIDE_TERRAIN_KEY ? LINGER_LABEL.tide : lookup(TERRAIN_LABEL, key) || (UNKNOWN_SOURCE_LABEL.terrain ?? "");
  if (kind === "event") return lookup(RUN_EVENTS, key)?.name ?? UNKNOWN_SOURCE_LABEL.event ?? "";
  return UNKNOWN_SOURCE_LABEL[kind] ?? "";
}

/** 死因の短い名（履歴画面。接頭辞なし）: 敵なら「{敵名}の{種類}」、それ以外は出どころの名 */
export function hurtLabel(killer: Readonly<HistoryKiller>): string {
  const def = DEF_BY_KEY.get(killer.key);
  const word = HURT_KIND_WORD[killer.kind];
  if (def && word !== undefined) return `${enemyName(def)}の${word}`;
  return sourceLabel(killer.kind, killer.key);
}

/** 死因の行: 敵なら仇・精鋭の接頭辞と倒された回数を添える */
function killerLine(killer: Readonly<HistoryKiller>, codex: Readonly<CodexSave>): string {
  const def = DEF_BY_KEY.get(killer.key);
  const word = HURT_KIND_WORD[killer.kind];
  if (!def || word === undefined) return `死因: ${sourceLabel(killer.kind, killer.key)}`;
  const prefix = `${killer.nemesis ? NEMESIS_PREFIX : ""}${(killer.elites ?? []).map((k) => lookup(ELITE_PREFIX, k) ?? "").join("")}`;
  const deaths = codex.enemyDeaths[killer.key] ?? 0;
  return `死因: ${prefix}${enemyName(def)}の${word}（倒された回数 ${deaths}）`;
}

function nextPeakLine(depth: number): string | null {
  const peak = nextPeakOf(depth);
  if (!peak) return null;
  const def = DEF_BY_KEY.get(peak.key);
  return def ? `次の山: 地下 ${peak.depth} 階 ${enemyName(def)}` : null;
}

/** 符号つきの差（0 は ±0） */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "±0";
}

function compareLine(entry: Readonly<RunHistoryEntry>, previous: Readonly<RunHistoryEntry> | null): string | null {
  if (!previous) return null;
  const depth = entry.depth - previous.depth;
  const hurts = (entry.hurts ?? 0) - (previous.hurts ?? 0);
  const just = (entry.justDodges ?? 0) - (previous.justDodges ?? 0);
  return `前回比: 到達 ${signed(depth)} 階 / 被弾 ${signed(hurts)} / 見切り ${signed(just)}`;
}

/**
 * 死亡画面の行（最大 3 行）。力尽きた: 死因 / 次の山 / 前回比、踏破: 踏破の位階と回数 / 次の見返り / 前回比、離脱: なし。
 * codex は倒された回数を数えた後（recordDefeat の後）、meta は踏破を数えた後（recordClear の後）を渡す
 */
export function deathReportLines(
  entry: Readonly<RunHistoryEntry>,
  previous: Readonly<RunHistoryEntry> | null,
  codex: Readonly<CodexSave>,
  meta: Readonly<ProfileMeta>,
): string[] {
  const lines: (string | null)[] = [];
  if (entry.cause === CAUSE_DEFEATED) {
    lines.push(entry.killer ? killerLine(entry.killer, codex) : null, nextPeakLine(entry.depth));
  } else if (entry.cause === CAUSE_CLEARED) {
    lines.push(`踏破: 位階 ${entry.tier ?? 0}（${meta.clears ?? 1} 回目）`, nextTierRewardLine(meta));
  } else {
    return [];
  }
  lines.push(compareLine(entry, previous));
  return lines.filter((l): l is string => l !== null).slice(0, DEATH_REPORT_MAX_LINES);
}

/**
 * 前回比の相手: current より後ろ（古い）の履歴で、離脱でなく、被弾の回数を持つ（段取り 9 以降の）最初の 1 件。
 * デイリーと通常は混ぜない。無ければ null
 */
export function previousComparable(history: readonly RunHistoryEntry[], current: Readonly<RunHistoryEntry>): RunHistoryEntry | null {
  const start = history.indexOf(current as RunHistoryEntry);
  const daily = isDailySeedText(current.seedText);
  for (const h of history.slice(start + 1)) {
    if (h.cause === CAUSE_ABANDONED || h.hurts === undefined) continue;
    if (isDailySeedText(h.seedText) !== daily) continue;
    return h;
  }
  return null;
}

/**
 * 履歴に足す任意項目（main.ts の endRun が buildHistoryEntry に重ねる）。0・空は書かない。
 * hurts だけは 0 でも書く（前回比の相手になれる「段取り 9 以降の行」の印）
 */
export function historyExtras(state: GameState): Partial<RunHistoryEntry> {
  const out: Partial<RunHistoryEntry> = {};
  const killer = killerOf(state);
  if (killer) {
    out.killer = { kind: killer.kind, key: killer.key };
    if (killer.elites.length > 0) out.killer.elites = [...killer.elites];
    if (killer.nemesis) out.killer.nemesis = true;
  }
  const grudge = grudgeOf(state);
  if (grudge) out.grudge = grudge;
  if (state.nemesis?.avenged === true) out.avenged = true;
  const tier = runTier(state.modifiers);
  if (tier > 0) out.tier = tier;
  if (state.job !== DEFAULT_JOB) out.job = state.job;
  const c = state.questRun.counters;
  out.hurts = c.hurts;
  if (c.justDodges > 0) out.justDodges = c.justDodges;
  if (c.counters > 0) out.counters = c.counters;
  if (c.floorsNoHurt > 0) out.noHurtFloors = c.floorsNoHurt;
  return out;
}
