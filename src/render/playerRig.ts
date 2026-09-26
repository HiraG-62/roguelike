/**
 * 高精細のプレイヤーの組み立て（docs/ideas/player-sprites.md 6 章）。体のシートの選び方・武器種ごとの構え・
 * 手と武器の位置・腕の関節と画素を決める純関数。描くのは renderer.ts（drawRiggedPlayer）。
 *
 * 座標は「組み立ての空間」: 絵のドット（論理 0.5px）、右向き、原点 = 足元の中心、+y = 画面の下。
 * 左を向いているときは照準を左右に写して右向きで組み、最後に絵ごと反転する
 */
import type { MovesetKey } from "../data/weapons";
import type { WeaponPose } from "./renderMath";
import { poseReachRatio, swingSign } from "./renderMath";

export type BodyClip = "idle" | "walk" | "dash" | "windup" | "strike" | "hit";

/** 体のシートの枚数（scripts/actor/rig.mjs の BODY_CLIPS と同じ） */
export const BODY_CLIP_FRAMES: Readonly<Record<BodyClip, number>> = { idle: 8, walk: 8, dash: 2, windup: 1, strike: 1, hit: 1 };

/** 待機の呼吸の 1 巡（秒）と歩きの 1 枚（秒。8 枚で 2 歩） */
export const IDLE_PERIOD = 1.6;
export const WALK_FRAME_TIME = 0.075;

export interface BodyClipInput {
  readonly dashing: boolean;
  /** ダッシュの進み（0 → 1） */
  readonly dashProgress: number;
  readonly hit: boolean;
  readonly phase: "none" | "windup" | "active" | "recover";
  /** 溜め・構えを押している最中 */
  readonly holding: boolean;
  readonly moving: boolean;
  readonly walkTime: number;
  readonly time: number;
}

export interface BodyFrame {
  readonly clip: BodyClip;
  readonly frame: number;
}

function cycleFrame(time: number, period: number, frames: number): number {
  const k = (((time / period) % 1) + 1) % 1;
  return Math.min(frames - 1, Math.floor(k * frames));
}

/** 今の体のシートとフレーム。被弾 → ダッシュ → 攻撃（構え・振り）→ 歩き → 待機 の順 */
export function bodyClip(i: BodyClipInput): BodyFrame {
  if (i.hit) return { clip: "hit", frame: 0 };
  if (i.dashing) return { clip: "dash", frame: i.dashProgress < 0.5 ? 0 : 1 };
  if (i.phase === "windup" || (i.phase === "none" && i.holding)) return { clip: "windup", frame: 0 };
  if (i.phase === "active" || i.phase === "recover") return { clip: "strike", frame: 0 };
  if (i.moving) return { clip: "walk", frame: cycleFrame(i.walkTime, WALK_FRAME_TIME * BODY_CLIP_FRAMES.walk, BODY_CLIP_FRAMES.walk) };
  return { clip: "idle", frame: cycleFrame(i.time, IDLE_PERIOD, BODY_CLIP_FRAMES.idle) };
}

// ---------------------------------------------------------------------------
// 構え（武器種ごと）
// ---------------------------------------------------------------------------

/** 片手 / 両手（後ろの手を柄に添える）/ 二刀（後ろの手にもう 1 本） */
export type GripKind = "one" | "two" | "dual";

export interface Stance {
  readonly grip: GripKind;
  /** 待機の武器の向き（度。右向きの空間、0 = 前、負 = 上） */
  readonly restDeg: number;
  /** 待機の主の手（前の肩から、ドット） */
  readonly restHand: readonly [number, number];
  /** 待機で片刃の刃を写しの側へ向ける（刃を下・前へ） */
  readonly restMirror?: boolean;
  /** 二刀の後ろの手の待機（後ろの肩から、ドット）と向き（度） */
  readonly offHand?: readonly [number, number];
  readonly offDeg?: number;
  /** 待機の揺れ（度。呼吸に合わせて武器の先が上下する） */
  readonly swayDeg: number;
}

const ONE_HAND_REST: Stance = { grip: "one", restDeg: -40, restHand: [5, 7], swayDeg: 3 };

/**
 * 武器種ごとの待機の構え。無い武器種は片手の既定。
 * 剣は切っ先を前上へ、双剣は前の手を順手・後ろの手を逆手に、槍は両手で穂先を前へ水平に、銃は照準へ向ける（aimHeld）
 */
export const STANCES: Readonly<Partial<Record<MovesetKey, Stance>>> = {
  sword: { grip: "one", restDeg: -38, restHand: [6, 8], swayDeg: 3 },
  twinBlades: { grip: "dual", restDeg: -20, restHand: [7, 8], offHand: [-3, 9], offDeg: 150, swayDeg: 4 },
  spear: { grip: "two", restDeg: -8, restHand: [7, 9], swayDeg: 2 },
  sidearm: { grip: "one", restDeg: 0, restHand: [8, 4], swayDeg: 1 },
};

export function stanceOf(moveset: MovesetKey): Stance {
  return STANCES[moveset] ?? ONE_HAND_REST;
}

// ---------------------------------------------------------------------------
// 手と武器の位置
// ---------------------------------------------------------------------------

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** 手に持つ 1 本（または添え手だけ） */
export interface HeldPart {
  /** 手の位置（組み立ての空間） */
  readonly hand: Pt;
  /** 武器の向き（rad、組み立ての空間） */
  readonly angle: number;
  /** 片刃の刃を写しの側へ向ける */
  readonly mirror: boolean;
  /** 体の後ろに描く */
  readonly behind: boolean;
  /** 武器を描かない（両手持ちの添え手） */
  readonly bare: boolean;
}

export interface RigPose {
  /** 前の手（主の武器） */
  readonly front: HeldPart;
  /** 後ろの手（二刀のもう 1 本・両手持ちの添え手）。片手の武器なら体の脇に垂らす */
  readonly back: HeldPart;
}

export interface RigInput {
  readonly stance: Stance;
  /** 攻撃中・構え中の武器の姿勢（renderMath.ts の weaponPose。画面の空間）。待機なら undefined */
  readonly swing: WeaponPose | undefined;
  /** 振っている段（二刀はこれで振る手を選ぶ） */
  readonly step: number;
  /** 照準（画面の角） */
  readonly aim: number;
  /** 照準へ向けて持つ（銃の家系） */
  readonly aimHeld: boolean;
  readonly facingRight: boolean;
  /** 前の肩・後ろの肩（体のシートの位置の印、組み立ての空間） */
  readonly shoulderF: Pt;
  readonly shoulderB: Pt;
  /** 待機の揺れの位相（秒） */
  readonly time: number;
  /** 両手持ちの添え手の位置（握りから +x へ、ドット。武器の meta.offGrip） */
  readonly offGrip: number | null;
}

/** 腕を伸ばしきらない手の距離（肩から、ドット）。振りの半径 */
export const ARM_REACH = 10;
/** 銃を照準へ向けて伸ばす距離と、構える高さ（肩からドットで下へ。銃身が顔に掛からない） */
const AIM_REACH = 9;
const AIM_DROP = 3;
/** 両手持ちの振りは腰の高さで（肩から下へ。長柄が顔を横切らない） */
const TWO_HAND_DROP = 3;
const DEG = Math.PI / 180;
/** これより上を向いたら体の後ろ（sin の値） */
const BEHIND_SIN = -0.38;
/** 片手の武器の間、空いた後ろの手を垂らす位置（後ろの肩から） */
const FREE_HAND: Pt = { x: -1, y: 9 };

/** 画面の角 → 組み立ての空間の角（左向きなら左右に写す） */
export function toRigAngle(angle: number, facingRight: boolean): number {
  return facingRight ? angle : Math.PI - angle;
}

function at(o: Pt, angle: number, d: number): Pt {
  return { x: o.x + Math.cos(angle) * d, y: o.y + Math.sin(angle) * d };
}

function part(hand: Pt, angle: number, mirror: boolean, bare = false, behind?: boolean): HeldPart {
  return { hand, angle, mirror, behind: behind ?? Math.sin(angle) < BEHIND_SIN, bare };
}

/** 待機の揺れ（呼吸の周期で上下） */
function sway(time: number, deg: number): number {
  return Math.sin((time / IDLE_PERIOD) * Math.PI * 2) * deg * DEG;
}

/** 振りの向きの符号（組み立ての空間で時計回りなら +1）。左向きでは写すので逆 */
function rigSwingSign(step: number, facingRight: boolean): number {
  return swingSign(step) * (facingRight ? 1 : -1);
}

/** 手と武器の位置を決める */
export function solveRig(i: RigInput): RigPose {
  const main = mainPart(i);
  const back = backPart(i, main);
  return { front: main, back };
}

function restPart(i: RigInput): HeldPart {
  const s = i.stance;
  const angle = s.restDeg * DEG + sway(i.time, s.swayDeg);
  const hand = { x: i.shoulderF.x + s.restHand[0], y: i.shoulderF.y + s.restHand[1] };
  return part(hand, angle, s.restMirror ?? false);
}

function mainPart(i: RigInput): HeldPart {
  const dualOffSwing = i.stance.grip === "dual" && i.swing !== undefined && swingSign(i.step) < 0;
  if (i.swing && !dualOffSwing) {
    const angle = toRigAngle(i.swing.angle, i.facingRight);
    const reach = ARM_REACH * poseReachRatio(i.swing);
    const drop = i.stance.grip === "two" ? TWO_HAND_DROP : 0;
    return part(at({ x: i.shoulderF.x, y: i.shoulderF.y + drop }, angle, reach), angle, rigSwingSign(i.step, i.facingRight) > 0);
  }
  if (i.aimHeld) {
    const angle = toRigAngle(i.aim, i.facingRight) + sway(i.time, i.stance.swayDeg);
    return part(at({ x: i.shoulderF.x, y: i.shoulderF.y + AIM_DROP }, angle, AIM_REACH), angle, false, false, false);
  }
  return restPart(i);
}

function backPart(i: RigInput, main: HeldPart): HeldPart {
  const s = i.stance;
  if (s.grip === "two" && i.offGrip !== null) {
    return part(at(main.hand, main.angle, i.offGrip), main.angle, false, true, main.behind);
  }
  if (s.grip === "dual") {
    if (i.swing && swingSign(i.step) < 0) {
      const angle = toRigAngle(i.swing.angle, i.facingRight);
      const reach = ARM_REACH * poseReachRatio(i.swing);
      return part(at(i.shoulderB, angle, reach), angle, rigSwingSign(i.step, i.facingRight) > 0, false, true);
    }
    const off = s.offHand ?? [0, 8];
    const angle = (s.offDeg ?? 150) * DEG - sway(i.time, s.swayDeg);
    return part({ x: i.shoulderB.x + off[0], y: i.shoulderB.y + off[1] }, angle, false, false, true);
  }
  return part({ x: i.shoulderB.x + FREE_HAND.x, y: i.shoulderB.y + FREE_HAND.y }, Math.PI / 2, false, true, true);
}

// ---------------------------------------------------------------------------
// 腕
// ---------------------------------------------------------------------------

/** 上腕・前腕の長さ（ドット） */
export const UPPER_ARM = 5.5;
export const FOREARM = 5.5;

/**
 * 肩と手から肘を解く（2 本の骨）。届かなければ手へ向けてまっすぐ伸ばした点。
 * 肘は下（+y）へ曲げる（腕を体の脇に畳んで見える）
 */
export function elbowOf(shoulder: Pt, hand: Pt, upper = UPPER_ARM, fore = FOREARM): Pt {
  const dx = hand.x - shoulder.x;
  const dy = hand.y - shoulder.y;
  const d = Math.hypot(dx, dy);
  if (d >= upper + fore || d < 1e-6) return at(shoulder, Math.atan2(dy, dx), upper * Math.min(1, d / (upper + fore) || 1));
  const a = Math.acos(Math.min(1, Math.max(-1, (upper * upper + d * d - fore * fore) / (2 * upper * d))));
  const base = Math.atan2(dy, dx);
  const e1 = at(shoulder, base + a, upper);
  const e2 = at(shoulder, base - a, upper);
  return e1.y >= e2.y ? e1 : e2;
}

/** 腕の画素の色の番号: 0 = 輪郭、1〜3 = 袖（暗・基・明）、4〜6 = 手（暗・基・明） */
export type ArmInk = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export interface ArmPixel {
  readonly x: number;
  readonly y: number;
  readonly ink: ArmInk;
}

const SLEEVE_R = 1.9;
const HAND_R = 2.1;
/** 画面の光（左上）。生成器の scripts/actor/paint.mjs と同じ向き */
const LIGHT_X = -0.62;
const LIGHT_Y = -0.78;

function segDist(p: Pt, a: Pt, b: Pt): { d: number; nx: number; ny: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const ex = p.x - (a.x + dx * t);
  const ey = p.y - (a.y + dy * t);
  const d = Math.hypot(ex, ey);
  return { d, nx: d > 0 ? ex / d : 0, ny: d > 0 ? ey / d : 0 };
}

function shadeInk(nx: number, ny: number, k: number, base: 1 | 4): ArmInk {
  const light = (nx * LIGHT_X + ny * LIGHT_Y) * k;
  const step = light > 0.35 ? 2 : light > -0.3 ? 1 : 0;
  return (base + step) as ArmInk;
}

/**
 * 腕の画素（肩 → 肘 → 手の円柱と拳）。整数の格子（ドット）で返す。外周の 1 ドットは輪郭。
 * withHand が false なら拳を描かない（手を武器の絵が持つ爪・籠手など）
 */
export function armPixels(shoulder: Pt, elbow: Pt, hand: Pt, withHand = true): ArmPixel[] {
  const pts = [shoulder, elbow, hand];
  const pad = HAND_R + 2;
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x)) - pad);
  const x1 = Math.ceil(Math.max(...pts.map((p) => p.x)) + pad);
  const y0 = Math.floor(Math.min(...pts.map((p) => p.y)) - pad);
  const y1 = Math.ceil(Math.max(...pts.map((p) => p.y)) + pad);
  const out: ArmPixel[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = { x: x + 0.5, y: y + 0.5 };
      const hd = Math.hypot(c.x - hand.x, c.y - hand.y);
      if (withHand && hd <= HAND_R) {
        out.push({ x, y, ink: shadeInk((c.x - hand.x) / HAND_R, (c.y - hand.y) / HAND_R, 1, 4) });
        continue;
      }
      const u = segDist(c, shoulder, elbow);
      const f = segDist(c, elbow, hand);
      const s = u.d < f.d ? u : f;
      if (s.d <= SLEEVE_R) {
        out.push({ x, y, ink: shadeInk(s.nx, s.ny, s.d / SLEEVE_R, 1) });
        continue;
      }
      // 肩の付け根には輪郭を引かない（胴と袖がつながって見えるように）
      const nearShoulder = Math.hypot(c.x - shoulder.x, c.y - shoulder.y) < SLEEVE_R + 1.5;
      if ((s.d <= SLEEVE_R + 1 && !nearShoulder) || (withHand && hd <= HAND_R + 1)) out.push({ x, y, ink: 0 });
    }
  }
  return out;
}
