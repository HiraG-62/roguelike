// 地図の見た目の確認用（docs/ideas/map-visual-impl.md 5-2 節）。ゲーム本体からは import しない。
// クエリ: ?depth=&kind=&seed=&tx=&ty=&layout= で階を作って 1 回描き、window.__mapShotReady = true。
// kind=hub で拠点。?bench=1 は 300 フレーム横へ流して地図の描画と焼きの平均 ms を window.__mapBench に出す。
// 実時間（performance.now）を使うのは計測だけで、ゲームの描画・state には入れない。
import { createGame } from "../core/game";
import { VIEW_H, VIEW_W } from "../core/view";
import type { FloorKind, GameState } from "../core/state";
import { SHEETS, TILE_SPRITES } from "../data/tiles";
import { createEmptyProfile } from "../loot/types";
import { HUB_SPOT_KEYS, type HubSpotKey } from "../map/hubMap";
import { LAYOUT_KINDS, type FloorLayout } from "../map/layout/types";
import { withFixedLayout } from "../map/layout/select";
import { createDefaultSkillProfile } from "../skills/persistence";
import { buildFloor } from "../system/floor";
import { createHub } from "../system/hub";
import { defaultRunSetup } from "../system/runSetup";
import { loadImageAtlas } from "../render/imageAtlas";
import { Renderer } from "../render/renderer";
import type { HubSpotsView } from "../render/hubUi";

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

declare global {
  interface Window {
    __mapShotReady?: boolean;
    __mapBench?: MapBench;
    __mapShotError?: string;
  }
}

const BENCH_FRAMES = 300;
/** ベンチで横へ流す速さ（px / フレーム。歩きとダッシュの間） */
const BENCH_SPEED = 4;
const TILE = 16;
/** 時間の経過で階の名札が消えるように進める秒数 */
const SETTLE_TIME = 10;

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

function buildHub(renderer: Renderer): GameState {
  const available = new Set<HubSpotKey>(HUB_SPOT_KEYS);
  const session = createHub(createEmptyProfile(), createDefaultSkillProfile(), available);
  const view: HubSpotsView = { spots: session.hub.layout.spots, available, near: null };
  renderer.setHubView(view);
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

  const state = q.get("kind") === "hub" ? buildHub(renderer) : buildRun(q);
  // 1 回目で描画側の追跡（階の名札の時刻・部屋の表）を初期化し、時間を進めてから撮る
  renderer.render(state, null, false);
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
