/**
 * 武器種のモーション → エフェクトのシート（docs/ideas/fx-sprites.md 5 章）。
 * 表の中身は生成器の各アトラス（scripts/fx/sheets/<武器種>.mjs の FX）が持ち、src/data/fx/<key>.gen.json に書かれる。
 * ここではそれを検査して型を付ける。載っていない武器種・モーションは今までの手続きの描画のまま（段階的に置き換える）
 */
import type { Element } from "../core/element";
import { type ButtonKey, MOVESETS, type MovesetDef, type MovesetKey, meleeChargeOf } from "../data/weapons";
import { FX_ATLASES, FX_MOVESET_RAW, FX_SHEETS, type FxSheetKey } from "../data/fxSheets.gen";
import { FX_RAMP_KEYS, type FxRampKey } from "./fxSprites";

/** 原点: self = 自分の中心、anchor = 当たり判定の中心（meleeAnchor） */
export type FxPivot = "self" | "anchor";

/**
 * 絵を上下反転する条件。swing = 反時計回りの段（renderMath の swingSign が負）。
 * faceLeft / faceRight = 左 / 右を向いて出したとき（突きのように、手に持つ武器の絵の刃・鉤の側が
 * 向いている左右で入れ替わるモーション。絵の非対称な形を武器の向きに合わせる）
 */
export type FxMirror = "swing" | "faceLeft" | "faceRight";

export interface FxMotion {
  sheet: FxSheetKey;
  pivot: FxPivot;
  /** 絵を描いたときの当たり判定の大きさ（論理 px）。measure で今の段のどの値と比べるか */
  base: number;
  measure: "reach" | "size";
  mirror: FxMirror;
  /** キャラより下（地面の層）に描く絵（地割れ・地面の輪・砂煙など）。sheet と同じフレームで流す */
  ground?: FxSheetKey;
}

/** 押している間に回し続ける絵（チェーンアレイの溜め中の回しなど）。charged は溜めの段が 1 以上のとき */
export interface FxHold {
  sheet: FxSheetKey;
  charged?: FxSheetKey;
}

/**
 * 弾 1 種の絵（docs/ideas/fx-sprites.md 9 章）。fly は飛んでいる間 period 秒で 1 巡して繰り返す（向きは速度の向き）。
 * muzzle = 撃った瞬間（銃口・詠唱）、impact = 壁・敵に当たって消えた、hit = 敵に当たった（貫通して消えない弾も。無ければ impact）、
 * fizzle = 射程で尽きた（無ければ impact）、blast = 炸裂（設置弾・曲射。blastBase は絵を描いたときの炸裂の半径）
 */
export interface BulletFx {
  fly: FxSheetKey;
  period: number;
  /** 絵を描いたときの弾の半径（論理 px）。今の弾の半径と比べて拡縮する */
  base: number;
  muzzle?: FxSheetKey;
  impact: FxSheetKey;
  hit?: FxSheetKey;
  fizzle?: FxSheetKey;
  blast?: FxSheetKey;
  blastBase: number;
  /** 属性の無い弾の配色（無ければ steel）。属性のある射撃はその属性の配色 */
  ramp: FxRampKey;
}

export interface MovesetFx {
  /** モーションの key（motionKey）→ シート */
  motions: Readonly<Record<string, FxMotion>>;
  hit: FxSheetKey;
  hitHeavy: FxSheetKey;
  parry?: FxSheetKey;
  /** 右の段の key（溜めの段など）→ 押している間の絵 */
  holds: Readonly<Record<string, FxHold>>;
  /** 弾の key（BulletDef.key。銃のベース・`art.<段>`・`cast.<cast>`）→ 弾の絵 */
  bullets: Readonly<Record<string, BulletFx>>;
}

/**
 * 奥義の見た目の出来事 1 つ（UltFx）の絵。life 秒で全フレームを流す。base は絵を描いたときの大きさ（UltFx.size。
 * 周囲攻撃の半径・振りの届き・突進の距離）。0 なら拡縮しない。pivot = 置く位置（pos = 原点、to = 終点）。
 * ground はキャラより下に同じフレームで描く絵
 */
export interface UltPiece {
  sheet: FxSheetKey;
  life: number;
  base: number;
  pivot: "pos" | "to";
  mirror?: FxMirror;
  ground?: FxSheetKey;
}

/** 持続中に自分の周りで回し続ける絵 */
export interface UltLoop {
  sheet: FxSheetKey;
  period: number;
  ground?: FxSheetKey;
}

/** 奥義 1 本の絵。acts / ends は行為の並びの番号、shots は行為の番号 → その行為が出した弾の絵 */
export interface UltimateFx {
  ramp: FxRampKey;
  cast?: UltPiece;
  acts: readonly (UltPiece | undefined)[];
  target?: UltPiece;
  ends: readonly (UltPiece | undefined)[];
  aura?: UltPiece;
  quake?: UltPiece;
  sustain?: UltLoop;
  shots: Readonly<Record<number, BulletFx>>;
}

/** JSON 由来の表（文字列のまま）。FX_MOVESET_RAW の各要素はこの形に収まる */
interface RawMotion {
  readonly sheet: string;
  readonly pivot: string;
  readonly base: number;
  readonly measure: string;
  readonly mirror?: string;
  readonly ground?: string;
}

interface RawHold {
  readonly sheet: string;
  readonly charged?: string;
}

interface RawBullet {
  readonly fly: string;
  readonly period: number;
  readonly base: number;
  readonly muzzle?: string;
  readonly impact: string;
  readonly hit?: string;
  readonly fizzle?: string;
  readonly blast?: string;
  readonly blastBase?: number;
  readonly ramp?: string;
}

interface RawPiece {
  readonly sheet: string;
  readonly life: number;
  readonly base?: number;
  readonly pivot?: string;
  readonly mirror?: string;
  readonly ground?: string;
}

interface RawLoop {
  readonly sheet: string;
  readonly period: number;
  readonly ground?: string;
}

interface RawUltimate {
  readonly ramp?: string;
  readonly cast?: RawPiece;
  readonly acts?: readonly (RawPiece | null)[];
  readonly target?: RawPiece;
  readonly ends?: readonly (RawPiece | null)[];
  readonly aura?: RawPiece;
  readonly quake?: RawPiece;
  readonly sustain?: RawLoop;
  readonly shots?: Readonly<Record<string, RawBullet>>;
}

/**
 * アトラスの表（生成器の ATLAS.fx）。武器種のアトラスは motions・hit・hitHeavy（と弾の bullets）を、
 * 奥義のアトラス（`<武器種>Ult`）は ultimates だけを持つ
 */
interface RawMovesetFx {
  readonly moveset: string;
  readonly motions?: Readonly<Record<string, RawMotion>>;
  readonly hit?: string;
  readonly hitHeavy?: string;
  readonly parry?: string;
  readonly holds?: Readonly<Record<string, RawHold>>;
  readonly bullets?: Readonly<Record<string, RawBullet>>;
  readonly ultimates?: Readonly<Record<string, RawUltimate>>;
}

function isSheetKey(key: string | undefined): key is FxSheetKey {
  return key !== undefined && Object.hasOwn(FX_SHEETS, key);
}

function isMovesetKey(key: string): key is MovesetKey {
  return Object.hasOwn(MOVESETS, key);
}

function toMirror(raw: string | undefined): FxMirror | undefined {
  if (raw === undefined) return "swing";
  return raw === "swing" || raw === "faceLeft" || raw === "faceRight" ? raw : undefined;
}

function toMotion(raw: RawMotion): FxMotion | undefined {
  if (!isSheetKey(raw.sheet)) return undefined;
  if (raw.pivot !== "self" && raw.pivot !== "anchor") return undefined;
  if (raw.measure !== "reach" && raw.measure !== "size") return undefined;
  const mirror = toMirror(raw.mirror);
  if (!mirror) return undefined;
  if (raw.ground !== undefined && !isSheetKey(raw.ground)) return undefined;
  const motion: FxMotion = { sheet: raw.sheet, pivot: raw.pivot, base: raw.base, measure: raw.measure, mirror };
  if (raw.ground !== undefined) motion.ground = raw.ground;
  return motion;
}

function toHold(raw: RawHold): FxHold | undefined {
  if (!isSheetKey(raw.sheet)) return undefined;
  if (raw.charged !== undefined && !isSheetKey(raw.charged)) return undefined;
  return raw.charged !== undefined ? { sheet: raw.sheet, charged: raw.charged } : { sheet: raw.sheet };
}

function isRampKey(key: string | undefined): key is FxRampKey {
  return key !== undefined && (FX_RAMP_KEYS as readonly string[]).includes(key);
}

function toBullet(raw: RawBullet): BulletFx | undefined {
  if (!isSheetKey(raw.fly) || !isSheetKey(raw.impact) || raw.period <= 0) return undefined;
  const optional = [raw.muzzle, raw.hit, raw.fizzle, raw.blast];
  if (optional.some((k) => k !== undefined && !isSheetKey(k))) return undefined;
  if (raw.ramp !== undefined && !isRampKey(raw.ramp)) return undefined;
  const out: BulletFx = { fly: raw.fly, period: raw.period, base: raw.base, impact: raw.impact, blastBase: raw.blastBase ?? 0, ramp: isRampKey(raw.ramp) ? raw.ramp : "steel" };
  if (isSheetKey(raw.muzzle)) out.muzzle = raw.muzzle;
  if (isSheetKey(raw.hit)) out.hit = raw.hit;
  if (isSheetKey(raw.fizzle)) out.fizzle = raw.fizzle;
  if (isSheetKey(raw.blast)) out.blast = raw.blast;
  return out;
}

function toBullets(raws: Readonly<Record<string, RawBullet>> | undefined): Record<string, BulletFx> {
  const out: Record<string, BulletFx> = {};
  for (const [key, raw] of Object.entries(raws ?? {})) {
    const bullet = toBullet(raw);
    if (bullet) out[key] = bullet;
  }
  return out;
}

function toPiece(raw: RawPiece | null | undefined): UltPiece | undefined {
  if (!raw || !isSheetKey(raw.sheet) || raw.life <= 0) return undefined;
  if (raw.ground !== undefined && !isSheetKey(raw.ground)) return undefined;
  const pivot = raw.pivot ?? "pos";
  if (pivot !== "pos" && pivot !== "to") return undefined;
  const piece: UltPiece = { sheet: raw.sheet, life: raw.life, base: raw.base ?? 0, pivot };
  if (raw.mirror !== undefined) {
    const mirror = toMirror(raw.mirror);
    if (!mirror) return undefined;
    piece.mirror = mirror;
  }
  if (isSheetKey(raw.ground)) piece.ground = raw.ground;
  return piece;
}

function toLoop(raw: RawLoop | undefined): UltLoop | undefined {
  if (!raw || !isSheetKey(raw.sheet) || raw.period <= 0) return undefined;
  if (raw.ground !== undefined && !isSheetKey(raw.ground)) return undefined;
  return isSheetKey(raw.ground) ? { sheet: raw.sheet, period: raw.period, ground: raw.ground } : { sheet: raw.sheet, period: raw.period };
}

function toUltimate(raw: RawUltimate): UltimateFx {
  const shots: Record<number, BulletFx> = {};
  for (const [i, b] of Object.entries(raw.shots ?? {})) {
    const bullet = toBullet(b);
    if (bullet) shots[Number(i)] = bullet;
  }
  return {
    ramp: isRampKey(raw.ramp) ? raw.ramp : "light",
    cast: toPiece(raw.cast),
    acts: (raw.acts ?? []).map(toPiece),
    target: toPiece(raw.target),
    ends: (raw.ends ?? []).map(toPiece),
    aura: toPiece(raw.aura),
    quake: toPiece(raw.quake),
    sustain: toLoop(raw.sustain),
    shots,
  };
}

/** 奥義のアトラスの表を検査して型を付ける（奥義の key → 絵）。知らない奥義の key は読み飛ばす（テストが落とす） */
export function buildUltimateFx(raws: readonly (RawMovesetFx | null)[]): Record<string, UltimateFx> {
  const out: Record<string, UltimateFx> = {};
  for (const raw of raws) {
    if (!raw?.ultimates) continue;
    for (const [key, u] of Object.entries(raw.ultimates)) out[key] = toUltimate(u);
  }
  return out;
}

/** 表を検査して型を付ける。壊れた行（無いシート・知らない原点）は読み飛ばす（テストが件数で落とす） */
export function buildMovesetFx(raws: readonly (RawMovesetFx | null)[]): Partial<Record<MovesetKey, MovesetFx>> {
  const out: Partial<Record<MovesetKey, MovesetFx>> = {};
  for (const raw of raws) {
    if (!raw?.motions || !isMovesetKey(raw.moveset) || !isSheetKey(raw.hit) || !isSheetKey(raw.hitHeavy)) continue;
    const motions: Record<string, FxMotion> = {};
    for (const [key, m] of Object.entries(raw.motions)) {
      const motion = toMotion(m);
      if (motion) motions[key] = motion;
    }
    const holds: Record<string, FxHold> = {};
    for (const [key, h] of Object.entries(raw.holds ?? {})) {
      const hold = toHold(h);
      if (hold) holds[key] = hold;
    }
    out[raw.moveset] = {
      motions,
      hit: raw.hit,
      hitHeavy: raw.hitHeavy,
      parry: isSheetKey(raw.parry) ? raw.parry : undefined,
      holds,
      bullets: toBullets(raw.bullets),
    };
  }
  return out;
}

export const MOVESET_FX: Readonly<Partial<Record<MovesetKey, MovesetFx>>> = buildMovesetFx(FX_MOVESET_RAW);

export const ULTIMATE_FX: Readonly<Record<string, UltimateFx>> = buildUltimateFx(FX_MOVESET_RAW);

/** 弾の key → 弾の絵（どの武器種のアトラスに載っていても引ける。同じ弾を二つの武器種が持つことはない） */
export const BULLET_FX: ReadonlyMap<string, BulletFx> = new Map(Object.values(MOVESET_FX).flatMap((fx) => Object.entries(fx?.bullets ?? {})));

/** 武器種のエフェクトが載っているアトラス（遅延読み込みの単位）。表が無ければ undefined */
export function movesetAtlas(moveset: MovesetKey): string | undefined {
  const fx = MOVESET_FX[moveset];
  return fx ? FX_SHEETS[fx.hit].atlas : undefined;
}

/** 奥義のアトラスの key（`<武器種>Ult`）の接尾辞 */
export const ULT_ATLAS_SUFFIX = "Ult";

/** 武器種の奥義の絵が載っているアトラス。生成していなければ undefined */
export function ultimateAtlas(moveset: MovesetKey): string | undefined {
  const key = `${moveset}${ULT_ATLAS_SUFFIX}`;
  return Object.hasOwn(FX_ATLASES, key) ? key : undefined;
}

export interface MotionRef {
  lane: ButtonKey;
  step: number;
  branch: number;
  dashStrike: boolean;
  chargeLevel: number;
}

/** 今の振りのモーションの key（l:<段> / r:<右の段の key> / branch:<派生の key> / dash / charge）。判定の順は player.ts の stepDef と同じ */
export function motionKey(moveset: Readonly<MovesetDef>, ref: Readonly<MotionRef>): string {
  if (ref.dashStrike) return "dash";
  if (ref.branch >= 0) return `branch:${moveset.branches[ref.branch]?.key ?? ref.branch}`;
  if (ref.chargeLevel > 0 && meleeChargeOf(moveset)) return "charge";
  if (ref.lane === "secondary") return `r:${moveset.steps2[ref.step]?.key ?? ref.step}`;
  return `l:${ref.step}`;
}

export function motionFx(moveset: Readonly<MovesetDef>, ref: Readonly<MotionRef>): FxMotion | undefined {
  return MOVESET_FX[moveset.key]?.motions[motionKey(moveset, ref)];
}

/**
 * 武器種の振りのモーションの key をすべて並べる（表の網羅の検査用）。
 * 左の段・ダッシュ攻撃・右の振りの段（swing だけ。構え・投げ・溜めは手続きの描画）・派生・溜め攻撃
 */
export function swingMotionKeys(moveset: Readonly<MovesetDef>): string[] {
  const keys = moveset.steps.map((_, i) => `l:${i}`);
  if (moveset.dashAttack) keys.push("dash");
  moveset.steps2.forEach((s, i) => {
    if (s.kind === "swing" && !s.step.cast) keys.push(`r:${s.key ?? i}`);
  });
  for (const b of moveset.branches) if (!b.step.cast) keys.push(`branch:${b.key}`);
  if (meleeChargeOf(moveset)) keys.push("charge");
  return keys;
}

/**
 * 絵を上下反転するか。ccw は反時計回りの段か、facingLeft は左を向いて出したか（攻撃の向きの x が負）
 */
export function mirrorFlip(mirror: FxMirror, ccw: boolean, facingLeft: boolean): boolean {
  switch (mirror) {
    case "swing":
      return ccw;
    case "faceLeft":
      return facingLeft;
    case "faceRight":
      return !facingLeft;
  }
}

/** 属性 → 配色。属性が無ければ鋼 */
export function rampOfElement(element: Element): FxRampKey {
  return element === "none" ? "steel" : element;
}
