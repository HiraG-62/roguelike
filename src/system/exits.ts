import type { GameState, RoomKind, RoomState } from "../core/state";
import { pushLog } from "../core/state";
import { JOBS } from "../data/jobs";
import { BOON, ECONOMY, EXIT, LOOT_DROP, ROOM_KIND } from "../data/tuning";
import { LINEAGE_KEYS, LINEAGE_LABEL, type LineageKey } from "./boonDefs";
import { canTemper, lineageCardsOwned, lineageCardsRemaining, offerBoons, offerTemper } from "./boons";
import { isBossDepth } from "./boss";
import { chapterScale, dropFlask, dropKey, gainCoins, grantEventCoins } from "./economy";
import { dropBonusReward, dropItem } from "./loot";
import { overlapsWall } from "./physics";

/**
 * 出口の予告（docs/ideas/boon-impl.md 2-3、run-arc.md 3 章 A 案）。
 * 分岐路の階段ごとに「降りた先で何が手に入るか」を先に見せる。祝福の出口は系譜を添える。
 * 抽選は planForkStairs（specialRooms.ts）から state.rng で引き、次の階の descend / buildFloor（floor.ts）が確定する。
 * 祝福の 3 択は「祝福の出口を選んだ階」でだけ出る
 */
export type ExitReward =
  | { kind: "boon"; lineage: LineageKey }
  | { kind: "relic" }
  | { kind: "coins" }
  | { kind: "key" }
  | { kind: "flask" }
  | { kind: "danger" }
  | { kind: "temper" }
  | { kind: "none" };

export type ExitKind = ExitReward["kind"];
/** 抽選に掛かる種類（none は予告を出さない階段の印なので抽選しない） */
export type RollableExitKind = Exclude<ExitKind, "none">;

/** 予告の無い印（隠し部屋・案内人の階段）。到着時に何も確定しない */
export const NO_EXIT: ExitReward = { kind: "none" };

/**
 * 抽選の走査順。重みの表（JSON の key 順）に頼らず固定する（同じ seed で同じ結果にするため）
 */
const ROLL_ORDER: readonly RollableExitKind[] = ["boon", "relic", "coins", "key", "flask", "danger", "temper"];
const WEIGHTS: Readonly<Record<RollableExitKind, number>> = EXIT.weights;
const COLORS: Readonly<Record<RollableExitKind, string>> = EXIT.colors;

/** 表示名（体言止め。docs/GLOSSARY.md）。祝福は系譜名を添える */
const KIND_LABEL: Readonly<Record<RollableExitKind, string>> = {
  boon: "祝福",
  relic: "遺物",
  coins: "銭",
  key: "鍵",
  flask: "瓶",
  danger: "危険",
  temper: "錬磨",
};

export function exitLabel(reward: ExitReward): string {
  if (reward.kind === "none") return "";
  if (reward.kind === "boon") return `${KIND_LABEL.boon} ${LINEAGE_LABEL[reward.lineage]}`;
  return KIND_LABEL[reward.kind];
}

/** 予告の表示色。予告の無い階段（none / 未設定）は null */
export function exitColor(reward: ExitReward | undefined): string | null {
  if (reward === undefined || reward.kind === "none") return null;
  return COLORS[reward.kind];
}

// -----------------------------------------------------------------------------
// 抽選（planForkStairs から）
// -----------------------------------------------------------------------------

/** 流儀の専用系譜。JobDef.lineage が足されるまでは（あるいは無い流儀は）null = 重み 1 */
function jobLineageOf(state: GameState): LineageKey | null {
  const def = JOBS[state.job];
  const value: unknown = "lineage" in def ? def.lineage : undefined;
  return LINEAGE_KEYS.find((k) => k === value) ?? null;
}

/** 見習い（ジョブなし）は階段を 1 本多く出し、その分は必ず祝福にする */
export function apprenticeExtraExits(state: GameState): number {
  return state.job === "none" ? EXIT.apprenticeExtraExit : 0;
}

/** 祝福の出口に出せる系譜: 残りの札がある系譜のうち、この階でまだ使っていないもの */
function availableLineages(state: GameState, used: ReadonlySet<LineageKey>): LineageKey[] {
  return LINEAGE_KEYS.filter((l) => !used.has(l) && lineageCardsRemaining(state, l) > 0);
}

function lineageWeight(state: GameState, lineage: LineageKey, jobLineage: LineageKey | null): number {
  const owned = lineageCardsOwned(state, lineage);
  return EXIT.lineageOwnedMul ** owned * (lineage === jobLineage ? EXIT.lineageJobMul : 1);
}

/** 重み付きで 1 つ選ぶ（state.rng を 1 回）。重みが 0 以下だけなら最後の候補 */
function pickWeighted<T>(state: GameState, items: readonly T[], weightOf: (item: T) => number): T | undefined {
  const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
  let roll = state.rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

/**
 * 祝福の出口の系譜（state.rng を 1 回）。候補 = 残りの札がある系譜。重み = 持っている札の数につき lineageOwnedMul 倍
 * × 流儀の専用系譜なら lineageJobMul 倍。used は同じ階の別の祝福の出口が使った系譜（違う系譜にする）。
 * 候補が無ければ null（祝福の出口を出さない）
 */
export function rollExitLineage(state: GameState, used: ReadonlySet<LineageKey> = new Set()): LineageKey | null {
  const candidates = availableLineages(state, used);
  if (candidates.length === 0) return null;
  const job = jobLineageOf(state);
  return pickWeighted(state, candidates, (l) => lineageWeight(state, l, job)) ?? null;
}

function rollBoonReward(state: GameState, used: Set<LineageKey>): ExitReward | null {
  const lineage = rollExitLineage(state, used);
  if (lineage === null) return null;
  used.add(lineage);
  return { kind: "boon", lineage };
}

/** 今の階でこの種類を候補に入れてよいか（並べる規則と出す条件） */
function eligible(state: GameState, kind: RollableExitKind, taken: ReadonlySet<string>, lineages: ReadonlySet<LineageKey>): boolean {
  if (state.depth <= EXIT.firstFloorDepth && !EXIT.firstFloorKinds.includes(kind)) return false;
  if (kind === "boon") return availableLineages(state, lineages).length > 0;
  if (taken.has(kind)) return false;
  if (kind === "flask") return state.player.hp <= state.player.maxHp * EXIT.flaskMaxHpRatio;
  if (kind === "temper") return canTemper(state);
  return true;
}

function rollOneReward(state: GameState, taken: Set<string>, lineages: Set<LineageKey>): ExitReward {
  const kinds = ROLL_ORDER.filter((k) => eligible(state, k, taken, lineages));
  const kind = pickWeighted(state, kinds, (k) => WEIGHTS[k]);
  if (kind === undefined) return NO_EXIT;
  if (kind === "boon") return rollBoonReward(state, lineages) ?? NO_EXIT;
  taken.add(kind);
  return { kind };
}

/**
 * 分岐路の階段 count 本ぶんの報酬を state.rng で引く。
 * - 同じ報酬は並べない（祝福は違う系譜なら並べてよい）。深度 firstFloorDepth 以下は firstFloorKinds だけ
 * - 章ボス階は全部祝福（chapterBossAllBoons）。見習いの増えた階段は必ず祝福
 * - 1 階に祝福を少なくとも 1 つ（boonGuaranteed。祝福を持てる系譜が残っているとき）
 */
export function rollExitRewards(state: GameState, count: number): ExitReward[] {
  if (count <= 0) return [];
  const taken = new Set<string>();
  const lineages = new Set<LineageKey>();
  const allBoon = EXIT.chapterBossAllBoons && isBossDepth(state.depth);
  const forcedTail = Math.min(count, apprenticeExtraExits(state));
  const rewards: ExitReward[] = [];
  for (let i = 0; i < count; i++) {
    const forced = allBoon || i >= count - forcedTail;
    rewards.push((forced ? rollBoonReward(state, lineages) : null) ?? rollOneReward(state, taken, lineages));
  }
  if (EXIT.boonGuaranteed && !rewards.some((r) => r.kind === "boon")) {
    const slot = state.rng.int(0, count - 1);
    const boon = rollBoonReward(state, lineages);
    if (boon) rewards[slot] = boon;
  }
  return rewards;
}

// -----------------------------------------------------------------------------
// 危険（巣窟 / 闘技場 / 試練を 1 つ強制し、制圧報酬を倍にする）
// -----------------------------------------------------------------------------

/** 危険の出口が強制する部屋の種類（巣窟 / 闘技場 / 試練） */
const DANGER_KINDS: readonly RoomKind[] = ["horde", "arena", "challenge"];

function roomTileCount(room: RoomState): number {
  return room.tiles ? room.tiles.size : room.rect.w * room.rect.h;
}

/** 種類ごとに、いま normal の部屋のうちその種類にできるもの（深度・広さの規則は通常の割り当てと同じ） */
function dangerPool(state: GameState, kind: RoomKind, freeRooms: readonly number[]): number[] {
  const minDepth: Readonly<Partial<Record<RoomKind, number>>> = {
    horde: ROOM_KIND.hordeMinDepth,
    arena: ROOM_KIND.extra.arena.minDepth,
    challenge: ROOM_KIND.challengeMinDepth,
  };
  if (state.depth < (minDepth[kind] ?? 0)) return [];
  if (kind !== "horde") return [...freeRooms];
  return freeRooms.filter((i) => {
    const room = state.rooms[i];
    return room !== undefined && roomTileCount(room) >= ROOM_KIND.hordeMinTiles;
  });
}

/**
 * 出口の予告「危険」で降りた階に、危険な部屋を 1 つ用意する（buildFloor の部屋の割り当ての後）。
 * すでに巣窟 / 闘技場 / 試練があればそれに印を付け、無ければ通常の部屋 1 つを作り替える（乱数は作り替えるときだけ 2 回）。
 * 置ける部屋が無ければ何もしない（到着時に銭で代える。applyExitArrival）
 */
export function applyExitDanger(state: GameState, reserved: ReadonlySet<number>): void {
  if (state.pendingExit?.kind !== "danger") return;
  const existing = state.rooms.find((r) => DANGER_KINDS.includes(r.kind));
  if (existing) {
    existing.danger = true;
    return;
  }
  const free = state.rooms.map((_, i) => i).filter((i) => !reserved.has(i) && state.rooms[i]?.kind === "normal");
  const options = DANGER_KINDS.map((kind) => ({ kind, pool: dangerPool(state, kind, free) })).filter((o) => o.pool.length > 0);
  if (options.length === 0) return;
  const option = options[state.rng.int(0, options.length - 1)];
  const index = option?.pool[state.rng.int(0, (option?.pool.length ?? 1) - 1)];
  const room = index === undefined ? undefined : state.rooms[index];
  if (!option || !room) return;
  room.kind = option.kind;
  room.danger = true;
}

/** 危険な部屋の制圧報酬の上乗せ（floor.ts の clearRoom から）。遺物の報酬と銭を (倍率 - 1) 回ぶん足す */
export function applyDangerReward(state: GameState, room: RoomState, center: { x: number; y: number }): void {
  if (room.danger !== true) return;
  const extra = Math.max(0, Math.round(EXIT.dangerRewardMul) - 1);
  for (let i = 0; i < extra; i++) dropBonusReward(state, center);
  grantEventCoins(state, ECONOMY.income.jin * extra);
}

// -----------------------------------------------------------------------------
// 到着（descend / checkStairs から）
// -----------------------------------------------------------------------------

/** 階に着いた足元の少し前（遺物・鍵・瓶を置く点）。壁に重なるなら足元 */
function arrivalSpot(state: GameState): { x: number; y: number } {
  const p = state.player.body.pos;
  const ahead = { x: p.x + LOOT_DROP.arrivalOffset, y: p.y };
  return overlapsWall(state, ahead.x, ahead.y, ECONOMY.coin.radius) ? { x: p.x, y: p.y } : ahead;
}

/** 遺物の出口が通常の到着報酬（dropDepthReward）の代わりになるか */
export function replacesArrivalRelic(reward: ExitReward | undefined): boolean {
  return reward?.kind === "relic";
}

/** 遺物の出口: 到着報酬の遺物を確定で 1 個（揺らぎを広げて） */
function dropExitRelic(state: GameState): void {
  if (!state.rng.chance(EXIT.relicArrivalChance)) return;
  dropItem(state, arrivalSpot(state), EXIT.relicRarityBoost);
}

/** 銭の出口: 初めて着いた階の銭（grantFloorArrival）を coinsMul 倍にする。すでに 1 倍ぶん入っているので差を足す */
function grantExitCoins(state: GameState): void {
  const extra = ECONOMY.income.floor * chapterScale(state.depth) * (EXIT.coinsMul - 1);
  gainCoins(state, Math.round(extra), "floor");
}

/**
 * 到着時に確定する報酬のうち、選択を挟まないもの（初めて着いた階だけ。descend が grantFloorArrival の後に呼ぶ）。
 * 祝福・錬磨の選択は offerArrivalChoices（階段を踏んだときだけ）。危険の部屋づくりは buildFloor の中（applyExitDanger）
 */
export function applyExitArrival(state: GameState, reward: ExitReward | undefined): void {
  switch (reward?.kind) {
    case "relic":
      dropExitRelic(state);
      return;
    case "coins":
      grantExitCoins(state);
      return;
    case "key": {
      const p = arrivalSpot(state);
      dropKey(state, p);
      return;
    }
    case "flask": {
      const p = arrivalSpot(state);
      dropFlask(state, p);
      return;
    }
    case "danger":
      announceDanger(state);
      return;
    default:
      return;
  }
}

/** 危険の部屋を作れた階は知らせる。作れなかった階（部屋が足りない）は銭で代える */
function announceDanger(state: GameState): void {
  if (state.rooms.some((r) => r.danger === true)) {
    pushLog(state, "この階のどこかに危険な部屋がある。", EXIT.colors.danger);
    return;
  }
  grantExitCoins(state);
}

/**
 * 到着時の選択（階段を踏んだときだけ。descend 直呼びのテストや生成処理は止めない）。
 * - 祝福の出口 → 選んだ系譜の 3 択。予告の無い階段（reward 未設定 = 今までの階段）は系譜を絞らない 3 択
 * - 予告なし（none）・祝福以外 → 3 択は出ない。ただし芯の提示（深度 BOON.coreDepth の最初）は出口に関わらず出す
 *   （祝福の出口を選ばなくても芯を逃さない）
 * - 錬磨: 出口の予告「錬磨」・契約が積んだ boonRun.temperQueued を 1 回ずつ。提示が重なるなら祝福の 3 択を先に
 */
export function offerArrivalChoices(state: GameState, reward: ExitReward | undefined, boost: number): void {
  if (reward === undefined) offerBoons(state, boost);
  else if (reward.kind === "boon") offerBoons(state, boost, reward.lineage);
  else if (state.depth === BOON.coreDepth) offerBoons(state, boost);
  if (reward?.kind === "temper") state.boonRun.temperQueued += 1;
  offerQueuedTemper(state);
}

/** 積まれた錬磨を 1 回開く（別の提示が開いている・錬磨できる札が無いときは積んだまま次の階へ） */
function offerQueuedTemper(state: GameState): void {
  if (state.boonRun.temperQueued <= 0 || state.boonChoice !== null || !canTemper(state)) return;
  if (offerTemper(state)) state.boonRun.temperQueued -= 1;
}
