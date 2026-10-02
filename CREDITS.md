# 使用素材クレジット

このゲームに実際に組み込んでいる外部素材の一覧。候補の比較・調査は `docs/ASSETS.md` を参照。
書式は `docs/ASSETS.md` 3 章に準拠。

## 16x16 Puny Dungeon Tileset

- 作者: Shade（OpenGameArt.org ユーザー shade-1）
- URL: https://opengameart.org/content/16x16-puny-dungeon-tileset
- ライセンス: CC0（Creative Commons Zero）
- 取得日: 2026-09-24
- 使用箇所: `public/assets/puny-dungeon/punyworld-dungeon-tileset.png`（`src/data/tiles.ts` の `TILE_SPRITES` が部屋の台座 `prop.*` と階段 `stairs` の絵だけを切り出す。床・壁は 2026-10-02 の門前町への作り直しで使わなくなった）
- 改変: 未改変（原寸のまま配置）

## Tiny Dungeon（Kenney）

- 作者: Kenney（www.kenney.nl）
- URL: https://kenney.nl/assets/tiny-dungeon
- ライセンス: CC0（Creative Commons Zero）
- 取得日: 2026-09-24
- 使用箇所: `public/assets/kenney-tiny-dungeon/tilemap_packed.png`（`src/data/tiles.ts` の `TILE_SPRITES` が部屋の台座 `prop.*` の絵だけを切り出す。拠点の設備の絵は 2026-10-02 の門前町への作り直しで使わなくなった）
- 改変: 未改変（原寸のまま配置）

## 16x16 DungeonTileset II（0x72）※ 未取得

- 作者: 0x72
- URL: https://0x72.itch.io/dungeontileset-ii
- ライセンス: CC0（Creative Commons Zero v1.0 Universal。配布ページの「Asset license」欄に記載。Code license は MIT）
- 取得日: 未取得（2026-09-24 時点、`curl` では取れず）
- 状況: itch.io のダウンロードはセッション付きの JS フローが必要で、`curl` での直接取得ができなかった。ユーザーの手動ダウンロードが必要（手順は `docs/ASSETS.md` の「導入済み」節を参照）

## 効果音（Stable Audio 3 small-sfx で生成）

- 作者: 本プロジェクト（生成モデル: Stability AI「stable-audio-3-small-sfx」）
- URL: https://huggingface.co/stabilityai/stable-audio-3-small-sfx
- ライセンス: Stability AI Community License（年間収益 100 万ドル未満は商用利用可）
- 取得日: 2026-09-26〜27
- 使用箇所: `public/assets/sfx/*.ogg`（未使用。ゲーム側の読み込みを入れたら鳴る）
- 改変: 無音カット・EQ・音量の正規化（ローカルの生成ツールで処理。プロンプトと seed は生成ツール側の manifest に記録）

## Yuji Boku（タイトル画面の題字「墨淵」の字形）

- 作者: Yuji Boku プロジェクトの作者（Google Fonts 配布）
- URL: https://fonts.google.com/specimen/Yuji+Boku
- ライセンス: SIL Open Font License 1.1
- 取得日: 2026-10-01
- 使用箇所: `src/data/sprites/titleLogo.ts`（フォントで書いた「墨淵」を二値の点にした生成物。フォント本体は同梱せず、実行時にも読まない。作り方は `scripts/title/gen-logo.mjs`）
- 改変: 40px で描いた字形をアルファ閾値で二値化し、紙色に塗り直して使用
