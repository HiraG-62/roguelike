import type { FrameInput } from "../core/input";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { dist } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { HUB } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { MOVESETS, type MovesetKey, isGun } from "../data/weapons";
import { bulletOfBase } from "../loot/bullets";
import { KEYSTONES } from "../loot/affixes";
import { BASES, type BaseItemDef } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { addToStash, chooseUltimate, ultimateChoice } from "../loot/profile";
import { UNARMED_MORE, computeStats } from "../loot/stats";
import { type Item, type Profile, type Slot } from "../loot/types";
import { TILE_SIZE, type Rect } from "../map/grid";
import { HUB_SPOT_KEYS, type HubLayout, type HubSpotKey, buildHubMap } from "../map/hubMap";
import type { SkillProfile } from "../skills/types";
import { updateCamera } from "./camera";
import { cancelAttack } from "./combat";
import { carryContractPatch } from "./contractors";
import { createEnemy } from "./enemies";
import { refreshRunStats } from "./runSetup";
import { createSandboxState, simulateSandbox } from "./sandbox";
import { DUMMY_KEY } from "./specialRooms";

export interface HubRun {
  layout: HubLayout;
  near: HubSpotKey | null;
  /** 決定キーを押し続けている秒 */
  departHold: number;
  trialKeystone: string | null;
  /** 武器掛けで試している武器種（銃の家系を含む。null = 装備のまま）。拠点を出ると消える */
  trialMoveset: MovesetKey | null;
  /** 木人ごとの立ち直りまでの残り秒（0 = 立っている） */
  dummyTimers: number[];
  /** 木人ごとの今立っている敵の id（立て直しで倒れたかを見分ける） */
  dummyIds: number[];
  /** 反応する台（拠点の成長で建った設備。src/meta/hub.ts が決める） */
  available: ReadonlySet<HubSpotKey>;
  /** 石段（gateZone）の近く（矩形を HUB.gateNearMargin タイル広げた範囲）にいる。門の名札・案内用 */
  nearGate: boolean;
  /** 石段で出撃できる状態。石段に入ると出撃して false になり、石段の外へ出ると true に戻る（入りっぱなしの再発火を防ぐ） */
  gateArmed: boolean;
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
export function createHub(
  profile: Profile,
  skillProfile: SkillProfile,
  available: ReadonlySet<HubSpotKey>,
  /** ヒットストップの強度（settings.hitstopScale）。省略時は標準の 1（拠点は乱数消費が無いため決定性の記録は不要） */
  hitstopScale = 1,
): HubSession {
  const layout = buildHubMap();
  const state = createHubState(profile, skillProfile, layout, hitstopScale);
  const hub: HubRun = {
    layout,
    near: null,
    departHold: 0,
    trialKeystone: null,
    trialMoveset: null,
    dummyTimers: layout.dummySpots.map(() => 0),
    dummyIds: layout.dummySpots.map((pos) => placeDummy(state, pos)),
    available,
    nearGate: false,
    // 開始位置は石段の外なので、最初から出撃できる
    gateArmed: true,
  };
  return { state, hub };
}

function createHubState(profile: Profile, skillProfile: SkillProfile, layout: HubLayout, hitstopScale: number): GameState {
  return createSandboxState({ profile, skillProfile, map: layout.map, start: layout.playerStart, seed: HUB.seed, hitstopScale });
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
  enforceTrialWeapon(session);
  if (state.hitstop > 0) {
    state.hitstop -= 1;
    updateCamera(state, dt, VIEW_W, VIEW_H);
    return NONE;
  }
  simulateSandbox(state, input, dt);
  updateDummies(session, dt);
  hub.near = nearestSpot(session);
  if (hub.near && input.interactPressed) {
    hub.departHold = 0;
    return { kind: "open", spot: hub.near };
  }
  if (updateGate(session)) {
    hub.departHold = 0;
    return { kind: "depart" };
  }
  return updateDepartHold(hub, confirmHeld, dt);
}

function tileInRect(rect: Rect, tx: number, ty: number, margin = 0): boolean {
  return tx >= rect.x - margin && tx < rect.x + rect.w + margin && ty >= rect.y - margin && ty < rect.y + rect.h + margin;
}

/**
 * 石段の出入りを更新し、踏み込んだ瞬間（出撃できる状態で入った時）だけ true を返す。
 * 台を開く操作を先に返すので、石段の上で台が反応していても出撃より開くが優先される
 */
function updateGate(session: HubSession): boolean {
  const { state, hub } = session;
  const pos = state.player.body.pos;
  const tx = Math.floor(pos.x / TILE_SIZE);
  const ty = Math.floor(pos.y / TILE_SIZE);
  const zone = hub.layout.gateZone;
  hub.nearGate = tileInRect(zone, tx, ty, HUB.gateNearMargin);
  if (!tileInRect(zone, tx, ty)) {
    hub.gateArmed = true;
    return false;
  }
  if (!hub.gateArmed) return false;
  hub.gateArmed = false;
  return true;
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

// -----------------------------------------------------------------------------
// 武器掛け（試す = 武器種だけを差し替える / 借りる = 素の器を右手に装着する）
// -----------------------------------------------------------------------------

/** 武器掛けの 1 行が指すもの。銃の家系（GUN_MOVESETS）も武器種として並ぶ */
export type RackEntry = { kind: "moveset"; key: MovesetKey };

/**
 * 試す武器種を差し替える（拠点を出ると state ごと捨てるので残らない）。null で装備のものに戻す。
 * 差し替えは変身と同じく stats の写しの moveset と bullet だけを替える（銃は家系の一番早い器の弾。近接なら装備のまま）
 */
export function setTrialWeapon(session: HubSession, moveset: MovesetKey | null): void {
  const { state, hub } = session;
  hub.trialMoveset = moveset;
  // 振りの途中で型が替わると段の添字が新しい型に無いことがあるので止める
  if (state.player.attack.phase !== "none") cancelAttack(state);
  refreshRunStats(state);
  enforceTrialWeapon(session);
}

/** 装備画面などで applyStats が stats を作り直しても、試している型へ差し直す（stepHub が毎ステップ呼ぶ） */
function enforceTrialWeapon(session: HubSession): void {
  const { state, hub } = session;
  const moveset = hub.trialMoveset;
  if (moveset === null) return;
  // 銃の家系は借りるときと同じ器（一番早く出るベース）の弾で撃つ（装備の武器の弾のままにしない）
  const bullet = isGun(MOVESETS[moveset]) ? bulletOfBase(earliestBase("mainHand", (b) => b.moveset === moveset)?.key) : state.stats.bullet;
  if (state.stats.moveset === moveset && state.stats.bullet === bullet && !state.stats.unarmed) return;
  const prev = state.stats;
  // 素手の威力の倍は試す武器種には掛けない（素手のまま武器掛けで試したとき）
  const more = prev.more.filter((m) => m.source !== UNARMED_MORE.source);
  state.stats = { ...prev, moveset, bullet, unarmed: false, more };
  // 鍛冶・祭壇の属性の上乗せは写しにも入っているので、足し直させない
  carryContractPatch(prev, state.stats);
}

/** その武器種 / 銃の弾の器のうち、一番早く出る（minLevel が最小の）もの */
function earliestBase(slot: Slot, match: (b: BaseItemDef) => boolean): BaseItemDef | undefined {
  let best: BaseItemDef | undefined;
  for (const b of BASES) {
    if (b.slot !== slot || !match(b)) continue;
    if (best === undefined || b.minLevel < best.minLevel) best = b;
  }
  return best;
}

/**
 * 素の器を借りて slot に装着する。元の装備（借り物でなければ）は倉庫へ移し、倉庫が満杯なら断って null。
 * 借り物どうしの付け替えは前の借り物を捨てる（倉庫を膨らませない）
 */
function borrowInto(profile: Profile, base: BaseItemDef, salt: number, now: number): Item | null {
  const slot = base.slot;
  const current = profile.equipment[slot];
  if (current && current.loaned !== true && !addToStash(profile, current)) return null;
  // 拠点の種から作る（ランの乱数に触れない）。素の器なので性質は無く、implicit だけがベースの個性
  const item = generateItem(createRng((HUB.seed ^ salt) >>> 0), { baseKey: base.key, plain: true, itemLevel: base.minLevel, foundDepth: base.minLevel, now });
  item.loaned = true;
  // 借り物どうしの付け替えでは、最初に押し出した自分の装備を覚え続ける
  const replaces = current?.loaned === true ? current.loanedReplaces : current?.id;
  if (replaces !== undefined) item.loanedReplaces = replaces;
  profile.equipment[slot] = item;
  return item;
}

/** 武器種の素の器を借りて右手に装着する。元の装備は倉庫へ（満杯なら断る）。借り物はランが終わると消える */
export function borrowWeapon(profile: Profile, moveset: MovesetKey, now: number): Item | null {
  const base = earliestBase("mainHand", (b) => b.moveset === moveset);
  if (base === undefined) return null;
  return borrowInto(profile, base, BASES.indexOf(base), now);
}

/** 武器掛けの行を借りる。借りたら「試す」を外し、装備から stats を作り直す */
export function borrowRackEntry(session: HubSession, entry: RackEntry, now: number): Item | null {
  const { state } = session;
  const item = borrowWeapon(state.profile, entry.key, now);
  if (item === null) return null;
  setTrialWeapon(session, null);
  return item;
}

/**
 * 武器掛けで武器種の奥義を選ぶ（profile.ultimates に書く。拠点を出ても残るので、保存は呼び出し側の saveProfile）。
 * ラン中は変えない（拠点でだけ呼ぶ）。その武器種の奥義でなければ何もせず false
 */
export function chooseRackUltimate(session: HubSession, moveset: MovesetKey, key: string): boolean {
  return chooseUltimate(session.state.profile, moveset, key);
}

/** 試している武器種で選んでいる奥義の名前（拠点の重ね描き用）。試していなければ null */
export function trialUltimateName(session: HubSession): string | null {
  const moveset = session.hub.trialMoveset;
  return moveset === null ? null : ultimateChoice(session.state.profile, moveset).name;
}

/** 装備中の右手の武器種（武器掛けの「装備のまま」のカードの絵。試している型ではなく装備から数え直す） */
export function equippedMoveset(profile: Profile): MovesetKey {
  return computeStats(profile.equipment).moveset;
}

/** 表示名（「大剣」「散弾銃」） */
export function rackEntryName(entry: RackEntry): string {
  return MOVESETS[entry.key].name;
}

// -----------------------------------------------------------------------------
// 試し打ちの資源の調整（拠点の state はリプレイにも永続化にも載らないので直接書いてよい）
// -----------------------------------------------------------------------------

/** 武器掛けで調整できる資源（生命・気力・奥義ゲージ） */
export type HubResource = "hp" | "mana" | "energy";

export const HUB_RESOURCES: readonly HubResource[] = ["hp", "mana", "energy"];

/** 生命は 0 にすると拠点で倒れるので、最低でもこれだけ残す */
const MIN_HUB_HP = 1;

function resourceMax(state: GameState, kind: HubResource): number {
  if (kind === "hp") return state.player.maxHp;
  if (kind === "mana") return state.stats.maxMana;
  return state.player.maxEnergy;
}

function resourceNow(state: GameState, kind: HubResource): number {
  if (kind === "hp") return state.player.hp;
  if (kind === "mana") return state.player.mana;
  return state.player.energy;
}

/** 資源の今の割合（0..1）。上限が 0 なら 0 */
export function hubResourceRatio(session: HubSession, kind: HubResource): number {
  const max = resourceMax(session.state, kind);
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, resourceNow(session.state, kind) / max));
}

/**
 * 資源を上限 × ratio（0..1 に丸める）にする。持続の奥義の最中に奥義ゲージを 0 にしたら、
 * updateUltimate が次のステップで「尽きた」として終える（最短の持続秒は守る）ので、ここでは終了処理を呼ばない
 */
export function setHubResource(session: HubSession, kind: HubResource, ratio: number): void {
  const state = session.state;
  const r = Math.min(1, Math.max(0, ratio));
  const value = resourceMax(state, kind) * r;
  if (kind === "hp") state.player.hp = Math.max(MIN_HUB_HP, value);
  else if (kind === "mana") state.player.mana = value;
  else state.player.energy = value;
}

/** 生命・気力・奥義ゲージをすべて上限にする */
export function fillHubResources(session: HubSession): void {
  for (const kind of HUB_RESOURCES) setHubResource(session, kind, 1);
}
