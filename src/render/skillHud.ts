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
import { meteorRadius, stompRadius } from "../skills/actions";
import { COMBO_TUNING } from "../skills/tuning";
import {
  COLOR_BONE,
  COLOR_GRAVE,
  COLOR_KEG,
  COLOR_SPRING,
  COLOR_TURRET,
  bonePositions,
  graveRadius,
  kegRadius,
  springRadius,
} from "../skills/summons";
import type { ActiveCast, EchoCast, Ghost, Grenade } from "../skills/types";
import {
  type ResolvedSlot,
  beamEnd,
  chargeRatio,
  chargeStageMarks,
  grenadeRadius,
  hookRange,
  quakeRadius,
  remoteAnchor,
  resolveSlot,
  slotBodyBlocked,
  slotComboReady,
  slotModifierView,
} from "../system/skills";
import { TEXT, drawText, drawTextShadow } from "./pixelText";

/**
 * スキルの描画。renderer.ts を触らずに済むよう、main.ts が renderer.render の後に呼ぶ。
 * ワールド側（床の石・刻印符・グレネード・照準線・旋風の円弧）と画面側の HUD を描く。
 */

const COLOR_STONE = SKILL.drop.stoneColor;
const COLOR_RUNE = SKILL.drop.runeColor;
const COLOR_FRAME = "#505050";
const COLOR_FRAME_READY = "#c0c0c0";
const COLOR_BG = "rgba(12,12,18,0.85)";
const COLOR_MASK = "rgba(0,0,0,0.65)";
/** 本動作の排他で今は撃てないスロット（本動作が終われば撃てる）。マナ・CD 不足より薄く暗くする */
const COLOR_BODY_MASK = "rgba(0,0,0,0.4)";
/** スロットごとの最低間隔の残りを示す枠下端の細いバー */
const COLOR_INTERVAL_BAR = "#a0c8ff";
const INTERVAL_BAR_H = 1;
const COLOR_EMPTY = "#606060";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_BLACK = "#000000";
const COLOR_WARN = "#ff5050";
const COLOR_AIM = "#ff6060";
const COLOR_WHIRL = "#ffffff";
const COLOR_PARRY = "#60e0ff";
const COLOR_GRENADE = "#c0c0c0";

/** スキル枠 4 つ（docs/COMBAT_DESIGN.md B-8）。間隔は右の刻印符ドット（幅 3）が収まる幅 */
const HUD_SIZE = 16;
const HUD_GAP = 4;
/** 最低間隔中に枠の縁を点滅させる速さ */
const INTERVAL_BLINK = 40;
const COLOR_COST = "#4aa0ff";
const COST_PAD = 1;
/** 画面下端からの距離（「封鎖中」表示の上） */
const HUD_BOTTOM = 26;
const DOT_SIZE = 2;
const DOT_GAP = 1;
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
const COLOR_STAGE_MARK = "#000000";

// ---- 大拡張の描画 ----
const COLOR_COMBO = COMBO_TUNING.color;
/** 連携可の印: 枠の左上の小さな菱形（点滅） */
const COMBO_MARK_SIZE = 2;
const COMBO_MARK_BLINK = 12;
const COLOR_THROWN = MODIFIERS.toThrown.color;
const THROWN_ARC_H = 14;
const THROWN_SIZE = 2;
const SHOT_SIZE = 2;
const KEG_W = 5;
const KEG_H = 6;
const KEG_BAND = 1;
const KEG_RANGE_ALPHA = 0.15;
const GRAVE_H = 9;
const GRAVE_GUARD = 3;
const GRAVE_RANGE_ALPHA = 0.18;
const TURRET_SIZE = 3;
const TURRET_BARREL = 5;
const BONE_SIZE = 2;
const COLOR_METEOR = "#ffb060";
const COLOR_THREAD = "#e0d0b0";
const COLOR_GUILLOTINE = "#ffffff";
const COLOR_STOMP = "#d0a060";
const THREAD_DASH = [2, 2];

export function drawSkillHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  ctx.save();
  ctx.translate(ox, oy);
  drawFloorStones(ctx, state);
  drawRunes(ctx, state);
  drawFields(ctx, state);
  drawSprings(ctx, state);
  drawWells(ctx, state);
  drawMines(ctx, state);
  drawKegs(ctx, state);
  drawGraves(ctx, state);
  drawTurrets(ctx, state);
  drawStrikes(ctx, state);
  drawDelays(ctx, state);
  drawThrown(ctx, state);
  drawGrenades(ctx, state);
  drawBullets(ctx, state);
  drawShots(ctx, state);
  drawBones(ctx, state);
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
  drawTextShadow(ctx, text, x, y, TEXT.SMALL, color, COLOR_BLACK, "center");
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
    drawLabel(ctx, `刻印符: ${def.name}`, x, Math.round(rune.pos.y) - PILLAR_H - LABEL_OFFSET, COLOR_RUNE);
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

/** 型替え符「投げ刃」: 発動地点から着弾点へ放物線で飛ぶ刃 */
function drawThrown(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const e of state.skills.echoes) {
    if (e.kind !== "thrown") continue;
    const from = state.player.body.pos;
    drawThrownBlade(ctx, e, from);
  }
}

function drawThrownBlade(ctx: CanvasRenderingContext2D, e: EchoCast, from: { x: number; y: number }): void {
  const t = e.total > 0 ? 1 - e.timer / e.total : 1;
  const x = from.x + (e.origin.x - from.x) * t;
  const y = from.y + (e.origin.y - from.y) * t - Math.sin(t * Math.PI) * THROWN_ARC_H;
  ctx.fillStyle = COLOR_THROWN;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, THROWN_SIZE + 1, THROWN_SIZE + 1);
  ctx.setLineDash(DELAY_DASH);
  ctx.strokeStyle = COLOR_THROWN;
  circlePath(ctx, e.origin.x, e.origin.y, DELAY_RADIUS * (1 - t) + 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 大拡張の射撃弾（綻び・跳弾・風切り …）。風切りは大きめの円 */
function drawShots(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const s of state.skills.shots) {
    ctx.fillStyle = s.color;
    if (s.effect === "gale") {
      ctx.globalAlpha = AIM_ALPHA;
      circlePath(ctx, s.pos.x, s.pos.y, s.radius);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    ctx.fillRect(Math.round(s.pos.x) - 1, Math.round(s.pos.y) - 1, SHOT_SIZE, SHOT_SIZE);
  }
}

/** 爆薬樽: 小さな樽 + 爆発範囲の薄い円 */
function drawKegs(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const k of state.skills.kegs) {
    const x = Math.round(k.pos.x);
    const y = Math.round(k.pos.y);
    circlePath(ctx, x, y, kegRadius(k.params));
    ctx.globalAlpha = KEG_RANGE_ALPHA;
    ctx.strokeStyle = COLOR_KEG;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(x - Math.ceil(KEG_W / 2) - 1, y - KEG_H - 1, KEG_W + 2, KEG_H + 2);
    ctx.fillStyle = COLOR_KEG;
    ctx.fillRect(x - Math.ceil(KEG_W / 2), y - KEG_H, KEG_W, KEG_H);
    ctx.fillStyle = COLOR_WARN;
    ctx.fillRect(x - Math.ceil(KEG_W / 2), y - Math.ceil(KEG_H / 2), KEG_W, KEG_BAND);
  }
}

/** 剣の墓標: 地面に刺さった剣。回転斬りの瞬間は範囲の円を濃く */
function drawGraves(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const g of state.skills.graves) {
    const x = Math.round(g.pos.x);
    const y = Math.round(g.pos.y);
    circlePath(ctx, x, y, graveRadius(g.params));
    ctx.globalAlpha = g.spin > 0 ? ZONE_EDGE_ALPHA : GRAVE_RANGE_ALPHA;
    ctx.strokeStyle = COLOR_GRAVE;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (g.spin > 0) drawWhirlArcs(ctx, state, x, y, graveRadius(g.params), AIM_ALPHA);
    ctx.strokeStyle = COLOR_GRAVE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - GRAVE_H);
    ctx.moveTo(x - GRAVE_GUARD, y - GRAVE_H + GRAVE_GUARD);
    ctx.lineTo(x + GRAVE_GUARD, y - GRAVE_H + GRAVE_GUARD);
    ctx.stroke();
  }
}

/** 砲台: 四角い台座 + 自分の向きへの砲身 */
function drawTurrets(ctx: CanvasRenderingContext2D, state: GameState): void {
  const f = state.player.facing;
  for (const t of state.skills.turrets) {
    const x = Math.round(t.pos.x);
    const y = Math.round(t.pos.y);
    ctx.globalAlpha = ZONE_FADE_MIN + (1 - ZONE_FADE_MIN) * (t.total > 0 ? t.life / t.total : 0);
    ctx.fillStyle = COLOR_TURRET;
    ctx.fillRect(x - TURRET_SIZE, y - TURRET_SIZE, TURRET_SIZE * 2, TURRET_SIZE * 2);
    ctx.strokeStyle = COLOR_TURRET;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + f.x * TURRET_BARREL, y + f.y * TURRET_BARREL);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** 骨片の輪: 自分の周りを回る骨片 */
function drawBones(ctx: CanvasRenderingContext2D, state: GameState): void {
  const ring = state.skills.boneRing;
  if (!ring) return;
  ctx.fillStyle = COLOR_BONE;
  for (const b of bonePositions(state, ring)) {
    ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, BONE_SIZE, BONE_SIZE);
  }
}

/** 湧き石: 青い円（この中で近接を当てるとマナが多く戻る） */
function drawSprings(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const s of state.skills.springs) {
    drawZone(ctx, s.pos.x, s.pos.y, springRadius(s.params), COLOR_SPRING, s.total > 0 ? s.timer / s.total : 0);
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
    case "meteorDive":
      // 落下点の予告（敵にも見える）
      drawZone(ctx, a.target.x, a.target.y, meteorRadius(a.params), COLOR_METEOR, 1 - (a.total > 0 ? a.timer / a.total : 1));
      return;
    case "threadReel":
      if (a.phase !== "main") return;
      ctx.setLineDash(THREAD_DASH);
      ctx.strokeStyle = COLOR_THREAD;
      ctx.beginPath();
      ctx.moveTo(a.target.x, a.target.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    case "guillotine":
      if (a.phase === "main") drawGuillotineAim(ctx, state, x, y, a);
      return;
    case "dregsBlade":
      if (a.phase === "main") drawWhirlArcs(ctx, state, x, y, SKILL.dregsBlade.radius * a.params.areaMul, AIM_ALPHA);
      return;
    case "stomp":
      ctx.strokeStyle = COLOR_STOMP;
      ctx.globalAlpha = AIM_ALPHA / 2;
      circlePath(ctx, x, y, stompRadius(a.params));
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    case "comboChain":
    case "swallowFlip":
      return;
  }
}

/** 断頭振りの溜め: 振り下ろす線と、刃先（威力が倍になる所）の印 */
function drawGuillotineAim(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number, a: ActiveCast): void {
  const g = SKILL.guillotine;
  const reach = state.stats.meleeReachMul * a.params.areaMul;
  const progress = a.total > 0 ? 1 - a.timer / a.total : 1;
  ctx.globalAlpha = AIM_ALPHA * progress;
  ctx.strokeStyle = COLOR_GUILLOTINE;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + a.dir.x * g.length * reach, y + a.dir.y * g.length * reach);
  ctx.stroke();
  ctx.fillStyle = COLOR_WARN;
  const sx = x + a.dir.x * g.sweetFrom * reach;
  const sy = y + a.dir.y * g.sweetFrom * reach;
  ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, DOT_SIZE, DOT_SIZE);
  ctx.globalAlpha = 1;
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
  const r = resolveSlot(state, index);
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(x, y, HUD_SIZE, HUD_SIZE);

  const ready = !!slot && !!r && slotReady(state, slot.chargesLeft, r);
  // 倍率で行高が変わっても枠の中央に来るよう middle 基準で置く
  const icon = stone ? SKILL_DEFS[stone.skillKey].icon : "-";
  drawText(ctx, icon, x + HUD_SIZE / 2, y + HUD_SIZE / 2, TEXT.BODY, stone ? COLOR_STONE : COLOR_EMPTY, "center", "middle");

  if (slot && r) drawReadyMask(ctx, slot, r, ready, x, y);
  const bodyBlocked = slotBodyBlocked(state, index);
  if (bodyBlocked) drawBodyMask(ctx, x, y);
  if (slot && r) drawIntervalBar(ctx, slot.intervalLeft, r.interval, x, y);
  ctx.strokeStyle = frameColor(state, index, ready && !!stone && !bodyBlocked);
  ctx.strokeRect(x + 0.5, y + 0.5, HUD_SIZE - 1, HUD_SIZE - 1);

  drawText(ctx, String(index + 1), x + HUD_SIZE / 2, y + HUD_SIZE + KEY_OFFSET_Y, TEXT.SMALL, COLOR_DIM, "center");

  if (r?.resource === "mana") drawCost(ctx, r.cost, x, y);
  if (stone && slot && r?.resource === "cooldown") drawCharges(ctx, x, y, slot.chargesLeft);
  drawModifierDots(ctx, state, index, x, y);
  drawChargeGauge(ctx, state, index, x, y);
  drawComboMark(ctx, state, index, x, y);
}

/** 連携可: いま撃てばこのスロットが連携で変化するなら、枠の左上に点滅する小さな菱形 */
function drawComboMark(ctx: CanvasRenderingContext2D, state: GameState, index: number, x: number, y: number): void {
  if (!slotComboReady(state, index)) return;
  if (Math.sin(state.time * COMBO_MARK_BLINK) < 0) return;
  const cx = x + COMBO_MARK_SIZE + 1;
  const cy = y + COMBO_MARK_SIZE + 1;
  ctx.fillStyle = COLOR_COMBO;
  ctx.beginPath();
  ctx.moveTo(cx, cy - COMBO_MARK_SIZE);
  ctx.lineTo(cx + COMBO_MARK_SIZE, cy);
  ctx.lineTo(cx, cy + COMBO_MARK_SIZE);
  ctx.lineTo(cx - COMBO_MARK_SIZE, cy);
  ctx.closePath();
  ctx.fill();
}

/** マナ型はマナが足りるか（枯渇の刃は残り少ないときだけ）、CD 型はチャージが残っているか */
function slotReady(state: GameState, chargesLeft: number, r: ResolvedSlot): boolean {
  if (r.resource !== "mana") return chargesLeft > 0;
  if (r.def.manaRule === "low") return state.player.mana < state.stats.maxMana * SKILL.dregsBlade.lowRatio;
  return state.player.mana >= r.cost;
}

/** マナ型の不足は枠全体を暗く、CD 型は上から暗いマスクが減っていく */
function drawReadyMask(
  ctx: CanvasRenderingContext2D,
  slot: { cooldownLeft: number; cooldownTotal: number },
  r: ResolvedSlot,
  ready: boolean,
  x: number,
  y: number,
): void {
  if (ready) return;
  ctx.fillStyle = COLOR_MASK;
  if (r.resource === "mana") {
    ctx.fillRect(x, y, HUD_SIZE, HUD_SIZE);
    return;
  }
  if (slot.cooldownTotal <= 0) return;
  const ratio = Math.min(1, slot.cooldownLeft / slot.cooldownTotal);
  ctx.fillRect(x, y, HUD_SIZE, Math.round(HUD_SIZE * ratio));
}

/** 本動作の最中、同じ排他グループ（body）のスロットは薄く暗くする。暗くならないスロットは並行して撃てる */
function drawBodyMask(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = COLOR_BODY_MASK;
  ctx.fillRect(x, y, HUD_SIZE, HUD_SIZE);
}

/**
 * このスロットだけの最低間隔の残り（枠の下端、右から減る）。全スロット共通の待ち（GCD）は無いので、
 * 他のスロットのバーは動かず、そのまま撃てることが分かる
 */
function drawIntervalBar(ctx: CanvasRenderingContext2D, left: number, total: number, x: number, y: number): void {
  if (left <= 0 || total <= 0) return;
  const ratio = Math.min(1, left / total);
  ctx.fillStyle = COLOR_INTERVAL_BAR;
  ctx.fillRect(x, y + HUD_SIZE - INTERVAL_BAR_H, Math.round(HUD_SIZE * ratio), INTERVAL_BAR_H);
}

/** 発動中は警告色、最低間隔中は縁が点滅、撃てるなら明るい縁 */
function frameColor(state: GameState, index: number, ready: boolean): string {
  const rs = state.skills;
  if (rs.active?.slot === index) return COLOR_WARN;
  const interval = rs.slots[index]?.intervalLeft ?? 0;
  if (interval > 0 && Math.sin(state.time * INTERVAL_BLINK) > 0) return COLOR_FRAME;
  return ready ? COLOR_FRAME_READY : COLOR_FRAME;
}

/** マナ型の右上にコスト（整数）。アイコンと重なるので影付き（drawTextShadow は baseline を選べないので 2 回描く） */
function drawCost(ctx: CanvasRenderingContext2D, cost: number, x: number, y: number): void {
  const text = String(Math.round(cost));
  const right = x + HUD_SIZE - COST_PAD;
  const top = y + COST_PAD;
  drawText(ctx, text, right + COST_PAD, top + COST_PAD, TEXT.SMALL, COLOR_BLACK, "right", "top");
  drawText(ctx, text, right, top, TEXT.SMALL, COLOR_COST, "right", "top");
}

/** 溜め中のスロット上端に細いバー。溜め時間の割合(0..1)ぶん左から満ちる */
function drawChargeGauge(ctx: CanvasRenderingContext2D, state: GameState, index: number, x: number, y: number): void {
  const ratio = chargeRatio(state, index);
  if (ratio === null) return;
  ctx.fillStyle = CHARGE_BAR_BG;
  ctx.fillRect(x, y - CHARGE_BAR_H - 1, HUD_SIZE, CHARGE_BAR_H);
  ctx.fillStyle = COLOR_CHARGE;
  ctx.fillRect(x, y - CHARGE_BAR_H - 1, Math.round(HUD_SIZE * ratio), CHARGE_BAR_H);
  // 段階溜めは段の区切りを刻む
  ctx.fillStyle = COLOR_STAGE_MARK;
  for (const mark of chargeStageMarks(state, index)) {
    ctx.fillRect(x + Math.round(HUD_SIZE * mark), y - CHARGE_BAR_H - 1, 1, CHARGE_BAR_H);
  }
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
