/**
 * タイトル・ポーズ・設定・履歴・死亡サマリーの描画。ロジックは src/ui/title.ts。
 * 文字は pixelText.ts のドット風描画（TEXT のサイズ段階）、配色は renderer.ts の作法（#e0e0 系）に合わせる。
 */
import { VIEW_H, VIEW_W } from "../core/view";
import { RARITIES, RARITY_LABEL, type RunHistoryEntry } from "../loot/types";
import type { ReplayAvailability, RunItemSummary, SeedInputState, SettingsItem, TitleStats } from "../ui/title";
import {
  KEYBINDS_ROWS,
  PAUSE_MENU_ITEMS,
  SETTINGS_ITEMS,
  dailyBestIndices,
  isActionRow,
  isDailyEntry,
  keybindsLayout,
  pauseMenuLayout,
  settingsLayout,
  type KeybindsLayout,
  type KeybindsRow,
} from "../ui/title";
import type { Settings } from "../ui/settings";
import { formatBindingCode, type Keybinds, type RebindableAction } from "../core/input";
import { TEXT, drawText, drawTextShadow, textLineHeight, truncateText } from "./pixelText";
import { APP_VERSION } from "../version";

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_TITLE_SHADOW = "#3a1a08";
const TITLE_Y = 80;
const TITLE_SHADOW_OFFSET = 2;
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_VERSION = "#808080";
/** 画面端からの余白（右下の操作一覧） */
const SCREEN_MARGIN = 8;
/** 画面端からバージョン表示までの余白 */
const VERSION_MARGIN = 6;
/** ポーズパネル下端からバージョン表示のベースラインまで */
const PAUSE_VERSION_GAP = 14;
const COLOR_ACCENT = "#6a8cff";
const COLOR_CURSOR = "#ffffff";
const COLOR_OVERLAY = "rgba(0,0,0,0.65)";
const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
const COLOR_BORDER = "#505050";
const COLOR_DAILY = "#7fe0a0";
const COLOR_DAILY_BEST = "#ffd75f";
const COLOR_REPLAY = "#ff6a6a";
const COLOR_CURSOR_BG = "rgba(106,140,255,0.22)";

/** PRESS ENTER の点滅周期（秒） */
const BLINK_PERIOD_SECONDS = 1.0;
const PARTICLE_COUNT = 36;
const LINE_H = 9;

const PAUSE_LABEL: Record<(typeof PAUSE_MENU_ITEMS)[number], string> = {
  resume: "再開",
  settings: "設定",
  restart: "やり直す",
  title: "タイトルへ",
};

const SETTINGS_LABEL: Record<(typeof SETTINGS_ITEMS)[number], string> = {
  mute: "ミュート",
  volume: "音量",
  screenShake: "画面揺れ",
  keybinds: "キー設定",
  close: "閉じる",
};

/** キー設定画面のアクション名 */
const ACTION_LABEL: Record<RebindableAction, string> = {
  up: "上",
  down: "下",
  left: "左",
  right: "右",
  dash: "ダッシュ",
  attack: "近接攻撃",
  shoot: "射撃",
  special: "バースト",
  inventory: "装備画面",
  skill1: "スキル 1",
  skill2: "スキル 2",
  skill3: "スキル 3",
  skill4: "スキル 4",
};

const KEYBINDS_EXTRA_LABEL: Record<Exclude<KeybindsRow, RebindableAction>, string> = {
  reset: "既定に戻す",
  close: "閉じる",
};

/** 列見出し（KEYBIND_SLOTS と同じ数） */
const KEYBIND_SLOT_LABEL: readonly string[] = ["主", "副", "予備"];
const KEYBIND_EMPTY = "-";
const KEYBIND_CAPTURE_TEXT = "キーを押してください…（Esc で取り消し）";
const COLOR_CAPTURE = "#ffd75f";
/** 列のセル内の左右余白 */
const KEYBIND_CELL_PAD = 3;
/** スクロール印（↑ / ↓）の右端からの距離 */
const KEYBIND_SCROLL_MARK_INSET = 6;

/** RunHistoryEntry.cause（英語のキーのまま持つ）の表示専用ラベル */
const CAUSE_LABEL: Readonly<Record<string, string>> = {
  defeated: "力尽きた",
  abandoned: "離脱",
};

function fillBg(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** タイトル背景: 奥の霞・ダンジョンのシルエット・漂う粒子 */
const SKY_TOP = "#0c0a16";
const SKY_GLOW = "rgba(120,70,160,0.35)";
const SKY_GLOW_Y_RATIO = 0.62;
const SKY_GLOW_R_RATIO = 0.55;
const SILHOUETTE_FAR = "#15121f";
const SILHOUETTE_NEAR = "#07060b";
const WINDOW_COLOR = "#ffb050";
const WINDOW_ALPHA = 0.55;
/** 遠景・近景のシルエットの基準高さ（画面下端から） */
const FAR_BASE_H = 70;
const NEAR_BASE_H = 38;
/** 塔の幅・間隔（px） */
const TOWER_STEP_FAR = 22;
const TOWER_STEP_NEAR = 34;
const TOWER_W_FAR = 14;
const TOWER_W_NEAR = 20;
const TOWER_EXTRA_FAR = 60;
const TOWER_EXTRA_NEAR = 44;
const MERLON_W = 3;
const ARCH_R = 6;
const WINDOW_W = 2;
const WINDOW_H = 3;
/** 窓を灯す確率（ハッシュ値 0..1 に対する閾値） */
const WINDOW_CHANCE = 0.35;
/** 粒子（ゆっくり昇る残り火） */
const EMBER_COLOR = "255,190,120";
const EMBER_ALPHA_MAX = 0.35;
const EMBER_RISE_MIN = 3;
const EMBER_RISE_STEP = 1.7;
const EMBER_SWAY = 6;
const EMBER_SWAY_SPEED = 0.7;
const DUST_COLOR = "rgba(255,255,255,0.10)";
const HASH_MUL_A = 0x27d4eb2d;
const HASH_MUL_B = 0x85ebca6b;
const HASH_DENOM = 0x100000000;

let titleBackdrop: HTMLCanvasElement | null = null;

/** 決定的な 0..1 の擬似乱数（描画専用。ゲーム rng は使わない） */
function hash01(i: number, salt: number): number {
  let h = Math.imul(i + salt * 97, HASH_MUL_A);
  h = Math.imul(h ^ (h >>> 15), HASH_MUL_B);
  h ^= h >>> 13;
  return (h >>> 0) / HASH_DENOM;
}

/** 城壁と塔の稜線。塔の頂上は胸壁、根元はアーチで抜く */
function drawSkyline(
  ctx: CanvasRenderingContext2D,
  color: string,
  baseH: number,
  step: number,
  towerW: number,
  extra: number,
  salt: number,
  windows: boolean,
): void {
  const baseY = VIEW_H - baseH;
  ctx.fillStyle = color;
  ctx.fillRect(0, baseY, VIEW_W, baseH);
  for (let x = 0, i = 0; x < VIEW_W + step; x += step, i++) {
    const h = Math.round(hash01(i, salt) * extra);
    const w = towerW + Math.round(hash01(i, salt + 1) * towerW * 0.5);
    const top = baseY - h;
    ctx.fillStyle = color;
    ctx.fillRect(x, top, w, h + 1);
    for (let mx = x; mx < x + w; mx += MERLON_W * 2) ctx.fillRect(mx, top - MERLON_W, MERLON_W, MERLON_W);
    if (!windows) continue;
    if (hash01(i, salt + 2) < WINDOW_CHANCE && h > WINDOW_H * 4) {
      ctx.fillStyle = WINDOW_COLOR;
      ctx.globalAlpha = WINDOW_ALPHA;
      ctx.fillRect(x + Math.floor(w / 2) - 1, top + WINDOW_H * 2, WINDOW_W, WINDOW_H);
      ctx.globalAlpha = 1;
    }
  }
  // 近景の城壁にはアーチの抜き
  if (!windows) return;
  ctx.globalCompositeOperation = "destination-out";
  for (let x = step / 2; x < VIEW_W; x += step) {
    ctx.beginPath();
    ctx.arc(x, VIEW_H - ARCH_R, ARCH_R, Math.PI, 0);
    ctx.rect(x - ARCH_R, VIEW_H - ARCH_R, ARCH_R * 2, ARCH_R);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** 背景は一度だけ描いてキャッシュする（毎フレームのグラデーション生成を避ける） */
function backdrop(): HTMLCanvasElement {
  if (titleBackdrop) return titleBackdrop;
  const canvas = document.createElement("canvas");
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, COLOR_BG);
  sky.addColorStop(1, SKY_TOP);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const gy = VIEW_H * SKY_GLOW_Y_RATIO;
  const glow = ctx.createRadialGradient(VIEW_W / 2, gy, 0, VIEW_W / 2, gy, VIEW_W * SKY_GLOW_R_RATIO);
  glow.addColorStop(0, SKY_GLOW);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawSkyline(ctx, SILHOUETTE_FAR, FAR_BASE_H, TOWER_STEP_FAR, TOWER_W_FAR, TOWER_EXTRA_FAR, 1, false);
  drawSkyline(ctx, SILHOUETTE_NEAR, NEAR_BASE_H, TOWER_STEP_NEAR, TOWER_W_NEAR, TOWER_EXTRA_NEAR, 7, true);
  titleBackdrop = canvas;
  return canvas;
}

/** 時間だけを種にした粒子: 横に流れる塵 + ゆっくり昇る残り火。乱数は使わない */
function drawParticles(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.fillStyle = DUST_COLOR;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const speed = 4 + (i % 5) * 2.5;
    const laneY = (i * 41) % VIEW_H;
    const x = ((i * 53 + time * speed * 12) % (VIEW_W + 20)) - 10;
    const size = 1 + (i % 3);
    ctx.fillRect(x, laneY, size, size);
  }
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const rise = EMBER_RISE_MIN + (i % 4) * EMBER_RISE_STEP;
    const y = VIEW_H - ((hash01(i, 3) * VIEW_H + time * rise) % VIEW_H);
    const x = hash01(i, 4) * VIEW_W + Math.sin(time * EMBER_SWAY_SPEED + i) * EMBER_SWAY;
    // 上に行くほど消える
    const alpha = EMBER_ALPHA_MAX * (y / VIEW_H);
    ctx.fillStyle = `rgba(${EMBER_COLOR},${alpha.toFixed(3)})`;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  time: number,
  gameName: string,
  seedInput: SeedInputState,
  stats: TitleStats,
): void {
  ctx.drawImage(backdrop(), 0, 0);
  drawParticles(ctx, time);

  drawTextShadow(ctx, gameName, VIEW_W / 2, TITLE_Y, TEXT.BIG, COLOR_TITLE, COLOR_TITLE_SHADOW, "center", TITLE_SHADOW_OFFSET);

  const blinkOn = Math.sin((time / BLINK_PERIOD_SECONDS) * Math.PI * 2) > 0;
  if (blinkOn) drawText(ctx, "Enter で開始", VIEW_W / 2, 112, TEXT.BODY, COLOR_TEXT, "center");

  const seedColor = seedInput.active ? COLOR_ACCENT : COLOR_DIM;
  // URL の ?seed= は常に同期しているので、アドレスバーをコピーすればシードを共有できる
  const seedLabel = seedInput.active
    ? `シード: ${seedInput.text}_`
    : `シード: ${seedInput.text}  (N: 編集 / URL を共有できます)`;
  drawText(ctx, seedLabel, VIEW_W / 2, 132, TEXT.SMALL, seedColor, "center");

  // 右下: 操作一覧
  const controls = [
    "Enter / クリック: 開始   D: デイリーシード",
    "N: シード編集   H: 履歴   O: 設定",
    "WASD / 矢印キー: 移動、Space: ダッシュ",
    "E / 左クリック: 近接、Q / 右クリック: 射撃、F: バースト",
  ];
  const lineH = Math.max(LINE_H, textLineHeight(TEXT.SMALL));
  // 右下の隅にバージョン表示、その上に操作一覧
  drawVersion(ctx, VIEW_W - VERSION_MARGIN, VIEW_H - VERSION_MARGIN, "right");
  let cy = VIEW_H - SCREEN_MARGIN - controls.length * lineH;
  for (const line of controls) {
    drawText(ctx, line, VIEW_W - 8, cy, TEXT.SMALL, COLOR_DIM, "right");
    cy += lineH;
  }

  // 左下: 統計
  const statLines = [
    `挑戦回数: ${stats.runs}`,
    `最深到達: ${stats.bestDepth}`,
    `最高スコア: ${stats.bestScore}`,
    `総撃破: ${stats.totalKills}`,
    `倉庫: ${stats.stashCount}`,
  ];
  let sy = VIEW_H - 8 - (statLines.length - 1) * lineH;
  for (const line of statLines) {
    drawText(ctx, line, 8, sy, TEXT.SMALL, COLOR_TEXT);
    sy += lineH;
  }
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
  drawText(ctx, "ラン履歴", VIEW_W / 2, 18, TEXT.TITLE, COLOR_TITLE, "center");

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
      const cause = entry.cause ? (CAUSE_LABEL[entry.cause] ?? entry.cause) : "";
      const line = `${marks} ${historyDateLabel(entry.date)}  シード:${entry.seedText}  階:${entry.depth}  撃破:${entry.kills}  スコア:${entry.score}  コンボ:${entry.bestCombo}  ${Math.round(entry.durationSec)}秒  ${cause}`;
      let color = i === cursor ? COLOR_CURSOR : COLOR_TEXT;
      if (best) color = COLOR_DAILY_BEST;
      else if (daily) color = COLOR_DAILY;
      if (status === "old") color = COLOR_DIM;
      drawText(ctx, line, HISTORY_LEFT_X, y, m, color);
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

export function drawPauseMenu(ctx: CanvasRenderingContext2D, cursor: number): void {
  ctx.fillStyle = COLOR_OVERLAY;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const itemGap = Math.max(16, textLineHeight(TEXT.SMALL));
  const { panel, items } = pauseMenuLayout(itemGap);
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  drawText(ctx, "ポーズ中", VIEW_W / 2, panel.y + 16, TEXT.BODY, COLOR_TITLE, "center");

  PAUSE_MENU_ITEMS.forEach((item, i) => {
    const active = i === cursor;
    const label = PAUSE_LABEL[item];
    const row = items[i];
    if (!row) return;
    const textY = row.y + row.h / 2;
    drawText(ctx, active ? `> ${label} <` : label, VIEW_W / 2, textY, TEXT.SMALL, active ? COLOR_CURSOR : COLOR_DIM, "center");
  });
  drawVersion(ctx, VIEW_W / 2, panel.y + panel.h + PAUSE_VERSION_GAP, "center");
}

function drawVersion(ctx: CanvasRenderingContext2D, x: number, y: number, align: "center" | "right"): void {
  drawText(ctx, APP_VERSION, x, y, TEXT.SMALL, COLOR_VERSION, align);
}

function barText(value: number): string {
  const filled = Math.round(value * 10);
  return "#".repeat(filled) + "-".repeat(10 - filled);
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

  const valueOf: Record<Exclude<SettingsItem, "close" | "keybinds">, string> = {
    mute: settings.muted ? "オン" : "オフ",
    volume: barText(settings.volume),
    screenShake: barText(settings.screenShake),
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
    if (item === "keybinds") {
      drawText(ctx, active ? `> ${SETTINGS_LABEL[item]}` : SETTINGS_LABEL[item], panel.x + 12, textY, m, color);
      return;
    }
    const label = active ? `> ${SETTINGS_LABEL[item]}` : SETTINGS_LABEL[item];
    drawText(ctx, label, panel.x + 12, textY, m, color);
    drawText(ctx, valueOf[item], panel.x + panel.w - 12, textY, m, color, "right");
  });

  const footer = truncateText("← →: 調整  Enter: 決定  Esc: 戻る", panel.w - 8, m);
  drawText(ctx, footer, VIEW_W / 2, panel.y + panel.h - 8, m, COLOR_DIM, "center");
}

export interface KeybindsScreenView {
  binds: Keybinds;
  /** KEYBINDS_ROWS の index */
  cursor: number;
  /** 選択中の列（主 / 副 / 予備） */
  slot: number;
  scroll: number;
  /** 取得モード中（次の押下を待っている） */
  capturing: boolean;
}

/** キー設定の行間。描画と main.ts の当たり判定が同じ値を使う */
export function keybindsRowGap(): number {
  return Math.max(KEYBINDS_MIN_ROW_GAP, textLineHeight(TEXT.SMALL));
}
const KEYBINDS_MIN_ROW_GAP = 13;

function drawKeybindCells(
  ctx: CanvasRenderingContext2D,
  layout: KeybindsLayout,
  codes: readonly string[],
  y: number,
  selectedSlot: number | null,
): void {
  const m = TEXT.SMALL;
  layout.slots.forEach((col, i) => {
    const code = codes[i];
    const selected = i === selectedSlot;
    const text = code === undefined ? KEYBIND_EMPTY : formatBindingCode(code);
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
  const m = TEXT.SMALL;
  const y = rowRect.y + rowRect.h / 2;
  const nameColor = active ? COLOR_CURSOR : COLOR_DIM;
  drawText(ctx, active ? `> ${ACTION_LABEL[action]}` : ACTION_LABEL[action], layout.nameX, y, m, nameColor, "left", "middle");
  const first = layout.slots[0];
  const last = layout.slots[layout.slots.length - 1];
  if (active && view.capturing && first && last) {
    const areaW = last.x + last.w - first.x;
    const text = truncateText(KEYBIND_CAPTURE_TEXT, areaW, m);
    drawText(ctx, text, first.x + areaW / 2, y, m, COLOR_CAPTURE, "center", "middle");
    return;
  }
  const selectedCol = active ? layout.slots[view.slot] : undefined;
  if (selectedCol) {
    ctx.fillStyle = COLOR_CURSOR_BG;
    ctx.fillRect(selectedCol.x, rowRect.y, selectedCol.w, rowRect.h);
  }
  drawKeybindCells(ctx, layout, view.binds[action], y, active ? view.slot : null);
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
  const layout = keybindsLayout(keybindsRowGap(), view.scroll);
  const { panel } = layout;
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  drawText(ctx, "キー設定", VIEW_W / 2, layout.titleY, TEXT.BODY, COLOR_TITLE, "center", "middle");
  layout.slots.forEach((col, i) => {
    drawText(ctx, KEYBIND_SLOT_LABEL[i] ?? "", col.x + col.w / 2, layout.headerY, m, COLOR_DIM, "center", "middle");
  });

  for (const { index, rect } of layout.rows) {
    const row = KEYBINDS_ROWS[index];
    if (row === undefined) continue;
    const active = index === view.cursor;
    if (isActionRow(row)) {
      drawKeybindActionRow(ctx, layout, view, row, rect, active);
      continue;
    }
    const label = KEYBINDS_EXTRA_LABEL[row];
    const y = rect.y + rect.h / 2;
    drawText(ctx, active ? `> ${label} <` : label, VIEW_W / 2, y, m, active ? COLOR_CURSOR : COLOR_DIM, "center", "middle");
  }

  drawKeybindScrollMarks(ctx, layout, view.scroll);

  const footer = view.capturing
    ? "キーかマウスボタンを押す   Esc: 取り消し"
    : "↑↓: 行  ←→: 列  Enter/クリック: 変更  Delete: 空にする  Esc: 戻る";
  drawText(ctx, truncateText(footer, panel.w - 8, m), VIEW_W / 2, layout.footerY, m, COLOR_DIM, "center", "middle");
}

/** 上下に隠れた行があることを示す */
function drawKeybindScrollMarks(ctx: CanvasRenderingContext2D, layout: KeybindsLayout, scroll: number): void {
  const x = layout.panel.x + layout.panel.w - KEYBIND_SCROLL_MARK_INSET;
  const first = layout.rows[0];
  const last = layout.rows[layout.rows.length - 1];
  if (first && scroll > 0) {
    drawText(ctx, "↑", x, first.rect.y + first.rect.h / 2, TEXT.SMALL, COLOR_DIM, "right", "middle");
  }
  if (last && last.index < KEYBINDS_ROWS.length - 1) {
    drawText(ctx, "↓", x, last.rect.y + last.rect.h / 2, TEXT.SMALL, COLOR_DIM, "right", "middle");
  }
}

export interface DeathSummaryInfo {
  itemSummary: RunItemSummary;
  bestCombo: number;
  bossesDefeated: number;
}

/** renderer.drawDeath の上に重ね描きする追加情報 */
export function drawDeathSummary(ctx: CanvasRenderingContext2D, info: DeathSummaryInfo): void {
  const m = TEXT.SMALL;
  const rarityText = RARITIES.map((r) => `${RARITY_LABEL[r]} ${info.itemSummary.byRarity[r]}`).join(" / ");
  drawText(ctx, `拾った遺物: ${info.itemSummary.total}（${rarityText}）`, VIEW_W / 2, VIEW_H / 2 + 60, m, COLOR_TEXT, "center");
  drawText(ctx, `撃破したボス: ${info.bossesDefeated}`, VIEW_W / 2, VIEW_H / 2 + 72, m, COLOR_TEXT, "center");
  drawText(ctx, "Enter: 同じシードで再挑戦   R: 新しいシード   T: タイトル", VIEW_W / 2, VIEW_H / 2 + 90, m, COLOR_DIM, "center");
}
