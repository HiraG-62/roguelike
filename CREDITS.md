# 使用素材クレジット

このゲームに実際に組み込んでいる外部素材の一覧。候補の比較・調査は `docs/ASSETS.md` を参照。
書式は `docs/ASSETS.md` 3 章に準拠。

## 16x16 Puny Dungeon Tileset

- 作者: Shade（OpenGameArt.org ユーザー shade-1）
- URL: https://opengameart.org/content/16x16-puny-dungeon-tileset
- ライセンス: CC0（Creative Commons Zero）
- 取得日: 2026-09-24
- 使用箇所: `public/assets/puny-dungeon/punyworld-dungeon-tileset.png`（未使用。取り込み基盤〔レーン B〕・タイル差し替え〔レーン C〕の完了後に `src/data/tiles.ts` から参照される予定）
- 改変: 未改変（原寸のまま配置）

## Tiny Dungeon（Kenney）

- 作者: Kenney（www.kenney.nl）
- URL: https://kenney.nl/assets/tiny-dungeon
- ライセンス: CC0（Creative Commons Zero）
- 取得日: 2026-09-24
- 使用箇所: `public/assets/kenney-tiny-dungeon/tilemap_packed.png`（未使用。取り込み基盤〔レーン B〕・タイル差し替え〔レーン C〕の完了後に `src/data/tiles.ts` から参照される予定）
- 改変: 未改変（原寸のまま配置）

## 16x16 DungeonTileset II（0x72）※ 未取得

- 作者: 0x72
- URL: https://0x72.itch.io/dungeontileset-ii
- ライセンス: CC0（Creative Commons Zero v1.0 Universal。配布ページの「Asset license」欄に記載。Code license は MIT）
- 取得日: 未取得（2026-09-24 時点、`curl` では取れず）
- 状況: itch.io のダウンロードはセッション付きの JS フローが必要で、`curl` での直接取得ができなかった。ユーザーの手動ダウンロードが必要（手順は `docs/ASSETS.md` の「導入済み」節を参照）
