# レシピ: スプライト

- `src/data/sprites.ts` の `SPRITES` にフレーム配列（1 フレーム = 文字列の行配列）。様式書（`docs/ideas/graphics-style.md`）で描き直した家族は `src/data/sprites/<family>.ts`（beasts / bosses / cloister / heavy / player / shallows / still / w3back / w3front / weapons。共通の小道具は `frameKit.ts`）に置き、`sprites.ts` の末尾で合流する。新しい敵は近い家族のファイルに足す。`'.'` は透明、他は `PALETTE` の 1 文字。キャラは **右向き** で描く（左は描画側で反転）
- 通常 16x16、ボス 32x32、ゴーレム 24x24、小物 8x8 / 12x12。歩行は 4 フレーム。全フレーム同寸
- 新色は `PALETTE` に 1 文字キーで追加。テスト（`render/sprites.test.ts`）が寸法・パレット・空フレームを検査

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
