import type { GameState } from "../core/state";
import { TILE_SIZE } from "../map/grid";
import { clamp, lerp } from "../core/vec";

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
  if (cam.shake > 0) {
    cam.offset = {
      x: (state.rng.next() - 0.5) * 2 * cam.shake,
      y: (state.rng.next() - 0.5) * 2 * cam.shake,
    };
  } else {
    cam.offset = { x: 0, y: 0 };
  }
}

export function snapCamera(state: GameState): void {
  state.camera.pos = { ...state.player.body.pos };
}
