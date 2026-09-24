# グラフィック精細化と配布素材の導入（設計）

作成日: 2026-09-26
前提: `docs/ASSETS.md`、`src/data/sprites.ts`（PALETTE 56 色・SPRITES 約 100 キー）、`src/render/sprites.ts`（`buildAtlas` / `recolorFrames` / `TintCache`）、`src/render/renderer.ts`（`drawTiles` 867〜910・`drawEnemy` 1153〜1261・`drawPlayer` 1776〜1811）、`src/render/terrainUi.ts`、`src/render/darkness.ts`、`src/render/runUi.ts`（`drawBiomeTint` 35・`drawRoomProps` 108）、`src/render/renderMath.ts`（`tileHash` 10・`wallStyle` 25）、`src/core/view.ts`、`src/map/grid.ts`、`src/data/tuning.ts` の `FLOOR_KIND`、`src/render/sprites.test.ts`、`src/main.ts:216` を読んだ。`vite.config.ts` は存在しない（Vite 既定: `public/` がそのまま配信される）。

## 1. 結論

- **解像度は 480x270・16px タイルのまま。キャラだけ 24x24 のキャンバスに上げる**（ボスは 48x48、蝙蝠・鬼火・鼠などの小型は 16x16 のまま）。Enter the Gungeon と同じ構成（480x270 / 16px タイル / 20〜28px のキャラ）。当たり判定・カメラ・UI は触らない。`drawAnchored` が足元基準で、既に 16 / 24 / 32 が混在して動いているので、変更点は「足元の位置をキャンバス高ではなく当たり半径から決める」1 か所だけ
- **素材は 3 パック**: 0x72 DungeonTileset II（床・壁・扉・階段・宝箱・松明・泉。CC0）、Puny Dungeon Tileset（Wang 壁・罠・水面・鍵・ポータル。CC0）、Kenney Tiny Dungeon（UI アイコン・拠点の小物・不足分の穴埋め。CC0）。9 バイオームは「0x72 の石を基準に、色相 LUT でパック全体を再配色 + 既存の地形の層（草・氷・溶岩）」で作る。CC-BY は入れない（Kyrise は装備アイコン精細化を別件で起こすときの候補に留める）
- **取り込みは PNG アトラスをコード内ピクセルマップの「上書き」として合流させる**。`SpriteAtlas` の型・`getSprite` の呼び出し側は変えない。読み込み失敗や未ロード中は既存のピクセルマップで描くので、フォールバックは仕組み上ただで付いてくる
- **自作は「体 + 武器オーバーレイ」に分ける**。プレイヤーの体（歩き 4・待機 2・ダッシュ 1・被弾 1）を 1 回描き、武器種 10 種は 12x12 の持ち手オーバーレイ（コンボ 3 段 × 10 = 30 枚）で乗せる。敵は原画 46 枚（`ENEMIES` 60 定義のうち 33 が recolor なので 100 枚ではない）を「出現深度が浅い順」に 4 原画（歩き 2・予備動作 1・攻撃 1）で描き直す
- レーンは 4 本。A 素材取得 / B 取り込み基盤 / D 自作スプライト は並列、C タイル・小物の差し替え は A + B の後

## 2. 根拠

- `src/core/view.ts:5-6` VIEW 480x270、`src/map/grid.ts:12` TILE_SIZE 16。画面は 30 x 17 タイル。キャラを 24px にしても画面高の 9% で Gungeon と同じ比率
- `src/render/renderer.ts:1169` `feetY = cy + sprite.h / 2`、`1781` `bottom = pos.y + sprite.h / 2 - PLAYER_SPRITE_LIFT`。足元がキャンバス高から決まるため、16 → 24 にすると体が当たり判定より 4px 下にずれる。`src/data/enemies.ts:267` の当たり半径は 6（プレイヤーは `tuning.ts:3` の 5）なので、`feetY = cy + radius + 2` に置き換えれば現行 16px（6 + 2 = 8 = 16 / 2）と一致し、24px でも位置が変わらない
- `src/render/renderer.ts:817-838` `drawAnchored` は `img.width / height` を読むだけ。`1173` 影の大きさ、`1232` 頭上ラベル、`1252` HP バーは `sprite.w / h` 相対なので 24px でもそのまま追従する。既に mimic / hollowArmor が 24、ボスが 32（`sprites.ts:85` `upscale2x`）で動いている
- `src/render/sprites.test.ts:10` `LEGACY_KEYS` が `player` を 16x16 に固定している。D レーンで更新が要る
- `src/render/sprites.ts:66-72` `buildAtlas` は同期で `Record<string, Sprite>` を返し、`renderer.ts:598` がコンストラクタで呼ぶ。`Sprite = { frames: HTMLCanvasElement[], white, w, h }` なので、PNG から切り出した canvas を同じ型で作れば描画側の変更は不要
- `src/render/renderMath.ts:25-33` `wallStyle` は face / top / none の 3 値。壁の角・端の自動接続には隣接 4 方向のビットマスク（16 種）が要る。同ファイルの `tileHash` / `floorVariant`（10・17）はそのまま床の変種選びに使える
- `src/render/runUi.ts:35-52` `drawBiomeTint` が `BIOMES[floorKind].tint` を画面全体に 0.16 で重ねている。バイオーム別タイルを入れたら、この塗りは「素材が無いバイオーム」だけに残す
- `src/render/runUi.ts:66-120` 台座（`PropKind` 15 種: keystone / rune / lever / anvil / exchange / curse / bell / chest / captive / ascend / seal / vein / element …）は 5px の色付き菱形で描いている。ここが小物素材の差し替え先
- `src/render/terrainUi.ts:25-35` 地形 9 種は単色 + 点 2〜4 個。Puny の水面アニメ・0x72 の溶岩は「タイル素材 + 既存の明滅」で置き換えられる。煙（`drawSmokeLayer`）は今のままでよい
- `src/render/pixelText.ts:59-60` フォントは `document.fonts.load` の非同期で、未ロード中はフォールバックで描いている。画像も同じ流儀（ブロックしない・来たら差し替える）で揃える
- `package.json` に vitest の環境指定が無く node で走るため、`Image` / `canvas` を触るコードはテストできない。純関数（座標表・マスク・矩形切り出し計算）と DOM 依存（読み込み・描画）を分ける

## 3. 解像度の方針（詳細）

| 対象 | 現在 | 変更後 | 備考 |
| --- | --- | --- | --- |
| 論理解像度 | 480x270 | 変更なし | `core/view.ts` |
| タイル | 16 | 変更なし | 3 パックとも 16px |
| プレイヤー | 16x16 | 24x24（描画部は幅 14〜18・高さ 20〜24、足を最下段） | 武器は別レイヤ |
| 通常敵（人型・獣） | 16x16 | 24x24 | 原画 46 枚のうち小型を除く約 34 枚 |
| 小型（bat / wisp / rat / mite / beetle / fly） | 12〜16 | 16x16 | 群れで出るので大きくしない |
| ゴーレム・鎧 | 24x24 | 32x32 | |
| ボス 9 体 | 32x32（16 の 2 倍拡大） | 48x48 の描き下ろし | `upscale2x` は廃止 |

影響する箇所（すべて描画側、ロジック変更なし）:
- `renderer.ts:1169` と `1781`: 足元 = 当たり半径 + `FEET_PAD`（新定数 2）。`renderMath.ts` に `spriteFeetY(centerY, bodyRadius)` を足してテストする
- `renderer.ts:1173` 影の倍率 `sprite.w / TILE_SIZE`: 24px で 1.5 倍になる。`Math.min(1.25, …)` で上限を付ける（群れの床が黒く潰れない）
- `renderer.ts:1259` HP バー幅 16 固定: `Math.min(sprite.w, 20)` に
- ミニマップ・カメラ・当たり判定・`Enemy.body.radius`: 変更なし
- `sprites.test.ts:10` `LEGACY_KEYS` の `player` を 24 に、`SIZE` 表を更新

却下: 32px キャラ（画面高の 12%、30 x 17 タイルの画面で敵 8 体が重なると読めない）。960x540 化（全 UI の座標と `pixelText` の倍率が壊れ、ドット風フォントの整合が崩れる）。16px のまま描き込み（明暗 2 段を 3 段にする程度で「細かくなった」と分かるほど変わらない）。

## 4. 素材の選定

| 用途 | パック | ライセンス | 配布 URL | 使う中身 |
| --- | --- | --- | --- | --- |
| 床・壁・扉・階段・松明・泉・宝箱・柱・樽・骨 | 16x16 DungeonTileset II（0x72） | CC0 | https://0x72.itch.io/dungeontileset-ii | `0x0072_DungeonTilesetII_v1.x.png` + `tiles_list_v1.x`（矩形の一覧テキスト）。壁 left / right / mid / top / corner、床 8 種、doors_leaf、floor_ladder、wall_fountain（アニメ）、chest（開閉 3 フレーム）、column、crate、skull |
| Wang 壁・水面と松明のアニメ・罠（棘・刃・落とし穴・炎）・鍵・ポータル | 16x16 Puny Dungeon Tileset（Shade） | CC0 | https://opengameart.org/content/16x16-puny-dungeon-tileset | 洞窟・鉱山向けの岩壁、`water` アニメ、罠 → 部屋の仕掛け（lever / seal / ascend の見た目） |
| UI アイコン（欠片・鍵・扉・階段のマーク）、拠点の小物（書架・鍛冶台・井戸・掲示板）、穴埋め | Tiny Dungeon（Kenney） | CC0 | https://kenney.nl/assets/tiny-dungeon | `Tilemap/tilemap_packed.png`（12 x 11 = 132 タイル、16px、間隔 0）。平坦で明るい絵柄なので世界に置くものは LUT で暗く寄せる |

バイオーム 9 種 + 拠点の割り当て（素材 → 再配色 LUT → 地形の層）:

| FloorKind | 壁・床の元 | 再配色 | 補う地形・小物 |
| --- | --- | --- | --- |
| rooms | 0x72 石 | なし | 柱・樽・宝箱 |
| cave | Puny 岩 | 茶に寄せる | — |
| dark | 0x72 石 | 明度 -25% | 松明を減らす。`darkness.ts` はそのまま |
| forge | 0x72 石 | 赤褐色 | 溶岩（既存の terrain）+ 0x72 の鎖・柱 |
| ossuary | 0x72 石 | 灰白 | skull / bones の小物を `tileHash` で散らす |
| swamp | Puny 岩 | 緑 | 泥沼・水（既存の terrain を Puny の水面アニメに差し替え） |
| glacier | 0x72 石 | 青白 | 氷床（既存）。氷柱は自作スプライトのまま |
| mine | Puny 岩 | 暗い茶 | crate・鉱脈（vein）の台座 |
| meadow | 0x72 床 + 草の地形 | 明るい緑 | 草むら（既存）。木・柵は Kenney Tiny Dungeon の穴埋め。足りなければ次の候補は Kenney Tiny Town（CC0、同作者・同 16px） |
| 拠点（hub） | 0x72 石（暖色） | 橙に寄せる | 井戸・掲示板・書架・鍛冶台・祭壇・庭 = Kenney の小物 + 0x72 の泉 |

パレットの相性: 0x72 と Puny はどちらも暗い背景に彩度低めのブラウン系で、既存 `PALETTE` の床（`l` #47424e）・壁（`x` #5a5870）と明度が近い。Kenney は明るく彩度が高いので、世界に置く分は LUT（明度 -20%・彩度 -30%）を通す。自作キャラは輪郭 `k` #1a1a24 と明部で浮く設計（`pixel-artist.md`）なので、床が細かくなっても輪郭の規則を守れば埋もれない。

却下: Roguelike/RPG Pack（Kenney、1,700 点は多いが 16px の中に 1px 間隔・混在サイズがあり切り出し表が膨らむ）。Cave Tileset（横スクロール向けで壁の天面が無い）。Dungeon Crawl 32x32（サイズ違い・一部の権利表記が不明瞭）。Kyrise 16x16 Icon（CC-BY。装備アイコンは今回の範囲外なので保留。入れるなら `CREDITS.md` とタイトル画面のクレジット表示の両方が要る）。

## 5. 取り込みの仕組み

### 5.1 配置と読み込み

```
public/assets/
  0x72-dungeon/        tileset.png  LICENSE.txt  SOURCE.txt（URL・取得日・sha256）
  puny-dungeon/        ...
  kenney-tiny-dungeon/ tilemap_packed.png  LICENSE.txt  SOURCE.txt
```

- `vite.config.ts` は無いので `public/` がそのまま `/assets/...` で配信される。`index.html` の変更は不要
- 新規 `src/render/imageAtlas.ts`（DOM 依存・テストしない）

```ts
export interface ImageSheet { key: SheetKey; url: string }
/** すべての sheet を Image で読む。失敗した sheet は飛ばし、切り出せた分だけ返す */
export async function loadImageAtlas(defs: readonly TileSpriteDef[], sheets: readonly ImageSheet[]): Promise<SpriteAtlas>;
```

  読み込みは `new Image()` + `decode()`（`createImageBitmap` は古い Safari に無い）。切り出しは `document.createElement("canvas")` に `drawImage(src, sx, sy, w, h, 0, 0, w, h)`。白抜き（`Sprite.white`）は `source-in` で白を塗って作る（`sprites.ts:37` と同じ意味）

- `src/render/sprites.ts` に最小 Edit: `export function mergeAtlas(base: SpriteAtlas, over: SpriteAtlas): SpriteAtlas`（`{ ...base, ...over }` を返す）。PNG 側のキーがコード内ピクセルマップと同名なら上書き、無ければ元のまま = フォールバック
- `src/render/renderer.ts` に最小 Edit: `setAtlas(over: SpriteAtlas): void`（`this.atlas = mergeAtlas(buildAtlas(), over)` の後に `this.tints.clear()`。`TintCache` に `clear()` を足す。古い canvas を掴んだ色付きフレームを返さないため）
- `src/main.ts:216` の直後に最小 Edit: `void loadImageAtlas(TILE_SPRITES, SHEETS).then((a) => renderer.setAtlas(a));`。ループは待たない（タイトル画面が先に出る。フォントと同じ流儀）
- 決定性: 画像の有無は描画にしか効かない。`state` を読むだけで書かない（不変条件 1・3）

### 5.2 マッピング表（純データ・テスト対象）

新規 `src/data/tiles.ts`:

```ts
export const SHEET_KEYS = ["dungeon0x72", "puny", "kenneyTiny"] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export interface TileSpriteDef {
  /** SpriteAtlas のキー。コード内ピクセルマップと同名なら上書き */
  key: string;
  sheet: SheetKey;
  /** シート上の矩形（px）。frames > 1 なら x 方向に w ずつ並ぶ */
  x: number; y: number; w: number; h: number;
  frames?: number;
}
export const TILE_SPRITES: readonly TileSpriteDef[] = [];

export interface Lut { hue: number; sat: number; val: number }
/** バイオームごとの床・壁のキー接頭辞（表に無いバイオームは "rooms" にフォールバック） */
export const BIOME_TILESET: Readonly<Record<FloorKind | "hub", { prefix: string; lut?: Lut }>>;
```

  キー命名: `tile.<biome>.floor`（frames 4〜8）/ `tile.<biome>.wall.<mask 0-15>` / `tile.<biome>.stairs` / `tile.<biome>.door` / `prop.<PropKind>` / `terrain.<kind>`（frames）/ `hub.<HubSpotKey>` / `icon.<name>`。テストは「キーの重複が無い」「矩形が 16 の倍数」「バイオーム 9 種 + hub の floor / wall.0..15 / stairs / door が全部ある（フォールバックする種は表で明示）」

### 5.3 壁の自動接続

- `renderMath.ts` に `wallMask(map, x, y): number`（N=1 / E=2 / S=4 / W=8 の「隣が床」ビット）を追加。既存 `wallStyle` は残す（PNG が無いときのフォールバック）
- `drawTiles`（`renderer.ts:887-892`）: `tile.<biome>.wall.<mask>` が atlas にあればそれを、無ければ `wallStyle` で従来通り
- 角（斜め隣）は 4 ビットでは表せないが、0x72 は角の専用タイルが 4 種だけなので、第 2 段階で `wallMask8`（Wang 47 種）にする前提で `mask` の型を `number` にしておく。Puny の Wang 壁を使う cave / mine / swamp は 8 ビット化のときに効く

### 5.4 バリエーションと再配色

- 床: `floorVariant(x, y, frames.length)`（`renderMath.ts:17`）をそのまま使う。小物の散らし（骨・小石・苔）は `tileHash(x, y) % SCATTER_DENOM < n` で決める（rng 不使用、不変条件 2）
- 再配色: 新規 `src/render/imageLut.ts` に `applyLut(src: HTMLCanvasElement, lut: Lut): HTMLCanvasElement`（`getImageData` → HSV → `putImageData`）。**読み込み時にバイオーム数だけ 1 回** 作ってアトラスに `tile.<biome>.*` として登録する。毎フレームの合成はしない。`drawBiomeTint` の全画面塗りは `BIOME_TILESET` が `rooms` にフォールバックしたバイオームだけに残す
- `PALETTE` へは寄せない（量子化すると陰影が潰れる）。逆に、自作の小物（骨・宝箱・氷柱）は 0x72 の主要色 8〜10 個を `PALETTE` に足して同じ色で描く（D レーンの様式書に載せる）
- 地形の層: `terrainUi.ts` の `STYLE` に `sprite?: string` を足し、atlas にあれば `drawImage`（`spriteFrame` で明滅）→ 無ければ今の単色 + 点。`globalAlpha` の扱いは今のまま

### 5.5 暗闇・ミニマップ

- `darkness.ts` はマスク合成だけなので無変更。松明タイルを置くなら `drawGlows` にタイル位置の発光を足す（`tileHash` で松明の位置を決めれば描画だけで完結する）
- `minimap.ts` はタイル種別だけ読むので無変更

## 6. 自作スプライトの精細化

### 6.1 様式書（先に 1 枚作る）

`docs/ideas/graphics-style.md`（D レーンの最初の成果物。pixel-artist 全員が読む）:
- キャンバス 24x24、足を最下段（row 23）に置く、体の幅は 14〜18px、頭上 2 行は空ける（ラベル用）
- 光源は左上。輪郭 `k`。明・中・暗の 3 段（`PALETTE` の大小文字対 + 追加の中間色 1 つ）
- 右向き（左は反転。`renderer.ts:1186`）。武器オーバーレイの接続点（手の座標）を体フレームごとに表に書く
- 敵 1 体 = 原画 4（歩き A / B、予備動作、攻撃）。歩き 4 フレームは `walkCycle`（`sprites.ts:81`）のまま。予備動作は「形が変わる」（`pixel-artist.md` の方針）
- ボス 48x48 = 通常 / 予備動作 / 攻撃 / 特殊 1（潰れ・伸び・跳躍準備など既存の状態数に合わせる）

### 6.2 プレイヤー

- 体: `player`（24x24）歩き 4・待機 2・ダッシュ 1・被弾 1 = 8 フレーム。`drawPlayer`（`renderer.ts:1788`）は `moving` で歩き、それ以外 frame 0 なので、待機・ダッシュ・被弾を使うには frame 選びを `playerFrame(p)`（renderMath に純関数）に切り出す
- 武器: `weapon.<MovesetKey>.<step 1-3>`（12x12、30 枚）と `gun.<ShotKey>`（8x8、8 枚）。`drawPlayer` の後に `drawAnchored` で「手の座標 + 段ごとの向き」に重ねる。回転は既存 `drawRotated`（`renderer.ts:841`）
- 既存の `drawSlash` / `drawSwingTrail`（`renderer.ts:1870-1970`）はそのまま残す（軌跡は形で読ませる）

### 6.3 敵 46 原画・ボス 9 体の順番

1. 深度 1〜3 に出る常連（slime / eye / boar / knight / bat / rat / wolf / skeleton / bomber / laserEye / mite / beetle）12 体。recolor 33 種はこの原画に追従する（`spriteSources()` が自動で作る。`swap` は文字置換なので新原画でも同じ文字を使えば壊れない）
2. 中層（golem / wisp / hooded / leech / ghoul / bell / shade / spearman / netter / silencer / packLeader / fuseRat / multiBomber / carrionFly …）
3. W3（flameEater / windSprite / enemyMine / banner / hanger / maw / scribeImp / anvil / turret / broodEgg …）
4. ボス: kingSlime / boneLord / twinBrother・twinSister / frostGiant / giantToad / forgeMaster / turretMaster / librarian（ローテーションに出る順）
5. 台座・氷柱・木人・鏡の自分など動かないもの

### 6.4 pixel-artist（Opus）への指示の粒度

- 1 回の依頼 = 同じ家族 4〜6 体（例「鼠・狼・猪・甲虫」）。様式書と、その家族の既存原画・`EnemyDef`（behavior / windup / 色）を渡す
- 成果物は新規ファイル `src/data/sprites/<family>.ts`（`export const <FAMILY>_SPRITES: Record<string, SpriteFrames>`）。`src/data/sprites.ts` は `SPRITES = { ...legacy, ...playerSprites, ...beastSprites, … }` に最小 Edit で合流させる（並列 3〜4 人が同じ 3,358 行のファイルを触らないため）
- 検収は `npx vitest run src/render/sprites.test.ts` + スクリーンショット（`npm run dev` で seed 固定 → 目視）。**recolor 種の `swap` 元文字が新原画に残っているか** をテストに足す（`recolorFrames` の結果が元と違うことは既にテスト済み `sprites.test.ts:155-170`）

## 7. 素材の取得手順（A レーン）

作業は scratchpad で行い、リポジトリには最終 PNG と LICENSE / SOURCE だけ置く。

1. **Puny Dungeon（OGA）**: 配布ページの HTML を取得し、`/sites/default/files/` 配下の zip リンクを抽出して `curl -L -o puny.zip`。OGA は直リンクが安定しているので bot でも取れる。ページ本文の「License(s): CC0」の行を `SOURCE.txt` に引用
2. **Kenney Tiny Dungeon**: `https://kenney.nl/assets/tiny-dungeon` の HTML から `/media/pages/assets/tiny-dungeon/<hash>/kenney_tiny-dungeon.zip` を正規表現で拾って `curl -L`。hash は更新で変わるので URL を固定しない。zip 内の `License.txt`（CC0）を同梱
3. **0x72 DungeonTileset II（itch.io）**: itch の「Download」はセッション付き URL で、`curl` では取れない可能性が高い。取れなかったら **ユーザーに手動ダウンロードを依頼** し、zip を scratchpad の `assets-src/` に置いてもらう。ページの「License: CC0 / Public Domain」の記述を `SOURCE.txt` に引用
4. 展開: `tar -xf <zip>`（Git Bash に `unzip` が無くても `tar` で zip を展開できる）。PNG の実寸を `node -e` の PNG ヘッダ読み（IHDR の 16〜24 バイト）で確認して記録
5. 必要なファイルだけ `public/assets/<pack>/` へコピー。`SOURCE.txt` に URL・取得日・sha256（`sha256sum`）・切り出しに使う一覧ファイル名を書く
6. `CREDITS.md`（新規、`docs/ASSETS.md` 3 章の書式）に 1 節ずつ。CC0 でも記載する（後で混ざっても由来が分かる）。`docs/ASSETS.md` 末尾に「導入済み」節を足して `CREDITS.md` へ誘導
7. `docs/ASSETS.md` の候補表に無いパックを足したくなったら、先に候補表に 1 行追記してから（同 4 章の運用）

## 8. レーン分割

### A 素材取得（Sonnet implementer。コード変更なし）
- 所有: `public/assets/**`（新規）、`CREDITS.md`（新規）、`docs/ASSETS.md`（末尾に節を追記）
- 編集禁止: `src/**`
- 完了条件: 3 パックの PNG + LICENSE + SOURCE が置かれ、`CREDITS.md` に URL・ライセンス・取得日・sha256。取れなかったパックは理由と手動手順を報告。`npm run check` は無変更で通る
- 報告に必ず: 各 PNG の実寸、タイル間隔（0 か 1px か）、切り出し一覧ファイルの有無

### B 取り込み基盤（Sonnet implementer。設計は本書で固定済み）
- 所有: `src/render/imageAtlas.ts`（新規）、`src/render/imageLut.ts`（新規）、`src/data/tiles.ts`（新規。表は空に近いスタブ + 型 + `BIOME_TILESET` の骨格）、`src/data/tiles.test.ts`、`src/render/renderMath.test.ts`（追記）
- 最小 Edit: `src/render/sprites.ts`（`mergeAtlas`、`TintCache.clear`）、`src/render/renderMath.ts`（`wallMask`、`spriteFeetY`）、`src/render/renderer.ts`（`setAtlas`、`drawTiles` の壁分岐 887〜892 を「atlas にあれば mask キー」に、`1169` / `1781` の足元）、`src/main.ts:216` 直後の 1 行
- 型・関数: 5.1 / 5.2 / 5.3 のシグネチャ通り
- テスト（it 名）: 「wallMask は隣接 4 方向の床をビットにする」「wallMask は周囲が全部壁なら 0」「spriteFeetY は 16px 当時の足元（半径 6 → +8）と一致する」「TILE_SPRITES のキーは重複しない」「TILE_SPRITES の矩形は 16 の倍数」「BIOME_TILESET は FloorKind 9 種と hub を全部持つ」「mergeAtlas は同名キーを上書きし無いキーは残す」
- 完了条件: `npm run check` 通過。PNG が 1 枚も無い状態でも見た目が今と同じ（フォールバックの確認）

### C タイル・地形・小物の差し替え（Sonnet implementer。A + B の後）
- 所有: `src/data/tiles.ts`（表の中身）、`src/render/terrainUi.ts`、`src/render/runUi.ts` の `drawRoomProps` 〜 `propColor` 区間、`src/render/hubUi.ts` の飾り描画
- 最小 Edit: `src/render/renderer.ts`（`drawTiles` 867〜910・`drawFountain` 929〜941・`drawRoomFloor` の扉マーク）、`src/render/darkness.ts`（松明の発光を足すなら `drawGlows`）
- 完了条件: 9 バイオーム + 拠点で seed 固定のスクリーンショットを撮って報告。`drawBiomeTint` の全画面塗りが「素材のあるバイオームでは掛からない」テスト（`runUi` に純関数 `biomeTintNeeded(kind)` を切り出して it「素材を持つバイオームは色調を重ねない」）
- 注意: `Tile`（`map/grid.ts`）と `lockedTiles` は触らない。扉は `lockedTiles` の見た目差し替えだけ

### D 自作スプライトの描き直し（pixel-artist〔Opus〕を家族ごとに 3〜4 並列。先に様式書を 1 人が書く）
- 所有: `docs/ideas/graphics-style.md`（新規）、`src/data/sprites/<family>.ts`（新規、家族ごとに 1 ファイル 1 担当）、`src/render/sprites.test.ts`（`LEGACY_KEYS` / `SIZE` / 武器オーバーレイの存在検査を追記）
- 最小 Edit: `src/data/sprites.ts`（`SPRITES` に家族ファイルを合流。`upscale2x` の利用箇所を描き下ろしに置換）、`src/render/renderer.ts` の `drawPlayer` 1776〜1811（武器オーバーレイの合成。`playerFrame` は renderMath）
- B と `renderMath.ts` を共有する（B は `wallMask` / `spriteFeetY`、D は `playerFrame`。関数追加のみで衝突しない）
- テスト（it 名）: 「player は 24x24 で 8 フレーム以上」「全武器種の持ち手オーバーレイ weapon.<key>.1〜3 がある」「全射撃の型の gun.<key> がある」「recolor の swap 元文字が新原画に残っている」「ボスは 48x48」
- 完了条件: `npm run check` 通過。家族ごとのスクリーンショット

順序: A ∥ B ∥ D（様式書 → 家族並列）→ C。統合役が C の後に `CHANGELOG.md` と `docs/HANDOFF.md` を更新し、`CLAUDE.md` の「スプライト」レシピに「外部素材は `src/data/tiles.ts` + `CREDITS.md`」の 1 行を足す。

## 9. 不確かな点

- **各パックの中身は記憶ベース**（0x72 の泉・宝箱アニメ、Puny の Wang 壁、Kenney の 12x11 配置）。A レーンが実寸と一覧ファイルを報告してから C の表を書く。0x72 に泉が無ければ自作 `fountain` を残す
- **ライセンス表記の確認方法**: 配布ページの HTML を取得して「CC0」「Public Domain」「Creative Commons Zero」を grep し、その前後 200 文字を `SOURCE.txt` に引用する。zip 内に `License.txt` があればそれを正とする。OGA はページ右側の「License(s)」欄、itch はページ下部の「License」行、Kenney は zip 内 `License.txt`。表記が見つからなければ採用しない
- **bot の取得拒否**: itch.io はダウンロードにセッションが要るので `curl` では 403 になる可能性が高い（0x72 が該当）。Kenney は Cloudflare 越しだが通常の `User-Agent` を付ければ取れる想定。取れなければユーザーの手動ダウンロードに切り替える（scratchpad に置いてもらう）
- **Windows での zip 展開**: Git Bash に `unzip` が無い場合があるので `tar -xf` を第一候補にし、失敗したら PowerShell の `Expand-Archive`
- **Kenney の絵柄の浮き**: LUT で暗く寄せても平坦さは残る。世界に置くのは拠点の小物と穴埋めに限り、浮くようなら D レーンで自作に置き換える（`PALETTE` に 0x72 の色を足しておくのはそのため）
- **描画負荷**: 画面 510 タイル分の `drawImage` は今と同じ回数。バイオームごとの LUT 済み canvas を読み込み時に作るので毎フレームの合成は増えない
- **24px 化での被弾の読み**: 当たり半径 6 に対し見た目が幅 16〜18 になるので「見た目は当たったのに外れた」が増える。様式書で「体の中心 12px に密度を寄せ、外側は髪・マント・武器などの薄い要素にする」を規則にし、`npm run qa:full` で被弾率が変わらないことを確認する（描画だけの変更なので変わらないはず。変わったらロジックを触っている）

## 10. 取得結果（A レーン、2026-09-24）

配置先は `public/assets/<pack>/`。ライセンス確認の根拠と取得手順は各フォルダの `SOURCE.txt` / `LICENSE.txt`、および `CREDITS.md` を参照。ここではレーン C が `src/data/tiles.ts` の割り当て表を書くための実測値のみ記す。座標からの「どのタイルが何の絵か」の対応は目視確認が要る（このレーンではコードからは読み取れないため未確定）。

### 16x16 Puny Dungeon Tileset（取得済み）

- ファイル: `public/assets/puny-dungeon/punyworld-dungeon-tileset.png`
- 実寸: 416x320px
- タイル格子: 16x16px、隙間 0px、26 列 x 20 行 = 520 タイル
- 付属: `puny-dungeon-tiles.tsx`（Tiled 用。タイル id ベースでアニメーション定義が 26 件ある。フレーム数は 2〜8、1 フレームの表示時間は 100〜1000ms とタイルごとに異なる。id と絵の対応はタイル名を持たないため目視で確認する必要がある）
- 含まれないもの: 本体 zip にはサンプルキャラクター `sample-characters.png`（96x96、16px 換算で 6x6 マス）と Tiled サンプルマップ 5 枚があるが未配置（タイルセット本体のみ配置。要るなら再取得は容易）

### Tiny Dungeon（Kenney、取得済み）

- ファイル: `public/assets/kenney-tiny-dungeon/tilemap_packed.png`
- 実寸: 192x176px
- タイル格子: 16x16px、隙間 0px、12 列 x 11 行 = 132 タイル（`Tilesheet.txt` に同じ数値の記載あり。設計書 5.1 節が想定していた「12 x 11 = 132 タイル、間隔 0」と一致）
- 付属: 個別タイル 132 枚（`Tiles/tile_0000.png`〜`tile_0131.png`、16x16 RGBA）と、1px 間隔版 `tilemap.png`（203x186）が zip 内にあるが未配置(packed 版のみで足りる想定)
- ページ記載: 130 asset 収録、CC0

### 16x16 DungeonTileset II（0x72、未取得）

- `curl` でのダウンロードを試行したが、itch.io の無料ダウンロードはブラウザ JS 実行を前提にしたセッション付きフロー（購入ページの「No thanks, just take me to the downloads」リンクが JS で動的に埋まる）で、素の HTTP リクエストでは取得できなかった。ページの HTML 解析・購入ページの取得までは行ったが、そこから先はセッション回避の実装が要るため打ち切った（bot 検出回避はしない方針）
- ページから確認できた事実のみ: 配布ファイルは `0x72_DungeonTilesetII_v1.7.zip`（406kB）+ `pumpkin_dude.png` + `doc.png`。Asset license は CC0（Code license は MIT）。v1.7 で「autotiles」対応と devlog に記載があり、設計書 4 章が前提にしている「壁 left/right/mid/top/corner」等のタイル一覧・実寸・格子はまだ実測できていない
- 手動取得手順は `docs/ASSETS.md` 6 章、`CREDITS.md` に記載。ユーザーが zip を用意でき次第、展開して実寸・タイル一覧をこの節に追記する
