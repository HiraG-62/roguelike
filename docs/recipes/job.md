# レシピ: ジョブ

1. `src/data/jobs.ts`: `JOB_KEYS` に key を足し、`JOBS` に `JobDef`（ステータスの偏り、得意な武器種 `favored`、固有ルール 2 つは統一ルール文法で `rules`、初期スキル石 `starterSkill`、弱点 `weakness`。合計 0 になるようにする）
2. `src/system/jobs.ts`: `applyJobStats` がステータスの偏りと得意武器の上乗せを畳み込む（`system/runSetup.ts` の `applyRunStats` から呼ばれる）。`jobRules` が `collectRules` に合流し、`startJob`（`createGame` が呼ぶ）が未所持のときだけ初期スキル石を倉庫へ入れる
3. 依頼の報酬でジョブを解放するなら `meta/quests.ts` の `QuestReward` に `job` を指定
4. テスト: `system/jobs.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
