import { rollSpread } from "../core/scale";
import {
  type GameState,
  type Merchant,
  type MerchantKind,
  ROAMING_ROOM,
  type RoomState,
  type Ware,
  type WareKind,
  allocId,
  pushLog,
  pushSfx,
} from "../core/state";
import type { Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { ECONOMY } from "../data/tuning";
import { TILE_SIZE, Tile, rectCenterPx, toIndex } from "../map/grid";
import { UNREACHABLE, distanceField, tileOf } from "../map/pathing";
import { isChapterBossDepth } from "./chapters";
import { layout } from "./contractors";
import { chapterScale, dropKey, gainKey, spendCoins } from "./economy";
import { addFloatingText, spawnBurst } from "./effects";
import { createEnemy } from "./enemies";
import { gainFlasks } from "./flask";
import { dropItem } from "./loot";
import { circlesOverlap } from "./physics";
import { dropRune } from "./skills";

/**
 * 商人と市（docs/ideas/economy-impl.md 2-5）。
 * - 毎階の前室（最後の部屋に距離場で最も近い部屋）に市、章ボス階の前室は章の市。buildFloor の最後に置く（既存の抽選を動かさない）
 * - 体は Enemy（data/enemies.ts の merchant。roomIndex = ROAMING_ROOM なので部屋の制圧・陣に数えない）。
 *   殴られるまで気付かず、怒ると品を投げる（system/merchantAi.ts）
 * - 台座に触れて買う（contractors.ts の updateContractors と同じ作法。モーダルなし）。値段は置いたときに章の倍率 × 揺らぎで引いて固定し、
 *   同じ品を買うたびに repeatMul ずつ、無法者（怒らせた商人を倒した）なら outlawPriceMul 倍になる
 * - 怒らせた商人を倒すと残りの品が床に落ち、このランは無法者になる
 */

export const MERCHANT_KEY = "merchant";
/** 並べる順（左から） */
export const WARE_KINDS: readonly WareKind[] = ["flask", "item", "rune", "key", "reroll"];

export const MERCHANT_LABEL: Readonly<Record<MerchantKind, string>> = {
  market: "市",
  chapterMarket: "章の市",
};

export const WARE_NAME: Readonly<Record<WareKind, string>> = {
  flask: "瓶",
  item: "遺物",
  rune: "刻印符",
  key: "鍵",
  reroll: "仕入れ直し",
};

/** 近づいたときの一言（商人の台詞。状態表示ではない） */
const GREETING: Readonly<Record<MerchantKind, string>> = {
  market: "見ていけ。銭さえあれば売る",
  chapterMarket: "章の境だ。瓶は多めに仕入れてある",
};

const OUTLAW_TEXT = "無法者";
const FLASK_FULL_TEXT = "瓶は満杯";
const REFUSED_TEXT = "取引拒否";
const FLASK_GAIN_TEXT = "瓶 +1";

const START_ROOM = 0;
/** 台座に触れたと判定する半径（px）。契約者の台座と同じ */
const WARE_TOUCH_RADIUS = 9;
const TEXT_LIFT = 10;
const TEXT_SCALE = 1;
const TEXT_LIFE = 1.4;
const BURST_PARTICLES = 14;
const BURST_SPEED = 80;
const BURST_LIFE = 0.5;
const DIR_UP = -1;
const DIR_DOWN = 1;

// -----------------------------------------------------------------------------
// 値段
// -----------------------------------------------------------------------------

/** 置いたときの値段（章の倍率 × 揺らぎ。rng 1 回） */
function rollBasePrice(state: GameState, kind: WareKind): number {
  const mean = ECONOMY.price.base[kind] * chapterScale(state.depth);
  return Math.max(1, Math.round(rollSpread(state.rng, mean, ECONOMY.price.spread)));
}

/** 今の値段: 置いたときの値段 × 買った回数の値上がり（仕入れ直しは回数ごとに rerollStep）× 無法者 */
export function warePrice(state: GameState, merchant: Readonly<Merchant>, ware: Readonly<Ware>): number {
  const eco = state.economy;
  const outlaw = eco.outlaw ? ECONOMY.market.outlawPriceMul : 1;
  if (ware.kind === "reroll") {
    return Math.round((ware.base + ECONOMY.price.rerollStep * chapterScale(state.depth) * merchant.rerolls) * outlaw);
  }
  const repeat = 1 + ECONOMY.price.repeatMul * (eco.bought[ware.kind] ?? 0);
  return Math.round(ware.base * repeat * outlaw);
}

/** 全商人の品の値段を書き直す（買う・仕入れ直す・無法者になったとき） */
function repriceAll(state: GameState): void {
  for (const m of state.economy.merchants) {
    for (const w of m.wares) w.price = warePrice(state, m, w);
  }
}

/** 台座の上に出す品札「瓶（40 銭）」 */
export function wareLabel(ware: Readonly<Ware>): string {
  return `${WARE_NAME[ware.kind]}（${ware.price} 銭）`;
}

// -----------------------------------------------------------------------------
// 置く（buildFloor の最後）
// -----------------------------------------------------------------------------

/** 商人の種類ごとの品の並び（ECONOMY.market.stock の数だけ、WARE_KINDS の順） */
export function stockPlan(kind: MerchantKind): WareKind[] {
  const table: Readonly<Partial<Record<WareKind, number>>> = ECONOMY.market.stock[kind];
  const out: WareKind[] = [];
  for (const k of WARE_KINDS) {
    for (let i = 0; i < (table[k] ?? 0); i++) out.push(k);
  }
  return out;
}

/** この階に立つ商人の種類（章ボスの階は章の市） */
export function merchantKindFor(depth: number): MerchantKind {
  return isChapterBossDepth(depth) ? "chapterMarket" : "market";
}

/** 部屋の床タイル（塊はその所属タイル、矩形は外周 1 マスを除いた内側） */
function roomTileList(state: GameState, room: RoomState): number[] {
  if (room.tiles) return [...room.tiles];
  const out: number[] = [];
  const r = room.rect;
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) out.push(toIndex(state.map, x, y));
  }
  return out;
}

/** 距離場を流す起点: 部屋の中心のタイル（壁なら部屋の最初の床タイル） */
function roomGoalTile(state: GameState, room: RoomState): number | null {
  const center = tileOf(state.map, rectCenterPx(room.rect));
  if (state.map.tiles[center] !== Tile.Wall) return center;
  return roomTileList(state, room).find((t) => state.map.tiles[t] !== Tile.Wall) ?? null;
}

/**
 * 前室の候補: 開始・最後を除く通常の部屋を、最後の部屋からの歩数（部屋の床で最も近いタイル）の近い順に。
 * 届かない部屋は除く。同じ歩数は部屋の番号順（乱数を使わない）
 */
export function frontRoomOrder(state: GameState): number[] {
  const last = state.rooms.length - 1;
  const lastRoom = state.rooms[last];
  if (last <= START_ROOM || !lastRoom) return [];
  const goal = roomGoalTile(state, lastRoom);
  if (goal === null) return [];
  const field = distanceField(state.map, goal);
  const ranked: { index: number; steps: number }[] = [];
  state.rooms.forEach((room, index) => {
    if (index === START_ROOM || index === last || room.kind !== "normal") return;
    let steps = Number.POSITIVE_INFINITY;
    for (const t of roomTileList(state, room)) {
      const d = field[t] ?? UNREACHABLE;
      if (d !== UNREACHABLE && d < steps) steps = d;
    }
    if (Number.isFinite(steps)) ranked.push({ index, steps });
  });
  ranked.sort((a, b) => a.steps - b.steps || a.index - b.index);
  return ranked.map((r) => r.index);
}

type StallSpots = { stand: Vec; offers: Vec[] };

/** 前室の近い順に、上 → 下の順で置けるところ。取れなければ開始部屋の契約者の反対側 */
function findStall(state: GameState, n: number): StallSpots | null {
  const spacing = ECONOMY.market.offerSpacing;
  for (const index of frontRoomOrder(state)) {
    const room = state.rooms[index];
    if (!room) continue;
    const spots = layout(state, room, n, DIR_UP, spacing) ?? layout(state, room, n, DIR_DOWN, spacing);
    if (spots) return spots;
  }
  const start = state.rooms[START_ROOM];
  if (!start) return null;
  const who = state.contracts.contractor;
  // 契約者が中心より上に立っていれば下へ（台座が重ならないように）
  const dir = who && who.pos.y < rectCenterPx(start.rect).y ? DIR_DOWN : who ? DIR_UP : DIR_DOWN;
  return layout(state, start, n, dir, spacing);
}

/**
 * この階の商人を立たせる（buildFloor の最後。乱数は商人の生成と品の値段だけで、それより前の抽選を動かさない）。
 * 試し場（sandbox）には立たない
 */
export function placeMerchants(state: GameState): void {
  state.economy.merchants = [];
  if (state.sandbox === true) return;
  const kind = merchantKindFor(state.depth);
  const plan = stockPlan(kind);
  if (plan.length === 0) return;
  const spots = findStall(state, plan.length);
  if (!spots) return;
  const body = createEnemy(state, enemyDef(MERCHANT_KEY), spots.stand, ROAMING_ROOM, false);
  state.enemies.push(body);
  const wares: Ware[] = plan.map((k, i) => {
    const base = rollBasePrice(state, k);
    return { kind: k, key: "", price: base, base, pos: spots.offers[i] ?? spots.stand, used: false, armed: false };
  });
  state.economy.merchants.push({ enemyId: body.id, kind, pos: { ...spots.stand }, wares, greeted: false, provoked: false, rerolls: 0 });
  repriceAll(state);
}

// -----------------------------------------------------------------------------
// 毎ステップ（floor.ts の updateRooms から）
// -----------------------------------------------------------------------------

/** 商人の生死・一言・台座、床の瓶 */
export function updateMerchants(state: GameState): void {
  settleFallen(state);
  for (const m of state.economy.merchants) {
    greet(state, m);
    updateWares(state, m);
  }
  updateFlaskPickups(state);
}

/**
 * 体が倒れた（消えた）商人を外す。怒らせて倒したなら残りの品を床へ落とし、無法者になる。
 * 怒っていない商人の体が消えた（敵の爆発に巻き込まれた・消滅した）ときは品ごと去る（襲っていないので無法者にしない）
 */
function settleFallen(state: GameState): void {
  const eco = state.economy;
  const fallen = eco.merchants.filter((m) => !state.enemies.some((e) => e.id === m.enemyId && e.hp > 0));
  if (fallen.length === 0) return;
  eco.merchants = eco.merchants.filter((m) => !fallen.includes(m));
  for (const m of fallen) {
    if (!m.provoked) continue;
    spillWares(state, m);
    becomeOutlaw(state, m.pos);
  }
}

/** 売れ残りの品を床へ（瓶 → 床の瓶、遺物 → 床の遺物、刻印符 → 床の刻印符、鍵 → 床の鍵。仕入れ直しは落ちない） */
function spillWares(state: GameState, m: Merchant): void {
  for (const w of m.wares) {
    if (w.used) continue;
    w.used = true;
    switch (w.kind) {
      case "flask":
        dropFlask(state, w.pos);
        break;
      case "item":
        dropItem(state, w.pos, ECONOMY.market.itemBoost);
        break;
      case "rune":
        dropRune(state, w.pos);
        break;
      case "key":
        dropKey(state, w.pos);
        break;
      case "reroll":
        break;
    }
  }
}

function becomeOutlaw(state: GameState, pos: Vec): void {
  const eco = state.economy;
  if (eco.outlaw) return;
  eco.outlaw = true;
  repriceAll(state);
  addFloatingText(state, { x: pos.x, y: pos.y - TEXT_LIFT }, OUTLAW_TEXT, ECONOMY.market.color, TEXT_SCALE, TEXT_LIFE * 2);
  pushLog(state, `${OUTLAW_TEXT}: このランの値段は ${ECONOMY.market.outlawPriceMul} 倍`, ECONOMY.market.color);
}

function greet(state: GameState, m: Merchant): void {
  if (m.greeted || m.provoked) return;
  const p = state.player.body.pos;
  if (Math.hypot(p.x - m.pos.x, p.y - m.pos.y) > ECONOMY.market.greetRange) return;
  m.greeted = true;
  const line = GREETING[m.kind];
  addFloatingText(state, { x: m.pos.x, y: m.pos.y - TEXT_LIFT }, line, ECONOMY.market.color, TEXT_SCALE, TEXT_LIFE * 2);
  pushLog(state, `${MERCHANT_LABEL[m.kind]}の商人「${line}」`, ECONOMY.market.color);
}

/** 台座に触れて買う（離れると armed に戻る。触れっぱなしでは 1 回だけ） */
function updateWares(state: GameState, m: Merchant): void {
  const body = state.player.body;
  for (const w of m.wares) {
    if (w.used) continue;
    const touching = circlesOverlap(w.pos.x, w.pos.y, WARE_TOUCH_RADIUS, body.pos.x, body.pos.y, body.radius);
    if (!touching) {
      w.armed = true;
      continue;
    }
    if (!w.armed) continue;
    w.armed = false;
    buyWare(state, m, w);
  }
}

/** 買えない理由（買えるなら null） */
function wareBlocked(state: GameState, m: Merchant, w: Ware): string | null {
  if (m.provoked) return REFUSED_TEXT;
  if (w.kind === "flask" && state.player.flasks >= Math.floor(state.stats.flaskMax)) return FLASK_FULL_TEXT;
  if (state.economy.coins < w.price) return `銭が足りない（${w.price}）`;
  return null;
}

/** 払えない・持てないときは何も起きない（台座は残る） */
export function buyWare(state: GameState, m: Merchant, w: Ware): boolean {
  const blocked = wareBlocked(state, m, w);
  if (blocked) {
    sayAtPlayer(state, blocked);
    return false;
  }
  if (!spendCoins(state, w.price, w.kind)) return false;
  applyWare(state, m, w);
  if (w.kind === "reroll") {
    m.rerolls += 1;
  } else {
    w.used = true;
    const eco = state.economy;
    eco.bought[w.kind] = (eco.bought[w.kind] ?? 0) + 1;
  }
  repriceAll(state);
  spawnBurst(state, w.pos, ECONOMY.market.color, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  pushSfx(state, "pedestalUse");
  return true;
}

function applyWare(state: GameState, m: Merchant, w: Ware): void {
  const below = { x: w.pos.x, y: w.pos.y + TILE_SIZE };
  switch (w.kind) {
    case "flask":
      gainFlasks(state, 1);
      sayAtPlayer(state, FLASK_GAIN_TEXT, ECONOMY.flask.color);
      return;
    case "item":
      dropItem(state, below, ECONOMY.market.itemBoost);
      return;
    case "rune":
      dropRune(state, below);
      return;
    case "key":
      gainKey(state);
      return;
    case "reroll":
      restock(state, m);
      return;
  }
}

/** 仕入れ直し: 売れた品を並べ直し、仕入れ直し以外の値段を引き直す（rng は品の数だけ） */
function restock(state: GameState, m: Merchant): void {
  for (const w of m.wares) {
    if (w.kind === "reroll") continue;
    w.used = false;
    w.armed = false;
    w.base = rollBasePrice(state, w.kind);
  }
}

function sayAtPlayer(state: GameState, text: string, color: string = ECONOMY.market.color): void {
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - TEXT_LIFT }, text, color, TEXT_SCALE, TEXT_LIFE);
}

// -----------------------------------------------------------------------------
// 床の瓶（倒れた商人の売れ残り）
// -----------------------------------------------------------------------------

/** 床に瓶を 1 つ置く（消えない。触れて拾う） */
export function dropFlask(state: GameState, pos: Vec): void {
  state.pickups.push({ id: allocId(state), kind: "flask", pos: { ...pos }, radius: ECONOMY.coin.radius, bobTime: 0 });
}

/** 床の瓶に触れたら 1 本足す。持ちきれなければ床に残す */
function updateFlaskPickups(state: GameState): void {
  const b = state.player.body;
  let removed = false;
  for (const pk of state.pickups) {
    if (pk.kind !== "flask") continue;
    if (!circlesOverlap(pk.pos.x, pk.pos.y, pk.radius, b.pos.x, b.pos.y, b.radius)) continue;
    if (gainFlasks(state, 1) <= 0) continue;
    sayAtPlayer(state, FLASK_GAIN_TEXT, ECONOMY.flask.color);
    pushSfx(state, "pickup");
    pk.radius = 0;
    removed = true;
  }
  if (removed) state.pickups = state.pickups.filter((pk) => pk.radius > 0);
}
