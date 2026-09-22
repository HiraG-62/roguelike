import { type Enemy, type GameState, pushLog } from "../core/state";
import { type Vec, normalize, scale, sub } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { FEEL, PLAYER } from "../data/tuning";
import { addFloatingText, hitstop, shake, spawnBurst, spawnDirectional } from "./effects";

export const COLOR_DAMAGE = "#ffffff";
export const COLOR_HURT = "#ff5050";
export const COLOR_JUST = "#60e0ff";
export const COLOR_HEAL = "#70e070";

export interface HitOptions {
  stagger?: boolean;
  hitstopSteps?: number;
  /** 必殺ゲージを貯めるか（近接のみ true） */
  buildsEnergy?: boolean;
}

/** コンボ数からスコア倍率。5 ヒットごとに +0.5 */
export function comboMultiplier(count: number): number {
  return 1 + Math.floor(count / 5) * 0.5;
}

export function registerComboHit(state: GameState): void {
  state.combo.count += 1;
  state.combo.timer = FEEL.comboWindow;
  state.combo.popTimer = 0.15;
  state.combo.best = Math.max(state.combo.best, state.combo.count);
}

/** 敵にダメージ。倒したら true。配列からの除去は enemies 側で行う */
export function damageEnemy(
  state: GameState,
  enemy: Enemy,
  amount: number,
  knockDir: Vec,
  knockForce: number,
  opts: HitOptions = {},
): boolean {
  if (enemy.hp <= 0) return false;
  const def = enemyDef(enemy.defKey);
  enemy.hp -= amount;
  enemy.hitFlash = 0.09;
  const dir = normalize(knockDir);
  enemy.knock = scale(dir, knockForce);
  if (opts.stagger && enemy.phase !== "spawning") {
    enemy.phase = "stagger";
    enemy.phaseTimer = 0.4;
  }

  registerComboHit(state);
  if (opts.buildsEnergy) {
    state.player.energy = Math.min(state.player.maxEnergy, state.player.energy + PLAYER.energyPerHit);
  }
  addFloatingText(state, enemy.body.pos, String(amount), COLOR_DAMAGE, opts.stagger ? 1.4 : 1);
  spawnDirectional(state, enemy.body.pos, dir, def.color, opts.stagger ? 10 : 5, 140);
  hitstop(state, opts.hitstopSteps ?? FEEL.hitstopLight);
  shake(state, opts.stagger ? FEEL.shakeHeavy : FEEL.shakeLight);

  if (enemy.hp > 0) return false;
  killEnemy(state, enemy);
  return true;
}

function killEnemy(state: GameState, enemy: Enemy): void {
  const def = enemyDef(enemy.defKey);
  state.kills += 1;
  const gained = Math.round(def.score * comboMultiplier(state.combo.count));
  state.score += gained;
  spawnBurst(state, enemy.body.pos, def.color, 18, 160, 0.5, 2.5);
  spawnBurst(state, enemy.body.pos, "#ffffff", 6, 90, 0.25, 1.5);
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - 6 }, `+${gained}`, "#ffd75f", 1.1, 0.8);
  hitstop(state, FEEL.hitstopKill);
  shake(state, FEEL.shakeHeavy);
}

export type PlayerHitResult = "hit" | "dodged" | "ignored";

/** プレイヤーへのダメージ。無敵中はジャスト回避判定だけ行う */
export function damagePlayer(state: GameState, amount: number, fromPos: Vec): PlayerHitResult {
  const p = state.player;
  if (state.status !== "playing") return "ignored";
  if (p.invulnTimer > 0) {
    if (p.dashTimer > 0 && !p.dodgedThisDash) {
      justDodge(state);
      return "dodged";
    }
    return "ignored";
  }

  p.hp = Math.max(0, p.hp - amount);
  p.invulnTimer = PLAYER.hurtInvuln;
  p.hitFlash = 0.12;
  const away = normalize(sub(p.body.pos, fromPos));
  p.knock = scale(away, PLAYER.hurtKnockback);
  cancelAttack(state);
  state.combo.count = 0;
  state.combo.timer = 0;

  addFloatingText(state, p.body.pos, `-${amount}`, COLOR_HURT, 1.3);
  spawnBurst(state, p.body.pos, COLOR_HURT, 12, 150, 0.4, 2);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeHurt);
  state.flash = Math.max(state.flash, 0.35);

  if (p.hp <= 0) {
    state.status = "dead";
    state.deathTimer = 0;
    spawnBurst(state, p.body.pos, "#ffffff", 40, 220, 0.9, 3);
    state.slowmo = 1.2;
    pushLog(state, `You died on depth ${state.depth}.`, COLOR_HURT);
  }
  return "hit";
}

function justDodge(state: GameState): void {
  const p = state.player;
  p.dodgedThisDash = true;
  state.slowmo = Math.max(state.slowmo, FEEL.justDodgeSlowmo);
  p.energy = Math.min(p.maxEnergy, p.energy + PLAYER.energyPerHit * 2);
  registerComboHit(state);
  addFloatingText(state, p.body.pos, "JUST!", COLOR_JUST, 1.5, 0.7);
  spawnBurst(state, p.body.pos, COLOR_JUST, 14, 120, 0.4, 2);
  state.flash = Math.max(state.flash, 0.2);
}

export function cancelAttack(state: GameState): void {
  const a = state.player.attack;
  a.phase = "none";
  a.timer = 0;
  a.buffered = false;
  a.hitIds.clear();
}

export function healPlayer(state: GameState, amount: number): void {
  const p = state.player;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const gained = p.hp - before;
  if (gained <= 0) return;
  addFloatingText(state, p.body.pos, `+${gained}`, COLOR_HEAL, 1.2);
  spawnBurst(state, p.body.pos, COLOR_HEAL, 10, 80, 0.5, 2);
}
