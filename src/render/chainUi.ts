import type { ChainRecord } from "../core/events";
import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { STATUS_KINDS, type StatusKind } from "../core/status";
import { VIEW_W } from "../core/view";
import { DISCOVERY } from "../data/tuning";
import { linkHintText } from "../meta/linkHint";
import { type LinkRun, chainNameOfWords, linkName } from "../meta/links";
import { STATUS_KEYWORDS } from "../system/keywords";
import { hudLayoutFor } from "./layers";
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";
import type { HudLayout } from "./renderMath";

/**
 * 連鎖の表示（docs/ideas/synergy-web.md 4-e）。state.chains の直近を HUD の右下（祝福アイコン列の上）に
 * 「炎→炎 ×2」のように語の字形で流し、CHAIN_SHOW_SECONDS で消す。名のある連鎖（src/meta/links.ts の NAMED_CHAINS）は
 * 先頭に名前を添える（「延焼 炎→炎」）。その上に、初めて見つけた連携（「新たな連携「渦雷」」）と手がかり枠（5-d）を積む。
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
const CHAIN_LINE_MIN = 10;
const CHAIN_BIG_LINE_MIN = 11;
const ARROW = "→";
const COLOR_ARROW = "#909090";
const COLOR_COUNT = "#ffffff";
const COLOR_CHAIN_NAME = "#ffd75f";
const COLOR_FRESH = "#ffd75f";
const COLOR_HINT = "#a0c0e0";
/** 名前と字形の間 */
const CHAIN_NAME_GAP = 3;
/** 通知の行（初発見・手がかり）の最大幅（右端から左へ。HUD の左側を隠さないように） */
const NOTE_MAX_W = 220;
const NOTE_LINE_MIN = 10;

/** 表示する 1 行: 連鎖の語の並び（段の順）と、同じ並びが続いた回数 */
export interface ChainLine {
  words: Keyword[];
  /** 名のある連鎖の名前（無ければ null） */
  name: string | null;
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
    lines.push({ words: seq.words, name: chainNameOfWords(seq.words), count: 1, maxDepth: seq.maxDepth, age: now - seq.lastTime });
  }
  return lines.slice(-CHAIN_MAX_LINES);
}

/** 行の不透明度（表示秒 life の最後の CHAIN_FADE_SECONDS で薄くなる） */
export function chainAlpha(age: number, life: number = CHAIN_SHOW_SECONDS): number {
  const left = life - age;
  if (left <= 0) return 0;
  return Math.min(1, left / CHAIN_FADE_SECONDS);
}

/** 連鎖の行の上に積む 1 行の知らせ（初めて見つけた連携・手がかり） */
export interface DiscoveryNote {
  kind: "fresh" | "hint";
  text: string;
  age: number;
  life: number;
}

/** 今出す知らせ（上から 手がかり → 初発見）。出す時間を過ぎたものは出さない */
export function discoveryNotes(links: Readonly<LinkRun>, now: number): DiscoveryNote[] {
  const out: DiscoveryNote[] = [];
  const hint = links.hint;
  if (hint !== null) {
    const age = now - hint.since;
    const text = linkHintText(hint);
    if (age >= 0 && age <= DISCOVERY.hintShowSeconds && text !== "") out.push({ kind: "hint", text: `手がかり: ${text}`, age, life: DISCOVERY.hintShowSeconds });
  }
  const fresh = links.fresh;
  if (fresh !== null) {
    const age = now - fresh.time;
    if (age >= 0 && age <= DISCOVERY.freshShowSeconds) out.push({ kind: "fresh", text: `新たな連携「${linkName(fresh.id)}」`, age, life: DISCOVERY.freshShowSeconds });
  }
  return out;
}

function lineSize(line: ChainLine): number {
  return line.maxDepth >= CHAIN_BIG_DEPTH ? TEXT.BODY : TEXT.SMALL;
}

function lineHeight(line: ChainLine): number {
  const big = line.maxDepth >= CHAIN_BIG_DEPTH;
  return Math.max(big ? CHAIN_BIG_LINE_MIN : CHAIN_LINE_MIN, textLineHeight(lineSize(line)));
}

/** 各行のベースライン y（新しい行ほど下。bottom は最下行の基準線で、右下のスキル枠・変身の行の上） */
export function chainBaselines(heights: readonly number[], bottom: number): number[] {
  let y = bottom;
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
  const nameW = line.name === null ? 0 : textWidth(line.name, m) + CHAIN_NAME_GAP;
  const total = nameW + glyphW + arrowW * (line.words.length - 1) + textWidth(tail, m);
  let x = VIEW_W - CHAIN_RIGHT - total;
  if (line.name !== null) {
    drawText(ctx, line.name, x, baseline, m, COLOR_CHAIN_NAME);
    x += nameW;
  }
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

function noteHeight(): number {
  return Math.max(NOTE_LINE_MIN, textLineHeight(TEXT.SMALL));
}

function drawNote(ctx: CanvasRenderingContext2D, note: DiscoveryNote, baseline: number): void {
  const m = TEXT.SMALL;
  const text = truncateText(note.text, NOTE_MAX_W, m);
  drawText(ctx, text, VIEW_W - CHAIN_RIGHT, baseline, m, note.kind === "fresh" ? COLOR_FRESH : COLOR_HINT, "right");
}

export function drawChainHud(ctx: CanvasRenderingContext2D, state: GameState, layout: HudLayout = hudLayoutFor(state)): void {
  if (state.status !== "playing") return;
  const lines = state.chains.length === 0 ? [] : chainLines(state.chains, state.time);
  const notes = discoveryNotes(state.codexRun.links, state.time);
  if (lines.length === 0 && notes.length === 0) return;
  // 知らせを上、連鎖を下に積む（新しい連鎖ほどスキル枠に近い）
  const heights = [...notes.map(noteHeight), ...lines.map(lineHeight)];
  const baselines = chainBaselines(heights, layout.chainBottom);
  notes.forEach((note, i) => {
    ctx.globalAlpha = chainAlpha(note.age, note.life);
    drawNote(ctx, note, baselines[i] ?? 0);
  });
  lines.forEach((line, i) => {
    ctx.globalAlpha = chainAlpha(line.age);
    drawLine(ctx, line, baselines[notes.length + i] ?? 0);
  });
  ctx.globalAlpha = 1;
}
