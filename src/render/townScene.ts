/**
 * 拠点（門前町）の物の描画（docs/ideas/hub-town-impl.md 4 章）。
 * 床・崖・塀は迷宮のチャンク焼き付け（様式 town）に任せ、ここは参道の石畳・建物・井戸・灯籠・鳥居・幟・小物・提灯の発光・名札を描く。
 * state と拠点の景色（TownLook）を読むだけで、state.rng は使わない。ばらつきは座標ハッシュ、揺らぎは state.time。
 * 絵は拠点を開いた時（TownLook.key が変わった時）に canvas へ作り、毎フレームは足元の y で前後 2 段に分けて drawImage する。
 */
import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import type { Vec } from "../core/vec";
import { TILE_SIZE, type Rect } from "../map/grid";
import { HUB_LOT_KEYS, type HubLayout, type HubLotKey, type HubSpotKey } from "../map/hubMap";
import { FACILITY_NAME, FACILITY_OF_LOT } from "../meta/hub";
import type { TownLook } from "../meta/townLook";
import { STYLE_DEFS } from "../data/mapThemes";
import type { HubSpotsView } from "./hubUi";
import { COLOR_DIM, COLOR_SELECTED, COLOR_TEXT } from "./lootUiParts";
import { floorTex, createTexContext } from "./mapTextures";
import { hf } from "./mapNoise";
import { hexColor, mixColor, townRoadTheme } from "./mapTheme";
import { MAP_DOTS, TILE_DOTS } from "./mapTypes";
import { TEXT, drawTextShadow } from "./pixelText";
import { type TownGlowKind, type TownObjectKind, type TownPixels, townObjectGlows, townObjectPixels } from "./townArt";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 1 ドットの論理 px */
const DOT_PX = 1 / MAP_DOTS;
const HALF_PX = 0.5;
const SHADOW = "#000000";

/** 敷地に属する台（名札を掛ける位置の元）。稽古場は台なし */
const LOT_SPOTS: Readonly<Record<HubLotKey, readonly HubSpotKey[]>> = {
  shrine: ["altar"],
  hall: ["hall"],
  forge: ["forge"],
  library: ["library"],
  well: ["well"],
  board: ["board"],
  archive: ["history", "codex", "achievements"],
  garden: ["garden"],
  rackShed: ["rack"],
  yard: [],
};

/** 記録の蔵の 3 つの扉の小札（台の名前。設備名では区別できない） */
const ARCHIVE_DOOR_LABEL: Readonly<Partial<Record<HubSpotKey, string>>> = {
  history: "探索履歴",
  codex: "図鑑",
  achievements: "実績",
};

const PLANNED_SUFFIX = "（建設予定）";

/** 名札の位置: 敷地の下辺からの上げ幅（論理 px）。扉の上に乗る */
const LABEL_LIFT = 4;
/** 敷地に台がない稽古場の名札は敷地の上辺から下げる */
const LABEL_YARD_DROP = 10;
/** 稽古場の中の台（稽古の間の入口）の小札。稽古場が建っていれば台の上に掛ける */
const DOJO_LABEL = "稽古の間";
/** 稽古の間の小札の、台の中心からの上げ幅（論理 px） */
const DOJO_LABEL_LIFT = 10;

/** 地面に張り付く物（体に隠れない）。稽古場は柵と砂の円で、中を歩ける */
const FLAT_LOTS: ReadonlySet<HubLotKey> = new Set<HubLotKey>(["yard"]);

/** 踏破の碑の置き場所: 鳥居の矩形の左隣 1 マス・鳥居の足元の行 */
const STELE_SHIFT_TILES = 1;
/** 幟の間隔（論理 px）。御堂の前に中央から左右へ並べる */
const TROPHY_SPACING = 18;

/** 仮の箱の大きさ（論理 px。絵が 1 ドットのうちだけ使う） */
const PLACEHOLDER_SIZE: Readonly<Record<"lantern" | "trophy" | "stele" | "clutter", { w: number; h: number }>> = {
  lantern: { w: 8, h: 14 },
  trophy: { w: 5, h: 20 },
  stele: { w: 10, h: 16 },
  clutter: { w: 10, h: 8 },
};
/** 仮の箱の色 */
const PLACEHOLDER_COLORS = {
  lotBuilt: "#7a5a46",
  lotPlanned: "#4a4038",
  well: "#5a6a78",
  torii: "#c0382e",
  lantern: "#d8b070",
  stele: "#8a8a96",
  clutter: "#8a6a48",
  /** 幟の色（章 1〜4。タイトルの章の色と揃える） */
  trophy: ["#c8e878", "#ffb45a", "#ff7a2a", "#b27cff"],
  edge: "#1a1418",
} as const;
const PLACEHOLDER_ALPHA = 0.85;

/** 灯の発光 */
const GLOW_DOTS = 48;
const GLOW_COLOR = STYLE_DEFS.town.colors.light;
/** 発光の段（光の層と同じく段つき。アルファの比） */
const GLOW_STEPS = [
  { min: 0.6, level: 1 },
  { min: 0.35, level: 0.7 },
  { min: 0.17, level: 0.42 },
  { min: 0.05, level: 0.2 },
] as const;
const GLOW_FLICKER_SPEED = 5;
const GLOW_FLICKER_AMOUNT = 0.18;
const GLOW_SEED = 0x7a31;
const TWO_PI = Math.PI * 2;
const BYTE_MAX = 255;
/**
 * 灯の種類ごとの発光（半径 px・強さ）。強さは globalAlpha。位置は絵が返す灯の点（townArt の townObjectGlows）。
 * 宵の暗さの中で灯を読ませるだけの強さに抑える（強いと建物の絵と名札が白く飛ぶ）
 */
const GLOW_BY_KIND: Readonly<Record<TownGlowKind, { r: number; strength: number }>> = {
  lantern: { r: 12, strength: 0.5 },
  window: { r: 9, strength: 0.4 },
  fire: { r: 16, strength: 0.55 },
  gate: { r: 40, strength: 0.5 },
};
const GLOW_BRAZIER = { r: 14, strength: 0.55 };
/** 篝火は御堂の左右の外 */
const BRAZIER_OUTSET = 6;
/** 石段の奥の灯の色（章 1〜4。titleUi の CHAPTER_TINTS と同じ。共有化は統合役） */
const GATE_TINTS: readonly string[] = ["#c8e878", "#ffb45a", "#ff7a2a", "#b27cff"];

/** 道の 1 区間の最大幅（マス） */
const ROAD_BAND_TILES = 8;
/** 1 フレームに焼く道のドット数（実測でおよそ 3ms。参道と辻の全体 約 12 万ドットを 4 フレームほどに分ける） */
export const ROAD_DOTS_PER_FRAME = 32768;
/** 1 フレームに作る絵の canvas の数の上限（開いた直後に固まらないよう分ける）。道は別枠で最初に作る */
export const TOWN_ART_PER_FRAME = 8;

/** 参道の石畳の縁の暗さ */
const ROAD_EDGE_DARKEN = 0.45;

/** 名札の色 */
const LABEL_NEAR_COLOR = COLOR_SELECTED;
const LABEL_BUILT_COLOR = COLOR_TEXT;
const LABEL_PLANNED_COLOR = COLOR_DIM;

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** 門前町の配置と景色が付いた拠点の表示値（拠点は常にこれで描く） */
export type TownHubView = HubSpotsView;

/** 絵の canvas を作る入り口。テストでは差し替える */
export type TownImageFactory = (pixels: Uint32Array, w: number, h: number) => CanvasImageSource;

/** 描く物 1 つ。足元の点（px）が置き場所の基準 */
export interface TownPlacement {
  /** 安定した識別（並び順の同点の決着にも使う） */
  id: string;
  /** 絵の鍵（同じ絵は 1 つの canvas を共有する） */
  art: string;
  kind: TownObjectKind;
  footX: number;
  footY: number;
  /** 地面の物は体より常に奥 */
  flat: boolean;
  /** 仮の箱（論理 px）。絵が 1 ドットのうちだけ描く */
  box: Rect;
  boxColor: string;
}

/** 名札 1 枚 */
export interface TownLabel {
  text: string;
  x: number;
  y: number;
  /** 台が無い（稽古場）は null */
  spot: HubSpotKey | null;
  built: boolean;
}

/** 提灯などの発光 1 つ */
export interface TownGlow {
  x: number;
  y: number;
  r: number;
  strength: number;
  color: string;
  /** 揺らぎの位相（座標ハッシュ） */
  phase: number;
}

// ---------------------------------------------------------------------------
// 配置（純関数）
// ---------------------------------------------------------------------------

function hasArea(r: Rect): boolean {
  return r.w > 0 && r.h > 0;
}

function rectPx(r: Rect): Rect {
  return { x: r.x * TILE_SIZE, y: r.y * TILE_SIZE, w: r.w * TILE_SIZE, h: r.h * TILE_SIZE };
}

/** 足元の点から、下辺中央を足元とする箱 */
function boxAt(footX: number, footY: number, w: number, h: number): Rect {
  return { x: footX - w / 2, y: footY - h, w, h };
}

/** 絵の鍵。同じ見た目の物は同じ鍵 */
export function townArtKey(kind: TownObjectKind): string {
  switch (kind.type) {
    case "lot":
      return `lot:${kind.lot}:${kind.built ? 1 : 0}`;
    case "well":
      return `well:${kind.tier}`;
    case "trophy":
      return `trophy:${kind.chapter}`;
    case "stele":
      return `stele:${kind.tier}`;
    case "clutter":
      return `clutter:${kind.index}`;
    case "torii":
    case "toriiSteps":
    case "lantern":
      return kind.type;
  }
}

function lotPlacement(lot: HubLotKey, rect: Rect, look: TownLook): TownPlacement {
  const px = rectPx(rect);
  const footX = px.x + px.w / 2;
  const footY = px.y + px.h;
  if (lot === "well") {
    const kind: TownObjectKind = { type: "well", tier: look.wellTier };
    return { id: "lot:well", art: townArtKey(kind), kind, footX, footY, flat: false, box: px, boxColor: PLACEHOLDER_COLORS.well };
  }
  const built = look.built.has(FACILITY_OF_LOT[lot]);
  const kind: TownObjectKind = { type: "lot", lot, built };
  return {
    id: `lot:${lot}`,
    art: townArtKey(kind),
    kind,
    footX,
    footY,
    flat: FLAT_LOTS.has(lot),
    box: px,
    boxColor: built ? PLACEHOLDER_COLORS.lotBuilt : PLACEHOLDER_COLORS.lotPlanned,
  };
}

function smallPlacement(id: string, kind: TownObjectKind, at: Vec, size: { w: number; h: number }, color: string): TownPlacement {
  return { id, art: townArtKey(kind), kind, footX: at.x, footY: at.y, flat: false, box: boxAt(at.x, at.y, size.w, size.h), boxColor: color };
}

/** 幟の足元の点。御堂の前（下辺）に中央から左右へ並べる */
export function trophyPositions(hall: Rect, count: number): Vec[] {
  const px = rectPx(hall);
  const cx = px.x + px.w / 2;
  const y = px.y + px.h;
  const out: Vec[] = [];
  for (let i = 0; i < count; i++) out.push({ x: cx + (i - (count - 1) / 2) * TROPHY_SPACING, y });
  return out;
}

/** 踏破の碑の足元の点（鳥居の左隣・鳥居の足元の行） */
export function stelePosition(gate: Rect): Vec {
  const px = rectPx(gate);
  return { x: px.x - STELE_SHIFT_TILES * TILE_SIZE + TILE_SIZE / 2, y: px.y + px.h };
}

/** 景色の材料から、描く物を足元の y の昇順（同じ y は地面の物が先）に並べる。同じ入力なら同じ並び */
export function buildTownPlacements(layout: HubLayout, look: TownLook): TownPlacement[] {
  const out: TownPlacement[] = [];
  for (const lot of HUB_LOT_KEYS) {
    const rect = layout.lots[lot];
    if (hasArea(rect)) out.push(lotPlacement(lot, rect, look));
  }
  if (hasArea(layout.gate)) {
    const px = rectPx(layout.gate);
    const footX = px.x + px.w / 2;
    const footY = px.y + px.h;
    // 石段は地面の物（flat）として常に体より奥。柱と笠木だけが足元の y で前後する
    const steps: TownObjectKind = { type: "toriiSteps" };
    out.push({ id: "toriiSteps", art: townArtKey(steps), kind: steps, footX, footY, flat: true, box: px, boxColor: PLACEHOLDER_COLORS.torii });
    const kind: TownObjectKind = { type: "torii" };
    out.push({ id: "torii", art: townArtKey(kind), kind, footX, footY, flat: false, box: px, boxColor: PLACEHOLDER_COLORS.torii });
    if (look.stele > 0) {
      const at = stelePosition(layout.gate);
      const steleKind: TownObjectKind = { type: "stele", tier: look.stele };
      out.push(smallPlacement("stele", steleKind, at, PLACEHOLDER_SIZE.stele, PLACEHOLDER_COLORS.stele));
    }
  }
  const lanterns = Math.min(look.lanterns, layout.lanternSlots.length);
  for (let i = 0; i < lanterns; i++) {
    const at = layout.lanternSlots[i];
    if (at) out.push(smallPlacement(`lantern:${i}`, { type: "lantern" }, at, PLACEHOLDER_SIZE.lantern, PLACEHOLDER_COLORS.lantern));
  }
  if (hasArea(layout.lots.hall)) {
    const spots = trophyPositions(layout.lots.hall, look.trophies.length);
    look.trophies.forEach((chapter, i) => {
      const at = spots[i];
      if (!at) return;
      const color = PLACEHOLDER_COLORS.trophy[Math.max(0, chapter - 1) % PLACEHOLDER_COLORS.trophy.length] ?? PLACEHOLDER_COLORS.edge;
      out.push(smallPlacement(`trophy:${i}`, { type: "trophy", chapter: chapter }, at, PLACEHOLDER_SIZE.trophy, color));
    });
  }
  const clutter = Math.min(look.bustle, layout.clutterSlots.length);
  for (let i = 0; i < clutter; i++) {
    const at = layout.clutterSlots[i];
    if (at) out.push(smallPlacement(`clutter:${i}`, { type: "clutter", index: i }, at, PLACEHOLDER_SIZE.clutter, PLACEHOLDER_COLORS.clutter));
  }
  // 足元の y が同じなら地面の物（flat）を先に描く（鳥居の石段の上に柱を重ねる）
  return out.sort((a, b) => a.footY - b.footY || Number(b.flat) - Number(a.flat) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 体より奥（先に描く）か。足元の y がプレイヤーの足元以下なら奥 = プレイヤーが手前を歩く。地面の物は常に奥。
 * 同じ y は奥に倒す（体が物の上に乗る）
 */
export function isBehindPlayer(p: Pick<TownPlacement, "footY" | "flat">, playerFeetY: number): boolean {
  return p.flat || p.footY <= playerFeetY;
}

// ---------------------------------------------------------------------------
// 名札と発光（純関数）
// ---------------------------------------------------------------------------

/** 名札を全設備ぶん作る。建っていれば設備名、未建設は「（建設予定）」付き。記録の蔵は建っていれば扉ごとの小札 */
export function buildTownLabels(layout: HubLayout, look: TownLook): TownLabel[] {
  const out: TownLabel[] = [];
  for (const lot of HUB_LOT_KEYS) {
    const rect = layout.lots[lot];
    if (!hasArea(rect)) continue;
    const px = rectPx(rect);
    const facility = FACILITY_OF_LOT[lot];
    const built = look.built.has(facility) || facility === "well";
    const spots = LOT_SPOTS[lot];
    const y = spots.length === 0 ? px.y + LABEL_YARD_DROP : px.y + px.h - LABEL_LIFT;
    const centerX = px.x + px.w / 2;
    if (built && lot === "archive") {
      for (const spot of spots) {
        const at = layout.spots[spot];
        out.push({ text: ARCHIVE_DOOR_LABEL[spot] ?? FACILITY_NAME[facility], x: at.x, y, spot, built });
      }
      continue;
    }
    // 台が複数ある建物（未建設の記録の蔵）は 1 枚の名札を敷地の中央に掛ける
    const first = spots.length === 1 ? spots[0] : undefined;
    const x = first ? layout.spots[first].x : centerX;
    const name = FACILITY_NAME[facility];
    out.push({ text: built ? name : `${name}${PLANNED_SUFFIX}`, x, y, spot: first ?? null, built });
  }
  if (look.built.has(FACILITY_OF_LOT.yard)) {
    const at = layout.spots.dojo;
    out.push({ text: DOJO_LABEL, x: at.x, y: at.y - DOJO_LABEL_LIFT, spot: "dojo", built: true });
  }
  return out;
}

function glowAt(x: number, y: number, size: { r: number; strength: number }, color: string): TownGlow {
  return { x, y, r: size.r, strength: size.strength, color, phase: hf(Math.round(x), Math.round(y), GLOW_SEED) * TWO_PI };
}

/** 灯を出す物か。建っていない敷地・幟・碑・小物は光らない（絵が灯の点を返さない物も含めて弾く） */
function glowsFor(p: TownPlacement): boolean {
  if (p.kind.type === "lot") return p.kind.built;
  return p.kind.type === "toriiSteps" || p.kind.type === "lantern";
}

/**
 * 発光する点。物の絵が返す灯の点（提灯・窓・火床・石段の奥）を置き場所へ写す。記録の蔵の窓は左から archiveLights 個だけ灯す。
 * 石段の奥の灯は最深の章の色。御堂の篝火は絵に無いので左右の外に足す
 */
export function buildTownGlows(layout: HubLayout, look: TownLook): TownGlow[] {
  const out: TownGlow[] = [];
  for (const p of buildTownPlacements(layout, look)) {
    if (!glowsFor(p)) continue;
    const anchor = townObjectPixels(p.kind).anchor;
    const isArchive = p.kind.type === "lot" && p.kind.lot === "archive";
    let windows = 0;
    const points = [...townObjectGlows(p.kind)].sort((g1, g2) => g1.x - g2.x);
    for (const g of points) {
      if (isArchive && g.kind === "window" && windows++ >= look.archiveLights) continue;
      const x = p.footX + (g.x - anchor.x) * DOT_PX;
      const y = p.footY + (g.y - anchor.y) * DOT_PX;
      const color = g.kind === "gate" ? (GATE_TINTS[Math.max(0, Math.min(GATE_TINTS.length - 1, look.deepestChapter - 1))] ?? GLOW_COLOR) : GLOW_COLOR;
      out.push(glowAt(x, y, GLOW_BY_KIND[g.kind], color));
    }
  }
  if (look.hallLit && hasArea(layout.lots.hall)) {
    const px = rectPx(layout.lots.hall);
    out.push(glowAt(px.x - BRAZIER_OUTSET, px.y + px.h, GLOW_BRAZIER, GLOW_COLOR));
    out.push(glowAt(px.x + px.w + BRAZIER_OUTSET, px.y + px.h, GLOW_BRAZIER, GLOW_COLOR));
  }
  return out;
}

/** 発光の強さの揺らぎ（0 以上 1 以下）。state.time と点ごとの位相だけで決まる */
export function glowFlicker(time: number, phase: number): number {
  return 1 - GLOW_FLICKER_AMOUNT * (0.5 + 0.5 * Math.sin(time * GLOW_FLICKER_SPEED + phase));
}

/** 発光の絵（中心ほど濃い段つきの円）。色ごとに 1 枚作る */
export function glowPixels(color: string, dots: number = GLOW_DOTS): Uint32Array {
  const c = hexColor(color);
  const rgb = c & 0x00ffffff;
  const out = new Uint32Array(dots * dots);
  const half = dots / 2;
  for (let y = 0; y < dots; y++) {
    for (let x = 0; x < dots; x++) {
      const d = Math.hypot(x + HALF_PX - half, y + HALF_PX - half) / half;
      const level = glowLevel(d);
      if (level === 0) continue;
      const alpha = Math.round(BYTE_MAX * level);
      out[y * dots + x] = ((alpha << 24) | rgb) >>> 0;
    }
  }
  return out;
}

/** 距離（0 中心〜1 縁）から発光の段の濃さ。縁の外は 0 */
export function glowLevel(d: number): number {
  if (d >= 1) return 0;
  const falloff = (1 - d) * (1 - d);
  for (const step of GLOW_STEPS) if (falloff >= step.min) return step.level;
  return 0;
}

// ---------------------------------------------------------------------------
// 参道の石畳（純関数）
// ---------------------------------------------------------------------------

/** 焼いた道の画素。x / y は世界のドット座標、w / h はドット */
export interface RoadPixels {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint32Array;
}

function roadMaskOf(roads: readonly Rect[], mapW: number, mapH: number): Uint8Array {
  const mask = new Uint8Array(mapW * mapH);
  for (const r of roads) {
    for (let ty = Math.max(0, r.y); ty < Math.min(mapH, r.y + r.h); ty++) {
      for (let tx = Math.max(0, r.x); tx < Math.min(mapW, r.x + r.w); tx++) mask[ty * mapW + tx] = 1;
    }
  }
  return mask;
}

/** 道を焼く 1 単位 = 石畳の矩形の 1 マス行のうち幅 ROAD_BAND_TILES マス以内の区間（ドット座標） */
interface RoadBand {
  x: number;
  y: number;
  w: number;
}

/** 行（バンド）を刻んで焼く道の焼き付け。刻み方に依らず結果は同じ */
export interface RoadBake {
  readonly done: boolean;
  /** 予算（ドット数）を使い切るまで焼く。少なくとも 1 区間は進める */
  step(budgetDots: number): void;
  /** 焼き上がってから呼ぶ。石畳が無ければ null */
  result(): RoadPixels | null;
}

/**
 * 参道・辻の石畳の焼き付け。1 マス行ごとに模様の文脈を作る（床の模様は位置だけで決まるので、継ぎ目も一致する）。
 * 縁（石畳の外に接するドット）は暗い輪郭にして土の道と区別する。拠点を開いた時に一度に焼くと 1 フレームを超えるので、step で刻む
 */
export function createRoadBake(roads: readonly Rect[], mapW: number, mapH: number): RoadBake {
  const valid = roads.filter(hasArea);
  if (valid.length === 0) return { done: true, step: () => {}, result: () => null };
  const tx0 = Math.min(...valid.map((r) => r.x));
  const ty0 = Math.min(...valid.map((r) => r.y));
  const x0 = tx0 * TILE_DOTS;
  const y0 = ty0 * TILE_DOTS;
  const w = (Math.max(...valid.map((r) => r.x + r.w)) - tx0) * TILE_DOTS;
  const h = (Math.max(...valid.map((r) => r.y + r.h)) - ty0) * TILE_DOTS;
  const pixels = new Uint32Array(w * h);
  const mask = roadMaskOf(roads, mapW, mapH);
  const theme = townRoadTheme();
  const edge = mixColor(theme.palette.fD, 0, ROAD_EDGE_DARKEN);
  const roadAt = (dx: number, dy: number): boolean => {
    if (dx < 0 || dy < 0) return false;
    const tx = Math.floor(dx / TILE_DOTS);
    const ty = Math.floor(dy / TILE_DOTS);
    return tx < mapW && ty < mapH && mask[ty * mapW + tx] === 1;
  };
  const bands: RoadBand[] = [];
  for (const r of valid) {
    for (let ty = r.y; ty < r.y + r.h; ty++) {
      for (let tx = r.x; tx < r.x + r.w; tx += ROAD_BAND_TILES) {
        bands.push({ x: tx * TILE_DOTS, y: ty * TILE_DOTS, w: Math.min(ROAD_BAND_TILES, r.x + r.w - tx) * TILE_DOTS });
      }
    }
  }
  let next = 0;
  const bakeBand = (band: RoadBand): void => {
    const tc = createTexContext(theme, band.x, band.y, band.w, TILE_DOTS);
    for (let dy = band.y; dy < band.y + TILE_DOTS; dy++) {
      for (let dx = band.x; dx < band.x + band.w; dx++) {
        const onEdge = !roadAt(dx - 1, dy) || !roadAt(dx + 1, dy) || !roadAt(dx, dy - 1) || !roadAt(dx, dy + 1);
        pixels[(dy - y0) * w + (dx - x0)] = onEdge ? edge : floorTex(tc, dx, dy);
      }
    }
  };
  return {
    get done() {
      return next >= bands.length;
    },
    step(budgetDots: number): void {
      let spent = 0;
      while (next < bands.length && spent < budgetDots) {
        const band = bands[next++];
        if (!band) continue;
        bakeBand(band);
        spent += band.w * TILE_DOTS;
      }
    },
    result: () => (next >= bands.length ? { x: x0, y: y0, w, h, pixels } : null),
  };
}

/** 道を一度に焼き上げる（テスト・撮影用） */
export function bakeRoadPixels(roads: readonly Rect[], mapW: number, mapH: number): RoadPixels | null {
  const job = createRoadBake(roads, mapW, mapH);
  job.step(Number.POSITIVE_INFINITY);
  return job.result();
}

// ---------------------------------------------------------------------------
// 描画（canvas を持つ層）
// ---------------------------------------------------------------------------

/** 既定の絵の作り方（ABGR の 32bit をそのまま ImageData のバイト列として写す） */
export function canvasFromTownPixels(pixels: Uint32Array, w: number, h: number): CanvasImageSource {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D context unavailable");
  const img = new ImageData(w, h);
  new Uint32Array(img.data.buffer).set(pixels);
  g.putImageData(img, 0, 0);
  return canvas;
}

/** 出来上がった絵。null は絵が 1 ドット（仮）で、仮の箱を描く */
interface TownArt {
  img: CanvasImageSource;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
}

function isStubArt(px: TownPixels): boolean {
  return px.w <= 1 && px.h <= 1;
}

/** 論理座標の画面（左上のワールド座標） */
interface ViewRect {
  x: number;
  y: number;
}

function viewOf(state: GameState): ViewRect {
  const cam = state.camera;
  return { x: Math.round(cam.pos.x - cam.offset.x - VIEW_W / 2), y: Math.round(cam.pos.y - cam.offset.y - VIEW_H / 2) };
}

/** 論理 px を 0.5px の格子（焼いた画素の大きさ）へ丸める */
function snapHalf(v: number): number {
  return Math.round(v * MAP_DOTS) / MAP_DOTS;
}

export class TownLayer {
  private layout: HubLayout | null = null;
  private lookKey = "";
  private placements: TownPlacement[] = [];
  private labels: TownLabel[] = [];
  private glows: TownGlow[] = [];
  private road: { img: CanvasImageSource; x: number; y: number; w: number; h: number } | null = null;
  private roadJob: RoadBake | null = null;
  private readonly arts = new Map<string, TownArt | null>();
  private pending: string[] = [];
  private readonly kinds = new Map<string, TownObjectKind>();
  private readonly glowImages = new Map<string, CanvasImageSource>();

  constructor(private readonly makeImage: TownImageFactory = canvasFromTownPixels) {}

  /** 作り終えていない物の絵と道の数（テスト用。0 で全部出来ている） */
  get pendingCount(): number {
    return this.pending.length + (this.roadJob ? 1 : 0);
  }

  /** 道の canvas を作ったか（テスト用） */
  get hasRoad(): boolean {
    return this.road !== null;
  }

  /**
   * 拠点を開いた時と TownLook.key が変わった時に作り直す。道は 1 フレームに ROAD_DOTS_PER_FRAME ドットずつ焼き、
   * 物の絵は 1 フレームに TOWN_ART_PER_FRAME 枚まで作る。全部出来たら true（それまで main.ts が画面を止めるので、道の無い町・仮の箱は見せない）。
   * 毎フレーム呼んでよい
   */
  prepare(view: TownHubView): boolean {
    this.sync(view);
    this.advance();
    return this.pendingCount === 0;
  }

  /**
   * 配置・景色が変わっていれば並びを作り直すだけ（焼き進めない）。1 フレームに描く口が 5 つあり、
   * それぞれで焼き進めると 1 フレームの予算が 5 倍になって開いた直後に固まるので、焼き進めるのは prepare（drawRoads）だけ
   */
  private sync(view: TownHubView): void {
    const { layout, look } = view.town;
    const changed = this.layout !== layout;
    if (changed) this.roadJob = createRoadBake(layout.roads, layout.ground.width, layout.ground.height);
    if (!changed && this.lookKey === look.key) return;
    this.layout = layout;
    this.lookKey = look.key;
    this.placements = buildTownPlacements(layout, look);
    this.labels = buildTownLabels(layout, look);
    this.glows = buildTownGlows(layout, look);
    this.arts.clear();
    this.kinds.clear();
    this.pending = [];
    for (const p of this.placements) {
      if (this.kinds.has(p.art)) continue;
      this.kinds.set(p.art, p.kind);
      this.pending.push(p.art);
    }
    if (changed) this.road = null;
  }

  /** 1 フレームぶんの作業: 道を焼き進め、物の絵を作る */
  private advance(): void {
    this.advanceRoad();
    this.buildPending(TOWN_ART_PER_FRAME);
  }

  private advanceRoad(): void {
    const job = this.roadJob;
    if (!job) return;
    job.step(ROAD_DOTS_PER_FRAME);
    if (!job.done) return;
    this.roadJob = null;
    const baked = job.result();
    if (!baked) return;
    this.road = { img: this.makeImage(baked.pixels, baked.w, baked.h), x: baked.x * DOT_PX, y: baked.y * DOT_PX, w: baked.w * DOT_PX, h: baked.h * DOT_PX };
  }

  private buildPending(limit: number): void {
    let n = 0;
    while (n < limit) {
      const key = this.pending.shift();
      if (key === undefined) return;
      const kind = this.kinds.get(key);
      if (!kind) continue;
      const px = townObjectPixels(kind);
      this.arts.set(
        key,
        isStubArt(px) ? null : { img: this.makeImage(px.pixels, px.w, px.h), w: px.w, h: px.h, anchorX: px.anchor.x, anchorY: px.anchor.y },
      );
      n++;
    }
  }

  /** 参道・辻の石畳。ground の直後に描く（1 フレームで最初に呼ばれる口なので、ここだけが焼き進める） */
  drawRoads(ctx: CanvasRenderingContext2D, view: TownHubView): void {
    this.prepare(view);
    const road = this.road;
    if (!road) return;
    ctx.drawImage(road.img, road.x, road.y, road.w, road.h);
  }

  /** 体より奥の物（足元の y がプレイヤーの足元以下。地面の物を含む）。world 層の drawTownBack の位置 */
  drawBack(ctx: CanvasRenderingContext2D, state: GameState, view: TownHubView): void {
    this.sync(view);
    this.drawPlacements(ctx, state, true);
  }

  /** 体より手前の物（足元の y がプレイヤーの足元より下）。drawPlayer の直後 */
  drawFront(ctx: CanvasRenderingContext2D, state: GameState, view: TownHubView): void {
    this.sync(view);
    this.drawPlacements(ctx, state, false);
  }

  private drawPlacements(ctx: CanvasRenderingContext2D, state: GameState, back: boolean): void {
    const p = state.player.body;
    const feetY = p.pos.y + p.radius;
    const v = viewOf(state);
    for (const place of this.placements) {
      if (isBehindPlayer(place, feetY) !== back) continue;
      const art = this.arts.get(place.art);
      if (art) this.drawArt(ctx, art, place, v);
      else this.drawBox(ctx, place, v);
    }
  }

  private drawArt(ctx: CanvasRenderingContext2D, art: TownArt, place: TownPlacement, v: ViewRect): void {
    const w = art.w * DOT_PX;
    const h = art.h * DOT_PX;
    const x = snapHalf(place.footX - art.anchorX * DOT_PX);
    const y = snapHalf(place.footY - art.anchorY * DOT_PX);
    if (x > v.x + VIEW_W || x + w < v.x || y > v.y + VIEW_H || y + h < v.y) return;
    ctx.drawImage(art.img, x, y, w, h);
  }

  private drawBox(ctx: CanvasRenderingContext2D, place: TownPlacement, v: ViewRect): void {
    const b = place.box;
    if (b.x > v.x + VIEW_W || b.x + b.w < v.x || b.y > v.y + VIEW_H || b.y + b.h < v.y) return;
    ctx.globalAlpha = PLACEHOLDER_ALPHA;
    ctx.fillStyle = place.boxColor;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = PLACEHOLDER_COLORS.edge;
    ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
    ctx.globalAlpha = 1;
  }

  /** 使える建物の提灯・灯籠・篝火・石段の奥の発光。加算合成で、体や弾の上に重ねて夜の灯りに見せる */
  drawGlow(ctx: CanvasRenderingContext2D, state: GameState, view: TownHubView): void {
    this.sync(view);
    const v = viewOf(state);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const g of this.glows) {
      if (g.x + g.r < v.x || g.x - g.r > v.x + VIEW_W || g.y + g.r < v.y || g.y - g.r > v.y + VIEW_H) continue;
      ctx.globalAlpha = g.strength * glowFlicker(state.time, g.phase);
      ctx.drawImage(this.glowImage(g.color), snapHalf(g.x - g.r), snapHalf(g.y - g.r), g.r * 2, g.r * 2);
    }
    ctx.restore();
  }

  private glowImage(color: string): CanvasImageSource {
    const cached = this.glowImages.get(color);
    if (cached) return cached;
    const img = this.makeImage(glowPixels(color), GLOW_DOTS, GLOW_DOTS);
    this.glowImages.set(color, img);
    return img;
  }

  /** 名札。全設備を常に出す（建っていれば明るく、未建設は薄く「（建設予定）」、近い台は選択色）。最後に描く */
  drawLabels(ctx: CanvasRenderingContext2D, view: TownHubView): void {
    this.sync(view);
    for (const label of this.labels) {
      const near = label.spot !== null && view.near !== null && label.spot === view.near;
      const color = !label.built ? LABEL_PLANNED_COLOR : near ? LABEL_NEAR_COLOR : LABEL_BUILT_COLOR;
      drawTextShadow(ctx, label.text, Math.round(label.x), Math.round(label.y), TEXT.SMALL, color, SHADOW, "center");
    }
  }
}
