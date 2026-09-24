# レシピ: 攻撃ジャンル・属性

- ジャンル（範囲軸 × 質軸）は `core/element.ts` の `ATTACK_RANGES` / `ATTACK_QUALITIES` に型がある。新しい攻撃を追加するときは既存の 3×3 から選び、`AttackProfile`（`{ genre, element }`）を武器種（`data/weapons.ts` の `MOVESETS`。銃の弾は `loot/bullets.ts` の `BULLETS`）かスキル（`skills/data.ts` の `SKILL_ATTACK`）に渡す。ジャンルは敵の防御 / 魔防のどちらで受けるかだけを決め、参照ステータスは縛らない（`docs/COMBAT_DESIGN.md` A-10）
- 属性を増やすなら `core/element.ts` の `ELEMENTS` に足し、`ELEMENT_LABEL` に日本語名、`data/tuning.ts` の `ELEMENT`（弱点 / 耐性の倍率・関連する状態異常）、`data/enemyDefense.ts` の各敵に耐性値を追加（`Record` なので漏れは型エラー）。プレイヤー側は `loot/affixes.ts` に属性の変換（`cv_infuse*`）・耐性（`res_*`）の性質を足す
- 敵の防御・魔防・耐性・弱点は `data/enemyDefense.ts` の `ENEMY_DEFENSE`（`d(body, resist, attack, stages?)`。ボスは `stages` で段階ごとに上書き）。計算は `system/elementCombat.ts`、表示は `render/elementUi.ts`（弱点の頭上の印は倒すまで「？」）
- テスト: `system/elementCombat.test.ts` / `data/genre.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
- 新しい爆発は `system/effects.ts` の `spawnBlast` で積む（閃光 → 火球 → 煙 → 破片の段階と焦げ跡が付く。`spawnRing` はただの輪）。ダメージは `system/blast.ts` の `blastMulAt` で距離減衰を通す
