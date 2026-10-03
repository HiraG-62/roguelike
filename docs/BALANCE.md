# バランス調整ガイド

調整したい数値はすべて `src/data/balance/` 以下の JSON にある。JSON を書き換えて保存すれば反映される（`npm run dev` 中は自動で再読み込み）。1 ファイルに持つ情報を少なくするため、ブロックごと（大きい表は行ごと）にファイルを分けてある。

| ディレクトリ | 中身 | 探し方の例 |
| --- | --- | --- |
| `weapons/` | 武器種 27 種の段ごとの振りの速さ（windup / active / recover 秒）・威力・怯み値。左の連撃 `steps`、右の連撃 `steps2`（アクション 2。段の種類 `kind` と段の key を持つ配列）、派生 `branches.<派生の key>`、銃のベースごとの弾、武器の重さ（各武器種の `"weight"` と重さ別の係数 `WEAPON/weightClass.json`: 攻撃中の移動・硬直・取り消せない相・通常命中のヒットストップ・重さの補償〔威力・怯み値・終撃の押し・堅守崩し・終撃のヒットストップ〕）、武器の型（`FORM/<型>.json`: 重さの既定・段数の幅・戦意の上限と溜まり方と放出の強さ）、改鋳（`REFORGE/<型>.json` 改鋳ごとの数値、`REFORGE/_index.json` に 1 ランの回数 `perRun`・札の数 `offerCount`）、共通の瞬間（`MOMENT.json`: 先制の待ち・双撃の窓・浮き文字）、剣の基本 3 段（`PLAYER_MELEE.json`）、ダッシュ攻撃（`ACTION_DASH_ATTACK.json`） | 剣 → `weapons/WEAPON/movesets/sword.json`、弾 → `weapons/WEAPON/bullets.json`、項目の意味 → `weapons/WEAPON/_index.json` |
| `jobs/` | ジョブの共通数値（`JOB.json`）、ジョブごとのステータスの偏り（`attributes.json`）、ダッシュの形（`DASH_FORM.json`）、気力の源（`MANA_SOURCE.json`。通常攻撃の下地は `JOB.manaBaseMul`） | 剣士の偏り → `jobs/attributes.json` の `swordsman` |
| `enemies/` | 敵 110 体の HP・速度・予告（`stats/<敵の key>.json`）、怯み耐性（`combat/<敵の key>.json`）、防御・耐性（`defense/enemies/<敵の key>.json`。体つき・土地は `defense/bodies.json` / `defense/biomes.json`）、行動（`ENEMY_AI/<行動の key>.json`）、精鋭・ボス（`BOSS/<ボスの key>.json`。ボス共通の規則は `BOSS/rules.json` = `BOSS.rules`: 読みの閾値 `nearDist` / `farDist` / `stillSpeed` / `stillSec` / `dashMemory`・連撃の続きの予備動作の倍 `chainWindupMul`・取り巻きを倒したときの怯み値 `minionPoiseRatio`・固有の報酬の量 `rewards`。章ボス 4 は行為で進む段階の回数〔`cornersToRage` / `ignitesToDrench` / `slamsToCrack`〕と部屋の変化〔柵 `fence*`・分裂体の呑み込み `swallow*` と毒沼 `acid*`・膨張 `inflate*` / `wave*`・模写 `copy*`・姿見 `panes` / `paneOffset` / `imageReform` / `paneDown`〕の葉を持つ。最深の主は `BOSS/deepLord.json` = `BOSS.deepLord`: 門柱 `pillar*`・落石 `rain*`・光線 `beam*`・陥没 `collapse*` / `ringTiles`・連撃 `slash*`・奈落の手 `hand*`・借りた技の反動 `borrowRecoil`・陥没の溶岩が撃破後に消える秒 `collapseFade`）・死神・前のランで力尽きた相手が出る仇（`NEMESIS.json` = `NEMESIS`: 出る階 `minDepth` / `depthLead`・生命の倍 `hpMul` / `maxedHpMul`・仇討ちの報酬 `rewardItems` / `rewardBoost` / `rewardKeys`）、本陣（`HONJIN.json`: 立つ数・格・大将）と陣図（`JINZU.json`: 書く速さ・画の数・墨入れ・総掛かり・筆折れ・旗倒れ）、陣の配り（`JIN.json`: 陣の数・予算・猛・長蛇・物見 `lookout`・群勢 `morale`・敗走 `rout`・後詰 `wake`・眠っている陣が歩き出す `stir`・陣の名札 `hud`）と陣形（`FORMATION/<陣形の key>.json`: 並べ方・役割と格のスロット）、敵の反応ルール（`REACTION.json`: 間合い取り・隙を狙う・囲む・後退射撃・離脱）、同時攻撃の上限と予告の見やすさの上限（`ENEMY_TEMPO.json` の `striker*` / `telegraph*`）、章で覚える技（`ENEMY_TEMPO.json` の `depthStages`: 深度ごとの連撃・離脱・後退射撃）、跳躍（`ENEMY_AI/leaper.json`）、音で起きる半径（`JIN.json` の `noise`） | スライム → `enemies/stats/slime.json` ほか同名 3 ファイル |
| `skills/` | 技（共通技 60）は `ART/common.json`、型ごとの形の変化は `ART/TRANSFORM/<型>.json`、技の抽選の重みは `ART/_index.json` の `weight`。刻印符が付く本数はスロット固定 `SKILL/_index.json` の `slotLinks`。スキルのコスト・威力・再使用時間（`SKILL/<key>.json`、`EXTRA_SKILL_TUNING/<key>.json`、`WAVE2_SKILL_TUNING/<key>.json`、`WAVE3_SKILL_TUNING.json`）、刻印符（`SKILL/modifier.json` と `*_MODIFIER_TUNING.json`）、連携、変身、使い込み | 伝染 → `skills/EXTRA_SKILL_TUNING/contagion.json` |
| `boons/` | 祝福の抽選・枠・格・芯の共通の数値（`BOON.json`: 札の種類の重み `cardWeight`・種類を持たない札の重み `baseWeight`・加護の枠・真髄の条件・格の倍率）と、札ごとの数値（`LINEAGE/<系譜>.json`。9 系譜・`fusion`・`cursed`。読むのは `BOON_LINEAGE`） | |
| `loot/` | ドロップ率、持ち込みと持ち帰り（`CARRY.json` = `CARRY`: 持ち込める部位の数 `carrySlots`・右手を枠の外にする `weaponFree`・持ち帰れる数 `keepOnDeath` / `keepOnClear`）、源と糧の共鳴（`RESONANCE.json`: 1 段に要る源・糧の数 `minSources` / `minSinks`・段の増え方 `stepEvery` / `amplifyStep`・上限 `maxSteps`・1 段の倍 `stepMul`・倍の無い語の量 `statPerStep`）、誓約（`KEYSTONE.json`）、トリガー・性質の間合いと秒（`TRIGGER.json` の `trait`）、名のある遺物 18 の固有の数値（`RELIC.json`）、厳選の到達点の閾値（`REACH.json` = `REACH`: 無尽 `chain`〔装備の連鎖係数の合計。1 = +100%〕・燎原 `burn`〔燃焼の重ねの上限の加算〕・常在 `morale`〔戦意の上限の加算〕。装備だけで数える。目安は「深度 25〜30 で拾った上振れの遺物 2 つ」）、性質の揺らぎ（`FLUX.json`: 幅・反転・見た目の分類の境界・強さの係数）、性質の期待値曲線（`affixCurves/<性質の key>.json`。`_index.json` の `_order` にも足す）、ベースの出現深度（`bases.json`）、地金の予算と配り方（`INNATE/`） | 懐の曲線 → `loot/affixCurves/purse.json` |
| `combat/` | 気力、回復、状態異常（`STATUS/`）、性能の歯止め（`LIMITS.json` = `LIMITS`: プレイヤーの弾 `playerProjectiles`・スキルの弾 `skillShots`・設置物の置き場ごと `placedPerPool` の同時数の上限。強さの上限ではなく 1 ステップの重さの保険で、超えた分は古い順に消す）、ステータス、怯み、攻撃ジャンル、属性、地形、プレイヤーの移動・ダッシュ・生命・射撃の共通値（`PLAYER.json`。近接 3 段は `weapons/PLAYER_MELEE.json`）、全武器共通の受け流し（`PARRY.json`）、アクション手触り（`ACTION.json`。浮き文字の文言は `src/data/actionText.ts`） | 毒 → `combat/STATUS/poison.json` |
| `enemies/ENEMY_SCALE.json` | 深度による敵の伸び: 生命と怯み耐性 `hpPerDepth`、攻撃の倍率 `damagePerDepth`、深み（`deepDepth` 以降は指数 `deepHpGrowth` / `deepDamageGrowth`。`deepDepth` は最深の間の深度と同じにする〔`chapters.test.ts` が縛る〕。深みの敵数・変異は `world/DEEP.json`）。敵の攻撃は `depthDamage(基礎, 深度)` で倍率を掛ける | |
| `world/` | フロア、階の型 8 種の出やすさ・拡縮・検査（`MAP_LAYOUT/`。`docs/ideas/map-gen-impl.md`）、銭・鍵・瓶（`ECONOMY/`: 銭の寿命と引き寄せ・稼ぎの源と量 `income`・被弾でこぼれる `spill`・鍵・瓶）、章立て（`ARC.json`: 章ボスの並び・最深の間の主 `finalBoss`・地上への道 `surfaceHold` / `surfaceOffset` / `surfaceColor`・章の主の予習の色 `aheadColor`）、深み（`DEEP.json` = `DEEP`: 深みで部屋の敵数の上限に足す数 `maxEnemiesBonus`・変異が 1 つ増える層の数 `mutationEvery`・表示の色 `color`。境目は `system/chapters.ts` の `isDeepDepth`。旧 `FLOOR_KIND` の `deepDepth` / `deepMaxEnemiesBonus` / `mutationEvery` は撤去した）、ボスの間（`BOSS_HALL.json` = `BOSS_HALL`: 階を作る seed の頭 `seedPrefix`・挑む前の立ち位置 `doorInset`・結果の色）、メタ（`META.json` = `META`: 依頼の 3 択で持ち物の語と重なる重み `questTagWeight`・予告の図解が開く倒された回数 `diagramDeaths`）、位階の見返り（`TIER_REWARD.json` = `TIER_REWARD`: 章の市の品が増える位階 `marketTier` / 足す品 `marketExtra`・出口が増える位階 `exitTier` / 本数 `exitExtra`）、出口の予告（`EXIT.json`: 報酬の重み・祝福の出口の系譜の重み `lineageOwnedMul` / `lineageJobMul`・銭と危険の倍・表示の距離と色）、マップの広さ（`MAP_SIZE.json`: 面積の倍率の抽選・部屋数・部屋の大きさ `roomSizeExp`・部屋の敵の伸び `roomEnemiesExp`・死神の猶予と徘徊上限の伸び）、敵の眠りの距離（`ROAM.json` の `sleepDist`）、部屋（`ROOM_KIND/`）、洞窟、徘徊（通路への初期配置 `ROAM.corridorPerTiles` / `corridorMax` を含む）、隠し部屋（`HIDDEN_ROOM.json`）、ランイベント（`RUN_EVENT/`）、起点、契約者、縛り、拠点 | |
| `ultimates/` | 奥義の共通値（`ULTIMATE/common.json`。ゲージ消費・無敵・浮き文字の色）と、奥義ごとの数値（`ULTIMATE/defs/<武器種>.json` の `<名前>`。一撃は行為ごとのブロック `nova` / `swing` / `lunge` / `volley` など、持続は `drainPerSec`・`minSec`・倍率・`patch`。奥義ごとの必要な奥義ゲージは `cost`〔省略時 `common.cost`〕）。奥義ゲージの溜まり方は `combat/ENERGY.json` | 剣の奥義 → `ultimates/ULTIMATE/defs/sword.json` |
| `feel/` | ヒットストップ・揺れなどの手触り（通常命中の上限 `FEEL.hitstopNormalMax`）、敵の予告の線の色と長さ（`TELEGRAPH.json`）、予告の筆の線の姿（`TELEGRAPH_POSE.json`）・受け流しの体と武器の動きと火花（`PARRY_POSE.json`）・見切りの目印（`SIGN_CHECK.json`）・殺気の合図（`THREAT_CUE.json`）・拍子木の音（`NARIMONO.json`）、地図の光と暗がり（`MAP_LIGHT.json`: 章ごとの暗さ・プレイヤーと溶岩・炎・階段・泉の光の半径と強さ・光源の上限・光の色の濃さ）、演出（`EFFECTS/`、攻撃エフェクトの見た目は `FX_ATTACK/`）、浮き文字の種類ごとの大きさ・寿命・重複の抑え方・会心の弾み（`FLOAT_TEXT.json` = `FLOAT_TEXT`）、ミニマップ、音楽、効果音、持ち物メニューの情報の予算（`MENU_BUDGET.json`） | |

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
- 奥義は `src/data/balance/ultimates/ULTIMATE/defs/<武器種>.json` の `<名前>`（例: `defs/sword.json` の `fullMoon.nova.scaling`）。威力には性質の「奥義の威力」（`奥義の増 `increased.ultimate``）が掛かる。持続の奥義の減る速さは `drainPerSec`（ゲージ/秒）

**ジョブのステータスの偏りを変える**:
1. `src/data/balance/jobs/attributes.json` の `<ジョブ名>` を開く（例: `swordsman`）
2. `str` / `dex` / `vit` / `mnd` / `spi` の数値を書き換える。**合計が 0 になるように**（`system/jobs.test.ts` の「合計 0」テストが崩れを検出する）。弱点（`jobs/weakness.json` の `<ジョブ名>`）はこの偏りと対になっているので、強くしすぎたら弱点側もセットで見直す

**敵の HP を変える**:
1. `src/data/balance/enemies/stats/<敵の key>.json` の `hp` を書き換える（例: `enemies/stats/slime.json`）。敵の key は `src/data/enemies.ts` の `ENEMIES` 一覧の `key` と同じ（日本語名ではなく英語の key で引く）
2. 怯み耐性（怯みにくさ）を変えたいときは `enemies/combat/<敵の key>.json` の `poise`、防御・耐性は `enemies/defense/enemies/<敵の key>.json`

**共通の注意**:
- 数値だけを直す分には型は壊れない（`shape.kind` のような形の種類や `key` は文字列の一覧と照合されるので、存在しない値を書くと `npm run check` の vitest で落ちる）
- 変えたら該当のテスト（`npx vitest run src/data/weapons.test.ts` など）と `npm run check` を通す。テストは「数値を変えていないこと」を固定しているものが多いので、意図した数値変更でテストが落ちるのは正常（そのテストの期待値も一緒に直す）
