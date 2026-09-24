# 祝福の底上げ設計: 芯（核）× 格 × 取得機会

作成日: 2026-09-24
前提: `CLAUDE.md`、`docs/DESIGN_PRINCIPLES.md`（9 層の住み分け / 7 ゴール装備を作らない）、`docs/recipes/boon.md`、`docs/STATS_AND_SCALING.md`、`docs/ideas/boons-expansion.md`、`src/system/boons.ts`、`src/system/boonDefs.ts`、`src/system/boonDefsWave2.ts`、`src/system/boonRules.ts`、`src/system/rules.ts`、`src/core/rules.ts`、`src/data/balance/boons.json`、`src/render/boonUi.ts`、`src/loot/stats.ts`、`src/loot/flux.ts`、`src/loot/generator.ts`、`src/data/enemies.ts`、`src/qa/report.md`（0.0.11α フル QA）を読んだ。
別レーンが `player.ts` / `weapons.ts` / `weaponArts.ts` を触るので、本設計はそれらを **編集しない**。バースト（奥義）関連の祝福の読み替えは後回し。

---

## 0. 結論（3 行）

1. 祝福が弱いのは「1 つの祝福 ≒ 装備の性質 1 個分（+10〜25%、状況限定）」なのに、ランで 2〜9 個しか取れず、深度が進んでも中身が一切成長しないから（装備は深度 5 → 20 で性質 1 個あたり 12.7% → 36.8%、個数も 8 → 17 に伸びる）。
2. 推奨は **「芯（核）× 格 × 取得機会」の 1 パッケージ**: ランの最初（深度 2）に遊び方を決める大型の「芯の祝福」を 3 択で 1 つ、以後の祝福は提示ごとに **格（並 / 大祝福 / 神威）** を抽選して効果量 ×1 / ×1.5 / ×2.2、深いほど高い格が出る。試練・ボス階後・呪い 4 択の 4 枚目は格が 1 段上がる。取得機会は試練の部屋の制圧でも必ず出すようにして 1 階あたり約 1.35 回にする。
3. 装備側は触らない（`FLUX.globalScale` 0.8 で既に抑えている）。祝福の数値は `foldBoonStats` がソフトキャップの **後** に掛かるので、芯の倍率もソフトキャップの外にそのまま置ける。

---

## 1. 現状診断

### 1-1. 装備の伸び（深度別・攻撃系の目安）

数値の出どころ: `src/data/balance/loot.json` `affixCurves.meleeDamagePct` / `attackSpeed`（点列の中央値を線形補間）× `powerScaleAt(depth)`（`src/loot/flux.ts:49-80`。globalScale 0.8 × depthScale 0.75〜1.0）。性質数は `rollTraitCount`（`src/loot/generator.ts:71-74`: 期待値 = min(1 + 0.12 × depth, 3.5)）× 5 部位（`LOOT_SLOTS`、`src/loot/types.ts:20`）。

| 深度 | 近接ダメ +% / 性質 1 個 | 攻撃速度 +% / 性質 1 個 | 性質数（5 部位合計の期待値） | 攻撃系を 4 割とした攻撃倍率の目安 | 敵の生命倍率（`depthHpScale`、`src/data/enemies.ts:371`） |
| --- | --- | --- | --- | --- | --- |
| 1 | 5.4 | 1.5 | 5.6 | ×1.12 | ×1.00 |
| 5 | 12.7 | 4.2 | 8.0 | ×1.40 | ×1.72 |
| 10 | 23.0 | 7.2 | 11.0 | ×2.0（ソフトキャップの縁） | ×2.62 |
| 20 | 36.8 | 10.8 | 17.0 | 生値 ×3.5 → ソフトキャップ後 ×2.8（`softCap`、`src/loot/stats.ts:147-151`） | ×4.42 |

- これに最大生命・ステータス配分（`runAttributes`）・共鳴・誓約・トリガー性質が乗る。装備は **永続** で、ランをまたいで単調に積み上がる
- ソフトキャップは `computeStats` の中（`src/loot/stats.ts:247`）。祝福は `applyStats`（`src/system/player.ts:157-167`）で **その後の `derived` に畳み込む** ので、`foldBoonStats` の倍率はソフトキャップの外

### 1-2. 祝福 1 つの影響

- 抽選: `boonWeight`（`src/system/boons.ts:218-236`）で `rarity` は **重みにしか使われない**（common 60 / rare 30 / epic 10）。「極稀」でも強くない。カードの副題も希少度を出しているだけ（`src/render/boonUi.ts:99-133`）
- 効果量: Rule 型は `magnitude × scaleBy`（`slashBase` = 近接 1 段目の装備込み威力、`src/system/boonRules.ts:197`）。倍率は 0.4〜0.8（爆走 0.8 / 断裂波・連撃波 0.6 / 会心雷撃 0.5 / 抜き胴 0.6 …）で、**深度に依らず一定**。装備が伸びた分だけ比例して伸びるが、装備を超えては伸びない
- 回数の上限: Rule は ICD ≥ 0.1（`BOON.ruleMinIcd`）、語ごとの回数 6 回 / 1 秒（`SYNERGY.keywordBudget`）、連鎖は深さごとに ×0.5（`SYNERGY.chainDecay`、`src/system/rules.ts:201`）。旧フックから移した `direct` の Rule は減衰なし（`src/system/rules.ts:182`）
- 数値型（`foldBoonStats`、`src/system/boons.ts:473-500`）は 10 個程度で、ほとんどが代償つき（連射狂い ×2 連射 / ×0.65 威力 = 実質 +30%、硝子の見切り 最大生命 1 など）
- 体感の目安: 常時型の 1 つで +10〜25%、条件が揃った瞬間に +40〜60%（コンボ 20 以上の連撃波など）。**装備の性質 1〜2 個分**。ランごとに深度 1 → 10 で装備が ×1.1 → ×2.0 と伸びる間、祝福 1 つの中身は変わらない

### 1-3. ランあたりの取得数

- 提示は「新しい階に階段で降りた直後」だけ（`src/system/floor.ts:785-789`、depth 2 以降 `src/system/boons.ts:304-311`）。1 階につき 1 回
- 追加の機会: 闘技場・鏡の制圧（`src/system/specialRooms.ts:956, 970`）、呪いの祠（同 :761-767、深度 3・6）、契約「無傷」の報酬（`src/system/contractors.ts:411-415`）、ランイベント「流れ星」（引き直し、`src/system/runEvents.ts:1123-1133`）、祝福「試練の徒」（試練の制圧で 1 回）。いずれも頻度が低い
- 0.0.11α フル QA（`src/qa/report.md`）: 平均到達深度 2.27〜3.53 → **ランあたり 1〜2.5 個**。人が深度 8 まで潜っても 7〜8 個。Hades は 1 ランで 15〜20 個 + レベル上げ（Pom）
- 既存の QA の切り分け（`src/qa/report.md:291`）: `offerBoons` を no-op にしても怯み発生 −11.6%。祝福全体を消しても指標がその程度しか動かない = 影響力が小さいことの裏付け

### 1-4. 「ローグライク感が薄い」の構造

- ランの方向性を決めるものが **ラン開始前の起点（`runSetup.ts` ORIGINS）と永続装備** にあり、ラン中に決まるものが無い。祝福は「装備タグに合うものが出る」（`tagBonus` 1.5）ので、装備が同じなら同じ系統の祝福が並びやすく、味が変わらない
- 系譜（4 段）・結び（2 つ揃うと出る）は「育つ」仕組みだが、1 ランに 2〜8 個しか取れないので段が揃う前に終わる

---

## 2. 方針（推奨 1 案）

### 「芯 × 格 × 機会」

| 柱 | 中身 | 効き方 |
| --- | --- | --- |
| **芯（core）** | 深度 2 の最初の提示は **芯の祝福だけの 3 択**（呪い枠なし）。1 ランに 1 つ。遊び方そのものを変える大型のルール変更 + 代償。芯のタグに合う祝福は以後の重みが ×2 | ランの方向性が **ラン中に** 決まる。同じ装備でも芯が違えば別の遊び。「毎回違う味」の源 |
| **格（grade）** | 提示ごとに札 1 枚ずつ格を抽選。並（1）/ 大祝福（2）/ 神威（3）。Rule の効果量 ×1 / ×1.5 / ×2.2、半径 ×1 / ×1.2 / ×1.4、神威は ICD ×0.6。深いほど高い格が出る。試練の部屋・ボス階の直後・呪い 4 択の 4 枚目・試練の徒は格 +1 | 祝福が **深度で成長** し、装備曲線（性質 1 個 12.7% → 36.8%）と同じ向きに伸びる。装備 × 格の掛け算なので装備を超えて伸びる |
| **機会** | 試練の部屋の制圧で必ず 3 択（今は試練の徒を持つときだけ）。芯の提示は通常の階段の提示とは別枠（深度 2 は芯 → 深度 3 から通常） | 1 階あたり 1 + 0.35（試練の出現率 `ROOM_KIND.challengeChance`）≒ 1.35 回。深度 10 で 12〜13 個 |

理由（3 文）: 祝福を「装備と同じ数値の山」にすると原則 9（数値盛りではなくルール変更）に反してハクスラ感が増すだけなので、**強さは格（提示ごとの抽選）で、方向性は芯で** 分けて持たせる。格は Rule の `magnitude` に 1 か所（`applyRuleEffect`）で掛かるので 180 種すべてに一度に効き、新しい祝福を足すごとに調整が要らない。芯は起点（ラン前・メタ）と違って **ラン中の抽選で決まる** ので、装備を変えなくてもランの味が変わる。

期待値の試算（格の抽選 2-1 の数値で）: 深度 5 の提示は 並 59% / 大 32% / 神威 9% → 効果量の期待倍率 **×1.27**、深度 10 で 並 29% / 大 52% / 神威 19% → **×1.49**。祝福の威力は `slashBase`（装備比例）× 格なので、装備が ×1.4 → ×2.0 と伸びる同じ区間で祝福は ×1.8 → ×3.0 と伸びる。加えて個数が 5 → 13 個。

却下した案（各 1 行）:
- 数値型の一律の底上げ（ブロックごとに ×2 など）: 深度 1 から強くなり序盤の「ヌルゲー化」（memo 2026-09-24）を再燃させる。深度で伸びないので根本は解けない
- 装備側を相対的に抑える: 既に `FLUX.globalScale` 0.8 で抑えており、永続装備の価値を下げるだけでローグライク感は増えない
- 祭壇の部屋（boons-expansion 4-12）で機会を増やす: `RoomKind` の union（`core/state.ts`）・ミニマップ・部屋生成を触る M 規模。試練の制圧を確定枠にすれば同じ効果が 1 行で出る
- 同じ祝福の重ね取りで昇格（Pom 型）: 3 択に取得済みを再び並べる抽選と表示の作り直しが要り、格の抽選と効果は同じ。格の方が安い
- 相乗効果の可視化だけ: 既に印（潤い / 受け皿 / 新たな流れ）と流れの行があり、弱さの解決にならない

---

## 3. 具体的な変更リスト

### 3-1. `src/data/balance/boons.json` `BOON` ブロックへ足す値

| key | 値 | 用途 |
| --- | --- | --- |
| `gradeMagnitudeMul` | `[1, 1.5, 2.2]` | 格ごとの効果量倍率（添字 = 格 − 1） |
| `gradeRadiusMul` | `[1, 1.2, 1.4]` | 半径を持つ効果の倍率 |
| `gradeIcdMul` | `[1, 1, 0.6]` | Rule の ICD 倍率（神威だけ短い。`ruleMinIcd` は下限として残す） |
| `gradeGrandBase` / `gradeGrandPerDepth` / `gradeGrandMax` | `0.2` / `0.04` / `0.6` | 大祝福の確率 = min(max, base + perDepth × (depth − 2)) |
| `gradeDivineBase` / `gradeDivinePerDepth` / `gradeDivineMax` | `0.03` / `0.02` / `0.3` | 神威の確率（先に判定し、外れたら大祝福を判定） |
| `gradeBoostChallenge` / `gradeBoostAfterBoss` / `gradeBoostCurseCard` / `gradeBoostTrialSeeker` | `1` / `1` / `1` / `1` | 格の下駄（抽選結果に足して 3 で止める） |
| `gradeColor` | `{ "grand": "#ffd75f", "divine": "#ff9ce0" }` | カード枚・浮き文字の色（並は今の `rarityColor` のまま） |
| `coreDepth` / `coreChoiceCount` / `coreTagBonus` | `2` / `3` / `2` | 芯の提示深度・枚数・芯のタグに合う祝福の重み倍率 |
| `glassHeartHpMul` / `glassHeartDamageMul` | `0.5` / `1.5` | 芯: 硝子の心 |
| `curseEaterGradeShiftPerCurse` / `curseEaterMaxShift` | `0.15` / `0.45` | 芯: 呪い喰い（呪い付き 1 つごとに大祝福・神威の確率へ加算） |
| `tempoPerStack` / `tempoCap` / `tempoWindowMul` | `0.02` / `0.8` / `0.6` | 芯: 拍の刻（`comboDamagePerStack` / `comboDamageCap` を上書き、猶予 ×0.6） |
| `bloodLoopLifeOnHit` | `6` | 芯: 血の巡り（`lifeOnHit` +6、`hpRegen` 0、ハート無効） |
| `manaTideMaxMul` / `manaTideGainMul` | `2` / `2` | 芯: 満ち潮の器（`maxMana` ×2、`manaGainMul` ×2、`manaRegen` 0） |
| `mirageCharges` / `mirageCooldownMul` / `mirageBlastRatio` / `mirageBlastRadius` / `mirageMoveMul` | `2` / `0.6` / `0.6` / `24` / `0.8` | 芯: 逃げ水 |
| `ironGiantPoiseMul` / `ironGiantKnockbackMul` / `ironGiantHpMul` / `ironGiantAttackSpeedMul` / `ironGiantMoveMul` | `2` / `2` / `1.5` / `0.7` / `0.85` | 芯: 鉄の巨人 |
| `plagueEaterStatuses` / `plagueEaterPotencyMul` / `plagueEaterHpMul` | `2` / `1.5` / `0.8` | 芯: 病み喰い |
| `firePillarRatio` / `firePillarRadius` | `0.6` / `32` | 火柱 |
| `boltDropCount` / `boltDropDamage` | `3` / `6` | 雷落とし（`statFloor: "shockDamage"`） |
| `bloodVeinRadius` | `40` | 血脈 |
| `surgeDamagePct` / `surgeTime` | `30` / `6` | 猛り |
| `tailwindPct` / `tailwindTime` | `20` / `3` | 追い風 |
| `woundReplyRatio` / `woundReplyRadius` | `0.8` / `40` | 疵の返礼 |
| `eliteHuntVulnerable` | `3` | 精鋭狩り（脆弱の秒） |
| `shadowStitchRadius` / `shadowStitchFear` | `48` / `1` | 影縫い |
| `iceStepRadius` / `iceStepTime` | `14` / `5` | 氷の足跡 |
| `counterBlastRatio` / `counterBlastRadius` | `0.7` / `28` | 逆撃 |

既存の値は変えない（`cursedChance` 0.4、`rarityWeight`、`tagBonus` はそのまま）。`_note` に「格は Rule の magnitude / radius / icd に掛かる。呪い付きは格を持たない」を追記。

### 3-2. 型とデータの置き場所

- `src/system/boonGrade.ts`（新規、Lane A 所有。純関数中心）
  - `export type BoonGrade = 1 | 2 | 3;` `export const BOON_GRADES`、`export const BOON_GRADE_LABEL: Record<BoonGrade, string> = { 1: "", 2: "大祝福", 3: "神威" }`（表示文字列は TS。`docs/GLOSSARY.md` に 1 行）
  - `export function rollGrade(rng: Rng, depth: number, boost: number, shift: number): BoonGrade`（神威 → 大祝福の順に判定、boost を足して 3 で止める）
  - `export function isGraded(def: BoonDef): boolean` = `def.graded ?? (!def.cursed && (def.rules?.some(r => r.then.magnitude > 0) ?? false))`（Rule 型は自動、フック型は `graded: true` で opt-in、呪い付きは常に格なし）
  - `export function gradeMagnitudeMul(grade) / gradeRadiusMul(grade) / gradeIcdMul(grade)`
- `BoonDef`（`src/system/boonDefs.ts:219-245`、Lane A が最小 Edit で 2 行）: `core?: true`（芯。通常の 3 択には出ない）/ `graded?: boolean`（格の対象を明示。省略時は `isGraded` の自動判定）
- `BoonChoice`（`src/system/boons.ts:73-85`）: `grades: BoonGrade[]`（options と同じ長さ）/ `core: boolean`（芯の提示か）
- `BoonRunState`（`src/system/boons.ts:88-105`）: `grades: Partial<Record<BoonKey, BoonGrade>>`（取得済みの格。`state.boons: BoonKey[]` は変えない。`hasBoon` / `includes` の 30 か所以上に波及させない）/ `gradeBoost: number`（次の提示で 1 回だけ使う下駄。試練の制圧・ボス階の直後で積む）
- `grantBoon(state, key, grade: BoonGrade = 1)`: 既存の呼び出し（呪いの祠 `specialRooms.ts:764`、契約）は引数なしで並のまま
- 格の適用点は **1 か所**: `applyRuleEffect`（`src/system/rules.ts:208-212`）で `rule.owner.kind === "boon"` なら `state.boonRun.grades[rule.owner.key]` を見て magnitude に `gradeMagnitudeMul`、`effect.radius` に `gradeRadiusMul` を掛ける。ICD は `tryDirectRule` / `runRule` が `state.ruleIcd.set(..., rule.icd)` する所（`rules.ts:175` ほか）で `× gradeIcdMul`、下限 `BOON.ruleMinIcd`
- フック型・数値型の格: `export function boonGradeMul(state, key): number` を `boonGrade.ts` に置き、`boonRules.ts` の倍率を持つ祝福（奪弾 `stealDamageMul` / 跳ね弾 `ricochetDamageMul` / 通り斬り `passCutRatio` / 落雷予告 `markRatio` / 燕飛び `swallowRatio` / 属性の轍 `trailBurnDps` / 睨み `glareTime` / 威圧 `intimidateRadius` / 静寂の間 `quietHallCostMul` / 連射狂い（fold））が読む。読む祝福に `graded: true` を付ける。残りは並のまま（カードにも格が出ない）で、次の波で順に足す

### 3-3. 芯の抽選と提示

- `offerBoons`（`boons.ts:304-311`）: `state.depth === BOON.coreDepth` かつ `state.boons` に `core` が無ければ `rollCoreOptions`（`core: true` の候補だけ、呪い枠なし、`coreChoiceCount` 枚、重みは `boonWeight` と同じ）。それ以外は今の `rollBoonOptions`（`core: true` を除く）。芯を持っていれば `boonWeight` で `def.tags` が芯のタグと 1 つでも重なる候補に `coreTagBonus` を掛ける
- 芯の提示中は「呪いを受けて 4 択」の札を出さない（`canTakeCurse` が `c.core` で false）
- 格の下駄: `offerBoons` は `boost = state.boonRun.gradeBoost + (isBossDepth(state.depth - 1) ? BOON.gradeBoostAfterBoss : 0)` を使い、使ったら `gradeBoost = 0`。`takeCurse` の 4 枚目は `boost + gradeBoostCurseCard`。試練の制圧（`specialRooms.ts` `clearSpecialRoom` に `case "challenge"`）は `gradeBoost += gradeBoostChallenge` してから `offerBoons`。試練の徒（`boonDefs.ts:1315`）は「試練の 3 択の格がもう 1 段上がる」に変える（今の `offerBoons` 効果は試練の確定枠と重複する）

### 3-4. 新しい祝福 18 種（芯 8 + 格を活かす通常 10）

定義は `src/system/boonDefsWave3.ts`（新規）。`kw` の語・`gives` は既存の語彙から。

| key | 名前 | 種別 | 効果（1 行） | 代償 | 使う仕組み |
| --- | --- | --- | --- | --- | --- |
| `coreGlassHeart` | 硝子の心 | 芯 | 近接・射撃・スキルの威力 ×1.5 | 最大生命 ×0.5 | `foldCoreStats`（`meleeDamageMul` / `rangedDamageMul` / `skillDamageMul` / `maxHp`）。ソフトキャップの外 |
| `coreCurseEater` | 呪い喰い | 芯 | 以後の 3 択は必ず呪い付きが 1 枚混ざり、持つ呪い付き 1 つごとに大祝福・神威が出やすい（+15%、上限 +45%） | 呪い付きを手放せない（流れ星・契約の除去から除外） | `rollBoonOptions` の `wantCursed` を強制、`rollGrade` の `shift` |
| `coreTempo` | 拍の刻 | 芯 | コンボ 1 段ごとに与ダメ +2%（上限 +80%） | 被弾でコンボ 0、コンボ猶予 ×0.6 | `foldCoreStats`（`comboDamagePerStack` / `comboDamageCap` / `comboWindowBonus`）+ Rule `onHurt → resetCombo` |
| `coreBloodLoop` | 血の巡り | 芯 | 与ダメの 6% を生命として回収（戦闘中の回復上限は受ける） | 生命の自然回復 0、ハートを拾えない | `foldCoreStats`（`lifeOnHit` / `hpRegen`）+ `floor.ts:770` の `heartsAllowed` に `hasBoon` 1 行 |
| `coreManaTide` | 満ち潮の器 | 芯 | 最大気力 ×2、通常攻撃の気力回収 ×2 | 気力の自然回復 0 | `foldCoreStats`（`maxMana` / `manaGainMul` / `manaRegen`） |
| `coreMirage` | 逃げ水 | 芯 | ダッシュ回数 +2、再使用 ×0.6、ダッシュの終わりに爆発（1 段目の 60%） | 移動速度 ×0.8 | `foldCoreStats`（`dashCharges` / `dashCooldownMul` / `moveSpeedMul`）+ Rule `onDashEnd → explode` |
| `coreIronGiant` | 鉄の巨人 | 芯 | 怯み値 ×2、ノックバック ×2、最大生命 ×1.5 | 攻撃速度 ×0.7、移動 ×0.85 | `foldCoreStats`（`poiseDamageMul` / `knockbackMul` / `maxHp` / `attackSpeedMul` / `moveSpeedMul`） |
| `corePlagueEater` | 病み喰い | 芯 | 状態異常を 2 種以上持つ敵への攻撃は必ず会心、付ける状態異常の効果量 ×1.5 | 最大生命 ×0.8 | `boonForcesCrit`（`boonRules.ts:904`）に 1 分岐 + `foldCoreStats`（`statusPotencyMul` / `maxHp`） |
| `firePillar` | 火柱 | 通常 | 燃焼中の敵を倒すと半径 32 に爆発（1 段目の 60%） | - | Rule `onKill × targetHas burn → explode`、`requires: "burn"`、`gives: ["explode"]` |
| `boltDrop` | 雷落とし | 通常 | 見切ると照準先から連鎖雷 3 回 | - | Rule `onJustDodge × from player → chainLightning count 3 statFloor shockDamage` |
| `bloodVein` | 血脈 | 通常 | 出血中の敵への会心で出血が周囲へ広がる | - | Rule `onCrit × targetHas bleed → spreadStatus bleed radius 40 inherit` |
| `surgeOfBattle` | 猛り | 通常 | 封鎖・交戦の開始から 6 秒、与ダメ +30% | - | Rule `onRoomLock → damageBuff 30 duration 6`（`PlayerBuffs.damage`、`triggers.ts:170`） |
| `tailwind` | 追い風 | 通常 | 撃破ごとに 3 秒、移動速度 +20% | - | Rule `onKill → speedBuff 20 duration 3` |
| `woundReply` | 疵の返礼 | 通常 | 被弾すると自分の周りに衝撃波（1 段目の 80%） | - | Rule `onHurt → shockwave radius 40` |
| `eliteHunt` | 精鋭狩り | 通常 | 精鋭への命中で脆弱 3 秒 | - | Rule `onMeleeHit / onRangedHit × targetElite → inflict vulnerable`、`gives: ["vulnerable"]` |
| `shadowStitch` | 影縫い | 通常 | 恐怖中の敵を倒すと半径 48 の敵に恐怖 1 秒 | - | Rule `onKill × targetHas fear → nearbyEnemies status fear`、`requires: "fear"` |
| `iceStep` | 氷の足跡 | 通常 | ダッシュの終点に氷床（5 秒） | - | Rule `onDashEnd → placeTerrain ice radius 14 duration 5`、`gives: ["terrain", "chill"]`（氷滑り・氷上の舞と噛む） |
| `counterBlast` | 逆撃 | 通常 | カウンターヒットで爆発（1 段目の 70%） | - | Rule `onCounter → explode radius 28` |

- 芯 8 種は `core: true`、`graded: false`（芯の強さは固定。格は通常の祝福の軸）
- 通常 10 種はすべて Rule 型なので格が自動で効く（`isGraded` の自動判定）。神威の火柱 = 1 段目の 132% × 半径 45 で、装備 × 格の掛け算が見える見本になる
- `firePillar` / `shadowStitch` の `requires` は既存どおり装備・スキル石のタグだけを見る（祝福が出すタグでは満たせない）。芯の `gives` は使わず、`coreTagBonus` で寄せる
- `onBurst` を起点にする祝福は入れない（奥義の作り直しレーンと衝突する）

### 3-5. 表示（`src/render/boonUi.ts`）

- `cardSubtitle`（`boonUi.ts:127-133`）の希少度ラベル（通常 / 希少 / 極稀）を **格の表示に置き換える**: 並は今までどおり系譜・結び・呪い付きの注記だけ、大祝福・神威はその語を先頭に付け、枚の色を `gradeColor` にする。`rarity` は内部の重みに戻す（`docs/GLOSSARY.md:317` を直す）
- 芯の提示は見出しに「探索の芯を選ぶ」の 1 行（`drawBoonChoice` の先頭）。芯のカードは `icon` を大きく、副題「芯 ・ 1 回の探索に 1 つ」
- HUD（`drawBoonHud` / `drawTooltip`）: 芯は先頭に固定表示、格 2 以上のアイコンに `gradeColor` の枠。ツールチップの説明の末尾に「大祝福: 効果量 ×1.5」の 1 行（単一指標ではなく「何が増えるか」の文で）
- 取得時の浮き文字（`grantBoon`、`boons.ts:462`）は格の色。効果音は既存の `boonSelect` を使い、神威だけ `lootRare` を重ねる（新しい効果音名は足さない）

---

## 4. 実装レーン（3 本、ファイル所有）

共有ファイル（`core/state.ts` / `core/game.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts` / `system/combat.ts`）はどのレーンも触らない。`player.ts` / `weapons.ts` / `weaponArts.ts` は編集禁止。

### Lane A: 格と抽選（Sonnet 可。設計は本書で確定）

- 所有: `src/system/boonGrade.ts`（新規）、`src/system/boons.ts`、`src/system/boons.test.ts`、`src/data/balance/boons.json`（`BOON` ブロックへの追加のみ。3-1 の表を全部このレーンが入れる。Lane B の値も含めて一度に足し、B は読むだけ）
- 最小 Edit のみ: `src/system/rules.ts`（`applyRuleEffect` の格の倍率 / ICD の倍率）、`src/system/boonDefs.ts`（`BoonDef` に `core?` / `graded?` の 2 行、`trialSeeker` の効果を格 +1 に）、`src/system/specialRooms.ts`（`clearSpecialRoom` に `case "challenge"`）、`src/system/contractors.test.ts:401`（`boonChoice` の直書きに `grades` / `core` を足す）
- 編集禁止: `boonRules.ts`、`boonDefsWave2.ts`、`render/**`、`qa/**`
- 公開する関数と型: `BoonGrade` / `BOON_GRADES` / `BOON_GRADE_LABEL` / `rollGrade` / `isGraded` / `gradeMagnitudeMul` / `gradeRadiusMul` / `gradeIcdMul` / `boonGradeMul(state, key)` / `boonGradeOf(state, key): BoonGrade`、`grantBoon(state, key, grade = 1)`、`BoonChoice.grades` / `BoonChoice.core`、`BoonRunState.grades` / `BoonRunState.gradeBoost`、`rollCoreOptions(state)`、`offerBoons` の芯分岐
- テスト（`boons.test.ts`、it 名）: 「格は深いほど高いものが出やすい（深度 2 と深度 10 で 1000 回引いた分布）」「呪い付きの札は格を持たない」「Rule の効果量は格で ×1.5 / ×2.2 になる（爆走の爆発ダメージで確認）」「神威の Rule は ICD が短くなるが ruleMinIcd を下回らない」「試練の部屋の制圧で 3 択が開き、格の下駄が 1 回だけ効く」「ボス階の直後の提示は格の下駄が乗る」「呪いを受けて足した 4 枚目は格の下駄が乗る」「深度 2 の最初の提示は芯だけの 3 択で呪いの札が出ない」「芯を持つと同じタグの祝福の重みが coreTagBonus 倍になる」「芯を持っていれば通常の 3 択に芯は出ない」「同じ seed なら格の列も同じ（決定性）」
- 完了条件: `npx vitest run src/system/boons.test.ts src/system/rules.test.ts src/core/replay.test.ts` が通り、`npx tsc --noEmit` が通る。`BOON` に足した key はすべて `_note` に単位を書く

### Lane B: 芯と新祝福 18 種（Sonnet 可）

- 所有: `src/system/boonDefsWave3.ts`（新規。18 種の定義）、`src/system/boonCores.ts`（新規。`foldCoreStats(stats, boons): PlayerStats`、`coreCursedForced(state)`、`coreGradeShift(state)`）、`src/system/boonRules.ts`（`boonForcesCrit` の病み喰い分岐、格を読む倍率の `boonGradeMul` 適用 10 種）、`src/system/boonRules.test.ts`
- 最小 Edit のみ: `src/system/boonDefs.ts`（`BOON_KEYS` に `...BOON_KEYS_WAVE3` の 1 行、`BOONS` に `...BOONS_WAVE3` の 1 行。Lane A の Edit と行が離れているので `old_string` は短く）、`src/system/boons.ts`（`foldBoonStats` の末尾直前に `foldCoreStats` の呼び出し 1 行、`rollBoonOptions` の `wantCursed` に `coreCursedForced` の 1 項、`rollGrade` の `shift` 引数に `coreGradeShift`。**Lane A が先に着地してから**）、`src/system/floor.ts:770`（ハート無効の 1 項）、`src/system/runEvents.ts:1124` と `src/system/contractors.ts:572` 付近（呪い喰いの間は呪い付きを除去しない 1 項）
- 編集禁止: `rules.ts`、`boonGrade.ts`、`render/**`、`qa/**`、`player.ts`、`weapons.ts`、`weaponArts.ts`
- 公開する関数: `BOON_KEYS_WAVE3` / `BOONS_WAVE3`、`foldCoreStats`、`coreCursedForced`、`coreGradeShift`、`ownedCore(state): BoonDef | null`
- テスト（`boonRules.test.ts`、it 名）: 「硝子の心は近接・射撃・スキルの倍率を ×1.5 にし最大生命を半分にする（ソフトキャップの後に掛かる）」「拍の刻はコンボ段ごとの倍率を上書きし、被弾でコンボが 0 になる」「血の巡りはハートを拾えず自然回復が 0」「満ち潮の器は最大気力 ×2 で自然回復 0」「逃げ水はダッシュの終わりに爆発する」「鉄の巨人は怯み値 ×2 で攻撃速度が落ちる」「病み喰いは状態異常 2 種の敵への攻撃が必ず会心になる」「呪い喰いは 3 択に必ず呪い付きが 1 枚混ざる」「火柱は燃焼中の敵の撃破でだけ爆発する」「雷落としは回避の見切りでだけ連鎖雷を出す（受け流しのスキルでは出ない）」「血脈は出血中の敵への会心で出血が広がる」「猛りは交戦開始から 6 秒だけ与ダメが上がる」「精鋭狩りは精鋭にだけ脆弱を付ける」「影縫いは恐怖中の敵の撃破で周囲に恐怖」「氷の足跡はダッシュの終点に氷床を置く」「逆撃はカウンターヒットで爆発する」「格を読むフック型 10 種は大祝福で倍率が 1.5 倍になる（奪弾の弾ダメージで確認）」「新しい 18 種の tags / keywords / requires が語彙の範囲に収まる（既存の網羅テストへ追加）」
- 完了条件: `npx vitest run src/system/boonRules.test.ts src/system/boons.test.ts src/system/keywords.test.ts` が通る。`docs/GLOSSARY.md` に足す語（芯 / 大祝福 / 神威 / 18 種の名前）を報告に列挙

### Lane C: 表示と QA（Sonnet 可）

- 所有: `src/render/boonUi.ts`、`src/qa/bot.ts`（`pickBoonIndex` を「呪い付きでないもののうち格が最も高い札」に）、`src/qa/simulation.test.ts`（計測の追加）、`src/render/boonUi.test.ts`（あれば）
- 最小 Edit のみ: なし（`state.boonChoice.grades` / `state.boonRun.grades` を読むだけ。Lane A の型が着地してから）
- 編集禁止: `system/**`、`data/**`
- 計測（`simulation.test.ts` に足す指標）: ランあたりの祝福取得数（芯を含む / 含まない）、格の分布（並 / 大 / 神威 の枚数）、芯 8 種の取得回数、格 2 以上を取ったランと並だけのランの平均到達深度・平均 kills、提示回数の内訳（階段 / 試練 / 闘技場・鏡 / 呪いの祠 / 契約）
- テスト（it 名）: 「大祝福・神威のカードは格の語と色で描かれ、並は今までの副題のまま」「芯の提示では呪いの札を描かない」「HUD の芯は先頭に出る」「bot は格の高い札を選ぶ」
- 完了条件: `npm run test`（縮小版 QA を含む）が通り、`report.md` に出す表の形が決まっている

### 統合の順序

1. Lane A → `npm run check` → コミット（`feat: 祝福に格と芯の提示を追加`）
2. Lane B と Lane C を並列 → 各 `npm run check` → コミット（`feat: 芯の祝福 8 種と格を活かす祝福 10 種` / `feat: 祝福カードの格の表示と QA の計測`）
3. 資料: `docs/CODE_MAP.md`（`boonGrade.ts` / `boonCores.ts` / `boonDefsWave3.ts` の 3 行）、`docs/recipes/boon.md`（「Rule 型は格が自動で掛かる。フック型で格を効かせるなら `graded: true` と `boonGradeMul`」の 1 項、「芯は `core: true`、1 ランに 1 つ、代償を持つ」の 1 項）、`docs/GLOSSARY.md`（芯 / 大祝福 / 神威、317 行目の希少度の説明）、`docs/ARCHITECTURE.md`（`BoonRunState.grades` と格の適用点）、`docs/ideas/boons-expansion.md` の実装状況節に 1 行、`IDEAS.md` 現状節の祝福の件数（180 → 198）
4. 隔離 worktree で `npm run qa:full`

---

## 5. QA での確認方法

- 比較の基準は 0.0.11α の `src/qa/report.md`。同じ 30 seed × 6 装備パターンで、**祝福ありと `offerBoons` no-op** の 2 通りを回し（`report.md:291` の手法を再利用）、平均到達深度・kills・怯み回数の差が今の −11.6% から拡がること（目標: 祝福ありで到達深度 +0.5 以上、怯み回数の差 −25% 以上）
- 格の分布が深度で右に寄ること（深度 2〜3 の提示で神威 ≦ 5%、深度 6 以上で大祝福 + 神威 ≧ 50%）
- 芯 8 種の取得回数に 0 のものが無いこと（bot は 1 枚目を選ぶので、抽選が偏っていれば偏りが見える）
- `SYNERGY.maxEventsPerStep` 到達回数と `ruleRun.droppedEvents` が増えていないこと（神威で ICD が短くなる分。増えたら `keywordBudget` 6 → 8 を検討）
- 序盤（深度 1〜3）の死亡率が下がりすぎないこと（芯の硝子の心・鉄の巨人が序盤を壊すなら `coreDepth` を 3 に）
- 決定性: `npx vitest run src/core/replay.test.ts`。格の抽選は `state.rng` だけを使う

### ユーザーに確認したほうがよい点

- 表示語: 「芯」「大祝福」「神威」でよいか（候補: 芯 → 柱 / 核、神威 → 極 / 天恵）。GLOSSARY の世界観語に足す
- 芯を **深度 2 の最初の提示** に固定するか、深度 1 の開始直後（起点の直後）に出すか。起点（ラン前）と芯（ラン中）の役割が重なって見えないか
- 呪い付きの祝福を格の対象外にしてよいか（代償も一緒に大きくするなら対象にできるが、`selfStatus` の代償が神威で ×2.2 になる）
- 希少度ラベル（通常 / 希少 / 極稀）をカードから外して格に置き換えることの是非（希少度は重みだけなので、見せ続けると「強さ」と誤読される）
- 芯の 8 種のうち「拍の刻」「鉄の巨人」は数値寄り。ルール変更寄りに振るなら別案（例: 拍の刻 → 「コンボ 10 の倍数で全スキルの再使用が戻る」）に差し替えるか

---

## 6. 不確かな点（確認方法つき）

- `boons.ts` から `boss.ts` の `isBossDepth` を import すると循環になるかもしれない（`boss.ts` は `boons.ts` を import しているか `grep -n "boons" src/system/boss.ts` で確認。循環するなら `floor.ts` 側で `gradeBoost` を積む）
- Rule 型の `magnitude` が 0 の効果（`resetCombo` / `refillDash fill` / `restoreMana fill`）しか持たない祝福は `isGraded` の自動判定で格なしになる。意図どおりだが、一覧を `boons.test.ts` の it「格を持つ祝福と持たない祝福の一覧」でスナップショットしておく
- ランの途中の状態は保存されない前提（`BoonRunState.grades` を永続化しない）。`grep -rn "boonRun\|boons" src/save src/ui/replayStore.ts` で保存に触れていないことを確認
- 芯の `foldCoreStats` は `foldBoonStats` の後段で `MANA.maxMin` の下限（`boons.ts:498`）より前に置く。満ち潮の器の `maxMana ×2` と虚ろの器（`hollowVesselMaxManaMul` 0.6）の重ね順は「芯 → 通常」で固定し、テストで止める
- 試練の部屋の出現率（`challengeChance` 0.35）は `challengeMinDepth` 2 以降。QA の bot は深度 3 前後で死ぬので、提示回数の増分は QA では小さく見える（人のプレイでの体感を優先）
- 格で ICD を短くすると `direct` の Rule（旧フック移行分）にも効く。旧フックの回数と揃えている前提（`docs/HANDOFF.md` 2 節）が崩れるので、`direct` は ICD の倍率を掛けない方が安全（Lane A の判断に委ねず、掛けない方を既定にする）

## 主要な参照ファイル（絶対パス）

- `/home/user/roguelike/src/system/boons.ts`（抽選 218-301、提示 304-311、4 択 326-352、選択 446-466、数値の畳み込み 473-533）
- `/home/user/roguelike/src/system/boonDefs.ts`（`BoonDef` 219-245、`BOON_KEYS` 26-157）
- `/home/user/roguelike/src/system/boonRules.ts`（`slashBase` 197、`boonForcesCrit` 904、フック一覧 516-1106）
- `/home/user/roguelike/src/system/rules.ts`（`collectRules` 102-107、`tryDirectRule` 170-185、`runRule` 193-205、`applyRuleEffect` 208-212）
- `/home/user/roguelike/src/core/rules.ts`（条件 18-90、効果 100-159、`RuleEffect` 180-217）
- `/home/user/roguelike/src/data/balance/boons.json`
- `/home/user/roguelike/src/render/boonUi.ts`（副題 127-133、カード 187-242）
- `/home/user/roguelike/src/loot/stats.ts`（ソフトキャップ 72-86, 147-155、`computeStats` 235-254）
- `/home/user/roguelike/src/loot/flux.ts`（`FLUX` 49-56、`powerScaleAt` 78-80）
- `/home/user/roguelike/src/loot/generator.ts`（性質数 71-74）
- `/home/user/roguelike/src/system/player.ts`（`applyStats` 157-176。読むだけ）
- `/home/user/roguelike/src/system/floor.ts`（提示 785-789、ハート 765-778）
- `/home/user/roguelike/src/system/specialRooms.ts`（呪いの祠 761-767、制圧の報酬 952-970）
- `/home/user/roguelike/src/data/enemies.ts`（`depthHpScale` 371-373）
- `/home/user/roguelike/src/qa/report.md`（指標 17-24、祝福の切り分け 291-293）
- `/home/user/roguelike/docs/ideas/boons-expansion.md`（未実装の抽選拡張 4-4〜4-12）
