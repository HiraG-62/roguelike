# CLAUDE.md（roguelike プロジェクト）

ブラウザで動くリアルタイム・トップダウンアクションローグライク（Hades / Nuclear Throne 系）。TypeScript + Vite + Vitest、Canvas 2D、**ランタイム依存なし**。手動操作（オート攻撃なし）、テレグラフを読んで避けて殴る。永続する装備ドロップ（ゴール装備を作らない設計）、永続のスキル石、ラン内の刻印符・祝福を持つ。趣味開発で「機能を足し続けて遊べる」ことが最優先。

- 現在の要素一覧・操作・次の候補: `IDEAS.md` の「現状」節（ここに重複して書かない）
- 応答・コメント・コミット・PR のタイトルと本文・GitHub 上のコメントは **すべて日本語**（ユーザーのグローバル設定に従う）。**作業途中の一言の報告（「〜を確認します」等）と完了報告も例外なく日本語**。英語で書きかけたら日本語に直してから出す
- このファイルは **入口の索引**。詳細は `docs/` に置いて参照させる（下の「エージェント資料の保守」。上限 150 行）

## ユーザー共通ルールと記憶（クラウドセッション向け）

ローカルの `~/.claude` にあるユーザーの共通ルールと自動メモリを `.claude/global/` に写してある。クラウドでは SessionStart hook（`scripts/claude-session-context.mjs`）が `PREFERENCES.md` とメモリの索引を文脈に載せる（ローカルは Claude Code が元を読むので載せない。二重に読ませないため `@` で取り込まない）。

- 索引から関係するメモリ本文（`.claude/global/memory/`）を開く。現在地は `docs/HANDOFF.md` → `memo/` の順で掴む
- **パッケージマネージャは pnpm**（`pnpm-lock.yaml`。npm / yarn / `npx` は使わない）。スクリプトへの引数は `pnpm run <名前> --flag` と直接付ける（npm 式に `--` を挟むと `--` がそのまま渡る）
- `.claude/global/` は **手で直さない**。ローカルで memory やグローバル CLAUDE.md を変えたら `pnpm run sync:claude` で写し直してコミットする。クラウド側で覚えるべきことは `docs/HANDOFF.md` の「ユーザーに聞くこと / 引き継ぎ」に書く

## コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm run dev` | 開発サーバ（Vite） |
| `pnpm run check` | audit:docs → tsc → vitest → vite build。1 つでも失敗で非 0。**作業完了の判定はこれ** |
| `pnpm run check:fast` | 並列レーンの途中確認用。QA シミュレーション・Electron の型検査・ビルドを省く（コミット前は `check`） |
| `pnpm run test` | vitest run（QA シミュレーションは縮小版だけ走る） |
| `pnpm run audit:docs` | エージェント資料とコードのずれを検査（`check` の最初の段でも走る） |
| `pnpm run fx:gen` | エフェクトのスプライトを生成（`scripts/fx/`、1 武器種 約 30 秒）。`--atlas <武器種>` でその武器種だけ、`--only <key> --preview <dir>` で確認用 PNG だけ |
| `pnpm run sprite` | ドット絵の作業台（`scripts/sprite/cli.mjs`）: `render`（確認用 PNG）/ `lint`（様式書の点検）/ `strip --ase`（Aseprite へ）/ `import`（PNG・.aseprite → `Frame` リテラル）/ `palette` / `gen`（Spriteloom で下絵の案）。手順は `docs/recipes/sprite.md` |
| `pnpm run qa:full` | `SIM_FULL=1` でフル QA（1 時間超。裏で回す）。`src/qa/report.md` を上書き。`--no-write` で書き出さない |
| `pnpm run qa:probe` | `SIM_PROBE=1` で 1 対 1 / 集団の連打計測（約 1 分）。基準値の `src/qa/probe.md` を上書き。`--no-write` で書き出さない。`--weapons`（武器種 × 敵）/ `--bosses`（章ボス 4 と最深の主）/ `--deep`（深みの曲線・到達・壊れの重さ）でその節だけ測って差し替え |
| `pnpm run qa:gear` | 装備パターンの行列（持ち込みの量・部位・質・武器種・ジョブを標準から 1 軸ずつ変えて bot を並列に回す。約 30〜60 分）。`src/qa/` の gear の表（md）と集計（json）を上書き。`--only <軸 / key>` で測り直した分だけ差し替え・`--seeds` / `--steps` / `--jobs` / `--no-write` |
| `pnpm run map:shot` | 地図の見た目の確認用 PNG（`tools/map-shot.html` を Chromium で撮る。既定 14 場面）。`--only <名前>` / `--bench`（描画の ms）/ `--out <dir>` |
| `pnpm run hitch:probe` | 一瞬の固まりの計測（bot が 60 秒遊び、重いフレームと原因の候補を出す）。`--seed / --depth / --frames / --threshold / --methods / --headed` |
| `pnpm run electron:dev` / `pnpm run electron:build` | Electron 版の起動 / 配布物のビルド（`electron/`） |
| `pnpm run sync:claude` | ローカルの `~/.claude` を `.claude/global/` へ写す。`--check` で差分だけ確認 |
| `node scripts/bump.mjs <patch / minor / major>` | バージョンを上げてコミットとタグを作る（`/bump`） |

単体で回すとき: `pnpm exec vitest run src/system/boons.test.ts`、`pnpm exec tsc --noEmit`。

## コードの地図

層ごとのファイルの役割は **`docs/CODE_MAP.md`**（ファイルを足したらそこに 1 行）。データフロー・型・決定性・永続化キーは `docs/ARCHITECTURE.md`。

```
src/main.ts  ブラウザ側の配線（入力・ループ・画面遷移・永続化・効果音 drain・リプレイ記録）
src/core/    決定的シミュレーションの核（createGame / step、rng、入力、リプレイ、状態異常・ルール・イベントの型）
src/system/  ゲームロジック（state を読み書き）。step の呼び出し順は CODE_MAP の system 節
src/loot/    装備（生成・集計・クラフト・永続化）。純関数中心
src/skills/  スキル石・刻印符のデータと型、発動処理、設置物
src/map/     グリッド・生成器・拠点の部屋・視線と距離場（純関数）
src/render/  Canvas 描画（state を読むだけ）
src/ui/      画面ロジック（DOM 非依存）
src/audio/   Web Audio 合成の効果音と音楽
src/data/    balance/<ファイル>/**/*.json（数値。`pnpm run balance:gen` で組み立て）、敵・武器・ジョブの定義、スプライト
src/meta/    図鑑・依頼・実績・連携の発見・拠点の永続化（ゲーム進行には効かない）
src/save/    保存先の唯一の入口（ブラウザ localStorage / Electron ファイル）
src/qa/      ヘッドレス bot とシミュレーション、report.md
electron/    Electron 版の main / preload / IPC
```

## 不変条件（破ったらレビューで差し戻す）

1. **ロジックと描画の分離**: system は state を読み書きし、render は読むだけ。描画から state を書き換えない
2. **描画で `state.rng` を消費しない**。見た目のばらつきは `renderMath.ts` の座標ハッシュ
3. **決定性**: 同じ seed + 同じ FrameInput 列 → 同じ結果。`Math.random`（`audio/synth.ts` の揺らぎ以外）と実時間に依存しない。`Date.now()` は id / `foundAt` の `now` 引数だけ。`core/replay.test.ts` を壊さない
4. **バランス数値は `src/data/balance/**/*.json`**（ブロック名 + `_note`）。ロジックは `data/tuning.ts` / `skills/data.ts` の再 export 経由で読み、直書きしない。union 文字列・key・表示名・関数は TS。置き場所と境界は `docs/BALANCE.md`。項目の意味は `_fields`（親に 1 回、行は引き継ぐ。新しい数値には 1 行足す）。配列の要素には英語の名札 `_id`（`primary4.heavySlash`。文章にしない）、書式は 1 項目 1 行（`pnpm run balance:fmt`）
5. **フォント**: UI 文字は **すべて** `render/pixelText.ts` の `drawText` / `textWidth` / `wrapText` / `truncateText`。`ctx.fillText` / `measureText` / `ctx.font` と等幅前提の文字数計算は禁止。行高は `Math.max(定数, textLineHeight())`
6. **座標は 480x270 の論理座標**（`core/view.ts`）。描画は `RENDER_SCALE`（4）倍のバックバッファに描き、スプライトは `SPRITE_DOTS`（`data/sprites/dots.ts`）の密度を持つが論理寸法で描く。距離の表示は `core/units.ts` の `formatMeters`（10px = 1m）
7. **効果音**: ロジックは `pushSfx(state, name)` で名前を積むだけ。再生は main.ts
8. **永続化**: `src/save/backend.ts` の `saveStorage()` 経由で、各ストア（loot/profile・craftingStore・skills/persistence・ui/settings・ui/replayStore・meta/*Store）からのみ触る。step の中では触らない。壊れたデータは黙って既定へ。キーの形式を変えるなら `v2` を切る
9. **型と作法**: `any` 禁止。`noUncheckedIndexedAccess` 有効なので添字結果の undefined を扱う。マジックナンバーは定数化、早期リターン、関数は単一責任。コメントは日本語で「なぜ」
10. **テスト**: Vitest。`it` / `describe` 名とメッセージは日本語。新しい仕組みには必ずテスト。テスト専用ヘルパーは `system/testHelpers.ts` / `meta/testStorage.ts` / `audio/testAudioMock.ts`（本体から import しない）
11. **UI の方針**: 単一指標（DPS・アイテムスコア）を出さない。ツールチップは「何ができるか」を語る（`docs/DESIGN_PRINCIPLES.md`）。仕組み・用語の説明は UI に書かず `meta/tips.ts`（Tips ノート）に足す。キー名は `core/input.ts` の `keyLabel` で組み、固定で書かない
12. **用語**: 表示文字列は `docs/GLOSSARY.md`（世界観語の対応表・表示文字列の書き方）に従う。ラベル・浮き文字は体言止め（「奥義終了」。「奥義が終わった」にしない。`system/floatingText.test.ts` が検査）。内部 key は変えない。新語を作ったら GLOSSARY に 1 行足し、迷ったらユーザーに聞く

## 要素の足し方（レシピ）

足すときは該当のレシピを読んでから始める。最後は `pnpm run check`。サブエージェントに任せるときは `/add-enemy` などの skill を使う。

| 要素 | レシピ |
| --- | --- |
| 敵 | `docs/recipes/enemy.md` |
| 武器種 / 銃の弾 | `docs/recipes/weapon.md` |
| 性質（旧アフィックス）/ 変換 / 誓約 / 名のある遺物 / ベース | `docs/recipes/affix.md` |
| スキル / 刻印符 | `docs/recipes/skill.md` |
| 攻撃ジャンル・属性 | `docs/recipes/element.md` |
| ジョブ | `docs/recipes/job.md` |
| 契約者 | `docs/recipes/contractor.md` |
| 状態異常 | `docs/recipes/status.md` |
| 祝福 | `docs/recipes/boon.md` |
| 依頼 / 実績 | `docs/recipes/quest.md` |
| 倉庫の並び・絞り込みの軸 | `docs/recipes/stash.md` |
| 部屋種類 | `docs/recipes/room.md` |
| 陣形 | `docs/recipes/formation.md` |
| 効果音・音楽 | `docs/recipes/audio.md` |
| スプライト | `docs/recipes/sprite.md` |

## 並列開発の作法

詳細・プロンプト雛形・報告形式・モデルの使い分け・**速く進める原則**（確定リストまで出す設計・並行の段は worktree・途中確認は `check:fast`・レビューと資料の文章と版上げは段の終わりにまとめる）は `docs/AI_WORKFLOW.md`。

- 機能を **ファイル所有** で分割し、Agent ごとに「所有 / 編集禁止 / 先に読む / 完了条件 / 報告形式」を渡す（`/parallel`）。共有ファイルは **最小の Edit のみ**、全文 Write 禁止
- Agent は **コミットしない**。統合役が `git add <所有ファイル>` で論理単位ごとにコミット（`git add -A` 禁止）。一時ファイルは scratchpad へ
- **Codex 優先**: 実装レーンとレビューは、利用枠が空いていれば指示を待たず Codex に任せ、結果はメインが確かめる（`docs/AI_WORKFLOW.md`「Codex の使い方」）
- モデル: メインは Opus。設計判断・診断・ドット絵は Opus（architect / pixel-artist）、実装・定型・通常のレビュー・発想・数値調整は Sonnet（implementer / qa-runner / localizer / reviewer / brainstormer / balance-tuner）。決定性に触るレビューと、大量並列のブレストの一部は `model: "opus"` で上書きする。Fable は本当に超思考が要る場面だけ `model: "fable"` で上書きして呼ぶ。設計が曖昧なまま Sonnet に実装させない
- skill（`.claude/skills/`）: `/check` `/qa` `/add-enemy` `/add-affix` `/add-skill` `/add-boon` `/parallel` `/review` `/handoff-docs` `/agent-docs` `/release-notes` `/bump`

## エージェント資料の保守

CLAUDE.md・`docs/CODE_MAP.md`・`docs/recipes/`・`.claude/agents/`・`.claude/skills/`・`docs/AI_WORKFLOW.md` を「エージェント資料」と呼ぶ。コードとずれると Agent が古い前提で動くので、**コードを変えた同じ作業の中で直す**。

- 機械検査 `pnpm run audit:docs`（`scripts/audit-agent-docs.mjs`）: 参照するパス・識別子の実在、src の本体ファイルが `CODE_MAP.md` に載っているか、「（`XXX`、N 種）」の件数、skill / agent / レシピの登録、旧用語、CLAUDE.md の行数上限。落ちたら資料を直す（検査を緩めない）
- **CLAUDE.md を長くしない**: 新しい決まりや手順は `docs/` に置き（レシピは `docs/recipes/`、作法は `AI_WORKFLOW.md`、地図は `CODE_MAP.md`）、ここには 1 行の参照だけ足す
- 判断が要る追随は `/agent-docs`（「何を変えたらどこを直すか」の表）。並列の Agent は資料を直さず、報告の「統合手順」に「資料に必要な変更」を書く

## バージョニング・コミット・PR

- 版は `scripts/bump.mjs`（`/bump`）で上げる。手で書き換えない。**メジャーはユーザーの指示があるときだけ**。α 期間は「0.0.xxα」で minor 相当でもパッチを上げる。判断基準は `/bump` の表
- 変更内容はコミットのたびに統合役が `CHANGELOG.md` の `[Unreleased]` へ日本語で追記する（並列の Agent は触らない）
- コミットは `<type>: <日本語の概要>`（feat / fix / refactor / docs / style / test / chore）。1 コミット = 1 論理変更。ユーザーの指示があるまでコミットしない
- **改修はブランチを切って進め、master に直接コミットしない**。`pnpm run check` が通ったらユーザーに承認を求め、承認後に push して master へ PR を出す（マージはユーザー）。手順は `docs/AI_WORKFLOW.md` の「ブランチと PR」
- PR はタイトルも本文も日本語（`<type>: <概要>` + 概要 / 変更 / 確認の 3 節）。UI が英語で自動生成した PR は日本語に書き直す。レビュー返信も日本語

## ドキュメント索引

| ファイル | 内容 |
| --- | --- |
| `docs/HANDOFF.md` | **セッション開始時に最初に読む**: 現在地・進行中のレーン・次の候補・ユーザーに聞くこと（100 行以内。現在地は上書き） |
| `docs/BACKLOG.md` / `docs/archive/` | 積み残しの一覧（次の作業を選ぶときに開く）/ 役目を終えた資料の置き場（過去の引き継ぎなど。普段は読まない） |
| `docs/CODE_MAP.md` | 層ごとのファイルの役割（コードの地図） |
| `docs/recipes/*.md` | 要素の足し方 |
| `docs/ARCHITECTURE.md` | データフロー・型の関係・決定性とリプレイ・永続化キー |
| `docs/AI_WORKFLOW.md` | 設計 → 並列実装 → レビュー → QA → 統合の手順、Agent プロンプト雛形、モデルの使い分け |
| `docs/BALANCE.md` | バランス数値（JSON）の置き場所と変え方 |
| `docs/BALANCE_DICTIONARY.md` | バランス数値の全項目の辞書（`_fields` から `pnpm run balance:dict` で生成） |
| `docs/STATS_AND_SCALING.md` | ステータスと係数の共通の決まり（武器・スキル・状態異常を足すときに必ず従う） |
| `docs/DESIGN_PRINCIPLES.md` / `docs/COMBAT_DESIGN.md` / `docs/LOOT_DESIGN.md` | ゲームデザインの原則 / 戦闘設計（攻撃と怯み・ジャンル・属性・ジョブ・気力・回復）/ 装備システムの設計 |
| `docs/GLOSSARY.md` | 用語と日本語表記の統一 |
| `docs/ASSETS.md` | 外部ドット絵素材の候補と導入手順。帰属表示は `CREDITS.md` |
| `docs/ideas/README.md` / `docs/ideas/*.md` | ブレスト一覧とチェックリスト / 設計メモ（実装済みの仕組みの「なぜ」もここ） |
| `IDEAS.md` / `CHANGELOG.md` / `src/qa/report.md` | 企画メモと「現状」 / 版ごとの変更履歴 / 最新のフル QA 結果 |
| `memo/` | ユーザーのアイデアメモ（`YYYYMMDD-N.md`）。開始時に読み「優先的」からレーン化 |

## 導入しないもの

- Prettier / ESLint は入れない（依存を増やさない）。書式は `.editorconfig`（LF・UTF-8・2 スペース）と既存コードに合わせる
