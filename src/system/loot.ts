import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, dist, fromAngle } from "../core/vec";
import { screenToWorld } from "../core/view";
import { enemyDef } from "../data/enemies";
import { LOOT_DROP, PICKUP } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { dominantColor } from "../loot/names";
import { addToStash, saveProfile } from "../loot/profile";
import { chooseBudOnItem, findPendingBud } from "../loot/provenance";
import { computeStats } from "../loot/stats";
import { SKILL, stoneLabel } from "../skills/data";
import { generateSkillStone } from "../skills/generator";
import { addStone, saveSkillProfile } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { RARITY_COLOR, TRAIT_COLOR_HEX, type AffixRoll, type Item, type Rarity } from "../loot/types";
import { addFloatingText, inscribeFx } from "./effects";
import { overlapsWall } from "./physics";
import { applyStats } from "./player";
import { ROAMING_ROOM } from "./spawner";
import { rollEnemyRuneDrop } from "./skills";

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
    excludeNamed: state.lockedRelics,
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

/** 深度別の表を引く（添字 0 = 深度 1。表より深ければ最後の値、空なら 1） */
export function byDepth(table: readonly number[], depth: number): number {
  const index = Math.min(table.length - 1, Math.max(0, Math.floor(depth) - 1));
  return table[index] ?? 1;
}

/** 確定ドロップの強敵（ボス級・巣窟の主）。絞りを掛けない */
function isGuaranteedDropSource(enemy: Enemy): boolean {
  const def = enemyDef(enemy.defKey);
  return def.dropChance >= 1 || def.boss === true || def.lairMaster === true;
}

/**
 * 撃破時のドロップ確率。通常敵は深度別の倍率（LOOT_DROP.mobDropMulByDepth）と徘徊・増援の倍率で絞る。
 * エリートは LOOT_DROP.eliteDropMul（通常敵より高い）、ボス・巣窟の主はそのまま
 * （「たくさん倒しても出ない、強敵を倒すと出る」）。エリートの追加抽選（elites.ts）もこれを使う
 */
export function enemyDropChance(state: GameState, enemy: Enemy): number {
  const base = enemyDef(enemy.defKey).dropChance + state.depth * LOOT_DROP.depthChanceBonus;
  if (isGuaranteedDropSource(enemy)) return base;
  if (enemy.elite !== undefined) return base * LOOT_DROP.eliteDropMul;
  const roaming = enemy.roomIndex === ROAMING_ROOM ? LOOT_DROP.roamingDropMul : 1;
  return base * byDepth(LOOT_DROP.mobDropMulByDepth, state.depth) * roaming;
}

/** 撃破時の確率ドロップ */
export function rollEnemyDrop(state: GameState, enemy: Enemy): void {
  // 拠点の木人は revived で除外済みだが、拠点で出た敵が何であっても落とさない
  if (state.sandbox) return;
  if (state.rng.chance(enemyDropChance(state, enemy))) dropItem(state, enemy.body.pos);
  if (state.rng.chance(SKILL.drop.stoneOnKill)) dropSkillStone(state, enemy.body.pos);
  rollEnemyRuneDrop(state, enemy);
}

/** スキル石を床に 1 個落とす（拾うとスキル stash へ）。docs/ideas/skills.md「7-7」 */
export function dropSkillStone(state: GameState, pos: Vec): SkillStone {
  // now は決定性に影響しない（id と foundAt の表示用）
  const stone = generateSkillStone(state.rng, { foundDepth: state.depth, now: Date.now(), moveset: state.stats.moveset });
  state.skills.floorStones.push({ id: allocId(state), stone, pos: scatterPos(state, pos), bobTime: 0, warned: false });
  pushSfx(state, "lootRare");
  return stone;
}

/** 部屋制圧の報酬が出る確率（深度別） */
export function roomClearDropChance(depth: number): number {
  return byDepth(LOOT_DROP.roomClearChanceByDepth, depth);
}

/** 部屋制圧の報酬: 深度別の確率で 1 個（序盤から出すぎないよう、常に 1 個だった旧仕様を絞る） */
export function dropRoomReward(state: GameState, pos: Vec): void {
  if (!state.rng.chance(roomClearDropChance(state.depth))) return;
  dropItem(state, pos, LOOT_DROP.roomClearRarityBoost);
}

/** 特別な報酬（共鳴炉・増援の撃退など）: 部屋制圧と同じ揺らぎで必ず 1 個 */
export function dropBonusReward(state: GameState, pos: Vec): void {
  dropItem(state, pos, LOOT_DROP.roomClearRarityBoost);
}

/** 階層到達ボーナス: LOOT_DROP.depthArrivalChance でプレイヤーの少し前に 1 個 */
export function dropDepthReward(state: GameState): void {
  if (!state.rng.chance(LOOT_DROP.depthArrivalChance)) return;
  const p = state.player.body.pos;
  const pos = { x: p.x + LOOT_DROP.arrivalOffset, y: p.y };
  dropItem(state, overlapsWall(state, pos.x, pos.y, ITEM_RADIUS) ? p : pos, LOOT_DROP.depthArrivalRarityBoost);
}

/**
 * 床の遺物の揺れの時間だけ進める。拾得は触れてではなく注目 + インタラクト（updateDropInteract）。
 * スキル石の揺れは system/skills.ts が進める
 */
export function updateFloorItems(state: GameState, dt: number): void {
  for (const fi of state.floorItems) fi.bobTime += dt;
}

// ---------------------------------------------------------------------------
// 注目とインタラクト（memo 2026-09-24）。注目は state に持たず、描画と拾得が同じ純関数で求める
// ---------------------------------------------------------------------------

/** インタラクトで拾うドロップ品の種類。ハート・刻印符などの消耗品系は触れて拾うのでここに無い */
export type DropKind = "item" | "stone";

export type FocusedDrop =
  | { kind: "item"; id: number; pos: Vec; inReach: boolean; item: Item }
  | { kind: "stone"; id: number; pos: Vec; inReach: boolean; stone: SkillStone };

type DropCandidate = { kind: "item"; id: number; pos: Vec; item: Item } | { kind: "stone"; id: number; pos: Vec; stone: SkillStone };

function dropCandidates(state: GameState): DropCandidate[] {
  const items: DropCandidate[] = state.floorItems.map((fi) => ({ kind: "item", id: fi.id, pos: fi.pos, item: fi.item }));
  const stones: DropCandidate[] = state.skills.floorStones.map((fs) => ({ kind: "stone", id: fs.id, pos: fs.pos, stone: fs.stone }));
  return [...items, ...stones];
}

/** 照準の世界座標。照準が無い（マウス未使用・パッドの右スティック中立）なら null */
export function aimWorldOf(state: GameState, aimScreen: Vec | null): Vec | null {
  return aimScreen === null ? null : screenToWorld(state.camera, aimScreen);
}

/** プレイヤーから拾える距離か */
export function isInPickupReach(state: GameState, pos: Vec): boolean {
  return dist(state.player.body.pos, pos) <= PICKUP.reach;
}

function nearestTo(candidates: readonly DropCandidate[], origin: Vec, radius: number): DropCandidate | null {
  let best: DropCandidate | null = null;
  let bestDist = radius;
  for (const c of candidates) {
    const d = dist(c.pos, origin);
    // 同距離なら先の候補（遺物が先、各配列は落ちた順）。順序が決まっているので決定的
    if (d > bestDist || (best !== null && d === bestDist)) continue;
    best = c;
    bestDist = d;
  }
  return best;
}

/** 点 q から線分 a-b への距離 */
function distToSegment(q: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * abx + (q.y - a.y) * aby) / len2)) : 0;
  return Math.hypot(q.x - (a.x + abx * t), q.y - (a.y + aby * t));
}

/**
 * 照準が手の届く距離より遠く、その先に何も無いとき: プレイヤーから照準への線の近く（focusRadius 以内）で
 * 手の届くものを、プレイヤーに近い順に注目する。パッドの照準点は画面中心から AIM_STICK_DISTANCE（reach より遠い）
 * 先にあり、スティックを倒したまま R3 を押すと手の届く範囲を注目できなかったため
 */
function alongAim(state: GameState, candidates: readonly DropCandidate[], aimWorld: Vec): DropCandidate | null {
  const p = state.player.body.pos;
  if (dist(p, aimWorld) <= PICKUP.reach) return null;
  let best: DropCandidate | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (!isInPickupReach(state, c.pos) || distToSegment(c.pos, p, aimWorld) > PICKUP.focusRadius) continue;
    const d = dist(c.pos, p);
    // 同距離なら先の候補（順序が決まっているので決定的）
    if (d >= bestDist) continue;
    best = c;
    bestDist = d;
  }
  return best;
}

/**
 * 注目中のドロップ品。照準から PICKUP.focusRadius 以内で最も近いもの（遠くても注目はする。拾えるかは inReach）。
 * 照準の先に何も無く、照準が手の届く距離より遠ければ、照準への線の近くで手の届くもの（alongAim）。
 * 照準が無いとき（パッドで右スティック中立）はプレイヤーの手の届く範囲で最も近いものを注目する
 */
export function focusedDrop(state: GameState, aimWorld: Vec | null): FocusedDrop | null {
  const candidates = dropCandidates(state);
  const hit =
    aimWorld === null
      ? nearestTo(candidates, state.player.body.pos, PICKUP.reach)
      : (nearestTo(candidates, aimWorld, PICKUP.focusRadius) ?? alongAim(state, candidates, aimWorld));
  if (hit === null) return null;
  return { ...hit, inReach: isInPickupReach(state, hit.pos) };
}

/** step から呼ぶ: インタラクトが押されていれば注目中のドロップ品を拾う */
export function updateDropInteract(state: GameState, input: FrameInput): void {
  if (!input.interactPressed) return;
  const focus = focusedDrop(state, aimWorldOf(state, input.aimScreen));
  if (focus === null || !focus.inReach) return;
  if (focus.kind === "item") {
    if (pickUp(state, focus.item, focus.pos)) state.floorItems = state.floorItems.filter((fi) => fi.id !== focus.id);
    return;
  }
  if (pickUpStone(state, focus.stone, focus.pos)) {
    state.skills.floorStones = state.skills.floorStones.filter((fs) => fs.id !== focus.id);
  }
}

/** スキル倉庫への追加を試みる。満杯なら false（石は床に残す） */
function pickUpStone(state: GameState, stone: SkillStone, pos: Vec): boolean {
  const profile = state.skills.profile;
  if (!addStone(profile, stone)) {
    addFloatingText(state, pos, "スキル倉庫が満杯", STASH_FULL_COLOR, LABEL_TEXT_SCALE, LABEL_TEXT_LIFE);
    return false;
  }
  saveSkillProfile(profile);
  const label = stoneLabel(stone);
  addFloatingText(state, pos, label, SKILL.drop.stoneColor, LABEL_TEXT_SCALE, LABEL_TEXT_LIFE);
  pushLog(state, `スキル石: ${label}`, SKILL.drop.stoneColor);
  pushSfx(state, "lootRare");
  return true;
}

/** stash への追加を試みる。満杯だったら false（アイテムは床に残す） */
function pickUp(state: GameState, item: Item, pos: Vec): boolean {
  if (!addToStash(state.profile, item)) {
    addFloatingText(state, pos, "倉庫が満杯", STASH_FULL_COLOR, LABEL_TEXT_SCALE, LABEL_TEXT_LIFE);
    pushLog(state, "倉庫が満杯です。分解か装備で空きを作ってください。", STASH_FULL_COLOR);
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
  const unnamed = item.inscription === undefined;
  const chosen = chooseBudOnItem(item, index);
  if (chosen === null) return null;
  if (unnamed && item.inscription !== undefined) inscribeFx(state);
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
