import type { StatusKind } from "../core/status";
import type { DamageKind, Enemy, GameState } from "../core/state";
import { dist, normalize, sub } from "../core/vec";
import { enemyDef, isBossClass } from "../data/enemies";
import { FORM } from "../data/tuning";
import { type FormDef, formOfKey } from "../data/weaponForms";
import { MOVESETS } from "../data/weapons";
import { damageEnemy } from "./combat";
import { noteRiposte } from "./moments";
import { gainMorale } from "./morale";
import { moveBody } from "./physics";
import type { MeleeStep } from "./player";
import { removeStatus, statusStacks } from "./statusEffects";

/**
 * 型の印（docs/ideas/weapon-forms-impl.md 3-4。段取り 5b-D1）。刃斧の傷・長柄の穂先・鎖の繋ぎの、
 * 敵に残す印と命中ごとの出し入れ。戦意の数（導出の値）は system/morale.ts がここの数え方を読み、
 * 振り・命中の瞬間は player.ts / combat.ts が 1 行ずつ呼ぶ
 */

/** 分けたダメージの最小（端数で 0 にならないように） */
const MIN_SHARE = 1;

/** 装備の武器種の型（morale.ts の currentForm と同じ引き方。morale.ts を読み込み元に持つので自前で引く） */
function equippedForm(state: GameState): FormDef {
  return formOfKey((MOVESETS[state.stats.moveset] ?? MOVESETS.sword).key);
}

function alive(e: Enemy): boolean {
  return e.hp > 0 && e.phase !== "spawning";
}

// ---------------------------------------------------------------------------
// 刃斧: 傷
// ---------------------------------------------------------------------------

/** 自分から radius 内の生きている敵が持つ status の最大スタック（刃斧の戦意「傷」。導出） */
export function statusPeakNear(state: GameState, kind: StatusKind, radius: number): number {
  const at = state.player.body.pos;
  let peak = 0;
  for (const e of state.enemies) {
    if (!alive(e) || dist(e.body.pos, at) > radius + e.body.radius) continue;
    peak = Math.max(peak, statusStacks(e.status, kind));
  }
  return peak;
}

/** 刃斧の戦意: 近く（FORM.hewer.nearPx）の敵の傷の最大スタック */
export function woundPeak(state: GameState): number {
  return statusPeakNear(state, "wound", FORM.hewer.nearPx);
}

/**
 * 裂き（刃斧の放出の段）の命中: 命中した敵の傷をすべて消し、消した数だけ威力と怯み値を上乗せする倍率を返す。
 * 放出でない振り・傷の無い敵は等倍
 */
function openWounds(state: GameState, e: Enemy, step: Readonly<MeleeStep>): { damage: number; poise: number } {
  if (step.release !== true || equippedForm(state).key !== "hewer") return { damage: 1, poise: 1 };
  const stacks = statusStacks(e.status, "wound");
  if (stacks <= 0) return { damage: 1, poise: 1 };
  removeStatus(state, { kind: "enemy", enemy: e }, "wound", "consume");
  const r = FORM.hewer.rend;
  return { damage: 1 + r.damageMulPerStack * stacks, poise: 1 + r.poiseMulPerStack * stacks };
}

// ---------------------------------------------------------------------------
// 鎖: 繋ぎ
// ---------------------------------------------------------------------------

/** 繋がれている（Enemy.linked の残り秒がある）生きた敵か */
export function isLinked(e: Enemy): boolean {
  return (e.linked ?? 0) > 0 && e.hp > 0;
}

/** 鎖の戦意: 繋いだ敵の数（導出） */
export function linkedCount(state: GameState): number {
  return state.enemies.reduce((n, e) => n + (isLinked(e) ? 1 : 0), 0);
}

/** 引き寄せの段（pull）の命中: 鎖の型なら敵を繋ぎ、予備動作中の敵に当てたら応手（pullInterrupt） */
function linkOnPull(state: GameState, e: Enemy, step: Readonly<MeleeStep>, counter: boolean): void {
  if (!step.pull || equippedForm(state).key !== "chain") return;
  e.linked = FORM.chain.linkSec;
  if (counter) noteRiposte(state, "pullInterrupt", e);
}

/**
 * 束ね打ち（鎖の放出の段）の振り始め: 繋いだ敵を自分の前（体どうしが slamGapPx 離れた位置）へ寄せ、繋ぎを解く。
 * 壁の手前で止まる。ボスは寄せない（繋ぎだけ解く）
 */
export function gatherLinked(state: GameState): void {
  const p = state.player;
  const dir = normalize(p.facing);
  for (const e of state.enemies) {
    if (!isLinked(e)) continue;
    e.linked = 0;
    if (isBossClass(enemyDef(e.defKey))) continue;
    const gap = p.body.radius + e.body.radius + FORM.chain.slamGapPx;
    const target = { x: p.body.pos.x + dir.x * gap, y: p.body.pos.y + dir.y * gap };
    const move = sub(target, e.body.pos);
    moveBody(state, e.body, move.x, move.y);
    e.knock = { x: 0, y: 0 };
  }
}

/**
 * 一蓮托生（combat.ts の damageEnemy）: 繋いだ敵に与えた直接のダメージ × shareRatio を、他の繋いだ敵それぞれにも与える。
 * 分けたダメージは素性なし（proc）なので、ここへ戻って分け直さない。継続ダメージ・追撃は分けない
 */
export function shareLinkedDamage(state: GameState, hit: Enemy, amount: number, kind: DamageKind, silent: boolean): void {
  if (silent || kind === "proc" || (hit.linked ?? 0) <= 0) return;
  const share = Math.max(MIN_SHARE, Math.round(amount * FORM.chain.shareRatio));
  // 分けた一撃で倒れて並びが変わっても配り切れるよう、先に相手を決める
  const others = state.enemies.filter((e) => e !== hit && isLinked(e));
  for (const e of others) damageEnemy(state, e, share, normalize(sub(e.body.pos, hit.body.pos)), 0, { kind: "proc" });
}

// ---------------------------------------------------------------------------
// 近接の命中（player.ts の meleeHitEnemy から 1 行）
// ---------------------------------------------------------------------------

/**
 * 近接 1 命中の型の印: 長柄は穂先の命中で戦意、鎖は引き寄せで繋ぐ、刃斧の裂きは傷を開く。
 * 威力の前に呼び、威力と怯み値に掛ける倍率を返す（裂きの傷の上乗せ。他は等倍）
 */
export function onFormMeleeHit(state: GameState, e: Enemy, step: Readonly<MeleeStep>, tip: boolean, counter: boolean): { damage: number; poise: number } {
  if (tip) gainMorale(state, "tipHit");
  linkOnPull(state, e, step, counter);
  return openWounds(state, e, step);
}
