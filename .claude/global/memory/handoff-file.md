---
name: handoff-file
description: セッション開始時は E:\dev\roguelike\docs\HANDOFF.md を最初に読む。進行中レーン・次の候補・ユーザーに聞くことが書いてある
metadata:
  node_type: memory
  type: project
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-09-24T02:54:41.172Z
---

`docs/HANDOFF.md` が引き継ぎの起点（2026-09-24 に作成、0.0.9α 時点）。現在地、進行中のサブエージェント（名前と所有ファイル）、統合の作法、次にやる候補、ユーザーに聞くことをまとめている。バッチを統合してコミットするたびに更新する。

**Why:** 利用上限で会話が途中で切れることが複数回あり、ユーザーが「引き継ぎファイルを優先的に作って」と依頼した。

**How to apply:** 新しいセッションはまず `docs/HANDOFF.md` → `IDEAS.md` の現状 → `CHANGELOG.md` の順に読む。中断したレーンは名前宛ての SendMessage で再開できる（文脈を保持）。HANDOFF の「進行中のレーン」表は、レーンを起動・完了するたびに書き換える。関連: [[user-memo-dir]] [[content-volume-policy]] [[delegate-to-subagents]]
