---
name: release-notes
description: git log から指定範囲の変更点を、プレイヤー向けの日本語のまとめにする。
---

# /release-notes [範囲]

1. 範囲: 引数が無ければ直近のタグ（`git describe --tags --abbrev=0`）から HEAD。タグが無ければ今日のコミット（`git log --since=midnight`）
2. `git log --oneline --no-merges <範囲>` を読み、必要なら `git show --stat <hash>` で中身を確認する
3. 分類する
   - **新要素**（feat）: プレイヤーから見える追加
   - **改善**（feat のうち既存の強化、style、演出）
   - **修正**（fix）: プレイヤーが遭遇し得たものだけ
   - **バランス**（tuning.ts の変更を含む fix / feat）
   - 開発向け（test / docs / chore / refactor）は最後に 1 行でまとめるか省く
4. 書き方
   - 1 項目 1 行、プレイヤー視点の日本語（関数名・ファイル名を書かない）
   - 用語は `docs/GLOSSARY.md` に合わせる
   - 数があるものは数を書く（例: 祝福 30 種）

## 出力例
```
## 2026-09-23

### 新要素
- 祝福 3 択（30 種、うち呪い付き 9 種）
### 改善
- 文字を高解像度で描画
### 修正
- パッドの A ボタンで誤ってリスタートする問題
```
