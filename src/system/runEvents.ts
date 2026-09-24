import type { Enemy, GameState, RoomState } from "../core/state";
import { pushLog, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { RUN_EVENT, RUN_MOD } from "../data/tuning";
import { type EchoWallet, createEchoWallet } from "../loot/crafting";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { healPlayer } from "./combat";
import { addFloatingText, shake } from "./effects";
import { engagedRoomIndex } from "./engagement";
import { eliteKindsFor, makeElite, rollElite } from "./elites";
import { type Impact, pushImpact, updateImpacts } from "./impacts";
import { type LingerState, createLingerState, resetLinger, updateLinger } from "./linger";
import { dropBonusReward, dropItem } from "./loot";
import { refillMana } from "./mana";
import { circlesOverlap, overlapsWall } from "./physics";
import { dropRareItem } from "./roomTypes";
import { hasMod } from "./runSetup";
import { roomHooks } from "./specialRooms";
import { applyStatus } from "./statusEffects";

/**
 * ランイベント（docs/ideas/run-expansion.md 3 章）。部屋に入った時・階に入った時・時間・制圧で起きる一時的なルール変更。
 * すべて予告（HUD の 1 行 + 効果音）から RUN_EVENT.warnTime 秒後に始まる。
 * 同時に持てるのは「部屋の枠」1 つと「階の枠」1 つ。発生はすべて state.rng で決定的
 */

export const RUN_EVENT_KEYS = [
  "reinforce",
  "bounty",
  "blackout",
  "quake",
  "treasureRain",
  "manaDrought",
  "timeRift",
  "fog",
  "curseWind",
  "bloodMoon",
  "frenzyMoon",
  "meteor",
  "shrink",
  "momentum",
] as const;
export type RunEventKey = (typeof RUN_EVENT_KEYS)[number];

export interface RunEventDef {
  name: string;
  /** 予告の 1 行 */
  warn: string;
  /** 始まってからの 1 行 */
  active: string;
  /** room = 部屋の枠（制圧で終わるものが多い）/ floor = 階の枠（階を降りると終わる） */
  scope: "room" | "floor";
}

export const RUN_EVENTS: Readonly<Record<RunEventKey, RunEventDef>> = {
  reinforce: { name: "増援", warn: "扉の向こうから足音が迫る", active: "増援！ すぐに倒せば褒美", scope: "room" },
  bounty: { name: "賞金首", warn: "この階に賞金首がいる", active: "賞金首を倒せ", scope: "floor" },
  blackout: { name: "停電", warn: "明かりがちらつく", active: "停電: 燃える敵が灯りになる", scope: "room" },
  quake: { name: "地震", warn: "地鳴りがする", active: "地震: 落石に注意（敵にも当たる）", scope: "room" },
  treasureRain: { name: "宝の雨", warn: "天井がきしむ", active: "宝の雨！", scope: "room" },
  manaDrought: { name: "気力枯渇", warn: "空気が乾いていく", active: "気力枯渇: 制圧で気力が満ちる", scope: "room" },
  timeRift: { name: "刻の裂け目", warn: "空間が軋む", active: "刻の裂け目: 触れると敵が止まる", scope: "room" },
  fog: { name: "霧", warn: "霧が立ち込める", active: "霧: 視界が狭い", scope: "floor" },
  curseWind: { name: "呪いの風", warn: "生ぬるい風が吹く", active: "呪いの風: 次の部屋の精鋭 x2", scope: "room" },
  bloodMoon: { name: "血の月", warn: "月が赤く染まる", active: "血の月: 撃破で回復・敵が硬い", scope: "floor" },
  frenzyMoon: { name: "狂乱の月", warn: "月が揺らめく", active: "狂乱の月: 敵が迅速・報酬増", scope: "floor" },
  meteor: { name: "流星群", warn: "空が裂ける", active: "流星群: 着弾円に注意（敵にも当たる）", scope: "room" },
  shrink: { name: "縮みの呪い", warn: "敵の影が揺らぐ", active: "縮みの呪い: 敵が倍に・生命は半分", scope: "room" },
  momentum: { name: "勢いの風", warn: "背中を風が押す", active: "勢いの風: すぐ次の部屋へ", scope: "room" },
};

export interface ActiveRunEvent {
  key: RunEventKey;
  phase: "warn" | "active";
  /** 今の段階に入ってからの秒 */
  timer: number;
  /** active の長さ（Infinity は制圧・撃破まで） */
  duration: number;
  roomIndex: number;
  /** 賞金首の敵 id */
  targetId: number;
  /** 刻の裂け目の位置・賞金首の最後の位置 */
  pos: Vec | null;
  /** 賞金首の敵そのもの（倒されて配列から外れた後も、撃破か消滅かを見分ける） */
  target: Enemy | null;
  /** 落下物の次までの秒 */
  tick: number;
}

export interface RunEventState {
  room: ActiveRunEvent | null;
  floor: ActiveRunEvent | null;
  /** 次の部屋の枠のイベントが起きられるまでの秒 */
  cooldown: number;
  impacts: Impact[];
  /** 撃破数の差分を見る（血の月） */
  killsSeen: number;
  /** 時間で起きるイベントの抽選までの秒 */
  timedCheck: number;
  /** 部屋の砂時計: 今の交戦が続いている秒と、予告を出したか */
  lockTime: number;
  hourglassWarned: boolean;
  /** 鍛冶場・交換所で得た残響。main.ts が残響の保存へ移す（step の中で localStorage に触れない） */
  pendingEchoes: EchoWallet;
  linger: LingerState;
}

export function createRunEventState(): RunEventState {
  return {
    room: null,
    floor: null,
    cooldown: 0,
    impacts: [],
    killsSeen: 0,
    timedCheck: RUN_EVENT.timedAfter,
    lockTime: 0,
    hourglassWarned: false,
    pendingEchoes: createEchoWallet(),
    linger: createLingerState(),
  };
}

function eventsAllowed(state: GameState): boolean {
  return state.depth >= RUN_EVENT.minDepth;
}

function newEvent(key: RunEventKey, roomIndex: number): ActiveRunEvent {
  return { key, phase: "warn", timer: 0, duration: 0, roomIndex, targetId: -1, pos: null, target: null, tick: 0 };
}

/** 予告を出して枠に入れる（テスト・デバッグからも直接起こせる） */
export function scheduleRunEvent(state: GameState, key: RunEventKey, roomIndex: number): void {
  const ev = newEvent(key, roomIndex);
  if (RUN_EVENTS[key].scope === "floor") state.runEvents.floor = ev;
  else state.runEvents.room = ev;
  pushSfx(state, "runEventWarn");
  pushLog(state, `${RUN_EVENTS[key].name}: ${RUN_EVENTS[key].warn}`, RUN_EVENT.warnColor);
}

function rollFirst<K extends string>(state: GameState, table: Readonly<Record<K, number>>): K | null {
  for (const key of Object.keys(table) as K[]) {
    if (state.rng.chance(table[key])) return key;
  }
  return null;
}

// -----------------------------------------------------------------------------
// 起きる時（floor.ts から呼ぶ）
// -----------------------------------------------------------------------------

const FOG_BIOMES = new Set(["swamp", "meadow", "glacier"]);

/** 階に入った（buildFloor の最後）。前の階のイベント・落下物・代償を捨て、階の枠を抽選する */
export function onFloorStart(state: GameState): void {
  const ev = state.runEvents;
  ev.room = null;
  ev.floor = null;
  ev.impacts = [];
  ev.lockTime = 0;
  ev.hourglassWarned = false;
  ev.timedCheck = RUN_EVENT.timedAfter;
  ev.killsSeen = state.kills;
  resetLinger(state);
  if (!eventsAllowed(state)) return;
  const table = { ...RUN_EVENT.floorChance, fog: FOG_BIOMES.has(state.floorKind) ? RUN_EVENT.fogBiomeChance : RUN_EVENT.floorChance.fog };
  const key = rollFirst(state, table);
  if (key) scheduleRunEvent(state, key, -1);
}

/** 部屋を封鎖した。勢いの風を使い、部屋の枠を抽選する（縛り「絶えぬ増援」なら必ず増援） */
export function onRoomLocked(state: GameState, index: number): void {
  const ev = state.runEvents;
  ev.lockTime = 0;
  ev.hourglassWarned = false;
  if (ev.room?.key === "momentum" && ev.room.phase === "active") useMomentum(state, index);
  if (!eventsAllowed(state) || state.boss?.roomIndex === index || state.rooms[index]?.kind === "mirror") return;
  if (hasMod(state, "endlessReinforce") && !ev.room) {
    scheduleRunEvent(state, "reinforce", index);
    return;
  }
  if (ev.room || ev.cooldown > 0) return;
  const key = rollFirst(state, RUN_EVENT.lockChance);
  if (key) scheduleRunEvent(state, key, index);
}

/** 部屋を制圧した。部屋の枠のイベントを締め、報酬と次の抽選 */
export function onRoomCleared(state: GameState, room: RoomState, index: number): void {
  const ev = state.runEvents;
  ev.lockTime = 0;
  const current = ev.room;
  if (current && current.roomIndex === index) finishRoomEvent(state, current, room, true);
  if (ev.floor?.key === "frenzyMoon" && ev.floor.phase === "active") dropBonusReward(state, rectCenterPx(room.rect));
  if (!eventsAllowed(state) || ev.room || ev.cooldown > 0) return;
  const key = rollFirst(state, RUN_EVENT.clearChance);
  if (key) scheduleRunEvent(state, key, index);
}

/** 湧いた敵への縛りとイベントの効果（floor.ts の湧かせ処理から） */
export function onRunEnemySpawned(state: GameState, e: Enemy): void {
  let hpMul = 1;
  if (hasMod(state, "thickHide")) hpMul *= RUN_MOD.thickHideHpMul;
  if (activeFloor(state, "bloodMoon")) hpMul *= RUN_EVENT.bloodMoonHpMul;
  if (hpMul !== 1) scaleHp(e, hpMul);
  if (hasMod(state, "eliteSwarm") && !e.elite) rollElite(state, e);
  if (activeFloor(state, "frenzyMoon") && !e.elite) hasten(e);
}

function scaleHp(e: Enemy, mul: number): void {
  e.maxHp = Math.max(1, Math.round(e.maxHp * mul));
  e.hp = Math.max(1, Math.round(e.hp * mul));
  e.lastHp = e.hp;
}

function hasten(e: Enemy): void {
  if (enemyDef(e.defKey).boss) return;
  if (eliteKindsFor(enemyDef(e.defKey)).includes("hasted")) makeElite(e, "hasted");
}

function activeFloor(state: GameState, key: RunEventKey): boolean {
  const f = state.runEvents.floor;
  return f?.key === key && f.phase === "active";
}

function activeRoom(state: GameState, key: RunEventKey): boolean {
  const r = state.runEvents.room;
  return r?.key === key && r.phase === "active";
}

/** 停電中か（描画の暗闇と、isDark が読む） */
export function blackoutActive(state: GameState): boolean {
  return activeRoom(state, "blackout");
}

export function fogActive(state: GameState): boolean {
  return activeFloor(state, "fog");
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

export function updateRunEvents(state: GameState, dt: number): void {
  if (state.status !== "playing") return;
  const ev = state.runEvents;
  ev.cooldown = Math.max(0, ev.cooldown - dt);
  if (ev.room) tickEvent(state, ev.room, dt);
  if (ev.floor) tickEvent(state, ev.floor, dt);
  checkTimedEvents(state, dt);
  trackKills(state);
  applyQuickHands(state, dt);
  tickHourglass(state, dt);
  updateImpacts(state, dt);
  updateLinger(state, dt);
}

function tickEvent(state: GameState, current: ActiveRunEvent, dt: number): void {
  current.timer += dt;
  if (current.phase === "warn") {
    if (current.timer < RUN_EVENT.warnTime) return;
    current.phase = "active";
    current.timer = 0;
    activate(state, current);
    return;
  }
  tickActive(state, current, dt);
  if (current.timer >= current.duration) endEvent(state, current);
}

function endEvent(state: GameState, current: ActiveRunEvent): void {
  const ev = state.runEvents;
  if (ev.room === current) {
    ev.room = null;
    ev.cooldown = RUN_EVENT.cooldown;
  }
  if (ev.floor === current) ev.floor = null;
}

/** 時間で起きる: 階に入って timedAfter 秒後から checkInterval ごとに抽選 */
function checkTimedEvents(state: GameState, dt: number): void {
  const ev = state.runEvents;
  if (!eventsAllowed(state)) return;
  ev.timedCheck -= dt;
  if (ev.timedCheck > 0) return;
  ev.timedCheck = RUN_EVENT.checkInterval;
  if (ev.room || ev.cooldown > 0) return;
  const key = rollFirst(state, RUN_EVENT.timedChance);
  if (key) scheduleRunEvent(state, key, engagedRoomIndex(state));
}

/** 撃破数の差分: 血の月の回復 */
function trackKills(state: GameState): void {
  const ev = state.runEvents;
  const gained = state.kills - ev.killsSeen;
  ev.killsSeen = state.kills;
  if (gained > 0 && activeFloor(state, "bloodMoon")) healPlayer(state, gained * RUN_EVENT.bloodMoonHeal);
}

/** 縛り「早い手」: 予備動作の残りを余分に削る（1 - quickHandsCut の長さになる） */
function applyQuickHands(state: GameState, dt: number): void {
  if (!hasMod(state, "quickHands")) return;
  const extra = dt * (RUN_MOD.quickHandsCut / (1 - RUN_MOD.quickHandsCut));
  for (const e of state.enemies) {
    if (e.phase === "windup" && e.hp > 0) e.phaseTimer -= extra;
  }
}

/** 縛り「部屋の砂時計」: 交戦が長引くと予告して増援。以後も同じ間隔で繰り返す */
function tickHourglass(state: GameState, dt: number): void {
  if (!hasMod(state, "hourglass")) return;
  const index = engagedRoomIndex(state);
  if (index < 0 || state.boss?.roomIndex === index) return;
  const ev = state.runEvents;
  ev.lockTime += dt;
  if (!ev.hourglassWarned && ev.lockTime >= RUN_MOD.hourglassTime - RUN_EVENT.warnTime) {
    ev.hourglassWarned = true;
    pushSfx(state, "runEventWarn");
  }
  if (ev.lockTime < RUN_MOD.hourglassTime) return;
  ev.lockTime = 0;
  ev.hourglassWarned = false;
  roomHooks.spawnReinforcements(state, index, Math.round(roomHooks.enemyCount(state) * RUN_EVENT.reinforceMul), true);
  pushSfx(state, "ambush");
}

/** 部屋の砂時計の残り秒（交戦中でなければ null） */
export function hourglassLeft(state: GameState): number | null {
  if (!hasMod(state, "hourglass") || engagedRoomIndex(state) < 0) return null;
  return Math.max(0, RUN_MOD.hourglassTime - state.runEvents.lockTime);
}

// -----------------------------------------------------------------------------
// 始まる・続く・終わる
// -----------------------------------------------------------------------------

const INSTANT = 3;
const UNTIL_DONE = Number.POSITIVE_INFINITY;
/** 制圧まで続くものの安全弁 */
const ROOM_EVENT_MAX = 60;
const TEXT_LIFT = 20;

function announce(state: GameState, current: ActiveRunEvent): void {
  const def = RUN_EVENTS[current.key];
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - TEXT_LIFT }, def.name, RUN_EVENT.activeColor, 1.4, 1.4);
  pushSfx(state, "runEventStart");
}

function activate(state: GameState, current: ActiveRunEvent): void {
  announce(state, current);
  switch (current.key) {
    case "reinforce":
      current.duration = ROOM_EVENT_MAX;
      roomHooks.spawnReinforcements(state, current.roomIndex, Math.round(roomHooks.enemyCount(state) * RUN_EVENT.reinforceMul), true);
      shake(state, INSTANT);
      return;
    case "bounty":
      current.duration = UNTIL_DONE;
      markBounty(state, current);
      return;
    case "blackout":
      current.duration = RUN_EVENT.blackoutMax;
      return;
    case "quake":
      current.duration = RUN_EVENT.quake.duration;
      shake(state, INSTANT * 2);
      return;
    case "meteor":
      current.duration = RUN_EVENT.meteor.duration;
      return;
    case "treasureRain":
      current.duration = INSTANT;
      rainTreasure(state, current);
      return;
    case "manaDrought":
      current.duration = ROOM_EVENT_MAX;
      return;
    case "timeRift":
      current.duration = RUN_EVENT.riftTime;
      current.pos = riftPoint(state, current.roomIndex);
      return;
    case "fog":
      current.duration = RUN_EVENT.fogDuration;
      return;
    case "curseWind":
      current.duration = RUN_EVENT.curseWindShow;
      state.cursed = true;
      return;
    case "bloodMoon":
      current.duration = UNTIL_DONE;
      return;
    case "frenzyMoon":
      current.duration = UNTIL_DONE;
      for (const e of state.enemies) if (e.hp > 0 && !e.elite) hasten(e);
      return;
    case "shrink":
      current.duration = INSTANT;
      shrinkRoom(state, current.roomIndex);
      return;
    case "momentum":
      current.duration = RUN_EVENT.momentumWindow;
      return;
    default:
      return;
  }
}

function tickActive(state: GameState, current: ActiveRunEvent, dt: number): void {
  switch (current.key) {
    case "bounty":
      tickBounty(state, current);
      return;
    case "quake":
      dropImpacts(state, current, dt, RUN_EVENT.quake);
      return;
    case "meteor":
      dropImpacts(state, current, dt, RUN_EVENT.meteor);
      return;
    case "manaDrought":
      state.player.mana = Math.max(0, state.player.mana - RUN_EVENT.manaDrainPerSec * dt);
      return;
    case "timeRift":
      tickRift(state, current);
      return;
    default:
      return;
  }
}

/** 制圧で部屋の枠を締める。増援を早く倒した・マナ枯渇を耐えたら報酬 */
function finishRoomEvent(state: GameState, current: ActiveRunEvent, room: RoomState, cleared: boolean): void {
  const center = rectCenterPx(room.rect);
  if (current.phase === "active" && cleared) {
    if (current.key === "reinforce" && current.timer <= RUN_EVENT.reinforceBonusTime) {
      dropBonusReward(state, center);
      roomHooks.dropHeart(state, { x: center.x + TILE_SIZE, y: center.y });
      pushLog(state, "増援を蹴散らした。褒美だ。", RUN_EVENT.activeColor);
    }
    if (current.key === "manaDrought") refillMana(state);
  }
  // 勢いの風は次の部屋で使うので、制圧では消さない
  if (current.key === "momentum") return;
  endEvent(state, current);
}

// ---- 個別 ----

function markBounty(state: GameState, current: ActiveRunEvent): void {
  const candidates = state.enemies.filter((e) => {
    const room = state.rooms[e.roomIndex];
    return e.hp > 0 && !enemyDef(e.defKey).boss && room !== undefined && !room.cleared;
  });
  if (candidates.length === 0) {
    current.duration = 0;
    return;
  }
  const target = state.rng.pick(candidates);
  if (!target.elite) {
    const kinds = eliteKindsFor(enemyDef(target.defKey)).filter((k) => k === "hasted" || k === "shielded" || k === "bulwark");
    if (kinds.length > 0) makeElite(target, state.rng.pick(kinds));
  }
  current.targetId = target.id;
  current.target = target;
  current.pos = { ...target.body.pos };
}

function tickBounty(state: GameState, current: ActiveRunEvent): void {
  const target = current.target;
  if (target && target.hp > 0 && state.enemies.includes(target)) {
    current.pos = { ...target.body.pos };
    return;
  }
  current.duration = 0;
  // 消えた（自爆など）ときは報酬なし。倒したときだけ撃破の位置に落とす
  if (!target || target.vanished || target.hp > 0) return;
  const pos = current.pos ?? state.player.body.pos;
  dropRareItem(state, pos);
  state.score += RUN_EVENT.bountyScore;
  pushLog(state, "賞金首を仕留めた。", RUN_EVENT.activeColor);
}

/** 賞金首の敵（描画の印・ミニマップ用） */
export function bountyTargetId(state: GameState): number {
  const f = state.runEvents.floor;
  return f?.key === "bounty" && f.phase === "active" ? f.targetId : -1;
}

interface ImpactParams {
  interval: number;
  telegraph: number;
  radius: number;
  damage: number;
  spread: number;
}

function dropImpacts(state: GameState, current: ActiveRunEvent, dt: number, params: ImpactParams): void {
  current.tick -= dt;
  if (current.tick > 0) return;
  current.tick = params.interval;
  const p = state.player.body.pos;
  const angle = state.rng.next() * Math.PI * 2;
  const r = state.rng.next() * params.spread;
  const pos = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
  if (overlapsWall(state, pos.x, pos.y, 1)) return;
  pushImpact(state, pos, params.radius, params.telegraph, params.damage);
}

function rainTreasure(state: GameState, current: ActiveRunEvent): void {
  const room = state.rooms[current.roomIndex];
  const c = room ? rectCenterPx(room.rect) : { ...state.player.body.pos };
  const spot = (): Vec => {
    const a = state.rng.next() * Math.PI * 2;
    const pos = { x: c.x + Math.cos(a) * RUN_EVENT.rainSpread, y: c.y + Math.sin(a) * RUN_EVENT.rainSpread };
    return overlapsWall(state, pos.x, pos.y, 2) ? c : pos;
  };
  for (let i = 0; i < RUN_EVENT.rainItems; i++) dropItem(state, spot(), RUN_EVENT.rainRarityBoost);
  for (let i = 0; i < RUN_EVENT.rainHearts; i++) roomHooks.dropHeart(state, spot());
  pushSfx(state, "treasureOpen");
}

const RIFT_ATTEMPTS = 10;

function riftPoint(state: GameState, index: number): Vec {
  const room = state.rooms[index];
  if (!room) return { ...state.player.body.pos };
  const r = room.rect;
  for (let i = 0; i < RIFT_ATTEMPTS; i++) {
    const pos = { x: (r.x + 1 + state.rng.next() * (r.w - 2)) * TILE_SIZE, y: (r.y + 1 + state.rng.next() * (r.h - 2)) * TILE_SIZE };
    if (!overlapsWall(state, pos.x, pos.y, RUN_EVENT.riftRadius)) return pos;
  }
  return rectCenterPx(r);
}

/** 刻の裂け目に触れたら、部屋の敵を凍らせて敵弾を消す */
function tickRift(state: GameState, current: ActiveRunEvent): void {
  const pos = current.pos;
  const body = state.player.body;
  if (!pos || !circlesOverlap(pos.x, pos.y, RUN_EVENT.riftRadius, body.pos.x, body.pos.y, body.radius)) return;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "freeze", stacks: 1, duration: RUN_EVENT.riftFreeze, potency: 0 }, "env");
  }
  state.projectiles = state.projectiles.filter((pr) => pr.owner !== "enemy");
  state.slowmo = Math.max(state.slowmo, RUN_EVENT.riftFreeze * 0.2);
  current.duration = 0;
  pushLog(state, "刻が止まった。", RUN_EVENT.activeColor);
  pushSfx(state, "fountainHeal");
}

/** 縮みの呪い: 部屋の敵の HP を半分にし、同じくらいの数を足す（足した分も半分） */
function shrinkRoom(state: GameState, index: number): void {
  if (index < 0) return;
  roomHooks.spawnReinforcements(state, index, Math.round(roomHooks.enemyCount(state) * RUN_EVENT.shrinkExtraMul), true);
  for (const e of state.enemies) {
    if (e.roomIndex !== index || e.hp <= 0 || enemyDef(e.defKey).boss) continue;
    scaleHp(e, RUN_EVENT.shrinkHpMul);
  }
}

/** 勢いの風: 次の封鎖で足が速くなり、敵が 1 体減る */
function useMomentum(state: GameState, index: number): void {
  const p = state.player;
  p.buffs.speed = { time: RUN_EVENT.momentumSpeedTime, mul: RUN_EVENT.momentumSpeedMul };
  const victim = state.enemies.find((e) => e.roomIndex === index && e.hp > 0 && !enemyDef(e.defKey).boss);
  if (victim) {
    victim.vanished = true;
    victim.hp = 0;
  }
  const current = state.runEvents.room;
  if (current) endEvent(state, current);
  pushLog(state, "勢いに乗って飛び込んだ。", RUN_EVENT.activeColor);
}

// -----------------------------------------------------------------------------
// HUD 用
// -----------------------------------------------------------------------------

/** HUD に出す行（予告 / 実行中）。無ければ空 */
export function runEventHudLines(state: GameState): { text: string; warn: boolean }[] {
  const out: { text: string; warn: boolean }[] = [];
  for (const current of [state.runEvents.floor, state.runEvents.room]) {
    if (!current) continue;
    const def = RUN_EVENTS[current.key];
    if (current.phase === "warn") {
      out.push({ text: `予告: ${def.warn}`, warn: true });
      continue;
    }
    const left = Number.isFinite(current.duration) && current.duration < ROOM_EVENT_MAX ? ` ${Math.ceil(current.duration - current.timer)}秒` : "";
    out.push({ text: `${def.active}${left}`, warn: false });
  }
  return out;
}
