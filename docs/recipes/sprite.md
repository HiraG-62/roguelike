# レシピ: スプライト

- `src/data/sprites.ts` の `SPRITES` にフレーム配列（1 フレーム = 文字列の行配列）。様式書（`docs/ideas/graphics-style.md`）で描き直した家族は `src/data/sprites/<family>.ts`（beasts / bosses / cloister / heavy / player / shallows / still / w3back / w3front / weapons。共通の小道具は `frameKit.ts`）に置き、`sprites.ts` の末尾で合流する。新しい敵は近い家族のファイルに足す。`'.'` は透明、他は `PALETTE` の 1 文字。キャラは **右向き** で描く（左は描画側で反転）
- 通常 16x16、ボス 32x32、ゴーレム 24x24、小物 8x8 / 12x12。歩行は 4 フレーム。全フレーム同寸
- 新色は `PALETTE` に 1 文字キーで追加。テスト（`render/sprites.test.ts`）が寸法・パレット・空フレームを検査

## エフェクト（攻撃・スキル・命中など）

- 手で打たず **生成器**（`scripts/fx/`）で描く。設計と決まりは `docs/ideas/fx-sprites.md`（密度 2 倍・段の配色・方向の事前描画・時間割）
- 武器 / スキルごとに `scripts/fx/sheets/<名前>.mjs` を作り、`gen.mjs` の `ATLASES` に足す。形の部品は `shapes.mjs`（三日月・レンズ形の斬線・速度線・輪・刃片）、塗りの道具は `raster.mjs`
- 確認しながら詰める: `node scripts/fx/gen.mjs --only <シートの key> --preview <scratchpad の dir> --dirs 0,3 --scale 4` で配色済みの一覧 PNG を描いて目で見る
- 仕上げに `npm run fx:gen`（PNG と `src/data/fxSheets.gen.ts` を書き直す）。どのモーションで使うかは `src/render/fxMotions.ts` の `MOVESET_FX` に足す。時間の割り付けの数値は `src/data/balance/feel/FX_ATTACK/sprite.json`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
