import { type GameState, pushSfx } from "../core/state";
import type { StatusApply, StatusKind, StatusSource } from "../core/status";
import { RELIC } from "../data/tuning";
import { DICE_TALLY, DRAGON_SCALE_TALLY, STRIDE_TALLY, relicTallyKey } from "../loot/named";
import { SLOTS } from "../loot/types";
import { slashBase } from "./boonRules";
import { addFloatingText } from "./effects";
import { spendCoins } from "./economy";
import { consumeCorpse, nearestCorpse } from "./enemyTraits";
import { equipmentSealed } from "./runSetup";
import { type StatusTarget, explodeAt } from "./statusEffects";

/**
 * 名のある遺物の engine の分岐（docs/ideas/relics-7d-plan.md 3 章）。Rule / Modifier / apply で書けない固有だけをここに集め、
 * 共有ファイル（combat.ts / player.ts / moments.ts / floor.ts / statusEffects.ts / telegraphLineUi.ts）は 1 行の呼び出しだけにする。
 * 装備しているかは state.profile.equipment の namedKey で見る（ラン中は装備を替えられるので毎回引く）
 */

const TWIN_SERPENT = "twinSerpent";
const REVERSE_HOURGLASS = "reverseHourglass";
const EMPTY_SCABBARD = "emptyScabbard";
const LAYERED_NECKLACE = "layeredNecklace";
const STAR_READER = "starReader";
const SIX_COINS = "sixCoins";
const GREED_HIDE = "greedHide";
const JIZO = "jizo";
const DICE_RING = "diceRing";
const WANDER_SHOES = "wanderShoes";
const BONE_CROWN = "boneCrown";

/** 六文銭の「ランで 1 回」の数え */
const SIX_COINS_TALLY = relicTallyKey(SIX_COINS);
/** 重ねの首飾りが重ねを増やす状態異常（重ねで強くなる継続ダメージだけ。冷気・感電は重ねで凍結・麻痺に化けるので外す） */
const LAYERED_KINDS: ReadonlySet<StatusKind> = new Set<StatusKind>(["burn", "poison", "bleed"]);
const REVIVE_TEXT = "蘇生";
const REVIVE_COLOR = "#ffd75f";
const REVIVE_TEXT_SCALE = 1.4;
const REVIVE_SFX = "fountainHeal";
/** 生命の最低（蘇りで 0 のまま起きない） */
const MIN_HP = 1;

/**
 * この名のある遺物を装備しているか。起点「素手」で装備が封印されている間は持っていない扱い
 * （stats 側は applyRunStats が空の装備で畳むので、engine の分岐もそろえる。共鳴の数えと同じ）
 */
export function hasNamedRelic(state: Readonly<Pick<GameState, "profile" | "origin" | "depth">>, key: string): boolean {
  if (equipmentSealed(state)) return false;
  const eq = state.profile.equipment;
  return SLOTS.some((slot) => eq[slot]?.namedKey === key);
}

function tallyOf(state: GameState, key: string): number {
  return state.boonRun.tallies[key] ?? 0;
}

// -----------------------------------------------------------------------------
// 双頭の蛇（system/moments.ts の noteTwinStrike）
// -----------------------------------------------------------------------------

/** 左右を交互にできなかった命中: 双頭の蛇の積もった倍を 0 に戻す */
export function breakTwinSerpent(state: GameState): void {
  if (!hasNamedRelic(state, TWIN_SERPENT)) return;
  state.boonRun.tallies[relicTallyKey(TWIN_SERPENT)] = 0;
}

// -----------------------------------------------------------------------------
// 逆さ砂時計・欲の皮・身代わり地蔵・六文銭（system/combat.ts）
// -----------------------------------------------------------------------------

/** 逆さ砂時計: 受けた傷を遅らせる秒。装備していなければ undefined */
export function relicDeferDelay(state: GameState): number | undefined {
  return hasNamedRelic(state, REVERSE_HOURGLASS) ? RELIC.reverseHourglass.delay : undefined;
}

/** 逆さ砂時計: 撃破で、遅れて来る傷の古い 1 つを帳消しにする */
export function relicForgiveOnKill(state: GameState): void {
  if (!hasNamedRelic(state, REVERSE_HOURGLASS)) return;
  const list = state.player.deferredDamage;
  if (list === undefined || list.length === 0) return;
  // 積んだ順（due の早い順）なので先頭が一番古い
  state.player.deferredDamage = list.slice(1);
}

/** 欲の皮: 持ち金 every につき被ダメージ −perStep（cap まで）。被弾の倍に掛ける */
export function relicIncomingMul(state: GameState): number {
  if (!hasNamedRelic(state, GREED_HIDE)) return 1;
  const g = RELIC.greedHide;
  const cut = Math.min(g.cap, Math.floor(state.economy.coins / g.every) * g.perStep);
  return 1 - cut;
}

/**
 * 身代わり地蔵: 被弾の share を銭で受ける（銭 1 で生命 hpPerCoin）。払えない分は生命。生命で受ける量を返す。
 * 払いは spendCoins（onCoinSpend が出る。喜捨などの「払ったとき」が乗る）
 */
export function relicPayWithCoins(state: GameState, taken: number): number {
  if (taken <= 0 || !hasNamedRelic(state, JIZO)) return taken;
  const j = RELIC.jizo;
  const wanted = Math.ceil((taken * j.share) / j.hpPerCoin);
  const paid = Math.min(wanted, state.economy.coins);
  if (paid <= 0 || !spendCoins(state, paid, "rule")) return taken;
  return Math.max(0, taken - Math.min(taken, paid * j.hpPerCoin));
}

/** 六文銭: 倒れる直前に持ち金を全部払って 1 回だけ蘇る（ランで 1 回・持ち金 minCoins 以上）。蘇ったら true */
export function relicRevive(state: GameState): boolean {
  if (!hasNamedRelic(state, SIX_COINS) || tallyOf(state, SIX_COINS_TALLY) > 0) return false;
  const coins = state.economy.coins;
  if (coins < RELIC.sixCoins.minCoins || !spendCoins(state, coins, "rule")) return false;
  state.boonRun.tallies[SIX_COINS_TALLY] = 1;
  const p = state.player;
  p.hp = Math.max(MIN_HP, Math.round(p.maxHp * RELIC.sixCoins.hpRatio));
  // 遅れて来る傷が残っていると蘇った直後にまた倒れるので捨てる
  p.deferredDamage = [];
  addFloatingText(state, p.body.pos, REVIVE_TEXT, REVIVE_COLOR, REVIVE_TEXT_SCALE, undefined, "notice");
  pushSfx(state, REVIVE_SFX);
  return true;
}

// -----------------------------------------------------------------------------
// 空の鞘・旅人の靴・骸の冠（system/player.ts）
// -----------------------------------------------------------------------------

/** 空の鞘: 左右の振り（派生・溜めを含む）を出さない。ダッシュ攻撃は出す */
export function relicBlocksSwing(state: GameState, dashStrike: boolean): boolean {
  return !dashStrike && hasNamedRelic(state, EMPTY_SCABBARD);
}

/** 旅人の靴: 歩いた距離を数えに溜める（ダッシュ・止まっている間は溜めない。上限 cap） */
export function relicStride(state: GameState, dt: number): void {
  if (!hasNamedRelic(state, WANDER_SHOES)) return;
  const p = state.player;
  if (p.dashTimer > 0) return;
  const moved = Math.hypot(p.body.vel.x, p.body.vel.y) * dt;
  if (moved <= 0) return;
  const tallies = state.boonRun.tallies;
  tallies[STRIDE_TALLY] = Math.min(RELIC.wanderShoes.cap, (tallies[STRIDE_TALLY] ?? 0) + moved);
}

/** 毎ステップ: 骸の冠（踏んだ死骸を爆ぜさせる。自分は傷つかない） */
export function tickNamedRelics(state: GameState): void {
  if (!hasNamedRelic(state, BONE_CROWN)) return;
  const b = RELIC.boneCrown;
  const corpse = nearestCorpse(state, state.player.body.pos, b.reach);
  if (corpse === undefined) return;
  consumeCorpse(state, corpse);
  explodeAt(state, corpse.pos, b.radius, slashBase(state) * b.mul);
}

// -----------------------------------------------------------------------------
// 賽の目の指輪・起死の鱗（system/floor.ts の buildFloor の末尾）
// -----------------------------------------------------------------------------

/** 階の到着: 起死の鱗の 1 階 1 回を戻し、賽の目の指輪を装備していれば目を振る（装備していなければ乱数を引かない） */
export function onRelicFloorStart(state: GameState): void {
  const tallies = state.boonRun.tallies;
  if (tallies[DRAGON_SCALE_TALLY] !== undefined) tallies[DRAGON_SCALE_TALLY] = 0;
  if (!hasNamedRelic(state, DICE_RING)) return;
  tallies[DICE_TALLY] = state.rng.int(1, RELIC.diceRing.faces);
}

// -----------------------------------------------------------------------------
// 重ねの首飾り（system/statusEffects.ts の applyStatus）
// -----------------------------------------------------------------------------

/** 重ねの首飾り: 自分が敵に付ける燃焼・毒・出血を 1 回で stacks 重ねにする（確率を下げるのは UniqueDef.apply） */
export function relicStatusApply(state: GameState, target: StatusTarget, apply: Readonly<StatusApply>, source: StatusSource): Readonly<StatusApply> {
  if (source !== "player" || target.kind !== "enemy" || !LAYERED_KINDS.has(apply.kind)) return apply;
  if (!hasNamedRelic(state, LAYERED_NECKLACE)) return apply;
  const stacks = RELIC.layeredNecklace.stacks;
  return apply.stacks >= stacks ? apply : { ...apply, stacks };
}

// -----------------------------------------------------------------------------
// 星読みの眼（render/telegraphLineUi.ts。読むだけ）
// -----------------------------------------------------------------------------

/** 星読みの眼: 予告の線に描く残り秒の目盛りの長さ。装備していなければ 0（目盛りを描かない） */
export function relicTelegraphLeadSec(state: Readonly<GameState>): number {
  return hasNamedRelic(state, STAR_READER) ? RELIC.starReader.leadSec : 0;
}
