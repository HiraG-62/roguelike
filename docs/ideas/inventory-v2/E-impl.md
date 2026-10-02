# 持ち物メニュー E「装束と紋」実装の確定リスト（段 2〜8）

作成日: 2026-10-01。前提: `docs/ideas/inventory-v2/E-merged.md`（13 章の回答はすべて推奨どおり）、見本 `docs/ideas/previews/inv2/E.html`。段 1（`resonanceBySource`・`src/ui/tryOn.ts`・`src/ui/swapDiff.ts`・`src/ui/menuBudget.ts`）は別レーン。

## 0. 結論

- 画面は **「頁の積み重ね（`MenuView[]`）+ 当たりの列（`MenuHit[]`）+ 頁ごとの部品（`ViewModule`）」** で作る。E.html の `stack` / `lastHits` / `navigate`（その向きでいちばん近い当たり）をそのまま TS に移す形にする。入口の名前（`InventoryUi` / `createInventoryUi` / `updateInventoryUi` / `drawInventoryUi`）は残し、main.ts の変更は 4 か所の最小 Edit で済ませる。
- **段 2 が型・入力・殻・装束・紋の形と絵の部品をまとめて作り、後の段の頁のファイルを空の実装（stub）で置く。** 段 3・4・5・6・8a はそれぞれ自分の頁のファイルだけを持つので、共有ファイルに触れずに worktree で並行できる。段 7 は段 6（`forge.ts`）の後に走る。
- 決定性: メニューは step の外で動き、付け替えは今の `loadoutDirty` → `captureLoadout` の経路に乗る。FrameInput と記録の形は変えないので **`REPLAY_VERSION` は上げない**。永続化で増えるのは `roguelike.profile.v1` の任意項目 `meta.seenAt` だけ。

---

## 1. 状態の型と遷移

### 1-1. 型（`src/ui/menuState.ts`、段 2 が作る。後の段は読むだけ）

以下は確定の形。後の段のレーンは `MenuAct` を足さずにこの中で済ませる。足りなければ報告して統合役が足す。

```ts
export type MenuFace = "attire" | "crest";
/** 開く入口。Tab = attire / 鍛冶場 = anvil / 書庫 = skills / 庭 = bud */
export type MenuEntry = "attire" | "anvil" | "skills" | "bud";
export type FocusId = string; // 形式は menuFocus.ts の fid.*（1-3）
export type CandidateSort = "fit" | "new" | "name";
export type CandidateTarget =
  | { kind: "slot"; slot: Slot }
  | { kind: "stone"; index: number }
  | { kind: "flow"; keyword: Keyword; verb: "produces" | "consumes" };
export type ForgePick = { kind: "trait"; index: number } | { kind: "inscription" } | { kind: "bud"; index: number };
/** 鍛冶の手続き。subject = 選んだ物、partner = 捧げる側か受け手（2-4 の役割表） */
export interface ForgeSession { subjectId: string; op: EchoOp | null; partnerId: string | null; pick: ForgePick | null }
export interface AnvilState { slot: Slot | null; forge: ForgeSession | null; offset: number }
export type SheetSubject =
  | { kind: "item"; itemId: string }
  | { kind: "pair"; itemId: string; slot: Slot }
  | { kind: "stone"; stoneId: string }
  | { kind: "stonePair"; stoneId: string; index: number }
  | { kind: "rune"; key: ModifierKey }
  | { kind: "body" }
  | { kind: "boon"; key: BoonKey }
  | { kind: "lineage"; lineage: LineageKey };
export type MenuView =
  | { kind: "attire"; focus: FocusId | null; anvil: AnvilState | null }
  | { kind: "crest"; focus: FocusId | null }
  | { kind: "candidates"; focus: FocusId | null; target: CandidateTarget; sort: CandidateSort; offset: number; order: string[] | null; pinnedId: string | null }
  | { kind: "flow"; focus: FocusId | null; keyword: Keyword }
  | { kind: "flowBoard"; focus: FocusId | null }
  | { kind: "skills"; focus: FocusId | null; lift: { slot: number; key: ModifierKey } | null }
  | { kind: "act"; focus: FocusId | null; action: BoonAction }
  | { kind: "sheet"; focus: FocusId | null; subject: SheetSubject; page: number; offset: number; forge: ForgeSession | null };
export type MenuViewKind = MenuView["kind"];
export type ViewOf<K extends MenuViewKind> = Extract<MenuView, { kind: K }>;

export type MenuAct =
  // 共通（inventory.ts / menuActions.ts が処理する）
  | { kind: "switchFace"; face: MenuFace }
  | { kind: "push"; view: MenuView }
  | { kind: "replace"; view: MenuView }
  | { kind: "jump"; source: ResonanceSource }   // 段 1 の型
  | { kind: "focusPart"; slot: Slot }
  // 頁ごと（その頁の ViewModule.act が処理する）
  | { kind: "setSort"; sort: CandidateSort }
  | { kind: "equip"; itemId: string }
  | { kind: "equipStone"; stoneId: string; index: number }
  | { kind: "clearSlot" }
  | { kind: "salvageStone"; stoneId: string }
  | { kind: "chooseBud"; option: number }
  | { kind: "liftRune"; slot: number; key: ModifierKey }
  | { kind: "placeRune"; slot: number }
  | { kind: "removeRune"; slot: number; key: ModifierKey }
  | { kind: "setAction"; action: BoonAction }
  | { kind: "sheetPage"; page: number }
  | { kind: "chooseUltimate"; index: number }
  | { kind: "stepMoveset"; dir: -1 | 1 }
  | { kind: "anvilPart"; slot: Slot }
  | { kind: "forgeSubject"; itemId: string }
  | { kind: "forgeOp"; op: EchoOp }
  | { kind: "forgePartner"; itemId: string }
  | { kind: "forgePick"; pick: ForgePick }
  | { kind: "forgeExecute" };

/** act = 決定で起きること / hold = 長押し 0.6 秒で起きること / nav = 方向の移動で止まるか（面の札は false） */
export interface MenuHit { id: FocusId; rect: Rect; act: MenuAct | null; hold: MenuAct | null; nav: boolean }
/** 荷札 2 行。aside は 1 行目の右寄せ（地金 ▲▼・費用） */
export interface MenuTag { title: string; sub: string; aside: string | null }
export interface MenuHeader { crumbs: string; right: string | null }
export type GuideVerb = "move" | "open" | "jump" | "equip" | "place" | "decide" | "hold" | "sheet" | "face" | "back" | "close" | "cancel";
/** main.ts が FrameInput の外から渡す（記録しない入力） */
export interface MenuSignals { back: boolean; confirmHeld: boolean }

export interface InventoryUi {
  open: boolean;
  stack: MenuView[];               // [0] は装束か紋
  anvilSession: boolean;           // 鍛冶場から開いた間は装束を金床の構えで作る
  craft: CraftSave;                // 旧 ui.echo.save（roguelike.craft.v1）
  sortPref: CandidateSort;         // 開き直しても保つ並び
  nav: { x: number; y: number; held: number };
  aimPrev: Vec | null;
  clickHeldPrev: boolean;
  hold: { id: FocusId; t: number; by: "key" | "mouse" } | null;
  time: number;                    // 開いている間の経過秒（state.time は止まっている）
  focusAt: number;                 // 焦点が動いた ui.time（動く紋の 4 コマ）
  note: { text: string; t: number } | null; // 荷札 2 行目の一時の知らせ
}

export interface ViewModule<V extends MenuView> {
  layout(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<V>): MenuHit[];
  act(state: GameState, ui: InventoryUi, view: V, act: MenuAct): void;
  header(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<V>): MenuHeader;
  tag(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<V>, focus: MenuHit | null): MenuTag;
  guide(state: Readonly<GameState>, view: Readonly<V>): readonly GuideVerb[];
  sheetFor(state: Readonly<GameState>, view: Readonly<V>): SheetSubject | null;
  /** 戻るを頁の中で使ったら true（持ち上げの取り消し・鍛冶の段戻し） */
  back(state: GameState, ui: InventoryUi, view: V): boolean;
  /** その向きに当たりが無いときの送り（候補・金床・書付の 5 枚送り）。使ったら true */
  edge(state: Readonly<GameState>, ui: InventoryUi, view: V, dx: number, dy: number): boolean;
  /** 積み重ねから外れるとき（候補の seenAt を進める） */
  leave(state: GameState, ui: InventoryUi, view: V): void;
}
```

頁の部品の名前（ui 側は `ViewModule` の定数、render 側は描画関数）:

| view | ui（所有の段） | render（所有の段） |
| --- | --- | --- |
| attire | `ATTIRE_VIEW`（`ui/attire.ts`、2）。`anvil !== null` のときは `ANVIL_VIEW` に任せる | `drawAttire`（`render/attireUi.ts`、2）→ anvil なら `drawAnvil` |
| attire（金床） | `ANVIL_VIEW`（`ui/anvil.ts`、2 は空実装 → 7） | `drawAnvil`（`render/anvilUi.ts`、2 は空実装 → 7） |
| candidates | `CANDIDATES_VIEW`（`ui/candidates.ts`、空 → 3） | `drawCandidates`（`render/candidatesUi.ts`、空 → 3） |
| crest | `CREST_VIEW`（`ui/crest.ts`、空 → 4） | `drawCrest`（`render/crestUi.ts`、空 → 4） |
| flow / flowBoard | `FLOW_VIEW` / `FLOW_BOARD_VIEW`（`ui/flow.ts`、空 → 4） | `drawFlow` / `drawFlowBoard`（`render/flowUi.ts`、空 → 4） |
| skills | `SKILLS_VIEW`（`ui/skillPage.ts`、空 → 5） | `drawSkillPage`（`render/skillPageUi.ts`、空 → 5） |
| act | `ACT_VIEW`（`ui/actPage.ts`、空 → 5） | `drawActPage`（`render/actPageUi.ts`、空 → 5） |
| sheet | `SHEET_VIEW`（`ui/sheet.ts`、空 → 6） | `drawSheet`（`render/sheetUi.ts`、空 → 6） |

render の署名はどれも `(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<ViewOf<K>>, hits: readonly MenuHit[]) => void`。空実装は `layout` が `[]`、`header` / `tag` が空文字、`act` は何もしない。

### 1-2. 入力 → 状態（共通。`ui/inventory.ts` の `updateInventoryUi(state, ui, input, dt, signals = NO_SIGNALS)`）

| 入力（キーボード / マウス / パッド） | 条件 | 起きること |
| --- | --- | --- |
| 持ち物キー（`inventoryPressed`。Tab・I / ― / Select） | 閉じている | `openMenu(state, ui, "attire")`、`state.paused = true` |
| 同上 | 開いている | `switchFace`（`stack = [反対の面]`。焦点の出どころを持ち越す。1-4） |
| 見出しの面の札をクリック | ― | `switchFace(その面)` |
| 戻る（`signals.back` = Esc / 右クリック / B・Start） | top の `back()` が true | それだけ |
| 同上 | stack が 2 段以上 | `leave(top)` → pop |
| 同上 | 1 段目 | 閉じる。`state.paused = false` |
| 方向（`input.move` のエッジ。0.35 秒押し続けたら 0.1 秒ごとに繰り返す） | ― | `nearestInDirection(hits, focus, dx, dy)`（E.html と同じ採点: 進む向きの距離 > 2、得点 = 進む距離 + 横のずれ × 2.2）。見つからなければ `edge(dx, dy)` |
| ホイール（`input.wheel`） | ― | `edge(0, sign(wheel))` |
| マウスが動いた（`aimPrev` と違う） | 当たりの上 | 焦点 = その当たり（`focusAt = time`） |
| 決定（`confirmPressed` / 当たりの上で `clickPressed` / A） | 当たりに `hold` が無い | `act` を振り分ける |
| 決定を押す | 当たりに `hold` がある | `ui.hold` を始める。`signals.confirmHeld`（キー・パッド）か `input.clickHeld`（マウス）が続く間 `t += dt`。0.6 秒で `hold` を振り分ける。先に離せば `act`（あれば） |
| 書付（`interactPressed` か `specialPressed`。G / ― / Y の既定） | top の `sheetFor` が null でない | `push sheet` |
| 荷札（y 220〜250）をクリック | 同上 | 同上 |
| 並び（`parryPressed`。R・中クリック / RB の既定） | top が candidates | `sort` を 合 → 新 → 名 → 合 と送る |
| 毎フレーム | 開いている | `time += dt`、`note` を減らし 1.5 秒で消す |

振り分け: `switchFace` / `push` / `replace` / `jump` / `focusPart` は `menuActions.ts`、それ以外は top の `ViewModule.act`。

### 1-3. 頁ごとの当たりと決定（焦点 id は `menuFocus.ts` の `fid.*` で作る）

| view | 焦点 id | 決定（act） | 長押し（hold） | 書付キー |
| --- | --- | --- | --- | --- |
| attire | `part:<slot>` / `stone:<i>` / `body` / `mini:<kw>` / `face:<face>`（nav=false） | 部位 → push candidates{slot} / 石 → push skills（焦点 `stone:<i>`）/ 人影 → push sheet{body} / 写しの帯 → switchFace crest + push flow{kw} | ― | 部位 → item（装備中）/ 石 → stone / 人影 → body |
| attire（金床） | `part:<slot>` / `tg:<id>` / `op:<op>` / `exec` | 部位 → `anvilPart` / 札 → `forgeSubject` か `forgePartner`（段による）/ 操作 → `forgeOp` / 実行 → `forgeExecute` | 砕く → `forgeExecute` | 札 → item |
| candidates | `sort:<s>` / `c:<id>` / `bud:<n>` / `clear` | 並び → `setSort` / 遺物 → `equip` / 石 → `equipStone` / 芽 → `chooseBud` / 空ける → `clearSlot` | 石の札 → `salvageStone` | pair か stonePair |
| crest | `band:<kw>` / `bead:<kw>:<verb>:<srcKey>` / `more:<kw>:<verb>` / `plus:<kw>:<verb>` / `dai:part:<slot>` / `dai:act:<a>` / `dai:lineage:<l>` / `dai:core` / `board` | 帯・畳んだ珠 → push flow / 珠 → jump / ＋ → push candidates{flow} / 身 → focusPart / 加護の帯 → push act / 系譜 → push sheet{lineage} / 芯 → push sheet{boon} / 系統を選ぶ → push flowBoard | ― | 珠の物 |
| flow | `fold:<kw>` / `src:<srcKey>:<verb>` / `plus:<verb>` | 畳んだ帯 → replace flow{kw} / 札 → jump / ＋ → push candidates{flow} | ― | 札の物 |
| flowBoard | `kw:<kw>` | replace flow{kw} | ― | null |
| skills | `stone:<i>` / `rune:<i>:<key>` / `col:<i>`（持ち上げ中だけ）/ `loose:<i>:<key>`（効かない符） | 石 → push candidates{stone i} / 符 → `liftRune`（祝福の符は知らせだけ）/ 列 → `placeRune` | 符 → `removeRune` | 石 → stone / 符 → rune |
| act | `action:<a>` / `grace:<key>` / `relic:<slot>` | 行動 → `setAction` / 加護 → push sheet{boon} / 乗る遺物 → `focusPart` | ― | 加護 → boon / 遺物 → item |
| sheet | `page:<n>` / `ult:<n>` / `moveset:<±1>` / `op:<op>` / `trait:<n>` / `partner:<id>` / `exec` / `row:<n>`（体の行動の行） | 頁 → `sheetPage` / 奥義 → `chooseUltimate` / 武器種 → `stepMoveset` / 鍛冶の 4 つ | 砕く → `forgeExecute` | null |

`jump(source)` の行き先（`menuActions.ts`）:

| 出どころ | stack |
| --- | --- |
| 遺物（装備中） | `[attire(part:<slot>)]` |
| スキル石 | `[attire(stone:<i>), skills(stone:<i>)]` |
| 祝福（`BoonDef.action` あり = 加護） | `[crest(dai:act:<a>), act(<a>, grace:<key>)]` |
| 祝福（芯） | `[crest(dai:core), sheet{boon}]` |
| 祝福（それ以外） | `[crest(dai:lineage:<l>), sheet{lineage}]` |
| 流儀・型・改鋳・誓約 | `[attire(body), sheet{body}]` |

### 1-4. 面替えで持ち越す焦点（`switchFace`）

`focusedSource(state, ui)` が stack を上から読み、最初に見つかった出どころを返す。紋へ替えるときは `crestShape` でその出どころの珠の id（無い遺物は `dai:part:<slot>`）、装束へ替えるときは遺物 → `part:<slot>`、石 → `stone:<i>`、それ以外 → `part:mainHand`。

### 1-5. 今の `InventoryUi` との関係

| 今の欄 | 行き先 |
| --- | --- |
| `open` | そのまま |
| `tab` / `helpOpen` / `hoverHelp` / `hoverPager` / `detailFull` / `detailFormula` / `pendingDestroy` | 消す（タブと詳細欄と 2 回押しの確認を捨てる） |
| `echo`（`EchoUi`） | `craft: CraftSave` だけ残す。手続きは `ForgeSession` |
| `bud`（`BudUi`） | 消す（芽吹きの札は candidates） |
| `web` / `status` / `runes` / `skillSlot` / `skillFocus` / `skillScroll` / `hoverStoneId` / `hoverSkillSlot` | 消す（各頁の view の欄に入る） |
| `scroll` / `hoverItemId` / `hoverTile` / `stashView` | 消す（candidates の `offset` / `order` / `sort`、`sortPref`） |
| `message` / `messageTimer` | `note` |
| `aimPrev` | そのまま |

---

## 2. 残す / 消す / 移す（ファイル・関数・テスト）

### 2-1. 今の 5 タブの中身の行き先

| 今 | 行き先（段） |
| --- | --- |
| 装備: 部位の枠・倉庫の一覧・並べ替え 8 軸・絞り込み・詳細欄 3 頁・芽のバナーとモーダル・Shift で外す・砕く | 装束の 6 部位（2）→ 候補 5 枚・並び 3・空ける・芽吹きの札（3）。詳細欄 → 荷札と書付（6）。砕く → 書付の操作と金床（6・7） |
| ステータス: 5 ステータス・体の性能・効果頁・奥義 3 枚 | 人影の荷札（2。数字なし）→ 書付「体」の [体][奥義]（6）。到達の行は書付「体」。状態異常・一時強化は HUD のまま、祝福と研鑽は紋の台・加護の頁・書付「系譜」 |
| スキル: スロット 4・石の一覧・符の列・分解・符を外す | 腰の石（2）→ スキルの頁（5）→ 石の候補（3。長押しで分解） |
| 残響: 対象 → 操作 → 性質 → 移し先 → 実行・残響の量 | `forge.ts` の手続き（6）を書付の下端（6）と金床の構え（7）で使う |
| 系統: 40 の格子・溢れ / 枯れ・共鳴中の行 | 紋・系統の頁・系統を選ぶ盤（4）。数えの型は `crestShape.ts`（2） |

### 2-2. ファイルの確定表

| ファイル | 扱い | 段 |
| --- | --- | --- |
| `src/ui/inventory.ts` | 書き直す（入口・振り分け・入力）。`TAB_*`・`InventoryTab`・`layoutInventory`・`layoutSkills`・`skillColumnRects`・`shatterKey`・`salvageKey`・`isDestroyPending`・`detailPageOf`・`advanceDetailPage`・`stepDetailPage`・`hasDetailPager`・`helpButtonRect`・`tabRects`・`DESTROY_CONFIRM_SECONDS`・inventoryLayout の再 export を消す | 2 |
| `src/ui/menuState.ts` / `menuFocus.ts` / `menuInput.ts` / `menuActions.ts` / `attire.ts` / `crestShape.ts` / `seen.ts` / `synergyBuild.ts` | 新規 | 2 |
| `src/ui/candidates.ts` / `crest.ts` / `flow.ts` / `skillPage.ts` / `actPage.ts` / `sheet.ts` / `anvil.ts` | 新規（空実装）→ 各段で中身 | 2 → 3〜7 |
| `src/ui/equipmentLayout.ts` | 消す | 2 |
| `src/ui/bud.ts` | 消す（芽吹きは candidates.ts） | 2 |
| `src/ui/hubFlow.ts` | 最小 Edit: `HubOpen` の inventory を `{ kind: "inventory"; entry: MenuEntry }`、表を forge → anvil / library → skills / garden → bud、`openInventoryAt(state, ui, entry)` は `openMenu` を呼ぶだけ。`closeBudModal` の import を消す | 2 |
| `src/ui/synergyPanel.ts` | 2: `synergyBuild`・`SynergyExclude` と補助を `synergyBuild.ts` へ移し、再 export を 1 行残す。4: ファイルごと消す | 2・4 |
| `src/ui/skillRunes.ts` | 流用: `RuneEntry`・`runeEntries`・`operateRune`・`moveTarget`・`RUNE_BLOCK_TEXT`・`RuneOpResult` を残す。`RuneUi`・`createRuneUi`・`layoutRuneList`・`RuneListLayout`・`RuneRowLayout`・`readNav`・`clampRuneCursor`・`moveRuneCursor`・`hoveredRuneRow` を消す | 5 |
| `src/ui/statusTab.ts` | 消す。`derivedStatRows`・`DerivedStatRow`・`canChooseUltimate`・`ULTIMATE_KIND_LABEL`・`ultimateCostOf`・奥義の選択（`chooseStatusCard` 相当・`stepStatusMoveset` 相当）を新規 `src/ui/sheetBody.ts` へ移す | 6 |
| `src/ui/effectsList.ts` | `EffectRow`・`boonRows`・`coreRows` を残す。`statusEffectRows`・`buffRows`・`runEffectRows` を消す | 6 |
| `src/ui/reachRows.ts` / `scalingText.ts` | 残す（書付「体」が使う） | ― |
| `src/ui/echoTab.ts` | 消す。手続きを新規 `src/ui/forge.ts` へ | 6 |
| `src/ui/stashFilter.ts` / `stashFacets.ts` | 消す（最後の利用者の echoTab と一緒に） | 6 |
| `src/ui/inventoryLayout.ts` | 残す。使われなくなった export（`DETAIL_*`・`detailRect`・`detailPagerRects`・`detailBodyRect`・`LIST_*`・`LEFT_W`・`RIGHT_*`・`STASH_*`・`layoutStashList`・`findRowAt`・`StashRowLayout` など）を消す | 8b |
| `src/render/inventoryUi.ts` | 書き直す（漆の縁・見出し・荷札・操作案内・長押しの環・頁の振り分け・色の表 `MENU_INK`） | 2 |
| `src/render/itemTips.ts` | 新規。`render/inventoryUi.ts` から `itemTipLines`・`synergyTipLines`・`itemFormulaLines`・`stoneFormulaLines`・`summaryFormulaLines`・`summaryBelowRect`・`COLOR_INNATE`・`INNATE_HEAD` と、その内部の補助（相反の行・`itemDetailLines`・`stoneDetailLines`。この 2 つは export にする）を中身を変えずに移す | 2（以後は 6 の所有） |
| `src/render/attireUi.ts` / `crestDraw.ts` | 新規 | 2 |
| `src/render/candidatesUi.ts` / `crestUi.ts` / `flowUi.ts` / `skillPageUi.ts` / `actPageUi.ts` / `sheetUi.ts` / `anvilUi.ts` | 新規（空実装）→ 各段 | 2 → 3〜7 |
| `src/render/inventoryHelp.ts` / `skillRuneUi.ts` | 消す | 2 |
| `src/render/budUi.ts` | 最小 Edit: `drawBudModal`・`drawTraitCard`・`budPickKeys` とモーダルの定数・`ui/bud`・`ui/inventoryLayout` の import を消す（`drawBudUi` は残す） | 2 |
| `src/render/dropTooltip.ts` | 最小 Edit: `itemTipLines` を `./itemTips`、`Rect`・`SLOT_LABEL` を `../ui/inventoryLayout` から読む | 2 |
| `src/render/synergyUi.ts` | 消す | 4 |
| `src/render/statusTabUi.ts` / `echoTabUi.ts` / `stashToolbarUi.ts` / `detailPane.ts` | 消す（`detailPane.ts` の `wrapChunks`・`ultimateTipLine` と計算式の行の描画は `sheetUi.ts` へ移す） | 6 |
| `src/render/attributeUi.ts` | 残す。`drawAttributePanel` の既定の矩形（`statusAttrPanelRect`）を外し、矩形を必ず受け取る形に。`drawSummaryHead` は消す | 6 |
| `src/render/lootUiParts.ts` | 残す。使われなくなった `drawItemRow`・`drawHint` を消す | 8b |
| `src/render/boonUi.ts` | 最小 Edit: 3 択の上に紋の写しの畳んだ帯 | 8a |
| `src/data/sprites/attire.ts` | 新規（3 章） | 2 |
| `src/loot/types.ts` | 最小 Edit: `ProfileMeta.seenAt?: Partial<Record<Slot, number>>` | 2 |
| `src/loot/profile.ts` | 最小 Edit: `sanitizeMeta` で `seenAt` を通す（`LOOT_SLOTS` の key で、有限かつ 0 以上の数だけ。空なら書かない） | 2 |
| `src/core/input.ts` | 最小 Edit: `PlayerInput.menuBackClickPressed(): boolean`（`this.framePressed.includes("Mouse2")`。FrameInput には足さない） | 2 |
| `src/main.ts` | 最小 Edit 4 か所（2-3） | 2 |
| `src/qa/bot.ts` | 触らない（bot はメニューを開かない。確認済み） | ― |

### 2-3. main.ts の最小 Edit（段 2）

1. `drainEchoes`（431〜434 行）: `inventoryUi.echo.save` → `inventoryUi.craft`
2. `openHubSpot`（746〜748 行）: `openInventoryAt(session.state, inventoryUi, open.entry)`
3. `updateHubFrame`（774〜793 行）: `const wasOpen = inventoryUi.open;` → `updateInventoryUi(session.state, inventoryUi, frame, dt, { back: escape || input.menuBackClickPressed(), confirmHeld: input.confirmHeld() })` → `if (wasOpen || inventoryUi.open) { resetHoldLatch(departLatch); drainSfx(...); drainEchoes(...); return; }`。今の `if (escape) { inventoryUi.open = false; ... }` は消す（**`wasOpen` を見ないと、Esc で閉じた同じフレームに拠点からも出てしまう**）
4. `playing`（1801〜1808 行）: 同じ形にする。`if (wasOpen || inventoryUi.open) { loadoutDirty = true; drainSfx(); break; }`（**`wasOpen` を見ないと、Esc で閉じた同じフレームにポーズメニューが開く**）

### 2-4. 鍛冶の役割（`forge.ts`、段 6。回答 4 の確定）

| 操作 | 選んだ物（subject）が倉庫 | subject が装備中 |
| --- | --- | --- |
| 砕く | subject を砕く（長押し） | できない（操作の札を薄くし、荷札に理由） |
| 煽り / 呼び戻し | subject を作り替える | subject を作り替える → `applyEquipmentChange` |
| 注ぎ / 移し | subject = 捧げる側、partner = 同じ部位の受け手（倉庫か装備中） | subject = 受け手、partner = 同じ部位の倉庫の捧げる側 |

段の順は 選ぶ → 操作 → partner（注ぎ・移し）→ pick（煽り = 性質、呼び戻し = 芽、移し = 銘か芽吹いた性質）→ 実行。`EchoRequest` を組み立てて `craftEcho` → `applyEchoResult` → `saveCraft` / `saveProfile`。装備中の物が変わったら `applyEquipmentChange(state)`（`applyStats` + `refreshPendingBud` + `saveProfile`。今の `inventory.ts` の関数を `menuActions.ts` へ移したもの）。

### 2-5. テストの扱い

| 今のテスト | 扱い（段） |
| --- | --- |
| `src/ui/inventory.test.ts`（31 件） | 書き直す（2）。旧の節の行き先: タブ → 積み重ねと面（2）/ スキルタブ・符 → `skillPage.test.ts`（5）/ 装備タブ・芽 → `candidates.test.ts`（3）/ ？と詳細欄の頁送り・スキルタブのフォーカス → 消す / 破壊操作の確認 → 長押し（2 の `menuInput.test.ts`）と `forge.test.ts`（6） |
| `src/render/inventoryUi.test.ts` | 書き直す（2）: 全頁の描画のスモーク + 装束の予算。「遺物の相性行」は `src/render/itemTips.test.ts` へ移す。祝福カードの描画のスモークはそのまま残す |
| `src/ui/statusTab.test.ts` | 2: 補助の `openStatus` / `clickAt` を `updateStatusTab` の直呼びへ（今は inventory 経由で開いている）。6: `src/ui/sheetBody.test.ts` へ書き直して消す |
| `src/ui/synergyPanel.test.ts` | 4 で消す（「系統ごとの源 / 糧」「共鳴中の系統」は 2 の `crestShape.test.ts` が受ける） |
| `src/ui/echoTab.test.ts` / `echoTabWave2.test.ts` | 6 で `src/ui/forge.test.ts` に書き直して消す |
| `src/ui/stashFilter.test.ts` | 6 で消す（並びは `candidates.test.ts`） |
| `src/render/detailPane.test.ts` | 2: import 先を `./itemTips` に（最小 Edit）。6: `src/render/sheetUi.test.ts` へ移して消す（「計算式が書付 1 枚に収まる（全武器種）」「右手の奥義の行」） |
| `src/render/attributeUi.test.ts` / `src/ui/reachRows.test.ts` / `src/ui/effectsList.test.ts` | 6 で statusTab への依存と消した関数の分を直す |
| `src/ui/hubFlow.test.ts` | 2 で直す（入口の表） |
| `src/render/boonUi.test.ts` | 8a で足す |
| `src/ui/keyLabels.test.ts` / `staleTerms.test.ts` / `src/meta/tips.test.ts` | 変えない（新しいコードも通す） |

新しいテストの `it` 名は 4 章の各レーンに書く。

---

## 3. 絵（スプライト）

| 絵 | 要否 | 仮置き（段 2 で入れる） |
| --- | --- | --- |
| 人影 | 新規 | E.html の `FIG_PAT`（10 × 14）を `ATTIRE_FIGURE` へ写す。装束は 5 倍（50 × 70）、候補の小さな体は 3 倍 |
| 部位の絵 6 形 | 新規 | E.html の `RELIC_PAT`（11 × 7〜10）を `RELIC_GLYPHS: Record<LootSlot, Frame>` へ写す。`#` = 響きの色（`dominantTraitColor`）、`+` = 光、`o` = 影。右手は武器種で描き分けない（後） |
| 金床 | 新規の模様 | E.html の `ANVIL_PAT`（10 × 8、6 倍）を `ANVIL_GLYPH` へ。`still.ts` の `anvil`（24 × 24）は atlas を通すので使わない（装備画面の描画には atlas が渡っていない） |
| 残響の壺 5 | 絵は不要 | 手続きの矩形（輪郭 + 水位 + 色）。`render/anvilUi.ts` |
| 腰の石（菱形）・符の鉤・珠・帯・丸印・段の点・＋ | 絵は不要 | 手続き（`render/crestDraw.ts` と `attireUi.ts`） |
| 炉の火 | 絵は不要 | `ui.time` と座標で揺らす（`state.rng` を使わない） |

- 置き方: `src/data/sprites/attire.ts` に `Frame`（文字列の行）で置き、`SPRITES` / `SPRITE_DOTS` には登録しない（世界の絵ではない）。描画は `render/attireUi.ts` の `drawGlyph(ctx, frame, x, y, scale, colors)` が 1 画素ずつ `fillRect` で塗る（響きの色を描画で差すため）
- 後で pixel-artist が密度 2 で描き直すときも、同じ `Frame` の差し替えで済む（倍率は論理寸法から割り出す）

---

## 4. レーン分け

### 4-1. 段の依存と並行

```
段 1（作業中）→ 段 2（E2）→ ┬ E3 候補 ─────────┐
                            ├ E4 紋 ───────────┤
                            ├ E5 スキル・加護 ─┤→ レビュー → E8b 仕上げ
                            ├ E6 書付・鍛冶 → E7 金床 ┤
                            └ E8a 3 択の写し ──┘
```

E3・E4・E5・E6・E8a は `isolation: "worktree"` で同時に走らせる。E7 は E6 の取り込みの後。E8b は統合役（文章は localizer に出してもよい）。

### 4-2. 共有ファイルの衝突確認（並行の段）

| 共有ファイル | E3 | E4 | E5 | E6 | E8a | E7 |
| --- | --- | --- | --- | --- | --- | --- |
| `src/main.ts` / `src/core/input.ts` / `src/ui/inventory.ts` / `src/ui/menuState.ts` / `menuActions.ts` / `menuFocus.ts` / `menuInput.ts` | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 |
| `src/ui/crestShape.ts` / `src/render/crestDraw.ts` / `src/render/attireUi.ts` / `src/ui/attire.ts` / `src/data/sprites/attire.ts` | 読む | 読む | 読む | 読む | 読む | 読む |
| `src/render/inventoryUi.ts`（`MENU_INK`・荷札の部品） | 読む | 読む | 読む | 読む | 読む | 読む |
| `src/render/itemTips.ts` | 読む | 読む | 読む | **所有** | 読む | 読む |
| `src/ui/forge.ts` | ― | ― | ― | **所有** | ― | 読む（足りなければ最小 Edit） |
| `src/render/boonUi.ts` | ― | ― | ― | ― | **最小 Edit** | ― |
| `docs/CODE_MAP.md`・`docs/recipes/*`・`GLOSSARY`・`tips.ts` | 禁止（報告） | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 |

重なりは無い。頁を足す・操作を足すときに共有ファイルへ手を入れる必要がないよう、段 2 が型・振り分け・空実装をすべて置く。

### 4-3. 各レーン

#### E2 段 2: 殻・装束・紋の形（L、Opus、段 1 の取り込み後、並行なし）

- 所有（新規）: `src/ui/menuState.ts`、`menuFocus.ts`（+test）、`menuInput.ts`（+test）、`menuActions.ts`、`attire.ts`（+test）、`crestShape.ts`（+test）、`seen.ts`（+test）、`synergyBuild.ts`、空実装 `src/ui/{candidates,crest,flow,skillPage,actPage,sheet,anvil}.ts`・`src/render/{candidatesUi,crestUi,flowUi,skillPageUi,actPageUi,sheetUi,anvilUi}.ts`、`src/render/attireUi.ts`、`crestDraw.ts`、`itemTips.ts`（+test）、`src/data/sprites/attire.ts`
- 所有（書き直し）: `src/ui/inventory.ts`・`inventory.test.ts`、`src/render/inventoryUi.ts`・`inventoryUi.test.ts`
- 消す: `src/ui/equipmentLayout.ts`、`src/ui/bud.ts`、`src/render/inventoryHelp.ts`、`src/render/skillRuneUi.ts`
- 最小 Edit: `src/main.ts`（2-3）、`src/core/input.ts`（メソッド 1）、`src/ui/hubFlow.ts`・`hubFlow.test.ts`、`src/ui/synergyPanel.ts`（移した分と再 export 1 行）、`src/ui/statusTab.test.ts`（補助 2 つ）、`src/render/budUi.ts`、`src/render/dropTooltip.ts`、`src/render/detailPane.test.ts`（import）、`src/loot/types.ts`、`src/loot/profile.ts`
- 公開する主な署名:
  - `menuFocus.ts`: `nearestInDirection(hits, current: FocusId | null, dx, dy): FocusId | null`、`hitAt(hits, p): MenuHit | null`、`focusedHit(hits, id): MenuHit | null`、`fid`（`part(slot)` / `stone(i)` / `body` / `mini(kw)` / `face(f)` / `band(kw)` / `bead(kw, verb, srcKey)` / `more(kw, verb)` / `plus(kw, verb)` / `daiPart(slot)` / `daiAct(a)` / `daiLineage(l)` / `daiCore` / `board` / `fold(kw)` / `src(srcKey, verb)` / `kw(kw)` / `sort(s)` / `cand(id)` / `bud(n)` / `clear` / `rune(i, key)` / `col(i)` / `loose(i, key)` / `action(a)` / `grace(key)` / `relic(slot)` / `page(n)` / `ult(n)` / `moveset(dir)` / `op(op)` / `trait(n)` / `partner(id)` / `tg(id)` / `exec` / `row(n)`）
  - `menuInput.ts`: `MENU_HOLD_SECONDS = 0.6`、`NAV_REPEAT_DELAY = 0.35`、`NAV_REPEAT_EVERY = 0.1`、`readMenuNav(nav, input, dt): { dx: number; dy: number }`、`menuGuideText(verbs: readonly GuideVerb[]): string`（キー名は `keyLabel(…, { first: true })`。Enter は `keyLabel("confirm")`、Esc は固定、方向は「↑↓←→」）
  - `menuActions.ts`: `openMenu(state, ui, entry)`、`closeMenu(state, ui)`、`pushView` / `popView` / `replaceTop`、`switchFace(state, ui, face?)`、`jumpToSource(state, ui, source)`、`focusPart(state, ui, slot)`、`focusedSource(state, ui)`、`applyEquipmentChange(state)`、`showNote(ui, text)`
  - `attire.ts`: `ATTIRE_VIEW`、`ATTIRE_PART_RECTS: Readonly<Record<LootSlot, Rect>>`（E 6 章 W1 の座標）、`FIGURE_RECT`、`stoneRect(i)`、`MINI_CREST_RECT`
  - `crestShape.ts`: `CrestBead { source; key: string; shape: "relic" | "stone" | "boon" | "origin"; color: string }`、`CrestRow { keyword; step; undercurrent: boolean; produces / consumes / amplifies: CrestBead[]; overflow: { produces; consumes; amplifies }; plus: "produces" | "consumes" | null }`、`CrestShape { rows: CrestRow[]; hidden: Keyword[] }`、`crestShape(state, sources?)`、`sourceKey(source)`、`beadFocusFor(shape, key)`、`CREST_MAX_STEPPED = 4`、`CREST_MAX_UNDER = 2`、`BEAD_MAX = { produces: 4, consumes: 4, amplifies: 2 }`。並びは 段の高い順 → `KEYWORDS` 順、伏流は（源 + 糧）の多い順。`RESONANCE_EXCLUDED` は描かない
  - `crestDraw.ts`: `drawGlyphDisc`、`drawBand`、`drawBandMorph`（4 コマ。▲ / ▼ / 消 / 新）、`drawBead`（4 形）、`drawStepDots`、`drawOverflowBead`、`drawPlusBead`、`drawMiniCrest(ctx, shape, rect, opts: { litKey: string | null; changes: readonly BandChange[]; time: number })`、`drawFoldedBands(ctx, shape, x, y, opts)`
  - `seen.ts`: `isUnseen(item, meta)`（`item.foundAt > (meta.seenAt?.[item.slot] ?? 0)`）、`slotHasUnseen(profile, slot)`、`markSlotSeen(profile, slot): boolean`（変わったら true。保存は呼び出し側）
  - `attireUi.ts`: `drawAttire`、`drawGlyph`、`drawRelicGlyph(ctx, slot, x, y, scale, color, ghost?)`、`drawFigure(ctx, x, y, scale, dim?)`、`drawStoneGem(ctx, i, x, y, stone, focus, lit)`
  - `render/inventoryUi.ts`: `drawInventoryUi(ctx, state, ui)`（署名は今のまま）、`MENU_INK`、`drawFocusBrackets(ctx, rect)`、`drawHoldRing(ctx, rect, ratio)`
- 仕様: 見出し y4（SMALL。左に面の札、右に階か「拠点」）・区切り y16・荷札 y224（`TEXT.BODY`）と y238（SMALL）・操作案内 y256（SMALL）。漆の縁と墨染めの帳は E.html の `frame()` / `paper()`。装束の荷札は 部位: 「右手 打刀「王殺しの不屈」」/「源 燃焼系　糧 瀕死系」、人影: 「剣士・連刃の型」/ 5 ステータスの目盛り（点。数字なし）。部位の角: 金 = 名のある遺物、緑 = 芽、白い点 = `slotHasUnseen`。紋の写しは焦点の物の珠を白く、外すと細る帯を ▼ / 消 で点滅させる（段 1 の `tryOnRelic(state, slot, null)` / `tryOnStone(state, i, null)`）
- テスト（`it` 名）:
  - menuFocus: 「右へ押すと右側でいちばん近い当たりへ移る」「その向きに当たりが無ければ動かない」「焦点が当たりに無ければ先頭の当たりにする」「nav が false の当たりには止まらない」
  - menuInput: 「押した瞬間だけ 1 マス動き、押し続けると 0.35 秒後から繰り返す」「長押しは 0.6 秒で発火し、先に離すと決定になる」
  - inventory: 「持ち物キーで開くと装束の右手に焦点があり、ゲームが止まる」「開いている間の持ち物キーで装束と紋を行き来する」「戻るは 1 段ずつ戻り、1 段目で閉じて止まりを解く」「面を替えると深い頁は閉じ、焦点の遺物は持ち越す」「マウスが動いたときだけ当たりへ焦点を移す」「書付キーで焦点の物の書付が積まれる」
  - attire: 「6 部位・腰の石 4・人影・紋の写しの帯に当たりがある」「部位で決定すると候補の頁が積まれる」「人影で決定すると書付「体」が積まれる」「腰の石で決定するとスキルの頁が積まれる」「紋の写しの帯で決定すると紋の面でその系統が開く」「倉庫に新着がある部位にだけ印が付く」
  - crestShape: 「段の立った系統は 4 本、伏流は 2 本まで」「珠は源 4・糧 4・強め 2 を超えた分を畳む」「溢れの伏流は糧の側に＋、枯れの伏流は源の側に＋」「同じ出どころには同じ key」
  - seen: 「seenAt が無ければすべて新着」「候補を見た後の部位は新着でなくなり、後から入った物だけ新着」「壊れた seenAt は読み捨てる」（`loot/profile.ts` の sanitize）
  - render: 「全ての頁を例外なく描き、fillText を直接使わない」「装束の予算: 文の行 4・BODY 1・数 1・印 28 以下」
  - hubFlow: 「鍛冶場は金床の構え、書庫はスキルの頁、庭は芽のある部位の候補で開く」
- 完了条件: `npm run check:fast`。Esc で閉じた同じフレームにポーズ・拠点の退出が起きない（手で確認）。報告に CODE_MAP の行（6 章 6-3）

#### E3 段 3: 候補と比べる（M、Sonnet、E2 の後、E4・E5・E6・E8a と並行）

- 所有: `src/ui/candidates.ts`（+`candidates.test.ts`）、`src/render/candidatesUi.ts`（+`candidatesUi.test.ts`）
- 最小 Edit: なし / 編集禁止: 4-2 の表
- 仕様:
  - 並ぶ物: `slot` = その部位の倉庫の遺物、`stone` = その石の枠以外の石、`flow` = 全部位の倉庫の遺物のうち `relicKeywords` がその系統の `verb` を持つ物（石は入れない）。芽のある部位は先頭に 芽吹きの札 2 枚（`state.pendingBud.options`）。末尾に「空ける」（部位か石の枠が埋まっているときだけ）
  - 並び: 合 = `tryOn` で 失う帯の数（down + gone）が少ない順 → 新しく立つ帯（new）が多い順 → 太る帯（up）が多い順 → `foundAt` の新しい順 → id。新 = 新着 → `foundDepth` の深い順 → `foundAt`。名 = 名のある遺物 / 銘 / `budOffer` を持つ物 → `foundAt`。並びは頁を開いたときと並びを変えたときだけ計算して `view.order` に入れる（毎フレーム計算しない）
  - 5 枚ずつ。`edge(0, ±1)` で `offset` を送る。見出しの右に「n/m」（頁）。外した物は `pinnedId` で並びの先頭（`equipItem` の倉庫の末尾への `push` は変えない）、決定の後の焦点はその物へ
  - 札: 部位の絵・名前（`truncateText`）・系統の丸印 3 つまで。新着は左上の白い点、失う帯がある札は左端の朱の点
  - あてがう: 小さな体（E 6 章 W2 の `MINI`）の替わる部位を 0.5 秒ごとに今の物と候補で入れ替える（`ui.time`）。石の候補は腰の石 4
  - 動く紋（x 312〜470）: 段 1 の `TryOnResult` を `drawBandMorph` で 6 行まで（動く帯を必ず残す）。差（y 182〜234）: 荷札 1 行（BODY）「太刀 と 打刀「王殺しの不屈」」+ 地金 ▲▼ 2 つまで（右寄せ）+ 得る / 失う 3 行（段 1 の `swapDiff`）
  - 決定: `equip` → `equipItem` + `applyEquipmentChange` + 効果音 `equipOn`。`equipStone` → `equipStone` + `saveSkillProfile`。`clearSlot` → `unequipItem` / `unequipSlot`。`chooseBud` → `chooseBud(state, n)`（効果音 `boonSelect`）。長押し `salvageStone` → `salvageStone`（`dismantle`）
  - `leave`: 部位の候補なら `markSlotSeen` → 変われば `saveProfile`
- テスト（`it` 名）: 「部位の倉庫だけを 5 枚ずつ並べ、端で送ると次の 5 枚」「合は失う系統が少ない順、同じなら新しく立つ系統が多い順」「新は新着を先に、次に深い順」「名は名のある遺物・銘・芽のある物を先に」「決定で付け替え、外した物は一覧の先頭に出て焦点が移る」「付け替えで能力が畳み直され、保存される」「系統から来た候補は全部位から、その系統の源 / 糧を持つ遺物だけ」「石の候補で腰の石を付け替え、長押しで分解する」「芽のある部位は先頭に芽吹きの札 2 枚が出て、決定で芽吹く」「候補の頁を離れるとその部位の新着が消える」「空けるで部位を外す」「候補の予算: 文の行 6・BODY 1・数 2・候補 5 枚以下」

#### E4 段 4: 紋の面（M〜L、Sonnet、E2 の後、並行）

- 所有: `src/ui/crest.ts`・`src/ui/flow.ts`（+`crest.test.ts`・`flow.test.ts`）、`src/render/crestUi.ts`・`flowUi.ts`
- 消す: `src/ui/synergyPanel.ts`、`synergyPanel.test.ts`、`src/render/synergyUi.ts`
- 仕様: 帯 x 160〜320・丸印 24px を x 240・源の珠 12px を x 140 から左へ・糧を x 328 から右へ、段 32px / 伏流 16px（E 6 章 W3 と D の W1）。下の台 y 190〜206: 身 6（x 8〜56）・加護の帯 5（x 72〜352。`gracesOf` / `graceSlotsOf` の埋まりを ■□）・系譜（x 364〜440。持っている系譜の札の数を ▬）・芯の灯（x 446。`ownedCoreDef`）・「系統を選ぶ」（`hidden` が 1 つ以上のとき）。荷札は珠: 「打刀「王殺しの不屈」 右手」/「外すと 燃焼系 が細る」、帯: 「燃焼系 2 段」/ 源・糧の数の点
  - 系統を開く（W4）: 上の畳んだ帯（`fold`）、源の札 144 × 22（x 8）・糧の札（x 328）を 4 段まで、強めの札を x 176・y 132 から、中央の丸印 40px。荷札 2 行目は焦点の物の性質のうち、その系統に触れる行だけ（`relicKeywords` で行を絞る）
  - 系統を選ぶ盤: 丸印だけの 8 × 5（`KEYWORDS` から `RESONANCE_EXCLUDED` を除く 40）。段の立った系統は色、他は墨
- テスト: 「珠で決定すると装束のその部位へ跳ぶ」「石の珠はスキルの頁、加護の祝福は加護の頁、流儀・型は書付「体」へ跳ぶ」「帯で決定すると系統の頁が開く」「系統の頁の荷札はその系統に触れる行だけ」「伏流の＋で系統で絞った候補が積まれる」「台の身で装束のその部位、加護の帯で加護の頁、系譜で書付「系譜」」「5 本目以降の系統は系統を選ぶ盤から開ける」「紋の予算: 文の行 4・数 1 以下」「系統の頁の予算: 文の行 4・数 0」

#### E5 段 5: スキルと加護の頁（M、Sonnet、E2 の後、並行）

- 所有: `src/ui/skillPage.ts`・`actPage.ts`（+test 2）、`src/render/skillPageUi.ts`・`actPageUi.ts`、`src/ui/skillRunes.ts`（2-2 のとおり縮める）
- 仕様（スキル、W5）: 列 x 14 + i × 116（104 × 112）。石 24px（顔 = `skillKeywords` の最初の系統の色）・名前・丸印 3 つまで・穴 = `slotLinks(i)`（4 / 3 / 2 / 2）を符の `modifierLinkCost` で埋める。符で決定 → 持ち上げ（祝福の符 `run === false` は `RUNE_BLOCK_TEXT.granted` を知らせるだけ）。持ち上げ中は焦点が列 `col:<i>` を渡り、置ける列は金の破線、決定で `moveRunModifier(state.skills, from, to, key)`（効果音 `runeAttach`）、置けなければ知らせ。戻るで持ち上げをやめる（状態は何も変わっていない）。持ち上げ中の符は (452, 140) に浮かせる。符で長押し → `removeRunModifier`（消える。`dismantle`）。y 140 の列は「効かない符」（`RuneEntry.active === false`）。石で決定 → push candidates{stone i}。数字キー（`skill1Pressed`〜）で列へ焦点
  - 仕様（加護、W6）: 見出しの下に行動の札 [左][右][駆][技][奥]（`setAction`）。左に加護 2 枠（3 枠は真髄。`gracesOf` / `graceSlotsOf`）、右に乗る遺物 4 つまで、下に注ぐ系統（その行動の加護の `keywords.produces` の和）。乗る遺物 = 行動の系統（左・右 = 近接系、銃の家系は射撃系 / ダッシュ = ダッシュ系 / スキル = 気力系 / 奥義 = 奥義ゲージ系。表 `ACTION_KEYWORD` を actPage.ts に置く）を源か糧に持つ装備中の遺物
- テスト: 「石で決定すると石の候補が開く」「符を持ち上げて別の石の列に置くと移る」「置けない列では知らせだけで動かない」「戻るで持ち上げをやめ、元の列のまま」「符の長押しで外れて消える」「祝福の符は持ち上げられない」「加護の頁は行動の加護・乗る遺物・注ぐ系統を出す」「乗る遺物で決定すると装束のその部位へ跳ぶ」「スキルの頁と加護の頁の予算: 文の行 4・数 0」

#### E6 段 6: 書付と鍛冶の手続き（L、Opus、E2 の後、並行）

- 所有: `src/ui/sheet.ts`・`sheetBody.ts`（新規）・`forge.ts`（新規）（+`sheet.test.ts`・`sheetBody.test.ts`・`forge.test.ts`）、`src/render/sheetUi.ts`（+`sheetUi.test.ts`）、`src/render/itemTips.ts`（+test）、`src/render/attributeUi.ts`（+test）、`src/ui/effectsList.ts`（+test）、`src/ui/reachRows.test.ts`
- 消す: `src/ui/statusTab.ts`・`statusTab.test.ts`・`echoTab.ts`・`echoTab.test.ts`・`echoTabWave2.test.ts`・`stashFilter.ts`・`stashFilter.test.ts`・`stashFacets.ts`、`src/render/statusTabUi.ts`・`echoTabUi.ts`・`stashToolbarUi.ts`・`detailPane.ts`・`detailPane.test.ts`
- 仕様（W8。予算の外）:
  - 1 品: 名前（BODY）・部位 · ベース · 深度 · 響き・性質の全文（右端に系統の丸印）・地金の数字・来歴・フレーバー（`itemDetailLines` の full）。下端に操作 5（`forge.ts`。2-4 の役割表）。費用と残響の量は下端の 1 行。partner は同じ部位の物を 5 件ずつの行で選ぶ。pick は性質・銘・芽の行に焦点
  - 見開き（pair / stonePair）: 左 = 候補、右 = 今。地金は差を（+1）で
  - 体: 頁 [体][奥義]。体 = 5 ステータスの値と出どころ（`drawAttributePanel` に矩形を渡す）・体の性能（`derivedStatRows`）・到達の行（`reachRows`）・行動の行（`movesetFormulas` の名前）に焦点、焦点の行動の計算式 1 本（`actionChunks`）。奥義 = 3 枚（拠点だけ選べる。ラン中は「ラン中は奥義を変えられない」を知らせ。今の `chooseStatusCard` の振る舞い）
  - 祝福: 名前・札の種類・格・全文・研鑽の数え / 系譜: その系譜の持っている札（`boonRows` の絞り）と研鑽の数え / 刻印符: `MODIFIERS[key]` の全文とリンク数
  - `forge.ts` の公開: `forgeStep(profile, session): "op" | "partner" | "pick" | "ready"`、`forgePartners(profile, session): Item[]`、`forgeRequest(profile, session): EchoRequest | null`、`canForgeOp(profile, subjectId, op): boolean`、`executeForge(state, craft: CraftSave, session): { ok: boolean; message: string }`（成功で `saveCraft`・`saveProfile`、装備中が変われば `applyEquipmentChange`、効果音は今の `ECHO_SFX`）
- テスト: forge「倉庫の遺物は 5 操作すべての対象になる」「装備中の遺物は煽り・呼び戻しの対象、注ぎ・移しの受け手になり、砕けない」「装備中を受け手にした注ぎは倉庫の遺物を捧げる」「装備中の遺物を作り替えると能力が畳み直される」「残響が足りないと実行せず知らせを返す」「砕くは長押しでだけ実行される」。sheet「1 品の書付に性質の全文と地金の数字が出る」「見開きは候補と今の 2 頁」「書付「体」に 5 ステータス・体の性能・焦点の行動の計算式が出る」「奥義は拠点でだけ選べる」「系譜の書付に研鑽の数えが出る」。sheetUi「計算式が書付 1 枚に収まる（全武器種）」「右手の要点に奥義の行が出る」
- 資料（統合役が同じコミットで）: `docs/recipes/stash.md` を「候補の並び（`ui/candidates.ts` の並びの表）」に書き直す、`docs/recipes/weapon.md` 17 行目の `render/detailPane.test.ts` → `render/sheetUi.test.ts`

#### E7 段 7: 金床の構え（S、Sonnet、E6 の取り込み後）

- 所有: `src/ui/anvil.ts`（+`anvil.test.ts`）、`src/render/anvilUi.ts`
- 最小 Edit: `src/ui/forge.ts`（足りない関数の追加だけ）
- 仕様（W7）: 部位の位置は装束と同じ（`ATTIRE_PART_RECTS`）。人影の代わりに金床（`ANVIL_GLYPH`）と炉の火。部位で決定 → 右に 装備中の物（先頭。印付き）+ その部位の倉庫を 5 枚（x 266・y 36 + i × 24、200 × 21）、操作 5（x 266 + i × 41・y 162、38 × 16）。下に残響の壺 5（水位 = 量 ÷ 表示の上限。上限は `ANVIL_POT_FULL = 30` の TS 定数）。戻るは 操作 → 札 → 部位 の順に 1 段ずつ。結果は荷札 1 行の「前 → 後」
- テスト: 「鍛冶場で開くと装束が金床の構えになる」「部位を選ぶと装備中の物とその部位の倉庫が並ぶ」「装備中の物では砕くを選べない」「戻るで鍛冶の段を 1 つずつ戻す」「紋へ替えて戻っても金床の構えのまま」「壺の水位は残響の量に比例し上限で止まる」「金床の予算: 文の行 4・数 1 以下」

#### E8a 段 8a: 祝福の 3 択の紋の写し（S、Sonnet、E2 の後、並行）

- 所有: `src/ui/boonHint.ts`（新規、+test）
- 最小 Edit: `src/render/boonUi.ts`（`drawBoonChoice` に 1 呼び出し + 描画関数 1 つ）、`src/render/boonUi.test.ts`（足すだけ）
- 仕様: `boonCrestHint(state, key): { rising: Keyword[]; action: BoonAction | null }`。`resonanceBySource(state)` の profile に `BOONS[key].keywords` を 1 つ足して `countProfiles` → `resonanceSteps` で比べる（state は変えない）。描画は y 18〜34 に `drawFoldedBands`（丸印 12px × 6 + 段の珠）を薄く敷き、焦点の札で太る帯に ▲、`action` の行動の角枠を点滅。札の中身は変えない
- テスト: 「焦点の札で太る系統を返し、state を変えない」「加護の札は乗る行動を返す」「3 択の描画は例外なく fillText を直接使わない」

#### E8b 段 8b: 仕上げ（S〜M、統合役 + localizer、全段の後）

- `src/meta/tips.ts`・`docs/GLOSSARY.md`（6 章）、`docs/CODE_MAP.md` の説明の整え、`docs/ARCHITECTURE.md`（永続化の表に `seenAt`、旧タブの記述）、`IDEAS.md` の現状、`docs/HANDOFF.md`、`CHANGELOG.md`
- コードの片付け: `src/ui/inventoryLayout.ts`・`src/render/lootUiParts.ts` の使われない export を消す（2-2）
- 完了条件: `npm run check`

### 4-4. レビューの位置

- E2 の後: `reviewer`（`model: "opus"`。main.ts・input.ts・永続化に触る）
- E3〜E6・E8a の取り込み後: `reviewer`（`model: "opus"`。装備中の遺物の鍛冶は記録と再生の一致に関わる）
- E7・E8b の後: `/check` だけ

---

## 5. 永続化・決定性

| 項目 | 確定 |
| --- | --- |
| 新着の判定 | `ProfileMeta.seenAt?: Partial<Record<Slot, number>>`（`roguelike.profile.v1` の任意項目。version は変えない）。新着 = `item.foundAt > (seenAt[slot] ?? 0)`。候補の頁を離れるときに `markSlotSeen` → `saveProfile`。**`Item.unseen` は足さない**（拾う処理が step の中にあり、旧セーブと記録のスナップショットにも混ざるため） |
| `roguelike.craft.v1` | 変えない（`ui.craft` に持つだけ） |
| 新しいキー | なし（`v2` 不要） |
| メニューとシミュレーション | メニューは step の外（main.ts が `updateInventoryUi` の後に step を飛ばす。今のまま）。`state.rng` を使わない。並びの同順は `foundAt` → id で決める。動きは `ui.time` と座標で作る（`state.time` は止まっている） |
| 付け替えの経路 | 装備・石・符・芽・装備中の遺物の鍛冶はすべて今の `loadoutDirty` → `recorder.noteLoadout` → `captureLoadout` に乗る。鍛冶で装備中の Item の中身が変わると `equipmentSignature` が変わり、`player`（生命・ダッシュ・気力）の上書きつきで記録される。再生の `applyEvent` は `applyStats` してから上書きするので、生の側も `applyEquipmentChange`（`applyStats`）を通せば一致する |
| 試着の数え直し | 段 1 の `tryOn` は `refreshResonance` と `LAST_COUNT` を触らない（読むだけ）。`resonance.ts` の profile のキャッシュが試着で埋まっても、`refreshResonance` の「変わった」は段の比較なので結果は変わらない |
| 記録しない入力 | 右クリック（`menuBackClickPressed`）・決定の押し続け（`confirmHeld()`）・Esc は FrameInput の外 |
| `REPLAY_VERSION` | 上げない（FrameInput・`ReplayLoadout` の形・step が読むものを変えない） |
| QA bot | メニューを開かないので変更なし |

---

## 6. 用語・Tips・CODE_MAP の確定リスト

### 6-1. GLOSSARY に足す行（表示 | 内部 | 意味 | 場所）

| 表示 | 内部 | 意味 | 場所 |
| --- | --- | --- | --- |
| 装束 | `MenuView` attire | 装備画面の体の面。人影の周りの 6 部位（右手・頭・体・足・指輪・首飾り）と腰のスキル石 4 から着る物を選ぶ。右に紋の写し | `ui/attire.ts` |
| 紋 | crest | 装備画面の系統の面。帯 = 系統（段の立った系統 4 + 伏流 2）、珠 = 出どころ（左が源、右が糧、右上が強め）。珠を選ぶと装束の部位・スキル・加護の頁へ跳ぶ。一字の名（2026-10-01 にユーザーが承認） | `ui/crest.ts` |
| 紋の写し | - | 装束の右に置く紋の縮図。名前を出さない。表示には出さず Tips で使う | `render/crestDraw.ts` |
| 帯 / 珠 | `CrestRow` / `CrestBead` | 紋の系統 1 本（太さと光の速さが段）/ 帯の両側の出どころ 1 つ（角 = 遺物・菱形 = スキル石・小札 = 祝福・二重丸 = 流儀と型）。表示には出さず Tips で使う | `ui/crestShape.ts` |
| 伏流 | `CrestRow.undercurrent` | 源か糧を 1 つ以上持つが段の立っていない系統。紋の下に破線で描き、足りない側に「＋」 | `ui/crestShape.ts` |
| 候補 | candidates | 部位（か腰の石）を選ぶと並ぶ倉庫の物。5 枚ずつ | `ui/candidates.ts` |
| 合 / 新 / 名 | `CandidateSort` fit / new / name | 候補の並び。噛み合う順 / 新着順 / 名・銘・芽。札は 1 字、荷札で長い名 | 同上 |
| 新着 | `ProfileMeta.seenAt` | その部位の候補を最後に見た後に倉庫へ入った遺物。部位の角と候補の札の白い点 | `ui/seen.ts` |
| 芽吹き（札） | - | 芽のある部位の候補の先頭に並ぶ 2 択の札。決定で芽吹く | `ui/candidates.ts` |
| 得る / 失う | 段 1 の差 | 候補と今の物の性質の差。共通の性質は書かない | `ui/swapDiff.ts` |
| 空ける | `clearSlot` | 候補の末尾の札。部位・スキルの枠を空にする | `ui/candidates.ts` |
| 荷札 | `MenuTag` | 焦点の 1 つにだけ付く 2 行の文字。表示には出さない | `ui/menuState.ts` |
| 書付 | sheet | 1 品・体・祝福・系譜・刻印符の全文と数字の頁。情報の予算の外。体の書付は [体][奥義] | `ui/sheet.ts` |
| 金床の構え | anvil | 拠点の鍛冶場で開く装束。部位 → 装備中の物とその部位の倉庫 → 操作。表示は見出しの「鍛冶場」だけ | `ui/anvil.ts` |
| 残響の壺 | - | 金床の構えの下の 5 色の壺。水位が残響の量（数字は荷札だけ） | `render/anvilUi.ts` |
| 乗る遺物 / 注ぐ系統 | - | 加護の頁の見出し。その行動の系統を持つ装備中の遺物 / その行動の加護が起こす系統 | `ui/actPage.ts` |
| 効かない符 | `RuneEntry.active` false | スキルの頁の下の列。付いているが今の石に効かない刻印符 | `ui/skillPage.ts` |
| 系統を選ぶ | flowBoard | 紋に描けない 5 本目以降の系統を選ぶ盤（丸印だけの格子） | `ui/flow.ts` |
| 持ち上げ中 | - | スキルの頁で符を持ち上げている間の荷札 | `ui/skillPage.ts` |

書き直す行: 79（奥義: 「装備画面のステータスタブで」→「装束の人影の書付の奥義の頁で」）、83（ステータス（タブ）→ 消して「体（書付）」の行に）、121（計算式: 「詳細欄の「計算式」の頁」→「書付「体」の焦点の行動」）、249（共鳴: 「表示は系統タブの…」→「表示は紋の帯の太さと段の点、HUD の「共鳴 燃焼 2」」）、250（到達: 「効果頁の先頭」→「書付「体」」）、275・276（残響・系統のタブ名 → 消す）、277・279（場所 `render/inventoryUi.ts` → `render/itemTips.ts`）、357（刻印符: 「装備画面で別のスロットへ移す・外す」→「スキルの頁で持ち上げて別の石へ置く。長押しで外す（消える）」）。

### 6-2. Tips（`src/meta/tips.ts`）

足す項目:

| key | term | category | 本文 |
| --- | --- | --- | --- |
| `attire` | 装束 | controls | 装備画面の体の面。人影の周りの 6 部位と腰のスキル石から着る物を選ぶ。部位を指すと、右の紋の写しでその遺物の珠が光り、外すと細る帯が点滅する。部位を選ぶと候補が並ぶ。 |
| `crest` | 紋 | controls | 装備画面の系統の面。帯が系統で、太く速く光るほど段が高い。帯の左に源、右に糧の出どころが珠で並び、右上が強め。珠を選ぶと、その物を着ている部位・スキル・加護の頁へ跳ぶ。帯を選ぶと、その系統に触れる物だけの頁が開く。 |
| `sheet` | 書付 | controls | `${k(b, "interact")} で、焦点の物の全文と数字の頁を開く。候補からは候補と今の見開き、人影からは体の書付（ステータス・体の性能・行動の計算式・奥義）。倉庫の遺物の書付の下端から鍛冶の操作ができる。` |
| `candidates` | 候補 | relic | 部位を選ぶと並ぶ、その部位の倉庫の遺物（5 枚ずつ）。合は噛み合う順、新は新着順、名は名のある遺物・銘・芽のある物から。指すと紋が動いて、太る・ひびが入る・消える・新しく立つ帯を見せる。決定で付け替え、外した物は一覧の先頭に戻る。 |
| `undercurrent` | 伏流 | relic | 源か糧を持つが、まだ段の立っていない系統。紋の下に破線で描かれ、足りない側の「＋」から、その系統を足せる候補を開ける。 |
| `anvilStance` | 金床の構え | hub | 拠点の鍛冶場で開く装束。部位を選ぶと装備中の遺物とその部位の倉庫が並び、そこから鍛冶の操作を選ぶ。下の壺の水位が残響の量。砕くのは長押しで、倉庫の遺物だけ。 |

直す項目: `inventory`（「押すたびにタブが進む」→「開いている間にもう一度押すと装束と紋を行き来し、Esc で 1 段ずつ戻って閉じる」）、`special`（「装備画面のステータスタブで選ぶ」→「装束の人影の書付の奥義の頁で選ぶ」）、`tally`（「ステータスタブ「効果」の頁」→「紋の台の系譜から開く書付」）、`library`（「装備画面で石に付ける」→「装備画面のスキルの頁で石に付ける」）、`echo`（「装備中の遺物は対象にできない」→「注ぎ・煽り・移し・呼び戻しは装備中の遺物にも使え、砕くのは倉庫の遺物だけ」）、`rune`（「装備画面で別のスロットへ移す・外す」→「装備画面のスキルの頁で持ち上げて別の石へ置ける。長押しで外す（外すと消える）」）。

### 6-3. CODE_MAP（統合役が各段のコミットで直す）

- 段 2: ui の行から `equipmentLayout.ts`・`bud.ts` を消し、`inventory.ts` を「装備画面の入口（開閉・頁の積み重ね・入力・共通の操作）」に。足す: `menuState.ts`・`menuFocus.ts`・`menuInput.ts`・`menuActions.ts`・`attire.ts`・`crestShape.ts`・`seen.ts`・`synergyBuild.ts`・`candidates.ts`・`crest.ts`・`flow.ts`・`skillPage.ts`・`actPage.ts`・`sheet.ts`・`anvil.ts`（説明は 4 章の各レーン）。render の行から `inventoryHelp.ts`・`skillRuneUi.ts` を消し、`inventoryUi` を「装備画面の枠・見出し・荷札・操作案内・頁の振り分け」に。足す: `itemTips.ts`・`attireUi.ts`・`crestDraw.ts`・`candidatesUi.ts`・`crestUi.ts`・`flowUi.ts`・`skillPageUi.ts`・`actPageUi.ts`・`sheetUi.ts`・`anvilUi.ts`。data の行に `sprites/attire`（装備画面の人影・部位 6 形・金床の模様。atlas を通さず塗る）
- 段 4: `synergyPanel.ts`・`synergyUi.ts` を消す
- 段 6: `statusTab.ts`・`echoTab.ts`・`stashFilter.ts`・`stashFacets.ts`・`statusTabUi.ts`・`echoTabUi.ts`・`stashToolbarUi.ts`・`detailPane.ts` を消し、`forge.ts`・`sheetBody.ts` を足す。`effectsList.ts` の説明を「書付「系譜」の祝福の行」に

---

## 7. 聞かずに決めたこと

1. 総称は「装備画面」のまま（キー設定のアクション名・Tips の term・GLOSSARY と揃える）。「持ち物メニュー」は設計文書の語
2. 持ち物キーは、開いている間は面の切り替えだけ。閉じるのは 1 段目での戻る（Esc / 右クリック / B）
3. 右クリック = 戻る。`PlayerInput.menuBackClickPressed()` で読み、FrameInput には足さない
4. 書付 = 拾うキーか奥義キー（パッド Y の既定が奥義なので）。キーボードの F でも開くが、案内には拾うキーだけを出す
5. 並びの送り = 受け流しキー（パッド RB の既定）で 合 → 新 → 名。LB はスキル層の押さえ専用で単独に取れないので使わない
6. 長押しは 0.6 秒（`MENU_HOLD_SECONDS`。UI の TS 定数でバランスの JSON に置かない）。長押しは壊す操作だけ（砕く・石の分解・符を外す）
7. 方向は押し続けると 0.35 秒後から 0.1 秒ごとに繰り返す（候補の送り用）
8. 新着は `meta.seenAt`。欠けていれば 0 なので、初回は全部が新着になる
9. 外した物は `equipItem` のまま倉庫の末尾に入り、候補の頁では `pinnedId` で先頭に出す（`loot/profile.ts` の付け替えを変えない）
10. 部位を外すのは候補の末尾の「空ける」（長押しにしない）
11. 系統で絞った候補は遺物だけ（石は入れない）
12. 鍛冶で装備中の物は受け手・対象にだけなる。捧げる側・砕く側は倉庫だけ（2-4）
13. 鍛冶場から開いた間は、紋へ替えて戻っても金床の構えのまま
14. 加護の頁の「乗る遺物」は行動の系統の表（左・右 = 近接、銃は射撃 / ダッシュ / 気力 / 奥義ゲージ）で選ぶ
15. 「外れた符」の置き場は作らない（符の仕組みを変えない）。下の列は「効かない符」。符は列（石）単位で置き、穴の位置は選ばない
16. 摂理・研鑽・真髄の全文と研鑽の数えは書付「系譜」。芯は書付「祝福」
17. 状態異常・一時強化の一覧は装備画面から消す（HUD のまま）。効果頁は無くなり、到達の行は書付「体」へ
18. 図鑑の「系統」の頁は 2〜8 に入れない（紋の「系統を選ぶ」盤で足りる。後回し）
19. 祝福の 3 択の紋の写しは y 18〜34 に置く（E の y 196〜214 は札 y 60〜210 と呪いの札 y 218〜232 に重なるため）
20. 荷札の 1 行目は `TEXT.BODY`（実装の BODY は 9px。E の「10px」はこれに読み替える）
21. 絵は atlas を通さず、`attire.ts` の模様を 1 画素ずつ塗る。金床も模様（`still.ts` の anvil は使わない）、壺は矩形
22. 方向の「↑↓←→」は案内の絵記号として固定で書く（移動キーの名ではない）。Enter は `keyLabel("confirm")`、Esc は固定、他は `keyLabel`
23. 新しい効果音名は足さない（`equipOn` / `equipOff` / `runeAttach` / `dismantle` / `boonSelect` / `uiClick` / `uiOpen` を使う）
24. 見出しの面の札はマウス専用の当たり（方向の移動で止まらない）。荷札のクリックは書付
25. 人影の荷札のステータスは目盛り（点）で出し、数字は書付だけ
26. 段 2 が後の段の頁を空実装で置き、操作の型（`MenuAct`）を全部先に決める（共有ファイルの衝突を無くすため）

---

## 8. 不確かな点

| 点 | 確かめ方 |
| --- | --- |
| 段 1 の公開の名前と形（実装済み: `resonanceBySource(state): ResonanceBySource`（`Record<Keyword, KeywordResonance>`。各系統に produces / consumes / amplifies の `ResonanceOrigin[]` と step）、`resonanceOrigins(state): OriginProfile[]`、`ResonanceOrigin { kind: "relic" \| "stone" \| "boon" \| "job" \| "form" \| "reforge" \| "keystone"; id; slot?; index? }`、`src/ui/tryOn.ts` の `tryOnBase(state)` → `tryOn(base, { kind: "relic"; slot; item \| null } \| { kind: "stone"; index; skillKey \| null }): TryOnResult { before; after: CrestBand[]; deltas: BandDelta[]; summary }`、`BandDelta { keyword; from; to; change: "up" \| "crack" \| "gone" \| "new" \| "same" }`、`crestBands(by)`・`beadsOfBand`・`thinnedKeywords`・`compareFit`、`src/ui/swapDiff.ts` の `swapDiff(candidate, current, depth): SwapDiff { rows; more; innate }`、`src/ui/menuBudget.ts` の `censusOfText(runs)` / `budgetViolations(census, mode)`） | 段 2 以降のレーンはこの実名で書く。`tryOn` が state と `LAST_COUNT` を書かないことは段 1 のテストで見る |
| 合の並びの計算の重さ（部位の倉庫が 70 件を超えると、開くたびに 70 回の数え直し） | E3 で倉庫 400 件の state を作り、`view.order` の計算を `performance.now()` で測る。16ms を超えたら並びを開いた後の 1 回だけにし、付け替えの後は外した物だけ差し込む |
| パッドで奥義キーを Y 以外に割り当てた人の書付 | パッド設定の初期値（`DEFAULT_PAD_BINDS`）の Y = special を前提にしている。割り当て直した人は割り当てたボタンで開く。気になればパッドの書付を固定の Y にする（`GamepadFrame` に 1 欄足す）のを後で判断 |
| 9px の BODY で荷札 1 行目（部位名 + 遺物名 + 芽）が 464px に収まるか | E2 の描画テストで最長の名前（名のある遺物 + 銘）の `textWidth` を見て、超える分は `truncateText` |
| 段 2 と段 3〜6 の間のコミットでは、候補・書付・鍛冶・スキルの付け外しがゲームで使えない | 段 2〜7 を 1 つの版にまとめ、途中で版を上げない（AI_WORKFLOW の「REPLAY_VERSION は段の終わり」と同じ扱い） |

読み替えの注: 本文中の `tryOnRelic(state, slot, item)` / `tryOnStone(state, i, stone)` は `tryOn(tryOnBase(state), { kind: "relic"; slot; item } / { kind: "stone"; index; skillKey })`、`TryOnResult.changes` / `BandChange`（trend の down）は `deltas` / `BandDelta`（change の crack）、`relicSwapDiff` は `swapDiff`、`ResonanceSource` / `SourcedProfile` は `ResonanceOrigin` / `OriginProfile`、`measureMenuBudget` は `censusOfText` + `budgetViolations` に読み替える。

関係するファイル: `/home/user/roguelike/docs/ideas/inventory-v2/E-merged.md`、`/home/user/roguelike/docs/ideas/previews/inv2/E.html`、`/home/user/roguelike/src/ui/inventory.ts`、`/home/user/roguelike/src/render/inventoryUi.ts`、`/home/user/roguelike/src/main.ts`（431・746・774〜793・1801〜1808 行）、`/home/user/roguelike/src/core/input.ts`、`/home/user/roguelike/src/core/replay.ts`（`captureLoadout` 420 行・`applyEvent` 724 行）、`/home/user/roguelike/src/loot/crafting.ts`（`applyEchoResult`）、`/home/user/roguelike/src/system/resonance.ts`、`/home/user/roguelike/src/ui/hubFlow.ts`、`/home/user/roguelike/src/system/boons.ts`（`BOON_CARD` 821 行）。
