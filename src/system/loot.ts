import { type Enemy, type GameState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, fromAngle } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { LOOT_DROP } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { addToStash, saveProfile } from "../loot/profile";
import { SKILL } from "../skills/data";
import { generateSkillStone } from "../skills/generator";
import type { SkillStone } from "../skills/types";
import { RARITY_COLOR, type Item, type Rarity } from "../loot/types";
import { addFloatingText } from "./effects";
import { circlesOverlap, overlapsWall } from "./physics";

/** 装備のドロップと拾得。docs/LOOT_DESIGN.md「ドロップ」 */

const RARE_RARITIES: ReadonlySet<Rarity> = new Set(["rare", "unique"]);
const FULL_CIRCLE = Math.PI * 2;
const ITEM_RADIUS = 2;
const LABEL_TEXT_SCALE = 1;
const LABEL_TEXT_LIFE = 1.4;
/** combat.ts の COLOR_HURT と同じ値（循環 import を避けるためここで複製） */
const STASH_FULL_COLOR = "#ff5050";

/** 床アイテムを 1 個生成する。rarityBoost は深さ由来の分に上乗せ */
export function dropItem(state: GameState, pos: Vec, extraBoost = 0): Item {
  const depth = state.depth;
  const item = generateItem(state.rng, {
    itemLevel: depth + state.rng.int(0, LOOT_DROP.itemLevelSpread),
    rarityBoost: depth * LOOT_DROP.rarityBoostPerDepth + extraBoost,
    foundDepth: depth,
    // 決定性に影響しない（foundAt と id の表示用にだけ使われる）
    now: Date.now(),
  });
  state.floorItems.push({ id: allocId(state), item, pos: scatterPos(state, pos), bobTime: 0 });
  pushSfx(state, RARE_RARITIES.has(item.rarity) ? "lootRare" : "lootDrop");
  return item;
}

/** 少し弾けた位置。壁に埋まるなら元の位置 */
function scatterPos(state: GameState, pos: Vec): Vec {
  const dir = fromAngle(state.rng.next() * FULL_CIRCLE);
  const d = LOOT_DROP.scatter * state.rng.next();
  const p = { x: pos.x + dir.x * d, y: pos.y + dir.y * d };
  return overlapsWall(state, p.x, p.y, ITEM_RADIUS) ? { ...pos } : p;
}

export function enemyDropChance(state: GameState, enemy: Enemy): number {
  return enemyDef(enemy.defKey).dropChance + state.depth * LOOT_DROP.depthChanceBonus;
}

/** 撃破時の確率ドロップ */
export function rollEnemyDrop(state: GameState, enemy: Enemy): void {
  if (state.rng.chance(enemyDropChance(state, enemy))) dropItem(state, enemy.body.pos);
  if (state.rng.chance(SKILL.drop.stoneOnKill)) dropSkillStone(state, enemy.body.pos);
}

/** スキル石を床に 1 個落とす（拾うとスキル stash へ）。docs/ideas/skills.md「7-7」 */
export function dropSkillStone(state: GameState, pos: Vec): SkillStone {
  // now は決定性に影響しない（id と foundAt の表示用）
  const stone = generateSkillStone(state.rng, { foundDepth: state.depth, now: Date.now() });
  state.skills.floorStones.push({ id: allocId(state), stone, pos: scatterPos(state, pos), bobTime: 0, warned: false });
  pushSfx(state, "lootRare");
  return stone;
}

/** 部屋クリア報酬: 必ず 1 個 */
export function dropRoomReward(state: GameState, pos: Vec): void {
  dropItem(state, pos, LOOT_DROP.roomClearRarityBoost);
}

/** 階層到達ボーナス: プレイヤーの少し前に 1 個 */
export function dropDepthReward(state: GameState): void {
  const p = state.player.body.pos;
  const pos = { x: p.x + LOOT_DROP.arrivalOffset, y: p.y };
  dropItem(state, overlapsWall(state, pos.x, pos.y, ITEM_RADIUS) ? p : pos, LOOT_DROP.depthArrivalRarityBoost);
}

/** 触れたら stash へ。stash が満杯なら拾えず床に残る */
export function updateFloorItems(state: GameState, dt: number): void {
  const body = state.player.body;
  const picked = new Set<number>();
  for (const fi of state.floorItems) {
    fi.bobTime += dt;
    if (fi.bobTime < LOOT_DROP.pickupDelay) continue;
    if (!circlesOverlap(fi.pos.x, fi.pos.y, LOOT_DROP.pickupRadius, body.pos.x, body.pos.y, body.radius)) continue;
    if (pickUp(state, fi.item, fi.pos)) picked.add(fi.id);
  }
  if (picked.size === 0) return;
  state.floorItems = state.floorItems.filter((fi) => !picked.has(fi.id));
}

/** stash への追加を試みる。満杯だったら false（アイテムは床に残す） */
function pickUp(state: GameState, item: Item, pos: Vec): boolean {
  if (!addToStash(state.profile, item)) {
    addFloatingText(state, pos, "倉庫が満杯", STASH_FULL_COLOR, LABEL_TEXT_SCALE, LABEL_TEXT_LIFE);
    pushLog(state, "倉庫が満杯だ。先に何かを分解するか装備すること。", STASH_FULL_COLOR);
    return false;
  }
  saveProfile(state.profile);
  const color = RARITY_COLOR[item.rarity];
  addFloatingText(state, pos, item.name, color, LABEL_TEXT_SCALE, LABEL_TEXT_LIFE);
  pushLog(state, `${item.name}を拾った。`, color);
  pushSfx(state, RARE_RARITIES.has(item.rarity) ? "lootRare" : "pickup");
  return true;
}
