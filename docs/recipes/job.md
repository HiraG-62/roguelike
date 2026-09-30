# レシピ: ジョブ（流儀）

ジョブ = 流儀。ステータスの偏り・**ダッシュの形**・**気力の源**・固有ルール 2 つ・初期スキル石・初期武器を持つ。得意武器の倍率と弱点は段取り 5c で削った（設計は `docs/ideas/weapon-forms-impl.md` 3-7）。

1. `src/data/jobs.ts`: `JOB_KEYS` に key を足し、`JOBS` に `JobDef`（`attributes` はステータスの偏りで合計 0、`dash` はダッシュの形、`mana` は気力の源、固有ルール 2 つは統一ルール文法で `rules`、初期スキル石 `starterSkill`、初期武器 `starterWeapon`）
   - 数値: 偏りは `data/balance/jobs/attributes.json`、気力の源の量は `data/balance/jobs/MANA_SOURCE.json` の `<ジョブ>`、ルールの数値は `JOB.json`。`mana` は `BASE_ATTACK_MANA`（通常攻撃の命中の下地 `JOB.manaBaseMul`）+ 流儀の源 1〜2 つ
2. ダッシュの形が新しいなら: `data/jobs.ts` の `DASH_FORM_KEYS`（末尾）と `DASH_FORM_NAMES`、`data/balance/jobs/DASH_FORM.json` に行（動く形は `distanceMul / timeMul / invulnMul / invulnAdd` + 形固有の数値）、`system/dashForms.ts` の `startFormEffect`（始まりの効果）/ `tickDashForm`（ダッシュ中の効果）/ `DASH_FORM_TEXT`（説明）。ダッシュそのものを差し替えるなら `replaceDash`
3. 気力の源が新しいなら: `data/jobs.ts` の `ManaSource` に 1 語、`system/manaSources.ts` の `amountOf` と `manaSourceText`、起きる場所のフックに `onManaSource(state, "<kind>", 量)` を 1 行
4. `src/system/jobs.ts`: `applyJobStats` が偏りを畳み込み（`system/runSetup.ts` の `applyRunStats` から）、`jobRules` が `collectRules` に合流し、`startJob`（`createGame` が呼ぶ）が未所持のときだけ初期スキル石・初期武器を渡す。起点画面の説明は `jobDetailLines`（ダッシュの形と気力の源を 1 行ずつ）
5. 依頼の報酬でジョブを解放するなら `meta/quests.ts` の `QuestReward` に `job` を指定
6. テスト: `system/jobs.test.ts`（定義・説明の行数）、`system/dashForms.test.ts`（形ごとに 1 本）、`system/manaSources.test.ts`（源ごとに 1 本）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`（ダッシュの形の名前は既存の語と重ねない）。
