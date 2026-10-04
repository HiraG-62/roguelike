# バランス数値の辞書

<!-- 自動生成（npm run balance:dict）。手で直さない。説明は各 JSON の _fields を直してから生成し直す -->

`src/data/balance/` の JSON の各項目が何に効くかの一覧。説明の正は各 JSON の `_fields`（書き方は `docs/BALANCE.md`「項目の意味を読む / 書く」）。

- 節の見出し `weapons/WEAPON` は `src/data/balance/weapons/WEAPON/`（ディレクトリ）か `….json`（ファイル）
- `*` は同じ形の行が並ぶ表の行（敵の key・武器種など）、`[]` は配列の各要素（`_id` で探す）
- オブジェクト名だけの行（`resist` など）は、その中の項目すべてに効く
- （未記入） は `_fields` に説明がまだ無い項目

項目 3859（うち（未記入） 1829）

## combat/MANA

気力(旧マナ)。

| 項目 | 意味 |
| --- | --- |
| `baseMax` | （未記入） |
| `baseRegen` | （未記入） |
| `idleRegenMul` | （未記入） |
| `combatRadius` | （未記入） |
| `onMelee` | （未記入） |
| `meleeTargetCap` | （未記入） |
| `onDashAttack` | （未記入） |
| `onCounterMul` | （未記入） |
| `onJust` | （未記入） |
| `onKill` | （未記入） |
| `attackGainMulMax` | （未記入） |
| `attackGainScale` | （未記入） |
| `costMulMin` | （未記入） |
| `maxMin` | （未記入） |
| `startFull` | （未記入） |
| `descendRefill` | （未記入） |

## combat/HEAL

戦闘中の回復を束ねる窓（system/combat.ts。

| 項目 | 意味 |
| --- | --- |
| `sustainWindow` | （未記入） |
| `sustainCapRatio` | （未記入） |
| `killHealMinCombo` | （未記入） |
| `descendHealRatio` | 初めて着いた階へ降りたとき、失った生命（maxHp - hp）のうちこの割合を回復する。割合(0..1) |
| `heartChanceByChapter` | 部屋を制圧したときにハートを落とす確率を章ごとに（1 章から順。章より深い階は最後の値）。割合(0..1)。試練の部屋は確定。章が進むほど絞る（回復は瓶と泉へ） |

## combat/BLAST_FALLOFF

爆発の距離減衰（system/blast.ts の blastFalloff。

| 項目 | 意味 |
| --- | --- |
| `innerRatio` | （未記入） |
| `edgeMul` | （未記入） |

## combat/STATUS

状態異常 36 種の数値（system/statusEffects.ts）。

| 項目 | 意味 |
| --- | --- |
| `burnDuration` | （未記入） |
| `burnParticleInterval` | （未記入） |
| `burnColor` | （未記入） |
| `chillColor` | （未記入） |
| `chillDuration` | （未記入） |
| `maxSlow` | （未記入） |
| `onHitIcd` | （未記入） |
| `shockRadius` | （未記入） |
| `shockMaxTargets` | （未記入） |
| `shockColor` | （未記入） |
| `explodeRadius` | （未記入） |
| `explodeColor` | （未記入） |
| `explodeKnockback` | （未記入） |
| `fxLife` | （未記入） |
| `ccWindow` | （未記入） |
| `ccBudget` | （未記入） |
| `chill.slowPerStack` | （未記入） |
| `chill.maxStacks` | （未記入） |
| `chill.playerMaxStacks` | （未記入） |
| `chill.duration` | （未記入） |
| `chill.bossMaxSlow` | （未記入） |
| `freeze.duration` | （未記入） |
| `freeze.shatterDamageMul` | （未記入） |
| `freeze.shatterPoise` | （未記入） |
| `freeze.chillImmuneAfter` | （未記入） |
| `shock.interval` | （未記入） |
| `shock.radius` | （未記入） |
| `shock.maxStacks` | （未記入） |
| `shock.duration` | （未記入） |
| `paralyze.duration` | （未記入） |
| `paralyze.bossDuration` | （未記入） |
| `paralyze.shockImmuneAfter` | （未記入） |
| `poison.hpRatioPerSec` | （未記入） |
| `poison.bossHpRatioPerSec` | （未記入） |
| `poison.playerHpRatioPerSec` | （未記入） |
| `poison.maxStacks` | （未記入） |
| `poison.playerMaxStacks` | （未記入） |
| `poison.duration` | （未記入） |
| `bleed.distance` | （未記入） |
| `bleed.maxStacks` | （未記入） |
| `bleed.duration` | （未記入） |
| `bleed.poisonMul` | （未記入） |
| `vulnerable.mul` | （未記入） |
| `vulnerable.duration` | （未記入） |
| `weaken.mul` | （未記入） |
| `weaken.duration` | （未記入） |
| `fear.duration` | （未記入） |
| `fear.immuneAfter` | （未記入） |
| `fear.wispMul` | （未記入） |
| `silence.enemyDuration` | （未記入） |
| `silence.playerDuration` | （未記入） |
| `vaporizeRatio` | （未記入） |
| `burnMaxStacks` | （未記入） |
| `reactionIcd` | （未記入） |
| `lastEndedWindow` | （未記入） |
| `statusCountCap` | （未記入） |
| `totalStacksCap` | （未記入） |
| `goodCountCap` | （未記入） |
| `wet.maxStacks` | （未記入） |
| `wet.duration` | （未記入） |
| `wet.shockRadiusMul` | （未記入） |
| `soaked.duration` | （未記入） |
| `soaked.slow` | （未記入） |
| `oiled.duration` | （未記入） |
| `blaze.duration` | （未記入） |
| `blaze.dpsMul` | （未記入） |
| `blaze.minDps` | （未記入） |
| `blaze.spreadRadius` | （未記入） |
| `blaze.spreadInterval` | （未記入） |
| `corrode.maxStacks` | （未記入） |
| `corrode.duration` | （未記入） |
| `corrode.poisePerStack` | （未記入） |
| `corrode.playerTakenPerStack` | （未記入） |
| `brand.maxStacks` | （未記入） |
| `brand.duration` | （未記入） |
| `brand.damagePerStack` | （未記入） |
| `brand.poisePerStack` | （未記入） |
| `brand.staggeredMul` | （未記入） |
| `broken.duration` | （未記入） |
| `broken.poiseMul` | （未記入） |
| `broken.staggerMul` | （未記入） |
| `doom.duration` | （未記入） |
| `doom.ratio` | （未記入） |
| `doom.vulnerableRatio` | （未記入） |
| `siphon.duration` | （未記入） |
| `siphon.manaPerHit` | （未記入） |
| `siphon.silencedMul` | （未記入） |
| `siphon.manaPerSecOnKill` | （未記入） |
| `hue.duration` | （未記入） |
| `hue.takenMul` | （未記入） |
| `hue.burstBurnRatio` | （未記入） |
| `hue.burstChill` | （未記入） |
| `hue.burstHeal` | （未記入） |
| `hue.burstDoomDuration` | （未記入） |
| `scorch.duration` | （未記入） |
| `scorch.dpsMul` | （未記入） |
| `scorch.spreadRadius` | （未記入） |
| `scorch.spreadInterval` | （未記入） |
| `scorch.vaporizeMul` | （未記入） |
| `venom.duration` | （未記入） |
| `venom.damageMul` | （未記入） |
| `venom.deathTerrainRadius` | （未記入） |
| `hemorrhage.duration` | （未記入） |
| `hemorrhage.perSec` | （未記入） |
| `encase.threshold` | （未記入） |
| `encase.shardRadius` | （未記入） |
| `encase.shardHpRatio` | （未記入） |
| `encase.shardMax` | （未記入） |
| `encase.shardPoise` | （未記入） |
| `encase.thawRadius` | （未記入） |
| `exposed.threshold` | （未記入） |
| `exposed.duration` | （未記入） |
| `exposed.mul` | （未記入） |
| `enfeeble.threshold` | （未記入） |
| `enfeeble.duration` | （未記入） |
| `enfeeble.mul` | （未記入） |
| `haste.duration` | （未記入） |
| `haste.moveMul` | （未記入） |
| `haste.extendOnHit` | （未記入） |
| `haste.maxTime` | （未記入） |
| `haste.chillExtend` | （未記入） |
| `harden.duration` | （未記入） |
| `harden.takenMul` | （未記入） |
| `harden.moveMul` | （未記入） |
| `harden.iceArmorPerChill` | （未記入） |
| `wrath.maxStacks` | （未記入） |
| `wrath.duration` | （未記入） |
| `wrath.poisePerStack` | （未記入） |
| `wrath.onHurt` | （未記入） |
| `wrath.onStagger` | （未記入） |
| `fury.duration` | （未記入） |
| `fury.poiseMul` | （未記入） |
| `fury.damageMul` | （未記入） |
| `fury.takenMul` | （未記入） |
| `charged.maxStacks` | （未記入） |
| `charged.duration` | （未記入） |
| `charged.damage` | （未記入） |
| `charged.wetRadiusMul` | （未記入） |
| `charged.wetSelfDamage` | （未記入） |
| `steam.radius` | （未記入） |
| `steam.weakenDuration` | （未記入） |
| `conduct.radiusMul` | （未記入） |
| `conduct.extraTargets` | （未記入） |
| `conduct.damage` | （未記入） |
| `kindle.dps` | （未記入） |
| `kindle.duration` | （未記入） |
| `quench.chillBonus` | （未記入） |
| `miasma.terrainRadius` | （未記入） |
| `miasma.radius` | （未記入） |
| `miasma.duration` | （未記入） |
| `shatterBleed.perStackSec` | （未記入） |
| `shatterBleed.spreadRadius` | （未記入） |
| `cauterize.perStackSec` | （未記入） |
| `cauterize.playerMul` | （未記入） |
| `panic.bleedMul` | （未記入） |
| `lacerate.extraStacks` | （未記入） |
| `wound.maxStacks` | 重ねられる上限（刃斧の戦意「傷」の上限 FORM.hewer.max と揃える） |
| `inkMark.maxStacks` | 重ねられる上限（書の左の 3 段で満ちる数） |
| `inkMark.radiusBase` | 読んだときの円の半径の基礎（px） |
| `inkMark.radiusPerStack` | 1 重ねごとに足す半径（px） |
| `inkMark.poisePerStack` | 円の中の敵それぞれに入る、1 重ねあたりの怯み値 |
| `inkMark.manaPerStack` | 読んだとき 1 重ねあたりに戻る気力（1 体の印を読むごと。気力の回収倍率が掛かる） |
| `inkMark.color` | 読んだときの円と粒の色 |

## combat/LIMITS

性能の歯止め（system/limits.ts）。

| 項目 | 意味 |
| --- | --- |
| `playerProjectiles` | プレイヤーの弾（state.projectiles の owner が player）の同時数の上限。敵の弾は数えない |
| `skillShots` | スキルの弾（state.skills.shots）の同時数の上限 |
| `placedPerPool` | 設置物の置き場（樽・墓・砲台・地雷・井戸・領域・泥沼・泉・杭・罠）ごとの同時数の上限 |

## combat/ATTR

ステータス（docs/COMBAT_DESIGN.md A）。

| 項目 | 意味 |
| --- | --- |
| `base` | （未記入） |
| `knee1` | （未記入） |
| `slope1` | （未記入） |
| `knee2` | （未記入） |
| `slope2` | （未記入） |
| `dexMove` | （未記入） |
| `dexDashCooldown` | （未記入） |
| `dexDashCooldownMin` | （未記入） |
| `vitMaxHp` | （未記入） |
| `vitStatusTaken` | （未記入） |
| `vitStatusTakenBase` | （未記入） |
| `vitStatusTakenMin` | （未記入） |
| `mndMaxMana` | （未記入） |
| `mndManaRegen` | （未記入） |
| `defArmor` | 防御 def の実効値 1 点あたり、防御力（PlayerStats.armor）に足す量 |
| `defWarding` | 防御 def の実効値 1 点あたり、魔防（PlayerStats.warding）に足す量 |

## combat/POISE

怯み（docs/COMBAT_DESIGN.md D-1）。

| 項目 | 意味 |
| --- | --- |
| `decayDelay` | （未記入） |
| `decayRate` | （未記入） |
| `guardedTime` | （未記入） |
| `guardedMul` | （未記入） |
| `bossGuardedTime` | （未記入） |
| `bossGuardedMul` | （未記入） |
| `bossPoiseGrowth` | （未記入） |
| `bossPoiseGrowthMax` | （未記入） |
| `bossDownDamageMul` | （未記入） |
| `eliteMul` | （未記入） |
| `knockbackUnstaggered` | （未記入） |
| `blockMul` | （未記入） |
| `shotBlockMul` | 盾持ちが正面で受けた弾の怯み値の倍率（近接の blockMul と同じ値から始める。撃ち続ければ盾が崩れる） |
| `chargerWallStagger` | （未記入） |
| `executeHpRatio` | （未記入） |
| `executeHpRatioMax` | 処刑の閾値の上限。ビルドで executeHpRatio を伸ばしてもこれを超えない（core-synthesis 3-7） |
| `executeMinPoise` | （未記入） |
| `executeMana` | （未記入） |
| `executeFearRadius` | （未記入） |
| `executeFearDuration` | （未記入） |
| `backstabDot` | （未記入） |
| `backstabMul` | （未記入） |
| `spreadRadius` | （未記入） |
| `spreadPoise` | （未記入） |

## combat/PARRY

全武器共通の受け流し（system/parry.ts。

| 項目 | 意味 |
| --- | --- |
| `windowSec` | 押してから受け流しが有効な秒 |
| `recoverSec` | 受け流しを外した（窓の間に被弾が無かった）後の硬直の秒。攻撃・射撃・ダッシュが出せず、移動は recoverMoveMul |
| `windowMoveMul` | 窓の間の移動速度の倍率（1 = 等倍） |
| `recoverMoveMul` | 外した硬直の間の移動速度の倍率（1 = 等倍。0 で足が止まる） |
| `arcDeg` | 受け流せる向きの角度（度。正面を中心にした扇。360 で全方位） |
| `bossPoise` | ボス（と怯まない敵）に入れる怯み値。ダウンのゲージに入るだけで、受け流しで毎回ダウンはしない |
| `mana` | 受け流しが決まったときに回復する気力 |

## combat/GENRE

攻撃ジャンルの係数（system/elementCombat.ts）。

| 項目 | 意味 |
| --- | --- |
| `hybridMix` | （未記入） |
| `enemyDefenseMin` | （未記入） |
| `enemyDefenseMax` | （未記入） |

## combat/ELEMENT

属性（docs/COMBAT_DESIGN.md A-8）。

| 項目 | 意味 |
| --- | --- |
| `resistMin` | （未記入） |
| `resistMax` | （未記入） |
| `resistKnee` | （未記入） |
| `resistSlope` | （未記入） |
| `enemyResistMin` | （未記入） |
| `enemyResistMax` | （未記入） |
| `weakColor` | （未記入） |
| `resistColor` | （未記入） |
| `textScale` | （未記入） |
| `textLife` | （未記入） |
| `textDedupeRadius` | （未記入） |
| `affinity.chance` | （未記入） |
| `affinity.duration` | （未記入） |
| `affinity.minShare` | （未記入） |
| `affinity.potency.burn` | （未記入） |
| `affinity.potency.chill` | （未記入） |
| `affinity.potency.shock` | （未記入） |
| `affinity.potency.poison` | （未記入） |
| `affinity.potency.weaken` | （未記入） |
| `affinity.potency.vulnerable` | （未記入） |
| `mark.offsetY` | （未記入） |
| `mark.size` | （未記入） |
| `mark.unknownColor` | （未記入） |

## combat/TERRAIN

地形の層の効果（system/terrain.ts・map/generator.ts の planTerrain）。

| 項目 | 意味 |
| --- | --- |
| `tickInterval` | （未記入） |
| `water.wetStacks` | （未記入） |
| `oil.oiledStacks` | （未記入） |
| `lava.damage` | （未記入） |
| `lava.enemyDamage` | （未記入） |
| `lava.burnDps` | （未記入） |
| `lava.burnDuration` | （未記入） |
| `bog.poisonDuration` | （未記入） |
| `bog.corrodeEvery` | （未記入） |
| `ice.chillEvery` | （未記入） |
| `ice.chillDuration` | （未記入） |
| `ice.accel` | （未記入） |
| `fire.burnDps` | （未記入） |
| `fire.burnDuration` | （未記入） |
| `fire.oilBurnTime` | （未記入） |
| `fire.grassBurnTime` | （未記入） |
| `fire.spreadOil` | （未記入） |
| `fire.spreadGrass` | （未記入） |
| `placedDuration.none` | （未記入） |
| `placedDuration.water` | （未記入） |
| `placedDuration.oil` | （未記入） |
| `placedDuration.lava` | （未記入） |
| `placedDuration.bog` | （未記入） |
| `placedDuration.ice` | （未記入） |
| `placedDuration.grass` | （未記入） |
| `placedDuration.fire` | （未記入） |
| `placedDuration.mud` | （未記入） |
| `placedDuration.smoke` | （未記入） |
| `placedDuration.rubble` | （未記入） |
| `gen.patchesBase` | （未記入） |
| `gen.patchesPerDepth` | （未記入） |
| `gen.patchesMax` | （未記入） |
| `gen.radiusMin` | （未記入） |
| `gen.radiusMax` | （未記入） |
| `gen.minDepth.water` | （未記入） |
| `gen.minDepth.grass` | （未記入） |
| `gen.minDepth.oil` | （未記入） |
| `gen.minDepth.ice` | （未記入） |
| `gen.minDepth.bog` | （未記入） |
| `gen.minDepth.lava` | （未記入） |
| `gen.weight.water` | （未記入） |
| `gen.weight.grass` | （未記入） |
| `gen.weight.oil` | （未記入） |
| `gen.weight.ice` | （未記入） |
| `gen.weight.bog` | （未記入） |
| `gen.weight.lava` | （未記入） |

## combat/TERRAIN_MUD_SMOKE

地形「泥」「煙」（docs/ideas/enemies.md E2 / V10）

| 項目 | 意味 |
| --- | --- |
| `mud.moveMul` | （未記入） |
| `mud.bakeParalyze` | （未記入） |
| `mud.bakeColor` | （未記入） |
| `mud.bakeParticles` | （未記入） |
| `mud.genMinDepth` | （未記入） |
| `mud.genWeight` | （未記入） |
| `smoke.puffColor` | （未記入） |
| `smoke.puffParticles` | （未記入） |

## combat/TERRAIN_RUBBLE

地形「崩れる床」（docs/ideas/status-and-terrain.md 3 章 #9・2-2）

| 項目 | 意味 |
| --- | --- |
| `duration` | （未記入） |
| `fallDelay` | （未記入） |
| `fallDamage` | （未記入） |
| `perDepth` | （未記入） |
| `fallStagger` | （未記入） |
| `bossPoise` | （未記入） |
| `color` | （未記入） |
| `particles` | （未記入） |

## combat/PLAYER

プレイヤーの手触り（docs/COMBAT_DESIGN.md C-1 / D-5）。

| 項目 | 意味 |
| --- | --- |
| `radius` | （未記入） |
| `maxHp` | （未記入） |
| `speed` | （未記入） |
| `attackMoveMul` | （未記入） |
| `staggerMoveMul` | （未記入） |
| `dash.time` | （未記入） |
| `dash.speed` | （未記入） |
| `dash.cooldown` | （未記入） |
| `dash.graceInvuln` | （未記入） |
| `dash.invulnTime` | （未記入） |
| `hurtInvuln` | （未記入） |
| `hurtKnockback` | （未記入） |
| `comboLockout` | （未記入） |
| `recoverCancel` | （未記入） |
| `shoot.cooldown` | （未記入） |
| `shoot.speed` | （未記入） |
| `shoot.scaling.base` | （未記入） |
| `shoot.scaling.dex` | （未記入） |
| `shoot.poise` | （未記入） |
| `shoot.life` | （未記入） |
| `shoot.radius` | （未記入） |
| `shoot.recoil` | （未記入） |
| `maxEnergy` | （未記入） |
| `projectileSpreadDeg` | （未記入） |
| `critHitstopBonus` | （未記入） |
| `critTextScale` | （未記入） |
| `critColor` | （未記入） |
| `overclockHpCost` | （未記入） |
| `overclockShootInterval` | （未記入） |

## combat/ACTION

アクション手触り（docs/ideas/action-feel.md「まず入れるべき5つ」+ 壁叩きつけ・ダッシュ攻撃）。

| 項目 | 意味 |
| --- | --- |
| `*` | 出端の命中。damageMul = 威力の倍、poiseMul = 怯み値の倍（下絵に絞った報酬。連打でも出た頃の 1 から 1.5 へ）、color / particles = 命中点の粒 |
| `*.slowmo` | （未記入） |
| `*.flash` | （未記入） |
| `*.color` | （未記入） |
| `*.textScale` | （未記入） |
| `*.textLife` | （未記入） |
| `*.textOffsetY` | （未記入） |
| `*.ringRadius` | （未記入） |
| `*.ringLife` | （未記入） |
| `*.particles` | （未記入） |
| `*.window` | （未記入） |
| `*.perHitRatio` | （未記入） |
| `*.poolRatio` | （未記入） |
| `*.damage` | （未記入） |
| `*.poise` | （未記入） |
| `*.hitstop` | （未記入） |

## combat/ENERGY

奥義ゲージの溜まり方（system/combat.ts の meleeHitEnergy）。

| 項目 | 意味 |
| --- | --- |
| `perSwingSec` | 1 秒ぶんの振り（予備動作 + 攻撃判定 + 戻り の基礎秒の合計）で溜まる奥義ゲージ。目安 35〜55 |
| `minPerHit` | 1 命中で溜まる量の下限（速い多段の段でも 0 に近づけない） |
| `maxPerHit` | 1 命中で溜まる量の上限（重い一振りを 1 体に当てただけで溜まりきらないように） |
| `just` | 見切り（JUST 回避）・パリィ 1 回で溜まる量 |
| `skillMeleeHit` | スキルの近接の命中 1 回で溜まる量（スキルの段は振りの秒を持たないので定数） |

## enemies/ENEMY_AI

追加敵の行動パラメータ。

| 項目 | 意味 |
| --- | --- |
| `strikerHoldTime` | （未記入） |
| `knockDecay` | （未記入） |
| `knight.blockArcDeg` | （未記入） |
| `knight.blockColor` | （未記入） |
| `knight.blockPushback` | （未記入） |
| `knight.lungeSpeedMul` | （未記入） |
| `bomber.keepAway` | （未記入） |
| `bomber.fuse` | （未記入） |
| `bomber.radius` | （未記入） |
| `bomber.damage` | （未記入） |
| `bomber.throwDist` | （未記入） |
| `bomber.color` | （未記入） |
| `bomber.deathFuse` | （未記入） |
| `laser.width` | （未記入） |
| `laser.length` | （未記入） |
| `laser.damage` | （未記入） |
| `laser.thinRatio` | （未記入） |
| `laser.color` | （未記入） |
| `golem.ringRadius` | （未記入） |
| `golem.ringTime` | （未記入） |
| `golem.ringThickness` | （未記入） |
| `golem.damage` | （未記入） |
| `golem.color` | （未記入） |
| `bat.zigzagFreq` | （未記入） |
| `bat.zigzagAmount` | （未記入） |
| `bat.retreatMul` | （未記入） |
| `wisp.deathExplodeRadius` | （未記入） |
| `wisp.deathExplodeDamage` | （未記入） |
| `wisp.deathExplodeFuse` | （未記入） |
| `wisp.color` | （未記入） |
| `volley.bulletLife` | （未記入） |
| `volley.bulletRadius` | （未記入） |
| `flank.minDist` | （未記入） |
| `timid.fleeMul` | （未記入） |
| `timid.color` | （未記入） |
| `deathBurst.life` | （未記入） |
| `rockfall.count` | （未記入） |
| `rockfall.spread` | （未記入） |
| `rockfall.radius` | （未記入） |
| `rockfall.damage` | （未記入） |
| `rockfall.fuse` | （未記入） |
| `kamikaze.color` | （未記入） |
| `echoStriker.delay` | （未記入） |
| `echoStriker.sampleInterval` | （未記入） |
| `echoStriker.radius` | （未記入） |
| `echoStriker.damage` | （未記入） |
| `echoStriker.keepAway` | （未記入） |
| `echoStriker.color` | （未記入） |
| `packLeader.fearTime` | （未記入） |
| `conductor.bulletCount` | （未記入） |
| `conductor.spreadDeg` | （未記入） |
| `conductor.bulletSpeed` | （未記入） |
| `conductor.bulletDamage` | （未記入） |
| `conductor.keepAway` | （未記入） |
| `conductor.color` | （未記入） |
| `manaLeech.steal` | （未記入） |
| `manaLeech.returnMul` | （未記入） |
| `corpse.lifetime` | （未記入） |
| `corpse.max` | （未記入） |
| `scavenger.seekRadius` | （未記入） |
| `scavenger.eatRange` | （未記入） |
| `scavenger.eatTime` | （未記入） |
| `scavenger.maxGrowth` | （未記入） |
| `scavenger.hpPerGrowth` | （未記入） |
| `scavenger.damagePerGrowth` | （未記入） |
| `scavenger.radiusPerGrowth` | （未記入） |
| `scavenger.color` | （未記入） |
| `graveBell.rings` | （未記入） |
| `graveBell.color` | （未記入） |
| `silencer.radius` | （未記入） |
| `silencer.duration` | （未記入） |
| `silencer.keepAway` | （未記入） |
| `silencer.color` | （未記入） |
| `frostCrusher.ringRadius` | （未記入） |
| `frostCrusher.damage` | （未記入） |
| `frostCrusher.color` | （未記入） |
| `twinShade.reviveTime` | （未記入） |
| `twinShade.reviveHpRatio` | （未記入） |
| `twinShade.color` | （未記入） |
| `mimic.tongueLength` | （未記入） |
| `mimic.tongueDamage` | （未記入） |
| `mimic.biteSpeedMul` | （未記入） |
| `mimic.color` | （未記入） |
| `hollowArmor.ringRadius` | （未記入） |
| `hollowArmor.damage` | （未記入） |
| `hollowArmor.breakStagger` | （未記入） |
| `hollowArmor.color` | （未記入） |
| `terrainSeed.delay` | （未記入） |
| `friendlyBlastMul` | （未記入） |
| `silencedAttackManaMul` | （未記入） |
| `lobber.keepAway` | （未記入） |
| `oiler.dropInterval` | （未記入） |
| `oiler.dropRadius` | （未記入） |
| `bellImp.radius` | （未記入） |
| `bellImp.rallyTime` | （未記入） |
| `bellImp.hasteMul` | （未記入） |
| `bellImp.keepAway` | （未記入） |
| `bellImp.color` | （未記入） |
| `banner.radius` | （未記入） |
| `banner.takenMul` | （未記入） |
| `banner.rallyTime` | （未記入） |
| `banner.keepAway` | （未記入） |
| `banner.color` | （未記入） |
| `charged.radius` | （未記入） |
| `charged.time` | （未記入） |
| `charged.deathChainDamage` | （未記入） |
| `charged.contactShock` | （未記入） |
| `charged.color` | （未記入） |
| `burrower.burrowSpeedMul` | （未記入） |
| `burrower.emergeRadius` | （未記入） |
| `burrower.damage` | （未記入） |
| `burrower.exposeTime` | （未記入） |
| `burrower.dustInterval` | （未記入） |
| `burrower.color` | （未記入） |
| `dropper.noticeRange` | （未記入） |
| `dropper.radius` | （未記入） |
| `dropper.damage` | （未記入） |
| `dropper.color` | （未記入） |
| `absorber.radius` | （未記入） |
| `absorber.maxShots` | （未記入） |
| `absorber.spreadDeg` | （未記入） |
| `absorber.bulletSpeed` | （未記入） |
| `absorber.bulletDamage` | （未記入） |
| `absorber.color` | （未記入） |
| `homunculus.blasts` | （未記入） |
| `homunculus.spread` | （未記入） |
| `homunculus.radius` | （未記入） |
| `homunculus.damage` | （未記入） |
| `homunculus.fallbackDuration` | （未記入） |
| `homunculus.keepAway` | （未記入） |
| `homunculus.color` | （未記入） |
| `scribeImp.keepAway` | （未記入） |
| `scribeImp.bulletCount` | （未記入） |
| `scribeImp.spreadDeg` | （未記入） |
| `scribeImp.bulletSpeed` | （未記入） |
| `scribeImp.bulletDamage` | （未記入） |
| `scribeImp.ringRadius` | （未記入） |
| `scribeImp.ringDamage` | （未記入） |
| `scribeImp.blastCount` | （未記入） |
| `scribeImp.blastSpread` | （未記入） |
| `scribeImp.blastRadius` | （未記入） |
| `scribeImp.blastDamage` | （未記入） |
| `scribeImp.color` | （未記入） |
| `crossGolem.length` | （未記入） |
| `crossGolem.damage` | （未記入） |
| `windSprite.range` | （未記入） |
| `windSprite.arcDeg` | （未記入） |
| `windSprite.push` | （未記入） |
| `windSprite.maxPush` | （未記入） |
| `windSprite.bulletPush` | （未記入） |
| `windSprite.keepAway` | （未記入） |
| `windSprite.color` | （未記入） |
| `mineLayer.dropInterval` | （未記入） |
| `mineLayer.max` | （未記入） |
| `mineLayer.keepAway` | （未記入） |
| `mine.trigger` | （未記入） |
| `mine.radius` | （未記入） |
| `mine.damage` | （未記入） |
| `mine.color` | （未記入） |
| `chainWarden.length` | （未記入） |
| `chainWarden.pull` | （未記入） |
| `chainWarden.pullDamage` | （未記入） |
| `chainWarden.slamWindup` | （未記入） |
| `chainWarden.slamRadius` | （未記入） |
| `chainWarden.slamDamage` | （未記入） |
| `chainWarden.color` | （未記入） |
| `hollow.freezeArcDeg` | （未記入） |
| `hollow.color` | （未記入） |
| `flameEater.seekRadius` | （未記入） |
| `flameEater.eatRadius` | （未記入） |
| `flameEater.eatCooldown` | （未記入） |
| `flameEater.heal` | （未記入） |
| `flameEater.radiusPerGrowth` | （未記入） |
| `flameEater.maxGrowth` | （未記入） |
| `flameEater.color` | （未記入） |
| `spore.cooldown` | （未記入） |
| `spore.radius` | （未記入） |
| `swampWisp.speedMul` | （未記入） |
| `iceTrail.radius` | （未記入） |
| `giantToad.tongueLength` | （未記入） |
| `giantToad.pull` | （未記入） |
| `giantToad.biteRadius` | （未記入） |
| `giantToad.biteDamage` | （未記入） |
| `giantToad.pondRadius` | （未記入） |
| `giantToad.color` | （未記入） |
| `forgeMaster.keepAway` | （未記入） |
| `forgeMaster.bladeCount` | （未記入） |
| `forgeMaster.spreadDeg` | （未記入） |
| `forgeMaster.bladeSpeed` | （未記入） |
| `forgeMaster.bladeDamage` | （未記入） |
| `forgeMaster.fireRadius` | （未記入） |
| `forgeMaster.enrageMul` | （未記入） |
| `forgeMaster.anvilBreakStagger` | （未記入） |
| `forgeMaster.color` | （未記入） |
| `turretMaster.turrets` | （未記入） |
| `turretMaster.turretBreakStagger` | （未記入） |
| `turretMaster.orbSpeed` | （未記入） |
| `turretMaster.orbDamage` | （未記入） |
| `turretMaster.color` | （未記入） |
| `turret.bulletSpeed` | （未記入） |
| `turret.bulletDamage` | （未記入） |
| `basilisk.range` | （未記入） |
| `basilisk.arcDeg` | （未記入） |
| `basilisk.stillSpeed` | （未記入） |
| `basilisk.chillEvery` | （未記入） |
| `basilisk.biteTime` | （未記入） |
| `basilisk.color` | （未記入） |
| `shadowStalker.behind` | （未記入） |
| `shadowStalker.radius` | （未記入） |
| `shadowStalker.damage` | （未記入） |
| `shadowStalker.exposeTime` | （未記入） |
| `shadowStalker.color` | （未記入） |
| `leaper.maxLeap` | 跳躍（leaper）で一度に跳ぶ最大の距離。px。着地点はプレイヤーの位置をこの距離までで切った点 |
| `leaper.radius` | 着地で当たる円の半径。px（予備動作の始まりから着地まで、同じ大きさの影で予告する） |
| `leaper.particles` | 着地の土煙の粒の数 |

## enemies/ENEMY_TEMPO

敵の攻撃テンポ(docs/COMBAT_DESIGN.md C-2): 深度による予備動作短縮・連携ずらし・連続攻撃。

| 項目 | 意味 |
| --- | --- |
| `windupDepthStep` | （未記入） |
| `windupDepthMin` | （未記入） |
| `windupFloor` | （未記入） |
| `coordRadius` | （未記入） |
| `coordCooldownMax` | （未記入） |
| `commitRatio` | 予備動作の残りがこの割合を切ったら怯み値が溜まらず、攻撃は必ず出る（コミット。受け流しだけが止める）。割合(0..1)。0 で従来どおり、1 で予備動作中は一切怯まない。目安 0.5〜0.7 |
| `aimLockSec` | 狙いが固まる残り秒の下限: 予備動作の残りがこの秒（と aimLockRatio 側の長い方）を切ったら、以後は向きを変えず、固まった向きに撃つ。予告の線もそこで止まる。秒。目安 0.15〜0.3 |
| `aimLockRatio` | 狙いが固まる残りの割合: 予備動作の全体 × この割合も固まる残りになる（長い予備動作ほど早めに固まる）。割合(0..1)。固まる残り秒 = min(予備動作の全体, max(aimLockSec, 全体 × aimLockRatio))。0 で aimLockSec だけ。目安 0.25〜0.45 |
| `coordDelay` | 連携ずらし: 近くで攻撃しかけている敵の攻撃開始をこの秒だけ待たせる。秒 |
| `strikerBase` | 同時に攻撃（strike）してよい非ボスの敵の数の下限。周りの敵が少ないときはこの数 |
| `strikerPerAwake` | プレイヤーの近くで起きている敵がこの数増えるごとに、同時攻撃の上限が 1 増える。上限 = strikerBase + 切り捨て(起きている敵 ÷ この数) |
| `strikerCountRadius` | 同時攻撃の上限に数える「起きている敵」の範囲。プレイヤーからの px |
| `telegraphWindow` | 予告の見やすさの上限: 予備動作に入ってからこの秒の間を「予告が出たばかり」とみなす。秒 |
| `telegraphCap` | 予告が出たばかり（telegraphWindow 未満）の敵がこの数以上いたら、新しい予備動作は telegraphWindow だけ待つ。ボスは数えない |
| `telegraphRange` | 予告の見やすさの上限に数える敵の範囲。プレイヤーからの px |
| `batCoordDelay` | （未記入） |
| `depthStages` | 章で技を覚える段（docs/ideas/jin-impl.md 2-4）。敵の定義 key ごとの段の列（minDepth の昇順）。深度が minDepth 以上の段が全部効き、同じ技は後の段が上書きする |
| `depthStages.*[].minDepth` | この段の技を覚える最小の深度 |
| `depthStages.*[].followUp` | 連撃: 1 撃目のあとに予備動作を挟んで続ける |
| `depthStages.*[].followUp.count` | 1 撃目のあとに追加で続ける撃数 |
| `depthStages.*[].followUp.windup` | 2 撃目以降の予備動作の基準。秒（深度で縮み、windupFloor 倍が下限） |
| `depthStages.*[].followUp.onWallOnly` | true なら壁に激突したときだけ続ける（猪） |
| `depthStages.*[].retreatMul` | 離脱: 攻撃の後の隙の間に離れる速さ。歩く速さに対する倍率。REACTION.retreatAfterStrike と behavior 既定より優先 |
| `depthStages.*[].windupMoveMul` | 予備動作中に動く速さ。歩く速さに対する倍率。負は後退射撃（プレイヤーから離れながら構える）。behavior 既定より優先 |

## enemies/ELITE

エリート修飾子(旧エリート表示は「精鋭」)

| 項目 | 意味 |
| --- | --- |
| `minDepth` | （未記入） |
| `baseChance` | （未記入） |
| `chancePerDepth` | （未記入） |
| `maxChance` | （未記入） |
| `scoreMul` | （未記入） |
| `dropMul` | （未記入） |
| `hpMul` | （未記入） |
| `speedMul` | （未記入） |
| `windupMul` | （未記入） |
| `shieldRatio` | （未記入） |
| `shieldBreakStagger` | （未記入） |
| `explodeRadius` | （未記入） |
| `explodeDamage` | （未記入） |
| `explodeFuse` | （未記入） |
| `explodeColor` | （未記入） |
| `reflectColor` | （未記入） |
| `reflectDamage` | （未記入） |
| `linkColor` | （未記入） |
| `auraAlpha` | （未記入） |
| `echoWindup` | （未記入） |
| `bulwarkPoiseMul` | （未記入） |
| `bulwarkStaggerMul` | （未記入） |
| `bulwarkVulnerableTime` | （未記入） |
| `retaliateDelay` | （未記入） |
| `retaliateRadius` | （未記入） |
| `retaliateDamage` | （未記入） |
| `prismaticImmune` | （未記入） |
| `timedClock` | （未記入） |
| `timedPoiseMul` | （未記入） |
| `parasiteCount` | （未記入） |
| `parasiteHp` | （未記入） |
| `anchoredSpeedMul` | （未記入） |
| `devourRange` | （未記入） |
| `devourHeal` | （未記入） |
| `packedCount` | （未記入） |
| `packedHpRatio` | （未記入） |
| `packedOffset` | （未記入） |
| `searingInterval` | （未記入） |
| `searingRadius` | （未記入） |
| `searingDuration` | （未記入） |
| `hexRadius` | （未記入） |
| `commandRadius` | （未記入） |
| `commandCooldownMax` | （未記入） |
| `evadeDist` | （未記入） |
| `evadeCooldown` | （未記入） |
| `chainCount` | （未記入） |
| `chainRadius` | （未記入） |
| `chainChillTime` | （未記入） |
| `chainTouchIcd` | （未記入） |
| `chainWidth` | （未記入） |
| `pairMinDepth` | （未記入） |
| `pairChance` | （未記入） |
| `pyreInterval` | （未記入） |
| `pyreRadius` | （未記入） |
| `hexDrain` | （未記入） |
| `evadeHasteDistMul` | （未記入） |
| `evadeHasteCooldownMul` | （未記入） |

## enemies/ELITE_GREEDY

精鋭修飾子「強欲の」(docs/ideas/enemies.md M12)。

| 項目 | 意味 |
| --- | --- |
| `seekRadius` | （未記入） |
| `grabRadius` | （未記入） |
| `carryMax` | （未記入） |
| `runMul` | （未記入） |
| `fleeRadius` | （未記入） |
| `stuckRatio` | （未記入） |
| `cornerFightTime` | （未記入） |
| `bonusDrops` | （未記入） |
| `dropSpread` | （未記入） |
| `color` | （未記入） |

## enemies/DOUBLE_CHARGE

二度突きの猪(docs/ideas/enemies.md E6)。

| 項目 | 意味 |
| --- | --- |
| `overshoot` | （未記入） |
| `leg1Min` | （未記入） |
| `leg1Max` | （未記入） |
| `leg2Len` | （未記入） |
| `turnDeg` | （未記入） |
| `lineAlpha` | （未記入） |
| `secondAlpha` | （未記入） |

## enemies/BOSS

ボス共通 + 個体別パラメータ。

| 項目 | 意味 |
| --- | --- |
| `interval` | （未記入） |
| `roomMinW` | （未記入） |
| `roomMinH` | （未記入） |
| `introTime` | （未記入） |
| `defeatSlowmo` | （未記入） |
| `rareDrops` | （未記入） |
| `rareDropBoost` | （未記入） |
| `rareDropAttempts` | （未記入） |
| `kingSlime.jumpRise` | 高い跳躍: 跳んでから影の真上に着くまでの秒（下絵。深度で縮めない） |
| `kingSlime.jumpHover` | 高い跳躍: 影の真上で止まる秒（下絵。深度で縮む） |
| `kingSlime.phase2Hover` | 段階 2 以降の滞空の秒（jumpHover の代わり） |
| `kingSlime.jumpFall` | 高い跳躍: 落ちる秒（墨入れ。深度で縮めない = 墨入れを見てからの猶予を一定にする） |
| `kingSlime.dropDown` | 墜落（下絵のうちに打たれた跳躍）のダウンの秒 |
| `kingSlime.dropsToSplit` | 段階 1 の墜落がこの回数で、生命に関わらず分裂する |
| `kingSlime.shockRadius` | （未記入） |
| `kingSlime.shockDamage` | （未記入） |
| `kingSlime.phase2Ratio` | （未記入） |
| `kingSlime.splitCount` | （未記入） |
| `kingSlime.phase2SpeedMul` | （未記入） |
| `kingSlime.crownHpRatio` | 冠スライムの生命 = 王の最大生命 × この値 |
| `kingSlime.crownShade` | 冠スライムが隠れる、王から見てプレイヤーの反対側の距離（px） |
| `kingSlime.crownDown` | 冠落ち（冠スライムを倒した）のダウンの秒 |
| `kingSlime.crownHealRatio` | 冠呑み（冠を王が呑んだ）で回復する最大生命の割合 |
| `kingSlime.stillJumpChain` | 第 1 段階: 着地の時点でプレイヤーが止まっていれば続けて跳ぶ回数 |
| `kingSlime.acidRadius` | 第 2 段階: 跳躍の着地点に残す毒沼の半径（px） |
| `kingSlime.acidTime` | 毒沼の持続（秒） |
| `kingSlime.swallowEvery` | 第 2 段階: 分裂体を呑む間隔（前の呑み・分裂からの秒） |
| `kingSlime.swallowHopTime` | 呑みに跳ぶ空中の秒 |
| `kingSlime.swallowRingRadius` | 呑みの予告の輪の半径。着地点からこの範囲の分裂体を呑む（px） |
| `kingSlime.digestTime` | 呑み込んでから回復が入るまでの秒。その間も王は動き、ダウンすると吐き出して回復しない |
| `kingSlime.swallowHealRatio` | 消化し終えたとき、呑んだ 1 体ごとに回復する最大生命の割合 |
| `kingSlime.biteWindup` | 噛みの屈みの秒（最初から墨入れ。深度で縮む） |
| `kingSlime.biteHopTime` | 噛みの低い跳びの空中の秒（墨入れ） |
| `kingSlime.biteRadius` | 噛みの当たりの半径（px）。影も同じ |
| `kingSlime.biteDamage` | 噛みのダメージ（深度で伸びる） |
| `kingSlime.biteMissDown` | 呑み損ね（噛みを受け流された）のダウンの秒 |
| `kingSlime.phase3Ratio` | 冠が残っていても第 3 段階（膨張）へ進む生命の割合（保険） |
| `kingSlime.inflateWindup` | 膨張の予備動作の秒（中央に着いてから。輪の予告） |
| `kingSlime.waveCount` | 膨張の衝撃波の重ね数 |
| `kingSlime.waveGap` | 膨張の衝撃波の間隔（秒） |
| `kingSlime.waveDamage` | 膨張の衝撃波 1 つのダメージ（深度で伸びる） |
| `kingSlime.cornerSafeRatio` | 膨張の衝撃波の半径 = 中央から部屋の最も近い角までの距離 × この値（四隅だけ安全） |
| `kingSlime.inflateRecover` | 膨張の後の硬直の秒 |
| `boneLord.bulletSpeed` | （未記入） |
| `boneLord.bulletDamage` | （未記入） |
| `boneLord.bulletDirs` | （未記入） |
| `boneLord.volleys` | （未記入） |
| `boneLord.volleyInterval` | （未記入） |
| `boneLord.volleySpin` | （未記入） |
| `boneLord.wallDuration` | （未記入） |
| `boneLord.wallLength` | （未記入） |
| `boneLord.wallHp` | （未記入） |
| `boneLord.wallBlastRadius` | （未記入） |
| `boneLord.teleportRatio` | （未記入） |
| `boneLord.teleportInterval` | （未記入） |
| `boneLord.color` | （未記入） |
| `twinKnights.lungeSpeedMul` | （未記入） |
| `twinKnights.arrowSpeed` | （未記入） |
| `twinKnights.arrowDamage` | （未記入） |
| `twinKnights.arrowCount` | （未記入） |
| `twinKnights.arrowSpreadDeg` | （未記入） |
| `twinKnights.rageArrowCount` | （未記入） |
| `twinKnights.keepAway` | （未記入） |
| `twinKnights.bereavedWindupMul` | （未記入） |
| `twinKnights.rageRatio` | （未記入） |
| `twinKnights.rageIntervalMul` | （未記入） |
| `twinKnights.color` | （未記入） |
| `frostGiant.slamRadius` | （未記入） |
| `frostGiant.slamDamage` | （未記入） |
| `frostGiant.slamCoreRatio` | （未記入） |
| `frostGiant.phase2Ratio` | （未記入） |
| `frostGiant.phase3Ratio` | （未記入） |
| `frostGiant.icicleCount` | （未記入） |
| `frostGiant.icicleRadius` | （未記入） |
| `frostGiant.icicleDamage` | （未記入） |
| `frostGiant.icicleFall` | （未記入） |
| `frostGiant.icicleSpread` | （未記入） |
| `frostGiant.pillarCount` | （未記入） |
| `frostGiant.pillarDistance` | （未記入） |
| `frostGiant.armorBreakDown` | （未記入） |
| `frostGiant.color` | （未記入） |
| `oilKing.jarCount` | （未記入） |
| `oilKing.jarSpread` | （未記入） |
| `oilKing.jarRadius` | （未記入） |
| `oilKing.jarBlast` | （未記入） |
| `oilKing.jarDamage` | （未記入） |
| `oilKing.jarFall` | （未記入） |
| `oilKing.chargeSpeedMul` | （未記入） |
| `oilKing.chargeTime` | （未記入） |
| `oilKing.wallStagger` | （未記入） |
| `oilKing.fireBombRadius` | （未記入） |
| `oilKing.fireBombDamage` | （未記入） |
| `oilKing.trailInterval` | （未記入） |
| `oilKing.trailRadius` | （未記入） |
| `oilKing.slamRadius` | （未記入） |
| `oilKing.slamDamage` | （未記入） |
| `oilKing.igniteStagger` | （未記入） |
| `oilKing.igniteCooldown` | （未記入） |
| `oilKing.phase2Ratio` | （未記入） |
| `oilKing.phase3Ratio` | （未記入） |
| `oilKing.ignitesToDrench` | 第 2 段階: 王を燃える床へ誘って引火させると第 3 段階（油まみれ）へ進む回数（生命に関わらず） |
| `oilKing.chargeChain` | 第 3 段階: 突進が壁に当たらなければ続けて出す回数 |
| `oilKing.color` | （未記入） |
| `broodMother.eggCount` | （未記入） |
| `broodMother.eggHatch` | （未記入） |
| `broodMother.eggSpread` | （未記入） |
| `broodMother.layTime` | （未記入） |
| `broodMother.biteSpeedMul` | （未記入） |
| `broodMother.biteTime` | （未記入） |
| `broodMother.jumpTime` | （未記入） |
| `broodMother.landRadius` | （未記入） |
| `broodMother.landDamage` | （未記入） |
| `broodMother.acidRadius` | （未記入） |
| `broodMother.swarmInterval` | （未記入） |
| `broodMother.swarmCount` | （未記入） |
| `broodMother.eggBreakPoise` | （未記入） |
| `broodMother.phase2Ratio` | （未記入） |
| `broodMother.phase3Ratio` | （未記入） |
| `broodMother.color` | （未記入） |
| `librarian.keepAway` | （未記入） |
| `librarian.shelfLength` | （未記入） |
| `librarian.shelfFall` | （未記入） |
| `librarian.pageCount` | （未記入） |
| `librarian.pageSpread` | （未記入） |
| `librarian.pageSpeed` | （未記入） |
| `librarian.pageDamage` | （未記入） |
| `librarian.readTime` | （未記入） |
| `librarian.readDropStagger` | （未記入） |
| `librarian.thunderCount` | （未記入） |
| `librarian.thunderSpread` | （未記入） |
| `librarian.thunderRadius` | （未記入） |
| `librarian.thunderDamage` | （未記入） |
| `librarian.pullRadius` | （未記入） |
| `librarian.pullForce` | （未記入） |
| `librarian.pullRingDamage` | （未記入） |
| `librarian.toppleLength` | （未記入） |
| `librarian.toppleSpacing` | （未記入） |
| `librarian.toppleRadius` | （未記入） |
| `librarian.toppleDamage` | （未記入） |
| `librarian.toppleFall` | （未記入） |
| `librarian.phase2Ratio` | （未記入） |
| `librarian.phase3Ratio` | （未記入） |
| `librarian.color` | （未記入） |
| `mirrorKnight.lungeSpeedMul` | （未記入） |
| `mirrorKnight.lungeTime` | （未記入） |
| `mirrorKnight.wallStagger` | （未記入） |
| `mirrorKnight.waveCount` | （未記入） |
| `mirrorKnight.waveSpread` | （未記入） |
| `mirrorKnight.waveSpeed` | （未記入） |
| `mirrorKnight.waveDamage` | （未記入） |
| `mirrorKnight.reflectDamage` | （未記入） |
| `mirrorKnight.procDuration` | （未記入） |
| `mirrorKnight.procMax` | （未記入） |
| `mirrorKnight.images` | （未記入） |
| `mirrorKnight.imageHpRatio` | （未記入） |
| `mirrorKnight.imageGuardMul` | （未記入） |
| `mirrorKnight.phase2Ratio` | （未記入） |
| `mirrorKnight.phase3Ratio` | （未記入） |
| `mirrorKnight.slamsToCrack` | 第 1 段階: 突進の壁激突がこの回数で HP に関わらず第 2 段階（盾割れ）へ進む |
| `mirrorKnight.bashRange` | 盾打ちの扇の届く距離（px）。予告の扇と同じ |
| `mirrorKnight.bashHalfDeg` | 盾打ちの扇の半角（度） |
| `mirrorKnight.bashDamage` | 盾打ちのダメージ（深度で伸びる） |
| `mirrorKnight.copyRecoil` | 模写の後の反動（ダウン）の秒 |
| `mirrorKnight.copyRingRadius` | 模写（輪）の衝撃波の半径（px） |
| `mirrorKnight.copyLaserTime` | 模写（線）の光線の持続（秒） |
| `mirrorKnight.copyDamage` | 模写（輪・線）のダメージ（深度で伸びる） |
| `mirrorKnight.panes` | 第 3 段階の始まりに立てる姿見の数 |
| `mirrorKnight.paneOffset` | 姿見を部屋の中央から左右へ置く距離（px） |
| `mirrorKnight.imageReform` | 姿見が残っているとき、倒された写し身が戻るまでの秒 |
| `mirrorKnight.paneDown` | 姿見を割ったときの騎士のダウンの秒（鏡割れ） |
| `mirrorKnight.color` | （未記入） |
| `thiefKing.keepAway` | （未記入） |
| `thiefKing.fleeSpeedMul` | （未記入） |
| `thiefKing.stuckRatio` | （未記入） |
| `thiefKing.cornerRadius` | （未記入） |
| `thiefKing.cornerTime` | （未記入） |
| `thiefKing.cornerStagger` | （未記入） |
| `thiefKing.cornerCooldown` | （未記入） |
| `thiefKing.knifeCount` | （未記入） |
| `thiefKing.rageKnifeCount` | （未記入） |
| `thiefKing.knifeSpreadDeg` | （未記入） |
| `thiefKing.knifeSpeed` | （未記入） |
| `thiefKing.knifeDamage` | （未記入） |
| `thiefKing.knifeRange` | （未記入） |
| `thiefKing.mineCount` | （未記入） |
| `thiefKing.mineCountLate` | （未記入） |
| `thiefKing.mineSpread` | （未記入） |
| `thiefKing.mineFall` | （未記入） |
| `thiefKing.mineMax` | （未記入） |
| `thiefKing.smokeFall` | （未記入） |
| `thiefKing.smokeRadius` | （未記入） |
| `thiefKing.smokeDamage` | （未記入） |
| `thiefKing.smokeTime` | （未記入） |
| `thiefKing.dashSpeedMul` | （未記入） |
| `thiefKing.dashTime` | （未記入） |
| `thiefKing.wallStagger` | （未記入） |
| `thiefKing.minions` | （未記入） |
| `thiefKing.minionSpread` | （未記入） |
| `thiefKing.phase2Ratio` | （未記入） |
| `thiefKing.phase3Ratio` | （未記入） |
| `thiefKing.cornersToRage` | 第 2 段階の間に追い詰めでダウンさせるとこの回数で生命に関わらず第 3 段階（開き直り）へ |
| `thiefKing.fenceLen` | 第 2 段階の始まりに立てる柵の L 字の 1 辺のタイル数（角を共有する） |
| `thiefKing.fenceHp` | 柵 1 マスの耐久（爆発・弾・叩きつけで削れる） |
| `thiefKing.fenceTime` | 柵の寿命（秒。開き直りですべて崩れる） |
| `thiefKing.retreatMul` | 第 1・2 段階の硬直の間にプレイヤーから離れる速さ（def.speed の倍。一撃離脱） |
| `thiefKing.dashChain` | 第 3 段階の突進が壁に当たらなかったときに続けて突進する回数 |
| `thiefKing.rageKnifeChain` | 第 3 段階の短剣（怒りの扇）を続けて投げる回数 |
| `thiefKing.color` | （未記入） |
| `rules.nearDist` | プレイヤーとの距離がこれ未満なら「近い」（px） |
| `rules.farDist` | プレイヤーとの距離がこれを超えると「遠い」（px） |
| `rules.stillSpeed` | 1 ステップの移動がこの速さ × dt 未満なら静止とみなす（px/s） |
| `rules.stillSec` | 静止がこの秒以上続くと、技の枝が「止まっている相手」を選ぶ |
| `rules.dashMemory` | ダッシュを見てからこの秒の間は「直前にダッシュした」と覚える |
| `rules.chainWindupMul` | 連撃の続きの予備動作の長さの倍（最初からコミット） |
| `rules.minionPoiseRatio` | ボス部屋の取り巻きを 1 体倒すとボスに入る怯み値（ボスの耐性に対する割合） |
| `rules.rewards.flasks` | スライム王: 落とす瓶の数 |
| `rules.rewards.purseBase` | 盗賊王: 銭の基本量 |
| `rules.rewards.pursePerDepth` | 盗賊王: 深度 1 ごとに足す銭 |
| `rules.rewards.keys` | 盗賊王: 鍵の数 |
| `rules.rewards.runes` | 油壺の王: 落とす刻印符の数 |
| `rules.rewards.stoneRerolls` | 鏡の騎士: 持っていないスキルの石が出るまで引き直す上限 |
| `rules.rewards.namedBoost` | 最深の主: 名のある遺物を引くときの揺らぎの増幅 |
| `rules.rewards.namedAttempts` | 最深の主: 名のある遺物が出るまで引き直す上限 |
| `deepLord.pillarInset` | 第 1 段階（四門）: 門柱を部屋の四隅から何タイル内側に立てるか |
| `deepLord.pillarDown` | 門柱を 1 本折るごとに本体がダウンする秒（門崩れ） |
| `deepLord.pillarGuardDist` | プレイヤーが門柱からこの距離（px）以内なら落石を選ぶ（門柱を守る） |
| `deepLord.rainCount` | 落石の数（1 つはプレイヤーの足元、残りは周りに等間隔） |
| `deepLord.rainRadius` | 落石 1 つの炸裂の半径（px）。敵にも当たる |
| `deepLord.rainSpread` | 足元以外の落石をプレイヤーから何 px 離すか |
| `deepLord.rainFall` | 落石の影が出てから落ちるまでの秒（予備動作） |
| `deepLord.rainDamage` | 落石 1 つのダメージ（深度で伸びる） |
| `deepLord.beamCount` | 光線の本数（プレイヤーへ向けた扇） |
| `deepLord.beamSpreadDeg` | 光線の扇の全角（度） |
| `deepLord.beamLength` | 光線の最長（px。壁で止まる） |
| `deepLord.beamTime` | 光線の照射の秒 |
| `deepLord.beamDamage` | 光線のダメージ（深度で伸びる） |
| `deepLord.collapseEvery` | 第 2 段階（陥没）: 外周の床が崩れる間隔（秒）。1 回目は段階の始まり |
| `deepLord.collapseWarn` | 崩れる床の影が出てから溶岩になるまでの秒 |
| `deepLord.collapseSteps` | 崩れる回数の上限 |
| `deepLord.collapseMinInner` | 崩れた後に残す内側の最小の幅・高さ（タイル）。これを割る回は崩さない |
| `deepLord.collapseFade` | 最深の主が倒れた後、陥没の溶岩が消えるまでの秒 |
| `deepLord.ringTiles` | 1 回に崩れる外周の幅（タイル） |
| `deepLord.slashCount` | 近い相手への連撃の段数（2 段目からコミット） |
| `deepLord.slashRange` | 連撃の扇の届く距離（px） |
| `deepLord.slashHalfDeg` | 連撃の扇の半角（度） |
| `deepLord.slashDamage` | 連撃 1 段のダメージ（深度で伸びる） |
| `deepLord.slashRecoverMul` | 連撃の後の硬直の倍（def.recover に掛ける） |
| `deepLord.lungeSpeedMul` | 踏み込み（突進）の速さの倍（def.speed に掛ける） |
| `deepLord.lungeTime` | 踏み込みの秒 |
| `deepLord.wallStagger` | 踏み込みが壁か陥没の縁に当たったときのダウンの秒 |
| `deepLord.retreatMul` | 連撃の後の硬直の間に離れる速さ（def.speed に掛ける） |
| `deepLord.phase3Ratio` | 第三の顔へ進む生命の割合 |
| `deepLord.handCount` | 第三の顔: 奈落の手の数 |
| `deepLord.handGap` | 奈落の手を落とす間隔（秒） |
| `deepLord.handFall` | 奈落の手の影が出てから落ちるまでの秒 |
| `deepLord.handRadius` | 奈落の手の炸裂の半径（px） |
| `deepLord.handDamage` | 奈落の手のダメージ（深度で伸びる） |
| `deepLord.borrowRecoil` | 借りた技の後のダウンの秒（反動） |
| `deepLord.color` | （未記入） |

## enemies/FLOOR_LORD

毎階の最後の部屋に出る「階の主」（system/floorLord.ts）。

| 項目 | 意味 |
| --- | --- |
| `lairChance` | 部屋主（lairMaster）を階の主にする確率。外れると通常敵を格上げする。割合(0..1) |
| `hpMulLair` | 部屋主を階の主にしたときの HP 倍率 |
| `hpMulChampion` | 通常敵を格上げしたときの HP 倍率 |
| `poiseMul` | 階の主の怯み耐性の倍率（元の耐性に掛ける） |
| `escortRatio` | 部屋封鎖時に呼ぶ取り巻きの数。enemyCount() に掛ける割合 |
| `drops` | 撃破時の確定ドロップ数（rare 以上を狙う） |
| `rareDropBoost` | 確定ドロップの rarityBoost |
| `rareDropAttempts` | rare 以上が出るまで引き直す上限回数 |
| `heartChance` | 撃破時にハートを落とす確率。割合(0..1) |
| `roomMinW` | 最後の部屋の最小の幅（タイル） |
| `roomMinH` | 最後の部屋の最小の高さ（タイル） |
| `arenaRadius` | 洞窟の最後の塊を広げる半径（タイル） |
| `captainMaxDepth` | この深度以下で通常敵を格上げした主は「〜の隊長」（号令のを添えた精鋭 2 つ。hpMulChampion の代わりに captainHpMul） |
| `captainHpMul` | 隊長の HP 倍率 |

## enemies/JIN

陣（敵の一団が陣形を組んで塊の上に乗る戦いの単位）の配り方。

| 項目 | 意味 |
| --- | --- |
| `roomAreaExp` | 陣の大きさを塊の広さで寄せる強さ。塊の予算の平均 = 平均の予算 × 床タイル数 ^ これ ÷ 候補の塊の平均（候補を均すと平均の予算）。0 ですべて同じ、1 で広さに比例 |
| `minRoomBudget` | 1 つの塊の陣の予算の下限（並の敵の体数）。小さい塊・浅い階でも一団は置く |
| `minRoomTiles` | 陣を置ける塊の最小の床タイル数（矩形の部屋は幅 × 高さ） |
| `budgetBase` | 陣の予算（並の敵の体数に換算した重さ）の基本 |
| `budgetPerDepth` | 深度 1 つごとに増える陣の予算 |
| `budgetSpread` | 予算のばらつき。三角分布で ±この割合（0.35 で ±35%） |
| `hpSpread` | 陣ごとの生命の揺らぎ。陣を作るとき 1 回引いた倍率（三角分布 low〜high、頂は 1）をメンバー全員の生命に掛ける（後詰・階の主の取り巻きも同じ陣の倍率。陣に属さない敵は等倍）。読める範囲に収めるため ±10% 程度（core/scale.ts の rollSpread） |
| `densityNearStart` | 開始に近い塊の予算の倍率。塊の並び（開始からの歩数順）で densityNearEnd へ線形に変わる |
| `densityNearEnd` | 開始から遠い塊（階段側）の予算の倍率 |
| `strongMinDepth` | 格「猛」（強）が出る最小の深度。足りない深度では人数を保って並に落とす |
| `gradeWeight` | 格ごとの予算の重さ（並の敵何体ぶんか）。leader は大将（3b） |
| `strong.hpMul` | 猛（強）の生命の倍率 |
| `strong.poiseMul` | 猛（強）の怯み耐性の倍率 |
| `strong.damageMul` | 猛（強）の接触ダメージの倍率（system/enemies.ts の contactDamageOf） |
| `column.base` | 長蛇（通路を歩く列）の本数の基本。本数 = 切り捨て（base + 深度 × perDepth）、最大 max |
| `column.perDepth` | 深度 1 つごとに増える長蛇の本数 |
| `column.max` | 長蛇の本数の上限 |
| `column.members` | 長蛇 1 本の人数（予算として陣形 column に渡す） |
| `column.minDistFromJin` | 長蛇を置く通路の点を、陣の中心・開始の塊の中心・他の長蛇からこの距離以上離す。px |
| `morale.routRatio` | 群勢（陣の士気。メンバーの格の重さの合計で満ちる）がこの割合以下になると生き残りが敗走する（system/jin.ts）。上げると早く崩れる |
| `morale.leaderBreakRatio` | 大将を倒すと群勢をこの割合まで落とす（routRatio より小さいので大将撃破は必ず敗走になる） |
| `morale.executeBonus` | 処刑で倒したときに群勢から余分に引く量 |
| `morale.multiKillBonus` | 同じ tick に同じ陣の 2 体目以降を倒すと、1 体ごとに余分に引く量（一網打尽） |
| `morale.highRatio` | 群勢がこの割合以上の交戦中の陣は強まる（集まっている間の強化） |
| `morale.highAttackIntervalMul` | 強まっている間の攻撃間隔の倍率（system/enemies.ts の toChase） |
| `morale.highPoiseTakenMul` | 強まっている間の受ける怯み値の倍率（system/poise.ts の addPoise） |
| `morale.mergeCapRatio` | 敗走した敵が合流した陣の群勢の上限（moraleMax に掛ける） |
| `morale.fleeChance` | 群勢が崩れたとき、生き残りが 1 体ずつ逃げ出す確率（格ごと。逃げなかった者は背水で踏みとどまる）(0..1) |
| `morale.leaderFleeBonus` | 大将を倒して崩れたときに逃げ出す確率へ足す量(0..1) |
| `morale.holdAttackIntervalMul` | 背水（群勢が崩れても踏みとどまった敵）の攻撃間隔の倍率（system/enemies.ts の toChase。小さいほど攻めが速い） |
| `morale.holdColor` | 「背水」の浮き文字の色 |
| `rout.speedMul` | 敗走中の足の速さの倍率（敵の速さに掛ける）。1.25 → 1.1（2026-10-02: 置き土産の泥と窮鼠の反撃があるので、追いつけないほど速くはしない） |
| `rout.maxTime` | 敗走の時計。秒。これが尽きても合流できなければ行き先を捨ててプレイヤーの反対へ逃げ、プレイヤーから十分離れていれば消える（逃げ切り。報酬なし） |
| `rout.retargetSec` | 敗走中に行き先の陣が生きているか見直す間隔。秒 |
| `rout.mergeDist` | 行き先の陣の先頭のメンバーにこの距離まで近づいたら合流する。px |
| `rout.dropMul` | 敗走中の敵を倒したときの装備ドロップ確率の倍率（system/loot.ts） |
| `rout.turnRadius` | 窮鼠: 逃げる敵の体の縁からこの距離（px）までプレイヤーが詰めると、振り向いて自分の攻撃を 1 回返す（予告は普段どおり） |
| `rout.turnFirstDelay` | 窮鼠: 逃げ出してから最初に振り向けるまでの秒（崩れた瞬間に隣で振り向かない） |
| `rout.turnCooldown` | 窮鼠: 振り向いてから次に振り向けるまでの秒（反撃を終えて逃げに戻ってから数える） |
| `rout.mudInterval` | 置き土産: 逃げながら足元に泥を撒く間隔（秒）。泥はプレイヤーも敵も足を取られる（TERRAIN_MUD_SMOKE.mud） |
| `rout.mudRadius` | 置き土産の泥の半径（px） |
| `rout.mudSec` | 置き土産の泥が残る秒 |
| `rout.alarmColor` | 「急報」（逃げた敵が眠っている陣に合流して起こした）の浮き文字の色 |
| `rout.color` | 「敗走」の浮き文字の色 |
| `rout.leaderColor` | 「大将撃破」の浮き文字の色 |
| `wake.noticeRange` | 眠っている敵が自分で気付く距離（視線が通る間）。px。110 → 70（2026-10-02: 気付かない所で敵対して部屋の端まで寄ってきていた。部屋の中へ踏み込ませる） |
| `wake.radius` | 陣が起きるとき、気付いた者（いなければプレイヤー）からこの距離以内のメンバーだけ起こす。起きた者の近くの仲間も毎ステップこの距離で順に起きる（固まりごとに反応する）。px。封鎖した部屋の陣は全員起こす。160 → 80（2026-10-02） |
| `wake.reserveMoraleRatio` | 後詰の合図: 交戦中の陣の群勢がこの割合以下になると、まだ眠っている残りが secondWaveDelay 秒後に後詰として動き出す（前線が崩れかけたら奥が出てくる。時間では出ない）(0..1) |
| `wake.secondWaveDelay` | 後詰の合図（reserveMoraleRatio）から残りのメンバーが動き出すまでの秒 |
| `wake.color` | 「後詰」の浮き文字の色 |
| `stir.delay` | 階に着いてからこの秒を過ぎると、増援の代わりに眠っている陣を長蛇に変えてプレイヤーの方へ歩かせ始める（湧かせないので総数は増えない） |
| `stir.interval` | stir.delay の後、この秒ごとにプレイヤーに最も近い眠っている陣を 1 つ歩かせる |
| `roamHeartChance` | 塊に乗らない陣（長蛇・物見）が決着したときにハートを落とす確率（部屋の制圧の報酬が無いぶんの小さな報酬） |
| `lookout.count` | 物見（見張りの射手 1 人）の数。2 つの陣の中心を結ぶ線の中点に近い通路タイルに置く。浅い深度は FORMATION.lookout.minDepth で出ない |
| `lookout.noticeMul` | 物見が気付く距離の倍率（敵の気付く距離に掛ける）。気付くと最も近い眠っている陣を起こす |
| `lookout.snapDist` | 物見を置く通路タイルが、2 つの陣の中点からこの距離以内であること。px。遠ければその組は見送る |
| `lookout.minDistFromJin` | 物見を、陣の中心・開始の塊の中心・他の物見からこの距離以上離す。px |
| `noise.dash` | ダッシュの音が届く距離。px。この内側の眠っている敵（視線が通る間）が気付く。歩きは音を出さない（system/noise.ts）。2026-10-02 に 200 → 90、命中 200 → 110、爆発 200 → 140（音で部屋の奥まで起きていた） |
| `noise.hit` | 近接・射撃が敵に当たった音が届く距離（当たった敵の位置が中心）。px |
| `noise.explode` | 爆発（system/statusEffects.ts の explodeAt）の音が届く距離（爆心が中心）。px |
| `noise.maxPerStep` | 1 ステップに積む音の上限。多段ヒットや爆発の連鎖で配列が膨らまないようにする。超えた分は捨てる |
| `hud.color` | 群勢のバーの色（render/jinUi.ts。画面上部の陣の名札） |
| `hud.bgColor` | 群勢のバーの地の色 |
| `hud.leaderColor` | 大将の頭上の印（三角）と名札の大将名の色 |
| `hud.strongColor` | 猛（強）の頭上の名前の色（精鋭は修飾子の色） |
| `hud.range` | 塊に乗らない陣（長蛇・物見）の群勢を名札に出す、プレイヤーからの最大距離。px |

## enemies/FORMATION

陣形（八陣）の人数・格・解禁深度・重み・間隔（data/formations.ts が読み込み時に role / grade / layout の文字列を検査する。

| 項目 | 意味 |
| --- | --- |
| `*.layout` | 並べ方（map/formation.ts の FormationLayout） |
| `*.minDepth` | この陣形が抽選に出る最小の深度 |
| `*.weight` | 部屋に置く陣形の抽選の重み。0 で抽選に出ない（長蛇・物見のように別の経路で置く） |
| `*.spacing` | 隣り合うメンバーの間隔。px |
| `*.jinzu` | 本陣になったときの陣図（省略した陣形は本陣にならない。system/jinzu.ts。docs/ideas/jinzu-impl.md） |
| `*.jinzu.leaderSeat` | 本陣の大将にするメンバーの座。rear 陣の最も後ろ / front 最も前 / center 中心に最も近い。座に最も近い格上げできるメンバー 1 人が大将になる（新しく湧かせない） |
| `*.jinzu.strokeSec` | 1 画の下絵の秒（省略は JINZU.strokeSec） |
| `*.jinzu.strokes[]` | 筆順（最大 JINZU.maxStrokes 画）。隊が空の画は飛ばす |
| `*.jinzu.strokes[].squad` | 画の隊の選び方（data/formations.ts の JinzuSquadKey。大将から的への向きで左右・前後・内外を決める） |
| `*.jinzu.strokes[].path` | 画の形。hook 的の脇を回って背後で閉じる鉤 / flank 的の脇を真っすぐ抜ける / thrust 的を貫く突き / volley 射手の射線（走らず撃つ） |
| `*.jinzu.strokes[].pass` | 的の脇を通る間合い。px。左の隊は左へ・右の隊は右へ（隊の名に左右が無ければ符号つきでそのまま） |
| `*.jinzu.strokes[].beyond` | 的を越えて走る長さ。px |
| `*.slots[]` | スロットの並び（正面から置く順）。同じ役割のスロットは 1 つの陣の中で同じ敵の種類になる |
| `*.*.role` | スロットの役割（data/enemyRoles.ts の EnemyRole） |
| `*.*.grade` | スロットの格（normal 並 / strong 猛 / elite 精鋭） |
| `*.slots[].share` | 予算のうちこのスロットに回す割合（0..1） |
| `*.slots[].min` | このスロットの最少人数（役割に合う敵がいれば予算に依らずこの人数は置く） |
| `*.slots[].max` | このスロットの最多人数（省略で上限なし） |
| `*.leader` | 大将のスロット（無ければ大将のいない陣）。正面の先頭に立ち、必ず精鋭の修飾子を持つ。予算のうち JIN.gradeWeight.leader ぶんを大将が使う |
| `*.leader.lairChance` | 大将を部屋主（lairMaster）にする確率。割合(0..1)。外れる・候補がいない深度では leader.role・leader.grade の敵を大将にする |
| `*.cooldownStagger` | 列の後ろほど最初の攻撃間隔を遅らせる秒（鋒矢。先頭から 1 人ごとにこの秒ずつ足し、全員の基準は攻撃間隔そのもの。省略で遅らせない） |
| `*.rotate` | 列の入れ替え（衡軛）。前列の前衛が隙を終えると、後ろにいる前衛が前へ出て入れ替わる。省略で入れ替えない |
| `*.rotate.restMul` | 入れ替わって下がる側の次の攻撃までの間（攻撃間隔に掛ける倍率） |
| `*.rotate.stepInCooldown` | 前へ出る側の次の攻撃までの間の上限。秒（これ以下に縮める） |

## enemies/REAPER

追跡者(Reaper)。

| 項目 | 意味 |
| --- | --- |
| `appearAfter` | （未記入） |
| `appearPerRoom` | （未記入） |
| `warnMargin` | （未記入） |
| `speed` | （未記入） |
| `radius` | （未記入） |
| `damage` | （未記入） |
| `spawnDist` | （未記入） |
| `color` | （未記入） |
| `variants.chain.minDepth` | （未記入） |
| `variants.chain.speedMul` | （未記入） |
| `variants.chain.interval` | （未記入） |
| `variants.chain.charge` | （未記入） |
| `variants.chain.length` | （未記入） |
| `variants.chain.width` | （未記入） |
| `variants.chain.pull` | （未記入） |
| `variants.chain.damage` | （未記入） |
| `variants.chain.color` | （未記入） |
| `variants.collector.speedMul` | （未記入） |
| `variants.collector.offerRadius` | （未記入） |
| `variants.collector.offerTime` | （未記入） |
| `variants.collector.tollRatio` | （未記入） |
| `variants.collector.color` | （未記入） |
| `variants.twin.minDepth` | （未記入） |
| `variants.twin.speedMul` | （未記入） |
| `variants.twin.spread` | （未記入） |
| `variants.shadow.shades` | （未記入） |
| `variants.shadow.respawn` | （未記入） |
| `variants.shadow.ring` | （未記入） |
| `variants.silent.moveThreshold` | （未記入） |

## enemies/NEMESIS

仇（前のランで力尽きた相手が次のランで眠った陣に 1 体混ざる。

| 項目 | 意味 |
| --- | --- |
| `minDepth` | 仇が出る最も浅い階 |
| `depthLead` | 倒された深度より何階手前から出すか（出る階 = max(minDepth, 倒された深度 − depthLead, 敵の minDepth)） |
| `hpMul` | 仇の生命の倍率（猛・精鋭の倍率の上に掛ける） |
| `maxedHpMul` | 記録の修飾子が既に 2 つ（頭打ち）の仇に更に掛ける生命の倍率 |
| `rewardItems` | 仇討ちで落とす遺物の数 |
| `rewardBoost` | 仇討ちの遺物のレア度の上乗せ（ROOM_KIND.challengeRareBoost と揃える） |
| `rewardKeys` | 仇討ちで落とす鍵の数 |
| `color` | 仇の気配のログ・仇討ちの浮き文字の色 |

## enemies/stats

| 項目 | 意味 |
| --- | --- |
| `*.radius` | 体の当たり判定の半径。px（10px = 1m）。プレイヤーは 5。目安: 小型 4〜6、大型 8〜10、ボス 12〜14 |
| `*.hp` | 生命。出現時に深度で伸びる（ENEMY_SCALE.hpPerDepth と深みの指数。src/data/enemies.ts の depthHpScale）。目安: 雑魚 14〜60、部屋主 160〜260、章ボス 1200〜2400 |
| `*.speed` | 追う・逃げるときの移動速度。px/秒。プレイヤーの歩きは 120。0 はその場から動かない（設置物）。目安 25〜95 |
| `*.contactDamage` | 攻撃中（strike）に体が触れたときのダメージ。深度 2 つごとに +2 される。0 は触れても痛くない（射撃型など）。目安 5〜30 |
| `*.windup` | 攻撃の予備動作（予告）の秒。長いほど避けやすい（テレグラフ原則）。深度 1 つごとに 1.5% 短くなり、最短でこの値の 0.75 倍（ENEMY_TEMPO）。目安 0.35〜0.9 |
| `*.strikeTime` | 攻撃そのものが続く秒（突進の長さ・光線の照射時間など）。目安 0.05〜1.5 |
| `*.recover` | 攻撃後の硬直の秒。この間が反撃の隙になる。目安 0.3〜1.0 |
| `*.engageRange` | プレイヤーがこの距離より近いと攻撃を始める。px。射撃型（浮遊眼・光線眼）はこの距離の半分〜この距離を保って動く。0 は攻撃しない、9999 は距離を問わない。目安 40〜250 |
| `*.attackInterval` | 攻撃を終えて追跡に戻ってから、次の攻撃を始められるまでの秒。出現直後だけ 0.5〜1.5 倍にばらつく。99 は実質攻撃しない。目安 0.2〜2.5 |
| `*.score` | 撃破で入る得点（コンボの倍率が掛かる）。目安: 雑魚 10〜60、部屋主 300〜、ボス 1000〜 |
| `*.minDepth` | 通常の抽選に出始める深度。99 は抽選に出さない（ボス・召喚物・設置物） |
| `*.weight` | 出現抽選の重み。同じ深度で出られる敵どうしの比で、そのバイオームの顔ぶれ（ファミリー）なら world.json の FLOOR_KIND.familyMul 倍。0 は抽選に出ない。目安 0.3〜10 |
| `*.dropChance` | 撃破時に装備を落とす基本の確率。割合（0..1）。深度 1 つごとに loot.json の LOOT_DROP.depthChanceBonus が足され、通常の敵は深度別の倍率で絞られる。1 は確定ドロップ（ボス・部屋主も確定） |
| `*.swarm.min` | 群れで湧く数の下限。抽選 1 回で min〜max（両端を含む）の数だけ出る |
| `*.swarm.max` | 群れで湧く数の上限 |
| `*.deathBomb.radius` | 倒れた場所に残す時限爆発の範囲の半径。px |
| `*.deathBomb.damage` | 時限爆発のダメージ。深度 2 つごとに +2 |
| `*.deathBomb.fuse` | 時限爆発が爆ぜるまでの秒（予告の長さ） |
| `*.timid.lifetime` | 攻撃せずに逃げ回り、見つかってからこの秒で消える（金色スライム） |
| `*.volley.count` | 射撃・爆弾を扇に並べる数。1 なら正面に 1 つ |
| `*.volley.spreadDeg` | 扇の全体の開き。度（端から端まで） |
| `*.volley.speedMul` | 弾速の倍率（基準 135 px/秒）。省略時 1 |
| `*.deathBurst.count` | 倒れたときに全周へ撒く弾の数 |
| `*.deathBurst.speed` | その弾の速さ。px/秒 |
| `*.deathBurst.damage` | その弾のダメージ。深度 2 つごとに +2 |
| `*.deathBurst.color` | その弾の色 |
| `*.deathMana` | 倒されたときにプレイヤーへ返す気力。省略すると返さない |
| `*.laserBeams.count` | 続けて撃つ光線の本数（中央 → 左 → 右の順） |
| `*.laserBeams.spreadDeg` | 2 本目以降を中央からずらす角度。度 |
| `*.laserBeams.followWindup` | 2 本目以降の予備動作の秒（深度で短くなる前の値） |
| `*.flank` | 追う途中で横へ回り込む強さ。0..1（狼 0.8）。プレイヤーとの距離が ENEMY_AI.flank.minDist より遠い間だけ効く |
| `*.volley.damageMul` | ダメージの倍率（弾の基準 8、爆弾は ENEMY_AI.bomber.damage）。省略時 1 |
| `*.volley.radius` | 弾の半径。px。省略時は ENEMY_AI.volley.bulletRadius |
| `*.explode.radius` | 自爆の範囲の半径。px（予備動作中に同じ大きさの影で予告する） |
| `*.explode.damage` | 自爆のダメージ。深度 2 つごとに +2。周りの敵にも当たる |
| `*.explode.color` | 自爆の爆発の色 |
| `*.aimTracking` | true なら攻撃の瞬間までプレイヤーを狙い続ける（狙いの正確さが個性の敵。砲台）。省略時は予備動作の残りが ENEMY_TEMPO.aimLockSec / aimLockRatio を切ったところで向きが固まる。予備動作の始まりで固定する behavior（レーザーなど）は影響を受けない |

## enemies/combat

| 項目 | 意味 |
| --- | --- |
| `*.poise` | 怯み耐性。攻撃の怯み値の蓄積がこれを超えると怯む（ボスはダウン）。深度で生命と同じ曲線（ENEMY_SCALE）に沿って伸びる。省略すると怯まない。目安: 低 5〜15、中 25〜50、高 60〜120、ボス 140〜320 |
| `*.staggerTime` | 怯みの秒（ボスはダウンの秒）。怯まない敵は 0。目安 0.3〜0.8、ボス 1.2〜2 |
| `*.superArmorMul` | 強靭。予備動作・攻撃中に受ける怯み値の倍率（1 = 等倍、低いほど攻撃中に怯みにくい）。目安 0.25〜1（1.5 は攻撃中ほど崩れやすい） |
| `*.strikeSuperArmorMul` | 攻撃中（strike）だけ強靭を上書きする倍率。省略すると superArmorMul と同じ。0 はその間怯み値が溜まらない（スライム王の空中） |

## enemies/defense

| 項目 | 意味 |
| --- | --- |
| `bodies.*.defense` | 物理の攻撃の軽減 %。負は柔らかい（-10 なら 1.1 倍のダメージ）。-50〜75 に収める（combat.json の GENRE.enemyDefenseMin / Max） |
| `bodies.*.warding` | 魔法の攻撃の軽減 %（魔防）。範囲は防御と同じ。混成の攻撃は防御と魔防を半々で混ぜて受ける |
| `biomes.*.fire` | 炎属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `biomes.*.ice` | 氷属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `biomes.*.poison` | 毒属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `biomes.*.lightning` | 雷属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `biomes.*.dark` | 闇属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `biomes.*.light` | 光属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `biomes.*` | 闇属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `biomes.*.none` | 無属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `enemies.*.body` | 体つきの型（bodies の key）。防御・魔防はこの型から決まる |
| `enemies.*.biome` | 土地の属性（biomes の key）。属性耐性の既定をここから写す。省略可 |
| `enemies.*.resist` | この敵だけの属性耐性の上書き（biome の値に重ねる）。書かない属性は biome の値か 0 |
| `enemies.*.*.light` | 光属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `enemies.*.*.dark` | 闇属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `enemies.*.*.lightning` | 雷属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `enemies.*.*.fire` | 炎属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `enemies.*.*.ice` | 氷属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `enemies.*.resist.poison` | 毒属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |
| `enemies.*.stages[]` | ボスの段階ごとの属性耐性の上書き。1 つ目が段階 1。表より先の段階は最後の表を使う |
| `enemies.*.resist.none` | 無属性の耐性 %。正で軽減、負で弱点（-50 なら 1.5 倍のダメージ）。-100〜75 に収める（combat.json の ELEMENT.enemyResistMin / Max） |

## enemies/ENEMY_SCALE

【段取り 7e】hpPerDepth 0.15 → 0.11: 地力の伸びは筋・技の逓減（ATTR.knee1 = 20）で頭打ちなので、敵の生命の伸びを寄せて地力 ÷ 敵の生命を 0.85（深度 5・10）〜0.74（深度 20）へ。

| 項目 | 意味 |
| --- | --- |
| `hpPerDepth` | 深度 1 つごとに敵の生命へ足す倍率（深度 1 で 1 倍）。怯み耐性も同じ。目安 0.12〜0.18 |
| `damagePerDepth` | 深度 1 つごとに敵の攻撃へ足す倍率（深度 1 で 1 倍。旧 flat 加算 depthDamageBonus の置き換え）。目安 0.04〜0.06 |
| `deepDepth` | ここから深み（指数の伸び）。最深の間の深度と同じにする（chapters.test.ts が縛る）。深みの敵数・変異は world/DEEP。目安 21 |
| `deepHpGrowth` | 深み 1 階ごとの生命・怯み耐性の倍率（深度 deepDepth の値 × これ^(深度 − deepDepth)）。目安 1.10〜1.15 |
| `deepDamageGrowth` | 深み 1 階ごとの敵の攻撃の倍率。目安 1.03〜1.05 |
| `damageMul` | 敵の攻撃の全体の倍率（深度の曲線に掛ける。全深度・ボスも同じ）。2026-10-02: 通常の部屋すべてに陣を置いて敵が約 2 倍になり被弾が増えたので 0.85（ユーザーの決定 −15%） |

## enemies/REACTION

敵の反応ルール(docs/ideas/jin-impl.md 2-3 / 2-4)。

| 項目 | 意味 |
| --- | --- |
| `hitWindowSec` | 間合い取りの被弾を数える窓。殴られるたびにこの秒へ戻り、尽きると被弾の数が 0 に戻る。秒 |
| `retreatHits` | 役割ごとの、窓の中でこの回数殴られたら一度離れる回数。0 は離れない。前衛 3 / 突撃 2 / 射手・妨害・支援 1 / 爆発・群れ 0 |
| `retreatDist` | 間合い取りで離れる距離。px |
| `retreatSec` | 間合い取りにかける秒。離れる速さは retreatDist ÷ retreatSec で、敵の速さに依らず一定 |
| `punishRoles` | プレイヤーの隙を狙う役割。攻撃間隔の時計が速く進む |
| `punishBias` | 隙を狙うときに攻撃間隔の時計が余分に進む割合。0.4 で 1.4 倍の速さ。隙 = 終撃の硬直・ダッシュの再使用中・受け流しの外し |
| `slotRoles` | 囲む役割。仲間が揃うと、プレイヤーの周りに等間隔の持ち場を取って近づく |
| `slotRadius` | 囲んで回り込む輪の半径の下限。px。実際の半径は max(この値, 敵の engageRange + slotMargin) で、攻撃距離のすぐ外をなぞる |
| `slotMargin` | 回り込む輪を攻撃距離（engageRange）の外に取る余裕。px |
| `slotLead` | 回り込みの 1 ステップで、目標を今の角度から持ち場の向きへ進める角度。ラジアン。大きいほど輪をなぞらず斜めに突っ切る |
| `slotAngleTol` | 持ち場の角度とのずれがこの値以下なら、回り込みをやめて真っ直ぐ殴りに行く。ラジアン |
| `slotMinPeers` | 囲むために要る、自分以外の同じ役割の交戦中（追跡・予備動作・攻撃・隙）の仲間の数 |
| `slotRange` | 陣に属さない敵が仲間として数える範囲。px |
| `shooterBackstepMul` | 射手が予備動作の間に後ろへ下がる速さ。歩く速さに対する倍率 |
| `retreatAfterStrike` | 攻撃の後の隙の間に離れる速さの倍率（敵の定義ごと。歩く速さに対する倍率）。behavior 既定（蝙蝠 ENEMY_AI.bat.retreatMul）より優先 |

## enemies/HONJIN

本陣（階に数個だけ立つ山。

| 項目 | 意味 |
| --- | --- |
| `countByChapter` | 章ごとの 1 階あたりの本陣の数（章 1 から。最後の章より深い階は最後の値）。休符の階とボス階は 0。上限は max |
| `countByDepth` | 深度ごとの本陣の数（文字列の深度 → 数）。countByChapter より優先する。章 1 は深度 4 だけ 1（他の深度は 0） |
| `max` | 1 階の本陣の上限 |
| `formationsByChapter[]` | 章ごとに本陣になれる陣形の key（章 1 から。最後の章より深い階は最後の値）。FORMATION の minDepth は上書きしない |
| `minSpacing` | 本陣どうしの中心の最小距離。px |
| `minRoomOrder` | 塊の並び（index ÷ (塊の数 − 1)）がこれ以上の塊の陣だけが本陣になれる（開始の近くに山を置かない）。割合(0..1) |
| `leaderExclude` | 大将に格上げしない精鋭の修飾子（障壁の・堅牢の・見切りのは筆が止められなくなる、号令のは陣図と働きが重なる） |
| `keyChance` | 本陣の決着で鍵を落とす確率（ECONOMY.key.leaderJinChance の代わり）。割合(0..1) |
| `trial` | 開発の試し陣 |
| `trial.depth` | 0 以外ならその深度で、最初の戦いの塊のすぐ奥の陣を鶴翼にして本陣にする（人の読みの確認と jinzuProbe 用。本番は 0） |

## enemies/JINZU

陣図（本陣の大将が床に 1 画ずつ書く突撃の道筋）の時計と規則・旗倒れ。

| 項目 | 意味 |
| --- | --- |
| `raiseSec` | 掲げの秒。大将が軍配を掲げ、的を決める |
| `strokeSec` | 1 画の下絵の秒（陣形 JSON の jinzu.strokeSec で上書き可）。この間は下絵で、大将を怯ませれば消える |
| `maxStrokes` | 1 枚の陣図の画の上限 |
| `minStrokes` | 掲げるのに要る画の数（隊のいる画がこれ未満なら書かない） |
| `squadMin` | 走る画の隊の最小の人数（射線の画は射手 1 人から） |
| `squadMax` | 1 画の隊の最大の人数 |
| `holdSec` | 構えの秒。墨の入った画が太くなり、隊の頭上に印が出る。大将の状態に関わらず進む |
| `firstDelay` | 起きてから最初に掲げられるまでの秒（後詰が揃ってから書く） |
| `triggerRange` | 掲げる距離。大将とプレイヤーの間。px |
| `minMoraleRatio` | 掲げに要る群勢の割合(0..1)。削って下げた本陣は書けない |
| `maxSurges` | 1 つの本陣が総掛かりを掲げる回数の上限 |
| `surgeCooldown` | 前の立て直しが終わってから次に掲げられるまでの秒 |
| `regroupSec` | 立て直しの秒。大将が軍配を下ろし、兵は通常に戻る |
| `brushPoiseTakenMul` | 掲げ・筆の間の大将が受ける怯み値の倍率(1 = 等倍)。この間は集まっている間の強化（群勢が高いと怯みにくい）も掛からない |
| `breakMoraleLoss` | 筆折れ（書き終える前に大将が怯んだ・恐怖した）で減る群勢。最大に対する割合(0..1) |
| `missMoraleLoss` | 走った隊が誰にも当たらずに走り終えたとき、隊ごとに減る群勢。最大に対する割合(0..1) |
| `runSpeedMul` | 走る速さ（敵の速さに対する倍率）。プレイヤーの歩きは 120 px/s・ダッシュは 400 px/s |
| `runSpeedMin` | 走る速さの下限。px/s |
| `runSpeedMax` | 走る速さの上限。px/s |
| `runnerGapSec` | 隊の 2 人目以降が遅れて走り出す秒（先頭が誰か読めるように） |
| `runMaxSec` | 走りの打ち切り。秒（詰まり・壁・長すぎる道） |
| `stuckSec` | 壁や仲間で止まっている時間がこれを超えたら走りを終える。秒 |
| `runDamageMul` | 走る兵の当たりのダメージの倍率(1 = 接触ダメージのまま) |
| `surgeHoldOthers` | 構え・総掛かりの間、他の敵が新しい予備動作に入るのを遅らせる秒（既に予備動作の敵はそのまま出す） |
| `safeGapMin` | 鶴翼で 5 画目（射線）より前の画が空ける、大将と的を結ぶ帯の幅。px（テストが縛る） |
| `bandHalf` | 画の帯の半幅。隊の体とプレイヤーの体を足した当たりの目安。px。安全地帯の判定が使う |
| `volleySpeed` | 射線の弾の速さ。px/s |
| `volleyDamage` | 射線の弾 1 発のダメージの基礎（深度で伸びる） |
| `volleyRadius` | 射線の弾の半径。px |
| `volleyColor` | 射線の弾の色 |
| `flagFall` | 旗倒れ（本陣の大将の撃破）の連鎖 |
| `flagFall.radius` | 旗倒れが効く距離。大将の倒れた位置から、交戦中の素の陣の中心まで。px |
| `flagFall.moraleLoss` | 旗倒れで近くの交戦中の素の陣の群勢が落ちる量。最大に対する割合(0..1)。敗走の線を切った陣はその場で背を向ける |
| `draw` | 描画（render/jinzuUi.ts。見た目だけ） |
| `draw.holdWidthMul` | 構えの間、墨の画を太くする倍率 |
| `draw.breakFadeSec` | 筆折れで下絵が擦れて消えるまでの秒 |
| `draw.targetRadius` | 的（墨の点）の半径。px |
| `draw.tipSize` | 筆先の点の大きさ。px |
| `draw.fadeSec` | 走り終えた画が掠れて消えるまでの秒 |
| `draw.flagFallSec` | 馬印が倒れる秒 |
| `draw.rippleSec` | 旗倒れの墨の波紋が広がる秒 |
| `draw.rippleRadius` | 旗倒れの墨の波紋の最大の半径。px |
| `draw.flagColor` | 本陣の馬印・ミニマップの印の色 |

## jobs/JOB

| 項目 | 意味 |
| --- | --- |
| `manaBaseMul` | 流儀の気力の下地: 見習い以外のジョブが通常攻撃の命中で得る気力の倍率（見習いは 1）。流儀の源（MANA_SOURCE）が主で、これは枯渇で遊べなくならないための保険。目安 0.25〜0.5 |
| `starterWeaponLevel` | 開始時に渡す初期武器（素の器）のアイテムレベル |
| `swordsmanFinisherPoise` | 剣士: 終撃が当たったときに上乗せする怯み値 |
| `swordsmanJustBuffPct` | 剣士: 見切りを決めた後のダメージ増。%（表示単位。25 なら +25%） |
| `swordsmanJustBuffSec` | 剣士: 見切りの後のダメージ増が続く秒 |
| `hunterWindupPoise` | 狩人: 予備動作中の敵を射撃・遠距離スキルで撃ったときに上乗せする怯み値 |
| `hunterVulnerableSec` | 狩人: 精鋭を射撃・遠距離スキルで撃ったときに付ける脆弱の秒 |
| `hunterEliteIcd` | 狩人: 精鋭を脆弱にする規則がもう一度発動できるまでの秒（内部の再使用時間） |
| `brawlerEveryHits` | 拳闘士: 近接をこの回数当てるごとに周りへ衝撃波 |
| `brawlerShockwaveRatio` | 拳闘士: 衝撃波の威力。近接 1 段目の威力に掛ける倍率 |
| `brawlerHurtBuffPct` | 拳闘士: 被弾した後のダメージ増。%（表示単位） |
| `brawlerHurtBuffSec` | 拳闘士: 被弾の後のダメージ増が続く秒 |
| `shieldHurtInvulnSec` | 盾持ち: 被弾した直後の無敵の秒 |
| `shieldHurtIcd` | 盾持ち: 被弾後の無敵がもう一度発動できるまでの秒（内部の再使用時間） |
| `shieldCounterRatio` | 盾持ち: カウンターで出す衝撃波の威力。近接 1 段目の威力に掛ける倍率 |
| `hexerStatusMana` | 呪術師: 敵に状態異常を付けるたびに戻る気力 |
| `hexerStatusIcd` | 呪術師: 気力が戻る規則がもう一度発動できるまでの秒（内部の再使用時間）。多段の付与で一気に戻りすぎないための間隔 |
| `hexerSpreadRadius` | 呪術師: 毒の付いた敵を倒したときに毒が広がる半径。px（10px = 1m） |
| `hexerSpreadSec` | 呪術師: 広がった毒の持続の秒 |
| `lancerGuardPoise` | 槍兵: 堅守中の敵に近接を当てたときに上乗せする怯み値 |
| `lancerStaggerEnergy` | 槍兵: 敵を怯ませるたびに溜まる必殺ゲージ（最大 100） |
| `invokerCastBuffPct` | 術士: スキルを使った後のダメージ増。%（表示単位） |
| `invokerCastBuffSec` | 術士: スキルの後のダメージ増が続く秒 |
| `invokerLowManaKill` | 術士: 気力が少ないときに敵を倒すと戻る気力 |
| `shadowAfterDashSec` | 影: ダッシュを終えてからこの秒以内の近接が脆弱を付ける |
| `shadowVulnerableSec` | 影: ダッシュ直後の近接で付ける脆弱の秒 |
| `shadowVulnerableIcd` | 影: 脆弱を付ける規則がもう一度発動できるまでの秒（内部の再使用時間） |
| `shadowJustSpeedPct` | 影: 見切りを決めた後の移動速度増。%（表示単位） |
| `shadowJustSpeedSec` | 影: 見切りの後の移動速度増が続く秒 |
| `alchemistReactionEnergy` | 錬金術師: 状態異常の反応を起こすたびに溜まる必殺ゲージ（最大 100） |
| `alchemistBlastRatio` | 錬金術師: 状態異常が 2 種以上付いた敵を倒したときの爆発の威力。近接 1 段目の威力に掛ける倍率 |
| `alchemistBlastIcd` | 錬金術師: 爆発の規則がもう一度発動できるまでの秒（内部の再使用時間） |
| `onmyojiWeakenSec` | 陰陽師: スキルが敵に当たったときに付ける弱体の秒 |
| `onmyojiKillEnergy` | 陰陽師: 弱体の敵を倒したときに溜まる必殺ゲージ（最大 100） |
| `mikoHurtIcd` | 巫女: 被弾で状態異常を祓う規則がもう一度発動できるまでの秒（内部の再使用時間） |
| `mikoClearHealRatio` | 巫女: 部屋を制圧したときの回復。最大生命に対する割合（0.1 で 10%） |

## jobs/attributes

| 項目 | 意味 |
| --- | --- |
| `*.str` | 筋力の偏り。基礎値（各 5）に足す点数。ジョブごとに全ステータスの合計を 0 にする（jobs.test.ts が検査）。書かないステータスは 0 |
| `*.vit` | 体力の偏り。基礎値（各 5）に足す点数。ジョブごとに全ステータスの合計を 0 にする（jobs.test.ts が検査）。書かないステータスは 0 |
| `*.mnd` | 精神の偏り。基礎値（各 5）に足す点数。ジョブごとに全ステータスの合計を 0 にする（jobs.test.ts が検査）。書かないステータスは 0 |
| `*.spi` | 霊力の偏り。基礎値（各 5）に足す点数。ジョブごとに全ステータスの合計を 0 にする（jobs.test.ts が検査）。書かないステータスは 0 |
| `*.dex` | 技巧の偏り。基礎値（各 5）に足す点数。ジョブごとに全ステータスの合計を 0 にする（jobs.test.ts が検査）。書かないステータスは 0 |

## jobs/DASH_FORM

| 項目 | 意味 |
| --- | --- |
| `*.distanceMul` | ダッシュの距離の倍率（1 = PLAYER.dash の既定の距離）。速さは距離 ÷ 秒で決まる |
| `*.timeMul` | ダッシュの秒の倍率（1 = 既定）。距離をそのままに秒だけ伸ばすと遅く長い移動になる |
| `*.invulnMul` | ダッシュの無敵の秒（PLAYER.dash.invulnTime + 性質の上乗せ）の倍率。0 は無敵なし。ダッシュの秒を超えない |
| `*.invulnAdd` | ダッシュの無敵に足す秒（ダッシュ中の被弾が見切りになる窓が広がる）。ダッシュの秒を超えない |
| `*.keepChainSec` | 詰め足: ダッシュを終えてからこの秒の間に左を押すと、取り消した振りの次の段が出る |
| `*.trapDamageMul` | 退き足: 足元に置く設置弾の威力の倍率（置き撃ち筒の弾の威力に掛ける） |
| `*.guardSec` | 不退: その場で構える秒。構えの間は無敵で動けず、構えの中の被弾は見切りになる |
| `*.statusSec` | 霧隠れ: すり抜けた敵に付ける弱体の秒 |
| `*.touchRadius` | 霧隠れ: すり抜けを数える距離（体の縁どうし）。px（10px = 1m） |
| `*.backstabSec` | 影潜り: 潜り終えてからこの秒の間の攻撃は背面から当たる（堅守を無視し、影の気力が湧く） |
| `*.terrainRadius` | 瓶投げ: 元いた所に撒く油の半径。px（10px = 1m） |
| `*.terrainSec` | 瓶投げ: 撒いた油が残る秒 |
| `*.range` | 入れ替わり: 入れ替われる設置物・連動体までの距離の上限。px（10px = 1m）。この外か、無いときは駆け（距離・秒・無敵の倍率は駆けと同じ行） |
| `*.swapInvulnSec` | 入れ替わり: 入れ替わった直後の無敵の秒（駆けの無敵とは別。ダッシュ中ではないので見切りにはならない） |
| `*.wardSec` | 護り足: ダッシュを終えてからの結界が残る秒 |
| `*.incomingMul` | 護り足: 結界の中の被ダメージの倍率（全方位。0.5 で半分） |

## jobs/MANA_SOURCE

| 項目 | 意味 |
| --- | --- |
| `swordsman.riposte` | 応手（受け流し・カウンター・見切りなど、武器の型が応手に数える出来事）1 回で戻る気力 |
| `swordsman.finisher` | 終撃の命中 1 回で戻る気力（近接の 1 振りで数えるのは MANA.meleeTargetCap 体まで） |
| `hunter.dashHit` | ダッシュ攻撃の命中 1 回で戻る気力（1 振りで数えるのは MANA.meleeTargetCap 体まで） |
| `brawler.perCombo` | コンボの命中: 近接の命中 1 回で、今のコンボ数 × この値の気力（comboCap で頭打ち） |
| `brawler.comboCap` | コンボの命中: 数えるコンボ数の上限 |
| `shieldBearer.perDamage` | 受け止め: 盾の構え・不退で受けた被ダメージ（軽減前）1 につき戻る気力 |
| `hexer.perSec` | 継続ダメージの刻み: 自分が付けた燃焼・毒などの継続ダメージ 1 つが敵を刻む 1 秒あたりの気力 |
| `lancer.tipHit` | 先端の命中（突きの穂先・鞭の先）1 回で戻る気力 |
| `invoker.skillHit` | スキルの命中 1 回（1 体）で戻る気力 |
| `shadow.backstab` | 背面の命中 1 回で戻る気力（攻撃中の敵の背後・影潜りの直後） |
| `alchemist.reaction` | 敵に状態異常の反応を起こすと戻る気力 |
| `onmyoji.minionHit` | 設置物・連動体の命中 1 回（1 体）で戻る気力。設置物は爆ぜる・回る・崩れる一撃だけ数える（引力球・氷結地帯・泥沼の 0.5 秒ごとの刻みは数えない） |
| `miko.boonFired` | 祝福の加護（Rule）が 1 回発動するごとに戻る気力 |

## weapons/WEAPON

| 項目 | 意味 |
| --- | --- |
| `chargeRingColors` | （未記入） |
| `chargeRingRadius` | 溜めの環の半径（px。描画） |
| `chargeRingStep` | 溜めの環の段ごとの広がり（px。描画） |
| `chainWindow` | 派生の入力列を保つ秒（振り終わりから。振っている間は減らない）。この間に次を押せば左右共有の段カウンタも続く。目安 0.3〜0.5。右レーンの段に置くと、その段を出した後の窓だけを上書きする（再使用・laneGap より十分長く） |
| `chainMaxInputs` | 派生の照合に残す直近の入力の数。最長の派生の入力数以上にする |
| `trailLife` | 振りの残像の線が残る秒 |
| `movesets.*.attackMoveMul` | 攻撃中の移動速度の倍率（1 = 等倍）。実際は weightClass の帯（weight の moveMulMin〜Max）に丸めて使う |
| `movesets.*.weight` | 武器の重さ（light / medium / heavy）。係数は weightClass.json の同名の行。決め方は docs/recipes/weapon.md |
| `movesets.*.steps2[].kind` | （未記入） |
| `movesets.*.steps2[].key` | （未記入） |
| `movesets.*.steps2[].cooldown` | 右レーンの段の再使用の秒（段の key ごとに数える）。0 は制限なし |
| `movesets.*.steps2[].hold` | 押している間の構え。moveMul は移動の倍率、maxSec は自動で解く秒、parry は受け流し（windowSec 窓の秒 / recoverSec 外した硬直 / staggerPoise 相手に入れる怯み値）、guard は盾の構え（arcDeg 前方の角度 / damageMul 被ダメ倍率 / energyGain 受けるたびの奥義ゲージ）、release は離した振り、releaseNext はその後の段 |
| `movesets.*.*.step.windup` | 振りの予備動作の秒（攻撃速度で割る） |
| `movesets.*.*.step.active` | 当たり判定が出ている秒 |
| `movesets.*.*.step.recover` | 振った後の硬直の秒。後半は先行入力で打ち切れる（PLAYER.recoverCancel）。右レーンの段は左の同じ段番号の 1.2 倍が目安 |
| `movesets.*.*.*.scaling` | 威力の係数（base + ステータス × 係数。docs/COMBAT_DESIGN.md A-10）。左右の同じ段番号は基礎値（各 5）で同じ秒間威力が目安 |
| `movesets.*.*.*.poiseRatio` | 怯み値のステータス係数。合計は怯み値 × 3% / 点が目安（2〜4%） |
| `movesets.*.*.*.poise` | 1 ヒットの怯み値（ステータスが基礎値のとき） |
| `movesets.*.*.step.reach` | 当たり判定の距離（px）。box / circle は中心までの距離、arc は半径、thrust は長さ。外縁（box / circle は reach + size / 2）は振った武器の先端まで（data/meleeReach.test.ts。docs/recipes/weapon.md） |
| `movesets.*.*.step.size` | 当たり判定の大きさ（px）。box は一辺、circle は直径、thrust は幅 |
| `movesets.*.*.step.knockback` | ノックバックの速さ（px/秒） |
| `movesets.*.*.step.heavy` | 重い振り（重いヒットストップと壁叩きつけ） |
| `movesets.*.*.step.mana` | 命中 1 体ごとの気力回収 |
| `movesets.*.*.step.shape` | 当たり判定の形（kind は box / arc / thrust / circle）。arc は deg に扇の中心角（度） |
| `movesets.*.*.step.lunge` | windup + active の間に攻撃方向へ踏み込む距離（px） |
| `movesets.*.steps2[].step.trail` | （未記入） |
| `movesets.*.branches.*.sequence` | （未記入） |
| `movesets.*.*.*.*.windup` | 振りの予備動作の秒（攻撃速度で割る） |
| `movesets.*.*.*.*.active` | 当たり判定が出ている秒 |
| `movesets.*.*.*.*.recover` | 振った後の硬直の秒。後半は先行入力で打ち切れる（PLAYER.recoverCancel）。右レーンの段は左の同じ段番号の 1.2 倍が目安 |
| `movesets.*.*.*.*.scaling` | 威力の係数（base + ステータス × 係数。docs/COMBAT_DESIGN.md A-10）。左右の同じ段番号は基礎値（各 5）で同じ秒間威力が目安 |
| `movesets.*.*.*.*.poiseRatio` | 怯み値のステータス係数。合計は怯み値 × 3% / 点が目安（2〜4%） |
| `movesets.*.*.*.*.poise` | 1 ヒットの怯み値（ステータスが基礎値のとき） |
| `movesets.*.*.*.*.reach` | 当たり判定の距離（px）。box / circle は中心までの距離、arc は半径、thrust は長さ。外縁（box / circle は reach + size / 2）は振った武器の先端まで（data/meleeReach.test.ts。docs/recipes/weapon.md） |
| `movesets.*.*.*.*.size` | 当たり判定の大きさ（px）。box は一辺、circle は直径、thrust は幅 |
| `movesets.*.*.*.*.knockback` | ノックバックの速さ（px/秒） |
| `movesets.*.*.*.*.heavy` | 重い振り（重いヒットストップと壁叩きつけ） |
| `movesets.*.*.*.*.mana` | 命中 1 体ごとの気力回収 |
| `movesets.*.*.*.*.shape` | 当たり判定の形（kind は box / arc / thrust / circle）。arc は deg に扇の中心角（度） |
| `movesets.*.*.*.*.hitstop` | ヒットストップ（ステップ。60Hz） |
| `movesets.*.*.*.*.shake` | 命中時の画面揺れ |
| `movesets.*.*.*.*.lunge` | windup + active の間に攻撃方向へ踏み込む距離（px） |
| `movesets.*.branches.*.step.trail` | （未記入） |
| `movesets.*.branches.*.next` | 派生の後に続ける段（0 始まり。左右共有の段カウンタ）。省略はフィニッシュ |
| `movesets.*.branches.*.step.hits` | 1 振りの多段ヒット数（active を等分する） |
| `movesets.*.*.windup` | 振りの予備動作の秒（攻撃速度で割る） |
| `movesets.*.*.active` | 当たり判定が出ている秒 |
| `movesets.*.*.recover` | 振った後の硬直の秒。後半は先行入力で打ち切れる（PLAYER.recoverCancel）。右レーンの段は左の同じ段番号の 1.2 倍が目安 |
| `movesets.*.*.scaling` | 威力の係数（base + ステータス × 係数。docs/COMBAT_DESIGN.md A-10）。左右の同じ段番号は基礎値（各 5）で同じ秒間威力が目安 |
| `movesets.*.*.poiseRatio` | 怯み値のステータス係数。合計は怯み値 × 3% / 点が目安（2〜4%） |
| `movesets.*.*.poise` | 1 ヒットの怯み値（ステータスが基礎値のとき） |
| `movesets.*.*.reach` | 当たり判定の距離（px）。box / circle は中心までの距離、arc は半径、thrust は長さ。外縁（box / circle は reach + size / 2）は振った武器の先端まで（data/meleeReach.test.ts。docs/recipes/weapon.md） |
| `movesets.*.*.size` | 当たり判定の大きさ（px）。box は一辺、circle は直径、thrust は幅 |
| `movesets.*.*.knockback` | ノックバックの速さ（px/秒） |
| `movesets.*.*.heavy` | 重い振り（重いヒットストップと壁叩きつけ） |
| `movesets.*.*.mana` | 命中 1 体ごとの気力回収 |
| `movesets.*.*.shape` | 当たり判定の形（kind は box / arc / thrust / circle）。arc は deg に扇の中心角（度） |
| `movesets.*.*.hitstop` | ヒットストップ（ステップ。60Hz） |
| `movesets.*.*.shake` | 命中時の画面揺れ |
| `movesets.*.*.lunge` | windup + active の間に攻撃方向へ踏み込む距離（px） |
| `movesets.*.steps[].trail` | （未記入） |
| `movesets.*.dashAttack` | ダッシュ攻撃の振り（項目は段と同じ） |
| `*.*.charge` | 溜め。moveMul は溜め中の移動の倍率、step は離して出す振り、levels は段（time 秒で届き、damageMul / poiseMul / reachMul 倍）。近接の溜めの reachMul は 1（届く距離は刃先のまま。刀の居合を除く） |
| `movesets.*.*.step.hitstop` | ヒットストップ（ステップ。60Hz） |
| `movesets.*.*.step.shake` | 命中時の画面揺れ |
| `*.*.*.*.damageMul` | 1 発の威力の倍率 |
| `*.*.charge.levels[].poiseMul` | 1 発の怯み値の倍率 |
| `*.*.*.hits` | 1 振りの多段ヒット数（active を等分する） |
| `movesets.*.steps2[].step.invuln` | 振り始めから付く無敵（秒） |
| `movesets.*.steps2[].step.hits` | 1 振りの多段ヒット数（active を等分する） |
| `movesets.*.steps2[].*.applies[]` | 命中した敵に付ける状態異常（kind 種類 / stacks 重ねる数 / duration 秒 / potency 効果量 / ratio 効果量のステータス係数） |
| `movesets.*.tip` | 先端判定。ratio は先端の割合（0..1。突きは帯の先、sweep の薙ぎ・回しは外周）、damageMul / poiseMul / manaMul は先端の倍率、offDamageMul / offManaMul は根元の倍率、sweep は突きに加えて薙ぎ（arc）・回し（circle）の段も外周を先端に数える（真偽。省略は突きだけ）。長柄の戦意と槍兵の気力は先端の命中で溜まる |
| `movesets.*.tip.damageMul` | 1 発の威力の倍率 |
| `movesets.*.tip.poiseMul` | 1 発の怯み値の倍率 |
| `movesets.*.*.pull` | 敵を自分の方へ引き寄せる |
| `movesets.*.steps2[].step.pull` | 敵を自分の方へ引き寄せる |
| `movesets.*.branches.*.step.pull` | 敵を自分の方へ引き寄せる |
| `movesets.*.*.*.*.applies[]` | 命中した敵に付ける状態異常（kind 種類 / stacks 重ねる数 / duration 秒 / potency 効果量 / ratio 効果量のステータス係数） |
| `movesets.*.*.throw` | 近接の段では敵を背後へ放る（真偽）。右レーンの弾の段では出す弾（bullet は弾の数値、scaling / poise / poiseRatio は技の威力と怯み値、count は弾数、spreadDeg は扇の間隔（度）） |
| `movesets.*.*.*.throw` | 近接の段では敵を背後へ放る（真偽）。右レーンの弾の段では出す弾（bullet は弾の数値、scaling / poise / poiseRatio は技の威力と怯み値、count は弾数、spreadDeg は扇の間隔（度）） |
| `movesets.*.steps[].applies[]` | 命中した敵に付ける状態異常（kind 種類 / stacks 重ねる数 / duration 秒 / potency 効果量 / ratio 効果量のステータス係数） |
| `movesets.*.steps[].cast.key` | （未記入） |
| `movesets.*.steps[].cast.throw.bullet.cooldownMul` | 射撃間隔の倍率（大きいほど遅い） |
| `movesets.*.steps[].cast.throw.bullet.damageMul` | 1 発の威力の倍率 |
| `movesets.*.steps[].cast.throw.bullet.speedMul` | 弾速の倍率 |
| `movesets.*.steps[].cast.throw.bullet.lifeMul` | 弾の寿命（射程）の倍率 |
| `movesets.*.steps[].cast.throw.bullet.radius` | 弾の半径（px） |
| `movesets.*.steps[].cast.throw.bullet.poiseMul` | 1 発の怯み値の倍率 |
| `movesets.*.steps[].cast.throw.bullet.recoilMul` | 撃った反動の倍率 |
| `movesets.*.steps[].cast.throw.bullet.pellets` | 1 回に足す弾数（散弾） |
| `movesets.*.*.*.*.*.spreadDeg` | 複数弾の扇の間隔（度） |
| `movesets.*.steps[].cast.throw.bullet.pierceBonus` | 貫通の追加回数 |
| `movesets.*.*.*.*.spreadDeg` | 複数弾の扇の間隔（度） |
| `movesets.*.steps[].cast.throw.bullet.lob` | 曲射（blastRadius 炸裂の半径 px / minRange 最短の着弾距離 px / peak 見かけの山の高さ px） |
| `movesets.*.*.*.*.*.*.radius` | 弾の半径（px） |
| `movesets.*.steps2[].chainWindow` | 派生の入力列を保つ秒（振り終わりから。振っている間は減らない）。この間に次を押せば左右共有の段カウンタも続く。目安 0.3〜0.5。右レーンの段に置くと、その段を出した後の窓だけを上書きする（再使用・laneGap より十分長く） |
| `movesets.*.steps2[].throw.bullet.cooldownMul` | 射撃間隔の倍率（大きいほど遅い） |
| `movesets.*.*.*.*.damageMul` | 1 発の威力の倍率 |
| `movesets.*.steps2[].throw.bullet.speedMul` | 弾速の倍率 |
| `movesets.*.*.*.*.lifeMul` | 弾の寿命（射程）の倍率 |
| `movesets.*.steps2[].throw.bullet.radius` | 弾の半径（px） |
| `movesets.*.steps2[].*.*.poiseMul` | 1 発の怯み値の倍率 |
| `movesets.*.steps2[].throw.bullet.recoilMul` | 撃った反動の倍率 |
| `movesets.*.steps2[].throw.bullet.pellets` | 1 回に足す弾数（散弾） |
| `movesets.*.*.*.*.pierceBonus` | 貫通の追加回数 |
| `movesets.*.*.*.spreadDeg` | 複数弾の扇の間隔（度） |
| `movesets.*.branches.*.step.cast.key` | （未記入） |
| `movesets.*.branches.*.step.cast.throw` | 近接の段では敵を背後へ放る（真偽）。右レーンの弾の段では出す弾（bullet は弾の数値、scaling / poise / poiseRatio は技の威力と怯み値、count は弾数、spreadDeg は扇の間隔（度）） |
| `movesets.*.branches.*.step.cast.throw.bullet.cooldownMul` | 射撃間隔の倍率（大きいほど遅い） |
| `movesets.*.branches.*.step.cast.throw.bullet.damageMul` | 1 発の威力の倍率 |
| `movesets.*.branches.*.step.cast.throw.bullet.speedMul` | 弾速の倍率 |
| `movesets.*.branches.*.step.cast.throw.bullet.lifeMul` | 弾の寿命（射程）の倍率 |
| `movesets.*.branches.*.step.cast.throw.bullet.radius` | 弾の半径（px） |
| `movesets.*.branches.*.step.cast.throw.bullet.poiseMul` | 1 発の怯み値の倍率 |
| `movesets.*.branches.*.step.cast.throw.bullet.recoilMul` | 撃った反動の倍率 |
| `movesets.*.branches.*.step.cast.throw.bullet.pellets` | 1 回に足す弾数（散弾） |
| `movesets.*.branches.*.step.cast.throw.bullet.spreadDeg` | 複数弾の扇の間隔（度） |
| `movesets.*.branches.*.step.cast.throw.bullet.pierceBonus` | 貫通の追加回数 |
| `movesets.*.branches.*.step.cast.throw.scaling` | 威力の係数（base + ステータス × 係数。docs/COMBAT_DESIGN.md A-10）。左右の同じ段番号は基礎値（各 5）で同じ秒間威力が目安 |
| `movesets.*.branches.*.step.cast.throw.poise` | 1 ヒットの怯み値（ステータスが基礎値のとき） |
| `movesets.*.branches.*.step.cast.throw.poiseRatio` | 怯み値のステータス係数。合計は怯み値 × 3% / 点が目安（2〜4%） |
| `movesets.*.*.*.*.*.*.spreadDeg` | 複数弾の扇の間隔（度） |
| `movesets.*.branches.*.step.cast.throw.applies[]` | 命中した敵に付ける状態異常（kind 種類 / stacks 重ねる数 / duration 秒 / potency 効果量 / ratio 効果量のステータス係数） |
| `movesets.*.branches.*.step.cast.throw.bullet.mine` | 設置弾（fuse 信管の秒 / drag 床の減衰 / blastRadius 炸裂の半径 px / triggerRadius 近づくと炸裂する距離 px） |
| `movesets.*.branches.*.step.cast.throw.bullet.leaves.radius` | 弾の半径（px） |
| `movesets.*.branches.*.step.cast.throw.bullet.homing` | 追尾（turnRate 旋回の速さ / range 敵を探す距離 px） |
| `movesets.*.branches.*.step.cast.throw.bullet.bounce` | 跳弾（count 回数 / mul 跳ねるたびの威力の倍率） |
| `movesets.*.steps2[].charge` | 溜め。moveMul は溜め中の移動の倍率、step は離して出す振り、levels は段（time 秒で届き、damageMul / poiseMul / reachMul 倍）。近接の溜めの reachMul は 1（届く距離は刃先のまま。刀の居合を除く） |
| `movesets.*.branches.*.step.invuln` | 振り始めから付く無敵（秒） |
| `movesets.*.steps2[].throw.bullet.boomerang` | 回転刃（returnAt 寿命のこの割合で折り返す / catchRadius 手に収まる距離 px） |
| `movesets.*.branches.*.shots` | 派生の振り始めに出す弾。count は普段の射撃を何回撃つか（1 回 = 1 + 装備の弾数 + 散弾の粒、三点の器は各回の向きに三点の続き。from が lane なら右レーンの弾の段の 1 回）、damageMul は 1 発の威力の倍率、spreadDeg は回ごとの扇の間隔（度）、pierceBonus は貫通の追加。from が lane なら右レーンの弾の段の弾、省略は装備の銃の弾 |
| `movesets.*.reloadMoveMul` | 銃: 込め（リロード）の最中の移動速度の倍率（1 = 等倍。docs/ideas/gun-bases-review.md 2-8）。砲の詰めの最中も同じ倍率。二丁拳銃はどちらかの手が込めている間 |
| `movesets.*.muzzleOffset` | 二丁拳銃の銃口の左右のずれ（px） |
| `movesets.*.hands` | 二丁拳銃の左右の手（system/dualPistols.ts）。chainSec = 同じ手の押下をこの秒の内に続けると連続（2 回目・3 回目の技）に数える / bufferSec = 振りの最中・手の間の押下を覚えておく秒 / bothHandsSec = 先に押した手の 1 発からこの秒の内にもう片方を押すと撃ち尽くし / unload = 撃ち尽くし（spreadDeg は弾倉の 1 発ごとの扇の間隔の度、damageMul は 1 発の威力の倍率で拍の放出の倍率をさらに掛ける、selfKnock は撃った後に自分が下がる速さ px/秒）。回転撃ち（steps2 の spinShot）の throw.count は右手の弾倉の 1 発あたりの弾数で、右手の残りぶんを全周へ等間隔に撒く（spreadDeg は使わない） |
| `movesets.*.*.*.selfKnock` | 振り始めに自分を後ろへ押す速さ（px/秒） |
| `movesets.*.quickReload` | 短銃の早込め。込めの進みが from（割合 0..1）に届いてから sec 秒の間にリロードか左を押すと即込め終わり、窓の外で押すと込めが missSec 秒延びる。1 回の込めに 1 回だけ |
| `movesets.*.pack` | 砲の詰め。弾倉が満ちた後もリロードを押し続けると levelSec 秒ごとに詰めが 1 段（max 段まで）。詰めている間は撃てず足が reloadMoveMul 倍 |
| `movesets.*.steps2[].selfKnock` | 振り始めに自分を後ろへ押す速さ（px/秒） |
| `movesets.*.branches.*.detonateMines` | 振り始めに床の自分の設置弾をすべて起爆する |
| `movesets.*.steps2[].detonateMines` | 振り始めに床の自分の設置弾をすべて起爆する |
| `movesets.*.steps2[].throw.bullet.mine` | 設置弾（fuse 信管の秒 / drag 床の減衰 / blastRadius 炸裂の半径 px / triggerRadius 近づくと炸裂する距離 px） |
| `movesets.*.steps2[].step.knockToward` | 命中した敵を飛ばす向き。ownMine = 一番近い自分の設置弾の方（無ければ攻撃の向き。仕掛けの罠蹴り）。省略は攻撃の向き |
| `movesets.*.steps2[].charge.spinning.step.windup` | 振りの予備動作の秒（攻撃速度で割る） |
| `movesets.*.steps2[].charge.spinning.step.active` | 当たり判定が出ている秒 |
| `movesets.*.steps2[].charge.spinning.step.recover` | 振った後の硬直の秒。後半は先行入力で打ち切れる（PLAYER.recoverCancel）。右レーンの段は左の同じ段番号の 1.2 倍が目安 |
| `movesets.*.steps2[].*.*.*.scaling` | 威力の係数（base + ステータス × 係数。docs/COMBAT_DESIGN.md A-10）。左右の同じ段番号は基礎値（各 5）で同じ秒間威力が目安 |
| `movesets.*.steps2[].*.*.*.poise` | 1 ヒットの怯み値（ステータスが基礎値のとき） |
| `movesets.*.steps2[].charge.spinning.step.reach` | 当たり判定の距離（px）。box / circle は中心までの距離、arc は半径、thrust は長さ。外縁（box / circle は reach + size / 2）は振った武器の先端まで（data/meleeReach.test.ts。docs/recipes/weapon.md） |
| `movesets.*.steps2[].charge.spinning.step.size` | 当たり判定の大きさ（px）。box は一辺、circle は直径、thrust は幅 |
| `movesets.*.steps2[].charge.spinning.step.knockback` | ノックバックの速さ（px/秒） |
| `movesets.*.steps2[].charge.spinning.step.heavy` | 重い振り（重いヒットストップと壁叩きつけ） |
| `movesets.*.steps2[].charge.spinning.step.mana` | 命中 1 体ごとの気力回収 |
| `movesets.*.steps2[].charge.spinning.step.shape` | 当たり判定の形（kind は box / arc / thrust / circle）。arc は deg に扇の中心角（度） |
| `movesets.*.steps2[].charge.spinning.step.hitstop` | ヒットストップ（ステップ。60Hz） |
| `movesets.*.steps2[].step.cast.key` | （未記入） |
| `movesets.*.steps2[].step.cast.throw` | 近接の段では敵を背後へ放る（真偽）。右レーンの弾の段では出す弾（bullet は弾の数値、scaling / poise / poiseRatio は技の威力と怯み値、count は弾数、spreadDeg は扇の間隔（度）） |
| `movesets.*.steps2[].step.cast.throw.bullet.cooldownMul` | 射撃間隔の倍率（大きいほど遅い） |
| `movesets.*.steps2[].step.cast.throw.bullet.damageMul` | 1 発の威力の倍率 |
| `movesets.*.steps2[].step.cast.throw.bullet.speedMul` | 弾速の倍率 |
| `movesets.*.steps2[].step.cast.throw.bullet.lifeMul` | 弾の寿命（射程）の倍率 |
| `movesets.*.steps2[].step.cast.throw.bullet.poiseMul` | 1 発の怯み値の倍率 |
| `movesets.*.steps2[].step.cast.throw.bullet.recoilMul` | 撃った反動の倍率 |
| `movesets.*.steps2[].step.cast.throw.bullet.pellets` | 1 回に足す弾数（散弾） |
| `movesets.*.steps2[].step.cast.throw.bullet.pierceBonus` | 貫通の追加回数 |
| `movesets.*.steps2[].step.cast.throw.bullet.arc` | 弧で飛ぶ弾（戦輪。bulge 弧の頂点の横のふくらみ px / catchRadius 帰りに手元のこの距離で収まる px / range 固定の射程 px〔連撃の近投げ。省略はカーソルの距離。最大射程 = 速さ × 寿命で頭打ち〕）。口元から弧でカーソルまで飛び、反対側の弧で手元へ戻る |
| `movesets.*.steps2[].step.cast.throw.poiseRatio` | 怯み値のステータス係数。合計は怯み値 × 3% / 点が目安（2〜4%） |
| `movesets.*.steps2[].step.cast.throw.bullet.pair` | 2 枚投げ（戦輪。offset 口元から進む向きに直交する上下へずらす距離 px）。1 回の射撃で体の上下から 1 枚ずつ出し、弧が逆に膨らんでカーソルで交差する |
| `movesets.*.steps[].cutsBullets` | active の間、弾返し・弾斬りが無くても敵弾を消す |
| `movesets.*.dashAttack.invuln` | 振り始めから付く無敵（秒） |
| `movesets.*.*.*.*.cutsBullets` | active の間、弾返し・弾斬りが無くても敵弾を消す |
| `movesets.*.steps2[].step.drivePins` | （未記入） |
| `movesets.*.branches.shadowPin.sequence` | （未記入） |
| `movesets.*.branches.shadowPin.step.trail` | （未記入） |
| `movesets.*.branches.farThrow.sequence` | （未記入） |
| `movesets.*.branches.farThrow.step.trail` | （未記入） |
| `movesets.*.dashCooldownMul` | その武器種を持つ間のダッシュの再使用時間の倍率（手裏剣 2 = 倍に伸びる代わりに、敵を倒すとダッシュの回数がすべて戻る） |
| `movesets.*.steps[].cast.throw.bullet.pin` | 弾（bullet）が刺さる弾になる（手裏剣・クナイ）。kind = 絵と数える種類（shuriken / kunai）、max = 1 体に刺さったままでいられる本数（超えたら古い順に抜く）、sec = 刺さってから抜けるまでの秒、driveMul = 叩き込みの追撃の倍率、staggerAt = 同じ敵にこの本数刺さると怯ませて刺さりを消す（省略は崩さない。戦意 pinStagger が溜まる） |
| `movesets.*.steps[].cast.throw.bullet.burst` | 三点（count 1 押しの弾数 / interval 間隔の秒） |
| `movesets.*.steps[].cast.throw.bullet.grind` | 食い込む弾（牙輪・大手裏剣。sec 食い込んで回る秒 / hits その間に当てる回数。最初に当たった敵で止まり、当て終えると戻る） |
| `movesets.*.steps[].cast.throw.bullet.grind.hits` | 1 振りの多段ヒット数（active を等分する） |
| `movesets.*.dashAttack.passThrough` | 段（ダッシュ攻撃）が踏み込みの道筋で重なった敵もすべて斬り、敵を前へ押さず脇へ払う（手裏剣の抜け斬り。真偽） |
| `movesets.*.dashAttack.manaPerTarget` | 斬った敵 1 体ごとに戻す気力（MANA.meleeTargetCap の頭打ちを外す。抜け斬り。省略は mana の通常の回収） |
| `movesets.*.steps2[].step.cast.throw.bullet.pin` | 弾（bullet）が刺さる弾になる（手裏剣・クナイ）。kind = 絵と数える種類（shuriken / kunai）、max = 1 体に刺さったままでいられる本数（超えたら古い順に抜く）、sec = 刺さってから抜けるまでの秒、driveMul = 叩き込みの追撃の倍率、staggerAt = 同じ敵にこの本数刺さると怯ませて刺さりを消す（省略は崩さない。戦意 pinStagger が溜まる） |
| `movesets.*.steps2[].step.cast.throw.bullet.grind` | 食い込む弾（牙輪・大手裏剣。sec 食い込んで回る秒 / hits その間に当てる回数。最初に当たった敵で止まり、当て終えると戻る） |
| `movesets.*.steps2[].step.cast.throw.bullet.grind.hits` | 1 振りの多段ヒット数（active を等分する） |
| `artDefaults` | 右レーンの段の共通値。parryInvuln は受け流した後の無敵（秒）、parryParticles / guardParticles は粒の数、detonateLife は起爆させる設置弾の残り寿命、laneGap は弾の段の後の間（秒） |
| `artDefaults.laneGap` | 右レーンの弾の段を出した後、次の弾の段を押せない秒（連打で弾を一度に出さない）。目安 0.2〜0.4 |
| `movesetRules` | 武器種の固有効果（統一ルール）の数値。Pct は %、Sec は秒、Icd は内部の再使用（秒）、Poise は怯み値、Ratio は倍率 |
| `jobBranches.*.windup` | 振りの予備動作の秒（攻撃速度で割る） |
| `jobBranches.*.active` | 当たり判定が出ている秒 |
| `jobBranches.*.recover` | 振った後の硬直の秒。後半は先行入力で打ち切れる（PLAYER.recoverCancel）。右レーンの段は左の同じ段番号の 1.2 倍が目安 |
| `*.*.scaling` | 威力の係数（base + ステータス × 係数。docs/COMBAT_DESIGN.md A-10）。左右の同じ段番号は基礎値（各 5）で同じ秒間威力が目安 |
| `*.*.poiseRatio` | 怯み値のステータス係数。合計は怯み値 × 3% / 点が目安（2〜4%） |
| `jobBranches.*.poise` | 1 ヒットの怯み値（ステータスが基礎値のとき） |
| `jobBranches.*.reach` | 当たり判定の距離（px）。box / circle は中心までの距離、arc は半径、thrust は長さ。外縁（box / circle は reach + size / 2）は振った武器の先端まで（data/meleeReach.test.ts。docs/recipes/weapon.md） |
| `jobBranches.*.size` | 当たり判定の大きさ（px）。box は一辺、circle は直径、thrust は幅 |
| `jobBranches.*.knockback` | ノックバックの速さ（px/秒） |
| `jobBranches.*.heavy` | 重い振り（重いヒットストップと壁叩きつけ） |
| `jobBranches.*.mana` | 命中 1 体ごとの気力回収 |
| `jobBranches.*.shape` | 当たり判定の形（kind は box / arc / thrust / circle）。arc は deg に扇の中心角（度） |
| `jobBranches.*.hits` | 1 振りの多段ヒット数（active を等分する） |
| `jobBranches.*.hitstop` | ヒットストップ（ステップ。60Hz） |
| `jobBranches.*.shake` | 命中時の画面揺れ |
| `jobBranches.*.lunge` | windup + active の間に攻撃方向へ踏み込む距離（px） |
| `jobBranches.*.trail` | （未記入） |
| `jobBranches.*.applies[]` | 命中した敵に付ける状態異常（kind 種類 / stacks 重ねる数 / duration 秒 / potency 効果量 / ratio 効果量のステータス係数） |
| `bullets.*.cooldownMul` | 射撃間隔の倍率（大きいほど遅い） |
| `bullets.*.damageMul` | 1 発の威力の倍率 |
| `bullets.*.speedMul` | 弾速の倍率 |
| `bullets.*.lifeMul` | 弾の寿命（射程）の倍率 |
| `bullets.*.radius` | 弾の半径（px） |
| `bullets.*.poiseMul` | 1 発の怯み値の倍率 |
| `bullets.*.recoilMul` | 撃った反動の倍率 |
| `bullets.*.pellets` | 1 回に足す弾数（散弾） |
| `bullets.*.spreadDeg` | 複数弾の扇の間隔（度） |
| `bullets.*.pierceBonus` | 貫通の追加回数 |
| `bullets.*.magazine` | 銃の弾倉（docs/ideas/gun-bases-review.md 2-8）。capacity は容量（引き金を引いた回数。散弾の粒・三点の 3 本は 1 回）、reloadSec は空から満タンまでの込めの秒、perRoundSec は 1 発ずつ込める器（砲）の 1 発の秒（あれば reloadSec の代わりに使う）。撃ち切ると自動で込める |
| `bullets.*.sway` | 連射の弾筋の揺れ（deg 度 / freq 1 秒あたりの周期） |
| `bullets.*.charge.levels[].radius` | 弾の半径（px） |
| `bullets.*.charge.levels[].pierceBonus` | 貫通の追加回数 |
| `bullets.*.mine` | 設置弾（fuse 信管の秒 / drag 床の減衰 / blastRadius 炸裂の半径 px / triggerRadius 近づくと炸裂する距離 px） |
| `bullets.*.burst` | 三点（count 1 押しの弾数 / interval 間隔の秒） |
| `bullets.*.lob` | 曲射（blastRadius 炸裂の半径 px / minRange 最短の着弾距離 px / peak 見かけの山の高さ px） |
| `bullets.*.pin` | 弾（bullet）が刺さる弾になる（手裏剣・クナイ）。kind = 絵と数える種類（shuriken / kunai）、max = 1 体に刺さったままでいられる本数（超えたら古い順に抜く）、sec = 刺さってから抜けるまでの秒、driveMul = 叩き込みの追撃の倍率、staggerAt = 同じ敵にこの本数刺さると怯ませて刺さりを消す（省略は崩さない。戦意 pinStagger が溜まる） |
| `bullets.*.look.color` | （未記入） |
| `bullets.*.arc` | 弧で飛ぶ弾（戦輪。bulge 弧の頂点の横のふくらみ px / catchRadius 帰りに手元のこの距離で収まる px / range 固定の射程 px〔連撃の近投げ。省略はカーソルの距離。最大射程 = 速さ × 寿命で頭打ち〕）。口元から弧でカーソルまで飛び、反対側の弧で手元へ戻る |
| `bullets.*.pair` | 2 枚投げ（戦輪。offset 口元から進む向きに直交する上下へずらす距離 px）。1 回の射撃で体の上下から 1 枚ずつ出し、弧が逆に膨らんでカーソルで交差する |
| `bullets.*.grind` | 食い込む弾（牙輪・大手裏剣。sec 食い込んで回る秒 / hits その間に当てる回数。最初に当たった敵で止まり、当て終えると戻る） |
| `meleeDamageScale` | 近接の段の威力の係数表（base と全係数）に復元時に掛ける。銃の弾・スキル・奥義は対象外。base と係数を同率で下げるのでステータス 1 点あたりの伸び率は変わらない。倍率（1 = 等倍） |
| `unarmed` | 素手（右手が空のときの拳の型）。damageMul は近接の威力の倍率（1 = 等倍） |
| `unarmed.damageMul` | 1 発の威力の倍率 |
| `weightClass.*.moveMulMin` | 攻撃中の移動倍率の下限。武器種の attackMoveMul をこの帯 [Min, Max] に丸める（1 = 等倍。0 にはしない） |
| `weightClass.*.moveMulMax` | 攻撃中の移動倍率の上限（1 = 等倍） |
| `weightClass.*.finisherMoveMul` | 終撃（最終段・フィニッシュ派生）の移動倍率。-1 は段と同じ。遅くはしても 0（足が止まる）にはしない |
| `weightClass.*.lockActive` | 持続（active）中もダッシュで取り消せない（真偽）。発生（windup）は全重さで取り消せない |
| `weightClass.*.lockRecoverRatio` | 硬直（recover）の最初のこの割合はダッシュで取り消せない。割合（0..1）。0 で硬直は最初から切れる |
| `weightClass.*.recoverMul` | 硬直の倍率（1 = 等倍） |
| `weightClass.*.damageMul` | 重さの補償の威力の倍率（1 = 等倍）。balance-tuner が動かす |
| `weightClass.*.poiseMul` | 重さの補償の怯み値の倍率（1 = 等倍）。balance-tuner が動かす |
| `weightClass.*.hitstop` | 通常命中のヒットストップ（ステップ。60Hz）。段が hitstop を持てば段が優先。重い命中・終撃・撃破・会心は別 |
| `weightClass.*.finisherKnockbackMul` | 重さの補償: 終撃（最終段・フィニッシュ派生・終撃になる放出）の命中のノックバックの倍率（1 = 等倍）。system/player.ts の meleeHitEnemy |
| `weightClass.*.finisherGuardBreak` | 重さの補償: 終撃が堅守（騎士の盾）を崩す（真偽）。カウンターは重さによらず崩す |
| `weightClass.*.hitstopFinisher` | 終撃の命中のヒットストップの底上げ（ステップ。60Hz）。FEEL.hitstopFinisher を重さで上書きする |
| `weightClass.*` | 重い振り（重いヒットストップと壁叩きつけ） |

## weapons/PLAYER_MELEE

| 項目 | 意味 |
| --- | --- |
| `[].windup` | （未記入） |
| `[].active` | （未記入） |
| `[].recover` | （未記入） |
| `[].scaling.base` | （未記入） |
| `[].scaling.str` | （未記入） |
| `[].scaling.dex` | （未記入） |
| `[].poiseRatio.str` | （未記入） |
| `[].poiseRatio.dex` | （未記入） |
| `[].poise` | （未記入） |
| `[].reach` | （未記入） |
| `[].size` | （未記入） |
| `[].knockback` | （未記入） |
| `[].heavy` | （未記入） |
| `[].lunge` | （未記入） |

## weapons/ACTION_DASH_ATTACK

| 項目 | 意味 |
| --- | --- |
| `windup` | （未記入） |
| `active` | （未記入） |
| `recover` | （未記入） |
| `scaling.base` | （未記入） |
| `scaling.str` | （未記入） |
| `scaling.dex` | （未記入） |
| `poiseRatio.str` | （未記入） |
| `poiseRatio.dex` | （未記入） |
| `poise` | （未記入） |
| `reach` | （未記入） |
| `size` | （未記入） |
| `knockback` | （未記入） |
| `heavy` | （未記入） |

## weapons/FORM

武器の型（docs/ideas/weapon-forms-impl.md 3-1 / 3-2 / 3-4）。

| 項目 | 意味 |
| --- | --- |
| `*.weight` | 型の既定の重さ（light / medium / heavy）。武器種の movesets/<key>.json の weight が違えばそちらが優先（個性。data/weaponForms.test.ts の WEIGHT_OVERRIDES が理由付きで持つ） |
| `*.stepsMin` | 左の連撃の段数の下限（銃の家系は左に段が無いので右レーンの段数）。data/weaponForms.test.ts が検査 |
| `*.stepsMax` | 左の連撃の段数の上限（銃の家系は右レーンの段数） |
| `*.max` | 戦意の上限（単位は型ごと: 返し = 応手の回数、熱 = 0〜100、溜め = 溜めの段、狙い = 0〜100、拍 = 左右を交互に撃った数）。溜め（導出の型）は武器種の溜めの段数で頭打ち。PlayerStats.moraleMaxAdd を足す |
| `*.releaseMin` | 放出になる最低の戦意。これ未満で放出の段を振ってもただの段（消費しない）。溜めは max と武器種の溜めの段数の小さい方で頭打ち |
| `*.consumeUnits` | 放出 1 回で使う戦意。0 = すべて |
| `*.decayDelaySec` | 最後に溜まってからこの秒を過ぎると冷め始める（秒。0 = 冷めない）。目安 1〜1.5 |
| `*.decayPerSec` | 冷める速さ（戦意 / 秒） |
| `*.releaseCrit` | 放出の弾が必ず会心になる（真偽。長銃の満ちた 1 発） |
| `*.gain` | 溜まる出来事ごとの量。meleeHit = 通常の振りの命中（多段の区切りごとに 1 回。同じ区切りで何体に当てても 1 回）/ riposte = 型の応手 1 回（1 振りで 1 回まで）/ tipHit = 長柄の先端（槍の穂先・棍の棒先）の命中 1 回 / still = 止まっている 1 秒あたり / skillHit = 書: スキルの命中 1 回（設置物・連動体の命中は除く）/ minionHit = 鈴: 設置物・連動体の命中 1 回 / quickReload = 短銃: 早込めが決まった 1 回 / pack = 装薬: 詰めの段が 1 つ上がった / blastHit = 擲弾: 敵を 1 体以上巻き込んだ自分の炸裂 1 回（巻き込まない炸裂は数えない）/ alternateShot = 二丁: 前の押下と違う手で撃った 1 発（同じ手が続くと拍は 0 へ途切れる）/ pinStagger = 手裏剣: 刺さり崩しで敵を怯ませた 1 回 / roundTrip = 戦輪: 1 回の投げで行きと帰りの両方で当てた敵 1 体（1 体につき 1 回）。PlayerStats.moraleGainMul を掛ける |
| `*.perUnit` | 放出の戦意 1 あたりの上乗せ。damageMul / poiseMul / reachMul / knockbackMul は倍率への加算（1 + 値 × 戦意）、hitsAdd / pierceAdd は多段と貫通への加算（値 × 戦意の切り捨て）。reachMul は弾を撃つ放出（詠唱の弾の段）では弾の半径にも掛かる（戦輪の大輪。当たりも絵も大きくなる） |
| `*.chargeArmor` | 重打の溜め中の堅さ。damageTakenMul は溜め中の被ダメの倍率（1 = 等倍）、noKnock は溜め中に押されない（真偽） |
| `*.nearPx` | 刃斧: 戦意「傷」を数える距離（px。自分からこの内側の敵の傷の最大スタックが戦意。導出） |
| `*.rend` | 刃斧: 裂き（右の最終段の放出）が命中した敵の傷 1 つあたりの上乗せ。damageMulPerStack / poiseMulPerStack は倍率への加算（1 + 値 × 傷）。命中した敵の傷はすべて消える |
| `*.tipCutsBullets` | 長柄: 穂先（先端判定）を持つ突きの段が active の間、敵弾を払う（真偽）。払えば応手（bulletCut） |
| `*.cast` | 長柄: 穂先が満ちた後の最初の突き（放出）が active の瞬間に撃つ、貫く穂先の弾（MeleeStepDef.cast と同じ形。名前は data/weapons.ts の CAST_NAMES）。弾には放出の倍率（perUnit）が乗る |
| `*.linkSec` | 鎖: 引き寄せの段（pull）が当たった敵を繋いでおく秒（Enemy.linked）。繋いだ敵の数が戦意「繋ぎ」（導出） |
| `*.shareRatio` | 鎖: 一蓮托生。繋いだ敵に与えた直接のダメージ × この値を、他の繋いだ敵それぞれにも与える（素性なしの追撃。継続ダメージは分けない） |
| `*.slamGapPx` | 鎖: 束ね打ち（右の最終段の放出）の振り始めに、繋いだ敵を自分の前へ寄せるときの体どうしの隙間（px）。寄せたら繋ぎは解ける |
| `*.gain.guardBlock` | 盾: 構えで受けた被ダメージ 1 あたりの受け溜め（受けた元のダメージ × この値）。moraleGainMul を掛ける |
| `*.blockOnlyCommitted` | 盾: 応手（guardBlock）になるのはコミットした攻撃（攻撃が確定した予備動作・攻撃中の敵）を構えで受けたときだけ（真偽）。受け溜めは受けた量で常に溜まる |
| `*.gain.bulletCut` | 扇: 払いで敵弾を消した 1 発あたりの風（moraleGainMul を掛ける） |
| `*.spreadRadiusPerUnit` | 扇: 突風（構えを離した振り）が地形を広げる半径への風 1 あたりの上乗せ（px。突風の振りの間だけ、広げる Rule の半径に足す） |
| `*.gain.pinDriven` | クナイ: 叩き込んだクナイ 1 本あたりの叩き込み（moraleGainMul を掛ける。system/pins.ts の drivePins） |
| `*.senbon` | クナイ: 千本（戦意が満ちた後の次の左の投げ）。count = 扇に投げる本数、spreadDeg = 扇の間隔（度）、pinMax = この投げの刺さりの上限（弾の pin.max より多く刺さる。全部刺さる） |
| `*.senbon.pinMax` | 千本の 1 体に刺さる本数の上限 |
| `*.timed` | 手裏剣: 連ね投げ（放出）。戦意が満ちた後の次の投げで始まり、sec 秒のあいだ攻撃の速さ（振りの秒と射撃の間隔）が attackSpeedMul 倍になる（投げの間隔が縮む） |
| `*.primed` | 短銃: 強装填の弾倉（早込めが満ちたその込めの弾倉）の全弾の倍率。damageMul は威力、poiseMul は怯み値（1 = 等倍）。弾倉の 1 発目は放出の弾（終撃） |
| `*.zeroDistance` | 短銃: 応手になる見切りの距離（px。敵の中心までがこの内側のときだけ） |
| `*.moveLossPerSec` | 長銃: 動いている 1 秒あたりに減る狙い（戦意 / 秒） |
| `*.levels[]` | 装薬: 詰めの段ごとの放出（1 段目から並べる）。pelletsAdd は散弾の粒に足す数、damageMul は弾（零距離砲は振り）の威力と怯み値の倍率、recoilPx は撃った向きの逆へ跳ぶ距離（px。壁で止まる） |
| `*.skillCooldownMul` | 書: 持っている間のスキルの再使用（CD 型の再使用の秒）の倍率（1 = 等倍）。無詠唱（右 1 段目の放出）は次の気力のスキル 1 回の気力を 0 にする |
| `*.toll` | 鈴: 打ち鳴らし（右 1 段目の放出）。radius の内側の自分の設置物を即発動し、連動体（砲台・墓標）に 1 回撃たせる（px）。buffSec 秒の間、設置物・連動体の命中の威力を buffMul 倍にする（1 = 等倍）。強化の間の左の振り 1 回で extendSec 秒延び、残りは maxSec 秒まで |

## weapons/MOMENT

全ての型が出す共通の瞬間（先制・終撃・充溢・放出・応手・双撃。

| 項目 | 意味 |
| --- | --- |
| `firstStrikeIdleSec` | 先制が戻るまでの交戦の外の秒。交戦の外でこれだけ待った後の最初の一撃（近接・射撃・スキル）が先制（秒） |
| `twinStrikeWindowSec` | 双撃の窓。左右の違うレーンの命中がこの秒以内に続けば双撃（秒。連撃の窓 WEAPON.chainWindow に近い値） |
| `brim` | 充溢（戦意が満ちた瞬間）の浮き文字。color は色、scale は大きさ（1 = 等倍）、life は残る秒 |
| `release` | 放出（戦意を使った瞬間）の浮き文字。項目は brim と同じ |
| `twinStrike` | 双撃（左右を交互に当てた）の浮き文字。項目は brim と同じ |
| `firstStrike` | 先制（交戦の最初の一撃）の浮き文字。項目は brim と同じ |
| `reload` | 装填の浮き文字（旧短銃。弾倉の仕組みへ移したので今は出さない）。項目は brim と同じ |
| `primed` | 強装填（短銃の戦意「早込め」が満ち、その込めの弾倉が強装填になった）の浮き文字。項目は brim と同じ |

## weapons/REFORGE

改鋳（docs/ideas/weapon-forms-impl.md 3-6）。

| 項目 | 意味 |
| --- | --- |
| `perRun` | 1 ランで選べる改鋳の上限（回）。上限に達したらボスを倒しても 3 択は出ない |
| `offerCount` | 3 択に並べる数。装備中の型の改鋳を先に、足りなければ他の型の改鋳で埋める |
| `inputDelay` | 3 択を出してから入力を受け付けるまでの秒（攻撃の押しっぱなしで誤って選ばないように） |
| `textColor` | 改鋳を得たときの浮き文字とログ、3 択の札の枠の色 |
| `blade.bladeRepel.staggerMul` | 受け流しの崩しの怯み値（hold.parry.staggerPoise）に掛ける倍率 |
| `*.*.knockbackMul` | 書き換える段のノックバックに掛ける倍率（0 で押し出さない） |
| `*.*.sizeMul` | 書き換える段の当たりの大きさ（size）に掛ける倍率 |
| `blade.bladeWave.cast` | 書き換える段が active に入った瞬間に撃つ弾（MeleeStepDef.cast と同じ形。弾の名前は改鋳の名前） |
| `blade.bladeWave.cast.throw.bullet.radius` | 効果の半径（px） |
| `blade.bladeWave.cast.throw.bullet.spreadDeg` | 弾の扇の隣り合う間隔（度） |
| `blade.bladeWave.cast.throw.bullet.look.color` | 効果の輪・線の色 |
| `blade.bladeWave.cast.throw.poise` | 与える怯み値 |
| `blade.bladeWave.cast.throw.count` | 回数・弾数 |
| `blade.bladeWave.cast.throw.spreadDeg` | 弾の扇の隣り合う間隔（度） |
| `*.*.max` | 戦意の上限の上書き（FORM.<型>.max の代わり） |
| `flurry.flurryHoard.releaseMin` | 放出になる最低の戦意の上書き |
| `flurry.flurryHoard.decayPerSec` | 戦意の冷める速さの上書き（0 で冷めない） |
| `flurry.flurryHoard.perUnit` | 放出の戦意 1 あたりの上乗せの上書き（書いた項目だけ FORM.<型>.perUnit を置き換える） |
| `flurry.flurryTwin.hitsMul` | 書き換える段の多段ヒット数に掛ける倍率 |
| `*.*.moveMul` | 構え・溜めの間の移動速度倍率の上書き |
| `crusher.crusherStride.maxLevels` | 溜めの段の上限（これより上の段を捨てる） |
| `*.*.radius` | 効果の半径（px） |
| `*.*.duration` | 効果の持続（秒） |
| `*.*.icd` | 同じ効果が続けて起きない間隔（秒。0 で間隔なし） |
| `hewer.hewerSpread.stacks` | 付ける状態異常の重ねる数 |
| `hewer.*.color` | 効果の輪・線の色 |
| `*.*.count` | 回数・弾数 |
| `polearm.polearmPin.pinSec` | 縫い留める秒（麻痺の持続。行動停止の上限で切られる） |
| `*.*.magnitude` | 効果量。scaleBy が slashBase なら近接 1 段目の威力に掛ける倍率、volley は射撃 1 発の威力の % |
| `bulwark.bulwarkRound.arcDeg` | 構えで受ける角度（度。360 で全方位） |
| `pistol.pistolDash.primes` | 込めの最中にダッシュして込め終えたとき、早込めが決まったことにもする（真偽。戦意への反映は型の早込めの出来事） |
| `rifle.rifleStride.movingGainMul` | 動いている間に狙いが溜まる速さ（止まっているときの速さに掛ける倍率。動いても減らなくなる） |
| `artillery.artilleryCling.speed` | 設置弾が敵へ這い寄る速さ（px/秒） |
| `artillery.artilleryCling.range` | 設置弾が敵を探す距離（px） |
| `*.*.seconds` | 秒 |
| `tome.tomeFont.mana` | 回復する気力 |
| `bell.bellToll.poise` | 与える怯み値 |

## skills/SKILL

| 項目 | 意味 |
| --- | --- |
| `slots` | （未記入） |
| `slotLinks` | スロットごとのリンク数（先頭がスキル 1）。そのスロットに付けられるラン内の刻印符の本数。石ごとには持たない（型替え符は linkCost 本ぶん使う） |
| `manaFlashTime` | （未記入） |
| `variantCountWeights` | 変異軸の本数（0 / 1 / 2 本）の重み。2026-10-02 に「変異なし」をやめて必ず 1 本以上にした（スキルの持つ軸が 1 本なら 1 本） |
| `variantPrecision` | （未記入） |
| `inputBuffer` | （未記入） |
| `notReadyTextInterval` | （未記入） |
| `stashCapacity` | スキル石の倉庫の上限（個）。保存データの歯止めだけで、遊びの上の意味は持たせない（遺物の STASH_CAPACITY と同じ 400） |
| `defaultCastRange` | 照準地点の既定の射程。px。照準の射程表（CAST_RANGE）に無いスキル・技の上限と、照準が無いときの正面の距離。目安 120（破片弾の最大射程と同じ） |
| `castWallProbe` | 照準地点を壁の手前で止めるときの刻み。px。小さいほど壁際まで寄る（旧 グレネードの wallProbe） |
| `fullManaEpsilon` | 気力が満タンとみなす誤差の許容（気力の量）。刻印符「溢れ」の判定に使う（旧 満月の砲の fullEpsilon） |
| `parry.cooldown` | （未記入） |
| `parry.minInterval` | （未記入） |
| `parry.poise` | （未記入） |
| `parry.window` | （未記入） |
| `parry.failLock` | （未記入） |
| `parry.successRefund` | （未記入） |
| `parry.radius` | （未記入） |
| `parry.damage.base` | （未記入） |
| `parry.damage.vit` | （未記入） |
| `parry.damage.mnd` | （未記入） |
| `parry.damage.spi` | （未記入） |
| `parry.poiseRatio.vit` | （未記入） |
| `parry.poiseRatio.mnd` | （未記入） |
| `parry.poiseRatio.spi` | （未記入） |
| `parry.knockback` | （未記入） |
| `parry.catchPad` | （未記入） |
| `bloodPact.cooldown` | （未記入） |
| `bloodPact.minInterval` | （未記入） |
| `bloodPact.hpFraction` | （未記入） |
| `bloodPact.duration` | （未記入） |
| `bloodPact.speedMul` | （未記入） |
| `bloodPact.lifesteal` | （未記入） |
| `bloodPact.buff.base` | （未記入） |
| `bloodPact.buff.vit` | （未記入） |
| `bloodPact.buff.spi` | （未記入） |
| `gravityWell.cost` | （未記入） |
| `gravityWell.minInterval` | （未記入） |
| `gravityWell.poise` | （未記入） |
| `gravityWell.maxRange` | （未記入） |
| `gravityWell.duration` | （未記入） |
| `gravityWell.radius` | （未記入） |
| `gravityWell.pull` | （未記入） |
| `gravityWell.core` | （未記入） |
| `gravityWell.tickEvery` | （未記入） |
| `gravityWell.tickDamage.base` | （未記入） |
| `gravityWell.tickDamage.spi` | （未記入） |
| `gravityWell.poiseRatio.spi` | （未記入） |
| `gravityWell.burstDamage.base` | （未記入） |
| `gravityWell.burstDamage.mnd` | （未記入） |
| `gravityWell.burstDamage.spi` | （未記入） |
| `gravityWell.burstKnockback` | （未記入） |
| `gravityWell.silenceTime` | （未記入） |
| `mines.cost` | （未記入） |
| `mines.minInterval` | （未記入） |
| `mines.poise` | （未記入） |
| `mines.arm` | （未記入） |
| `mines.life` | （未記入） |
| `mines.maxAlive` | （未記入） |
| `mines.trigger` | （未記入） |
| `mines.radius` | （未記入） |
| `mines.damage.base` | （未記入） |
| `mines.knockback` | （未記入） |
| `haste.cooldown` | （未記入） |
| `haste.minInterval` | （未記入） |
| `haste.duration` | （未記入） |
| `haste.moveBonus` | （未記入） |
| `haste.exhaust` | （未記入） |
| `haste.buff.base` | （未記入） |
| `haste.buff.dex` | （未記入） |
| `chainHook.cost` | （未記入） |
| `chainHook.minInterval` | （未記入） |
| `chainHook.poise` | （未記入） |
| `chainHook.range` | （未記入） |
| `chainHook.extendTime` | （未記入） |
| `chainHook.recover` | （未記入） |
| `chainHook.hitPad` | （未記入） |
| `chainHook.damage.base` | （未記入） |
| `chainHook.damage.str` | （未記入） |
| `chainHook.damage.dex` | （未記入） |
| `chainHook.poiseRatio.str` | （未記入） |
| `chainHook.poiseRatio.dex` | （未記入） |
| `chainHook.knockback` | （未記入） |
| `chainHook.landGap` | （未記入） |
| `chainHook.bleedStacks` | （未記入） |
| `chainHook.bleedTime` | （未記入） |
| `chainHook.bleedPotency` | （未記入） |
| `chainHook.bleedPotencyRatio.dex` | （未記入） |
| `frostField.cost` | （未記入） |
| `frostField.minInterval` | （未記入） |
| `frostField.poise` | （未記入） |
| `frostField.maxRange` | （未記入） |
| `frostField.duration` | （未記入） |
| `frostField.radius` | （未記入） |
| `frostField.tickEvery` | （未記入） |
| `frostField.tickDamage.base` | （未記入） |
| `frostField.tickDamage.mnd` | （未記入） |
| `frostField.tickDamage.spi` | （未記入） |
| `frostField.slow` | （未記入） |
| `frostField.maxSlow` | （未記入） |
| `frostField.chillTime` | （未記入） |
| `frostField.selfMoveMul` | （未記入） |
| `modifier.*.time` | 撃ってから出るまでの秒 |
| `modifier.*.damageMul` | 遅れて出た発動の威力の倍率（1 = 等倍） |
| `modifier.*.delay` | もう一度出るまでの秒 |
| `modifier.*.burdenMul` | 負担（コスト / 再使用）の倍率 |
| `modifier.*.maxTime` | 溜めの上限秒 |
| `modifier.*.minTime` | これ未満の短押しは溜め無しで撃つ（秒） |
| `modifier.*.maxDamageMul` | 溜めきった時の威力の倍率 |
| `modifier.*.maxAreaMul` | 溜めきった時の範囲の倍率 |
| `modifier.*.moveMul` | 溜め中の移動の倍率 |
| `modifier.*.count` | 弾・鎖が追加で抜ける敵の数 |
| `modifier.*.areaMul` | 範囲の倍率 |
| `modifier.*.range` | 命中した敵から次の敵へ跳べる距離。px |
| `modifier.*.maxPerCast` | 1 回の発動で跳べる回数 |
| `modifier.*.radius` | 命中点の小爆発の半径。px |
| `drop.stoneOnKill` | （未記入） |
| `drop.stoneOnDepth` | （未記入） |
| `drop.runeOnRoomClear` | （未記入） |
| `drop.stoneColor` | （未記入） |
| `drop.runeColor` | （未記入） |
| `drop.runeOffsetX` | （未記入） |
| `drop.depthOffsetY` | （未記入） |
| `drop.runeOnKill.normal` | （未記入） |
| `drop.runeOnKill.elite` | （未記入） |
| `drop.runeOnKill.boss` | （未記入） |
| `drop.runeOnKill.library` | （未記入） |
| `drop.runeOnKill.nest` | （未記入） |
| `drop.runeOnKillPerDepth` | （未記入） |
| `drop.runeOnKillDepthCap` | （未記入） |

## skills/EXTRA_SKILL_TUNING

大拡張（docs/ideas/skills-expansion.md）。

| 項目 | 意味 |
| --- | --- |
| `*.cost` | （未記入） |
| `*.minInterval` | （未記入） |
| `*.poise` | （未記入） |
| `*.maxRange` | （未記入） |
| `*.radius` | （未記入） |
| `*.pickRadius` | （未記入） |
| `*.durationMul` | （未記入） |
| `*.minDuration` | （未記入） |
| `*.poiseEmpty` | （未記入） |
| `*.speed` | （未記入） |
| `*.life` | （未記入） |
| `*.damage` | 1 ヒットの威力の係数表（Scaling。base + 係数 × ステータス実効値） |
| `*.poiseRatio.mnd` | （未記入） |
| `*.poiseRatio.spi` | （未記入） |
| `*.perKind.base` | （未記入） |
| `*.perKind.mnd` | （未記入） |
| `*.perKind.spi` | （未記入） |
| `*.knockback` | （未記入） |
| `*.comboRadius` | （未記入） |
| `*.burstRadius` | （未記入） |
| `*.burnRatio` | （未記入） |
| `*.poisePerBurn` | （未記入） |
| `*.maxPoise` | （未記入） |
| `*.maxAlive` | （未記入） |
| `*.size` | （未記入） |
| `*.meleeReach` | （未記入） |
| `*.meleeHalfAngle` | （未記入） |
| `*.rollSpeed` | （未記入） |
| `*.rollTime` | （未記入） |
| `*.burnTime` | （未記入） |
| `*.burnPotency` | （未記入） |
| `*.poiseRatio.str` | （未記入） |
| `*.spinGap` | （未記入） |
| `*.spinShow` | （未記入） |
| `*.halfAngle` | （未記入） |
| `*.chillStacks` | （未記入） |
| `*.shardRadius` | （未記入） |
| `*.shardDamage.base` | （未記入） |
| `*.shardDamage.str` | （未記入） |
| `*.comboChill` | （未記入） |
| `*.comboAreaMul` | （未記入） |
| `*.poiseRatio.vit` | （未記入） |
| `*.healPerStack` | （未記入） |
| `*.healCapRatio` | （未記入） |
| `*.bossMul` | （未記入） |
| `*.range` | （未記入） |
| `*.perStack` | （未記入） |
| `*.lineMul` | （未記入） |
| `*.lineHalfWidth` | （未記入） |
| `*.count` | （未記入） |
| `*.spreadRad` | （未記入） |
| `*.poiseRatio.dex` | （未記入） |
| `*.fearPoiseMul` | （未記入） |
| `*.fearDamageMul` | （未記入） |
| `*.unsilencedMul` | （未記入） |
| `*.unsilencedPoise` | （未記入） |
| `*.silenceTime` | （未記入） |
| `*.length` | （未記入） |
| `*.halfWidth` | （未記入） |
| `*.poiseMul` | （未記入） |
| `*.buffMul` | （未記入） |
| `*.maxBuffTime` | （未記入） |
| `*.fullAt` | （未記入） |
| `*.maxBonus` | （未記入） |
| `*.heavyCostAt` | （未記入） |
| `*.heavyCostMul` | （未記入） |
| `*.comboPerStage` | （未記入） |
| `*.maxStages` | （未記入） |
| `*.gap` | （未記入） |
| `*.window` | （未記入） |
| `*.hurtMul` | （未記入） |
| `*.poisePerHurt` | （未記入） |
| `*.cooldown` | （未記入） |
| `*.rewind` | （未記入） |
| `*.record` | （未記入） |
| `*.healRatio` | （未記入） |
| `*.invuln` | （未記入） |
| `*.duration` | （未記入） |
| `*.manaPerHit` | （未記入） |
| `*.shotLife` | （未記入） |
| `*.aimReach` | （未記入） |

## skills/EXTRA_MODIFIER_TUNING

刻印符の循環（段取り 7c。

| 項目 | 意味 |
| --- | --- |
| `*.hpPerMana` | 足りない気力 1 あたりに払う生命（最大生命に対する割合） |
| `*.fullMul` | 気力満タンで撃った時の威力の倍率 |
| `*.stepMul` | 同じスロットを続けて撃つたびに足す威力の割合（0.1 = +10%） |
| `*.maxStacks` | 足す回数の上限 |
| `*.perHit` | 命中 1 回ごとに返す気力（払った気力に対する割合） |
| `*.cap` | 1 回の発動で返す上限（払った気力に対する割合。1 = 払った額まで） |
| `*.damageMul` | 威力の倍率 |
| `*.window` | 続けて撃ったとみなす間隔の秒 |
| `*.lockTime` | 暴発の後に撃てない秒 |
| `*.hpFraction` | 暴発で失う生命（最大生命に対する割合。1 未満にはならない） |
| `*.perSec` | 撃たずに待った 1 秒ごとに足す威力の割合 |
| `*.maxCut` | 生命が 0 に近いときの負担の減り（0.6 = 負担 ×0.4）。減った生命の割合に比例する |
| `*.energyCost` | 払う奥義ゲージ |
| `*.every` | この発数ごとに 1 発が無料（気力・再使用を払わない） |

## skills/COMBO_TUNING

連携（docs/ideas/skills-expansion.md 4章）の受付秒（window）と効果。

| 項目 | 意味 |
| --- | --- |
| `hookWhirl.window` | （未記入） |
| `hookWhirl.areaMul` | （未記入） |
| `parryRail.window` | （未記入） |
| `parryRail.damageMul` | （未記入） |
| `parryRail.aimMul` | （未記入） |
| `diveQuake.window` | （未記入） |
| `diveQuake.windupMul` | （未記入） |
| `diveQuake.areaMul` | （未記入） |
| `contagionUnravel.window` | （未記入） |
| `frostBreaker.window` | （未記入） |
| `shadowExploit.window` | （未記入） |
| `reelStomp.window` | （未記入） |
| `reelStomp.areaMul` | （未記入） |
| `reelStomp.poiseMul` | （未記入） |
| `color` | （未記入） |
| `textScale` | （未記入） |
| `textLife` | （未記入） |

## skills/WAVE2_SKILL_TUNING

スキル第2弾（地形・新しい状態異常・属性・武器種・ジョブ・変身・空間）。

| 項目 | 意味 |
| --- | --- |
| `*.cost` | （未記入） |
| `*.minInterval` | （未記入） |
| `*.poise` | （未記入） |
| `*.maxRange` | （未記入） |
| `*.radius` | （未記入） |
| `*.terrainRadius` | （未記入） |
| `*.terrainTime` | （未記入） |
| `*.damage.base` | （未記入） |
| `*.damage.mnd` | （未記入） |
| `*.damage.spi` | （未記入） |
| `*.poiseRatio.mnd` | （未記入） |
| `*.poiseRatio.spi` | （未記入） |
| `*.knockback` | （未記入） |
| `*.wetStacks` | （未記入） |
| `*.damage.str` | （未記入） |
| `*.length` | （未記入） |
| `*.halfWidth` | （未記入） |
| `*.probeStep` | （未記入） |
| `*.clearRadius` | （未記入） |
| `*.perCell` | （未記入） |
| `*.maxBonus` | （未記入） |
| `*.damage.vit` | （未記入） |
| `*.poiseRatio.str` | （未記入） |
| `*.poiseRatio.vit` | （未記入） |
| `*.drawRadius` | （未記入） |
| `*.selfBurnCells` | （未記入） |
| `*.speed` | （未記入） |
| `*.life` | （未記入） |
| `*.radiusPerCell` | （未記入） |
| `*.maxRadius` | （未記入） |
| `*.burnPotency` | （未記入） |
| `*.halfAngle` | （未記入） |
| `*.brandStacks` | （未記入） |
| `*.plainMul` | （未記入） |
| `*.comboStacks` | （未記入） |
| `*.freezeBase` | （未記入） |
| `*.freezePerStack` | （未記入） |
| `*.iceTime` | （未記入） |
| `*.comboAreaMul` | （未記入） |
| `*.comboFreezeMul` | （未記入） |
| `*.damage.dex` | （未記入） |
| `*.poiseRatio.dex` | （未記入） |
| `*.hueMul` | （未記入） |
| `*.shockPotency` | （未記入） |
| `*.vulnerableTime` | （未記入） |
| `*.pickRadius` | （未記入） |
| `*.maxAlive` | （未記入） |
| `*.tickEvery` | （未記入） |
| `*.lineHalfWidth` | （未記入） |
| `*.tickDamage.base` | （未記入） |
| `*.tickDamage.mnd` | （未記入） |
| `*.tickDamage.spi` | （未記入） |
| `*.tickPoise` | （未記入） |

## skills/WAVE2_MODIFIER_TUNING

刻印符の変形のうち、技の行為の列（分裂・旋回・重ね打ち・戻り刃・軌跡）・起点（照準起点・足元起点・据え置き）・発動の時機（終撃連動・応手連動）を変えるもの（段取り 7c）。

| 項目 | 意味 |
| --- | --- |
| `split.countMul` | 弾の数の倍率（扇は同じ数に分ける） |
| `split.spreadDeg` | 分けた弾・扇の間隔（度） |
| `split.damageMul` | 1 つあたりの威力の倍率 |
| `orbit.radius` | 自分の周りを回る半径。px |
| `orbit.turnRate` | 回る速さ（ラジアン / 秒） |
| `orbit.life` | 回り続ける秒 |
| `orbit.pierceAdd` | 足す貫通数（回っている間に何体も当てる） |
| `orbit.rehit` | 同じ敵にもう一度当たれるまでの秒 |
| `tripleHit.hitsMul` | 1 体に当てる回数の倍率 |
| `tripleHit.damageMul` | 1 段あたりの威力の倍率 |
| `recall.lifeMul` | 弾の寿命の倍率（行きの秒は元の寿命のまま、残りが帰り） |
| `recall.pierceAdd` | 足す貫通数（帰りにも当てる） |
| `trail.radius` | 通り道に置く地形の半径。px |
| `trail.time` | 地形の持続秒 |
| `trail.step` | 地形を置く間隔。px |
| `toTarget.thrown.flight` | 近接の刃が照準地点へ飛ぶ秒 |
| `toTarget.thrown.knockbackMul` | 近接を飛ばした時のノックバックの倍率 |
| `toTarget.lobbed.durationMul` | 投げ込んだ置くものの持続の倍率 |
| `toTarget.lobbed.timeMul` | 投げ込んだ置くものの起動までの時間の倍率 |
| `toTarget.lobbed.damageMul` | 投げ込んだ置くものの威力の倍率 |
| `toNova.areaMul` | 範囲の倍率 |
| `linger.arm` | 置いてから起動するまでの秒 |
| `linger.life` | 起動を待つ上限の秒 |
| `linger.trigger` | 敵が近付いたとみなす半径。px |
| `linger.maxAlive` | 同時に置ける数（超えたら古いものから消える） |
| `linger.damageMul` | 発動の威力の倍率 |
| `autoFinisher.dedupe` | この秒以内の終撃の命中は同じ終撃とみなして 1 回だけ撃つ |
| `autoRiposte.dedupe` | この秒以内の応手は同じ応手とみなして 1 回だけ撃つ |
| `reshapeLinkCost` | 型替え符（照準起点・足元起点・据え置き）が使うリンクの本数 |
| `reshapeWeight` | 型替え符の抽選の重み（ほかの符は 1） |

## skills/WAVE2_COMBO_TUNING

| 項目 | 意味 |
| --- | --- |
| `*.window` | （未記入） |
| `*.damageMul` | （未記入） |
| `*.areaMul` | （未記入） |
| `*.poiseMul` | （未記入） |

## skills/WEAR_TUNING

スキル石の使い込み（docs/ideas/skills-expansion.md 5章）。

| 項目 | 意味 |
| --- | --- |
| `milestones` | 芽が出る手動の発動回数の節目（古い順）。回 |
| `perRunPerStone` | 同じ石に 1 ランで出す芽の上限（個）。上限で止めた節目は次のランの最初の発動で芽になる |
| `powerPerBud` | （未記入） |
| `color` | （未記入） |

## skills/FORM_TUNING

変身の共通: 解けた後の反動（SkillRunState.formRecover）の間の移動倍率。

| 項目 | 意味 |
| --- | --- |
| `recoverMoveMul` | （未記入） |

## skills/WAVE3_SKILL_TUNING

スキル第3弾（変身5種）。

| 項目 | 意味 |
| --- | --- |
| `*.cooldown` | （未記入） |
| `*.minInterval` | （未記入） |
| `*.poise` | （未記入） |
| `*.duration` | （未記入） |
| `*.recover` | （未記入） |
| `*.attackMoveMul` | （未記入） |
| `*.bleedStacks` | （未記入） |
| `*.bleedPotency` | （未記入） |
| `*.howlRadius` | （未記入） |
| `*.howlCooldown` | （未記入） |
| `*.fearDuration` | （未記入） |
| `*.outgoingMul` | （未記入） |
| `*.passPad` | （未記入） |
| `*.cost` | （未記入） |
| `*.shellInterval` | （未記入） |
| `*.damage.base` | （未記入） |
| `*.damage.dex` | （未記入） |
| `*.damage.vit` | （未記入） |
| `*.damage.mnd` | （未記入） |
| `*.poiseRatio.dex` | （未記入） |
| `*.poiseRatio.vit` | （未記入） |
| `*.poiseRatio.mnd` | （未記入） |
| `*.speed` | （未記入） |
| `*.life` | （未記入） |
| `*.radius` | （未記入） |
| `*.knockback` | （未記入） |
| `*.recoil` | （未記入） |
| `*.moveMul` | （未記入） |
| `*.drainPerSec` | （未記入） |
| `*.burnPotency` | （未記入） |
| `*.burnDuration` | （未記入） |
| `*.selfBurnPotency` | （未記入） |
| `*.selfBurnDuration` | （未記入） |

## skills/SHAPE_TUNING

変身の共通（第2弾の3種も含む8種すべて）。

| 項目 | 意味 |
| --- | --- |
| `uptimeCap` | （未記入） |
| `afterRatio` | （未記入） |
| `color` | （未記入） |

## skills/ART

技（行為の列で書くスキル石。

| 項目 | 意味 |
| --- | --- |
| `weight` | スキル石の抽選の重み（共通技 1 種あたり。skills/generator.ts の skillWeight）。武器種に依らない。手書きのスキル石は 3〜10 |
| `common.*.cost` | 気力型の消費（気力）。目安 16〜26、平均 18 前後（mana.test.ts の「満タンから 3〜4 発」を保つ） |
| `common.*.minInterval` | このスロットの連打下限（秒） |
| `common.*.poise` | 1 ヒットの基礎怯み値（行為の poise で上書きできる）。最終値は係数の上乗せ後に × poiseDamageMul |
| `common.*.*.radius` | 円（ring）・引き寄せ（pull）の半径（px） |
| `common.*.*.damage` | 1 ヒットの威力の係数表（Scaling。base + 係数 × ステータス実効値）。刻印符の威力倍率が掛かる |
| `common.*.*.damage.base` | 係数表の基礎値 |
| `common.*.*.damage.str` | 筋力 1 点あたりの伸び |
| `common.*.*.damage.vit` | 体力 1 点あたりの伸び |
| `common.*.*.knockback` | ノックバックの強さ（px/秒） |
| `common.*.cooldown` | 再使用型の再使用時間（秒）。移動・強化・防御の技に使う。目安 5〜18 |
| `common.*.*.distance` | 踏み込み（dash）の距離（px。負なら照準と逆へ下がる） |
| `common.*.*.invuln` | 無敵の秒（踏み込み・跳躍・強化） |
| `common.*.range` | 照準地点を使う行為（anchor が target・blink）の最大射程（px） |
| `common.*.*.fear` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.*.stacks` | 付ける状態異常の重ねる数 |
| `common.*.*.*.duration` | 自己強化（buff）の倍率の持続（秒） |
| `common.*.*.*.potency` | 付ける状態異常の効果量（燃焼 3・感電 2・出血 1 が既存の目安。ほかは 0） |
| `common.*.*.duration` | 自己強化（buff）の倍率の持続（秒） |
| `common.*.*.damageMul` | 自己強化の与ダメ倍率（1 = 等倍） |
| `common.*.*.heal` | 最大生命に対する回復の割合（0..1） |
| `common.*.calm.mana` | 取り戻す気力 |
| `common.*.*.self` | 自分に付ける良い状態異常（haste / harden / wrath / fury / charged）の stacks・duration・potency |
| `common.*.*.self.harden` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.self.*.stacks` | 付ける状態異常の重ねる数 |
| `common.*.*.self.*.duration` | 自己強化（buff）の倍率の持続（秒） |
| `common.*.*.self.*.potency` | 付ける状態異常の効果量（燃焼 3・感電 2・出血 1 が既存の目安。ほかは 0） |
| `common.*.*.count` | 弾（shot）の数 |
| `common.*.*.spreadDeg` | 弾の扇の隣り合う間隔（度） |
| `common.*.*.speed` | 弾の速さ（px/秒） |
| `common.*.*.life` | 弾の寿命（秒） |
| `common.*.*.bulletRadius` | 弾の当たりの半径（px） |
| `common.*.*.damage.mnd` | 精神 1 点あたりの伸び |
| `common.*.*.damage.spi` | 霊力 1 点あたりの伸び |
| `common.*.*.burn` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.pierce` | 弾が追加で抜ける敵の数 |
| `common.*.*.damage.dex` | 技巧 1 点あたりの伸び |
| `common.*.*.chill` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.shock` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.poison` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.terrainRadius` | TS の terrain の地形を置く半径（px） |
| `common.*.*.terrainTime` | 地形の持続（秒。省略は地形の既定） |
| `common.*.bolt.weaken` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.arc.range` | 照準地点を使う行為（anchor が target・blink）の最大射程（px） |
| `common.*.arc.jumps` | 連鎖（chain）が跳ねる回数 |
| `common.*.arc.jumpRange` | 連鎖が次の敵へ跳べる距離（px） |
| `common.*.*.toDistance` | 引き寄せた敵を起点からこの距離まで寄せる（px） |
| `common.*.*.bleed` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.delay` | 撃ってからこの行為が出るまでの秒（刻印符の時間倍率が掛かる）。自分起点なら出る瞬間の自分の位置と向きで出る |
| `common.*.*.heavy` | 重い一撃（壁叩きつけ・重いヒットストップ） |
| `common.*.*.speedMul` | 自己強化の移動速度倍率（1 = 等倍） |
| `common.*.run.self.haste` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.harden` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.*.length` | 帯（line）の長さ（px。壁で止まる） |
| `common.*.*.width` | 帯・踏み込みの幅（px） |
| `common.*.thrust.execute` | 当てた後に生命がこの割合以下なら仕留める（0..1。ボスは除く） |
| `common.*.*.ahead` | 起点を照準方向へずらす距離（px） |
| `common.*.surge.self.wrath` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.blade.bounces` | 弾が壁で跳ね返る回数 |
| `common.*.*.hits` | 1 体に当てる回数（2 以上なら刻印符の回数の上乗せが足される） |
| `common.*.*.reach` | 扇（arc）の届く距離（px） |
| `common.*.*.deg` | 扇の開き（度） |
| `common.*.edge.bleed.ratio` | 状態異常の効果量のステータス係数 |
| `common.*.edge.bleed.ratio.dex` | 技巧 1 点あたりの伸び |
| `common.*.freeze` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.flash.silence` | この状態異常を命中した敵に付ける（stacks・duration〔秒〕・potency） |
| `common.*.side` | 起点を照準方向の左右へずらす距離（px。正で左） |
| `TRANSFORM.*.hitsAdd` | 当てる行為の 1 体に当てる回数に足す数（連刃 +2 / 重打 −1。下限 1） |
| `TRANSFORM.*.damageMul` | 変形後の行為の威力の倍率（1 = 等倍） |
| `TRANSFORM.*.shotCountAdd` | 弾の行為の弾の数に足す数 |
| `TRANSFORM.*.areaMul` | 扇・円・引き寄せの届き / 半径の倍率（重打） |
| `TRANSFORM.*.poiseMul` | 当てる行為の基礎怯み値の倍率（重打。ArtAct.poiseMul に掛ける） |
| `TRANSFORM.*.dashDistanceMul` | 踏み込み（dash）の距離の倍率 |
| `TRANSFORM.*.bleedStacks` | 当てる行為に足す出血の重ね（刃斧） |
| `TRANSFORM.*.bleedDuration` | 足す出血の持続（秒） |
| `TRANSFORM.*.bleedPotency` | 足す出血の効果量（既存の出血の目安 1） |
| `TRANSFORM.*.vsMulMul` | 出血を狙う行為（vs が bleed）の vsMul に掛ける倍率 |
| `TRANSFORM.*.arcLineLengthMul` | 扇を帯に変えるときの帯の長さ（扇の届き × この倍率。長柄） |
| `TRANSFORM.*.arcLineWidth` | 扇を帯に変えるときの帯の幅（px） |
| `TRANSFORM.*.lengthMul` | 帯（line）の長さの倍率 |
| `TRANSFORM.*.pullRadius` | 鎖が最初の範囲の行為の前に挟む引き寄せの半径（px） |
| `TRANSFORM.*.pullTo` | 引き寄せた敵を起点からこの距離まで寄せる（px） |
| `TRANSFORM.*.knockbackMul` | 当てる行為（扇は扇・円だけ）のノックバックの倍率 |
| `TRANSFORM.*.invulnAdd` | 踏み込み・自己強化の無敵に足す秒（盾） |
| `TRANSFORM.*.shotSpreadDeg` | 扇の型で弾を増やすとき、元が 1 本（間隔 0°）なら使う隣り合う間隔（度） |
| `TRANSFORM.*.plainMul` | 杖の型で、装備の武器が無属性のときの威力の倍率（属性があれば攻撃の属性を武器の属性にする） |
| `TRANSFORM.*.statusStacksAdd` | 付ける状態異常の重ねに足す数（杖） |
| `TRANSFORM.*.shotRadiusMul` | 弾の当たりの半径の倍率 |
| `TRANSFORM.*.shotSpeedMul` | 元からの弾の速さの倍率 |
| `TRANSFORM.*.arcShotCount` | 扇を弾に変えるときの弾の数 |
| `TRANSFORM.*.arcShotSpreadDeg` | 扇を弾に変えるときの隣り合う間隔（度） |
| `TRANSFORM.*.arcShotPierce` | 扇を弾に変えた弾が追加で抜ける敵の数 |
| `TRANSFORM.*.lineShotPierce` | 帯を弾に変えた弾が追加で抜ける敵の数 |
| `TRANSFORM.*.shotSpeed` | 振りを変えた弾の速さ（px/秒） |
| `TRANSFORM.*.shotLife` | 振りを変えた弾の寿命（秒） |
| `TRANSFORM.*.shotRadius` | 振りを変えた弾の当たりの半径（px） |
| `TRANSFORM.*.lineShotCount` | 帯を弾に変えるときの弾の数 |
| `TRANSFORM.*.lineShotSpreadDeg` | 帯を弾に変えるときの隣り合う間隔（度） |
| `TRANSFORM.*.shotPierce` | 振りを変えた弾が追加で抜ける敵の数（長銃） |
| `TRANSFORM.*.shotPierceAdd` | 元からの弾が追加で抜ける敵の数に足す数（長銃） |
| `TRANSFORM.*.ringFromReachMul` | 扇・自分の周りの円を照準地点の円に変えるときの半径（扇の届き / 円の半径 × この倍率。砲） |
| `TRANSFORM.*.shotRingRadius` | 弾を照準地点の円に変えるときの半径（px） |
| `TRANSFORM.*.shotCountFold` | 弾を 1 つの円に畳むときの威力の上乗せ（1 + (弾の数 − 1) × この値） |
| `TRANSFORM.*.delayAdd` | 照準地点の円に変えた行為の遅れに足す秒 |
| `TRANSFORM.*.echoDelay` | 鈴の型で、当てる円の写しが元の円から遅れて鳴る秒 |
| `TRANSFORM.*.echoMul` | 写しの威力の倍率 |

## skills/STONE_TUNING

スキル石の個体差と処分（docs/ideas/skill-stone-hunt.md）。

| 項目 | 意味 |
| --- | --- |
| `dwellChanceMin` | 深度 1 で拾った石に宿り符が付く確率（0〜1）。目安 0.005〜0.02 |
| `dwellChanceMax` | dwellCapDepth 以降の確率（0〜1）。間は深度で直線に上がる。目安 0.03〜0.08 |
| `dwellCapDepth` | 確率が最大に届く深度。目安 15〜25 |
| `shatterUmbra` | 石を 1 つ処分したときに得る冥響（宿り符なし）。個 |
| `shatterUmbraDwell` | 宿り符のある石を処分したときに得る冥響。個 |
| `pourShare` | 注ぎで装着中の石へ移す使い込み（発動数・命中数）の割合（0〜1）。遺物の注ぎ（来歴の半分）と同じ 0.5 |
| `dwellColor` | 宿り符の表示色（書付・候補の札・床の石の札） |

## boons/BOON

| 項目 | 意味 |
| --- | --- |
| `choiceCount` | （未記入） |
| `cursedChance` | （未記入） |
| `inputDelay` | （未記入） |
| `tagBonus` | （未記入） |
| `cursedColor` | （未記入） |
| `waveSpeed` | （未記入） |
| `waveLife` | （未記入） |
| `waveRadius` | （未記入） |
| `wavePierce` | （未記入） |
| `waveColor` | （未記入） |
| `guardColor` | （未記入） |
| `shatterShards` | （未記入） |
| `shatterSpeed` | （未記入） |
| `shatterLife` | （未記入） |
| `shatterColor` | （未記入） |
| `bloodManaHpRatio` | （未記入） |
| `bloodManaCostMul` | （未記入） |
| `choiceCountWithCurse` | （未記入） |
| `givesTagBonus` | （未記入） |
| `affinityWeightMul` | （未記入） |
| `passCutReach` | （未記入） |
| `passCutRatio` | （未記入） |
| `passCutPoise` | （未記入） |
| `eclipseWindow` | （未記入） |
| `eclipseMinSlots` | （未記入） |
| `ruleTextColor` | （未記入） |
| `ruleTerrainRadius` | （未記入） |
| `ruleDashRefillText` | （未記入） |
| `ruleTextScale` | （未記入） |
| `ruleTextLife` | （未記入） |
| `ruleMinIcd` | （未記入） |
| `ruleCoinShot.speed` | 投銭（Rule 効果 coinShot）の銭の弾の速さ。px/秒 |
| `ruleCoinShot.life` | 投銭の銭の弾の寿命。秒 |
| `ruleCoinShot.radius` | 投銭の銭の弾の当たりの半径。px |
| `ruleCoinShot.color` | 投銭の銭の弾の色 |
| `roamerKillMemory` | （未記入） |
| `gradeMagnitudeMul` | 格（並・大祝福・神威・至高・極致）ごとの効果量の倍率の列。添字 = 格 − 1。至高・極致は錬磨でだけ届く |
| `gradeRadiusMul` | 格ごとの半径の倍率の列。添字 = 格 − 1 |
| `gradeIcdMul` | 格ごとの ICD の倍率の列（direct の Rule には掛けず、ruleMinIcd を下限に残す）。添字 = 格 − 1 |
| `gradeGrandBase` | （未記入） |
| `gradeGrandPerDepth` | （未記入） |
| `gradeGrandMax` | （未記入） |
| `gradeDivineBase` | （未記入） |
| `gradeDivinePerDepth` | （未記入） |
| `gradeDivineMax` | （未記入） |
| `gradeBoostChallenge` | （未記入） |
| `gradeBoostAfterBoss` | （未記入） |
| `gradeBoostCurseCard` | （未記入） |
| `gradeBoostTrialSeeker` | （未記入） |
| `gradeColor.grand` | （未記入） |
| `gradeColor.divine` | （未記入） |
| `gradeColor.supreme` | （未記入） |
| `gradeColor.pinnacle` | （未記入） |
| `graceSlots` | 加護の枠: 1 つの行動（左 / 右 / ダッシュ / スキル / 奥義）に宿せる加護の枚数。枚 |
| `graceSlotsMax` | 加護の枠の上限（昇華で開く 3 枠目を含む）。枚 |
| `baseWeight` | 札の種類を持たない祝福（呪い付き・芯）と真髄の、系譜を問わない提示での抽選の重み（加護・摂理・研鑽・融合は cardWeight） |
| `cardWeight` | 札の種類ごとの抽選の重み（加護 / 摂理 / 研鑽。融合は摂理として数える）。系譜の提示では真髄・融合は確定枠でだけ出る |
| `graceFreeMul` | 系譜の提示で、その行動の枠に空きがある加護の重みに掛ける倍率 |
| `cardColor.grace` | （未記入） |
| `cardColor.law` | （未記入） |
| `cardColor.temper` | （未記入） |
| `cardColor.apex` | （未記入） |
| `apexMinCards` | 昇華が次の系譜の提示の 1 枚目に確定で入る、その系譜の札（融合を含む）の枚数。枚 |
| `temperOfferCount` | 錬磨の提示に並べる札の上限（格を上げられる札が少なければ全部）。枚 |
| `coreDepth` | （未記入） |
| `coreChoiceCount` | （未記入） |
| `coreTagBonus` | （未記入） |
| `curseEaterGradeShiftPerCurse` | （未記入） |
| `curseEaterMaxShift` | （未記入） |
| `tempoPerStack` | （未記入） |
| `tempoCap` | （未記入） |
| `tempoWindowMul` | （未記入） |
| `bloodLoopLifeOnHit` | （未記入） |
| `mirageCharges` | （未記入） |
| `mirageCooldownMul` | （未記入） |
| `mirageBlastRatio` | （未記入） |
| `mirageBlastRadius` | （未記入） |
| `mirageMoveMul` | （未記入） |
| `glassDamageMore` | 芯 硝子の刃: 与ダメージの倍（more。1.3 = ×1.3）。全タグに掛かる |
| `glassDamageTakenMul` | 硝子の刃の代償: 被ダメージの倍率（damageTakenMul に掛ける） |
| `heavyPoiseMul` | 芯 重心: 敵への怯み値の倍率（poiseDamageMul に掛ける） |
| `heavyKnockbackMul` | 重心: ノックバックの倍率（knockbackMul に掛ける） |
| `heavyAttackSpeedMul` | 重心の代償: 攻撃速度の倍率（attackSpeedMul に掛ける） |
| `wellspringMana` | 芯 気の泉: 最大気力への加算。気力 |
| `wellspringManaGainMul` | 気の泉: 気力の獲得の倍率（manaGainMul に掛ける） |
| `wellspringHpMul` | 気の泉の代償: 最大生命の倍率（maxHp に掛ける。最小 1 に丸める） |
| `greedCoinGainMul` | 芯 銭の亡者: 銭の獲得の倍率（coinGainMul に掛ける） |
| `greedMagnetMul` | 銭の亡者: 銭・鍵を引き寄せる半径の倍率（coinMagnetMul に掛ける） |
| `greedSpillMul` | 銭の亡者の代償: 被弾でこぼれる銭の倍率（coinSpillMul に掛ける） |

## boons/LINEAGE

系譜の札の数値（docs/ideas/boon-impl.md 2-6。

| 項目 | 意味 |
| --- | --- |
| `ash.*.dpsRatio` | 付ける燃焼の強さ（毎秒のダメージ）。近接 1 段目の威力に掛ける割合（0..1）。装備の燃焼の強さ（burnDps）の方が強ければそちら。格で伸びる。目安 0.3〜0.5 |
| `*.*.duration` | 付ける状態異常・置く地形の持続。秒 |
| `ash.*.radius` | 効果の半径（爆発・広げる・置く地形）。px（10px = 1m）。格で広がる |
| `ash.*.increased` | 増。0.1 = +10% |
| `*.*.ratio` | ダメージ。近接 1 段目の威力に掛ける割合。格で伸びる |
| `*.*.icd` | Rule の内部 CD。秒（BOON.ruleMinIcd が下限） |
| `ash.*.detonateMul` | 起爆の倍率。燃焼の強さ × 残り秒 × これを即時に与える。格で伸びる。目安 1.5 |
| `ash.*.potency` | 広げる燃焼の強さの倍率（元の強さ × これ）。格で伸びる。1 = そのまま |
| `*.*.every` | 研鑽の数えの何回で 1 段か（回） |
| `ash.*.perStep` | 研鑽 1 段あたりの量（倍なら 0.01 = ×1.01 ずつ、状態異常の強さなら 0.02 = +2%） |
| `ash.*.stackMore` | 燃焼の重ね 1 につき与ダメに掛かる倍の上乗せ（0.04 = 重ね 5 で ×1.2） |
| `frost.*.slow` | 付ける冷気の遅さの下限（0..1。冷気は 1 重ねにつき STATUS.chill.slowPerStack の遅さで、これより大きければこちら）。格で伸びる |
| `frost.*.stacks` | 付ける冷気の重ね（回）。重ねが STATUS.chill.maxStacks に届くと凍結に変わる |
| `frost.*.radius` | 効果の半径（範囲・移す・置く地形）。px（10px = 1m）。格で広がる |
| `frost.*.chillRadius` | ダッシュの終わりに冷気を付ける半径。px（10px = 1m）。格で広がる |
| `frost.*.window` | スキルの命中と砕きを同じ一撃とみなす窓。秒（1 ステップ以上） |
| `frost.*.shards` | 氷の破片の数（全方位へ等間隔） |
| `frost.*.perStep` | 研鑽 1 段あたりの量（倍なら 0.01 = ×1.01 ずつ、増なら 0.03 = +3%） |
| `frost.*.releaseMul` | 氷獄の溜めを出す倍率（溜めた傷 × これ）。格で伸びる |
| `thunder.*.ratio` | 連鎖する雷・追撃のダメージ。近接 1 段目の威力に掛ける割合。格で伸びる |
| `thunder.*.shockRatio` | 付ける感電の強さ（感電の連鎖のダメージ）。近接 1 段目の威力に掛ける割合。装備の感電の強さ（shockDamage）の方が強ければそちら。格で伸びる |
| `thunder.*.stacks` | 付ける感電の重ね（回）。重ねが STATUS.shock.maxStacks に届くと麻痺に変わる |
| `thunder.*.duration` | 付ける感電の持続。秒 |
| `thunder.*.radius` | 範囲の半径。px（10px = 1m）。格で広がる |
| `thunder.*.critRatio` | 会心の一撃のダメージに掛ける割合（会心雷撃の連鎖する雷の 1 回のダメージ）。格で伸びる |
| `thunder.*.perStep` | 研鑽 1 段あたりの量（連鎖係数なら 0.02 = +2%、倍なら 0.01 = ×1.01 ずつ） |
| `thunder.*.revisits` | 連鎖が同じ敵へ戻れる回数に足す数（還雷。1 以上で連鎖する雷が最後の敵から来た道を戻る） |
| `moon.*.duration` | 付ける状態異常（宣告・出血・脆弱）の秒 |
| `*.*.waveRatio` | 照準方向へ貫通する衝撃波の威力（近接 1 段目の威力 × この値） |
| `moon.*.selfBleed` | 代償として自分に付く出血の強さ（動いた 10px ごとに減る生命。格の倍率が掛かる） |
| `moon.*.selfBleedTime` | 代償の出血の秒 |
| `*.*.radius` | 範囲の半径（px。10px = 1m） |
| `moon.*.bleedPotency` | 付ける出血の強さ（動いた 10px ごとのダメージ） |
| `moon.*.color` | 範囲・溜めを出す時の輪の色 |
| `moon.*.mana` | 戻る気力 |
| `moon.*.heal` | 回復する生命（戦闘中の回復の上限を通さない） |
| `moon.*.delay` | 受けた傷が遅れて来るまでの秒 |
| `*.*.amount` | 研鑽の 1 段あたりの倍（0.01 = +1%） |
| `moon.*.echoRatio` | 宣告が明けた時にもう一度来る傷（宣告の間に与えた傷 × この値。宣告そのものの割合 STATUS.doom.ratio とは別に来る） |
| `earth.*.poise` | 与える怯み値 |
| `earth.*.knockMul` | 放出の一撃の吹き飛ばしの倍率（壁叩きつけが起きる強さにする） |
| `*.*.strikeRatio` | 追撃の威力（近接 1 段目の威力 × この値） |
| `earth.*.window` | 放出から壁叩きつけの追撃が出る秒 |
| `earth.*.duration` | 付ける状態・地形の秒 |
| `earth.*.wrathStacks` | 自分に付く怒気の数（1 つにつき怯み値 +STATUS.wrath.poisePerStack）。STATUS.wrath.maxStacks に届くと激昂に昇華するので、それより 1 少なく |
| `earth.*.nearMul` | 自分から radius 以内の敵への与ダメの倍 |
| `earth.*.farMul` | radius より遠い敵への与ダメの倍（1 未満 = 下がる） |
| `earth.*.waveRatio` | 撃破した位置の衝撃波の威力（近接 1 段目の威力 × この値） |
| `earth.*.staggerTime` | 周りの敵を怯ませる秒 |
| `blade.*.window` | 奥義の後に分身の追撃が続く秒 |
| `blade.*.every` | 研鑽の段・連撃波の間隔: 数えがいくつで 1 段か |
| `blade.*.amount` | 研鑽の 1 段あたりの増（0.01 = +1%） |
| `blade.*.max` | 分身の追撃の上限（段の数） |
| `blade.*.windowBonus` | コンボの猶予に足す秒（実質、時間では切れない） |
| `cycle.*.ratio` | 効果量の倍率。満気は近接 1 段目の威力に掛ける割合（気の波のダメージ）、流転は払った気力 ÷ 最大気力に掛ける倍率（1 = 最大気力ぶん払えば次の発動が ×2） |
| `cycle.*.manaRatio` | 月読: 応手で戻す気力。最大気力に対する割合（0.25 = 25%） |
| `cycle.*.refresh` | 月読: 応手で戻す再使用時間。全長に対する割合（0.2 = 20%） |
| `cycle.*.echoMul` | 新月: ダッシュの終わりに撃ち直す直前のスキルの威力の倍率 |
| `cycle.*.mana` | 循環: スキルの命中 1 回で戻す気力の量 |
| `cycle.*.per` | 詠: 1 段で足す最大気力 |
| `cycle.*.every` | 研鑽の 1 段に要る数え（詠 = スキルの発動の回数 / 還 = スキルの命中の回数） |
| `cycle.*.amount` | 還: 1 段あたりのスキルの与ダメの増（0.01 = +1%） |
| `cycle.*.cap` | 流転: 次の発動に掛かる倍の上限（1 = 最大 ×2） |
| `horde.*.duration` | 効果の続く秒（采配 = 狙いを向ける秒 / 従魔・百鬼 = 従える秒）。秒 |
| `horde.*.ratio` | 近接 1 段目の威力に掛ける割合（供物の爆発 / 十字砲火の線の傷） |
| `horde.*.count` | 供物 = 一度に爆ぜさせる設置物の数 / 従魔・百鬼 = 同時に従える敵の上限。体 |
| `horde.*.ringRadius` | 歩く杭: 設置物が足元へ移ったときの輪の半径（見た目だけ）。px |
| `horde.*.color` | 見た目の色（十字砲火 = 線 / 歩く杭 = 移った設置物の輪） |
| `horde.*.fxLife` | 見た目の寿命（十字砲火 = 線 / 歩く杭 = 輪）。秒 |
| `horde.*.interval` | 十字砲火 = 線が傷を与える間隔 / 従魔の AI = 殴る間隔。秒 |
| `horde.*.maxLength` | 十字砲火: 線で結ぶ設置物どうしの距離の上限。px |
| `horde.*.width` | 十字砲火: 線の太さ（敵の半径に足す当たりの幅）。px |
| `horde.*.amount` | 頭領 = 従魔・設置物 1 つにつき与ダメの増（0.04 = +4%）/ 群 = 1 段につき従魔の与ダメの倍に足す量（0.05 = ×1.05）/ 杭 = 1 段につきスキルの与ダメの増 |
| `horde.*.every` | 1 段に要る数（頭領 = 従魔・設置物の数 / 群 = 従えた数の最高 / 杭 = スキルを撃つたびに数える場の設置物・従魔の数の合計） |
| `horde.*.cap` | 頭領: 与ダメの増の上限（0.4 = +40%） |
| `horde.*.reach` | 従魔の AI: 殴る間合い（自分と相手の半径の和に足す）。px |
| `horde.*.damageMul` | 従魔の AI: 1 撃のダメージ = 敵の接触ダメージ（深度補正込み）× この倍率 |
| `horde.*.minDamage` | 従魔の AI: 1 撃のダメージの下限（接触ダメージを持たない敵も殴れるように） |
| `horde.*.speedMul` | 従魔の AI: 敵の足の速さに掛ける倍率 |
| `horde.*.seekRange` | 従魔の AI: 狙う敵を探す距離の上限。px |
| `horde.*.knockback` | 従魔の AI: 殴った相手を押す強さ |
| `wealth.*.coins` | 得る銭（銭吐き = 1 回 / 掏り = 近くの敵 1 体につき）。銭 |
| `wealth.*.share` | 持ち金のうち払う割合（投銭）。0..1 |
| `wealth.*.perCoin` | 払った銭 1 につきのダメージ（投銭の弾 / 散財の爆発） |
| `wealth.*.radius` | 効果の半径（掏り = 銭を掠め取る敵の距離 / 散財 = 爆発）。px |
| `wealth.*.cost` | 銭払い: スキル 1 回に払う銭 |
| `wealth.*.mana` | 銭払い: 払った銭で戻す気力 |
| `wealth.*.every` | 1 段に要る数（守銭 = 持ち金 / 稼 = 稼いだ総額 / 散 = 使った総額）。銭 |
| `wealth.*.perStep` | 守銭: 1 段につき与ダメの増（0.01 = +1%） |
| `wealth.*.cap` | 守銭: 与ダメの増の上限（0.25 = +25%） |
| `wealth.*.pct` | 拾銭: 銭を拾ったときの移動速度の増。% |
| `wealth.*.time` | 拾銭: 移動速度の増が続く秒。秒 |
| `wealth.*.ratio` | 戻り銭: こぼれた銭のうち自分へ戻る割合 |
| `wealth.*.amount` | 稼 = 1 段につき与ダメの増 / 散・黄金律 = 1 段につき与ダメの倍に足す量（0.01 = ×1.01） |
| `wealth.*.base` | 黄金律: 倍が 1 段目に上がる持ち金（以後 2 倍ごとに 1 段）。銭 |
| `wealth.*.spillShare` | 黄金律: 被弾でこぼれた後、さらに撒く持ち金の割合（こぼれる量をおよそ倍にする） |
| `fusion.*.ratio` | 近接 1 段目の威力に掛ける割合（雷火・迅雷 = 連鎖雷 / 返し打ち = 追撃） |
| `fusion.*.count` | 同時に従える敵の上限。体 |
| `fusion.*.duration` | 従える秒 / 付ける状態異常の秒。秒 |
| `fusion.*.window` | 直前の出来事からの窓（返し打ち = 応手から / 磐石 = 被弾から）。秒 |
| `fusion.*.poise` | 返し打ち: 追撃で入れる怯み値 |
| `fusion.*.combo` | この数以上のコンボで起きる（影群 / 迅雷） |
| `fusion.*.hpRatio` | 磐石: 壁叩きつけの追撃のダメージ。最大生命に対する割合 |
| `fusion.*.burn` | 寒熱: 周りへ付ける燃焼の強さ（毎秒のダメージ） |
| `fusion.*.chill` | 寒熱: 周りへ付ける冷気の強さ（減速） |
| `fusion.*.manaPerCoin` | 両替: 拾った銭 1 につき戻す気力 |
| `fusion.*.coins` | 得る銭（豪遊 = 終撃 1 回）。銭 |
| `fusion.*.cost` | 払う銭（豪遊 = 弾にする銭 / 買収 = 1 体を従える銭）。銭 |
| `fusion.*.perCoin` | 豪遊: 弾にした銭 1 につきのダメージ |
| `cursed.bloodSoil.energy` | 奥義ゲージの量 |
| `cursed.bloodSoil.bleed` | 代償の出血の強さ |
| `cursed.bloodSoil.bleedTime` | 代償の出血の秒。秒 |
| `cursed.singleMind.mainMul` | 一念: 持っている札の系譜が 1 つだけのときの与ダメの倍 |
| `cursed.singleMind.otherMul` | 一念: 系譜が 2 つ以上のときの与ダメの倍（代償） |
| `cursed.scorchBlade.burn` | 焦がれ刃: 近接の命中で付ける燃焼の強さ（毎秒のダメージ） |
| `cursed.scorchBlade.selfDps` | 焦がれ刃: 代償で自分が燃える強さ（毎秒のダメージ） |
| `cursed.scorchBlade.selfTime` | 焦がれ刃: 代償で自分が燃える秒。秒 |
| `cursed.scorchBlade.selfIcd` | 焦がれ刃: 代償の内部 CD。秒 |
| `cursed.madBloom.ratio` | 狂い咲き: 衝撃波のダメージ。近接 1 段目の威力に掛ける割合 |
| `cursed.*.weaken` | 代償で自分が弱体する秒。秒 |
| `cursed.heavyOath.poise` | 重き誓い: 溜め斬りに足す怯み値 |
| `cursed.drenched.mana` | 濡れ鼠: 水たまりに踏み込んで戻す気力 |
| `cursed.drenched.wetStacks` | 濡れ鼠: 代償で自分に付く濡れの数 |
| `cursed.drenched.wetTime` | 濡れ鼠: 代償の濡れの秒。秒 |

## loot/_index.json

装備系の数値。

| 項目 | 意味 |
| --- | --- |
| `STASH_CAPACITY` | （未記入） |
| `ARMOR_K` | （未記入） |
| `ARMOR_MAX_REDUCTION` | （未記入） |

## loot/LOOT_DROP

装備ドロップ（system/loot.ts）。

| 項目 | 意味 |
| --- | --- |
| `depthChanceBonus` | （未記入） |
| `mobDropMulByDepth` | （未記入） |
| `roamingDropMul` | （未記入） |
| `eliteDropMul` | （未記入） |
| `roomClearChanceByDepth` | （未記入） |
| `depthArrivalChance` | （未記入） |
| `itemLevelSpread` | （未記入） |
| `rarityBoostPerDepth` | （未記入） |
| `roomClearRarityBoost` | （未記入） |
| `depthArrivalRarityBoost` | （未記入） |
| `scatter` | （未記入） |
| `arrivalOffset` | （未記入） |

## loot/PICKUP

| 項目 | 意味 |
| --- | --- |
| `focusRadius` | （未記入） |
| `reach` | （未記入） |

## loot/RESONANCE

源と糧の共鳴（system/resonance.ts）。

| 項目 | 意味 |
| --- | --- |
| `minSources` | 1 段に要る源の数 |
| `minSinks` | 1 段に要る糧の数 |
| `stepEvery` | 源 + 糧がこの数ふえるごとに +1 段 |
| `amplifyStep` | 強め 1 つで足す段 |
| `maxSteps` | 段の上限 |
| `stepMul` | 1 段の倍（more = 1 + (stepMul − 1) × 段） |
| `ringEaseMax` | 双頭の指輪が 1 段で成立させる系統の数の上限（あと 1 つで揃う系統。implicit の値 1〜2 を読み、旧セーブの遺物の値 2〜4 もここで切る）。系統 |
| `statPerStep` | 倍の無い系統が 1 段で stats に足す量（dash / ward は倍率を下げる割合） |

## loot/REACH

厳選の到達点（loot/reach.ts）。

| 項目 | 意味 |
| --- | --- |
| `chain` | 無尽の閾値。装備の連鎖係数の合計（1 = +100%）。目安 0.6〜1 |
| `burn` | 燎原の閾値。装備の燃焼の重ねの上限の加算。目安 5〜9 |
| `morale` | 常在の閾値。装備の戦意の上限の加算。目安 25〜40 |

## loot/KEYSTONE

誓約（旧キーストーン）の数値（loot/affixes.ts の KEYSTONES と system/keystones.ts が読む。

| 項目 | 意味 |
| --- | --- |
| `blinkRadius` | （未記入） |
| `blinkDamage` | （未記入） |
| `blinkColor` | （未記入） |
| `gamblerMin` | （未記入） |
| `gamblerMax` | （未記入） |
| `vampireLeechPct` | （未記入） |
| `overdrawHpPerMana` | （未記入） |
| `overdrawMinHp` | （未記入） |
| `unshakenDamageBonus` | （未記入） |
| `unshakenPoiseToDamage` | （未記入） |
| `readPoiseMul` | （未記入） |
| `readOffWindupDamageMul` | （未記入） |
| `chantAttackDamageMul` | （未記入） |
| `chantManaMul` | （未記入） |
| `chantSkillBonus` | （未記入） |
| `contagionDamageMul` | （未記入） |
| `contagionRadius` | （未記入） |
| `pacifistMercyHp` | （未記入） |
| `pacifistPoiseMul` | （未記入） |
| `bladeOathRangePx` | （未記入） |
| `bladeOathNearMul` | （未記入） |
| `bladeOathFarMul` | （未記入） |
| `bladeOathAttackSpeedBonus` | （未記入） |
| `mushinIdleSec` | 虚心: 攻撃を当てずにこの秒がたつと、次の 1 撃が倍になる。秒 |
| `mushinMul` | 虚心: 溜めた 1 撃の与ダメージの倍。倍率 |
| `instantRadius` | 刹那: 見切りの瞬間に凍らせる範囲の半径。px |
| `instantSec` | 刹那: 凍結の秒。秒 |
| `farOathRangePx` | 遠間の誓い: 近い / 遠いの境目。px |
| `farOathNearMul` | 遠間の誓い: 境目以内の敵への与ダメージの倍。倍率 |
| `farOathFarMul` | 遠間の誓い: 境目より遠い敵への与ダメージの倍。倍率 |
| `povertyManaPerCoin` | 清貧: 拾った銭 1 につき得る気力。気力 |
| `povertyIncreased` | 清貧: 与ダメージの増。割合（0.3 = +30%） |
| `goldCageEvery` | 黄金の檻: 与ダメージの倍を 1 段上げる持ち金。銭 |
| `goldCageMul` | 黄金の檻: 1 段あたりの与ダメージの倍（段は足し合わせ）。倍率 |
| `goldCageCap` | 黄金の檻: 段の合計の上限（1 を超える分。0.75 = 最大 ×1.75。持ち金 500 で頭打ち）。段取り 7e で上限を付けた（銭を貯め続けると際限なく伸びるため）。倍率の 1 を超える分 |
| `goldCageSpillRatio` | 黄金の檻: 被弾でこぼれる持ち金の割合（ECONOMY.spill.ratio の代わり）。割合（0..1） |
| `almsHealPerCoin` | 喜捨: 払った銭 1 につき回復する生命。生命 |
| `almsBuffSec` | 喜捨: 銭を払った後の与ダメージの強化の秒。秒 |
| `almsBuffPct` | 喜捨: 銭を払った後の与ダメージの強化。% |
| `breathOathEvadeMul` | 呼気の誓い: 見切り・受け流しで戻る気力に掛ける倍率（通常攻撃の命中・撃破では戻らない）。倍率 |
| `breathOathMaxManaPct` | 呼気の誓い: 最大気力の上乗せ。割合（0.5 = +50%） |
| `brimOathPerTenth` | 満願の誓い: 今の気力が最大の 1 割あるごとに、全ての与ダメージの倍に足す量（満タンで 10 段）。倍率の 1 を超える分 |
| `brimOathCostMul` | 満願の誓い: スキルの気力の消費に掛ける倍率。倍率 |

## loot/RELIC

名のある遺物の固有の数値（loot/named.ts の UniqueDef と system/namedRelics.ts が読む。

| 項目 | 意味 |
| --- | --- |
| `*.step` | 双頭の蛇: 左右を交互に当てて双撃が出るたび、与ダメージの倍に足す量（×(1 + min(cap, step × 回数))。同じ側を続けると回数 0）。倍率 |
| `*.cap` | 双頭の蛇: step × 回数の上限（0.75 = 最大 ×1.75。25 回で頭打ち）。段取り 7e で上限を付けた（際限なく伸びる倍を避ける）。倍率の 1 を超える分 |
| `*.delay` | 逆さ砂時計: 受けたダメージが遅れて来るまでの秒（その間に敵を倒すと古い 1 つが帳消し）。秒 |
| `*.radius` | 群れ呼びの笛: 処刑した位置から、怯んだ敵を従える半径。px |
| `*.count` | 群れ呼びの笛: 同時に従えられる数の上限。体 |
| `*.duration` | 群れ呼びの笛: 従える秒。秒 |
| `*.mul` | 空の鞘: 乗せる威力（近接 1 段目の威力 × mul）。倍率 |
| `*.chanceMul` | 重ねの首飾り: 自分が命中で付ける状態異常の確率に掛ける倍率（燃焼・冷気・感電・装備の状態異常）。倍率 |
| `*.stacks` | 重ねの首飾り: 自分が付ける燃焼・毒・出血の 1 回の重ね（付与の重ねがこれより少なければこれに上げる）。重ね |
| `*.more` | 星読みの眼: 予備動作中の敵への与ダメージの倍。倍率 |
| `*.leadSec` | 星読みの眼: 予告の線に描く残り秒の目盛りの長さ（残りがこれ以下で目盛りが敵へ寄る）。描画だけ。秒 |
| `*.every` | 鐘の舌: 周囲を一掃する終撃の回数（この回数目で鳴り、数え直す）。回 |
| `*.missingTenths` | 起死の鱗: 発動する失った生命の 10% の数（7 = 生命が 3 割以下）。個 |
| `*.freezeSec` | 起死の鱗: 周りの敵を凍結させる秒。秒 |
| `*.wardSec` | 起死の鱗: 自分の無敵の秒。秒 |
| `*.coins` | 打ち出の小槌: 終撃が当たるたびに得る銭。銭 |
| `*.icd` | 打ち出の小槌: 銭が出る最短の間隔（多段の終撃で出すぎないように）。秒 |
| `*.hpRatio` | 六文銭: 蘇ったときの生命（最大生命に対する割合）。割合（0..1） |
| `*.minCoins` | 六文銭: 蘇るのに要る持ち金の下限。銭 |
| `*.magnetMul` | 招き猫: 銭の引き寄せの半径の倍率。倍率 |
| `*.gainMul` | 招き猫: 稼ぐ銭の倍率（1.3 = +30%）。倍率 |
| `*.spillMul` | 招き猫: 被弾でこぼれる銭の倍率。倍率 |
| `*.perStep` | 欲の皮: 持ち金 every につき減らす被ダメージの割合。割合（0..1） |
| `*.share` | 身代わり地蔵: 被弾のうち銭で受ける割合。割合（0..1） |
| `*.hpPerCoin` | 身代わり地蔵: 銭 1 で受ける生命。生命 |
| `*.faces` | 賽の目の指輪: 賽の目の数（1 近接 / 2 射撃 / 3 スキル / 4 継続 / 5 奥義 / 6 全部）。個 |
| `*.tagMul` | 賽の目の指輪: 出た目の種類（近接・射撃・スキル・継続・奥義）の与ダメージの倍。倍率 |
| `*.allMul` | 賽の目の指輪: 6 の目（全部）の与ダメージの倍。倍率 |
| `*.reach` | 骸の冠: 死骸を踏んだとみなす距離（自分の中心から）。px |
| `*.margin` | 無地の刃: 生成時の余白（器の容量 5 を超えない）。個 |

## loot/TRIGGER

| 項目 | 意味 |
| --- | --- |
| `icd` | （未記入） |
| `shockwaveRadius` | （未記入） |
| `shockwaveKnockback` | （未記入） |
| `shockwaveColor` | （未記入） |
| `nearbyRadius` | （未記入） |
| `bulletSpeed` | （未記入） |
| `bulletLife` | （未記入） |
| `bulletColor` | （未記入） |
| `comboThreshold` | （未記入） |
| `percent` | （未記入） |
| `defaultDuration` | （未記入） |
| `invulnMax` | （未記入） |
| `manaLowRatio` | （未記入） |
| `multiStatusKinds` | （未記入） |
| `extendMax` | （未記入） |
| `volleySpread` | （未記入） |
| `inflictHaltMax` | （未記入） |
| `inflictBurnDps` | （未記入） |
| `inflictBleed` | （未記入） |
| `inflictShock` | （未記入） |
| `trait.manaShieldMul` | （未記入） |
| `trait.manaShieldColor` | （未記入） |
| `trait.staggerQuakeRadius` | （未記入） |
| `trait.wedgeRatio` | （未記入） |
| `trait.minMul` | （未記入） |
| `trait.comboBreakMin` | （未記入） |
| `trait.comboBreakCap` | （未記入） |
| `trait.stakeMax` | （未記入） |
| `trait.stakeColor` | （未記入） |
| `trait.inheritDuration` | （未記入） |
| `trait.lowHpRatio` | （未記入） |
| `trait.spreadCloseRange` | （未記入） |
| `trait.alternateWindow` | （未記入） |
| `trait.terrainBlastRadius` | （未記入） |
| `trait.terrainBlastStatusSec` | （未記入） |
| `trait.terrainBlastIcd` | （未記入） |
| `trait.burningKillFireRadius` | （未記入） |
| `trait.iceTrailRadius` | （未記入） |
| `trait.rapidBrandSec` | （未記入） |
| `trait.elementMinMul` | （未記入） |
| `trait.momentWindowSec` | 応手・双撃・先制の後に条件の族の増が効く窓。秒 |
| `trait.moraleEvery` | 性質「戦意 N につき」の N。戦意 |
| `trait.comboEvery` | 性質「コンボ N につき」の N。コンボ数 |
| `trait.speedToDamageCap` | 転じ「移動速度 → 与ダメージ」の増の上限。割合（0.5 = +50%） |
| `trait.manaPerProjectile` | 転じ「最大気力 → 弾数」で弾 1 本に換える最大気力。気力 |
| `trait.manaToProjectileRegenMul` | 転じ「最大気力 → 弾数」の代償: 気力自然回復に掛ける倍。倍率 |
| `trait.coinsPerMoreStep` | 転じ「持ち金 → 倍」で 1 段と数える持ち金。銭 |
| `trait.coinsMoreCap` | 転じ「持ち金 → 倍」の上限（倍の 1 を超える分）。割合 |
| `trait.critRuleIcd` | 転じ「会心時: 〜」の Rule の内部クールダウン。秒 |
| `trait.armorPerPoiseStep` | 転じ「防御力 → 怯み値」で 1 段と数える防御力。防御力 |
| `trait.lifePerAreaStep` | 転じ「最大生命 → 範囲攻撃」で 1 段と数える最大生命。生命 |

## loot/SYNERGY

統一ルール（Rule）の照合と連鎖の止め方（docs/ideas/scaling-impl.md 2-7）。

| 項目 | 意味 |
| --- | --- |
| `maxDepth` | 連鎖の深さの上限。この深さ以上のイベントは Rule を照合しない（性能の保険。連鎖は訪問回数と連鎖係数で先に止まる）。visits の長さもこれで切る。目安 8 |
| `recentWindow` | 条件 recent と直近の記録で「続けて起きた」とみなす窓。秒。目安 3 |
| `keywordBudget` | 系統ごとの回数上限。1 系統が keywordWindow 秒に起こせる Rule の回数（direct は数えない）。目安 6〜12 |
| `keywordWindow` | keywordBudget を数える窓。秒。目安 1 |
| `defaultIcd` | Rule の内部 CD の既定として置いた値。秒。今は読む所が無い（Rule は各自の icd を持つ） |
| `lowHpRatio` | 条件 lowHp の閾値。最大生命に対する割合（0..1）。目安 0.5 |
| `chainLog` | UI 用に残す直近の連鎖（state.chains）の件数。目安 8 |
| `maxEventsPerStep` | 1 ステップに積める操作・system 起点のイベントの上限。超えた分は捨てて droppedEvents に数える。目安 256 |
| `maxPendingEvents` | 効果が起こして次ステップへ持ち越すイベントの上限。超えた分は捨てて droppedEvents に数える。目安 64 |
| `procCoefficient` | 効果の種類ごとの連鎖係数（0..1）。その効果が起こしたイベントの連鎖係数に掛かり、次の Rule の確率 = chance × 連鎖係数 ×（1 + chainCoefBonus）になる。表に無い種類と敵を対象にしない効果は 1。RuleEffect.procCoefficient があればそちら。範囲・多段の効果ほど小さく |

## loot/FLUX

性質の揺らぎ（期待値 + 分散）と装備の強さの係数。

| 項目 | 意味 |
| --- | --- |
| `sigma.base` | 揺らぎの幅 σ の深度 0 での値。σ = min(base + perDepth × 深度, max) × (1 + boost × perBoost) |
| `sigma.perDepth` | 深度 1 つごとに広がる σ |
| `sigma.max` | σ の上限（boost 前） |
| `sigma.perBoost` | ドロップ元の boost（ボス・宝物庫など）1 あたりの σ の増加率 |
| `flux.lowScale` | 三角分布の下端（σ に対する倍率）。小さいほど下振れが浅い。σ が上限のとき −lowScale が最悪の値 |
| `flux.highScale` | 三角分布の上端（σ に対する倍率）。σ が上限のとき +highScale（0.8 で期待値の 1.8 倍）が最良の値 |
| `flux.min` | 反転していない性質の flux の下限（値が 0 や負にならないように。−0.4 で期待値の 0.6 倍が底） |
| `flux.maxConversion` | 変換の性質の flux の上限（変換割合が 100% を大きく超えないように） |
| `inversion.minDepth` | 反転（flux < −1 で値が負になる）が起こり始める発見深度 |
| `inversion.baseChance` | 反転の確率の基本（minDepth のとき） |
| `inversion.chancePerDepth` | minDepth より深い階 1 つごとに増える反転の確率 |
| `inversion.maxChance` | 反転の確率の上限 |
| `inversion.magnitudeMin` | 反転したときの \|値\| / 期待値 の下限 |
| `inversion.magnitudeMax` | 反転したときの \|値\| / 期待値 の上限 |
| `class.calmLimit` | 見た目の分類（静 / 揺 / 荒）の境界。\|flux\| の最大がこれ未満なら静 |
| `class.waverLimit` | \|flux\| の最大がこれ未満なら揺、以上なら荒（反転は別に unique） |
| `globalScale` | 生成時の期待値と共鳴・三和音の効果値に全深度で掛ける係数（memo 2026-09-24: 序盤から装備が強すぎる）。期待値の曲線（affixCurves）は触らない |
| `depthScale[]` | 深度ごとの追加の係数（depth / scale の点列を線形補間、範囲外は端の値）。浅い層ほど小さくし、深度 1〜5 の伸びを緩やかにする |

## loot/affixCurves

| 項目 | 意味 |
| --- | --- |
| `*[].depth` | （未記入） |
| `*[].min` | （未記入） |
| `*[].max` | （未記入） |
| `*[].min2` | （未記入） |
| `*[].max2` | （未記入） |

## loot/bases

| 項目 | 意味 |
| --- | --- |
| `` | ベースごとの数値。minLevel はドロップし始める itemLevel、marginBonus は余白の上乗せ（器の容量は超えない） |

## loot/INNATE

【段取り 7e】budget.perDepth 0.35 → 0.9: 段取り 7d で無条件の数値の性質を地金へ移したのに予算が据え置きで、probe の地力 ÷ 敵の生命が深度 10 で 0.55・20 で 0.42 だった（目標 0.…

| 項目 | 意味 |
| --- | --- |
| `` | 地金（装備に既定で宿るステータス・防御力・耐性）の予算と配り方。項目は INNATE/_index.json の _fields |
| `budget` | 予算の期待値と振れ幅。期待値 = (base + perDepth × 深度) × depthScale（深み以降は × ENEMY_SCALE.deepHpGrowth^(深度 − deepDepth)）。抽選は三角分布（下端 = 期待値 × lowScale、頂 = 期待値、上端 = 期待値 × highScale + ドロップ元の boost × boostScale）を四捨五入した点 |
| `budget.base` | 深度 0 での予算の期待値（点） |
| `budget.perDepth` | 深度 1 あたりの予算の期待値の伸び（点） |
| `budget.lowScale` | 三角分布の下端（期待値に掛ける倍率）。lowScale + highScale = 2 で上振れ（抽選値 ÷ 期待値）の平均が 1 になる |
| `budget.highScale` | 三角分布の上端（期待値に掛ける倍率） |
| `budget.boostScale` | ボス・宝物庫などの boost 1 あたり、上端に足す点 |
| `depthScale[]` | 深度ごとの予算の期待値への倍率（線形補間。範囲外は端の値）。序盤を締める |
| `maxLines` | 部位ごとの項目数の上限（防御力の確定行は数えない） |
| `*.armor` | 防具の防御力。base は予算を使わず必ず付く値、perPoint は防御力の枠に配った 1 点あたりの上乗せ（小数 1 桁）。体は高く、指輪・首飾りは低い |
| `extraLineChance` | 項目数を 1 増やす確率（割合 0..1）。予算は同じなので 1 項目の値は薄まる |
| `linesPerPoint` | 予算がこの点に達するごとに項目数の基本値が 1 増える（項目数 = 1 + floor(予算 / これ)） |
| `pointValue` | 1 点あたりの値。attr = ステータス（点）、resist = 属性耐性（%） |
| `armor` | 防具の防御力。base は予算を使わず必ず付く値、perPoint は防御力の枠に配った 1 点あたりの上乗せ（小数 1 桁）。体は高く、指輪・首飾りは低い |
| `leanWeight` | 部位の傾き（slotLean）・武器の主参照のステータスの抽選重み（ほかは 1） |
| `resistWeight` | 属性耐性 1 種あたりの抽選重み |
| `resistLines` | 部位ごとの属性耐性の項目数の上限 |
| `slotLean` | 防具の部位ごとに出やすいステータス（str / dex / vit / mnd / spi / def） |
| `slotLean.*` | 防具の部位ごとに出やすいステータス（str / dex / vit / mnd / spi / def） |
| `weaponLeanTop` | 武器は武器種の全行動の係数の合計が大きい順に、この数のステータスが出やすい |

## loot/BUD

装備の芽（loot/provenance.ts）の育ちの遅さ。

| 項目 | 意味 |
| --- | --- |
| `thresholdScale` | 節目の基準の値に掛ける倍率（1 = 等倍）。key は掛ける前の値のまま。表示と判定は掛けた後の値。目安 1〜20 |
| `perRunPerItem` | 同じ遺物に 1 ランで出す芽の数の上限（個）。上限で止めた節目は到達済みにせず、次のランで芽になる。選ばずに残った前のランの芽は数えない。目安 1〜3 |

## loot/CARRY

ランへの装備の持ち込みと、ランの終わりの持ち帰り（loot/runGear.ts。

| 項目 | 意味 |
| --- | --- |
| `carrySlots` | 拠点の装備から持ち込める部位の数（weaponFree なら右手を除いた数）。個数。目安 2 |
| `weaponFree` | true なら右手（武器）は持ち込みの印に関わらず常に持ち込み、carrySlots に数えない。false なら右手も印で選び、枠に数える |
| `keepOnDeath` | 力尽きた・途中でやめたときに、ラン内で拾った遺物から持ち帰れる数。個数。目安 1 |
| `keepOnClear` | 踏破したときに、ラン内で拾った遺物から持ち帰れる数。個数。目安 3 |

## world/ROOM

| 項目 | 意味 |
| --- | --- |
| `enterMargin` | 部屋に入ったとみなすのに要る、部屋の縁からの食い込み。px。大きいほど奥まで入らないと封鎖しない |
| `baseEnemies` | 特別な部屋・封鎖する部屋の波・ボスの取り巻きに置く敵の抽選回数の基本（通常の部屋は陣で配る。enemies/JIN.json）。抽選回数 = baseEnemies + 切り捨て（深度 × enemiesPerDepth）。群れる敵は 1 回で複数体 |
| `enemiesPerDepth` | 深度 1 つごとに増える抽選回数 |
| `maxEnemies` | 部屋の敵の抽選回数と、増援で湧く実体数の上限。深み（最深の間の次の階から）は DEEP.maxEnemiesBonus を足す |
| `reinforcementRatio` | 封鎖したときに湧く増援の数。部屋の抽選回数に掛ける割合（0.5 で半分） |
| `spawnTelegraph` | 増援・波の敵が湧く前の予告（出現中）の秒 |
| `heartHeal` | ハートを拾ったときに回復する生命。部屋を制圧したときのハートの確率は combat/HEAL.json の heartChanceByChapter（試練の部屋は確定） |
| `clearBonus` | 部屋を制圧したときの得点。階段を初めて降りたときも clearBonus × 深度 × 位階の倍率が入る |

## world/ROOM_KIND

| 項目 | 意味 |
| --- | --- |
| `treasureChance` | （未記入） |
| `treasureItemsMin` | （未記入） |
| `treasureItemsMax` | （未記入） |
| `treasureRarityBoost` | （未記入） |
| `treasureItemSpread` | （未記入） |
| `treasureCoinParticles` | （未記入） |
| `treasureCoinColor` | （未記入） |
| `challengeMinDepth` | （未記入） |
| `challengeChance` | （未記入） |
| `challengeWaves` | （未記入） |
| `challengeWaveMul` | （未記入） |
| `challengeRareBoost` | （未記入） |
| `challengeRareAttempts` | （未記入） |
| `challengeColor` | （未記入） |
| `fountainRadius` | （未記入） |
| `shrineColor` | （未記入） |
| `cursedEliteRolls` | （未記入） |
| `cursedColor` | （未記入） |
| `ambushMinDepth` | （未記入） |
| `ambushChance` | （未記入） |
| `ambushMax` | （未記入） |
| `ambushEnemyMul` | （未記入） |
| `extraMax` | （未記入） |
| `extra.*.chance` | （未記入） |
| `extra.*.minDepth` | （未記入） |
| `propRadius` | （未記入） |
| `propSpacing` | （未記入） |
| `propLabelRange` | （未記入） |
| `altarColor` | （未記入） |
| `libraryColor` | （未記入） |
| `arenaWaves` | （未記入） |
| `arenaWaveMul` | （未記入） |
| `arenaColor` | （未記入） |
| `gambleCoinCost` | （未記入） |
| `gambleCoinWinMul` | （未記入） |
| `gambleUses` | （未記入） |
| `gambleColor` | （未記入） |
| `gambleWeights.item` | 賭け台の当たり「遺物」（gambleRarityBoost で底上げ）の重み。相対値 |
| `gambleWeights.hearts` | 当たり「ハート」（gambleHearts 個）の重み。相対値 |
| `gambleWeights.rune` | 当たり「刻印符」の重み。相対値 |
| `gambleWeights.ambush` | 外れ「伏兵」（部屋に増援が湧く）の重み。相対値 |
| `gambleWeights.curse` | 外れ「呪い」（次の部屋が呪われる）の重み。相対値 |
| `gambleWeights.coins` | 当たり「銭」（gambleCoinCost × gambleCoinWinMul）の重み。相対値 |
| `gambleRarityBoost` | （未記入） |
| `gambleHearts` | （未記入） |
| `forgeEchoes` | （未記入） |
| `forgeBurnDuration` | （未記入） |
| `forgeBurnDps` | （未記入） |
| `forgeColor` | （未記入） |
| `exchangeItems` | （未記入） |
| `exchangeMul` | （未記入） |
| `exchangeColor` | （未記入） |
| `curseShrineColor` | （未記入） |
| `resonanceBonusDrops` | （未記入） |
| `escortHpMul` | （未記入） |
| `escortRadius` | （未記入） |
| `escortDps` | （未記入） |
| `escortColor` | （未記入） |
| `escapeSpeed` | （未記入） |
| `escapeLavaTime` | （未記入） |
| `escapeTickInterval` | （未記入） |
| `escapeColor` | （未記入） |
| `reaperNestDepthBonus` | （未記入） |
| `nestHpMul` | （未記入） |
| `nestElites` | （未記入） |
| `nestColor` | （未記入） |
| `mirrorHpMul` | （未記入） |
| `mirrorBoonsPerElite` | （未記入） |
| `mirrorEliteMax` | （未記入） |
| `mirrorColor` | （未記入） |
| `watchtowerReaperCost` | （未記入） |
| `watchtowerColor` | （未記入） |
| `vaultCoinCost` | （未記入） |
| `vaultDrops` | （未記入） |
| `vaultColor` | （未記入） |
| `elementAltarChoices` | （未記入） |
| `elementAltarShare` | （未記入） |
| `elementAltarColor` | （未記入） |
| `dummyCount` | （未記入） |
| `dummySpacing` | （未記入） |
| `dummyColor` | （未記入） |
| `fogRoomRadius` | （未記入） |
| `fogRoomColor` | （未記入） |
| `tideRoomSpeed` | （未記入） |
| `tideRoomInterval` | （未記入） |
| `tideRoomWaterTime` | （未記入） |
| `tideRoomColor` | （未記入） |
| `invertHallItems` | （未記入） |
| `invertHallAttempts` | （未記入） |
| `invertHallColor` | （未記入） |
| `hordeMinDepth` | （未記入） |
| `hordeSecondDepth` | （未記入） |
| `hordeChance` | （未記入） |
| `hordeMinTiles` | （未記入） |
| `hordeWaves` | （未記入） |
| `hordeWaveMul` | （未記入） |
| `hordeColor` | （未記入） |
| `locks.normal` | （未記入） |
| `locks.treasure` | （未記入） |
| `locks.challenge` | （未記入） |
| `locks.shrine` | （未記入） |
| `locks.ambush` | （未記入） |
| `locks.altar` | （未記入） |
| `locks.library` | （未記入） |
| `locks.arena` | （未記入） |
| `locks.gamble` | （未記入） |
| `locks.forge` | （未記入） |
| `locks.exchange` | （未記入） |
| `locks.curseShrine` | （未記入） |
| `locks.resonance` | （未記入） |
| `locks.escort` | （未記入） |
| `locks.escape` | （未記入） |
| `locks.reaperNest` | （未記入） |
| `locks.nest` | （未記入） |
| `locks.mirror` | （未記入） |
| `locks.watchtower` | （未記入） |
| `locks.horde` | （未記入） |
| `locks.vault` | （未記入） |
| `locks.elementAltar` | （未記入） |
| `locks.dummyHall` | （未記入） |
| `locks.fogRoom` | （未記入） |
| `locks.tideRoom` | （未記入） |
| `locks.invertHall` | （未記入） |

## world/FLOOR_KIND

| 項目 | 意味 |
| --- | --- |
| `darkLightRadius` | 暗闇の階でプレイヤーの周りが見える半径。px |
| `darkFeather` | 暗闇の明かりの縁のぼかしの幅。明かりの半径に対する割合（0..1） |
| `darkAlpha` | 暗闇の濃さ。不透明度（0..1。1 で真っ暗） |
| `weight` | フロア種別ごとの抽選の重み（key はフロア種別）。反転層では並びを逆にした相手の重みを使う |
| `biomeMinDepth` | フロア種別ごとの解禁深度（key はフロア種別）。この深度から抽選に入る。ボス階は常に rooms |
| `patchesPerRoom` | バイオームの地形（泥・溶岩など）を部屋ごとに置く数。縛り「荒れた大地」で 2 倍 |
| `patchRadiusMin` | バイオームの地形の半径の下限。px |
| `patchRadiusMax` | バイオームの地形の半径の上限。px |
| `lavaRadiusMul` | 溶岩だけ半径に掛ける倍率（踏むと痛いので小さめ） |
| `familyMul` | そのバイオームの顔ぶれ（ファミリー）の敵の出現の重みに掛ける倍率 |
| `ossuaryCorpses` | 骨の墓所で部屋ごとに最初から転がしておく死骸の数 |
| `ossuaryCorpseTime` | その死骸が残る秒 |
| `tintAlpha` | バイオームの床の色味の濃さ。不透明度（0..1） |
| `forkMin` | 最後の部屋に置く分かれ道の階段の数の下限（次の階の候補が少なければその数まで） |
| `forkMax` | 分かれ道の階段の数の上限 |
| `forkOffset` | 分かれ道の階段を中心の階段から離す距離。タイル |
| `invertedDepth` | 反転層が始まる深度。この深度から敵が精鋭になりやすく、遺物が反転しやすい |
| `invertedColor` | 反転層の表示の色 |
| `ascendMinDepth` | 上り階段（浅い階へ戻る）を置き始める深度 |
| `ascendMaxReturns` | 1 ランで上り階段を使える回数 |
| `ascendHold` | 上り階段に触れ続けて戻るまでの秒 |
| `revisitReaperHeadStart` | 戻った階では死神の猶予がこの秒だけ進んだ状態で始まる |
| `ascendColor` | 上り階段・帰還の表示の色 |

## world/CAVE

| 項目 | 意味 |
| --- | --- |
| `base` | 洞窟の生成の既定値。biome に書いた項目だけバイオームごとに上書きする |
| `base.fillChance` | 初期状態で壁にする確率。割合（0..1）。低いほど開けて、高いほど細い道が増える。目安 0.42〜0.47 |
| `base.smoothSteps` | セルオートマトンでならす回数。多いほど壁が滑らか |
| `base.wallBirth` | 周囲 8 マスの壁がこの数以上なら床が壁になる |
| `base.wallSurvive` | 壁は周囲 8 マスの壁がこの数以上なら壁のまま |
| `base.openDist` | 壁からこのマス数以上離れた床を「開けた領域」（部屋の芯）とみなす |
| `base.minRoomTiles` | 部屋として採用する開けた領域の最小タイル数 |
| `base.roomGrow` | 開けた領域から部屋を膨らませるマス数。膨らませきれない細い所が通路になる |
| `base.maxRooms` | 部屋の数の上限（大きい領域から採る） |
| `base.minRooms` | 部屋の数の下限。足りなければ作り直す |
| `base.widen` | 幅 1 の通路を 1 マスずつ太らせる回数。0 なら細い道がそのまま残る |
| `biome` | バイオームごとの洞窟の形の上書き（key はフロア種別。書かない項目は base の値） |
| `biome.*.fillChance` | 初期状態で壁にする確率。割合（0..1）。低いほど開けて、高いほど細い道が増える。目安 0.42〜0.47 |
| `biome.*.minRoomTiles` | 部屋として採用する開けた領域の最小タイル数 |
| `biome.*.maxRooms` | 部屋の数の上限（大きい領域から採る） |
| `biome.*.openDist` | 壁からこのマス数以上離れた床を「開けた領域」（部屋の芯）とみなす |
| `biome.*.roomGrow` | 開けた領域から部屋を膨らませるマス数。膨らませきれない細い所が通路になる |
| `biome.*.widen` | 幅 1 の通路を 1 マスずつ太らせる回数。0 なら細い道がそのまま残る |

## world/ROAM

| 項目 | 意味 |
| --- | --- |
| `speedMul` | 徘徊中（気付く前）の歩きの速さ。敵の speed に掛ける倍率。長蛇（通路を歩く陣）もこれで歩く |
| `reach` | 徘徊の目的地にこの距離まで近づいたら次の目的地を選ぶ。px |
| `stuckTime` | 進めない状態がこの秒続いたら目的地を選び直す |
| `minSpawnDist` | 封鎖の瞬間に部屋の外にいた自室の敵を中へ寄せるとき、プレイヤーからこの距離以上離れた点があればそこを選ぶ（system/floor.ts の strayTarget）。px |
| `engageLeash` | 部屋から追ってきた敵がこの距離以内にいる間は交戦中とみなす。px |
| `sleepDist` | プレイヤーからこの距離以上離れた、まだ気付いていない敵は眠る（AI を回さない。system/enemies.ts の isAsleep）。px。画面の幅（480）以上にする |
| `sleepRoamEvery` | 眠りの距離より遠い徘徊を何ステップに 1 回歩かせるか（その分の dt でまとめて歩く）。1 で間引かない |

## world/RUN_EVENT

| 項目 | 意味 |
| --- | --- |
| `minDepth` | （未記入） |
| `warnTime` | （未記入） |
| `cooldown` | （未記入） |
| `lockChance.reinforce` | （未記入） |
| `lockChance.blackout` | （未記入） |
| `lockChance.meteor` | （未記入） |
| `lockChance.manaDrought` | （未記入） |
| `lockChance.shrink` | （未記入） |
| `lockChance.timeRift` | （未記入） |
| `lockChance.curseVoice` | （未記入） |
| `lockChance.duel` | （未記入） |
| `lockChance.sluggish` | （未記入） |
| `lockChance.flood` | （未記入） |
| `lockChance.silence` | （未記入） |
| `lockChance.reactionSurge` | （未記入） |
| `lockChance.thunderstorm` | （未記入） |
| `floorChance.bounty` | （未記入） |
| `floorChance.bloodMoon` | （未記入） |
| `floorChance.frenzyMoon` | （未記入） |
| `floorChance.fog` | （未記入） |
| `floorChance.elementStorm` | （未記入） |
| `fogBiomeChance` | （未記入） |
| `timedAfter` | （未記入） |
| `checkInterval` | （未記入） |
| `timedChance.quake` | （未記入） |
| `timedChance.curseWind` | （未記入） |
| `timedChance.reaperPass` | （未記入） |
| `timedChance.echoVein` | （未記入） |
| `timedChance.bats` | （未記入） |
| `timedChance.lifeFlow` | （未記入） |
| `timedChance.thiefChase` | （未記入） |
| `clearChance.treasureRain` | （未記入） |
| `clearChance.momentum` | （未記入） |
| `clearChance.boonReroll` | （未記入） |
| `reinforceMul` | （未記入） |
| `reinforceBonusTime` | （未記入） |
| `bountyScore` | （未記入） |
| `blackoutMax` | （未記入） |
| `quake.duration` | （未記入） |
| `quake.interval` | （未記入） |
| `quake.telegraph` | （未記入） |
| `quake.radius` | （未記入） |
| `quake.damage` | （未記入） |
| `quake.spread` | （未記入） |
| `meteor.duration` | （未記入） |
| `meteor.interval` | （未記入） |
| `meteor.telegraph` | （未記入） |
| `meteor.radius` | （未記入） |
| `meteor.damage` | （未記入） |
| `meteor.spread` | （未記入） |
| `impactEnemyMul` | （未記入） |
| `rainItems` | （未記入） |
| `rainHearts` | （未記入） |
| `rainSpread` | （未記入） |
| `rainRarityBoost` | （未記入） |
| `manaDrainPerSec` | （未記入） |
| `riftTime` | （未記入） |
| `riftRadius` | （未記入） |
| `riftFreeze` | （未記入） |
| `fogDuration` | （未記入） |
| `fogRadius` | （未記入） |
| `curseWindShow` | （未記入） |
| `bloodMoonHeal` | （未記入） |
| `bloodMoonHpMul` | （未記入） |
| `shrinkHpMul` | （未記入） |
| `shrinkExtraMul` | （未記入） |
| `momentumWindow` | （未記入） |
| `momentumSpeedMul` | （未記入） |
| `momentumSpeedTime` | （未記入） |
| `warnColor` | （未記入） |
| `activeColor` | （未記入） |
| `impactColor` | （未記入） |
| `sluggish.dashCdMul` | （未記入） |
| `sluggish.dashDamageMul` | （未記入） |
| `sluggish.buffTime` | （未記入） |
| `flood.duration` | （未記入） |
| `flood.interval` | （未記入） |
| `flood.growth` | （未記入） |
| `flood.maxRadius` | （未記入） |
| `flood.terrainTime` | （未記入） |
| `duel.holdTime` | （未記入） |
| `duel.fearTime` | （未記入） |
| `silenceTime` | （未記入） |
| `surge.radius` | （未記入） |
| `surge.damage` | （未記入） |
| `surge.perDepth` | （未記入） |
| `surge.icd` | （未記入） |
| `surge.color` | （未記入） |
| `thunder.duration` | （未記入） |
| `thunder.interval` | （未記入） |
| `thunder.telegraph` | （未記入） |
| `thunder.radius` | （未記入） |
| `thunder.damage` | （未記入） |
| `thunder.spread` | （未記入） |
| `thunder.shockStacks` | （未記入） |
| `thunder.shockDuration` | （未記入） |
| `thunder.color` | （未記入） |
| `curseVoiceCombo` | （未記入） |
| `elementStormShare` | （未記入） |
| `reaperPass.minRatio` | （未記入） |
| `reaperPass.speed` | （未記入） |
| `reaperPass.span` | （未記入） |
| `reaperPass.radius` | （未記入） |
| `reaperPass.damage` | （未記入） |
| `reaperPass.echoes` | （未記入） |
| `lifeFlow.duration` | （未記入） |
| `lifeFlow.ratio` | （未記入） |
| `bats.duration` | （未記入） |
| `bats.count` | （未記入） |
| `bats.manaPerKill` | （未記入） |
| `vein.uses` | （未記入） |
| `vein.echoes` | （未記入） |
| `vein.reinforce` | （未記入） |
| `vein.color` | （未記入） |
| `thief.duration` | （未記入） |
| `thief.searchRadius` | （未記入） |
| `thief.spawnOffset` | （未記入） |
| `thief.rarityBoost` | （未記入） |
| `thief.color` | （未記入） |

## world/LINGER

| 項目 | 意味 |
| --- | --- |
| `minDepth` | 長居の代償が起こり始める深度（縛り「長居の二重苦」なら浅い階から） |
| `startRatio` | 長居の代償が始まる時刻。死神の猶予秒に掛ける割合（0..1） |
| `doubleRatio` | 縛り「長居の二重苦」のときの startRatio |
| `warnMargin` | 始まるこの秒前から HUD と効果音で予告する |
| `shadowDelay` | 影の自分: 1 体目がなぞる、自分の何秒前の軌跡か |
| `shadowGap` | 影の自分: 2 体目以降は 1 体ごとにこの秒だけさらに遅れる |
| `shadowInterval` | 影の自分: 影が 1 体増える間隔の秒 |
| `shadowMax` | 影の自分: 影の数の上限 |
| `trailStep` | 影の自分: 自分の位置を記録する間隔の秒 |
| `shadowRadius` | 影の自分: 影の当たり判定の半径。px |
| `shadowDamage` | 影の自分: 触れたときのダメージ（見切りにならない） |
| `shadowColor` | 影の自分の色（長居の代償のログの色も兼ねる） |
| `collapseInterval` | 天井の崩落: 落石の最初の間隔の秒 |
| `collapseMinInterval` | 天井の崩落: 間隔の下限の秒 |
| `collapseAccel` | 天井の崩落: 1 秒ごとに間隔が縮む秒 |
| `collapseTelegraph` | 天井の崩落: 落石の予告の影が出てから落ちるまでの秒 |
| `collapseRadius` | 天井の崩落: 落石の範囲の半径。px（敵にも当たる） |
| `collapseDamage` | 天井の崩落: 落石のダメージ |
| `collapseSpread` | 天井の崩落: 落石をプレイヤーの足元からずらす最大の距離。px |
| `tideSpeed` | 潮: 水が開始部屋から広がる速さ。px/秒 |
| `tideInterval` | 潮: 水を広げ、溺れのダメージを入れる間隔の秒 |
| `tideFullAfter` | 潮: 始まってからこの秒で満潮になり、水の上で溺れる |
| `tideDrownDps` | 潮: 満潮の水の上で受けるダメージ。毎秒 |

## world/ORIGIN

| 項目 | 意味 |
| --- | --- |
| `cursedBoons` | 起点「呪われた者」: 開始時に得る呪いの祝福の数 |
| `cursedCoins` | 起点「呪われた者」: 開始時に得る銭 |
| `unarmedUnsealDepth` | 起点「素手」: 装備の封印が解ける深度 |
| `unarmedCoins` | 起点「素手」: 開始時に得る銭 |
| `chanterRunes` | 起点「詠み手」: 開始時に付く刻印符の数 |
| `chanterHpMul` | 起点「詠み手」: 最大生命の倍率（1 = 等倍） |
| `reaperFriendSpeedMul` | 起点「死神の友」: 階に入った直後から出ている死神の速さの倍率 |
| `reaperFriendCoins` | 起点「死神の友」: 初めての階へ降りるたびに得る銭 |

## world/CONTRACT

| 項目 | 意味 |
| --- | --- |
| `minDepth` | （未記入） |
| `appearChance` | （未記入） |
| `weights.notary` | （未記入） |
| `weights.peddler` | （未記入） |
| `weights.mender` | （未記入） |
| `weights.seer` | （未記入） |
| `weights.bookie` | （未記入） |
| `weights.bard` | （未記入） |
| `weights.smith` | （未記入） |
| `weights.guide` | （未記入） |
| `weights.ferryman` | （未記入） |
| `standOffset` | （未記入） |
| `offerOffset` | （未記入） |
| `offerSpacing` | （未記入） |
| `greetRange` | （未記入） |
| `color` | （未記入） |
| `pactColor` | （未記入） |
| `pactSlayerKills` | （未記入） |
| `pactSwiftTime` | （未記入） |
| `pactSwiftPenalty` | （未記入） |
| `pactSwiftTempers` | 契約「疾風」を果たした報酬: 次の階の到着時に出る錬磨の提示の回数 |
| `peddlerItemCost` | （未記入） |
| `peddlerItemBoost` | （未記入） |
| `peddlerEchoCost` | （未記入） |
| `peddlerEchoes` | （未記入） |
| `peddlerSalveCost` | （未記入） |
| `peddlerSalveHeal` | （未記入） |
| `menderStitchCost` | （未記入） |
| `menderStitchHeal` | （未記入） |
| `menderUncurseCost` | （未記入） |
| `menderCleanseCost` | （未記入） |
| `seerReadCost` | （未記入） |
| `seerWardCost` | （未記入） |
| `seerMapCost` | （未記入） |
| `bookieLifeCost` | （未記入） |
| `bookieLifeWinChance` | （未記入） |
| `bardTaleCost` | （未記入） |
| `bardTales` | （未記入） |
| `bardWitnessTime` | （未記入） |
| `smithCost` | （未記入） |
| `smithShare` | （未記入） |
| `smithChoices` | （未記入） |
| `guideForkCost` | （未記入） |
| `guideRevealCost` | （未記入） |
| `ferryLifeCost` | （未記入） |
| `ferryCoinCost` | （未記入） |
| `ferryTime` | （未記入） |
| `ferryMaxUses` | （未記入） |
| `lifeFloor` | （未記入） |

## world/RUN_MOD

| 項目 | 意味 |
| --- | --- |
| `thickHideHpMul` | 縛り「厚い皮」: 敵の生命の倍率（説明文 src/system/runSetup.ts の RUN_MODS はこの値から組む） |
| `quickHandsCut` | 縛り「早い手」: 敵の予備動作を縮める割合（0..1。0.1 で 1 割短い）（説明文はこの値から組む） |
| `hastyReaperMul` | 縛り「急かす死神」: 死神の猶予秒の倍率（説明文はこの値から組む） |
| `hourglassTime` | 縛り「部屋の砂時計」: 交戦がこの秒続くたびに増援が来る |
| `glassBodyHpMul` | 縛り「薄氷」: 最大生命の倍率（説明文はこの値から組む） |
| `scorePerTier` | 位階 1 点あたり、階段で得る得点に足す倍率（0.1 で 1 点ごとに +10%） |

## world/HUB

| 項目 | 意味 |
| --- | --- |
| `interactRadius` | 拠点で台を使える距離。px。台どうしはこの 2 倍より離して置く |
| `departHold` | 出発の決定を押し続ける秒 |
| `dummyRespawn` | 倒れた木人が立ち直るまでの秒 |
| `dummyCount` | 拠点の木人の数（配置は src/map/hubMap.ts の配置図。この値はテストが配置図と照合する） |
| `trainingRuns` | このラン数に達すると訓練場が建つ（試し場を見つけても建つ） |
| `seed` | 拠点の乱数の種。拠点と借り物の武器を毎回同じにする |
| `bannerSeconds` | 設備が建ったときの知らせを出す秒 |
| `rackBorrowHold` | 武器掛けで決定を押し続けて借りるまでの秒 |
| `gateNearMargin` | 石段（出撃の口）の矩形をこのタイル数だけ広げた範囲に入ると nearGate が立つ（門の名札・案内を出す距離） |

## world/HUB_DECOR

拠点（門前町）の景色の段（meta/hub.ts・meta/townLook.ts。

| 項目 | 意味 |
| --- | --- |
| `shelfMax` | 記録の蔵の窓の灯（書架）の最大数。図鑑の埋まった割合でこの数まで増える |
| `lanternBase` | 参道の灯籠の基本の数（踏破 0 回でも立つ） |
| `lanternPerClear` | 踏破 1 回につき増える灯籠の数 |
| `lanternMax` | 参道の灯籠の最大数（配置の lanternSlots の数以下にする） |
| `wellDonationBounds` | 井戸の段の境目（寄進の総額）。総額がこの配列の n 番目以上になると井戸が n + 1 段目になる（0 段 = 釣瓶。配列の長さ + 1 段まで） |
| `steleClearBounds` | 踏破の碑の位階の境目（最高位階）。踏破したことがあると碑は 1 段、最高位階がこの配列の n 番目以上ごとに 1 段ずつ育つ |
| `trophyMax` | 御堂の前の幟の最大数（倒したボス 1 体につき 1 本） |
| `bustleRunBounds` | 賑わいの段の境目（ランの回数）。回数がこの配列の n 番目以上になると賑わいが n + 1 段（樽・荷車・洗濯物・猫の順） |

## world/BOSS_HALL

ボスの間（拠点の台から、倒した章ボスと最深の主に今の装備の写しで挑み直す。

| 項目 | 意味 |
| --- | --- |
| `seedPrefix` | ボスの間の階を作る seed の文字列の頭。後ろにボスの key を付ける（同じボスは毎回同じ部屋になる） |
| `doorInset` | 挑む前にプレイヤーを置く位置。ボス部屋の扉タイルから部屋の中心へ何タイル入るか。タイル |
| `resultColor` | 結果の見出し（撃破・力尽きた）の色 |

## world/DOJO

稽古の間（拠点の稽古場から入る検証用の専用ステージ。

| 項目 | 意味 |
| --- | --- |
| `seed` | 稽古の間の state の seed（敵の湧きの乱数。決まった値で毎回同じ） |
| `countOptions` | 稽古帳の「数」で選べる敵の数。体 |
| `depthOptions` | 稽古帳の「深さ」で選べる深度。敵の生命・威力・怯みの深度の伸びに効く。階 |
| `tempoOptions` | 稽古帳の「攻めの速さ」で選べる攻撃間隔の時計の速さの倍率。倍（1 = 本編と同じ、2 = 間隔が半分） |
| `distanceOptions` | 稽古帳の「間合い」で選べる、自分の湧き位置から敵の並びまでの距離。px（10px = 1m） |
| `timeScaleOptions` | 稽古帳の「時の流れ」で選べる時間の速さ。倍（1 = 等速、0.25 = 4 分の 1 のゆっくり） |
| `defaultCount` | 敵の数の既定。体（countOptions のどれか） |
| `defaultDepth` | 深さの既定。階（depthOptions のどれか） |
| `defaultDistance` | 間合いの既定。px（distanceOptions のどれか） |
| `spacing` | 横一列・散らばりで並べる敵どうしの間隔。px |
| `respawnDelay` | 全滅してから湧き直すまでの秒 |
| `meterWindowSec` | 計測の「直近」の秒（この秒の間に入った傷を秒で割る） |
| `meterIdleSec` | 最後の命中からこの秒、傷が入らなければ計測の区切り（経過の時計を止める） |
| `springRadius` | 手水鉢に触れたと見なす距離（中心から）。px |
| `springCooldown` | 手水鉢で満たした後、次に満たすまでの秒（立ちっぱなしで毎コマ満たして浮き文字を出し続けない） |
| `interactRadius` | 稽古帳・武器掛け・戻り口に近づいたと見なす距離。px |
| `panelColor` | 計測の欄の見出しの色 |

## world/LORD_HALL

ボス階の専用の部屋（階の型 lordHall。

| 項目 | 意味 |
| --- | --- |
| `margin` | 外周の壁の厚さ。タイル |
| `entryLength` | 入口の間と前室をつなぐ参道の長さ。タイル |
| `gateLength` | 前室と主の間をつなぐ門の通路の長さ。3 以上にして前室の扉と主の間の扉を別のタイルにする。タイル |
| `corridorWidth` | 通路の幅。奇数にして部屋の中段に揃える。タイル |

## world/META

| 項目 | 意味 |
| --- | --- |
| `questOffers` | 依頼の候補として並べる数 |
| `questTagWeight` | 依頼の 3 択で、持ち物の系統と依頼の系統が 1 つ重なるごとに足す重み（基本の重みは 1。0 で持ち物を見ない） |
| `diagramDeaths` | 図鑑の敵の頁で予告の図解を開ける、その敵に倒された回数 |
| `roomSampleTicks` | 図鑑に今いる部屋の種類を記録する間隔。ステップ（60Hz） |

## world/DISCOVERY

| 項目 | 意味 |
| --- | --- |
| `milestonePage` | 連携をこの種数発見すると図鑑の頁「連携」が開く（実績「連携の芽生え」） |
| `milestoneTitle` | 連携をこの種数発見すると称号（実績「連携の読み手」） |
| `milestoneGrand` | 連携をこの種数発見すると称号（実績「連携の賢者」） |
| `hintRefreshTicks` | 連携の手がかりを見直す間隔。ステップ（60Hz）。階が変わったときも見直す |
| `hintShowSeconds` | 連携の手がかりを表示する秒 |
| `freshShowSeconds` | 新しい連携を見つけた知らせを表示する秒 |

## world/MAP_SIZE

マップの大きさ。

| 項目 | 意味 |
| --- | --- |
| `baseWidth` | 基準のマップの幅。タイル（1 タイル = 16px）。倍率 1 の大きさ |
| `baseHeight` | 基準のマップの高さ。タイル |
| `areaMulMin` | 階ごとに抽選する面積の倍率の下限。倍率（1 = 基準）。幅と高さはそれぞれ √倍率 倍になる。min = max なら抽選しない（乱数を引かない） |
| `areaMulMax` | 面積の倍率の上限。倍率 |
| `roomsPerArea` | 部屋の数の伸び。部屋の数の上限 = 四捨五入（基準の部屋数 × 面積の倍率 × roomsPerArea）。1 で部屋の密度が基準と同じ。部屋を大きくする分だけ下げる |
| `roomSizeExp` | 部屋の寸法（下限・上限。洞窟は膨らませる幅）に掛ける 面積の倍率 ^ これ。0 で基準の部屋の大きさ、0.5 で辺の長さと同じ比率 |
| `roomEnemiesExp` | 部屋に置く敵の抽選回数に掛ける 面積の倍率 ^ これ（四捨五入、部屋の上限は超えない）。大きい部屋に少し多く置く。0 でも部屋が大きい分だけ置ける場所が増えて部屋あたりの敵は増える（実測 1.3 倍前後） |
| `caveMinRoomsPerArea` | 洞窟の部屋の数の下限の伸び。下限 = 四捨五入（基準の下限 × 面積の倍率 × これ）。足りなければ作り直すので、上げすぎると部屋型に落ちやすい |
| `graceAreaExp` | 死神の猶予の基本（REAPER.appearAfter）に掛ける 面積の倍率 ^ これ。0 で広さに依らない、0.5 で辺の長さに比例（部屋数の分は REAPER.appearPerRoom で別に伸びる） |

## world/HIDDEN_ROOM

隠し部屋（system/hiddenRoom.ts・map/hidden.ts）。

| 項目 | 意味 |
| --- | --- |
| `chance` | この階に隠し部屋を計画する確率。割合(0..1) |
| `minDepth` | この深度未満では生成しない |
| `w` | ポケットの横幅（タイル） |
| `h` | ポケットの縦幅（タイル） |
| `minSteps` | 開始位置からの歩数がこれ未満の通路には置かない（入ってすぐ見つからないように） |
| `openHold` | 扉に体を押し当ててから開くまでの秒 |
| `touchMargin` | 扉タイルへの重なり判定に足す半径の余裕（px）。厳密に壁へめり込まなくても「押し当てた」とみなす |
| `hintRadius` | この距離（px）以内に入ると手がかり（ログ・音・風の粒子）を出す |
| `hintInterval` | 手がかり中、風の粒子を出す間隔（秒） |
| `items` | 開けたときに落ちる遺物の数 |
| `rarityBoost` | 開けたときに落ちる遺物の rarityBoost（dropItem の extraBoost） |
| `color` | ひび・風の粒子・ログの色 |

## world/ECONOMY

銭・鍵・瓶（ラン内の通貨。

| 項目 | 意味 |
| --- | --- |
| `chapterMul` | 章が 1 つ進むごとに稼ぎ（と値段）の平均に掛ける倍率。倍率（1 = 等倍）。章 n は chapterMul^(n−1) |
| `coin.color` | 床の銭・浮き文字「銭 +n」の色 |
| `coin.radius` | 床の銭の拾う当たりの半径。px |
| `coin.life` | 撃破で落ちた銭が床に残る秒。これを過ぎると消える。秒 |
| `coin.blinkSec` | 消える前の点滅を始める残り秒（描画が life を読む）。秒 |
| `coin.magnetRadius` | プレイヤーからこの距離以内の銭・鍵は引き寄せられる（プレイヤーの半径の外側に足す）。px（32 = 3.2m）。stats.coinMagnetMul を掛ける |
| `coin.magnetSpeed` | 引き寄せの速さ。px/秒 |
| `coin.maxCoins` | 床に同時に置ける銭の実体の上限。超えた分は最も新しい銭に額を足す。個 |
| `coin.scatterSpeed` | 撃破で落ちた銭が散る距離（初速 = これ × friction）。px |
| `coin.friction` | 散る初速の減衰。毎秒の割合（速さ × e^(−friction × 秒)）。大きいほど早く止まる |
| `coin.splitPieces` | ボス・階の主・大将の撃破の銭を割って散らす数。個 |
| `container.perFloorMin` | 1 階に置く壺・木箱の数の下限（面積倍率を掛ける前）。個 |
| `container.perFloorMax` | 1 階に置く壺・木箱の数の上限（面積倍率を掛ける前）。個。実際の数は 乱数(min..max) × その階の面積倍率 |
| `container.deadEndMax` | 通路の行き止まりに置く数の上限（残りは塊の隅）。個 |
| `container.crateChance` | 木箱になる確率（残りは壺）。割合（0..1） |
| `container.cornerWalls` | 塊の隅とみなす、壁に接する面の数の下限（縦と横の壁を 1 面ずつ含むこと）。面 |
| `container.spacing` | 壺・木箱どうしの最小の間隔。px |
| `container.keepClear` | 台座・商人・契約者・開始位置・敵から空ける距離。px |
| `container.coinsMin` | 割ったときに出る銭の下限（章の倍率を掛ける前）。銭 |
| `container.coinsMax` | 割ったときに出る銭の上限（章の倍率を掛ける前）。銭 |
| `container.flaskChance` | 割ったときに瓶が出る確率。割合（0..1） |
| `container.heartChanceByChapter` | 割ったときにハートが出る確率を章ごとに（1 章から順。章より深い階は最後の値）。割合（0..1）。壺・木箱は階ごとに数が決まっているので、割り尽くせば回復はそれ以上増えない |
| `container.burstColor` | 割れたときの破片の色（壺） |
| `container.crateBurstColor` | 割れたときの破片の色（木箱） |
| `container.burstParticles` | 割れたときの破片の数。個 |
| `container.lockedChestKeys` | 鍵付きの宝箱（宝物庫の遺物 1 つの代わり）を開けるのに払う鍵。本 |
| `container.lockedChestBoost` | 鍵付きの宝箱から出る遺物のレアリティ補正（宝物庫の通常の遺物より高い）。倍率（1 = 等倍） |
| `container.lockedChestCoinsMin` | 鍵付きの宝箱を開けたときに出る銭の下限（章の倍率を掛ける前）。銭 |
| `container.lockedChestCoinsMax` | 鍵付きの宝箱を開けたときに出る銭の上限（章の倍率を掛ける前）。銭 |
| `container.chestColor` | 鍵付きの宝箱の台座・浮き文字の色 |
| `container.vaultKeys` | 封印庫の封印を鍵で解くのに払う本数（銭で解く場合は ROOM_KIND.vaultCoinCost）。本 |
| `income.spread` | 撃破・陣・部屋の制圧の額の揺らぎ（平均に掛ける三角分布の倍率 low〜high、最頻 1）。引いた額は小数部を確率で切り上げて整数にする |
| `income.kill` | 撃破で落ちる銭の平均（章 1）。normal 並 / strong 猛 / elite 精鋭 / leader 陣の大将 / lord 階の主・部屋主 / boss ボス。銭 |
| `income.swarmMul` | 群れ（swarm）の敵の撃破の銭に掛ける倍率 |
| `income.routMul` | 敗走中の敵の撃破の銭に掛ける倍率（追い討ちの稼ぎ。1.5 → 3: 2026-10-02 逃げる敵を追う得を見えるように） |
| `income.jin` | 交戦した陣の決着（全滅・敗走）で得る銭の平均。陣を持たない部屋の制圧も同じ額。銭 |
| `income.jinUnscathedMul` | 起床から決着まで被弾しなかった陣の決着の銭に掛ける倍率 |
| `income.roomBonus` | 部屋の種類ごとの制圧の上乗せ（陣を持つ部屋でもこの分は出る）。銭 |
| `income.floor` | 初めて着いた階で得る銭（章の倍率だけ掛ける）。銭 |
| `income.bounty` | 賞金首を仕留めて得る銭（章の倍率だけ掛ける）。銭 |
| `income.duel` | 決闘に勝って得る銭（章の倍率だけ掛ける）。銭 |
| `income.pactUnscathed` | 契約「無傷」を果たして得る銭。銭 |
| `income.pactSilent` | 契約「沈黙」を果たして得る銭。銭 |
| `income.pactSilentPenalty` | 契約「沈黙」を破って失う銭。銭 |
| `spill.ratio` | 被弾 1 回でこぼれる持ち金の割合。割合（0..1）。stats.coinSpillMul を掛ける |
| `spill.min` | こぼれる最低額（持ち金が 1 以上のとき）。銭 |
| `spill.pieces` | こぼれた額を割る実体の数の上限。個 |
| `spill.scatterMin` | こぼれた銭が飛ぶ距離の最小（攻撃の来た向きの反対へ）。px |
| `spill.scatterMax` | こぼれた銭が飛ぶ距離の最大。px |
| `spill.spreadAngle` | こぼれた銭の隣り合う向きの開き。ラジアン |
| `spill.life` | こぼれた銭が床に残る秒。秒 |
| `spill.settle` | こぼれてからこの秒が過ぎるまで引き寄せず拾えない（即戻りを防ぐ）。秒 |
| `key.jinChance` | 大将のいない陣の決着で鍵を落とす確率。割合（0..1） |
| `key.leaderJinChance` | 大将のいる陣の決着で鍵を落とす確率。割合（0..1） |
| `key.color` | 床の鍵・浮き文字「鍵」の色 |
| `flask.color` | 床の瓶・瓶の枡・浮き文字「瓶」の色 |
| `flask.start` | ランの開始時に持っている瓶の本数。本 |
| `flask.max` | 瓶を持てる本数の基準（PlayerStats.flaskMax の既定。性質・祝福で増える）。本 |
| `flask.healRatio` | 1 本飲んで回復する量。最大生命に対する割合（戦闘中の回復の上限 HEAL.sustainCapRatio は通さない） |
| `flask.cooldown` | 飲んだ後、次に飲めるまでの秒。秒 |
| `flask.textLife` | 浮き文字「瓶」の表示秒。秒 |
| `market.stock` | 商人の種類ごとの品の数（market 市 / chapterMarket 章の市 / peddler 旅商人 / blackMarket 闇市）。flask 瓶 / item 遺物 / rune 刻印符 / key 鍵 / reroll 仕入れ直し / cursedItem 反転の遺物 / skill 未所持のスキル石 / keystone 誓約。個 |
| `market.stock.*` | 旅商人（階を歩く商人）。chance 階に出る確率(0..1) / discount 助けた後のこのランの値引きの割合(0..1) / speed 歩く速さ（px/秒）/ minStartDist プレイヤーの開始位置からこの距離（px）以上離れた通路に出す / openRange プレイヤーがこの距離（px）まで近づくと足を止めて店を広げる / saveRadius 旅商人からこの距離（px）以内で敵を倒すと助けたことになる / threatPad 気付いている敵の体とこの距離（px）まで近いと襲われる / hurtDps 襲う敵 1 体あたりの毎秒のダメージ（深度で伸びる） |
| `market.kindPriceMul` | 商人の種類ごとに、品の値段（置いたときの値段）に掛ける倍率。書いていない品は 1 |
| `market.kindPriceMul.peddler` | 旅商人（階を歩く商人）。chance 階に出る確率(0..1) / discount 助けた後のこのランの値引きの割合(0..1) / speed 歩く速さ（px/秒）/ minStartDist プレイヤーの開始位置からこの距離（px）以上離れた通路に出す / openRange プレイヤーがこの距離（px）まで近づくと足を止めて店を広げる / saveRadius 旅商人からこの距離（px）以内で敵を倒すと助けたことになる / threatPad 気付いている敵の体とこの距離（px）まで近いと襲われる / hurtDps 襲う敵 1 体あたりの毎秒のダメージ（深度で伸びる） |
| `market.outlawPriceMul` | 怒らせた商人を倒した後（無法者）、このランの値段に掛ける倍率 |
| `market.itemBoost` | 市で買う遺物のレアリティの底上げ（dropItem の extraBoost） |
| `market.offerSpacing` | 台座の間隔。タイル（契約者の台座より詰める。品が多いので） |
| `market.greetRange` | 商人に近づいて一言が出る距離。px |
| `market.color` | 商人の名札・台座・浮き文字の色 |
| `market.throw` | 怒った商人が投げる品。count 1 回に投げる数 / spreadDeg 両端の角度差（度）/ speed 速さ（px/秒）/ damage 1 つの威力（深度で伸びる）/ color 色 |
| `market.throw.color` | 商人の名札・台座・浮き文字の色 |
| `market.peddler` | 旅商人（階を歩く商人）。chance 階に出る確率(0..1) / discount 助けた後のこのランの値引きの割合(0..1) / speed 歩く速さ（px/秒）/ minStartDist プレイヤーの開始位置からこの距離（px）以上離れた通路に出す / openRange プレイヤーがこの距離（px）まで近づくと足を止めて店を広げる / saveRadius 旅商人からこの距離（px）以内で敵を倒すと助けたことになる / threatPad 気付いている敵の体とこの距離（px）まで近いと襲われる / hurtDps 襲う敵 1 体あたりの毎秒のダメージ（深度で伸びる） |
| `market.cursedItemBoost` | 闇市の反転の遺物のレアリティの底上げ（dropItem の extraBoost） |
| `market.patience` | 怒っていない商人を誤って怒らせない仕組み（system/merchantAi.ts の shieldsMerchant）。shelterRange 商人からこの距離（px）以内に敵（壺・木箱・商人・従魔を除く。眠っている敵も数える）がいる間はプレイヤーの攻撃が当たらない / grace 警告の後この秒数以内の一撃は同じ一振りの続きとして数えない / window 警告の後この秒数以内にもう一度殴ると怒る（過ぎたら警告からやり直し） |
| `price.spread` | 値段の揺らぎ（平均に掛ける三角分布の倍率 low〜high、最頻 1） |
| `price.repeatMul` | 同じ品を買うたびに値段に足す割合（n 回買った品は 1 + repeatMul × n 倍）。仕入れ直しには掛けない |
| `price.base` | 品ごとの値段の平均（章 1）。flask 瓶 / item 遺物 / rune 刻印符 / key 鍵 / reroll 仕入れ直し / skill スキル石 / cursedItem 反転の遺物 / keystone 誓約。銭 |
| `price.rerollStep` | 仕入れ直しをするたびに、その商人の仕入れ直しの値段に足す額（章の倍率を掛ける）。銭 |
| `donation.step` | 1 回の寄進で納める持ち金の割合。割合（0..1） |
| `donation.min` | 1 回の寄進の最低額（持ち金がこれ未満なら全額）。銭 |
| `donation.offsets` | 祠を置く開始部屋の中心からの横のずれの候補（先に置けたものを使う。左右の順に試す）。タイル |
| `donation.color` | 祠の名札・浮き文字「寄進 n」・火花の色 |
| `donation.textLife` | 浮き文字「寄進 n」の表示秒。秒 |
| `bet.color` | 賭けの浮き文字・HUD の行の色 |
| `bet.offerSpacing` | 賭場の主の台座の間隔。タイル（台座が 5 つ並ぶので契約者の既定より詰める） |
| `bet.luckOffers` | 品書きに並べる運の型の数（丁半・大穴・一か八か・倍々勝負から重複なしで引く）。個 |
| `bet.skillOffers` | 品書きに並べる腕の型の数（無傷・速攻・凌ぎから重複なしで引く）。個 |
| `bet.*.stakeRatio` | 賭け金。張る瞬間の持ち金に対する割合（1 = 全額）。割合（0..1） |
| `bet.*.stakeMin` | 賭け金の最低額（持ち金 × stakeRatio がこれ未満ならこの額。払えなければ張れない）。銭 |
| `bet.*.mul` | 勝ったときに賭け金に掛ける倍率（払い戻しの総額。2 = 賭け金が倍になって戻る）。倍率 |
| `bet.*.chance` | 運の型の勝つ確率。割合（0..1）。倍々勝負は 1 回ごとの確率 |
| `bet.*.tiers` | 腕の型の難しさ（easy 易 / hard 難 / extreme 至難）。mul 勝ったときの倍率、target 速攻は起床から決着までの秒・凌ぎは階を降りるまでの受け流しと見切りの回数。無傷は束縛した陣に大将がいなければ易、いれば難 |
| `bet.*.tiers.*.mul` | 勝ったときに賭け金に掛ける倍率（払い戻しの総額。2 = 賭け金が倍になって戻る）。倍率 |
| `bet.parryKeywordMul` | 見切り系を持つビルド（装備・スキル石・祝福のどれかが見切りを出す・食う・強める）で、凌ぎの必要回数に掛ける倍率（切り上げ）。倍率 |
| `bet.jackpotPerChapter` | 大穴の陣（次の陣を無傷で決着すれば jackpotMul 倍）を賭場の主が出す、章ごとの回数。回 |
| `bet.jackpotMul` | 大穴の陣の倍率。倍率 |
| `build.pocketCoins` | 性質「懐」が効き始める持ち金。銭（章 1 の瓶 1 本より少し多い。章ごとの倍率は掛けない） |

## world/ARC

ランの章立て（system/chapters.ts。

| 項目 | 意味 |
| --- | --- |
| `floorsPerChapter` | 1 章の階数。深度 1〜floorsPerChapter が章 1。章ボスは各章の最後の階（floorsPerChapter の倍数） |
| `maxChapter` | 章の数。これより深い階は最後の章のまま（深み） |
| `chapters[]` | 章ごとの行（1 章から順）。boss は章の最後の階に出る階層ボスの key（data/enemies.ts の EnemyDef） |
| `lordSkipFirstFloor` | true なら、章の 1 階目（休符。深度 1 は除く）に階の主を出さない。ただの部屋として遊べる |
| `restFountain` | true なら、章の 1 階目（休符）に泉を必ず 1 つ置く。休符の泉は呪いを付けず、瓶を上限まで満たす |
| `finalBoss` | 最深の間（章の階数 × 章の数 + 1 = 深度 21）の主の key（最深の主 deepLord） |
| `surfaceHold` | 地上への道に乗り続けて踏破になるまでの秒 |
| `surfaceOffset` | 地上への道を最深の間の中央（階段）から右へ何タイル離して置くか |
| `surfaceColor` | 地上への道の色（台座・乗り続ける輪・ラベル） |
| `aheadColor` | 章の主の予習（章の休符と深度 16 の到着で出すログ）の色 |

## world/DEEP

深み（最深の間の次の階 = 深度 22 から。

| 項目 | 意味 |
| --- | --- |
| `maxEnemiesBonus` | 深みで ROOM.maxEnemies に足す数 |
| `mutationEvery` | 深みで変異が 1 つ増える層の数。深み 1 層目で 1 つ。目安 3〜10 |
| `color` | 深みの表示の色（右上の「深み n 層」は白のまま、浮き文字とログ） |

## world/TIER_REWARD

踏破した最高位階の見返り（meta/tierRewards.ts。

| 項目 | 意味 |
| --- | --- |
| `marketTier` | 章の市の品が増える最高位階（これ以上の位階で踏破していると効く） |
| `marketExtra` | 章の市に足す品。key は商人の品の種類（stock と同じ）、値は足す個数 |
| `exitTier` | 出口（階段）が増える最高位階 |
| `exitExtra` | 出口を足す本数（置ける場所が足りなければ置けた数まで） |

## world/EXIT

出口の予告（system/exits.ts。

| 項目 | 意味 |
| --- | --- |
| `weights` | 報酬の種類ごとの抽選の重み（key は報酬の種類）。boon = 祝福、relic = 遺物、coins = 銭、key = 鍵、flask = 瓶、danger = 危険な部屋、temper = 錬磨。flask は生命が flaskMaxHpRatio 以下のときだけ、temper は格の対象の札を 1 枚以上持つときだけ候補に入る |
| `boonGuaranteed` | true なら 1 階に祝福の出口を少なくとも 1 つ置く（祝福を持てる系譜が残っている間） |
| `chapterBossAllBoons` | true なら章ボス階（5 の倍数の階）の階段は全部祝福にする（格の下駄は BOON.gradeBoostAfterBoss） |
| `lineageOwnedMul` | 祝福の出口の系譜を選ぶ重みに、その系譜の札を 1 枚持つごとに掛ける倍率（1 = 等倍）。大きいほど持っている系譜が続けて出る |
| `lineageJobMul` | 流儀の専用系譜（JobDef.lineage）の重みに掛ける倍率（1 = 等倍） |
| `firstFloorDepth` | この深度以下の階の出口は firstFloorKinds だけにする。深度 |
| `firstFloorKinds` | firstFloorDepth 以下の階の出口に出せる報酬の種類 |
| `flaskMaxHpRatio` | 瓶の出口を候補に入れる生命の割合の上限（0..1）。この割合以下のときだけ |
| `relicArrivalChance` | 遺物の出口の到着報酬が出る確率（0..1。1 で確定） |
| `relicRarityBoost` | 遺物の出口の到着報酬の dropItem に渡す rarityBoost（通常の到着報酬は LOOT_DROP.depthArrivalRarityBoost） |
| `coinsMul` | 銭の出口の到着時の銭（初めて着いた階の銭）の倍率（1 = 等倍） |
| `dangerRewardMul` | 危険の出口で置いた部屋の制圧報酬の倍率（1 = 等倍）。遺物の報酬と銭に効く |
| `apprenticeExtraExit` | 流儀の無い見習いの階段を増やす本数（増えた階段は必ず祝福） |
| `hintRange` | 階段の上に報酬を出す距離。px（これより遠いと出さない） |
| `nearRange` | 報酬の文字が明るくなる距離。px（およそ 3 タイル） |
| `dimAlpha` | 遠いときの報酬の文字の不透明度（0..1）。近づくと 1 になる |
| `colors` | 報酬の種類ごとの表示色（階段の上の文字とミニマップの階段の点） |

## world/MAP_LAYOUT

階の型 8 種（src/map/layout/）の選び方と拡縮と検査の数値。

| 項目 | 意味 |
| --- | --- |
| `weight` | 型ごとの基本の重み。倍率（1 = 並）。大きいほど出やすい |
| `*.cavern` | 大洞窟の形の数値（cavern.json） |
| `*.river` | 谷・川筋の形の数値（river.json） |
| `*.ring` | 環状の形の数値（ring.json） |
| `*.court` | 中庭・寺院の形の数値（court.json） |
| `*.drunk` | 掘り手の迷い道の形の数値（drunk.json） |
| `*.isle` | 島と桟道の形の数値（isle.json） |
| `*.terrace` | 縦穴・段々の形の数値（terrace.json） |
| `*.prefab` | 断片の組み合わせの形の数値（prefab.json） |
| `chapterMul[]` | 章ごとの重みの倍率（添字 0 = 1 章目）。書かない型は 1。章が配列より多ければ最後の行 |
| `deepMul` | 深み（最後の章の先）での重みの倍率。chapterMul の代わりに掛かる。書かない型は 1 |
| `minDepth` | この深度より浅い階には出さない型ごとの下限。深度（1 始まり） |
| `repeatMul` | 前の階と同じ型の重みに掛ける倍率。0 で連続しない |
| `previewWidth` | 見本の幅。タイル。拡縮の基準（S = √(幅 × 高さ ÷ (previewWidth × previewHeight))） |
| `previewHeight` | 見本の高さ。タイル |
| `unitExp` | 長さの倍率 u = S ^ unitExp の指数。0 で長さを伸ばさず個数だけ増やし、1 で S 倍。目安 0.5〜0.8 |
| `areaScale` | 型ごとの面積の縮み。倍率（1 = 縮めない）。幅と高さが √ 倍になる。床の割合が低い型を小さい地図にして階段までの歩数を揃える |
| `validate` | 生成後の検査の閾値。落ちたら同じ乱数で作り直す |
| `validate.minRooms` | 部屋として数える塊（roomMinTiles 以上）の最小数。個 |
| `validate.roomMinTiles` | 部屋として数える最小のタイル数。タイル |
| `validate.minFloorRatio` | 通れる床が地図全体に占める割合の下限。割合（0..1） |
| `validate.maxFloorRatio` | 通れる床の割合の上限。割合（0..1） |
| `validate.mainPathWidth` | 開始から主の間まで通れなければならない道の幅。タイル（2 = 2x2 の窓が通れる） |
| `validate.lordFill` | 主の間の広さの下限 = π × 主の半径² × この割合。割合（0..1） |
| `minNodeTiles` | 部屋に育たなかった（これ未満の）ノードを捨てる下限。タイル。開始と主の間は捨てずに失敗にする |
| `cavern` | 大洞窟の形の数値（cavern.json） |
| `cavern.singleHallChance` | 広間が 1 つ（大）になる確率。割合（0..1）。残りは 2 つ（中）。目安 0.3〜0.6 |
| `cavern.singleRx` | 広間 1 つのときの横半径の下限。見本のタイル（長さ。unit 倍）。目安 12〜15 |
| `cavern.singleRxSpan` | 広間 1 つのときの横半径の振れ幅（下限に足す乱数の幅）。見本のタイル |
| `cavern.singleRy` | 広間 1 つのときの縦半径の下限。見本のタイル（unit 倍） |
| `cavern.singleRySpan` | 広間 1 つのときの縦半径の振れ幅。見本のタイル |
| `cavern.singleTilt` | 広間 1 つのときの傾きの振れ幅。ラジアン（± この半分） |
| `cavern.pairRx` | 広間 2 つのときの横半径の下限。見本のタイル（unit 倍） |
| `cavern.pairRxSpan` | 広間 2 つのときの横半径の振れ幅。見本のタイル |
| `cavern.pairRy` | 広間 2 つのときの縦半径の下限。見本のタイル（unit 倍） |
| `cavern.pairRySpan` | 広間 2 つのときの縦半径の振れ幅。見本のタイル |
| `cavern.pairTilt` | 広間 2 つのときの各広間の傾きの振れ幅。ラジアン |
| `cavern.pairAxisTilt` | 広間 2 つの並ぶ軸の傾きの振れ幅。ラジアン |
| `cavern.pairDist` | 広間 2 つの中心から中心までの半分の距離の下限。見本のタイル（unit 倍） |
| `cavern.pairDistSpan` | 広間 2 つの距離の振れ幅。見本のタイル |
| `cavern.satMinDist` | 小洞どうしの最小の間隔。見本のタイル（unit 倍）。大きいほどまばら |
| `cavern.satMax` | 小洞の数の上限。個（countMul 倍。置けなければ少なくなる）。部屋の数に直結する |
| `cavern.satRadius` | 小洞の半径の下限。見本のタイル（unit 倍）。主の間になっても足りる広さを保つ目安 3 以上 |
| `cavern.satRadiusSpan` | 小洞の半径の振れ幅。見本のタイル |
| `cavern.loopCount` | 最小全域木に足すループの本数。本（countMul 倍） |
| `cavern.loopMaxLen` | ループにする辺の長さの上限。見本のタイル（unit 倍） |
| `cavern.pathRadius` | 通り道（広間と小洞をつなぐ芯）の半径の下限。タイル（据え置き）。道幅は 2 倍 |
| `cavern.pathRadiusSpan` | 通り道の半径の振れ幅。タイル（据え置き） |
| `cavern.islandCount` | 広間 1 つに置く岩の島の数の下限。個（広間の面積に合わせて unit² 倍） |
| `cavern.islandCountSpan` | 岩の島の数の振れ幅。個 |
| `cavern.islandRadius` | 岩の島の半径の下限。見本のタイル（unit 倍） |
| `cavern.islandRadiusSpan` | 岩の島の半径の振れ幅。見本のタイル |
| `*.minKeep` | つなぎ直すときに壁で埋める欠片の大きさの上限。タイル（これ未満の欠片は埋め、以上は通路でつなぐ） |
| `cavern.hallGrowMul` | 広間の部屋の広がり（grow）= (横半径 + 縦半径) × これ。割合 |
| `cavern.satGrowMul` | 小洞の部屋の広がり（grow）= 半径 × これ。割合 |
| `*.lordGrowMul` | 主の間の部屋の広がりの下限 = 主の半径（FLOOR_LORD.arenaRadius）× これ。割合 |
| `river` | 谷・川筋の形の数値（river.json） |
| `river.halfWidthBase` | 川の半幅の下限。タイル × unit。川の幅は半幅の 2 倍 |
| `river.halfWidthVar` | 川の半幅が雑音で上乗せされる最大。タイル × unit。大きいほど太い所と細い所の差が出る |
| `river.valleyMin` | 河原（谷底の床）の岸からの幅の下限。タイル × unit |
| `river.valleyVar` | 河原の幅の抽選の幅（下限に 0〜これを足す）。タイル × unit |
| `river.valleyNoise` | 河原の縁が雑音で広がる最大。タイル × unit。大きいほど縁が波打つ |
| `river.valleyHole` | 河原の中に穴（岩）が開く雑音の閾値。0..1。大きいほど岩が増える |
| `river.valleyKeep` | 岸のふちで岩を開けない幅。タイル（拡縮しない）。川に沿った歩ける道の太さ。2 以上が要る |
| `river.roomSpacing` | 岸の洞どうしの最小間隔。タイル × unit |
| `river.roomMax` | 岸の洞の個数の上限。個 × countMul |
| `river.roomClear` | 洞を置かない川沿いの幅（河原の幅に足す）。タイル × unit。小さいと洞が河原に食い込む |
| `river.roomRadiusMin` | 岸の洞の半径の下限。タイル × unit。直径は 2 倍（目安 12〜24 マス） |
| `river.roomRadiusVar` | 岸の洞の半径の抽選の幅。タイル × unit |
| `river.roomGrow` | 洞のノードを部屋として育てる幅 = 洞の半径 × これ。タイル。大きいほど洞の外の通路まで部屋に入る |
| `river.roomLoops` | 同じ岸の洞どうしをつなぐ余分な辺（ループ）の本数。本 × countMul |
| `river.roomLoopLen` | ループにしてよい辺の最長。タイル × unit |
| `river.roadRadiusMin` | 洞どうしの道の半径の下限。タイル（拡縮しない。道幅は半径の 2 倍） |
| `river.roadRadiusVar` | 洞どうしの道の半径の抽選の幅。タイル |
| `river.roadClear` | 道が川の縁に近づける限界。タイル。これより川に近い道は彫らずに捨てる |
| `river.shoreReach` | 川の中心線からこの距離（× unit）より近い洞は、河原へ降りる道を持つ。タイル |
| `river.bridgeBase` | 橋の本数の基準（川が 1 区間分の長さのとき）。本 |
| `river.bridgeExtraChance` | 橋が 1 本増える確率。0..1 |
| `river.bridgeSpan` | 川の長さ ÷ (これ × unit) の倍で橋の本数が増える。タイル |
| `river.bridgeRadius` | 橋の半径。タイル（拡縮しない。橋の幅は半径の 2 倍）。斜めの橋でも幅 2 の窓（2x2）が滑って通るには 1.42 以上が要る |
| `river.bridgeOver` | 橋が岸の外へ張り出す長さ。タイル |
| `river.fordPerBridges` | 橋これだけにつき浅瀬 1 か所（最低 1）。本 |
| `river.fordRadius` | 浅瀬の幅の半径。タイル（拡縮しない） |
| `river.fordHalfLen` | 浅瀬の水たまりの川に沿った半幅。タイル |
| `river.crossJitter` | 渡り場所の間隔の揺らぎ。区間に対する割合 0..1 |
| `river.keepFragment` | つながらない床の欠片をトンネルで本体につなぐ最小のタイル数。これ未満の欠片は埋める。タイル |
| `ring` | 環状の形の数値（ring.json） |
| `ring.coreDensity` | 芯の数の伸び。芯の数 = floor(countMul × この値 + 乱数 0..1)（1〜3 に丸める）。1 で面積 1 倍は 1 つ（約 7 割）か 2 つ、面積 5 倍は 2 つか 3 つ。0 以下で常に 1 つ |
| `ring.pondChance` | 芯が池（穴）になる確率。割合（0..1）。残りは大岩（壁）。全部の芯が同じ種類 |
| `ring.centerJitterX` | 芯の列の中心の横のずれの幅。地図の幅に対する割合（0.125 で ±6%） |
| `ring.centerJitterY` | 芯の列の中心の縦のずれの幅。地図の高さに対する割合 |
| `ring.coreRxMin` | 芯（楕円）の横の半径の下限。タイル（unit 倍される）。添字 = 芯の数 - 1（1 つ・2 つ・3 つ）。芯が多いほど小さい |
| `ring.coreRxSpread` | 芯の横の半径の乱数の幅。タイル（unit 倍）。添字は coreRxMin と同じ |
| `ring.coreRyMin` | 芯の縦の半径の下限。タイル（unit 倍）。添字は coreRxMin と同じ |
| `ring.coreRySpread` | 芯の縦の半径の乱数の幅。タイル（unit 倍）。添字は coreRxMin と同じ |
| `ring.coreAngle` | 芯の傾きの幅。ラジアン（±半分）。添字は coreRxMin と同じ |
| `ring.coreTilt` | 芯の列の縦のずれ（芯どうしの高さの差）。タイル（unit 倍。±半分）。1 つなら効かない |
| `ring.coreGapMul` | 隣の芯との縁の間の幅 = 輪の幅 × この値。2 で輪どうしがちょうど接し 8 の字・鎖になる。小さいと輪が重なる |
| `ring.coreGapSpread` | coreGapMul に足す乱数の幅 |
| `ring.coreEdgeNoise` | 芯の縁の揺れの幅。タイル（輪の形が読める程度）。unit 倍しない |
| `ring.bandWidth` | 輪の道の幅の下限。タイル（道幅なので unit 倍しない）。芯の縁から外へ測る |
| `ring.bandWidthSpread` | 輪の道の幅の乱数の幅。タイル |
| `ring.bandNoise` | 輪の道の外縁の揺れの幅。タイル |
| `ring.rockWidth` | 輪の外に残す岩の帯の厚さの下限。タイル（unit 倍）。この外側が部屋になる |
| `ring.rockWidthSpread` | 岩の帯の厚さの乱数の幅。タイル（unit 倍） |
| `ring.roomMinDist` | 外の部屋の種の最小間隔。タイル（unit 倍） |
| `ring.roomCount` | 外の部屋の種の数の上限（countMul 倍）。個。実際は置けた数 |
| `ring.roomRadius` | 外の部屋の半径の下限。タイル（unit 倍） |
| `ring.roomRadiusSpread` | 外の部屋の半径の乱数の幅。タイル（unit 倍） |
| `ring.roomWallGap` | 部屋どうしを分ける壁の幅（Voronoi の境目）。タイル。unit 倍しない |
| `ring.roomEdgeAmp` | 部屋の縁の揺れの割合。半径に対する割合（0..1） |
| `ring.roomMargin` | 外の部屋の種を置かない地図の縁の幅。タイル |
| `ring.roomAvoidMargin` | 輪と岩の帯の外側でさらに空ける幅。タイル。部屋の種はここより外に置く |
| `ring.nearSlack` | 輪に近い部屋かの判定の余裕。タイル。種から輪の外縁までの距離が 部屋の半径 + これ 未満なら近い部屋 |
| `ring.spokeChance` | 輪に近い部屋が輪へ降りる口を持つ確率。割合（0..1）。近い部屋が 4 未満なら必ず |
| `ring.spokeRadius` | 輪へ降りる口の半径。タイル（幅の半分）。道幅なので据え置き。1.2 以上で幅 2 の窓が斜めでも通る |
| `ring.linkRadius` | 部屋どうしの戸口（最小全域木の辺）の半径。タイル（幅の半分）。据え置き |
| `ring.linkSkipChance` | 近い部屋どうしの戸口を彫らない確率。割合（0..1）。輪でつながるので省ける |
| `ring.shortcutRadius` | 芯を突っ切る近道の半径。タイル（幅の半分）。据え置き |
| `ring.shortcutExtraChance` | 近道がもう 1 本増える確率（芯ごと）。割合（0..1） |
| `ring.shrineChance` | 岩の芯に祠（開けた部屋）ができる確率。割合（0..1）。池の芯には作らない |
| `ring.shrineRadius` | 祠の半径。タイル（unit 倍） |
| `court` | 中庭・寺院の形の数値（court.json） |
| `court.verticalChance` | 軸を縦にする確率（0 = 常に横）。縦は見本で軸が短く幅が広い。割合（0..1） |
| `court.axisPerCourt` | 中庭 1 つあたりの軸の長さの目安。中庭の数 = 軸の長さ ÷ (これ × unit) の小数部を確率に切り上げ・切り捨てを選ぶ。タイル（見本の単位） |
| `court.gateLength` | 門（開始の間）の軸方向の長さ。タイル（見本の単位） |
| `court.gateHalfMin` | 門の半幅（軸から片側）の下限。幅 = 半幅 × 2。タイル（見本の単位） |
| `court.gateHalfSpan` | 門の半幅に足す乱数の幅（0 以上 span 未満の整数）。タイル |
| `court.approachMin` | 門と中庭をつなぐ参道の長さの下限。タイル（見本の単位） |
| `court.approachSpan` | 参道の長さに足す乱数の幅（0 以上 span 未満の整数）。タイル |
| `court.roadHalf` | 参道と、中庭どうしをつなぐ首の半幅（軸から片側）。幅 = これ × 2。道幅なので拡縮しない。2 = 幅 4（開始から主の間まで幅 2 で通る検査の余裕）。タイル |
| `court.hallLengthH` | 本堂（主の間）の軸方向の長さの下限（軸が横のとき）。タイル（見本の単位） |
| `court.hallLengthSpanH` | 本堂の長さに足す乱数の幅（軸が横のとき。0 以上 span 未満の整数）。タイル |
| `court.hallLengthV` | 本堂の軸方向の長さの下限（軸が縦のとき）。タイル（見本の単位） |
| `court.hallLengthSpanV` | 本堂の長さに足す乱数の幅（軸が縦のとき）。タイル |
| `court.hallExtraMin` | 本堂の半幅 = 最後の中庭の半幅 + これ + 乱数。タイル（拡縮しない） |
| `court.hallExtraSpan` | 本堂の半幅に足す乱数の幅（0 以上 span 未満の整数）。タイル |
| `court.courtHalfH` | 中庭の半幅（回廊の内側。軸から片側）の下限（軸が横のとき）。タイル（見本の単位） |
| `court.courtHalfSpanH` | 中庭の半幅に足す乱数の幅（軸が横のとき。0 以上 span 未満の整数）。タイル |
| `court.courtHalfV` | 中庭の半幅の下限（軸が縦のとき）。タイル（見本の単位） |
| `court.courtHalfSpanV` | 中庭の半幅に足す乱数の幅（軸が縦のとき）。タイル |
| `court.lateralBlend` | 横方向の幅の倍率の混ぜ方。0 = unit（部屋の大きさを揃える）、1 = 地図の幅に見本を合わせる倍率（地図を埋める）。割合（0..1） |
| `court.pondChance` | 中庭の飾りが池（穴）になる確率。池・石庭・四本柱は排他。割合（0..1） |
| `court.rockChance` | 中庭の飾りが石庭（岩）になる確率。残りは四本柱。割合（0..1） |
| `court.pondFill` | 池の大きさ = 中庭の中の池に使える長さ・幅 × これ。1 で回廊の内側いっぱい。割合（0..1） |
| `court.bridgeChance` | 池に石橋を渡す確率。割合（0..1） |
| `court.rockCount` | 石庭の岩の数。個（見本の単位。countMul 倍で増える） |
| `court.sideRoomsMin` | 中庭 1 つの片側にある脇の間の数の下限。個。部屋 8 つ以上の検査を満たすため 3 |
| `court.sideRoomLength` | 脇の間の軸方向の長さの目安の下限。脇の間の数 = 中庭の長さ ÷ (目安 × unit)。タイル（見本の単位） |
| `court.sideRoomLengthSpan` | 脇の間の長さの目安に足す幅（連続の乱数）。タイル（見本の単位） |
| `court.sideRoomDepth` | 脇の間の奥行き（回廊の外から）の上限。横方向なので lateralBlend の倍率。タイル（見本の単位） |
| `court.sideRowsMax` | 脇の間の列の数の上限（片側）。横に余裕があるときだけ外回りの廊下をはさんで外側にもう 1 列。列。1 で外側の列なし |
| `court.sideRoomSkipChance` | 脇の間を 1 つ間引く確率（3 つ以上のとき、端でない部屋だけ）。割合（0..1） |
| `court.mirrorChance` | 脇の間を左右の鏡写しにする確率。残りは左右別々に作る。割合（0..1） |
| `court.outerCorridorChance` | 脇の間の外側を通る外回りの廊下（隣の脇の間どうしのループ）を作る確率。割合（0..1） |
| `court.backRoadChance` | 最後の中庭の脇の間から本堂の脇へ抜ける裏道を作る確率。割合（0..1） |
| `drunk` | 掘り手の迷い道の形の数値（drunk.json） |
| `drunk.waypointMinDist` | 目印（掘り手の行き先）どうしの最小の間隔。見本のタイル（unit 倍） |
| `drunk.waypointMax` | 目印の数の上限。個（countMul 倍） |
| `drunk.targetFloor` | 掘る床の目標の割合の下限。割合（0..1。地図全体に対して。拡縮しない）。掘り手が足りなければ届かない。目安 0.38〜0.45 |
| `drunk.targetFloorSpan` | 床の目標の割合の振れ幅。割合 |
| `drunk.turnChance` | 掘り手が 1 歩ごとに左右へ曲がる確率の下限（階ごとに抽選）。割合。小さいほど長い直線 |
| `drunk.turnChanceSpan` | 曲がる確率の振れ幅。割合 |
| `drunk.wideChance` | 幅 2 で掘る掘り手の割合の下限（階ごとに抽選）。割合 |
| `drunk.wideChanceSpan` | 幅 2 の掘り手の割合の振れ幅。割合 |
| `drunk.walkerMax` | 枝の掘り手を出す試行の上限。回（countMul 倍）。床が目標に届けば止まる |
| `drunk.walkerLife` | 枝の掘り手の寿命の下限。見本の歩数（unit 倍） |
| `drunk.walkerLifeSpan` | 枝の掘り手の寿命の振れ幅。見本の歩数 |
| `drunk.waypointChance` | 枝の掘り手が目印を目指す確率。割合 |
| `drunk.poolChance` | 掘り手が寿命で終わった所に溜まりを掘る確率。割合 |
| `drunk.waypointPoolChance` | 目印を目指した掘り手が終わった所に溜まりを掘る確率。割合 |
| `drunk.poolRadius` | 溜まりの半径の下限。見本のタイル（unit 倍） |
| `drunk.poolRadiusSpan` | 溜まりの半径の振れ幅。見本のタイル |
| `drunk.startPool` | 開始の前の溜まりの半径。見本のタイル（unit 倍） |
| `drunk.lordPool` | 主の間の前の溜まりの半径。見本のタイル（unit 倍）。主の間は FLOOR_LORD.arenaRadius が入る広さに |
| `drunk.roomMinDist` | 部屋（溜まり）どうしの最小の間隔。見本のタイル（unit 倍） |
| `drunk.roomCount` | 部屋にする溜まりの数。個（countMul 倍）。掘り手の終点の溜まりで足りなければ、掘った道の上に溜まりを足し掘りする。部屋の数は敵の総数に直結する。開始・主の間は別 |
| `drunk.poolGrowMul` | 溜まりの部屋の広がり（grow）= 半径 × これ + 2。割合 |
| `isle` | 島と桟道の形の数値（isle.json） |
| `isle.manyChance` | 多島になる確率。0..1。残りは大島 |
| `isle.many.spacing` | 多島: 島の中心どうしの最小間隔。タイル × unit |
| `isle.many.maxCount` | 多島: 島の個数の上限。個 × countMul |
| `isle.many.gapMin` | 多島: 島と島の間の水路の幅の下限。タイル × unit |
| `isle.many.gapVar` | 多島: 水路の幅の抽選の幅（下限に 0〜これを足す）。タイル × unit |
| `isle.many.radiusMin` | 多島: 島の半径の下限。タイル × unit |
| `isle.many.radiusVar` | 多島: 島の半径の抽選の幅。タイル × unit |
| `isle.big.spacing` | 大島: 島の中心どうしの最小間隔。タイル × unit |
| `isle.big.maxCount` | 大島: 島の個数の上限。個 × countMul |
| `isle.big.gapMin` | 大島: 島と島の間の水路の幅の下限。タイル × unit |
| `isle.big.gapVar` | 大島: 水路の幅の抽選の幅（下限に 0〜これを足す）。タイル × unit |
| `isle.big.radiusMin` | 大島: 島の半径の下限。タイル × unit |
| `isle.big.radiusVar` | 大島: 島の半径の抽選の幅。タイル × unit |
| `isle.edge` | 島の縁の雑音の揺れ。半径に対する割合 0..1。大きいほど縁がでこぼこする |
| `isle.loopMin` | 桟道の余分な辺（ループ）の本数の下限。本 × countMul |
| `isle.loopVar` | ループの本数の抽選の幅（下限に 0〜これ未満の整数を足す）。本 × countMul |
| `isle.loopLen` | ループにしてよい桟道の最長 = 島の間隔 × これ。倍 |
| `isle.plankRadius` | 桟道の半径。タイル（拡縮しない。桟道の幅は半径の 2 倍）。斜めの桟道でも幅 2 の窓（2x2）が滑って通るには 1.42 以上が要る |
| `isle.bendChance` | 桟道が 1 回だけ折れる確率。0..1。折れるのは両端がどちらも 4 マス以上離れているときだけ |
| `isle.stoneCount` | 飛び石の小島を置く試行回数。個 × countMul。島から離れた海にだけ置く |
| `isle.stoneRadiusMin` | 飛び石の半径の下限。タイル（拡縮しない） |
| `isle.stoneRadiusVar` | 飛び石の半径の抽選の幅。タイル |
| `isle.stoneClear` | 飛び石と島の間にあける海の幅。タイル。島の縁に触れると桟道でない所が島の扉になる |
| `isle.keepFragment` | 島と桟道につながらない小島をトンネル（桟道）で本体につなぐ最小のタイル数。これ未満は海に戻す。タイル |
| `terrace` | 縦穴・段々の形の数値（terrace.json） |
| `terrace.bandsMin` | 段の数の基準の下限。見本の高さ（64x40）での段の数。実際の段の数 = 四捨五入（地図の高さ ÷ (previewHeight × unit) × (これ + 乱数 0..bandsSpread-1))、3 以上。段 |
| `terrace.bandsSpread` | 段の数の基準の乱数の幅（整数。bandsMin から bandsMin + これ - 1 まで一様）。段 |
| `terrace.floorShare` | 段の床が使える高さ（地図の高さから縁とうねりを引いた分）に占める割合の基準。割合（0..1）。残りが段の間の壁。上げると床の割合が増える（検査の上限 0.7 に注意） |
| `terrace.floorShareSpread` | floorShare の乱数の幅（±半分）。割合 |
| `terrace.gapMin` | 段の間の壁の厚みの下限。タイル。据え置き（部屋どうしが 8 近傍で接しないための間隔） |
| `terrace.waveAmp` | 全部の段で共通のうねりの振れ幅の下限。タイル（unit 倍）。振れ幅の分だけ段を細くする |
| `terrace.waveAmpSpread` | うねりの振れ幅の乱数の幅。タイル（unit 倍） |
| `terrace.waveLen` | うねりの波長の下限。タイル（unit 倍） |
| `terrace.waveLenSpread` | うねりの波長の乱数の幅。タイル（unit 倍） |
| `terrace.slopeMax` | 段全体の傾き（1 タイル横へ進むときの縦のずれ）の上限。±これ。うねりと合わせた振れ幅が段の数 × 1.3 × unit を超えない範囲に縮める |
| `terrace.edgeNoise` | 段の上下の縁の揺れの幅。タイル。unit 倍しない |
| `terrace.edgePeriod` | 段の縁の雑音の周期。タイル（unit 倍） |
| `terrace.endInset` | 段の左右の端を地図の縁から空ける幅の下限。タイル（unit 倍） |
| `terrace.endInsetSpread` | 段の端の空きの乱数の幅（整数マス）。タイル（unit 倍） |
| `terrace.taperLen` | 段の端で上下が狭まり始める手前の長さ。タイル。据え置き |
| `terrace.taperStep` | 端の 1 マスごとに上下から削る量。タイル |
| `terrace.rockThreshold` | 段の中の岩ができる雑音の閾値。0..1。下げると岩が増える。遮蔽物 |
| `terrace.rockPeriod` | 岩の雑音の周期。タイル（unit 倍）。大きいほど岩が大きい |
| `terrace.rockMargin` | 段の上下の縁から岩を置かない幅。タイル。据え置き（段に沿った幅 2 の通り道を残す。2 以上） |
| `terrace.rockEndMargin` | 段の左右の端から岩を置かない幅。タイル（unit 倍） |
| `terrace.rockMinBand` | 岩を置く段の高さの下限。タイル。これより細い段には置かない |
| `terrace.rampRadius` | 段の端の坂の半径。タイル（幅の半分）。据え置き。1.2 以上で幅 2 の窓が斜めでも通る |
| `terrace.rampInset` | 坂の根元を段の端から内側へ入れる幅の下限。タイル（unit 倍） |
| `terrace.rampInsetSpread` | 坂の根元の内側への入れ幅の乱数の幅。タイル（unit 倍） |
| `terrace.rampRun` | 坂が段の端から内側へ折り返す横の長さ。タイル（unit 倍） |
| `terrace.ladderNoneChance` | 段の間にはしご口（細い近道）が 1 本も無い確率。割合（0..1） |
| `terrace.ladderOneChance` | はしご口があるとき、基準が 1 本になる確率。残りは 2 本。割合（0..1）。実際の本数は基準 × countMul（四捨五入） |
| `terrace.ladderRadius` | はしご口の半径。タイル（幅の半分）。据え置き。幅 1〜2 の細い道 |
| `terrace.ladderSpan` | はしご口の横の位置のばらつき。地図の幅に対する割合（中央から ±半分） |
| `terrace.ladderMargin` | はしご口を段の端から離す幅。タイル |
| `terrace.shaftChance` | 縦穴が開く確率。割合（0..1） |
| `terrace.shaftSpan` | 縦穴の中心の横のずれの幅。地図の幅に対する割合（中央から ±半分） |
| `terrace.shaftWidth` | 縦穴の半幅の下限。タイル（unit 倍） |
| `terrace.shaftWidthSpread` | 縦穴の半幅の乱数の幅。タイル（unit 倍） |
| `terrace.shaftWobble` | 縦穴が上から下へ曲がる幅。タイル（unit 倍） |
| `terrace.shaftEdgeNoise` | 縦穴の縁の揺れの幅。タイル。unit 倍しない |
| `terrace.bridgeRadius` | 縦穴を渡る橋の半径。タイル（幅の半分）。据え置き。1.1 以上で幅 2 になる |
| `terrace.bridgeReach` | 橋が縦穴の縁（曲がりと揺れの分を含む）から両側へ余分に伸びる長さ。タイル |
| `terrace.chunkWidth` | 1 つの段を部屋に区切る幅。タイル（unit 倍）。区切りの縦の 1 列が扉になる。段の長さ ÷ これ（四捨五入）の部屋ができる |
| `terrace.startInset` | 開始の部屋を決める位置。最初の段の端から内側へ入れる幅。タイル（unit 倍） |
| `terrace.lordInset` | 主の間を決める位置。最後の段の奥の端から内側へ入れる幅。タイル（unit 倍） |
| `terrace.minBandHeight` | 段の高さの下限。タイル。これ未満になる地図の大きさでは作らない |
| `prefab` | 断片の組み合わせの形の数値（prefab.json） |
| `prefab.horizontalChance` | 開始と主の間を地図の左右の端に置く確率。残りは上下の端。割合（0..1） |
| `prefab.baseCount` | 最初に置く断片の数（開始・主の間を含む）の下限。個（見本の単位。countMul 倍） |
| `prefab.baseSpan` | 最初に置く断片の数に足す乱数の幅（0 以上 span 未満の整数）。個 |
| `prefab.fillCount` | 空き地へ差し込んだあとの断片の数の目標の下限。個（見本の単位。countMul 倍） |
| `prefab.fillSpan` | 断片の数の目標に足す乱数の幅（0 以上 span 未満の整数）。個 |
| `prefab.relaxIters` | 重なりを押し離す緩和の最大の回数。回 |
| `prefab.relaxGap` | 断片どうしを離す余白（外接矩形の間の空きマス）。緩和と差し込みで使う。タイル |
| `prefab.keepGap` | 緩和のあとに、これ未満しか離れていない断片を捨てる余白。開始と主の間は捨てない。タイル |
| `prefab.insertTries` | 空き地へ差し込む試行の回数の上限。回（見本の単位。countMul 倍） |
| `prefab.insertSamples` | 差し込みの 1 試行で試す乱択の点の数。点ごとに置いた断片と突き合わせる（全マスを調べない）。個 |
| `prefab.loops` | 最小全域木に足すループの辺の数。本（見本の単位。countMul 倍） |
| `prefab.loopMaxLen` | ループの辺にする断片どうしの距離の上限（中心どうし）。タイル（見本の単位。unit 倍） |
| `prefab.wideChance` | 廊下を太くする確率（開始につながる廊下は常に通常の幅）。割合（0..1） |
| `prefab.corridorWidth` | 廊下の幅。道幅なので拡縮しない。2 = 開始から主の間まで幅 2 で通る検査を満たす。タイル |
| `prefab.wideCorridorWidth` | 太い廊下の幅。タイル |

## feel/FEEL

| 項目 | 意味 |
| --- | --- |
| `hitstopLight` | 通常命中のヒットストップの既定（ステップ。60Hz。段・重さが持たないときの値）。3→1（core-synthesis 3-6。止まる時間を絞り、重い命中だけ止める） |
| `hitstopNormalMax` | 通常命中（怯ませていない・終撃でない・会心でない）のヒットストップの上限（ステップ）。段の JSON の hitstop がこれを超えても切り詰める。0 で通常命中は止まらない。目安 0〜1 |
| `hitstopCounter` | 出端（下絵の間に振り始めた近接 / 撃った放出の弾の命中）のヒットストップ（ステップ）。通常命中の上限 hitstopNormalMax の例外で、読みの報酬として止める |
| `hitstopHeavy` | （未記入） |
| `hitstopKill` | 普通の撃破のヒットストップ（ステップ）。6→3（読み合いの手直し。手数のテンポを守る） |
| `hitstopKillMark` | 節目の撃破（陣の最後の 1 体・大将・精鋭・ボス）のヒットストップ（ステップ） |
| `hitstopFinisher` | （未記入） |
| `shakeLight` | （未記入） |
| `shakeHeavy` | （未記入） |
| `shakeHurt` | （未記入） |
| `shakeSpecial` | （未記入） |
| `kickHeavy` | （未記入） |
| `kickDecay` | （未記入） |
| `justDodgeSlowmo` | （未記入） |
| `slowmoScale` | （未記入） |
| `comboWindow` | （未記入） |
| `branchTextScale` | （未記入） |
| `branchTextLife` | （未記入） |
| `branchTextColor` | （未記入） |
| `swingImpact` | （未記入） |

## feel/EFFECTS

| 項目 | 意味 |
| --- | --- |
| `maxParticles` | （未記入） |
| `maxTexts` | （未記入） |
| `maxShapes` | （未記入） |
| `maxDeaths` | （未記入） |
| `maxMarks` | （未記入） |
| `statusKindsPerEnemy` | （未記入） |
| `statusParticlesPerKind` | （未記入） |
| `statusTintAlpha` | （未記入） |
| `death.life.burst` | （未記入） |
| `death.life.ash` | （未記入） |
| `death.life.shatter` | （未記入） |
| `death.life.discharge` | （未記入） |
| `death.life.melt` | （未記入） |
| `death.life.blood` | （未記入） |
| `death.life.sever` | （未記入） |
| `death.life.void` | （未記入） |
| `death.life.holy` | （未記入） |
| `death.particles` | （未記入） |
| `death.shardSpeed` | （未記入） |
| `death.ashRise` | （未記入） |
| `death.severGap` | （未記入） |
| `death.dischargeHop` | （未記入） |
| `death.bloodSpeed` | （未記入） |
| `hitSpark.count` | （未記入） |
| `hitSpark.speed` | （未記入） |
| `hitSpark.life` | （未記入） |
| `comboTiers[].min` | （未記入） |
| `comboTiers[].scale` | （未記入） |
| `comboTiers[].color` | （未記入） |
| `comboMilestones` | （未記入） |
| `clearWave.life` | （未記入） |
| `clearWave.speed` | （未記入） |
| `clearWave.band` | （未記入） |
| `clearWave.alpha` | （未記入） |
| `clearWave.color` | （未記入） |
| `clearWave.edgeAlpha` | （未記入） |
| `eliteBurst.life` | （未記入） |
| `eliteBurst.radius` | （未記入） |
| `eliteBurst.tintAlpha` | （未記入） |
| `eliteBurst.particles` | （未記入） |
| `bossLight.life` | （未記入） |
| `bossLight.rays` | （未記入） |
| `bossLight.rayWidth` | （未記入） |
| `bossLight.alpha` | （未記入） |
| `bossLight.color` | （未記入） |
| `justRing.life` | （未記入） |
| `justRing.radius` | （未記入） |
| `justRing.lines` | （未記入） |
| `justRing.color` | （未記入） |
| `synergyGlow.life` | （未記入） |
| `synergyGlow.radius` | （未記入） |
| `synergyGlow.color` | （未記入） |
| `weakCrack.life` | （未記入） |
| `weakCrack.size` | （未記入） |
| `weakCrack.lines` | （未記入） |
| `weakCrack.color` | （未記入） |
| `critFlash.life` | （未記入） |
| `doorSlam.life` | （未記入） |
| `doorSlam.drop` | （未記入） |
| `doorSlam.color` | （未記入） |
| `doorSlam.hordeColor` | （未記入） |
| `chargeUp.life` | （未記入） |
| `chargeUp.radius` | （未記入） |
| `dropBeam.life` | （未記入） |
| `dropBeam.height` | （未記入） |
| `dropBeam.width` | （未記入） |
| `dashGhost.interval` | （未記入） |
| `dashGhost.life` | （未記入） |
| `dashGhost.alpha` | （未記入） |
| `dashGhost.color` | （未記入） |
| `floorCard.delay` | （未記入） |
| `floorCard.fadeIn` | （未記入） |
| `floorCard.hold` | （未記入） |
| `floorCard.fadeOut` | （未記入） |

## feel/MINIMAP

| 項目 | 意味 |
| --- | --- |
| `revealRadius` | プレイヤーの周りで探索済みにする半径。タイル |
| `maxWidth` | ミニマップの幅の上限。px（論理座標 480x270）。マップがこれより大きいと縮めて表示する |
| `maxHeight` | ミニマップの高さの上限。px。画面右上を塞がない大きさ |

## feel/FX_ATTACK

攻撃エフェクト（src/render/fxAttack.ts / fxMath.ts・system/effects.ts の spawnBlast）。

| 項目 | 意味 |
| --- | --- |
| `maxEvents` | （未記入） |
| `slash.thickness` | （未記入） |
| `slash.widthMul` | （未記入） |
| `slash.heavyMul` | （未記入） |
| `slash.tailRatio` | （未記入） |
| `slash.segments` | （未記入） |
| `slash.alpha` | （未記入） |
| `slash.glowAlpha` | （未記入） |
| `slash.coreAlpha` | （未記入） |
| `slash.coreFrom` | （未記入） |
| `slash.fadeTime` | （未記入） |
| `slash.tipGlow` | （未記入） |
| `slash.heavyTipGlow` | （未記入） |
| `slash.thrustWidth` | （未記入） |
| `hitSpark.life` | （未記入） |
| `hitSpark.length` | （未記入） |
| `hitSpark.width` | （未記入） |
| `hitSpark.critMul` | （未記入） |
| `hitSpark.weakMul` | （未記入） |
| `hitSpark.heavyMul` | （未記入） |
| `hitSpark.sparks` | （未記入） |
| `hitSpark.sparkSpeed` | （未記入） |
| `hitSpark.glow` | （未記入） |
| `hitSpark.critColor` | （未記入） |
| `impact.life` | （未記入） |
| `impact.rays` | （未記入） |
| `impact.length` | （未記入） |
| `impact.ring` | （未記入） |
| `impact.killMul` | （未記入） |
| `impact.fizzleLife` | （未記入） |
| `muzzle.life` | （未記入） |
| `muzzle.length` | （未記入） |
| `muzzle.width` | （未記入） |
| `muzzle.glow` | （未記入） |
| `muzzle.spreadWidthMul` | （未記入） |
| `muzzle.chargeMul` | （未記入） |
| `muzzle.pierceLengthMul` | （未記入） |
| `bullet.trailTime` | （未記入） |
| `bullet.maxTrail` | （未記入） |
| `bullet.glow` | （未記入） |
| `bullet.glowAlpha` | （未記入） |
| `bullet.coreAlpha` | （未記入） |
| `bullet.trailAlpha` | （未記入） |
| `bullet.pierceTrailMul` | （未記入） |
| `bullet.chargeGlowMul` | （未記入） |
| `bullet.enemyGlowAlpha` | （未記入） |
| `bullet.enemyColor` | （未記入） |
| `blast.life` | （未記入） |
| `blast.flashEnd` | （未記入） |
| `blast.fireEnd` | （未記入） |
| `blast.fireCore` | （未記入） |
| `blast.smokeColor` | （未記入） |
| `blast.smokeAlpha` | （未記入） |
| `blast.debris` | （未記入） |
| `blast.debrisColor` | （未記入） |
| `blast.debrisReach` | （未記入） |
| `blast.scorchLife` | （未記入） |
| `blast.scorchAlpha` | （未記入） |
| `blast.scorchColor` | （未記入） |
| `blast.scorchRatio` | （未記入） |
| `blast.embers` | （未記入） |
| `blast.emberSpeed` | （未記入） |
| `ring.flashTime` | （未記入） |
| `ring.flashAlpha` | （未記入） |
| `ring.glowWidth` | （未記入） |
| `ring.glowAlpha` | （未記入） |
| `bolt.segments` | （未記入） |
| `bolt.jitter` | （未記入） |
| `bolt.branches` | （未記入） |
| `bolt.branchRatio` | （未記入） |
| `bolt.glowWidth` | （未記入） |
| `bolt.glowAlpha` | （未記入） |
| `bolt.flicker` | （未記入） |
| `particle.streakTime` | （未記入） |
| `particle.streakMinSpeed` | （未記入） |
| `particle.emberHot` | （未記入） |
| `particle.emberCool` | （未記入） |
| `sprite.swingFade` | 振り終わり（recover）で崩れのフレームを流し切る時間。秒。0.15〜0.3 |
| `sprite.hitLife` | 命中（軽）の絵を流し切る時間。秒 |
| `sprite.hitHeavyLife` | 命中（重い段・会心・弱点）の絵を流し切る時間。秒 |
| `sprite.parryLife` | 受け流し成功の絵を流し切る時間。秒 |
| `sprite.scaleTolerance` | 当たり判定の大きさと絵の基準の大きさの差がこの割合以内なら拡縮しない（ドットを崩さない）。割合 0..1 |
| `sprite.tipGlow` | 振りの当たりの中心に重ねる加算の光の濃さ。割合 0..1 |
| `sprite.glowR` | その光の半径。px |
| `sprite.heavyGlowR` | 重い段の光の半径。px |
| `sprite.muzzleLife` | 弾の専用スプライトの銃口・詠唱の絵を流し切る時間。秒 |
| `sprite.impactLife` | 弾の着弾（壁・敵）の絵を流し切る時間。秒 |
| `sprite.fizzleLife` | 弾が射程で尽きたときの絵を流し切る時間。秒 |
| `sprite.bulletGlow` | 飛んでいる弾の絵に重ねる加算の光の濃さ。割合 0..1 |
| `sprite.bulletGlowR` | その光の半径（弾の半径に足す）。px |
| `sprite.ultEventLife` | 奥義の見た目の出来事を残す秒（絵ごとの長さの上限。これより長い絵は途中で切れる） |
| `sprite.maxUltEvents` | 奥義の見た目の出来事を同時に持つ上限。件 |

## feel/MUSIC

| 項目 | 意味 |
| --- | --- |
| `gain` | （未記入） |
| `defaultVolume` | （未記入） |
| `lookahead` | （未記入） |
| `crossfade` | （未記入） |
| `percFade` | （未記入） |
| `resolveTime` | （未記入） |
| `bossDownTempoMul` | （未記入） |
| `resyncGap` | （未記入） |

## feel/FX_WAVE3

| 項目 | 意味 |
| --- | --- |
| `counterMono.time` | （未記入） |
| `counterMono.strength` | （未記入） |
| `damageText.*.color` | （未記入） |
| `damageText.*.scale` | （未記入） |
| `damageText.*.ticks` | （未記入） |
| `damageText.*.life` | （未記入） |
| `damageText.*.rise` | （未記入） |
| `damageText.*.interval` | （未記入） |
| `damageText.*.maxTallies` | （未記入） |
| `damageText.*.burn` | （未記入） |
| `damageText.*.poison` | （未記入） |
| `damageText.*.bleed` | （未記入） |
| `damageText.*.other` | （未記入） |
| `mantle.rx` | （未記入） |
| `mantle.ry` | （未記入） |
| `mantle.footY` | （未記入） |
| `mantle.alpha` | （未記入） |
| `mantle.pulseSpeed` | （未記入） |
| `mantle.motes` | （未記入） |
| `mantle.moteSpeed` | （未記入） |
| `mantle.moteAlpha` | （未記入） |
| `keystoneAura.radius` | （未記入） |
| `keystoneAura.alpha` | （未記入） |
| `keystoneAura.spin` | （未記入） |
| `keystoneAura.gap` | （未記入） |
| `budBloom.life` | （未記入） |
| `budBloom.height` | （未記入） |
| `budBloom.width` | （未記入） |
| `budBloom.particles` | （未記入） |
| `budBloom.speed` | （未記入） |
| `budBloom.color` | （未記入） |
| `budBloom.leafColor` | （未記入） |
| `budBloom.leafSize` | （未記入） |
| `inscribe.life` | （未記入） |
| `inscribe.radius` | （未記入） |
| `inscribe.particles` | （未記入） |
| `inscribe.color` | （未記入） |
| `debanaSplash.life` | 出端の墨の飛沫が消えるまでの長さ（秒）。文字を出さない代わりに出端を見せる |
| `debanaSplash.radius` | 飛沫が届く半径（論理 px） |
| `debanaSplash.drops` | 飛び散る墨の粒の数 |
| `debanaSplash.inkColor` | 墨の粒の色 |
| `debanaSplash.edgeColor` | 粒の縁の色（出端の色） |
| `lordPull.life` | 墨の渦が消える（現れる）演出の長さ（秒） |
| `lordPull.delay` | 元の位置で消え始めてから、先で現れ始めるまでの間（秒。消える → 現れるの順に読ませる） |
| `lordPull.radius` | 渦の最大の半径（論理 px） |
| `lordPull.arms` | 渦の腕の本数 |
| `lordPull.dots` | 腕 1 本の墨の粒の数 |
| `lordPull.turns` | 腕が中心へ巻く回数（外縁から中心まで） |
| `lordPull.spin` | 演出の間に渦が回る量（回転数） |
| `lordPull.glow` | 章の色の光の半径（論理 px） |
| `lordPull.ringWidth` | 章の色の輪の太さ（論理 px） |
| `lordPull.inkColor` | （未記入） |
| `lordPull.chapterColors` | 章 1〜4 の渦の縁と浮き文字の色（章が足りなければ最後の色） |
| `heartbeat.slow` | （未記入） |
| `heartbeat.fast` | （未記入） |
| `heartbeat.warnMin` | （未記入） |
| `heartbeat.warnMax` | （未記入） |
| `heartbeat.chaseMin` | （未記入） |
| `heartbeat.near` | （未記入） |
| `heartbeat.far` | （未記入） |

## feel/SFX_WAVE3

| 項目 | 意味 |
| --- | --- |
| `muffle.cutoff` | （未記入） |
| `muffle.open` | （未記入） |
| `muffle.closeTime` | （未記入） |
| `muffle.openTime` | （未記入） |

## feel/TELEGRAPH

敵の予告の線（render/inkStroke.ts・inkFill.ts・inkMarks.ts・telegraphInk.ts・telegraphLayer.ts）。

| 項目 | 意味 |
| --- | --- |
| `usuzumiColor` | 薄墨（下絵）の代表の色。墨の段 1（steel の最も淡い段）と同じ。予告の図解の下絵の帯・符号表の予約色 |
| `usuzumiLightColor` | 下絵の明るい印の色（頭上の ○・折れ線の曲がり角・陣図の筆先と的の輪） |
| `sumiColor` | 濃墨（墨入れ）の色。頭上の ● の地も同じ |
| `shuColor` | 朱。墨入れの入りの墨溜まり・線の先端の点・頭上の ● の芯・予備動作の止まらない段の体の点滅 |
| `shuLightColor` | 朱の墨溜まりの照り（左上の小さな明るい点） |
| `gofunColor` | 胡粉。墨入れの外側 1 ドットに敷く白い滲み（暗い床で黒が沈まないように）。怯みの印・星読みの眼の目盛りも同じ色 |
| `minLength` | 線の最短 px（攻撃中の移動で届く距離をこの範囲に丸める） |
| `maxLength` | 線の最長 px |
| `fallbackLength` | 届く距離を持たない敵（ボスの個別の技など）の線の長さ px |
| `brushWidth` | 筆の太さ（論理 px。下絵・墨入れとも。入りで太り、抜きで細る）。ドットにすると 2 倍 |
| `brushEntryMin` | 入りの押さえ始めの太さの倍率（0..1。入りの 3px で 1 へ太る） |
| `brushPoolScale` | 入りの墨溜まり（根元の太り）の太さの倍率の増し分 |
| `brushTailPx` | 筆の抜き（先端の細り・払い）の長さの上限（論理 px） |
| `brushTailRatio` | 抜きの長さの、線の全長に対する上限の割合(0..1) |
| `brushTailDrop` | 抜きの先で太さが落ちる割合(0..1) |
| `areaWidthRatio` | 輪・扇の筆の太さの上限（半径・射程に対する割合）。小さな範囲が帯と滲みで埋まらないように |
| `brushStartInsetRatio` | 線の根元を敵の体の縁まで下げるとき、線の長さに対して下げてよい上限の割合(0..1) |
| `sketchSecondAlpha` | 折れ線の 2 本目の下絵の濃さの倍率 |
| `inkDry` | 墨入れの抜きの払いで墨が尽きて淡くなる強さ(0..1) |
| `inkHaloAlpha` | 墨入れの外側 1 ドットの胡粉の滲みの不透明度(0..1)。ぼかさない |
| `inkHaloImminentAlpha` | 攻撃の直前（残り imminentSec 以下）と攻撃中の胡粉の滲みの不透明度(0..1) |
| `imminentSec` | 攻撃の直前とみなす予備動作の残り秒（胡粉の滲みが濃くなる） |
| `traceHaloMul` | 被弾筋の胡粉の滲みの濃さの倍率（朱を持たない過去の一筆） |
| `splatterCount` | 墨入れの入りで敵の側へ飛ぶ墨の粒の数 |
| `splatterSpread` | 入りの粒の散る距離（論理 px） |
| `shuPoolAt` | 朱の墨溜まりを置く、線の根元からの距離（論理 px） |
| `shuPoolRadius` | 朱の墨溜まりの半径（論理 px）。ドットの円 + 左上に照りの 1 ドット |
| `shuTipRadius` | 線の先端の朱の点の半径（論理 px） |
| `sketchCell` | 下絵の掠れの区切りの長さ（論理 px）。筋ごとにこの長さで途切れ、欠けの割合（怯み値）で欠ける区切りが増える |
| `sketchGapBase` | 下絵の欠け（掠れて描かない所）の割合の基準(0..1)。怯み値が 0 のとき |
| `sketchGapPoise` | 怯み値の割合 1 のとき基準に足す欠けの割合(0..1)。当てるほど線が掠れて「あと何撃で崩れるか」を読ませる |
| `sketchGapMax` | 欠けの割合の上限(0..1) |
| `headMarkSize` | 頭上の印（薄墨の ○ / 濃墨に朱の ●）の外径（論理 px）。ドットの円で描く |
| `headMarkRise` | 頭上の印の中心を、敵の頭の上（体の 2px 上）からさらに上へ上げる高さ（論理 px） |
| `eraseSec` | 下絵を崩した（怯みで潰した）とき、線が横へ散って消える秒数 |
| `eraseDriftPx` | 散るときに横へずれる距離（論理 px） |
| `veerSec` | 墨入れを受け流したとき、筆先が逸れて薄れる秒数 |
| `veerAngleDeg` | 筆先が逸れる角度（度。先端が根元を中心に曲がる） |
| `playerGapPad` | 自分の体の上を抜く円の余白（論理 px）。描き込み全体に 1 回だけ掛ける |
| `leadMarkSize` | 星読みの眼の残り秒の目盛りの一辺（論理 px） |
| `inkFall` | 墨入れの段が芯（真っ黒）から縁へ淡くなる強さ(0..1)。大きいほど縁が淡墨 |
| `inkDryFrom` | 墨入れの抜きで墨が尽き始める位置（線の全長に対する割合 0..1） |
| `sketchAlpha` | 下絵（線・面）のドットの不透明度(0..1)。市松に間引いた上で掛ける |
| `fillAlpha` | 墨入れの範囲の内側のむらのドットの不透明度(0..1) |
| `muraBase` | 範囲の内側のむらの濃さの基準(0..1)。順序ディザの閾がこれ未満のドットを塗る |
| `muraNoise` | むらの雑音（0..1）に掛けて濃さに足す倍率 |
| `muraEdge` | 縁で濃さに足す量(0..1)。縁から奥へ muraEdgeReach の深さで 0 になる |
| `muraEdgeReach` | 縁を濃くする帯の深さ（半径・射程に対する割合 0..1） |

## feel/TELEGRAPH_POSE

予備動作の体の動き（render/renderer.ts の drawEnemy）。

| 項目 | 意味 |
| --- | --- |
| `leanPx` | 下絵の終わりの最大ののけぞり（論理 px。攻撃の逆向き） |
| `squashMax` | 下絵の終わりに縦へ縮む割合(0..1)。横はその半分だけ広がる |
| `stretch` | 墨入れに入った瞬間の伸び（攻撃の向きの軸の倍率に足す割合） |
| `stretchSec` | 張りの長さ（秒） |
| `stretchPx` | 張りの瞬間に攻撃の向きへ出る距離（論理 px） |
| `refRadius` | この体の半径（論理 px）を超える敵は、溜めと張りをこの比で小さくする。大きな体（ボス）で全身が動かないように |

## feel/SIGN_CHECK

符号表の検査の閾（data/signs.ts・data/signs.test.ts）。

| 項目 | 意味 |
| --- | --- |
| `oklabMinDist` | 予約色（薄墨・濃墨・朱・胡粉）と世界の層の他の色の OKLab の距離の下限 |
| `lumaMinDelta` | 距離が足りなくても通す相対輝度の差の下限(0..1)。形や動きが違えば明るさで分かれる |
| `readyCommitLumaMin` | 薄墨（下絵）と濃墨（墨入れ）、胡粉と濃墨の相対輝度の差の下限(0..1)。灰色にしても 2 段が明暗で分かれる |
| `usuzumiChromaMax` | 下絵の薄墨（滲み・筋）の色の彩度（OKLab の a, b の長さ）の上限。色味の無い灰に保ち、色の予告と取り違えない |

## feel/THREAT_CUE

敵の攻撃が自分に掛かるかの判定の余裕と、殺気（画面外の敵が自分に掛かる攻撃へ入った合図）・被弾筋（当てた相手から自分への墨の一筆）の見た目（system/threat.ts・render/threatCue.ts）。

| 項目 | 意味 |
| --- | --- |
| `hitPad` | 「掛かる」とみなす余裕（論理 px）。線の端・輪や扇の縁から自分の体の半径にこれを足した内側なら掛かるとみなす |
| `shotAimDeg` | 線も範囲も持たない射手などが、自分を狙っているとみなす角度（度）。狙いの向きと自分の方向の差がこれ以下なら掛かる |
| `edgeSec` | 殺気（画面の縁の墨の払い）が出ている秒数 |
| `edgeMax` | 殺気の同時に出す最大の数（古い物から消す） |
| `edgeLength` | 殺気の払いの長さ（論理 px。縁から画面の内側へ向かう） |
| `edgeInset` | 殺気の払いの根元を画面の縁から内側へ置く距離（論理 px） |
| `traceSec` | 被弾筋（当てた相手から自分への墨の一筆）が乾いて消えるまでの秒数 |
| `traceSecLow` | 生命が少ないとき（traceLowHpRatio 以下）の被弾筋の秒数。長く残して「何に当たったか」を見せる |
| `traceLowHpRatio` | 被弾筋を長く残す生命の割合(0..1) |
| `traceAlpha` | 被弾筋の最初の濃さ(0..1)。赤い芯を持たない墨の影 |
| `traceSourceReach` | 弾を出どころにするとき、被弾の瞬間に自分からこの距離（論理 px）以内の敵弾だけを探す |

## feel/NARIMONO

予告の音（鳴物帳）の規則の数（audio/narimono.ts・audio/cues.ts）。

| 項目 | 意味 |
| --- | --- |
| `clackGapSec` | 柝頭（自分に掛かる攻撃が赤に入った合図）を鳴らす最短の間隔（秒）。鳴り続ける合図は合図にならない |
| `clackMaxDist` | 柝頭を鳴らす敵の最長の距離（論理 px）。これより遠い敵の赤は鳴らさない |
| `clackPanMax` | 柝頭の左右の振りの最大(0..1)。敵の画面上の横位置で振る |
| `clackVolume` | 柝頭の音量の倍率(0..1) |
| `tsukeGapSec` | 附打（読みの成功の板を打つ音）を重ねない最短の間隔（秒） |

## feel/MENU_BUDGET

持ち物メニュー（装束・紋・候補・系統・スキル・加護・金床）の情報の予算（docs/ideas/inventory-v2/E-merged.md 4 章）。

| 項目 | 意味 |
| --- | --- |
| `textLines` | 画面が出す文の行の上限（見出し 1・荷札 2・操作案内 1）。札の名前・丸印の 1 字・珠は数えない。行 |
| `compareTextLines` | 比べる場面（候補）だけの文の行の上限（荷札 1 + 差 3 + 見出し・操作案内）。行 |
| `bodyLines` | BODY（10px 以上）の行の上限。荷札の 1 行目だけで、他は SMALL。行 |
| `numbers` | UI が出す数の上限（階・件数「2/4」・段の数・残響の量）。性質の文に含まれる値は文の行で縛るので数えない。個 |
| `compareNumbers` | 比べる場面（候補）だけの数の上限。替わる地金のステータスを「防御力 12 → 15」と今の値と付けた後の値で出すので、numbers に innateDiffs 項目 × 2 を足した数。個 |
| `candidates` | 候補の 1 頁の枚数。送りで次の頁。枚 |
| `diffRows` | 候補の差の行（得る・失う）の上限。残りは「ほか n」。行 |
| `innateDiffs` | 候補の地金の差（変わるステータスの「今 → 後」の行）の上限。溢れは最後の行を「ほか n」にする。個 |
| `morphRows` | 比べるときの動く紋の行の上限。動く帯を必ず残す。行 |
| `bands` | 紋の帯の本数。stepped = 段の立った系統、undercurrent = 伏流（源か糧を 1 つ以上持つが段の立っていない系統）。本 |
| `beads` | 1 本の帯の珠の上限。source = 源、sink = 糧、amplifier = 強め。超えたら畳んだ珠。個 |

## feel/MAP_LIGHT

地図の光と暗がり（render/mapLight.ts）。

| 項目 | 意味 |
| --- | --- |
| `chapterDark` | 章 1〜4 の地図の暗さ（黒の不透明度。0..1）。章が進むほど暗い。廃城の霜・炎は章 3 と同じ |
| `finalDark` | 最深の間（墨と朱の間）の地図の暗さ。0..1。章 4 より明るくして墨の画を守る |
| `deepDark` | 深み（22 階〜）の地図の暗さ。0..1。変異「霧」で +0.05 |
| `playerLightRadius` | プレイヤーの光の半径。px（論理座標）。縦は 1/1.15 に潰れた楕円 |
| `playerLightStrength` | プレイヤーの光の強さ。0..1 の目安。強さに応じて段の数が変わる（0.12 / 0.38 / 0.7 を超えた段だけ抜ける） |
| `lavaLightRadius` | 溶岩の地形・溶岩の穴の光の半径。px。2 マスおき（市松）に置く |
| `lavaLightStrength` | 溶岩の光の強さ。0..1 の目安 |
| `fireLightRadius` | 炎の地形の光の半径。px。2 マスおき（市松）に置く |
| `fireLightStrength` | 炎の地形の光の強さ。0..1 の目安。state.time でゆらぐ |
| `stairsLightRadius` | 階段の光の半径。px |
| `stairsLightStrength` | 階段の光の強さ。0..1 の目安 |
| `springLightRadius` | 泉の光の半径。px |
| `springLightStrength` | 泉の光の強さ。0..1 の目安 |
| `maxLights` | 1 フレームに抜く光源の上限。プレイヤーに近い順に残す。個 |
| `lightTint` | 光の色を重ねる強さ（soft-light の不透明度の上限）。0..1。段ごとに 1/3・2/3・1 を掛ける |

## feel/FLOAT_TEXT

戦闘中に浮かぶ文字（浮き文字）の大きさ・寿命・重複の抑え方。

| 項目 | 意味 |
| --- | --- |
| `px` | 種類ごとの文字の高さ（論理 px。8 が通常のダメージ数字。8 を少しでも超えると 12 に跳ねるので 8 以下に保つ）。px |
| `maxMul` | 文字のドット倍率の上限（会心の弾みで跳ね上がりすぎない）。倍 |
| `critPop` | 会心の数字が出た瞬間に大きく弾んで戻る。scale = 出た瞬間の倍率、time = 戻るまでの秒、shake = 左右の揺れの幅（px）、shakeSpeed = 揺れの速さ |
| `lifeCap` | 種類ごとの寿命の上限（呼び出し側が長く指定しても切り詰める）。status / label は敵や自分の周りに長く居座らないように。秒 |
| `dedupe` | 同じ敵の近くに同じ文字が濃く残っていれば出さない。radius = 同じ場所とみなす距離（px）、fresh = 残り寿命の割合がこれより多い間は濃いとみなす |
| `sameWordSec` | 祝福・遺物の効果の語など同じ語を連続して出さない間隔。秒 |
| `alpha` | 種類ごとの濃さ（0..1）。label は控えめにして数字と敵の状態を目立たせる |

## feel/MANUAL

武器指南書の実演（system/manualDemo.ts）。

| 項目 | 意味 |
| --- | --- |
| `foeDistance` | 自分と木人の中心の距離の既定（台本が決めないとき）。px（10px = 1m） |
| `foeReachRatio` | 近接の武器種の木人までの距離を、左の段の一番短い届きの何割にするか。割合（0..1）。木人の体の半径ぶん内側に入るよう 1 未満 |
| `foeMinDistance` | 近接の木人までの距離の下限。px。体どうしが重ならない距離 |
| `gunFoeDistance` | 銃の家系の木人までの距離。px |
| `dashFoeDistance` | ダッシュ攻撃の木人までの距離。px。ダッシュで抜ける長さを見せる |
| `foeHp` | 木人の生命。実演の 1 周で倒れない量 |
| `tailSec` | 台本の手をすべて終えてから眺める秒。この後、技が出終わっていれば最初からやり直す |
| `tailMaxExtraSec` | 眺める秒の後、技が出終わるのを待つ上限の秒（持続の奥義・飛んでいる弾） |
| `readyTimeoutSec` | 次の押下を受けられる瞬間を待つ上限の秒。過ぎたら押してしまう（台本が止まらないための保険） |
| `previewZoom` | 実演の窓の拡大。倍率（1 = 本編と同じ大きさ） |
| `pressFlashSec` | 入力の列の今の手を光らせる秒 |
| `foeDistanceCandidates` | 台本の距離で当たらない（放てない）とき試す木人の距離。px。台本の距離に近い順に試す |

## feel/PARRY_POSE

受け流しの体と武器の動き（render/parryMotion.ts）と、受け止めた所に散る火花（render/parrySpark.ts）。

| 項目 | 意味 |
| --- | --- |
| `raiseSec` | 押してから受けの構えになり切るまで（秒） |
| `impactSec` | 受け流しが決まってから構えを解き終えるまで（秒） |
| `settleFrom` | impactSec のうち、受け止めた形のまま止める割合。その後に待機の構えへ戻す |
| `pushDots` | 受け止めた瞬間に手を後ろへ押す量（絵のドット。論理 0.5px） |
| `tiltDeg` | 受け止めた瞬間に武器の先を押し返す角（度） |
| `jarSec` | 押された手と衝撃の体のコマが戻るまで（秒） |
| `impactFrameMin` | 押しの残り（0..1）がこれ以上の間は衝撃の体のコマ |
| `bodyMin` | 受けの構えへ寄せた割合（0..1）がこれ以上の間は受けの体のコマ |
| `sagDots` | 外して構えが崩れたとき、手が下がる量の最大（絵のドット） |
| `slackHold` | 外した硬直のうち、崩れた構えのまま止める割合。その後に待機の構えへ戻す |
| `spark` | 受け止めた所の火花。life = 寿命（秒）/ flashSec = 白い閃きの秒 / flashPx = 閃きの十字の腕の長さ（論理 px）/ count = 火の粉の本数 / spreadDeg = 散る扇の開き / lenMin・lenMax = 火の粉の伸びる距離（論理 px）/ tail = 火の粉の尾の長さ（伸びる距離に対する割合）/ colors = 若い → 古い火の粉の色 |
| `spark.colors` | 受け止めた所の火花。life = 寿命（秒）/ flashSec = 白い閃きの秒 / flashPx = 閃きの十字の腕の長さ（論理 px）/ count = 火の粉の本数 / spreadDeg = 散る扇の開き / lenMin・lenMax = 火の粉の伸びる距離（論理 px）/ tail = 火の粉の尾の長さ（伸びる距離に対する割合）/ colors = 若い → 古い火の粉の色 |
| `barrier` | 魔法の武器（杖・書・手鈴。武器の絵の meta.stance.parry.barrier）が体の前に張る結界。radius = 肩から結界までの距離（論理 px）/ halfDeg = 結界の弧の半分の開き（度）/ depthPx = 結界の帯の厚み（論理 px。内側ほど薄い）/ edgeAlpha・fillAlpha = 縁と帯の濃さ / shimmerSec = 縁を走る光の 1 巡（秒）/ popPx = 受け止めた瞬間に結界が前へ膨らむ量（論理 px） |

## ultimates/ULTIMATE

| 項目 | 意味 |
| --- | --- |
| `common.cost` | 奥義 1 回に要る奥義ゲージ。common.cost が既定、defs.<武器種>.<名前>.cost で奥義ごとに上書き（PLAYER.maxEnergy 以下。data/ultimates.test.ts）。一撃はこの量を払い、持続はゲージが尽きるまで続く。目安 一撃の大技 100、軽い一撃・持続 80〜90 |
| `common.invuln` | 出した後（突進は踏み込みの間）の無敵の秒。目安 0.1〜0.5 |
| `common.textColor` | （未記入） |
| `common.endTextColor` | （未記入） |
| `common.autoAimDeg` | 着弾の奥義（大砲撃・焼夷弾など）の自動照準。照準方向からこの角度（度）以内の最も近い敵へ着弾点を寄せる。0 で寄せない。目安 20〜45 |
| `common.autoAimRangeMul` | 自動照準で拾う敵の距離の上限（着弾距離に対する倍率）。目安 1〜2 |
| `defs.*.*.*.radius` | 周囲攻撃（nova）・着弾の爆発（blast）・引き寄せ（pull）・纏い（aura）の半径（px。10px = 1m）。nova / pull / aura には burstRadiusMul が掛かる。目安 30〜80 |
| `defs.*.*.*.scaling` | 1 ヒットの威力の係数表（base + Σ 係数 × ステータス）。奥義の増（increased.ultimate）が掛かる。基礎値（各 5）で周囲攻撃 34 前後、単体の大技 55〜75 |
| `defs.*.*.*.poise` | 1 ヒットの怯み値（ステータスが基礎値のとき）。poiseDamageMul が掛かる。目安 8〜100 |
| `defs.*.*.*.poiseRatio` | 怯み値のステータス係数（ステータス 1 あたりの上乗せ） |
| `defs.*.*.*.knockback` | 当てた敵を押し飛ばす速さ（px/秒）。knockbackMul が掛かる。目安 60〜600 |
| `defs.*.*.*.distance` | 突進（lunge）の進む距離 / 着弾（blast）の照準方向の距離（px）。近くに敵がいればその位置へ寄せる |
| `defs.*.*.lunge.width` | 突進で斬る帯の幅（px） |
| `defs.*.*.*.invuln` | 出した後（突進は踏み込みの間）の無敵の秒。目安 0.1〜0.5 |
| `defs.*.*.*.heavy` | 重い一撃（重いヒットストップ・壁叩きつけ） |
| `defs.*.*.drainPerSec` | 持続の奥義で毎秒減る奥義ゲージ。100 / drainPerSec が最長の秒。目安 10〜16 |
| `defs.*.*.minSec` | 持続の奥義がゲージ 0 でも続く最短の秒（出した直後に切れないように） |
| `defs.*.*.patch` | 持続中の近接の段の差し替え。reachMul / sizeMul = 届く距離・大きさの倍率、hitsAdd = 多段の上乗せ、chargeTimeMul = 溜めの段に届く秒の倍率、attackMoveMul = 攻撃中・溜め中の移動の倍率、castCountAdd = 振りの cast と右レーンの弾の段の弾数の上乗せ、castSpreadDeg = 弾数を足したときの扇の間隔の下限（度） |
| `defs.sword.swordAura.wave` | 持続中、振るたびに照準方向へ剣気の波（祝福の断裂波と同じ弾）を出す。magnitude = 振りの威力に対する倍率 |
| `defs.*.*.*.magnitude` | 統一ルールの効果量（効果ごとに意味が違う。wave は振りの威力に対する倍率、restoreMana は気力、skillHaste はスキルの再使用を縮める秒） |
| `defs.*.*.*.icd` | 統一ルールの内部の再使用 / 命中の衝撃波（hitQuake）の再使用（秒） |
| `defs.*.*.swing.deg` | 扇の中心角（度。swing の形が扇のとき） |
| `defs.*.*.swing.reach` | 振りの届く距離（px）。扇・突きは長さ、円は自分から円の中心までの距離（0 = 自分の周り） |
| `defs.*.*.swing.size` | 振りの大きさ（px）。突きは帯の幅、円は直径、箱は一辺 |
| `defs.*.*.mul` | 持続中の倍率（1 = 等倍）。damage = 近接・射撃の与ダメ、attackSpeed = 振りの速さ、fireRate = 射撃の間隔の逆数、moveSpeed = 移動、poise = 近接の怯み値、incoming = 被ダメ |
| `defs.*.*.*.count` | 弾の数 / 着弾の数 |
| `defs.*.*.*.spreadDeg` | 複数の弾・着弾の扇の間隔（度）。360 / count で全周 |
| `defs.*.*.*.speedMul` | 弾速の倍率（1 = 等倍） |
| `defs.*.*.volley.lifeMul` | 弾の寿命（射程）の倍率（1 = 等倍） |
| `defs.*.*.volley.bulletRadius` | 弾の当たり判定の半径（px） |
| `defs.*.*.volley.pierceBonus` | 弾の貫通数の上乗せ（99 = 実質すべて貫く） |
| `defs.*.*.*.hits` | 同じ敵に当てる回数（多段。省略は 1）。威力・怯み値は 1 ヒットぶん |
| `defs.*.*.*.stacks` | 状態異常のスタック数 |
| `defs.*.*.*.duration` | 状態異常・強化の秒 |
| `defs.*.*.*.potency` | 状態異常の効果量（基礎値のステータスのとき） |
| `defs.*.*.critAdd` | 持続中の会心率の上乗せ（0..1） |
| `defs.*.*.vsWindup` | 持続中、予備動作中の敵への与ダメの倍率 |
| `defs.*.*.pull.toDistance` | 引き寄せ（pull）で敵を寄せる先の、自分からの距離（px） |
| `defs.scythe.soulReap.healPerKill` | 倒した数 × この割合（最大生命に対する割合）を回復 |
| `defs.*.*.aura` | 持続中、自分の周りへ interval 秒ごとに与えるダメージ（radius は burstRadiusMul、威力は 奥義の増（increased.ultimate）が掛かる） |
| `defs.*.*.aura.interval` | 纏いの間隔（秒） |
| `defs.cleaver.beheading.nova.execute` | 周囲攻撃で即死させる生命の割合（0..1。ボスには効かない） |
| `defs.*.*.cost` | 奥義 1 回に要る奥義ゲージ。common.cost が既定、defs.<武器種>.<名前>.cost で奥義ごとに上書き（PLAYER.maxEnergy 以下。data/ultimates.test.ts）。一撃はこの量を払い、持続はゲージが尽きるまで続く。目安 一撃の大技 100、軽い一撃・持続 80〜90 |
| `defs.*.*.*.damageMul` | 威力の倍率（1 = 等倍）。buff は自分の与ダメ強化、detonate は起爆する設置弾の威力 |
| `defs.*.*.buff.mana` | 気力の回復量（上限を超えない） |
| `defs.*.*.vsStatus` | 持続中、その状態異常を持つ敵への与ダメの倍率（状態異常の種類は TS） |
| `defs.shield.beacon.buff.heal` | 生命の回復（最大生命に対する割合 0..1） |
| `defs.*.*.guardArcDeg` | 持続中、正面からこの角度（度）以内の被弾を軽くする |
| `defs.*.*.guardMul` | 正面の被弾の倍率（0..1） |
| `defs.hammer.ironLaw.hitQuake` | 持続中、近接の振りが当たるたびに当てた敵の位置で起こす衝撃波（icd 秒に 1 回）。radius は burstRadiusMul が掛かる（px）、scaling / poise / knockback は nova と同じ意味、hitstop = ヒットストップ（ステップ）、shake = 画面の揺れ |
| `defs.*.*.shot` | 持続中の射撃の弾の差し替え。pelletsAdd = 弾数の上乗せ、pierceAdd = 貫通の上乗せ、speedMul = 弾速、damageMul = 威力、recoilMul = 反動、fuseMul = 設置弾の信管の秒（その武器種の全ベースが設置弾のときだけ）、bounceAdd = 跳弾の回数の上乗せ、orbit = 撃った弾が自分の周りを回り続ける（radius 周回の半径 px / turnRate 毎秒の回転 rad / laps 何周で消えるか。1 周ごとに同じ敵へもう一度当たり、当てても消えず、壁も抜ける） |
| `defs.sidearm.pointBlank` | 持続中、近い敵ほど与ダメが上がる（零距離）。range = 効き始める距離（px。自分から敵の縁まで）、mul = 密着したときの与ダメの倍率（range で 1 へ直線に下がる） |
| `defs.*.*.*.selfKnock` | 撃った反動で自分が後ろへ下がる強さ（px/秒） |
| `defs.longarm.sniperBreath.stillFireRate` | 持続中、立ち止まっているときの射撃間隔の逆数の倍率 |
| `defs.cannon.fullSalvo.packedShot` | 弾倉の残りを全部詰めて撃ち出す 1 発。装備の砲の弾に、粒を pelletsAdd 足し、威力を damageMul 倍し、撃った向きと逆へ selfKnock（px/秒。跳ぶ距離は 14 で割った px 程度。1400 で約 100px）下がる。装薬の詰めの最大段の値と揃える |
| `defs.cannon.powderKeg.pointBlank` | 持続中、近い敵ほど与ダメが上がる（零距離）。range = 効き始める距離（px。自分から敵の縁まで）、mul = 密着したときの与ダメの倍率（range で 1 へ直線に下がる） |
| `defs.cannon.powderKeg.pointBlank.mul` | 持続中の倍率（1 = 等倍）。damage = 近接・射撃の与ダメ、attackSpeed = 振りの速さ、fireRate = 射撃の間隔の逆数、moveSpeed = 移動、poise = 近接の怯み値、incoming = 被ダメ |
| `defs.grenade.incendiary.blast.terrainDuration` | 着弾に残す地形の秒 |
| `defs.trapper.trapperSense.minePull` | 持続中、床の自分の設置弾が radius（px）以内の敵を speed（px/秒）で引き寄せる |
| `defs.ringBlades.*.volley.arcRange` | 戦輪の輪が飛ぶ固定の距離（px。弧でこの距離まで飛んで戻る。省略は照準の距離） |
| `defs.kunai.shadowStitch.pinNova` | 周りの敵すべてにクナイを刺す一撃（クナイの影縫いの陣）。radius = 範囲（px。burstRadiusMul が掛かる）、pins = 1 体に刺す本数、scaling / poise / poiseRatio = 刺すときに当てる傷（威力は 奥義の増（increased.ultimate）が掛かり、その威力が刺さったときの威力になる）。刺さりの秒・上限・叩き込みの倍率はクナイの弾の pin |
| `defs.kunai.shadowStitch.pinNova.pins` | 1 体に刺すクナイの本数（刺さりの上限を超えたら古い順に抜ける） |
| `defs.kunai.blastKunai.detonatePins` | 刺さっている飛び物をすべて炸裂させる一撃（クナイの爆ぜクナイ）。damageMul = 1 本ごとに刺さったときの威力へ掛ける倍率（奥義の増が乗る）。刺さりが無ければ何も起きない |
| `defs.kunai.hiddenArms.pinDriveMul` | 持続中、叩き込み（近接の命中で刺さったクナイを打ち込む追撃）の威力に掛ける倍率（1 = 等倍） |
| `defs.shuriken.greatWheel.volley.orbit` | 一撃の弾（volley）が自分の周りを回る。radius 周回の半径 px / turnRate 毎秒の回転 rad / laps 何周で消えるか（1 周ごとに同じ敵へもう一度当たる） |
| `defs.shuriken.greatWheel.volley.orbit.radius` | 周囲攻撃（nova）・着弾の爆発（blast）・引き寄せ（pull）・纏い（aura）の半径（px。10px = 1m）。nova / pull / aura には burstRadiusMul が掛かる。目安 30〜80 |
