# AGENTS.md（roguelike プロジェクト / Codex 向けの入口）

このプロジェクトのルールの本体は `CLAUDE.md` にある。ここには写さない（二重管理で食い違わせないため）。作業の前に必ず次を読んで従うこと。

1. `CLAUDE.md`: プロジェクト概要・コマンド・コードの地図・**不変条件**・レシピの索引・コミットと PR の作法
2. `.claude/global/PREFERENCES.md`: ユーザー共通のルール（Claude Code はグローバル設定か SessionStart hook で読むが、Codex には載らないので直接読む）
3. 足す要素に対応する `docs/recipes/*.md`、触る層の `docs/CODE_MAP.md`。表示文字列を書くなら `docs/GLOSSARY.md`

## Codex で特に守ること

- 応答・コメント・報告はすべて日本語
- Claude Code から委譲された作業では、依頼文の「所有ファイル」と「最小の Edit を許したファイル」以外は触らない。コミット・push・ブランチ操作はしない（統合とコミットは Claude Code が行う）
- エージェント資料（`CLAUDE.md`・`docs/`・`.claude/`）や `CHANGELOG.md` は、依頼文で指示されたときだけ直す。直す必要に気づいたら報告に「資料に必要な変更」として書く
- 完了の判定は `pnpm run check`（途中確認は `pnpm run check:fast`）。通らないまま完了と報告しない。実行したコマンドと結果を報告に含める
- 依頼文と `CLAUDE.md` が食い違う、または設計の判断が要る場合は、推測で進めずに報告で止める
