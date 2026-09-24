---
name: roguelike-hack-and-slash-vision
description: roguelike プロジェクトの方向性 — リアルタイムアクション + PoE 風の永続ハクスラ装備（無限バリエーション）
metadata:
  node_type: memory
  type: project
  originSessionId: f524313c-58e4-4708-afb8-0d454729138b
  modified: 2026-09-22T20:13:05.008Z
---

E:\dev\roguelike は当初ターン制ローグライクだったが 2026-09-23 にリアルタイム・トップダウンアクション（Hades / Nuclear Throne 系、ドット絵）へ転換。さらに PoE 風ハクスラ要素を融合する方針:

- アイテムドロップはランを跨いで永続（localStorage）。装備して次のランに挑む
- 個体値・アフィックスの組み合わせ・レアリティで「同じ物が出る方が珍しい」無限バリエーション
- ローグライク（ランダムフロア・パーマデス・シード）× ハクスラ（ビルド・装備）で無限の可能性

**Why:** ユーザー本人の好み（常にキーを叩いていたい、ヴァンサバ系は嫌い、PoE の装備が好き）。

**How to apply:** 新機能はこの 2 軸のどちらかを深める方向で提案する。設計は docs/LOOT_DESIGN.md、手触り定数は src/data/tuning.ts。

**追加方針（2026-09-23 深夜）:** 「ゴール装備 / BiS テンプレ」を潰す。各プレイヤーの最強に優劣が付かないよう、トレードオフ・ソフトキャップ・相互排他キーストーン・trigger×condition×effect 文法によるアフィックス生成・シナジー網で設計する。アイテムスコアや DPS の単一指標は UI に出さない。docs/LOOT_DESIGN.md「設計哲学」節に詳細。
