/**
 * preload と renderer が共有する保存の契約（型のみ）。
 * preload が contextBridge で window.electronSave に載せる。ブラウザ版では undefined
 */
export interface SaveBridge {
  /** 起動時 1 回。既知キーのファイルを全部読む（sendSync）。壊れたファイルは .bak から、それも駄目なら省く */
  readAll(): Record<string, string>;
  /** 遅延 flush 用（invoke）。未知キーは main が拒否する */
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** ページ離脱時の同期書き出し（sendSync）。dirty なキーだけ渡す */
  writeAllSync(entries: Record<string, string>): void;
  openSaveFolder(): Promise<void>;
}

declare global {
  interface Window {
    electronSave?: SaveBridge;
  }
}
