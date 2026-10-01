// 地図の見た目の確認用（docs/ideas/map-visual-impl.md 5-2 節）。ゲーム本体からは import しない。
// クエリ: ?depth=&kind=&seed=&tx=&ty=&layout= で階を作って 1 回描き、window.__mapShotReady = true。
// kind=hub で拠点（scene=new は空の保存の門前町、scene=full は全部建った門前町。無ければ旧来の拠点）。?bench=1 は 300 フレーム横へ流して地図の描画と焼きの平均 ms を window.__mapBench に出す。
// 実時間（performance.now）を使うのは計測だけで、ゲームの描画・state には入れない。
import { createGame } from "../core/game";
import { VIEW_H, VIEW_W } from "../core/view";
import type { FloorKind, GameState } from "../core/state";
import { SHEETS, TILE_SPRITES } from "../data/tiles";
import { createEmptyProfile } from "../loot/types";
import { type HubSpotKey } from "../map/hubMap";
import { FACILITY_KEYS, type HubProgressSource, availableSpots, builtFacilities } from "../meta/hub";
import { createAchievementSave } from "../meta/achievements";
import { createCodexSave } from "../meta/codex";
import { createHubSave } from "../meta/hubStore";
import { type TownLook, townLook } from "../meta/townLook";
import { LAYOUT_KINDS, type FloorLayout } from "../map/layout/types";
import { withFixedLayout } from "../map/layout/select";
import { createDefaultSkillProfile } from "../skills/persistence";
import { buildFloor } from "../system/floor";
import { createHub } from "../system/hub";
import { defaultRunSetup } from "../system/runSetup";
import { loadImageAtlas } from "../render/imageAtlas";
import { Renderer } from "../render/renderer";
import type { HubSpotsView } from "../render/hubUi";
import { type TownHubView, TownLayer, canvasFromTownPixels } from "../render/townScene";

interface MapBench {
  frames: number;
  /** 地図（床・壁・穴 + 上描き）の描画の平均 ms */
  mapMsAvg: number;
  /** 焼いていないフレームの平均 ms */
  mapMsNoBake: number;
  /** 焼いたフレームの平均 ms（焼きの代金を含む） */
  mapMsBake: number;
  bakeFrames: number;
  bakedRows: number;
  /** render() 全体の平均 ms */
  renderMsAvg: number;
}

interface TownOpenCost {
  /** TownLayer の最初の prepare（道の石畳の焼き + 物の絵の最初の 1 フレーム分）の ms */
  prepareMs: number;
  /** 物の絵がすべて出来るまでの prepare の合計 ms（フレームに分けない場合の 1 回分） */
  allMs: number;
  /** 物の絵が出来るまでに掛かったフレーム数 */
  frames: number;
  /** 160x160 ドットの絵 25 枚 + 288x160 を canvas にする ms（C2 の絵が入った後の見積り） */
  syntheticArtMs: number;
}

declare global {
  interface Window {
    __mapShotReady?: boolean;
    __mapBench?: MapBench;
    /** 拠点を開いた直後の canvas 作成の ms（?scene=new|full のとき） */
    __townOpen?: TownOpenCost;
    __mapShotError?: string;
  }
}

const BENCH_FRAMES = 300;
/** ベンチで横へ流す速さ（px / フレーム。歩きとダッシュの間） */
const BENCH_SPEED = 4;
const TILE = 16;
/** 時間の経過で階の名札が消えるように進める秒数 */
const SETTLE_TIME = 10;
/** プレイヤーの絵の読み込みを待つ回数と間隔（合わせて最大 5 秒） */
const ART_WAIT_TRIES = 50;
const ART_WAIT_MS = 100;

function intParam(q: URLSearchParams, key: string, fallback: number): number {
  const v = q.get(key);
  if (v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function layoutParam(q: URLSearchParams): FloorLayout | null {
  const v = q.get("layout");
  if (!v) return null;
  const all: readonly FloorLayout[] = [...LAYOUT_KINDS, "legacy", "lordHall"];
  return all.find((k) => k === v) ?? null;
}

function kindParam(q: URLSearchParams): FloorKind | undefined {
  const v = q.get("kind");
  if (!v || v === "hub") return undefined;
  // 未知の値は開発者の打ち間違いなので検査せず通す（buildFloor 側の表に無ければ描画で既定に落ちる）
  return v as FloorKind;
}

function placeCamera(state: GameState, q: URLSearchParams): void {
  const tx = q.get("tx");
  const ty = q.get("ty");
  if (tx === null || ty === null) return;
  const pos = { x: (Number(tx) + 0.5) * TILE, y: (Number(ty) + 0.5) * TILE };
  state.player.body.pos = { ...pos };
  state.camera.pos = { ...pos };
  state.camera.offset = { x: 0, y: 0 };
}

function buildRun(q: URLSearchParams): GameState {
  const depth = intParam(q, "depth", 3);
  const seed = intParam(q, "seed", 1);
  const state = createGame(seed, String(seed), createEmptyProfile(), createDefaultSkillProfile(), { ...defaultRunSetup(), startDepth: depth });
  const layout = layoutParam(q);
  const kind = kindParam(q);
  if (layout) withFixedLayout(layout, () => buildFloor(state, kind));
  else buildFloor(state, kind);
  state.flash = 0;
  placeCamera(state, q);
  return state;
}

/** 空の保存（図鑑・実績・スキル石なし、1 回も出撃していない）の景色の材料 */
const NEW_TOWN_SOURCE: HubProgressSource = { runs: 0, codex: createCodexSave(), stoneCount: 0, hasBud: false, achievements: createAchievementSave() };
/** 全部建ち、灯籠・井戸・幟・碑・賑わいが最大の景色（手で組む。townLook の段の数値と独立に最大の見え方を撮る） */
const FULL_TOWN_LOOK: TownLook = {
  key: "shot-full",
  built: new Set(FACILITY_KEYS),
  lanterns: 8,
  wellTier: 3,
  trophies: [1, 2, 3, 4, 1, 2],
  hallLit: true,
  archiveLights: 5,
  stele: 4,
  deepestChapter: 4,
  bustle: 4,
  title: "拠点の主",
};

/** 場面に応じた門前町の景色。new は townLook の導出（建っている設備は builtFacilities から） */
function townLookFor(scene: string): TownLook {
  if (scene === "full") return FULL_TOWN_LOOK;
  const built = builtFacilities(NEW_TOWN_SOURCE);
  return { ...townLook(NEW_TOWN_SOURCE, createHubSave()), built: new Set(built) };
}

/** 拠点を開いた直後の canvas 作成を、新しい TownLayer で測る（実時間は計測だけで、描画・state には入れない） */
function measureTownOpen(view: TownHubView): TownOpenCost {
  const layer = new TownLayer();
  const t0 = performance.now();
  layer.prepare(view);
  const prepareMs = performance.now() - t0;
  let frames = 1;
  while (layer.pendingCount > 0 && frames < 100) {
    layer.prepare(view);
    frames++;
  }
  const allMs = performance.now() - t0;
  const s0 = performance.now();
  const sized = [...Array.from({ length: 25 }, () => [160, 160] as const), [288, 160] as const];
  for (const [w, h] of sized) canvasFromTownPixels(new Uint32Array(w * h).fill(0xff3030c0), w, h);
  return { prepareMs, allMs, frames, syntheticArtMs: performance.now() - s0 };
}

function buildHub(renderer: Renderer, q: URLSearchParams): GameState {
  const scene = q.get("scene");
  const built = scene === "new" ? builtFacilities(NEW_TOWN_SOURCE) : FACILITY_KEYS;
  const available = availableSpots(built);
  const session = createHub(createEmptyProfile(), createDefaultSkillProfile(), available);
  const near = (q.get("near") as HubSpotKey | null) ?? null;
  const view: HubSpotsView = { spots: session.hub.layout.spots, available, near };
  if (scene === "new" || scene === "full") {
    view.town = { layout: session.hub.layout, look: townLookFor(scene) };
    window.__townOpen = measureTownOpen({ ...view, town: view.town });
  }
  renderer.setHubView(view);
  placeCamera(session.state, q);
  return session.state;
}

/** 地図の描画だけを 1 フレーム分描く（Renderer の private を添字で呼ぶ。計測専用） */
function drawMapOnly(renderer: Renderer, state: GameState): void {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  const ctx = renderer.context;
  ctx.save();
  ctx.translate(ox, oy);
  renderer["drawTiles"](state, -ox, -oy);
  // 上描きは段 1 で drawTiles から分かれた。変更前の描画には無い（drawTiles の中に含まれる）
  if (typeof renderer["drawTileOverlays"] === "function") renderer["drawTileOverlays"](state, -ox, -oy);
  ctx.restore();
}

function bakedRowsOf(renderer: Renderer): number {
  const chunks = renderer["mapChunks"] as { lastBakedRows?: number } | undefined;
  return chunks?.lastBakedRows ?? 0;
}

function runBench(renderer: Renderer, state: GameState): MapBench {
  const maxX = state.map.width * TILE - VIEW_W / 2;
  const minX = VIEW_W / 2;
  let dir = 1;
  let sumAll = 0;
  let sumNo = 0;
  let sumBake = 0;
  let nNo = 0;
  let nBake = 0;
  let rows = 0;
  let renderSum = 0;
  for (let f = 0; f < BENCH_FRAMES; f++) {
    const next = state.camera.pos.x + dir * BENCH_SPEED;
    if (next > maxX || next < minX) dir = -dir;
    state.camera.pos.x += dir * BENCH_SPEED;
    renderer.beginFrame();
    const t0 = performance.now();
    drawMapOnly(renderer, state);
    const ms = performance.now() - t0;
    const baked = bakedRowsOf(renderer);
    rows += baked;
    sumAll += ms;
    if (baked > 0) {
      sumBake += ms;
      nBake++;
    } else {
      sumNo += ms;
      nNo++;
    }
    const r0 = performance.now();
    renderer.render(state, null, false);
    renderSum += performance.now() - r0;
  }
  return {
    frames: BENCH_FRAMES,
    mapMsAvg: sumAll / BENCH_FRAMES,
    mapMsNoBake: nNo > 0 ? sumNo / nNo : 0,
    mapMsBake: nBake > 0 ? sumBake / nBake : 0,
    bakeFrames: nBake,
    bakedRows: rows,
    renderMsAvg: renderSum / BENCH_FRAMES,
  };
}

/** プレイヤーの高精細の絵は非同期で読むので、読めるまで待つ（読めないまま撮ると 24x24 の旧い体で写る） */
async function waitPlayerArt(renderer: Renderer, state: GameState): Promise<void> {
  for (let i = 0; i < ART_WAIT_TRIES; i++) {
    if (renderer.playerArtReady(state)) return;
    await new Promise((resolve) => setTimeout(resolve, ART_WAIT_MS));
  }
}

async function main(): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas#game がない");
  const renderer = new Renderer(canvas);
  try {
    await document.fonts.load('16px "DotGothic16"');
  } catch {
    // フォントが無くても地図は撮れる
  }
  const atlas = await loadImageAtlas(TILE_SPRITES, SHEETS);
  renderer.setAtlas(atlas);

  const state = q.get("kind") === "hub" ? buildHub(renderer, q) : buildRun(q);
  // 1 回目で描画側の追跡（階の名札の時刻・部屋の表）を初期化し、時間を進めてから撮る
  renderer.render(state, null, false);
  await waitPlayerArt(renderer, state);
  state.time += SETTLE_TIME;
  if (typeof renderer.settleMap === "function") renderer.settleMap(state);
  renderer.render(state, null, false);

  if (q.get("bench") === "1") window.__mapBench = runBench(renderer, state);
  window.__mapShotReady = true;
}

main().catch((e: unknown) => {
  window.__mapShotError = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  window.__mapShotReady = true;
});
