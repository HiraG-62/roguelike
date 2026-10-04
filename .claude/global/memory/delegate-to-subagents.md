---
name: delegate-to-subagents
description: メインは Opus で設計・統合に徹する。設計判断・診断・ドット絵は Opus、設計が固まった実装と定型は Sonnet のサブエージェントに委任し、Fable は超思考が要る場面だけ上書きで呼ぶ
metadata:
  node_type: memory
  type: feedback
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-10-05T00:00:00.000Z
---

**実装とレビューは Codex 優先**（2026-10-05、ユーザーの指示）: 利用枠が空いていれば、設計済みの実装レーンは `codex:codex-rescue`、レビューは Codex（companion の review）に指示を待たず任せ、メインが diff と指摘を確かめる。Codex と reviewer の二重レビューはしない。枠が無いときだけ下の Claude のサブエージェント。詳細は `docs/AI_WORKFLOW.md`「Codex の使い方」。

メイン（統合役）のモデルは Opus。サブエージェントは 2 段で使い分ける（正は `docs/AI_WORKFLOW.md` の「モデルの使い分け」と `.claude/agents/*.md` の `model:`）。
- Opus: architect（設計判断・原因の見えない不具合の診断・影響分析）/ pixel-artist
- Sonnet: implementer / qa-runner / localizer / reviewer / brainstormer / balance-tuner（設計が固まっていることが前提。詰まったら `model: "opus"` で上書きして再投入）
- Fable: 常用しない。Opus の architect で 2 回詰まった・決定性やリプレイの原因が見えない・大規模な設計の分かれ道、のときだけ `model: "fable"` で上書きして呼ぶ

**Why:** 2026-09-23 に「実装・テスト・レビューはサブエージェントに委任」、2026-09-24 に「設計がしっかりできていればコーディングは下位モデルに任せてよい」とユーザーが明示。当初は architect / reviewer / brainstormer を Fable にしていたが、高価なので後に Opus / Sonnet へ下げた。コストとコンテキストを抑えつつ、難所だけ強いモデルに当てるため。

**How to apply:** メインはファイル全文を読まず、機能をファイル境界で分割して並列で Agent を起動する。「なぜそうなるか分からない」「複数の層にまたがる」問題は architect に仮説と対象ファイルを添えて投げる。決定性・リプレイ・永続化に触るレビューは reviewer を `model: "opus"` で上書きする。関連: [[autonomous-overnight-progress]]
