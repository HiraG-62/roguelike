# 深みの実装設計（段取り 10）

作成日: 2026-09-30。`docs/ideas/core-synthesis.md` 9 章の段取り 10 を architect が確定リストまで設計したもの。★（ユーザー確認）の結果は下の「決めたこと」に書く。

## 決めたこと（ユーザー確認済み 2026-09-30）

- ★1 表示名: 到達点「無尽」「燎原」「常在」、効果の頁の語「到達」、右上の「深み n 層」、浮き文字「深み」は案のとおり。**深みに入ったときのログは「更なる深みへ……。深淵が汝の力を解放する」**（設計の案「深みに入った。祝福・遺物の『最大』が外れる。」は使わない。「解放」の語を残す）。効果の頁の注記「（深み: 最大なし）」は案のとおり
- ★2 踏破は「最深の主を倒したラン」で数える（深みへ降りて力尽きても・離脱しても踏破。過去の履歴は数え直さない）
- ★3 深みの回転のボス 5 体の作り直しは段取り 10 に入れない。10b の QA で深みの到達の分布を見てから別の段「深みの主」として README に残す


作成日: 2026-09-30。`docs/ideas/core-synthesis.md` 9 章の段取り 10「深み: 敵の指数・研鑽・厳選の到達点・壊れ」（元は `build-core.md` P8「敵の指数、研鑽の札、性能の歯止め」と 3-2・5-1〜5-2・11 章 6、core-synthesis 3-1・3-13・3-14・5-3）を architect が確定リストまで設計したもの。採用したら `docs/ideas/deep-impl.md` に置く。★（ユーザー確認）の結果は下の「決めたこと」に書く。

前提: 段取り 8（`boss-impl.md`: 最深の間・最深の主・踏破・`state.bossLog`）と 9（`meta-impl.md`: 履歴の死因・`recordClear`・位階の見返り）は取り込み済み（`cbb2dd1`）。段取り 7e（数値合わせ）は別レーンで進行中で、`ENEMY_SCALE.json`・`INNATE/*`・`KEYSTONE/RELIC/RESONANCE.json`・`loot/affixes.ts`・`loot/named.ts`・`system/keystones.ts`・`system/resonance.ts`・`src/qa/**` を触っている。**この段の数値はすべて深み専用の新しいブロック（`DEEP` / `REACH` / `LIMITS`）に置き、7e の値を読んで決める所を作らない**（曲線の形と新しい項目だけ）。

## 決めたこと（ユーザー確認）

- （★1〜★3 の結果をここに書く）

---

## 0. 結論

- **敵の指数はもう入っている**（段取り 4 の `ENEMY_SCALE.deepHpGrowth 1.12 / deepDamageGrowth 1.04`、深度 21 の値から指数）。この段では **「深み」の境目を 1 つにする**: `chapters.ts` に `isDeepDepth(d) = d > 最深の間`（22 から）と `deepFloorOf(d)`（22 で 1 層）を足し、`FLOOR_KIND.deepDepth 30`（敵数の上限の加算・変異の開始）を撤去して新ブロック `DEEP` へ移す。変異は深み 1 層目から `DEEP.mutationEvery`（5）層ごとに 1 つ積み、**予備動作を縮める「狂乱の月」は変異から外す**（build-core 3-2「速さでは難しくしない」）。地金の深みの伸び（敵の生命と同じ 1.12）は **据え置き**: 実測で地力は深度 21→40 で ×2.3（1 層 ×1.045）しか伸びず、既に「緩く伸びる」（1 章の表）。
- **壊れ = 深みでは「〜につき」の上限が外れる**。`Modifier.per.cap` と `TemperStat.cap`（研鑽）の 2 か所だけを `isDeepDepth(state.depth)` で外す。章の間は 7e が付けた上限（黄金の檻・双頭の蛇 など）がそのまま効き、深みで初めて「うまくいったビルドが壊れる」。速さのソフトキャップ・確率の 0..1・被ダメの下限・耐性の上限・手書きの上限（来歴の段・溜めの秒など）・性能の歯止めは残す（深みが終わるのは敵の指数と死神の時計だけ）。
- **研鑽は新しい札を足さない**（7b の 18 枚で 9 系譜に 2 枚ずつ揃っている）。足りないのは **効く場所と見え方**: 上の上限の解放（深みで研鑽が唯一追い付ける経路になる）と、装備画面「効果」頁で研鑽の札に今の数えを出すこと、Tips の「研鑽」。
- **厳選の到達点を 3 つ**（7d が到達用に置いた性質だけで測る。装備だけで数え、祝福では届かない）: **無尽**（連鎖係数の合計 ≥ `REACH.chain` 0.8 → 連鎖が衰えない = 連鎖係数を掛けない）/ **燎原**（燃焼の重ねの上限の加算 ≥ 7 → 敵の燃焼の重ねの上限なし）/ **常在**（戦意の上限の加算 ≥ 32 → 戦意が冷めない）。閾値は「深度 25〜30 で拾った上振れ 2 つ」（試算で深度 21: 0〜2%、30: 14〜29%、40: 60〜76%）。`PlayerStats.reach`（装備だけの測る量）を `computeStats` が入れ、system の 3 か所が `hasReach` を読む。
- **性能の歯止め `LIMITS`**（プレイヤーの弾・スキルの弾・設置物の置き場ごと）を step の末尾で古い順に切り、`ruleRun.trimmed` に数える。通常のプレイでは届かない数。ダメージの浮き文字は 10 万から「12.3万」「1.2億」。
- ★ **踏破を「最深の主を倒したラン」で数える**（地上への道で終えても、深みへ降りて力尽きても・離脱しても）。深みへ降りると位階の見返りを失う、を無くす。
- 段は **10a（A 深みの規則 ∥ B 到達点 ∥ C 歯止めと大きな数）→ 10b（D 深みの QA）**。10a は 7e と触るファイルが重ならないので **今の HEAD（9b 取り込み後）から worktree を切れる**。10b は 7e と 10a の取り込み後。`REPLAY_VERSION` は 10a の取り込み後に 1 回。**永続データは何も消えない・キーも形も変えない**。

---

## 1. 今のコードの地図（根拠）

| 何 | どこ | 観察 |
| --- | --- | --- |
| 敵の曲線 | `src/core/scale.ts:26-30`（`curveAt`: deepDepth まで線形、以降 `deepGrowth^(d−deepDepth)`）、`src/data/enemies.ts:392-400`（`enemyCurve` / `depthHpScale`）、`src/data/balance/enemies/ENEMY_SCALE.json`（`deepDepth 21`・`deepHpGrowth 1.12`・`deepDamageGrowth 1.04`。7e が `hpPerDepth`・`damagePerDepth` を変更中） | 指数は実装済み。`deepDepth 21` = 最深の間の値が基準で、22 から指数。怯み耐性も同じ曲線 |
| 予備動作の深度短縮 | `src/system/enemies.ts:127-137`（`depthWindupMul` = max(0.75, 1 − 0.015(d−1))、`ENEMY_TEMPO.json`） | 深度 18 で下限。深みで速くならない（build-core 3-2 どおり） |
| 深みの境目が 2 つ | `src/data/balance/world/FLOOR_KIND.json:68-70`（`deepDepth 30`・`deepMaxEnemiesBonus 4`・`mutationEvery 10`）、`src/system/floor.ts:353-356`（`maxEnemiesFor`）、`src/system/runEvents.ts:298-305`（`MUTATION_KEYS` = 狂乱の月 → 血の月 → 霧 → 属性の嵐、`mutationsFor`）、`:322`（`onFloorStart`） | 章の定義（`chapters.ts` の「21 以降は深み」）と敵数・変異の開始（30）がずれている。`GLOSSARY.md:177` の「深度 30 以降。敵の生命の伸びが寝て」は段取り 4 で消えた挙動のまま |
| 狂乱の月 | `runEvents.ts:373`（`hasten` = 精鋭「迅速の」）、`src/system/elites.ts:259`（迅速の = `ELITE.windupMul`） | 変異として常に効くと全ての敵の予備動作が縮む |
| 章と最深の間 | `src/system/chapters.ts:21-38`（`lastChapterFloor` = 20、`isFinalDepth` = 21）、`:69-80`（`nextPeakOf` は 21 より深いと null） | `isDeepDepth` は無い |
| 深みのボス | `src/system/boss.ts:73-99`（`isBossDepth` は 5 の倍数と 21、`deepRotation` = 章ボスにならなかった 5 体 → 章ボス 4 体） | 深みの回転の 5 体は共通の規則 5（取り巻き）と記録だけ（boss-impl 6 章 3） |
| 地金の深み | `src/loot/innate.ts:78-87`（`innateMeanBudget` は `ENEMY_SCALE.deepHpGrowth` で伸びる） | 下の実測: 予算は ×8.6（21→40）でも地力は ×2.3 |
| 陣の人数 | `src/system/jinSpawn.ts:172`（予算 = `JIN.budgetBase + 深度 × budgetPerDepth`、上限なし） | 深みで陣は自然に厚くなる（「数でも押す」は既にある） |
| 「〜につき」の上限 | `src/system/modifiers.ts:117-122`（`perValue`: `per.cap` で切る。state を持つ） | 上限の出所: 祝福 頭領 `horde.ts:192`・守銭 `wealth.ts:186`、性質 連撃の熱 `affixes.ts:672`・転じ `:1379`（移動 → 増）`:1466`（持ち金 → 倍）、7e が足す 黄金の檻 `keystones.ts:111`・双頭の蛇 `named.ts:153` |
| 研鑽 | `src/system/boons.ts:1012-1049`（`foldBoonStats` → `foldTemperStats` → `temperAmount`: `TemperStat.cap` で切る。state を持たない）、呼び元は `src/system/player.ts:191` だけ。札は `card: "temper"` が 18 枚（`boonDefs/*.ts`）、数えは `boonRun.tallies` | 今 cap を持つ研鑽は 0 枚（7e が足しても外れる器を先に作る）。**数えを見せる所がどこにも無い**（`rg tallies src/ui src/render` 0 件） |
| 手書きの上限（残す） | `system/namedRelics.ts:88`（欲の皮）・`:137`（旅人の靴の溜め）、`system/skills.ts:761`（流転）・`:1009`（待ちの符）、`system/boonCores.ts:33`（芯 拍の刻の `comboDamageCap`）、`loot/affixes.ts` 来歴の段（歴戦 8 段・古傷 5 段） | 1 回の効果の上限か、操作の手触りの上限。深みでも残す（2-2） |
| 到達の性質 | `src/loot/affixes.ts:1215-1261`（`chainSource` 装身具・`chainReturn` 首飾り・`moraleCap` 右手と首飾り・`burnStack` 右手と指輪）、`:1363`（転じ `cv_critToChain`: 会心率 → 連鎖係数）、曲線 `balance/loot/affixCurves/{chainSource,moraleCap,burnStack}.json`、揺らぎ `balance/loot/FLUX.json`（期待値 ×0.8、σ は深度 18 で 1、flux は [−0.4, +0.8] の三角） | `relics-7d-plan.md` 9 章 4: 「連鎖 100% と燃焼の上限は性質で届く。装備画面の『到達』の行は 7e に回す」→ 7e は扱っていない（7e の差分に無い） |
| 到達の効き先 | `src/system/rules.ts:201-205`（`chainedChance` = chance × min(1, 係数 × (1 + chainCoefBonus))）、`src/system/statusEffects.ts:309-314`（`maxStacks`: 敵には `statusStackCapBonus` を足す。燃焼の基本 `STATUS.burnMaxStacks 5`）、`src/system/morale.ts:156-159`（`tickDecay` の呼び）・`:200-205` | 3 つとも 1 行のフックで入る |
| stats の畳み | `src/loot/stats.ts:97-114`（`createBaseStats`）、`:206-217`（`computeStats`）、`src/system/runSetup.ts:219-225`（封じ中は `computeStats(空)`）、`system/attributes.ts:74-76`・`boons.ts:1013`（どれも `{ ...stats }` で写す） | `computeStats` の出力に足した欄は祝福・流儀の畳みを通っても残る。封じ中は装備が空として数えられる |
| 効果の頁 | `src/ui/effectsList.ts:38-44`（`boonRows`: info は格）、`:72-75`（`runEffectRows`: 拠点では空）、`src/ui/statusTab.ts:228`（見出し）・`:239-241`（`statusTabEffectRows`） | 到達の行は拠点でも出したいので runEffectRows の外に足す |
| HUD・降階 | `src/render/runUi.ts:487-495`（`runSetupParts`: 「反転層」「帰還」）、`src/system/floor.ts:933`（降階で `refreshRunStats` = stats を畳み直す）・`:947-948`（反転層・章の予習の告知） | 深みに入ると stats が畳み直されるので、研鑽の上限の解放は降階で反映される |
| 踏破の記録 | `src/main.ts:474`（`status === "cleared"` のときだけ `recordClear`）、`src/ui/title.ts:549-576`（`runCause(status)`）、`src/meta/deathReport.ts:137-140`（踏破の行）、`src/system/finale.ts`（`clearRun`） | 最深の主を倒して深みへ降りると、踏破の回数・最高位階・位階の見返り（9b）が数えられない |
| 性能 | `src/core/game.ts:202`（`resolveRules` → `updateEffects`）、`src/core/events.ts:148-178`（`RuleRunState.droppedEvents`）、`src/system/effects.ts:69-71`（`capList`。粒・浮き文字・形は上限あり）、`src/system/rules.ts:1030-1040`（`placedPools` は非公開・`minionCount`）、`:1076-1087`（従魔は `effect.count` で上限あり） | プレイヤーの弾（`state.projectiles` の owner "player"）・`state.skills.shots`・設置物の置き場に全体の上限が無い |
| 大きな数 | `src/system/combat.ts:308`（命中の数字 `String(amount)`）、`src/system/effects.ts:1008`（継続の数字）、フォントは DotGothic16 全字（`public/fonts`） | 深度 40 で敵の生命は深度 1 の ×34（下）。壊れたビルドの数字は 6〜8 桁になる |
| QA | `src/qa/gearPower.ts:129`（`measureGearPower(depths, seeds)` は任意の深度で動く）、`src/qa/simulation.test.ts:108`（`DEEP_START_DEPTHS = [10, 20]`）、`src/qa/scalingMetrics.ts:17`（`CLEAR_DEPTH 21`）・`:266`（droppedEvents の行）、`scripts/qa-probe.mjs`（`--weapons` の節の差し替え） | 深みを測る表が無い |

**実測（今の HEAD の値。7e の前）**: `measureGearPower([21, 25, 30, 35, 40], 6 seed)`（scratchpad の一時テスト）

| 深度 | 敵の生命 | 敵の攻撃 | 地金の予算 | 地力の伸び（深度 1 比） | 地力 ÷ 敵の生命 | 最大生命 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | ×4.00 | ×2.00 | 8.4 | 1.43 | 0.36 | 129 |
| 25 | ×6.29 | ×2.34 | 13.1 | 1.77 | 0.28 | 126 |
| 30 | ×11.1 | ×2.85 | 23.2 | 2.28 | 0.21 | 152 |
| 35 | ×19.5 | ×3.46 | 40.8 | 2.77 | 0.14 | 198 |
| 40 | ×34.5 | ×4.21 | 71.9 | 3.34 | 0.10 | 191 |

→ 地金の予算が敵の生命と同じ 1.12 で伸びても、ステータスの逓減と配分で地力は 1 層 ×1.045 前後。深み 1 層ごとに **相乗と研鑽で ×1.07** を足せないと追い付けない（深度 30 で ×1.7、40 で ×3.7）。守り（最大生命）はほぼ伸びず、敵の攻撃は 1.04 で伸びる → 深みでは被弾が重くなっていく。build-core 5-1「深み: 地力は緩く伸びる、研鑽が上限なく」の形に既になっている。

**試算（到達の閾値）**: 性質の曲線（`affixCurves`）・`FLUX`（期待値 ×0.8、flux [−0.4, 0.8] の三角、σ は深度 18 から 1）を写した Monte Carlo 20 万回。「その性質を持つ遺物 2 つの合計が閾値に届く」確率（転じ `cv_critToChain` などの 3 つ目の出所は数えない）

| 到達（閾値） | 深度 21 | 25 | 30 | 35 | 40 |
| --- | --- | --- | --- | --- | --- |
| 無尽（連鎖係数 +80%） | 0% | 2% | 14% | 36% | 60% |
| 燎原（燃焼の重ねの上限 +7） | 0% | 1% | 18% | 50% | 77% |
| 常在（戦意の上限 +32） | 2% | 10% | 29% | 52% | 72% |

---

## 2. 設計

### 2-1. 深みの境目と敵の指数

- `src/system/chapters.ts` に足す（純関数）:

```ts
/** 深み（最深の間の次の階 = 深度 22 から）。深みの規則（敵数・変異・上限の解放・表示）はこれだけを見る */
export function isDeepDepth(depth: number): boolean;           // depth > lastChapterFloor() + 1
/** 深みの何層目か（22 で 1）。深みでなければ 0 */
export function deepFloorOf(depth: number): number;
/** 最深の主を倒したランか（bossLog に ARC.finalBoss）。踏破の数え（2-6） */
export function conqueredBy(bossLog: readonly { readonly key: string }[]): boolean;
```

- 敵の曲線は触らない（`ENEMY_SCALE` は 7e の所有）。**`ENEMY_SCALE.deepDepth` が最深の間の深度と同じであることをテストで縛る**（指数は深みの 1 層目から、が崩れないように）
- `FLOOR_KIND.deepDepth` / `deepMaxEnemiesBonus` / `mutationEvery` と `_fields` の 3 行を撤去し、新ブロック `world/DEEP.json` へ（3-2）
  - `floor.ts` `maxEnemiesFor(depth)` = `ROOM.maxEnemies + (isDeepDepth(depth) ? DEEP.maxEnemiesBonus : 0)`（ボス部屋・特別な部屋・増援の上限。通常の陣は `JIN.budgetPerDepth` で既に深度に比例）
  - `runEvents.ts` `MUTATION_KEYS = ["bloodMoon", "fog", "elementStorm"]`（**狂乱の月を外す**。予備動作を縮めるため。階の枠のランイベントとしての狂乱の月は残る）、`mutationsFor(depth)` = 深みでなければ `[]`、深みなら `1 + floor((deepFloorOf(depth) − 1) / DEEP.mutationEvery)` 個（深み 1 層 = 22 で 1 つ、27 で 2 つ、32 で 3 つ）
- 地金（`innate.ts:86`）は据え置き（1 章の実測。却下した案は 2-9）
- 反転層（`FLOOR_KIND.invertedDepth 20`）は据え置き。HUD では深みを優先して出す（2-7）

### 2-2. 壊れ: 深みで外れる上限と残る上限

| 上限 | 深みで | 場所 | 理由 |
| --- | --- | --- | --- |
| 「〜につき」の上限 `Modifier.per.cap`（祝福・性質・転じ・誓約・名のある遺物・共鳴の全部） | **外す** | `modifiers.ts:121` | 強さの上限。章の釣り合いのために置いたもの（7e） |
| 研鑽の上限 `TemperStat.cap` | **外す** | `boons.ts:1046-1049` | 研鑽は「上限なく育つ」が定義（柱 4） |
| 速さのソフトキャップ（攻撃速度・連射・移動） | 残す | `stats.ts:73-77` | 操作が破綻する（build-core 柱 3） |
| 確率の 0..1、被ダメの下限、耐性の上限 75%、防御の軽減の上限 | 残す | `stats.ts:142-150`、`combat.ts` | 外すと深みが終わらない（死なない） |
| 手書きの上限（欲の皮・旅人の靴の溜め・流転・待ちの符・拍の刻・来歴の段） | 残す | 1 章の表 | 1 回の効果・操作の手触りの上限。規則を「〜につき だけ」の 1 行で言えるようにする |
| 性能の歯止め（`SYNERGY.maxDepth 8`・`keywordBudget`・`maxEventsPerStep`・新しい `LIMITS`・粒と文字の上限） | 残す | — | 1 ステップの重さ。強さの天井としては使わない（QA で当たった回数を見る） |

実装（3 行）:

```ts
// system/modifiers.ts perValue の最後
return per.cap === undefined || isDeepDepth(state.depth) ? value : Math.min(per.cap, value);
// system/boons.ts
export function foldBoonStats(stats: Readonly<PlayerStats>, boons: readonly BoonKey[], run: Readonly<BoonRunState>, uncapped = false): PlayerStats;
export function temperAmount(t: Readonly<TemperStat>, value: number, uncapped = false): number; // t.cap === undefined || uncapped ? amount : min
// system/player.ts:191
const stats = foldBoonStats(derived, state.boons, state.boonRun, isDeepDepth(state.depth));
```

`foldTemperStats(out, boons, tallies, uncapped)` も同じ引数を通す。降階で `refreshRunStats` → `applyStats` が走るので、22 に着いた時点で研鑽の上限が外れる（`floor.ts:933`）。

### 2-3. 研鑽（見え方と深みの役目）

- **新しい札は足さない**。深みで研鑽が「唯一追い付ける経路」になるのは 2-2 の上限の解放で足りる（研鑽の倍は数えに比例、敵は指数 → 札の数だけ多項式で伸び、どこかで追い抜かれる = ビルドの物差し）
- 装備画面「効果」頁（`ui/effectsList.ts` の `boonRows`）: 研鑽の札（`card === "temper"`）の info を `{格}・{数え}` に。数え = `temperStat` があれば `boonRun.tallies[t.tally]`、無ければ最初の `per` を持つ Modifier の `countPer(state, m.per.count, null)`（`modifiers.ts` の公開関数。銭の稼ぎ・使いの研鑽もこれで出る）。小数は切り捨て
- 同じ頁: 深みにいて、札が上限を持つ（`temperStat?.cap` か `modifiers` のどれかに `per.cap`）なら detail の末尾に `（深み: 最大なし）`
- Tips に「研鑽」を 1 項目（2-7）

### 2-4. 厳選の到達点

| key | 表示名（★） | 測る量（装備だけ） | 閾値 `REACH.*` | 効果 | 届かせる性質（部位） | 効き先 |
| --- | --- | --- | --- | --- | --- | --- |
| `chain` | 無尽 | `stats.chainCoefBonus`（`chainSource` の合計 + 転じ `cv_critToChain`） | `chain 0.8`（+80%） | **連鎖が衰えない**: 連鎖係数を掛けず、Rule の元の確率で続く（訪問回数・範囲・深さ 8 の保険では止まる） | 連鎖係数（指輪・首飾り）、会心率 → 連鎖係数 | `rules.ts` `chainedChance` の頭で `if (hasReach(state.stats, "chain")) return Math.min(1, rule.chance);` |
| `burn` | 燎原 | `stats.statusStackCapBonus.burn` | `burn 7` | **燃焼が際限なく重なる**: 敵への燃焼の重ねの上限なし（プレイヤーへの燃焼は 1 のまま。昇華「焦熱」の閾値 `STATUS.burnMaxStacks` は変えない） | 燃焼の重ねの上限（右手・指輪） | `statusEffects.ts` `maxStacks` の `if (target.kind === "player") return base;` の直後に `if (kind === "burn" && hasReach(state.stats, "burn")) return Number.POSITIVE_INFINITY;` |
| `morale` | 常在 | `stats.moraleMaxAdd` | `morale 32` | **戦意が冷めない**: 時間による冷め（`tickDecay`）が起きない。止まる / 動くで減る型の減り（`tickStill`）は残る | 戦意の上限（右手・首飾り） | `morale.ts:158` を `if (!hasReach(state.stats, "morale")) tickDecay(m, form, dt);` |

- **装備だけで数える**: `computeStats` の最後（`finalize` の後）に `out.reach = reachMeasures(out)`。祝福・起点・祭壇の誓約（`applyRunStats` 以降）の足しは入らない（ハクスラの目標のまま）。装備が封じられている間は `computeStats(空)` なので 0。拠点でも同じ値
- 閾値は「深度 25〜30 で拾った上振れ 2 つ」（1 章の試算）。3 つの性質は部位が 2 つずつで重なる（指輪 = 無尽と燎原、首飾り = 無尽と常在、右手 = 燎原と常在）→ 2 つ同時に届くには 1 つの遺物に 2 つの到達の性質が要る = 厳選の分岐
- 表示: 装備画面の「効果」頁の先頭に到達の行（拠点でも出す）。測る量が 0 の到達は出さない。`name` = 表示名、`info` = 届いていれば `到達`、届いていなければ `{今}/{閾値}`（`REACH_DEFS[k].format`）、`detail` = `{測る量の名} {今} / {閾値}: {効果}`
- 却下: 各軸 9 つ（測る性質の無い軸に性質を足す = かさ増し）、祝福でも届く（2-9）

```ts
// src/loot/types.ts（PlayerStats の graceSlotBonus の直後・DEFAULT_STATS も同じ位置）
export const REACH_KEYS = ["chain", "burn", "morale"] as const;
export type ReachKey = (typeof REACH_KEYS)[number];
/** 厳選の到達点の測る量（装備だけ。computeStats が入れる。loot/reach.ts） */
reach: Readonly<Record<ReachKey, number>>;
// DEFAULT_STATS: reach: Object.freeze({ chain: 0, burn: 0, morale: 0 }),

// src/loot/reach.ts（新）
export interface ReachDef {
  readonly key: ReachKey;
  readonly name: string;          // 無尽 / 燎原 / 常在
  readonly measureLabel: string;  // 連鎖係数 / 燃焼の重ねの上限 / 戦意の上限
  readonly effect: string;        // 連鎖が衰えない / 燃焼が際限なく重なる / 戦意が冷めない
  readonly threshold: number;     // REACH.chain / burn / morale
  readonly affixes: readonly string[]; // 届かせる主な性質の key（QA の届き方の見積もり。先頭が主）
  measure(stats: Readonly<PlayerStats>): number;
  format(value: number): string;  // 連鎖は「+80%」、他は「+7」
}
export const REACH_DEFS: Readonly<Record<ReachKey, ReachDef>>;
export function reachMeasures(stats: Readonly<PlayerStats>): Record<ReachKey, number>;
export function hasReach(stats: Readonly<PlayerStats>, key: ReachKey): boolean; // stats.reach[key] >= threshold
export function reachedKeys(stats: Readonly<PlayerStats>): ReachKey[];         // REACH_KEYS 順

// src/ui/reachRows.ts（新）
export function reachRows(stats: Readonly<PlayerStats>): EffectRow[];
```

`createBaseStats`（`stats.ts:97-114`）に `reach: { ...DEFAULT_STATS.reach }`。`affixes` の表: chain `["chainSource", "cv_critToChain"]`、burn `["burnStack"]`、morale `["moraleCap"]`。

### 2-5. 性能の歯止めと大きな数

```ts
// src/system/limits.ts（新）
/** step の末尾（resolveRules の後）。上限を超えた分を古い順に消し、消した数を ruleRun.trimmed に足す */
export function enforceLimits(state: GameState): void;
// 1. state.projectiles のうち owner === "player" が LIMITS.playerProjectiles を超えたら、古い（配列の前の）プレイヤーの弾から消す。敵の弾は消さない
// 2. state.skills.shots が LIMITS.skillShots を超えたら前から消す
// 3. placedPools(state) の置き場ごとに LIMITS.placedPerPool を超えたら前から消す
```

- `rules.ts:1030` の `placedPools` に `export` を付けるだけ（置き場の一覧を 2 か所に書かない）
- `core/events.ts` `RuleRunState.trimmed: number`（`droppedEvents` の直後）と `createRuleRunState` の `trimmed: 0`
- `core/game.ts:202` の `resolveRules(state, gdt);` の直後に `enforceLimits(state);`
- 従魔は既に `effect.count` で上限がある（`rules.ts:1076-1087`）ので足さない
- 大きな数: `core/units.ts` に `formatAmount(n)`（四捨五入。10 万未満はそのまま、10 万以上は `12.3万`、1 億以上は `1.2億`。小数 1 桁、末尾の `.0` は落とす）。`combat.ts:308` の `String(amount)` と `effects.ts:1008` の `String(Math.round(amount))` を `formatAmount(amount)` に

### 2-6. 踏破の数え（★2）

- 踏破 = **最深の主を倒したラン**（`conqueredBy(state.bossLog)`）。地上への道で終えても（`status "cleared"`）、深みへ降りて力尽きても・離脱しても踏破に数える
- `main.ts:474` を `if (current.status === "cleared" || conqueredBy(current.bossLog)) recordClear(current.profile, runTier(current.modifiers));`
- `ui/title.ts`: `RunSummarySource` に `bossLog?: readonly { readonly key: string }[]`、`runCause(source)` = `status === "cleared" || conqueredBy(source.bossLog ?? [])` なら `"cleared"`、他は今どおり
- `meta/deathReport.ts:139`: 踏破の行を `踏破: 位階 {tier}（{n} 回目）` + 深みなら `・深み {deepFloorOf(entry.depth)} 層`
- 死亡画面の見出しは status のまま（深みで力尽きたら「力尽きた」、行に「踏破: …・深み 6 層」）。ボスの間（`bossHall.ts`）は `endRun` を通らないので数えない（今どおり）

### 2-7. 表示

| 何 | 中身 | 場所 |
| --- | --- | --- |
| 右上の 1 行 | 深みなら `深み {n} 層`、深みでなく反転層なら `反転層`（両方は出さない） | `render/runUi.ts` `runSetupParts` の :492 |
| 深みに初めて着いた | 浮き文字 `深み`（`DEEP.color`、大きさ 2、1.6 秒）とログ `深みに入った。祝福・遺物の「最大」が外れる。` | `system/deep.ts` `announceDeep`、`floor.ts:947` の直後に `if (fresh && deepFloorOf(state.depth) === 1) announceDeep(state);` |
| 効果の頁 | 到達の行（先頭。拠点でも）、研鑽の数え、深みの「最大なし」 | 2-3・2-4 |
| 見出し | `効果: 到達・状態異常・祝福・芯・一時強化（到達のほかはラン中のみ）` | `ui/statusTab.ts:228` |
| Tips | `deep`「深み」（run）、`tally`「研鑽」（run）、`reach`「到達」（relic）。本文は下 | `meta/tips.ts` |

Tips の本文（数値は JSON から組む）:
- 深み: 「最深の主を倒した後、階段を降りた先（地下 22 階から）。敵の生命と攻撃が 1 層ごとに掛け算で伸び、{DEEP.mutationEvery} 層ごとに変異（階のイベントが常に効く）が 1 つ積まれる。祝福・遺物の『〜につき』の最大と研鑽の上限が外れる。どこまで潜れるかがビルドの物差し。最深の主を倒したランは、深みで力尽きても踏破に数える。」
- 研鑽: 「使うほど育つ祝福の札。倒した数・燃やした数などの数えで、ラン中は上限なく伸びる。今の数えは装備画面のステータスタブ『効果』の頁に出る。」
- 到達: 「遺物の性質を同じ向きに重ね、装備だけで数えた量が閾値に届くと、その軸の決まりが 1 つ変わる。無尽（連鎖係数 +{REACH.chain}%）: 連鎖が衰えない。燎原（燃焼の重ねの上限 +{REACH.burn}）: 燃焼が際限なく重なる。常在（戦意の上限 +{REACH.morale}）: 戦意が冷めない。祝福では届かない。深い階で拾った遺物ほど性質が強い。」

### 2-8. 決定性

- 新しい乱数の消費は無い。変わるのは深度 22 以降の生成（敵数の上限・変異の開始が 30 → 22）と、深みの「〜につき」・研鑽の値、到達を持つ装備の連鎖・燃焼・戦意、`LIMITS` に当たった時の弾・設置物の数。全部 state と深度から決まる
- `enforceLimits` は配列の前（古い順）から消す。同じ入力なら同じ要素が消える
- `formatAmount` は浮き文字の文字列だけ（描画でなく system が作るが、ロジックは読まない）
- `REPLAY_VERSION` を 10a の取り込み後に 1 つ上げる（3-4）

### 2-9. やらないこと（却下した案）

- 深みで地金の伸びを寝かせる（`DEEP.innateGrowth`）: 実測で地力は既に 1 層 ×1.045。承認済みの core-synthesis 3-1「地金は敵の生命と同じ曲線」を崩す理由が無い
- 新しい研鑽の札（build-core 5-2 の 魂・刻・旅・印・型）: 7b の 18 枚で 9 系譜に揃う。足りないのは効く場所と見え方
- 深みで上限を全部外す（速さ・確率・被ダメの下限・手書きの上限）: 操作が壊れる / 深みが終わらない / 規則が 1 行で言えない
- 到達点を祝福でも届くようにする: 装備を厳選する理由（ハクスラの目標）が薄れる
- 到達点を 9 軸すべてに: 測る性質の無い軸に性質を足すことになる（量の方針に反する）
- 深みの実績（深み 10 層など）・百層: 最高到達は `meta.bestDepth` と履歴で見える。10b の QA で深みの到達の分布を見てから
- 帰還の扉（深みの途中で踏破して終える）: 袋・持ち帰りが無いので終える理由が記録だけ。2-6 で踏破を撃破で数えれば要らない
- 反転層を 22 へ（`run-arc.md` 1-4 の案）: 章 4 の見た目と精鋭率が変わる別件。HUD の重なりは 2-7 で避けた
- `LIMITS` を強さの天井に使う: 通常のプレイで届かない数に置き、当たった回数を QA で見る
- 深みで研鑽の札・錬磨を出やすくする: 出口の予告で系譜を選べば研鑽は取れる。重みを変える根拠（深みの 3 択の分布）が無い

---

## 3. 型・JSON・テスト・REPLAY_VERSION・セーブの移行

### 3-1. 型（共有ファイルは最小 Edit）

| ファイル | 変更 | レーン |
| --- | --- | --- |
| `src/system/chapters.ts` | `isDeepDepth` / `deepFloorOf` / `conqueredBy`（2-1） | A |
| `src/system/deep.ts`（新） | `announceDeep(state)`、`DEEP_TEXT_SCALE = 2` / `DEEP_TEXT_LIFE = 1.6`（表示の定数） | A |
| `src/system/modifiers.ts` | `perValue` の 1 行（2-2） | A |
| `src/system/boons.ts` | `foldBoonStats` / `foldTemperStats` / `temperAmount` に `uncapped` 引数（既定 false） | A |
| `src/system/player.ts` | :191 の 1 行 | A |
| `src/ui/title.ts` | `RunSummarySource.bossLog?`、`runCause(source)` | A |
| `src/loot/types.ts` | `REACH_KEYS` / `ReachKey`、`PlayerStats.reach`、`DEFAULT_STATS.reach` | B |
| `src/loot/stats.ts` | `createBaseStats` に `reach`、`computeStats` の最後で `reachMeasures` | B |
| `src/loot/reach.ts`（新）/ `src/ui/reachRows.ts`（新） | 2-4 | B |
| `src/core/events.ts` | `RuleRunState.trimmed` | C |
| `src/core/units.ts` | `formatAmount` | C |
| `src/system/limits.ts`（新） | `enforceLimits` | C |
| `src/system/rules.ts` | `placedPools` に `export`（C）、`chainedChance` の 1 行（B） | B / C（別の行） |

### 3-2. balance JSON（`_fields` を親に 1 回。新しい葉には全部説明 = `balance.test.ts` の基準値を増やさない）

| ブロック | 中身 | レーン |
| --- | --- | --- |
| `world/DEEP.json`（新。`world/_index.json` の `_order` の `"ARC"` の直後に `"DEEP"`） | `_note`: 「深み（最深の間の次の階 = 深度 22 から。system/chapters.ts の isDeepDepth）だけの項目。敵の生命・攻撃の指数は enemies/ENEMY_SCALE（deepDepth = 最深の間）」。`maxEnemiesBonus 4`（旧 `FLOOR_KIND.deepMaxEnemiesBonus`。「深みで ROOM.maxEnemies に足す数」）、`mutationEvery 5`（「深みで変異が 1 つ増える層の数。深み 1 層目で 1 つ。目安 3〜10」）、`color "#8fb4ff"`（「深みの表示の色（右上の『深み n 層』は白のまま、浮き文字とログ）」） | A |
| `world/FLOOR_KIND.json` | `deepDepth` / `deepMaxEnemiesBonus` / `mutationEvery` の値と `_fields` の 3 行を削除 | A |
| `world/ROOM.json` | `_fields.maxEnemies` の文を「…深み（最深の間の次の階から）は DEEP.maxEnemiesBonus を足す」に | A |
| `enemies/ENEMY_SCALE.json` | `_fields.deepDepth` の文だけ「ここから深み（指数の伸び）。最深の間の深度と同じにする（chapters.test.ts が縛る）。深みの敵数・変異は world/DEEP」に（**値と `_note` は 7e のもの。触らない**） | A |
| `loot/REACH.json`（新。`loot/_index.json` の `_order` の `"RESONANCE"` の直後に `"REACH"`） | `_note`: 「厳選の到達点（loot/reach.ts）。装備だけで数えた量が閾値に届くと、その軸の決まりが 1 つ変わる。祝福・起点・祭壇の誓約では届かない。閾値の目安は『深度 25〜30 で拾った上振れの遺物 2 つ』（qa:probe -- --deep の到達の表で確かめる）」。`chain 0.8`（「無尽の閾値。装備の連鎖係数の合計（1 = +100%）。目安 0.6〜1」）、`burn 7`（「燎原の閾値。装備の燃焼の重ねの上限の加算。目安 5〜9」）、`morale 32`（「常在の閾値。装備の戦意の上限の加算。目安 25〜40」） | B |
| `combat/LIMITS.json`（新。`combat/_index.json` の `_order` の `"STATUS"` の直後に `"LIMITS"`） | `_note`: 「性能の歯止め（system/limits.ts）。強さの上限ではなく 1 ステップの重さを抑える数。超えた分は古い順に消し ruleRun.trimmed に数える。通常のプレイでは届かない数にする（qa:probe -- --deep の壊れの表で最大値を見る）」。`playerProjectiles 256` / `skillShots 192` / `placedPerPool 32` | C |
| `src/data/tuning.ts` | A: `export const ARC = …` の直後に `export const DEEP = BALANCE.world.DEEP;`。B: `export const RESONANCE = …` の直後に `export const REACH = BALANCE.loot.REACH;`。C: `export const STATUS = …` の直後に `export const LIMITS = BALANCE.combat.LIMITS;` | A / B / C |

`src/data/balance/assembled.gen.ts` は 3 レーンが import を足す → **統合役が取り込みごとに `npm run balance:gen`**（手で直さない）。

### 3-3. テスト（`it` は日本語。状態で検証する）

**A**（`src/system/deep.test.ts` 新・既存へ追記）

- `chapters.test.ts`: 「isDeepDepth は最深の間の次（22）から true、21 は false」「deepFloorOf は 22 で 1、21 以下は 0」「conqueredBy は bossLog に最深の主があるときだけ true」「ENEMY_SCALE.deepDepth は最深の間の深度と同じ（敵の指数は深みの 1 層目から）」
- `floor.test.ts:815-822` を書き直す: 「深みでは部屋の敵数の上限が DEEP.maxEnemiesBonus 増え、最深の間では増えない」
- `runEvents.test.ts:658-673` を書き直す: 「深みより浅ければ変異なし、深み 1 層目で 1 つ、DEEP.mutationEvery 層ごとに 1 つ増え、全部が階の枠の出来事」「変異に狂乱の月は入らない（予備動作を縮めない）」「深みの階では変異が常に効き、HUD に出る」（霧は 2 つ目なので深み 1 + mutationEvery 層で見る）
- `deep.test.ts`: 「深みでは〜につきの上限が外れ、最深の間では上限で止まる」（上限つきの祝福 頭領 か 守銭 を持たせ、従魔・持ち金を上限より多くして `estimateModifiers(state, "melee").increased` を深度 21 と 22 で比べる）「研鑽の上限は uncapped で外れる（temperAmount）」「深みに降りると applyStats が研鑽の上限を外した stats を畳む」「深みに初めて着くと浮き文字『深み』とログが 1 回だけ出る（深み 2 層目・戻った階では出ない）」
- `render/runUi.test.ts`: 「深みでは右上に『深み n 層』を出し、反転層は出さない」
- `ui/effectsList.test.ts`: 「研鑽の札の info に今の数えを出す」「深みでは上限を持つ札の説明に『最大なし』を足し、章の間は足さない」
- `ui/title.test.ts`: 「最深の主を倒した後に深みで力尽きたランは、履歴の終わり方が踏破になる」「最深の主を倒していない力尽きたランは defeated のまま」
- `meta/deathReport.test.ts`: 「踏破の行は、深みで終えたら深みの層を足す」

**B**（`src/loot/reach.test.ts` 新・`src/system/reachEffects.test.ts` 新・`src/ui/reachRows.test.ts` 新）

- reach: 「連鎖係数・燃焼の重ねの上限・戦意の上限の性質の合計が閾値に届くと到達、届かないと到達しない」「到達は装備だけで決まる（祝福の研鑽で連鎖係数が増えても、stats.reach は変わらない）」「装備が封じられている間は到達しない」「閾値は深度 21 の期待値の遺物 2 つでは届かず、深度 40 の期待値 ×1.4 の遺物 2 つなら届く」（`scaledNominalAt` と `affixDef(k).apply`）
- reachEffects: 「無尽: 連鎖係数 0.3 の効果から起きた Rule も元の確率で起きる」「無尽でも同じ敵への訪問回数で連鎖は止まる」「燎原: 敵の燃焼が上限を越えて重なり、プレイヤーの燃焼は 1 のまま」「常在: 戦意が時間で冷めない」「到達していなければ今までどおり（3 つとも）」
- reachRows: 「測る量が 0 の到達は出さない」「届けば info が『到達』、届かなければ今 / 閾値」「拠点（sandbox）の state でも出る」（`statusTabEffectRows` で確かめる）

**C**（`src/system/limits.test.ts` 新・`src/core/units.test.ts` 追記）

- limits: 「プレイヤーの弾が上限を超えると古い順に消え、敵の弾は数に関わらず消えない」「スキルの弾と設置物も上限で古い順に消え、消した数を ruleRun.trimmed に足す」「上限に届かなければ何も消えない」「step の末尾で効く（同じ seed と入力なら同じ要素が消える）」
- units: 「10 万未満はそのまま、10 万以上は万、1 億以上は億（小数 1 桁、末尾の .0 は落とす）」
- `system/effects.test.ts` か `combat.test.ts` に 1 件: 「大きなダメージの浮き文字は万で出る」

**D**（`src/qa/deepProbe.test.ts` 新）: 「深みの曲線の表は深度ごとに 1 行で、値は有限」「到達の届き方は同じ seed で同じ割合」「壊れの計測は有限の値を返し、捨てた数を数える」「probe.md の『## 深み』の節を組める」

### 3-4. `REPLAY_VERSION`（`src/core/replay.ts:78`、今 30）

- **10a の取り込みの後に 1 回だけ上げる**（取り込み時点の値 + 1。7e が上げていればその次）。10b は QA だけなので上げない
- コメント: 「深み（深度 22 から敵数の上限・変異、深みで〜につきと研鑽の上限を外す）・厳選の到達点（無尽・燎原・常在）・性能の歯止め（step 末尾の LIMITS）」
- `docs/ARCHITECTURE.md` の版の一覧に 1 行

### 3-5. 壊れそうなテスト（既存）

| テスト | 理由 | 直し方 | 持ち主 |
| --- | --- | --- | --- |
| `system/floor.test.ts:815-822` | `FLOOR_KIND.deepDepth` を消す | 3-3 A | A |
| `system/runEvents.test.ts:658-673` | 同上・狂乱の月を外す | 3-3 A | A |
| `render/runUi.test.ts:9-18` | 深度 20（反転層）は深みでないので通る見込み | 落ちたら深度を確かめる | A |
| `ui/title.test.ts:247` | `bossLog` は任意の欄 | そのまま | A |
| `meta/deathReport.test.ts:39-45` | 深度 25 の力尽き（cause defeated）は行 0 のまま | そのまま | A |
| `system/boonTallies.test.ts`・`boonDefs/*.test.ts` | `temperAmount` の引数が増える（既定 false） | そのまま | A |
| `loot/stats.test.ts`・`ui/statusTab.test.ts`・`PlayerStats` の欄を列挙する検査（`rg "keyof PlayerStats" src` の表示名の表） | `reach` は数値でない欄 | 表の型が数値の欄だけなら通る。落ちたら表から外す | B |
| `system/statusEffects.test.ts`・`morale.test.ts`・`rules*.test.ts` | 到達の無い装備では変わらない | そのまま | B |
| `system/effects.test.ts:110`（浮き文字の上限）・命中の数字の検査 | 小さい数は同じ文字 | そのまま | C |
| `core/replay.test.ts`・`system/enemyGolden.test.ts` | 深度 22 未満は変わらない | そのまま通るのが完了条件 | A / C |
| `data/balance/balance.test.ts` | 新しい葉 | 全部 `_fields` に書く | 各 |
| `npm run audit:docs` | 新しい本体 5 ファイル（`system/deep.ts` / `loot/reach.ts` / `ui/reachRows.ts` / `system/limits.ts` / `qa/deepProbe.ts`）が `CODE_MAP.md` に無い | 統合役がコードと同じコミットで足す | 統合役 |

### 3-6. セーブの移行

**無し**。保存キーも形も変えない。`PlayerStats.reach` は装備から毎回導く（保存しない）。`RunHistoryEntry.cause "cleared"` が増えるだけ（既存の値）。古い版で読んでも同じ。**消える永続データは無い**（踏破の数え直しもしない。過去に深みで力尽きた履歴は `defeated` のまま）。

---

## 4. 段階とレーン

全レーン `isolation: "worktree"`。レーンはコミットしない。作業中は自分のテストだけ `npx vitest run <ファイル>`、最後に 1 回 `npm run check:fast`（他レーン起因の失敗と負荷のタイムアウトは報告だけ）。統合役は取り込みごとに `npm run balance:gen`、段の終わりに `npm run check`。

### 10a（並行 3 本。遊べる: 深み 1 層目から変異と敵数、深みで「最大」が外れる、研鑽の数えが見える、到達 3 つ、踏破の数え、大きな数、歯止め）

**切る元**: 今の HEAD（`cbb2dd1` 以降。9b 取り込み済み）。7e の変更ファイル（冒頭の前提）と重ならないので 7e の取り込みを待たない。

| レーン | モデル | 所有 | 最小 Edit のみ | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| **A 深みの規則と踏破の数え** | Sonnet（全部 1〜3 行の Edit。場所と文を列挙済み） | `src/system/deep.ts`（新）、`src/system/deep.test.ts`（新）、`src/system/chapters.ts`、`src/system/chapters.test.ts`、`src/ui/effectsList.ts`、`src/ui/effectsList.test.ts`、`balance/world/DEEP.json`（新） | `balance/world/_index.json`（`_order`）、`balance/world/FLOOR_KIND.json`・`ROOM.json`（3-2）、`balance/enemies/ENEMY_SCALE.json`（`_fields.deepDepth` の文だけ）、`data/tuning.ts`（ARC の直後 1 行）、`system/floor.ts`（`maxEnemiesFor` と :947 の直後 1 行・import）、`system/floor.test.ts:815-822`、`system/runEvents.ts`（:298-305）、`system/runEvents.test.ts:658-673`、`system/modifiers.ts:121`、`system/boons.ts:1012-1049`（引数 `uncapped`）、`system/player.ts:191`、`render/runUi.ts:492`、`render/runUi.test.ts`（1 件追記）、`ui/title.ts:549-576`、`ui/title.test.ts`（2 件追記）、`main.ts:474`（1 行と import）、`meta/deathReport.ts:139`、`meta/deathReport.test.ts`（1 件追記）、`meta/tips.ts`（`cleared` の項目の直後に `deep`、`temper`〔錬磨〕の項目の直後に `tally`〔研鑽〕） | B・C の所有、`loot/**`、`system/rules.ts`、`system/statusEffects.ts`、`system/morale.ts`、`ui/statusTab.ts`、`core/**`、`src/qa/**`、7e の変更ファイル | 3-3 の A が通る。`rg "FLOOR_KIND\.(deepDepth\|deepMaxEnemiesBonus\|mutationEvery)" src` が 0 件。`core/replay.test.ts`・`enemyGolden.test.ts` が変更なしで通る |
| **B 厳選の到達点** | Sonnet | `src/loot/reach.ts`（新）、`src/loot/reach.test.ts`（新）、`src/system/reachEffects.test.ts`（新）、`src/ui/reachRows.ts`（新）、`src/ui/reachRows.test.ts`（新）、`balance/loot/REACH.json`（新） | `balance/loot/_index.json`（`_order`）、`data/tuning.ts`（RESONANCE の直後 1 行）、`loot/types.ts`（`REACH_KEYS` / `ReachKey` を `PlayerStats` の直前、`reach` を `graceSlotBonus` の直後、`DEFAULT_STATS` も `graceSlotBonus` の直後）、`loot/stats.ts`（`createBaseStats` の `graceSlotBonus` の直後 1 行、`computeStats` の `return finalize(stats);` を 2 行に）、`system/rules.ts:202`（`chainedChance` の頭 1 行と import）、`system/statusEffects.ts:312`（1 行と import）、`system/morale.ts:158`（1 行と import）、`ui/statusTab.ts:228, 240`（見出しの文と `[...reachRows(state.stats), ...runEffectRows(state)]`）、`meta/tips.ts`（`innate`〔地金〕の項目の直後に `reach`） | A・C の所有、`ui/effectsList.ts`、`system/modifiers.ts`、`system/boons.ts`、`loot/affixes.ts`（7e）、`core/**`、`src/qa/**` | 3-3 の B が通る。到達を持たない装備で既存の `statusEffects` / `morale` / `rules` のテストが変更なしで通る |
| **C 歯止めと大きな数** | Sonnet | `src/system/limits.ts`（新）、`src/system/limits.test.ts`（新）、`balance/combat/LIMITS.json`（新） | `balance/combat/_index.json`（`_order`）、`data/tuning.ts`（STATUS の直後 1 行）、`core/game.ts:202`（直後に 1 行と import）、`core/events.ts:164, 176`（`trimmed` の 2 行）、`core/units.ts`（`formatAmount` と定数を末尾に）、`core/units.test.ts`（追記）、`system/rules.ts:1030`（`export` を足すだけ）、`system/combat.ts:308`・`system/effects.ts:1008`（`formatAmount` と import）、`system/effects.test.ts`（1 件追記） | A・B の所有、`system/rules.ts` の :1030 以外、`src/qa/**` | 3-3 の C が通る。`core/replay.test.ts` が変更なしで通る |

**衝突の確認（10a）**: `data/tuning.ts` は 3 本が別の目印の直後（STATUS :32 / RESONANCE :93 / ARC :196）に 1 行ずつ。`balance/*/_index.json` は world（A）/ loot（B）/ combat（C）で別ファイル。`system/rules.ts` は B = :202 付近、C = :1030 で 800 行離れる。`meta/tips.ts` は A = :209 と :227 の直後、B = :155 の直後で別の場所。`ui/effectsList.ts` は A だけ、`ui/statusTab.ts` は B だけ。`assembled.gen.ts` は 3 本とも import が増える → 統合役が取り込みごとに `npm run balance:gen`。**7e との衝突**: 10a の所有・最小 Edit のうち 7e が触るのは `ENEMY_SCALE.json` だけ（A は `_fields.deepDepth` の 1 行、7e は `_note` と値の行で離れている）。取り込みの前に `git diff --stat <10a を切ったコミット>..<7e> -- src/data/balance/enemies/ENEMY_SCALE.json` を見て、重なれば A の 1 行を統合役が手で当て直す。

**統合（10a）**: C → B → A の順（A が最も広い）。`npm run balance:gen` → `npm run check`。`REPLAY_VERSION` を 1 つ上げる。**レビューは段の終わりに `model: "opus"` の reviewer 1 回**（決定性: `enforceLimits` の消し方と step の中の位置、深みの上限の解放が `state.depth` だけを見るか、到達が装備だけで数えられるか・封じの扱い、踏破の数えが `endRun` 1 回か）。資料（統合役）: `CODE_MAP.md`（新しい本体 4 行: `system/deep.ts` / `loot/reach.ts` / `ui/reachRows.ts` / `system/limits.ts`）をコードと同じコミットで。段の終わりにまとめて: `docs/GLOSSARY.md`（:177「無限の深み / 変異」を「深み / 変異: 深度 22（深み 1 層）から。{mutationEvery} 層ごとに変異（血の月 → 霧 → 属性の嵐）…『〜につき』と研鑽の上限が外れる」に書き直し、「到達（無尽 / 燎原 / 常在）」「深み n 層」、:174「踏破」の定義に「最深の主を倒したラン（深みで力尽きても）」）、`docs/BALANCE.md`（`DEEP` / `REACH` / `LIMITS`、FLOOR_KIND から消えた 3 項目）、`docs/ARCHITECTURE.md`（`PlayerStats.reach`、step の末尾の `enforceLimits`、版の一覧）、`docs/recipes/affix.md`（「到達の軸に効く性質を足したら `REACH_DEFS[k].affixes` に 1 つ」）、`docs/recipes/boon.md`（「`per.cap` / `TemperStat.cap` は深みで外れる。外れて困る上限は手書きにする」）、`IDEAS.md` の「現状」、`docs/ideas/README.md` の P8 の行、`CHANGELOG.md`、`HANDOFF.md`。

### 10b（1 本。遊べる: 変化なし。深みを測れる）

**切る元**: 7e と 10a を取り込んだコミット（`src/qa/**` は 7e の所有だったため）。

| レーン | モデル | 所有 | 最小 Edit のみ | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| **D 深みの QA** | Sonnet | `src/qa/deepProbe.ts`（新）、`src/qa/deepProbe.test.ts`（新） | `src/qa/combatProbe.ts`（`makeArena` / `placeEnemy` / `botInput` に `export` を付けるだけ）、`src/qa/scalingMetrics.ts`（`ScalingTally` に `trimmed`、`createScalingRecorder` で `ruleRun.trimmed` の差を数え、`:266` の直後に 1 行「性能の歯止めで消した数（`ruleRun.trimmed`）: N（目標 0）」、`DeathDigest` に `temperCards`〔研鑽の札の枚数〕と `tallySum`〔`boonRun.tallies` の合計〕、死亡時の内訳の表に 2 列）、`src/qa/simulation.test.ts`（`DEEP_START_DEPTHS = [10, 20, 22]` と節の見出しの文）、`scripts/qa-probe.mjs`（`--deep` で `SIM_PROBE=deep`、`probe.md` の「## 深み」の節だけ差し替え。`--weapons` と同じ作法） | `src/system/**`、`src/loot/**`、`src/core/**` | 3-3 の D が通る。縮小版が `npm run check:fast` の中で数秒。`npm run qa:probe -- --deep` を隔離 worktree で回して 5 章の表が出る |

`deepProbe.ts` の中身:

```ts
export const DEEP_PROBE_DEPTHS: readonly number[] = [21, 22, 25, 30, 35, 40];
export interface DeepCurveRow { depth: number; enemyHp: number; enemyDamage: number; innateBudget: number; power: number; ratio: number; /** 深度 21 から追い付くのに要る相乗・研鑽の倍 = (enemyHp(d) / enemyHp(21)) ÷ (power(d) / power(21)) */ needMul: number }
export function measureDeepCurve(depths: readonly number[], seeds: readonly number[]): DeepCurveRow[]; // measureGearPower + depthHpScale / depthDamageMul / innateMeanBudget
export interface ReachOddsRow { key: ReachKey; depth: number; odds: number }
/** 到達の主な性質（REACH_DEFS[k].affixes[0]）を持つ遺物 2 つを rollTableTrait（depth = foundDepth = d、allowInversion: false）で引き、computeStats(空) に affixDef(k).apply で足して hasReach を数える */
export function measureReachOdds(depths: readonly number[], samples: number, seed: number): ReachOddsRow[];
export interface BrokenRow { depth: number; seconds: number; meanStepMs: number; maxStepMs: number; maxPlayerProjectiles: number; maxShots: number; maxEnemies: number; trimmed: number; droppedEvents: number; finite: boolean }
/**
 * 壊れたビルドの重さ: makeArena(seed, depth, "fitted") に 3 つの到達（stats.reach を閾値に）・雷鳴と灰燼と眷属の全札（grantBoon、格 5）・
 * 全ての研鑽の数え 2000 を入れ、敵 30 体（陣の役割を混ぜる）を周りに置き、bot で seconds 秒殴る。1 step の実時間（performance.now）を測る
 */
export function measureBrokenBuild(depth: number, seconds: number, seed: number): BrokenRow;
export function buildDeepSection(curve: readonly DeepCurveRow[], odds: readonly ReachOddsRow[], broken: readonly BrokenRow[]): string[]; // 「## 深み」
```

**統合（10b）**: 取り込み → `npm run check`。隔離 worktree で `npm run qa:probe -- --deep`（数分）と `npm run qa:full`（7e の後のフル QA と兼ねる）→ `probe.md` / `report.md` を本体へ。5 章の表で外れた数値は balance-tuner（`DEEP` / `REACH` / `LIMITS`、深みの傾きは `ENEMY_SCALE.deepHpGrowth / deepDamageGrowth`）。資料: `CODE_MAP.md` に `qa/deepProbe.ts` の 1 行（同じコミット）、`CLAUDE.md` のコマンド表の `qa:probe` の行に `-- --deep`（1 行の範囲で）。

---

## 5. 調整つまみと QA 指標

**つまみ（順に触る）**

1. 深みの傾き: `ENEMY_SCALE.deepHpGrowth`（1.12）/ `deepDamageGrowth`（1.04）— 7e の後に、下の「要る倍」で決める
2. 深みの積み: `DEEP.mutationEvery`（5）/ `DEEP.maxEnemiesBonus`（4）
3. 到達の閾値: `REACH.chain`（0.8）/ `burn`（7）/ `morale`（32）
4. 性能: `LIMITS.*`、壊れの実質の天井 `SYNERGY.keywordBudget`（10）

**指標**（D の `qa:probe -- --deep` と フル QA）

| 指標 | どこで | 目標 |
| --- | --- | --- |
| 追い付くのに要る倍 `needMul` | probe「深み」の曲線の表 | 深み 9 層（深度 30）で ×1.5〜2.5、19 層（40）で ×3〜6（研鑽と相乗を育てたランが深み 5〜10 層、壊れたランが 15 層以上に届く形） |
| 到達の届き方（主な性質の遺物 2 つ） | probe「深み」の到達の表 | 深度 21: 5% 未満、30: 10〜40%、40: 50% 以上（3 つが同じ帯に並ぶ） |
| 壊れの 1 step | probe「深み」の壊れの表 | 平均 1 ms 以下・最大 8 ms 以下、`finite` が全部 true。`droppedEvents` と `trimmed` の数を見て、`LIMITS` が当たるなら値か原因の効果を見直す |
| 性能の歯止めで消した数 | フル QA（`scalingMetrics`） | 0（通常のプレイで当たらない） |
| 開始深度 22 のラン | フル QA の「深く始めるラン」 | 死因の内訳で死神が 5 割以下（深みは敵の指数と戦って終わる。時計だけで終わるなら `REAPER` か深みの傾きを見る） |
| 死亡時の研鑽 | フル QA の死亡時の内訳（帯 21+） | 研鑽の札が 1 枚以上のランが深みの死亡の過半（深みまで来るビルドは研鑽を持っている）。数えの合計の中央値を記録（基準値） |
| 踏破率と深みの踏破 | フル QA（`bossLog` に最深の主） | 標準の bot で 5〜15%（boss-impl 5 章と同じ）。深みへ降りた踏破の割合を記録 |

---

## 6. 不確かな点（推奨 1 つ。★ はユーザー確認）

1. ★ **新しい表示名**（`src/` と `docs/GLOSSARY.md` で衝突なしを確認済み: 無尽 / 燎原 / 常在 は 0 件。「到達」は来歴の内部の語「到達済みの節目」があるが表示には出ていない。「連環」はスキル「連環撃」、「劫火」は真髄の名なので避けた）: 到達点 `無尽`（連鎖）/ `燎原`（燃焼）/ `常在`（戦意）、効果の頁の語 `到達`、右上の `深み n 層`（`run-arc.md` 0 章の案）、浮き文字 `深み`、ログ「深みに入った。祝福・遺物の『最大』が外れる。」、効果の頁の `（深み: 最大なし）`。→ 推奨: この案で確定し、GLOSSARY の「設計上の用語」に到達 3 つ、「部屋・フロア」の「無限の深み」の行を書き直す
2. ★ **踏破を「最深の主を倒したラン」で数える**（2-6。深みへ降りて力尽きても・離脱しても、履歴の終わり方が「踏破」になり、踏破の回数・最高位階・位階の見返り・実績に入る。過去の履歴は数え直さない）。→ 推奨: そうする（深みへ降りると位階の見返りを失う、では深みが「物差し」にならない）。代案の「地上への道で終えたときだけ」は今の挙動
3. ★ **深みの回転のボス 5 体（骸骨卿・双子の騎士・霜の巨人・群れの母・図書館の司書）の作り直しを段取り 10 に入れない**。`boss-impl.md` 6 章 3 は「共通の規則 1〜4・6 は段取り 10 で」としていたが、core-synthesis 9 章の段取り 10 の中身（敵の指数・研鑽・到達点・壊れ）に無く、8b と同じ規模（5 レーン）になる。→ 推奨: 10b の QA で深みの到達の分布（深度 25 に届くランの割合）を見てから、別の段「深みの主」として `docs/ideas/README.md` に残す
4. **狂乱の月を変異から外す**（2-1）。予備動作を縮める変異は build-core 3-2「速さでは難しくしない」に反する。→ 推奨: 外す（階の枠のランイベントとしては残る）。確認: `runEvents.test.ts` の「変異に狂乱の月は入らない」
5. **変異の起点 30 → 22、間隔 10 → 5**。起点は章の定義（21 以降は深み）に合わせ、間隔は深みの 1 ランが 5〜10 層で終わる見込みで「1〜2 つは見る」ため。→ 推奨: そうする。10b で開始深度 22 のランの到達を見て `DEEP.mutationEvery` を直す
6. **到達点の閾値**（0.8 / 7 / 32）は試算（1 章）から。3 つ目の出所（転じ `cv_critToChain`・名のある遺物・誓約の装備）で早く届く組み合わせがある。→ 推奨: この値で入れ、10b の到達の表と実プレイで直す（`REACH.json` だけ）
7. **到達に名のある遺物・誓約（装備に付いたもの）の足しも数える**（`computeStats` の中で畳むので自然に入る。祭壇の誓約・起点は入らない）。→ 推奨: そうする（どれも装備の厳選の結果）。確認: `reach.test.ts` の「装備だけで決まる」
8. **深みで「最大」が外れることは札・遺物の説明文に書かない**（説明文は生成時の固定の文字列。効果の頁の `（深み: 最大なし）`・ログ・Tips で伝える）。→ 推奨: そうする。遺物のツールチップの「上限 X%」は章の間の値として正しい
9. **`LIMITS` の初期値**（256 / 192 / 32）は根拠の実測が無い。→ 推奨: この値で入れ、10b の壊れの表の最大値の 2 倍以上を保つように直す。通常の QA で `trimmed` が 0 でなければ値を上げる
10. **深みで研鑽が追い付く速さ**: 研鑽の倍は数えに比例（線形）、敵は指数。札 k 枚の積で多項式に伸びるので、深み何層で止まるかは札の枚数と数えの溜まる速さで決まる。→ 推奨: 10b の「死亡時の研鑽」と `needMul` を見て、深すぎ / 浅すぎなら研鑽の札の `every`（`balance/boons/**`）ではなく深みの傾き（つまみ 1）で合わせる（章の間の釣り合いを動かさない）

## 参照（絶対パス）

- 仕様: `/home/user/roguelike/docs/ideas/core-synthesis.md`（3-1・3-13・3-14・5-3・9 章）、`/home/user/roguelike/docs/ideas/build-core.md`（柱 3・柱 4・3-2・5-1〜5-3・10 章 P8・11 章 6）、`/home/user/roguelike/docs/ideas/scaling-impl.md`（2-3・6 章 1）、`/home/user/roguelike/docs/ideas/relics-7d-plan.md`（9 章 4）、`/home/user/roguelike/docs/ideas/boon-impl.md`（到達点の行）、`/home/user/roguelike/docs/ideas/run-arc.md`（0 章・1-4）、`/home/user/roguelike/docs/ideas/boss-impl.md`（6 章 3）、`/home/user/roguelike/docs/ideas/meta-impl.md`（2-2・2-6）
- コード: `/home/user/roguelike/src/core/scale.ts`、`/home/user/roguelike/src/data/enemies.ts`、`/home/user/roguelike/src/system/chapters.ts`、`/home/user/roguelike/src/system/floor.ts`、`/home/user/roguelike/src/system/runEvents.ts`、`/home/user/roguelike/src/system/modifiers.ts`、`/home/user/roguelike/src/system/boons.ts`、`/home/user/roguelike/src/system/player.ts`、`/home/user/roguelike/src/system/rules.ts`、`/home/user/roguelike/src/system/statusEffects.ts`、`/home/user/roguelike/src/system/morale.ts`、`/home/user/roguelike/src/loot/types.ts`、`/home/user/roguelike/src/loot/stats.ts`、`/home/user/roguelike/src/loot/affixes.ts`、`/home/user/roguelike/src/loot/flux.ts`、`/home/user/roguelike/src/loot/generator.ts`、`/home/user/roguelike/src/loot/innate.ts`、`/home/user/roguelike/src/ui/effectsList.ts`、`/home/user/roguelike/src/ui/statusTab.ts`、`/home/user/roguelike/src/ui/title.ts`、`/home/user/roguelike/src/meta/deathReport.ts`、`/home/user/roguelike/src/meta/tips.ts`、`/home/user/roguelike/src/render/runUi.ts`、`/home/user/roguelike/src/main.ts`、`/home/user/roguelike/src/core/game.ts`、`/home/user/roguelike/src/core/events.ts`、`/home/user/roguelike/src/core/units.ts`、`/home/user/roguelike/src/system/combat.ts`、`/home/user/roguelike/src/system/effects.ts`、`/home/user/roguelike/src/qa/gearPower.ts`、`/home/user/roguelike/src/qa/combatProbe.ts`、`/home/user/roguelike/src/qa/scalingMetrics.ts`、`/home/user/roguelike/src/qa/simulation.test.ts`、`/home/user/roguelike/scripts/qa-probe.mjs`
- 一時の計測: `/tmp/claude-0/-home-user-roguelike/2553a57b-5dae-5906-9d72-b7c7b7dc0b26/scratchpad/deep.test.ts`（深みの地力）、`reach2.mjs`（到達の試算）
