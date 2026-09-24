# バランス調整ガイド

調整したい数値はすべて `src/data/balance/*.json` にある。JSON を書き換えて保存すれば反映される（`npm run dev` 中は自動で再読み込み）。

| ファイル | 中身 |
| --- | --- |
| `weapons.json` | 武器種 19 種の段ごとの振りの速さ（windup / active / recover 秒）・威力・怯み値、右クリックの固有技、射撃の型、剣の基本 3 段、ダッシュ攻撃 |
| `jobs.json` | ジョブの共通数値、ジョブごとのステータスの偏りと弱点 |
| `enemies.json` | 敵 104 体の HP・速度・予告・怯み耐性・防御・耐性、精鋭・ボス・死神 |
| `skills.json` | スキルのコスト・威力・再使用時間、刻印符、連携、変身、使い込み |
| `boons.json` | 祝福の数値 |
| `loot.json` | ドロップ率、共鳴、誓約、トリガー、性質の期待値曲線、ベースの出現深度 |
| `combat.json` | 気力、回復、状態異常、ステータス、怯み、攻撃ジャンル、属性、地形 |
| `world.json` | フロア、部屋、洞窟、徘徊、ランイベント、起点、契約者、縛り、拠点 |
| `feel.json` | ヒットストップ・揺れなどの手触り、演出、ミニマップ、音楽、効果音 |

各ブロックの `_note` に「なぜこの値か」と単位が書いてある。設計の詳細は `docs/ideas/data-externalization.md`。

## 数値の変え方

全部 `src/data/balance/*.json` を直接編集する。保存すると Vite が自動で再読み込みする（5.1。ラン中はタイトルへ戻る）。`npm run check` は通さなくても `npm run dev` は動くが、変える前に一度 `npm run check` で今の状態がクリーンか確かめておくと、自分の変更で壊れたのか元から壊れていたのか切り分けやすい。

**武器の振りの速さを変える**（例: 大剣の 1 段目を速くする）:
1. `src/data/balance/weapons.json` を開き、`WEAPON.movesets.greatsword.steps` の配列を探す（1 段 1 行）
2. 1 段目の `"windup"`（振りかぶり）・`"active"`（当たり判定が出ている秒数）・`"recover"`（硬直）を小さくする。単位は秒（ファイル先頭の `_note` に凡例）
3. 保存 → dev サーバが再読み込み。3 段目だけ・特定の派生（`branches`）だけ変えたいときも同じ配列の中の該当オブジェクトを探して編集する

**武器の威力を変える**:
- 同じ `steps[i]` の `"scaling"`（`{ "base": 8, "str": 0.9 }` の形）。`base` はステータス基礎値（各 5）のときの威力、`str` などは 1 あたりの伸び。持っているステータス次第で最終ダメージは変わるので、`base` だけ上げると素の威力が、`str` を上げるとそのステータスを伸ばしたときの伸びしろが変わる
- 固有技（右クリック）は `WEAPON.movesets.<武器種>.art` の中（`strike` 技なら `.step.scaling`、`throw` 技なら `.throw.scaling`）

**ジョブのステータスの偏りを変える**:
1. `src/data/balance/jobs.json` の `attributes.<ジョブ名>` を開く（例: `attributes.swordsman`）
2. `str` / `dex` / `vit` / `mnd` / `spi` の数値を書き換える。**合計が 0 になるように**（`system/jobs.test.ts` の「合計 0」テストが崩れを検出する）。弱点（`weakness.<ジョブ名>`）はこの偏りと対になっているので、強くしすぎたら弱点側もセットで見直す

**敵の HP を変える**:
1. `src/data/balance/enemies.json` の `stats.<敵の key>.hp` を書き換える（例: `stats.slime.hp`）。敵の key は `src/data/enemies.ts` の `ENEMIES` 一覧の `key` と同じ（日本語名ではなく英語の key で引く）
2. 怯み耐性（怯みにくさ）を変えたいときは `combat.<敵の key>.poise`、防御・耐性は `defense.enemies.<敵の key>`

**共通の注意**:
- 数値だけを直す分には型は壊れない（`shape.kind` のような形の種類や `key` は文字列の一覧と照合されるので、存在しない値を書くと `npm run check` の vitest で落ちる）
- 変えたら該当のテスト（`npx vitest run src/data/weapons.test.ts` など）と `npm run check` を通す。テストは「数値を変えていないこと」を固定しているものが多いので、意図した数値変更でテストが落ちるのは正常（そのテストの期待値も一緒に直す）
