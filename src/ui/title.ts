/**
 * タイトル・ポーズ・履歴・死亡サマリー画面のロジック（DOM に依存しない部分）。
 * 描画は src/render/titleUi.ts、キー入力の DOM 捕捉（MenuKeyCapture）はここで行うが、
 * 解釈（processMenuKeys）は純粋関数として切り出しテストできるようにする。
 */
import type { Item, Profile, Rarity, RunHistoryEntry } from "../loot/types";
import { RARITIES } from "../loot/types";
import { isDailySeedText, isPlayable, type ReplayData } from "../core/replay";
import { KEYBIND_SLOTS, REBINDABLE_ACTIONS, type RebindableAction } from "../core/input";
import { VIEW_H, VIEW_W } from "../core/view";

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
  /** Delete / Backspace（キー設定画面で列を空にする） */
  clear: boolean;
  /** タイトル: 図鑑 / 依頼 / 実績（src/meta/） */
  c: boolean;
  q: boolean;
  a: boolean;
  /** 矢印キー（-1 / 0 / 1）。WASD は移動と衝突するので履歴・リプレイ操作は矢印キーだけで行う */
  arrowX: number;
  arrowY: number;
}

function emptyHotkeys(): MenuHotkeys {
  return {
    escape: false,
    n: false,
    h: false,
    o: false,
    m: false,
    t: false,
    d: false,
    p: false,
    s: false,
    clear: false,
    c: false,
    q: false,
    a: false,
    arrowX: 0,
    arrowY: 0,
  };
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
      case "KeyC":
        hotkeys.c = true;
        break;
      case "KeyQ":
        hotkeys.q = true;
        break;
      case "KeyA":
        hotkeys.a = true;
        break;
      case "Delete":
      case "Backspace":
        hotkeys.clear = true;
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

export const PAUSE_MENU_ITEMS = ["resume", "settings", "tips", "restart", "title"] as const;
export type PauseMenuItem = (typeof PAUSE_MENU_ITEMS)[number];

export const SETTINGS_ITEMS = ["mute", "volume", "musicVolume", "screenShake", "hitstopScale", "dropTooltip", "keybinds", "close"] as const;
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
// ポーズ / 設定メニューのレイアウト
// 描画（render/titleUi.ts）とマウスの当たり判定（main.ts）が同じ矩形を見るように、
// パネル・項目の位置計算をここへ集約する。行の高さ（itemGap / rowGap）は
// textLineHeight 由来なので、呼び出し側が同じ値を渡すことで両者が一致する。
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** count 個の行矩形。テキストの基準線が firstY + i*gap に来る前提で、その周囲 gap ぶんを当たり判定にする */
function rowRects(count: number, panelX: number, firstY: number, panelW: number, gap: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({
    x: panelX,
    y: firstY + i * gap - gap / 2,
    w: panelW,
    h: gap,
  }));
}

export const PAUSE_PANEL_W = 160;
/** 見出し + 5 項目（Tips ノートの行を足して 96 → 120。行間が 18 まで広がっても収まる） */
export const PAUSE_PANEL_H = 120;
/** パネル上端から最初の項目のテキスト基準線までの距離 */
const PAUSE_ITEM_TOP = 36;

export interface PauseMenuLayout {
  panel: Rect;
  /** PAUSE_MENU_ITEMS と同じ順の当たり判定矩形（パネル幅いっぱい） */
  items: readonly Rect[];
}

export function pauseMenuLayout(itemGap: number): PauseMenuLayout {
  const panelX = (VIEW_W - PAUSE_PANEL_W) / 2;
  const panelY = (VIEW_H - PAUSE_PANEL_H) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: PAUSE_PANEL_W, h: PAUSE_PANEL_H };
  const items = rowRects(PAUSE_MENU_ITEMS.length, panelX, panelY + PAUSE_ITEM_TOP, PAUSE_PANEL_W, itemGap);
  return { panel, items };
}

/** 座標に対応する項目 index。どの項目にも乗っていなければ null */
export function pauseMenuItemAt(x: number, y: number, itemGap: number): number | null {
  const found = pauseMenuLayout(itemGap).items.findIndex((r) => pointInRect(x, y, r));
  return found === -1 ? null : found;
}

export const SETTINGS_PANEL_W = 220;
/** 8 項目 + 見出し + 下の案内が収まる高さ（ヒットストップ・アイテム情報表示の行を足して 160 → 196） */
export const SETTINGS_PANEL_H = 196;
const SETTINGS_ROW_TOP = 40;

export interface SettingsLayout {
  panel: Rect;
  /** SETTINGS_ITEMS と同じ順の当たり判定矩形（パネル幅いっぱい） */
  rows: readonly Rect[];
}

export function settingsLayout(rowGap: number): SettingsLayout {
  const panelX = (VIEW_W - SETTINGS_PANEL_W) / 2;
  const panelY = (VIEW_H - SETTINGS_PANEL_H) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: SETTINGS_PANEL_W, h: SETTINGS_PANEL_H };
  const rows = rowRects(SETTINGS_ITEMS.length, panelX, panelY + SETTINGS_ROW_TOP, SETTINGS_PANEL_W, rowGap);
  return { panel, rows };
}

export function settingsItemAt(x: number, y: number, rowGap: number): number | null {
  const found = settingsLayout(rowGap).rows.findIndex((r) => pointInRect(x, y, r));
  return found === -1 ? null : found;
}

/** 行内クリック位置が左右どちらか（ゲージの外をクリックしたときの増減方向に使う）。パネルは常に画面中央なので VIEW_W/2 で判定できる */
export function settingsRowSide(x: number): -1 | 1 {
  return x < VIEW_W / 2 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// 設定画面のゲージ（音量・画面揺れ・ヒットストップ）。描画（render/titleUi.ts）と
// クリック/ドラッグの当たり判定（main.ts）が同じ矩形を見るよう、ここへ集約する
// ---------------------------------------------------------------------------

/** ゲージで値を表す項目（0..1 の Settings フィールドを持つもの） */
export const SETTINGS_GAUGE_ITEMS = ["volume", "musicVolume", "screenShake", "hitstopScale"] as const;
export type SettingsGaugeItem = (typeof SETTINGS_GAUGE_ITEMS)[number];

export function isSettingsGaugeItem(item: SettingsItem): item is SettingsGaugeItem {
  return (SETTINGS_GAUGE_ITEMS as readonly SettingsItem[]).includes(item);
}

/** パネル左端からゲージ左端までの距離 */
const GAUGE_X = 96;
const GAUGE_W = 76;
const GAUGE_H = 8;

/** ゲージの矩形。対象外の項目・見えていない行なら null */
export function settingsGaugeRect(item: SettingsItem, rowGap: number): Rect | null {
  if (!isSettingsGaugeItem(item)) return null;
  const { panel, rows } = settingsLayout(rowGap);
  const row = rows[SETTINGS_ITEMS.indexOf(item)];
  if (!row) return null;
  return { x: panel.x + GAUGE_X, y: row.y + row.h / 2 - GAUGE_H / 2, w: GAUGE_W, h: GAUGE_H };
}

/** ゲージ内の x 座標を 0..1 の値にする（外側は端にクランプ） */
export function settingsGaugeValueAt(x: number, gauge: Rect): number {
  return Math.max(0, Math.min(1, (x - gauge.x) / gauge.w));
}

// ---------------------------------------------------------------------------
// キー設定画面のレイアウト
// 行 = 変更可能なアクション + 「既定に戻す」「閉じる」。行が多いので、収まらない行間ではスクロールする。
// 描画（render/titleUi.ts）と当たり判定（main.ts）が同じ rowGap / scroll を渡して同じ矩形を読む
// ---------------------------------------------------------------------------

export const KEYBINDS_ROWS = [...REBINDABLE_ACTIONS, "reset", "close"] as const;
export type KeybindsRow = RebindableAction | "reset" | "close";

export function isActionRow(row: KeybindsRow): row is RebindableAction {
  return row !== "reset" && row !== "close";
}

// 「アイテム情報」を足して 18 行になったので、パネルを画面いっぱい（y0）にし上下の余白をさらに詰めて
// 最小の行間（13）で全行が 1 画面に収まるようにした
const KEYBINDS_PANEL: Rect = { x: 40, y: 0, w: 400, h: 270 };
/** パネル上端から見出し・列見出し・最初の行の中心までの距離 */
const KEYBINDS_TITLE_TOP = 8;
const KEYBINDS_HEADER_TOP = 20;
const KEYBINDS_FIRST_ROW_TOP = 30;
/** パネル下端から操作説明の中心・一覧の下端までの距離 */
const KEYBINDS_FOOTER_BOTTOM = 6;
const KEYBINDS_LIST_BOTTOM = 11;
/** アクション名の列の幅（この右から 主 / 副 / 予備 の列が並ぶ） */
const KEYBINDS_NAME_W = 120;
const KEYBINDS_SLOT_W = 88;
const KEYBINDS_SLOT_GAP = 2;

export interface KeybindsRowRect {
  /** KEYBINDS_ROWS の index */
  index: number;
  rect: Rect;
}

export interface KeybindsLayout {
  panel: Rect;
  titleY: number;
  /** 列見出し（主 / 副 / 予備）の中心 y */
  headerY: number;
  footerY: number;
  /** 表示中の行（スクロール位置から visibleCount 行） */
  rows: readonly KeybindsRowRect[];
  /** 各列の x 範囲（y / h は使わない） */
  slots: readonly Rect[];
  /** 一度に見える行数 */
  visibleCount: number;
  nameX: number;
}

export function keybindsVisibleCount(rowGap: number): number {
  const listTop = KEYBINDS_PANEL.y + KEYBINDS_FIRST_ROW_TOP - rowGap / 2;
  const listBottom = KEYBINDS_PANEL.y + KEYBINDS_PANEL.h - KEYBINDS_LIST_BOTTOM;
  return Math.max(1, Math.min(KEYBINDS_ROWS.length, Math.floor((listBottom - listTop) / rowGap)));
}

/** スクロール量の上限（全行が収まるなら 0） */
function maxKeybindsScroll(rowGap: number): number {
  return KEYBINDS_ROWS.length - keybindsVisibleCount(rowGap);
}

/** カーソル行が見えるようにスクロール量を合わせる（見えていれば据え置き） */
export function keybindsScrollFor(cursor: number, scroll: number, rowGap: number): number {
  const visible = keybindsVisibleCount(rowGap);
  let next = scroll;
  if (cursor < next) next = cursor;
  if (cursor >= next + visible) next = cursor - visible + 1;
  return Math.max(0, Math.min(maxKeybindsScroll(rowGap), next));
}

/** ホイールなど、カーソルと独立にスクロール量だけを動かす（範囲内に収める） */
export function clampKeybindsScroll(scroll: number, rowGap: number): number {
  return Math.max(0, Math.min(maxKeybindsScroll(rowGap), scroll));
}

export function keybindsLayout(rowGap: number, scroll = 0): KeybindsLayout {
  const panel = KEYBINDS_PANEL;
  const visibleCount = keybindsVisibleCount(rowGap);
  const start = Math.max(0, Math.min(maxKeybindsScroll(rowGap), scroll));
  const firstY = panel.y + KEYBINDS_FIRST_ROW_TOP;
  const rects = rowRects(visibleCount, panel.x, firstY, panel.w, rowGap);
  const rows = rects.map((rect, i) => ({ index: start + i, rect }));
  const slotsX = panel.x + KEYBINDS_NAME_W;
  const slots = Array.from({ length: KEYBIND_SLOTS }, (_, i) => ({
    x: slotsX + i * (KEYBINDS_SLOT_W + KEYBINDS_SLOT_GAP),
    y: panel.y,
    w: KEYBINDS_SLOT_W,
    h: panel.h,
  }));
  return {
    panel,
    titleY: panel.y + KEYBINDS_TITLE_TOP,
    headerY: panel.y + KEYBINDS_HEADER_TOP,
    footerY: panel.y + panel.h - KEYBINDS_FOOTER_BOTTOM,
    rows,
    slots,
    visibleCount,
    nameX: panel.x + 12,
  };
}

export interface KeybindsHit {
  /** KEYBINDS_ROWS の index */
  row: number;
  /** 主 / 副 / 予備 の列（アクション行の列の上だけ。それ以外は null） */
  slot: number | null;
}

/** 座標に対応する行と列。どの行にも乗っていなければ null */
export function keybindsItemAt(x: number, y: number, rowGap: number, scroll = 0): KeybindsHit | null {
  const layout = keybindsLayout(rowGap, scroll);
  const hit = layout.rows.find((r) => pointInRect(x, y, r.rect));
  if (!hit) return null;
  const row = KEYBINDS_ROWS[hit.index];
  if (row === undefined || !isActionRow(row)) return { row: hit.index, slot: null };
  const slot = layout.slots.findIndex((s) => x >= s.x && x < s.x + s.w);
  return { row: hit.index, slot: slot === -1 ? null : slot };
}

// ---------------------------------------------------------------------------
// タイトルのメニュー（図鑑・依頼・実績・Tips ノート）。ボタンの外をクリックしたら従来どおり拠点へ入る
// ---------------------------------------------------------------------------

export const TITLE_MENU_ITEMS = ["codex", "quests", "achievements", "tips"] as const;
export type TitleMenuItem = (typeof TITLE_MENU_ITEMS)[number];

const TITLE_MENU_Y = 146;
const TITLE_MENU_W = 72;
const TITLE_MENU_H = 16;
const TITLE_MENU_GAP = 8;

/** TITLE_MENU_ITEMS と同じ順のボタンの矩形（画面中央に横並び） */
export function titleMenuRects(): Rect[] {
  const n = TITLE_MENU_ITEMS.length;
  const total = n * TITLE_MENU_W + (n - 1) * TITLE_MENU_GAP;
  const x0 = (VIEW_W - total) / 2;
  return TITLE_MENU_ITEMS.map((_, i) => ({ x: x0 + i * (TITLE_MENU_W + TITLE_MENU_GAP), y: TITLE_MENU_Y, w: TITLE_MENU_W, h: TITLE_MENU_H }));
}

export function titleMenuItemAt(x: number, y: number): TitleMenuItem | null {
  const index = titleMenuRects().findIndex((r) => pointInRect(x, y, r));
  return TITLE_MENU_ITEMS[index] ?? null;
}

/** ホットキー（C / Q / A / T）で開くメニュー項目 */
export function titleMenuHotkey(hotkeys: Pick<MenuHotkeys, "c" | "q" | "a" | "t">): TitleMenuItem | null {
  if (hotkeys.c) return "codex";
  if (hotkeys.q) return "quests";
  if (hotkeys.a) return "achievements";
  if (hotkeys.t) return "tips";
  return null;
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

/** 履歴行に対応するリプレイの再生可否。"none" = 保存されていない、"old" = 保存はあるが再生不可（旧バージョン） */
export type ReplayAvailability = "none" | "playable" | "old";

export function replayAvailability(replay: ReplayData | null): ReplayAvailability {
  if (!replay) return "none";
  return isPlayable(replay) ? "playable" : "old";
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
