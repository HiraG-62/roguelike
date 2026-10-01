/**
 * 高精細のプレイヤーの組み立て（docs/ideas/player-sprites.md 6 章）。体のシートの選び方・武器種ごとの構え・
 * 手と武器の位置・腕の関節と画素を決める純関数。描くのは renderer.ts（drawRiggedPlayer）。
 *
 * 座標は「組み立ての空間」: 絵のドット（論理 0.5px）、右向き、原点 = 足元の中心、+y = 画面の下。
 * 左を向いているときは照準を左右に写して右向きで組み、最後に絵ごと反転する
 */
import type { WeaponPose } from "./renderMath";
import { poseReachRatio, swingSign } from "./renderMath";

/** 待機の構えの系統（scripts/actor/rig.mjs の IDLE_STANCES と同じ） */
export type IdleStance = "ready" | "heavy" | "light" | "aim";
export type IdleClip = "idleReady" | "idleHeavy" | "idleLight" | "idleAim";
/** 攻撃の体のコマ（scripts/actor/rig.mjs の ATTACK_KEYS と同じ名前）。振り下ろし・斬り上げ・叩きつけ・突き・回転 */
export type AttackClip = "atkSlash" | "atkRise" | "atkSlam" | "atkThrust" | "atkSpin";
export type BodyClip = IdleClip | "walk" | "dash" | "windup" | "strike" | "hit" | AttackClip;

const IDLE_CLIP: Readonly<Record<IdleStance, IdleClip>> = { ready: "idleReady", heavy: "idleHeavy", light: "idleLight", aim: "idleAim" };
const IDLE_FRAMES = 8;
/** 攻撃の体のコマの枚数（0-1 予備動作 / 2-3 振り / 4 振り抜き / 5 戻し） */
export const ATTACK_FRAMES = 6;

/** 体のシートの枚数（scripts/actor/rig.mjs の BODY_CLIPS と同じ） */
export const BODY_CLIP_FRAMES: Readonly<Record<BodyClip, number>> = {
  idleReady: IDLE_FRAMES,
  idleHeavy: IDLE_FRAMES,
  idleLight: IDLE_FRAMES,
  idleAim: IDLE_FRAMES,
  walk: 8,
  dash: 2,
  windup: 1,
  strike: 1,
  hit: 1,
  atkSlash: ATTACK_FRAMES,
  atkRise: ATTACK_FRAMES,
  atkSlam: ATTACK_FRAMES,
  atkThrust: ATTACK_FRAMES,
  atkSpin: ATTACK_FRAMES,
};

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
  /** 待機の構え（武器種の Stance.body） */
  readonly idle: IdleStance;
  /** 今の振りの体のコマ（attackClip）。無ければ共通の構え 1 枚・振り抜き 1 枚 */
  readonly attack?: AttackClip;
  /** phase の進み（0 → 1） */
  readonly t?: number;
}

export interface BodyFrame {
  readonly clip: BodyClip;
  readonly frame: number;
}

function cycleFrame(time: number, period: number, frames: number): number {
  const k = (((time / period) % 1) + 1) % 1;
  return Math.min(frames - 1, Math.floor(k * frames));
}

/** 予備動作・振り・戻しを 2 枚ずつに割る境目（進み）。振りは頭の鞭で角度を稼ぐので早めに伸び切りのコマへ */
const WINDUP_SPLIT = 0.5;
const ACTIVE_SPLIT = 0.35;
const RECOVER_SPLIT = 0.35;

/** 攻撃のコマの番号（0-1 予備動作 / 2-3 振り / 4-5 戻し） */
export function attackFrame(phase: "windup" | "active" | "recover", t: number): number {
  if (phase === "windup") return t < WINDUP_SPLIT ? 0 : 1;
  if (phase === "active") return t < ACTIVE_SPLIT ? 2 : 3;
  return t < RECOVER_SPLIT ? 4 : 5;
}

/**
 * 振りの形から体のコマを選ぶ。突き・構えて押す武器 = 突き、自分の周りの円 = 回転、
 * 重い振り下ろし（重い段・重い構えの箱）= 叩きつけ、それ以外の扇・箱は組み立ての空間での振る向き（rigSign。
 * + = 上から振り下ろす）で振り下ろし / 斬り上げ
 */
export function attackClip(shape: "arc" | "box" | "thrust" | "circle", rigSign: number, heavy: boolean, stance: Pick<Stance, "body" | "braced">): AttackClip {
  if (shape === "thrust" || stance.braced) return "atkThrust";
  if (shape === "circle") return "atkSpin";
  if (shape === "box" && (heavy || stance.body === "heavy")) return "atkSlam";
  return rigSign > 0 ? "atkSlash" : "atkRise";
}

/** 今の体のシートとフレーム。被弾 → ダッシュ → 攻撃（構え・振り）→ 歩き → 待機 の順 */
export function bodyClip(i: BodyClipInput): BodyFrame {
  if (i.hit) return { clip: "hit", frame: 0 };
  if (i.dashing) return { clip: "dash", frame: i.dashProgress < 0.5 ? 0 : 1 };
  if (i.attack && i.phase !== "none") return { clip: i.attack, frame: attackFrame(i.phase, i.t ?? 0) };
  if (i.phase === "windup" || (i.phase === "none" && i.holding)) return { clip: "windup", frame: 0 };
  if (i.phase === "active" || i.phase === "recover") return { clip: "strike", frame: 0 };
  if (i.moving) return { clip: "walk", frame: cycleFrame(i.walkTime, WALK_FRAME_TIME * BODY_CLIP_FRAMES.walk, BODY_CLIP_FRAMES.walk) };
  return { clip: IDLE_CLIP[i.idle], frame: cycleFrame(i.time, IDLE_PERIOD, IDLE_FRAMES) };
}

// ---------------------------------------------------------------------------
// 構え（武器種ごと）
// ---------------------------------------------------------------------------

/** 片手 / 両手（後ろの手を柄に添える）/ 二刀（後ろの手にもう 1 本） */
export type GripKind = "one" | "two" | "dual";

export interface Stance {
  readonly grip: GripKind;
  /** 待機の体の構え */
  readonly body: IdleStance;
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
  /** 手にはめる武器（爪・籠手）。拳を描かず、武器の絵が手になる（腕の上に重ねる） */
  readonly worn?: boolean;
  /** 振りの間も武器を照準へ向けたまま突き出す（大盾。面を敵へ向けて押す） */
  readonly braced?: boolean;
  /** 箱の振りをまっすぐ打ち出す拳にする（拳。左右の拳を交互に突き出す） */
  readonly punch?: boolean;
  /** 二刀の後ろの手を体の前に構える（拳の両拳の構え）。省けば後ろの手は体の後ろ */
  readonly offFront?: boolean;
  /**
   * 待機・歩きの主の手を、武器の向きによらず体の前に描く（爪）。待機の向きが上寄りで、呼吸の揺れで境目
   * （BEHIND_SIN）をまたぐと、手前の手が体の後ろへ出入りして見え隠れするため
   */
  readonly restFront?: boolean;
  /** 撃った反動の大きさ（1 = 片手銃。大筒・長銃は大きく、二丁拳銃は小さく）。省けば 1 */
  readonly recoil?: number;
}

/** 構えを持たない武器の既定（片手で切っ先を前上へ） */
export const DEFAULT_STANCE: Stance = { grip: "one", body: "ready", restDeg: -40, restHand: [5, 7], swayDeg: 3 };

const GRIPS: readonly GripKind[] = ["one", "two", "dual"];
const IDLE_STANCES: readonly IdleStance[] = ["ready", "heavy", "light", "aim"];

function isPair(v: unknown): v is readonly [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * 武器の絵の付帯情報（生成器の `meta.stance`）から構えを読む。武器種ごとの構えは武器の絵のファイル
 * （scripts/actor/sheets/wpn<武器種>.mjs）が持つ（武器を足す人が共有の表を触らずに済むように）。
 * 形が崩れていれば既定の構え
 */
export function stanceFromMeta(raw: unknown): Stance {
  if (typeof raw !== "object" || raw === null) return DEFAULT_STANCE;
  const r = raw as Record<string, unknown>;
  const grip = GRIPS.find((g) => g === r.grip);
  const body = IDLE_STANCES.find((b) => b === r.body);
  const restDeg = num(r.restDeg);
  const swayDeg = num(r.swayDeg);
  if (!grip || !body || restDeg === undefined || swayDeg === undefined || !isPair(r.restHand)) return DEFAULT_STANCE;
  return {
    grip,
    body,
    restDeg,
    restHand: r.restHand,
    swayDeg,
    ...(r.restMirror === true ? { restMirror: true } : {}),
    ...(isPair(r.offHand) ? { offHand: r.offHand } : {}),
    ...(num(r.offDeg) !== undefined ? { offDeg: num(r.offDeg) } : {}),
    ...(r.worn === true ? { worn: true } : {}),
    ...(r.braced === true ? { braced: true } : {}),
    ...(r.punch === true ? { punch: true } : {}),
    ...(r.offFront === true ? { offFront: true } : {}),
    ...(r.restFront === true ? { restFront: true } : {}),
    ...(num(r.recoil) !== undefined ? { recoil: num(r.recoil) } : {}),
  };
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
  /**
   * 両手で構えた銃の持ち方: 後ろの肩の腕が握り（front の手）を持って銃の奥に隠れ、前の肩の腕が先台（back の手）を支えて
   * 手前に出る（腕が交差せず、両腕とも手前に見えない）
   */
  readonly gunHold?: boolean;
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
  /** 弾の出る高さ（自分の中心、組み立ての空間）。銃は銃身の線がここを通るように構える */
  readonly aimOrigin: Pt;
  /** 銃身が握りの線からずれている量（武器の絵の銃口の印の y、ドット。上なら負） */
  readonly barrelY: number;
  /** 画面での振る向き（renderMath の screenSwingSign）。省けば段の偶奇 */
  readonly sign?: number;
  /** 撃った反動の強さ（0..1、recoilOf）。銃を後ろへ引き、銃口を跳ね上げる */
  readonly kick?: number;
  /** 戻しの後半で待機の構えへ寄せる割合（0 = 振り抜いたまま、1 = 待機の構え。restBlendOf） */
  readonly restBlend?: number;
  /**
   * 武器の絵が向きを持たず回さない（書。シートの向きが 1）。上を向いても頭の後ろへ回さず体の前に描く
   * （回る武器は肩に担いで見えるが、回さない絵は後ろへ回すと本が体に隠れてほぼ見えなくなる）
   */
  readonly unrotated?: boolean;
}

/** 腕を伸ばしきらない手の距離（肩から、ドット）。振りの半径 */
export const ARM_REACH = 10;
/** 銃の握りを自分の中心から照準へ出す距離（ドット） */
const AIM_REACH = 10;
/** 両手持ちの振りは腰の高さで（肩から下へ。長柄が顔を横切らない） */
const TWO_HAND_DROP = 3;
const DEG = Math.PI / 180;
/** これより上を向いたら体の後ろ（sin の値） */
const BEHIND_SIN = -0.38;
/** 回さない武器の拳を上げる高さの上限（sin の値。これより上を狙っても拳はここまで。約 44 度） */
const UNROTATED_UP_SIN = -0.7;
const FORWARD_COS_EPS = 1e-6;
/** 二丁の銃の後ろの手の銃（前の手から、ドット）。後ろの肩から届く所 */
const DUAL_AIM_OFFSET: Pt = { x: -4, y: 2 };
/** 銃の握りを照準へ出す距離の下限（ドット。負なら自分の中心より後ろ。長銃は肩の後ろまで引いて先台を持つ） */
const AIM_REACH_MIN = -8;
const AIM_REACH_STEP = 0.5;
/** 腕を伸ばしきらずに届く距離（上腕 + 前腕より少し短く。肘がわずかに曲がって見える） */
const ARM_SPAN = 10.5;
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
function rigSwingSign(i: Pick<RigInput, "sign" | "step" | "facingRight">): number {
  return (i.sign ?? swingSign(i.step)) * (i.facingRight ? 1 : -1);
}

/** 撃った反動: 戻るまでの秒と、1 のときに銃を引く距離（ドット）・銃口を跳ね上げる角 */
export const RECOIL_TIME = 0.16;
const RECOIL_BACK = 2.5;
const RECOIL_CLIMB = 12 * DEG;

/** 撃ってからの秒 → 反動の強さ（撃った瞬間 1、RECOIL_TIME で 0。頭で速く戻る 2 乗の減衰） */
export function recoilOf(age: number): number {
  if (!(age >= 0) || age >= RECOIL_TIME) return 0;
  const u = 1 - age / RECOIL_TIME;
  return u * u;
}

/** 戻しのうち、振り抜いたまま止める割合（残心）。その後は待機の構えへ寄せる */
const REST_BLEND_FROM = 0.45;

/**
 * 戻しの進みから待機の構えへ寄せる割合。戻しの前半は振り抜いた形で残心を見せ、後半で構え直す
 * （重い武器の長い戻しで刃を下へ向けたまま止まって見えない。次の段へつながって読める）
 */
export function restBlendOf(phase: "none" | "windup" | "active" | "recover", t: number): number {
  if (phase !== "recover") return 0;
  const k = Math.min(1, Math.max(0, (t - REST_BLEND_FROM) / (1 - REST_BLEND_FROM)));
  return k * k * (3 - 2 * k);
}

/** -π..π に畳む（組み立ての空間の 0 = 前、±π = 真後ろ） */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 2 つの角の間。構え直しは必ず体の前を通す（-π..π で線形に寄せれば真後ろ ±π を横切らない） */
function lerpAngle(a: number, b: number, k: number): number {
  const from = wrapAngle(a);
  return from + (wrapAngle(b) - from) * k;
}

/** 振りの持ち方から待機の持ち方へ寄せる。刃の写しと前後は半分を越えたら待機の側 */
function blendPart(from: HeldPart, to: HeldPart, k: number): HeldPart {
  if (k <= 0) return from;
  if (k >= 1) return to;
  const angle = lerpAngle(from.angle, to.angle, k);
  const late = k >= 0.5;
  // 振りの形と待機の形で前後が揃っていればそのまま（二刀の後ろの手は寄せる途中で体の前へ出ない）。
  // 食い違うときだけ寄せた角で決める
  const behind = from.behind === to.behind ? from.behind : Math.sin(angle) < BEHIND_SIN;
  return {
    hand: { x: from.hand.x + (to.hand.x - from.hand.x) * k, y: from.hand.y + (to.hand.y - from.hand.y) * k },
    angle,
    mirror: late ? to.mirror : from.mirror,
    behind,
    bare: from.bare,
  };
}

/** 手と武器の位置を決める */
export function solveRig(i: RigInput): RigPose {
  const k = i.restBlend ?? 0;
  if (k > 0 && i.swing) {
    const idle: RigInput = { ...i, swing: undefined };
    const swingMain = mainPart(i);
    const restMain = mainPart(idle);
    const blended = blendPart(swingMain, restMain, k);
    // 待機で体の前に構える手は、構え直しの後半（待機の側）に入ったら、寄せた角が境目をまたいでも後ろへ戻さない
    const main = i.stance.restFront === true && k >= 0.5 ? { ...blended, behind: false } : blended;
    const back = blendPart(backPart(i, swingMain), backPart(idle, restMain), k);
    // 両手持ちの添え手は寄せた主の手から引き直す（柄から離れない）
    return { front: main, back: i.stance.grip === "two" && i.offGrip !== null ? backPart(i, main) : back };
  }
  const main = mainPart(i);
  const back = backPart(i, main);
  const gunHold = i.aimHeld && !i.swing && i.stance.grip === "two" && i.offGrip !== null;
  return gunHold ? { front: main, back, gunHold } : { front: main, back };
}

/** 肩から腕の長さ（ARM_SPAN）を越える手は、肩へ向けて届く所まで引き寄せる */
function withinReach(hand: Pt, shoulder: Pt): Pt {
  const d = Math.hypot(hand.x - shoulder.x, hand.y - shoulder.y);
  if (d <= ARM_SPAN) return hand;
  const k = ARM_SPAN / d;
  return { x: shoulder.x + (hand.x - shoulder.x) * k, y: shoulder.y + (hand.y - shoulder.y) * k };
}

function restPart(i: RigInput): HeldPart {
  const s = i.stance;
  const angle = s.restDeg * DEG + sway(i.time, s.swayDeg);
  const hand = withinReach({ x: i.shoulderF.x + s.restHand[0], y: i.shoulderF.y + s.restHand[1] }, i.shoulderF);
  return part(hand, angle, s.restMirror ?? false, false, s.restFront === true ? false : undefined);
}

function mainPart(i: RigInput): HeldPart {
  const dualOffSwing = i.stance.grip === "dual" && i.swing !== undefined && swingSign(i.step) < 0;
  if (i.swing && !dualOffSwing) {
    // 構えたまま押す武器は向きを照準に保ち、振りの伸び縮みだけを手の距離に使う
    const angle = toRigAngle(i.stance.braced ? i.aim : i.swing.angle, i.facingRight);
    const reach = swingHandReach(i.swing);
    const drop = i.stance.grip === "two" ? TWO_HAND_DROP : 0;
    const handAngle = i.unrotated ? tiltedForward(angle) : angle;
    const hand = withinReach(at({ x: i.shoulderF.x, y: i.shoulderF.y + drop }, handAngle, reach), i.shoulderF);
    return part(hand, angle, rigSwingSign(i) > 0, false, i.unrotated ? false : undefined);
  }
  if (i.aimHeld) {
    // 銃身の線が弾の出る位置（自分の中心から照準の向き）を通るように、握りを銃身のずれの分だけ反対へ寄せる。
    // 描いた銃口と弾・銃口の閃光の出る線が揃う
    const kick = (i.kick ?? 0) * (i.stance.recoil ?? 1);
    const aimAngle = toRigAngle(i.aim, i.facingRight);
    // 反動で銃口が上（組み立ての空間の -y）へ跳ねる。真上・真下を狙っているときも体の外側へ跳ねる
    const angle = aimAngle + sway(i.time, i.stance.swayDeg) - Math.sign(Math.cos(aimAngle) || 1) * RECOIL_CLIMB * kick;
    const reach = aimReach(i, aimAngle, angle);
    return part(aimGrip(i, aimAngle, angle, reach - RECOIL_BACK * kick), angle, false, false, false);
  }
  return restPart(i);
}

/** 照準へ reach だけ出した銃の握り（銃身の線が弾の出る位置を通るように、銃身のずれの分だけ反対へ寄せる） */
function aimGrip(i: RigInput, aimAngle: number, angle: number, reach: number): Pt {
  const grip = at(i.aimOrigin, aimAngle, reach);
  return { x: grip.x + Math.sin(angle) * i.barrelY, y: grip.y - Math.cos(angle) * i.barrelY };
}

/** 銃を握る腕と、もう一方の手（先台・二丁のもう 1 挺）を持つ腕 */
function aimArms(i: RigInput): { grip: Pt; other: Pt } {
  return i.stance.grip === "two" ? { grip: i.shoulderB, other: i.shoulderF } : { grip: i.shoulderF, other: i.shoulderB };
}

/** もう一方の手の位置（握りから。無ければ null） */
function aimOtherHand(i: RigInput, hand: Pt, angle: number): Pt | null {
  if (i.stance.grip === "two" && i.offGrip !== null) return at(hand, angle, i.offGrip);
  if (i.stance.grip === "dual") return { x: hand.x + DUAL_AIM_OFFSET.x, y: hand.y + DUAL_AIM_OFFSET.y };
  return null;
}

/**
 * 銃の握りを照準へ出す距離。両手とも腕を伸ばしきらずに届く、いちばん前の距離を選ぶ（長い銃ほど手前へ引いて構える）。
 * どこでも届かなければ、届かない量がいちばん小さい距離
 */
function aimReach(i: RigInput, aimAngle: number, angle: number): number {
  const arms = aimArms(i);
  const over = (hand: Pt, shoulder: Pt): number => Math.max(0, Math.hypot(hand.x - shoulder.x, hand.y - shoulder.y) - ARM_SPAN);
  let best = AIM_REACH;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let r = AIM_REACH; r >= AIM_REACH_MIN; r -= AIM_REACH_STEP) {
    const hand = aimGrip(i, aimAngle, angle, r);
    const other = aimOtherHand(i, hand, angle);
    const cost = over(hand, arms.grip) + (other ? over(other, arms.other) : 0);
    if (cost <= 0) return r;
    if (cost < bestCost) {
      bestCost = cost;
      best = r;
    }
  }
  return best;
}

/**
 * 回さない武器（書）の拳の向き: 真上近くを狙っても拳を肩の真上へ上げず、前へ倒した所に置く
 * （真上に上げると本が顔を隠す。本は回さないので拳の位置だけずらせば照準は変わらない）
 */
function tiltedForward(angle: number): number {
  if (Math.sin(angle) >= UNROTATED_UP_SIN) return angle;
  // 真上の cos は浮動小数の誤差で ±1e-16 になるので、わずかな負は前とみなす（後ろへ倒さない）
  return Math.cos(angle) > -FORWARD_COS_EPS ? Math.asin(UNROTATED_UP_SIN) : Math.PI - Math.asin(UNROTATED_UP_SIN);
}

/**
 * 振りの間の拳の距離（肩から）。振りの伸び・突きの突き出しで伸ばすが、腕の長さ（ARM_SPAN）を越えない
 * （越えると腕が引き伸ばされて見える。突きの伸びは体の踏み込み・肩の入れが受け持つ）
 */
function swingHandReach(swing: WeaponPose): number {
  return Math.min(ARM_REACH * poseReachRatio(swing), ARM_SPAN);
}

/** 両手持ちの添え手が柄を滑れる範囲（offGrip に掛ける倍率。柄の尻の側・握りの側） */
const OFF_GRIP_SLIDE_FAR = 1.5;
const OFF_GRIP_SLIDE_NEAR = 0.35;
const OFF_GRIP_SLIDE_STEP = 0.5;
/** 添え手を離すまでに許す届かなさ（ドット。少しなら腕を伸ばしきって持つ） */
const OFF_GRIP_RELEASE = 0.5;

/**
 * 両手持ちの添え手の柄の上の位置（握りから +x へ、ドット）。既定の offGrip で後ろの肩から届けばそこ、届かなければ
 * 柄の上を滑らせて届くうち offGrip にいちばん近い所、どこも届かなければいちばん肩に近い所
 * （武器が上や下を向いても後ろの腕が引き伸ばされない）。構えた銃は先台の位置のまま
 */
function slideOffGrip(i: RigInput, main: HeldPart, offGrip: number): number {
  if (i.aimHeld && !i.swing) return offGrip;
  const distAt = (u: number): number => {
    const h = at(main.hand, main.angle, u);
    return Math.hypot(h.x - i.shoulderB.x, h.y - i.shoulderB.y);
  };
  if (distAt(offGrip) <= ARM_SPAN) return offGrip;
  const a = offGrip * OFF_GRIP_SLIDE_NEAR;
  const b = offGrip * OFF_GRIP_SLIDE_FAR;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let reachable: number | null = null;
  let nearest = offGrip;
  let nearestDist = distAt(offGrip);
  for (let u = lo; u <= hi; u += OFF_GRIP_SLIDE_STEP) {
    const d = distAt(u);
    if (d <= ARM_SPAN && (reachable === null || Math.abs(u - offGrip) < Math.abs(reachable - offGrip))) reachable = u;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = u;
    }
  }
  return reachable ?? nearest;
}

function backPart(i: RigInput, main: HeldPart): HeldPart {
  const s = i.stance;
  if (s.grip === "two" && i.offGrip !== null) {
    const hand = at(main.hand, main.angle, slideOffGrip(i, main, i.offGrip));
    // 柄を滑らせても届かなければ手を離し、体の脇へ下ろす（重い武器の振り抜きを片手で流す）。
    // 構えた銃の先台は前の腕が持つ（aimReach が届く所に銃を置く）ので離さない
    const aimedGun = i.aimHeld && !i.swing;
    if (!aimedGun && Math.hypot(hand.x - i.shoulderB.x, hand.y - i.shoulderB.y) > ARM_SPAN + OFF_GRIP_RELEASE) return freeHand(i);
    return part(hand, main.angle, false, true, main.behind);
  }
  if (s.grip === "dual") {
    // 二丁の銃は両手とも照準へ向け、後ろの手の銃を少し奥・下へずらして並べる
    if (i.aimHeld && !i.swing) {
      return part({ x: main.hand.x + DUAL_AIM_OFFSET.x, y: main.hand.y + DUAL_AIM_OFFSET.y }, main.angle, false, false, true);
    }
    if (i.swing && swingSign(i.step) < 0) {
      const angle = toRigAngle(i.swing.angle, i.facingRight);
      const reach = swingHandReach(i.swing);
      return part(at(i.shoulderB, angle, reach), angle, rigSwingSign(i) > 0, false, true);
    }
    const off = s.offHand ?? [0, 8];
    const angle = (s.offDeg ?? 150) * DEG - sway(i.time, s.swayDeg);
    // 後ろの手は体の後ろ。構えの offFront（両拳を胸の前に構える拳）だけ手前に描く。
    // 手の位置で決めると、体が前へ傾くコマ（ダッシュ・被弾・歩き）で肩ごと前へ出て手前に来てしまう
    const hand = { x: i.shoulderB.x + off[0], y: i.shoulderB.y + off[1] };
    return part(hand, angle, false, false, s.offFront !== true);
  }
  return freeHand(i);
}

/** 空いた後ろの手（体の脇に垂らす。体の後ろに描く） */
function freeHand(i: RigInput): HeldPart {
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

/** 拳だけの画素（外周の 1 ドットは輪郭）。銃の先台を握る手を銃の上に重ね直すのに使う */
export function handPixels(hand: Pt): ArmPixel[] {
  const out: ArmPixel[] = [];
  const pad = HAND_R + 1;
  for (let y = Math.floor(hand.y - pad); y <= Math.ceil(hand.y + pad); y++) {
    for (let x = Math.floor(hand.x - pad); x <= Math.ceil(hand.x + pad); x++) {
      const cx = x + 0.5 - hand.x;
      const cy = y + 0.5 - hand.y;
      const d = Math.hypot(cx, cy);
      if (d <= HAND_R) out.push({ x, y, ink: shadeInk(cx / HAND_R, cy / HAND_R, 1, 4) });
      else if (d <= HAND_R + 1) out.push({ x, y, ink: 0 });
    }
  }
  return out;
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
