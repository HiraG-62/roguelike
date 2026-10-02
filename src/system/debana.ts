import { type CounterTag, enemyTarget, pushEvent } from "../core/events";
import type { SfxName } from "../audio/sfxNames";
import { type Enemy, type GameState, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { ACTION, FX_WAVE3 } from "../data/tuning";
import { addMark, fxState, spawnBurst } from "./effects";
import { attackCommitted } from "./poise";
import { onTraitCounter } from "./traitHooks";

/**
 * 出端（予告が黄の間に振り始めた近接 / 撃った放出の弾の命中。docs/ideas/reading-core-impl.md 2-3）の出来事。
 * 近接（player.ts）と弾（projectiles.ts）が同じ見せ方・同じ出来事を出すためにここへ寄せる。
 * 頭上の文字は出さない。音・粒・白黒・墨の飛沫で見せる
 */

/** 赤の間の命中音を重ねない間隔（秒）。乱戦で鳴りっぱなしにしない */
const COMMITTED_SFX_GAP = 0.15;
const SPEED_BURST = 150;
const LIFE_BURST = 0.35;
const SIZE_BURST = 2;
/** onCounter の tag（受け流しの "parry" と区別する） */
const COUNTER_TAG: CounterTag = "debana";

/** 同じ音を gap 秒以内にもう積んでいたら積まない（pushSfx は同じフレームしか見ない） */
export function pushSfxSpaced(state: GameState, name: SfxName, gap: number): void {
  const fx = fxState(state);
  const memory = fx.sfxAt ?? {};
  fx.sfxAt = memory;
  const last = memory[name];
  if (last !== undefined && state.time - last < gap) return;
  memory[name] = state.time;
  pushSfx(state, name);
}

/** 出端の命中点の見せ方（澄んだ音・粒・墨の飛沫。白黒は onCounter を見て effects.ts が始める） */
function showDebana(state: GameState, pos: Vec): void {
  const c = ACTION.counter;
  spawnBurst(state, pos, c.color, c.particles, SPEED_BURST, LIFE_BURST, SIZE_BURST);
  addMark(state, "debanaSplash", pos, FX_WAVE3.debanaSplash.life, c.color);
  pushSfx(state, "counter");
}

/** 出端の出来事。1 振り × 1 体（弾は 1 発 × 1 体）に 1 回だけ呼ぶ。応手（noteRiposte）は近接側が続けて呼ぶ */
export function fireDebana(state: GameState, e: Enemy, pos: Vec): void {
  showDebana(state, pos);
  onTraitCounter(state, e);
  pushEvent(state, { kind: "onCounter", actor: "player", source: { kind: "player", key: "counter" }, tag: COUNTER_TAG, ...enemyTarget(e) });
}

/** 赤（攻撃が確定した）の敵への普通の命中: 倍も盾抜けも無い、と音で知らせる。1 振り × 1 体に 1 回、呼び側が絞る */
export function noteCommittedHit(state: GameState, e: Enemy): void {
  if (!attackCommitted(e)) return;
  pushSfxSpaced(state, "hitCommitted", COMMITTED_SFX_GAP);
}
