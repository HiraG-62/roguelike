# スキルと刻印符の確定リスト（段取り 7c）

作成日: 2026-09-30。`docs/ideas/boon-impl.md` 2-8・2-9 が「7c の頭で統合役が確定する」とした表を、architect が機械集計で確定したもの。統合役はこの表と 6-2 のレーン分け（前置き → F ∥ H1 → G → H2）を採用した。`LEGACY_SKILL_MAP` の全行は実装で `src/skills/legacyKeys.ts` に入る。

## 0. 結論

- 技: 共通技 24 + 新しい共通技 36 = **60**。武器技 298 は **全部どれかの共通技へ写る（消える石 0 件 / 0%）**。同形（(kind, anchor) の列が一致）で写るのが 273、近い形へ寄せたのが 25
- 手書き: 76 → **45**。消す 31 は全部写し先がある（変身の第 2 弾 3 種は名の近い第 3 弾の変身へ）。連携 19 → **14**（5 本は受け側が技になって消える）
- 刻印符: 53 → **30**（旧 key を残す 13 + 新 key 17）。消える旧 key は 40（設計の「削る 23」は表の出典に吸収される 11 と bloodTithe を数えていない）。祝福の `grantsModifier` の `echo` / `linger` は **key のまま残る**（linger は中身が「据え置き」に変わるので祝福の desc を直す）
- レーンは設計の F ∥ G ∥ H のままだと **衝突する**（G は F の新 key に依存、G と H は system/skills.ts・types.ts・data.ts・modifiers*.ts・skillHud.ts を両方大きく触る、`LEGACY_SKILL_MAP` の置き場が F/G の編集禁止の persistence.ts）。**前置き → (F ∥ H1) → G → H2** に組み替える（6 章）

## 1. 共通技 60

### 1-1. 束ね方と数の合わせ方

`ART_SPECS` を (kind の列, anchor の列) で groupBy すると **43 形**（設計どおり）。ただし共通技を含む形は設計の想定の 7 ではなく **13**（shot@self / ring@self / line@self / ring@target / dash@self / buff@self / pull@target / ring+buff / chain@target / ring+dash / shot×4 / ring×3 / blink@target）、共通技を含まない形は **30**。機械的に束ねると 24 + 30 = 54 で、しかも shot@self（53 件）・ring@self（42）・line@self（41）・arc@self（40）・ring@target（28）・dash@self（19）が 1 形に潰れて遊びの差（貫く / 跳ねる / 散らす / 回る / 瓦礫 / 敵弾消し / 突き / 振り下ろし / 光線 / 炎の帯 / 爆ぜる / 凍てる …）が消える。そこで次の 2 つで 36 に合わせた。

- **併合（小さな形 29 → 新 13 + 既存へ 9）**: 回数だけ違う列を 1 つに（ring@target×4 と ×6 → 千本斬り、line×2 と ×3 → 三段突き、arc×2・×3・×4 → 滅多切り、shot×2・×3・×5・×6 → 乱れ弾、dash+arc と blink+arc → 背取り、arc+dash と line+dash → 飛び退き打ち、buff+arc と buff+ring → 返し構え）。1 件だけの形は近い既存の共通技へ（dash+buff → 飛び退き、arc+buff → 聖光、chain@self → 連鎖電、ring×2 → 旋風斬り、pull+ring×3 → 引き寄せ、shot×2 の交差投げ → 跳弾）
- **分割（大きな形 → 新 23）**: 同じ形の中を「命中の性質」で分けた。shot@self → 風切り（貫通）/ 跳弾（跳ね返り）/ 散弾（至近の多数）/ 気弾（貫かない重い単発）/ 毒刃（状態異常の単発）、ring@self → 旋風斬り（多段）/ 地叩き（瓦礫）/ 跳ね返し（敵弾消し）/ 煙幕玉（煙）、line@self → 貫通突き / 地裂き（重い振り下ろし・瓦礫）/ 撃ち抜き（光線）/ 炎の壁 / 押し込み、arc@self → 三日月（大振り）/ 血刃（出血）/ 昇り斬り（怯ませ・壁叩き）/ 百裂（1 弧の連打）、ring@target → 炸裂玉 / 冷却弾 / 閃光弾、dash@self → 突進斬り / 猪突
- 名前は武器種名（剣・槍・斧・盾・刀・鞭・鉈・棍・杖・拳・爪・扇子・砲・銃…）を含まないものを束の中から選び、消える手書きの名が合うなら手書きの名を引き継いだ（旋風斬り・突進斬り・撃ち抜き・地裂き・墜星・跳弾・風切り）。こうすると連携の説明文（「鎖鎌の直後の旋風斬りは…」「墜星の着地直後の地裂きは…」）がそのまま読める
- 表示名の衝突で避けたもの: 飛刃（`loot/bases.ts:110` 戦輪の器の名）、地震（ランイベント）
- icon は共通技 60 の中で重複しない字を振った（`arts.test.ts:104` の検査。代表の字が既存の共通技と重なる 6 件を差し替え済み）
- key は `common` + 英名。数値は「数値の写し元」の技の JSON ブロックを `balance/skills/ART/common.json` の新 key へ移す（acts の n もそのまま）

### 1-2. 新しい共通技 36

| # | 残す key | 表示名 | icon | 行為の列 | 数値の写し元（JSON の代表） | 役割 | 束ねた武器技 | 吸収する手書き |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N01 | `commonWindCutter` | 風切り | 飛 | shot@self | `greatswordWindCutter` | 並んだ敵を貫く飛ぶ斬撃（旧 手書き galeSlash の名。「飛刃」は戦輪の器の名と重なるので使わない） | swordSonicEdge greatswordWindCutter katanaWindSlash spearHurl scytheHarvestMoon staffGale flailHurl sidearmPiercer longarmSnipe fanRazorWind (10) | galeSlash tideSlash |
| N02 | `commonRicochet` | 跳弾 | 跳 | shot@self | `thrownRicochet` | 壁・敵で跳ね返る弾（旧 手書き ricochet の名） | cleaverThrow axeHatchet hammerThrow shieldThrow ringBladesThrow ringBladesRebound gunnerRicochet cannonChainShot thrownRicochet grenadeBounce warRingRicochet twinBladesCrossThrow (12) | ricochet |
| N03 | `commonScatter` | 散弾 | 散 | shot@self | `sidearmScatter` | 至近へ多数の弾を狭く浴びせる | sidearmScatter cannonGrapeshot longarmVolley gunnerBulletDance (4) | scatterSigil |
| N04 | `commonKiBlast` | 気弾 | 気 | shot@self | `fistsKiBlast` | 貫かない重い単発（大きく怯ませる） | fistsKiBlast chainSickleWeight sidearmSnipe cannonBlast thrownDagger warRingThrow (6) |  |
| N05 | `commonVenomDart` | 毒刃 | 毒 | shot@self | `thrownPoison` | 毒の単発（麻痺・感電・脆弱の弾もここ） | thrownPoison thrownPin sidearmShock sidearmMark (4) |  |
| N06 | `commonWhirl` | 旋風斬り | 円 | ring@self | `swordWhirlwind` | その場で回って周りを数度斬る（旧 手書き whirl の名） | swordWhirlwind greatswordGiantSwing twinBladesBladeDance clawsSpin fistsSpinKick ringBladesOrbit axeWhirl hammerSpin spearCyclone warRingSpin whipCircle cleaverWhirl flailSpin chainSickleWhirl staffWindmill scytheDeathSpin warRingCyclone ringBladesStorm katanaDrawCircle ringBladesDoubleSlash (20) | whirl |
| N07 | `commonTremor` | 地叩き | 震 | ring@self | `hammerQuake` | 足元を叩いて周りに瓦礫を残す（「地震」はランイベントと重なるので使わない） | cleaverQuake axeFissure hammerQuake fistsGroundPound thrownCaltrops trapperCaltrops (6) |  |
| N08 | `commonDeflect` | 跳ね返し | 弾 | ring@self | `staffDeflect` | 周りの敵弾を消して打つ | staffDeflect fanWindShield ringBladesShield shieldReflect warRingGuard flailOrbit greatswordSwordPressure (7) | boneRing |
| N09 | `commonSmokeScreen` | 煙幕玉 | 幕 | ring@self | `thrownSmoke` | 足元に煙を張り敵弾を遮る（与ダメなし） | thrownSmoke trapperSmoke (2) |  |
| N10 | `commonPierce` | 貫通突き | 貫 | line@self | `spearPierce` | 細く長い突き（縛り・出血・脆弱の突きもここ） | spearPierce spearImpale spearPin staffThrust twinBladesVenomKiss chainSickleBind chainSickleChainThrow chainSickleShadowStitch whipLash whipTame whipDisarm clawsShred axeRend ringBladesSaw warRingSever trapperTripwire (16) |  |
| N11 | `commonQuake` | 地裂き | 裂 | line@self | `greatswordEarthCleave` | 重い振り下ろしで前方の帯を割り瓦礫を残す（旧 手書き quake の名） | greatswordEarthCleave hammerFissure swordHeavenSplit greatswordGuardBreak cleaverChop cleaverBoneCrush flailSmash flailCrush hammerSmash hammerShatter katanaIai (11) | quake collapseHammer |
| N12 | `commonRailshot` | 撃ち抜き | 線 | line@self | `longarmRail` | 壁まで届く光の帯（旧 手書き railshot の名） | longarmRail wandHolyRay (2) | railshot fullMoon |
| N13 | `commonFireWall` | 炎の壁 | 壁 | line@self | `wandFireWall` | 前方の帯を焼き炎の床を残す | wandFireWall trapperFire (2) | scorchLine |
| N14 | `commonShove` | 押し込み | 押 | line@self | `shieldShove` | 幅広い帯で押し飛ばす | shieldShove fistsPalm fanGust cannonShockwave fistsHundredFist (5) |  |
| N15 | `commonCrescent` | 三日月 | 月 | arc@self | `greatswordCrescent` | 180° 以上の大振り | greatswordCrescent scytheReap katanaCrescent staffSweep flailSweep spearSweep ringBladesDance warRingSlash fanFlameDance fanSnowDance whipSpark (11) |  |
| N16 | `commonBleedEdge` | 血刃 | 刃 | arc@self | `twinBladesBleedEdge` | 斬って出血（出血を食う弧もここ） | twinBladesBleedEdge katanaBlossom cleaverRend chainSickleReap axeCleave ringBladesReap twinBladesReap clawsHemorrhage scytheBloodMoon axeSunder clawsVenom (11) |  |
| N17 | `commonRisingSlash` | 昇り斬り | 昇 | arc@self | `swordRisingSlash` | 重い一撃で大きく怯ませ壁に叩きつける | swordRisingSlash fistsUppercut shieldBash shieldSlam gunnerPistolWhip longarmButtStroke staffSlam hammerBreak hammerBell flailStun staffTrip (11) | breakKick |
| N18 | `commonFlurry` | 百裂 | 百 | arc@self | `twinBladesFlurry` | 1 つの弧で 4〜6 連打 | twinBladesFlurry clawsFrenzy chainSickleFlurry fistsRapidPunch (4) |  |
| N19 | `commonBomb` | 炸裂玉 | 炸 | ring@target | `thrownBomb` | 照準地点で爆ぜる（遅れて落ちる重い一撃もここ） | thrownBomb grenadeFrag gunnerBlast longarmExplosive grenadeConcussion grenadeSticky cannonMortar flailDrop trapperBearTrap shieldQuake longarmFlare (11) | frag |
| N20 | `commonFreezeBomb` | 冷却弾 | 冷 | ring@target | `grenadeFreeze` | 照準地点を凍てつかせ氷床を残す | grenadeFreeze cannonFrost trapperNet (3) |  |
| N21 | `commonFlashBang` | 閃光弾 | 閃 | ring@target | `sidearmFlash` | 照準地点で沈黙と恐怖（与ダメなし） | sidearmFlash grenadeFlash grenadeSmoke (3) |  |
| N22 | `commonLunge` | 突進斬り | 駆 | dash@self | `swordFlashStep` | 駆け抜けて通り道を斬る（旧 手書き lunge の名） | swordFlashStep twinBladesWhirlDash katanaFlash spearCharge longarmBayonet warRingDash fistsDashStraight fistsFlyingKnee clawsPounce axeLeap hammerMeteor (11) | lunge iceSlide |
| N23 | `commonCharge` | 猪突 | 猪 | dash@self | `greatswordBoarRush` | 重い突進で撥ね飛ばす | greatswordBoarRush cleaverShoulder flailWreck hammerCharge shieldCharge (5) |  |
| N24 | `commonThousandCuts` | 千本斬り | 千 | ring@target ×4（旧 ×6 も） | `swordBladeStorm` | 照準地点に続けて斬りつける嵐 | swordBladeStorm whipStorm wandBlizzard thrownRain warRingStorm katanaThousandCuts (6) |  |
| N25 | `commonTriplePound` | 三連打 | 連 | ring@target ×3 | `flailPound` | 照準地点へ 3 度落とす | twinBladesTempest spearRain chainSickleSpiral flailPound cannonBarrage grenadeCluster (6) |  |
| N26 | `commonInhale` | 吸い風 | 寄 | pull@self | `fanInhale` | 周りの敵を手元へ引き寄せる | chainSickleHook chainSickleTopple whipSnare flailChainPull shieldTaunt fanInhale (6) | threadReel |
| N27 | `commonTripleThrust` | 三段突き | 突 | line@self ×2〜3 | `swordTripleThrust` | 続けて突く（向きを変えられる） | swordTripleThrust katanaTripleIai spearWall staffCombo spearTwinStrike whipDoubleLash (6) |  |
| N28 | `commonLeapSlam` | 跳躍叩き | 躍 | dash@self ring@self | `greatswordLeapSlam` | 跳んで着地で周りを打つ | greatswordLeapSlam clawsDive spearVault staffPoleVault (4) |  |
| N29 | `commonDiveShot` | 飛び込み撃ち | 転 | dash@self shot@self | `gunnerDiveShot` | 跳びながら前方を撃つ | gunnerDiveShot gunnerBackflip sidearmRoll cannonRecoil (4) |  |
| N30 | `commonRiposte` | 返し構え | 返 | buff@self arc@self | `swordRiposte` | 一瞬の無敵の構えから斬り返す | swordRiposte katanaCounter shieldCounter fistsCounterStance (4) |  |
| N31 | `commonHack` | 滅多切り | 滅 | arc@self ×3（×2・×4 も） | `greatswordRampage` | 弧を続けて振る | greatswordRampage clawsRend axeDoubleChop ringBladesCross cleaverHack (5) | dregsBlade |
| N32 | `commonMeteorDive` | 墜星 | 墜 | blink@target ring@self | `scytheShadowStep` | 照準地点へ跳び着地で周りを打つ（旧 手書き meteorDive の名） | scytheShadowStep chainSickleSwing (2) | meteorDive |
| N33 | `commonDetonate` | 一斉起爆 | 起 | detonate@self ring@self | `trapperDetonate` | 床の設置弾をまとめて起爆 | cannonDetonate trapperDetonate (2) |  |
| N34 | `commonCrossCut` | 十字斬り | 十 | arc@self line@self | `swordCrossCut` | 横と縦の 2 手 | swordCrossCut (1) | weaponArt |
| N35 | `commonBackstab` | 背取り | 取 | blink@target arc@self | `twinBladesBackstab` | 背後へ回り込んで斬る | twinBladesShadowRush twinBladesBackstab (2) | shadowStep swallowFlip |
| N36 | `commonStrikeAway` | 飛び退き打ち | 払 | line@self dash@self | `whipSwingAway` | 打ってから跳び退く | clawsLeapBack whipSwingAway (2) |  |

### 1-3. 今の共通技 24 に束ねる武器技と手書き

| 既存の共通技 | 表示名 | 行為の列 | 束ねる武器技 | 吸収する手書き |
| --- | --- | --- | --- | --- |
| `commonShockwave` | 衝撃波 | ring@self | trapperShrapnel trapperSpike (2) | stomp |
| `commonBackstep` | 飛び退き | dash@self | longarmRecoilJump fanWindStep twinBladesAfterimage (3) |  |
| `commonBlink` | 瞬身 | blink@target |  (0) |  |
| `commonWarCry` | 鬨の声 | ring@self buff@self | axeHowl scytheTerror fanDance (3) |  |
| `commonFirstAid` | 応急手当 | buff@self | shieldBulwark fanCalm (2) |  |
| `commonMeditate` | 瞑想 | buff@self | staffBreath fistsFocus (2) |  |
| `commonFireball` | 火球 | shot@self | sidearmIncendiary wandFlare (2) |  |
| `commonIceLance` | 氷の投げ槍 | shot@self | sidearmFreeze wandFrostBolt thrownBola (3) |  |
| `commonThunderclap` | 雷鳴 | ring@target | wandLightning hammerThunder whipCrack (3) | thunder |
| `commonPoisonMist` | 毒霧 | ring@target | wandVenom grenadeGas (2) | bogCall |
| `commonShadowBolt` | 闇弾 | shot@self | scytheCurse wandDarkOrb (2) | siphonMark |
| `commonHolyNova` | 聖光 | ring@self buff@self | staffGuard scytheSoulHarvest (2) |  |
| `commonChainSpark` | 連鎖電 | chain@target | gunnerTrickShot wandChain whipChainLightning (3) |  |
| `commonMagnet` | 引き寄せ | pull@target | scytheGrimPull ringBladesVortex wandVortex trapperLure fanTornado (5) |  |
| `commonSmokeBomb` | 煙玉 | ring@self dash@self | cannonPointBlank (1) |  |
| `commonKnifeFan` | 投げ短刀 | shot@self | clawsSlashWave axeStorm warRingFan gunnerFanFire wandArcaneMissile thrownFan fanPetals (7) | prismShard |
| `commonMeteor` | 流星 | ring@target | wandMeteor cannonNapalm grenadeIncendiary (3) |  |
| `commonQuickstep` | 疾走 | buff@self | katanaClearMind clawsBeast gunnerQuickDraw (3) |  |
| `commonIronSkin` | 鉄身 | buff@self | greatswordIronWill shieldFortress sidearmSteady longarmAim (4) |  |
| `commonExecution` | 介錯 | line@self | katanaSever cleaverSever longarmHeadshot cleaverButcher swordFinisher greatswordBeheader scytheBeheader (7) | guillotine |
| `commonBarrage` | 乱れ弾 | shot@self shot@self shot@self shot@self | thrownVolley gunnerBarrage longarmSuppress sidearmQuickdraw warRingEcho gunnerDoubleTap (6) | spiral |
| `commonGroundSpike` | 地槍 | ring@self ring@self ring@self | grenadeBarrage (1) |  |
| `commonFrostNova` | 氷輪 | ring@self | trapperOil scytheWither (2) |  |
| `commonBloodSurge` | 血気 | buff@self | swordValor cleaverBerserk axeBerserk (3) |  |

- 近い形へ寄せた 25 件（同形ではない）: axeHowl・scytheTerror → 鬨の声（恐怖の輪）、swordFinisher・greatswordBeheader・scytheBeheader → 介錯（止めの弧 → 止めの帯）、twinBladesAfterimage → 飛び退き、fanTornado → 引き寄せ、嵐 ×4 の 5 件 → 千本斬り（×6 の代表を ×4 にした）、scytheSoulHarvest → 聖光、二段突き 2 件 → 三段突き、whipChainLightning → 連鎖電、fistsCounterStance → 返し構え、連射 5 件 → 乱れ弾、twinBladesCrossThrow → 跳弾、弧 ×2・×3 の 4 件 → 滅多切り、ringBladesDoubleSlash → 旋風斬り、twinBladesShadowRush → 背取り、clawsLeapBack → 飛び退き打ち（`node check.mjs` の near 一覧）

## 2. LEGACY_SKILL_MAP（旧 key → 新 key / null）

- 置き場: **新ファイル `src/skills/legacyKeys.ts`**（`LEGACY_SKILL_MAP` と `migrateSkillKey(raw: unknown): SkillKey | null`）。`persistence.ts` の `sanitizeStone` は `isSkillKey(skillKey)` の前に `const key = migrateSkillKey(skillKey)` の 1 行だけ（設計の「sanitizeStone の前に 1 段」）。F と G がそれぞれ自分の分の行を足す（6 章）
- **null は 0 件**。武器技 298 と手書き 31 の全部に写し先がある → 消える石の割合 **0%**（設計の見込み「3 割前後」より良い。★2 の「写せないものは消す」は該当なしで満たす）。代わりに **同じ key の石が増える**（例: 旋風斬りに 19 種が集まる）。`seed / variants / wear` は石のまま、`variants` は新しい `axes` に無い軸を今の `sanitizeStone` が落とす
- 厳密に同形だけを写す案（近い形の 25 件と変身 3 件を null）にすると消える石は 28 / 329 = 8.5%。推奨はしない（写しても遊びが壊れない）
- 全件は `legacyMap.ts.txt`（329 行）。武器種ごとの表は下（`c.` = `common`）

| 武器種 | 旧 key → 新 key |
| --- | --- |
| sword | swordCrossCut→c.CrossCut / swordRisingSlash→c.RisingSlash / swordFlashStep→c.Lunge / swordWhirlwind→c.Whirl / swordSonicEdge→c.WindCutter / swordRiposte→c.Riposte / swordTripleThrust→c.TripleThrust / swordHeavenSplit→c.Quake / swordBladeStorm→c.ThousandCuts / swordValor→c.BloodSurge / swordFinisher→c.Execution |
| greatsword | greatswordEarthCleave→c.Quake / greatswordGiantSwing→c.Whirl / greatswordLeapSlam→c.LeapSlam / greatswordCrescent→c.Crescent / greatswordGuardBreak→c.Quake / greatswordWindCutter→c.WindCutter / greatswordRampage→c.Hack / greatswordIronWill→c.IronSkin / greatswordBeheader→c.Execution / greatswordSwordPressure→c.Deflect / greatswordBoarRush→c.Charge |
| twinBlades | twinBladesBladeDance→c.Whirl / twinBladesShadowRush→c.Backstab / twinBladesCrossThrow→c.Ricochet / twinBladesFlurry→c.Flurry / twinBladesBleedEdge→c.BleedEdge / twinBladesVenomKiss→c.Pierce / twinBladesBackstab→c.Backstab / twinBladesWhirlDash→c.Lunge / twinBladesAfterimage→c.Backstep / twinBladesReap→c.BleedEdge / twinBladesTempest→c.TriplePound |
| katana | katanaIai→c.Quake / katanaFlash→c.Lunge / katanaCrescent→c.Crescent / katanaTripleIai→c.TripleThrust / katanaCounter→c.Riposte / katanaWindSlash→c.WindCutter / katanaBlossom→c.BleedEdge / katanaDrawCircle→c.Whirl / katanaThousandCuts→c.ThousandCuts / katanaClearMind→c.Quickstep / katanaSever→c.Execution |
| cleaver | cleaverChop→c.Quake / cleaverHack→c.Hack / cleaverThrow→c.Ricochet / cleaverButcher→c.Execution / cleaverShoulder→c.Charge / cleaverQuake→c.Tremor / cleaverBerserk→c.BloodSurge / cleaverSever→c.Execution / cleaverWhirl→c.Whirl / cleaverBoneCrush→c.Quake / cleaverRend→c.BleedEdge |
| claws | clawsRend→c.Hack / clawsPounce→c.Lunge / clawsFrenzy→c.Flurry / clawsSpin→c.Whirl / clawsHemorrhage→c.BleedEdge / clawsLeapBack→c.StrikeAway / clawsShred→c.Pierce / clawsBeast→c.Quickstep / clawsSlashWave→c.KnifeFan / clawsDive→c.LeapSlam / clawsVenom→c.BleedEdge |
| spear | spearPierce→c.Pierce / spearVault→c.LeapSlam / spearSweep→c.Crescent / spearRain→c.TriplePound / spearHurl→c.WindCutter / spearCharge→c.Lunge / spearWall→c.TripleThrust / spearTwinStrike→c.TripleThrust / spearImpale→c.Pierce / spearCyclone→c.Whirl / spearPin→c.Pierce |
| scythe | scytheReap→c.Crescent / scytheSoulHarvest→c.HolyNova / scytheDeathSpin→c.Whirl / scytheGrimPull→c.Magnet / scytheCurse→c.ShadowBolt / scytheHarvestMoon→c.WindCutter / scytheBeheader→c.Execution / scytheShadowStep→c.MeteorDive / scytheWither→c.FrostNova / scytheTerror→c.WarCry / scytheBloodMoon→c.BleedEdge |
| staff | staffSweep→c.Crescent / staffPoleVault→c.LeapSlam / staffThrust→c.Pierce / staffWindmill→c.Whirl / staffDeflect→c.Deflect / staffBreath→c.Meditate / staffTrip→c.RisingSlash / staffCombo→c.TripleThrust / staffSlam→c.RisingSlash / staffGuard→c.HolyNova / staffGale→c.WindCutter |
| chainSickle | chainSickleHook→c.Inhale / chainSickleWhirl→c.Whirl / chainSickleBind→c.Pierce / chainSickleReap→c.BleedEdge / chainSickleSwing→c.MeteorDive / chainSickleFlurry→c.Flurry / chainSickleChainThrow→c.Pierce / chainSickleWeight→c.KiBlast / chainSickleTopple→c.Inhale / chainSickleShadowStitch→c.Pierce / chainSickleSpiral→c.TriplePound |
| whip | whipLash→c.Pierce / whipCrack→c.Thunderclap / whipSnare→c.Inhale / whipCircle→c.Whirl / whipChainLightning→c.ChainSpark / whipDoubleLash→c.TripleThrust / whipTame→c.Pierce / whipStorm→c.ThousandCuts / whipSwingAway→c.StrikeAway / whipDisarm→c.Pierce / whipSpark→c.Crescent |
| flail | flailSpin→c.Whirl / flailSmash→c.Quake / flailSweep→c.Crescent / flailHurl→c.WindCutter / flailWreck→c.Charge / flailChainPull→c.Inhale / flailDrop→c.Bomb / flailCrush→c.Quake / flailOrbit→c.Deflect / flailPound→c.TriplePound / flailStun→c.RisingSlash |
| axe | axeCleave→c.BleedEdge / axeHatchet→c.Ricochet / axeWhirl→c.Whirl / axeLeap→c.Lunge / axeRend→c.Pierce / axeBerserk→c.BloodSurge / axeSunder→c.BleedEdge / axeDoubleChop→c.Hack / axeStorm→c.KnifeFan / axeFissure→c.Tremor / axeHowl→c.WarCry |
| hammer | hammerSmash→c.Quake / hammerQuake→c.Tremor / hammerMeteor→c.Lunge / hammerSpin→c.Whirl / hammerThrow→c.Ricochet / hammerShatter→c.Quake / hammerBell→c.RisingSlash / hammerFissure→c.Quake / hammerCharge→c.Charge / hammerBreak→c.RisingSlash / hammerThunder→c.Thunderclap |
| shield | shieldBash→c.RisingSlash / shieldCharge→c.Charge / shieldFortress→c.IronSkin / shieldSlam→c.RisingSlash / shieldThrow→c.Ricochet / shieldReflect→c.Deflect / shieldTaunt→c.Inhale / shieldQuake→c.Bomb / shieldShove→c.Shove / shieldBulwark→c.FirstAid / shieldCounter→c.Riposte |
| fists | fistsRapidPunch→c.Flurry / fistsUppercut→c.RisingSlash / fistsDashStraight→c.Lunge / fistsGroundPound→c.Tremor / fistsKiBlast→c.KiBlast / fistsCounterStance→c.Riposte / fistsSpinKick→c.Whirl / fistsPalm→c.Shove / fistsFocus→c.Meditate / fistsFlyingKnee→c.Lunge / fistsHundredFist→c.Shove |
| ringBlades | ringBladesThrow→c.Ricochet / ringBladesOrbit→c.Whirl / ringBladesDance→c.Crescent / ringBladesCross→c.Hack / ringBladesSaw→c.Pierce / ringBladesStorm→c.Whirl / ringBladesDoubleSlash→c.Whirl / ringBladesRebound→c.Ricochet / ringBladesShield→c.Deflect / ringBladesReap→c.BleedEdge / ringBladesVortex→c.Magnet |
| fan | fanGust→c.Shove / fanTornado→c.Magnet / fanPetals→c.KnifeFan / fanDance→c.WarCry / fanFlameDance→c.Crescent / fanSnowDance→c.Crescent / fanWindShield→c.Deflect / fanWindStep→c.Backstep / fanInhale→c.Inhale / fanRazorWind→c.WindCutter / fanCalm→c.FirstAid |
| gunner | gunnerFanFire→c.KnifeFan / gunnerBulletDance→c.Scatter / gunnerDiveShot→c.DiveShot / gunnerDoubleTap→c.Barrage / gunnerRicochet→c.Ricochet / gunnerBarrage→c.Barrage / gunnerPistolWhip→c.RisingSlash / gunnerBlast→c.Bomb / gunnerBackflip→c.DiveShot / gunnerTrickShot→c.ChainSpark / gunnerQuickDraw→c.Quickstep |
| sidearm | sidearmSnipe→c.KiBlast / sidearmQuickdraw→c.Barrage / sidearmFlash→c.FlashBang / sidearmRoll→c.DiveShot / sidearmPiercer→c.WindCutter / sidearmIncendiary→c.Fireball / sidearmFreeze→c.IceLance / sidearmShock→c.VenomDart / sidearmMark→c.VenomDart / sidearmSteady→c.IronSkin / sidearmScatter→c.Scatter |
| longarm | longarmSnipe→c.WindCutter / longarmBayonet→c.Lunge / longarmVolley→c.Scatter / longarmHeadshot→c.Execution / longarmRecoilJump→c.Backstep / longarmRail→c.Railshot / longarmFlare→c.Bomb / longarmButtStroke→c.RisingSlash / longarmSuppress→c.Barrage / longarmExplosive→c.Bomb / longarmAim→c.IronSkin |
| cannon | cannonBlast→c.KiBlast / cannonGrapeshot→c.Scatter / cannonRecoil→c.DiveShot / cannonBarrage→c.TriplePound / cannonShockwave→c.Shove / cannonNapalm→c.Meteor / cannonChainShot→c.Ricochet / cannonPointBlank→c.SmokeBomb / cannonMortar→c.Bomb / cannonFrost→c.FreezeBomb / cannonDetonate→c.Detonate |
| wand | wandFlare→c.Fireball / wandFrostBolt→c.IceLance / wandLightning→c.Thunderclap / wandVenom→c.PoisonMist / wandVortex→c.Magnet / wandHolyRay→c.Railshot / wandDarkOrb→c.ShadowBolt / wandBlizzard→c.ThousandCuts / wandFireWall→c.FireWall / wandArcaneMissile→c.KnifeFan / wandMeteor→c.Meteor / wandChain→c.ChainSpark |
| thrown | thrownFan→c.KnifeFan / thrownPoison→c.VenomDart / thrownRain→c.ThousandCuts / thrownRicochet→c.Ricochet / thrownVolley→c.Barrage / thrownPin→c.VenomDart / thrownSmoke→c.SmokeScreen / thrownBomb→c.Bomb / thrownBola→c.IceLance / thrownCaltrops→c.Tremor / thrownDagger→c.KiBlast |
| grenade | grenadeCluster→c.TriplePound / grenadeFrag→c.Bomb / grenadeIncendiary→c.Meteor / grenadeSmoke→c.FlashBang / grenadeConcussion→c.Bomb / grenadeGas→c.PoisonMist / grenadeFlash→c.FlashBang / grenadeFreeze→c.FreezeBomb / grenadeBarrage→c.GroundSpike / grenadeSticky→c.Bomb / grenadeBounce→c.Ricochet |
| trapper | trapperDetonate→c.Detonate / trapperSpike→c.Shockwave / trapperNet→c.FreezeBomb / trapperTripwire→c.Pierce / trapperBearTrap→c.Bomb / trapperLure→c.Magnet / trapperOil→c.FrostNova / trapperFire→c.FireWall / trapperSmoke→c.SmokeScreen / trapperShrapnel→c.Shockwave / trapperCaltrops→c.Tremor |
| warRing | warRingSpin→c.Whirl / warRingThrow→c.KiBlast / warRingRicochet→c.Ricochet / warRingFan→c.KnifeFan / warRingGuard→c.Deflect / warRingStorm→c.ThousandCuts / warRingDash→c.Lunge / warRingSever→c.Pierce / warRingEcho→c.Barrage / warRingSlash→c.Crescent / warRingCyclone→c.Whirl |

### 2-1. 手書きの写し（31）

| 旧 key（手書き） | 旧名 | → 新 key |
| --- | --- | --- |
| whirl | 旋風斬り | `commonWhirl` |
| lunge | 突進斬り | `commonLunge` |
| frag | グレネード | `commonBomb` |
| railshot | 撃ち抜き | `commonRailshot` |
| quake | 地裂き | `commonQuake` |
| thunder | 雷撃 | `commonThunderclap` |
| spiral | 回転弾幕 | `commonBarrage` |
| meteorDive | 墜星 | `commonMeteorDive` |
| prismShard | 五彩の礫 | `commonKnifeFan` |
| fullMoon | 満月の砲 | `commonRailshot` |
| dregsBlade | 枯渇の刃 | `commonHack` |
| shadowStep | 影渡り | `commonBackstab` |
| guillotine | 断頭振り | `commonExecution` |
| ricochet | 跳弾 | `commonRicochet` |
| galeSlash | 風切り | `commonWindCutter` |
| scatterSigil | 散弾符 | `commonScatter` |
| stomp | 震脚 | `commonShockwave` |
| threadReel | 手繰り糸 | `commonInhale` |
| swallowFlip | 燕返し | `commonBackstab` |
| boneRing | 骨片の輪 | `commonDeflect` |
| scorchLine | 焼き払い | `commonFireWall` |
| iceSlide | 凍て道 | `commonLunge` |
| bogCall | 沼呼び | `commonPoisonMist` |
| breakKick | 崩し蹴り | `commonRisingSlash` |
| collapseHammer | 崩落槌 | `commonQuake` |
| tideSlash | 水刃 | `commonWindCutter` |
| siphonMark | 吸魔の矢 | `commonShadowBolt` |
| weaponArt | 極意 | `commonCrossCut` |
| titanForm | 剛の型 | `ironForm` |
| swiftForm | 迅の型 | `wolfForm` |
| spiritForm | 霊の型 | `wraithForm` |

## 3. 手書き 76 → 45

### 3-1. 基準の当て方

- 残す: 他要素を読む・食う（状態異常・気力・生命・被ダメ・コンボ・烙印・彩痕・地形・設置物・召喚）、連携の **受け側で Rule の分岐を持つ**もの、変身の第 3 弾 5 種
- 吸収: 行為の列（arc / ring / line / dash / blink / shot / chain / pull / buff / detonate + terrain / applies / vs）で書けるもの。気力の条件だけのもの（満月の砲 = 満タン、枯渇の刃 = 少ない）は刻印符の循環（溢れ撃ち / 血の代償）で同じ遊びが作れるので吸収
- 削る: 変身の第 2 弾 3 種（持ち替えと等価）。石は名の近い第 3 弾の変身へ写す（剛 → 鉄塊化 / 迅 → 狼化 / 霊 → 霊体化）
- 連携を持つスキルの扱い: 技にも連携を付けられるようにする（`ArtSpec.combos?: readonly ComboKey[]` を `buildArtSkillDef` が `SkillDef.combos` へ渡すだけ。`findCombo` は `SkillDef` を見るので `system/skills.ts:1020` はそのまま動く）。これで **倍率だけの連携（`apply`）は技へ移せる**。受け側が手書きの分岐（`params.combo` を読む）で書いた連携だけが消える

### 3-2. 残す 45

| 群 | key |
| --- | --- |
| BASE（7） | parry / bloodPact / gravityWell / mines / haste / chainHook / frostField |
| EXTRA（20） | contagion / unravel / kindle / powderKeg / swordGrave / iceBreaker / bloodlet / harvest / discharge / rout / verdict / exploit / strip / lastStand / comboChain / grudge / backflow / scarRoar / manaSpring / turret |
| WAVE2（13） | waterJar / oilPot / levelGround / emberDraw / brandSear / brandBlast / flashFreeze / hueEtch / hueRelease / doomSentence / shiftingEdge / wardStake / mire |
| WAVE3（5） | wolfForm / wraithForm / siegeForm / ironForm / pyreForm |

- waterJar / oilPot は「行為の列で書ける」寄りだが、水たまり・油を照準地点に作る技が 60 に無く、瞬凍・焼き払い（→ 炎の壁）・炎の床の燃え広がりの **源** なので残す（残すと 45 に収めるために満月の砲・枯渇の刃を吸収に回した）

### 3-3. 消す 31 と吸収先

| 旧 key | 旧名 | 吸収先 | 理由 / 失うもの |
| --- | --- | --- | --- |
| whirl | 旋風斬り | commonWhirl（名を継ぐ） | ring 多段。連携 hookWhirl は技へ移す、pactWhirl（出血付与の分岐）は消える |
| lunge | 突進斬り | commonLunge（名を継ぐ） | dash。ジョブの初期石 |
| frag | グレネード | commonBomb | ring@target 遅れ。連携 wellFrag（引力球の中心へ吸う分岐）は消える。初期石 |
| railshot | 撃ち抜き | commonRailshot（名を継ぐ） | line 光線。照準の溜めは失う。連携 parryRail は技へ移す |
| quake | 地裂き | commonQuake（名を継ぐ） | 前方の帯 + 瓦礫。溜めは失う。連携 diveQuake / breakCollapse は技へ移す |
| thunder | 雷撃 | commonThunderclap | 同形（照準地点の雷）。連携 wellThunder / frostThunder（分岐）は消える |
| spiral | 回転弾幕 | commonBarrage | 弾の列。移動が遅くなる制約と hasteSpiral（分岐）は消える |
| meteorDive | 墜星 | commonMeteorDive（名を継ぐ） | blink@target + ring。連携 levelMeteor は技へ、diveQuake の先は新 key へ |
| prismShard | 五彩の礫 | commonKnifeFan | 共鳴の色を読む（7d で色の共鳴が消える）ので先に吸収 |
| fullMoon | 満月の砲 | commonRailshot | 気力満タンの条件は刻印符「溢れ撃ち」へ |
| dregsBlade | 枯渇の刃 | commonHack | 3 連の弧。気力が少ない時の条件は「血の代償」へ |
| shadowStep | 影渡り | commonBackstab | 背後へ回る。「直後の近接が背面」の旗は失う。連携 shadowExploit の先は新 key へ。ジョブの初期石 |
| guillotine | 断頭振り | commonExecution | 刃先の倍は失う |
| ricochet | 跳弾 | commonRicochet（名を継ぐ） | 跳ねるたびの増加は失う |
| galeSlash | 風切り | commonWindCutter（名を継ぐ） | 敵弾を消して伸びる挙動は失う |
| scatterSigil | 散弾符 | commonScatter | 同形 |
| stomp | 震脚 | commonShockwave | ring。連携 reelStomp は技（衝撃波）へ移す |
| threadReel | 手繰り糸 | commonInhale | pull。reelStomp の先を新 key へ |
| swallowFlip | 燕返し | commonBackstab | dash + 返しの斬撃 |
| boneRing | 骨片の輪 | commonDeflect | 敵弾を止める輪 → 敵弾を消す輪 |
| scorchLine | 焼き払い | commonFireWall | 同形（炎の帯）。連携 oilScorch は技へ移す |
| iceSlide | 凍て道 | commonLunge | 通り道の氷床は失う（刻印符「軌跡」で作れる） |
| bogCall | 沼呼び | commonPoisonMist | 同形（照準地点の毒沼） |
| breakKick | 崩し蹴り | commonRisingSlash | 大きく怯ませ壁へ。breakCollapse の先を新 key へ |
| collapseHammer | 崩落槌 | commonQuake | 崩勢の敵の分岐は失う。breakCollapse は技へ移す |
| tideSlash | 水刃 | commonWindCutter | 濡れの付与は失う |
| siphonMark | 吸魔の矢 | commonShadowBolt | 吸魔の付与は失う |
| weaponArt | 極意 | commonCrossCut | 型の変形表が後継。連携 formArt は技へ移す。`reshapes.ts` の `WEAPON_ART` も消す |
| titanForm | 剛の型 | ironForm | 変身の第 2 弾（削る） |
| swiftForm | 迅の型 | wolfForm | 同上 |
| spiritForm | 霊の型 | wraithForm | 同上 |

### 3-4. 連携 19 → 14

| 連携 | 先 → 後（7c 後） | 扱い |
| --- | --- | --- |
| contagionUnravel / frostBreaker / waterFreeze / brandChain / hueBloom | 変わらず | そのまま |
| hookWhirl | chainHook → **commonWhirl** | `ArtSpec.combos` に移す（apply） |
| parryRail | parry → **commonRailshot** | 同上 |
| diveQuake | **commonMeteorDive** → **commonQuake** | 同上、`after` も差し替え |
| reelStomp | **commonInhale** → **commonShockwave** | 同上 |
| oilScorch | oilPot → **commonFireWall** | 同上 |
| breakCollapse | **commonRisingSlash** → **commonQuake** | 同上 |
| formArt | 変身 5 種 → **commonCrossCut** | 同上（`after` から titan / swift / spirit を外す） |
| levelMeteor | levelGround → **commonMeteorDive** | 同上 |
| shadowExploit | **commonBackstab** → exploit | `after` だけ差し替え（受け側は手書きのまま） |
| wellThunder / frostThunder / wellFrag / hasteSpiral / pactWhirl | — | **消す**（受け側の手書きの分岐が無くなる）。`ComboKey` から外す。図鑑は `isComboKey` で読み捨て（`meta/codex.ts:224`） |

- 連携の `verb` の文は新しい名に直す（手繰り糸 → 吸い風、震脚 → 衝撃波、焼き払い → 炎の壁、崩し蹴り → 昇り斬り、崩落槌 → 地裂き、極意 → 十字斬り、影渡り → 背取り）
- 5 本を消さずに済ませるなら thunder / frag / whirl / spiral を手書きに残す（49 になる）。推奨しない（設計が名指しで吸収としている 4 つで、代わりの吸収先が無い）

### 3-5. 手書きを消すと一緒に直る所（G の最小 Edit）

| 場所 | 中身 |
| --- | --- |
| `src/data/jobs.ts:159, 183, 205, 297, 321` | `starterSkill`: lunge → commonLunge / railshot → commonRailshot / quake → commonQuake / thunder → commonThunderclap / shadowStep → commonBackstab |
| `src/skills/persistence.ts:31-32` | `STARTER_STONES`: whirl → commonWhirl / frag → commonBomb（コメント「旋風斬りとグレネード」も） |
| `src/qa/bot.ts:63, 473-498` | `MELEE_SKILL_KEYS`・`skillEngageRange` の case。技は `ART_DEFS[key].acts` から射程を出す 1 関数に（ring 半径 / arc 届き / line 長さ / dash 距離 / shot 速さ×寿命 / castRange） |
| `src/qa/simulation.test.ts:233-236` | `QA_SKILL_LOADOUT`: whirl / railshot / lunge / frag → commonWhirl / commonRailshot / commonLunge / commonBomb |
| `src/system/skills.ts:939, 1006` | 既定の照準距離が `SKILL.frag.maxRange`。frag の数値を消すと落ちるので `SKILL.defaultCastRange` を JSON に足して差し替える（前置きで先にやる） |
| `src/system/skills.ts:174-175, 253, 464-471, 1280-1376, 1956-2048` | BASE 7 種の CAST・active 状態・射程・`boneRing` の初期値、変身第 2 弾（`SkillRunState.form`） |
| `src/skills/actions2.ts:686-780`、`src/skills/types.ts:126, 773`、`src/render/skillHud.ts:612, 911, 921`、`src/skills/combos.ts:187`、`src/skills/forms.ts:89-90` | 変身第 2 弾（`FormSkillKey` / `rs.form`）の撤去 |
| `src/render/skillHud.ts:716-833` | 消したスキルの case（whirl / railshot / quake / spiral / lunge / meteorDive / threadReel / guillotine / dregsBlade / stomp / swallowFlip） |
| `src/skills/modifiers.ts:15, 18, 82, 242`、`src/skills/modifiers2.ts:15, 102, 138, 201` | `SPECIAL_MANA` / `NO_POISE` / `OWN_ELEMENT` / `excludesSkills` / `onlySkills` の消えた key |
| `src/skills/reshapes.ts:9-`（`WEAPON_ART`）、`src/skills/tuning2.ts:14`、`src/render/thrownLook.ts:120-127`（`WEAPON_ART_LOOK`） | 極意の表 |
| `src/meta/tips.ts:178-179` | 「武器技」の項目を消し「共通技」の本文を「どの武器でも撃て、武器の型で形が変わる」に（F） |

## 4. 刻印符 30

### 4-1. 30 枚の key（旧 key を残す 13 + 新 key 17）

実装の種類: **A** = `apply`（CastParams。手書きにも付く）/ **T** = `transform`（行為の列。技だけ）/ **R** = 既存の `reshape` の仕組み / **X** = `autoCast`。区分（変形 / 循環）は `ModifierDef.family: "shape" | "cycle"` の表示用のフィールドにする。

| # | key | 表示名 | 区分 | 出典 | 実装 | 中身（数値は仮） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `split`（新） | 分裂 | 変形 | spread（中身が別物なので key を変える） | T | shot / arc を 3 つに（威力 ×0.5） |
| 2 | `chain`（新） | 連鎖 | 変形 | 新（旧 chainReset の表示名を継ぐ） | A（hit.ts の命中時） | 命中点から次の敵へ跳ぶ |
| 3 | `orbit`（新） | 旋回 | 変形 | 新 | T | shot → 自分の周りを回る弾（`BulletDef.orbit` 流用） |
| 4 | `linger`（**残す**） | 据え置き | 変形 | linger（中身は toTrap の仕組み） | R | その場に留まり、近付いた敵に発動（祝福「居残り」の grantsModifier が指す） |
| 5 | `delay`（残す） | 遅延 | 変形 | delay | A | 2 秒後に出て ×1.5 |
| 6 | `echo`（**残す**） | 反響 | 変形 | echo | A | 0.5 秒後にもう一度 ×0.5（祝福「木霊」の grantsModifier が指す） |
| 7 | `focus`（新） | 収束 | 変形 | expand の逆 | A | 範囲 ×0.5・威力 ×1.6 |
| 8 | `tripleHit`（新） | 重ね打ち | 変形 | followUp（中身が別物） | T | 1 撃を 3 段に（1 段 ×0.4） |
| 9 | `charge`（残す） | 溜め | 変形 | charge | A | 長押しで段 |
| 10 | `toTarget`（新） | 照準起点 | 変形 | toThrown + toLobbed | R + T | 技は self → target、手書きは近接 = toThrown / 置くもの = toLobbed の仕組み |
| 11 | `toNova`（残す） | 足元起点 | 変形 | toNova | R + T | 技は target → self、手書きは今の reshape |
| 12 | `trail`（新） | 軌跡 | 変形 | 新 | T | dash / blink の通り道に攻撃の属性の地形 |
| 13 | `ghost`（新） | 分身 | 変形 | 新 | A | 0.3 秒遅れて同じスキル（反響の写しの仕組みで、位置は撃った時の自分）。`Ghost` という実体は今は無い（`dashGhost` は見た目だけ） |
| 14 | `recall`（新） | 戻り刃 | 変形 | 新 | T | shot が戻る（投具の段 `recall` の流用） |
| 15 | `pierce`（残す） | 貫き | 変形 | pierce | A | 貫通 +2 |
| 16 | `burst`（新） | 爆ぜ | 変形 | 新 | A（hit.ts） | 命中点で小爆発（explode 0.4） |
| 17 | `tether`（残す） | 手繰り | 変形 | tether | A | 命中を中心へ寄せる |
| 18 | `leyline`（残す） | 地形化 | 変形 | 4 infuse の束ね | A | 着弾点に攻撃の属性の地形。**今の leyline の実装がそのままこれ**（`system/skills.ts:1034` の `leyPool`）。4 infuse の「属性を変える」は捨てる（杖の型の変形が後継） |
| 19 | `autoFinisher`（新） | 終撃連動 | 変形 | 新 | X | 武器の終撃と同時に撃つ（気力は払う） |
| 20 | `autoRiposte`（新） | 応手連動 | 変形 | 新 | X | 応手と同時に撃つ |
| 21 | `bloodPrice`（残す） | 血の代償 | 循環 | bloodPrice + bloodTithe | A | 気力の代わりに生命で払う（今の bloodTithe の払い方に統合） |
| 22 | `spillover`（残す） | 溢れ撃ち | 循環 | spillover | A | 気力満タンで ×1.3 |
| 23 | `streak`（新） | 刻み撃ち | 循環 | cycle 改（中身が逆なので key を変える） | A | 同じスキルを続けて撃つたび +10%（別で途切れる） |
| 24 | `refund`（残す） | 巡り | 循環 | refund | A | 命中で気力が戻る（払った額まで） |
| 25 | `overheat`（残す） | 過熱 | 循環 | overheat | A | 連続で倍が上がり上限で暴発 |
| 26 | `patience`（新） | 蓄え | 循環 | deferred 改（中身が別物） | A | 撃たずに待つほど強い |
| 27 | `sympathy`（新） | 呼応 | 循環 | 新 | A | 他のスキルの直後に撃つと ×1.3 |
| 28 | `desperate`（残す） | 背水 | 循環 | desperate 改 | A | 生命の減りに比例して再使用が縮む |
| 29 | `offering`（新） | 捧げ | 循環 | 新 | A | 奥義ゲージを払って ×1.5 |
| 30 | `ledger`（新） | 帳 | 循環 | 新 | A | 撃った数を積み 10 発ごとに無料 |

- 変形 20 / 循環 10。技だけに付く（T）は 5 枚（分裂・旋回・重ね打ち・軌跡・戻り刃）。残り 25 枚は手書き 45 にも付く。設計の「変形 = transform を持つ」をそのまま実装すると手書きに付く変形が 0 になり、手書き 45 の石で遊べる符が循環 10 だけになるので、**変形の区分は表示の分類にとどめ、実装は行為の列が要るものだけ transform** にするのを推奨
- 表示名を設計の表から変えたもの（既存の名と重なるため）: 周回 → 旋回（`data/weapons.ts:962` 弾の特徴「周回」）/ 設置 → 据え置き（「設置物」の一般語）/ 連打 → 重ね打ち（「連打間隔」）/ 呼び戻し → 戻り刃（残響の操作「呼び戻し」、GLOSSARY 269 行）/ 引き寄せ → 手繰り（共通技「引き寄せ」）/ 血払い → 血の代償（祝福「血払い」`boonDefs/moon.ts:168`）/ 共振 → 呼応（ランイベント「反応の共振」）/ 代償 → 背水（GLOSSARY で「代償」は呪い付き・性質の語）

### 4-2. 今の 53 との突き合わせ

| 扱い | 旧 key |
| --- | --- |
| key を残す（13） | delay / echo / charge / pierce / tether / linger / toNova / leyline / bloodPrice / spillover / refund / overheat / desperate |
| 表の出典として新 key に吸収（11） | spread → split / followUp → tripleHit / cycle → streak / deferred → patience / toThrown・toLobbed → toTarget / fireInfuse・iceInfuse・stormInfuse・venomInfuse → leyline / bloodTithe → bloodPrice |
| 削る（29） | multiCharge / comboFuel / recoil / chainReset / curse / expand / dryFire / bladeFeed / timeLock / fuelize / heavy / feather / repel / lastGasp / sustain / landing / attune / flank / pointBlank / longshot / toStaged / toTrap（仕組みは linger へ）/ breakInfuse / hueInfuse / crumble / jobMastery / weaponBond / formSurge / formLinger |

- 設計との差分: ① 設計の「削る（23）」は実際には 30 個の名が並んでおり、そのうち `leyline` は「地形化」の実装そのもの、`toTrap` は「据え置き」の仕組みなので削らず流用 → 削るのは 29（加えて出典として消える 11）。② `bloodTithe` は設計の表にも削るにも無い → 「血の代償」に統合。③ 表にあって今無い符は新 key 17 枚
- 手持ちの符は ★1 で全部消えるので、符の key の写し表は要らない（`sanitizeRune` が知らない key を落とす）
- 祝福: `boonDefs/cycle.ts:143` echoCall → `echo` は残る。`boonDefs/horde.ts:142` lingerOn → `linger` は残るが中身が「延命（設置物が長く残る）」から「据え置き」に変わるので desc（`:132`）を直す。`boonDefs/thunder.ts:169` thunderLeap のコメント「刻印符『連鎖』…まだ無い」→ 7c で `grantsModifier: "chain"` にできる（任意。今の Rule でも効き目は同じ）

## 5. 変形表（型 15）

- 置き場: `src/skills/arts/transform.ts`（新）に `ART_TRANSFORMS: Readonly<Record<FormKey, ArtTransform>>`、`ArtTransform = { readonly acts: (acts: readonly ArtAct[], n: TransformNumbers) => ArtAct[]; readonly element?: "weapon"; readonly label: (n) => string }`。**純関数**（state も rng も読まない）。数値は `src/data/balance/skills/ART/TRANSFORM/<型>.json`、`_fields` は `ART/TRANSFORM/_index.json` に 1 回
- 適用: `castArt`（`skills/arts/engine.ts:73`）の頭で `currentForm(state).key`（`system/morale.ts:63`。改鋳込み）を引いて `acts` を作り直す。**遅れて出る行為の予約 `ArtPending` は今 `act: number`（添字）で `ART_DEFS[p.key].acts[p.act]` を引き直している（`engine.ts:111`）** → 変形で行為の数が変わる（鎖の pull 挿入、鈴の写し）と添字がずれるので、`ArtPending.act` を **解決済みの `ArtAct` そのもの** にする（H の符の transform もこの後ろに積むので、発動時に決めた列を持ち運ぶのが一番単純）
- 型が照準地点を使わない技を照準地点へ変える（砲）ときの射程は `ART_CAST_RANGE` に無いので、前置きで入れる `SKILL.defaultCastRange` に落ちる
- 表示: `skills/data.ts` の `stoneLabel` の隣に `transformLabel(state, key)` =「今の型: 重打（範囲 ×1.3・段 −1）」。石のツールチップの 1 行

| 型（FormKey / 名） | 変形の中身 | `TRANSFORM/<型>.json` の項目（仮値） | ラベル |
| --- | --- | --- | --- |
| blade / 剣 | 変えない（基準の型） | なし（`{}`） | 変形なし |
| flurry / 連刃 | 与ダメの行為の hits +2・威力 ×0.6。弾は count +2・威力 ×0.6 | `hitsAdd 2, damageMul 0.6, shotCountAdd 2` | 段 +2・1 撃 ×0.6 |
| crusher / 重打 | ring / arc / pull の範囲 ×1.3、hits −1（下限 1）、怯み値 ×1.5、heavy。dash の距離 ×0.8 | `areaMul 1.3, hitsAdd -1, poiseMul 1.5, dashDistanceMul 0.8` | 範囲 ×1.3・段 −1 |
| hewer / 刃斧 | 与ダメの行為に出血 1 を足す。出血を狙う行為（vs bleed）の倍 ×1.2。威力 ×0.9 | `bleedStacks 1, bleedDuration 4, vsMulMul 1.2, damageMul 0.9` | 命中で出血 |
| polearm / 長柄 | arc → line（長さ = 届き ×1.6、幅 14）。line の長さ ×1.3。dash の距離 ×1.2 | `arcLineLengthMul 1.6, arcLineWidth 14, lengthMul 1.3, dashDistanceMul 1.2` | 弧を突きに・長さ ×1.3 |
| chain / 鎖 | 最初の与ダメの範囲行為（arc / ring / line）の前に、同じ起点の pull を挟む。威力 ×0.9 | `pullRadius 56, pullTo 14, damageMul 0.9` | 当てる前に引き寄せ |
| bulwark / 盾 | ring / arc が敵弾を消す。ノックバック ×1.6。dash / buff の無敵 +0.15 秒。威力 ×0.9 | `knockbackMul 1.6, invulnAdd 0.15, damageMul 0.9` | 敵弾を消す・押し返し ×1.6 |
| warfan / 扇 | ring / arc が敵弾を消す。ノックバック ×1.8。弾は count +2（間隔 12°）・威力 ×0.8 | `knockbackMul 1.8, shotCountAdd 2, shotSpreadDeg 12, damageMul 0.8` | 突風（敵弾を消す） |
| rod / 杖 | 攻撃の属性を武器の属性に（無属性の武器なら威力 ×1.15。旧 刻印符「武器写し」の後継）。付ける状態異常 +1 重ね。弾の半径 ×1.3・速さ ×0.85 | `plainMul 1.15, statusStacksAdd 1, shotRadiusMul 1.3, shotSpeedMul 0.85` + TS 側 `element: "weapon"` | 属性を武器に |
| thrower / 投具 | arc → shot 3 本（間隔 15°・貫通 1）、line → shot 1 本（貫通 3）。威力 ×0.8 | `arcShotCount 3, arcShotSpreadDeg 15, arcShotPierce 1, lineShotPierce 3, shotSpeed 280, shotLife 0.45, damageMul 0.8` | 振りを投げに |
| pistol / 短銃 | arc → shot 3 本（間隔 12°）、line → shot 2 本。威力 ×0.55 | `arcShotCount 3, arcShotSpreadDeg 12, lineShotCount 2, shotSpeed 340, shotLife 0.4, damageMul 0.55` | 振りを弾に |
| rifle / 長銃 | arc / line → shot 1 本（貫通 3・速さ 420）。元からの弾は貫通 +2・速さ ×1.5。威力 ×1.2 | `shotPierce 3, shotSpeed 420, shotLife 0.5, shotPierceAdd 2, shotSpeedMul 1.5, damageMul 1.2` | 振りを貫く 1 発に |
| artillery / 砲 | arc と ring@self → ring@target（半径 = 届き / 半径 ×0.8、0.25 秒遅れ）。shot → ring@target。威力 ×1.15 | `ringFromReachMul 0.8, delayAdd 0.25, damageMul 1.15` | 照準地点へ砲撃 |
| tome / 書 | 行為は変えない（再使用 ×0.7 は今の `formSkillCooldownMul`、`system/tomeBell.ts:68` のまま） | なし（`FORM.tome.skillCooldownMul` を表示に使う） | 再使用 ×0.7 |
| bell / 鈴 | 与ダメの ring に 0.5 秒後の写し（×0.5）を足す | `echoDelay 0.5, echoMul 0.5` | 鳴り返し |

- 設計の例からの差: 砲だけ「arc → shot」ではなく「照準地点へ砲撃」にした（砲の型の遊び「置いて広げて起爆」に合い、短銃・長銃の弾と被らない）
- テスト（`skills/arts/transform.test.ts`）: 60 技 × 15 型で ① 同じ入力に同じ出力（2 回呼んで toEqual）② kind が `ART_ACT_KINDS` の中 ③ 数値が有限・hits ≥ 1 ④ 剣・書は恒等 ⑤ 鎖は pull が最初の範囲行為の前に 1 つ ⑥ 短銃・長銃・投具で arc が残らない ⑦ 遅れて出る行為が型を持ち替えても予約した形で出る（`updateArtQueue`）

## 6. レーン分けの確認と修正案

### 6-1. 設計の F ∥ G ∥ H で起きる衝突

1. **G が F に依存する**: 吸収先の新しい共通技（commonWhirl / commonLunge / commonRailshot / commonQuake / commonBomb / commonBackstab …）は F が作る。G が消す key の差し替え（`jobs.ts` の初期石、`STARTER_STONES`、QA の石、連携の `after`、技への `combos`）は F の後でないと tsc が通らない
2. **G と H が同じ大きなファイルを両方大きく触る**: `system/skills.ts`（G: BASE 7 種の active 状態と変身第 2 弾の撤去 / H: 消える符の params の処理 20 か所超と `grantRune`・`tryAutoCast`）、`skills/types.ts`（G: `LEGACY_SKILL_KEYS`・`FormSkillKey`・`ComboKey` / H: `MODIFIER_KEYS`・`CastParams`・runes）、`skills/data.ts`（G: 4 つの key 表 / H: `MODIFIERS`・`canAttach`・リンク / F: `stoneLabel`・`ART_WEIGHTS`）、`render/skillHud.ts`（G: 消えたスキルの case / H: 符の表示と罠の輪）、`skills/modifiers*.ts`（G が消す key を excludesSkills から外さないと tsc が落ちるが、H は同じファイルを書き直す）
3. **`LEGACY_SKILL_MAP` の置き場**: 設計は `persistence.ts`（H 所有、F / G は編集禁止）。ところが key を消すのは F（武器技 298）と G（手書き 31）で、写し表が同じコミットに無いと、その間のコミットで石が黙って消える
4. **所有の漏れ**: 消える符の処理が `skills/hit.ts`（flank / pointBlank / longshot / attune / repel / curse / followUp / spread / hueInfuse / crumble / lastGasp）、`skills/actions.ts:834`（landing）、`skills/forms.ts:422`（gaspPool）、`skills/placed.ts:129`・`skills/summons.ts:53, 174`（toLobbed）にあり、H の表に無い。G は `data/jobs.ts`・`qa/bot.ts`・`render/skillHud.ts`・`render/thrownLook.ts`・`skills/reshapes.ts` が表に無い

### 6-2. 修正案（推奨）: 前置き → (F ∥ H1) → G → H2

| 段 | レーン | 所有 | 最小 Edit | 完了条件 |
| --- | --- | --- | --- | --- |
| 前置き（統合役、1 コミット、挙動は変えない） | — | `src/skills/legacyKeys.ts`（新: 空の `LEGACY_SKILL_MAP` と `migrateSkillKey`） | `skills/persistence.ts`（`sanitizeStone` に 1 行）、`skills/arts/types.ts`（`ArtSpec.combos?`）、`skills/arts/build.ts`（combos を SkillDef へ渡す 1 行）、`skills/types.ts`（`ModifierDef.transform? / autoCast? / family?`）、`balance/skills/SKILL/_index.json`（`defaultCastRange`）+ `system/skills.ts:939, 1006`（`SKILL.frag.maxRange` → `SKILL.defaultCastRange`） | `npm run check` |
| 1 | **F 技の圧縮と変形表**（Opus） | `skills/arts/**`（keys / common.ts 24 / **common2.ts 36（新）** / transform.ts・transform.test.ts（新）/ engine.ts / index.ts / build.ts / types.ts / arts.test.ts、blades・polearms・heavy・guns・throwing.ts は削除）、`balance/skills/ART/**`（common.json 60、TRANSFORM/*.json、武器種の 25 ファイル削除、`weights` 削除）、`render/thrownLook.ts` / `thrownLook.test.ts`（SKILL_LOOK を新 key に、投げる絵は武器種で引く） | `skills/legacyKeys.ts`（武器技 298 行）、`skills/generator.ts`（`skillWeight`）、`skills/data.ts`（`ART_WEIGHTS` の import と `transformLabel`）、`meta/tips.ts:178-179` | 60 技・moveset 全て null・変形表のテスト |
| 1 | **H1 ラン内化**（Sonnet） | `skills/persistence.ts`（runes 読み捨て・settle / dedupe 削除・links を読まない・wear の link → power）、`skills/persistence.test.ts`、`ui/skillRunes.ts`、`render/skillRuneUi.ts`、`balance/skills/SKILL/_index.json`（`slotLinks [4,3,2,2]`、linkWeights / maxLinks / linkBurdenPenalty / runeCapacity 削除） | `skills/types.ts`（`SkillProfile.runes` / `SkillStone.runes`）、`skills/data.ts`（`maxStoneLinks` / `burdenLinks` / `wearBonusLinks`）、`skills/generator.ts`（`stoneFromSeed` の links 0）、`skills/wear.ts`、`system/skills.ts`（`grantRune` → `attachRune`・`moveRunModifier`）、`system/specialRooms.ts:677-684`（図書館の符）、`ui/inventory.ts`、`core/replay.ts`（runeCount）、拠点の 1 回だけのログ | `rg "profile.runes\|stone.runes" src` が 0 |
| 2 | **G 手書き 76 → 45**（Opus 推奨。system/skills.ts の撤去が大きい） | `skills/defs.ts` / `defs2.ts` / `defs3.ts` / `actions.ts` / `actions2.ts` / `shots.ts` / `summons.ts` / `forms.ts` / `combos.ts` / `reshapes.ts` / `tuning*.ts`、`balance/skills/{EXTRA,WAVE2,WAVE3}_SKILL_TUNING`・`COMBO_TUNING`・`WAVE2_COMBO_TUNING`・BASE の 7 種の数値、`skills/skills.test.ts` / `forms.test.ts` / `expansion*.test.ts` / `hit.test.ts` / `wear.test.ts` / `mireCrumble.test.ts` | `skills/types.ts`（LEGACY 45・`FormSkillKey`・`ComboKey`）、`skills/data.ts`（4 表）、`system/skills.ts`（BASE 7 種・変身第 2 弾）、`skills/modifiers.ts` / `modifiers2.ts`（消えた skill key の参照だけ）、`skills/legacyKeys.ts`（31 行）、`skills/arts/common*.ts`（8 技に `combos`）、`data/jobs.ts`（初期石 5）、`skills/persistence.ts:31-32`、`qa/bot.ts`、`qa/simulation.test.ts`、`render/skillHud.ts`、`render/thrownLook.ts`（WEAPON_ART_LOOK）、3-5 の表のテスト | `SKILL_KEYS` 105・連携 14 |
| 3 | **H2 刻印符 30・連動**（Opus） | `skills/modifiers.ts` / `modifiers2.ts`（30 に書き直し）、`skills/hit.ts`（命中時の符）、`balance/skills/SKILL/modifier.json`・`EXTRA_MODIFIER_TUNING.json`・`WAVE2_MODIFIER_TUNING.json`、`skills/autoCast.test.ts`（新） | `skills/types.ts`（`MODIFIER_KEYS`・`ReshapeKey`・`RangeBias`・`CastParams`）、`skills/data.ts`（`MODIFIERS`・`canAttach`・`modifierLinkCost`）、`system/skills.ts`（消える符の処理・`tryAutoCast`・`castSlotAt`）、`system/moments.ts`（2 行）、`skills/arts/engine.ts`（符の transform を型の変形の後ろに）、`skills/actions.ts` / `forms.ts` / `placed.ts` / `summons.ts`（landing・gaspPool・toLobbed）、`render/skillHud.ts`（罠の輪・符の色）、`system/boonDefs/horde.ts`（lingerOn の desc）、`meta/tips.ts`（符の項目） | 符 30・終撃 / 応手連動のテスト |

- F と H1 が同時に触るのは `skills/data.ts` と `skills/generator.ts` だけで、関数が別（F: `skillWeight`・`ART_WEIGHTS`・`transformLabel` / H1: リンクの関数と `stoneFromSeed`）
- G を Sonnet に任せるなら、`system/skills.ts` の BASE 7 種の撤去（active 状態の switch 5 か所）だけ先に統合役か Opus がやる
- REPLAY_VERSION 29 は H2 の後に統合役が 1 回だけ上げる（途中の段は push しない前提）。`core/replay.ts:441` の `PLACEHOLDER_SKILL_KEY = SKILL_KEYS[0]` は whirl が消えると parry に変わる（版を上げるので問題ないが、記録の中身が変わることは承知しておく）

## 7. 壊れそうなテストと、他の層で key を列挙している箇所

### 7-1. テスト（レーン別）

| レーン | テスト | 理由 |
| --- | --- | --- |
| F | `skills/arts/arts.test.ts:75-128, 131-160, 227` | 武器種ごとに 10 種以上・key の接頭辞・抽選の重み（matched / other）・「違う武器種では撃てない」・十字斬りの 2 手目（→ commonCrossCut で書き直せる）・`artMoveset` |
| F | `render/thrownLook.test.ts:75-81, 108-111` | spearHurl / shieldThrow / wandDarkOrb / thrownDagger / axeHatchet の絵（と G の weaponArt） |
| H1 | `skills/persistence.test.ts:54-146`（30 か所）、`ui/inventory.test.ts:172-254`、`core/replay.test.ts:329-339`（`runeCapacity` / `ownedRunes`）、`system/specialRooms.test.ts:201`（図書館の符が所持品に入る）、`skills/wear.test.ts`（link の芽 9 か所）、`system/skills.test.ts`（grantRune 6 か所） | 永続の符・リンクの廃止 |
| G | `skills/skills.test.ts`（手書きの key 584 行ぶん。`:187` CD 型の数 16 → 9、`:234` アイコン重複、`:343` 76 → 45、`:570` crumble の onlySkills）、`system/skills.test.ts`（93）、`skills/expansion2.test.ts`（44）、`skills/expansion.test.ts`（36）、`skills/hit.test.ts`（26）、`skills/forms.test.ts`（10）、`skills/mireCrumble.test.ts`（5） | 消える 31 と変身第 2 弾 |
| G | `system/rulesLineage.test.ts:68-133`・`system/boonDefs/cycle.test.ts:106-207`・`system/boonDefs/horde.test.ts:37`・`system/boonRules.test.ts:50-51`・`system/hub.test.ts:99`・`system/blast.test.ts:94`・`system/boons.test.ts:374, 391, 418`・`core/replay.test.ts:527, 536, 543`（STARTER = lunge / frag）・`system/tomeBell.test.ts:137-138`・`system/enemiesWave3.test.ts:366-369`（scribeMoveOf の key）・`system/elitesWave3.test.ts:15`・`system/contractors.test.ts:478`（titanForm）・`render/elementUi.test.ts:18`（thunder）・`data/ultimates.test.ts`（`WEAPON_ART` の import）・`qa/simulation.test.ts:233-236` | 石の key に whirl / frag / lunge / thunder / railshot / quake / titanForm を使っている。多くは `withStone("whirl")` を別の残る石（parry / chainHook など）か commonWhirl に差し替えるだけ |
| H2 | `skills/skills.test.ts:345`（53 → 30）と符の節（39 か所）、`skills/expansion.test.ts`（18）、`skills/expansion2.test.ts`（14）、`system/skills.test.ts`（12）、`skills/forms.test.ts`（6）、`skills/arts/arts.test.ts:117, 203`（付く符が 3 つ以上・反響）（`effects.test.ts`・`fxAttack.test.ts`・`bullets.test.ts`・`earth.test.ts` の pierce / spread / heavy / crumble は弾の特徴・打撃の重さ・祝福の key で、符ではないので壊れない） | 符 30 |
| 共通 | `core/replay.test.ts`（REPLAY 29）、`npm run audit:docs`（CODE_MAP の skills 行・arts 行、`weaponArtLabel` 等の識別子、`recipes/skill.md:10-21` の `WEAPON_ART_KEYS`、GLOSSARY の旧スキル名・刻印符名の行 `GLOSSARY.md:390`） | 資料 |

### 7-2. 他の層で key を列挙・直書きしている箇所（`rg` の結果）

| 種類 | 場所 | 7c での扱い |
| --- | --- | --- |
| 初期石 | `data/jobs.ts:159, 183, 205, 297, 321`（lunge / railshot / quake / thunder / shadowStep） | G で新 key へ |
| 初期の石 | `skills/persistence.ts:31-32`（whirl / frag） | G で commonWhirl / commonBomb |
| QA | `qa/bot.ts:63, 473-498`、`qa/simulation.test.ts:233-236` | G |
| 祝福 | `system/boonDefs/cycle.ts:143`（echo）、`horde.ts:142`（linger）、`thunder.ts:169`（コメントの「連鎖」） | key は残る。horde の desc を H2 が直す |
| 描画 | `render/skillHud.ts:612, 716-833, 911, 921`（手書きの case・変身）、`:281, 592, 1049`（符）、`render/thrownLook.ts:84-127`（SKILL_LOOK / WEAPON_ART_LOOK。`Record<string>` なので tsc は通り、テストだけが落ちる） | G / H2 / F |
| 図鑑・連携の発見 | `meta/codex.ts:224`（`isComboKey` で読み捨て）、`meta/links.ts:61-70`（`SKILL_DEFS.combos` を回す = 技の combos も自動で載る） | 変更不要 |
| 闇市 | `system/blackMarket.ts:80-87`（`SKILL_KEYS` を回す） | 変更不要（105 に減るだけ） |
| リプレイ | `core/replay.ts:28, 94, 421, 437, 441-442, 461, 493, 508, 791, 818`（`SKILL_KEYS[0]` / `MODIFIER_KEYS[0]` の仮の key、runeCount） | H1（runeCount）、版は統合役 |
| 写本の敵 | `system/enemyWave3.ts:386-393`（`SKILL_DEFS` の tags で読む） | 変更不要（テストの key だけ） |
| 符の処理 | `skills/hit.ts:94-299`、`skills/actions.ts:834`、`skills/forms.ts:422`、`skills/placed.ts:129`、`skills/summons.ts:53, 174`、`system/skills.ts:385-396, 456, 764-780, 829-933, 947, 1042-1062, 1123-1160, 1214, 1250-1253, 1852-1880` | H2 |
| Tips | `meta/tips.ts:178-179`（共通技 / 武器技）と符の項目 | F / H2 |
| 同名だが別物（触らない） | `data/ultimates.ts` の `lunge`（奥義の行為の種類）、`system/runEvents.ts` の `quake`（ランイベント）、`core/state.ts:582` の `quake`（奥義の演出）、`data/weapons.ts` の `ricochet` / `spread` / `pierce`（弾の特徴）、`system/specialRooms.ts` の `curse`（部屋の小道具）、`LineageKey` の `thunder`、`boonDefs/earth.ts:193` の `crumble`（祝福 key） | — |

## 8. 不確かな点（確認方法）

1. **同じ key の石が並ぶ**: 写しで 1 人の倉庫に commonWhirl が何個も並ぶ。2 スロットに同じ key の石を入れて困る所が無いか → `sanitizeLoadout` は石の id しか見ないので入る。`resolveSlot` / 連携 / `recentSlots`（刻み撃ち・呼応）が key で見るなら挙動が変わる。H2 のテストで「同じ key の 2 枚」を 1 ケース
2. **砲の型で照準地点へ移した技の射程**: `ART_CAST_RANGE` に無い技は `SKILL.defaultCastRange` に落ちる。前置きで frag の値（`SKILL.frag.maxRange`）をそのまま移せば挙動は同じ → `rg "frag.maxRange" src` が 0 になること
3. **終撃連動の照準**: `castSlot` は `FrameInput` から照準を作る（`system/skills.ts:936-940`）。自動発動は入力が無いので、終撃の敵の位置を照準に使う `castSlotAt(state, index, target)` を足すのを推奨。連動が連動を呼ばない（スキルの命中は終撃にならない）ことを `autoCast.test.ts` で確認
4. **刻印符が消えた旨のログ**: 「拠点で 1 回だけ」の記録先。旧セーブは `runes` を持つので、`loadSkillProfile` が「runes を読み捨てた」ことを返し、次の保存で runes が消える = 自然に 1 回だけになる。別の既読フラグは要らない見込み → H1 の persistence.test で「2 回目の読み込みでは出ない」
5. **7d との順序**: 彩刻・色解き（hueEtch / hueRelease）は「装備の共鳴の色」を読む。7d で色の共鳴が消えるので、その時点で読む先を決める必要がある（7c では残す）
