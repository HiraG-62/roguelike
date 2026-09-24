/** preload と main プロセスで共有する IPC チャネル名。片側だけ書き換えて食い違わないよう 1 か所に置く */
export const IPC = {
  /** 起動時 1 回（sendSync）。main.ts のトップレベルの load*() より前に全キーが要る */
  readAll: "save:readAll",
  write: "save:write",
  remove: "save:remove",
  /** ページ離脱時（sendSync）。非同期の invoke は pagehide の後に届かない恐れがある */
  writeAllSync: "save:writeAllSync",
  openFolder: "save:openFolder",
} as const;
