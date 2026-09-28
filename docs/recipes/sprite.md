# レシピ: スプライト

- `src/data/sprites.ts` の `SPRITES` にフレーム配列（1 フレーム = 文字列の行配列）。様式書（`docs/ideas/graphics-style.md`）で描き直した家族は `src/data/sprites/<family>.ts`（beasts / bosses / cloister / heavy / player / shallows / still / w3back / w3front / weapons。共通の小道具は `frameKit.ts`）に置き、`sprites.ts` の末尾で合流する。新しい敵は近い家族のファイルに足す。`'.'` は透明、他は `PALETTE` の 1 文字。キャラは **右向き** で描く（左は描画側で反転）
- 通常 16x16、ボス 32x32、ゴーレム 24x24、小物 8x8 / 12x12。歩行は 4 フレーム。全フレーム同寸。これは密度 1（従来）の寸法で、**これから描く絵は密度 2 が基準**（下の「密度で描く」）
- 論理 48px 以上、または密度 2 以上の細かい絵は `PALETTE_RAMPS` の 5 段で塗る（系統と並びは様式書 2 章）。新しい系統を足すときは 5 色を `PALETTE` に足して `PALETTE_RAMPS` に 1 行（テストが明 → 暗の順を検査する）
- 新色は `PALETTE` に 1 文字キーで追加。テスト（`render/sprites.test.ts`）が寸法・パレット・空フレームを検査

## 密度で描く（`src/data/sprites/dots.ts`）

描画は論理 480x270 を `RENDER_SCALE`（4）倍のバックバッファに描く。スプライトは「密度」（論理 1px あたりのドット数 1 / 2 / 4）を持ち、描画側は論理寸法（`Sprite.w/h`）で扱う。**これから描く絵は密度 2 が基準**（論理 24px の敵なら 48x48 のフレーム、小型 16 → 32、ゴーレム・鎧 32 → 64、ボス 48 → 96。様式書 1 章の表）。

1. `SPRITE_DOTS`（`src/data/sprites/dots.ts`）にキーを `2` で登録する（ポーズ `<key>.windup` / `<key>.strike` は元のキーを継ぐので登録は要らない）
2. 48x48（人型）などの寸法でフレームを描く。頭上は論理 2 行 = `2 * dots` 行、体の芯は論理 12px = `12 * dots` 幅に寄せる。塗りは論理 48px 以上 / 密度 2 以上なので `PALETTE_RAMPS` の 5 段
3. `npm run sprite -- lint <key>` で密度に合わせた判定（頭上・中央帯・5 段）を確かめる
4. `npx vitest run src/render/sprites.test.ts` で寸法・パレットを確認してから `npm run check`

## 目で確かめながら描く（`npm run sprite`、`scripts/sprite/cli.mjs`）

真実はコード内のピクセルマップ。PNG と Aseprite はその**作業台**で、行き来は `npm run sprite` で行う。作業ファイルは `art/`（git 対象外）か scratchpad に置く。

1. **見る**: `npm run sprite -- render <key>[,<key>…] --out art/<key>.png --grid` で拡大した確認用 PNG（フレームは横・キーは縦、床色の背景）を描き、Read で開いて目で確かめる。拡大率は既定でキーごとに `8 / spriteDots(key)`（密度が違うキーを並べても論理サイズどおりの見た目で揃う）。`--scale <N>` で全キー同じ拡大率を強制、`--beside <参考 PNG>` で参考絵を右に並べて比べる。`--bg none` で透明背景
2. **点検**: `npm run sprite -- lint <key>` が様式書の癖（輪郭が閉じていない・頭上・最下段・白の量・暗部の無い 3 段 / 5 段崩れ）を座標付きで出す。判定は `spriteDots(key)` の密度に合わせて頭上の行数・中央帯・白の目安・3 段 / 5 段の切り替えが変わる。テストが落とす項目ではないので、意図があれば無視してよい
3. **Aseprite で直す**（任意）: `npm run sprite -- strip <key> --out art/<key>.png --ase art/<key>.aseprite` で等倍の横一列 PNG と、フレームに分けた `.aseprite`（`PALETTE` を `roguelike.gpl` として同梱）を作る。Aseprite の GUI で手直しするか、Agent なら MCP サーバー `aseprite` のツール（`draw_pixels_at` / `outline_cel` / `replace_color` / `render_onion_skin` など）で編集する。**PALETTE の色以外を置かない**（`quantize_to_palette` で丸められる）
4. **戻す**: `npm run sprite -- import art/<key>.aseprite --name <NAME>`（横一列 PNG も可、`--cell 24` で 1 フレームの寸法）が `Frame` のリテラルを標準出力に出すので、家族ファイルに貼る。`PALETTE` に無い色があれば失敗する（`--nearest` で最も近い色に丸める）。ゼロから Aseprite で描くときは `create_canvas` → `set_palette`（`npm run sprite -- palette --json` の配列）→ 描く → 同じ手順で戻す
5. 配布素材や参考画像（docs 直下の example フォルダ。git 対象外で手元にだけ置く）を下敷きにするときも 4 と同じ経路: PNG を `import --nearest` で `PALETTE` に丸めてから、様式書（輪郭 `k`・左上光源・3 段）に合わせて手で直す

## Spriteloom で下絵の案を出す（任意）

[Spriteloom](https://github.com/vkarach/spriteloom) はローカル GPU で動く画像生成（FLUX.2 Klein）のサーバーと Aseprite 拡張。**下絵の案**を出す道具で、そのまま採用はしない（様式書の輪郭 `k`・左上光源・3 段には必ず手で合わせる）。

- 置き場所: `E:\tools\spriteloom`（リポジトリの外。モデル約 15GB は同じ場所の `models/`）。Aseprite 拡張は `%APPDATA%\Aseprite\extensions\spriteloom`
- 起動: `E:\tools\spriteloom\start-server.bat`（モデルが GPU に載るまで約 25 秒〜）。ポートは `%APPDATA%\Spriteloom\config.json` の `port`（この PC は 8765 を別のツールが使うので 8766）で、拡張の server.json と `gen` も同じ値を使う。更新は `git pull` → `install-plugin.bat`
- **専用ページで（人が使うならこれ）**: `npm run dev` の間に `http://localhost:5173/tools/sprite-gen.html`（ポートは dev サーバーの表示どおり）を開く。主題・見え方・サイズ・密度・案の数・seed を入れて生成（Ctrl+Enter）すると、案を床色の上に拡大とゲーム内の大きさで並べ、様式書の点検（`lint` と同じ）も出す。「既存を描き変え」でキーとフレームを選べば `--from` と同じ。「並べて比べるキー」で既存の絵と論理サイズを揃えて並べる。選んだ案は「Frame をコピー」で PALETTE に丸めた `Frame` リテラルになる（定数名は欄で指定）。「この seed で」で同じ種を引き継いで追記だけ変えられる。Spriteloom のポートは既定 8766（`?port=N` か欄で変える）。配線は `src/tools/spriteGen.ts`、変換と JSON の形は `src/tools/spriteGenCore.ts`、WebSocket は `src/tools/spriteloomClient.ts`、送る文の型は CLI と共通の `scripts/sprite/prompt.mjs`
- **Aseprite で**: Sprite → Spriteloom...（F1）。Advanced の Palette は「Palette file」に `npm run sprite -- palette --gpl art/roguelike.gpl` で書いた `.gpl` を指定し、案を PALETTE の色に固定する。案はレイヤーとして入るので、手直しして上の 4 の `import` で戻す
- **CLI で（Agent 向け）**: `npm run sprite -- gen "<主題（英語）>" --out art/<key>.gen.png` が拡大の一覧と等倍の案（`art/<key>.gen-<番号>.png`）を書く（`--size` の既定は密度 2 の人型 48。密度 1 の従来サイズで描くなら `--size 24` を指定）。Read で一覧を見て選び、`import art/<key>.gen-<番号>.png --nearest` で `Frame` にして手で直す。既存の絵の描き変えは `gen "<指示>" --from <key> [--frame N]`。見え方は `--view side|3/4|front|top|none`（既定 side = 右向きの横顔）。色は既定で PALETTE に固定（`--free-palette` で外す）
- 16〜24px では形が崩れやすい。48 や 64 で生成して、形と配色の参考にしてから小さく描き起こすほうが使える場合がある

Aseprite の場所は環境変数 `ASEPRITE_PATH`（無ければ PATH と Steam の定番の置き場所を探す）。MCP 側は `~/mcp/aseprite-mcp/.env` の同名の行。

## エフェクト（攻撃・スキル・命中など）

- 手で打たず **生成器**（`scripts/fx/`）で描く。設計と決まりは `docs/ideas/fx-sprites.md`（密度 2 倍・段の配色・方向の事前描画・時間割）
- 1 武器種 = 1 ファイル `scripts/fx/sheets/<武器種の key>.mjs`（登録は要らない。`gen.mjs` が自動で集める）。`export const ATLAS = { key, sheets, fx }` を持ち、`fx` がモーション → シートの表（`motions` の key は `l:<段>` / `r:<右の段の key>` / `branch:<派生の key>` / `dash` / `charge`、命中 `hit` / `hitHeavy`）。手本は `sword.mjs`
- 形の部品は `shapes.mjs`（三日月・レンズ形の斬線・速度線・輪・刃片）、弧の斬撃の時間割は `motifs.mjs`、塗りの道具は `raster.mjs`。部品を土台にしつつ、その武器だけの形を必ず足す
- 確認しながら詰める: `node scripts/fx/gen.mjs --only <シートの key> --preview <scratchpad の dir> --dirs 0,3 --scale 4` で配色済みの一覧 PNG を描いて目で見る
- 仕上げに `node scripts/fx/gen.mjs --atlas <key>`（その武器の PNG と `src/data/fx/<key>.gen.json`、束ねる `src/data/fxSheets.gen.ts` を書き直す）。全部は `npm run fx:gen`。表の網羅（振りのモーションをすべて持つ）は `render/fxSprites.test.ts` が検査する。時間の割り付けの数値は `src/data/balance/feel/FX_ATTACK/sprite.json`
- 表の任意の項目: `mirror`（`faceLeft` / `faceRight`: 突きの鉤など非対称な絵を手に持つ武器の向きに合わせる）、`ground`（キャラより下に描く地面の層のシート）、`holds`（右の溜めの段の回しを押している間の繰り返しの絵）。手本は `scythe.mjs` / `hammer.mjs` / `flail.mjs`
- 弾（銃・魔法・弾を出す技）: 武器種のファイルの `fx.bullets`（弾の key → `fly` / `muzzle` / `impact` / `hit` / `fizzle` / `blast`）。弾を出す武器種はその武器種が撃つ弾をすべて載せる。奥義: `scripts/fx/sheets/<武器種>Ult.mjs`（アトラス `<武器種>Ult`）の `fx.ultimates`（奥義の key → 発動・行為・持続の纏いの絵）。形と時間割は `docs/ideas/fx-sprites.md` 9 章。配色の確認は `--ramps brass,fire`
- 見た目の決まり（剣で固まったもの）: 内側に 2 本目の弧を重ねない・速度線は刃の外側だけ・斬線の反りは前（敵の側）へふくらむ。詳しくは `docs/ideas/fx-sprites.md`

## プレイヤーの体・手に持つ武器

- 手で打たず **生成器**（`scripts/actor/`）で描く。設計と決まりは `docs/ideas/player-sprites.md`（密度 2 倍・色はそのまま・腕は実行時に引く）
- ジョブの体: `scripts/actor/sheets/` の `body<ジョブ>.mjs`（`bodySheets(key, draw)` で骨組み `rig.mjs` の全クリップを作る。`meta.arm` に袖・手の 3 段の色）。手本は `bodyNone.mjs`。顔はほぼ一色、眼は 1x2 の点を 2 つ
- 武器種の手に持つ絵: `scripts/actor/sheets/` の `wpn<武器種>.mjs`（`weaponSheets(key, draw, { size, edge })` で 32 方向。原点 = 握り、+x = 切っ先）。`meta.stance` に待機の構え（持ち方・体の構え・手の位置・向き・手にはめるか）、`meta.offGrip` に両手持ちの添え手、弾を撃つなら `frame.anchor("muzzle", …)`。手本は `wpnSword.mjs` / `wpnSpear.mjs` / `wpnSidearm.mjs`
- 確認: `node scripts/actor/gen.mjs --only <シート> --preview <dir> --scale 8`、書き出しは `npm run actor:gen`（`-- --atlas <key>` で 1 つ）。網羅（全ジョブの体・全武器種の絵と構え・銃口の印）は `render/actorSprites.test.ts` が検査する

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
