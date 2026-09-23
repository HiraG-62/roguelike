---
name: check
description: npm run check（tsc → vitest → vite build）を実行して結果を要約する。作業完了の確認に使う。
---

# /check

1. `npm run check` を実行する（timeout 600000 ms）
2. 出力から次を拾う
   - どの段（tsc / vitest / vite build）まで通ったか
   - vitest の `Test Files` と `Tests` の行（成功 / 失敗 / skip の件数）
   - 失敗があれば、失敗したテストのファイルと it 名、エラーの 1 行目
   - tsc のエラーはファイル:行とメッセージ
3. 失敗したファイルが `git status --short` で未コミット変更中のもの（並行作業中の可能性）かを確認する

## 報告（箇条書きのみ）
- 結果: 成功 / 失敗（どの段で）
- テスト: 成功 n / 失敗 n / skip n
- 失敗一覧: `ファイル > it 名: エラー`（最大 10 件）
- 失敗ファイルのうち未コミット変更中のもの

修正は頼まれたときだけ行う。
