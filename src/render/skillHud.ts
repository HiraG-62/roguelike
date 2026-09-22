import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { MODIFIERS, SKILL, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { ActiveCast, Ghost, Grenade } from "../skills/types";
import { beamEnd, grenadeRadius, slotModifierView } from "../system/skills";

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

export function drawSkillHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  ctx.save();
  ctx.translate(ox, oy);
  drawFloorStones(ctx, state);
  drawRunes(ctx, state);
  drawGrenades(ctx, state);
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

function drawGhost(ctx: CanvasRenderingContext2D, state: GameState, g: Ghost): void {
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
