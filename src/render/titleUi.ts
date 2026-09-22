/**
 * タイトル・ポーズ・設定・履歴・死亡サマリーの描画。ロジックは src/ui/title.ts。
 * renderer.ts のフォント/配色の作法（bold monospace, #e0e0 系）に合わせる。
 */
import { VIEW_H, VIEW_W } from "../core/view";
import { RARITIES, type RunHistoryEntry } from "../loot/types";
import type { RunItemSummary, SeedInputState, TitleStats } from "../ui/title";
import { PAUSE_MENU_ITEMS, SETTINGS_ITEMS } from "../ui/title";
import type { Settings } from "../ui/settings";

const FONT_HUGE = "bold 24px monospace";
const FONT_BIG = "bold 16px monospace";
const FONT_MED = "bold 10px monospace";
const FONT_SMALL = "bold 8px monospace";

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_ACCENT = "#6a8cff";
const COLOR_CURSOR = "#ffffff";
const COLOR_OVERLAY = "rgba(0,0,0,0.65)";
const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
const COLOR_BORDER = "#505050";

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

/** 時間だけを種にした薄い浮遊パーティクル。乱数は使わない */
function drawParticles(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const speed = 4 + (i % 5) * 2.5;
    const laneY = (i * 41) % VIEW_H;
    const x = ((i * 53 + time * speed * 12) % (VIEW_W + 20)) - 10;
    const size = 1 + (i % 3);
    ctx.fillRect(x, laneY, size, size);
  }
}

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  time: number,
  gameName: string,
  seedInput: SeedInputState,
  stats: TitleStats,
): void {
  fillBg(ctx);
  drawParticles(ctx, time);

  ctx.textAlign = "center";
  ctx.font = FONT_HUGE;
  ctx.fillStyle = COLOR_TITLE;
  ctx.fillText(gameName, VIEW_W / 2, 80);

  const blinkOn = Math.sin((time / BLINK_PERIOD_SECONDS) * Math.PI * 2) > 0;
  ctx.font = FONT_MED;
  ctx.fillStyle = COLOR_TEXT;
  if (blinkOn) ctx.fillText("PRESS ENTER", VIEW_W / 2, 112);

  ctx.font = FONT_SMALL;
  ctx.fillStyle = seedInput.active ? COLOR_ACCENT : COLOR_DIM;
  const seedLabel = seedInput.active ? `SEED: ${seedInput.text}_` : `SEED: ${seedInput.text}  (N to edit)`;
  ctx.fillText(seedLabel, VIEW_W / 2, 132);

  // 右下: 操作一覧
  const controls = [
    "Enter / Click: start",
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

export function drawHistoryScreen(ctx: CanvasRenderingContext2D, history: readonly RunHistoryEntry[]): void {
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
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR_TEXT;
    let y = 36;
    for (const entry of history) {
      const d = new Date(entry.date);
      const dateLabel = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const line = `${dateLabel}  seed:${entry.seedText}  depth:${entry.depth}  kills:${entry.kills}  score:${entry.score}  combo:${entry.bestCombo}  ${Math.round(entry.durationSec)}s  ${entry.cause ?? ""}`;
      ctx.fillText(line, 10, y);
      y += LINE_H;
    }
  }

  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText("Esc: back", VIEW_W / 2, VIEW_H - 8);
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
