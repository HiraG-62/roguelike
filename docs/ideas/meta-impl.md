# メタと上達の実装設計（段取り 9）

作成日: 2026-09-30。`docs/ideas/core-synthesis.md` 9 章の段取り 9 を architect が確定リストまで設計したもの。★（ユーザー確認）の結果は下の「決めたこと」に書く。

## 決めたこと（ユーザー確認済み 2026-09-30）

- ★1 表示名は案のとおり確定（死因 / 次の山 / 前回比 / 余波 / 流れ弾 / 落下物 / 仇〔名札「仇・」〕/ 仇の気配 / 仇討ち / 予告の図解 / ボスの間 / 踏破の碑、実績 7 件）
- ★2 解放制は今までのセーブにも効かせる（新しい保存値は足さない）
- ★3 ボスの間の装備は今の装備の写し


作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 9「メタと上達: 死因と次・予告の図解・仇・解放制・位階と依頼・ボスの間」（元は `encounter-core.md` 12 章 Q8 と 9 章・8-6・10-1、`run-arc.md` 1-3・1-6）。段取り 8（`boss-impl.md`）の `state.bossLog` / `BossRecord`（`src/system/bossRecord.ts`）・`GameStatus "cleared"`・`runOver`・`BOSS_THREATS`（`src/system/bossKit.ts:81`）・`chapterAheadLines`（`src/system/chapters.ts:75`）を読む側として使い、8b のファイルは作り直さない。行番号は main の作業ツリー（`0c47a24` + 8b E2 の取り込み中）で確かめた値。

---

## 0. 結論

- **ランの外の記録は全部「今ある保存キーの任意項目」で持つ。`v2` は切らない・新しい保存キーも作らない**。履歴（`roguelike.profile.v1` の `meta.history[]`）に死因・位階・被弾・見切り・カウンター・無傷の階・仇の種・仇討ちを、`meta` に踏破の回数と最高位階を、図鑑（`roguelike.codex.v1`）に「倒された回数」`enemyDeaths` を、拠点（`roguelike.hub.v1`）にボスの間の記録 `hall` を足す。古いデータは欄が無い = 既定値で読め、永続データは何も消えない。
- **ランの中身を変える永続の情報（仇・解放の封じ・位階の見返り）は `RunSetup.runMeta` 1 つに束ねて写す**（`lockedRelics` と同じ道: `RunSetup` → `ReplayData.runMeta` → `GameState.runMeta`）。**空の `runMeta` は今と同じ乱数消費**なので、QA・既存のテスト・旧いリプレイはそのまま通り、**`REPLAY_VERSION` は上げない**。
- 中身: 被弾のたびに `state.hurt` へ「誰に・どの種類で」を書き（乱数なし）、死亡画面に **死因 / 次の山 / 前回比** の 3 行。同じ敵に 3 回倒されると図鑑からその敵の **予告の図解**（予告の形・赤の始まり・隙・安全な場所）を開ける。直近の死の相手が次のランで **仇**（修飾子 +1・猛・名札に「仇・」）として眠った陣に 1 体混ざり、倒すと遺物と鍵。**解放制**は契約者 3・追加の部屋 5・ランイベント 9 から始め、章ボスの撃破（図鑑）と依頼の達成で開く。**位階**は踏破した最高位階で章の市の品 +1（3）・出口 +1（10）と称号。依頼は持ち物の語で 3 択に重みを付け、HUD に進み 1 行。**ボスの間**は拠点の新しい台で、倒した章ボス（と最深の主）に今の装備の写しで挑み、最速と最少の被弾を残す。
- 段は **9a（A 器・死因・仇 ∥ D ボスの間 ∥ E 依頼の実利）→ 9b（B 予告の図解 ∥ C 解放制と位階）**。全レーン worktree。9a は 8b の E2 の取り込み後に切る（F は `src/qa/` だけなので並行でよい）。

---

## 1. 今のコードの地図（根拠）

| 何 | どこ | 観察 |
| --- | --- | --- |
| 被弾 | `src/system/combat.ts:505-508`（`DamagePlayerOptions` は `noJust` だけ）、`:523-599`（`damagePlayer`。`attacker?: Enemy` だけが出どころ。hit で `noteBossFightHit`、死ぬと `killPlayer` の後に return するので `onHurt` イベントは致命の一撃で出ない）、`:601-607`（`damagePlayerDot` は出どころ無し）、`:684-699`（`killPlayer`）、`:705-713`（`recordRunOnce`） | 誰に倒されたかはどこにも残らない。QA は `src/qa/simulation.test.ts:740-758` の `guessDeathCause`（最寄りの敵）で推測している |
| 被弾の呼び元 17 | `projectiles.ts:406`（撃ち手が死んでいると `attacker` が undefined）、`hazards.ts:191`（`hitPlayerBy`。`h.sourceKey` はあるが渡さない）、`hazards.ts:212`（`explodeHostile`。`source.defKey` あり）、`impacts.ts:47`、`reaperVariants.ts:127, 158`、`linger.ts:173`、`runEvents.ts:1042, 1080`、他は敵本人（`enemies.ts:1006` など）。継続: `terrain.ts:505`（溶岩）、`statusEffects.ts:675`（反応の即時）、`:937`（`dealDot`。`effect.kind` あり）、`combat.ts:645`（遅れて来る傷）、`linger.ts:204`（潮） | 出どころを渡せば全部拾える |
| 履歴 | `src/loot/types.ts:276-287`（`RunHistoryEntry`: date / seedText / depth / kills / score / bestCombo / durationSec / cause?）、`:289-296`（`ProfileMeta`）、`src/loot/profile.ts:38`（`HISTORY_LIMIT = 20`）、`:253-267`（`sanitizeHistoryEntry` は**知らない欄を落とす**）、`:440-446`（`recordRun`）、`src/ui/title.ts:565-576`（`buildHistoryEntry`） | 新しい欄は sanitize を足さないと読み込みで消える。20 件で切れるので「最高位階」「踏破の回数」を履歴から導くと失われる |
| ランの終わりの配線 | `src/main.ts:234-236`（`withLockedRelics`）、`:416-438`（`beginRun`）、`:443-462`（`endRun`: 履歴 → 保存 → `recordMeta` → 寄進 → リプレイ）、`:474-483`（`recordMeta`: 図鑑・依頼・実績）、`:1771-1776`（`drawDeathSummary` に `metaLines`） | 死亡画面の行は `deathMetaLines`（依頼・図鑑・実績、最大 2 行） |
| 死亡画面 | `src/render/renderer.ts:3200-3217`（`drawDeath`: 見出し・集計・スコア・`:3216` の Enter の案内）、`src/render/titleUi.ts:703-722`（`drawDeathSummary`: +60 遺物 / +72 ボス / +90 Enter の案内 / +102 から 11px ごとに metaLines） | 270px の下端まで metaLines は 3 行しか入らない。`:3216` の案内は `drawDeathSummary` の +90 と重複（両方 0.6 秒後に出る） |
| 出発条件と記録 | `src/system/runSetup.ts:139-155`（`RunSetup`）、`src/core/replay.ts:141`（`ReplayData.lockedRelics`）、`:626`（`finish`）、`:689`（`createReplaySession` が setup を組み直す）、`:863-865`（空なら書かない）、`:928`（`sanitizeReplay`）、`src/core/game.ts:122`、`src/system/hub.ts:162` | 永続データ → ランの中身、の前例。GameState を組む所は `game.ts` と `hub.ts` の 2 か所だけ |
| 図鑑 | `src/meta/codex.ts:155-172`（`CodexSave`）、`:284-299`（`recordCodex`）、`:319-332`（`enemyEntries`）、`:424-441`（`placeEntries`）、`src/meta/codexStore.ts:23-37`（`parseCodexSave`。欄ごとに sanitize） | 倒した回数（`enemyKills`）はあるが倒された回数は無い |
| 一覧画面 | `src/meta/listScreen.ts:9-20`（`ListEntry`）、`src/render/codexUi.ts`（下の説明は 2 行）、`src/main.ts:573-584`（`updateListScreenFrame`: activate は実績の称号だけ）、`:1700-1711`（描画） | 図解は一覧の説明欄に入らない。activate で別の画面を重ねる |
| 予告の形 | `src/system/behaviors/base.ts:8-17`（`EnemyTelegraph`: line / laser / ring / cross / cone）、`src/system/enemies.ts:1237-1300`（`enemyTelegraph` → `enemyTelegraphShape` → wave3 → `bossTelegraph` → 既定の線）、`src/system/poise.ts:57-60`（`windupCommitted` = 残りが `ENEMY_TEMPO.commitRatio` を切るとコミット）、`src/data/enemies.ts:121-164`（`volley` / `explode` / `lob`）、`src/system/bossKit.ts:81-87`（`BOSS_THREATS`） | 図解は手書きせずデータから導ける |
| 精鋭・陣 | `src/system/elites.ts:149-165`（`rollElite`）、`:166-170`（`makeElitePair`）、`:179-188`（`eliteKindsFor` / `eliteKindsForRole`）、`:200-210`（`makeElite`）、`:295-304`（`eliteDisplayName`）、`src/system/jinSpawn.ts:85-107`（`applyHpMul` / `makeStrong`）、`:366-374`（`spawnMember` は非公開）、`:406-428`（`freeSpotNear` は非公開） | 仇は既存の部品で作れる。陣に 1 体足す公開関数だけ要る |
| 敵の死 | `src/system/enemyTraits.ts:117-133`（`onEnemyDeath`。末尾 `:132` に `noteBossMinionDeath`） | 仇討ちの報酬はここから 1 行 |
| 階の組み立て | `src/system/floor.ts:100-190`（`buildFloor`。乱数の順を守るため後ろに足していく作法。`:189` が `state.pendingExit = null`） | 仇の配置は末尾に置けば既存の抽選を動かさない |
| 解放の対象 | `src/system/contractors.ts:39`（`CONTRACTOR_KEYS` 9）、`:192-200`（`pickContractor` が唯一の抽選）、`src/system/specialRooms.ts:235-254`（`assignExtraRoomKinds`: `ROOM_KIND.extra` 20 種を表の順に `rng.chance`）、`src/system/runEvents.ts:42-73`（`RUN_EVENT_KEYS` 28）、`:258-264`（`rollFirst` = 4 つの表の唯一の抽選。allowed が false なら乱数を引かない） | 3 か所に 1 行ずつ足せば封じられる。依頼・起点・ジョブ・遺物の解放（`src/meta/quests.ts:334-374`）が前例 |
| 位階 | `src/system/runSetup.ts:86-129`（縛り 11、`runTier` = 点の合計、最大 20）、`src/meta/achievements.ts:80-124`（実績 41） | 位階の見返りは得点の倍率だけ（`tierScoreMul`） |
| 市と出口 | `src/system/merchants.ts:154-166`（`stockPlan` / `merchantKindFor`: 章ボスの階は `chapterMarket`）、`:234-255`（`placeMerchants`）、`src/system/specialRooms.ts:1199-1211`（`planForkStairs`: `apprenticeExtraExits` が出口を足す前例） | 見返りは足し算 1 か所ずつ |
| 依頼 | `src/meta/quests.ts:170-280`（32 種）、`:397-411`（`pickQuestOffers`: ランの seed の別系統の乱数、`state.rng` は使わない）、`src/meta/screens.ts:108-113`（`questStatusLine` はポーズ画面だけ） | 依頼はゲーム進行に効かない（リプレイに関係しない） |
| 拠点 | `src/map/hubMap.ts:19-37`（ASCII の配置）、`src/meta/hub.ts:13-40, 63-71`（設備は保存データから導く）、`src/meta/hubStore.ts:11-41`（`HubSave` と任意項目 `donated` の前例）、`src/ui/hubFlow.ts:23-44`（台 → 画面）、`src/render/hubUi.ts:44, 58`、`src/main.ts:682-700`（`openHubSpot`）、`src/system/hub.ts:78-98`（拠点は `stepHub` の sandbox。ボスの部屋・封鎖・記録は動かない） | ボスの間は `createGame` で本物の階を作る方が少ない |
| 装備の写し | `src/core/replay.ts:414-425`（`captureLoadout`）、`:522-527`（`createReplayProfiles`）、`:760-762`（`guardStorageWrites`） | ボスの間はリプレイ再生と同じ「一時プロフィール + 保存の抑止」で作れる |

---

## 2. 設計

### 2-1. 被弾の記録（死因の元。`src/core/hurt.ts` 新・`src/system/deathCause.ts` 新）

```ts
// src/core/hurt.ts（loot/types.ts からも読むので core に置く。純粋）
export const HURT_KINDS = ["strike", "shot", "blast", "hazard", "fall", "status", "terrain", "reaper", "linger", "event", "deferred"] as const;
export type HurtKind = (typeof HURT_KINDS)[number];
export interface HurtCause { kind: HurtKind; key?: string }
export interface HurtRecord {
  kind: HurtKind;
  /** 敵の key / 状態異常 / 地形 / ランイベントの key。撃ち手の消えた敵弾・出どころ不明は "" */
  key: string;
  /** 敵のとき: 精鋭の修飾子（主 → 添え）。それ以外は [] */
  elites: string[];
  /** 仇が与えた */
  nemesis: boolean;
}
export interface HurtLog { last: HurtRecord | null; lastEnemy: HurtRecord | null }
export function createHurtLog(): HurtLog;
export function isHurtKind(v: unknown): v is HurtKind;
```

```ts
// src/system/deathCause.ts（import は core/state・core/hurt・data/enemies だけ。輪を作らない）
export function noteHurt(state: GameState, attacker: Enemy | undefined, cause: HurtCause | undefined): void;
/** 力尽きたときの最後の被弾（status が "dead" でなければ null） */
export function killerOf(state: GameState): HurtRecord | null;
/** 仇になれる敵か（ボス・片割れ・部屋主・weight 0・商人・入れ物・inert / mine / egg・timid は不可、未知の key も不可） */
export function nemesisEligible(key: string): boolean;
/** 仇の種: killer が敵で適格ならそれ、でなければ lastEnemy が適格ならそれ、無ければ null */
export function grudgeOf(state: GameState): { key: string; elites: string[] } | null;
```

- `noteHurt` の決め方: `key = cause?.key ?? attacker?.defKey ?? ""`、`kind = cause?.kind ?? (attacker ? "strike" : "hazard")`、`elites = [attacker.elite, attacker.eliteExtra]` の定義済みだけ、`nemesis = attacker?.nemesis === true`。`state.hurt.last` を上書きし、`attacker` があれば `lastEnemy` も上書き。**乱数を使わない**
- 呼ぶ所: `damagePlayer` の被ダメ確定後（`p.hp = …` の直後。致命でも記録してから `killPlayer`）、`damagePlayerDot(state, amount, cause?)` の `amount > 0` のとき
- `DamagePlayerOptions` に `cause?: HurtCause` を足す。渡すのは次の 11 か所だけ（他は `attacker` からの推定で足りる）

| 呼び元 | cause |
| --- | --- |
| `projectiles.ts:406` | `{ kind: "shot" }`（key は attacker から。撃ち手が消えていれば ""） |
| `hazards.ts:191`（`hitPlayerBy`） | `{ kind: "hazard", key: h.sourceKey }` |
| `hazards.ts:212`（`explodeHostile`） | `{ kind: "blast", key: source?.defKey }` |
| `impacts.ts:47` | `{ kind: "fall", key: "" }` |
| `reaperVariants.ts:127, 158` | `{ kind: "reaper", key: "reaper" }` |
| `linger.ts:173` | `{ kind: "linger", key: "shadow" }` |
| `runEvents.ts:1042` | `{ kind: "event", key: "thunderstorm" }` |
| `runEvents.ts:1080` | `{ kind: "event", key: "reaperPass" }` |
| `terrain.ts:505`（溶岩の `damagePlayerDot`） | `{ kind: "terrain", key: "lava" }` |
| `linger.ts:204`（潮） | `{ kind: "terrain", key: "water" }` |
| `statusEffects.ts:937`（`dealDot`） | `{ kind: "status", key: effect.kind }` |
| `statusEffects.ts:675`（`hurtTarget`） | `{ kind: "status", key: "reaction" }` |
| `combat.ts:645`（遅れて来る傷） | `{ kind: "deferred", key: "" }` |

### 2-2. 死因と次（死亡画面の 3 行と履歴。`src/meta/deathReport.ts` 新）

**履歴の新しい欄**（`RunHistoryEntry` の任意項目。値が 0・空なら書かない）

| 欄 | 型 | 中身 |
| --- | --- | --- |
| `killer` | `{ kind: HurtKind; key: string; elites?: string[]; nemesis?: true }` | 力尽きたときの `killerOf(state)` |
| `grudge` | `{ key: string; elites: string[] }` | `grudgeOf(state)`（仇の種。力尽きたときだけ） |
| `avenged` | `true` | このランで仇を討った |
| `tier` | `number` | `runTier(state.modifiers)`（0 は書かない） |
| `job` | `string` | `state.job`（`none` は書かない） |
| `hurts` / `justDodges` / `counters` / `noHurtFloors` | `number` | `state.questRun.counters` の `hurts` / `justDodges` / `counters` / `floorsNoHurt` |

`ProfileMeta` に `clears?: number`・`bestClearTier?: number`（履歴は 20 件で切れるので別に持つ）。`recordClear(profile, tier)`（`loot/profile.ts`）を `main.ts` の `endRun` が `status === "cleared"` のとき呼ぶ（`combat.ts` から `runSetup.ts` を import しないため）。

**図鑑**: `CodexSave.enemyDeaths: Record<string, number>`（倒された回数）。`recordDefeat(save, key: string | null)`（`isEnemyKey` の key だけ +1）を `main.ts` の `recordMeta` が呼ぶ。

**死亡画面の行**（`deathReportLines(entry, previous, codex): string[]`。最大 3 行。`drawDeathSummary` の新しい `reportLines` に渡す）

| 終わり方 | 1 行目 | 2 行目 | 3 行目 |
| --- | --- | --- | --- |
| 力尽きた | 敵: `死因: {仇・}{精鋭の接頭辞}{敵名}の{種類}（倒された回数 {n}）`。敵でない: `死因: {状態異常名 / 地形名 / 死神 / 長居の代償 / ランイベント名 / 遅れて来る傷 / 落下物}` | `次の山: 地下 {d} 階 {ボス名}`（`nextPeakOf(depth)`。深み = null なら行を出さない） | 前回比（下） |
| 踏破 | `踏破: 位階 {tier}（{clears} 回目）` | （9b の C が「次の見返り」の行を足す） | 前回比 |
| 離脱 | 行なし | | |

- 種類の語（`HURT_KIND_WORD`、TS）: strike 一撃 / shot 射撃 / blast 爆発 / hazard 余波。撃ち手の消えた敵弾は `流れ弾`、hazard で key が空は `余波`
- 前回比: `前回比: 到達 {±n} 階 / 被弾 {±n} / 見切り {±n}`。比べる相手は `previousComparable(history)` = 今回より前の履歴で、離脱でなく、`hurts` を持つ最初の 1 件（デイリーと通常は混ぜない）。無ければ行を出さない。0 は `±0`
- 位置: `titleUi.ts` の `DEATH_REPORT_TOP = 28`（`VIEW_H / 2` から）、行高 `Math.max(11, textLineHeight(TEXT.SMALL))`、3 行で 163〜185。`renderer.ts:3216` の Enter の案内は `drawDeathSummary` の +90 と重複しているので消して場所を空ける
- 履歴画面（`titleUi.ts:403` の `cause` の表示）の後ろに `（{死因の短い名}）` を `truncateText` で添える
- `nextPeakOf(depth): { depth: number; key: string } | null`（`system/chapters.ts` に純関数）: depth 以上で最初の章ボスの階（5 / 10 / 15 / 20）か最深の間（21）。21 を超えたら null

### 2-3. 予告の図解（`src/system/telegraphDiagram.ts` 新・`src/render/telegraphDiagramUi.ts` 新）

- 開く条件: `codex.enemyDeaths[key] ≥ META.diagramDeaths`（3）。図鑑の敵の頁でその行の info に「図解」、detail の末尾に `Enter: 予告の図解`。Enter / クリックで全画面の重ね描き、Esc で一覧へ戻る
- データは手書きしない。`telegraphDiagram(def: EnemyDef): TelegraphDiagram`（純関数）

```ts
export type DiagramShape =
  | { kind: "line"; length: number }
  | { kind: "laser"; count: number; spreadDeg: number }
  | { kind: "ring"; radius: number }
  | { kind: "cone"; range: number; halfDeg: number }
  | { kind: "cross" }
  | { kind: "volley"; count: number; spreadDeg: number }
  | { kind: "landing"; radius: number }
  | { kind: "touch" };
export interface TelegraphDiagram {
  shape: DiagramShape;
  windup: number;      // def.windup
  commitFrom: number;  // def.windup × (1 − ENEMY_TEMPO.commitRatio)。ここから赤（怯まない）
  strike: number;      // def.strikeTime
  recover: number;     // def.recover（隙）
  safe: string;        // 安全な場所の一言（形から。下の表）
  /** ボスだけ: 段階 1〜3 の危ない間合い（BOSS_THREATS）。無ければ undefined */
  threats?: readonly ThreatBand[];
}
```

| 優先 | 条件 | 形 | safe |
| --- | --- | --- | --- |
| 1 | `def.explode` | ring（`explode.radius`） | 輪の外 |
| 2 | behavior `laser` か `def.laserBeams` | laser（`laserBeams.count` / `spreadDeg`、無ければ 1 / 0） | 線の外 |
| 3 | `def.lob` | landing（`lob.blastRadius`） | 影の外 |
| 4 | `def.volley` | volley（`count` / `spreadDeg`） | 弾の間 |
| 5 | `enemyTelegraph(stub, def)` が非 null | line / ring / cone / cross / laser をそのまま | 線の横 / 輪の外 / 扇の後ろ / 斜め / 線の外 |
| 6 | それ以外で `contactDamage > 0` | touch | 触れない間合い |

- `stub` は `telegraphDiagram.ts` の中で組む最小の `Enemy`（phase `windup`・`ai` なし・向き `{1,0}`。形は `system/enemies.ts` の `createEnemy` の戻り値に合わせる）。`ai.move` を読む敵は「最初の技」の形になる（それで足りる）
- ボス（`def.boss`）は `threats = BOSS_THREATS[def.key]`。描画は段階 1〜3 の 3 行（`近いと危ない / 遠いと危ない / 動くと危ない / 止まると危ない`）
- 描画（`drawTelegraphDiagram(ctx, def, diagram)`）: 中央に敵の絵（`render/sprites.ts` の `getSprite` + `drawFrame`）、右向きの予告の形を黄の輪郭、赤の塗り、安全な側を緑で薄く。下に時間の帯（黄 = windup − commitFrom、赤 = commitFrom、白 = strike、緑 = recover。秒を添える）と、`受け流し・見切りで止める` の 1 行。文字は全部 `drawText` / `wrapText`

### 2-4. 仇（`src/system/nemesis.ts` 新）

```ts
// src/system/runMeta.ts
export interface NemesisSpec { key: string; elites: EliteKind[]; depth: number }
// src/system/nemesis.ts
export interface NemesisRun { spec: NemesisSpec; spawnDepth: number; enemyId: number | null; placed: boolean; avenged: boolean }
export function createNemesisRun(spec: NemesisSpec | null): NemesisRun | null;
export function placeNemesis(state: GameState): void;          // floor.ts の buildFloor の末尾（:189 の直前）
export function onNemesisDeath(state: GameState, e: Enemy): void; // enemyTraits.ts の onEnemyDeath の末尾
```

- **選び方**（`meta/runMetaSetup.ts` の `nemesisFromHistory(history)`）: 履歴を新しい順に見て、デイリーの行は飛ばす。最初の「力尽きた」の行の `grudge` を返す（無ければ null。仇を討った後に力尽きた行も、討った後の死なのでその `grudge`）。それより先に `avenged` の行（離脱・踏破）に当たったら null。離脱・踏破の行は飛ばす。深度は `entry.depth`。`nemesisEligible` と `ELITE_KINDS` で key と修飾子を濾す
- **出る階**: `spawnDepth = max(NEMESIS.minDepth, spec.depth − NEMESIS.depthLead, def.minDepth)`。`depth ≥ spawnDepth` で、`isBossDepth` でなく、`state.sandbox` でない最初の階。**上り階段で戻った階・2 体目は出さない**（`placed` で 1 ラン 1 体）
- **置き方**（乱数なし）: `state.jins` のうち `roomIndex !== ROAMING_ROOM` かつ `phase === "sleeping"` の陣を、陣の中心と開始地点の距離の遠い順（同じなら id の小さい順）に試し、`addJinMember(state, jin, def, jin.center)`（`jinSpawn.ts` に新設。`freeSpotNear` + `createEnemy` + `jinId` + `applyHpMul(jin.hpMul)` + `onRunEnemySpawned` + push）で置けた最初の 1 体。置けなければ次の階で再挑戦
- **強さ**（乱数なし）: 記録の修飾子を `eliteKindsFor(def)` で濾し、0 個 → `makeElite(e, eliteKindsForRole(def, roleOf(def))[0])`、1 個 → `makeElitePair(e, main, extra)`（extra = `ELITE_PAIRS` で main と組む最初の許される相手、無ければ main 以外の最初の許される種類）、2 個 → `makeElitePair(e, a, b)` + `applyHpMul(e, NEMESIS.maxedHpMul)`。全員 `makeStrong(e)` + `applyHpMul(e, NEMESIS.hpMul)`。`e.nemesis = true`
- 名札: `eliteDisplayName` の頭に `e.nemesis ? "仇・" : ""`（`elites.ts:303` の return に 1 行）
- 着いたとき: ログ `仇の気配: {名前}` と `pushSfx("runEventWarn")`
- **仇討ち**: `onNemesisDeath` で `e.nemesis && !e.vanished && !e.revived` なら `avenged = true`、`dropItem(state, pos, NEMESIS.rewardBoost)` × `rewardItems`、`dropKey` × `rewardKeys`、浮き文字 `仇討ち`、ログ `仇を討った: {名前}`、`pushSfx("questComplete")`
- 仇に倒されると次の仇も同じ敵で、そのときの修飾子（+1 済み）から更に +1（2 個で頭打ち、以後は生命の倍率）

### 2-5. 解放制（`src/meta/unlocks.ts` 新。9b の C）

条件は既存の保存データ（図鑑の撃破・依頼の達成）から導く = **新しい保存値を持たない**。表は TS（key の関係なので）。

```ts
export type UnlockCondition = { kind: "start" } | { kind: "chapterBoss"; chapter: number } | { kind: "quest"; quest: QuestKey };
export const CONTRACTOR_UNLOCKS: Readonly<Record<ContractorKey, UnlockCondition>>;
export const ROOM_UNLOCKS: Readonly<Record<ExtraRoomKind, UnlockCondition>>; // ExtraRoomKind = keyof typeof ROOM_KIND.extra
export const EVENT_UNLOCKS: Readonly<Record<RunEventKey, UnlockCondition>>;
export interface UnlockSources { codex: Readonly<CodexSave>; quests: Readonly<QuestSave> }
export function isUnlocked(cond: UnlockCondition, src: UnlockSources): boolean; // chapterBoss = codex.enemyKills[ARC.chapters[chapter-1].boss] > 0
export function lockedRunContent(src: UnlockSources): Pick<RunMetaSetup, "lockedRooms" | "lockedContractors" | "lockedEvents">;
export function unlockHint(cond: UnlockCondition): string;     // `{ボス名}を倒すと現れる` / `依頼「{名}」の達成で現れる`
export function questUnlockLabels(key: QuestKey): string[];     // `契約者「{名}」がランに現れる`
export function unlockNewsLines(before: UnlockLocked, after: UnlockLocked): string[]; // 死亡画面: `新しく現れる: 部屋 5・出来事 7` / `契約者「渡し守」が現れる`
```

| 条件 | 契約者（9） | 追加の部屋（20） | ランイベント（28） |
| --- | --- | --- | --- |
| 最初から | 行商・修理屋・占い | 図書館・賭博・試し場・祭壇・見張り台 | 増援・賞金首・地震・宝の雨・勢いの風・流星群・停電・蝙蝠の渡り・決闘の申し込み |
| 章 1 の主を倒す | — | 鍛冶場・交換所・封印庫・逃走・闘技場 | 気力枯渇・刻の裂け目・呪いの風・霧・鈍重・残響の鉱脈・生命の逆流 |
| 章 2 の主を倒す | — | 属性の祭壇・共鳴炉・潮の間・霧の部屋・護衛・巣 | 血の月・狂乱の月・縮みの呪い・呪詛の声・地形の氾濫・静寂・盗賊の追跡 |
| 章 3 の主を倒す | — | 鏡・反転の間・死神の巣・呪いの祠 | 反応の共振・雷鳴の刻・属性の嵐・死神の通り道・流れ星 |
| 依頼 | 灰の公証人 ← 部屋主狩り / 賭場の主 ← 深みへ / 語り部 ← 未踏の連携 / 鍛冶 ← 燃え尽き / 案内人 ← 糸の綾 / 渡し守 ← 雷の狩り | — | — |

（部屋 5 + 5 + 6 + 4 = 20、出来事 9 + 7 + 7 + 5 = 28。依頼の報酬そのものは変えず、解放を 2 つ目の報酬として足す = 既存の称号は消えない）

- **封じ方**（ゲーム側。空なら今と同じ乱数消費）
  - `contractors.ts` の `pickContractor`: 封じた key の重みを 0 として合計と引き算から外す（`rng.next()` は 1 回のまま）
  - `specialRooms.ts` の `assignExtraRoomKinds`: ループの頭で `state.runMeta.lockedRooms.includes(kind)` なら `continue`（`rng.chance` の前。乱数を引かない）。賭博師の起点の賭博の部屋と出口の「危険」（`applyExitDanger`）は封じない（プレイヤーが選んだもの）
  - `runEvents.ts` の `rollFirst`: `if (!allowed(key) || state.runMeta.lockedEvents.includes(key)) continue;`（4 つの表と占いの先読み `rollFloorEventKey` を 1 行で覆う）。無限の深みの変異（`mutationsFor`）は封じない
- 画面: 依頼の一覧の detail に `questUnlockLabels`（`screens.ts` の `questEntry`）、死亡画面の依頼の達成行に同じ文（`metaSummaryLines`）、図鑑の「場所」タブの未踏の部屋の detail に `unlockHint`（`screens.ts` の `codexListTabs` で後から足す。`codex.ts` から unlocks を import しない = 輪を作らない）、死亡画面に `unlockNewsLines`（`recordMeta` の前後の差）
- デイリー（`isDailySeedText`）は封じない（`runMeta` を空に）

### 2-6. 位階と依頼

**位階の見返り**（`src/meta/tierRewards.ts` 新。9b の C）。踏破した最高位階 `meta.bestClearTier` から導く（`clears > 0` のときだけ）。

| 最高位階 | 見返り | 仕組み |
| --- | --- | --- |
| 0 以上で踏破 | 実績「踏破者」 | `achievements.ts` |
| 1 | 実績「縛りを越えた者」 | 同 |
| `TIER_REWARD.marketTier`（3） | 章の市の品 +`marketExtra`（`{ "rune": 1 }`） | `runMeta.perks` に `"market"`。`merchants.ts` の `placeMerchants` で `kind === "chapterMarket"` のとき plan に足す |
| 5 / 15 / 20 | 実績「百戦の踏破者」「羅刹の踏破者」「極位の踏破者」 | 同 |
| `TIER_REWARD.exitTier`（10） | 出口 +`exitExtra`（1）と実績「鉄鎖の踏破者」 | `runMeta.perks` に `"exit"`。`specialRooms.ts` の `planForkStairs` の本数に足す |
| — | 拠点の飾り `踏破の碑（踏破 {n} 回・最高位階 {t}）` | `meta/hub.ts` の `hubDecorations` |

```ts
export function tierPerks(meta: Readonly<ProfileMeta>): TierPerk[];
export function nextTierRewardLine(meta: Readonly<ProfileMeta>): string | null; // `次の見返り: 位階 {t} で踏破 → 章の市の品 +1`
export const CLEAR_TITLE_TIERS = [1, 5, 10, 15, 20] as const; // 実績の key（clearTier1 …）に使うので TS
```

実績 +7: `clear` 踏破者 / `clearTier1` 縛りを越えた者 / `clearTier5` 百戦の踏破者 / `clearTier10` 鉄鎖の踏破者 / `clearTier15` 羅刹の踏破者 / `clearTier20` 極位の踏破者 / `avenge` 仇討ち（`history` のどれかが `avenged`）。41 → 48 種。

**依頼の実利**（9a の E）

- `QuestDef.keywords?: readonly Keyword[]`（`core/keywords.ts` の語をそのまま使う）。表:

| 依頼 | 語 | 依頼 | 語 |
| --- | --- | --- | --- |
| 燃え尽き | burn | 凍てつく刃 | chill |
| 蒸気の手 | burn, chill, reaction | 毒の庭 | poison |
| 揺さぶり | stagger | 血の道 | bleed |
| 反応の目録 | reaction | 急所読み | crit |
| 連携の稽古 | mana | 詠唱の道 | mana |
| 巣窟崩し | area | 試練を越えて | clear |
| 無傷の階 | ward, dash | 部屋主狩り | elite |
| 見切りの舞 | just, dash | 雷の狩り | shock |
| 返し手 | counter | 全力解放 | energy |
| 五重苦 | burn, chill, shock, poison, bleed | 新しい反応 | reaction |
| 王殺し・誓約を持たずに・呪いを抱く・大博打・死神と踊る・連鎖の糸・三段の連鎖・深みへ・未踏の連携・連携の型・糸の綾・網の目 | なし | | |

- `loadoutKeywords(profile, skillProfile): Set<Keyword>` = `statsKeywords(computeStats(profile.equipment))` と装着中の石の `skillKeywords` の produces ∪ consumes ∪ amplifies
- `pickQuestOffers(save, seed, count, build = new Set())`: 重み = `1 + META.questTagWeight × |def.keywords ∩ build|`。**全ての重みが 1 のときは今の `rng.int(0, rest.length - 1)` の道を通す**（同じ seed で同じ 3 択 = 既存のテストが通る）。重みがあるときは `rng.next() × 合計` で選ぶ
- HUD の 1 行: `render/questHud.ts` の `questHudText(state): string | null`（`questStatusLine` を使う）と `drawQuestHud(ctx, state)`。ミニマップの直下に右寄せ、`TEXT.SMALL`、依頼を受けていないと描かない。`main.ts` の playing の描画で `drawBudUi` の直後に 1 行

### 2-7. ボスの間（9a の D）

- 設備 `hall`（表示「ボスの間」）: 図鑑で `hallBossKeys()` のどれかを倒していれば建つ（`builtFacilities`）。台 `hall` を `hubMap.ts` の 6 行目（記録室の並び `H C R` の右、列 24）に置く
- 台 → 一覧（祭壇と同じ `ListScreen`）: 候補は `hallBossKeys()` = `ARC.chapters[].boss` → `ARC.finalBoss`（重複なし。8b の取り込み後は最深の主）。未撃破は `？？？`（挑めない）。info `最速 {s} 秒・被弾 {h}` か `未撃破`、detail `地下 {d} 階。挑戦 {n} 回・撃破 {w} 回。Enter で挑む`
- 挑む: 装備は **今の装備（武器掛けの借り物を含む）の写し**、ジョブは直近の `runSetup.job`、祝福なし。`createHallGame` → `hallFight` 画面で `step` を回す（リプレイ再生の分岐と同じ固定ステップ）。保存は `guardStorageWrites()` で抑え、`endRun` / `recordMeta` / 履歴 / リプレイの記録を通さない（`state` 変数に入れない）
- 終わり: `hallOutcome(state).done`（ボス撃破 or `runOver`）になった瞬間に step を止め、結果を重ねる。`撃破 {s} 秒・被弾 {h}・ダウン {d}` / `最速 {s} 秒（更新）` / `Enter: もう一度　Esc: 拠点へ`。倒れたら `力尽きた {s} 秒・被弾 {h}`。Esc は途中でも拠点へ（封鎖前ならその挑戦は数えない）
- 記録: `HubSave.hall?: Record<string, HallRecord>`、`HallRecord = { tries: number; wins: number; bestSeconds?: number; fewestHits?: number }`。封鎖（`boss.lockedAt` あり）した挑戦だけ `tries += 1`、撃破で `wins += 1` と最速・最少を更新

```ts
// src/system/bossHall.ts
export function hallBossKeys(): string[];
export function hallDepthOf(key: string): number | null; // 章ボス = 章 × floorsPerChapter、最深の主 = 21
export function hallSeedText(key: string): string;       // BOSS_HALL.seedPrefix + key（同じボスは毎回同じ部屋）
export function createHallGame(key: string, profile: Profile, skillProfile: SkillProfile, job: JobKey | undefined, hitstopScale: number): GameState | null;
export function enterHallArena(state: GameState): boolean; // ボス部屋の扉タイル（doorTiles の最小）から中心へ BOSS_HALL.doorInset タイル
export interface HallOutcome { done: boolean; won: boolean; locked: boolean; seconds: number; hits: number; downs: number }
export function hallOutcome(state: GameState): HallOutcome; // 撃破は bossLog の最後、力尽きたら floorTime − lockedAt と boss.hits
// src/meta/hubStore.ts
export interface HallRecord { tries: number; wins: number; bestSeconds?: number; fewestHits?: number }
export function hallRecordOf(save: HubSave, key: string): HallRecord | undefined;
export function addHallResult(save: HubSave, key: string, outcome: HallOutcome): HubSave; // 元は変えない。locked でなければ同じ内容
// src/ui/bossHall.ts
export function hallTabs(codex: CodexSave, save: HubSave): ListTab[];
export function hallResultLines(outcome: HallOutcome, before: HallRecord | undefined): string[];
// src/render/bossHallUi.ts
export function drawHallResult(ctx: CanvasRenderingContext2D, lines: readonly string[], hint: string): void;
```

- `createHallGame`: `createReplayProfiles(captureLoadout(profile, skillProfile))` の一時プロフィールで `createGame(hashSeed(seedText), seedText, …, { ...defaultRunSetup(), job, startDepth: depth }, hitstopScale)` → `enterHallArena`。できた階のボスの key が違えば null。`startDepth`（QA 専用の欄）をここでも使うので `runSetup.ts:150` のコメントに「ボスの間」を足す
- ボスの間では最深の主の第三の顔は `bossLog` が空なので章の順で借りる（8b の既定のまま）

### 2-8. 決定性（`RunSetup.runMeta`）

```ts
// src/system/runMeta.ts（型と sanitize。import は型と key の一覧だけ。contractors / runEvents / specialRooms からは import しない = 輪を作らない）
export const TIER_PERKS = ["market", "exit"] as const;
export type TierPerk = (typeof TIER_PERKS)[number];
export interface RunMetaSetup {
  nemesis: NemesisSpec | null;
  lockedRooms: RoomKind[];           // ROOM_KIND.extra の key だけ
  lockedContractors: ContractorKey[];
  lockedEvents: RunEventKey[];
  perks: TierPerk[];
}
export function emptyRunMeta(): RunMetaSetup;
export function isEmptyRunMeta(m: Readonly<RunMetaSetup>): boolean;
export function sanitizeRunMeta(v: unknown): RunMetaSetup; // 未知の key・壊れた値は黙って捨てる。重複は 1 つ
```

- `RunSetup.runMeta?`・`GameState.runMeta`（`createGame` は `structuredClone(setup.runMeta ?? emptyRunMeta())`、拠点は `emptyRunMeta()`）・`ReplayData.runMeta?`（`isEmptyRunMeta` なら書かない。`finish` / `createReplaySession` / `sanitizeReplay` の 3 か所、`lockedRelicsField` と同じ形の `runMetaField`）
- 作るのは `main.ts` だけ: `withRunMeta(setup, seedText)` = `{ ...setup, runMeta: buildRunMeta(sources) }` を `beginRun` で `withLockedRelics` の後に。やり直し（同じシード）も毎回作り直す（直前の死が新しい仇になる）
- `GameState.hurt: HurtLog`・`GameState.nemesis: NemesisRun | null` は乱数を引かず、ゲーム進行に効くのは仇の配置と報酬だけ（`runMeta.nemesis` があるときだけ）
- 空の `runMeta` での乱数消費: 契約者の抽選 1 回・部屋の `rng.chance` の回数・ランイベントの `rng.chance` の回数・市の品数・出口の本数・`buildFloor` の末尾の順が全部今と同じ → **`REPLAY_VERSION` は上げない**。これを `core/replay.test.ts` の既存の検査（record → playback）と「runMeta の無い記録は空として再生できる」で縛る
- ボスの間・依頼の 3 択・図鑑・死亡画面はリプレイに記録しない（step の外、または記録しないセッション）

### 2-9. やらないこと（却下した案）

- 1 ランに依頼 2 つ（常設 + 3 択）: `quests.v1` の `active` を配列にする形の変更と HUD・死亡画面の行の倍増に対して、依頼の意味が変わらない
- 階の小依頼（被弾 3 以下で降りる）: 灰の公証人の「無傷の契約」と賭けの腕の賭けが同じ役を持つ
- 位階 6 の「名のある遺物 1 種が抽選に加わる」: 今は全員の抽選に入っている遺物を 1 種抜くことになり、永続の遊びを減らす
- 位階の「持ち帰り枠・荷車」: 袋・持ち帰りが未実装
- 解放を新しい保存キーで持つ: 図鑑と依頼から導けば移行も Electron の `SAVE_FILES` の追加も要らない
- 図解を敵ごとに手書き: 110 体。予告の形のデータから導けば新しい敵も自動で載る
- 死因を技の名前で（「薙ぎ払い」）: 敵の技に名前の表が無い。種類 11 で足りる
- ボスの間を拠点の `stepHub` で動かす: ボス部屋の準備・封鎖・記録が `buildFloor` / `step` に乗っている
- 仇を階をまたいで追わせる: 盗賊の追跡と重なり、1 ラン 1 度で十分
- 得点を捨てる（encounter-core 9-4）・章の挑戦: 段取り 9 の中身に無い。`docs/ideas/README.md` に残す

---

## 3. 型・JSON・テスト・REPLAY_VERSION・セーブの移行

### 3-1. 型（共有ファイルは最小 Edit）

| ファイル | 変更 | レーン |
| --- | --- | --- |
| `src/core/hurt.ts`（新） | 2-1 の型・`HURT_KINDS`・`createHurtLog`・`isHurtKind` | A |
| `src/core/state.ts` | `GameState` の `bossLog` の行の直後に `hurt: HurtLog;`・`nemesis: NemesisRun \| null;`、`lockedRelics` の行の直後に `runMeta: RunMetaSetup;`。`Enemy` の末尾（`allyUntil` の後）に `nemesis?: true;`。import 3 行（型だけ） | A |
| `src/core/game.ts` | `createGame` の初期値 3 行（`hurt: createHurtLog()`・`nemesis: createNemesisRun(setup.runMeta?.nemesis ?? null)`・`runMeta: structuredClone(setup.runMeta ?? emptyRunMeta())`） | A |
| `src/system/hub.ts` | 拠点の初期値 3 行（`hurt: createHurtLog()`・`nemesis: null`・`runMeta: emptyRunMeta()`） | A |
| `src/system/runSetup.ts` | `RunSetup` の `startDepth` の後に `runMeta?: RunMetaSetup`（:150 のコメントに「ボスの間」は D） | A（D はコメント 1 行） |
| `src/core/replay.ts` | `ReplayData.runMeta?`、`finish` に `...runMetaField(…)`、`createReplaySession` の setup に `runMeta: sanitizeRunMeta(data.runMeta)`、`sanitizeReplay` に `...runMetaField(sanitizeRunMeta(v.runMeta))`、`runMetaField` 関数 | A |
| `src/system/combat.ts` | `DamagePlayerOptions.cause?`、`damagePlayer` に `noteHurt` 1 行、`damagePlayerDot(state, amount, cause?)` と `noteHurt` 1 行、`:645` に cause | A |
| `src/loot/types.ts` | `RunHistoryEntry` に 2-2 の任意項目 9、`ProfileMeta` に `clears?` / `bestClearTier?` | A |
| `src/loot/profile.ts` | `sanitizeHistoryEntry` と `sanitizeMeta` が新しい欄を検査して残す、`recordClear(profile, tier)` | A |
| `src/meta/codex.ts` / `codexStore.ts` | `CodexSave.enemyDeaths`・`createCodexSave`・`parseCodexSave`（`sanitizeCountMap(…, isEnemyKey)`）・`recordDefeat` | A |
| `src/system/jinSpawn.ts` | `export function addJinMember(state, jin, def, want): Enemy \| null`（`spawnMember` の直後） | A |
| `src/system/elites.ts` | `eliteDisplayName` の return に `仇・` の接頭辞 | A |
| `src/system/chapters.ts` | `nextPeakOf(depth)` | A |
| `src/meta/hub.ts` | `FACILITY_KEYS` に `"hall"`、`FACILITY_NAME.hall`、`FACILITY_OF_SPOT.hall`、`builtFacilities` に 1 行 | D |
| `src/meta/hubStore.ts` | `HubSave.hall?`・`parseHubSave`・`hallRecordOf`・`addHallResult` | D |
| `src/map/hubMap.ts` | `HUB_SPOT_KEYS` に `"hall"`、ASCII 6 行目の列 24 に `X`、`SPOT_CHAR.X = "hall"` | D |
| `src/ui/hubFlow.ts` | `HubOpen` に `{ kind: "hall" }`、`HUB_OPEN.hall` | D |
| `src/render/hubUi.ts` | `SPOT_ACTION.hall`（`挑む`） | D |
| `src/meta/quests.ts` | `QuestDef.keywords?`、表の 32 行に語、`loadoutKeywords`、`pickQuestOffers` の 4 つ目の引数 | E |

### 3-2. balance JSON（`_fields` を親に 1 回。新しい葉には全部説明）

| ブロック | 中身（初期値） | レーン |
| --- | --- | --- |
| `enemies/NEMESIS.json`（新。`enemies/_index.json` の `_order` の `REAPER` の後） | `minDepth 2` / `depthLead 1` / `hpMul 1.5` / `maxedHpMul 1.3` / `rewardItems 1` / `rewardBoost 6`（`ROOM_KIND.challengeRareBoost` と揃える）/ `rewardKeys 1` / `color "#ff5050"` | A |
| `world/BOSS_HALL.json`（新。`world/_index.json` の `_order` の `HUB_DECOR` の後） | `seedPrefix "hall:"` / `doorInset 2` / `resultColor "#ffd75f"` | D |
| `world/META.json` | 足す: `questTagWeight 2` | E |
| `world/META.json` | 足す: `diagramDeaths 3` | B |
| `world/TIER_REWARD.json`（新。`_order` の `ARC` の後） | `marketTier 3` / `marketExtra { "rune": 1 }` / `exitTier 10` / `exitExtra 1` / `steleColor "#d0f0ff"` | C |

`src/data/tuning.ts` の再 export: `NEMESIS`（`ELITE` の行の後、A）、`BOSS_HALL`（`HUB` の行の後、D）、`TIER_REWARD`（`ARC` の行の後、C）。`assembled.gen.ts` は統合役が段ごとに `npm run balance:gen` で作り直す。

### 3-3. テスト（`it` は日本語）

**A**（`src/system/deathCause.test.ts` 新・`src/system/nemesis.test.ts` 新・`src/meta/runMetaSetup.test.ts` 新・`src/meta/deathReport.test.ts` 新・`src/core/replay.test.ts` / `src/loot/profile.test.ts` / `src/meta/codex.test.ts` / `src/system/chapters.test.ts` 追記）

- 「敵の近接で倒れると死因はその敵の一撃で、精鋭の修飾子も残る」「敵弾で倒れると死因は射撃で撃った敵の key を持ち、撃ち手が消えていれば key は空」「燃焼の継続ダメージで倒れると死因は燃焼で、最後に殴った敵は lastEnemy に残る」「溶岩・潮・死神・長居の影・落雷・遅れて来る傷の死因の種類」「ボスに倒されると仇の種は lastEnemy の並の敵、それも無ければ null」「被弾の記録は乱数を引かない（`vi.spyOn(state.rng, "next")` が呼ばれない）」
- 「仇は spawnDepth 以上の初めての階で、開始から最も遠い眠った陣に 1 体だけ出る」「仇は記録の修飾子に 1 つ足し、猛と生命の倍率を持つ」「修飾子 2 つの仇は生命の倍率だけ上がる」「ボスの階・最深の間には出さず、次の階へ持ち越す」「上り階段で戻った階に 2 体目を出さない」「倒すと遺物と鍵が落ち avenged になる」「runMeta が空なら敵の配置・乱数の消費が今と同じ（同じ seed の敵の id・位置が一致）」「同じ seed と runMeta なら同じ位置・同じ修飾子」「名札の頭に仇・」
- 「直近の力尽きた履歴の grudge が仇になる」「仇を討った履歴より前の死は仇にしない」「離脱・踏破の履歴は飛ばし、デイリーの履歴は数えない」「デイリーの runMeta は空」「消えた敵・ボス・未知の修飾子は捨てる」
- 「死因の行: 敵なら名前・種類・倒された回数、敵でなければ名前だけ」「次の山は死んだ深度以上の最初の章ボスか最深の間、深みでは出さない」「前回比は到達・被弾・見切りの差を符号つきで、比べる履歴が無ければ出さない」「踏破の行は位階と回数」「行は 3 行まで」
- 「runMeta（仇・封じ・見返り）を記録し、再生で同じ result になる」「runMeta の無い旧記録は空として再生できる」「壊れた runMeta は空に落ちる」
- 「履歴の新しい欄が保存と読み込みで往復する」「壊れた新しい欄は捨て、欄の無い旧データも読める」「recordClear は踏破の回数と最高位階を更新する」
- 「倒された回数を enemyDeaths に数え、未知の敵と null は数えない」「enemyDeaths の無い旧データは空で読む」
- 「nextPeakOf: 1〜5 は 5、6〜10 は 10、20 は 20、21 は 21、22 以降は null」

**D**（`src/system/bossHall.test.ts` 新・`src/ui/bossHall.test.ts` 新・`src/meta/hub.test.ts` / `src/map/hubMap.test.ts`（あれば）追記）

- 「ボスの間の候補は章ボス 4 と ARC.finalBoss」「hallDepthOf は章ボスの階と 21、他は null」「createHallGame はその深度のボス階を作り、ボスは選んだ key」「プレイヤーはボス部屋の中の扉寄りに立ち、数 step で封鎖され lockedAt が入る」「元の profile と skillProfile を書き換えない」「撃破で done・won、秒と被弾は bossLog の最後と一致」「倒れると done で won でない」「同じ key なら同じ部屋」
- 「章ボスを 1 体倒すとボスの間が建つ」「hall の記録は往復し、壊れた値は捨て、欄の無い旧データも読める」「addHallResult は挑戦・撃破・最速・最少の被弾を更新し、封鎖前にやめた挑戦は数えない」「台どうしは HUB.interactRadius の 2 倍より離れている」
- 「未撃破のボスは ？？？ で挑めない」「結果の行は最速の更新を示す」

**E**（`src/meta/quests.test.ts` 追記・`src/render/questHud.test.ts` 新）

- 「全ての依頼の語は KEYWORDS の中」「持ち物の語と重なる依頼が 3 択に出やすい（200 seed で数える）」「持ち物の語が無ければ今と同じ 3 択（同じ seed で同じ並び）」
- 「依頼を受けていなければ HUD の文は null」「進みと達成の文」

**B**（`src/system/telegraphDiagram.test.ts` 新・`src/meta/codex.test.ts` 追記）

- 「図鑑に載る全ての敵の図解が作れ、秒は有限で、赤の始まりは予備動作の中」「突進の敵は線、ゴーレムは輪、風の精は扇、射手は弾の扇、自爆は輪、山なりは影」「ボスは段階 3 つの危ない間合いを持つ」
- 「倒された回数が diagramDeaths に届いた敵だけ図解の案内が出る」

**C**（`src/meta/unlocks.test.ts` 新・`src/meta/tierRewards.test.ts` 新・`src/system/contractors.test.ts` / `src/system/specialRooms.test.ts`（無ければ `roomTypes.test.ts`）/ `src/system/runEvents.test.ts` / `src/system/merchants.test.ts` / `src/meta/achievements.test.ts` / `src/meta/hub.test.ts` 追記）

- 「解放の表は契約者 9・追加の部屋 20・ランイベント 28 を全部持つ」「空の保存データでは契約者 3・部屋 5・出来事 9 だけが開いている」「章 1 の主を倒すと部屋 5・出来事 7 が開く」「依頼を達成すると対応の契約者が開く」「新しく開いた分だけ知らせの行になる」
- 「封じた契約者は立たない」「封じた部屋の種類は置かれず、乱数も引かない」「封じたランイベントは抽選されず、占いの先読みにも出ない」「位階の見返り exit で出口が 1 本増える」「見返り market で章の市の品が 1 つ増え、ふつうの市は変わらない」
- 「踏破していなければ見返りは無い」「最高位階 3 で market、10 で exit」「次の見返りの行」「踏破・位階の踏破・仇討ちの実績」「踏破していると踏破の碑を飾る」

### 3-4. `REPLAY_VERSION`（`src/core/replay.ts:77`、今 30。8b の取り込みで 1 つ上がる）

**上げない**。理由: 段取り 9 でゲーム進行が変わるのは `runMeta` があるときだけで、`runMeta` は記録に載る。空の `runMeta`（旧記録・QA・テスト・デイリー）では乱数消費も結果も今と同じ（2-8）。`docs/ARCHITECTURE.md` の版の一覧に「段取り 9: 版は据え置き（`ReplayData.runMeta` を追加。無ければ空）」を 1 行。

### 3-5. 壊れそうなテスト（既存）

| テスト | 理由 | 直し方 | 持ち主 |
| --- | --- | --- | --- |
| `src/meta/codex.test.ts:214`（`parseCodexSave` の結果） | `enemyDeaths: {}` が増える | `toEqual(createCodexSave())` の形なら通る。個別の欄の検査は影響なし | A |
| `src/loot/profile.test.ts:214, 276`（履歴の往復） | 新しい欄は任意なので通る見込み | 落ちたら欄の有無を見直す | A |
| `src/ui/title.test.ts:285` | `buildHistoryEntry` は変えない | そのまま | — |
| `src/meta/quests.test.ts`（3 択の並び） | 重みが全部 1 のとき今と同じ道 | そのまま通るのが完了条件 | E |
| `src/meta/achievements.test.ts`（件数を数える検査があれば） | 41 → 48 | 件数を直す | C |
| `src/meta/hub.test.ts`（設備・飾りの一覧の完全一致） | `hall` と踏破の碑 | 期待値に足す | D / C |
| `src/save/fileEnvelope.test.ts:42`（SAVE_FILES と各ストアのキー） | 新しいキーを作らない | そのまま | — |
| `src/system/contractors.test.ts:79`（重みが全部正） | 重みは JSON のまま、封じは state 側 | そのまま | C |
| `src/core/replay.test.ts`・`src/system/enemyGolden.test.ts`・`src/qa/simulation.test.ts` | 空の runMeta で乱数消費が同じ | そのまま通るのが完了条件 | A / C |
| `npm run audit:docs` | 新しい本体ファイル 14 が `CODE_MAP.md` に無い、「（`ACHIEVEMENTS`、41 種）」 | 統合役がコードと同じコミットで足す（4 章の統合） | 統合役 |

### 3-6. セーブの移行

**無し。`v2` は切らない**（不変条件 8 の「欠けたフィールドの読み捨て」で足りる）。

| キー | 足す欄 | 旧データ | 旧い版で新データを読むと |
| --- | --- | --- | --- |
| `roguelike.profile.v1` | `meta.history[]` の 9 欄、`meta.clears` / `meta.bestClearTier` | 欄が無い = 0 / 無し（位階の見返り無し・前回比は出ない・仇は無し） | sanitize が知らない欄を落とす。次に保存すると消えるが、表示と見返りの記録だけ（装備・倉庫は無事） |
| `roguelike.codex.v1` | `enemyDeaths` | `{}` | 同上（図解の回数が 0 に戻る） |
| `roguelike.hub.v1` | `hall` | 無し | 同上（ボスの間の記録が消える） |
| `roguelike.quests.v1` / `achievements.v1` | なし（実績の key が 7 増えるだけ） | — | 知らない実績の key は捨てられる（今の作法） |
| `roguelike.replays.v1` | `ReplayData.runMeta` | 空として再生 | 旧い版は欄を落とし、封じの無い再生になる（結果が食い違えば既存の不一致検出が出る） |

**消える永続データは無い**。依頼の報酬（起点・ジョブ・遺物・頁・称号）も変えない（解放は 2 つ目の報酬として足す）。

---

## 4. 段階とレーン

全レーン `isolation: "worktree"`。レーンはコミットしない。作業中は自分のテストだけ `npx vitest run <ファイル>`、最後に 1 回 `npm run check:fast`。統合役は段の終わりに `npm run balance:gen` → `npm run check`。**9a は 8b の E2 を取り込んだコミットから切る**（`boss.ts`・`ARC.json`・`enemies*.ts` の取り込み中の差分と重ならないように。F は `src/qa/` だけなので並行でよい）。

### 9a（並行 3 本。遊べる: 死亡画面の死因・次の山・前回比、仇、ボスの間、依頼の語の重みと HUD）

| レーン | モデル | 所有 | 最小 Edit のみ | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| **A 器・死因・仇** | Opus（`GameState` と `ReplayData` の形、永続化 3 キーの sanitize、決定性） | `src/core/hurt.ts`（新）、`src/system/deathCause.ts`（新）、`src/system/nemesis.ts`（新）、`src/system/runMeta.ts`（新）、`src/meta/deathReport.ts`（新: `hurtLabel` / `historyExtras` / `previousComparable` / `deathReportLines`）、`src/meta/runMetaSetup.ts`（新: `RunMetaSources = { history; daily }` / `nemesisFromHistory` / `buildRunMeta`）、各テスト（3-3 の A）、`balance/enemies/NEMESIS.json`（新） | `core/state.ts` / `core/game.ts` / `system/hub.ts` / `system/runSetup.ts` / `core/replay.ts` / `loot/types.ts` / `loot/profile.ts` / `meta/codex.ts` / `meta/codexStore.ts` / `system/jinSpawn.ts` / `system/elites.ts` / `system/chapters.ts`（3-1 の A 分）、`system/combat.ts`（`DamagePlayerOptions`・`damagePlayer` の 1 行・`damagePlayerDot` の引数と 1 行・`:645`）、2-1 の表の 11 か所（1 行ずつ）、`system/floor.ts`（`:189` の `state.pendingExit = null;` の直前に `placeNemesis(state);`）、`system/enemyTraits.ts`（`:132` の直後に `onNemesisDeath(state, e);`）、`render/titleUi.ts`（`DeathSummaryInfo.reportLines` と描画、履歴の行の死因）、`render/renderer.ts`（`:3216` の 1 行を消す）、`main.ts`（`withLockedRelics` の直後に `withRunMeta`、`beginRun` の `runSetup = …` の行と `deathReportLines = []`、`endRun` の `pushRunHistory` の引数に `...historyExtras(current)` と `recordClear`、`recordMeta` の頭に `recordDefeat(codexSave, killerOf(s)?.key ?? null)`、`deathMetaLines` の宣言の隣に `deathReportLines`、`drawDeathSummary` の引数に `reportLines`）、`balance/enemies/_index.json`（`_order`）、`data/tuning.ts`（`NEMESIS` 1 行）、`meta/tips.ts`（死因と次の山・仇の 2 項目） | `src/qa/**`、ボスのファイル、`meta/hub*.ts`、`meta/quests.ts` | 3-3 の A が通る。`core/replay.test.ts`・`system/enemyGolden.test.ts` が変更なしで通る。`rg "damagePlayerDot\(" src/system` の全ての呼び元が cause を渡す |
| **D ボスの間** | Opus（`main.ts` の画面の流れ・一時プロフィールと保存の抑止・拠点の保存） | `src/system/bossHall.ts`（新）、`src/ui/bossHall.ts`（新）、`src/render/bossHallUi.ts`（新）、各テスト、`balance/world/BOSS_HALL.json`（新） | `meta/hub.ts` / `meta/hubStore.ts` / `map/hubMap.ts` / `ui/hubFlow.ts` / `render/hubUi.ts`（3-1 の D 分）、`system/runSetup.ts`（:150 のコメント 1 行）、`main.ts`（`type Screen` に `"hall" \| "hallFight"`、`openHubSpot` の `rack` の分岐の直後に hall の分岐、`switch (screen)` の `case "rack"` の直後に 2 case、描画の `if (screen === "altar")` の直後に 2 分岐、`MUSIC_HUB_SCREENS` に `"hall"`、`updateMusic` に hallFight の分岐、新しい関数は `updateAltarFrame` の後ろにまとめる。`state` 変数には入れない）、`balance/world/_index.json`（`_order`）、`data/tuning.ts`（`BOSS_HALL` 1 行）、`meta/tips.ts`（ボスの間の 1 項目） | `core/**`、`system/boss*.ts`、`system/floor.ts`、A の所有 | 3-3 の D が通る。手で: 拠点 → 台 → 一覧 → 挑む → 撃破 / 力尽きる → 結果 → Enter で再挑戦 / Esc で拠点、の間に `profile`・図鑑・履歴・リプレイ一覧が変わらない |
| **E 依頼の実利** | Sonnet | `src/render/questHud.ts`（新）、`src/render/questHud.test.ts`（新）、`src/meta/quests.test.ts` | `meta/quests.ts`（3-1 の E 分）、`main.ts`（`openQuestChoice` の `pickQuestOffers` の引数に `loadoutKeywords(profile, skillProfile)`、playing の描画の `if (!inventoryUi.open) drawBudUi(ctx, cur);` の直後に `drawQuestHud(ctx, cur)` を `!inventoryUi.open` の条件で 1 行）、`balance/world/META.json`（`questTagWeight`） | 他すべて | 3-3 の E が通る。既存の `meta/quests.test.ts` が変更なしで通る |

**衝突の確認（9a）**: `main.ts` は 3 本とも触るが、A = 234 / 416〜485 / 1771 付近、D = 168〜185 / 682〜700 / 1084 / 1250 付近 / 1690 付近、E = 485〜491 / 1763 の 1 行で、同じ関数を触らない（A の `drawDeathSummary` の引数と E の HUD の行は 7 行離れる）。`data/tuning.ts` は A（`ELITE` の後）と D（`HUB` の後）で離れた行。`balance/*/_index.json` は A = enemies、D = world で別ファイル。`runSetup.ts` は A = 型の欄、D = コメント 1 行（:150）で別の行。`system/hub.ts`（拠点の GameState）は A だけ、`meta/hub.ts`（設備）は D だけ。

**統合（9a）**: A → D → E の順。`npm run balance:gen` → `npm run check`。**レビューは 9a の終わりに `model: "opus"` の reviewer 1 回**（永続化と再生: 3 キーの sanitize が新しい欄を落とさず壊れた値を捨てるか、`runMeta` の往復、空の `runMeta` で乱数消費が変わらないか、ボスの間が保存を書かないか）。`CODE_MAP.md` に core 1（`hurt.ts`）・system 4（`deathCause.ts` / `nemesis.ts` / `runMeta.ts` / `bossHall.ts`）・meta 2（`deathReport.ts` / `runMetaSetup.ts`）・ui 1（`bossHall.ts`）・render 2（`bossHallUi.ts` / `questHud.ts`）の 10 行を同じコミットで。

### 9b（並行 2 本。遊べる: 予告の図解、解放制、位階の見返りと実績、踏破の碑）

| レーン | モデル | 所有 | 最小 Edit のみ | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| **B 予告の図解** | Sonnet | `src/system/telegraphDiagram.ts`（新）、`src/render/telegraphDiagramUi.ts`（新）、`src/system/telegraphDiagram.test.ts`（新） | `meta/codex.ts`（`enemyEntries` の info と detail だけ）、`meta/codex.test.ts`（追記）、`main.ts`（`let diagramKey: string \| null = null`、`updateListScreenFrame` の頭で diagramKey があれば Esc / 決定で閉じて return、activate で `kind === "codex"` かつ敵の頁かつ開ける行なら diagramKey を立てる、描画の codex の `drawListScreen` の後に `if (diagramKey) drawTelegraphDiagram(…)`）、`balance/world/META.json`（`diagramDeaths`）、`meta/tips.ts`（予告の図解の 1 項目） | 他すべて。特に `meta/screens.ts`（C の所有） | 3-3 の B が通る。図鑑の全ての敵で図解の描画が例外なく終わる（`drawTelegraphDiagram` をダミーの ctx で全 `CODEX_ENEMIES` に回すテスト） |
| **C 解放制と位階** | Sonnet（表と 1 行の封じ。仕様は全部 2-5・2-6 で確定） | `src/meta/unlocks.ts`（新）、`src/meta/tierRewards.ts`（新）、各テスト、`balance/world/TIER_REWARD.json`（新） | `meta/runMetaSetup.ts`（`RunMetaSources` に `codex` / `quests` / `meta` を足し、`buildRunMeta` で `lockedRunContent` と `tierPerks` を入れる。デイリーは空のまま）、`main.ts`（`withRunMeta` の sources に 3 つ、`recordMeta` で前後の `lockedRunContent` の差を `unlockNewsLines` にして戻り値へ）、`system/contractors.ts`（`pickContractor`）、`system/specialRooms.ts`（`assignExtraRoomKinds` の頭の 1 行、`planForkStairs` の本数に 1 項）、`system/runEvents.ts`（`rollFirst` の 1 行）、`system/merchants.ts`（`placeMerchants` の `plan` に 1 行）、`meta/screens.ts`（`questEntry` の detail、`metaSummaryLines`、`codexListTabs` の場所の頁の detail）、`meta/achievements.ts`（7 件）、`meta/hub.ts`（`HubProgressSource` に `clears?` / `bestClearTier?`、`hubDecorations` に踏破の碑）、`ui/hubFlow.ts`（`hubProgressSource` が 2 つを渡す）、`meta/deathReport.ts`（踏破の 2 行目に `nextTierRewardLine`）、`balance/world/_index.json`（`_order`）、`data/tuning.ts`（`TIER_REWARD` 1 行）、`meta/tips.ts`（解放・位階の見返りの 2 項目） | 他すべて。特に `meta/codex.ts`（B の所有） | 3-3 の C が通る。`qa/simulation.test.ts`・`core/replay.test.ts`・`system/enemyGolden.test.ts` が変更なしで通る |

**衝突の確認（9b）**: `main.ts` は B = `updateListScreenFrame` と一覧の描画、C = `withRunMeta` と `recordMeta` で別の関数。図鑑は B = `codex.ts`（敵の頁）、C = `screens.ts`（場所の頁の後付け）で別ファイル。`META.json` は B だけ（E は 9a で済み）。`tips.ts` は B と C が別の項目を末尾に足す → 取り込みで並べ替えが要れば統合役。

**統合（9b）**: B → C。`npm run balance:gen` → `npm run check`。レビューは段の終わりに通常の reviewer 1 回（C の封じが乱数を引かないことを重点に）。資料は段の終わりにまとめて: `CODE_MAP.md`（system 1 `telegraphDiagram.ts`・render 1 `telegraphDiagramUi.ts`・meta 2 `unlocks.ts` / `tierRewards.ts` の 4 行と「（`ACHIEVEMENTS`、48 種）」）、`docs/ARCHITECTURE.md`（`GameState.hurt` / `nemesis` / `runMeta`、`RunSetup.runMeta` → `ReplayData.runMeta` の道、版の一覧の据え置きの 1 行、永続化キーの表に 3 キーの新しい欄）、`docs/GLOSSARY.md`（6 章 ★1 の語）、`docs/BALANCE.md`（`NEMESIS` / `BOSS_HALL` / `TIER_REWARD` / `META` の 2 つ）、`docs/recipes/quest.md`（依頼の `keywords` と解放の表）、`docs/recipes/room.md`（新しい部屋の種類は `ROOM_UNLOCKS` に 1 行）、`docs/recipes/contractor.md`（`CONTRACTOR_UNLOCKS` に 1 行）、`IDEAS.md` の「現状」、`docs/ideas/README.md` の Q8 の行、`CHANGELOG.md`、`HANDOFF.md`。

---

## 5. 調整つまみと QA 指標

**つまみ**

1. 仇の強さと出る階: `NEMESIS.hpMul` / `maxedHpMul` / `depthLead` / `minDepth`
2. 仇討ちの報酬: `NEMESIS.rewardItems` / `rewardBoost` / `rewardKeys`
3. 図解の開く回数: `META.diagramDeaths`
4. 依頼の語の重み: `META.questTagWeight`（0 で今の 3 択）
5. 位階の見返りの閾値と量: `TIER_REWARD.marketTier` / `marketExtra` / `exitTier` / `exitExtra`
6. 解放の段（TS の表 `CONTRACTOR_UNLOCKS` / `ROOM_UNLOCKS` / `EVENT_UNLOCKS`）: 最初に開く数

**指標**（メタは定性が主。数えられるものだけ）

| 指標 | どこで | 目標 |
| --- | --- | --- |
| 死因の種類別の割合（敵の一撃 / 射撃 / 爆発 / 余波 / 状態異常 / 地形 / 死神） | フル QA（統合役が 9a の後に `qa/simulation.test.ts` の `guessDeathCause` を `killerOf(state)` に替える。8b F の取り込み後） | 推測との食い違いを見る。死神が 1 割を超えるなら時計の見せ方を見直す |
| 仇の出現率と討伐率 | 新しい縮小 QA は作らない。`nemesis.test.ts` の固定 seed と実プレイ | 出る階に着いたランの 9 割以上で置ける（置けない階が続くなら `addJinMember` の探索幅） |
| 空の保存データでの 1 ランの部屋の種類・出来事の種類 | `unlocks.test.ts` + フル QA の既存の数え | 最初の 5 ランで「初めて見た」が毎ラン 1 つ以上出る |
| ボスの間の結果 | 実プレイ | 章ボスの最速が本番の `bossLog` の中央値より短い（練習が効く） |

---

## 6. 不確かな点（推奨 1 つ。★ はユーザー確認）

1. ★ **新しい表示名**（`src/` と `docs/GLOSSARY.md` で衝突なしを確認済み。「落下物」は `impacts.ts` の既存の意味と同じ。「業火」「枷」は変身と系譜の名にあるので称号には使わない）: 死亡画面の `死因` / `次の山` / `前回比`、死因の語 `余波` / `流れ弾` / `落下物`、`仇`（名札の `仇・`）/ `仇の気配` / `仇討ち`、図鑑の `予告の図解`、拠点の設備と台 `ボスの間`（「〜の間」は部屋の種類 潮の間 / 反転の間 と最深の間で使っている。紛れるなら `稽古場`）、飾り `踏破の碑`、実績 7 `踏破者` / `縛りを越えた者` / `百戦の踏破者` / `鉄鎖の踏破者` / `羅刹の踏破者` / `極位の踏破者` / `仇討ち`。→ 推奨: この案で確定し、GLOSSARY の「部屋・フロア」「設計上の用語」に足す
2. ★ **既存のセーブにも解放制を効かせる**: 章ボスをまだ倒していないと部屋・出来事の一部が、対応の依頼を達成していないと契約者 6 人が、今までのセーブでも出なくなる（データは消えない。図鑑・依頼が進めば戻る）。→ 推奨: 効かせる（E32 で承認済みの方針。既存セーブだけ全解放にするには「解放済み」の印を新しく保存する必要がある）
3. ★ **ボスの間の装備は今の装備（武器掛けの借り物を含む）の写し**。encounter-core 9-3 の「借り物の装備で練習」は、拠点の武器掛けで素の器を借りれば同じことができる。→ 推奨: 今の装備（本番に持ち込むビルドで練習でき、腕だけを測りたいときは武器掛けで借りる）
4. **依頼 6 つへの契約者の割り当て**（部屋主狩り → 灰の公証人 など、2-5 の表）: 称号だけが報酬の依頼に 2 つ目の報酬を付ける目的で選んだ。→ 推奨: この表で入れ、実プレイで偏りが出たら表の 1 行を差し替える
5. **仇がいるランは、仇を置いた後の乱数がずれる**（`buildFloor` の末尾に置くので同じ階の既存の配置は変わらず、仇の撃破の報酬の抽選だけ増える）。記録に `runMeta` が載るので再生は一致する。確認: `core/replay.test.ts` の「runMeta を記録し、再生で同じ result」
6. **旧い版のコードで保存し直すと新しい欄が落ちる**（履歴の死因・図鑑の倒された回数・ボスの間の記録・踏破の回数）。どれも表示と見返りの記録で装備は無事。→ 推奨: 受け入れる（v2 を切ると旧い版で全部が既定に戻り、被害が大きい）
7. **章の市は章ボスの階だけ**（`merchantKindFor`）。位階 3 の見返りは 1 ランに 4 回だけ効く。→ 推奨: そのまま（毎階の市に効かせると見返りが強すぎる）。確認: `merchants.test.ts` の「ふつうの市は変わらない」
8. **QA の死因**: `src/qa/simulation.test.ts:740-758` の推測を `killerOf(state)` に替えるのは 8b F（`src/qa/` の所有）の取り込み後に統合役が 1 か所。→ 推奨: 9a の統合と同じコミットで替える（F が済んでいれば）
9. **ボスの間で `startDepth`（QA 専用の欄）を使う**: 地金が深度で決め直されるので本番の同じ深度と同じ強さの装備になる。祝福は無いので本番より弱い。→ 推奨: そのまま（練習の場。祝福を再現すると選び方の画面が要る）。確認: `bossHall.test.ts` の「その深度のボス階を作る」
10. **図解の stub**: `ai.move` を読む敵（双子・蜥蜴・鎖の番人など）は最初の技の形になり、形が無い敵は「触れない間合い」に落ちる。→ 推奨: そのまま（全 `CODEX_ENEMIES` のテストで例外と非有限が無いことだけ縛る）。見た目で困る敵があれば B の表に 1 行の上書きを足す

## 参照（絶対パス）

- 仕様: `/home/user/roguelike/docs/ideas/core-synthesis.md`（9 章・10 章）、`/home/user/roguelike/docs/ideas/encounter-core.md`（1-5・8-6・9 章・10-1・12 章 Q8・13 章 8〜9）、`/home/user/roguelike/docs/ideas/run-arc.md`（1-3・1-5・1-6）、`/home/user/roguelike/docs/ideas/boss-impl.md`（2-1 の記録・2-6・3-4）
- コード: `/home/user/roguelike/src/system/combat.ts`、`/home/user/roguelike/src/core/state.ts`、`/home/user/roguelike/src/core/game.ts`、`/home/user/roguelike/src/core/replay.ts`、`/home/user/roguelike/src/system/runSetup.ts`、`/home/user/roguelike/src/system/hub.ts`、`/home/user/roguelike/src/loot/types.ts`、`/home/user/roguelike/src/loot/profile.ts`、`/home/user/roguelike/src/meta/codex.ts`、`/home/user/roguelike/src/meta/codexStore.ts`、`/home/user/roguelike/src/meta/quests.ts`、`/home/user/roguelike/src/meta/screens.ts`、`/home/user/roguelike/src/meta/achievements.ts`、`/home/user/roguelike/src/meta/hub.ts`、`/home/user/roguelike/src/meta/hubStore.ts`、`/home/user/roguelike/src/map/hubMap.ts`、`/home/user/roguelike/src/ui/hubFlow.ts`、`/home/user/roguelike/src/ui/title.ts`、`/home/user/roguelike/src/render/titleUi.ts`、`/home/user/roguelike/src/render/renderer.ts`、`/home/user/roguelike/src/render/codexUi.ts`、`/home/user/roguelike/src/main.ts`、`/home/user/roguelike/src/system/elites.ts`、`/home/user/roguelike/src/system/jinSpawn.ts`、`/home/user/roguelike/src/system/enemyTraits.ts`、`/home/user/roguelike/src/system/floor.ts`、`/home/user/roguelike/src/system/chapters.ts`、`/home/user/roguelike/src/system/bossKit.ts`、`/home/user/roguelike/src/system/bossRecord.ts`、`/home/user/roguelike/src/system/enemies.ts`、`/home/user/roguelike/src/system/contractors.ts`、`/home/user/roguelike/src/system/specialRooms.ts`、`/home/user/roguelike/src/system/runEvents.ts`、`/home/user/roguelike/src/system/merchants.ts`、`/home/user/roguelike/src/qa/simulation.test.ts`
