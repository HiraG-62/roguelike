# 拠点を門前町に（実装の設計）

作成日: 2026-10-01。前提: `docs/ideas/hub-design.md`（拠点の元の設計）、`docs/ideas/map-overhaul-ideas.md` C11、`docs/ideas/map-visual-impl.md`（迷宮の描画）、`docs/ideas/title-ideas.md`（タイトルの「門」）。

**状況: 段 0・段 1 を実装済み、段 2 の削除を済み（2026-10-02。`drawTilesLegacy`・`drawHubSpots`・`tile.puny.*` / `tile.hub.*` / `hub.*` の素材・`BIOME_TILESET`・`wallStyle` / `wallMask` / `floorVariant`・右上の飾りの一覧 `drawDecor` を削除。拠点は常に town ありで描く）。残り: 資料の仕上げ（GLOSSARY・IDEAS・CHANGELOG）と実機での見え方の確認。ユーザーの決定（2026-10-01）**: 方向は「門前町」。不満は「見た目が地味・古い」「設備の配置が分かりにくい」。7 章はすべて推奨どおり（石段で出撃・長押しも残す / 表示名を建物名に / 30x24 / 宵 / 町の入口の名札と GLOSSARY だけ「門前町」）。

## 1. 結論

- **地図**: 30x24 マス（横 1 画面・縦 1.4 画面）の固定配置。北端に鳥居と石段、石段に踏み込むと出撃。建物の敷地は当たりでは壁、絵の上では床（見た目用の地図 `ground`）。地図は進行で変えず、空き地は縄張り（杭と縄）と足場で見せる
- **描画**: 床・崖・塀は迷宮のチャンク焼き付け（`MapChunkCache`）に様式 `town` を足して流用。建物・井戸・灯籠・鳥居は拠点専用の `render/townScene.ts` が描く（絵は 1 回だけ canvas に作り、毎フレームは足元の y で前後 2 段に分けて描く）。光の層（`MapLightLayer`）は使わず、宵の配色と提灯の発光で「使える」を見せる
- **進行の景色**: `TownLook` を既存の保存データだけから導く純関数（`meta/townLook.ts`）。新しい保存キーは足さない

## 2. 現状（2026-10-01）

- 地図: `src/map/hubMap.ts:19-37` の 30x17 の 1 部屋。台は点（`spots`）。木人 3 体
- 台 11（well / board / forge / library / altar / garden / history / codex / achievements / rack / hall）、設備 10（`src/meta/hub.ts:32-44`。記録室は 3 台、訓練場は台なし）
- 解放条件（`meta/hub.ts:70-79`）: 最初から well / board / forge / archive / rack。library = スキル石 1 個以上、training = 試し場を見つける or 3 ラン、altar = 祭壇の部屋を見つける、garden = 芽を持ったことがある、hall = 章ボスか最深の主を倒す
- 描画: `renderer.ts` の `drawTilesLegacy`（Puny / Kenney の 16px）、台の絵は 16px の `hub.*`、名前は **使える台にだけ出る**（未建設は何も見えない = 「どれが使えるか分からない」の原因）。飾り（踏破の碑・記念品・書架・看板）は右上に文字で並べるだけ
- 保存: `roguelike.hub.v1`（`seenFacilities`・任意の `donated`・任意の `hall`）。設備は保存せず保存データから導く（`ui/hubFlow.ts:149-167`）
- 入出: G で台を開く、決定の長押し 0.8 秒でどこでも出撃、Esc でタイトル

## 3. 配置（30x24 マス）

```
    0         1         2
    012345678901234567890123456789
 0  ##############################
 1  ###AAAAA#####SSSS#####XXXXX###   A 社（祭壇）  S 石段  X 御堂（ボスの間）
 2  ###AAAAA#####SSSS#####XXXXX###   鳥居の絵は 12〜17 列・1〜3 行
 3  #..AAAAA....|====|....XXXXX..#
 4  #....a.......====.......x....#
 5  #..........t.====.t..........#
 6  #.FFFFF..WW..=P==.....LLLLL..#   F 鍛冶屋  W 井戸（2x2）  L 書庫
 7  #.FFFFF..WWw.====.....LLLLL..#
 8  #.FFFFF......====.....LLLLL..#
 9  #...f........====.......l....#
10  #............====..BB........#   B 高札（掲示の辻）
11  #==================b=========#   辻（横の道）
12  #............====............#
13  #.KKKKKKKKK..====..RRR.......#   K 記録の蔵（扉 3）  R 武器小屋
14  #.KKKKKKKKK..====..RRR.......#   右下 18〜28 列・12〜22 行が稽古場
15  #.KKKKKKKKK..====...k........#
16  #..h..c..r...====....D..D....#   h 探索履歴 / c 図鑑 / r 実績
17  #............====............#
18  #............====.....D......#
19  #..GGGGGG....====............#   G 庭（柵の区画）
20  #..GGGGGGg...====............#
21  #..GGGGGG....====............#
22  #............====............#
23  ##############################
```

- `#` 崖・塀 / `.` 土の道 / `=` 参道・辻の石畳（床。見た目だけ）/ `S` 石段（出撃の口）/ `|` 鳥居の柱（壁）/ `t` 石灯籠（壁）/ 大文字は建物の敷地（当たりは壁）、小文字はその台（扉の前の床）/ `D` 木人 / `P` 開始位置
- 開始位置は門の真下。開始時の画面に 0〜16 行（門・広場・辻・蔵・稽古場の上半分）が入る。最も遠い庭まで約 1.9 秒
- よく使う物（井戸・鍛冶屋・書庫）を門の近くに、めったに使わない物（蔵・庭）を奥に
- 石段: 1〜2 行・13〜16 列の矩形 `gateZone` に入ると出撃（2026-10-02 から井戸と同じ支度の画面を通す。長押しは前回の支度のまま）。一度外へ出るまで再発火しない（`gateArmed`）。`Tile.StairsDown` は使わない（迷宮の階段の絵と光が出るため）
- 未建設: 敷地は壁のまま、絵は縄張り・材木・足場。名札は薄い色で「書庫（建設予定）」、近づくと解放の手がかりを 1 行（`meta/hub.ts` の `FACILITY_HINT`）
- 使える: 軒先の提灯が灯る（揺らぎは `state.time` と座標ハッシュ）・暖簾・明るい名札。近い台は名札を選択色に。名札は建っていなくても常に出す。記録の蔵は扉ごとに小札（探索履歴 / 図鑑 / 実績）

## 4. 描画

- **地面**: `MapStyle` に `"town"`、`STYLE_DEFS.town`（床 slab・天面 rock・側面 rockside・置物なし・汚しは小石とひび・宵の土の色・朱の差し色・灯 `#ffcf8a`）、`mapTheme.ts` に `townTheme()`。焼く地図は `HubLayout.ground`（敷地・灯籠・鳥居の柱を床にした写し）。mapBake / mapDecor は変えない
- **参道と辻の石畳**: 拠点を開いた時に 1 回だけ道の canvas を作る（`mapTextures.ts` の板石の純関数を町の配色で）。毎フレーム drawImage 1 回
- **建物**: 屋根（瓦）・壁（白壁 / 板）・柱・暖簾・看板の部品キットを手続きで描く純関数（`render/townArt.ts`）。設備の印（金床・巻物・高札・扁額など）と小物（提灯・井戸 4 段・縄張り・材木・樽・荷車）は密度 2 の役の文字で手描き（`data/sprites/townProps.ts`）。「模様はコード、要所だけドット絵」はマップの一新と同じ方針。敷地 5x3 マス + 屋根 2 マス = 160x160 ドット、蔵は 288x160 ドット。`TownLook.key` ごとに canvas を作って持つ
- **前後**: 足元の y がプレイヤー以下の物は体より前に（今の `drawHubSpots` の位置）、それより下は `drawPlayer` の後に。名札は最後
- **不変条件**: townScene / townArt は state と `TownLook` を読むだけ。ばらつきは `mapNoise.ts` の `h32`、揺らぎは `state.time`。拠点はリプレイに載らない
- **量**: チャンク 6 + 道 1 + 物 25 前後 + 発光 12 + 名札 14 行。今の `drawTilesLegacy`（約 550 回の drawImage）より軽い

## 5. 進行で増える景色（保存キーは足さない）

| 材料 | 景色 |
| --- | --- |
| `builtFacilities` | 空き地 → 建物（提灯・暖簾） |
| training の解放 | 稽古場の柵・砂の円・的・幟 |
| `meta.clears` | 参道の灯籠 2 + 踏破 1 回につき 2、最大 8 |
| `bestClearTier` | 踏破の碑（位階で台座と金の縁が育つ） |
| `meta.bestDepth` の章 | 石段の奥の灯の色（タイトルの `CHAPTER_TINTS` を共有） |
| `HubSave.donated` | 井戸 4 段（釣瓶 → 石の縁と桶 → 屋形 → 石畳の円と花） |
| `codex.enemyKills` のボス | 御堂の前の幟（1 体につき 1 本、最大 6） |
| `HubSave.hall` の勝ち | 御堂の篝火 |
| `shelfCount` | 記録の蔵の窓の灯（0〜5） |
| 名乗っている称号 | 高札の札 |
| `meta.runs` | 賑わい（1 / 5 / 15 / 40 回で樽・荷車・洗濯物・猫） |

段の数値は `data/balance/world/HUB_DECOR.json`。右上の飾りの一覧は段 3 で消し、碑と記念品は近づいた時の名札へ。

## 6. 段とレーン

- **段 0（統合役）**: 契約だけ置く。`HubLayout` に `ground` / `lots` / `gateZone` / `gate` / `roads` / `lanternSlots` / `clutterSlots`、型 `HubLotKey`。`meta/townLook.ts` の型 `TownLook`。`townArt.ts` の署名 `townObjectPixels(kind, look, palette)`。`HubSpotsView` に任意の `town`
- **段 1（4 本並行・worktree）**

| レーン | 所有 | 最小 Edit | 完了条件 |
| --- | --- | --- | --- |
| A 地図と入出（implementer） | `map/hubMap.ts`、`system/hub.ts`、`system/hub.test.ts`、新規 `map/hubMap.test.ts` | `HUB.json` | 配置図どおり。石段で出撃。テスト: 台が床 / 開始から全部の台へ行ける / 台どうし 40px 超 / 台が敷地の南 1 マス以内 / 敷地は本物の地図で壁・ground で床 / 石段は入った時 1 回だけ |
| B 景色の材料と配線（implementer） | `meta/townLook.ts` + test | `meta/hub.ts`（`FACILITY_OF_LOT`・`FACILITY_HINT`）、`ui/hubFlow.ts`、`main.ts`（openHub / returnToHub / drawHubScreen）、`HUB_DECOR.json` | 空の保存と最大の保存の見え方・段の境目・同じ入力なら同じ key |
| C1 地面と描画の枠（implementer） | 新規 `render/townScene.ts` + test | `mapTypes.ts`、`data/mapThemes.ts`、`mapTheme.ts`、`mapLight.ts`、`renderer.ts`（drawTiles の sandbox 分岐・drawHubSpots の置き換え・drawPlayer の後・settleMap）、`hubUi.ts`、`tools/mapShot.ts`（hub-new / hub-full） | 仮の絵で町が描ける。名札が全設備に出る。`npm run map:shot -- --only hub-new` |
| C2 建物と小物の絵（pixel-artist） | `render/townArt.ts`、新規 `data/sprites/townProps.ts` + test | なし | 全 `HubLotKey` の建った絵・空き地・井戸 4 段・提灯・鳥居と石段・幟・小物。`npm run sprite -- lint` |

- **段 2（統合役 + reviewer）**: 削除は済み（2026-10-02。`hubDecorations` / `HubDecor`〔meta/hub.ts〕は呼ぶ所が無くなったので段 3 で消せる）。残り: 資料（CODE_MAP・GLOSSARY・IDEAS・map-visual-impl・CHANGELOG）、`map:shot` の撮り比べをユーザーに見せる

## 7. ユーザーに聞いたこと（2026-10-01、すべて推奨で決定）

1. 出撃の仕方: 推奨「石段に踏み込むと前回の支度で出撃、井戸で支度、長押しはどこでも残す」
2. 設備の表示名を建物名に: 推奨「変える」（鍛冶場→鍛冶屋、図書館→書庫、掲示板→高札、記録室→記録の蔵、祭壇→社、ボスの間→御堂、訓練場→稽古場。内部 key は据え置き）
3. 広さ: 推奨 30x24
4. 時間帯: 推奨「宵」（タイトルの夜と地続き、提灯が「使える」の印として目立つ）
5. 場所の名前: 推奨「メニューの『拠点へ』はそのまま、町の入口の名札と GLOSSARY だけ『門前町』」

## 不確かな点

- `MapStyle` に `town` を足したときの `Record<MapStyle, …>` と様式の検査の追随（C1 が tsc と mapTheme / mapThemes のテストで確かめる）
- 道の canvas と物の canvas を作る時間（C1 が `hitch:probe` と `map:shot -- --bench` で測り、16ms を超えるならフレームに分ける）
- タイトルの開始の演出（門へ寄って暗転）から門の真下に立つ拠点へのつながりは、撮った絵を見て判断
