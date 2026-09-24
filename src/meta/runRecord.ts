import type { GameEvent, StatusSnap } from "../core/events";
import type { GameState } from "../core/state";
import type { StatusBag, StatusKind } from "../core/status";
import { ENEMIES, type EnemyDef } from "../data/enemies";
import { META } from "../data/tuning";
import { insideRoom } from "../system/floor";
import { hasStatus } from "../system/statusEffects";
import type { ComboKey } from "../skills/types";
import { CHAIN_SEPARATOR, CONSTANT_REACTIONS, noteChainStep, noteCombo, noteEnemyKilled, noteEnemySeen, noteReaction } from "./codex";
import { updateLinkHint } from "./linkHint";
import { inferCombo, isLinkId, linkId, noteLink } from "./links";
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
  resolvePendingCombo(state);
  noteFloor(state);
  noteRoom(state);
  for (const ev of batch) noteEvent(state, ev);
  updateLinkHint(state);
}

/**
 * 連携（3 系統）の成立を図鑑・依頼へ記録する。初めての連携（図鑑に無かった）は依頼の「新しい連携」にも数える。
 * 図鑑の既知はラン開始時の写しなので、ゲームの状態・乱数には触れない
 */
export function noteLinkFound(state: GameState, id: string): void {
  if (!isLinkId(id)) return;
  const q = state.questRun;
  q.linkKinds.add(id);
  if (noteLink(state.codexRun.links, id, state.depth, state.time)) q.newLinks.add(id);
}

/** 連鎖の 1 段（system/rules.ts の recordChain から）。2 語目がつながった瞬間を 1 回の連鎖として数える */
export function noteChainRecord(state: GameState, keyword: string, depth: number): void {
  const length = noteChainStep(state.codexRun, keyword, depth);
  if (length === 0) return;
  const c = state.questRun.counters;
  if (length === 2) c.chains += 1;
  c.maxChainLen = Math.max(c.maxChainLen, length);
  const words = state.codexRun.seq?.words;
  if (words !== undefined) noteLinkFound(state, linkId("chain", words.join(CHAIN_SEPARATOR)));
}

/**
 * スキルの連携が成立した（system/skills.ts の announceCombo から）。key を渡されればそのまま記録する。
 * 渡されない（今の呼び出し）ときは、この時点の「直前の発動」を控え、今撃った石が lastCast に入った後
 * （同じステップの noteRunEvents か、同じステップの次の連携の通知）で連携を引き直す
 */
export function noteSkillCombo(state: GameState, key?: ComboKey): void {
  state.questRun.counters.skillCombos += 1;
  resolvePendingCombo(state);
  if (key !== undefined) {
    recordCombo(state, key);
    return;
  }
  const last = state.skills.lastCast;
  state.codexRun.links.pendingCombo = { after: last?.skillKey ?? null, afterAt: last?.at ?? null, clock: state.skills.clock };
}

function recordCombo(state: GameState, key: ComboKey): void {
  noteCombo(state.codexRun, key);
  noteLinkFound(state, linkId("combo", key));
}

/** 控えた連携を、今撃った石（lastCast）から引き直して記録する */
function resolvePendingCombo(state: GameState): void {
  const links = state.codexRun.links;
  const pending = links.pendingCombo;
  if (pending === null) return;
  links.pendingCombo = null;
  const cast = state.skills.lastCast;
  if (cast === null) return;
  const key = inferCombo(state, pending, cast.skillKey, cast.pos);
  if (key !== null) recordCombo(state, key);
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
      // 図鑑は誰が起こした反応でも記録するが、依頼「反応の目録」は自分が起こしたものだけを数える
      noteReactionEvent(state, ev.tag, ev.actor === "player");
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

function noteReactionEvent(state: GameState, tag: string | undefined, byPlayer: boolean): void {
  if (tag === undefined) return;
  noteReaction(state.codexRun, tag);
  noteLinkFound(state, linkId("reaction", tag));
  if (!byPlayer) return;
  const c = state.questRun.counters;
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
    noteLinkFound(state, linkId("reaction", r.key));
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
