import { type EventActor, type GameEvent, type StatusSnap, happenedWithin } from "../core/events";
import { type Rule, type RuleCondition, type RuleEffect, effectKeyword } from "../core/rules";
import type { Enemy, GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import type { Vec } from "../core/vec";
import { enemyCombat } from "../data/enemyCombat";
import { STATUS, SYNERGY, TRIGGER } from "../data/tuning";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { BOONS } from "./boonDefs";
import { slashBase } from "./boonRules";
import { spawnRing } from "./effects";
import { spawnBomb } from "./hazards";
import { applyStatus, enemiesInRadius, findStatus, hasStatus } from "./statusEffects";
import { conditionMet, isNthHit, runEffect } from "./triggers";

/**
 * 統一ルールの照合（docs/ideas/synergy-web.md 3-3）。step の combo の後・effects の前に 1 回呼ぶ。
 * - 積んだ順のイベントに、固定順の Rule（祝福の取得順 → スキルスロット順 → 対象の敵）を照合する
 * - 効果が起こしたイベントは深さ +1 で次ステップへ（pushEvent が pendingEvents へ積む）。同ステップで再帰しない
 * - 深さ SYNERGY.maxDepth 以上は照合しない。効果量は深さごとに × SYNERGY.chainDecay
 * - ICD は 3 層: Rule ごと（ruleIcd）・語ごとの回数上限（keywordBudget）・敵ごと（StatusBag.procIcd）
 * 装備の tr: は fireTrigger がその場で同じ文法（ruleFromTrigger）を照合するので、ここでは集めない（二重発火を防ぐ）
 */

/** 条件の照合に要るイベントの部分。fireTrigger の TriggerContext もこの形で渡せる */
export interface ConditionSubject {
  pos: Vec;
  targetId?: number;
  targetStatus?: readonly StatusSnap[];
  tag?: string;
  actor?: EventActor;
}

/** 敵ごとの procIcd を使う効果（対象の敵へ状態異常を入れるもの） */
const PROC_ICD_EFFECTS: ReadonlySet<RuleEffect["kind"]> = new Set<RuleEffect["kind"]>(["inflict", "extendStatus"]);

export function resolveRules(state: GameState, dt: number, rules?: readonly Rule[]): void {
  tickRuleClocks(state, dt);
  // 持ち越し（前ステップの効果が起こしたもの）を先に、今ステップのイベントを後に
  const batch = state.pendingEvents.length > 0 ? [...state.pendingEvents, ...state.events] : state.events;
  state.events = [];
  state.pendingEvents = [];
  if (batch.length === 0 || state.status !== "playing") return;
  const list = rules ?? collectRules(state);
  for (const ev of batch) {
    if (ev.depth >= SYNERGY.maxDepth) continue;
    for (const rule of list) tryRule(state, rule, ev);
    for (const rule of enemyRulesOf(ev)) tryRule(state, rule, ev);
  }
}

/**
 * 今のビルドが持つ Rule を固定順で集める（決定性: 同じ状態なら同じ順）。
 * 装備スロット → 共鳴 → 誓約 → 祝福の取得順 → スキルスロット順 → 部屋 → 敵 id 順。
 * 装備（tr:）は fireTrigger が即時に照合する。共鳴・誓約・部屋の Rule はまだ無い（置き場ができたらここへ足す）。
 * 敵の Rule はイベントの対象ごとに enemyRulesOf が引く
 */
export function collectRules(state: GameState): Rule[] {
  const out: Rule[] = [];
  for (const key of state.boons) out.push(...(BOONS[key].rules ?? []));
  const rs = state.skills;
  for (let slot = 0; slot < rs.slots.length; slot++) {
    const stone = stoneInSlot(rs.profile, slot);
    if (stone) out.push(...bindToSlot(SKILL_DEFS[stone.skillKey].rules ?? [], slot));
    for (const m of rs.slots[slot]?.modifiers ?? []) out.push(...bindToSlot(MODIFIERS[m].rules ?? [], slot));
  }
  return out;
}

/** スキル石・刻印符の Rule は自分のスロットの発動が起こしたイベントだけを食う。id もスロットで分ける */
function bindToSlot(rules: readonly Rule[], slot: number): Rule[] {
  return rules.map((r) => ({ ...r, id: `${r.id}@${slot}`, scope: r.scope.kind === "any" ? { kind: "slot", slot } : r.scope }));
}

/** 対象の敵の Rule（src/data/enemyCombat.ts）。ICD は個体ごと */
function enemyRulesOf(ev: GameEvent): Rule[] {
  if (ev.targetKey === undefined) return [];
  const rules = enemyCombat(ev.targetKey).rules;
  if (rules === undefined || rules.length === 0) return [];
  return rules.map((r) => ({ ...r, id: `${r.id}#${ev.targetId ?? -1}` }));
}

function scopeMatches(rule: Readonly<Rule>, ev: GameEvent): boolean {
  switch (rule.scope.kind) {
    case "any":
      return true;
    case "slot":
      return ev.slot === rule.scope.slot;
    case "skill":
      return ev.source.kind === "skill" && ev.source.key === rule.scope.key;
  }
}

function tryRule(state: GameState, rule: Readonly<Rule>, ev: GameEvent): void {
  if (rule.when !== ev.kind || !scopeMatches(rule, ev)) return;
  if ((state.ruleIcd.get(rule.id) ?? 0) > 0) return;
  if (!ruleConditionsMet(state, rule.if, ev)) return;
  const keyword = effectKeyword(rule);
  const used = state.ruleRun.keywordUse.get(keyword) ?? 0;
  if (used >= SYNERGY.keywordBudget) return;
  const procTarget = PROC_ICD_EFFECTS.has(rule.then.kind) ? liveTarget(state, ev.targetId) : undefined;
  if (procTarget !== undefined && procTarget.status.procIcd > 0) return;
  // 乱数は照合順に引く。確定（1 以上）なら引かない（Rule を足しても他の乱数列をずらさない）
  if (rule.chance < 1 && !state.rng.chance(rule.chance)) return;
  if (rule.icd > 0) state.ruleIcd.set(rule.id, rule.icd);
  state.ruleRun.keywordUse.set(keyword, used + 1);
  if (procTarget !== undefined) procTarget.status.procIcd = STATUS.onHitIcd;
  runRule(state, rule, ev);
  recordChain(state, keyword, ev.depth);
}

/** 効果を実行する。この間に積まれたイベントは深さ +1・持ち主の出どころで持ち越される */
function runRule(state: GameState, rule: Readonly<Rule>, ev: GameEvent): void {
  const run = state.ruleRun;
  const prevDepth = run.depth;
  const prevOwner = run.owner;
  run.depth = ev.depth + 1;
  run.owner = rule.owner;
  try {
    applyRuleEffect(state, rule.then, ev, SYNERGY.chainDecay ** ev.depth);
  } finally {
    run.depth = prevDepth;
    run.owner = prevOwner;
  }
}

function applyRuleEffect(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, decay: number): void {
  const magnitude = baseMagnitude(state, effect) * decay;
  switch (effect.kind) {
    case "spreadStatus":
      spreadStatus(state, effect, ev, magnitude);
      return;
    case "hazardBomb":
      spawnBomb(state, { ...ev.pos }, magnitude, ev.targetId, effect.duration, effect.radius);
      return;
    default:
      runEffect(
        state,
        { effect: effect.kind, magnitude, duration: effect.duration, count: effect.count, status: effect.status },
        { pos: ev.pos, targetId: ev.targetId },
      );
  }
}

function baseMagnitude(state: GameState, effect: Readonly<RuleEffect>): number {
  if (effect.scaleBy === "slashBase") return slashBase(state) * effect.magnitude;
  return effect.magnitude;
}

/**
 * 対象が持っていた状態異常を周囲の敵へ広げる（野火・疫病の形）。強さは元の potency × magnitude。
 * 付与元は player（祝福の野火と同じ扱い。applyStatus が霊力の倍率を掛ける）
 */
function spreadStatus(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  const kind = effect.status;
  if (kind === undefined) return;
  const potency = sourcePotency(state, ev, kind);
  if (potency === undefined) return;
  const radius = effect.radius ?? TRIGGER.nearbyRadius;
  const apply = { kind, stacks: 1, duration: effect.duration ?? TRIGGER.defaultDuration, potency: potency * magnitude };
  for (const e of enemiesInRadius(state, ev.pos, radius)) {
    if (e.id !== ev.targetId) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
  }
  spawnRing(state, ev.pos, radius, spreadColor(kind), STATUS.fxLife);
}

function spreadColor(kind: StatusKind): string {
  if (kind === "burn") return STATUS.burnColor;
  if (kind === "chill") return STATUS.chillColor;
  return TRIGGER.shockwaveColor;
}

/** 対象の状態異常の強さ。撃破の写しがあればそれ、無ければ生きている対象から読む。持っていなければ undefined */
function sourcePotency(state: GameState, ev: GameEvent, kind: StatusKind): number | undefined {
  if (ev.targetStatus !== undefined) return ev.targetStatus.find((s) => s.kind === kind)?.potency;
  const target = liveTarget(state, ev.targetId);
  return target === undefined ? undefined : findStatus(target.status, kind)?.potency;
}

function liveTarget(state: GameState, id: number | undefined): Enemy | undefined {
  if (id === undefined) return undefined;
  return state.enemies.find((e) => e.id === id && e.hp > 0);
}

// -----------------------------------------------------------------------------
// 条件
// -----------------------------------------------------------------------------

/** すべての条件を満たすか（空なら真）。装備トリガー（fireTrigger）もここを通る */
export function ruleConditionsMet(state: GameState, conditions: readonly RuleCondition[], subject: ConditionSubject): boolean {
  return conditions.every((c) => conditionHolds(state, c, subject));
}

function conditionHolds(state: GameState, c: RuleCondition, subject: ConditionSubject): boolean {
  const p = state.player;
  switch (c.kind) {
    case "trigger":
      return conditionMet(state, c.condition, subject);
    case "nthMeleeHit":
      return isNthHit(p.meleeHitCount, c.every);
    case "targetHas":
      return targetHas(state, subject, c.status);
    case "selfHas":
      return hasStatus(p.status, c.status);
    case "recent":
      return happenedWithin(state, c.event, c.within);
    case "manaFull":
      return conditionMet(state, "manaFull");
    case "manaLow":
      return conditionMet(state, "manaLow");
    case "lowHp":
      return p.hp <= p.maxHp * SYNERGY.lowHpRatio;
    case "comboAbove":
      return state.combo.count >= c.count;
    case "roomLocked":
      return conditionMet(state, "roomLocked");
    case "depthAtLeast":
      return state.depth >= c.depth;
    case "eventTag":
      return subject.tag === c.tag;
    case "actor":
      return subject.actor === c.actor;
  }
}

function targetHas(state: GameState, subject: ConditionSubject, kind: StatusKind): boolean {
  if (subject.targetStatus !== undefined) return subject.targetStatus.some((s) => s.kind === kind);
  const target = liveTarget(state, subject.targetId);
  return target !== undefined && hasStatus(target.status, kind);
}

// -----------------------------------------------------------------------------
// 時計と記録
// -----------------------------------------------------------------------------

/** Rule の ICD と語の窓を進める。Map は id の昇順で回す（決定性の約束。挿入順に依存させない） */
export function tickRuleClocks(state: GameState, dt: number): void {
  const icd = state.ruleIcd;
  if (icd.size > 0) {
    for (const id of [...icd.keys()].sort()) {
      const left = (icd.get(id) ?? 0) - dt;
      if (left <= 0) icd.delete(id);
      else icd.set(id, left);
    }
  }
  const run = state.ruleRun;
  run.keywordWindowLeft -= dt;
  if (run.keywordWindowLeft > 0) return;
  run.keywordUse.clear();
  run.keywordWindowLeft = SYNERGY.keywordWindow;
}

function recordChain(state: GameState, keyword: string, depth: number): void {
  state.chains.push({ keyword, depth, time: state.time });
  if (state.chains.length > SYNERGY.chainLog) state.chains.shift();
}
