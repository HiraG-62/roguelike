---
name: handoff-docs
description: このプロジェクトの引き継ぎ文書（docs/HANDOFF.md、docs/BACKLOG.md、IDEAS.md の「現状」、docs/ideas/README.md のチェックリスト）を最新の実装に合わせて更新する。
---

# /handoff-docs

1. 前回の更新以降の変更を把握する
   - `git log --oneline -- docs/HANDOFF.md IDEAS.md` で前回更新コミットを探し、`git log --oneline <そのコミット>..HEAD`
   - 未コミット変更は `git status --short`
2. `docs/HANDOFF.md` を更新する（次のセッションが最初に読む。詳細は書かず「いまどこで、何が動いていて、次に何をするか」だけ）
   - **節を積み増さない**。見出しの日付と版を直し、「現在地」は前の内容を消して **上書き** する（経緯は `CHANGELOG.md` にある）。「進行中のレーン」の表も今の状態だけ
   - 「次の候補」は上位の数件だけ。済んだものを消し、新しく分かった積み残しは `docs/BACKLOG.md` の一番上の節へ足す（BACKLOG の済んだ行も消す）
   - 「ユーザーに聞くこと」は未回答だけ。回答をもらった行は消し、決定は該当の設計文書か「変わらない方針」へ
   - 固まった運用は `docs/AI_WORKFLOW.md` へ移す。全体で 100 行以内（`pnpm run audit:docs` が検査）
   - クラウドセッションで新しく覚えるべきことは memory ではなくここの「ユーザーに聞くこと / 引き継ぎ」に書く
3. `IDEAS.md` の「現状（日付 時点）」節を更新する
   - 日付を今日に
   - 数（敵・性質・名のある遺物・スキル・刻印符・祝福・効果音）はコードで数え直す。例:
     - 祝福: `BOON_KEYS` の要素数（`src/system/boonDefs.ts`）
     - 精鋭: `ELITE_KINDS`（`src/system/elites.ts`）、ボス: `BOSS_ROTATION`（`src/system/boss.ts`）
     - スキル / 刻印符: `SKILL_KEYS` / `MODIFIER_KEYS`（`src/skills/types.ts`）
     - 効果音: `SFX_NAMES`（`src/audio/sfxNames.ts`）
     - 敵: `ENEMIES`（`src/data/enemies.ts`）
   - 新しい要素は既存の小見出し（戦闘 / フロア・部屋 / 装備 / スキル / 祝福 / メタ）に 1〜2 行で足す
   - 「次にやる候補」から実装済みのものを消す
4. `docs/ideas/README.md` のチェックリストを更新する（[ ] → [~] → [x]）。新しいブレストファイルがあれば一覧表に追加
5. 表示用語が増えたら `docs/GLOSSARY.md` に追記。エージェント資料（CLAUDE.md・`docs/CODE_MAP.md`・`docs/recipes/`・`.claude/`・AI_WORKFLOW）の追随は `/agent-docs`
6. 変更は `docs: 引き継ぎ文書を更新（<要点>）` でコミットする（ユーザーの指示がある場合）

## 報告
更新したファイルと、追加・変更した行の要点だけ箇条書き。
