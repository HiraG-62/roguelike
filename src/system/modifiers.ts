import type { DamageContext, MoreMul } from "../core/damage";
import type { Modifier, ModifierPer, PerCounter, RuleCondition } from "../core/rules";
import type { Enemy, GameState } from "../core/state";
import { ultimateDef } from "../data/ultimates";
import { MOVESETS } from "../data/weapons";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { BOONS } from "./boonDefs";
import { keystoneModifiers } from "./keystones";
import { type ConditionSubject, ruleConditionsMet } from "./rules";
import { enemiesInRadius, statusStacks } from "./statusEffects";

/**
 * 常時の増・倍と「〜につき」（Modifier。docs/ideas/scaling-impl.md 2-8）。
 * イベントを待つ Rule と違い、与ダメ・怯み値の計算（system/damageMods.ts）がその都度ここを読む。
 * - 集める順は collectRules と同じ固定順（装備 → 誓約 → ジョブ → 武器種 → 持続の奥義 → 祝福の取得順 → スキルスロット順）
 * - 対象の敵を見る条件・数え方は、対象がいない 1 撃（見積もり・敵のいない試し撃ち）では効かない
 */

/** 評価の結果。increased は 1 + Σ増 の Σ に足す量、more は倍の列（出所 "mod:<id>"） */
export interface ModifierResult {
  increased: number;
  more: MoreMul[];
}

/** 何の量に掛けるか。damage = 与ダメ（tag が 1 撃のタグに合うもの）/ poise = 怯み値（tag: "poise" だけ） */
type ModifierTarget = { kind: "damage"; tags: DamageContext["tags"] } | { kind: "poise" };

const PERCENT = 100;
const TENTHS = 10;
const NO_MODIFIERS: readonly Modifier[] = [];

/** 今のビルドが持つ Modifier を固定順で集める（決定性: 同じ状態なら同じ順） */
export function collectModifiers(state: GameState): Modifier[] {
  const out: Modifier[] = [...state.stats.modifiers];
  out.push(...keystoneModifiers(state.stats.keystones));
  out.push(...(MOVESETS[state.stats.moveset]?.modifiers ?? NO_MODIFIERS));
  out.push(...sustainModifiers(state.player.ultimate.active));
  for (const key of state.boons) out.push(...(BOONS[key].modifiers ?? NO_MODIFIERS));
  const rs = state.skills;
  for (let slot = 0; slot < rs.slots.length; slot++) {
    const stone = stoneInSlot(rs.profile, slot);
    if (stone) out.push(...(SKILL_DEFS[stone.skillKey].modifiers ?? NO_MODIFIERS));
  }
  return out;
}

/** 持続中の奥義の Modifier（持続中だけ） */
function sustainModifiers(active: string | null): readonly Modifier[] {
  if (active === null) return NO_MODIFIERS;
  const def = ultimateDef(active);
  return def?.kind === "sustain" ? (def.sustain.modifiers ?? NO_MODIFIERS) : NO_MODIFIERS;
}

/**
 * この 1 撃の与ダメに掛かる増・倍。list を渡せばそれだけを評価する（テスト・見本用。省略時は collectModifiers）
 */
export function applyModifiers(
  state: GameState,
  ctx: Pick<DamageContext, "tags">,
  enemy: Enemy | null,
  list?: readonly Modifier[],
): ModifierResult {
  return evaluate(state, { kind: "damage", tags: ctx.tags }, enemy, list ?? collectModifiers(state));
}

/** 怯み値に掛かる増・倍（tag: "poise" だけ） */
export function applyPoiseModifiers(state: GameState, enemy: Enemy | null, list?: readonly Modifier[]): ModifierResult {
  return evaluate(state, { kind: "poise" }, enemy, list ?? collectModifiers(state));
}

/**
 * 相手を選ばない Modifier だけで見た、そのタグの 1 撃の増・倍（祝福の威力の見積もり slashBase 用）。
 * 対象の敵を見る条件・数え方を持つものは入れない（殴る相手で変わるので見積もりに混ぜない）
 */
export function estimateModifiers(state: GameState, tag: Exclude<Modifier["tag"], "all">, list?: readonly Modifier[]): ModifierResult {
  return evaluate(state, { kind: "damage", tags: new Set([tag]) }, null, list ?? collectModifiers(state));
}

function evaluate(state: GameState, target: ModifierTarget, enemy: Enemy | null, list: readonly Modifier[]): ModifierResult {
  const out: ModifierResult = { increased: 0, more: [] };
  if (list.length === 0) return out;
  let subject: ConditionSubject | null = null;
  for (const m of list) {
    if (!tagMatches(m, target)) continue;
    if (enemy === null && needsTarget(m)) continue;
    subject ??= conditionSubject(state, enemy);
    if (!ruleConditionsMet(state, m.if, subject)) continue;
    addModifier(state, m, enemy, out);
  }
  return out;
}

function tagMatches(m: Readonly<Modifier>, target: ModifierTarget): boolean {
  if (target.kind === "poise") return m.tag === "poise";
  if (m.tag === "poise") return false;
  return m.tag === "all" || target.tags.has(m.tag);
}

function addModifier(state: GameState, m: Readonly<Modifier>, enemy: Enemy | null, out: ModifierResult): void {
  const value = m.per === undefined ? null : perValue(state, m.amount, m.per, enemy);
  if (m.kind === "increased") {
    out.increased += value ?? m.amount;
    return;
  }
  const mul = value === null ? m.amount : 1 + value;
  if (mul !== 1) out.more.push({ source: `mod:${m.id}`, label: m.label ?? m.owner.key, mul });
}

/** 「〜につき」の効き: amount × floor(数 / every) を cap で切る */
function perValue(state: GameState, amount: number, per: Readonly<ModifierPer>, enemy: Enemy | null): number {
  const every = per.every !== undefined && per.every > 0 ? per.every : 1;
  const n = Math.floor(countPer(state, per.count, enemy) / every);
  const value = amount * n;
  return per.cap === undefined ? value : Math.min(per.cap, value);
}

/** 「〜につき」の数（評価の瞬間の値）。対象の敵を見る数え方は、対象がいなければ 0 */
export function countPer(state: GameState, counter: PerCounter, enemy: Enemy | null): number {
  const p = state.player;
  switch (counter.kind) {
    case "combo":
      return state.combo.count;
    case "targetStatusKinds":
      return enemy === null ? 0 : activeKinds(enemy.status.effects);
    case "targetStacks":
      return enemy === null ? 0 : statusStacks(enemy.status, counter.status);
    case "selfStatusKinds":
      return activeKinds(p.status.effects);
    case "nearbyEnemies":
      return enemiesInRadius(state, p.body.pos, counter.radius).length;
    case "chainVisits":
      return chainVisitCount(state);
    case "missingHpTenths":
      return p.maxHp > 0 ? Math.floor(((p.maxHp - p.hp) / p.maxHp) * TENTHS) : 0;
    case "stat":
      return statCount(state, counter.stat);
    case "runKills":
      return state.kills;
    case "morale":
      return p.morale.value;
  }
}

/** 付いている（残り秒のある）状態異常の種類数 */
function activeKinds(effects: readonly { kind: string; time: number }[]): number {
  return new Set(effects.filter((e) => e.time > 0).map((e) => e.kind)).size;
}

/** 照合中の Rule の効果が起こした 1 撃なら、この連鎖で訪れた敵の数。操作や system の 1 撃は 0 */
function chainVisitCount(state: GameState): number {
  const run = state.ruleRun;
  if (run.owner === null) return 0;
  return new Set(run.visits).size;
}

/** 転じの数。率は %、倍率は 1 を超える分の %、個数・防御はそのまま */
function statCount(state: GameState, stat: Extract<PerCounter, { kind: "stat" }>["stat"]): number {
  const s = state.stats;
  switch (stat) {
    case "critChance":
      return s.critChance * PERCENT;
    case "moveSpeedMul":
      return (s.moveSpeedMul - 1) * PERCENT;
    case "dashCharges":
      return s.dashCharges;
    case "projectileCount":
      return s.projectileCount;
    case "armor":
      return s.armor;
  }
}

/** 条件の照合に渡す相手。状態異常は今殴っている敵から写す（state.enemies に居なくても読めるように） */
function conditionSubject(state: GameState, enemy: Enemy | null): ConditionSubject {
  if (enemy === null) return { pos: state.player.body.pos };
  return {
    pos: enemy.body.pos,
    targetId: enemy.id,
    targetStatus: enemy.status.effects.filter((e) => e.time > 0).map((e) => ({ kind: e.kind, stacks: e.stacks, potency: e.potency, time: e.time })),
    targetElite: enemy.elite !== undefined,
  };
}

/** 対象の敵を見る Modifier か（対象のいない 1 撃では効かせない） */
function needsTarget(m: Readonly<Modifier>): boolean {
  if (m.per !== undefined && (m.per.count.kind === "targetStatusKinds" || m.per.count.kind === "targetStacks")) return true;
  return m.if.some(conditionNeedsTarget);
}

const TARGET_CONDITIONS: ReadonlySet<RuleCondition["kind"]> = new Set<RuleCondition["kind"]>([
  "targetHas",
  "targetOnTerrain",
  "targetAffinity",
  "targetRoamer",
  "targetElite",
  "swingStruck",
]);

function conditionNeedsTarget(c: RuleCondition): boolean {
  if (c.kind === "not") return conditionNeedsTarget(c.condition);
  if (c.kind === "trigger") return c.condition.startsWith("target");
  return TARGET_CONDITIONS.has(c.kind);
}
