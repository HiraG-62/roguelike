# レシピ: スプライト

- `src/data/sprites.ts` の `SPRITES` にフレーム配列（1 フレーム = 文字列の行配列）。様式書（`docs/ideas/graphics-style.md`）で描き直した家族は `src/data/sprites/<family>.ts`（beasts / bosses / cloister / heavy / player / shallows / still / w3back / w3front / weapons。共通の小道具は `frameKit.ts`）に置き、`sprites.ts` の末尾で合流する。新しい敵は近い家族のファイルに足す。`'.'` は透明、他は `PALETTE` の 1 文字。キャラは **右向き** で描く（左は描画側で反転）
- 通常 16x16、ボス 32x32、ゴーレム 24x24、小物 8x8 / 12x12。歩行は 4 フレーム。全フレーム同寸
- 新色は `PALETTE` に 1 文字キーで追加。テスト（`render/sprites.test.ts`）が寸法・パレット・空フレームを検査

## エフェクト（攻撃・スキル・命中など）

- 手で打たず **生成器**（`scripts/fx/`）で描く。設計と決まりは `docs/ideas/fx-sprites.md`（密度 2 倍・段の配色・方向の事前描画・時間割）
- 1 武器種 = 1 ファイル `scripts/fx/sheets/<武器種の key>.mjs`（登録は要らない。`gen.mjs` が自動で集める）。`export const ATLAS = { key, sheets, fx }` を持ち、`fx` がモーション → シートの表（`motions` の key は `l:<段>` / `r:<右の段の key>` / `branch:<派生の key>` / `dash` / `charge`、命中 `hit` / `hitHeavy`）。手本は `sword.mjs`
- 形の部品は `shapes.mjs`（三日月・レンズ形の斬線・速度線・輪・刃片）、弧の斬撃の時間割は `motifs.mjs`、塗りの道具は `raster.mjs`。部品を土台にしつつ、その武器だけの形を必ず足す
- 確認しながら詰める: `node scripts/fx/gen.mjs --only <シートの key> --preview <scratchpad の dir> --dirs 0,3 --scale 4` で配色済みの一覧 PNG を描いて目で見る
- 仕上げに `node scripts/fx/gen.mjs --atlas <key>`（その武器の PNG と `src/data/fx/<key>.gen.json`、束ねる `src/data/fxSheets.gen.ts` を書き直す）。全部は `npm run fx:gen`。表の網羅（振りのモーションをすべて持つ）は `render/fxSprites.test.ts` が検査する。時間の割り付けの数値は `src/data/balance/feel/FX_ATTACK/sprite.json`
- 表の任意の項目: `mirror`（`faceLeft` / `faceRight`: 突きの鉤など非対称な絵を手に持つ武器の向きに合わせる）、`ground`（キャラより下に描く地面の層のシート）、`holds`（右の溜めの段の回しを押している間の繰り返しの絵）。手本は `scythe.mjs` / `hammer.mjs` / `flail.mjs`
- 弾（銃・魔法・弾を出す技）: 武器種のファイルの `fx.bullets`（弾の key → `fly` / `muzzle` / `impact` / `hit` / `fizzle` / `blast`）。弾を出す武器種はその武器種が撃つ弾をすべて載せる。奥義: `scripts/fx/sheets/<武器種>Ult.mjs`（アトラス `<武器種>Ult`）の `fx.ultimates`（奥義の key → 発動・行為・持続の纏いの絵）。形と時間割は `docs/ideas/fx-sprites.md` 9 章。配色の確認は `--ramps brass,fire`
- 見た目の決まり（剣で固まったもの）: 内側に 2 本目の弧を重ねない・速度線は刃の外側だけ・斬線の反りは前（敵の側）へふくらむ。詳しくは `docs/ideas/fx-sprites.md`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
