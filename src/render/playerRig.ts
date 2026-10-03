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
export type AttackClip = "atkSlash" | "atkRise" | "atkSlam" | "atkThrust" | "atkSpin" | "atkIai";
export type BodyClip = IdleClip | "walk" | "dash" | "windup" | "strike" | "hit" | AttackClip | "parry";

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
  atkIai: ATTACK_FRAMES,
  parry: 2,
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
  /** 体の向きと逆へ歩いている（isBackpedal）。歩きのコマを逆に送る */
  readonly backpedal?: boolean;
  readonly time: number;
  /** 待機の構え（武器種の Stance.body） */
  readonly idle: IdleStance;
  /** 今の振りの体のコマ（attackClip）。無ければ共通の構え 1 枚・振り抜き 1 枚 */
  readonly attack?: AttackClip;
  /** phase の進み（0 → 1） */
  readonly t?: number;
  /** 受け流しの構え（parryMotion.ts）。impact = 受け止めた衝撃のコマ。振りの最中は使わない */
  readonly parry?: { readonly impact: boolean };
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
 * + = 上から振り下ろす）で振り下ろし / 斬り上げ。居合（iai。刀の右の溜めと、離して出す抜き付け）は低く構える専用のコマ
 */
export function attackClip(shape: "arc" | "box" | "thrust" | "circle", rigSign: number, heavy: boolean, stance: Pick<Stance, "body" | "braced">, iai = false): AttackClip {
  if (iai) return "atkIai";
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
  if (i.parry && i.phase === "none") return { clip: "parry", frame: i.parry.impact ? 1 : 0 };
  if (i.phase === "windup" || (i.phase === "none" && i.holding)) return { clip: "windup", frame: 0 };
  if (i.phase === "active" || i.phase === "recover") return { clip: "strike", frame: 0 };
  if (i.moving) return { clip: "walk", frame: walkFrame(i.walkTime, i.backpedal === true) };
  return { clip: IDLE_CLIP[i.idle], frame: cycleFrame(i.time, IDLE_PERIOD, IDLE_FRAMES) };
}

/**
 * 歩きのコマ。シート（scripts/actor/rig.mjs の walkPose）は前へ歩く足運びの順に並ぶので、後ずさりは逆に送る
 * （逆再生 = 着いた足が前へ流れ、浮いた足を後ろへ運ぶ）
 */
export function walkFrame(walkTime: number, backpedal: boolean): number {
  const n = BODY_CLIP_FRAMES.walk;
  const k = cycleFrame(walkTime, WALK_FRAME_TIME * n, n);
  return backpedal ? (n - k) % n : k;
}

/**
 * 体の向きと逆へ動く速さの割合（横の成分 / 速さ）がこれを越えたら後ずさり。
 * 体のシートは横向きだけなので横の成分で決め、ほぼ真上・真下の移動は前進の足のまま（境目で足が行き来しない）
 */
const BACKPEDAL_MIN = 0.2;

/** 移動の向き（画面の速度）が体の向き（右 / 左）と逆か */
export function isBackpedal(vel: Pt, facingRight: boolean): boolean {
  const speed = Math.hypot(vel.x, vel.y);
  if (speed <= 0) return false;
  const forward = (facingRight ? vel.x : -vel.x) / speed;
  return forward < -BACKPEDAL_MIN;
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
  /**
   * 腰の左に差す鞘（刀）。右手で持つ武器として、右向きでは武器が体の手前・鞘が奥、左向きでは武器が奥・鞘が手前に見える。
   * 鞘は照準によらず腰に固定する
   */
  readonly sheath?: SheathStance;
  /** 右の溜めを、鞘に納めて低く構える姿と、離して鞘から抜き付ける振りで描く（刀の居合）。sheath とあわせて使う */
  readonly iai?: boolean;
  /** 受け流しの構え（攻撃を受け止める形）。省けば DEFAULT_PARRY */
  readonly parry?: ParryStance;
}

/**
 * 受け流しの構え（docs/ideas/parry-motion.md。武器の絵の meta.stance.parry）。右向きの空間で、照準によらず体の前に構える
 * （受け流しは全方位なので、向きは左右だけ）
 */
export interface ParryStance {
  /** 主の手（前の肩から、ドット） */
  readonly hand: readonly [number, number];
  /** 武器の向き（度。0 = 前、負 = 上、正 = 下） */
  readonly deg: number;
  /** 片刃の刃を写しの側へ向ける */
  readonly mirror?: boolean;
  /**
   * 後ろの手（後ろの肩から、ドット）。二刀はもう 1 本を持つ手、それ以外は刃や盾に添える素手（両手持ちでも柄を離して
   * 刃の腹に掌を当てる）。奥の腕なので体の後ろに描く。省けば今までの後ろの手（両手持ちは添え手を主の手から引く）
   */
  readonly off?: readonly [number, number];
  /** 二刀のもう 1 本の向き（度） */
  readonly offDeg?: number;
  /**
   * 両手持ちの添え手の柄の上の位置（主の手から武器の先へ、ドット。負 = 柄の尻の側）。省けば meta.offGrip。
   * 柄を立てて受ける長柄は、尻の側だと後ろの肩から届かないので先の側を握る
   */
  readonly grip?: number;
  readonly offMirror?: boolean;
  /** 主の武器を体の後ろに描く（省けば体の前） */
  readonly behind?: boolean;
  /** 受け止める所（主の武器の握りから先へ、ドット）。火花をここから散らす（結界を張る武器は結界の前が受ける所） */
  readonly contact: number;
  /** 武器で受けず、体の前に結界を張る（魔法の武器。値は結界の色）。描くのは parryBarrier.ts */
  readonly barrier?: string;
}

/** 受けの構えを持たない武器の既定（片手で刃を前上へ立てる） */
export const DEFAULT_PARRY: ParryStance = { hand: [7, 1], deg: -55, contact: 12 };

/** 受けの構えの動き（renderer.ts が parryMotion.ts から作る）。blend = 待機の構えから受けの構えへ寄せる割合 */
export interface GuardMotion {
  readonly blend: number;
  /** 受け止めた衝撃で手を後ろへ押す量（ドット）と、武器の先を押し返す角（rad） */
  readonly push: number;
  readonly tilt: number;
  /** 外して構えが崩れ、手が下がる量（ドット） */
  readonly sag: number;
}

/** 腰の鞘の置き方 */
export interface SheathStance {
  /** 鯉口の位置（腰の位置の印から、ドット） */
  readonly mouth: readonly [number, number];
  /** 鞘の向き（度。右向きの空間、180 = 真後ろ、正 = 下） */
  readonly deg: number;
  /** 納めた刀の握りから鯉口まで（ドット。武器の絵の鍔の先） */
  readonly grip: number;
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

/** 生成器の meta.sheath（[鯉口の x, y, 向きの度, 握りから鯉口まで]）。形が崩れていれば undefined */
function sheathFromMeta(v: unknown): SheathStance | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const [x, y, deg, grip] = v as [number, number, number, number];
  return { mouth: [x, y], deg, grip };
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
    ...(sheathFromMeta(r.sheath) ? { sheath: sheathFromMeta(r.sheath) } : {}),
    ...(r.iai === true ? { iai: true } : {}),
    ...(parryFromMeta(r.parry) ? { parry: parryFromMeta(r.parry) } : {}),
  };
}

/** 生成器の meta.stance.parry。形が崩れていれば undefined（既定の受けの構え） */
export function parryFromMeta(v: unknown): ParryStance | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const r = v as Record<string, unknown>;
  const deg = num(r.deg);
  const contact = num(r.contact);
  if (!isPair(r.hand) || deg === undefined || contact === undefined) return undefined;
  const offDeg = num(r.offDeg);
  const grip = num(r.grip);
  return {
    hand: r.hand,
    deg,
    contact,
    ...(r.mirror === true ? { mirror: true } : {}),
    ...(isPair(r.off) ? { off: r.off } : {}),
    ...(offDeg !== undefined ? { offDeg } : {}),
    ...(grip !== undefined ? { grip } : {}),
    ...(r.offMirror === true ? { offMirror: true } : {}),
    ...(r.behind === true ? { behind: true } : {}),
    ...(typeof r.barrier === "string" ? { barrier: r.barrier } : {}),
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
  /**
   * 術を放つ後ろの腕（castOff）の付け根。あれば後ろの腕をここから引き、主の武器（胸の前の本）の上・前の腕の下に描く。
   * 後ろの肩は前の肩から腕 1 本ぶん奥にあり、そこからでは掌が前の肩までしか届かない。術を突き出すときは体を捻って
   * 後ろの肩が前へ出るので、付け根を前の肩の側へ寄せる（CAST_TWIST）。腕を本の下に描くと掌ごと本に隠れる
   */
  readonly castShoulder?: Pt;
  /** 腰の鞘（構えが sheath を持つときだけ） */
  readonly sheath?: SheathPart;
}

/** 腰の鞘の描き方 */
export interface SheathPart {
  /** 鯉口の位置（組み立ての空間） */
  readonly mouth: Pt;
  /** 鞘の向き（rad、組み立ての空間） */
  readonly angle: number;
  /** 体の後ろに描く（右向き。腰の左は奥の側） */
  readonly behind: boolean;
  /** 主の武器（front）を鞘に納めている（居合の構え）。武器は鞘の直前に描き、刀身を鞘で覆う */
  readonly sheathed: boolean;
}

/** 居合の段階（hold = 右を押して溜めている間。ほかは離して出す抜き付けの段階）と進み（0 → 1） */
export interface IaiMotion {
  readonly phase: "hold" | "windup" | "active" | "recover";
  readonly t: number;
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
  /**
   * 術を放つ振り（段が cast を持つ。書の左の文字の弾）。主の手は武器を待機の位置に持ったまま、空いた後ろの手を
   * 照準へ突き出して術を放つ（本を構えたまま、もう一方の掌から撃つ）。省けば今までの振り
   */
  readonly castOff?: boolean;
  /** 腰の位置（体のシートの位置の印、組み立ての空間）。鞘を下げる。省けば両肩から見積もる */
  readonly hip?: Pt;
  /** 居合の構え・抜き付けの最中（構えが iai を持つ武器の右の溜め）。省けば今までの振り */
  readonly iai?: IaiMotion;
  /** 受け流しの構え（振っていない間だけ。swing より後に効く）。省けば今までの構え */
  readonly guard?: GuardMotion;
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
/** 術を放つ後ろの手を上げる上限（度。組み立ての空間、負 = 上） */
const CAST_UP_DEG = -15;
/** 術を放つ後ろの手を下げる下限（度。正 = 下） */
const CAST_DOWN_DEG = 50;
/** 術を放つ後ろの腕の付け根を、後ろの肩から前の肩へ寄せる割合（体の捻り） */
const CAST_TWIST = 0.8;
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
  const pose = solveHands(i);
  const sheath = sheathPart(i);
  return sheath ? { ...pose, sheath } : pose;
}

function solveHands(i: RigInput): RigPose {
  if (i.guard && !i.swing) return guardHands(i, i.guard);
  const k = i.restBlend ?? 0;
  if (k > 0 && i.swing) {
    const { iai: _iai, ...rest } = i;
    const idle: RigInput = { ...rest, swing: undefined };
    const swingMain = mainPart(i);
    const restMain = mainPart(idle);
    const blended = blendPart(swingMain, restMain, k);
    // 待機で体の前に構える手は、構え直しの後半（待機の側）に入ったら、寄せた角が境目をまたいでも後ろへ戻さない
    const main = i.stance.restFront === true && k >= 0.5 ? { ...blended, behind: false } : blended;
    const restBack = backPart(idle, restMain);
    const blendedBack = blendPart(backPart(i, swingMain), restBack, k);
    if (i.castOff) {
      // 術を放った手は、構え直しの後半（待機の側）に入ったら待機の前後（垂らした手は体の後ろ）へ移す
      // （寄せた角で決めると、腕を下ろしきるまで体の前に残って胴の前に垂れて見える）
      const back = { ...blendedBack, behind: k >= 0.5 ? restBack.behind : false };
      if (back.behind) return { front: main, back };
      // 付け根も捻った位置から後ろの肩へ戻す
      const twisted = castShoulderOf(i);
      return { front: main, back, castShoulder: { x: twisted.x + (i.shoulderB.x - twisted.x) * k, y: twisted.y + (i.shoulderB.y - twisted.y) * k } };
    }
    // 両手持ちの添え手は寄せた主の手から引き直す（柄から離れない）。居合の抜き付けの後は鞘に添えた手から柄へ寄せる
    if (i.iai) return { front: main, back: k >= 0.5 ? { ...blendedBack, behind: restBack.behind } : blendedBack };
    return { front: main, back: i.stance.grip === "two" && i.offGrip !== null ? backPart(i, main) : blendedBack };
  }
  const main = mainPart(i);
  const back = backPart(i, main);
  if (i.swing && i.castOff) return { front: main, back, castShoulder: castShoulderOf(i) };
  const gunHold = i.aimHeld && !i.swing && i.stance.grip === "two" && i.offGrip !== null;
  return gunHold ? { front: main, back, gunHold } : { front: main, back };
}

/** 術を放つ後ろの腕の付け根（後ろの肩を前の肩の側へ CAST_TWIST だけ寄せた所。体を捻って肩が前へ出る） */
function castShoulderOf(i: RigInput): Pt {
  return { x: i.shoulderB.x + (i.shoulderF.x - i.shoulderB.x) * CAST_TWIST, y: i.shoulderB.y + (i.shoulderF.y - i.shoulderB.y) * CAST_TWIST };
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

/**
 * 主の手。腰に鞘を差す武器（右手で持つ）は、左向きでは体の奥に描く（納めている間は鞘と一緒に描くので前後を問わない）。
 * 前後を武器の向きで決めないので、待機の揺れで手前と奥を行き来しない
 */
function mainPart(i: RigInput): HeldPart {
  const main = mainPartRaw(i);
  if (!i.stance.sheath || i.facingRight || isSheathed(i)) return main;
  return { ...main, behind: true };
}

function mainPartRaw(i: RigInput): HeldPart {
  if (i.iai) return iaiMain(i, i.iai);
  // 術を放つ振りは武器を待機の位置に持ったまま（放つのは後ろの手。backPart の castHand）
  if (i.swing && i.castOff) return restPart(i);
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
  if (i.iai) return iaiBack(i);
  if (i.swing && i.castOff) return castHand(i, i.swing);
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

/**
 * 術を放つ後ろの手: 捻った付け根（castShoulderOf）から照準へ、振りの伸び縮み（予備動作で引き、振りで突き出す。腕の長さまで）の
 * 距離に掌を出す。武器は持たず（bare）、体の前に描く（体の後ろだと突き出した手が胴に隠れる）。
 * 上を狙っても掌は前上（CAST_UP_DEG）までしか上げない（真上へ上げると大きな頭の前を腕が横切る）。下も前下（CAST_DOWN_DEG）まで
 * （真下へ下ろすと本を持つ拳と重なる）。弾は掌から照準へ飛ぶので、掌の向きを丸めても狙いは変わらない
 */
function castHand(i: RigInput, swing: WeaponPose): HeldPart {
  const angle = Math.min(CAST_DOWN_DEG * DEG, Math.max(wrapAngle(toRigAngle(i.aim, i.facingRight)), CAST_UP_DEG * DEG));
  return part(at(castShoulderOf(i), angle, swingHandReach(swing)), angle, false, true, false);
}

// ---------------------------------------------------------------------------
// 腰の鞘と居合
// ---------------------------------------------------------------------------

/** 腰の位置の印が無いときの見積もり（両肩の間から下へ。体の骨組みの胸 → 腰の差） */
const HIP_BELOW_SHOULDER = 10;
/** 居合の構えで後ろの手を添える所（鯉口から鞘の側へ、ドット。鯉口を握って切る） */
const IAI_SHEATH_HOLD = 1.5;
/** 抜き付けの予備動作で柄を引き出す量（ドット。鯉口を切って刀を少し抜く） */
const IAI_PULL = 2.5;
/**
 * 抜き付けの刀の向き（度）: 鞘を抜けた刃が走り出す向き（前下）と、終わりの向き（前のわずかに上）。
 * 鞘の向き（後ろ）から回すと刀身が足の下を通るので、抜けた所から描く（予備動作の間は鞘の中）
 */
const IAI_DRAW_DEG = 55;
const IAI_END_DEG = -10;
/** 主の手を出す向き（肩から、度）と肩から下げる高さ（ドット） */
const IAI_HAND_DEG = 8;
const IAI_HAND_DROP = 2;
/** 抜き付けの刀の回りを、振りの頭で大きく進める指数（鞘から抜けた刃が一気に前へ走る） */
const IAI_SWEEP_EASE = 3;
/** 手を前へ出すのは刀の回りより少し遅らせる（刃が鞘を抜けてから腕が伸びる）指数 */
const IAI_HAND_EASE = 2;

function hipOf(i: RigInput): Pt {
  if (i.hip) return i.hip;
  return { x: (i.shoulderF.x + i.shoulderB.x) / 2, y: (i.shoulderF.y + i.shoulderB.y) / 2 + HIP_BELOW_SHOULDER };
}

/** 刀を鞘に納めている（居合の溜め・抜き付けの予備動作） */
function isSheathed(i: RigInput): boolean {
  return i.iai !== undefined && (i.iai.phase === "hold" || i.iai.phase === "windup");
}

function sheathPart(i: RigInput): SheathPart | undefined {
  const sh = i.stance.sheath;
  if (!sh) return undefined;
  const hip = hipOf(i);
  return { mouth: { x: hip.x + sh.mouth[0], y: hip.y + sh.mouth[1] }, angle: sh.deg * DEG, behind: i.facingRight, sheathed: isSheathed(i) };
}

/** 鞘に納めた刀の握り（鯉口から柄の側へ、握りから鯉口までの距離） */
function sheathedGrip(i: RigInput, sh: SheathStance, pull: number): Pt {
  const hip = hipOf(i);
  const a = sh.deg * DEG;
  const back = sh.grip + pull;
  return { x: hip.x + sh.mouth[0] - Math.cos(a) * back, y: hip.y + sh.mouth[1] - Math.sin(a) * back };
}

/**
 * 居合の主の手。溜めの間は鞘に納めた刀の柄を握り（刃を上にした写しの絵。刀身は鞘が覆う）、予備動作で少し引き出す。
 * 振りで鞘を抜けた刀を前下から前へ斬り上げ（抜き付け）、腕を前へ伸ばす。戻しは抜き切った形のまま
 * （待機へは restBlend が寄せる）
 */
function iaiMain(i: RigInput, m: IaiMotion): HeldPart {
  const sh = i.stance.sheath;
  if (!sh) return restPart(i);
  if (m.phase === "hold") return part(sheathedGrip(i, sh, 0), sh.deg * DEG, true, false, false);
  if (m.phase === "windup") return part(sheathedGrip(i, sh, IAI_PULL * m.t), sh.deg * DEG, true, false, false);
  const t = m.phase === "active" ? m.t : 1;
  const sweep = 1 - Math.pow(1 - t, IAI_SWEEP_EASE);
  const reach = 1 - Math.pow(1 - t, IAI_HAND_EASE);
  const from = sheathedGrip(i, sh, IAI_PULL);
  const to = withinReach(at({ x: i.shoulderF.x, y: i.shoulderF.y + IAI_HAND_DROP }, IAI_HAND_DEG * DEG, ARM_SPAN), i.shoulderF);
  const hand = { x: from.x + (to.x - from.x) * reach, y: from.y + (to.y - from.y) * reach };
  // 前下から前へ斬り上げる（頭の上を通さない）
  const angle = (IAI_DRAW_DEG + (IAI_END_DEG - IAI_DRAW_DEG) * sweep) * DEG;
  return part(hand, angle, false, false, false);
}

/** 居合の後ろの手: 鯉口のすぐ後ろで鞘を握る（武器は持たない）。鞘と同じ側（右向きは体の後ろ、左向きは手前）に描く */
function iaiBack(i: RigInput): HeldPart {
  const sh = i.stance.sheath;
  if (!sh) return freeHand(i);
  const hip = hipOf(i);
  const a = sh.deg * DEG;
  const hand = withinReach({ x: hip.x + sh.mouth[0] + Math.cos(a) * IAI_SHEATH_HOLD, y: hip.y + sh.mouth[1] + Math.sin(a) * IAI_SHEATH_HOLD }, i.shoulderB);
  return part(hand, a, false, true, i.facingRight);
}

/** 空いた後ろの手（体の脇に垂らす。体の後ろに描く） */
function freeHand(i: RigInput): HeldPart {
  return part({ x: i.shoulderB.x + FREE_HAND.x, y: i.shoulderB.y + FREE_HAND.y }, Math.PI / 2, false, true, true);
}

// ---------------------------------------------------------------------------
// 受け流しの構え
// ---------------------------------------------------------------------------

/**
 * 受けの構え（docs/ideas/parry-motion.md）。待機の構え（guard を外して解いた形）から、武器の meta.stance.parry の形へ blend だけ寄せる。
 * 両手持ちは添え手を主の手から引き直し（柄から離れない）、二刀はもう 1 本を、片手は添える素手を寄せる。
 * 奥の手（後ろの肩の腕）は構えの間ずっと体の後ろに描く（体の前に描くと、奥の腕が胴や顔の前を横切って前後が逆に見える）
 */
function guardHands(i: RigInput, g: GuardMotion): RigPose {
  const { guard: _guard, ...rest } = i;
  const base = solveHands(rest);
  const ps = i.stance.parry ?? DEFAULT_PARRY;
  const k = Math.min(1, Math.max(0, g.blend));
  const main = blendPart(base.front, guardMain(i, ps, g), k);
  if (i.stance.grip === "two" && i.offGrip !== null && !ps.off) {
    const grip = ps.grip === undefined ? i.offGrip : i.offGrip + (ps.grip - i.offGrip) * k;
    return { front: main, back: { ...backPart({ ...rest, offGrip: grip }, main), behind: true } };
  }
  const off = guardOff(i, ps, g);
  return { front: main, back: off ? blendPart(base.back, off, k) : base.back };
}

/** 衝撃で手を後ろへ押し、外したら下げる */
function guardShift(hand: Pt, g: GuardMotion): Pt {
  return { x: hand.x - g.push, y: hand.y + g.sag };
}

/** 衝撃で武器の先を押し返す向き: 上を向く刃はさらに上（後ろ）へ、下を向く刃はさらに下へ倒す */
function guardTilt(angle: number, g: GuardMotion): number {
  return angle + Math.sign(Math.sin(angle)) * g.tilt;
}

function guardMain(i: RigInput, ps: ParryStance, g: GuardMotion): HeldPart {
  const angle = guardTilt(ps.deg * DEG, g);
  const hand = withinReach(guardShift({ x: i.shoulderF.x + ps.hand[0], y: i.shoulderF.y + ps.hand[1] }, g), i.shoulderF);
  // 刀（腰に鞘を差す右手の武器）は振りと同じく、左向きでは体の奥
  const behind = ps.behind === true || (i.stance.sheath !== undefined && !i.facingRight);
  return part(hand, angle, ps.mirror ?? false, false, behind);
}

/** 後ろの手。二刀はもう 1 本、片手の武器は添える素手。off が無ければ undefined（今までの後ろの手のまま） */
function guardOff(i: RigInput, ps: ParryStance, g: GuardMotion): HeldPart | undefined {
  if (!ps.off) return undefined;
  const hand = withinReach(guardShift({ x: i.shoulderB.x + ps.off[0], y: i.shoulderB.y + ps.off[1] }, g), i.shoulderB);
  if (i.stance.grip === "dual") {
    const angle = guardTilt((ps.offDeg ?? ps.deg) * DEG, g);
    return part(hand, angle, ps.offMirror ?? false, false, true);
  }
  return part(hand, 0, false, true, true);
}

/** 受け止める所（主の武器の握りから contact だけ先。組み立ての空間）。火花を散らす */
export function guardContact(pose: RigPose, stance: Stance): Pt {
  const ps = stance.parry ?? DEFAULT_PARRY;
  return at(pose.front.hand, pose.front.angle, ps.contact);
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
