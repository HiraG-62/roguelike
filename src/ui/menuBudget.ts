import { MENU_BUDGET } from "../data/tuning";

/**
 * 持ち物メニューの情報の予算を数える道具（docs/ideas/inventory-v2/E-merged.md 4 章）。
 * 画面そのものは何も変えず、render のテストが「描いた文字」を記録して渡し、上限（data/balance/feel/MENU_BUDGET.json）と比べる。
 * 書付（全文・数字の出口）は予算の外なので、書付の画面には使わない
 */

/**
 * 画面が描いた文字 1 つ。role で数え方が変わる。
 * - sentence: 荷札・見出し・操作案内などの文。行に数える。含まれる数は UI が出す数に数えない（性質の文の値は文の行で縛る）
 * - label: 見出し・件数・段の数など、UI が出す数を含みうる短い文字。行にも数にも数える
 * - ornament: 札の名前・丸印の 1 字・珠など。行にも数にも数えない
 */
export type MenuTextRole = "sentence" | "label" | "ornament";

export interface MenuTextRun {
  text: string;
  /** 行の位置（論理 px）。ほぼ同じ y の文字は 1 行にまとめる */
  y: number;
  /** BODY（10px 以上）で描いたか */
  body: boolean;
  role: MenuTextRole;
}

/** 同じ行とみなす y の幅（BODY と SMALL を同じ行に並べたときの基準線のずれ。論理 px） */
const ROW_TOLERANCE = 2;

/** 数字 1 つ（「2/4」「7」「1.5」は 1 つ。全角も数える） */
const NUMBER_TOKEN = /[0-9０-９]+(?:[./／][0-9０-９]+)*/gu;

function isCounted(run: Readonly<MenuTextRun>): boolean {
  return run.role !== "ornament" && run.text.trim().length > 0;
}

/** 行にまとめる（y を昇順に並べ、前の行の先頭から ROW_TOLERANCE 以内なら同じ行）。各行はその行の文字の列 */
function rowsOf(runs: readonly MenuTextRun[]): MenuTextRun[][] {
  const sorted = runs.filter(isCounted).sort((a, b) => a.y - b.y);
  const rows: MenuTextRun[][] = [];
  let rowY = Number.NEGATIVE_INFINITY;
  for (const run of sorted) {
    const row = rows[rows.length - 1];
    if (row !== undefined && run.y - rowY <= ROW_TOLERANCE) {
      row.push(run);
      continue;
    }
    rows.push([run]);
    rowY = run.y;
  }
  return rows;
}

/** 文の行の数 */
export function countTextLines(runs: readonly MenuTextRun[]): number {
  return rowsOf(runs).length;
}

/** BODY を含む行の数 */
export function countBodyLines(runs: readonly MenuTextRun[]): number {
  return rowsOf(runs).filter((row) => row.some((r) => r.body)).length;
}

/** UI が出す数の個数（label の中の数字だけ。sentence と ornament は数えない） */
export function countNumbers(runs: readonly MenuTextRun[]): number {
  let n = 0;
  for (const run of runs) {
    if (run.role !== "label") continue;
    n += run.text.match(NUMBER_TOKEN)?.length ?? 0;
  }
  return n;
}

/** 画面の数え。構造の数（候補・帯・珠）は render が持つ配列の長さを渡す。無い項目は省略 */
export interface MenuCensus {
  lines: number;
  bodyLines: number;
  numbers: number;
  candidates?: number;
  steppedBands?: number;
  undercurrentBands?: number;
  beads?: { source?: number; sink?: number; amplifier?: number };
}

/** 描いた文字から文の行・BODY の行・数を数える */
export function censusOfText(runs: readonly MenuTextRun[]): Pick<MenuCensus, "lines" | "bodyLines" | "numbers"> {
  return { lines: countTextLines(runs), bodyLines: countBodyLines(runs), numbers: countNumbers(runs) };
}

/** 場面。compare = 比べる場面（候補）だけ文の行の上限が広い */
export type MenuMode = "plain" | "compare";

export interface BudgetViolation {
  /** 超えた項目（日本語） */
  item: string;
  actual: number;
  limit: number;
}

function over(item: string, actual: number | undefined, limit: number): BudgetViolation[] {
  return actual !== undefined && actual > limit ? [{ item, actual, limit }] : [];
}

/** 予算を超えた項目の一覧（空なら予算内）。テストは `expect(budgetViolations(...)).toEqual([])` で使う */
export function budgetViolations(census: Readonly<MenuCensus>, mode: MenuMode = "plain"): BudgetViolation[] {
  const lineLimit = mode === "compare" ? MENU_BUDGET.compareTextLines : MENU_BUDGET.textLines;
  return [
    ...over("文の行", census.lines, lineLimit),
    ...over("BODY の行", census.bodyLines, MENU_BUDGET.bodyLines),
    ...over("UI が出す数", census.numbers, MENU_BUDGET.numbers),
    ...over("候補", census.candidates, MENU_BUDGET.candidates),
    ...over("段の立った帯", census.steppedBands, MENU_BUDGET.bands.stepped),
    ...over("伏流の帯", census.undercurrentBands, MENU_BUDGET.bands.undercurrent),
    ...over("源の珠", census.beads?.source, MENU_BUDGET.beads.source),
    ...over("糧の珠", census.beads?.sink, MENU_BUDGET.beads.sink),
    ...over("強めの珠", census.beads?.amplifier, MENU_BUDGET.beads.amplifier),
  ];
}
