# レシピ: 敵

0. 数値（HP・速度・予告・怯み耐性・防御など）は `src/data/balance/enemies.json` の `stats` / `combat` / `defense.enemies` に同じ key で足す（無いと `...N.key` で tsc が落ちる）
1. `src/data/enemies.ts`: `EnemyBehavior` に追加（既存 behavior の流用なら不要）、`ENEMIES` に `EnemyDef`（`name` は日本語、`minDepth` / `weight` / `windup` はテレグラフが読める長さ）。既存の敵の色替え + 挙動 1 つの追加なら新規 behavior を作らず `EnemyDef.recolor`（元のスプライトと behavior を流用し、色と 1 挙動だけ差し替える）
2. `src/system/enemies.ts`: `STRIKE_SPEED_MUL` / `WINDUP_MOVE_MUL`（`Record<EnemyBehavior, number>` なので追加漏れは型エラー）と behavior の分岐。AI の数値は tuning の `ENEMY_AI`。個別 behavior の処理は `enemyBehaviors.ts`、死骸・取り巻き・気力奪取などの横断的な仕組みは `enemyTraits.ts`
3. `src/data/sprites.ts`: `SPRITES[def.sprite]` を追加（下記スプライト）。`render/sprites.test.ts` が全敵のスプライト存在を検査する
4. 必要なら `render/renderer.ts` に専用の予告表現、`audio` に効果音
5. テスト: `system/enemies.test.ts` に「windup → strike で当たる」「予告中は無害」など

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
