/**
 * 読み込み画面「絵巻」の段取り（docs/ideas/loading-screen.md）。DOM に触らない。
 * 地図を描いている間は巻物が進み具合へ追いつきながら開き、描き終えたら 広げきる → 朱印 → クリックを待つ → 薄れる → 解き放つ。
 * 時計は描画側の実時間（ゲームの時刻は止まっている）。見た目だけでロジックには効かない
 */
import type { FloorKind } from "../core/state";
import { LOADING } from "../data/tuning";
import type { TipEntry } from "../meta/tips";
import { FLOOR_KIND_LABEL } from "../system/roomTypes";

/** 行き先。拠点・稽古の間・御堂は名だけ、階は深度と階の種類 */
export type LoadingPlace = { kind: "floor"; depth: number; floorKind: FloorKind } | { kind: "hub" } | { kind: "dojo" } | { kind: "hall" };

export type LoadingPhase = "open" | "seal" | "wait" | "fade" | "done";

export interface LoadingScreen {
  readonly place: LoadingPlace;
  readonly tip: TipEntry | null;
  /** 紙の開き（0..1） */
  open: number;
  phase: LoadingPhase;
  /** 今の段に入ってからの秒 */
  phaseTime: number;
  /** 読み込み画面を出してからの秒（軸の揺れ・墨の明滅など） */
  time: number;
}

const PLACE_NAME = { hub: "拠点", dojo: "稽古の間", hall: "御堂" } as const;

/** 題箋に書く名。階は「地下 n 階」と階の種類の名 */
export function loadingTitle(place: LoadingPlace): { title: string; sub: string } {
  if (place.kind === "floor") return { title: `地下 ${place.depth} 階`, sub: FLOOR_KIND_LABEL[place.floorKind] };
  return { title: PLACE_NAME[place.kind], sub: "" };
}

/** 縦書きの升。空白で区切り、数字の並びは 1 升にまとめる（縦中横） */
export function verticalCells(text: string): string[] {
  const cells: string[] = [];
  for (const word of text.split(" ")) {
    if (word === "") continue;
    if (/^[0-9]+$/.test(word)) {
      cells.push(word);
      continue;
    }
    cells.push(...word);
  }
  return cells;
}

/** 整数のハッシュ（Tips の選び方。state.rng は使わない） */
function mix(n: number): number {
  let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 出す Tips を 1 つ。本文が長すぎる項目（巻物の下に収まらない）は選ばない。seed で決まる */
export function pickLoadingTip(tips: readonly TipEntry[], seed: number): TipEntry | null {
  const fit = tips.filter((t) => [...t.body].length <= LOADING.tipMaxChars);
  if (fit.length === 0) return null;
  return fit[mix(seed) % fit.length] ?? null;
}

function placeSeed(place: LoadingPlace, seed: number): number {
  const depth = place.kind === "floor" ? place.depth : 0;
  return (seed ^ Math.imul(depth + 1, 0x9e3779b1)) >>> 0;
}

export function beginLoading(place: LoadingPlace, seed: number, tips: readonly TipEntry[]): LoadingScreen {
  return { place, tip: pickLoadingTip(tips, placeSeed(place, seed)), open: 0, phase: "open", phaseTime: 0, time: 0 };
}

function enter(ls: LoadingScreen, phase: LoadingPhase): void {
  ls.phase = phase;
  ls.phaseTime = 0;
}

/** 時間で終わる段の長さ（秒）。open は描き終わりで、wait はクリックで、done は終わらない */
const PHASE_SEC: Readonly<Record<"seal" | "fade", number>> = {
  seal: LOADING.sealDelaySec + LOADING.sealSec,
  fade: LOADING.fadeSec,
};
const NEXT: Readonly<Record<"seal" | "fade", LoadingPhase>> = { seal: "wait", fade: "done" };

/**
 * 1 フレーム進める。progress = 描き終えたチャンクの割合、ready = 地図（と拠点の町）を描き終えたか。
 * 開きは進み具合へ指数的に追いつき（段々の進みでもなめらかに見せる）、描き終えてから広げきったら朱印の段へ
 */
export function stepLoading(ls: LoadingScreen, dt: number, progress: number, ready: boolean): void {
  ls.time += dt;
  ls.phaseTime += dt;
  if (ls.phase === "done" || ls.phase === "wait") return;
  if (ls.phase === "open") {
    const target = ready ? 1 : Math.min(1, Math.max(0, progress));
    ls.open += (target - ls.open) * (1 - Math.exp(-LOADING.followRate * dt));
    if (target - ls.open <= LOADING.openSnap) ls.open = target;
    if (ready && ls.open >= 1) enter(ls, "seal");
    return;
  }
  if (ls.phaseTime >= PHASE_SEC[ls.phase]) enter(ls, NEXT[ls.phase]);
}

/** 読み込み画面の不透明度（薄れる段で 1 → 0。解き放ったら 0） */
export function loadingAlpha(ls: LoadingScreen): number {
  if (ls.phase === "done") return 0;
  if (ls.phase !== "fade") return 1;
  return Math.max(0, 1 - ls.phaseTime / LOADING.fadeSec);
}

/** 朱印を押し始めてからの秒（押す前は null）。押すのは朱印の段の sealDelaySec の後 */
export function sealAge(ls: LoadingScreen): number | null {
  if (ls.phase === "open") return null;
  if (ls.phase === "seal") return ls.phaseTime > LOADING.sealDelaySec ? ls.phaseTime - LOADING.sealDelaySec : null;
  return LOADING.sealSec + (ls.phase === "wait" ? ls.phaseTime : LOADING.holdSec);
}

/** 「クリックで進む」の案内が点いている割合（明滅の周期のうち） */
const PROMPT_ON_RATIO = 0.65;

/** クリック（または決定）を受け付けるか。朱印を押してから holdSec の後（押した直後の誤クリックで飛ばさない） */
function accepting(ls: LoadingScreen): boolean {
  return ls.phase === "wait" && ls.phaseTime >= LOADING.holdSec;
}

/** クリック / 決定を渡す。受け付けたら薄れる段へ進めて true */
export function confirmLoading(ls: LoadingScreen): boolean {
  if (!accepting(ls)) return false;
  enter(ls, "fade");
  return true;
}

/** 「クリックで進む」の案内を出すか（受け付けている間、promptBlinkSec の周期で点滅。点いている側から始める） */
export function loadingPromptVisible(ls: LoadingScreen): boolean {
  if (!accepting(ls)) return false;
  const t = (ls.phaseTime - LOADING.holdSec) % LOADING.promptBlinkSec;
  return t < LOADING.promptBlinkSec * PROMPT_ON_RATIO;
}

/** 薄れ終えたか（ゲームを進めてよい） */
export function loadingReleased(ls: LoadingScreen): boolean {
  return ls.phase === "done";
}

/** 後ろに階の画面を描くか（地図を描き終えて薄れている間） */
export function loadingShowsWorld(ls: LoadingScreen): boolean {
  return ls.phase === "fade" || ls.phase === "done";
}
