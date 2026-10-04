# レシピ: 依頼 / 実績

- 依頼: `src/meta/quests.ts` の `QUEST_KEYS` に key を足し、`QUESTS` に `QuestDef`（`name` / `desc` は日本語、`goal`、`measure: (s: QuestSnapshot) => number`、`reward`）。`measure` が読める数え上げが無ければ `QuestCounters`（同ファイル）にフィールドを足し、`system/runEvents.ts` から呼ぶ `meta/runRecord.ts` の `noteRunEvents` で加算する。`QuestReward` は起点の解放 / 名のある遺物の抽選から外す / 図鑑の頁 / 称号のどれかで、数値の強さは配らない
- **依頼の語（段取り 9）**: `QuestDef.keywords?`（`core/keywords.ts` の語。持ち物の語と重なると 3 択に出やすくなる）を、語で言える依頼には付ける。重みは `pickQuestOffers` が「基本 1 + `META.questTagWeight` × 重なった語の数」で決める（持ち物の語は `loadoutKeywords(profile, skillProfile)`。`questTagWeight` 0 で従来の 3 択）。語で言えない依頼は省く（重みは常に 1）
- **依頼の達成で契約者が開く**: 契約者は `meta/unlocks.ts` の `CONTRACTOR_UNLOCKS` で `quest(依頼の key)` に結ばれ、達成すると次の探索から立つ（報酬の起点・ジョブ・遺物・頁・称号は変えず、解放は 2 つ目の報酬）。新しい依頼を契約者に結ぶなら `CONTRACTOR_UNLOCKS` の 1 行を差し替える
- 実績: `src/meta/achievements.ts` の `ACHIEVEMENTS` に `AchievementDef`（`key` / `name` / `desc` / `check: (ctx: AchievementContext) => boolean`）。`AchievementContext` は図鑑（`CodexSave`）・依頼（`QuestSave`）・メタ統計（`ProfileMeta`）を読むだけ。実績名がそのまま称号として名乗れる
- どちらも一覧画面は `meta/listScreen.ts` / `meta/screens.ts`（タブ状態）→ `render/codexUi.ts`（描画）で共通化されている。新しいタブを増やすのでなければ画面側は触らなくてよい
- テスト: `meta/quests.test.ts` / `meta/achievements.test.ts`

最後に `pnpm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
