import type { GameState, RoomState } from "../core/state";
import { pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { ECONOMY } from "../data/tuning";
import { TILE_SIZE, rectCenterPx, toIndex } from "../map/grid";
import { addFloatingText, spawnBurst } from "./effects";
import { spendCoins } from "./economy";
import { overlapsWall } from "./physics";

/**
 * 寄進の祠（docs/ideas/economy-impl.md 2-9）。章の境の休符（章の 1 階目）の開始部屋に立ち、触れるたびに
 * 持ち金の ECONOMY.donation.step（最低 min）を納める。全額まで繰り返せる。ラン内の効果は無く、
 * 総額は economy.donated に積む。永続（HubSave.donated）へ足すのは main.ts の endRun だけ（step の中では保存しない）。
 * 台座そのものの置き方・触れ方は specialRooms.ts（PropKind "donation"）。ここは額の計算と納める処理と置き場所の選び方
 */

const TEXT_LIFT = 12;
const TEXT_SCALE = 1.3;
const BURST_PARTICLES = 12;
const BURST_SPEED = 70;
const BURST_LIFE = 0.5;
/** 祠が壁に掛からない余白。他の台座と同じ（specialRooms.ts の PROP_CLEARANCE） */
const SHRINE_CLEARANCE = 4;
/** 持ち金が無いときの浮き文字 */
const EMPTY_TEXT = "銭なし";

/** 1 回の寄進の額: 持ち金の step、ただし最低 min。持ち金がそれ未満なら全額（0 なら 0） */
export function donationAmount(coins: number): number {
  if (coins <= 0) return 0;
  const step = Math.round(coins * ECONOMY.donation.step);
  return Math.min(coins, Math.max(ECONOMY.donation.min, step));
}

/** 祠に触れた: 寄進して総額に積む。納めた額を返す（持ち金が無ければ 0 で何も起きない） */
export function donate(state: GameState, shrinePos: Vec): number {
  const p = state.player.body.pos;
  const at = { x: p.x, y: p.y - TEXT_LIFT };
  const amount = donationAmount(state.economy.coins);
  if (amount <= 0 || !spendCoins(state, amount, "donation")) {
    addFloatingText(state, at, EMPTY_TEXT, ECONOMY.donation.color, TEXT_SCALE, ECONOMY.donation.textLife, "notice");
    return 0;
  }
  state.economy.donated += amount;
  spawnBurst(state, shrinePos, ECONOMY.donation.color, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  addFloatingText(state, at, `寄進 ${amount}`, ECONOMY.donation.color, TEXT_SCALE, ECONOMY.donation.textLife, "notice");
  pushSfx(state, "pedestalUse");
  return amount;
}

/**
 * 祠を置く点: 部屋の中心（プレイヤーの出現位置。契約者の台座は縦にずれて並ぶ）から横に offsets の順に、
 * 右・左の順で試し、壁に掛からず部屋の床の内側の最初の点。置けなければ null。乱数は使わない
 */
export function donationSpot(state: GameState, room: RoomState): Vec | null {
  const c = rectCenterPx(room.rect);
  for (const offset of ECONOMY.donation.offsets) {
    for (const sign of [1, -1]) {
      const pos = { x: c.x + sign * offset * TILE_SIZE, y: c.y };
      if (spotUsable(state, room, pos)) return pos;
    }
  }
  return null;
}

function spotUsable(state: GameState, room: RoomState, pos: Vec): boolean {
  if (overlapsWall(state, pos.x, pos.y, SHRINE_CLEARANCE)) return false;
  const tx = Math.floor(pos.x / TILE_SIZE);
  const ty = Math.floor(pos.y / TILE_SIZE);
  if (room.tiles) return room.tiles.has(toIndex(state.map, tx, ty));
  const r = room.rect;
  return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}
