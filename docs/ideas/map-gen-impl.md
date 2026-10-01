# マップ生成 8 型の本体への実装設計

作成日: 2026-10-01（未実装。ユーザーの決定「型 8 種を全部採用し、seed で階ごとに使い分ける」を受けた設計）
対象: 見本 `docs/ideas/previews/map-preview.html` の `// <gen2>` 区間の 8 型（cavern 大洞窟 / river 谷・川筋 / ring 環状 / court 中庭・寺院 / drunk 掘り手の迷い道 / isle 島と桟道 / terrace 縦穴・段々 / prefab 断片の組み合わせ）を、seed から階ごとに選んで本体で使う。見た目（dual-grid・密度 2）は別の段（`map-overhaul-ideas.md`）で扱い、ここでは生成・当たり・結線だけを扱う。

## 1. 結論

- **型の出力は、既存の洞窟と同じ「塊の部屋」（`GameMap.roomTiles`）に変換して floor.ts に渡す**。扉・封鎖・寄せ・陣・部屋種類・階の主はどれも既に塊の部屋を前提に動いているので、floor.ts 側はほとんど直さずに済む。部屋は「ノード（開始・主の間・部屋）+ ノードから育てた床の領域」で表す。洞窟と島でも封鎖は成り立ち、島はむしろ扉が桟道の端だけになるので一番きれいに封鎖できる
- **穴は新しいタイル `Tile.Pit = 4` で表す**。体（プレイヤー・敵・拾い物・設置物）は通れず、視線・弾・爆風は通す。第 1 段ではノックバックで落ちず、縁で止まる（壁と同じ）。落下は `status-and-terrain.md` #10 の段に回す
- **型は `chooseLayout`（`rng.next()` を 1 回）で選ぶ**。重み・章ごとの倍率・連続しない規則・拡縮は `world/MAP_LAYOUT/` の JSON に置く。ボス階（5 の倍数と最深の間）は今の rooms 生成のままにし、乱数も引かない。`REPLAY_VERSION` を 1 つ上げる

## 2. 根拠

### 2-1. 今の生成器と floor.ts が前提にしている構造

| 前提 | 場所 | 8 型で守ること |
| --- | --- | --- |
| タイルは Wall / Floor / StairsDown / Fountain の 4 種。通れるかどうかは `!== Wall` で見ている | `src/map/grid.ts` | 穴を足すなら、`=== Wall` で判定している所を洗い直す（2-2） |
| 部屋は `rooms: Rect[]`（塊に内接する正方形。中心・湧き位置の目安）と `roomTiles?: number[][]`（塊の所属タイル） | `src/map/grid.ts`, `src/map/cave.ts` | 全部の型で `roomTiles` を出す |
| 部屋 0 = 開始、部屋 1 = 最初の戦闘部屋（必ず normal）、最後の部屋 = 主の間・階段 | `src/system/floor.ts`, `src/map/cave.ts` | 並べ方は「開始 → 歩いて近い順 → 主の間」。階段は主の間の核（壁から最も遠い床）に置く |
| 扉 = 塊に 8 近傍で接する塊の外の床。行き止まりの袋は `dropPocketDoors` が除く | `src/system/floor.ts` | 部屋どうしは 8 近傍で 1 マス以上離す（`growRooms` の「取り合いになったマスはどちらにも入れない」規則） |
| 主の間は `carveArena` で円形に広げる。Floor 以外のマスを全部 Floor にする | `src/system/floor.ts`, `src/map/cave.ts` | 穴は埋めないようにする（Wall だけを床にする） |
| 敵は塊の所属タイルに湧く。陣の候補は「通常の種類・封鎖しない・24 タイル以上」の塊 | `src/system/floor.ts`, `src/system/jinSpawn.ts` | 陣の数は候補の塊の数で頭打ちになる（今は 13 前後）。**部屋の数が敵の総数に直結する** |
| 陣の数は Floor タイルの総数から出す | `src/system/jinSpawn.ts` | 穴は Floor ではないので、自然に数から外れる |
| 地形の塊は `room.rect` の中の Floor にだけ置く | `src/map/generator.ts`, `src/system/biomes.ts` | 穴に地形は乗らない |
| 封鎖中に届かない敵を寄せる処理（`reachableFromPlayer`）は `=== Tile.Wall` で塞ぐ | `src/system/floor.ts` | 穴も塞ぐ扱いにする必要がある |
| ボス階は boss.ts が矩形の最後の部屋を前提にしている | `src/system/biomes.ts` の注記 | ボス階は今のままにする |
| 生成の形はフロア種別（バイオーム）で決まる（`MAP_SHAPE`） | `src/system/biomes.ts`, `src/map/generator.ts` | 型はバイオームと独立に選ぶ。旧生成器は残す（ボス階・失敗時・テスト用） |

**8 型の合わせ方**: 共通の後処理 `finalizeLayout` が、型の下書き（セル配列 + ノード）を `GameMap` に変換する。

- ノードの扱い
  - **所属タイルを持つノード**: 生成器が部屋の床を知っている場合（court の中庭・脇の間・本堂、prefab の断片、ring の Voronoi の部屋、isle の島）。そのタイルをそのまま種にする
  - **持たないノード**: cavern の広間・小洞、river の岸の洞、drunk の目印・溜まり、terrace の段。ノードのマスから `growRooms` で半径 `grow` まで育てる

| 型 | 部屋 | 通路（どの部屋にも属さない床。徘徊・長蛇が使う） | 扉 |
| --- | --- | --- | --- |
| cavern | 広間・小洞から育てた塊 | 芯の通り道 | 今の洞窟と同じ広い口 |
| river | 岸の洞 | 河原・橋・浅瀬 | 洞の口 |
| ring | 外側の Voronoi の部屋 | 輪の道・近道 | 部屋の口 |
| court | 門・中庭・脇の間・本堂 | 参道・外回りの廊下・裏道 | 戸口 2 マス |
| drunk | 溜まり・目印から育てた塊 | 迷い道の大半 | 坑道の口 |
| isle | 島 | 桟道 | 桟道の端だけ |
| terrace | 1 つの段を 18u マスごとの種で区切った塊 | 坂・はしご口 | 段の高さぶんの線 |
| prefab | 断片 | L 字の廊下 | 断片の D |

- **洞窟と島の扉と封鎖**: どちらも成り立つ。cavern は今の洞窟と同じで、口が広い分だけ扉のタイルが長くなる（今の洞窟は 627〜1,526 / 階。`map-overhaul-ideas.md` E-1）。isle は穴が `isWalkable` に入らないので、扉が桟道の端の 1〜2 マスだけになる。第 1 段では特別扱いを入れない。扉の数は型ごとにテストで測る
- **鍵の部屋**: 封鎖する種類（`ROOM_KIND.locks`）と封印の宝物庫（vault）はどちらも `roomLocks` と塊の扉で動くので、型ごとの分岐は要らない

### 2-2. 穴（pit）の表し方

既存の地形層（水・油・溶岩・氷など。`src/core/terrain.ts`）は「床に重ねる層」で、上を歩ける。`rubble`（崩れる床）も奈落にはならない。奈落は未実装（`status-and-terrain.md`）。**通れない穴は、タイルを新しく足すしかない**。

| 項目 | `Tile.Pit` の振る舞い | 直す所 |
| --- | --- | --- |
| 体の当たり | 通れない（壁と同じ） | `src/system/physics.ts` の `isSolidTile` と `overlapsSolid` に Pit を足す。`overlapsWall`（呼び出し約 37 ファイル）は「体が入れない所」という意味のまま残す |
| 弾・光線 | 越える | `overlapsShotWall`（Wall と封鎖の扉だけ）を新設し、`src/system/projectiles.ts`、`src/skills/shots.ts`、`src/skills/geom.ts` の 3 ファイルだけ差し替える |
| 視線 | 通す | `src/map/pathing.ts` の視線はそのまま（Wall だけを見る） |
| 敵の経路 | 避ける | `src/map/pathing.ts` の距離場の `visit` で Pit も塞ぐ |
| 追跡の直進 | **穴へ向かって直進しない** | `chaseHeading` は「見えたら直進」なので、川越しの敵が縁に張り付く。`walkLine(map, a, b)`（線分上に Wall も Pit も無い）を新設し、`chaseHeading` の判定をこれに替える。視線（気付き・射撃）は今のまま |
| ノックバック | 縁で止まる（今の `wallSplat` と同じ） | 変更なし。落下は別の段 |
| ダッシュ・跳躍 | 越えられない（`moveBody`）。瞬間移動系は着地点が床なら越えられる | 変更なし |
| 扉 | 扉にならない | `src/map/grid.ts` の `isWalkable` から Pit を外す |
| 封鎖中の寄せ | 届かない扱い | `src/system/floor.ts` の `reachableFromPlayer` まわりを `isPassableTile` に |
| 商人の置き場 | 置かない | `src/system/merchants.ts` を `isPassableTile` に |
| 探索（ミニマップ） | 見えたら塗る | `src/system/explore.ts` を `!== Tile.Wall` に（川・池を地図に出すため） |
| 床の判定 `=== Tile.Floor`（spawner・jinSpawn・terrain・hiddenRoom など 14 か所） | 自然に外れる | 変更なし |
| 主の間を広げる処理 | 穴を埋めない | `src/map/cave.ts` の `carveArena` を「Wall だけを床にする」に |
| 浅い地形（見本の `ter`: 浅瀬・断片の `~`） | 既存の `water` | `GameMap.shallow?: Uint8Array`（地形番号）を足し、`src/system/terrain.ts` の `planOnce` で自然配置より先に写す（乱数は使わない） |
| 描画 | 章の見た目で塗る（深みは奈落、ほかの章は深い水・溶岩・油・氷の割れ目・墨） | `src/render/renderer.ts` は Wall 以外を床として描くので、Pit の分岐が要る。仮の単色 + ミニマップの色。形の良い絵は C 案の段で作る |

### 2-3. 型の選び方

純関数 `chooseLayout(rng, ctx)` を `src/map/layout/select.ts` に置く。ctx は depth・章・深みかどうか・ボス階か・floorKind・前の階の型。

1. **乱数を引かない場合**（実装ではテストの固定がボス階より先）
   - テストの固定（`withFixedLayout`）が掛かっていればその型を返す
   - ボス階（`isBossDepth`。最深の間を含む）は `"lordHall"` を返す（専用の部屋。`lordhall-design.md`）
2. **重み**は、型ごとに次の積で出す
   - `MAP_LAYOUT.weight[型]`
   - × `chapterMul[章 - 1][型]`（深みは `deepMul`）
   - × `biomeMul[floorKind]?.[型]`（省略時は 1）
3. **0 にする型**: `minDepth[型] > depth` の型と、前の階と同じ型（`repeatMul = 0` で連続しない）
4. **選ぶ**: `weightedIndex` で 1 回だけ `rng.next()` を引く
5. **前の階の型**: `GameState.floorLayout`（新しい欄）を上書きする前に読む。上り階段で戻った階も同じ規則で選び直す

JSON は `src/data/balance/world/MAP_LAYOUT/_index.json` に置く（初期値の提案）。

```json
{
  "weight": { "cavern": 1, "river": 1, "ring": 1, "court": 1, "drunk": 1, "isle": 1, "terrace": 1, "prefab": 1 },
  "chapterMul": [ { "cavern": 1.5, "drunk": 1.3, "river": 1.2, "court": 0.6 }, { "court": 1.5, "prefab": 1.4, "ring": 1.2 }, { "river": 1.3, "terrace": 1.4, "ring": 1.2 }, { "isle": 1.5, "terrace": 1.3 } ],
  "deepMul": { "isle": 2, "terrace": 1.5 },
  "biomeMul": {},
  "minDepth": { "cavern": 1, "river": 1, "ring": 1, "court": 1, "drunk": 1, "isle": 1, "terrace": 1, "prefab": 1 },
  "repeatMul": 0,
  "previewWidth": 64, "previewHeight": 40, "unitExp": 0.65,
  "areaScale": { "court": 0.85, "prefab": 0.9 },
  "validate": { "minRooms": 8, "minFloorRatio": 0.3, "maxFloorRatio": 0.7, "mainPathWidth": 2 }
}
```

`chapterMul` の行に書かない型は 1。型ごとの形の数値は `MAP_LAYOUT/<型>.json` に置く。

- JSON に置くもの: 遊びに効く数（部屋の大きさ・数、ループの本数、橋の本数、穴の幅、段の数、多島と大島の割合など）
- TS の定数に置くもの: アルゴリズムの細部（wander の細分回数、chaikin の回数、雑音の周期）

### 2-4. 地図の大きさと拡縮

- 本体は基準 96x56（`world/MAP_SIZE.json`）× 面積の倍率 3.5〜5 で、182〜214 x 106〜125 マスになる。見本 64x40（2,560 マス）の **7.4〜10.5 倍**
- 見本をそのまま 200x115 で回すと、床は 9〜20%（terrace 72%、drunk 38%）しかなく、地図が空っぽになる。個数と大きさを拡縮する必要がある
- **規則（全型共通）**
  - `S = √(W·H / 2560)`、`u = S ^ unitExp`（長さの倍率）、`countMul = S² / u²`（個数の倍率）
  - 生成器は見本の単位で書き、**長さ（半径・最小間隔・段の高さ・谷の幅）は u 倍、個数（Poisson の上限・小洞の数・橋の本数）は countMul 倍、道幅（通路・桟道・はしご・坂の半径）は据え置き**にする（体の大きさは変わらないため）

| 面積の倍率 | S | u（unitExp 0.65） | countMul |
| --- | --- | --- | --- |
| 1 | 1.45 | 1.27 | 1.30 |
| 3.5 | 2.71 | 1.91 | 2.01 |
| 5 | 3.24 | 2.15 | 2.27 |

- 部屋の直径は 12〜24 マス（今の rooms 型と同じ帯）、部屋の数は見本の約 2 倍（20〜30）になる見込み
- **1 本の骨格で地図を作る型の個数の伸ばし方**
  - river: 橋の本数を川の長さ ÷ (64u) に比例させる
  - ring: 芯の数を 1 → 2（8 の字）→ 3（鎖）と countMul で増やす
  - court: 中庭の数を軸の長さ ÷ (62u) にする
  - terrace: 段の数を H ÷ (40u) × 3〜5 にする
  - drunk: 掘り手の上限を countMul 倍にし、目標の床の割合はそのまま
- **型ごとの面積**: `areaScale` で幅と高さを √ 倍に縮められる。court・prefab は床の割合が低い（見本で 37〜46%）ので、少し小さい地図にして階段までの歩数を揃える
- 面積の倍率の抽選（`rollAreaMul`）は今のまま共通にする

### 2-5. 決定性と性能

**決定性**

- 見本は型ごとに `mulberry32(seed * k + c)` を自前で作っている。本体では `state.rng` だけを使う
  - 生成器の最初で `noiseSeed = rng.int(0, 0x7fffffff)` を 1 回引き、`vnoise` / `h32`（座標ハッシュ）に渡す
  - 以降の `rng()` は `rng.next()` に置き換える
- **乱数の消費順**: `chooseFloorKind` → `rollAreaMul` → `chooseLayout`（新。ボス階・固定時は引かない）→ 型の生成（検査に落ちたら同じ rng を進めて最大 `GENERATE_ATTEMPTS` 回）→ 全部落ちたら旧生成（`MAP_SHAPE` の rooms / cave）→ 以降は今の `buildFloor` の順のまま
- 実際に使った型は `map.layout` → `state.floorLayout` に記録する
- **エンジン差の対策**
  - 生成の内側のループでは `Math.hypot` を使わない（hypot は丸めの保証が無い）。`Math.sqrt(dx*dx+dy*dy)` で書く
  - sin / cos は向きの計算だけに使う
  - 並べ替えは添字で同値を割って安定にする
- `REPLAY_VERSION` を上げる（版の注記に「階ごとの型 8 種・穴」を 1 行足す）

**性能**（見本の JS を Node で 10 seed 計測。初回の JIT を含む。拡縮なし）

| 型 | 64x40 の平均 / 最大 | 200x115 の平均 / 最大 | 重い所と直し方 |
| --- | --- | --- | --- |
| river | 33 / 48ms | **116 / 146ms** | 全マス × 折れ線の全区間で `nearestOnPoly` を回している。折れ線をマスに描いてから距離を BFS か chamfer で一度に出す。橋の候補探しと Poisson の `avoid` もその表を引くだけにする |
| cavern | 15 / 57ms | 30 / 67ms | 全マス × 全広間・小洞。塊ごとの外接矩形の中だけを回す |
| ring / isle（Voronoi） | 5 / 3ms | 14 / 13ms | 全マス × 全点。点をバケツに分けて近い 2 点を探す |
| prefab | 7ms | 14ms（個数を伸ばすと悪化） | 空き地探しが「試行 40 × 全マス × 置いた断片」。乱択で 200 点を試すか、累積和の占有表にする |
| court / drunk / terrace | ≤ 6ms | ≤ 10ms | 問題なし |

- `connectAll`: 毎回全マスに番号を付け直し、最大 40 回回る。番号付けを 1 回にし、小さい成分から本体へ多点 BFS で順につなぐ
- `farthestPair` の Floyd O(n³): river は川を渡る辺を捨てるのでグラフの距離と歩く距離がずれる。**完成した地図の上で BFS を 2 回（往復で最も遠い 2 点を取る）に置き換える**
- 予算: 1 階の生成は **平均 40ms 以下・最大 80ms 以下（面積 5 倍）**。テストでは CI がぶれないよう 150ms で落とし、実際の数字は QA の表に出す
- `dropPocketDoors` は部屋ごとに「他の部屋のタイルの Set」を作り直している。部屋が 2 倍になると重くなるので、階ごとに 1 回、所属の配列（Int16Array）を作って共有するのが望ましい

### 2-6. テストと QA への影響

- **共通の検査**: `validateLayout(map): string | null`（`src/map/layout/validate.ts`）。finalize が呼んで落ちたら作り直す。テストも同じ関数を使う
  1. 通れる床（Floor・StairsDown）が 4 近傍で 1 つにつながる
  2. 部屋 0 が開始、最後が主の間で、階段が主の間の核にある
  3. 部屋どうしが 8 近傍で接しない
  4. 開始 → 主の間の道が幅 2 で通る（2x2 の窓が通れる BFS）
  5. 主の間が π·r² × 0.6 タイル以上（r = `FLOOR_LORD` の大きさから）
  6. 部屋（24 タイル以上）が `validate.minRooms` 以上
  7. 床の割合が `minFloorRatio`〜`maxFloorRatio` に入る
  8. 穴の上に部屋のタイル・階段が無い
- **表で回すテスト** `src/map/layout/layouts.test.ts`: 8 型 × seed 1〜30 × 面積 {1, 3.5, 5}。検査に通ること・同じ rng なら同じタイル列になること・型の失敗率（旧生成に落ちる割合）が 5% 以下であること
- **型ごとのテスト**: river は橋と浅瀬が 2 か所以上で両岸に部屋がある。isle は島の扉が桟道の上だけにある。court は本堂が軸の奥にある。など
- **選択のテスト** `select.test.ts`: ボス階は乱数を引かない・同じ型が続かない・minDepth 未満は出ない・重み 0 は出ない
- **穴のテスト** `src/system/pit.test.ts`: 体は止まる / 弾は抜ける / 視線は通る / 距離場は避ける / `chaseHeading` が穴へ直進しない / 探索で穴を塗る / 浅瀬が写る
- **結線のテスト**（floor）: 8 型を固定して `buildFloor` を通す。全部屋に扉がある（開始を除く）・湧いた敵と拾い物が穴の上に無い・陣が 1 つ以上ある・`pullStraysInside` が穴越しの敵を寄せる
- **arena の固定**: `arena()`（`src/system/testHelpers.ts`）は深度 1 の生成地図を使っており、使うテストが約 116 ファイルある。`withFixedLayout("legacy", …)` で包み、乱数を引かない分岐にすれば今の結果のまま残る。`core/game.test.ts` / `core/replay.test.ts` の fingerprint は版に合わせて期待値を更新する
- **QA bot**
  - `nearestEngagedEnemy` は視線で敵を選ぶ。川越しの敵へ直進して縁で詰まるので、`crossesLockedTile` と同じ形で `crossesPit` を足す
  - 経路探索と `chooseTargetRoomIndex` は変更なし
  - 縮小版の sim に「型を固定 × 2 seed × 1 階で階段まで着く」を足す
  - フル QA の report に型別の表（階段までの歩数・階の秒・生成直後の敵数・陣の数・死因・1 step の ms・生成 ms）を足す
  - 敵の総数は部屋の数で動くので、`JIN.tilesPerJin` / `maxJins` の見直しは QA の後に balance-tuner に任せる

## 3. 実装手順

段 1 は統合役が 1 コミットで済ませる。段 2〜3 は並列（worktree）で進める。

### 段 1（統合役、S）

`src/map/grid.ts` を最小 Edit: `Tile.Pit: 4`、`isPassableTile(t)`（Wall でも Pit でもない）、`isWalkable` を `isPassableTile` で判定、`GameMap` に `shallow?: Uint8Array` と `layout?: LayoutKind`。

### 段 2（並列）

**L0a 土台・map 層（M）**
- 所有（新規）
  - `src/map/regions.ts`: `floodFill` / `wallDistance` / `growRooms` / `tilesOfOwners` / `buildRoom` / `orderFromStart` を `cave.ts` から移す。Pit は距離の計算では壁として扱う
  - `src/map/layout/types.ts`: 下のシグネチャ
  - `src/map/layout/shapes.ts` + test: 見本の `disc` / `line` / `polyline` / `wander` / `blob` / `poisson` / `relax` / `mstEdges` / `addLoops` / `segCross` / `chaikin` / `h32` / `vnoise` / `caStep` / `tidy` / `voronoiCarve` / `connectAll` に型を付け、rng を引数で受ける形に直す
  - `src/map/layout/finalize.ts`、`validate.ts`、`select.ts`、`index.ts`（`LAYOUT_GENERATORS: Record<LayoutKind, LayoutGenerator>`、`generateLayoutMap(kind, rng, width, height): GameMap | null`）
  - 8 型のスタブ `src/map/layout/{cavern,river,ring,court,drunk,isle,terrace,prefab}.ts`（null を返すだけ）
  - `layouts.test.ts`、`select.test.ts`
  - JSON `world/MAP_LAYOUT/_index.json` と 8 型の `<型>.json`（`npm run balance:gen` はこのレーンだけが回す）
- 最小 Edit: `src/map/cave.ts`（regions から import。出力と乱数消費は不変。`carveArena` の Pit を埋めない）、`src/data/tuning.ts`（`MAP_LAYOUT` を re-export）
- 完了条件: `npm run check:fast`、既存の cave / generator のテストが無修正で通る

**L0b 穴の当たり・system（M）**
- 最小 Edit: `src/system/physics.ts`（`isSolidTile` / `overlapsSolid` に Pit、`overlapsShotWall` 新設）、`src/system/projectiles.ts` / `src/skills/shots.ts` / `src/skills/geom.ts`（`overlapsShotWall` へ）、`src/map/pathing.ts`（`visit` で Pit を塞ぐ、`walkLine` を新設して `chaseHeading` で使う）、`src/system/explore.ts`、`src/system/merchants.ts`、`src/system/terrain.ts`（`planOnce` で `map.shallow` を写す）
- 編集禁止: `src/system/floor.ts`
- テスト: `src/system/pit.test.ts`

**L6 描画の最小限（S）**
- 所有: 新規 `src/render/pitLook.ts`（floorKind・深み → 色。純関数 + test）
- 最小 Edit: `src/render/renderer.ts` の `drawTiles` に Pit の分岐、`src/render/minimap.ts` に穴の色。縁の絵は作らない

### 段 3（L0a の後に並列）

**L5 floor との結線（M）**
- 最小 Edit: `src/system/floor.ts`（`buildFloor` で `chooseFloorLayout(state)` → `generateLayoutMap` → 失敗したら `generateMap(mapShapeOf(…))`、`withFixedLayout`、`reachableFromPlayer` まわりを `isPassableTile` に）、`src/core/state.ts`（`floorLayout?: FloorLayout`）、`src/system/testHelpers.ts`（`arena` を `withFixedLayout("legacy")` で包む）、`src/core/replay.ts`（版と注記）、fingerprint の期待値
- テスト: 結線のテスト（2-6）

**L1 cavern + drunk（M）、L2 river + isle（L）、L3 ring + terrace（M）、L4 court + prefab（L）**
- 所有: `src/map/layout/<型>.ts`、`<型>.test.ts`、`world/MAP_LAYOUT/<型>.json` の中身
- 編集禁止: 上のファイル以外すべて（`index.ts` の登録は L0a が済ませている）
- 作法: 見本を移植し、2-4 の拡縮の規則と 2-5 の性能の直し方に従う
- 完了条件: `layouts.test.ts` のその型の行が通る、型ごとのテスト、面積 5 倍で生成が平均 40ms 以下
- L2 は river の距離場の作り直し、L4 は prefab の断片データ（`PREFABS` の文字の格子。TS の定数）と空き地探しの作り直しがあるので L

### 段 4

**L7 QA（M）**: `src/qa/bot.ts`（`crossesPit`）、`src/qa/simulation.test.ts`（型別の smoke とフル版の表）。`npm run qa:full` を裏で回し、前の report と比べる

**統合役（資料）**: `docs/CODE_MAP.md`（map/layout の各ファイル）、`docs/ARCHITECTURE.md`（乱数の順・版）、`docs/BALANCE.md`（`MAP_LAYOUT`）、新規 `docs/recipes/map-layout.md` と CLAUDE.md のレシピ表に 1 行、`docs/GLOSSARY.md`（穴・奈落、型の表示名を出す場合）、`IDEAS.md` の現状、`CHANGELOG.md`

### 型のシグネチャ（L0a が作り、全レーンが従う）

```ts
export const LAYOUT_KINDS = ["cavern", "river", "ring", "court", "drunk", "isle", "terrace", "prefab"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];
export type FloorLayout = LayoutKind | "legacy";
export const Cell = { Floor: 0, Wall: 1, Pit: 2 } as const;
export interface LayoutFrame { width: number; height: number; unit: number; countMul: number; noiseSeed: number; lordRadius: number }
export type NodeRole = "start" | "lord" | "room";
export interface LayoutNode { x: number; y: number; role: NodeRole; grow: number; tiles?: number[] }
export interface LayoutDraft { cells: Uint8Array; shallow: Uint8Array; nodes: LayoutNode[] }
export type LayoutGenerator = (rng: Rng, frame: LayoutFrame) => LayoutDraft | null;
export function finalizeLayout(kind: LayoutKind, draft: LayoutDraft, frame: LayoutFrame): GameMap | null;
export function chooseLayout(rng: Rng, ctx: LayoutContext): FloorLayout;
```

## 4. 不確かな点

- **今の `buildFloor` 全体の時間**は測れていない。L5 の完了時に、`createGame` → `buildFloor` を 10 回回す計測を結線テストの中で 1 回出す
- **部屋の数が 2 倍前後になったときの敵の総数**: 陣の候補が今の 13 前後から 20 以上に増え、`maxJins` 14 で頭打ちになる見込みだが未実測。L7 の型別の表で確かめる
- **ノード以外の床からの湧き**: `populateCorridors`（通路の徘徊）と `placeColumns`（長蛇）が、river の河原や ring の輪の道で多すぎないか。生成直後の敵数を通路と部屋に分けて見る
- **terrace と drunk で部屋が足りるか**: `validate.minRooms` で弾くと旧生成に落ちる割合が上がる恐れ。失敗率の行で確かめ、足りなければ型の JSON で種の間隔を詰める
- **大きい敵**が幅 2 の道で詰まらないか: 主は主の間から動かない前提。`enemies/stats` の半径と型ごとの最も狭い主の道を QA で突き合わせる

## 5. ユーザーの回答（2026-10-01）

1. ボス階: **今の部屋ではなく、専用の部屋（型 "lordHall"）を新しく作る**。設計は別に起こす（`lordhall-design` の節を足す）
2. 今の洞窟と部屋 + 通路は通常の階の抽選から **外す**（生成失敗時の代わりとテストの固定だけに残す）
3. 穴の第 1 段は **縁で止まる**
4. 広さは **今のまま**（面積 3.5〜5 倍）
5. 型の出やすさは **章でゆるく偏らせ、同じ型は続けない**（2-3 の `chapterMul` の初期値）

## 5-0. 回答前の質問（記録）

1. **ボス階（5 の倍数・最深の間）は今の部屋 + 通路のままでよいか**。推奨: そのまま（boss.ts が矩形の部屋を前提にしており、章ボスの手触りを変えないため）
2. **今の洞窟と部屋 + 通路を通常の階の抽選に残すか**。推奨: 抽選からは外し、ボス階と生成失敗時の代わりとしてだけ残す（大洞窟と断片の組み合わせがそれぞれの上位互換）
3. **穴の第 1 段は「縁で止まる（体は壁と同じ・弾と視線は通る）」でよいか**。推奨: はい。落下は `status-and-terrain.md` #10 の段で、投げ・突風と一緒に
4. **広さは今の面積 3.5〜5 倍のままでよいか**。推奨: まず据え置き、型別の歩数を QA で見てから `areaScale` で型ごとに縮める
5. **型の出やすさを章で偏らせるか**。推奨: ゆるく偏らせ、同じ型は続けない。全部の型が全部の章に出る（2-3 の `chapterMul` の初期値）
