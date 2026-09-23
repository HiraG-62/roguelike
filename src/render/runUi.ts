import type { GameState, RoomState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { LINGER, ROOM_KIND, RUN_EVENT } from "../data/tuning";
import { TRAIT_COLOR_HEX } from "../loot/types";
import { TILE_SIZE } from "../map/grid";
import { BIOMES, floorKindLabel } from "../system/biomes";
import { LINGER_LABEL, lingerTimeLeft, shadowPositions, tideFull } from "../system/linger";
import { bountyTargetId, fogActive, hourglassLeft, runEventHudLines } from "../system/runEvents";
import { ORIGINS, runTier } from "../system/runSetup";
import { MODIFIERS } from "../skills/data";
import type { ModifierKey } from "../skills/types";
import { keystoneDef } from "../loot/affixes";
import { PROP_LABEL, ROOM_KIND_COLOR, type RoomProp, escapeActive } from "../system/specialRooms";
import { TEXT, drawTextShadow, textLineHeight } from "./pixelText";
import { clamp01, pulse } from "./renderMath";

/**
 * ラン構造の描画（docs/ideas/run-expansion.md）。state を読むだけで、乱数は使わない。
 * - ワールド座標: バイオームの色調・台座・護衛対象・刻の裂け目・落下物の予告・影の自分・賞金首の印・階段の行き先
 * - 画面座標: ランイベント・長居の代償・逃走・護衛・砂時計の予告行、霧、起点と位階
 */

const COLOR_SHADOW = "#000000";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#909090";

// -----------------------------------------------------------------------------
// ワールド座標
// -----------------------------------------------------------------------------

/** 床と壁に重ねるバイオームの色調（タイルを描いた直後に呼ぶ）。viewX/viewY は画面左上のワールド座標 */
export function drawBiomeTint(ctx: CanvasRenderingContext2D, state: GameState, viewX: number, viewY: number, alpha: number): void {
  const tint = BIOMES[state.floorKind].tint;
  if (!tint) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = tint;
  ctx.fillRect(viewX, viewY, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;
}

/** 台座・護衛対象・裂け目・落下物・影・賞金首・階段の行き先（敵より手前・弾より奥に描く想定） */
export function drawRunWorld(ctx: CanvasRenderingContext2D, state: GameState): void {
  drawImpacts(ctx, state);
  for (const room of state.rooms) drawRoomProps(ctx, state, room);
  drawRift(ctx, state);
  drawShadows(ctx, state);
  drawBountyMark(ctx, state);
  drawStairsLabels(ctx, state);
}

const PROP_SIZE = 5;
const PROP_PULSE_SPEED = 3;
const LABEL_LIFT = 10;

function propColor(room: RoomState, prop: RoomProp): string {
  if (prop.kind === "keystone") return ROOM_KIND.altarColor;
  if (prop.kind === "rune") return ROOM_KIND.libraryColor;
  if (prop.kind === "chest" && prop.key === "reaper") return ROOM_KIND_COLOR.reaperNest ?? COLOR_TEXT;
  return ROOM_KIND_COLOR[room.kind] ?? COLOR_TEXT;
}

/** 台座の名前（誓約名・刻印符名。無ければ種類名） */
export function propName(prop: RoomProp): string {
  if (prop.kind === "keystone") return keystoneDef(prop.key)?.name ?? PROP_LABEL.keystone;
  if (prop.kind === "rune") return MODIFIERS[prop.key as ModifierKey]?.name ?? PROP_LABEL.rune;
  return PROP_LABEL[prop.kind];
}

function drawRoomProps(ctx: CanvasRenderingContext2D, state: GameState, room: RoomState): void {
  const special = room.special;
  if (!special) return;
  const p = state.player.body.pos;
  for (const prop of special.props) {
    if (prop.used && prop.kind !== "captive") continue;
    const color = propColor(room, prop);
    if (prop.kind === "captive") {
      drawCaptive(ctx, state, room, prop, color);
      continue;
    }
    const glow = pulse(state.time, PROP_PULSE_SPEED, 0.5, 1);
    ctx.globalAlpha = glow;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(prop.pos.x - PROP_SIZE / 2), Math.round(prop.pos.y - PROP_SIZE / 2), PROP_SIZE, PROP_SIZE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLOR_SHADOW;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(prop.pos.x - PROP_SIZE / 2) - 0.5, Math.round(prop.pos.y - PROP_SIZE / 2) - 0.5, PROP_SIZE + 1, PROP_SIZE + 1);
    if (Math.hypot(p.x - prop.pos.x, p.y - prop.pos.y) > ROOM_KIND.propLabelRange) continue;
    const label = prop.kind === "lever" ? `${propName(prop)} 残り ${special.uses}` : propName(prop);
    drawTextShadow(ctx, label, prop.pos.x, prop.pos.y - LABEL_LIFT, TEXT.SMALL, color, COLOR_SHADOW, "center");
  }
}

const CAPTIVE_R = 5;
const CAPTIVE_BAR_W = 20;
const CAPTIVE_BAR_H = 2;
const CAPTIVE_BAR_LIFT = 10;
const COLOR_BAR_BG = "#301010";

function drawCaptive(ctx: CanvasRenderingContext2D, state: GameState, room: RoomState, prop: RoomProp, color: string): void {
  const special = room.special;
  if (!special) return;
  const alive = !special.failed;
  ctx.fillStyle = alive ? color : COLOR_DIM;
  ctx.beginPath();
  ctx.arc(prop.pos.x, prop.pos.y, CAPTIVE_R, 0, Math.PI * 2);
  ctx.fill();
  if (!alive || !room.locked) return;
  const ratio = special.maxHp > 0 ? clamp01(special.hp / special.maxHp) : 0;
  const x = Math.round(prop.pos.x - CAPTIVE_BAR_W / 2);
  const y = Math.round(prop.pos.y - CAPTIVE_BAR_LIFT);
  ctx.fillStyle = COLOR_BAR_BG;
  ctx.fillRect(x, y, CAPTIVE_BAR_W, CAPTIVE_BAR_H);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.round(CAPTIVE_BAR_W * ratio), CAPTIVE_BAR_H);
  // 護衛対象を削る範囲（敵がこの輪に入ると削れる）
  ctx.globalAlpha = pulse(state.time, PROP_PULSE_SPEED, 0.15, 0.35);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(prop.pos.x, prop.pos.y, ROOM_KIND.escortRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 落下物の予告: 外周の輪と、満ちていく中の円 */
function drawImpacts(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const impact of state.runEvents.impacts) {
    const fill = impact.telegraph > 0 ? clamp01(1 - impact.timer / impact.telegraph) : 1;
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = RUN_EVENT.impactColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(impact.pos.x, impact.pos.y, impact.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25 + fill * 0.35;
    ctx.fillStyle = RUN_EVENT.impactColor;
    ctx.beginPath();
    ctx.arc(impact.pos.x, impact.pos.y, impact.radius * fill, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const RIFT_R = 7;
const RIFT_SPEED = 6;
const COLOR_RIFT = "#c0f0ff";

function drawRift(ctx: CanvasRenderingContext2D, state: GameState): void {
  const current = state.runEvents.room;
  if (current?.key !== "timeRift" || current.phase !== "active" || !current.pos) return;
  ctx.globalAlpha = pulse(state.time, RIFT_SPEED, 0.5, 1);
  ctx.strokeStyle = COLOR_RIFT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(current.pos.x, current.pos.y - RIFT_R);
  ctx.lineTo(current.pos.x + RIFT_R / 2, current.pos.y);
  ctx.lineTo(current.pos.x, current.pos.y + RIFT_R);
  ctx.lineTo(current.pos.x - RIFT_R / 2, current.pos.y);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const SHADOW_ALPHA = 0.7;

function drawShadows(ctx: CanvasRenderingContext2D, state: GameState): void {
  const shadows = shadowPositions(state);
  if (shadows.length === 0) return;
  ctx.fillStyle = LINGER.shadowColor;
  for (const pos of shadows) {
    ctx.globalAlpha = pulse(state.time, PROP_PULSE_SPEED, SHADOW_ALPHA * 0.6, SHADOW_ALPHA);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, LINGER.shadowRadius + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const BOUNTY_LIFT = 16;

function drawBountyMark(ctx: CanvasRenderingContext2D, state: GameState): void {
  const id = bountyTargetId(state);
  if (id < 0) return;
  const e = state.enemies.find((x) => x.id === id && x.hp > 0);
  if (!e) return;
  drawTextShadow(ctx, "賞金首", e.body.pos.x, e.body.pos.y - e.body.radius - BOUNTY_LIFT, TEXT.SMALL, RUN_EVENT.activeColor, COLOR_SHADOW, "center");
}

/** 階段の上に行き先（分岐路）。近くにいるときだけ */
const STAIRS_LABEL_RANGE = 120;

function drawStairsLabels(ctx: CanvasRenderingContext2D, state: GameState): void {
  const p = state.player.body.pos;
  for (const choice of state.stairs) {
    if (choice.tile < 0 || state.explored[choice.tile] !== 1) continue;
    const x = ((choice.tile % state.map.width) + 0.5) * TILE_SIZE;
    const y = (Math.floor(choice.tile / state.map.width) + 0.5) * TILE_SIZE;
    if (Math.hypot(p.x - x, p.y - y) > STAIRS_LABEL_RANGE) continue;
    const color = BIOMES[choice.nextKind].tint ?? COLOR_TEXT;
    drawTextShadow(ctx, floorKindLabel(choice.nextKind), x, y - LABEL_LIFT, TEXT.SMALL, color, COLOR_SHADOW, "center");
  }
}

// -----------------------------------------------------------------------------
// 画面座標
// -----------------------------------------------------------------------------

const FOG_EDGE_ALPHA = 0.82;
const FOG_FEATHER = 0.45;
const COLOR_FOG = "200,205,215";

/** 霧: プレイヤーの周りだけ見える（ワールドを描いた後、HUD の前に呼ぶ） */
export function drawRunOverlay(ctx: CanvasRenderingContext2D, state: GameState, ox: number, oy: number): void {
  if (!fogActive(state)) return;
  const x = state.player.body.pos.x + ox;
  const y = state.player.body.pos.y + oy;
  const r = RUN_EVENT.fogRadius;
  const g = ctx.createRadialGradient(x, y, r * (1 - FOG_FEATHER), x, y, r);
  g.addColorStop(0, `rgba(${COLOR_FOG},0)`);
  g.addColorStop(1, `rgba(${COLOR_FOG},${FOG_EDGE_ALPHA})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

const HUD_BOTTOM_Y = VIEW_H - 20;
const HUD_LINE_MIN = 10;
const BLINK_SPEED = 6;

interface HudLine {
  text: string;
  color: string;
  blink: boolean;
}

/** 下中央に積む予告・実行中の行（封鎖中の表示の上から上へ） */
export function drawRunHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.status !== "playing") return;
  const lines = collectHudLines(state);
  const step = Math.max(HUD_LINE_MIN, textLineHeight(TEXT.SMALL));
  lines.forEach((line, i) => {
    ctx.globalAlpha = line.blink ? pulse(state.time, BLINK_SPEED, 0.5, 1) : 1;
    drawTextShadow(ctx, line.text, VIEW_W / 2, HUD_BOTTOM_Y - i * step, TEXT.SMALL, line.color, COLOR_SHADOW, "center");
  });
  ctx.globalAlpha = 1;
}

function collectHudLines(state: GameState): HudLine[] {
  const lines: HudLine[] = runEventHudLines(state).map((l) => ({
    text: l.text,
    color: l.warn ? RUN_EVENT.warnColor : RUN_EVENT.activeColor,
    blink: l.warn,
  }));
  const linger = lingerLine(state);
  if (linger) lines.push(linger);
  if (escapeActive(state)) lines.push({ text: "床が崩れていく！ 奥の宝箱へ走れ", color: ROOM_KIND.escapeColor, blink: true });
  const escort = escortLine(state);
  if (escort) lines.push(escort);
  const hourglass = hourglassLeft(state);
  if (hourglass !== null) lines.push({ text: `砂時計: 増援まで ${Math.ceil(hourglass)} 秒`, color: RUN_EVENT.warnColor, blink: hourglass <= RUN_EVENT.warnTime });
  const stairs = stairsLine(state);
  if (stairs) lines.push(stairs);
  return lines;
}

const LINGER_ACTIVE_TEXT = {
  shadow: "影の自分が追ってくる",
  collapse: "天井が崩れてくる",
  tide: "潮が満ちてくる",
} as const;

function lingerLine(state: GameState): HudLine | null {
  const linger = state.runEvents.linger;
  const left = lingerTimeLeft(state);
  if (!linger.kind || left === null) return null;
  if (!linger.started) {
    if (left > LINGER.warnMargin) return null;
    return { text: `長居の代償「${LINGER_LABEL[linger.kind]}」まで ${Math.ceil(left)} 秒`, color: RUN_EVENT.warnColor, blink: true };
  }
  const text = linger.kind === "tide" && tideFull(state) ? "満潮: 水の上で溺れる" : LINGER_ACTIVE_TEXT[linger.kind];
  return { text, color: RUN_EVENT.activeColor, blink: false };
}

function escortLine(state: GameState): HudLine | null {
  const room = state.rooms.find((r) => r.kind === "escort" && r.locked);
  const special = room?.special;
  if (!special || special.failed) return null;
  return { text: `護衛: 捕らわれ人 ${Math.ceil(special.hp)}/${special.maxHp}`, color: ROOM_KIND.escortColor, blink: false };
}

/** 最後の部屋にいる間は、階段ごとの行き先を並べる */
function stairsLine(state: GameState): HudLine | null {
  if (state.stairs.length < 2 || state.stairs.some((s) => s.tile < 0)) return null;
  const p = state.player.body.pos;
  const near = state.stairs.some((s) => {
    const x = ((s.tile % state.map.width) + 0.5) * TILE_SIZE;
    const y = (Math.floor(s.tile / state.map.width) + 0.5) * TILE_SIZE;
    return Math.hypot(p.x - x, p.y - y) <= STAIRS_LABEL_RANGE;
  });
  if (!near) return null;
  return { text: `分岐路: ${state.stairs.map((s) => floorKindLabel(s.nextKind)).join(" / ")}`, color: COLOR_TEXT, blink: false };
}

/** 右上 HUD の 1 行: 起点と位階（放浪者で縛りなしなら出さない） */
export function drawRunSetupHud(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const tier = runTier(state.modifiers);
  if (state.origin === "wanderer" && tier === 0) return;
  const text = tier > 0 ? `${ORIGINS[state.origin].name} · 位階 ${tier}` : ORIGINS[state.origin].name;
  drawTextShadow(ctx, text, x, y, TEXT.SMALL, COLOR_DIM, COLOR_SHADOW, "right");
}

/** 共鳴炉の扉の色（部屋の色）。drawDoorMark が使う */
export function specialDoorColor(room: RoomState): string | undefined {
  if (room.kind === "resonance" && room.special?.color) return TRAIT_COLOR_HEX[room.special.color];
  return ROOM_KIND_COLOR[room.kind];
}

/** 扉の印を消すか: 台座の部屋は全部使ったら、それ以外は制圧で */
export function doorMarkDone(room: RoomState): boolean {
  if (room.kind === "shrine") return room.used;
  const props = room.special?.props;
  if (props && props.length > 0 && room.cleared) return props.every((p) => p.used || p.kind === "captive");
  return room.cleared;
}

