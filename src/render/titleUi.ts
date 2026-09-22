/**
 * タイトル・ポーズ・設定・履歴・死亡サマリーの描画。ロジックは src/ui/title.ts。
 * renderer.ts のフォント/配色の作法（bold monospace, #e0e0 系）に合わせる。
 */
import { VIEW_H, VIEW_W } from "../core/view";
import { RARITIES, type RunHistoryEntry } from "../loot/types";
import type { RunItemSummary, SeedInputState, TitleStats } from "../ui/title";
import { PAUSE_MENU_ITEMS, SETTINGS_ITEMS, dailyBestIndices, isDailyEntry } from "../ui/title";
import type { Settings } from "../ui/settings";

const FONT_HUGE = "bold 24px monospace";
const FONT_BIG = "bold 16px monospace";
const FONT_MED = "bold 10px monospace";
const FONT_SMALL = "bold 8px monospace";

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_TITLE_SHADOW = "#3a1a08";
const TITLE_Y = 80;
const TITLE_SHADOW_OFFSET = 2;
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
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
  resume: "Resume",
  settings: "Settings",
  restart: "Restart",
  title: "Title",
};

const SETTINGS_LABEL: Record<(typeof SETTINGS_ITEMS)[number], string> = {
  mute: "Mute",
  volume: "Volume",
  screenShake: "Screen shake",
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

  ctx.textAlign = "center";
  ctx.font = FONT_HUGE;
  ctx.fillStyle = COLOR_TITLE_SHADOW;
  ctx.fillText(gameName, VIEW_W / 2 + TITLE_SHADOW_OFFSET, TITLE_Y + TITLE_SHADOW_OFFSET);
  ctx.fillStyle = COLOR_TITLE;
  ctx.fillText(gameName, VIEW_W / 2, TITLE_Y);

  const blinkOn = Math.sin((time / BLINK_PERIOD_SECONDS) * Math.PI * 2) > 0;
  ctx.font = FONT_MED;
  ctx.fillStyle = COLOR_TEXT;
  if (blinkOn) ctx.fillText("PRESS ENTER", VIEW_W / 2, 112);

  ctx.font = FONT_SMALL;
  ctx.fillStyle = seedInput.active ? COLOR_ACCENT : COLOR_DIM;
  // URL の ?seed= は常に同期しているので、アドレスバーをコピーすればシードを共有できる
  const seedLabel = seedInput.active
    ? `SEED: ${seedInput.text}_`
    : `SEED: ${seedInput.text}  (N: edit / copy URL to share)`;
  ctx.fillText(seedLabel, VIEW_W / 2, 132);

  // 右下: 操作一覧
  const controls = [
    "Enter / Click: start   D: daily seed",
    "N: edit seed   H: history   O: settings",
    "WASD/Arrows move, Space dash",
    "E/LMB melee, Q/RMB shoot, F burst",
  ];
  ctx.textAlign = "right";
  ctx.fillStyle = COLOR_DIM;
  let cy = VIEW_H - 8 - (controls.length - 1) * LINE_H;
  for (const line of controls) {
    ctx.fillText(line, VIEW_W - 8, cy);
    cy += LINE_H;
  }

  // 左下: 統計
  const statLines = [
    `runs: ${stats.runs}`,
    `best depth: ${stats.bestDepth}`,
    `best score: ${stats.bestScore}`,
    `total kills: ${stats.totalKills}`,
    `stash: ${stats.stashCount}`,
  ];
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_TEXT;
  let sy = VIEW_H - 8 - (statLines.length - 1) * LINE_H;
  for (const line of statLines) {
    ctx.fillText(line, 8, sy);
    sy += LINE_H;
  }
}

const HISTORY_TOP_Y = 36;
const HISTORY_LEFT_X = 10;
const HISTORY_ROW_PAD = 7;
const MINUTE_PAD = 2;

export interface HistoryScreenView {
  history: readonly RunHistoryEntry[];
  cursor: number;
  /** i 番目の履歴にリプレイが残っているか */
  hasReplay: (index: number) => boolean;
  /** 直前の操作の結果（「リプレイが無い」等）。空なら出さない */
  message: string;
}

function historyDateLabel(date: number): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(MINUTE_PAD, "0")}:${String(d.getMinutes()).padStart(MINUTE_PAD, "0")}`;
}

export function drawHistoryScreen(ctx: CanvasRenderingContext2D, view: HistoryScreenView): void {
  const { history, cursor } = view;
  fillBg(ctx);
  ctx.textAlign = "center";
  ctx.font = FONT_BIG;
  ctx.fillStyle = COLOR_TITLE;
  ctx.fillText("RUN HISTORY", VIEW_W / 2, 18);

  ctx.font = FONT_SMALL;
  if (history.length === 0) {
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("no runs yet", VIEW_W / 2, VIEW_H / 2);
  } else {
    const dailyBest = dailyBestIndices(history);
    ctx.textAlign = "left";
    let y = HISTORY_TOP_Y;
    history.forEach((entry, i) => {
      if (i === cursor) {
        ctx.fillStyle = COLOR_CURSOR_BG;
        ctx.fillRect(HISTORY_LEFT_X - 4, y - HISTORY_ROW_PAD, VIEW_W - (HISTORY_LEFT_X - 4) * 2, LINE_H);
      }
      const daily = isDailyEntry(entry);
      const best = dailyBest.has(i);
      // 行頭の印: R = リプレイあり、D = デイリー（* = その日のベスト）
      const marks = `${view.hasReplay(i) ? "R" : " "}${daily ? (best ? "*" : "D") : " "}`;
      const line = `${marks} ${historyDateLabel(entry.date)}  seed:${entry.seedText}  depth:${entry.depth}  kills:${entry.kills}  score:${entry.score}  combo:${entry.bestCombo}  ${Math.round(entry.durationSec)}s  ${entry.cause ?? ""}`;
      if (best) ctx.fillStyle = COLOR_DAILY_BEST;
      else if (daily) ctx.fillStyle = COLOR_DAILY;
      else ctx.fillStyle = i === cursor ? COLOR_CURSOR : COLOR_TEXT;
      ctx.fillText(line, HISTORY_LEFT_X, y);
      y += LINE_H;
    });
  }

  ctx.textAlign = "center";
  if (view.message.length > 0) {
    ctx.fillStyle = COLOR_REPLAY;
    ctx.fillText(view.message, VIEW_W / 2, VIEW_H - 18);
  }
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText("Up/Down: select   P: replay   S: play seed   Esc: back   (R replay, D daily, * daily best)", VIEW_W / 2, VIEW_H - 8);
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

/** 再生中の画面上部に "REPLAY" と速度・進捗を重ねる */
export function drawReplayHud(ctx: CanvasRenderingContext2D, info: ReplayHudInfo, time: number): void {
  const blinkOn = Math.sin((time / REPLAY_BLINK_PERIOD_SECONDS) * Math.PI * 2) > 0;
  ctx.textAlign = "center";
  ctx.font = FONT_MED;
  ctx.fillStyle = COLOR_REPLAY;
  const label = info.finished ? "REPLAY END" : `${blinkOn ? "● " : "  "}REPLAY ${info.speed}x`;
  ctx.fillText(label, VIEW_W / 2, REPLAY_HUD_Y);

  const barX = (VIEW_W - REPLAY_BAR_W) / 2;
  const barY = REPLAY_HUD_Y + 4;
  ctx.fillStyle = COLOR_BORDER;
  ctx.fillRect(barX, barY, REPLAY_BAR_W, REPLAY_BAR_H);
  ctx.fillStyle = COLOR_REPLAY;
  ctx.fillRect(barX, barY, REPLAY_BAR_W * Math.max(0, Math.min(1, info.progress)), REPLAY_BAR_H);

  ctx.font = FONT_SMALL;
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(`seed:${info.seedText}   <- ->: speed   Esc: exit`, VIEW_W / 2, barY + REPLAY_BAR_H + 9);
}

export function drawPauseMenu(ctx: CanvasRenderingContext2D, cursor: number): void {
  ctx.fillStyle = COLOR_OVERLAY;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const panelW = 160;
  const panelH = 96;
  const panelX = (VIEW_W - panelW) / 2;
  const panelY = (VIEW_H - panelH) / 2;
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

  ctx.textAlign = "center";
  ctx.font = FONT_MED;
  ctx.fillStyle = COLOR_TITLE;
  ctx.fillText("PAUSED", VIEW_W / 2, panelY + 16);

  ctx.font = FONT_SMALL;
  const itemY = panelY + 36;
  const itemGap = 16;
  PAUSE_MENU_ITEMS.forEach((item, i) => {
    const active = i === cursor;
    ctx.fillStyle = active ? COLOR_CURSOR : COLOR_DIM;
    const label = PAUSE_LABEL[item];
    ctx.fillText(active ? `> ${label} <` : label, VIEW_W / 2, itemY + i * itemGap);
  });
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

  const panelW = 220;
  const panelH = 108;
  const panelX = (VIEW_W - panelW) / 2;
  const panelY = (VIEW_H - panelH) / 2;
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

  ctx.textAlign = "center";
  ctx.font = FONT_MED;
  ctx.fillStyle = COLOR_TITLE;
  ctx.fillText("SETTINGS", VIEW_W / 2, panelY + 16);

  ctx.font = FONT_SMALL;
  const valueOf: Record<(typeof SETTINGS_ITEMS)[number], string> = {
    mute: settings.muted ? "ON" : "OFF",
    volume: barText(settings.volume),
    screenShake: barText(settings.screenShake),
  };
  const rowY = panelY + 40;
  const rowGap = 18;
  SETTINGS_ITEMS.forEach((item, i) => {
    const active = i === cursor;
    ctx.textAlign = "left";
    ctx.fillStyle = active ? COLOR_CURSOR : COLOR_DIM;
    ctx.fillText(active ? `> ${SETTINGS_LABEL[item]}` : SETTINGS_LABEL[item], panelX + 12, rowY + i * rowGap);
    ctx.textAlign = "right";
    ctx.fillText(valueOf[item], panelX + panelW - 12, rowY + i * rowGap);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText("<- ->: adjust   M: mute   Esc: back", VIEW_W / 2, panelY + panelH - 8);
}

export interface DeathSummaryInfo {
  itemSummary: RunItemSummary;
  bestCombo: number;
  bossesDefeated: number;
}

/** renderer.drawDeath の上に重ね描きする追加情報 */
export function drawDeathSummary(ctx: CanvasRenderingContext2D, info: DeathSummaryInfo): void {
  ctx.textAlign = "center";
  ctx.font = FONT_SMALL;
  ctx.fillStyle = COLOR_TEXT;
  const rarityText = RARITIES.map((r) => `${r}:${info.itemSummary.byRarity[r]}`).join("  ");
  ctx.fillText(`items found ${info.itemSummary.total}  (${rarityText})`, VIEW_W / 2, VIEW_H / 2 + 60);
  ctx.fillText(`bosses defeated ${info.bossesDefeated}`, VIEW_W / 2, VIEW_H / 2 + 72);
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText("Enter: retry   R: new seed   T: title", VIEW_W / 2, VIEW_H / 2 + 90);
}
