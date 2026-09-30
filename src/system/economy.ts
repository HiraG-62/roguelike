import { pushEvent, playerSource } from "../core/events";
import type { RuleEffectKind } from "../core/rules";
import { rollSpread } from "../core/scale";
import {
  type CoinSource,
  type EconomyState,
  type Enemy,
  type GameState,
  type Jin,
  type Pickup,
  type RoomKind,
  type RoomState,
  type SpendKind,
  allocId,
  pushSfx,
} from "../core/state";
import type { Rng } from "../core/rng";
import { type Vec, dist, fromAngle, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { gradeOf } from "../data/enemyRoles";
import { ECONOMY } from "../data/tuning";
import { chapterOf } from "./chapters";
import { addFloatingText } from "./effects";
import { circlesOverlap, overlapsWall } from "./physics";

/**
 * 銭と鍵（ラン内の通貨。docs/ideas/economy-impl.md 2-2・2-10）。
 * - 撃破で床に落ち（消える・引き寄せられる）、陣・部屋・階・賞金首・決闘では直接入る
 * - 被弾で持ち金の一部がこぼれ、拾い直しは稼ぎに数えない
 * - 額の揺らぎは state.rng（撃破・陣・部屋の制圧だけ。階・賞金首・決闘は固定額 × 章の倍率）
 * 描画は render/coinUi.ts（床の実体）と render/runUi.ts（持ち金）
 */

export const COIN_SOURCES: readonly CoinSource[] = ["kill", "jin", "room", "floor", "event", "contract", "container", "bet", "sell", "rule", "spill"];
export const SPEND_KINDS: readonly SpendKind[] = ["flask", "item", "rune", "key", "reroll", "contract", "bet", "donation", "toll", "rule"];

/** 稼ぎの倍率（coinGainMul）を掛けない源。拾い直しは元の額、賭けは張った額の払い戻し */
const UNSCALED_SOURCES: ReadonlySet<CoinSource> = new Set<CoinSource>(["spill", "bet"]);

const TEXT_LIFT = 10;
const TEXT_SCALE = 1;
const TEXT_LIFE = 0.7;
/** 撃破の銭を散らす向き。id ごとに黄金角ずつ回す（乱数を使わず、並んで落ちても重ならない） */
const GOLDEN_ANGLE = 2.399963229728653;
/** これより遅くなった散りは止める（px/秒） */
const MIN_SPEED = 1;

export function createEconomyState(): EconomyState {
  return {
    coins: 0,
    keys: 0,
    earned: zeroRecord(COIN_SOURCES),
    spent: zeroRecord(SPEND_KINDS),
    spilled: 0,
    recovered: 0,
    dropped: 0,
    expired: 0,
  };
}

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  return out;
}

/** このランで稼いだ総額（拾い直しを除く） */
export function totalEarned(eco: Readonly<EconomyState>): number {
  return COIN_SOURCES.reduce((sum, k) => sum + eco.earned[k], 0);
}

/** このランで使った総額 */
export function totalSpent(eco: Readonly<EconomyState>): number {
  return SPEND_KINDS.reduce((sum, k) => sum + eco.spent[k], 0);
}

/** 章の倍率（稼ぎと値段の平均に掛ける）。章 n は chapterMul^(n−1) */
export function chapterScale(depth: number): number {
  return ECONOMY.chapterMul ** (chapterOf(depth) - 1);
}

// -----------------------------------------------------------------------------
// 得る・払う
// -----------------------------------------------------------------------------

/**
 * 銭を得る。spill（こぼれた銭の拾い直し）以外は earned に積み、coinGainMul を掛ける（spill・bet は掛けない）。
 * 浮き文字「銭 +n」と onCoinPickup を出す。実際に得た額を返す
 */
export function gainCoins(state: GameState, amount: number, source: CoinSource): number {
  const mul = UNSCALED_SOURCES.has(source) ? 1 : Math.max(0, state.stats.coinGainMul);
  const n = Math.round(amount * mul);
  if (n <= 0) return 0;
  const eco = state.economy;
  eco.coins += n;
  if (source !== "spill") eco.earned[source] += n;
  sayAtPlayer(state, `銭 +${n}`, ECONOMY.coin.color);
  pushSfx(state, "pickup");
  pushEvent(state, { kind: "onCoinPickup", actor: "player", pos: { ...state.player.body.pos }, source: playerSource("coin"), amount: n, tag: source });
  return n;
}

/** 銭を払う。足りなければ何もせず false。0 以下の額は払ったことにして true（集計もイベントも出さない） */
export function spendCoins(state: GameState, amount: number, kind: SpendKind): boolean {
  const n = Math.round(amount);
  if (n <= 0) return true;
  const eco = state.economy;
  if (eco.coins < n) return false;
  eco.coins -= n;
  eco.spent[kind] += n;
  pushEvent(state, { kind: "onCoinSpend", actor: "player", pos: { ...state.player.body.pos }, source: playerSource("coin"), amount: n, tag: kind });
  return true;
}

/** 鍵を 1 本得る */
export function gainKey(state: GameState): void {
  state.economy.keys += 1;
  sayAtPlayer(state, "鍵", ECONOMY.key.color);
  pushSfx(state, "pickup");
}

function sayAtPlayer(state: GameState, text: string, color: string): void {
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - TEXT_LIFT }, text, color, TEXT_SCALE, TEXT_LIFE);
}

/** 平均 mean を揺らぎの範囲で引き、小数部を確率で切り上げた整数（rng 2 回。mean が 0 以下なら引かない） */
function rollAmount(rng: Rng, mean: number): number {
  if (mean <= 0) return 0;
  return stochasticRound(rng, rollSpread(rng, mean, ECONOMY.income.spread));
}

function stochasticRound(rng: Rng, x: number): number {
  const base = Math.floor(x);
  return base + (rng.next() < x - base ? 1 : 0);
}

// -----------------------------------------------------------------------------
// 源（撃破・陣・部屋・階・賞金首・決闘）
// -----------------------------------------------------------------------------

type KillTier = keyof typeof ECONOMY.income.kill;

/** 撃破の銭の格: ボス → 階の主・部屋主 → 陣の大将 → 精鋭 / 猛 / 並 */
function killTier(state: GameState, enemy: Enemy, def: EnemyDef): KillTier {
  if (def.boss === true) return "boss";
  if (state.boss?.enemyId === enemy.id) return state.boss.major ? "boss" : "lord";
  if (def.lairMaster === true) return "lord";
  if (isJinLeader(state, enemy)) return "leader";
  const grade = gradeOf(enemy);
  return grade === "elite" ? "elite" : grade === "strong" ? "strong" : "normal";
}

function isJinLeader(state: GameState, enemy: Enemy): boolean {
  if (enemy.jinId === undefined) return false;
  return state.jins.some((j) => j.id === enemy.jinId && j.leaderId === enemy.id);
}

/** 割って散らす格（見た目。額の合計は同じ） */
const SPLIT_TIERS: ReadonlySet<KillTier> = new Set<KillTier>(["boss", "lord", "leader"]);

/** 撃破の銭の平均（章の倍率込み） */
export function killCoinMean(state: GameState, enemy: Enemy): number {
  const def = enemyDef(enemy.defKey);
  const tier = killTier(state, enemy, def);
  const swarm = def.swarm !== undefined ? ECONOMY.income.swarmMul : 1;
  const rout = enemy.rout !== undefined ? ECONOMY.income.routMul : 1;
  return ECONOMY.income.kill[tier] * swarm * rout * chapterScale(state.depth);
}

/**
 * 撃破で銭を落とす（combat.ts の killEnemy から）。1 体につき実体 1 つ（ボス・主・大将は splitPieces に割る）。
 * 鐘の蘇生体・拠点・消えた敵は落とさない
 */
export function dropCoins(state: GameState, enemy: Enemy): void {
  if (state.sandbox === true || enemy.revived === true || enemy.vanished === true) return;
  const def = enemyDef(enemy.defKey);
  const value = rollAmount(state.rng, killCoinMean(state, enemy));
  if (value <= 0) return;
  state.economy.dropped += value;
  const pieces = SPLIT_TIERS.has(killTier(state, enemy, def)) ? Math.min(value, ECONOMY.coin.splitPieces) : 1;
  const each = Math.floor(value / pieces);
  for (let i = 0; i < pieces; i++) {
    // 端数は最初の 1 つに寄せる（合計を value に保つ）
    const v = i === 0 ? value - each * (pieces - 1) : each;
    placeCoin(state, enemy.body.pos, v, ECONOMY.coin.scatterSpeed);
  }
}

/** 床に銭を 1 つ置く。実体が上限なら最も新しい銭に額を足す（乱数不要・決定的） */
function placeCoin(state: GameState, pos: Vec, value: number, travel: number): void {
  const coins = state.pickups.filter((pk) => pk.kind === "coin" && pk.spilled !== true);
  const newest = coins[coins.length - 1];
  if (newest !== undefined && countCoins(state) >= ECONOMY.coin.maxCoins) {
    newest.value = (newest.value ?? 0) + value;
    return;
  }
  const id = allocId(state);
  const dir = fromAngle(id * GOLDEN_ANGLE);
  state.pickups.push({
    id,
    kind: "coin",
    pos: { ...pos },
    radius: ECONOMY.coin.radius,
    bobTime: 0,
    value,
    life: ECONOMY.coin.life,
    vel: scale(dir, travel * ECONOMY.coin.friction),
  });
}

function countCoins(state: GameState): number {
  let n = 0;
  for (const pk of state.pickups) if (pk.kind === "coin") n++;
  return n;
}

/**
 * 陣の決着（jin.ts の settleJin から。交戦した陣だけ）: 銭（起床から被弾なしなら ×jinUnscathedMul）と、確率で鍵。
 * 乱数は銭 2 回 → 鍵 1 回の順
 */
export function onJinSettled(state: GameState, jin: Jin): void {
  if (state.sandbox === true) return;
  const unscathed = !hurtSince(state, jin.engagedAt ?? 0);
  const mean = ECONOMY.income.jin * chapterScale(state.depth) * (unscathed ? ECONOMY.income.jinUnscathedMul : 1);
  gainCoins(state, rollAmount(state.rng, mean), "jin");
  const keyChance = jin.leaderId !== null ? ECONOMY.key.leaderJinChance : ECONOMY.key.jinChance;
  if (state.rng.chance(keyChance)) dropKey(state, state.player.body.pos);
}

/** since（state.time）以降に被弾したか */
function hurtSince(state: GameState, since: number): boolean {
  const hurt = state.recent.onHurt;
  return hurt !== undefined && hurt.lastTime >= since;
}

/** 床に鍵を置く（消えない。引き寄せあり） */
export function dropKey(state: GameState, pos: Vec): void {
  state.pickups.push({ id: allocId(state), kind: "key", pos: { ...pos }, radius: ECONOMY.coin.radius, bobTime: 0 });
}

/**
 * 部屋の制圧（floor.ts の clearRoom から）: 陣を持たない部屋（闘技場・巣窟・試練…）は陣の決着と同じ額、
 * 加えて部屋の種類の上乗せ（陣を持つ部屋でも出る）。額が 0 なら乱数を引かない
 */
export function onRoomClearedCoins(state: GameState, room: RoomState, index: number): void {
  if (state.sandbox === true) return;
  const hasJin = state.jins.some((j) => j.roomIndex === index);
  const bonusTable: Readonly<Partial<Record<RoomKind, number>>> = ECONOMY.income.roomBonus;
  const base = (hasJin ? 0 : ECONOMY.income.jin) + (bonusTable[room.kind] ?? 0);
  gainCoins(state, rollAmount(state.rng, base * chapterScale(state.depth)), "room");
}

/** 初めて着いた階の銭（floor.ts の descend から） */
export function grantFloorArrival(state: GameState): void {
  gainCoins(state, fixedAmount(state, ECONOMY.income.floor), "floor");
}

/** 賞金首・決闘など出来事の報酬（固定額 × 章の倍率） */
export function grantEventCoins(state: GameState, base: number): void {
  gainCoins(state, fixedAmount(state, base), "event");
}

function fixedAmount(state: GameState, base: number): number {
  return Math.round(base * chapterScale(state.depth));
}

// -----------------------------------------------------------------------------
// こぼれる・撒く
// -----------------------------------------------------------------------------

/**
 * 被弾で持ち金の一部がこぼれる（combat.ts の damagePlayer から。継続ダメージ・受け流し・見切りでは呼ばない）。
 * 攻撃の来た向きの反対へ最大 spill.pieces 個に割って飛ばし、settle 秒は拾えない。乱数は使わない
 */
export function spillCoins(state: GameState, fromPos: Vec): void {
  const eco = state.economy;
  const mul = Math.max(0, state.stats.coinSpillMul);
  if (eco.coins <= 0 || mul <= 0) return;
  const amount = Math.min(eco.coins, Math.max(ECONOMY.spill.min, Math.round(eco.coins * ECONOMY.spill.ratio * mul)));
  const p = state.player.body.pos;
  scatterOwnCoins(state, p, normalize(sub(p, fromPos)), amount);
  pushEvent(state, { kind: "onCoinSpill", actor: "enemy", pos: { ...p }, source: playerSource("coin"), amount });
}

/** 持ち金の amount を pos から dir の向きへ扇に撒く（拾い直しは稼ぎに数えない） */
function scatterOwnCoins(state: GameState, pos: Vec, dir: Vec, amount: number): void {
  const eco = state.economy;
  eco.coins -= amount;
  eco.spilled += amount;
  const s = ECONOMY.spill;
  const pieces = Math.max(1, Math.min(s.pieces, amount));
  const each = Math.floor(amount / pieces);
  const base = Math.atan2(dir.y, dir.x);
  for (let i = 0; i < pieces; i++) {
    const offset = i - (pieces - 1) / 2;
    // 飛ぶ距離は割った順に min → max へ（乱数を使わずばらつかせる）
    const travel = pieces === 1 ? s.scatterMin : s.scatterMin + ((s.scatterMax - s.scatterMin) * i) / (pieces - 1);
    const value = i === 0 ? amount - each * (pieces - 1) : each;
    state.pickups.push({
      id: allocId(state),
      kind: "coin",
      pos: { ...pos },
      radius: ECONOMY.coin.radius,
      bobTime: 0,
      value,
      life: s.life,
      spilled: true,
      settle: s.settle,
      vel: scale(fromAngle(base + offset * s.spreadAngle), travel * ECONOMY.coin.friction),
    });
  }
}

/** 統一ルールの銭の効果（system/rules.ts から）。magnitude は gain / spend は額、scatter は持ち金の割合 */
export function applyCoinRuleEffect(state: GameState, kind: Extract<RuleEffectKind, "gainCoins" | "spendCoins" | "scatterCoins">, magnitude: number, pos: Vec): void {
  switch (kind) {
    case "gainCoins":
      gainCoins(state, magnitude, "rule");
      return;
    case "spendCoins":
      spendCoins(state, magnitude, "rule");
      return;
    case "scatterCoins": {
      const amount = Math.floor(state.economy.coins * Math.max(0, Math.min(1, magnitude)));
      if (amount <= 0) return;
      scatterOwnCoins(state, pos, normalize(sub(pos, state.player.body.pos)), amount);
      return;
    }
  }
}

// -----------------------------------------------------------------------------
// 床の銭・鍵（毎ステップ。floor.ts の updatePickups から）
// -----------------------------------------------------------------------------

/**
 * 銭・鍵の実体を進める: 散る → 寿命 → 引き寄せ → 拾う。拾った・消えたものは取り除く。
 * ハート・瓶は触らない（ハートは floor.ts、瓶は段取り 6b）
 */
export function updateCoinPickups(state: GameState, dt: number): void {
  let removed = false;
  for (const pk of state.pickups) {
    if (pk.kind !== "coin" && pk.kind !== "key") continue;
    if (stepFieldPickup(state, pk, dt)) {
      pk.radius = 0;
      removed = true;
    }
  }
  if (removed) state.pickups = state.pickups.filter((pk) => pk.radius > 0);
}

/** 1 つ進める。取り除くなら true */
function stepFieldPickup(state: GameState, pk: Pickup, dt: number): boolean {
  pk.bobTime += dt;
  drift(state, pk, dt);
  if (pk.life !== undefined) {
    pk.life -= dt;
    if (pk.life <= 0) {
      if (pk.kind === "coin" && pk.spilled !== true) state.economy.expired += pk.value ?? 0;
      return true;
    }
  }
  if (pk.settle !== undefined && pk.settle > 0) {
    pk.settle -= dt;
    return false;
  }
  magnetize(state, pk, dt);
  const b = state.player.body;
  if (!circlesOverlap(pk.pos.x, pk.pos.y, pk.radius, b.pos.x, b.pos.y, b.radius)) return false;
  collect(state, pk);
  return true;
}

/** 散る初速で動き、減衰する。壁に当たったらそこで止まる */
function drift(state: GameState, pk: Pickup, dt: number): void {
  const v = pk.vel;
  if (v === undefined) return;
  const nx = pk.pos.x + v.x * dt;
  const ny = pk.pos.y + v.y * dt;
  if (overlapsWall(state, nx, ny, pk.radius)) {
    pk.vel = undefined;
    return;
  }
  pk.pos.x = nx;
  pk.pos.y = ny;
  const decay = Math.exp(-ECONOMY.coin.friction * dt);
  v.x *= decay;
  v.y *= decay;
  if (Math.hypot(v.x, v.y) < MIN_SPEED) pk.vel = undefined;
}

/** プレイヤーから magnetRadius（× coinMagnetMul。プレイヤーの半径の外側）以内なら寄る */
function magnetize(state: GameState, pk: Pickup, dt: number): void {
  const b = state.player.body;
  const reach = b.radius + ECONOMY.coin.magnetRadius * Math.max(0, state.stats.coinMagnetMul);
  const d = dist(pk.pos, b.pos);
  if (d > reach || d <= 0) return;
  const stepLen = Math.min(d, ECONOMY.coin.magnetSpeed * dt);
  const dir = normalize(sub(b.pos, pk.pos));
  pk.pos.x += dir.x * stepLen;
  pk.pos.y += dir.y * stepLen;
}

function collect(state: GameState, pk: Pickup): void {
  if (pk.kind === "key") {
    gainKey(state);
    return;
  }
  const value = pk.value ?? 0;
  if (pk.spilled === true) {
    state.economy.recovered += value;
    gainCoins(state, value, "spill");
    return;
  }
  gainCoins(state, value, "kill");
}
