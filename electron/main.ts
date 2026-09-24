/**
 * Electron の main プロセス。userData の固定・app:// での dist/ 配信・ウィンドウ・保存の IPC を持つ。
 * ゲーム本体（src/）は Electron を知らない。preload が載せる window.electronSave を src/save/bootstrap.ts が見つけたときだけ保存先が切り替わる
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { APP_VERSION_SEMVER } from "../src/version";
import { IPC } from "./ipc";
import { createSaveStore } from "./saveStore";
import { initialWindowOptions, LOGICAL_H, LOGICAL_W, rememberWindowState, toggleFullScreen } from "./window";

const APP_DIR_NAME = "DEPTHBREAKER";
const SCHEME = "app";
const APP_HOST = "game";
const APP_ORIGIN = `${SCHEME}://${APP_HOST}`;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const IS_DEV = DEV_SERVER_URL !== undefined && DEV_SERVER_URL !== "";
/** style-src の 'unsafe-inline' は index.html のインライン <style> のため */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' blob:",
].join("; ");
/** net.fetch が拡張子から型を付けられない場合の保険（フォントが text/plain だと読まれない） */
const MIME_FALLBACK: Readonly<Record<string, string>> = {
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".png": "image/png",
  ".json": "application/json",
};

// dev（package.json の name）とパッケージ後（productName）でセーブの場所が変わらないよう、ready 前に固定する
app.setPath("userData", path.join(app.getPath("appData"), APP_DIR_NAME));
// 最初の操作前から効果音・BGM を鳴らせるようにする（Web 版向けの unlock() はそのまま残る）
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const mainDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(app.getAppPath(), "dist");
const saveDir = path.join(app.getPath("userData"), "save");
const store = createSaveStore(saveDir, APP_VERSION_SEMVER, () => Date.now());

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

/** URL のパスを dist/ 配下に解決する。dist の外に出るパスは null */
function resolveDistFile(url: URL): string | null {
  if (url.host !== APP_HOST) return null;
  const rel = decodeURIComponent(url.pathname);
  const file = path.resolve(distDir, `.${rel === "/" ? "/index.html" : rel}`);
  if (!file.startsWith(distDir + path.sep)) return null;
  return file;
}

async function serveApp(request: Request): Promise<Response> {
  const file = resolveDistFile(new URL(request.url));
  if (file === null || !fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound();
  const res = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(res.headers);
  headers.set("Content-Security-Policy", CSP);
  const fallback = MIME_FALLBACK[path.extname(file).toLowerCase()];
  if (fallback && !headers.get("Content-Type")) headers.set("Content-Type", fallback);
  return new Response(res.body, { status: res.status, headers });
}

/** 保存の IPC は自分のページからだけ受ける（将来 iframe や外部ページが紛れ込んでも書かせない） */
function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  return IS_DEV && url.startsWith(DEV_SERVER_URL);
}

function registerSaveIpc(): void {
  ipcMain.on(IPC.readAll, (event) => {
    if (!isTrustedSender(event)) {
      event.returnValue = {};
      return;
    }
    const started = performance.now();
    event.returnValue = store.readAll();
    console.log(`[save] readAll ${(performance.now() - started).toFixed(1)}ms`);
  });
  ipcMain.handle(IPC.write, (event, key: unknown, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    if (typeof key !== "string" || typeof value !== "string") throw new Error("invalid save write");
    store.write(key, value);
  });
  ipcMain.handle(IPC.remove, (event, key: unknown) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    if (typeof key !== "string") throw new Error("invalid save remove");
    store.remove(key);
  });
  ipcMain.on(IPC.writeAllSync, (event, entries: unknown) => {
    event.returnValue = null;
    if (!isTrustedSender(event) || typeof entries !== "object" || entries === null) return;
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== "string") continue;
      try {
        store.write(key, value);
      } catch (err) {
        console.warn(`[save] ${key} を書き出せなかった`, err);
      }
    }
  });
  ipcMain.handle(IPC.openFolder, async (event) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    const error = await shell.openPath(saveDir);
    if (error !== "") throw new Error(error);
  });
}

function isAllowedNavigation(url: string): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  return IS_DEV && url.startsWith(DEV_SERVER_URL);
}

/** F11 / Alt+Enter はフルスクリーン。メニューが無いので dev の再読み込みと DevTools もここで拾う */
function bindShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const fullscreenKey = input.key === "F11" || (input.alt && input.key === "Enter");
    if (fullscreenKey) {
      event.preventDefault();
      toggleFullScreen(win);
      return;
    }
    if (!IS_DEV) return;
    if (input.key === "F12") {
      event.preventDefault();
      win.webContents.toggleDevTools();
      return;
    }
    if (input.control && input.key.toLowerCase() === "r") {
      event.preventDefault();
      win.webContents.reload();
    }
  });
}

function createWindow(): void {
  const initial = initialWindowOptions(app.getPath("userData"));
  const win = new BrowserWindow({
    ...initial.rect,
    useContentSize: initial.useContentSize,
    fullscreen: initial.fullscreen,
    minWidth: LOGICAL_W,
    minHeight: LOGICAL_H,
    backgroundColor: "#000",
    autoHideMenuBar: true,
    title: APP_DIR_NAME,
    show: false,
    webPreferences: {
      preload: path.join(mainDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  rememberWindowState(win, app.getPath("userData"));
  bindShortcuts(win);
  void win.loadURL(IS_DEV ? DEV_SERVER_URL : `${APP_ORIGIN}/index.html`);
}

Menu.setApplicationMenu(null);
registerSaveIpc();

void app.whenReady().then(() => {
  protocol.handle(SCHEME, serveApp);
  const imported = store.consumeImportFile();
  if (imported.length > 0) console.log(`[save] import.json から取り込んだ: ${imported.join(", ")}`);
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
