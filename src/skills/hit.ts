import type { Enemy, GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { FEEL } from "../data/tuning";
import { damageEnemy, rollOutgoing } from "../system/combat";
import { addFloatingText, spawnBurst } from "../system/effects";
import { fireTrigger } from "../system/triggers";
import { SKILL_DEFS, resolveCast } from "./data";
import { stoneInSlot } from "./persistence";
import type { CastParams } from "./types";

/**
 * スキルのダメージの共通入口。rollOutgoing → damageEnemy に、
 * 刻印符の呪い（被ダメ増 + 刻印）と連鎖（キルでチャージ返却）を重ねる。
 */

export const COLOR_CURSE = "#b040ff";
const COLOR_RESET = "#ffff80";
const RESET_TEXT_SCALE = 1;
const RESET_TEXT_LIFE = 0.6;
const CURSE_PARTICLES = 4;
const CURSE_PARTICLE_SPEED = 30;
const CURSE_PARTICLE_LIFE = 0.3;
const CURSE_PARTICLE_SIZE = 1.5;

export interface SkillHitSpec {
  base: number;
  kind: "melee" | "ranged";
  dir: Vec;
  knockback: number;
  stagger: boolean;
}

/** 呪い中なら被ダメ倍率（1 + bonus）、そうでなければ 1 */
export function curseMul(state: GameState, enemyId: number): number {
  const c = state.skills.curses.get(enemyId);
  return c && c.time > 0 ? 1 + c.bonus : 1;
}

/** 1 体への命中。倒したら true */
export function skillHit(state: GameState, e: Enemy, params: Readonly<CastParams>, spec: SkillHitSpec): boolean {
  const out = rollOutgoing(state, e, spec.base, spec.kind);
  const amount = Math.round(out.amount * curseMul(state, e.id));
  const pos = { ...e.body.pos };
  const melee = spec.kind === "melee";
  const killed = damageEnemy(state, e, amount, spec.dir, spec.knockback * state.stats.knockbackMul, {
    stagger: spec.stagger,
    hitstopSteps: spec.stagger ? FEEL.hitstopHeavy : FEEL.hitstopLight,
    buildsEnergy: melee,
    kind: spec.kind,
    crit: out.crit,
  });
  if (melee) {
    state.player.meleeHitCount += 1;
    fireTrigger(state, "onMeleeHit", { pos, targetId: e.id });
    fireTrigger(state, "everyNthMeleeHit", { pos, targetId: e.id });
  }
  if (params.curse && !killed) applyCurse(state, e, params.curse);
  if (killed && params.killRefund) refundCharge(state, params.slot, pos);
  return killed;
}

function applyCurse(state: GameState, e: Enemy, curse: { duration: number; bonus: number }): void {
  const cur = state.skills.curses.get(e.id);
  const bonus = cur ? Math.max(cur.bonus, curse.bonus) : curse.bonus;
  const time = cur ? Math.max(cur.time, curse.duration) : curse.duration;
  state.skills.curses.set(e.id, { time, bonus });
  spawnBurst(state, e.body.pos, COLOR_CURSE, CURSE_PARTICLES, CURSE_PARTICLE_SPEED, CURSE_PARTICLE_LIFE, CURSE_PARTICLE_SIZE);
}

/** 連鎖: スロットのチャージを 1 返す（最大まで）。満タンになれば CD も止める */
export function refundCharge(state: GameState, slotIndex: number, pos: Vec): void {
  const rs = state.skills;
  const slot = rs.slots[slotIndex];
  const stone = stoneInSlot(rs.profile, slotIndex);
  if (!slot || !stone) return;
  const max = resolveCast(SKILL_DEFS[stone.skillKey], stone, slot.modifiers).charges;
  if (slot.chargesLeft >= max) return;
  slot.chargesLeft += 1;
  if (slot.chargesLeft >= max) slot.cooldownLeft = 0;
  addFloatingText(state, pos, "返却", COLOR_RESET, RESET_TEXT_SCALE, RESET_TEXT_LIFE);
}

/** 呪いの時間経過。切れたもの・いなくなった敵は消す */
export function tickCurses(state: GameState, dt: number): void {
  const curses = state.skills.curses;
  if (curses.size === 0) return;
  const alive = new Set(state.enemies.filter((e) => e.hp > 0).map((e) => e.id));
  for (const [id, c] of curses) {
    c.time -= dt;
    if (c.time <= 0 || !alive.has(id)) curses.delete(id);
  }
}
