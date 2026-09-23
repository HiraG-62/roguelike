import type { Rng } from "./rng";
import type { Vec } from "./vec";
import type { GameMap, Rect } from "../map/grid";
import type { Attributes, FloorItem, LootRuntime, PendingBud, PlayerStats, Profile } from "../loot/types";
import type { StatusBag } from "./status";
import type { TerrainLayer } from "./terrain";
import type { SfxName } from "../audio/sfxNames";
import type { SkillRunState } from "../skills/types";
import type { BoonChoice, BoonKey, BoonRunState } from "../system/boons";

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
  /** トリガー内容ベースのキー（triggerCooldownKey）→ 内部クールダウン残り秒。装備変更で index がずれても混線しない */
  triggerCooldowns: Map<string, number>;
  buffs: PlayerBuffs;
  /** JUST 回避後のダメージ倍率が有効な残り秒 */
  justTimer: number;
  /** 近接ヒットの通算数（everyNthMeleeHit 用） */
  meleeHitCount: number;
  /** ks_overclock: 射撃の HP コストは overclockShootInterval 発に 1 回。その通算カウント */
  overclockShotCount: number;
  /** lifeOnHit の 0.1 秒あたり回復上限を管理する窓 */
  lifeOnHitWindow: { timer: number; healed: number };
  /** リゲイン: 近接ヒットで取り戻せる残り HP（HP バーの「取り戻せる分」） */
  regainPool: number;
  /** リゲイン: 取り戻せる残り秒。0 で regainPool も消える */
  regainTimer: number;
  /** リゲイン: 近接 1 ヒットで戻る量 */
  regainStep: number;
  /** JUST 回避カウンターを受け付ける残り秒 */
  justCounterTimer: number;
  /** JUST 回避カウンターの飛び先（回避した攻撃の敵 id）。無ければ null */
  justCounterTargetId: number | null;
  /** ダッシュ中に攻撃が押された（ダッシュ終了でダッシュ攻撃を出す） */
  dashAttackQueued: boolean;
  /** 今の振りがダッシュ攻撃か（attack.combo の段ではなく ACTION.dashAttack を使う） */
  dashStrike: boolean;
  /** スキルの資源（docs/COMBAT_DESIGN.md B）。上限は stats.maxMana */
  mana: number;
  /** プレイヤーに付いた状態異常（docs/COMBAT_DESIGN.md E） */
  status: StatusBag;
  /** 装備の性質の作業領域（余韻斬り・形見。src/system/traitHooks.ts） */
  loot: LootRuntime;
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

/** 怯みは phase ではなく状態異常 stagger で持つ（docs/COMBAT_DESIGN.md D-4） */
export type EnemyPhase = "idle" | "chase" | "windup" | "strike" | "recover" | "spawning";

/** 敵の怯みの蓄積（docs/COMBAT_DESIGN.md D） */
export interface PoiseState {
  /** 深度・エリート・ボスの成長を掛けた現在の耐性。0 は怯まない */
  max: number;
  damage: number;
  /** 最後に怯み値を受けてからの秒 */
  sinceHit: number;
  /** ボスのダウン回数 */
  downs: number;
}

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
  /** エリート修飾子（src/system/elites.ts） */
  elite?: EliteKind;
  /** Shielded: hp の上乗せぶんのシールド量。hp > maxHp - shieldMax の間はシールドが残っている */
  shieldMax?: number;
  /** Linked の HP 共有用: 前ステップの hp */
  lastHp?: number;
  /** 追加敵・ボスの行動用の作業領域 */
  ai?: EnemyAi;
  /** 強い吹き飛び中（近接 3 段目など）。壁に激突すると追加ダメージ（壁叩きつけ） */
  wallSplat?: boolean;
  /** 統一の状態異常（燃焼・冷気・感電・怯みなど。src/system/statusEffects.ts） */
  status: StatusBag;
  poise: PoiseState;
  /** 性質「撃ち込み杭」で刺さった弾の数（次の近接命中で爆ぜる。src/system/traitHooks.ts） */
  stuckShots?: number;
  /** 群れの長・楽団長・双子の相方など、紐付いた敵の id（src/system/enemies.ts） */
  leaderId?: number;
  /** マナ喰いが奪ったマナ。倒すと倍にして返す */
  stolenMana?: number;
  /** 撃破ではなく消えた（自爆・時間切れ）。死後の報酬や置き土産を出さない */
  vanished?: boolean;
  /** 墓守の鐘が死骸から蘇らせた。倒してもドロップ・撃破数・死骸を出さない（蘇生と撃破の繰り返しで稼がせない） */
  revived?: boolean;
  /** 新しいエリート修飾子の作業領域（src/system/elites.ts） */
  eliteWork?: EliteWork;
}

export type EliteKind =
  | "explosive"
  | "reflective"
  | "shielded"
  | "hasted"
  | "linked"
  | "echoing"
  | "contagious"
  | "bulwark"
  | "retaliating"
  | "prismatic"
  | "timed"
  | "parasitic"
  | "anchored"
  | "devouring"
  | "packed";

/** エリート修飾子ごとの状態（刻限の時計・報復の遅延・残響の残り回数など） */
export interface EliteWork {
  /** 汎用タイマー（刻限の残り秒・報復までの秒） */
  timer: number;
  /** 汎用カウンタ（残響の残り回数） */
  count: number;
  /** 前ステップで怯んでいたか（怯んだ瞬間を拾う） */
  wasStaggered: boolean;
  /** 初回処理（群長の取り巻き生成）を済ませたか */
  initialized: boolean;
}

/** 敵が倒れた跡。骨拾い・墓守の鐘・貪食の が使う（src/system/enemies.ts） */
export interface Corpse {
  id: number;
  defKey: string;
  pos: Vec;
  roomIndex: number;
  /** 残り秒 */
  time: number;
  /** 置かれた階。階が変わったら捨てる */
  depth: number;
}

export interface EnemyAi {
  /** 狙う地点（レーザーの向き先、ジャンプの着地点など） */
  target: Vec;
  /** 汎用タイマー */
  timer: number;
  /** 汎用カウンタ（弾幕の斉射数など） */
  counter: number;
  /** ボスのフェーズ（1 始まり） */
  stage: number;
  /** 行動の種類（ボスの技の選択など） */
  move: number;
  /** 地点の列（残像打ちの位置の履歴・霜の巨人のつららの落下点など） */
  points?: Vec[];
}

export type HazardKind = "bomb" | "laser" | "shockwave" | "landing" | "boneWall";

/** 地面に残る攻撃（爆弾・レーザー・衝撃波）と、その予告 */
export interface Hazard {
  id: number;
  kind: HazardKind;
  pos: Vec;
  /** laser の終点 */
  to: Vec;
  radius: number;
  /** 残り時間 */
  time: number;
  maxTime: number;
  damage: number;
  /** 既にダメージを与えたか（1 回だけ当たるもの用） */
  spent: boolean;
  /** boneWall のタイルインデックス */
  tile: number;
  /** 出した敵の id */
  sourceId?: number;
  /** 出した敵の種類（倒された後も状態異常の付与元を引けるように） */
  sourceKey?: string;
  /** landing: 出した敵の位置に付いて動く（自爆の範囲。src/system/hazards.ts の syncLanding） */
  followSource?: boolean;
}

export interface BossState {
  enemyId: number;
  name: string;
  roomIndex: number;
  /** 「ボス」表示の残り時間 */
  introTimer: number;
  defeated: boolean;
}

/** 同じフロアに長居すると湧く無敵の追跡者 */
export interface Reaper {
  pos: Vec;
  radius: number;
  animTime: number;
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
  /** プレイヤー弾の最終の怯み値（poiseDamageMul 込み）。命中時に HitOptions.poise へ渡す。未指定は 0 */
  poise?: number;
  /** 同じ射撃で出た弾の共有カウンタ（マナ回収の上限 MANA.shotVolleyCap 用）。projectiles.ts が付ける */
  volley?: { manaHits: number };
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

/** 部屋の種類（src/system/roomTypes.ts）。ボス部屋は normal のまま boss.ts が管理する */
export type RoomKind = "normal" | "treasure" | "challenge" | "shrine" | "ambush";

/** フロア種別。rooms / dark は部屋+通路、cave はセルオートマトンの洞窟 */
export type FloorKind = "rooms" | "cave" | "dark";

export interface RoomState {
  rect: Rect;
  cleared: boolean;
  locked: boolean;
  /** 部屋の出入口となる床タイルのインデックス。ロック中は壁扱い */
  doorTiles: number[];
  kind: RoomKind;
  /** challenge: 今の波（1 始まり。0 = 未開始） */
  wave: number;
  /** shrine: 泉を使ったか */
  used: boolean;
  /** 矩形でない部屋（洞窟の塊）の所属タイル。無ければ rect が部屋 */
  tiles?: ReadonlySet<number>;
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
  /** スキル（永続の石 + ラン内の CD・刻印符・発動中状態）。docs/ideas/skills.md */
  skills: SkillRunState;
  hazards: Hazard[];
  /** 地形の層（水たまり・油・溶岩…。src/system/terrain.ts）。フロアが変わると作り直す */
  terrain: TerrainLayer;
  /** 敵の死骸（src/system/enemies.ts） */
  corpses: Corpse[];
  /** このフロアのボス。ボス階以外は null */
  boss: BossState | null;
  /** 今のフロアに入ってからの経過秒 */
  floorTime: number;
  reaper: Reaper | null;
  floorKind: FloorKind;
  /** shrine の泉を使った代償。次にロックする部屋のエリート率が上がる */
  cursed: boolean;
  /** 探索済みタイル（ミニマップ用）。1 = 探索済み */
  explored: Uint8Array;
  /** このフロアで探索済みになったタイルの順番。描画側はここの差分だけ塗る */
  exploredLog: number[];
  /** ラン内限定の祝福（src/system/boons.ts） */
  boons: BoonKey[];
  /** 祝福 3 択の提示中。非 null の間は step が選択入力だけを処理する */
  boonChoice: BoonChoice | null;
  boonRun: BoonRunState;
  /** 装備の芽（来歴の節目で出る 2 択）の提示中。UI が表示し、system/loot.ts の chooseBud で選ぶ */
  pendingBud: PendingBud | null;
  /** ラン内のステータス振り分け（docs/COMBAT_DESIGN.md A-3）。ランで消える */
  runAttributes: {
    alloc: Attributes;
    /** 未振りの点。装備画面（src/ui/attributeAlloc.ts）で振る */
    unspent: number;
  };
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
