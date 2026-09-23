import { type Enemy, type GameState, allocId, pushSfx } from "../core/state";
import type { StatusApply, StatusKind } from "../core/status";
import { type Vec, angle, fromAngle, normalize, scale, sub } from "../core/vec";
import { PLAYER, STATUS, SYNERGY, TRIGGER } from "../data/tuning";
import { ruleFromTrigger } from "../loot/triggers";
import type { TriggerCondition, TriggeredEffect, TriggerKind } from "../loot/types";
import { ruleConditionsMet } from "./rules";
import { scaled } from "./attributes";
import { damageEnemy, gainEnergy, healPlayer, rollOutgoing } from "./combat";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { gainMana } from "./mana";
import { addPoise } from "./poise";
import { applyBurn, applyChill, applyStatus, chainLightning, enemiesInRadius, explodeAt, hasStatus, removeStatus } from "./statusEffects";
import { afflictionKinds, afflictionList, tickTraitClocks } from "./traitHooks";

/**
 * trigger × condition × effect の条件付き効果を実行する。
 * 同じトリガー定義（stats.triggers の index）ごとに TRIGGER.icd 秒の内部クールダウンを持つ。
 */

export interface TriggerContext {
  pos: Vec;
  targetId?: number;
}

/** 効果の実行に要る部分（統一ルールの RuleEffect からも組める） */
export type EffectParams = Pick<TriggeredEffect, "effect" | "magnitude" | "duration" | "count" | "status">;

const HALF = 0.5;
const BULLET_RADIUS = 2;
const TEXT_COLOR_BUFF = "#ffd75f";
const TEXT_COLOR_INVULN = "#ffffff";
const TEXT_COLOR_MANA = "#80c0ff";
const FULL_CIRCLE = Math.PI * 2;
/** 行動停止系。inflict の 1 回の長さを TRIGGER.inflictHaltMax で抑える */
const HALT_KINDS: ReadonlySet<StatusKind> = new Set<StatusKind>(["freeze", "paralyze", "fear"]);
/** extendStatus で延ばさないもの（行動停止を延命させない・怯み値の系統は触らない） */
const NO_EXTEND: ReadonlySet<StatusKind> = new Set<StatusKind>(["stagger", "guarded", "freeze", "paralyze", "fear"]);

/**
 * トリガーの ICD を装備変更で混線させないためのキー。
 * index だけだと装備入れ替えで同じ index が全く別のトリガーになったとき、
 * 古い ICD を誤って引き継いでしまうため、トリガー内容（trigger/condition/effect/every）も混ぜる。
 */
function triggerCooldownKey(t: TriggeredEffect, index: number): string {
  return `${t.trigger}:${t.condition}:${t.effect}:${t.every ?? ""}:${index}`;
}

/**
 * 装備トリガーは統一ルール（ruleFromTrigger）に読み替えて条件を照合する。
 * 発火は今まで通りその場（resolveRules を待たない）: 既存の手触りと乱数の消費順を変えないため
 */
export function fireTrigger(state: GameState, kind: TriggerKind, ctx: TriggerContext): void {
  if (state.status !== "playing") return;
  // 統一ルールの効果の中で起きた連鎖は深さ上限で止める（照合中でなければ深さは 0）
  if (state.ruleRun.depth >= SYNERGY.maxDepth) return;
  const p = state.player;
  state.stats.triggers.forEach((t, index) => {
    if (t.trigger !== kind) return;
    const key = triggerCooldownKey(t, index);
    if ((p.triggerCooldowns.get(key) ?? 0) > 0) return;
    const rule = ruleFromTrigger(t, index);
    if (!ruleConditionsMet(state, rule.if, ctx)) return;
    if (!state.rng.chance(rule.chance)) return;
    p.triggerCooldowns.set(key, rule.icd);
    runEffect(state, t, ctx);
  });
}

export function isNthHit(count: number, every: number | undefined): boolean {
  if (every === undefined || every <= 0) return false;
  return count > 0 && count % every === 0;
}

/** 起点の対象の敵（撃破時は倒れた敵もまだ配列に残っている） */
function targetOf(state: GameState, ctx: TriggerContext | undefined): Enemy | undefined {
  if (ctx?.targetId === undefined) return undefined;
  return state.enemies.find((e) => e.id === ctx.targetId);
}

export function conditionMet(state: GameState, condition: TriggerCondition, ctx?: TriggerContext): boolean {
  const p = state.player;
  switch (condition) {
    case "always":
      return true;
    case "aboveHalfHp":
      return p.hp > p.maxHp * HALF;
    case "belowHalfHp":
      return p.hp <= p.maxHp * HALF;
    case "comboAbove10":
      return state.combo.count >= TRIGGER.comboThreshold;
    case "roomLocked":
      return state.rooms.some((r) => r.locked);
    case "fullEnergy":
      return p.energy >= p.maxEnergy;
    case "manaFull":
      return state.stats.maxMana > 0 && p.mana >= state.stats.maxMana;
    case "manaLow":
      return p.mana < state.stats.maxMana * TRIGGER.manaLowRatio;
    case "selfAfflicted":
      return afflictionKinds(p.status) > 0;
    default:
      return targetConditionMet(targetOf(state, ctx), condition);
  }
}

/** 対象（敵）を見る条件。対象を探すのはこの種類の条件のときだけ（毎ヒットの判定を重くしない） */
function targetConditionMet(target: Enemy | undefined, condition: TriggerCondition): boolean {
  if (target === undefined) return false;
  switch (condition) {
    case "targetInWindup":
      return target.phase === "windup";
    case "targetGuarded":
      return hasStatus(target.status, "guarded");
    case "targetMultiStatus":
      return afflictionKinds(target.status) >= TRIGGER.multiStatusKinds;
    case "targetElite":
      return target.elite !== undefined;
    default:
      return false;
  }
}

/** ICD を進める（毎ステップ）。性質の時計（死神の誓い）もここで進める */
export function tickTriggerCooldowns(state: GameState, dt: number): void {
  tickTraitClocks(state, dt);
  const cds = state.player.triggerCooldowns;
  for (const [key, left] of cds) {
    const next = left - dt;
    if (next <= 0) cds.delete(key);
    else cds.set(key, next);
  }
}

function durationOf(t: EffectParams): number {
  return t.duration ?? TRIGGER.defaultDuration;
}

/** 装備トリガーの効果を実行する（統一ルールの効果のうち装備と同じ種類もここを通る。src/system/rules.ts） */
export function runEffect(state: GameState, t: EffectParams, ctx: TriggerContext): void {
  const p = state.player;
  switch (t.effect) {
    case "shockwave":
      shockwave(state, ctx.pos, t.magnitude);
      return;
    case "spawnBullets":
      spawnBullets(state, t.count ?? 1, t.magnitude);
      return;
    case "chainLightning":
      chainLightning(state, ctx.pos, t.magnitude);
      return;
    case "burnNearby":
      for (const e of enemiesInRadius(state, ctx.pos, TRIGGER.nearbyRadius)) applyBurn(state, e, t.magnitude, durationOf(t));
      spawnRing(state, ctx.pos, TRIGGER.nearbyRadius, STATUS.burnColor, STATUS.fxLife);
      return;
    case "freezeNearby":
      for (const e of enemiesInRadius(state, ctx.pos, TRIGGER.nearbyRadius)) {
        applyChill(state, e, t.magnitude / TRIGGER.percent, durationOf(t));
      }
      spawnRing(state, ctx.pos, TRIGGER.nearbyRadius, STATUS.chillColor, STATUS.fxLife);
      return;
    case "explode":
      explodeAt(state, ctx.pos, STATUS.explodeRadius, t.magnitude);
      return;
    case "heal":
      healPlayer(state, t.magnitude);
      return;
    case "damageBuff":
      applyTimedMul(p.buffs.damage, 1 + t.magnitude / TRIGGER.percent, durationOf(t));
      addFloatingText(state, p.body.pos, "パワー", TEXT_COLOR_BUFF, 1, 0.6);
      return;
    case "speedBuff":
      applyTimedMul(p.buffs.speed, 1 + t.magnitude / TRIGGER.percent, durationOf(t));
      addFloatingText(state, p.body.pos, "加速", TEXT_COLOR_BUFF, 1, 0.6);
      return;
    case "energy":
      gainEnergy(state, t.magnitude);
      return;
    case "invuln":
      // 上限で切る: 被弾時・ゲージ満タンの無敵を重ねて常時無敵にしない
      p.buffs.invuln = Math.max(p.buffs.invuln, Math.min(TRIGGER.invulnMax, t.duration ?? t.magnitude));
      addFloatingText(state, p.body.pos, "無敵", TEXT_COLOR_INVULN, 1, 0.6);
      return;
    default:
      runExtendedEffect(state, t, ctx);
  }
}

/** 2026-09 追加の効果（docs/ideas/loot-expansion.md 6-2） */
function runExtendedEffect(state: GameState, t: EffectParams, ctx: TriggerContext): void {
  const p = state.player;
  switch (t.effect) {
    case "restoreMana":
      gainMana(state, t.magnitude);
      addFloatingText(state, p.body.pos, "マナ", TEXT_COLOR_MANA, 0.8, 0.5);
      return;
    case "addPoise":
      for (const e of effectTargets(state, ctx)) addPoise(state, e, t.magnitude);
      return;
    case "inflict":
      if (t.status !== undefined) inflictAll(state, effectTargets(state, ctx), t.status, t.magnitude);
      return;
    case "cleanse":
      cleanseOne(state);
      return;
    case "extendStatus":
      for (const e of effectTargets(state, ctx)) extendAfflictions(e, t.magnitude);
      return;
    case "skillHaste":
      hasteSkills(state, t.magnitude);
      return;
    case "volley":
      volley(state, t.count ?? 1, t.magnitude);
      return;
    case "healMissing":
      healPlayer(state, Math.max(0, p.maxHp - p.hp) * (t.magnitude / TRIGGER.percent));
      return;
    default:
      return;
  }
}

/** 敵へ向ける効果の相手。起点の対象が生きていればそれ、いなければ周囲の敵 */
function effectTargets(state: GameState, ctx: TriggerContext): Enemy[] {
  const target = targetOf(state, ctx);
  if (target !== undefined && target.hp > 0) return [target];
  return enemiesInRadius(state, ctx.pos, TRIGGER.nearbyRadius);
}

/** 付ける状態異常の効果量（燃焼 = dps、出血 = 10px あたり …）。効果量を持たない種類は 0 */
function inflictPotency(kind: StatusKind): number {
  switch (kind) {
    case "burn":
      return TRIGGER.inflictBurnDps;
    case "bleed":
      return TRIGGER.inflictBleed;
    case "shock":
      return TRIGGER.inflictShock;
    case "poison":
      return STATUS.poison.hpRatioPerSec;
    case "vulnerable":
      return STATUS.vulnerable.mul;
    case "weaken":
      return STATUS.weaken.mul;
    case "chill":
      return STATUS.chill.slowPerStack;
    default:
      return 0;
  }
}

export function inflictApply(kind: StatusKind, seconds: number): StatusApply {
  const duration = HALT_KINDS.has(kind) ? Math.min(seconds, TRIGGER.inflictHaltMax) : seconds;
  return { kind, stacks: 1, duration, potency: inflictPotency(kind) };
}

function inflictAll(state: GameState, targets: readonly Enemy[], kind: StatusKind, seconds: number): void {
  const apply = inflictApply(kind, seconds);
  for (const e of targets) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
}

/** 自分の状態異常を 1 つ払う（付いた順の最初のもの） */
function cleanseOne(state: GameState): void {
  const kind = afflictionList(state.player.status)[0];
  if (kind === undefined) return;
  removeStatus(state, { kind: "player" }, kind);
  addFloatingText(state, state.player.body.pos, "払い", TEXT_COLOR_BUFF, 0.8, 0.5);
}

/** 敵の状態異常の残り秒を延ばす（行動停止と怯み値の系統は除く。上限 TRIGGER.extendMax） */
function extendAfflictions(enemy: Enemy, seconds: number): void {
  for (const effect of enemy.status.effects) {
    if (effect.time <= 0 || NO_EXTEND.has(effect.kind)) continue;
    effect.time = Math.min(TRIGGER.extendMax, effect.time + seconds);
    effect.maxTime = Math.max(effect.maxTime, effect.time);
  }
}

/** スキルの再使用時間と最低間隔を縮める（チャージの回復はスキル側の時間経過に任せる） */
function hasteSkills(state: GameState, seconds: number): void {
  for (const slot of state.skills.slots) {
    slot.cooldownLeft = Math.max(0, slot.cooldownLeft - seconds);
    slot.intervalLeft = Math.max(0, slot.intervalLeft - seconds);
  }
}

/** 照準（向き）の方向へ射撃の弾を撃つ。弾は kind "ranged" なので射撃の倍率・貫通・付与が乗る */
function volley(state: GameState, count: number, percent: number): void {
  const p = state.player;
  const s = state.stats;
  const n = Math.max(1, Math.round(count));
  const damage = scaled(s, PLAYER.shoot.scaling) * (percent / TRIGGER.percent);
  const base = angle(p.facing);
  const speed = PLAYER.shoot.speed * s.projectileSpeedMul;
  for (let i = 0; i < n; i++) {
    const offset = (i - (n - 1) / 2) * TRIGGER.volleySpread;
    state.projectiles.push({
      id: allocId(state),
      owner: "player",
      pos: { ...p.body.pos },
      vel: scale(fromAngle(base + offset), speed),
      radius: PLAYER.shoot.radius,
      damage,
      life: PLAYER.shoot.life,
      color: TRIGGER.bulletColor,
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: s.pierce,
      poise: PLAYER.shoot.poise * s.poiseDamageMul,
    });
  }
  pushSfx(state, "shoot");
}

/** バフは強い方の倍率、長い方の残り時間を採る */
function applyTimedMul(buff: { time: number; mul: number }, mul: number, duration: number): void {
  buff.mul = buff.time > 0 ? Math.max(buff.mul, mul) : mul;
  buff.time = Math.max(buff.time, duration);
}

/** 衝撃波（traitHooks の余韻斬りも使う） */
export function shockwave(state: GameState, pos: Vec, damage: number): void {
  spawnRing(state, pos, TRIGGER.shockwaveRadius, TRIGGER.shockwaveColor, STATUS.fxLife);
  spawnBurst(state, pos, TRIGGER.shockwaveColor, 10, 140, 0.3, 1.5);
  pushSfx(state, "explode");
  for (const e of enemiesInRadius(state, pos, TRIGGER.shockwaveRadius)) {
    const out = rollOutgoing(state, e, damage, "proc");
    damageEnemy(state, e, out.amount, normalize(sub(e.body.pos, pos)), TRIGGER.shockwaveKnockback, { hitstopSteps: 0 });
  }
}

/** プレイヤーを中心に全方位へ弾を撒く */
function spawnBullets(state: GameState, count: number, damage: number): void {
  const p = state.player;
  const n = Math.max(1, Math.round(count));
  for (let i = 0; i < n; i++) {
    const dir = fromAngle((FULL_CIRCLE * i) / n);
    state.projectiles.push({
      id: allocId(state),
      owner: "player",
      pos: { ...p.body.pos },
      vel: scale(dir, TRIGGER.bulletSpeed),
      radius: BULLET_RADIUS,
      damage,
      life: TRIGGER.bulletLife,
      color: TRIGGER.bulletColor,
      kind: "proc",
      hitIds: new Set(),
      pierceLeft: 0,
    });
  }
  pushSfx(state, "shoot");
}
