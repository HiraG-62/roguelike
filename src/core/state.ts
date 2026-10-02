import type { FrameInput } from "./input";
import type { AttackProfile } from "./element";
import type { Rng } from "./rng";
import type { Vec } from "./vec";
import type { GameMap, Rect } from "../map/grid";
import type { FloorLayout } from "../map/layout/types";
import type { FloorItem, LootRuntime, PendingBud, PlayerStats, Profile } from "../loot/types";
import type { StatusApply, StatusBag } from "./status";
import type { TerrainKind, TerrainLayer } from "./terrain";
import type { SfxName } from "../audio/sfxNames";
import type { FloorStone, SkillRunState } from "../skills/types";
import type { BoonChoice, BoonKey, BoonRunState } from "../system/boons";
import type { ReforgeChoice } from "../system/reforge";
import type { ReforgeKey } from "../data/reforges";
import type { ChainRecord, EventKind, GameEvent, RecentEvent, RuleRunState } from "./events";
import type { RoomSpecial, StairsChoice } from "../system/specialRooms";
import type { ExitReward } from "../system/exits";
import type { RunEventState } from "../system/runEvents";
import type { ContractState } from "../system/contractors";
import type { OriginKey, RunModKey } from "../system/runSetup";
import type { ButtonKey, ShotRuntime } from "../data/weapons";
import type { JobKey } from "../data/jobs";
import type { FormationKey } from "../data/formations";
import type { CodexRun } from "../meta/codex";
import type { QuestRun } from "../meta/quests";
import type { HurtLog } from "./hurt";
import type { NemesisRun } from "../system/nemesis";
import type { RunMetaSetup } from "../system/runMeta";

/** playing = 進行中 / dead = 力尽きた / cleared = 最深の主を倒して地上への道に着いた（踏破） */
export type GameStatus = "playing" | "dead" | "cleared";

/** ランが終わった（死亡でも踏破でも）。step が進まず、終わりの画面と入力待ちに移る */
export function runOver(state: { status: GameStatus }): boolean {
  return state.status !== "playing";
}

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
  /**
   * 武器種の段（0 始まり。src/data/weapons.ts の steps の添字）。combo は祝福・スキルが読む「1 段目 / 途中 / 最終段(2)」に丸めた値。
   * 5 段の双剣でも最終段だけが combo 2 になる
   */
  step: number;
  /** 今の振りの溜めの段（0 = 溜めなし） */
  chargeLevel: number;
  /** 攻撃キーを押して溜めている最中か（大剣）と、その秒数 */
  charging: boolean;
  chargeTime: number;
  /** 今の振りがコンボ派生なら MovesetDef.branches の添字、でなければ -1 */
  branch: number;
  /** 振っている最中に成立した派生（今の振りの後に出す）。無ければ -1 */
  pendingBranch: number;
  /** 派生の照合に使う直近の入力列（左 = primary / 右 = secondary） */
  inputs: ButtonKey[];
  /** 入力列を保つ残り秒。0 で振っていなければ列を捨てる */
  inputTimer: number;
  /** 多段ヒットの今の区切り（0 始まり） */
  hitTick: number;
  /**
   * 今の振りのレーン（左 = primary の steps / 右 = secondary の steps2。派生は最後に押したボタン）。step は左右で共有する
   * （docs/ideas/ougi-and-dual-actions.md 4.2）。振っていないときの step は次に出す段で、入力の窓が切れると 0 に戻る
   */
  lane: ButtonKey;
  /** 先行入力（buffered）がどちらのボタンか */
  bufferedLane: ButtonKey;
  /** 今の振りを始めた state.time（出端の判定: 振り始めに敵が黄だったか。system/readTiming.ts） */
  startedAt: number;
  /** この振りで「出端か普通の命中か」の出来事（音・イベント・応手）を出し済みの敵。多段でも 1 振り × 1 体に 1 回にする */
  readIds: Set<number>;
}

/**
 * 奥義の作業領域（docs/ideas/ougi-and-dual-actions.md 3.2。src/system/ultimates.ts）。
 * active = 持続（sustain）の奥義の key（一撃の奥義は state に残らない）、elapsed = 持続の経過秒、
 * kills = 持続中に倒した数（終了時の onBurst の量）、auraTick = 周囲ダメージの次の刻みまでの秒、
 * quakeCooldown = 命中の衝撃波（SustainDef.hitQuake）の次に出せるまでの秒
 */
export interface UltimateState {
  active: string | null;
  elapsed: number;
  kills: number;
  auraTick: number;
  quakeCooldown: number;
}

export interface Player {
  body: Body;
  hp: number;
  maxHp: number;
  /** 持っている瓶の本数（上限は stats.flaskMax。system/flask.ts） */
  flasks: number;
  /** 次に瓶を飲める state.time（連打で 2 本空けないため） */
  flaskReadyAt: number;
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
  /** 戦闘中の回復（命中・撃破・祝福）の共通上限の窓（1 秒。HEAL.sustainWindow） */
  lifeOnHitWindow: { timer: number; healed: number };
  /** リゲイン: 近接ヒットで取り戻せる残り HP（HP バーの「取り戻せる分」） */
  regainPool: number;
  /** リゲイン: 取り戻せる残り秒。0 で regainPool も消える */
  regainTimer: number;
  /** リゲイン: 近接 1 ヒットで戻る量 */
  regainStep: number;
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
  /** チャージ射撃（溜め撃ちの弾）: 攻撃キー（左クリック / attackHeld）を押して溜めている最中か、その秒数 */
  shotCharging: boolean;
  shotChargeTime: number;
  /** 前フレームに右クリック（固有技のキー）を押していたか。右の押した瞬間を取るため */
  secondaryWasHeld: boolean;
  /**
   * ヒットストップ中に押した受け流し / ダッシュの席（1 つ。止めが明けた最初のステップで出す。system/player.ts の latchFrozenInput）。
   * input はダッシュの向きを押した時の移動入力で決めるための写し。未指定 = 空
   */
  guardBuffer?: { kind: "parry" | "dash"; input: FrameInput };
  /** ヒットストップ中に押した攻撃のボタン（止めが明けた最初のステップで押したことにする）。guardBuffer とは後から押した方だけ残る */
  frozenAttack?: ButtonKey;
  /** 照準（カーソル）までの距離 px。曲射の落下点に使う。マウス照準が無ければ undefined（射程いっぱい）。applyAim が毎ステップ更新 */
  aimDistance?: number;
  /**
   * 三点撃ち（burst を持つ弾）の残り弾数と次の弾までの秒、二丁拳銃の銃口の左右（1 / -1。撃つたびに入れ替える）。
   * docs/ideas/combat-feel-design.md B-1 / B-2
   */
  shotBurst: { left: number; timer: number; side: number };
  /** 近接命中の直後、攻撃方向へ一瞬伸びる残り秒（FEEL.swingImpact。docs/ideas/combat-feel-design.md D-5） */
  swingImpact: number;
  /**
   * 右レーン（アクション 2）の振り以外の段（src/system/weaponArts.ts）。
   * cooldown = 弾・手元返しの段を出した後の共有の間（WEAPON.artDefaults.laneGap）の残り秒、holding / holdTime = 構え・受け流し・狙い撃ちを押している最中とその秒、
   * recover = 受け流しを外した硬直の残り秒、cooldowns = 右レーンの段（ActionStepDef.key）ごとの再使用の残り秒
   */
  art: { cooldown: number; holding: boolean; holdTime: number; recover: number; cooldowns: Map<string, number> };
  /**
   * 全武器共通の受け流し（src/system/parry.ts）。window = 受け流しが有効な残り秒、recover = 外した硬直の残り秒。
   * 剣の右 1 段目の構えの受け流し（art）とは別の状態
   */
  parry: { window: number; recover: number };
  /** 奥義（F）の作業領域 */
  ultimate: UltimateState;
  /**
   * 戦意（武器の型ごとのゲージ。system/morale.ts）。value = 今の量、sinceGain = 最後に溜まってからの秒（冷め）、
   * window = 装填の窓など型固有の残り秒、primed = 次の一撃が放出、full = 前ステップで満ちていた（充溢の瞬間の検出）、
   * swingUnits = 今の振りが放出なら使った戦意（0 = 放出でない。振りの開始で決まり、その振りの間の倍率になる）
   */
  morale: { value: number; sinceGain: number; window: number; primed: boolean; full: boolean; swingUnits: number };
  /**
   * 共通の瞬間の作業領域（system/moments.ts）。firstStrikeArmed = 次の一撃が先制、idleSec = 交戦の外にいる秒、
   * lastHitLane / lastHitAt = 双撃の判定に使う直前の命中のレーンと時刻、swingRiposte = 今の振りで応手を数えた、
   * backstabUntil = 背面扱いが残る時刻（段取り 5c の影潜り）、wardUntil = 結界が残る時刻（段取り 5d の護り足）
   */
  moment: {
    firstStrikeArmed: boolean;
    idleSec: number;
    lastHitLane: ButtonKey | null;
    lastHitAt: number;
    swingRiposte: boolean;
    backstabUntil: number;
    wardUntil: number;
  };
  /** 遅れて受ける傷（逆さ時計・不動。docs/ideas/boon-impl.md 2-6）。due = 受ける state.time。未指定 = 遅らせていない */
  deferredDamage?: { amount: number; due: number }[];
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
  /** 攻撃中（strike）に耐性を超えた: 技を出し切った後で怯む（system/poise.ts の settlePendingStagger）。蓄積は満杯で止まる */
  pending: boolean;
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
  /** 今の予備動作の総秒（コミット窓の判定用。0 = 未記録で、窓なし = 従来どおり怯む） */
  windupTotal: number;
  /** 今の予備動作が始まった state.time（system/readTiming.ts の markWindupStart）。省略は未記録 */
  windupAt?: number;
  /** その予備動作が赤になった state.time（noteCommit）。windupAt 未満は「まだ赤でない」 */
  committedAt?: number;
  /** 連撃の 2 撃目以降の予備動作。最初からコミット（怯み値が溜まらず必ず出る）。startWindup が毎回戻す */
  chainWindup?: boolean;
  strikeDir: Vec;
  attackCooldown: number;
  hitFlash: number;
  /** ノックバック速度。減衰する */
  knock: Vec;
  animTime: number;
  /** エリート修飾子（src/system/elites.ts） */
  elite?: EliteKind;
  /** 属する陣の id（GameState.jins の Jin.id）。roomIndex は陣が占める塊のまま。陣に属さない敵（湧き・召喚・敗走中）は undefined */
  jinId?: number;
  /** 格「強」（猛〜）。並は無印、精鋭は elite。判定は data/enemyRoles.ts の gradeOf */
  grade?: "strong";
  /** 敗走中（system/jin.ts の stepRout）。陣から外れ roomIndex は ROAMING_ROOM。攻撃せず行き先の陣へ逃げる */
  rout?: EnemyRout;
  /** 処刑で倒された（群勢の減りを足す。system/poise.ts の tryExecute が立てる） */
  executed?: boolean;
  /** Shielded:hp の上乗せぶんのシールド量。hp > maxHp - shieldMax の間はシールドが残っている */
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
  /** 2 つ目のエリート修飾子（深層の相乗の組だけ。src/system/elites.ts の ELITE_PAIRS） */
  eliteExtra?: EliteKind;
  /** 鼓舞（帯電・急かし・旗の加護）。src/system/enemyTerrain.ts */
  rally?: EnemyRally;
  /** 潜行中（土潜り・天井吊り・影踏み）。描かれず、攻撃も当たらない */
  hidden?: boolean;
  /**
   * 二度突きの猪の突進の折れ線（src/system/enemyBehaviors.ts）。予備動作の始まりに決まり、予告線もこれを描く。
   * turn = 1 本目の終点（ここで曲がる）、end = 2 本目の終点、leg = 今走っている線
   */
  doubleCharge?: { turn: Vec; end: Vec; leg: 1 | 2 };
  /** 強欲のが拾った床の遺物・スキル石（src/system/elites.ts）。倒すと落とし、階を移るときはプレイヤーの足元へ落とす */
  carried?: { items: FloorItem[]; stones: FloorStone[] };
  /** 鎖の型で繋がれている残り秒（docs/ideas/weapon-forms-impl.md 3-4。段取り 5b）。未指定 = 繋がれていない */
  linked?: number;
  /** 溜め（氷獄 = 凍結中の傷 / 月蝕 = 宣告に溜まる傷）。Rule 効果 releaseVault で一度に出す。未指定 = 溜めなし（docs/ideas/boon-impl.md 2-6） */
  vault?: { kind: VaultKind; amount: number };
  /** 味方になっている間の終わりの state.time（Rule 効果 tameEnemy。system/rules.ts の isAllied）。未指定 = 敵のまま */
  allyUntil?: number;
  /** 仇（前のランで倒された相手。system/nemesis.ts）。名札に「仇・」、倒すと仇討ち */
  nemesis?: true;
}

/** 敵に溜める傷の種類（氷獄 = ice / 月蝕 = doom） */
export type VaultKind = "ice" | "doom";

/** 支援役の敵が周りの敵に掛ける一時的な強化（docs/ideas/enemies.md 0 章「鼓舞」） */
export type RallyKind = "charged" | "hastened" | "warded";

export interface EnemyRally {
  kind: RallyKind;
  /** 残り秒 */
  time: number;
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
  | "packed"
  // ---- Wave 3（docs/ideas/enemies.md 4 章 M5 / M6 / M7 / M10 / M18）----
  | "searing"
  | "hexing"
  | "commanding"
  | "evasive"
  | "chaining"
  // ---- 敵の未実装分（docs/ideas/enemies.md M12）----
  | "greedy";

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
  /** 徘徊の目的地（src/system/spawner.ts が書く。idle の間だけここへ歩く） */
  roam?: Vec;
  /** 徘徊で進めていない秒（詰まったら目的地を選び直す） */
  roamStuck?: number;
  /** 盗賊王: 追い詰められている秒（src/system/bossThiefKing.ts） */
  cornered?: number;
  /** 反応ルール（system/enemyReactions.ts）: 直近の被弾を数える窓の残り秒 */
  hitWindow?: number;
  /** 反応ルール: 窓の中で殴られた回数（閾値で間合い取りへ） */
  hitCount?: number;
  /** 反応ルール: 間合い取り（プレイヤーから離れる）の残り秒 */
  retreat?: number;
  /** ボスの読み（src/system/bossKit.ts の updateBossRead が毎ステップ書く。技の枝の材料） */
  read?: BossReadMemory;
  /** ボス: 行為で進む段階の数え（追い詰めのダウン・引火・壁激突・門柱） */
  progress?: number;
  /** スライム王: 呑んだ分裂体の数（消化し終えると回復。src/system/bossKingSlime.ts） */
  digest?: number;
  /** ボス: 今の連撃の何段目か（0 = 連撃でない。BossHooks.followUp が読む） */
  chain?: number;
}

/** ボスがプレイヤーを読むための記憶（位置の差分から静止・遠さ・ダッシュを数える） */
export interface BossReadMemory {
  /** 前のステップのプレイヤーの位置 */
  lastPos: Vec;
  /** 止まっている秒（動くと 0） */
  stillSec: number;
  /** 前に技を選んでから遠い間合いにいた秒 */
  farSec: number;
  /** 最後にダッシュを見てからの秒 */
  dashAgo: number;
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
  /** landing: 跳躍の滞空秒。予備動作の後の strike（空中）の間も影を残し、着地で消す（system/enemyLeap.ts） */
  airTime?: number;
  /** boneWall の残り耐久（docs/ideas/enemies.md H6。爆発・壁叩きつけ・弾で削れる） */
  hp?: number;
  /** bomb の爆発が敵にも当たる（爆裂のエリートの死後の爆発。H10） */
  hitsEnemies?: boolean;
}

/** 敵が作る地形の予約（予告の影を出してから置く。src/system/enemyTerrain.ts） */
export interface TerrainSeed {
  pos: Vec;
  kind: TerrainKind;
  radius: number;
  /** 置くまでの残り秒 */
  time: number;
  /** 置いた地形の持続（秒） */
  duration: number;
  /** 予約した階。階が変わったら捨てる */
  depth: number;
}

export interface BossState {
  enemyId: number;
  name: string;
  roomIndex: number;
  /** 「ボス」表示の残り時間 */
  introTimer: number;
  defeated: boolean;
  /** 5 の倍数の階の階層ボス（BOSS_ROTATION）。false は毎階の「階の主」（system/floorLord.ts） */
  major: boolean;
  /** 部屋が封鎖されてからプレイヤーが受けた被弾の数（system/bossRecord.ts） */
  hits?: number;
  /** 部屋が封鎖された時点の floorTime（announceBoss が書く） */
  lockedAt?: number;
  /** 自傷のダウン（bossDown）の回数。怯みのダウン（poise.downs）と合わせて記録する */
  selfDowns?: number;
}

/** 撃破したボスの記録（最深の主の「第三の顔」と QA が読む。system/bossRecord.ts） */
export interface BossRecord {
  key: string;
  depth: number;
  /** 封鎖から撃破までの秒 */
  seconds: number;
  /** 封鎖中の被弾の数 */
  hits: number;
  /** ダウンの回数（怯み + 自傷） */
  downs: number;
}

/**
 * 隠し部屋（system/hiddenRoom.ts・map/hidden.ts）。壁の中に埋めたポケットで、開くまで tiles / doorTile は
 * すべて Tile.Wall のまま（GameMap.tiles には反映されない）。5 の倍数の階（isBossDepth）では生成しない
 */
export interface HiddenRoom {
  /** 押し当てて開ける壁タイル */
  doorTile: number;
  /** ポケットの床タイル（doorTile を含まない） */
  tiles: readonly number[];
  /** ポケット内の階段タイル */
  stairsTile: number;
  /** 開いたときに行ける次のフロア種別 */
  nextKind: FloorKind;
  opened: boolean;
  /** 扉タイルに体を押し当てている秒数。離れると 0 に戻る */
  hold: number;
  /** 手がかり（ログ・音）を出したか */
  hinted: boolean;
  /** 風の粒子を次に出すまでの秒（hinted の間だけ進む） */
  windTimer: number;
}

/** 同じフロアに長居すると湧く無敵の追跡者 */
export interface Reaper {
  pos: Vec;
  radius: number;
  animTime: number;
  /** バリアント（src/system/reaper.ts。省略は既定の死神） */
  variant?: ReaperVariant;
  /** バリアントの汎用タイマー（鎖の間隔・取り立ての待ち・影の湧き直し） */
  timer?: number;
  /** 鎖の死神の狙い（予告線の終点）。投げていなければ undefined */
  aim?: Vec;
  /** 鎖の予告の残り秒（0 より大きい間は予告線を出す） */
  charging?: number;
  /** 双子の死神のもう 1 体 */
  twin?: Vec;
  /** 取り立て屋が取り立てを終えて去った（この階ではもう追わない） */
  departed?: boolean;
}

/** 死神のバリアント（docs/ideas/enemies.md 6 章） */
export type ReaperVariant = "default" | "chain" | "collector" | "twin" | "shadow" | "silent";

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
  /** 銃の弾の作業領域（跳弾の残り・設置弾。src/data/weapons.ts）。無ければ単発と同じ */
  shot?: ShotRuntime;
  /** この弾自身の攻撃素性（投擲の技など）。未指定なら今の銃の弾（stats.bullet）から引く */
  attack?: AttackProfile;
  /** 弾の代わりに武器の絵を回して描く（斧の投擲など。ThrowArtDef.sprite）。未指定は既定の弾の絵 */
  sprite?: string;
  /** 命中で溜まる奥義ゲージ（銃の射撃だけ。system/combat.ts の shotHitEnergy）。未指定は溜めない */
  energy?: number;
  /** 命中・炸裂で敵に付ける状態異常（ThrowArtDef.applies。付与元は player）。未指定は付けない */
  applies?: readonly StatusApply[];
  /** 撃ったレーン（双撃の判定。system/moments.ts）。未指定 = レーンに属さない弾（スキルなど） */
  lane?: ButtonKey;
  /** 放出の弾（長銃の満ちた 1 発など）。finisher = 終撃になる、crit = 必ず会心。未指定 = 放出でない */
  release?: { finisher: boolean; crit: boolean };
  /** 放出の弾を撃った state.time（出端の判定: 撃った時に敵が黄だったか）。放出の弾だけが持つ */
  firedAt?: number;
  /** 零距離で撃った短銃の弾（盾持ちの盾を抜ける。撃った時に 1 回だけ測る）。未指定 = 偽 */
  pointBlank?: boolean;
  /** 命中ごとに戻る気力（ThrowArtDef.mana。左の詠唱が近接の段の気力を引き継ぐ）。未指定は MANA.onShot */
  shotMana?: number;
}

/** リング（衝撃波）と線（連鎖雷）の演出 */
export interface ShapeFx {
  kind: "ring" | "line";
  /** 振りの残像の線（player.ts の spawnTrail）。武器種の専用スプライトがあるときは描画側が描かない */
  swingTrail?: true;
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
  /** 自分の銃口の粒の生まれた位置（描画側が描いた銃口へ付け替える基準。ロジックは読まない） */
  muzzleFrom?: Vec;
}

export interface FloatingText {
  pos: Vec;
  vel: Vec;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
  /** 浮き文字の種類（docs/ideas/meta-and-weapons.md 7-19。描画が大きさ・縁取り・揺れを変える）。省略は label */
  kind?: FloatTextKind;
  /** 自分の頭上の技名（system/effects.ts の addHeadLabel）。新しい語が出たら前の語を消して 1 つだけにする */
  head?: boolean;
}

/**
 * 浮き文字の種類。ダメージの数字: 通常 / 会心 / 弱点 / 耐性 / 状態異常の継続 / 反応。
 * 文字: status = 敵の状態（弱点・反応名・粉砕…）/ label = 技名・自分の状態・拾い物の名前 / notice = 告知（奥義名・CLEAR・ボスや部屋）
 */
export type FloatTextKind = "normal" | "crit" | "weak" | "resist" | "dot" | "reaction" | "status" | "label" | "notice";

/** 撃破の演出の種類（src/system/effects.ts が最後の一撃と状態異常から決める）。burst は従来の飛び散りだけ */
export type DeathFxKind = "burst" | "ash" | "shatter" | "discharge" | "melt" | "blood" | "sever" | "void" | "holy";

export interface DeathFx {
  kind: DeathFxKind;
  /** 描くスプライトを引くための敵の key */
  defKey: string;
  pos: Vec;
  flip: boolean;
  /** 両断の切り口・血飛沫の向き（ラジアン） */
  angle: number;
  age: number;
  life: number;
}

/**
 * 奥義の見た目の出来事（system/ultimates.ts が積み、render/fxUltimate.ts が奥義ごとのスプライトで描く）。
 * cast = 発動、act = 一撃の行為（index は行為の並びの番号）、target = 行為が掴んだ敵（引き寄せ）、
 * aura = 持続の纏いの 1 回、quake = 持続の命中の衝撃波、end = 持続の終わりの行為（index は onEnd の番号）
 */
export type UltFxPart = "cast" | "act" | "target" | "aura" | "quake" | "end";

export interface UltFx {
  /** 奥義の key（`<武器種>.<名前>`） */
  key: string;
  part: UltFxPart;
  index: number;
  /** 原点（発動した位置・周囲攻撃の中心・突進の始点） */
  pos: Vec;
  /** 終点（突進の終点・引き寄せた敵の位置）。無ければ pos と同じ */
  to: Vec;
  /** 向き（ラジアン。照準の方向） */
  angle: number;
  /** 大きさ（周囲攻撃の半径・振りの届き。px。無ければ 0） */
  size: number;
  age: number;
  life: number;
}

/** 時間で消える演出の印（src/render/effectsUi.ts が種類ごとに描く） */
export type FxMarkKind =
  | "clearWave"
  | "eliteBurst"
  | "bossLight"
  | "justRing"
  | "synergyGlow"
  | "weakCrack"
  | "critFlash"
  | "doorSlam"
  | "chargeUp"
  | "dropBeam"
  | "dashGhost"
  | "budBloom"
  /** 受け流しの成功（描画は render/fxAttack.ts のスプライト） */
  | "parry"
  | "inscribe"
  /** 出端の墨の飛沫（描画は render/effectsUi.ts。座標ハッシュで散らす） */
  | "debanaSplash"
  /** ボス階の主の間への引き込み（value 0 = 元の位置で消える墨の渦、1 = 先で現れる渦） */
  | "lordPull";

export interface FxMark {
  kind: FxMarkKind;
  pos: Vec;
  age: number;
  life: number;
  color: string;
  /** 種類ごとの値（clearWave / doorSlam = 部屋の番号、critFlash = 敵 id、chargeUp = 段、dashGhost = 1 なら左向き） */
  value: number;
}

/** 演出だけの状態。ロジックは読まない（読むのは render と effects.ts だけ） */
export interface EffectsState {
  /** 演出専用の乱数の内部状態。state.rng を消費しないので、粒の数を変えてもゲームの結果は変わらない */
  seed: number;
  deaths: DeathFx[];
  marks: FxMark[];
  /** 奥義の見た目の出来事 */
  ults: UltFx[];
  /** 色ごとのドロップ音を鳴らし終えた floorItems の id の最大値 */
  lastDropId: number;
  /** 連携の残光を出し終えた chains の最新時刻 */
  lastChainTime: number;
  /** ダッシュの残像を置く間隔の残り秒 */
  ghostTimer: number;
  /** 処刑された敵の id（死に方を両断にする）。無ければ -1 */
  executedId: number;
  // ---- 演出と音の第 3 弾（docs/ideas/meta-and-weapons.md 7・8 章）----
  /** カウンター成立の白黒の残り秒（7-10） */
  counterMono: number;
  /** 白黒を出し終えた onCounter の state.time */
  lastCounterTime: number;
  /** 継続ダメージの浮き文字を束ねる途中の合計（7-19。毎 tick 数字を出すと画面が埋まる） */
  dots: DotTally[];
  /** 芽吹きを出し終えた芽（itemId|節目）。提示が無ければ空文字（7-15） */
  lastBudKey: string;
  /** 前ステップで気力が満タンだったか（8-8 の満ちた瞬間の検出） */
  manaFull: boolean;
  /** 死神の出現までの残り秒（警告中だけ。reaper.ts が書く）。警告していなければ null */
  reaperWarnLeft: number | null;
  /** 死神の近さ 0..1（8-14 の鼓動の間隔）。0 は鳴らさない */
  reaperThreat: number;
  /** 次の鼓動までの残り秒 */
  heartbeatTimer: number;
  /** 同じ語を続けて出さないための、語ごとに最後に出した state.time（addFloatingTextOnce の sameWordSec。使うまで作らない: 階の構築の指紋 floorIdentity.test.ts が state 全体を JSON にするため） */
  wordAt?: Record<string, number>;
  /** 音ごとに最後に積んだ state.time（system/debana.ts の pushSfxSpaced。同じ音を短い間に重ねない。使うまで作らない） */
  sfxAt?: Record<string, number>;
}

/** 継続ダメージの浮き文字の束（敵 1 体ぶん） */
export interface DotTally {
  enemyId: number;
  pos: Vec;
  amount: number;
  color: string;
  /** 束ね始めてからの秒 */
  age: number;
}

export type PickupKind = "heart" | "coin" | "key" | "flask";

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec;
  radius: number;
  bobTime: number;
  // ---- 銭・鍵（src/system/economy.ts。docs/ideas/economy-impl.md 2-2）----
  /** 銭の額 */
  value?: number;
  /** 残り秒。undefined = 消えない */
  life?: number;
  /** 持ち主の銭（被弾でこぼれた・撒いた）。拾い直しは稼ぎに数えない */
  spilled?: true;
  /** 散る速さ（px/秒。毎秒 ECONOMY.coin.friction で減衰） */
  vel?: Vec;
  /** この秒が過ぎるまで引き寄せず拾えない（こぼれた銭が即戻らないように） */
  settle?: number;
  /** 拾ったときの稼ぎの源（省略は撃破。壺・木箱の銭は "container"） */
  source?: CoinSource;
}

/** 銭の源（QA と「稼ぐ」型の集計。表示には出さない）。spill = こぼれた銭の拾い直し（稼ぎに数えない） */
export type CoinSource = "kill" | "jin" | "room" | "floor" | "event" | "contract" | "container" | "bet" | "sell" | "rule" | "spill";
/** 銭の使い道（集計用） */
export type SpendKind = "flask" | "item" | "rune" | "key" | "reroll" | "skill" | "cursedItem" | "keystone" | "contract" | "bet" | "donation" | "toll" | "rule";

/** ラン内の通貨（src/system/economy.ts）。死ぬと state ごと消える */
export interface EconomyState {
  coins: number;
  keys: number;
  /** このランで稼いだ総額（源別。こぼれた銭の拾い直しは数えない）。「稼ぐ」型と QA が読む */
  earned: Record<CoinSource, number>;
  /** このランで使った総額（用途別） */
  spent: Record<SpendKind, number>;
  /** 被弾・撒きで床へ出た持ち金の総額 / 拾い直した総額 */
  spilled: number;
  recovered: number;
  /** 撃破で床に落ちた銭の総額 / 拾われずに消えた総額（こぼれた銭は含まない。QA の拾えなかった割合） */
  dropped: number;
  expired: number;
  /** 品ごとに買った回数（同じ品は買うたび値上がり。system/merchants.ts） */
  bought: Partial<Record<WareKind, number>>;
  /** 怒らせた商人を倒した（以後このランの値段 ×ECONOMY.market.outlawPriceMul） */
  outlaw: boolean;
  /** 旅商人（peddler）の近くで敵を倒して助けた（以後このランの値段 ×(1 − ECONOMY.market.peddlerDiscount)） */
  peddlerSaved: boolean;
  /** 張っている賭け（1 つだけ。system/bets.ts） */
  bet: ActiveBet | null;
  /** 賭けの型ごとの記録（QA の集計。表示には出さない） */
  betStats: Partial<Record<BetKind, BetRecord>>;
  /** 大穴の陣を出した章（同じ章は ECONOMY.bet.jackpotPerChapter 回まで） */
  jackpotChapters: number[];
  /** この階の商人（実体は Enemy。buildFloor の最後で作り直す） */
  merchants: Merchant[];
  /** このランで寄進した銭。main.ts が endRun で HubSave へ足す（step の中では保存しない。system/donation.ts） */
  donated: number;
}

/**
 * 商人の種類（system/merchants.ts）。market = 毎階の前室の市 / chapterMarket = 章ボス階の前室の章の市 /
 * peddler = 階を歩く旅商人 / blackMarket = 隠し部屋の闇市
 */
export type MerchantKind = "market" | "chapterMarket" | "peddler" | "blackMarket";

/**
 * 賭けの型（system/bets.ts）。運: chohan 丁半 / longshot 大穴 / allIn 一か八か / doubleUp 倍々勝負。
 * 腕: unscathed 無傷 / swift 速攻 / parries 凌ぎ（受け流しと見切りの回数）
 */
export type BetKind = "chohan" | "longshot" | "allIn" | "doubleUp" | "unscathed" | "swift" | "parries";
/** 腕の賭けの難しさ（易 / 難 / 至難） */
export type BetTier = "easy" | "hard" | "extreme";

/** 張っている賭け（運の丁半・大穴・一か八かは張った瞬間に決まるので、ここに残るのは倍々勝負と腕の型） */
export interface ActiveBet {
  kind: BetKind;
  /** 払った賭け金 */
  stake: number;
  /** 勝てば賭け金に掛ける倍率（倍々勝負は今の倍率） */
  mul: number;
  /** 束縛した陣（無傷・速攻。張った後に最初に起きた陣。null = まだ） */
  jinId: number | null;
  /** 張った state.time */
  signedAt: number;
  /** 凌ぎの数えた回数 / 倍々勝負の勝った回数 */
  count: number;
  /** 凌ぎの必要回数 / 速攻の秒（無傷・倍々勝負は 0） */
  target: number;
  /** 腕の型の難しさ（無傷は束縛した陣で決まる。運の型は null） */
  tier: BetTier | null;
  /** 大穴の陣（無傷の変種。倍率は ECONOMY.bet.jackpotMul） */
  jackpot: boolean;
  /** 凌ぎの数え: 最後に読んだ state.recent の受け流し・見切り（差分を数える） */
  seen: Partial<Record<"onParry" | "onJustDodge", RecentEvent>>;
}

/** 賭けの型ごとの記録（QA） */
export interface BetRecord {
  placed: number;
  won: number;
  /** 払った賭け金の総額 / 払い戻しの総額 */
  staked: number;
  paid: number;
  /** 腕の型の難しさごとの決着の数と勝ち */
  tiers: Partial<Record<BetTier, { settled: number; won: number }>>;
}
/**
 * 品の種類。reroll = 仕入れ直し（売れた品を並べ直し、値段を引き直す）。
 * 闇市だけの品: skill = 未所持のスキル石 / cursedItem = 反転の遺物（反転した性質を必ず持つ）/ keystone = 誓約 1 つ
 */
export type WareKind = "flask" | "item" | "rune" | "key" | "reroll" | "skill" | "cursedItem" | "keystone";

/** 商人の台座の品（触れて買う。contractors.ts の ContractOffer と同じ作法） */
export interface Ware {
  kind: WareKind;
  /** 品の細目（闇市のスキル石は SkillKey、誓約は keystone の key。それ以外は空） */
  key: string;
  /** 今の値段（base に買った回数・無法者の倍率を掛けたもの。変わるたびに merchants.ts が書き直す） */
  price: number;
  /** 置いたときに引いた値段（章の倍率 × 揺らぎ） */
  base: number;
  pos: Vec;
  used: boolean;
  /** false の間は触れても反応しない（離れると true。連打と出現直後の誤爆を防ぐ） */
  armed: boolean;
}

/** 商人（台座を並べる人。体は state.enemies の Enemy で、殴られると怒る） */
export interface Merchant {
  enemyId: number;
  kind: MerchantKind;
  /** 立ち位置（倒れた後に品を落とす場所・名札） */
  pos: Vec;
  wares: Ware[];
  /** 近づいたときの一言を出したか */
  greeted: boolean;
  /** 殴られて怒った（以後は品を投げてくる。売らない） */
  provoked: boolean;
  /** 仕入れ直しをした回数（その値段が rerollStep ずつ上がる） */
  rerolls: number;
  /** false = 旅商人がまだ店を広げていない（台座を出さず、売らない）。省略 = 広げている（市・章の市・闇市） */
  open?: boolean;
  /** 旅商人の歩く先（spawner.ts の pickRoamTarget で選ぶ）。省略 = 歩かない */
  roam?: Vec;
  /** 旅商人が進めずにいる秒（ROAM.stuckTime で歩く先を選び直す） */
  roamStuck?: number;
  /** 旅商人が襲われて助けを求めた（一言を 1 回だけ出す） */
  alarmed?: boolean;
}

/** 部屋の種類（src/system/roomTypes.ts）。ボス部屋は normal のまま boss.ts が管理する */
export type RoomKind =
  | "normal"
  | "treasure"
  | "challenge"
  | "shrine"
  | "ambush"
  // ---- 以下ラン構造の拡張（src/system/specialRooms.ts。docs/ideas/run-expansion.md 2 章）----
  | "altar"
  | "library"
  | "arena"
  | "gamble"
  | "forge"
  | "exchange"
  | "curseShrine"
  | "resonance"
  | "escort"
  | "escape"
  | "reaperNest"
  | "nest"
  | "mirror"
  | "watchtower"
  // ---- 開放型フロア（src/system/spawner.ts）: 入ると封鎖して波で大量に湧く巣窟 ----
  | "horde"
  // ---- ラン構造の第 2 弾（src/system/specialRooms.ts）----
  | "vault"
  | "elementAltar"
  | "dummyHall"
  | "fogRoom"
  | "tideRoom"
  | "invertHall";

/**
 * フロア種別。rooms / dark は部屋+通路、cave はセルオートマトンの洞窟。
 * forge 以降はバイオーム（形・地形・敵の出現表・色調。src/system/biomes.ts）
 */
export type FloorKind = "rooms" | "cave" | "dark" | "forge" | "ossuary" | "swamp" | "glacier" | "mine" | "meadow";

/**
 * どの部屋にも属さない敵の roomIndex（Enemy.roomIndex / EliteWork の判定などが使う）。
 * 徘徊・通路の陣「長蛇」（system/jinSpawn.ts）・敗走した敵・盗みなどの増援が使う。
 * spawner.ts から使うファイルが多いので spawner.ts が re-export する
 */
export const ROAMING_ROOM = -1;

/** 陣の進行: 眠っている / 交戦中 / 決着済み */
export type JinPhase = "sleeping" | "engaged" | "settled";

/** 音: 眠っている敵を起こす一時的な輪（GameState.noises。中心と半径） */
export interface Noise {
  pos: Vec;
  radius: number;
}

/**
 * 陣: 敵の一団が陣形を組んで占める戦いの単位（docs/ideas/jin-impl.md 2-5）。部屋を置き換えず、部屋の塊の上に乗る。
 * メンバーは Enemy.jinId を持つ。buildFloor で作り直す
 */
export interface Jin {
  id: number;
  /** 占める塊。長蛇・物見は ROAMING_ROOM */
  roomIndex: number;
  formation: FormationKey;
  center: Vec;
  /** 正面（開始側の隣の塊へ向く）。陣形の並びの向き */
  facing: Vec;
  /** 大将の敵 id。いない陣は null */
  leaderId: number | null;
  /** 群勢（士気）。moraleMax は生成時のメンバーの重さの合計 */
  morale: number;
  moraleMax: number;
  phase: JinPhase;
  /** 最初に起きた state.time（無傷の決着の判定。system/economy.ts）。眠ったままなら undefined */
  engagedAt?: number;
  /** 決着の種類（全滅 / 敗走）。settled のとき */
  settledBy?: "wipe" | "rout";
  /** 陣ごとの生命の揺らぎ（JIN.hpSpread から陣を作るとき 1 回引く）。メンバー全員の生命に掛かる。HUD には出さない */
  hpMul: number;
  /** 後詰（第 2 波）を起こす floorTime。null なら無し */
  secondWaveAt: number | null;
  /** 同じ tick の撃破数（一網打尽の判定） */
  deathsTick: number;
  deathsInTick: number;
  /** 増援の代わりに長蛇へ変わって歩き出した（system/jin.ts の stirSleepingJin。1 陣 1 回） */
  stirred?: boolean;
  /** 大将の撃破で崩れた（決着の内訳。QA が数える） */
  leaderFell?: boolean;
  /** この陣から敗走した敵の行く末（QA が数える） */
  routTally?: JinRoutTally;
}

/** 敗走した敵の行く末の数（逃げ出した数 = 合流 + 討伐 + 逃げ切り + まだ逃げている） */
export interface JinRoutTally {
  fled: number;
  merged: number;
  killed: number;
  escaped: number;
}

/** 敗走中の敵の行き先と時計（system/jin.ts） */
export interface EnemyRout {
  /** 逃げ出した陣の id（QA の内訳用） */
  fromJin: number;
  /** 合流しに行く陣の id。行き先が無ければ null（プレイヤーの反対へ逃げ、時間切れで消える） */
  toJin: number | null;
  /** 合流する点（行き先の陣の先頭のメンバーの位置。retargetSec ごとに取り直す） */
  dest: Vec | null;
  /** 合流を諦めるまで / 逃げ切るまでの残り秒 */
  time: number;
  /** 行き先を見直すまでの残り秒 */
  recheck: number;
}

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
  /** 特別な部屋の作業領域（台座・炉の色・護衛対象など。src/system/specialRooms.ts） */
  special?: RoomSpecial;
  /** 封鎖しない部屋で交戦が始まった（入った・敵が気付いた）。全滅でその部屋を制圧する（src/system/floor.ts） */
  engaged?: boolean;
  /** 出口の予告「危険」で強制した部屋。制圧報酬が倍になる（src/system/exits.ts） */
  danger?: true;
}

export interface Camera {
  pos: Vec;
  shake: number;
  offset: Vec;
  /** 攻撃方向へのキック（重撃・撃破）。減衰して 0 へ戻る（system/camera.ts の cameraKick） */
  kick: Vec;
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
  /** 陣（部屋の塊の上に乗る敵の一団）。buildFloor で作り直す */
  jins: Jin[];
  /** 今ステップに鳴った音（ダッシュ・命中・爆発）。眠っている敵が聞きつける。updateEnemies が読んで空にする（system/noise.ts） */
  noises: Noise[];
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
  /**
   * ヒットストップの強度（0..ui/settings.ts の HITSTOP_SCALE_MAX、既定 1）。設定画面で変えられ、
   * ラン中の変更も main.ts が即座にここへ書き戻す。0 でヒットストップ無効。system/effects.ts の hitstop() が掛ける
   */
  hitstopScale: number;
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
  /** 演出だけの状態（src/system/effects.ts の fxState が初回に作る） */
  effects?: EffectsState;
  /** 死亡時の recordRun を 1 回だけにする */
  runRecorded: boolean;
  /** 拠点の state。来歴・石の使い込み・ラン記録・ドロップへ書かない（src/system/hub.ts） */
  sandbox?: true;
  /** スキル（永続の石 + ラン内の CD・刻印符・発動中状態）。docs/ideas/skills.md */
  skills: SkillRunState;
  hazards: Hazard[];
  /** 地形の層（水たまり・油・溶岩…。src/system/terrain.ts）。フロアが変わると作り直す */
  terrain: TerrainLayer;
  /** 敵の死骸（src/system/enemies.ts） */
  corpses: Corpse[];
  /** 敵が作る地形の予約（油・毒沼・氷床…。省略時は無し。src/system/enemyTerrain.ts） */
  terrainSeeds?: TerrainSeed[];
  /** このフロアのボス。ボス階以外は null */
  boss: BossState | null;
  /** このランで撃破した階層ボスの記録（古い順。system/bossRecord.ts） */
  bossLog: BossRecord[];
  /** 最後の被弾の出どころ（死因と仇の種。system/deathCause.ts。乱数を引かない） */
  hurt: HurtLog;
  /** このランの仇（runMeta.nemesis があるときだけ。system/nemesis.ts） */
  nemesis: NemesisRun | null;
  /** このフロアの隠し部屋。無ければ null（system/hiddenRoom.ts が buildFloor の末尾で毎階作り直す） */
  hiddenRoom: HiddenRoom | null;
  /** 今のフロアに入ってからの経過秒 */
  floorTime: number;
  reaper: Reaper | null;
  floorKind: FloorKind;
  /** このフロアの面積の倍率（基準の大きさ = 1。省略時は 1。buildFloor が BALANCE.world.MAP_SIZE の範囲で抽選。system/floor.ts） */
  floorAreaMul?: number;
  /** このフロアで実際に使った階の型（旧生成器は "legacy"）。次の階の chooseLayout が同じ型を続けないために読む。system/floor.ts */
  floorLayout?: FloorLayout;
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
  /** ラン内の改鋳（取得順。永続化しない。data/reforges.ts）。武器の型の段・戦意・起点を書き換える */
  reforges: ReforgeKey[];
  /** 改鋳 3 択の提示中（5 の倍数の階のボスの後）。非 null の間は step が選択入力だけを処理する（system/reforge.ts） */
  reforgeChoice: ReforgeChoice | null;
  /** 装備の芽（来歴の節目で出る 2 択）の提示中。UI が表示し、system/loot.ts の chooseBud で選ぶ */
  pendingBud: PendingBud | null;
  /** このランで芽を出した遺物の id（1 ランに 1 つまで。BUD.perRunPerItem。永続化しない。loot/provenance.ts の recordProvenance が積む） */
  budOfferedThisRun: string[];
  // ---- ラン構造（起点・縛り・祭壇・ランイベント・分岐路。docs/ideas/run-expansion.md）----
  /** 祭壇・起点がこのランだけ与えた誓約の key（applyStats が装備の誓約に足す） */
  runKeystones: string[];
  /** ランイベント・長居の代償・落下物の予告（src/system/runEvents.ts） */
  runEvents: RunEventState;
  /** ラン修飾子（縛り）。起点画面で積む（src/system/runSetup.ts） */
  modifiers: RunModKey[];
  /** ラン開始時に選んだ起点 */
  origin: OriginKey;
  /** ラン開始時に選んだジョブ（src/data/jobs.ts。none = 見習い） */
  job: JobKey;
  /** このランで抽選に出ない名のある遺物（RunSetup.lockedRelics の写し） */
  lockedRelics: readonly string[];
  /** ランの外から持ち込む中身（仇・封じ・位階の見返り。RunSetup.runMeta の写し。system/runMeta.ts） */
  runMeta: RunMetaSetup;
  /** この階の階段と、降りた先のフロア種別（分岐路） */
  stairs: StairsChoice[];
  /** 降りた階段の出口の予告（system/exits.ts）。buildFloor の末尾で到着報酬を確定して消す */
  pendingExit: ExitReward | null;
  /** 契約者・結んだ契約・鍛冶や祭壇の属性・占いの予言（src/system/contractors.ts） */
  contracts: ContractState;
  /** 銭・鍵（ラン内の通貨。src/system/economy.ts）。契約者との取引と封印庫の解錠に使う。死ぬと消える */
  economy: EconomyState;
  // ---- 統一ルール文法（src/core/events.ts / src/system/rules.ts。docs/ideas/synergy-web.md 3 章）----
  /** 今ステップに system が積んだイベント。resolveRules が照合して空にする */
  events: GameEvent[];
  /** Rule の効果が起こしたイベント（深さ +1）。次ステップの resolveRules で照合する */
  pendingEvents: GameEvent[];
  /** 種類ごとの直近の発生（条件 recent と UI 用） */
  recent: Partial<Record<EventKind, RecentEvent>>;
  /** Rule の id → 内部 CD の残り秒 */
  ruleIcd: Map<string, number>;
  /** 直近に成立した連鎖（新しい順ではなく起きた順。上限 SYNERGY.chainLog） */
  chains: ChainRecord[];
  ruleRun: RuleRunState;
  // ---- メタ進行の記録（src/meta/runRecord.ts が積むだけ。ゲーム進行には効かない。ラン終了時に main.ts が保存）----
  /** 図鑑: このランで見た・倒した敵、反応、連鎖、場所 */
  codexRun: CodexRun;
  /** 依頼: 受けた依頼とラン中の数え上げ */
  questRun: QuestRun;
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
