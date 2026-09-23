---
name: add-skill
description: スキル石または刻印符を追加する。相性表の更新を含む実装エージェントの起動手順とプロンプト雛形。
---

# /add-skill <スキル or 刻印符の概要>

1. 種類を決める: スキル石（永続、`SKILL_KEYS`）か刻印符（ラン内、`MODIFIER_KEYS`）か
2. `docs/ideas/skills.md` の案（2 章・3 章）に近いものがあれば、その仕様を起点にする
3. 決める: 日本語名 / key / tags / damageKind / 基礎 CD / 変異軸への反応 / 既存の刻印符との相性（付く・付かない）
4. implementer を起動（下の雛形）。見た目が要るなら pixel-artist を並列で
5. 報告後に `npm run check`

## implementer への雛形
```
<スキル石 | 刻印符>「<日本語名>」（key: <key>）を追加する。コミット禁止。日本語。

## 所有ファイル
- src/skills/types.ts（SKILL_KEYS または MODIFIER_KEYS）
- src/skills/data.ts（SKILL_DEFS / MODIFIERS / SKILL 定数 / resolveCast）
- src/skills/placed.ts（設置物の場合）
- src/system/skills.ts（castSlot の発動処理）
- src/skills/skills.test.ts、src/system/skills.test.ts
## 最小 Edit のみ許可
- src/render/skillHud.ts / src/render/renderer.ts: 表示の追加分のみ
- src/audio/sfxNames.ts / src/audio/sfx.ts: 新しい効果音が要る場合のみ
## 先に読む
- CLAUDE.md（レシピ「スキル / 刻印符」）、docs/ideas/skills.md（6 章・7 章）、近い既存スキル <例>
## 仕様
- 挙動: <…>（手動で撃つ。オートにしない）
- 数値: SKILL 定数に <…>
- 相性: 付かない刻印符 / スキル = <…>
## 完了条件
- src/skills/skills.test.ts の FORBIDDEN（相性表）を更新し、全組み合わせのテストが通る
- 発動・CD・刻印符の効果のテスト（日本語）
- npm run check が通る
## 報告形式
CLAUDE.md「並列開発の作法」の完了報告形式
```
