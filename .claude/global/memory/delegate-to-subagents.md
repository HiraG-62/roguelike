---
name: delegate-to-subagents
description: メインは Opus で設計・統合に徹し、高度な推論（設計判断・診断・深いレビュー・発想）は Fable、設計が固まった実装と定型は Sonnet のサブエージェントに委任する
metadata:
  node_type: memory
  type: feedback
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-09-24T00:00:00.000Z
---

メイン（統合役）のモデルは Opus。サブエージェントは 3 段で使い分ける。
- Fable: architect（設計判断・原因の見えない不具合の診断・影響分析）/ reviewer / brainstormer
- Opus: pixel-artist / balance-tuner
- Sonnet: implementer / qa-runner / localizer（設計が固まっていることが前提。詰まったら model を opus に上書きして再投入）

**Why:** 2026-09-23 に「実装・テスト・レビューはサブエージェントに委任」、2026-09-24 に「基本は Opus、高度な知識や推論が必要な部分は Fable のサブエージェントに委任」「設計がしっかりできていればコーディングは下位モデルに任せてよい」とユーザーが明示。コストとコンテキストを抑えつつ、難所だけ強いモデルに当てるため。

**How to apply:** `.claude/agents/*.md` の `model:` に固定済み（`docs/AI_WORKFLOW.md` の「モデルの使い分け」）。メインはファイル全文を読まず、機能をファイル境界で分割して並列で Agent を起動する。「なぜそうなるか分からない」「複数の層にまたがる」問題は architect に仮説と対象ファイルを添えて投げる。関連: [[autonomous-overnight-progress]]
