---
name: review
description: 直近のコミット群（または未コミットの変更）を Codex にレビューさせ、メインが指摘を確かめて直す。Codex の枠が無ければレビューエージェントに渡す。
---

# /review [コミット数 or 範囲]

1. 範囲を決める
   - 引数なし: 前回のレビューコミット（`git log --oneline` で `fix: …レビュー` を探す）以降。見つからなければ直近 5 コミット
   - 数値 N: `HEAD~N..HEAD`
   - 未コミット変更がある場合はそれも含める（`git status --short`）
2. `git log --oneline <範囲>` と `git diff --stat <範囲>` で対象を把握する
3. Codex の枠を確認する: `node "C:/Users/Horry/.claude/skills/codex-orchestra/scripts/limits.mjs"`。`limited` なら 5 へ（両方は回さない。`docs/AI_WORKFLOW.md`「Codex の使い方」）
4. **Codex でレビュー**（既定）: `node "C:/Users/Horry/.claude/skills/codex-orchestra/scripts/companion.mjs" review --wait --base <範囲の起点>`（未コミットだけなら `--scope working-tree`）
   - 指摘ごとにメインがコードを読んで真偽を確かめ、確かなものだけ直す（大きい直しは Codex / `implementer` へ）。誤りと判断した指摘は理由を 1 行で残す
   - ユーザーへの報告は「採った指摘 / 退けた指摘と理由」の箇条書き。終わったら 6 へ
5. **代わりに reviewer**（Codex の枠が無いとき）: 並行作業中の Agent がいるなら、その所有ファイルを「編集禁止」に入れて起動する（subagent_type: `reviewer`。決定性・リプレイ・永続化に触るなら `model: "opus"`）

```
<範囲>（<コミット一覧>）をレビューし、確信のあるバグは修正まで行って。コミット禁止。日本語。

## 対象
- git diff <範囲>（未コミット変更 <あり / なし>）
## 編集禁止
- <並行作業中の所有ファイル>
## 特に見てほしい点
- <今回の変更の要注意点。例: 新しいモーダル状態、リプレイへの影響、毎フレームの割り当て>
## 報告形式
reviewer 定義の報告形式
```

6. `pnpm run check`。修正はコミット形式 `fix: <レビューの要約>` でまとめる（ユーザーの指示がある場合）
