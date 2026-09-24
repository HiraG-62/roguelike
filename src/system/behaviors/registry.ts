import type { EnemyBehavior, EnemyDef } from "../../data/enemies";
import { ENEMY_AI } from "../../data/tuning";
import type { EnemyBehaviorBase } from "./base";
import {
  Absorber,
  BannerBearer,
  Basilisk,
  BossDriven,
  ChainWarden,
  Charger,
  Flyer,
  FrostCrusher,
  GiantToad,
  Hollow,
  Keeper,
  Knight,
  Laser,
  MineLayer,
  Mimic,
  Rusher,
  Scavenger,
  SilenceableStationary,
  Stationary,
  WindSprite,
  Wisp,
} from "./families";

/** 登録表ごと凍結する。インスタンスに状態を書くと strict mode で例外になり、リプレイのずれを構造で防げる */
function freezeAll<T extends Record<string, EnemyBehaviorBase>>(table: T): Readonly<T> {
  for (const b of Object.values(table)) Object.freeze(b);
  return Object.freeze(table);
}

/** behavior → 振る舞い。Record なので EnemyBehavior を足して登録を忘れると型エラー */
export const BEHAVIORS: Readonly<Record<EnemyBehavior, EnemyBehaviorBase>> = freezeAll<Record<EnemyBehavior, EnemyBehaviorBase>>({
  chaser: new Rusher("chaser"),
  shooter: new Keeper("shooter"),
  charger: new Charger("charger"),
  knight: new Knight(),
  bomber: new Keeper("bomber"),
  laser: new Laser(),
  golem: new Rusher("golem", 0),
  bat: new Flyer("bat"),
  wisp: new Wisp(),
  kingSlime: new BossDriven("kingSlime"),
  boneLord: new BossDriven("boneLord"),
  kamikaze: new Rusher("kamikaze", 0),
  echoStriker: new Keeper("echoStriker", ENEMY_AI.echoStriker.keepAway),
  packLeader: new Rusher("packLeader"),
  conductor: new Keeper("conductor", ENEMY_AI.conductor.keepAway),
  manaLeech: new Rusher("manaLeech"),
  scavenger: new Scavenger(),
  graveBell: new SilenceableStationary("graveBell"),
  silencer: new Keeper("silencer", ENEMY_AI.silencer.keepAway),
  frostCrusher: new FrostCrusher(),
  twinShade: new Rusher("twinShade"),
  mimic: new Mimic(),
  hollowArmor: new Rusher("hollowArmor", 0),
  inert: new Stationary("inert"),
  twinBlade: new BossDriven("twinBlade"),
  twinBow: new BossDriven("twinBow"),
  frostGiant: new BossDriven("frostGiant"),
  lobber: new Keeper("lobber", ENEMY_AI.lobber.keepAway),
  oiler: new Rusher("oiler"),
  bellImp: new Keeper("bellImp", ENEMY_AI.bellImp.keepAway),
  bannerBearer: new BannerBearer(),
  burrower: new Rusher("burrower", 0),
  dropper: new Rusher("dropper"),
  absorber: new Absorber(),
  homunculus: new Keeper("homunculus", ENEMY_AI.homunculus.keepAway),
  scribeImp: new Keeper("scribeImp", ENEMY_AI.scribeImp.keepAway),
  crossGolem: new Rusher("crossGolem", 0),
  windSprite: new WindSprite(),
  mineLayer: new MineLayer(),
  mine: new Stationary("mine"),
  chainWarden: new ChainWarden(),
  hollow: new Hollow(),
  flameEater: new Rusher("flameEater"),
  egg: new Stationary("egg"),
  turret: new SilenceableStationary("turret"),
  giantToad: new GiantToad(),
  // 炎の鍛冶は距離を保つが、沈黙では止まらない（移行前の表のまま）
  forgeMaster: new Keeper("forgeMaster", ENEMY_AI.forgeMaster.keepAway, false),
  turretMaster: new Keeper("turretMaster"),
  basilisk: new Basilisk(),
  shadowStalker: new Rusher("shadowStalker", 0),
  oilKing: new BossDriven("oilKing"),
  broodMother: new BossDriven("broodMother"),
  librarian: new BossDriven("librarian"),
  mirrorKnight: new BossDriven("mirrorKnight"),
  thiefKing: new BossDriven("thiefKing"),
});

/** その敵の振る舞い */
export function behaviorOf(def: EnemyDef): EnemyBehaviorBase {
  return BEHAVIORS[def.behavior];
}
