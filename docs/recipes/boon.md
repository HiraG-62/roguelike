# レシピ: 祝福

1. `src/system/boonDefs.ts`: `BOON_KEYS` と `BOONS`（name / desc は日本語、`tags`、`cursed`、必要なら `requires`）。同じ主から出る多段の祝福なら `lineage` / `after`（系譜。4 段目は装備 / スキル石のタグを要求する奥義）、特定 2 祝福の合体なら `duo`（結び）
2. 効果: 数値なら `foldBoonStats`（`boons.ts`）、ルール変更なら `boons.ts` の既存フック（`onBoonMeleeHit` / `onBoonKill` / `onBoonDash` …）から `boonRules.ts` の `onBoonXxxRules` を呼ぶ（大拡張分はここに実装を足す）か、呼び出し側 system で `hasBoon` 分岐。数値は tuning の `BOON`
3. 原則: **数値盛りではなくルール変更**。装備タグと掛け算になる形にする
4. テスト: `system/boons.test.ts`（定義・抽選）/ `system/boonRules.test.ts`（拡張ルールの効果）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
