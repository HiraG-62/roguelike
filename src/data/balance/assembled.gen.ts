// 自動生成（scripts/balance-assemble.mjs）。手で直さない。JSON を足したり消したりしたら `npm run balance:gen`
// 配置の決まりは docs/BALANCE.md「ファイルの配置」
import j_boons__index from "./boons/_index.json";
import j_boons_BOON from "./boons/BOON.json";
import j_boons_LINEAGE__index from "./boons/LINEAGE/_index.json";
import j_boons_LINEAGE_ash from "./boons/LINEAGE/ash.json";
import j_boons_LINEAGE_frost from "./boons/LINEAGE/frost.json";
import j_boons_LINEAGE_thunder from "./boons/LINEAGE/thunder.json";
import j_boons_LINEAGE_moon from "./boons/LINEAGE/moon.json";
import j_boons_LINEAGE_earth from "./boons/LINEAGE/earth.json";
import j_boons_LINEAGE_blade from "./boons/LINEAGE/blade.json";
import j_boons_LINEAGE_cycle from "./boons/LINEAGE/cycle.json";
import j_boons_LINEAGE_horde from "./boons/LINEAGE/horde.json";
import j_boons_LINEAGE_wealth from "./boons/LINEAGE/wealth.json";
import j_boons_LINEAGE_fusion from "./boons/LINEAGE/fusion.json";
import j_boons_LINEAGE_cursed from "./boons/LINEAGE/cursed.json";
import j_combat__index from "./combat/_index.json";
import j_combat_MANA from "./combat/MANA.json";
import j_combat_HEAL from "./combat/HEAL.json";
import j_combat_BLAST_FALLOFF from "./combat/BLAST_FALLOFF.json";
import j_combat_STATUS__index from "./combat/STATUS/_index.json";
import j_combat_STATUS_chill from "./combat/STATUS/chill.json";
import j_combat_STATUS_freeze from "./combat/STATUS/freeze.json";
import j_combat_STATUS_shock from "./combat/STATUS/shock.json";
import j_combat_STATUS_paralyze from "./combat/STATUS/paralyze.json";
import j_combat_STATUS_poison from "./combat/STATUS/poison.json";
import j_combat_STATUS_bleed from "./combat/STATUS/bleed.json";
import j_combat_STATUS_vulnerable from "./combat/STATUS/vulnerable.json";
import j_combat_STATUS_weaken from "./combat/STATUS/weaken.json";
import j_combat_STATUS_fear from "./combat/STATUS/fear.json";
import j_combat_STATUS_silence from "./combat/STATUS/silence.json";
import j_combat_STATUS_wet from "./combat/STATUS/wet.json";
import j_combat_STATUS_soaked from "./combat/STATUS/soaked.json";
import j_combat_STATUS_oiled from "./combat/STATUS/oiled.json";
import j_combat_STATUS_blaze from "./combat/STATUS/blaze.json";
import j_combat_STATUS_corrode from "./combat/STATUS/corrode.json";
import j_combat_STATUS_brand from "./combat/STATUS/brand.json";
import j_combat_STATUS_broken from "./combat/STATUS/broken.json";
import j_combat_STATUS_doom from "./combat/STATUS/doom.json";
import j_combat_STATUS_siphon from "./combat/STATUS/siphon.json";
import j_combat_STATUS_hue from "./combat/STATUS/hue.json";
import j_combat_STATUS_scorch from "./combat/STATUS/scorch.json";
import j_combat_STATUS_venom from "./combat/STATUS/venom.json";
import j_combat_STATUS_hemorrhage from "./combat/STATUS/hemorrhage.json";
import j_combat_STATUS_encase from "./combat/STATUS/encase.json";
import j_combat_STATUS_exposed from "./combat/STATUS/exposed.json";
import j_combat_STATUS_enfeeble from "./combat/STATUS/enfeeble.json";
import j_combat_STATUS_haste from "./combat/STATUS/haste.json";
import j_combat_STATUS_harden from "./combat/STATUS/harden.json";
import j_combat_STATUS_wrath from "./combat/STATUS/wrath.json";
import j_combat_STATUS_fury from "./combat/STATUS/fury.json";
import j_combat_STATUS_charged from "./combat/STATUS/charged.json";
import j_combat_STATUS_steam from "./combat/STATUS/steam.json";
import j_combat_STATUS_conduct from "./combat/STATUS/conduct.json";
import j_combat_STATUS_kindle from "./combat/STATUS/kindle.json";
import j_combat_STATUS_quench from "./combat/STATUS/quench.json";
import j_combat_STATUS_miasma from "./combat/STATUS/miasma.json";
import j_combat_STATUS_shatterBleed from "./combat/STATUS/shatterBleed.json";
import j_combat_STATUS_cauterize from "./combat/STATUS/cauterize.json";
import j_combat_STATUS_panic from "./combat/STATUS/panic.json";
import j_combat_STATUS_lacerate from "./combat/STATUS/lacerate.json";
import j_combat_STATUS_wound from "./combat/STATUS/wound.json";
import j_combat_ATTR from "./combat/ATTR.json";
import j_combat_ATTR_GAIN from "./combat/ATTR_GAIN.json";
import j_combat_POISE from "./combat/POISE.json";
import j_combat_PARRY from "./combat/PARRY.json";
import j_combat_GENRE from "./combat/GENRE.json";
import j_combat_ELEMENT from "./combat/ELEMENT.json";
import j_combat_TERRAIN from "./combat/TERRAIN.json";
import j_combat_TERRAIN_MUD_SMOKE from "./combat/TERRAIN_MUD_SMOKE.json";
import j_combat_TERRAIN_RUBBLE from "./combat/TERRAIN_RUBBLE.json";
import j_combat_PLAYER from "./combat/PLAYER.json";
import j_combat_ACTION from "./combat/ACTION.json";
import j_combat_ENERGY from "./combat/ENERGY.json";
import j_enemies__index from "./enemies/_index.json";
import j_enemies_ENEMY_AI__index from "./enemies/ENEMY_AI/_index.json";
import j_enemies_ENEMY_AI_knight from "./enemies/ENEMY_AI/knight.json";
import j_enemies_ENEMY_AI_bomber from "./enemies/ENEMY_AI/bomber.json";
import j_enemies_ENEMY_AI_laser from "./enemies/ENEMY_AI/laser.json";
import j_enemies_ENEMY_AI_golem from "./enemies/ENEMY_AI/golem.json";
import j_enemies_ENEMY_AI_bat from "./enemies/ENEMY_AI/bat.json";
import j_enemies_ENEMY_AI_wisp from "./enemies/ENEMY_AI/wisp.json";
import j_enemies_ENEMY_AI_volley from "./enemies/ENEMY_AI/volley.json";
import j_enemies_ENEMY_AI_flank from "./enemies/ENEMY_AI/flank.json";
import j_enemies_ENEMY_AI_timid from "./enemies/ENEMY_AI/timid.json";
import j_enemies_ENEMY_AI_deathBurst from "./enemies/ENEMY_AI/deathBurst.json";
import j_enemies_ENEMY_AI_rockfall from "./enemies/ENEMY_AI/rockfall.json";
import j_enemies_ENEMY_AI_kamikaze from "./enemies/ENEMY_AI/kamikaze.json";
import j_enemies_ENEMY_AI_echoStriker from "./enemies/ENEMY_AI/echoStriker.json";
import j_enemies_ENEMY_AI_packLeader from "./enemies/ENEMY_AI/packLeader.json";
import j_enemies_ENEMY_AI_conductor from "./enemies/ENEMY_AI/conductor.json";
import j_enemies_ENEMY_AI_manaLeech from "./enemies/ENEMY_AI/manaLeech.json";
import j_enemies_ENEMY_AI_corpse from "./enemies/ENEMY_AI/corpse.json";
import j_enemies_ENEMY_AI_scavenger from "./enemies/ENEMY_AI/scavenger.json";
import j_enemies_ENEMY_AI_graveBell from "./enemies/ENEMY_AI/graveBell.json";
import j_enemies_ENEMY_AI_silencer from "./enemies/ENEMY_AI/silencer.json";
import j_enemies_ENEMY_AI_frostCrusher from "./enemies/ENEMY_AI/frostCrusher.json";
import j_enemies_ENEMY_AI_twinShade from "./enemies/ENEMY_AI/twinShade.json";
import j_enemies_ENEMY_AI_mimic from "./enemies/ENEMY_AI/mimic.json";
import j_enemies_ENEMY_AI_hollowArmor from "./enemies/ENEMY_AI/hollowArmor.json";
import j_enemies_ENEMY_AI_terrainSeed from "./enemies/ENEMY_AI/terrainSeed.json";
import j_enemies_ENEMY_AI_lobber from "./enemies/ENEMY_AI/lobber.json";
import j_enemies_ENEMY_AI_oiler from "./enemies/ENEMY_AI/oiler.json";
import j_enemies_ENEMY_AI_bellImp from "./enemies/ENEMY_AI/bellImp.json";
import j_enemies_ENEMY_AI_banner from "./enemies/ENEMY_AI/banner.json";
import j_enemies_ENEMY_AI_charged from "./enemies/ENEMY_AI/charged.json";
import j_enemies_ENEMY_AI_burrower from "./enemies/ENEMY_AI/burrower.json";
import j_enemies_ENEMY_AI_dropper from "./enemies/ENEMY_AI/dropper.json";
import j_enemies_ENEMY_AI_absorber from "./enemies/ENEMY_AI/absorber.json";
import j_enemies_ENEMY_AI_homunculus from "./enemies/ENEMY_AI/homunculus.json";
import j_enemies_ENEMY_AI_scribeImp from "./enemies/ENEMY_AI/scribeImp.json";
import j_enemies_ENEMY_AI_crossGolem from "./enemies/ENEMY_AI/crossGolem.json";
import j_enemies_ENEMY_AI_windSprite from "./enemies/ENEMY_AI/windSprite.json";
import j_enemies_ENEMY_AI_mineLayer from "./enemies/ENEMY_AI/mineLayer.json";
import j_enemies_ENEMY_AI_mine from "./enemies/ENEMY_AI/mine.json";
import j_enemies_ENEMY_AI_chainWarden from "./enemies/ENEMY_AI/chainWarden.json";
import j_enemies_ENEMY_AI_hollow from "./enemies/ENEMY_AI/hollow.json";
import j_enemies_ENEMY_AI_flameEater from "./enemies/ENEMY_AI/flameEater.json";
import j_enemies_ENEMY_AI_spore from "./enemies/ENEMY_AI/spore.json";
import j_enemies_ENEMY_AI_swampWisp from "./enemies/ENEMY_AI/swampWisp.json";
import j_enemies_ENEMY_AI_iceTrail from "./enemies/ENEMY_AI/iceTrail.json";
import j_enemies_ENEMY_AI_giantToad from "./enemies/ENEMY_AI/giantToad.json";
import j_enemies_ENEMY_AI_forgeMaster from "./enemies/ENEMY_AI/forgeMaster.json";
import j_enemies_ENEMY_AI_turretMaster from "./enemies/ENEMY_AI/turretMaster.json";
import j_enemies_ENEMY_AI_turret from "./enemies/ENEMY_AI/turret.json";
import j_enemies_ENEMY_AI_basilisk from "./enemies/ENEMY_AI/basilisk.json";
import j_enemies_ENEMY_AI_shadowStalker from "./enemies/ENEMY_AI/shadowStalker.json";
import j_enemies_ENEMY_AI_leaper from "./enemies/ENEMY_AI/leaper.json";
import j_enemies_ENEMY_TEMPO from "./enemies/ENEMY_TEMPO.json";
import j_enemies_ELITE from "./enemies/ELITE.json";
import j_enemies_ELITE_GREEDY from "./enemies/ELITE_GREEDY.json";
import j_enemies_DOUBLE_CHARGE from "./enemies/DOUBLE_CHARGE.json";
import j_enemies_BOSS__index from "./enemies/BOSS/_index.json";
import j_enemies_BOSS_kingSlime from "./enemies/BOSS/kingSlime.json";
import j_enemies_BOSS_boneLord from "./enemies/BOSS/boneLord.json";
import j_enemies_BOSS_twinKnights from "./enemies/BOSS/twinKnights.json";
import j_enemies_BOSS_frostGiant from "./enemies/BOSS/frostGiant.json";
import j_enemies_BOSS_oilKing from "./enemies/BOSS/oilKing.json";
import j_enemies_BOSS_broodMother from "./enemies/BOSS/broodMother.json";
import j_enemies_BOSS_librarian from "./enemies/BOSS/librarian.json";
import j_enemies_BOSS_mirrorKnight from "./enemies/BOSS/mirrorKnight.json";
import j_enemies_BOSS_thiefKing from "./enemies/BOSS/thiefKing.json";
import j_enemies_FLOOR_LORD from "./enemies/FLOOR_LORD.json";
import j_enemies_JIN from "./enemies/JIN.json";
import j_enemies_FORMATION__index from "./enemies/FORMATION/_index.json";
import j_enemies_FORMATION_fishScale from "./enemies/FORMATION/fishScale.json";
import j_enemies_FORMATION_craneWing from "./enemies/FORMATION/craneWing.json";
import j_enemies_FORMATION_geese from "./enemies/FORMATION/geese.json";
import j_enemies_FORMATION_column from "./enemies/FORMATION/column.json";
import j_enemies_FORMATION_crescent from "./enemies/FORMATION/crescent.json";
import j_enemies_FORMATION_circle from "./enemies/FORMATION/circle.json";
import j_enemies_FORMATION_lookout from "./enemies/FORMATION/lookout.json";
import j_enemies_FORMATION_arrowhead from "./enemies/FORMATION/arrowhead.json";
import j_enemies_FORMATION_yoke from "./enemies/FORMATION/yoke.json";
import j_enemies_REAPER from "./enemies/REAPER.json";
import j_enemies_stats__index from "./enemies/stats/_index.json";
import j_enemies_stats_slime from "./enemies/stats/slime.json";
import j_enemies_stats_eye from "./enemies/stats/eye.json";
import j_enemies_stats_boar from "./enemies/stats/boar.json";
import j_enemies_stats_knight from "./enemies/stats/knight.json";
import j_enemies_stats_bomber from "./enemies/stats/bomber.json";
import j_enemies_stats_laserEye from "./enemies/stats/laserEye.json";
import j_enemies_stats_golem from "./enemies/stats/golem.json";
import j_enemies_stats_bat from "./enemies/stats/bat.json";
import j_enemies_stats_wisp from "./enemies/stats/wisp.json";
import j_enemies_stats_kingSlime from "./enemies/stats/kingSlime.json";
import j_enemies_stats_boneLord from "./enemies/stats/boneLord.json";
import j_enemies_stats_poisonSlime from "./enemies/stats/poisonSlime.json";
import j_enemies_stats_iceSlime from "./enemies/stats/iceSlime.json";
import j_enemies_stats_fireSlime from "./enemies/stats/fireSlime.json";
import j_enemies_stats_goldSlime from "./enemies/stats/goldSlime.json";
import j_enemies_stats_boneBoar from "./enemies/stats/boneBoar.json";
import j_enemies_stats_boarDouble from "./enemies/stats/boarDouble.json";
import j_enemies_stats_curseEye from "./enemies/stats/curseEye.json";
import j_enemies_stats_frostEye from "./enemies/stats/frostEye.json";
import j_enemies_stats_blackKnight from "./enemies/stats/blackKnight.json";
import j_enemies_stats_lavaGolem from "./enemies/stats/lavaGolem.json";
import j_enemies_stats_frostGolem from "./enemies/stats/frostGolem.json";
import j_enemies_stats_crystalGolem from "./enemies/stats/crystalGolem.json";
import j_enemies_stats_frostWisp from "./enemies/stats/frostWisp.json";
import j_enemies_stats_purpleLaser from "./enemies/stats/purpleLaser.json";
import j_enemies_stats_flyingBook from "./enemies/stats/flyingBook.json";
import j_enemies_stats_ashBat from "./enemies/stats/ashBat.json";
import j_enemies_stats_sproutSlime from "./enemies/stats/sproutSlime.json";
import j_enemies_stats_spikeRat from "./enemies/stats/spikeRat.json";
import j_enemies_stats_twinEye from "./enemies/stats/twinEye.json";
import j_enemies_stats_triLaser from "./enemies/stats/triLaser.json";
import j_enemies_stats_shadowBat from "./enemies/stats/shadowBat.json";
import j_enemies_stats_wolf from "./enemies/stats/wolf.json";
import j_enemies_stats_multiBomber from "./enemies/stats/multiBomber.json";
import j_enemies_stats_spearman from "./enemies/stats/spearman.json";
import j_enemies_stats_hornBeetle from "./enemies/stats/hornBeetle.json";
import j_enemies_stats_netter from "./enemies/stats/netter.json";
import j_enemies_stats_carrionFly from "./enemies/stats/carrionFly.json";
import j_enemies_stats_thunderWisp from "./enemies/stats/thunderWisp.json";
import j_enemies_stats_skeleton from "./enemies/stats/skeleton.json";
import j_enemies_stats_fuseRat from "./enemies/stats/fuseRat.json";
import j_enemies_stats_crystalMite from "./enemies/stats/crystalMite.json";
import j_enemies_stats_echoStriker from "./enemies/stats/echoStriker.json";
import j_enemies_stats_packLeader from "./enemies/stats/packLeader.json";
import j_enemies_stats_manaLeech from "./enemies/stats/manaLeech.json";
import j_enemies_stats_scavenger from "./enemies/stats/scavenger.json";
import j_enemies_stats_graveBell from "./enemies/stats/graveBell.json";
import j_enemies_stats_silencer from "./enemies/stats/silencer.json";
import j_enemies_stats_frostCrusher from "./enemies/stats/frostCrusher.json";
import j_enemies_stats_twinShade from "./enemies/stats/twinShade.json";
import j_enemies_stats_mimic from "./enemies/stats/mimic.json";
import j_enemies_stats_hollowArmor from "./enemies/stats/hollowArmor.json";
import j_enemies_stats_hollowWraith from "./enemies/stats/hollowWraith.json";
import j_enemies_stats_boneConductor from "./enemies/stats/boneConductor.json";
import j_enemies_stats_twinBrother from "./enemies/stats/twinBrother.json";
import j_enemies_stats_twinSister from "./enemies/stats/twinSister.json";
import j_enemies_stats_frostGiant from "./enemies/stats/frostGiant.json";
import j_enemies_stats_icePillar from "./enemies/stats/icePillar.json";
import j_enemies_stats_trainingDummy from "./enemies/stats/trainingDummy.json";
import j_enemies_stats_mirrorSelf from "./enemies/stats/mirrorSelf.json";
import j_enemies_stats_mudman from "./enemies/stats/mudman.json";
import j_enemies_stats_toad from "./enemies/stats/toad.json";
import j_enemies_stats_oiler from "./enemies/stats/oiler.json";
import j_enemies_stats_flameEater from "./enemies/stats/flameEater.json";
import j_enemies_stats_windSprite from "./enemies/stats/windSprite.json";
import j_enemies_stats_mineLayer from "./enemies/stats/mineLayer.json";
import j_enemies_stats_enemyMine from "./enemies/stats/enemyMine.json";
import j_enemies_stats_bellImp from "./enemies/stats/bellImp.json";
import j_enemies_stats_bannerBearer from "./enemies/stats/bannerBearer.json";
import j_enemies_stats_banner from "./enemies/stats/banner.json";
import j_enemies_stats_burrower from "./enemies/stats/burrower.json";
import j_enemies_stats_dropper from "./enemies/stats/dropper.json";
import j_enemies_stats_absorber from "./enemies/stats/absorber.json";
import j_enemies_stats_homunculus from "./enemies/stats/homunculus.json";
import j_enemies_stats_scribeImp from "./enemies/stats/scribeImp.json";
import j_enemies_stats_crossGolem from "./enemies/stats/crossGolem.json";
import j_enemies_stats_chainWarden from "./enemies/stats/chainWarden.json";
import j_enemies_stats_hollow from "./enemies/stats/hollow.json";
import j_enemies_stats_lurker from "./enemies/stats/lurker.json";
import j_enemies_stats_iceBoar from "./enemies/stats/iceBoar.json";
import j_enemies_stats_sootBomber from "./enemies/stats/sootBomber.json";
import j_enemies_stats_mossGolem from "./enemies/stats/mossGolem.json";
import j_enemies_stats_swampWisp from "./enemies/stats/swampWisp.json";
import j_enemies_stats_frostToad from "./enemies/stats/frostToad.json";
import j_enemies_stats_magmaToad from "./enemies/stats/magmaToad.json";
import j_enemies_stats_oilSlime from "./enemies/stats/oilSlime.json";
import j_enemies_stats_stormEye from "./enemies/stats/stormEye.json";
import j_enemies_stats_emberRat from "./enemies/stats/emberRat.json";
import j_enemies_stats_giantToad from "./enemies/stats/giantToad.json";
import j_enemies_stats_forgeMaster from "./enemies/stats/forgeMaster.json";
import j_enemies_stats_anvil from "./enemies/stats/anvil.json";
import j_enemies_stats_turretMaster from "./enemies/stats/turretMaster.json";
import j_enemies_stats_turret from "./enemies/stats/turret.json";
import j_enemies_stats_basilisk from "./enemies/stats/basilisk.json";
import j_enemies_stats_shadowStalker from "./enemies/stats/shadowStalker.json";
import j_enemies_stats_oilKing from "./enemies/stats/oilKing.json";
import j_enemies_stats_broodMother from "./enemies/stats/broodMother.json";
import j_enemies_stats_broodEgg from "./enemies/stats/broodEgg.json";
import j_enemies_stats_librarian from "./enemies/stats/librarian.json";
import j_enemies_stats_mirrorKnight from "./enemies/stats/mirrorKnight.json";
import j_enemies_stats_mirrorImage from "./enemies/stats/mirrorImage.json";
import j_enemies_stats_thiefKing from "./enemies/stats/thiefKing.json";
import j_enemies_stats_thief from "./enemies/stats/thief.json";
import j_enemies_stats_reaperShade from "./enemies/stats/reaperShade.json";
import j_enemies_stats_merchant from "./enemies/stats/merchant.json";
import j_enemies_stats_pot from "./enemies/stats/pot.json";
import j_enemies_stats_crate from "./enemies/stats/crate.json";
import j_enemies_combat__index from "./enemies/combat/_index.json";
import j_enemies_combat_slime from "./enemies/combat/slime.json";
import j_enemies_combat_eye from "./enemies/combat/eye.json";
import j_enemies_combat_boar from "./enemies/combat/boar.json";
import j_enemies_combat_knight from "./enemies/combat/knight.json";
import j_enemies_combat_bomber from "./enemies/combat/bomber.json";
import j_enemies_combat_laserEye from "./enemies/combat/laserEye.json";
import j_enemies_combat_golem from "./enemies/combat/golem.json";
import j_enemies_combat_bat from "./enemies/combat/bat.json";
import j_enemies_combat_wisp from "./enemies/combat/wisp.json";
import j_enemies_combat_kingSlime from "./enemies/combat/kingSlime.json";
import j_enemies_combat_boneLord from "./enemies/combat/boneLord.json";
import j_enemies_combat_poisonSlime from "./enemies/combat/poisonSlime.json";
import j_enemies_combat_iceSlime from "./enemies/combat/iceSlime.json";
import j_enemies_combat_fireSlime from "./enemies/combat/fireSlime.json";
import j_enemies_combat_goldSlime from "./enemies/combat/goldSlime.json";
import j_enemies_combat_boneBoar from "./enemies/combat/boneBoar.json";
import j_enemies_combat_boarDouble from "./enemies/combat/boarDouble.json";
import j_enemies_combat_curseEye from "./enemies/combat/curseEye.json";
import j_enemies_combat_frostEye from "./enemies/combat/frostEye.json";
import j_enemies_combat_blackKnight from "./enemies/combat/blackKnight.json";
import j_enemies_combat_lavaGolem from "./enemies/combat/lavaGolem.json";
import j_enemies_combat_frostGolem from "./enemies/combat/frostGolem.json";
import j_enemies_combat_crystalGolem from "./enemies/combat/crystalGolem.json";
import j_enemies_combat_frostWisp from "./enemies/combat/frostWisp.json";
import j_enemies_combat_purpleLaser from "./enemies/combat/purpleLaser.json";
import j_enemies_combat_flyingBook from "./enemies/combat/flyingBook.json";
import j_enemies_combat_ashBat from "./enemies/combat/ashBat.json";
import j_enemies_combat_sproutSlime from "./enemies/combat/sproutSlime.json";
import j_enemies_combat_spikeRat from "./enemies/combat/spikeRat.json";
import j_enemies_combat_twinEye from "./enemies/combat/twinEye.json";
import j_enemies_combat_triLaser from "./enemies/combat/triLaser.json";
import j_enemies_combat_shadowBat from "./enemies/combat/shadowBat.json";
import j_enemies_combat_wolf from "./enemies/combat/wolf.json";
import j_enemies_combat_multiBomber from "./enemies/combat/multiBomber.json";
import j_enemies_combat_spearman from "./enemies/combat/spearman.json";
import j_enemies_combat_hornBeetle from "./enemies/combat/hornBeetle.json";
import j_enemies_combat_netter from "./enemies/combat/netter.json";
import j_enemies_combat_carrionFly from "./enemies/combat/carrionFly.json";
import j_enemies_combat_thunderWisp from "./enemies/combat/thunderWisp.json";
import j_enemies_combat_skeleton from "./enemies/combat/skeleton.json";
import j_enemies_combat_fuseRat from "./enemies/combat/fuseRat.json";
import j_enemies_combat_crystalMite from "./enemies/combat/crystalMite.json";
import j_enemies_combat_echoStriker from "./enemies/combat/echoStriker.json";
import j_enemies_combat_packLeader from "./enemies/combat/packLeader.json";
import j_enemies_combat_manaLeech from "./enemies/combat/manaLeech.json";
import j_enemies_combat_scavenger from "./enemies/combat/scavenger.json";
import j_enemies_combat_graveBell from "./enemies/combat/graveBell.json";
import j_enemies_combat_silencer from "./enemies/combat/silencer.json";
import j_enemies_combat_frostCrusher from "./enemies/combat/frostCrusher.json";
import j_enemies_combat_twinShade from "./enemies/combat/twinShade.json";
import j_enemies_combat_mimic from "./enemies/combat/mimic.json";
import j_enemies_combat_hollowArmor from "./enemies/combat/hollowArmor.json";
import j_enemies_combat_hollowWraith from "./enemies/combat/hollowWraith.json";
import j_enemies_combat_boneConductor from "./enemies/combat/boneConductor.json";
import j_enemies_combat_twinBrother from "./enemies/combat/twinBrother.json";
import j_enemies_combat_twinSister from "./enemies/combat/twinSister.json";
import j_enemies_combat_frostGiant from "./enemies/combat/frostGiant.json";
import j_enemies_combat_icePillar from "./enemies/combat/icePillar.json";
import j_enemies_combat_trainingDummy from "./enemies/combat/trainingDummy.json";
import j_enemies_combat_mirrorSelf from "./enemies/combat/mirrorSelf.json";
import j_enemies_combat_mudman from "./enemies/combat/mudman.json";
import j_enemies_combat_toad from "./enemies/combat/toad.json";
import j_enemies_combat_oiler from "./enemies/combat/oiler.json";
import j_enemies_combat_flameEater from "./enemies/combat/flameEater.json";
import j_enemies_combat_windSprite from "./enemies/combat/windSprite.json";
import j_enemies_combat_mineLayer from "./enemies/combat/mineLayer.json";
import j_enemies_combat_enemyMine from "./enemies/combat/enemyMine.json";
import j_enemies_combat_bellImp from "./enemies/combat/bellImp.json";
import j_enemies_combat_bannerBearer from "./enemies/combat/bannerBearer.json";
import j_enemies_combat_banner from "./enemies/combat/banner.json";
import j_enemies_combat_burrower from "./enemies/combat/burrower.json";
import j_enemies_combat_dropper from "./enemies/combat/dropper.json";
import j_enemies_combat_absorber from "./enemies/combat/absorber.json";
import j_enemies_combat_homunculus from "./enemies/combat/homunculus.json";
import j_enemies_combat_scribeImp from "./enemies/combat/scribeImp.json";
import j_enemies_combat_crossGolem from "./enemies/combat/crossGolem.json";
import j_enemies_combat_chainWarden from "./enemies/combat/chainWarden.json";
import j_enemies_combat_hollow from "./enemies/combat/hollow.json";
import j_enemies_combat_lurker from "./enemies/combat/lurker.json";
import j_enemies_combat_iceBoar from "./enemies/combat/iceBoar.json";
import j_enemies_combat_sootBomber from "./enemies/combat/sootBomber.json";
import j_enemies_combat_mossGolem from "./enemies/combat/mossGolem.json";
import j_enemies_combat_swampWisp from "./enemies/combat/swampWisp.json";
import j_enemies_combat_frostToad from "./enemies/combat/frostToad.json";
import j_enemies_combat_magmaToad from "./enemies/combat/magmaToad.json";
import j_enemies_combat_oilSlime from "./enemies/combat/oilSlime.json";
import j_enemies_combat_stormEye from "./enemies/combat/stormEye.json";
import j_enemies_combat_emberRat from "./enemies/combat/emberRat.json";
import j_enemies_combat_giantToad from "./enemies/combat/giantToad.json";
import j_enemies_combat_forgeMaster from "./enemies/combat/forgeMaster.json";
import j_enemies_combat_anvil from "./enemies/combat/anvil.json";
import j_enemies_combat_turretMaster from "./enemies/combat/turretMaster.json";
import j_enemies_combat_turret from "./enemies/combat/turret.json";
import j_enemies_combat_basilisk from "./enemies/combat/basilisk.json";
import j_enemies_combat_shadowStalker from "./enemies/combat/shadowStalker.json";
import j_enemies_combat_oilKing from "./enemies/combat/oilKing.json";
import j_enemies_combat_broodMother from "./enemies/combat/broodMother.json";
import j_enemies_combat_broodEgg from "./enemies/combat/broodEgg.json";
import j_enemies_combat_librarian from "./enemies/combat/librarian.json";
import j_enemies_combat_mirrorKnight from "./enemies/combat/mirrorKnight.json";
import j_enemies_combat_thiefKing from "./enemies/combat/thiefKing.json";
import j_enemies_combat_thief from "./enemies/combat/thief.json";
import j_enemies_combat_mirrorImage from "./enemies/combat/mirrorImage.json";
import j_enemies_combat_reaperShade from "./enemies/combat/reaperShade.json";
import j_enemies_combat_merchant from "./enemies/combat/merchant.json";
import j_enemies_combat_pot from "./enemies/combat/pot.json";
import j_enemies_combat_crate from "./enemies/combat/crate.json";
import j_enemies_defense__index from "./enemies/defense/_index.json";
import j_enemies_defense_bodies from "./enemies/defense/bodies.json";
import j_enemies_defense_biomes from "./enemies/defense/biomes.json";
import j_enemies_defense_enemies_slime from "./enemies/defense/enemies/slime.json";
import j_enemies_defense_enemies_eye from "./enemies/defense/enemies/eye.json";
import j_enemies_defense_enemies_boar from "./enemies/defense/enemies/boar.json";
import j_enemies_defense_enemies_knight from "./enemies/defense/enemies/knight.json";
import j_enemies_defense_enemies_bomber from "./enemies/defense/enemies/bomber.json";
import j_enemies_defense_enemies_laserEye from "./enemies/defense/enemies/laserEye.json";
import j_enemies_defense_enemies_golem from "./enemies/defense/enemies/golem.json";
import j_enemies_defense_enemies_bat from "./enemies/defense/enemies/bat.json";
import j_enemies_defense_enemies_wisp from "./enemies/defense/enemies/wisp.json";
import j_enemies_defense_enemies_kingSlime from "./enemies/defense/enemies/kingSlime.json";
import j_enemies_defense_enemies_boneLord from "./enemies/defense/enemies/boneLord.json";
import j_enemies_defense_enemies_poisonSlime from "./enemies/defense/enemies/poisonSlime.json";
import j_enemies_defense_enemies_iceSlime from "./enemies/defense/enemies/iceSlime.json";
import j_enemies_defense_enemies_fireSlime from "./enemies/defense/enemies/fireSlime.json";
import j_enemies_defense_enemies_goldSlime from "./enemies/defense/enemies/goldSlime.json";
import j_enemies_defense_enemies_boneBoar from "./enemies/defense/enemies/boneBoar.json";
import j_enemies_defense_enemies_boarDouble from "./enemies/defense/enemies/boarDouble.json";
import j_enemies_defense_enemies_curseEye from "./enemies/defense/enemies/curseEye.json";
import j_enemies_defense_enemies_frostEye from "./enemies/defense/enemies/frostEye.json";
import j_enemies_defense_enemies_blackKnight from "./enemies/defense/enemies/blackKnight.json";
import j_enemies_defense_enemies_lavaGolem from "./enemies/defense/enemies/lavaGolem.json";
import j_enemies_defense_enemies_frostGolem from "./enemies/defense/enemies/frostGolem.json";
import j_enemies_defense_enemies_crystalGolem from "./enemies/defense/enemies/crystalGolem.json";
import j_enemies_defense_enemies_frostWisp from "./enemies/defense/enemies/frostWisp.json";
import j_enemies_defense_enemies_purpleLaser from "./enemies/defense/enemies/purpleLaser.json";
import j_enemies_defense_enemies_flyingBook from "./enemies/defense/enemies/flyingBook.json";
import j_enemies_defense_enemies_ashBat from "./enemies/defense/enemies/ashBat.json";
import j_enemies_defense_enemies_sproutSlime from "./enemies/defense/enemies/sproutSlime.json";
import j_enemies_defense_enemies_spikeRat from "./enemies/defense/enemies/spikeRat.json";
import j_enemies_defense_enemies_twinEye from "./enemies/defense/enemies/twinEye.json";
import j_enemies_defense_enemies_triLaser from "./enemies/defense/enemies/triLaser.json";
import j_enemies_defense_enemies_shadowBat from "./enemies/defense/enemies/shadowBat.json";
import j_enemies_defense_enemies_wolf from "./enemies/defense/enemies/wolf.json";
import j_enemies_defense_enemies_multiBomber from "./enemies/defense/enemies/multiBomber.json";
import j_enemies_defense_enemies_spearman from "./enemies/defense/enemies/spearman.json";
import j_enemies_defense_enemies_hornBeetle from "./enemies/defense/enemies/hornBeetle.json";
import j_enemies_defense_enemies_netter from "./enemies/defense/enemies/netter.json";
import j_enemies_defense_enemies_carrionFly from "./enemies/defense/enemies/carrionFly.json";
import j_enemies_defense_enemies_thunderWisp from "./enemies/defense/enemies/thunderWisp.json";
import j_enemies_defense_enemies_skeleton from "./enemies/defense/enemies/skeleton.json";
import j_enemies_defense_enemies_fuseRat from "./enemies/defense/enemies/fuseRat.json";
import j_enemies_defense_enemies_crystalMite from "./enemies/defense/enemies/crystalMite.json";
import j_enemies_defense_enemies_echoStriker from "./enemies/defense/enemies/echoStriker.json";
import j_enemies_defense_enemies_packLeader from "./enemies/defense/enemies/packLeader.json";
import j_enemies_defense_enemies_manaLeech from "./enemies/defense/enemies/manaLeech.json";
import j_enemies_defense_enemies_scavenger from "./enemies/defense/enemies/scavenger.json";
import j_enemies_defense_enemies_graveBell from "./enemies/defense/enemies/graveBell.json";
import j_enemies_defense_enemies_silencer from "./enemies/defense/enemies/silencer.json";
import j_enemies_defense_enemies_frostCrusher from "./enemies/defense/enemies/frostCrusher.json";
import j_enemies_defense_enemies_twinShade from "./enemies/defense/enemies/twinShade.json";
import j_enemies_defense_enemies_mimic from "./enemies/defense/enemies/mimic.json";
import j_enemies_defense_enemies_hollowArmor from "./enemies/defense/enemies/hollowArmor.json";
import j_enemies_defense_enemies_hollowWraith from "./enemies/defense/enemies/hollowWraith.json";
import j_enemies_defense_enemies_boneConductor from "./enemies/defense/enemies/boneConductor.json";
import j_enemies_defense_enemies_twinBrother from "./enemies/defense/enemies/twinBrother.json";
import j_enemies_defense_enemies_twinSister from "./enemies/defense/enemies/twinSister.json";
import j_enemies_defense_enemies_frostGiant from "./enemies/defense/enemies/frostGiant.json";
import j_enemies_defense_enemies_icePillar from "./enemies/defense/enemies/icePillar.json";
import j_enemies_defense_enemies_trainingDummy from "./enemies/defense/enemies/trainingDummy.json";
import j_enemies_defense_enemies_mirrorSelf from "./enemies/defense/enemies/mirrorSelf.json";
import j_enemies_defense_enemies_mudman from "./enemies/defense/enemies/mudman.json";
import j_enemies_defense_enemies_toad from "./enemies/defense/enemies/toad.json";
import j_enemies_defense_enemies_oiler from "./enemies/defense/enemies/oiler.json";
import j_enemies_defense_enemies_flameEater from "./enemies/defense/enemies/flameEater.json";
import j_enemies_defense_enemies_windSprite from "./enemies/defense/enemies/windSprite.json";
import j_enemies_defense_enemies_mineLayer from "./enemies/defense/enemies/mineLayer.json";
import j_enemies_defense_enemies_enemyMine from "./enemies/defense/enemies/enemyMine.json";
import j_enemies_defense_enemies_bellImp from "./enemies/defense/enemies/bellImp.json";
import j_enemies_defense_enemies_bannerBearer from "./enemies/defense/enemies/bannerBearer.json";
import j_enemies_defense_enemies_banner from "./enemies/defense/enemies/banner.json";
import j_enemies_defense_enemies_burrower from "./enemies/defense/enemies/burrower.json";
import j_enemies_defense_enemies_dropper from "./enemies/defense/enemies/dropper.json";
import j_enemies_defense_enemies_absorber from "./enemies/defense/enemies/absorber.json";
import j_enemies_defense_enemies_homunculus from "./enemies/defense/enemies/homunculus.json";
import j_enemies_defense_enemies_scribeImp from "./enemies/defense/enemies/scribeImp.json";
import j_enemies_defense_enemies_crossGolem from "./enemies/defense/enemies/crossGolem.json";
import j_enemies_defense_enemies_chainWarden from "./enemies/defense/enemies/chainWarden.json";
import j_enemies_defense_enemies_hollow from "./enemies/defense/enemies/hollow.json";
import j_enemies_defense_enemies_lurker from "./enemies/defense/enemies/lurker.json";
import j_enemies_defense_enemies_iceBoar from "./enemies/defense/enemies/iceBoar.json";
import j_enemies_defense_enemies_sootBomber from "./enemies/defense/enemies/sootBomber.json";
import j_enemies_defense_enemies_mossGolem from "./enemies/defense/enemies/mossGolem.json";
import j_enemies_defense_enemies_swampWisp from "./enemies/defense/enemies/swampWisp.json";
import j_enemies_defense_enemies_frostToad from "./enemies/defense/enemies/frostToad.json";
import j_enemies_defense_enemies_magmaToad from "./enemies/defense/enemies/magmaToad.json";
import j_enemies_defense_enemies_oilSlime from "./enemies/defense/enemies/oilSlime.json";
import j_enemies_defense_enemies_stormEye from "./enemies/defense/enemies/stormEye.json";
import j_enemies_defense_enemies_emberRat from "./enemies/defense/enemies/emberRat.json";
import j_enemies_defense_enemies_giantToad from "./enemies/defense/enemies/giantToad.json";
import j_enemies_defense_enemies_forgeMaster from "./enemies/defense/enemies/forgeMaster.json";
import j_enemies_defense_enemies_anvil from "./enemies/defense/enemies/anvil.json";
import j_enemies_defense_enemies_turretMaster from "./enemies/defense/enemies/turretMaster.json";
import j_enemies_defense_enemies_turret from "./enemies/defense/enemies/turret.json";
import j_enemies_defense_enemies_basilisk from "./enemies/defense/enemies/basilisk.json";
import j_enemies_defense_enemies_shadowStalker from "./enemies/defense/enemies/shadowStalker.json";
import j_enemies_defense_enemies_oilKing from "./enemies/defense/enemies/oilKing.json";
import j_enemies_defense_enemies_broodMother from "./enemies/defense/enemies/broodMother.json";
import j_enemies_defense_enemies_broodEgg from "./enemies/defense/enemies/broodEgg.json";
import j_enemies_defense_enemies_librarian from "./enemies/defense/enemies/librarian.json";
import j_enemies_defense_enemies_mirrorKnight from "./enemies/defense/enemies/mirrorKnight.json";
import j_enemies_defense_enemies_thiefKing from "./enemies/defense/enemies/thiefKing.json";
import j_enemies_defense_enemies_thief from "./enemies/defense/enemies/thief.json";
import j_enemies_defense_enemies_mirrorImage from "./enemies/defense/enemies/mirrorImage.json";
import j_enemies_defense_enemies_reaperShade from "./enemies/defense/enemies/reaperShade.json";
import j_enemies_defense_enemies_merchant from "./enemies/defense/enemies/merchant.json";
import j_enemies_defense_enemies_pot from "./enemies/defense/enemies/pot.json";
import j_enemies_defense_enemies_crate from "./enemies/defense/enemies/crate.json";
import j_enemies_ENEMY_SCALE from "./enemies/ENEMY_SCALE.json";
import j_enemies_REACTION from "./enemies/REACTION.json";
import j_feel__index from "./feel/_index.json";
import j_feel_FEEL from "./feel/FEEL.json";
import j_feel_EFFECTS__index from "./feel/EFFECTS/_index.json";
import j_feel_EFFECTS_death from "./feel/EFFECTS/death.json";
import j_feel_EFFECTS_hitSpark from "./feel/EFFECTS/hitSpark.json";
import j_feel_EFFECTS_comboTiers from "./feel/EFFECTS/comboTiers.json";
import j_feel_EFFECTS_comboMilestones from "./feel/EFFECTS/comboMilestones.json";
import j_feel_EFFECTS_clearWave from "./feel/EFFECTS/clearWave.json";
import j_feel_EFFECTS_eliteBurst from "./feel/EFFECTS/eliteBurst.json";
import j_feel_EFFECTS_bossLight from "./feel/EFFECTS/bossLight.json";
import j_feel_EFFECTS_justRing from "./feel/EFFECTS/justRing.json";
import j_feel_EFFECTS_synergyGlow from "./feel/EFFECTS/synergyGlow.json";
import j_feel_EFFECTS_weakCrack from "./feel/EFFECTS/weakCrack.json";
import j_feel_EFFECTS_critFlash from "./feel/EFFECTS/critFlash.json";
import j_feel_EFFECTS_doorSlam from "./feel/EFFECTS/doorSlam.json";
import j_feel_EFFECTS_chargeUp from "./feel/EFFECTS/chargeUp.json";
import j_feel_EFFECTS_dropBeam from "./feel/EFFECTS/dropBeam.json";
import j_feel_EFFECTS_dashGhost from "./feel/EFFECTS/dashGhost.json";
import j_feel_EFFECTS_floorCard from "./feel/EFFECTS/floorCard.json";
import j_feel_MINIMAP from "./feel/MINIMAP.json";
import j_feel_FX_ATTACK__index from "./feel/FX_ATTACK/_index.json";
import j_feel_FX_ATTACK_slash from "./feel/FX_ATTACK/slash.json";
import j_feel_FX_ATTACK_hitSpark from "./feel/FX_ATTACK/hitSpark.json";
import j_feel_FX_ATTACK_impact from "./feel/FX_ATTACK/impact.json";
import j_feel_FX_ATTACK_muzzle from "./feel/FX_ATTACK/muzzle.json";
import j_feel_FX_ATTACK_bullet from "./feel/FX_ATTACK/bullet.json";
import j_feel_FX_ATTACK_blast from "./feel/FX_ATTACK/blast.json";
import j_feel_FX_ATTACK_ring from "./feel/FX_ATTACK/ring.json";
import j_feel_FX_ATTACK_bolt from "./feel/FX_ATTACK/bolt.json";
import j_feel_FX_ATTACK_particle from "./feel/FX_ATTACK/particle.json";
import j_feel_FX_ATTACK_sprite from "./feel/FX_ATTACK/sprite.json";
import j_feel_MUSIC from "./feel/MUSIC.json";
import j_feel_FX_WAVE3 from "./feel/FX_WAVE3.json";
import j_feel_SFX_WAVE3 from "./feel/SFX_WAVE3.json";
import j_feel_TELEGRAPH from "./feel/TELEGRAPH.json";
import j_jobs__index from "./jobs/_index.json";
import j_jobs_JOB from "./jobs/JOB.json";
import j_jobs_attributes from "./jobs/attributes.json";
import j_jobs_DASH_FORM from "./jobs/DASH_FORM.json";
import j_jobs_MANA_SOURCE from "./jobs/MANA_SOURCE.json";
import j_loot__index from "./loot/_index.json";
import j_loot_LOOT_DROP from "./loot/LOOT_DROP.json";
import j_loot_PICKUP from "./loot/PICKUP.json";
import j_loot_RESONANCE from "./loot/RESONANCE.json";
import j_loot_KEYSTONE from "./loot/KEYSTONE.json";
import j_loot_RELIC from "./loot/RELIC.json";
import j_loot_TRIGGER from "./loot/TRIGGER.json";
import j_loot_SYNERGY from "./loot/SYNERGY.json";
import j_loot_FLUX from "./loot/FLUX.json";
import j_loot_affixCurves_damageVsStaggered from "./loot/affixCurves/damageVsStaggered.json";
import j_loot_affixCurves_armorFlat from "./loot/affixCurves/armorFlat.json";
import j_loot_affixCurves_comboDamage from "./loot/affixCurves/comboDamage.json";
import j_loot_affixCurves_justDodgeDamage from "./loot/affixCurves/justDodgeDamage.json";
import j_loot_affixCurves_burn from "./loot/affixCurves/burn.json";
import j_loot_affixCurves_chill from "./loot/affixCurves/chill.json";
import j_loot_affixCurves_shock from "./loot/affixCurves/shock.json";
import j_loot_affixCurves_explodeOnKill from "./loot/affixCurves/explodeOnKill.json";
import j_loot_affixCurves_energyReserve from "./loot/affixCurves/energyReserve.json";
import j_loot_affixCurves_procBleed from "./loot/affixCurves/procBleed.json";
import j_loot_affixCurves_procPoison from "./loot/affixCurves/procPoison.json";
import j_loot_affixCurves_procFear from "./loot/affixCurves/procFear.json";
import j_loot_affixCurves_bulletCut from "./loot/affixCurves/bulletCut.json";
import j_loot_affixCurves_manaOnStagger from "./loot/affixCurves/manaOnStagger.json";
import j_loot_affixCurves_fullTide from "./loot/affixCurves/fullTide.json";
import j_loot_affixCurves_manaShield from "./loot/affixCurves/manaShield.json";
import j_loot_affixCurves_manaOverflow from "./loot/affixCurves/manaOverflow.json";
import j_loot_affixCurves_justBreath from "./loot/affixCurves/justBreath.json";
import j_loot_affixCurves_kaleidoscope from "./loot/affixCurves/kaleidoscope.json";
import j_loot_affixCurves_fever from "./loot/affixCurves/fever.json";
import j_loot_affixCurves_plagueSeed from "./loot/affixCurves/plagueSeed.json";
import j_loot_affixCurves_rotBurst from "./loot/affixCurves/rotBurst.json";
import j_loot_affixCurves_wedge from "./loot/affixCurves/wedge.json";
import j_loot_affixCurves_guardPiercer from "./loot/affixCurves/guardPiercer.json";
import j_loot_affixCurves_staggerQuake from "./loot/affixCurves/staggerQuake.json";
import j_loot_affixCurves_staggerSpark from "./loot/affixCurves/staggerSpark.json";
import j_loot_affixCurves_staggerMark from "./loot/affixCurves/staggerMark.json";
import j_loot_affixCurves_readAhead from "./loot/affixCurves/readAhead.json";
import j_loot_affixCurves_counterWave from "./loot/affixCurves/counterWave.json";
import j_loot_affixCurves_guardedBane from "./loot/affixCurves/guardedBane.json";
import j_loot_affixCurves_downHunter from "./loot/affixCurves/downHunter.json";
import j_loot_affixCurves_lockdownFury from "./loot/affixCurves/lockdownFury.json";
import j_loot_affixCurves_sapling from "./loot/affixCurves/sapling.json";
import j_loot_affixCurves_oldScars from "./loot/affixCurves/oldScars.json";
import j_loot_affixCurves_veteran from "./loot/affixCurves/veteran.json";
import j_loot_affixCurves_echoSlash from "./loot/affixCurves/echoSlash.json";
import j_loot_affixCurves_inheritance from "./loot/affixCurves/inheritance.json";
import j_loot_affixCurves_stake from "./loot/affixCurves/stake.json";
import j_loot_affixCurves_placedInfuse from "./loot/affixCurves/placedInfuse.json";
import j_loot_affixCurves_bloodSignature from "./loot/affixCurves/bloodSignature.json";
import j_loot_affixCurves_firstMove from "./loot/affixCurves/firstMove.json";
import j_loot_affixCurves_curtainCall from "./loot/affixCurves/curtainCall.json";
import j_loot_affixCurves_prismEdge from "./loot/affixCurves/prismEdge.json";
import j_loot_affixCurves_backlash from "./loot/affixCurves/backlash.json";
import j_loot_affixCurves_conductor from "./loot/affixCurves/conductor.json";
import j_loot_affixCurves_elementalBreak from "./loot/affixCurves/elementalBreak.json";
import j_loot_affixCurves_chargeCore from "./loot/affixCurves/chargeCore.json";
import j_loot_affixCurves_branchArt from "./loot/affixCurves/branchArt.json";
import j_loot_affixCurves_rapidBrand from "./loot/affixCurves/rapidBrand.json";
import j_loot_affixCurves_brandDetonator from "./loot/affixCurves/brandDetonator.json";
import j_loot_affixCurves_groundRooted from "./loot/affixCurves/groundRooted.json";
import j_loot_affixCurves_terrainHunter from "./loot/affixCurves/terrainHunter.json";
import j_loot_affixCurves_terrainBurst from "./loot/affixCurves/terrainBurst.json";
import j_loot_affixCurves_emberTrail from "./loot/affixCurves/emberTrail.json";
import j_loot_affixCurves_frostTrail from "./loot/affixCurves/frostTrail.json";
import j_loot_affixCurves_groundMend from "./loot/affixCurves/groundMend.json";
import j_loot_affixCurves_siegeGuard from "./loot/affixCurves/siegeGuard.json";
import j_loot_affixCurves_switchBreath from "./loot/affixCurves/switchBreath.json";
import j_loot_affixCurves_cv_chargesToDistance from "./loot/affixCurves/cv_chargesToDistance.json";
import j_loot_affixCurves_cv_projectilesToPoise from "./loot/affixCurves/cv_projectilesToPoise.json";
import j_loot_affixCurves_attr_str from "./loot/affixCurves/attr_str.json";
import j_loot_affixCurves_attr_dex from "./loot/affixCurves/attr_dex.json";
import j_loot_affixCurves_attr_vit from "./loot/affixCurves/attr_vit.json";
import j_loot_affixCurves_attr_mnd from "./loot/affixCurves/attr_mnd.json";
import j_loot_affixCurves_attr_spi from "./loot/affixCurves/attr_spi.json";
import j_loot_affixCurves_res_fire from "./loot/affixCurves/res_fire.json";
import j_loot_affixCurves_res_ice from "./loot/affixCurves/res_ice.json";
import j_loot_affixCurves_res_lightning from "./loot/affixCurves/res_lightning.json";
import j_loot_affixCurves_res_poison from "./loot/affixCurves/res_poison.json";
import j_loot_affixCurves_res_dark from "./loot/affixCurves/res_dark.json";
import j_loot_affixCurves_res_light from "./loot/affixCurves/res_light.json";
import j_loot_affixCurves_cv_infuseFire from "./loot/affixCurves/cv_infuseFire.json";
import j_loot_affixCurves_cv_infuseIce from "./loot/affixCurves/cv_infuseIce.json";
import j_loot_affixCurves_cv_infuseLightning from "./loot/affixCurves/cv_infuseLightning.json";
import j_loot_affixCurves_cv_infusePoison from "./loot/affixCurves/cv_infusePoison.json";
import j_loot_affixCurves_cv_infuseDark from "./loot/affixCurves/cv_infuseDark.json";
import j_loot_affixCurves_cv_infuseLight from "./loot/affixCurves/cv_infuseLight.json";
import j_loot_affixCurves_attr_def from "./loot/affixCurves/attr_def.json";
import j_loot_affixCurves_purse from "./loot/affixCurves/purse.json";
import j_loot_affixCurves_desperation from "./loot/affixCurves/desperation.json";
import j_loot_affixCurves_moraleSurge from "./loot/affixCurves/moraleSurge.json";
import j_loot_affixCurves_finisherEdge from "./loot/affixCurves/finisherEdge.json";
import j_loot_affixCurves_releaseEdge from "./loot/affixCurves/releaseEdge.json";
import j_loot_affixCurves_riposteEdge from "./loot/affixCurves/riposteEdge.json";
import j_loot_affixCurves_twinEdge from "./loot/affixCurves/twinEdge.json";
import j_loot_affixCurves_firstStrikeEdge from "./loot/affixCurves/firstStrikeEdge.json";
import j_loot_affixCurves_stanceGuard from "./loot/affixCurves/stanceGuard.json";
import j_loot_affixCurves_unmoving from "./loot/affixCurves/unmoving.json";
import j_loot_affixCurves_chainSource from "./loot/affixCurves/chainSource.json";
import j_loot_affixCurves_chainReturn from "./loot/affixCurves/chainReturn.json";
import j_loot_affixCurves_moraleCap from "./loot/affixCurves/moraleCap.json";
import j_loot_affixCurves_burnStack from "./loot/affixCurves/burnStack.json";
import j_loot_affixCurves_cv_critToChain from "./loot/affixCurves/cv_critToChain.json";
import j_loot_affixCurves_cv_speedToDamage from "./loot/affixCurves/cv_speedToDamage.json";
import j_loot_affixCurves_cv_manaToProjectiles from "./loot/affixCurves/cv_manaToProjectiles.json";
import j_loot_affixCurves_cv_armorToPoise from "./loot/affixCurves/cv_armorToPoise.json";
import j_loot_affixCurves_cv_lifeToArea from "./loot/affixCurves/cv_lifeToArea.json";
import j_loot_affixCurves_cv_comboToFinisher from "./loot/affixCurves/cv_comboToFinisher.json";
import j_loot_affixCurves_cv_coinsToMore from "./loot/affixCurves/cv_coinsToMore.json";
import j_loot_affixCurves_cv_critToLightning from "./loot/affixCurves/cv_critToLightning.json";
import j_loot_affixCurves_cv_critToCoins from "./loot/affixCurves/cv_critToCoins.json";
import j_loot_affixCurves_cv_critToMorale from "./loot/affixCurves/cv_critToMorale.json";
import j_loot_bases from "./loot/bases.json";
import j_loot_INNATE__index from "./loot/INNATE/_index.json";
import j_loot_INNATE_budget from "./loot/INNATE/budget.json";
import j_loot_INNATE_depthScale from "./loot/INNATE/depthScale.json";
import j_loot_INNATE_maxLines from "./loot/INNATE/maxLines.json";
import j_loot_INNATE_pointValue from "./loot/INNATE/pointValue.json";
import j_loot_INNATE_armor from "./loot/INNATE/armor.json";
import j_loot_INNATE_resistLines from "./loot/INNATE/resistLines.json";
import j_loot_INNATE_slotLean from "./loot/INNATE/slotLean.json";
import j_skills__index from "./skills/_index.json";
import j_skills_SKILL__index from "./skills/SKILL/_index.json";
import j_skills_SKILL_whirl from "./skills/SKILL/whirl.json";
import j_skills_SKILL_lunge from "./skills/SKILL/lunge.json";
import j_skills_SKILL_frag from "./skills/SKILL/frag.json";
import j_skills_SKILL_railshot from "./skills/SKILL/railshot.json";
import j_skills_SKILL_parry from "./skills/SKILL/parry.json";
import j_skills_SKILL_bloodPact from "./skills/SKILL/bloodPact.json";
import j_skills_SKILL_quake from "./skills/SKILL/quake.json";
import j_skills_SKILL_thunder from "./skills/SKILL/thunder.json";
import j_skills_SKILL_gravityWell from "./skills/SKILL/gravityWell.json";
import j_skills_SKILL_mines from "./skills/SKILL/mines.json";
import j_skills_SKILL_haste from "./skills/SKILL/haste.json";
import j_skills_SKILL_chainHook from "./skills/SKILL/chainHook.json";
import j_skills_SKILL_spiral from "./skills/SKILL/spiral.json";
import j_skills_SKILL_frostField from "./skills/SKILL/frostField.json";
import j_skills_SKILL_modifier from "./skills/SKILL/modifier.json";
import j_skills_SKILL_drop from "./skills/SKILL/drop.json";
import j_skills_EXTRA_SKILL_TUNING__index from "./skills/EXTRA_SKILL_TUNING/_index.json";
import j_skills_EXTRA_SKILL_TUNING_contagion from "./skills/EXTRA_SKILL_TUNING/contagion.json";
import j_skills_EXTRA_SKILL_TUNING_unravel from "./skills/EXTRA_SKILL_TUNING/unravel.json";
import j_skills_EXTRA_SKILL_TUNING_kindle from "./skills/EXTRA_SKILL_TUNING/kindle.json";
import j_skills_EXTRA_SKILL_TUNING_prismShard from "./skills/EXTRA_SKILL_TUNING/prismShard.json";
import j_skills_EXTRA_SKILL_TUNING_fullMoon from "./skills/EXTRA_SKILL_TUNING/fullMoon.json";
import j_skills_EXTRA_SKILL_TUNING_dregsBlade from "./skills/EXTRA_SKILL_TUNING/dregsBlade.json";
import j_skills_EXTRA_SKILL_TUNING_shadowStep from "./skills/EXTRA_SKILL_TUNING/shadowStep.json";
import j_skills_EXTRA_SKILL_TUNING_powderKeg from "./skills/EXTRA_SKILL_TUNING/powderKeg.json";
import j_skills_EXTRA_SKILL_TUNING_swordGrave from "./skills/EXTRA_SKILL_TUNING/swordGrave.json";
import j_skills_EXTRA_SKILL_TUNING_iceBreaker from "./skills/EXTRA_SKILL_TUNING/iceBreaker.json";
import j_skills_EXTRA_SKILL_TUNING_bloodlet from "./skills/EXTRA_SKILL_TUNING/bloodlet.json";
import j_skills_EXTRA_SKILL_TUNING_harvest from "./skills/EXTRA_SKILL_TUNING/harvest.json";
import j_skills_EXTRA_SKILL_TUNING_discharge from "./skills/EXTRA_SKILL_TUNING/discharge.json";
import j_skills_EXTRA_SKILL_TUNING_rout from "./skills/EXTRA_SKILL_TUNING/rout.json";
import j_skills_EXTRA_SKILL_TUNING_verdict from "./skills/EXTRA_SKILL_TUNING/verdict.json";
import j_skills_EXTRA_SKILL_TUNING_exploit from "./skills/EXTRA_SKILL_TUNING/exploit.json";
import j_skills_EXTRA_SKILL_TUNING_strip from "./skills/EXTRA_SKILL_TUNING/strip.json";
import j_skills_EXTRA_SKILL_TUNING_lastStand from "./skills/EXTRA_SKILL_TUNING/lastStand.json";
import j_skills_EXTRA_SKILL_TUNING_comboChain from "./skills/EXTRA_SKILL_TUNING/comboChain.json";
import j_skills_EXTRA_SKILL_TUNING_grudge from "./skills/EXTRA_SKILL_TUNING/grudge.json";
import j_skills_EXTRA_SKILL_TUNING_guillotine from "./skills/EXTRA_SKILL_TUNING/guillotine.json";
import j_skills_EXTRA_SKILL_TUNING_ricochet from "./skills/EXTRA_SKILL_TUNING/ricochet.json";
import j_skills_EXTRA_SKILL_TUNING_galeSlash from "./skills/EXTRA_SKILL_TUNING/galeSlash.json";
import j_skills_EXTRA_SKILL_TUNING_scatterSigil from "./skills/EXTRA_SKILL_TUNING/scatterSigil.json";
import j_skills_EXTRA_SKILL_TUNING_stomp from "./skills/EXTRA_SKILL_TUNING/stomp.json";
import j_skills_EXTRA_SKILL_TUNING_threadReel from "./skills/EXTRA_SKILL_TUNING/threadReel.json";
import j_skills_EXTRA_SKILL_TUNING_meteorDive from "./skills/EXTRA_SKILL_TUNING/meteorDive.json";
import j_skills_EXTRA_SKILL_TUNING_swallowFlip from "./skills/EXTRA_SKILL_TUNING/swallowFlip.json";
import j_skills_EXTRA_SKILL_TUNING_boneRing from "./skills/EXTRA_SKILL_TUNING/boneRing.json";
import j_skills_EXTRA_SKILL_TUNING_backflow from "./skills/EXTRA_SKILL_TUNING/backflow.json";
import j_skills_EXTRA_SKILL_TUNING_scarRoar from "./skills/EXTRA_SKILL_TUNING/scarRoar.json";
import j_skills_EXTRA_SKILL_TUNING_manaSpring from "./skills/EXTRA_SKILL_TUNING/manaSpring.json";
import j_skills_EXTRA_SKILL_TUNING_turret from "./skills/EXTRA_SKILL_TUNING/turret.json";
import j_skills_EXTRA_MODIFIER_TUNING from "./skills/EXTRA_MODIFIER_TUNING.json";
import j_skills_COMBO_TUNING from "./skills/COMBO_TUNING.json";
import j_skills_WAVE2_SKILL_TUNING__index from "./skills/WAVE2_SKILL_TUNING/_index.json";
import j_skills_WAVE2_SKILL_TUNING_waterJar from "./skills/WAVE2_SKILL_TUNING/waterJar.json";
import j_skills_WAVE2_SKILL_TUNING_oilPot from "./skills/WAVE2_SKILL_TUNING/oilPot.json";
import j_skills_WAVE2_SKILL_TUNING_scorchLine from "./skills/WAVE2_SKILL_TUNING/scorchLine.json";
import j_skills_WAVE2_SKILL_TUNING_iceSlide from "./skills/WAVE2_SKILL_TUNING/iceSlide.json";
import j_skills_WAVE2_SKILL_TUNING_levelGround from "./skills/WAVE2_SKILL_TUNING/levelGround.json";
import j_skills_WAVE2_SKILL_TUNING_emberDraw from "./skills/WAVE2_SKILL_TUNING/emberDraw.json";
import j_skills_WAVE2_SKILL_TUNING_bogCall from "./skills/WAVE2_SKILL_TUNING/bogCall.json";
import j_skills_WAVE2_SKILL_TUNING_brandSear from "./skills/WAVE2_SKILL_TUNING/brandSear.json";
import j_skills_WAVE2_SKILL_TUNING_brandBlast from "./skills/WAVE2_SKILL_TUNING/brandBlast.json";
import j_skills_WAVE2_SKILL_TUNING_breakKick from "./skills/WAVE2_SKILL_TUNING/breakKick.json";
import j_skills_WAVE2_SKILL_TUNING_collapseHammer from "./skills/WAVE2_SKILL_TUNING/collapseHammer.json";
import j_skills_WAVE2_SKILL_TUNING_tideSlash from "./skills/WAVE2_SKILL_TUNING/tideSlash.json";
import j_skills_WAVE2_SKILL_TUNING_flashFreeze from "./skills/WAVE2_SKILL_TUNING/flashFreeze.json";
import j_skills_WAVE2_SKILL_TUNING_hueEtch from "./skills/WAVE2_SKILL_TUNING/hueEtch.json";
import j_skills_WAVE2_SKILL_TUNING_hueRelease from "./skills/WAVE2_SKILL_TUNING/hueRelease.json";
import j_skills_WAVE2_SKILL_TUNING_siphonMark from "./skills/WAVE2_SKILL_TUNING/siphonMark.json";
import j_skills_WAVE2_SKILL_TUNING_doomSentence from "./skills/WAVE2_SKILL_TUNING/doomSentence.json";
import j_skills_WAVE2_SKILL_TUNING_shiftingEdge from "./skills/WAVE2_SKILL_TUNING/shiftingEdge.json";
import j_skills_WAVE2_SKILL_TUNING_weaponArt from "./skills/WAVE2_SKILL_TUNING/weaponArt.json";
import j_skills_WAVE2_SKILL_TUNING_titanForm from "./skills/WAVE2_SKILL_TUNING/titanForm.json";
import j_skills_WAVE2_SKILL_TUNING_swiftForm from "./skills/WAVE2_SKILL_TUNING/swiftForm.json";
import j_skills_WAVE2_SKILL_TUNING_spiritForm from "./skills/WAVE2_SKILL_TUNING/spiritForm.json";
import j_skills_WAVE2_SKILL_TUNING_wardStake from "./skills/WAVE2_SKILL_TUNING/wardStake.json";
import j_skills_WAVE2_SKILL_TUNING_mire from "./skills/WAVE2_SKILL_TUNING/mire.json";
import j_skills_WAVE2_MODIFIER_TUNING from "./skills/WAVE2_MODIFIER_TUNING.json";
import j_skills_WAVE2_COMBO_TUNING from "./skills/WAVE2_COMBO_TUNING.json";
import j_skills_WEAR_TUNING from "./skills/WEAR_TUNING.json";
import j_skills_FORM_TUNING from "./skills/FORM_TUNING.json";
import j_skills_WAVE3_SKILL_TUNING from "./skills/WAVE3_SKILL_TUNING.json";
import j_skills_SHAPE_TUNING from "./skills/SHAPE_TUNING.json";
import j_skills_ART__index from "./skills/ART/_index.json";
import j_skills_ART_common from "./skills/ART/common.json";
import j_skills_ART_TRANSFORM__index from "./skills/ART/TRANSFORM/_index.json";
import j_skills_ART_TRANSFORM_flurry from "./skills/ART/TRANSFORM/flurry.json";
import j_skills_ART_TRANSFORM_crusher from "./skills/ART/TRANSFORM/crusher.json";
import j_skills_ART_TRANSFORM_hewer from "./skills/ART/TRANSFORM/hewer.json";
import j_skills_ART_TRANSFORM_polearm from "./skills/ART/TRANSFORM/polearm.json";
import j_skills_ART_TRANSFORM_chain from "./skills/ART/TRANSFORM/chain.json";
import j_skills_ART_TRANSFORM_bulwark from "./skills/ART/TRANSFORM/bulwark.json";
import j_skills_ART_TRANSFORM_warfan from "./skills/ART/TRANSFORM/warfan.json";
import j_skills_ART_TRANSFORM_rod from "./skills/ART/TRANSFORM/rod.json";
import j_skills_ART_TRANSFORM_thrower from "./skills/ART/TRANSFORM/thrower.json";
import j_skills_ART_TRANSFORM_pistol from "./skills/ART/TRANSFORM/pistol.json";
import j_skills_ART_TRANSFORM_rifle from "./skills/ART/TRANSFORM/rifle.json";
import j_skills_ART_TRANSFORM_artillery from "./skills/ART/TRANSFORM/artillery.json";
import j_skills_ART_TRANSFORM_bell from "./skills/ART/TRANSFORM/bell.json";
import j_ultimates__index from "./ultimates/_index.json";
import j_ultimates_ULTIMATE__index from "./ultimates/ULTIMATE/_index.json";
import j_ultimates_ULTIMATE_common from "./ultimates/ULTIMATE/common.json";
import j_ultimates_ULTIMATE_defs_sword from "./ultimates/ULTIMATE/defs/sword.json";
import j_ultimates_ULTIMATE_defs_greatsword from "./ultimates/ULTIMATE/defs/greatsword.json";
import j_ultimates_ULTIMATE_defs_twinBlades from "./ultimates/ULTIMATE/defs/twinBlades.json";
import j_ultimates_ULTIMATE_defs_spear from "./ultimates/ULTIMATE/defs/spear.json";
import j_ultimates_ULTIMATE_defs_scythe from "./ultimates/ULTIMATE/defs/scythe.json";
import j_ultimates_ULTIMATE_defs_fists from "./ultimates/ULTIMATE/defs/fists.json";
import j_ultimates_ULTIMATE_defs_whip from "./ultimates/ULTIMATE/defs/whip.json";
import j_ultimates_ULTIMATE_defs_cleaver from "./ultimates/ULTIMATE/defs/cleaver.json";
import j_ultimates_ULTIMATE_defs_staff from "./ultimates/ULTIMATE/defs/staff.json";
import j_ultimates_ULTIMATE_defs_wand from "./ultimates/ULTIMATE/defs/wand.json";
import j_ultimates_ULTIMATE_defs_katana from "./ultimates/ULTIMATE/defs/katana.json";
import j_ultimates_ULTIMATE_defs_axe from "./ultimates/ULTIMATE/defs/axe.json";
import j_ultimates_ULTIMATE_defs_shield from "./ultimates/ULTIMATE/defs/shield.json";
import j_ultimates_ULTIMATE_defs_chainSickle from "./ultimates/ULTIMATE/defs/chainSickle.json";
import j_ultimates_ULTIMATE_defs_hammer from "./ultimates/ULTIMATE/defs/hammer.json";
import j_ultimates_ULTIMATE_defs_gunner from "./ultimates/ULTIMATE/defs/gunner.json";
import j_ultimates_ULTIMATE_defs_sidearm from "./ultimates/ULTIMATE/defs/sidearm.json";
import j_ultimates_ULTIMATE_defs_longarm from "./ultimates/ULTIMATE/defs/longarm.json";
import j_ultimates_ULTIMATE_defs_cannon from "./ultimates/ULTIMATE/defs/cannon.json";
import j_ultimates_ULTIMATE_defs_thrown from "./ultimates/ULTIMATE/defs/thrown.json";
import j_ultimates_ULTIMATE_defs_grenade from "./ultimates/ULTIMATE/defs/grenade.json";
import j_ultimates_ULTIMATE_defs_trapper from "./ultimates/ULTIMATE/defs/trapper.json";
import j_ultimates_ULTIMATE_defs_warRing from "./ultimates/ULTIMATE/defs/warRing.json";
import j_ultimates_ULTIMATE_defs_claws from "./ultimates/ULTIMATE/defs/claws.json";
import j_ultimates_ULTIMATE_defs_flail from "./ultimates/ULTIMATE/defs/flail.json";
import j_ultimates_ULTIMATE_defs_ringBlades from "./ultimates/ULTIMATE/defs/ringBlades.json";
import j_ultimates_ULTIMATE_defs_fan from "./ultimates/ULTIMATE/defs/fan.json";
import j_ultimates_ULTIMATE_defs_book from "./ultimates/ULTIMATE/defs/book.json";
import j_ultimates_ULTIMATE_defs_handbell from "./ultimates/ULTIMATE/defs/handbell.json";
import j_weapons__index from "./weapons/_index.json";
import j_weapons_WEAPON__index from "./weapons/WEAPON/_index.json";
import j_weapons_WEAPON_movesets_sword from "./weapons/WEAPON/movesets/sword.json";
import j_weapons_WEAPON_movesets_greatsword from "./weapons/WEAPON/movesets/greatsword.json";
import j_weapons_WEAPON_movesets_twinBlades from "./weapons/WEAPON/movesets/twinBlades.json";
import j_weapons_WEAPON_movesets_spear from "./weapons/WEAPON/movesets/spear.json";
import j_weapons_WEAPON_movesets_scythe from "./weapons/WEAPON/movesets/scythe.json";
import j_weapons_WEAPON_movesets_fists from "./weapons/WEAPON/movesets/fists.json";
import j_weapons_WEAPON_movesets_whip from "./weapons/WEAPON/movesets/whip.json";
import j_weapons_WEAPON_movesets_cleaver from "./weapons/WEAPON/movesets/cleaver.json";
import j_weapons_WEAPON_movesets_staff from "./weapons/WEAPON/movesets/staff.json";
import j_weapons_WEAPON_movesets_wand from "./weapons/WEAPON/movesets/wand.json";
import j_weapons_WEAPON_movesets_katana from "./weapons/WEAPON/movesets/katana.json";
import j_weapons_WEAPON_movesets_axe from "./weapons/WEAPON/movesets/axe.json";
import j_weapons_WEAPON_movesets_shield from "./weapons/WEAPON/movesets/shield.json";
import j_weapons_WEAPON_movesets_chainSickle from "./weapons/WEAPON/movesets/chainSickle.json";
import j_weapons_WEAPON_movesets_hammer from "./weapons/WEAPON/movesets/hammer.json";
import j_weapons_WEAPON_movesets_gunner from "./weapons/WEAPON/movesets/gunner.json";
import j_weapons_WEAPON_movesets_sidearm from "./weapons/WEAPON/movesets/sidearm.json";
import j_weapons_WEAPON_movesets_longarm from "./weapons/WEAPON/movesets/longarm.json";
import j_weapons_WEAPON_movesets_cannon from "./weapons/WEAPON/movesets/cannon.json";
import j_weapons_WEAPON_movesets_thrown from "./weapons/WEAPON/movesets/thrown.json";
import j_weapons_WEAPON_movesets_grenade from "./weapons/WEAPON/movesets/grenade.json";
import j_weapons_WEAPON_movesets_trapper from "./weapons/WEAPON/movesets/trapper.json";
import j_weapons_WEAPON_movesets_warRing from "./weapons/WEAPON/movesets/warRing.json";
import j_weapons_WEAPON_movesets_claws from "./weapons/WEAPON/movesets/claws.json";
import j_weapons_WEAPON_movesets_flail from "./weapons/WEAPON/movesets/flail.json";
import j_weapons_WEAPON_movesets_ringBlades from "./weapons/WEAPON/movesets/ringBlades.json";
import j_weapons_WEAPON_movesets_fan from "./weapons/WEAPON/movesets/fan.json";
import j_weapons_WEAPON_movesets_book from "./weapons/WEAPON/movesets/book.json";
import j_weapons_WEAPON_movesets_handbell from "./weapons/WEAPON/movesets/handbell.json";
import j_weapons_WEAPON_artDefaults from "./weapons/WEAPON/artDefaults.json";
import j_weapons_WEAPON_movesetRules from "./weapons/WEAPON/movesetRules.json";
import j_weapons_WEAPON_jobBranches from "./weapons/WEAPON/jobBranches.json";
import j_weapons_WEAPON_bullets from "./weapons/WEAPON/bullets.json";
import j_weapons_WEAPON_unarmed from "./weapons/WEAPON/unarmed.json";
import j_weapons_WEAPON_weightClass from "./weapons/WEAPON/weightClass.json";
import j_weapons_PLAYER_MELEE from "./weapons/PLAYER_MELEE.json";
import j_weapons_ACTION_DASH_ATTACK from "./weapons/ACTION_DASH_ATTACK.json";
import j_weapons_FORM__index from "./weapons/FORM/_index.json";
import j_weapons_FORM_blade from "./weapons/FORM/blade.json";
import j_weapons_FORM_flurry from "./weapons/FORM/flurry.json";
import j_weapons_FORM_crusher from "./weapons/FORM/crusher.json";
import j_weapons_FORM_hewer from "./weapons/FORM/hewer.json";
import j_weapons_FORM_polearm from "./weapons/FORM/polearm.json";
import j_weapons_FORM_chain from "./weapons/FORM/chain.json";
import j_weapons_FORM_bulwark from "./weapons/FORM/bulwark.json";
import j_weapons_FORM_warfan from "./weapons/FORM/warfan.json";
import j_weapons_FORM_rod from "./weapons/FORM/rod.json";
import j_weapons_FORM_thrower from "./weapons/FORM/thrower.json";
import j_weapons_FORM_pistol from "./weapons/FORM/pistol.json";
import j_weapons_FORM_rifle from "./weapons/FORM/rifle.json";
import j_weapons_FORM_artillery from "./weapons/FORM/artillery.json";
import j_weapons_FORM_tome from "./weapons/FORM/tome.json";
import j_weapons_FORM_bell from "./weapons/FORM/bell.json";
import j_weapons_MOMENT from "./weapons/MOMENT.json";
import j_weapons_REFORGE__index from "./weapons/REFORGE/_index.json";
import j_weapons_REFORGE_blade from "./weapons/REFORGE/blade.json";
import j_weapons_REFORGE_flurry from "./weapons/REFORGE/flurry.json";
import j_weapons_REFORGE_crusher from "./weapons/REFORGE/crusher.json";
import j_weapons_REFORGE_hewer from "./weapons/REFORGE/hewer.json";
import j_weapons_REFORGE_polearm from "./weapons/REFORGE/polearm.json";
import j_weapons_REFORGE_chain from "./weapons/REFORGE/chain.json";
import j_weapons_REFORGE_bulwark from "./weapons/REFORGE/bulwark.json";
import j_weapons_REFORGE_warfan from "./weapons/REFORGE/warfan.json";
import j_weapons_REFORGE_rod from "./weapons/REFORGE/rod.json";
import j_weapons_REFORGE_thrower from "./weapons/REFORGE/thrower.json";
import j_weapons_REFORGE_pistol from "./weapons/REFORGE/pistol.json";
import j_weapons_REFORGE_rifle from "./weapons/REFORGE/rifle.json";
import j_weapons_REFORGE_artillery from "./weapons/REFORGE/artillery.json";
import j_weapons_REFORGE_tome from "./weapons/REFORGE/tome.json";
import j_weapons_REFORGE_bell from "./weapons/REFORGE/bell.json";
import j_world__index from "./world/_index.json";
import j_world_ROOM from "./world/ROOM.json";
import j_world_ROOM_KIND__index from "./world/ROOM_KIND/_index.json";
import j_world_ROOM_KIND_extra from "./world/ROOM_KIND/extra.json";
import j_world_ROOM_KIND_gambleWeights from "./world/ROOM_KIND/gambleWeights.json";
import j_world_ROOM_KIND_locks from "./world/ROOM_KIND/locks.json";
import j_world_FLOOR_KIND from "./world/FLOOR_KIND.json";
import j_world_CAVE from "./world/CAVE.json";
import j_world_ROAM from "./world/ROAM.json";
import j_world_RUN_EVENT__index from "./world/RUN_EVENT/_index.json";
import j_world_RUN_EVENT_lockChance from "./world/RUN_EVENT/lockChance.json";
import j_world_RUN_EVENT_floorChance from "./world/RUN_EVENT/floorChance.json";
import j_world_RUN_EVENT_timedChance from "./world/RUN_EVENT/timedChance.json";
import j_world_RUN_EVENT_clearChance from "./world/RUN_EVENT/clearChance.json";
import j_world_RUN_EVENT_quake from "./world/RUN_EVENT/quake.json";
import j_world_RUN_EVENT_meteor from "./world/RUN_EVENT/meteor.json";
import j_world_RUN_EVENT_sluggish from "./world/RUN_EVENT/sluggish.json";
import j_world_RUN_EVENT_flood from "./world/RUN_EVENT/flood.json";
import j_world_RUN_EVENT_duel from "./world/RUN_EVENT/duel.json";
import j_world_RUN_EVENT_surge from "./world/RUN_EVENT/surge.json";
import j_world_RUN_EVENT_thunder from "./world/RUN_EVENT/thunder.json";
import j_world_RUN_EVENT_reaperPass from "./world/RUN_EVENT/reaperPass.json";
import j_world_RUN_EVENT_lifeFlow from "./world/RUN_EVENT/lifeFlow.json";
import j_world_RUN_EVENT_bats from "./world/RUN_EVENT/bats.json";
import j_world_RUN_EVENT_vein from "./world/RUN_EVENT/vein.json";
import j_world_RUN_EVENT_thief from "./world/RUN_EVENT/thief.json";
import j_world_LINGER from "./world/LINGER.json";
import j_world_ORIGIN from "./world/ORIGIN.json";
import j_world_CONTRACT from "./world/CONTRACT.json";
import j_world_RUN_MOD from "./world/RUN_MOD.json";
import j_world_HUB from "./world/HUB.json";
import j_world_HUB_DECOR from "./world/HUB_DECOR.json";
import j_world_META from "./world/META.json";
import j_world_DISCOVERY from "./world/DISCOVERY.json";
import j_world_MAP_SIZE from "./world/MAP_SIZE.json";
import j_world_HIDDEN_ROOM from "./world/HIDDEN_ROOM.json";
import j_world_ECONOMY__index from "./world/ECONOMY/_index.json";
import j_world_ECONOMY_coin from "./world/ECONOMY/coin.json";
import j_world_ECONOMY_container from "./world/ECONOMY/container.json";
import j_world_ECONOMY_income from "./world/ECONOMY/income.json";
import j_world_ECONOMY_spill from "./world/ECONOMY/spill.json";
import j_world_ECONOMY_key from "./world/ECONOMY/key.json";
import j_world_ECONOMY_flask from "./world/ECONOMY/flask.json";
import j_world_ECONOMY_market from "./world/ECONOMY/market.json";
import j_world_ECONOMY_price from "./world/ECONOMY/price.json";
import j_world_ECONOMY_donation from "./world/ECONOMY/donation.json";
import j_world_ECONOMY_bet from "./world/ECONOMY/bet.json";
import j_world_ECONOMY_build from "./world/ECONOMY/build.json";
import j_world_ARC from "./world/ARC.json";
import j_world_EXIT from "./world/EXIT.json";

export const boons = {
  "_note": j_boons__index["_note"],
  "BOON": j_boons_BOON,
  "LINEAGE": {
    "_note": j_boons_LINEAGE__index["_note"],
    "ash": j_boons_LINEAGE_ash,
    "frost": j_boons_LINEAGE_frost,
    "thunder": j_boons_LINEAGE_thunder,
    "moon": j_boons_LINEAGE_moon,
    "earth": j_boons_LINEAGE_earth,
    "blade": j_boons_LINEAGE_blade,
    "cycle": j_boons_LINEAGE_cycle,
    "horde": j_boons_LINEAGE_horde,
    "wealth": j_boons_LINEAGE_wealth,
    "fusion": j_boons_LINEAGE_fusion,
    "cursed": j_boons_LINEAGE_cursed,
  },
};

export const combat = {
  "_note": j_combat__index["_note"],
  "MANA": j_combat_MANA,
  "HEAL": j_combat_HEAL,
  "BLAST_FALLOFF": j_combat_BLAST_FALLOFF,
  "STATUS": {
    "_note": j_combat_STATUS__index["_note"],
    "burnDuration": j_combat_STATUS__index["burnDuration"],
    "burnParticleInterval": j_combat_STATUS__index["burnParticleInterval"],
    "burnColor": j_combat_STATUS__index["burnColor"],
    "chillColor": j_combat_STATUS__index["chillColor"],
    "chillDuration": j_combat_STATUS__index["chillDuration"],
    "maxSlow": j_combat_STATUS__index["maxSlow"],
    "onHitIcd": j_combat_STATUS__index["onHitIcd"],
    "shockRadius": j_combat_STATUS__index["shockRadius"],
    "shockMaxTargets": j_combat_STATUS__index["shockMaxTargets"],
    "shockColor": j_combat_STATUS__index["shockColor"],
    "explodeRadius": j_combat_STATUS__index["explodeRadius"],
    "explodeColor": j_combat_STATUS__index["explodeColor"],
    "explodeKnockback": j_combat_STATUS__index["explodeKnockback"],
    "fxLife": j_combat_STATUS__index["fxLife"],
    "ccWindow": j_combat_STATUS__index["ccWindow"],
    "ccBudget": j_combat_STATUS__index["ccBudget"],
    "chill": j_combat_STATUS_chill,
    "freeze": j_combat_STATUS_freeze,
    "shock": j_combat_STATUS_shock,
    "paralyze": j_combat_STATUS_paralyze,
    "poison": j_combat_STATUS_poison,
    "bleed": j_combat_STATUS_bleed,
    "vulnerable": j_combat_STATUS_vulnerable,
    "weaken": j_combat_STATUS_weaken,
    "fear": j_combat_STATUS_fear,
    "silence": j_combat_STATUS_silence,
    "vaporizeRatio": j_combat_STATUS__index["vaporizeRatio"],
    "burnMaxStacks": j_combat_STATUS__index["burnMaxStacks"],
    "reactionIcd": j_combat_STATUS__index["reactionIcd"],
    "lastEndedWindow": j_combat_STATUS__index["lastEndedWindow"],
    "statusCountCap": j_combat_STATUS__index["statusCountCap"],
    "totalStacksCap": j_combat_STATUS__index["totalStacksCap"],
    "goodCountCap": j_combat_STATUS__index["goodCountCap"],
    "wet": j_combat_STATUS_wet,
    "soaked": j_combat_STATUS_soaked,
    "oiled": j_combat_STATUS_oiled,
    "blaze": j_combat_STATUS_blaze,
    "corrode": j_combat_STATUS_corrode,
    "brand": j_combat_STATUS_brand,
    "broken": j_combat_STATUS_broken,
    "doom": j_combat_STATUS_doom,
    "siphon": j_combat_STATUS_siphon,
    "hue": j_combat_STATUS_hue,
    "scorch": j_combat_STATUS_scorch,
    "venom": j_combat_STATUS_venom,
    "hemorrhage": j_combat_STATUS_hemorrhage,
    "encase": j_combat_STATUS_encase,
    "exposed": j_combat_STATUS_exposed,
    "enfeeble": j_combat_STATUS_enfeeble,
    "haste": j_combat_STATUS_haste,
    "harden": j_combat_STATUS_harden,
    "wrath": j_combat_STATUS_wrath,
    "fury": j_combat_STATUS_fury,
    "charged": j_combat_STATUS_charged,
    "steam": j_combat_STATUS_steam,
    "conduct": j_combat_STATUS_conduct,
    "kindle": j_combat_STATUS_kindle,
    "quench": j_combat_STATUS_quench,
    "miasma": j_combat_STATUS_miasma,
    "shatterBleed": j_combat_STATUS_shatterBleed,
    "cauterize": j_combat_STATUS_cauterize,
    "panic": j_combat_STATUS_panic,
    "lacerate": j_combat_STATUS_lacerate,
    "wound": j_combat_STATUS_wound,
  },
  "ATTR": j_combat_ATTR,
  "ATTR_GAIN": j_combat_ATTR_GAIN,
  "POISE": j_combat_POISE,
  "PARRY": j_combat_PARRY,
  "GENRE": j_combat_GENRE,
  "ELEMENT": j_combat_ELEMENT,
  "TERRAIN": j_combat_TERRAIN,
  "TERRAIN_MUD_SMOKE": j_combat_TERRAIN_MUD_SMOKE,
  "TERRAIN_RUBBLE": j_combat_TERRAIN_RUBBLE,
  "PLAYER": j_combat_PLAYER,
  "ACTION": j_combat_ACTION,
  "ENERGY": j_combat_ENERGY,
};

export const enemies = {
  "_note": j_enemies__index["_note"],
  "ENEMY_AI": {
    "_note": j_enemies_ENEMY_AI__index["_note"],
    "strikerHoldTime": j_enemies_ENEMY_AI__index["strikerHoldTime"],
    "knockDecay": j_enemies_ENEMY_AI__index["knockDecay"],
    "knight": j_enemies_ENEMY_AI_knight,
    "bomber": j_enemies_ENEMY_AI_bomber,
    "laser": j_enemies_ENEMY_AI_laser,
    "golem": j_enemies_ENEMY_AI_golem,
    "bat": j_enemies_ENEMY_AI_bat,
    "wisp": j_enemies_ENEMY_AI_wisp,
    "volley": j_enemies_ENEMY_AI_volley,
    "flank": j_enemies_ENEMY_AI_flank,
    "timid": j_enemies_ENEMY_AI_timid,
    "deathBurst": j_enemies_ENEMY_AI_deathBurst,
    "rockfall": j_enemies_ENEMY_AI_rockfall,
    "kamikaze": j_enemies_ENEMY_AI_kamikaze,
    "echoStriker": j_enemies_ENEMY_AI_echoStriker,
    "packLeader": j_enemies_ENEMY_AI_packLeader,
    "conductor": j_enemies_ENEMY_AI_conductor,
    "manaLeech": j_enemies_ENEMY_AI_manaLeech,
    "corpse": j_enemies_ENEMY_AI_corpse,
    "scavenger": j_enemies_ENEMY_AI_scavenger,
    "graveBell": j_enemies_ENEMY_AI_graveBell,
    "silencer": j_enemies_ENEMY_AI_silencer,
    "frostCrusher": j_enemies_ENEMY_AI_frostCrusher,
    "twinShade": j_enemies_ENEMY_AI_twinShade,
    "mimic": j_enemies_ENEMY_AI_mimic,
    "hollowArmor": j_enemies_ENEMY_AI_hollowArmor,
    "terrainSeed": j_enemies_ENEMY_AI_terrainSeed,
    "friendlyBlastMul": j_enemies_ENEMY_AI__index["friendlyBlastMul"],
    "silencedAttackManaMul": j_enemies_ENEMY_AI__index["silencedAttackManaMul"],
    "lobber": j_enemies_ENEMY_AI_lobber,
    "oiler": j_enemies_ENEMY_AI_oiler,
    "bellImp": j_enemies_ENEMY_AI_bellImp,
    "banner": j_enemies_ENEMY_AI_banner,
    "charged": j_enemies_ENEMY_AI_charged,
    "burrower": j_enemies_ENEMY_AI_burrower,
    "dropper": j_enemies_ENEMY_AI_dropper,
    "absorber": j_enemies_ENEMY_AI_absorber,
    "homunculus": j_enemies_ENEMY_AI_homunculus,
    "scribeImp": j_enemies_ENEMY_AI_scribeImp,
    "crossGolem": j_enemies_ENEMY_AI_crossGolem,
    "windSprite": j_enemies_ENEMY_AI_windSprite,
    "mineLayer": j_enemies_ENEMY_AI_mineLayer,
    "mine": j_enemies_ENEMY_AI_mine,
    "chainWarden": j_enemies_ENEMY_AI_chainWarden,
    "hollow": j_enemies_ENEMY_AI_hollow,
    "flameEater": j_enemies_ENEMY_AI_flameEater,
    "spore": j_enemies_ENEMY_AI_spore,
    "swampWisp": j_enemies_ENEMY_AI_swampWisp,
    "iceTrail": j_enemies_ENEMY_AI_iceTrail,
    "giantToad": j_enemies_ENEMY_AI_giantToad,
    "forgeMaster": j_enemies_ENEMY_AI_forgeMaster,
    "turretMaster": j_enemies_ENEMY_AI_turretMaster,
    "turret": j_enemies_ENEMY_AI_turret,
    "basilisk": j_enemies_ENEMY_AI_basilisk,
    "shadowStalker": j_enemies_ENEMY_AI_shadowStalker,
    "leaper": j_enemies_ENEMY_AI_leaper,
  },
  "ENEMY_TEMPO": j_enemies_ENEMY_TEMPO,
  "ELITE": j_enemies_ELITE,
  "ELITE_GREEDY": j_enemies_ELITE_GREEDY,
  "DOUBLE_CHARGE": j_enemies_DOUBLE_CHARGE,
  "BOSS": {
    "_note": j_enemies_BOSS__index["_note"],
    "interval": j_enemies_BOSS__index["interval"],
    "roomMinW": j_enemies_BOSS__index["roomMinW"],
    "roomMinH": j_enemies_BOSS__index["roomMinH"],
    "introTime": j_enemies_BOSS__index["introTime"],
    "defeatSlowmo": j_enemies_BOSS__index["defeatSlowmo"],
    "rareDrops": j_enemies_BOSS__index["rareDrops"],
    "rareDropBoost": j_enemies_BOSS__index["rareDropBoost"],
    "rareDropAttempts": j_enemies_BOSS__index["rareDropAttempts"],
    "kingSlime": j_enemies_BOSS_kingSlime,
    "boneLord": j_enemies_BOSS_boneLord,
    "twinKnights": j_enemies_BOSS_twinKnights,
    "frostGiant": j_enemies_BOSS_frostGiant,
    "oilKing": j_enemies_BOSS_oilKing,
    "broodMother": j_enemies_BOSS_broodMother,
    "librarian": j_enemies_BOSS_librarian,
    "mirrorKnight": j_enemies_BOSS_mirrorKnight,
    "thiefKing": j_enemies_BOSS_thiefKing,
  },
  "FLOOR_LORD": j_enemies_FLOOR_LORD,
  "JIN": j_enemies_JIN,
  "FORMATION": {
    "_note": j_enemies_FORMATION__index["_note"],
    "_fields": j_enemies_FORMATION__index["_fields"],
    "fishScale": j_enemies_FORMATION_fishScale,
    "craneWing": j_enemies_FORMATION_craneWing,
    "geese": j_enemies_FORMATION_geese,
    "column": j_enemies_FORMATION_column,
    "crescent": j_enemies_FORMATION_crescent,
    "circle": j_enemies_FORMATION_circle,
    "lookout": j_enemies_FORMATION_lookout,
    "arrowhead": j_enemies_FORMATION_arrowhead,
    "yoke": j_enemies_FORMATION_yoke,
  },
  "REAPER": j_enemies_REAPER,
  "stats": {
    "_fields": j_enemies_stats__index["_fields"],
    "slime": j_enemies_stats_slime,
    "eye": j_enemies_stats_eye,
    "boar": j_enemies_stats_boar,
    "knight": j_enemies_stats_knight,
    "bomber": j_enemies_stats_bomber,
    "laserEye": j_enemies_stats_laserEye,
    "golem": j_enemies_stats_golem,
    "bat": j_enemies_stats_bat,
    "wisp": j_enemies_stats_wisp,
    "kingSlime": j_enemies_stats_kingSlime,
    "boneLord": j_enemies_stats_boneLord,
    "poisonSlime": j_enemies_stats_poisonSlime,
    "iceSlime": j_enemies_stats_iceSlime,
    "fireSlime": j_enemies_stats_fireSlime,
    "goldSlime": j_enemies_stats_goldSlime,
    "boneBoar": j_enemies_stats_boneBoar,
    "boarDouble": j_enemies_stats_boarDouble,
    "curseEye": j_enemies_stats_curseEye,
    "frostEye": j_enemies_stats_frostEye,
    "blackKnight": j_enemies_stats_blackKnight,
    "lavaGolem": j_enemies_stats_lavaGolem,
    "frostGolem": j_enemies_stats_frostGolem,
    "crystalGolem": j_enemies_stats_crystalGolem,
    "frostWisp": j_enemies_stats_frostWisp,
    "purpleLaser": j_enemies_stats_purpleLaser,
    "flyingBook": j_enemies_stats_flyingBook,
    "ashBat": j_enemies_stats_ashBat,
    "sproutSlime": j_enemies_stats_sproutSlime,
    "spikeRat": j_enemies_stats_spikeRat,
    "twinEye": j_enemies_stats_twinEye,
    "triLaser": j_enemies_stats_triLaser,
    "shadowBat": j_enemies_stats_shadowBat,
    "wolf": j_enemies_stats_wolf,
    "multiBomber": j_enemies_stats_multiBomber,
    "spearman": j_enemies_stats_spearman,
    "hornBeetle": j_enemies_stats_hornBeetle,
    "netter": j_enemies_stats_netter,
    "carrionFly": j_enemies_stats_carrionFly,
    "thunderWisp": j_enemies_stats_thunderWisp,
    "skeleton": j_enemies_stats_skeleton,
    "fuseRat": j_enemies_stats_fuseRat,
    "crystalMite": j_enemies_stats_crystalMite,
    "echoStriker": j_enemies_stats_echoStriker,
    "packLeader": j_enemies_stats_packLeader,
    "manaLeech": j_enemies_stats_manaLeech,
    "scavenger": j_enemies_stats_scavenger,
    "graveBell": j_enemies_stats_graveBell,
    "silencer": j_enemies_stats_silencer,
    "frostCrusher": j_enemies_stats_frostCrusher,
    "twinShade": j_enemies_stats_twinShade,
    "mimic": j_enemies_stats_mimic,
    "hollowArmor": j_enemies_stats_hollowArmor,
    "hollowWraith": j_enemies_stats_hollowWraith,
    "boneConductor": j_enemies_stats_boneConductor,
    "twinBrother": j_enemies_stats_twinBrother,
    "twinSister": j_enemies_stats_twinSister,
    "frostGiant": j_enemies_stats_frostGiant,
    "icePillar": j_enemies_stats_icePillar,
    "trainingDummy": j_enemies_stats_trainingDummy,
    "mirrorSelf": j_enemies_stats_mirrorSelf,
    "mudman": j_enemies_stats_mudman,
    "toad": j_enemies_stats_toad,
    "oiler": j_enemies_stats_oiler,
    "flameEater": j_enemies_stats_flameEater,
    "windSprite": j_enemies_stats_windSprite,
    "mineLayer": j_enemies_stats_mineLayer,
    "enemyMine": j_enemies_stats_enemyMine,
    "bellImp": j_enemies_stats_bellImp,
    "bannerBearer": j_enemies_stats_bannerBearer,
    "banner": j_enemies_stats_banner,
    "burrower": j_enemies_stats_burrower,
    "dropper": j_enemies_stats_dropper,
    "absorber": j_enemies_stats_absorber,
    "homunculus": j_enemies_stats_homunculus,
    "scribeImp": j_enemies_stats_scribeImp,
    "crossGolem": j_enemies_stats_crossGolem,
    "chainWarden": j_enemies_stats_chainWarden,
    "hollow": j_enemies_stats_hollow,
    "lurker": j_enemies_stats_lurker,
    "iceBoar": j_enemies_stats_iceBoar,
    "sootBomber": j_enemies_stats_sootBomber,
    "mossGolem": j_enemies_stats_mossGolem,
    "swampWisp": j_enemies_stats_swampWisp,
    "frostToad": j_enemies_stats_frostToad,
    "magmaToad": j_enemies_stats_magmaToad,
    "oilSlime": j_enemies_stats_oilSlime,
    "stormEye": j_enemies_stats_stormEye,
    "emberRat": j_enemies_stats_emberRat,
    "giantToad": j_enemies_stats_giantToad,
    "forgeMaster": j_enemies_stats_forgeMaster,
    "anvil": j_enemies_stats_anvil,
    "turretMaster": j_enemies_stats_turretMaster,
    "turret": j_enemies_stats_turret,
    "basilisk": j_enemies_stats_basilisk,
    "shadowStalker": j_enemies_stats_shadowStalker,
    "oilKing": j_enemies_stats_oilKing,
    "broodMother": j_enemies_stats_broodMother,
    "broodEgg": j_enemies_stats_broodEgg,
    "librarian": j_enemies_stats_librarian,
    "mirrorKnight": j_enemies_stats_mirrorKnight,
    "mirrorImage": j_enemies_stats_mirrorImage,
    "thiefKing": j_enemies_stats_thiefKing,
    "thief": j_enemies_stats_thief,
    "reaperShade": j_enemies_stats_reaperShade,
    "merchant": j_enemies_stats_merchant,
    "pot": j_enemies_stats_pot,
    "crate": j_enemies_stats_crate,
  },
  "combat": {
    "_fields": j_enemies_combat__index["_fields"],
    "slime": j_enemies_combat_slime,
    "eye": j_enemies_combat_eye,
    "boar": j_enemies_combat_boar,
    "knight": j_enemies_combat_knight,
    "bomber": j_enemies_combat_bomber,
    "laserEye": j_enemies_combat_laserEye,
    "golem": j_enemies_combat_golem,
    "bat": j_enemies_combat_bat,
    "wisp": j_enemies_combat_wisp,
    "kingSlime": j_enemies_combat_kingSlime,
    "boneLord": j_enemies_combat_boneLord,
    "poisonSlime": j_enemies_combat_poisonSlime,
    "iceSlime": j_enemies_combat_iceSlime,
    "fireSlime": j_enemies_combat_fireSlime,
    "goldSlime": j_enemies_combat_goldSlime,
    "boneBoar": j_enemies_combat_boneBoar,
    "boarDouble": j_enemies_combat_boarDouble,
    "curseEye": j_enemies_combat_curseEye,
    "frostEye": j_enemies_combat_frostEye,
    "blackKnight": j_enemies_combat_blackKnight,
    "lavaGolem": j_enemies_combat_lavaGolem,
    "frostGolem": j_enemies_combat_frostGolem,
    "crystalGolem": j_enemies_combat_crystalGolem,
    "frostWisp": j_enemies_combat_frostWisp,
    "purpleLaser": j_enemies_combat_purpleLaser,
    "flyingBook": j_enemies_combat_flyingBook,
    "ashBat": j_enemies_combat_ashBat,
    "sproutSlime": j_enemies_combat_sproutSlime,
    "spikeRat": j_enemies_combat_spikeRat,
    "twinEye": j_enemies_combat_twinEye,
    "triLaser": j_enemies_combat_triLaser,
    "shadowBat": j_enemies_combat_shadowBat,
    "wolf": j_enemies_combat_wolf,
    "multiBomber": j_enemies_combat_multiBomber,
    "spearman": j_enemies_combat_spearman,
    "hornBeetle": j_enemies_combat_hornBeetle,
    "netter": j_enemies_combat_netter,
    "carrionFly": j_enemies_combat_carrionFly,
    "thunderWisp": j_enemies_combat_thunderWisp,
    "skeleton": j_enemies_combat_skeleton,
    "fuseRat": j_enemies_combat_fuseRat,
    "crystalMite": j_enemies_combat_crystalMite,
    "echoStriker": j_enemies_combat_echoStriker,
    "packLeader": j_enemies_combat_packLeader,
    "manaLeech": j_enemies_combat_manaLeech,
    "scavenger": j_enemies_combat_scavenger,
    "graveBell": j_enemies_combat_graveBell,
    "silencer": j_enemies_combat_silencer,
    "frostCrusher": j_enemies_combat_frostCrusher,
    "twinShade": j_enemies_combat_twinShade,
    "mimic": j_enemies_combat_mimic,
    "hollowArmor": j_enemies_combat_hollowArmor,
    "hollowWraith": j_enemies_combat_hollowWraith,
    "boneConductor": j_enemies_combat_boneConductor,
    "twinBrother": j_enemies_combat_twinBrother,
    "twinSister": j_enemies_combat_twinSister,
    "frostGiant": j_enemies_combat_frostGiant,
    "icePillar": j_enemies_combat_icePillar,
    "trainingDummy": j_enemies_combat_trainingDummy,
    "mirrorSelf": j_enemies_combat_mirrorSelf,
    "mudman": j_enemies_combat_mudman,
    "toad": j_enemies_combat_toad,
    "oiler": j_enemies_combat_oiler,
    "flameEater": j_enemies_combat_flameEater,
    "windSprite": j_enemies_combat_windSprite,
    "mineLayer": j_enemies_combat_mineLayer,
    "enemyMine": j_enemies_combat_enemyMine,
    "bellImp": j_enemies_combat_bellImp,
    "bannerBearer": j_enemies_combat_bannerBearer,
    "banner": j_enemies_combat_banner,
    "burrower": j_enemies_combat_burrower,
    "dropper": j_enemies_combat_dropper,
    "absorber": j_enemies_combat_absorber,
    "homunculus": j_enemies_combat_homunculus,
    "scribeImp": j_enemies_combat_scribeImp,
    "crossGolem": j_enemies_combat_crossGolem,
    "chainWarden": j_enemies_combat_chainWarden,
    "hollow": j_enemies_combat_hollow,
    "lurker": j_enemies_combat_lurker,
    "iceBoar": j_enemies_combat_iceBoar,
    "sootBomber": j_enemies_combat_sootBomber,
    "mossGolem": j_enemies_combat_mossGolem,
    "swampWisp": j_enemies_combat_swampWisp,
    "frostToad": j_enemies_combat_frostToad,
    "magmaToad": j_enemies_combat_magmaToad,
    "oilSlime": j_enemies_combat_oilSlime,
    "stormEye": j_enemies_combat_stormEye,
    "emberRat": j_enemies_combat_emberRat,
    "giantToad": j_enemies_combat_giantToad,
    "forgeMaster": j_enemies_combat_forgeMaster,
    "anvil": j_enemies_combat_anvil,
    "turretMaster": j_enemies_combat_turretMaster,
    "turret": j_enemies_combat_turret,
    "basilisk": j_enemies_combat_basilisk,
    "shadowStalker": j_enemies_combat_shadowStalker,
    "oilKing": j_enemies_combat_oilKing,
    "broodMother": j_enemies_combat_broodMother,
    "broodEgg": j_enemies_combat_broodEgg,
    "librarian": j_enemies_combat_librarian,
    "mirrorKnight": j_enemies_combat_mirrorKnight,
    "thiefKing": j_enemies_combat_thiefKing,
    "thief": j_enemies_combat_thief,
    "mirrorImage": j_enemies_combat_mirrorImage,
    "reaperShade": j_enemies_combat_reaperShade,
    "merchant": j_enemies_combat_merchant,
    "pot": j_enemies_combat_pot,
    "crate": j_enemies_combat_crate,
  },
  "defense": {
    "_fields": j_enemies_defense__index["_fields"],
    "bodies": j_enemies_defense_bodies,
    "biomes": j_enemies_defense_biomes,
    "enemies": {
      "slime": j_enemies_defense_enemies_slime,
      "eye": j_enemies_defense_enemies_eye,
      "boar": j_enemies_defense_enemies_boar,
      "knight": j_enemies_defense_enemies_knight,
      "bomber": j_enemies_defense_enemies_bomber,
      "laserEye": j_enemies_defense_enemies_laserEye,
      "golem": j_enemies_defense_enemies_golem,
      "bat": j_enemies_defense_enemies_bat,
      "wisp": j_enemies_defense_enemies_wisp,
      "kingSlime": j_enemies_defense_enemies_kingSlime,
      "boneLord": j_enemies_defense_enemies_boneLord,
      "poisonSlime": j_enemies_defense_enemies_poisonSlime,
      "iceSlime": j_enemies_defense_enemies_iceSlime,
      "fireSlime": j_enemies_defense_enemies_fireSlime,
      "goldSlime": j_enemies_defense_enemies_goldSlime,
      "boneBoar": j_enemies_defense_enemies_boneBoar,
      "boarDouble": j_enemies_defense_enemies_boarDouble,
      "curseEye": j_enemies_defense_enemies_curseEye,
      "frostEye": j_enemies_defense_enemies_frostEye,
      "blackKnight": j_enemies_defense_enemies_blackKnight,
      "lavaGolem": j_enemies_defense_enemies_lavaGolem,
      "frostGolem": j_enemies_defense_enemies_frostGolem,
      "crystalGolem": j_enemies_defense_enemies_crystalGolem,
      "frostWisp": j_enemies_defense_enemies_frostWisp,
      "purpleLaser": j_enemies_defense_enemies_purpleLaser,
      "flyingBook": j_enemies_defense_enemies_flyingBook,
      "ashBat": j_enemies_defense_enemies_ashBat,
      "sproutSlime": j_enemies_defense_enemies_sproutSlime,
      "spikeRat": j_enemies_defense_enemies_spikeRat,
      "twinEye": j_enemies_defense_enemies_twinEye,
      "triLaser": j_enemies_defense_enemies_triLaser,
      "shadowBat": j_enemies_defense_enemies_shadowBat,
      "wolf": j_enemies_defense_enemies_wolf,
      "multiBomber": j_enemies_defense_enemies_multiBomber,
      "spearman": j_enemies_defense_enemies_spearman,
      "hornBeetle": j_enemies_defense_enemies_hornBeetle,
      "netter": j_enemies_defense_enemies_netter,
      "carrionFly": j_enemies_defense_enemies_carrionFly,
      "thunderWisp": j_enemies_defense_enemies_thunderWisp,
      "skeleton": j_enemies_defense_enemies_skeleton,
      "fuseRat": j_enemies_defense_enemies_fuseRat,
      "crystalMite": j_enemies_defense_enemies_crystalMite,
      "echoStriker": j_enemies_defense_enemies_echoStriker,
      "packLeader": j_enemies_defense_enemies_packLeader,
      "manaLeech": j_enemies_defense_enemies_manaLeech,
      "scavenger": j_enemies_defense_enemies_scavenger,
      "graveBell": j_enemies_defense_enemies_graveBell,
      "silencer": j_enemies_defense_enemies_silencer,
      "frostCrusher": j_enemies_defense_enemies_frostCrusher,
      "twinShade": j_enemies_defense_enemies_twinShade,
      "mimic": j_enemies_defense_enemies_mimic,
      "hollowArmor": j_enemies_defense_enemies_hollowArmor,
      "hollowWraith": j_enemies_defense_enemies_hollowWraith,
      "boneConductor": j_enemies_defense_enemies_boneConductor,
      "twinBrother": j_enemies_defense_enemies_twinBrother,
      "twinSister": j_enemies_defense_enemies_twinSister,
      "frostGiant": j_enemies_defense_enemies_frostGiant,
      "icePillar": j_enemies_defense_enemies_icePillar,
      "trainingDummy": j_enemies_defense_enemies_trainingDummy,
      "mirrorSelf": j_enemies_defense_enemies_mirrorSelf,
      "mudman": j_enemies_defense_enemies_mudman,
      "toad": j_enemies_defense_enemies_toad,
      "oiler": j_enemies_defense_enemies_oiler,
      "flameEater": j_enemies_defense_enemies_flameEater,
      "windSprite": j_enemies_defense_enemies_windSprite,
      "mineLayer": j_enemies_defense_enemies_mineLayer,
      "enemyMine": j_enemies_defense_enemies_enemyMine,
      "bellImp": j_enemies_defense_enemies_bellImp,
      "bannerBearer": j_enemies_defense_enemies_bannerBearer,
      "banner": j_enemies_defense_enemies_banner,
      "burrower": j_enemies_defense_enemies_burrower,
      "dropper": j_enemies_defense_enemies_dropper,
      "absorber": j_enemies_defense_enemies_absorber,
      "homunculus": j_enemies_defense_enemies_homunculus,
      "scribeImp": j_enemies_defense_enemies_scribeImp,
      "crossGolem": j_enemies_defense_enemies_crossGolem,
      "chainWarden": j_enemies_defense_enemies_chainWarden,
      "hollow": j_enemies_defense_enemies_hollow,
      "lurker": j_enemies_defense_enemies_lurker,
      "iceBoar": j_enemies_defense_enemies_iceBoar,
      "sootBomber": j_enemies_defense_enemies_sootBomber,
      "mossGolem": j_enemies_defense_enemies_mossGolem,
      "swampWisp": j_enemies_defense_enemies_swampWisp,
      "frostToad": j_enemies_defense_enemies_frostToad,
      "magmaToad": j_enemies_defense_enemies_magmaToad,
      "oilSlime": j_enemies_defense_enemies_oilSlime,
      "stormEye": j_enemies_defense_enemies_stormEye,
      "emberRat": j_enemies_defense_enemies_emberRat,
      "giantToad": j_enemies_defense_enemies_giantToad,
      "forgeMaster": j_enemies_defense_enemies_forgeMaster,
      "anvil": j_enemies_defense_enemies_anvil,
      "turretMaster": j_enemies_defense_enemies_turretMaster,
      "turret": j_enemies_defense_enemies_turret,
      "basilisk": j_enemies_defense_enemies_basilisk,
      "shadowStalker": j_enemies_defense_enemies_shadowStalker,
      "oilKing": j_enemies_defense_enemies_oilKing,
      "broodMother": j_enemies_defense_enemies_broodMother,
      "broodEgg": j_enemies_defense_enemies_broodEgg,
      "librarian": j_enemies_defense_enemies_librarian,
      "mirrorKnight": j_enemies_defense_enemies_mirrorKnight,
      "thiefKing": j_enemies_defense_enemies_thiefKing,
      "thief": j_enemies_defense_enemies_thief,
      "mirrorImage": j_enemies_defense_enemies_mirrorImage,
      "reaperShade": j_enemies_defense_enemies_reaperShade,
      "merchant": j_enemies_defense_enemies_merchant,
      "pot": j_enemies_defense_enemies_pot,
      "crate": j_enemies_defense_enemies_crate,
    },
  },
  "ENEMY_SCALE": j_enemies_ENEMY_SCALE,
  "REACTION": j_enemies_REACTION,
};

export const feel = {
  "_note": j_feel__index["_note"],
  "FEEL": j_feel_FEEL,
  "EFFECTS": {
    "maxParticles": j_feel_EFFECTS__index["maxParticles"],
    "maxTexts": j_feel_EFFECTS__index["maxTexts"],
    "maxShapes": j_feel_EFFECTS__index["maxShapes"],
    "maxDeaths": j_feel_EFFECTS__index["maxDeaths"],
    "maxMarks": j_feel_EFFECTS__index["maxMarks"],
    "statusKindsPerEnemy": j_feel_EFFECTS__index["statusKindsPerEnemy"],
    "statusParticlesPerKind": j_feel_EFFECTS__index["statusParticlesPerKind"],
    "statusTintAlpha": j_feel_EFFECTS__index["statusTintAlpha"],
    "death": j_feel_EFFECTS_death,
    "hitSpark": j_feel_EFFECTS_hitSpark,
    "comboTiers": j_feel_EFFECTS_comboTiers,
    "comboMilestones": j_feel_EFFECTS_comboMilestones,
    "comboMilestoneScale": j_feel_EFFECTS__index["comboMilestoneScale"],
    "comboMilestoneLife": j_feel_EFFECTS__index["comboMilestoneLife"],
    "comboMilestoneRise": j_feel_EFFECTS__index["comboMilestoneRise"],
    "clearWave": j_feel_EFFECTS_clearWave,
    "eliteBurst": j_feel_EFFECTS_eliteBurst,
    "bossLight": j_feel_EFFECTS_bossLight,
    "justRing": j_feel_EFFECTS_justRing,
    "synergyGlow": j_feel_EFFECTS_synergyGlow,
    "weakCrack": j_feel_EFFECTS_weakCrack,
    "critFlash": j_feel_EFFECTS_critFlash,
    "doorSlam": j_feel_EFFECTS_doorSlam,
    "chargeUp": j_feel_EFFECTS_chargeUp,
    "dropBeam": j_feel_EFFECTS_dropBeam,
    "dashGhost": j_feel_EFFECTS_dashGhost,
    "floorCard": j_feel_EFFECTS_floorCard,
  },
  "MINIMAP": j_feel_MINIMAP,
  "FX_ATTACK": {
    "_note": j_feel_FX_ATTACK__index["_note"],
    "maxEvents": j_feel_FX_ATTACK__index["maxEvents"],
    "slash": j_feel_FX_ATTACK_slash,
    "hitSpark": j_feel_FX_ATTACK_hitSpark,
    "impact": j_feel_FX_ATTACK_impact,
    "muzzle": j_feel_FX_ATTACK_muzzle,
    "bullet": j_feel_FX_ATTACK_bullet,
    "blast": j_feel_FX_ATTACK_blast,
    "ring": j_feel_FX_ATTACK_ring,
    "bolt": j_feel_FX_ATTACK_bolt,
    "particle": j_feel_FX_ATTACK_particle,
    "sprite": j_feel_FX_ATTACK_sprite,
  },
  "MUSIC": j_feel_MUSIC,
  "FX_WAVE3": j_feel_FX_WAVE3,
  "SFX_WAVE3": j_feel_SFX_WAVE3,
  "TELEGRAPH": j_feel_TELEGRAPH,
};

export const jobs = {
  "_note": j_jobs__index["_note"],
  "JOB": j_jobs_JOB,
  "attributes": j_jobs_attributes,
  "DASH_FORM": j_jobs_DASH_FORM,
  "MANA_SOURCE": j_jobs_MANA_SOURCE,
};

export const loot = {
  "_note": j_loot__index["_note"],
  "_fields": j_loot__index["_fields"],
  "LOOT_DROP": j_loot_LOOT_DROP,
  "PICKUP": j_loot_PICKUP,
  "RESONANCE": j_loot_RESONANCE,
  "KEYSTONE": j_loot_KEYSTONE,
  "RELIC": j_loot_RELIC,
  "TRIGGER": j_loot_TRIGGER,
  "SYNERGY": j_loot_SYNERGY,
  "FLUX": j_loot_FLUX,
  "STASH_CAPACITY": j_loot__index["STASH_CAPACITY"],
  "ARMOR_K": j_loot__index["ARMOR_K"],
  "ARMOR_MAX_REDUCTION": j_loot__index["ARMOR_MAX_REDUCTION"],
  "affixCurves": {
    "damageVsStaggered": j_loot_affixCurves_damageVsStaggered,
    "armorFlat": j_loot_affixCurves_armorFlat,
    "comboDamage": j_loot_affixCurves_comboDamage,
    "justDodgeDamage": j_loot_affixCurves_justDodgeDamage,
    "burn": j_loot_affixCurves_burn,
    "chill": j_loot_affixCurves_chill,
    "shock": j_loot_affixCurves_shock,
    "explodeOnKill": j_loot_affixCurves_explodeOnKill,
    "energyReserve": j_loot_affixCurves_energyReserve,
    "procBleed": j_loot_affixCurves_procBleed,
    "procPoison": j_loot_affixCurves_procPoison,
    "procFear": j_loot_affixCurves_procFear,
    "bulletCut": j_loot_affixCurves_bulletCut,
    "manaOnStagger": j_loot_affixCurves_manaOnStagger,
    "fullTide": j_loot_affixCurves_fullTide,
    "manaShield": j_loot_affixCurves_manaShield,
    "manaOverflow": j_loot_affixCurves_manaOverflow,
    "justBreath": j_loot_affixCurves_justBreath,
    "kaleidoscope": j_loot_affixCurves_kaleidoscope,
    "fever": j_loot_affixCurves_fever,
    "plagueSeed": j_loot_affixCurves_plagueSeed,
    "rotBurst": j_loot_affixCurves_rotBurst,
    "wedge": j_loot_affixCurves_wedge,
    "guardPiercer": j_loot_affixCurves_guardPiercer,
    "staggerQuake": j_loot_affixCurves_staggerQuake,
    "staggerSpark": j_loot_affixCurves_staggerSpark,
    "staggerMark": j_loot_affixCurves_staggerMark,
    "readAhead": j_loot_affixCurves_readAhead,
    "counterWave": j_loot_affixCurves_counterWave,
    "guardedBane": j_loot_affixCurves_guardedBane,
    "downHunter": j_loot_affixCurves_downHunter,
    "lockdownFury": j_loot_affixCurves_lockdownFury,
    "sapling": j_loot_affixCurves_sapling,
    "oldScars": j_loot_affixCurves_oldScars,
    "veteran": j_loot_affixCurves_veteran,
    "echoSlash": j_loot_affixCurves_echoSlash,
    "inheritance": j_loot_affixCurves_inheritance,
    "stake": j_loot_affixCurves_stake,
    "placedInfuse": j_loot_affixCurves_placedInfuse,
    "bloodSignature": j_loot_affixCurves_bloodSignature,
    "firstMove": j_loot_affixCurves_firstMove,
    "curtainCall": j_loot_affixCurves_curtainCall,
    "prismEdge": j_loot_affixCurves_prismEdge,
    "backlash": j_loot_affixCurves_backlash,
    "conductor": j_loot_affixCurves_conductor,
    "elementalBreak": j_loot_affixCurves_elementalBreak,
    "chargeCore": j_loot_affixCurves_chargeCore,
    "branchArt": j_loot_affixCurves_branchArt,
    "rapidBrand": j_loot_affixCurves_rapidBrand,
    "brandDetonator": j_loot_affixCurves_brandDetonator,
    "groundRooted": j_loot_affixCurves_groundRooted,
    "terrainHunter": j_loot_affixCurves_terrainHunter,
    "terrainBurst": j_loot_affixCurves_terrainBurst,
    "emberTrail": j_loot_affixCurves_emberTrail,
    "frostTrail": j_loot_affixCurves_frostTrail,
    "groundMend": j_loot_affixCurves_groundMend,
    "siegeGuard": j_loot_affixCurves_siegeGuard,
    "switchBreath": j_loot_affixCurves_switchBreath,
    "cv_chargesToDistance": j_loot_affixCurves_cv_chargesToDistance,
    "cv_projectilesToPoise": j_loot_affixCurves_cv_projectilesToPoise,
    "attr_str": j_loot_affixCurves_attr_str,
    "attr_dex": j_loot_affixCurves_attr_dex,
    "attr_vit": j_loot_affixCurves_attr_vit,
    "attr_mnd": j_loot_affixCurves_attr_mnd,
    "attr_spi": j_loot_affixCurves_attr_spi,
    "res_fire": j_loot_affixCurves_res_fire,
    "res_ice": j_loot_affixCurves_res_ice,
    "res_lightning": j_loot_affixCurves_res_lightning,
    "res_poison": j_loot_affixCurves_res_poison,
    "res_dark": j_loot_affixCurves_res_dark,
    "res_light": j_loot_affixCurves_res_light,
    "cv_infuseFire": j_loot_affixCurves_cv_infuseFire,
    "cv_infuseIce": j_loot_affixCurves_cv_infuseIce,
    "cv_infuseLightning": j_loot_affixCurves_cv_infuseLightning,
    "cv_infusePoison": j_loot_affixCurves_cv_infusePoison,
    "cv_infuseDark": j_loot_affixCurves_cv_infuseDark,
    "cv_infuseLight": j_loot_affixCurves_cv_infuseLight,
    "attr_def": j_loot_affixCurves_attr_def,
    "purse": j_loot_affixCurves_purse,
    "desperation": j_loot_affixCurves_desperation,
    "moraleSurge": j_loot_affixCurves_moraleSurge,
    "finisherEdge": j_loot_affixCurves_finisherEdge,
    "releaseEdge": j_loot_affixCurves_releaseEdge,
    "riposteEdge": j_loot_affixCurves_riposteEdge,
    "twinEdge": j_loot_affixCurves_twinEdge,
    "firstStrikeEdge": j_loot_affixCurves_firstStrikeEdge,
    "stanceGuard": j_loot_affixCurves_stanceGuard,
    "unmoving": j_loot_affixCurves_unmoving,
    "chainSource": j_loot_affixCurves_chainSource,
    "chainReturn": j_loot_affixCurves_chainReturn,
    "moraleCap": j_loot_affixCurves_moraleCap,
    "burnStack": j_loot_affixCurves_burnStack,
    "cv_critToChain": j_loot_affixCurves_cv_critToChain,
    "cv_speedToDamage": j_loot_affixCurves_cv_speedToDamage,
    "cv_manaToProjectiles": j_loot_affixCurves_cv_manaToProjectiles,
    "cv_armorToPoise": j_loot_affixCurves_cv_armorToPoise,
    "cv_lifeToArea": j_loot_affixCurves_cv_lifeToArea,
    "cv_comboToFinisher": j_loot_affixCurves_cv_comboToFinisher,
    "cv_coinsToMore": j_loot_affixCurves_cv_coinsToMore,
    "cv_critToLightning": j_loot_affixCurves_cv_critToLightning,
    "cv_critToCoins": j_loot_affixCurves_cv_critToCoins,
    "cv_critToMorale": j_loot_affixCurves_cv_critToMorale,
  },
  "bases": j_loot_bases,
  "INNATE": {
    "_note": j_loot_INNATE__index["_note"],
    "_fields": j_loot_INNATE__index["_fields"],
    "budget": j_loot_INNATE_budget,
    "depthScale": j_loot_INNATE_depthScale,
    "maxLines": j_loot_INNATE_maxLines,
    "extraLineChance": j_loot_INNATE__index["extraLineChance"],
    "linesPerPoint": j_loot_INNATE__index["linesPerPoint"],
    "pointValue": j_loot_INNATE_pointValue,
    "armor": j_loot_INNATE_armor,
    "leanWeight": j_loot_INNATE__index["leanWeight"],
    "resistWeight": j_loot_INNATE__index["resistWeight"],
    "resistLines": j_loot_INNATE_resistLines,
    "slotLean": j_loot_INNATE_slotLean,
    "weaponLeanTop": j_loot_INNATE__index["weaponLeanTop"],
  },
};

export const skills = {
  "_note": j_skills__index["_note"],
  "SKILL": {
    "_fields": j_skills_SKILL__index["_fields"],
    "slots": j_skills_SKILL__index["slots"],
    "slotLinks": j_skills_SKILL__index["slotLinks"],
    "manaFlashTime": j_skills_SKILL__index["manaFlashTime"],
    "variantCountWeights": j_skills_SKILL__index["variantCountWeights"],
    "variantPrecision": j_skills_SKILL__index["variantPrecision"],
    "inputBuffer": j_skills_SKILL__index["inputBuffer"],
    "notReadyTextInterval": j_skills_SKILL__index["notReadyTextInterval"],
    "stashCapacity": j_skills_SKILL__index["stashCapacity"],
    "defaultCastRange": j_skills_SKILL__index["defaultCastRange"],
    "whirl": j_skills_SKILL_whirl,
    "lunge": j_skills_SKILL_lunge,
    "frag": j_skills_SKILL_frag,
    "railshot": j_skills_SKILL_railshot,
    "parry": j_skills_SKILL_parry,
    "bloodPact": j_skills_SKILL_bloodPact,
    "quake": j_skills_SKILL_quake,
    "thunder": j_skills_SKILL_thunder,
    "gravityWell": j_skills_SKILL_gravityWell,
    "mines": j_skills_SKILL_mines,
    "haste": j_skills_SKILL_haste,
    "chainHook": j_skills_SKILL_chainHook,
    "spiral": j_skills_SKILL_spiral,
    "frostField": j_skills_SKILL_frostField,
    "modifier": j_skills_SKILL_modifier,
    "drop": j_skills_SKILL_drop,
  },
  "EXTRA_SKILL_TUNING": {
    "_note": j_skills_EXTRA_SKILL_TUNING__index["_note"],
    "_fields": j_skills_EXTRA_SKILL_TUNING__index["_fields"],
    "contagion": j_skills_EXTRA_SKILL_TUNING_contagion,
    "unravel": j_skills_EXTRA_SKILL_TUNING_unravel,
    "kindle": j_skills_EXTRA_SKILL_TUNING_kindle,
    "prismShard": j_skills_EXTRA_SKILL_TUNING_prismShard,
    "fullMoon": j_skills_EXTRA_SKILL_TUNING_fullMoon,
    "dregsBlade": j_skills_EXTRA_SKILL_TUNING_dregsBlade,
    "shadowStep": j_skills_EXTRA_SKILL_TUNING_shadowStep,
    "powderKeg": j_skills_EXTRA_SKILL_TUNING_powderKeg,
    "swordGrave": j_skills_EXTRA_SKILL_TUNING_swordGrave,
    "iceBreaker": j_skills_EXTRA_SKILL_TUNING_iceBreaker,
    "bloodlet": j_skills_EXTRA_SKILL_TUNING_bloodlet,
    "harvest": j_skills_EXTRA_SKILL_TUNING_harvest,
    "discharge": j_skills_EXTRA_SKILL_TUNING_discharge,
    "rout": j_skills_EXTRA_SKILL_TUNING_rout,
    "verdict": j_skills_EXTRA_SKILL_TUNING_verdict,
    "exploit": j_skills_EXTRA_SKILL_TUNING_exploit,
    "strip": j_skills_EXTRA_SKILL_TUNING_strip,
    "lastStand": j_skills_EXTRA_SKILL_TUNING_lastStand,
    "comboChain": j_skills_EXTRA_SKILL_TUNING_comboChain,
    "grudge": j_skills_EXTRA_SKILL_TUNING_grudge,
    "guillotine": j_skills_EXTRA_SKILL_TUNING_guillotine,
    "ricochet": j_skills_EXTRA_SKILL_TUNING_ricochet,
    "galeSlash": j_skills_EXTRA_SKILL_TUNING_galeSlash,
    "scatterSigil": j_skills_EXTRA_SKILL_TUNING_scatterSigil,
    "stomp": j_skills_EXTRA_SKILL_TUNING_stomp,
    "threadReel": j_skills_EXTRA_SKILL_TUNING_threadReel,
    "meteorDive": j_skills_EXTRA_SKILL_TUNING_meteorDive,
    "swallowFlip": j_skills_EXTRA_SKILL_TUNING_swallowFlip,
    "boneRing": j_skills_EXTRA_SKILL_TUNING_boneRing,
    "backflow": j_skills_EXTRA_SKILL_TUNING_backflow,
    "scarRoar": j_skills_EXTRA_SKILL_TUNING_scarRoar,
    "manaSpring": j_skills_EXTRA_SKILL_TUNING_manaSpring,
    "turret": j_skills_EXTRA_SKILL_TUNING_turret,
  },
  "EXTRA_MODIFIER_TUNING": j_skills_EXTRA_MODIFIER_TUNING,
  "COMBO_TUNING": j_skills_COMBO_TUNING,
  "WAVE2_SKILL_TUNING": {
    "_note": j_skills_WAVE2_SKILL_TUNING__index["_note"],
    "waterJar": j_skills_WAVE2_SKILL_TUNING_waterJar,
    "oilPot": j_skills_WAVE2_SKILL_TUNING_oilPot,
    "scorchLine": j_skills_WAVE2_SKILL_TUNING_scorchLine,
    "iceSlide": j_skills_WAVE2_SKILL_TUNING_iceSlide,
    "levelGround": j_skills_WAVE2_SKILL_TUNING_levelGround,
    "emberDraw": j_skills_WAVE2_SKILL_TUNING_emberDraw,
    "bogCall": j_skills_WAVE2_SKILL_TUNING_bogCall,
    "brandSear": j_skills_WAVE2_SKILL_TUNING_brandSear,
    "brandBlast": j_skills_WAVE2_SKILL_TUNING_brandBlast,
    "breakKick": j_skills_WAVE2_SKILL_TUNING_breakKick,
    "collapseHammer": j_skills_WAVE2_SKILL_TUNING_collapseHammer,
    "tideSlash": j_skills_WAVE2_SKILL_TUNING_tideSlash,
    "flashFreeze": j_skills_WAVE2_SKILL_TUNING_flashFreeze,
    "hueEtch": j_skills_WAVE2_SKILL_TUNING_hueEtch,
    "hueRelease": j_skills_WAVE2_SKILL_TUNING_hueRelease,
    "siphonMark": j_skills_WAVE2_SKILL_TUNING_siphonMark,
    "doomSentence": j_skills_WAVE2_SKILL_TUNING_doomSentence,
    "shiftingEdge": j_skills_WAVE2_SKILL_TUNING_shiftingEdge,
    "weaponArt": j_skills_WAVE2_SKILL_TUNING_weaponArt,
    "titanForm": j_skills_WAVE2_SKILL_TUNING_titanForm,
    "swiftForm": j_skills_WAVE2_SKILL_TUNING_swiftForm,
    "spiritForm": j_skills_WAVE2_SKILL_TUNING_spiritForm,
    "wardStake": j_skills_WAVE2_SKILL_TUNING_wardStake,
    "mire": j_skills_WAVE2_SKILL_TUNING_mire,
  },
  "WAVE2_MODIFIER_TUNING": j_skills_WAVE2_MODIFIER_TUNING,
  "WAVE2_COMBO_TUNING": j_skills_WAVE2_COMBO_TUNING,
  "WEAR_TUNING": j_skills_WEAR_TUNING,
  "FORM_TUNING": j_skills_FORM_TUNING,
  "WAVE3_SKILL_TUNING": j_skills_WAVE3_SKILL_TUNING,
  "SHAPE_TUNING": j_skills_SHAPE_TUNING,
  "ART": {
    "_note": j_skills_ART__index["_note"],
    "_fields": j_skills_ART__index["_fields"],
    "weight": j_skills_ART__index["weight"],
    "common": j_skills_ART_common,
    "TRANSFORM": {
      "_note": j_skills_ART_TRANSFORM__index["_note"],
      "_fields": j_skills_ART_TRANSFORM__index["_fields"],
      "flurry": j_skills_ART_TRANSFORM_flurry,
      "crusher": j_skills_ART_TRANSFORM_crusher,
      "hewer": j_skills_ART_TRANSFORM_hewer,
      "polearm": j_skills_ART_TRANSFORM_polearm,
      "chain": j_skills_ART_TRANSFORM_chain,
      "bulwark": j_skills_ART_TRANSFORM_bulwark,
      "warfan": j_skills_ART_TRANSFORM_warfan,
      "rod": j_skills_ART_TRANSFORM_rod,
      "thrower": j_skills_ART_TRANSFORM_thrower,
      "pistol": j_skills_ART_TRANSFORM_pistol,
      "rifle": j_skills_ART_TRANSFORM_rifle,
      "artillery": j_skills_ART_TRANSFORM_artillery,
      "bell": j_skills_ART_TRANSFORM_bell,
    },
  },
};

export const ultimates = {
  "_note": j_ultimates__index["_note"],
  "ULTIMATE": {
    "_fields": j_ultimates_ULTIMATE__index["_fields"],
    "common": j_ultimates_ULTIMATE_common,
    "defs": {
      "sword": j_ultimates_ULTIMATE_defs_sword,
      "greatsword": j_ultimates_ULTIMATE_defs_greatsword,
      "twinBlades": j_ultimates_ULTIMATE_defs_twinBlades,
      "spear": j_ultimates_ULTIMATE_defs_spear,
      "scythe": j_ultimates_ULTIMATE_defs_scythe,
      "fists": j_ultimates_ULTIMATE_defs_fists,
      "whip": j_ultimates_ULTIMATE_defs_whip,
      "cleaver": j_ultimates_ULTIMATE_defs_cleaver,
      "staff": j_ultimates_ULTIMATE_defs_staff,
      "wand": j_ultimates_ULTIMATE_defs_wand,
      "katana": j_ultimates_ULTIMATE_defs_katana,
      "axe": j_ultimates_ULTIMATE_defs_axe,
      "shield": j_ultimates_ULTIMATE_defs_shield,
      "chainSickle": j_ultimates_ULTIMATE_defs_chainSickle,
      "hammer": j_ultimates_ULTIMATE_defs_hammer,
      "gunner": j_ultimates_ULTIMATE_defs_gunner,
      "sidearm": j_ultimates_ULTIMATE_defs_sidearm,
      "longarm": j_ultimates_ULTIMATE_defs_longarm,
      "cannon": j_ultimates_ULTIMATE_defs_cannon,
      "thrown": j_ultimates_ULTIMATE_defs_thrown,
      "grenade": j_ultimates_ULTIMATE_defs_grenade,
      "trapper": j_ultimates_ULTIMATE_defs_trapper,
      "warRing": j_ultimates_ULTIMATE_defs_warRing,
      "claws": j_ultimates_ULTIMATE_defs_claws,
      "flail": j_ultimates_ULTIMATE_defs_flail,
      "ringBlades": j_ultimates_ULTIMATE_defs_ringBlades,
      "fan": j_ultimates_ULTIMATE_defs_fan,
      "book": j_ultimates_ULTIMATE_defs_book,
      "handbell": j_ultimates_ULTIMATE_defs_handbell,
    },
  },
};

export const weapons = {
  "_note": j_weapons__index["_note"],
  "WEAPON": {
    "_fields": j_weapons_WEAPON__index["_fields"],
    "chargeRingColors": j_weapons_WEAPON__index["chargeRingColors"],
    "chargeRingRadius": j_weapons_WEAPON__index["chargeRingRadius"],
    "chargeRingStep": j_weapons_WEAPON__index["chargeRingStep"],
    "chainWindow": j_weapons_WEAPON__index["chainWindow"],
    "chainMaxInputs": j_weapons_WEAPON__index["chainMaxInputs"],
    "trailLife": j_weapons_WEAPON__index["trailLife"],
    "movesets": {
      "sword": j_weapons_WEAPON_movesets_sword,
      "greatsword": j_weapons_WEAPON_movesets_greatsword,
      "twinBlades": j_weapons_WEAPON_movesets_twinBlades,
      "spear": j_weapons_WEAPON_movesets_spear,
      "scythe": j_weapons_WEAPON_movesets_scythe,
      "fists": j_weapons_WEAPON_movesets_fists,
      "whip": j_weapons_WEAPON_movesets_whip,
      "cleaver": j_weapons_WEAPON_movesets_cleaver,
      "staff": j_weapons_WEAPON_movesets_staff,
      "wand": j_weapons_WEAPON_movesets_wand,
      "katana": j_weapons_WEAPON_movesets_katana,
      "axe": j_weapons_WEAPON_movesets_axe,
      "shield": j_weapons_WEAPON_movesets_shield,
      "chainSickle": j_weapons_WEAPON_movesets_chainSickle,
      "hammer": j_weapons_WEAPON_movesets_hammer,
      "gunner": j_weapons_WEAPON_movesets_gunner,
      "sidearm": j_weapons_WEAPON_movesets_sidearm,
      "longarm": j_weapons_WEAPON_movesets_longarm,
      "cannon": j_weapons_WEAPON_movesets_cannon,
      "thrown": j_weapons_WEAPON_movesets_thrown,
      "grenade": j_weapons_WEAPON_movesets_grenade,
      "trapper": j_weapons_WEAPON_movesets_trapper,
      "warRing": j_weapons_WEAPON_movesets_warRing,
      "claws": j_weapons_WEAPON_movesets_claws,
      "flail": j_weapons_WEAPON_movesets_flail,
      "ringBlades": j_weapons_WEAPON_movesets_ringBlades,
      "fan": j_weapons_WEAPON_movesets_fan,
      "book": j_weapons_WEAPON_movesets_book,
      "handbell": j_weapons_WEAPON_movesets_handbell,
    },
    "artDefaults": j_weapons_WEAPON_artDefaults,
    "movesetRules": j_weapons_WEAPON_movesetRules,
    "jobBranches": j_weapons_WEAPON_jobBranches,
    "bullets": j_weapons_WEAPON_bullets,
    "meleeDamageScale": j_weapons_WEAPON__index["meleeDamageScale"],
    "unarmed": j_weapons_WEAPON_unarmed,
    "weightClass": j_weapons_WEAPON_weightClass,
  },
  "PLAYER_MELEE": j_weapons_PLAYER_MELEE,
  "ACTION_DASH_ATTACK": j_weapons_ACTION_DASH_ATTACK,
  "FORM": {
    "_note": j_weapons_FORM__index["_note"],
    "_fields": j_weapons_FORM__index["_fields"],
    "blade": j_weapons_FORM_blade,
    "flurry": j_weapons_FORM_flurry,
    "crusher": j_weapons_FORM_crusher,
    "hewer": j_weapons_FORM_hewer,
    "polearm": j_weapons_FORM_polearm,
    "chain": j_weapons_FORM_chain,
    "bulwark": j_weapons_FORM_bulwark,
    "warfan": j_weapons_FORM_warfan,
    "rod": j_weapons_FORM_rod,
    "thrower": j_weapons_FORM_thrower,
    "pistol": j_weapons_FORM_pistol,
    "rifle": j_weapons_FORM_rifle,
    "artillery": j_weapons_FORM_artillery,
    "tome": j_weapons_FORM_tome,
    "bell": j_weapons_FORM_bell,
  },
  "MOMENT": j_weapons_MOMENT,
  "REFORGE": {
    "_note": j_weapons_REFORGE__index["_note"],
    "_fields": j_weapons_REFORGE__index["_fields"],
    "perRun": j_weapons_REFORGE__index["perRun"],
    "offerCount": j_weapons_REFORGE__index["offerCount"],
    "inputDelay": j_weapons_REFORGE__index["inputDelay"],
    "textColor": j_weapons_REFORGE__index["textColor"],
    "blade": j_weapons_REFORGE_blade,
    "flurry": j_weapons_REFORGE_flurry,
    "crusher": j_weapons_REFORGE_crusher,
    "hewer": j_weapons_REFORGE_hewer,
    "polearm": j_weapons_REFORGE_polearm,
    "chain": j_weapons_REFORGE_chain,
    "bulwark": j_weapons_REFORGE_bulwark,
    "warfan": j_weapons_REFORGE_warfan,
    "rod": j_weapons_REFORGE_rod,
    "thrower": j_weapons_REFORGE_thrower,
    "pistol": j_weapons_REFORGE_pistol,
    "rifle": j_weapons_REFORGE_rifle,
    "artillery": j_weapons_REFORGE_artillery,
    "tome": j_weapons_REFORGE_tome,
    "bell": j_weapons_REFORGE_bell,
  },
};

export const world = {
  "_note": j_world__index["_note"],
  "ROOM": j_world_ROOM,
  "ROOM_KIND": {
    "treasureChance": j_world_ROOM_KIND__index["treasureChance"],
    "treasureItemsMin": j_world_ROOM_KIND__index["treasureItemsMin"],
    "treasureItemsMax": j_world_ROOM_KIND__index["treasureItemsMax"],
    "treasureRarityBoost": j_world_ROOM_KIND__index["treasureRarityBoost"],
    "treasureItemSpread": j_world_ROOM_KIND__index["treasureItemSpread"],
    "treasureCoinParticles": j_world_ROOM_KIND__index["treasureCoinParticles"],
    "treasureCoinColor": j_world_ROOM_KIND__index["treasureCoinColor"],
    "challengeMinDepth": j_world_ROOM_KIND__index["challengeMinDepth"],
    "challengeChance": j_world_ROOM_KIND__index["challengeChance"],
    "challengeWaves": j_world_ROOM_KIND__index["challengeWaves"],
    "challengeWaveMul": j_world_ROOM_KIND__index["challengeWaveMul"],
    "challengeRareBoost": j_world_ROOM_KIND__index["challengeRareBoost"],
    "challengeRareAttempts": j_world_ROOM_KIND__index["challengeRareAttempts"],
    "challengeColor": j_world_ROOM_KIND__index["challengeColor"],
    "fountainRadius": j_world_ROOM_KIND__index["fountainRadius"],
    "shrineColor": j_world_ROOM_KIND__index["shrineColor"],
    "cursedEliteRolls": j_world_ROOM_KIND__index["cursedEliteRolls"],
    "cursedColor": j_world_ROOM_KIND__index["cursedColor"],
    "ambushMinDepth": j_world_ROOM_KIND__index["ambushMinDepth"],
    "ambushChance": j_world_ROOM_KIND__index["ambushChance"],
    "ambushMax": j_world_ROOM_KIND__index["ambushMax"],
    "ambushEnemyMul": j_world_ROOM_KIND__index["ambushEnemyMul"],
    "extraMax": j_world_ROOM_KIND__index["extraMax"],
    "extra": j_world_ROOM_KIND_extra,
    "propRadius": j_world_ROOM_KIND__index["propRadius"],
    "propSpacing": j_world_ROOM_KIND__index["propSpacing"],
    "propLabelRange": j_world_ROOM_KIND__index["propLabelRange"],
    "altarColor": j_world_ROOM_KIND__index["altarColor"],
    "libraryColor": j_world_ROOM_KIND__index["libraryColor"],
    "arenaWaves": j_world_ROOM_KIND__index["arenaWaves"],
    "arenaWaveMul": j_world_ROOM_KIND__index["arenaWaveMul"],
    "arenaColor": j_world_ROOM_KIND__index["arenaColor"],
    "gambleCoinCost": j_world_ROOM_KIND__index["gambleCoinCost"],
    "gambleCoinWinMul": j_world_ROOM_KIND__index["gambleCoinWinMul"],
    "gambleUses": j_world_ROOM_KIND__index["gambleUses"],
    "gambleColor": j_world_ROOM_KIND__index["gambleColor"],
    "gambleWeights": j_world_ROOM_KIND_gambleWeights,
    "gambleRarityBoost": j_world_ROOM_KIND__index["gambleRarityBoost"],
    "gambleHearts": j_world_ROOM_KIND__index["gambleHearts"],
    "forgeEchoes": j_world_ROOM_KIND__index["forgeEchoes"],
    "forgeBurnDuration": j_world_ROOM_KIND__index["forgeBurnDuration"],
    "forgeBurnDps": j_world_ROOM_KIND__index["forgeBurnDps"],
    "forgeColor": j_world_ROOM_KIND__index["forgeColor"],
    "exchangeItems": j_world_ROOM_KIND__index["exchangeItems"],
    "exchangeMul": j_world_ROOM_KIND__index["exchangeMul"],
    "exchangeColor": j_world_ROOM_KIND__index["exchangeColor"],
    "curseShrineColor": j_world_ROOM_KIND__index["curseShrineColor"],
    "resonanceBonusDrops": j_world_ROOM_KIND__index["resonanceBonusDrops"],
    "escortHpMul": j_world_ROOM_KIND__index["escortHpMul"],
    "escortRadius": j_world_ROOM_KIND__index["escortRadius"],
    "escortDps": j_world_ROOM_KIND__index["escortDps"],
    "escortColor": j_world_ROOM_KIND__index["escortColor"],
    "escapeSpeed": j_world_ROOM_KIND__index["escapeSpeed"],
    "escapeLavaTime": j_world_ROOM_KIND__index["escapeLavaTime"],
    "escapeTickInterval": j_world_ROOM_KIND__index["escapeTickInterval"],
    "escapeColor": j_world_ROOM_KIND__index["escapeColor"],
    "reaperNestDepthBonus": j_world_ROOM_KIND__index["reaperNestDepthBonus"],
    "nestHpMul": j_world_ROOM_KIND__index["nestHpMul"],
    "nestElites": j_world_ROOM_KIND__index["nestElites"],
    "nestColor": j_world_ROOM_KIND__index["nestColor"],
    "mirrorHpMul": j_world_ROOM_KIND__index["mirrorHpMul"],
    "mirrorBoonsPerElite": j_world_ROOM_KIND__index["mirrorBoonsPerElite"],
    "mirrorEliteMax": j_world_ROOM_KIND__index["mirrorEliteMax"],
    "mirrorColor": j_world_ROOM_KIND__index["mirrorColor"],
    "watchtowerReaperCost": j_world_ROOM_KIND__index["watchtowerReaperCost"],
    "watchtowerColor": j_world_ROOM_KIND__index["watchtowerColor"],
    "vaultCoinCost": j_world_ROOM_KIND__index["vaultCoinCost"],
    "vaultDrops": j_world_ROOM_KIND__index["vaultDrops"],
    "vaultColor": j_world_ROOM_KIND__index["vaultColor"],
    "elementAltarChoices": j_world_ROOM_KIND__index["elementAltarChoices"],
    "elementAltarShare": j_world_ROOM_KIND__index["elementAltarShare"],
    "elementAltarColor": j_world_ROOM_KIND__index["elementAltarColor"],
    "dummyCount": j_world_ROOM_KIND__index["dummyCount"],
    "dummySpacing": j_world_ROOM_KIND__index["dummySpacing"],
    "dummyColor": j_world_ROOM_KIND__index["dummyColor"],
    "fogRoomRadius": j_world_ROOM_KIND__index["fogRoomRadius"],
    "fogRoomColor": j_world_ROOM_KIND__index["fogRoomColor"],
    "tideRoomSpeed": j_world_ROOM_KIND__index["tideRoomSpeed"],
    "tideRoomInterval": j_world_ROOM_KIND__index["tideRoomInterval"],
    "tideRoomWaterTime": j_world_ROOM_KIND__index["tideRoomWaterTime"],
    "tideRoomColor": j_world_ROOM_KIND__index["tideRoomColor"],
    "invertHallItems": j_world_ROOM_KIND__index["invertHallItems"],
    "invertHallAttempts": j_world_ROOM_KIND__index["invertHallAttempts"],
    "invertHallColor": j_world_ROOM_KIND__index["invertHallColor"],
    "hordeMinDepth": j_world_ROOM_KIND__index["hordeMinDepth"],
    "hordeSecondDepth": j_world_ROOM_KIND__index["hordeSecondDepth"],
    "hordeChance": j_world_ROOM_KIND__index["hordeChance"],
    "hordeMinTiles": j_world_ROOM_KIND__index["hordeMinTiles"],
    "hordeWaves": j_world_ROOM_KIND__index["hordeWaves"],
    "hordeWaveMul": j_world_ROOM_KIND__index["hordeWaveMul"],
    "hordeColor": j_world_ROOM_KIND__index["hordeColor"],
    "locks": j_world_ROOM_KIND_locks,
  },
  "FLOOR_KIND": j_world_FLOOR_KIND,
  "CAVE": j_world_CAVE,
  "ROAM": j_world_ROAM,
  "RUN_EVENT": {
    "minDepth": j_world_RUN_EVENT__index["minDepth"],
    "warnTime": j_world_RUN_EVENT__index["warnTime"],
    "cooldown": j_world_RUN_EVENT__index["cooldown"],
    "lockChance": j_world_RUN_EVENT_lockChance,
    "floorChance": j_world_RUN_EVENT_floorChance,
    "fogBiomeChance": j_world_RUN_EVENT__index["fogBiomeChance"],
    "timedAfter": j_world_RUN_EVENT__index["timedAfter"],
    "checkInterval": j_world_RUN_EVENT__index["checkInterval"],
    "timedChance": j_world_RUN_EVENT_timedChance,
    "clearChance": j_world_RUN_EVENT_clearChance,
    "reinforceMul": j_world_RUN_EVENT__index["reinforceMul"],
    "reinforceBonusTime": j_world_RUN_EVENT__index["reinforceBonusTime"],
    "bountyScore": j_world_RUN_EVENT__index["bountyScore"],
    "blackoutMax": j_world_RUN_EVENT__index["blackoutMax"],
    "quake": j_world_RUN_EVENT_quake,
    "meteor": j_world_RUN_EVENT_meteor,
    "impactEnemyMul": j_world_RUN_EVENT__index["impactEnemyMul"],
    "rainItems": j_world_RUN_EVENT__index["rainItems"],
    "rainHearts": j_world_RUN_EVENT__index["rainHearts"],
    "rainSpread": j_world_RUN_EVENT__index["rainSpread"],
    "rainRarityBoost": j_world_RUN_EVENT__index["rainRarityBoost"],
    "manaDrainPerSec": j_world_RUN_EVENT__index["manaDrainPerSec"],
    "riftTime": j_world_RUN_EVENT__index["riftTime"],
    "riftRadius": j_world_RUN_EVENT__index["riftRadius"],
    "riftFreeze": j_world_RUN_EVENT__index["riftFreeze"],
    "fogDuration": j_world_RUN_EVENT__index["fogDuration"],
    "fogRadius": j_world_RUN_EVENT__index["fogRadius"],
    "curseWindShow": j_world_RUN_EVENT__index["curseWindShow"],
    "bloodMoonHeal": j_world_RUN_EVENT__index["bloodMoonHeal"],
    "bloodMoonHpMul": j_world_RUN_EVENT__index["bloodMoonHpMul"],
    "shrinkHpMul": j_world_RUN_EVENT__index["shrinkHpMul"],
    "shrinkExtraMul": j_world_RUN_EVENT__index["shrinkExtraMul"],
    "momentumWindow": j_world_RUN_EVENT__index["momentumWindow"],
    "momentumSpeedMul": j_world_RUN_EVENT__index["momentumSpeedMul"],
    "momentumSpeedTime": j_world_RUN_EVENT__index["momentumSpeedTime"],
    "warnColor": j_world_RUN_EVENT__index["warnColor"],
    "activeColor": j_world_RUN_EVENT__index["activeColor"],
    "impactColor": j_world_RUN_EVENT__index["impactColor"],
    "sluggish": j_world_RUN_EVENT_sluggish,
    "flood": j_world_RUN_EVENT_flood,
    "duel": j_world_RUN_EVENT_duel,
    "silenceTime": j_world_RUN_EVENT__index["silenceTime"],
    "surge": j_world_RUN_EVENT_surge,
    "thunder": j_world_RUN_EVENT_thunder,
    "curseVoiceCombo": j_world_RUN_EVENT__index["curseVoiceCombo"],
    "elementStormShare": j_world_RUN_EVENT__index["elementStormShare"],
    "reaperPass": j_world_RUN_EVENT_reaperPass,
    "lifeFlow": j_world_RUN_EVENT_lifeFlow,
    "bats": j_world_RUN_EVENT_bats,
    "vein": j_world_RUN_EVENT_vein,
    "thief": j_world_RUN_EVENT_thief,
  },
  "LINGER": j_world_LINGER,
  "ORIGIN": j_world_ORIGIN,
  "CONTRACT": j_world_CONTRACT,
  "RUN_MOD": j_world_RUN_MOD,
  "HUB": j_world_HUB,
  "HUB_DECOR": j_world_HUB_DECOR,
  "META": j_world_META,
  "DISCOVERY": j_world_DISCOVERY,
  "MAP_SIZE": j_world_MAP_SIZE,
  "HIDDEN_ROOM": j_world_HIDDEN_ROOM,
  "ECONOMY": {
    "_note": j_world_ECONOMY__index["_note"],
    "_fields": j_world_ECONOMY__index["_fields"],
    "chapterMul": j_world_ECONOMY__index["chapterMul"],
    "coin": j_world_ECONOMY_coin,
    "container": j_world_ECONOMY_container,
    "income": j_world_ECONOMY_income,
    "spill": j_world_ECONOMY_spill,
    "key": j_world_ECONOMY_key,
    "flask": j_world_ECONOMY_flask,
    "market": j_world_ECONOMY_market,
    "price": j_world_ECONOMY_price,
    "donation": j_world_ECONOMY_donation,
    "bet": j_world_ECONOMY_bet,
    "build": j_world_ECONOMY_build,
  },
  "ARC": j_world_ARC,
  "EXIT": j_world_EXIT,
};

/** 組み立てに使った JSON（src/data/balance からの相対。_index.json を含む）。生成し忘れの検査に使う */
export const BALANCE_SOURCE_FILES: readonly string[] = [
  "boons/BOON.json",
  "boons/LINEAGE/_index.json",
  "boons/LINEAGE/ash.json",
  "boons/LINEAGE/blade.json",
  "boons/LINEAGE/cursed.json",
  "boons/LINEAGE/cycle.json",
  "boons/LINEAGE/earth.json",
  "boons/LINEAGE/frost.json",
  "boons/LINEAGE/fusion.json",
  "boons/LINEAGE/horde.json",
  "boons/LINEAGE/moon.json",
  "boons/LINEAGE/thunder.json",
  "boons/LINEAGE/wealth.json",
  "boons/_index.json",
  "combat/ACTION.json",
  "combat/ATTR.json",
  "combat/ATTR_GAIN.json",
  "combat/BLAST_FALLOFF.json",
  "combat/ELEMENT.json",
  "combat/ENERGY.json",
  "combat/GENRE.json",
  "combat/HEAL.json",
  "combat/MANA.json",
  "combat/PARRY.json",
  "combat/PLAYER.json",
  "combat/POISE.json",
  "combat/STATUS/_index.json",
  "combat/STATUS/blaze.json",
  "combat/STATUS/bleed.json",
  "combat/STATUS/brand.json",
  "combat/STATUS/broken.json",
  "combat/STATUS/cauterize.json",
  "combat/STATUS/charged.json",
  "combat/STATUS/chill.json",
  "combat/STATUS/conduct.json",
  "combat/STATUS/corrode.json",
  "combat/STATUS/doom.json",
  "combat/STATUS/encase.json",
  "combat/STATUS/enfeeble.json",
  "combat/STATUS/exposed.json",
  "combat/STATUS/fear.json",
  "combat/STATUS/freeze.json",
  "combat/STATUS/fury.json",
  "combat/STATUS/harden.json",
  "combat/STATUS/haste.json",
  "combat/STATUS/hemorrhage.json",
  "combat/STATUS/hue.json",
  "combat/STATUS/kindle.json",
  "combat/STATUS/lacerate.json",
  "combat/STATUS/miasma.json",
  "combat/STATUS/oiled.json",
  "combat/STATUS/panic.json",
  "combat/STATUS/paralyze.json",
  "combat/STATUS/poison.json",
  "combat/STATUS/quench.json",
  "combat/STATUS/scorch.json",
  "combat/STATUS/shatterBleed.json",
  "combat/STATUS/shock.json",
  "combat/STATUS/silence.json",
  "combat/STATUS/siphon.json",
  "combat/STATUS/soaked.json",
  "combat/STATUS/steam.json",
  "combat/STATUS/venom.json",
  "combat/STATUS/vulnerable.json",
  "combat/STATUS/weaken.json",
  "combat/STATUS/wet.json",
  "combat/STATUS/wound.json",
  "combat/STATUS/wrath.json",
  "combat/TERRAIN.json",
  "combat/TERRAIN_MUD_SMOKE.json",
  "combat/TERRAIN_RUBBLE.json",
  "combat/_index.json",
  "enemies/BOSS/_index.json",
  "enemies/BOSS/boneLord.json",
  "enemies/BOSS/broodMother.json",
  "enemies/BOSS/frostGiant.json",
  "enemies/BOSS/kingSlime.json",
  "enemies/BOSS/librarian.json",
  "enemies/BOSS/mirrorKnight.json",
  "enemies/BOSS/oilKing.json",
  "enemies/BOSS/thiefKing.json",
  "enemies/BOSS/twinKnights.json",
  "enemies/DOUBLE_CHARGE.json",
  "enemies/ELITE.json",
  "enemies/ELITE_GREEDY.json",
  "enemies/ENEMY_AI/_index.json",
  "enemies/ENEMY_AI/absorber.json",
  "enemies/ENEMY_AI/banner.json",
  "enemies/ENEMY_AI/basilisk.json",
  "enemies/ENEMY_AI/bat.json",
  "enemies/ENEMY_AI/bellImp.json",
  "enemies/ENEMY_AI/bomber.json",
  "enemies/ENEMY_AI/burrower.json",
  "enemies/ENEMY_AI/chainWarden.json",
  "enemies/ENEMY_AI/charged.json",
  "enemies/ENEMY_AI/conductor.json",
  "enemies/ENEMY_AI/corpse.json",
  "enemies/ENEMY_AI/crossGolem.json",
  "enemies/ENEMY_AI/deathBurst.json",
  "enemies/ENEMY_AI/dropper.json",
  "enemies/ENEMY_AI/echoStriker.json",
  "enemies/ENEMY_AI/flameEater.json",
  "enemies/ENEMY_AI/flank.json",
  "enemies/ENEMY_AI/forgeMaster.json",
  "enemies/ENEMY_AI/frostCrusher.json",
  "enemies/ENEMY_AI/giantToad.json",
  "enemies/ENEMY_AI/golem.json",
  "enemies/ENEMY_AI/graveBell.json",
  "enemies/ENEMY_AI/hollow.json",
  "enemies/ENEMY_AI/hollowArmor.json",
  "enemies/ENEMY_AI/homunculus.json",
  "enemies/ENEMY_AI/iceTrail.json",
  "enemies/ENEMY_AI/kamikaze.json",
  "enemies/ENEMY_AI/knight.json",
  "enemies/ENEMY_AI/laser.json",
  "enemies/ENEMY_AI/leaper.json",
  "enemies/ENEMY_AI/lobber.json",
  "enemies/ENEMY_AI/manaLeech.json",
  "enemies/ENEMY_AI/mimic.json",
  "enemies/ENEMY_AI/mine.json",
  "enemies/ENEMY_AI/mineLayer.json",
  "enemies/ENEMY_AI/oiler.json",
  "enemies/ENEMY_AI/packLeader.json",
  "enemies/ENEMY_AI/rockfall.json",
  "enemies/ENEMY_AI/scavenger.json",
  "enemies/ENEMY_AI/scribeImp.json",
  "enemies/ENEMY_AI/shadowStalker.json",
  "enemies/ENEMY_AI/silencer.json",
  "enemies/ENEMY_AI/spore.json",
  "enemies/ENEMY_AI/swampWisp.json",
  "enemies/ENEMY_AI/terrainSeed.json",
  "enemies/ENEMY_AI/timid.json",
  "enemies/ENEMY_AI/turret.json",
  "enemies/ENEMY_AI/turretMaster.json",
  "enemies/ENEMY_AI/twinShade.json",
  "enemies/ENEMY_AI/volley.json",
  "enemies/ENEMY_AI/windSprite.json",
  "enemies/ENEMY_AI/wisp.json",
  "enemies/ENEMY_SCALE.json",
  "enemies/ENEMY_TEMPO.json",
  "enemies/FLOOR_LORD.json",
  "enemies/FORMATION/_index.json",
  "enemies/FORMATION/arrowhead.json",
  "enemies/FORMATION/circle.json",
  "enemies/FORMATION/column.json",
  "enemies/FORMATION/craneWing.json",
  "enemies/FORMATION/crescent.json",
  "enemies/FORMATION/fishScale.json",
  "enemies/FORMATION/geese.json",
  "enemies/FORMATION/lookout.json",
  "enemies/FORMATION/yoke.json",
  "enemies/JIN.json",
  "enemies/REACTION.json",
  "enemies/REAPER.json",
  "enemies/_index.json",
  "enemies/combat/_index.json",
  "enemies/combat/absorber.json",
  "enemies/combat/anvil.json",
  "enemies/combat/ashBat.json",
  "enemies/combat/banner.json",
  "enemies/combat/bannerBearer.json",
  "enemies/combat/basilisk.json",
  "enemies/combat/bat.json",
  "enemies/combat/bellImp.json",
  "enemies/combat/blackKnight.json",
  "enemies/combat/boar.json",
  "enemies/combat/boarDouble.json",
  "enemies/combat/bomber.json",
  "enemies/combat/boneBoar.json",
  "enemies/combat/boneConductor.json",
  "enemies/combat/boneLord.json",
  "enemies/combat/broodEgg.json",
  "enemies/combat/broodMother.json",
  "enemies/combat/burrower.json",
  "enemies/combat/carrionFly.json",
  "enemies/combat/chainWarden.json",
  "enemies/combat/crate.json",
  "enemies/combat/crossGolem.json",
  "enemies/combat/crystalGolem.json",
  "enemies/combat/crystalMite.json",
  "enemies/combat/curseEye.json",
  "enemies/combat/dropper.json",
  "enemies/combat/echoStriker.json",
  "enemies/combat/emberRat.json",
  "enemies/combat/enemyMine.json",
  "enemies/combat/eye.json",
  "enemies/combat/fireSlime.json",
  "enemies/combat/flameEater.json",
  "enemies/combat/flyingBook.json",
  "enemies/combat/forgeMaster.json",
  "enemies/combat/frostCrusher.json",
  "enemies/combat/frostEye.json",
  "enemies/combat/frostGiant.json",
  "enemies/combat/frostGolem.json",
  "enemies/combat/frostToad.json",
  "enemies/combat/frostWisp.json",
  "enemies/combat/fuseRat.json",
  "enemies/combat/giantToad.json",
  "enemies/combat/goldSlime.json",
  "enemies/combat/golem.json",
  "enemies/combat/graveBell.json",
  "enemies/combat/hollow.json",
  "enemies/combat/hollowArmor.json",
  "enemies/combat/hollowWraith.json",
  "enemies/combat/homunculus.json",
  "enemies/combat/hornBeetle.json",
  "enemies/combat/iceBoar.json",
  "enemies/combat/icePillar.json",
  "enemies/combat/iceSlime.json",
  "enemies/combat/kingSlime.json",
  "enemies/combat/knight.json",
  "enemies/combat/laserEye.json",
  "enemies/combat/lavaGolem.json",
  "enemies/combat/librarian.json",
  "enemies/combat/lurker.json",
  "enemies/combat/magmaToad.json",
  "enemies/combat/manaLeech.json",
  "enemies/combat/merchant.json",
  "enemies/combat/mimic.json",
  "enemies/combat/mineLayer.json",
  "enemies/combat/mirrorImage.json",
  "enemies/combat/mirrorKnight.json",
  "enemies/combat/mirrorSelf.json",
  "enemies/combat/mossGolem.json",
  "enemies/combat/mudman.json",
  "enemies/combat/multiBomber.json",
  "enemies/combat/netter.json",
  "enemies/combat/oilKing.json",
  "enemies/combat/oilSlime.json",
  "enemies/combat/oiler.json",
  "enemies/combat/packLeader.json",
  "enemies/combat/poisonSlime.json",
  "enemies/combat/pot.json",
  "enemies/combat/purpleLaser.json",
  "enemies/combat/reaperShade.json",
  "enemies/combat/scavenger.json",
  "enemies/combat/scribeImp.json",
  "enemies/combat/shadowBat.json",
  "enemies/combat/shadowStalker.json",
  "enemies/combat/silencer.json",
  "enemies/combat/skeleton.json",
  "enemies/combat/slime.json",
  "enemies/combat/sootBomber.json",
  "enemies/combat/spearman.json",
  "enemies/combat/spikeRat.json",
  "enemies/combat/sproutSlime.json",
  "enemies/combat/stormEye.json",
  "enemies/combat/swampWisp.json",
  "enemies/combat/thief.json",
  "enemies/combat/thiefKing.json",
  "enemies/combat/thunderWisp.json",
  "enemies/combat/toad.json",
  "enemies/combat/trainingDummy.json",
  "enemies/combat/triLaser.json",
  "enemies/combat/turret.json",
  "enemies/combat/turretMaster.json",
  "enemies/combat/twinBrother.json",
  "enemies/combat/twinEye.json",
  "enemies/combat/twinShade.json",
  "enemies/combat/twinSister.json",
  "enemies/combat/windSprite.json",
  "enemies/combat/wisp.json",
  "enemies/combat/wolf.json",
  "enemies/defense/_index.json",
  "enemies/defense/biomes.json",
  "enemies/defense/bodies.json",
  "enemies/defense/enemies/_index.json",
  "enemies/defense/enemies/absorber.json",
  "enemies/defense/enemies/anvil.json",
  "enemies/defense/enemies/ashBat.json",
  "enemies/defense/enemies/banner.json",
  "enemies/defense/enemies/bannerBearer.json",
  "enemies/defense/enemies/basilisk.json",
  "enemies/defense/enemies/bat.json",
  "enemies/defense/enemies/bellImp.json",
  "enemies/defense/enemies/blackKnight.json",
  "enemies/defense/enemies/boar.json",
  "enemies/defense/enemies/boarDouble.json",
  "enemies/defense/enemies/bomber.json",
  "enemies/defense/enemies/boneBoar.json",
  "enemies/defense/enemies/boneConductor.json",
  "enemies/defense/enemies/boneLord.json",
  "enemies/defense/enemies/broodEgg.json",
  "enemies/defense/enemies/broodMother.json",
  "enemies/defense/enemies/burrower.json",
  "enemies/defense/enemies/carrionFly.json",
  "enemies/defense/enemies/chainWarden.json",
  "enemies/defense/enemies/crate.json",
  "enemies/defense/enemies/crossGolem.json",
  "enemies/defense/enemies/crystalGolem.json",
  "enemies/defense/enemies/crystalMite.json",
  "enemies/defense/enemies/curseEye.json",
  "enemies/defense/enemies/dropper.json",
  "enemies/defense/enemies/echoStriker.json",
  "enemies/defense/enemies/emberRat.json",
  "enemies/defense/enemies/enemyMine.json",
  "enemies/defense/enemies/eye.json",
  "enemies/defense/enemies/fireSlime.json",
  "enemies/defense/enemies/flameEater.json",
  "enemies/defense/enemies/flyingBook.json",
  "enemies/defense/enemies/forgeMaster.json",
  "enemies/defense/enemies/frostCrusher.json",
  "enemies/defense/enemies/frostEye.json",
  "enemies/defense/enemies/frostGiant.json",
  "enemies/defense/enemies/frostGolem.json",
  "enemies/defense/enemies/frostToad.json",
  "enemies/defense/enemies/frostWisp.json",
  "enemies/defense/enemies/fuseRat.json",
  "enemies/defense/enemies/giantToad.json",
  "enemies/defense/enemies/goldSlime.json",
  "enemies/defense/enemies/golem.json",
  "enemies/defense/enemies/graveBell.json",
  "enemies/defense/enemies/hollow.json",
  "enemies/defense/enemies/hollowArmor.json",
  "enemies/defense/enemies/hollowWraith.json",
  "enemies/defense/enemies/homunculus.json",
  "enemies/defense/enemies/hornBeetle.json",
  "enemies/defense/enemies/iceBoar.json",
  "enemies/defense/enemies/icePillar.json",
  "enemies/defense/enemies/iceSlime.json",
  "enemies/defense/enemies/kingSlime.json",
  "enemies/defense/enemies/knight.json",
  "enemies/defense/enemies/laserEye.json",
  "enemies/defense/enemies/lavaGolem.json",
  "enemies/defense/enemies/librarian.json",
  "enemies/defense/enemies/lurker.json",
  "enemies/defense/enemies/magmaToad.json",
  "enemies/defense/enemies/manaLeech.json",
  "enemies/defense/enemies/merchant.json",
  "enemies/defense/enemies/mimic.json",
  "enemies/defense/enemies/mineLayer.json",
  "enemies/defense/enemies/mirrorImage.json",
  "enemies/defense/enemies/mirrorKnight.json",
  "enemies/defense/enemies/mirrorSelf.json",
  "enemies/defense/enemies/mossGolem.json",
  "enemies/defense/enemies/mudman.json",
  "enemies/defense/enemies/multiBomber.json",
  "enemies/defense/enemies/netter.json",
  "enemies/defense/enemies/oilKing.json",
  "enemies/defense/enemies/oilSlime.json",
  "enemies/defense/enemies/oiler.json",
  "enemies/defense/enemies/packLeader.json",
  "enemies/defense/enemies/poisonSlime.json",
  "enemies/defense/enemies/pot.json",
  "enemies/defense/enemies/purpleLaser.json",
  "enemies/defense/enemies/reaperShade.json",
  "enemies/defense/enemies/scavenger.json",
  "enemies/defense/enemies/scribeImp.json",
  "enemies/defense/enemies/shadowBat.json",
  "enemies/defense/enemies/shadowStalker.json",
  "enemies/defense/enemies/silencer.json",
  "enemies/defense/enemies/skeleton.json",
  "enemies/defense/enemies/slime.json",
  "enemies/defense/enemies/sootBomber.json",
  "enemies/defense/enemies/spearman.json",
  "enemies/defense/enemies/spikeRat.json",
  "enemies/defense/enemies/sproutSlime.json",
  "enemies/defense/enemies/stormEye.json",
  "enemies/defense/enemies/swampWisp.json",
  "enemies/defense/enemies/thief.json",
  "enemies/defense/enemies/thiefKing.json",
  "enemies/defense/enemies/thunderWisp.json",
  "enemies/defense/enemies/toad.json",
  "enemies/defense/enemies/trainingDummy.json",
  "enemies/defense/enemies/triLaser.json",
  "enemies/defense/enemies/turret.json",
  "enemies/defense/enemies/turretMaster.json",
  "enemies/defense/enemies/twinBrother.json",
  "enemies/defense/enemies/twinEye.json",
  "enemies/defense/enemies/twinShade.json",
  "enemies/defense/enemies/twinSister.json",
  "enemies/defense/enemies/windSprite.json",
  "enemies/defense/enemies/wisp.json",
  "enemies/defense/enemies/wolf.json",
  "enemies/stats/_index.json",
  "enemies/stats/absorber.json",
  "enemies/stats/anvil.json",
  "enemies/stats/ashBat.json",
  "enemies/stats/banner.json",
  "enemies/stats/bannerBearer.json",
  "enemies/stats/basilisk.json",
  "enemies/stats/bat.json",
  "enemies/stats/bellImp.json",
  "enemies/stats/blackKnight.json",
  "enemies/stats/boar.json",
  "enemies/stats/boarDouble.json",
  "enemies/stats/bomber.json",
  "enemies/stats/boneBoar.json",
  "enemies/stats/boneConductor.json",
  "enemies/stats/boneLord.json",
  "enemies/stats/broodEgg.json",
  "enemies/stats/broodMother.json",
  "enemies/stats/burrower.json",
  "enemies/stats/carrionFly.json",
  "enemies/stats/chainWarden.json",
  "enemies/stats/crate.json",
  "enemies/stats/crossGolem.json",
  "enemies/stats/crystalGolem.json",
  "enemies/stats/crystalMite.json",
  "enemies/stats/curseEye.json",
  "enemies/stats/dropper.json",
  "enemies/stats/echoStriker.json",
  "enemies/stats/emberRat.json",
  "enemies/stats/enemyMine.json",
  "enemies/stats/eye.json",
  "enemies/stats/fireSlime.json",
  "enemies/stats/flameEater.json",
  "enemies/stats/flyingBook.json",
  "enemies/stats/forgeMaster.json",
  "enemies/stats/frostCrusher.json",
  "enemies/stats/frostEye.json",
  "enemies/stats/frostGiant.json",
  "enemies/stats/frostGolem.json",
  "enemies/stats/frostToad.json",
  "enemies/stats/frostWisp.json",
  "enemies/stats/fuseRat.json",
  "enemies/stats/giantToad.json",
  "enemies/stats/goldSlime.json",
  "enemies/stats/golem.json",
  "enemies/stats/graveBell.json",
  "enemies/stats/hollow.json",
  "enemies/stats/hollowArmor.json",
  "enemies/stats/hollowWraith.json",
  "enemies/stats/homunculus.json",
  "enemies/stats/hornBeetle.json",
  "enemies/stats/iceBoar.json",
  "enemies/stats/icePillar.json",
  "enemies/stats/iceSlime.json",
  "enemies/stats/kingSlime.json",
  "enemies/stats/knight.json",
  "enemies/stats/laserEye.json",
  "enemies/stats/lavaGolem.json",
  "enemies/stats/librarian.json",
  "enemies/stats/lurker.json",
  "enemies/stats/magmaToad.json",
  "enemies/stats/manaLeech.json",
  "enemies/stats/merchant.json",
  "enemies/stats/mimic.json",
  "enemies/stats/mineLayer.json",
  "enemies/stats/mirrorImage.json",
  "enemies/stats/mirrorKnight.json",
  "enemies/stats/mirrorSelf.json",
  "enemies/stats/mossGolem.json",
  "enemies/stats/mudman.json",
  "enemies/stats/multiBomber.json",
  "enemies/stats/netter.json",
  "enemies/stats/oilKing.json",
  "enemies/stats/oilSlime.json",
  "enemies/stats/oiler.json",
  "enemies/stats/packLeader.json",
  "enemies/stats/poisonSlime.json",
  "enemies/stats/pot.json",
  "enemies/stats/purpleLaser.json",
  "enemies/stats/reaperShade.json",
  "enemies/stats/scavenger.json",
  "enemies/stats/scribeImp.json",
  "enemies/stats/shadowBat.json",
  "enemies/stats/shadowStalker.json",
  "enemies/stats/silencer.json",
  "enemies/stats/skeleton.json",
  "enemies/stats/slime.json",
  "enemies/stats/sootBomber.json",
  "enemies/stats/spearman.json",
  "enemies/stats/spikeRat.json",
  "enemies/stats/sproutSlime.json",
  "enemies/stats/stormEye.json",
  "enemies/stats/swampWisp.json",
  "enemies/stats/thief.json",
  "enemies/stats/thiefKing.json",
  "enemies/stats/thunderWisp.json",
  "enemies/stats/toad.json",
  "enemies/stats/trainingDummy.json",
  "enemies/stats/triLaser.json",
  "enemies/stats/turret.json",
  "enemies/stats/turretMaster.json",
  "enemies/stats/twinBrother.json",
  "enemies/stats/twinEye.json",
  "enemies/stats/twinShade.json",
  "enemies/stats/twinSister.json",
  "enemies/stats/windSprite.json",
  "enemies/stats/wisp.json",
  "enemies/stats/wolf.json",
  "feel/EFFECTS/_index.json",
  "feel/EFFECTS/bossLight.json",
  "feel/EFFECTS/chargeUp.json",
  "feel/EFFECTS/clearWave.json",
  "feel/EFFECTS/comboMilestones.json",
  "feel/EFFECTS/comboTiers.json",
  "feel/EFFECTS/critFlash.json",
  "feel/EFFECTS/dashGhost.json",
  "feel/EFFECTS/death.json",
  "feel/EFFECTS/doorSlam.json",
  "feel/EFFECTS/dropBeam.json",
  "feel/EFFECTS/eliteBurst.json",
  "feel/EFFECTS/floorCard.json",
  "feel/EFFECTS/hitSpark.json",
  "feel/EFFECTS/justRing.json",
  "feel/EFFECTS/synergyGlow.json",
  "feel/EFFECTS/weakCrack.json",
  "feel/FEEL.json",
  "feel/FX_ATTACK/_index.json",
  "feel/FX_ATTACK/blast.json",
  "feel/FX_ATTACK/bolt.json",
  "feel/FX_ATTACK/bullet.json",
  "feel/FX_ATTACK/hitSpark.json",
  "feel/FX_ATTACK/impact.json",
  "feel/FX_ATTACK/muzzle.json",
  "feel/FX_ATTACK/particle.json",
  "feel/FX_ATTACK/ring.json",
  "feel/FX_ATTACK/slash.json",
  "feel/FX_ATTACK/sprite.json",
  "feel/FX_WAVE3.json",
  "feel/MINIMAP.json",
  "feel/MUSIC.json",
  "feel/SFX_WAVE3.json",
  "feel/TELEGRAPH.json",
  "feel/_index.json",
  "jobs/DASH_FORM.json",
  "jobs/JOB.json",
  "jobs/MANA_SOURCE.json",
  "jobs/_index.json",
  "jobs/attributes.json",
  "loot/FLUX.json",
  "loot/INNATE/_index.json",
  "loot/INNATE/armor.json",
  "loot/INNATE/budget.json",
  "loot/INNATE/depthScale.json",
  "loot/INNATE/maxLines.json",
  "loot/INNATE/pointValue.json",
  "loot/INNATE/resistLines.json",
  "loot/INNATE/slotLean.json",
  "loot/KEYSTONE.json",
  "loot/LOOT_DROP.json",
  "loot/PICKUP.json",
  "loot/RELIC.json",
  "loot/RESONANCE.json",
  "loot/SYNERGY.json",
  "loot/TRIGGER.json",
  "loot/_index.json",
  "loot/affixCurves/_index.json",
  "loot/affixCurves/armorFlat.json",
  "loot/affixCurves/attr_def.json",
  "loot/affixCurves/attr_dex.json",
  "loot/affixCurves/attr_mnd.json",
  "loot/affixCurves/attr_spi.json",
  "loot/affixCurves/attr_str.json",
  "loot/affixCurves/attr_vit.json",
  "loot/affixCurves/backlash.json",
  "loot/affixCurves/bloodSignature.json",
  "loot/affixCurves/branchArt.json",
  "loot/affixCurves/brandDetonator.json",
  "loot/affixCurves/bulletCut.json",
  "loot/affixCurves/burn.json",
  "loot/affixCurves/burnStack.json",
  "loot/affixCurves/chainReturn.json",
  "loot/affixCurves/chainSource.json",
  "loot/affixCurves/chargeCore.json",
  "loot/affixCurves/chill.json",
  "loot/affixCurves/comboDamage.json",
  "loot/affixCurves/conductor.json",
  "loot/affixCurves/counterWave.json",
  "loot/affixCurves/curtainCall.json",
  "loot/affixCurves/cv_armorToPoise.json",
  "loot/affixCurves/cv_chargesToDistance.json",
  "loot/affixCurves/cv_coinsToMore.json",
  "loot/affixCurves/cv_comboToFinisher.json",
  "loot/affixCurves/cv_critToChain.json",
  "loot/affixCurves/cv_critToCoins.json",
  "loot/affixCurves/cv_critToLightning.json",
  "loot/affixCurves/cv_critToMorale.json",
  "loot/affixCurves/cv_infuseDark.json",
  "loot/affixCurves/cv_infuseFire.json",
  "loot/affixCurves/cv_infuseIce.json",
  "loot/affixCurves/cv_infuseLight.json",
  "loot/affixCurves/cv_infuseLightning.json",
  "loot/affixCurves/cv_infusePoison.json",
  "loot/affixCurves/cv_lifeToArea.json",
  "loot/affixCurves/cv_manaToProjectiles.json",
  "loot/affixCurves/cv_projectilesToPoise.json",
  "loot/affixCurves/cv_speedToDamage.json",
  "loot/affixCurves/damageVsStaggered.json",
  "loot/affixCurves/desperation.json",
  "loot/affixCurves/downHunter.json",
  "loot/affixCurves/echoSlash.json",
  "loot/affixCurves/elementalBreak.json",
  "loot/affixCurves/emberTrail.json",
  "loot/affixCurves/energyReserve.json",
  "loot/affixCurves/explodeOnKill.json",
  "loot/affixCurves/fever.json",
  "loot/affixCurves/finisherEdge.json",
  "loot/affixCurves/firstMove.json",
  "loot/affixCurves/firstStrikeEdge.json",
  "loot/affixCurves/frostTrail.json",
  "loot/affixCurves/fullTide.json",
  "loot/affixCurves/groundMend.json",
  "loot/affixCurves/groundRooted.json",
  "loot/affixCurves/guardPiercer.json",
  "loot/affixCurves/guardedBane.json",
  "loot/affixCurves/inheritance.json",
  "loot/affixCurves/justBreath.json",
  "loot/affixCurves/justDodgeDamage.json",
  "loot/affixCurves/kaleidoscope.json",
  "loot/affixCurves/lockdownFury.json",
  "loot/affixCurves/manaOnStagger.json",
  "loot/affixCurves/manaOverflow.json",
  "loot/affixCurves/manaShield.json",
  "loot/affixCurves/moraleCap.json",
  "loot/affixCurves/moraleSurge.json",
  "loot/affixCurves/oldScars.json",
  "loot/affixCurves/placedInfuse.json",
  "loot/affixCurves/plagueSeed.json",
  "loot/affixCurves/prismEdge.json",
  "loot/affixCurves/procBleed.json",
  "loot/affixCurves/procFear.json",
  "loot/affixCurves/procPoison.json",
  "loot/affixCurves/purse.json",
  "loot/affixCurves/rapidBrand.json",
  "loot/affixCurves/readAhead.json",
  "loot/affixCurves/releaseEdge.json",
  "loot/affixCurves/res_dark.json",
  "loot/affixCurves/res_fire.json",
  "loot/affixCurves/res_ice.json",
  "loot/affixCurves/res_light.json",
  "loot/affixCurves/res_lightning.json",
  "loot/affixCurves/res_poison.json",
  "loot/affixCurves/riposteEdge.json",
  "loot/affixCurves/rotBurst.json",
  "loot/affixCurves/sapling.json",
  "loot/affixCurves/shock.json",
  "loot/affixCurves/siegeGuard.json",
  "loot/affixCurves/staggerMark.json",
  "loot/affixCurves/staggerQuake.json",
  "loot/affixCurves/staggerSpark.json",
  "loot/affixCurves/stake.json",
  "loot/affixCurves/stanceGuard.json",
  "loot/affixCurves/switchBreath.json",
  "loot/affixCurves/terrainBurst.json",
  "loot/affixCurves/terrainHunter.json",
  "loot/affixCurves/twinEdge.json",
  "loot/affixCurves/unmoving.json",
  "loot/affixCurves/veteran.json",
  "loot/affixCurves/wedge.json",
  "loot/bases.json",
  "skills/ART/TRANSFORM/_index.json",
  "skills/ART/TRANSFORM/artillery.json",
  "skills/ART/TRANSFORM/bell.json",
  "skills/ART/TRANSFORM/bulwark.json",
  "skills/ART/TRANSFORM/chain.json",
  "skills/ART/TRANSFORM/crusher.json",
  "skills/ART/TRANSFORM/flurry.json",
  "skills/ART/TRANSFORM/hewer.json",
  "skills/ART/TRANSFORM/pistol.json",
  "skills/ART/TRANSFORM/polearm.json",
  "skills/ART/TRANSFORM/rifle.json",
  "skills/ART/TRANSFORM/rod.json",
  "skills/ART/TRANSFORM/thrower.json",
  "skills/ART/TRANSFORM/warfan.json",
  "skills/ART/_index.json",
  "skills/ART/common.json",
  "skills/COMBO_TUNING.json",
  "skills/EXTRA_MODIFIER_TUNING.json",
  "skills/EXTRA_SKILL_TUNING/_index.json",
  "skills/EXTRA_SKILL_TUNING/backflow.json",
  "skills/EXTRA_SKILL_TUNING/bloodlet.json",
  "skills/EXTRA_SKILL_TUNING/boneRing.json",
  "skills/EXTRA_SKILL_TUNING/comboChain.json",
  "skills/EXTRA_SKILL_TUNING/contagion.json",
  "skills/EXTRA_SKILL_TUNING/discharge.json",
  "skills/EXTRA_SKILL_TUNING/dregsBlade.json",
  "skills/EXTRA_SKILL_TUNING/exploit.json",
  "skills/EXTRA_SKILL_TUNING/fullMoon.json",
  "skills/EXTRA_SKILL_TUNING/galeSlash.json",
  "skills/EXTRA_SKILL_TUNING/grudge.json",
  "skills/EXTRA_SKILL_TUNING/guillotine.json",
  "skills/EXTRA_SKILL_TUNING/harvest.json",
  "skills/EXTRA_SKILL_TUNING/iceBreaker.json",
  "skills/EXTRA_SKILL_TUNING/kindle.json",
  "skills/EXTRA_SKILL_TUNING/lastStand.json",
  "skills/EXTRA_SKILL_TUNING/manaSpring.json",
  "skills/EXTRA_SKILL_TUNING/meteorDive.json",
  "skills/EXTRA_SKILL_TUNING/powderKeg.json",
  "skills/EXTRA_SKILL_TUNING/prismShard.json",
  "skills/EXTRA_SKILL_TUNING/ricochet.json",
  "skills/EXTRA_SKILL_TUNING/rout.json",
  "skills/EXTRA_SKILL_TUNING/scarRoar.json",
  "skills/EXTRA_SKILL_TUNING/scatterSigil.json",
  "skills/EXTRA_SKILL_TUNING/shadowStep.json",
  "skills/EXTRA_SKILL_TUNING/stomp.json",
  "skills/EXTRA_SKILL_TUNING/strip.json",
  "skills/EXTRA_SKILL_TUNING/swallowFlip.json",
  "skills/EXTRA_SKILL_TUNING/swordGrave.json",
  "skills/EXTRA_SKILL_TUNING/threadReel.json",
  "skills/EXTRA_SKILL_TUNING/turret.json",
  "skills/EXTRA_SKILL_TUNING/unravel.json",
  "skills/EXTRA_SKILL_TUNING/verdict.json",
  "skills/FORM_TUNING.json",
  "skills/SHAPE_TUNING.json",
  "skills/SKILL/_index.json",
  "skills/SKILL/bloodPact.json",
  "skills/SKILL/chainHook.json",
  "skills/SKILL/drop.json",
  "skills/SKILL/frag.json",
  "skills/SKILL/frostField.json",
  "skills/SKILL/gravityWell.json",
  "skills/SKILL/haste.json",
  "skills/SKILL/lunge.json",
  "skills/SKILL/mines.json",
  "skills/SKILL/modifier.json",
  "skills/SKILL/parry.json",
  "skills/SKILL/quake.json",
  "skills/SKILL/railshot.json",
  "skills/SKILL/spiral.json",
  "skills/SKILL/thunder.json",
  "skills/SKILL/whirl.json",
  "skills/WAVE2_COMBO_TUNING.json",
  "skills/WAVE2_MODIFIER_TUNING.json",
  "skills/WAVE2_SKILL_TUNING/_index.json",
  "skills/WAVE2_SKILL_TUNING/bogCall.json",
  "skills/WAVE2_SKILL_TUNING/brandBlast.json",
  "skills/WAVE2_SKILL_TUNING/brandSear.json",
  "skills/WAVE2_SKILL_TUNING/breakKick.json",
  "skills/WAVE2_SKILL_TUNING/collapseHammer.json",
  "skills/WAVE2_SKILL_TUNING/doomSentence.json",
  "skills/WAVE2_SKILL_TUNING/emberDraw.json",
  "skills/WAVE2_SKILL_TUNING/flashFreeze.json",
  "skills/WAVE2_SKILL_TUNING/hueEtch.json",
  "skills/WAVE2_SKILL_TUNING/hueRelease.json",
  "skills/WAVE2_SKILL_TUNING/iceSlide.json",
  "skills/WAVE2_SKILL_TUNING/levelGround.json",
  "skills/WAVE2_SKILL_TUNING/mire.json",
  "skills/WAVE2_SKILL_TUNING/oilPot.json",
  "skills/WAVE2_SKILL_TUNING/scorchLine.json",
  "skills/WAVE2_SKILL_TUNING/shiftingEdge.json",
  "skills/WAVE2_SKILL_TUNING/siphonMark.json",
  "skills/WAVE2_SKILL_TUNING/spiritForm.json",
  "skills/WAVE2_SKILL_TUNING/swiftForm.json",
  "skills/WAVE2_SKILL_TUNING/tideSlash.json",
  "skills/WAVE2_SKILL_TUNING/titanForm.json",
  "skills/WAVE2_SKILL_TUNING/wardStake.json",
  "skills/WAVE2_SKILL_TUNING/waterJar.json",
  "skills/WAVE2_SKILL_TUNING/weaponArt.json",
  "skills/WAVE3_SKILL_TUNING.json",
  "skills/WEAR_TUNING.json",
  "skills/_index.json",
  "ultimates/ULTIMATE/_index.json",
  "ultimates/ULTIMATE/common.json",
  "ultimates/ULTIMATE/defs/_index.json",
  "ultimates/ULTIMATE/defs/axe.json",
  "ultimates/ULTIMATE/defs/book.json",
  "ultimates/ULTIMATE/defs/cannon.json",
  "ultimates/ULTIMATE/defs/chainSickle.json",
  "ultimates/ULTIMATE/defs/claws.json",
  "ultimates/ULTIMATE/defs/cleaver.json",
  "ultimates/ULTIMATE/defs/fan.json",
  "ultimates/ULTIMATE/defs/fists.json",
  "ultimates/ULTIMATE/defs/flail.json",
  "ultimates/ULTIMATE/defs/greatsword.json",
  "ultimates/ULTIMATE/defs/grenade.json",
  "ultimates/ULTIMATE/defs/gunner.json",
  "ultimates/ULTIMATE/defs/hammer.json",
  "ultimates/ULTIMATE/defs/handbell.json",
  "ultimates/ULTIMATE/defs/katana.json",
  "ultimates/ULTIMATE/defs/longarm.json",
  "ultimates/ULTIMATE/defs/ringBlades.json",
  "ultimates/ULTIMATE/defs/scythe.json",
  "ultimates/ULTIMATE/defs/shield.json",
  "ultimates/ULTIMATE/defs/sidearm.json",
  "ultimates/ULTIMATE/defs/spear.json",
  "ultimates/ULTIMATE/defs/staff.json",
  "ultimates/ULTIMATE/defs/sword.json",
  "ultimates/ULTIMATE/defs/thrown.json",
  "ultimates/ULTIMATE/defs/trapper.json",
  "ultimates/ULTIMATE/defs/twinBlades.json",
  "ultimates/ULTIMATE/defs/wand.json",
  "ultimates/ULTIMATE/defs/warRing.json",
  "ultimates/ULTIMATE/defs/whip.json",
  "ultimates/_index.json",
  "weapons/ACTION_DASH_ATTACK.json",
  "weapons/FORM/_index.json",
  "weapons/FORM/artillery.json",
  "weapons/FORM/bell.json",
  "weapons/FORM/blade.json",
  "weapons/FORM/bulwark.json",
  "weapons/FORM/chain.json",
  "weapons/FORM/crusher.json",
  "weapons/FORM/flurry.json",
  "weapons/FORM/hewer.json",
  "weapons/FORM/pistol.json",
  "weapons/FORM/polearm.json",
  "weapons/FORM/rifle.json",
  "weapons/FORM/rod.json",
  "weapons/FORM/thrower.json",
  "weapons/FORM/tome.json",
  "weapons/FORM/warfan.json",
  "weapons/MOMENT.json",
  "weapons/PLAYER_MELEE.json",
  "weapons/REFORGE/_index.json",
  "weapons/REFORGE/artillery.json",
  "weapons/REFORGE/bell.json",
  "weapons/REFORGE/blade.json",
  "weapons/REFORGE/bulwark.json",
  "weapons/REFORGE/chain.json",
  "weapons/REFORGE/crusher.json",
  "weapons/REFORGE/flurry.json",
  "weapons/REFORGE/hewer.json",
  "weapons/REFORGE/pistol.json",
  "weapons/REFORGE/polearm.json",
  "weapons/REFORGE/rifle.json",
  "weapons/REFORGE/rod.json",
  "weapons/REFORGE/thrower.json",
  "weapons/REFORGE/tome.json",
  "weapons/REFORGE/warfan.json",
  "weapons/WEAPON/_index.json",
  "weapons/WEAPON/artDefaults.json",
  "weapons/WEAPON/bullets.json",
  "weapons/WEAPON/jobBranches.json",
  "weapons/WEAPON/movesetRules.json",
  "weapons/WEAPON/movesets/_index.json",
  "weapons/WEAPON/movesets/axe.json",
  "weapons/WEAPON/movesets/book.json",
  "weapons/WEAPON/movesets/cannon.json",
  "weapons/WEAPON/movesets/chainSickle.json",
  "weapons/WEAPON/movesets/claws.json",
  "weapons/WEAPON/movesets/cleaver.json",
  "weapons/WEAPON/movesets/fan.json",
  "weapons/WEAPON/movesets/fists.json",
  "weapons/WEAPON/movesets/flail.json",
  "weapons/WEAPON/movesets/greatsword.json",
  "weapons/WEAPON/movesets/grenade.json",
  "weapons/WEAPON/movesets/gunner.json",
  "weapons/WEAPON/movesets/hammer.json",
  "weapons/WEAPON/movesets/handbell.json",
  "weapons/WEAPON/movesets/katana.json",
  "weapons/WEAPON/movesets/longarm.json",
  "weapons/WEAPON/movesets/ringBlades.json",
  "weapons/WEAPON/movesets/scythe.json",
  "weapons/WEAPON/movesets/shield.json",
  "weapons/WEAPON/movesets/sidearm.json",
  "weapons/WEAPON/movesets/spear.json",
  "weapons/WEAPON/movesets/staff.json",
  "weapons/WEAPON/movesets/sword.json",
  "weapons/WEAPON/movesets/thrown.json",
  "weapons/WEAPON/movesets/trapper.json",
  "weapons/WEAPON/movesets/twinBlades.json",
  "weapons/WEAPON/movesets/wand.json",
  "weapons/WEAPON/movesets/warRing.json",
  "weapons/WEAPON/movesets/whip.json",
  "weapons/WEAPON/unarmed.json",
  "weapons/WEAPON/weightClass.json",
  "weapons/_index.json",
  "world/ARC.json",
  "world/CAVE.json",
  "world/CONTRACT.json",
  "world/DISCOVERY.json",
  "world/ECONOMY/_index.json",
  "world/ECONOMY/bet.json",
  "world/ECONOMY/build.json",
  "world/ECONOMY/coin.json",
  "world/ECONOMY/container.json",
  "world/ECONOMY/donation.json",
  "world/ECONOMY/flask.json",
  "world/ECONOMY/income.json",
  "world/ECONOMY/key.json",
  "world/ECONOMY/market.json",
  "world/ECONOMY/price.json",
  "world/ECONOMY/spill.json",
  "world/EXIT.json",
  "world/FLOOR_KIND.json",
  "world/HIDDEN_ROOM.json",
  "world/HUB.json",
  "world/HUB_DECOR.json",
  "world/LINGER.json",
  "world/MAP_SIZE.json",
  "world/META.json",
  "world/ORIGIN.json",
  "world/ROAM.json",
  "world/ROOM.json",
  "world/ROOM_KIND/_index.json",
  "world/ROOM_KIND/extra.json",
  "world/ROOM_KIND/gambleWeights.json",
  "world/ROOM_KIND/locks.json",
  "world/RUN_EVENT/_index.json",
  "world/RUN_EVENT/bats.json",
  "world/RUN_EVENT/clearChance.json",
  "world/RUN_EVENT/duel.json",
  "world/RUN_EVENT/flood.json",
  "world/RUN_EVENT/floorChance.json",
  "world/RUN_EVENT/lifeFlow.json",
  "world/RUN_EVENT/lockChance.json",
  "world/RUN_EVENT/meteor.json",
  "world/RUN_EVENT/quake.json",
  "world/RUN_EVENT/reaperPass.json",
  "world/RUN_EVENT/sluggish.json",
  "world/RUN_EVENT/surge.json",
  "world/RUN_EVENT/thief.json",
  "world/RUN_EVENT/thunder.json",
  "world/RUN_EVENT/timedChance.json",
  "world/RUN_EVENT/vein.json",
  "world/RUN_MOD.json",
  "world/_index.json",
];
