import type { FrameInput } from "../core/input";
import { createRng } from "../core/rng";
import { createRuleRunState } from "../core/events";
import type { GameState, RoomState } from "../core/state";
import { createTerrainLayer } from "../core/terrain";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { FEEL } from "../data/tuning";
import { findPendingBud } from "../loot/provenance";
import { computeStats } from "../loot/stats";
import type { Profile } from "../loot/types";
import type { GameMap } from "../map/grid";
import type { SkillProfile } from "../skills/types";
import { createCodexRun } from "../meta/codex";
import { createQuestRun } from "../meta/quests";
import { createHurtLog } from "../core/hurt";
import { createBoonRunState } from "./boons";
import { snapCamera, updateCamera } from "./camera";
import { createContractState } from "./contractors";
import { createEconomyState } from "./economy";
import { updateEffects } from "./effects";
import { updateEnemies } from "./enemies";
import { resetExplored } from "./explore";
import { updateHazards } from "./hazards";
import { refillMana, tickMana } from "./mana";
import { applyStats, createPlayer, updatePlayer } from "./player";
import { updateProjectiles } from "./projectiles";
import { createRunEventState } from "./runEvents";
import { defaultRunSetup } from "./runSetup";
import { emptyRunMeta } from "./runMeta";
import { createSkillRunState } from "./skills";
import { updateStatusEffects } from "./statusEffects";
import { updateTerrain } from "./terrain";
import { resolveRules } from "./rules";
import { enforceLimits } from "./limits";

/**
 * 箱庭の state（拠点・武器指南書の実演）。createGame と同じ形だが sandbox 印を付け、ラン数を数えず、
 * フロア生成・起点・ジョブの初期化を通さない（ここでの行動を永続データとランに持ち込まない）。
 * 1 ステップは simulateSandbox（ランの step から部屋・死神・ランの出来事・祝福・規則を除いたもの）
 */

export interface SandboxOptions {
  profile: Profile;
  skillProfile: SkillProfile;
  /** 当たりの地図。部屋は map.rooms をそのまま制圧済みで使う */
  map: GameMap;
  start: Vec;
  seed: number;
  /** ヒットストップの強度（settings.hitstopScale） */
  hitstopScale: number;
}

export function createSandboxState(opts: SandboxOptions): GameState {
  const { profile, skillProfile, map, start, seed, hitstopScale } = opts;
  const setup = defaultRunSetup();
  const stats = computeStats(profile.equipment);
  const state: GameState = {
    seed,
    seedText: String(seed),
    rng: createRng(seed),
    status: "playing",
    depth: 1,
    tick: 0,
    time: 0,
    map,
    rooms: map.rooms.map(sandboxRoom),
    jins: [],
    noises: [],
    lockedTiles: new Set(),
    player: createPlayer({ ...start }, stats),
    enemies: [],
    projectiles: [],
    particles: [],
    texts: [],
    pickups: [],
    camera: { pos: { x: 0, y: 0 }, shake: 0, offset: { x: 0, y: 0 }, kick: { x: 0, y: 0 } },
    hitstop: 0,
    hitstopScale,
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
    sandbox: true,
    skills: createSkillRunState(skillProfile),
    hazards: [],
    terrain: createTerrainLayer(),
    corpses: [],
    boss: null,
    bossLog: [],
    hurt: createHurtLog(),
    nemesis: null,
    hiddenRoom: null,
    floorTime: 0,
    reaper: null,
    floorKind: "rooms",
    cursed: false,
    explored: new Uint8Array(0),
    exploredLog: [],
    boons: [],
    boonChoice: null,
    boonRun: createBoonRunState(),
    reforges: [],
    reforgeChoice: null,
    pendingBud: findPendingBud(profile),
    budOfferedThisRun: [],
    runKeystones: [],
    runEvents: createRunEventState(),
    modifiers: [...setup.modifiers],
    origin: setup.origin,
    job: "none",
    lockedRelics: [],
    runMeta: emptyRunMeta(),
    stairs: [],
    pendingExit: null,
    contracts: createContractState(),
    economy: createEconomyState(),
    events: [],
    pendingEvents: [],
    recent: {},
    ruleIcd: new Map(),
    chains: [],
    ruleRun: createRuleRunState(),
    codexRun: createCodexRun(),
    questRun: createQuestRun(),
  };
  applyStats(state, stats);
  refillMana(state);
  resetExplored(state);
  snapCamera(state);
  return state;
}

/** 箱庭の部屋は最初から制圧済み（封鎖・増援・報酬の処理に乗せない） */
function sandboxRoom(rect: RoomState["rect"]): RoomState {
  return { rect, cleared: true, locked: false, doorTiles: [], kind: "normal", wave: 0, used: false };
}

/**
 * 箱庭の 1 固定ステップのうち、止め（ヒットストップ）の外の分。止めの扱いは呼び出し側。
 * rules = 地形と統一ルール（武器種の固有効果・放出の上乗せ）と弾の数の歯止めも回す（武器指南書の実演は本編と同じ見え方にする）
 */
export function simulateSandbox(state: GameState, input: FrameInput, dt: number, rules = false): void {
  const scale = state.slowmo > 0 ? FEEL.slowmoScale : 1;
  state.slowmo = Math.max(0, state.slowmo - dt);
  const gdt = dt * scale;
  state.tick += 1;
  state.time += gdt;
  tickMana(state, gdt);
  updatePlayer(state, input, gdt);
  updateStatusEffects(state, gdt);
  if (rules) updateTerrain(state, gdt);
  updateEnemies(state, gdt);
  updateProjectiles(state, gdt);
  updateHazards(state, gdt);
  decayCombo(state, gdt);
  if (rules) {
    resolveRules(state, gdt);
    enforceLimits(state);
  }
  updateEffects(state, gdt);
  updateCamera(state, dt, VIEW_W, VIEW_H);
}

/** コンボの途切れ。game.ts の updateCombo と同じ（非公開なので箱庭側に持つ）。放置すると倍率が積み上がる */
function decayCombo(state: GameState, dt: number): void {
  const c = state.combo;
  c.popTimer = Math.max(0, c.popTimer - dt);
  if (c.count === 0) return;
  c.timer -= dt;
  if (c.timer > 0) return;
  c.count = 0;
  c.timer = 0;
}
