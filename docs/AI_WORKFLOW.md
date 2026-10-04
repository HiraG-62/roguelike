# AI 開発ワークフロー

2026-09-23 の夜に確立した進め方。メイン（統合役、Opus）は設計・分割・統合・コミットに徹し、実装・テスト・レビュー・QA はサブエージェントに任せる。実装とレビューは Codex の利用枠が空いていれば Codex を優先する（下の「Codex の使い方」）。設計判断・診断・レビューは Opus のサブエージェント（下の「モデルの使い分け」）に委任し、Fable は超思考が要る場面だけ呼ぶ。

## 手順

1. **設計**: 何を足すかを 1 段落で決める。既存の設計文書（`docs/LOOT_DESIGN.md`、`docs/ideas/*.md`、`docs/DESIGN_PRINCIPLES.md`）と矛盾しないか確認する
2. **ブレスト**（大きな機能のみ）: `brainstormer` に `docs/ideas/<topic>.md` を書かせる。案ごとにコスト / 面白さ / 触るファイル、最後に「今すぐ入れるべき 5 つ」
3. **分割**: 機能を **ファイル所有** で切る。1 ファイルの所有者は 1 Agent。共有ファイルは「最小 Edit のみ許可」と明記して複数 Agent に開放する
4. **並列実装**: 所有ごとにレーンを起動（`/parallel`）。実装先は Codex 優先（`codex:codex-rescue`）、枠が無ければ `implementer`。互いの完了を待つ依存があれば、先に型だけ入れる Agent を走らせる
5. **レビュー**: 大きな段の終わりに 1 回（`/review`。下の「速く進める原則」）。Codex のレビューを優先し、指摘はメインがコードで真偽を確かめて直す。枠が無ければ `reviewer`（バグを見つけたら直すところまでやる）。Codex と reviewer の二重レビューはしない
6. **QA**: `qa-runner`（`/qa`）で `pnpm run check` と、数値合わせの段で `pnpm run qa:full`。数値の問題は `balance-tuner` へ
7. **統合**: メインが報告を読み、共有ファイルの差分を確認し、報告の「資料に必要な変更」を CLAUDE.md などに反映して（`/agent-docs`）、`git add <所有ファイル>` で論理単位ごとにコミット。`docs/HANDOFF.md`（現在地は上書き）・`docs/BACKLOG.md`・`IDEAS.md` の「現状」・`docs/ideas/README.md` を更新（`/handoff-docs`）

## ブランチと PR（2026-10-01、ユーザーの指示）

master に直接コミットしない。改修は必ずブランチを切り、ユーザーの承認を得てから master へ PR を出す。

1. **ブランチを切る**: 改修を始める前に、最新の master から `<type>/<短い英語名>`（例: `feat/inventory-rework`、`fix/resonance-label`）を切る。クラウドセッションが自動で作る `claude/...` ブランチはそのまま使ってよい。1 ブランチ = 1 つの改修（無関係な変更を混ぜない）
2. **ブランチ上で進める**: コミットの作法は CLAUDE.md の「バージョニング・コミット・PR」のまま。並列レーンの worktree はこのブランチから切り、統合役がこのブランチへ取り込む
3. **承認を求める**: `pnpm run check` が通ったら、変更点の箇条書きと「PR を出してよいか」をユーザーに聞く。承認が出るまで push も PR も出さない
4. **push と PR**: 承認後に push し、`gh pr create --base master` で PR を出す（タイトル・本文は日本語、概要 / 変更 / 確認の 3 節）
   - ローカルは `git push` が deny 設定なので、`! git push -u origin <ブランチ名>` をユーザーに提示して実行してもらい、その後に PR を作る（`gh pr create` に push させて回避しない）
   - クラウドセッションは自分で push してよい
5. **マージはユーザーが行う**: エージェントは PR をマージしない。レビューの指摘は同じブランチに追加コミットして push する。マージ後は master を最新にしてから次のブランチを切る

## リリース手順（check → bump → tag）

1. まとまった変更を統合し、各コミットを済ませる（`git status --short` が空に近い状態）
2. `pnpm run check` が通ることを確認する（必要なら `/qa` も）
3. `CHANGELOG.md` の `[Unreleased]` に変更点を書く（`/release-notes` で下書き）
4. レベルを決める（CLAUDE.md「バージョニング」。α 期間は 0.0.xx、major はユーザー指示のみ）
5. `node scripts/bump.mjs <level> --dry-run` で確認し、`node scripts/bump.mjs <level>` を実行（`/bump`）
   - package.json / src/version.ts / CHANGELOG.md を更新し、`chore: v0.0.2α` でコミット、`v0.0.2` タグを作る
6. push はユーザーの指示があるときだけ（タグも `git push --tags` が要る。クラウドセッションではタグの push が拒否されることがあるので、その場合はブランチだけ push してタグはローカルに残す）

## ファイル所有の決め方

- 新規ファイルはそれを作る Agent の所有
- 共有ファイル: `src/core/state.ts`（型フィールドの追加）、`src/core/game.ts`（初期値と step の呼び出し）、`src/data/balance/**/*.json` と `src/data/tuning.ts`（ブロックの追加）、`src/render/renderer.ts`、`src/main.ts`、`src/system/combat.ts`、`src/audio/sfxNames.ts` / `sfxLayers.ts`
  - 許すのは「自分の追加分だけの小さな Edit」。既存行の書き換えは所有者か統合役が行う
  - 数値は JSON に機能ごとのブロック（`XXX`）を分けて置き、tuning.ts はそれを再 export する（同じブロックを 2 Agent が触らない）
- テストファイルは対象ファイルの所有者のもの

## Agent プロンプトの雛形

```
あなたは E:\dev\roguelike（TypeScript + Vite + Vitest、Canvas 2D、ランタイム依存なし）の <役割> です。
<何を作るか 2〜3 文>。コミット禁止。日本語。

## 所有ファイル（自由に編集してよい）
- src/...（新規）
- src/...

## 最小 Edit のみ許可（全文 Write 禁止。自分の追加分だけ）
- src/core/state.ts: <追加するフィールド>
- src/data/balance/<file>/<ブロック>.json + src/data/tuning.ts: <追加するブロック名>

## 編集禁止（読むのは OK）
- 上記以外すべて。特に <並行作業中の Agent の所有ファイル>

## 先に読む
- CLAUDE.md（不変条件）、docs/recipes/<要素>.md、docs/CODE_MAP.md の該当層
- <関連する設計文書と既存コード>

## 仕様
- <箇条書き。数値は src/data/balance/**/*.json に置く前提で書く>

## 完了条件
- pnpm run check:fast が通る（他 Agent 起因の失敗はその旨を報告）。全段の pnpm run check は統合役がコミット前に回す
- 追加した仕組みに日本語名のテストがある
- 一時ファイルを残していない

## 報告形式（短く。経緯や作業の説明は書かない）
1. 変更ファイルと、次のレーンが使う公開関数・型（署名だけ）
2. 設計・指示からずれたこと・近似したこと（無ければ「なし」）
3. 資料に必要な変更と、テスト結果（件数・自分起因でない失敗）
```

## 速く進める原則（2026-09-30、ユーザーの指示）

安全の要（コミット前の全段の `pnpm run check`、決定性・黄金値のテスト、永続データを消す変更の事前確認）は削らない。それ以外の待ちと往復を減らす。

- **設計は確定リストまで出させる**: architect の設計は、実装レーンがそのまま使える表（残す / 消す key・写しの表・レーンの所有と最小 Edit の衝突確認）まで含める。「統合役が後で確定する」を残さない
- **次の段の設計を先に回す**: 今の段の実装中に、次の段の確定リストを architect で並行して作る（読むだけなので衝突しない）
- **前置きだけのレーンを作らない**: 共有の型を先に入れる作業は、最初のレーンに含めるか、小さければ統合役が直接入れる
- **触るファイルが重ならない段は並行で走らせる**: 同じ作業ツリーで並列に動かすと他レーンの途中の編集で検査が落ちるので、並行の段・レーンは `isolation: "worktree"` で動かし、統合役が取り込む。同時に動かす数に上限は設けない（ファイル所有で分けられるだけ並べる）
- **テストは担当分だけ回す**: レーンは作業中、自分の変えたファイルのテストだけを `pnpm exec vitest run <ファイル>` で回す（数秒〜数十秒）。全テストは最後に 1 回だけ `pnpm run check:fast`（QA シミュレーション・Electron の型検査・ビルドを省く）。全段の `pnpm run check` は統合役がコミット前に 1 回。この環境は CPU が少ない（4 コア）ので、全テストを複数のレーンで同時に回すと互いに遅くなる
- **テストはファイルごとに分離しない**（`vitest.config.ts` の `projects`。2026-09-30 の実測で全体 210 秒 → 118 秒）。他のテストとモジュールの状態を共有すると落ちるファイルだけ `vitest.config.ts` の分離の一覧に足す。新しいテストでは、モジュールの変数を書き換えたら元に戻す
- **仕様が固まったレーンは Sonnet**（「モデルの使い分け」）。共有ファイルの構造を変える大きな撤去・決定性に触る実装だけ Opus
- **レビューは大きな段の終わりに 1 回**: 途中の小さな段ごとには回さない。決定性・リプレイ・永続化に触る段だけは段ごと。どちらも Codex 優先で、枠が無ければ `reviewer`（決定性などに触る段は `model: "opus"`）
- **フル QA（約 70 分）は数値合わせの段で 1 回**: 途中の段では回さない（縮小版は `pnpm run check` に入っている）
- **資料の反映は 2 段に分ける**: `pnpm run audit:docs` を通すのに要るもの（`CODE_MAP.md`・`docs/recipes/`・新しいファイル・消した識別子）はコードと同じコミットで直す。用語集・Tips の文章・`ARCHITECTURE.md` の説明・`CHANGELOG.md` は大きな段の終わりにまとめて直す（`meta/tips.test.ts` が用語集の語を要求する分は、そのコミットで足す）
- **`REPLAY_VERSION` は大きな段の終わりに 1 回上げる**: 同じ段の途中のコミットでは上げなくてよい（途中の版の記録は開発中の手元だけのもの）
- **旧データからの移行・互換は作らない**（2026-10-01、ユーザーの方針）: 開発段階なので、セーブ・永続化キー・フォルダ名・記録の形式を変えるときに、前の状態から復旧する処理（旧形式の読み替え・移行・互換の分岐）は書かない。壊れたデータを黙って既定へ戻す決まり（CLAUDE.md 不変条件 8）はそのまま
- **報告を短くする**: レーンの報告は上の「報告形式」の 3 点。統合役からユーザーへの途中報告も 1〜2 行

## 統合の実務（2026-09〜10 に固まった運用）

- **共有ファイルの Edit**: 同じ共有ファイルを複数レーンが触るときは「`old_string` を短く取る」「末尾ではなく既存の目印の直後に足す」と伝えると衝突が減る
- **worktree の取り込み**: worktree の差分を本体へ 3-way で当てる（`git -C <wt> diff --binary | git apply --3way` + 新規ファイルの複写）。worktree は古い基点から始まることがあるので、レーンの最初に `git reset --hard <ブランチ>` させる
- **フル QA は隔離 worktree で回す**（`git worktree add <scratchpad>/wt-qa <commit>` → `pnpm run qa:full`）。本体で回すと他レーンの未コミット変更が混ざる。生成された `src/qa/report.md` は統合役が本体へコピーする
- **worktree を消すときは、先に `node_modules` のジャンクションを外す**（中身ごと消すと本体の `node_modules` が空になる）
- **同じ作業ツリーで別の対話セッションが動いているとき**は、コミットをファイル指定で行い `git reset` を使わない（インデックスが外から書き換わることがあった）
- **タグの push** はクラウドセッションでは 403 で拒否される。タグはローカルだけに残し、ブランチだけ push する
- 事故の後始末: `node_modules` が無ければ `pnpm install`。エージェントの一時ファイルが `src/` に残ったら `git status --short` で見つける。`src/qa/simulation.test.ts` の差分は目視する

## よくある事故と対策

| 事故 | 何が起きるか | 対策 |
| --- | --- | --- |
| 全文書き換えによるクロバー | 共有ファイルを Write で丸ごと書き、並行 Agent の変更が消える | 共有ファイルは Edit のみ。統合前に `git diff <file>` で他人の変更が残っているか確認 |
| 一時ファイルの放置 | `tmp_*.ts`、ログ、調査用スクリプトがリポジトリに残りコミットされる | 一時ファイルは scratchpad へ。統合時に `git status --short` で未知のファイルを確認 |
| テストの英語アサーション | 日本語化でテストが英語の表示文字列に依存して壊れる / 方針違反 | it 名・メッセージは日本語。表示文字列ではなく key や数値で検証する |
| `git add -A` | 他 Agent の作業途中の変更まで混ざる | 所有ファイルを列挙して add |
| 描画での rng 消費 | リプレイと QA の再現性が崩れる | 描画のばらつきは座標ハッシュ。レビューで `state.rng` の出現箇所を確認 |
| 数値の直書き | 調整箇所が散らばる。ユーザーが JSON で調整できない | `src/data/balance/**/*.json` にブロック。レビューで指摘 |
| 等幅前提の文字幅 | 日本語でレイアウトが崩れる | `pixelText.ts` の `textWidth` / `wrapText` / `truncateText`（`measureText` 禁止） |
| seed 依存のテストが落ちる | 敵・修飾子・部屋を足すと抽選がずれる | seed を変えず、テストの意図を守る形で堅牢化（敵の生命を十分に、交戦フラグを解く、など） |
| 並列の負荷でタイムアウト | 6 本並列で `replay.test.ts` / `qa/simulation.test.ts` が見かけ上失敗 | レーンには「報告だけ」と伝え、統合役が負荷の下がった後に `pnpm run check` |
| 状態の選択待ちで bot が止まる | QA が途中で進まなくなる（祝福 3 択の前例） | モーダルな状態を足したら `src/qa/bot.ts` の対応も所有に含める |
| 失敗を他人のせいにして終わる | 本当は自分の変更が原因 | 失敗したテストのファイルが自分の所有かを確認し、再現手順を報告 |

## Codex の使い方（2026-10-05、ユーザーの指示）

Codex（公式プラグイン `codex@openai-codex`）は **実装とレビューの第一の委譲先**。指示を待たず統合役の判断で使う。設計判断・診断・ドット絵・ブレスト・数値調整・QA は従来どおり Claude のサブエージェント（下の「モデルの使い分け」）。

- **枠の確認**: 実装やレビューを振る前に `node "C:/Users/Horry/.claude/skills/codex-orchestra/scripts/limits.mjs"`。`ok` なら Codex、`low` なら小さいレーンだけ Codex で残りは `implementer`、`limited` ならそのセッションは Codex を使わず従来の Agent。無料リセットはユーザーの指示なしに使わない。クラウドセッションなどスクリプトが無い環境も `limited` と同じ扱い
- **実装**: 設計が固まったレーン（`implementer` に渡せる条件と同じ。「モデルの使い分け」）を `codex:codex-rescue` に渡す。プロンプトは下の雛形そのまま（所有 / 編集禁止 / 先に読む / 仕様 / 完了条件 / 報告形式）。並行のレーンは従来どおり `isolation: "worktree"`。数行で済むものはメインが直接やる
- **Codex の成果は必ずメインが確かめる**: `git diff` で所有外の変更・一時ファイルが無いかを見て、担当テストと `pnpm run check:fast` を通す（codex-rescue は検証しない）。Codex 実行中は同じファイルをメインが触らない
- **レビュー**: `node "C:/Users/Horry/.claude/skills/codex-orchestra/scripts/companion.mjs" review --wait`（対象は `--base <ref>` / `--scope working-tree|branch`。設計そのものを疑うときは `adversarial-review --wait <焦点>`）。Codex は指摘だけ返すので、**メインが各指摘をコードで真偽確認し、確かなものだけ直す**（直しが大きければ Codex か `implementer` へ）。`reviewer` は Codex の枠が無いときの代わりで、両方は回さない
- **失敗したとき**: 空の結果・失敗なら枠の確認と同じコマンドで `status` を見る。`limited` なら再試行せず、途中の変更を `git status` / `git diff` で見て残すか戻すかをユーザーに聞き、以降は従来の Agent で引き継ぐ。それ以外は指示を具体化して 1 回だけ再試行し、駄目なら `implementer` へ

## モデルの使い分け

メイン（統合役）は Opus。サブエージェントは仕事の難しさで 2 段に分け、`.claude/agents/*.md` の `model:` に固定してある。

| 段 | model | Agent | 任せる仕事 |
| --- | --- | --- | --- |
| 判断を伴う | opus | architect / pixel-artist | 設計判断、不具合の診断、ドット絵 |
| 設計済み・定型 | sonnet | implementer / qa-runner / localizer / reviewer / brainstormer / balance-tuner | 仕様が固まった実装、コマンド実行と報告、表記の統一、通常のレビュー、発想の量出し、QA 結果からの数値調整 |

implementer を Sonnet で動かす前提は **設計が固まっていること**。プロンプトに次が揃っていなければ、先に architect（か統合役）で固める。
- 所有ファイルと、最小 Edit のみ許すファイルの一覧
- 追加する型・定数・公開関数のシグネチャ（置き場所のパス付き）
- 参照する既存の仕組み（例: `resolveRules` の文法、`applyStatus` の引数）と、流用する既存コードの場所
- 付けるテストの `it` 名（何を状態で検証するか）
- 完了条件（`pnpm run check` 通過に加えて、確認すべき挙動）

- 設計が曖昧なまま実装に入らない。「なぜそうなるか分からない」「複数の層にまたがる」と分かった時点で `architect` に切り替える
- Sonnet の implementer が詰まった（`pnpm run check` を 2 回直しても通らない、報告に「判断が必要」とある）ら、同じプロンプトを `model: "opus"` の上書きで再投入する。最初から難しいと分かっている実装（決定性・リプレイに触る、共有ファイルの構造を変える）は Opus で起動する
- `reviewer` は通常 Sonnet。決定性・リプレイ・永続化・性能に触る変更のレビューは `model: "opus"` で上書きして呼ぶ
- ブレストを大量に並列で回すときは、既定の Sonnet に Opus の `brainstormer` を数本混ぜる（`model: "opus"` で上書き。目安は 3 割）。視点の幅を出すのが目的で、Opus の案が常に良いわけではない
- Fable は高価なので常用しない。Opus の architect で 2 回詰まった、決定性・リプレイの原因が見えない、大規模な設計の分かれ道、のような超思考が要るときだけ `model: "fable"` で上書きし、読む範囲を絞った問い（仮説・対象ファイル・期待する結論の形）にして投げる

## サブエージェントと skill の対応

| やりたいこと | skill | Agent |
| --- | --- | --- |
| 型検査・テスト・ビルド | `/check` | - |
| フル QA と報告 | `/qa` | qa-runner |
| 敵 / 性質 / スキル / 祝福の追加 | `/add-enemy` `/add-affix` `/add-skill` `/add-boon` | implementer（+ pixel-artist） |
| 機能の並列実装 | `/parallel` | codex:codex-rescue（枠が無ければ implementer）× N |
| 直近コミットのレビュー | `/review` | Codex のレビュー（枠が無ければ reviewer） |
| 引き継ぎ文書の更新 | `/handoff-docs` | - |
| エージェント資料（CLAUDE.md・`docs/CODE_MAP.md`・`docs/recipes/`・`.claude/`・この文書）の追随 | `/agent-docs`（機械検査は `pnpm run audit:docs`） | - |
| 変更点まとめ | `/release-notes` | - |
| バージョンを上げる | `/bump` | - |
| アイデア出し | - | brainstormer |
| 設計判断・難しい不具合の診断・影響分析 | - | architect |
| 日本語化 | - | localizer |
| 数値調整 | - | balance-tuner |
