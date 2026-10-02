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
import { SKILL, skillAttack } from "../skills/data";
import { fieldRadius, mineRadius, wellRadius } from "../skills/placed";
import { graveRadius, kegRadius, springRadius } from "../skills/summons";
import type { ActiveCast, CastParams, SkillKey } from "../skills/types";
import { hookRange } from "../system/skills";
import { type FxRampKey, type FxSpriteBank, fitScale, lifeFrame, loopFrame, sheetDef } from "./fxSprites";
import { ART_FX_KEY, SKILL_FX, type SkillFx, type SkillLoop, type SkillPiece, isArtFxKey, mirrorFlip, rampOfElement, skillSheet } from "./fxMotions";

/** 置いてある物 1 つ（場・設置物）。スキルの key・中心・大きさ（半径 px。0 は拡縮しない）・発動の値 */
interface Placed {
  key: string;
  pos: Vec;
  size: number;
  params: CastParams;
  /** 不透明度（起動前の地雷は薄く。無ければ 1） */
  alpha?: number;
}

/** 起動前の地雷の不透明度（起動したら濃くなるのが「踏むと炸裂する」の合図） */
const UNARMED_ALPHA = 0.5;

/** 飛んでいる物 1 つ（スキルの弾・投げた手榴弾）。向きは速度の向き */
interface Moving {
  key: string;
  pos: Vec;
  angle: number;
  params: CastParams;
  /** 物ごとの配色（五彩の礫の共鳴の色。遊びの情報なので属性より優先） */
  ramp?: FxRampKey;
  /** 大きさ（弾の半径 px。0 は拡縮しない。火吸いの火球は吸った数で大きくなる） */
  size: number;
  /** 床からの高さ（px。投げた手榴弾の放物線）。空中の絵はその分だけ上に、地面の絵（影）は床に描く */
  lift?: number;
}

/** 効いている纏い 1 つ（自己強化・変身）。発動の値の無いもの（加速）は属性なし */
interface Aura {
  key: string;
  element: string;
}

/**
 * スキルの絵の表。技は自分の表が無ければ汎用の技の絵（ART_FX_KEY）で描く（弾・置いた物・纏いもこの表で引く）
 */
function fxOf(key: string): SkillFx | undefined {
  const own = SKILL_FX[key];
  if (!isArtFxKey(key)) return own;
  const generic = SKILL_FX[ART_FX_KEY];
  if (!own || !generic) return own ?? generic;
  const cached = MERGED.get(key);
  if (cached) return cached;
  // 技の表に無い絵（弾・纏いなど）は汎用の表から補う
  const merged: SkillFx = { ...generic, ...definedOf(own), acts: { ...generic.acts, ...own.acts } };
  MERGED.set(key, merged);
  return merged;
}

const MERGED = new Map<string, SkillFx>();

function definedOf(fx: SkillFx): Partial<SkillFx> {
  return Object.fromEntries(Object.entries(fx).filter(([, v]) => v !== undefined)) as Partial<SkillFx>;
}

/** 行為の絵の選び分けの候補: 細分（`arcWide`）→ 種類（`arc`）の順 */
function variantChain(variant: string): string[] {
  const kind = /^[a-z]+/.exec(variant)?.[0] ?? variant;
  return kind === variant ? [variant] : [variant, kind];
}

/** 行為の出来事の絵: 技の表 → 汎用の技の表の順に、細分 → 種類で探す（配色はその技の表で決める） */
function actPieceOf(key: string, variant: string): SkillPiece | undefined {
  const chain = variantChain(variant);
  for (const table of [SKILL_FX[key], isArtFxKey(key) ? SKILL_FX[ART_FX_KEY] : undefined]) {
    for (const v of chain) {
      const piece = table?.acts?.[v];
      if (piece) return piece;
    }
  }
  return undefined;
}

/** 発動中の絵の大きさ（絵の表の base と比べて拡縮する）。載っていないスキルは 0（拡縮しない）。スキルの絵を足すときにここへ足す */
const ACTIVE_SIZE: Readonly<Record<string, (state: GameState, a: ActiveCast) => number>> = {
  chainHook: (_state, a) => hookRange(a.params),
};

/** 置いてある物の一覧（どのスキルの物かは発動の値の skillKey。型替え符で別のスキルが置いた物もそのスキルの絵になる） */
function placedOf(state: GameState): Placed[] {
  const rs = state.skills;
  const out: Placed[] = [];
  const add = (pos: Vec, params: CastParams, size: number, alpha?: number): void => {
    out.push({ key: params.skillKey, pos, size, params, alpha });
  };
  for (const f of rs.fields) add(f.pos, f.params, fieldRadius(f.params));
  for (const w of rs.wells) add(w.pos, w.params, wellRadius(w.params));
  for (const m of rs.mines) add(m.pos, m.params, mineRadius(m.params), m.arm > 0 ? UNARMED_ALPHA : 1);
  for (const k of rs.kegs) add(k.pos, k.params, kegRadius(k.params));
  for (const g of rs.graves) add(g.pos, g.params, graveRadius(g.params));
  for (const t of rs.turrets) add(t.pos, t.params, 0);
  for (const s of rs.springs) add(s.pos, s.params, springRadius(s.params));
  for (const s of rs.stakes) add(s.pos, s.params, 0);
  for (const z of rs.mires ?? []) add(z.pos, z.params, SKILL.mire.radius * z.params.areaMul);
  return out;
}

/** 飛んでいる物の一覧 */
function movingOf(state: GameState): Moving[] {
  const rs = state.skills;
  const out: Moving[] = [];
  for (const s of rs.shots) {
    out.push({ key: s.params.skillKey, pos: s.pos, angle: Math.atan2(s.vel.y, s.vel.x), params: s.params, size: s.radius });
  }
  return out;
}

/** 効いている纏いの一覧（加速・血の契約・変身） */
function aurasOf(state: GameState): Aura[] {
  const rs = state.skills;
  const out: Aura[] = [];
  if (rs.haste.time > 0) out.push({ key: "haste", element: "none" });
  if (rs.lifesteal.time > 0 || rs.frenzy.time > 0) out.push({ key: "bloodPact", element: "none" });
  if (rs.shape) out.push({ key: rs.shape.key, element: paramsElement(rs.shape.params) });
  return out;
}

/**
 * 配色: 絵の表の配色（スキルに合わせて選んだ色。血抜きの血は闇の素性でも赤）を基本に、
 * 刻印符などで属性がスキルの素性から差し替わったときだけ、その属性の配色にする
 */
function rampOf(fx: SkillFx, key: string, element: string): FxRampKey {
  const own = skillAttack(key as SkillKey)?.element ?? "none";
  return element === "none" || element === own ? fx.ramp : rampOfElement(element as Element);
}

function paramsElement(params: Readonly<CastParams>): string {
  return castElement(params);
}

/** スキルの絵が読めていて、手続きの輪・線・粒と skillHud の描画を省いてよいか */
export function skillSpritesReady(key: string, bank: FxSpriteBank): boolean {
  const ready = (fx: SkillFx | undefined): boolean => {
    const sheet = fx ? skillSheet(fx) : undefined;
    return sheet !== undefined && bank.has(sheet);
  };
  const own = SKILL_FX[key];
  if (!isArtFxKey(key)) return ready(own);
  // 技: 汎用の絵が読めていて、自分の表があればそれも読めていること（無い種類の行為は汎用の絵で描くため）
  return ready(SKILL_FX[ART_FX_KEY]) && (own === undefined || ready(own));
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

function pieceOf(fx: SkillFx, ev: Pick<SkillFxEvent, "key" | "part" | "variant">): SkillPiece | undefined {
  if (ev.variant !== "") return actPieceOf(ev.key, ev.variant);
  return ev.part === "cast" ? fx.cast : ev.part === "act" ? fx.act : fx.end;
}

function drawEvents(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  for (const ev of state.effects?.skills ?? []) {
    const fx = fxOf(ev.key);
    const piece = fx ? pieceOf(fx, ev) : undefined;
    if (fx && piece) drawPiece(ctx, bank, ev, piece, rampOf(fx, ev.key, ev.element), ground);
  }
}

/** 発動中の絵: 本動作の進み具合でフレームを流す（自分の中心、向きは発動の向き） */
function drawActive(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  const a = state.skills.active;
  if (!a || a.phase !== "main") return;
  const fx = fxOf(a.skillKey);
  const loop = fx?.active;
  const sheet = ground ? loop?.ground : loop?.sheet;
  if (!fx || !loop || !sheet || !bank.has(sheet)) return;
  const frames = sheetDef(sheet).frames;
  const progress = a.total > 0 ? 1 - a.timer / a.total : 1;
  const frame = Math.max(0, Math.min(frames - 1, Math.floor(progress * frames)));
  const pos = state.player.body.pos;
  const size = ACTIVE_SIZE[a.skillKey]?.(state, a) ?? 0;
  const angle = Math.atan2(a.dir.y, a.dir.x);
  bank.draw(ctx, sheet, frame, pos.x, pos.y, angle, { ramp: rampOf(fx, a.skillKey, paramsElement(a.params)), scale: scaleOf(size, loop.base) });
}

/** 置いてある間の絵: period 秒で繰り返す（向きなし）。物ごとに位置で位相をずらし、同じ物が並んでも揃って瞬かない */
function drawPlaced(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  for (const it of placedOf(state)) {
    const fx = fxOf(it.key);
    const loop: SkillLoop | undefined = fx?.placed;
    const sheet = ground ? loop?.ground : loop?.sheet;
    if (!fx || !loop || !sheet || !bank.has(sheet)) continue;
    const phase = ((it.pos.x * 7 + it.pos.y * 13) % 97) / 97;
    const frame = loopFrame(sheetDef(sheet).frames, state.time + phase * loop.period, loop.period);
    bank.draw(ctx, sheet, frame, it.pos.x, it.pos.y, 0, { ramp: rampOf(fx, it.key, paramsElement(it.params)), scale: scaleOf(it.size, loop.base), alpha: it.alpha });
  }
}

/** 飛んでいる間の絵: 速度の向きを向いて period 秒で繰り返す */
function drawMoving(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  for (const it of movingOf(state)) {
    const fx = fxOf(it.key);
    const loop = fx?.fly;
    const sheet = ground ? loop?.ground : loop?.sheet;
    if (!fx || !loop || !sheet || !bank.has(sheet)) continue;
    const frame = loopFrame(sheetDef(sheet).frames, state.time, loop.period);
    const y = ground ? it.pos.y : it.pos.y - (it.lift ?? 0);
    bank.draw(ctx, sheet, frame, it.pos.x, y, it.angle, { ramp: it.ramp ?? rampOf(fx, it.key, paramsElement(it.params)), scale: scaleOf(it.size, loop.base) });
  }
}

/** 纏いの絵: 自分の中心で period 秒で繰り返す */
function drawAuras(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank, ground: boolean): void {
  const pos = state.player.body.pos;
  for (const it of aurasOf(state)) {
    const fx = fxOf(it.key);
    const loop = fx?.aura;
    const sheet = ground ? loop?.ground : loop?.sheet;
    if (!fx || !loop || !sheet || !bank.has(sheet)) continue;
    const frame = loopFrame(sheetDef(sheet).frames, state.time, loop.period);
    bank.draw(ctx, sheet, frame, pos.x, pos.y, 0, { ramp: rampOf(fx, it.key, it.element) });
  }
}

/** 地面の層（キャラより下）: 場・設置物・足元の紋 */
export function drawSkillFxGround(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank): void {
  drawPlaced(ctx, state, bank, true);
  drawAuras(ctx, state, bank, true);
  drawMoving(ctx, state, bank, true);
  drawActive(ctx, state, bank, true);
  drawEvents(ctx, state, bank, true);
}

/** 空中の層（キャラより上）: 斬撃・ビーム・閃光 */
export function drawSkillFxAir(ctx: CanvasRenderingContext2D, state: GameState, bank: FxSpriteBank): void {
  drawPlaced(ctx, state, bank, false);
  drawAuras(ctx, state, bank, false);
  drawMoving(ctx, state, bank, false);
  drawActive(ctx, state, bank, false);
  drawEvents(ctx, state, bank, false);
}
