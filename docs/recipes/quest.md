# レシピ: 依頼 / 実績

- 依頼: `src/meta/quests.ts` の `QUEST_KEYS` に key を足し、`QUESTS` に `QuestDef`（`name` / `desc` は日本語、`goal`、`measure: (s: QuestSnapshot) => number`、`reward`）。`measure` が読める数え上げが無ければ `QuestCounters`（同ファイル）にフィールドを足し、`system/runEvents.ts` から呼ぶ `meta/runRecord.ts` の `noteRunEvents` で加算する。`QuestReward` は起点の解放 / 名のある遺物の抽選から外す / 図鑑の頁 / 称号のどれかで、数値の強さは配らない
- 実績: `src/meta/achievements.ts` の `ACHIEVEMENTS` に `AchievementDef`（`key` / `name` / `desc` / `check: (ctx: AchievementContext) => boolean`）。`AchievementContext` は図鑑（`CodexSave`）・依頼（`QuestSave`）・メタ統計（`ProfileMeta`）を読むだけ。実績名がそのまま称号として名乗れる
- どちらも一覧画面は `meta/listScreen.ts` / `meta/screens.ts`（タブ状態）→ `render/codexUi.ts`（描画）で共通化されている。新しいタブを増やすのでなければ画面側は触らなくてよい
- テスト: `meta/quests.test.ts` / `meta/achievements.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
