# レシピ: スキル / 刻印符

- スキル石: `skills/types.ts` の `SKILL_KEYS` → `skills/data.ts` の `SKILL_DEFS`（大拡張分は `skills/defs.ts` に書いて `SKILL_DEFS` に混ぜる）
  - `resource: "mana" | "cooldown"` を選ぶ。気力型は `manaCost` を消費（`cooldown` は 0、チャージは常に 1）、再使用型は `manaCost` 0 で既存の `cooldown` / `charges` を使う。どちらも `minInterval`（スロットごとの連打下限）がかかる。全スロット共通の待ち（旧 GCD）は無く、同じステップに押した複数スロットは 1→4 の順にすべて発動する。本動作（`active`）を持つ近接・移動系は `exclusiveGroup: "body"` で互いに排他、それ以外（設置・強化・射撃の一部）は本動作中でも並行して撃てる
  - 威力は `Scaling`（`{ base, str?, dex?, vit?, mnd?, spi? }`）で書く。参照するステータスは行動ごとに自由（1 種・複数・全部・0 種 = 基礎値だけ。ジャンルで縛らない）。`base` はステータス基礎値（各 5）のとき狙いの威力になるよう逆算する（`docs/COMBAT_DESIGN.md` A-6 / A-10）。呼び出し側で `system/attributes.ts` の `scaled(stats, scaling)` を通す
  - 怯み値・状態異常の効果量も係数を持てる（数値ブロックの `poiseRatio`、`StatusApply.ratio`。基礎値での値 + 係数 × (実効値 − 5)、`withRatio`）。ステータスそのものが行動を伸ばす固定の派生は作らない（A-10）
  - 参照先の選び方・例外（0 種 / 3 種以上）・数値の目安・表示は `docs/STATS_AND_SCALING.md` に従う
  - `poise`（1 ヒットの基礎怯み値。最終値は × `poiseDamageMul`）を必ず入れる。状態異常を付けるなら `applies?: readonly StatusApply[]`（下記「状態異常」）
  - `SKILL` 定数（共通パラメータ）→ `system/skills.ts` の `castSlot` に発動処理（設置物なら `skills/placed.ts`）。発動処理の実体は近接型 `skills/actions.ts` / 弾型 `skills/shots.ts` / 設置・召喚型 `skills/summons.ts`、当たり判定の幾何は `skills/geom.ts`。数値は `skills/tuning.ts` に置き `SKILL.<key>` 経由で読む → `render/skillHud.ts` / `render/manaHud.ts` / `renderer.ts` の表現
  - 直前に撃った別のスキルを受けて効果が変わる「連携」を足すなら `skills/combos.ts` の `COMBOS`（発動元 → 受け側のキーで引く。受付秒は `SkillRunState.lastCast`）
- 刻印符: `MODIFIER_KEYS` → `MODIFIERS`（大拡張分は `skills/modifiers.ts`。`canAttach` の条件）→ `resolveCast` に効果。`CastParams.burdenMul`（旧 `cooldownMul`）は気力型ならコスト、再使用型なら再使用時間に掛かる。発動の「型」自体を変える型替え符は `ModifierDef.reshape`（リンク 2 本、1 スロット 1 枚まで）
- **相性表**: `skills/skills.test.ts` の `FORBIDDEN` を必ず更新（全組み合わせをテストで固定している）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。

## 技（共通技・武器技）

行為の列（扇・円・帯・踏み込み・跳躍・弾・連鎖・引き寄せ・強化・起爆）で書けるスキルは、発動処理を書かずに `skills/arts/` へ足す（`docs/ideas/weapon-skills.md` 1 章に行為と数値の目安）。

1. `skills/arts/keys.ts` の `COMMON_ART_KEYS`（共通技）か `WEAPON_ART_KEYS.<武器種>`（武器技。key は武器種の key で始める）の末尾に key を足す
2. 群のファイル（`common.ts` / `blades.ts` など）に `ArtSpec`（名前・1 文字アイコン・動詞・タグ・素性・行為の列）を足す
3. `data/balance/skills/ART/<武器種 | common>.json` に数値ブロック（`cost` か `cooldown`・`minInterval`・`poise`・照準を使うなら `range`、行為ごとのブロック）を足す。新しい項目名を使ったら `data/balance/skills/ART/_index.json` の `_fields` に 1 行
4. `npx vitest run src/skills/arts`（全技を 1 回ずつ撃つ検査がある）→ `npm run check`

行為の種類を足すときは `types.ts` の `ART_ACT_KINDS`・`build.ts` の必須項目 / 項目名・`engine.ts` の `runAct` の 3 か所。
