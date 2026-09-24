# Electron 化とセーブファイル管理の設計

作成: 2026-09-24（architect）。要望は `memo/20260924-1.md`「セーブデータはローカルストレージではなくセーブファイルとして管理したい」「キー設定は単独の別ファイルとしたい」。将来の Steam 配信を見据える。

## 0. 結論

- **保存の抽象層は「`Storage` 互換の同期 API + 起動時全読み込み + 変更時に遅延書き込み」**にする。各ストアの `load*(storage?: Storage)` / `save*(…, storage?: Storage)` というシグネチャは既に全ストアで揃っている（1.1）ので、7 か所に複製されている `defaultStorage()` を `src/save/backend.ts` の `saveStorage()` 1 つに寄せるだけで、ストア本体もテスト（`MemoryStorage` を明示的に渡す）も変えずに済む
- Electron では preload の `contextBridge` 経由で **起動時に `sendSync` で全ファイルを読み、renderer 側 `FileStorage`（`Storage` 実装）がメモリに持ち、`setItem` は dirty を立てて 300ms 後にまとめて main プロセスへ `invoke`**。ページ離脱時は `sendSync` で同期書き出し。ファイル書き込みは main プロセスが `tmp → rename` の原子的更新と `.bak` 退避を行う
- **ファイルは「localStorage のキー 1 つ = ファイル 1 つ」**（`profile.json` / `skills.json` / `craft.json` / `settings.json` / `keybinds.json` / `codex.json` / `quests.json` / `achievements.json` / `hub.json` / `replays.json`）。キー設定は `settings` から分離した新キー `roguelike.keybinds.v1` に載せる（ブラウザ版でも別キーになる。旧 `settings.keybinds` からの取り込みあり）
- Electron の構成は **vite-plugin-electron を使わず、Vite のライブラリモードで `electron/main.ts` と `electron/preload.ts` をそれぞれ 1 ファイルに束ねる**（追加依存は `electron` / `electron-builder` / `@types/node` の 3 つ。すべて devDependencies。`dependencies` は空のまま）。renderer は `app://` カスタムスキームで `dist/` を配信する（`file://` を使わない。理由は 4.2）
- 却下: `SaveBackend` を非同期 API にする（`step` 内の `saveProfile` 呼び出し〔`src/system/loot.ts:261` など〕が同期前提で、全ストアと呼び出し側の書き換えが必要になる）。図鑑・依頼・実績・拠点を `meta.json` に束ねる（4 ストアの読み書きを結合し直す必要があり、1 ファイルの破損が 4 つを道連れにする）。リプレイを `replays/*.json` に分ける（`replayStore.ts` の「容量超過なら古いものから捨てる」ロジックを書き直すことになる。10 件で数百 KB なので 1 ファイルで足りる。肥大化したら後で分ける）

## 1. 現状の観察（根拠）

### 1.1 永続化の入口は 10 キー・8 ファイル、全部同じ形

| キー | 読み書き | `defaultStorage()` の複製 |
| --- | --- | --- |
| `roguelike.profile.v1` | `src/loot/profile.ts:276,305` | `:267` |
| `roguelike.skills.v1` | `src/skills/persistence.ts:192,218` | `:183` |
| `roguelike.craft.v1` | `src/loot/craftingStore.ts:79,94` | `:61` |
| `roguelike.settings.v1`（キー設定を内包） | `src/ui/settings.ts:50,78` | `:42` |
| `roguelike.replays.v1` | `src/ui/replayStore.ts:19,59` | `:10` |
| `roguelike.codex.v1` / `quests.v1` / `achievements.v1` / `hub.v1` | `src/meta/{codexStore,questStore,achievements,hubStore}.ts` → `src/meta/storage.ts:47,60` | `src/meta/storage.ts:38` |

- すべて `storage?: Storage` を省略可で受け、省略時に `defaultStorage()`（`localStorage` が無い / 触れないなら `null`）へ落ちる。テストは 14 ファイルが `MemoryStorage`（`src/meta/testStorage.ts` など）を明示的に渡している
- 各ストアは自前で `version` を持ち、壊れたデータを既定へ落とす（`parseXxxSave` / `sanitize*`）。**ファイル化してもこの層は触らない**（中身の版管理はストアの責務のまま）

### 1.2 「step の中では localStorage に触らない」は実際には破られている

`saveProfile` / `saveSkillProfile` が step 内から呼ばれている: `src/system/loot.ts:246,261,293`（拾得）、`src/system/combat.ts:524`（`recordRunOnce`）、`src/loot/provenance.ts:383`（節目）、`src/skills/wear.ts:51`、`src/system/skills.ts:2037,2136`、`src/ui/inventory.ts:238,352,383,405`、`src/ui/echoTab.ts:366,367`。

→ 設計上の含意: **`setItem` は同期で安価でなければならない**（1 フレーム中に複数回呼ばれ得る）。ファイル書き込みは必ずメモリ上の dirty フラグと遅延 flush で吸収する。同期 IPC で毎回ディスクに書く設計は不可。

### 1.3 リプレイ再生中の書き込み抑止は `Storage.prototype` へのモンキーパッチ

`src/core/replay.ts:682-694` の `guardStorageWrites` は `Storage.prototype.setItem` を差し替える。`FileStorage` は `Storage.prototype` を継承しないので、**このままだと Electron でリプレイを再生すると本物のプロフィールが上書きされる**。ガードは backend 層のフラグに移す（2.1）。

### 1.4 main.ts の読み込みはモジュール評価時に走る

`src/main.ts:183-190` で `loadProfile()` などがトップレベルで呼ばれる。backend の差し替えは **main.ts の最初の import より前**に終わっていなければならない。ESM の import は宣言順に評価されるので、`main.ts` の先頭に `import "./save/bootstrap";` を置けば足りる（他モジュールにトップレベルの `load*()` 呼び出しは無い。`grep "^const .* = load"` で `main.ts` のみ）。

### 1.5 ウィンドウ・入力・音声

- 描画は `src/render/renderer.ts:605-620` が `resize` で `computeViewScale`（`src/render/renderMath.ts:269`）により **整数倍のみ**でフィットする。Electron 側でウィンドウサイズを 480x270 の整数倍にすれば黒帯無し、フルスクリーンでもそのまま動く
- ポインタロック・`requestFullscreen` は使っていない（`grep` 該当なし）。マウス照準は座標を読むだけ
- 音声は `src/audio/sfx.ts:1337` の `unlock()` を `keydown` / `mousedown` で呼ぶ（`src/main.ts:221-224`）。Electron では autoplay ポリシーを緩めれば最初の操作前から鳴らせるが、今の仕組みでも問題なく動く
- ゲームパッドは `navigator.getGamepads` で Chromium の標準 API。Electron で追加設定なし
- `dist/index.html` の asset は絶対パス（`/assets/...`、`/fonts/...`）。`file://` で開くと 404 になる → 4.2

## 2. 保存の抽象層（src 側）

### 2.1 `src/save/backend.ts`（新規）

```ts
/** 保存先。ブラウザ版は localStorage、Electron 版は bootstrap が FileStorage を差し込む。無い環境（テスト）は null */
export function setSaveStorage(storage: Storage | null): void;
export function saveStorage(): Storage | null;   // 差し込み済みならそれ、無ければ localStorage（触れなければ null）
/** リプレイ再生中の書き込み抑止。戻り値で解除 */
export function guardSaveWrites(keys: readonly string[]): () => void;
```

- `saveStorage()` が返すのは `GuardedStorage`（`Storage` を包み、`setItem` で `blocked` 集合を見る薄いラッパ）。これで `guardSaveWrites` が localStorage / FileStorage の両方に効く
- 7 つの `defaultStorage()` を消し `saveStorage()` に置換（各ストアは 3〜5 行の Edit）。`src/meta/storage.ts` の `defaultStorage` は re-export にして残してもよい
- `src/core/replay.ts` の `guardStorageWrites` は中身を `guardSaveWrites(keys)` への委譲にする（名前と `GUARDED_STORAGE_KEYS` は据え置き、`src/main.ts:720` は無変更）

### 2.2 `src/save/bridge.ts`（新規。preload と renderer が共有する契約）

```ts
/** preload が contextBridge で window.electronSave に載せる。ブラウザ版では undefined */
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
declare global { interface Window { electronSave?: SaveBridge } }
```

### 2.3 `src/save/fileStorage.ts`（新規）

```ts
export const FLUSH_DELAY_MS = 300;
export type Scheduler = (fn: () => void, ms: number) => void;
export class FileStorage implements Storage {
  constructor(bridge: SaveBridge, initial: Record<string, string>, schedule: Scheduler = (fn, ms) => { setTimeout(fn, ms); });
  // Storage: length / key / getItem / setItem / removeItem / clear
  /** dirty なキーを bridge.write へ。テストから直接呼ぶ */
  flush(): Promise<void>;
  /** pagehide / beforeunload から。dirty が残っていれば writeAllSync */
  flushSync(): void;
}
```

- `setItem` は Map 更新 + dirty 追加 + 未予約なら `schedule(flush, FLUSH_DELAY_MS)`。1 フレーム内の複数回書き込みは 1 回の IPC に潰れる
- `clear()` は全キー remove（実装するが呼び出し元は無い）
- `flush` 中に来た `setItem` は次回に持ち越す（dirty 集合を flush 開始時に取り出して空にする）

### 2.4 `src/save/fileEnvelope.ts`（新規。**node / electron を import しない純関数**。main プロセスからも使う）

```ts
export const SAVE_FILE_FORMAT = 1;
/** localStorage キー → save/ 配下のファイル名。ここに無いキーは main が拒否する */
export const SAVE_FILES: Readonly<Record<string, string>> = {
  "roguelike.profile.v1": "profile.json",
  "roguelike.skills.v1": "skills.json",
  "roguelike.craft.v1": "craft.json",
  "roguelike.settings.v1": "settings.json",
  "roguelike.keybinds.v1": "keybinds.json",
  "roguelike.replays.v1": "replays.json",
  "roguelike.codex.v1": "codex.json",
  "roguelike.quests.v1": "quests.json",
  "roguelike.achievements.v1": "achievements.json",
  "roguelike.hub.v1": "hub.json",
};
export interface SaveEnvelope { format: typeof SAVE_FILE_FORMAT; key: string; savedAt: number; app: string; data: unknown }
/** ストアの JSON 文字列を封筒に包んだファイル本文（2 スペース整形。人が読める・diff できる） */
export function encodeEnvelope(key: string, json: string, savedAt: number, app: string): string;
/** ファイル本文 → ストアに渡す JSON 文字列。壊れている・key 不一致・未知 format なら null */
export function decodeEnvelope(text: string, key: string): string | null;
export function fileForKey(key: string): string | null;
```

- 封筒の `format` はファイル形式の版。**中身の版はこれまで通りストアのキー末尾 `.v1` と `version` フィールド**が担う（キーを `.v2` に切ればファイル名も `SAVE_FILES` で新しくする。旧ファイルは残るが読まれない）
- `app` は `src/version.ts` の `APP_VERSION_SEMVER`。今は読まないが、将来の Steam Cloud の衝突時や不具合報告で役に立つ

### 2.5 `src/save/bootstrap.ts`（新規。副作用のみ）

```ts
import { setSaveStorage } from "./backend";
import { FileStorage } from "./fileStorage";
import { migrateFromLocalStorage } from "./migrate";
const bridge = window.electronSave;
if (bridge) {
  const storage = new FileStorage(bridge, bridge.readAll());
  migrateFromLocalStorage(storage, localStorageOrNull());   // save/ が空で localStorage に roguelike.* があれば写す（3 章）
  window.addEventListener("pagehide", () => storage.flushSync());
  setSaveStorage(storage);
}
```

`src/main.ts` の変更は **1 行**: 先頭に `import "./save/bootstrap";`。

### 2.6 キー設定の分離（`src/ui/settings.ts`）

- `export const KEYBINDS_KEY = "roguelike.keybinds.v1"`。`Settings` 型（`keybinds` フィールド）は据え置き（`main.ts` の `settings.keybinds` 参照を変えないため）
- `saveSettings`: `SETTINGS_KEY` には `{ version, muted, volume, musicVolume, screenShake }`（`keybinds` を含めない）、`KEYBINDS_KEY` には `{ version: 1, keybinds }` を書く
- `loadSettings`: `KEYBINDS_KEY` があれば `sanitizeKeybinds(parsed.keybinds)`、無ければ旧 `settings.keybinds` を読む（既存の後方互換。次の保存で分離される）
- `docs/ARCHITECTURE.md` の永続化キー表に `roguelike.keybinds.v1` の行を足し、`settings.v1` の説明から「キー設定」を外す

## 3. 初回起動時の移行

**前提の訂正**: Electron の renderer は Chrome のプロファイルを共有しない（Electron は `userData` 配下に独自の Chromium プロファイルを持つ）。「同じ origin なら読める」は成り立たず、ユーザーが Chrome の `localhost:5173` で遊んだデータは Electron からは見えない。したがって移行は 2 段構え。

1. **Electron 内の localStorage → ファイル**（`src/save/migrate.ts`、純関数 `migrateFromLocalStorage(target: Storage, source: Storage | null): string[]`）: `SAVE_FILES` のキーがファイル側に 1 つも無く、`source` に `roguelike.*` があれば全部写して flush。`electron:dev`（`http://localhost:5173` パーティション）で遊んだ分と、`app://game` に切り替える前の試作分が対象。写した後は source を消さない（安全側）
2. **Chrome → Electron は「取り込みファイル」方式**（UI 不要、main プロセスだけで完結）: `userData/save/import.json` が存在すれば起動時に読み、`{ format: 1, entries: Record<key, string> }` の既知キーだけをファイルへ書き、`import.done-<epoch>.json` に改名する。Chrome 側では DevTools コンソールで `copy(JSON.stringify({ format: 1, entries: { ...localStorage } }))` して貼り付ける。**設定画面の「書き出す / 読み込む / セーブフォルダを開く」は後続レーン（6.3）**

## 4. Electron の構成

### 4.1 ファイルとビルド

```
electron/
  main.ts                 app 初期化・userData の固定・app:// 配信・ウィンドウ・IPC の登録
  preload.ts              contextBridge.exposeInMainWorld("electronSave", …)。sandbox 用に CJS で出力
  saveStore.ts            ファイル I/O（readAll / write / remove / import.json）。fs と path だけに依存。テスト可
  window.ts               初期サイズ（480x270 の最大整数倍）・フルスクリーン切替・位置の記憶（userData/window.json。save/ の外）
  vite.main.config.ts     lib: { entry: main.ts, formats: ["es"] } → dist-electron/main.js。external: electron, node:*
  vite.preload.config.ts  lib: { entry: preload.ts, formats: ["cjs"] } → dist-electron/preload.cjs
tsconfig.electron.json    module ESNext / moduleResolution bundler / lib ES2022+DOM / types ["node"] / include electron/** と src/save/{bridge,fileEnvelope}.ts
electron-builder.yml      productName DEPTHBREAKER / files: dist/**, dist-electron/**, package.json / win.target: dir（Steam 用の展開済みフォルダ）/ asar: true / directories.output: release
scripts/electron-dev.mjs  Vite の JS API で dev サーバを起動 → 2 つの lib ビルド → electron を VITE_DEV_SERVER_URL 付きで spawn
scripts/electron-build.mjs  vite build → 2 つの lib ビルド → electron-builder --dir
```

- `package.json`: `"main": "dist-electron/main.js"`、scripts に `electron:dev` / `electron:build`、devDependencies に `electron` / `electron-builder` / `@types/node`。**`dependencies` は作らない**（「ランタイム依存なし」は維持。実行時に必要なのは Electron 本体だけ）
- `scripts/check.mjs` の `STEPS` に `{ label: "tsc (electron)", entry: bin("typescript/bin/tsc"), args: ["-p", "tsconfig.electron.json", "--noEmit"] }` を 1 件足す（`electron/` の型検査も `npm run check` に含める）。`vitest run` は `electron/saveStore.test.ts` も既定 include で拾う
- `.gitignore` に `dist-electron` / `release`
- vite-plugin-electron を使わない理由: プラグイン 1 つ増える割に、やることは「2 つのエントリを束ねて electron を起動する」だけで、既にある Vite のライブラリモードで足りる。Vite 8（rolldown）との相性を追いかける手間も減る
- preload を CJS にする理由: `sandbox: true` の preload は ESM 非対応（Electron の制約）。root `package.json` が `"type": "module"` なので出力名を `.cjs` にする
- `tsconfig.electron.json` を分ける理由: root の `tsconfig.json` は `include: ["src"]` で `types: ["vite/client"]`。node の型と混ぜたくない。共有するのは `src/save/bridge.ts`（型のみ）と `src/save/fileEnvelope.ts`（純関数）だけ。electron 側は `verbatimModuleSyntax` を root と同じく有効にしてよい（出力は Vite が作るので tsc は `noEmit`）

### 4.2 renderer の配信は `app://` カスタムスキーム

- `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }])` を `ready` 前に、`protocol.handle("app", …)` を `ready` 後に登録し、`win.loadURL("app://game/index.html")`
- ハンドラ: URL のパスを `dist/` 配下に解決（`..` を含む・`dist` の外に出るパスは 404）、`net.fetch(pathToFileURL(file).toString())` の Response に `Content-Security-Policy` ヘッダを付けて返す。`dist` の場所はパッケージ後 `path.join(app.getAppPath(), "dist")`
- 理由: (1) `dist/index.html` の絶対パス（`/assets`、`/fonts`）がそのまま動き、Web 版のビルド設定（`base`）を触らない (2) origin が `app://game` で安定するので localStorage（移行元）や将来のキャッシュが `file://` の特殊扱いに巻き込まれない (3) CSP をヘッダで付けられる
- dev: `VITE_DEV_SERVER_URL` があれば `loadURL(そのURL)`。HMR がそのまま効く。CSP は dev では付けない

### 4.3 セキュリティ

- `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: <dist-electron/preload.cjs>, webSecurity: true }`
- CSP（app:// のレスポンスヘッダ）: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:`。`style-src 'unsafe-inline'` は `index.html` のインライン `<style>` のため（外部 CSS に出すなら外せる）
- `webContents.setWindowOpenHandler(() => ({ action: "deny" }))`、`will-navigate` で app:// と dev URL 以外を拒否
- IPC は `SAVE_FILES` の既知キーだけ受け付ける（キー = ファイル名の写像を main が持つので、renderer から任意パスを書かせない）。`ipcMain.handle` の引数は `typeof key === "string"` を検証
- `autoHideMenuBar: true`、メニューは無し（Ctrl+R のリロードと F12 の DevTools は dev のみ `before-input-event` で許可）

### 4.4 ウィンドウ・フルスクリーン・入力・音声

- 初期サイズ: `screen.getPrimaryDisplay().workAreaSize` に収まる最大の整数 k で `useContentSize: true, width: 480k, height: 270k`（`minWidth: 480, minHeight: 270`、`backgroundColor: "#000"`）。前回の bounds を `userData/window.json` に記憶（`save/` の外に置くのは Steam Cloud に同期させないため）
- フルスクリーン: `webContents.on("before-input-event")` で F11 / Alt+Enter を拾って `win.setFullScreen(!win.isFullScreen())`（renderer 側の `src/core/input.ts` は変えない。`event.preventDefault()` で renderer に渡さない）。フィットは `renderer.ts` の `resize` ハンドラが担う
- ポインタロック: 不要（使っていない）。フルスクリーン時にマウスが隣のモニタへ出るのが気になれば後で `kiosk` を検討
- ゲームパッド: 追加なし
- 音声: `app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")` を `ready` 前に。既存の `unlock()` は残す（Web 版のため）
- DPR: Windows の拡大率が 125% などのとき `computeViewScale` が `cssScale * dpr` でキャンバスを作るので、`useContentSize`（CSS px 基準）の整数倍指定と両立する（`src/render/renderer.ts:613`）

### 4.5 userData と Steam の準備

- **`app.setPath("userData", path.join(app.getPath("appData"), "DEPTHBREAKER"))` を `ready` 前に必ず呼ぶ**。既定は dev では `package.json` の `name`（`roguelike`）、パッケージ後は `productName` になり、**dev とリリースでセーブの場所が変わってしまう**ため
- 保存先: `%APPDATA%\DEPTHBREAKER\save\*.json`（`profile.json` …）。バックアップ `*.json.bak`、書き込み途中 `*.json.tmp`、読めなかったファイルは `*.json.corrupt-<epoch>` に改名して保全
- Steam Cloud（Auto-Cloud）はルート `WinAppDataRoaming` + パス `DEPTHBREAKER/save` + パターン `*.json` で今の構成がそのまま使える。`window.json` は `save/` の外なので同期されない。`settings.json` / `keybinds.json` も `save/` に置く（同期させたくなければ Steam 側のパターンで除外）
- Steamworks（`steamworks.js` などの native module）は main プロセスに入れる想定。renderer は `sandbox: true` のままでよい。今は入れない
- 配布物: `electron-builder --dir` の `release/win-unpacked/` を Steam にそのまま上げられる。インストーラ（nsis）が要るのは Steam 外で配る場合だけ

### 4.6 main プロセスの書き込み手順（`electron/saveStore.ts`）

```
write(key, value):
  file = save/<SAVE_FILES[key]>            未知キーなら Error
  text = encodeEnvelope(key, value, Date.now(), APP_VERSION_SEMVER)
  writeFileSync(file + ".tmp", text)
  if exists(file): renameSync(file, file + ".bak")    // 旧版を退避（1 世代）
  renameSync(file + ".tmp", file)                     // 同一ボリューム内の rename は原子的
readAll():
  for key of SAVE_FILES: text = read(file) ?? read(file + ".bak")
    decodeEnvelope(text, key) が null なら file を .corrupt-<epoch> に改名し、.bak を試す
  return { key: json }（読めたものだけ）
```

- 直列化: `write` は `ipcMain.handle` の中で同期 fs を使う（ファイルは小さく、renderer 側が 300ms で潰しているので十分）。同じキーの同時書き込みは起きない
- `readAll` は `ipcMain.on` + `event.returnValue`（sendSync）。起動時の 1 回だけ

## 5. データの流れ（変更後）

```
ブラウザ版:  ストア ── saveStorage() ──> GuardedStorage(localStorage)
Electron 版: ストア ── saveStorage() ──> GuardedStorage(FileStorage) ─(300ms 遅延 invoke)─> preload ─> ipcMain ─> saveStore.write ─> save/*.json
                                                  ▲ 起動時 readAll(sendSync) で全キーをメモリへ
テスト:      ストア(storage を明示) ──> MemoryStorage（変更なし）
```

不変条件 8 の文言は「localStorage は…経由のみ」から「保存先は `src/save/backend.ts` の `saveStorage()` 経由のみ（ブラウザは localStorage、Electron はセーブファイル）」に書き換える（`CLAUDE.md` は統合役が編集）。

## 6. 実装レーン

### 6.1 レーン A（Sonnet implementer）: 保存の抽象層と `src/save/`

- 所有ファイル（新規）: `src/save/backend.ts`、`src/save/bridge.ts`、`src/save/fileStorage.ts`、`src/save/fileEnvelope.ts`、`src/save/migrate.ts`、`src/save/bootstrap.ts`、`src/save/backend.test.ts`、`src/save/fileStorage.test.ts`、`src/save/fileEnvelope.test.ts`、`src/save/migrate.test.ts`
- 最小 Edit のみ: `src/loot/profile.ts`、`src/loot/craftingStore.ts`、`src/skills/persistence.ts`、`src/ui/settings.ts`（キー設定分離を含む）、`src/ui/replayStore.ts`、`src/meta/storage.ts`（各: `defaultStorage()` を削除し `saveStorage()` を import）、`src/core/replay.ts`（`guardStorageWrites` の中身を `guardSaveWrites` へ委譲）、`src/main.ts`（先頭に `import "./save/bootstrap";` の 1 行）、`docs/ARCHITECTURE.md`（永続化キー表）
- 編集禁止: `electron/**`、`package.json`、`scripts/**`
- 先に読むもの: この文書の 1〜3 章、`src/meta/storage.ts`、`src/ui/settings.ts`、`src/core/replay.ts:670-694`、`src/ui/settings.test.ts`
- 追加する公開 API: 2.1〜2.5 のシグネチャどおり。`FileStorage` のコンストラクタは `schedule` を注入可能にする（テストで即時実行に差し替える）
- テスト（`it` 名）:
  - backend: 「setSaveStorage で差し込んだ保存先を saveStorage が返す」「guardSaveWrites の間は指定キーへの setItem が捨てられ、解除後は書ける」「ガードは指定していないキーには効かない」
  - fileStorage: 「初期値を getItem で読める」「setItem の直後は bridge.write が呼ばれず、flush でキーごとに 1 回だけ呼ばれる」「同じキーへの連続 setItem は 1 回の write に潰れる」「flushSync は dirty なキーだけを writeAllSync に渡す」「removeItem は bridge.remove を呼ぶ」
  - fileEnvelope: 「encode → decode で JSON 文字列が往復する」「key が一致しない封筒は null」「format が未知なら null」「壊れた JSON は null」「SAVE_FILES のキー集合が各ストアの *_KEY 定数の集合と一致する」（`PROFILE_KEY` / `SKILL_PROFILE_KEY` / `CRAFT_KEY` / `SETTINGS_KEY` / `KEYBINDS_KEY` / `REPLAY_STORE_KEY` / `CODEX_KEY` / `QUEST_KEY` / `ACHIEVEMENTS_KEY` / `HUB_KEY` を import して比較。キーを増やしたときの追加漏れをここで止める）
  - migrate: 「ファイル側が空で localStorage に roguelike.* があれば写す」「ファイル側に 1 つでもあれば何もしない」「source が null なら何もしない」
  - settings（既存ファイルに追記）: 「キー設定は roguelike.keybinds.v1 に別保存され settings 側には含まれない」「旧 settings に埋め込まれたキー設定を keybinds キーが無いときだけ読む」
  - replay（既存 `src/core/replay.test.ts` に追記）: 「guardStorageWrites は setSaveStorage で差し込んだ MemoryStorage にも効く」
- 完了条件: `npm run check` 成功。既存の 14 テストファイル（`MemoryStorage` を渡すもの）を変更していない。`grep -rn "localStorage" src --include=*.ts | grep -v test | grep -v src/save/` が `core/replay.ts` のコメント以外ヒットしない

### 6.2 レーン B（Sonnet implementer）: Electron 本体とビルド

- 所有ファイル（新規）: `electron/main.ts`、`electron/preload.ts`、`electron/saveStore.ts`、`electron/saveStore.test.ts`、`electron/window.ts`、`electron/vite.main.config.ts`、`electron/vite.preload.config.ts`、`tsconfig.electron.json`、`electron-builder.yml`、`scripts/electron-dev.mjs`、`scripts/electron-build.mjs`
- 最小 Edit のみ: `package.json`（`main`、scripts 2 つ、devDependencies 3 つ）、`.gitignore`（2 行）、`scripts/check.mjs`（STEPS に electron の tsc を 1 件追加）
- 編集禁止: `src/**`（`src/save/bridge.ts` と `src/save/fileEnvelope.ts` は import するだけ）。**レーン A の 2.2 / 2.4 のファイルが先に要る**。A を先に走らせるか、A に「まず 2.2 / 2.4 を作ってコミット可能な状態にする」よう指示してから B を並走させる
- 先に読むもの: この文書の 4 章、`src/render/renderer.ts:600-625`、`scripts/check.mjs`、`index.html`
- 追加する npm パッケージ（`npm view <pkg> version` で確認してから入れる。2026-09-24 時点の最新: electron 44.4.5、electron-builder 26.15.3）: `electron` ^44、`electron-builder` ^26、`@types/node`（Electron 44 が同梱する Node の major に合わせる。`npx electron -e "console.log(process.versions.node)"` で確認）。すべて `-D`。`ELECTRON_SKIP_BINARY_DOWNLOAD=1` なら本体を落とさず型検査だけできる
- 追加する公開関数（`electron/saveStore.ts`。fs と path だけに依存、Electron を import しない）:
  ```ts
  export interface SaveStore {
    readAll(): Record<string, string>;
    write(key: string, value: string): void;
    remove(key: string): void;
    /** save/import.json を取り込み、写したキーを返す。無ければ [] */
    consumeImportFile(): string[];
  }
  export function createSaveStore(dir: string, app: string, now: () => number): SaveStore;
  ```
- IPC チャネル名（preload と main で共有する定数を `electron/ipc.ts` に置く）: `save:readAll`（sendSync）/ `save:write` / `save:remove`（invoke）/ `save:writeAllSync`（sendSync）/ `save:openFolder`（invoke）
- テスト（`electron/saveStore.test.ts`。`os.tmpdir()` 配下に一時ディレクトリを作って実施）: 「write したキーを readAll で読み戻せる」「write は前の版を .bak に残す」「本体が壊れていれば .bak から読み、本体を .corrupt-* に改名する」「未知のキーは write で例外」「import.json があれば取り込んで import.done-* に改名する」「save/ が無ければ作る」
- 完了条件: `npm run check` 成功（electron の tsc ステップを含む）。`npm run electron:dev` でウィンドウが開き、装備を拾って 1 秒後に `%APPDATA%\DEPTHBREAKER\save\profile.json` が更新される。`npm run electron:build` で `release/win-unpacked/DEPTHBREAKER.exe` が起動し、同じ save/ を読む。F11 でフルスクリーン、ウィンドウを閉じて再起動しても装備が残る

### 6.3 レーン C（後続・任意）: 設定画面の「セーブデータを書き出す / 読み込む / セーブフォルダを開く」

- ブラウザ版は Blob のダウンロードと `<input type="file">`、Electron 版は `dialog.showSaveDialog` / `showOpenDialog` / `shell.openPath` を `SaveBridge` に足す
- `src/main.ts` の settings 画面（`:1106` 付近）に行を足すので main.ts の Edit が大きめ。3 章の `import.json` 方式で当面は足りるので、A / B が落ち着いてから

## 7. 不確かな点と確かめ方

1. **`sandbox: true` の preload で `ipcRenderer.sendSync` が使えるか**: 使える想定（sandbox 下でも `electron` の `contextBridge` / `ipcRenderer` は require 可）。`electron:dev` の DevTools コンソールで `window.electronSave.readAll()` が返ることを確認
2. **`sendSync` の起動時コストと Steam Cloud 同期直後の読み込み**: 10 ファイル合計 1MB 未満の想定。`readAll` に `console.time` を仕込み 50ms を超えないことを見る
3. **`renameSync` の上書き**: Windows でも Node の `fs.rename` は既存ファイルを置き換える（`MoveFileEx` + `REPLACE_EXISTING`）。ただし対象がウイルス対策ソフトにロックされていると `EPERM` になり得る → `write` は `EPERM` / `EBUSY` を 3 回まで 20ms 間隔で再試行し、それでも駄目なら `.tmp` を残して `console.warn`（データ消失にはしない）。テストで再現できないので手で確認（save/ を Defender の監視対象のまま連続で拾得して様子を見る）
4. **`pagehide` での `writeAllSync`**: ウィンドウの閉じるボタンでの終了は `pagehide` が走るが、`app.quit()` を main 側から呼ぶ経路（将来メニューを付けたとき）は `win.close()` を経由させること。強制終了（タスクマネージャ）では最大 300ms 分が失われるのは許容
5. **Vite 8 のライブラリモードで CJS 出力（preload）**: rolldown ベースでも `formats: ["cjs"]` は対応しているはず。ビルド後に `dist-electron/preload.cjs` の先頭が `"use strict"; const electron = require("electron")` になっていることを確認。駄目なら preload だけ `tsc -p` で `preload.cts` → `.cjs` に落とす
6. **`app://` で `image-rendering: pixelated` と DotGothic16 の読み込み**: `protocol.handle` の Response に `Content-Type` が正しく付くか（`net.fetch(file URL)` は拡張子から付ける）。フォントが出なければ `.ttf` に `font/ttf` を明示
7. **DPR 125% 環境での整数倍**: `useContentSize` は CSS px 基準なので、`computeViewScale` の `cssScale` が意図した k になるかを 125% の Windows で `renderer.ts:613` の値を DevTools で確認
8. **Electron の localStorage からの移行（3 章 1）が dev で二重に走らないか**: `migrateFromLocalStorage` は「ファイル側が空」条件で 1 回だけ。2 回目の起動で何も起きないことを `save/` の更新時刻で確認
9. **`@types/node` と Vite 8 の型の衝突**: root `tsconfig.json` は `types: ["vite/client"]` のままなので `src/` には node 型が入らない。`tsconfig.electron.json` 側で `src/save/bridge.ts` を include したとき `declare global { interface Window … }` が DOM lib を要求する → electron 側の `lib` にも `DOM` を入れる（preload は renderer 文脈なので問題ない）
10. **`npm install electron` の本体ダウンロード**: 100MB 超をミラーから落とす。会社プロキシ等で失敗したら `ELECTRON_MIRROR` を設定。`npm run check` 自体は本体無しでも通る（型だけ）
