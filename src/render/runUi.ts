import { type Element, ELEMENT_COLOR, ELEMENT_LABEL } from "../core/element";
import type { FloorKind, GameState, RoomState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { CONTRACT, FLOOR_KIND, LINGER, ROOM_KIND, RUN_EVENT } from "../data/tuning";
import { TRAIT_COLOR_HEX } from "../loot/types";
import { TILE_SIZE } from "../map/grid";
import { BIOMES, floorKindLabel, isInvertedDepth } from "../system/biomes";
import { CONTRACTORS, type Contractor, offerLabel, pactHudLines } from "../system/contractors";
import { LINGER_LABEL, lingerTimeLeft, shadowPositions, tideFull } from "../system/linger";
import { bountyTargetId, fogActive, hourglassLeft, reaperPassLine, reaperPassPos, runEventHudLines } from "../system/runEvents";
import { ORIGINS, runTier } from "../system/runSetup";
import { MODIFIERS } from "../skills/data";
import type { ModifierKey } from "../skills/types";
import { keystoneDef } from "../loot/affixes";
import { PROP_LABEL, ROOM_KIND_COLOR, type RoomProp, escapeActive, inFogRoom } from "../system/specialRooms";
import { TEXT, drawTextShadow, textLineHeight } from "./pixelText";
import { clamp01, pulse } from "./renderMath";
import type { SpriteAtlas } from "./sprites";

/**
 * ラン構造の描画（docs/ideas/run-expansion.md）。state を読むだけで、乱数は使わない。
 * - ワールド座標: バイオームの色調（反転層の紫）・台座・契約者・護衛対象・刻の裂け目・落下物と落雷の予告・死神の通り道・
 *   影の自分・賞金首の印・階段の行き先
 * - 画面座標: ランイベント・長居の代償・逃走・護衛・砂時計・契約の予告行、霧（霧の部屋）、起点と位階・欠片・反転層 / 帰還
 */

const COLOR_SHADOW = "#000000";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#909090";

// -----------------------------------------------------------------------------
// ワールド座標
// -----------------------------------------------------------------------------

/**
 * バイオームの色調を全画面に重ねるか。PNG 素材の床・壁（tiled）は読み込み時にバイオームの色で染めてあるので、
 * 重ねると二重に掛かる。素材が無い（未ロード・読み込み失敗）ときだけ重ねる
 */
export function biomeTintNeeded(kind: FloorKind, tiled: boolean): boolean {
  return !tiled && BIOMES[kind].tint !== null;
}

/** 床と壁に重ねるバイオームの色調（タイルを描いた直後に呼ぶ）。viewX/viewY は画面左上のワールド座標。反転層は紫を重ねる */
export function drawBiomeTint(ctx: CanvasRenderingContext2D, state: GameState, viewX: number, viewY: number, alpha: number, tiled = false): void {
  const tint = biomeTintNeeded(state.floorKind, tiled) ? BIOMES[state.floorKind].tint : null;
  if (isInvertedDepth(state.depth)) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = FLOOR_KIND.invertedColor;
    ctx.fillRect(viewX, viewY, VIEW_W, VIEW_H);
  }
  if (!tint) {
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = tint;
  ctx.fillRect(viewX, viewY, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;
}

/** 台座・護衛対象・裂け目・落下物・影・賞金首・階段の行き先（敵より手前・弾より奥に描く想定） */
export function drawRunWorld(ctx: CanvasRenderingContext2D, state: GameState, atlas?: SpriteAtlas): void {
  drawImpacts(ctx, state);
  drawStrikes(ctx, state);
  drawReaperPass(ctx, state);
  for (const room of state.rooms) drawRoomProps(ctx, state, room, atlas);
  const who = state.contracts.contractor;
  if (who) drawContractor(ctx, state, who);
  drawRift(ctx, state);
  drawShadows(ctx, state);
  drawBountyMark(ctx, state);
  drawStairsLabels(ctx, state);
}

const PROP_SIZE = 5;
const PROP_PULSE_SPEED = 3;
const LABEL_LIFT = 10;

function propColor(room: RoomState, prop: RoomProp): string {
  switch (prop.kind) {
    case "keystone":
      return ROOM_KIND.altarColor;
    case "rune":
      return ROOM_KIND.libraryColor;
    case "ascend":
      return FLOOR_KIND.ascendColor;
    case "vein":
      return RUN_EVENT.vein.color;
    case "element":
      return ELEMENT_COLOR[prop.key as Element] ?? ROOM_KIND.elementAltarColor;
    default:
      break;
  }
  if (prop.kind === "chest" && prop.key === "reaper") return ROOM_KIND_COLOR.reaperNest ?? COLOR_TEXT;
  return ROOM_KIND_COLOR[room.kind] ?? COLOR_TEXT;
}

/** 台座の名前（誓約名・刻印符名・属性・代価。無ければ種類名） */
export function propName(prop: RoomProp): string {
  switch (prop.kind) {
    case "keystone":
      return keystoneDef(prop.key)?.name ?? PROP_LABEL.keystone;
    case "rune":
      return MODIFIERS[prop.key as ModifierKey]?.name ?? PROP_LABEL.rune;
    case "element":
      return `${ELEMENT_LABEL[prop.key as Element] ?? ""}${PROP_LABEL.element}`;
    case "seal":
      return `${PROP_LABEL.seal}（欠片 ${ROOM_KIND.vaultCost}）`;
    case "vein":
      return `${PROP_LABEL.vein} 残り ${prop.uses ?? 0}`;
    case "ascend":
      return `${PROP_LABEL.ascend}（乗り続ける）`;
    default:
      return PROP_LABEL[prop.kind];
  }
}

/** atlas 上の台座の素材のキー（data/tiles.ts の prop.<PropKind>） */
export function propSpriteKey(prop: Pick<RoomProp, "kind">): string {
  return `prop.${prop.kind}`;
}

/** 素材があれば足元を台座のタイルの下端に揃えて描く。無ければ false（呼び出し側が菱形で描く） */
function drawPropSprite(ctx: CanvasRenderingContext2D, prop: RoomProp, atlas: SpriteAtlas | undefined): boolean {
  const img = atlas?.[propSpriteKey(prop)]?.frames[0];
  if (!img) return false;
  ctx.drawImage(img, Math.round(prop.pos.x - img.width / 2), Math.round(prop.pos.y + TILE_SIZE / 2 - img.height));
  return true;
}

function drawRoomProps(ctx: CanvasRenderingContext2D, state: GameState, room: RoomState, atlas: SpriteAtlas | undefined): void {
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
    if (!drawPropSprite(ctx, prop, atlas)) drawPropDiamond(ctx, state, prop, color);
    if (prop.kind === "ascend") drawHoldRing(ctx, prop, color);
    if (Math.hypot(p.x - prop.pos.x, p.y - prop.pos.y) > ROOM_KIND.propLabelRange) continue;
    const label = prop.kind === "lever" ? `${propName(prop)} 残り ${special.uses}` : propName(prop);
    drawTextShadow(ctx, label, prop.pos.x, prop.pos.y - LABEL_LIFT, TEXT.SMALL, color, COLOR_SHADOW, "center");
  }
}

/** 素材が無いときの台座（明滅する色付きの四角） */
function drawPropDiamond(ctx: CanvasRenderingContext2D, state: GameState, prop: RoomProp, color: string): void {
  const glow = pulse(state.time, PROP_PULSE_SPEED, 0.5, 1);
  ctx.globalAlpha = glow;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(prop.pos.x - PROP_SIZE / 2), Math.round(prop.pos.y - PROP_SIZE / 2), PROP_SIZE, PROP_SIZE);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLOR_SHADOW;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(prop.pos.x - PROP_SIZE / 2) - 0.5, Math.round(prop.pos.y - PROP_SIZE / 2) - 0.5, PROP_SIZE + 1, PROP_SIZE + 1);
}

const HOLD_RING_R = 8;

/** 上り階段に乗り続けた割合の輪 */
function drawHoldRing(ctx: CanvasRenderingContext2D, prop: RoomProp, color: string): void {
  const ratio = clamp01((prop.hold ?? 0) / FLOOR_KIND.ascendHold);
  if (ratio <= 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(prop.pos.x, prop.pos.y, HOLD_RING_R, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
  ctx.stroke();
}

const CONTRACTOR_HEAD_R = 3;
const CONTRACTOR_BODY_W = 6;
const CONTRACTOR_BODY_H = 7;
const CONTRACTOR_NAME_LIFT = 14;
const OFFER_SIZE = 5;

/** 契約者（頭と胴の簡単な人影）と、その前に並ぶ台座 */
function drawContractor(ctx: CanvasRenderingContext2D, state: GameState, who: Contractor): void {
  const def = CONTRACTORS[who.key];
  const p = state.player.body.pos;
  const x = Math.round(who.pos.x);
  const y = Math.round(who.pos.y);
  ctx.fillStyle = COLOR_SHADOW;
  ctx.fillRect(x - CONTRACTOR_BODY_W / 2 - 1, y - 1, CONTRACTOR_BODY_W + 2, CONTRACTOR_BODY_H + 2);
  ctx.fillStyle = def.color;
  ctx.fillRect(x - CONTRACTOR_BODY_W / 2, y, CONTRACTOR_BODY_W, CONTRACTOR_BODY_H);
  ctx.beginPath();
  ctx.arc(x, y - CONTRACTOR_HEAD_R, CONTRACTOR_HEAD_R, 0, Math.PI * 2);
  ctx.fill();
  const near = Math.hypot(p.x - who.pos.x, p.y - who.pos.y) <= CONTRACT.greetRange * 2;
  if (near) drawTextShadow(ctx, def.name, x, y - CONTRACTOR_NAME_LIFT, TEXT.SMALL, def.color, COLOR_SHADOW, "center");
  for (const offer of who.offers) {
    if (offer.used) continue;
    ctx.globalAlpha = pulse(state.time, PROP_PULSE_SPEED, 0.5, 1);
    ctx.fillStyle = def.color;
    ctx.fillRect(Math.round(offer.pos.x - OFFER_SIZE / 2), Math.round(offer.pos.y - OFFER_SIZE / 2), OFFER_SIZE, OFFER_SIZE);
    ctx.globalAlpha = 1;
  }
  // 台座どうしが近く名前が重なるので、いちばん近い台座の名前だけを出す
  const offer = nearestOffer(state, who);
  if (!offer) return;
  const affordable = state.shards >= offer.cost;
  drawTextShadow(ctx, offerLabel(offer), offer.pos.x, offer.pos.y - LABEL_LIFT, TEXT.SMALL, affordable ? def.color : COLOR_DIM, COLOR_SHADOW, "center");
}

/** 名前を読める距離にある、まだ使っていない台座のうち最も近いもの */
export function nearestOffer(state: GameState, who: Contractor): Contractor["offers"][number] | null {
  const p = state.player.body.pos;
  let best: Contractor["offers"][number] | null = null;
  let bestDist: number = ROOM_KIND.propLabelRange;
  for (const offer of who.offers) {
    if (offer.used) continue;
    const d = Math.hypot(p.x - offer.pos.x, p.y - offer.pos.y);
    if (d > bestDist) continue;
    best = offer;
    bestDist = d;
  }
  return best;
}

/** 雷鳴の刻の落雷の予告: 外周の輪と、満ちていく中の円 */
function drawStrikes(ctx: CanvasRenderingContext2D, state: GameState): void {
  const t = RUN_EVENT.thunder;
  for (const s of state.runEvents.strikes) {
    const fill = s.telegraph > 0 ? clamp01(1 - s.timer / s.telegraph) : 1;
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, t.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.2 + fill * 0.4;
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, t.radius * fill, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const PASS_LINE_WIDTH = 3;
const PASS_BLINK_SPEED = 8;

/** 死神の通り道: 予告の赤い線と、線の上を行く死神 */
function drawReaperPass(ctx: CanvasRenderingContext2D, state: GameState): void {
  const line = reaperPassLine(state);
  if (!line) return;
  ctx.globalAlpha = line.warn ? pulse(state.time, PASS_BLINK_SPEED, 0.3, 0.8) : 0.35;
  ctx.strokeStyle = RUN_EVENT.activeColor;
  ctx.lineWidth = PASS_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(line.from.x, line.from.y);
  ctx.lineTo(line.to.x, line.to.y);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
  const pos = reaperPassPos(state);
  if (!pos) return;
  ctx.fillStyle = LINGER.shadowColor;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, RUN_EVENT.reaperPass.radius, 0, Math.PI * 2);
  ctx.fill();
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
  const fogRoom = inFogRoom(state);
  if (!fogActive(state) && !fogRoom) return;
  const x = state.player.body.pos.x + ox;
  const y = state.player.body.pos.y + oy;
  const r = fogRoom ? ROOM_KIND.fogRoomRadius : RUN_EVENT.fogRadius;
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
  for (const text of pactHudLines(state)) lines.push({ text, color: CONTRACT.pactColor, blink: false });
  const witness = state.contracts.witness;
  if (witness > 0) lines.push({ text: `語り部の目撃 ${Math.ceil(witness)} 秒`, color: CONTRACTORS.bard.color, blink: false });
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

/** 右上 HUD の 1 行: 起点と位階（放浪者で縛りなしなら出さない）・欠片・反転層 / 帰還 */
export function drawRunSetupHud(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const parts = runSetupParts(state);
  if (parts.length === 0) return;
  drawTextShadow(ctx, parts.join(" · "), x, y, TEXT.SMALL, COLOR_DIM, COLOR_SHADOW, "right");
}

/** 右上 HUD の 1 行の中身（テスト用に切り出し） */
export function runSetupParts(state: GameState): string[] {
  const parts: string[] = [];
  const tier = runTier(state.modifiers);
  if (state.origin !== "wanderer" || tier > 0) parts.push(tier > 0 ? `${ORIGINS[state.origin].name} · 位階 ${tier}` : ORIGINS[state.origin].name);
  if (state.shards > 0) parts.push(`欠片 ${state.shards}`);
  if (isInvertedDepth(state.depth)) parts.push("反転層");
  if (state.runEvents.strata.revisit) parts.push("帰還");
  return parts;
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

