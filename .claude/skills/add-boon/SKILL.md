---
name: add-boon
description: ラン内の祝福（3 択）を追加する。ルール変更型の祝福を実装エージェントに作らせる手順とプロンプト雛形。
---

# /add-boon <祝福の概要>

1. 原則に照らす: **数値盛りではなくルール変更**。装備タグ（burn / chill / shock / dash / just / combo …）と掛け算になる形か
2. 決める: 日本語名 / key / desc（1〜2 文、GLOSSARY の表記）/ icon（1 文字）/ rarity / tags / cursed（代償付きか）/ requires（装備タグが無いと出ない）
3. 効果の入れ場所を決める: 数値なら `foldBoonStats`、ルールなら既存フック（`onBoonMeleeHit` / `onBoonKill` / `onBoonDash` / `onBoonRoomClear` …）か、呼び出し側 system の `hasBoon` 分岐
4. implementer を起動（下の雛形）。報告後に `npm run check`

## implementer への雛形
```
祝福「<日本語名>」（key: <key>）を追加する。コミット禁止。日本語。

## 所有ファイル
- src/system/boons.ts（BOON_KEYS / BOONS / 効果のフック）
- src/system/boons.test.ts
## 最小 Edit のみ許可
- src/data/tuning.ts: BOON に <key> 用の定数を追加
- src/system/<呼び出し側>.ts: hasBoon 分岐かフック呼び出しの追加（既存フックで足りない場合のみ）
## 先に読む
- CLAUDE.md（レシピ「祝福」）、docs/ideas/run-structure.md 5 章、src/system/boons.ts の既存祝福 <近い例>
## 仕様
- 効果: <…>
- 代償（cursed の場合）: <…>
- 装備タグとの関係: <…>
## 完了条件
- テスト（日本語）: 取得前は効かない / 取得後に効く / 代償が効く / requires のタグが無いと候補に出ない
- src/qa/bot.ts の祝福選択が引き続き動く
- npm run check が通る
## 報告形式
CLAUDE.md「並列開発の作法」の完了報告形式
```
