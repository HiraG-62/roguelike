---
name: agent-docs
description: エージェント資料（CLAUDE.md・.claude/agents・.claude/skills・docs/AI_WORKFLOW.md）をコードの現状に追随させる。機械検査（npm run audit:docs）で拾えるずれを直し、差分から「何を変えたらどこを直すか」の表で判断の要る追随を行う。
---

# /agent-docs [範囲]

エージェント資料 = `CLAUDE.md`・`.claude/agents/*.md`・`.claude/skills/*/SKILL.md`・`docs/AI_WORKFLOW.md`。コードを変えた同じ作業の中で追随させる。

## 手順

1. `npm run audit:docs` を実行し、出た指摘を全部直す（実在しない参照・地図に無いファイル・件数のずれ・未登録の skill / agent・旧用語）。検査を緩めて通さない（例外を足すなら `scripts/audit-agent-docs.mjs` の定数に理由付きで）
2. 範囲を決める: 引数が無ければ前回の資料コミット（`git log --oneline -3 -- CLAUDE.md .claude docs/AI_WORKFLOW.md` の先頭）以降の `git log --oneline` と `git diff --stat`。未コミット変更があれば `git status --short` も
3. 差分を下の表に当て、該当する資料を直す。差分の中身は `git show --stat <hash>` と、必要な箇所だけ `git show <hash> -- <file>` で読む
4. もう一度 `npm run audit:docs`。資料だけの変更なら `npm run check` は不要
5. 報告は「直した資料と要点」の箇条書きのみ

## 何を変えたらどこを直すか

| 変更 | 直す場所 |
| --- | --- |
| src にファイルを新規 / 削除 / 改名 | CLAUDE.md「アーキテクチャの地図」の該当層の行（1 行）。層が増えたら木と `docs/ARCHITECTURE.md` の責務表。skill の雛形の「所有ファイル」に載っていれば併せて |
| `XXX_KEYS` / `ENEMIES` / `SPRITES` などの表の要素数 | CLAUDE.md の「（`XXX`、N 種）」。件数は audit が照合する。`IDEAS.md` の「現状」は `/handoff-docs` |
| 型・定数・関数の廃止・改名（例: 0.0.15α で射撃の型を廃止したとき） | CLAUDE.md のレシピと地図、skill の雛形、agent の作法。audit が「識別子がコードに無い」で拾う |
| `step` の呼び出し順（`core/game.ts`） | CLAUDE.md「system」見出しの順序の一文 |
| 数値の置き場所・不変条件（JSON のブロック・フォント・保存先・決定性） | CLAUDE.md「不変条件」、agent の作法（implementer / reviewer / localizer / balance-tuner）、AI_WORKFLOW の「よくある事故と対策」 |
| 用語の変更（`docs/GLOSSARY.md` の対応表） | 資料全体の表記。旧語は「旧〜」の形でだけ残す。audit の `STALE_TERMS` に旧語を足す |
| npm scripts / `scripts/*.mjs` の追加・変更 | CLAUDE.md「コマンド」表、関係する skill（`/check` `/qa` `/bump`）、`scripts/check.mjs` |
| 永続化キー・保存先の形式 | CLAUDE.md 不変条件 8、`docs/ARCHITECTURE.md`「永続化キー」 |
| skill / agent の追加・改名・model の変更 | CLAUDE.md「並列開発の作法」の一覧、AI_WORKFLOW の「モデルの使い分け」と「対応」表 |
| `docs/*.md` の追加・改名 | CLAUDE.md「ドキュメント索引」 |
| レシピの手順が変わる仕組みの変更（敵・武器・性質・スキル・祝福・部屋・効果音・スプライトの足し方） | CLAUDE.md「要素の足し方」の該当レシピと、対応する `/add-*` skill の雛形 |
| 共有ファイルの増減（複数レーンが触るもの） | CLAUDE.md「並列開発の作法」、AI_WORKFLOW「ファイル所有の決め方」、`/parallel` |

## 書き方

- 地図の 1 行は「ファイル名 + 何をするか + 主な公開関数 / 定数」。設計の理由はここに書かず `docs/ideas/*.md` へのリンクで済ませる
- レシピは「足すときに触るファイルと順番」だけ。数値は JSON、表示文字列は GLOSSARY、というリンクで済むものは繰り返さない
- 古い記述は消す（「旧〜」の対応表は GLOSSARY が正）。CLAUDE.md を長くしない
