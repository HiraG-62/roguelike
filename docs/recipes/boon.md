# レシピ: 祝福

1. `src/system/boonDefs.ts`: `BOON_KEYS` と `BOONS`（name / desc は日本語、`tags`、`cursed`、必要なら `requires`）。同じ主から出る多段の祝福なら `lineage` / `after`（系譜。4 段目は装備 / スキル石のタグを要求する奥義）、特定 2 祝福の合体なら `duo`（結び）
2. 効果: 数値なら `foldBoonStats`（`boons.ts`）、ルール変更なら `boons.ts` の既存フック（`onBoonMeleeHit` / `onBoonKill` / `onBoonDash` …）から `boonRules.ts` の `onBoonXxxRules` を呼ぶ（大拡張分はここに実装を足す）か、呼び出し側 system で `hasBoon` 分岐。数値は tuning の `BOON`
3. 原則: **数値盛りではなくルール変更**。装備タグと掛け算になる形にする
   - 格（並 / 大祝福 / 神威）: Rule 型は `rules.ts` が効果量・半径（神威は ICD）に自動で掛ける。効果量 0 で半径だけ持つ Rule は `graded: true`。フック型で格を効かせるなら定義に `graded: true` を付け、倍率に `boonGradeMul(state, key)`（`boonGrade.ts`）を掛ける。呪い付きは格を持たず、無敵時間は格で伸びない
   - 芯: 定義に `core: true` / `graded: false`（1 ランに 1 つ、深度 `BOON.coreDepth` の最初の提示だけに出る。遊び方を変える効果と代償を必ず持つ）。数値は `boonCores.ts` の `foldCoreStats`、他の system からの分岐は `boonCores.ts` の関数を呼ぶ。定義は `boonDefsWave3.ts`
4. テスト: `system/boons.test.ts`（定義・抽選）/ `system/boonRules.test.ts`（拡張ルールの効果）

## 常時の増・倍・条件付き・「〜につき」は `modifiers`

イベントを待たない与ダメ・怯み値の補正は、`BOONS` の定義に `modifiers`（`core/rules.ts` の `Modifier`）を置く。フックや `foldBoonStats` の `*Mul *=` は書かない。

- `kind: "increased"`（増。0.1 = +10%、装備の増と足してから 1 回掛かる）/ `"more"`（倍。1.2 = ×1.2、出所ごとに掛け算）
- `tag`: 与ダメのタグ（`core/damage.ts` の `DAMAGE_TAGS`）か `"all"`。怯み値は `"poise"`（与ダメには効かない）
- `if`: `RuleCondition` をそのまま使う（対象の条件は今殴っている敵で見る。対象のいない 1 撃では効かない）
- `per`: 「〜につき」（`PerCounter`。`every` 単位で 1 つ、`cap` は効きの上限）。例: コンボ 10 につき増 +2%（上限 100%）= `{ kind: "increased", tag: "all", amount: 0.02, per: { count: { kind: "combo" }, every: 10, cap: 1 } }`
- 集める順は `system/modifiers.ts` の `collectModifiers`（装備 → 誓約 → ジョブ → 武器種 → 持続の奥義 → 祝福の取得順 → スキルスロット順）。テストは `system/modifiers.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
- 銭の祝福の見本: 「守銭」`miser`（持つ型: 持ち金 20 につき増。`modifiers` の `per: { kind: "coins" }`）/ 「拾銭」`coinGleaner`（稼ぐ型: `onCoinPickup` の Rule）。`boonDefsWave3.ts`
