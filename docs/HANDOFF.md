# 引き継ぎ（2026-09-24 時点、0.0.15α）

次のセッションが最初に読むファイル。`IDEAS.md` の「現状」と `CHANGELOG.md` が詳細、ここは「いまどこで、何が動いていて、次に何をするか」だけ。

## 1. 現在地

- HEAD: 0.0.15α（`git log --oneline -3`）。`npm run check` 通過（テスト約 4,060 件）。稼働中のサブエージェントは無い。push はしていない
- メインは Opus 5.5。難しい設計は architect（Fable）→ 設計文書 → Sonnet / Opus の implementer の順
- 0.0.13α〜0.0.15α で入ったもの（詳細は CHANGELOG）
  - Electron 版（`npm run electron:dev` / `electron:build`）、セーブは `%APPDATA%\DEPTHBREAKER\save\*.json`、キー設定は `keybinds.json`
  - 武器の作り直し: 射撃は銃の武器種（5 系統）だけ、右クリックは武器ごとの固有技、装備欄は右手 / 左手（今は右手に 1 種類）、軽量武器の振りを約 3 割高速化、刃の向き
  - 武器種 19、コンボ HUD、手触りの強化、プレイヤー・手に持つ武器・斬撃・敵とボス全部の描き直し、CC0 素材の床・壁・小物
  - **バランス数値は全部 `src/data/balance/*.json`**。ユーザー向けの手引きは `docs/BALANCE.md`。新しい数値も必ず JSON に置く

## 2. 次の候補

- ユーザーの実プレイの感想待ち（右クリックの技、振りの速さ、銃の手触り、刃の向き、素材の馴染み）
- 0.0.15α のフル QA（武器の作り直しで射撃の前提が変わったので、スキル由来与ダメ比率やドロップの計測がずれるはず）とレビュー
- 星座「双子」「汀」は左手が空なので成立しない（両手の仕組みまでの扱いを決める）。QA の装備パターンの 1 つを銃に固定する
- `skills/tuning*.ts` は JSON を転送するだけの薄いファイル。参照側を揃えれば削除できる
- 0x72 DungeonTileset II（手動ダウンロード待ち）で溶岩・氷の質感を差し替え
- `%APPDATA%\DEPTHBREAKER` に動作確認のテストデータが残っている（ユーザーに削除可否を確認中）
- Electron のアイコン・package.json の説明文と作者が未設定
- `memo/ideas.md` はユーザーの指示で「まだ気にしない」

## 3. 統合の作法（この期間に固まった運用）

- レーン = Agent。**ファイル所有**で分け、共有ファイル（`core/state.ts` / `core/game.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts` / `system/combat.ts` / `audio/sfxNames.ts` / `audio/sfxLayers.ts`）は最小 Edit のみ・全文 Write 禁止、と各プロンプトに明記する。同じ共有ファイルを複数レーンが Edit するときは「old_string を短く取る」「末尾ではなく既存の目印の直後に足す」と伝えると衝突が減る
- 6 本並列だと load average が 10〜20 になり、`replay.test.ts` / `qa/simulation.test.ts` が負荷でタイムアウトして見かけ上失敗する。各レーンには「他レーン起因の失敗と負荷のタイムアウトは報告だけ」と伝え、統合役が負荷の下がった後に `npm run check`
- **新しい敵・修飾子・部屋を足すと seed 依存のテストが落ちる**（抽選がずれる）。今回は runEvents / roomTypes / specialRooms の 4 件を「敵の生命を十分にする」「交戦フラグを解く」「台座から最も遠い隅へ離れる」の形で堅牢化した。seed を変えるより、テストの意図を守る形で直す
- QA は必ず **隔離 worktree**（`git worktree add <scratchpad>/wt-qa <commit>` → `node_modules` は前回の worktree からコピー → `npm run qa:full`）。本体で回すと他レーンの未コミット変更が混ざる。生成された report.md は統合役が本体へコピーする
- 統合役は `git add -A -- . ':!.gitignore'` でコミット。1 バッチ 1 コミットで CHANGELOG の `[Unreleased]` に要点を書く。docs の更新は別コミット
- コミット: `git -c user.name="Horry" -c user.email="hira6291gi@gmail.com" commit -m "<type>: <日本語>"` + `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。push は `git push -u origin claude/hopeful-ride-nd4l34`。**タグの push はこの環境では 403 で拒否される**（remote に過去のタグも無い）。タグはローカルだけに残し、ブランチだけ push する
- **クラウドセッション**: ユーザーの共通ルールと自動メモリは `.claude/global/`（`CLAUDE.md` が @import）。ローカルで memory を変えたら `npm run sync:claude` で写してコミットする。クラウド側で覚えるべきことが出たらこの HANDOFF に書く（memory は編集しない）
- 事故と対処: node_modules が無ければ `npm install`。エージェントの一時ファイルが `src/` に残ったら `git status --short` で見つけて消す。`src/qa/simulation.test.ts` の差分は目視する

## 4. 次にやる候補（優先順）

1. **0.0.11α QA の未解決項目**（`src/qa/report.md` 末尾の調査メモ参照）
   - ドロップ率 79.8%（0.0.7α 比。目標 60〜70%）。深度 3 以降だけ絞ったが深度 1〜2 の到達率が 97% なので効きが薄い。次は `LOOT_DROP.mobDropMulByDepth` / `roomClearChanceByDepth` を全深度で薄く絞る
   - スキル由来与ダメ比率 49.6%（目標 55〜65%）。**威力を上げても動かない**: QA の計測は「実際に減った生命」だけを数え、序盤の敵にはスキルが既に過剰。動かすなら気力回収を上げて発動回数を増やす（`MANA` / `skills/tuning.ts` の `manaCost`）か、QA 標準ビルドに多段・範囲スキルを増やす。基礎ステータスでの総威力は base +30% でも +14〜16% に留まる点も注意
   - 怯み発生回数が 4,626 → 3,911（−15%）。今回のバッチのどれが交戦頻度を下げたか未切り分け（候補: 泥の減速、強欲のの逃げ、祝福 18 種の 1 ステップ末へのずれ）
   - QA の観測の盲点: 泥・煙・強欲の・二度突きの猪・状態異常 7 種（崩勢・宣告・吸魔・彩痕・硬化・怒気・激昂）の出現を `simulation.test.ts` で数えていない。地形種別・精鋭種別・状態異常の付与経路のカウンタと、それらを持つ装備 / スキルを QA の装備パターンに混ぜる
   - 1 対 1 被弾 8.9 回/60 秒（目標 1〜3）: bot の回避の構造的限界と判断済み。実プレイの体感で判断する
2. **レビューで仕様として残したもの（直すなら）**
   - 祝福のルール文法化で効果が「その場」から「同じステップの末」に動いた（連撃波はステップ末のコンボ数を見る、血の饗宴などの回復・無敵はステップ末なので同じステップの致死には間に合わない）。実害は小さいが `docs/ARCHITECTURE.md` に明記する
   - 1 ステップのイベント上限 `SYNERGY.maxEventsPerStep` = 256（実測の最大は 37）。溢れると direct 効果が黙って落ちるので、QA で上限到達を数える保険
   - 煙はスキルの弾（`state.skills.shots`。砲身化の砲撃を含む）を消さない。仕様か要判断
   - 業火の化身の燃焼付与は `updateShape` でだけ差し直す。同じステップで `applyStats` が走ると残りだけ付かない（無視できる）
   - 継続ダメージの浮き文字は `opts.silent` で判定している（継続以外の silent な一撃も同じ見た目）
   - 強欲のの詰み: 封鎖する部屋の強欲のは自室の中の遺物・石しか拾わないが、抱えた後にプレイヤーが部屋の外から近づくと逃げる向きに部屋の制限が無く、部屋の外へ出た後に封鎖されると制圧できない（`roomAlive` は `roomIndex` だけで判定）。頻度は低い。直すなら「封鎖時に部屋の外にいる自室の敵を中へ寄せる」（雑魚が追跡で外へ出る既存リスクも同時に潰せる）
3. **統一ルール文法への移行の続き**: 第 1 弾の残り約 100 種は「常時の倍率・可否」「祝福内部の状態を持つ」「起点がイベントに無い（コンボ加算・砕き・通常の振りの命中）」「文法に無い効果（3 択の提示・刻印符の落下・部屋の敵すべて）」に分類済み（`5559d2d` のレーン B 報告。`src/system/boonRules.test.ts` の自動テストが移行済みの一覧）。起点と効果を足せば移せるものから続ける。スキル・敵にも `rules` を置ける
4. **ブレストの未実装分**: `docs/ideas/README.md` のチェックリスト。残りは主に 盗賊王（逃げるボス。B3）、盗賊の追跡イベント、泥沼スキル（`mire`。泥の地形が入ったので作れる）、地裂きの崩れる床、拠点（ハブ）、来歴の「帰還」の節目、変身の連携「変身中の極意」を新 5 種にも
5. **拠点（ハブ）**: `docs/ideas/meta-and-weapons.md` 3 章。未着手
6. **ドット絵**: `docs/ASSETS.md` の推奨 5 件から選んで PNG アトラス読み込みを足す（ユーザーの判断待ち。CC-BY は `CREDITS.md` に帰属表示）

## 5. 起きたユーザーに聞くこと

- 実プレイの手触り: 開放型マップの敵密度・徘徊、コンボ派生、気力の渋さ、G / R3 で拾う操作、BGM の音量と曲、変身 5 種の操作感（砲身化の構えと業火の化身のトグル）
- 用語（気力 / 生命 / 見切り / 精鋭 / 探索 / 再使用時間 / 連携 / 手がかり）が直感的か
- 継続ダメージの浮き文字（0.5 秒ぶんを束ねて小さく表示）が多く感じないか（`FX_WAVE3.damageText.dot.interval`）
- ドット絵素材の導入可否（CC0 の Kenney Tiny Dungeon / 0x72 DungeonTileset II など）
- 見送った設計判断: 装備を賭ける（永続装備を失わせない方針で欠片・生命に変更）、倉庫の遺物の呼び出し（リプレイが倉庫を記録しないため封印庫に変更）、強欲のが拾った物は次の階の足元へ届く（前の階の床に落とすと失われるため）

## 6. 参照

- 設計: `docs/COMBAT_DESIGN.md`（A-8 ジャンル・属性、A-9 ジョブ、B 気力、C 回復）、`docs/LOOT_DESIGN.md`、`docs/DESIGN_PRINCIPLES.md`、`docs/GLOSSARY.md`（冒頭に世界観語の対応表）
- ブレスト: `docs/ideas/README.md`（Wave 方針とチェックリスト）
- QA: `src/qa/report.md`（最新のフル QA）
- 作法: `docs/AI_WORKFLOW.md`、`.claude/agents/*`、`.claude/skills/*`
