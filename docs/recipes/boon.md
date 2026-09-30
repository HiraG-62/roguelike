# レシピ: 祝福

1. 系譜ファイル `src/system/boonDefs/<系譜>.ts`（9 系譜・`fusion.ts`・`cursed.ts`）の `BOON_KEYS_<系譜>` と `BOONS_<系譜>` に札を足す。`lineage`・札 `card`（加護 grace / 摂理 law / 研鑽 temper / 真髄 apex）・加護なら行動 `action`（左 primary / 右 secondary / dash / skill / ultimate）・`changes`（何が変わるか）・`keywords`・`tags` は必須。融合は `fusion: [a, b]`（`lineage` なし・`card: "law"`）、呪い付きは `cursed: true`、芯は `core: true` / `graded: false`（`cursed.ts`）。1 系譜は加護 5（行動が全部違う）・摂理 3・研鑽 2・真髄 1 の 11 枚で、増やすときは入れ替える（`docs/ideas/boon-impl.md` 2-12）。名前は二字か四字の熟語で、奥義・状態異常・スキル・改鋳と重ねない（`system/boonDefs.test.ts` が検査）
2. 効果: ルールは `rules`（統一ルール文法。加護の起点はその行動のイベント）、常時の増・倍は `modifiers`、常時の stats は `addStats`（`foldAddStats` が畳む）、研鑽は `tally` 効果 + `per: { kind: "tally" }` か `temperStat`、スキルの加護で全スロットに刻印符を足すなら `grantsModifier`。数値は `balance/boons/LINEAGE/<系譜>.json`（`_fields` をファイルに 1 回、読むのは `BOON_LINEAGE`）。**旧フック（`onBoonXxx`）は足さない**。Rule で書けないものだけ `boonRules.ts` に置く
3. 原則: **数値盛りではなくルール変更**。装備タグと掛け算になる形にする
   - 格（並 / 大祝福 / 神威 / 至高 / 極致）: Rule 型は `rules.ts` が効果量・半径（神威以上は ICD）に自動で掛ける。効果量 0 で半径だけ持つ Rule は `graded: true`。払う額に格が掛かると壊れる札は `graded: false`。呪い付きは格を持たず、無敵時間は格で伸びない
   - 芯: 1 ランに 1 つ、深度 `BOON.coreDepth` の最初の提示だけに出る。遊び方を変える効果と代償を必ず持つ。数値は `boonCores.ts` の `foldCoreStats`
4. テスト: `system/boonDefs.test.ts`（構成・名前）/ `system/boonDefs/<系譜>.test.ts`（札ごとの効果が発火する）/ `system/boons.test.ts`（抽選・枠・真髄・融合・錬磨）

## 段取り 7b の効果の種類（`core/rules.ts`。書き方の例は `system/rulesLineage.test.ts` / `boonTallies.test.ts`）

| 効果 / 数え | 書き方 | 中身 |
| --- | --- | --- |
| 研鑽の数え | `{ kind: "tally", magnitude: 1, key: "ash" }`（最高記録は `mode: "max"` + `scaleBy`）、読む側は `per: { count: { kind: "tally", key }, every }` か `temperStat` | `boonRun.tallies`。格を掛けず、連鎖・語の上限に数えない |
| スキル戻し | `{ kind: "refreshSkills", magnitude: 0.2 }`（`fill: true` で全部） | 全スロットの再使用時間を割合で戻す |
| 反響 | `{ kind: "echoLast", magnitude: 1 }` | 直前のスキルを気力なしでもう一度 |
| 号令 | `{ kind: "retarget", duration: 3 }` | 従魔・召喚の狙いを対象へ（`focusTarget`） |
| 起爆 | `{ kind: "detonatePlaced", scaleBy: "slashBase", radius, count }` | 最も近い設置物を爆ぜさせる |
| 従魔 | `{ kind: "tameEnemy", duration, radius?, onlyWith?, count, cost? }` | 敵を一時的に味方に（`Enemy.allyUntil`。ボス級・階の主・商人・壺は不可）。`cost` は 1 体ごとに払う銭（払えなければ従えない） |
| 投銭 | `{ kind: "coinShot", magnitude, count }` か `share` | 銭を払って弾を撃つ。払えなければ不発 |
| 溜めの解放 | `{ kind: "releaseVault", vault: "ice" }` | `Enemy.vault` を一度に出す |
| 基準・数え | `scaleBy: "coins" / "counter"`、`PerCounter` の `minions` / `coinsLog` / `lineageCards` / `lineagesOwned`、条件 `targetWithin` / `counter` | 持ち金・従魔と設置物の数・系譜の枚数・持っている系譜の数 |

## 常時の増・倍・条件付き・「〜につき」は `modifiers`

イベントを待たない与ダメ・怯み値の補正は、`BOONS` の定義に `modifiers`（`core/rules.ts` の `Modifier`）を置く。フックや `foldBoonStats` の `*Mul *=` は書かない。

- `kind: "increased"`（増。0.1 = +10%、装備の増と足してから 1 回掛かる）/ `"more"`（倍。1.2 = ×1.2、出所ごとに掛け算）
- `tag`: 与ダメのタグ（`core/damage.ts` の `DAMAGE_TAGS`）か `"all"`。怯み値は `"poise"`（与ダメには効かない）
- `if`: `RuleCondition` をそのまま使う（対象の条件は今殴っている敵で見る。対象のいない 1 撃では効かない）
- `per`: 「〜につき」（`PerCounter`。`every` 単位で 1 つ、`cap` は効きの上限）。例: コンボ 10 につき増 +2%（上限 100%）= `{ kind: "increased", tag: "all", amount: 0.02, per: { count: { kind: "combo" }, every: 10, cap: 1 } }`
- 集める順は `system/modifiers.ts` の `collectModifiers`（装備 → 誓約 → ジョブ → 武器種 → 持続の奥義 → 祝福の取得順 → スキルスロット順）。テストは `system/modifiers.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
- 銭の祝福の見本: 「守銭」`miser`（持つ型: 持ち金 20 につき増。`modifiers` の `per: { kind: "coins" }`）/ 「拾銭」`coinGleaner`（稼ぐ型: `onCoinPickup` の Rule）。`system/boonDefs/wealth.ts`
