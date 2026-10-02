import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng, type Rng } from "../core/rng";
import type { GameState, GameStatus } from "../core/state";
import { JOB_KEYS, JOBS, type JobKey } from "../data/jobs";
import { CARRY } from "../data/tuning";
import { MOVESET_KEYS, MOVESETS, type MovesetKey } from "../data/weapons";
import { BASES } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { UNIQUES } from "../loot/named";
import { equipItem } from "../loot/profile";
import { carryableSlots, makeRunProfile } from "../loot/runGear";
import { computeStats } from "../loot/stats";
import { createEmptyProfile, type Item, type Profile, type Slot, TRAIT_COLORS, type TraitColor } from "../loot/types";
import { killerOf } from "../system/deathCause";
import { chooseBud } from "../system/loot";
import { applyStats } from "../system/player";
import { defaultRunSetup } from "../system/runSetup";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { botInput, createBotState } from "./bot";
import { buildColoredItem, buildQaSkillProfile, rollUntilRarity } from "./qaLoadout";

/**
 * 装備パターンの行列（`npm run qa:gear`）。持ち込み・部位の選び方・装備の質・武器種・ジョブを 1 軸ずつ「標準」から変え、
 * 同じ seed の列で bot を走らせて差を見る（同じ seed を全パターンで使うので、差は対にして比べる）。
 * ゲームの持ち込みの決まり（右手 + CARRY.carrySlots 部位。loot/runGear.ts）に合わせ、ラン中に拾った遺物は bot が付ける。
 * ゲームのロジックは変えず、bot と集計の純関数だけを持つ。実行と書き出しは scripts/qa-gear.mjs
 */

// ---------------------------------------------------------------------------
// パターン
// ---------------------------------------------------------------------------

export const GEAR_GROUPS = ["standard", "carry", "slots", "quality", "weapon", "job"] as const;
export type GearGroup = (typeof GEAR_GROUPS)[number];

export const GEAR_GROUP_LABEL: Readonly<Record<GearGroup, string>> = {
  standard: "標準",
  carry: "持ち込みの量",
  slots: "持ち込む部位",
  quality: "持ち込む遺物の質",
  weapon: "武器種",
  job: "ジョブ",
};

/**
 * 持ち込む遺物の質。plain = 並（名のある遺物なし）/ plainHigh = 並で深い階の物 / rough = 荒 / inverted = 反転あり /
 * named = 名のある遺物 / mono・duo・scatter = 性質の色を 1 色・2 色・5 色に揃える（共鳴）
 */
export const GEAR_QUALITIES = ["plain", "plainHigh", "rough", "inverted", "named", "mono", "duo", "scatter"] as const;
export type GearQuality = (typeof GEAR_QUALITIES)[number];

const QUALITY_LABEL: Readonly<Record<GearQuality, string>> = {
  plain: "並",
  plainHigh: "並（深い階の物）",
  rough: "荒",
  inverted: "反転あり",
  named: "名のある遺物",
  mono: "1 色に揃える",
  duo: "2 色に揃える",
  scatter: "5 色に散らす",
};

export interface GearPattern {
  /** 一意の key（`--only` で指定する。例 weapon.spear） */
  key: string;
  group: GearGroup;
  label: string;
  /** 右手のベース。null = 右手も持ち込まない（素手） */
  weaponBase: string | null;
  /** 右手以外に持ち込む部位 */
  carry: readonly Slot[];
  quality: GearQuality;
  job: JobKey;
  /** ラン中に拾った遺物を bot が付けるか */
  pickup: boolean;
}

/** 標準の右手（小剣 = 剣）。gearPower.ts の連打計測と揃える */
export const STANDARD_WEAPON_BASE = "shortsword";
/**
 * 持ち込む遺物の itemLevel（= 拾った深度）。拠点の装備は「前のランで拾った物」なので、
 * フル QA の平均到達深度（5〜7）の手前の 5 を標準にする。深い階の物は plainHigh
 */
export const HOME_GEAR_LEVEL = 5;
export const HIGH_GEAR_LEVEL = 15;

/** 標準の持ち込み部位: ゲームの既定の印（loot/runGear.ts の defaultMarks。部位の並び順の先頭から枠の数） */
export function standardCarry(): Slot[] {
  return carryableSlots().slice(0, CARRY.carrySlots);
}

function standardPattern(): GearPattern {
  const carry = standardCarry();
  return {
    key: "standard",
    group: "standard",
    label: `標準（小剣 + ${carry.map((s) => SLOT_LABEL[s]).join("・")}・並・見習い）`,
    weaponBase: STANDARD_WEAPON_BASE,
    carry,
    quality: "plain",
    job: "none",
    pickup: true,
  };
}

/** 武器種ごとに最初に並ぶベース（BASES の並び。ベースが無い武器種は undefined） */
export function firstBaseOf(moveset: MovesetKey): string | undefined {
  return BASES.find((b) => b.slot === "mainHand" && b.moveset === moveset)?.key;
}

function baseName(key: string): string {
  return BASES.find((b) => b.key === key)?.name ?? key;
}

function slotPairs(slots: readonly Slot[]): Slot[][] {
  const out: Slot[][] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) out.push([slots[i]!, slots[j]!]);
  }
  return out;
}

function sameSlots(a: readonly Slot[], b: readonly Slot[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/** 全パターン（標準が先頭。各軸は標準と同じ組み合わせを除く） */
export function gearPatterns(): GearPattern[] {
  const std = standardPattern();
  const out: GearPattern[] = [std];
  const all = carryableSlots();

  out.push({ ...std, key: "carry.none", group: "carry", label: "何も持ち込まない（素手）", weaponBase: null, carry: [] });
  out.push({ ...std, key: "carry.weaponOnly", group: "carry", label: "右手だけ", carry: [] });
  out.push({ ...std, key: "carry.all", group: "carry", label: `全 ${all.length + 1} 部位（旧 QA の形）`, carry: all });
  out.push({ ...std, key: "carry.noPickup", group: "carry", label: "標準・拾った遺物を付けない", pickup: false });

  for (const pair of slotPairs(all)) {
    if (sameSlots(pair, std.carry)) continue;
    out.push({ ...std, key: `slots.${pair.join("+")}`, group: "slots", label: pair.map((s) => SLOT_LABEL[s]).join("・"), carry: pair });
  }

  for (const quality of GEAR_QUALITIES) {
    if (quality === std.quality) continue;
    out.push({ ...std, key: `quality.${quality}`, group: "quality", label: QUALITY_LABEL[quality], quality });
  }

  for (const moveset of MOVESET_KEYS) {
    const base = firstBaseOf(moveset);
    if (base === undefined || base === std.weaponBase) continue;
    out.push({ ...std, key: `weapon.${moveset}`, group: "weapon", label: `${MOVESETS[moveset].name}（${baseName(base)}）`, weaponBase: base });
  }

  // ジョブは初期武器で持ち込む（ジョブを選んだ人が最初に握る武器。武器種だけの差は weapon の軸で見る）
  for (const job of JOB_KEYS) {
    if (job === std.job) continue;
    const weapon = JOBS[job].starterWeapon ?? std.weaponBase;
    const weaponLabel = weapon === null ? "素手" : baseName(weapon);
    out.push({ ...std, key: `job.${job}`, group: "job", label: `${JOBS[job].name}（${weaponLabel}）`, weaponBase: weapon, job });
  }
  return out;
}

/** `--only` の絞り込み。軸の名前（weapon）か key（weapon.spear）をカンマで並べる。標準は比べる元なので常に入れる */
export function selectPatterns(all: readonly GearPattern[], only: string | undefined): GearPattern[] {
  if (only === undefined || only.trim() === "") return [...all];
  const wanted = only.split(",").map((s) => s.trim()).filter((s) => s !== "");
  return all.filter((p) => p.key === "standard" || wanted.includes(p.group) || wanted.includes(p.key));
}

// ---------------------------------------------------------------------------
// 拠点の装備（持ち込む前）の組み立て
// ---------------------------------------------------------------------------

/** 遺物の生成に使う固定の時刻（決定性のため実時間を使わない） */
const GEAR_NOW = 1_700_000_000_000;
const GEAR_SEED_MIX = 0x5bd1e995;
/** 名のある遺物が出るまで引き直す回数（出ない部位は最後に引いた物を使う） */
const NAMED_ATTEMPTS = 120;
/** 名のある遺物を引くときの揺らぎの増幅（名のある遺物の出やすさも上がる） */
const NAMED_BOOST = 25;
/** 「並」から外す名のある遺物（並の平均を名前つきが歪めないため。gearPower.ts と同じ考え） */
const EXCLUDED_NAMED: readonly string[] = UNIQUES.map((u) => u.key);

function colorsFor(quality: GearQuality, seed: number): readonly TraitColor[] {
  const base = seed % TRAIT_COLORS.length;
  switch (quality) {
    case "mono":
      return [TRAIT_COLORS[base]!];
    case "duo":
      return [TRAIT_COLORS[base]!, TRAIT_COLORS[(base + 2) % TRAIT_COLORS.length]!];
    default:
      return [...TRAIT_COLORS];
  }
}

function rollNamed(rng: Rng, slot: Slot, level: number): Item {
  let last: Item | undefined;
  for (let i = 0; i < NAMED_ATTEMPTS; i++) {
    last = generateItem(rng, { itemLevel: level, slot, rarityBoost: NAMED_BOOST, foundDepth: level, now: GEAR_NOW });
    if (last.namedKey !== undefined) return last;
  }
  return last!;
}

/** 右手以外の 1 部位を質に合わせて作る */
function armorPiece(rng: Rng, slot: Slot, quality: GearQuality, seed: number): Item {
  switch (quality) {
    case "plain":
    case "plainHigh": {
      const level = quality === "plainHigh" ? HIGH_GEAR_LEVEL : HOME_GEAR_LEVEL;
      return generateItem(rng, { itemLevel: level, slot, foundDepth: level, now: GEAR_NOW, excludeNamed: EXCLUDED_NAMED });
    }
    case "rough":
      return rollUntilRarity(rng, slot, "rare", HOME_GEAR_LEVEL, HOME_GEAR_LEVEL, GEAR_NOW);
    case "inverted":
      return rollUntilRarity(rng, slot, "unique", HOME_GEAR_LEVEL, HOME_GEAR_LEVEL, GEAR_NOW);
    case "named":
      return rollNamed(rng, slot, HOME_GEAR_LEVEL);
    case "mono":
    case "duo":
    case "scatter":
      return buildColoredItem(rng, slot, colorsFor(quality, seed), HOME_GEAR_LEVEL, HOME_GEAR_LEVEL, GEAR_NOW);
  }
}

/**
 * 拠点のプロフィール（持ち込む部位だけ装備した状態）。右手は質に関わらず並（武器種の差を質で歪めない）。
 * rng は seed だけで決まる専用のもので、パターンが違っても右手は同じ seed なら同じ引き方から始める
 */
export function buildHomeProfile(pattern: Readonly<GearPattern>, seed: number): Profile {
  const profile = createEmptyProfile();
  const rng = createRng((seed ^ GEAR_SEED_MIX) >>> 0);
  if (pattern.weaponBase !== null) {
    const level = pattern.quality === "plainHigh" ? HIGH_GEAR_LEVEL : HOME_GEAR_LEVEL;
    profile.equipment.mainHand = generateItem(rng, {
      itemLevel: level,
      slot: "mainHand",
      foundDepth: level,
      now: GEAR_NOW,
      baseKey: pattern.weaponBase,
      excludeNamed: EXCLUDED_NAMED,
    });
  }
  for (const slot of pattern.carry) profile.equipment[slot] = armorPiece(rng, slot, pattern.quality, seed);
  return profile;
}

/** ラン用のプロフィール（右手 + 持ち込む部位。ゲームの makeRunProfile を通す） */
export function buildRunProfile(pattern: Readonly<GearPattern>, seed: number): Profile {
  const home = buildHomeProfile(pattern, seed);
  const slots: Slot[] = pattern.weaponBase === null ? [...pattern.carry] : ["mainHand", ...pattern.carry];
  return makeRunProfile(home, slots);
}

// ---------------------------------------------------------------------------
// bot の付け替え（ラン中に拾った遺物）
// ---------------------------------------------------------------------------

/**
 * 袋（ラン中の stash）の遺物を付けるか。空いた部位は付け、埋まっている部位は拾った深度（itemLevel）が
 * GEAR_SWAP_MARGIN 以上深いときだけ付け替える（人も深い階の物へ乗り換える。性質の中身までは読まない）。
 * 右手は付け替えない（武器種の軸を崩さないため）
 */
export const GEAR_SWAP_MARGIN = 3;

function betterThan(candidate: Readonly<Item>, current: Readonly<Item> | null): boolean {
  if (current === null) return true;
  return candidate.itemLevel >= current.itemLevel + GEAR_SWAP_MARGIN;
}

/** 袋から付ける遺物を 1 つ選ぶ（無ければ null）。部位ごとに最も深い物 */
export function pickEquip(profile: Readonly<Profile>): Item | null {
  let best: Item | null = null;
  for (const item of profile.stash) {
    if (item.slot === "mainHand") continue;
    if (!betterThan(item, profile.equipment[item.slot] ?? null)) continue;
    if (best === null || item.itemLevel > best.itemLevel) best = item;
  }
  return best;
}

/** 付けられるだけ付けて、付けた数を返す。付けたら stats を作り直す（ゲームの装備画面と同じ applyStats） */
export function autoEquip(state: GameState): number {
  let count = 0;
  for (let item = pickEquip(state.profile); item !== null; item = pickEquip(state.profile)) {
    equipItem(state.profile, item.id);
    count++;
  }
  if (count > 0) applyStats(state, computeStats(state.profile.equipment, state.depth));
  return count;
}

// ---------------------------------------------------------------------------
// 1 ラン
// ---------------------------------------------------------------------------

export interface GearRunRecord {
  pattern: string;
  seed: number;
  maxDepth: number;
  died: boolean;
  /** 最深の主を倒した（status cleared） */
  cleared: boolean;
  /** ゲーム内の経過秒 */
  seconds: number;
  /** 初めて着いた階の数（1 階あたりの秒の分母） */
  floors: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  hitsTaken: number;
  bossEncounters: number;
  bossDefeats: number;
  /** 袋に入った遺物の数 */
  picked: number;
  /** bot が付けた数 */
  equipped: number;
  deathCause: string | null;
  exception: string | null;
}

/** 袋を見て付け替えるのは何 step ごとか（毎 step は重い。拾ってから 1 秒以内に付く） */
const EQUIP_CHECK_STEPS = 60;

/** 死因: 最後の被弾の出どころ（simulation.test.ts の deathCauseOf と同じ書き方） */
function deathCauseOf(state: GameState): string {
  const killer = killerOf(state);
  if (!killer) return "unknown";
  return killer.key === "" ? killer.kind : killer.key;
}

/** 敵の生命の減りを与ダメとして数える（消えた敵は最後に見えた生命を全部削ったとみなす） */
function createDealtTracker(): (state: GameState) => number {
  let prev = new Map<number, number>();
  return (state) => {
    let dealt = 0;
    const next = new Map<number, number>();
    for (const e of state.enemies) {
      const hp = Math.max(0, e.hp);
      const before = prev.get(e.id);
      if (before !== undefined && before > hp) dealt += before - hp;
      next.set(e.id, hp);
      prev.delete(e.id);
    }
    // 残り = この step で消えた敵（倒れた / 階を離れた）。階を離れた分は state.kills が増えないので数えない
    for (const hp of prev.values()) dealt += hp;
    prev = next;
    return dealt;
  };
}

export function runGearOnce(pattern: Readonly<GearPattern>, seed: number, maxSteps: number): GearRunRecord {
  const profile = buildRunProfile(pattern, seed);
  const state = createGame(seed, String(seed), profile, buildQaSkillProfile(), { ...defaultRunSetup(), job: pattern.job });
  const bot = createBotState((seed * 2654435761 + 12345) >>> 0);
  const record: GearRunRecord = {
    pattern: pattern.key,
    seed,
    maxDepth: state.depth,
    died: false,
    cleared: false,
    seconds: 0,
    floors: 1,
    kills: 0,
    damageDealt: 0,
    damageTaken: 0,
    hitsTaken: 0,
    bossEncounters: 0,
    bossDefeats: 0,
    picked: 0,
    equipped: 0,
    deathCause: null,
    exception: null,
  };
  const dealt = createDealtTracker();
  const startTime = state.time;
  let prevHp = state.player.hp;
  let prevKills = state.kills;
  let currentDepth = state.depth;
  let sawBoss = false;
  let sawBossDefeat = false;
  const seenStash = new Set<string>();

  for (let i = 0; i < maxSteps; i++) {
    if (state.status !== "playing") break;
    if (state.pendingBud) chooseBud(state, state.pendingBud.slot, 0);
    if (pattern.pickup && i % EQUIP_CHECK_STEPS === 0) record.equipped += autoEquip(state);

    try {
      step(state, botInput(state, bot, FIXED_DT), FIXED_DT);
    } catch (err) {
      record.exception = err instanceof Error ? err.message : String(err);
      break;
    }

    const hp = state.player.hp;
    if (hp < prevHp) {
      record.damageTaken += prevHp - hp;
      record.hitsTaken++;
    }
    prevHp = hp;
    const d = dealt(state);
    // 階を離れて消えた敵を与ダメに数えないよう、撃破が増えた step だけ消えた分を入れる
    if (state.kills > prevKills || state.depth === currentDepth) record.damageDealt += d;
    prevKills = state.kills;

    for (const item of state.profile.stash) seenStash.add(item.id);
    if (state.boss && !sawBoss) {
      record.bossEncounters++;
      sawBoss = true;
    }
    if (state.boss?.defeated && !sawBossDefeat) {
      record.bossDefeats++;
      sawBossDefeat = true;
    }
    if (state.depth !== currentDepth) {
      if (state.runEvents.strata.fresh) record.floors++;
      currentDepth = state.depth;
      sawBoss = false;
      sawBossDefeat = false;
    }
    record.maxDepth = Math.max(record.maxDepth, state.depth);

    // ループ先頭の判定で status が "playing" に絞り込まれているので union に戻して比べる
    const status = state.status as GameStatus;
    if (status === "dead") {
      record.died = true;
      record.deathCause = deathCauseOf(state);
    } else if (status === "cleared") {
      record.cleared = true;
    }
  }

  record.seconds = state.time - startTime;
  record.kills = state.kills;
  record.picked = seenStash.size;
  return record;
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

/** 深度 n 以上に着いたランの割合を出す深度 */
export const REACH_DEPTHS: readonly number[] = [5, 10, 15, 21];
/** 差の区間の幅（平均の差 ± Z × 標準誤差。95%） */
const Z_95 = 1.96;
const SECONDS_PER_MINUTE = 60;
const DEATH_CAUSE_TOP = 3;

export interface Interval {
  mean: number;
  /** 区間の半分の幅（標本が 2 未満なら 0） */
  half: number;
}

export interface GearSummary {
  pattern: string;
  group: GearGroup;
  label: string;
  runs: number;
  depthMean: number;
  depthMedian: number;
  depthQ1: number;
  depthQ3: number;
  /** REACH_DEPTHS の各深度に着いたランの割合 */
  reach: number[];
  clearRate: number;
  deathRate: number;
  secondsPerFloor: number;
  killsPerMinute: number;
  dealtPerSecond: number;
  takenPerMinute: number;
  hitsPerMinute: number;
  /** 被弾 1 回あたりの被ダメ */
  takenPerHit: number;
  bossDefeatRate: number;
  pickedPerRun: number;
  equippedPerRun: number;
  deathCauses: { cause: string; count: number }[];
  exceptions: number;
  /** 標準との到達深度の差（同じ seed の対の差の平均と区間）。標準自身と対が無いときは null */
  depthDelta: Interval | null;
}

function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/** 線形補間の分位（q は 0〜1） */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loV = sorted[lo]!;
  const hiV = sorted[hi]!;
  return loV + (hiV - loV) * (pos - lo);
}

/** 平均と 95% 区間の半幅 */
export function meanInterval(values: readonly number[]): Interval {
  const m = mean(values);
  if (values.length < 2) return { mean: m, half: 0 };
  const variance = sum(values.map((v) => (v - m) ** 2)) / (values.length - 1);
  return { mean: m, half: Z_95 * Math.sqrt(variance / values.length) };
}

/** 同じ seed の対の差（pattern − 標準）。対が 1 つも無ければ null */
export function pairedDelta(records: readonly GearRunRecord[], baseline: readonly GearRunRecord[]): Interval | null {
  const base = new Map(baseline.map((r) => [r.seed, r.maxDepth]));
  const diffs: number[] = [];
  for (const r of records) {
    const b = base.get(r.seed);
    if (b !== undefined) diffs.push(r.maxDepth - b);
  }
  return diffs.length === 0 ? null : meanInterval(diffs);
}

function rate(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function topDeathCauses(records: readonly GearRunRecord[]): { cause: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.deathCause !== null) counts.set(r.deathCause, (counts.get(r.deathCause) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))
    .slice(0, DEATH_CAUSE_TOP);
}

export function summarize(pattern: Readonly<GearPattern>, records: readonly GearRunRecord[], baseline: readonly GearRunRecord[]): GearSummary {
  const depths = records.map((r) => r.maxDepth);
  const seconds = sum(records.map((r) => r.seconds));
  const minutes = seconds / SECONDS_PER_MINUTE;
  const taken = sum(records.map((r) => r.damageTaken));
  const hits = sum(records.map((r) => r.hitsTaken));
  const bossEnc = sum(records.map((r) => r.bossEncounters));
  return {
    pattern: pattern.key,
    group: pattern.group,
    label: pattern.label,
    runs: records.length,
    depthMean: mean(depths),
    depthMedian: quantile(depths, 0.5),
    depthQ1: quantile(depths, 0.25),
    depthQ3: quantile(depths, 0.75),
    reach: REACH_DEPTHS.map((d) => rate(depths.filter((v) => v >= d).length, records.length)),
    clearRate: rate(records.filter((r) => r.cleared).length, records.length),
    deathRate: rate(records.filter((r) => r.died).length, records.length),
    secondsPerFloor: rate(seconds, sum(records.map((r) => r.floors))),
    killsPerMinute: rate(sum(records.map((r) => r.kills)), minutes),
    dealtPerSecond: rate(sum(records.map((r) => r.damageDealt)), seconds),
    takenPerMinute: rate(taken, minutes),
    hitsPerMinute: rate(hits, minutes),
    takenPerHit: rate(taken, hits),
    bossDefeatRate: rate(sum(records.map((r) => r.bossDefeats)), bossEnc),
    pickedPerRun: mean(records.map((r) => r.picked)),
    equippedPerRun: mean(records.map((r) => r.equipped)),
    deathCauses: topDeathCauses(records),
    exceptions: records.filter((r) => r.exception !== null).length,
    depthDelta: pattern.key === "standard" ? null : pairedDelta(records, baseline),
  };
}

/** 全パターンの集計（記録の無いパターンは飛ばす） */
export function summarizeAll(patterns: readonly GearPattern[], records: readonly GearRunRecord[]): GearSummary[] {
  const byPattern = new Map<string, GearRunRecord[]>();
  for (const r of records) {
    const list = byPattern.get(r.pattern) ?? [];
    list.push(r);
    byPattern.set(r.pattern, list);
  }
  const baseline = byPattern.get("standard") ?? [];
  return patterns.filter((p) => byPattern.has(p.key)).map((p) => summarize(p, byPattern.get(p.key)!, baseline));
}

// ---------------------------------------------------------------------------
// 書き出し（Markdown）
// ---------------------------------------------------------------------------

const PCT = 100;

function f1(v: number): string {
  return v.toFixed(1);
}

function pct(v: number): string {
  return `${(v * PCT).toFixed(0)}%`;
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

/** 標準との差。区間が 0 を跨がないものに * を付ける（偶然では説明しにくい差） */
function deltaCell(d: Interval | null): string {
  if (d === null) return "—";
  const mark = Math.abs(d.mean) > d.half && d.half > 0 ? " *" : "";
  return `${signed(d.mean)} ±${d.half.toFixed(1)}${mark}`;
}

/** 前回の平均到達深度との差（前回が無ければ —） */
function prevCell(s: Readonly<GearSummary>, prev: ReadonlyMap<string, GearSummary>): string {
  const p = prev.get(s.pattern);
  return p === undefined ? "—" : signed(s.depthMean - p.depthMean);
}

function causesCell(s: Readonly<GearSummary>): string {
  return s.deathCauses.map((c) => `${c.cause} ${c.count}`).join(" / ") || "—";
}

function tableRows(rows: readonly GearSummary[], prev: ReadonlyMap<string, GearSummary>): string[] {
  const head = [
    "| パターン | ラン | 到達 平均 | 中央値 (25〜75%) | 標準との差 | 前回比 | " + REACH_DEPTHS.map((d) => `${d}+`).join(" | ") + " | 踏破 | 1 階の秒 | 撃破/分 | 与ダメ/秒 | 被弾/分 | 被ダメ/被弾 | ボス撃破 | 拾得 | 付け替え | 死因の上位 |",
    "| --- | --- | --- | --- | --- | --- | " + REACH_DEPTHS.map(() => "---").join(" | ") + " | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const body = rows.map((s) =>
    [
      s.label,
      String(s.runs),
      f1(s.depthMean),
      `${f1(s.depthMedian)} (${f1(s.depthQ1)}〜${f1(s.depthQ3)})`,
      deltaCell(s.depthDelta),
      prevCell(s, prev),
      ...s.reach.map(pct),
      pct(s.clearRate),
      f1(s.secondsPerFloor),
      f1(s.killsPerMinute),
      f1(s.dealtPerSecond),
      f1(s.hitsPerMinute),
      f1(s.takenPerHit),
      pct(s.bossDefeatRate),
      f1(s.pickedPerRun),
      f1(s.equippedPerRun),
      causesCell(s),
    ].join(" | "),
  );
  return [...head, ...body.map((b) => `| ${b} |`)];
}

export interface GearReportMeta {
  generatedAt: string;
  seeds: number;
  maxSteps: number;
}

export function buildGearReport(summaries: readonly GearSummary[], meta: Readonly<GearReportMeta>, prevSummaries: readonly GearSummary[] = []): string {
  const prev = new Map(prevSummaries.map((s) => [s.pattern, s]));
  const std = summaries.find((s) => s.pattern === "standard");
  const lines: string[] = [
    "# 装備パターンの行列（`npm run qa:gear`）",
    "",
    `生成: ${meta.generatedAt} / ${summaries.length} パターン × ${meta.seeds} seed × 最大 ${meta.maxSteps} step`,
    "",
    "## 読み方",
    "",
    `- 持ち込みはゲームの決まりどおり右手 + ${CARRY.carrySlots} 部位（標準）。持ち込む遺物は itemLevel ${HOME_GEAR_LEVEL}（深い階の物は ${HIGH_GEAR_LEVEL}）。右手は質の軸でも並`,
    `- bot はラン中に拾った遺物を、空いた部位には付け、埋まった部位は ${GEAR_SWAP_MARGIN} 階以上深い物なら付け替える（右手は替えない）`,
    "- 1 軸ずつ標準から変える。全パターンで同じ seed の列を使い、「標準との差」は同じ seed の対の差の平均 ± 95% 区間。`*` は区間が 0 を跨がない（偶然では説明しにくい）差",
    "- 「前回比」は前回の `src/qa/gear.json` の平均到達深度との差。与ダメ/秒は敵の生命の減り（階を離れて消えた敵は数えない）",
    "- スキルは QA 標準の 4 種（旋風斬り・撃ち抜き・突進斬り・炸裂玉）。bot の腕は一定なので、絶対値より差を見る",
    "",
  ];
  if (std !== undefined) {
    lines.push(`標準: 到達深度 平均 ${f1(std.depthMean)}・中央値 ${f1(std.depthMedian)}・踏破 ${pct(std.clearRate)}`, "");
  }
  const exceptions = sum(summaries.map((s) => s.exceptions));
  if (exceptions > 0) lines.push(`**例外: ${exceptions} ラン**（gear.runs.json の exception を参照）`, "");

  for (const group of GEAR_GROUPS) {
    if (group === "standard") continue;
    const rows = summaries.filter((s) => s.group === group);
    if (rows.length === 0) continue;
    const withStd = std === undefined ? rows : [std, ...rows];
    lines.push(`## ${GEAR_GROUP_LABEL[group]}`, "", ...tableRows(withStd, prev), "");
  }
  return lines.join("\n");
}
