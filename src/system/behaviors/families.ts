import type { Enemy, GameState } from "../../core/state";
import type { EnemyBehavior, EnemyDef } from "../../data/enemies";
import { ENEMY_AI } from "../../data/tuning";
import { frostCrusherReady, isMimicTongue, scavengerHeading } from "../enemyBehaviors";
import { absorberReady, bannerAlive, hollowFrozen } from "../enemyWave3";
import { EnemyBehaviorBase } from "./base";

// 基本パラメータは移行前の system/enemies.ts の表の値そのまま（第 2 段で enemies.json の BEHAVIOR へ移す）
/** 飛びかかり（近づいて殴る）の strike 中の移動倍率 */
const RUSH_STRIKE_SPEED_MUL = 4.6;
/** 突進の strike 中の移動倍率 */
const CHARGE_STRIKE_SPEED_MUL = 7.5;
/** 蝙蝠の噛みつきの strike 中の移動倍率 */
const FLY_STRIKE_SPEED_MUL = 3.2;
/** 鬼火の体当たりの strike 中の移動倍率 */
const WISP_STRIKE_SPEED_MUL = 3;
/** 虚ろの飛びかかりの strike 中の移動倍率 */
const HOLLOW_STRIKE_SPEED_MUL = 5;
/** 飛ぶ敵は予備動作中も少し寄ってくる */
const FLY_WINDUP_MOVE_MUL = 0.3;
/** 旗持ちが旗を立てた後に殴りに来る距離 */
const BANNER_MELEE_RANGE = 44;

// ---- 家族（既定値の束。3 段より深くしない） ----

/** 近づいて殴る（chaser 系）。strike 中の移動倍率だけ行ごとに変えられる（0 はその場で叩きつける） */
export class Rusher extends EnemyBehaviorBase {
  override readonly strikeSpeedMul: number;
  constructor(key: EnemyBehavior, strikeSpeedMul: number = RUSH_STRIKE_SPEED_MUL) {
    super(key);
    this.strikeSpeedMul = strikeSpeedMul;
  }
}

/** 直線に突進する。二度突きの猪は予告した折れ線をそのまま走る */
export class Charger extends Rusher {
  constructor(key: EnemyBehavior) {
    super(key, CHARGE_STRIKE_SPEED_MUL);
  }
  override aimFixedAtWindup(_e: Enemy, def: EnemyDef): boolean {
    return def.doubleCharge === true;
  }
}

/** 距離を保って撃つ・詠唱する。沈黙が効く（地雷撒き・炎の鍛冶のように効かないものは引数で外す） */
export class Keeper extends EnemyBehaviorBase {
  override readonly keepAway: number | undefined;
  override readonly silenceable: boolean;
  constructor(key: EnemyBehavior, keepAway: number | undefined = undefined, silenceable = true) {
    super(key);
    this.keepAway = keepAway;
    this.silenceable = silenceable;
  }
}

/** 一撃離脱で飛ぶ（蝙蝠）。予備動作中も寄ってくる */
export class Flyer extends EnemyBehaviorBase {
  override readonly strikeSpeedMul: number = FLY_STRIKE_SPEED_MUL;
  override readonly windupMoveMul: number = FLY_WINDUP_MOVE_MUL;
}

/** 動かない（氷柱・地雷・卵・吸い込み蟲）。追わない・押されない */
export class Stationary extends EnemyBehaviorBase {
  override readonly stationary: boolean = true;
}

/** ボス。状態機械を通らず boss*.ts が動かす。登録表の席を埋めるだけ */
export class BossDriven extends EnemyBehaviorBase {}

// ---- 個別（canBeginAttack / aimFixedAtWindup / 基本パラメータが家族と違う behavior） ----

/** 骸骨騎士: 踏み込みの速さは ENEMY_AI.knight */
export class Knight extends Rusher {
  constructor() {
    super("knight", ENEMY_AI.knight.lungeSpeedMul);
  }
}

/** 鬼火: 蝙蝠より少し遅い体当たり */
export class Wisp extends Flyer {
  override readonly strikeSpeedMul: number = WISP_STRIKE_SPEED_MUL;
  constructor() {
    super("wisp");
  }
}

/** 喰らう宝箱: 舌を伸ばす技は予備動作の始まりで狙いを固定する */
export class Mimic extends Rusher {
  constructor() {
    super("mimic", ENEMY_AI.mimic.biteSpeedMul);
  }
  override aimFixedAtWindup(e: Enemy, _def: EnemyDef): boolean {
    return isMimicTongue(e);
  }
}

/** 石化の蜥蜴: 睨みも噛みつきも狙いを固定する。沈黙で睨みを止められる */
export class Basilisk extends Keeper {
  constructor() {
    super("basilisk");
  }
  override aimFixedAtWindup(_e: Enemy, _def: EnemyDef): boolean {
    return true;
  }
}

/** 霜砕き: プレイヤーが冷気か凍結のときだけ大技を始める */
export class FrostCrusher extends Rusher {
  constructor() {
    super("frostCrusher", 0);
  }
  override canBeginAttack(state: GameState, _e: Enemy, _def: EnemyDef, _d: number): boolean {
    return frostCrusherReady(state);
  }
}

/** 骨拾い: 死骸へ向かっている間は殴りに来ない（食事優先） */
export class Scavenger extends Rusher {
  constructor() {
    super("scavenger");
  }
  override canBeginAttack(state: GameState, e: Enemy, _def: EnemyDef, _d: number): boolean {
    return scavengerHeading(state, e) === undefined;
  }
}

/** 吸い込み蟲: プレイヤーの弾を 1 発でも吸うまで吐き返さない */
export class Absorber extends Stationary {
  constructor() {
    super("absorber");
  }
  override canBeginAttack(_state: GameState, e: Enemy, _def: EnemyDef, _d: number): boolean {
    return absorberReady(e);
  }
}

/** 地雷撒き: 逃げながら地雷を撒くだけで、殴りに来ない。沈黙は効かない */
export class MineLayer extends Keeper {
  constructor() {
    super("mineLayer", ENEMY_AI.mineLayer.keepAway, false);
  }
  override canBeginAttack(_state: GameState, _e: Enemy, _def: EnemyDef, _d: number): boolean {
    return false;
  }
}

/** 虚ろ: 照準（向き）を向けられている間は固まり、攻撃を始めない */
export class Hollow extends Rusher {
  constructor() {
    super("hollow", HOLLOW_STRIKE_SPEED_MUL);
  }
  override canBeginAttack(state: GameState, e: Enemy, _def: EnemyDef, _d: number): boolean {
    return !hollowFrozen(state, e);
  }
}

/** 旗持ち: 旗が立っている間は近距離だけ殴りに来る */
export class BannerBearer extends Rusher {
  constructor() {
    super("bannerBearer");
  }
  override canBeginAttack(state: GameState, e: Enemy, _def: EnemyDef, d: number): boolean {
    return !bannerAlive(state, e) || d < BANNER_MELEE_RANGE;
  }
}

/** レーザー: チャージ中は止まり、狙いを予備動作の始まりで固定する */
export class Laser extends Keeper {
  constructor() {
    super("laser");
  }
  override aimFixedAtWindup(_e: Enemy, _def: EnemyDef): boolean {
    return true;
  }
}

/** 鎖の番人: 鎖の向きを予備動作の始まりで固定する（避けた側が勝つ） */
export class ChainWarden extends Rusher {
  constructor() {
    super("chainWarden", 0);
  }
  override aimFixedAtWindup(_e: Enemy, _def: EnemyDef): boolean {
    return true;
  }
}

/** 大蝦蟇: 舌の向きを予備動作の始まりで固定する */
export class GiantToad extends Rusher {
  constructor() {
    super("giantToad", 0);
  }
  override aimFixedAtWindup(_e: Enemy, _def: EnemyDef): boolean {
    return true;
  }
}

/** 風吹き: 扇の向きを予備動作の始まりで固定する */
export class WindSprite extends Keeper {
  constructor() {
    super("windSprite", ENEMY_AI.windSprite.keepAway);
  }
  override aimFixedAtWindup(_e: Enemy, _def: EnemyDef): boolean {
    return true;
  }
}

/** 動かずに撃つ・鳴らす（墓守の鐘・砲台）。沈黙が効く */
export class SilenceableStationary extends Stationary {
  override readonly silenceable: boolean = true;
}
