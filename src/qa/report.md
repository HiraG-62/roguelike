# QA シミュレーション結果

生成: 2026-09-23T04:38:00.930Z / 180 runs (30 seed × 6 装備パターン × 60000 ステップ)

## 例外

例外は発生しなかった。

## 不変条件違反（NaN / 壁めり込み / id 重複）

違反なし。

## 指標サマリ（装備パターン別）

| 装備 | 平均到達depth | 死亡率 | 平均kills | 平均best combo | 平均拾得数 | Reaper出現/run | ボス撃破率 | 平均step時間(ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| empty | 2.23 | 100.0% | 63.6 | 28.2 | 4.6 | 0.20 | 11.1% | 0.018 |
| rareLoadout | 7.07 | 56.7% | 392.9 | 78.4 | 35.1 | 0.63 | 43.5% | 0.028 |
| uniqueLoadout | 5.13 | 80.0% | 255.8 | 84.1 | 22.7 | 0.77 | 41.5% | 0.026 |
| dominantLoadout | 5.30 | 73.3% | 266.2 | 70.7 | 24.1 | 0.43 | 42.0% | 0.025 |
| dualLoadout | 5.13 | 76.7% | 263.4 | 55.7 | 26.0 | 0.67 | 43.6% | 0.024 |
| scatterLoadout | 6.63 | 66.7% | 359.6 | 76.1 | 30.6 | 0.53 | 43.1% | 0.029 |

## 共鳴別の到達depth（dominant/dualLoadout は狙った色、装備が固定なので発現共鳴はほぼ固定）

| 共鳴 | n | 平均到達depth | 死亡率 |
| --- | --- | --- | --- |
| dominant | 55 | 5.35 | 74.5% |
| dual | 11 | 5.18 | 72.7% |
| scatter | 29 | 7.55 | 58.6% |
| none | 85 | 4.41 | 82.4% |

## 反転性質の出現率（ラン中に stash に拾った性質のみ。装備パターン別）

| 装備 | 反転数 | 性質総数 | 反転率 |
| --- | --- | --- | --- |
| empty | 0 | 183 | 0.0% |
| rareLoadout | 4 | 1974 | 0.2% |
| uniqueLoadout | 2 | 1220 | 0.2% |
| dominantLoadout | 0 | 1246 | 0.0% |
| dualLoadout | 0 | 1370 | 0.0% |
| scatterLoadout | 0 | 1675 | 0.0% |

全体: 6 / 7668（0.1%）。反転は発見深度 13（`INVERSION_MIN_DEPTH`, src/loot/flux.ts）以降でしか起きないため、bot の到達 depth が浅いランでは観測されにくい。

## 芽（pendingBud）の出現・選択回数

合計 897 回（180 run 中、平均 4.98 回/run）。bot は出た瞬間に 1 枚目を選ぶ。

| 装備 | 平均出現回数/run |
| --- | --- |
| empty | 0.00 |
| rareLoadout | 7.30 |
| uniqueLoadout | 6.43 |
| dominantLoadout | 5.53 |
| dualLoadout | 5.10 |
| scatterLoadout | 5.53 |

## キーストーンあり / なしの生存差（到達depth）

- キーストーンあり (n=98): 平均到達depth 5.63 / 死亡率 72.4%
- キーストーンなし (n=82): 平均到達depth 4.79 / 死亡率 79.3%

## 死因トップ（depth 別・出現数）

| 死因 (depth) | 件数 |
| --- | --- |
| reaper (depth 4) | 13 |
| reaper (depth 7) | 12 |
| reaper (depth 2) | 10 |
| reaper (depth 3) | 8 |
| slime (depth 2) | 8 |
| reaper (depth 5) | 7 |
| boar (depth 2) | 7 |
| reaper (depth 6) | 7 |
| reaper (depth 1) | 6 |
| slime (depth 3) | 4 |

## depth ごとの平均滞在秒（全 run 平均、到達した run のみ）

| depth | 平均滞在秒 | 到達run数 |
| --- | --- | --- |
| 1 | 69.2 | 180 |
| 2 | 75.1 | 169 |
| 3 | 90.5 | 136 |
| 4 | 110.2 | 106 |
| 5 | 96.1 | 83 |
| 6 | 123.9 | 68 |
| 7 | 124.7 | 59 |
| 8 | 106.8 | 44 |
| 9 | 101.5 | 38 |
| 10 | 85.3 | 26 |
| 11 | 78.2 | 15 |
| 12 | 72.9 | 9 |
| 13 | 34.1 | 7 |
| 14 | 62.8 | 3 |
| 15 | 15.1 | 2 |

## レアリティ分布（拾得アイテム、全 run 合計）

| rarity | 個数 | 割合 |
| --- | --- | --- |
| normal | 1237 | 28.8% |
| magic | 2100 | 48.9% |
| rare | 953 | 22.2% |
| unique | 6 | 0.1% |

## バランス所見

- depth 2 での死亡が最多（33 件 / 136 件中）。この階の難度がボトルネックになっている可能性がある。
- 死因として最も多く推測されたのは "reaper"（67 件）。
- 平均到達depth: 素手 2.23 / rare装備 7.07 / unique装備 5.13。
- キーストーン所持時の平均到達depthは非所持時より 0.84 高い（正なら強化、負ならリスクが上回っている）。
- 1 ステップの平均処理時間は 0.025ms（60fps 予算 16.6ms に対し余裕あり）。
- 平均到達depth（色配合）: 単色寄せ 5.30 / 2色 5.13 / 5色散光 6.63。

## 提案

1. depth 2 前後の敵密度・HPスケーリング（enemiesPerDepth / depthHpScale）を見直し、難度の急上昇を緩和する。
2. 死因トップの敵（reaper）の windup 時間や被弾判定の猶予を見直し、回避余地を増やす。
3. rare / unique 装備の有無で到達depthに大きな差が出ていない場合、レアアフィックスの倍率調整でビルドの手応えを強める。
4. キーストーンつき装備が事故死を増やしている場合は、リスクに見合ったリターン（回復・被ダメ軽減の代替経路）を補強する。
5. Reaper 出現後に倒しきれず時間切れで死ぬケースが目立つ場合は、warnAfter / appearAfter の猶予時間を調整する。

## 付録: 再現コマンド

```
# 縮小版 + 決定性スモーク（CI 用、5 seed × 20,000 step ＋ fingerprint 一致確認、30 秒未満）
npx vitest run src/qa/simulation.test.ts

# フル版（30 seed × 6 装備パターン × 60,000 step、このレポートの元データ）
npm run qa:full
```

`npm run qa:full`（`scripts/qa-full.mjs`）が `SIM_FULL=1` を付けて vitest を実行し、
`<<<QA_REPORT_START>>>` 〜 `<<<QA_REPORT_END>>>` の間の出力をこのファイルにそのまま書き出す
（`--no-write` を付けると書き出さずコンソール出力だけになる）。

## 調査メモ（引き継ぎ）

前回版（装備コア再設計前、コミット e52bcde 時点の QA）で見つけ、まだ src/system 側で
未修正のため今回も有効な既知の問題。今回の 180 run では `anyEnemyInWall`
（`src/qa/simulation.test.ts`）が実際の壁タイルだけを見る判定のため検出されていないが、
根本原因のコード（`src/system/physics.ts` の `isSolidTile` / `src/system/floor.ts` の
`lockRoom`）は前回から変わっていない。

### ドアタイル上でロックされた敵が「壁の中」判定になる（軽微な不整合、要確認）

- **再現条件**: 敵が部屋の**ドアタイル**の上に立っている瞬間に、プレイヤーが部屋の内側に
  入って `lockRoom`（`src/system/floor.ts`）が呼ばれる。ロックによりそのドアタイルが
  `state.lockedTiles` に追加される。
- **原因**: `isSolidTile`（`src/system/physics.ts:8`）は「壁タイル (`Tile.Wall`)」と
  「ロック中のタイル」を区別せずどちらも solid 扱いにするため、たまたまドアタイル上にいた
  敵はその瞬間から `overlapsWall` 的には壁に埋まった扱いになる。プレイヤー側は
  `enterMargin` / `ENTER_PROBES`（`insideRoom`）でドアを跨いでいる間はロックされない配慮が
  あるが、敵の側には同様の配慮がなく、この非対称性がそのまま残っている。
- **前回の固定再現手順**（seed / 装備パターン / step は generator 側の生成ロジックに依存し、
  今回の再設計で装備・アイテム生成が変わったため、まだ同じ seed で再現するかは未検証。
  再現手順の型として記録しておく）:
  - seed=50000, uniqueLoadout, ステップ 27431（tick=25329, depth=5）: `knight`
    （id=2865, elite="hasted", phase="windup", roomIndex=4）がドアタイル上で発生。
  - seed=50001, rareLoadout, ステップ 38478（tick=35485, depth=7）: `boar`
    （phase="chase"）がドアタイル上で発生。
- **影響の推測**: 見た目のグラフィック破綻や即死は未確認。`moveEnemy`/`moveBody` は移動先
  候補だけを `overlapsWall` で判定するため、この状態になった敵がその後そのタイル付近に
  留まろうとする移動（`separate` によるノックバック等）を試みた場合に動けなくなる可能性が
  残っている。
- **担当**: `src/system/physics.ts`（`isSolidTile` の solid 判定を壁とロックで分けるか）、
  もしくは `src/system/floor.ts`（`lockRoom` 時にドアタイル上の敵を室内側へ押し出すか、
  敵にもプレイヤー同様の猶予を与えるか）。バグとして扱うか仕様内許容とするかはチーム判断。
