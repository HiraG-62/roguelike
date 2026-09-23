import type { GameEvent, StatusSnap } from "../core/events";
import type { GameState } from "../core/state";
import type { StatusBag, StatusKind } from "../core/status";
import { ENEMIES, type EnemyDef } from "../data/enemies";
import { META } from "../data/tuning";
import { insideRoom } from "../system/floor";
import { hasStatus } from "../system/statusEffects";
import { CONSTANT_REACTIONS, noteChainStep, noteEnemyKilled, noteEnemySeen, noteReaction } from "./codex";
import type { QuestCounterKey } from "./quests";

/**
 * ラン中の図鑑・依頼の記録（state.codexRun / state.questRun）。system/rules.ts の resolveRules が
 * 1 ステップぶんのイベントを照合する直前に noteRunEvents を 1 回呼ぶ。
 * 読むだけで、乱数・ゲームの状態には触れない（決定性とリプレイを壊さない）
 */

const ENEMY_BY_KEY: ReadonlyMap<string, EnemyDef> = new Map(ENEMIES.map((d) => [d.key, d]));

/** 撃破時に付いていた状態異常 → 数える依頼の欄 */
const KILL_STATUS_COUNTERS: readonly { kinds: readonly StatusKind[]; counter: QuestCounterKey }[] = [
  { kinds: ["burn", "scorch", "blaze"], counter: "burnKills" },
  { kinds: ["chill", "freeze", "encase"], counter: "chillKills" },
  { kinds: ["poison", "venom"], counter: "poisonKills" },
  { kinds: ["bleed", "hemorrhage"], counter: "bleedKills" },
  { kinds: ["shock", "paralyze"], counter: "shockKills" },
];

/** 部屋の種類 → 制圧で数える依頼の欄 */
const ROOM_CLEAR_COUNTERS: Readonly<Partial<Record<string, QuestCounterKey>>> = {
  horde: "hordesCleared",
  challenge: "challengesCleared",
};

export function noteRunEvents(state: GameState, batch: readonly GameEvent[]): void {
  noteFloor(state);
  noteRoom(state);
  for (const ev of batch) noteEvent(state, ev);
}

/** 連鎖の 1 段（system/rules.ts の recordChain から）。2 語目がつながった瞬間を 1 回の連鎖として数える */
export function noteChainRecord(state: GameState, keyword: string, depth: number): void {
  const length = noteChainStep(state.codexRun, keyword, depth);
  if (length === 0) return;
  const c = state.questRun.counters;
  if (length === 2) c.chains += 1;
  c.maxChainLen = Math.max(c.maxChainLen, length);
}

/** スキルの連携が成立した（system/skills.ts の announceCombo から） */
export function noteSkillCombo(state: GameState): void {
  state.questRun.counters.skillCombos += 1;
}

/** 階の変化（降りた瞬間の無傷・死神）とバイオーム。depth の差分で拾うので floor.ts に手を入れない */
function noteFloor(state: GameState): void {
  const q = state.questRun;
  const c = q.counters;
  state.codexRun.floorKinds.add(state.floorKind);
  c.maxKeystones = Math.max(c.maxKeystones, state.stats.keystones.length);
  if (state.depth !== q.lastDepth) {
    if (state.depth > q.lastDepth) {
      if (q.floorHurt === 0) c.floorsNoHurt += 1;
      if (q.reaperOut) c.reaperEscapes += 1;
    }
    q.floorHurt = 0;
    q.lastDepth = state.depth;
  }
  q.reaperOut = state.reaper !== null;
}

/** 今いる部屋の種類（封鎖しない特別な部屋も拾うため、数ステップごとに位置で見る） */
function noteRoom(state: GameState): void {
  if (state.tick % META.roomSampleTicks !== 0) return;
  const { x, y } = state.player.body.pos;
  const room = state.rooms.find((r) => insideRoom(state, r, x, y, 0));
  if (room) state.codexRun.roomKinds.add(room.kind);
}

function noteEvent(state: GameState, ev: GameEvent): void {
  const c = state.questRun.counters;
  switch (ev.kind) {
    case "onKill":
      noteKill(state, ev);
      return;
    case "onEnemyWindup":
    case "onMeleeHit":
    case "onRangedHit":
    case "onSkillHit":
      noteEnemySeen(state.codexRun, ev.targetKey);
      return;
    case "onStagger":
      noteEnemySeen(state.codexRun, ev.targetKey);
      c.staggers += 1;
      return;
    case "onCounter":
      noteEnemySeen(state.codexRun, ev.targetKey);
      c.counters += 1;
      return;
    case "onHurt":
      if (ev.source.kind === "enemy") noteEnemySeen(state.codexRun, ev.source.key);
      c.hurts += 1;
      state.questRun.floorHurt += 1;
      return;
    case "onJustDodge":
      c.justDodges += 1;
      return;
    case "onCrit":
      c.crits += 1;
      return;
    case "onBurst":
      c.bursts += 1;
      return;
    case "onSkillCast":
      c.skillCasts += 1;
      return;
    case "onShoot":
      // スキルの射撃（source が skill）は「射撃を撃たずに」の対象外
      if (ev.source.kind === "player") c.shots += 1;
      return;
    case "onReaction":
      noteReactionEvent(state, ev.tag);
      return;
    case "onStatusApplied":
      noteStatusApplied(state, ev);
      return;
    case "onRoomClear":
      noteRoomClear(state, ev.tag);
      return;
    case "onRoomLock":
      if (ev.tag !== undefined) state.codexRun.roomKinds.add(ev.tag);
      return;
    default:
      return;
  }
}

function hadStatus(snap: readonly StatusSnap[] | undefined, kinds: readonly StatusKind[]): boolean {
  return snap !== undefined && snap.some((s) => kinds.includes(s.kind));
}

function noteKill(state: GameState, ev: GameEvent): void {
  const key = ev.targetKey;
  if (key === undefined) return;
  const c = state.questRun.counters;
  noteEnemyKilled(state.codexRun, key);
  c.kills += 1;
  for (const rule of KILL_STATUS_COUNTERS) {
    if (hadStatus(ev.targetStatus, rule.kinds)) c[rule.counter] += 1;
  }
  const def = ENEMY_BY_KEY.get(key);
  if (def?.boss) {
    c.bossKills += 1;
    if (c.shots === 0) c.bossNoShot += 1;
  }
  if (def?.lairMaster) c.lairKills += 1;
}

function noteReactionEvent(state: GameState, tag: string | undefined): void {
  if (tag === undefined) return;
  const c = state.questRun.counters;
  noteReaction(state.codexRun, tag);
  state.questRun.reactionKinds.add(tag);
  c.reactions += 1;
  if (tag === "vaporize") c.vaporizes += 1;
}

/** 付いた状態異常の種類（依頼）と、常時の反応（2 つが同時に付いた）の検出 */
function noteStatusApplied(state: GameState, ev: GameEvent): void {
  if (ev.actor === "player" && ev.targetId !== undefined && ev.tag !== undefined) state.questRun.statusKinds.add(ev.tag);
  const bag = statusBagOf(state, ev.targetId);
  if (!bag) return;
  for (const r of CONSTANT_REACTIONS) {
    if (ev.tag !== r.a && ev.tag !== r.b) continue;
    if (!hasStatus(bag, r.a) || !hasStatus(bag, r.b)) continue;
    noteReaction(state.codexRun, r.key);
    state.questRun.reactionKinds.add(r.key);
  }
}

/** 対象の状態異常の袋。対象が無ければプレイヤー、倒れていれば null */
function statusBagOf(state: GameState, targetId: number | undefined): StatusBag | null {
  if (targetId === undefined) return state.player.status;
  return state.enemies.find((e) => e.id === targetId && e.hp > 0)?.status ?? null;
}

function noteRoomClear(state: GameState, tag: string | undefined): void {
  const c = state.questRun.counters;
  c.roomsCleared += 1;
  if (tag === undefined) return;
  state.codexRun.roomKinds.add(tag);
  const counter = ROOM_CLEAR_COUNTERS[tag];
  if (counter !== undefined) c[counter] += 1;
}
