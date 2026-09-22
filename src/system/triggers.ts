import { type GameState, allocId, pushSfx } from "../core/state";
import { type Vec, fromAngle, normalize, scale, sub } from "../core/vec";
import { STATUS, TRIGGER } from "../data/tuning";
import type { TriggerCondition, TriggeredEffect, TriggerKind } from "../loot/types";
import { damageEnemy, gainEnergy, healPlayer, rollOutgoing } from "./combat";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { applyBurn, applyChill, chainLightning, enemiesInRadius, explodeAt } from "./statusEffects";

/**
 * trigger × condition × effect の条件付き効果を実行する。
 * 同じトリガー定義（stats.triggers の index）ごとに TRIGGER.icd 秒の内部クールダウンを持つ。
 */

export interface TriggerContext {
  pos: Vec;
  targetId?: number;
}

const HALF = 0.5;
const BULLET_RADIUS = 2;
const TEXT_COLOR_BUFF = "#ffd75f";
const TEXT_COLOR_INVULN = "#ffffff";
const FULL_CIRCLE = Math.PI * 2;

/**
 * トリガーの ICD を装備変更で混線させないためのキー。
 * index だけだと装備入れ替えで同じ index が全く別のトリガーになったとき、
 * 古い ICD を誤って引き継いでしまうため、トリガー内容（trigger/condition/effect/every）も混ぜる。
 */
function triggerCooldownKey(t: TriggeredEffect, index: number): string {
  return `${t.trigger}:${t.condition}:${t.effect}:${t.every ?? ""}:${index}`;
}

export function fireTrigger(state: GameState, kind: TriggerKind, ctx: TriggerContext): void {
  if (state.status !== "playing") return;
  const p = state.player;
  state.stats.triggers.forEach((t, index) => {
    if (t.trigger !== kind) return;
    const key = triggerCooldownKey(t, index);
    if ((p.triggerCooldowns.get(key) ?? 0) > 0) return;
    if (kind === "everyNthMeleeHit" && !isNthHit(p.meleeHitCount, t.every)) return;
    if (!conditionMet(state, t.condition)) return;
    if (!state.rng.chance(t.chance)) return;
    p.triggerCooldowns.set(key, TRIGGER.icd);
    runEffect(state, t, ctx);
  });
}

function isNthHit(count: number, every: number | undefined): boolean {
  if (every === undefined || every <= 0) return false;
  return count > 0 && count % every === 0;
}

export function conditionMet(state: GameState, condition: TriggerCondition): boolean {
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
  }
}

/** ICD を進める（毎ステップ） */
export function tickTriggerCooldowns(state: GameState, dt: number): void {
  const cds = state.player.triggerCooldowns;
  for (const [key, left] of cds) {
    const next = left - dt;
    if (next <= 0) cds.delete(key);
    else cds.set(key, next);
  }
}

function durationOf(t: TriggeredEffect): number {
  return t.duration ?? TRIGGER.defaultDuration;
}

function runEffect(state: GameState, t: TriggeredEffect, ctx: TriggerContext): void {
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
      addFloatingText(state, p.body.pos, "POWER", TEXT_COLOR_BUFF, 1, 0.6);
      return;
    case "speedBuff":
      applyTimedMul(p.buffs.speed, 1 + t.magnitude / TRIGGER.percent, durationOf(t));
      addFloatingText(state, p.body.pos, "HASTE", TEXT_COLOR_BUFF, 1, 0.6);
      return;
    case "energy":
      gainEnergy(state, t.magnitude);
      return;
    case "invuln":
      p.buffs.invuln = Math.max(p.buffs.invuln, t.duration ?? t.magnitude);
      addFloatingText(state, p.body.pos, "INVULN", TEXT_COLOR_INVULN, 1, 0.6);
      return;
  }
}

/** バフは強い方の倍率、長い方の残り時間を採る */
function applyTimedMul(buff: { time: number; mul: number }, mul: number, duration: number): void {
  buff.mul = buff.time > 0 ? Math.max(buff.mul, mul) : mul;
  buff.time = Math.max(buff.time, duration);
}

function shockwave(state: GameState, pos: Vec, damage: number): void {
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
