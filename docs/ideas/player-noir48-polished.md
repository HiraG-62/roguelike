# 灰冠の剣士・48ドット調整版

比較ページ `/tools/player-styles.html` は左が調整版、右が以前の48ドット版。

## 成果物

- `public/assets/player-redesign/noir48-polished-source.png`: 内蔵image_genで48版を参照して描き直した原画。
- `public/assets/player-redesign/noir48-polished.png`: 288×216px、72×72px×12コマ、24色パレットと透明。
- `scripts/player-redesign-polish.mjs`: 原画の切り出し・格子化・配色整理と待機の共通部分固定。`node scripts/player-redesign-polish.mjs` で再生成。

銀髪・顔・肩鎧・コートをまとまった色面へ整理。待機の頭・肩と接地したブーツは先頭コマを共通に使用してちらつきを抑えた。
剣先の切れが出ないよう攻撃の2コマを枠内へ寄せ、復帰コマは待機先頭と一致させた。
全12コマに空コマ・中間アルファ・セル端の切れがないことを生成時に検査。待機4コマは高さ48px。
ページに接地線と前コマの重ね合わせを追加。原寸表示、動作変更、コマ送り、PNG保存も利用できる。

ゲーム本体への適用前の比較用シート。走行と攻撃は各4キーポーズで、中割りを追加した最終アニメーションではない。

## 最終プロンプト（built-in image_gen、48版PNGを編集対象に指定）

Edit target: attached 288x216 sprite sheet. Polish THIS EXACT character and animation, not redesign. Use case stylized-concept, low-resolution game pixel art. Tall slender adult silver-haired dark fantasy swordsman, charcoal long split coat with burgundy lining, single silver shoulder plate, slim straight sword. Preserve recognizable silhouette and right-facing direction. Make a clean production-oriented LOW RES sprite sheet, exact 4 columns x 3 rows, each conceptual cell 72x72 pixels and character standing height 48 pixels. Ideally output native 288x216; if output must be larger use perfectly uniform nearest-neighbor integer enlargement. Transparency, no ground/grid/text. Give generous transparent margins inside EVERY cell, NO cross-cell contamination. Align planted feet at y60 in every logical cell and head top y13. Row1 four very subtle idle frames: same feet, same head/face/shoulder armor dimensions, only controlled 1 pixel chest breathing and 1-2 pixel coat tail motion. Row2 four sequential running frames: right leg forward contact, passing lifted foot, left leg forward contact, opposite passing. Stable torso and head volumes, physically alternating legs, trailing coat. Row3 four coherent sword attack frames: coiled anticipation blade over shoulder; deep grounded thrust/sweep to right; full follow-through; return to same idle stance. ALL swords fully inside cells. NO slash effects. Polish pixel clusters: silver hair as 3 connected masses with 3 shades, readable 1px dark eye and simple face plane, shoulder plate as solid curved 3-shade silver cluster, long coat broad flat 3-tone planes, clean burgundy lining, connected unbroken sword with dark outline and 1px pale blade core. Remove salt-and-pepper specular noise and single isolated highlight pixels. 20-24 consistent colors including dark violet outlines, skin, silver, burgundy. Hard pixel edges, no blur, gradients, dither or painterly texture. No chibi proportions. Make anatomy and equipment completely consistent across all frames.
