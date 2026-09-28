/**
 * スキル石のスプライト（docs/ideas/fx-sprites.md 10 章）。スキルが積む見た目の出来事（EffectsState.skills）と、
 * 発動中（state.skills.active）・置いてある間（場・設置物）の状態を、スキルごとの絵の表（SKILL_FX）で描く。state は読むだけ
 */
import type { Element } from "../core/element";
import type { GameState, SkillFxEvent } from "../core/state";
import type { Vec } from "../core/vec";
import { FX_ATTACK } from "../data/tuning";
import type { FxSheetKey } from "../data/fxSheets.gen";
import { castElement } from "../skills/hit";
import { fieldRadius } from "../skills/placed";
import type { ActiveCast, CastParams } from "../skills/types";
import { whirlRadius } from "../system/skills";
import { type FxRampKey, type FxSpriteBank, fitScale, lifeFrame, loopFrame, sheetDef } from "./fxSprites";
import { SKILL_FX, type SkillFx, type SkillLoop, type SkillPiece, mirrorFlip, rampOfElement, skillSheet } from "./fxMotions";

/** 置いてある物 1 つ（場・設置物）。スキルの key・中心・置いてからの秒・大きさ・発動の値 */
interface Placed {
  key: string;
  pos: Vec;
  age: number;
  size: number;
  params: CastParams;
}

/** 発動中の絵の大きさ（絵の表の base と比べて拡縮する）。載っていないスキルは 0（拡縮しない） */
const ACTIVE_SIZE: Readonly<Record<string, (state: GameState, a: ActiveCast) => number>> = {
  whirl: (state, a) => whirlRadius(state, a.params),
};

/** 置いてある物の一覧。スキルの絵を足すときに、そのスキルの設置物をここへ足す */
function placedOf(state: GameState): Placed[] {
  const rs = state.skills;
  return rs.fields.map((f) => ({ key: "frostField", pos: f.pos, age: f.total - f.timer, size: fieldRadius(f.params), params: f.params }));
}

/** 配色: 刻印符などで差し替わった属性、無ければ絵の表の配色 */
function rampOf(fx: SkillFx, element: string): FxRampKey {
  return element === "none" ? fx.ramp : rampOfElement(element as Element);
}

function paramsElement(params: Readonly<CastParams>): string {
  return castElement(params);
}

/** スキルの絵が読めていて、手続きの輪・線・粒と skillHud の描画を省いてよいか */
export function skillSpritesReady(key: string, bank: FxSpriteBank): boolean {
  const fx = SKILL_FX[key];
  const sheet = fx ? skillSheet(fx) : undefined;
  return sheet !== undefined && bank.has(sheet);
}

function scaleOf(size: number, base: number): number {
  return base > 0 && size > 0 ? fitScale(size, base, FX_ATTACK.sprite.scaleTolerance) : 1;
}

/** ビーム: 始点から終点へ beam のシート（向き 0 の 1 区間）を実際の角度で step px ごとに並べる（どれも同じフレーム） */
function drawBeam(ctx: CanvasRenderingContext2D, bank: FxSpriteBank, ev: SkillFxEvent, beam: { sheet: FxSheetKey; step: number }, frame: number, ramp: FxRampKey): void {
  if (!bank.has(beam.sheet)) return;
  const dx = ev.to.x - ev.pos.x;
  const dy = ev.to.y - ev.pos.y;
  const len = Math.hypot(dx, dy);
  const f = Math.min(frame, sheetDef(beam.sheet).frames - 1);
  bank.drawStrip(ctx, beam.sheet, f, ev.pos.x, ev.pos.y, Math.atan2(dy, dx), len, beam.step, { ramp });
}

function drawPiece(ctx: CanvasRenderingContext2D, bank: FxSpriteBank, ev: SkillFxEvent, piece: SkillPiece, ramp: FxRampKey, ground: boolean): void {
  const sheet = ground ? piece.ground : piece.sheet;
  if (!sheet || !bank.has(sheet)) return;
  const frame = lifeFrame(sheetDef(sheet).frames, ev.age, piece.life);
  if (frame === null) return;
  if (!ground && piece.beam) drawBeam(ctx, bank, ev, piece.beam, frame, ramp);
  const at = piece.pivot === "to" ? ev.to : ev.pos;
  const flip = piece.mirror ? mirrorFlip(piece.mirror, false, Math.cos(ev.angle) < 0) : false;
  bank.draw(ctx, sheet, frame, at.x, at.y, ev.angle, { ramp, scale: scaleOf(ev.size, piece.base), ccw: flip });
  if (!ground && piece.tip && bank.has(piece.tip)) {
    const tf = Math.min(frame, sheetDef(piece.tip).frames - 1);
    bank.draw(ctx, piece.tip, tf, ev.to.x, ev.to.y, ev.angle, { ramp });
  }
}

function pieceOf(fx: SkillFx, ev: Pick<SkillFxEvent, "part">): SkillPiece | undefined {
  return ev.part === "cast" ? fx.cast : ev.part === "act" ? fx.act : fx.end;
}

function drawEvents(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  for (const ev of state.effects?.skills ?? []) {
    const fx = SKILL_FX[ev.key];
    const piece = fx ? pieceOf(fx, ev) : undefined;
    if (fx && piece) drawPiece(ctx, bank, ev, piece, rampOf(fx, ev.element), ground);
  }
}

/** 発動中の絵: 本動作の進み具合でフレームを流す（自分の中心、向きは発動の向き） */
function drawActive(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  const a = state.skills.active;
  if (!a || a.phase !== "main") return;
  const fx = SKILL_FX[a.skillKey];
  const loop = fx?.active;
  const sheet = ground ? loop?.ground : loop?.sheet;
  if (!fx || !loop || !sheet || !bank.has(sheet)) return;
  const frames = sheetDef(sheet).frames;
  const progress = a.total > 0 ? 1 - a.timer / a.total : 1;
  const frame = Math.max(0, Math.min(frames - 1, Math.floor(progress * frames)));
  const pos = state.player.body.pos;
  const size = ACTIVE_SIZE[a.skillKey]?.(state, a) ?? 0;
  const angle = Math.atan2(a.dir.y, a.dir.x);
  bank.draw(ctx, sheet, frame, pos.x, pos.y, angle, { ramp: rampOf(fx, paramsElement(a.params)), scale: scaleOf(size, loop.base) });
}

/** 置いてある間の絵: period 秒で繰り返す（向きなし） */
function drawPlaced(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  for (const it of placedOf(state)) {
    const fx = SKILL_FX[it.key];
    const loop: SkillLoop | undefined = fx?.placed;
    const sheet = ground ? loop?.ground : loop?.sheet;
    if (!fx || !loop || !sheet || !bank.has(sheet)) continue;
    const frame = loopFrame(sheetDef(sheet).frames, it.age, loop.period);
    bank.draw(ctx, sheet, frame, it.pos.x, it.pos.y, 0, { ramp: rampOf(fx, paramsElement(it.params)), scale: scaleOf(it.size, loop.base) });
  }
}

/** 地面の層（キャラより下）: 場・設置物・足元の紋 */
export function drawSkillFxGround(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank): void {
  drawPlaced(ctx, state, bank, true);
  drawActive(ctx, state, bank, true);
  drawEvents(ctx, state, bank, true);
}

/** 空中の層（キャラより上）: 斬撃・ビーム・閃光 */
export function drawSkillFxAir(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank): void {
  drawPlaced(ctx, state, bank, false);
  drawActive(ctx, state, bank, false);
  drawEvents(ctx, state, bank, false);
}
