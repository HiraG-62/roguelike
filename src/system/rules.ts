import { type EventActor, type EventSource, type GameEvent, type StatusSnap, happenedWithin } from "../core/events";
import type { Element } from "../core/element";
import { type Rule, type RuleAttackVia, type RuleCondition, type RuleEffect, effectKeyword } from "../core/rules";
import { type Enemy, type GameState, allocId } from "../core/state";
import type { StatusKind } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, dist, fromAngle, normalize, scale, sub } from "../core/vec";
import { enemyCombat } from "../data/enemyCombat";
import { BOON, PLAYER, STATUS, SYNERGY, TRIGGER } from "../data/tuning";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { BOONS } from "./boonDefs";
import { isRoamerTarget, isRoamingEnemy, slashBase, spawnBoonWave } from "./boonRules";
import { offerBoonsFromRule } from "./boons";
import { gradeMagnitudeMul, gradedEffect, gradedIcd, ruleOwnerGrade } from "./boonGrade";
import { damageEnemy, healPlayer, healSustained, rollOutgoing } from "./combat";
import { affinityOf, dominantElement, elementShares, enemyElementMul, resolveAttack } from "./elementCombat";
import { engagedRoomIndex } from "./engagement";
import { isFavoredWeapon, jobRules } from "./jobs";
import { addFloatingText, spawnBurst, spawnLine, spawnRing } from "./effects";
import { igniteTerrainAt, placeTerrain, terrainAt } from "./terrain";
import { spawnBomb } from "./hazards";
import { applyStatus, chainLightning, enemiesInRadius, explodeAt, findStatus, hasStatus, removeStatus } from "./statusEffects";
import { dropItem } from "./loot";
import { addPoise } from "./poise";
import { reaperWarning } from "./reaper";
import { dropRune } from "./skills";
import { enemyDef } from "../data/enemies";
import { movesetRules } from "../data/weapons";
import { sustainRules } from "../data/ultimates";
import { ultimateBlocksEnergy } from "./ultimates";
import { conditionMet, isNthHit, runEffect } from "./triggers";
import { gainMana } from "./mana";
import type { TriggerEffectKind } from "../loot/types";
import { noteChainRecord, noteRunEvents } from "../meta/runRecord";
import { statsBulletHas } from "../loot/bullets";

/**
 * 統一ルールの照合（docs/ideas/synergy-web.md 3-3）。step の combo の後・effects の前に 1 回呼ぶ。
 * - 積んだ順のイベントに、固定順の Rule（祝福の取得順 → スキルスロット順 → 対象の敵）を照合する
 * - 効果が起こしたイベントは深さ +1 で次ステップへ（pushEvent が pendingEvents へ積む）。同ステップで再帰しない
 * - 深さ SYNERGY.maxDepth 以上は照合しない。効果量は深さごとに × SYNERGY.chainDecay
 * - ICD は 3 層: Rule ごと（ruleIcd）・語ごとの回数上限（keywordBudget）・敵ごと（StatusBag.procIcd）
 * - direct の Rule（旧フックから移した祝福）は連鎖に数えない: 深さを進めず、減衰・語の上限・深さの上限・連鎖の記録から外す
 * 装備の tr: は fireTrigger がその場で同じ文法（ruleFromTrigger）を照合するので、ここでは集めない（二重発火を防ぐ）
 */

/** 条件の照合に要るイベントの部分。fireTrigger の TriggerContext もこの形で渡せる */
export interface ConditionSubject {
  pos: Vec;
  targetId?: number;
  targetStatus?: readonly StatusSnap[];
  tag?: string;
  actor?: EventActor;
  source?: EventSource;
  amount?: number;
  targetElite?: boolean;
}

const FULL_CIRCLE = Math.PI * 2;
/** 氷の破片の弾と粒子（旧フック boons.ts の shatter と同じ見た目） */
const SHARD_RADIUS = 2;
const SHARD_PARTICLES = 8;
const SHARD_PARTICLE_SPEED = 90;
const SHARD_PARTICLE_LIFE = 0.3;
const SHARD_PARTICLE_SIZE = 1.5;
/** 起爆・解呪の粒と宝物庫の浮き文字（旧フックの焦土・血霧・宝物の鍵と同じ見た目） */
const DETONATE_PARTICLES = 10;
const DETONATE_SPEED = 120;
const DETONATE_LIFE = 0.4;
const DETONATE_SIZE = 2;
const CLEANSE_PARTICLES = 8;
const CLEANSE_SPEED = 60;
const CLEANSE_LIFE = 0.3;
const CLEANSE_SIZE = 1.5;
const VAULT_TEXT_LIFE = 1;

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
  // 同じイベントで起きた group（1 イベントにつき 1 回）。イベントごとに空にする
  const fired = new Set<string>();
  for (const ev of batch) {
    fired.clear();
    for (const rule of list) tryRule(state, rule, ev, fired);
    for (const rule of enemyRulesOf(ev)) tryRule(state, rule, ev, fired);
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
  // 武器種の固有効果（data/weapons.ts の MovesetDef.rules）。ジョブの直後に固定順で足す
  out.push(...movesetRules(state.stats.moveset));
  // 持続中の奥義の固有効果（data/ultimates.ts の SustainDef.rules）。持続中だけ集める
  out.push(...sustainRules(state.player.ultimate.active));
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

function tryRule(state: GameState, rule: Readonly<Rule>, ev: GameEvent, fired: Set<string>): void {
  if (rule.when !== ev.kind || !scopeMatches(rule, ev)) return;
  if (rule.direct === true) {
    tryDirectRule(state, rule, ev, fired);
    return;
  }
  if (ev.depth >= SYNERGY.maxDepth) return;
  if (rule.group !== undefined && fired.has(rule.group)) return;
  if ((state.ruleIcd.get(icdKeyOf(rule)) ?? 0) > 0) return;
  if (!ruleConditionsMet(state, rule.if, ev)) return;
  const keyword = effectKeyword(rule);
  const used = state.ruleRun.keywordUse.get(keyword) ?? 0;
  if (used >= SYNERGY.keywordBudget) return;
  const procTarget = PROC_ICD_EFFECTS.has(rule.then.kind) ? liveTarget(state, ev.targetId) : undefined;
  if (procTarget !== undefined && procTarget.status.procIcd > 0) return;
  // 乱数は照合順に引く。確定（1 以上）なら引かない（Rule を足しても他の乱数列をずらさない）
  if (rule.chance < 1 && !state.rng.chance(rule.chance)) return;
  // 祝福の格（神威）は ICD を縮める。direct（旧フックの回数と揃えたもの）には掛けない
  if (rule.icd > 0) state.ruleIcd.set(icdKeyOf(rule), gradedIcd(rule.icd, ruleOwnerGrade(state, rule.owner)));
  if (rule.group !== undefined) fired.add(rule.group);
  state.ruleRun.keywordUse.set(keyword, used + 1);
  if (procTarget !== undefined) procTarget.status.procIcd = STATUS.onHitIcd;
  runRule(state, rule, ev);
  recordChain(state, keyword, ev.depth);
}

/**
 * 直接の効果（旧フックから移した祝福）。フックはどの深さの出来事でも等倍で起き、語の上限も procIcd も持たなかったので、
 * それと同じに照合する（ICD・確率・group は通常どおり見る）
 */
function tryDirectRule(state: GameState, rule: Readonly<Rule>, ev: GameEvent, fired: Set<string>): void {
  if (rule.group !== undefined && fired.has(rule.group)) return;
  if ((state.ruleIcd.get(icdKeyOf(rule)) ?? 0) > 0) return;
  if (!ruleConditionsMet(state, rule.if, ev)) return;
  if (rule.chance < 1 && !state.rng.chance(rule.chance)) return;
  if (rule.icd > 0) state.ruleIcd.set(icdKeyOf(rule), rule.icd);
  if (rule.group !== undefined) fired.add(rule.group);
  const run = state.ruleRun;
  const prevDepth = run.depth;
  // 深さはイベントのまま・出どころも上書きしない（フックが起こした出来事と同じ扱い。減衰は掛けない）
  run.depth = ev.depth;
  try {
    const grade = ruleOwnerGrade(state, rule.owner);
    applyRuleEffect(state, gradedEffect(rule.then, grade), ev, gradeMagnitudeMul(grade));
  } finally {
    run.depth = prevDepth;
  }
}

/** ICD の鍵（icdKey で複数の Rule が 1 つの ICD を分け合う） */
function icdKeyOf(rule: Readonly<Rule>): string {
  return rule.icdKey ?? rule.id;
}

/** 効果を実行する。この間に積まれたイベントは深さ +1・持ち主の出どころで持ち越される */
function runRule(state: GameState, rule: Readonly<Rule>, ev: GameEvent): void {
  const run = state.ruleRun;
  const prevDepth = run.depth;
  const prevOwner = run.owner;
  run.depth = ev.depth + 1;
  run.owner = rule.owner;
  try {
    // 祝福の格は効果量・半径に掛かる（呪い付き・祝福以外の Rule は並 = ×1）
    const grade = ruleOwnerGrade(state, rule.owner);
    applyRuleEffect(state, gradedEffect(rule.then, grade), ev, SYNERGY.chainDecay ** ev.depth * gradeMagnitudeMul(grade));
  } finally {
    run.depth = prevDepth;
    run.owner = prevOwner;
  }
}

function applyRuleEffect(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, decay: number): void {
  const magnitude = baseMagnitude(state, effect, ev) * decay;
  applyEffectBody(state, effect, ev, magnitude);
  if (effect.text !== undefined) ruleText(state, effect.text, effect.color);
}

function applyEffectBody(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  if (applyVitalEffect(state, effect, magnitude)) return;
  if (applyMigratedEffect(state, effect, ev, magnitude)) return;
  switch (effect.kind) {
    case "spreadStatus":
      spreadStatus(state, effect, ev, magnitude);
      return;
    case "hazardBomb":
      spawnBomb(state, { ...ev.pos }, magnitude, ev.targetId, effect.duration, effect.radius);
      return;
    case "shards":
      spawnShards(state, ev.pos, effect.count ?? BOON.shatterShards, magnitude);
      return;
    case "afflict":
      afflict(state, effect, ev, magnitude);
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
    case "explode":
      // 半径を持つ爆発（爆走・過充填）。半径が無ければ装備トリガーと同じ STATUS.explodeRadius
      if (effect.radius !== undefined || effect.excludeTarget === true) {
        explodeAt(state, ev.pos, effect.radius ?? STATUS.explodeRadius, magnitude, excludedId(effect, ev));
        return;
      }
      runTriggerEffect(state, effect.kind, effect, ev, magnitude);
      return;
    case "chainLightning":
      if (effect.excludeTarget === true) {
        chainLightning(state, ev.pos, magnitude, ev.targetId);
        return;
      }
      runTriggerEffect(state, effect.kind, effect, ev, magnitude);
      return;
    case "healDirect":
    case "ward":
      // applyVitalEffect が扱い済み
      return;
    case "dropRune":
    case "dropItem":
    case "offerBoons":
    case "roomEnemies":
    case "nearbyEnemies":
    case "detonate":
    case "passStatus":
    case "iframes":
    case "reclaim":
    case "resetCombo":
    case "reserveVault":
      // applyMigratedEffect が扱い済み
      return;
    default:
      runTriggerEffect(state, effect.kind, effect, ev, magnitude);
  }
}

/** 移行 第 2 弾で足した効果・既存の効果の「対象の状態異常だけ」版。扱ったら true */
function applyMigratedEffect(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): boolean {
  switch (effect.kind) {
    case "dropRune":
      dropRune(state, ev.pos);
      return true;
    case "dropItem":
      dropItem(state, ev.pos);
      return true;
    case "offerBoons":
      offerBoonsFromRule(state);
      return true;
    case "roomEnemies":
      for (const e of roomEnemiesOf(state, effect, ev)) hitEnemyWith(state, e, effect, magnitude, "poise", ev.pos);
      return true;
    case "nearbyEnemies":
      nearbyEnemies(state, effect, ev, magnitude);
      return true;
    case "detonate":
      detonate(state, effect, ev, magnitude);
      return true;
    case "passStatus":
      passStatus(state, effect, ev);
      return true;
    default:
      return applyMigratedPlayerEffect(state, effect, ev, magnitude);
  }
}

/** 移行 第 2 弾の効果のうち、自分・ラン側へ向くもの（無敵時間・リゲイン・コンボ・宝物庫・解呪・状態異常の延長） */
function applyMigratedPlayerEffect(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): boolean {
  const p = state.player;
  switch (effect.kind) {
    case "iframes":
      p.invulnTimer = Math.max(p.invulnTimer, effect.duration ?? magnitude);
      return true;
    case "reclaim":
      reclaimRegain(state);
      return true;
    case "resetCombo":
      state.combo.count = 0;
      state.combo.timer = 0;
      return true;
    case "reserveVault":
      reserveVault(state, effect, ev.pos);
      return true;
    case "cleanse":
      if (effect.status === undefined) return false;
      // 自分の特定の状態異常だけを消す（血霧の出血）。色があれば自分の位置に粒を散らす
      removeStatus(state, { kind: "player" }, effect.status);
      if (effect.color !== undefined) spawnBurst(state, p.body.pos, effect.color, CLEANSE_PARTICLES, CLEANSE_SPEED, CLEANSE_LIFE, CLEANSE_SIZE);
      return true;
    case "extendStatus":
      if (effect.status === undefined) return false;
      extendTargetStatus(state, ev, effect.status, magnitude);
      return true;
    default:
      return false;
  }
}

/** 対象の status だけを magnitude 秒延ばす（付与時の持続 maxTime まで。燠火） */
function extendTargetStatus(state: GameState, ev: GameEvent, kind: StatusKind, seconds: number): void {
  const target = liveTarget(state, ev.targetId);
  const found = target === undefined ? undefined : findStatus(target.status, kind);
  if (found === undefined) return;
  found.time = Math.min(found.maxTime, found.time + seconds);
}

/** リゲインの取り戻せる分を全て回復する（取り返し） */
function reclaimRegain(state: GameState): void {
  const p = state.player;
  if (p.regainTimer <= 0 || p.regainPool <= 0) return;
  const pool = p.regainPool;
  p.regainPool = 0;
  p.regainStep = 0;
  healPlayer(state, pool);
}

/** 次の階の宝物庫を予約する。予約済みなら何もしない（浮き文字も出さない） */
function reserveVault(state: GameState, effect: Readonly<RuleEffect>, pos: Vec): void {
  const run = state.boonRun;
  if (run.vaultNext) return;
  run.vaultNext = true;
  if (effect.text !== undefined) addFloatingText(state, pos, effect.text, effect.color ?? BOON.ruleTextColor, BOON.ruleTextScale, VAULT_TEXT_LIFE);
}

/** roomEnemies の相手: 徘徊の敵か、イベントの部屋（無ければ交戦中の部屋）の生きた敵 */
function roomEnemiesOf(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent): Enemy[] {
  if (effect.room === "roaming") return state.enemies.filter((e) => e.hp > 0 && isRoamingEnemy(e));
  const index = ev.room ?? engagedRoomIndex(state);
  if (index < 0) return [];
  return state.enemies.filter((e) => e.hp > 0 && e.roomIndex === index);
}

/**
 * 敵 1 体へ効果: status があれば状態異常、無ければ fallback（怯み値 / 素性なしのダメージ）。
 * 状態異常は旧フックの付け方（持続そのまま・procIcd を見ない・付与元 player）
 */
function hitEnemyWith(state: GameState, e: Enemy, effect: Readonly<RuleEffect>, magnitude: number, fallback: "poise" | "damage", from: Vec): void {
  if (effect.status !== undefined) {
    const apply = { kind: effect.status, stacks: effect.count ?? 1, duration: effect.duration ?? TRIGGER.defaultDuration, potency: magnitude };
    applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
    return;
  }
  if (fallback === "poise") {
    addPoise(state, e, magnitude);
    return;
  }
  const out = rollOutgoing(state, e, magnitude, "proc");
  damageEnemy(state, e, out.amount, sub(e.body.pos, from), 0, { hitstopSteps: 0 });
}

/** イベントの位置から半径 radius の敵すべて（対象は除く）。color があれば輪を出す */
function nearbyEnemies(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  const radius = effect.radius ?? TRIGGER.nearbyRadius;
  for (const e of enemiesInRadius(state, ev.pos, radius)) {
    if (e.id === ev.targetId) continue;
    if (effect.onlyWith !== undefined && !hasStatus(e.status, effect.onlyWith)) continue;
    if (effect.skipBoss === true && enemyDef(e.defKey).boss === true) continue;
    hitEnemyWith(state, e, effect, magnitude, "damage", ev.pos);
  }
  if (effect.color !== undefined && effect.quiet !== true) spawnRing(state, ev.pos, radius, effect.color, STATUS.fxLife);
}

/** 半径 radius の敵の status を起爆: 消して、強さ × 残り秒 × magnitude を即時に与える（焦土） */
function detonate(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  const kind = effect.status;
  if (kind === undefined) return;
  const color = effect.color ?? spreadColor(kind);
  for (const e of enemiesInRadius(state, ev.pos, effect.radius ?? TRIGGER.nearbyRadius)) {
    const found = findStatus(e.status, kind);
    if (found === undefined) continue;
    const amount = Math.round(found.potency * found.time * magnitude);
    removeStatus(state, { kind: "enemy", enemy: e }, kind);
    spawnBurst(state, e.body.pos, color, DETONATE_PARTICLES, DETONATE_SPEED, DETONATE_LIFE, DETONATE_SIZE);
    if (amount > 0) damageEnemy(state, e, amount, sub(e.body.pos, ev.pos), 0, { hitstopSteps: 0 });
  }
}

/** 対象が持っていた status を残り時間ごと、半径 radius 内の最も近い敵（同距離は id の小さい方）へ移す（綻び広げ） */
function passStatus(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent): void {
  const kind = effect.status;
  if (kind === undefined) return;
  const time = sourceStatus(state, ev, kind)?.time ?? 0;
  if (time <= 0) return;
  const next = enemiesInRadius(state, ev.pos, effect.radius ?? TRIGGER.nearbyRadius)
    .filter((e) => e.id !== ev.targetId)
    .sort((a, b) => dist(ev.pos, a.body.pos) - dist(ev.pos, b.body.pos) || a.id - b.id)[0];
  if (next === undefined) return;
  applyStatus(state, { kind: "enemy", enemy: next }, { kind, stacks: 1, duration: time, potency: 0 }, "player");
  spawnLine(state, ev.pos, next.body.pos, effect.color ?? BOON.ruleTextColor, STATUS.fxLife);
}

/** explode の excludeTarget */
function excludedId(effect: Readonly<RuleEffect>, ev: GameEvent): number | undefined {
  return effect.excludeTarget === true ? ev.targetId : undefined;
}

/** 装備トリガーと同じ効果（src/system/triggers.ts の runEffect） */
function runTriggerEffect(state: GameState, kind: TriggerEffectKind, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  runEffect(
    state,
    { effect: kind, magnitude, duration: effect.duration, count: effect.count, status: effect.status },
    { pos: ev.pos, targetId: ev.targetId },
  );
}

/**
 * 生命・気力・無敵の効果のうち、装備トリガー（runEffect）と見た目や上限が違うもの。扱ったら true。
 * quiet = 浮き文字を出さない、fill = 上限まで満たす（旧フックの祝福の見た目と量を保つ）
 */
function applyVitalEffect(state: GameState, effect: Readonly<RuleEffect>, magnitude: number): boolean {
  const p = state.player;
  switch (effect.kind) {
    case "restoreMana":
      if (effect.fill === true) {
        // 回収ではなく補充なので manaGainMul を通さず上限へ直接揃える
        p.mana = state.stats.maxMana;
        return true;
      }
      if (effect.quiet !== true) return false;
      gainMana(state, magnitude);
      return true;
    case "heal":
      if (effect.quiet !== true) return false;
      healSustained(state, magnitude, { silent: true });
      return true;
    case "energy":
      // 持続の奥義の最中は gainEnergy と同じく貯めない（満タン補充で持続が終わらなくなるのを防ぐ）
      if (ultimateBlocksEnergy(state)) return effect.fill === true || effect.raw === true;
      if (effect.fill === true) {
        p.energy = p.maxEnergy;
        return true;
      }
      if (effect.raw !== true) return false;
      p.energy = Math.min(p.maxEnergy, p.energy + magnitude);
      return true;
    case "healDirect":
      healPlayer(state, magnitude, { silent: effect.quiet === true });
      return true;
    case "ward":
      p.buffs.invuln = Math.max(p.buffs.invuln, effect.duration ?? magnitude);
      return true;
    default:
      return false;
  }
}

/** 対象（または起こした敵）へ状態異常をそのまま付ける。生きていなければ何もしない */
function afflict(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  if (effect.status === undefined) return;
  const target = liveTarget(state, effect.on === "source" ? ev.sourceId : ev.targetId);
  if (target === undefined) return;
  const apply = { kind: effect.status, stacks: effect.count ?? 1, duration: effect.duration ?? TRIGGER.defaultDuration, potency: magnitude };
  applyStatus(state, { kind: "enemy", enemy: target }, apply, "player");
}

/** 効果の浮き文字（旧フックの「湧水」「結界」など）。自分の頭上に出す */
function ruleText(state: GameState, text: string, color: string | undefined): void {
  addFloatingText(state, state.player.body.pos, text, color ?? BOON.ruleTextColor, BOON.ruleTextScale, BOON.ruleTextLife);
}

/** 氷の破片: pos から全方位へ count 発（祝福の氷砕。素性なしの proc 弾） */
function spawnShards(state: GameState, pos: Vec, count: number, damage: number): void {
  const n = Math.max(1, Math.round(count));
  for (let i = 0; i < n; i++) {
    state.projectiles.push({
      id: allocId(state),
      owner: "player",
      pos: { ...pos },
      vel: scale(fromAngle((FULL_CIRCLE * i) / n), BOON.shatterSpeed),
      radius: SHARD_RADIUS,
      damage,
      life: BOON.shatterLife,
      color: BOON.shatterColor,
      kind: "proc",
      hitIds: new Set(),
      pierceLeft: 0,
    });
  }
  spawnBurst(state, pos, BOON.shatterColor, SHARD_PARTICLES, SHARD_PARTICLE_SPEED, SHARD_PARTICLE_LIFE, SHARD_PARTICLE_SIZE);
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
    case "refillDash": {
      const max = state.stats.dashCharges;
      p.dashChargesLeft = effect.fill === true ? max : Math.min(max, p.dashChargesLeft + Math.max(1, effect.count ?? 1));
      if (effect.quiet !== true) addFloatingText(state, p.body.pos, BOON.ruleDashRefillText, BOON.ruleTextColor, BOON.ruleTextScale, BOON.ruleTextLife);
      return;
    }
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

function baseMagnitude(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent): number {
  const base = scaledMagnitude(state, effect, ev);
  if (effect.statFloor === undefined) return base;
  return Math.max(state.stats[effect.statFloor], base);
}

function scaledMagnitude(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent): number {
  switch (effect.scaleBy) {
    case "slashBase":
      return slashBase(state) * effect.magnitude;
    case "maxHp":
      return state.player.maxHp * effect.magnitude;
    case "eventAmount":
      return (ev.amount ?? 0) * effect.magnitude;
    case "maxEnergy":
      return state.player.maxEnergy * effect.magnitude;
    case "combo":
      return state.combo.count * effect.magnitude;
    case "targetPotency": {
      const snap = effect.status === undefined ? undefined : sourceStatus(state, ev, effect.status);
      return (snap?.potency ?? 0) * effect.magnitude;
    }
    default:
      return effect.magnitude;
  }
}

/**
 * 対象が持っていた状態異常を周囲の敵へ広げる（野火・疫病の形）。強さは元の potency × magnitude。
 * 付与元は player（祝福の野火と同じ扱い。applyStatus が霊力の倍率を掛ける）。
 * inherit なら元のスタック数を引き継ぎ、強さは霊力の倍率を割り戻してから渡す（付け直しで倍率が二重に掛からない）
 */
function spreadStatus(state: GameState, effect: Readonly<RuleEffect>, ev: GameEvent, magnitude: number): void {
  const kind = effect.status;
  if (kind === undefined) return;
  const source = sourceStatus(state, ev, kind);
  if (source === undefined) return;
  const inherit = effect.inherit === true;
  const potency = (inherit ? source.potency / Math.max(Number.EPSILON, state.stats.statusPotencyMul) : source.potency) * magnitude;
  const radius = effect.radius ?? TRIGGER.nearbyRadius;
  const stacks = inherit ? source.stacks : 1;
  const apply = { kind, stacks, duration: effect.duration ?? TRIGGER.defaultDuration, potency };
  for (const e of enemiesInRadius(state, ev.pos, radius)) {
    if (e.id !== ev.targetId) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
  }
  if (effect.quiet !== true) spawnRing(state, ev.pos, radius, effect.color ?? spreadColor(kind), STATUS.fxLife);
}

function spreadColor(kind: StatusKind): string {
  if (kind === "burn") return STATUS.burnColor;
  if (kind === "chill") return STATUS.chillColor;
  return TRIGGER.shockwaveColor;
}

/** 対象の状態異常（強さ・スタック）。撃破の写しがあればそれ、無ければ生きている対象から読む。持っていなければ undefined */
function sourceStatus(state: GameState, ev: GameEvent, kind: StatusKind): StatusSnap | undefined {
  if (ev.targetStatus !== undefined) return ev.targetStatus.find((s) => s.kind === kind);
  const target = liveTarget(state, ev.targetId);
  const found = target === undefined ? undefined : findStatus(target.status, kind);
  return found === undefined ? undefined : { kind, stacks: found.stacks, potency: found.potency, time: found.time };
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

/** 2026-09-24 追加の条件（武器種・銃の弾・ジョブ・地形・属性・部屋） */
function extendedConditionHolds(state: GameState, c: RuleCondition, subject: ConditionSubject): boolean {
  const p = state.player;
  switch (c.kind) {
    case "not":
      return !conditionHolds(state, c.condition, subject);
    case "moveset":
      return c.movesets.includes(state.stats.moveset);
    case "bullet":
      return c.has.some((f) => statsBulletHas(state.stats, f));
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
    case "from":
      return subject.source?.kind === c.source;
    default:
      return migratedConditionHolds(state, c, subject);
  }
}

/** 2026-09-24 追加の条件（祝福の移行 第 2 弾） */
function migratedConditionHolds(state: GameState, c: RuleCondition, subject: ConditionSubject): boolean {
  const p = state.player;
  switch (c.kind) {
    case "amountEvery": {
      const n = subject.amount ?? 0;
      return c.every > 0 && n > 0 && n % c.every === 0;
    }
    case "eventTagIn":
      return subject.tag !== undefined && c.tags.includes(subject.tag);
    case "energyFull":
      return p.energy >= p.maxEnergy;
    case "reaperNear":
      return state.reaper !== null || reaperWarning(state);
    case "swingStruck": {
      const a = p.attack;
      return a.phase === "active" && !p.dashStrike && subject.targetId !== undefined && a.hitIds.has(subject.targetId);
    }
    case "targetElite":
      return targetElite(state, subject);
    case "ultimateActive":
      return p.ultimate.active !== null;
    case "lane":
      return p.attack.lane === c.lane;
    default:
      return false;
  }
}

function targetElite(state: GameState, subject: ConditionSubject): boolean {
  if (subject.targetElite !== undefined) return subject.targetElite;
  const target = liveTarget(state, subject.targetId);
  return target?.elite !== undefined;
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
