---
name: handoff-docs
description: このプロジェクトの引き継ぎ文書（IDEAS.md の「現状」と docs/ideas/README.md のチェックリスト）を最新の実装に合わせて更新する。
---

# /handoff-docs

1. 前回の更新以降の変更を把握する
   - `git log --oneline -- IDEAS.md` で前回更新コミットを探し、`git log --oneline <そのコミット>..HEAD`
   - 未コミット変更は `git status --short`
2. `IDEAS.md` の「現状（日付 時点）」節を更新する
   - 日付を今日に
   - 数（敵・アフィックス・ユニーク・スキル・刻印符・祝福・効果音）はコードで数え直す。例:
     - 祝福: `BOON_KEYS` の要素数（`src/system/boons.ts`）
     - スキル / 刻印符: `SKILL_KEYS` / `MODIFIER_KEYS`（`src/skills/types.ts`）
     - 効果音: `SFX_NAMES`（`src/audio/sfxNames.ts`）
     - 敵: `ENEMIES`（`src/data/enemies.ts`）
   - 新しい要素は既存の小見出し（戦闘 / フロア・部屋 / 装備 / スキル / 祝福 / メタ）に 1〜2 行で足す
   - 「次にやる候補」から実装済みのものを消す
3. `docs/ideas/README.md` のチェックリストを更新する（[ ] → [~] → [x]）。新しいブレストファイルがあれば一覧表に追加
4. 表示用語が増えたら `docs/GLOSSARY.md` に追記。コマンドや不変条件が変わったら `CLAUDE.md` を直す
5. 変更は `docs: 引き継ぎ文書を更新（<要点>）` でコミットする（ユーザーの指示がある場合）

## 報告
更新したファイルと、追加・変更した行の要点だけ箇条書き。
