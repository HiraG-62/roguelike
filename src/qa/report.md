# QA シミュレーション結果

生成: 2026-09-23T05:00:53.764Z / 180 runs (30 seed × 6 装備パターン × 60000 ステップ)

## 例外

例外は発生しなかった。

## 不変条件違反（NaN / 壁めり込み / id 重複）

| seed | profile | NaN | 壁めり込み | id重複 |
| --- | --- | --- | --- | --- |
| 50020 | rareLoadout | false | true | false |
| 50025 | rareLoadout | false | true | false |
| 50028 | dualLoadout | false | true | false |

## 指標サマリ（装備パターン別）

| 装備 | 平均到達depth | 死亡率 | 平均kills | 平均best combo | 平均拾得数 | Reaper出現/run | ボス撃破率 | 平均step時間(ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| empty | 2.23 | 100.0% | 63.6 | 28.2 | 4.6 | 0.20 | 11.1% | 0.019 |
| rareLoadout | 6.40 | 70.0% | 342.9 | 67.7 | 31.1 | 0.70 | 44.5% | 0.028 |
| uniqueLoadout | 5.17 | 76.7% | 274.7 | 79.4 | 24.4 | 0.83 | 44.9% | 0.026 |
| dominantLoadout | 5.37 | 70.0% | 271.7 | 66.8 | 25.8 | 0.40 | 43.3% | 0.024 |
| dualLoadout | 6.00 | 63.3% | 328.4 | 64.6 | 33.0 | 0.50 | 43.9% | 0.027 |
| scatterLoadout | 6.43 | 76.7% | 354.6 | 73.8 | 31.4 | 0.57 | 44.4% | 0.026 |

## 共鳴別の到達depth（dominant/dualLoadout は狙った色、装備が固定なので発現共鳴はほぼ固定）

| 共鳴 | n | 平均到達depth | 死亡率 |
| --- | --- | --- | --- |
| dominant | 53 | 5.83 | 66.0% |
| dual | 13 | 5.38 | 69.2% |
| scatter | 29 | 6.31 | 72.4% |
| none | 85 | 4.54 | 84.7% |

## 反転性質の出現率（ラン中に stash に拾った性質のみ。装備パターン別）

| 装備 | 反転数 | 性質総数 | 反転率 |
| --- | --- | --- | --- |
| empty | 0 | 183 | 0.0% |
| rareLoadout | 0 | 1698 | 0.0% |
| uniqueLoadout | 0 | 1275 | 0.0% |
| dominantLoadout | 0 | 1362 | 0.0% |
| dualLoadout | 0 | 1831 | 0.0% |
| scatterLoadout | 0 | 1708 | 0.0% |

全体: 0 / 8057（0.0%）。反転は発見深度 13（`INVERSION_MIN_DEPTH`, src/loot/flux.ts）以降でしか起きないため、bot の到達 depth が浅いランでは観測されにくい。

## 芽（pendingBud）の出現・選択回数

合計 909 回（180 run 中、平均 5.05 回/run）。bot は出た瞬間に 1 枚目を選ぶ。

| 装備 | 平均出現回数/run |
| --- | --- |
| empty | 0.00 |
| rareLoadout | 7.23 |
| uniqueLoadout | 6.27 |
| dominantLoadout | 5.80 |
| dualLoadout | 5.40 |
| scatterLoadout | 5.60 |

## キーストーンあり / なしの生存差（到達depth）

- キーストーンあり (n=98): 平均到達depth 5.56 / 死亡率 76.5%
- キーストーンなし (n=82): 平均到達depth 4.91 / 死亡率 75.6%

## 死因トップ（depth 別・出現数）

| 死因 (depth) | 件数 |
| --- | --- |
| reaper (depth 4) | 20 |
| reaper (depth 2) | 10 |
| reaper (depth 7) | 9 |
| slime (depth 2) | 8 |
| boar (depth 2) | 8 |
| reaper (depth 3) | 7 |
| reaper (depth 5) | 5 |
| reaper (depth 1) | 5 |
| slime (depth 3) | 4 |
| eye (depth 3) | 4 |

## depth ごとの平均滞在秒（全 run 平均、到達した run のみ）

| depth | 平均滞在秒 | 到達run数 |
| --- | --- | --- |
| 1 | 69.6 | 180 |
| 2 | 73.6 | 171 |
| 3 | 90.8 | 138 |
| 4 | 113.4 | 108 |
| 5 | 105.7 | 80 |
| 6 | 114.6 | 70 |
| 7 | 115.1 | 66 |
| 8 | 112.4 | 53 |
| 9 | 102.1 | 40 |
| 10 | 91.1 | 25 |
| 11 | 78.8 | 12 |
| 12 | 66.3 | 3 |
| 13 | 123.6 | 1 |
| 14 | 195.2 | 1 |

## レアリティ分布（拾得アイテム、全 run 合計）

| rarity | 個数 | 割合 |
| --- | --- | --- |
| normal | 1307 | 29.0% |
| magic | 2202 | 48.8% |
| rare | 1001 | 22.2% |
| unique | 0 | 0.0% |

## バランス所見

- depth 2 での死亡が最多（33 件 / 137 件中）。この階の難度がボトルネックになっている可能性がある。
- 死因として最も多く推測されたのは "reaper"（68 件）。
- 平均到達depth: 素手 2.23 / rare装備 6.40 / unique装備 5.17。
- キーストーン所持時の平均到達depthは非所持時より 0.65 高い（正なら強化、負ならリスクが上回っている）。
- 1 ステップの平均処理時間は 0.025ms（60fps 予算 16.6ms に対し余裕あり）。
- 平均到達depth（色配合）: 単色寄せ 5.37 / 2色 6.00 / 5色散光 6.43。

## 提案

1. depth 2 前後の敵密度・HPスケーリング（enemiesPerDepth / depthHpScale）を見直し、難度の急上昇を緩和する。
2. 死因トップの敵（reaper）の windup 時間や被弾判定の猶予を見直し、回避余地を増やす。
3. rare / unique 装備の有無で到達depthに大きな差が出ていない場合、レアアフィックスの倍率調整でビルドの手応えを強める。
4. キーストーンつき装備が事故死を増やしている場合は、リスクに見合ったリターン（回復・被ダメ軽減の代替経路）を補強する。
5. Reaper 出現後に倒しきれず時間切れで死ぬケースが目立つ場合は、warnAfter / appearAfter の猶予時間を調整する。

## 調査メモ（引き継ぎ）

### ドアタイル上でロックされた敵が「壁の中」判定になる（未解消、再現手順を更新）

- **状況**: `src/qa/simulation.test.ts` の `anyEnemyInWall` を、実際の壁タイルのみを見る
  簡易判定から `overlapsWall`（`src/system/physics.ts`、lockedTiles 込み＝本番の移動判定と
  同じ幾何）に戻して今回のフル版 QA（180 run）を実行した結果、**3 件の壁めり込みが検出された**
  （`npm run qa:full` は fail しないが、上の不変条件違反テーブルに記録済み）。判定はこのまま
  `overlapsWall` に戻した状態で残す（`git diff` は `src/qa/simulation.test.ts` の
  `anyEnemyInWall` 定義のみ）。
- **今回のフル版で捕捉した再現ケース**（`process.env.QA_DEBUG_WALL` を使った一時ログで
  seed/tick/depth/敵種を特定。ログ自体はコミットしていない一時コードで、恒久化はしていない）:
  - seed=50020, rareLoadout, step=39757, tick(state.time)=594, depth=6:
    `bat`（phase="strike"）が pos=(257.9, 262.2) で壁判定。
  - seed=50025, rareLoadout, step=41500, tick=634, depth=7:
    `eye`（phase="chase"）が pos=(579.2, 269.8) で壁判定。
  - seed=50028, dualLoadout, step=19154, tick=296, depth=4:
    `knight`（phase="recover"）が pos=(199.1, 634.4) で壁判定。
  - 敵種・フェーズがばらばらな点から、特定の敵ロジックのバグではなく、report.md 旧付録が
    指摘していた `isSolidTile`（`src/system/physics.ts`）とドアロック（`lockRoom`,
    `src/system/floor.ts`）側の非対称（プレイヤーには `insideRoom` の enterMargin /
    ENTER_PROBES による猶予があるが、敵にはない）が原因である可能性が高い。今回の扉タイル
    判定の幾何統一（コミット ca749f0）はこの非対称そのものは直していないと見られる。
- **担当**: `src/system/floor.ts`（`lockRoom` 時にドアタイル上の敵へ猶予を与える／室内側へ
  押し出す）または `src/system/physics.ts`（`isSolidTile` の壁とロックの扱いを分ける）。
  発生頻度は 180 run 中 3 件（1.7%）と低頻度で、見た目の破綻や即死は今回も未確認。バグとして
  直すか仕様内許容とするかはチーム判断。
- **前回版にあった固定 seed 再現手順**（装備コア再設計前のコミット時点、seed=50000
  uniqueLoadout / seed=50001 rareLoadout）は今回のフル版では再現しなかった（アイテム生成・
  bot 挙動の変化で経路がずれたとみられる）。上記 3 件を新しい再現手順として置き換える。
