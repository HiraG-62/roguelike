import type { FloorKind, GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { LINGER } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { damagePlayer, damagePlayerDot } from "./combat";
import { circlesOverlap } from "./physics";
import { reaperAppearAfter } from "./reaper";
import { hasMod } from "./runSetup";
import { pushImpact } from "./impacts";
import { placeTerrain, terrainAt } from "./terrain";
import { pushLog, pushSfx } from "../core/state";

/**
 * 長居の代償（死神以外。docs/ideas/run-expansion.md 5 章）。1 フロアに 1 つ、バイオームで決まる。
 * 死神より先に始まり、同じ階にいるほど悪化する。始まる LINGER.warnMargin 秒前から HUD で予告する
 * - 影の自分: 10 秒前の自分の軌跡をなぞる影。触れると痛い。時間で増える
 * - 天井の崩落: 自分の足元へ予告つきの落石。間隔が縮んでいく（敵にも当たる）
 * - 潮: 開始部屋から水が広がる。満潮後は水の上で溺れる
 */

export type LingerKind = "shadow" | "collapse" | "tide";

export const LINGER_LABEL: Readonly<Record<LingerKind, string>> = {
  shadow: "影の自分",
  collapse: "天井の崩落",
  tide: "潮",
};

export interface LingerState {
  kind: LingerKind | null;
  /** 始まる floorTime */
  startAt: number;
  warned: boolean;
  started: boolean;
  /** 影の自分: 自分の位置の記録（古い順） */
  trail: Vec[];
  trailTimer: number;
  /** 出ている影の数 */
  shadows: number;
  spawnTimer: number;
  /** 崩落: 次の落石までの秒と、今の間隔 */
  collapseTimer: number;
  collapseInterval: number;
  /** 潮: 次に水を広げるまでの秒と、広がる中心 */
  tideTimer: number;
  origin: Vec;
}

export function createLingerState(): LingerState {
  return {
    kind: null,
    startAt: 0,
    warned: false,
    started: false,
    trail: [],
    trailTimer: 0,
    shadows: 0,
    spawnTimer: 0,
    collapseTimer: 0,
    collapseInterval: LINGER.collapseInterval,
    tideTimer: 0,
    origin: { x: 0, y: 0 },
  };
}

const LINGER_BY_BIOME: Readonly<Record<FloorKind, LingerKind>> = {
  rooms: "shadow",
  dark: "shadow",
  ossuary: "shadow",
  cave: "collapse",
  mine: "collapse",
  forge: "collapse",
  swamp: "tide",
  glacier: "tide",
  meadow: "tide",
};

/** 階に入ったとき（buildFloor の最後）に、この階の代償を決める。浅い階は無し（縛り「長居の二重苦」なら常に） */
export function resetLinger(state: GameState): void {
  const linger = createLingerState();
  const doubled = hasMod(state, "doubleLinger");
  state.runEvents.linger = linger;
  if (!doubled && state.depth < LINGER.minDepth) return;
  linger.kind = LINGER_BY_BIOME[state.floorKind];
  linger.startAt = reaperAppearAfter(state) * (doubled ? LINGER.doubleRatio : LINGER.startRatio);
  const start = state.rooms[0];
  linger.origin = start ? rectCenterPx(start.rect) : { ...state.player.body.pos };
}

/** 始まるまでの秒（始まっていれば 0、代償が無ければ null） */
export function lingerTimeLeft(state: GameState): number | null {
  const linger = state.runEvents.linger;
  if (!linger.kind) return null;
  return Math.max(0, linger.startAt - state.floorTime);
}

export function updateLinger(state: GameState, dt: number): void {
  const linger = state.runEvents.linger;
  if (!linger.kind) return;
  if (linger.kind === "shadow") recordTrail(state, linger, dt);
  if (!linger.warned && state.floorTime >= linger.startAt - LINGER.warnMargin) {
    linger.warned = true;
    pushSfx(state, "lingerWarn");
    pushLog(state, `長居の代償「${LINGER_LABEL[linger.kind]}」が近づいている。`, LINGER.shadowColor);
  }
  if (state.floorTime < linger.startAt) return;
  if (!linger.started) begin(state, linger);
  switch (linger.kind) {
    case "shadow":
      tickShadows(state, linger, dt);
      return;
    case "collapse":
      tickCollapse(state, linger, dt);
      return;
    case "tide":
      tickTide(state, linger, dt);
      return;
    default:
      return;
  }
}

function begin(state: GameState, linger: LingerState): void {
  linger.started = true;
  linger.shadows = linger.kind === "shadow" ? 1 : 0;
  linger.spawnTimer = LINGER.shadowInterval;
  pushSfx(state, "reaperWarnPulse");
  pushLog(state, `長居の代償「${LINGER_LABEL[linger.kind ?? "shadow"]}」が始まった。`, LINGER.shadowColor);
}

// -----------------------------------------------------------------------------
// 影の自分
// -----------------------------------------------------------------------------

/** 記録を保つ長さ（一番遅い影のぶん + 余白） */
function trailCapacity(): number {
  return Math.ceil((LINGER.shadowDelay + LINGER.shadowGap * LINGER.shadowMax) / LINGER.trailStep) + 2;
}

function recordTrail(state: GameState, linger: LingerState, dt: number): void {
  linger.trailTimer -= dt;
  if (linger.trailTimer > 0) return;
  linger.trailTimer += LINGER.trailStep;
  linger.trail.push({ ...state.player.body.pos });
  const cap = trailCapacity();
  if (linger.trail.length > cap) linger.trail.splice(0, linger.trail.length - cap);
}

/** 影 k 本目の位置（記録が足りなければ出ない） */
export function shadowPositions(state: GameState): Vec[] {
  const linger = state.runEvents.linger;
  if (linger.kind !== "shadow" || !linger.started) return [];
  const out: Vec[] = [];
  for (let k = 0; k < linger.shadows; k++) {
    const back = Math.round((LINGER.shadowDelay + k * LINGER.shadowGap) / LINGER.trailStep);
    const pos = linger.trail[linger.trail.length - 1 - back];
    if (pos) out.push(pos);
  }
  return out;
}

function tickShadows(state: GameState, linger: LingerState, dt: number): void {
  linger.spawnTimer -= dt;
  if (linger.spawnTimer <= 0 && linger.shadows < LINGER.shadowMax) {
    linger.shadows += 1;
    linger.spawnTimer = LINGER.shadowInterval;
    pushSfx(state, "lingerWarn");
  }
  const body = state.player.body;
  for (const pos of shadowPositions(state)) {
    if (!circlesOverlap(pos.x, pos.y, LINGER.shadowRadius, body.pos.x, body.pos.y, body.radius)) continue;
    // 影は常に触れ得るので、無敵中の接触を JUST 回避の稼ぎ場にしない（死神と同じ）
    damagePlayer(state, LINGER.shadowDamage, pos, undefined, { noJust: true });
  }
}

// -----------------------------------------------------------------------------
// 天井の崩落
// -----------------------------------------------------------------------------

function tickCollapse(state: GameState, linger: LingerState, dt: number): void {
  linger.collapseInterval = Math.max(LINGER.collapseMinInterval, linger.collapseInterval - LINGER.collapseAccel * dt);
  linger.collapseTimer -= dt;
  if (linger.collapseTimer > 0) return;
  linger.collapseTimer = linger.collapseInterval;
  const p = state.player.body.pos;
  const angle = state.rng.next() * Math.PI * 2;
  const r = state.rng.next() * LINGER.collapseSpread;
  pushImpact(state, { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r }, LINGER.collapseRadius, LINGER.collapseTelegraph, LINGER.collapseDamage);
}

// -----------------------------------------------------------------------------
// 潮
// -----------------------------------------------------------------------------

function tickTide(state: GameState, linger: LingerState, dt: number): void {
  linger.tideTimer -= dt;
  if (linger.tideTimer > 0) return;
  linger.tideTimer += LINGER.tideInterval;
  const elapsed = state.floorTime - linger.startAt;
  placeTerrain(state, linger.origin.x, linger.origin.y, "water", elapsed * LINGER.tideSpeed, 0);
  if (elapsed < LINGER.tideFullAfter) return;
  const p = state.player.body.pos;
  if (terrainAt(state, p.x, p.y) === "water") damagePlayerDot(state, LINGER.tideDrownDps * LINGER.tideInterval);
}

/** 満潮（溺れる）か */
export function tideFull(state: GameState): boolean {
  const linger = state.runEvents.linger;
  return linger.kind === "tide" && linger.started && state.floorTime - linger.startAt >= LINGER.tideFullAfter;
}
