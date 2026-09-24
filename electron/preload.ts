/**
 * renderer に保存の窓口（window.electronSave）だけを載せる。sandbox: true の preload は ESM 非対応なので CJS に束ねる
 */
import { contextBridge, ipcRenderer } from "electron";
import type { SaveBridge } from "../src/save/bridge";
import { IPC } from "./ipc";

const bridge: SaveBridge = {
  readAll: () => ipcRenderer.sendSync(IPC.readAll) as Record<string, string>,
  write: async (key, value) => {
    await ipcRenderer.invoke(IPC.write, key, value);
  },
  remove: async (key) => {
    await ipcRenderer.invoke(IPC.remove, key);
  },
  writeAllSync: (entries) => {
    ipcRenderer.sendSync(IPC.writeAllSync, entries);
  },
  openSaveFolder: async () => {
    await ipcRenderer.invoke(IPC.openFolder);
  },
};

contextBridge.exposeInMainWorld("electronSave", bridge);
