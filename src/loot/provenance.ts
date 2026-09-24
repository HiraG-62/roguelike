import type { GameState } from "../core/state";
import { createRng, hashSeed, type Rng } from "../core/rng";
import { ENEMIES } from "../data/enemies";
import { KEYSTONE } from "../data/tuning";
import { affixDef } from "./affixes";
import { OPPOSITE_COLOR } from "./colors";
import { fluxClassOf } from "./flux";
import { CALM_SIGMA_SCALE, rollTableTrait, rollTraitOfColor, type TraitRollOptions } from "./generator";
import { ensureGrowthFields } from "./migrate";
import { engraveName, nameItem } from "./names";
import { saveProfile } from "./profile";
import {
  SLOTS,
  createEmptyProvenance,
  type AffixRoll,
  type BudOffer,
  type Item,
  type PendingBud,
  type Profile,
  type Provenance,
  type TraitColor,
} from "./types";

/**
 * 来歴と芽。docs/LOOT_DESIGN.md「来歴と芽」。
 * 装備中のアイテムに出来事（撃破 / JUST / 被弾 / ボス撃破 / 部屋・階層クリア）を積み、
 * 節目に達すると「芽」（2 択の成長）を提示する。片方は節目の色、もう片方は反対色の性質。
 * 選ばなかった方は二度と出ない。余白を使い切ると来歴から銘が刻まれる。
 * 乱数は state.rng を使わず、item.seed と節目の key から作る（ゲームの決定性に影響しない）。
 */

export type ProvenanceEvent =
  | { kind: "kill"; enemyKey: string; boss: boolean }
  | { kind: "just" }
  | { kind: "hurt" }
  | { kind: "roomClear" }
  | { kind: "floorClear" }
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 7 章）----
  | { kind: "stagger" }
  | { kind: "counter" }
  | { kind: "skillCast" }
  | { kind: "eliteKill" }
  | { kind: "lastKill" }
  // ---- 2026-09 第 2 弾（属性・地形・ジョブ・武器種。system/traitHooks.ts が積む）----
  | { kind: "weakHit" }
  | { kind: "resistedHit" }
  | { kind: "terrainKill" }
  | { kind: "favoredKill" }
  | { kind: "chargedHit" }
  | { kind: "branchHit" }
  // ---- 2026-09-24 第 4 弾（system/floor.ts の ascend が積む）----
  | { kind: "returned" };

type CounterKey =
  | "kills"
  | "justDodges"
  | "hurtTaken"
  | "bosses"
  | "roomsCleared"
  | "floorsCleared"
  | "staggers"
  | "counters"
  | "skillCasts"
  | "eliteKills"
  | "lastKills"
  | "weakHits"
  | "resistedHits"
  | "terrainKills"
  | "favoredKills"
  | "chargedHits"
  | "branchHits"
  | "returns";

export interface MilestoneDef {
  key: string;
  counter: CounterKey;
  threshold: number;
  /** 芽の片方の色（もう片方は OPPOSITE_COLOR） */
  color: TraitColor;
  label: string;
  /** 敵種別の撃破数で数える節目（killsByEnemy[enemyKey]）。counter は kills のまま */
  enemyKey?: string;
  /** 目覚め: 芽の片方をこの性質（affixes.ts の awakening）にする */
  awakening?: string;
}

function milestone(counter: CounterKey, threshold: number, color: TraitColor, label: string, awakening?: string): MilestoneDef {
  const def: MilestoneDef = { key: `${counter}:${threshold}`, counter, threshold, color, label: `${label} ${threshold}` };
  if (awakening !== undefined) def.awakening = awakening;
  return def;
}

function enemyName(key: string): string {
  return ENEMIES.find((e) => e.key === key)?.name ?? key;
}

/** 敵種別の撃破数の節目（目覚めを出す）。key は "enemy:<敵種>:<数>" */
function enemyMilestone(enemyKey: string, threshold: number, color: TraitColor, awakening: string): MilestoneDef {
  return {
    key: `enemy:${enemyKey}:${threshold}`,
    counter: "kills",
    threshold,
    color,
    label: `${enemyName(enemyKey)}撃破 ${threshold}`,
    enemyKey,
    awakening,
  };
}

/** 節目の表。表の順に判定し、1 度に提示する芽は 1 つ */
export const MILESTONES: readonly MilestoneDef[] = [
  milestone("kills", 50, "crimson", "撃破"),
  milestone("justDodges", 20, "gold", "見切り"),
  milestone("hurtTaken", 40, "jade", "被弾"),
  milestone("bosses", 1, "umbra", "ボス撃破"),
  // 第 2 弾で目覚めを名指しするようにした節目（key は変えないので、到達済みの遺物に芽が出直すことはない）
  milestone("floorsCleared", 10, "azure", "階層踏破", "emberWalk"),
  milestone("roomsCleared", 25, "jade", "部屋制圧", "siegeHeart"),
  milestone("kills", 200, "crimson", "撃破"),
  milestone("justDodges", 60, "gold", "見切り"),
  milestone("hurtTaken", 150, "jade", "被弾"),
  milestone("bosses", 3, "umbra", "ボス撃破"),
  milestone("floorsCleared", 30, "azure", "階層踏破", "frostWalk"),
  milestone("kills", 500, "crimson", "撃破"),
  // ---- 2026-09 追加。旧セーブの到達済み節目の並びを崩さないよう末尾に足す ----
  milestone("staggers", 100, "crimson", "怯ませ", "hueBreak"),
  milestone("counters", 30, "gold", "カウンター", "firstMove"),
  milestone("skillCasts", 300, "azure", "スキル発動", "battleRhythm"),
  milestone("eliteKills", 30, "crimson", "精鋭撃破", "plunder"),
  milestone("lastKills", 20, "gold", "殲滅", "curtainCall"),
  enemyMilestone("knight", 30, "crimson", "shieldSplitter"),
  enemyMilestone("bomber", 40, "crimson", "kickback"),
  milestone("staggers", 400, "crimson", "怯ませ", "brokenBreaker"),
  milestone("counters", 120, "gold", "カウンター"),
  milestone("skillCasts", 1200, "azure", "スキル発動", "stormConduit"),
  // ---- 2026-09 第 2 弾: 属性・地形・ジョブ・武器種の節目（すべて目覚めを名指しする）----
  milestone("weakHits", 150, "azure", "弱点攻撃", "weakInsight"),
  milestone("resistedHits", 150, "umbra", "耐性で軽減", "counterGrain"),
  milestone("terrainKills", 60, "jade", "地形上での撃破", "groundWisdom"),
  milestone("favoredKills", 150, "crimson", "得意武器での撃破", "schoolMastery"),
  milestone("chargedHits", 100, "crimson", "溜め攻撃の命中", "fullCharge"),
  milestone("branchHits", 150, "gold", "派生の命中", "formBreaker"),
  milestone("weakHits", 600, "gold", "弱点攻撃", "sevenHues"),
  milestone("terrainKills", 250, "jade", "地形上での撃破", "mireLord"),
  milestone("favoredKills", 600, "gold", "得意武器での撃破", "schoolSecret"),
  // ---- 2026-09-24 第 4 弾: 上り階段で浅い階へ戻った探索を共にした（docs/ideas/run-expansion.md 4 章の見送り分）----
  milestone("returns", 1, "azure", "帰還"),
];

/** 来歴を 2 倍で積むベース（印章指輪） */
const DOUBLE_PROGRESS_BASES: ReadonlySet<string> = new Set(["signet"]);
const DOUBLE_PROGRESS = 2;
/** 来歴の誓約の key（loot から system/keystones.ts を import しないよう文字列で持つ） */
const DISCIPLINE_KEY = "ks_discipline";
const OBLIVION_KEY = "ks_oblivion";

const MILESTONE_BY_KEY: ReadonlyMap<string, MilestoneDef> = new Map(MILESTONES.map((m) => [m.key, m]));

export function milestoneDef(key: string): MilestoneDef | undefined {
  return MILESTONE_BY_KEY.get(key);
}

// ---------------------------------------------------------------------------
// 来歴の加算
// ---------------------------------------------------------------------------

/** 出来事 1 つを来歴に積む（その場で書き換える） */
export function bumpProvenance(p: Provenance, event: ProvenanceEvent, depth: number): void {
  p.deepest = Math.max(p.deepest, depth);
  switch (event.kind) {
    case "kill":
      p.kills += 1;
      p.killsByEnemy[event.enemyKey] = (p.killsByEnemy[event.enemyKey] ?? 0) + 1;
      if (event.boss) p.bosses += 1;
      return;
    case "just":
      p.justDodges += 1;
      return;
    case "hurt":
      p.hurtTaken += 1;
      return;
    case "roomClear":
      p.roomsCleared += 1;
      return;
    case "floorClear":
      p.floorsCleared += 1;
      return;
    case "stagger":
      p.staggers += 1;
      return;
    case "counter":
      p.counters += 1;
      return;
    case "skillCast":
      p.skillCasts += 1;
      return;
    case "eliteKill":
      p.eliteKills += 1;
      return;
    case "lastKill":
      p.lastKills += 1;
      return;
    case "weakHit":
      p.weakHits += 1;
      return;
    case "resistedHit":
      p.resistedHits += 1;
      return;
    case "terrainKill":
      p.terrainKills += 1;
      return;
    case "favoredKill":
      p.favoredKills += 1;
      return;
    case "chargedHit":
      p.chargedHits += 1;
      return;
    case "branchHit":
      p.branchHits += 1;
      return;
    case "returned":
      p.returns += 1;
      return;
  }
}

/** 節目が見る来歴の量 */
export function milestoneProgress(p: Provenance, def: MilestoneDef): number {
  if (def.enemyKey !== undefined) return p.killsByEnemy[def.enemyKey] ?? 0;
  return p[def.counter];
}

// ---------------------------------------------------------------------------
// 芽
// ---------------------------------------------------------------------------

/** 到達済み・未提示の節目のうち最初のもの */
export function nextMilestone(item: Item): MilestoneDef | undefined {
  const p = item.provenance;
  if (p === undefined) return undefined;
  const reached = item.milestones ?? [];
  // 出来事ごとに呼ばれるので、安い数値の比較を先にして到達済みの照合は届いた節目だけにする
  return MILESTONES.find((m) => milestoneProgress(p, m) >= m.threshold && !reached.includes(m.key));
}

/** これまでに出た key（現在の性質 + 過去の芽の候補の両方）。捨てた枝は二度と出ない */
function usedKeys(item: Item): Set<string> {
  const keys = new Set(item.affixes.map((r) => r.key));
  for (const bud of item.buds ?? []) for (const option of bud.options) keys.add(option.key);
  return keys;
}

/**
 * 節目の芽（2 択）を作る。純関数: 同じアイテム・同じ節目なら同じ候補。
 * 候補が作れなければ null
 */
export function makeBudOffer(item: Item, def: MilestoneDef): BudOffer | null {
  const rng = createRng(hashSeed(`${item.seed}|${def.key}`));
  const used = usedKeys(item);
  const opts: TraitRollOptions = {
    depth: item.itemLevel,
    foundDepth: item.foundDepth,
    sigmaScale: CALM_SIGMA_SCALE,
    allowInversion: false,
    origin: "bud",
  };
  const along = rollAwakening(rng, def, used, opts) ?? rollTraitOfColor(rng, item.slot, def.color, used, opts);
  if (along === undefined) return null;
  used.add(along.key);
  const against = rollTraitOfColor(rng, item.slot, OPPOSITE_COLOR[def.color], used, opts);
  if (against === undefined) return null;
  return { milestone: def.key, options: [along, against] };
}

/** 目覚め（節目が名指しする芽専用の性質）。既に出ていれば undefined（通常の芽に戻る） */
function rollAwakening(rng: Rng, def: MilestoneDef, used: ReadonlySet<string>, opts: TraitRollOptions): AffixRoll | undefined {
  if (def.awakening === undefined || used.has(def.awakening)) return undefined;
  const trait = affixDef(def.awakening);
  if (trait === undefined) return undefined;
  return rollTableTrait(rng, trait, opts);
}

/**
 * 余白があり、提示中の芽が無ければ、次の節目の芽を提示する（その場で書き換える）。
 * 提示したら true。候補が作れない節目は到達済みにして飛ばす
 */
export function offerNextBud(item: Item): boolean {
  ensureGrowthFields(item);
  if (item.budOffer !== null && item.budOffer !== undefined) return false;
  if ((item.margin ?? 0) <= 0) return false;
  for (let def = nextMilestone(item); def !== undefined; def = nextMilestone(item)) {
    item.milestones?.push(def.key);
    const offer = makeBudOffer(item, def);
    if (offer === null) continue;
    item.budOffer = offer;
    return true;
  }
  return false;
}

/** 余白を使い切っていて銘が無ければ、来歴から銘を刻む（その場で書き換える） */
export function maybeInscribe(item: Item): boolean {
  if ((item.margin ?? 0) > 0 || item.inscription !== undefined) return false;
  item.inscription = engraveName(item.provenance ?? createEmptyProvenance(), item.seed);
  item.name = nameItem(item);
  return true;
}

/**
 * 提示中の芽から index（0 / 1）を選ぶ（その場で書き換える）。
 * 選んだ性質を加え、余白を 1 減らし、履歴に残す。余白が 0 になれば銘を刻み、次の節目があれば続けて提示する。
 * 選べたら選んだ性質、提示が無い / index 不正なら null
 */
export function chooseBudOnItem(item: Item, index: number): AffixRoll | null {
  const offer = item.budOffer;
  if (offer === null || offer === undefined) return null;
  if (index !== 0 && index !== 1) return null;
  ensureGrowthFields(item);
  const chosen = offer.options[index];
  item.affixes = [...item.affixes, { ...chosen, origin: "bud" }];
  item.margin = Math.max(0, (item.margin ?? 0) - 1);
  item.buds = [...(item.buds ?? []), { milestone: offer.milestone, options: offer.options, chosen: index }];
  item.budOffer = null;
  item.rarity = fluxClassOf(item.affixes);
  if (!maybeInscribe(item)) item.name = nameItem(item);
  offerNextBud(item);
  return chosen;
}

// ---------------------------------------------------------------------------
// GameState との接続
// ---------------------------------------------------------------------------

/** ベースによる来歴の進みの倍率（印章指輪は 2 倍） */
export function progressFor(baseKey: string): number {
  return DOUBLE_PROGRESS_BASES.has(baseKey) ? DOUBLE_PROGRESS : 1;
}

/** 装備中のアイテムのうち、芽を提示中の最初の 1 つ（SLOTS 順） */
export function findPendingBud(profile: Profile): PendingBud | null {
  for (const slot of SLOTS) {
    const item = profile.equipment[slot];
    const offer = item?.budOffer;
    if (item === null || item === undefined || offer === null || offer === undefined) continue;
    const def = milestoneDef(offer.milestone);
    return {
      itemId: item.id,
      slot,
      milestone: offer.milestone,
      milestoneLabel: def?.label ?? offer.milestone,
      options: offer.options,
    };
  }
  return null;
}

/**
 * 出来事を装備中の全アイテムの来歴に積み、節目に達したら芽を提示する。
 * state.pendingBud を更新し、新しい芽が出たらプロフィールを保存する。
 * combat / floor から最小のフックで呼ぶ
 */
export function recordProvenance(state: GameState, event: ProvenanceEvent): void {
  // 拠点の木人で来歴を育てられないようにする
  if (state.sandbox) return;
  const keystones = state.stats.keystones;
  // 忘却の誓い: 来歴は積もらず、芽も出ない
  if (keystones.includes(OBLIVION_KEY)) return;
  const pace = keystones.includes(DISCIPLINE_KEY) ? KEYSTONE.disciplineProgress : 1;
  let offered = false;
  for (const slot of SLOTS) {
    const item = state.profile.equipment[slot];
    if (item === null) continue;
    ensureGrowthFields(item);
    const provenance = item.provenance;
    if (provenance !== undefined) {
      const times = pace * progressFor(item.baseKey);
      for (let i = 0; i < times; i++) bumpProvenance(provenance, event, state.depth);
    }
    if (offerNextBud(item)) offered = true;
  }
  if (!offered) return;
  state.pendingBud = findPendingBud(state.profile);
  saveProfile(state.profile);
}
