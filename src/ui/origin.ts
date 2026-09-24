import { VIEW_W } from "../core/view";
import {
  ORIGINS,
  ORIGIN_KEYS,
  type OriginKey,
  RUN_MODS,
  RUN_MOD_KEYS,
  type RunModKey,
  type RunSetup,
  defaultRunSetup,
  runTier,
} from "../system/runSetup";
import { QUESTS } from "../meta/quests";
import { JOBS, JOB_KEYS, type JobKey } from "../data/jobs";
import { jobDetailLines } from "../system/jobs";

/**
 * 起点画面（タイトル → ジョブ → 起点・縛り → ラン開始）の状態と入力。DOM 非依存。
 * 段は 2 つ。ジョブの段でジョブを 1 つ選ぶと（決定）起点の段へ進む。Esc で 1 段戻る（backOriginStage）。
 * 起点の段は左の列で起点を 1 つ選び、右の列で縛り（ラン修飾子）を積む。左の列の最後の行「出発」で始める
 */

export type OriginStage = "job" | "origin";
export type OriginColumn = "job" | "origin" | "modifier";
export type OriginRow = OriginKey | "start";

export const ORIGIN_ROWS: readonly OriginRow[] = [...ORIGIN_KEYS, "start"];
export const JOB_ROWS: readonly JobKey[] = JOB_KEYS;
export const START_LABEL = "出発";

export interface OriginScreen {
  stage: OriginStage;
  /** ジョブの段のカーソル（JOB_ROWS の添字） */
  jobCursor: number;
  job: JobKey;
  /** 依頼で未解放のジョブ（「？」で出し、選べない。src/meta/quests.ts の lockedJobs） */
  lockedJobs: ReadonlySet<JobKey>;
  column: OriginColumn;
  /** 左の列（ORIGIN_ROWS）のカーソル */
  originCursor: number;
  /** 右の列（RUN_MOD_KEYS）のカーソル */
  modCursor: number;
  origin: OriginKey;
  modifiers: RunModKey[];
  /** 依頼で未解放の起点（「？」で出し、選べない。src/meta/quests.ts の lockedOrigins） */
  locked: ReadonlySet<OriginKey>;
}

/**
 * 前回の選択を引き継いでジョブの段から開く。カーソルは前回のジョブ、起点の段へ進むと「出発」に置く
 * （Enter 連打ですぐ始められる）
 */
export function createOriginScreen(
  prev: RunSetup = defaultRunSetup(),
  locked: ReadonlySet<OriginKey> = new Set(),
  lockedJobs: ReadonlySet<JobKey> = new Set(),
): OriginScreen {
  // 前回のジョブが未解放扱い（保存データが消えた等）なら見習いへ戻す
  const job = prev.job === undefined || lockedJobs.has(prev.job) ? "none" : prev.job;
  return {
    stage: "job",
    jobCursor: Math.max(0, JOB_ROWS.indexOf(job)),
    job,
    lockedJobs,
    column: "origin",
    originCursor: ORIGIN_ROWS.length - 1,
    modCursor: 0,
    // 前回の起点が未解放扱い（保存データが消えた等）なら放浪者へ戻す
    origin: locked.has(prev.origin) ? defaultRunSetup().origin : prev.origin,
    modifiers: [...prev.modifiers],
    locked,
  };
}

/** 未解放の起点の説明（どの依頼で解放されるか） */
function lockedDescription(row: OriginKey): string {
  const by = ORIGINS[row].unlockedBy;
  return by === undefined ? "" : `依頼「${QUESTS[by].name}」を達成すると選べる。`;
}

export const LOCKED_ORIGIN_NAME = "？？？";

export function originSetup(ui: Readonly<OriginScreen>): RunSetup {
  // 縛りの並びは RUN_MOD_KEYS の順にそろえる（リプレイや記録で同じ組を同じ表記にする）
  return { origin: ui.origin, modifiers: RUN_MOD_KEYS.filter((k) => ui.modifiers.includes(k)), job: ui.job };
}

/** 未解放のジョブの説明（どの依頼で解放されるか） */
function lockedJobDescription(job: JobKey): string {
  const by = JOBS[job].unlockedBy;
  return by === undefined ? "" : `依頼「${QUESTS[by].name}」を達成すると選べる。`;
}

/** 起点の段からジョブの段へ戻る（Esc）。戻れたら true、ジョブの段なら false（呼び出し側がタイトルへ戻す） */
export function backOriginStage(ui: OriginScreen): boolean {
  if (ui.stage === "job") return false;
  ui.stage = "job";
  ui.jobCursor = Math.max(0, JOB_ROWS.indexOf(ui.job));
  return true;
}

export function originTier(ui: Readonly<OriginScreen>): number {
  return runTier(ui.modifiers);
}

function wrap(index: number, delta: number, length: number): number {
  return (((index + delta) % length) + length) % length;
}

/** 矢印の 1 回ぶん。dx で列を切り替え、dy で列の中を動く。動いたら true */
export function moveOriginCursor(ui: OriginScreen, dx: number, dy: number): boolean {
  if (ui.stage === "job") {
    if (dy === 0) return false;
    ui.jobCursor = wrap(ui.jobCursor, dy, JOB_ROWS.length);
    return true;
  }
  if (dx !== 0) {
    ui.column = ui.column === "origin" ? "modifier" : "origin";
    return true;
  }
  if (dy === 0) return false;
  if (ui.column === "origin") ui.originCursor = wrap(ui.originCursor, dy, ORIGIN_ROWS.length);
  else ui.modCursor = wrap(ui.modCursor, dy, RUN_MOD_KEYS.length);
  return true;
}

export type OriginResult = "none" | "changed" | "start";

/** 決定: ジョブの行は選んで起点の段へ、起点の行は選択、「出発」は開始、縛りの行は積む / 外す */
export function activateOriginCursor(ui: OriginScreen): OriginResult {
  if (ui.stage === "job") return activateJobRow(ui);
  if (ui.column === "modifier") {
    const key = RUN_MOD_KEYS[ui.modCursor];
    if (!key) return "none";
    toggleModifier(ui, key);
    return "changed";
  }
  const row = ORIGIN_ROWS[ui.originCursor];
  if (!row) return "none";
  if (row === "start") return "start";
  if (ui.locked.has(row)) return "none";
  ui.origin = row;
  return "changed";
}

function activateJobRow(ui: OriginScreen): OriginResult {
  const row = JOB_ROWS[ui.jobCursor];
  if (!row || ui.lockedJobs.has(row)) return "none";
  ui.job = row;
  ui.stage = "origin";
  ui.column = "origin";
  ui.originCursor = ORIGIN_ROWS.length - 1;
  return "changed";
}

export function toggleModifier(ui: OriginScreen, key: RunModKey): void {
  ui.modifiers = ui.modifiers.includes(key) ? ui.modifiers.filter((k) => k !== key) : [...ui.modifiers, key];
}

/** カーソルの行の名前と説明（画面下の説明欄） */
export function cursorDescription(ui: Readonly<OriginScreen>): { name: string; desc: string } {
  if (ui.stage === "job") return jobCursorDescription(ui);
  if (ui.column === "modifier") {
    const key = RUN_MOD_KEYS[ui.modCursor];
    if (!key) return { name: "", desc: "" };
    const def = RUN_MODS[key];
    return { name: `${def.name}（${def.points} 点）`, desc: def.desc };
  }
  const row = ORIGIN_ROWS[ui.originCursor];
  if (!row) return { name: "", desc: "" };
  if (row === "start") {
    return { name: START_LABEL, desc: `ジョブ「${JOBS[ui.job].name}」・起点「${ORIGINS[ui.origin].name}」・位階 ${originTier(ui)} で潜る。` };
  }
  if (ui.locked.has(row)) return { name: LOCKED_ORIGIN_NAME, desc: lockedDescription(row) };
  return { name: ORIGINS[row].name, desc: ORIGINS[row].desc };
}

function jobCursorDescription(ui: Readonly<OriginScreen>): { name: string; desc: string } {
  const row = JOB_ROWS[ui.jobCursor];
  if (!row) return { name: "", desc: "" };
  if (ui.lockedJobs.has(row)) return { name: LOCKED_ORIGIN_NAME, desc: lockedJobDescription(row) };
  return { name: JOBS[row].name, desc: JOBS[row].desc };
}

/** ジョブの段の詳細欄（カーソルのジョブの ステータス / 得意な武器 / ルール / 初期スキル石 / 弱点）。未解放なら空 */
export function jobCursorDetail(ui: Readonly<OriginScreen>): string[] {
  const row = JOB_ROWS[ui.jobCursor];
  if (!row || ui.lockedJobs.has(row)) return [];
  return jobDetailLines(row);
}

// ---------------------------------------------------------------------------
// レイアウト（描画 render/originUi.ts とマウスの当たり判定で共有する。行間は呼び出し側が textLineHeight から渡す）
// ---------------------------------------------------------------------------

export const ORIGIN_LAYOUT = {
  titleY: 20,
  headerY: 42,
  listY: 56,
  leftX: 24,
  colW: 200,
  rightX: VIEW_W / 2 + 16,
  descY: 228,
  hintY: 262,
  minRowGap: 13,
  /** ジョブの段: 左の一覧の幅と、右の詳細欄の左端・下端 */
  jobColW: 110,
  jobDetailX: 144,
  jobDetailBottom: 250,
} as const;

export function originRowGap(lineHeight: number): number {
  return Math.max(ORIGIN_LAYOUT.minRowGap, lineHeight);
}

/** 行の矩形の上端（文字の基準線は上端 + 行間 - 3 あたり。描画側が合わせる） */
export function originRowTop(index: number, rowGap: number): number {
  return ORIGIN_LAYOUT.listY + index * rowGap;
}

/** 画面座標の点がどの行か（無ければ null）。stage はジョブの段なら "job" */
export function originItemAt(x: number, y: number, rowGap: number, stage: OriginStage = "origin"): { column: OriginColumn; row: number } | null {
  const row = Math.floor((y - ORIGIN_LAYOUT.listY) / rowGap);
  if (row < 0) return null;
  if (stage === "job") {
    const inList = x >= ORIGIN_LAYOUT.leftX && x < ORIGIN_LAYOUT.leftX + ORIGIN_LAYOUT.jobColW;
    return inList && row < JOB_ROWS.length ? { column: "job", row } : null;
  }
  const inLeft = x >= ORIGIN_LAYOUT.leftX && x < ORIGIN_LAYOUT.leftX + ORIGIN_LAYOUT.colW;
  const inRight = x >= ORIGIN_LAYOUT.rightX && x < ORIGIN_LAYOUT.rightX + ORIGIN_LAYOUT.colW;
  if (inLeft && row < ORIGIN_ROWS.length) return { column: "origin", row };
  if (inRight && row < RUN_MOD_KEYS.length) return { column: "modifier", row };
  return null;
}

/** マウスで行を指す（カーソルを移す）。変わったら true */
export function pointOriginRow(ui: OriginScreen, hit: { column: OriginColumn; row: number }): boolean {
  if (hit.column === "job") {
    const changed = ui.jobCursor !== hit.row;
    ui.jobCursor = hit.row;
    return changed;
  }
  const before = `${ui.column}:${ui.originCursor}:${ui.modCursor}`;
  ui.column = hit.column;
  if (hit.column === "origin") ui.originCursor = hit.row;
  else ui.modCursor = hit.row;
  return before !== `${ui.column}:${ui.originCursor}:${ui.modCursor}`;
}
