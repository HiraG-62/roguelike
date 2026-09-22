/**
 * タイトル・ポーズ・履歴・死亡サマリー画面のロジック（DOM に依存しない部分）。
 * 描画は src/render/titleUi.ts、キー入力の DOM 捕捉（MenuKeyCapture）はここで行うが、
 * 解釈（processMenuKeys）は純粋関数として切り出しテストできるようにする。
 */
import type { Item, Profile, Rarity, RunHistoryEntry } from "../loot/types";
import { RARITIES } from "../loot/types";
import { isDailySeedText } from "../core/replay";

// ---------------------------------------------------------------------------
// シード入力
// ---------------------------------------------------------------------------

export const SEED_TEXT_MAX_LENGTH = 16;
const ALNUM_RE = /^[a-zA-Z0-9]$/;

export interface SeedInputState {
  /** N で入る、テキスト入力モード中か */
  active: boolean;
  /** 表示中/編集中のシード文字列 */
  text: string;
}

export function createSeedInputState(initialText: string): SeedInputState {
  return { active: false, text: initialText };
}

export function startSeedInput(state: SeedInputState): void {
  state.active = true;
}

/** 1 文字追加する。英数字以外・上限超えは無視する */
export function appendSeedChar(state: SeedInputState, ch: string): void {
  if (!state.active) return;
  if (ch.length !== 1 || !ALNUM_RE.test(ch)) return;
  if (state.text.length >= SEED_TEXT_MAX_LENGTH) return;
  state.text += ch;
}

/** 末尾 1 文字を消す */
export function backspaceSeedChar(state: SeedInputState): void {
  if (!state.active) return;
  state.text = state.text.slice(0, -1);
}

/** 入力を確定する。空文字なら fallback を使う。戻り値は確定後の文字列 */
export function commitSeedInput(state: SeedInputState, fallback: string): string {
  state.active = false;
  if (state.text.length === 0) state.text = fallback;
  return state.text;
}

/** Esc でキャンセルし、確定前の文字列に戻す */
export function cancelSeedInput(state: SeedInputState, previousText: string): void {
  state.active = false;
  state.text = previousText;
}

// ---------------------------------------------------------------------------
// メニューキー（N/H/O/M/T/Escape と、シード入力中の文字）の DOM 捕捉と解釈
// ---------------------------------------------------------------------------

/** DOM の KeyboardEvent から必要な情報だけ取り出したもの */
export interface RawKeyEvent {
  code: string;
  key: string;
}

/** input.ts の PlayerInput が扱わないキーを別系統で拾う。preventDefault は Backspace のみ */
export class MenuKeyCapture {
  private queue: RawKeyEvent[] = [];

  attach(target: Window): void {
    target.addEventListener("keydown", (ev) => {
      if (ev.repeat) return;
      if (ev.code === "Backspace") ev.preventDefault();
      this.queue.push({ code: ev.code, key: ev.key });
    });
  }

  drain(): RawKeyEvent[] {
    if (this.queue.length === 0) return this.queue;
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

export interface MenuHotkeys {
  escape: boolean;
  n: boolean;
  h: boolean;
  o: boolean;
  m: boolean;
  t: boolean;
  /** デイリーシードで開始 */
  d: boolean;
  /** 履歴画面: リプレイ再生 */
  p: boolean;
  /** 履歴画面: そのシードで新規開始 */
  s: boolean;
  /** 矢印キー（-1 / 0 / 1）。WASD は移動と衝突するので履歴・リプレイ操作は矢印キーだけで行う */
  arrowX: number;
  arrowY: number;
}

function emptyHotkeys(): MenuHotkeys {
  return { escape: false, n: false, h: false, o: false, m: false, t: false, d: false, p: false, s: false, arrowX: 0, arrowY: 0 };
}

/**
 * 生のキーイベント列を解釈する。
 * シード入力中は文字を seedInput に流し込み、それ以外はメニューのホットキーとして拾う。
 * Escape はどちらのモードでも拾い、呼び出し側が画面の文脈で扱いを決める。
 * Enter は input.ts の FrameInput.confirmPressed 側で拾うのでここでは扱わない。
 */
export function processMenuKeys(events: readonly RawKeyEvent[], seedInput: SeedInputState): MenuHotkeys {
  const hotkeys = emptyHotkeys();
  for (const ev of events) {
    if (seedInput.active) {
      if (ev.code === "Backspace") {
        backspaceSeedChar(seedInput);
      } else if (ev.code === "Escape") {
        hotkeys.escape = true;
      } else if (ev.key.length === 1 && ALNUM_RE.test(ev.key)) {
        appendSeedChar(seedInput, ev.key);
      }
      continue;
    }
    switch (ev.code) {
      case "Escape":
        hotkeys.escape = true;
        break;
      case "KeyN":
        hotkeys.n = true;
        break;
      case "KeyH":
        hotkeys.h = true;
        break;
      case "KeyO":
        hotkeys.o = true;
        break;
      case "KeyM":
        hotkeys.m = true;
        break;
      case "KeyT":
        hotkeys.t = true;
        break;
      case "KeyD":
        hotkeys.d = true;
        break;
      case "KeyP":
        hotkeys.p = true;
        break;
      case "KeyS":
        hotkeys.s = true;
        break;
      case "ArrowUp":
        hotkeys.arrowY = -1;
        break;
      case "ArrowDown":
        hotkeys.arrowY = 1;
        break;
      case "ArrowLeft":
        hotkeys.arrowX = -1;
        break;
      case "ArrowRight":
        hotkeys.arrowX = 1;
        break;
      default:
        break;
    }
  }
  return hotkeys;
}

// ---------------------------------------------------------------------------
// メニューのカーソル移動（ポーズ / 設定 共通）
// ---------------------------------------------------------------------------

export const PAUSE_MENU_ITEMS = ["resume", "settings", "restart", "title"] as const;
export type PauseMenuItem = (typeof PAUSE_MENU_ITEMS)[number];

export const SETTINGS_ITEMS = ["mute", "volume", "screenShake"] as const;
export type SettingsItem = (typeof SETTINGS_ITEMS)[number];

/** move 系の値が 0 → 非0 に変わった瞬間だけ、その符号を返す（連射防止のエッジ検出） */
export function edgeDir(prev: number, curr: number): number {
  if (curr !== 0 && prev === 0) return Math.sign(curr);
  return 0;
}

export function cycleIndex(index: number, delta: number, length: number): number {
  return (((index + delta) % length) + length) % length;
}

// ---------------------------------------------------------------------------
// タイトルの統計
// ---------------------------------------------------------------------------

export interface TitleStats {
  runs: number;
  bestDepth: number;
  bestScore: number;
  totalKills: number;
  stashCount: number;
}

export function computeTitleStats(profile: Profile): TitleStats {
  return {
    runs: profile.meta.runs,
    bestDepth: profile.meta.bestDepth,
    bestScore: profile.meta.bestScore,
    totalKills: profile.meta.totalKills,
    stashCount: profile.stash.length,
  };
}

// ---------------------------------------------------------------------------
// ラン履歴エントリの組み立て
// ---------------------------------------------------------------------------

/** 履歴エントリ組み立てに必要な GameState の一部だけを受け取る（テストしやすくするため） */
export interface RunSummarySource {
  seedText: string;
  depth: number;
  kills: number;
  score: number;
  combo: { best: number };
  time: number;
  status: "playing" | "dead";
}

export function buildHistoryEntry(source: RunSummarySource, now: number): RunHistoryEntry {
  return {
    date: now,
    seedText: source.seedText,
    depth: source.depth,
    kills: source.kills,
    score: source.score,
    bestCombo: source.combo.best,
    durationSec: source.time,
    cause: source.status === "dead" ? "defeated" : "abandoned",
  };
}

// ---------------------------------------------------------------------------
// 死亡画面: このランで拾ったアイテムの集計
// ---------------------------------------------------------------------------

export interface RunItemSummary {
  total: number;
  byRarity: Record<Rarity, number>;
}

function emptyRarityCounts(): Record<Rarity, number> {
  const out = {} as Record<Rarity, number>;
  for (const r of RARITIES) out[r] = 0;
  return out;
}

/** items（stash + 装備）のうち foundAt が runStartedAt 以降のものだけを数える */
export function summarizeRunItems(items: readonly Item[], runStartedAt: number): RunItemSummary {
  const byRarity = emptyRarityCounts();
  let total = 0;
  for (const item of items) {
    if (item.foundAt < runStartedAt) continue;
    byRarity[item.rarity] += 1;
    total += 1;
  }
  return { total, byRarity };
}

// ---------------------------------------------------------------------------
// 履歴画面: デイリーの印とベスト、カーソル
// ---------------------------------------------------------------------------

/** seedText が日付（YYYY-MM-DD）ならデイリーのラン */
export function isDailyEntry(entry: Pick<RunHistoryEntry, "seedText">): boolean {
  return isDailySeedText(entry.seedText);
}

/** デイリーの日付ごとに score 最大（同点なら depth、さらに同点なら新しい方）の履歴インデックス */
export function dailyBestIndices(history: readonly RunHistoryEntry[]): Set<number> {
  const bestBySeed = new Map<string, number>();
  history.forEach((entry, i) => {
    if (!isDailyEntry(entry)) return;
    const prevIndex = bestBySeed.get(entry.seedText);
    const prev = prevIndex === undefined ? undefined : history[prevIndex];
    if (!prev || entry.score > prev.score || (entry.score === prev.score && entry.depth > prev.depth)) {
      bestBySeed.set(entry.seedText, i);
    }
  });
  return new Set(bestBySeed.values());
}

/** 履歴カーソルを上下に動かす（端で止める）。一覧が空なら 0 */
export function moveHistoryCursor(cursor: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(length - 1, cursor + delta));
}

// ---------------------------------------------------------------------------
// リプレイ再生速度
// ---------------------------------------------------------------------------

export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** ←→ で速度を 1 段変える（端で止める） */
export function shiftReplaySpeed(speed: ReplaySpeed, delta: number): ReplaySpeed {
  const index = REPLAY_SPEEDS.indexOf(speed);
  const next = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, index + Math.sign(delta)));
  return REPLAY_SPEEDS[next] ?? speed;
}
