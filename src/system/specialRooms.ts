import type { EliteKind, Enemy, FloorKind, GameState, RoomKind, RoomState } from "../core/state";
import { allocId, pushLog, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { ENEMIES, type EnemyDef, enemiesForDepth, enemyDef } from "../data/enemies";
import { keystoneDef } from "../loot/affixes";
import { FLOOR_KIND, ROOM_KIND } from "../data/tuning";
import { createEchoWallet, shatterYield } from "../loot/crafting";
import { generateItem } from "../loot/generator";
import { TRAIT_COLORS, type TraitColor } from "../loot/types";
import { forkStairsTiles } from "../map/generator";
import { TILE_SIZE, Tile, isWalkable, rectCenterPx, toIndex } from "../map/grid";
import { MODIFIERS } from "../skills/data";
import { rollRuneModifier } from "../skills/generator";
import type { ModifierKey } from "../skills/types";
import { pickFloorKinds } from "./biomes";
import { BOONS, BOON_KEYS, grantBoon, hasBoon, offerBoons } from "./boons";
import { isBossDepth } from "./boss";
import { COLOR_HEAL, healPlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { eliteKindsFor, makeElite } from "./elites";
import { dropBonusReward, dropItem } from "./loot";
import { circlesOverlap, overlapsWall } from "./physics";
import { spawnReaper } from "./reaper";
import { altarKeystoneCandidates, equippedSkillKeys, refreshRunStats } from "./runSetup";
import { applyStatus } from "./statusEffects";
import { dropRune, grantRune } from "./skills";
import { placeTerrain } from "./terrain";
import { dropRareItem } from "./roomTypes";

/**
 * ラン構造の特別な部屋（docs/ideas/run-expansion.md 2 章）。
 * 台座の部屋（祭壇・図書館・賭博・鍛冶場・交換所・呪いの祠・見張り台・死神の巣）は生成時に制圧済みにし、
 * 触れて選ぶ（モーダルを出さないので QA bot も止まらない）。戦う部屋（闘技場・共鳴炉・護衛・逃走・巣・鏡）は
 * floor.ts の封鎖・制圧の流れに乗り、ここは封鎖時・制圧時・毎ステップの差分だけを持つ。
 * 分岐路（最後の部屋の複数の階段と行き先）もここで決める
 */

// -----------------------------------------------------------------------------
// 型
// -----------------------------------------------------------------------------

export type PropKind = "keystone" | "rune" | "lever" | "anvil" | "exchange" | "curse" | "bell" | "chest" | "captive";

/** 部屋に置く触れる物（台座・レバー・金床・宝箱・護衛対象） */
export interface RoomProp {
  kind: PropKind;
  pos: Vec;
  used: boolean;
  /** 誓約の key・刻印符の key など */
  key: string;
  /** false の間は触れても反応しない（一度離れると true に戻る。賭博のレバーの連打防止） */
  armed: boolean;
}

export interface RoomSpecial {
  props: RoomProp[];
  /** 共鳴炉の色 */
  color: TraitColor | null;
  /** 護衛対象の HP */
  hp: number;
  maxHp: number;
  /** 護衛に失敗した */
  failed: boolean;
  /** 賭博の残り回数 */
  uses: number;
  /** 逃走: 床が崩れ始めてからの秒（null は未開始） */
  timer: number | null;
  /** 逃走: 崩れ始めた点（入口） */
  origin: Vec | null;
  /** 逃走: 次に崩れる範囲を広げるまでの秒 */
  tick: number;
}

/** 階段 1 つぶんの行き先（分岐路）。tile < 0 はボス撃破待ち */
export interface StairsChoice {
  tile: number;
  nextKind: FloorKind;
}

// -----------------------------------------------------------------------------
// 表示名・分類
// -----------------------------------------------------------------------------

export const ROOM_KIND_LABEL: Readonly<Record<RoomKind, string>> = {
  normal: "部屋",
  treasure: "宝物庫",
  challenge: "試練",
  shrine: "泉",
  ambush: "伏兵",
  altar: "祭壇",
  library: "図書館",
  arena: "闘技場",
  gamble: "賭博",
  forge: "鍛冶場",
  exchange: "交換所",
  curseShrine: "呪いの祠",
  resonance: "共鳴炉",
  escort: "護衛",
  escape: "逃走",
  reaperNest: "死神の巣",
  nest: "巣",
  mirror: "鏡",
  watchtower: "見張り台",
  horde: "巣窟",
};

export const PROP_LABEL: Readonly<Record<PropKind, string>> = {
  keystone: "誓約",
  rune: "刻印符",
  lever: "賭け台",
  anvil: "金床",
  exchange: "交換台",
  curse: "呪いの祠",
  bell: "鐘",
  chest: "宝箱",
  captive: "捕らわれ人",
};

export const ROOM_KIND_COLOR: Readonly<Partial<Record<RoomKind, string>>> = {
  altar: ROOM_KIND.altarColor,
  library: ROOM_KIND.libraryColor,
  arena: ROOM_KIND.arenaColor,
  gamble: ROOM_KIND.gambleColor,
  forge: ROOM_KIND.forgeColor,
  exchange: ROOM_KIND.exchangeColor,
  curseShrine: ROOM_KIND.curseShrineColor,
  escort: ROOM_KIND.escortColor,
  escape: ROOM_KIND.escapeColor,
  reaperNest: "#8040c0",
  nest: ROOM_KIND.nestColor,
  mirror: ROOM_KIND.mirrorColor,
  watchtower: ROOM_KIND.watchtowerColor,
  horde: ROOM_KIND.hordeColor,
};

/** 台座だけの部屋（戦闘なし。生成時に制圧済み） */
const PROP_ROOMS: ReadonlySet<RoomKind> = new Set<RoomKind>([
  "altar",
  "library",
  "gamble",
  "forge",
  "exchange",
  "curseShrine",
  "watchtower",
  "reaperNest",
]);

/** 最初は無人で、封鎖したときに湧く（または湧かない）部屋 */
const EMPTY_AT_START: ReadonlySet<RoomKind> = new Set<RoomKind>(["arena", "escort", "escape", "mirror"]);

export function isPropRoom(kind: RoomKind): boolean {
  return PROP_ROOMS.has(kind);
}

export function startsEmptySpecial(kind: RoomKind): boolean {
  return PROP_ROOMS.has(kind) || EMPTY_AT_START.has(kind);
}

// -----------------------------------------------------------------------------
// 割り当て
// -----------------------------------------------------------------------------

type ExtraKind = keyof typeof ROOM_KIND.extra;
const EXTRA_ORDER = Object.keys(ROOM_KIND.extra) as ExtraKind[];

/**
 * 既存の種類（宝物庫・試練・泉・伏兵）を割り当てた後、残った通常の部屋に追加の種類を置く（最大 ROOM_KIND.extraMax）。
 * 起点「賭博師」は賭博の部屋を必ず 1 つ置く。すべて state.rng から決定的に決まる
 */
export function assignExtraRoomKinds(state: GameState, reserved: ReadonlySet<number>): void {
  const free = state.rooms.map((_, i) => i).filter((i) => !reserved.has(i) && state.rooms[i]?.kind === "normal");
  let placed = 0;
  const place = (kind: RoomKind): void => {
    const [index] = free.splice(state.rng.int(0, free.length - 1), 1);
    const room = index === undefined ? undefined : state.rooms[index];
    if (!room) return;
    room.kind = kind;
    placed++;
  };
  if (state.origin === "gambler" && free.length > 0) place("gamble");
  for (const kind of EXTRA_ORDER) {
    if (placed >= ROOM_KIND.extraMax || free.length === 0) return;
    const rule = ROOM_KIND.extra[kind];
    if (state.depth < rule.minDepth) continue;
    if (kind === "gamble" && state.origin === "gambler") continue;
    if (!state.rng.chance(rule.chance)) continue;
    place(kind);
  }
}

// -----------------------------------------------------------------------------
// 生成時の準備
// -----------------------------------------------------------------------------

function createSpecial(): RoomSpecial {
  return { props: [], color: null, hp: 0, maxHp: 0, failed: false, uses: 0, timer: null, origin: null, tick: 0 };
}

function specialOf(room: RoomState): RoomSpecial {
  if (!room.special) room.special = createSpecial();
  return room.special;
}

function addProp(room: RoomState, kind: PropKind, pos: Vec, key = ""): void {
  specialOf(room).props.push({ kind, pos, used: false, key, armed: true });
}

const PROP_CLEARANCE = 4;

/** 中心から横に並べた点。壁に掛かる点は中心に寄せる */
function rowPositions(state: GameState, room: RoomState, count: number): Vec[] {
  const c = rectCenterPx(room.rect);
  const step = ROOM_KIND.propSpacing * TILE_SIZE;
  const out: Vec[] = [];
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * step;
    const p = { x: c.x + offset, y: c.y };
    out.push(overlapsWall(state, p.x, p.y, PROP_CLEARANCE) ? { ...c } : p);
  }
  return out;
}

/** 重複なしで最大 count 個 */
function pickDistinct<T>(state: GameState, pool: readonly T[], count: number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  while (out.length < count && rest.length > 0) {
    const [v] = rest.splice(state.rng.int(0, rest.length - 1), 1);
    if (v !== undefined) out.push(v);
  }
  return out;
}

const CHOICE_COUNT = 3;
/** 刻印符 3 冊を重複なしで引くための試行回数 */
const RUNE_ROLL_ATTEMPTS = 12;

/**
 * 部屋の種類ごとの準備。台座の部屋は制圧済みにする。準備できなかった（候補が無い）ときは通常の部屋に戻す
 */
export function setupSpecialRoom(state: GameState, room: RoomState): void {
  switch (room.kind) {
    case "altar":
      setupAltar(state, room);
      break;
    case "library":
      setupLibrary(state, room);
      break;
    case "gamble":
      addProp(room, "lever", rectCenterPx(room.rect));
      specialOf(room).uses = ROOM_KIND.gambleUses;
      break;
    case "forge":
      addProp(room, "anvil", rectCenterPx(room.rect));
      break;
    case "exchange":
      setupExchange(state, room);
      break;
    case "curseShrine":
      addProp(room, "curse", rectCenterPx(room.rect));
      break;
    case "watchtower":
      addProp(room, "bell", rectCenterPx(room.rect));
      break;
    case "reaperNest":
      addProp(room, "chest", rectCenterPx(room.rect), "reaper");
      break;
    case "resonance":
      specialOf(room).color = state.rng.pick(TRAIT_COLORS);
      break;
    case "escort":
      setupEscort(state, room);
      break;
    case "escape":
      specialOf(room);
      break;
    default:
      break;
  }
  if (isPropRoom(room.kind)) room.cleared = true;
}

function setupAltar(state: GameState, room: RoomState): void {
  const keys = pickDistinct(state, altarKeystoneCandidates(state), CHOICE_COUNT);
  if (keys.length === 0) {
    room.kind = "normal";
    return;
  }
  const spots = rowPositions(state, room, keys.length);
  keys.forEach((key, i) => addProp(room, "keystone", spots[i] ?? rectCenterPx(room.rect), key));
}

function setupLibrary(state: GameState, room: RoomState): void {
  const keys: ModifierKey[] = [];
  const equipped = equippedSkillKeys(state);
  for (let i = 0; i < RUNE_ROLL_ATTEMPTS && keys.length < CHOICE_COUNT; i++) {
    const key = rollRuneModifier(state.rng, equipped);
    if (!keys.includes(key)) keys.push(key);
  }
  const spots = rowPositions(state, room, keys.length);
  keys.forEach((key, i) => addProp(room, "rune", spots[i] ?? rectCenterPx(room.rect), key));
}

function setupExchange(state: GameState, room: RoomState): void {
  const [altar, ...itemSpots] = rowPositions(state, room, ROOM_KIND.exchangeItems + 1);
  addProp(room, "exchange", altar ?? rectCenterPx(room.rect));
  for (const spot of itemSpots) dropItem(state, spot);
}

function setupEscort(state: GameState, room: RoomState): void {
  const s = specialOf(room);
  s.maxHp = Math.round(state.player.maxHp * ROOM_KIND.escortHpMul);
  s.hp = s.maxHp;
  addProp(room, "captive", rectCenterPx(room.rect));
}

// -----------------------------------------------------------------------------
// 台座に触れる
// -----------------------------------------------------------------------------

const TEXT_LIFT = 12;
const TEXT_SCALE = 1.3;
const TEXT_LIFE = 1.4;
const BURST_PARTICLES = 18;
const BURST_SPEED = 90;
const BURST_LIFE = 0.6;

function sayAt(state: GameState, text: string, color: string): void {
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - TEXT_LIFT }, text, color, TEXT_SCALE, TEXT_LIFE);
}

/** 毎ステップ: 台座に触れたら使う。離れたらレバーを再び使えるようにする */
export function updateRoomProps(state: GameState): void {
  const body = state.player.body;
  state.rooms.forEach((room, index) => {
    const special = room.special;
    if (!special) return;
    for (const prop of special.props) {
      if (prop.used || prop.kind === "captive") continue;
      const touching = circlesOverlap(prop.pos.x, prop.pos.y, ROOM_KIND.propRadius, body.pos.x, body.pos.y, body.radius);
      if (!touching) {
        prop.armed = true;
        continue;
      }
      if (!prop.armed) continue;
      prop.armed = false;
      useProp(state, room, index, prop);
    }
  });
}

function useProp(state: GameState, room: RoomState, index: number, prop: RoomProp): void {
  switch (prop.kind) {
    case "keystone":
      takeKeystone(state, room, prop);
      return;
    case "rune":
      takeRune(state, room, prop);
      return;
    case "lever":
      pullLever(state, room, index, prop);
      return;
    case "anvil":
      useAnvil(state, prop);
      return;
    case "exchange":
      useExchange(state, room, prop);
      return;
    case "curse":
      useCurseShrine(state, prop);
      return;
    case "bell":
      ringBell(state, prop);
      return;
    case "chest":
      openChest(state, prop);
      return;
    default:
      return;
  }
}

/** 同じ部屋の同じ種類の台座をまとめて使用済みにする（3 択の残りを消す） */
function consumeAll(room: RoomState, kind: PropKind): void {
  for (const p of room.special?.props ?? []) if (p.kind === kind) p.used = true;
}

function takeKeystone(state: GameState, room: RoomState, prop: RoomProp): void {
  consumeAll(room, "keystone");
  state.runKeystones.push(prop.key);
  refreshRunStats(state);
  const name = keystoneDef(prop.key)?.name ?? prop.key;
  spawnBurst(state, prop.pos, ROOM_KIND.altarColor, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  sayAt(state, `誓約: ${name}`, ROOM_KIND.altarColor);
  pushLog(state, `祭壇で誓約「${name}」を背負った（このランの間）。`, ROOM_KIND.altarColor);
  pushSfx(state, "pedestalUse");
}

function takeRune(state: GameState, room: RoomState, prop: RoomProp): void {
  const key = prop.key as ModifierKey;
  // 選んだ符は所持品へ入れる（石への付け外しは装備画面で自分で選ぶ）
  if (!grantRune(state, key)) {
    sayAt(state, "刻印符が満杯", ROOM_KIND.libraryColor);
    return;
  }
  consumeAll(room, "rune");
  const name = MODIFIERS[key].name;
  spawnBurst(state, prop.pos, ROOM_KIND.libraryColor, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  sayAt(state, `刻印符: ${name}`, ROOM_KIND.libraryColor);
  pushLog(state, `図書館で刻印符「${name}」を手に入れた。装備画面で付けられる。`, ROOM_KIND.libraryColor);
  pushSfx(state, "pedestalUse");
}

type GambleOutcome = keyof typeof ROOM_KIND.gambleWeights;
const GAMBLE_OUTCOMES = Object.keys(ROOM_KIND.gambleWeights) as GambleOutcome[];

function rollGamble(state: GameState): GambleOutcome {
  const total = GAMBLE_OUTCOMES.reduce((s, k) => s + ROOM_KIND.gambleWeights[k], 0);
  let roll = state.rng.next() * total;
  for (const k of GAMBLE_OUTCOMES) {
    roll -= ROOM_KIND.gambleWeights[k];
    if (roll < 0) return k;
  }
  return "item";
}

/** 最大 HP の一部を払って回す。当たり（遺物・ハート・刻印符）か外れ（伏兵・呪い） */
function pullLever(state: GameState, room: RoomState, index: number, prop: RoomProp): void {
  const special = specialOf(room);
  const p = state.player;
  const cost = p.maxHp * ROOM_KIND.gambleHpCost;
  if (p.hp <= cost) {
    sayAt(state, "HP が足りない", ROOM_KIND.gambleColor);
    return;
  }
  p.hp -= cost;
  special.uses -= 1;
  if (special.uses <= 0) prop.used = true;
  const outcome = rollGamble(state);
  applyGamble(state, index, prop.pos, outcome);
  pushSfx(state, "pedestalUse");
}

const GAMBLE_TEXT: Readonly<Record<GambleOutcome, string>> = {
  item: "当たり: 遺物",
  hearts: "当たり: ハート",
  rune: "当たり: 刻印符",
  ambush: "外れ: 伏兵",
  curse: "外れ: 呪い",
};

function applyGamble(state: GameState, index: number, pos: Vec, outcome: GambleOutcome): void {
  sayAt(state, GAMBLE_TEXT[outcome], ROOM_KIND.gambleColor);
  const below = { x: pos.x, y: pos.y + TILE_SIZE };
  switch (outcome) {
    case "item":
      dropItem(state, below, ROOM_KIND.gambleRarityBoost);
      return;
    case "hearts":
      for (let i = 0; i < ROOM_KIND.gambleHearts; i++) spawnHeart(state, { x: below.x + i * PROP_CLEARANCE * 2, y: below.y });
      return;
    case "rune":
      dropRune(state, below);
      return;
    case "ambush":
      gambleAmbush(state, index);
      return;
    case "curse":
      state.cursed = true;
      pushLog(state, "賭けに負けた…次の部屋は荒れ模様だ。", ROOM_KIND.cursedColor);
      return;
    default:
      return;
  }
}

const AMBUSH_SHAKE = 5;

/** 賭博の外れ。制圧済みの部屋なので封鎖はせず、湧いた敵がそのまま追ってくる */
function gambleAmbush(state: GameState, index: number): void {
  roomHooks.spawnReinforcements(state, index, roomHooks.enemyCount(state), true);
  shake(state, AMBUSH_SHAKE);
  pushSfx(state, "ambush");
}

function spawnHeart(state: GameState, pos: Vec): void {
  roomHooks.dropHeart(state, pos);
}

/** 共鳴の支配色（無ければ装備の性質で最も多い色、それも無ければ乱数） */
function forgeColor(state: GameState): TraitColor {
  const dominant = state.stats.resonance.colors[0];
  if (dominant) return dominant;
  return state.rng.pick(TRAIT_COLORS);
}

function useAnvil(state: GameState, prop: RoomProp): void {
  prop.used = true;
  const color = forgeColor(state);
  state.runEvents.pendingEchoes[color] += ROOM_KIND.forgeEchoes;
  applyStatus(state, { kind: "player" }, { kind: "burn", stacks: 1, duration: ROOM_KIND.forgeBurnDuration, potency: ROOM_KIND.forgeBurnDps }, "env");
  spawnBurst(state, prop.pos, ROOM_KIND.forgeColor, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  sayAt(state, `残響 +${ROOM_KIND.forgeEchoes}`, ROOM_KIND.forgeColor);
  pushLog(state, "金床を打った。炉の熱が身を焦がす。", ROOM_KIND.forgeColor);
  pushSfx(state, "pedestalUse");
}

/** 部屋に落ちている遺物を残響に換える（倍率付き） */
function useExchange(state: GameState, room: RoomState, prop: RoomProp): void {
  const inside = state.floorItems.filter((f) => pxInRoom(state, room, f.pos));
  if (inside.length === 0) {
    sayAt(state, "置かれた遺物がない", ROOM_KIND.exchangeColor);
    return;
  }
  prop.used = true;
  const gained = createEchoWallet();
  for (const f of inside) {
    const y = shatterYield(f.item);
    for (const c of TRAIT_COLORS) gained[c] += Math.ceil(y[c] * ROOM_KIND.exchangeMul);
  }
  for (const c of TRAIT_COLORS) state.runEvents.pendingEchoes[c] += gained[c];
  const ids = new Set(inside.map((f) => f.id));
  state.floorItems = state.floorItems.filter((f) => !ids.has(f.id));
  const total = TRAIT_COLORS.reduce((s, c) => s + gained[c], 0);
  spawnBurst(state, prop.pos, ROOM_KIND.exchangeColor, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  sayAt(state, `残響 +${total}`, ROOM_KIND.exchangeColor);
  pushSfx(state, "dismantle");
}

function pxInRoom(state: GameState, room: RoomState, pos: Vec): boolean {
  const tx = Math.floor(pos.x / TILE_SIZE);
  const ty = Math.floor(pos.y / TILE_SIZE);
  if (room.tiles) return room.tiles.has(toIndex(state.map, tx, ty));
  const r = room.rect;
  return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}

/** 呪い付きの祝福を 1 つ受ける代わりに、祝福の 3 択を開く */
function useCurseShrine(state: GameState, prop: RoomProp): void {
  prop.used = true;
  const pool = BOON_KEYS.filter((k) => BOONS[k].cursed && !hasBoon(state, k) && !BOONS[k].after && !BOONS[k].duo);
  if (pool.length > 0) grantBoon(state, state.rng.pick(pool));
  spawnBurst(state, prop.pos, ROOM_KIND.curseShrineColor, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  pushLog(state, "呪いを受け入れた。祠が祝福を差し出す。", ROOM_KIND.curseShrineColor);
  offerBoons(state);
}

/** フロア全体の地図を開く代わりに、死神が近づく */
function ringBell(state: GameState, prop: RoomProp): void {
  prop.used = true;
  const map = state.map;
  for (let i = 0; i < map.tiles.length; i++) {
    if (state.explored[i] || !isWalkable(map, i % map.width, Math.floor(i / map.width))) continue;
    state.explored[i] = 1;
    state.exploredLog.push(i);
  }
  state.floorTime += ROOM_KIND.watchtowerReaperCost;
  shake(state, PROP_CLEARANCE);
  sayAt(state, "鐘が鳴り響く", ROOM_KIND.watchtowerColor);
  pushLog(state, "見張り台の鐘が階を照らした。死神が音を聞きつけた。", ROOM_KIND.watchtowerColor);
  pushSfx(state, "pedestalUse");
}

const REAPER_NEST_ITEM_BOOST = 1;

function openChest(state: GameState, prop: RoomProp): void {
  prop.used = true;
  if (prop.key === "reaper") {
    openReaperChest(state, prop);
    return;
  }
  dropRareItem(state, prop.pos);
  sayAt(state, "逃げ切った", ROOM_KIND.escapeColor);
  pushSfx(state, "treasureOpen");
}

/** 死神の巣: 深い遺物。開けた瞬間に死神が来る */
function openReaperChest(state: GameState, prop: RoomProp): void {
  const item = generateItem(state.rng, {
    itemLevel: state.depth + ROOM_KIND.reaperNestDepthBonus,
    rarityBoost: REAPER_NEST_ITEM_BOOST,
    foundDepth: state.depth,
    // 決定性に影響しない（foundAt と id の表示用にだけ使われる）
    now: Date.now(),
    excludeNamed: state.lockedRelics,
  });
  state.floorItems.push({ id: allocId(state), item, pos: { x: prop.pos.x, y: prop.pos.y + TILE_SIZE }, bobTime: 0 });
  pushSfx(state, "treasureOpen");
  if (!state.reaper) spawnReaper(state);
}

// -----------------------------------------------------------------------------
// 戦う部屋: 入ったとき・封鎖したとき・制圧したとき
// -----------------------------------------------------------------------------

/**
 * floor.ts の湧かせ処理（循環 import で初期化順に依存しないよう、floor.ts が起動時に差し込む）
 */
export interface RoomHooks {
  spawnReinforcements: (state: GameState, index: number, rolls: number, spawning: boolean) => void;
  spawnEnemyAt: (state: GameState, def: EnemyDef, index: number) => Enemy | null;
  enemyCount: (state: GameState) => number;
  dropHeart: (state: GameState, pos: Vec) => void;
}

const noop = (): void => undefined;
export const roomHooks: RoomHooks = {
  spawnReinforcements: noop,
  spawnEnemyAt: () => null,
  enemyCount: () => 0,
  dropHeart: noop,
};

/** 封鎖しない部屋に入った（逃走）。true なら封鎖しない */
export function enterSpecialRoom(state: GameState, room: RoomState): boolean {
  if (room.kind !== "escape") return false;
  startEscape(state, room);
  return true;
}

/** 封鎖した直後の追加の湧き（floor.ts の lockRoom から）。true なら通常の増援を湧かせない */
export function lockSpecialRoom(state: GameState, room: RoomState, index: number): boolean {
  switch (room.kind) {
    case "escort":
      roomHooks.spawnReinforcements(state, index, roomHooks.enemyCount(state), true);
      sayAt(state, "守り抜け", ROOM_KIND.escortColor);
      return true;
    case "nest":
      spawnLairMaster(state, index);
      return false;
    case "mirror":
      spawnMirror(state, index);
      return true;
    default:
      return false;
  }
}

const SAFE_ELITES: readonly EliteKind[] = ["hasted", "shielded", "reflective", "bulwark", "explosive", "retaliating"];

function pickElite(state: GameState, def: EnemyDef): EliteKind | null {
  const allowed = SAFE_ELITES.filter((k) => eliteKindsFor(def).includes(k));
  return allowed.length > 0 ? state.rng.pick(allowed) : null;
}

/** 巣: 部屋主（無ければその深度で最も硬い敵）を 1 体、HP を増やしエリートにして湧かせる */
function spawnLairMaster(state: GameState, index: number): void {
  const lairs = ENEMIES.filter((d) => d.lairMaster && d.minDepth <= state.depth && d.weight > 0);
  const pool = enemiesForDepth(state.depth).filter((d) => !d.swarm && !d.timid);
  const def = lairs.length > 0 ? state.rng.pick(lairs) : pool.reduce<EnemyDef | undefined>((a, d) => (!a || d.hp > a.hp ? d : a), undefined);
  if (!def) return;
  const e = roomHooks.spawnEnemyAt(state, def, index);
  if (!e) return;
  e.maxHp = Math.round(e.maxHp * ROOM_KIND.nestHpMul);
  e.hp = e.maxHp;
  e.lastHp = e.hp;
  const elite = e.elite ? null : pickElite(state, def);
  if (elite) makeElite(e, elite);
  sayAt(state, `巣の主: ${def.name}`, ROOM_KIND.nestColor);
}

/** 鏡: 今のビルドを写した鏡像。HP はプレイヤーの最大 HP、祝福が多いほどエリート修飾子が付く */
function spawnMirror(state: GameState, index: number): void {
  const def = enemyDef("mirrorSelf");
  const e = roomHooks.spawnEnemyAt(state, def, index);
  if (!e) return;
  e.maxHp = Math.round(state.player.maxHp * ROOM_KIND.mirrorHpMul);
  e.hp = e.maxHp;
  e.lastHp = e.hp;
  const elites = Math.min(ROOM_KIND.mirrorEliteMax, Math.floor(state.boons.length / ROOM_KIND.mirrorBoonsPerElite));
  // 修飾子は 1 体に 1 つしか持てないので、2 つ目以降は HP の上乗せで表す
  const elite = elites > 0 ? pickElite(state, def) : null;
  if (elite) makeElite(e, elite);
  sayAt(state, "鏡に映った己が立ち上がる", ROOM_KIND.mirrorColor);
  pushSfx(state, "ambush");
}

/** 制圧時の追加報酬（floor.ts の clearRoom から） */
export function clearSpecialRoom(state: GameState, room: RoomState, center: Vec): void {
  switch (room.kind) {
    case "arena":
      dropRareItem(state, center);
      offerBoons(state);
      return;
    case "resonance":
      clearResonance(state, room, center);
      return;
    case "escort":
      clearEscort(state, room, center);
      return;
    case "nest":
    case "horde":
      dropRareItem(state, center);
      return;
    case "mirror":
      dropRareItem(state, center);
      offerBoons(state);
      pushLog(state, "己の写しを越えた。", ROOM_KIND.mirrorColor);
      return;
    default:
      return;
  }
}

/** 共鳴炉: 扉の色と今の共鳴の色が合えば報酬が倍 */
export function resonanceMatches(state: GameState, room: RoomState): boolean {
  const color = room.special?.color;
  return color !== null && color !== undefined && state.stats.resonance.colors.includes(color);
}

function clearResonance(state: GameState, room: RoomState, center: Vec): void {
  if (!resonanceMatches(state, room)) return;
  // 共鳴炉の上乗せは確定（部屋制圧の報酬は確率になったが、こちらは条件を満たした報酬なので絞らない）
  for (let i = 0; i < ROOM_KIND.resonanceBonusDrops; i++) dropBonusReward(state, center);
  sayAt(state, "共鳴炉が起動した", TRAIT_COLOR_TEXT);
  pushSfx(state, "treasureOpen");
}

const TRAIT_COLOR_TEXT = "#ffe080";
const ESCORT_HEAL_RATIO = 0.3;

function clearEscort(state: GameState, room: RoomState, center: Vec): void {
  const special = room.special;
  if (!special || special.failed) return;
  consumeAll(room, "captive");
  dropRareItem(state, center);
  healPlayer(state, state.player.maxHp * ESCORT_HEAL_RATIO);
  spawnBurst(state, center, COLOR_HEAL, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  sayAt(state, "護衛成功", ROOM_KIND.escortColor);
}

// -----------------------------------------------------------------------------
// 毎ステップ: 護衛・逃走
// -----------------------------------------------------------------------------

export function updateSpecialRooms(state: GameState, dt: number): void {
  updateRoomProps(state);
  state.rooms.forEach((room, index) => {
    if (room.kind === "escort" && room.locked) tickEscort(state, room, index, dt);
    if (room.kind === "escape") tickEscape(state, room, dt);
  });
}

/** 護衛: 対象の近くにいる敵の数だけ削れる */
function tickEscort(state: GameState, room: RoomState, index: number, dt: number): void {
  const special = room.special;
  const captive = special?.props.find((p) => p.kind === "captive");
  if (!special || !captive || special.failed) return;
  const near = state.enemies.filter(
    (e) => e.roomIndex === index && e.hp > 0 && circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, captive.pos.x, captive.pos.y, ROOM_KIND.escortRadius),
  ).length;
  if (near === 0) return;
  special.hp = Math.max(0, special.hp - near * ROOM_KIND.escortDps * dt);
  if (special.hp > 0) return;
  special.failed = true;
  captive.used = true;
  sayAt(state, "護衛失敗", ROOM_KIND.cursedColor);
  pushLog(state, "捕らわれ人が倒れた。", ROOM_KIND.cursedColor);
  pushSfx(state, "enemyWindup");
}

/** 部屋の四隅（内側 1 マス）のうち、入口から最も遠い床 */
function farthestCorner(state: GameState, room: RoomState, from: Vec): Vec {
  const r = room.rect;
  const corners = [
    { x: r.x + 1.5, y: r.y + 1.5 },
    { x: r.x + r.w - 1.5, y: r.y + 1.5 },
    { x: r.x + 1.5, y: r.y + r.h - 1.5 },
    { x: r.x + r.w - 1.5, y: r.y + r.h - 1.5 },
  ].map((c) => ({ x: c.x * TILE_SIZE, y: c.y * TILE_SIZE }));
  let best = rectCenterPx(r);
  let bestDist = -1;
  for (const c of corners) {
    if (overlapsWall(state, c.x, c.y, PROP_CLEARANCE) || !pxInRoom(state, room, c)) continue;
    const d = Math.hypot(c.x - from.x, c.y - from.y);
    if (d > bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** 逃走: 入った瞬間に奥の宝箱が現れ、入口から床が崩れて（溶岩になって）いく */
function startEscape(state: GameState, room: RoomState): void {
  const special = specialOf(room);
  room.cleared = true;
  const from = { ...state.player.body.pos };
  special.origin = from;
  special.timer = 0;
  special.tick = 0;
  addProp(room, "chest", farthestCorner(state, room, from), "escape");
  shake(state, PROP_CLEARANCE);
  sayAt(state, "床が崩れる！", ROOM_KIND.escapeColor);
  pushLog(state, "足元が崩れ始めた。奥の宝箱へ走れ。", ROOM_KIND.escapeColor);
  pushSfx(state, "runEventWarn");
}

/** 崩れる範囲の広がりを止める半径（部屋の対角線ぶん） */
function escapeMaxRadius(room: RoomState): number {
  return Math.hypot(room.rect.w, room.rect.h) * TILE_SIZE;
}

function tickEscape(state: GameState, room: RoomState, dt: number): void {
  const special = room.special;
  if (!special || special.timer === null || !special.origin) return;
  special.timer += dt;
  const radius = Math.max(0, special.timer - ESCAPE_GRACE) * ROOM_KIND.escapeSpeed;
  if (radius > escapeMaxRadius(room)) return;
  special.tick -= dt;
  if (special.tick > 0 || radius <= 0) return;
  special.tick = ROOM_KIND.escapeTickInterval;
  placeTerrain(state, special.origin.x, special.origin.y, "lava", radius, ROOM_KIND.escapeLavaTime);
}

/** 逃走: 崩れ始めるまでの猶予（予告）秒 */
export const ESCAPE_GRACE = 1;

/** 逃走の崩れがまだ広がっている部屋（HUD の予告行） */
export function escapeActive(state: GameState): boolean {
  return state.rooms.some((room) => {
    const s = room.special;
    if (room.kind !== "escape" || !s || s.timer === null) return false;
    const chest = s.props.find((p) => p.kind === "chest");
    return !(chest?.used ?? true) && Math.max(0, s.timer - ESCAPE_GRACE) * ROOM_KIND.escapeSpeed <= escapeMaxRadius(room);
  });
}

// -----------------------------------------------------------------------------
// 分岐路
// -----------------------------------------------------------------------------

/**
 * 最後の部屋に 2〜3 個の階段を置き、それぞれに次のフロア種別を割り当てる（重複なし）。
 * ボス階は撃破後に階段が出るので、行き先だけ先に決めて tile は -1 にしておく（ensureForkStairs が置く）。
 * 次の階の候補が 1 つなら階段も 1 つ
 */
export function planForkStairs(state: GameState): void {
  const count = state.rng.int(FLOOR_KIND.forkMin, FLOOR_KIND.forkMax);
  const kinds = pickFloorKinds(state.depth + 1, state.rng, count);
  if (isBossDepth(state.depth)) {
    state.stairs = kinds.map((nextKind) => ({ tile: -1, nextKind }));
    return;
  }
  state.stairs = placeStairs(state, kinds);
}

function placeStairs(state: GameState, kinds: readonly FloorKind[]): StairsChoice[] {
  const lastIndex = state.rooms.length - 1;
  const last = state.rooms[lastIndex];
  if (!last) return [];
  const tiles = forkStairsTiles(state.map, last.rect, last.tiles, kinds.length, FLOOR_KIND.forkOffset);
  return tiles.map((tile, i) => ({ tile, nextKind: kinds[i] ?? "rooms" }));
}

/** ボス撃破で中央に階段が出たら、残りの分岐の階段を置く */
export function ensureForkStairs(state: GameState): void {
  if (!state.stairs.some((s) => s.tile < 0)) return;
  if (!state.boss?.defeated) return;
  const kinds = state.stairs.map((s) => s.nextKind);
  state.stairs = placeStairs(state, kinds);
}

/** 階段タイルの行き先（分岐路に無い階段は undefined = 従来どおり抽選） */
export function stairsChoiceAt(state: GameState, tile: number): FloorKind | undefined {
  return state.stairs.find((s) => s.tile === tile)?.nextKind;
}

/** 分岐の階段がタイルとして置かれているか（テスト・QA 用） */
export function stairsTilesValid(state: GameState): boolean {
  return state.stairs.every((s) => s.tile < 0 || state.map.tiles[s.tile] === Tile.StairsDown);
}

