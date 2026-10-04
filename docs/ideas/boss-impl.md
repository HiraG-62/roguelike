# ボスの実装設計（段取り 8）

作成日: 2026-09-30。`docs/ideas/core-synthesis.md` 9 章の段取り 8 を architect が確定リストまで設計したもの。★（ユーザー確認）の結果は下の「決めたこと」に書く。

## 決めたこと（ユーザー確認済み 2026-09-30）

- ★1 新しい表示名は案のとおり確定（門柱 / 姿見 / 柵 / 地上への道 / 四門 / 陥没 / 第三の顔 / 膨張 / 呑み込み / 吐き出し / 盾割れ / 鏡割れ / 門崩れ / 反動）
- ★2 踏破をこの段で入れる。終わり方の名は「踏破」


作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 8「ボス: 共通の規則 + 動きの語彙 + 段階で戦い方を変える・章ボス 4・最深の主」（元は `encounter-core.md` Q6 と core-synthesis 3-10）。`encounter-core.md` 7-1（共通の規則 6 つ）・7-2（章ボスと最深の主）、`run-arc.md` 1-1・1-3（最深の間・踏破）と 7 章の決定（最深の主は専用の新ボス）を仕様とする。段取り 7e（数値合わせ）と並行でも組めるよう、**この段の数値はすべて「ボスの中の比」か新しいブロック**にし、7e が触る曲線（`ENEMY_SCALE` / `INNATE` / `FLUX` / 経済）を読まない・書かない。

---

## 0. 結論

- **共通の規則を `bossKit.ts` の器に足す**（新しいボスの基盤は作らない）。技の選び方を「並びの巡回」から **`pickMove(state, e, read)`**（プレイヤーの距離帯・静止秒・直前のダッシュ・背面・足元の地形で枝分かれ。乱数なし）に、**連撃 `followUp`**（硬直を挟まず続け、続きの予備動作は最初からコミット）・**離脱 `recoverRetreatMul`**・**見えるダウン `bossDown`** を足す。取り巻きの撃破でボスに怯み値（規則 5）、撃破に固有の報酬（規則 6）、封鎖中の被弾と秒の記録 `state.bossLog` は全ボス共通の 1 本の経路にする。
- **章ボス 4 体を作り直す**: 各章ボスは 3 段階で、段階ごとに危ない間合い（近い / 遠い / 動く / 止まる）が隣と違い（3-10）、**HP 以外の行為で進む段階**（分裂体を全部倒す・追い詰めて 2 回ダウン・2 回引火させる・壁に 2 回激突させる）、**部屋の形が変わる段階**（毒沼・柵・火の床・姿見）、**見えるダウンの隙**を必ず持つ。スライム王は `boss.ts` の旧い状態機械から `bossKingSlime.ts` へ移して器に乗せる。
- **最深の間（深度 21）と最深の主（新ボス `deepLord`）と踏破**を入れる。最深の主は「四門（門柱 4 本・柱が立つ間は無敵）→ 陥没（外周から床が溶岩へ）→ 第三の顔（そのランで被弾の多かった章ボス 2 体の署名の技を借りる）」。倒すと階段（深みへ）と「地上への道」（乗り続けると踏破 = `GameStatus "cleared"`）。
- 段は **8a（器 + スライム王 ∥ 最深の間と踏破 ∥ 絵）→ 8b（盗賊王 ∥ 油壺の王 ∥ 鏡の騎士 ∥ 最深の主 ∥ QA）** の 2 段、全レーン worktree。`REPLAY_VERSION` は 8b の取り込み後に 1 回だけ上げる。**永続データは何も消えない**（履歴の `cause` に `"cleared"` が増えるだけ。キーは据え置き）。

---

## 1. 今のコードの地図（根拠。行番号つき）

| 何 | どこ | 観察 |
| --- | --- | --- |
| ボス階と章ボス | `/home/user/roguelike/src/system/boss.ts:73-98`（`isBossDepth` = 5 の倍数、`bossKeyForDepth` は章ボス → 深みの回転 `deepRotation`）、`/home/user/roguelike/src/system/chapters.ts:1-53`、`/home/user/roguelike/src/data/balance/world/ARC.json`（5 スライム王 / 10 盗賊王 / 15 油壺の王 / 20 鏡の騎士、`floorsPerChapter` 5・`maxChapter` 4） | 深度 21 は今ただの通常階（階の主が出る）。最深の間・踏破・`"cleared"` は未実装（`GameStatus = "playing" | "dead"`、`/home/user/roguelike/src/core/state.ts:25`） |
| ボスの置き方 | `boss.ts:101-113`（`setupBossRoom`: 最後の部屋の中央、双子・油壺・盗賊王だけ部屋の準備）、`floor.ts:143-157`（`isBossDepth` で `setupBossRoom`、他は `setupFloorLordRoom`）、`floor.ts:744-756`（`lockRoom` → `announceBoss`） | 5 の倍数のボス階は陣を作らない（`jin-impl.md` 冒頭） |
| スライム王 | `boss.ts:257-342`（chase → windup → strike（空中）→ recover の手書き。HP 50% で `splitKingSlime` 3 体 + 1.6 倍速）、`balance/enemies/BOSS/kingSlime.json` | 器（`bossKit`）に乗っていない。**ダウンの隙が無い**（encounter-core 1-3）。技の枝も部屋の変化も無い |
| 器 | `/home/user/roguelike/src/system/bossKit.ts:18-84`（`BossHooks` = approach / beginWindup / beginStrike / tickStrike / **sequence** / intervalMul、`runBossCycle`、`advanceMove` は `ai.counter` で並びを巡回、`lungeStep` / `bossTouch`） | 使うのは油壺の王・群れの母・図書館の司書・鏡の騎士・盗賊王。技はプレイヤーの状態を読まない（規則 4 が無い） |
| 盗賊王 | `/home/user/roguelike/src/system/bossThiefKing.ts:32-36`（段階ごとの並び）、`:74-90`（HP 0.65 / 0.3 で段階）、`:128-174`（逃げ・追い詰めでダウン `pressCornered`）、`:272-283`（第 3 段階の突進の壁激突で怯み） | ダウンの隙はある。段階は HP だけ。部屋は変わらない |
| 油壺の王 | `/home/user/roguelike/src/system/bossOilKing.ts:33-37`（並び）、`:72-85`（HP 段階）、`:88-100`（燃える床で引火 → 怯み）、`:208-218`（最初の油溜まり 4） | 地形ボスとして出来が良い（encounter-core 7-2）。段階は HP だけ |
| 鏡の騎士 | `/home/user/roguelike/src/system/bossMirrorKnight.ts:28-32`（並び）、`:64-78`（HP 段階）、`:129-146`（写すのは装備の `statusProcs` の状態異常だけ）、`:149-161`（写し身の守り・正面の反射） | 「装着しているスキルの敵版」（7-2）は無い |
| 怯みとダウン | `/home/user/roguelike/src/system/poise.ts:57-61`（`windupCommitted`、`e.chainWindup` なら最初からコミット）、`:126-145`（`addPoise`、攻撃中は先送り）、`:207-219`（ボスはダウンの回数 `poise.downs` で耐性が伸びる）、`:227-236`（`applyStagger` の `selfInflicted`） | 自傷の怯み（壁激突・引火・追い詰め）は既に「見えるダウン」の作法として 3 体が使っている |
| 取り巻き → ボスの怯み値 | `/home/user/roguelike/src/system/enemyTraits.ts:115-139`（`onEnemyDeath`、`crackEgg` = 群れの母の卵だけ） | 規則 5 の前例が 1 つだけある。一般化する |
| 撃破 | `boss.ts:498-523`（`onBossDeath`: 階段・レア 2・major なら `offerReforges`）、呼び元 `/home/user/roguelike/src/system/enemies.ts:354` | 誰を倒しても報酬が同じ（規則 6 が無い）。`dropRareItem` の `Date.now()` は `now` 引数だけ（不変条件 3 の許容内） |
| 無効・守り | `boss.ts:152-159`（`bossArmorBlocks` = 霜の巨人の鎧、`bossTakenMul` = 鏡の騎士）、呼び元 `/home/user/roguelike/src/system/elites.ts:643-648` | 最深の主の「柱が立つ間は無敵」はここに 1 行足せば乗る |
| 一時的な壁 | `/home/user/roguelike/src/system/hazards.ts:103-117`（`spawnBoneWall`: `lockedTiles` を流用、耐久つき、時間で消える。数値は `BOSS.boneLord` 固定） | 盗賊王の柵に流用できる（数値だけ引数化） |
| 地形の予告つき設置 | `/home/user/roguelike/src/system/enemyTerrain.ts:21-44`（`seedTerrain`: 影 → delay 秒後に地形）、`core/terrain.ts:12`（`lava` / `bog` / `oil` / `fire` …。time 0 は消えない） | 最深の主の陥没（外周から溶岩）とスライム王の毒沼はこれで作れる。逃走の部屋も溶岩で「床が崩れる」を表している（`specialRooms.ts:1132-1162`） |
| 台座 | `/home/user/roguelike/src/system/specialRooms.ts:51-73`（`PropKind`）、`:445-479`（上り階段は「乗り続ける」`holdAscend`）、`:1296-1312`（`placeAscend`）、描画 `/home/user/roguelike/src/render/runUi.ts:87, 119, 153, 176` | 地上への道は上り階段と同じ「乗り続ける」作法で作る |
| 死と終わり | `/home/user/roguelike/src/system/combat.ts:680-711`（`killPlayer` → `recordRunOnce`）、`core/game.ts:149`（dead なら step を止める）、`main.ts:443-460`（`endRun`）、`main.ts:1091, 1188, 1638, 1770`、`render/renderer.ts:816, 2061, 3194-3210`（`drawDeath`「力尽きた」）、`render/effectsUi.ts:636`、`system/player.ts:204`、`system/mana.ts:17, 26, 61`、`core/replay.ts:736`、`ui/title.ts:567`（`cause`）、`render/titleUi.ts:126`（`cause` の表示） | `status === "dead"` を「ランが終わった」の意味で読んでいる所が 13 か所。`RunHistoryEntry.cause` は任意の文字列を通す（`loot/profile.ts:263`） |
| スキルの形 | `/home/user/roguelike/src/skills/types.ts:637-646`（`LastCast`）、`skills/arts/types.ts:19`（`ART_ACT_KINDS`）、`skills/arts/index.ts`（`ART_DEFS[key].acts`、`isArtKey`） | 鏡の騎士の模写は「直前に撃ったスキルの最初の行為の種類」を読めば作れる |
| 報酬の部品 | `system/economy.ts:100`（`gainCoins`）、`:135`（`gainKey`）、`:472`（`dropFlask`）、`system/skills.ts:1531`（`dropRune`）、`system/loot.ts:99-105`（`dropSkillStone`）、`loot/generator.ts:539`（`generateItem`） | 全部そろっている |
| QA | `src/qa/simulation.test.ts:591-592, 933-940`（ボスは出会い数と撃破数だけ）、`src/qa/combatProbe.ts:267`（ボスは除外）、`src/qa/bot.ts:442-458`（最寄りの敵を狙う。無敵のボスも殴り続ける） | ボスごとの撃破時間・被弾・段階の長さを測る所が無い |
| 既存の検査 | `system/boss.test.ts:99-130`（スライム王 3 件）、`system/bossThiefKing.test.ts`、`system/bossWave3.test.ts:71-226`（全体・油壺・鏡）、`system/chapters.test.ts`、`system/floatingText.test.ts`（浮き文字は体言止め） | 書き直すのはスライム王の 3 件と、段階の条件を足した所だけ |

---

## 2. 設計

### 2-1. 共通の規則（`bossKit.ts` の器）

encounter-core 7-1 の 6 規則と 3-10 を、次の 8 つの部品で表す。

| 規則 | 部品 | 中身 |
| --- | --- | --- |
| 4 状態で技を選ぶ | `updateBossRead` / `readPlayer` / `BossHooks.pickMove` | 毎ステップ `runBossCycle` の頭で読みを更新し、硬直の終わりに `pickMove(state, e, read)` で次の技を選ぶ。**乱数を使わない**。`sequence` は残す（深みの回転の群れの母・司書は並びのまま）。`pickMove` があれば優先 |
| 動きの語彙: 連撃 | `BossHooks.followUp(state, e, done): number \| null` | 攻撃の終わりに次の技を返すと、硬直と追跡を挟まず予備動作へ。続きの予備動作は `phaseTimer × BOSS.rules.chainWindupMul` で **`e.chainWindup = true`**（最初からコミット。雑魚の連撃と同じ作法） |
| 動きの語彙: 離脱 | `BossHooks.recoverRetreatMul(e): number` | 硬直の間、`def.speed × mul` でプレイヤーの反対へ動く（0 / 省略で動かない） |
| 動きの語彙: 踏み込み・跳躍 | 既存の `lungeStep`・スライム王の跳躍 | 追加なし（各ボスの技として使う） |
| 3 見えるダウン | `bossDown(state, e, time, text, color)` | `applyStagger(…, { selfInflicted: true })` + 浮き文字（体言止め）+ 揺れ + `wallHit` の音。盗賊王・油壺の王・鏡の騎士の既存の 3 か所もこれに寄せる |
| 5 取り巻き → 怯み値 | `noteBossMinionDeath(state, e)`（`enemyTraits.ts` の `onEnemyDeath` から 1 行） | `state.boss` が major・未撃破で、死んだ敵がボス部屋の敵（`roomIndex` 一致）かつボス本人でない・`vanished` でない・behavior が `egg` / `mine` / `inert` / `container` でない → `addPoise(state, boss, boss.poise.max × BOSS.rules.minionPoiseRatio, { fromBehind: false })`。卵は既存の `crackEgg` のまま（二重にしない） |
| 6 固有の報酬 | `system/bossRewards.ts` の `grantBossReward(state, key, pos)`（`onBossDeath` の major から 1 行） | 2-7 の表 |
| 記録 | `BossState.hits? / lockedAt?`、`GameState.bossLog: BossRecord[]` | `announceBoss` で `lockedAt = state.floorTime`、`damagePlayer` の "hit" で封鎖中なら `hits += 1`（`combat.ts` に 1 行）、`onBossDeath` の major で `bossLog.push({ key, depth, seconds, hits, downs })`。最深の主の「第三の顔」と QA が読む |
| 3-10 危ない間合い | `BOSS_THREATS`（`system/bossKit.ts` の TS の表） | 章ボス 4 と最深の主の段階 1〜3 に `"near" \| "far" \| "moving" \| "still"` を 1 つずつ。**隣り合う段階は違う**をテストで縛り、QA で「段階ごとの被弾の間合い」を測って表と合うか見る（6 章） |

**読み（`PlayerRead`）**

```ts
// src/system/bossKit.ts
export type ThreatBand = "near" | "far" | "moving" | "still";
export type DistBand = "near" | "mid" | "far";
export interface PlayerRead {
  dist: number;
  band: DistBand;          // < BOSS.rules.nearDist は near、> farDist は far
  stillSec: number;        // 1 ステップの移動が stillSpeed × dt 未満の秒（動くと 0）
  farSec: number;          // 前の pickMove から far にいた秒
  dashedRecently: boolean; // 最後にダッシュを見てから dashMemory 秒以内
  behind: boolean;         // ボスの向き（e.facing）の後ろ（内積 < 0）
  terrain: TerrainKind;    // プレイヤーの足元（terrainAt）
}
export function updateBossRead(state: GameState, e: Enemy, dt: number): void;
export function readPlayer(state: GameState, e: Enemy): PlayerRead;
export function bossDown(state: GameState, e: Enemy, time: number, text: string, color: string): void;
export const BOSS_THREATS: Readonly<Record<string, readonly [ThreatBand, ThreatBand, ThreatBand]>>;

export interface BossHooks {
  approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void;
  beginWindup(state: GameState, e: Enemy, def: EnemyDef): void;
  beginStrike(state: GameState, e: Enemy, def: EnemyDef): void;
  tickStrike?(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean;
  /** 省略可に変える（pickMove が無いボスだけが使う） */
  sequence?(e: Enemy): readonly number[];
  pickMove?(state: GameState, e: Enemy, read: PlayerRead): number;
  followUp?(state: GameState, e: Enemy, done: number): number | null;
  recoverRetreatMul?(e: Enemy): number;
  /** 硬直の終わり（次の技を選ぶ直前）。スライム王の消化の回復など */
  onRecoverEnd?(state: GameState, e: Enemy): void;
  intervalMul?(e: Enemy): number;
}

/** 章ボスの署名の技（最深の主の第三の顔が借りる）。各章ボスのファイルが export する */
export interface BossSignature {
  readonly key: string; // 章ボスの敵 key
  beginWindup(state: GameState, e: Enemy, def: EnemyDef): void;
  beginStrike(state: GameState, e: Enemy, def: EnemyDef): void;
  tickStrike?(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean;
  telegraph?(e: Enemy): EnemyTelegraph;
}
```

記録と取り巻きの 3 関数は `combat.ts` / `enemyTraits.ts` から呼ばれるので、import の輪を作らないよう **`system/bossRecord.ts`（新）** に分ける（import は `core/state`・`data/enemies`・`data/tuning`・`poise` だけ）:

```ts
// src/system/bossRecord.ts
export function noteBossFightHit(state: GameState): void;           // combat.ts の damagePlayer の "hit" から
export function noteBossMinionDeath(state: GameState, e: Enemy): void; // enemyTraits.ts の onEnemyDeath から
export function pushBossRecord(state: GameState, e: Enemy): void;      // boss.ts の onBossDeath（major）から
```

`runBossCycle` の変更点: 頭で `updateBossRead`。strike の終わり（先送りの怯みを払った後）で `followUp` を見て、続くなら `ai.move = next; e.phase = "windup"; h.beginWindup(); e.phaseTimer *= chainWindupMul; e.windupTotal = e.phaseTimer; e.chainWindup = true`。windup → strike の切り替えで `e.chainWindup = false`。recover 中は `recoverRetreatMul` で離れる。recover の終わりで `onRecoverEnd` → `ai.move = pickMove ? pickMove(state, e, readPlayer(state, e)) : 並びの次` → `read.farSec = 0`。

`EnemyAi` に足す（`core/state.ts`）: `read?: { lastPos: Vec; stillSec: number; farSec: number; dashAgo: number; wasDashing: boolean }`、`progress?: number`（行為で進む段階の数え: 追い詰めのダウン・引火・壁激突・門柱）、`digest?: number`（スライム王が呑んだ数）、`chain?: number`（今の連撃の何段目。followUp が読む）。

### 2-2. スライム王（章 1。`system/bossKingSlime.ts` 新）

`boss.ts:253-342` を移して器に乗せる。behavior は `"kingSlime"` のまま（key・絵・図鑑は変えない）。

| 段階 | 危ない間合い | 入り方 | 技（pickMove） | 部屋 | ダウンの隙 |
| --- | --- | --- | --- | --- | --- |
| 1 跳躍 | still | 開始 | `KS_JUMP`: 予備動作 → 空中（着地点の影 `jumpTime`）→ 着地の衝撃波 + 真下の潰し（今のまま）。**連撃**: 着地の時点で `read.stillSec ≥ BOSS.rules.stillSec` なら `followUp` でもう 1 回跳ぶ（`stillJumpChain` 回まで） | 変えない | 着地後の硬直（`recover`） |
| 2 分裂 | moving | HP ≤ `phase2Ratio`（0.5 のまま）→ 分裂体 `splitCount` 3 体（`leaderId` = 王）。1.6 倍速は今のまま | `KS_SWALLOW`: 最後の呑みから `swallowEvery` 秒経ち、生きた分裂体があれば選ぶ。最寄りの分裂体へ跳び（`swallowHopTime`）、着地で分裂体を消す（`vanished = true`、撃破に数えない）、`digest += 1`、硬直 `digestTime`。硬直の終わり（`onRecoverEnd`）に `digest × swallowHealRatio × maxHp` 回復。**消化中に怯んだら回復しない**（「吐き出し」の浮き文字、`digest = 0`）。それ以外は `KS_JUMP` | 着地点に**毒沼**（`seedTerrain(…, "bog", acidRadius, { delay: 0, duration: acidTime, quiet: true })`。床が減る） | 消化の `digestTime`（動かず強靭なし = 呑む間が隙） |
| 3 膨張 | near | **分裂体が 0 体**（倒されても呑まれても）。保険で HP ≤ `phase3Ratio` | `KS_INFLATE`: 部屋の中央へ跳び → 予備動作 `inflateWindup`（輪の予告、半径 = 波の半径）→ 攻撃中に `waveGap` 秒ごとに衝撃波 `waveCount` 重。波の半径 = 中央から部屋の最も近い角までの距離 × `cornerSafeRatio`（**四隅だけ安全**）。プレイヤーが far なら `KS_JUMP` を挟む | 四隅 | 膨張の後の硬直 `exhaustTime`（長い） |

- 規則 1（行為で進む）: 段階 3 は分裂体を片付けた時点で HP に関わらず来る。分裂体を倒すと規則 5 で王に怯み値が入り、放っておくと呑まれて回復される = 「雑魚を処理する理由」
- 予告: 跳躍 = 影（既存）、呑み = 小さな輪（`{ kind: "ring", radius: swallowRingRadius }`）、膨張 = 輪
- 署名の技 `KING_SLIME_SIGNATURE` = `KS_JUMP`（段階 1 の形。第三の顔が借りる）

### 2-3. 盗賊王（章 2。`bossThiefKing.ts`）

| 段階 | 危ない間合い | 入り方 | pickMove | 部屋 | ダウンの隙 |
| --- | --- | --- | --- | --- | --- |
| 1 逃げ撃ち | far | 開始 | far → 短剣。`dashedRecently` かつ near / mid → 煙玉（詰めてきた相手から逃げる）。`stillSec ≥ stillSec` → 地雷。他は短剣と地雷を交互（`ai.counter` の偶奇。乱数なし） | 変えない | 追い詰めのダウン（既存） |
| 2 手下と地雷 | moving | HP ≤ 0.65（今のまま） | far → 地雷（追ってくる道を塞ぐ）、near → 煙玉、mid → 短剣 | **柵**: 段階 2 の始まりに、部屋の 4 分割の中心のうち王から遠い 2 か所へ L 字の一時壁（`spawnBoneWall` を数値引数つきにして流用。長さ `fenceLen`、耐久 `fenceHp`、`sourceKey = "thiefKing"`）。**角が増えて追い詰めやすくなる** | 追い詰めのダウン |
| 3 開き直り | near | HP ≤ 0.3、**または追い詰めのダウンが `cornersToRage` 回**（`ai.progress`） | near → 短剣（怒りの扇、`followUp` で 1 回だけもう 1 扇）、それ以外 → 突進。突進は壁に当たらなければ `followUp` でもう 1 回（`dashChain`） | 柵が全部崩れる（`h.time = 0`） | 突進の壁激突（既存） |

- 離脱: 段階 1・2 の硬直で `retreatMul`（一撃離脱）
- 署名の技 `THIEF_KING_SIGNATURE` = 地雷の扇（`beginWindup` の影 → `beginStrike` の設置）

### 2-4. 油壺の王（章 3。`bossOilKing.ts`）

| 段階 | 危ない間合い | 入り方 | pickMove | 部屋 | ダウンの隙 |
| --- | --- | --- | --- | --- | --- |
| 1 投げ | far | 開始 | far → 油壺、他 → 突進 | 最初の油溜まり 4（既存） | 突進の壁激突・引火（既存） |
| 2 着火 | moving | HP ≤ `phase2Ratio`（今のまま） | **足元が油（`read.terrain === "oil"`）→ 火炎瓶**、`stillSec ≥` → 火炎瓶、far → 油壺、他 → 突進 | 段階 2 の始まりに最初の油溜まり 4 か所へ火を点ける（`setupOilKingRoom` と同じ幾何で位置を出し `igniteTerrainAt`） | 同上 |
| 3 油まみれ | near | HP ≤ `phase3Ratio`、**または引火が `ignitesToDrench` 回**（`ai.progress`。王を火へ誘った回数） | near → 叩きつけ、足元が油 → 火炎瓶、他 → 突進（壁に当たらなければ `followUp` で 2 段目、`chargeChain`） | 歩いた跡に油（既存） | 同上 |

- 署名の技 `OIL_KING_SIGNATURE` = 油壺（影 → 割れて油溜まり）

### 2-5. 鏡の騎士（章 4。`bossMirrorKnight.ts`）

| 段階 | 危ない間合い | 入り方 | pickMove | 部屋 | ダウンの隙 |
| --- | --- | --- | --- | --- | --- |
| 1 盾 | far | 開始 | near → **盾打ち**（新 `MIRROR_BASH`: 扇の予告 `bashRange` / `bashHalfDeg`、`bashDamage`）、他 → 突進。正面の弾の反射（既存） | 変えない | 突進の壁激突 |
| 2 模写 | near | HP ≤ `phase2Ratio`、**または壁激突が `slamsToCrack` 回**（`ai.progress`。浮き文字「盾割れ」） | 2 回に 1 回 **模写**（新 `MIRROR_COPY`）、他は near → 盾打ち / far → 剣の波。装備の状態異常を乗せる（既存）は残す | 変えない | **模写の後の反動** `copyRecoil` 秒（`bossDown`、「反動」） |
| 3 写し身 | moving | HP ≤ `phase3Ratio`（今のまま） | far → 剣の波、near → 盾打ち → `followUp` 突進 | 段階 3 の始まりに**姿見**（新 `mirrorPane`、置物）を `panes` 枚、中央から左右 `paneOffset`。写し身（既存）が倒れても、姿見が 1 枚でも立っていれば `imageReform` 秒後にその姿見から写し身が戻る | **姿見を割ると騎士がダウン** `paneDown` 秒（「鏡割れ」） |

**模写の形**（`mirrorCopyForm(state): "ring" | "line" | "fan" | "lunge"`。`state.skills.lastCast` の skillKey が技なら `ART_DEFS[key].acts[0].kind` で決め、技でない・無いなら `"fan"`）

| 行為の種類 | 写す形 | 中身（予告） |
| --- | --- | --- |
| ring / detonate / buff | ring | 自分の周りに衝撃波 `copyRingRadius`（輪） |
| line / chain | line | プレイヤーへの光線 `spawnLaser`、`copyLaserTime`（線） |
| shot / arc / pull | fan | 剣の波（既存の扇弾。扇の予告） |
| dash / blink | lunge | 突進（線） |

- 署名の技 `MIRROR_KNIGHT_SIGNATURE` = 剣の波

### 2-6. 最深の間・最深の主・踏破

**最深の間**: `isFinalDepth(depth) = depth === ARC.floorsPerChapter × ARC.maxChapter + 1`（21）。`isBossDepth` をこの深度でも true にする（面積 1 倍・rooms 型・隠し部屋なし・階の主なし・出口は全部祝福・上り階段なし・次の階の契約者確定。全部既存の `isBossDepth` の分岐がそのまま効く）。`bossKeyForDepth` は最深の間で `ARC.finalBoss`。深みの回転（25 から）は変えない。形は既存のボス階と同じ（run-arc の「部屋 1 つの回廊」は作らない。6 章 5）。

**最深の主**（key `deepLord`、表示「最深の主」、behavior `"deepLord"`、`boss: true`、役割 vanguard）

| 段階 | 危ない間合い | 入り方 | 技（pickMove） | 部屋 | ダウンの隙 |
| --- | --- | --- | --- | --- | --- |
| 1 四門 | far | 開始（浮き文字「四門」） | 中央から動かない。far → **光線** `beamCount` 本（扇 `beamSpreadDeg` でプレイヤーへ、`spawnLaser`）。プレイヤーが門柱から `pillarGuardDist` 以内 → **落石** `rainCount`（プレイヤーの足元と周りに影 → `blastBoth`）。他 → 落石 | **門柱**（新 `gatePillar`、置物）4 本を部屋の四隅から `pillarInset` タイル内側に。1 本ずつ別の精鋭修飾子（TS の `PILLAR_ELITES = ["shielded", "reflective", "retaliating", "searing", "hexing", "bulwark"]` の先頭から、`eliteKindsFor(gatePillar)` が許し、置物で効くもの 4 つ。効かない修飾子は E2 が確かめて表から外す） | **門柱が 1 本でも立つ間は本体に通らない**（`bossArmorBlocks` に 1 行。「無効」）。**1 本折るごとに本体が `pillarDown` 秒ダウン**（「門崩れ」） |
| 2 陥没 | moving | **門柱 4 本を全部折る**（`ai.progress`。HP では進まない） | near → **3 段の連撃**（扇の予告 `slashRange` / `slashHalfDeg`、`followUp` で `slashCount` 段、2 段目からコミット）→ 硬直 × `slashRecoverMul` + 離脱。far → 踏み込み（突進、壁激突で `wallStagger`）。`stillSec ≥` → 落石 | `collapseEvery` 秒ごとに外周 `ringTiles` 幅のタイルへ影（`seedTerrain(…, "lava", TILE/2, { delay: collapseWarn, duration: 0 })`）→ 溶岩（消えない）。`collapseSteps` 回で止まる（18×14 の部屋なら 10×6 が残る）。本体の歩く先は残った内側に留める | 連撃の後の長い硬直、突進の壁激突 |
| 3 第三の顔 | still | HP ≤ `phase3Ratio`（「第三の顔」） | **奈落の手**（`handCount` 個の影を `handGap` 秒おきにプレイヤーの足元へ順に。止まると当たる）→ 借りた技 A → near なら連撃 / far なら踏み込み → 借りた技 B → …（`ai.counter` で巡る） | 陥没の残りのまま | **借りた技の後の反動** `borrowRecoil`（「反動」） |

- **借りる 2 体**: `state.bossLog` の章ボス（`ARC.chapters` の key）を被弾 `hits` の多い順（同数は章の順）に 2 体。記録が 2 体に満たなければ章の順で埋める。借りた技は `BossSignature` の関数をそのまま呼ぶ（数値は各章ボスの JSON、ダメージは `depthDamage` で深度 21 に伸びる）。予告は `signature.telegraph`、無ければ影
- 生命: `stats/deepLord.json` の `hp` = 実装時の `stats/mirrorKnight.json` の `hp` × 1.4（深度の伸びは既存の `depthHpScale`）。門柱の `hp` = 実装時の `stats/icePillar.json` の `hp` × 3
- 撃破: 名のある遺物 1 つ確定（2-7）。階段は中央（既存）。**地上への道**（`PropKind "surface"`）を中央から右へ `ARC.surfaceOffset` タイル（陥没で残る内側）に置く。乗り続けて `ARC.surfaceHold` 秒で踏破

**踏破**

- `GameStatus = "playing" | "dead" | "cleared"`、`export function runOver(state: GameState): boolean { return state.status !== "playing"; }`（`core/state.ts`）
- `clearRun(state)`（`system/finale.ts`）: `status = "cleared"`、`deathTimer = 0`、`slowmo`、ログ「踏破」、`pushSfx("bossDefeat")`、`recordRunOnce(state)`
- 「ランが終わった」の意味で `=== "dead"` を読む 13 か所を `runOver` に（`core/game.ts:149`、`main.ts:1091, 1188, 1638, 1770`、`render/renderer.ts:816, 2061`、`render/effectsUi.ts:636`、`system/player.ts:204`、`system/mana.ts:17, 26, 61`、`core/replay.ts:736`）。`combat.ts:690`（死ぬ）と `qa/economyMetrics.ts:455`（死んだか）は `"dead"` のまま
- 画面: `renderer.ts` の `drawDeath` の見出しを `status === "cleared" ? "踏破" : "力尽きた"`（色も分ける）。`ui/title.ts:567` の `cause` を `cleared` / `defeated` / `abandoned` の 3 つに、`render/titleUi.ts:126` に `cleared: "踏破"`
- 持ち帰りの選択（袋）は作らない（袋が未実装。拾った遺物は今どおり拾った時点で倉庫へ）。深みへ行く人は階段を降りる

**予習**（3-10「準備が効く」）: 章の休符（6 / 11 / 16）と深度 16 の到着で「この章の主: 地下 10 階 盗賊王」をログに 1 行（`announceChapterAhead(state)`、`descend` の末尾の `fresh` の枝から）。深度 16 の行は 20 の鏡の騎士と 21 の最深の主の 2 つ。占い師の「次のボス」（`contractors.ts:629-638`）は `isBossDepth` を読むので 21 も自然に出る。

### 2-7. 固有の報酬（規則 6。`system/bossRewards.ts` 新）

`BOSS_REWARD_KIND: Readonly<Partial<Record<string, BossRewardKind>>>`（TS）。数は `BOSS.rules.rewards`（JSON）。深みの回転のボス 5 体は持たない（レア 2 だけ。6 章 3）。

| ボス | 種類 `BossRewardKind` | 中身 |
| --- | --- | --- |
| スライム王 | `flask` | `dropFlask` × `flasks`（1） |
| 盗賊王 | `purse` | `gainCoins(…, purseBase + pursePerDepth × depth, "room")` と `gainKey` × `keys`（1） |
| 油壺の王 | `rune` | `dropRune` × `runes`（1） |
| 鏡の騎士 | `stone` | `dropSkillStone` を、装着中・所持中の skillKey と違う石が出るまで `stoneRerolls` 回まで引き直す |
| 最深の主 | `named` | `generateItem`（`rarityBoost: namedBoost`、`itemLevel: depth + 1`、`excludeNamed: state.lockedRelics`）を rarity が `unique` になるまで `namedAttempts` 回まで |

### 2-8. 決定性

- `pickMove` / `followUp` / 読み / 門柱の修飾子 / 柵と姿見と陥没の位置 / 借りる 2 体は **乱数を使わない**（位置は部屋の矩形の幾何、選びは表の順と `ai.counter`）
- 乱数が増えるのは撃破の報酬（瓶・符・石・遺物）と、最深の間が通常階でなくなること（深度 21・22 の生成の消費が変わる）だけ。`REPLAY_VERSION` を 1 つ上げる
- 描画は `thiefKingCornered` のような読み出し関数だけを使い、`state.rng` を引かない（柵の色は `sourceKey` で分ける）

---

## 3. 型・JSON・テスト・REPLAY_VERSION・セーブの移行

### 3-1. 型（共有ファイルは最小 Edit）

| ファイル | 変更 | レーン |
| --- | --- | --- |
| `src/core/state.ts` | `EnemyAi.read? / progress? / digest? / chain?`（:355-380 の末尾）、`BossState.hits?: number / lockedAt?: number`（:427-436）、`export interface BossRecord { key: string; depth: number; seconds: number; hits: number; downs: number }`（BossState の直後）、`GameState.bossLog: BossRecord[]`（`boss` の行の直後） | A |
| `src/core/state.ts` | `GameStatus` に `"cleared"`（:25）、`runOver`（`GameStatus` の直後） | E1 |
| `src/core/game.ts` | `createGame` の初期値 `bossLog: []` | A |
| `src/core/game.ts` | `step` の :149 を `runOver(state)` に | E1 |
| `src/system/hub.ts` | 拠点の GameState の初期値 `bossLog: []`（:112 付近） | A |
| `src/system/bossKit.ts` | 2-1 の型と関数、`BOSS_THREATS` | A |
| `src/system/specialRooms.ts` | `PropKind` に `"surface"`、`PROP_LABEL.surface = "地上への道"`、`holdAscend` を `holdProp(state, prop, touching, dt, need, done)` にして上り階段と地上への道で共有、`roomHooks.surface`、`export function placeSurface(state, room, pos)` | E1 |
| `src/data/enemies.ts` | `EnemyBehavior` に `"deepLord"` | E2 |
| `src/data/enemiesWave3.ts` | `deepLord` / `gatePillar`（`reaperShade` の行の後 = 配列の末尾）、`mirrorPane`（`mirrorImage` の行の直後）。`gatePillar` と `mirrorPane` は behavior `"inert"`・`noCorpse`。3 体とも `minDepth 99`・`weight 0`（抽選に出さない） | E2 / D |
| `src/data/enemyDefense.ts` / `src/data/enemyCombatWave3.ts` | `deepLord` / `gatePillar` は末尾、`mirrorPane` は `mirrorKnight` の行の直後。置物は `icePillar` と同じ形（`CONTACT`、`immune: FIXTURE_IMMUNE`） | E2 / D |
| `src/data/enemyRoles.ts` / `src/system/behaviors/registry.ts` | `deepLord: "vanguard"` / `deepLord: new BossDriven("deepLord")` | E2 |

### 3-2. balance JSON（`_fields` を親に 1 回。新しい葉には全部説明を付ける = `balance.test.ts` の基準値を増やさない）

| ブロック | 中身（初期値。**すべてボスの中の比か新しい量**で、7e の曲線を読まない） | レーン |
| --- | --- | --- |
| `enemies/BOSS/rules.json`（新。`BOSS/_index.json` の `_order` に `"rules"`） | `nearDist 70` / `farDist 150` / `stillSpeed 15`（px/s）/ `stillSec 0.6` / `dashMemory 1.5` / `chainWindupMul 0.6` / `minionPoiseRatio 0.2` / `rewards { flasks 1, purseBase 30, pursePerDepth 4, keys 1, runes 1, stoneRerolls 8, namedBoost 10, namedAttempts 60 }` | A |
| `enemies/BOSS/kingSlime.json` | 足す: `stillJumpChain 1` / `acidRadius 20` / `acidTime 8` / `swallowEvery 6` / `swallowHopTime 0.6` / `swallowRingRadius 24` / `digestTime 1.5` / `swallowHealRatio 0.06` / `phase3Ratio 0.25` / `inflateWindup 1.4` / `waveCount 3` / `waveGap 0.5` / `waveDamage 16` / `cornerSafeRatio 0.8` / `exhaustTime 2.5`。既存は据え置き | A |
| `enemies/BOSS/thiefKing.json` | 足す: `cornersToRage 2` / `fenceLen 3` / `fenceHp 60` / `fenceTime 999` / `retreatMul 1.2` / `dashChain 1` | B |
| `enemies/BOSS/oilKing.json` | 足す: `ignitesToDrench 2` / `chargeChain 1` | C |
| `enemies/BOSS/mirrorKnight.json` | 足す: `slamsToCrack 2` / `bashRange 40` / `bashHalfDeg 50` / `bashDamage 14` / `copyRecoil 1` / `copyRingRadius 60` / `copyLaserTime 0.6` / `copyDamage 16` / `panes 2` / `paneOffset 70` / `imageReform 4` / `paneDown 1.5` | D |
| `enemies/BOSS/deepLord.json`（新。`_order` に `"deepLord"`） | `pillarInset 3` / `pillarDown 2` / `pillarGuardDist 60` / `rainCount 3` / `rainRadius 26` / `rainSpread 40` / `rainFall 0.9` / `rainDamage 20` / `beamCount 3` / `beamSpreadDeg 30` / `beamTime 0.8` / `beamDamage 18` / `collapseEvery 6` / `collapseWarn 1.5` / `collapseSteps 2` / `ringTiles 2` / `slashCount 3` / `slashRange 50` / `slashHalfDeg 60` / `slashDamage 18` / `slashRecoverMul 2` / `lungeSpeedMul 5` / `lungeTime 0.5` / `wallStagger 1.2` / `retreatMul 1` / `phase3Ratio 0.35` / `handCount 4` / `handGap 0.4` / `handRadius 22` / `handDamage 20` / `borrowRecoil 1` / `color "#9080d0"` | E2 |
| `enemies/stats|combat/deepLord.json`・`gatePillar.json`、`defense/enemies/…` | 2-6 の比で書く（`combat` の `superArmorMul` は鏡の騎士と同じ） | E2 |
| `enemies/stats|combat/mirrorPane.json`、`defense/enemies/mirrorPane.json` | `icePillar` の写し（`hp` は `icePillar` × 2） | D |
| `world/ARC.json` | 足す: `finalBoss "boneLord"`（E1。E2 が `"deepLord"` に替える）/ `surfaceHold 1.5` / `surfaceOffset 2` / `surfaceColor "#d0f0ff"` / `aheadColor "#ffd75f"` | E1（E2 は `finalBoss` の値だけ） |

`src/data/balance/assembled.gen.ts` は新しい JSON ファイルで import が増える（手で直さない）。**同じ段の複数レーンが新しい JSON を足すので、取り込みで衝突したら統合役が `pnpm run balance:gen` を回して作り直す**。

### 3-3. テスト（新しい仕組みには必ず。`it` は日本語）

**A**（`system/bossKit.test.ts` 新・`system/bossKingSlime.test.ts` 新・`system/bossRewards.test.ts` 新）

- 「プレイヤーが止まっていると静止の秒が溜まり、動くと 0 に戻る」「距離で近い / 中 / 遠いに分かれる」「ダッシュを見てから dashMemory 秒は直近のダッシュとして覚える」
- 「pickMove があれば並びより優先し、乱数を引かない（`vi.spyOn(state.rng, "next")` が呼ばれない）」
- 「followUp の続きは硬直を挟まず、予備動作は最初からコミット（怯み値が溜まらない）」「recoverRetreatMul があると硬直の間にプレイヤーから離れる」
- 「ボス部屋の取り巻きを倒すとボスに怯み値が入り、卵・地雷・置物・ボス部屋の外の敵では入らない」
- 「封鎖中の被弾を数え、撃破で bossLog に key・深度・秒・被弾・ダウンが 1 件積まれる」「階の主（major でない）は bossLog に積まない」
- 「BOSS_THREATS: 章ボス 4 と最深の主は段階が 3 つで、隣り合う段階の危ない間合いが違う」
- 「章ボス 4 体の署名の技は予備動作で予告（影か予告の形）を出し、攻撃で当たる」
- スライム王: 「第 1 段階は跳躍の影の間は無害で、着地で衝撃波」「静止していると着地の直後にもう 1 度跳ぶ（2 回目の予備動作はコミット済み）」「HP が phase2Ratio を切ると splitCount 体に分裂し、第 2 段階の着地は毒沼を残す」「第 2 段階は swallowEvery 秒ごとに分裂体を呑み、消化の digestTime 秒は動かず、終われば回復する」「消化中に怯ませると回復しない」「分裂体が 0 体になると HP に関わらず第 3 段階」「膨張の衝撃波は waveCount 重で、半径は部屋の四隅に届かない」「膨張の後は exhaustTime 秒動かない」「同じ seed と入力なら同じ技の順」
- 報酬: 「スライム王は瓶、盗賊王は銭と鍵、油壺の王は刻印符、鏡の騎士はスキル石、最深の主は名のある遺物を落とす」「鏡の騎士の石は持っているスキルと違う」「深みの回転のボスは固有の報酬を持たない」
- `system/boss.test.ts` のスライム王の 3 件（:99-130）は `bossKingSlime.test.ts` へ移して新しい仕様に書き直す

**E1**（`system/finale.test.ts` 新・`system/chapters.test.ts` 追記）

- 「isFinalDepth は 21 だけ」「最深の間はボス階として作られ（面積 1 倍・rooms 型・階の主なし）、ARC.finalBoss が出る」「深度 22 は最深の間ではなく、25 は深みの回転のボス」
- 「最深の主を倒すと階段と地上への道が出る」「地上への道に surfaceHold 秒乗り続けると踏破になり、status が cleared で記録が 1 回だけ」「離れると乗った秒が 0 に戻る」「踏破の後は step が進まない」
- 「章の休符と深度 16 の到着で、この章の主の階と名前をログに出す」
- `ui/title.test.ts`（あれば）: 「踏破で終わった履歴の cause は cleared」

**B**（`system/bossThiefKing.test.ts`）: 「第 1 段階: 遠いと短剣、ダッシュで詰めると煙玉」「追い詰めのダウンが cornersToRage 回で HP に関わらず開き直る」「第 2 段階の始まりに柵が立ち、開き直りで崩れる」「開き直りの突進は壁に当たらなければもう 1 度続く」「第 1・2 段階の硬直の間は離れる」

**C**（`system/bossOilKing.test.ts` 新。`bossWave3.test.ts` の「油壺の王」の describe（:101-124）を移す）: 「第 2 段階の始まりに最初の油溜まりに火が点く」「足元が油のプレイヤーには火炎瓶」「引火が ignitesToDrench 回で HP に関わらず油まみれ」「油まみれの突進は壁に当たらなければ 2 段続く」

**D**（`system/bossMirrorKnight.test.ts` 新。`bossWave3.test.ts` の「鏡の騎士」の describe（:168-226）を移す）: 「近いと盾打ち（扇の予告）」「壁激突が slamsToCrack 回で HP に関わらず模写」「模写は直前に撃ったスキルの最初の行為の形（輪・帯・扇・突進）を写し、無ければ扇」「模写の後は copyRecoil 秒のダウン」「第 3 段階の始まりに姿見が panes 枚立ち、姿見が残っている間は倒した写し身が imageReform 秒後に戻る」「姿見を割ると騎士がダウンする」

**E2**（`system/bossDeepLord.test.ts` 新）: 「部屋の四隅寄りに門柱が 4 本立ち、それぞれ別の精鋭修飾子を持つ」「門柱が 1 本でも立つ間は本体にダメージが通らない」「門柱を折るたびに本体が pillarDown 秒ダウンし、4 本で第 2 段階」「陥没は collapseEvery 秒ごとに外周から影の後に溶岩へ変わり、collapseSteps 回で止まる」「陥没中の最深の主は溶岩の上へ歩かない」「近いと 3 段の連撃（2 段目からコミット）と長い硬直」「第三の顔は bossLog の被弾の多い章ボス 2 体の技を借り、記録が無ければ章の順」「奈落の手はプレイヤーの足元へ影を順に落とし、止まっていると当たる」「借りた技の後は反動のダウン」「同じ seed と入力なら同じ結果」

**F**（`qa/bossMetrics.test.ts` 新・`qa/bossProbe.test.ts` 新）: 「bossLog から章ボスごとの戦闘数・撃破数・秒と被弾の中央値を表にする（NaN・Infinity なし）」「縮小版は章ボス 4 と最深の主を 1 seed ずつ測り、値は有限」「同じ設定で同じ結果」「段階ごとの被弾を間合い（近い / 中 / 遠い）と静止中かで数える」

### 3-4. `REPLAY_VERSION`（`/home/user/roguelike/src/core/replay.ts:77`、今 30）

- **8b の取り込みの後に 1 回だけ上げる**（取り込んだ時点の値 + 1。7e が 31 を使っていれば 32）。8a の取り込みでは上げない（`AI_WORKFLOW.md` の「大きな段の終わりに 1 回」）
- コメント: 「章ボス 4 の作り直し（状態で技を選ぶ・連撃・行為で進む段階・部屋の変化）・取り巻きの怯み値・固有の報酬・最深の間と最深の主・踏破（敵の動きと撃破の乱数の消費、深度 21 の生成が変わる）」
- `docs/ARCHITECTURE.md` の版の一覧に 1 行

### 3-5. 壊れそうなテスト（既存）

| テスト | 理由 | 直し方 | 持ち主 |
| --- | --- | --- | --- |
| `system/boss.test.ts:99-130`（スライム王 3 件） | 段階と技が変わる | `bossKingSlime.test.ts` へ移して書き直す | A |
| `system/boss.test.ts:66`（撃破で階段とレア 2） | 瓶は `pickups`、符・石は別の配列なので `floorItems` の 2 は変わらない見込み。最深の主だけ 3 | 落ちたら数える配列を確かめる | A |
| `system/bossThiefKing.test.ts:90`（3 段階まで進む） | HP の段階は残るので通る見込み。柵が壁になり歩きの検査が揺れうる | 柵の位置を避けた検査点に | B |
| `system/bossWave3.test.ts:71-99`（全体） | HP の段階は残るので通る見込み。**触らない**（C と D の衝突を避ける）。落ちたら報告 | 統合役 | — |
| `system/chapters.test.ts:25, 46` | 21 は章ボス階でも休符でもないまま（`isChapterBossDepth` は変えない） | 変えない | E1 |
| `system/roomTypes.test.ts:331`（深度 21 を含む泉の検査） | 21 がボス階になっても泉 0 のまま | 変えない | — |
| `system/exits.test.ts`「章ボス階は全部祝福」 | 21 も全部祝福になる | 期待どおり。落ちたら 21 を足す | E1 |
| `system/contractors.test.ts`（`nextBossDepth`） | 16〜20 から見た次のボスは 20、21 から見ると 21 | 21 の期待値を持つ検査があれば直す | E1 |
| `core/replay.test.ts` | record → playback | そのまま | — |
| `system/floatingText.test.ts` | 新しい浮き文字（膨張 / 呑み込み / 吐き出し / 盾割れ / 反動 / 鏡割れ / 四門 / 門崩れ / 陥没 / 第三の顔 / 踏破）は全部体言止め | そのまま通る | 各 |
| `render/sprites.test.ts` | 新しい敵の絵 | `recolor` か P の絵で埋める | D / E2 |
| `data/balance/balance.test.ts`（説明の無い葉の基準値） | 新しい葉 | 全部 `_fields` に書く | 各 |
| `pnpm run audit:docs` | 新しいファイル 7 つが `CODE_MAP.md` に無い | 統合役がコードと同じコミットで足す | 統合役 |

### 3-6. セーブの移行

**無し**。キーも形も変えない。`RunHistoryEntry.cause` に `"cleared"` が増えるが、`sanitizeHistoryEntry`（`loot/profile.ts:263`）は任意の文字列を通し、古い版で読んでも `cause` の表示が無いだけ。図鑑は `ENEMIES` から引くので新しい敵 3 体が増えるだけ（`roguelike.codex.v1` の既存の key は消えない）。

---

## 4. 段階とレーン

全レーン `isolation: "worktree"`。レーンはコミットしない。作業中は自分のテストだけ `pnpm exec vitest run <ファイル>`、最後に 1 回 `pnpm run check:fast`。統合役は段の終わりに `pnpm run check`。

### 8a（並行 3 本。遊べる: スライム王が新しい 3 段階、全ボスが取り巻きで怯み・固有の報酬、深度 21 が最深の間で骸骨卿が仮の主、倒すと踏破できる）

| レーン | モデル | 所有 | 最小 Edit のみ | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| **A 器とスライム王** | Opus（全ボスの状態機械と state の型、決定性） | `system/bossKit.ts`、`system/bossRecord.ts`（新）、`system/bossKingSlime.ts`（新）、`system/bossRewards.ts`（新）、`system/bossKit.test.ts`（新）、`system/bossKingSlime.test.ts`（新）、`system/bossRewards.test.ts`（新）、`system/boss.test.ts`（スライム王の 3 件を消す）、`balance/enemies/BOSS/rules.json`（新）、`BOSS/_index.json`（`_order`）、`BOSS/kingSlime.json` | `system/boss.ts`（**1〜24 行目の import と 53〜71 行目で使われなくなった定数、253〜342 行目のスライム王の削除、`bossTelegraph` に kingSlime、`announceBoss` に `lockedAt`、`onBossDeath` の `bossKillFx` の直後に記録と報酬の 2 行**。25 行目と 73〜98 行目は E1 のもの）、`system/bossThiefKing.ts` / `bossOilKing.ts` / `bossMirrorKnight.ts`（末尾に `export const XXX_SIGNATURE` を足すだけ。自傷の怯みを `bossDown` に寄せるのは 8b の各レーン）、`core/state.ts`（3-1 の A 分）、`core/game.ts`（`bossLog: []`）、`system/hub.ts`（`bossLog: []`）、`system/combat.ts`（`damagePlayer` の "hit" の経路に `noteBossFightHit(state)` 1 行）、`system/enemyTraits.ts`（`onEnemyDeath` の `crackEgg` の直後に `noteBossMinionDeath` 1 行） | `system/floor.ts`、`system/chapters.ts`、`system/specialRooms.ts`、`main.ts`、`render/**` | 2-1・2-2・2-7 が 3-3 のテストで通る。`sequence` だけのボス（群れの母・司書・霜の巨人・双子・骸骨卿）の挙動が変わらない（既存テストが通る） |
| **E1 最深の間と踏破** | Sonnet（場所がすべて列挙済みの小さな Edit） | `system/finale.ts`（新: `clearRun` / `placeSurfaceGate` / `updateFinale` / `announceChapterAhead`）、`system/finale.test.ts`（新）、`system/chapters.ts`（`isFinalDepth` / `finalBossKey` / `chapterAheadLines`）、`system/chapters.test.ts`、`balance/world/ARC.json` | `system/boss.ts`（**25 行目の chapters の import、73〜98 行目の `isBossDepth` と `bossKeyForDepth`** だけ）、`core/state.ts`（`GameStatus` と `runOver`）、`core/game.ts:149`、`system/specialRooms.ts`（3-1 の E1 分）、`system/floor.ts`（`installRoomHooks` に `surface`、`updateRooms` の末尾に `updateFinale(state)`、`descend` の末尾の `fresh` の枝に `announceChapterAhead(state)`）、`render/runUi.ts`（:87・:119・:153 に surface の色・ラベル・乗り続ける輪）、`main.ts:1091, 1188, 1638, 1770`、`render/renderer.ts:816, 2061, 3206`、`render/effectsUi.ts:636`、`system/player.ts:204`、`system/mana.ts:17, 26, 61`、`core/replay.ts:736`、`ui/title.ts:567`、`render/titleUi.ts:126`、`meta/tips.ts`（「踏破」の 1 項目。tips のテストが用語集の語を要求するなら `docs/GLOSSARY.md` に 最深の間 / 最深の主 / 踏破 / 地上への道 の 4 行も） | `system/bossKit.ts`、`bossKingSlime.ts`、`combat.ts`、`enemyTraits.ts` | 3-3 の E1 のテストが通る。`rg '=== "dead"' src` が `ui/title.ts`（cause の振り分け）・`qa/economyMetrics.ts`・テストだけ |
| **P 絵** | Opus（pixel-artist） | `src/data/sprites/bosses.ts` に `deepLord`（密度 2、32×32 相当。予備動作と攻撃の原画は `render/sprites.ts` の `poseKey` の形で）、`src/data/sprites/still.ts` に `gatePillar` / `mirrorPane`（24×24。`icePillar` と同じ据え置きの作法） | `src/data/sprites/dots.ts`（`SPRITE_DOTS` に 3 行） | `src/data/enemies*.ts`（定義は E2 / D が足す） | `ppnpm run sprite lint` が通る。`render/sprites.test.ts` が通る（使われない絵が増えても落ちない） |

**統合（8a）**: A → E1 → P の順に取り込む。`boss.ts` は A と E1 が別の行を触る（上の行の割り当て）。`assembled.gen.ts` は A だけが import を足す。`CODE_MAP.md` に `bossKingSlime.ts` / `bossRewards.ts` / `bossRecord.ts` / `finale.ts` の 4 行と、`boss.ts` の行の「スライム王は bossKingSlime.ts」。`REPLAY_VERSION` は上げない。

### 8b（並行 5 本。遊べる: 章ボス 4 と最深の主が全部新しい形、QA でボスを測れる）

| レーン | モデル | 所有 | 最小 Edit のみ | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| **B 盗賊王** | Sonnet | `system/bossThiefKing.ts`（`SEQUENCE` を消して `pickMove` / `followUp` / `recoverRetreatMul`。`THIEF_KING_SIGNATURE` は残す）、`system/bossThiefKing.test.ts`、`BOSS/thiefKing.json` | `system/hazards.ts`（`spawnBoneWall(state, tx, ty, spec?: { time: number; hp: number; sourceKey?: string })`。省略時は今の `BOSS.boneLord`）、`render/renderer.ts:1752`（`boneWall` の色を `sourceKey === "thiefKing"` なら木の色。2 行） | 他のボスのファイル | 2-3 と 3-3 の B |
| **C 油壺の王** | Sonnet | `system/bossOilKing.ts`、`system/bossOilKing.test.ts`（新）、`BOSS/oilKing.json` | `system/bossWave3.test.ts`（「油壺の王」の describe :101-124 を消すだけ） | 他のボスのファイル、`bossWave3.test.ts` の他の describe | 2-4 と 3-3 の C |
| **D 鏡の騎士** | Sonnet | `system/bossMirrorKnight.ts`、`system/bossMirrorKnight.test.ts`（新）、`BOSS/mirrorKnight.json`、`balance/enemies/{stats,combat}/mirrorPane.json`・`defense/enemies/mirrorPane.json`（新） | `data/enemiesWave3.ts`（`mirrorImage` の行の直後に `mirrorPane` 1 行。P の絵が取り込み済みなら `recolor` なし、未取り込みなら `recolor: { base: "icePillar", … }`）、`data/enemyDefense.ts` / `data/enemyCombatWave3.ts`（`mirrorKnight` の行の直後に 1 行）、`system/bossWave3.test.ts`（「鏡の騎士」の describe :168-226 を消すだけ） | 他のボスのファイル、`boss.ts` | 2-5 と 3-3 の D |
| **E2 最深の主** | Opus（新ボス・部屋の地形の書き換え・借りる技の組み立て） | `system/bossDeepLord.ts`（新）、`system/bossDeepLord.test.ts`（新）、`BOSS/deepLord.json`（新）、`balance/enemies/{stats,combat}/{deepLord,gatePillar}.json`・`defense/enemies/…`（新） | `BOSS/_index.json`（`_order` に `"deepLord"`）、`world/ARC.json`（`finalBoss` の値を `"deepLord"` に）、`data/enemies.ts`（`EnemyBehavior` に 1 行）、`data/enemiesWave3.ts`（**配列の末尾** = `reaperShade` の行の後に 2 行）、`data/enemyDefense.ts` / `data/enemyCombatWave3.ts`（**末尾**に 2 行）、`data/enemyRoles.ts`（1 行）、`system/behaviors/registry.ts`（1 行）、`system/boss.ts`（`updateBossEnemy` の switch・`bossTelegraph`・`bossArmorBlocks`・`setupBossRoom` に 1 行ずつ） | 章ボス 4 のファイル（署名の技は import して呼ぶだけ） | 2-6 と 3-3 の E2 |
| **F QA** | Sonnet（**7e の取り込み後に始める**） | `qa/bossMetrics.ts`（新）、`qa/bossMetrics.test.ts`（新）、`qa/bossProbe.ts`（新）、`qa/bossProbe.test.ts`（新） | `qa/simulation.test.ts`（ラン終わりに `state.bossLog` を集め、report に「## ボス」の表を 1 節）、`qa/bot.ts`（`nearestEngagedEnemy` で `bossArmorBlocks(state, e)` の敵を飛ばす 1 行。地上への道は踏まない = 目的地に選ばない）、`scripts/qa-probe.mjs`（`--bosses` で `SIM_PROBE=bosses`、`probe.md` の「## ボス」の節だけ差し替え。`--weapons` と同じ作法） | `system/**` | 6 章の指標が表に出る。縮小版が `pnpm run check:fast` の中で数秒 |

**衝突の確認（8b）**: `boss.ts` は E2 だけ。`enemiesWave3.ts` / `enemyDefense.ts` / `enemyCombatWave3.ts` は D が鏡の騎士の直後、E2 が末尾（離れた行）。`bossWave3.test.ts` は C と D が別の describe を消すだけ。`BOSS/_index.json` は E2 だけ。`assembled.gen.ts` は D と E2 が import を足す → 統合役が `pnpm run balance:gen`。**7e との衝突**: 8b の前に `git diff --stat <8a の統合コミット>..<7e> -- src/data/balance/enemies/BOSS src/data/balance/world/ARC.json src/data/balance/enemies/stats src/qa` を見る。7e が BOSS / ARC / ボスの stats に触れていれば 7e を先に入れてから 8b の worktree を切る。F は 7e の後でなければ始めない（`src/qa/` が 7e の所有）。

**統合（8b）**: B → C → D → E2 → F の順。`pnpm run balance:gen` → `pnpm run check`。`REPLAY_VERSION` を 1 つ上げる。レビューは段の終わりに `model: "opus"` の reviewer 1 回（決定性: `pickMove` に乱数が無いこと、陥没の溶岩と柵の `lockedTiles` の後始末、`bossLog` の積み方）。`ppnpm run qa:probe --bosses` を隔離 worktree で回して 6 章の表を見る。資料は段の終わりにまとめて: `CODE_MAP.md`（`bossDeepLord.ts` / `qa/bossMetrics.ts` / `qa/bossProbe.ts` の 3 行。8a の 4 行と合わせて新規 7）、`docs/recipes/enemy.md` に「ボス」の 5 行（`pickMove` / `followUp` / `BOSS_THREATS` / 署名の技 / 固有の報酬）、`docs/GLOSSARY.md`（6 章 1 の語）、`docs/BALANCE.md`（`BOSS.rules` / `deepLord` / `ARC` の追加）、`docs/ARCHITECTURE.md`（`GameStatus "cleared"`・`bossLog`・版の一覧）、`meta/tips.ts`（ボスの隙・第三の顔）、`IDEAS.md` の「現状」、`docs/ideas/README.md` の Q6 の行、`CHANGELOG.md`、`HANDOFF.md`。

---

## 5. 調整つまみと QA 指標

**つまみ（順に触る。全部 `balance/enemies/BOSS/**` と `world/ARC.json` の中）**

1. 読みの閾値 `BOSS.rules.nearDist / farDist / stillSec`（枝の出方。段階ごとの被弾の間合いが表と合わなければここ）
2. 行為の段階 `cornersToRage` / `ignitesToDrench` / `slamsToCrack`（行為で進む割合。目標 3〜6 割）
3. 取り巻きの怯み `BOSS.rules.minionPoiseRatio`（雑魚を処理した方が早い、が数字に出るか）
4. ダウンの長さ `digestTime` / `exhaustTime` / `copyRecoil` / `pillarDown` / `borrowRecoil`
5. 最深の主の生命（`stats/deepLord.json` の hp の倍）と `collapseSteps`（陥没の窮屈さ）
6. 報酬の量 `BOSS.rules.rewards`（経済の指標は economy-impl 5 章で見る）

**フル QA とボスの計測に足す表**（F）

撃破の秒・被弾の目標と比べるのは `qa:probe --bosses`（`src/qa/probe.md`「## ボス」）だけ。フル QA の装備は itemLevel 20 固定で章ボスの階では深度相応の 3〜4 倍の火力になるので、フル QA の「## ボス」は参考として読む（実プレイの推定はスライム王で約 30〜45 秒）。

| 指標 | どこで | 目標 |
| --- | --- | --- |
| ボスごとの撃破時間の中央値（bot、深度相応の装備） | `qa:probe --bosses`・フル QA | 章 1: 40〜90 秒 / 章 2・3: 60〜120 秒 / 章 4: 80〜150 秒 / 最深の主: 120〜200 秒 |
| ボスごとの被弾の中央値と、ボス戦で死んだ割合 | 同上 | 被弾 3〜8。ボス戦の死は全死亡の 2〜3 割（章ボスが関門になり、壁にならない） |
| 1 戦のダウン回数（自傷 + 怯み） | `bossLog.downs` | 2 回以上（全ボス） |
| 行為で進んだ段階の割合（分裂体・追い詰め・引火・激突・門柱） | probe | 3〜6 割（HP だけで進むなら行為の数を下げる） |
| **段階ごとの被弾の間合い**（近い / 中 / 遠い、静止中か、地形・影からか） | probe | 危ない間合いが near の段階は近い被弾が 5 割以上、far は遠い被弾が 5 割以上、still は静止中の被弾が 5 割以上、moving は地形・影・柵からの被弾が 4 割以上。合わない段階は `pickMove` の枝か技の数値を見直す |
| 取り巻きを倒した数と撃破時間の相関 | probe | 倒した方が短い |
| 最深の主の段階の長さ（四門 / 陥没 / 第三の顔） | probe | 3 段が 3:4:3 前後（四門で詰まらない） |
| 踏破率（最深の主を倒した割合） | フル QA（`bossLog` に `deepLord`） | 標準の bot で 5〜15%（core-synthesis 3-14 の「クリアがちょっと難しい」。7e の到達深度の目標と一緒に見る） |

---

## 6. 不確かな点（推奨 1 つ。★ はユーザー確認）

1. ★ **新しい表示名**（全部 `src/` と `docs/GLOSSARY.md` で衝突なしを確認済み。「崩落」は状態異常の反応名なので避けた）: 置物「門柱」「姿見」、一時壁「柵」、台座「地上への道」（「帰還」は上り階段で使用済み）、段階の浮き文字「四門」「陥没」「第三の顔」「膨張」、ダウンの浮き文字「呑み込み」「吐き出し」「盾割れ」「鏡割れ」「門崩れ」「反動」、技（表示なし）「奈落の手」。終わり方の名「踏破」は `run-arc.md` で決まっているが、装備の来歴に「階層踏破」があり近い。→ 推奨: この案で確定し、GLOSSARY の「部屋・フロア」に 最深の間 / 最深の主 / 踏破 / 地上への道 / 門柱 / 姿見 / 柵、「設計上の用語」に 四門 / 陥没 / 第三の顔 を足す
2. ★ **踏破をこの段で入れる**（`GameStatus "cleared"` と 13 か所の読み替え、踏破画面は死亡画面の見出し替え、袋・持ち帰りは作らない）。最深の主を倒しても何も終わらないと山場にならないため。→ 推奨: 入れる。袋と持ち帰り（`run-arc.md` 2 章）は段取り 9 以降
3. **固有の報酬は章ボス 4 と最深の主だけ**。深みの回転の 5 体（骸骨卿・双子・霜の巨人・群れの母・司書）は共通の規則のうち 5（取り巻き）と記録だけ受け、1〜4・6 は段取り 10（深み）で。→ 推奨: そうする（段取り 8 は章の山場に絞る）
4. **最深の主が借りる 2 体は「被弾の多い章ボス」**（encounter-core の「そのランの章ボスの署名の技」を、章ボスが固定になった今は「そのランで苦手だった相手」と読む）。→ 推奨: そうする（乱数なし・QA で再現できる）。記録が無い（深い起点・テスト）ときは章の順
5. **最深の間はふつうのボス階の形**（rooms 型・面積 1 倍）。`run-arc.md` 1-1 の「部屋 1 つの回廊」は作らない。→ 推奨: そうする（生成器に新しい形を足すほどの差が無い）
6. **階の主の作り直し（encounter-core 7-3 の部屋主のギミック）は段取り 8 に入れない**。core-synthesis 9 章の段取り 8 の中身に無く、隊長は段取り 3 で入った。→ 推奨: 段取り 10 の後の候補として `docs/ideas/README.md` に残す
7. **章ボスの弱点（`enemyDefense.ts` の耐性）は変えない**。3-10 の「準備が効く」はこの段では予習のログだけ。→ 推奨: 8b の probe で「火のビルドが油壺の王に強すぎる」などが出たら数値で直す
8. **陥没の溶岩は撃破後も残る**（階段と地上への道は内側に出る）。→ 推奨: 残す（消すと `placeTerrain` の消し方を足す必要があり、得が無い）。確認: E2 のテストで階段のタイルが溶岩でないこと
9. **スライム王の呑みで消えた分裂体は撃破に数えない**（`vanished`。報酬・来歴・陣の数えに入らない）。→ 推奨: そうする。確認: `bossKingSlime.test.ts` で `state.kills` が増えないこと
10. **bot が最深の主の四門で詰まる**（無敵の本体を殴り続ける）。F の `bossArmorBlocks` の 1 行が入るまで、フル QA で深度 21 の滞在が伸びる。→ 推奨: 8b の F を E2 と同じ取り込みに入れる（F が 7e 待ちで遅れるなら、E2 の取り込み時に統合役が `qa/bot.ts` の 1 行だけ先に入れる）
11. **7e との順序**: 8a の A・E1 は 7e の数値に依存しない（読むのはボスの JSON と ARC だけ）。ただし 7e が `balance/enemies/BOSS/**` か `world/ARC.json` を触っていれば取り込みで衝突する。→ 推奨: 8a の worktree を切る前に 7e のレーンの変更範囲を確かめ（4 章 8b の `git diff --stat`）、重なれば 7e を先に取り込む

## 7. 実装とのずれ（2026-09-30。8a・8b の取り込み後）

- 門柱の精鋭修飾子は 4 つ（`PILLAR_ELITES` = shielded / reflective / searing / hexing）。堅牢の・報復のは怯んだ瞬間に発動するので、怯まない門柱では何も起きず外した（2-6 の E2 が確かめる、の結果）
- 陥没の溶岩は撃破後も残さず、`BOSS.deepLord.collapseFade` 秒で消える（6 章 8 の「残す」から変更。階段と地上への道へ歩けるように）。崩れ終えた外周だけが対象で、まだ崩れていない外周には置かない
- `BossHooks` に `chainWindupMul`（連撃の続きの予備動作の倍をボスごとに変える）・`recoverTime`（硬直の秒）を足した。`signatureOf(key, move, hooks)`（署名の技の組み立て）と `noteBossDown`（ダウン回数を `bossLog` へ）が `bossKit.ts` / `bossRecord.ts` に入った
- `deepLord.json` の新しい葉: `beamLength` / `collapseMinInner` / `collapseFade` / `handFall`（2-6 の一覧に無い）
- 撃破の後始末は `settleThiefKingRoom`（柵・地雷）/ `settleMirrorKnightRoom`（写し身と姿見）/ `settleDeepLordRoom`（門柱・崩れる床の予約・借りた地雷）。残ると部屋の封鎖が解けない（レビューで見つかった不具合）
- ボスの QA（F）は取り込み済み（`qa/bossMetrics.ts` / `qa/bossProbe.ts`、フル QA の「## ボス」、`qa:probe --bosses`、bot は `bossArmorBlocks` の敵を狙わない）。結果: 撃破は目標より速い・深度相応の装備の bot は最深の主に 5/5 で倒れる・盗賊王 / 油壺の王 / 鏡の騎士は行為で進む段階が 0%（数値は `src/qa/probe.md` の「## ボス」）

## 参照（絶対パス）

- 仕様: `/home/user/roguelike/docs/ideas/core-synthesis.md`（3-9・3-10・3-14・9 章）、`/home/user/roguelike/docs/ideas/encounter-core.md`（1-3・7 章・12 章 Q6）、`/home/user/roguelike/docs/ideas/run-arc.md`（0 章・1-1・1-3・7 章の決定）、`/home/user/roguelike/docs/ideas/jin-impl.md`（冒頭の決定・2-4）、`/home/user/roguelike/docs/ideas/economy-impl.md`（2-8）
- コード: `/home/user/roguelike/src/system/boss.ts`、`/home/user/roguelike/src/system/bossKit.ts`、`/home/user/roguelike/src/system/bossThiefKing.ts`、`/home/user/roguelike/src/system/bossOilKing.ts`、`/home/user/roguelike/src/system/bossMirrorKnight.ts`、`/home/user/roguelike/src/system/chapters.ts`、`/home/user/roguelike/src/system/floor.ts`、`/home/user/roguelike/src/system/floorLord.ts`、`/home/user/roguelike/src/system/poise.ts`、`/home/user/roguelike/src/system/enemyTraits.ts`、`/home/user/roguelike/src/system/hazards.ts`、`/home/user/roguelike/src/system/enemyTerrain.ts`、`/home/user/roguelike/src/system/specialRooms.ts`、`/home/user/roguelike/src/system/elites.ts`、`/home/user/roguelike/src/system/combat.ts`、`/home/user/roguelike/src/system/economy.ts`、`/home/user/roguelike/src/system/loot.ts`、`/home/user/roguelike/src/system/skills.ts`、`/home/user/roguelike/src/core/state.ts`、`/home/user/roguelike/src/core/game.ts`、`/home/user/roguelike/src/core/replay.ts`、`/home/user/roguelike/src/main.ts`、`/home/user/roguelike/src/render/renderer.ts`、`/home/user/roguelike/src/render/runUi.ts`、`/home/user/roguelike/src/render/titleUi.ts`、`/home/user/roguelike/src/ui/title.ts`、`/home/user/roguelike/src/data/enemies.ts`、`/home/user/roguelike/src/data/enemiesWave3.ts`、`/home/user/roguelike/src/data/balance/enemies/BOSS/`、`/home/user/roguelike/src/data/balance/world/ARC.json`、`/home/user/roguelike/src/qa/bot.ts`、`/home/user/roguelike/src/qa/simulation.test.ts`、`/home/user/roguelike/scripts/qa-probe.mjs`
