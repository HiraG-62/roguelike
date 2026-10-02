import type { GameState } from "../core/state";
import { MODIFIERS, SKILL, SKILL_DEFS, dwellLabel } from "../skills/data";
import { STONE_TUNING } from "../skills/tuning2";
import { stoneInSlot } from "../skills/persistence";
import { COLOR_FROST, COLOR_MINE, COLOR_WELL, fieldRadius, mineRadius, wellRadius } from "../skills/placed";
import { shiftElement, stakeSegments } from "../skills/actions2";
import { SHAPE_COLOR, shapeName, shapeRemaining } from "../skills/forms";
import { ELEMENT_COLOR, type Element } from "../core/element";
import { COMBO_TUNING } from "../skills/tuning";
import { COLOR_GRAVE, COLOR_KEG, COLOR_SPRING, COLOR_TURRET, graveRadius, kegRadius, springRadius } from "../skills/summons";
import type { ActiveCast, EchoCast } from "../skills/types";
import {
  type ResolvedSlot,
  chargeRatio,
  hookRange,
  remoteAnchor,
  resolveSlot,
  slotBodyBlocked,
  slotComboReady,
  slotModifierView,
  weaponArtBlock,
} from "../system/skills";
import { TEXT, drawText, drawTextShadow, truncateText } from "./pixelText";
import { type HudLayout, SKILL_SLOT } from "./renderMath";
import { THROWN_ARC_H, skillShotLook } from "./thrownLook";

/**
 * スキルの描画。renderer.ts が層の順（render/layers.ts）に合わせて呼ぶ。
 * ワールド側は床に置く物（drawSkillGround: 床の石・刻印符・設置物）と宙の物（drawSkillAir: 弾・投げ刃・変身・発動中）に分け、
 * 画面側は右下のスキル枠（drawSkillSlots）を描く
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
const COLOR_WHIRL = "#ffffff";
const COLOR_PARRY = "#60e0ff";

/** スキル枠 4 つ（docs/COMBAT_DESIGN.md B-8）。間隔は右の刻印符ドット（幅 3）が収まる幅。配置は renderMath.ts の hudLayout */
const HUD_SIZE = SKILL_SLOT.size;
const HUD_GAP = SKILL_SLOT.gap;
/** 最低間隔中に枠の縁を点滅させる速さ */
const INTERVAL_BLINK = 40;
const COLOR_COST = "#4aa0ff";
const COST_PAD = 1;
const DOT_SIZE = 2;
const DOT_GAP = 1;
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
const AIM_ALPHA = 0.7;
const PARRY_RING_PAD = 5;
const DARKEN_ALPHA = 0.45;

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
const MINE_SIZE = 2;
const MINE_BLINK = 6;
const MINE_RANGE_ALPHA = 0.2;
const DELAY_DASH = [3, 3];
const DELAY_RADIUS = 14;
const HOOK_HEAD = 2;
const HASTE_RING_PAD = 3;
const HASTE_SPIN = 12;

const COLOR_CHARGE = MODIFIERS.charge.color;
const CHARGE_BAR_H = 2;
const CHARGE_BAR_BG = "rgba(0,0,0,0.6)";

// ---- 大拡張の描画 ----
const COLOR_COMBO = COMBO_TUNING.color;
/** 連携可の印: 枠の左上の小さな菱形（点滅） */
const COMBO_MARK_SIZE = 2;
const COMBO_MARK_BLINK = 12;
const COLOR_THROWN = MODIFIERS.toTarget.color;
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

// ---- 第 2 弾の描画 ----
const COLOR_STAKE = "#d0c090";
const COLOR_TRAP = MODIFIERS.linger.color;
const STAKE_H = 7;
const STAKE_LINE_ALPHA = 0.55;
const STAKE_FILL_ALPHA = 0.12;
const TRAP_SIZE = 3;
const TRAP_ARMED_BLINK = 10;
const ELEMENT_MARK = 2;

// ---- 第 3 弾の変身（左右クリックの差し替え） ----
/** 変身中の体の色かぶせ（見た目だけ。点滅は時刻から決める） */
const SHAPE_TINT_ALPHA = 0.28;
const SHAPE_TINT_PULSE = 0.1;
const SHAPE_PULSE_SPEED = 8;
const SHAPE_RING_PAD = 3;
const SECONDS_DIGITS = 1;
const COLOR_FORM_WAIT = "#a080a0";


/** 床に置く物（敵より下）。ワールドの座標系（カメラの translate 済み）で呼ぶ */
export function drawSkillGround(ctx: CanvasRenderingContext2D, state: GameState): void {
  drawFloorStones(ctx, state);
  drawRunes(ctx, state);
  drawFields(ctx, state);
  drawSprings(ctx, state);
  drawStakes(ctx, state);
  drawWells(ctx, state);
  drawMines(ctx, state);
  drawTraps(ctx, state);
  drawKegs(ctx, state);
  drawGraves(ctx, state);
  drawTurrets(ctx, state);
  drawDelays(ctx, state);
  resetDrawState(ctx);
}

/** 宙の物と変身・発動中の見た目（自分より上）。ワールドの座標系で呼ぶ */
export function drawSkillAir(ctx: CanvasRenderingContext2D, state: GameState): void {
  drawThrown(ctx, state);
  drawShots(ctx, state);
  drawShape(ctx, state);
  drawActive(ctx, state);
  resetDrawState(ctx);
}

/** 右下のスキル枠と変身の行（HUD 層）。配置は layers.ts の hudLayoutFor */
export function drawSkillSlots(ctx: CanvasRenderingContext2D, state: GameState, layout: HudLayout): void {
  if (state.status !== "playing") return;
  drawSlots(ctx, state, layout);
  drawFormBanner(ctx, state, layout);
}

/** 後に描く renderer.ts の描画に透明度・線幅を持ち越さない */
function resetDrawState(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
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

/** 装備と同じ見せ方: 紫の光柱 + 菱形 + 名前。宿り符のある石は光柱・菱形・名前を金にして遠くから分かるようにする */
function drawFloorStones(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const fs of state.skills.floorStones) {
    const x = Math.round(fs.pos.x);
    const y = Math.round(fs.pos.y);
    const color = fs.stone.dwell === undefined ? COLOR_STONE : STONE_TUNING.dwellColor;
    drawPillar(ctx, x, y, color);
    const by = y + bob(fs.bobTime);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, by - GEM_SIZE);
    ctx.lineTo(x + GEM_SIZE, by);
    ctx.lineTo(x, by + GEM_SIZE);
    ctx.lineTo(x - GEM_SIZE, by);
    ctx.closePath();
    ctx.fill();
    const dwell = dwellLabel(fs.stone);
    const name = SKILL_DEFS[fs.stone.skillKey].name;
    drawLabel(ctx, dwell === null ? name : `${name}（${dwell}）`, x, y - PILLAR_H - LABEL_OFFSET, color);
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

/** 型替え符「照準起点」の近接: 発動地点から着弾点へ放物線で飛ぶ刃 */
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

/** スキルの射撃弾（綻び・毒の収穫・技の弾 …） */
function drawShots(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const s of state.skills.shots) {
    // 武器の絵で描く弾は thrownLook が重ねるので、点は描かない（輪の絵の真ん中に点が見えるため）
    if (skillShotLook(s.params.skillKey, state.stats.moveset)) continue;
    ctx.fillStyle = s.color;
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

/** 結界杭: 杭と、杭同士を結ぶ線。3 本以上なら内側を薄く塗る（中の敵は脆くなる） */
function drawStakes(ctx: CanvasRenderingContext2D, state: GameState): void {
  const stakes = state.skills.stakes;
  if (stakes.length === 0) return;
  if (stakes.length >= 3) {
    ctx.beginPath();
    stakes.forEach((s, i) => (i === 0 ? ctx.moveTo(s.pos.x, s.pos.y) : ctx.lineTo(s.pos.x, s.pos.y)));
    ctx.closePath();
    ctx.globalAlpha = STAKE_FILL_ALPHA;
    ctx.fillStyle = COLOR_STAKE;
    ctx.fill();
  }
  ctx.globalAlpha = STAKE_LINE_ALPHA;
  ctx.strokeStyle = COLOR_STAKE;
  for (const [a, b] of stakeSegments(stakes)) {
    ctx.beginPath();
    ctx.moveTo(a.pos.x, a.pos.y);
    ctx.lineTo(b.pos.x, b.pos.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const s of stakes) {
    const x = Math.round(s.pos.x);
    const y = Math.round(s.pos.y);
    ctx.globalAlpha = ZONE_FADE_MIN + (1 - ZONE_FADE_MIN) * (s.total > 0 ? s.life / s.total : 0);
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(x - 1, y - STAKE_H - 1, 3, STAKE_H + 2);
    ctx.fillStyle = COLOR_STAKE;
    ctx.fillRect(x, y - STAKE_H, 1, STAKE_H);
  }
  ctx.globalAlpha = 1;
}

/** 型替え符「据え置き」の罠: 起動前は暗く、起動後は点滅する菱形と近付かれる範囲 */
function drawTraps(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const t of state.skills.traps) {
    const x = Math.round(t.pos.x);
    const y = Math.round(t.pos.y);
    const armed = t.arm <= 0;
    circlePath(ctx, x, y, SKILL.modifier.linger.trigger);
    ctx.globalAlpha = armed ? MINE_RANGE_ALPHA : MINE_RANGE_ALPHA / 2;
    ctx.strokeStyle = COLOR_TRAP;
    ctx.stroke();
    const lit = !armed || Math.sin(state.time * TRAP_ARMED_BLINK) > 0;
    ctx.globalAlpha = lit ? 1 : ZONE_FADE_MIN;
    ctx.fillStyle = COLOR_TRAP;
    ctx.beginPath();
    ctx.moveTo(x, y - TRAP_SIZE);
    ctx.lineTo(x + TRAP_SIZE, y);
    ctx.lineTo(x, y + TRAP_SIZE);
    ctx.lineTo(x - TRAP_SIZE, y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** 変身中: 体に変身の色をかぶせ、輪郭の輪を出す（時間の変身は輪の欠けが残り時間） */
function drawShape(ctx: CanvasRenderingContext2D, state: GameState): void {
  const shape = state.skills.shape;
  if (!shape) return;
  const p = state.player.body;
  const color = SHAPE_COLOR[shape.key];
  const remain = shapeRemaining(state);
  const ratio = remain === null || shape.total <= 0 ? 1 : remain / shape.total;
  ctx.fillStyle = color;
  ctx.globalAlpha = SHAPE_TINT_ALPHA + SHAPE_TINT_PULSE * Math.sin(state.time * SHAPE_PULSE_SPEED);
  circlePath(ctx, p.pos.x, p.pos.y, p.radius);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = AIM_ALPHA;
  ctx.beginPath();
  ctx.arc(p.pos.x, p.pos.y, p.radius + SHAPE_RING_PAD, -Math.PI / 2, -Math.PI / 2 + FULL_CIRCLE * ratio);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 湧き石: 青い円（この中で近接を当てるとマナが多く戻る） */
function drawSprings(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const s of state.skills.springs) {
    drawZone(ctx, s.pos.x, s.pos.y, springRadius(s.params), COLOR_SPRING, s.total > 0 ? s.timer / s.total : 0);
  }
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

function drawActive(ctx: CanvasRenderingContext2D, state: GameState): void {
  const p = state.player;
  const rs = state.skills;
  const { x, y } = p.body.pos;
  if (rs.parryFailTimer > 0) {
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
    case "parry":
      ctx.strokeStyle = COLOR_PARRY;
      ctx.beginPath();
      ctx.arc(x, y, p.body.radius + PARRY_RING_PAD, 0, FULL_CIRCLE);
      ctx.stroke();
      return;
    case "chainHook":
      if (a.phase === "main") drawHookChain(ctx, x, y, a);
      return;
    case "comboChain":
      return;
  }
}

// ---------------------------------------------------------------------------
// HUD（画面右下）
// ---------------------------------------------------------------------------

function drawSlots(ctx: CanvasRenderingContext2D, state: GameState, layout: HudLayout): void {
  for (let i = 0; i < SKILL.slots; i++) {
    drawSlot(ctx, state, i, layout.slotLeft + i * (HUD_SIZE + HUD_GAP), layout.slotTop, layout.keyBaseline);
  }
}

function drawSlot(ctx: CanvasRenderingContext2D, state: GameState, index: number, x: number, y: number, keyBaseline: number): void {
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
  // 武器技を違う武器種で付けている枠も、本動作中と同じ暗さで「今は撃てない」を出す
  const bodyBlocked = slotBodyBlocked(state, index) || (!!r && weaponArtBlock(state, r.def) !== null);
  if (bodyBlocked) drawBodyMask(ctx, x, y);
  if (slot && r) drawIntervalBar(ctx, slot.intervalLeft, r.interval, x, y);
  ctx.strokeStyle = frameColor(state, index, ready && !!stone && !bodyBlocked);
  ctx.strokeRect(x + 0.5, y + 0.5, HUD_SIZE - 1, HUD_SIZE - 1);

  drawText(ctx, String(index + 1), x + HUD_SIZE / 2, keyBaseline, TEXT.SMALL, COLOR_DIM, "center");

  if (r?.resource === "mana") drawCost(ctx, r.cost, x, y);
  if (stone && slot && r?.resource === "cooldown") drawCharges(ctx, x, y, slot.chargesLeft);
  drawModifierDots(ctx, state, index, x, y);
  drawChargeGauge(ctx, state, index, x, y);
  drawComboMark(ctx, state, index, x, y);
  if (stone?.skillKey === "shiftingEdge" && slot) drawElementMark(ctx, shiftElement(slot.elementStep), x, y);
}

/** スキル枠の上に変身の種類と残り秒（時間で切れない変身は「維持中」）。変身していなければ共有の待ちの残り秒 */
function drawFormBanner(ctx: CanvasRenderingContext2D, state: GameState, layout: HudLayout): void {
  const text = formBannerText(state);
  if (!text) return;
  const color = state.skills.shape ? SHAPE_COLOR[state.skills.shape.key] : COLOR_FORM_WAIT;
  // 右寄せで枠の列の幅に収め、左のコンボ HUD に掛からないようにする
  const right = layout.form.x + layout.form.w;
  drawTextShadow(ctx, truncateText(text, layout.form.w, TEXT.SMALL), right, layout.formBaseline, TEXT.SMALL, color, COLOR_BLACK, "right");
}

function formBannerText(state: GameState): string | null {
  const rs = state.skills;
  if (rs.shape) {
    const remain = shapeRemaining(state);
    const name = shapeName(rs.shape.key);
    return remain === null ? `${name} 維持中` : `${name} ${remain.toFixed(SECONDS_DIGITS)}秒`;
  }
  if (rs.formWait > 0 && hasFormStone(state)) return `変身待ち ${rs.formWait.toFixed(SECONDS_DIGITS)}秒`;
  return null;
}

/** 変身の石を 1 つでも付けているか（付けていなければ待ちを出さない） */
function hasFormStone(state: GameState): boolean {
  for (let i = 0; i < SKILL.slots; i++) {
    const stone = stoneInSlot(state.skills.profile, i);
    if (stone && SKILL_DEFS[stone.skillKey].tags.includes("form")) return true;
  }
  return false;
}

/** 移ろい刃: 次に撃つ属性の色を枠の右上に小さく出す */
function drawElementMark(ctx: CanvasRenderingContext2D, element: Element, x: number, y: number): void {
  ctx.fillStyle = COLOR_BLACK;
  ctx.fillRect(x + HUD_SIZE - ELEMENT_MARK - 3, y + 1, ELEMENT_MARK + 2, ELEMENT_MARK + 2);
  ctx.fillStyle = ELEMENT_COLOR[element];
  ctx.fillRect(x + HUD_SIZE - ELEMENT_MARK - 2, y + 2, ELEMENT_MARK, ELEMENT_MARK);
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

/** マナ型はマナが足りるか、CD 型はチャージが残っているか */
function slotReady(state: GameState, chargesLeft: number, r: ResolvedSlot): boolean {
  if (r.resource !== "mana") return chargesLeft > 0;
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
