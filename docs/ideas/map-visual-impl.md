# マップの見た目の一新（C 案）の本体への実装設計

作成日: 2026-10-01（architect）
前提: `docs/ideas/map-overhaul-ideas.md`（A・D・E 章と「ユーザーの回答」）、見本 `docs/ideas/previews/map-preview.html` の見た目 C（`smoothMask` / `distField` / `floorTex` / `topTex` / `sideTex` / `voidTex` / `terTex` / `getProps` / `applyLight`）、`src/render/{renderer,terrainUi,darkness,pitLook,layers,tileAtlas,imageAtlas,minimap,renderMath}.ts`、`src/data/tiles.ts`、`src/map/grid.ts`、`src/system/{biomes,chapters,runEvents,terrain}.ts`

**状況（2026-10-01）: 段 0〜3 を実装済み。** 階段の章別の絵（`data/sprites/stairs.ts`・`render/stairsArt.ts`）と封鎖の扉の手直し（`render/lockedDoor.ts`）も 2026-10-02 に実装。拠点は門前町の段として 2026-10-02 に実装（`docs/ideas/hub-town-impl.md`）

## 0. 結論

- 当たり・経路・生成は 16px のまま変えない。地図の静的な部分（床・壁の天面と側面・岩盤の闇・穴・置物・汚し）は、**16x16 マスのチャンクを密度 2 の画素列へ純関数で焼き**、canvas にして毎フレーム blit だけする。手前の縁（lip）は同じ焼き付けで別の画素列に出し、体の後に描く
- 動く物（地形の層・扉の封鎖・階段・泉・扉の印）は焼かずに毎フレーム描く。地形は **dual-grid の 16 通りを地形ごとに読み込み時に作るアトラス**で描く
- 暗がりは「地図だけを暗くする光の層」を地形の直後に挟む。予告・弾・敵・自分・拾い物はその後に描くので、光の影響を受けない。暗闇の階の `DarknessLayer` は今のまま上から掛ける（暗闇の遊びを変えない）
- 段取りは 段 0（型と雑音、統合役）→ 段 1（焼き付けの純関数 / チャンクと結線 / 地形 / 置物の絵 の 4 本並行）→ 段 2（光 / 置物の配置 / ミニマップ の 3 本並行）→ 段 3（手前の縁と描き順・封鎖の結界・片付け）。リプレイの版・QA の基準値は一切動かない

---

## 1. 描画の作り（確定）

### 1-1. 定数と型（段 0 で統合役が `src/render/mapTypes.ts` に置く）

| 名前 | 値 | 意味 |
| --- | --- | --- |
| `MAP_DOTS` | 2 | 地図の密度（1 ドット = 論理 0.5px = 画面 2px） |
| `TILE_DOTS` | 32 | 1 マスのドット数（`TILE_SIZE * MAP_DOTS`） |
| `CHUNK_TILES` | 16 | チャンクの一辺のマス数（論理 256px） |
| `CHUNK_DOTS` | 512 | チャンクの一辺のドット数 |
| `LIP_DOTS` | 6 | 手前の縁が床へ張り出す量（論理 3px） |
| `LIP_TOP_DOTS` | 14 | 縁の層に積む、南の壁の天面の帯（論理 7px） |
| `BAKE_ROWS_PER_FRAME` | 32 | 1 フレームに焼くドット行（時間ではなく行で区切る = 実時間に依存しない） |
| `BAKE_ROWS_BOOST` | 8 | 階の切り替えの黒帯中・画面内の未焼きがあるときの倍率 |
| `CHUNK_CACHE_MAX` | 20 | 持つチャンクの上限（LRU） |

```ts
export type MapStyle = "moss" | "temple" | "castleFire" | "castleFrost" | "deep" | "final";
export type FloorPattern = "cobble" | "slab" | "ashlar" | "glyph" | "sand";
export type TopPattern = "rock" | "mason" | "ink";
export type SidePattern = "rockside" | "stonewall" | "ashlarside" | "cliff" | "inkside";
/** 色はすべて ImageData 用に詰めた 32bit（ABGR、見本の pack と同じ） */
export interface MapPalette { fD; fB; fL; fH; fO; tB; tD; tL; sB; sL; sD; v1; v2; vD; light; lightDim; accent; accL; accD; moss1; moss2; wood; soot; snow; stoneL; stoneB; stoneD: number }
export interface MapTheme {
  key: string;            // チャンクのキャッシュの鍵（style + floorKind + 変異）
  style: MapStyle; floor: FloorPattern; top: TopPattern; side: SidePattern;
  corner: "round" | "chamfer"; cornerR: number;   // ドット。round 16 / chamfer 12
  sideH: 16 | 24 | 32;    // 側面の高さ（ドット）
  edgeNoise: number;      // 縁の揺らぎの振幅（ドット）。洞窟 3 / 人工物 0
  voidBeyond: boolean;    // 岩盤の奥を奈落に描く（章 4・深み）
  dark: number;           // 章の暗さ（MAP_LIGHT から引く）
  palette: MapPalette; pit: PitTheme;
  props: readonly { kind: MapPropKind; weight: number }[];
  decals: readonly DecalKind[];
  flags: { drips; soot; frost; sideMoss; shimenawa; redPillar; beams; banners; icicles; shafts: boolean };
}
export interface MapLight { x: number; y: number; r: number; strength: number; color: string } // 論理 px
export interface BakeOutput { ground: Uint32Array; lip: Uint32Array; lights: MapLight[] }    // 512*512、lip の 0 は透明
export interface ChunkBakeJob { readonly done: boolean; step(rows: number): void; result(): BakeOutput }
```

### 1-2. dual-grid と密度 2 の焼き付け

- 形は見本の `smoothMask` をそのまま使う。1 ドットは「自分のマス・横の隣・縦の隣」と、外角 / 内角のときだけ角の半径 `cornerR` で円（chamfer は 45 度）を当てる。これは頂点を囲む 4 マスで 16 通りを選ぶ dual-grid と同じ情報量で、表の格子は半マスずれる（縁の絵が論理マスの境界の上に来る）。縁の揺らぎは `vnoise(wx, wy, 11, seed)` × `edgeNoise`
- 分類は 3 つ: 壁（`Tile.Wall`）/ 穴（`Tile.Pit`）/ 通れる（Floor・StairsDown・Fountain）。壁の形 S を先に決め、穴の形 Q は「S でない所」で同じ関数に穴を渡して決める（壁と穴が接すれば壁が勝つ）
- **ドット単位の距離変換（見本の `distField`）は使わない**。代わりに地図ごとに 1 回、頂点（(w+1)×(h+1)）の「最寄りの床までのマス数」（`rock`）と「最寄りの岸までのマス数」（`pit`）を 3-4 の面取り距離で作り（`buildVertexDepth(map)`、2 万マスで 1ms 前後）、ドットでは双線形補間する。岩盤の闇の 3 段（見本の 44 / 54 / 64 ドット）は 1.375 / 1.69 / 2.0 マスの閾値になる。縁の明るい 1 ドットや床の輪郭（見本の `dIn <= 1.5` / `dOut <= 1`）は S の 3x3 近傍で判定する
- 側面・影・縁は列ごとの連なりで O(1) にする: `below[k]`（下の床までの壁のドット数）、`above[k]`（上の壁からの床のドット数）、`wallBelow[k]`（下の壁までの床のドット数）
- 1 ドットの色:
  - 壁: `below > sideH` なら天面（`topTex`。`rock` < 1.375 は天面、以降 v1 / v2 / vD。`voidBeyond` のテーマは 1.5 マスより奥を `voidTex`）。`below <= sideH` なら側面 `sideTex(k = sideH - below)`。北の床から 14 ドット以内の天面は lip にも同じ色を積む
  - 床: `floorTex`。上の壁から 3 ドット以内は fO を 0.55、7 ドット以内は 0.3、(-5, -7) が壁なら 0.25（右下への落影）。下の壁まで 6 ドット以内は lip に tL（6 ドット目は fO）
  - 穴: 1-6 節
- 焼く範囲: チャンクの 512x512 に、上 16・下 `sideH + 8`・左右 8 ドットの余白を足した S / Q を作る（余白は数 % 増えるだけ）
- ばらつきは見本の `h32` / `vnoise` / `vor` と `tileHash`。種は「`theme.key` の文字列ハッシュ」と座標だけ。`state.rng`・`Math.random`・`state.seed` は使わない（同じ地図・同じテーマなら常に同じ絵。seed で模様を変えたいときは `map.width * 7919 + map.height` のような地図由来の値にする）
- 雑音・模様の関数は割り当てなし（`vor` は再利用する出力の構造体を受け取る）。`vor` はチャンクの中で特徴点の格子を前計算して 9 回の `h32` を引き直さない

### 1-3. チャンクの焼き方と作り直す時機

- 1 チャンク = 16x16 マス = 512x512 ドットの `ground` canvas と `lip` canvas。`putImageData` で 1 回だけ載せ、描くときは world の座標系で `drawImage(c, cx*256, cy*256, 256, 256)`（RENDER_SCALE 4 の下でちょうど 2 倍の最近傍。カメラは整数 px なのでドットがずれない）
- 欲しいチャンク = 画面 + 周り 128px（先読み）。画面内で未焼きのものから、カメラの中心に近い順に `BAKE_ROWS_PER_FRAME` 行ずつ焼く。黒帯（`wipeActive`）中と画面内が未焼きのときは `BOOST` 倍
- 未焼きのチャンクが画面に入ったら、その範囲だけ「マスごとの平塗り」（床 fB / 壁 tB / 穴の本体色、`fillRect` 256 回以下）で埋める。黒い穴は出さない
- 作り直しの判定は描画側だけで行う（state に印を足さない）。画面内のチャンクについて毎フレーム「チャンク + 周り 2 マスの分類（壁 / 穴 / 通れる）の簡易ハッシュ」を取り（9 チャンク × 400 マスの読み出し、数十 µs）、焼いた時の値と違えば作り直す。`state.map` の同一性が変わったら全部捨てる。`map.shallow` は生成時に固定なので鍵に入れない
- 実際に分類が変わるのは隠し部屋が開くとき（`src/system/hiddenRoom.ts:117-119` の Wall → Floor）だけ。階段の出現（`boss.ts:426`・`specialRooms.ts:1303`）・泉（`roomTypes.ts:307`）は「通れる」のままなので作り直さない（階段と泉は上から毎フレーム描く）。**画面内のチャンクの分類が変わったら同期で焼き直す**（まれな出来事。1 回 25ms 以下を目標）
- 封鎖の扉（`state.lockedTiles`）・地形（`state.terrain`）・扉の印・伏兵の暗い床・隠し部屋のひびは焼かない
- 拠点（`state.sandbox`）は門前町の様式 `town` の焼き付け（`drawTownGround`。旧来の Puny のタイルの描画は 2026-10-02 に削除）

### 1-4. メモリと時間の見積もり

- 測った値（見本のコードを node に移して 16x16 チャンクを焼いた。この Agent の scratchpad で実測）: 見本どおりの `distField` 込みで 苔 72ms / 寺院 35ms / 炎 36ms。距離変換を列の連なりに替えると 苔 51 / 寺院 22 / 炎 26 / 異界 34ms。内訳は形 12ms・苔の床の模様 25ms（`vor` と `vnoise` の 2 回）
- 目標: 全テーマで **1 チャンク 25ms 以下**（node）。苔は `vor` の特徴点の前計算と `vnoise` の格子値のキャッシュで半分になる見込み。32 行 / フレームで 1 フレーム約 1.6ms（焼いているフレームだけ）
- 歩き（120px/s）で新しいチャンクの列（3〜4 枚、約 100ms 分）が要るのは 256px ごと = 約 2 秒ごと。先読みの 128px のうちに 32 行 / フレームで間に合う。ダッシュ（400px/s）が続いたときだけ平塗りが一瞬見えることがある
- メモリ: 1 チャンク 1MiB（ground）+ 1MiB（lip）。画面内は最大 3x3 = 9、先読み込みで 12〜16、上限 20 で最大 40MiB。地形のアトラス 約 2.3MiB（9 種 × 16 形 × 4 変種 × 32x32 ドット）、光と lip の作業用 canvas（960x540）3 枚で 6MiB。合計 50MiB 以下
- 毎フレーム（焼いていないとき）: 地図の blit 6〜9 回 + lip 6〜9 回と合成 2 回 + 光の層（塗り 1 回・光源 48 個以下・合成 2 回）+ 地形 dual-grid（画面の頂点 約 560 のうち地形のある所だけ。普通は 150 回以下）+ 上描き（階段・泉・扉・印）。今の `drawTiles` は画面の全マス約 550 回の `drawImage`（`renderer.ts:1105-1145`）なので、**今より軽くなる**

### 1-5. 壁の側面と体の前後

（実装メモ 2026-10-01: 縁の床側の帯は ground にも焼き、`drawFrontLip` は体〔自分・敵・拾い物〕と重なる矩形だけを光の層と同じ暗さで描き直す〔`render/frontLip.ts`〕。画面全体で描き直すとソフトウェア描画で +3〜4ms だったため。反転層の紫は縁にも ground と同じ順で掛ける）

- 側面の高さ: 苔の洞（章 1）16 ドット = 半マス / 寺院・廃城（章 2・3）32 ドット = 1 マス / 異界・最深の間 24 ドット。側面は壁のマスの下側に描き、床へ食い込ませない（当たりと絵が一致する）
- 北の壁（床の北にある壁）の前では、体は側面の上に重なって「壁の前に立つ」に見える。焼いた ground に描くだけで足りる
- 南の壁（床の南にある壁）では、lip（床へ 3px の張り出し + 壁の天面の 7px の帯）を体の後に描く。足元は `spriteFeetY = 中心 + 半径 + 2`、プレイヤーは描画で 2px 持ち上げる（`renderMath.ts:91-94`、`renderer.ts:522`、半径 5 は `PLAYER.json`）。中心は壁から半径以上離れるので足元は壁の縁ちょうどまで。**南の壁に張り付いたとき隠れるのは足元の 3px だけ**（章で変わらない）。この量なのでシルエットの透かしは作らない
- 描き順（段 3 で入れる）: `drawEnemies → drawDeathFx → drawBossDeath → drawPlayerAuras → drawPlayer → drawFrontLip → drawProjectiles → drawLasers → drawReaper → …`。今の「弾 → 自分」を「自分 → 縁 → 弾」に入れ替え、弾と光線は縁より上にする。床に塗る予告（円・扇。`drawGroundHazards`）と敵の予告の線は縁の下に入るが、張り出しは 3px なので外周と色で読める（不変条件 A8 の「隠さない」は弾・線の本体・状態異常の印で守る）
- lip は光の層と同じ暗さで描く: 画面サイズの作業用 canvas に画面内の lip を描き、光の層を `source-atop` で重ねてから本体へ 1 回で描く

### 1-6. 穴の縁と深さ

- 形は 1-2 節の Q（角 R16、揺らぎ 2）。穴の色は `PitTheme`（water / oil / lava / ice / ink / abyss）から、見本の `TER` の a / deep / foam / rip / bank を使う
- 北の縁（穴の北が床）: 床の切り口を見せる。液体は 6 ドット（論理 3px）の bank 色の帯、奈落は 24 ドットの崖（見本の `cliff` を流用し、下へ vD に溶かす）。南・東・西の縁は 1〜2 ドットの foam（液体）か fO（奈落）
- 深さ: 頂点の `pit` 距離を補間し、岸から 6 ドット以内はそのまま、0.5 マス以上は vD へ 0.24、1 マス以上は 0.42 寄せる（見本の `deepen`）。溶岩は暗くせず rip（明るい橙）の割れ目を残す
- 浅瀬と繋がる所: 穴の隣のマスに `map.shallow` があれば、その辺の縁（foam / bank）を描かない（浅瀬の水が深い水へそのまま続く）
- 穴の章の対応は `pitLook.ts` を `MapTheme.pit` へ寄せる（章 4・深みは abyss、それ以外はバイオームの今の対応）

### 1-7. 浅瀬・地形の層

- 地形は毎フレーム描く（延焼・溶ける氷・崩れる床で変わるため）。`terrainUi.ts` の `drawTile` を dual-grid に置き換える: 画面の頂点ごとに、周りの 4 マスで種類ごとの 4 ビットの形を作り、形が 0 でない種類だけ `drawImage`（論理 16x16 = 32x32 ドットの 1 枚、置き場所は頂点を中心に (-8, -8)）。変種 4 枚は頂点の座標の偶奇（`terrainVariantAt`。模様が 64 ドット周期なので、ハッシュで選ぶと波紋やひびが 16px ごとに途切れる）
- アトラスは種類ごとに初めて使うとき 1 回だけ作る（`terrainCellPixels(kind, mask, variant): Uint32Array` の純関数 → canvas）。形は 1-2 節の関数、模様は見本の `terTex`（水 = foam / a / deep / 波紋、油 = 虹の膜、溶岩 = 黒い殻 + 割れ目、氷 = 霜の縁 + ひび、沼・泥 = 縁 + 粒、草 = 房の点）。模様は 64 ドット周期にして変種の継ぎ目を目立たせない
- 色は章に依らず種類で固定（地形は戦闘の道具なので、どの章でも同じ色で読めること。見本の `TER` を基準に、`terrainUi.ts` の今の `STYLE` の色相に合わせる）
- 浅瀬（`map.shallow`）は生成時に地形の層へ写される（`system/terrain.ts:71-79`）ので、地形と同じ経路で描かれる。水の形を作るとき「水の章の穴」も水として数え（縁を作らない）、穴の象限は描かない（`drawImage` の元の矩形を象限の 16x16 ドットに切る）。これで浅瀬と川が 1 枚の水に見える
- 揺らぎ（水・溶岩の明滅、炎のちらつき）と消えかけの薄れは今の `flicker` / `FADE_TIME` を頂点ごとに使う。崩れる床（rubble）は揺れの予告があるのでマスごとの今の描き方のまま。煙（`drawSmokeLayer`）は変えない
- 重ね順: ground（焼き）→ 伏兵の暗い床 → 地形（dual-grid）→ 光の層 → 上描き（階段・泉・扉の印・封鎖・隠し部屋のひび・階段の光）→ 以降は今のまま

### 1-8. 暗がりと光

（実装メモ 2026-10-01: 光の色の円は別 canvas に描いて全画面へ soft-light を掛けると headless で約 +11ms だったため、光源ごとに world へ直接 soft-light で重ねる形にした。溶岩・炎・階段・泉の光の半径と強さも `MAP_LIGHT.json` に置いた）

- 新規 `src/render/mapLight.ts` の `MapLightLayer`: 960x540（密度 2）の canvas に毎フレーム `rgba(0,0,0,dark)` を塗り、光源ごとに段つきの円（見本の 4 段: 0.12 / 0.38 / 0.7 の閾値 → 抜く量 1/3・2/3・1。縦 1.15 倍の楕円、ディザなし、半径と強さで作り置き）を `destination-out` で抜き、world に 1 回で描く。光の色は同じ形の色つきの円を `soft-light`・不透明度 `lightTint × 段` で重ねる
- 位置: `drawTerrainLayer` の直後（`drawMapLight`）。その後に描くもの（階段・扉の印・地面の印・拾い物・床のアイテム・予告・敵・自分・弾・浮き文字）は暗くならない。**予告・弾・敵の体は常に明るい**が描き順だけで成り立つ
- 光源（`mapLights(state, view, theme, chunkLights): MapLight[]`、純関数）: プレイヤー（半径 32px・0.55）、焼いたチャンクが返す置物と側面の蛍苔、溶岩の地形と溶岩の穴（2 マスおき）、炎の地形、階段、泉。画面内でプレイヤーに近い順に `maxLights` まで
- 暗さ（新規 `src/data/balance/feel/MAP_LIGHT.json`）: `chapterDark` [0.10, 0.20, 0.30, 0.40] / `finalDark` 0.15 / `deepDark` 0.40 / `playerLightRadius` 32 / `playerLightStrength` 0.55 / `lavaLightRadius` 42 / `maxLights` 48 / `lightTint` 0.3。置物ごとの光の半径・色は絵と一緒に TS（`mapDecor.ts`）
- 暗闇の階（`isDark`）: 章の暗さ（地図だけ）に加え、今の `DarknessLayer`（`darkness.ts`、worldOverlay で敵も覆い、弾と燃焼を発光で描き直す）をそのまま掛ける。暗闇の階の「見えない敵」の遊びを変えない
- 拠点は光の層を掛けない

---

## 2. 章とバイオームのテーマ

### 2-1. 章の様式（建築・光・置物を決める）

| 様式 | 深度 | 床 | 天面 / 側面 | 角 | 側面 | 縁の揺らぎ | 暗さ | 光の色 | 配色（fD / fB / fL・天面・側面・光・差し色） | 置物（重み） | 側面の飾り |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moss 苔の洞 | 1〜5 | cobble（土と石畳の地帯・苔） | rock（苔の垂れ）/ rockside | round 16 | 16 | 3 | 0.10 | 蛍苔 #c8e878 | #2f3530 / #3d4540 / #4d5a4c・#56604a・#262b25・#c8e878・#4a8cb0 | 茸 5・頭骨 2・小石の山 2・根の塊 1（和は置かない） | 蛍苔（光源）・苔の垂れ |
| temple 寺院と坑道 | 6〜10 | slab（敷石 + 2x2 の大石） | mason / stonewall | chamfer 12 | 32 | 0 | 0.20 | 灯籠 #ffb45a | #3a3230 / #4a403c / #5c5048・#6e6258・#2c2420・#ffb45a・#b0342c | 石灯籠 4・地蔵 3・祠 1・経巻 2・骨壺 1 | 朱の柱・注連縄と紙垂 |
| castleFire 廃城（炎） | 11〜15 | ashlar + 煤 | mason / ashlarside | chamfer 12 | 32 | 0 | 0.30 | 篝火 #ff7a2a | #33241f / #45302a / #5a3c30・#5e4a40・#221612・#ff7a2a・#ffd05a | 篝火 4・折れた槍 3・鎧 2・頭骨 2 | 焼けた旗 |
| castleFrost 廃城（霜） | 11〜15 | ashlar + 霜 | mason / ashlarside | chamfer 12 | 32 | 0 | 0.30 | 氷晶 #b8e4ff | #2c3444 / #3a4458 / #4c5a70・#6a7c96・#1e2432・#b8e4ff・#e8f4ff | 氷晶 4・折れた槍 2・頭骨 1 | 氷柱 |
| deep 深みの異界 | 16〜20 | glyph（敷石 + 金の文字） | rock（床から 1.5 マスまで）→ 奥は奈落 / cliff | round 16 | 24 | 3 | 0.40 | 燐光 #b27cff | #241f30 / #302a40 / #3e3654・#4c4266・#17131f・#b27cff・#d8b04a | 燐光の珠 3・紫の灯籠 2・頭骨 1、奈落に逆さの鳥居 | 金の経文（側面の点） |
| final 墨と朱の間 | 21 | sand（枯山水の砂紋） | ink / inkside | round 16 | 24 | 1 | 0.15 | 白 #f0ece0 | #5a564e / #6a665c / #7a7466・#2a282c・#141216・#f0ece0・#c83a2a | 墨の石 4・行灯 2・朱の柱 2 | — |
| 深み | 22〜 | deep と同じ | deep と同じ | | 24 | 3 | 0.40 | 変異で変わる | deep の配色を変異で寄せる（下） | deep と同じ | |

- 派生色は見本の `derivePalette` をそのまま移す（fO・fH・tD・tL・sL・sD・v1・v2・vD・accL・accD・stoneL/B/D）
- 深みの変異（`mutationsFor(depth)`、`runEvents.ts:299-306` の `bloodMoon` → `fog` → `elementStorm` の順に積まれる）: 血の月 = 見本の `blood` 配色、霧 = 全色を #c8c8d0 へ 0.18 寄せて暗さ +0.05、属性の嵐 = 色相を `deepFloorOf(depth) * 40` 度回す（深度で決まるので決定的）
- 章 4 の壁は見本の「壁 = 奈落」をやめ、床から 1.5 マスまでを崖の上端（天面）として描き、その奥だけ奈落と浮かぶ岩片にする。穴（弾が越える）と壁（弾が止まる）が同じ見た目になるのを避けるため（6 章 Q1）

### 2-2. バイオーム（`floorKind`）の変奏

バイオームは解禁深度（`FLOOR_KIND.json` の `biomeMinDepth`）を越えればどの章にも出るので、「章の様式 × バイオームの変奏」の 2 軸で作る。変奏は床・天面の色へ少し寄せる色と、汚し・置物・側面の飾りの足し引きだけ。

| floorKind | 色の寄せ（色・量） | 汚し・置物 | 章 3 の炎 / 霜 | その他 |
| --- | --- | --- | --- | --- |
| cave | なし | 基本 | 霜 | — |
| rooms（回廊） | なし | 章 1 は石畳の地帯を広く（cobble の地帯の閾値 0.42 → 0.6）、章 2 は朱の柱を 2 倍 | 炎 | ボス階はすべて rooms（章の様式がそのまま出る） |
| dark | 明度 ×0.8 | 光る置物 ×0.5 | 炎 | `DarknessLayer` は別に掛かる |
| forge | #b0401c・0.12 | 煤の地帯・燠の汚し | 炎 | 溶岩の光 |
| ossuary | #e0d8c0・0.10 | 骨の汚し ×3、章 2 は骨壺を 3 | 炎 | — |
| swamp | #3c7040・0.12 | 苔の地帯を広く、泥の汚し | 霜 | — |
| glacier | #80b8e0・0.15 | 霜の汚し、天面に雪 | 霜 | — |
| mine | #5a4028・0.12 | 側面に坑木の梁、まっすぐな通路（4 マス以上）に線路の汚し | 炎 | — |
| meadow | #60a048・0.12 | 草の房の汚し、章 1 は天窓の光の柱 ×2 | 霜 | — |

`biomes.ts` の `BIOMES[kind].tint`（全画面の色の重ね）は、新しい描画の階では使わない（テーマの寄せに置き換える）。反転層の紫（`isInvertedDepth`）は今のまま重ねる。

### 2-3. 置物と和の飾りの置き方（当たりなし・焼き付け）

置物はすべて当たりを持たず、チャンクの焼き付けで画素列へ直接描く（毎フレームの描画は増えない）。置き場所は地図とテーマだけで決め、`tileHash` と `theme.key` で散らす。

置き場所の種類（`mapDecor.ts` が分類する）:

| 置き場所 | 条件 | 置けるもの |
| --- | --- | --- |
| 壁際（wallFoot） | 床で北が壁。根元をマスの上 8px に置く | 背の高い置物（灯籠・地蔵・篝火・氷晶・行灯・朱の柱）。北が壁なので体は常に手前に来る |
| 隅（corner） | 床で北と東か西が壁 | 小物（茸・頭骨・壺・経巻） |
| 行き止まり（deadEnd） | 床で 3 方が壁 | 章 2 の祠・地蔵、骨の山 |
| 側面（sideFace） | 壁で南が床 | 注連縄・朱の柱・坑木・旗・氷柱・蛍苔（側面の高さの中に描く） |
| 奈落（void） | 壁で `rock` 3 マス以上 | 章 4 の逆さの鳥居（10 マスに 1 つまで）・浮かぶ岩片 |
| 広い床（open） | 周り 2 マスが床 | 平らな汚しだけ（広間は読みやすく）。置物は置かない |

- 率: 壁際・隅 7.5%、広い床の汚し 10%（壁際は 55%）、置物どうしの間隔は小物 4 マス・背の高いもの 6 マス（見本の `getProps` / `drawDecals`）
- 置かない所: 部屋の中心とその周り 1 マス（台座・泉・商人・契約者・ボス後の階段）、扉のマス（`RoomLookup.doorOf`）とその 4 近傍、焼いた時点の `StairsDown` / `Fountain` とその 8 近傍。除外は描画側でマスの印（`Uint8Array`）にして焼き付けへ渡す
- 階の型ごとの寄せ（`map.layout` を読む）:
  - court（門・中庭・本堂・参道）: 章 2・4 は参道（どの部屋にも属さない通路のマス）の壁際に 4 マスおきの石灯籠の対、本堂（主の部屋）の北の側面に 2 マスおきの朱の柱、特別な部屋の扉の両脇の側面に紙垂
  - prefab: 行き止まりに祠・地蔵（章 2）、頭骨（章 1・3）
  - river: 岸（穴の隣の床）に章 1 は茸と蛍苔、章 2 は 5 マスおきの石灯籠
  - isle: 章 4 は島の壁際に燐光の珠、島の外の奈落に逆さの鳥居
  - lordHall（ボス階）: 置物は壁際だけ。主の間の北の側面に章の飾り（章 2 朱の柱・章 3 旗・章 4 金の経文）
  - cavern / drunk / ring / terrace / legacy: 上の共通規則だけ
- 章 1 は和の飾りを置かない（茸・骨・根・蛍苔だけ）。和は章 2・章 4 が中心、章 3 は城の物（旗・鎧・槍）、最深の間は墨の石と行灯
- 置物の光（灯籠 46px・篝火 52px・行灯 43px・燐光の珠 35px・氷晶 29px・蛍苔 20px。見本の `PROP_LIGHT` の半分 = 論理 px）は焼き付けの `lights` に出す
- 門構え（出口の意匠 B12）・当たりのある障害物（A23）はこの段に入れない

---

## 3. 今の絵・アトラス・再配色の扱い（確定表）

| 対象 | 場所 | 扱い | 理由 / 置き換え先 |
| --- | --- | --- | --- |
| Puny の床・壁 16 形（`tile.puny.*`）・拠点の `tile.hub.*`・`BIOME_TILESET`・`DERIVED_SPRITES` | `data/tiles.ts` | **門前町の段で置き換えた（2026-10-02）**。`tiles.ts` から削除 | 拠点の床は `townTheme` の焼き付け、建物は `townScene.ts` |
| 9 バイオームの派生床・壁（`tile.<biome>.*`） | `data/tiles.ts:188-236` の `BIOME_TILESET` / `biomeDerived` | 捨てる（段 3）。`BIOME_TILESET` は `hub` だけ残す | 焼き付けのテーマに置き換わる。読み込み時の再配色 160 枚が消える |
| 下水の水面から作る地形（`terrain.bog` と `TERRAIN_FROM_BOG`） | `data/tiles.ts:219-240` | 捨てる（段 3） | dual-grid の地形アトラス（`terrainTex.ts`） |
| 階段 `stairs`・扉 `door` | `TILE_SPRITES` | 当面残す。扉は段 3 で結界の帯へ、階段は置物の絵のレーンで密度 2 の章別の絵へ | 上描きで毎フレーム描く |
| 台座 `prop.*` | `TILE_SPRITES` | 残す（拠点の設備 `hub.*` は 2026-10-02 に削除） | 地図の一新の範囲外 |
| `SHEET_LUT`・`imageLut.ts` の `applyLut` | Kenney の暗化 | 残す | 台座・拠点で使う |
| `tileAtlas.ts` の `expandTileAtlas` | | 残す（扱う量が減るだけ） | |
| `imageAtlas.ts` | | 残す | |
| `renderMath.ts` の `wallMask` / `wallStyle` / `floorVariant` | | 削除した（2026-10-02。拠点の旧描画だけが使っていた） | |
| `renderMath.ts` の `crackPixels` | | 残す | 隠し部屋のひびの上描き |
| `renderer.ts` の `drawTiles` の中身（`renderer.ts:1087-1147`） | | 拠点用に `drawTilesLegacy` として残し（**2026-10-02 に削除**。拠点は `drawTownGround`）、階段・泉・扉・印・封鎖・ひびは `drawTileOverlays` に分ける | |
| `renderer.ts` の `drawPit`（仮の単色、`renderer.ts:1150-1159`） | | 捨てる（拠点に穴は無い） | 焼き付けの穴 |
| `pitLook.ts` | | 置き換える（章 4・深み → abyss、`MapTheme.pit` を正にする。ミニマップの色は残す） | |
| `terrainUi.ts` の `drawTile` / `STYLE` | | 置き換える（dual-grid）。崩れる床と煙は残す | |
| `darkness.ts` の `DarknessLayer` | | 残す（暗闇の階） | 章の暗さは `mapLight.ts` |
| `runUi.ts` の `drawBiomeTint` | | バイオームの色は新しい描画では呼ばない（`tiled = true` で渡す）。反転層の紫は残す | |
| コード内の床・壁のピクセルマップ（`SPR.floor` / `wallFace` / `wallTop`） | `renderer.ts:163-` | 残す（拠点の PNG が読めないときの代わり） | |

---

## 4. 段取りとレーン

共通の注意（全レーンのプロンプトに入れる）: 編集禁止 = `src/render/effectsUi.ts`（ボス階の引き込みの演出のレーン）、`src/render/playerRig.ts` / `actorSprites.ts` / `fx*.ts`（書の真上の見え方のレーン）、`src/core/**`、`src/system/**`、`src/map/**`。`renderer.ts` は最小の Edit のみ（old_string を短く、既存の目印の直後に足す）。コミットしない。テストは担当分だけ（`npx vitest run <file>`）、途中確認は `npm run check:fast`。

### 段 0（統合役、S）

- 追加: `src/render/mapTypes.ts`（1-1 節の定数と型）、`src/render/mapNoise.ts`（見本の `h32` / `hf` / `vnoise` / `vor` を型付きで移す。`vor` は出力の構造体を引数で受ける）と `mapNoise.test.ts`（同じ引数で同じ値・0..1 の範囲）
- `src/render/mapBake.ts` に仮の `createChunkBake(input): ChunkBakeJob`（平塗りを返す）を置き、段 1 の並行を可能にする
- CODE_MAP の render 節に 3 行

### 段 1（4 本並行、worktree）

**L1a 焼き付けの純関数**（implementer、M〜L）
- 所有: `src/data/mapThemes.ts`（2-1・2-2 節の表）、`src/render/mapTheme.ts`（`mapThemeFor(depth, floorKind): MapTheme`、`derivePalette`、変異の寄せ）、`src/render/dualGrid.ts`（`cornerShape(isSolid, map, wx, wy, R, chamfer, amp, seed): 0|1`、`buildVertexDepth(map): VertexDepth`、`sampleDepth`）、`src/render/mapTextures.ts`（見本の `floorTex` 5 種 / `topTex` 3 種 / `sideTex` 5 種 / `voidTex` / `pitTex` を、テーマと出力の構造体を引数に取る純関数へ）、`src/render/mapBake.ts`（`createChunkBake`。1-2・1-5・1-6 節。`step(rows)` で何行ずつ焼いても結果が同じ）とそれぞれの `.test.ts`
- 最小 Edit: なし
- 完了条件: 5 章のテストが通る、node で全テーマ 1 チャンク 25ms 以下（テストの出力に ms を出す）
- 注意: 見本の `THEMES` の `dark` は使わない（MAP_LIGHT の値）。章 4 の壁は 2-1 節のとおり天面 → 奈落

**L1b チャンクと結線**（implementer、M）
- 所有: `src/render/mapChunks.ts`（`MapChunkCache`: 欲しいチャンクの算出・分類のハッシュ・LRU・行の予算での焼き・平塗りの代わり・`drawGround(ctx, view)` / `drawLip(ctx, view)` / `lightsIn(view)` / `settle(view)`。canvas に触らない部分〔`chunkPlan`・`chunkChecksum`〕は純関数にして `mapChunks.test.ts`）、`src/tools/mapShot.ts` と `tools/map-shot.html`（5-2 節）、`scripts/map-shot.mjs`
- 最小 Edit: `renderer.ts`（`drawTiles` を「拠点 → `drawTilesLegacy`、それ以外 → `MapChunkCache.drawGround`」に分け、階段・泉・扉の印・封鎖・ひび・伏兵の床を `drawTileOverlays` へ移す。`drawWorldLayer` で `drawTerrainLayer` の後に `drawTileOverlays` を呼ぶ。`settleMap(state)` を public で足す）、`layers.ts`（`LAYER_CONTENTS.world` に `drawTileOverlays`）、`package.json`（`"map:shot": "node scripts/map-shot.mjs"`）
- 完了条件: 段 0 の仮の焼き付けで全階が平塗りで描け、拠点は今と同じ。`map-shot` で 12 枚撮れる

**L2 地形の dual-grid**（implementer、M）
- 所有: `src/render/terrainUi.ts`、新規 `src/render/terrainTex.ts`（`terrainCellPixels(kind, mask, variant)`・形の 4 ビット・水と穴の繋ぎ）と `terrainTex.test.ts`
- 最小 Edit: なし（`drawTerrainLayer` の引数は変えない。`atlas` 引数は使わなくなるが残す）
- 完了条件: 1-7 節。地形の描画回数が「画面の頂点 × 地形の種類」を超えない

**L5 置物の絵**（pixel-artist、M）
- 所有: 新規 `src/data/sprites/mapProps.ts`（密度 2。色は「役の文字」で書き、テーマで色を当てる: k 輪郭 / S・D 石の明暗 / L 光 / Y 光の芯 / R・r 差し色 / W 木 / w 骨）
- 描くもの: 茸・頭骨・小石の山・根の塊（章 1）/ 石灯籠・地蔵・祠・経巻・骨壺（章 2）/ 篝火・鎧・氷晶（章 3）/ 燐光の珠・逆さの鳥居（章 4）/ 行灯（最深の間）。見本の `SPR` の同名の絵を下絵にする。朱の柱・墨の石・折れた槍は手続き（L4）
- 完了条件: `npm run sprite lint`（使えない場合は 8 章の 3）、`render` で確認用 PNG

### 段 2（3 本並行。段 1 を統合した後）

**L3 光と暗がり**（implementer、M）
- 所有: 新規 `src/render/mapLight.ts`（`MapLightLayer`、`mapLights` 純関数、段つきの円の作り置き）と `mapLight.test.ts`、新規 `src/data/balance/feel/MAP_LIGHT.json`（`_fields` つき）
- 最小 Edit: `src/data/tuning.ts`（`MAP_LIGHT` の再 export 1 行）、`renderer.ts`（`drawTerrainLayer` の直後に `drawMapLight` 1 行とフィールド 1 つ）、`layers.ts`（`drawMapLight` を `drawTerrainLayer` の直後）、`layers.test.ts`（5-1 節の順序）
- 完了条件: 1-8 節。暗闇の階は今と同じに見える

**L4 置物と飾りの配置**（implementer、M）
- 所有: 新規 `src/render/mapDecor.ts`（2-3 節の置き場所の分類・層の寄せ・汚し・側面の飾り・手続きの置物〔朱の柱・墨の石・折れた槍〕・光の一覧）と `mapDecor.test.ts`
- 最小 Edit: `mapBake.ts`（基本の焼きの後に `decorateChunk` を呼び、`lights` に足す 2〜3 行）、`mapChunks.ts`（除外の印を作って渡す数行）
- 完了条件: 置物は座標とテーマだけで決まり、除外のマスに置かれない

**L6 ミニマップと穴の色**（implementer、S）
- 所有: `src/render/minimap.ts`、`src/render/pitLook.ts` とそのテスト
- 中身: 穴の色をテーマから（章 4・深みは奈落）、通路と背景の色を章の配色へ弱く寄せる。部屋の種類の色（情報）は変えない
- 完了条件: `minimap.test.ts` / `pitLook.test.ts`

### 段 3（統合役 + 1 本）

**L7 手前の縁・描き順・封鎖の結界・片付け**（implementer、M。描き順の変更は reviewer を opus で）
- 外部の 2 レーン（ボス階の引き込み・書の真上）を統合した後に始める
- 最小 Edit: `renderer.ts`（1-5 節の描き順。`drawFrontLip` を足し、`drawProjectiles` / `drawLasers` を `drawPlayer` の後へ。封鎖の扉を「章の差し色の格子の帯 + 外周だけ赤く脈打つ線」に）、`layers.ts` / `layers.test.ts`、`data/tiles.ts` と `tiles.test.ts`（3 章の「捨てる」）、`renderer.ts` の `drawBiomeTint` の呼び方
- 統合役: `docs/CODE_MAP.md`（新規 10 ファイル前後）、`docs/GLOSSARY.md`（半マス・天面・側面・縁・汚し・置物）、`docs/ARCHITECTURE.md`（描画の決定性: 焼き付けは地図とテーマだけで決まる）、`docs/ideas/graphics-style.md`（A19 色の予約）、`docs/BALANCE.md`（feel に MAP_LIGHT）、`IDEAS.md` の現状、`CHANGELOG.md`、`npm run check`、5-2 節の撮影で前後比較

コストの合計: 段 0 S、段 1 M〜L ×2 + M ×2、段 2 M ×2 + S、段 3 M。

---

## 5. テストと見た目の確認

### 5-1. テスト（Vitest、名前とメッセージは日本語）

| ファイル | 内容 |
| --- | --- |
| `mapNoise.test.ts` | 同じ引数で同じ値、範囲 0..1、`vor` が出力の構造体を書き換えるだけ |
| `dualGrid.test.ts` | 角の 16 通りの網羅（孤立・縦横の縁・外角・内角）、地図の外は壁、左右反転で形も反転、頂点の距離が床で 0・壁の奥ほど増える |
| `mapTheme.test.ts` | 深度 1〜25 × 9 バイオームで必ずテーマが決まる、章 1 は側面 16・章 2/3 は 32、暗さが章 1 < 2 < 3 < 4、深みの変異で配色が変わる、**地図の色が予告の色（`TELEGRAPH` の黄 / 赤、`#ff4040`）と RGB 距離 60 以上離れている** |
| `mapBake.test.ts` | 決定性: 同じ地図で 2 回焼いて同じ画素、同じ seed で別に作った 2 つの state でも同じ画素。`state.rng` を偽物に替えて焼いても一度も呼ばれない（`flaskHud.test.ts:121-128` の形）。`step` の行数を 1 / 7 / 全部 で同じ画素。**隣り合う 2 チャンクと、同じ範囲を 1 枚で焼いた結果の継ぎ目が一致**。lip は南の壁の手前にだけ出る。性能: 全テーマで 1 チャンク 250ms 以下（負荷で落ちない緩い上限。目標の 25ms は ms を出力して統合役が見る） |
| `mapChunks.test.ts` | 欲しいチャンクの算出（画面 + 128px、最大 16）、分類の変化（壁 → 床）でハッシュが変わる・階段の出現では変わらない、LRU が 20 を超えない、未焼きは平塗りの対象になる |
| `terrainTex.test.ts` | 種類 × 16 形 × 4 変種の画素が決定的、形 0 は全透明・形 15 は全不透明、水の章の穴を水と数える |
| `mapLight.test.ts` | 光源が画面外を含まない・`maxLights` で切る、暗闇の階でも `DarknessLayer` の対象は変わらない |
| `mapDecor.test.ts` | 置き場所の分類、除外のマス（部屋の中心・扉・階段）に置かない、章 1 に和の置物が出ない、背の高い置物は壁際だけ |
| `layers.test.ts`（追記） | `drawMapLight` が `drawTerrainLayer` の後で、`drawGroundHazards` / `drawEnemies` / `drawProjectiles` / `drawPlayer` より前（**予告・弾・体は暗がりを受けない**）。段 3 から `drawFrontLip` が `drawPlayer` の後で `drawProjectiles` / `drawLasers` / `drawShapes` より前 |

`core/replay.test.ts` と QA は変わらないこと（state に触らない）を統合時に確認する。

### 5-2. 見た目の確認（Playwright、Chromium は /opt/pw-browsers）

- `tools/map-shot.html` + `src/tools/mapShot.ts`: クエリ `?depth=&kind=&seed=&tx=&ty=` で `createGame(seed, …, { …defaultRunSetup(), startDepth: depth })` → `buildFloor(state, kind)` → カメラを (tx, ty) か最初の部屋へ → `renderer.settleMap(state)` → `render` を 1 回 → `window.__mapShotReady = true`。`?bench=1` なら 300 フレーム横へ流し、地図の描画（`drawWorldLayer` の地図の部分）と焼きの ms の平均を `window.__mapBench` に出す。`vite build` の入力は `index.html` だけなので配布物に入らない
- `scripts/map-shot.mjs`: `vite --port 5199` を子で起こし、playwright（`PLAYWRIGHT_MODULE` か `npm root -g` の `playwright`）を `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` で読み、1920x1080（バックバッファ）で撮って scratchpad に PNG を出す。リポジトリには入れない
- `map:shot` は探索ログが空なので、ミニマップの確認には使えない（未踏の面だけになる）
- 撮る 12 枚: 拠点 / 深度 3 cave / 深度 4 swamp / 深度 5 ボス階 / 深度 7 rooms（寺院）/ 深度 8 mine / 深度 12 forge / 深度 13 glacier / 深度 17 cave / 深度 18 dark / 深度 21 / 深度 23。加えて river（穴と浅瀬）と court を 1 枚ずつ。各段の終わりに前後を並べてユーザーに見せる
- 性能の確認: `?bench=1` で、段 1 の前（今の描画）と段 3 の後を比べ、地図の描画の平均 ms が増えていないこと

---

## 6. ユーザーに聞くこと

1. **章 4 の壁の見せ方**: 見本は壁を奈落（浮島）に描いたが、本体には「弾が越える穴」がある。壁も奈落に見えると「撃てば越えそう」に読めてしまう。推奨: 床から 1.5 マスまでは崖の上端（岩の天面）として描き、その奥だけ奈落と浮かぶ岩片・逆さの鳥居にする（浮島の雰囲気は残り、弾の止まる所が読める）
2. **拠点の見た目**: 推奨は門前町の段まで今の絵（Puny のタイル）のまま。迷宮との差が目立つのが気になるなら、床と壁だけ章 1 の新しい描画を先に当てる（拠点の台の配置は変えない）

ほかは決めた: lip は全章 3px でシルエットなし、弾は自分より上に描く、章 1 に和の置物なし、章 3 の炎 / 霜はバイオームで分ける、地形の色は章に依らず種類で固定、最深の間 0.15・深み 0.40 の暗さ。

---

## 7. 根拠（読んだ箇所）

- 今の地図の描画は画面の全マスを毎フレーム `drawImage`（`src/render/renderer.ts:1087-1147`）。壁は 4 ビットの `wallMask`（`renderMath.ts:81-88`）と 3 値の `wallStyle`（`renderMath.ts:37-45`）、穴は仮の単色（`renderer.ts:1150-1159`）
- world 層の順は `renderer.ts:829-862`、表は `layers.ts:26-55`。暗闇は worldOverlay（`renderer.ts:865-867`）で敵ごと覆い、弾と燃焼を描き直す（`darkness.ts:62-125`）。マスクは 480x270（`renderer.ts:733`）
- 地形はマスごとに単色 + 点か Puny の水面を半透明で（`terrainUi.ts:61-121`）。浅瀬は生成時に地形の層へ写す（`system/terrain.ts:71-79`、`map/layout/finalize.ts:154-166`）
- 9 バイオームは同じ Puny の石の再配色（`data/tiles.ts:188-236`）、地形は下水の水面の色相回し（`data/tiles.ts:219-240`）、展開は読み込み時に 1 回（`tileAtlas.ts:9-22`）
- 実行中にタイルが変わるのは隠し部屋が開くとき（`system/hiddenRoom.ts:110-119`）、階段の出現（`boss.ts:426`、`specialRooms.ts:1303`）、泉（`roomTypes.ts:307`）、主の芯（`boss.ts:106`、`floorLord.ts:100`）。穴は実行中に増えない（`Tile.Pit` を書く system は無い）
- 足元の位置: `spriteFeetY = 中心 + 半径 + 2`（`renderMath.ts:91-94`）、プレイヤーは 2px 持ち上げ（`renderer.ts:522`）、半径 5・速さ 120（`combat/PLAYER.json`）
- 章は 5 階ずつ・最深の間 21・深み 22 から（`system/chapters.ts:12-46`）。変異は `bloodMoon` → `fog` → `elementStorm`（`system/runEvents.ts:299-306`）。バイオームは章に縛られない（`FLOOR_KIND.json` の `biomeMinDepth`）
- 見本の焼き付けの中身: 形 `smoothMask`（`map-preview.html:2022-2051`）、距離変換（2054-2079）、素材（2085-2336）、置物の置き方（2622-2667）、縁と影と lip（2721-2762）、光（3060-3111）、予告は光の外（3113-3131）
- 性能の実測（node、見本のコードを移した scratchpad のベンチ）: 16x16 チャンクで距離変換込み 35〜72ms、列の連なりに替えて 22〜51ms、うち形 12ms・苔の床 25ms

## 8. 不確かな点

1. **ブラウザでの焼きの速さ**: node の値で見積もった。L1b の `map-shot ?bench=1` で Chromium の実測を取り、25ms を超えるテーマは L1a で `vor` / `vnoise` のキャッシュを詰める。それでも足りなければ Web Worker で焼く（Electron の `file://` で module worker が動くかを先に確かめる）
2. **隠し部屋が開いたときの同期の焼き直し**: 1 回 25〜50ms の引っかかりが出る。気になる場合は「変わったマスだけ平塗りで上書きし、行の予算で焼き直す」に替える（`mapChunks.ts` の中で閉じる）
3. **ドット絵の作業台との相性**: `mapProps.ts` は役の文字で色を当てるので、`npm run sprite lint` / `render` がアトラスへの登録や全体の色表を前提にしていると通らない。L5 の最初に `scripts/sprite/cli.mjs` の入力の形を確かめ、合わなければ `render` に色表を渡す引数を足すか、確認用 PNG を `mapShot` で撮る
4. **光の色の重ね方**: `soft-light` の見え方は見本の掛け算と少し違う。L3 で 12 枚を撮り、合わなければ `overlay` か「暗くした後に `lighter` で弱く足す」に替える（数値は `MAP_LIGHT.lightTint`）
5. **描き順の入れ替え（弾を自分の上へ）**: 書の真上のレーンの銃口・`insideDrawnGun` の見え方に効く可能性がある。L7 の前にそのレーンの統合結果で撮り直し、銃口で弾が二重に見えないかを確かめる
6. **参道の判定**（確定 2026-10-01: court の参道は部屋の所属に入らず `roomOf == -1` で拾える。脇の戸口・外回り廊下・裏道も含む。縦軸の court は参道の両脇が東西の壁なので壁際の石灯籠の列が出ない）: court の参道を「どの部屋にも属さない通路のマス」（`RoomLookup.roomOf` が -1）で拾う想定。court の通路が部屋の所属に含まれている場合は拾えないので、L4 の最初に `map/layout/court.ts` の出力を 1 枚撮って確かめる
