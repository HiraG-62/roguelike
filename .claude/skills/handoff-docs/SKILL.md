---
name: handoff-docs
description: このプロジェクトの引き継ぎ文書（docs/HANDOFF.md、IDEAS.md の「現状」、docs/ideas/README.md のチェックリスト）を最新の実装に合わせて更新する。
---

# /handoff-docs

1. 前回の更新以降の変更を把握する
   - `git log --oneline -- docs/HANDOFF.md IDEAS.md` で前回更新コミットを探し、`git log --oneline <そのコミット>..HEAD`
   - 未コミット変更は `git status --short`
2. `docs/HANDOFF.md` を更新する（次のセッションが最初に読む。詳細は書かず「いまどこで、何が動いていて、次に何をするか」だけ）
   - 見出しの日付と版、「現在地」の HEAD・check の状態・稼働中のレーン
   - 「次の候補」から済んだものを消し、新しく分かった積み残しを足す
   - クラウドセッションで新しく覚えるべきことは memory ではなくここの「ユーザーに聞くこと / 引き継ぎ」に書く
3. `IDEAS.md` の「現状（日付 時点）」節を更新する
   - 日付を今日に
   - 数（敵・アフィックス・ユニーク・スキル・刻印符・祝福・効果音）はコードで数え直す。例:
     - 祝福: `BOON_KEYS` の要素数（`src/system/boonDefs.ts`）
     - 精鋭: `ELITE_KINDS`（`src/system/elites.ts`）、ボス: `BOSS_ROTATION`（`src/system/boss.ts`）
     - スキル / 刻印符: `SKILL_KEYS` / `MODIFIER_KEYS`（`src/skills/types.ts`）
     - 効果音: `SFX_NAMES`（`src/audio/sfxNames.ts`）
     - 敵: `ENEMIES`（`src/data/enemies.ts`）
   - 新しい要素は既存の小見出し（戦闘 / フロア・部屋 / 装備 / スキル / 祝福 / メタ）に 1〜2 行で足す
   - 「次にやる候補」から実装済みのものを消す
4. `docs/ideas/README.md` のチェックリストを更新する（[ ] → [~] → [x]）。新しいブレストファイルがあれば一覧表に追加
5. 表示用語が増えたら `docs/GLOSSARY.md` に追記。コマンドや不変条件が変わったら `CLAUDE.md` を直す。新しいモジュールを足したら `CLAUDE.md` の「アーキテクチャの地図」に 1 行、廃止したものは消す
6. 変更は `docs: 引き継ぎ文書を更新（<要点>）` でコミットする（ユーザーの指示がある場合）

## 報告
更新したファイルと、追加・変更した行の要点だけ箇条書き。
