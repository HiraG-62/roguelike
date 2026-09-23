# AI 開発ワークフロー

2026-09-23 の夜に確立した進め方。メイン（統合役）は設計・分割・統合・コミットに徹し、実装・テスト・レビュー・QA はサブエージェントに任せる。

## 手順

1. **設計**: 何を足すかを 1 段落で決める。既存の設計文書（`docs/LOOT_DESIGN.md`、`docs/ideas/*.md`、`docs/DESIGN_PRINCIPLES.md`）と矛盾しないか確認する
2. **ブレスト**（大きな機能のみ）: `brainstormer` に `docs/ideas/<topic>.md` を書かせる。案ごとにコスト / 面白さ / 触るファイル、最後に「今すぐ入れるべき 5 つ」
3. **分割**: 機能を **ファイル所有** で切る。1 ファイルの所有者は 1 Agent。共有ファイルは「最小 Edit のみ許可」と明記して複数 Agent に開放する
4. **並列実装**: `implementer` を所有ごとに起動（`/parallel`）。互いの完了を待つ依存があれば、先に型だけ入れる Agent を走らせる
5. **レビュー**: まとまった変更ごとに `reviewer`（`/review`）。レビュアーはバグを見つけたら直すところまでやる
6. **QA**: `qa-runner`（`/qa`）で `npm run check` と `npm run qa:full`。数値の問題は `balance-tuner` へ
7. **統合**: メインが報告を読み、共有ファイルの差分を確認し、`git add <所有ファイル>` で論理単位ごとにコミット。`IDEAS.md` の「現状」と `docs/ideas/README.md` を更新（`/handoff-docs`）

## リリース手順（check → bump → tag）

1. まとまった変更を統合し、各コミットを済ませる（`git status --short` が空に近い状態）
2. `npm run check` が通ることを確認する（必要なら `/qa` も）
3. `CHANGELOG.md` の `[Unreleased]` に変更点を書く（`/release-notes` で下書き）
4. レベルを決める（CLAUDE.md「バージョニング」。α 期間は 0.0.xx、major はユーザー指示のみ）
5. `node scripts/bump.mjs <level> --dry-run` で確認し、`node scripts/bump.mjs <level>` を実行（`/bump`）
   - package.json / package-lock.json / src/version.ts / CHANGELOG.md を更新し、`chore: v0.0.2α` でコミット、`v0.0.2` タグを作る
6. push はユーザーの指示があるときだけ（タグも `git push --tags` が要る）

## ファイル所有の決め方

- 新規ファイルはそれを作る Agent の所有
- 共有ファイル: `src/core/state.ts`（型フィールドの追加）、`src/core/game.ts`（初期値と step の呼び出し）、`src/data/tuning.ts`（定数ブロックの追加）、`src/render/renderer.ts`、`src/main.ts`
  - 許すのは「自分の追加分だけの小さな Edit」。既存行の書き換えは所有者か統合役が行う
  - tuning.ts は機能ごとに `export const XXX = { … }` のブロックを分ける（同じブロックを 2 Agent が触らない）
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
- src/data/tuning.ts: <追加する定数ブロック名>

## 編集禁止（読むのは OK）
- 上記以外すべて。特に <並行作業中の Agent の所有ファイル>

## 先に読む
- CLAUDE.md（不変条件とレシピ）
- <関連する設計文書と既存コード>

## 仕様
- <箇条書き。数値は tuning.ts の定数にする前提で書く>

## 完了条件
- npm run check が通る（他 Agent 起因の失敗はその旨を報告）
- 追加した仕組みに日本語名のテストがある
- 一時ファイルを残していない

## 報告形式
1. 変更ファイル（新規 / 変更）
2. 追加した型フィールド・定数・公開関数
3. 統合手順（共有ファイルに必要な Edit、呼び出し箇所）
4. テスト結果（件数、失敗があれば原因）
5. 懸念点（あれば 3 行以内）
```

## よくある事故と対策

| 事故 | 何が起きるか | 対策 |
| --- | --- | --- |
| 全文書き換えによるクロバー | 共有ファイルを Write で丸ごと書き、並行 Agent の変更が消える | 共有ファイルは Edit のみ。統合前に `git diff <file>` で他人の変更が残っているか確認 |
| 一時ファイルの放置 | `tmp_*.ts`、ログ、調査用スクリプトがリポジトリに残りコミットされる | 一時ファイルは scratchpad へ。統合時に `git status --short` で未知のファイルを確認 |
| テストの英語アサーション | 日本語化でテストが英語の表示文字列に依存して壊れる / 方針違反 | it 名・メッセージは日本語。表示文字列ではなく key や数値で検証する |
| `git add -A` | 他 Agent の作業途中の変更まで混ざる | 所有ファイルを列挙して add |
| 描画での rng 消費 | リプレイと QA の再現性が崩れる | 描画のばらつきは座標ハッシュ。レビューで `state.rng` の出現箇所を確認 |
| 数値の直書き | 調整箇所が散らばる | tuning.ts に定数ブロック。レビューで指摘 |
| 等幅前提の文字幅 | 日本語でレイアウトが崩れる | `measureText` / `PixelText.width` / `wrapByWidth` |
| 状態の選択待ちで bot が止まる | QA が途中で進まなくなる（祝福 3 択の前例） | モーダルな状態を足したら `src/qa/bot.ts` の対応も所有に含める |
| 失敗を他人のせいにして終わる | 本当は自分の変更が原因 | 失敗したテストのファイルが自分の所有かを確認し、再現手順を報告 |

## サブエージェントと skill の対応

| やりたいこと | skill | Agent |
| --- | --- | --- |
| 型検査・テスト・ビルド | `/check` | - |
| フル QA と報告 | `/qa` | qa-runner |
| 敵 / アフィックス / スキル / 祝福の追加 | `/add-enemy` `/add-affix` `/add-skill` `/add-boon` | implementer（+ pixel-artist） |
| 機能の並列実装 | `/parallel` | implementer × N |
| 直近コミットのレビュー | `/review` | reviewer |
| 引き継ぎ文書の更新 | `/handoff-docs` | - |
| 変更点まとめ | `/release-notes` | - |
| バージョンを上げる | `/bump` | - |
| アイデア出し | - | brainstormer |
| 日本語化 | - | localizer |
| 数値調整 | - | balance-tuner |
