/**
 * 副作用のみ。main.ts の最初の import として評価され、トップレベルの load*() より前に保存先を差し替える。
 * Electron（preload が window.electronSave を載せている）ならセーブファイル、ブラウザなら何もしない（localStorage のまま）
 */
import { localStorageOrNull, setSaveStorage } from "./backend";
import { FileStorage } from "./fileStorage";
import { migrateFromLocalStorage } from "./migrate";

const bridge = typeof window === "undefined" ? undefined : window.electronSave;
if (bridge) {
  const storage = new FileStorage(bridge, bridge.readAll());
  migrateFromLocalStorage(storage, localStorageOrNull());
  window.addEventListener("pagehide", () => storage.flushSync());
  setSaveStorage(storage);
}
