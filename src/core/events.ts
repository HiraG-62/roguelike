import type { DamageKind, Enemy, GameState } from "./state";
import type { StatusKind, StatusSource } from "./status";
import type { Vec } from "./vec";
import type { TriggerKind } from "../loot/types";
import { PLAYER, SYNERGY } from "../data/tuning";

/**
 * ゲームイベント（docs/ideas/synergy-web.md 3-2）。各 system は起きたことを pushEvent で積むだけ（pushSfx と同じ作法）。
 * 積んだイベントは step の resolveRules（src/system/rules.ts）が統一ルール（src/core/rules.ts）と照合する。
 * 既存のフック（onBoonKill / fireTrigger 等）は残したまま隣で積む段階的移行。
 * 祝福のうち「〜時: 〜」で書けるものは BoonDef.rules（direct）へ移し、フック側の実装は消した
 */

export const EVENT_KINDS = [
  // ---- 装備トリガー（TriggerKind）と同じ名前。everyNthMeleeHit は onMeleeHit + 条件 nthMeleeHit で表す ----
  "onMeleeHit",
  "onShoot",
  "onKill",
  "onJustDodge",
  "onDash",
  "onHurt",
  "onRoomClear",
  "onStagger",
  "onCounter",
  // ---- 統一文法で増えた起点 ----
  "onDashEnd",
  "onRangedHit",
  "onCrit",
  "onBurst",
  "onRoomLock",
  "onReaction",
  "onStatusApplied",
  "onSkillCast",
  "onSkillHit",
  "onEnemyWindup",
  "onEnemyDeath",
  "onTerrainEnter",
  // ---- 既存の祝福のルール文法移行で増えた起点 ----
  /** 近接の振り始め（amount = その段の威力、tag = SWING_TAG の段の種類） */
  "onSwing",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** イベントを起こした側。env は地形・伝播など誰のものでもない出来事 */
export type EventActor = "player" | "enemy" | "env";

/** 出どころ。図鑑の記録と UI の「誰が回したか」に使う */
export interface EventSource {
  kind: "item" | "resonance" | "keystone" | "boon" | "skill" | "modifier" | "enemy" | "room" | "terrain" | "player";
  key: string;
}

/** 撃破時点の状態異常の写し。resolveRules の時点では倒れた敵が配列から消えていることがあるため */
export interface StatusSnap {
  kind: StatusKind;
  stacks: number;
  potency: number;
}

export interface GameEvent {
  kind: EventKind;
  actor: EventActor;
  /** 起きた場所（効果の中心） */
  pos: Vec;
  /** 対象の敵 */
  targetId?: number;
  /** 対象の敵の種類（敵の Rule を引く。倒れた後も引けるように） */
  targetKey?: string;
  /** 対象の敵の状態異常の写し（撃破・死亡のときだけ） */
  targetStatus?: readonly StatusSnap[];
  /** 起こした敵の id（被弾の攻撃者など） */
  sourceId?: number;
  /** 連鎖深さ。0 = 操作や system が直接起こしたもの */
  depth: number;
  source: EventSource;
  /** 付随の key（反応の種類・付いた状態異常・地形の種類・部屋の種類） */
  tag?: string;
  /** スキルスロット（scope: slot の照合用） */
  slot?: number;
  /** イベントの量（振りの威力など）。効果量の基準 eventAmount が読む */
  amount?: number;
}

/** pushEvent に渡す形。depth は照合中かどうかで pushEvent が決める */
export type EventInput = Omit<GameEvent, "depth">;

export interface RecentEvent {
  /** 最後に起きた state.time */
  lastTime: number;
  /** SYNERGY.recentWindow 秒以内に続けて起きた回数 */
  count: number;
}

/** 直近に成立した連鎖（UI の連携表示の材料）。上限 SYNERGY.chainLog 件 */
export interface ChainRecord {
  keyword: string;
  depth: number;
  time: number;
}

/** resolveRules の作業領域 */
export interface RuleRunState {
  /** 照合中の効果が起こすイベントの深さ。0 = 照合中でない */
  depth: number;
  /** 照合中の Rule の持ち主。効果が起こしたイベントの出どころに使う */
  owner: EventSource | null;
  /** 語ごとの今の窓での発動回数（SYNERGY.keywordBudget） */
  keywordUse: Map<string, number>;
  /** 語の窓の残り秒 */
  keywordWindowLeft: number;
  /** 前ステップでプレイヤーが立っていた地形（onTerrainEnter の差分検出） */
  playerTerrain: string;
}

export function createRuleRunState(): RuleRunState {
  return { depth: 0, owner: null, keywordUse: new Map(), keywordWindowLeft: SYNERGY.keywordWindow, playerTerrain: "none" };
}

/** 装備トリガーの起点 → イベントの種類。everyNthMeleeHit は近接命中として受ける */
export function triggerEventKind(kind: TriggerKind): EventKind {
  return kind === "everyNthMeleeHit" ? "onMeleeHit" : kind;
}

/** 敵を対象にしたイベントの共通部分。withStatus は撃破・死亡のとき（倒れた後も状態異常を読めるように写す） */
export function enemyTarget(e: Enemy, withStatus = false): Pick<GameEvent, "pos" | "targetId" | "targetKey" | "targetStatus"> {
  const base = { pos: { ...e.body.pos }, targetId: e.id, targetKey: e.defKey };
  if (!withStatus) return base;
  const targetStatus = e.status.effects
    .filter((s) => s.time > 0)
    .map((s) => ({ kind: s.kind, stacks: s.stacks, potency: s.potency }));
  return { ...base, targetStatus };
}

/**
 * イベントを積む。照合中（resolveRules が効果を実行している間）は深さ +1 で次ステップへ持ち越す。
 * 同ステップで再帰させないので、環が回っても 1 ステップに 1 段しか進まない（決定的）
 */
export function pushEvent(state: GameState, input: EventInput): void {
  const run = state.ruleRun;
  const ev: GameEvent = { ...input, depth: run.depth, source: run.owner ?? input.source };
  noteRecent(state, ev.kind);
  if (run.depth > 0) {
    if (state.pendingEvents.length < SYNERGY.maxPendingEvents) state.pendingEvents.push(ev);
    return;
  }
  if (state.events.length < SYNERGY.maxEventsPerStep) state.events.push(ev);
}

/** 条件 recent と UI 用の直近記録。窓の外なら数え直す */
function noteRecent(state: GameState, kind: EventKind): void {
  const prev = state.recent[kind];
  const inWindow = prev !== undefined && state.time - prev.lastTime <= SYNERGY.recentWindow;
  state.recent[kind] = { lastTime: state.time, count: inWindow ? prev.count + 1 : 1 };
}

/** 直近 within 秒に kind が起きたか（今のイベントを含む） */
export function happenedWithin(state: GameState, kind: EventKind, within: number): boolean {
  const r = state.recent[kind];
  return r !== undefined && state.time - r.lastTime <= within;
}

// -----------------------------------------------------------------------------
// system から 1 行で積むための組み立て（呼び出し側の差分を 1 行に保つ）
// -----------------------------------------------------------------------------

/** プレイヤーの操作が直接起こした出来事の出どころ */
export function playerSource(key: string): EventSource {
  return { kind: "player", key };
}

/** 敵への命中: 近接 / 射撃 / スキル / 会心をそれぞれ積む（proc は起点にしない。装備トリガーと同じ線引き） */
export function pushHitEvents(state: GameState, enemy: Enemy, kind: DamageKind, skill: boolean, crit: boolean): void {
  const target = enemyTarget(enemy);
  const source = skill ? { kind: "skill" as const, key: kind } : playerSource(kind);
  if (kind === "melee") pushEvent(state, { kind: "onMeleeHit", actor: "player", source, ...target });
  if (kind === "ranged") pushEvent(state, { kind: "onRangedHit", actor: "player", source, ...target });
  if (skill) pushEvent(state, { kind: "onSkillHit", actor: "player", source, ...target });
  if (crit && kind !== "proc") pushEvent(state, { kind: "onCrit", actor: "player", source, ...target });
}

/** 撃破: プレイヤーの撃破（onKill）と敵の死（onEnemyDeath）。倒れた瞬間の状態異常を写す */
export function pushKillEvents(state: GameState, enemy: Enemy): void {
  const target = enemyTarget(enemy, true);
  pushEvent(state, { kind: "onKill", actor: "player", source: playerSource("kill"), ...target });
  pushEvent(state, { kind: "onEnemyDeath", actor: "enemy", source: { kind: "enemy", key: enemy.defKey }, ...target });
}

/** 状態異常が付いた。enemy が null ならプレイヤーに付いた */
export function pushStatusEvent(state: GameState, enemy: Enemy | null, kind: StatusKind, from: StatusSource): void {
  const actor: EventActor = from === "player" ? "player" : from === "enemy" ? "enemy" : "env";
  const where = enemy === null ? { pos: { ...state.player.body.pos } } : enemyTarget(enemy);
  pushEvent(state, { kind: "onStatusApplied", actor, source: { kind: actor === "env" ? "terrain" : actor, key: kind }, tag: kind, ...where });
}

/** 状態異常の反応（蒸発・砕き…）。enemy が null ならプレイヤーの身に起きた */
export function pushReactionEvent(state: GameState, enemy: Enemy | null, reaction: string): void {
  const where = enemy === null ? { pos: { ...state.player.body.pos } } : enemyTarget(enemy);
  pushEvent(state, { kind: "onReaction", actor: enemy === null ? "enemy" : "player", source: playerSource("reaction"), tag: reaction, ...where });
}

/** onSwing の tag: ダッシュ攻撃 / 最終段（終撃） / それ以外。振り始めの瞬間の段を写す（照合はステップ末なので） */
export const SWING_TAG = { dashStrike: "dashStrike", finisher: "finisher", normal: "normal" } as const;

/** 近接の振り始め。combo は 3 段コンボの段（0 始まり）、damage はその段の威力 */
export function pushSwingEvent(state: GameState, combo: number, dashStrike: boolean, damage: number): void {
  const tag = dashStrike ? SWING_TAG.dashStrike : combo >= PLAYER.melee.length - 1 ? SWING_TAG.finisher : SWING_TAG.normal;
  pushPlayerEvent(state, "onSwing", "swing", { tag, amount: damage });
}

/** プレイヤーの位置で起きた出来事（ダッシュ・ジャスト・射撃・バースト…） */
export function pushPlayerEvent(state: GameState, kind: EventKind, key: string, extra: Partial<EventInput> = {}): void {
  pushEvent(state, { kind, actor: "player", pos: { ...state.player.body.pos }, source: playerSource(key), ...extra });
}
