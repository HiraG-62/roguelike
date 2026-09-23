---
name: bump
description: バージョンを上げる（/bump patch|minor|major）。判断基準に沿ってレベルを決め、CHANGELOG を整えて scripts/bump.mjs でコミットとタグを作る。
---

# /bump [patch|minor|major] [--note "..."]

## 判断基準

| レベル | 対象 | 例 |
| --- | --- | --- |
| major | 大規模アップデート。**ユーザーの明示的な指示があるときだけ** | ゲームの骨格の作り直し、セーブ互換の破棄 |
| minor | 機能追加・それなりに大きな変更 | 新システム（祝福・リプレイ）、敵やスキルのまとまった追加、装備システムの再設計 |
| patch | 小規模な追加・変更・バグ修正・整備作業 | 敵 1 体、数値調整、表記統一、ドキュメント、開発環境 |

- α 期間（`src/version.ts` の `RELEASE_PHASE` が `"alpha"`）は **0.0.xx で進める**。minor 相当でもパッチ番号を上げる（スクリプトが自動でそうする）
- α を抜けるのはユーザーの指示があるときだけ（`--end-alpha`、minor で 0.1.0）
- 引数が無ければ、前回タグ以降の `git log` から上の表でレベルを提案し、そのまま進める（major は提案しない）

## 手順

1. `git status --short` を確認する。未コミットの変更が残っているなら、先にそれをコミットするかユーザーに確認する（bump のコミットには 4 ファイルしか入らない）
2. `npm run check` が通ることを確認する。失敗していたら上げない
3. 前回タグ（`git describe --tags --abbrev=0`）以降の `git log --oneline` を読み、`CHANGELOG.md` の `## [Unreleased]` に「追加 / 変更 / 修正」の見出しでプレイヤー視点の箇条書きを書く（`/release-notes` の書き方）
4. まず `node scripts/bump.mjs <level> --dry-run` で次の版を確認する
5. `node scripts/bump.mjs <level>`（短い追記だけなら `--note "..."`）を実行する
   - package.json / package-lock.json / src/version.ts / CHANGELOG.md を更新する
   - `chore: v0.0.2α` の形でその 4 ファイルだけをコミットし、`v0.0.2` タグを作る
   - push はしない
6. 報告: 旧版 → 新版、タグ名、CHANGELOG に載せた項目

## 禁止
- major を自分の判断で上げない（`--force-major` はユーザーの指示があるときだけ）
- `src/version.ts` や package.json の version を手で書き換えない（`src/version.test.ts` が不一致を検出する）
