---
name: cloud-session-sync
description: グローバル CLAUDE.md・hook の注意文・この memory はリポジトリの .claude/global/ に写してある（npm run sync:claude）。memory を変えたら写し直す
metadata:
  node_type: memory
  type: project
  originSessionId: fed0a9b4-d946-4693-8519-edf0c7c297bb
  modified: 2026-09-24T14:08:12.373Z
---

2026-09-24 に、クラウドセッションでもローカルと同じ前提で開発できるよう `~/.claude/CLAUDE.md`・`hooks/court-guard-context.txt`・この memory ディレクトリを `E:\dev\roguelike\.claude\global\`（`PREFERENCES.md` / `memory/`）へ写し、リポジトリの `CLAUDE.md` から @import する形にした。写すのは `scripts/sync-claude-global.mjs`（`npm run sync:claude`、`--check` で差分確認）。

**Why:** クラウドセッションは `~/.claude` の内容（グローバルルール・自動メモリ・hook）を持たないため。

**How to apply:** ローカルで memory ファイルを追加・更新・削除したら `npm run sync:claude` を実行して `.claude/global/` の差分を一緒にコミットする。`.claude/global/` を手で編集しない。クラウド側で新しく覚えるべきことは `docs/HANDOFF.md` に書く。関連: [[handoff-file]] [[delegate-to-subagents]]
