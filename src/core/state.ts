import type { Rng } from "./rng";
import type { Vec } from "./vec";
import type { GameMap, Rect } from "../map/grid";
import type { FloorItem, PlayerStats, Profile } from "../loot/types";
import type { SfxName } from "../audio/sfxNames";

export type GameStatus = "playing" | "dead";

export interface Body {
  pos: Vec;
  vel: Vec;
  radius: number;
}

export type AttackPhase = "none" | "windup" | "active" | "recover";

export interface AttackState {
  /** 現在のコンボ段 (0 始まり)。none のときは次に出す段 */
  combo: number;
  phase: AttackPhase;
  timer: number;
  /** recover 中に押された次段の先行入力 */
  buffered: boolean;
  /** この振りで既に当てた敵 */
  hitIds: Set<number>;
  dir: Vec;
}

export interface Player {
  body: Body;
  hp: number;
  maxHp: number;
  facing: Vec;
  dashTimer: number;
  dashCooldown: number;
  dashDir: Vec;
  invulnTimer: number;
  hitFlash: number;
  /** 被弾ノックバック速度。減衰する */
  knock: Vec;
  /** このダッシュで既にジャスト回避を発生させたか */
  dodgedThisDash: boolean;
  attack: AttackState;
  shootCooldown: number;
  energy: number;
  maxEnergy: number;
  /** 歩行アニメ用 */
  walkTime: number;
  /** 残りダッシュ回数。dashCooldown が 0 になるたびに 1 回復する */
  dashChargesLeft: number;
  /** トリガー定義の index → 内部クールダウン残り秒 */
  triggerCooldowns: Map<number, number>;
  buffs: PlayerBuffs;
  /** JUST 回避後のダメージ倍率が有効な残り秒 */
  justTimer: number;
  /** 近接ヒットの通算数（everyNthMeleeHit 用） */
  meleeHitCount: number;
  /** hpRegen の端数 */
  regenAcc: number;
}

export interface TimedMul {
  time: number;
  mul: number;
}

export interface PlayerBuffs {
  damage: TimedMul;
  speed: TimedMul;
  /** 残り無敵秒 */
  invuln: number;
}

export type EnemyPhase = "idle" | "chase" | "windup" | "strike" | "recover" | "stagger" | "spawning";

export interface Enemy {
  id: number;
  defKey: string;
  roomIndex: number;
  body: Body;
  hp: number;
  maxHp: number;
  facing: Vec;
  phase: EnemyPhase;
  phaseTimer: number;
  strikeDir: Vec;
  attackCooldown: number;
  hitFlash: number;
  /** ノックバック速度。減衰する */
  knock: Vec;
  animTime: number;
  effects: EnemyEffects;
}

export interface BurnEffect {
  time: number;
  dps: number;
  /** 1 未満の端数ダメージ */
  acc: number;
}

export interface ChillEffect {
  time: number;
  /** 0..1。移動と phaseTimer の進行がこの割合だけ遅くなる */
  slow: number;
}

export interface EnemyEffects {
  burn: BurnEffect;
  chill: ChillEffect;
}

/** ダメージの出どころ。melee / ranged だけが on-hit 効果とトリガーを起こす */
export type DamageKind = "melee" | "ranged" | "proc";

export interface Projectile {
  id: number;
  owner: "player" | "enemy";
  pos: Vec;
  vel: Vec;
  radius: number;
  damage: number;
  life: number;
  color: string;
  kind: DamageKind;
  /** 既に当てた敵（貫通用） */
  hitIds: Set<number>;
  pierceLeft: number;
  /** 撃った敵の id（thorns 用）。プレイヤー弾は undefined */
  sourceId?: number;
}

/** リング（衝撃波）と線（連鎖雷）の演出 */
export interface ShapeFx {
  kind: "ring" | "line";
  pos: Vec;
  /** line の終点 */
  to: Vec;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface Particle {
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  /** 空気抵抗。1 で減衰なし */
  drag: number;
}

export interface FloatingText {
  pos: Vec;
  vel: Vec;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export type PickupKind = "heart";

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec;
  radius: number;
  bobTime: number;
}

export interface RoomState {
  rect: Rect;
  cleared: boolean;
  locked: boolean;
  /** 部屋の出入口となる床タイルのインデックス。ロック中は壁扱い */
  doorTiles: number[];
}

export interface Camera {
  pos: Vec;
  shake: number;
  offset: Vec;
}

export interface Combo {
  count: number;
  timer: number;
  best: number;
  /** HUD の拡大演出用 */
  popTimer: number;
}

export interface LogMessage {
  text: string;
  color: string;
  time: number;
}

export interface GameState {
  seed: number;
  seedText: string;
  rng: Rng;
  status: GameStatus;
  depth: number;
  /** 固定ステップの通し番号 */
  tick: number;
  /** ゲーム内経過時間（スローモーション込み） */
  time: number;
  map: GameMap;
  rooms: RoomState[];
  lockedTiles: Set<number>;
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  particles: Particle[];
  texts: FloatingText[];
  pickups: Pickup[];
  camera: Camera;
  /** 残りヒットストップ（ステップ数） */
  hitstop: number;
  /** 残りスローモーション（実時間秒） */
  slowmo: number;
  /** 画面全体の白フラッシュ (0..1) */
  flash: number;
  combo: Combo;
  kills: number;
  score: number;
  nextId: number;
  log: LogMessage[];
  /** 死亡してからの実時間 */
  deathTimer: number;
  /** 永続プロフィール（装備・stash）。ラン中に拾ったものは即ここに入る */
  profile: Profile;
  /** 装備から畳み込んだ派生ステータス。ゲームロジックは必ずこれを通す */
  stats: PlayerStats;
  /** 床に落ちているアイテム */
  floorItems: FloorItem[];
  /** 装備画面などで一時停止中 */
  paused: boolean;
  /** 今フレームに鳴らす効果音。main.ts が毎フレーム drain する */
  sfx: SfxName[];
  shapes: ShapeFx[];
  /** 死亡時の recordRun を 1 回だけにする */
  runRecorded: boolean;
}

export function allocId(state: GameState): number {
  return state.nextId++;
}

/** 同じフレームに同じ音を重ねない */
export function pushSfx(state: GameState, name: SfxName): void {
  if (state.sfx.includes(name)) return;
  state.sfx.push(name);
}

export function pushLog(state: GameState, text: string, color = "#c0c0c0"): void {
  state.log.push({ text, color, time: state.time });
}
