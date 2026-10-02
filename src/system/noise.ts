import { type GameState, type Jin, pushSfx } from "../core/state";
import { type Vec, dist } from "../core/vec";
import { enemyDef, isBossClass } from "../data/enemies";
import type { SfxName } from "../audio/sfxNames";
import { JIN } from "../data/tuning";
import { lineOfSight } from "../map/pathing";
import { jinById, nearestMemberSeed, wakeJin } from "./jin";

/**
 * 音で起きる（docs/ideas/jin-impl.md 2-5・3c の I）。
 * ダッシュ・命中・爆発が state.noises に輪を積み、次の updateEnemies の頭で眠っている（idle の）敵が聞きつける。
 * 歩きは音を出さない。壁越しには届かない（気付いた敵が壁に張り付いたまま動けなくなるので、通常の気付きと同じく視線を要る）。
 * 陣のメンバーなら wakeJin の流れに乗せる（聞きつけた者の近くだけ起き、残りは後詰）。乱数は引かない
 */

export type NoiseKind = "dash" | "hit" | "explode";

/** 物見の鐘（呼び鈴小鬼の鳴らす音 = strikeBell の効果音を流用） */
export const LOOKOUT_BELL_SFX: SfxName = "enemyWindup";

/** 音を積む。1 ステップの上限を超えた分は捨てる（多段ヒット・爆発の連鎖で膨らませない） */
export function emitNoise(state: GameState, pos: Vec, kind: NoiseKind): void {
  if (state.noises.length >= JIN.noise.maxPerStep) return;
  state.noises.push({ pos: { x: pos.x, y: pos.y }, radius: JIN.noise[kind] });
}

/** 物見が気付いたときの鐘 */
export function ringLookoutBell(state: GameState): void {
  pushSfx(state, LOOKOUT_BELL_SFX);
}

/**
 * 積まれた音を聞きつけた眠っている敵を起こし、音を空にする（updateEnemies の頭）。
 * 音は敵の更新の前にしか読まないので、更新の後に鳴った音は次のステップで聞かれる（決定的）
 */
export function wakeByNoise(state: GameState): void {
  if (state.noises.length === 0) return;
  const noises = state.noises;
  state.noises = [];
  const heardBy = new Map<Jin, Vec[]>();
  for (const e of state.enemies) {
    // ボスは導入演出などの自前の流れで動くので、音では起こさない
    // ボスは導入演出などの自前の流れで動くので、音では起こさない
    // 商人は殴られるまで気付かない（戦いの音でも起きない）。壺・木箱は音でも起きない
    if (e.hp <= 0 || e.phase !== "idle") continue;
    const def = enemyDef(e.defKey);
    if (isBossClass(def) || def.merchant === true || def.container !== undefined) continue;
    const heard = noises.some((n) => dist(n.pos, e.body.pos) <= n.radius && lineOfSight(state.map, n.pos, e.body.pos));
    if (!heard) continue;
    e.phase = "chase";
    const jin = jinById(state, e.jinId);
    if (jin) heardBy.set(jin, [...(heardBy.get(jin) ?? []), e.body.pos]);
  }
  for (const [jin, seeds] of heardBy) wakeHeardJin(state, jin, seeds);
}

/**
 * from に最も近い眠っている陣（物見・from 自身を除く。同距離は id の小さい方）。jinSpawn.ts の nearestSleepingJin と同じ規則。
 * jinSpawn.ts を import すると enemies.ts からの循環でモジュールの読み込み順が崩れる（roomTypes の BIOMES が未定義になる）ため、ここに持つ
 */
function nearestSleepingJin(state: GameState, from: Jin): Jin | null {
  let best: Jin | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const j of state.jins) {
    if (j === from || j.formation === "lookout" || j.phase !== "sleeping") continue;
    const d = dist(j.center, from.center);
    if (d >= bestD) continue;
    best = j;
    bestD = d;
  }
  return best;
}

/** 聞きつけた者のいる陣を、聞きつけた者の近くだけ起こす。物見なら鐘を鳴らし、最も近い眠っている陣も起こす（視線で気付いたときと同じ） */
function wakeHeardJin(state: GameState, jin: Jin, seeds: readonly Vec[]): void {
  wakeJin(state, jin, seeds);
  if (jin.formation !== "lookout") return;
  ringLookoutBell(state);
  const target = nearestSleepingJin(state, jin);
  if (target) wakeJin(state, target, nearestMemberSeed(state, target));
}
