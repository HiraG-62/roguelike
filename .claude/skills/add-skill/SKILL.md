---
name: add-skill
description: スキル石または刻印符を追加する。相性表の更新を含む実装エージェントの起動手順とプロンプト雛形。
---

# /add-skill <スキル or 刻印符の概要>

1. 種類を決める: スキル石（永続、`SKILL_KEYS`）か刻印符（ラン内、`MODIFIER_KEYS`）か
2. `docs/ideas/skills.md` / `docs/ideas/skills-expansion.md` の案に近いものがあれば、その仕様を起点にする
3. 決める: 日本語名 / key / tags / resource（気力型 manaCost か再使用型 cooldown）/ minInterval / exclusiveGroup（本動作を持つ近接・移動系は body）/ 攻撃ジャンルと属性（SKILL_ATTACK）/ 威力の Scaling と poise / 既存の刻印符との相性（付く・付かない）
4. implementer を起動（下の雛形）。見た目が要るなら pixel-artist を並列で
5. 報告後に `npm run check`

## implementer への雛形
```
<スキル石 | 刻印符>「<日本語名>」（key: <key>）を追加する。コミット禁止。日本語。

## 所有ファイル
- src/skills/types.ts（SKILL_KEYS または MODIFIER_KEYS）
- src/skills/data.ts（SKILL_DEFS / MODIFIERS / SKILL 定数 / resolveCast。定義そのものは defs.ts / defs2.ts / modifiers.ts / modifiers2.ts のどれか近い弾に足す）
- src/skills/actions.ts（近接型）/ shots.ts（弾型）/ summons.ts・placed.ts（設置・召喚型）のうち該当（発動処理の実体）
- src/system/skills.ts（castSlot からの呼び出し）
- src/skills/combos.ts（連携を足す場合）
- src/skills/skills.test.ts、src/system/skills.test.ts
## 最小 Edit のみ許可
- src/data/balance/skills.json: 数値（SKILL 経由で読む。union 文字列を含む表だけ src/skills/reshapes.ts）
- src/render/skillHud.ts / src/render/renderer.ts: 表示の追加分のみ
- src/audio/sfxNames.ts / src/audio/sfxLayers.ts: 新しい効果音が要る場合のみ
## 先に読む
- CLAUDE.md（不変条件）、docs/recipes/skill.md、docs/STATS_AND_SCALING.md、docs/ideas/skills.md（6 章・7 章）、近い既存スキル <例>
## 仕様
- 挙動: <…>（手動で撃つ。オートにしない）
- 数値: src/data/balance/skills.json に <…>
- 係数: 威力の Scaling・怯み値の poiseRatio・状態異常の ratio は docs/STATS_AND_SCALING.md に従う（参照ステータス = <…>、理由 = <…>）
- 相性: 付かない刻印符 / スキル = <…>
## 完了条件
- src/skills/skills.test.ts の FORBIDDEN（相性表）を更新し、全組み合わせのテストが通る
- 発動・気力 / 再使用時間・刻印符の効果のテスト（日本語）
- npm run check が通る
## 報告形式
docs/AI_WORKFLOW.md の雛形の報告形式
```
