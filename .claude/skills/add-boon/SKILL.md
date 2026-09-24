---
name: add-boon
description: ラン内の祝福（3 択）を追加する。ルール変更型の祝福を実装エージェントに作らせる手順とプロンプト雛形。
---

# /add-boon <祝福の概要>

1. 原則に照らす: **数値盛りではなくルール変更**。装備タグ（burn / chill / shock / dash / just / combo …）と掛け算になる形か
2. 決める: 日本語名 / key / desc（1〜2 文、GLOSSARY の表記）/ icon（1 文字）/ rarity / tags / cursed（代償付きか）/ requires（装備タグが無いと出ない）
3. 効果の入れ場所を決める: 「〜時: 〜」で書けるなら統一ルール文法（`BoonDef.rules`。`core/rules.ts`）を最優先。数値なら `foldBoonStats`、フックが要るなら `boons.ts` の既存フック（`onBoonMeleeHit` / `onBoonKill` / `onBoonDash` / `onBoonRoomClear` …）から `boonRules.ts` の `onBoonXxxRules` へ。同じ主の多段なら `lineage` / `after`、2 祝福の合体なら `duo`
4. implementer を起動（下の雛形）。報告後に `npm run check`

## implementer への雛形
```
祝福「<日本語名>」（key: <key>）を追加する。コミット禁止。日本語。

## 所有ファイル
- src/system/boonDefs.ts（BOON_KEYS / BOONS。第 2 弾は boonDefsWave2.ts）
- src/system/boonRules.ts（フックが要る場合の実装）
- src/system/boons.test.ts、src/system/boonRules.test.ts
## 最小 Edit のみ許可
- src/data/balance/boons.json: BOON に <key> 用の数値を追加（tuning.ts の BOON 経由で読む）
- src/system/<呼び出し側>.ts: hasBoon 分岐かフック呼び出しの追加（既存フックで足りない場合のみ）
## 先に読む
- CLAUDE.md（レシピ「祝福」）、docs/ideas/run-structure.md 5 章、docs/ideas/boons-expansion.md、src/system/boonDefs.ts の既存祝福 <近い例>
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
