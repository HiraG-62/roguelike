# プレイヤーの見た目・比較サンプル

※ この文書は初回案の記録。比較ページは全面リデザイン版へ更新済み。
現在の内容は [player-redesign.md](player-redesign.md) を参照。

`npm run dev` の表示するURLに `/tools/player-styles.html` を付けて開く。
開発用ページで、通常のゲームのビルドには含めない。

現行の探索者と、黒衣の剣士・白銀の騎士・赤布の狩人・仮面の探索者の4案を比較する。
待機と歩行は各8フレーム。背景、拡大率、反転、停止を全案に共通で適用できる。
各案のPNG保存は表示中の1フレーム（密度2、透過72×80px）。
選択はページを開いている間だけ保持し、ゲームには適用しない。

絵の定義は `tools/player-style-samples.mjs`。既存の `scripts/actor/paint.mjs` と
`rig.mjs` を使用する。現行案の体は `bodyNone`、腕と剣は比較用の簡易描画。
新案の構えも比較用の固定姿勢で、ゲームに採用する際には腕と武器の分離が必要。
ページは `tools/player-styles.html`、操作とCanvas描画は `tools/player-styles.mjs`。
