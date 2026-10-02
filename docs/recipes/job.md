# レシピ: ジョブ（流儀）

ジョブ = 流儀。ステータスの偏り・**ダッシュの形**・**気力の源**・固有ルール 2 つ・初期スキル石・初期武器を持つ。得意武器の倍率と弱点は段取り 5c で削った（設計は `docs/ideas/weapon-forms-impl.md` 3-7）。

1. `src/data/jobs.ts`: `JOB_KEYS` に key を足し、`JOBS` に `JobDef`（`keywords` は共鳴の数えに使う語で必須〔`kw(源, 糧, 強め)`。流儀 1 つが出どころ 1〕、`attributes` はステータスの偏りで合計 0、`dash` はダッシュの形、`mana` は気力の源、固有ルール 2 つは統一ルール文法で `rules`、初期スキル石 `starterSkill`、初期武器 `starterWeapon`）
   - 数値: 偏りは `data/balance/jobs/attributes.json`、気力の源の量は `data/balance/jobs/MANA_SOURCE.json` の `<ジョブ>`、ルールの数値は `JOB.json`。`mana` は `BASE_ATTACK_MANA`（通常攻撃の命中の下地 `JOB.manaBaseMul`）+ 流儀の源 1〜2 つ
   - ジョブ固有の派生（左左左右のフィニッシュ）も 1 本要る: `data/jobs.ts` の `JOB_BRANCH_NAMES` / `JOB_BRANCHES`、数値は `data/balance/weapons/WEAPON/jobBranches.json` の行（`data/scalingVariety.test.ts` の `NEW_JOB_BRANCH_TABLE` に key を足す）。`LEGACY_FAVORED`（旧「得意な武器」。初期武器の武器種を含める）にも 1 行。体の絵 `body<Job>` は pixel-artist の仕事で、描くまでは見習いの体で描かれる（`render/actorSprites.test.ts` の `JOBS_WITHOUT_OWN_BODY` に key を足す）
   - 見習い以外は必ず `unlockedBy`（依頼の key）を書く。最初から選べるのは見習いだけ（`system/jobs.test.ts` が検査）
2. ダッシュの形が新しいなら: `data/jobs.ts` の `DASH_FORM_KEYS`（末尾）と `DASH_FORM_NAMES`、`data/balance/jobs/DASH_FORM.json` に行（動く形は `distanceMul / timeMul / invulnMul / invulnAdd` + 形固有の数値）、`system/dashForms.ts` の `startFormEffect`（始まりの効果）/ `tickDashForm`（ダッシュ中の効果）/ `DASH_FORM_TEXT`（説明）。ダッシュそのものを差し替えるなら `replaceDash`。着地の後まで効果が残る形（護り足の結界）は `Player.moment` に「〜まで」の時刻を持ち、読む側（`wardIncomingMul`）は state.time と比べる。設置物と位置を入れ替える入れ替わりの相手は `swapCandidates`（従魔を足したらここに並べる）
3. 気力の源が新しいなら: `data/jobs.ts` の `ManaSource` に 1 語、`system/manaSources.ts` の `amountOf` と `manaSourceText`、起きる場所のフックに `onManaSource(state, "<kind>", 量)` を 1 行（設置物・従魔の命中は `skills/placed.ts` / `summons.ts` の一撃に `SkillHitSpec.minion: true`。刻む命中には付けない = 気力が湧きすぎる）
4. `src/system/jobs.ts`: `applyJobStats` が偏りを畳み込み（`system/runSetup.ts` の `applyRunStats` から）、`jobRules` が `collectRules` に合流し、`startJob`（`createGame` が呼ぶ）が未所持のときだけ初期スキル石・初期武器を渡す。起点画面の説明は `jobDetailLines`（ダッシュの形と気力の源を 1 行ずつ）
5. 解放する依頼の `meta/quests.ts` の `reward` を `{ kind: "job", job: <key> }` にする（`unlockedBy` と一致させる。1 依頼 1 報酬なので、称号などの報酬を差し替える）
6. テスト: `system/jobs.test.ts`（定義・説明の行数）、`system/dashForms.test.ts`（形ごとに 1 本）、`system/manaSources.test.ts`（源ごとに 1 本）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`（ダッシュの形の名前は既存の語と重ねない）。
