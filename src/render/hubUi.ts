/**
 * 拠点の重ね描き（近い台の操作案内・出撃ゲージ・試している誓約・「建った」バナー・飾り）。
 * state は読むだけ。rng は使わない。訓練場は単一指標を出さない方針なので数値を描かない（docs/DESIGN_PRINCIPLES.md）
 */
import { actionKeyLabel } from "../core/input";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { HUB } from "../data/tuning";
import type { HubLayout, HubSpotKey } from "../map/hubMap";
import type { Rect } from "../map/grid";
import { FACILITY_HINT, FACILITY_NAME, FACILITY_OF_SPOT } from "../meta/hub";
import type { TownLook } from "../meta/townLook";
import { KEYSTONE_NAME } from "../system/keystones";
import { COLOR_BAR_EMPTY, COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_SELECTED, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, drawTextShadow, textLineHeight, textWidth, truncateText } from "./pixelText";
import { TILE_SIZE } from "../map/grid";

/** 台の描画に要るもの（renderer.setHubView で渡す） */
export interface HubSpotsView {
  spots: Readonly<Record<HubSpotKey, Vec>>;
  available: ReadonlySet<HubSpotKey>;
  near: HubSpotKey | null;
  /** 門前町の配置と景色（docs/ideas/hub-town-impl.md）。拠点は常にこれで描く */
  town: { layout: HubLayout; look: TownLook };
}

export interface HubView extends HubSpotsView {
  departHold: number;
  trialKeystone: string | null;
  banner: string | null;
  /** 武器掛けで試している武器種の名前（「大剣」「二丁拳銃」。銃の家系も武器種の名前のみ）。無ければ null */
  trialWeapon?: string | null;
  /** 借りている素の器の名前。無ければ null */
  loaned?: string | null;
  /** 試している武器種で選んでいる奥義の名前。無ければ null */
  trialUltimate?: string | null;
  /** これまでに寄進した銭の総額（井戸の台の案内に出す。無い・0 なら出さない） */
  donated?: number;
}

/** 台ごとの操作の言葉（「E: 〜」の〜） */
const SPOT_ACTION: Readonly<Record<HubSpotKey, string>> = {
  well: "出発の支度",
  board: "依頼を見る",
  forge: "残響を開く",
  library: "スキル石を開く",
  altar: "誓約を試す",
  garden: "芽を見る",
  history: "探索履歴を開く",
  codex: "図鑑を開く",
  achievements: "実績を開く",
  rack: "武器を試す",
  hall: "挑む",
};

const SHADOW = "#000000";
const NEAR_COLOR = COLOR_SELECTED;
const MARGIN = 6;
const LINE_H_MIN = 10;
const GAUGE_W = 120;
const GAUGE_H = 4;
const GAUGE_FILL = "#ffd75f";
/** 操作案内と出撃ゲージの下端からの位置 */
const PROMPT_BOTTOM = 34;
const GAUGE_BOTTOM = 18;
const BANNER_TOP = 36;
const BANNER_PAD = 6;
const TRIAL_TOP = 22;
/** 石段の案内を出す、石段の矩形までの距離（論理 px。HubRun.nearGate と同じ HUB.gateNearMargin マス） */
const GATE_PROMPT_RANGE = TILE_SIZE * HUB.gateNearMargin;
const GATE_PROMPT_TEXT = "石段: 出撃";

function lineH(m: number): number {
  return Math.max(LINE_H_MIN, textLineHeight(m));
}

/** 近い台の案内文。井戸だけ、寄進した総額があれば添える（使い道は今は無い。積み上がった記録として見せる） */
export function spotPrompt(spot: HubSpotKey, donated: number | undefined): string {
  const base = `${actionKeyLabel("interact")}: ${SPOT_ACTION[spot]}`;
  if (spot !== "well" || donated === undefined || donated <= 0) return base;
  return `${base}（寄進 ${donated}）`;
}

/** 点が石段（出撃の口）の矩形から range px 以内か。矩形が空（石段が無い拠点）なら false */
export function nearGate(pos: Vec, gateZone: Rect, range: number = GATE_PROMPT_RANGE): boolean {
  if (gateZone.w <= 0 || gateZone.h <= 0) return false;
  const left = gateZone.x * TILE_SIZE;
  const top = gateZone.y * TILE_SIZE;
  const dx = Math.max(left - pos.x, 0, pos.x - (left + gateZone.w * TILE_SIZE));
  const dy = Math.max(top - pos.y, 0, pos.y - (top + gateZone.h * TILE_SIZE));
  return Math.hypot(dx, dy) <= range;
}

/** 石段の近くの案内。台の案内（近い台があるとき）が優先で、石段は台から離れているので同じ枠を使う */
function drawGatePrompt(ctx: CanvasRenderingContext2D, state: GameState, view: HubView): void {
  if (view.near !== null) return;
  if (!nearGate(state.player.body.pos, view.town.layout.gateZone)) return;
  drawTextShadow(ctx, GATE_PROMPT_TEXT, VIEW_W / 2, VIEW_H - PROMPT_BOTTOM, TEXT.BODY, NEAR_COLOR, SHADOW, "center");
}

/** 未建設の設備の手がかりを出す、台からの距離（論理 px。台を開ける距離の 2 倍。空き地の手前に立てば読める） */
const UNBUILT_HINT_RANGE = HUB.interactRadius * 2;

/** 一番近い未建設の台（UNBUILT_HINT_RANGE 以内）。無ければ null */
export function nearUnbuiltSpot(pos: Vec, view: Pick<HubSpotsView, "spots" | "available">, range: number = UNBUILT_HINT_RANGE): HubSpotKey | null {
  let best: HubSpotKey | null = null;
  let bestD = range;
  for (const [spot, at] of Object.entries(view.spots) as [HubSpotKey, Vec][]) {
    if (view.available.has(spot)) continue;
    const d = Math.hypot(at.x - pos.x, at.y - pos.y);
    if (d > bestD) continue;
    best = spot;
    bestD = d;
  }
  return best;
}

/** 未建設の空き地の前で、解放の手がかりを 1 行（「書庫（建設予定）: スキル石を手にすると建つ」） */
function drawUnbuiltHint(ctx: CanvasRenderingContext2D, state: GameState, view: HubView): void {
  if (view.near !== null) return;
  const spot = nearUnbuiltSpot(state.player.body.pos, view);
  if (spot === null) return;
  const facility = FACILITY_OF_SPOT[spot];
  const text = truncateText(`${FACILITY_NAME[facility]}（建設予定）: ${FACILITY_HINT[facility]}`, VIEW_W - MARGIN * 2, TEXT.BODY);
  drawTextShadow(ctx, text, VIEW_W / 2, VIEW_H - PROMPT_BOTTOM, TEXT.BODY, COLOR_DIM, SHADOW, "center");
}

function drawPrompt(ctx: CanvasRenderingContext2D, view: HubView): void {
  if (view.near === null || !view.available.has(view.near)) return;
  const text = spotPrompt(view.near, view.donated);
  drawTextShadow(ctx, text, VIEW_W / 2, VIEW_H - PROMPT_BOTTOM, TEXT.BODY, NEAR_COLOR, SHADOW, "center");
}

/** 出撃ゲージの上に、試している武器と借り物を出す（借り物はランが終わると消えることを出撃前に読めるように） */
function drawRackStatus(ctx: CanvasRenderingContext2D, view: HubView): void {
  const parts: string[] = [];
  if (view.trialWeapon) parts.push(view.trialUltimate ? `試用中: ${view.trialWeapon}（奥義: ${view.trialUltimate}）` : `試用中: ${view.trialWeapon}`);
  if (view.loaned) parts.push(`借り物: ${view.loaned}`);
  if (parts.length === 0) return;
  const m = TEXT.SMALL;
  const text = truncateText(parts.join("　"), VIEW_W - MARGIN * 2, m);
  drawTextShadow(ctx, text, VIEW_W / 2, VIEW_H - PROMPT_BOTTOM - lineH(m), m, COLOR_SELECTED, SHADOW, "center");
}

/** 決定キー長押しの案内と、押している間の出撃ゲージ */
function drawDepartGauge(ctx: CanvasRenderingContext2D, view: HubView): void {
  const hint = `${actionKeyLabel("confirm")} 長押し: 出撃`;
  const x = Math.round((VIEW_W - GAUGE_W) / 2);
  const y = VIEW_H - GAUGE_BOTTOM;
  drawTextShadow(ctx, hint, VIEW_W / 2, y - 2, TEXT.SMALL, COLOR_DIM, SHADOW, "center");
  if (view.departHold <= 0) return;
  const ratio = Math.min(1, view.departHold / HUB.departHold);
  fillRectPx(ctx, { x, y: y + 2, w: GAUGE_W, h: GAUGE_H }, COLOR_BAR_EMPTY);
  fillRectPx(ctx, { x, y: y + 2, w: Math.round(GAUGE_W * ratio), h: GAUGE_H }, GAUGE_FILL);
}

function drawTrialKeystone(ctx: CanvasRenderingContext2D, view: HubView): void {
  if (view.trialKeystone === null) return;
  const name = KEYSTONE_NAME[view.trialKeystone] ?? view.trialKeystone;
  drawTextShadow(ctx, `試用中の誓約「${name}」`, VIEW_W / 2, TRIAL_TOP, TEXT.BODY, COLOR_SELECTED, SHADOW, "center");
}

function drawBanner(ctx: CanvasRenderingContext2D, view: HubView): void {
  if (view.banner === null) return;
  const m = TEXT.TITLE;
  const w = Math.min(VIEW_W - MARGIN * 2, textWidth(view.banner, m) + BANNER_PAD * 2);
  const h = lineH(m) + BANNER_PAD;
  const rect = { x: Math.round((VIEW_W - w) / 2), y: BANNER_TOP, w: Math.round(w), h: Math.round(h) };
  fillRectPx(ctx, rect, COLOR_PANEL_BG);
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const text = truncateText(view.banner, w - BANNER_PAD * 2, m);
  drawText(ctx, text, VIEW_W / 2, rect.y + rect.h / 2, m, COLOR_SELECTED, "center", "middle");
}

export function drawHubOverlay(ctx: CanvasRenderingContext2D, state: GameState, view: HubView): void {
  // 装備画面などを開いている間（paused）は、上に重なる画面の邪魔をしないよう出さない
  if (state.paused) return;
  drawTrialKeystone(ctx, view);
  drawBanner(ctx, view);
  drawPrompt(ctx, view);
  drawGatePrompt(ctx, state, view);
  drawUnbuiltHint(ctx, state, view);
  drawRackStatus(ctx, view);
  drawDepartGauge(ctx, view);
}
