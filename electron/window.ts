/**
 * ウィンドウの初期サイズ・位置の記憶・フルスクリーン切替。
 * 位置は userData/window.json（save/ の外）に置く。Steam Cloud で別の PC のモニタ配置を持ち込まないため
 */
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, screen, type Rectangle } from "electron";

/** src/core/view.ts の VIEW_W / VIEW_H と同じ */
export const LOGICAL_W = 480;
export const LOGICAL_H = 270;
/** src/core/view.ts の RENDER_SCALE と同じ。renderer のバックバッファはこの倍率で固定（1920x1080） */
const RENDER_SCALE = 4;
const NATIVE_W = LOGICAL_W * RENDER_SCALE;
const NATIVE_H = LOGICAL_H * RENDER_SCALE;
/** 作業領域からタイトルバーと枠の分を引く（useContentSize は中身の大きさなので、外枠はこれだけ大きくなる） */
const FRAME_MARGIN_H = 48;
const FRAME_MARGIN_W = 16;
const WINDOW_STATE_FILE = "window.json";

export interface WindowState {
  bounds: Rectangle;
  fullscreen: boolean;
}

/**
 * 作業領域に収まる 16:9 の最大サイズ（フルスクリーンを抜けたときの通常窓の大きさ）。
 * 描画の解像度は 1920x1080 固定で、大きいモニタでは表示だけ引き伸ばすので、窓も上限なしに広げる
 */
export function fitWindowSize(workW: number, workH: number): { width: number; height: number } {
  const availW = Math.max(LOGICAL_W, workW - FRAME_MARGIN_W);
  const availH = Math.max(LOGICAL_H, workH - FRAME_MARGIN_H);
  const scale = Math.min(availW / NATIVE_W, availH / NATIVE_H);
  return { width: Math.round(NATIVE_W * scale), height: Math.round(NATIVE_H * scale) };
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

/**
 * 前回の位置（見える場合）か、主モニタの作業領域に収まる 16:9 の最大サイズ。
 * 起動は常にフルスクリーン（前回窓で閉じていても）。rect はフルスクリーンを抜けたときの通常窓の大きさ
 */
export function initialWindowOptions(userData: string): { rect: Partial<Rectangle>; useContentSize: boolean; fullscreen: boolean } {
  const saved = loadWindowState(userData);
  if (saved && isVisible(saved.bounds)) return { rect: saved.bounds, useContentSize: false, fullscreen: true };
  const work = screen.getPrimaryDisplay().workAreaSize;
  const size = fitWindowSize(work.width, work.height);
  return { rect: size, useContentSize: true, fullscreen: true };
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
