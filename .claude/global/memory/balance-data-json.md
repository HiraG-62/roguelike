---
name: balance-data-json
description: バランス調整用の数値（武器・ジョブ・敵・スキル・祝福・ドロップなど）はユーザーが手で触れる JSON に置く。コードに数値を混ぜない
metadata:
  node_type: memory
  type: feedback
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-09-24T10:39:38.894Z
---

こまめに数値を変えて調整したいデータ（武器種のステータス、ジョブのステータス、敵のステータスなど）は、ユーザーが JSON を開いて値を書き換えるだけで調整できる作りにする。既存のものも、これから足すものも同じ（2026-09-24 に明言）。

**Why:** 数値がコードに混ざっていると、ユーザーが自分でバランス調整するのが面倒。

**How to apply:** 新しい要素を足すときは、数値を JSON（設計は `docs/ideas/data-externalization.md`）に置き、振る舞い（関数）だけを TS に書く。サブエージェントへの実装指示にもこの決まりを入れる。関連: [[content-volume-policy]]
