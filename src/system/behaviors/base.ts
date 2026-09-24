import type { Enemy, GameState } from "../../core/state";
import type { Vec } from "../../core/vec";
import type { EnemyBehavior, EnemyDef } from "../../data/enemies";

/** 予備動作中に描く予告の種類（render/renderer.ts が system/enemies.ts の再 export 経由で読む） */
export type EnemyTelegraph =
  | { kind: "line" }
  | { kind: "laser" }
  | { kind: "ring"; radius: number }
  /** 十字の線（ai.points の各点へ。十字ゴーレム） */
  | { kind: "cross" }
  /** 扇（strikeDir を中心に range・半角 halfDeg。風吹き・石化の蜥蜴） */
  | { kind: "cone"; range: number; halfDeg: number }
  | null;

/** 攻撃の出だしの結果。handled = 自分で処理した（既定の破片演出は出さない）、default = 共通処理へ */
export type StrikeStart = "handled" | "default";

/**
 * 敵の振る舞い（1 behavior = 1 インスタンス）。状態を持たない（registry が Object.freeze する）。
 * クラスに状態を持たせるとリプレイがずれるので、敵ごとの作業領域は e.ai に置く。数値は def と data/tuning の ENEMY_AI から読む。
 * 第 1 段では基本パラメータ・canBeginAttack・aimFixedAtWindup だけが system/enemies.ts から呼ばれる。
 * 残りのフックは第 2 段で switch から移す席（docs/ideas/oop-migration.md 2.3）
 */
export abstract class EnemyBehaviorBase {
  constructor(readonly key: EnemyBehavior) {}

  // ---- 基本パラメータ（親で既定、子で上書き。第 2 段で enemies.json の BEHAVIOR へ移す） ----
  /** strike 中の移動倍率（def.speed に掛ける）。0 はその場で攻撃 */
  readonly strikeSpeedMul: number = 0;
  /** 予備動作中の移動倍率。0 は止まる */
  readonly windupMoveMul: number = 0;
  /** 保つ距離（px）。undefined は保たない */
  readonly keepAway: number | undefined = undefined;
  /** その場から動かない（追わない・押されない） */
  readonly stationary: boolean = false;
  /** 沈黙で予備動作に入れない・取り消される（射撃・詠唱・鐘・指揮） */
  readonly silenceable: boolean = false;

  // ---- フック（状態機械の各段。既定は「何もしない / 共通処理へ」） ----
  /** 毎ステップ、状態機械の前（位置の記録・蘇生の時計） */
  beforeAct(_state: GameState, _e: Enemy, _def: EnemyDef, _dt: number): void {}
  /** 攻撃を始めてよいか（沈黙は共通側が見る） */
  canBeginAttack(_state: GameState, _e: Enemy, _def: EnemyDef, _d: number): boolean {
    return true;
  }
  /** 追跡中の進み方。undefined なら共通（flank か直進） */
  chaseMove(_state: GameState, _e: Enemy, _def: EnemyDef, _dir: Vec, _perp: Vec, _side: number, _d: number): Vec | undefined {
    return undefined;
  }
  /** 予備動作の始まり: 予告（影・線）を置く */
  telegraph(_state: GameState, _e: Enemy, _def: EnemyDef, _dir: Vec): void {}
  /** 狙いを予備動作の始まりで固定するか（避けた側が勝つ） */
  aimFixedAtWindup(_e: Enemy, _def: EnemyDef): boolean {
    return false;
  }
  /** 攻撃の出だし */
  beginStrike(_state: GameState, _e: Enemy, _def: EnemyDef): StrikeStart {
    return "default";
  }
  /** strike 中、毎ステップ（移動と接触判定は共通側） */
  tickStrike(_state: GameState, _e: Enemy, _def: EnemyDef, _dt: number): void {}
  /** strike 中の移動倍率（技によって変える敵だけ上書き） */
  strikeSpeedMulFor(_e: Enemy, _def: EnemyDef): number {
    return this.strikeSpeedMul;
  }
  /** 攻撃の終わり（連続攻撃・跡の処理は共通側） */
  onStrikeEnd(_state: GameState, _e: Enemy, _def: EnemyDef, _byWall: boolean): void {}
  /** 隙の間、毎ステップ（一撃離脱の後退など） */
  tickRecover(_state: GameState, _e: Enemy, _def: EnemyDef, _toPlayer: Vec, _dt: number): void {}
  /** 隙の終わり */
  onRecoverEnd(_state: GameState, _e: Enemy, _def: EnemyDef): void {}
  /** 描画向け: 予備動作中の予告の形（render は state を読むだけ。ここも状態を書かない） */
  telegraphShape(_e: Enemy, _def: EnemyDef): EnemyTelegraph {
    return null;
  }
}
