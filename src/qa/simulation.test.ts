import { describe, expect, it, vi } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, EliteKind, EnemyPhase, GameState, GameStatus } from "../core/state";
import { STATUS_KINDS, STATUS_LABEL, type StatusKind } from "../core/status";
import { TERRAIN_KINDS, TERRAIN_LABEL, type TerrainKind } from "../core/terrain";
import { createRng, type Rng } from "../core/rng";
import { ENEMIES, enemyDef, isBossClass } from "../data/enemies";
import { ENEMY_AI } from "../data/tuning";
import {
  createEmptyProfile,
  createEmptyProvenance,
  LOOT_SLOTS,
  RARITIES,
  TRAIT_COLORS,
  type AffixRoll,
  type Item,
  type Profile,
  type Rarity,
  type ResonanceKind,
  type Slot,
  type TraitColor,
} from "../loot/types";
import { generateItem, makeItemId, MAX_FOUND_TRAITS, rollBase, rollImplicit, rollMargin, rollTraitOfColor, type TraitRollOptions } from "../loot/generator";
import { fluxClassOf } from "../loot/flux";
import { nameItem } from "../loot/names";
import { chooseBud } from "../system/loot";
import { isBossDriven } from "../system/boss";
import { createEnemy, isAsleep } from "../system/enemies";
import { ROAMING_ROOM } from "../system/spawner";
import { ELITE_KINDS, ELITE_PREFIX } from "../system/elites";
import * as combat from "../system/combat";
import * as statusEffectsModule from "../system/statusEffects";
import * as elementCombatModule from "../system/elementCombat";
import { terrainAt, smokeAt } from "../system/terrain";
import { stoneFromSeed } from "../skills/generator";
import type { SkillProfile, SkillStone } from "../skills/types";
import { createBotState, botInput } from "./bot";
import * as boonsModule from "../system/boons";
import * as specialRoomsModule from "../system/specialRooms";
import { BOON_GRADES, BOON_GRADE_LABEL, type BoonGrade, boonGradeOf, isGraded } from "../system/boonGrade";
import { overlapsWall } from "../system/physics";

/**
 * ヘッドレス自動プレイによるロングランシミュレーション。
 * 既定（vitest run / CI）では 5 seed × 20,000 ステップの縮小版のみ実行し、
 * 例外・NaN混入・壁めり込み・floorItems id 重複が無いことだけを assert する（30 秒未満を狙う）。
 * SIM_FULL=1 を付けたときだけフル版（30 seed × 3 装備パターン × 60,000 ステップ）を実行し、
 * 収集した指標を report.md 相当の Markdown を console.log に出力する
 * （@types/node が無いプロジェクトのため、このファイル自体は fs に触れない。
 *  実際の src/qa/report.md は `SIM_FULL=1 npx vitest run src/qa/simulation.test.ts` の
 *  出力を人手で保存したもの）。
 */

// @types/node が無いため process の型は自前で最小限だけ宣言する
declare const process: { env: Record<string, string | undefined> };

const FULL = process.env.SIM_FULL === "1";
const FAST_SEED_COUNT = 5;
const FAST_MAX_STEPS = 20_000;
const FULL_SEED_COUNT = 30;
const FULL_MAX_STEPS = 60_000;
/** BOSS.interval と同じ値をここでも参照したいが循環を避けるため直接は import せず、報告用の概算にのみ使う */

/**
 * rareLoadout / uniqueLoadout: 揺らぎ分類（旧レアリティ）を狙って棄却サンプリングする装備。
 * dominant/dual/scatterLoadout: 色の配合（共鳴）を狙って組み立てる装備。
 */
type ProfileKind = "empty" | "rareLoadout" | "uniqueLoadout" | "dominantLoadout" | "dualLoadout" | "scatterLoadout";
const PROFILE_KINDS: readonly ProfileKind[] = [
  "empty",
  "rareLoadout",
  "uniqueLoadout",
  "dominantLoadout",
  "dualLoadout",
  "scatterLoadout",
];
const UINT32_MAX = 0xffffffff;

// ---------------------------------------------------------------------------
// 装備プロフィールの組み立て
// ---------------------------------------------------------------------------

/**
 * generateItem に rarity（揺らぎ分類）を直接指定するオプションは無い（再設計で格付けの抽選自体を
 * 廃止したため）。目的の分類が出るまで rarityBoost=25（揺らぎの増幅）で棄却サンプリングする。
 * rarity は今も Item.rarity に残っているが、意味は「格付け」ではなく「どれだけ揺らいでいるか」
 * （静/揺/荒/反転あり）。generateItem 自体のシグネチャは再設計の前後で変わっていない
 */
function rollUntilRarity(rng: Rng, slot: Slot, rarity: Rarity, itemLevel: number, foundDepth: number, now: number, attempts = 80): Item {
  let last: Item | undefined;
  for (let i = 0; i < attempts; i++) {
    const item = generateItem(rng, { itemLevel, slot, rarityBoost: 25, foundDepth, now });
    last = item;
    if (item.rarity === rarity) return item;
  }
  // 目的の rarity に届かなくても、引けた中で最後のものを使う（unique が存在しない slot 等）
  return last!;
}

/**
 * 色を指定して性質を組み立てた装備アイテムを 1 個作る（generateItem は色を選べないため自前で組む）。
 * colors を巡回させながら loot/generator.ts の rollTraitOfColor で性質を埋める。
 * MAX_FOUND_TRAITS 枠すべて埋めることで、単色なら支配、2 色なら二重、5 色なら散光が
 * 安定して発現するようにする（resonance.ts の DOMINANT_RATIO / DUAL_MIN_RATIO / SCATTER_MAX_RATIO 参照）
 */
function buildColoredItem(rng: Rng, slot: Slot, colors: readonly TraitColor[], depth: number, foundDepth: number, now: number): Item {
  const base = rollBase(rng, slot, depth);
  const opts: TraitRollOptions = { depth, foundDepth };
  const used = new Set<string>();
  const affixes: AffixRoll[] = [];
  for (let i = 0; i < MAX_FOUND_TRAITS; i++) {
    const color = colors[i % colors.length]!;
    const roll = rollTraitOfColor(rng, slot, color, used, opts);
    if (roll === undefined) continue;
    affixes.push(roll);
    used.add(roll.key);
  }
  const margin = rollMargin(rng, affixes.length);
  const implicit = rollImplicit(rng, base);
  const item: Item = {
    id: makeItemId(rng.int(0, UINT32_MAX), now),
    seed: rng.int(0, UINT32_MAX),
    baseKey: base.key,
    slot,
    rarity: fluxClassOf(affixes),
    itemLevel: depth,
    name: "",
    implicit,
    affixes,
    foundDepth,
    foundAt: now,
    provenance: createEmptyProvenance(),
    margin,
    marginMax: margin,
    milestones: [],
    buds: [],
    budOffer: null,
  };
  item.name = nameItem(item);
  return item;
}

/** loadout の種類ごとに、全スロット共通で使う色配合を決める（seed でバリエーションを付ける） */
function colorsForLoadout(kind: ProfileKind, seed: number): readonly TraitColor[] {
  const base = seed % TRAIT_COLORS.length;
  switch (kind) {
    case "dominantLoadout":
      return [TRAIT_COLORS[base]!];
    case "dualLoadout":
      return [TRAIT_COLORS[base]!, TRAIT_COLORS[(base + 2) % TRAIT_COLORS.length]!];
    case "scatterLoadout":
      return [...TRAIT_COLORS];
    default:
      return [];
  }
}

function buildProfile(kind: ProfileKind, seed: number): Profile {
  const profile = createEmptyProfile();
  if (kind === "empty") return profile;

  // 決定的な専用 RNG。state.rng は消費しない
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const now = 1_700_000_000_000 + seed;

  if (kind === "rareLoadout" || kind === "uniqueLoadout") {
    const targetRarity: Rarity = kind === "rareLoadout" ? "rare" : "unique";
    for (const slot of LOOT_SLOTS) {
      profile.equipment[slot] = rollUntilRarity(rng, slot, targetRarity, 20, 1, now);
    }
    return profile;
  }

  const colors = colorsForLoadout(kind, seed);
  for (const slot of LOOT_SLOTS) {
    profile.equipment[slot] = buildColoredItem(rng, slot, colors, 20, 1, now);
  }
  return profile;
}

// ---------------------------------------------------------------------------
// QA 標準ビルドのスキル装備（docs/COMBAT_DESIGN.md B-7「QA bot の標準ビルド」）
// ---------------------------------------------------------------------------

/**
 * マナ型・近接（旋風斬り）/ マナ型・遠隔+状態異常付与（撃ち抜き）/ CD 型・近接（突進斬り）/
 * マナ型・遠隔範囲（グレネード）の 4 種で、資源タイプ（マナ / CD）と間合い（近接 / 遠隔）を
 * 両方カバーする。variants は空・links は 1 に固定し、刻印符・変異の乱数要素を増やさない
 * （bot の決定性・再現性を保つため。src/skills/persistence.ts の STARTER_STONES と同じ作り方）
 */
const QA_SKILL_LOADOUT: readonly { seed: number; skillKey: SkillStone["skillKey"] }[] = [
  { seed: 9001, skillKey: "whirl" },
  { seed: 9002, skillKey: "railshot" },
  { seed: 9003, skillKey: "lunge" },
  { seed: 9004, skillKey: "frag" },
];

function buildQaSkillProfile(): SkillProfile {
  const stones: SkillStone[] = QA_SKILL_LOADOUT.map(({ seed, skillKey }) => ({
    ...stoneFromSeed(seed, { foundDepth: 0, now: 0, skillKey }),
    variants: [],
    links: 1,
  }));
  return { version: 1, loadout: stones.map((s) => s.id), stones };
}

// ---------------------------------------------------------------------------
// スキル由来ダメージ・1 対 1 被弾・怯み・状態異常付与・マナ不足不発の計測（L6）
// combat.ts / statusEffects.ts は他レーンの持ち物なので書き換えず、エクスポート済み関数を
// vi.spyOn で素通し計測する（呼び出し元の挙動・戻り値は一切変えない）
// ---------------------------------------------------------------------------

interface SkillMetrics {
  /** damageEnemy で実際に enemy.hp が減った量の合計（防御・ブロックで 0 になった分は含まない） */
  totalDamageDealt: number;
  /** 上記のうち HitOptions.skill が true だったもの（docs/COMBAT_DESIGN.md B-7 の「スキル由来」） */
  skillDamageDealt: number;
  /** state.skills.manaFlash の立ち上がり回数（マナ不足の不発、src/system/skills.ts の misfire） */
  manaMisfires: number;
  /** applyStatus の kind === "stagger" が成功した回数（プレイヤー・敵の両方） */
  staggerCount: number;
  /** 上記の実際に付与された持続秒の合計（平均は staggerDurationTotal / staggerCount） */
  staggerDurationTotal: number;
  /** applyStatus が成功した回数（種類別、プレイヤー・敵の両方、E-2 の 13 種） */
  statusApplyCounts: Partial<Record<StatusKind, number>>;
  /** 交戦中の敵がちょうど 1 体だった秒数の合計（1 対 1 の分母） */
  oneVOneSeconds: number;
  /** そのうち damagePlayer が "hit"（無敵・ジャスト回避以外の実被弾）を返した回数 */
  oneVOneHits: number;
}

function emptySkillMetrics(): SkillMetrics {
  return {
    totalDamageDealt: 0,
    skillDamageDealt: 0,
    manaMisfires: 0,
    staggerCount: 0,
    staggerDurationTotal: 0,
    statusApplyCounts: {},
    oneVOneSeconds: 0,
    oneVOneHits: 0,
  };
}

/** bot.ts の NON_ENGAGEABLE_PHASES と同じ意図（idle / spawning は交戦相手に数えない） */
const NON_ENGAGEABLE: ReadonlySet<EnemyPhase> = new Set(["idle", "spawning"]);

function countEngagedEnemies(state: GameState): number {
  let n = 0;
  for (const e of state.enemies) if (e.hp > 0 && !NON_ENGAGEABLE.has(e.phase)) n++;
  return n;
}

/** 計測中のラン 1 本ぶんの集計先。runOnce がループの間だけ差し替える（null なら計測しない） */
let activeSkillMetrics: SkillMetrics | null = null;

/**
 * 攻撃ジャンル・属性・防御の効き（docs/COMBAT_DESIGN.md A-8）。elementCombat.ts は他レーンの
 * 持ち物なので書き換えず、outgoingElement を vi.spyOn で素通し計測する（combat.ts の
 * genreAndElement から呼ばれる、非 proc ヒット 1 回につき 1 回）
 */
interface GenreMetrics {
  /** outgoingElement が呼ばれた回数（＝敵に当たった非 proc ヒットの総数） */
  hits: number;
  weakHits: number;
  resistHits: number;
  neutralHits: number;
  /** quality === "physical" で敵の防御が正（軽減）だった回数・軽減%の合計 */
  physReduceSum: number;
  physReduceCount: number;
  /** quality === "physical" で敵の防御が負（弱点。CASTER 体型など）だった回数・増加%の合計 */
  physBoostSum: number;
  physBoostCount: number;
  /** 上記のうちボス級（isBossClass）に限った軽減%の合計・回数 */
  bossPhysReduceSum: number;
  bossPhysReduceCount: number;
  /** quality === "arcane" で敵の魔防が正（軽減）だった回数・軽減%の合計 */
  magicReduceSum: number;
  magicReduceCount: number;
  /** quality === "arcane" で敵の魔防が負（弱点。CASTER 体型など）だった回数・増加%の合計 */
  magicBoostSum: number;
  magicBoostCount: number;
}

function emptyGenreMetrics(): GenreMetrics {
  return {
    hits: 0,
    weakHits: 0,
    resistHits: 0,
    neutralHits: 0,
    physReduceSum: 0,
    physReduceCount: 0,
    physBoostSum: 0,
    physBoostCount: 0,
    bossPhysReduceSum: 0,
    bossPhysReduceCount: 0,
    magicReduceSum: 0,
    magicReduceCount: 0,
    magicBoostSum: 0,
    magicBoostCount: 0,
  };
}

/** 上と同じく runOnce がループの間だけ差し替える */
let activeGenreMetrics: GenreMetrics | null = null;

const originalOutgoingElement = elementCombatModule.outgoingElement;
vi.spyOn(elementCombatModule, "outgoingElement").mockImplementation((...args: Parameters<typeof originalOutgoingElement>) => {
  const [, enemy, atk] = args;
  const result = originalOutgoingElement(...args);
  const g = activeGenreMetrics;
  if (g) {
    g.hits++;
    if (result.affinity === "weak") g.weakHits++;
    else if (result.affinity === "resist") g.resistHits++;
    else g.neutralHits++;

    const quality = atk.genre.quality;
    if (quality === "physical" || quality === "arcane") {
      const defensePct = elementCombatModule.enemyDefenseFor(enemy, quality);
      const reduceSumKey = quality === "physical" ? "physReduceSum" : "magicReduceSum";
      const reduceCountKey = quality === "physical" ? "physReduceCount" : "magicReduceCount";
      const boostSumKey = quality === "physical" ? "physBoostSum" : "magicBoostSum";
      const boostCountKey = quality === "physical" ? "physBoostCount" : "magicBoostCount";
      if (defensePct >= 0) {
        g[reduceSumKey] += defensePct;
        g[reduceCountKey]++;
      } else {
        g[boostSumKey] += -defensePct;
        g[boostCountKey]++;
      }
      if (quality === "physical" && isBossClass(enemyDef(enemy.defKey)) && defensePct >= 0) {
        g.bossPhysReduceSum += defensePct;
        g.bossPhysReduceCount++;
      }
    }
  }
  return result;
});

interface DropMetrics {
  /** 撃破した damageEnemy の呼び出しの中で床に増えた遺物の数（エリートの追加抽選・祝福の上乗せを含む） */
  killDrops: number;
  /** 徘徊・増援（roomIndex = ROAMING_ROOM）を倒した回数 */
  roamingKills: number;
}

/** 上と同じく runOnce がループの間だけ差し替える */
let activeDropMetrics: DropMetrics | null = null;
/** 直近の step() 呼び出し時点で交戦中だった敵の数。damagePlayer のスパイが読む */
let engagedEnemyCountThisStep = 0;

const originalDamageEnemy = combat.damageEnemy;
vi.spyOn(combat, "damageEnemy").mockImplementation((...args: Parameters<typeof originalDamageEnemy>) => {
  const [state, enemy, , , , opts] = args;
  const before = Math.max(0, enemy.hp);
  const itemsBefore = state.floorItems.length;
  const killed = originalDamageEnemy(...args);
  if (killed && activeDropMetrics) {
    activeDropMetrics.killDrops += Math.max(0, state.floorItems.length - itemsBefore);
    if (enemy.roomIndex === ROAMING_ROOM) activeDropMetrics.roamingKills++;
  }
  const dealt = before - Math.max(0, enemy.hp);
  if (dealt > 0 && activeSkillMetrics) {
    activeSkillMetrics.totalDamageDealt += dealt;
    if (opts?.skill) activeSkillMetrics.skillDamageDealt += dealt;
  }
  return killed;
});

const originalDamagePlayer = combat.damagePlayer;
vi.spyOn(combat, "damagePlayer").mockImplementation((...args: Parameters<typeof originalDamagePlayer>) => {
  const result = originalDamagePlayer(...args);
  if (result === "hit" && activeSkillMetrics && engagedEnemyCountThisStep === 1) {
    activeSkillMetrics.oneVOneHits += 1;
  }
  return result;
});

const originalApplyStatus = statusEffectsModule.applyStatus;
vi.spyOn(statusEffectsModule, "applyStatus").mockImplementation((...args: Parameters<typeof originalApplyStatus>) => {
  const [state, target, apply] = args;
  const ok = originalApplyStatus(...args);
  if (ok && activeSkillMetrics) {
    activeSkillMetrics.statusApplyCounts[apply.kind] = (activeSkillMetrics.statusApplyCounts[apply.kind] ?? 0) + 1;
    if (apply.kind === "stagger") {
      const bag = target.kind === "enemy" ? target.enemy.status : state.player.status;
      const effect = bag.effects.find((e) => e.kind === "stagger");
      activeSkillMetrics.staggerCount += 1;
      activeSkillMetrics.staggerDurationTotal += effect?.maxTime ?? apply.duration;
    }
  }
  return ok;
});

// ---------------------------------------------------------------------------
// 祝福の芯・格・取得機会（docs/ideas/boon-power-up.md 5 節）
// ---------------------------------------------------------------------------

/** 3 択の提示の出どころ。闘技場と鏡は同じ「部屋の制圧の報酬」なのでまとめる */
const BOON_OFFER_SOURCES = ["stairs", "challenge", "arenaMirror", "curseShrine", "contract", "other"] as const;
type BoonOfferSource = (typeof BOON_OFFER_SOURCES)[number];
const BOON_OFFER_SOURCE_LABEL: Readonly<Record<BoonOfferSource, string>> = {
  stairs: "階段",
  challenge: "試練の部屋",
  arenaMirror: "闘技場・鏡",
  curseShrine: "呪いの祠",
  contract: "契約",
  other: "その他（流れ星・試練の徒など）",
};
/** 提示した札の格を見る深度帯（設計の目安: 2〜3 で神威 ≦ 5%、6 以上で大祝福 + 神威 ≧ 50%） */
const GRADE_BANDS = ["2-3", "4-5", "6+"] as const;
type GradeBand = (typeof GRADE_BANDS)[number];
const GRADE_BAND_MID_MIN = 4;
const GRADE_BAND_DEEP_MIN = 6;

function gradeBandOf(depth: number): GradeBand {
  if (depth >= GRADE_BAND_DEEP_MIN) return "6+";
  if (depth >= GRADE_BAND_MID_MIN) return "4-5";
  return "2-3";
}

function emptyGradeCounts(): Record<BoonGrade, number> {
  return { 1: 0, 2: 0, 3: 0 };
}

interface BoonMetrics {
  /** 開いた 3 択の数（出どころ別） */
  offers: Record<BoonOfferSource, number>;
  /** 提示した札のうち格の対象の札の格（深度帯別） */
  offeredGrades: Record<GradeBand, Record<BoonGrade, number>>;
  /** 取得した祝福の数（芯・呪い付きを含む全部） */
  taken: number;
  /** 取得した祝福のうち芯でないもの */
  takenNonCore: number;
  /** 取得した呪い付き（呪いの祠・呪いの 4 択・契約など） */
  takenCursed: number;
  /** 取得した格の対象の祝福の格 */
  takenGrades: Record<BoonGrade, number>;
  /** 取得した芯（無ければ null） */
  core: boonsModule.BoonKey | null;
}

function emptyBoonMetrics(): BoonMetrics {
  return {
    offers: { stairs: 0, challenge: 0, arenaMirror: 0, curseShrine: 0, contract: 0, other: 0 },
    offeredGrades: { "2-3": emptyGradeCounts(), "4-5": emptyGradeCounts(), "6+": emptyGradeCounts() },
    taken: 0,
    takenNonCore: 0,
    takenCursed: 0,
    takenGrades: emptyGradeCounts(),
    core: null,
  };
}

/** 上と同じく runOnce がループの間だけ差し替える */
let activeBoonMetrics: BoonMetrics | null = null;
/** clearSpecialRoom の最中の部屋の種類（offerBoons のスパイが出どころの判定に読む） */
let clearingRoomKind: string | null = null;

const originalClearSpecialRoom = specialRoomsModule.clearSpecialRoom;
vi.spyOn(specialRoomsModule, "clearSpecialRoom").mockImplementation((...args: Parameters<typeof originalClearSpecialRoom>) => {
  clearingRoomKind = args[1].kind;
  try {
    originalClearSpecialRoom(...args);
  } finally {
    clearingRoomKind = null;
  }
});

/**
 * 呼び出し元の関数名で出どころを分ける（system 側に計測用の引数を足さないため。QA だけの手段）。
 * 部屋の制圧は clearSpecialRoom のスパイが立てた部屋の種類で分ける
 */
function offerSourceOf(stack: string): BoonOfferSource {
  if (clearingRoomKind === "challenge") return "challenge";
  if (clearingRoomKind === "arena" || clearingRoomKind === "mirror") return "arenaMirror";
  if (stack.includes("checkStairs")) return "stairs";
  if (stack.includes("useCurseShrine")) return "curseShrine";
  if (stack.includes("payOwedBoons")) return "contract";
  return "other";
}

const originalOfferBoons = boonsModule.offerBoons;
vi.spyOn(boonsModule, "offerBoons").mockImplementation((...args: Parameters<typeof originalOfferBoons>) => {
  const [state] = args;
  const before = state.boonChoice;
  originalOfferBoons(...args);
  const b = activeBoonMetrics;
  const c = state.boonChoice;
  if (!b || !c || c === before) return;
  b.offers[offerSourceOf(new Error().stack ?? "")]++;
  const band = b.offeredGrades[gradeBandOf(state.depth)];
  c.options.forEach((key, i) => {
    const def = boonsModule.boonDef(key);
    if (def.core === true || !isGraded(def)) return;
    band[boonsModule.choiceGrade(c, i)]++;
  });
});

/** 前ステップから増えた祝福を数える（流れ星で手放して取り直した祝福も取得として数える） */
function recordTakenBoons(state: GameState, prev: ReadonlySet<boonsModule.BoonKey>, b: BoonMetrics): void {
  for (const key of state.boons) {
    if (prev.has(key)) continue;
    const def = boonsModule.boonDef(key);
    b.taken++;
    if (def.cursed) b.takenCursed++;
    if (def.core === true) {
      b.core = key;
      continue;
    }
    b.takenNonCore++;
    if (isGraded(def)) b.takenGrades[boonGradeOf(state, key)]++;
  }
}

/** 取得した格の最高（格の対象を 1 つも取っていなければ 0） */
function maxTakenGrade(b: BoonMetrics): number {
  return [...BOON_GRADES].reverse().find((g) => b.takenGrades[g] > 0) ?? 0;
}

// ---------------------------------------------------------------------------
// 1 回のランを実行して指標を集める
// ---------------------------------------------------------------------------

interface RunException {
  step: number;
  message: string;
  stack?: string;
}

interface RunMetrics {
  seed: number;
  profileKind: ProfileKind;
  keystones: string[];
  maxDepth: number;
  died: boolean;
  deathDepth: number | null;
  deathCause: string | null;
  kills: number;
  bestCombo: number;
  itemsPicked: number;
  rarityCounts: Record<Rarity, number>;
  reaperSpawns: number;
  bossEncounters: number;
  bossDefeats: number;
  depthSeconds: number[];
  avgStepMs: number;
  stepsRun: number;
  exceptions: RunException[];
  nanDetected: boolean;
  wallOverlapDetected: boolean;
  duplicateFloorItemId: boolean;
  /** ラン終了時点の装備全体の共鳴（狙った loadout 通りに発現したかの確認も兼ねる） */
  resonanceKind: ResonanceKind;
  resonanceColors: TraitColor[];
  /** ラン中に拾って stash に入った性質のうち、反転していたものの数 / 全体数 */
  invertedTraitCount: number;
  totalTraitCount: number;
  /** ラン中に提示され、bot が選んだ芽（pendingBud）の回数 */
  budsChosen: number;
  /** スキル由来与ダメ比率・1 対 1 被弾・怯み・状態異常付与・マナ不足不発（L6） */
  skill: SkillMetrics;
  /** ドロップの内訳（撃破あたりのドロップ率と、徘徊・増援が母数を増やしているかの確認） */
  drop: DropMetrics;
  /** 攻撃ジャンル・属性・防御の効き（A-8） */
  genre: GenreMetrics;
  /** ラン中に同時に phase === "strike" だった敵数の最大（ボス込みの総数。参考値） */
  maxConcurrentStrikers: number;
  /**
   * 上と同じだがボス（isBossDriven）を除いた数の最大。ゲームロジックの strikeSlotsFull と同じ基準なので、
   * ENEMY_AI.maxSimultaneousStrikers の上限超過はこちらで判定する
   */
  maxConcurrentNonBossStrikers: number;
  /** QA の観測の盲点（2026-09-24 追加）: 地形種別ごとにプレイヤーが踏み込んだ回数（前ステップと種類が変わった瞬間を数える） */
  terrainEnterCounts: Partial<Record<TerrainKind, number>>;
  /** 同上、煙（terrainAt とは別レイヤー）に入った回数 */
  smokeEnterCount: number;
  /** 精鋭修飾子ごとの出現数（elite / eliteExtra を敵の初出現時に 1 回だけ数える） */
  eliteSpawnCounts: Partial<Record<EliteKind, number>>;
  /** SYNERGY.maxEventsPerStep / maxPendingEvents で捨てられたイベントが増えた回数（＝上限到達したステップ数） */
  synergyEventCapHits: number;
  /** 祝福の芯・格・取得機会（docs/ideas/boon-power-up.md 5 節） */
  boon: BoonMetrics;
}

/** 同時に strike 中の敵数。total はボス込み、nonBoss は strikeSlotsFull（system/enemies.ts）と同じくボスを除く */
function countStrikers(enemies: readonly Enemy[]): { total: number; nonBoss: number } {
  let total = 0;
  let nonBoss = 0;
  for (const e of enemies) {
    if (e.hp <= 0 || e.phase !== "strike") continue;
    total++;
    if (!isBossDriven(enemyDef(e.defKey))) nonBoss++;
  }
  return { total, nonBoss };
}

function emptyRarityCounts(): Record<Rarity, number> {
  const out = {} as Record<Rarity, number>;
  for (const r of RARITIES) out[r] = 0;
  return out;
}

function isFiniteNum(n: number): boolean {
  return Number.isFinite(n);
}

/** state.player.body.pos / hp に NaN が無いか */
function hasNaN(state: GameState): boolean {
  const p = state.player;
  if (!isFiniteNum(p.body.pos.x) || !isFiniteNum(p.body.pos.y) || !isFiniteNum(p.hp)) return true;
  for (const e of state.enemies) {
    if (!isFiniteNum(e.body.pos.x) || !isFiniteNum(e.body.pos.y) || !isFiniteNum(e.hp)) return true;
  }
  return false;
}

/**
 * 敵の座標が壁（lockedTiles 込みの overlapsWall、system/physics.ts）の中に埋まっていないか。
 * 2026-09-23: 扉タイル判定の幾何を統一する修正（isSolidTile / lockRoom 側）が入ったため、
 * 以前ここで実際の壁タイルだけを見る overlapsRealWall に緩めていた判定を overlapsWall に戻して
 * 検証する（report.md 付録「ドアタイル上でロックされた敵」参照）。
 * wisp (data/enemies.ts の phasing: true) は仕様として壁をすり抜けて移動するので対象外にする。
 * 眠っている敵（system/enemies.ts の isAsleep）は自分では動かず、押し合いは壁で止まるので毎ステップは見ない
 * （広いマップで敵が多く、この検査がシミュレーションの時間を食うため。埋まったまま起きれば起きた後に捕まる）。
 */
function anyEnemyInWall(state: GameState): boolean {
  return state.enemies.some(
    (e) => !isAsleep(state, e) && !enemyDef(e.defKey).phasing && overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius),
  );
}

/** 壁にめり込んだ敵を 1 行ずつ出す（QA_DEBUG=1 のときだけ呼ぶ） */
function logWallEmbeds(state: GameState, step: number): void {
  for (const e of state.enemies) {
    const def = enemyDef(e.defKey);
    if (def.phasing || !overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    const pos = `(${e.body.pos.x.toFixed(1)},${e.body.pos.y.toFixed(1)})`;
    const status = JSON.stringify(e.status.effects.map((s) => s.kind));
    console.error(`[WALL_EMBED] step=${step} defKey=${e.defKey} behavior=${def.behavior} phase=${e.phase} pos=${pos} radius=${e.body.radius} status=${status}`);
  }
}

function hasDuplicateFloorItemId(state: GameState): boolean {
  const ids = new Set<number>();
  for (const fi of state.floorItems) {
    if (ids.has(fi.id)) return true;
    ids.add(fi.id);
  }
  return false;
}

/** 死因の推測: プレイヤーに最も近い敵の defKey。Reaper との接触があればそれを優先する */
function guessDeathCause(state: GameState): string {
  if (state.reaper) {
    const p = state.player.body.pos;
    const d = Math.hypot(state.reaper.pos.x - p.x, state.reaper.pos.y - p.y);
    if (d < state.reaper.radius + state.player.body.radius + 20) return "reaper";
  }
  let best: string | null = null;
  let bestDist = Infinity;
  const p = state.player.body.pos;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = e.defKey;
    }
  }
  return best ?? "unknown";
}

function runOnce(seed: number, profileKind: ProfileKind, maxSteps: number): RunMetrics {
  const profile = buildProfile(profileKind, seed);
  const state = createGame(seed, String(seed), profile, buildQaSkillProfile());
  const bot = createBotState((seed * 2654435761 + 12345) >>> 0);

  const metrics: RunMetrics = {
    seed,
    profileKind,
    keystones: [...state.stats.keystones],
    maxDepth: state.depth,
    died: false,
    deathDepth: null,
    deathCause: null,
    kills: 0,
    bestCombo: 0,
    itemsPicked: 0,
    rarityCounts: emptyRarityCounts(),
    reaperSpawns: 0,
    bossEncounters: 0,
    bossDefeats: 0,
    depthSeconds: [],
    avgStepMs: 0,
    stepsRun: 0,
    exceptions: [],
    nanDetected: false,
    wallOverlapDetected: false,
    duplicateFloorItemId: false,
    resonanceKind: state.stats.resonance.kind,
    resonanceColors: [...state.stats.resonance.colors],
    invertedTraitCount: 0,
    totalTraitCount: 0,
    budsChosen: 0,
    skill: emptySkillMetrics(),
    drop: { killDrops: 0, roamingKills: 0 },
    genre: emptyGenreMetrics(),
    maxConcurrentStrikers: 0,
    maxConcurrentNonBossStrikers: 0,
    terrainEnterCounts: {},
    smokeEnterCount: 0,
    eliteSpawnCounts: {},
    synergyEventCapHits: 0,
    boon: emptyBoonMetrics(),
  };

  let depthEnterTime = state.time;
  let currentDepth = state.depth;
  let sawReaperThisFloor = false;
  let sawBossThisFloor = false;
  let sawBossDefeatThisFloor = false;
  let stepTimeTotal = 0;
  let prevManaFlash = state.skills.manaFlash;
  let prevTerrain: TerrainKind = "none";
  let prevSmoke = false;
  let prevDroppedEvents = state.ruleRun.droppedEvents;
  const seenEliteIds = new Set<number>();

  // このランの間だけ、上のスパイが metrics.skill に書き込むようにする（他ランと混ざらないよう
  // 抜けたら必ず null に戻す。runOnce は例外を catch して抜けるだけで投げ直さないので try/finally は不要）
  activeSkillMetrics = metrics.skill;
  activeDropMetrics = metrics.drop;
  activeGenreMetrics = metrics.genre;
  activeBoonMetrics = metrics.boon;
  let prevBoons = new Set(state.boons);

  for (let i = 0; i < maxSteps; i++) {
    if (state.status !== "playing") break;

    // 芽（state.pendingBud）は boonChoice と違い step を止めない仕様なので、出た瞬間に
    // 1 枚目を選んで進める（人間のプレイに寄せる。無視しても進行は止まらないが、選ばないと
    // 余白・節目の実際の消化ペースが計測できない）
    if (state.pendingBud) {
      chooseBud(state, 0);
      metrics.budsChosen++;
    }

    let input;
    try {
      input = botInput(state, bot, FIXED_DT);
    } catch (err) {
      metrics.exceptions.push(toRunException(i, err));
      break;
    }

    // damagePlayer のスパイが読む「この step 時点の交戦相手数」。1 対 1 判定は step() 前の
    // スナップショットで揃える（step 中に敵が倒れて 0 体になっても、その 1 撃は 1 対 1 中の被弾として数える）
    engagedEnemyCountThisStep = countEngagedEnemies(state);
    const oneVOne = engagedEnemyCountThisStep === 1;

    const t0 = performance.now();
    try {
      step(state, input, FIXED_DT);
    } catch (err) {
      metrics.exceptions.push(toRunException(i, err));
      break;
    }
    stepTimeTotal += performance.now() - t0;
    metrics.stepsRun++;

    if (oneVOne) metrics.skill.oneVOneSeconds += FIXED_DT;
    // マナ不足の不発（src/system/skills.ts の misfire）: manaFlash が 0 から立ち上がった瞬間を数える
    if (state.skills.manaFlash > 0 && prevManaFlash <= 0) metrics.skill.manaMisfires++;
    prevManaFlash = state.skills.manaFlash;

    const striking = countStrikers(state.enemies);
    metrics.maxConcurrentStrikers = Math.max(metrics.maxConcurrentStrikers, striking.total);
    metrics.maxConcurrentNonBossStrikers = Math.max(metrics.maxConcurrentNonBossStrikers, striking.nonBoss);

    // QA の観測の盲点（2026-09-24 追加）: 地形踏み込み・煙・精鋭出現・SYNERGY イベント上限到達
    const playerPos = state.player.body.pos;
    const terrain = terrainAt(state, playerPos.x, playerPos.y);
    if (terrain !== prevTerrain) {
      metrics.terrainEnterCounts[terrain] = (metrics.terrainEnterCounts[terrain] ?? 0) + 1;
      prevTerrain = terrain;
    }
    const smoke = smokeAt(state, playerPos.x, playerPos.y);
    if (smoke && !prevSmoke) metrics.smokeEnterCount++;
    prevSmoke = smoke;
    for (const e of state.enemies) {
      if (!e.elite || seenEliteIds.has(e.id)) continue;
      seenEliteIds.add(e.id);
      metrics.eliteSpawnCounts[e.elite] = (metrics.eliteSpawnCounts[e.elite] ?? 0) + 1;
      if (e.eliteExtra) metrics.eliteSpawnCounts[e.eliteExtra] = (metrics.eliteSpawnCounts[e.eliteExtra] ?? 0) + 1;
    }
    if (state.boons.length !== prevBoons.size || state.boons.some((k) => !prevBoons.has(k))) {
      recordTakenBoons(state, prevBoons, metrics.boon);
      prevBoons = new Set(state.boons);
    }
    if (state.ruleRun.droppedEvents !== prevDroppedEvents) {
      metrics.synergyEventCapHits++;
      prevDroppedEvents = state.ruleRun.droppedEvents;
    }

    if (!metrics.nanDetected && hasNaN(state)) metrics.nanDetected = true;
    if (!metrics.wallOverlapDetected && anyEnemyInWall(state)) {
      metrics.wallOverlapDetected = true;
      // めり込んだ敵の詳細は調査のときだけ出す（QA_DEBUG=1）。通常の実行ではログを汚さない
      if (process.env.QA_DEBUG) logWallEmbeds(state, i);
    }
    if (!metrics.duplicateFloorItemId && hasDuplicateFloorItemId(state)) metrics.duplicateFloorItemId = true;

    if (state.reaper && !sawReaperThisFloor) {
      metrics.reaperSpawns++;
      sawReaperThisFloor = true;
    }
    if (state.boss && !sawBossThisFloor) {
      metrics.bossEncounters++;
      sawBossThisFloor = true;
    }
    if (state.boss?.defeated && !sawBossDefeatThisFloor) {
      metrics.bossDefeats++;
      sawBossDefeatThisFloor = true;
    }

    if (state.depth !== currentDepth) {
      metrics.depthSeconds[currentDepth] = (metrics.depthSeconds[currentDepth] ?? 0) + (state.time - depthEnterTime);
      depthEnterTime = state.time;
      currentDepth = state.depth;
      sawReaperThisFloor = false;
      sawBossThisFloor = false;
      sawBossDefeatThisFloor = false;
    }

    metrics.maxDepth = Math.max(metrics.maxDepth, state.depth);

    // ループ先頭の `state.status !== "playing"` 判定により、TS はここでも status を
    // "playing" 単独の型に絞り込んでしまう（step() 内での書き換えを追えないため）。
    // as GameStatus で明示的に元の union に戻して比較する
    if ((state.status as GameStatus) === "dead" && !metrics.died) {
      metrics.died = true;
      metrics.deathDepth = state.depth;
      metrics.deathCause = guessDeathCause(state);
    }
  }

  metrics.depthSeconds[currentDepth] = (metrics.depthSeconds[currentDepth] ?? 0) + (state.time - depthEnterTime);
  metrics.kills = state.kills;
  metrics.bestCombo = state.combo.best;
  metrics.itemsPicked = profile.stash.length;
  for (const item of profile.stash) {
    metrics.rarityCounts[item.rarity]++;
    for (const affix of item.affixes) {
      metrics.totalTraitCount++;
      if (affix.inverted) metrics.invertedTraitCount++;
    }
  }
  metrics.avgStepMs = metrics.stepsRun > 0 ? stepTimeTotal / metrics.stepsRun : 0;
  // ラン終了時点（装備は固定なので初期値と基本一致するが、念のため最新化する）
  metrics.resonanceKind = state.stats.resonance.kind;
  metrics.resonanceColors = [...state.stats.resonance.colors];

  activeSkillMetrics = null;
  activeDropMetrics = null;
  activeGenreMetrics = null;
  activeBoonMetrics = null;
  return metrics;
}

function toRunException(step: number, err: unknown): RunException {
  if (err instanceof Error) return { step, message: err.message, stack: err.stack };
  return { step, message: String(err) };
}

// ---------------------------------------------------------------------------
// 縮小版（既定の CI 用スモーク）
// ---------------------------------------------------------------------------

describe("QA simulation (縮小版スモーク)", () => {
  it(
    `${FAST_SEED_COUNT} seed × ${FAST_MAX_STEPS} ステップで例外・NaN・壁めり込み・id重複が無い`,
    () => {
      const all: RunMetrics[] = [];
      for (let i = 0; i < FAST_SEED_COUNT; i++) {
        const seed = 10_000 + i;
        const profileKind = PROFILE_KINDS[i % PROFILE_KINDS.length]!;
        const metrics = runOnce(seed, profileKind, FAST_MAX_STEPS);
        all.push(metrics);

        expect(
          metrics.exceptions,
          `seed=${seed} profile=${profileKind} で例外: ${metrics.exceptions.map((e) => `step${e.step}: ${e.message}`).join(" / ")}`,
        ).toHaveLength(0);
        expect(metrics.nanDetected, `seed=${seed} profile=${profileKind} で NaN 混入`).toBe(false);
        expect(metrics.wallOverlapDetected, `seed=${seed} profile=${profileKind} で敵が壁にめり込んだ`).toBe(false);
        expect(metrics.duplicateFloorItemId, `seed=${seed} profile=${profileKind} で floorItems の id が重複した`).toBe(false);
        expect(metrics.boon.takenNonCore, `seed=${seed} 芯を除く取得数は全体以下`).toBeLessThanOrEqual(metrics.boon.taken);
      }
      // 祝福の計測だけを見たいとき（QA_DEBUG=1）に縮小版でも表を出す
      if (process.env.QA_DEBUG) console.log(buildBoonMetricsSection(all).join("\n"));
    },
    // 毎階の「階の主」で 1 階の戦いが重くなった分、既定の 30s から広げる
    60_000,
  );
});

// ---------------------------------------------------------------------------
// 決定性スモーク（src/core/game.test.ts と同じ fingerprint 方式）
// ---------------------------------------------------------------------------

/** リプレイ検証用のざっくりしたハッシュ（src/core/game.test.ts の fingerprint と同型） */
function fingerprintState(state: GameState): string {
  const p = state.player.body.pos;
  return [
    state.tick,
    p.x.toFixed(3),
    p.y.toFixed(3),
    state.player.hp,
    state.depth,
    state.enemies.length,
    state.enemies.map((e) => `${e.id}:${e.hp}:${e.body.pos.x.toFixed(2)}`).join(","),
    state.score,
    // Date.now 由来の id / foundAt は比較しない
    state.floorItems.map((fi) => `${fi.item.seed}:${fi.item.rarity}:${fi.pos.x.toFixed(2)}`).join(","),
  ].join("|");
}

/** bot 駆動で 1 ラン回して最終状態の fingerprint を返す（runOnce と同じ手順の軽量版） */
function runOnceFingerprint(seed: number, profileKind: ProfileKind, maxSteps: number): string {
  const profile = buildProfile(profileKind, seed);
  const state = createGame(seed, String(seed), profile, buildQaSkillProfile());
  const bot = createBotState((seed * 2654435761 + 12345) >>> 0);
  for (let i = 0; i < maxSteps; i++) {
    if (state.status !== "playing") break;
    if (state.pendingBud) chooseBud(state, 0);
    const input = botInput(state, bot, FIXED_DT);
    step(state, input, FIXED_DT);
  }
  return fingerprintState(state);
}

/** 6 装備 × 2 回 × 4,000 step。毎階の「階の主」で 1 階の戦いが重くなった分、余裕を広げた */
const DETERMINISM_TIMEOUT_MS = 60_000;

describe("QA simulation (決定性)", () => {
  it("同じ seed・装備なら bot 駆動でも 2 回とも同じ結果になる", { timeout: DETERMINISM_TIMEOUT_MS }, () => {
    for (const profileKind of PROFILE_KINDS) {
      const seed = 30_000;
      const a = runOnceFingerprint(seed, profileKind, 4_000);
      const b = runOnceFingerprint(seed, profileKind, 4_000);
      expect(a, `profile=${profileKind} で 2 回の実行結果が一致しない`).toBe(b);
    }
  });
});

// ---------------------------------------------------------------------------
// フル版（SIM_FULL=1 のときだけ）。report.md を書き出す
// ---------------------------------------------------------------------------

function percent(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "-";
}

function average(nums: readonly number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function buildReport(allMetrics: readonly RunMetrics[]): string {
  const lines: string[] = [];
  lines.push("# QA シミュレーション結果");
  lines.push("");
  lines.push(`生成: ${new Date().toISOString()} / ${allMetrics.length} runs (${FULL_SEED_COUNT} seed × ${PROFILE_KINDS.length} 装備パターン × ${FULL_MAX_STEPS} ステップ)`);
  lines.push("");

  const exceptions = allMetrics.flatMap((m) => m.exceptions.map((e) => ({ ...e, seed: m.seed, profileKind: m.profileKind })));

  lines.push("## 例外");
  lines.push("");
  if (exceptions.length === 0) {
    lines.push("例外は発生しなかった。");
  } else {
    lines.push("| seed | profile | step | message |");
    lines.push("| --- | --- | --- | --- |");
    for (const e of exceptions) {
      lines.push(`| ${e.seed} | ${e.profileKind} | ${e.step} | ${e.message.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
    lines.push("<details><summary>スタックトレース</summary>");
    lines.push("");
    for (const e of exceptions) {
      lines.push(`### seed=${e.seed} profile=${e.profileKind} step=${e.step}`);
      lines.push("```");
      lines.push(e.stack ?? e.message);
      lines.push("```");
    }
    lines.push("</details>");
  }
  lines.push("");

  const invariantFails = allMetrics.filter((m) => m.nanDetected || m.wallOverlapDetected || m.duplicateFloorItemId);
  lines.push("## 不変条件違反（NaN / 壁めり込み / id 重複）");
  lines.push("");
  if (invariantFails.length === 0) {
    lines.push("違反なし。");
  } else {
    lines.push("| seed | profile | NaN | 壁めり込み | id重複 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const m of invariantFails) {
      lines.push(`| ${m.seed} | ${m.profileKind} | ${m.nanDetected} | ${m.wallOverlapDetected} | ${m.duplicateFloorItemId} |`);
    }
  }
  lines.push("");

  lines.push("## 指標サマリ（装備パターン別）");
  lines.push("");
  lines.push("| 装備 | 平均到達depth | 死亡率 | 平均kills | 平均best combo | 平均拾得数 | Reaper出現/run | ボス撃破率 | 平均step時間(ms) |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const kind of PROFILE_KINDS) {
    const group = allMetrics.filter((m) => m.profileKind === kind);
    const died = group.filter((m) => m.died).length;
    const bossSeen = group.reduce((s, m) => s + m.bossEncounters, 0);
    const bossWon = group.reduce((s, m) => s + m.bossDefeats, 0);
    lines.push(
      `| ${kind} | ${average(group.map((m) => m.maxDepth)).toFixed(2)} | ${percent(died, group.length)} | ` +
        `${average(group.map((m) => m.kills)).toFixed(1)} | ${average(group.map((m) => m.bestCombo)).toFixed(1)} | ` +
        `${average(group.map((m) => m.itemsPicked)).toFixed(1)} | ${average(group.map((m) => m.reaperSpawns)).toFixed(2)} | ` +
        `${percent(bossWon, bossSeen)} | ${average(group.map((m) => m.avgStepMs)).toFixed(3)} |`,
    );
  }
  lines.push("");

  lines.push("## ドロップの内訳（装備パターン別。撃破起因 = 倒した一撃の中で床に増えた遺物）");
  lines.push("");
  lines.push("| 装備 | 平均拾得数 | 平均kills | 撃破起因の落下/run | 撃破あたりの落下 | 徘徊・増援の撃破割合 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const kind of PROFILE_KINDS) {
    const group = allMetrics.filter((m) => m.profileKind === kind);
    const kills = group.reduce((s, m) => s + m.kills, 0);
    const killDrops = group.reduce((s, m) => s + m.drop.killDrops, 0);
    const roaming = group.reduce((s, m) => s + m.drop.roamingKills, 0);
    lines.push(
      `| ${kind} | ${average(group.map((m) => m.itemsPicked)).toFixed(1)} | ${average(group.map((m) => m.kills)).toFixed(1)} | ` +
        `${average(group.map((m) => m.drop.killDrops)).toFixed(1)} | ${percent(killDrops, kills)} | ${percent(roaming, kills)} |`,
    );
  }
  lines.push("");

  lines.push("## 共鳴別の到達depth（dominant/dualLoadout は狙った色、装備が固定なので発現共鳴はほぼ固定）");
  lines.push("");
  lines.push("| 共鳴 | n | 平均到達depth | 死亡率 |");
  lines.push("| --- | --- | --- | --- |");
  const resonanceKinds: readonly ResonanceKind[] = ["dominant", "dual", "scatter", "none"];
  for (const kind of resonanceKinds) {
    const group = allMetrics.filter((m) => m.resonanceKind === kind);
    if (group.length === 0) continue;
    lines.push(
      `| ${kind} | ${group.length} | ${average(group.map((m) => m.maxDepth)).toFixed(2)} | ${percent(group.filter((m) => m.died).length, group.length)} |`,
    );
  }
  lines.push("");

  lines.push("## 反転性質の出現率（ラン中に stash に拾った性質のみ。装備パターン別）");
  lines.push("");
  lines.push("| 装備 | 反転数 | 性質総数 | 反転率 |");
  lines.push("| --- | --- | --- | --- |");
  for (const kind of PROFILE_KINDS) {
    const group = allMetrics.filter((m) => m.profileKind === kind);
    const inverted = group.reduce((s, m) => s + m.invertedTraitCount, 0);
    const total = group.reduce((s, m) => s + m.totalTraitCount, 0);
    lines.push(`| ${kind} | ${inverted} | ${total} | ${percent(inverted, total)} |`);
  }
  const totalInverted = allMetrics.reduce((s, m) => s + m.invertedTraitCount, 0);
  const totalTraits = allMetrics.reduce((s, m) => s + m.totalTraitCount, 0);
  lines.push("");
  lines.push(
    `全体: ${totalInverted} / ${totalTraits}（${percent(totalInverted, totalTraits)}）。反転は発見深度 ${13}（\`INVERSION_MIN_DEPTH\`, src/loot/flux.ts）以降でしか起きないため、bot の到達 depth が浅いランでは観測されにくい。`,
  );
  lines.push("");

  lines.push("## 芽（pendingBud）の出現・選択回数");
  lines.push("");
  const totalBuds = allMetrics.reduce((s, m) => s + m.budsChosen, 0);
  lines.push(`合計 ${totalBuds} 回（${allMetrics.length} run 中、平均 ${average(allMetrics.map((m) => m.budsChosen)).toFixed(2)} 回/run）。bot は出た瞬間に 1 枚目を選ぶ。`);
  lines.push("");
  lines.push("| 装備 | 平均出現回数/run |");
  lines.push("| --- | --- |");
  for (const kind of PROFILE_KINDS) {
    const group = allMetrics.filter((m) => m.profileKind === kind);
    lines.push(`| ${kind} | ${average(group.map((m) => m.budsChosen)).toFixed(2)} |`);
  }
  lines.push("");

  lines.push("## キーストーンあり / なしの生存差（到達depth）");
  lines.push("");
  const withKs = allMetrics.filter((m) => m.keystones.length > 0);
  const withoutKs = allMetrics.filter((m) => m.keystones.length === 0);
  lines.push(`- キーストーンあり (n=${withKs.length}): 平均到達depth ${average(withKs.map((m) => m.maxDepth)).toFixed(2)} / 死亡率 ${percent(withKs.filter((m) => m.died).length, withKs.length)}`);
  lines.push(`- キーストーンなし (n=${withoutKs.length}): 平均到達depth ${average(withoutKs.map((m) => m.maxDepth)).toFixed(2)} / 死亡率 ${percent(withoutKs.filter((m) => m.died).length, withoutKs.length)}`);
  lines.push("");

  lines.push("## 死因トップ（depth 別・出現数）");
  lines.push("");
  const deaths = allMetrics.filter((m) => m.died && m.deathDepth !== null);
  const causeCounts = new Map<string, number>();
  for (const m of deaths) {
    const key = `${m.deathCause ?? "unknown"} (depth ${m.deathDepth})`;
    causeCounts.set(key, (causeCounts.get(key) ?? 0) + 1);
  }
  const topCauses = [...causeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topCauses.length === 0) {
    lines.push("死亡した run が無かった。");
  } else {
    lines.push("| 死因 (depth) | 件数 |");
    lines.push("| --- | --- |");
    for (const [key, count] of topCauses) lines.push(`| ${key} | ${count} |`);
  }
  lines.push("");

  lines.push("## depth ごとの平均滞在秒（全 run 平均、到達した run のみ）");
  lines.push("");
  const maxDepthSeen = Math.max(1, ...allMetrics.map((m) => m.depthSeconds.length - 1));
  lines.push("| depth | 平均滞在秒 | 到達run数 |");
  lines.push("| --- | --- | --- |");
  for (let d = 1; d <= maxDepthSeen; d++) {
    const values = allMetrics.map((m) => m.depthSeconds[d]).filter((v): v is number => v !== undefined);
    if (values.length === 0) continue;
    lines.push(`| ${d} | ${average(values).toFixed(1)} | ${values.length} |`);
  }
  lines.push("");

  lines.push("## レアリティ分布（拾得アイテム、全 run 合計）");
  lines.push("");
  const rarityTotals = emptyRarityCounts();
  for (const m of allMetrics) for (const r of RARITIES) rarityTotals[r] += m.rarityCounts[r];
  lines.push("| rarity | 個数 | 割合 |");
  lines.push("| --- | --- | --- |");
  const rarityTotalAll = RARITIES.reduce((s, r) => s + rarityTotals[r], 0);
  for (const r of RARITIES) lines.push(`| ${r} | ${rarityTotals[r]} | ${percent(rarityTotals[r], rarityTotalAll)} |`);
  lines.push("");

  lines.push(...buildSkillMetricsSection(allMetrics));
  lines.push(...buildGenreMetricsSection(allMetrics));
  lines.push(...buildObservationGapsSection(allMetrics));
  lines.push(...buildBoonMetricsSection(allMetrics));

  lines.push("## バランス所見");
  lines.push("");
  lines.push(buildBalanceNotes(allMetrics));
  lines.push("");

  lines.push("## 提案");
  lines.push("");
  lines.push(buildSuggestions(allMetrics));
  lines.push("");

  return lines.join("\n");
}


/**
 * L6 の計測項目（docs/COMBAT_DESIGN.md B-7 / C-2 / F-2 L6 行）。
 * 全 run 合計（装備パターンをまたいで集計。QA_SKILL_LOADOUT はパターンによらず固定のため）
 */
function buildSkillMetricsSection(allMetrics: readonly RunMetrics[]): string[] {
  const lines: string[] = [];
  lines.push("## スキル/怯み/状態異常/1 対 1 被弾（L6、QA 標準ビルド: 旋風斬り・撃ち抜き・突進斬り・グレネード）");
  lines.push("");

  const totalDamage = allMetrics.reduce((s, m) => s + m.skill.totalDamageDealt, 0);
  const skillDamage = allMetrics.reduce((s, m) => s + m.skill.skillDamageDealt, 0);
  const skillDamageRatio = totalDamage > 0 ? skillDamage / totalDamage : 0;
  lines.push(
    `- **スキル由来の与ダメ比率**: ${percent(skillDamage, totalDamage)}（目標 55〜65%、B-7）。総与ダメ ${totalDamage.toLocaleString()} のうちスキル ${skillDamage.toLocaleString()}。` +
      (skillDamageRatio < 0.55 ? "目標未満: スキルの威力かマナ回収を強める必要がある。" : skillDamageRatio > 0.65 ? "目標超過: 通常攻撃・射撃が空気になっている。" : "目標範囲内。"),
  );

  const oneVOneSeconds = allMetrics.reduce((s, m) => s + m.skill.oneVOneSeconds, 0);
  const oneVOneHits = allMetrics.reduce((s, m) => s + m.skill.oneVOneHits, 0);
  const oneVOnePer60s = oneVOneSeconds > 0 ? (oneVOneHits / oneVOneSeconds) * 60 : 0;
  lines.push(
    `- **1 対 1 の被弾数（60 秒あたり）**: ${oneVOnePer60s.toFixed(2)} 回（目標 1〜3 回、C-2）。1 対 1 の合計時間 ${(oneVOneSeconds / 60).toFixed(1)} 分中 ${oneVOneHits} 回被弾。`,
  );

  const manaMisfiresTotal = allMetrics.reduce((s, m) => s + m.skill.manaMisfires, 0);
  lines.push(`- **マナ不足の不発回数**: 合計 ${manaMisfiresTotal} 回（平均 ${average(allMetrics.map((m) => m.skill.manaMisfires)).toFixed(2)} 回/run）。`);

  const staggerCount = allMetrics.reduce((s, m) => s + m.skill.staggerCount, 0);
  const staggerDurationTotal = allMetrics.reduce((s, m) => s + m.skill.staggerDurationTotal, 0);
  lines.push(
    `- **怯み発生回数と平均持続**: 合計 ${staggerCount} 回（平均 ${average(allMetrics.map((m) => m.skill.staggerCount)).toFixed(2)} 回/run）、平均持続 ${staggerCount > 0 ? (staggerDurationTotal / staggerCount).toFixed(2) : "-"} 秒。`,
  );
  lines.push("");

  lines.push("### 深度別到達率（1〜3 が C-2 の目標対象。maxDepth ≥ n の run 割合）");
  lines.push("");
  lines.push("| depth | 到達率 | 到達run数 |");
  lines.push("| --- | --- | --- |");
  const maxDepthForRate = Math.min(10, Math.max(1, ...allMetrics.map((m) => m.maxDepth)));
  for (let d = 1; d <= maxDepthForRate; d++) {
    const reached = allMetrics.filter((m) => m.maxDepth >= d).length;
    lines.push(`| ${d} | ${percent(reached, allMetrics.length)} | ${reached} |`);
  }
  lines.push("");

  lines.push("### 状態異常の付与回数（種類別、プレイヤー・敵の両方、applyStatus 成功ベース）");
  lines.push("");
  lines.push("| 種類 | 回数 |");
  lines.push("| --- | --- |");
  for (const kind of STATUS_KINDS) {
    const count = allMetrics.reduce((s, m) => s + (m.skill.statusApplyCounts[kind] ?? 0), 0);
    lines.push(`| ${STATUS_LABEL[kind]} (${kind}) | ${count} |`);
  }
  lines.push("");

  return lines;
}

/**
 * 攻撃ジャンル・属性・防御の効き（A-8）。全 run 合計で、プレイヤー→敵の非 proc ヒットのうち
 * 弱点/耐性になった割合と、物理/魔法それぞれで敵の防御・魔防による軽減%・増加%の平均を出す。
 * 設計目標（docs/COMBAT_DESIGN.md A-8）: 物理はボスへ 15〜35% 減、魔法は術者（CASTER 体型）へ 10〜20% 増。
 */
function buildGenreMetricsSection(allMetrics: readonly RunMetrics[]): string[] {
  const lines: string[] = [];
  lines.push("## 攻撃ジャンル・属性・防御の効き（A-8）");
  lines.push("");

  const totalHits = allMetrics.reduce((s, m) => s + m.genre.hits, 0);
  const weakHits = allMetrics.reduce((s, m) => s + m.genre.weakHits, 0);
  const resistHits = allMetrics.reduce((s, m) => s + m.genre.resistHits, 0);
  lines.push(
    `- **弱点 / 耐性ヒットの発生割合**: 弱点 ${percent(weakHits, totalHits)}（${weakHits} 件）/ 耐性 ${percent(resistHits, totalHits)}（${resistHits} 件）/ 総ヒット ${totalHits.toLocaleString()} 件（プレイヤー→敵の非 proc ヒットのみ）。`,
  );

  const physReduceSum = allMetrics.reduce((s, m) => s + m.genre.physReduceSum, 0);
  const physReduceCount = allMetrics.reduce((s, m) => s + m.genre.physReduceCount, 0);
  const physBoostSum = allMetrics.reduce((s, m) => s + m.genre.physBoostSum, 0);
  const physBoostCount = allMetrics.reduce((s, m) => s + m.genre.physBoostCount, 0);
  lines.push(
    `- **物理攻撃が受ける敵の防御**: 軽減側の平均 ${physReduceCount > 0 ? (physReduceSum / physReduceCount).toFixed(1) : "-"}%（n=${physReduceCount}）/ 弱点側（CASTER 体型など、防御が負）の平均増加 ${physBoostCount > 0 ? (physBoostSum / physBoostCount).toFixed(1) : "-"}%（n=${physBoostCount}）。`,
  );

  const bossPhysReduceSum = allMetrics.reduce((s, m) => s + m.genre.bossPhysReduceSum, 0);
  const bossPhysReduceCount = allMetrics.reduce((s, m) => s + m.genre.bossPhysReduceCount, 0);
  const bossPhysAvg = bossPhysReduceCount > 0 ? bossPhysReduceSum / bossPhysReduceCount : null;
  lines.push(
    `- **物理攻撃がボス級に受ける軽減（目標 15〜35%）**: 平均 ${bossPhysAvg !== null ? bossPhysAvg.toFixed(1) : "-"}%（n=${bossPhysReduceCount}）。` +
      (bossPhysAvg === null ? "ボス級への物理ヒットが観測されなかった。" : bossPhysAvg < 15 ? "目標未満: ボスが硬くなりすぎている可能性。" : bossPhysAvg > 35 ? "目標超過: ボスが柔らかすぎる可能性。" : "目標範囲内。"),
  );

  const magicReduceSum = allMetrics.reduce((s, m) => s + m.genre.magicReduceSum, 0);
  const magicReduceCount = allMetrics.reduce((s, m) => s + m.genre.magicReduceCount, 0);
  const magicBoostSum = allMetrics.reduce((s, m) => s + m.genre.magicBoostSum, 0);
  const magicBoostCount = allMetrics.reduce((s, m) => s + m.genre.magicBoostCount, 0);
  const magicBoostAvg = magicBoostCount > 0 ? magicBoostSum / magicBoostCount : null;
  lines.push(
    `- **魔法攻撃が術者（魔防が負）へ与える増加（目標 10〜20%）**: 平均 ${magicBoostAvg !== null ? magicBoostAvg.toFixed(1) : "-"}%（n=${magicBoostCount}）/ 軽減側の平均 ${magicReduceCount > 0 ? (magicReduceSum / magicReduceCount).toFixed(1) : "-"}%（n=${magicReduceCount}）。` +
      (magicBoostAvg === null ? " 術者への魔法ヒットが観測されなかった（QA 標準ビルドが物理武器主体のため。武器種を変えたビルドを別途 QA する必要がある）。" : magicBoostAvg < 10 ? " 目標未満。" : magicBoostAvg > 20 ? " 目標超過。" : " 目標範囲内。"),
  );
  lines.push("");

  lines.push(...strikerReportLines(allMetrics));
  lines.push("");

  return lines;
}

/**
 * QA の観測の盲点（2026-09-24 追加、report.md 調査メモ「QA の観測の盲点」対応）。
 * 地形（泥・煙）・精鋭修飾子・SYNERGY イベント上限到達を、QA 標準ビルド固定の装備パターンでどれだけ観測できているか出す。
 * 0 件のものは「QA の装備パターン/loadout がその経路を踏まない」ことの傍証で、実装が無いことの証明ではない。
 */
function buildObservationGapsSection(allMetrics: readonly RunMetrics[]): string[] {
  const lines: string[] = [];
  lines.push("## QA の観測の盲点（地形・精鋭・SYNERGY イベント上限）");
  lines.push("");

  lines.push("### 地形種別ごとの踏み込み回数（プレイヤー、前ステップと種類が変わった瞬間を計上）");
  lines.push("");
  lines.push("| 地形 | 回数 |");
  lines.push("| --- | --- |");
  for (const kind of TERRAIN_KINDS) {
    if (kind === "none" || kind === "smoke") continue;
    const count = allMetrics.reduce((s, m) => s + (m.terrainEnterCounts[kind] ?? 0), 0);
    lines.push(`| ${TERRAIN_LABEL[kind]} (${kind}) | ${count} |`);
  }
  const smokeTotal = allMetrics.reduce((s, m) => s + m.smokeEnterCount, 0);
  lines.push(`| 煙 (smoke、terrainAt とは別レイヤー) | ${smokeTotal} |`);
  lines.push("");

  lines.push("### 精鋭修飾子の出現数（種類別、elite / eliteExtra を敵の初出現時に計上）");
  lines.push("");
  lines.push("| 精鋭 | 出現数 |");
  lines.push("| --- | --- |");
  let eliteTotal = 0;
  for (const kind of ELITE_KINDS) {
    const count = allMetrics.reduce((s, m) => s + (m.eliteSpawnCounts[kind] ?? 0), 0);
    eliteTotal += count;
    lines.push(`| ${ELITE_PREFIX[kind]} (${kind}) | ${count} |`);
  }
  lines.push("");
  const zeroElites = ELITE_KINDS.filter((k) => allMetrics.every((m) => (m.eliteSpawnCounts[k] ?? 0) === 0));
  lines.push(
    `合計 ${eliteTotal} 体。0 件だった精鋭: ${zeroElites.length === 0 ? "無し" : zeroElites.map((k) => `${ELITE_PREFIX[k]}(${k})`).join("、")}。`,
  );
  lines.push("");

  const zeroStatus = STATUS_KINDS.filter((k) => allMetrics.every((m) => (m.skill.statusApplyCounts[k] ?? 0) === 0));
  lines.push(
    `### 状態異常で 0 件だった種類（全 ${STATUS_KINDS.length} 種中）\n\n` +
      (zeroStatus.length === 0 ? "無し。" : zeroStatus.map((k) => `${STATUS_LABEL[k]}(${k})`).join("、")),
  );
  lines.push("");

  const capHitsTotal = allMetrics.reduce((s, m) => s + m.synergyEventCapHits, 0);
  const capHitRuns = allMetrics.filter((m) => m.synergyEventCapHits > 0).length;
  lines.push(
    `### SYNERGY.maxEventsPerStep / maxPendingEvents 到達回数\n\n` +
      `上限に到達した（イベントを捨てた）ステップの延べ回数: ${capHitsTotal}（${capHitRuns} / ${allMetrics.length} run で発生）。0 なら今回の QA 標準ビルドでは連鎖の不発は起きていない。`,
  );
  lines.push("");

  return lines;
}

function gradeRow(label: string, counts: Readonly<Record<BoonGrade, number>>): string {
  const total = BOON_GRADES.reduce((s, g) => s + counts[g], 0);
  const cells = BOON_GRADES.map((g) => `${counts[g]} (${percent(counts[g], total)})`);
  return `| ${label} | ${cells.join(" | ")} | ${percent(counts[2] + counts[3], total)} |`;
}

/** 格の見出し（並は表示語を持たないのでここでだけ「並」と書く） */
function gradeHeader(): string {
  return BOON_GRADES.map((g) => (BOON_GRADE_LABEL[g] === "" ? "並" : BOON_GRADE_LABEL[g])).join(" | ");
}

/** 祝福の芯・格・取得機会（docs/ideas/boon-power-up.md 5 節）。bot は呪いでない札のうち格の最も高い札を取る */
function buildBoonMetricsSection(allMetrics: readonly RunMetrics[]): string[] {
  const lines: string[] = [];
  const runs = Math.max(1, allMetrics.length);
  const avgOf = (pick: (m: RunMetrics) => number): string => (allMetrics.reduce((s, m) => s + pick(m), 0) / runs).toFixed(2);
  lines.push("## 祝福（芯・格・取得機会）");
  lines.push("");
  lines.push(
    `ランあたりの取得数: 全体 ${avgOf((m) => m.boon.taken)} / 芯を除く ${avgOf((m) => m.boon.takenNonCore)} / うち呪い付き ${avgOf((m) => m.boon.takenCursed)}`,
  );
  lines.push("");

  lines.push("### 3 択の提示回数（出どころ別）");
  lines.push("");
  lines.push("| 出どころ | 合計 | ランあたり |");
  lines.push("| --- | --- | --- |");
  for (const src of BOON_OFFER_SOURCES) {
    const total = allMetrics.reduce((s, m) => s + m.boon.offers[src], 0);
    lines.push(`| ${BOON_OFFER_SOURCE_LABEL[src]} | ${total} | ${(total / runs).toFixed(2)} |`);
  }
  lines.push("");

  lines.push("### 提示した札の格（格の対象の札だけ、深度帯別）");
  lines.push("");
  lines.push(`| 深度 | ${gradeHeader()} | 大祝福 + 神威 |`);
  lines.push("| --- | --- | --- | --- | --- |");
  for (const band of GRADE_BANDS) {
    const counts = emptyGradeCounts();
    for (const m of allMetrics) for (const g of BOON_GRADES) counts[g] += m.boon.offeredGrades[band][g];
    lines.push(gradeRow(band, counts));
  }
  lines.push("");

  lines.push("### 取得した祝福の格（格の対象だけ）");
  lines.push("");
  lines.push(`| | ${gradeHeader()} | 大祝福 + 神威 |`);
  lines.push("| --- | --- | --- | --- | --- |");
  const taken = emptyGradeCounts();
  for (const m of allMetrics) for (const g of BOON_GRADES) taken[g] += m.boon.takenGrades[g];
  lines.push(gradeRow("取得", taken));
  lines.push("");

  lines.push("### 芯の取得回数");
  lines.push("");
  const cores = boonsModule.BOON_KEYS.filter((k) => boonsModule.BOONS[k].core === true);
  if (cores.length === 0) {
    lines.push("芯の祝福が定義されていない。");
  } else {
    lines.push("| 芯 | 取得回数 |");
    lines.push("| --- | --- |");
    for (const k of cores) lines.push(`| ${boonsModule.BOONS[k].name} (${k}) | ${allMetrics.filter((m) => m.boon.core === k).length} |`);
    const zero = cores.filter((k) => allMetrics.every((m) => m.boon.core !== k));
    lines.push("");
    lines.push(`芯を取ったラン: ${allMetrics.filter((m) => m.boon.core !== null).length} / ${allMetrics.length}。0 回の芯: ${zero.length === 0 ? "無し" : zero.join("、")}`);
  }
  lines.push("");

  lines.push("### 格 2 以上を取ったランと並だけのラン");
  lines.push("");
  lines.push("| 区分 | run 数 | 平均到達深度 | 平均 kills |");
  lines.push("| --- | --- | --- | --- |");
  const groups: [string, RunMetrics[]][] = [
    ["大祝福・神威を 1 つ以上", allMetrics.filter((m) => maxTakenGrade(m.boon) >= 2)],
    ["並だけ（格の対象を取った）", allMetrics.filter((m) => maxTakenGrade(m.boon) === 1)],
    ["格の対象なし", allMetrics.filter((m) => maxTakenGrade(m.boon) === 0)],
  ];
  for (const [label, group] of groups) {
    const n = group.length;
    const depth = n > 0 ? average(group.map((m) => m.maxDepth)).toFixed(2) : "-";
    const kills = n > 0 ? average(group.map((m) => m.kills)).toFixed(1) : "-";
    lines.push(`| ${label} | ${n} | ${depth} | ${kills} |`);
  }
  lines.push("");
  lines.push("到達深度が深いほど格の抽選回数も格の確率も増えるので、この比較は因果ではなく相関（目安）。");
  lines.push("");
  return lines;
}

function buildBalanceNotes(allMetrics: readonly RunMetrics[]): string {
  const notes: string[] = [];
  const deaths = allMetrics.filter((m) => m.died && m.deathDepth !== null);
  if (deaths.length > 0) {
    const byDepth = new Map<number, number>();
    for (const m of deaths) byDepth.set(m.deathDepth!, (byDepth.get(m.deathDepth!) ?? 0) + 1);
    const worst = [...byDepth.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst) notes.push(`- depth ${worst[0]} での死亡が最多（${worst[1]} 件 / ${deaths.length} 件中）。この階の難度がボトルネックになっている可能性がある。`);
  }
  const causeCounts = new Map<string, number>();
  for (const m of deaths) causeCounts.set(m.deathCause ?? "unknown", (causeCounts.get(m.deathCause ?? "unknown") ?? 0) + 1);
  const topCause = [...causeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCause) notes.push(`- 死因として最も多く推測されたのは "${topCause[0]}"（${topCause[1]} 件）。`);

  const empty = allMetrics.filter((m) => m.profileKind === "empty");
  const rare = allMetrics.filter((m) => m.profileKind === "rareLoadout");
  const unique = allMetrics.filter((m) => m.profileKind === "uniqueLoadout");
  notes.push(
    `- 平均到達depth: 素手 ${average(empty.map((m) => m.maxDepth)).toFixed(2)} / rare装備 ${average(rare.map((m) => m.maxDepth)).toFixed(2)} / unique装備 ${average(unique.map((m) => m.maxDepth)).toFixed(2)}。`,
  );
  const withKs = allMetrics.filter((m) => m.keystones.length > 0);
  const withoutKs = allMetrics.filter((m) => m.keystones.length === 0);
  if (withKs.length > 0 && withoutKs.length > 0) {
    const diff = average(withKs.map((m) => m.maxDepth)) - average(withoutKs.map((m) => m.maxDepth));
    notes.push(`- キーストーン所持時の平均到達depthは非所持時より ${diff.toFixed(2)} 高い（正なら強化、負ならリスクが上回っている）。`);
  }
  const avgStepMs = average(allMetrics.map((m) => m.avgStepMs));
  notes.push(`- 1 ステップの平均処理時間は ${avgStepMs.toFixed(3)}ms（60fps 予算 16.6ms に対し余裕あり）。`);

  const dominant = allMetrics.filter((m) => m.profileKind === "dominantLoadout");
  const dual = allMetrics.filter((m) => m.profileKind === "dualLoadout");
  const scatter = allMetrics.filter((m) => m.profileKind === "scatterLoadout");
  notes.push(
    `- 平均到達depth（色配合）: 単色寄せ ${average(dominant.map((m) => m.maxDepth)).toFixed(2)} / 2色 ${average(dual.map((m) => m.maxDepth)).toFixed(2)} / 5色散光 ${average(scatter.map((m) => m.maxDepth)).toFixed(2)}。`,
  );
  return notes.join("\n");
}

function buildSuggestions(allMetrics: readonly RunMetrics[]): string {
  // report.md には固定 5 件の提案枠を用意し、収集したデータで内容を補強する
  const deaths = allMetrics.filter((m) => m.died && m.deathDepth !== null);
  const byDepth = new Map<number, number>();
  for (const m of deaths) byDepth.set(m.deathDepth!, (byDepth.get(m.deathDepth!) ?? 0) + 1);
  const worstDepth = [...byDepth.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const causeCounts = new Map<string, number>();
  for (const m of deaths) causeCounts.set(m.deathCause ?? "unknown", (causeCounts.get(m.deathCause ?? "unknown") ?? 0) + 1);
  const topCause = [...causeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const lines = [
    `1. ${worstDepth !== undefined ? `depth ${worstDepth} 前後` : "死亡が集中する深度"}の敵密度・HPスケーリング（enemiesPerDepth / depthHpScale）を見直し、難度の急上昇を緩和する。`,
    `2. 死因トップの敵${topCause ? `（${topCause}）` : ""}の windup 時間や被弾判定の猶予を見直し、回避余地を増やす。`,
    "3. rare / unique 装備の有無で到達depthに大きな差が出ていない場合、レアアフィックスの倍率調整でビルドの手応えを強める。",
    "4. キーストーンつき装備が事故死を増やしている場合は、リスクに見合ったリターン（回復・被ダメ軽減の代替経路）を補強する。",
    "5. Reaper 出現後に倒しきれず時間切れで死ぬケースが目立つ場合は、warnAfter / appearAfter の猶予時間を調整する。",
  ];
  return lines.join("\n");
}

/**
 * 同時攻撃の上限の行。上限超過はボスを除いた数で判定する（strikeSlotsFull はボスを枠に数えないため、
 * ボス込みの総数で比べると「ボス 1 + 取り巻き 2」が超過に見えていた。report.md の調査メモ）
 */
function strikerReportLines(allMetrics: readonly Pick<RunMetrics, "seed" | "profileKind" | "maxConcurrentStrikers" | "maxConcurrentNonBossStrikers">[]): string[] {
  const cap = ENEMY_AI.maxSimultaneousStrikers;
  const maxNonBoss = Math.max(0, ...allMetrics.map((m) => m.maxConcurrentNonBossStrikers));
  const maxTotal = Math.max(0, ...allMetrics.map((m) => m.maxConcurrentStrikers));
  const overCap = allMetrics.filter((m) => m.maxConcurrentNonBossStrikers > cap);
  const overList = overCap.length > 0 ? `（seed/profile: ${overCap.map((m) => `${m.seed}/${m.profileKind}`).join(", ")}）` : "。";
  return [
    `- **同時に phase===strike だった非ボスの敵数の最大**（上限 ENEMY_AI.maxSimultaneousStrikers=${cap}。strikeSlotsFull と同じくボスを除く）: 全 run 中の最大 ${maxNonBoss}。上限超過 run: ${overCap.length} 件${overList}`,
    `- **同時に phase===strike だった敵数の最大（ボス込みの総数。参考）**: 全 run 中の最大 ${maxTotal}（ボスは上限の枠に数えないので、非ボスが上限以内ならこの数が上限を超えても設計どおり）`,
  ];
}

describe("QA 計測: 同時攻撃数の切り分け", () => {
  /** 開始直後の state に、ボス 1 体と非ボスを並べて strike にする */
  function strikingState(nonBossStriking: number): GameState {
    const state = createGame(1, "1", buildProfile(PROFILE_KINDS[0]!, 1), buildQaSkillProfile());
    const boss = ENEMIES.find((d) => isBossDriven(d));
    const minion = ENEMIES.find((d) => !isBossDriven(d));
    if (!boss || !minion) throw new Error("ボスと非ボスの定義が要る");
    const pos = { ...state.player.body.pos };
    const enemies = [createEnemy(state, boss, pos, 0, false)];
    for (let i = 0; i < nonBossStriking; i++) enemies.push(createEnemy(state, minion, pos, 0, false));
    // 倒れた敵と strike 以外の敵は数えない
    const dead = createEnemy(state, minion, pos, 0, false);
    dead.hp = 0;
    const idle = createEnemy(state, minion, pos, 0, false);
    for (const e of [...enemies, dead]) e.phase = "strike";
    idle.phase = "windup";
    state.enemies = [...enemies, dead, idle];
    return state;
  }

  it("ボスを除いた数と、ボス込みの総数を分けて数える", () => {
    const counted = countStrikers(strikingState(ENEMY_AI.maxSimultaneousStrikers).enemies);
    expect(counted.nonBoss, "非ボスは strikeSlotsFull と同じくボスを除く").toBe(ENEMY_AI.maxSimultaneousStrikers);
    expect(counted.total, "総数はボスを含む").toBe(ENEMY_AI.maxSimultaneousStrikers + 1);
  });

  it("上限超過はボスを除いた数で判定する（ボス 1 + 非ボスが上限いっぱいは超過にしない）", () => {
    const cap = ENEMY_AI.maxSimultaneousStrikers;
    const atCap = { seed: 1, profileKind: PROFILE_KINDS[0]!, maxConcurrentStrikers: cap + 1, maxConcurrentNonBossStrikers: cap };
    const over = { seed: 2, profileKind: PROFILE_KINDS[0]!, maxConcurrentStrikers: cap + 1, maxConcurrentNonBossStrikers: cap + 1 };
    const [nonBossLine, totalLine] = strikerReportLines([atCap]);
    expect(nonBossLine, "上限いっぱいは超過 0 件").toContain("上限超過 run: 0 件");
    expect(totalLine, "総数の行も出る").toContain(`最大 ${cap + 1}`);
    expect(strikerReportLines([atCap, over])[0], "非ボスが上限を超えた run だけを挙げる").toContain("上限超過 run: 1 件（seed/profile: 2/");
  });
});

describe("QA 計測: 祝福の芯・格・取得機会", () => {
  it("提示した札の格は深度帯 2〜3 / 4〜5 / 6 以上に分けて数える", () => {
    expect(gradeBandOf(2), "深度 2").toBe("2-3");
    expect(gradeBandOf(3), "深度 3").toBe("2-3");
    expect(gradeBandOf(5), "深度 5").toBe("4-5");
    expect(gradeBandOf(6), "深度 6").toBe("6+");
  });

  it("増えた祝福だけを取得として数え、格の対象は格ごとに数える", () => {
    const state = createGame(1);
    const graded = boonsModule.BOON_KEYS.find((k) => isGraded(boonsModule.BOONS[k]) && boonsModule.BOONS[k].core !== true);
    const cursed = boonsModule.BOON_KEYS.find((k) => boonsModule.BOONS[k].cursed === true);
    if (!graded || !cursed) throw new Error("祝福が足りない");
    const b = emptyBoonMetrics();
    const prev = new Set(state.boons);
    state.boons = [...state.boons, graded, cursed];
    state.boonRun.grades[graded] = 3;
    recordTakenBoons(state, prev, b);
    expect(b.taken, "2 つ増えた").toBe(2);
    expect(b.takenCursed, "呪い付き 1 つ").toBe(1);
    expect(b.takenGrades[3], "神威 1 つ").toBe(1);
    expect(maxTakenGrade(b), "最高の格").toBe(3);
    recordTakenBoons(state, new Set(state.boons), b);
    expect(b.taken, "増えていなければ数えない").toBe(2);
  });
});

const REPORT_START = "<<<QA_REPORT_START>>>";
const REPORT_END = "<<<QA_REPORT_END>>>";

/**
 * フル版の制限時間（ms）。マップ拡大（MAP_SIZE の面積 3.5〜5 倍）で 1 ランの階が広く敵も多くなり、
 * 1 ステップ約 1.15 倍・ランの長さも伸びて、基準 約 570 秒の実行が約 920 秒（2026-09-25 実測）になったため 600 秒から 2 倍に広げる
 */
const FULL_TIMEOUT_MS = 1_200_000;

describe("QA simulation (フル版, SIM_FULL=1)", () => {
  it.runIf(FULL)(
    `${FULL_SEED_COUNT} seed × ${PROFILE_KINDS.length} 装備パターン × ${FULL_MAX_STEPS} ステップを実行する`,
    () => {
      const allMetrics: RunMetrics[] = [];
      for (let i = 0; i < FULL_SEED_COUNT; i++) {
        const seed = 50_000 + i;
        for (const kind of PROFILE_KINDS) {
          allMetrics.push(runOnce(seed, kind, FULL_MAX_STEPS));
        }
      }

      const report = buildReport(allMetrics);
      // @types/node が無くこのファイルは fs に触れられないので、標準出力に区切り付きで
      // 出す。呼び出し側 (`SIM_FULL=1 npx vitest run src/qa/simulation.test.ts`) が
      // このマーカー間を抜き出して src/qa/report.md に保存する
      console.log(REPORT_START);
      console.log(report);
      console.log(REPORT_END);

      // フル版でも最低限の健全性は assert する
      const totalExceptions = allMetrics.reduce((s, m) => s + m.exceptions.length, 0);
      expect(totalExceptions, `フル run で例外が ${totalExceptions} 件発生した。上の出力を参照`).toBe(0);
    },
    FULL_TIMEOUT_MS,
  );
});
