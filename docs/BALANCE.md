# バランス調整ガイド

調整したい数値はすべて `src/data/balance/` 以下の JSON にある。JSON を書き換えて保存すれば反映される（`npm run dev` 中は自動で再読み込み）。1 ファイルに持つ情報を少なくするため、ブロックごと（大きい表は行ごと）にファイルを分けてある。

| ディレクトリ | 中身 | 探し方の例 |
| --- | --- | --- |
| `weapons/` | 武器種 23 種の段ごとの振りの速さ（windup / active / recover 秒）・威力・怯み値。左の連撃 `steps`、右の連撃 `steps2`（アクション 2。段の種類 `kind` と段の key を持つ配列）、派生 `branches.<派生の key>`、銃のベースごとの弾、剣の基本 3 段（`PLAYER_MELEE.json`）、ダッシュ攻撃（`ACTION_DASH_ATTACK.json`） | 剣 → `weapons/WEAPON/movesets/sword.json`、弾 → `weapons/WEAPON/bullets.json`、項目の意味 → `weapons/WEAPON/_index.json` |
| `jobs/` | ジョブの共通数値（`JOB.json`）、ジョブごとのステータスの偏り（`attributes.json`）と弱点（`weakness.json`） | 剣士の偏り → `jobs/attributes.json` の `swordsman` |
| `enemies/` | 敵 104 体の HP・速度・予告（`stats/<敵の key>.json`）、怯み耐性（`combat/<敵の key>.json`）、防御・耐性（`defense/enemies/<敵の key>.json`。体つき・土地は `defense/bodies.json` / `defense/biomes.json`）、行動（`ENEMY_AI/<行動の key>.json`）、精鋭・ボス（`BOSS/<ボスの key>.json`）・死神 | スライム → `enemies/stats/slime.json` ほか同名 3 ファイル |
| `skills/` | スキルのコスト・威力・再使用時間（`SKILL/<key>.json`、`EXTRA_SKILL_TUNING/<key>.json`、`WAVE2_SKILL_TUNING/<key>.json`、`WAVE3_SKILL_TUNING.json`）、刻印符（`SKILL/modifier.json` と `*_MODIFIER_TUNING.json`）、連携、変身、使い込み | 伝染 → `skills/EXTRA_SKILL_TUNING/contagion.json` |
| `boons/` | 祝福の数値（`BOON.json`） | |
| `loot/` | ドロップ率、共鳴、誓約、トリガー、性質の期待値曲線（`affixCurves/<性質の key>.json`）、ベースの出現深度（`bases.json`） | 堅牢の曲線 → `loot/affixCurves/sturdy.json` |
| `combat/` | 気力、回復、状態異常（`STATUS/`）、ステータス、怯み、攻撃ジャンル、属性、地形、プレイヤーの移動・ダッシュ・生命・射撃の共通値（`PLAYER.json`。近接 3 段は `weapons/PLAYER_MELEE.json`）、アクション手触り（`ACTION.json`。浮き文字の文言は `src/data/actionText.ts`） | 毒 → `combat/STATUS/poison.json` |
| `world/` | フロア、部屋（`ROOM_KIND/`）、洞窟、徘徊、ランイベント（`RUN_EVENT/`）、起点、契約者、縛り、拠点 | |
| `ultimates/` | 奥義の共通値（`ULTIMATE/common.json`。ゲージ消費・無敵・浮き文字の色）と、奥義ごとの数値（`ULTIMATE/defs/<武器種>.json` の `<名前>`。一撃は行為ごとのブロック `nova` / `swing` / `lunge` / `volley` など、持続は `drainPerSec`・`minSec`・倍率・`patch`） | 剣の奥義 → `ultimates/ULTIMATE/defs/sword.json` |
| `feel/` | ヒットストップ・揺れなどの手触り、演出（`EFFECTS/`、攻撃エフェクトの見た目は `FX_ATTACK/`）、ミニマップ、音楽、効果音 | |

## ファイルの配置

JSON のパスがそのまま数値の場所になる。`BALANCE.<ディレクトリ>.<ブロック>…`（コードからの参照経路）の `.` を `/` に置き換えたところにある。

- **1 ディレクトリ = 1 つのオブジェクト**。`<key>.json` はその key の値、`<key>/` は値がさらにディレクトリに分かれたもの
- **`_index.json`**: どのディレクトリにも 1 つある。そのオブジェクト自身の `_note` / `_fields`、ディレクトリに直接置く値（1 行で書ける数値・色・短い配列）、キーの並び `_order` を書く。表の各行（`stats/slime.json` など）の項目の意味は、表のディレクトリの `_index.json` の `_fields` にある
- **分け方の目安**: ファイルが 100 行を超える表は行ごとにファイルへ分ける。オブジェクトと複数行の配列は `<key>.json`、単独の値は `_index.json`
- **組み立て**: `src/data/balance/assembled.gen.ts` がすべての JSON を明示的に import して元の形に戻す（JSON ごとの厳密な型を保つため `import.meta.glob` は使わない）。生成物なので手で直さない。**数値を書き換えるだけなら生成し直さなくてよい**（保存すれば再読み込みされる）
- **ファイル・ディレクトリを足す / 消す / 名前を変える**とき:
  1. JSON を置く（ディレクトリを新しく作るなら `_index.json` に `"_order": []` を書く）
  2. `npm run balance:gen`。`_order` に無い key は末尾へ足され、`assembled.gen.ts` が書き直される。並びを変えたいときは `_order` を手で並べ替えてからもう一度 `npm run balance:gen`
  3. 生成し忘れは `npm run check`（`audit:docs` と `balance.test.ts`）が落とす。キーの並びは `BALANCE_HASH` と敵の一覧などの並びに効くので、既存の key の順は変えない
- 最上位のディレクトリ（`combat` など）を足すときは `src/data/balance/index.ts` の `BALANCE` にも 1 行足す

各ブロックの `_note` に「なぜこの値か」と単位が書いてある。設計の詳細は `docs/ideas/data-externalization.md`。

## 項目の意味を読む / 書く

**読む**: 項目の意味は、同じブロックの先頭にある `_fields` に「項目名 → 説明（意味。単位。目安）」で書いてある。敵のように同じ形の行が並ぶ表では、表の先頭に 1 回だけ書き、行（`slime` など）はそれを引き継ぐ。行の中に `_fields` があれば、その行だけの説明が優先。`swarm.min` のようなドット表記は、行の中の `swarm` の中の `min` を指す。`resist` のようにオブジェクト名だけの説明は、その中の項目全部に効く。

例: スライムの `windup`（`enemies/stats/slime.json` の `windup`）の意味は、`enemies/stats/_index.json` の `_fields.windup` にある。

```json
// enemies/stats/_index.json
{
  "_fields": {
    "windup": "攻撃の予備動作（予告）の秒。長いほど避けやすい（テレグラフ原則）。深度 1 つごとに 1.5% 短くなり、…。目安 0.35〜0.9",
    …
  },
  "_order": ["slime", "eye", …]
}
// enemies/stats/slime.json
{ "radius": 6, "hp": 20, "speed": 55, "contactDamage": 10, "windup": 0.35, … }
```

**書く**: 新しい数値の項目を足したら、そのブロック（表なら表の先頭）の `_fields` にも 1 行足す。説明は「意味。単位（秒 / px / 倍率〔1 = 等倍〕/ 割合〔0..1〕/ %〔表示単位〕）。目安 / 範囲」の順で、用語は `docs/GLOSSARY.md`。推測で書かず、その数値を読む system のコードで効き方を確かめる。「なぜこの値か（QA の履歴）」は `_fields` ではなく `_note` に書く。

- 検査（`src/data/balance/balance.test.ts`）: `_fields` にある項目が JSON に無ければ（名前の打ち間違い・項目を消した）落ちる。説明の無い数値の数は最上位のディレクトリ（`combat` など）ごとに基準値（`UNDOCUMENTED_BASELINE`）以下でなければ落ちる。説明を書き足したら基準値を実測まで下げる（上げない）。`enemies/` の `stats` / `combat` / `defense` と `jobs/` は説明の無い項目 0
- 雛形: `node scripts/balance-fields.mjs src/data/enemies.ts EnemyDef` のように TS の型名を渡すと、JSDoc から `_fields` の雛形を出す。単位と目安を足してから貼る
- `_fields` は `_note` と同じく読み込み時に剥がされるので、足しても数値の版（`BALANCE_HASH`）は変わらない

## 数値の変え方

全部 `src/data/balance/**/*.json` を直接編集する。保存すると Vite が自動で再読み込みする（5.1。ラン中はタイトルへ戻る）。`npm run check` は通さなくても `npm run dev` は動くが、変える前に一度 `npm run check` で今の状態がクリーンか確かめておくと、自分の変更で壊れたのか元から壊れていたのか切り分けやすい。

**武器の振りの速さを変える**（例: 大剣の 1 段目を速くする）:
1. `src/data/balance/weapons/WEAPON/movesets/greatsword.json` を開き、`steps` の配列を探す（1 段 1 行）
2. 1 段目の `"windup"`（振りかぶり）・`"active"`（当たり判定が出ている秒数）・`"recover"`（硬直）を小さくする。単位は秒（`weapons/_index.json` の `_note` に凡例、項目の意味は `weapons/WEAPON/_index.json` の `_fields`）
3. 保存 → dev サーバが再読み込み。3 段目だけ・特定の派生（`branches`）だけ変えたいときも同じ配列の中の該当オブジェクトを探して編集する

**武器の威力を変える**:
- 同じ `steps[i]` の `"scaling"`（`{ "base": 8, "str": 0.9 }` の形）。`base` はステータスが 0 のときの威力、`str` などはステータス 1 あたりの伸び。ステータスが各 5 のときの威力は `base + 5 × 係数の合計`。`base` だけ上げると素の威力が、`str` を上げるとそのステータスを伸ばしたときの伸びしろが変わる。係数を別のステータスへ付け替えるときは係数の合計を保てば基礎値での威力は変わらない
- 怯み値は `"poise"`（ステータス各 5 のときの値）と `"poiseRatio"`（`{ "str": 0.6 }` の形。1 点あたりの上乗せ）。状態異常の効果量は `"applies"` の各要素の `"ratio"`
- どのステータスを参照させるかの決め方は `docs/STATS_AND_SCALING.md`（効果から見て納得できる参照先にする）
- 右の連撃（右クリック。アクション 2）は同じファイル（`weapons/WEAPON/movesets/<武器種>.json`）の `steps2` の配列（1 段 1 要素。段カウンタは左と共有なので、3 段目に右を押すと `steps2[2]`）。振りの段（`"kind": "swing"`）は `.step.scaling`、弾の段（`"volley"`）は `.throw.scaling`、構え（`"hold"`）の離した振りは `.hold.release.scaling`。派生は `branches.<派生の key>.step.scaling`
- 奥義は `src/data/balance/ultimates/ULTIMATE/defs/<武器種>.json` の `<名前>`（例: `defs/sword.json` の `fullMoon.nova.scaling`）。威力には性質の「奥義の威力」（`burstDamageMul`）が掛かる。持続の奥義の減る速さは `drainPerSec`（ゲージ/秒）

**ジョブのステータスの偏りを変える**:
1. `src/data/balance/jobs/attributes.json` の `<ジョブ名>` を開く（例: `swordsman`）
2. `str` / `dex` / `vit` / `mnd` / `spi` の数値を書き換える。**合計が 0 になるように**（`system/jobs.test.ts` の「合計 0」テストが崩れを検出する）。弱点（`jobs/weakness.json` の `<ジョブ名>`）はこの偏りと対になっているので、強くしすぎたら弱点側もセットで見直す

**敵の HP を変える**:
1. `src/data/balance/enemies/stats/<敵の key>.json` の `hp` を書き換える（例: `enemies/stats/slime.json`）。敵の key は `src/data/enemies.ts` の `ENEMIES` 一覧の `key` と同じ（日本語名ではなく英語の key で引く）
2. 怯み耐性（怯みにくさ）を変えたいときは `enemies/combat/<敵の key>.json` の `poise`、防御・耐性は `enemies/defense/enemies/<敵の key>.json`

**共通の注意**:
- 数値だけを直す分には型は壊れない（`shape.kind` のような形の種類や `key` は文字列の一覧と照合されるので、存在しない値を書くと `npm run check` の vitest で落ちる）
- 変えたら該当のテスト（`npx vitest run src/data/weapons.test.ts` など）と `npm run check` を通す。テストは「数値を変えていないこと」を固定しているものが多いので、意図した数値変更でテストが落ちるのは正常（そのテストの期待値も一緒に直す）
