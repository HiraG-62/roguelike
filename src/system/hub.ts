import type { FrameInput } from "../core/input";
import { createRng } from "../core/rng";
import { createRuleRunState } from "../core/events";
import type { GameState, RoomState } from "../core/state";
import { createTerrainLayer } from "../core/terrain";
import { dist } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { FEEL, HUB } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { KEYSTONES } from "../loot/affixes";
import { findPendingBud } from "../loot/provenance";
import { computeStats } from "../loot/stats";
import { type Profile, uniformAttributes } from "../loot/types";
import { HUB_SPOT_KEYS, type HubLayout, type HubSpotKey, buildHubMap } from "../map/hubMap";
import type { SkillProfile } from "../skills/types";
import { createCodexRun } from "../meta/codex";
import { createQuestRun } from "../meta/quests";
import { createBoonRunState } from "./boons";
import { snapCamera, updateCamera } from "./camera";
import { createContractState } from "./contractors";
import { updateEffects } from "./effects";
import { createEnemy, updateEnemies } from "./enemies";
import { resetExplored } from "./explore";
import { updateHazards } from "./hazards";
import { refillMana, tickMana } from "./mana";
import { applyStats, createPlayer, updatePlayer } from "./player";
import { updateProjectiles } from "./projectiles";
import { createRunEventState } from "./runEvents";
import { defaultRunSetup, refreshRunStats } from "./runSetup";
import { createSkillRunState } from "./skills";
import { DUMMY_KEY } from "./specialRooms";
import { updateStatusEffects } from "./statusEffects";

export interface HubRun {
  layout: HubLayout;
  near: HubSpotKey | null;
  /** 決定キーを押し続けている秒 */
  departHold: number;
  trialKeystone: string | null;
  /** 木人ごとの立ち直りまでの残り秒（0 = 立っている） */
  dummyTimers: number[];
  /** 木人ごとの今立っている敵の id（立て直しで倒れたかを見分ける） */
  dummyIds: number[];
  /** 反応する台（拠点の成長で建った設備。src/meta/hub.ts が決める） */
  available: ReadonlySet<HubSpotKey>;
}

export interface HubSession {
  state: GameState;
  hub: HubRun;
}

export type HubAction =
  | { kind: "none" }
  | { kind: "open"; spot: HubSpotKey }
  | { kind: "depart" };

const NONE: HubAction = { kind: "none" };
/** 拠点の部屋は 1 つだけ */
const HUB_ROOM = 0;

/**
 * 拠点の state を作る。createGame と同じ形だが、sandbox 印を付け、ラン数を数えず、
 * フロア生成・起点・ジョブの初期化を通さない（拠点での行動を永続データとランに持ち込まない）
 */
export function createHub(profile: Profile, skillProfile: SkillProfile, available: ReadonlySet<HubSpotKey>): HubSession {
  const layout = buildHubMap();
  const state = createHubState(profile, skillProfile, layout);
  const hub: HubRun = {
    layout,
    near: null,
    departHold: 0,
    trialKeystone: null,
    dummyTimers: layout.dummySpots.map(() => 0),
    dummyIds: layout.dummySpots.map((pos) => placeDummy(state, pos)),
    available,
  };
  return { state, hub };
}

function createHubState(profile: Profile, skillProfile: SkillProfile, layout: HubLayout): GameState {
  const setup = defaultRunSetup();
  const stats = computeStats(profile.equipment);
  const state: GameState = {
    seed: HUB.seed,
    seedText: String(HUB.seed),
    rng: createRng(HUB.seed),
    status: "playing",
    depth: 1,
    tick: 0,
    time: 0,
    map: layout.map,
    rooms: layout.map.rooms.map(hubRoom),
    lockedTiles: new Set(),
    player: createPlayer({ ...layout.playerStart }, stats),
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
    sandbox: true,
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
    runKeystones: [],
    runEvents: createRunEventState(),
    modifiers: [...setup.modifiers],
    origin: setup.origin,
    job: "none",
    lockedRelics: [],
    stairs: [],
    contracts: createContractState(),
    shards: 0,
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

/** 拠点の部屋は最初から制圧済み（封鎖・増援・報酬の処理に乗せない） */
function hubRoom(rect: RoomState["rect"]): RoomState {
  return { rect, cleared: true, locked: false, doorTiles: [], kind: "normal", wave: 0, used: false };
}

/** 試し場と同じく、撃破数・ドロップに数えない木人を置く。置いた敵の id を返す */
function placeDummy(state: GameState, pos: { x: number; y: number }): number {
  const e = createEnemy(state, enemyDef(DUMMY_KEY), pos, HUB_ROOM, false);
  e.revived = true;
  state.enemies.push(e);
  return e.id;
}

/**
 * 拠点の 1 固定ステップ。ランの step から部屋・死神・ランの出来事・祝福・規則を除いたもの。
 * confirmHeld は決定キーの押しっぱなし（FrameInput はエッジしか持たないので呼び出し側が渡す）
 */
export function stepHub(session: HubSession, input: FrameInput, dt: number, confirmHeld = false): HubAction {
  const { state, hub } = session;
  if (state.paused) return NONE;
  if (state.hitstop > 0) {
    state.hitstop -= 1;
    updateCamera(state, dt, VIEW_W, VIEW_H);
    return NONE;
  }
  simulate(state, input, dt);
  updateDummies(session, dt);
  hub.near = nearestSpot(session);
  if (hub.near && input.interactPressed) {
    hub.departHold = 0;
    return { kind: "open", spot: hub.near };
  }
  return updateDepartHold(hub, confirmHeld, dt);
}

function simulate(state: GameState, input: FrameInput, dt: number): void {
  const scale = state.slowmo > 0 ? FEEL.slowmoScale : 1;
  state.slowmo = Math.max(0, state.slowmo - dt);
  const gdt = dt * scale;
  state.tick += 1;
  state.time += gdt;
  tickMana(state, gdt);
  updatePlayer(state, input, gdt);
  updateStatusEffects(state, gdt);
  updateEnemies(state, gdt);
  updateProjectiles(state, gdt);
  updateHazards(state, gdt);
  decayCombo(state, gdt);
  updateEffects(state, gdt);
  updateCamera(state, dt, VIEW_W, VIEW_H);
}

/** コンボの途切れ。game.ts の updateCombo と同じ（非公開なので拠点側に持つ）。放置すると拠点で倍率が積み上がる */
function decayCombo(state: GameState, dt: number): void {
  const c = state.combo;
  c.popTimer = Math.max(0, c.popTimer - dt);
  if (c.count === 0) return;
  c.timer -= dt;
  if (c.timer > 0) return;
  c.count = 0;
  c.timer = 0;
}

function updateDepartHold(hub: HubRun, confirmHeld: boolean, dt: number): HubAction {
  if (!confirmHeld) {
    hub.departHold = 0;
    return NONE;
  }
  hub.departHold += dt;
  if (hub.departHold < HUB.departHold) return NONE;
  hub.departHold = 0;
  return { kind: "depart" };
}

/** 倒れた木人（updateEnemies が一覧から外す）を HUB.dummyRespawn 秒後に同じ位置へ置き直す */
function updateDummies(session: HubSession, dt: number): void {
  const { state, hub } = session;
  const alive = new Set(state.enemies.filter((e) => e.hp > 0).map((e) => e.id));
  hub.layout.dummySpots.forEach((pos, i) => {
    const timer = hub.dummyTimers[i] ?? 0;
    if (timer > 0) {
      const left = timer - dt;
      hub.dummyTimers[i] = Math.max(0, left);
      if (left <= 0) hub.dummyIds[i] = placeDummy(state, pos);
      return;
    }
    const id = hub.dummyIds[i];
    if (id !== undefined && alive.has(id)) return;
    state.enemies = state.enemies.filter((e) => e.id !== id);
    hub.dummyTimers[i] = HUB.dummyRespawn;
  });
}

/** HUB.interactRadius 以内で一番近い、使える台 */
export function nearestSpot(session: HubSession): HubSpotKey | null {
  const { state, hub } = session;
  const pos = state.player.body.pos;
  let best: HubSpotKey | null = null;
  let bestDist: number = HUB.interactRadius;
  for (const key of HUB_SPOT_KEYS) {
    if (!hub.available.has(key)) continue;
    const d = dist(pos, hub.layout.spots[key]);
    if (d > bestDist) continue;
    best = key;
    bestDist = d;
  }
  return best;
}

/** 祭壇で誓約を試す。持っていない誓約も付けられる。拠点を出ると state ごと捨てるので残らない */
export function setTrialKeystone(session: HubSession, key: string | null): void {
  session.hub.trialKeystone = key;
  session.state.runKeystones = key ? [key] : [];
  refreshRunStats(session.state);
}

/** 祭壇に並べる誓約（全種） */
export function trialKeystoneKeys(): string[] {
  return KEYSTONES.map((d) => d.key);
}
