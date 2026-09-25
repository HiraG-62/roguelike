# レシピ: 効果音・音楽

- `audio/sfxNames.ts` の `SFX_NAMES` に名前を足す → 実装は 2 通り。**層を並べるだけで作れるなら** `audio/sfxLayers.ts` の `LAYERED_SFX` に `Layer`（`noise` / `tone` / `sweep` / `chord` など、`audio/layers.ts` の型）の配列を書く（新しい効果音はまずこちらを検討する）。個別の合成が要るときだけ `audio/sfx.ts` の `SFX_DEFINITIONS` に関数を書く（`Record<SfxName, …>` なので両方から漏れは型エラー）→ ロジックから `pushSfx` 近接命中の系統は刃・打撃・刺突・鞭打（`HitFamily` の `lash` → `hitLash*`。`system/effects.ts` の `HIT_FAMILY`）
- 攻撃・打撃の音は「トランジェント（`click`）+ ボディ（`kick` か `drive` 付きの `noise`）+ テール（`at` で遅らせた低域 `noise`）」の 3 層で組み、矩形波・のこぎり波の単音（ビープ）を主にしない。金属・刃・結晶は `metal`（`sfxLayers.ts` の `BLADE_RING` / `CLANG` / `CRYSTAL` / `CHAIN`）、鐘・魔法は `fm`、炎・雷のパチパチは `crackle`、泡は `blips`。スキルの属性ごとの発動音は `castSfxName`（`audio/sfxNames.ts`）。構成の検査は `audio/sfxFeel.test.ts`
- BGM を増やす・変えるなら `audio/music.ts` の `TRACKS`（`TrackKey = FloorKind | "boss"`。`TrackDef` は和音・リズム・打楽器の入り方）。曲の選択は `pickTrack`（フロア種別・交戦中・ボスで切り替え）、`main.ts` の `updateMusic` が state を読んで `musicCue` に渡す。ロジック（`system/`）は音楽を知らない
- テスト: `audio/sfx.test.ts` / `audio/music.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
