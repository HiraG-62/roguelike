# ハクスラ装備システム 設計メモ

目的: ローグライク（ランごとのランダムフロア・パーマデス）に、PoE 風の **永続する装備ドロップ** を融合する。
「同じアイテムが 2 つ出る方が珍しい」レベルの無限バリエーションを目指す。

## 設計哲学: 「ゴール装備」を作らない

ハクスラやモンハンにある「これを作れば最強」というテンプレ（BiS）を潰す。各プレイヤーが自分だけの最強を追い、しかもそれらに優劣が付かない状態を目指す。そのための仕組み:

1. **トレードオフ**: 強いアフィックスほど代償を持つ（例: +melee damage / -attack speed、+projectiles / -damage per projectile）。純粋な上位互換を作らない
2. **逓減（ソフトキャップ）**: 同じ数値を積むほど伸びが鈍る（`computeStats` で +100% を超えた分は sqrt 圧縮など）。1 種類を盛るより組み合わせる方が強い
3. **キーストーン**: 遊び方そのものを変える大型改造（例: Glass Cannon = ダメージ 2 倍 / 最大 HP 1、Berserker = 失った HP に比例して攻撃力、Blink = ダッシュがテレポート化して着地で爆発するが無敵なし、Pacifist = 近接不可 / 射撃 3 倍）。相互排他グループがあり、同時に成立しない組み合わせがある
4. **トリガー文法**: `trigger × condition × effect` の組み合わせでアフィックスを生成する（例: "JUST 回避時 → 次の 3 ヒットが燃える"、"コンボ 10 以上のとき → 5 ヒットごとに衝撃波"）。固定リストではなく文法なので組み合わせは事実上無限
5. **シナジーの網**: 元素・コンボ・ダッシュ・射撃・近接がタグで相互作用し（burn は attack speed で伸びる、chill は shatter を可能にする、shock は弾数で連鎖が増える…）、局所最適が無数にある
6. **比較不能な多次元**: アイテムスコアや DPS 数値を UI に出さない。ツールチップは「何ができるか」を語る

## 原則

- アイテムは **ランを跨いで永続**。拾った瞬間に stash（localStorage）へ保存される。死んでも失わない
- 装備は次のランの開始時に `computeStats(equipment)` で `PlayerStats` に畳み込まれ、ゲームロジックはその数値だけを見る
- 生成は **純関数 + seedable RNG**。同じ seed / itemLevel なら同じアイテム（テスト・再現用）
- データ駆動: アフィックスとベースアイテムは `src/loot/affixes.ts` / `src/loot/bases.ts` に列挙し、追加が容易であること
- 型は `src/loot/types.ts` に集約（これは決定済み。変更する場合は理由をコメントに残す）

## スロット（6）

| slot | ベース例 | 役割 |
| --- | --- | --- |
| weapon | dagger / shortsword / longsword / greatsword / spear | 近接の基礎ダメージ・速度・リーチ |
| gun | pistol / smg / rifle / shotgun | 射撃の基礎ダメージ・連射・弾数・貫通 |
| armor | cloth / leather / chain / plate | HP・アーマー・被ダメ軽減 |
| boots | sandals / boots / greaves | 移動速度・ダッシュ |
| ring | ring 系 | 何でも（クリティカル、元素、吸血…） |
| amulet | amulet 系 | 何でも（ユーティリティ寄り） |

ベースは `implicit`（固定の暗黙補正 + ロール幅）を持つ。例: greatsword は melee +40% / attack speed -25% / reach +20%。

## レアリティ

| rarity | アフィックス数 | 色 |
| --- | --- | --- |
| normal | 0 | 白 `#e0e0e0` |
| magic | 1〜2（prefix 1 + suffix 1 まで） | 青 `#6a8cff` |
| rare | 3〜6（prefix 3 + suffix 3 まで） | 黄 `#ffd75f` |
| unique | 固定セット（各値はロール） | 橙 `#ff9040` |

出現重み（itemLevel で rare/unique 側が伸びる）: normal 55 / magic 32 / rare 12 / unique 1 を基準。

## アフィックス

- `prefix` / `suffix` の区別（PoE 準拠）。同じ key は 1 アイテムに 1 つまで
- 各アフィックスは **tier 配列** を持つ（T1 が最上位）。tier ごとに `minLevel` と `[min, max]` のロール幅
- itemLevel が高いほど高 tier が抽選対象に入り、重みは低 tier 側が重い（高 tier は珍しい）
- `slots` で装備可能スロットを制限。`tags`（damage / life / speed / elemental / utility …）で将来のクラフト用
- `apply(stats, value)` で `PlayerStats` に加算する（`stats.ts` の `computeStats` が全アフィックスを畳み込む）

### 最低限そろえるアフィックス（30 種以上を目標）

- 近接: melee damage %, melee flat, attack speed %, reach %, knockback %, damage vs staggered %
- 射撃: ranged damage %, ranged flat, fire rate %, +projectiles, +pierce, projectile speed %
- 生存: max HP flat, max HP %, HP regen, life on hit, life on kill, armor flat, damage taken %
- 機動: move speed %, dash cooldown %, +dash charge, dash distance %
- クリティカル: crit chance, crit multiplier
- 必殺: energy gain %, burst damage %, burst radius %
- コンボ: combo window +s, damage per combo stack %（上限あり）, JUST 後ダメージ %
- 元素 / on-hit: burn chance + dps, chill chance + slow, shock chance + chain damage, explode on kill, thorns

## ネーミング

- normal: ベース名（"Longsword"）
- magic: "{Prefix名} {Base}" / "{Base} of {Suffix名}" / 両方
- rare: 2 語の生成名（"Storm Fang", "Dusk Whisper" …）+ ベース名を小さく表示
- unique: 固有名

## PlayerStats（派生値）

`types.ts` の `PlayerStats` と `DEFAULT_STATS` を参照。ゲームロジック側は **必ず** `state.stats` を通して読む。
`tuning.ts` の基礎値 × stats の倍率、という形にする（例: `PLAYER.speed * stats.moveSpeedMul`）。

## ドロップ

- 敵撃破: 基本 8%（boar 25%）。深さで微増
- 部屋クリア: 必ず 1 個。階層到達ボーナスで rarity 抽選が上振れ
- itemLevel = depth + rng(0..2)
- 床のアイテムはレアリティ色の光柱 + 名前ラベル。触れると即 stash へ（ログとフローティングテキスト）

## UI

- Tab で装備画面（ゲームは一時停止）。左: 6 スロット、右: stash 一覧（新しい順、ホイールでスクロール）
- ホバーでツールチップ（レアリティ色の名前、ベース、implicit、アフィックス一覧、tier 表示）
- 左クリック: stash → 装備（入れ替え）、装備 → stash に戻す。Shift + 左クリック: 分解（削除）
- 装備変更で `computeStats` を再計算し、即プレイヤーへ反映（maxHp 変化時は現在 HP の割合を維持）
- 変更のたびに localStorage へ保存。key: `roguelike.profile.v1`

## 将来（今回は作らない）

- 通貨とクラフト（アフィックス付け替え、リロール）
- ユニークの固有効果（スキル変化）、セット装備
- 敵の耐性、元素の相互作用
- 装備のグラフィック反映
