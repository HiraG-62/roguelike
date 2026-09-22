# ブラウザアクションローグライク 企画メモ（引き継ぎ用）

作成日: 2026-09-23（同日にターン制からリアルタイムアクションへ方針転換）
目的: 趣味開発。「機能を足し続けて遊べる」ことを最優先にする。

## コンセプト

- ブラウザで動く **リアルタイム・トップダウンアクション**（Hades / Nuclear Throne 系）
- 常にキーを叩いていたい人向け。移動・回避・攻撃は全部手動、オート攻撃はやらない（ヴァンサバ系は不採用）
- 「見て・避けて・殴る」の高速反復。敵は予備動作（テレグラフ）を出してから攻撃する
- 刺激: ヒットストップ、画面揺れ、コンボカウンター、ジャスト回避のスローモーション、部屋ロック→全滅→解放
- ローグライク要素: ランダム生成フロア、パーマデス、シード再現、深さで敵が凶暴に
- 見た目はドット絵。素材はコード内ピクセルマップから生成し、後でスプライトシートに差し替え可能

## 操作

| キー | 動作 |
| --- | --- |
| WASD / 矢印 | 8 方向移動 |
| マウス | 照準。攻撃・射撃・（移動入力なしの）ダッシュはカーソル方向 |
| 左クリック / E | 近接 3 段コンボ（3 段目は大ダメージ + スタガー）。敵弾も斬れる |
| 右クリック / Q | 射撃（押しっぱなしで連射） |
| Space / Shift | ダッシュ（無敵、攻撃キャンセル可、壁に当たると即終了） |
| F | バースト（必殺ゲージ満タン時、周囲に大ダメージ） |

右手はマウス前提なので、キーボード側の操作は全部左手で届く位置に置く（J/K/L などは使わない）。
| R | 新シードで再開 / Enter | 死亡後に同シードで再挑戦 |

ダッシュ中に攻撃が当たると **JUST!**（スローモーション + ゲージ増）。

## 技術スタック（決定事項）

- TypeScript + Vite、ランタイム依存ライブラリなし（描画は Canvas 2D、内部解像度 480x270 を整数倍拡大）
- 固定タイムステップ 60Hz（`core/loop.ts`）。ゲームロジックは `FrameInput` と `dt` だけを見る → 同じ seed + 同じ入力列で決定的（リプレイ可能）
- 乱数は mulberry32（`core/rng.ts`）。`Math.random` は使わない
- テストは Vitest。物理・戦闘・部屋ロック・決定性・スモーク
- ディレクトリ
  ```
  src/
    core/     loop, input, state(型), game(createGame/step), rng, vec
    map/      grid（1 次元配列）, generator（部屋 + 2 幅通路）
    system/   player, enemies, projectiles, combat, floor(部屋ロック/階段), physics, camera, effects
    render/   renderer(Canvas), sprites(ピクセルマップ→オフスクリーン)
    data/     tuning(手触り定数), enemies, sprites
  ```
- 手触りの数値は全部 `src/data/tuning.ts`。迷ったらここをいじる

## 現状（2026-09-23 深夜時点）

### 操作の追加分
| キー | 動作 |
| --- | --- |
| 1 / C / マウス戻る | スキルスロット 1 |
| 2 / V / マウス進む | スキルスロット 2 |
| Tab / I | 閉 → 装備 → スキル → クラフト → 閉 のサイクル |
| Esc | ポーズメニュー（Resume / Settings / Restart / Title） |
| タイトルで N / H / O | シード入力 / ラン履歴 / 設定 |

### 戦闘
- 敵 9 種: slime / eye / boar / knight（正面ブロック、カウンターで割れる）/ bomber（爆弾設置）/ laserEye（チャージ → レーザー）/ golem（衝撃波リング）/ bat（群れ）/ wisp（壁抜け・死亡爆発）
- エリート修飾子 5 種（Explosive / Reflective / Shielded / Hasted / Linked）。depth 2 以降
- ボス: King Slime（depth 3, 9…）/ Bone Lord（depth 6, 12…）。撃破で階段 + rare 以上 2 個
- Reaper: 同じ階に 90 秒いると出現する無敵の追跡者
- 手触り: カウンターヒット（windup 中に殴る）/ ラストキル・スロー / リゲイン（被弾後 3 秒以内の近接で HP を取り戻す）/ JUST 回避カウンター（回避直後の攻撃で瞬間移動斬り）/ 弾返し（近接で敵弾を反射）/ 壁叩きつけ / ダッシュ攻撃

### フロア・部屋
- フロア種別: rooms（既定・ボス階）/ cave（depth 4, 7, 10…、セルオートマトン）/ dark（depth 4 以降 25%、視界半径 90px）
- 部屋の種類: normal / treasure（敵なし・アイテム 2〜3）/ challenge（3 波）/ shrine（泉で全回復、代わりに次の部屋が呪われる）/ ambush（入ると 2 倍湧き）
- ミニマップ（右上、探索済みのみ）

### ハクスラ装備（docs/LOOT_DESIGN.md）
- 6 スロット、ベース 27、固定アフィックス 48（トレードオフ付き 10）、ユニーク 5、キーストーン 10（相互排他グループ）、トリガー文法（trigger × condition × effect ≒ 424 通り × 数値ロール）、変換アフィックス
- 拾った瞬間に localStorage（`roguelike.profile.v1`）へ永続化。死んでも失わない。stash 上限 400
- ソフトキャップ（+100% 超は sqrt 圧縮、キーストーンは対象外）、armor は逓減式、on-hit 効果は敵ごとに 0.2 秒 ICD
- クラフト（通貨 dust / shard / essence / relic。Reforge / Augment / Annul / Corrupt / Fuse）: 別キー `roguelike.craft.v1`
- 「ゴール装備を作らない」哲学: 単一指標（DPS 等）は UI に出さない

### スキル（docs/ideas/skills.md）
- スキル石 6 種（旋風斬り / 突進斬り / グレネード / 撃ち抜き / パリィ / 血の契約）、変異軸とリンク数のみロール、永続（`roguelike.skills.v1`）
- 刻印符 4 種（多重 / 血の代償 / コンボ燃料 / 反響）はラン内限り。部屋クリア時 30% で落ち、装着中スキルに自動で刺さる

### メタ
- タイトル画面（統計・操作一覧・シード入力）、ラン履歴 20 件、設定（ミュート / 音量 / 画面揺れ）、死亡画面の集計
- 効果音は Web Audio で合成（外部素材なし）。ドット絵もコード内ピクセルマップ（`src/data/sprites.ts`）

### 開発の進め方（この夜のやり方）
- 実装・テスト・レビューは Sonnet / Opus のサブエージェントに委任し、メインは設計・分割・統合・コミットに徹する
- ファイル所有を分けて並列実行、共有ファイル（state.ts / game.ts）は最小 Edit のみ
- ブレスト結果は docs/ideas/*.md（action-feel / build-diversity / run-structure / skills）
- 自動プレイ QA は src/qa/（`SIM_FULL=1` でフル実行）、レポートは src/qa/report.md

## 次にやる候補
- ブラウザで実プレイして tuning.ts を調整（この夜の実装はテストとビルドのみ通っている状態）
- docs/ideas/*.md の未実装案（祝福 3 択、フォーム差し替え、ペット/刻印、デイリーシード、リプレイ）
- 本物のスプライトシートへの差し替え、ゲームパッド対応

## 経緯

- `turn-based-v0` タグ: 最初に作ったターン制ローグライク（Phase 1 完了状態）。参考用に残す

## 参考にするもの

- Hades / Nuclear Throne / Enter the Gungeon / Hyper Light Drifter の手触り
- RogueBasin（生成アルゴリズム）: https://www.roguebasin.com/
- Red Blob Games（経路探索など）: https://www.redblobgames.com/
