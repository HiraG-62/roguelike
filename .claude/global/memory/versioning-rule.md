---
name: versioning-rule
description: roguelike のバージョン規約 — x.xx.xx、メジャーはユーザー指示のみ、α 期間は 0.0.xxα
metadata:
  node_type: memory
  type: feedback
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-09-23T03:59:34.010Z
---

バージョンは x.xx.xx（メジャー.マイナー.パッチ）。メジャーは大規模アップデートのみで、ユーザーの指示がない限り動かさない。マイナーは機能追加やそれなりに大きな変更、パッチは小規模な追加・変更・バグ修正・整備。ある程度形になるまでは α 版として「0.0.xxα」で進める（2026-09-23 に 0.0.1α から開始）。

**Why:** 2026-09-23 にユーザーが明示。長期プロジェクトになる見込みで履歴を管理したい。

**How to apply:** まとまった作業の区切りで `node scripts/bump.mjs patch|minor` を使い、CHANGELOG.md・package.json・src/version.ts・git tag を同時に更新する（`/bump` skill）。メジャーは提案のみで実行しない。関連: [[roguelike-hack-and-slash-vision]]
