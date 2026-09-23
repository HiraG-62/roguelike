---
name: add-enemy
description: 新しい敵を CLAUDE.md のレシピに沿って追加する。実装エージェント（とドット絵エージェント）を起動する手順とプロンプト雛形。
---

# /add-enemy <敵の概要>

1. 概要から次を決める（足りなければ 1 回だけ質問する）: 日本語名 / key / behavior（既存流用か新規か）/ テレグラフ（何を見せてから何をするか）/ 出現 depth / 対処法（近接・射撃・ダッシュ・弾斬りのどれが報われるか）
2. `docs/ideas/run-structure.md` の「敵の追加案」と `docs/DESIGN_PRINCIPLES.md` に照らす（避けられない攻撃を作らない）
3. Agent を 2 つ並列で起動する
   - `pixel-artist`: 所有 `src/data/sprites.ts`。キー `<sprite>`、サイズ、フレーム（待機 / 予備動作）
   - `implementer`: 下の雛形
4. 報告を受けて `npm run check`。コミットは統合側で `git add <所有ファイル>`

## implementer への雛形
```
新しい敵「<日本語名>」（key: <key>）を追加する。コミット禁止。日本語。

## 所有ファイル
- src/data/enemies.ts（ENEMIES への追加、必要なら EnemyBehavior）
- src/system/enemies.ts（behavior の分岐、STRIKE_SPEED_MUL / WINDUP_MOVE_MUL）
- src/system/enemies.test.ts
## 最小 Edit のみ許可
- src/data/tuning.ts: ENEMY_AI に <key> 用の項目を追加
- src/render/renderer.ts: 予告表現が要る場合のみ、該当 behavior の分岐を追加
- src/audio/sfxNames.ts / src/audio/sfx.ts: 新しい効果音が要る場合のみ
## 編集禁止
- src/data/sprites.ts（pixel-artist が並行作業中。スプライトキーは <sprite>）
## 先に読む
- CLAUDE.md（不変条件、レシピ「敵」）、src/data/enemies.ts、src/system/enemies.ts、近い既存 behavior（<例: bomber>）
## 仕様
- 行動: <idle → chase → windup で何を見せる → strike で何をする → recover>
- 数値: hp / speed / windup / engageRange / attackInterval / minDepth / weight / dropChance（初期値の目安: <…>）
- エリート化・Reaper・ボス部屋との相互作用: <…>
## 完了条件
- テスト（日本語）: 予備動作中は無害 / strike で当たる / 出現 depth の条件 / <固有の仕組み>
- npm run check が通る（スプライト未到着による失敗はその旨を報告）
## 報告形式
CLAUDE.md「並列開発の作法」の完了報告形式
```
