# レシピ: 契約者

1. `src/system/contractors.ts`: `CONTRACTOR_KEYS` に key を足し、`CONTRACTORS` に定義（`name` は日本語、台座の種類は `OfferKind`、効果は関数）。取引の代価は銭（`state.economy.coins`。払うのは `system/economy.ts` の `spendCoins`、得るのは `gainCoins`）か生命
1b. **解放制（段取り 9）**: 契約者を足したら `src/meta/unlocks.ts` の `CONTRACTOR_UNLOCKS`（`Record<ContractorKey, UnlockCondition>`）に 1 行（無いと tsc が落ちる）。最初から出すなら `START`、依頼の達成で開くなら `quest(依頼の key)`。封じた契約者は `pickContractor` で立たない（`state.runMeta.lockedContractors`。乱数を引かない）。依頼の一覧には「契約者「{名}」がランに現れる」が出る
2. 契約（灰の公証人）を増やすなら `PACT_KEYS` に足し、失敗判定はその場、達成判定は `onContractsFloorReached`（次の階に着いたとき）
3. 鍛冶・属性の祭壇など「通常攻撃に属性を乗せる」系は `ensureContractStats` が `applyStats` の結果に後から足す
4. テスト: `system/contractors.test.ts`

最後に `pnpm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。

## 商人の品を足す（2026-09-30）

商人（市・章の市）は `system/merchants.ts`。品を足すときは `WareKind`（`core/state.ts`）と `WARE_NAME` に 1 語、`src/data/balance/world/ECONOMY/market.json` の `stock` に数、`price.json` の `base` に値段、`applyWare` の switch に分岐を 1 つ。値段は章の倍率 × 揺らぎ × 買った回数 × 無法者で決まる（`warePrice`）
- 賭場の主の台座は `system/bets.ts`（品書き `planBookieBets`）、数値は `src/data/balance/world/ECONOMY/bet.json`
