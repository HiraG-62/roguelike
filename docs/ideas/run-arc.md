# ランの弧・持ち込みと持ち帰り・出口の予告・敵の密度・デイリー

作成日: 2026-09-28
前提: `memo/20260928-1.md` の全項目を 1 本にまとめた設計書。読んだもの: `CLAUDE.md`、`docs/HANDOFF.md`、`IDEAS.md`「現状」、`docs/DESIGN_PRINCIPLES.md`、`docs/LOOT_DESIGN.md`、`docs/ideas/run-structure.md` / `run-expansion.md` / `hub-design.md`、`src/system/floor.ts` / `spawner.ts` / `floorLord.ts` / `boss.ts` / `biomes.ts` / `specialRooms.ts`（分岐路）/ `runSetup.ts`、`src/core/replay.ts` / `state.ts`、`src/loot/profile.ts`、`src/system/loot.ts`、`src/main.ts`（beginRun / endRun / デイリー）、balance の `world/MAP_SIZE` `ROAM` `CAVE` `FLOOR_KIND` `ROOM` `RUN_MOD`、`enemies/FLOOR_LORD` `REAPER` `BOSS/`。
今の実装の要点: 深度は無限で、5 の倍数の階に階層ボス 9 体のローテーション（`BOSS_ROTATION`）、他の階は毎階「階の主」。反転層 20〜・無限の深み 30〜。装備は拾った瞬間に `profile.stash` へ永続化し、拠点の装備 7 部位をそのまま持ち込む。分岐路（最後の部屋に 2〜3 階段、行き先はバイオームだけ）は既にある。敵は塊（部屋）に置き、通路に徘徊を初期配置（`populateCorridors`、上限 20）し、時間で増援（`roamCap`）。デイリーは `dailySeedText`（UTC 日付）を seed 文字列にして起点画面へ直行するだけ。

診断（ユーザー）: 要素は良いが製品として見るとすぐ飽きる。(1) ランの終端・ゴールが無い (2) 永続装備を全部持ち込めるのでランごとの新鮮さが無い (3) 開放型の広いマップで判断の場面が少ない。対策は memo の 4 本（+ デイリー）。

凡例: コスト S = 数時間 / M = 1〜2 日 / L = 数日以上。面白さ ★1〜5。数値はすべて目安で `src/data/balance/**/*.json` に置く（ロジックは `data/tuning.ts` 経由）。型の追加は「要追加: <型>.<フィールド>」。

## 0. 用語（新語は案。採用したら `docs/GLOSSARY.md` に足す）

| 表記（案） | 内部名（案） | 意味 | 既存の語との関係 |
| --- | --- | --- | --- |
| 章 | chapter / `chapterOf(depth)` | 5 階ごとの区切り。章ごとにバイオームの候補と章ボスが固定 | 「幕」（run-expansion 4-2）は使わず「章」に統一 |
| 章ボス | chapter boss（`BossState.major` のまま） | 章の 5 階目に出る階層ボス。既存の 9 体から章ごとに固定 | 表示は今までどおり「ボス」 |
| 最深の間 / 最深の主 | finalFloor / finalBoss | 深度 21 の 1 部屋だけの階と、そこに出る最後のボス | 「最終ボス」は開発用語。表示は「最深の主」 |
| 踏破 | cleared（`GameStatus` に追加） | 最深の主を倒して探索を終えること。死亡と別の終わり方 | 死亡画面の集計を流用した「踏破」画面 |
| 深み | 深度 22 以降（既存の「無限の深み」を踏破後の遊びに位置づけ直す） | 踏破後に「さらに深く」を選んだ先。反転層・変異はここから | 表示「深み n 層」。「無限の深み」の語は Tips に残す |
| 持ち込み / 持ち込み枠 | carry / `RunSetup.carrySlots` | 拠点の装備のうちランへ持って入る部位（最初 2） | - |
| 袋 | bag（`GameState.gear.bag`） | ラン内で拾った遺物の一時置き場。ランが終わると中身は持ち帰った分だけ残る | 「倉庫」（永続）と区別する |
| 持ち帰り / 持ち帰り枠 | carryBack | 探索の終わりに袋から倉庫へ移せる数 | - |
| 荷車 | cart（`FacilityKey` に追加） | 持ち帰り枠を増やす拠点の設備 | 拠点の設備の並び（井戸 / 掲示板 / …）に足す |
| 出口の予告 | exit reward（`StairsChoice.reward`） | 階段ごとに見える「次の階で確定する報酬の種類」 | 既存の「分岐路」（行き先 = バイオーム）に報酬を足す |
| 撤退 | retreat | 章ボス撃破後の「帰還の扉」で探索を自分で終えること。死亡より持ち帰りが多い | 「帰還」は上り階段（1 つ浅い階へ戻る）で使用済みなので別の語 |
| 野営 | camp（`ROAM.camps`） | 空き地に置く 2〜4 体の敵の小さな群れ。気付くまで眠る | 「巣」（部屋種類）と区別 |
| 今日の挑戦 | daily（既存の `daily` フラグ） | デイリーシードの表示名 | 「デイリー」は開発用語 |

用語の決め: 縛りの合計は既存の「位階」（`runTier`）を使い、memo の「段位」は新語にしない。

---

## 1. ランの弧

### 1-1. 構成（4 章 × 5 階 + 最深の間）

| 章 | 深度 | 表示（案） | バイオームの候補（分岐路がここから選ぶ） | 章ボス（既存） | 階の主 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1〜5 | 浅瀬 | 洞窟 cave / 草原 meadow / 沼 swamp | スライム王 kingSlime（深度 5） | 2〜4 階に出る。1 階は主なし（契約者が必ず立つ休符） |
| 2 | 6〜10 | 坑道 | 油の坑道 mine / 骨の墓所 ossuary / 回廊 rooms | 骸骨卿 boneLord（10） | 7〜9 階。6 階は主なし |
| 3 | 11〜15 | 氷と炎 | 氷窟 glacier / 熔鉱炉 forge / 暗闇 dark | 霜の巨人 frostGiant（15） | 12〜14 階 |
| 4 | 16〜20 | 深淵 | 全バイオーム（重みは反転層の逆順 = 後半のバイオームが多い） | 鏡の騎士 mirrorKnight（20。自分のビルドを写す = 集大成） | 17〜19 階 |
| 最深の間 | 21 | 最深の間 | ボス部屋 1 つの回廊（`BOSS.roomMinW/H` の部屋 + 前室） | 最深の主（下記） | なし |

- 章のバイオーム候補は `FLOOR_KIND.biomeMinDepth`（解禁深度）を **章の候補表** `ARC.chapters[n].biomes` に置き換える（`floorKindCandidates(depth)` が章の表を読む）。解禁深度は撤去せず、深みではそのまま使う
- 章ボスの割り当ては `bossKeyForDepth` を `ARC.chapters[n].boss` から読むだけ（`BOSS_ROTATION` は深みで引き続き使う）
- **最深の主**（推奨 = 新ボスを作らない）: 章ボスに使わなかった 5 体（双子の騎士 / 図書館の司書 / 油壺の王 / 群れの母 / 盗賊王）からラン開始時に seed で 1 体を決め、`RUN_MOD` 案「第三の顔」の仕組み（第 3 段階 = 予備動作 −10%・取り巻き 1 波、下限 60% は守る）を必ず付けて出す。誰が待つかは占い師の「次の階を読む」と拠点の記録室（前回の最深の主）で見える。専用の新ボスは別ブレスト（要判断 → 7 章）
- 章の 1 階目を主なしにする理由: 毎階の主 + 章ボスだと山が並びすぎる。谷 → 登り → 章ボスのリズムを作る。`FLOOR_LORD.skipDepths` は書かず `ARC.lordSkipFirstFloor: true` で章から導く
- ボス階の分岐路は今も撃破後に出る（`ensureForkStairs`）。章の境の出口は 3 章の「章の出口」

### 1-2. 想定プレイ時間

| 区間 | 目安 | 根拠 |
| --- | --- | --- |
| 通常階 1 つ | 2.5〜3.5 分 | 死神の猶予 = 170 × 面積倍率^0.25 + 部屋数 × 4 ≈ 300 秒（`REAPER`）。QA では階段までの歩数が基準の 2.2 倍 |
| 章ボス階 | 2〜3 分 | 面積 1 倍・単騎 |
| 1 章（5 階） | 12〜17 分 | - |
| 1 ラン（踏破） | **50〜70 分** | 4 章 + 最深の間 |

Hades（30〜40 分）より長い。縮める手は「章ごとにマップの面積を段階的に」（`ARC.chapters[n].areaMul: [min, max]`。章 1 = 2〜3 倍、章 4 = 3.5〜5 倍。`rollAreaMul` の range を章から渡す）。数値は JSON なので実プレイで詰める。5 階 × 4 章か 4 階 × 4 章かは 7 章の質問

### 1-3. 踏破画面とクリア後の流れ

1. 最深の主を倒す → `state.status = "cleared"`（要追加: `GameStatus` に `"cleared"`）。死亡時の `killPlayer` → `recordRunOnce` と同じ経路で 1 回だけ記録。撃破のスロー・演出は `onBossDeath` の既存
2. ボス部屋に台座 2 つ（`SpecialProp` の `kind` を 2 つ追加。触れて選ぶ既存の作法）
   - 「帰還」: 探索を終える → **持ち帰りの選択**（2 章）→ 踏破画面 → 拠点
   - 「深みへ」: 深度 22 以降へ降りる。以後の終わりは死亡か「帰還の扉」（3 章）。持ち帰りは死亡時の枠に戻る（欲張る代償）
3. 踏破画面 = 死亡画面の集計（main.ts の death 画面と `deathMetaLines`）を流用し、見出し「踏破」・章ごとの時間・位階・最深の主の名前を足す。`RunHistoryEntry.cause` に `"cleared"` を足す（既存 `defeated` / `abandoned` と同じ欄）
4. 拠点の飾り（`HubDecor`）: 「踏破の碑」（踏破回数・最高位階）。`hubDecorations` は既存の保存データ（履歴の cause）から導く = 保存キーを増やさない

### 1-4. 無限の深み・反転層・100 階の位置づけ

| 今 | 変更後 |
| --- | --- |
| 反転層 20〜（`FLOOR_KIND.invertedDepth`） | **22〜**（深みに入った直後から。章 4 は「反転の重み」だけ借りる） |
| 無限の深み 30〜（HP の伸びが寝る・敵数の上限が外れる・10 階ごとに変異） | **22〜**で同時に始める（`deepDepth` = 22）。変異は 30 / 40 / … のまま（`mutationEvery` 10 は据え置き、起点を 22 にずらすなら `mutationFrom`） |
| ボスの周期 5（`BOSS.interval`） | 深みでも 5 の倍数に `BOSS_ROTATION` を続ける（25 = 双子の騎士 …。最深の主に使った 1 体は先頭から外す） |
| 100 階 | 深み 100 層 = 実績「百層」（`meta/achievements.ts`）と拠点の書架。位階ごとの深みの最高記録は `Profile.meta` ではなく履歴から導く（`history` の最大 depth を位階別に集計。要追加: `RunHistoryEntry.tier`） |

「上り階段（帰還）」は章の中だけ使える（`ascendMinDepth` 3 は据え置き、章ボス階とその 1 つ下には出ない既存の規則がそのまま章の境を守る）。

### 1-5. 縛り（位階）の項目表

既存 11 種（`RUN_MODS`）に 8 種を足して 19 種。新しい 8 種はすべて既存の仕組みの流用で、専用のロジックはほぼ書かない。点は `RUN_MOD.points`（今は TS の `RunModDef.points` → JSON `RUN_MOD.points[key]` へ移す）。

| # | 縛り | 内部名 | 中身 | 点 | 流用する既存 | コスト |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 厚い皮 | thickHide | 敵の生命 ×1.3 | 1 | 既存 | - |
| 2 | 早い手 | quickHands | 予備動作 −10%（下限 60%） | 2 | 既存 | - |
| 3 | 精鋭 | eliteSwarm | 精鋭の抽選 2 回 | 1 | 既存 | - |
| 4 | 乾いた泉 | dryFountain | 泉とハートなし | 2 | 既存 | - |
| 5 | 急かす死神 | hastyReaper | 死神の猶予 ×0.7 | 2 | 既存 | - |
| 6 | 常夜 | eternalNight | 全階が暗闇 | 2 | 既存 | - |
| 7 | 絶えぬ増援 | endlessReinforce | 封鎖ごとに増援 | 2 | 既存 | - |
| 8 | 荒れた大地 | roughLand | 地形 2 倍 | 1 | 既存 | - |
| 9 | 長居の二重苦 | doubleLinger | 長居の代償が早い | 3 | 既存 | - |
| 10 | 部屋の砂時計 | hourglass | 交戦が長引くと増援 | 2 | 既存 | - |
| 11 | 薄氷 | glassBody | 最大生命 ×0.7 | 2 | 既存 | - |
| 12 | 二重の修飾 | doubleElite | 精鋭は修飾子 2 つ | 2 | `Enemy.eliteExtra`（反転層の +1 抽選と同じ経路 `extraEliteRoll`） | S |
| 13 | 第三の顔 | thirdFace | 章ボス・最深の主に第 3 段階 | 3 | `phaseShift(stage 3)`。段階 3 は予備動作 −10% と取り巻き 1 波（`spawnCapped`）で共通化（ボスごとの専用技は作らない） | M |
| 14 | 狭い選択 | narrowChoice | 祝福が 2 択 | 1 | `offerBoons` の枚数（`BOON.choices`） | S |
| 15 | 呪われた選択 | cursedPick | 3 択の 1 枠が必ず呪い付き | 1 | 既存の呪い付き抽選（`takeCurse` の 4 枚目を最初から混ぜる） | S |
| 16 | 刻印なし | noRunes | 刻印符が落ちない（図書館は残響に変わる） | 1 | 刻印符ドロップの経路を 1 か所で止める | S |
| 17 | 重い足 | heavyFeet | ダッシュの再使用時間 ×1.5 | 2 | `PlayerStats.dashCooldown` に倍率（`applyRunStats`） | S |
| 18 | 血の月 | bloodMoonAlways | ランイベント「血の月」が全階で常時 | 2 | 無限の深みの「変異」（`mutationsFor` = ランイベントの常時化）をそのまま縛りから積む | S |
| 19 | 持ち込みなし | noCarry | 持ち込み枠 0（右手はジョブの初期武器だけ） | 3 | 2 章の `carrySlots` を空にする | S |

- 見送り: 「速い弾」（敵弾の予告線を伸ばす手当てが要る）、「死の置き土産」（全敵に爆裂の = 密度を上げた後だと処理が重い）、「見切りの重さ」（演出の有無は縛りにしない）
- 位階の上限 = 35 点。予備動作は「早い手」と「第三の顔」を重ねても 60% で止める（`scaledWindup` の下限は既存）

### 1-6. 位階の報酬（踏破したときだけ数える。深度到達の得点倍率 `scorePerTier` は据え置き）

| 位階 | 報酬 | 置き場所 |
| --- | --- | --- |
| 1 以上で踏破 | 称号「縛りを越えた者」 | `meta/achievements.ts` |
| 3 | 荷車の段階 +1 の解錠条件（2-5 節） | `meta/hub.ts` の導出 |
| 6 | 名のある遺物 1 種が抽選に加わる（依頼の報酬と同じ経路 `lockedRelics`） | `meta/quests.ts` の報酬型を流用 |
| 10 | 持ち帰り枠 +1（踏破時のみ） | `CARRY.clearBonusByTier` |
| 15 | 拠点の看板「位階 15」、起点 1 種の解放 | `meta/hub.ts` / `meta/quests.ts` |
| 20 / 25 / 30 / 35 | 称号（段階名は JSON `ARC.tierTitles`） | `meta/achievements.ts` |

位階ごとの踏破の記録は履歴から導く（`RunHistoryEntry.tier` を足すだけ。保存キーは据え置き）。

---

## 2. 持ち込み枠と持ち帰り

> **実装の状況（2026-10-02）**: 荷車（2-5 の後半）を除いて実装した。下の表の案から変えた所:
> - 置き場は `GameState.gear` を足さず、**ラン用のプロフィール**（`loot/runGear.ts` の `makeRunProfile`）にした。装備は持ち込む部位だけ、stash が袋、meta・奥義は拠点と同じ参照。`carriedIds` を持つプロフィールは `saveProfile` が書かない（step の中の保存の呼び出しはそのまま）。`computeStats` の入力を差し替える約 20 か所の改修が要らない
> - 持ち込みはユーザーの決定で **右手（武器）は常に + 2 部位**（`CARRY.weaponFree` / `carrySlots`）。印は拠点の装備画面の装束で部位の長押し（右下の朱の判）。枠を超えては付けられない（古い印は外さない）。未設定なら装備している部位の先頭から 2 つ
> - 持ち帰りの枠は死亡（途中でやめたときも）`CARRY.keepOnDeath` 1・踏破 `keepOnClear` 3。撤退の上乗せ・荷車は後の段
> - 袋の上限 `bagCapacity` は作らず、倉庫の上限（400）のまま。1 階の確定ドロップ `firstFloorGuarantee` も作らない（階の到着は既に 0.8）。序盤の戻しは部屋の制圧の深度 1 を 0.24 → 0.28 だけ（`loot.test.ts` の「浅いほど出にくい」の約束の内側）
> - 持ち帰りの画面は一覧画面の部品ではなく専用（`ui/carryBack.ts` / `render/carryBackUi.ts`）。死亡画面の T / Enter / R、ポーズのやめる・やり直し、R の中断のどれでも挟む（拾った遺物が無ければ挟まない）。Esc でランへ戻れる（途中でやめたランは記録しない）
> - ラン中の鍛冶は持ち込んだ遺物を消す操作（砕く・捧げる側）だけ断る。作り替えた持ち込みの遺物は `settleRun` が拠点の装備へ戻す
> - `REPLAY_VERSION` 36。`stashCount` は袋の件数として読む（`bagCount` は足さない）

### 2-1. 原則の変更

`docs/DESIGN_PRINCIPLES.md` 10「拾った瞬間に永続」を **「持ち帰った遺物が永続。死んでも持ち帰った分は失わない。袋の残りは失われる」** に改める。緊張は「何を持ち帰るか」の判断に移る。ゴール装備を作らない哲学との整合: 持ち帰り枠が狭い = 倉庫に入る遺物が減り「この 1 つ」を選ぶ行為そのものがビルドの方向を決める。地金の上限（`INNATE.hardCap`）・倉庫上限 400（`STASH_CAPACITY`）は据え置き（倉庫の圧は下がる）。

### 2-2. 持ち込み（拠点側）

| 項目 | 案 | 触るファイル |
| --- | --- | --- |
| 枠の数 | 2 部位（`CARRY.carrySlots`）。ジョブ・起点で変えない。縛り「持ち込みなし」で 0 | `src/data/balance/loot/CARRY.json`（新規） |
| どこで選ぶか | 拠点の **装備タブ**（庭 / Tab）。7 部位の欄はそのまま装備でき、部位の枠の右上に「持ち込み」の印（トグル。`Shift+クリック` か新しい行）。印の数が枠を超えたら古い印が外れる | `src/ui/inventory.ts`、`src/render/inventoryUi.ts`、`src/ui/inventoryLayout.ts` |
| 井戸の確認 | 起点画面（ジョブ → 起点）の最後に「持ち込み: 右手・指輪」を 1 行で出し、変えたいときは Tab で装備タブへ。段は増やさない（`OriginStage` は据え置き） | `src/ui/origin.ts`、`src/render/originUi.ts` |
| 記録 | `RunSetup.carrySlots: Slot[]`。リプレイの `snapshot.equipment` は持ち込んだ部位以外を null にした状態を写す（形は変えない） | `src/system/runSetup.ts`、`src/core/replay.ts` |
| 拠点の装備は保つ | `profile.equipment`（拠点の装備 7 部位）はランで書き換えない。持ち込んだ遺物は同じオブジェクト参照でランに入るので来歴（`recordProvenance`）は積もる | `src/core/game.ts` |

### 2-3. 空いた部位の扱い

| 部位 | 開始時 | 理由 |
| --- | --- | --- |
| 右手（持ち込まなかった） | ジョブの初期武器（`startJobWeapon`。性質なし・地金なし・借り物 `Item.loaned`） | 素手ではジョブの型が出ない。既存の仕組みでそのまま出る |
| 他の 6 部位 | 空 | 1〜2 階で埋まるように序盤のドロップを戻す: `LOOT_DROP.mobDropMulByDepth` 深度 1〜2 を 0.1 / 0.12 → 0.25 / 0.25、`roomClearChanceByDepth` 深度 1 を 10% → 25%、`depthArrivalChance` 35% → 60%（1 階で 1 個確定 `CARRY.firstFloorGuarantee: true`） |
| 起点「素手」 | 持ち込みも封印（今と同じ振り分け点）。持ち込み 0 と区別がつきにくいので説明文を「持ち込んだ装備も 3 階まで封印」へ | `src/system/runSetup.ts` |

### 2-4. ラン内で拾った装備（袋）

今: `pickUp` → `addToStash(state.profile)` → `saveProfile`（step の中で保存）。変更後:

| 項目 | 案 |
| --- | --- |
| 置き場 | 要追加: `GameState.gear: RunGear`（`{ equipment: Equipment; bag: Item[]; carried: Slot[] }`。`src/loot/runGear.ts` 新規）。`computeStats` の入力を `state.gear.equipment` に切り替える（`profile.equipment` を読む 46 か所のうち system / core / replay / ui の約 20 か所） |
| 拾う | `pickUp` は袋へ（上限 `CARRY.bagCapacity` 24。満杯なら「袋が満杯」で床に残す。倉庫の満杯判定はラン中に使わない）。**step の中で `saveProfile` を呼ばない**（不変条件 8 に沿う） |
| 装備の付け替え | 装備画面の「倉庫」欄はラン中は袋を表示（見出し「袋 n/24」）。装備中のラン内遺物を外すと袋へ戻る。拠点の倉庫はラン中は見えない（呼び出しはリプレイの決定性を崩す。run-expansion 第 2 弾の見送りと同じ理由） |
| 芽 | 持ち込んだ遺物の芽（`chooseBud`）はラン中も選べるが `saveProfile` はしない（ラン終了時にまとめて保存）。ラン内遺物の芽も出る（袋の中で育つ） |
| 残響のクラフト | ラン中の残響タブは袋の遺物を「砕く」だけ可（`pendingEchoes` の既存経路で終了時に保存）。他の操作は拠点のみ |
| 死亡・踏破・撤退 | **持ち帰りの選択画面**（`src/ui/carryBack.ts` + `src/render/carryBackUi.ts` 新規。DOM 非依存、一覧画面の部品 `ListScreen` を流用）: 袋 + 装備中のラン内遺物を並べ、枠の数だけ選ぶ。選んだものだけ `addToStash`。持ち込んだ遺物は来歴を積んだ状態で拠点の装備に戻る。ここで初めて `saveProfile` |
| 残り | 消える（推奨）。「砕いて残響に」は 7 章の質問 |

### 2-5. 持ち帰りの枠と荷車

| 終わり方 | 枠 | JSON |
| --- | --- | --- |
| 死亡 | 荷車の段階（初期 1） | `CARRY.baseByCart: [1, 2, 3, 4]` |
| 撤退（章ボス撃破後の帰還の扉） | 荷車 + 1 | `CARRY.retreatBonus: 1` |
| 踏破 | 荷車 + 2（位階 10 以上で +1） | `CARRY.clearBonus: 2`、`clearBonusByTier` |
| 深みで死亡 | 荷車（踏破の上乗せは消える） | - |

荷車（拠点の設備。`FacilityKey` / `HubSpotKey` に `cart` を追加、`HUB_SPOT_KEYS` の並びの末尾）:

| 段階 | 持ち帰り（死亡時） | 解錠条件（既存の保存データから導く） | 費用（残響。5 色を均等に） |
| --- | --- | --- | --- |
| 1 | 1 | 最初から | - |
| 2 | 2 | 章 1 のボス（スライム王）を倒した記録（`codex.enemyKills`） | 各色 3 |
| 3 | 3 | 位階 3 以上で踏破（履歴） | 各色 6 |
| 4 | 4 | 位階 10 以上で踏破 | 各色 12 |

- 通貨は **残響**（`EchoWallet`、`roguelike.craft.v1`）。5 色均等にするのは色の偏った貯め込みを防ぐため。買った段階は `HubSave.cart`（任意項目。無ければ 1。`roguelike.hub.v1` の形は壊れたら既定に戻る作法のまま。**v2 は切らない**）
- 持ち込み枠を増やす設備は作らない（新鮮さの源なので固定 2）。要判断 → 7 章
- 荷車の台では「荷車 2/4 ・ 次: 各色 6」を `drawText` で出す。数値の比較指標は出さない

### 2-6. リプレイ・決定性

- `ReplayLoadout.equipment` = ラン開始時の `gear.equipment`（持ち込み以外 null）。`stashCount` は「袋の件数（0）」に意味が変わるので `ReplayLoadout.bagCount?` を足し、`stashCount` は残す（旧記録の互換）
- `applyLoadout`（装備画面の付け替えイベント）は `gear.equipment` と袋に適用する。袋の中身は決定的に生成されるので記録は件数だけでよい（拾えるか否かが袋の満杯で変わるため）
- `REPLAY_VERSION` を上げる（6 章）

---

## 3. 出口の分岐と報酬の予告

### 3-1. 方式

既存の分岐路（`planForkStairs`: 最後の部屋に 2〜3 階段、行き先 = バイオーム）に **報酬の種類** を足す。開放型の洞窟でも階段は「階の主の部屋」に集まるので、まず同じ部屋に並べたまま予告を足す（A）。別の塊に出口を置く B は次段。

| 案 | 中身 | なぜ面白いか | コスト | 面白さ |
| --- | --- | --- | --- | --- |
| A. 予告付きの分岐路（推奨） | 各階段の上にバイオーム名 + 報酬の印（字形 + 名前）。ミニマップにも印。階の主の部屋で撃破後に選ぶ | Hades の扉と同じ「次に何が要るか」の判断が毎階 1 回入る。既存の `StairsChoice` に 1 欄足すだけ | S〜M | ★★★★★ |
| B. 裏道 | 階の主の部屋とは別の遠い塊に「裏道」の出口を 1 つ置く。主を倒さずに降りられるが報酬は「なし」か「危険な部屋」だけ。主の部屋の扉は封鎖しないので逃げ切れる | 「主と戦うか逃げるか」= 開放型ならではの判断。死神が迫るときの逃げ道 | M | ★★★★ |
| C. 章の出口 | 章ボス撃破後は 3 つ全部が祝福（格 +1 = 既存 `stairsGradeBoost`）で、加えて「帰還の扉」（撤退）が出る | 章の境で「欲張るか帰るか」 | S | ★★★★ |

### 3-2. 報酬の種類（`ExitReward`。要追加: `StairsChoice.reward`）

| 報酬 | 表示（案） | 次の階で確定すること | 流用する既存 | 重み（JSON `EXIT.weights`） |
| --- | --- | --- | --- | --- |
| 祝福 | 祝福 | 到着時に 3 択（今の `offerBoons`）。系譜を持っていれば「祝福（灰燼）」のように系譜名を添え、その系譜を 1 枚確定 | `offerBoons`、`BoonDef.lineage` | 3 |
| 遺物 | 遺物 | 到着報酬が確定で 1 個（`dropDepthReward` の確率を 1 に）+ 揺らぎの増幅 | `LOOT_DROP.depthArrivalChance` | 3 |
| 欠片 | 欠片 | 到着時の欠片が 3 倍 | `CONTRACT.shardsPerFloor` | 2 |
| 契約者 | 契約者（名前） | 入口に特定の契約者が必ず立つ（誰かも予告） | `placeContractor` の抽選を固定 | 2 |
| スキル石 / 刻印符 | 石 / 符 | 図書館の部屋が必ず 1 つ、または石のドロップ 1 個確定 | `assignExtraRoomKinds` に強制 | 1 |
| 危険な部屋 | 危険 | 巣窟 / 闘技場 / 試練のどれかが必ず 1 つ。その制圧報酬は 2 倍（`dropBonusReward`） | `ROOM_KIND` の割り当てに強制 | 2 |
| 泉 | 泉 | 泉の部屋が必ず 1 つ（深度の制限を外す） | `setupShrine` | 1（生命が 5 割以下のときだけ候補） |
| 芽 | 来歴 | この階の間、来歴が 2 倍で積もる（語り部の目撃 60 秒を階全体に） | `witness` | 1 |

規則:
- 1 階に **少なくとも 1 つは祝福の出口**（`EXIT.boonGuaranteed: true`）。祝福を毎階の自動提示から「出口で選ぶもの」に変えるので、祝福の総数は今よりやや減る（1 ラン 20 階で 12〜16 回）。減った分は格の底上げ（`BOON.gradeDivineBase` は据え置き、章ボス後の +1 が 4 回入る）
- 同じ階段に同じ報酬は並べない。深度 1 の出口は「祝福 / 遺物 / 欠片」だけ（芯の提示 = 深度 2 の最初は変えない）
- 章ボス階（5 / 10 / 15 / 20）: 3-1 の C。最深の間の後は 1-3 の台座（帰還 / 深みへ）
- 決定性: 報酬は `planForkStairs` の中で `state.rng` から引く（既存の乱数消費の後ろ = 契約者・上り階段・隠し部屋の前）。次の階の `buildFloor(kind, reward)` が読む。要追加: `GameState.pendingExit?: ExitReward`（`descend` が渡して `buildFloor` の末尾で消す）
- 隠し部屋の階段（`HiddenRoom.stairsTile`）と案内人の追加階段（`addForkStair`）は報酬「なし」表示（行き先だけ）

### 3-3. 表示

- 階段タイルの上に浮く 2 行（バイオーム名 / 報酬名）。`drawText`、行高は `textLineHeight()`。プレイヤーが 3 タイル以内に近づいたら明るく（`render/exitUi.ts` 新規。`state` は読むだけ）
- ミニマップ（`render/minimap.ts`）: 階段の点に報酬の色（祝福 = 金、遺物 = 色の配合の帯の既定色、欠片 = 白、危険 = 赤）
- Tips ノートに「出口の予告」を 1 項目（`meta/tips.ts`）

---

## 4. 敵の密度（空き地に敵を置く）

### 4-1. 今の分布と穴

- 部屋（塊）: `enemyCount`（4 + 深度、面積倍率^0.35、上限 16）× 部屋数 14〜15 → 密集
- 通路: `populateCorridors` = 通路タイル 40 につき 1 体、**上限 20**（面積 3.5〜5 倍の階の通路は 1,500〜2,500 タイル → 40〜60 体欲しいところが 20 で頭打ち）。徘徊は `ROAM.fraction` 0.4 で塊から出る
- 増援: 15 秒後から 10 秒ごとに 1 抽選、上限 `roamCap` = (6 + 深度) × 面積倍率^0.75 ≤ 16 × … → 実質 20〜30
- 眠り: `isAsleep`（idle かつ 480px 以上遠い）で AI を回さない。1 step 0.22ms（深度 1、敵 183 体）、目標 0.35ms

穴 = **塊から離れた広い床**。通路の初期配置は「部屋の内側でない床」から一様に選ぶだけなので、塊の縁に偏り、遠い空き地には誰もいない。

### 4-2. 案

| # | 案 | 中身 | なぜ面白いか | コスト | 面白さ | 触るファイル |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 通路の上限を面積で伸ばす | `corridorMax` 20 → `corridorMaxPerArea`（基準 12 × 面積倍率）。40 → 30 タイルに 1 体 | 最も安い。空白の総量が減る | S（JSON + 1 行） | ★★ | `ROAM.json`、`spawner.ts` |
| 2 | **野営**（推奨） | 部屋のタイルからの距離場（`map/pathing.ts` の距離場を部屋タイル群から流す）で **部屋から N タイル以上遠い床** を集め、そこに 2〜4 体の群れを `ROAM.camps.perArea` か所置く。群れは `Enemy.leaderId` で 1 体を長にし（既存の取り巻きの仕組み）、気付くまで眠る | 「誰もいない場所」を狙って埋める。近づくと群れごと起きるので遭遇に形がある | M | ★★★★ | `spawner.ts`（`populateCamps`）、`floor.ts`（呼び出し 1 行）、`ROAM.json` |
| 3 | 群れで徘徊 | `assignRoamers` で 1 体ずつではなく 2〜3 体を同じ目的地で歩かせる（長 + 取り巻き） | 徘徊が「生き物の群れ」に見える。空き地を横切る | S | ★★★ | `spawner.ts` |
| 4 | 増援を空き地へ寄せる | `roamSpawnPoint` の候補を「近くの敵が少ないタイル」に偏らせる（マップを 8×8 タイルの升に割って敵数を数え、少ない升から引く） | 時間が経つほど空白が埋まる。密集地に足さない | S | ★★★ | `spawner.ts` |
| 5 | 見張り | 通路の分かれ目（距離場の分岐 = 隣接床が 3 方向以上）に射撃型の敵を 1 体、徘徊させず置く | 開けた場所を横切ると撃たれる。射線の判断 | S | ★★★ | `spawner.ts` |
| 6 | 空き地の巣 | 群れの母の卵（behavior `egg`）を空き地に 3〜5 個置き、プレイヤーが近づくと孵る | 常に動く理由。壊せば湧かない | M | ★★★★ | `spawner.ts`、`data/enemies.ts` の卵の再利用 |

推奨の組み合わせ: **1 + 2 + 3**（Wave 1）、4 + 5 は数値で足りなければ。6 は敵密度が上がった後の味付け。

### 4-3. 性能との兼ね合い

- 眠っている敵は `updateEnemies` の先頭で `continue` されるので AI のコストはほぼ 0。残るのは `state.enemies.some(...)` の走査（`roomAlive` が未制圧の部屋ごと、湧き位置の重なり判定）= O(部屋 × 敵)。敵 180 → 260 体で 1 step 0.22 → 0.30ms 程度の見込み。目標 0.35ms を超えたら `roomAlive` を部屋ごとの生存カウンタ（`RoomState.alive`）に変える（決定性に影響なし）
- 徘徊の間引き（`sleepRoamEvery` 4）は野営には不要（動かない）
- QA（`src/qa/simulation.test.ts`）に「野営の数 / 野営からの撃破 / 通路の初期配置数 / 1 step の ms」のカウンタを足す

### 4-4. balance JSON の項目案（`src/data/balance/world/ROAM.json` に追加。`_fields` に 1 行ずつ）

| key | 意味 | 目安 |
| --- | --- | --- |
| `corridorMaxPerArea` | 通路の初期配置の上限の基準（面積倍率 1 のとき）。上限 = 四捨五入（これ × 面積倍率） | 12 |
| `corridorPerTiles` | （既存）通路タイルあたり | 40 → 30 |
| `camps.perArea` | 野営の数の基準（面積倍率 1 のとき）。数 = 四捨五入（これ × 面積倍率） | 2 |
| `camps.sizeMin` / `camps.sizeMax` | 1 か所の敵の数 | 2 / 4 |
| `camps.minDistFromRoom` | 部屋のタイルからの最短距離（タイル）。これ以上遠い床だけ候補 | 6 |
| `camps.minDistFromPlayer` | 開始位置からの距離（px） | 260 |
| `camps.leaderChance` | 群れの長を付ける確率 | 0.5 |
| `packRoam.size` | 群れで徘徊するときの 1 群れの数 | 2〜3 |
| `spawnEmptyBias` | 増援の候補を敵の少ない升から引く強さ（0 = 一様） | 0.7 |
| `sentries.perArea` | 見張りの数の基準 | 1 |

「マップの大きさは今のまま」（memo）なので `MAP_SIZE` は触らない（1-2 の章ごとの面積は別件で要判断）。

---

## 5. デイリーシード（今日の挑戦）

### 5-1. シードの決め方（決定性の守り方）

- 今と同じ: `dailySeedText(new Date())` = UTC の `YYYY-MM-DD` を **main.ts（step の外）** で作り、`hashSeed(seedText)` を `createGame` に渡す。step は時計を読まない（不変条件 3 はそのまま守れる）
- 日付の切り替わりは UTC 固定（表示は「今日の挑戦（9/28）」とローカル日付を添える。判定は UTC）
- 記録に `BALANCE_HASH`（既存 `ReplayData.balance`）と `REPLAY_VERSION`・`APP_VERSION` を写す。版が違う記録は「別の日の記録」と同じ扱い（並べない）

### 5-2. 固定するもの（公平性）

| 項目 | 今日の挑戦での扱い | 理由 / 流用 |
| --- | --- | --- |
| 持ち込み | **0**。全部位が日替わりの **借り物**（`Item.loaned`。深度 3 相当の遺物 7 部位を `generateItem` に日付の専用 RNG（`hashSeed(seedText + ":loadout")`）で生成） | 永続装備の差を消す。起点「借り物」（run-expansion 7-7）の実装 |
| ジョブ | 自由（腕の表現。記録にジョブを残し、一覧でジョブ別に見られる） | `RunSetup.job` は既に記録 |
| 起点 | 放浪者に固定 | - |
| 縛り | 日替わりで 1〜2 個（日付の RNG で `RUN_MOD_KEYS` から） | 日ごとの味 |
| スキル石 / 刻印符 | ジョブの初期石 + 日替わりの石 2 個（借り物）。所持刻印符 0 | 永続の石の差を消す |
| 奥義の選択 | 自由 | 選択は記録に載る（`ReplayLoadout.ultimates`） |
| 依頼 | 受けない（依頼の 3 択を飛ばす） | 依頼の進行はデイリーでは動かさない |
| 持ち帰り | **なし**（借り物なので袋は消える）。図鑑・実績は動く | 永続への影響を報酬の出ない形に |
| 終わり方 | 死亡 / 踏破 / 撤退。得点 = 既存 `score` + 踏破ボーナス（`DAILY.clearBonus`）、同点は時間が短い方 | - |

### 5-3. 記録とリプレイ（ローカル版）

- 新しい保存キー `roguelike.daily.v1`（`src/meta/dailyStore.ts` 新規）: `{ version: 1, records: DailyRecord[] }`、最新 60 日。`DailyRecord = { date, result: ReplayResult + durationSec + cleared, job, tier, replayId, version, balance }`
- **1 日 1 回**: その日の最初の記録だけが「記録」。2 回目以降は「練習」として遊べるが記録に上書きしない（`DailyRecord.practiceRuns` を数えるだけ）
- リプレイは `roguelike.replays.v1`（上限 10）とは別に、デイリーの記録の 1 本だけを `roguelike.dailyReplays.v1` に日付 key で 30 日ぶん残す（`pushReplay` を key 付きにした薄いラッパ）
- 表示: 拠点の記録室に台「今日の挑戦」（`HubSpotKey` に `daily`。D キーはタイトルに残す）。一覧画面（`ListScreen`）で日付 / 深度 / 得点 / ジョブ / 踏破の有無、P で再生
- **共有（外部サーバなし）**: `DailyRecord` + `ReplayData` を 1 つの JSON 文字列にして「書き出す（クリップボード / Electron はファイル）」「読み込む」。読み込んだ他人の記録は `imported: true` で同じ一覧に並ぶ（自分の記録と隣で比較 = memo の「記録とリプレイを並べる」の最小形）

### 5-4. 将来のオンライン版との分離

- ローカル版の `DailyRecord` をそのまま送信の単位にする（サーバは「日付 + version + balance」で束ねて並べるだけ）。検証はサーバがリプレイを再生して `result` と一致するかを見る（既存の「result との不一致検出」を流用できる）
- コードの境界: `meta/dailyStore.ts`（保存）と `meta/dailyShare.ts`（書き出し / 読み込みの文字列化）を分け、オンライン版は `dailyShare` の送受信先を差し替えるだけにする。ゲームのロジック（`src/system` / `src/core`）はデイリーを「seed 文字列と RunSetup」としか見ない

---

## 6. 実装の段取り

### 6-1. 波とレーン（ファイル所有）

| 波 | レーン | 所有（新規は「新」） | 共有ファイルへの最小 Edit | 依存 |
| --- | --- | --- | --- | --- |
| 0 | 基盤（統合役が先に入れる） | `src/data/balance/world/ARC.json`（新）/ `EXIT.json`（新）/ `loot/CARRY.json`（新）/ `meta/DAILY.json`（新）、`ROAM.json` の追加項目、`data/tuning.ts` の再 export | `core/state.ts`: `GameStatus` に `"cleared"`、`GameState.gear` / `pendingExit`、`StairsChoice.reward`。`REPLAY_VERSION` 13 | - |
| 1 | A ランの弧 | `system/chapters.ts`（新: `chapterOf` / 章の候補表 / 章ボス / 最深の主の抽選）、`system/finalFloor.ts`（新: 最深の間の生成と台座）、`render/clearUi.ts`（新）、`system/chapters.test.ts` | `system/boss.ts` `bossKeyForDepth`、`system/biomes.ts` `floorKindCandidates`、`system/floor.ts` `descend` / `floorLord` の休符、`system/runSetup.ts` 縛り 8 種、`main.ts` の death 画面の分岐 | 0 |
| 1 | C 出口の予告 | `system/exits.ts`（新: 報酬の抽選・次の階への適用）、`render/exitUi.ts`（新）、`system/exits.test.ts` | `system/specialRooms.ts` `planForkStairs`、`system/floor.ts` `checkStairs`（`offerBoons` の呼び出しを報酬に従わせる）、`render/minimap.ts` | 0。**floor.ts は A が所有**し、C は `exits.ts` の関数を A が呼ぶ形で衝突を避ける |
| 1 | D 敵の密度 | `system/spawner.ts`（野営・群れ徘徊・空き地寄せ）、`system/spawner.test.ts`、`qa/simulation.test.ts` のカウンタ | `system/floor.ts` は `populateCamps` の呼び出し 1 行だけ（A に依頼） | 0 |
| 2 | B 持ち込み・持ち帰り | `loot/runGear.ts`（新）、`ui/carryBack.ts` + `render/carryBackUi.ts`（新）、`ui/inventory.ts` の袋表示、`meta/hub.ts` 荷車、`loot/runGear.test.ts` | `core/game.ts` `createGame`（gear の生成）、`system/loot.ts` `pickUp`、`loot/provenance.ts`（gear を読む）、`core/replay.ts`（snapshot / applyLoadout）、`main.ts` endRun → 持ち帰り画面、`map/hubMap.ts` 台の追加 | 1 が済んでから（`profile.equipment` の参照を一斉に切り替えるので単独で） |
| 2 | E デイリー | `meta/dailyStore.ts` / `meta/dailyShare.ts`（新）、`system/dailyLoadout.ts`（新: 借り物の生成）、`ui/dailyScreen.ts`（新）、テスト | `main.ts` の D キーと記録室の台、`map/hubMap.ts` | B の借り物（`Item.loaned`）と `RunSetup.carrySlots` を使うので B の後 |

各レーンの最後は `pnpm run check`。Agent はコミットしない。QA は隔離 worktree（HANDOFF 3 節の作法）。

### 6-2. `REPLAY_VERSION` と永続化キー

| 変更 | 影響 | 対応 |
| --- | --- | --- |
| 章の候補表・章ボス・最深の間・縛り 8 種（A）、出口の乱数消費と祝福の提示条件（C）、野営の乱数消費（D） | 同じ seed + 入力で結果が変わる | 波 1 の統合で `REPLAY_VERSION` 12 → **13**（1 回。コメントに 3 レーンをまとめて書く） |
| gear / 袋 / 持ち込み（B）、デイリーの借り物（E） | snapshot の意味が変わる（`stashCount` → 袋）。`ReplayLoadout.bagCount?`、`ReplayData.carrySlots?` | 波 2 の統合で **14**。旧記録は `isPlayable` で「再生不可（旧バージョン）」のまま一覧に残る（既存の作法） |
| `roguelike.profile.v1` | 形は変えない（`RunHistoryEntry.tier` / `cause: "cleared"` は任意項目。旧データは無い = 位階 0） | v2 不要 |
| `roguelike.hub.v1` | `HubSave.cart?`（任意。無ければ 1） | v2 不要。`parseHubSave` で数値以外は既定へ |
| `roguelike.daily.v1` / `roguelike.dailyReplays.v1` | 新規 | `src/save/backend.ts` の `SAVE_FILES`（Electron のファイル名）に 2 行足す |
| ラン中に `saveProfile` を呼ぶ箇所（`pickUp` / `chooseBud`） | step の中の保存を止める | `guardSaveWrites` はリプレイ再生用の既存。ランの間も同じガードを掛けるのではなく、呼び出しそのものを endRun へ移す |

### 6-3. テスト観点（`it` 名の例）

- A: 「深度 1〜5 は章 1、6〜10 は章 2 …」「章ボスは章の表どおり（5 = スライム王）」「最深の主は章ボスに使わなかった 5 体から seed で決まり、同じ seed なら同じ」「最深の主を倒すと status が cleared になり recordRun が 1 回だけ」「章の 1 階目に階の主が出ない」「反転層と無限の深みは 22 から」「縛り 8 種がそれぞれ効き、予備動作は 60% を割らない」「位階は最大 35」
- C: 「毎階の出口に祝福が少なくとも 1 つ」「同じ階で同じ報酬が並ばない」「出口『遺物』を選んだ次の階は到着報酬が確定」「出口『契約者』は予告した契約者が立つ」「祝福の出口を選ばなかった階では 3 択が出ない」「隠し部屋・案内人の階段は報酬なし」「出口の抽選は既存の乱数消費の後ろ（契約者の配置が変わらない）」
- D: 「野営は部屋のタイルから N 以上遠い床に置かれる」「野営の敵は生成直後は眠っている」「通路の初期配置の上限が面積で伸びる」「敵の総数が上限（`ROOM.maxEnemies` × 部屋 + 徘徊上限 + 野営）を超えない」「1 step が 0.35ms 以下（QA 縮小版で計測）」
- B: 「持ち込み 2 部位以外は空で始まり、右手が空ならジョブの初期武器」「拾った遺物は袋に入り profile.stash は変わらない」「ラン中に storage へ profile が書かれない」「袋の満杯で床に残る」「死亡時の持ち帰りは荷車の段階、踏破は +2、撤退は +1」「持ち帰らなかった遺物は消える」「持ち込んだ遺物の来歴はラン後の profile に残る」「縛り『持ち込みなし』で右手だけ初期武器」「リプレイの snapshot は持ち込み部位以外 null」
- E: 「同じ日付なら借り物 7 部位と縛りが同じ」「日付が変わると seed が変わる」「1 日 1 回だけ記録し、2 回目は練習」「DailyRecord の書き出し → 読み込みで同じ結果」「デイリーの終了で profile.stash が増えない」

### 6-4. QA bot への影響（`src/qa/bot.ts` / `simulation.test.ts`）

- 階段: bot は `Tile.StairsDown` を最寄りで選ぶ（`findStairsPos`）。報酬は見ないので分岐は偶然。QA としては「出口の種類ごとの選択回数」を数えるだけでよい（bot に選ばせない）
- 踏破: `status === "cleared"` を死亡と同じ終了として扱う（`simulation.test.ts` の終了判定）。最深の間の台座は「帰還」を触る（持ち帰り画面は UI 層なので bot は通らない = `endRun` の手前で終わる）
- 袋: bot は装備を替えないので袋の中身は増えるだけ。QA 指標「拾った rare の割合」は袋を数える（`profile.stash` ではなく `gear.bag`）
- 敵の密度: `report.md` に「野営 / 通路 / 部屋 / 増援」別の撃破と 1 step の ms を出す（4-3）
- デイリー: bot は通らない

### 6-5. 資料に必要な変更（統合役）

- `docs/DESIGN_PRINCIPLES.md` 10 の改訂（2-1）と 13「山場を作る」に「章と最深の間」を 1 行
- `docs/GLOSSARY.md` に 0 章の新語、`docs/CODE_MAP.md` に新規ファイル、`docs/recipes/room.md`（野営）と `docs/BALANCE.md`（ARC / EXIT / CARRY / DAILY）
- `IDEAS.md`「現状」の「反転層 20〜 / 無限の深み 30〜」「拾った瞬間に localStorage へ永続化」の行を書き換え
- `meta/tips.ts` に 章 / 出口の予告 / 袋と持ち帰り / 荷車 / 今日の挑戦

---

## 7. ユーザーに聞くこと（推奨案付き）

1. **最深の主**: 既存 5 体から seed で 1 体 + 第 3 段階（推奨。コスト S〜M、毎ランの顔が変わる）か、専用の新ボスを作る（L。別ブレストで）か
2. **持ち帰らなかった遺物**: 消える（推奨。判断が重くなる）か、自動で砕いて残響の半額にする（拾い歩きの意味は残るが残響が溢れやすい）か
3. **祝福の出方**: 出口「祝福」を選んだ階だけ 3 択（推奨。毎階 1 つは祝福の出口を保証するので選ばなければ取れない）か、毎階の 3 択は残して出口は追加の報酬だけにするか
4. **荷車の費用**: 残響 5 色均等 + 解錠条件（推奨。既存の通貨で拠点に使い道ができる）か、条件だけで自動的に段階が上がる（通貨なし。hub-design の「保存値を増やさない」に近い）か。あわせて持ち込み枠は固定 2 でよいか
5. **1 ランの長さ**: 4 章 × 5 階 + 最深の間で 50〜70 分を受け入れ、章ごとにマップの面積を段階的にして縮める（推奨。`ARC.chapters[n].areaMul`）か、章 1〜2 を 4 階にして 40〜55 分にするか

### 決定（2026-09-28）

1. 最深の主: **専用の新ボスを作る**（別ブレストで設計。できるまでは既存 5 体からの流用で仮置き）
2. 持ち帰らなかった遺物: **消える**
3. 祝福: **祝福の出口を選んだ階だけ 3 択**
4. 荷車: 推奨案（残響 5 色均等 + 解錠条件）で進める。持ち込み枠は固定 2（仮）
5. 1 ランの長さ: **4 章 × 5 階 + 最深の間**（章ごとにマップ面積を段階的に）
