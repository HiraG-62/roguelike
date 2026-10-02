# レシピ: 候補の並び（旧: 倉庫の並び・絞り込みの軸）

装備画面の作り直し（統合案 E、`docs/ideas/inventory-v2/E-impl.md`）で、倉庫の一覧と並べ替え 8 軸・絞り込みは「候補の頁」に置き換わった。部位（か腰の石・系統）を選ぶと、その倉庫の物が 5 枚ずつ並ぶ。

- 並びは `src/ui/candidates.ts` の `SORT_ORDER`（`CandidateSort`: 合 = 噛み合う順 / 新 = 新着順 / 名 = 名のある遺物・銘・芽）と `SORT_LABEL`（札の 1 字と荷札の長い名）。並べ方は `sortedIds`（合は試着 `ui/tryOn.ts` の `compareFit`、同順は `foundAt` → id）。並びを足すときは `CandidateSort`（`ui/menuState.ts`）・`SORT_ORDER`・`SORT_LABEL`・`sortedIds` に 1 件ずつ足し、`docs/GLOSSARY.md` の「合 / 新 / 名」の行を直す
- 絞り込みの軸は `CandidateFilter`（`ui/menuState.ts`）の 系統（`keyword`。物が関わる語 `subjectKeywords`）と 型（`resource`。スキル石だけ）。札は並びの札の右（`FILTER_CHIPS`）で、決定するたびに `nextFilter` が次の値へ送る（今ある物に出てくる語だけを `KEYWORDS` の順に。最後に「絞らない」へ戻る）。軸を足すときは `CandidateFilter`・`filterAvailable`・`passesFilter`・`nextFilter`・`render/candidatesUi.ts` の `drawFilterChips` に 1 件ずつ足す。系統で絞った候補は紋の伏流の「＋」からも開く（`CandidateTarget` の `flow`。このときは系統の札を出さない）
- スキル枠の候補（`target.kind === "stone"`）の左下の腰の石は、決定・クリックでそのスキル枠の候補へ替える（`switchStone` → `menuActions.switchCandidateStone`。絞り込みを引き継ぐ。部位のマスの `switchPart` と同じ形）
- 手持ちの刻印符（スキルの頁の下）の絞り込み・並びは `ui/handRunes.ts`（`HandOptions` の 並び 新着 / 名前 / 種類・種類 変形 / 循環 / 型替え・系統・付けられる物だけ）。足すときは `HandOptionAxis`・`nextHandOptions`・`handGroups`・`ui/skillPage.ts` の `HAND_CHIPS` に足す
- 候補の差の右の列（変わる地金のステータスの「今 → 後」）は `ui/statDiff.ts`。項目の数は `MENU_BUDGET.innateDiffs`、数の上限は `compareNumbers`
- テスト: `ui/candidates.test.ts`（並びごとの順・5 枚ずつの送り・絞り込み・腰の石の切り替え）、`ui/skillPage.test.ts`（手持ち）、`ui/statDiff.test.ts`、`render/candidatesUi.test.ts`（候補の予算）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
