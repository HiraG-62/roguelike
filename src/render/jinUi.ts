import type { Enemy, GameState, Jin } from "../core/state";
import { VIEW_W } from "../core/view";
import { FORMATION_LABEL } from "../data/formations";
import { JIN } from "../data/tuning";
import { eliteDisplayName, gradedName } from "../system/elites";
import { engagedRoomIndex } from "../system/engagement";
import { TEXT, drawTextShadow, textLineHeight, textWidth, truncateText } from "./pixelText";
import { drawHonjinBanner } from "./jinzuUi";
import { type HudRect, clamp01 } from "./renderMath";

/**
 * 陣（docs/ideas/jin-impl.md 2-10）の HUD と頭上の印。state を読むだけ。
 * 画面上部の中央に、ボスバー（renderer.ts の drawBossBar）と同じ高さで出す。
 * ボスバーが出る間は出さないので重ならない（どちらも交戦中の 1 つの相手を見せる枠）
 */

const COLOR_SHADOW = "#000000";
/** 名札の下限の行高（文字が小さくても詰まらない。textLineHeight が大きければそちらを使う） */
const JIN_HUD_LINE_MIN = 10;
const JIN_HUD_BAR_W = 160;
const JIN_HUD_BAR_H = 4;
const JIN_HUD_BAR_FRAME = 1;
/** バーの上端（ボスバーと同じ。core/view の論理座標） */
const JIN_HUD_BAR_Y = 50;
/** 大将の頭上の印（右向きの三角）の大きさ。名前の左に置く */
const LEADER_MARK_H = 5;
const LEADER_MARK_GAP = 3;
/** 名前の文字の縦の中心が基線からどれだけ上か（三角を名前の高さに揃える） */
const NAME_MID_RISE = 3;
/** 名前が無い大将（並の格）の三角を頭から浮かせる高さ */
const LEADER_MARK_BARE_RISE = 2;
/** 名前（ELITE_NAME_OFFSET と同じ。renderer.ts の drawEnemy が名前の基線に使う） */
const NAME_OFFSET = 6;

/** 群勢の割合 0〜1。moraleMax が 0 以下（3a の初期値・大将だけの陣など）は 0 */
export function jinMoraleRatio(jin: Pick<Jin, "morale" | "moraleMax">): number {
  if (jin.moraleMax <= 0) return 0;
  return clamp01(jin.morale / jin.moraleMax);
}

/** 陣の名札の見出し（「魚鱗の陣」。本陣は「鶴翼の本陣」。素の陣と山を遠目で分ける唯一の文字） */
export function jinHudTitle(jin: Pick<Jin, "formation" | "honjin">): string {
  return `${FORMATION_LABEL[jin.formation]}の${jin.honjin ? HONJIN_LABEL : "陣"}`;
}

/** 本陣の呼び名（docs/GLOSSARY.md） */
const HONJIN_LABEL = "本陣";

/** ボスバーが出ている（ボスがいて部屋が封鎖中）か。renderer.ts の drawBossHud と同じ条件 */
function bossBarShown(state: GameState): boolean {
  const b = state.boss;
  if (!b || b.defeated) return false;
  return state.rooms[b.roomIndex]?.locked === true;
}

/** ボスの部屋の陣（大将 = 階の主）は、ボスバーが出る前でも名札を出さない */
function inBossRoom(state: GameState, jin: Jin): boolean {
  const b = state.boss;
  if (!b || b.defeated) return false;
  return jin.roomIndex >= 0 && jin.roomIndex === b.roomIndex;
}

function nearestEngagedJin(state: GameState): Jin | null {
  const p = state.player.body.pos;
  const range2 = JIN.hud.range * JIN.hud.range;
  let best: Jin | null = null;
  let bestD2 = range2;
  for (const jin of state.jins) {
    if (jin.phase !== "engaged") continue;
    const dx = jin.center.x - p.x;
    const dy = jin.center.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) continue;
    best = jin;
    bestD2 = d2;
  }
  return best;
}

/**
 * 名札を出す陣。交戦中の塊（engagedRoomIndex）に乗った陣を優先し、無ければプレイヤーに最も近い
 * 交戦中の陣（長蛇・物見など塊に乗らない陣。JIN.hud.range 以内）。
 * ボスバーが出ているとき、ボスの部屋の陣、群勢が無い陣（moraleMax <= 0）、決着済みの陣は出さない
 */
export function jinHudTarget(state: GameState): Jin | null {
  if (state.jins.length === 0 || bossBarShown(state)) return null;
  const room = engagedRoomIndex(state);
  const inRoom = room >= 0 ? state.jins.find((j) => j.roomIndex === room && j.phase === "engaged") : undefined;
  const jin = inRoom ?? nearestEngagedJin(state);
  if (!jin || jin.moraleMax <= 0 || inBossRoom(state, jin)) return null;
  return jin;
}

/** 大将（生きていれば）。名札の大将名と頭上の印が使う */
export function jinLeader(state: GameState, jin: Jin): Enemy | undefined {
  if (jin.leaderId === null) return undefined;
  return state.enemies.find((e) => e.id === jin.leaderId && e.hp > 0);
}

/** その敵が、所属する陣の大将か */
export function isJinLeader(state: GameState, e: Enemy): boolean {
  if (e.jinId === undefined || e.hp <= 0) return false;
  const jin = state.jins.find((j) => j.id === e.jinId);
  return jin?.leaderId === e.id;
}

export interface JinHudLayout {
  /** 群勢のバー（枠の内側） */
  readonly bar: HudRect;
  /** 見出しの基線 */
  readonly titleBaseline: number;
  /** 大将名の基線 */
  readonly leaderBaseline: number;
}

/** 名札の配置。行高は Math.max(定数, textLineHeight) で、文字が大きくなっても行が詰まらない */
export function jinHudLayout(lineH: number): JinHudLayout {
  const line = Math.max(JIN_HUD_LINE_MIN, lineH);
  const bar: HudRect = { x: Math.round((VIEW_W - JIN_HUD_BAR_W) / 2), y: JIN_HUD_BAR_Y, w: JIN_HUD_BAR_W, h: JIN_HUD_BAR_H };
  return {
    bar,
    titleBaseline: bar.y - JIN_HUD_BAR_FRAME - 2,
    leaderBaseline: bar.y + bar.h + JIN_HUD_BAR_FRAME + line - 1,
  };
}

/** 画面上部の陣の名札: 「魚鱗の陣」+ 群勢のバー + 大将名 */
export function drawJinHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.status !== "playing") return;
  const jin = jinHudTarget(state);
  if (!jin) return;
  const m = TEXT.SMALL;
  const layout = jinHudLayout(textLineHeight(m));
  const { bar } = layout;
  const cx = VIEW_W / 2;
  drawTextShadow(ctx, jinHudTitle(jin), cx, layout.titleBaseline, m, JIN.hud.color, COLOR_SHADOW, "center");
  ctx.fillStyle = COLOR_SHADOW;
  ctx.fillRect(bar.x - JIN_HUD_BAR_FRAME, bar.y - JIN_HUD_BAR_FRAME, bar.w + JIN_HUD_BAR_FRAME * 2, bar.h + JIN_HUD_BAR_FRAME * 2);
  ctx.fillStyle = JIN.hud.bgColor;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.fillStyle = JIN.hud.color;
  ctx.fillRect(bar.x, bar.y, Math.round(bar.w * jinMoraleRatio(jin)), bar.h);
  const leader = jinLeader(state, jin);
  if (!leader) return;
  const name = truncateText(`大将: ${gradedName(leader)}`, bar.w, m);
  drawTextShadow(ctx, name, cx, layout.leaderBaseline, m, JIN.hud.leaderColor, COLOR_SHADOW, "center");
}

/**
 * 大将の頭上の印（右向きの小さな三角）。名前が出る敵（猛・精鋭）は名前の左、出ない敵は頭の上。
 * top は drawEnemy の頭の上端。ボス（ボスバーが出る敵）には呼ばない
 */
export function drawLeaderMark(ctx: CanvasRenderingContext2D, state: GameState, e: Enemy, cx: number, top: number): void {
  if (!isJinLeader(state, e)) return;
  // 本陣の大将は、素の陣の三角より大きな馬印（竿 + 旗。仮の絵）を頭の上に立てる
  if (state.jins.some((j) => j.leaderId === e.id && j.honjin === true)) {
    drawHonjinBanner(ctx, Math.round(cx), Math.round(top - LEADER_MARK_BARE_RISE));
    return;
  }
  const named = e.elite !== undefined || e.grade === "strong";
  const nameW = named ? textWidth(eliteDisplayName(e), TEXT.SMALL) : 0;
  const x = Math.round(named ? cx - nameW / 2 - LEADER_MARK_GAP - LEADER_MARK_H / 2 : cx - LEADER_MARK_H / 2);
  const y = Math.round(named ? top - NAME_OFFSET - NAME_MID_RISE : top - LEADER_MARK_BARE_RISE - LEADER_MARK_H / 2);
  ctx.fillStyle = COLOR_SHADOW;
  fillTriangle(ctx, x + 1, y + 1);
  ctx.fillStyle = JIN.hud.leaderColor;
  fillTriangle(ctx, x, y);
}

/** 高さ LEADER_MARK_H の右向きの三角（x, y は左端と縦の中心）。1 px の行を積んで描く */
function fillTriangle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const half = Math.floor(LEADER_MARK_H / 2);
  for (let dy = -half; dy <= half; dy++) {
    ctx.fillRect(x, y + dy, half + 1 - Math.abs(dy), 1);
  }
}
