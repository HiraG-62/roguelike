/**
 * 奥義のスプライト（docs/ideas/fx-sprites.md 9 章）。system/ultimates.ts が積む見た目の出来事（EffectsState.ults）を、
 * 奥義ごとの絵の表（ULTIMATE_FX）で描く。持続中は自分の周りに纏いの絵を繰り返す。state は読むだけ
 */
import type { GameState, UltFx } from "../core/state";
import { ultimateDef } from "../data/ultimates";
import { FX_ATTACK } from "../data/tuning";
import type { FxSheetKey } from "../data/fxSheets.gen";
import { type FxRampKey, type FxSpriteBank, fitScale, lifeFrame, loopFrame, sheetDef } from "./fxSprites";
import { ULTIMATE_FX, type UltPiece, type UltimateFx, mirrorFlip, rampOfElement } from "./fxMotions";

/** 奥義の絵の配色: 素性の属性、無ければ絵の表の配色 */
export function ultimateRamp(key: string): FxRampKey {
  const element = ultimateDef(key)?.attack.element ?? "none";
  return element === "none" ? (ULTIMATE_FX[key]?.ramp ?? "light") : rampOfElement(element);
}

/** 出来事の種類と番号から絵を引く */
export function ultPiece(fx: UltimateFx, ev: Pick<UltFx, "part" | "index">): UltPiece | undefined {
  switch (ev.part) {
    case "cast":
      return fx.cast;
    case "act":
      return fx.acts[ev.index];
    case "target":
      return fx.target;
    case "end":
      return fx.ends[ev.index];
    case "aura":
      return fx.aura;
    case "quake":
      return fx.quake;
  }
}

/** 奥義の絵が読めていて、手続きの輪・線・粒を省いてよいか（今選んでいる奥義に絵の表があり、アトラスが読めている） */
export function ultimateSpritesReady(key: string, bank: FxSpriteBank): boolean {
  const fx = ULTIMATE_FX[key];
  const any = fx ? (fx.cast ?? fx.acts.find((p) => p) ?? fx.sustain) : undefined;
  return any !== undefined && bank.has(any.sheet);
}

function drawPiece(ctx: CanvasRenderingContext2D, bank: FxSpriteBank, ev: UltFx, piece: UltPiece, sheet: FxSheetKey, ramp: FxRampKey): void {
  if (!bank.has(sheet)) return;
  const frame = lifeFrame(sheetDef(sheet).frames, ev.age, piece.life);
  if (frame === null) return;
  const at = piece.pivot === "to" ? ev.to : ev.pos;
  const flip = piece.mirror ? mirrorFlip(piece.mirror, false, Math.cos(ev.angle) < 0) : false;
  const scale = piece.base > 0 ? fitScale(ev.size, piece.base, FX_ATTACK.sprite.scaleTolerance) : 1;
  bank.draw(ctx, sheet, frame, at.x, at.y, ev.angle, { ramp, scale, ccw: flip });
}

function drawEvents(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  const events = state.effects?.ults;
  if (!events) return;
  for (const ev of events) {
    const fx = ULTIMATE_FX[ev.key];
    const piece = fx ? ultPiece(fx, ev) : undefined;
    if (!piece) continue;
    const sheet = ground ? piece.ground : piece.sheet;
    if (sheet) drawPiece(ctx, bank, ev, piece, sheet, ultimateRamp(ev.key));
  }
}

/** 持続中の纏いの絵（自分の中心で period 秒ごとに繰り返す） */
function drawSustain(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  const u = state.player.ultimate;
  if (u.active === null) return;
  const loop = ULTIMATE_FX[u.active]?.sustain;
  const sheet = ground ? loop?.ground : loop?.sheet;
  if (!loop || !sheet || !bank.has(sheet)) return;
  const frame = loopFrame(sheetDef(sheet).frames, u.elapsed, loop.period);
  const pos = state.player.body.pos;
  bank.draw(ctx, sheet, frame, pos.x, pos.y, 0, { ramp: ultimateRamp(u.active) });
}

/** 地面の層（キャラより下）: 地割れ・地面の紋・纏いの足元 */
export function drawUltimateGround(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank): void {
  drawSustain(ctx, state, bank, true);
  drawEvents(ctx, state, bank, true);
}

/** 空中の層（キャラより上）: 発動の閃光・斬撃・衝撃波・纏い */
export function drawUltimateAir(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank): void {
  drawSustain(ctx, state, bank, false);
  drawEvents(ctx, state, bank, false);
}
