/**
 * タイトル・ポーズ・設定・履歴・死亡サマリーの描画。ロジックは src/ui/title.ts。
 * 文字は pixelText.ts のドット風描画（TEXT のサイズ段階）、配色は renderer.ts の作法（#e0e0 系）に合わせる。
 */
import { RENDER_SCALE, VIEW_H, VIEW_W } from "../core/view";
import { RARITIES, RARITY_LABEL, type RunHistoryEntry } from "../loot/types";
import type {
  PauseMenuItem,
  ReplayAvailability,
  RunItemSummary,
  SeedInputState,
  TitleMainItem,
  TitleMenuLevel,
  TitleMenuState,
  TitleRecord,
  TitleRecordItem,
  TitleStart,
  TitleStartView,
} from "../ui/title";
import {
  KEYBINDS_ROWS,
  PADBINDS_ROWS,
  HUB_MENU_ITEMS,
  PAUSE_MENU_ITEMS,
  SETTINGS_ITEMS,
  dailyBestIndices,
  bindsExtraRow,
  bindsRowCount,
  isDailyEntry,
  isSettingsGaugeItem,
  keybindsLayout,
  TITLE_CHAPTER_NAMES,
  TITLE_MAIN_ITEMS,
  TITLE_MENU_FIRST_Y,
  TITLE_MENU_PANEL,
  TITLE_MENU_TEXT_X,
  titleItemTextY,
  titleMenuGap,
  titleMenuItems,
  titleStartView,
  pauseMenuLayout,
  settingsGaugeRect,
  settingsLayout,
  type KeybindsLayout,
  type BindsMode,
  type KeybindsRow,
  type SettingsGaugeItem,
} from "../ui/title";
import { HITSTOP_SCALE_MAX, type Settings } from "../ui/settings";
import { actionKeyLabel, formatBindingCode, type Keybinds, type RebindableAction } from "../core/input";
import { PAD_ACTIONS, formatPadCode, type PadAction, type PadBinds } from "../core/padBinds";
import { TEXT, drawText, textLineHeight, textWidth, truncateText, wrapText } from "./pixelText";
import { drawTitleLogo } from "./titleLogo";
import { TITLE_DEFAULT_TINT, drawFlame, drawTitleScene } from "./titleScene";
import { Pen } from "./titlePaint";
import { APP_VERSION } from "../version";
import { hurtLabel } from "../meta/deathReport";

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_VERSION = "#808080";
/** 画面端からの余白（右下の操作一覧） */
const SCREEN_MARGIN = 8;
/** ポーズパネル下端からバージョン表示のベースラインまで */
const PAUSE_VERSION_GAP = 14;
const COLOR_CURSOR = "#ffffff";
const COLOR_OVERLAY = "rgba(0,0,0,0.65)";
const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
const COLOR_BORDER = "#505050";
const COLOR_DAILY = "#7fe0a0";
const COLOR_DAILY_BEST = "#ffd75f";
const COLOR_REPLAY = "#ff6a6a";
const COLOR_CURSOR_BG = "rgba(106,140,255,0.22)";

const LINE_H = 9;

const PAUSE_LABEL: Record<PauseMenuItem, string> = {
  resume: "再開",
  settings: "設定",
  restart: "やり直す",
  tips: "Tips ノート",
  manual: "武器指南書",
  hub: "拠点へ",
  title: "タイトルに戻る",
  quit: "ゲームを終了する",
};

/** ラン中のポーズと拠点のメニューの見出し */
const PAUSE_HEADING = "ポーズ中";
const HUB_MENU_HEADING = "メニュー";

const SETTINGS_LABEL: Record<(typeof SETTINGS_ITEMS)[number], string> = {
  mute: "ミュート",
  volume: "音量",
  musicVolume: "音楽の音量",
  screenShake: "画面揺れ",
  hitstopScale: "ヒットストップ",
  dropTooltip: "アイテム情報",
  keybinds: "キー設定",
  padBinds: "パッド設定",
  close: "閉じる",
};

/** キー設定画面のアクション名 */
const ACTION_LABEL: Record<RebindableAction, string> = {
  up: "上",
  down: "下",
  left: "左",
  right: "右",
  dash: "ダッシュ",
  attack: "攻撃 1（左）",
  shoot: "攻撃 2（右）",
  special: "奥義",
  parry: "受け流し",
  reload: "リロード",
  inventory: "装備画面",
  skill1: "スキル 1",
  skill2: "スキル 2",
  skill3: "スキル 3",
  skill4: "スキル 4",
  interact: "拾う",
  flask: "瓶",
  toggleDropInfo: "アイテム情報",
  restart: "やり直す（新シード）",
};

const KEYBINDS_EXTRA_LABEL: Record<Exclude<KeybindsRow, RebindableAction>, string> = {
  reset: "既定に戻す",
  close: "閉じる",
};

/** 列見出し（KEYBIND_SLOTS と同じ数） */
const KEYBIND_SLOT_LABEL: readonly string[] = ["主", "副", "予備"];
const KEYBIND_EMPTY = "-";
const KEYBIND_CAPTURE_TEXT = "キーを押してください…（Esc で取り消し）";
const PADBIND_CAPTURE_TEXT = "ボタンを押してください…（Start で取り消し）";
const COLOR_CAPTURE = "#ffd75f";
/** 列のセル内の左右余白 */
const KEYBIND_CELL_PAD = 3;
/** スクロール印（↑ / ↓）の右端からの距離 */
const KEYBIND_SCROLL_MARK_INSET = 6;

/** RunHistoryEntry.cause（英語のキーのまま持つ）の表示専用ラベル */
const CAUSE_LABEL: Readonly<Record<string, string>> = {
  cleared: "踏破",
  defeated: "力尽きた",
  abandoned: "離脱",
};

function fillBg(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// ---------------------------------------------------------------------------
// タイトル画面（案 A「門」）。絵は render/titleScene.ts と titleLogo.ts、ここは UI（メニュー・石碑・シード・案内）と
// 開始の演出（寄りと暗転）をまとめる。論理座標 480x270。動きは表示用の時間 time だけで、state.rng は使わない
// ---------------------------------------------------------------------------

/** 添えの英字（題字は絵で、窓のタイトルなどの文字列は main.ts の GAME_NAME） */
const TITLE_LATIN_NAME = "BOKUEN";
const TITLE_INK = "#14121a";
const TITLE_TX = "#e8e2d4";
const TITLE_SUB = "#9a948a";
const TITLE_DIM = "#5c5852";
const TITLE_GOLD = "#c8a050";
const TITLE_GOLD_LO = "#7a5a28";
const TITLE_SHU = "#c83a2a";
const TITLE_FOCUS = "#fff4d0";
const MENU_PANEL_BG = "#060508";
const MENU_PANEL_ALPHA = 0.7;
const MENU_SELECT_BG = "#2a1a14";
const MENU_SELECT_ALPHA = 0.55;
const MENU_TEXT_W = 96;
const MENU_FLAME_X = 12;
const MENU_FLAME_Y = 9;
const MENU_HEAD_Y = 13;
const MENU_HEAD_X = 2;
const MENU_ROW_PAD = 1;
const MENU_HOTKEY_INSET = 8;
const MENU_DESC_X = 22;
const MENU_DESC_Y = 202;
const MENU_DESC_W = 106;
const MENU_DESC_LINES = 2;
const MENU_DESC_LINE_H = 10;
/** 題字・添え・称号の位置 */
const LOGO_TOP = 12;
const SUB_GAP = 5;
const SUB_LETTER_GAP = 2;
const HONOR_Y = 63;
const HONOR_ALPHA = 0.85;
/** 石碑（前回と最深）の外枠と内側の文字の位置 */
const STONE = { x: 356, y: 132, w: 108, h: 82 };
const STONE_TEXT_X = 366;
const STONE_TEXT_W = 90;
const STONE_LINE_H = 12;
const STONE_FIRST_Y = 141;
const STONE_RULE_Y = 181;
const STONE_BEST_Y = 186;
const STONE_RUNS_Y = 197;
const FIRST_RUN_X = 460;
const FIRST_RUN_Y = 190;
/** 下の帯: シード（左）・操作の案内（中央）・版（右）の y と左右の余白 */
const FOOT_Y = 254;
const FOOT_MARGIN_X = 16;
const FOOT_VERSION_X = 466;
const SEED_TEXT_W = 90;
const SEED_GAP = 6;
const SEED_CURSOR_PERIOD = 2;
/** 開始の演出で寄る先（門の奥）と、メニューの文章 */
const ZOOM_FOCUS_X = 240;
const ZOOM_FOCUS_Y = 150;

/** 奥の灯の色（章 1〜4・最深の間の順。TITLE_CHAPTER_NAMES と同じ添字） */
const CHAPTER_TINTS: readonly string[] = ["#c8e878", "#ffb45a", "#ff7a2a", "#b27cff", "#f0ece0"];

const TITLE_ITEM_LABEL: Readonly<Record<TitleMainItem | TitleRecordItem, string>> = {
  hub: "拠点へ",
  daily: "デイリー",
  records: "記録",
  settings: "設定",
  quit: "ゲームを終了する",
  history: "探索履歴",
  codex: "図鑑",
  quests: "依頼",
  achievements: "実績",
  tips: "Tips ノート",
  manual: "武器指南書",
  back: "戻る",
};

/** 記録の下の各項目のホットキー表記（メニューキーは固定で、キー設定の対象ではない） */
const TITLE_ITEM_HOTKEY: Readonly<Partial<Record<TitleRecordItem, string>>> = {
  history: "H",
  codex: "C",
  quests: "Q",
  achievements: "A",
  tips: "T",
  manual: "M",
  back: "Esc",
};

const TITLE_MAIN_DESC: Readonly<Record<TitleMainItem, (dailySeed: string) => string>> = {
  hub: () => "装備を整えて、井戸から出立",
  daily: (seed) => `今日のシード ${seed}（誰でも同じ地図）`,
  records: () => "探索履歴・図鑑・依頼・実績・Tips ノート・武器指南書",
  settings: () => "音・画面揺れ・キー・パッド",
  quit: () => "ウィンドウを閉じて終わる",
};

const TITLE_FIRST_RUN_TEXT = "はじめての探索";
const TITLE_HINT_MAIN = "↑↓ 選ぶ　Enter 決定";
const TITLE_HINT_RECORDS = "↑↓ 選ぶ　Enter 決定　Esc 戻る";

/** タイトルの描画に要るもの（ロジックは ui/title.ts、main.ts が毎フレーム組む） */
export interface TitleView {
  menu: TitleMenuState;
  record: TitleRecord;
  /** 名乗っている称号（無ければ null） */
  title: string | null;
  /** 今日のシード（デイリーの説明に出す） */
  dailySeed: string;
  /** 開始の演出中なら、その経過 */
  start: TitleStart | null;
}

let zoomBuffer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

/** 寄りの演出用の裏画面（寄るときだけ作る。論理座標を RENDER_SCALE 倍で持つ） */
function zoomSurface(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (zoomBuffer) return zoomBuffer;
  const canvas = document.createElement("canvas");
  canvas.width = VIEW_W * RENDER_SCALE;
  canvas.height = VIEW_H * RENDER_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  zoomBuffer = { canvas, ctx };
  return zoomBuffer;
}

function chapterTint(record: TitleRecord): string {
  if (!record.last) return TITLE_DEFAULT_TINT;
  return CHAPTER_TINTS[record.last.chapter] ?? TITLE_DEFAULT_TINT;
}

function drawLetterSpaced(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, gap: number, color: string): void {
  const chars = [...text];
  const widths = chars.map((ch) => textWidth(ch, TEXT.SMALL));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  let x = cx - total / 2;
  chars.forEach((ch, i) => {
    drawText(ctx, ch, x, y, TEXT.SMALL, color, "left", "top");
    x += (widths[i] ?? 0) + gap;
  });
}

/** 題字と添えの英字（BOKUEN）と称号 */
function drawLogoBlock(ctx: CanvasRenderingContext2D, time: number, title: string | null): void {
  const box = drawTitleLogo(ctx, VIEW_W / 2, LOGO_TOP, time);
  drawLetterSpaced(ctx, TITLE_LATIN_NAME, VIEW_W / 2, box.y + box.h + SUB_GAP, SUB_LETTER_GAP, TITLE_GOLD);
  if (title === null) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * HONOR_ALPHA;
  drawText(ctx, `称号「${title}」`, VIEW_W / 2, HONOR_Y, TEXT.SMALL, TITLE_SUB, "center", "top");
  ctx.globalAlpha = prev;
}

/** 縦のメニュー（左の帯）。カーソルは小さな炎 */
function drawTitleMenu(ctx: CanvasRenderingContext2D, time: number, menu: TitleMenuState, dailySeed: string): void {
  const pen = new Pen(ctx);
  const baseAlpha = ctx.globalAlpha;
  const panel = TITLE_MENU_PANEL;
  ctx.globalAlpha = baseAlpha * MENU_PANEL_ALPHA;
  pen.rect(panel.x, panel.y, panel.w, panel.h, MENU_PANEL_BG);
  ctx.globalAlpha = baseAlpha;
  pen.rect(panel.x, panel.y, 1, panel.h, TITLE_GOLD_LO);
  const gap = titleMenuGap(menu.level);
  if (menu.level === "records") {
    drawText(ctx, TITLE_ITEM_LABEL.records, TITLE_MENU_TEXT_X - MENU_HEAD_X, TITLE_MENU_FIRST_Y - MENU_HEAD_Y, TEXT.SMALL, TITLE_GOLD, "left", "top");
  }
  titleMenuItems(menu.level).forEach((item, i) => {
    const selected = i === menu.index;
    const y = titleItemTextY(menu.level, i);
    if (selected) {
      ctx.globalAlpha = baseAlpha * MENU_SELECT_ALPHA;
      pen.rect(TITLE_MENU_TEXT_X - 6, y - MENU_ROW_PAD, MENU_TEXT_W, gap - 2, MENU_SELECT_BG);
      ctx.globalAlpha = baseAlpha;
      pen.rect(TITLE_MENU_TEXT_X - 6, y - MENU_ROW_PAD, 1, gap - 2, TITLE_SHU);
      drawFlame(pen, time, TITLE_MENU_TEXT_X - MENU_FLAME_X, y + MENU_FLAME_Y, 0);
    }
    drawText(ctx, TITLE_ITEM_LABEL[item], TITLE_MENU_TEXT_X, y, TEXT.SMALL, selected ? TITLE_FOCUS : TITLE_SUB, "left", "top");
    const hotkey = menu.level === "records" ? TITLE_ITEM_HOTKEY[item as TitleRecordItem] : undefined;
    if (hotkey) drawText(ctx, hotkey, TITLE_MENU_TEXT_X + MENU_TEXT_W - MENU_HOTKEY_INSET, y, TEXT.SMALL, TITLE_DIM, "right", "top");
  });
  if (menu.level === "records") return;
  const current = TITLE_MAIN_ITEMS[menu.index];
  if (!current) return;
  const lineH = Math.max(MENU_DESC_LINE_H, textLineHeight(TEXT.SMALL));
  wrapText(TITLE_MAIN_DESC[current](dailySeed), MENU_DESC_W, TEXT.SMALL)
    .slice(0, MENU_DESC_LINES)
    .forEach((line, i) => drawText(ctx, line, MENU_DESC_X, MENU_DESC_Y + i * lineH, TEXT.SMALL, TITLE_DIM, "left", "top"));
}

/** 石碑: 前回（階・章・終わり方）と最深・探索の回数。記録が無ければ「はじめての探索」 */
function drawTitleStone(ctx: CanvasRenderingContext2D, record: TitleRecord, lit: boolean): void {
  if (!record.last && record.runs === 0) {
    drawText(ctx, TITLE_FIRST_RUN_TEXT, FIRST_RUN_X, FIRST_RUN_Y, TEXT.SMALL, TITLE_SUB, "right", "top");
    return;
  }
  const pen = new Pen(ctx);
  pen.rect(STONE.x, STONE.y, STONE.w, STONE.h, TITLE_INK);
  pen.rect(STONE.x + 1, STONE.y + 1, STONE.w - 2, STONE.h - 2, "#1c1a22");
  pen.rect(STONE.x + 1, STONE.y + 1, STONE.w - 2, 1, "#3a3644");
  pen.rect(STONE.x + 3, STONE.y + 3, STONE.w - 6, STONE.h - 6, lit ? TITLE_GOLD : TITLE_GOLD_LO);
  pen.rect(STONE.x + 4, STONE.y + 4, STONE.w - 8, STONE.h - 8, "#16141c");
  const line = (text: string, y: number, color: string): void => {
    drawText(ctx, truncateText(text, STONE_TEXT_W, TEXT.SMALL), STONE_TEXT_X, y, TEXT.SMALL, color, "left", "top");
  };
  const rowH = Math.max(STONE_LINE_H, textLineHeight(TEXT.SMALL));
  if (record.last) {
    const { depth, chapter, outcome } = record.last;
    line("前回", STONE_FIRST_Y, TITLE_DIM);
    line(`地下 ${depth} 階　${TITLE_CHAPTER_NAMES[chapter] ?? ""}`, STONE_FIRST_Y + rowH, TITLE_TX);
    line(outcome, STONE_FIRST_Y + rowH * 2, TITLE_SUB);
    pen.rect(STONE_TEXT_X, STONE_RULE_Y, STONE_TEXT_W - 2, 1, "#2a2630");
  }
  line(`最深　地下 ${record.bestDepth} 階`, STONE_BEST_Y, TITLE_GOLD);
  line(`探索 ${record.runs} 回`, STONE_RUNS_Y, TITLE_DIM);
}

/** 下の帯: シード（編集中は入力欄）・操作の案内・版 */
function drawTitleFoot(ctx: CanvasRenderingContext2D, time: number, seedInput: SeedInputState, level: TitleMenuLevel): void {
  if (seedInput.active) {
    const cursor = Math.floor(time * SEED_CURSOR_PERIOD) % 2 ? "_" : " ";
    const w = drawTextWidth(ctx, `シード ${seedInput.text}${cursor}`, FOOT_MARGIN_X, TITLE_FOCUS);
    drawText(ctx, "Enter 確定　Esc 取消", FOOT_MARGIN_X + w + SEED_GAP, FOOT_Y, TEXT.SMALL, TITLE_DIM, "left", "top");
  } else {
    const w = drawTextWidth(ctx, `シード ${truncateText(seedInput.text, SEED_TEXT_W, TEXT.SMALL)}`, FOOT_MARGIN_X, TITLE_SUB);
    drawText(ctx, "N 編集", FOOT_MARGIN_X + w + SEED_GAP, FOOT_Y, TEXT.SMALL, TITLE_DIM, "left", "top");
    drawText(ctx, level === "records" ? TITLE_HINT_RECORDS : TITLE_HINT_MAIN, VIEW_W / 2, FOOT_Y, TEXT.SMALL, TITLE_DIM, "center", "top");
  }
  drawText(ctx, APP_VERSION, FOOT_VERSION_X, FOOT_Y, TEXT.SMALL, TITLE_DIM, "right", "top");
}

/** 左寄せで描いて幅を返す */
function drawTextWidth(ctx: CanvasRenderingContext2D, text: string, x: number, color: string): number {
  drawText(ctx, text, x, FOOT_Y, TEXT.SMALL, color, "left", "top");
  return textWidth(text, TEXT.SMALL);
}

function paintTitle(ctx: CanvasRenderingContext2D, time: number, seedInput: SeedInputState, view: TitleView, sv: TitleStartView): void {
  drawTitleScene(ctx, { time, tint: chapterTint(view.record), walk: sv.walk, stepping: sv.stepping, boost: sv.boost });
  if (sv.uiAlpha <= 0) return;
  ctx.globalAlpha = sv.uiAlpha;
  drawLogoBlock(ctx, time, view.title);
  drawTitleMenu(ctx, time, view.menu, view.dailySeed);
  const recordsFocus = view.menu.level === "records" || TITLE_MAIN_ITEMS[view.menu.index] === "records";
  drawTitleStone(ctx, view.record, recordsFocus);
  drawTitleFoot(ctx, time, seedInput, view.menu.level);
  ctx.globalAlpha = 1;
}

/** 開始の演出: 画面全体を門の奥へ寄せる（裏画面に描いてから切り出して拡大） */
function drawZoomed(ctx: CanvasRenderingContext2D, time: number, seedInput: SeedInputState, view: TitleView, sv: TitleStartView): void {
  const buf = zoomSurface();
  buf.ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  buf.ctx.imageSmoothingEnabled = false;
  buf.ctx.globalAlpha = 1;
  paintTitle(buf.ctx, time, seedInput, view, sv);
  const sw = (VIEW_W * RENDER_SCALE) / sv.zoom;
  const sh = (VIEW_H * RENDER_SCALE) / sv.zoom;
  const sx = Math.max(0, Math.min(VIEW_W * RENDER_SCALE - sw, ZOOM_FOCUS_X * RENDER_SCALE - sw / 2));
  const sy = Math.max(0, Math.min(VIEW_H * RENDER_SCALE - sh, ZOOM_FOCUS_Y * RENDER_SCALE - sh / 2));
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(buf.canvas, sx, sy, sw, sh, 0, 0, VIEW_W, VIEW_H);
}

export function drawTitle(ctx: CanvasRenderingContext2D, time: number, seedInput: SeedInputState, view: TitleView): void {
  const sv = titleStartView(view.start);
  if (sv.zoom > 1) drawZoomed(ctx, time, seedInput, view, sv);
  else paintTitle(ctx, time, seedInput, view, sv);
  if (sv.fade <= 0) return;
  ctx.fillStyle = `rgba(0,0,0,${sv.fade.toFixed(3)})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

const HISTORY_TOP_Y = 36;
const HISTORY_LEFT_X = 10;
/** 選択行ハイライトがベースラインより下に出る量 */
const HISTORY_ROW_DESCENT = 2;
const MINUTE_PAD = 2;

export interface HistoryScreenView {
  history: readonly RunHistoryEntry[];
  cursor: number;
  /** i 番目の履歴に対応するリプレイの再生可否 */
  replayStatus: (index: number) => ReplayAvailability;
  /** 直前の操作の結果（「リプレイが無い」「旧バージョンで再生不可」等）。空なら出さない */
  message: string;
}

function historyDateLabel(date: number): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(MINUTE_PAD, "0")}:${String(d.getMinutes()).padStart(MINUTE_PAD, "0")}`;
}

export function drawHistoryScreen(ctx: CanvasRenderingContext2D, view: HistoryScreenView): void {
  const { history, cursor } = view;
  fillBg(ctx);
  drawText(ctx, "探索履歴", VIEW_W / 2, 18, TEXT.TITLE, COLOR_TITLE, "center");

  const m = TEXT.SMALL;
  if (history.length === 0) {
    drawText(ctx, "まだ記録がありません", VIEW_W / 2, VIEW_H / 2, m, COLOR_DIM, "center");
  } else {
    const dailyBest = dailyBestIndices(history);
    const lineH = Math.max(LINE_H, textLineHeight(m));
    let y = HISTORY_TOP_Y;
    history.forEach((entry, i) => {
      if (i === cursor) {
        ctx.fillStyle = COLOR_CURSOR_BG;
        ctx.fillRect(HISTORY_LEFT_X - 4, y - (lineH - HISTORY_ROW_DESCENT), VIEW_W - (HISTORY_LEFT_X - 4) * 2, lineH);
      }
      const daily = isDailyEntry(entry);
      const best = dailyBest.has(i);
      const status = view.replayStatus(i);
      // 行頭の印: R = リプレイあり、旧 = 保存はあるが再生不可（旧バージョン）、D = デイリー（* = その日のベスト）
      const replayMark = status === "playable" ? "R" : status === "old" ? "旧" : " ";
      const marks = `${replayMark}${daily ? (best ? "*" : "D") : " "}`;
      const causeLabel = entry.cause ? (CAUSE_LABEL[entry.cause] ?? entry.cause) : "";
      // 死因の短い名を添える（段取り 9 以降の行だけ。meta/deathReport.ts）
      const cause = entry.killer ? `${causeLabel}（${hurtLabel(entry.killer)}）` : causeLabel;
      const line = `${marks} ${historyDateLabel(entry.date)}  シード:${entry.seedText}  階:${entry.depth}  撃破:${entry.kills}  スコア:${entry.score}  コンボ:${entry.bestCombo}  ${Math.round(entry.durationSec)}秒  ${cause}`;
      let color = i === cursor ? COLOR_CURSOR : COLOR_TEXT;
      if (best) color = COLOR_DAILY_BEST;
      else if (daily) color = COLOR_DAILY;
      if (status === "old") color = COLOR_DIM;
      drawText(ctx, truncateText(line, VIEW_W - HISTORY_LEFT_X * 2, m), HISTORY_LEFT_X, y, m, color);
      y += lineH;
    });
  }

  if (view.message.length > 0) {
    drawText(ctx, view.message, VIEW_W / 2, VIEW_H - 18, m, COLOR_REPLAY, "center");
  }
  drawText(
    ctx,
    "↑↓: 選択   P: 再生   S: このシードで開始   Esc: 戻る   （R: リプレイ, 旧: 再生不可, D: デイリー, *: デイリー最高）",
    VIEW_W / 2,
    VIEW_H - 8,
    m,
    COLOR_DIM,
    "center",
  );
}

export interface ReplayHudInfo {
  speed: number;
  /** 0..1 */
  progress: number;
  finished: boolean;
  seedText: string;
}

const REPLAY_BAR_W = 120;
const REPLAY_BAR_H = 3;
const REPLAY_HUD_Y = 12;
const REPLAY_BLINK_PERIOD_SECONDS = 1.0;

/** 再生中の画面上部に「リプレイ」と速度・進捗を重ねる */
export function drawReplayHud(ctx: CanvasRenderingContext2D, info: ReplayHudInfo, time: number): void {
  const blinkOn = Math.sin((time / REPLAY_BLINK_PERIOD_SECONDS) * Math.PI * 2) > 0;
  const label = info.finished ? "リプレイ終了" : `${blinkOn ? "● " : "  "}リプレイ ${info.speed}x`;
  drawText(ctx, label, VIEW_W / 2, REPLAY_HUD_Y, TEXT.BODY, COLOR_REPLAY, "center");

  const barX = (VIEW_W - REPLAY_BAR_W) / 2;
  const barY = REPLAY_HUD_Y + 4;
  ctx.fillStyle = COLOR_BORDER;
  ctx.fillRect(barX, barY, REPLAY_BAR_W, REPLAY_BAR_H);
  ctx.fillStyle = COLOR_REPLAY;
  ctx.fillRect(barX, barY, REPLAY_BAR_W * Math.max(0, Math.min(1, info.progress)), REPLAY_BAR_H);

  drawText(ctx, `シード:${info.seedText}   ← →: 速度   Esc: 終了`, VIEW_W / 2, barY + REPLAY_BAR_H + 9, TEXT.SMALL, COLOR_DIM, "center");
}

/** questLine: 受けている依頼の進み（無ければ空文字。パネルの下に出す）。where: ラン中のポーズか拠点のメニューか */
export function drawPauseMenu(ctx: CanvasRenderingContext2D, cursor: number, questLine = "", where: "run" | "hub" = "run"): void {
  const menuItems: readonly PauseMenuItem[] = where === "hub" ? HUB_MENU_ITEMS : PAUSE_MENU_ITEMS;
  ctx.fillStyle = COLOR_OVERLAY;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const itemGap = Math.max(16, textLineHeight(TEXT.SMALL));
  const { panel, items } = pauseMenuLayout(itemGap, menuItems.length);
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  drawText(ctx, where === "hub" ? HUB_MENU_HEADING : PAUSE_HEADING, VIEW_W / 2, panel.y + 16, TEXT.BODY, COLOR_TITLE, "center");

  menuItems.forEach((item, i) => {
    const active = i === cursor;
    const label = PAUSE_LABEL[item];
    const row = items[i];
    if (!row) return;
    const textY = row.y + row.h / 2;
    drawText(ctx, active ? `> ${label} <` : label, VIEW_W / 2, textY, TEXT.SMALL, active ? COLOR_CURSOR : COLOR_DIM, "center");
  });
  drawVersion(ctx, VIEW_W / 2, panel.y + panel.h + PAUSE_VERSION_GAP, "center");
  if (questLine !== "") drawText(ctx, questLine, VIEW_W / 2, panel.y + panel.h + PAUSE_QUEST_GAP, TEXT.SMALL, COLOR_TITLE, "center");
}

/** ポーズパネル下端から依頼の進みのベースラインまで */
const PAUSE_QUEST_GAP = 28;

function drawVersion(ctx: CanvasRenderingContext2D, x: number, y: number, align: "center" | "right"): void {
  drawText(ctx, APP_VERSION, x, y, TEXT.SMALL, COLOR_VERSION, align);
}

/** ゲージ本体（枠 + 塗り）。矩形は ui/title.ts の settingsGaugeRect と同じものを渡す */
function drawGauge(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, value01: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  const fillW = Math.round((rect.w - 2) * Math.max(0, Math.min(1, value01)));
  if (fillW <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(rect.x + 1, rect.y + 1, fillW, rect.h - 2);
}

/** overlay: true なら現在の画面(ゲーム/タイトル)の上に半透明で重ねる */
export function drawSettingsScreen(ctx: CanvasRenderingContext2D, settings: Settings, cursor: number, overlay: boolean): void {
  if (overlay) {
    ctx.fillStyle = COLOR_OVERLAY;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else {
    fillBg(ctx);
  }

  const m = TEXT.SMALL;
  const rowGap = Math.max(18, textLineHeight(m));
  const { panel, rows } = settingsLayout(rowGap);
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  drawText(ctx, "設定", VIEW_W / 2, panel.y + 16, TEXT.BODY, COLOR_TITLE, "center");

  const toggleValue: Record<"mute" | "dropTooltip", string> = {
    mute: settings.muted ? "オン" : "オフ",
    dropTooltip: settings.dropTooltip ? "オン" : "オフ",
  };
  const gaugeValue: Record<SettingsGaugeItem, number> = {
    volume: settings.volume,
    musicVolume: settings.musicVolume,
    screenShake: settings.screenShake,
    hitstopScale: settings.hitstopScale,
  };
  SETTINGS_ITEMS.forEach((item, i) => {
    const active = i === cursor;
    const color = active ? COLOR_CURSOR : COLOR_DIM;
    const row = rows[i];
    if (!row) return;
    const textY = row.y + row.h / 2;
    if (item === "close") {
      const label = active ? `> ${SETTINGS_LABEL[item]} <` : SETTINGS_LABEL[item];
      drawText(ctx, label, VIEW_W / 2, textY, m, color, "center");
      return;
    }
    if (item === "keybinds" || item === "padBinds") {
      drawText(ctx, active ? `> ${SETTINGS_LABEL[item]}` : SETTINGS_LABEL[item], panel.x + 12, textY, m, color);
      return;
    }
    const label = active ? `> ${SETTINGS_LABEL[item]}` : SETTINGS_LABEL[item];
    drawText(ctx, label, panel.x + 12, textY, m, color);
    if (isSettingsGaugeItem(item)) {
      const raw = gaugeValue[item];
      // ヒットストップだけ値域が 0..HITSTOP_SCALE_MAX なので、ゲージの塗りは最大値で割った割合にする（数字は生の値の 100 倍のまま = 100 が標準）
      const fraction = item === "hitstopScale" ? raw / HITSTOP_SCALE_MAX : raw;
      const gauge = settingsGaugeRect(item, rowGap);
      if (gauge) drawGauge(ctx, gauge, fraction, color);
      drawText(ctx, String(Math.round(raw * 100)), panel.x + panel.w - 12, textY, m, color, "right");
      return;
    }
    drawText(ctx, toggleValue[item], panel.x + panel.w - 12, textY, m, color, "right");
  });

  const footer = truncateText("← →: 調整  ドラッグ: 直接指定  Enter: 決定  Esc: 戻る", panel.w - 8, m);
  drawText(ctx, footer, VIEW_W / 2, panel.y + panel.h - 8, m, COLOR_DIM, "center");
}

export interface KeybindsScreenView {
  /** 編集している表。"pad" なら padBinds を PADBINDS_ROWS の行で出す */
  mode: BindsMode;
  binds: Keybinds;
  padBinds: PadBinds;
  /** KEYBINDS_ROWS の index */
  cursor: number;
  /** 選択中の列（主 / 副 / 予備） */
  slot: number;
  scroll: number;
  /** 取得モード中（次の押下を待っている） */
  capturing: boolean;
}

function isPadAction(action: RebindableAction): action is PadAction {
  return (PAD_ACTIONS as readonly string[]).includes(action);
}

/** キー設定の行間。描画と main.ts の当たり判定が同じ値を使う */
export function keybindsRowGap(): number {
  return Math.max(KEYBINDS_MIN_ROW_GAP, textLineHeight(TEXT.SMALL));
}
const KEYBINDS_MIN_ROW_GAP = 11;

function drawKeybindCells(
  ctx: CanvasRenderingContext2D,
  layout: KeybindsLayout,
  codes: readonly string[],
  y: number,
  selectedSlot: number | null,
  format: (code: string) => string,
): void {
  const m = TEXT.SMALL;
  layout.slots.forEach((col, i) => {
    const code = codes[i];
    const selected = i === selectedSlot;
    const text = code === undefined ? KEYBIND_EMPTY : format(code);
    const color = selected ? COLOR_CURSOR : code === undefined ? COLOR_BORDER : COLOR_TEXT;
    const shown = truncateText(text, col.w - KEYBIND_CELL_PAD * 2, m);
    drawText(ctx, shown, col.x + col.w / 2, y, m, color, "center", "middle");
  });
}

function drawKeybindActionRow(
  ctx: CanvasRenderingContext2D,
  layout: KeybindsLayout,
  view: KeybindsScreenView,
  action: RebindableAction,
  rowRect: { y: number; h: number },
  active: boolean,
): void {
  const pad = view.mode === "pad" && isPadAction(action);
  const m = TEXT.SMALL;
  const y = rowRect.y + rowRect.h / 2;
  const nameColor = active ? COLOR_CURSOR : COLOR_DIM;
  drawText(ctx, active ? `> ${ACTION_LABEL[action]}` : ACTION_LABEL[action], layout.nameX, y, m, nameColor, "left", "middle");
  const first = layout.slots[0];
  const last = layout.slots[layout.slots.length - 1];
  if (active && view.capturing && first && last) {
    const areaW = last.x + last.w - first.x;
    const text = truncateText(pad ? PADBIND_CAPTURE_TEXT : KEYBIND_CAPTURE_TEXT, areaW, m);
    drawText(ctx, text, first.x + areaW / 2, y, m, COLOR_CAPTURE, "center", "middle");
    return;
  }
  const selectedCol = active ? layout.slots[view.slot] : undefined;
  if (selectedCol) {
    ctx.fillStyle = COLOR_CURSOR_BG;
    ctx.fillRect(selectedCol.x, rowRect.y, selectedCol.w, rowRect.h);
  }
  const codes = pad ? view.padBinds[action] : view.binds[action];
  drawKeybindCells(ctx, layout, codes, y, active ? view.slot : null, pad ? formatPadCode : formatBindingCode);
}

/** キー設定画面。overlay の意味は drawSettingsScreen と同じ */
export function drawKeybindsScreen(ctx: CanvasRenderingContext2D, view: KeybindsScreenView, overlay: boolean): void {
  if (overlay) {
    ctx.fillStyle = COLOR_OVERLAY;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else {
    fillBg(ctx);
  }
  const m = TEXT.SMALL;
  const layout = keybindsLayout(keybindsRowGap(), view.scroll, view.mode);
  const { panel } = layout;
  const pad = view.mode === "pad";
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  drawText(ctx, pad ? "パッド設定" : "キー設定", VIEW_W / 2, layout.titleY, TEXT.BODY, COLOR_TITLE, "center", "middle");
  layout.slots.forEach((col, i) => {
    drawText(ctx, KEYBIND_SLOT_LABEL[i] ?? "", col.x + col.w / 2, layout.headerY, m, COLOR_DIM, "center", "middle");
  });

  for (const { index, rect } of layout.rows) {
    const row = pad ? PADBINDS_ROWS[index] : KEYBINDS_ROWS[index];
    if (row === undefined) continue;
    const active = index === view.cursor;
    const extra = bindsExtraRow(view.mode, index);
    if (extra === null) {
      drawKeybindActionRow(ctx, layout, view, row as RebindableAction, rect, active);
      continue;
    }
    const label = KEYBINDS_EXTRA_LABEL[extra];
    const y = rect.y + rect.h / 2;
    drawText(ctx, active ? `> ${label} <` : label, VIEW_W / 2, y, m, active ? COLOR_CURSOR : COLOR_DIM, "center", "middle");
  }

  drawKeybindScrollMarks(ctx, layout, view.scroll, bindsRowCount(view.mode));

  const footer = keybindsFooter(pad, view.capturing);
  drawText(ctx, truncateText(footer, panel.w - 8, m), VIEW_W / 2, layout.footerY, m, COLOR_DIM, "center", "middle");
}

function keybindsFooter(pad: boolean, capturing: boolean): string {
  if (pad) {
    return capturing
      ? "ボタンを押して離す / 押さえたまま別のボタンで組み合わせ   Start: 取り消し"
      : "↑↓: 行  ←→: 列  A/Enter: 変更  Y/Delete: 空にする  B/Esc: 戻る";
  }
  return capturing ? "キーかマウスボタンを押す   Esc: 取り消し" : "↑↓: 行  ←→: 列  Enter/クリック: 変更  Delete: 空にする  Esc: 戻る";
}

/** 上下に隠れた行があることを示す */
function drawKeybindScrollMarks(ctx: CanvasRenderingContext2D, layout: KeybindsLayout, scroll: number, rowCount: number): void {
  const x = layout.panel.x + layout.panel.w - KEYBIND_SCROLL_MARK_INSET;
  const first = layout.rows[0];
  const last = layout.rows[layout.rows.length - 1];
  if (first && scroll > 0) {
    drawText(ctx, "↑", x, first.rect.y + first.rect.h / 2, TEXT.SMALL, COLOR_DIM, "right", "middle");
  }
  if (last && last.index < rowCount - 1) {
    drawText(ctx, "↓", x, last.rect.y + last.rect.h / 2, TEXT.SMALL, COLOR_DIM, "right", "middle");
  }
}

export interface DeathSummaryInfo {
  itemSummary: RunItemSummary;
  bestCombo: number;
  bossesDefeated: number;
  /** 依頼・図鑑・実績の結果（src/meta/。無ければ出さない） */
  metaLines?: readonly string[];
  /** 死因 / 次の山 / 前回比（meta/deathReport.ts の deathReportLines。最大 3 行。無ければ出さない） */
  reportLines?: readonly string[];
}

/** 死因の行の始まり（画面の中央から。スコアの行の下、拾った遺物の行の上に 3 行） */
const DEATH_REPORT_TOP = 28;
const COLOR_REPORT = "#ffd0a0";
const DEATH_META_TOP = 102;
const DEATH_META_LINE = 11;
const COLOR_META = "#80ff80";

/** renderer.drawDeath の上に重ね描きする追加情報 */
export function drawDeathSummary(ctx: CanvasRenderingContext2D, info: DeathSummaryInfo): void {
  const m = TEXT.SMALL;
  const rarityText = RARITIES.map((r) => `${RARITY_LABEL[r]} ${info.itemSummary.byRarity[r]}`).join(" / ");
  drawText(ctx, `拾った遺物: ${info.itemSummary.total}（${rarityText}）`, VIEW_W / 2, VIEW_H / 2 + 60, m, COLOR_TEXT, "center");
  drawText(ctx, `撃破したボス: ${info.bossesDefeated}`, VIEW_W / 2, VIEW_H / 2 + 72, m, COLOR_TEXT, "center");
  drawText(ctx, `Enter: 同じシードで再挑戦   ${actionKeyLabel("restart")}: 新しいシード   T: 拠点へ`, VIEW_W / 2, VIEW_H / 2 + 90, m, COLOR_DIM, "center");
  const line = Math.max(DEATH_META_LINE, textLineHeight(m));
  (info.reportLines ?? []).forEach((text, i) => {
    drawText(ctx, truncateText(text, VIEW_W - SCREEN_MARGIN * 2, m), VIEW_W / 2, VIEW_H / 2 + DEATH_REPORT_TOP + i * line, m, COLOR_REPORT, "center");
  });
  (info.metaLines ?? []).forEach((text, i) => {
    drawText(ctx, truncateText(text, VIEW_W - SCREEN_MARGIN * 2, m), VIEW_W / 2, VIEW_H / 2 + DEATH_META_TOP + i * line, m, COLOR_META, "center");
  });
}
