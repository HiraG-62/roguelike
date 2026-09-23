import type { ChainRecord } from "../core/events";
import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { STATUS_KINDS, type StatusKind } from "../core/status";
import { VIEW_W } from "../core/view";
import { STATUS_KEYWORDS } from "../system/keywords";
import { boonHudTop } from "./boonUi";
import { TEXT, drawText, textLineHeight, textWidth } from "./pixelText";

/**
 * 連鎖の表示（docs/ideas/synergy-web.md 4-e）。state.chains の直近を HUD の右下（祝福アイコン列の上）に
 * 「炎→炎 ×2」のように語の字形で流し、CHAIN_SHOW_SECONDS で消す。
 * state を読むだけ。時刻は state.time だけを使い、rng は使わない
 */

/** 1 つの連鎖を表示しておく秒数 */
export const CHAIN_SHOW_SECONDS = 3;
/** 消える前に薄くしていく秒数 */
const CHAIN_FADE_SECONDS = 0.5;
/** 同時に出す行数 */
export const CHAIN_MAX_LINES = 3;
/** この深さ以上の段を含む連鎖は大きめの文字で出す */
export const CHAIN_BIG_DEPTH = 2;
const CHAIN_RIGHT = 4;
const CHAIN_GAP_ABOVE_BOONS = 3;
const CHAIN_LINE_MIN = 10;
const CHAIN_BIG_LINE_MIN = 11;
const ARROW = "→";
const COLOR_ARROW = "#909090";
const COLOR_COUNT = "#ffffff";

/** 表示する 1 行: 連鎖の語の並び（段の順）と、同じ並びが続いた回数 */
export interface ChainLine {
  words: Keyword[];
  count: number;
  maxDepth: number;
  /** 最後の段が起きてからの秒 */
  age: number;
}

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_KINDS);

function isKeyword(key: string): key is Keyword {
  return Object.hasOwn(KEYWORD_DEFS, key);
}

function isStatusKind(key: string): key is StatusKind {
  return STATUS_SET.has(key);
}

/**
 * 記録の key（語・状態異常の種類・効果の種類のどれか）を語へ寄せる。
 * 語にならない効果（バフなど）は表示しない
 */
export function chainWord(key: string): Keyword | null {
  if (isKeyword(key)) return key;
  if (isStatusKind(key)) return STATUS_KEYWORDS[key][0] ?? null;
  return null;
}

interface Sequence {
  words: Keyword[];
  maxDepth: number;
  lastDepth: number;
  lastTime: number;
}

/** 深さが増えている間は 1 本の連鎖。深さが戻ったら新しい連鎖 */
function toSequences(records: readonly ChainRecord[]): Sequence[] {
  const seqs: Sequence[] = [];
  for (const r of records) {
    const word = chainWord(r.keyword);
    if (word === null) continue;
    const cur = seqs[seqs.length - 1];
    if (cur !== undefined && r.depth > cur.lastDepth) {
      cur.words.push(word);
      cur.maxDepth = Math.max(cur.maxDepth, r.depth);
      cur.lastDepth = r.depth;
      cur.lastTime = r.time;
      continue;
    }
    seqs.push({ words: [word], maxDepth: r.depth, lastDepth: r.depth, lastTime: r.time });
  }
  return seqs;
}

function sameWords(a: readonly Keyword[], b: readonly Keyword[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** 表示する行（古い順、最大 CHAIN_MAX_LINES）。同じ並びが続いたら ×n にまとめる */
export function chainLines(chains: readonly ChainRecord[], now: number): ChainLine[] {
  const recent = chains.filter((c) => now - c.time >= 0 && now - c.time <= CHAIN_SHOW_SECONDS);
  const lines: ChainLine[] = [];
  for (const seq of toSequences(recent)) {
    const prev = lines[lines.length - 1];
    if (prev !== undefined && sameWords(prev.words, seq.words)) {
      prev.count += 1;
      prev.maxDepth = Math.max(prev.maxDepth, seq.maxDepth);
      prev.age = now - seq.lastTime;
      continue;
    }
    lines.push({ words: seq.words, count: 1, maxDepth: seq.maxDepth, age: now - seq.lastTime });
  }
  return lines.slice(-CHAIN_MAX_LINES);
}

/** 行の不透明度（最後の CHAIN_FADE_SECONDS で薄くなる） */
export function chainAlpha(age: number): number {
  const left = CHAIN_SHOW_SECONDS - age;
  if (left <= 0) return 0;
  return Math.min(1, left / CHAIN_FADE_SECONDS);
}

function lineSize(line: ChainLine): number {
  return line.maxDepth >= CHAIN_BIG_DEPTH ? TEXT.BODY : TEXT.SMALL;
}

function lineHeight(line: ChainLine): number {
  const big = line.maxDepth >= CHAIN_BIG_DEPTH;
  return Math.max(big ? CHAIN_BIG_LINE_MIN : CHAIN_LINE_MIN, textLineHeight(lineSize(line)));
}

/** 各行のベースライン y（新しい行ほど下。祝福アイコン列の上に積む） */
export function chainBaselines(heights: readonly number[], boonCount: number): number[] {
  let y = boonHudTop(boonCount) - CHAIN_GAP_ABOVE_BOONS;
  const out: number[] = new Array<number>(heights.length).fill(0);
  for (let i = heights.length - 1; i >= 0; i--) {
    out[i] = y;
    y -= heights[i] ?? 0;
  }
  return out;
}

function countText(line: ChainLine): string {
  return line.count > 1 ? ` ×${line.count}` : "";
}

function drawLine(ctx: CanvasRenderingContext2D, line: ChainLine, baseline: number): void {
  const m = lineSize(line);
  const arrowW = textWidth(ARROW, m);
  const glyphW = line.words.reduce((sum, k) => sum + textWidth(KEYWORD_DEFS[k].glyph, m), 0);
  const tail = countText(line);
  const total = glyphW + arrowW * (line.words.length - 1) + textWidth(tail, m);
  let x = VIEW_W - CHAIN_RIGHT - total;
  line.words.forEach((k, i) => {
    if (i > 0) {
      drawText(ctx, ARROW, x, baseline, m, COLOR_ARROW);
      x += arrowW;
    }
    const def = KEYWORD_DEFS[k];
    drawText(ctx, def.glyph, x, baseline, m, def.color);
    x += textWidth(def.glyph, m);
  });
  if (tail !== "") drawText(ctx, tail, x, baseline, m, COLOR_COUNT);
}

export function drawChainHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.chains.length === 0 || state.status !== "playing") return;
  const lines = chainLines(state.chains, state.time);
  if (lines.length === 0) return;
  const baselines = chainBaselines(lines.map(lineHeight), state.boons.length);
  lines.forEach((line, i) => {
    ctx.globalAlpha = chainAlpha(line.age);
    drawLine(ctx, line, baselines[i] ?? 0);
  });
  ctx.globalAlpha = 1;
}
