import type { FrameInput } from "./input";
import { createRng } from "./rng";
import { type GameState, pushLog } from "./state";
import { createMap } from "../map/grid";
import { FEEL } from "../data/tuning";
import { updateCamera } from "../system/camera";
import { updateEffects } from "../system/effects";
import { updateEnemies } from "../system/enemies";
import { buildFloor } from "../system/floor";
import { updateRooms } from "../system/floor";
import { createPlayer } from "../system/player";
import { updatePlayer } from "../system/player";
import { updateProjectiles } from "../system/projectiles";

/** 内部解像度。ドット絵をそのまま整数倍で拡大する */
export const VIEW_W = 480;
export const VIEW_H = 270;

export function createGame(seed: number, seedText = String(seed)): GameState {
  const state: GameState = {
    seed,
    seedText,
    rng: createRng(seed),
    status: "playing",
    depth: 1,
    tick: 0,
    time: 0,
    map: createMap(1, 1),
    rooms: [],
    lockedTiles: new Set(),
    player: createPlayer({ x: 0, y: 0 }),
    enemies: [],
    projectiles: [],
    particles: [],
    texts: [],
    pickups: [],
    camera: { pos: { x: 0, y: 0 }, shake: 0, offset: { x: 0, y: 0 } },
    hitstop: 0,
    slowmo: 0,
    flash: 0,
    combo: { count: 0, timer: 0, best: 0, popTimer: 0 },
    kills: 0,
    score: 0,
    nextId: 1,
    log: [],
    deathTimer: 0,
  };
  buildFloor(state);
  pushLog(state, "WASD move / Space dash / J slash / K shoot / L burst", "#ffd75f");
  return state;
}

/** 固定ステップ 1 回ぶんの更新。dt は実時間 */
export function step(state: GameState, input: FrameInput, dt: number): void {
  if (state.status === "dead") {
    state.deathTimer += dt;
    updateEffects(state, dt * 0.5);
    updateCamera(state, dt, VIEW_W, VIEW_H);
    state.slowmo = Math.max(0, state.slowmo - dt);
    return;
  }

  if (state.hitstop > 0) {
    state.hitstop -= 1;
    updateCamera(state, dt, VIEW_W, VIEW_H);
    return;
  }

  const scale = state.slowmo > 0 ? FEEL.slowmoScale : 1;
  state.slowmo = Math.max(0, state.slowmo - dt);
  const gdt = dt * scale;
  state.tick += 1;
  state.time += gdt;

  updatePlayer(state, input, gdt);
  updateEnemies(state, gdt);
  updateProjectiles(state, gdt);
  updateRooms(state, gdt);
  updateCombo(state, gdt);
  updateEffects(state, gdt);
  updateCamera(state, dt, VIEW_W, VIEW_H);
}

function updateCombo(state: GameState, dt: number): void {
  const c = state.combo;
  c.popTimer = Math.max(0, c.popTimer - dt);
  if (c.count === 0) return;
  c.timer -= dt;
  if (c.timer <= 0) {
    c.count = 0;
    c.timer = 0;
  }
}
