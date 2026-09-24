---
name: parallel
description: 1 つの機能をファイル所有で分割し、複数の実装エージェントを並列に起動する計画を立てて実行する。
---

# /parallel <機能の概要>

## 1. 計画を作る（ユーザーに見せてから起動する）

```
機能: <1 段落>
参照: <設計文書>

| レーン | Agent | 所有ファイル（新規 / 既存） | 最小 Edit 許可 | 依存 |
| --- | --- | --- | --- | --- |
| A | implementer | src/system/xxx.ts（新規）, src/system/xxx.test.ts | state.ts: <フィールド>, balance/<file>.json + tuning.ts: XXX ブロック | なし |
| B | implementer | src/render/xxxUi.ts（新規） | renderer.ts: 呼び出し 1 行 | A の型 |
| C | pixel-artist | src/data/sprites/<family>.ts | - | なし |

共有ファイルの担当: state.ts = A、game.ts = 統合役、balance/*.json と tuning.ts = ブロックごと
統合順: A → B → C → reviewer → qa-runner
```

分割のルール
- 1 ファイルの所有者は 1 レーン。共有ファイル（state.ts / game.ts / tuning.ts と balance/*.json / renderer.ts / main.ts / combat.ts / sfxNames.ts / sfxLayers.ts）は「追加分だけの Edit」を許可として明記。同じ共有ファイルを複数レーンが触るなら「old_string を短く取る」「末尾ではなく既存の目印の直後に足す」と伝える
- 新しい敵・修飾子・部屋を足すと seed 依存のテストが落ちることがある（抽選がずれる）。seed を変えるのではなく、テストの意図を守る形で堅牢化する
- 型の依存があるなら、型を定義するレーンを先に走らせるか、プロンプトに型定義をそのまま書いて両方に渡す
- レーンは 2〜5 本。細かすぎると統合コストが勝つ

## 2. 起動する

- 各レーンを 1 メッセージで並列に Agent 起動する。プロンプトは `docs/AI_WORKFLOW.md` の雛形（所有ファイル / 編集禁止 / 先に読む / 仕様 / 完了条件 / 報告形式）
- 編集禁止欄には **他レーンの所有ファイル** を必ず列挙する

## 3. 統合する

1. 各報告の「統合手順」を適用する（共有ファイルは Edit で）
2. `git diff` で共有ファイルに他レーンの変更が残っているか確認する（クロバー検出）
3. `git status --short` で一時ファイルが無いか確認する
4. `npm run check`（多レーン並列中は負荷で `replay.test.ts` / `qa/simulation.test.ts` がタイムアウトすることがある。負荷が下がってから回す）
5. `/review` → `/qa`
6. コミット（ユーザーの指示がある場合）: レーンごとに `git add <所有ファイル>` → `git commit -m "<type>: <日本語>"`
