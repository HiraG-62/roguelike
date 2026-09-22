import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { MODIFIERS, SKILL, SKILL_DEFS } from "../skills/data";
import { COLOR_CURSE } from "../skills/hit";
import { stoneInSlot } from "../skills/persistence";
import {
  COLOR_BULLET,
  COLOR_FROST,
  COLOR_MINE,
  COLOR_THUNDER,
  COLOR_WELL,
  fieldRadius,
  mineRadius,
  thunderRadius,
  wellRadius,
} from "../skills/placed";
import type { ActiveCast, Ghost, Grenade } from "../skills/types";
import { beamEnd, chargeRatio, grenadeRadius, hookRange, quakeRadius, remoteAnchor, slotModifierView } from "../system/skills";

/**
 * スキルの描画。renderer.ts を触らずに済むよう、main.ts が renderer.render の後に呼ぶ。
 * ワールド側（床の石・刻印符・グレネード・照準線・旋風の円弧）と画面側の HUD を描く。
 */

const FONT_ICON = "bold 10px monospace";
const FONT_KEY = "bold 6px monospace";
const FONT_LABEL = "bold 8px monospace";

const COLOR_STONE = SKILL.drop.stoneColor;
const COLOR_RUNE = SKILL.drop.runeColor;
const COLOR_FRAME = "#505050";
const COLOR_FRAME_READY = "#c0c0c0";
const COLOR_BG = "rgba(12,12,18,0.85)";
const COLOR_MASK = "rgba(0,0,0,0.65)";
const COLOR_EMPTY = "#606060";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_BLACK = "#000000";
const COLOR_WARN = "#ff5050";
const COLOR_AIM = "#ff6060";
const COLOR_WHIRL = "#ffffff";
const COLOR_PARRY = "#60e0ff";
const COLOR_GRENADE = "#c0c0c0";

const HUD_SIZE = 18;
const HUD_GAP = 6;
/** 画面下端からの距離（"ROOM LOCKED" 表示の上） */
const HUD_BOTTOM = 26;
const DOT_SIZE = 2;
const DOT_GAP = 1;
const ICON_BASELINE = 13;
const KEY_OFFSET_Y = 7;
const FULL_CIRCLE = Math.PI * 2;

const PILLAR_W = 5;
const PILLAR_H = 34;
const PILLAR_ALPHA = 0.55;
const BOB_SPEED = 4;
const BOB_AMOUNT = 1.5;
const GEM_SIZE = 3;
const RUNE_SIZE = 4;
const LABEL_OFFSET = 4;

const ARC_COUNT = 2;
const ARC_SPAN = 1.2;
const WHIRL_SPIN = 18;
const AIM_BLINK = 30;
const AIM_ALPHA = 0.7;
const GRENADE_ARC_H = 18;
const FUSE_BLINK_MIN = 8;
const FUSE_BLINK_MAX = 30;
const FUSE_FILL_ALPHA = 0.15;
const PARRY_RING_PAD = 5;
const DARKEN_ALPHA = 0.45;

const COLOR_QUAKE = "#d0a060";
const COLOR_HOOK = "#c0c0d0";
const COLOR_DELAY = MODIFIERS.delay.color;
const COLOR_HASTE = "#80ffff";
const COLOR_EXHAUST = "#406080";
const ZONE_FILL_ALPHA = 0.18;
const ZONE_EDGE_ALPHA = 0.8;
const ZONE_FADE_MIN = 0.35;
const WELL_ARMS = 3;
const WELL_SPIN = 4;
const WELL_ARM_SPAN = 0.9;
const WELL_CORE = 2;
const STRIKE_BLINK = 25;
const MINE_SIZE = 2;
const MINE_BLINK = 6;
const MINE_RANGE_ALPHA = 0.2;
const BULLET_SIZE = 2;
const CURSE_MARK_Y = 4;
const CURSE_MARK_SIZE = 2;
const DELAY_DASH = [3, 3];
const DELAY_RADIUS = 14;
const HOOK_HEAD = 2;
const HASTE_RING_PAD = 3;
const HASTE_SPIN = 12;

const COLOR_CHARGE = MODIFIERS.charge.color;
const CHARGE_BAR_H = 2;
const CHARGE_BAR_BG = "rgba(0,0,0,0.6)";

export function drawSkillHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  ctx.save();
  ctx.translate(ox, oy);
  drawFloorStones(ctx, state);
  drawRunes(ctx, state);
  drawFields(ctx, state);
  drawWells(ctx, state);
  drawMines(ctx, state);
  drawStrikes(ctx, state);
  drawDelays(ctx, state);
  drawGrenades(ctx, state);
  drawBullets(ctx, state);
  drawCurses(ctx, state);
  for (const g of state.skills.ghosts) drawGhost(ctx, state, g);
  drawActive(ctx, state);
  ctx.restore();
  ctx.globalAlpha = 1;
  if (state.status === "playing") drawSlots(ctx, state);
}

// ---------------------------------------------------------------------------
// ワールド
// ---------------------------------------------------------------------------

function bob(time: number): number {
  return Math.round(Math.sin(time * BOB_SPEED) * BOB_AMOUNT);
}

function drawPillar(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const grad = ctx.createLinearGradient(0, y - PILLAR_H, 0, y);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, color);
  ctx.globalAlpha = PILLAR_ALPHA;
  ctx.fillStyle = grad;
  ctx.fillRect(x - Math.floor(PILLAR_W / 2), y - PILLAR_H, PILLAR_W, PILLAR_H);
  ctx.globalAlpha = 1;
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.font = FONT_LABEL;
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_BLACK;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** 装備と同じ見せ方: 紫の光柱 + 菱形 + 名前 */
function drawFloorStones(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const fs of state.skills.floorStones) {
    const x = Math.round(fs.pos.x);
    const y = Math.round(fs.pos.y);
    drawPillar(ctx, x, y, COLOR_STONE);
    const by = y + bob(fs.bobTime);
    ctx.fillStyle = COLOR_STONE;
    ctx.beginPath();
    ctx.moveTo(x, by - GEM_SIZE);
    ctx.lineTo(x + GEM_SIZE, by);
    ctx.lineTo(x, by + GEM_SIZE);
    ctx.lineTo(x - GEM_SIZE, by);
    ctx.closePath();
    ctx.fill();
    drawLabel(ctx, SKILL_DEFS[fs.stone.skillKey].name, x, y - PILLAR_H - LABEL_OFFSET, COLOR_STONE);
  }
}

function drawRunes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const rune of state.skills.runes) {
    const x = Math.round(rune.pos.x);
    const y = Math.round(rune.pos.y) + bob(rune.bobTime);
    const def = MODIFIERS[rune.modifier];
    drawPillar(ctx, x, Math.round(rune.pos.y), COLOR_RUNE);
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(x - RUNE_SIZE - 1, y - RUNE_SIZE - 1, RUNE_SIZE * 2 + 2, RUNE_SIZE * 2 + 2);
    ctx.fillStyle = COLOR_RUNE;
    ctx.fillRect(x - RUNE_SIZE, y - RUNE_SIZE, RUNE_SIZE * 2, RUNE_SIZE * 2);
    ctx.fillStyle = def.color;
    ctx.fillRect(x - 1, y - 1, DOT_SIZE, DOT_SIZE);
    drawLabel(ctx, `Rune: ${def.name}`, x, Math.round(rune.pos.y) - PILLAR_H - LABEL_OFFSET, COLOR_RUNE);
  }
}

function drawGrenades(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const g of state.skills.grenades) {
    if (g.flight > 0) drawGrenadeFlight(ctx, g);
    else drawGrenadeFuse(ctx, state, g);
  }
}

/** 位置は直線補間、描画だけ放物線 */
function drawGrenadeFlight(ctx: CanvasRenderingContext2D, g: Grenade): void {
  const t = g.flightTotal > 0 ? 1 - g.flight / g.flightTotal : 1;
  const x = g.from.x + (g.to.x - g.from.x) * t;
  const y = g.from.y + (g.to.y - g.from.y) * t - Math.sin(t * Math.PI) * GRENADE_ARC_H;
  ctx.fillStyle = COLOR_GRENADE;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, DOT_SIZE + 1, DOT_SIZE + 1);
  ctx.strokeStyle = COLOR_AIM;
  ctx.globalAlpha = FUSE_FILL_ALPHA * 2;
  ctx.beginPath();
  ctx.arc(g.to.x, g.to.y, grenadeRadius(g.params), 0, FULL_CIRCLE);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 着弾中は赤い円。点滅が加速する */
function drawGrenadeFuse(ctx: CanvasRenderingContext2D, state: GameState, g: Grenade): void {
  const progress = g.fuseTotal > 0 ? 1 - g.fuse / g.fuseTotal : 1;
  const speed = FUSE_BLINK_MIN + (FUSE_BLINK_MAX - FUSE_BLINK_MIN) * progress;
  const on = Math.sin(state.time * speed) > 0;
  const r = grenadeRadius(g.params);
  ctx.globalAlpha = FUSE_FILL_ALPHA;
  ctx.fillStyle = COLOR_AIM;
  ctx.beginPath();
  ctx.arc(g.to.x, g.to.y, r, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.globalAlpha = on ? 1 : AIM_ALPHA / 2;
  ctx.strokeStyle = COLOR_AIM;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = on ? COLOR_AIM : COLOR_GRENADE;
  ctx.fillRect(Math.round(g.to.x) - 1, Math.round(g.to.y) - 1, DOT_SIZE + 1, DOT_SIZE + 1);
}

function drawWhirlArcs(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number, r: number, alpha: number): void {
  ctx.strokeStyle = COLOR_WHIRL;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  const base = state.time * WHIRL_SPIN;
  for (let i = 0; i < ARC_COUNT; i++) {
    const a = base + (i * FULL_CIRCLE) / ARC_COUNT;
    ctx.beginPath();
    ctx.arc(x, y, r, a, a + ARC_SPAN);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
}

function whirlRadiusFor(state: GameState, g: { params: { areaMul: number } }): number {
  return SKILL.whirl.radius * state.stats.meleeReachMul * g.params.areaMul;
}

// ---- 追加スキルの設置物・予兆 ----

function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, FULL_CIRCLE);
}

/** 半透明の塗り + 縁。残り時間が減るほど薄くなる */
function drawZone(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, remain: number): void {
  const fade = ZONE_FADE_MIN + (1 - ZONE_FADE_MIN) * Math.max(0, Math.min(1, remain));
  circlePath(ctx, x, y, r);
  ctx.globalAlpha = ZONE_FILL_ALPHA * fade;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = ZONE_EDGE_ALPHA * fade;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 氷結地帯: 水色の円（自分も中では遅くなるので範囲をはっきり見せる） */
function drawFields(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const f of state.skills.fields) {
    drawZone(ctx, f.pos.x, f.pos.y, fieldRadius(f.params), COLOR_FROST, f.total > 0 ? f.timer / f.total : 0);
  }
}

/** 引力球: 範囲の円 + 内向きに回る腕 */
function drawWells(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const w of state.skills.wells) {
    const r = wellRadius(w.params);
    drawZone(ctx, w.pos.x, w.pos.y, r, COLOR_WELL, w.total > 0 ? w.timer / w.total : 0);
    ctx.strokeStyle = COLOR_WELL;
    const base = -state.time * WELL_SPIN;
    for (let i = 0; i < WELL_ARMS; i++) {
      const a = base + (i * FULL_CIRCLE) / WELL_ARMS;
      ctx.beginPath();
      // 半径が外から内へ縮み続けて「吸い込み」に見せる
      const shrink = 1 - ((state.time + i / WELL_ARMS) % 1);
      ctx.arc(w.pos.x, w.pos.y, r * shrink, a, a + WELL_ARM_SPAN);
      ctx.stroke();
    }
    ctx.fillStyle = COLOR_WELL;
    ctx.fillRect(Math.round(w.pos.x) - WELL_CORE, Math.round(w.pos.y) - WELL_CORE, WELL_CORE * 2, WELL_CORE * 2);
  }
}

/** 地雷: 本体 + 爆発範囲。起動後は点滅 */
function drawMines(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const m of state.skills.mines) {
    const x = Math.round(m.pos.x);
    const y = Math.round(m.pos.y);
    const armed = m.arm <= 0;
    circlePath(ctx, x, y, mineRadius(m.params));
    ctx.globalAlpha = MINE_RANGE_ALPHA;
    ctx.strokeStyle = COLOR_MINE;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(x - MINE_SIZE - 1, y - MINE_SIZE - 1, MINE_SIZE * 2 + 2, MINE_SIZE * 2 + 2);
    const on = armed && Math.sin(state.time * MINE_BLINK) > 0;
    ctx.fillStyle = on ? COLOR_WARN : armed ? COLOR_MINE : COLOR_DIM;
    ctx.fillRect(x - MINE_SIZE, y - MINE_SIZE, MINE_SIZE * 2, MINE_SIZE * 2);
  }
}

/** 雷撃: 落下地点の円。内側の円が縮んで外周に重なった瞬間に落ちる */
function drawStrikes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const s of state.skills.strikes) {
    const r = thunderRadius(s.params);
    const progress = s.total > 0 ? 1 - s.timer / s.total : 1;
    const on = Math.sin(state.time * STRIKE_BLINK) > 0;
    drawZone(ctx, s.pos.x, s.pos.y, r, COLOR_THUNDER, on ? 1 : ZONE_FADE_MIN);
    ctx.strokeStyle = COLOR_THUNDER;
    circlePath(ctx, s.pos.x, s.pos.y, r * progress);
    ctx.stroke();
  }
}

/** 遅延の刻印符: 本発動の地点に縮む破線の円 */
function drawDelays(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const e of state.skills.echoes) {
    if (e.kind !== "delay") continue;
    const at = remoteAnchor(e);
    const remain = e.total > 0 ? e.timer / e.total : 0;
    ctx.setLineDash(DELAY_DASH);
    ctx.strokeStyle = COLOR_DELAY;
    circlePath(ctx, at.x, at.y, DELAY_RADIUS * remain + 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawBullets(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = COLOR_BULLET;
  for (const b of state.skills.bullets) {
    ctx.fillRect(Math.round(b.pos.x) - 1, Math.round(b.pos.y) - 1, BULLET_SIZE, BULLET_SIZE);
  }
}

/** 呪い中の敵の頭上に紫の菱形 */
function drawCurses(ctx: CanvasRenderingContext2D, state: GameState): void {
  const curses = state.skills.curses;
  if (curses.size === 0) return;
  ctx.fillStyle = COLOR_CURSE;
  for (const e of state.enemies) {
    if (!curses.has(e.id)) continue;
    const x = Math.round(e.body.pos.x);
    const y = Math.round(e.body.pos.y - e.body.radius - CURSE_MARK_Y);
    ctx.beginPath();
    ctx.moveTo(x, y - CURSE_MARK_SIZE);
    ctx.lineTo(x + CURSE_MARK_SIZE, y);
    ctx.lineTo(x, y + CURSE_MARK_SIZE);
    ctx.lineTo(x - CURSE_MARK_SIZE, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** 地裂きの溜め: 扇の範囲を描き、溜まるほど塗りが濃くなる */
function drawQuakeCone(ctx: CanvasRenderingContext2D, x: number, y: number, a: ActiveCast): void {
  const r = quakeRadius(a.params);
  const base = Math.atan2(a.dir.y, a.dir.x);
  const half = SKILL.quake.halfAngle;
  const progress = a.total > 0 ? 1 - a.timer / a.total : 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, base - half, base + half);
  ctx.closePath();
  ctx.globalAlpha = ZONE_FILL_ALPHA + ZONE_FILL_ALPHA * 2 * progress;
  ctx.fillStyle = COLOR_QUAKE;
  ctx.fill();
  ctx.globalAlpha = ZONE_EDGE_ALPHA;
  ctx.strokeStyle = COLOR_QUAKE;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 鎖鎌: 手元から先端までの鎖 */
function drawHookChain(ctx: CanvasRenderingContext2D, x: number, y: number, a: ActiveCast): void {
  const reach = Math.min(a.reach, hookRange(a.params));
  const tx = x + a.dir.x * reach;
  const ty = y + a.dir.y * reach;
  ctx.strokeStyle = COLOR_HOOK;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.fillStyle = COLOR_HOOK;
  ctx.fillRect(Math.round(tx) - HOOK_HEAD, Math.round(ty) - HOOK_HEAD, HOOK_HEAD * 2, HOOK_HEAD * 2);
}

function drawGhost(ctx: CanvasRenderingContext2D, state: GameState, g: Ghost): void {
  if (g.skillKey === "spiral") {
    ctx.globalAlpha = AIM_ALPHA / 2;
    ctx.strokeStyle = COLOR_BULLET;
    circlePath(ctx, g.pos.x, g.pos.y, state.player.body.radius);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  if (g.skillKey === "whirl") {
    drawWhirlArcs(ctx, state, g.pos.x, g.pos.y, whirlRadiusFor(state, g), AIM_ALPHA / 2);
    return;
  }
  ctx.globalAlpha = AIM_ALPHA / 2;
  ctx.fillStyle = COLOR_WHIRL;
  ctx.beginPath();
  ctx.arc(g.pos.x, g.pos.y, state.player.body.radius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawActive(ctx: CanvasRenderingContext2D, state: GameState): void {
  const p = state.player;
  const rs = state.skills;
  const { x, y } = p.body.pos;
  if (rs.parryFailTimer > 0 || rs.stunTimer > 0) {
    ctx.globalAlpha = DARKEN_ALPHA;
    ctx.fillStyle = COLOR_BLACK;
    ctx.beginPath();
    ctx.arc(x, y, p.body.radius + 1, 0, FULL_CIRCLE);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 加速中は回る水色の弧、切れた後の反動（ダッシュ不可）は暗い青の輪
  if (rs.haste.time > 0) {
    const a = state.time * HASTE_SPIN;
    ctx.strokeStyle = COLOR_HASTE;
    ctx.beginPath();
    ctx.arc(x, y, p.body.radius + HASTE_RING_PAD, a, a + ARC_SPAN);
    ctx.stroke();
  } else if (rs.exhaustTimer > 0) {
    ctx.strokeStyle = COLOR_EXHAUST;
    circlePath(ctx, x, y, p.body.radius + HASTE_RING_PAD);
    ctx.stroke();
  }
  const a = rs.active;
  if (!a) return;
  drawActiveCast(ctx, state, a);
}

function drawActiveCast(ctx: CanvasRenderingContext2D, state: GameState, a: ActiveCast): void {
  const p = state.player;
  const { x, y } = p.body.pos;
  switch (a.skillKey) {
    case "whirl":
      if (a.phase === "main") drawWhirlArcs(ctx, state, x, y, whirlRadiusFor(state, a), 1);
      return;
    case "railshot": {
      if (Math.sin(state.time * AIM_BLINK) < 0) return;
      const end = beamEnd(state, p.body.pos, a.dir);
      ctx.strokeStyle = COLOR_AIM;
      ctx.globalAlpha = AIM_ALPHA;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case "parry":
      ctx.strokeStyle = COLOR_PARRY;
      ctx.beginPath();
      ctx.arc(x, y, p.body.radius + PARRY_RING_PAD, 0, FULL_CIRCLE);
      ctx.stroke();
      return;
    case "quake":
      if (a.phase === "main") drawQuakeCone(ctx, x, y, a);
      return;
    case "chainHook":
      if (a.phase === "main") drawHookChain(ctx, x, y, a);
      return;
    case "spiral":
      ctx.strokeStyle = COLOR_BULLET;
      ctx.globalAlpha = AIM_ALPHA;
      circlePath(ctx, x, y, p.body.radius + PARRY_RING_PAD);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    case "lunge":
      return;
  }
}

// ---------------------------------------------------------------------------
// HUD（画面下中央）
// ---------------------------------------------------------------------------

function drawSlots(ctx: CanvasRenderingContext2D, state: GameState): void {
  const count = SKILL.slots;
  const totalW = count * HUD_SIZE + (count - 1) * HUD_GAP;
  const left = Math.round(VIEW_W / 2 - totalW / 2);
  const top = VIEW_H - HUD_BOTTOM - HUD_SIZE;
  for (let i = 0; i < count; i++) drawSlot(ctx, state, i, left + i * (HUD_SIZE + HUD_GAP), top);
}

function drawSlot(ctx: CanvasRenderingContext2D, state: GameState, index: number, x: number, y: number): void {
  const rs = state.skills;
  const slot = rs.slots[index];
  const stone = stoneInSlot(rs.profile, index);
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(x, y, HUD_SIZE, HUD_SIZE);

  const ready = !!slot && slot.chargesLeft > 0;
  ctx.font = FONT_ICON;
  ctx.textAlign = "center";
  ctx.fillStyle = stone ? COLOR_STONE : COLOR_EMPTY;
  ctx.fillText(stone ? SKILL_DEFS[stone.skillKey].icon : "-", x + HUD_SIZE / 2, y + ICON_BASELINE);

  // CD 中は上から暗いマスクが減っていく
  if (stone && slot && !ready && slot.cooldownTotal > 0) {
    const ratio = Math.min(1, slot.cooldownLeft / slot.cooldownTotal);
    ctx.fillStyle = COLOR_MASK;
    ctx.fillRect(x, y, HUD_SIZE, Math.round(HUD_SIZE * ratio));
  }
  ctx.strokeStyle = stone && ready ? COLOR_FRAME_READY : COLOR_FRAME;
  if (rs.active?.slot === index) ctx.strokeStyle = COLOR_WARN;
  ctx.strokeRect(x + 0.5, y + 0.5, HUD_SIZE - 1, HUD_SIZE - 1);

  ctx.font = FONT_KEY;
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(String(index + 1), x + HUD_SIZE / 2, y + HUD_SIZE + KEY_OFFSET_Y);

  if (stone && slot) drawCharges(ctx, x, y, slot.chargesLeft);
  drawModifierDots(ctx, state, index, x, y);
  drawChargeGauge(ctx, state, index, x, y);
}

/** 溜め中のスロット上端に細いバー。溜め時間の割合(0..1)ぶん左から満ちる */
function drawChargeGauge(ctx: CanvasRenderingContext2D, state: GameState, index: number, x: number, y: number): void {
  const ratio = chargeRatio(state, index);
  if (ratio === null) return;
  ctx.fillStyle = CHARGE_BAR_BG;
  ctx.fillRect(x, y - CHARGE_BAR_H - 1, HUD_SIZE, CHARGE_BAR_H);
  ctx.fillStyle = COLOR_CHARGE;
  ctx.fillRect(x, y - CHARGE_BAR_H - 1, Math.round(HUD_SIZE * ratio), CHARGE_BAR_H);
}

/** チャージは枠の下のドット（2 以上のときだけ） */
function drawCharges(ctx: CanvasRenderingContext2D, x: number, y: number, charges: number): void {
  if (charges < 2) return;
  ctx.fillStyle = COLOR_TEXT;
  for (let i = 0; i < charges; i++) {
    ctx.fillRect(x + 1 + i * (DOT_SIZE + DOT_GAP), y + HUD_SIZE + 1, DOT_SIZE, DOT_SIZE);
  }
}

/** 装着中の刻印符は枠右の色付きドット（無効は灰色） */
function drawModifierDots(ctx: CanvasRenderingContext2D, state: GameState, index: number, x: number, y: number): void {
  const view = slotModifierView(state, index);
  view.forEach((m, i) => {
    ctx.fillStyle = m.active ? MODIFIERS[m.key].color : COLOR_EMPTY;
    ctx.fillRect(x + HUD_SIZE + 1, y + 1 + i * (DOT_SIZE + DOT_GAP), DOT_SIZE, DOT_SIZE);
  });
}
