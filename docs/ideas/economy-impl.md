# 銭と地図の実装設計（段取り 6）

作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 6。architect の設計をそのまま置く。6 章の ★（ユーザー確認）は、ユーザーの「進められる限り自走して」の指示を受けて統合役が推奨で決めた（下の表）。後でユーザーが変えたら、ここと該当の段を直す。

## 決めたこと（統合役、2026-09-30。ユーザーに報告して変えられるようにする）

| 項目 | 決定 |
| --- | --- |
| 1. 内部 key | `state.shards` → `state.economy.coins` に改名（Rule の効果「shards = 氷の破片」と衝突するため） |
| 2. 寄進 | `roguelike.hub.v1` に任意項目 `donated` を足すだけ（v2 不要）。使い道は後で。拠点の井戸に総額を表示 |
| 3. 商人を襲った後 | このランの値段が 2 倍（銭の出口は残す） |
| 4. 章ボス | 章 1 スライム王 / 章 2 盗賊王 / 章 3 油壺の王 / 章 4 鏡の騎士（core-synthesis 1 章 E29 を優先。骸骨卿・霜の巨人は深みのローテーション） |
| 5. 出口の予告 | 6f で祝福なしの縮小版にする。祝福の出口は段取り 7 |
| 6. 瓶のキー | B と 5、パッドは十字キー上（キー設定で変えられる） |
| 7〜10 | 6 章の推奨どおり |

- **実装で変えたこと（6a〜6e、2026-09-30）**: 行商の表示名は「旅商人」（契約者の「行商」と衝突）。闇市の呪い付き遺物は「反転の遺物」（遺物に呪いが無いため性質の反転で）。賭けの「早業」→「速攻」、「見切り」→「凌ぎ」（奥義・見切りと衝突）。祝福「拾い勢」→「拾銭」（名前の原則）。瓶のパッドの十字上は移動と兼ねる（十字キーは移動に使われていた）。深みのボスは章ボスでない 5 体から回す。敵は商人を狙わないので、旅商人は気付いた敵のそばで傷を負う近似。6f（出口の予告）は未着手

---

## 0. 結論

- 欠片は **ラン内限定**の資源で永続の欠片は存在しない（永続通貨は残響のみ。`src/core/state.ts:945`、`src/loot/types.ts:297-307` に欠片の欄なし）。したがって「永続の欠片をどうするか」の問題は無く、セーブ互換で気にするのは新設の寄進（`roguelike.hub.v1` に任意項目を足すだけ、v2 不要）だけ
- 内部 key は `shards` 据え置きではなく **`state.economy.coins` へ改名**を推奨。理由: 統一ルール文法に既に `RuleEffectKind "shards"`（氷の破片。`src/core/rules.ts:136`、`src/system/rules.ts:276`）があり、通貨の Rule 起点・効果・`PerCounter` を足すと同じ語が 2 つの意味を持つ。改名の範囲は本体 20 箇所 + テスト 51 箇所（4 ファイル）で 1 レーンに収まる
- 商人・壺・木箱は **Enemy として実装**する（擬態の宝箱 `Mimic` と同じ作法）。HP・被弾・怯み・AI・撃破時のドロップが全部ただで手に入り、「商人を襲う」が自然に成立する。`roomIndex = ROAMING_ROOM` にして部屋の制圧判定（`roomAlive`）に数えない
- 6 段に分け、各段で遊べる。`REPLAY_VERSION` は 22 → 各段で 1 つ（23〜27）。絵は 6e（pixel-artist）に分離
- `run-arc.md` は **章の表・章ボスの固定・章の境の休符（泉 + 章の市 + 階の主なし）**だけ入れる。袋・持ち帰り・踏破・最深の間・出口の予告は入れない（袋が前提、または段取り 8 の領分）

---

## 1. 今のコードの地図（行番号つき）

### 1-1. 欠片の出入り

| 何 | 場所 | 中身 |
| --- | --- | --- |
| 型 | `src/core/state.ts:945` `GameState.shards: number` | 初期化 `src/core/game.ts:123`、拠点 `src/system/hub.ts:164` |
| 得る / 払う | `src/system/contractors.ts:180-191` `gainShards` / `spendShards` | 浮き文字「欠片 +n」（`CONTRACT.shardColor`） |
| 部屋の制圧 | `src/system/floor.ts:814` → `contractors.ts:750-764` `onContractsRoomCleared` | `shardsPerClear` 1 + 波・巣・鏡などの部屋で `shardsBonusRoom` +2 |
| 階の到着 | `src/system/floor.ts:922-925`（`fresh` の階だけ） | `shardsPerFloor` 1 |
| 賞金首 / 決闘 | `src/system/runEvents.ts:782` / `:941` | 3 / 2 |
| 契約の成否 | `contractors.ts:698`（沈黙の破れで −3）/ `:710`・`:720`（無傷 +3、沈黙 +5） | |
| 使う | `contractors.ts:433-452` `useOffer`（足りなければ「欠片が足りない」）、`offerPlan` `:276-323`（代価 1〜4） | 封印庫の封印 `specialRooms.ts`（`ROOM_KIND.vaultCost` 5） |
| 数値 | `src/data/balance/world/CONTRACT.json:21-26`（`shardsPerClear` 1 / `shardsBonusRoom` 2 / `shardsPerFloor` 1 / `shardsBounty` 3 / `shardsDuel` 2 / `shardColor`） | 台座の代価も同ファイル（`peddlerItemCost` 4 …） |
| HUD | `src/render/runUi.ts:490-498` `runSetupParts`（`欠片 n`、0 なら出さない）、台座の名札 `:206`・`offerLabel` `contractors.ts:352-355`「（欠片 n）」 | |
| Tips | `src/meta/tips.ts:195` key `shards` | |
| 用語 | `docs/GLOSSARY.md:174`（欠片）、`:470`（銭 / 鍵 / 瓶 = 未実装と明記） | |

### 1-2. 特別な部屋（台座）・契約者

- 台座の部屋: `src/system/specialRooms.ts:46-66` `PropKind`（`lever` 賭け台 / `chest` 宝箱 / `seal` 封印 …）、`RoomProp`（`used` / `armed`）`:69-81`、台座だけの部屋の集合 `PROP_ROOMS` `:182-195`、割り当て `assignExtraRoomKinds` `:219-238`（`ROOM_KIND.extra`、`extraMax` 3、起点「賭博師」は賭博を必ず）
- 賭博の部屋: `pullLever` `:650-664`（最大生命 10% × 3 回、`ROOM_KIND.gambleWeights`）、当たり外れ `applyGamble` `:674-697`
- 契約者: `src/system/contractors.ts:238-258`（開始部屋に深度 2 から 40%、ボス直後は必ず。`layout` `:220-232` が中心 ± オフセットに立ち位置と台座を置く）。触れて選ぶ `updateContractors` `:388-409`（`CONTRACT_TOUCH_RADIUS` 9、`armed` で連打防止）。賭場の主 `betShards` `:617-623`（3 → 50% で 6、期待値 0）
- `buildFloor` の乱数消費の順: `src/system/floor.ts:103-180`（部屋種類 → ボス / 階の主 → 特別な部屋 → 陣 `planJins` `:166` → 地形 → 分岐路 `:172` → 契約者 `:176` → 上り階段 → 隠し部屋 `:179`）。**新しい配置はこの末尾に足せば既存の抽選を動かさない**
- 前室の求め方: 部屋の隣接グラフは無い（`src/map/generator.ts` は通路を掘るだけ）。最後の部屋 = `state.rooms.length - 1`（`floor.ts:147`、階段 / ボス / 階の主の部屋）。前室は `map/pathing.ts` の `distanceField` を最後の部屋の中心から流し、開始・最後を除く部屋のうち最小距離の部屋（乱数不要）

### 1-3. 回復（泉・ハート・降階）

| 回復 | 場所 | 今 |
| --- | --- | --- |
| 泉 | `src/system/roomTypes.ts:291-323`（`setupShrine` / `useFountain`: 全回復 + 呪い）。出る階 `ROOM_KIND/shrineDepths.json` = `[3, 6]`、`roomTypes.ts:129-131`（`dryFountain` で無し） | 深度 3・6 だけ |
| ハート | `floor.ts:859-862` `dropHeart`（制圧 `:823` で `ROOM.heartDropChance` 0.1、試練は確定 `:820`）、拾う `updatePickups` `:868-881`（触れて `ROOM.heartHeal` 18）。長蛇・物見の陣は `jin.ts:372-379` `settleJin` で `JIN.roamHeartChance` | `Pickup.kind` は `"heart"` のみ（`state.ts:664-672`） |
| 降階 | `floor.ts:917`・`:931-935` `healOnDescend`（`HEAL.descendHealRatio` 0.15。段取り 2 で 0.35 → 0.15 済） | |
| 描画 | `src/render/renderer.ts:1229-1236` `drawPickups`（`SPR.heart` を揺らして blit） | |

### 1-4. ボス階の周期と章に当たるもの

- `src/system/boss.ts:72-79` `isBossDepth`（`BOSS.interval` 5 の倍数）、`bossKeyForDepth`（`BOSS_ROTATION` 9 体 `:36-47` を順に）。`src/data/balance/enemies/BOSS/_index.json` `interval: 5`
- 章の概念は **未実装**（`chapterOf` / `ARC` は src に無い）。契約者の「ボス直後は必ず」（`contractors.ts:243`）が章の境の唯一の手当て
- 陣の決着: `src/system/jin.ts:347-379` `updateJins` → `settleJin(by: "wipe" | "rout")`、起床 `wakeJin` `:293`、群勢 `noteJinDeath` `:68`。塊の陣は敗走・全滅で部屋の生存者 0 → `floor.ts:799-824` `clearRoom`（`dropRoomReward`・ハート・契約・祝福・来歴）。`docs/ideas/jin-impl.md:248`「銭・鍵は段取り 6 で `clearRoom` に足す」、`:363`「大将のいる陣は鍵、のように差を付ける」
- 撃破の入口: `src/system/combat.ts:319-347` `killEnemy`（`counted = enemy.revived !== true`、`rollEnemyDrop` `:339` の直後が銭を落とす位置）。被弾の入口 `damagePlayer` `:492-556`（`taken` 確定 `:526` → 死亡判定 `:546`）
- 格: `src/data/enemyRoles.ts:95-108` `EnemyGrade` 並 / 猛 / 精鋭、`gradeOf(e)`。大将は `Jin.leaderId`（`state.ts:741`）

### 1-5. 入力・リプレイ・拾得・揺らぎ

- `src/core/input.ts:70-93` 既定キー（W A S D / Space・Shift / E・左 / Q・右 / F / R・中 / Enter / P / Tab・I / 1〜4・C V X Z / G / T）。`ACTION_NAMES` `:5-26`、`REBINDABLE_ACTIONS` `:38-56`、`FrameInput` `:366-413`。`src/core/replay.ts:205-233` `BUTTON_BITS`（末尾追加のみ可）。パッド `src/core/padBinds.ts:121-134`（D パッド 12〜15 が未使用）。`main.ts` のホットキー（n / h / d / o / s / p / m / Esc）はゲーム外の画面だけ
- 拾得: 遺物・石は注目 + G（`src/system/loot.ts:217-239`）、ハートは触れて（`floor.ts:868`）。`PICKUP.json`（`focusRadius` 14 / `reach` 48）
- 揺らぎの器: `src/core/scale.ts` `curveAt` / `triangular` / `rollSpread(rng, mean, spread)`（rng 1 回）
- 常時の増・倍: `src/core/rules.ts:346-396` `PerCounter`（combo / targetStatusKinds / … / runKills / morale）・`Modifier`。数える側 `src/system/modifiers.ts:119-141` `countPer`、集める側 `collectModifiers` `:34`（装備 → 誓約 → ジョブ → 武器種 → 持続の奥義 → 祝福 → スキルスロット）
- QA: `src/qa/simulation.test.ts:579-652` `RunMetrics`（経済の指標は無い）、`src/qa/bot.ts:910-959` `botInput`（低 HP でハートを拾いに行く `:941-944`。契約者・台座には触れない）
- 永続化キー: `src/save/fileEnvelope.ts:9-20` `SAVE_FILES`、拠点 `src/meta/hubStore.ts:11-14` `HubSave { version: 1; seenFacilities }`。ラン終了の保存は `src/main.ts:440-450` `endRun`

---

## 2. 設計

### 2-1. 型と state

`src/core/state.ts`（最小 Edit）:

```ts
/** 銭の源（QA と「稼ぐ」型の集計。表示には出さない） */
export type CoinSource = "kill" | "jin" | "floor" | "container" | "bet" | "sell" | "rule" | "spill";
export type SpendKind = "flask" | "item" | "rune" | "key" | "reroll" | "contract" | "bet" | "donation" | "toll";

export interface EconomyState {
  coins: number;
  keys: number;
  /** このランで稼いだ総額（源別。こぼれた銭の拾い直しは数えない）。「稼ぐ」型と QA が読む */
  earned: Record<CoinSource, number>;
  /** このランで使った総額（用途別） */
  spent: Record<SpendKind, number>;
  /** 被弾でこぼれた総額 / 拾い直した総額 */
  spilled: number;
  recovered: number;
  /** 品ごとに買った回数（同じ品は買うたび値上がり） */
  bought: Partial<Record<WareKind, number>>;
  /** 商人を襲った（以後このランの値段 ×ECONOMY.market.outlawPriceMul） */
  outlaw: boolean;
  /** 張っている賭け（1 つだけ） */
  bet: ActiveBet | null;
  /** この階の商人（市・行商・闇市・章の市）。実体は Enemy。buildFloor で作り直す */
  merchants: Merchant[];
  /** このランで寄進した銭。main.ts が endRun で HubSave へ足す（step の中では保存しない） */
  donated: number;
}
```

- `GameState.shards` を消し `economy: EconomyState` に置き換える（`createGame` / `hub.ts:164` で `createEconomyState()`）
- `Player.flasks: number`（`state.ts:87-187` の Player に 1 行）。上限は `PlayerStats.flaskMax`（`loot/types.ts` に 1 欄。`computeStats` の既定は `ECONOMY.flask.max`）
- `PickupKind = "heart" | "coin" | "key" | "flask"`。`Pickup` に `value?: number`（銭の額）、`life?: number`（残り秒。undefined = 消えない）、`spilled?: true`（こぼれた銭。拾い直しは稼ぎに数えない）、`vel?: Vec`（散る初速。減衰）、`settle?: number`（この秒が過ぎるまで引き寄せない。こぼれた銭が即戻らないため）
- `Merchant { enemyId: number; kind: MerchantKind; wares: Ware[]; greeted: boolean }`、`MerchantKind = "market" | "peddler" | "blackMarket" | "chapterMarket"`、`Ware { kind: WareKind; key: string; price: number; pos: Vec; used: boolean; armed: boolean }`、`WareKind = "flask" | "item" | "rune" | "key" | "reroll" | "skill" | "cursedItem" | "keystone"`。台座の作法は `ContractOffer`（`contractors.ts:66-76`）と同じ
- `ActiveBet { kind: BetKind; stake: number; mul: number; jinId: number | null; signedAt: number; count: number; target: number }`、`BetKind = "chohan" | "longshot" | "allIn" | "doubleUp" | "unscathed" | "swift" | "parries"`
- `EnemyDef`（`src/data/enemies.ts`）に `merchant?: MerchantKind` と `container?: "pot" | "crate"`。`EnemyBehavior` に `"merchant"` / `"container"`
- 新モジュール: `src/system/economy.ts`（`gainCoins` / `spendCoins` / `dropCoins` / `spillCoins` / `updateCoinPickups` / `chapterScale` / 陣・階・撃破の報酬）、`src/system/flask.ts`、`src/system/merchants.ts`、`src/system/bets.ts`、`src/system/containers.ts`、`src/system/chapters.ts`、`src/system/donation.ts`

### 2-2. 銭の出入り

**源と量**（章 1 の平均。`ECONOMY.income`。深度 d の平均 = 基本 × `chapterMul`^(章−1)、実際の額 = `rollSpread(rng, 平均, ECONOMY.income.spread)` を確率的に整数化）

| 源 | 基本 | 置く場所 | 備考 |
| --- | --- | --- | --- |
| 撃破 並 / 猛 / 精鋭 / 大将 | 0.8 / 2 / 5 / 8 | `combat.ts:339` の直後 `dropCoins(state, enemy)` | `gradeOf`（`enemyRoles.ts:104`）。群れ（`def.swarm`）は ×0.34。敗走中 ×1.5（`routMul`）。`counted` でない・`sandbox`・`container`・買収済みは落とさない。ボス・階の主は `boss` / `lairMaster` で 15 / 10 |
| 陣の決着 | 4 | `jin.ts:372` `settleJin` の末尾 → `onJinSettled(state, jin)` | 交戦した陣だけ。塊の陣は `clearRoom` 側の `onContractsRoomCleared`（`floor.ts:814`）から銭を外し、陣を持たない部屋（闘技場・巣窟・試練・護衛…）だけ `clearRoom` で 4 + 部屋の種類の上乗せ（今の `BONUS_SHARD_ROOMS` を `ECONOMY.income.roomBonus` へ） |
| 無傷の決着 | 陣の報酬 ×2 | `onJinSettled`（`wakeJin` から `settleJin` までに `state.recent.onHurt` が無い） | 腕の稼ぎ |
| 階の到着 | 3 | `floor.ts:924` を `grantFloorArrival` に差し替え | |
| 賞金首 / 決闘 | 10 / 8 | `runEvents.ts:782` / `:941` | |
| 壺 / 木箱 | 0〜3 | 6c | |
| 賭け | 賭け金 × 倍率 | 6c | |
| 契約（無傷 / 沈黙） | 8 / 12 | `contractors.ts:710` / `:720`（沈黙の破れは −8） | |

目安: 全部倒すと 1 階 90〜120（80 体 ≒ 並 60 × 0.8 + 猛 10 × 2 + 精鋭 3 × 5 + 陣 8 × 4 + 主 10 + 到着 3 ≒ 128 → QA で並を 0.6〜0.8 に詰める）

**落ちる・消える・引き寄せ**

- `dropCoins` は **1 体につき銭の実体 1 つ**（額を持つ）。ボス・大将だけ額を 3〜5 個に割って散らす（見た目）。`Pickup { kind: "coin", value, life: ECONOMY.coin.life 8, vel: 散る初速（rng 1 回で向き） }`
- `updateCoinPickups`（`floor.ts:868` の `updatePickups` を `economy.ts` へ移し、ハートも一緒に扱う）: `life -= dt`、0 で消す。残り `blinkSec` 2 秒は描画が点滅（`life` を読むだけ）。`settle` 経過後、プレイヤーから `magnetRadius`（15px = 1.5m）以内なら `magnetSpeed` で寄る。触れたら `gainCoins(state, value, spilled ? "spill" : "kill")`。実体数が `maxCoins`（120）を超えたら新しい銭は **最も新しい銭に額を足す**（乱数不要・決定的）
- `gainCoins(state, amount, source)`: `economy.coins += amount`、`spill` 以外は `earned[source] += amount`、浮き文字「銭 +n」、`pushEvent({ kind: "onCoinPickup", amount, source })`
- 引き寄せ半径は `stats.coinMagnetMul`（性質・遺物。既定 1）で伸ばす

**被弾でこぼれる**

- `combat.ts:526` の直後（`taken` 確定後、死亡判定の前）に `spillCoins(state, fromPos)`。`damagePlayerDot`（継続ダメージ）・受け流し・見切りではこぼれない
- 量 = `max(1, round(coins × ECONOMY.spill.ratio 0.05 × stats.coinSpillMul))`（`coins` が 0 なら何もしない）。1〜3 個に割り、`fromPos` の反対側へ `spill.scatter` 40〜70px、`life: spill.life 3`、`spilled: true`、`settle: 0.5`。`economy.spilled += 量`、拾い直しで `recovered += 量`。`pushEvent({ kind: "onCoinSpill", amount })`
- 「守る型」の口: `stats.coinSpillMul`（0 で こぼれない = 遺物の到達点）

**死ぬと消える**: 何もしない（state ごと消える）。寄進した分だけ `donated` が HubSave へ

### 2-3. 瓶

- `Player.flasks`（開始 `ECONOMY.flask.start` 1、上限 `stats.flaskMax` 既定 `flask.max` 2。ビルドで +1 → 3）
- 飲む: `FrameInput.flaskPressed`。`system/flask.ts` `tryDrink(state, input)`（`step` の player の前。`skills.ts:787` と同じく `dashTimer > 0 || attackCommitted(state)` なら不可、`flask.cooldown` 0.6 秒）。効果 `healPlayer(state, maxHp × flask.healRatio 0.35, { direct: true })`（`healDirect` 相当で戦闘中の回復の上限 `HEAL.sustainCapRatio` を通さない）。浮き文字「瓶」、`pushSfx("heal")`。`pushEvent({ kind: "onFlask" })`（瓶の調合の口）
- 汲む: 章の境の泉（2-8）で全回復 + 瓶を上限まで。買う: 市 40 銭
- **キーの推奨: 主 `KeyB`、副 `Digit5`**。調査: 左手の未使用キーは B / N / 5 / 6 / `` ` `` / Ctrl / Alt。T は `toggleDropInfo`、R は受け流し、G は拾う、P はリスタート、H / N / D / O / S / M は `main.ts` のメニューのホットキー（ゲーム外画面のみだが混同を避ける）。B は X Z C V（スキル）と同じ列で人差し指が届き、5 は 1〜4（スキル）の並びの続きで「5 番目の消耗品」と読める。パッドは **D パッド上**（`PAD_DPAD_UP`。`padBinds.ts:121-134` で D パッドは 4 方向とも未使用）。却下: `KeyH`（右手がマウス）、`KeyR` の置き換え（受け流しは段取り 2 で決めたばかり）
- 触る所: `core/input.ts`（`ACTION_NAMES` / `REBINDABLE_ACTIONS` / `DEFAULT_KEYBINDS` / `FrameInput.flaskPressed` / `EMPTY_INPUT` / `snapshot`）、`core/gamepad.ts`（`GamepadFrame.flaskPressed`）、`core/padBinds.ts`（`PAD_ACTIONS` / `DEFAULT_PAD_BINDS`）、`core/replay.ts:233` の末尾に `"flaskPressed"`、`ui/settings.ts` のキー設定の行は `REBINDABLE_ACTIONS` から自動。Tips は `keyLabel("flask")`
- HUD: `render/flaskHud.ts`（新）。気力バーの隣に瓶の数だけ小さな瓶の枡（空は輪郭だけ）。配置は `layers.ts` `hudLayoutFor` に 1 欄。絵が来るまでは矩形
- QA bot: `bot.ts:941` の低 HP 分岐の前に「`flasks > 0 && hp/maxHp <= FLASK_HP_RATIO 0.4` なら `flaskPressed: true`」

### 2-4. 鍵

- `economy.keys`。源: 陣の決着（大将のいる陣 `ECONOMY.key.leaderJinChance` 0.5、それ以外 `jinChance` 0.12。`onJinSettled` で rng 1 回）、章ボスの撃破で確定 `chapterBossKeys` 2、市で 1 本 30 銭（1 市に 1 本）。落とし方は `Pickup { kind: "key" }`（消えない・引き寄せあり）
- 使い道（6c）: 宝箱 `PropKind "lockedChest"`（鍵 1 → 遺物 1 + 銭 15〜25。宝物庫の部屋に 1 つ足す。今の `treasure` は遺物 2〜3 をただで置くので、1 つを鍵付きに置き換え）、封印庫 `seal` を「鍵 2 か 銭 `vaultCoinCost`」に（`ROOM_KIND.vaultCost` 5 → 銭 80）、闇市の入口（6d）。鍵の扉（タイル）は今回作らない（隠し部屋がその役）
- HUD: 右上の行に「鍵 n」

### 2-5. 商人

**実体**: Enemy。`data/enemies.ts` に `merchant` 1 種（`behavior: "merchant"`、`stationary: true`、hp = 並の 6 倍の曲線、`merchant: <kind>` は生成時に `e.ai.merchantKind` で持つ）。`system/behaviors/families.ts` に `Merchant extends Stationary`: 気付かない（`notice` を常に false）、`onStruck` で `provoke`（以後 `Keeper` の遠距離攻撃 = 品物を投げる、`e.ai.provoked`）。`roomIndex = ROAMING_ROOM` なので `roomAlive` / `clearRoom` / 陣に数えない。`jinMetrics` と図鑑（`meta/codex.ts`）は `def.merchant` / `def.container` を除外（要 1 行ずつ）
**場所**: 市 = **毎階 1 つ、前室**（1-2 の距離場で決める）。`buildFloor` の末尾（`floor.ts:179` の後）で `placeMerchants(state)`（既存の抽選を動かさない）。立ち位置と台座は `contractors.ts:220-232` `layout` を `export` して共用。前室が取れなければ開始部屋の反対側（`layout(..., dir: 1)`）
**在庫**（`ECONOMY.market.stock`。生成時に rng で値段を引き、`Ware.price` に固定 = 名札が揺れない）

| 品 | 基本の値段 | 市 | 章の市 | 行商 | 闇市 |
| --- | --- | --- | --- | --- | --- |
| 瓶 | 40 | 1 | 2 | 1（×0.8） | — |
| 遺物（`dropItem` boost 2） | 70 | 1 | 1 | 1 | 呪い付き遺物 90（`forceCursed` 相当。無ければ性質の反転 `flux` で代用） |
| 刻印符 | 50 | 1 | — | 1 | — |
| 鍵 | 30 | 1 | 1 | — | — |
| 引き直し（在庫を引き直す） | 15（使うたび +10） | 1 | 1 | — | — |
| スキル石（未所持だけ） | 80 | — | — | — | 1 |
| 誓約 1 つ | 60 | — | — | — | 1 |

- 値段 = `round(rollSpread(rng, 基本 × chapterMul^(章−1), ECONOMY.price.spread {0.85, 1.2}))` × `(1 + 0.2 × bought[kind])` × `outlaw ? outlawPriceMul 2 : 1`
- 買う = 台座に触れる（`updateMerchants` は `updateContractors` `contractors.ts:388-409` と同じ形）。払えなければ「銭が足りない（n）」。`spendCoins(state, price, kind)` → `pushEvent({ kind: "onCoinSpend", amount })`
- 売る（袋の遺物）は **袋が無いので入れない**（`run-arc.md` 2 章の後）
- **襲う**: `damageEnemy` が商人に届くと `provoke`。撃破で在庫を全部床へ（瓶 → `Pickup flask`、遺物 → `floorItems`、鍵 → `Pickup key`）、`economy.outlaw = true`。以後このランの商人は値段 ×2（推奨。「出てこない」は銭の出口を失って経済が止まるので却下）。浮き文字「無法者」
- 行商（6d）: `merchant` の亜種 `peddler`。`e.ai.roam` を `spawner.ts` の徘徊の目的地選びで回す（歩く）。敵の攻撃が当たって死ぬと品が床へ（「見捨てると品が床に落ちる」がただで成立）。助ける = 行商から 60px 以内で敵を倒すと `economy.peddlerSaved = true` → 以後 10% 引き
- 闇市（6d）: 隠し部屋（`hiddenRoom.ts`。開いた瞬間ポケットに `blackMarket` を立てる）。5 の倍数の階には隠し部屋が無いので闇市も無い
- 章の市（6b）: 章ボス階（5 / 10 / 15 / 20）の前室に `chapterMarket`（瓶 2・鍵 1）。通常の市は出さない
- 契約者 9 人は **人も台座もそのまま**、代価だけ銭へ（2-11）。配り直しは段取り 9

### 2-6. 賭け

賭場の主（`bookie`）の台座を作り直す（`contractors.ts:298-302`）。`system/bets.ts`。品書きは 4 台: 運 2 + 腕 2（rng で選ぶ）。賭け金は持ち金の割合で台座に「丁半（20 銭 → 40）」のように額を出す。張ったら取り消せない

| 型 | 中身 | 賭け金 | 倍率 / 確率 | 期待値 |
| --- | --- | --- | --- | --- |
| 丁半 chohan | 触れた瞬間に判定 | 持ち金の 20%（最低 10） | ×2 / 0.5 | 1.0 |
| 大穴 longshot | 同上 | 10%（最低 5） | ×10 / 1/11 | 0.91 |
| 一か八か allIn | 同上 | **全額** | ×3 / 0.32 | 0.96 |
| 倍々勝負 doubleUp | 台座が「続ける（×2 か 0）/ 降りる」の 2 つに変わる | 20% | 各回 0.5、続けるたび倍 | 1.0（降りた時点で確定） |
| 無傷 unscathed | 次の陣を被弾せずに決着 | 30% | 易 ×1.5（並の陣） / 難 ×2（大将のいる陣） | 腕 |
| 早業 swift | 次の陣を起床から N 秒で決着 | 30% | 易 25 秒 ×1.5 / 難 15 秒 ×2 / 至難 10 秒 ×3 | 腕 |
| 見切り parries | この階で受け流し・見切りを N 回 | 30% | 易 5 ×1.5 / 難 10 ×2 / 至難 20 ×3。**見切りの語（`system/keywords.ts`）を持つビルドは N ×1.5** | 腕 |

- 腕の賭けの判定: `wakeJin`（`jin.ts:293`）に `onJinEngaged(state, jin)`、`settleJin` に `onJinSettled` を 1 行ずつ。`bet.jinId === null` なら起きた陣を束縛、その陣の決着で判定（無傷 = `state.recent.onHurt.lastTime <= bet.signedAt` かつ 束縛後も無し / 早業 = `floorTime − engagedAt <= target`）。見切りは `recent.onParry`（無ければ `parry.ts` に `pushEvent` を 1 行）を `count` で数え、階を降りるときに判定（`onContractsFloorReached` と同じ場所）
- 賭博の部屋（`pullLever` `specialRooms.ts:650`）は代価を 最大生命 10% → **銭 `ROOM_KIND.gambleCoinCost` 15** に変え、当たりに「銭 ×3」を足す。生命賭け（`betLife`）は残す
- 大穴の陣（`core-synthesis` 7 章）: 章に 1 回、賭場の主が「次の陣を無傷で ×10」を出す（`unscathed` の変種 `bet.mul = 10`、`ECONOMY.bet.jackpotPerChapter` 1）

### 2-7. 容れ物

- 壺 `pot` / 木箱 `crate` = Enemy（`behavior: "container"`、hp 1、`stationary`、`container: "pot"`。`Container extends Stationary`、気付かない・攻撃しない）。`killEnemy` で `def.container` なら **撃破数・得点・コンボ・来歴・怯み・ドロップ抽選を通さず** `dropCoins` の容れ物版（0〜3、`containerFlaskChance` 0.05 で瓶）だけ。`combat.ts:319-347` に `if (def.container) return containerBroken(state, enemy)` を頭に 1 行。敵の攻撃が当たっても壊れる（敵の攻撃が敵に当たる規則が既にあるならそのまま。無ければ `hazards` の爆発だけ）
- 置き方: `buildFloor` 末尾 `placeContainers(state)`。塊の隅（部屋の床タイルで壁に 2 面以上接する点）と通路の行き止まりに `ECONOMY.container.perFloor` 6〜10（面積倍率で伸ばす）
- 宝箱・呪われた宝箱・ミミック・金の扉・通行料は今回入れない（宝箱は 2-4 の鍵付き宝箱だけ。ミミックは既存の `Mimic`）

### 2-8. 章と出口（`run-arc.md` をどこまで入れるか）

**入れる**（6b）: `src/system/chapters.ts`

```ts
export function chapterOf(depth: number): number  // 1〜4。21 以上は 4 のまま（深み）
export function isChapterBossDepth(depth): boolean // 5 / 10 / 15 / 20
export function isChapterRest(depth): boolean      // 章の 1 階目（1 は除く）: 6 / 11 / 16
export function chapterBossKey(depth): string | null
```

- `ARC.json`（`world/`）: `chapters: [{ boss: "kingSlime" }, { boss: "thiefKing" }, { boss: "oilKing" }, { boss: "mirrorKnight" }]`（core-synthesis 1 章の E29 が優先: 章 2 盗賊王・章 3 油壺の王。run-arc の骸骨卿・霜の巨人は深みのローテーションに残る）、`floorsPerChapter: 5`、`lordSkipFirstFloor: true`、`restFountain: true`
- `boss.ts:76-79` `bossKeyForDepth`: `chapterBossKey(depth) ?? 従来のローテーション`。`floorLord.ts`: `isChapterRest(depth)` なら階の主を出さない（`floor.ts:156` の分岐に 1 条件）
- **章の境の休符** = 章の 1 階目: 泉の部屋を必ず 1 つ（`roomTypes.ts:129-131` の `shrineDepths` 判定を `isChapterRest` に置き換え。`shrineDepths.json` は消す）。泉は全回復 + **瓶を上限まで満たす**、休符では呪いを付けない（`useFountain` に `isChapterRest` で分岐）。契約者は既に「ボス直後は必ず」（`contractors.ts:243`）。寄進の祠（2-9）もここ
- 章の市（2-5）は章ボス階の前室
- ハート: `ROOM.heartDropChance` 0.1 を章で減らす `HEAL.heartChanceByChapter: [0.1, 0.08, 0.06, 0.04]`
- 降階の回復 15% は据え置き。瓶・泉・降階の関係: 通常階は「降階 15% + 瓶」、章の境で「泉で全回復 + 瓶が満ちる」。銭を瓶に使うか火力（通貨のビルド）に使うかが章ごとの判断になる

**入れない**（理由）: 章ごとのバイオーム候補（味付け。段取り 8 のボスと一緒に）、最深の間・踏破・帰還の扉・持ち帰り（袋が前提）、位階 8 種（段取り 9）、**出口の予告**（「祝福の出口を選んだ階だけ 3 択」は祝福の総数を変えるので段取り 7 の祝福の作り直しと一緒に。ユーザー確認）

### 2-9. 寄進

- 章の境の休符（章の 1 階目）の開始部屋に `PropKind "donation"`（祠）。触れるたび `max(10, round(coins × ECONOMY.donation.step 0.25))` を寄進（`spendCoins(…, "donation")`、`economy.donated += n`）。全額まで繰り返せる。ラン内の効果は無し（「入れて使い道は後で」）。浮き文字「寄進 n」
- 永続: `HubSave` に `donated?: number`（任意項目。`parseHubSave` で数値以外は 0。**v2 は切らない**）。`main.ts` `endRun`（`:440-450`）で `saveHub({ ...hubSave, donated: (hubSave.donated ?? 0) + state.economy.donated })`。step の中では触らない（不変条件 8）
- 表示: 拠点の井戸の台の説明に「寄進 n」を 1 行（`render/hubUi.ts`）。使い道は将来（拠点の解放・図鑑）。**ユーザー確認**（下の 6 章）

### 2-10. 通貨のビルドの口と見本

**口**（6a で開ける。`core/rules.ts` / `core/events.ts` / `system/modifiers.ts` に最小 Edit）

- `PerCounter` に `{ kind: "coins" }`（持ち金）/ `{ kind: "coinsEarned" }`（稼いだ総額）/ `{ kind: "coinsSpent" }`（使った総額）。`countPer` に 3 行
- `RuleCondition` に `{ kind: "coinsAtLeast"; amount: number }`
- `EventKind` に `"onCoinPickup"` / `"onCoinSpend"` / `"onCoinSpill"` / `"onFlask"`（`GameEvent.amount` に額）
- `RuleEffectKind` に `"gainCoins"`（magnitude）/ `"spendCoins"`（magnitude。足りなければ効果なし。`Rule.then` の連なりで「払えたら倍」を書く）/ `"scatterCoins"`（持ち金の magnitude 割合を床へ撒く = 投げる型の下地）
- `PlayerStats` に `flaskMax` / `coinMagnetMul` / `coinSpillMul` / `coinGainMul`（性質の値の受け口）

**見本**（6d で 3 枚。系譜「財」の本体は段取り 7）

| 見本 | 層 | 型 | 書き方 |
| --- | --- | --- | --- |
| 懐（ふところ） | 性質（条件の族） | 持つ | `Modifier { kind: "increased", tag: "all", amount: 0.12, if: [{ kind: "coinsAtLeast", amount: 50 }] }` |
| 守銭 | 祝福（第 3 弾に 1 枚） | 持つ | `Modifier { kind: "increased", tag: "all", amount: 0.01, per: { count: { kind: "coins" }, every: 20, cap: 0.25 } }` |
| 拾い勢 | 祝福 | 稼ぐ（拾った瞬間） | `Rule { when: "onCoinPickup", then: { kind: "selfStatus", status: "haste" 相当の一時強化, duration: 2, count: 1 } }`（既存の一時強化を使い、重なりは `count` で） |

「使う」型は `Rule { when: "onHit", then: [{ kind: "spendCoins", magnitude: 5 }, …] }` + `coinsAtLeast` の Modifier で書ける（見本には入れない。段取り 7）

### 2-11. 欠片からの移行・セーブの互換

- 永続の欠片は無い。移行は **ラン内の値の再スケール**だけ: `CONTRACT.json` の代価を銭の物差しへ（契約 0 / 遺物 4 → 70 / 残響 3 → 30 / 刻印符 2 → 50 / 手当て 2 → 40 / 浄化 1 → 15 / 解呪 4 → 50 / 占い 1 → 10 / 厄払い 3 → 30 / 地図 2 → 20 / 来歴 2 → 20 / 焼き付け 3 → 40 / 階段 1 → 15 / 渡し守 3 → 30）。`shards*` の 5 項目は `ECONOMY.income` へ移し `CONTRACT` から消す。`shardColor` → `ECONOMY.coin.color`
- 表示「欠片」→「銭」: `contractors.ts:183, 355, 436`、`runUi.ts:494`、`tips.ts:195`（key を `coins` に）、`GLOSSARY.md:174`（欠片の行を「旧語」欄へ）、`docs/recipes/contractor.md`。`scripts/audit-agent-docs.mjs` の旧用語表に「欠片 → 銭」を足す（`docs/ideas/` は対象外なので昔の設計書はそのまま）
- リプレイ: `ReplayLoadout` / `ReplayData` の形は変えない。入力ビット末尾追加と乱数消費の変化で `REPLAY_VERSION` を上げる（4 章）
- 拠点の `hub.ts:164` は `economy: createEconomyState()`

### 2-12. HUD

- 右上の行 `runSetupParts`（`runUi.ts:490`）: 「銭 n · 鍵 n」を **常に**出す（0 でも。資源なので数字で見せてよい = economy-core 10 章）。位階・反転層・帰還は据え置き
- 瓶: `render/flaskHud.ts`。銭の実体: `render/coinUi.ts`（`drawPickups` を kind で分岐。残り 2 秒は `pulse` で点滅。絵が来るまでは金色の小さな菱形）
- 商人の名札・品札: `runUi.ts:182-208` `drawContractor` を `drawMerchant` として共用（`nearestOffer` の一般化）。「瓶（40 銭）」、払えなければ `COLOR_DIM`
- 賭けの HUD: `pactHudLines`（`contractors.ts:364`）に「賭け: 無傷 ×2（30 銭）」を 1 行足す

---

## 3. 型の変更・JSON・テスト・REPLAY_VERSION・壊れそうなテスト

### 3-1. 新しい balance JSON

`src/data/balance/world/ECONOMY/`（ディレクトリ。`_index.json` に `_note` / `_fields` / `_order`。`world/_index.json` の `_order` に `"ECONOMY"`, `"ARC"` を足し、`data/tuning.ts` に `export const ECONOMY = BALANCE.world.ECONOMY` / `ARC`、`pnpm run balance:gen`）

| ファイル | 項目（`_fields` に 1 行ずつ） |
| --- | --- |
| `_index.json` | `chapterMul` 1.3（章ごとの平均の倍率。値段と稼ぎの両方）、`coin.color`、`coin.life` 8 秒、`coin.blinkSec` 2、`coin.magnetRadius` 15px、`coin.magnetSpeed` 240px/s、`coin.maxCoins` 120、`coin.scatterSpeed` 60 |
| `income.json` | `spread {low 0.7, high 1.4}`、`kill {normal 0.8, strong 2, elite 5, leader 8, lord 10, boss 15}`、`swarmMul` 0.34、`routMul` 1.5、`jin` 4、`jinUnscathedMul` 2、`roomBonus {challenge 4, arena 4, horde 6, …}`、`floor` 3、`bounty` 10、`duel` 8、`pactUnscathed` 8、`pactSilent` 12、`pactSilentPenalty` 8 |
| `spill.json` | `ratio` 0.05、`min` 1、`pieces` 3、`scatterMin` 40、`scatterMax` 70、`life` 3、`settle` 0.5 |
| `flask.json` | `start` 1、`max` 2、`healRatio` 0.35、`cooldown` 0.6、`color` |
| `key.json` | `jinChance` 0.12、`leaderJinChance` 0.5、`chapterBossKeys` 2、`color` |
| `price.json` | `spread {0.85, 1.2}`、`repeatMul` 0.2、`base {flask 40, item 70, rune 50, key 30, reroll 15, skill 80, cursedItem 90, keystone 60}`、`rerollStep` 10 |
| `market.json` | `stock` 種類ごとの配列（2-5 の表）、`outlawPriceMul` 2、`peddlerDiscount` 0.1、`peddlerChance` 0.5、`merchantHpMul` 6、`provokedDamageMul` |
| `bet.json` | 7 種の `stakeRatio` / `stakeMin` / `mul` / `chance` / `targets`（易・難・至難）、`parryKeywordMul` 1.5、`jackpotPerChapter` 1、`jackpotMul` 10 |
| `container.json` | `perArea` 8、`coinsMin` 0、`coinsMax` 3、`flaskChance` 0.05 |
| `donation.json` | `step` 0.25、`min` 10 |
| `world/ARC.json` | 2-8 |
| 既存の変更 | `CONTRACT.json` 代価の再スケール・`shards*` 5 項目の削除、`ROOM_KIND/_index.json` `vaultCost` → `vaultKeys` 2 / `vaultCoinCost` 80・`gambleHpCost` → `gambleCoinCost` 15・`gambleWeights` に `coins`、`shrineDepths.json` 削除、`HEAL.json` `heartChanceByChapter`、`PICKUP.json` は据え置き |

### 3-2. `REPLAY_VERSION`（`src/core/replay.ts:70`、今 22）

| 段 | 版 | 理由 |
| --- | --- | --- |
| 6a | 23 | 撃破・陣・階で銭の額を `rng` で引く（`killEnemy` の中で乱数消費が増える）、`flaskPressed` はまだ無し、契約者の代価が変わる |
| 6b | 24 | `BUTTON_BITS` 末尾 `flaskPressed`、商人・章の市の配置と値段の抽選、章ボスの固定（深度 10 / 15 のボスが変わる）、泉の階 |
| 6c | 25 | 賭け・容れ物・宝箱・寄進の祠の抽選 |
| 6d | 26 | 行商・闇市・見本の性質（性質の抽選表が変わる） |
| 6f | 27 | 出口の予告（入れるなら） |

### 3-3. 壊れそうなテスト（既存）

- `src/system/contractors.test.ts`（欠片 39 箇所: 代価・「欠片が足りない」・`state.shards`）→ `state.economy.coins` と新しい代価へ書き換え
- `src/render/runUi.test.ts`（`runSetupParts` の「欠片 n」5 箇所）、`src/system/runEvents.test.ts`（賞金首・決闘の欠片 3）、`src/system/specialRooms.test.ts`（封印庫の代価 4）
- `src/core/replay.test.ts`（版）、`src/system/boss.test.ts`（`bossKeyForDepth(10)` が骸骨卿 → 盗賊王、15 が霜の巨人 → 油壺の王）、`src/system/floorLord.test.ts`（深度 6 / 11 / 16 に主が出ない）、`src/system/roomTypes.test.ts`（泉の階）
- seed 依存: `killEnemy` に乱数消費が増えるので、撃破の後に抽選する処理を見るテスト（`jin.test.ts` の敗走・`specialRooms.test.ts` の賭博・`runEvents.test.ts`）がずれ得る。HANDOFF 3 節の作法どおり **seed を変えずに意図を守る形で堅牢化**
- `src/qa/simulation.test.ts`: `RunMetrics` に `economy` を足すだけで既存は壊れない。`jinMetrics` の総数に商人・壺が混ざるので `def.merchant` / `def.container` を除外
- `src/data/balance/balance.test.ts` の `UNDOCUMENTED_BASELINE`（`world`）: 新項目は全部 `_fields` に書けば増えない

### 3-4. 新しいテスト（`it` 名の例）

- economy: 「撃破で格に応じた銭が落ち、8 秒で消える」「消える前 2 秒は life が blinkSec 以下」「1.5m 以内の銭は引き寄せられて拾える」「実体が上限を超えると最新の銭に額が足される」「被弾で持ち金の 5%（最低 1）がこぼれ、3 秒以内に拾えば戻り、稼ぎには数えない」「継続ダメージ・受け流しではこぼれない」「持ち金 0 ならこぼれない」「陣の決着で銭、大将のいる陣は鍵が 50%」「無傷の決着は 2 倍」「陣を持たない部屋の制圧は clearRoom で銭」「同じ seed で銭の額が同じ（決定性）」
- flask: 「B で瓶を飲むと最大生命の 35% 回復し瓶が 1 減る」「振りのコミット中・ダッシュ中は飲めない」「0 本なら何もしない」「泉で上限まで満ちる」「上限は stats.flaskMax」「リプレイに flaskPressed が記録され再生で一致する」
- merchants: 「毎階の前室に市が立つ」「値段は章 1 の平均 × 揺らぎの範囲」「同じ品を買うと 20% ずつ上がる」「足りなければ買えず台座が残る」「商人を殴ると敵になり、倒すと在庫が床に落ち、以後の値段が 2 倍」「商人は部屋の制圧判定に数えない」「章ボス階の前室は章の市」
- chapters: 「深度 1〜5 は章 1、6〜10 は章 2」「章ボスは表どおり（5 スライム王 / 10 盗賊王 / 15 油壺の王 / 20 鏡の騎士）、25 以降はローテーション」「章の 1 階目に階の主が出ず、泉が必ず 1 つ」「休符の泉は呪いを付けない」
- bets: 「丁半は 50% で 2 倍、賭け金は持ち金の 20%」「大穴は 1/11 で 10 倍」「一か八かは全額」「無傷の賭けは次に起きた陣に束縛され、被弾なしで決着すれば倍率ぶん増える」「早業は起床から N 秒」「見切りの語を持つと必要回数が 1.5 倍」「倍々勝負は続けるたび倍、負けると 0」「賭けは 1 つしか張れない」
- containers / donation: 「壺は撃破数・得点・コンボに数えず銭だけ落とす」「寄進は 25%（最低 10）ずつで、economy.donated に積まれ step では保存されない」「HubSave.donated は数値以外なら 0」
- modifiers: 「PerCounter coins は持ち金 20 につき 1 段、上限 25%」「coinsAtLeast 50 の Modifier は 49 で効かない」「gainCoins / spendCoins の Rule 効果が economy を動かす」

---

## 4. 段階分けとレーン

各段の最後は `pnpm run check`。共有ファイル（`core/state.ts` / `core/game.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts` / `system/combat.ts` / `system/floor.ts` / `audio/sfxNames.ts`）は最小 Edit のみ・全文 Write 禁止。Agent はコミットしない

### 6a 銭の芯（遊べる: 銭が落ち、拾い、契約者に払える。被弾でこぼれる）

| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| A economy | `system/economy.ts`（新）+ test、`system/chapters.ts`（`chapterOf` だけ）+ test、`data/balance/world/ECONOMY/*`、`world/ARC.json`（空の表でよい） | `core/state.ts`（`EconomyState` / `Pickup` の欄 / `GameState.economy`）、`core/game.ts`（初期化）、`system/hub.ts:164`、`data/tuning.ts`（再 export）、`world/_index.json`、`combat.ts:339`（`dropCoins` 1 行）・`:526`（`spillCoins` 1 行）、`floor.ts:814, 868-881, 924`、`jin.ts:372`（`onJinSettled` 1 行）、`runEvents.ts:782, 941`、`core/rules.ts` / `core/events.ts` / `modifiers.ts`（口の追加） | render、contractors.ts |
| B render | `render/coinUi.ts`（新）+ test、`render/runUi.ts`（`runSetupParts` の銭・鍵、`drawPickups` の分岐は renderer から呼ぶ） | `render/renderer.ts:1229-1236`（`drawPickups` を coinUi へ委譲 1 行）、`render/layers.ts` | system |
| C contractors | `system/contractors.ts`（`gainShards` / `spendShards` 削除 → economy を呼ぶ、代価と表示「銭」）、`contractors.test.ts`、`CONTRACT.json`（代価・`shards*` 削除）、`specialRooms.ts`（封印庫の代価を銭に）、`meta/tips.ts:195`、`docs/GLOSSARY.md` は統合役 | — | economy.ts |
| D qa | `qa/economyMetrics.ts`（新: `EconomyTally` / `buildEconomySection`）、`qa/simulation.test.ts`（`RunMetrics.economy` と表）| — | bot.ts |
| 統合役 | `REPLAY_VERSION` 23、`CHANGELOG`、`CODE_MAP`、`GLOSSARY`、`audit-agent-docs.mjs` の旧用語 | | |

### 6b 瓶・市・章（遊べる: 毎階の市で瓶を買い、B で飲む。章ボスが固定され、章の境で泉と章の市）

| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| A flask + 入力 | `system/flask.ts` + test、`render/flaskHud.ts` + test、`ECONOMY/flask.json` | `core/input.ts`（`ACTION_NAMES` / `REBINDABLE_ACTIONS` / `DEFAULT_KEYBINDS` / `FrameInput` / `EMPTY_INPUT` / `snapshot`）、`core/gamepad.ts`、`core/padBinds.ts`、`core/replay.ts:233`、`core/state.ts`（`Player.flasks`）、`loot/types.ts`（`flaskMax`）、`loot/stats.ts`（既定）、`core/game.ts`（`step` で `tryDrink` を player の前に 1 行）、`render/layers.ts`（配置 1 欄）、`meta/tips.ts`（瓶の項目。`keyLabel("flask")`） | merchants |
| B merchants | `system/merchants.ts` + test、`data/enemies.ts`（`merchant` の定義。`docs/recipes/enemy.md` に従い `enemies/stats` / `combat` / `defense` の JSON 3 点）、`system/behaviors/families.ts`（`Merchant` クラス）、`ECONOMY/market.json` / `price.json`、`render/merchantUi.ts`（`drawContractor` の共用化） | `system/behaviors/registry.ts`（登録 1 行）、`data/enemies.ts` の `EnemyBehavior` union、`floor.ts:179` の後に `placeMerchants` 1 行、`contractors.ts:220`（`layout` を export）、`qa/jinMetrics.ts`（商人の除外）、`meta/codex.ts`（除外）、`core/state.ts`（`Merchant` / `Ware`） | flask |
| C chapters | `system/chapters.ts`（本体）+ test、`world/ARC.json`、`system/roomTypes.ts`（泉の階・呪いなし・瓶を満たす）、`ROOM_KIND/shrineDepths.json` 削除、`HEAL.json` | `system/boss.ts:76`、`system/floorLord.ts` / `floor.ts:156`（主なし）、`floor.ts:823`（ハートの章別確率）、`boss.test.ts` / `floorLord.test.ts` / `roomTypes.test.ts` の修正 | — |
| D qa bot | `qa/bot.ts`（瓶を飲む・市で瓶を買う: 探索中に `merchants[0]` の瓶の台座へ寄る）、`qa/economyMetrics.ts`（瓶・買い物・章別） | `qa/simulation.test.ts` | — |
| 統合役 | `REPLAY_VERSION` 24、Tips、`docs/recipes/contractor.md`（商人の足し方を追記）、`CODE_MAP` | | |

### 6c 賭け・容れ物・鍵の使い道・寄進（遊べる: 賭場で張る、壺を割る、宝箱を鍵で開ける、章の境で寄進）

| レーン | 所有 | 最小 Edit |
| --- | --- | --- |
| A bets | `system/bets.ts` + test、`ECONOMY/bet.json`、賭場の主の品書き（`contractors.ts` の bookie 部分は A が所有） | `jin.ts:293`（`onJinEngaged` 1 行）、`system/parry.ts`（`pushEvent onParry` 1 行、無ければ）、`core/events.ts`、`specialRooms.ts:650-697`（賭博の部屋を銭に） |
| B containers + 宝箱 | `system/containers.ts` + test、`data/enemies.ts`（`pot` / `crate`）、`families.ts`（`Container`）、`ECONOMY/container.json`、`specialRooms.ts` の `lockedChest`（宝物庫）・封印庫を鍵に | `combat.ts:319`（`def.container` の早期リターン 1 行）、`floor.ts`（`placeContainers` 1 行）、`registry.ts`、`roomTypes.ts`（宝物庫の 1 つを鍵付きに） |
| C donation | `system/donation.ts` + test、`meta/hubStore.ts`（`donated?`）、`render/hubUi.ts`（井戸の 1 行）、`ECONOMY/donation.json` | `main.ts:440-450`（`endRun` で `saveHub`）、`specialRooms.ts`（`PropKind "donation"` と休符の開始部屋への配置） |
| D qa | 賭け・容れ物・寄進の指標、bot は賭けに触れない（方針だけ「丁半に 1 回張る」を足すか要判断） | |
| 統合役 | `REPLAY_VERSION` 25 | |

### 6d 行商・闇市・通貨の見本（遊べる: 歩く行商を探す・助ける、隠し部屋の闇市、持つ / 稼ぐの性質と祝福）

| レーン | 所有 | 最小 Edit |
| --- | --- | --- |
| A peddler + 闇市 | `system/merchants.ts`（行商の歩き・助ける・闇市）、`system/hiddenRoom.ts`（開いた瞬間に闇市を立てる） | `spawner.ts`（徘徊の目的地を商人にも貸す関数の export） |
| B 見本 | `loot/affixes.ts`（性質「懐」）、`system/boonDefsWave3.ts`（守銭・拾い勢）、`loot/affixCurves/…json`、`BOON.json` | `system/traitHooks.ts`（`coinMagnetMul` / `coinSpillMul` の受け口） |
| 統合役 | `REPLAY_VERSION` 26、`docs/recipes/affix.md` / `boon.md` に「通貨の口」の 1 行 | |

### 6e 絵（pixel-artist。段の順は 6b の後ならいつでも）

- `data/sprites/`（密度 2）: 銭（小 / 中 / 大の 3 段 = 額で絵を変える）、鍵、瓶（満 / 空）、壺・木箱・鍵付き宝箱、寄進の祠、商人 4 種の体（市・行商・闇市・章の市。契約者の人影より 1 段描き込む）、HUD の瓶アイコン。`pnpm run sprite lint`。描画側の差し替えは `coinUi.ts` / `flaskHud.ts` / `merchantUi.ts` の `SPR` 参照を 1 行ずつ
- 効果音（audio）: `coinPickup`（拾う。連続で鳴るので `pushSfx` の同フレーム重複除去で足りる）、`coinSpill`、`flaskDrink`、`merchantProvoked`、`betWin` / `betLose`。`audio/sfxNames.ts` / `sfxLayers.ts` は最小 Edit

### 6f（任意・後段）出口の予告

`run-arc.md` 3 章 A 案の縮小版（報酬 = 銭 / 鍵 / 瓶 / 遺物 / 危険。祝福の出口は入れない）。祝福の扱いを決めてから（6 章）

---

## 5. 調整つまみと測る指標

**つまみ**（順に触る）: `ECONOMY.income.kill.normal`（1 階の稼ぎの土台）→ `income.jin` / `floor` → `price.base.flask`（瓶の価格 = 銭の価値の物差し）→ `chapterMul`（値段と稼ぎを同じ倍率で。片方だけ触らない）→ `spill.ratio` → `coin.life` / `magnetRadius`（拾いに行く手間）→ `bet.*.mul`（期待値 0.9〜1.0 を保つ）→ `key.jinChance`（1 章に 3〜5 本）→ `flask.max` / `healRatio`

**フル QA に足す表**（`qa/economyMetrics.ts` `buildEconomySection`。深度帯別 1〜5 / 6〜10 / 11〜15 / 16〜20）

| 指標 | 目標（章 1） |
| --- | --- |
| 1 階の稼ぎ（源別: 撃破 / 陣 / 階 / 容れ物 / 賭け / 契約）と合計 | 全部倒す bot で 90〜120 |
| 消えた銭 / 落ちた銭（拾えなかった割合） | 20〜35%（拾いに行く判断が残る） |
| こぼれた銭 / 拾い直した銭、1 被弾あたりの損 | 拾い直し 50〜70% |
| 使い道の内訳（瓶 / 遺物 / 刻印符 / 鍵 / 引き直し / 契約 / 賭け / 寄進）と、死亡時の持ち金 | 死亡時の持ち金が 1 階の稼ぎの 1〜2 倍を超えるなら出口が足りない |
| 瓶: 買った数 / 飲んだ数 / 死亡時の残り / 泉で満たした数 | 死亡時の残り 0〜1（温存して死ぬなら flask の価値が低い） |
| 賭け: 型ごとの回数 / 勝率 / 純益、腕の賭けの成功率（易 / 難 / 至難） | 運の勝率が期待どおりか、腕の易が 60〜80% |
| 鍵: 得た数 / 使った数 / 死亡時の残り | 1 章 3〜5 本 |
| 商人: 立った数 / 買い物が 0 の市の割合 / 襲われた数、無法者になったランの到達深度 | |
| 章: 章ボスの撃破率、休符の泉の使用率、寄進の総額 | |
| 実体数: 同時に床にある銭の最大 / 1 step の ms（上限 120 で 0.35ms 以下） | |

bot 方針: 銭は自動で拾える（引き寄せ）ので追加なし。瓶は hp ≤ 40% で飲む。市では瓶が上限未満で払えれば瓶だけ買う（他は買わない = 「銭を温存する人」の基準値）。賭けは張らない（張る版は `SIM_PROBE` の別方針で）

---

## 6. 不確かな点（推奨 1 つ。★ はユーザー確認）

1. ★ **内部 key の改名** `state.shards` → `state.economy.coins`（推奨。`RuleEffectKind "shards"` との衝突を避ける）。据え置きは economy-core 4 章の記述どおりだが、Rule 文法に「shards = 氷の破片」と「shards = 銭」が並ぶ。確認: `rg '"shards"' src/core/rules.ts src/system/rules.ts`
2. ★ **寄進の永続化と使い道**: `roguelike.hub.v1` に `donated?` を足すだけ（v2 不要）、使い道は無し、拠点の井戸に総額を表示（推奨）。使い道を「拠点の解放・図鑑」に限る方針は経済に効かないので後で決めてよい
3. ★ **商人を襲った後**: 以後のこのランの値段 ×2（推奨）か、商人が出てこないか。前者は銭の出口を残す
4. ★ **章ボスの顔ぶれ**: 章 1 スライム王 / 章 2 盗賊王 / 章 3 油壺の王 / 章 4 鏡の騎士（core-synthesis 1 章 E29 を優先し、run-arc の骸骨卿・霜の巨人はローテーションへ）。run-arc 1-1 の表と食い違うので確認
5. ★ **出口の予告と祝福**: 6f を入れるなら「祝福の出口を選んだ階だけ 3 択」（run-arc 決定 3）は祝福の総数を変えるので、段取り 7 の祝福の作り直しと一緒にするか、6f を祝福なしの縮小版にするか。推奨は後者を 6f で、前者は段取り 7
6. ★ **瓶のキー**: `KeyB` + `Digit5`、パッドは D パッド上（推奨）。実プレイの手触りで変えてよい（`REBINDABLE_ACTIONS` に入れるので設定画面から変えられる）
7. 商人・壺を Enemy にすることの副作用: `engagement.ts`（idle は交戦に数えない前提）、`enemies.ts` の `separate`（`stationary` で押されない前提）、`strikerCap`（idle は数えない）、図鑑・`jinMetrics`・`ROAM` の徘徊上限（`ROAMING_ROOM` の数を数える箇所があれば商人を除く）。確認: `rg 'ROAMING_ROOM' src/system/spawner.ts src/system/engagement.ts` と `pnpm exec vitest run src/system/engagement.test.ts src/qa/simulation.test.ts`
8. 敵の攻撃で壺が割れるか: 「敵の攻撃が敵にも当たる」（core-synthesis E30）の実装状況で決まる。確認: `rg 'friendly|hitsEnemies|敵にも当たる' src/system/enemies.ts src/system/hazards.ts`。未実装なら爆発（`hazards`）だけ壊す
9. 泉の呪い（`state.cursed`）を休符で外すと、`cursed` を前提にしたテスト（`roomTypes.test.ts` の「泉を使うと次の部屋が呪われる」）は深度 3 の泉が無くなるので書き換えが要る。深度 3 の泉は消えるが、出口の予告「泉」（6f）で戻せる
10. 銭の実体数と性能: 80 体 / 階で 8 秒の寿命なら同時 30〜50 個。`maxCoins` 120 で足りるはずだが、フル QA の 1 step ms（今 0.22ms）を見る。超えたら `updateCoinPickups` の引き寄せを「プレイヤーから 80px 以内の銭だけ距離を測る」に絞る（決定性に影響なし）

## 参照ファイル（絶対パス）

- `/home/user/roguelike/docs/ideas/core-synthesis.md`（1 章・3-5・3-15〜3-17・4 章・9 章）
- `/home/user/roguelike/docs/ideas/economy-core.md`、`/home/user/roguelike/docs/ideas/run-arc.md`、`/home/user/roguelike/docs/ideas/jin-impl.md:246-248, 363`
- `/home/user/roguelike/src/core/state.ts`、`/home/user/roguelike/src/core/rules.ts`、`/home/user/roguelike/src/core/events.ts`、`/home/user/roguelike/src/core/input.ts`、`/home/user/roguelike/src/core/replay.ts`、`/home/user/roguelike/src/core/scale.ts`、`/home/user/roguelike/src/core/padBinds.ts`
- `/home/user/roguelike/src/system/contractors.ts`、`/home/user/roguelike/src/system/floor.ts`、`/home/user/roguelike/src/system/jin.ts`、`/home/user/roguelike/src/system/combat.ts`、`/home/user/roguelike/src/system/specialRooms.ts`、`/home/user/roguelike/src/system/roomTypes.ts`、`/home/user/roguelike/src/system/boss.ts`、`/home/user/roguelike/src/system/modifiers.ts`、`/home/user/roguelike/src/system/loot.ts`
- `/home/user/roguelike/src/render/runUi.ts`、`/home/user/roguelike/src/render/renderer.ts`、`/home/user/roguelike/src/render/layers.ts`
- `/home/user/roguelike/src/data/balance/world/CONTRACT.json`、`/home/user/roguelike/src/data/balance/world/ROOM.json`、`/home/user/roguelike/src/data/balance/world/ROOM_KIND/_index.json`、`/home/user/roguelike/src/data/balance/combat/HEAL.json`、`/home/user/roguelike/src/data/balance/enemies/JIN.json`
- `/home/user/roguelike/src/meta/hubStore.ts`、`/home/user/roguelike/src/save/fileEnvelope.ts`、`/home/user/roguelike/src/main.ts:440-450`
- `/home/user/roguelike/src/qa/simulation.test.ts:579-652`、`/home/user/roguelike/src/qa/bot.ts:910-959`