/**
 * ウィンドウの初期サイズ・位置の記憶・フルスクリーン切替。
 * 位置は userData/window.json（save/ の外）に置く。Steam Cloud で別の PC のモニタ配置を持ち込まないため
 */
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, screen, type Rectangle } from "electron";

/** src/core/view.ts の VIEW_W / VIEW_H と同じ。renderer は整数倍でしか拡大しないので、この倍数なら黒帯が出ない */
export const LOGICAL_W = 480;
export const LOGICAL_H = 270;
/** 作業領域からタイトルバーと枠の分を引く（useContentSize は中身の大きさなので、外枠はこれだけ大きくなる） */
const FRAME_MARGIN_H = 48;
const FRAME_MARGIN_W = 16;
const WINDOW_STATE_FILE = "window.json";

export interface WindowState {
  bounds: Rectangle;
  fullscreen: boolean;
}

/** 作業領域に収まる最大の整数倍（最低 1） */
export function fitScale(workW: number, workH: number): number {
  const k = Math.floor(Math.min((workW - FRAME_MARGIN_W) / LOGICAL_W, (workH - FRAME_MARGIN_H) / LOGICAL_H));
  return Math.max(1, k);
}

function isRectangle(v: unknown): v is Rectangle {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]));
}

function loadWindowState(userData: string): WindowState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(userData, WINDOW_STATE_FILE), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { bounds, fullscreen } = parsed as Record<string, unknown>;
    if (!isRectangle(bounds)) return null;
    return { bounds, fullscreen: fullscreen === true };
  } catch {
    return null;
  }
}

function saveWindowState(userData: string, state: WindowState): void {
  try {
    fs.writeFileSync(path.join(userData, WINDOW_STATE_FILE), JSON.stringify(state), "utf8");
  } catch (err) {
    console.warn("[window] 位置を保存できなかった", err);
  }
}

/** 前回の位置がいまのモニタ配置で見える位置にあるか（モニタを外した後に画面外へ出さない） */
function isVisible(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const x = Math.max(a.x, bounds.x);
    const y = Math.max(a.y, bounds.y);
    const right = Math.min(a.x + a.width, bounds.x + bounds.width);
    const bottom = Math.min(a.y + a.height, bounds.y + bounds.height);
    return right - x >= LOGICAL_W / 2 && bottom - y >= LOGICAL_H / 2;
  });
}

/** 前回の位置（見える場合）か、主モニタの作業領域に収まる最大整数倍の中身の大きさ */
export function initialWindowOptions(userData: string): { rect: Partial<Rectangle>; useContentSize: boolean; fullscreen: boolean } {
  const saved = loadWindowState(userData);
  if (saved && isVisible(saved.bounds)) return { rect: saved.bounds, useContentSize: false, fullscreen: saved.fullscreen };
  const work = screen.getPrimaryDisplay().workAreaSize;
  const k = fitScale(work.width, work.height);
  return { rect: { width: LOGICAL_W * k, height: LOGICAL_H * k }, useContentSize: true, fullscreen: false };
}

/** 閉じるときに位置を記憶する。フルスクリーン中は戻したときの通常の位置を記憶する */
export function rememberWindowState(win: BrowserWindow, userData: string): void {
  win.on("close", () => {
    const fullscreen = win.isFullScreen();
    const bounds = fullscreen || win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    saveWindowState(userData, { bounds, fullscreen });
  });
}

export function toggleFullScreen(win: BrowserWindow): void {
  win.setFullScreen(!win.isFullScreen());
}
