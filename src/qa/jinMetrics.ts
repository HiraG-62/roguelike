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
  /** 陣ごとの生命の揺らぎ（Jin.hpMul。JIN.hpSpread の分布が狙いの幅に収まっているかを見る） */
  hpMuls: number[];
}

function emptyBandLists(): Record<DepthBand, number[]> {
  const out = {} as Record<DepthBand, number[]>;
  for (const band of DEPTH_BANDS) out[band] = [];
  return out;
}

export function emptyFloorSpawn(): FloorSpawnTally {
  return { enemiesByBand: emptyBandLists(), roomJins: [], columns: [], jinMembers: [], formations: {}, hpMuls: [] };
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
    t.hpMuls.push(jin.hpMul);
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
    out.hpMuls.push(...t.hpMuls);
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
  lines.push(...buildHpMulSection(t.hpMuls));
  return lines;
}

/** 陣の生命の揺らぎを見るヒストグラムの刻み */
const HP_MUL_BIN = 0.02;

/** 陣ごとの hpMul の分布（JIN.hpSpread。docs/ideas/scaling-impl.md 2-6）。刻みごとの陣の数と平均・範囲 */
export function buildHpMulSection(hpMuls: readonly number[]): string[] {
  const lines: string[] = [];
  lines.push("### 陣の生命の揺らぎ（Jin.hpMul の分布。つまみ: JIN.hpSpread）");
  lines.push("");
  if (hpMuls.length === 0) {
    lines.push("観測した陣が無かった。");
    lines.push("");
    return lines;
  }
  const mean = hpMuls.reduce((s, v) => s + v, 0) / hpMuls.length;
  lines.push(`陣 ${hpMuls.length} 個: 平均 ×${mean.toFixed(3)}、範囲 ×${Math.min(...hpMuls).toFixed(3)}〜×${Math.max(...hpMuls).toFixed(3)}`);
  lines.push("");
  const bins = new Map<number, number>();
  for (const v of hpMuls) {
    const bin = Math.floor(v / HP_MUL_BIN + 1e-9);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  lines.push("| hpMul | 陣の数 | 割合 |");
  lines.push("| --- | --- | --- |");
  for (const bin of [...bins.keys()].sort((a, b) => a - b)) {
    const n = bins.get(bin) ?? 0;
    lines.push(`| ×${(bin * HP_MUL_BIN).toFixed(2)}〜${((bin + 1) * HP_MUL_BIN).toFixed(2)} | ${n} | ${pct(n, hpMuls.length)} |`);
  }
  lines.push("");
  return lines;
}

// -----------------------------------------------------------------------------
// 決着の内訳（3b。docs/ideas/jin-impl.md 5 章「決着の内訳」）
// -----------------------------------------------------------------------------

export interface JinSettleTally {
  /** 決着した陣の数（全滅 / 敗走。大将撃破は敗走の内訳） */
  wipe: number;
  rout: number;
  leaderFell: number;
  /** 階を離れた時点で決着していない陣 */
  unsettled: number;
  /** 敗走した敵の行く末（逃げ出した数 = 合流 + 討伐 + 逃げ切り + 階を離れた時点でまだ逃げている） */
  fled: number;
  merged: number;
  killed: number;
  escaped: number;
}

export function emptyJinSettle(): JinSettleTally {
  return { wipe: 0, rout: 0, leaderFell: 0, unsettled: 0, fled: 0, merged: 0, killed: 0, escaped: 0 };
}

/** 階を離れる直前（またはランの終わり）の陣の一覧から決着と敗走の行く末を数える */
export function recordJinSettle(t: JinSettleTally, jins: GameState["jins"]): void {
  for (const jin of jins) {
    if (jin.settledBy === "wipe") t.wipe++;
    else if (jin.settledBy === "rout") t.rout++;
    else t.unsettled++;
    if (jin.leaderFell) t.leaderFell++;
    const r = jin.routTally;
    if (!r) continue;
    t.fled += r.fled;
    t.merged += r.merged;
    t.killed += r.killed;
    t.escaped += r.escaped;
  }
}

function pct(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(0)}%` : "-";
}

/** report.md の節 */
export function buildJinSettleSection(list: readonly JinSettleTally[]): string[] {
  const t = emptyJinSettle();
  for (const x of list) {
    for (const key of Object.keys(t) as (keyof JinSettleTally)[]) t[key] += x[key];
  }
  const settled = t.wipe + t.rout;
  const lines: string[] = [];
  lines.push("## 陣の決着（system/jin.ts。つまみ: JIN.morale.routRatio → leaderBreakRatio → rout.speedMul）");
  lines.push("");
  lines.push(`決着: 全滅 ${t.wipe}（${pct(t.wipe, settled)}）/ 敗走 ${t.rout}（${pct(t.rout, settled)}。うち大将撃破 ${t.leaderFell}）、階を離れた時点で未決着 ${t.unsettled}`);
  lines.push(`敗走した敵: 逃げ出した ${t.fled} → 合流 ${t.merged}（${pct(t.merged, t.fled)}）/ 討伐 ${t.killed}（${pct(t.killed, t.fled)}）/ 逃げ切り ${t.escaped}（${pct(t.escaped, t.fled)}）`);
  lines.push("");
  return lines;
}
