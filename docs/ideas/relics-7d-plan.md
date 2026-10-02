# 遺物の確定リスト（段取り 7d）

作成日: 2026-09-30。`docs/ideas/boon-impl.md` 2-10 を、architect が機械集計で実装レーンに渡せる表まで確定したもの。統合役の決定: ★ 属性の変換 6 は残す（通常攻撃の属性を変える手段を武器のベースだけにしないため）。写しの表 `LEGACY_AFFIX_MAP`（210）/ `LEGACY_UNIQUE_MAP`（76）は実装で `src/loot/migrate.ts` に入る。


作成: architect（2026-09-30）。根拠の機械集計は `scratchpad/p7d/`: `affixes.tsv` / `conversions.tsv` / `keystones.tsv` / `uniques.tsv`（今の定義の書き出し。列 = key / 色 / tags / 部位 / 段階 / 右手の家系 / 目覚め / apply が触る欄 / 表示）、`decide.mjs`（振り分けと検算。`node decide.mjs`）、`affix_actions.tsv`（旧 key 290 の行き先）、`keys.json`、**`LEGACY_AFFIX_MAP.ts.txt` / `LEGACY_UNIQUE_MAP.ts.txt`（そのまま貼れる形）**、`dump.test.ts`（書き出しの vitest。`npx vitest run --config p7d/vitest.config.mjs`）。

## 0. 結論

- 性質 212 → **71**（条件の族 25 + 行動 43 + 来歴 3）。旧 key を残すのが 58、新 key 13。消える 154 のうち 19 は近い性質へ写し（値は写し先の期待値で取り直す）、135 は消して余白 +1。地金の行（`attr_*` 6・`res_*` 6・`armorFlat`）の 13 は **定義を残して抽選から外す**（`innate.ts` が性質の定義の apply を使っているため、消すと地金が壊れる）
- 転じ **12**（新 10 + 残す 2）+ **属性の変換 6 を残す**（★: 消すと通常攻撃の属性を変える手段が武器のベースだけになる。6 章 1）。誓約 37 → **20**（残す 14 + 新 6）。消える誓約 23 のうち 11 は性質の条件の族・行動へ写す、12 は消す
- 名のある遺物 76 → **18**（全部に固有の Rule / Modifier / 分岐）。8 つは部位とベースが同じ旧遺物から写す（`LEGACY_UNIQUE_MAP`）、68 は `namedKey` を外して普通の遺物に（固有名は銘に写す）
- 共鳴は `system/resonance.ts`（新）。**語の数え = 遺物 1 つ / 札 1 枚 / 石 1 つ / 流儀 / 型 / 改鋳 1 つ / 誓約 1 つ をそれぞれ 1 と数える**。遺物の語は性質の定義に `keywords` を持たせて数える（今の `statsKeywords` は装備全体を 1 つにまとめ、地金の筋力で全遺物が「近接を強める」になるので数えに使えない）。彩刻・色解きは「共鳴している状態異常の語の色」を読む
- 残響 12 → 5: **砕く / 注ぎ（= 育てる）/ 移し / 呼び戻し / 煽り**。設計 2-10 の「注ぎを消す」と「育てる = 呼び戻し」は build-core 4-5 と矛盾するので、build-core の 5 つ（育てる = 来歴を注いで育てる = 注ぎ）に合わせた（6 章 2）
- レーンは設計の I / J / K / L のままだと `loot/stats.ts`・`system/rules.ts`・`loot/types.ts`・`system/statusEffects.ts` を 3 レーンが同じ関数で触る。**型と口を前置き P に集め、I ∥ J ∥ K ∥ L を並べる**（7 章）。7c の残り（G・H2）が入ってから始める

---

## 1. 性質 71

### 1-1. 決まり（`loot/affixes.ts`）

- `AffixDef` に `keywords: KeywordProfile`（必須。共鳴の数え）を足し、`AffixTag` に `condition` を足す。条件の族は `tags` に `condition` を持つ
- **条件の族**は代償（v2）を持たない（条件が代償）。`apply` は `s.modifiers = [...s.modifiers, mod(v)]` で Modifier を足すか、下表の「欄」列の `traits.*` / 条件付きのタグ（`increased.vsStaggered` など）だけを動かす。owner は `{ kind: "item", key }`、id は `ruleId(owner, 0)`（`purseModifier` と同じ作り）
- **行動**は `statusProcs` / `triggers` / `traits.*` / 源の欄 / 行動の欄を動かし、代償は基礎の欄を **下げる** 向きだけ許す
- 地金の行 13 は `INNATE_LINE_DEFS`（新しい配列）へ移し、`affixDef(key)` は `AFFIXES` と `INNATE_LINE_DEFS` の両方を引く。`traitsFor` / `conversionsFor` / 染めの色の表（`generator.ts:381`）は `AFFIXES` だけを見る（抽選から外れる）
- 今の `TraitStats` の「条件付きの与ダメ」欄（`damagePerStatusKind` / `damagePerSelfStatus` / `windupDamageMul` / `offWindupPenalty` / `guardedDamageMul` / `bossDamageMul` / `nonBossPenalty` / `lockedDamageMul` / `unlockedPenalty` / `brandedMul` / `unbrandedPenalty` / `terrainDamageMul` / `offTerrainPenalty` / `slickDamageMul` / `enemyOnTerrainMul` / `fullManaSkillMul` / `branchDamageMul` / `reaperDamageMul` / `darkRangedMul` / `lightRangedPenalty` / `brokenMul` / `favored*` / `unfavored*` / `noJobDamageMul` / `jobPenalty` / `spread*` / `homingPoison` / `boonEcho*` / `alternate*` / `repeatPoisePenalty` / `fearPoiseMul` / `silencedPoiseMul` / `vulnerablePoiseMul` / `guardedPoiseMul` / `corrodePoiseMul` / `critPoiseMul` / `rangedPoiseMul` / `weakenedGuard` / `weakenedExposure` / `elementalGuard` / `physicalExposure` / `silencedKillMana` / `lastKillManaRatio` / `lowManaGainMul` / `lowManaSkillMul` / `doomKillMana` / `weakHitMana` / `chargedPoiseMul` / `chargedHitEnergy` / `placedExtend` / `healOnStagger` / `engagedKillEnergy` / `unchargedPenalty` / `nonWeakPenalty` / `resistPierce` / `wedgePenalty`）は **削除**し、`traitHooks.ts` の読む側も消す。残す欄は下表の「欄」列に出るものと、来歴・装備の文脈（`gear*`）と、共鳴・星座が持ち込んだ 3 つ（`highHpDamageMul` / `lowHpGuard` / `triggerIcdCut`。K が消す）
- 新しい数値（窓の秒・every・上限）は `balance/loot/TRIGGER.json` の `trait` ブロックに足す（`tuning.ts` を触らずに済む）。期待値曲線は `balance/loot/affixCurves/<key>.json` + `_index.json` の `_order`

### 1-2. 条件の族 25（Modifier / 条件付きの欄）

`M(all, …)` = `{ kind: "increased", tag: "all", amount: v/100, if: […] }`。窓 W は `TRIGGER.trait.momentWindowSec`（2 秒、新）。

| # | key | 表示（label） | 条件 | 形 | 色 / 部位 | 語（源 / 糧 / 強め） | 写し込む旧 key |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C01 | `damageVsStaggered` | 怯み中の敵へのダメージ +{v}% | 相手が怯み中 | `increased.vsStaggered`（据え置き） | 紅 / 右手・指輪 | — / stagger / — | |
| C02 | `guardedBane` | 堅守中の敵への与ダメージ +{v}% | 相手が堅守 | `M(all, targetHas guarded)` | 紅 / 右手 | — / stagger / — | shieldSplitter |
| C03 | `readAhead` | 予備動作中の敵への与ダメージ +{v}% | 相手が予備動作中 | `M(all, trigger targetInWindup)`（v2 の罰を外す） | 金 / 右手 | — / counter / — | |
| C04 | `kaleidoscope` | 相手の状態異常 1 種につき与ダメージ +{v}% | 相手の状態異常の種類 | `M(all)` + `per targetStatusKinds`（v2 を外す） | 金 / 右手・指輪 | — / reaction / — | |
| C05 | `brandDetonator` | 烙印の敵への与ダメージ +{v}% | 相手が烙印 | `M(all, targetHas brand)`（v2 を外す） | 金 / 右手・指輪・首飾り | — / `STATUS_KEYWORDS.brand` / — | |
| C06 | `conductor` | 濡れ・浸水・油膜の敵への与ダメージ +{v}%（雷・炎の割合でさらに上がる） | 相手が濡れ / 油膜 | `traits.wetConductMul` と `traits.oiledIgniteMul` に同じ v（属性の割合で伸びるので Modifier にしない） | 金 / 右手・指輪・首飾り | — / reaction / shock・burn | igniter, stormConduit |
| C07 | `terrainHunter` | 地形の上にいる敵への与ダメージ +{v}% | 相手が地形の上 | `M(all, targetOnTerrain any)` | 紅 / 右手・指輪 | — / — / — | mireLord |
| C08 | `prismEdge` | 属性の弱点を突いた命中の与ダメージ +{v}% | 弱点を突いた | `traits.weakDamageMul`（据え置き。v2 の罰を外す） | 紅 / 右手・首飾り | — / — / — | weakInsight, sevenHues, ks_weakOath |
| C09 | `downHunter` | 精鋭・ボスへの与ダメージ +{v}% | 相手が精鋭 / ボス | `increased.vsElite` と `increased.vsBoss` に v（v2 を外す） | 金 / 右手・首飾り | — / elite / — | |
| C10 | `fullTide` | 気力が満ちている間、スキル威力 +{v}% | 気力が満タン | `{ increased, tag: "skill", if: manaFull }`（v2 を外す） | 蒼 / 体・首飾り | — / mana / — | |
| C11 | `desperation` 新 | 瀕死の間、与ダメージ +{v}% | 生命が `SYNERGY.lowHpRatio` 以下 | `M(all, lowHp)` | 冥 / 体・指輪・首飾り | — / lowHp / — | ks_berserker |
| C12 | `moraleSurge` 新 | 戦意 10 につき与ダメージ +{v}% | 戦意 | `M(all)` + `per morale every TRIGGER.trait.moraleEvery(10)` | 紅 / 右手・首飾り | — / — / — | |
| C13 | `fever` | 自分の状態異常 1 種につき与ダメージ +{v}% | 自分の状態異常 | `M(all)` + `per selfStatusKinds`（v2 を外す） | 冥 / 体・首飾り | — / hurt / — | |
| C14 | `lockdownFury` | 交戦中の部屋で与ダメージ +{v}% | 交戦中 | `M(all, roomLocked)`（v2 を外す） | 紅 / 右手・体・指輪 | — / clear / — | ks_backwater |
| C15 | `groundRooted` | 地形の上に立つ間、与ダメージ +{v}% | 自分が地形の上 | `M(all, selfOnTerrain any)`（v2 を外す） | 翠 / 体・足・指輪 | — / — / — | groundWisdom, slickFooting, ks_slickOath |
| C16 | `finisherEdge` 新 | 終撃の与ダメージ +{v}% | 終撃 | `M(all, finisher)` | 紅 / 右手・指輪 | — / finisher / — | |
| C17 | `releaseEdge` 新 | 放出の一撃の与ダメージ +{v}% | 放出 | `increased.release`（条件付きのタグ） | 金 / 右手・首飾り | — / — / — | |
| C18 | `riposteEdge` 新 | 応手の後 2 秒間、与ダメージ +{v}% | 直前に応手 | `M(all, recent onRiposte within W)` | 金 / 右手・頭・指輪 | — / counter・just / — | |
| C19 | `twinEdge` 新 | 双撃の後 2 秒間、与ダメージ +{v}% | 直前に双撃 | `M(all, recent onTwinStrike within W)` | 蒼 / 右手・指輪 | — / combo / — | |
| C20 | `firstStrikeEdge` 新 | 先制の後 2 秒間、与ダメージ +{v}% | 直前に先制 | `M(all, recent onFirstStrike within W)` | 蒼 / 頭・足・首飾り | — / — / — | |
| C21 | `branchArt` | コンボ派生の命中の与ダメージ +{v}%、命中で気力 +{v2} | 派生の振り | `M(all, branchSwing)` + `traits.branchHitMana`（v2 は利得なので残す） | 金 / 右手・首飾り | mana / combo / — | formBreaker, schoolSecret |
| C22 | `chargeCore` | 溜めの段 1 つにつき近接ダメージ +{v}% | 溜めの段 | `traits.chargedMeleeMul`（据え置き。`unchargedPenalty` を外す） | 紅 / 右手・指輪 | — / melee / melee | fullCharge, ks_chargeOath |
| C23 | `comboDamage` | コンボ 10 につき与ダメージ +{v}%（上限 {v2}%） | コンボ数 | `M(all)` + `per combo every TRIGGER.trait.comboEvery(10) cap v2/100`（基礎の欄 `comboDamagePerStack` は触らない。**単位が変わるので値を取り直す**） | 金 / 右手・指輪・首飾り | — / combo / — | |
| C24 | `justDodgeDamage` | 見切りの後 {v2} 秒間、与ダメージ +{v}% | 直前に見切り | `M(all, recent onJustDodge within v2)`（基礎の欄 `justDodgeDamageMul` は触らない） | 金 / 足・指輪・首飾り | — / just / — | |
| C25 | `purse` | 懐: 持ち金が 50 以上の間、与ダメージ +{v}% | 持ち金 | 据え置き（`purseModifier`） | 紅 / 右手・指輪・首飾り | — / — / — | |

### 1-3. 行動 43

| # | key | 表示（今の label を基に。変えるものだけ書く） | 形（欄） | 色 / 部位 | 語 | 写し込む旧 key |
| --- | --- | --- | --- | --- | --- | --- |
| B01 | `burn` | 据え置き | `burnChance` / `burnDps`（源の欄） | 紅 / 右手・指輪 | burn / — / — | |
| B02 | `chill` | 据え置き | `chillChance` / `chillSlow` | 蒼 / 右手・指輪 | chill | |
| B03 | `shock` | 据え置き | `shockChance` / `shockDamage` | 金 / 右手・指輪 | shock | |
| B04 | `explodeOnKill` | 据え置き | `explodeOnKillChance` / `explodeDamage` | 紅 / 右手・首飾り | explode / kill | |
| B05 | `procBleed` | 据え置き | statusProcs | 紅 | bleed / melee | |
| B06 | `procPoison` | 据え置き | statusProcs | 冥 | poison | |
| B07 | `procFear` | 据え置き | statusProcs（会心時） | 金 | fear / crit | |
| B08 | `manaOnStagger` | 汲み上げ（据え置き。代償 v2 も残す） | `traits.manaOnStagger` | 蒼 | mana / stagger | |
| B09 | `manaShield` | 身代わり（据え置き） | `traits.manaShieldCost` | 翠 / 体 | ward / mana | |
| B10 | `manaOverflow` | 溢れ（据え置き） | `traits.manaOverflowToEnergy` | 蒼 | energy / mana | |
| B11 | `justBreath` | 見切りの息吹（据え置き） | triggers | 蒼 / 足・指輪 | mana / just | |
| B12 | `switchBreath` | 手替えの呼吸（据え置き） | `traits.switchMana` | 蒼 | mana / melee・ranged | battleRhythm |
| B13 | `plagueSeed` | 疫病の種（据え置き） | triggers | 冥 | poison / kill | |
| B14 | `rotBurst` | 腐爆（据え置き） | triggers | 冥 / 右手 | explode / reaction | |
| B15 | `inheritance` | 形見（据え置き） | `traits.inheritCharges` | 冥 / 右手 | — / kill / reaction | |
| B16 | `wedge` | 楔: 怯みの蓄積が半分を超えた敵への怯み値 +{v}%（v2 の罰を外す） | `traits.wedgePoiseMul` | 紅 / 右手 | — / stagger / stagger | ks_wedgeOath |
| B17 | `guardPiercer` | 剥がし: 堅守中の敵への怯み値の減衰を {v}% 打ち消す（近接・射撃とも。v2 を外す） | `traits.guardPierce`（射撃だけ → 全部に広げる。`ks_chokehold` の読みを吸収） | 蒼 / 右手 | — / stagger | ks_chokehold |
| B18 | `staggerQuake` | 崩れの反響（据え置き） | `traits.staggerQuake` | 紅 | stagger・area / stagger | |
| B19 | `staggerSpark` | 崩れ雷（据え置き） | triggers | 金 | shock / stagger | |
| B20 | `staggerMark` | 崩れの刻印（据え置き） | triggers | 冥 | vulnerable / stagger | |
| B21 | `firstMove` | 先の先（据え置き。部位を右手・頭・首飾りに絞る） | triggers | 金 | stagger / counter | windupCrack |
| B22 | `counterWave` | 返し波（据え置き） | triggers | 紅 / 右手 | area / counter | kickback |
| B23 | `curtainCall` | 幕引き（据え置き） | `traits.lastKillClearsBullets` / `lastKillEnergy` | 金 | energy / clear | |
| B24 | `energyReserve` | 据え置き | triggers | 金 | ward / energy・hurt | |
| B25 | `backlash` | 逆撫で（据え置き） | `traits.resistedInflict` | 冥 / 右手 | reaction | counterGrain |
| B26 | `elementalBreak` | 崩れの属性（据え置き） | `traits.elementBreak` | 冥 | reaction / stagger | hueBreak |
| B27 | `rapidBrand` | 連射の烙印（据え置き） | `traits.rapidBrandChance` | 冥 / 右手 | brand の語 / ranged | |
| B28 | `terrainBurst` | 地脈の炸裂（据え置き） | `traits.terrainKillBlast` | 紅 | area / kill | |
| B29 | `emberTrail` | 残り火（据え置き） | `traits.burningKillFire` | 紅 / 右手・足 | burn / burn・kill | emberWalk, ks_emberOath |
| B30 | `frostTrail` | 霜の轍（据え置き） | `traits.dashIceTrail` | 蒼 / 足 | chill / dash | frostWalk |
| B31 | `groundMend` | 土の息（据え置き） | `traits.terrainRegen` | 翠 | heal | ks_earthOath |
| B32 | `echoSlash` | 余韻斬り（据え置き） | `traits.comboBreakWave` | 金 | area / combo | |
| B33 | `stake` | 撃ち込み杭（据え置き） | `traits.stakeDamage` | 金 / 右手 | explode / bullet・melee | |
| B34 | `placedInfuse` | 置き土産（据え置き） | `traits.placedInfuse` | 翠 | — / placed・melee | |
| B35 | `bloodSignature` | 血の署名（据え置き） | `traits.lowHpSkillHaste` | 冥 | — / lowHp / mana | |
| B36 | `siegeGuard` | 籠城: 交戦中の部屋で被ダメージ -{v}%（v2 の罰を外す） | `traits.engagedGuard` | 翠 / 体・首飾り | ward / clear | siegeHeart |
| B37 | `stanceGuard` 新 | 近接を振っている間、被ダメージ -{v}% | `traits.stanceGuard`（新。`ks_stanceOath` の判定 `traitHooks.ts` wave2IncomingMul を欄に置き換える。罰なし） | 翠 / 体・頭 | ward / melee | ks_stanceOath |
| B38 | `bulletCut` | 据え置き | `bulletCut`（行動の欄） | 蒼 / 右手 | — / bullet | |
| B39 | `unmoving` 新 | 踏ん張り: 被弾で押し戻されない。立ち止まっている間、被ダメージ -{v}% | `traits.unmoving`（新。0 より大 = 押し戻し無効・静止中の被ダメ減。`KS.juggernaut` の 2 か所 `combat.ts` / `player.ts` をこの欄に置き換え、静止は `player.body.vel` の長さ 0） | 翠 / 体・足 | ward / still | ks_juggernaut |
| B40 | `chainSource` 新 | 連鎖係数 +{v}% | `chainCoefBonus`（行動の欄） | 金 / 指輪・首飾り | — / — / reaction | |
| B41 | `chainReturn` 新 | 連鎖が同じ敵へ戻れる回数 +{v} | `chainRevisits`（整数。曲線 1〜2） | 金 / 首飾り | — / — / reaction | |
| B42 | `moraleCap` 新 | 戦意の上限 +{v} | `moraleMaxAdd` | 紅 / 右手・首飾り | — | |
| B43 | `burnStack` 新 | 燃焼の重ねの上限 +{v} | `statusStackCapBonus.burn`（前置きで足す欄。`maxStacks` の敵側に足す） | 紅 / 右手・指輪 | — / — / burn | |

### 1-4. 来歴 3（据え置き）

`sapling`（若木）・`veteran`（歴戦）・`oldScars`（古傷）。`PROVENANCE_STEPS` から `wayfarer` / `kingslayerMark` / `keenMemory` を消す（`loot/traitContext.ts`）。

### 1-5. 消す性質（性質 212 のうち 154）と行き先

振り分けは `p7d/affix_actions.tsv`。検算: 残す 58 + 地金の行 13 + 写す 19 + 消す 122（地金へ 65・その他 57）= 212。

| 行き先 | key |
| --- | --- |
| **写す 19**（写し先の key は 1-2 / 1-3 の最右列） | shieldSplitter igniter stormConduit mireLord weakInsight sevenHues groundWisdom slickFooting formBreaker schoolSecret fullCharge battleRhythm windupCrack kickback counterGrain hueBreak emberWalk frostWalk siegeHeart |
| **地金へ（消す。余白 +1）65**: 無条件の数値 | meleeDamagePct meleeDamageFlat attackSpeed meleeReach knockback rangedDamagePct rangedDamageFlat fireRate projectiles pierce projectileSpeed maxLife maxLifePct hpRegen lifeOnHit lifeOnKill damageTaken thorns moveSpeed dashCooldown dashCharge dashDistance critChance critMultiplier energyGain burstDamage burstRadius comboWindow hybridDamage hybridDefense hybridSpeed crushing frenzied overcharged reckless bloodbound ironclad razor pike flickering emberMomentum chainedBarrage deepPiercing wallSlammer vampiricRush stormcaller frostbite arcaneBattery gildedFang maxManaFlat manaRegenFlat manaGainPct manaCostPct manaOnKillFlat manaDrought arcaneFocus virulent statusWard heavyHand foreignEcho wayfarer keenMemory res_all wardingFlat sturdy |
| **消す（余白 +1）57**: 条件・行動の重複、得意武器（`favoredWeapon`）、色（祝福の響き・橋渡し・銘・反転・異色）、数えにくいもの | shatterEdge dashStrike finisherMend wardedSanctuary roomMender procVulnerable procWeaken procSilence lowTide ebbTide painToMana silencedKillMana lastKillMana counterMana weakenedGuard hurtWeaken procParalyze hurtCleanse staggerLeech fearPoise vortexCore vulnPoise staggerCharge dashVolley brimShock nightEyes reaperShadow inscribedWeight invertedFeast bridge kingslayerMark placedAnchor boonEcho_crimson boonEcho_azure boonEcho_jade boonEcho_gold boonEcho_umbra plunder weakRead resistBreaker elementalWard chargeQuake spreadCore spreadShove homingVenom schoolForm selfTaught wanderer schoolHarvest mireGuard brokenHunter corrodeClaw doomToll siegeSpark switchHitter schoolMastery brokenBreaker |
| **地金の行 13**（定義は `INNATE_LINE_DEFS` に残す。`item.affixes` にあれば消して余白 +1、`item.innate` は触らない） | attr_str attr_dex attr_vit attr_mnd attr_spi attr_def res_fire res_ice res_lightning res_poison res_dark res_light armorFlat |

目覚め（`loot/provenance.ts` の `MILESTONES`）の名指し 21 のうち、残る key を指すのは curtainCall / firstMove の 2 だけ。写しのあるものは写し先へ（emberWalk→emberTrail、siegeHeart→siegeGuard、frostWalk→frostTrail、hueBreak→elementalBreak、battleRhythm→switchBreath、kickback→counterWave、shieldSplitter→guardedBane、stormConduit→conductor、weakInsight・sevenHues→prismEdge、counterGrain→backlash、groundWisdom→groundRooted、mireLord→terrainHunter、fullCharge→chargeCore、formBreaker・schoolSecret→branchArt）、消えるもの（plunder / brokenBreaker / schoolMastery）は `awakening` を外す。節目の key は変えない（到達済みの節目に芽が出直さない）。**目覚め専用の性質は無くなる**（`awakening: true` の定義 0）ので、`isAwakeningKey` は残してよいが true を返す key は無い。

---

## 2. 転じ 12・属性の変換 6・誓約 20

### 2-1. 転じ 12（`CONVERSION_AFFIXES`）

| # | key | 表示 | 形 | 部位 | 語 |
| --- | --- | --- | --- | --- | --- |
| T01 | `cv_critToChain` 新 | 会心率 1% につき連鎖係数 +{v}% | `stage: "convert"`: `s.chainCoefBonus += s.critChance × 100 × v / 100` | 右手・指輪 | — / crit / reaction |
| T02 | `cv_speedToDamage` 新 | 移動速度の上昇 1% につき与ダメージ +{v}% | `M(all)` + `per stat moveSpeedMul`、`cap` は `TRIGGER.trait.speedToDamageCap` | 足・首飾り | — / dash |
| T03 | `cv_manaToProjectiles` 新 | 最大気力 40 につき弾数 +1（最大気力の {v}% ぶん）、気力自然回復 半分 | convert: `projectileCount += floor(maxMana × v/100 / 40)`、`manaRegen × 0.5`（40・0.5 は `TRIGGER.trait`） | 右手・首飾り | — / mana / bullet |
| T04 | `cv_armorToPoise` 新 | 防御力 10 につき怯み値 +{v}% | `{ increased, tag: "poise" }` + `per stat armor every 10` | 体・足 | — / — / stagger |
| T05 | `cv_lifeToArea` 新 | 最大生命 50 につき範囲攻撃の与ダメージ +{v}% | `{ increased, tag: "area" }` + `per stat maxHp every 50` | 体・首飾り | — / — / area |
| T06 | `cv_comboToFinisher` 新 | コンボ猶予 0.1 秒につき終撃の与ダメージ +{v}% | `M(all, finisher)` + `per stat comboWindow` | 足・指輪 | — / combo / finisher |
| T07 | `cv_coinsToMore` 新 | 持ち金 10 につき与ダメージ ×(1 + {v}%)（上限あり） | `{ kind: "more", tag: "all" }` + `per coins every 10 cap TRIGGER.trait.coinsMoreCap` | 指輪・首飾り | — |
| T08 | `cv_critToLightning` 新 | 会心で連鎖雷（{v} ダメージ） | Rule `onCrit` → `chainLightning`（icd `TRIGGER.trait.critRuleIcd`）を `s.rules` へ（前置きの口） | 右手・指輪 | shock / crit |
| T09 | `cv_critToCoins` 新 | 会心で銭 +{v} | Rule `onCrit` → `gainCoins`（icd 同上） | 指輪・首飾り | — / crit |
| T10 | `cv_critToMorale` 新 | 会心で戦意 +{v} | Rule `onCrit` → `gainMorale`（前置きで足す効果） | 右手・指輪 | — / crit |
| T11 | `cv_chargesToDistance` 残す | 据え置き | 据え置き | 足 | — / — / dash |
| T12 | `cv_projectilesToPoise` 残す | 据え置き | 据え置き | 右手・首飾り | — / bullet / stagger |

**属性の変換 6 を残す**（★ 6 章 1）: `cv_infuseFire` / `Ice` / `Lightning` / `Poison` / `Dark` / `Light`（語は elX を出す。今の STAT_RULES の `infuse.*` と同じ）。`CONVERSION_AFFIXES` は 18 件。

消す変換 33（すべて null・余白 +1）: cv_meleeToBurn cv_splitToPierce cv_critToMultiplier cv_speedToAttack cv_lifeToArmor cv_leechToEnergy cv_comboToJust cv_meleeToRanged cv_critToBurn cv_regenToGain cv_knockbackToPoise cv_poiseToDamage cv_lifeToMana cv_manaToLife cv_energyToMana cv_burstToSkill cv_critToPoise cv_burnToPoison cv_chillToVulnerable cv_armorToWarding cv_wardingToArmor cv_resistToDamage cv_resistToWarding cv_burnToFire cv_chillToIce cv_shockToLightning cv_critToLight cv_dexToStr cv_strToSpi cv_spiToVit cv_vitToMnd cv_mndToDex cv_infuseNone。

### 2-2. 誓約 20（`KEYSTONES`。系統 `KeystoneGroup` = body / tempo / style / mana / status / poise / coin の 7。room / hue / chronicle / element / weapon / terrain を消し coin を足す）

表示名は既存を変えない（「待ちの型」は武器の型、「伝染」はスキル名、「賭けの手」は賭けと衝突するため）。

| # | key | 名 | 系統 | 中身 |
| --- | --- | --- | --- | --- |
| K01 | `ks_glassCannon` | 硝子の砲 | body | 据え置き |
| K02 | `ks_vampire` | 吸血 | body | 据え置き |
| K03 | `ks_overclock` | 過駆動 | tempo | 据え置き |
| K04 | `ks_gambler` | 賭博師 | tempo | 据え置き（起点「賭博師」が使う） |
| K05 | `ks_readOath` | 読み勝ちの誓い | tempo | 据え置き |
| K06 | `ks_mushin` 新 | 虚心 | tempo | コンボが加算されない。攻撃を当てずに `KEYSTONE.mushinIdleSec`（3）秒たつと、次の 1 撃が ×`mushinMul`（6）。判定は `player.moment.lastHitAt`（`damageMods.ts` の誓約の倍）、コンボの加算止めは加算の 1 か所 |
| K07 | `ks_instant` 新 | 刹那 | tempo | 見切りの瞬間、半径 `instantRadius` の敵を `instantSec`（1）秒凍結させる。Rule `onJustDodge` → `nearbyEnemies`（status freeze）を `keystoneRules`（前置きの口）で |
| K08 | `ks_blink` | 瞬歩 | style | 据え置き |
| K09 | `ks_pacifist` | 不殺 | style | 据え置き |
| K10 | `ks_bladeOath` | 近間の誓い | style | 据え置き（起点「剣の巡礼者」が使う） |
| K11 | `ks_farOath` 新 | 遠間の誓い | style | `farOathRangePx`（3m）以内の敵への与ダメ ×`farOathNearMul`（0.5）、それより遠い敵へ ×`farOathFarMul`（1.6）。`keystoneModifiers` に `targetWithin` / `not targetWithin` の more 2 つ |
| K12 | `ks_overdraw` | 過負荷 | mana | 据え置き |
| K13 | `ks_silentVow` | 静寂の誓い | mana | 据え置き |
| K14 | `ks_chant` | 詠唱の誓い | mana | 据え置き |
| K15 | `ks_pure` | 無垢の誓い | status | 据え置き |
| K16 | `ks_contagion` | 病みの誓い | status | 据え置き |
| K17 | `ks_unshaken` | 揺るがぬ誓い | poise | 据え置き |
| K18 | `ks_poverty` 新 | 清貧 | coin | 銭を持てない（拾った銭は 1 につき気力 +`povertyManaPerCoin` に換わる。`system/economy.ts` の得る口で分岐）。与ダメの増 +`povertyIncreased`（0.3。`keystoneModifiers` の increased all） |
| K19 | `ks_goldCage` 新 | 黄金の檻 | coin | 持ち金 100 につき与ダメ ×1.15（`keystoneModifiers` の more + `per coins every goldCageEvery`）。被弾でこぼれる銭が持ち金の半分（apply で `coinSpillMul` を `goldCageSpillRatio / ECONOMY.spill.ratio` に） |
| K20 | `ks_alms` 新 | 喜捨 | coin | 銭を払うたび、払った額 × `almsHealPerCoin` の生命を回復し、`almsBuffSec` 秒与ダメ +`almsBuffPct`%。Rule `onCoinSpend` の 2 つ（heal `scaleBy eventAmount` / damageBuff）。「売れない」は入れない |

消す誓約 23: 性質へ写す 11（ks_berserker→desperation、ks_backwater→lockdownFury、ks_slickOath→groundRooted、ks_weakOath→prismEdge、ks_chargeOath→chargeCore、ks_wedgeOath→wedge、ks_chokehold→guardPiercer、ks_emberOath→emberTrail、ks_earthOath→groundMend、ks_stanceOath→stanceGuard、ks_juggernaut→unmoving）、消す 12（ks_windWalker ks_thirst ks_blight ks_reaperOath ks_monochrome ks_colorless ks_mirror ks_discipline ks_oblivion ks_oneElement ks_nullOath ks_ironOath）。`system/keystones.ts` の `KS` / `KEYSTONE_NAME` / `KEYSTONE_MODIFIERS` と、読む側（`damageMods.ts` 2・`combat.ts` 1・`player.ts` 1・`traitHooks.ts` 約 20・`keystones.ts` 内・`system/keywords.ts` の `KEYSTONE_FACTS`・`loot/provenance.ts:155-156`・`loot/resonance.ts:86-88`）から消す。

`balance/loot/KEYSTONE.json`: 残す = blink* gambler* vampireLeechPct overdraw* unshaken* readPoiseMul readOffWindupDamageMul chant* contagion* pacifist* bladeOath*。足す = mushinIdleSec mushinMul instantRadius instantSec farOathRangePx farOathNearMul farOathFarMul povertyManaPerCoin povertyIncreased goldCageEvery goldCageMul goldCageSpillRatio almsHealPerCoin almsBuffSec almsBuffPct。消す = berserkerHealMul wedge* chokeholdPoiseMul backwater* reaperOath* blight* monochrome* colorlessTraitMul discipline* oblivionAttrPerMargin oneElement* weakOath* nullOath* iron* chargeOath* stance* earthRegenPerSec slick* ember*（`stanceGuardMul` など写し先の性質で使う値は曲線へ移す）。`_fields` に足す 15 行。

---

## 3. 名のある遺物 18

`UniqueDef` に `rules? / modifiers? / apply?(stats) / keywords / changes: BuildChange / graceSlot?: BoonAction / margin?` を足す（前置き）。computeStats の `applyNamedRelics(stats, equipment)`（前置きで置く口）が装備スロット順に、`rules` を `stats.rules`、`modifiers` を `stats.modifiers`、`graceSlot` を `stats.graceSlotBonus[action] += 1`（★4: 3 枠目を開く口）、`apply` を呼ぶ。owner は `{ kind: "item", key: namedKey }`。engine の分岐は **新 `system/namedRelics.ts`**（J 所有）に関数を置き、共有ファイルは 1 行の呼び出しだけ。数値は **新 `balance/loot/RELIC.json`**（前置きで空の器と `tuning.ts` の `RELIC`）。数え（連打・距離・賽の目）は `boonRun.tallies["relic:<key>"]` を使う（ラン内で消える。決定的）。

| # | key | 名 | 部位 / ベース | 固有 | 形 | 性質（固定） | 3 枠目 | 語 | 旧 key から |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | `twinSerpent` | 双頭の蛇 | 右手 / twinDaggers | 左右を交互に当てるたび倍が積もる（上限なし）。同じ側を続けると 0 | Rule `onTwinStrike` → tally +1。Modifier more `per tally amount RELIC.twinSerpent.step`。同じ側の命中で 0: `moments.ts` の `noteHitMoments` の `alternated` が偽のとき `resetRelicTally`（分岐 1 行） | twinEdge | secondary | — / combo | matedFangs |
| R02 | `reverseHourglass` | 逆さ砂時計 | 首飾り / onyxAmulet | 受けたダメージが 3 秒遅れて来る。その間に敵を倒すと古い 1 つが帳消し | `combat.ts` の `takeNowOrDefer` の条件に「この遺物」を足す（遅れは `RELIC.hourglass.delay`）。撃破で `deferredDamage` の先頭を消す（`onTraitKill` の隣に 1 行） | — | — | — / kill・hurt | phaseAnchor |
| R03 | `herdFlute` | 群れ呼びの笛 | 首飾り / fangNecklace | 処刑すると、近くの怯んだ敵が 20 秒従う | Rule `onExecute` → `tameEnemy`（radius / onlyWith stagger / count / duration は RELIC） | — | — | placed / stagger | contagionFang |
| R04 | `emptyScabbard` | 空の鞘 | 右手 / tachi | 攻撃（左右の振り）が出ない。ダッシュで通り抜けた敵に武器の威力が乗る | `player.ts` の振りの開始で分岐（1 行）。Rule `onDash` → `nearbyEnemies`（`scaleBy slashBase`、radius・倍は RELIC） | — | dash | — / dash / dash | |
| R05 | `pilgrimBeads` | 巡礼の数珠 | 首飾り / rosary | 持っている系譜の数につき倍 +8% | Modifier more `per lineagesOwned amount RELIC.pilgrim.step` | — | skill | — | chantRosary |
| R06 | `layeredNecklace` | 重ねの首飾り | 首飾り / coralAmulet | 自分が付ける状態異常の確率が半分、1 回で 3 重ね | 付与の確率の口（`statusProcs` の抽選と `burnChance` / `chillChance` / `shockChance`）と `applyStatus` の自分の付与で分岐（`namedRelics.ts` の `relicProcChanceMul` / `relicProcStacks`） | procPoison | — | — / — / burn・poison・bleed | |
| R07 | `starReader` | 星読みの眼 | 頭 / circlet | 敵の予備動作が長く見える。予備動作中の敵への一撃が ×1.5 | Modifier more `if trigger targetInWindup`。`render/telegraphLineUi.ts` で予告の線を `RELIC.starReader.leadSec` 早く出す（描画だけ。state を書かない） | readAhead | — | — / counter | readersCirclet |
| R08 | `bellTongue` | 鐘の舌 | 指輪 / blackIronRing | 終撃のたびに鐘が鳴り、10 回目で周囲を一掃 | Rule `onFinisher` → tally +1。Rule `onFinisher` + `counter tally atLeast 10` → `nearbyEnemies`（`scaleBy slashBase`）と tally 戻し（magnitude −1 `scaleBy counter`、counter = 同じ tally）。並び順は「一掃 → 戻し → +1」 | finisherEdge | ultimate | area / finisher | |
| R09 | `dragonScale` | 起死の鱗 | 体 / scale | 生命が 3 割を切った瞬間、周りの時が 2 秒止まる（1 階に 1 回） | Rule `onHurt` + `lowHp` → `nearbyEnemies`（status freeze 2 秒・半径大）+ `ward` 2 秒。1 階 1 回は tally「relic:dragonScale」を階の到着で 0 に戻し、条件 `counter atMost 0` + 発火で +1 | — | — | ward / lowHp | unshakenScale |
| R10 | `mallet` | 打ち出の小槌 | 右手 / mallet | 終撃が当たるたび銭が出る | Rule `onFinisher` → `gainCoins`（RELIC） | finisherEdge | — | — / finisher | |
| R11 | `sixCoins` | 六文銭 | 首飾り / duskAmulet | 死んだとき、持ち金を全部払って 1 回だけ蘇る（持ち金 1 以上） | `combat.ts` の `killPlayer` の手前で分岐（1 行）。使ったら tally「relic:sixCoins」= 1（ランで 1 回） | — | — | — | |
| R12 | `luckyCat` | 招き猫 | 指輪 / goldRing | 銭の引き寄せ ×3、稼ぐ銭 +30%、被弾でこぼれる銭 ×2 | `apply`: `coinMagnetMul` / `coinGainMul` / `coinSpillMul`（RELIC） | purse | — | — | fortunesGambit |
| R13 | `greedHide` | 欲の皮 | 体 / leather | 持ち金 10 につき被ダメ −1%（上限 50%）。被弾でこぼれる銭 ×2 | 被ダメの倍の口（`combat.ts` の被弾の倍に `relicIncomingMul` 1 行）。`apply` で `coinSpillMul` | — | — | ward | |
| R14 | `jizo` | 身代わり地蔵 | 頭 / sandogasa | 被弾の半分を銭で受ける（銭 1 で生命 `RELIC.jizo.hpPerCoin`）。払えない分は生命 | `combat.ts` の被弾の量を決めた直後に `relicPayWithCoins` 1 行（`spendCoins` と同じ出どころで onCoinSpend を出す） | — | — | ward / hurt | |
| R15 | `diceRing` | 賽の目の指輪 | 指輪 / boneRing | 階に着くたび 6 つの倍から 1 つが有効（近接 / 射撃 / スキル / 継続 / 奥義 ×1.4、全部 ×1.2） | 階の到着（`floor.ts` の `buildFloor` 末尾 1 行）で、装備しているときだけ `state.rng.int(1, 6)` を tally「relic:dice」へ。Modifier more 6 つ（`counter tally atLeast i atMost i`） | — | — | — | |
| R16 | `wanderShoes` | 旅人の靴 | 足 / sandals | 歩いた距離が溜まり、次の一撃に乗る（止まると溜まらない） | `player.ts` の移動の後に `relicStride` 1 行（移動量を tally「relic:stride」へ、上限あり）。Modifier more `per tally every RELIC.wander.every`。Rule `onSwingHit` → tally 戻し | firstStrikeEdge | — | — / dash | wayfarerSandals |
| R17 | `boneCrown` | 骸の冠 | 頭 / hornedHelm | 死骸を踏むと爆ぜる（自分は傷つかない） | `namedRelics.ts` の毎ステップ: 半径内の `state.corpses` を消して爆発（`nearbyEnemies` と同じダメージの口）。`player.ts` の更新から 1 行 | — | — | explode / kill | |
| R18 | `plainBlade` | 無地の刃 | 右手 / wakizashi | 性質が付かない。装備の空いた余白 1 つにつき倍 +6% | `affixes: []`、`margin: RELIC.plainBlade.margin`（`generator.ts:494` を `unique.margin ?? NAMED_MARGIN` に）。Modifier more `per gearMargin`（前置きで足す PerCounter） | なし | primary | — | |

- 表示名の衝突を避けたもの: 「一念の指輪」（呪い付きの祝福「一念」と同じ仕組み）→ 骸の冠に差し替え、「逆鱗」（銘の語 `loot/names.ts:116`）→ 起死の鱗、「無銘の刃」（「無銘」は銘の無い遺物の総称）→ 無地の刃。新しい名前 18 は `rg` で衝突なし（名の衝突の確認は 4 章の統合で GLOSSARY に 1 行ずつ）
- 部位の配り: 右手 4・首飾り 5・頭 3・指輪 3・体 2・足 1
- `LEGACY_UNIQUE_MAP`（`p7d/LEGACY_UNIQUE_MAP.ts.txt`）: 写す 8（部位とベースが同じ）/ null 68。写したとき遺物の性質は変えない（`LEGACY_AFFIX_MAP` を通すだけ）。null のときは `namedKey` を消し、銘が無ければ旧の固有名を `inscription` に写して `nameItem` で付け直す（今の `migrate.ts:207` の「名前を失わせない」と同じ）
- 依頼の報酬（`meta/quests.ts:231-246`）の写し: shaker unshakenScale→herdFlute、comboArtist chantRosary→pilgrimBeads、hordeBreaker lastBell→bellTongue、kingslayer kingslayerCollar→plainBlade、counterman returningSwallow→starReader、plague contagionFang→layeredNecklace
- 図鑑（`roguelike.codex.v1` の relics）: 読み込みで `LEGACY_UNIQUE_MAP` を通す（null は落とす）。実績 `relic25`（`meta/achievements.ts:98`）は 25 種が取れなくなるので閾値を 18 に（key は変えない。desc も直す）

---

## 4. 源と糧の共鳴（`system/resonance.ts` 新）

### 4-1. 数え（`countKeywords(state): Record<Keyword, { produces; consumes; amplifies }>`）

源（出どころ）1 つにつき、語ごと・動詞ごとに最大 1 と数える（同じ遺物の性質が 2 つ燃焼を出しても 1）。順は固定（決定性。値は数なので順に依らないが、表示の内訳の並びは KEYWORDS 順）。

| 源 | 何を読む |
| --- | --- |
| 遺物（装備 1 部位につき 1） | その遺物の `affixes` の定義の `keywords`（性質・転じ）+ 誓約の性質は `KEYSTONE_FACTS` + トリガーの性質は `triggerFacts(decodeTriggerRoll)` + 名のある遺物は `UniqueDef.keywords` の和。**地金・implicit は数えない** |
| スキル（スロット 1 つにつき 1） | `skillKeywords(SKILL_DEFS[key], slot.modifiers)`（今の `buildProfile` と同じ。ラン内の符込み） |
| 祝福（1 枚につき 1） | `BOONS[key].keywords` |
| 流儀 | `JOBS[job].keywords` |
| 武器の型 | `FORMS[currentForm].keywords`（前置きで `FormDef.keywords?` を足し、K が 15 型に書く） |
| 改鋳（1 つにつき 1） | `REFORGES[key].keywords`（前置きで `ReforgeDef.keywords?`、K が 30 に書く） |
| ラン内の誓約（起点・祭壇・闇市） | `KEYSTONE_FACTS` |

数えない語（`RESONANCE_EXCLUDED`、TS）: crimson / azure / jade / gold / umbra / inverted / elNone。

### 4-2. 段と効果

- 段: `p ≥ RESONANCE.minSources (2)` かつ `c ≥ minSinks (2)` で 1 段。`floor((p + c − minSources − minSinks) / stepEvery (3))` を足し、`a × amplifyStep (1)` を足し、`maxSteps (3)` で止める
- 倍: 1 語 1 出所 `resonance:<語>`。`more = 1 + (stepMul − 1) × 段`（1.15 / 1.30 / 1.45）。タグは TS の `KEYWORD_TAG`: melee→melee、ranged→ranged、bullet→ranged、still→ranged、placed→placed、area→area、explode→area、combo→melee、finisher→melee、counter→counter、crit→critMulti、energy→ultimate、burn→fire、chill→ice、shock→lightning、poison→poison、bleed→dot、reaction→reaction、stagger→vsStaggered、elite→vsElite、elFire→fire、elIce→ice、elLightning→lightning、elPoison→poison、elDark→dark、elLight→light、それ以外（vulnerable / weaken / fear / silence / wall / kill / clear / lowHp / hurt）→ all
- 倍の無い語は stats へ（`KEYWORD_STAT`、TS。量は JSON `statPerStep`）: dash → `dashCooldownMul × (1 − 0.08 × 段)`、just → `justDodgeWindow + 0.05 × 段`、mana → `manaGainMul + 0.1 × 段`、heal → `lifeOnHit + 1 × 段`、ward → `damageTakenMul × (1 − 0.05 × 段)`
- 同期: `refreshResonance(state)` が `boonRun.resonance`（前置きで足す `ResonanceStep[]`。段 ≥ 1 の語だけ、KEYWORDS 順）を作り直す。呼ぶ所は `applyStats`（装備・祝福・改鋳・階の移動）と、ラン内の符の付け外し（`system/skills.ts` の `attachRune` / `moveRunModifier` の末尾 1 行。`applyStats` が走らない経路）。倍は `collectModifiers` の誓約の直後に `resonanceModifiers(state)`（`boonRun.resonance` を読むだけ）、stats 側は `applyStats` の `foldBoonStats` の後に `applyResonanceStats`

### 4-3. `balance/loot/RESONANCE.json`（全面書き直し）

```json
{
  "_note": "源と糧の共鳴（system/resonance.ts）。同じ語の源と糧が両方そろうとその語に倍が段で入る",
  "_fields": {
    "minSources": "1 段に要る源の数", "minSinks": "1 段に要る糧の数",
    "stepEvery": "源 + 糧がこの数ふえるごとに +1 段", "amplifyStep": "強め 1 つで足す段",
    "maxSteps": "段の上限", "stepMul": "1 段の倍（more = 1 + (stepMul − 1) × 段）",
    "statPerStep": "倍の無い語が 1 段で stats に足す量（dash / ward は倍率を下げる割合）"
  },
  "minSources": 2, "minSinks": 2, "stepEvery": 3, "amplifyStep": 1, "maxSteps": 3, "stepMul": 1.15,
  "statPerStep": { "dash": 0.08, "just": 0.05, "mana": 0.1, "heal": 1, "ward": 0.05 }
}
```

今の中身（negative / balance / twoFaces / … / chainGainLoss の 30 項目）は全部消す。`combat/ATTR_GAIN.json` の `resonanceScatter`、`feel/FX_WAVE3.json` の `mantle.constellationColor` も消す。

### 4-4. 表示と、色の共鳴を読んでいた所の置き換え

| 所 | 今 | 7d |
| --- | --- | --- |
| 流れタブ `ui/synergyPanel.ts` / `render/synergyUi.ts` | 語の網 | 見出しの下に「共鳴中: 燃焼 2 段（源 3・糧 2・強め 1）」を段の高い順に。0 件なら出さない |
| HUD `render/renderer.ts:2944-2945` | `describeResonance` の 1 行目 | 「共鳴 燃焼 2・感電 1」（`resonanceSummary(state)`）。0 件なら出さない |
| 纏い `render/effectsUi.ts:638` / `renderMath.ts:255` | 共鳴の色 | 共鳴している語の `KEYWORD_DEFS[k].color`（段の高い順に最大 3） |
| 装備画面 `render/inventoryUi.ts:510-511`・`loot/describe.ts:322` | 装備全体の配合と共鳴の効果 | 装備全体の配合の見出しと効果の行を外す。遺物 1 つの色の帯 `itemColorBar` は残す（色は分類として残す） |
| 部屋「共鳴炉」`specialRooms.ts:1051-1062` | 扉の色と共鳴の色が合えば報酬 2 個 | `boonRun.resonance.length > 0` なら報酬 2 個（設計どおり）。扉の色は飾りとして残す |
| 金床 `specialRooms.ts:767-771` `forgeColor` | 共鳴の支配色 → 無ければ乱数 | 装備の性質の色で最も多い色（`colors.ts` に `dominantTraitColor(equipment)`、同数は TRAIT_COLORS 順）→ 無ければ乱数 |
| 彩刻 `skills/actions2.ts:343`・彩り `skills/hit.ts:227` `resonanceHueIndex` | 共鳴の最初の色 | **共鳴している状態異常の語の色**: `HUE_KEYWORD = { crimson: burn, azure: chill, jade: poison, gold: shock, umbra: vulnerable }`（`statusReactions.ts:78` の `HUE_TRIGGER` と同じ対応）で、段の最も高い色（同段は TRAIT_COLORS 順）。無ければ今どおり `state.rng` |
| 彩痕の被ダメ `statusReactions.ts:455` `hueMatchesResonance` | 彩痕の色が共鳴の色に含まれる | 彩痕の色の語（`HUE_KEYWORD`）が 1 段以上 |
| 彩刻の語 `skills/defs2.ts:113` | 食う = 5 色 | 食う = burn / chill / poison / shock / vulnerable。verb の「装備の共鳴の色」→「共鳴している状態異常の色」 |
| 語の事実 `system/keywords.ts:388-420` | 配合の色を出す・共鳴の色を食う | `resonanceFacts` と `COLOR_KEYWORD` を消す。`equipmentSources` の `color:` / `resonance:` の行も消し、`keywords.test.ts` の網羅から `RESONANCE_EXCLUDED` を外す |
| `ATTR_LABEL`（7 ファイルが `loot/resonance.ts` から import） | resonance.ts | 前置きで `loot/types.ts` へ移し、K が import を張り替えて `loot/resonance.ts` を消す |
| `colorWeights`（`system/effects.ts:10`・`loot/describe.ts:12`） | resonance.ts | `loot/colors.ts` へ移す |
| QA `qa/simulation.test.ts:141, 606-607, 794-795, 1006-1007, 1229-1231` | 共鳴の種類・色 | 共鳴の段の分布（語ごとの最大段）に |
| Tips `meta/tips.ts:152-155` | 反転 / 響き / 共鳴 / 無色 | 共鳴の本文を「源と糧」に書き直し、響きの「共鳴が持つ」を外す。無色は脱色が消えるので項目ごと消すか「旧い遺物に残る」に（GLOSSARY と揃える） |

---

## 5. 残響 12 → 5

| 残す（`ECHO_OPS` の順） | 表示 | 備考 |
| --- | --- | --- |
| `shatter` | 砕く | |
| `pour` | 注ぎ | build-core 4-5 の「育てる」。表示名は既存の「注ぎ」のまま（新語を作らない） |
| `transfer` | 移し | |
| `recall` | 呼び戻し | |
| `stir` | 煽り | 反転を狙う操作（build-core 4-5） |

消す 7: `dye`（染め）/ `calm`（鎮め）/ `pare`（削ぎ）/ `modulate`（転調）/ `bleach`（脱色）/ `reforge`（鍛え直し）/ `tension`（張り）。`loot/crafting.ts` の関数・定数（DYE_COST CALM_COST PARE_COST MODULATE_COST BLEACH_COST REFORGE_COST TENSION_COST BLEACH_VALUE_FACTOR TENSION_FACTOR REFORGE_MARGIN_COST CALM_MARGIN_COST PARE_MARGIN_GAIN CALM_FLUX_FACTOR）・`EchoRequest` の枝・`INVALID_MESSAGE` / `ECHO_OP_LABEL` / `ECHO_OP_HINT` の行、`ui/echoTab.ts` の `ECHO_SFX` と色選び（dye の `color` 段）、`render/echoTabUi.ts:200-202`、`meta/tips.ts:162-172` の 7 項目、`render/inventoryUi.test.ts:119`（`op = "dye"`）、`loot/innate.test.ts:8, 421`（dye / calm / pare を呼ぶ）。`Item.reforged` は保存データに残るので型は残す（読み捨て）。残響の費用は今も TS 定数（`balance` に `ECHO` は無い）なので JSON は触らない（既存の負債。6 章 9）。

---

## 6. 数値ファイルの整理

| ファイル | 変更 |
| --- | --- |
| `balance/loot/affixCurves/*.json`（今 253） | 消す 174（性質 141 = 212 − 残す 58 − 地金の行 13、変換 33）。足す 23（性質の新 13 + 転じの新 10）。残す 58 + 13 + 8。`_index.json` の `_order` を合わせる。`curveFor` は key が無いと tsc で落ちるので `affixes.ts` と同じコミット |
| `balance/loot/KEYSTONE.json` | 2-2 のとおり。`_fields` に新 15 行 |
| `balance/loot/TRIGGER.json` の `trait` | 足す: `momentWindowSec 2` / `moraleEvery 10` / `comboEvery 10` / `speedToDamageCap` / `manaPerProjectile 40` / `manaToProjectileRegenMul 0.5` / `coinsMoreCap` / `critRuleIcd`。消す: `boonEchoOffPenalty` / `spreadCloseRange` / `alternateWindow`（読む性質が消えるもの。`rg` で 0 件を確かめてから） |
| `balance/loot/RESONANCE.json` | 4-3 |
| `balance/loot/RELIC.json`（新） | 3 章の数値（前置きで空の器、J が中身） |
| `balance/combat/ATTR_GAIN.json` | `resonanceScatter` を消す |
| `balance/feel/FX_WAVE3.json` | `mantle.constellationColor` を消す |
| `balance/loot/FLUX.json` / `INNATE/budget.json` | **7d では触らない**（数値は 7e。設計 3-2 の FLUX 0.6〜1.8 と perDepth 0.5 は 7e の最初に） |
| ECHO | JSON は無い（5 章） |

どのレーンも `npm run balance:gen` を何度走らせてよい（木全体から `assembled.gen.ts` を作り直すので、他レーンの JSON も入る）。

---

## 7. レーン分け（4 章 7d の確認と修正）

### 7-1. 設計のままだと衝突するところ

| ファイル | 設計で触るレーン | 衝突 |
| --- | --- | --- |
| `loot/stats.ts` `computeStats` | I（applyRoll の modifier push）・J（名のある遺物の Modifier）・K（手順 2・3・5 を消す） | 3 レーンが同じ関数の同じ 20 行 |
| `system/rules.ts` `collectRules` | J（装備の Rule） | I も転じ・誓約の Rule を載せる口が要る（設計に無い） |
| `system/modifiers.ts` `collectModifiers` | J・K | 同じ関数 |
| `loot/types.ts` | I（`AffixTag`・新欄）・K（`resonance` 削除・`ATTR_LABEL`） | `AffixTag` は実は `loot/affixes.ts:33`（types.ts ではない）。PlayerStats の新欄は I・J・K 全員が要る |
| `system/statusEffects.ts` | 設計に無い | I（燃焼の重ねの上限）・J（重ねの首飾り）・K（`hueMatchesResonance`） |
| `system/keywords.ts` | K | I も `KEYSTONE_FACTS` と STAT_RULES の `trait(...)` 行を消さないと tsc が落ちる |
| `loot/lootExpansion.test.ts` / `lootWave2.test.ts` | 設計は K の削除対象に数える | 性質の検査（I）と共鳴・星座の検査（K）が同じファイル |
| `skills/defs2.ts` / `hit.ts` / `actions2.ts` / `statusReactions.ts` / `system/skills.ts` | K の最小 Edit に無い | 彩刻・色解き・彩り・同調が色の共鳴を読む。**7c の H2 が同調 `attune` と彩り `hueInfuse` をまだ消していない**（作業ツリーの `skills/modifiers.ts:258` に残る） |
| J の engine 分岐 | `combat.ts` / `player.ts` / `telegraphLineUi.ts` の 3 | 18 に具体化すると 10 か所（3 章）。`moments.ts` / `floor.ts` / `statusEffects.ts` / `generator.ts` も要る |
| L の最小 Edit `balance/loot/*ECHO*` | — | ファイルが無い（残響の費用は TS 定数） |

### 7-2. 修正案: 前置き P → I ∥ J ∥ K ∥ L → 統合

**前提**: 7c（G・H2）がコミット済み。確かめ方: `git status --short` が空、`rg -n "attune|hueInfuse" src` が 0 件。

**P 前置き（統合役か Opus 1 本。1 コミット。挙動を変えない。`npm run check` 通過）**

| ファイル | 足すもの |
| --- | --- |
| `src/core/build.ts`（新） | `BuildChange`（今の `BoonChange` の union）と `BoonAction` を移す。`system/boonDefs.ts` は `export type BoonChange = BuildChange` と `BoonAction` の re-export（loot が system を import しないため） |
| `src/core/keywords.ts` | `ResonanceStep { keyword; step; produces; consumes; amplifies }` |
| `src/core/rules.ts` | `RuleEffectKind` に `gainMorale`、`PerCounter` に `{ kind: "gearMargin" }` |
| `src/system/rules.ts` | `gainMorale` の分岐（`system/morale.ts` に量で足す `addMoraleAmount` を export）。`collectRules` の先頭に `out.push(...state.stats.rules, ...keystoneRules(state.stats.keystones))`（コメントの順も「装備 → 誓約 → ジョブ …」に） |
| `src/system/keystones.ts` | `keystoneRules(keys)`（空の表 `KEYSTONE_RULES`） |
| `src/system/modifiers.ts` | `countPer` に `gearMargin`（`state.profile.equipment` の残り余白の合計） |
| `src/loot/types.ts` | `PlayerStats.rules: readonly Rule[]` / `statusStackCapBonus: Partial<Record<StatusKind, number>>` / `graceSlotBonus: Partial<Record<BoonAction, number>>`、`DEFAULT_STATS`。`ATTR_LABEL` を移す（`loot/resonance.ts` は re-export） |
| `src/loot/stats.ts` | `createBaseStats` の複製 3 つ。`computeStats` の性質の適用の直後に `applyNamedRelics(stats, equipment)` |
| `src/loot/named.ts` | `UniqueDef` に `rules? / modifiers? / apply? / keywords? / changes? / graceSlot? / margin?`。`applyNamedRelics`（3 章の畳み方まで実装してよい。今の 76 は何も持たないので no-op） |
| `src/loot/affixes.ts` | `AffixDef.keywords?: KeywordProfile`、`AffixTag` に `condition` |
| `src/system/boons.ts` | `BoonRunState.resonance: ResonanceStep[]`（空で初期化）。`graceSlotsOf` に `+ (state.stats.graceSlotBonus[action] ?? 0)` |
| `src/system/statusEffects.ts` | `maxStacks` に state を渡し、敵側に `state.stats.statusStackCapBonus[kind] ?? 0` を足す |
| `src/data/weaponForms.ts` / `src/data/reforges.ts` | `FormDef.keywords?` / `ReforgeDef.keywords?` |
| `src/data/balance/loot/RELIC.json`（新）/ `loot/_index.json` の `_order` / `src/data/tuning.ts` | 空の器と `export const RELIC = BALANCE.loot.RELIC`。`npm run balance:gen` |

**レーン**（P の後に 4 本並列。共有ファイルは下の「最小 Edit」の範囲だけ、old_string を短く）

| レーン | モデル | 所有 | 最小 Edit（その範囲だけ） | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| **I 性質・転じ・誓約** | Opus | `loot/affixes.ts`、`system/traitHooks.ts`、`system/keystones.ts`、`loot/traitContext.ts`、`balance/loot/affixCurves/**`・`KEYSTONE.json`・`TRIGGER.json`、テスト `loot/affixes|generator|conversions|combatTraits|elementTraits|flux|provenance|lootExpansion|lootWave2|stats|describe.test.ts`・`system/traitHooks|lootWave2Hooks|keystones|damageMods|combat|modifiers.test.ts`（誓約・性質の節）と **fixture の差し替え**（8 章の一覧。`meleeDamagePct` / `maxLife` を残る key へ） | `system/damageMods.ts`（berserker・得意武器・`traitIncreased`）、`system/combat.ts` / `system/player.ts`（`KS.juggernaut` の 1 行ずつ）、`system/keywords.ts`（STAT_RULES の `trait(...)` 行と `KEYSTONE_FACTS` だけ）、`system/statusEffects.ts`（なし。P で済み）、`system/economy.ts`（清貧の 1 行）、`loot/provenance.ts:114-156`（目覚めの名指しと 155-156）、`render/renderMath.ts:263-277`（`KEYSTONE_GROUP_COLOR`）と `renderMath.test.ts` の誓約の節、`loot/types.ts`（`TraitStats` の削除・新欄 `stanceGuard` / `unmoving`） | `loot/named.ts`・`loot/migrate.ts`・`system/resonance.ts`・`loot/resonance.ts`・`loot/crafting.ts` | `AFFIXES` 71・`CONVERSION_AFFIXES` 18・`KEYSTONES` 20、`affixes.test.ts` の「無条件に数値を上げない」「全性質が keywords を持つ」「条件の族は condition タグ」が通る |
| **J 名のある遺物・移行** | Opus | `loot/named.ts`、`loot/named.test.ts`（新）、`system/namedRelics.ts`（新）+ test、`loot/migrate.ts`（`LEGACY_AFFIX_MAP` / `LEGACY_UNIQUE_MAP` は `p7d/*.ts.txt` を貼る）、`loot/migrate.test.ts`、`balance/loot/RELIC.json`、`meta/quests.ts`（報酬の写し）、`meta/achievements.ts:98`、`meta/codexStore.ts`（relics の写し）、`meta/lockedRelics.test.ts` / `quests.test.ts` / `codex.test.ts` / `achievements.test.ts` / `loot/innate.test.ts:498`（頭の名のある遺物） | `system/moments.ts`（`noteHitMoments` 1 行）、`system/combat.ts`（`takeNowOrDefer` の条件・撃破・`killPlayer` の手前・被弾の倍・被弾の量の 5 か所 1 行ずつ）、`system/player.ts`（振りの開始・移動の後・更新の 3 か所）、`system/floor.ts`（`buildFloor` 末尾 1 行）、`system/statusEffects.ts`（自分の付与の重ね 1 行）、`system/combat.ts` か proc の抽選の口（確率 1 行）、`render/telegraphLineUi.ts`（予告の早出し）、`loot/generator.ts:494`（`unique.margin`） | `loot/affixes.ts`・`system/traitHooks.ts`・`system/resonance.ts`・`loot/crafting.ts` | `UNIQUES` 18、全部が rules / modifiers / apply / 分岐のどれかを持ち `changes` を持つ、旧セーブの fixture（6 部位 + 名のある遺物 + 誓約の性質）が写る |
| **K 共鳴** | Opus | `system/resonance.ts`（新）+ `system/resonance.test.ts`（新）、`loot/resonance.ts`（削除）と `loot/resonance*.test.ts` 3 本（削除）、`loot/colors.ts`、`ui/synergyPanel.ts`、`render/synergyUi.ts`、`balance/loot/RESONANCE.json`・`combat/ATTR_GAIN.json`・`feel/FX_WAVE3.json`、`system/keywords.test.ts`、`system/specialRooms.test.ts`（共鳴炉）、`system/statusEffects.test.ts`・`skills/expansion2.test.ts`（彩痕）、`qa/simulation.test.ts`（共鳴の指標）、`meta/tips.test.ts` | `loot/stats.ts`（手順 2・3・5 と `equipmentResonance` / `withConstellation` / `rulesOf`）、`loot/types.ts`（`Resonance` / `ResonanceKind` / `ResonanceForm` / `CONSTELLATION_KEYS` / `PlayerStats.resonance` と `TraitStats` の `highHpDamageMul` / `lowHpGuard` / `triggerIcdCut`）、`system/keywords.ts`（388-420 の色の事実・`equipmentSources` の色の行・`countKeywords` を足す）、`system/modifiers.ts`（`resonanceModifiers` 1 行）、`system/player.ts`（`applyStats` 1 行）、`system/skills.ts`（`attachRune` / `moveRunModifier` の末尾 1 行ずつ）、`system/specialRooms.ts:767-771, 1051-1062`、`system/statusReactions.ts:455-460`、`skills/hit.ts:226-241`、`skills/actions2.ts:341-346`、`skills/defs2.ts:110-113`、`system/effects.ts:10`、`loot/describe.ts:12, 322`、`render/inventoryUi.ts:6, 505-520`、`render/lootUiParts.ts`（配合の見出しがあれば）、`render/renderer.ts:240, 2944-2945`、`render/effectsUi.ts:27, 638`、`render/renderMath.ts:250-260` と `renderMath.test.ts` の纏いの節、`data/weaponForms.ts` / `data/reforges.ts`（`keywords` を 15 型・30 改鋳に）、`ATTR_LABEL` の import 7 か所（`system/jobs.ts:9`・`meta/tips.ts:5`・`meta/weaponTips.ts:19`・`ui/scalingText.ts:7`・`render/attributeUi.ts:4`・`loot/describe.ts:12`・`meta/tips.test.ts:4`）、`meta/tips.ts:152-155` | `loot/affixes.ts`・`loot/named.ts`・`loot/crafting.ts`・`system/traitHooks.ts` | `rg -n "loot/resonance\|constellation\|resonance\.colors" src` が 0 件、`resonance.test.ts` の「源 2 糧 2 で 1 段、強めで +1、上限 3、Modifier に出る、装備の付け替えで数え直す、符の付け替えで数え直す、同じ遺物の 2 つの性質は 1 と数える」 |
| **L 残響** | **Sonnet でよい** | `loot/crafting.ts`、`ui/echoTab.ts`、`render/echoTabUi.ts`、`loot/crafting.test.ts`、`ui/echoTab.test.ts`、`ui/echoTabWave2.test.ts` | `meta/tips.ts:162-172`（7 項目を消す）、`render/inventoryUi.test.ts:119`、`loot/innate.test.ts:8, 421`、`audio/sfxNames.ts`（残響の音で使われなくなる名があれば消さずに残す） | 他全部 | `ECHO_OPS` 5、`rg -n "dyeTrait\|calmTrait\|pareTrait\|modulateTrait\|bleachTrait\|reforgeTrait\|tensionTrait" src` が 0 件 |

- 同じ共有ファイルを 2 レーンが触るのは `system/combat.ts`（I 1 行・J 5 行）、`system/player.ts`（I 1・J 3・K 1）、`system/keywords.ts`（I と K で別の行範囲）、`loot/types.ts`（I は `TraitStats`、K は共鳴の型）、`render/renderMath.ts`（I は 263-277、K は 250-260）、`meta/tips.ts`（K は 152-155、L は 162-172）、`system/statusEffects.ts`（J と K で別の関数）。範囲が重ならないので並べてよい
- 並べる間は他レーン起因の tsc / テストの失敗は報告だけ（`npm run check:fast`）。I が消す key を fixture に使うテストは I が直す（8 章）
- Sonnet の判断: **L だけ Sonnet**。I は 212 件の中身と traitHooks の分岐・誓約の engine の削除に判断が要り、J は engine 分岐 10 と移行、K は新しい仕組みと 20 か所の読み替えがあるので Opus
- 分けたくなったら I を「I1 性質（affixes.ts の AFFIXES 区間・traitHooks・fixture）」と「I2 転じ・誓約（CONVERSION / KEYSTONES 区間・keystones.ts・damageMods）」に割れる（同じ `affixes.ts` の別区間。traitHooks の誓約の分岐は I2 が先に消す順）

**統合**: `REPLAY_VERSION` 29 → **30**（`core/replay.ts:76` と `docs/ARCHITECTURE.md` の版の一覧）。`docs/LOOT_DESIGN.md`（色と共鳴・星座・残響・性質の節）、`docs/recipes/affix.md`（条件の族・行動・keywords 必須・「柱 7 の 1 文」）、`docs/GLOSSARY.md`（新語: 虚心 / 刹那 / 遠間の誓い / 清貧 / 黄金の檻 / 喜捨 / 踏ん張り / 名のある遺物 18 の名 / 共鳴の新しい意味。廃止: 星座・陰画・拮抗・主色・無色・染め・鎮め・削ぎ・転調・脱色・鍛え直し・張り・祝福の響き・橋渡し）、`docs/CODE_MAP.md`（`system/resonance.ts` / `system/namedRelics.ts` / `core/build.ts` を足し `loot/resonance.ts` を消す）、`IDEAS.md` の現状、`CHANGELOG`。

---

## 8. 壊れそうなテストと、key を列挙している所

### 8-1. テスト（持ち主つき）

| テスト | 理由 | 持ち主 |
| --- | --- | --- |
| `loot/resonance.test.ts` / `resonanceAttributes.test.ts` / `resonanceOrder.test.ts` | 色の共鳴の廃止 | K（削除） |
| `loot/lootExpansion.test.ts`（35 か所: boonEcho / bridge / 変換 / 誓約 hue・chronicle / 陰画）/ `lootWave2.test.ts`（107 か所: 第 2 弾の性質・変換・誓約・名のある遺物 24 の key 列挙 `:178-201`・拮抗） | 性質・誓約・名のある遺物・共鳴 | I（共鳴・星座の節も I が消す） |
| `loot/affixes.test.ts`（23）/ `generator.test.ts`（`driedWell` `:49, 308`・manaDrought）/ `conversions.test.ts` / `combatTraits.test.ts` / `elementTraits.test.ts`（`cv_infuseNone` / `res_all` / `sturdy` / `wardingFlat`）/ `flux.test.ts` / `provenance.test.ts`（目覚め） | 件数と key | I（generator の `driedWell` は J の名に差し替え） |
| `loot/stats.test.ts`（`ks_juggernaut` / `ks_thirst`・共鳴の段） | 誓約・共鳴 | I（共鳴の段の節は K が消す。範囲を分ける） |
| `system/traitHooks.test.ts`（`KS.backwater` / `chokehold` / `reaperOath`）/ `lootWave2Hooks.test.ts`（誓約 8）/ `keystones.test.ts`（`KS.backwater` / `thirst`）/ `combat.test.ts`（`KS.berserker` / `juggernaut`）/ `modifiers.test.ts`（`KS.wedgeOath`）/ `damageMods.test.ts` | 誓約の engine の削除 | I |
| `system/keywords.test.ts`（`KS.berserker`・網羅） | 誓約・色の語 | K（誓約の 1 か所は I が先に直す） |
| `render/renderMath.test.ts`（`ks_berserker` / `ks_juggernaut` の纏い・共鳴の纏い） | 誓約の系統・共鳴 | I（誓約の節）・K（纏いの節） |
| `loot/migrate.test.ts`（`widowmaker` `:92, 110`・`ks_berserker`） | 名のある遺物・写し | J |
| `meta/lockedRelics.test.ts`（`unshakenScale` / `lastBell`）/ `quests.test.ts:226-228` / `codex.test.ts` / `achievements.test.ts` / `loot/innate.test.ts:498`（`readersCirclet` / `demonMask`） | 名のある遺物の key | J |
| `qa/gearPower.test.ts` | 名のある遺物を除く抽選（件数に依らない） | 変更なし見込み（J が確認） |
| `loot/crafting.test.ts` / `ui/echoTab.test.ts` / `ui/echoTabWave2.test.ts` / `render/inventoryUi.test.ts:119` / `loot/innate.test.ts:8, 421` | 残響の操作 | L |
| `system/specialRooms.test.ts`（共鳴炉）/ `statusEffects.test.ts` / `skills/expansion2.test.ts`（彩痕の色）/ `qa/simulation.test.ts`（共鳴の指標）/ `meta/tips.test.ts`（`ATTR_LABEL` の import） | 共鳴 | K |
| fixture だけ（`meleeDamagePct` / `maxLife` / `critChance` / `attackSpeed` などを「何かの性質」として使う）: `core/game.test.ts` / `core/replay.test.ts` / `ui/origin.test.ts` / `ui/inventory.test.ts` / `ui/stashFilter.test.ts` / `render/inventoryUi.test.ts` / `render/dropTooltip.test.ts` / `loot/describe.test.ts` / `loot/crafting.test.ts` / `ui/echoTab*.test.ts` | 定義が消えて表示・数値が変わる | I（L の所有ファイルは L が差し替え）。差し替え先: 数値を見るテストは `damageVsStaggered`（増のタグ）か地金の行 `attr_str`（`affixDef` で引ける）、表示だけなら何でも |
| `core/replay.test.ts` | `REPLAY_VERSION` | 統合 |

### 8-2. key を列挙している所

| 所 | 何を列挙 | 7d |
| --- | --- | --- |
| 図鑑 `meta/codex.ts:204, 342` | `UNIQUES` | 自動で 18 に。保存済みの relics は J が `codexStore` で写す |
| 依頼 `meta/quests.ts:231-246` | 報酬の名のある遺物 6 | J（3 章の写し） |
| 実績 `meta/achievements.ts:96-98` | 名のある遺物 1 / 10 / 25 種 | J（25 → 18） |
| 闇市 `system/blackMarket.ts:95-160` | 誓約の品（`altarKeystoneCandidates` = `KEYSTONES`）、反転の性質（`affixDef`） | 自動。変更なし |
| 契約者 `system/contractors.ts` | 性質・誓約・名のある遺物の key は持たない（残響の色だけ） | 変更なし |
| 起点 `system/runSetup.ts:45, 67` | `ks_bladeOath` / `ks_gambler` | 残る。変更なし |
| 拠点 `system/hub.ts:301`・`ui/hubFlow.ts:71-79` | `KEYSTONES` | 自動（「誓約 20」） |
| 目覚め `loot/provenance.ts:118-146` | 性質 21 | I（1-5 末尾） |
| 来歴の段 `loot/traitContext.ts:21-27` | 性質 5 | I（3 つに） |
| 語 `system/keywords.ts` STAT_RULES / KEYSTONE_FACTS / 色 | 欄・誓約・色 | I・K |
| 誓約の纏い `render/renderMath.ts:264-277` | `KeystoneGroup` 12 | I（7 に） |
| QA `qa/gearPower.ts:30` | `UNIQUES` | 自動。`qa/simulation.test.ts` の共鳴は K |
| Tips `meta/tips.ts:148-173` | 性質・共鳴・残響の用語 | K・L |

---

## 9. 不確かな点（推奨つき）

1. ★ **属性の変換 6 を残すか**: 設計の「転じ 12」は変換 41 から 12 を残す数だが、`cv_infuse*` を消すと通常攻撃の属性を変える口が武器のベースだけになる（祝福・改鋳・流儀に infuse は無い: `rg infuse src/system/boonDefs src/data/reforges.ts src/data/jobs.ts` 0 件）。推奨: 残す（転じの数に入れない）。消すなら弱点の報酬（build-core 4-6）の遊びが武器選びだけになる
2. **残響の 5**: 設計 2-10 は「注ぎ」を消すと書きつつ「育てる（= 今の呼び戻し）」「呼び戻し（= recall）」と重複している。build-core 4-5 の「砕く / 育てる / 移す / 呼び戻し / 煽り」に合わせ、育てる = 注ぎ（来歴を注いで育てる）とした。確認: 統合役がユーザーに 1 行で
3. **誓約から降ろすのは 11**（設計は 17）: 風走り・渇き・蝕み・死神・一色・無の 6 は受け皿の性質を 71 に入れていない（数値だけか、他の性質と重なる）。足すなら行動の枠を 6 増やす
4. **厳選の到達点**: 連鎖 100%（`chainSource` + `cv_critToChain`）と燃焼の上限（`burnStack`）は性質で届く。「利子の上限撤廃」は利子の仕組みがまだ無い（`rg "interest\|利子" src` 0 件）、「戦意の冷めなし」は性質を置いていない。装備画面の「到達: 連鎖 100%」の行は 7e に回す
5. **先制・応手・双撃は「後 2 秒」**: これらのイベントは命中の後に積まれる（`system/moments.ts:158-180` の `noteHitMoments`）ので、Modifier ではその一撃自体に掛けられない。一撃自体に掛けたいなら `RuleCondition` に `moment: "firstStrike"`（`player.moment.firstStrikeArmed` を読む）を足す。確認: `modifiers.test.ts` に「先制の後の一撃に増が乗る」
6. **`readAhead` / `starReader` の `trigger targetInWindup` を Modifier で使う**: `ruleConditionsMet` の `trigger` 分岐（`system/rules.ts:766-767`）は subject を `conditionMet`（`system/triggers.ts`）へ渡し、対象の条件は `targetOf(state, ctx)` で引くので、殴っている敵で効く見込み。I が `modifiers.test.ts` に「予備動作中の敵にだけ増が乗る」を 1 件足して確かめる
7. **装備の Rule の重複**: 同じ性質を 2 つの遺物が持つと Rule の id が同じになり、1 イベントに 1 回しか発火しない（`fireRules` の `fired`）。性質の Rule は転じの 3 つと誓約の 3 つだけなので実害は小さい。重ねたいなら id に部位を混ぜる
8. **共鳴の同期漏れ**: `applyStats` が走らない経路（ラン内の符の付け外し）に `refreshResonance` を足す。他に漏れが無いかは `resonance.test.ts` の「石・符・祝福・改鋳・装備の付け替えで数え直す」で
9. **残響の費用が TS 定数**（`loot/crafting.ts:100-136`）: 不変条件 4 からずれる既存の負債。7d では動かさない（`balance/loot/ECHO.json` を作ると `tuning.ts` と `balance:gen` が増えるので別コミット）
10. **名のある遺物の engine 分岐が 10 か所**（設計は 4）: 3 章の選び方で増えた。減らすなら重ねの首飾り・欲の皮・身代わり地蔵・六文銭（銭と状態異常の口）を Rule で書ける別の案に差し替える
11. **起死の鱗の「1 階に 1 回」**: tally を階の到着で 0 に戻す 1 行が `floor.ts` に要る（賽の目と同じ所）
12. **旧セーブの性質の半分以上が消える**: 倉庫の遺物は「性質が減って余白が増える」（★8 決定済み）。影響の目安は fixture の 6 部位で `migrate.test.ts` に（1 部位あたり消える数の分布を出すと 7e の説明に使える）
13. **`keywords.test.ts` の網羅**: 色の語 5 と反転は出す側（性質の色）も食う側（共鳴）も消えるので、網羅の対象から外す（`RESONANCE_EXCLUDED` を export して test が読む）。KEYWORDS の union からは消さない（祝福・敵・部屋の語の表に波及するため）
