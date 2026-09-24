import { type EventActor, type GameEvent, type StatusSnap, happenedWithin } from "../core/events";
import type { Element } from "../core/element";
import { type Rule, type RuleAttackVia, type RuleCondition, type RuleEffect, effectKeyword } from "../core/rules";
import type { Enemy, GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, normalize, sub } from "../core/vec";
import { enemyCombat } from "../data/enemyCombat";
import { BOON, PLAYER, STATUS, SYNERGY, TRIGGER } from "../data/tuning";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { BOONS } from "./boonDefs";
import { isRoamerTarget, slashBase, spawnBoonWave } from "./boonRules";
import { damageEnemy, rollOutgoing } from "./combat";
import { affinityOf, dominantElement, elementShares, enemyElementMul, resolveAttack } from "./elementCombat";
import { engagedRoomIndex } from "./engagement";
import { isFavoredWeapon, jobRules } from "./jobs";
import { addFloatingText, spawnRing } from "./effects";
import { igniteTerrainAt, placeTerrain, terrainAt } from "./terrain";
import { spawnBomb } from "./hazards";
import { applyStatus, enemiesInRadius, findStatus, hasStatus } from "./statusEffects";
import { conditionMet, isNthHit, runEffect } from "./triggers";
import { noteChainRecord, noteRunEvents } from "../meta/runRecord";

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
  noteRunEvents(state, batch);
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
 * 装備スロット → 共鳴 → 誓約 → ジョブ → 祝福の取得順 → スキルスロット順 → 部屋 → 敵 id 順。
 * 装備（tr:）は fireTrigger が即時に照合する。共鳴・誓約・部屋の Rule はまだ無い（置き場ができたらここへ足す）。
 * 敵の Rule はイベントの対象ごとに enemyRulesOf が引く
 */
export function collectRules(state: GameState): Rule[] {
  const out: Rule[] = [];
  out.push(...jobRules(state.job));
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
    case "placeTerrain":
    case "igniteTerrain":
    case "spreadTerrain":
      applyTerrainEffect(state, effect, ev.pos);
      return;
    case "selfStatus":
    case "strike":
    case "wave":
    case "refillDash":
      applyPlayerSideEffect(state, effect, ev, magnitude);
      return;
    default:
      runEffect(
        state,
        { effect: effect.kind, magnitude, duration: effect.duration, count: effect.count, status: effect.status },
        { pos: ev.pos, targetId: ev.targetId },
      );
  }
}

/** 地形の効果（置く・火をつける・広げる）。半径の既定は BOON.ruleTerrainRadius */
function applyTerrainEffect(state: GameState, effect: Readonly<RuleEffect>, pos: Vec): void {
  const radius = effect.radius ?? BOON.ruleTerrainRadius;
  if (effect.kind === "igniteTerrain") {
    igniteTerrainAt(state, pos.x, pos.y, radius);
    return;
  }
  const kind = effect.kind === "spreadTerrain" ? terrainAt(state, pos.x, pos.y) : effect.terrain;
  if (kind === undefined || kind === "none") return;
  placeTerrain(state, pos.x, pos.y, kind, radius, effect.duration);
}

/** 自分への状態・追撃・衝撃波・ダッシュの回数（装備トリガーには無い効果） */
function applyPlayerSideEffect(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  const p = state.player;
  switch (effect.kind) {
    case "selfStatus":
      if (effect.status === undefined) return;
      // self: 拘束上限に数えない付け元（呪いの代償・自分への加護は拘束の予算を食わない）
      applyStatus(
        state,
        { kind: "player" },
        { kind: effect.status, stacks: effect.count ?? 1, duration: effect.duration ?? TRIGGER.defaultDuration, potency: magnitude },
        "self",
      );
      return;
    case "strike":
      strikeTarget(state, ev, magnitude);
      return;
    case "wave":
      spawnBoonWave(state, waveDir(state), magnitude);
      return;
    case "refillDash":
      p.dashChargesLeft = Math.min(state.stats.dashCharges, p.dashChargesLeft + Math.max(1, effect.count ?? 1));
      addFloatingText(state, p.body.pos, BOON.ruleDashRefillText, BOON.ruleTextColor, BOON.ruleTextScale, BOON.ruleTextLife);
      return;
    default:
      return;
  }
}

/** 衝撃波の向き: 振っている向き、振っていなければ向いている方 */
function waveDir(state: GameState): Vec {
  const p = state.player;
  const d = p.attack.phase === "none" ? p.facing : p.attack.dir;
  return normalize(d.x === 0 && d.y === 0 ? p.facing : d);
}

/** 追撃: 対象の敵に素性なしのダメージ（生きていなければ何もしない） */
function strikeTarget(state: GameState, ev: GameEvent, magnitude: number): void {
  const target = liveTarget(state, ev.targetId);
  if (target === undefined) return;
  const out = rollOutgoing(state, target, magnitude, "proc");
  damageEnemy(state, target, out.amount, sub(target.body.pos, state.player.body.pos), 0, { hitstopSteps: 0 });
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
    case "finisher":
      return p.attack.combo >= PLAYER.melee.length - 1;
    case "roomLocked":
      return conditionMet(state, "roomLocked");
    case "depthAtLeast":
      return state.depth >= c.depth;
    case "eventTag":
      return subject.tag === c.tag;
    case "actor":
      return subject.actor === c.actor;
    default:
      return extendedConditionHolds(state, c, subject);
  }
}

/** 2026-09-24 追加の条件（武器種・射撃の型・ジョブ・地形・属性・部屋） */
function extendedConditionHolds(state: GameState, c: RuleCondition, subject: ConditionSubject): boolean {
  const p = state.player;
  switch (c.kind) {
    case "not":
      return !conditionHolds(state, c.condition, subject);
    case "moveset":
      return c.movesets.includes(state.stats.moveset);
    case "shot":
      return c.shots.includes(state.stats.shot);
    case "swingStep":
      return p.attack.step >= c.atLeast;
    case "chargedSwing":
      return p.attack.chargeLevel >= c.atLeast;
    case "charging":
      return p.attack.charging;
    case "branchSwing":
      return p.attack.branch >= 0;
    case "job":
      return c.jobs.includes(state.job);
    case "favoredWeapon":
      return isFavoredWeapon(state.stats, state.job);
    case "selfOnTerrain":
      return terrainMatches(terrainAt(state, p.body.pos.x, p.body.pos.y), c.terrain);
    case "targetOnTerrain":
      return terrainMatches(terrainAt(state, subject.pos.x, subject.pos.y), c.terrain);
    case "targetAffinity":
      return targetAffinity(state, subject, c.via) === c.affinity;
    case "attackElement":
      return attackElement(state, c.via) === c.element;
    case "engagedIn":
      return engagedRoomKindIn(state, c.rooms);
    case "targetRoamer":
      return targetRoamer(state, subject);
    case "floorKind":
      return c.kinds.includes(state.floorKind);
    default:
      return false;
  }
}

function terrainMatches(kind: TerrainKind, want: TerrainKind | "any"): boolean {
  if (want === "any") return kind !== "none";
  return kind === want;
}

/** 対象の敵が via の攻撃をどう受けるか（生きた対象がいなければ neutral） */
function targetAffinity(state: GameState, subject: ConditionSubject, via: RuleAttackVia): "weak" | "resist" | "neutral" {
  const target = liveTarget(state, subject.targetId);
  if (target === undefined) return "neutral";
  const atk = resolveAttack(state.stats, via, false);
  if (atk === null) return "neutral";
  return affinityOf(enemyElementMul(target, elementShares(state.stats, atk, false)));
}

function attackElement(state: GameState, via: RuleAttackVia): Element | undefined {
  const atk = resolveAttack(state.stats, via, false);
  if (atk === null) return undefined;
  return dominantElement(elementShares(state.stats, atk, false))?.element;
}

function engagedRoomKindIn(state: GameState, rooms: readonly string[]): boolean {
  const room = state.rooms[engagedRoomIndex(state)];
  return room !== undefined && rooms.includes(room.kind);
}

/** 対象の敵が徘徊か（判定は boonRules の isRoamerTarget。spawner をここから読むと初期化順の循環を起こす） */
function targetRoamer(state: GameState, subject: ConditionSubject): boolean {
  return subject.targetId !== undefined && isRoamerTarget(state, subject.targetId);
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
  noteChainRecord(state, keyword, depth);
  if (state.chains.length > SYNERGY.chainLog) state.chains.shift();
}
