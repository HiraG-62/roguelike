import { type GameState, ROAMING_ROOM } from "../core/state";
import { FORMATION_KEYS, FORMATION_LABEL, type FormationKey } from "../data/formations";
import { DEPTH_BANDS, type DepthBand, depthBandOf } from "./combatMetrics";

/**
 * 陣の配りの計測（docs/ideas/jin-impl.md 5 章）。state を読むだけで書き換えない。
 * フル QA（simulation.test.ts の runOnce）が階に着いた直後に 1 回ずつ数え、report.md の 1 節にする。
 * 総数の目標（深度 1〜3 で 80〜100 体）と、陣の数・陣あたり人数・陣形の出現数を見て JIN のつまみを合わせる
 */

export interface FloorSpawnTally {
  /** 深度帯ごとの、生成直後の敵の総数（1 階 1 値） */
  enemiesByBand: Record<DepthBand, number[]>;
  /** 階ごとの部屋の陣の数 */
  roomJins: number[];
  /** 階ごとの長蛇の本数 */
  columns: number[];
  /** 部屋の陣ごとの人数 */
  jinMembers: number[];
  formations: Partial<Record<FormationKey, number>>;
}

export function emptyFloorSpawn(): FloorSpawnTally {
  return { enemiesByBand: { "1-2": [], "3-5": [], "6+": [] }, roomJins: [], columns: [], jinMembers: [], formations: {} };
}

/** 階に着いた直後の敵と陣を数える */
export function recordFloorSpawn(t: FloorSpawnTally, state: GameState): void {
  t.enemiesByBand[depthBandOf(state.depth)].push(state.enemies.length);
  const members = new Map<number, number>();
  for (const e of state.enemies) {
    if (e.jinId !== undefined) members.set(e.jinId, (members.get(e.jinId) ?? 0) + 1);
  }
  let rooms = 0;
  let columns = 0;
  for (const jin of state.jins) {
    t.formations[jin.formation] = (t.formations[jin.formation] ?? 0) + 1;
    if (jin.roomIndex === ROAMING_ROOM) {
      columns++;
      continue;
    }
    rooms++;
    t.jinMembers.push(members.get(jin.id) ?? 0);
  }
  t.roomJins.push(rooms);
  t.columns.push(columns);
}

function mergeFloorSpawn(list: readonly FloorSpawnTally[]): FloorSpawnTally {
  const out = emptyFloorSpawn();
  for (const t of list) {
    for (const band of DEPTH_BANDS) out.enemiesByBand[band].push(...t.enemiesByBand[band]);
    out.roomJins.push(...t.roomJins);
    out.columns.push(...t.columns);
    out.jinMembers.push(...t.jinMembers);
    for (const key of FORMATION_KEYS) {
      const n = t.formations[key];
      if (n !== undefined) out.formations[key] = (out.formations[key] ?? 0) + n;
    }
  }
  return out;
}

function avg(values: readonly number[]): string {
  if (values.length === 0) return "-";
  return (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1);
}

function range(values: readonly number[]): string {
  if (values.length === 0) return "-";
  return `${Math.min(...values)}〜${Math.max(...values)}`;
}

/** report.md の節 */
export function buildFloorSpawnSection(list: readonly FloorSpawnTally[]): string[] {
  const t = mergeFloorSpawn(list);
  const lines: string[] = [];
  lines.push("## 陣の配り（生成直後。system/jinSpawn.ts。目標: 深度 1〜3 で 80〜100 体）");
  lines.push("");
  lines.push("| 深度帯 | 観測した階 | 敵の総数 平均 | 範囲 |");
  lines.push("| --- | --- | --- | --- |");
  for (const band of DEPTH_BANDS) {
    const values = t.enemiesByBand[band];
    lines.push(`| ${band} | ${values.length} | ${avg(values)} | ${range(values)} |`);
  }
  lines.push("");
  lines.push(`部屋の陣 / 階: 平均 ${avg(t.roomJins)}（${range(t.roomJins)}）、長蛇 / 階: 平均 ${avg(t.columns)}、陣あたり人数: 平均 ${avg(t.jinMembers)}（${range(t.jinMembers)}）`);
  const formations = FORMATION_KEYS.filter((k) => (t.formations[k] ?? 0) > 0).map((k) => `${FORMATION_LABEL[k]} ${t.formations[k]}`);
  lines.push(`陣形の出現数: ${formations.length > 0 ? formations.join(" / ") : "-"}`);
  lines.push("");
  return lines;
}
