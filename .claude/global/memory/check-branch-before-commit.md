---
name: check-branch-before-commit
description: ローカルのセッションは master で作業してよい（2026-10-05）。並列で動かすときは worktree で分ける。クラウドはブランチ + PR。コミット前に今のブランチは確かめる
metadata:
  node_type: memory
  type: feedback
  originSessionId: e5390b4c-7aab-421d-a2f0-430c6a7ab9eb
  modified: 2026-10-04T20:55:40.050Z
---

ローカルのセッションでは master で作業・コミットしてよい（ブランチも PR も要らない）。並列で動かすとき（サブエージェントを複数・別セッションと同時）は worktree で分ける。クラウドのセッションは従来どおりブランチを切って PR。コミットの前に `git branch --show-current` で今のブランチは確かめる。

**Why:** 2026-10-05、PR のマージ後に作業ツリーが master へ切り替わっていたのに気づかず master にコミットし、「push すると PR に加わる」と誤って案内した。ユーザーはこれを機に「ローカルは master で作業してよい、並列は worktree」と決まりを改めた（`docs/AI_WORKFLOW.md` の「ブランチと PR」、CLAUDE.md）。

**How to apply:** ローカルでは master のままコミットしてよいが、コミットはユーザーの指示があるときだけ・push はユーザーが `! git push`。push を頼む前に push 先（どのブランチか）を正しく伝える。並列の実装は `isolation: "worktree"`。関連: [[delegate-to-subagents]] [[cloud-session-sync]]
