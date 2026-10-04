# 数式と文法の実装設計（段取り 4）

作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 4。architect の設計をそのまま置き、6 章の不確かな点は統合役が推奨どおりに決めた。段取り 2 は `combat-core-impl.md`、段取り 3 は `jin-impl.md`。

## 決めたこと（統合役、2026-09-30）

- 6 章の 1〜8 はすべて推奨どおり（曲線の深み `ENEMY_SCALE.deepDepth 21` を新設・`Rule.direct` は減衰だけ消して残す・QA 用の開始深度 `RunSetup.startDepth` を足す・時限バフは 1 本のまま・旧フィールドは削除・`innateLuck` を保存・`FLUX.globalScale` は 4d で決める・`keywordBudget` 10 から）
- 並列の組み方: 4a（増と倍）は `loot/stats.ts` と `combat.ts` が絡み合うので 1 レーンでまとめて行い、4b のうち敵の曲線（B1）・性質の曲線の末端（B3）・揺らぎの器（B4）を 4a と並行で進める。地金（B2）は 4a の後

- **4a / 4b（B1・B3・B4）の実装で変えたこと**: `MoreMul` に `label` と `tags?` を足した（装備の倍を近接・射撃・スキルへ振り分けるため）。誓約の数値関数は据え置き、`damageMods.ts` が `MoreMul` に包む。装備に付く誓約の与ダメはすべて倍（装備の増と掛け算になるので、装備込みでは強くなる）。ジョブの弱点の JSON のキー名は据え置き。敵の曲線は `curveAt` を使う。揺らぎの幅を狭めたので見た目の分類の境界を 0.15 / 0.45 → 0.07 / 0.21 に（rare 確定の報酬が外れていたため）。跳躍は道筋を体の幅で調べ、空中も壁で止まる。4b の地金（B2）・4c・4d はこれから。`REPLAY_VERSION` は 4a と 4b の途中までを 17 にまとめた

- **4b（B2）・4c の実装で変えたこと**: 浅い階へ戻ったときも地金を今の深度で決め直す。`direct` の Rule は訪問回数と連鎖係数も見ない（旧フック互換）。連鎖係数の表に範囲・多数の効果（burnNearby など）を 0.5 で足した。`Modifier` に `label?` と `per.every?`（「10 につき」）を足した。楔とジョブの得意は近接・射撃の 2 要素（proc に掛けないため）。対象の敵を見る Modifier は対象の無い一撃では効かない。**既知の差**: 計算式の頁（`ui/scalingText.ts` の `modifierRows`）は `stats.more` だけを読むので、Modifier になったジョブの得意武器の倍が出ない（見ている武器と装備中の武器で条件がずれるため、出し方は段取り 7 で決める）。4d（計測）はこれから

- **4d の実装と観測（2026-09-30）**: 深度帯は 1-5 / 6-10 / 11-15 / 16-20 / 21+。probe に深度 15・20 と「深度に見合う並の遺物 6 部位」の型、地力 ÷ 敵の生命の表。フル QA に帯別の被弾・撃破・死ぬまでの回数・死亡時の与ダメの内訳・連鎖の深さ・陣の hpMul の分布・開始深度 10 / 20 のラン。**観測: 地力 ÷ 敵の生命は深度 10 で 0.57、20 で 0.40（目標 0.85〜0.9）。深度に見合う装備では被弾で死ぬまで 10〜14 発（目標 4〜7）**。攻撃は足りず守りは厚い。つまみは `INNATE.budget.perDepth`・`FLUX.globalScale`・`ENEMY_SCALE.hpPerDepth` と敵の攻撃 `damagePerDepth`。数値合わせは段取り 7（性質・祝福の作り直し）の後で行う（今の性質は近接の増が少なく、地力の中身が変わるため）

---

## 0. 結論

1. 与ダメを `基礎 × (1 + Σ増) × Π倍 × 敵側` の 1 本にする。増は `PlayerStats.increased: Record<DamageTag, number>`（性質・地金・流儀の偏り・祝福の数値札が出す）、倍は出所つきの `MoreMul[]`（誓約・芯・奥義・状態異常・コンボ・会心・時限バフ・「〜につき」）。`softCap` は与ダメから外し、攻撃速度・連射・移動速度の 3 つだけに残す。歯止めは「増が加算で 1 点の価値が下がる」構造そのものと、既存の性能上限（弾・設置物・語の回数上限）だけ
2. 敵の曲線は `ENEMY_SCALE.json` に集約: 生命 `1 + 0.15(d−1)`、攻撃は flat 加算 `depthDamageBonus`（57 箇所）を倍率 `1 + 0.05(d−1)` に置換、怯み耐性は生命と同じ曲線（`POISE.depthScale` 廃止）、深度 21 以降は指数（生命 1.12 / 攻撃 1.04）。地金の予算は上限（cap 12・hardCap）を外して同じ曲線に乗せ、持ち込んだ遺物の地金は **今の深度の期待値 × 拾った時の上振れ** で階ごとに決め直す（`innateAt(item, depth)`、`computeStats(equipment, depth)`）。性質の期待値曲線は最後の区間の傾きで外挿して深度 26 の頭打ちを外す
3. 連鎖は深さ減衰（`chainDecay 0.5^depth`）と深さ 3 の打ち切りをやめ、**連鎖係数**（効果ごとの 0..1。次の Rule の確率に掛かる。`GameEvent.coef`）と **同じ敵への訪問回数**（`GameEvent.visits`、既定 1、`stats.chainRevisits` で増える）で止める。深さ 8 は性能の保険。Rule 文法に **常時の増・倍 `Modifier`**（`kind: increased | more`、`per`〈〜につき〉、`if`）を足し、与ダメ・怯み値の計算がそれを読む
4. 段は 4a 増と倍 → 4b 敵の曲線・地金・揺らぎ → 4c 連鎖・Modifier → 4d 計測の 4 つ。各段で遊べる。`REPLAY_VERSION` は 16 → 17（4a）→ 18（4b）→ 19（4c）

---

## 1. 今のコードの地図（根拠。行番号付き）

### 1-1. 与ダメ

| 事実 | 根拠 |
| --- | --- |
| 入口 `rollOutgoing(state, enemy, base, kind, opts)`。順: melee/ranged は `(base + flat) × meleeDamageMul / rangedDamageMul` → `skillDamageMul` → 弱体 → `playerStatusOutgoingMul` → 奥義 `ultimateOutgoingMul`（通常攻撃だけ）→ 霊体化 → proc 以外: `damageVsStaggeredMul` → `comboDamageMul` → 見切り `justDodgeDamageMul` → 時限バフ `p.buffs.damage`（1 本、最大値、重ならない）→ 会心 `critChance` / `critMul` → 狂戦士 / 賭博師 → 近間の誓い → `traitOutgoingMul` → 属性・防御 `genreAndElement` | `/home/user/roguelike/src/system/combat.ts:126-163` |
| 性質の倍率は **加算の壺 3 つ + 乗算のゲート**: `meleeDamageMul += pct(v)`（性質）、`traitOutgoingMul = max(0.1, 1 + Σbonus) × keystoneOutgoingMul`（bonus = 場・相手・スキル・祝福の響きの条件付き加算、誓約は乗算） | `/home/user/roguelike/src/loot/affixes.ts:405-463`、`/home/user/roguelike/src/system/traitHooks.ts:231-335` |
| 乗算で入る出所: 誓約 `berserkerMul` / `gamblerMul` / `bladeOathMul`、芯の祝福 `foldGlassHeart`（`*=`）、ジョブ得意 `JOB.favoredMeleeMul`（`*=`）、素手 `WEAPON.unarmed.damageMul` | `/home/user/roguelike/src/system/keystones.ts:113-134`、`/home/user/roguelike/src/system/boonCores.ts:33-38`、`/home/user/roguelike/src/system/jobs.ts:55-58`、`/home/user/roguelike/src/loot/stats.ts:266` |
| ソフトキャップ: `softCap(mul)` は 2.0（+100%）超過分を sqrt で圧縮。対象 `meleeDamageMul` / `rangedDamageMul` / `attackSpeedMul` / `fireRateMul` / `moveSpeedMul`。誓約は対象外（後から apply） | `/home/user/roguelike/src/loot/stats.ts:72-87, 148-156, 249-250` |
| 集計順: 地金 + 性質（flat → scale → convert）→ 共鳴 → 星座 → ソフトキャップ → 誓約 → `finalize`。`computeStats(equipment)` は **深度を受けない** | `/home/user/roguelike/src/loot/stats.ts:236-256` |
| `applyStats`: 装備 → ラン内（起点・振り分け）→ `deriveAttributes` → `foldBoonStats`（祝福）。`boonRun.baseStats` に装備の stats を覚える | `/home/user/roguelike/src/system/player.ts:186-208`、`/home/user/roguelike/src/system/boons.ts:607-635` |
| `computeStats` の呼び出し: `core/game.ts:53`、`core/replay.ts:693`、`system/loot.ts:294`、`system/jobs.ts:121`、`system/runSetup.ts:204, 224`（`refreshRunStats`）、`system/hub.ts:98, 172, 397`、`ui/inventory.ts:296`、`render/dropTooltip.ts:101-102`、`ui/synergyPanel.ts:100`、`loot/describe.ts:363` | grep 結果 |
| 参照数（非テスト）: `meleeDamageMul` 50 / `rangedDamageMul` 47 / `skillDamageMul` 16 / `damageVsStaggeredMul` 9 / `burstDamageMul` 20 / `critMul` 27。触るファイル: `loot/resonance.ts` `loot/affixes.ts` `loot/stats.ts` `loot/types.ts` `data/jobs.ts` `system/hub.ts` `system/boonCores.ts` `system/boons.ts` `system/combat.ts` `system/jobs.ts` `system/keywords.ts` `system/boonRules.ts` | grep 結果 |
| `PlayerStats` の該当フィールド | `/home/user/roguelike/src/loot/types.ts:378-397, 439-441`、既定 `:899-965` |

### 1-2. 被ダメ・怯み

| 事実 | 根拠 |
| --- | --- |
| `damagePlayer`: `amount × 脆弱・状態 × enemyDamageMul（衰弱・弱体）× traitIncomingMul × 構え × 奥義` → `mitigate` = `× (1 − 防御/魔防の逓減) × (1 − 実効耐性/100)` → `× damageTakenMul`。最低 1 | `/home/user/roguelike/src/system/combat.ts:483-487, 509-510`、`/home/user/roguelike/src/system/elementCombat.ts:160-186` |
| 耐性のソフトキャップ `effectiveResist`（膝 50・上限 75）。これは残す | `elementCombat.ts:175-179` |
| 怯み耐性 `basePoiseMax = poise × (1 + POISE.depthScale 0.08 × (d−1))`（生命の 0.18 より遅いが上限なし）。精鋭 ×1.5、猛 ×1.3 | `/home/user/roguelike/src/system/poise.ts:27-30`、`/home/user/roguelike/src/data/balance/combat/POISE.json`、`JIN.json:71` |
| 怯み値の入口 `damageEnemy`: `boonPoise(...) × traitPoiseMul(...)` → `addPoise` | `combat.ts:188-199` |

### 1-3. 敵の深度曲線

| 量 | 今 | 根拠 |
| --- | --- | --- |
| 生命 | `depthHpScale = 1 + (d−1) × 0.18`。深度 30 以降 `deepHpMul` が傾き 0.05 に寝かせる（`FLOOR_KIND.deepDepth 30 / deepHpSlope 0.05`） | `/home/user/roguelike/src/data/enemies.ts:377-379`、`ENEMY_SCALE.json`、`/home/user/roguelike/src/system/runEvents.ts:365-380`、`FLOOR_KIND.json:69-70` |
| 攻撃 | `depthDamageBonus = floor((d−1)/2) × 2` の **flat 加算**。57 箇所が `X + depthDamageBonus(state.depth)` の形（`enemies.ts:698, 854, 947`、`enemyWave3.ts` 20 箇所、ボス 11 ファイル、`enemyTraits.ts:122, 144`、`enemyLeap.ts:74`…）。深度 10 でスライム接触 10 → 18（×1.8）、深度 20 で 28（×2.8）。個性が潰れる | `enemies.ts:381-383`、grep 結果 |
| 怯み耐性 | `POISE.depthScale 0.08` | 上記 |
| 予備動作 | `scaledWindup = base × max(0.6, 1 − 0.015(d−1))`（下限 0.75）。変えない | `/home/user/roguelike/src/system/enemies.ts:125-135` |
| 猛の倍率 | 生命 ×1.6 / 怯み ×1.3 / 接触 ×1.2（`contactDamageOf × JIN.strong.damageMul`） | `/home/user/roguelike/src/system/jinSpawn.ts:84-92`、`enemies.ts:918` |
| 生成 | `createEnemy`: `hp = round(def.hp × depthHpScale(depth))`。陣の予算は `jinBudget` が三角分布 ±35% で既に揺らす | `enemies.ts:141-149`、`jinSpawn.ts:160-166` |

### 1-4. 装備の期待値曲線と地金

| 事実 | 根拠 |
| --- | --- |
| 性質の期待値: `nominalAt` が点列を線形補間、**最後の点より深ければ最後の点の値**（例 `meleeDamagePct` は深度 26、`critChance` は 30 で止まる）。生成時に `powerScaleAt = 0.8 × depthScale` を掛ける | `/home/user/roguelike/src/loot/flux.ts:112-140, 47-56`、`affixCurves/meleeDamagePct.json` |
| 揺らぎ: `value = nominal × (1 + flux)`、σ = min(0.12 + 0.05d, 1.0)、三角分布 [−1.3σ, 0, +1.5σ]、下限 `MIN_FLUX −0.9`。**TS 直書きの定数**（不変条件 4 に反する） | `flux.ts:13-25, 154-165` |
| 地金: 予算 = `min(1 + 0.35d, 12) × depthScale(0.6→1.0)`、三角分布 [0.5, 1, 1.4 + boost×1.5]、絶対上限 `2 + d`。予算 12 は深度 31 で到達。項目数・配分は rng、値 = 点 × `pointValue`、防具は防御力の確定行 | `/home/user/roguelike/src/loot/innate.ts:75-100, 168-228`、`INNATE/budget.json`、`hardCap.json` |
| 地金は `Item.innate: AffixRoll[]` に **絶対値** で入る。`collectInnate(equipment)` が `computeStats` で性質と同じ段階で畳む。`Item.itemLevel`（生成深度）は保存済み | `innate.ts:230-233`、`stats.ts:246`、`/home/user/roguelike/src/loot/types.ts:213-259` |
| 生成: item 専用 rng の末尾で `rollInnate(r, base, depth, boost, plain)` | `/home/user/roguelike/src/loot/generator.ts:539-569` |

### 1-5. 連鎖の今の実装

| 事実 | 根拠 |
| --- | --- |
| `GameEvent.depth`（連鎖深さ）。`pushEvent` は照合中なら `depth = run.depth`（+1 済み）で `pendingEvents` へ持ち越し（同ステップで再帰しない） | `/home/user/roguelike/src/core/events.ts:69-95, 163-174` |
| `tryRule`: `depth ≥ SYNERGY.maxDepth(3)` で照合しない → group → ICD → 条件 → 語の回数上限 `keywordBudget 6 / 1 秒` → 敵ごと procIcd → `chance < 1` なら乱数 → 実行。効果量 `× chainDecay(0.5) ** depth` | `/home/user/roguelike/src/system/rules.ts:146-215`、`SYNERGY.json` |
| `Rule.direct`（旧フック由来の祝福 6 件）: 深さを進めず、減衰・語の上限・深さ上限・記録の対象外 | `/home/user/roguelike/src/core/rules.ts:253-257`、`rules.ts:176-193` |
| 連鎖の記録 `state.chains`（UI 用、8 件） | `rules.ts:837-841`、`core/state.ts:922` |
| 連鎖雷 `chainLightning`（状態異常の跳び。`maxTargets` で止まる）は別物。触らない | `/home/user/roguelike/src/system/statusEffects.ts:681-699` |
| 既存テスト: `rules.test.ts:91, 94-112, 142`（chainDecay・maxDepth・keywordBudget） | grep 結果 |

### 1-6. Rule の倍の表現（今）

- `Rule` は `when × if × then` のイベント駆動だけ。常時の倍を表す型は無い。倍は `traitHooks.ts` / `keystones.ts` / `boonCores.ts` のコード分岐と `PlayerStats` の `*Mul` に散っている（`/home/user/roguelike/src/core/rules.ts:237-262`）
- 条件の照合 `ruleConditionsMet(state, conditions, subject: ConditionSubject)` は Rule から独立して呼べる（`rules.ts:49-58, 661-663`）。Modifier の `if` にそのまま使える
- `Rule` の置き場: `BoonDef.rules`（`system/boonDefs.ts:245`）、`MovesetDef.rules`（`data/weapons.ts:367`）、`SkillDef` / `ModifierDef`（`skills/types.ts:296, 462`）、`SustainDef.rules`（`data/ultimates.ts:193`）、ジョブ `jobRules`。集め方は `collectRules`（`rules.ts:105-120`）

### 1-7. 計測

- probe（`pnpm run qa:probe`）: 深度 1 / 5 / 10 の 1 対 1・集団、撃破秒・被弾/60 秒・完遂率など（`/home/user/roguelike/src/qa/combatProbe.ts:272-303`、`src/qa/probe.md`）。装備なしの剣だけ
- フル QA（`report.md`）: 6 装備パターン、平均到達深度 1.0〜2.5、死亡率 77〜100%。深度帯は `1-2 / 3-5 / 6+`（`/home/user/roguelike/src/qa/combatMetrics.ts:12-24`）。深度 6 以降の観測がほぼ無い
- 開始深度を選ぶ型は `createGame` に無い（`core/game.ts:60` で `depth: 1` 固定）

---

## 2. 設計

### 2-1. 増と倍

**新規 `src/core/damage.ts`**（型と純関数だけ。system を import しない）

```ts
/** 増の壺のタグ。1 撃は複数を持つ（近接 + 炎 + 怯み中 …） */
export const DAMAGE_TAGS = [
  "melee", "ranged", "skill", "ultimate", "proc", "dot", "area", "placed", "minion",
  "fire", "ice", "lightning", "poison", "dark", "light",
  "vsStaggered", "vsBoss", "vsElite", "counter", "backstab", "reaction",
  "critMulti", "poise",
] as const;
export type DamageTag = (typeof DAMAGE_TAGS)[number];
export type IncreasedTable = Record<DamageTag, number>;   // 0.1 = +10%

/** 倍。source は表示・テスト・QA 用（"keystone:berserker" / "boon:coreGlassHeart" / "combo" / "crit" / "mod:<id>"） */
export interface MoreMul { source: string; mul: number }

/** 1 撃の文脈。system/damageMods.ts が増・倍を集めるときの入力 */
export interface DamageContext {
  kind: DamageKind;               // melee / ranged / skill / proc（core/state.ts の既存型）
  tags: ReadonlySet<DamageTag>;
  /** 属性の割合（0..1。増の属性タグはこの重みで足す） */
  elementShares: ReadonlyArray<{ element: Element; share: number }>;
  enemyId: number | null;
  crit: boolean;
}

export interface DamageBreakdown {
  base: number;
  increased: number;              // Σ増（表示は「増 +X%」）
  more: readonly MoreMul[];       // 「倍 ×Y」を出所ごとに
  enemyMul: number;               // 防御・耐性・弱点・脆弱
  amount: number;
}

export function createIncreased(): IncreasedTable;       // 全部 0
export function sumIncreased(inc: Readonly<IncreasedTable>, ctx: DamageContext): number;  // タグの Σ + Σ share×属性タグ。下限 −0.9
export function productMore(more: readonly MoreMul[]): number;
```

**`PlayerStats` の変更**（`/home/user/roguelike/src/loot/types.ts`）

| 削る | 代わり |
| --- | --- |
| `meleeDamageMul` / `rangedDamageMul` / `skillDamageMul` / `damageVsStaggeredMul` / `burstDamageMul` | `increased: IncreasedTable`（melee / ranged / skill / vsStaggered / ultimate） |
| — | `more: MoreMul[]`（装備・祝福・ジョブが出す **常時の倍**。芯・得意武器・素手・誓約 glassCannon など。条件付きは Modifier で） |
| `critMul` | 残す（会心は倍 `{source:"crit", mul: critMul + increased.critMulti}`） |
| `meleeDamageFlat` / `rangedDamageFlat` | 残す（地金的な基礎の加算。増より前） |
| `poiseDamageMul` | 残す（体の性能）。怯み値の増は `increased.poise` |

`DEFAULT_STATS` に `increased: createIncreased()`、`more: []` を足し、`createBaseStats`（`stats.ts:128-145`）で複製する。

**写す規則（全件の表は不要、規則と例外）**

| 今の書き方 | 写し先 | 理由 |
| --- | --- | --- |
| `s.xxxDamageMul += pct(v)`（性質 `apply`、共鳴 `resonance.ts`、地金） | `s.increased.<tag> += pct(v)` | 性質・地金・共鳴の数値は増（build-core 柱 3） |
| `s.xxxDamageMul *= k`（芯 `boonCores.ts:34-36`、ジョブ得意 `jobs.ts:55-58`、素手 `stats.ts:266`、誓約 glassCannon などの `apply`） | `s.more.push({ source: "<種類>:<key>", mul: k })` | 出所が 1 つで常時なら倍。ビルドの顔 |
| `traitHooks.ts` の `fieldBonus / targetBonus / wave2Bonus / skillBonus`（条件付き加算） | **そのまま増として `sumIncreased` の後に足す**（`traitIncreased(state, ctx)` に改名して合流）。今回は書き換えない | 既に加算の形。性質の作り直しは段取り 7 |
| `keystoneOutgoingMul` / `berserkerMul` / `gamblerMul` / `bladeOathMul` / `ultimateOutgoingMul` / `playerStatusOutgoingMul` / 弱体 / 霊体化 / `comboDamageMul` / 見切り / `p.buffs.damage` / 会心 | `collectMore(state, ctx)` が `MoreMul[]` として返す（1 出所 1 要素） | 全部「出所ごとの掛け算」 |
| `p.buffs.damage`（1 本・最大値） | 今回は 1 本のまま `MoreMul` にする。複数の時限バフは段取り 5（戦意）で `buffs.damage: TimedMul[]` に | 波及を絞る |
| `traitElementMul`・`genreAndElement`（防御・耐性・弱点） | `enemyMul` に据え置き | 敵側 |
| 属性の増 | `increased.fire` などを `elementShares` の重みで足す（`outgoingElement` の `shares` を使う） | 変換 50% なら炎の増は半分効く |

**`rollOutgoing` の新しい形**（`/home/user/roguelike/src/system/combat.ts:126-163` を書き直す。署名は保ち、`OutgoingHit` に `breakdown?: DamageBreakdown` を足す）

```
ctx   = buildContext(state, enemy, kind, opts)           // system/damageMods.ts。tags: kind, skill, ultimate(opts), vsStaggered(isStaggered), vsBoss, vsElite, counter(opts.counter), backstab(opts.backstab)
raw   = base (+ meleeDamageFlat / rangedDamageFlat)
inc   = 1 + sumIncreased(stats.increased, ctx) + traitIncreased(state, ctx)      // 下限 TRIGGER.trait.minMul(0.1)
more  = stats.more ++ collectMore(state, ctx)            // 会心の判定（rng）は collectMore の中で今と同じ順に引く
enemy = genreAndElement(...)                              // 据え置き
amount = max(1, round(raw × inc × Π more × enemy.mul))
```

順序の注意: 会心の乱数 `state.rng.chance(...)` は今 `crit` の位置（`combat.ts:152`）で引いている。`collectMore` の中でも **同じ位置（proc 以外・コンボの後）** で引く。賭博師の `state.rng.next()` も同様。乱数の消費順が変わってよいのは `REPLAY_VERSION` を上げるからだが、無用に変えない。

**新規 `src/system/damageMods.ts`**: `buildContext` / `traitIncreased`（traitHooks.ts の 4 関数を呼ぶだけ）/ `collectMore`（keystones・boonCores・ultimates・statusEffects・combo・buffs・crit）/ `applyModifiers`（2-8 の Modifier を増・倍に足す）。`combat.ts` からはこの 1 ファイルだけを呼ぶ。

**怯み値**: `damageEnemy`（`combat.ts:188`）の `boonPoise × traitPoiseMul` の後に `× (1 + increased.poise + Modifier の poise 増) × Π Modifier の poise 倍` を掛ける。ctx は同じものを再利用（`HitOptions` に `ctx?` を通す。無ければ kind だけで作る）。

**表示**: `ui/scalingText.ts` の計算式の頁に「増 +X%（内訳: 近接 +20%・炎 +10%）」「倍 ×Y（出所ごと 1 行: 近間の誓い ×1.3 …）」を出す（`DamageBreakdown` を `statsSummary` の材料にする）。単一指標は出さない。`system/keywords.ts` の語の推論は `increased` を読むように直す（`meleeDamageMul > 1` → `increased.melee > 0`）。

### 2-2. ソフトキャップの撤去と歯止め

- `SOFT_CAPPED_KEYS` を `attackSpeedMul` / `fireRateMul` / `moveSpeedMul` の 3 つにする（`stats.ts:81-87`）。関数 `softCap` と `SOFT_CAP_THRESHOLD` は残す（テスト `stats.test.ts:136-153` はそのまま通る）
- 与ダメの歯止めは置かない。代わりに:
  - 増は加算（`sumIncreased`）なので 1 点の価値が自然に下がる（+100% の次の +10% は ×1.05）
  - 倍は出所 1 つにつき 1 要素（同じ `source` は `collectMore` が後勝ちで 1 つに畳む）。同じ札を 2 枚積んでも 2 乗にならない
  - 性能の上限は据え置き: `projectileCount`・設置物・従魔の数・`SYNERGY.keywordBudget`・`maxEventsPerStep`
- 下限: `inc ≥ TRIGGER.trait.minMul`（0.1）、`Π more ≥ 0`（賭博師の下限は `KEYSTONE.gamblerMin`）

### 2-3. 敵の曲線

**`src/data/balance/enemies/ENEMY_SCALE.json`**（既存ブロックに項目を足す。`_fields` に 1 行ずつ）

```json
{
  "_note": "深度による敵の強さの伸び（core-synthesis 段取り 4 / build-core 3-2）。章 1〜4（深度 1〜deepDepth−1）は線形、deepDepth 以降は指数。生命・怯み耐性・地金の予算は同じ曲線（depthHpScale）、攻撃は別の傾き。予備動作は ENEMY_TEMPO",
  "_fields": {
    "hpPerDepth": "深度 1 つごとに敵の生命へ足す倍率（深度 1 で 1 倍）。怯み耐性・地金の予算も同じ。目安 0.12〜0.18",
    "damagePerDepth": "深度 1 つごとに敵の攻撃へ足す倍率（deprecated の flat 加算 depthDamageBonus の置き換え。深度 1 で 1 倍）。目安 0.04〜0.06",
    "deepDepth": "ここから深み（指数の伸び）。FLOOR_KIND.deepDepth とは別（あちらは部屋の敵数・変異の開始）。目安 21",
    "deepHpGrowth": "深み 1 階ごとの生命の倍率（深度 deepDepth の値 × これ^(d − deepDepth)）。目安 1.10〜1.15",
    "deepDamageGrowth": "深み 1 階ごとの攻撃の倍率。目安 1.03〜1.05"
  },
  "hpPerDepth": 0.15, "damagePerDepth": 0.05, "deepDepth": 21, "deepHpGrowth": 1.12, "deepDamageGrowth": 1.04
}
```

**`src/data/enemies.ts`**（`:376-383` を置き換え）

```ts
/** 章の線形 → 深みの指数（core/scale.ts の curveAt に委譲） */
export function depthHpScale(depth: number): number      // = curveAt({ perDepth: hpPerDepth, deepDepth, deepGrowth: deepHpGrowth }, depth)
export function depthDamageMul(depth: number): number     // 同じく damage の曲線
/** 敵の攻撃の深度補正。57 箇所の `X + depthDamageBonus(state.depth)` を `depthDamage(X, state.depth)` に置換する */
export function depthDamage(base: number, depth: number): number { return Math.round(base * depthDamageMul(depth)); }
```

`depthDamageBonus` は **削除**（tsc が 57 箇所を全部拾う。置換は機械的: `A + depthDamageBonus(state.depth)` → `depthDamage(A, state.depth)`。`enemies.ts:698` の `dmgBonus` 変数のように先に取り出している所は `throwBombs(state, e, def, dmgBonus)` の引数を倍率へ変える）。深度 1 では加算 0 = 倍率 1 なので probe の深度 1 は変わらない。

- 怯み: `basePoiseMax`（`poise.ts:27-30`）を `base × depthHpScale(depth)` に。`POISE.depthScale` を JSON と `_fields` から削除
- 深み: `runEvents.ts:365-380` の `deepHpMul` を削除（曲線が `depthHpScale` に入るので二重に寝かせない）。`FLOOR_KIND.deepHpSlope` を JSON から削除、`deepDepth` は部屋の敵数・変異の開始として残す
- 予備動作: 変えない

### 2-4. 地金の持ち込み（3-1）

考え方: 遺物は「配分」と「上振れ」だけを個性として持ち、予算は **今の深度の期待値** で決め直す。

**`Item` の変更**（`/home/user/roguelike/src/loot/types.ts:213-259`）: `innate: AffixRoll[]` は **拾った深度（`itemLevel`）での基準の行** として残す（表示・旧セーブとの互換）。新しく `innateLuck?: number`（上振れ = 抽選した予算 ÷ その深度の期待値。生成時に `rollInnate` が返す。無い旧アイテムは `migrate.ts` が `innate` の点の合計 ÷ `innateMeanBudget(itemLevel)` で補う。`innate` も無ければ 1）。

**`src/loot/innate.ts` に足す**

```ts
/** 期待値（点）。cap / hardCap を外し、深みは ENEMY_SCALE の指数に乗せる */
export function innateMeanBudget(depth: number): number   // (base + perDepth × d) × innateDepthScale(d)、d ≥ deepDepth は deepHpGrowth^(d − deepDepth)
/** 深度 depth での地金の行。配分は innate の点の比、予算は innateMeanBudget(depth) × innateLuck。点は最大剰余法で整数に配る（決定的・rng なし） */
export function innateAt(item: Pick<Item, "innate" | "innateLuck" | "itemLevel" | "slot">, depth: number): AffixRoll[]
export function collectInnate(equipment: Equipment, depth: number): AffixRoll[]   // 署名に depth を足す
```

- 配分の復元: 各行の点 = `value / pointValue.attr`（耐性は `/ pointValue.resist`、防御力は `(value − armor.base[slot]) / armor.perPoint[slot]`）。小数は生成時の丸めで揃うので `Math.round`
- `rollInnate` は変えず、返り値に `luck` を添える（`{ rolls, luck }`）。`generator.ts:553` で `item.innateLuck = luck`
- `INNATE/budget.json`: `cap` を削除、`lowScale 0.5 → 0.6`、`highScale 1.4` 据え置き（三角分布の平均がちょうど 1.0 になり、`luck` の期待値が 1）。`hardCap.json` を削除（`_fields` から `budget.cap` / `hardCap` を消す）。`innateHardCap` と `innate.test.ts:101` を削除
- **`computeStats(equipment, depth = 1)`**（`stats.ts:236`）。`collectInnate(equipment, depth)` に渡す。呼び出し側で深度を持つ所は渡す: `system/loot.ts:294`、`system/jobs.ts:121`、`system/runSetup.ts:224`、`ui/inventory.ts:296`、`core/replay.ts:693`、`render/dropTooltip.ts:101-102`（`state.depth`）。`core/game.ts:53`・`hub.ts`・`describe.ts`・`synergyPanel.ts` は既定 1 のまま
- **階を降りたら決め直す**: `descend`（`floor.ts:897-925`）の `buildFloor` の後に `refreshRunStats(state)` を **fresh でも** 呼ぶ（今は `else refreshRunStats`。`runSetup.ts:223-225` は `computeStats(state.profile.equipment, state.depth)` に）。`applyStats` は HP 割合を保つので生命の伸びで死なない。降階の浮き文字「地金が馴染む」は render 側の演出なので 4b では出さない（段取り 7 の run-arc と一緒に）
- 表示: `describe.ts:293` の `innateLines(item)` に `depth` を足し、装備画面はラン中 `state.depth`、拠点・倉庫は 1 で出す。ツールチップは「深みで伸びる」の 1 行を Tips ノート（`meta/tips.ts`）に足す（UI に説明を書かない）

### 2-5. 性質の期待値曲線の末端と揺らぎの幅

- `nominalAt`（`flux.ts:112-140`）: 最後の点より深いときは **最後の区間の傾きで線形外挿**し、最後の点の値を下回らない（`max(last, last + slope × (d − last.depth))`）。点列は触らない。`nominal2` も同じ
- 揺らぎの下振れを狭める（3-1「期待値の 0.6〜1.8 倍」）: TS 直書きの定数を **`src/data/balance/loot/FLUX.json`** に移す（不変条件 4）。値: `sigmaBase 0.12` / `sigmaPerDepth 0.05` / `sigmaMax 1.0` / `sigmaPerBoost 0.1` / `lowScale 1.3 → 0.4`（σ 最大で −0.4）/ `highScale 1.5 → 0.8`（+0.8 = 1.8 倍）/ `minFlux −0.9 → −0.4` / `maxConversionFlux 0.5` / `globalScale 0.8` / `depthScale` の点列。反転・見た目の分類の定数も同じ JSON へ。`flux.ts` は `FLUX = BALANCE.loot.FLUX` の再 export と関数だけにする（`data/tuning.ts` に 1 行）
- 期待値曲線に直接は触らないので、この段では 性質の値の分布だけが変わる（下振れが消える分、平均が上がる: 三角分布の平均 (−0.4 + 0 + 0.8)/3 σ = +0.13σ）。`globalScale` を 0.8 → 0.75 で相殺するかは QA で決める（つまみ）

### 2-6. 揺らぎのスケール（3-15）: 共通の器

**新規 `src/core/scale.ts`**（純関数）

```ts
export interface DepthCurve { base?: number; perDepth: number; deepDepth?: number; deepGrowth?: number }   // (base ?? 1) + perDepth × (d − 1)、deepDepth 以降は指数
export function curveAt(curve: DepthCurve, depth: number): number;
export interface Spread { low: number; mode?: number; high: number }   // 平均に掛ける倍率（三角分布）
export function rollSpread(rng: Rng, mean: number, spread: Spread): number;   // rng を 1 回引く
```

- `triangular` は `loot/flux.ts:154` と `loot/innate.ts:86` に 2 つある。`core/scale.ts` に 1 つにして両方から使う（数式は同じなので結果は変わらない。`(rng.next() + rng.next() − 1)` の `jinBudget` は rng 2 回なので **今回は触らない**。触ると陣の配りの乱数列がずれる）
- **陣ごとの生命の揺らぎ**（3-15「敵の生命は陣ごとに揺らす」）: `jinSpawn.ts` で陣を作るとき `hpMul = rollSpread(state.rng, 1, JIN.hpSpread)` を 1 回引き、メンバー全員の `maxHp / hp` に掛ける（`Jin` に `hpMul: number` を持たせ、後詰・合流の敵にも同じ倍率を掛ける。HUD は出さない）。`JIN.json` に `"hpSpread": { "low": 0.9, "high": 1.1 }` と `_fields`。長蛇・物見・階の主の陣も同じ道を通る。陣に属さない敵（増援・召喚・死骸）は 1.0
- 値段・稼ぎ・ドロップの数は段取り 6 でこの器に載せる（今回は作らない）

### 2-7. 連鎖（3-13 + build-core 3-5）

**止め方を 3 つに**: 範囲（効果の `radius` に次の標的がいなければ自然に止まる。仕組みの追加なし）・同じ敵への訪問回数・連鎖係数。深さは性能の保険だけ。

**型**（`/home/user/roguelike/src/core/events.ts`）

```ts
export interface GameEvent {
  ...
  depth: number;                       // 残す（性能の保険 SYNERGY.maxDepth 8 と QA の連鎖長の計測）
  /** この連鎖で対象になった敵 id の列（重複あり。自分の targetId を含む）。訪問回数の判定 */
  visits?: readonly number[];
  /** 連鎖係数の累積（0..1）。次の Rule の確率に掛かる。省略 = 1 */
  coef?: number;
}
export interface RuleRunState { ...; visits: readonly number[]; coef: number; }   // 照合中の効果が起こすイベントへ写す
```

`pushEvent`（`events.ts:163-174`）: `visits = [...(run.depth > 0 ? run.visits : []), ...(input.targetId !== undefined ? [input.targetId] : [])]`、`coef = run.depth > 0 ? run.coef : 1`。長さは `SYNERGY.maxDepth` で切る（性能）。

**`RuleEffect` に `procCoefficient?: number`**（`/home/user/roguelike/src/core/rules.ts:185-222`）。省略時は効果の種類の既定表 `PROC_COEFFICIENT: Readonly<Record<RuleEffectKind, number>>` を `src/data/balance/loot/SYNERGY.json` の `procCoefficient` ブロックから読む（例: `explode 0.5`, `chainLightning 0.3`, `shockwave 0.5`, `wave 1.0`, `strike 1.0`, `inflict 1.0`, `spreadStatus 0.5`, `nearbyEnemies 0.5`, `volley 0.7`, `spawnBullets 0.7`, `shards 0.5`, 敵を対象にしない効果〈heal / energy / restoreMana / ward …〉は 1.0。表に無い種類は 1.0）。

**`tryRule`（`rules.ts:146-170`）の変更**

1. `if (ev.depth >= SYNERGY.maxDepth) return;` は残す（maxDepth を 3 → 8）
2. 訪問回数: `if (ev.targetId !== undefined && countOf(ev.visits, ev.targetId) > 1 + state.stats.chainRevisits) return;`（既定 `chainRevisits 0` = 同じ敵へ 1 度。この判定は Rule の実行前に 1 回。**ダメージそのものは入る**、この敵から先へ跳ばないだけ）
3. 確率: `const chance = rule.chance * (ev.coef ?? 1) * (1 + state.stats.chainCoefBonus)` を 1 で切り、`chance < 1` なら乱数。`rule.chance ≥ 1` でも `coef < 1` なら引くことになる（乱数の消費順が変わる → REPLAY 19）
4. `runRule`（`:201-215`）: `run.visits = ev.visits ?? []`、`run.coef = (ev.coef ?? 1) × (rule.then.procCoefficient ?? PROC_COEFFICIENT[kind])`、効果量の `SYNERGY.chainDecay ** ev.depth` を **削除**（等倍）
5. `direct`: 減衰が無くなるので「等倍」の差は消える。深さ・語の上限・procIcd の免除は **この段では残す**（6 件の旧フック互換）。撤廃は段取り 7 の祝福の作り直しで

**`PlayerStats` に足す**: `chainRevisits: number`（既定 0。+1 ごとに同じ敵へもう 1 度）、`chainCoefBonus: number`（既定 0。連鎖係数に `× (1 + これ)`。「連鎖の源」）。性質は段取り 7 で足す（今回は型と既定だけ。テストは stats を直に書いて確かめる）。

**JSON**: `SYNERGY.json` から `chainDecay` を削除、`maxDepth 3 → 8`、`keywordBudget 6 → 10`（減衰が無いぶん語の上限で暴走を止める。つまみ）、`procCoefficient` ブロックと `_fields` を足す。

**終わる保証**: 敵 N 体 × (1 + chainRevisits) 回までしか対象イベントが起きず、対象を持たないイベント（回復・気力）は次を生まない。確率 100% でも有限。

### 2-8. Rule の常時の倍と「〜につき」（Modifier）

**型**（`/home/user/roguelike/src/core/rules.ts` に足す）

```ts
/** 「〜につき」の数え方。数は評価の瞬間に system/modifiers.ts が数える */
export type PerCounter =
  | { kind: "combo" }                                    // 今のコンボ数
  | { kind: "targetStatusKinds" }                        // 対象の敵に付いている状態異常の種類数
  | { kind: "targetStacks"; status: StatusKind }         // 対象の敵の status のスタック
  | { kind: "selfStatusKinds" }                          // 自分に付いている状態異常の種類数
  | { kind: "nearbyEnemies"; radius: number }            // 自分の周りの敵の数
  | { kind: "chainVisits" }                              // この連鎖で繋いだ敵の数（GameEvent.visits の種類数。イベント経由の一撃だけ）
  | { kind: "missingHpTenths" }                          // 失った生命の 10% ごと
  | { kind: "stat"; stat: "critChance" | "moveSpeedMul" | "dashCharges" | "projectileCount" | "armor" }   // 転じ（会心率 1% につき など。倍率系は (値 − 1) × 100）
  | { kind: "runKills" };                                // このランの撃破数（研鑽の素。段取り 10 で種類を足す）

export interface Modifier {
  id: string;                                            // ruleId と同じ作り（owner + 添字）
  kind: "increased" | "more";
  /** 何に掛かるか。damage のタグ（core/damage.ts の DamageTag）か "poise" */
  tag: DamageTag | "all";                                // "all" = 与ダメ全部
  /** 増: 0.1 = +10% / 倍: 1.2 = ×1.2。per があれば 1 単位あたり（倍は 1 + amount × 数） */
  amount: number;
  per?: { count: PerCounter; cap?: number };
  /** 全部満たすときだけ（空 = 常時）。RuleCondition をそのまま使う（targetHas / not / lane / swingStep / lowHp …） */
  if: readonly RuleCondition[];
  owner: EventSource;
}
```

**置き場**: `BoonDef.modifiers?`、`MovesetDef.modifiers?`、`SkillDef.modifiers?`（スロットに入っている石）、`SustainDef.modifiers?`、ジョブ `jobModifiers(job)`、装備 `PlayerStats.modifiers: Modifier[]`（性質 `apply` が push。段取り 7 で条件の族に使う）。集め方は `collectRules` と同じ固定順（`system/modifiers.ts` の `collectModifiers(state)`）。

**評価**（`system/modifiers.ts`）: `applyModifiers(state, ctx, subject): { increased: number; more: MoreMul[] }`。`subject` は `ConditionSubject`（pos = 敵の位置、targetId、targetStatus は生きている敵から写す）。`per` の数を `countPer` で数え、`cap` で切る。結果を 2-1 の `inc` と `more` に足す（`source: "mod:" + id`）。`tag` が ctx.tags に無ければ無視。怯み値は `tag: "poise"` だけを拾う。

**移行の見本 3 つ**（テストの材料。数値は JSON のまま）: 誓約「楔」`wedgeOath`（`traitHooks.ts:313` → `{kind:"more", tag:"all", amount: KEYSTONE.wedgeUnstaggeredMul, if:[{kind:"not", condition:{kind:"targetHas", status:"stagger"}}]}`）、ジョブ得意（`jobs.ts:55-58` → `{kind:"more", tag:"melee"|"ranged", amount: JOB.favoredMeleeMul, if:[{kind:"favoredWeapon"}]}`）、祝福「拍の刻」の代わりに新規で 1 枚「〜につき」の見本（`{kind:"increased", tag:"all", amount:0.02, per:{count:{kind:"combo"}, cap:1.0}}` を `BOONS` の既存 1 枚に **足さず**、テストの中だけで `rules` 引数として渡す）。他の誓約・性質のコード分岐は動かさない（段取り 7）。

---

## 3. 型の変更・JSON・テスト・REPLAY_VERSION・壊れそうなテスト

### 3-1. 型（共有ファイルは最小 Edit）

| ファイル | 変更 |
| --- | --- |
| `src/core/damage.ts`（新規） | `DAMAGE_TAGS` / `DamageTag` / `IncreasedTable` / `MoreMul` / `DamageContext` / `DamageBreakdown` / `createIncreased` / `sumIncreased` / `productMore` |
| `src/core/scale.ts`（新規） | `DepthCurve` / `curveAt` / `Spread` / `rollSpread` / `triangular` |
| `src/loot/types.ts` | `PlayerStats`: `meleeDamageMul` `rangedDamageMul` `skillDamageMul` `damageVsStaggeredMul` `burstDamageMul` を削り `increased` `more` `modifiers` `chainRevisits` `chainCoefBonus` を足す。`Item.innateLuck?` |
| `src/core/events.ts` | `GameEvent.visits?` `coef?`、`RuleRunState.visits` `coef`、`pushEvent` |
| `src/core/rules.ts` | `RuleEffect.procCoefficient?`、`PerCounter` / `Modifier` |
| `src/core/state.ts` | `Jin.hpMul: number`、`HitOptions.ctx?: DamageContext`（`combat.ts` 側の型なら `combat.ts`） |
| `src/system/boonDefs.ts` `data/weapons.ts` `skills/types.ts` `data/ultimates.ts` `data/jobs.ts` | `modifiers?: readonly Modifier[]` を 1 行ずつ |
| `src/data/enemies.ts` | `depthHpScale` の中身、`depthDamageMul` / `depthDamage` 追加、`depthDamageBonus` 削除 |
| `src/loot/stats.ts` | `computeStats(equipment, depth = 1)`、`SOFT_CAPPED_KEYS` 3 つ、`unarmed` を `more` へ |
| `src/loot/innate.ts` | `innateMeanBudget` の cap 外し・指数、`innateAt`、`collectInnate(equipment, depth)`、`rollInnate` の返り値に `luck` |
| `src/loot/flux.ts` | `nominalAt` の外挿、定数を `FLUX.json` へ |
| `src/data/tuning.ts` | `FLUX` の再 export 1 行、`ENEMY_SCALE` の注釈更新 |

### 3-2. 新しい / 変える balance JSON

| ファイル | 内容 |
| --- | --- |
| `enemies/ENEMY_SCALE.json` | `hpPerDepth 0.15`、`damagePerDepth 0.05`、`deepDepth 21`、`deepHpGrowth 1.12`、`deepDamageGrowth 1.04`。`_fields` 5 行 |
| `combat/POISE.json` | `depthScale` と `_fields` の行を削除 |
| `world/FLOOR_KIND.json` | `deepHpSlope` と `_fields` の行を削除（`deepDepth` は残す） |
| `loot/INNATE/budget.json` `hardCap.json` `_index.json` | `cap` 削除、`lowScale 0.6`、`hardCap.json` 削除、`_order` と `_fields` から `hardCap` / `budget.cap` を消す。`_note` の「予算 12 点で深度 31」を消す |
| `loot/FLUX.json`（新規） | 2-5 の定数一式 + `_fields`。`loot/_index.json` の `_order` に足す → `pnpm run balance:gen` |
| `loot/SYNERGY.json` | `chainDecay` 削除、`maxDepth 8`、`keywordBudget 10`、`procCoefficient: {…}`。`_fields` を足す（今このブロックには `_fields` が無い。`UNDOCUMENTED_BASELINE` は下げる方向） |
| `enemies/JIN.json` | `hpSpread: { low: 0.9, high: 1.1 }` + `_fields` |

### 3-3. テスト（新しい仕組みには必ず）

| ファイル | 内容 |
| --- | --- |
| `src/core/damage.test.ts` | 増は加算（+50% と +50% = ×2.0）、倍は乗算（×1.5 × ×1.5 = ×2.25）、属性タグは share の重み、下限 0.1、`productMore` は同じ source を後勝ちで 1 つ |
| `src/system/damageMods.test.ts` | `rollOutgoing` の内訳: 装備なしスライム深度 1 で今の probe と同じ威力（9 → 9）。誓約 1・芯 1・コンボ・会心が `breakdown.more` に出所ごとに並ぶ。怯み中の敵に `increased.vsStaggered` が効き `more` には出ない |
| `src/loot/stats.test.ts` | `softCap` の 136-153 は残す。`155-165`（+300% で 3 倍にならない）→「+300% は 4.0 倍になる（増は圧縮しない）」に、`199-215`（誓約はソフトキャップ後）→「誓約は `more` に入り増と掛け算」に書き換え。`:187`（glassCannon 2 倍）は `more` を見る |
| `src/data/meleeDamageScale.test.ts:127-131` | `0.18` → `0.15`、`depthHpScale(21+)` の指数、`depthDamageMul(1) = 1`、`depthDamage(10, 10) = 15` |
| `src/system/poise.test.ts:140` | `POISE.depthScale` → `depthHpScale(4)` |
| `src/system/jinSpawn.test.ts:64-66` | `maxHp` の式に `jin.hpMul` を掛ける（または `JIN.hpSpread` を `{low:1, high:1}` に差し替えて等倍で検査） |
| `src/system/floorLord.test.ts:72`、`enemyReactions.test.ts:407` | 深度 1 なら変わらない。深度を上げているなら `depthDamage` に |
| `src/loot/innate.test.ts` | `:101`（hardCap）削除。新規: `innateAt` は深度 1 で小さく深度 20 で 3-1 の例に近い（luck 1.3・筋 6 割生命 4 割 → 深度 8 で筋 +3 生命 +8 前後）、配分の比が保たれる、`luck` が無い旧アイテムは `innate` から復元、rng を引かない |
| `src/loot/flux.test.ts` | 定数の import を `FLUX` 経由へ。新規: `nominalAt(def, 40)` が最後の点を超える、`nominalAt(def, 26)` は据え置き |
| `src/system/rules.test.ts:91, 106-112` | 減衰の検査 → 等倍に。`:94-104` は `maxDepth 8` でそのまま。新規: 同じ敵へ 2 度目は Rule が起きない・`chainRevisits 1` で起きる、`coef 0.5` の効果の次の Rule は `chance 1` でも半分（seed 固定で回数を数える）、対象のいない効果で連鎖が終わる、`visits` の長さが `maxDepth` を超えない |
| `src/system/modifiers.test.ts`（新規） | 楔の見本が怯んでいない敵にだけ倍、得意武器の見本、「コンボ 10 につき増 +2%（上限 100%）」、`tag` が合わなければ無視、`poise` タグは怯み値だけに効く |
| `src/core/replay.test.ts` | `REPLAY_VERSION` の比較は相対なので壊れない。`seed 固定の再生一致` は各段で走らせて確認 |
| `src/data/balance/balance.test.ts` | 消した項目の `_fields` を消し忘れると落ちる。`UNDOCUMENTED_BASELINE` は SYNERGY に `_fields` を足すぶん下げる |
| `src/ui/scalingText.test.ts`、`loot/describe.test.ts`、`system/keywords.test.ts` | `meleeDamageMul` を参照していれば `increased.melee` に |
| QA: `src/qa/simulation.test.ts`、`combatProbe.test.ts` | 縮小版が通ること。`probe.md` / `report.md` は 4d で作り直す |

### 3-4. `REPLAY_VERSION`

`/home/user/roguelike/src/core/replay.ts:56` を段ごとに上げる: **17**（4a: 増と倍・ソフトキャップ撤去。会心の乱数位置は同じだが値が変わる）、**18**（4b: 敵の曲線・地金・揺らぎで `state.rng` の消費が増える〈陣の hpSpread〉）、**19**（4c: 連鎖係数で `chance ≥ 1` の Rule も乱数を引く）。`docs/ARCHITECTURE.md:136` の版の一覧に 1 行ずつ足す。

---

## 4. 段階分けとレーン（各段で遊べる。`docs/AI_WORKFLOW.md` の作法）

### 前置き（統合役、各段の頭に 30 分）: 共有の型を先に 1 コミット

- 4a の前: `core/damage.ts` の型と純関数、`PlayerStats` の新フィールド + `DEFAULT_STATS` + `createBaseStats` の複製、`OutgoingHit.breakdown?`。この時点では旧フィールドも残し tsc を通す
- 4c の前: `core/events.ts` / `core/rules.ts` の型追加（`visits` / `coef` / `procCoefficient` / `Modifier`）、各 Def の `modifiers?` 1 行

### 4a. 増と倍（遊べる: 与ダメの式だけ変わる）

| レーン | 所有 | 最小 Edit | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- |
| A1 計算（Opus か Sonnet） | `system/damageMods.ts`（新規）、`system/combat.ts` の `rollOutgoing` / `damageEnemy` の怯み値、`system/keystones.ts` `boonCores.ts` `ultimates.ts:793` `statusEffects.ts:200` の返り値を `MoreMul` に、`damageMods.test.ts` | `system/traitHooks.ts`（`traitOutgoingMul` を `traitIncreased` に改名するだけ） | `loot/*`、`ui/*` | 装備なし深度 1 の probe の威力が同じ。`pnpm exec vitest run src/system` |
| A2 集計（Sonnet） | `loot/types.ts` の旧フィールド削除、`loot/stats.ts`、`loot/affixes.ts` の `apply` 全件（`+= pct(v)` → `increased.<tag>`、`*=` → `more.push`）、`loot/resonance.ts`、`data/jobs.ts` `system/jobs.ts:55-58`（得意は `more`）、`system/hub.ts`、`system/keywords.ts`、`loot/stats.test.ts` | `system/boons.ts:612-614`（`triggerHappy` の `rangedDamageMul *=` → `more`） | `system/combat.ts` | tsc が旧フィールドの参照 0 件。`stats.test.ts` 書き換え済み |
| A3 表示（Sonnet） | `ui/scalingText.ts` 計算式の頁に増・倍の内訳、`loot/describe.ts` `statsSummary` の文言「増 +X%」「倍 ×Y」、`docs/GLOSSARY.md` に「増 / 倍」 | `render/*`（呼び出し 1 箇所） | ロジック全部 | 単一指標を出さない検査（`stats.test.ts:243`）が通る |

統合: A2 → A1 → A3 の順に `git add <所有>`。`REPLAY_VERSION 17`。`pnpm run check`。

### 4b. 敵の曲線・地金・曲線の末端・揺らぎの器（遊べる: 敵と地金の数値が変わる）

| レーン | 所有 | 最小 Edit | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- |
| B1 敵（Sonnet） | `data/enemies.ts:376-383`、`ENEMY_SCALE.json`、`POISE.json` / `FLOOR_KIND.json` の削除、`system/poise.ts:27-30`、`system/runEvents.ts:365-380` の削除、`depthDamageBonus` 57 箇所の置換（`system/enemies.ts` `enemyWave3.ts` `enemyBehaviors.ts` `enemyTraits.ts` `enemyLeap.ts` `boss*.ts` `bossKit.ts`）、`meleeDamageScale.test.ts` `poise.test.ts` | `core/scale.ts` を使うだけ | `loot/*` | 深度 1 の probe が変わらない。深度 10 の接触が `round(10 × 1.45)` |
| B2 地金（Opus） | `loot/innate.ts`、`loot/generator.ts:553`、`loot/migrate.ts`（`innateLuck` 補完）、`loot/types.ts` の `Item.innateLuck?` 1 行、`loot/stats.ts` の `computeStats(equipment, depth)`、`INNATE/*.json`、`loot/describe.ts:293`、`innate.test.ts`、呼び出し側で深度を渡す 7 箇所、`system/floor.ts:912-914`（fresh でも `refreshRunStats`）、`system/runSetup.ts:223-225` | `core/game.ts:53` `core/replay.ts:693` `system/loot.ts:294` `system/jobs.ts:121` `ui/inventory.ts:296` `render/dropTooltip.ts:101-102`（引数 1 つ） | `system/combat.ts`、`data/enemies.ts`（`depthHpScale` を import するだけ） | 深度 20 の持ち込み遺物の地金が 3-1 の例に近い。旧セーブが読める |
| B3 曲線の末端と揺らぎ（Sonnet） | `loot/flux.ts`、`loot/FLUX.json`（新規）、`loot/_index.json`、`data/tuning.ts` 1 行、`flux.test.ts`、`docs/LOOT_DESIGN.md` の揺らぎの節 | — | `loot/innate.ts` | `nominalAt(def, 40) > nominalAt(def, 26)`。`balance:gen` 済み |
| B4 揺らぎの器（Sonnet） | `core/scale.ts`（新規）+ `scale.test.ts`、`system/jinSpawn.ts`（陣の `hpMul`）、`core/state.ts` の `Jin.hpMul` 1 行、`JIN.json` の `hpSpread`、`jinSpawn.test.ts` | `loot/flux.ts:154` と `loot/innate.ts:86` の `triangular` を `core/scale.ts` の import に置き換え（B3・B2 と衝突するので **統合役が最後に**） | それ以外 | 同じ陣のメンバーの `maxHp / def.hp` が揃う。陣に属さない敵は等倍 |

統合: B4（core/scale.ts）→ B1 → B2 → B3 → triangular の一本化。`REPLAY_VERSION 18`。

### 4c. 連鎖・Modifier（遊べる: 連鎖の止まり方と条件付きの倍が文法に乗る）

| レーン | 所有 | 最小 Edit | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- |
| C1 連鎖（Opus） | `core/events.ts` の `pushEvent`、`system/rules.ts` の `tryRule` / `runRule` / `applyRuleEffect`、`SYNERGY.json`、`loot/types.ts` の `chainRevisits` / `chainCoefBonus` 2 行、`rules.test.ts`、`render/chainUi.ts`（`depth` 表示が減衰前提なら文言だけ） | `core/rules.ts`（`PROC_COEFFICIENT` の読み口 1 関数） | `system/damageMods.ts` | 同じ敵へ 2 度目で止まる。`chance 1` × `coef 0.5` が半分。`maxEventsPerStep` の drop が QA 縮小版で 0 |
| C2 Modifier（Opus） | `system/modifiers.ts`（新規）+ `modifiers.test.ts`、`system/damageMods.ts` の `applyModifiers` 呼び出し 3 行、`system/jobs.ts`（得意を Modifier に。A2 で `more` にしたものを置き換え）、`system/traitHooks.ts:313`（楔を Modifier に移し分岐を削る）、`system/keystones.ts` に `keystoneModifiers` | `system/boonDefs.ts` `data/weapons.ts` `skills/types.ts` `data/ultimates.ts` の `modifiers?` 1 行ずつ、`system/rules.ts` の `collectRules` の隣に `collectModifiers` を export（C1 と同ファイル → 統合役が置く） | `core/events.ts` | 見本 3 つのテスト。`docs/recipes/boon.md` / `skill.md` に「常時の増・倍は `modifiers`」の 1 節 |

統合: 前置き → C1 → C2。`REPLAY_VERSION 19`。

### 4d. 計測（コード変更は qa/ と docs だけ。Sonnet 1 レーン + 統合役の判断）

- `qa/combatMetrics.ts` の帯を `1-5 / 6-10 / 11-15 / 16-20 / 21+` に（`DEPTH_BANDS`）。`buildCombatSection` は帯が増えるだけ
- `qa/combatProbe.ts` の `depths` に 15 / 20 を足し、**深度に見合う地金つき**の型を 1 つ足す（`computeStats(equipment, depth)` に、`generateItem` で `itemLevel = depth` の並の遺物 6 部位。seed 固定）
- フル QA に足す指標: 帯ごとの撃破秒・被弾/60 秒・被弾で死ぬまでの回数（`maxHp ÷ 平均被ダメ`）、死亡時の `DamageBreakdown` の平均（増の Σ・倍の Π・倍の出所数）、連鎖の長さの分布（`state.chains` の depth ヒストグラム）と `ruleRun.droppedEvents`、陣の `hpMul` の分布、装備パターン別の **踏破率**（深度 21 到達）と到達深度の中央値
- `createGame` に開始深度を渡す型（`RunSetup.startDepth?`。QA 専用、UI に出さない）を **統合役が判断**（不確かな点 3）

---

## 5. 数値の目標と調整つまみ、測る指標

難易度の目標: 平均的なランは「クリアがちょっと難しい」（3-14。そこそこ上手い人が 5〜10 回目で初めて踏破）。bot は人より弱いので bot の値は低めに置く。

| 指標 | 今（probe / report） | 目標 | つまみ |
| --- | --- | --- | --- |
| 地力の伸び ÷ 敵の生命（深度 d の並の遺物 6 部位の `Σ増 + 地金` を深度 1 比で、`depthHpScale(d)` と比べる） | 未計測（地金は 31 で頭打ち、性質は 26） | 0.85〜0.9（build-core 5-1） | `INNATE.budget.perDepth`（0.35）、`FLUX.globalScale`（0.8）、`ENEMY_SCALE.hpPerDepth`（0.15） |
| 撃破秒（装備なし剣・スライム 1 対 1） | 深度 1: 1.08 / 5: 1.34 / 10: 2.14 | 装備なし: 深度 10 で深度 1 の 2 倍前後（今と同じ）。深度に見合う地金つき: 深度 10 / 20 で 1.3〜1.5 倍 | 同上 |
| 被弾で死ぬまでの回数（深度に見合う地金つき） | 未計測 | 深度 1: 6〜8 発、深度 10: 5〜7、深度 20: 4〜6（深みで「2 発で死ぬ」にしない） | `ENEMY_SCALE.damagePerDepth`（0.05）、`INNATE.armor.perPoint`、`pointValue.attr` |
| 相乗の倍 Π（死亡時の平均） | 未計測 | 章 2 で ×1.5〜3、章 4 で ×5〜12（build-core 5-1） | 倍を出す札の数（段取り 7）。この段では観測だけ |
| 標準ビルド bot の踏破率（深度 21 到達）/ 到達深度の中央値 | 到達 1.0〜2.5（bot が弱い） | 踏破率 5〜10%、中央値 12〜15 | 上の全部。まず bot を段取り 2 の回避つきに揃える |
| 連鎖の長さ | 深さ 3 で必ず止まる | 平均 1.5〜3、深さ 8 到達 1% 未満、`droppedEvents` 0 | `procCoefficient` の表、`keywordBudget`（10）、`maxDepth`（8） |
| 陣の生命の揺らぎ | なし | 陣ごと ×0.9〜1.1。同じ陣の中は揃う | `JIN.hpSpread` |
| 弱点 / 耐性の発生比 | 弱点 2% / 耐性 9.8%（build-core 3-1） | この段では触らない（段取り 7） | — |

`pnpm run qa:probe`（深度 1 の表が 4a・4b で変わらないことの確認）→ `pnpm run qa:full`（4b・4c の後に `report.md` を作り直す）。

---

## 6. 不確かな点（推奨を 1 つ決めて書く。統合役が確定）

1. **深みの開始深度**: `FLOOR_KIND.deepDepth` は 30（部屋の敵数・変異の開始）、build-core 3-2 は 21。→ **推奨: `ENEMY_SCALE.deepDepth 21` を曲線専用に新設し、`FLOOR_KIND.deepDepth 30` はそのまま**。run-arc（段取り 6）で章と出口が入ったときに 1 つに統一する。確認: `grep -rn deepDepth src` で参照を分ける
2. **`Rule.direct` の撤廃時期**: build-core 3-5 は廃止。→ **推奨: この段では減衰だけ消し、`direct` は残す**（6 件の旧フック祝福の回数を変えない）。撤廃は段取り 7 の祝福の作り直しと同時。確認: `grep -rn "direct: true" src` の 6 件がテストで回数を固定しているか
3. **QA の開始深度**: `createGame` は深度 1 固定（`core/game.ts:60`）。深度 10 / 20 の踏破率を測るには開始深度が要る。→ **推奨: `RunSetup.startDepth?: number` を足し、`createGame` が `depth` の初期値に使う。リプレイに記録し（`REPLAY_VERSION 19` に同梱）、UI には出さない**。確認: `runSetup.ts` の `RunSetup` 型と `captureLoadout`
4. **`p.buffs.damage` の複数化**（build-core 3-1「時限の強化は出所ごとに倍として積む」）: → **推奨: この段は 1 本のまま `MoreMul` に写す**。戦意（段取り 5）で `TimedMul[]` にする。確認: `grep -rn "buffs.damage" src` の書き込み箇所（`ultimates.ts:505` ほか）
5. **旧フィールドの削除か据え置きか**（`meleeDamageMul` 50 箇所）: → **推奨: 削除**。tsc が全件を拾い、意味の違う値（加算 vs 乗算）を残さない。Sonnet 1 レーン（A2）で機械的に置換できる
6. **地金の上振れ `innateLuck` の保存**: `innate` から復元できるので保存しなくてもよい。→ **推奨: 保存する**（丸めの復元に依存せず、名のある遺物や `plain` の器で `innate` が空でも定義できる）。`Profile.version` は変えない（欠けていれば `migrate.ts` が補う）
7. **`FLUX.globalScale`（0.8）**: 下振れを狭めると平均が上がる。→ **推奨: 4b では据え置き、4d の「地力 ÷ 敵の生命」を見て 0.75 に下げるか決める**
8. **`keywordBudget` 6 → 10**: 減衰が消えるぶん語の上限で暴走を止めたいが、上げすぎると 1 秒に 10 回の爆発が起きる。→ **推奨: 10 で始め、4d の連鎖長の分布と `droppedEvents` で決める**

---

## 資料に必要な変更（統合役）

- `docs/CODE_MAP.md`: core に `damage.ts`（増と倍の型）・`scale.ts`（深度曲線と揺らぎ）、system に `damageMods.ts`（与ダメの増・倍の集約。`combat.ts` はこれだけを呼ぶ）・`modifiers.ts`（Rule の常時の増・倍と「〜につき」）、loot の `stats.ts` の「ソフトキャップ」を「攻撃速度・連射・移動速度だけ」に、`innate.ts` に「持ち込みは今の深度で決め直す `innateAt`」、`flux.ts` に「定数は `loot/FLUX.json`」
- `docs/ARCHITECTURE.md:136`: `REPLAY_VERSION` 17 / 18 / 19 の理由を 1 行ずつ。決定性の節に「連鎖係数で `chance ≥ 1` の Rule も乱数を引く」
- `docs/STATS_AND_SCALING.md` 3 章: 「最終の与ダメ = 基礎 × (1 + Σ増) × Π倍 × 敵側」に書き換え、増と倍の出し分けの表（2-1 の写す規則）を足す
- `docs/COMBAT_DESIGN.md` A-4 / A-6 / D-1: ソフトキャップの記述、`depthScale 0.08`、与ダメの合成順序を新しい式に
- `docs/BALANCE.md`: `enemies/ENEMY_SCALE.json` の行に攻撃・深みの項目、`loot/` に `FLUX.json`
- `docs/recipes/affix.md` / `boon.md` / `skill.md`: 「数値は `increased.<tag>` に足す。常時の倍・条件付き・〜につきは `modifiers`。`*Mul *=` は書かない」
- `docs/GLOSSARY.md`: 増 / 倍 / 連鎖係数 / 訪問（同じ敵へ跳べる回数）の表示文字列
- `docs/ideas/core-synthesis.md` 9 章の段取り 4 に「実装設計: `docs/ideas/scaling-impl.md`」を 1 行（この設計書を統合役が置く場合）
- `IDEAS.md` 現状節、`CHANGELOG.md` `[Unreleased]`