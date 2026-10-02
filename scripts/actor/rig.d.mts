// rig.mjs の型（src のテストから歩きの足運びを検査するため。使う分だけ）
export interface Foot {
  readonly x: number;
  readonly lift: number;
}
export interface Pose {
  readonly bob: number;
  readonly lean: number;
  readonly footF: Foot;
  readonly footB: Foot;
}
export interface BodyClipDef {
  readonly name: string;
  readonly frames: number;
  pose(frame: number): Pose;
}
export const WALK_FRAMES: number;
export const BODY_CLIPS: readonly BodyClipDef[];
