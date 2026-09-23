import { describe, expect, it, vi } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { EnemyPhase, GameState, GameStatus } from "../core/state";
import { STATUS_KINDS, STATUS_LABEL, type StatusKind } from "../core/status";
import { createRng, type Rng } from "../core/rng";
import { enemyDef } from "../data/enemies";
import {
  createEmptyProfile,
  createEmptyProvenance,
  RARITIES,
  SLOTS,
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
import * as combat from "../system/combat";
import * as statusEffectsModule from "../system/statusEffects";
import { stoneFromSeed } from "../skills/generator";
import type { SkillProfile, SkillStone } from "../skills/types";
import { createBotState, botInput } from "./bot";
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
    for (const slot of SLOTS) {
      profile.equipment[slot] = rollUntilRarity(rng, slot, targetRarity, 20, 1, now);
    }
    return profile;
  }

  const colors = colorsForLoadout(kind, seed);
  for (const slot of SLOTS) {
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
/** 直近の step() 呼び出し時点で交戦中だった敵の数。damagePlayer のスパイが読む */
let engagedEnemyCountThisStep = 0;

const originalDamageEnemy = combat.damageEnemy;
vi.spyOn(combat, "damageEnemy").mockImplementation((...args: Parameters<typeof originalDamageEnemy>) => {
  const [, enemy, , , , opts] = args;
  const before = Math.max(0, enemy.hp);
  const killed = originalDamageEnemy(...args);
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
 */
function anyEnemyInWall(state: GameState): boolean {
  return state.enemies.some((e) => !enemyDef(e.defKey).phasing && overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius));
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
  };

  let depthEnterTime = state.time;
  let currentDepth = state.depth;
  let sawReaperThisFloor = false;
  let sawBossThisFloor = false;
  let sawBossDefeatThisFloor = false;
  let stepTimeTotal = 0;
  let prevManaFlash = state.skills.manaFlash;

  // このランの間だけ、上のスパイが metrics.skill に書き込むようにする（他ランと混ざらないよう
  // 抜けたら必ず null に戻す。runOnce は例外を catch して抜けるだけで投げ直さないので try/finally は不要）
  activeSkillMetrics = metrics.skill;

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
      for (let i = 0; i < FAST_SEED_COUNT; i++) {
        const seed = 10_000 + i;
        const profileKind = PROFILE_KINDS[i % PROFILE_KINDS.length]!;
        const metrics = runOnce(seed, profileKind, FAST_MAX_STEPS);

        expect(
          metrics.exceptions,
          `seed=${seed} profile=${profileKind} で例外: ${metrics.exceptions.map((e) => `step${e.step}: ${e.message}`).join(" / ")}`,
        ).toHaveLength(0);
        expect(metrics.nanDetected, `seed=${seed} profile=${profileKind} で NaN 混入`).toBe(false);
        expect(metrics.wallOverlapDetected, `seed=${seed} profile=${profileKind} で敵が壁にめり込んだ`).toBe(false);
        expect(metrics.duplicateFloorItemId, `seed=${seed} profile=${profileKind} で floorItems の id が重複した`).toBe(false);
      }
    },
    30_000,
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

/** 6 装備 × 2 回 × 4,000 step。要素が増えて 5 秒の既定を超えるようになったので余裕を持たせる */
const DETERMINISM_TIMEOUT_MS = 30_000;

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

const REPORT_START = "<<<QA_REPORT_START>>>";
const REPORT_END = "<<<QA_REPORT_END>>>";

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
    600_000,
  );
});
