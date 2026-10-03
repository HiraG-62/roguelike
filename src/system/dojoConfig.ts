import { ENEMIES, enemyDef } from "../data/enemies";
import { DOJO } from "../data/tuning";
import { formatMeters } from "../core/units";
import type { DamageTapKind, EliteKind } from "../core/state";
import { ELITE_PREFIX, eliteKindsFor } from "./elites";
import { DUMMY_KEY } from "./specialRooms";

/**
 * 稽古の間の設定（docs/ideas/dojo.md）。稽古帳の行と、その値の巡回・表示名を持つ純関数の集まり。
 * 保存しない（拠点を出入りしても同じ拠点の間は覚えているが、ゲームを閉じると既定に戻る）
 */

/** 敵の動き。normal = 本編どおり / anchored = その場で攻める（動かない）/ passive = 追うだけ（攻めない）/ still = 棒立ち */
export type DojoBehavior = "normal" | "anchored" | "passive" | "still";
export const DOJO_BEHAVIORS: readonly DojoBehavior[] = ["normal", "anchored", "passive", "still"];
export const DOJO_BEHAVIOR_LABEL: Readonly<Record<DojoBehavior, string>> = {
  normal: "本気",
  anchored: "その場で攻める",
  passive: "追うだけ",
  still: "棒立ち",
};

/** 敵の並び。line = 正面に横一列 / ring = 自分を囲む / scatter = 正面に散らばる（決まった配置。乱数を使わない） */
export type DojoFormation = "line" | "ring" | "scatter";
export const DOJO_FORMATIONS: readonly DojoFormation[] = ["line", "ring", "scatter"];
export const DOJO_FORMATION_LABEL: Readonly<Record<DojoFormation, string>> = {
  line: "横一列",
  ring: "囲む",
  scatter: "散らばる",
};

export interface DojoConfig {
  /** 敵の key（dojoEnemyKeys のどれか） */
  enemy: string;
  count: number;
  /** 敵を作るときの深度（生命・威力・怯みの深度の伸び） */
  depth: number;
  /** 付けるエリート修飾子。null = 付けない */
  elite: EliteKind | null;
  behavior: DojoBehavior;
  /** 攻撃間隔の時計の速さの倍率（1 = 本編どおり） */
  tempo: number;
  formation: DojoFormation;
  /** 自分の湧き位置から敵の並びまでの距離（px） */
  distance: number;
  /** 敵が倒れない（生命が減っても毎ステップ満タンへ戻す。傷は計測に入る） */
  undying: boolean;
  /** 全滅したら湧き直す */
  respawn: boolean;
  /** 自分が傷を受けない（受けた傷は計測の「被弾」に数える） */
  invincible: boolean;
  /** 気力が減らない */
  infiniteMana: boolean;
  /** 奥義ゲージが減らない */
  infiniteEnergy: boolean;
  /** 時間の速さ（1 = 等速） */
  timeScale: number;
}

/** 稽古帳の行。値の行は ←→ で巡回し、動作の行（respawnNow / resetMeter / restore）は決定で実行する */
export type DojoRowKey =
  | "enemy"
  | "count"
  | "depth"
  | "elite"
  | "behavior"
  | "tempo"
  | "formation"
  | "distance"
  | "undying"
  | "respawn"
  | "invincible"
  | "infiniteMana"
  | "infiniteEnergy"
  | "timeScale"
  | "respawnNow"
  | "resetMeter"
  | "restore";

export type DojoValueRowKey = Exclude<DojoRowKey, DojoActionRowKey>;
export type DojoActionRowKey = "respawnNow" | "resetMeter" | "restore";

export const DOJO_ROWS: readonly DojoRowKey[] = [
  "enemy",
  "count",
  "depth",
  "elite",
  "behavior",
  "tempo",
  "formation",
  "distance",
  "undying",
  "respawn",
  "invincible",
  "infiniteMana",
  "infiniteEnergy",
  "timeScale",
  "respawnNow",
  "resetMeter",
  "restore",
];

export const DOJO_ROW_LABEL: Readonly<Record<DojoRowKey, string>> = {
  enemy: "相手",
  count: "数",
  depth: "深さ",
  elite: "修飾",
  behavior: "動き",
  tempo: "攻めの速さ",
  formation: "並び",
  distance: "間合い",
  undying: "倒れない",
  respawn: "湧き直し",
  invincible: "無傷",
  infiniteMana: "気力が尽きない",
  infiniteEnergy: "奥義ゲージが尽きない",
  timeScale: "時の流れ",
  respawnNow: "今すぐ湧き直す",
  resetMeter: "計測を始めから",
  restore: "生命・気力・奥義を満たす",
};

const ACTION_ROWS: ReadonlySet<DojoRowKey> = new Set<DojoRowKey>(["respawnNow", "resetMeter", "restore"]);

export function isDojoActionRow(key: DojoRowKey): key is DojoActionRowKey {
  return ACTION_ROWS.has(key);
}

/** 変えたら敵を湧き直す行（数・種類・並びが変わる）。他の行は今いる敵にそのまま効く */
const RESPAWN_ROWS: ReadonlySet<DojoRowKey> = new Set<DojoRowKey>(["enemy", "count", "depth", "elite", "formation", "distance"]);

export function dojoRowRespawns(key: DojoRowKey): boolean {
  return RESPAWN_ROWS.has(key);
}

/**
 * 稽古の間で選べる敵。木人が先頭、続いて本編の並び（ENEMIES の順）。
 * ボス・ボスの部位（ボス部屋の state が要る。ボスは御堂で挑める）と商人・壺（戦う相手ではない）を除く
 */
export function dojoEnemyKeys(): string[] {
  const rest = ENEMIES.filter((d) => d.key !== DUMMY_KEY && d.boss !== true && d.bossPart !== true && d.merchant !== true && d.container === undefined);
  return [DUMMY_KEY, ...rest.map((d) => d.key)];
}

/** その敵に付けられる修飾子（先頭の null = 付けない） */
export function dojoEliteOptions(enemy: string): (EliteKind | null)[] {
  return [null, ...eliteKindsFor(enemyDef(enemy))];
}

export function defaultDojoConfig(): DojoConfig {
  return {
    enemy: DUMMY_KEY,
    count: DOJO.defaultCount,
    depth: DOJO.defaultDepth,
    elite: null,
    behavior: "normal",
    tempo: 1,
    formation: "line",
    distance: DOJO.defaultDistance,
    undying: true,
    respawn: true,
    invincible: false,
    infiniteMana: false,
    infiniteEnergy: false,
    timeScale: 1,
  };
}

/** 並びの中で dir（±1）だけ巡回した次の値。今の値が並びに無ければ先頭 */
function cycle<T>(options: readonly T[], current: T, dir: number): T {
  const i = options.indexOf(current);
  const n = options.length;
  const first = options[0];
  if (first === undefined) return current;
  if (i < 0) return first;
  return options[(((i + dir) % n) + n) % n] ?? first;
}

const BOOL_OPTIONS: readonly boolean[] = [false, true];

/**
 * 値の行を dir（-1 / +1）だけ巡回した新しい設定を返す（元は書き換えない）。
 * 相手を替えたら、その敵に付けられない修飾子は外す
 */
export function cycleDojoRow(config: DojoConfig, key: DojoValueRowKey, dir: number): DojoConfig {
  switch (key) {
    case "enemy": {
      const enemy = cycle(dojoEnemyKeys(), config.enemy, dir);
      const elite = config.elite !== null && dojoEliteOptions(enemy).includes(config.elite) ? config.elite : null;
      return { ...config, enemy, elite };
    }
    case "count":
      return { ...config, count: cycle(DOJO.countOptions, config.count, dir) };
    case "depth":
      return { ...config, depth: cycle(DOJO.depthOptions, config.depth, dir) };
    case "elite":
      return { ...config, elite: cycle(dojoEliteOptions(config.enemy), config.elite, dir) };
    case "behavior":
      return { ...config, behavior: cycle(DOJO_BEHAVIORS, config.behavior, dir) };
    case "tempo":
      return { ...config, tempo: cycle(DOJO.tempoOptions, config.tempo, dir) };
    case "formation":
      return { ...config, formation: cycle(DOJO_FORMATIONS, config.formation, dir) };
    case "distance":
      return { ...config, distance: cycle(DOJO.distanceOptions, config.distance, dir) };
    case "timeScale":
      return { ...config, timeScale: cycle(DOJO.timeScaleOptions, config.timeScale, dir) };
    case "undying":
    case "respawn":
    case "invincible":
    case "infiniteMana":
    case "infiniteEnergy":
      return { ...config, [key]: cycle(BOOL_OPTIONS, config[key], dir) };
  }
}

const ON_LABEL = "する";
const OFF_LABEL = "しない";
const NO_ELITE_LABEL = "なし";

function timesLabel(v: number): string {
  return `${v} 倍`;
}

/** 修飾子の表示名（「迅速の」→「迅速」）。接頭の「の」を落として行の値にする */
export function dojoEliteLabel(kind: EliteKind | null): string {
  if (kind === null) return NO_ELITE_LABEL;
  return ELITE_PREFIX[kind].replace(/の$/, "");
}

/** 行の今の値の表示。動作の行は空文字 */
export function dojoRowValueLabel(config: DojoConfig, key: DojoRowKey): string {
  switch (key) {
    case "enemy":
      return enemyDef(config.enemy).name;
    case "count":
      return `${config.count} 体`;
    case "depth":
      return `地下 ${config.depth} 階`;
    case "elite":
      return dojoEliteLabel(config.elite);
    case "behavior":
      return DOJO_BEHAVIOR_LABEL[config.behavior];
    case "tempo":
      return timesLabel(config.tempo);
    case "formation":
      return DOJO_FORMATION_LABEL[config.formation];
    case "distance":
      return formatMeters(config.distance);
    case "timeScale":
      return timesLabel(config.timeScale);
    case "undying":
    case "respawn":
    case "invincible":
    case "infiniteMana":
    case "infiniteEnergy":
      return config[key] ? ON_LABEL : OFF_LABEL;
    case "respawnNow":
    case "resetMeter":
    case "restore":
      return "";
  }
}

// -----------------------------------------------------------------------------
// 計測の表示（system/dojoMeter.ts が作り、render/dojoUi.ts が読む）
// -----------------------------------------------------------------------------

/** 与えた傷の出どころ。dot = 継続ダメージ（燃焼など silent の命中）/ other = 付帯の命中（proc） */
export type DojoDamageKind = DamageTapKind;
export const DOJO_DAMAGE_KINDS: readonly DojoDamageKind[] = ["melee", "ranged", "skill", "dot", "other"];
export const DOJO_DAMAGE_KIND_LABEL: Readonly<Record<DojoDamageKind, string>> = {
  melee: "近接",
  ranged: "射撃",
  skill: "スキル",
  dot: "継続",
  other: "付帯",
};

export interface DojoMeterView {
  /** 計測の秒（最初の命中から。DOJO.meterIdleSec 傷が入らなければ時計を止める） */
  elapsed: number;
  /** 与えた傷の合計（倒れない敵への超過ぶんも含む） */
  total: number;
  /** total / elapsed（elapsed が 0 なら 0） */
  dps: number;
  /** 直近 DOJO.meterWindowSec 秒の傷 / その秒 */
  recentDps: number;
  hits: number;
  crits: number;
  /** 1 発の最大 */
  maxHit: number;
  byKind: Readonly<Record<DojoDamageKind, number>>;
  /** 受けた傷の合計と回数（無傷のときも数える） */
  taken: number;
  takenHits: number;
  kills: number;
}
