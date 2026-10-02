# レシピ: 敵

0. 数値（HP・速度・予告・怯み耐性・防御など）は `src/data/balance/enemies/` の `stats/<key>.json` / `combat/<key>.json` / `defense/enemies/<key>.json` を足して `npm run balance:gen`（無いと `...N.key` で tsc が落ちる）。項目の意味は各ディレクトリの `_index.json` の `_fields` を読む。新しい項目を足したら `_fields` にも 1 行
1. `src/data/enemies.ts`: `EnemyBehavior` に追加（既存 behavior の流用なら不要）、`ENEMIES` に `EnemyDef`（`name` は日本語、`minDepth` / `weight` / `windup` はテレグラフが読める長さ）。既存の敵の色替え + 挙動 1 つの追加なら新規 behavior を作らず `EnemyDef.recolor`（元のスプライトと behavior を流用し、色と 1 挙動だけ差し替える）。`data/enemyDefense.ts` の `ENEMY_ATTACK` と `data/enemyCombat.ts` にも 1 行（無いと起動時に例外）。商人・壺のような置物は `EnemyDef.merchant` / `container` を付けて図鑑・陣の計測・気付き・撃破数から外す
2. `src/system/behaviors/`: `families.ts` に家族（`Rusher` / `Charger` / `Keeper` / `Flyer` / `Stationary` / `BossDriven`）を継いだクラスを 1 つ書き、`registry.ts` の `BEHAVIORS` に登録（`Record<EnemyBehavior, …>` なので漏れは型エラー）。既存の家族で足りるなら家族をそのまま登録。クラスは状態を持たない（凍結される。作業領域は `e.ai`）。予告・出だし・持続・終わりなど段の中身は移行中のため `src/system/enemies.ts` の behavior の分岐に書く（`docs/ideas/oop-migration.md`）。AI の数値は tuning の `ENEMY_AI`。個別 behavior の処理は `enemyBehaviors.ts`、死骸・取り巻き・気力奪取などの横断的な仕組みは `enemyTraits.ts`
   - **章で覚える技**: 連撃・離脱・後退射撃を深度で覚えさせるなら `src/data/balance/enemies/ENEMY_TEMPO.json` の `depthStages.<敵の key>` に段を 1 つ（`{ minDepth, followUp?, retreatMul?, windupMoveMul? }`。`system/enemyStages.ts`）。連撃の続きの予備動作は最初からコミット（怯まない）
   - **役割と反応**: 新しい behavior は `src/data/enemyRoles.ts` の `ROLE_BY_BEHAVIOR` に役割を 1 行（`Record` なので漏れは型エラー）。表と違う敵だけ `EnemyDef.role`。反応ルールの 3 フック（`onStruck` 間合い取り / `attackCooldownRate` 隙を狙う / `slotTarget` 囲む。既定は `system/enemyReactions.ts`）は全 behavior が既定で受ける。受けない敵は `Stationary` / `BossDriven` と同じく 3 つを無効化する。陣形のスロットに入れたいなら役割が合うか確かめる（`docs/recipes/formation.md`）
3. `src/data/sprites.ts`: `SPRITES[def.sprite]` を追加（下記スプライト）。`render/sprites.test.ts` が全敵のスプライト存在を検査する
4. 必要なら `render/renderer.ts` に専用の予告表現、`audio` に効果音
5. テスト: `system/enemies.test.ts` に「windup → strike で当たる」「予告中は無害」など

## ボス（階層ボス。`boss: true`）を足す・作り直す

共通の器は `system/bossKit.ts`（設計 `docs/ideas/boss-impl.md`、数値は `balance/enemies/BOSS/<key>.json` と共通の `src/data/balance/enemies/BOSS/rules.json`）。状態機械（chase → windup → strike → recover）は `runBossCycle` が回し、技の中身はボスごとのファイルが `BossHooks` で渡す。behavior は `BossDriven` 家族（`registry.ts`）、ボスごとの更新は `boss.ts` の `updateBossEnemy` の分岐から `bossXxx.ts` へ。

- **技の選び方**: `BossHooks.pickMove(state, e, read)` で `PlayerRead`（距離帯 near / mid / far・静止秒・直前のダッシュ・背面・足元の地形）から枝分かれする。**乱数を引かない**（同じ状況なら同じ技。`ai.counter` の偶奇や表の順で巡らせる）。読みの閾値は `BOSS.rules`。深みの回転のボス（骸骨卿・双子・霜の巨人・群れの母・司書）は `sequence`（段階ごとの並びの巡回）のまま。`pickMove` があればそちらが優先
- **連撃と離脱**: `followUp(state, e, done)` が次の技を返すと硬直を挟まず続く。続きの予備動作は `chainWindupMul` 倍で**最初からコミット**（`e.chainWindup`。怯まない）。硬直の間に離れるなら `recoverRetreatMul`、硬直の長さを変えるなら `recoverTime`
- **見えるダウン（隙）**: 自傷の怯み（壁激突・引火・呑み込みの後・模写の後の反動など）は `bossDown(state, e, time, text, color)` を通す。浮き文字は体言止め。**HP 以外で進む段階**（追い詰めのダウン・引火・壁激突・門柱・分裂体の全滅）は `ai.progress` で数える。取り巻きを倒すとボスに怯み値が入る（`BOSS.rules.minionPoiseRatio`。`bossRecord.ts` の `noteBossMinionDeath`。卵・地雷・置物は除く）
- **危ない間合い**: 章ボス 4 と最深の主は段階 3 つぶんを `BOSS_THREATS`（`bossKit.ts`。`near` / `far` / `moving` / `still`）に 1 行。**隣り合う段階は違うものにする**（`bossKit.test.ts` が検査。図鑑の予告の図解にも出る）
- **署名の技**: 章ボスは段階 1 の代表の技を `XXX_SIGNATURE`（`signatureOf(key, move, hooks)`）で export する。最深の主の第三の顔がそのランで被弾の多かった章ボス 2 体の署名を借りる（`state.bossLog`）。章ボスを足すなら署名も足し、予備動作で予告を出す（`bossKit.test.ts`）
- **固有の報酬**: `system/bossRewards.ts` の `BOSS_REWARD_KIND[key]`（`flask` / `purse` / `rune` / `stone` / `named`）に 1 行、量は `BOSS.rules.rewards`。持たないボス（深みの回転の 5 体）はレア 2 だけ
- **撃破の後始末**: `boss.ts` の `onBossDeath` が記録（`pushBossRecord` → `state.bossLog`）と報酬を出す。ボスが部屋に残した柵・地雷・写し身と姿見・門柱・崩れる床の予約は、残ると封鎖が解けず階段へ歩けないので、`onBossDeath` から呼ぶ後始末（`settleThiefKingRoom` / `settleMirrorKnightRoom` / `settleDeepLordRoom`）で消す。借りた技が置いた物（盗賊王の地雷）も対象
- **予告の図解**: 新しい敵でも `system/telegraphDiagram.ts` が敵データ（予告の形・`windup` / `strikeTime` / `recover`）から自動で導く。手書きの表は持たない。ボスは `BOSS_THREATS` の段階ごとの間合いも出る
- **予告の形と色**: 新しい敵の予告は `system/threat.ts` の `threatShapes` が持つ形（線・光線・十字・輪・扇・折れ線）から選ぶ。新しい形を足すなら `threat.ts`（形と `threatensPlayer`）と `render/telegraphLayer.ts`（筆）の両方。色は「黄 = 下絵（まだ止められる）/ 赤 = 墨入れ（必ず来る）」の 2 つだけで、敵の色・粒・印が横取りしない（`data/signs.ts` の符号表と `signs.test.ts`）。予備動作の唸り `enemyWindup` は精鋭とボスだけ（並の敵は `audio/narimono.ts` が止める）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
