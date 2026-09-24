# 拠点（ハブ）の設計

作成日: 2026-09-24
前提: `docs/ideas/meta-and-weapons.md` 3 章、`docs/DESIGN_PRINCIPLES.md`、`src/main.ts`、`src/meta/**`、`src/loot/profile.ts`、`src/loot/craftingStore.ts`、`src/ui/echoTab.ts`、`src/skills/persistence.ts`、`src/system/runSetup.ts`、`src/core/state.ts`、`src/core/game.ts` を読んだ。

## 1. 結論

**歩ける拠点にする。** 拠点を「敵のいない固定マップの GameState」として作る。装備画面・残響・スキル・芽の UI と描画はどれも GameState を受け取る作りなので、拠点用の state を渡すだけで鍛冶場・図書館・庭が成り立つ。訓練場の木人も既存のものを使える。決定性とリプレイは、拠点をランの記録の外に置くことで守る。記録はこれまでどおり beginRun の後に始まる。

## 2. 根拠（行番号付き）

- **装備 UI は GameState 前提。** `src/ui/inventory.ts:435` の updateInventoryUi と `src/ui/echoTab.ts:235` の layoutEcho などは GameState を受け取る。芽の 2 択も同じで、`src/ui/inventory.ts:468` の updateBudFlow と `src/ui/bud.ts:67` の tryOpenBudModal が GameState を読む。メニュー型にすると、これらを GameState 抜きで動くよう分離する改修が要る。
- **描画はそのまま使える。** `src/render/renderer.ts:645` の render(state) がマップ・プレイヤー・敵を描く。拠点で要る手当ては 3 か所だけ。
  - `src/render/renderer.ts:689` のフロアカード
  - `src/render/renderer.ts:2105` 付近の「地下 N 階」表示
  - 同じ HUD 内のミニマップ
- **木人は既にある。** `src/data/enemies.ts:581` の trainingDummy は動かず、殴り返さない。`src/system/specialRooms.ts:355-366` は `revived = true` を付けて置いている。そのため `src/system/combat.ts:254,271` により、撃破数とドロップに数えられない。
- **誓約の試し打ちは既存の関数で済む。** state.runKeystones を差し替え、`src/system/runSetup.ts:223` の refreshRunStats を呼ぶだけでよい。畳み込みは `src/system/runSetup.ts:198-220` の applyRunStats が行う。排他グループの処理も既にある。
- **決定性は拠点の外で保たれる。** ランは `src/main.ts:183-186` で createGame(hashSeed(seed)...) を通って始まる。記録器は `src/main.ts:344-353` の beginRun の中で、createGame の直後に `src/core/replay.ts:495` の fromStartedGame を呼ぶ。拠点での装備変更はそれより前に起きるので、スナップショットに正しく入る。
- **createGame は流用できない。** `src/core/game.ts:52` が profile.meta.runs を 1 増やし、`src/core/game.ts:127` でフロアを作る。拠点専用の createHub が必要。
- **拠点の中の戦闘が永続データへ書く経路が 4 つある。** どれもガードが要る。
  - 来歴: 全イベントが `src/loot/provenance.ts:354` の recordProvenance を通る。呼び出し元は `src/system/traitHooks.ts:493`（怯み）や `src/system/combat.ts:539`（JUST）など。放置すると木人を叩いて芽を育てられる。
  - スキル石の使い込み: `src/skills/wear.ts:31` の noteWearHit と `src/skills/wear.ts:38` の noteWearCast が数を増やし、芽を出して保存する。
  - ラン記録: `src/system/combat.ts:495-518` の killPlayer と recordRunOnce。
  - ドロップ: `src/system/loot.ts:89` の rollEnemyDrop。木人では `revived` が効くが、念のためガードする。
- **やり直しの経路は既にある。** `src/main.ts:135-148` の Screen、`src/main.ts:291-331` の起点画面、`src/main.ts:406-440` の依頼の 3 択、`src/main.ts:466-499` の一覧画面、`src/main.ts:513` の履歴は、どれも「Esc でタイトルへ」戻る。戻り先を変数にすれば拠点から開ける。
- **スキル石は同じオブジェクトを共有する。** `src/system/skills.ts:198` の createSkillRunState は skillProfile を複製しない。拠点で付け替えた石はそのまま次のランに入る。
- **設計文書と原則に合う。** `docs/ideas/meta-and-weapons.md:74` が「1 部屋を歩く、Enter 長押しで即出撃、拠点はリプレイに記録しない」と決めている。`docs/DESIGN_PRINCIPLES.md:22` は単一指標を禁じている。そのため訓練場は数字を出さず、怯みの成立だけを見せる。

## 3. 設計の要点

- **流れ。** タイトルで Enter を押すと拠点に入る。井戸を使うと、ジョブ・起点・縛りの画面から依頼の 3 択を経てランが始まる。死亡画面で T を押したときと、ポーズの「タイトルへ」は、拠点に戻す。拠点で Esc を押すとタイトルへ戻る。
- **即出撃。** 決定キーを長押しすると、前回の runSetup と保存中の依頼のまま beginRun を呼ぶ。
- **Tab は拠点でもどこでも使える。** 設備は「その画面を開く近道」とし、基本機能を歩きに閉じ込めない。これでメニュー型の速さも保てる。
- **サンドボックス印。** GameState に任意項目 `sandbox?: true` を足す。拠点の state だけが持ち、4 経路のガードはこの印で早期リターンする。任意項目なので、createGame の state 生成は変えなくて済む。
- **設備の配線。**

| 設備 | 開くもの |
| --- | --- |
| 鍛冶場 | 装備画面の残響タブ |
| 図書館 | 装備画面のスキルタブ |
| 庭 | 装備タブと芽の 2 択。種の仕組み（meta-and-weapons.md 3-6）は後回し |
| 祭壇 | 既存の一覧画面の部品で全誓約を並べ、選んだものを試す印にする。拠点を出ると消える |
| 訓練場 | 設備でなく、木人 3 体が立つ区画。倒れた木人は一定時間後に立て直す |
| 記録室 | 3 つの台が、履歴とリプレイ、図鑑、実績を開く |
| 掲示板 | 依頼の一覧 |
| 井戸 | ジョブ・起点・縛りの画面へ進む |

- **拠点を育てる。** 保存値は増やさず、既存の保存データから導く。強さは一切増えない。
  - 最初から建っているのは、井戸・掲示板・鍛冶場・記録室。
  - 図書館は、スキル石を 1 つ以上持つと建つ。
  - 訓練場は、試し場（codex.roomKinds の "dummyHall"）に出会うか、3 ラン遊ぶと建つ。
  - 祭壇は、ランで祭壇の部屋（codex.roomKinds の "altar"）に出会うと建つ。
  - 庭は、芽を 1 度でも持つと建つ。
  - 飾りも導出する。ボスを倒すと記念品、図鑑が埋まると記録室の書架が伸びる。名乗っている称号は看板に出る。
  - 新しい保存キー `roguelike.hub.v1` に持つのは、「建った」演出を 1 回だけ見せるための既読リストだけ。
- **リプレイ。** 拠点は記録しない。拠点の state は main.ts の `state` 変数に入れない。

## 4. 実装レーン（3 本）

各レーンの最後は `npm run check`。Agent はコミットしない。共有ファイルは最小の Edit のみ。

### レーン A: 拠点のシミュレーション

**所有ファイル（新規）**

- `src/system/hub.ts`
- `src/map/hubMap.ts`
- `src/system/hub.test.ts`

**最小の Edit だけ入れる共有ファイル**

- `src/core/state.ts`: GameState に次を足す。

```ts
  /** 拠点の state。来歴・石の使い込み・ラン記録・ドロップへ書かない（src/system/hub.ts） */
  sandbox?: true;
```

- `src/loot/provenance.ts:354`: recordProvenance の先頭で `if (state.sandbox) return;`。
- `src/skills/wear.ts`: noteWearHit と noteWearCast の先頭に同じ早期リターン。
- `src/system/combat.ts`: killPlayer の先頭で、sandbox なら HP を満タンに戻して return。recordRunOnce の先頭でも sandbox なら return。
- `src/system/loot.ts:89`: rollEnemyDrop の先頭に同じ早期リターン。
- `src/data/tuning.ts`: 末尾に次の定数を追加する。

```ts
/** 拠点（src/system/hub.ts / src/meta/hub.ts） */
export const HUB = {
  /** 台に「近い」とみなす距離（px） */
  interactRadius: 20,
  /** 決定キーの長押しで即出撃するまでの秒 */
  departHold: 0.8,
  /** 倒れた木人が立ち直るまでの秒 */
  dummyRespawn: 1.5,
  /** 訓練場の木人の数 */
  dummyCount: 3,
  /** 訓練場が建つ通算ラン数（試し場に出会っていなくても） */
  trainingRuns: 3,
  /** 拠点の state の乱数の種（ランには影響しない） */
  seed: 0x48554201,
} as const;
```

**追加する型と関数**

`src/map/hubMap.ts`:

```ts
export const HUB_SPOT_KEYS = ["well", "board", "forge", "library", "altar", "garden", "history", "codex", "achievements"] as const;
export type HubSpotKey = (typeof HUB_SPOT_KEYS)[number];

export interface HubLayout {
  map: GameMap;
  spots: Readonly<Record<HubSpotKey, Vec>>;
  dummySpots: readonly Vec[];
  playerStart: Vec;
}

/** 固定配置の拠点マップ。純関数で乱数を使わない */
export function buildHubMap(): HubLayout;
```

- マップは ASCII の固定配置から作る。30x17 タイル程度で、1 部屋を 1 つの rect にする。
- 台の文字（例: W=井戸、B=掲示板、F=鍛冶場、L=図書館、A=祭壇、G=庭、H/C/R=記録室の 3 台、D=木人、P=開始位置）から座標を拾う。

`src/system/hub.ts`:

```ts
export interface HubRun {
  layout: HubLayout;
  near: HubSpotKey | null;
  /** 決定キーを押し続けている秒 */
  departHold: number;
  trialKeystone: string | null;
  /** 木人ごとの立ち直りまでの残り秒（0 = 立っている） */
  dummyTimers: number[];
}

export interface HubSession {
  state: GameState;
  hub: HubRun;
}

export type HubAction =
  | { kind: "none" }
  | { kind: "open"; spot: HubSpotKey }
  | { kind: "depart" };

export function createHub(profile: Profile, skillProfile: SkillProfile, available: ReadonlySet<HubSpotKey>): HubSession;
export function stepHub(session: HubSession, input: FrameInput, dt: number): HubAction;
export function nearestSpot(session: HubSession): HubSpotKey | null;
export function setTrialKeystone(session: HubSession, key: string | null): void;
export function trialKeystoneKeys(): string[];
```

- **createHub** は createGame と同じ形の state を作る。違いは次のとおり。
  - sandbox を付ける。
  - meta.runs を増やさない。
  - HUB.seed を使う。
  - rooms を 1 つにして cleared = true にする。
  - resetExplored を呼ぶ。
  - buildFloor・startOrigin・startJob は呼ばない。
  - 木人は specialRooms と同じく DUMMY_KEY の敵を `revived = true` で置く。
  - available にない台は layout に残しても反応させない。
- **stepHub** は paused なら none を返す。呼ぶ順は tickMana → updatePlayer → updateStatusEffects → updateEnemies → updateProjectiles → updateHazards → updateEffects → updateCamera。そのあと次を行う。
  - 木人の立て直し: hp が 0 の木人を外し、HUB.dummyRespawn 秒後に同じ位置へ置き直す。
  - 近い台の判定: HUB.interactRadius 以内で一番近い使える台を near に入れる。
  - near があって interactPressed なら open を返す。
  - 決定キーを押し続けた秒が HUB.departHold に達したら depart を返す。
  - updateRooms・updateReaper・updateRunEvents・updateBoons・resolveRules は呼ばない。
- **setTrialKeystone** は runKeystones を `key ? [key] : []` に差し替えて refreshRunStats を呼ぶ。
- **trialKeystoneKeys** は KEYSTONES の全 key を返す。持っていない誓約も試せる。

**テスト（it 名）**

- 「createHub は profile.meta.runs を増やさない」
- 「拠点の state は sandbox を持ち、階段・死神を生成しない」
- 「拠点で木人を倒しても来歴が積もらない」
- 「拠点でスキルを撃っても石の使い込みが増えない」
- 「拠点で HP が尽きても死亡せずラン記録も書かない」
- 「木人は倒されると HUB.dummyRespawn 秒後に立ち直る」
- 「台の近くで interactPressed を押すと open を返す」
- 「使えない台では open を返さない」
- 「決定キーを HUB.departHold 秒押し続けると depart を返す」
- 「setTrialKeystone で誓約の数値効果が stats に入り、null で外れる」
- 「buildHubMap の台と木人の位置はすべて床タイル上にある」

**完了条件**

- npm run check が通る。
- 既存の `src/core/replay.test.ts` の結果が変わらない。

### レーン B: 拠点の成長・永続化・描画部品

**所有ファイル（新規）**

- `src/meta/hub.ts`
- `src/meta/hubStore.ts`
- `src/render/hubUi.ts`
- `src/meta/hub.test.ts`

**最小の Edit だけ入れる共有ファイル**

- `docs/GLOSSARY.md`: 拠点・井戸・掲示板・鍛冶場・図書館・祭壇・訓練場・記録室・庭・木人を登録する。

**追加する型と関数**

`src/meta/hub.ts`:

```ts
export const FACILITY_KEYS = ["well", "board", "forge", "archive", "library", "training", "altar", "garden"] as const;
export type FacilityKey = (typeof FACILITY_KEYS)[number];

export const FACILITY_NAME: Readonly<Record<FacilityKey, string>>;
/** history・codex・achievements は archive */
export const FACILITY_OF_SPOT: Readonly<Record<HubSpotKey, FacilityKey>>;

export interface HubProgressSource {
  runs: number;
  codex: CodexSave;
  stoneCount: number;
  hasBud: boolean;
  achievements: AchievementSave;
}

/** 建っている設備。既存の保存データから導く純関数で、stats には触れない */
export function builtFacilities(src: HubProgressSource): FacilityKey[];
/** 建っている設備に属する台。training は台を持たない */
export function availableSpots(built: readonly FacilityKey[]): Set<HubSpotKey>;

export interface HubDecor {
  key: string;
  label: string;
}
export function hubDecorations(src: HubProgressSource): HubDecor[];

/** まだ「建った」演出を見せていない設備 */
export function newlyBuilt(built: readonly FacilityKey[], save: HubSave): FacilityKey[];
```

- **builtFacilities** の解放条件は 3 章のとおり。訓練場の閾値は tuning の HUB.trainingRuns を使う。
- **hubDecorations** の対象は次の 3 つ。
  - ボス撃破の記念品: codex.enemyKills のボスの key ごと。
  - 記録室の書架の段数: 図鑑の埋まり具合。
  - 名乗っている称号: achievements.title。

`src/meta/hubStore.ts`:

```ts
export const HUB_KEY = "roguelike.hub.v1";

export interface HubSave {
  version: 1;
  seenFacilities: FacilityKey[];
}

export function createHubSave(): HubSave;
export function parseHubSave(v: unknown): HubSave | null;
export function loadHub(storage?: Storage): HubSave;
export function saveHub(save: HubSave, storage?: Storage): void;
```

- 読み書きは `src/meta/storage.ts` の readJson / writeJson を使う。壊れたデータは黙って既定値に戻す。未知の key は sanitizeKeyList で落とす。

`src/render/hubUi.ts`:

```ts
export interface HubView {
  spots: Readonly<Record<HubSpotKey, Vec>>;
  available: ReadonlySet<HubSpotKey>;
  near: HubSpotKey | null;
  departHold: number;
  trialKeystone: string | null;
  decor: readonly HubDecor[];
  banner: string | null;
}

export function drawHubOverlay(ctx: CanvasRenderingContext2D, state: GameState, view: HubView, ox: number, oy: number): void;
```

- 描くものは、設備名、近い台の操作表示（「E: 開く」など、キー設定に合わせる）、出撃ゲージ、試している誓約の名前、「建った」バナー、飾り。
- 文字はすべて drawText / textWidth で描く。訓練場に数値は出さない。
- state は読むだけ。rng は使わない。

**テスト（it 名）**

- 「初回は井戸・掲示板・鍛冶場・記録室だけが建っている」
- 「スキル石を持つと図書館が建つ」
- 「試し場に出会うか 3 ラン遊ぶと訓練場が建つ」
- 「祭壇の部屋に出会うと祭壇が建つ」
- 「芽を持つと庭が建つ」
- 「解放は強さを変えない（builtFacilities は stats に触れない純関数）」
- 「availableSpots は記録室が建つと履歴・図鑑・実績の 3 台を返す」
- 「newlyBuilt は既読の設備を返さない」
- 「壊れた HubSave は既定値に戻る」
- 「ボスの撃破記録から記念品の飾りが増える」

**完了条件**

- npm run check が通る。

### レーン C: main.ts の配線

A と B の完了後に着手する。上のシグネチャを前提にすれば並行も可能。

**所有ファイル**

- 変更: `src/main.ts`
- 新規: `src/ui/hubFlow.ts`、`src/ui/hubFlow.test.ts`

**最小の Edit だけ入れる共有ファイル**

- `src/ui/inventory.ts`: 次の関数を追加して export する。中身は `ui.open = true`、switchTab、`state.paused = true`。

```ts
export function openInventoryAt(state: GameState, ui: InventoryUi, tab: InventoryTab): void;
```

- `src/render/renderer.ts`: state.sandbox のときは次の 3 つを変える。
  - フロアカードを出さない（689 行付近）。
  - 「地下 N 階」の代わりに「拠点」と出す（2105 行付近）。
  - ミニマップを描かない。
- `src/ui/title.ts`: 「Enter: 出撃」の表記を「Enter: 拠点へ」に変える（ヒント文言の 1 行）。

**追加する型と関数**

`src/ui/hubFlow.ts`（DOM 非依存の対応表）:

```ts
export type HubOpen =
  | { kind: "inventory"; tab: InventoryTab; bud?: boolean }
  | { kind: "screen"; screen: "origin" | "questBoard" | "codex" | "achievements" | "history" }
  | { kind: "altar" };

export function hubOpenFor(spot: HubSpotKey): HubOpen;
/** 祭壇の一覧。全誓約を並べ、試している誓約に marked を付ける */
export function altarTabs(current: string | null): ListTab[];
```

**`src/main.ts` の変更**

- Screen に "hub" と "altar" を足す。
- `let hub: HubSession | null` を置く。
- `let menuReturn: "title" | "hub"` を置き、起点画面・一覧画面・履歴の Esc の戻り先にする。
- openHub() を作る。中身は builtFacilities → newlyBuilt → saveHub → createHub。
- title の Enter を openHub に変える。D（デイリー）はタイトルから起点画面へ直行のまま。
- 死亡後の T とポーズの「タイトルへ」を openHub に変える。
- hub の case では次を行う。
  - updateInventoryUi(hub.state, inventoryUi, frame, dt) を先に処理する。開いている間は stepHub を呼ばない。
  - stepHub の戻り値が open なら hubOpenFor で振り分ける。
  - depart なら beginRun(committedSeedText) を呼ぶ。runSetup と依頼は前回のまま。
  - Esc でタイトルへ。
  - drainSfx(hub.state) と drainEchoes(hub.state) を呼ぶ。
- altar の case では stepListScreen の "activate" で listCursorEntry(...).key を setTrialKeystone に渡し、Esc で hub へ戻る。
- 描画は renderer.render(hub.state, aim) → drawHubOverlay → 開いていれば drawInventoryUi の順。
- hub.state は `state` 変数に入れない。`src/main.ts:745` の endRun を拠点で呼ばないためである。
- ランを始めたら hub = null にする。拠点に戻るたびに createHub で作り直す（祭壇の試し打ちは持ち越さない）。

**テスト（it 名）**

- 「鍛冶場は残響タブを開く」
- 「図書館はスキルタブを開く」
- 「庭は芽の 2 択つきの装備タブを開く」
- 「井戸は起点画面へ進む」
- 「掲示板は依頼の一覧を開く」
- 「記録室の 3 台は履歴・図鑑・実績を開く」
- 「祭壇の一覧は全誓約を並べ、試している誓約に印を付ける」

**完了条件**

- npm run check が通る。
- 手動で次を確認する。
  - タイトルから拠点、井戸を通ってランに入れる。
  - 死亡後の T で拠点に戻れる。
  - 拠点で装備を替えてから出撃したランのリプレイが、正しく再生される。

## 5. 不確かな点

- **訓練場の「怯みまで何回当てたか」。** 木人の poise から回数を数える場所が決まっていない。敵ごとの計数を state に持つ必要がありそう。MVP では外し、怯みの成立演出だけにする。図鑑で倒した敵を木人として呼ぶ案も、殴り返してくるため killPlayer のガードに頼る。これも第 2 段にする。
- **拠点のフレーム処理。** 拠点での updatePlayer が、ダッシュ攻撃やバーストで rooms や lockedTiles の中身に依存していないかは未確認。rooms を 1 つ持たせておけば足りる見込み。
- **祭壇の選択の読み方。** 一覧画面の部品は "activate" を返すだけなので、選ばれた行は listCursorEntry で読む前提（`src/main.ts:490` と同じ形）。
- **即出撃の依頼。** 即出撃は依頼の 3 択を飛ばし、保存中の依頼をそのまま持ち越す前提（`src/main.ts:357`）。依頼を毎回選ばせたいなら、長押しを「起点画面を飛ばして依頼の 3 択から」に変える。
- **設備の見た目。** 既存の台座の見た目（anvil など）を流用する前提。専用のドット絵が要るなら、pixel-artist に後から `src/data/sprites.ts` を頼む。
- **デイリーの入口。** D キーはタイトルに残す前提。観測塔（meta-and-weapons.md 3-11）に移すかは未定。
- **拠点で発火する他のフック。** triggers・statusProcs・契約の破片などが拠点の state の中で動くが、state ごと捨てるので永続には残らない見込み。上の 4 経路以外に profile / skillProfile を保存する経路が無いかは、レーン A のテスト（来歴・使い込み・記録）で確かめる。
