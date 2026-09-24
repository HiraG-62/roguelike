/**
 * 拠点の重ね描き（設備名・近い台の操作案内・出撃ゲージ・試している誓約・「建った」バナー・飾り）。
 * state は読むだけ。rng は使わない。訓練場は単一指標を出さない方針なので数値を描かない（docs/DESIGN_PRINCIPLES.md）
 */
import { actionKeyLabel } from "../core/input";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { HUB } from "../data/tuning";
import type { HubSpotKey } from "../map/hubMap";
import { FACILITY_NAME, FACILITY_OF_SPOT, type HubDecor } from "../meta/hub";
import { KEYSTONE_NAME } from "../system/keystones";
import { COLOR_BAR_EMPTY, COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_SELECTED, COLOR_TEXT, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, drawTextShadow, textLineHeight, textWidth, truncateText } from "./pixelText";
import type { Sprite } from "./sprites";
import { TILE_SIZE } from "../map/grid";

/** 拠点の設備の PNG 素材を引く（Renderer.atlasSprite）。無ければ絵を出さずラベルだけにする */
export type HubSpriteLookup = (key: string) => Sprite | undefined;

export interface HubView {
  spots: Readonly<Record<HubSpotKey, Vec>>;
  available: ReadonlySet<HubSpotKey>;
  near: HubSpotKey | null;
  departHold: number;
  trialKeystone: string | null;
  decor: readonly HubDecor[];
  banner: string | null;
  /** 武器掛けで試している武器種・射撃の型（「大剣 / 散弾」）。無ければ null */
  trialWeapon?: string | null;
  /** 借りている素の器の名前。無ければ null */
  loaned?: string | null;
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
};

/** 記録室の 3 台は設備名だけだと区別できないので台の名前を出す */
const SPOT_LABEL_OVERRIDE: Partial<Readonly<Record<HubSpotKey, string>>> = {
  history: "探索履歴",
  codex: "図鑑",
  achievements: "実績",
};

const SHADOW = "#000000";
const NEAR_COLOR = COLOR_SELECTED;
/** 台の中心から名前までの上方向のずれ（論理 px） */
const LABEL_RISE = 12;
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
const DECOR_TOP = 22;
const DECOR_W = 130;
const DECOR_MAX_LINES = 6;

/** renderer.ts の render と同じ式で、ワールド座標 → 画面座標のずれを求める（main.ts から渡すため） */
export function hubScreenOffset(state: GameState): { ox: number; oy: number } {
  const cam = state.camera;
  return {
    ox: Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x),
    oy: Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y),
  };
}

function spotLabel(spot: HubSpotKey): string {
  return SPOT_LABEL_OVERRIDE[spot] ?? FACILITY_NAME[FACILITY_OF_SPOT[spot]];
}

function lineH(m: number): number {
  return Math.max(LINE_H_MIN, textLineHeight(m));
}

/** atlas 上の設備の素材のキー（data/tiles.ts の hub.<HubSpotKey>） */
export function hubSpriteKey(spot: HubSpotKey): string {
  return `hub.${spot}`;
}

/** 素材の足元を台のタイルの下端に揃える。背の高い素材（書架）の分だけ上に伸びた量を返す */
function drawSpotSprite(ctx: CanvasRenderingContext2D, sprite: Sprite | undefined, pos: Vec, ox: number, oy: number): number {
  const img = sprite?.frames[0];
  if (!img) return 0;
  const bottom = pos.y + oy + TILE_SIZE / 2;
  ctx.drawImage(img, Math.round(pos.x + ox - img.width / 2), Math.round(bottom - img.height));
  return Math.max(0, img.height - TILE_SIZE);
}

function drawSpots(ctx: CanvasRenderingContext2D, view: HubView, ox: number, oy: number, lookup: HubSpriteLookup | undefined): void {
  for (const spot of view.available) {
    const pos = view.spots[spot];
    const rise = drawSpotSprite(ctx, lookup?.(hubSpriteKey(spot)), pos, ox, oy);
    const color = view.near === spot ? NEAR_COLOR : COLOR_TEXT;
    drawTextShadow(ctx, spotLabel(spot), pos.x + ox, pos.y + oy - LABEL_RISE - rise, TEXT.SMALL, color, SHADOW, "center");
  }
}

function drawPrompt(ctx: CanvasRenderingContext2D, view: HubView): void {
  if (view.near === null || !view.available.has(view.near)) return;
  const text = `${actionKeyLabel("interact")}: ${SPOT_ACTION[view.near]}`;
  drawTextShadow(ctx, text, VIEW_W / 2, VIEW_H - PROMPT_BOTTOM, TEXT.BODY, NEAR_COLOR, SHADOW, "center");
}

/** 出撃ゲージの上に、試している武器と借り物を出す（借り物はランが終わると消えることを出撃前に読めるように） */
function drawRackStatus(ctx: CanvasRenderingContext2D, view: HubView): void {
  const parts: string[] = [];
  if (view.trialWeapon) parts.push(`試し中: ${view.trialWeapon}`);
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
  drawTextShadow(ctx, `試している誓約「${name}」`, VIEW_W / 2, TRIAL_TOP, TEXT.BODY, COLOR_SELECTED, SHADOW, "center");
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

/** 飾りは右上に小さく並べる（拠点ではミニマップを出さないので空いている） */
function drawDecor(ctx: CanvasRenderingContext2D, view: HubView): void {
  const m = TEXT.SMALL;
  const step = lineH(m);
  const x = VIEW_W - MARGIN;
  view.decor.slice(0, DECOR_MAX_LINES).forEach((d, i) => {
    drawTextShadow(ctx, truncateText(d.label, DECOR_W, m), x, DECOR_TOP + step * i, m, COLOR_DIM, SHADOW, "right");
  });
}

export function drawHubOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: HubView,
  ox: number,
  oy: number,
  lookup?: HubSpriteLookup,
): void {
  // 装備画面などを開いている間（paused）は、上に重なる画面の邪魔をしないよう出さない
  if (state.paused) return;
  drawSpots(ctx, view, ox, oy, lookup);
  drawDecor(ctx, view);
  drawTrialKeystone(ctx, view);
  drawBanner(ctx, view);
  drawPrompt(ctx, view);
  drawRackStatus(ctx, view);
  drawDepartGauge(ctx, view);
}
