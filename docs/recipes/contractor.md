# レシピ: 契約者

1. `src/system/contractors.ts`: `CONTRACTOR_KEYS` に key を足し、`CONTRACTORS` に定義（`name` は日本語、台座の種類は `OfferKind`、効果は関数）。取引の代価は欠片（`state.shards`）か生命
2. 契約（灰の公証人）を増やすなら `PACT_KEYS` に足し、失敗判定はその場、達成判定は `onContractsFloorReached`（次の階に着いたとき）
3. 鍛冶・属性の祭壇など「通常攻撃に属性を乗せる」系は `ensureContractStats` が `applyStats` の結果に後から足す
4. テスト: `system/contractors.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
