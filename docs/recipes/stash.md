# レシピ: 候補の並び（旧: 倉庫の並び・絞り込みの軸）

装備画面の作り直し（統合案 E、`docs/ideas/inventory-v2/E-impl.md`）で、倉庫の一覧と並べ替え 8 軸・絞り込みは「候補の頁」に置き換わった。部位（か腰の石・系統）を選ぶと、その倉庫の物が 5 枚ずつ並ぶ。

- 並びは `src/ui/candidates.ts` の `SORT_ORDER`（`CandidateSort`: 合 = 噛み合う順 / 新 = 新着順 / 名 = 名のある遺物・銘・芽）と `SORT_LABEL`（札の 1 字と荷札の長い名）。並べ方は `sortedIds`（合は試着 `ui/tryOn.ts` の `compareFit`、同順は `foundAt` → id）。並びを足すときは `CandidateSort`（`ui/menuState.ts`）・`SORT_ORDER`・`SORT_LABEL`・`sortedIds` に 1 件ずつ足し、`docs/GLOSSARY.md` の「合 / 新 / 名」の行を直す
- 絞り込みの軸は持たない。系統で絞った候補は紋の伏流の「＋」から開く（`CandidateTarget` の `flow`）
- テスト: `ui/candidates.test.ts`（並びごとの順・5 枚ずつの送り）、`render/candidatesUi.test.ts`（候補の予算）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
