---
name: electron-only
description: ゲームは Electron でしか動かす予定がない。ブラウザ版の制約・分岐は考慮しなくてよい
metadata:
  node_type: memory
  type: project
  originSessionId: 0d17ddd3-289b-4524-b0da-2aaf8cdfcf5c
  modified: 2026-10-04T09:35:19.957Z
---

roguelike は基本的に Electron 版でしか動かすつもりがない（2026-10-04 ユーザー談）。ブラウザ版の事情（window.close が効かない等）は意識しなくてよい。

**Why:** 配布・プレイは Electron 前提。ブラウザ向けの分岐はコードを複雑にするだけ。
**How to apply:** 「ゲームを終了する」などの機能は Electron で動けば十分。ブラウザ用の判定・フォールバックや表示の出し分けを作らない（dev サーバは開発確認用）。
