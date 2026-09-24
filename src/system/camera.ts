import type { GameState } from "../core/state";
import { TILE_SIZE } from "../map/grid";
import { type Vec, add, clamp, lerp, normalize, scale } from "../core/vec";
import { FEEL } from "../data/tuning";
import { fxRandom } from "./effects";

/** 追従の滑らかさ。1 秒あたりどれだけ寄るか */
const FOLLOW_RATE = 10;
const SHAKE_DECAY = 22;

export function updateCamera(state: GameState, dt: number, viewW: number, viewH: number): void {
  const cam = state.camera;
  const target = state.player.body.pos;
  const t = 1 - Math.exp(-FOLLOW_RATE * dt);
  cam.pos.x = lerp(cam.pos.x, target.x, t);
  cam.pos.y = lerp(cam.pos.y, target.y, t);

  // マップ外を映さない
  const worldW = state.map.width * TILE_SIZE;
  const worldH = state.map.height * TILE_SIZE;
  cam.pos.x = clamp(cam.pos.x, viewW / 2, Math.max(viewW / 2, worldW - viewW / 2));
  cam.pos.y = clamp(cam.pos.y, viewH / 2, Math.max(viewH / 2, worldH - viewH / 2));

  cam.shake = Math.max(0, cam.shake - SHAKE_DECAY * dt);
  // 揺れは演出専用の乱数（fxRandom）で作る。state.rng を消費せず、揺れの有無でゲームの乱数列がずれない
  const shakeOffset =
    cam.shake > 0
      ? { x: (fxRandom(state) - 0.5) * 2 * cam.shake, y: (fxRandom(state) - 0.5) * 2 * cam.shake }
      : { x: 0, y: 0 };
  // 攻撃方向へのキック（重撃・撃破）。減衰して 0 へ戻る（docs/ideas/combat-feel-design.md D-3）
  cam.kick = scale(cam.kick, Math.exp(-FEEL.kickDecay * dt));
  cam.offset = add(shakeOffset, cam.kick);
}

/** 攻撃方向へカメラを押す（重撃・撃破の手応え）。dir が 0 ベクトルなら何もしない */
export function cameraKick(state: GameState, dir: Vec, amount: number): void {
  if (dir.x === 0 && dir.y === 0) return;
  const cam = state.camera;
  cam.kick = add(cam.kick, scale(normalize(dir), amount));
}

export function snapCamera(state: GameState): void {
  state.camera.pos = { ...state.player.body.pos };
  state.camera.kick = { x: 0, y: 0 };
}
