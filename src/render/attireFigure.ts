import { RENDER_SCALE } from "../core/view";
import type { GameState } from "../core/state";
import { playerMoveset } from "../system/player";
import { ACTOR_ART_SCALE, ActorSpriteBank, type ActorCell, actorAnchor, actorDir, actorSheet, armColors, bodyAtlas, weaponAtlas, weaponOffGrip, weaponStanceMeta } from "./actorSprites";
import { MENU_INK, px } from "./crestDraw";
import { type ArmInk, type HeldPart, type Pt, type RigPose, type SheathPart, type Stance, armPixels, bodyClip, elbowOf, handPixels, solveRig, stanceFromMeta } from "./playerRig";

/**
 * 装束・候補の頁の「体」。ゲーム中のプレイヤーと同じ高精細の体（待機の 1 巡）に、待機の構えの腕と手に持つ武器を重ねて
 * 大きく描く。ドットの粒は整数倍（ZOOM）で保ち、拡大に imageSmoothing は使わない。
 * 絵が読めるまで（または体の絵が無いとき）は呼び側が今までのドット絵の人形（attireUi.drawFigure）で代わりに描く。
 * 腕・武器の重ね順は renderer.ts の drawRiggedPlayer / rigLayers の「待機」の部分と同じ（振り・残像・縄・銃口は持たない）。
 * 専用の ActorSpriteBank を持つ（renderer の bank は今の武器・体のアトラスだけで、装備画面と取り合いにならない）
 */

/** 装束の体の倍率（論理 1 px の整数倍。体は論理 約 12 × 21.5 px → 約 36 × 65） */
export const FIGURE_ZOOM = 3;
/** 候補の頁の小さな体の倍率 */
export const MINI_ZOOM = 2;
/** 待機の組み立ての既定（右向き・正面の照準） */
const IDLE_AIM = 0;
/** 銃の構えの高さ（自分の中心の高さ、組み立ての空間のドット。体の胸のあたり） */
const AIM_ORIGIN_Y = -26;
/** 腕の輪郭の色（renderer の COLOR_RIG_OUTLINE と同じ） */
const OUTLINE = "#14121c";
/** 候補の小さな体を薄く見せる透明度 */
const DIM_ALPHA = 0.6;

/** 足元の位置（論理 px）と、絵の 1 ドットの論理寸法 */
export interface FigureFeet {
  readonly x: number;
  readonly y: number;
}

/** 絵の 1 ドットの論理 px（zoom 3 → 1.5。× RENDER_SCALE が整数になる倍率だけ使う） */
export function dotSize(zoom: number): number {
  return zoom / ACTOR_ART_SCALE;
}

/**
 * 部位から伸ばす糸の先（足元からのドット。上が負）。体のコマは足元から上へ約 41 ドット・幅 24 ドット。
 * 腕と武器は構えで動くので、糸は動かない体の上（頭・胸・胴・足）に留める
 */
export const FIGURE_ANCHOR_DOTS = {
  head: { x: 0, y: -36 },
  amulet: { x: 0, y: -25 },
  mainHand: { x: -7, y: -15 },
  ring: { x: 7, y: -12 },
  armor: { x: -3, y: -18 },
  boots: { x: 0, y: -3 },
} as const satisfies Record<string, Pt>;

/** 足元から dots（絵のドット。上が負）だけ離れた点の論理座標（部位から伸ばす糸の先など） */
export function figurePoint(feet: FigureFeet, zoom: number, dots: Pt): Pt {
  const d = dotSize(zoom);
  return { x: feet.x + dots.x * d, y: feet.y + dots.y * d };
}

/** 倍率で描いた粒が背面バッファの整数画素になるか（粒が崩れない倍率） */
export function isCrispZoom(zoom: number): boolean {
  return Number.isInteger(dotSize(zoom) * RENDER_SCALE);
}

/** 体のコマ（絵のドット）が箱の高さ（論理 px）に収まる最大の整数倍。1 未満にはしない */
export function fitZoom(cellDotsH: number, boxH: number): number {
  const logicalH = cellDotsH / ACTOR_ART_SCALE;
  return Math.max(1, Math.floor(boxH / logicalH));
}

/** 足元の台座（楕円の段）。rx・ry は論理 px。上から 1 行ずつの [開始 x, 幅] */
export function ellipseRows(cx: number, cy: number, rx: number, ry: number): { y: number; x: number; w: number }[] {
  const rows: { y: number; x: number; w: number }[] = [];
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.5))));
    rows.push({ y: cy + dy, x: cx - half, w: half * 2 });
  }
  return rows;
}

/** 台座: 薄い光の輪の上に楕円の台、足元に影。装束の人影の足元（feet）に合わせる */
export function drawPedestal(ctx: CanvasRenderingContext2D, feet: FigureFeet, zoom: number): void {
  const k = zoom / FIGURE_ZOOM;
  const rx = Math.round(26 * k);
  const ry = Math.max(2, Math.round(5 * k));
  const ring = ellipseRows(feet.x, feet.y, rx + 3, ry + 1);
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (const r of ring) px(ctx, r.x, r.y, r.w, 1, MENU_INK.goldLo);
  ctx.restore();
  for (const r of ellipseRows(feet.x, feet.y, rx, ry)) px(ctx, r.x, r.y, r.w, 1, MENU_INK.card2);
  for (const r of ellipseRows(feet.x, feet.y, Math.round(rx * 0.55), Math.max(1, ry - 2))) px(ctx, r.x, r.y, r.w, 1, MENU_INK.fiberB);
}

// -----------------------------------------------------------------------------
// 体・腕・武器の重ね（待機）
// -----------------------------------------------------------------------------

/** 重ねる先。本番は Canvas、テストでは呼び順の記録 */
export interface FigurePainter {
  /** 体のコマを足元に合わせて置く */
  body(cell: ActorCell): void;
  /** 手に持つ武器を置く（bare の手は呼ばない） */
  weapon(part: HeldPart): void;
  /** 腕（肩 → 肘 → 手）。dim = 奥の腕の暗い袖、withHand = 拳を描く */
  arm(shoulder: Pt, part: HeldPart, dim: boolean, withHand: boolean): void;
  /** 拳だけ（銃の先台を握る手を銃の上に重ね直す） */
  hand(at: Pt): void;
  /** 腰の鞘（構えが sheath を持つ武器だけ。省けば描かない） */
  sheath?(part: SheathPart): void;
}

export interface IdlePose {
  readonly rig: RigPose;
  readonly shoulderF: Pt;
  readonly shoulderB: Pt;
  readonly stance: Stance;
}

/** 待機の重ね順（rigLayers の待機の部分）: 後ろの武器 → 後ろの腕 → 体 → 前の武器 → 前の腕。腰の鞘は前後に合わせて最初か体の直後 */
export function composeIdle(p: FigurePainter, pose: IdlePose, bodyCell: ActorCell): void {
  const { rig, shoulderF, shoulderB, stance } = pose;
  const worn = stance.worn === true;
  const arm = (shoulder: Pt, part: HeldPart, dim: boolean): void => {
    p.arm(shoulder, part, dim, !worn || part.bare);
    if (worn && !part.bare) p.weapon(part);
  };
  const held = (part: HeldPart): void => {
    if (!worn && !part.bare) p.weapon(part);
  };
  if (rig.gunHold) {
    // 両手で構えた銃: 体 → 握りを持つ腕 → 先台を支える腕 → 銃 → 先台を握る拳
    p.body(bodyCell);
    arm(shoulderB, rig.front, true);
    arm(shoulderF, rig.back, false);
    held(rig.front);
    p.hand(rig.back.hand);
    return;
  }
  const sheath = (): void => {
    if (rig.sheath) p.sheath?.(rig.sheath);
  };
  if (rig.sheath?.behind === true) sheath();
  const twoHanded = rig.back.bare && stance.grip === "two";
  const backFront = !twoHanded && !rig.back.behind;
  const backUnderWeapon = twoHanded && !rig.back.behind;
  if (!rig.back.bare && rig.back.behind) held(rig.back);
  if (rig.back.behind) arm(shoulderB, rig.back, true);
  const frontArmBehind = rig.front.behind || rig.front.hand.x < shoulderF.x - FRONT_ARM_BEHIND_X;
  if (rig.front.behind) held(rig.front);
  if (frontArmBehind) arm(shoulderF, rig.front, false);
  p.body(bodyCell);
  if (rig.sheath?.behind === false) sheath();
  if (!rig.back.bare && !rig.back.behind) held(rig.back);
  if (backFront) arm(shoulderB, rig.back, true);
  if (backUnderWeapon) arm(shoulderB, rig.back, true);
  if (!rig.front.behind) held(rig.front);
  if (backUnderWeapon) p.hand(rig.back.hand);
  if (!frontArmBehind) arm(shoulderF, rig.front, false);
}

/** 前の手がこれ以上肩より後ろへ回ったら腕も体の後ろ（renderer の RIG_ARM_BEHIND_X と同じ） */
const FRONT_ARM_BEHIND_X = 3;

// -----------------------------------------------------------------------------
// 絵の読み込みと描画
// -----------------------------------------------------------------------------

const bank = new ActorSpriteBank();
let focusedKey = "";

/** 今のジョブの体と今の武器種のアトラスだけを持つ（変わったときだけ切り替える） */
function focusFor(body: string, weapon: string | undefined): void {
  const key = `${body}|${weapon ?? ""}`;
  if (key === focusedKey) return;
  focusedKey = key;
  bank.focus([body, weapon]);
}

/** 体・武器の絵が読めていて、この体が描けるか（false なら呼び側が代わりの人形） */
export function figureReady(state: Readonly<GameState>): boolean {
  // 画像を読めない環境（ヘッドレスのテスト）は読み始めず、代わりの人形にする
  if (typeof Image === "undefined") return false;
  const body = bodyAtlas(state.job);
  const weapon = weaponAtlas(playerMoveset(state as GameState).key);
  focusFor(body, weapon);
  return weapon !== undefined && armColors(body) !== undefined && bank.ready(body) && bank.ready(weapon);
}

function canvasPainter(ctx: CanvasRenderingContext2D, weapon: string, colors: { sleeve: readonly string[]; hand: readonly string[] }): FigurePainter {
  const cell = (c: ActorCell, x: number, y: number): void => {
    ctx.drawImage(c.img, c.sx, c.sy, c.w, c.h, Math.round(x - c.ox), Math.round(y - c.oy), c.w, c.h);
  };
  const dot = (x: number, y: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  return {
    body: (c) => cell(c, 0, 0),
    weapon: (part) => {
      const mirrored = `${weapon}.heldM`;
      const key = part.mirror && actorSheet(mirrored) ? mirrored : `${weapon}.held`;
      const sheet = actorSheet(key);
      if (!sheet) return;
      const c = bank.cell(key, actorDir(part.angle, sheet.dirs), 0);
      if (c) cell(c, part.hand.x, part.hand.y);
    },
    arm: (shoulder, part, dim, withHand) => {
      const inks: Record<ArmInk, string> = {
        0: OUTLINE,
        1: colors.sleeve[0] ?? OUTLINE,
        2: colors.sleeve[dim ? 0 : 1] ?? OUTLINE,
        3: colors.sleeve[dim ? 1 : 2] ?? OUTLINE,
        4: colors.hand[0] ?? OUTLINE,
        5: colors.hand[dim ? 0 : 1] ?? OUTLINE,
        6: colors.hand[dim ? 1 : 2] ?? OUTLINE,
      };
      for (const p of armPixels(shoulder, elbowOf(shoulder, part.hand), part.hand, withHand)) dot(p.x, p.y, inks[p.ink]);
    },
    hand: (at) => {
      for (const p of handPixels(at)) dot(p.x, p.y, p.ink === 0 ? OUTLINE : (colors.hand[p.ink - 4] ?? OUTLINE));
    },
    sheath: (part) => {
      const key = `${weapon}.sheath`;
      const sheet = actorSheet(key);
      if (!sheet) return;
      const c = bank.cell(key, actorDir(part.angle, sheet.dirs), 0);
      if (c) cell(c, part.mouth.x, part.mouth.y);
    },
  };
}

/**
 * 今のジョブの体を足元 feet に描く。絵が読めていなければ何もせず false（呼び側が代わりの人形を描く）。
 * time = 待機の呼吸の位相（秒。ui.time）。dim = 候補の小さな体で薄く
 */
export function drawAttireFigure(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, feet: FigureFeet, zoom: number, time: number, dim = false): boolean {
  if (!figureReady(state)) return false;
  const body = bodyAtlas(state.job);
  const weapon = weaponAtlas(playerMoveset(state as GameState).key);
  const colors = armColors(body);
  if (weapon === undefined || colors === undefined) return false;
  const stance = stanceFromMeta(weaponStanceMeta(weapon));
  const clip = bodyClip({ dashing: false, dashProgress: 0, hit: false, phase: "none", holding: false, moving: false, walkTime: 0, time, idle: stance.body });
  const bodyKey = `${body}.${clip.clip}`;
  const bodyCell = bank.cell(bodyKey, 0, clip.frame);
  const shoulderF = actorAnchor(bodyKey, 0, clip.frame, "shoulderF");
  const shoulderB = actorAnchor(bodyKey, 0, clip.frame, "shoulderB");
  const hip = actorAnchor(bodyKey, 0, clip.frame, "hip");
  if (!bodyCell || !shoulderF || !shoulderB) return false;
  const moveset = playerMoveset(state as GameState);
  const rig = solveRig({
    stance,
    swing: undefined,
    step: 0,
    aim: IDLE_AIM,
    aimHeld: moveset.primary === "shot",
    facingRight: true,
    shoulderF,
    shoulderB,
    time,
    offGrip: weaponOffGrip(weapon),
    aimOrigin: { x: 0, y: AIM_ORIGIN_Y },
    barrelY: actorAnchor(`${weapon}.held`, 0, 0, "muzzle")?.y ?? 0,
    unrotated: (actorSheet(`${weapon}.held`)?.dirs ?? 0) <= 1,
    ...(hip ? { hip } : {}),
  });
  const d = dotSize(zoom);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (dim) ctx.globalAlpha = DIM_ALPHA;
  ctx.translate(feet.x, feet.y);
  ctx.scale(d, d);
  composeIdle(canvasPainter(ctx, weapon, colors), { rig, shoulderF, shoulderB, stance }, bodyCell);
  ctx.restore();
  return true;
}
