import type { GameState, RoomState } from "../core/state";
import { ROAM } from "../data/tuning";
import { TILE_SIZE, inBounds, rectContainsPx, toIndex } from "../map/grid";

/**
 * 「交戦中」の唯一の判定（祝福・誓約・性質・トリガー条件・ラストキル・縛りが共通で使う）。
 * 開放型フロアでは通常の部屋を封鎖しないため、「封鎖中」の代わりに「封鎖中 または 交戦中」を見る。
 * combat.ts の inCombat（回復・マナ用の「近くに敵がいる」）とは別概念。
 * floor.ts から import すると keystones → floor → … → keywords（トップレベルで KS を読む）の循環になるので、
 * state と map だけに依存する葉のモジュールに置く
 */

/**
 * 部屋が交戦状態か: 封鎖中か、開放型で交戦が始まっていて未制圧（敵の生死は見ない）。
 * 封鎖は制圧で必ず解けるので、封鎖中なら cleared は見ない
 */
export function roomInCombat(room: RoomState): boolean {
  return room.locked || (room.engaged === true && !room.cleared);
}

function roomHasLiving(state: GameState, index: number): boolean {
  return state.enemies.some((e) => e.roomIndex === index && e.hp > 0);
}

/** プレイヤーの中心がその部屋（塊ならその所属タイル）の上にあるか */
function playerInRoom(state: GameState, room: RoomState): boolean {
  const p = state.player.body.pos;
  if (!room.tiles) return rectContainsPx(room.rect, p.x, p.y);
  const tx = Math.floor(p.x / TILE_SIZE);
  const ty = Math.floor(p.y / TILE_SIZE);
  return inBounds(state.map, tx, ty) && room.tiles.has(toIndex(state.map, tx, ty));
}

/**
 * 部屋の敵のうち、気付いて（idle / spawning 以外）生きていて、プレイヤーの近く（ROAM.engageLeash 以内）にいるものがいるか。
 * 開放型では部屋から通路へ敵を引き出して戦えるので、部屋の外でも「追ってきた敵」と戦っている間は交戦中にする
 */
function roomChasing(state: GameState, index: number): boolean {
  const p = state.player.body.pos;
  const leash2 = ROAM.engageLeash * ROAM.engageLeash;
  return state.enemies.some((e) => {
    if (e.roomIndex !== index || e.hp <= 0 || e.phase === "idle" || e.phase === "spawning") return false;
    const dx = e.body.pos.x - p.x;
    const dy = e.body.pos.y - p.y;
    return dx * dx + dy * dy <= leash2;
  });
}

/**
 * 今いる交戦中の部屋の index（無ければ -1）。
 * 封鎖中の部屋は波の合間でも交戦中（プレイヤーは必ずその中にいる）。
 * 封鎖しない部屋は、交戦が始まっていて生きた敵が残り、プレイヤーがその中にいるとき。
 * 部屋の外でも、その部屋の気付いた敵が近くで生きている間は交戦中（部屋の中にいる方を優先する）
 */
export function engagedRoomIndex(state: GameState): number {
  const locked = state.rooms.findIndex((r) => r.locked);
  if (locked >= 0) return locked;
  const inside = state.rooms.findIndex((r, i) => roomInCombat(r) && roomHasLiving(state, i) && playerInRoom(state, r));
  if (inside >= 0) return inside;
  return state.rooms.findIndex((r, i) => roomInCombat(r) && roomChasing(state, i));
}

/** 今いる部屋が交戦中か（「封鎖中」を条件にしていた要素はすべてこれを見る） */
export function isEngaged(state: GameState): boolean {
  return engagedRoomIndex(state) >= 0;
}
