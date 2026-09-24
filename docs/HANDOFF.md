# 引き継ぎ（2026-09-24 時点、0.0.10α）

次のセッションが最初に読むファイル。`IDEAS.md` の「現状」と `CHANGELOG.md` が詳細、ここは「いまどこで、何が動いていて、次に何をするか」だけ。

## 1. 現在地

- HEAD: 0.0.10α（`node scripts/bump.mjs patch` の直後。`git log --oneline -3` で確認）。`npm run check` 通過（テスト 2,920 件）
- **ユーザーの指示で一旦停止中**（利用上限が近いため）。稼働中のサブエージェントは無い。作業ツリーは `.gitignore`（`memo/` の追加。ユーザーの変更なので触らない・コミットしない）だけが未コミット
- ユーザーは就寝中だった。方針は「コンテンツ量はいくらあってもいい。明らかに不要なもの以外は全部入れる」「すべての要素でシナジー」「確認なしで進める。まとまったら `npm run check` → コミット → `node scripts/bump.mjs patch`」。**再開するときは、まずユーザーに「続けてよいか」を確認する**（停止を指示されたため）
- ユーザーのアイデアは `memo/YYYYMMDD-N.md`（gitignore 済み）。`memo/20260924-1.md` の項目は **ドット絵の精細化以外すべて実装済み**（`docs/ASSETS.md` に CC0 素材候補を調査済み。導入はユーザーの判断待ち）

## 2. 進行中のレーン

無し（0.0.9α の QA / レビュー / docs はすべて取り込み済み）。

再開するときの作法: レーンは implementer / reviewer / qa-runner / localizer / brainstormer の Agent を名前付きで起動し、完了報告を統合役が取り込む。利用上限で止まった場合、`SendMessage` で名前宛てに「利用上限で中断していたが回復した。作業ツリーの途中の変更は残っている。元の指示どおり完了まで進めて報告」と送ると再開する（文脈を保持している）。作業ツリーの部分編集は `npx tsc --noEmit` で状態を確認してから。

## 3. 統合の作法（この期間に固まった運用）

- レーン = implementer / reviewer / qa-runner / localizer / brainstormer の Agent。**ファイル所有**で分け、共有ファイル（`core/state.ts` / `core/game.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts` / `system/combat.ts`）は最小 Edit のみ・全文 Write 禁止、と各プロンプトに明記する
- 複数レーンを並列で回すと tsc が一時的に壊れる。各レーンには「他レーン起因の失敗は報告だけ」と伝え、統合役が最後に `npm run check`
- QA は必ず **隔離 worktree**（`git worktree add <scratchpad>/wt-qa <commit>` → `npm install` → `npm run qa:full`）。本体で回すと他レーンの未コミット変更が混ざる
- 統合役は `git add -A -- . ':!.gitignore'` でコミット（`.gitignore` はユーザーの変更）。1 バッチ 1 コミットで CHANGELOG に要点を書く
- コミット: `git -c user.name="Horry" -c user.email="hira6291gi@gmail.com" commit -m "<type>: <日本語>" ` + `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- 事故と対処: node_modules が壊れたら `npm install`。エージェントの一時ファイルが `src/` に残ったら `git clean -fdq <path>`。`rm` は権限で拒否される。QA のデバッグ用打ち切りがコミットに混入したことがあるので、`src/qa/simulation.test.ts` の差分は目視する

## 4. 次にやる候補（優先順）

1. **0.0.9α QA の未解決項目**（`src/qa/report.md` 末尾の調査メモ参照）: ドロップ率は再引き上げ済みで未検証（次の QA で 0.0.7α 比 60〜70% か確認）/ スキル由来与ダメ比率 49%（目標 55〜65%。`skills/data.ts` の QA 標準 4 スキルの `Scaling.base` か気力回収を上げる案）/ 1 対 1 被弾 9.5 回/60 秒（bot の回避が構造的に弱い。浮遊眼と爆弾が主因）/ 深度 2 の死亡集中（スライム王 20 件・猪 18 件）/ dual 共鳴ビルドの撃破数が −30%（新イベント・部屋との相性を疑う）/ 状態異常 7 種（崩勢・宣告・吸魔・彩痕・硬化・怒気・激昂）が QA で 0 回（付与するスキル・装備を bot の標準ビルドが持っていないため。実プレイでは出る）
1b. **レビューで判断に委ねられたもの**: 陰画の判定順で既存装備の共鳴が変わる例をテストで固定する / 変身石 3 つでほぼ常時変身できる（化身 × 極意 × 武器写しで約 2.2 倍。バランス確認）/ `audio/music.ts` の残響ノードが曲の切り替え後も残る可能性（`disconnect` の追加）/ 描画 1 フレーム 4 ms はブラウザで未計測
1c. **元の 1**: ドロップ率（0.0.7α 比 60〜70% が目標。0.0.8α で 31〜46% に絞りすぎ → `LOOT_DROP` を引き上げ済み、未検証）、スライム王の遭遇あたり致死率（0.0.8α で 19%、他ボス 27% 以下に）、スキル由来与ダメ比率（44%、目標 55〜65%。`skills/data.ts` の QA 標準 4 スキルの `Scaling.base` か気力回収を上げる案）
2. **統一ルール文法への移行**: 既存の祝福 122 種のフック直書きを `BoonDef.rules` へ移す（`boonRules.ts` の `BOON_RULE_EXAMPLES` に見本 3 つ。二重発火に注意）。スキル・敵にも `rules` を置ける
3. **可視化の残り**: `docs/ideas/synergy-web.md` 4-c（祝福カードの 3 種の印）、4-e（連携名の表示）、5 章（相乗の発見を報酬にする図鑑連携は一部実装済み）
4. **ブレストの未実装分**: 各 `docs/ideas/*.md` 冒頭の「実装状況」節と `docs/ideas/README.md` のチェックリスト。残りは主に「所有外のフックが要る」もの（演出 5 / 音 7、敵の煙幕・泥、変身 5 種、逃げるボス、来歴の「帰還」の節目 など）
5. **拠点（ハブ）**: `docs/ideas/meta-and-weapons.md` 3 章。未着手
6. **既知の制限**: ジョブの初期スキル石を既に持っているとき、倉庫が上限 60 付近だとリプレイの拾得の成否がずれる（`main.ts` のスナップショットを `createGame` の後に取るか、`ReplayData` に「初期石を持っていたか」を記録）
7. **ドット絵**: `docs/ASSETS.md` の推奨 5 件から選んで PNG アトラス読み込みを足す（ユーザーの判断待ち。CC-BY は `CREDITS.md` に帰属表示）

## 5. 起きたユーザーに聞くこと

- 実プレイの手触り: 開放型マップの敵密度・徘徊、コンボ派生（左左右 / 右左）、気力の渋さ（満タンから 3〜4 発）、G / R3 で拾う操作、BGM の音量と曲
- 用語（気力 / 生命 / 見切り / 精鋭 / 探索 / 再使用時間）が直感的か
- ドット絵素材の導入可否（CC0 の Kenney Tiny Dungeon / 0x72 DungeonTileset II など）
- 見送った設計判断: 装備を賭ける（永続装備を失わせない方針で欠片・生命に変更）、倉庫の遺物の呼び出し（リプレイが倉庫を記録しないため封印庫に変更）

## 6. 参照

- 設計: `docs/COMBAT_DESIGN.md`（A-8 ジャンル・属性、A-9 ジョブ、B 気力、C 回復）、`docs/LOOT_DESIGN.md`、`docs/DESIGN_PRINCIPLES.md`、`docs/GLOSSARY.md`（冒頭に世界観語の対応表）
- ブレスト: `docs/ideas/README.md`（Wave 方針とチェックリスト）
- QA: `src/qa/report.md`（最新のフル QA）
- 作法: `docs/AI_WORKFLOW.md`、`.claude/agents/*`、`.claude/skills/*`
