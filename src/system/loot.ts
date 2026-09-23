import { type Enemy, type GameState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, fromAngle } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { LOOT_DROP } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { dominantColor } from "../loot/names";
import { addToStash, saveProfile } from "../loot/profile";
import { chooseBudOnItem, findPendingBud } from "../loot/provenance";
import { computeStats } from "../loot/stats";
import { SKILL } from "../skills/data";
import { generateSkillStone } from "../skills/generator";
import type { SkillStone } from "../skills/types";
import { RARITY_COLOR, TRAIT_COLOR_HEX, type AffixRoll, type Item, type Rarity } from "../loot/types";
import { addFloatingText } from "./effects";
import { circlesOverlap, overlapsWall } from "./physics";
import { applyStats } from "./player";

/**
 * 装備のドロップと拾得、芽の選択。docs/LOOT_DESIGN.md「ドロップ」「来歴と芽」。
 * 格付けの抽選は無い。深度が期待値と揺らぎ幅を決め、ドロップ元の boost が揺らぎを広げる
 * （ボス撃破・宝物庫・試練は boost が大きく、荒い遺物や名のある遺物が出やすい）
 */

/** 荒い / 反転ありの遺物は派手な音 */
const RARE_RARITIES: ReadonlySet<Rarity> = new Set(["rare", "unique"]);
const BUD_TEXT_COLOR = "#9dffb0";
const FULL_CIRCLE = Math.PI * 2;
const ITEM_RADIUS = 2;
const LABEL_TEXT_SCALE = 1;
const LABEL_TEXT_LIFE = 1.4;
/** combat.ts の COLOR_HURT と同じ値（循環 import を避けるためここで複製） */
const STASH_FULL_COLOR = "#ff5050";

/** 床アイテムを 1 個生成する。extraBoost は揺らぎの増幅（深さによる揺らぎの広がりは generator 側） */
export function dropItem(state: GameState, pos: Vec, extraBoost = 0): Item {
  const depth = state.depth;
  const item = generateItem(state.rng, {
    itemLevel: depth + state.rng.int(0, LOOT_DROP.itemLevelSpread),
    rarityBoost: extraBoost,
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
  const color = itemColor(item);
  addFloatingText(state, pos, item.name, color, LABEL_TEXT_SCALE, LABEL_TEXT_LIFE);
  pushLog(state, `${item.name}を拾った。`, color);
  pushSfx(state, RARE_RARITIES.has(item.rarity) ? "lootRare" : "pickup");
  return true;
}

/** 床・ログでの色: 最も多い性質の色。性質が無ければ揺らぎの分類色 */
export function itemColor(item: Item): string {
  const hue = dominantColor(item.affixes);
  return hue === undefined ? RARITY_COLOR[item.rarity] : TRAIT_COLOR_HEX[hue];
}

/**
 * 提示中の芽（state.pendingBud）から index（0 / 1）を選ぶ。UI から呼ぶ。
 * 選んだ性質を装備に加えて stats を畳み込み直し、保存して、次の芽があれば pendingBud に出す。
 * 選べたら選んだ性質、提示が無い / index 不正なら null
 */
export function chooseBud(state: GameState, index: number): AffixRoll | null {
  const pending = state.pendingBud;
  if (pending === null) return null;
  const item = state.profile.equipment[pending.slot];
  if (item === null || item.id !== pending.itemId) {
    state.pendingBud = findPendingBud(state.profile);
    return null;
  }
  const chosen = chooseBudOnItem(item, index);
  if (chosen === null) return null;
  applyStats(state, computeStats(state.profile.equipment));
  saveProfile(state.profile);
  state.pendingBud = findPendingBud(state.profile);
  addFloatingText(state, state.player.body.pos, "芽吹いた", BUD_TEXT_COLOR, LABEL_TEXT_SCALE, LABEL_TEXT_LIFE);
  pushLog(state, `${item.name}が芽吹いた。`, BUD_TEXT_COLOR);
  return chosen;
}

/** pendingBud を装備の状態から作り直す（装備画面で付け外しした後などに UI が呼ぶ） */
export function refreshPendingBud(state: GameState): void {
  state.pendingBud = findPendingBud(state.profile);
}
