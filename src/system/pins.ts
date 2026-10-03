import { type Enemy, type EnemyPin, type GameState, pushSfx } from "../core/state";
import { type Vec, fromAngle } from "../core/vec";
import { enemyCombat } from "../data/enemyCombat";
import type { PinDef, PinKind } from "../data/weapons";
import { damageEnemy } from "./combat";
import { spawnBurst } from "./effects";
import { gainMorale } from "./morale";
import { applyStagger } from "./poise";

/**
 * 刺さる飛び物（クナイ・手裏剣。docs/ideas/gun-bases-review.md 0-5・2-9）。刺さる弾（BulletDef.pin）は当たると消えて
 * 敵の Enemy.pins に残り、抜ける時刻（state.time 基準）を過ぎたものは数えない。
 * - 叩き込み（クナイ）: 近接の命中で刺さったものを全部叩き込み、1 本ごとに追撃（刺さったときの威力 × 倍率）
 * - 刺さり崩し（手裏剣）: 同じ敵に同じ種類が staggerAt 本刺さると怯ませ、その種類の刺さりを消す
 * - 炸裂（奥義）: 刺さっているものを全部爆ぜさせる
 */

/** 刺さった 1 本の出来事。staggered = 刺さり崩しで怯ませた（その種類の刺さりは消えた） */
export type PinOutcome = "stuck" | "staggered";

/** 叩き込み・炸裂の追撃の命中の粒（見た目だけ） */
const DRIVE_FX = { color: "#e8e2d0", particles: 6, speed: 90, life: 0.2, size: 1.5 } as const;
const STAGGER_FX = { color: "#d8dce4", particles: 10, speed: 110, life: 0.25, size: 1.5 } as const;
const BLAST_FX = { color: "#ffb060", particles: 8, speed: 120, life: 0.25, size: 2 } as const;

/** まだ抜けていない刺さり（刺さった順） */
export function livePins(state: Readonly<GameState>, e: Readonly<Enemy>): EnemyPin[] {
  return (e.pins ?? []).filter((pin) => pin.until > state.time);
}

/** 刺さっている本数（kind を渡せばその種類だけ） */
export function pinCount(state: Readonly<GameState>, e: Readonly<Enemy>, kind?: PinKind): number {
  return livePins(state, e).filter((pin) => kind === undefined || pin.kind === kind).length;
}

/** 抜けた刺さりを捨てる（配列を持ち続けない） */
function prunePins(state: GameState, e: Enemy): EnemyPin[] {
  const live = livePins(state, e);
  e.pins = live.length > 0 ? live : undefined;
  return live;
}

function countKind(pins: readonly EnemyPin[], kind: PinKind): number {
  return pins.reduce((n, pin) => n + (pin.kind === kind ? 1 : 0), 0);
}

/** 上限を超えた同じ種類を古い順に抜く */
function dropOldest(pins: EnemyPin[], kind: PinKind, max: number): void {
  while (countKind(pins, kind) > max) {
    const oldest = pins.findIndex((pin) => pin.kind === kind);
    if (oldest < 0) return;
    pins.splice(oldest, 1);
  }
}

/**
 * 1 本刺す（system/projectiles.ts の刺さる弾の命中）。angle は飛んできた向き、damage は刺さったときの威力。
 * 刺さり崩しの本数に届いて怯ませたら "staggered"（怯まない敵・拘束の上限で入らなければ刺さりを残して "stuck"）
 */
export function stickPin(state: GameState, e: Enemy, def: Readonly<PinDef>, angle: number, damage: number): PinOutcome {
  if (e.hp <= 0) return "stuck";
  const pins = prunePins(state, e);
  pins.push({ kind: def.kind, until: state.time + def.sec, angle, damage, driveMul: def.driveMul });
  dropOldest(pins, def.kind, def.max);
  e.pins = pins;
  if (def.staggerAt === undefined || countKind(pins, def.kind) < def.staggerAt) return "stuck";
  if (!applyStagger(state, e, enemyCombat(e.defKey).staggerTime)) return "stuck";
  removeKind(e, def.kind);
  spawnBurst(state, e.body.pos, STAGGER_FX.color, STAGGER_FX.particles, STAGGER_FX.speed, STAGGER_FX.life, STAGGER_FX.size);
  gainMorale(state, "pinStagger");
  return "staggered";
}

function removeKind(e: Enemy, kind: PinKind): void {
  const rest = (e.pins ?? []).filter((pin) => pin.kind !== kind);
  e.pins = rest.length > 0 ? rest : undefined;
}

/**
 * 叩き込み（近接の命中。MeleeStepDef.drivePins）: 刺さっているものを全部叩き込み、1 本ごとに追撃（刺さったときの威力 × 倍率）を入れる。
 * 追撃は素性なしの追撃（proc）で、命中の起点や気力の回収は起こさない（起点は叩き込んだ振りの命中が持つ）。叩き込んだ本数を返す
 */
export function drivePins(state: GameState, e: Enemy, dir: Vec): number {
  const pins = prunePins(state, e);
  if (pins.length === 0 || e.hp <= 0) return 0;
  e.pins = undefined;
  let driven = 0;
  for (const pin of pins) {
    if (e.hp <= 0) break;
    damageEnemy(state, e, Math.round(pin.damage * pin.driveMul), dir, 0, { kind: "proc" });
    driven += 1;
  }
  spawnBurst(state, e.body.pos, DRIVE_FX.color, DRIVE_FX.particles, DRIVE_FX.speed, DRIVE_FX.life, DRIVE_FX.size);
  pushSfx(state, "bulletHitHeavy");
  gainMorale(state, "pinDriven", driven);
  return driven;
}

/** 炸裂（奥義）: 敵すべての刺さりを爆ぜさせ、1 本ごとに刺さったときの威力 × damageMul の追撃を入れる。爆ぜた本数を返す */
export function detonatePins(state: GameState, damageMul: number): number {
  let count = 0;
  for (const e of state.enemies) {
    const pins = prunePins(state, e);
    if (pins.length === 0 || e.hp <= 0) continue;
    e.pins = undefined;
    for (const pin of pins) {
      if (e.hp <= 0) break;
      damageEnemy(state, e, Math.round(pin.damage * damageMul), fromAngle(pin.angle), 0, { kind: "proc" });
      count += 1;
    }
    spawnBurst(state, e.body.pos, BLAST_FX.color, BLAST_FX.particles, BLAST_FX.speed, BLAST_FX.life, BLAST_FX.size);
  }
  if (count > 0) pushSfx(state, "explode");
  return count;
}
