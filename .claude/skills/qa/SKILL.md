---
name: qa
description: フル QA シミュレーション（npm run qa:full）を実行し、src/qa/report.md の前回との差分を要約する。
---

# /qa

数分かかるので qa-runner エージェントに任せる。

1. Agent を起動する（subagent_type: `qa-runner`）。プロンプト:
   ```
   npm run check と npm run qa:full を実行し、src/qa/report.md を前回版（git の HEAD）と比較して報告して。
   前回版の手書き調査メモでまだ有効なものは新しい report.md の末尾に戻すこと。コードは直さない。
   ```
2. 完了報告を受け取ったら、`git diff --stat src/qa/report.md` で更新を確認する
3. ユーザーへの報告
   - check の成否
   - 主要指標の差分表（平均到達 depth / 死亡率 / kills / Reaper 出現 / ボス撃破率 / step 時間）
   - 問題（重大度順）と調整提案（3 件まで）

手元で直接回すなら `npm run qa:full`（report.md を上書き）か `npm run qa:full -- --no-write`。
