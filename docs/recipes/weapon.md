# レシピ: 武器種 / 銃の弾

- `src/data/weapons.ts`: `MOVESET_KEYS` に key を足し `MOVESETS` に `MovesetDef`（3 段コンボ各段の `MeleeStepDef`: windup / active / recover / `Scaling` / 怯み値と `poiseRatio` / 当たり判定の形 `HitShape` / 手触りの任意項目）。左で撃つ銃の家系は `primary: "shot"` にして `GUN_MOVESETS` に足す。数値は tuning の `WEAPON`
- **射撃の型（共有の弾の表）は無い。弾は銃のベースごとに持つ**: 数値は `src/data/balance/weapons.json` の `WEAPON.bullets.<ベースの key>`（`BulletDef` の数値。sway / homing / bounce / charge / mine / burst / boomerang / lob の挙動ブロックを持てばその挙動になる）、語と素性は `src/loot/bullets.ts` の `BULLET_PROFILES`。銃のベースを足したら両方に 1 件ずつ足す（`balance.test.ts` がキー集合を検査）。弾を出す固有技は `art.throw.bullet` に自分の弾を持つ
- 祝福・統一ルール・性質が「設置弾を撃つとき」のように弾で絞るときは、弾の性質（`BulletFeature`。数値から `bulletFeatures` が読む）で書く（`BoonLoadout.bullets` / 条件 `{ kind: "bullet", has }` / `statsBulletHas`）。ベースの key で分岐しない
- 各段・弾の参照ステータスは `docs/STATS_AND_SCALING.md` に従う（効果から見て納得できるもの。怯み値の `poiseRatio` も付ける）
- ベースへの紐付け: `src/loot/bases.ts` の `BASES` で右手のベースに `moveset` を指定（`PlayerStats.moveset` へ流れる）。銃の家系のベースは `PlayerStats.bullet` に自分の key が入る
- 呼び出し側: `system/player.ts` が `stats.moveset` で `MOVESETS` を、`stats.bullet` で `loot/bullets.ts` の `BULLETS` を引いて発動処理を分岐
- テスト: `data/weapons.test.ts` / `loot/bullets.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
