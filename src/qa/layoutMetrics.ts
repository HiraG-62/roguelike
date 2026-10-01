import { type GameState, ROAMING_ROOM } from "../core/state";
import { Tile, rectCenterPx } from "../map/grid";
import { LAYOUT_KINDS, type FloorLayout } from "../map/layout/types";
import { UNREACHABLE, distanceField, tileOf } from "../map/pathing";
import { countCombatants } from "./jinMetrics";

/**
 * 階の型ごとの計測（docs/ideas/map-gen-impl.md 2-6「QA bot」）。state を読むだけで書き換えない。
 * フル QA（simulation.test.ts の runOnce）が初めて着いた階ごとに 1 件の記録を作り、report.md に型別の表を出す。
 * 型ごとの歩きの長さ・敵の数・重さを並べて、型の JSON（MAP_LAYOUT）と JIN のつまみを見直す材料にする
 */

/** 階を離れた理由。descended = 下りた / left = 上った・戻った / died = 倒れた / ended = ランの打ち切り */
export type FloorOutcome = "descended" | "left" | "died" | "ended";

export interface LayoutFloorRecord {
  layout: FloorLayout;
  depth: number;
  /** 着いた位置から階段（無ければ最後の部屋の中心）までの歩数（タイル）。届かなければ null */
  stairsSteps: number | null;
  /** 生成直後の戦う相手の数（商人・壺は数えない） */
  enemies: number;
  /** 生成直後の部屋の陣の数（長蛇・物見は数えない） */
  roomJins: number;
  /** 階にいた秒（ゲーム内時間） */
  seconds: number;
  /** 階で回した step の数と、その合計 ms（生成した step は含めない） */
  steps: number;
  stepMsTotal: number;
  /** この階を作った step の ms（buildFloor 全体を含む）。ランの最初の階は createGame の中なので null */
  genMs: number | null;
  outcome: FloorOutcome;
  /** 倒れた階なら死因の key */
  deathCause: string | null;
}

export interface LayoutRecorder {
  readonly records: LayoutFloorRecord[];
  /** 初めて着いた階で呼ぶ。genMs はその階を作った step の ms */
  beginFloor(state: GameState, genMs: number | null): void;
  /** 上り階段で戻った階など、数えない階に着いたとき（離れるまで step を数えない） */
  skipFloor(): void;
  /** 階の中で回した 1 step（生成した step を除く） */
  noteStep(stepMs: number): void;
  /** 階を離れた・倒れた・ランが終わったとき。数えていない階なら何もしない */
  endFloor(state: GameState, outcome: FloorOutcome, deathCause?: string | null): void;
}

/** 着いた位置から階段までの歩数。階段がまだ無い階（主を倒すと現れるボス階）は最後の部屋の中心まで */
export function stepsToStairs(state: GameState): number | null {
  const map = state.map;
  const stairs = map.tiles.indexOf(Tile.StairsDown);
  const lastRoom = state.rooms[state.rooms.length - 1];
  const goal = stairs >= 0 ? stairs : lastRoom ? tileOf(map, rectCenterPx(lastRoom.rect)) : -1;
  if (goal < 0) return null;
  const steps = distanceField(map, goal)[tileOf(map, state.player.body.pos)] ?? UNREACHABLE;
  return steps === UNREACHABLE ? null : steps;
}

export function createLayoutRecorder(): LayoutRecorder {
  const records: LayoutFloorRecord[] = [];
  let current: LayoutFloorRecord | null = null;
  let enteredAt = 0;
  return {
    records,
    beginFloor(state, genMs) {
      enteredAt = state.time;
      current = {
        layout: state.floorLayout ?? "legacy",
        depth: state.depth,
        stairsSteps: stepsToStairs(state),
        enemies: countCombatants(state.enemies),
        roomJins: state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM).length,
        seconds: 0,
        steps: 0,
        stepMsTotal: 0,
        genMs,
        outcome: "ended",
        deathCause: null,
      };
    },
    skipFloor() {
      current = null;
    },
    noteStep(stepMs) {
      if (!current) return;
      current.steps++;
      current.stepMsTotal += stepMs;
    },
    endFloor(state, outcome, deathCause = null) {
      if (!current) return;
      current.seconds = state.time - enteredAt;
      current.outcome = outcome;
      current.deathCause = deathCause;
      records.push(current);
      current = null;
    },
  };
}

/** 表の行の並び: 8 型 → ボス階の専用の部屋 → 旧生成（生成に失敗した階） */
const LAYOUT_ROWS: readonly FloorLayout[] = [...LAYOUT_KINDS, "lordHall", "legacy"];
/** 死因を並べる数 */
const TOP_CAUSES = 2;

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function fmt(value: number | null, digits: number): string {
  return value === null ? "-" : value.toFixed(digits);
}

function topCauses(records: readonly LayoutFloorRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.outcome !== "died") continue;
    const key = r.deathCause ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return "0";
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_CAUSES);
  return `${total}（${top.map(([key, n]) => `${key} ${n}`).join(" / ")}）`;
}

function layoutRow(layout: FloorLayout, records: readonly LayoutFloorRecord[]): string {
  const floors = records.length;
  const steps = records.reduce((s, r) => s + r.steps, 0);
  const stepMs = steps > 0 ? records.reduce((s, r) => s + r.stepMsTotal, 0) / steps : null;
  const gens = records.flatMap((r) => (r.genMs === null ? [] : [r.genMs]));
  const genMax = gens.length > 0 ? Math.max(...gens) : null;
  const descended = records.filter((r) => r.outcome === "descended").length;
  const stairs = records.flatMap((r) => (r.stairsSteps === null ? [] : [r.stairsSteps]));
  return (
    `| ${layout} | ${floors} | ${fmt(mean(stairs), 0)} | ${fmt(mean(records.map((r) => r.seconds)), 1)} | ` +
    `${fmt(mean(records.map((r) => r.enemies)), 1)} | ${fmt(mean(records.map((r) => r.roomJins)), 1)} | ` +
    `${floors > 0 ? `${Math.round((descended / floors) * 100)}%` : "-"} | ${topCauses(records)} | ` +
    `${fmt(stepMs, 3)} | ${fmt(mean(gens), 1)} / ${fmt(genMax, 1)} |`
  );
}

/** report.md の節 */
export function buildLayoutSection(records: readonly LayoutFloorRecord[]): string[] {
  const lines: string[] = [];
  lines.push("## 階の型ごとの計測（map/layout。初めて着いた階。つまみ: MAP_LAYOUT・JIN.tilesPerJin）");
  lines.push("");
  lines.push(
    "- 歩数 = 着いた位置から階段（ボス階は主の間の中心）までのタイル数。敵 / 陣 = 生成直後（商人・壺を除く）/ 部屋の陣。降りた = 下りの階段で離れた割合",
  );
  lines.push("- 生成 ms = その階を作った step の ms（buildFloor 全体を含む。ランの最初の階は数えない）。地図の生成だけの予算は平均 40ms・最大 80ms（map-gen-impl 2-5）");
  lines.push("");
  lines.push("| 型 | 階 | 階段までの歩数 | 階の秒 | 生成直後の敵 | 陣 | 降りた | 死亡（主な死因） | 1 step ms | 生成 ms 平均 / 最大 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const layout of LAYOUT_ROWS) {
    const group = records.filter((r) => r.layout === layout);
    // 旧生成は生成に失敗した階だけなので、出なければ行を省く
    if (layout === "legacy" && group.length === 0) continue;
    lines.push(layoutRow(layout, group));
  }
  lines.push("");
  return lines;
}
