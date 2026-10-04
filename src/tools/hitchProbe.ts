// 一瞬の固まり（ヒッチ）の計測用。ゲーム本体からは import しない（tools/hitch-probe.html）。
// bot に実時間で遊ばせて、1 フレームの step・描画・効果音の ms と、そのフレームで初めて作った canvas・getImageData・
// 画像の decode・初めて出た敵 / 効果音の名前を記録し、長いフレームを window.__hitch に出す。
// クエリ: ?seed=&depth=&frames=&threshold=&methods=1（methods=1 は Renderer のメソッドごとの自己時間も取る）。
// 実行は `pnpm run hitch:probe`（scripts/hitch-probe.mjs）。実時間（performance.now）を使うのは計測だけで、state には入れない。
import { createGame, step } from "../core/game";
import { VIEW_H, VIEW_W } from "../core/view";
import { SHEETS, TILE_SPRITES } from "../data/tiles";
import { createEmptyProfile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { defaultRunSetup } from "../system/runSetup";
import { loadImageAtlas } from "../render/imageAtlas";
import { Renderer } from "../render/renderer";
import { SfxPlayer } from "../audio/sfx";
import { botInput, createBotState } from "../qa/bot";

interface FrameRecord {
  frame: number;
  depth: number;
  stepMs: number;
  renderMs: number;
  sfxMs: number;
  /** 前の rAF からの間隔（合成・GC を含む） */
  gapMs: number;
  canvases: number;
  getImageData: number;
  getImageDataMs: number;
  decodes: number;
  firstSfx: string[];
  firstEnemies: string[];
  sources: Record<string, number>;
  methods: Record<string, number>;
}

interface HitchReport {
  frames: number;
  avgMs: number;
  long: FrameRecord[];
  totals: { canvases: number; getImageData: number; decodes: number };
  sources: Record<string, number>;
}

declare global {
  interface Window {
    __hitch?: HitchReport;
    __hitchError?: string;
  }
}

const DT = 1 / 60;
/** 画面に入ったとみなす、画面の縁からのはみ出し（px） */
const ON_SCREEN_MARGIN = 32;
const DEFAULT_FRAMES = 3600;
const DEFAULT_THRESHOLD_MS = 16;

function intParam(q: URLSearchParams, key: string, fallback: number): number {
  const v = Number(q.get(key) ?? "");
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

const counters = { canvases: 0, getImageData: 0, getImageDataMs: 0, decodes: 0 };
/** このフレームで canvas を作った・getImageData を呼んだ呼び出し元（ファイル:関数）ごとの回数 */
let sources = new Map<string, number>();
/** ラン全体の呼び出し元ごとの回数 */
const sourcesTotal = new Map<string, number>();

const STACK_SKIP = 2;
function callerOf(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(STACK_SKIP);
  for (const line of lines) {
    if (!line.includes("/src/") || line.includes("hitchProbe")) continue;
    const m = /at (?:(\S+) )?\(?.*\/src\/([^?:]+)/.exec(line);
    if (m) return `${m[2]}:${m[1] ?? "?"}`;
  }
  return "?";
}

function note(kind: string): void {
  const key = `${kind} ${callerOf()}`;
  sources.set(key, (sources.get(key) ?? 0) + 1);
  sourcesTotal.set(key, (sourcesTotal.get(key) ?? 0) + 1);
}

function instrument(): void {
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (this: Document, tag: string, opts?: ElementCreationOptions) {
    if (tag.toLowerCase() === "canvas") {
      counters.canvases++;
      note("canvas");
    }
    return createElement.call(this, tag, opts);
  } as typeof Document.prototype.createElement;
  const getImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof getImageData>) {
    const t0 = performance.now();
    const out = getImageData.apply(this, args);
    counters.getImageData++;
    counters.getImageDataMs += performance.now() - t0;
    note("gid");
    return out;
  } as typeof getImageData;
  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
    counters.decodes++;
    return decode.call(this);
  };
}

/** このフレームの Renderer のメソッドごとの自己時間（子のメソッドの時間を引いた ms） */
let selfMs = new Map<string, number>();

/** Renderer の prototype のメソッドを包んで自己時間を数える（render 自身は外す） */
function instrumentRenderer(): void {
  const proto = Renderer.prototype as unknown as Record<string, unknown>;
  const stack: { start: number; child: number }[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor" || name === "render") continue;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    const fn = desc?.value;
    if (typeof fn !== "function") continue;
    proto[name] = function (this: unknown, ...args: unknown[]) {
      const frame = { start: performance.now(), child: 0 };
      stack.push(frame);
      try {
        return (fn as (...a: unknown[]) => unknown).apply(this, args);
      } finally {
        stack.pop();
        const total = performance.now() - frame.start;
        const parent = stack[stack.length - 1];
        if (parent) parent.child += total;
        selfMs.set(name, (selfMs.get(name) ?? 0) + total - frame.child);
      }
    };
  }
}

const TOP_METHODS = 6;
function topMethods(): Record<string, number> {
  const top = [...selfMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_METHODS);
  return Object.fromEntries(top.map(([k, v]) => [k, Math.round(v * 10) / 10]));
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function main(): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const seed = intParam(q, "seed", 1);
  const frames = intParam(q, "frames", DEFAULT_FRAMES);
  const threshold = intParam(q, "threshold", DEFAULT_THRESHOLD_MS);
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas#game がない");
  const renderer = new Renderer(canvas);
  try {
    await document.fonts.load('16px "DotGothic16"');
  } catch {
    // フォントが無くても計測はできる
  }
  renderer.setAtlas(await loadImageAtlas(TILE_SPRITES, SHEETS));
  const sfx = new SfxPlayer();
  sfx.unlock();
  const state = createGame(seed, String(seed), createEmptyProfile(), createDefaultSkillProfile(), { ...defaultRunSetup(), startDepth: intParam(q, "depth", 1) });
  const bot = createBotState(seed);
  instrument();
  if (q.get("methods") === "1") instrumentRenderer();

  const seenSfx = new Set<string>();
  const seenEnemies = new Set<string>();
  const long: FrameRecord[] = [];
  let sum = 0;
  let ran = 0;
  let last = await nextFrame();
  // トレースで GC の時刻を走りの開始と突き合わせる目印
  console.timeStamp("hitch-start");
  for (let f = 0; f < frames && state.status === "playing"; f++) {
    const before = { ...counters };
    sources = new Map();
    selfMs = new Map();
    // bot の考える時間はゲームに無いので測らない
    const input = botInput(state, bot, DT);
    const t0 = performance.now();
    step(state, input, DT);
    const t1 = performance.now();
    const names = state.sfx.splice(0);
    for (const name of names) sfx.play(name);
    const t2 = performance.now();
    renderer.render(state, null, false);
    const t3 = performance.now();
    const firstSfx = names.filter((n) => !seenSfx.has(n));
    firstSfx.forEach((n) => seenSfx.add(n));
    const cam = state.camera.pos;
    const onScreen = state.enemies.filter((e) => Math.abs(e.body.pos.x - cam.x) < VIEW_W / 2 + ON_SCREEN_MARGIN && Math.abs(e.body.pos.y - cam.y) < VIEW_H / 2 + ON_SCREEN_MARGIN);
    const firstEnemies = [...new Set(onScreen.map((e) => `${e.defKey}${e.grade ? `/${e.grade}` : ""}`))].filter((k) => !seenEnemies.has(k));
    firstEnemies.forEach((k) => seenEnemies.add(k));
    const now = await nextFrame();
    const rec: FrameRecord = {
      frame: f,
      depth: state.depth,
      stepMs: t1 - t0,
      sfxMs: t2 - t1,
      renderMs: t3 - t2,
      gapMs: now - last,
      canvases: counters.canvases - before.canvases,
      getImageData: counters.getImageData - before.getImageData,
      getImageDataMs: counters.getImageDataMs - before.getImageDataMs,
      decodes: counters.decodes - before.decodes,
      firstSfx,
      firstEnemies,
      sources: Object.fromEntries(sources),
      methods: topMethods(),
    };
    last = now;
    const work = rec.stepMs + rec.sfxMs + rec.renderMs;
    sum += work;
    ran++;
    if (work >= threshold) long.push(rec);
  }
  window.__hitch = {
    frames: ran,
    avgMs: ran > 0 ? sum / ran : 0,
    long,
    totals: { canvases: counters.canvases, getImageData: counters.getImageData, decodes: counters.decodes },
    sources: Object.fromEntries(sourcesTotal),
  };
}

main().catch((e: unknown) => {
  window.__hitchError = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
});
