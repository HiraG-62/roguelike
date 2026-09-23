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
import { applyStats, createPlayer } from "../system/player";
import { refillMana, tickMana } from "../system/mana";
import { updatePlayer } from "../system/player";
import { updateProjectiles } from "../system/projectiles";
import { VIEW_H, VIEW_W } from "./view";
import { type Profile, createEmptyProfile, uniformAttributes } from "../loot/types";
import { computeStats } from "../loot/stats";
import { findPendingBud } from "../loot/provenance";
import { updateStatusEffects } from "../system/statusEffects";
import { updateTerrain } from "../system/terrain";
import { createTerrainLayer } from "./terrain";
import { updateHazards } from "../system/hazards";
import { updateReaper } from "../system/reaper";
import { createSkillRunState } from "../system/skills";
import { createDefaultSkillProfile } from "../skills/persistence";
import type { SkillProfile } from "../skills/types";
import { createBoonRunState, updateBoonChoice, updateBoons } from "../system/boons";
import { createRunEventState, updateRunEvents } from "../system/runEvents";
import { type RunSetup, defaultRunSetup, originKeystones, startOrigin } from "../system/runSetup";
import { resolveRules } from "../system/rules";
import { createRuleRunState } from "./events";

/**
 * 新しいランを始める。profile.equipment から stats を畳み込んでプレイヤーに反映し、
 * profile.meta.runs を 1 増やす（死亡時の recordRun では runs を二重に数えない）
 */
export function createGame(
  seed: number,
  seedText = String(seed),
  profile: Profile = createEmptyProfile(),
  skillProfile: SkillProfile = createDefaultSkillProfile(),
  setup: RunSetup = defaultRunSetup(),
): GameState {
  const stats = computeStats(profile.equipment);
  profile.meta.runs += 1;
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
    player: createPlayer({ x: 0, y: 0 }, stats),
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
    profile,
    stats,
    floorItems: [],
    paused: false,
    sfx: [],
    shapes: [],
    runRecorded: false,
    skills: createSkillRunState(skillProfile),
    hazards: [],
    terrain: createTerrainLayer(),
    corpses: [],
    boss: null,
    floorTime: 0,
    reaper: null,
    floorKind: "rooms",
    cursed: false,
    explored: new Uint8Array(0),
    exploredLog: [],
    boons: [],
    boonChoice: null,
    boonRun: createBoonRunState(),
    pendingBud: findPendingBud(profile),
    runAttributes: { alloc: uniformAttributes(0), unspent: 0 },
    runKeystones: originKeystones(setup.origin),
    runEvents: createRunEventState(),
    modifiers: [...setup.modifiers],
    origin: setup.origin,
    stairs: [],
    events: [],
    pendingEvents: [],
    recent: {},
    ruleIcd: new Map(),
    chains: [],
    ruleRun: createRuleRunState(),
  };
  // 祝福の畳み込み元（boonRun.baseStats）を覚えつつ、ステータスの派生（deriveAttributes）を通す
  applyStats(state, stats);
  refillMana(state);
  // 起点の初期効果（祝福・刻印符・振り分け点）。放浪者は何もしない（乱数も消費しない）
  startOrigin(state);
  buildFloor(state);
  pushLog(state, "操作: WASD 移動 / Space ダッシュ / 左クリック 斬撃 / 右クリック 射撃 / F バースト", "#ffd75f");
  return state;
}

/** 固定ステップ 1 回ぶんの更新。dt は実時間 */
export function step(state: GameState, input: FrameInput, dt: number): void {
  if (state.paused) return;
  if (state.status === "dead") {
    state.deathTimer += dt;
    updateEffects(state, dt * 0.5);
    updateCamera(state, dt, VIEW_W, VIEW_H);
    state.slowmo = Math.max(0, state.slowmo - dt);
    return;
  }

  if (state.boonChoice) {
    updateBoonChoice(state, input, dt);
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

  tickMana(state, gdt);
  updatePlayer(state, input, gdt);
  updateBoons(state, gdt);
  updateStatusEffects(state, gdt);
  updateTerrain(state, gdt);
  updateEnemies(state, gdt);
  updateProjectiles(state, gdt);
  updateHazards(state, gdt);
  updateRooms(state, gdt);
  updateRunEvents(state, gdt);
  updateReaper(state, gdt);
  updateCombo(state, gdt);
  resolveRules(state, gdt);
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
