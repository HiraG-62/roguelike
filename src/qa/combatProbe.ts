import { createGame, step } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { dist, normalize, sub, type Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { ENEMY_AI } from "../data/tuning";
import { MOVESET_KEYS, type MovesetKey, shootsPrimary } from "../data/weapons";
import { BASES } from "../loot/bases";
import { bulletOfBase, rangedBasesOf } from "../loot/bullets";
import { computeStats } from "../loot/stats";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { createEnemy } from "../system/enemies";
import { withBaseAreaMul } from "../system/floor";
import { applyStats, currentShot, playerMoveset } from "../system/player";
import { attackCommitted, isStaggered } from "../system/poise";
import { isBossDriven } from "../system/boss";
import { behaviorOf } from "../system/behaviors/registry";
import { worldToScreen } from "./bot";
import { createCombatRecorder, hurtTextDamage, sumBands, type CombatBandTally } from "./combatMetrics";
import { buildGearPowerSection, fittedEquipment, measureGearPower, type GearPowerRow } from "./gearPower";

/**
 * 1 対 1 / 集団の「連打」計測（docs/ideas/core-synthesis.md 9 章 段取り 1、encounter-core.md 12 章 Q0）。
 * 戦闘の核を変える前後で同じ物差しを当てるための道具で、結果は src/qa/probe.md（`npm run qa:probe`）。
 * ゲームのロジックは変えず、実際の step() を回して数えるだけ。
 * system/testHelpers.ts は本体から import してはいけないので、必要な部屋づくりはここに持つ。
 */

/** 見切りの浮き文字（system/combat.ts の justDodge が出す。actionText には無いのでここに写す） */
const JUST_DODGE_TEXT = "見切り！";

export type ProbeBot = "mash" | "mashDodge" | "mashKite";

export const PROBE_BOT_LABEL: Readonly<Record<ProbeBot, string>> = {
  mash: "連打",
  mashDodge: "連打+ダッシュ",
  mashKite: "連打+離脱",
};

/** 敵との間合い（px）。これより遠いと近づく */
const BOT_REACH = 20;
/** これより近い敵の予備動作 / 攻撃を危険とみなす（px） */
const DANGER_RANGE = 55;
/** ダッシュで避ける: 予備動作の終わりまでの残り秒がこれ未満になったら踏み出す（見切りの猶予に合わせた） */
const DODGE_WINDUP_LEFT = 0.12;
/** 溜め撃ちを最大段から離すまでの余白（秒） */
const CHARGE_TOP_MARGIN = 0.05;
/** 1 対 1: 敵を置く距離（px） */
const DUEL_ENEMY_DISTANCE = 40;
/** 1 対 1: 置いた敵の初回攻撃までの待ち（秒） */
const DUEL_FIRST_COOLDOWN = 0.3;
/** 1 対 1: 死なないように保つ最低 HP（被弾は数える） */
const DUEL_HP_FLOOR = 50;
/** 集団: 敵を円形に置く半径（px） */
const GROUP_RING_RADIUS = 60;
/** 集団: 敵ごとの初回攻撃までの待ちをずらす（同時に殴りかからないように） */
const GROUP_COOLDOWN_BASE = 0.3;
const GROUP_COOLDOWN_STAGGER = 0.2;
/** 集団: この HP 以下になったら「死亡」に数えて全快させる */
const GROUP_DEATH_HP = 30;

/**
 * 装備の型。none = 装備なし（既定の剣。基準値の物差し）/ fitted = 深度に見合う装備
 * （itemLevel = 深度の並の遺物 6 部位。qa/gearPower.ts。地金は今の深度で決まる）/
 * { moveset } = 装備なしの素の能力のまま武器種だけ替える（武器種どうしの型の差だけを見る軸。docs/ideas/weapon-forms-impl.md 6 章）
 */
export type ProbeStockGear = "none" | "fitted";
export interface ProbeMovesetGear {
  readonly moveset: MovesetKey;
  /** 銃・投擲物の器（右手のベースの key）。省略は武器種の最初のベース。器ごとに弾の性質（弾倉・溜め・三点・刺さり）が違うので器ごとに測る */
  readonly base?: string;
}
export type ProbeGear = ProbeStockGear | ProbeMovesetGear;

export const PROBE_GEAR_LABEL: Readonly<Record<ProbeStockGear, string>> = {
  none: "なし",
  fitted: "深度相応",
};

export function probeGearLabel(gear: ProbeGear): string {
  if (typeof gear === "string") return PROBE_GEAR_LABEL[gear];
  return gear.base === undefined ? gear.moveset : `${gear.moveset}/${gear.base}`;
}

/**
 * 武器種だけを替えた素の能力。銃・投擲物は、指定の器（省略は武器種の最初のベース）の弾を撃たせる
 * （bulletOfBase が実プレイと同じ決め方。近接は既定の弾のまま）
 */
function movesetStats(moveset: MovesetKey, baseKey?: string): PlayerStats {
  const base = baseKey === undefined ? BASES.find((b) => b.moveset === moveset) : BASES.find((b) => b.key === baseKey);
  return { ...DEFAULT_STATS, critChance: 0, keystones: [], triggers: [], moveset, bullet: bulletOfBase(base?.key) };
}

const NO_MOVE: Vec = { x: 0, y: 0 };

function frameInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/**
 * 敵のいない開始部屋。クリティカルは切る（乱数で数値がぶれないように）。マップは基準の大きさで作る。
 * 深度相応の装備は applyStats を通す（属性の派生・地金の深度反映を実プレイと同じにするため）
 */
export function makeArena(seed: number, depth: number, gear: ProbeGear = "none"): GameState {
  const state = withBaseAreaMul(() => createGame(seed));
  state.enemies = [];
  state.depth = depth;
  if (gear === "fitted") {
    applyStats(state, { ...computeStats(fittedEquipment(seed, depth), depth), critChance: 0 });
    state.player.hp = state.player.maxHp;
  } else if (typeof gear === "object") {
    state.stats = movesetStats(gear.moveset, gear.base);
    state.player.maxHp = state.stats.maxHp;
    state.player.hp = state.stats.maxHp;
  } else {
    state.stats = { ...DEFAULT_STATS, critChance: 0, keystones: [], triggers: [] };
    state.player.maxHp = state.stats.maxHp;
    state.player.hp = state.stats.maxHp;
  }
  state.player.dashChargesLeft = state.stats.dashCharges;
  state.player.facing = { x: 1, y: 0 };
  return state;
}

export function placeEnemy(state: GameState, key: string, dx: number, dy: number): Enemy {
  const p = state.player.body.pos;
  const e = createEnemy(state, enemyDef(key), { x: p.x + dx, y: p.y + dy }, 0, false);
  state.enemies.push(e);
  e.phase = "chase";
  return e;
}

function nearestEnemy(state: GameState): Enemy | undefined {
  const p = state.player.body.pos;
  let best: Enemy | undefined;
  let bestDist = Infinity;
  for (const e of state.enemies) {
    const d = dist(e.body.pos, p);
    if (d >= bestDist) continue;
    bestDist = d;
    best = e;
  }
  return best;
}

/** bot の入力。最も近い敵へ向かって殴り続け、bot ごとに予備動作への対処が違う */
export function botInput(state: GameState, bot: ProbeBot): FrameInput {
  const p = state.player;
  const target = nearestEnemy(state);
  if (!target) return frameInput({});
  const d = dist(target.body.pos, p.body.pos);
  const toward = normalize(sub(target.body.pos, p.body.pos));
  p.facing = toward;
  const away: Vec = { x: -toward.x, y: -toward.y };

  if (bot === "mashKite") {
    const danger = state.enemies.some(
      (e) => (e.phase === "windup" || e.phase === "strike") && dist(e.body.pos, p.body.pos) < DANGER_RANGE,
    );
    if (danger) return frameInput({ move: away, aimScreen: null });
  }
  if (bot === "mashDodge" && p.dashChargesLeft > 0) {
    const threat = state.enemies.find(
      (e) => e.phase === "windup" && e.phaseTimer < DODGE_WINDUP_LEFT && dist(e.body.pos, p.body.pos) < DANGER_RANGE,
    );
    if (threat) {
      const escape = normalize(sub(p.body.pos, threat.body.pos));
      return frameInput({ dashPressed: true, move: escape, aimScreen: null });
    }
  }
  // 左で撃つ武器種は押しっぱなしで撃つ（player.ts shotButtonHeld）。近接は今までどおり押すだけ（溜めない）
  const shoots = shootsPrimary(playerMoveset(state));
  const held = shoots && !shotChargeDone(state);
  return frameInput({ attackPressed: true, attackHeld: held, aimScreen: lobAimScreen(state, target), move: d > BOT_REACH ? toward : NO_MOVE });
}

/** 溜め撃ちの弾（火縄銃・手砲）は最大段まで溜めたら 1 フレーム離して撃つ。押しっぱなしのままでは撃たない */
function shotChargeDone(state: GameState): boolean {
  const levels = currentShot(state.stats).charge?.levels;
  const top = levels?.[levels.length - 1]?.time;
  if (top === undefined) return false;
  return state.player.shotCharging && state.player.shotChargeTime >= top + CHARGE_TOP_MARGIN;
}

/**
 * 曲射の弾（擲弾）は照準の距離に落ちる。照準なしでは最大射程へ飛び越えて当たらないので、敵の位置を指す。
 * 曲射でない弾は今までどおり照準なし（向きは facing で足りる）
 */
function lobAimScreen(state: GameState, target: Enemy): Vec | null {
  if (!currentShot(state.stats).lob) return null;
  return worldToScreen(state, target.body.pos);
}

/** 1 回の計測の生の数（seed をまたいで足せる） */
export interface ProbeCounts {
  /** 足し合わせた計測の本数（seed 数）と、その最大 HP の合計。最大 HP の平均 = maxHpSum ÷ runs（被弾で死ぬまでの回数の材料） */
  runs: number;
  maxHpSum: number;
  /** 観測した時間（秒。ヒットストップで止まった分も含む実時間） */
  seconds: number;
  kills: number;
  hitsTaken: number;
  damageTaken: number;
  /** HP が GROUP_DEATH_HP 以下になった回数（集団のみ） */
  deaths: number;
  counters: number;
  dodges: number;
  /** 生きている敵 × step の延べ数と、そのうち怯み中だった数 */
  enemySteps: number;
  staggeredEnemySteps: number;
  band: CombatBandTally;
  /** 間合い取りの立ち上がり（ai.retreat が 0 から立った回数） */
  retreats: number;
  /** 隙狙いで攻撃間隔の時計が余分に進んだ秒の合計（敵ごとの (倍率 - 1) × dt の和）と、それが起きた step 数 */
  punishShrunkSeconds: number;
  punishSteps: number;
  /** 同時に赤い（攻撃が確定した = attackCommitted の）予備動作の非ボスの数の最大。seed をまたぐときは最大を取る */
  maxRedTelegraphs: number;
  /** 同時攻撃の上限で予備動作の終わりを待たされた秒の合計（待つたびに strikerHoldTime） */
  holdSeconds: number;
}

function emptyCounts(): ProbeCounts {
  return {
    runs: 0,
    maxHpSum: 0,
    seconds: 0,
    kills: 0,
    hitsTaken: 0,
    damageTaken: 0,
    deaths: 0,
    counters: 0,
    dodges: 0,
    enemySteps: 0,
    staggeredEnemySteps: 0,
    band: { steps: 0, hitstopSteps: 0, windups: 0, strikes: 0, engagedSteps: 0, engagementSeconds: [] },
    retreats: 0,
    punishShrunkSeconds: 0,
    punishSteps: 0,
    maxRedTelegraphs: 0,
    holdSeconds: 0,
  };
}

function addCounts(into: ProbeCounts, from: ProbeCounts): void {
  into.runs += from.runs;
  into.maxHpSum += from.maxHpSum;
  into.seconds += from.seconds;
  into.kills += from.kills;
  into.hitsTaken += from.hitsTaken;
  into.damageTaken += from.damageTaken;
  into.deaths += from.deaths;
  into.counters += from.counters;
  into.dodges += from.dodges;
  into.enemySteps += from.enemySteps;
  into.staggeredEnemySteps += from.staggeredEnemySteps;
  into.band.steps += from.band.steps;
  into.band.hitstopSteps += from.band.hitstopSteps;
  into.band.windups += from.band.windups;
  into.band.strikes += from.band.strikes;
  into.band.engagedSteps += from.band.engagedSteps;
  into.retreats += from.retreats;
  into.punishShrunkSeconds += from.punishShrunkSeconds;
  into.punishSteps += from.punishSteps;
  into.maxRedTelegraphs = Math.max(into.maxRedTelegraphs, from.maxRedTelegraphs);
  into.holdSeconds += from.holdSeconds;
}

/** step の前後で共通の観測（被弾・怯み・浮き文字）。浮き文字は同じものを二度数えない */
interface StepObserver {
  counts: ProbeCounts;
  before(state: GameState): void;
  after(state: GameState): void;
  /** 交戦を閉じて、帯ごとの集計を counts.band に入れて返す */
  finish(): ProbeCounts;
}

/** 反応ルール・予告の上限の観測（間合い取りの立ち上がり / 隙狙いの縮み / 同時に赤い予告 / 上限の待ち） */
function observeReactions(
  state: GameState,
  counts: ProbeCounts,
  prev: ReadonlyMap<number, { retreating: boolean; windup: boolean; timer: number }>,
): void {
  let red = 0;
  let punishing = false;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const def = enemyDef(e.defKey);
    if (isBossDriven(def)) continue;
    const before = prev.get(e.id);
    if ((e.ai?.retreat ?? 0) > 0 && before && !before.retreating) counts.retreats++;
    if (e.phase === "windup" && attackCommitted(e)) red++;
    // 予備動作の終わりで上限に阻まれると phaseTimer が strikerHoldTime へ戻る（減るはずの時計が増えた）
    if (before?.windup && e.phase === "windup" && e.phaseTimer > before.timer) counts.holdSeconds += ENEMY_AI.strikerHoldTime;
    const rate = e.attackCooldown > 0 ? behaviorOf(def).attackCooldownRate(state, e, def) : 1;
    if (rate > 1) {
      counts.punishShrunkSeconds += (rate - 1) * FIXED_DT;
      punishing = true;
    }
  }
  if (punishing) counts.punishSteps++;
  counts.maxRedTelegraphs = Math.max(counts.maxRedTelegraphs, red);
}

/** 出来事 onCounter / onParry を最後に数えた state.time */
interface SeenCounter {
  counter: number;
  parry: number;
}

/**
 * 出端の数。onCounter は出端と受け流しの両方が出す（受け流しは onParry も並べる）ので、同じステップの onCounter から onParry を引く。
 * 浮き文字では数えない（出端は文字を出さない）。出来事は step の終わりに空になるため、直近の記録 state.recent の時刻の変化で拾う
 */
function countDebana(state: GameState, seen: SeenCounter): number {
  const counter = state.recent.onCounter?.lastTime ?? Number.NEGATIVE_INFINITY;
  const parry = state.recent.onParry?.lastTime ?? Number.NEGATIVE_INFINITY;
  const newCounter = counter > seen.counter;
  const newParry = parry > seen.parry;
  seen.counter = counter;
  seen.parry = parry;
  return newCounter && !newParry ? 1 : 0;
}

function createStepObserver(): StepObserver {
  const counts = emptyCounts();
  const recorder = createCombatRecorder();
  const seenTexts = new WeakSet<object>();
  const seen: SeenCounter = { counter: Number.NEGATIVE_INFINITY, parry: Number.NEGATIVE_INFINITY };
  /** step の直前の敵ごとの観測（間合い取りの立ち上がり・予備動作の待ちの検出用） */
  let prev = new Map<number, { retreating: boolean; windup: boolean; timer: number }>();
  return {
    counts,
    before(state) {
      prev = new Map(
        state.enemies.map((e) => [e.id, { retreating: (e.ai?.retreat ?? 0) > 0, windup: e.phase === "windup", timer: e.phaseTimer }]),
      );
      recorder.beforeStep(state);
    },
    after(state) {
      recorder.afterStep(state, FIXED_DT);
      counts.seconds += FIXED_DT;
      for (const t of state.texts) {
        if (seenTexts.has(t)) continue;
        seenTexts.add(t);
        const hurt = hurtTextDamage(t);
        if (hurt !== null) {
          counts.hitsTaken++;
          counts.damageTaken += hurt;
        }
        if (t.text === JUST_DODGE_TEXT) counts.dodges++;
      }
      counts.counters += countDebana(state, seen);
      observeReactions(state, counts, prev);
      for (const e of state.enemies) {
        if (e.hp <= 0) continue;
        counts.enemySteps++;
        if (isStaggered(e)) counts.staggeredEnemySteps++;
      }
    },
    finish() {
      recorder.finish();
      counts.band = sumBands(recorder.tally);
      return counts;
    },
  };
}

/** 1 対 1: 敵 1 体を倒しては同じ敵を置き直し、seconds 秒のあいだ連打する */
export function runDuel(depth: number, key: string, bot: ProbeBot, seconds: number, seed: number, gear: ProbeGear = "none"): ProbeCounts {
  const state = makeArena(seed, depth, gear);
  const origin = { ...state.player.body.pos };
  const observer = createStepObserver();
  observer.counts.runs = 1;
  observer.counts.maxHpSum = state.player.maxHp;

  const spawn = (): Enemy => {
    state.player.body.pos = { ...origin };
    state.player.knock = { x: 0, y: 0 };
    state.enemies = [];
    const e = placeEnemy(state, key, DUEL_ENEMY_DISTANCE, 0);
    e.attackCooldown = DUEL_FIRST_COOLDOWN;
    return e;
  };

  let enemy = spawn();
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    if (enemy.hp <= 0 || !state.enemies.includes(enemy)) {
      observer.counts.kills++;
      enemy = spawn();
    }
    state.player.hp = Math.max(state.player.hp, DUEL_HP_FLOOR);
    const input = botInput(state, bot);
    observer.before(state);
    step(state, input, FIXED_DT);
    observer.after(state);
  }
  return observer.finish();
}

/** 集団: 敵を円形に置き、全滅したら置き直す。HP が GROUP_DEATH_HP 以下で死亡に数えて全快 */
export function runGroup(depth: number, keys: readonly string[], bot: ProbeBot, seconds: number, seed: number, gear: ProbeGear = "none"): ProbeCounts {
  const state = makeArena(seed, depth, gear);
  const origin = { ...state.player.body.pos };
  const observer = createStepObserver();
  observer.counts.runs = 1;
  observer.counts.maxHpSum = state.player.maxHp;

  const respawnAll = (): void => {
    state.player.body.pos = { ...origin };
    state.enemies = [];
    keys.forEach((key, i) => {
      const angle = (i / keys.length) * Math.PI * 2;
      const e = placeEnemy(state, key, Math.cos(angle) * GROUP_RING_RADIUS, Math.sin(angle) * GROUP_RING_RADIUS);
      e.attackCooldown = GROUP_COOLDOWN_BASE + i * GROUP_COOLDOWN_STAGGER;
    });
  };

  respawnAll();
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const p = state.player;
    if (state.enemies.length === 0) respawnAll();
    if (p.hp <= GROUP_DEATH_HP) {
      observer.counts.deaths++;
      p.hp = p.maxHp;
    }
    const killsBefore = state.kills;
    const input = botInput(state, bot);
    observer.before(state);
    step(state, input, FIXED_DT);
    observer.after(state);
    observer.counts.kills += state.kills - killsBefore;
  }
  return observer.finish();
}

// ---------------------------------------------------------------------------
// 設定・実行・表
// ---------------------------------------------------------------------------

export interface ProbeConfig {
  enemies: readonly string[];
  depths: readonly number[];
  seeds: readonly number[];
  /** 1 回の計測の長さ（秒） */
  seconds: number;
  duelBots: readonly ProbeBot[];
  groups: Readonly<Record<string, readonly string[]>>;
  groupBots: readonly ProbeBot[];
  /** 装備の型。深度相応は深度ごとに装備を作り直す（none は基準の物差し） */
  gears: readonly ProbeGear[];
  /** 地力 ÷ 敵の生命の表に使う装備の seed（装備は乱数なので数を平均する） */
  powerSeeds: readonly number[];
  /** 武器種 × 敵の表（空なら出さない）。装備は素の能力のまま武器種だけ替える */
  weapons: readonly MovesetKey[];
  weaponProbe: WeaponProbeSetup;
}

/** 武器種 × 敵の表の測り方（docs/ideas/weapon-forms-impl.md 6 章: bot は mashDodge、敵は並・堅守・射手、深度 1 / 5、60 秒 × seed 3） */
export interface WeaponProbeSetup {
  enemies: readonly string[];
  depths: readonly number[];
  seeds: readonly number[];
  seconds: number;
  bot: ProbeBot;
}

const WEAPON_PROBE_FULL: WeaponProbeSetup = {
  enemies: ["slime", "knight", "eye"],
  depths: [1, 5],
  seeds: [1, 2, 3],
  seconds: 60,
  bot: "mashDodge",
};

/** `npm run qa:probe` の重い版 */
export const FULL_PROBE_CONFIG: ProbeConfig = {
  enemies: ["slime", "bat", "eye", "boar", "knight", "skeleton", "wolf", "spearman"],
  depths: [1, 5, 10, 15, 20],
  seeds: [1, 2, 3],
  seconds: 60,
  duelBots: ["mash", "mashDodge", "mashKite"],
  groups: {
    slime2bat3: ["slime", "slime", "bat", "bat", "bat"],
    skel_wolf2_eye: ["skeleton", "wolf", "wolf", "eye"],
    knight_spear_slime2: ["knight", "spearman", "slime", "slime"],
  },
  groupBots: ["mash", "mashDodge"],
  gears: ["none", "fitted"],
  powerSeeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  weapons: MOVESET_KEYS,
  weaponProbe: WEAPON_PROBE_FULL,
};

/** `npm run test` の縮小版（健全性の確認だけ。数分の計測はしない） */
export const SMOKE_PROBE_CONFIG: ProbeConfig = {
  enemies: ["slime", "skeleton"],
  depths: [1],
  seeds: [1],
  seconds: 10,
  duelBots: ["mash", "mashDodge", "mashKite"],
  groups: { slime2bat3: ["slime", "slime", "bat", "bat", "bat"] },
  groupBots: ["mash"],
  gears: ["none", "fitted"],
  powerSeeds: [1, 2],
  weapons: ["sword", "longarm"],
  weaponProbe: { ...WEAPON_PROBE_FULL, enemies: ["slime"], depths: [1], seeds: [1], seconds: 5 },
};

export interface ProbeRow {
  label: string;
  depth: number;
  gear: ProbeGear;
  bot: ProbeBot;
  counts: ProbeCounts;
}

/** 武器種 × 敵 × 深度の 1 行（seed をまたいだ合計）。銃・投擲物は器ごとに 1 行 */
export interface WeaponProbeRow {
  moveset: MovesetKey;
  /** 器（右手のベースの key）。近接の武器種は null（器で弾が変わらない） */
  base: string | null;
  enemy: string;
  depth: number;
  counts: ProbeCounts;
}

export interface ProbeResult {
  duels: ProbeRow[];
  groups: ProbeRow[];
  weapons: WeaponProbeRow[];
  /** 深度ごとの地力 ÷ 敵の生命（qa/gearPower.ts） */
  power: GearPowerRow[];
}

function sumOverSeeds(seeds: readonly number[], run: (seed: number) => ProbeCounts): ProbeCounts {
  const total = emptyCounts();
  for (const seed of seeds) addCounts(total, run(seed));
  return total;
}

export function runProbe(cfg: ProbeConfig): ProbeResult {
  const duels: ProbeRow[] = [];
  for (const label of cfg.enemies) {
    for (const gear of cfg.gears) {
      for (const depth of cfg.depths) {
        for (const bot of cfg.duelBots) {
          const counts = sumOverSeeds(cfg.seeds, (seed) => runDuel(depth, label, bot, cfg.seconds, seed, gear));
          duels.push({ label, depth, gear, bot, counts });
        }
      }
    }
  }
  const groups: ProbeRow[] = [];
  for (const [label, keys] of Object.entries(cfg.groups)) {
    for (const gear of cfg.gears) {
      for (const depth of cfg.depths) {
        for (const bot of cfg.groupBots) {
          const counts = sumOverSeeds(cfg.seeds, (seed) => runGroup(depth, keys, bot, cfg.seconds, seed, gear));
          groups.push({ label, depth, gear, bot, counts });
        }
      }
    }
  }
  return { duels, groups, weapons: runWeaponProbe(cfg), power: measureGearPower(cfg.depths, cfg.powerSeeds) };
}

/**
 * 武器種ごとに測る器。銃・投擲物は器ごとに弾の性質が違う（弾倉の容量・溜め・三点・刺さり・弧）ので全部の器を、
 * 近接は器で変わらないので 1 つ（null）だけ。docs/ideas/gun-bases-review.md 0-3（P10）
 */
export function probeBasesOf(moveset: MovesetKey): (string | null)[] {
  const bases = rangedBasesOf(moveset);
  return bases.length === 0 ? [null] : bases.map((b) => b.key);
}

/** 武器種（銃・投擲物は器）ごとに 1 対 1 を測る。装備は素の能力のままなので、差は武器種の型（と重さ・器の弾）だけから出る */
export function runWeaponProbe(cfg: ProbeConfig): WeaponProbeRow[] {
  const setup = cfg.weaponProbe;
  const rows: WeaponProbeRow[] = [];
  for (const moveset of cfg.weapons) {
    for (const base of probeBasesOf(moveset)) {
      const gear: ProbeMovesetGear = base === null ? { moveset } : { moveset, base };
      for (const enemy of setup.enemies) {
        for (const depth of setup.depths) {
          const counts = sumOverSeeds(setup.seeds, (seed) => runDuel(depth, enemy, setup.bot, setup.seconds, seed, gear));
          rows.push({ moveset, base, enemy, depth, counts });
        }
      }
    }
  }
  return rows;
}

const SECONDS_PER_MINUTE = 60;

/** 行の指標（値が定義できないものは null。表では「-」） */
export interface ProbeMetrics {
  secondsPerKill: number | null;
  killsPer60: number;
  hitsPer60: number;
  damagePer60: number;
  /** 1 回の被弾の平均ダメージ（被弾 0 なら null） */
  damagePerHit: number | null;
  /** 最大 HP ÷ 平均被ダメ = 被弾で死ぬまでの回数（被弾 0 なら null） */
  hitsToDie: number | null;
  deathsPer60: number;
  windupsPer60: number;
  strikesPer60: number;
  completionRate: number | null;
  staggeredRate: number | null;
  hitstopRate: number | null;
  countersPer60: number;
  dodgesPer60: number;
  retreatsPer60: number;
  punishSecondsPer60: number;
  holdSecondsPer60: number;
  maxRedTelegraphs: number;
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** 最大 HP の平均 ÷ 1 回の被弾の平均ダメージ */
function hitsToDie(c: ProbeCounts): number | null {
  const perHit = ratio(c.damageTaken, c.hitsTaken);
  if (perHit === null || perHit <= 0 || c.runs <= 0) return null;
  return c.maxHpSum / c.runs / perHit;
}

export function probeMetrics(c: ProbeCounts): ProbeMetrics {
  const per60 = (n: number): number => (c.seconds > 0 ? (n / c.seconds) * SECONDS_PER_MINUTE : 0);
  return {
    secondsPerKill: ratio(c.seconds, c.kills),
    killsPer60: per60(c.kills),
    hitsPer60: per60(c.hitsTaken),
    damagePer60: per60(c.damageTaken),
    damagePerHit: ratio(c.damageTaken, c.hitsTaken),
    hitsToDie: hitsToDie(c),
    deathsPer60: per60(c.deaths),
    windupsPer60: per60(c.band.windups),
    strikesPer60: per60(c.band.strikes),
    completionRate: ratio(c.band.strikes, c.band.windups),
    staggeredRate: ratio(c.staggeredEnemySteps, c.enemySteps),
    hitstopRate: ratio(c.band.hitstopSteps, c.band.steps),
    countersPer60: per60(c.counters),
    dodgesPer60: per60(c.dodges),
    retreatsPer60: per60(c.retreats),
    punishSecondsPer60: per60(c.punishShrunkSeconds),
    holdSecondsPer60: per60(c.holdSeconds),
    maxRedTelegraphs: c.maxRedTelegraphs,
  };
}

function fixed(n: number | null, digits: number): string {
  return n === null ? "-" : n.toFixed(digits);
}

function pct(n: number | null): string {
  return n === null ? "-" : `${(n * 100).toFixed(0)}%`;
}

function mdRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

export function buildProbeReport(cfg: ProbeConfig, result: ProbeResult): string {
  const lines: string[] = [];
  lines.push("# 戦闘の基準値（連打シミュレーション）");
  lines.push("");
  lines.push(
    `\`npm run qa:probe\` が生成。プレイヤーが敵に殴りかかり続ける。装備は「なし」（既定の剣。基準の物差し）と「深度相応」（下の読み方）の 2 通り。` +
      `1 回 ${cfg.seconds} 秒 × seed ${cfg.seeds.length}（${cfg.seeds.join(", ")}）の合計から出した。` +
      "戦闘の核を変える前後で同じ表を出して比べる（core-synthesis.md 9 章 段取り 1）。",
  );
  lines.push("");
  lines.push("## 読み方");
  lines.push("");
  lines.push("- bot: 連打 = 近づいて殴り続ける / 連打+ダッシュ = 予備動作の終わり際にダッシュで避ける / 連打+離脱 = 予備動作・攻撃中の敵から離れる");
  lines.push(
    "- 装備 = なし: 既定の剣のみ / 深度相応: その深度の itemLevel の並の遺物 6 部位（右手は剣。名のある遺物なし。`qa/gearPower.ts` の `fittedEquipment`。seed ごとに作り、地金は今の深度で決まる）",
  );
  lines.push("- 死ぬまで = 最大 HP ÷ 1 回の被弾の平均ダメージ（被弾で死ぬまでの回数。1 対 1 の HP 下限は数えない）");
  lines.push("- 1 対 1 は死なない（HP 下限 50。被弾は数える）。倒したら同じ敵を置き直す。集団は HP 30 以下を「死亡」に数えて全快する");
  lines.push("- 撃破秒 = 観測秒 ÷ 撃破数。被弾・予備動作・攻撃・カウンター・見切りは 60 秒あたり");
  lines.push("- 被弾 = 敵の攻撃を受けた回数（damagePlayer が積む浮き文字 `-N` を数える。状態異常の継続ダメージ・溶岩は含めない）。被ダメ = その N の合計");
  lines.push("- 攻撃 = 予備動作が最後まで進んで strike（か、strike を経ず隙へ進むもの）に至った数。完遂率 = 攻撃 ÷ 予備動作。怯み・恐怖・沈黙で取り消されたものは完遂に入らない");
  lines.push("- 怯み中 = 生きている敵 × step のうち怯み中の割合。ヒットストップ = プレイヤーの世界が止まっていた step の割合");
  lines.push("- カウンター・見切りは浮き文字の数（bot は狙って出していない）");
  lines.push("- 間合い取り = 殴られ続けた敵が離れ始めた回数。隙狙い縮み = プレイヤーの隙で攻撃間隔の時計が余分に進んだ秒の合計（敵ごとの (倍率 - 1) × dt の和）");
  lines.push("- 赤い予告の最大 = 同時に「攻撃が確定した」予備動作の非ボスの数の最大（seed をまたいで最大）。上限待ち = 同時攻撃の上限で予備動作の終わりを待たされた秒");
  lines.push("");

  lines.push("## 1 対 1");
  lines.push("");
  lines.push(
    mdRow(["敵", "深度", "装備", "bot", "撃破秒", "被弾/60秒", "被ダメ/被弾", "死ぬまで", "予備動作/60秒", "攻撃/60秒", "完遂率", "怯み中", "ヒットストップ", "カウンター/60秒", "見切り/60秒", "間合い取り/60秒", "隙狙い縮み秒/60秒"]),
  );
  lines.push(mdRow(new Array<string>(17).fill("---")));
  for (const r of result.duels) {
    const m = probeMetrics(r.counts);
    lines.push(
      mdRow([
        r.label,
        String(r.depth),
        probeGearLabel(r.gear),
        PROBE_BOT_LABEL[r.bot],
        fixed(m.secondsPerKill, 2),
        fixed(m.hitsPer60, 1),
        fixed(m.damagePerHit, 1),
        fixed(m.hitsToDie, 1),
        fixed(m.windupsPer60, 1),
        fixed(m.strikesPer60, 1),
        pct(m.completionRate),
        pct(m.staggeredRate),
        pct(m.hitstopRate),
        fixed(m.countersPer60, 1),
        fixed(m.dodgesPer60, 1),
        fixed(m.retreatsPer60, 1),
        fixed(m.punishSecondsPer60, 1),
      ]),
    );
  }
  lines.push("");

  lines.push("## 集団");
  lines.push("");
  lines.push(
    mdRow(["組", "深度", "装備", "bot", "撃破/60秒", "被弾/60秒", "被ダメ/60秒", "死ぬまで", "死亡/60秒", "完遂率", "怯み中", "ヒットストップ", "カウンター/60秒", "見切り/60秒", "赤い予告の最大", "上限待ち秒/60秒"]),
  );
  lines.push(mdRow(new Array<string>(16).fill("---")));
  for (const r of result.groups) {
    const m = probeMetrics(r.counts);
    lines.push(
      mdRow([
        `${r.label}（${cfg.groups[r.label]?.join("+") ?? ""}）`,
        String(r.depth),
        probeGearLabel(r.gear),
        PROBE_BOT_LABEL[r.bot],
        fixed(m.killsPer60, 1),
        fixed(m.hitsPer60, 1),
        fixed(m.damagePer60, 0),
        fixed(m.hitsToDie, 1),
        fixed(m.deathsPer60, 2),
        pct(m.completionRate),
        pct(m.staggeredRate),
        pct(m.hitstopRate),
        fixed(m.countersPer60, 1),
        fixed(m.dodgesPer60, 1),
        String(m.maxRedTelegraphs),
        fixed(m.holdSecondsPer60, 2),
      ]),
    );
  }
  lines.push("");
  lines.push(...buildWeaponSection(cfg, result.weapons));
  lines.push(...buildGearPowerSection(result.power, cfg.powerSeeds.length));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 武器種 × 敵の表
// ---------------------------------------------------------------------------

/** 型どうしの釣り合いの目標（docs/ideas/weapon-forms-impl.md 6 章）: 撃破秒は中央値 ±20%、被弾/60 秒は ±30% */
export const WEAPON_KILL_TOLERANCE = 0.2;
export const WEAPON_HIT_TOLERANCE = 0.3;

/**
 * 表に足す列（戦意の放出/60 秒・応手/60 秒など）。Player.morale や onRelease / onRiposte が入ったら、
 * ProbeCounts に数を足してここに 1 要素ずつ足す。空の間は列を出さない
 */
export interface WeaponExtraColumn {
  header: string;
  value(counts: ProbeCounts): string;
}
export const WEAPON_EXTRA_COLUMNS: readonly WeaponExtraColumn[] = [];

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid];
  const lo = sorted[mid - 1];
  if (hi === undefined) return null;
  if (sorted.length % 2 === 1 || lo === undefined) return hi;
  return (lo + hi) / 2;
}

/** 敵 × 深度ごとの、武器種をまたいだ中央値（撃破秒・被弾/60 秒）。キーは `${enemy}@${depth}` */
export interface WeaponMedians {
  secondsPerKill: number | null;
  hitsPer60: number | null;
}

export function weaponMedians(rows: readonly WeaponProbeRow[]): ReadonlyMap<string, WeaponMedians> {
  const groups = new Map<string, WeaponProbeRow[]>();
  for (const r of rows) {
    const key = `${r.enemy}@${r.depth}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = new Map<string, WeaponMedians>();
  for (const [key, list] of groups) {
    const metrics = list.map((r) => probeMetrics(r.counts));
    out.set(key, {
      secondsPerKill: median(metrics.flatMap((m) => (m.secondsPerKill === null ? [] : [m.secondsPerKill]))),
      hitsPer60: median(metrics.map((m) => m.hitsPer60)),
    });
  }
  return out;
}

/** 値 ÷ 中央値。中央値が 0 以下・値が無ければ null */
function versusMedian(value: number | null, med: number | null): number | null {
  if (value === null || med === null || med <= 0) return null;
  return value / med;
}

/** 比を「1.23」の形に。目標の幅を外れたら * を付ける */
function ratioCell(r: number | null, tolerance: number): string {
  if (r === null) return "-";
  return `${r.toFixed(2)}${Math.abs(r - 1) > tolerance ? "*" : ""}`;
}

/** 武器種 × 敵の節（見出し込み）。重いので `npm run qa:probe -- --weapons` だけでも出せるよう、報告全体から切り出してある */
export function buildWeaponSection(cfg: ProbeConfig, rows: readonly WeaponProbeRow[]): string[] {
  if (rows.length === 0) return [];
  const setup = cfg.weaponProbe;
  const medians = weaponMedians(rows);
  const lines: string[] = [];
  lines.push("## 武器種 × 敵");
  lines.push("");
  lines.push(
    `装備なし（素の能力）のまま武器種だけ替え、bot「${PROBE_BOT_LABEL[setup.bot]}」で 1 回 ${setup.seconds} 秒 × seed ${setup.seeds.length}（${setup.seeds.join(", ")}）。` +
      "銃・投擲物は器（右手のベース）ごとに 1 行（弾倉・溜め・三点・刺さり・弧が器ごとに違うため）。近接は器で弾が変わらないので 1 行。" +
      "bot は左の連撃の連打だけ（銃の家系は押しっぱなしで撃ち、溜め撃ちは最大段で離し、曲射は敵の位置を指す。リロード・右レーン・構えは押さない。弾倉が尽きたら本体が自動で込める）。型どうしの釣り合いを見る表で、重さの補償を調整する前後で比べる。",
  );
  lines.push("");
  lines.push(
    `- 比 = その武器種の値 ÷ 同じ敵・深度での武器種をまたいだ中央値。\`*\` は目標の幅の外（撃破秒は ±${WEAPON_KILL_TOLERANCE * 100}%、被弾/60秒は ±${WEAPON_HIT_TOLERANCE * 100}%）`,
  );
  lines.push("- 撃破 0 のとき撃破秒は「-」（60 秒で 1 体も倒せない）");
  lines.push("");
  const extraHeaders = WEAPON_EXTRA_COLUMNS.map((c) => c.header);
  const headers = ["武器種", "器", "敵", "深度", "撃破秒", "撃破秒の比", "被弾/60秒", "被弾の比", ...extraHeaders];
  lines.push(mdRow(headers));
  lines.push(mdRow(new Array<string>(headers.length).fill("---")));
  for (const r of rows) {
    const m = probeMetrics(r.counts);
    const med = medians.get(`${r.enemy}@${r.depth}`);
    lines.push(
      mdRow([
        r.moveset,
        r.base ?? "-",
        r.enemy,
        String(r.depth),
        fixed(m.secondsPerKill, 2),
        ratioCell(versusMedian(m.secondsPerKill, med?.secondsPerKill ?? null), WEAPON_KILL_TOLERANCE),
        fixed(m.hitsPer60, 1),
        ratioCell(versusMedian(m.hitsPer60, med?.hitsPer60 ?? null), WEAPON_HIT_TOLERANCE),
        ...WEAPON_EXTRA_COLUMNS.map((c) => c.value(r.counts)),
      ]),
    );
  }
  lines.push("");
  return lines;
}
