# 外部ドット絵素材の調査（配布素材の活用検討）

`memo/20260924-1.md`「グラフィック面」の要望（現行のドット絵路線は維持しつつ密度を上げたい。配布素材を使えるなら使いたいが、将来 Steam 等での配信を見据えてライセンスに注意したい）を受けての調査記録。**コードの変更・素材のダウンロードはこの調査には含まない。** 実際に採用する場合は個別に導入作業を起こすこと。

現状: `src/data/sprites.ts` の `PALETTE`（1 文字 = 1 色、約 40 色）と `SpriteFrames`（1 フレーム = 文字列配列）による完全自作のコード内ピクセルマップ。`src/render/sprites.ts` の `buildAtlas` が起動時に `renderFrame` で 1px ずつ `<canvas>` へ焼き込み、`SpriteAtlas` として保持する（`docs/ARCHITECTURE.md` 参照）。

## 1. 候補素材パック（18 件）

CC0 → CC-BY → 独自ライセンス → 参考（採用非推奨）の順に並べた。ライセンス文面は各配布ページを実際に読んだ内容のみを記載し、確認できなかった点は「要確認」とした。

### CC0（帰属表示不要、商用・改変・再配布いずれも自由）

| 名前 | URL | 作者 | 内容 | 本作との相性 | 注意点 |
| --- | --- | --- | --- | --- | --- |
| Tiny Dungeon | https://kenney.nl/assets/tiny-dungeon | Kenney | 130+ タイル、16×16、Tiled サンプル付き | ◎ サイズ一致。壁・床・小物の基本セット | アニメ無し。キャラは別パック（Roguelike Characters）が必要 |
| Micro Roguelike | https://kenney.nl/assets/micro-roguelike | Kenney | 320+ スプライト、8×8、モノクロ＋カラー2種、壁/敵/アイテム/UI | △ サイズが半分。UI アイコンの下敷きとしては使える | 8×8 なので本作の 16×16 と混在させると拡大率の扱いが要検討 |
| Roguelike/RPG Pack | https://kenney.nl/assets/roguelike-rpg-pack | Kenney | 1,700+ スプライト。キャラ・敵・タイル・アイテムを広く網羅 | ○ 物量が多く下敷きに向く | タイルサイズが素材ごとに混在（要確認）。取捨選択が要る |
| Mini Dungeon | https://kenney.nl/assets/mini-dungeon | Kenney | ダンジョン向けミニタイルセット | ○（要確認: 正確なタイル数・サイズ） | ページ未詳細確認。ダウンロード時に実寸を要確認 |
| Roguelike Characters | https://kenney.nl/assets/roguelike-characters | Kenney | プレイヤー/敵キャラのドット絵一式 | ○ Tiny Dungeon と組み合わせる前提の姉妹パック | アニメの有無・フレーム数は要確認 |
| 16x16 DungeonTileset II | https://0x72.itch.io/dungeontileset-ii | 0x72（GrafxKid が改修） | 16×16。壁・床・罠・松明（アニメ有）、ヒーロー/ゴブリン/ゾンビ/オーク/リザード/ドワーフ等のキャラ（歩行アニメ有）、武器・盾・宝箱 | ◎ 暗めのダンジョンで本作と最も雰囲気が近い。キャラのアニメ済み歩行がそのまま使える規模 | 非常に有名な素材で類似作が多い（差別化は再配色前提） |
| Cave Tileset | https://grafxkid.itch.io/cave-tileset | GrafxKid | 16×16、洞窟タイル（ブラウン/グレー2色調）、ループ背景 | ○ 洞窟フロア用の差分に使える | 元は横スクロール向け。トップダウン用への転用は要調整 |
| 16x16 Puny Dungeon Tileset | https://opengameart.org/content/16x16-puny-dungeon-tileset | Shade | 16×16。Wang タイル壁、床バリエーション、水/松明のアニメ、罠（岩・棘・刃・炎放射・落とし穴・熊罠）、宝箱/鍵/ポータル等のインタラクト | ◎ 本作の「テレグラフを読んで避ける」トラップ表現と相性が良い | OpenGameArt 上のライセンスタグを実物ページで再確認推奨（記載は CC0） |
| Top Down Dungeon Pack | https://opengameart.org/content/top-down-dungeon-pack | Screaming Brain Studios | 2,256 タイル。壁 28 種・床 14 種（レンガ/土/金属/砂/石/草/木/ガラス等） | △ タイルサイズが 64×64 で本作の 16×16 と不一致 | 4 分の1 に縮小するか、参考デザインとして自作に活かす形になる |
| Free CC0 Top Down Tileset Template | https://opengameart.org/content/free-cc0-top-down-tileset-template-pixel-art | RGS_Dev | 16×16、5 色パレットバリエーション、プロトタイプ向けの簡易タイル | ○ プロトタイプ用の下敷き。密度アップの本命ではない | 内容が薄め（テンプレート寄り）。本番アセットというより叩き台 |
| Dungeon Crawl Stone Soup タイル | https://opengameart.org/content/dungeon-crawl-32x32-tiles | 多数（コミュニティ） | 3,000+ タイル。地形・壁・モンスター・呪文エフェクト・アイテム・GUI 等 | △ 量は圧倒的だが 32×32 で見た目のタッチも本作と異なる（毛色が古典ローグライク寄り） | 大部分は Public Domain/CC0 だが、一部タイルの権利表記が不明瞭との指摘あり（要確認、`GitHub: crawl/tiles` のライセンス一覧で個別確認が必要） |
| Pixel Dungeon（DENZI）Public Domain Art | https://opengameart.org/content/denzis-public-domain-art | DENZI | 32×32、ダンジョンタイル・モンスター・アイテム・能力アイコン | △ サイズ違い、絵柄も本作よりやや素朴 | DENZI の配布物には別ライセンス（CC-BY 3.0 等）の作品も混在するため、使う個別ページごとにライセンスを再確認すること |
| Green Valley Tileset（Foozle） | https://foozlecc.itch.io/ （作品ページは Foozle のプロフィールから個別に辿る） | Foozle | 16×16、シンプルな汎用タイル | ○ プロトタイプ〜簡易差分向け | Foozle は多作者アセットの集積のため、個別ページで作者名を確認して `CREDITS.md` に記録すること |

### CC-BY（帰属表示が必須、商用・改変は可）

| 名前 | URL | 作者 | 内容 | 本作との相性 | 注意点 |
| --- | --- | --- | --- | --- | --- |
| Kyrise's Free 16x16 RPG Icon Pack | https://kyrise.itch.io/kyrises-free-16x16-rpg-icon-pack | Kyrise | CC BY 4.0。350+ スプライト、70+ デザイン、16/32/48px、武器・防具・消耗品等 15+ カテゴリ | ◎ 装備アイコンの密度を上げる用途に直結（`render/inventoryUi` 等のアイテムアイコン） | 帰属表示必須（作者は commercial 利用を明言済み）。クレジット画面と `CREDITS.md` の両方に記載する |

### 独自 EULA（サイトごとの利用規約。要件はページを読んで個別確認）

| 名前 | URL | 作者 | ライセンス要旨 | 内容 | 本作との相性 | 注意点 |
| --- | --- | --- | --- | --- | --- | --- |
| Pixel Art Top Down - Basic | https://cainos.itch.io/pixel-art-top-down-basic | Cainos | 独自 EULA。商用可・改変可・帰属表示は任意・**再配布/転売は禁止** | プロップ48・草15種・木3種・草地/石地面/壁タイルセット、簡易キャラコントローラー付き | ○ プロトタイプのプレイヤーキャラ差分に使える | 「素材そのものの再配布・転売禁止」は Steam 配信時のアセットバンドル同梱にも影響しうるため、ゲーム本体への組み込み（想定用途）であれば通常問題ないが契約文言は都度確認 |
| Ever Rogue Tileset | https://itch.io/game-assets/assets-cc0/tag-16x16 経由で検索（Efilheim 作） | Efilheim | 要確認（ページ未確認） | 16×16 ローグライク向け | ○（要確認） | ライセンス種別を配布ページで必ず確認してから候補に残すこと |
| Bitcrawl - Roguelike Free Pixelart Assets | itch.io（要 URL 確認） | 要確認 | 要確認 | 16×16、キャラ6種、アイコン25 | ○（要確認） | 同上 |
| Anokolisa の無料パック群 | https://anokolisa.itch.io/ | Anokolisa | 無料パックは「商用利用可」と明記されているものが多いが、パックごとに条項が異なる | ダンジョン/墓地等のテーマ別パック | ○（要確認） | 有料パックと無料パックで条件が異なるため、使うパック単位で規約を読み直す |

### 参考（採用を避けるべき例）

| 名前 | URL | 作者 | ライセンス | なぜ載せたか |
| --- | --- | --- | --- | --- |
| Liberated Pixel Cup (LPC) Base Assets | https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles | 多数の共同制作者 | CC BY-SA 3.0 と GPLv3 のデュアルライセンス | 有名で情報量も多いが、下記の理由で本作には非推奨。ライセンス早見表の具体例として記載 |

## 2. ライセンス早見表

| ライセンス | 商用配信 | 改変 | 帰属表示 | ソース公開義務 | 備考 |
| --- | --- | --- | --- | --- | --- |
| CC0 / Public Domain | 可 | 可（自由に再配色・改変してよい） | 不要 | なし | 実質「著作権放棄」。最も安全。感謝の意で任意クレジットは歓迎されることが多い |
| CC-BY 4.0 | 可 | 可 | **必須**（作者名・ライセンス名を明記） | なし | クレジット画面か `CREDITS.md`/README に記載すれば足りる。改変しても原作者の表示は消せない |
| CC-BY-SA（Share-Alike） | 可（条件付き） | 可（ただし派生物に同じライセンスを継承する義務） | 必須 | 実質あり（派生アセットを同ライセンスで公開する必要） | 「継承義務」がゲーム全体に及ぶかは境界が曖昧になりやすく、Steam のような閉源配信と相性が悪い。**避けるべき** |
| OGA-BY（OpenGameArt 独自） | 可 | 可 | 必須（OGA の規定書式に従う） | なし | CC-BY に近いが、OpenGameArt 側の追加条件（改変の明示等）があるため個別に文面確認が要る |
| GPL 系（GPLv2/v3） | 可（ソフトウェアとしては） | 可 | 必須 | **あり**（同じ成果物に組み込むと全体を GPL で配布する義務が生じ得るという解釈が一般的） | 元々コード用ライセンス。素材に適用されている場合、"アセットとコードが一体の成果物" とみなされるリスクがあり、クローズドソースで販売する本プロジェクトの方針と衝突する。**避けるべき** |
| 独自 EULA（itch.io 個別規約） | パックによる | パックによる | パックによる | なし（通常） | 「商用利用可」でも「素材そのものの再配布・転売は禁止」等の条項が個別に付くことが多い。採用時は配布ページの文言をそのまま `CREDITS.md` に引用しておくと後で揉めない |

**CC-BY-SA と GPL を避けるべき理由（まとめ）**: どちらも「派生物に同じライセンスを継承させる」copyleft 系の条項を持つ。ゲームの表示アセットとして組み込んだ場合に「ゲーム全体（あるいは組み込んだアセットファイル一式）が派生物にあたるか」の境界がケースごとに曖昧で、Steam 等での有償・クローズドソース配信を計画する以上、後から係争や規約違反の指摘を受けるリスクを避ける方が安全。LPC のように多数の作者が個別に権利を持つ素材は、そもそも全員分のクレジットを正確に集めるコスト自体も高い。

**CC-BY の帰属表示の書き方（例）**:
- クレジット画面（タイトル/設定内の「クレジット」表示）に素材ごとの行を追加: `アイコン: Kyrise（CC BY 4.0）https://kyrise.itch.io/kyrises-free-16x16-rpg-icon-pack`
- リポジトリの `CREDITS.md` にも同内容を記載（配布ページの URL・取得日・ライセンス名を含める）
- 改変（再配色等）した場合も原作者表示は残す。「元素材を改変して使用」と一言添えると誠実

## 3. 本作への取り込み方針案

1. **コード内ピクセルマップと PNG アトラスの併存**: 既存の敵・プレイヤー等は現行の `PALETTE` 文字マップのまま変更しない。外部素材を使う新規スプライトのみ、`src/render/sprites.ts` に PNG 読み込み経路を足す（`buildAtlas` の中で、`SPRITES`（文字マップ由来）と別に `Image`/`createImageBitmap` から `HTMLCanvasElement` を作る分岐を増やし、どちらも同じ `Sprite`/`SpriteAtlas` 型に載せる）。呼び出し側（`getSprite`）のインターフェースは変えずに済む
2. **パレット統一（再配色）**: 外部素材をそのまま置くと世界観が浮くため、取り込み時に既存 `PALETTE`（約 40 色）に寄せて再配色する。手段は次のどちらか
   - 手動でドット絵編集ソフト上でパレットを合わせてから PNG 化する
   - 一度 PNG を読み込み、近似色マッチングで `PALETTE` の色に丸めてから文字マップへ逆変換し、結局は既存方式に載せる（`recolorFrames` の考え方をパレット丸め版に拡張する）。後者は「ロジックと描画の分離」「`state.rng` を描画で使わない」といった既存の不変条件とも整合しやすい
3. **ライセンス表記ファイル**: リポジトリ直下に `CREDITS.md` を新設し、実際に採用した素材だけを次の形式で記録する。`docs/ASSETS.md`（本ファイル）は調査・比較のための候補一覧、`CREDITS.md` は「実際にゲームに入っている素材の法的に必要な表示」という役割分担にする
   ```
   ## <素材名>
   - 作者: <名前>
   - URL: <配布ページ>
   - ライセンス: <CC0 / CC-BY 4.0 等>
   - 取得日: <YYYY-MM-DD>
   - 使用箇所: <例: src/data/sprites.ts SPRITES.goblin の元絵>
   - 改変: <例: 16x16 のまま。パレットを既存 PALETTE に合わせて再配色>
   ```
4. **運用**: 新しい外部素材を検討するたびに、まず本ファイルの候補表に 1 行追記してから導入可否を判断する。実際に取り込んだら `CREDITS.md` に転記し、`docs/ideas/README.md` やレシピ（`CLAUDE.md` の「スプライト」節）にも「外部素材を使う場合は `CREDITS.md` 参照」の一文を足しておくと引き継ぎがぶれない

## 4. 推奨 5 件

1. **Tiny Dungeon（Kenney、CC0）**: 16×16 でサイズが完全一致し、CC0 なので帰属表示もライセンス管理の手間も要らない。壁・床・小物の基本セットとして最も安全に導入できる
2. **16x16 DungeonTileset II（0x72、CC0）**: 暗めのダンジョンという本作の雰囲気に一番近く、キャラの歩行アニメ・松明のアニメ済み演出がそのまま使える完成度。CC0 で商用配信の懸念もない
3. **16x16 Puny Dungeon Tileset（Shade、CC0）**: 罠（岩・棘・刃・炎放射・落とし穴）や水/松明のアニメが揃っており、本作の「テレグラフを読んで避ける」設計思想と相性が良い
4. **Roguelike/RPG Pack（Kenney、CC0）**: 1,700 点超という物量があり、UI・アイテム・敵の下敷きとして手数を大きく減らせる。CC0 なので採否判断に法務コストがかからない
5. **Kyrise's Free 16x16 RPG Icon Pack（Kyrise、CC-BY 4.0）**: CC0 ではないが帰属表示 1 行で商用利用が明確に許可されており、装備アイコンの密度を上げる用途では現状これを超える完成度の CC0 パックが見当たらなかったため次点として推奨

CC0 を優先し、どうしても表現力が足りない領域（装備アイコンの多様さ）だけ CC-BY を許容する、という順で選んでいる。

## 5. その他の注意点

**AI 生成素材について**: Steam は 2026 年時点で、プレイヤーが実際に触れる完成物（アートワーク・モデル・音声・テキスト等）に生成 AI ツールを使った場合の開示を求めており、開発の裏側だけで使う効率化ツール（コーディング支援等）は開示対象外と明確化されている。もし配布素材ではなく AI 生成のドット絵を使う場合は、(1) 出力物が既存の著作物を模倣・複製していないか確認する、(2) Steam 販売ページの AI 開示フォームに使用範囲を記載する、(3) 生成に使ったサービスの利用規約（商用利用可否・著作権の帰属）を別途確認する、の 3 点が必要になる。本調査は「配布されているドット絵素材」を対象にしたもので、AI 生成素材そのものの評価は範囲外。

Sources:
- [Tiny Dungeon · Kenney](https://kenney.nl/assets/tiny-dungeon)
- [Micro Roguelike · Kenney](https://kenney.nl/assets/micro-roguelike)
- [Roguelike/RPG pack · Kenney](https://kenney.nl/assets/roguelike-rpg-pack)
- [Mini Dungeon · Kenney](https://kenney.nl/assets/mini-dungeon)
- [Roguelike Characters · Kenney](https://kenney.nl/assets/roguelike-characters)
- [16x16 DungeonTileset II by 0x72](https://0x72.itch.io/dungeontileset-ii)
- [Cave Tileset by GrafxKid](https://grafxkid.itch.io/cave-tileset)
- [16x16 Puny Dungeon Tileset | OpenGameArt.org](https://opengameart.org/content/16x16-puny-dungeon-tileset)
- [Top Down Dungeon Pack | OpenGameArt.org](https://opengameart.org/content/top-down-dungeon-pack)
- [Free CC0 Top Down Tileset Template Pixel Art | OpenGameArt.org](https://opengameart.org/content/free-cc0-top-down-tileset-template-pixel-art)
- [Dungeon Crawl 32x32 tiles | OpenGameArt.org](https://opengameart.org/content/dungeon-crawl-32x32-tiles)
- [GitHub - crawl/tiles](https://github.com/crawl/tiles)
- [DENZI's public domain art | OpenGameArt.org](https://opengameart.org/content/denzis-public-domain-art)
- [Foozle - itch.io](https://foozlecc.itch.io/)
- [Kyrise's Free 16x16 RPG Icon Pack](https://kyrise.itch.io/kyrises-free-16x16-rpg-icon-pack)
- [Pixel Art Top Down - Basic by Cainos](https://cainos.itch.io/pixel-art-top-down-basic)
- [Anokolisa - itch.io](https://anokolisa.itch.io/)
- [Liberated Pixel Cup (LPC) Base Assets | OpenGameArt.org](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles)
- [Steam updates AI disclosure form (PC Gamer)](https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/)
