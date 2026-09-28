# 灰冠の剣士・身長64ドット試作

最新: 48版の[調整版](player-noir48-polished.md)を制作。現在の比較ページは調整前後の48版。

追加: 同じ原画から身長48ドット版も作成。現在の比較ページは48版と64版。
`node scripts/player-redesign-64.mjs 48` で `public/assets/player-redesign/noir48.png` を出力。
48版は288×216pxのシート、1コマ72×72px。待機4コマすべて実測高さ48px。
原画や配色は同じままサイズだけを比較する試作で、新規生成はしていない。

比較ページ: `/tools/player-styles.html`。前回の灰冠案と並べて表示。
内蔵 image_gen で原案を参照し、低解像度向けに描き直した。

- 原画: `public/assets/player-redesign/noir64-source.png`
- 実寸: `public/assets/player-redesign/noir64.png`（384×288px、4列×3行）
- 1コマ: 96×96px、待機4コマすべての不透明領域の高さ64px、24色のパレット＋透明
- `node scripts/player-redesign-64.mjs` で原画から実寸を書き出す。
- 身長基準の共通倍率、原画の接地位置を基準に配置。隣コマ由来の孤立画素を除き、最近傍で格子化・24色へ整理。
- ページの小窓は64版を原寸表示。前回案は近い身長まで縮める。ゲーム本体にはまだ適用しない。
- 動きは試作12コマ。中割りや形状の一貫性の仕上げは今後の作業。

## 最終プロンプト（built-in image_gen）

Edit the reference sprite sheet into genuinely LOW RESOLUTION pixel art. Preserve the Ashen Duelist design: tall adult 6-head proportions, white swept hair, black split long coat with burgundy lining, silver shoulder plate, slender steel sword. Reinterpret with large deliberate pixel clusters, only 16-24 colors total, 3 shades per material, no texture noise, NO fine stippling, NO anti-aliasing, NO painterly shading. Target character standing height EXACTLY 64 logical pixels, each frame has a 96x96 logical pixel canvas. Output a 4 columns by 3 rows sheet, ideally native 384x288 pixels; if larger output required use exact integer nearest-neighbor enlargement of that logical grid, never add detail. Transparent background. 12 frames: row1 4 idle breathing frames; row2 4 alternating running frames; row3 anticipation, deep forward sword strike, follow-through, recovery. All cells exactly equal, all feet same baseline at logical y=80, standing head at y=17, body center x=44, right facing. All swords and coat tails fully contained within their OWN cell with 6-pixel transparent margins. NO slash effects (to prevent adjacent-cell contamination). Strong dark contour, crisp readable face of very few pixels, simplify coat into broad 3-tone planes. This must look like an authentic carefully hand-pixelled 64px-tall game character, NOT a high-resolution image with a pixel filter. Preserve elegant slim proportions and strong articulated action poses. No text, labels, checkerboard, ground or shadows.
