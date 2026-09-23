---
name: add-affix
description: 装備のアフィックス・ユニーク・ベース・キーストーンを追加する。実装エージェントを起動する手順とプロンプト雛形。
---

# /add-affix <追加したいものの概要>

1. 種類を決める: アフィックス（prefix / suffix）/ 変換（`cv_`）/ キーストーン（`ks_`、排他 group）/ ユニーク / ベース
2. `docs/DESIGN_PRINCIPLES.md` の「ゴール装備を作らない」に照らす。強い効果には代償、既存の上位互換にしない
3. 新しい stat（`PlayerStats` のフィールド）が要るか判断する。要るなら system 側の読み取り箇所も所有に含める
4. implementer を起動（下の雛形）。報告後に `npm run check`

## implementer への雛形
```
装備に <種類>「<日本語ラベル>」を追加する。コミット禁止。日本語。

## 所有ファイル
- src/loot/affixes.ts（AFFIXES / CONVERSION_AFFIXES / KEYSTONES / IMPLICITS のうち該当）
- src/loot/generator.ts（ユニークの場合: UNIQUES）/ src/loot/bases.ts（ベースの場合）
- src/loot/affixes.test.ts、src/loot/stats.test.ts、src/loot/generator.test.ts
## 最小 Edit のみ許可
- src/loot/types.ts: PlayerStats と DEFAULT_STATS に <フィールド> を追加（新 stat の場合のみ）
- src/system/<読む側>.ts: <フィールド> を読む箇所（新 stat の場合のみ）
- src/system/keystones.ts: KS と KEYSTONE_NAME（キーストーンの場合のみ）
## 先に読む
- CLAUDE.md（レシピ「アフィックス / ユニーク / ベース」）、docs/LOOT_DESIGN.md、docs/GLOSSARY.md、近い既存定義 <例>
## 仕様
- 効果: <…>（値は表示単位。+25% なら 25）
- tier と minLevel: <…>、slots: <…>、tags: <…>
- 代償: <…>
## 完了条件
- テスト（日本語）: computeStats に正しく畳み込まれる / 生成で出る slot と出ない slot / 代償が効く
- npm run check が通る
## 報告形式
CLAUDE.md「並列開発の作法」の完了報告形式
```
