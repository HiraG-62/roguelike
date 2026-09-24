# レシピ: 状態異常

- 種類を増やすなら `src/core/status.ts` の `STATUS_KINDS` に追加し、`src/system/statusEffects.ts` に効果・持続・スタック規則・相互作用を実装、`src/render/statusUi.ts` の `STATUS_GLYPH` / `STATUS_COLOR` に表示を足す
- 既存 34 種に新しい付与経路を足すだけなら型を増やさず、以下のどちらかで `StatusApply`（kind / stacks / duration / potency）を渡す
  - スキルの命中: `SkillDef.applies`（上の「スキル」参照）。命中した敵に `applyStatus` で入る
  - 敵の攻撃: `src/data/enemyCombat.ts` の `EnemyCombatDef.inflicts`（`EnemyInflict[]`。`on` でどの攻撃種類か、`minDepth` で深度条件を絞れる）
- 装備の性質から確率で付与するなら `PlayerStats.statusProcs: StatusProc[]`（`chance` / `on: "melee" | "ranged" | "skill" | "any"` / `requiresCrit?`）を `loot/affixes.ts` の `apply` で足す。判定は on-hit の内部 CD（`StatusBag.procIcd`、`STATUS.onHitIcd`）で敵ごとに絞られる
- 2 つの状態異常（か地形の層）が出会ったときの追加効果（反応）を足すなら `src/core/status.ts` の `REACTION_KEYS` + `src/system/statusReactions.ts` に実装
- 床の地形の層を増やすなら `src/core/terrain.ts` の `TERRAIN_KINDS` + `src/system/terrain.ts` に効果、配置は `src/map/generator.ts` の `planTerrain`、描画は `src/render/terrainUi.ts`
- テスト: `system/statusEffects.test.ts`（相互作用・拘束上限・免疫）。敵の付与は `system/enemies.test.ts` に追加

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
