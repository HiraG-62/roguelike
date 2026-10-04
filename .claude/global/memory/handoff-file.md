---
name: handoff-file
description: セッション開始時は E:\dev\roguelike\docs\HANDOFF.md を最初に読む。進行中レーン・次の候補・ユーザーに聞くことが書いてある
metadata:
  node_type: memory
  type: project
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-09-24T02:54:41.172Z
---

`docs/HANDOFF.md` が引き継ぎの起点（2026-09-24 に作成）。現在地・進行中のレーン・次の候補・ユーザーに聞くことだけを 100 行以内で持つ。バッチを統合してコミットするたびに更新する。2026-10-04 に整理し、積み残しは `docs/BACKLOG.md`、統合の作法は `docs/AI_WORKFLOW.md`、過去の経緯は `docs/archive/` へ分けた。

**Why:** 利用上限で会話が途中で切れることが複数回あり、ユーザーが「引き継ぎファイルを優先的に作って」と依頼した。

**How to apply:** 新しいセッションはまず `docs/HANDOFF.md` → `IDEAS.md` の現状 → `CHANGELOG.md` の順に読む。中断したレーンは名前宛ての SendMessage で再開できる（文脈を保持）。HANDOFF の「進行中のレーン」表は、レーンを起動・完了するたびに書き換える。**節を積み増さず「現在地」は上書きする**（積み増して 227 行まで膨らんだため。`pnpm run audit:docs` が行数を検査）。関連: [[user-memo-dir]] [[content-volume-policy]] [[delegate-to-subagents]]
