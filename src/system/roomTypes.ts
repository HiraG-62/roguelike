import type { Rng } from "../core/rng";
import { type FloorKind, type GameState, type RoomKind, type RoomState, allocId, pushLog, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { FLOOR_KIND, ROOM_KIND } from "../data/tuning";
import { generateItem } from "../loot/generator";
import type { Rarity } from "../loot/types";
import type { MapShape } from "../map/generator";
import { TILE_SIZE, Tile, rectCenter, rectCenterPx, setTile } from "../map/grid";
import { isBossDepth } from "./boss";
import { COLOR_HEAL, healPlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { finalizeLinks, rollElite } from "./elites";
import { dropItem } from "./loot";
import { circlesOverlap, overlapsWall } from "./physics";

/** 部屋の種類とフロア種別。docs/ideas/run-structure.md「1. フロアの種類」「2. 部屋の種類」 */

// -----------------------------------------------------------------------------
// フロア種別
// -----------------------------------------------------------------------------

export const FLOOR_KIND_LABEL: Readonly<Record<FloorKind, string>> = {
  rooms: "回廊",
  cave: "洞窟",
  dark: "暗闇",
};

const MAP_SHAPE: Readonly<Record<FloorKind, MapShape>> = {
  rooms: "rooms",
  cave: "cave",
  dark: "rooms",
};

export function mapShapeOf(kind: FloorKind): MapShape {
  return MAP_SHAPE[kind];
}

export function isCaveDepth(depth: number): boolean {
  return depth >= FLOOR_KIND.caveMinDepth && depth % FLOOR_KIND.caveInterval === FLOOR_KIND.caveRemainder;
}

/**
 * depth からフロア種別を決める。ボス階は boss.ts が「最後の部屋」を前提にしているので必ず rooms。
 * dark の抽選は darkMinDepth 以上でだけ rng を消費する（浅い階の乱数消費は従来どおり）
 */
export function chooseFloorKind(depth: number, rng: Rng): FloorKind {
  if (isBossDepth(depth)) return "rooms";
  if (isCaveDepth(depth)) return "cave";
  if (depth < FLOOR_KIND.darkMinDepth) return "rooms";
  return rng.chance(FLOOR_KIND.darkChance) ? "dark" : "rooms";
}

export function isDark(state: GameState): boolean {
  return state.floorKind === "dark";
}

// -----------------------------------------------------------------------------
// 部屋の種類の割り当て
// -----------------------------------------------------------------------------

interface UniqueKindRule {
  kind: RoomKind;
  chance: number;
  minDepth: number;
}

/** 1 フロアに 0〜1 個の種類。この順に抽選する */
const UNIQUE_KINDS: readonly UniqueKindRule[] = [
  { kind: "treasure", chance: ROOM_KIND.treasureChance, minDepth: 1 },
  { kind: "challenge", chance: ROOM_KIND.challengeChance, minDepth: ROOM_KIND.challengeMinDepth },
  { kind: "shrine", chance: ROOM_KIND.shrineChance, minDepth: ROOM_KIND.shrineMinDepth },
];

/** 敵が最初から置かれない種類（入ったときに湧く / 戦闘がない） */
const EMPTY_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(["treasure", "challenge", "shrine", "ambush"]);

export function startsEmpty(kind: RoomKind): boolean {
  return EMPTY_KINDS.has(kind);
}

/**
 * reserved 以外の部屋に種類を割り当てる（開始部屋・最初の戦闘部屋・階段/ボス部屋は normal のまま）。
 * 全て state.rng から決定的に決まる
 */
export function assignRoomKinds(state: GameState, reserved: ReadonlySet<number>): void {
  const candidates = state.rooms.map((_, i) => i).filter((i) => !reserved.has(i));
  for (const rule of UNIQUE_KINDS) {
    if (state.depth < rule.minDepth || candidates.length === 0) continue;
    if (!state.rng.chance(rule.chance)) continue;
    const [index] = candidates.splice(state.rng.int(0, candidates.length - 1), 1);
    const room = index === undefined ? undefined : state.rooms[index];
    if (room) room.kind = rule.kind;
  }
  if (state.depth < ROOM_KIND.ambushMinDepth) return;
  let ambushes = 0;
  for (const index of candidates) {
    if (ambushes >= ROOM_KIND.ambushMax) break;
    if (!state.rng.chance(ROOM_KIND.ambushChance)) continue;
    const room = state.rooms[index];
    if (!room) continue;
    room.kind = "ambush";
    ambushes++;
  }
}

// -----------------------------------------------------------------------------
// 宝物庫
// -----------------------------------------------------------------------------

const TREASURE_TEXT = "宝物庫";
const TREASURE_TEXT_SCALE = 1.6;
const TREASURE_TEXT_LIFE = 1.4;
const COIN_SPEED = 140;
const COIN_LIFE = 0.8;
const COIN_SIZE = 2;
const ITEM_RADIUS = 2;
const FULL_CIRCLE = Math.PI * 2;
const TEXT_LIFT = 10;

function textPos(state: GameState): Vec {
  return { x: state.player.body.pos.x, y: state.player.body.pos.y - TEXT_LIFT };
}

/** 入った瞬間に床アイテムを 2〜3 個（高 rarityBoost）+ コインの粒子。ロックしない */
export function openTreasure(state: GameState, room: RoomState): void {
  room.cleared = true;
  const c = rectCenterPx(room.rect);
  const n = state.rng.int(ROOM_KIND.treasureItemsMin, ROOM_KIND.treasureItemsMax);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * FULL_CIRCLE;
    const pos = { x: c.x + Math.cos(a) * ROOM_KIND.treasureItemSpread, y: c.y + Math.sin(a) * ROOM_KIND.treasureItemSpread };
    dropItem(state, overlapsWall(state, pos.x, pos.y, ITEM_RADIUS) ? c : pos, ROOM_KIND.treasureRarityBoost);
  }
  spawnBurst(state, c, ROOM_KIND.treasureCoinColor, ROOM_KIND.treasureCoinParticles, COIN_SPEED, COIN_LIFE, COIN_SIZE);
  addFloatingText(state, textPos(state), TREASURE_TEXT, ROOM_KIND.treasureCoinColor, TREASURE_TEXT_SCALE, TREASURE_TEXT_LIFE);
  pushLog(state, "宝物庫だ！", ROOM_KIND.treasureCoinColor);
  pushSfx(state, "lootRare");
  pushSfx(state, "treasureOpen");
}

// -----------------------------------------------------------------------------
// 試練
// -----------------------------------------------------------------------------

const WAVE_TEXT_SCALE = 1.5;
const WAVE_TEXT_LIFE = 1.2;
const WAVE_SHAKE = 3;
const RARE_OR_BETTER: ReadonlySet<Rarity> = new Set<Rarity>(["rare", "unique"]);
const RARE_ITEM_LEVEL_BONUS = 1;

export function waveText(wave: number): string {
  return `第${wave}波/${ROOM_KIND.challengeWaves}`;
}

/** 次の波へ。spawn は floor.ts の湧かせ処理（循環 import を避けるため受け取る） */
export function startWave(state: GameState, room: RoomState, spawn: () => void): void {
  room.wave += 1;
  spawn();
  shake(state, WAVE_SHAKE);
  addFloatingText(state, textPos(state), waveText(room.wave), ROOM_KIND.challengeColor, WAVE_TEXT_SCALE, WAVE_TEXT_LIFE);
  pushSfx(state, "roomLock");
  pushSfx(state, "waveStart");
}

export function hasMoreWaves(room: RoomState): boolean {
  return room.kind === "challenge" && room.wave < ROOM_KIND.challengeWaves;
}

/** rare 以上が出るまで引き直す（上限回数で打ち切り） */
export function dropRareItem(state: GameState, pos: Vec): void {
  const opts = () => ({
    itemLevel: state.depth + RARE_ITEM_LEVEL_BONUS,
    rarityBoost: ROOM_KIND.challengeRareBoost,
    foundDepth: state.depth,
    // 決定性に影響しない（foundAt と id の表示用にだけ使われる）
    now: Date.now(),
  });
  let item = generateItem(state.rng, opts());
  for (let i = 0; i < ROOM_KIND.challengeRareAttempts && !RARE_OR_BETTER.has(item.rarity); i++) {
    item = generateItem(state.rng, opts());
  }
  state.floorItems.push({ id: allocId(state), item, pos: { ...pos }, bobTime: 0 });
  pushSfx(state, "lootRare");
}

// -----------------------------------------------------------------------------
// 泉（shrine）と呪い
// -----------------------------------------------------------------------------

const BLESS_TEXT = "回復";
const CURSE_TEXT = "呪い";
const SHRINE_PARTICLES = 24;
const SHRINE_PARTICLE_SPEED = 90;
const SHRINE_PARTICLE_LIFE = 0.7;
const CURSE_TEXT_DELAY_LIFT = 12;

/** 泉のタイル中心（ピクセル） */
export function fountainPx(room: RoomState): Vec {
  const c = rectCenter(room.rect);
  return { x: (c.x + 0.5) * TILE_SIZE, y: (c.y + 0.5) * TILE_SIZE };
}

/** shrine 部屋の中央に泉を置く。戦闘がないので最初からクリア扱い */
export function setupShrine(state: GameState, room: RoomState): void {
  const c = rectCenter(room.rect);
  setTile(state.map, c.x, c.y, Tile.Fountain);
  room.cleared = true;
}

/** 泉に触れたら HP 全回復（1 回限り）。代わりに呪い */
export function updateShrines(state: GameState): void {
  const body = state.player.body;
  for (const room of state.rooms) {
    if (room.kind !== "shrine" || room.used) continue;
    const f = fountainPx(room);
    if (!circlesOverlap(f.x, f.y, ROOM_KIND.fountainRadius, body.pos.x, body.pos.y, body.radius)) continue;
    useFountain(state, room, f);
  }
}

function useFountain(state: GameState, room: RoomState, pos: Vec): void {
  room.used = true;
  const p = state.player;
  healPlayer(state, p.maxHp);
  // ks_berserker などの回復半減に関係なく全回復
  p.hp = p.maxHp;
  state.cursed = true;
  spawnBurst(state, pos, ROOM_KIND.shrineColor, SHRINE_PARTICLES, SHRINE_PARTICLE_SPEED, SHRINE_PARTICLE_LIFE, 2);
  spawnBurst(state, p.body.pos, COLOR_HEAL, SHRINE_PARTICLES, SHRINE_PARTICLE_SPEED, SHRINE_PARTICLE_LIFE, 2);
  addFloatingText(state, textPos(state), BLESS_TEXT, ROOM_KIND.shrineColor, WAVE_TEXT_SCALE, WAVE_TEXT_LIFE);
  const below = { x: p.body.pos.x, y: p.body.pos.y + CURSE_TEXT_DELAY_LIFT };
  addFloatingText(state, below, CURSE_TEXT, ROOM_KIND.cursedColor, 1, WAVE_TEXT_LIFE);
  pushLog(state, "泉があなたを癒した…次の部屋は荒れ模様だ。", ROOM_KIND.cursedColor);
  pushSfx(state, "heal");
  pushSfx(state, "fountainHeal");
}

/**
 * 呪い中なら、この部屋の通常敵にエリート抽選を追加で行い、呪いを解く。
 * 既に被弾している敵がエリート化しても、makeElite の満タン HP には戻さず HP 割合を維持する
 */
export function applyCurse(state: GameState, roomIndex: number): void {
  if (!state.cursed) return;
  state.cursed = false;
  for (const e of state.enemies) {
    if (e.roomIndex !== roomIndex || e.hp <= 0 || enemyDef(e.defKey).boss) continue;
    const wasElite = e.elite !== undefined;
    const hpRatio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    for (let k = 1; k < ROOM_KIND.cursedEliteRolls && !e.elite; k++) rollElite(state, e);
    if (!wasElite && e.elite) e.hp = Math.max(1, Math.min(e.maxHp, Math.round(e.maxHp * hpRatio)));
  }
  finalizeLinks(state, roomIndex);
  addFloatingText(state, textPos(state), CURSE_TEXT, ROOM_KIND.cursedColor, WAVE_TEXT_SCALE, WAVE_TEXT_LIFE);
}

// -----------------------------------------------------------------------------
// 伏兵
// -----------------------------------------------------------------------------

const AMBUSH_TEXT = "伏兵！";

export function announceAmbush(state: GameState): void {
  addFloatingText(state, textPos(state), AMBUSH_TEXT, ROOM_KIND.challengeColor, WAVE_TEXT_SCALE, WAVE_TEXT_LIFE);
  pushSfx(state, "ambush");
}
