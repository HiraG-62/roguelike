---
name: content-volume-policy
description: ブレストで出たアイデアは「明らかに不要なもの以外」すべて実装する。コンテンツ量は多いほどよい
metadata:
  node_type: memory
  type: feedback
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-09-23T16:04:08.391Z
---

ユーザーは「コンテンツ量はいくらあってもいい。出てきたアイデアは明らかに不要なもの以外どんどん入れてほしい」と明言（2026-09-24）。ブレストのアイデアを取捨選択して数個だけ入れるのではなく、波（wave）に分けて量産する。全要素（スキル・装備・祝福・敵・状態異常・部屋）で相乗効果が生まれる設計を重視する。

**Why:** 「ベースはいい感じになってきた」段階で、次の価値は量と組み合わせの広さ。無駄なものは後から削る方針（以前から一貫）。

**How to apply:** ブレスト docs（`docs/ideas/*-expansion.md` 等）を順に実装レーンへ分割し、ファイル所有で並列に implementer を回す。除外するのは「決定性を壊す」「単一最強を作る」「既存と実質重複」のものだけで、除外理由を報告する。関連: [[roguelike-hack-and-slash-vision]] [[delegate-to-subagents]]
