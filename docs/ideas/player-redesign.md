# プレイヤーの全面リデザイン比較

更新: 灰冠の剣士の方向性が選ばれ、[身長64ドット版](player-noir64.md)を制作。現在のページは64版と前回の灰冠案の比較。

`npm run dev` のURLに `/tools/player-styles.html` を付けて開く。

2026-09-28: 既存の見た目・アニメーションにとらわれず全面的に新しくしたい、という要望を受け、以前の比較ページを更新。
既存リグを使わず、灰冠の剣士・落日の重騎士・異端の狩人の3種類を新規生成。
画像は `public/assets/player-redesign/{noir,knight,hunter}.png`。
各シートは4列×3行（待機・走行・攻撃）、12コマ。透過PNG。
ページの再生処理は `tools/player-redesign.mjs`。速度、背景、反転、停止、コマ送り、コマ一覧、PNG保存に対応。
攻撃行の最終セルは隣の斬撃の混入が大きいため、再生・単独PNG保存では待機先頭を復帰コマとして使用する。全シートのダウンロードは生成原本。
採用前のキーポーズ比較用。生成シートには形状・接地の揺れとセル端の切れが残るため、ゲーム本体へ組み込む際はフレーム清書と中割りが必要。縮小表示は実際のゲーム内サイズを保証しない。
ゲームの既存キャラクターやアニメーションは変更していない。

## 生成方法と最終プロンプト

imagegen スキル / built-in image_gen を使用。CLI/APIは使用していない。

### 灰冠の剣士

Use case: stylized-concept. Asset type: actual pixel-art animation sprite sheet for a dark fantasy action roguelike, a radically redesigned stylish protagonist. Create ONE sprite sheet PNG with genuinely transparent background. EXACT layout: 4 columns x 3 rows, equal square cells, no gutters, no text, no labels, no grid lines. Every cell contains the SAME full-body character at the SAME scale, feet baseline at 85% of cell height, centered at 45% cell width, ample space for sword, all facing right in side three-quarter view. Character: tall slender adult wandering swordsman, 6-head proportions, swept white hair, charcoal split long coat with burgundy lining, high collar, asymmetrical silver shoulder armor, long elegant steel sword. Premium hand-pixelled game sprite aesthetic, angular deliberate pixel clusters, limited palette, sharp silhouette, dramatic readable pose, NOT cute, NOT chibi, NOT round toy anatomy, no smooth vector look. Each cell effectively 128x128 pixel art enlarged crisply. Animation: row1 four idle frames subtle breathing, cloth drift, lowered sword; row2 four sequential running frames contact, down passing, opposite contact, up passing, deep forward lean and coat trailing; row3 four attack frames anticipation coiled sword behind shoulder, explosive deep lunge with extended sword and thin white slash arc, sweeping follow-through torso twisting, recovery sword lowered. Actual body articulation across frames not whole image bobbing. No background, no ground, no shadows outside character. Entire sheet must align exactly to uniform 4x3 slicing.

### 落日の重騎士

Use case: stylized-concept. Create a premium dark fantasy pixel-art sprite animation sheet: ONE PNG truly transparent background, exact 4 columns by 3 rows of equal square cells. No text, grid, labels or ground. Same character all 12 cells, right-facing three-quarter side view, full body, feet baseline 85% cell height, centered 45% cell width, constant scale, ample weapon clearance. Each cell looks like crisp hand-crafted 128x128 game pixel art. Character: imposing adult fallen cathedral knight, 5.5-head proportions, faceless narrow closed silver helmet, gold crest, oversized asymmetric ivory shoulder plates, dark navy fitted undersuit, torn ochre waist pennant, enormous broad steel greatsword wielded two-handed. Powerful triangular silhouette, elegant angular shapes, rich controlled shading, no chibi or toy anatomy. Row1: four idle frames braced heavy stance with subtle breathing. Row2: four sequential running frames with visibly alternating legs contact-passing-opposite contact-passing, weighty forward drive. Row3: four sword attack keyframes: windup lifting blade behind shoulder, explosive heavy lunge and downswing with pale-gold thin arc, low follow-through bent knees, recovery. Real articulated poses, not translated copies. Uniform exact 4x3 slicing, no cropping, no background or external shadow.

### 異端の狩人

Use case: stylized-concept. Create one premium hand-pixelled dark fantasy action game animation sprite sheet PNG with genuinely transparent background. EXACTLY 4 columns x 3 rows equal square cells without gutters, labels, text, grid, scenery or ground. 12 full-body sprites of the SAME character, identical scale, facing right in side three-quarter view, feet baseline 85% of cell, body centered 45% cell width, ample weapon clearance. Character: lithe uncanny adult masked relic hunter, 6 head tall proportions, bone-white angular crow mask with narrow teal eye, pointed black hood, layered ragged petrol-green long mantle, wrapped forearms, slim leather boots, curved silver sickle in each hand. Iconic sinister silhouette, sharp flowing fabric, expertly clustered crisp pixels as if native 128x128 per cell. No chibi, no round toy anatomy, no vector art. Row1 four distinct quiet stalking idle poses with breathing and flowing cloth. Row2 four sequential sprint frames, low predatory forward lean, truly alternating running legs and pumping arms, trailing mantle. Row3 four attack frames: crouched coiled anticipation, explosive forward sweeping twin sickle strike with slim turquoise arc, twisting low follow-through, recovery. Anatomical poses must articulate strongly across frames, not whole sprite translation. All frames aligned to a precise uniform 4x3 grid. No cropping, no external shadow.
