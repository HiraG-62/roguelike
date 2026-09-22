import type { Rng } from "./rng";
import type { Vec } from "./vec";
import type { GameMap, Rect } from "../map/grid";

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
}

export interface Projectile {
  id: number;
  owner: "player" | "enemy";
  pos: Vec;
  vel: Vec;
  radius: number;
  damage: number;
  life: number;
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
}

export function allocId(state: GameState): number {
  return state.nextId++;
}

export function pushLog(state: GameState, text: string, color = "#c0c0c0"): void {
  state.log.push({ text, color, time: state.time });
}
