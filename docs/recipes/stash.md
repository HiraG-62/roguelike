# レシピ: 倉庫の並び・絞り込みの軸

- `src/ui/stashFacets.ts` の `SORT_KEYS` + `SORTS`（並び）か `FILTER_KEYS` + `FILTERS`（絞り込み。候補・表示名・一致判定・任意で値の色）に 1 件足す。ボタン・入力・描画は表から作られる（`ui/stashFilter.ts` / `render/stashToolbarUi.ts`）。部位タブは `LOOT_SLOTS` と倉庫にある部位、武器種は `MOVESET_KEYS` から自動で作るので、部位・武器種を増やしても触らなくてよい
- テスト: `ui/stashFilter.test.ts`（帯が重ならず幅に収まることを全部位・全軸で検査）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
