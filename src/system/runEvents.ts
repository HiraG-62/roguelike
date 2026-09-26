import { ELEMENTS, type Element, ELEMENT_LABEL } from "../core/element";
import type { Enemy, FloorKind, GameState, RoomState } from "../core/state";
import { pushLog, pushSfx } from "../core/state";
import { type Vec, normalize, sub } from "../core/vec";
import { depthHpScale, enemyDef } from "../data/enemies";
import { CONTRACT, ELITE_GREEDY, FLOOR_KIND, RUN_EVENT, RUN_MOD } from "../data/tuning";
import { type EchoWallet, createEchoWallet } from "../loot/crafting";
import { inversionChance } from "../loot/flux";
import { TILE_SIZE, inBounds, rectCenterPx, rectContainsPx, toIndex } from "../map/grid";
import { biomeShape, isInvertedDepth } from "./biomes";
import { BOONS, applyBoonsToStats, offerBoons } from "./boons";
import { coreKeepsCurses } from "./boonCores";
import { damageEnemy, damagePlayer, healPlayer, healSustained } from "./combat";
import { type Infusion, gainShards, grantCurse, removeBoon } from "./contractors";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { engagedRoomIndex } from "./engagement";
import { carriedCount, eliteKindsFor, makeElite, rollElite } from "./elites";
import { createEnemy } from "./enemies";
import { spawnSpot } from "./enemyTraits";
import { ROAMING_ROOM } from "./spawner";
import type { FloorItem } from "../loot/types";
import { type Impact, pushImpact, updateImpacts } from "./impacts";
import { type LingerState, createLingerState, resetLinger, updateLinger } from "./linger";
import { dropBonusReward, dropItem } from "./loot";
import { refillMana } from "./mana";
import { circlesOverlap, overlapsWall } from "./physics";
import { reaperAppearAfter } from "./reaper";
import { dropRareItem } from "./roomTypes";
import { hasMod } from "./runSetup";
import { addVein, invertTrait, roomHooks } from "./specialRooms";
import { applyStatus } from "./statusEffects";
import { placeTerrain } from "./terrain";

/**
 * ランイベント（docs/ideas/run-expansion.md 3 章）。部屋に入った時・階に入った時・時間・制圧で起きる一時的なルール変更。
 * すべて予告（HUD の 1 行 + 効果音）から RUN_EVENT.warnTime 秒後に始まる。
 * 同時に持てるのは「部屋の枠」1 つと「階の枠」1 つ。発生はすべて state.rng で決定的。
 * 無限の深み（FLOOR_KIND.deepDepth 以降）では階のイベントの一部が「変異」として常に効く
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
  // ---- 第 2 弾（docs/ideas/run-expansion.md 3 章の残り）----
  "curseVoice",
  "duel",
  "sluggish",
  "flood",
  "silence",
  "reactionSurge",
  "thunderstorm",
  "elementStorm",
  "reaperPass",
  "echoVein",
  "bats",
  "lifeFlow",
  "boonReroll",
  // ---- 2026-09-24 第 4 弾 ----
  "thiefChase",
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
  curseVoice: { name: "呪詛の声", warn: "呪いが囁く", active: `呪詛の声: 制圧までに ${RUN_EVENT.curseVoiceCombo} コンボ`, scope: "room" },
  duel: { name: "決闘の申し込み", warn: "精鋭が名乗りを上げる", active: "決闘: 名乗った敵を倒せ", scope: "room" },
  sluggish: { name: "鈍重", warn: "足が重くなる", active: "鈍重: ダッシュが遅く、直後の一撃が重い", scope: "room" },
  flood: { name: "地形の氾濫", warn: "床の下で何かが溢れる", active: "地形の氾濫: 地形が広がっていく", scope: "room" },
  silence: { name: "静寂", warn: "音が遠のく", active: "静寂: 気力が自然に戻らない（敵も術を封じられる）", scope: "room" },
  reactionSurge: { name: "反応の共振", warn: "空気が張り詰める", active: "反応の共振: 反応が周囲に広がる", scope: "room" },
  thunderstorm: { name: "雷鳴の刻", warn: "雷鳴が近づく", active: "雷鳴の刻: 落雷の円に注意（敵は感電する）", scope: "room" },
  elementStorm: { name: "属性の嵐", warn: "空の色が変わる", active: "属性の嵐", scope: "floor" },
  reaperPass: { name: "死神の通り道", warn: "赤い線の上を死神が通る", active: "死神の通り道: 線から離れろ", scope: "room" },
  echoVein: { name: "残響の鉱脈", warn: "壁の奥が光る", active: "残響の鉱脈: 光る鉱脈に触れると残響", scope: "room" },
  bats: { name: "蝙蝠の渡り", warn: "羽音が近づく", active: "蝙蝠の渡り: 倒すと気力が戻る", scope: "room" },
  lifeFlow: { name: "生命の逆流", warn: "脈が逆に打つ", active: "生命の逆流: 回復が気力に、気力が生命に", scope: "floor" },
  boonReroll: { name: "流れ星", warn: "星が流れる", active: "流れ星: 祝福を 1 つ引き直す", scope: "room" },
  thiefChase: { name: "盗賊の追跡", warn: "床の遺物を狙う影がある", active: "盗賊の追跡: 倒せば奪われた遺物が倍になる", scope: "room" },
};

export interface ActiveRunEvent {
  key: RunEventKey;
  phase: "warn" | "active";
  /** 今の段階に入ってからの秒 */
  timer: number;
  /** active の長さ（Infinity は制圧・撃破まで） */
  duration: number;
  roomIndex: number;
  /** 賞金首・決闘・盗賊の敵 id（盗賊の追跡は予告の間だけ狙う床の遺物の id） */
  targetId: number;
  /** 刻の裂け目の位置・賞金首の最後の位置・氾濫の源・死神の通り道の線の中心 */
  pos: Vec | null;
  /** 賞金首・決闘の敵そのもの（倒されて配列から外れた後も、撃破か消滅かを見分ける） */
  target: Enemy | null;
  /** 落下物・落雷・氾濫の次までの秒 */
  tick: number;
  /** 属性の嵐の属性 */
  element: Element | null;
  /** 汎用の記録（呪詛の声の最高コンボ・氾濫の地形・決闘の決着・通り道の当たり・鈍重の前ステップのダッシュ・盗賊が抱えた数） */
  memo: number;
  /** 静寂・生命の逆流の前ステップの生命と気力 */
  prevHp: number;
  prevMana: number;
  /** 死神の通り道の向き（単位ベクトル） */
  dir: Vec | null;
}

/** 雷鳴の刻の落雷の予告（円が満ちきると落ちる） */
export interface Strike {
  pos: Vec;
  timer: number;
  telegraph: number;
}

/** 階層構造（反転層・戻る・無限の深み。docs/ideas/run-expansion.md 4 章） */
export interface StrataState {
  /** このランで着いた最も深い階（戻ってから降り直しても階の報酬を二重に取らない） */
  deepest: number;
  /** 上り階段で戻った回数 */
  returns: number;
  /** 今の階は戻って来た階か（敵が半分・死神が早い） */
  revisit: boolean;
  /** 今の階に初めて着いたか（戻った階・降り直した階は false。階層到達の報酬を二重に出さないために他の system が読む） */
  fresh: boolean;
  /** 反転層の遺物の反転抽選を済ませた床アイテムの id の最大値 */
  lastItemId: number;
}

export interface RunEventState {
  room: ActiveRunEvent | null;
  floor: ActiveRunEvent | null;
  /** 次の部屋の枠のイベントが起きられるまでの秒 */
  cooldown: number;
  impacts: Impact[];
  /** 撃破数の差分を見る（血の月・蝙蝠の渡り） */
  killsSeen: number;
  /** 時間で起きるイベントの抽選までの秒 */
  timedCheck: number;
  /** 部屋の砂時計: 今の交戦が続いている秒と、予告を出したか */
  lockTime: number;
  hourglassWarned: boolean;
  /** 鍛冶場・交換所で得た残響。main.ts が残響の保存へ移す（step の中で localStorage に触れない） */
  pendingEchoes: EchoWallet;
  linger: LingerState;
  /** 雷鳴の刻の落雷 */
  strikes: Strike[];
  /** 無限の深み: 常に効いている階のイベント（変異）と、属性の嵐の変異の属性 */
  mutations: RunEventKey[];
  mutationElement: Element | null;
  /** 反応の共振の内部 CD の残り秒 */
  surgeIcd: number;
  strata: StrataState;
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
    strikes: [],
    mutations: [],
    mutationElement: null,
    surgeIcd: 0,
    strata: { deepest: 1, returns: 0, revisit: false, fresh: true, lastItemId: 0 },
  };
}

function eventsAllowed(state: GameState): boolean {
  return state.depth >= RUN_EVENT.minDepth;
}

function newEvent(key: RunEventKey, roomIndex: number): ActiveRunEvent {
  return {
    key,
    phase: "warn",
    timer: 0,
    duration: 0,
    roomIndex,
    targetId: -1,
    pos: null,
    target: null,
    tick: 0,
    element: null,
    memo: 0,
    prevHp: 0,
    prevMana: 0,
    dir: null,
  };
}

/** 予告を出して枠に入れる（テスト・デバッグからも直接起こせる） */
export function scheduleRunEvent(state: GameState, key: RunEventKey, roomIndex: number): void {
  const ev = newEvent(key, roomIndex);
  prepareWarn(state, ev);
  if (RUN_EVENTS[key].scope === "floor") state.runEvents.floor = ev;
  else state.runEvents.room = ev;
  pushSfx(state, "runEventWarn");
  pushLog(state, `${RUN_EVENTS[key].name}: ${RUN_EVENTS[key].warn}`, RUN_EVENT.warnColor);
}

const INFUSE_ELEMENTS: readonly Element[] = ELEMENTS.filter((e) => e !== "none");

/** 予告の間に見せる物を先に決める（死神の通り道の線・属性の嵐の属性・盗賊の狙う遺物） */
function prepareWarn(state: GameState, ev: ActiveRunEvent): void {
  if (ev.key === "elementStorm") ev.element = state.rng.pick(INFUSE_ELEMENTS);
  if (ev.key === "thiefChase") markThiefTarget(state, ev);
  if (ev.key !== "reaperPass") return;
  const horizontal = state.rng.chance(0.5);
  const sign = state.rng.chance(0.5) ? 1 : -1;
  ev.dir = horizontal ? { x: sign, y: 0 } : { x: 0, y: sign };
  ev.pos = { ...state.player.body.pos };
}

/** 表の順に確率で引く。allowed が false の種類は引かない（乱数も消費しない） */
function rollFirst<K extends RunEventKey>(state: GameState, table: Readonly<Record<K, number>>, allowed: (key: K) => boolean = () => true): K | null {
  for (const key of Object.keys(table) as K[]) {
    if (!allowed(key)) continue;
    if (state.rng.chance(table[key])) return key;
  }
  return null;
}

/** 条件つきのイベントが今起きられるか（呪い持ち・精鋭か 2 体以上・死神の猶予の半分・洞窟の形・階の枠の空き） */
function eventAllowed(state: GameState, key: RunEventKey, roomIndex: number): boolean {
  if (RUN_EVENTS[key].scope === "floor" && state.runEvents.floor) return false;
  switch (key) {
    case "curseVoice":
      return state.boons.some((k) => BOONS[k].cursed);
    case "duel":
      return duelChampion(state, roomIndex) !== null;
    case "reaperPass":
      return !state.reaper && state.floorTime >= reaperAppearAfter(state) * RUN_EVENT.reaperPass.minRatio;
    case "echoVein":
      return biomeShape(state.floorKind) === "cave";
    case "thiefChase":
      return thiefTargetItem(state) !== null;
    default:
      return true;
  }
}

// -----------------------------------------------------------------------------
// 起きる時（floor.ts から呼ぶ）
// -----------------------------------------------------------------------------

const FOG_BIOMES = new Set(["swamp", "meadow", "glacier"]);

/** 階の枠のイベントを 1 回抽選する（kind を渡すと霧の出やすいバイオームを考える）。占いが先読みにも使う */
export function rollFloorEventKey(state: GameState, kind: FloorKind | null = null): RunEventKey | null {
  const fog = kind !== null && FOG_BIOMES.has(kind) ? RUN_EVENT.fogBiomeChance : RUN_EVENT.floorChance.fog;
  return rollFirst(state, { ...RUN_EVENT.floorChance, fog });
}

/** 変異になる階のイベント（積む順） */
const MUTATION_KEYS: readonly RunEventKey[] = ["frenzyMoon", "bloodMoon", "fog", "elementStorm"];

/** 無限の深み: この深度で常に効く変異（deepDepth から mutationEvery 階ごとに 1 つ増える） */
export function mutationsFor(depth: number): RunEventKey[] {
  if (depth < FLOOR_KIND.deepDepth) return [];
  const count = 1 + Math.floor((depth - FLOOR_KIND.deepDepth) / FLOOR_KIND.mutationEvery);
  return MUTATION_KEYS.slice(0, Math.min(count, MUTATION_KEYS.length));
}

/**
 * 階に入った（buildFloor の最後）。前の階のイベント・落下物・代償を捨て、変異を積み直し、階の枠を抽選する。
 * 占いが次の階を読んでいれば、その結果（calm = 何も起きない）を使って抽選しない
 */
export function onFloorStart(state: GameState): void {
  const ev = state.runEvents;
  ev.room = null;
  ev.floor = null;
  ev.impacts = [];
  ev.strikes = [];
  ev.surgeIcd = 0;
  ev.lockTime = 0;
  ev.hourglassWarned = false;
  ev.timedCheck = RUN_EVENT.timedAfter;
  ev.killsSeen = state.kills;
  ev.mutations = mutationsFor(state.depth);
  ev.mutationElement = ev.mutations.length > 0 ? (INFUSE_ELEMENTS[state.depth % INFUSE_ELEMENTS.length] ?? "fire") : null;
  resetLinger(state);
  const foretold = state.contracts.foretold;
  state.contracts.foretold = null;
  if (!eventsAllowed(state)) return;
  if (foretold !== null) {
    if (foretold !== "calm") scheduleRunEvent(state, foretold, -1);
    return;
  }
  const key = rollFloorEventKey(state, state.floorKind);
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
  const key = rollFirst(state, RUN_EVENT.lockChance, (k) => eventAllowed(state, k, index));
  if (key) scheduleRunEvent(state, key, index);
}

/** 部屋を制圧した。部屋の枠のイベントを締め、報酬と次の抽選 */
export function onRoomCleared(state: GameState, room: RoomState, index: number): void {
  const ev = state.runEvents;
  ev.lockTime = 0;
  const current = ev.room;
  if (current && current.roomIndex === index) finishRoomEvent(state, current, room, true);
  if (floorActive(state, "frenzyMoon")) dropBonusReward(state, rectCenterPx(room.rect));
  if (!eventsAllowed(state) || ev.room || ev.cooldown > 0) return;
  const key = rollFirst(state, RUN_EVENT.clearChance, (k) => eventAllowed(state, k, index));
  if (key) scheduleRunEvent(state, key, index);
}

/** 湧いた敵への縛り・イベント・階層の効果（floor.ts の湧かせ処理から） */
export function onRunEnemySpawned(state: GameState, e: Enemy): void {
  let hpMul = deepHpMul(state.depth);
  if (hasMod(state, "thickHide")) hpMul *= RUN_MOD.thickHideHpMul;
  if (floorActive(state, "bloodMoon")) hpMul *= RUN_EVENT.bloodMoonHpMul;
  if (hpMul !== 1) scaleHp(e, hpMul);
  if (hasMod(state, "eliteSwarm") && !e.elite) rollElite(state, e);
  // 反転層: 敵はエリートの抽選を 1 回多く引く
  if (isInvertedDepth(state.depth) && !e.elite && !enemyDef(e.defKey).boss) rollElite(state, e);
  if (floorActive(state, "frenzyMoon") && !e.elite) hasten(e);
}

/** 無限の深み: HP の伸びを deepHpSlope まで寝かせる倍率（深みより浅ければ 1） */
export function deepHpMul(depth: number): number {
  if (depth <= FLOOR_KIND.deepDepth) return 1;
  const target = depthHpScale(FLOOR_KIND.deepDepth) + (depth - FLOOR_KIND.deepDepth) * FLOOR_KIND.deepHpSlope;
  return target / depthHpScale(depth);
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

/** 階の枠で実行中か、変異として常に効いているか */
function floorActive(state: GameState, key: RunEventKey): boolean {
  return activeFloor(state, key) || state.runEvents.mutations.includes(key);
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
  return floorActive(state, "fog");
}

/** 属性の嵐で通常攻撃に乗る属性（嵐が無ければ null。contractors.ts の ensureContractStats が読む） */
export function activeElementStorm(state: GameState): Infusion | null {
  const f = state.runEvents.floor;
  if (f?.key === "elementStorm" && f.phase === "active" && f.element) return { element: f.element, share: RUN_EVENT.elementStormShare };
  const el = state.runEvents.mutationElement;
  if (state.runEvents.mutations.includes("elementStorm") && el) return { element: el, share: RUN_EVENT.elementStormShare };
  return null;
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

export function updateRunEvents(state: GameState, dt: number): void {
  if (state.status !== "playing") return;
  const ev = state.runEvents;
  ev.cooldown = Math.max(0, ev.cooldown - dt);
  ev.surgeIcd = Math.max(0, ev.surgeIcd - dt);
  if (ev.room) tickEvent(state, ev.room, dt);
  if (ev.floor) tickEvent(state, ev.floor, dt);
  checkTimedEvents(state, dt);
  trackKills(state);
  applyQuickHands(state, dt);
  tickHourglass(state, dt);
  updateImpacts(state, dt);
  updateStrikes(state, dt);
  updateLinger(state, dt);
  invertNewDrops(state);
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
  if (current.key === "reaperPass" && current.phase === "active") finishReaperPass(state);
  if (current.key === "thiefChase" && current.phase === "active") thiefEscapes(state, current);
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
  const index = engagedRoomIndex(state);
  const key = rollFirst(state, RUN_EVENT.timedChance, (k) => eventAllowed(state, k, index));
  if (key) scheduleRunEvent(state, key, index);
}

/** 撃破数の差分: 血の月の回復・蝙蝠の渡りの気力 */
function trackKills(state: GameState): void {
  const ev = state.runEvents;
  const gained = state.kills - ev.killsSeen;
  ev.killsSeen = state.kills;
  if (gained <= 0) return;
  if (floorActive(state, "bloodMoon")) healPlayer(state, gained * RUN_EVENT.bloodMoonHeal);
  if (activeRoom(state, "bats")) {
    const p = state.player;
    p.mana = Math.min(state.stats.maxMana, p.mana + gained * RUN_EVENT.bats.manaPerKill);
  }
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
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - TEXT_LIFT }, eventTitle(current), RUN_EVENT.activeColor, 1.4, 1.4);
  pushSfx(state, "runEventStart");
}

/** 浮き文字の名前（属性の嵐は属性つき） */
function eventTitle(current: ActiveRunEvent): string {
  const name = RUN_EVENTS[current.key].name;
  return current.element ? `${name}（${ELEMENT_LABEL[current.element]}）` : name;
}

function activate(state: GameState, current: ActiveRunEvent): void {
  announce(state, current);
  if (activateClassic(state, current)) return;
  activateWave2(state, current);
}

/** 第 1 弾のイベント。扱ったら true */
function activateClassic(state: GameState, current: ActiveRunEvent): boolean {
  switch (current.key) {
    case "reinforce":
      current.duration = ROOM_EVENT_MAX;
      roomHooks.spawnReinforcements(state, current.roomIndex, Math.round(roomHooks.enemyCount(state) * RUN_EVENT.reinforceMul), true);
      shake(state, INSTANT);
      return true;
    case "bounty":
      current.duration = UNTIL_DONE;
      markBounty(state, current);
      return true;
    case "blackout":
      current.duration = RUN_EVENT.blackoutMax;
      return true;
    case "quake":
      current.duration = RUN_EVENT.quake.duration;
      shake(state, INSTANT * 2);
      return true;
    case "meteor":
      current.duration = RUN_EVENT.meteor.duration;
      return true;
    case "treasureRain":
      current.duration = INSTANT;
      rainTreasure(state, current);
      return true;
    case "manaDrought":
      current.duration = ROOM_EVENT_MAX;
      return true;
    case "timeRift":
      current.duration = RUN_EVENT.riftTime;
      current.pos = riftPoint(state, current.roomIndex);
      return true;
    case "fog":
      current.duration = RUN_EVENT.fogDuration;
      return true;
    case "curseWind":
      current.duration = RUN_EVENT.curseWindShow;
      state.cursed = true;
      return true;
    case "bloodMoon":
      current.duration = UNTIL_DONE;
      return true;
    case "frenzyMoon":
      current.duration = UNTIL_DONE;
      for (const e of state.enemies) if (e.hp > 0 && !e.elite) hasten(e);
      return true;
    case "shrink":
      current.duration = INSTANT;
      shrinkRoom(state, current.roomIndex);
      return true;
    case "momentum":
      current.duration = RUN_EVENT.momentumWindow;
      return true;
    default:
      return false;
  }
}

/** 第 2 弾のイベント */
function activateWave2(state: GameState, current: ActiveRunEvent): void {
  const p = state.player;
  switch (current.key) {
    case "curseVoice":
    case "sluggish":
    case "reactionSurge":
      current.duration = ROOM_EVENT_MAX;
      return;
    case "duel":
      current.duration = ROOM_EVENT_MAX;
      startDuel(state, current);
      return;
    case "flood":
      current.duration = RUN_EVENT.flood.duration;
      current.memo = state.rng.chance(0.5) ? 1 : 0;
      current.pos = riftPoint(state, current.roomIndex);
      return;
    case "silence":
      current.duration = ROOM_EVENT_MAX;
      current.prevMana = p.mana;
      silenceRoom(state, current.roomIndex);
      return;
    case "thunderstorm":
      current.duration = RUN_EVENT.thunder.duration;
      return;
    case "elementStorm":
      current.duration = UNTIL_DONE;
      return;
    case "reaperPass":
      current.duration = (RUN_EVENT.reaperPass.span * 2) / RUN_EVENT.reaperPass.speed;
      return;
    case "echoVein":
      current.duration = INSTANT;
      if (!addVein(state, roomNear(state, current.roomIndex))) current.duration = 0;
      return;
    case "bats":
      current.duration = RUN_EVENT.bats.duration;
      releaseBats(state, roomNear(state, current.roomIndex));
      return;
    case "lifeFlow":
      current.duration = RUN_EVENT.lifeFlow.duration;
      current.prevHp = p.hp;
      current.prevMana = p.mana;
      return;
    case "boonReroll":
      current.duration = INSTANT;
      rerollBoon(state);
      return;
    case "thiefChase":
      current.duration = RUN_EVENT.thief.duration;
      releaseThief(state, current);
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
    case "curseVoice":
      current.memo = Math.max(current.memo, state.combo.count);
      return;
    case "duel":
      tickDuel(state, current);
      return;
    case "sluggish":
      tickSluggish(state, current);
      return;
    case "flood":
      tickFlood(state, current, dt);
      return;
    case "silence":
      tickSilence(state, current, dt);
      return;
    case "reactionSurge":
      tickSurge(state);
      return;
    case "thunderstorm":
      dropStrikes(state, current, dt);
      return;
    case "reaperPass":
      tickReaperPass(state, current);
      return;
    case "lifeFlow":
      tickLifeFlow(state, current);
      return;
    case "thiefChase":
      tickThief(state, current);
      return;
    default:
      return;
  }
}

/** 制圧で部屋の枠を締める。増援を早く倒した・マナ枯渇を耐えた・呪詛の声に応えた・静寂を越えたら報酬 */
function finishRoomEvent(state: GameState, current: ActiveRunEvent, room: RoomState, cleared: boolean): void {
  const center = rectCenterPx(room.rect);
  if (current.phase === "active" && cleared) rewardRoomEvent(state, current, center);
  // 勢いの風は次の部屋で使うので、制圧では消さない。死神の通り道・蝙蝠・盗賊は部屋に縛られない
  if (current.key === "momentum" || current.key === "reaperPass" || current.key === "bats" || current.key === "thiefChase") return;
  endEvent(state, current);
}

function rewardRoomEvent(state: GameState, current: ActiveRunEvent, center: Vec): void {
  switch (current.key) {
    case "reinforce":
      if (current.timer > RUN_EVENT.reinforceBonusTime) return;
      dropBonusReward(state, center);
      roomHooks.dropHeart(state, { x: center.x + TILE_SIZE, y: center.y });
      pushLog(state, "増援を蹴散らした。褒美だ。", RUN_EVENT.activeColor);
      return;
    case "manaDrought":
    case "silence":
      refillMana(state);
      return;
    case "curseVoice":
      answerCurseVoice(state, current);
      return;
    default:
      return;
  }
}

// ---- 第 1 弾の個別 ----

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
  gainShards(state, CONTRACT.shardsBounty);
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

/** プレイヤーの周り spread 以内の壁でない点（壁なら null） */
function spotAround(state: GameState, spread: number): Vec | null {
  const p = state.player.body.pos;
  const angle = state.rng.next() * Math.PI * 2;
  const r = state.rng.next() * spread;
  const pos = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
  return overlapsWall(state, pos.x, pos.y, 1) ? null : pos;
}

function dropImpacts(state: GameState, current: ActiveRunEvent, dt: number, params: ImpactParams): void {
  current.tick -= dt;
  if (current.tick > 0) return;
  current.tick = params.interval;
  const pos = spotAround(state, params.spread);
  if (pos) pushImpact(state, pos, params.radius, params.telegraph, params.damage);
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
  // 階の主（def.boss でない毎階の主。state.boss.enemyId）も消さない: 消すと撃破扱いで階段と報酬が出てしまう
  const victim = state.enemies.find(
    (e) => e.roomIndex === index && e.hp > 0 && !enemyDef(e.defKey).boss && state.boss?.enemyId !== e.id,
  );
  if (victim) {
    victim.vanished = true;
    victim.hp = 0;
  }
  const current = state.runEvents.room;
  if (current) endEvent(state, current);
  pushLog(state, "勢いに乗って飛び込んだ。", RUN_EVENT.activeColor);
}

// ---- 第 2 弾の個別 ----

/** 呪詛の声: 制圧までに求められたコンボに届けば呪いが 1 つ解け、届かなければ 1 つ増える */
function answerCurseVoice(state: GameState, current: ActiveRunEvent): void {
  const best = Math.max(current.memo, state.combo.count);
  if (best >= RUN_EVENT.curseVoiceCombo) {
    const cursed = state.boons.filter((k) => BOONS[k].cursed);
    if (cursed.length > 0 && !coreKeepsCurses(state)) removeBoon(state, state.rng.pick(cursed));
    pushLog(state, "呪詛に応えた。呪いが 1 つ解けた。", RUN_EVENT.activeColor);
    return;
  }
  grantCurse(state);
  pushLog(state, "呪詛に応えられなかった。呪いが増えた。", RUN_EVENT.warnColor);
}

/** 決闘を申し込む敵: 部屋の精鋭（いなければ最も硬い敵）。部屋に 2 体以上いないと成り立たない */
function duelChampion(state: GameState, index: number): Enemy | null {
  if (index < 0) return null;
  const list = state.enemies.filter((e) => e.roomIndex === index && e.hp > 0 && !enemyDef(e.defKey).boss);
  if (list.length < 2) return null;
  return list.find((e) => e.elite) ?? list.reduce((a, b) => (b.maxHp > a.maxHp ? b : a));
}

function startDuel(state: GameState, current: ActiveRunEvent): void {
  const champion = duelChampion(state, current.roomIndex);
  if (!champion) {
    current.duration = 0;
    return;
  }
  current.target = champion;
  current.targetId = champion.id;
  for (const e of state.enemies) {
    if (e === champion || e.roomIndex !== current.roomIndex || e.hp <= 0) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "paralyze", stacks: 1, duration: RUN_EVENT.duel.holdTime, potency: 0 }, "env");
  }
  pushLog(state, `${enemyDef(champion.defKey).name}が決闘を申し込んだ。`, RUN_EVENT.activeColor);
}

/** 名乗った敵を見届ける間は他の敵が手を出さない。倒せば他の敵が怯えて欠片 */
function tickDuel(state: GameState, current: ActiveRunEvent): void {
  const champion = current.target;
  if (!champion || current.memo !== 0) return;
  if (champion.hp > 0) {
    if (current.timer >= RUN_EVENT.duel.holdTime) return;
    for (const e of state.enemies) {
      if (e !== champion && e.roomIndex === current.roomIndex && e.hp > 0) e.attackCooldown = Math.max(e.attackCooldown, DUEL_HOLD_COOLDOWN);
    }
    return;
  }
  current.memo = 1;
  if (champion.vanished) return;
  for (const e of state.enemies) {
    if (e.roomIndex !== current.roomIndex || e.hp <= 0) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "fear", stacks: 1, duration: RUN_EVENT.duel.fearTime, potency: 0 }, "env");
  }
  gainShards(state, CONTRACT.shardsDuel);
  pushLog(state, "決闘に勝った。残りの敵が怯えている。", RUN_EVENT.activeColor);
}

/** 決闘中、他の敵の攻撃間隔をこの秒より下げない（見届けている間は殴ってこない） */
const DUEL_HOLD_COOLDOWN = 0.3;

/** 鈍重: ダッシュに入った瞬間、再使用を伸ばし、直後の一撃を重くする */
function tickSluggish(state: GameState, current: ActiveRunEvent): void {
  const p = state.player;
  const dashing = p.dashTimer > 0;
  const started = dashing && current.memo === 0;
  current.memo = dashing ? 1 : 0;
  if (!started) return;
  const s = RUN_EVENT.sluggish;
  p.dashCooldown *= s.dashCdMul;
  p.buffs.damage = { time: Math.max(p.buffs.damage.time, p.dashTimer + s.buffTime), mul: Math.max(p.buffs.damage.mul, s.dashDamageMul) };
}

const FLOOD_START_RADIUS = 16;

/** 地形の氾濫: 部屋の 1 点から水か油が広がる（水は雷を、油は炎を呼ぶ） */
function tickFlood(state: GameState, current: ActiveRunEvent, dt: number): void {
  const f = RUN_EVENT.flood;
  current.tick -= dt;
  if (current.tick > 0 || !current.pos) return;
  current.tick = f.interval;
  const radius = Math.min(f.maxRadius, FLOOD_START_RADIUS + f.growth * current.timer);
  placeTerrain(state, current.pos.x, current.pos.y, current.memo === 1 ? "oil" : "water", radius, f.terrainTime);
}

/** 静寂: 部屋の敵を沈黙させる（術・射撃の予備動作に入れない） */
function silenceRoom(state: GameState, index: number): void {
  for (const e of state.enemies) {
    if (e.roomIndex !== index || e.hp <= 0) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "silence", stacks: 1, duration: RUN_EVENT.silenceTime, potency: 0 }, "env");
  }
}

/**
 * 静寂: 自然回復のぶんだけ気力を戻さない。前ステップからの増えた量のうち、自然回復の速さぶんまでを差し引く
 * （命中・撃破で得た気力は残る）
 */
function tickSilence(state: GameState, current: ActiveRunEvent, dt: number): void {
  const p = state.player;
  const gained = p.mana - current.prevMana;
  if (gained > 0) p.mana -= Math.min(gained, state.stats.manaRegen * dt);
  current.prevMana = p.mana;
}

/** 反応の共振: このステップに起きた反応の点から、周りの敵へ弾ける */
function tickSurge(state: GameState): void {
  const ev = state.runEvents;
  if (ev.surgeIcd > 0) return;
  const reaction = state.events.find((e) => e.kind === "onReaction");
  if (!reaction) return;
  ev.surgeIcd = RUN_EVENT.surge.icd;
  const s = RUN_EVENT.surge;
  const damage = s.damage * (1 + state.depth * s.perDepth);
  for (const e of state.enemies) {
    if (e.hp <= 0 || !circlesOverlap(reaction.pos.x, reaction.pos.y, s.radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    damageEnemy(state, e, damage, normalize(sub(e.body.pos, reaction.pos)), SURGE_KNOCK, { kind: "proc" });
  }
  spawnBurst(state, reaction.pos, s.color, SURGE_PARTICLES, SURGE_SPEED, SURGE_LIFE, 2);
}

const SURGE_KNOCK = 80;
const SURGE_PARTICLES = 12;
const SURGE_SPEED = 120;
const SURGE_LIFE = 0.35;

/** 雷鳴の刻: 間隔ごとにプレイヤーの周りへ落雷の予告を置く */
function dropStrikes(state: GameState, current: ActiveRunEvent, dt: number): void {
  const t = RUN_EVENT.thunder;
  current.tick -= dt;
  if (current.tick > 0) return;
  current.tick = t.interval;
  const pos = spotAround(state, t.spread);
  if (pos) state.runEvents.strikes.push({ pos, timer: t.telegraph, telegraph: t.telegraph });
}

function updateStrikes(state: GameState, dt: number): void {
  const list = state.runEvents.strikes;
  if (list.length === 0) return;
  for (const s of list) {
    s.timer -= dt;
    if (s.timer <= 0) landStrike(state, s);
  }
  state.runEvents.strikes = list.filter((s) => s.timer > 0);
}

const STRIKE_KNOCK = 60;
const STRIKE_PARTICLES = 10;
const STRIKE_SPEED = 100;
const STRIKE_LIFE = 0.3;

/** 落雷: 円の中のプレイヤーに当たり、敵には落下物と同じ倍率で当たって感電させる */
function landStrike(state: GameState, strike: Strike): void {
  const t = RUN_EVENT.thunder;
  const p = state.player.body;
  if (circlesOverlap(strike.pos.x, strike.pos.y, t.radius, p.pos.x, p.pos.y, p.radius)) damagePlayer(state, t.damage, strike.pos);
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning") continue;
    if (!circlesOverlap(strike.pos.x, strike.pos.y, t.radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    damageEnemy(state, e, t.damage * RUN_EVENT.impactEnemyMul, normalize(sub(e.body.pos, strike.pos)), STRIKE_KNOCK, { kind: "proc" });
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "shock", stacks: t.shockStacks, duration: t.shockDuration, potency: 0 }, "env");
  }
  spawnBurst(state, strike.pos, t.color, STRIKE_PARTICLES, STRIKE_SPEED, STRIKE_LIFE, 2);
  pushSfx(state, "shockwave");
}

/** 死神の通り道の、今の死神の位置（予告中・実行中でなければ null） */
export function reaperPassPos(state: GameState): Vec | null {
  const r = state.runEvents.room;
  if (r?.key !== "reaperPass" || r.phase !== "active" || !r.pos || !r.dir) return null;
  const pass = RUN_EVENT.reaperPass;
  const d = -pass.span + pass.speed * r.timer;
  return { x: r.pos.x + r.dir.x * d, y: r.pos.y + r.dir.y * d };
}

/** 死神の通り道の線（描画用。予告中も出す） */
export function reaperPassLine(state: GameState): { from: Vec; to: Vec; warn: boolean } | null {
  const r = state.runEvents.room;
  if (r?.key !== "reaperPass" || !r.pos || !r.dir) return null;
  const span = RUN_EVENT.reaperPass.span;
  return {
    from: { x: r.pos.x - r.dir.x * span, y: r.pos.y - r.dir.y * span },
    to: { x: r.pos.x + r.dir.x * span, y: r.pos.y + r.dir.y * span },
    warn: r.phase === "warn",
  };
}

function tickReaperPass(state: GameState, current: ActiveRunEvent): void {
  if (current.memo !== 0) return;
  const pos = reaperPassPos(state);
  const body = state.player.body;
  if (!pos || !circlesOverlap(pos.x, pos.y, RUN_EVENT.reaperPass.radius, body.pos.x, body.pos.y, body.radius)) return;
  current.memo = 1;
  damagePlayer(state, RUN_EVENT.reaperPass.damage, pos);
}

/** 通り過ぎた後に冥の残響が残る */
function finishReaperPass(state: GameState): void {
  state.runEvents.pendingEchoes.umbra += RUN_EVENT.reaperPass.echoes;
  addFloatingText(state, { ...state.player.body.pos }, `冥の残響 +${RUN_EVENT.reaperPass.echoes}`, RUN_EVENT.activeColor, 1, 1.2);
}

/**
 * 生命の逆流: 前ステップからの回復を気力へ、気力の増えを生命へ流す。
 * 気力 → 生命は戦闘中の回復の共通上限（healSustained）を通す（命中時の気力で回復し放題にしない）
 */
function tickLifeFlow(state: GameState, current: ActiveRunEvent): void {
  const p = state.player;
  const ratio = RUN_EVENT.lifeFlow.ratio;
  const hpGain = p.hp - current.prevHp;
  const manaGain = p.mana - current.prevMana;
  if (hpGain > 0) {
    p.hp -= hpGain;
    p.mana = Math.min(state.stats.maxMana, p.mana + hpGain * ratio);
  }
  if (manaGain > 0) {
    p.mana -= manaGain;
    healSustained(state, manaGain * ratio, { silent: true });
  }
  current.prevHp = p.hp;
  current.prevMana = p.mana;
}

/** 蝙蝠の渡り: 部屋に蝙蝠の群れを湧かせる（予告付き） */
function releaseBats(state: GameState, index: number): void {
  if (index < 0) return;
  const def = enemyDef("bat");
  for (let i = 0; i < RUN_EVENT.bats.count; i++) roomHooks.spawnEnemyAt(state, def, index);
}

/**
 * 流れ星: 呪いでない祝福を 1 つ手放して、祝福の 3 択を開く。
 * 3 択が開かなかった（深度 1・候補切れ）ときは手放した祝福を元の位置へ戻す（引き直しにならず失うだけになるのを防ぐ）
 */
function rerollBoon(state: GameState): void {
  // 芯は手放させない（1 ランに 1 つ。引き直しで失うと方向性ごと消える）
  const pool = state.boons.filter((k) => !BOONS[k].cursed && BOONS[k].core !== true);
  const before = state.boonChoice;
  const key = pool.length > 0 ? state.rng.pick(pool) : null;
  const at = key ? state.boons.indexOf(key) : -1;
  if (key) removeBoon(state, key);
  offerBoons(state);
  if (!key || (state.boonChoice && state.boonChoice !== before)) return;
  state.boons.splice(at, 0, key);
  applyBoonsToStats(state);
}

// ---- 第 4 弾: 盗賊の追跡 ----

/** 盗賊が狙える床の遺物: プレイヤーから searchRadius 以内で最も近いもの（床の並びは落ちた順なので決定的） */
function thiefTargetItem(state: GameState): FloorItem | null {
  const p = state.player.body.pos;
  let best: FloorItem | null = null;
  let bestD: number = RUN_EVENT.thief.searchRadius;
  for (const f of state.floorItems) {
    const d = Math.hypot(f.pos.x - p.x, f.pos.y - p.y);
    if (d > bestD) continue;
    best = f;
    bestD = d;
  }
  return best;
}

const THIEF_WARN_TEXT = "狙われている";
const THIEF_KEY = "thief";
const THIEF_ESCAPE_PARTICLES = 14;
const THIEF_ESCAPE_SPEED = 90;
const THIEF_ESCAPE_LIFE = 0.4;

/** 予告: 狙われる遺物を決めて印を出す（予告の間に拾えば盗賊は来ない） */
function markThiefTarget(state: GameState, ev: ActiveRunEvent): void {
  const item = thiefTargetItem(state);
  if (!item) return;
  ev.targetId = item.id;
  ev.pos = { ...item.pos };
  addFloatingText(state, { x: item.pos.x, y: item.pos.y - TEXT_LIFT }, THIEF_WARN_TEXT, RUN_EVENT.thief.color, 1, RUN_EVENT.warnTime);
}

/** 始まり: 狙った遺物の向こう側に強欲のの盗賊が湧く（出現の魔法陣が予告）。遺物が拾われていれば来ない */
function releaseThief(state: GameState, current: ActiveRunEvent): void {
  const item = state.floorItems.find((f) => f.id === current.targetId);
  if (!item) {
    current.duration = 0;
    current.targetId = -1;
    pushLog(state, "盗賊は諦めて去った。", RUN_EVENT.activeColor);
    return;
  }
  const def = enemyDef(THIEF_KEY);
  const away = normalize(sub(item.pos, state.player.body.pos), { x: 1, y: 0 });
  const want = { x: item.pos.x + away.x * RUN_EVENT.thief.spawnOffset, y: item.pos.y + away.y * RUN_EVENT.thief.spawnOffset };
  const thief = createEnemy(state, def, spawnSpot(state, want, item.pos, def.radius), ROAMING_ROOM, true);
  makeElite(thief, "greedy");
  state.enemies.push(thief);
  current.target = thief;
  current.targetId = thief.id;
  current.memo = 0;
  pushLog(state, "盗賊が遺物を狙って現れた。", RUN_EVENT.activeColor);
}

/** 追跡中: 抱えた数を覚える。倒されたら抱えた数だけ追加で落とす（抱えた物そのものは強欲のの撃破で落ちる） */
function tickThief(state: GameState, current: ActiveRunEvent): void {
  const thief = current.target;
  if (!thief) return;
  if (thief.hp > 0 && state.enemies.includes(thief)) {
    current.memo = Math.max(current.memo, carriedCount(thief));
    current.pos = { ...thief.body.pos };
    return;
  }
  current.duration = 0;
  if (thief.vanished) return;
  // 強欲のは撃破で抱えた物 + bonusDrops 個を落とすので、残りを足して「倍」にする
  const extra = Math.max(0, current.memo - ELITE_GREEDY.bonusDrops);
  const pos = current.pos ?? thief.body.pos;
  for (let i = 0; i < extra; i++) dropItem(state, pos, RUN_EVENT.thief.rarityBoost);
  if (current.memo > 0) pushLog(state, "盗賊を仕留めた。奪われた遺物が倍になって戻った。", RUN_EVENT.activeColor);
}

/**
 * 逃げ切られた: 盗賊は消え、抱えていた物だけはその場に捨てていく（永続の装備を敵に持ち去らせない。
 * 強欲のは消えても抱えた物を落とす: elites.ts の onEliteDeath）。倍の褒美は無い
 */
function thiefEscapes(state: GameState, current: ActiveRunEvent): void {
  const thief = current.target;
  if (!thief || thief.hp <= 0 || !state.enemies.includes(thief)) return;
  thief.vanished = true;
  thief.hp = 0;
  spawnBurst(state, thief.body.pos, RUN_EVENT.thief.color, THIEF_ESCAPE_PARTICLES, THIEF_ESCAPE_SPEED, THIEF_ESCAPE_LIFE, 2);
  pushSfx(state, "smokeBomb");
  pushLog(state, "盗賊に逃げられた。荷物だけは捨てていった。", RUN_EVENT.warnColor);
}

/** 盗賊の追跡の盗賊（描画の印・テスト用。起きていなければ -1） */
export function thiefTargetId(state: GameState): number {
  const r = state.runEvents.room;
  return r?.key === "thiefChase" && r.phase === "active" && r.target && r.target.hp > 0 ? r.targetId : -1;
}

/** プレイヤーが立っている部屋（通路なら -1） */
export function roomIndexAt(state: GameState, pos: Vec): number {
  const tx = Math.floor(pos.x / TILE_SIZE);
  const ty = Math.floor(pos.y / TILE_SIZE);
  if (!inBounds(state.map, tx, ty)) return -1;
  const tile = toIndex(state.map, tx, ty);
  return state.rooms.findIndex((r) => (r.tiles ? r.tiles.has(tile) : rectContainsPx(r.rect, pos.x, pos.y)));
}

/** index が部屋ならそれ、無ければ立っている部屋、それも無ければ中心が最も近い部屋 */
function roomNear(state: GameState, index: number): number {
  if (state.rooms[index]) return index;
  const p = state.player.body.pos;
  const here = roomIndexAt(state, p);
  if (here >= 0) return here;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  state.rooms.forEach((r, i) => {
    const c = rectCenterPx(r.rect);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

// -----------------------------------------------------------------------------
// 反転層: 落ちた遺物にもう 1 回の反転抽選
// -----------------------------------------------------------------------------

/**
 * 反転層（FLOOR_KIND.invertedDepth 以降）では、床に新しく落ちた遺物ごとに発見深度の反転率でもう 1 回抽選し、
 * 当たれば性質を 1 つ反転させる（生成時の抽選と合わせて反転率がおよそ 2 倍になる）。床アイテムの id は増える一方なので、
 * 済ませた id の最大値だけを覚える
 */
function invertNewDrops(state: GameState): void {
  const strata = state.runEvents.strata;
  let last = strata.lastItemId;
  for (const f of state.floorItems) {
    if (f.id <= strata.lastItemId) continue;
    last = Math.max(last, f.id);
    if (!isInvertedDepth(state.depth) || !state.rng.chance(inversionChance(f.item.foundDepth))) continue;
    const inverted = invertTrait(state, f.item);
    if (inverted) f.item = inverted;
  }
  strata.lastItemId = last;
}

// -----------------------------------------------------------------------------
// HUD 用
// -----------------------------------------------------------------------------

/** HUD に出す行（予告 / 実行中 / 変異）。無ければ空 */
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
    const active = current.key === "elementStorm" ? `${eventTitle(current)}: 通常攻撃に属性が乗る` : def.active;
    out.push({ text: `${active}${left}`, warn: false });
  }
  const mutations = state.runEvents.mutations;
  if (mutations.length > 0) out.push({ text: `変異: ${mutations.map((k) => RUN_EVENTS[k].name).join(" / ")}`, warn: false });
  return out;
}
