import { type AttackProfile, attack } from "../core/element";
import { type KeywordProfile, kw } from "../core/keywords";
import type { EventKind } from "../core/events";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import { STATUS_KINDS, type StatusApply, type StatusKind } from "../core/status";
import { TERRAIN_KINDS, type TerrainKind } from "../core/terrain";
import { ATTR_KEYS, type AttrKey, type AttrRatio, type Scaling } from "../loot/types";
import { ACTION, MANA, PLAYER, WEAPON } from "./tuning";

/**
 * 武器種（通常攻撃の型・左右のアクションの連撃と派生）と弾（BulletDef）の型。docs/COMBAT_DESIGN.md「武器種」/ docs/ideas/weapon-redesign.md。
 * 右手のベースが moveset を決め、銃の家系（GUN_MOVESETS）のベースは自分の弾も持つ（src/loot/bullets.ts）。
 * 数値は src/data/tuning.ts の WEAPON。ここは形の型・表示名・語（kw）をまとめる
 */

export const MOVESET_KEYS = [
  "sword",
  "greatsword",
  "twinBlades",
  "spear",
  "scythe",
  "fists",
  "whip",
  "cleaver",
  "staff",
  "wand",
  // 2026-09-24 レーン B（docs/ideas/combat-feel-design.md 5 章）
  "katana",
  "axe",
  "shield",
  "chainSickle",
  "hammer",
  "gunner",
  // 2026-09-24 銃の家系（docs/ideas/weapon-redesign.md 4 章）
  "sidearm",
  "longarm",
  "cannon",
  "thrown",
  // 砲・投擲に埋もれていた弾（曲射・設置弾・回転刃）を独立させた銃の家系
  "grenade",
  "trapper",
  "warRing",
  // 武器 Wave 4（docs/ideas/weapons-wave4.md 2〜5 章）
  "claws",
  "flail",
  "ringBlades",
  "fan",
] as const;
export type MovesetKey = (typeof MOVESET_KEYS)[number];

/**
 * 弾の挙動の性質。弾は銃のベースごとに持ち（src/loot/bullets.ts）、性質はその数値から読む（bulletFeatures）。
 * 祝福の出現条件・統一ルールの条件・性質の効き先が「設置弾を撃つ武器」のように弾の挙動で絞るときに使う
 */
export const BULLET_FEATURES = ["rapid", "spread", "pierce", "homing", "ricochet", "charge", "mine", "burst", "boomerang", "lob"] as const;
export type BulletFeature = (typeof BULLET_FEATURES)[number];

/**
 * 近接の当たり判定の形。reach / size の意味が形ごとに違う
 * - box: 自分から reach 先を中心にした一辺 size の正方形（剣の現行）
 * - arc: 自分を中心に半径 reach、攻撃方向から左右 deg/2 の扇
 * - thrust: 自分から攻撃方向へ長さ reach、幅 size の帯（突き）
 * - circle: 自分から reach 先を中心にした直径 size の円（reach 0 なら自分の周り）
 */
export type HitShape =
  | { readonly kind: "box" }
  | { readonly kind: "arc"; readonly deg: number }
  | { readonly kind: "thrust" }
  | { readonly kind: "circle" };

/** 先端判定（槍の穂先・鞭の先端）。thrust の先端 ratio 以内に入った敵へ掛ける倍率 */
export interface TipDef {
  readonly ratio: number;
  readonly damageMul: number;
  readonly poiseMul: number;
  readonly manaMul: number;
  /** 先端以外（根元）の倍率 */
  readonly offDamageMul: number;
  readonly offManaMul: number;
}

export interface MeleeStepDef {
  readonly windup: number;
  readonly active: number;
  readonly recover: number;
  /** 威力の係数（docs/COMBAT_DESIGN.md A-6 / A-10）。呼び出し側で scaled を通す */
  readonly scaling: Scaling;
  /** 1 ヒットの怯み値（ステータスが基礎値のとき） */
  readonly poise: number;
  /** 怯み値のステータス係数（A-10）。省略はステータスで伸びない */
  readonly poiseRatio?: AttrRatio;
  readonly reach: number;
  readonly size: number;
  readonly knockback: number;
  /** 重いヒットストップと壁叩きつけを起こす段 */
  readonly heavy: boolean;
  /** 命中 1 体ごとのマナ回収（MANA.meleeTargetCap 体まで） */
  readonly mana: number;
  readonly shape: HitShape;
  /** 敵を自分の方へ引き寄せる（鎌） */
  readonly pull?: boolean;
  /** 敵を自分の背後へ放る（拳のダッシュ攻撃） */
  readonly throw?: boolean;
  // ---- 手触り（任意。docs/COMBAT_DESIGN.md A-7「爽快感」） ----
  /** 1 振りの多段ヒット数（active を等分し、区切りごとに同じ敵へもう一度当たる）。省略は 1 */
  readonly hits?: number;
  /** ヒットストップ（ステップ）。省略は heavy なら FEEL.hitstopHeavy、それ以外は hitstopLight */
  readonly hitstop?: number;
  /** 命中時の画面揺れ */
  readonly shake?: number;
  /** windup + active の間に攻撃方向へ踏み込む距離（px） */
  readonly lunge?: number;
  /** active に入った瞬間に引く残像の線の色 */
  readonly trail?: string;
  /** 命中した敵に付ける状態異常（SkillDef.applies と同じ形。付与元は player） */
  readonly applies?: readonly StatusApply[];
  /** recover のキャンセル猶予（0..1。省略は PLAYER.recoverCancel。docs/ideas/combat-feel-design.md D-4） */
  readonly cancel?: number;
  /** 振り始めから付く無敵（秒。双剣の影踏みの踏み込み） */
  readonly invuln?: number;
  /** active に入った瞬間に撃つ弾（杖の詠唱。弾の key は `cast.<key>`）。当たり判定の size 0 なら純粋な詠唱 */
  readonly cast?: CastDef;
  /** active の間、弾返し・弾斬りが無くても敵弾を消す（扇子の払い） */
  readonly cutsBullets?: boolean;
}

/** 左の段・派生・ダッシュ攻撃が撃つ弾。name は HUD の「左: 火矢」（CAST_NAMES） */
export interface CastDef {
  readonly key: string;
  readonly name: string;
  readonly throw: ThrowArtDef;
}

/** 左クリック（攻撃 1）= primary、右クリック（攻撃 2）= secondary。docs/ideas/ougi-and-dual-actions.md 4 章 */
export type ButtonKey = "primary" | "secondary";

/**
 * 左クリックの役割。melee = 押すたびに連撃の次の段 / charge = 長押しで溜め、離して振る（大剣・戦鎚。tap は連撃）/
 * shot = 押している間、ベースの弾を撃つ（銃の家系だけ）
 */
export type PrimaryKind = "melee" | "charge" | "shot";

interface ArtBase {
  /** "parry" など。名前は STEP2_NAMES（BRANCH_NAMES と同じ流儀）。再使用はこの key ごとに数える */
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  /** 再使用までの秒。0 なら連撃と同じで制限なし */
  readonly cooldown: number;
  /**
   * この段を出した後に次の段を受け付ける秒（入力の窓）。省略は WEAPON.chainWindow。
   * 再使用・共有の間（laneGap）が窓を食う段（杖の氷の連射）で、間が明けてから押す猶予を残すために延ばす
   */
  readonly chainWindow?: number;
}

/** 振りの付随効果（砲の零距離砲・仕掛けの起爆・派生の反動） */
export interface StrikeExtras {
  /** 振り始めに自分を後ろへ押す速さ（px/秒。ノックバックと同じ経路で減衰する） */
  readonly selfKnock?: number;
  /** 振り始めに床の自分の設置弾をすべて起爆する */
  readonly detonateMines?: boolean;
}

/** 狙い撃ち（短銃）: 押している間溜め、time 秒に届いて離すとベースの弾の型を 1 発、強めて撃つ */
export interface AimArtDef {
  readonly moveMul: number;
  readonly time: number;
  readonly damageMul: number;
  readonly pierceBonus: number;
}

/** 右レーン（アクション 2）の段の種類。docs/ideas/ougi-and-dual-actions.md 4.1 */
export const ACTION_STEP_KINDS = ["swing", "hold", "volley", "charge", "aim", "recall"] as const;
export type ActionStepKind = (typeof ACTION_STEP_KINDS)[number];

/**
 * 右レーンの振りの段。key / name は段の名前（HUD の「右: 返し斬り」）、cooldown は再使用のある技（銃剣突きなど）だけが持つ。
 * desc は右 1 段目の技だけが持つ（無い段は空）
 */
export interface SwingActionStep {
  readonly kind: "swing";
  readonly step: MeleeStepDef;
  readonly key?: string;
  readonly name?: string;
  readonly desc?: string;
  readonly cooldown?: number;
  readonly extras?: StrikeExtras;
}

/**
 * 右レーンの段。振り以外の段（構え・弾・溜め・狙い・手元返し）は押した瞬間に始まり、段カウンタ（AttackState.step）だけ進める。
 * 段カウンタは左右で共有する（3 段目に右を押せば steps2[2]）
 */
export type ActionStepDef =
  | SwingActionStep
  | (ArtBase & { readonly kind: "hold"; readonly hold: HoldArtDef })
  | (ArtBase & { readonly kind: "volley"; readonly throw: ThrowArtDef })
  | (ArtBase & { readonly kind: "charge"; readonly charge: MeleeChargeDef })
  | (ArtBase & { readonly kind: "aim"; readonly aim: AimArtDef })
  | (ArtBase & { readonly kind: "recall"; readonly recall: RecallArtDef });

/** 右レーン（1 段以上）。steps2[0] を添字の undefined 無しで読めるよう、空を型で禁じる */
export type ActionLane = readonly [ActionStepDef, ...ActionStepDef[]];

/** 押している間の構え。parry か guard のどちらかを持つ */
export interface HoldArtDef {
  readonly moveMul: number;
  /** これ以上押しても自動で解除する秒 */
  readonly maxSec: number;
  /** 受け流し: 押してから windowSec の間の被弾を無効化し、相手に怯み値 staggerPoise を入れてカウンター扱い（onCounter を発火）。失敗時は recoverSec の硬直 */
  readonly parry?: { readonly windowSec: number; readonly recoverSec: number; readonly staggerPoise: number };
  /** 構え: 向きから arcDeg の被弾を damageMul 倍にし、受けるたびに奥義ゲージ energyGain */
  readonly guard?: { readonly arcDeg: number; readonly damageMul: number; readonly energyGain: number };
  /** 離した瞬間に出す振り（盾押し）。内部では `${key}.release` の派生として branches に入れる */
  readonly release?: MeleeStepDef;
  /** 離した振りの後に続ける連撃の段（省略はフィニッシュ） */
  readonly releaseNext?: number;
}

/** 弾を出す技。弾は技自身が持ち（bullet）、威力・怯み値・素性は技のもの */
export interface ThrowArtDef {
  readonly bullet: BulletDef;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
  readonly count: number;
  readonly spreadDeg: number;
  readonly attack: AttackProfile;
  /** 弾の絵のキー（省略は BULLET の点。斧は武器の絵を回す） */
  readonly sprite?: string;
  /** 命中・炸裂した敵に付ける状態異常（MeleeStepDef.applies と同じ形。付与元は player） */
  readonly applies?: readonly StatusApply[];
}

/** 自分の弾を手元へ戻す。戻りの弾は威力 returnDamageMul 倍。homing があれば戻りの弾は range 内の近くの敵へ曲がる（毎秒 turnRate ラジアンまで） */
export interface RecallArtDef {
  readonly returnDamageMul: number;
  readonly speedMul: number;
  readonly homing?: RecallHomingDef;
}

/** 手元返しの戻りの追尾（投擲の右の呼び戻し）。敵がいなければ手元へ戻る */
export interface RecallHomingDef {
  readonly turnRate: number;
  readonly range: number;
}

/**
 * 周回: 撃った弾が自分の周りを半径 radius で回り続ける（円環の理）。turnRate は毎秒の回転（ラジアン）、laps 周で消える。
 * 1 周ごとに当てた敵を忘れてもう一度当たる。基礎の弾の性質ではなく持続の奥義が付ける挙動なので BULLET_FEATURES には入れない
 */
export interface OrbitDef {
  readonly radius: number;
  readonly turnRate: number;
  readonly laps: number;
}

/**
 * 弾の見た目。color は弾と発射の粒の色（設置弾・曲射の色が優先）、trail は尾の色（省略は color）、
 * particles は発射の粒の数（省略は既定）、glow は弾の光を大きくする
 */
export interface BulletLookDef {
  readonly color: string;
  readonly trail?: string;
  readonly particles?: number;
  readonly glow?: boolean;
}

/** 弾が消える位置に置く地形（system/terrain.ts の placeTerrain。radius は px、duration は秒） */
export interface LeavesDef {
  readonly terrain: TerrainKind;
  readonly radius: number;
  readonly duration: number;
}

/** 右 1 段目の構えから作った派生の印。release = 構えを離した振り（押した瞬間には照合しない） */
export type BranchArtRole = "release";

/**
 * 派生の振り始めに出す弾。from が "lane" なら右レーンの最初の弾の段の弾（杖の魔弾・斧の投擲）、省略は装備の銃の弾（銃の家系）。
 * damageMul は 1 発の威力の倍率、pierceBonus は貫通の追加
 */
export interface BranchShots {
  readonly from?: "lane";
  readonly count: number;
  readonly damageMul: number;
  readonly spreadDeg?: number;
  readonly pierceBonus?: number;
}

/** コンボ派生: 入力列の末尾が sequence と一致したら、次の振りを step に差し替える */
export interface BranchDef {
  readonly key: string;
  /** 表示名 */
  readonly name: string;
  readonly sequence: readonly ButtonKey[];
  readonly step: MeleeStepDef;
  /** 派生の後に連撃を続ける段（0 始まり。左右共有の段カウンタ）。次にどちらのボタンを押したかで steps / steps2 のどちらを振るかが決まる。省略はフィニッシュ */
  readonly next?: number;
  /** 振り始めに出す弾（銃の家系の二連・杖の光条など） */
  readonly shots?: BranchShots;
  /** 振り始めの付随効果（至近撃ちの反動・蹴り起爆） */
  readonly extras?: StrikeExtras;
  /** 構えから作った派生（defineMoveset が付ける） */
  readonly art?: BranchArtRole;
}

export interface ChargeLevelDef {
  /** 押し始めからこの秒でこの段に達する */
  readonly time: number;
  readonly damageMul: number;
  readonly poiseMul: number;
  readonly reachMul: number;
}

/** 近接の溜め攻撃（攻撃キーの長押し）。刻印符の「溜め」（スキル用）とは別 */
export interface MeleeChargeDef {
  /** 溜め中の移動速度倍率 */
  readonly moveMul: number;
  /** 溜めて離したときに出す振り（段の倍率を掛ける） */
  readonly step: MeleeStepDef;
  readonly levels: readonly ChargeLevelDef[];
  /** 溜めている間、interval 秒ごとに step の当たり判定を 1 回出す（チェーンアレイの回し）。無ければ普通の溜め */
  readonly spinning?: SpinningDef;
}

/** 溜め中の周期ヒット。押し続けている間だけ（オート攻撃ではない） */
export interface SpinningDef {
  readonly interval: number;
  readonly step: MeleeStepDef;
}

export interface MovesetDef {
  readonly key: MovesetKey;
  /** 表示名（docs/GLOSSARY.md「武器種」） */
  readonly name: string;
  /** 何ができるかの 1 行（単一指標を出さない） */
  readonly desc: string;
  readonly steps: readonly MeleeStepDef[];
  readonly dashAttack: MeleeStepDef;
  /** 左の長押しの溜め（primary が charge の武器種だけ） */
  readonly charge?: MeleeChargeDef;
  readonly tip?: TipDef;
  /** 攻撃中の移動速度倍率 */
  readonly attackMoveMul: number;
  /** 左クリックの役割 */
  readonly primary: PrimaryKind;
  /**
   * 右クリック（アクション 2）の段。段カウンタ（AttackState.step）は左右で共有する（docs/ideas/ougi-and-dual-actions.md 4 章）。
   * 近接は steps と同じ段数、銃の家系は 3 段
   */
  readonly steps2: ActionLane;
  /** コンボ派生（3 入力以上。入力列の長いものから照合する）。構えの release は defineMoveset が ["secondary"] の派生として混ぜる */
  readonly branches: readonly BranchDef[];
  /** 出す / 食う / 強める語 */
  readonly keywords: KeywordProfile;
  /** 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）。近接の段・ダッシュ攻撃・派生すべてに掛かる */
  readonly attack: AttackProfile;
  /** 武器種の固有効果（統一ルール文法）。system/rules.ts の collectRules が今の武器種の分だけ集める */
  readonly rules?: readonly Rule[];
}

export interface BulletChargeLevelDef {
  readonly time: number;
  readonly damageMul: number;
  readonly radius: number;
  readonly pierceBonus: number;
  readonly poiseMul: number;
}

export interface MineDef {
  /** 置いてから炸裂するまでの秒 */
  readonly fuse: number;
  /** 床を滑って止まるまでの減衰（毎秒） */
  readonly drag: number;
  readonly blastRadius: number;
  /** 敵がこの距離（縁どうし）まで近づくと炸裂 */
  readonly triggerRadius: number;
  readonly color: string;
}

/**
 * 1 つの武器が撃つ弾（銃のベースごと、または右レーンの弾の段ごと）。数値は src/data/balance/weapons/ の
 * WEAPON.bullets.<ベースの key>（右レーンの段は movesets.<武器種>.steps2[n].throw.bullet）。挙動のブロック（sway / homing / … / lob）を
 * 持つかどうかがそのまま弾の性質になる（bulletFeatures）
 */
export interface BulletDef {
  /** 銃のベースの key（技の弾は `art.<技の key>`）。弾の作業領域 ShotRuntime.key から引き直すのに使う */
  readonly key: string;
  /** 表示名（ベース名・技の名前） */
  readonly name: string;
  readonly cooldownMul: number;
  readonly damageMul: number;
  readonly speedMul: number;
  readonly lifeMul: number;
  readonly radius: number;
  readonly poiseMul: number;
  readonly recoilMul: number;
  /** projectileCount に足す弾数（散弾） */
  readonly pellets: number;
  /** 複数弾の扇の間隔（度） */
  readonly spreadDeg: number;
  readonly pierceBonus: number;
  /** 連射: 弾筋の揺れ（度）と周期（1 秒あたり） */
  readonly sway?: { readonly deg: number; readonly freq: number };
  readonly homing?: { readonly turnRate: number; readonly range: number };
  readonly bounce?: { readonly count: number; readonly mul: number };
  readonly charge?: { readonly levels: readonly BulletChargeLevelDef[] };
  readonly mine?: MineDef;
  /** 三点: 1 押しで count 発を interval 秒おきに撃つ */
  readonly burst?: { readonly count: number; readonly interval: number };
  /** 回転刃: 寿命の returnAt の割合で反転して手元へ戻り、catchRadius で手に収まる */
  readonly boomerang?: { readonly returnAt: number; readonly catchRadius: number };
  /** 曲射: 照準の距離（minRange〜射程）で炸裂する。peak は描画の山の高さ（px） */
  readonly lob?: { readonly blastRadius: number; readonly minRange: number; readonly peak: number; readonly color: string };
  /** 周回（持続の奥義・チャクラムの段が付ける。OrbitDef） */
  readonly orbit?: OrbitDef;
  /** 見た目（色・尾・粒・光）。描画と発射の粒だけが読み、当たり方は変えない */
  readonly look?: BulletLookDef;
  /** 消える位置（命中・壁・炸裂・寿命切れ。手元に戻った弾は除く）に地形を残す */
  readonly leaves?: LeavesDef;
  /** 1 発の威力の係数（A-10）。省略は PLAYER.shoot.scaling。damageMul はこの後に掛かる */
  readonly scaling?: Scaling;
  /** 怯み値のステータス係数（A-10）。PLAYER.shoot.poise × poiseMul に上乗せする。省略はステータスで伸びない */
  readonly poiseRatio?: AttrRatio;
  readonly keywords: KeywordProfile;
  /** 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）。敵の防御 / 魔防のどちらで受けるかを決める */
  readonly attack: AttackProfile;
}

/** 弾ごとの作業領域（Projectile.shot）。projectiles.ts が読む */
export interface ShotRuntime {
  /** 撃った弾の BulletDef.key */
  key: string;
  /** 跳弾の残り回数 */
  bouncesLeft?: number;
  /** 設置弾が炸裂したか（二重に炸裂させない） */
  detonated?: boolean;
  /** 撃った瞬間の寿命（回転刃の反転・曲射の山の高さの基準） */
  lifeTotal?: number;
  /** 回転刃が手元へ戻っている最中（手元返しで戻した弾も立つ） */
  returning?: boolean;
  /** 手元返しの戻りの追尾（RecallArtDef.homing の写し） */
  recallHoming?: RecallHomingDef;
  /** 周回の定義（撃った瞬間の BulletDef.orbit の写し。持続が終わっても回り切る） */
  orbit?: OrbitDef;
  /** 周回の今の角度（自分から見た弾の向き、ラジアン） */
  orbitAngle?: number;
  /** 周回の今の半径 px（撃った位置から radius へ滑らかに広がる） */
  orbitRadius?: number;
  /** 周回で回った角度の合計（ラジアン）。1 周ごとの当て直しと laps の判定に使う */
  orbitTravel?: number;
  /** 周回の位相のずれの残り（ラジアン）。撃った向きから、発射順でずらした角度へ半径と一緒に滑らかに寄せる */
  orbitPhase?: number;
  /** 消える位置に残す地形（撃った瞬間の BulletDef.leaves の写し。BULLETS に無い差し替えの弾でも効く） */
  leaves?: LeavesDef;
  /** 見た目（撃った瞬間の BulletDef.look の写し。描画が読む） */
  look?: BulletLookDef;
  /** 地形を残し終えた（二重に置かない） */
  left?: boolean;
}

/** 弾の挙動ブロックの数値だけ（JSON の形。key・名前・語・素性は持ち主が足す） */
export type BulletNumbers = Omit<BulletDef, "key" | "name" | "keywords" | "attack">;

/** 弾の性質（数値に挙動のブロックがあるか）。何も無ければまっすぐ飛ぶだけの弾 */
export function bulletFeatures(b: Readonly<BulletNumbers>): BulletFeature[] {
  const out: BulletFeature[] = [];
  if (b.sway) out.push("rapid");
  if (b.pellets > 0) out.push("spread");
  if (b.pierceBonus > 0 && !b.boomerang) out.push("pierce");
  if (b.homing) out.push("homing");
  if (b.bounce) out.push("ricochet");
  if (b.charge) out.push("charge");
  if (b.mine) out.push("mine");
  if (b.burst) out.push("burst");
  if (b.boomerang) out.push("boomerang");
  if (b.lob) out.push("lob");
  return out;
}

export function hasBulletFeature(b: Readonly<BulletNumbers>, feature: BulletFeature): boolean {
  return bulletFeatures(b).includes(feature);
}

/** JSON の弾の数値に key・名前・語・素性を足して BulletDef にする（数値の中に union 文字列は無いのでそのまま通す） */
export function reviveBullet(raw: unknown, key: string, name: string, keywords: KeywordProfile, profile: AttackProfile): BulletDef {
  if (!isRecord(raw) || typeof raw.cooldownMul !== "number") throw new Error(`不正な弾: ${key}`);
  const bullet: BulletDef = { ...(raw as unknown as BulletNumbers), key, name, keywords, attack: profile };
  return raw.leaves === undefined ? bullet : { ...bullet, leaves: reviveLeaves(raw.leaves, key) };
}

/** 弾が残す地形（terrain は union 文字列なので一覧と照合する） */
function reviveLeaves(raw: unknown, key: string): LeavesDef {
  if (!isRecord(raw) || typeof raw.terrain !== "string" || typeof raw.radius !== "number" || typeof raw.duration !== "number") {
    throw new Error(`不正な leaves: ${key}`);
  }
  if (!(TERRAIN_KINDS as readonly string[]).includes(raw.terrain) || raw.terrain === "none") throw new Error(`未知の地形: ${raw.terrain}（${key}）`);
  return { terrain: raw.terrain as TerrainKind, radius: raw.radius, duration: raw.duration };
}

/** 曲射の弾の見かけの高さ（px。描画用）。撃った瞬間と着弾で 0、寿命の中ほどで peak */
export function lobHeight(runtime: Readonly<ShotRuntime>, life: number, peak: number): number {
  const total = runtime.lifeTotal ?? 0;
  if (total <= 0) return 0;
  const t = Math.min(1, Math.max(0, 1 - life / total));
  return 4 * peak * t * (1 - t);
}

const BOX: HitShape = { kind: "box" };

/** 剣は現行の PLAYER.melee / ACTION.dashAttack / MANA.onMelee を移植する（数値の定義元は変えない） */
function swordSteps(): MeleeStepDef[] {
  return PLAYER.melee.map((s, i) => ({ ...s, scaling: meleeScaling(s.scaling), shape: BOX, mana: MANA.onMelee[i] ?? 0 }));
}

/**
 * 近接の段の威力の係数表に WEAPON.meleeDamageScale を掛ける。base と係数を同率で下げるので、
 * 基礎値での威力だけが下がり、ステータス 1 点あたりの伸び率は変わらない（ステータスを上げたとたんに跳ねない）。
 * 銃の弾（throw.scaling・bullets）・スキル・奥義はこの経路を通らないので対象外
 */
export function meleeScaling(s: Readonly<Scaling>): Scaling {
  const mul = WEAPON.meleeDamageScale;
  const out: Scaling = { base: s.base * mul };
  for (const k of ATTR_KEYS) {
    const v = s[k];
    if (v !== undefined) out[k] = v * mul;
  }
  return out;
}

/**
 * WEAPON（src/data/balance/weapons/）は union 文字列（shape.kind / applies[].kind / sequence の要素 / art.throw.shot）を
 * ただの string として読む（docs/ideas/data-externalization.md 1.3）。ここで一覧と照合し、未知の値は throw で絞る
 * （6.6「union 文字列は TS に残すか hitShape(json.shape) で受ける」）。数値・色などそれ以外のフィールドはそのまま通す
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hitShape(raw: unknown): HitShape {
  if (!isRecord(raw) || typeof raw.kind !== "string") throw new Error(`不正な shape: ${JSON.stringify(raw)}`);
  if (raw.kind === "arc") {
    if (typeof raw.deg !== "number") throw new Error(`arc の shape に deg が無い: ${JSON.stringify(raw)}`);
    return { kind: "arc", deg: raw.deg };
  }
  if (raw.kind === "box" || raw.kind === "thrust" || raw.kind === "circle") return { kind: raw.kind };
  throw new Error(`未知の shape.kind: ${raw.kind}`);
}

function statusApply(raw: unknown): StatusApply {
  if (!isRecord(raw) || typeof raw.kind !== "string" || typeof raw.stacks !== "number" || typeof raw.duration !== "number" || typeof raw.potency !== "number") {
    throw new Error(`不正な applies: ${JSON.stringify(raw)}`);
  }
  if (!(STATUS_KINDS as readonly string[]).includes(raw.kind)) throw new Error(`未知の状態異常: ${raw.kind}`);
  const out: StatusApply = { kind: raw.kind as StatusKind, stacks: raw.stacks, duration: raw.duration, potency: raw.potency };
  if (raw.ratio !== undefined) out.ratio = attrRatio(raw.ratio);
  return out;
}

/** 状態異常の効果量の係数（docs/COMBAT_DESIGN.md A-10）。キーはステータス、値は非負の数 */
function attrRatio(raw: unknown): AttrRatio {
  if (!isRecord(raw)) throw new Error(`不正な ratio: ${JSON.stringify(raw)}`);
  const out: AttrRatio = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(ATTR_KEYS as readonly string[]).includes(k) || typeof v !== "number") throw new Error(`不正な ratio: ${JSON.stringify(raw)}`);
    out[k as AttrKey] = v;
  }
  return out;
}

function buttonKey(raw: unknown): ButtonKey {
  if (raw === "primary" || raw === "secondary") return raw;
  throw new Error(`未知の ButtonKey: ${String(raw)}`);
}

/** JSON の段（steps / dashAttack / branches[].step / steps2[].step など）を MeleeStepDef に絞る。jobs.ts の jobBranches も使う */
export function reviveStep(raw: unknown): MeleeStepDef {
  const r = raw as Record<string, unknown>;
  const rawApplies = r.applies as readonly unknown[] | undefined;
  if (!isRecord(r.scaling) || typeof r.scaling.base !== "number") throw new Error(`段に scaling が無い: ${JSON.stringify(raw)}`);
  const step = { ...r, shape: hitShape(r.shape), scaling: meleeScaling(r.scaling as Scaling) } as unknown as MeleeStepDef;
  const withApplies = rawApplies ? { ...step, applies: rawApplies.map(statusApply) } : step;
  return r.cast === undefined ? withApplies : { ...withApplies, cast: reviveCast(r.cast) };
}

/** 段の cast（{ key, throw }）。名前は CAST_NAMES、素性と絵は CAST_VOLLEY（無ければ射撃・物理）。弾の key は `cast.<key>` */
function reviveCast(raw: unknown): CastDef {
  if (!isRecord(raw) || typeof raw.key !== "string" || raw.key === "") throw new Error(`不正な cast: ${JSON.stringify(raw)}`);
  const name = CAST_NAMES[raw.key] ?? raw.key;
  return { key: raw.key, name, throw: reviveThrowAs(raw.throw, `cast.${raw.key}`, name, CAST_VOLLEY[raw.key]) };
}

function reviveSteps(raw: unknown): MeleeStepDef[] {
  return (raw as readonly unknown[]).map(reviveStep);
}

function optionalNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/** JSON の selfKnock / detonateMines（段・派生の直下）を付随効果にまとめる。どちらも無ければ undefined */
function reviveExtras(r: Record<string, unknown>): StrikeExtras | undefined {
  const selfKnock = optionalNumber(r.selfKnock);
  const detonateMines = r.detonateMines === true ? true : undefined;
  if (selfKnock === undefined && detonateMines === undefined) return undefined;
  return { selfKnock, detonateMines };
}

function reviveShots(raw: unknown): BranchShots | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || typeof raw.count !== "number" || typeof raw.damageMul !== "number") throw new Error(`不正な shots: ${JSON.stringify(raw)}`);
  if (raw.from !== undefined && raw.from !== "lane") throw new Error(`未知の shots.from: ${String(raw.from)}`);
  return {
    from: raw.from === "lane" ? "lane" : undefined,
    count: raw.count,
    damageMul: raw.damageMul,
    spreadDeg: optionalNumber(raw.spreadDeg),
    pierceBonus: optionalNumber(raw.pierceBonus),
  };
}

/** tuning の派生表を BranchDef の配列にする。照合は長い列から（同じ長さは JSON の並び順） */
function reviveBranches(raw: unknown): BranchDef[] {
  const out: BranchDef[] = [];
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRecord(v) || !Array.isArray(v.sequence)) throw new Error(`不正な派生: ${key}`);
    out.push({
      key,
      name: BRANCH_NAMES[key] ?? key,
      sequence: v.sequence.map(buttonKey),
      step: reviveStep(v.step),
      next: optionalNumber(v.next),
      shots: reviveShots(v.shots),
      extras: reviveExtras(v),
    });
  }
  return out.sort((a, b) => b.sequence.length - a.sequence.length);
}

function reviveCharge(raw: unknown): MeleeChargeDef {
  const r = raw as { readonly moveMul: number; readonly step: unknown; readonly levels: readonly ChargeLevelDef[] };
  const spinning = reviveSpinning((raw as Record<string, unknown>).spinning);
  return { moveMul: r.moveMul, step: reviveStep(r.step), levels: r.levels, ...(spinning ? { spinning } : {}) };
}

function reviveSpinning(raw: unknown): SpinningDef | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || typeof raw.interval !== "number" || raw.interval <= 0) throw new Error(`不正な spinning: ${JSON.stringify(raw)}`);
  return { interval: raw.interval, step: reviveStep(raw.step) };
}

/** 押している間の構え（HoldArtDef）。release（離した振り）が無ければそのまま */
function reviveHold(raw: unknown): HoldArtDef {
  const r = raw as Record<string, unknown>;
  return { ...(r as unknown as HoldArtDef), release: r.release !== undefined ? reviveStep(r.release) : undefined };
}

/** 弾を出す段。弾の数値（throw.bullet）に段の名前と素性を足して BulletDef にする（弾の key は `art.<段の key>`） */
function reviveThrow(raw: unknown, key: string, name: string): ThrowArtDef {
  return reviveThrowAs(raw, `art.${key}`, name, STEP2_VOLLEY[key]);
}

/** 弾を出す段・cast の共通。bulletKey は弾の key、profile は素性と絵（無ければ射撃・物理で点の弾） */
function reviveThrowAs(raw: unknown, bulletKey: string, name: string, profile: VolleyProfile | undefined): ThrowArtDef {
  if (!isRecord(raw)) throw new Error(`不正な throw: ${bulletKey}`);
  const look = profile ?? { attack: GUN_ATTACK };
  const bullet = reviveBullet(raw.bullet, bulletKey, name, ART_BULLET_KEYWORDS, look.attack);
  const t = raw as unknown as Omit<ThrowArtDef, "bullet" | "attack" | "sprite" | "applies">;
  const applies = Array.isArray(raw.applies) ? { applies: raw.applies.map(statusApply) } : {};
  return { scaling: t.scaling, poise: t.poise, poiseRatio: t.poiseRatio, count: t.count, spreadDeg: t.spreadDeg, bullet, attack: look.attack, sprite: look.sprite, ...applies };
}

/** JSON の右レーンの 1 段（kind は union 文字列なので照合して絞る。未知の kind は読み込み時に落とす） */
function reviveActionStep(raw: unknown): ActionStepDef {
  if (!isRecord(raw) || typeof raw.kind !== "string") throw new Error(`不正な右レーンの段: ${JSON.stringify(raw)}`);
  const key = typeof raw.key === "string" ? raw.key : "";
  const name = STEP2_NAMES[key] ?? key;
  const desc = STEP2_DESC[key] ?? "";
  const cooldown = optionalNumber(raw.cooldown) ?? 0;
  const chainWindow = optionalNumber(raw.chainWindow);
  const window = chainWindow === undefined ? {} : { chainWindow };
  switch (raw.kind) {
    case "swing":
      return { kind: "swing", step: reviveStep(raw.step), key: key || undefined, name: key ? name : undefined, desc: desc || undefined, cooldown, extras: reviveExtras(raw) };
    case "hold":
      return { kind: "hold", key, name, desc, cooldown, hold: reviveHold(raw.hold), ...window };
    case "volley":
      return { kind: "volley", key, name, desc, cooldown, throw: reviveThrow(raw.throw, key, name), ...window };
    case "charge":
      return { kind: "charge", key, name, desc, cooldown, charge: reviveCharge(raw.charge), ...window };
    case "aim":
      return { kind: "aim", key, name, desc, cooldown, aim: raw.aim as AimArtDef, ...window };
    case "recall":
      return { kind: "recall", key, name, desc, cooldown, recall: raw.recall as RecallArtDef, ...window };
    default:
      throw new Error(`未知の右レーンの段の kind: ${raw.kind}`);
  }
}

/** JSON の steps2 を右レーンにする（空はデータの誤りなので読み込み時に落とす） */
function reviveLane(raw: unknown): ActionLane {
  if (!Array.isArray(raw)) throw new Error("右レーン（steps2）が配列でない");
  return actionLane(raw.map(reviveActionStep));
}

const W = WEAPON.movesets;
const GUN_ATTACK = attack("ranged", "physical");

/** 派生の表示名（数値は tuning の WEAPON.movesets[].branches） */
const BRANCH_NAMES: Readonly<Record<string, string>> = {
  crossCut: "十字断ち",
  steppingCut: "踏み込み斬り",
  tomoe: "巴",
  reverseKesa: "逆袈裟",
  helmSplitter: "兜割り",
  gsHorizon: "横一文字",
  gsWheel: "車輪斬り",
  gsBreak: "突き崩し",
  flurry: "乱れ斬り",
  crossing: "交差斬り",
  shadowSplit: "影分かれ",
  crossForm: "十字架",
  shadowRend: "影裂き",
  spearSweep: "石突き回し",
  linkedThrusts: "連ね突き",
  kickUp: "蹴り上げ",
  deepThrust: "深突き",
  reaping: "刈り取り",
  deathDance: "死の舞",
  neckReap: "首刈り",
  dragDown: "引き倒し",
  uppercut: "昇り拳",
  hundredFists: "百裂拳",
  breakThrust: "崩し突き",
  doubleKick: "二段蹴り",
  chainFists: "連ね打ち",
  whirl: "巻き打ち",
  snakeLash: "蛇打ち",
  coilUp: "巻き上げ",
  rend: "引き裂き",
  slamDown: "叩き落とし",
  bloodSpray: "血飛沫",
  pressCut: "押し斬り",
  boneBreak: "骨断ち",
  tempest: "旋風",
  windmill: "風車",
  doubleSweep: "二段払い",
  pinDown: "打ち据え",
  lightningBolt: "稲妻",
  venomMist: "毒泡",
  vortex: "渦巻き",
  flash: "閃光",
  darkHand: "闇手",
  arcLightning: "跳ね雷",
  tsubame: "燕返し",
  quickDraw: "抜き打ち",
  kasumi: "霞",
  mineUchi: "峰打ち",
  axeSpin: "回転斬り",
  cleave: "断ち割り",
  neckChop: "首斬り",
  twinThrow: "二丁投げ",
  shieldDrop: "盾落とし",
  rampart: "城壁",
  shieldPunch: "盾殴り",
  shieldRush: "突進盾",
  reelIn: "巻き取り",
  kamaitachi: "鎌鼬",
  pullCut: "引き斬り",
  chainBind: "鎖縛り",
  groundBreaker: "地砕き",
  hammerWheel: "鎚車",
  launcher: "打ち上げ",
  ironHammer: "鉄槌",
  twinShot: "二連",
  quickFire: "早抜き撃ち",
  kickShot: "蹴り撃ち",
  rollShot: "側転撃ち",
  tripleShot: "三連射",
  pointShot: "至近撃ち",
  kickAway: "蹴り離し",
  doubleTap: "二度撃ち",
  bayonetFlurry: "銃剣連突き",
  stockBash: "銃床殴打",
  pierceShot: "貫き撃ち",
  thrustShot: "突き撃ち",
  loadedShot: "装填撃ち",
  barrelSwing: "砲身振り",
  contactShot: "密着砲",
  shoveOff: "突き飛ばし",
  tripleThrow: "三本投げ",
  spinThrow: "回し投げ",
  grabToss: "掴み投げ",
  drawCut: "返し斬り",
  twinShell: "二連弾",
  footShot: "足元撃ち",
  kickShell: "蹴り撃ち",
  thrustSweep: "突き払い",
  doublePlace: "連置き",
  trapCircle: "罠陣",
  kickDetonate: "蹴り起爆",
  trapToss: "罠投げ",
  tripleRing: "三輪",
  ringSpin: "輪回し",
  ringSlash: "輪斬り",
  returnRing: "戻り輪",
  // 武器 Wave 4: 爪 / チェーンアレイ / チャクラム / 扇子
  fangRush: "牙駆け",
  lacerationDance: "裂傷舞",
  crossClaw: "十字爪",
  pounce: "跳び食らい",
  starCrush: "星砕き",
  swingDown: "振り落とし",
  chainSweep: "鎖払い",
  dragCrush: "引き砕き",
  moonCut: "月輪斬り",
  stackedRings: "重ね輪",
  ringDash: "輪駆け",
  doubleSever: "双断ち",
  butterflyDance: "蝶舞",
  downdraft: "颪",
  galeCut: "烈風",
  petalStorm: "花吹雪",
};

/** 右レーンの段の表示名（数値は tuning の WEAPON.movesets[].steps2）。構えの離した振りは `${key}.release` */
export const STEP2_NAMES: Readonly<Record<string, string>> = {
  parry: "受け流し",
  returnCut: "返し斬り",
  risingCut: "斬り上げ",
  sweep: "薙ぎ払い",
  gsUpswing: "振り上げ",
  gsWhirl: "回り斬り",
  gsSlam: "叩き伏せ",
  shadowStep: "影踏み",
  crossThrust: "交差突き",
  danceCut: "舞い斬り",
  backhandCut: "逆手斬り",
  shadowPin: "影止め",
  chargeThrust: "突進突き",
  buttStrike: "石突き",
  spearArc: "払い",
  greatThrust: "大突き",
  hookPull: "鎌引き",
  scytheWrap: "巻き込み",
  reverseSpin: "逆手回し",
  scytheSever: "断ち",
  grabThrow: "掴み投げ",
  elbow: "肘打ち",
  knee: "膝蹴り",
  roundKick: "回し蹴り",
  straightPunch: "正拳",
  entangle: "巻き付け",
  whipSweep: "打ち払い",
  groundLash: "地打ち",
  whipCrack: "鞭鳴らし",
  shoulderCharge: "肩当て",
  verticalSplit: "縦割り",
  cleaverSweep: "横薙ぎ",
  greatDrop: "大鉈落とし",
  upswing: "払い上げ",
  staffButt: "石突き",
  spinStrike: "回し打ち",
  skyThrust: "天突き",
  iceLance: "氷槍",
  iceLance2: "氷槍",
  iceLanceLong: "長氷槍",
  blizzard: "吹雪",
  iai: "居合",
  kaeshi: "返し",
  sakakaze: "逆風",
  ichimonji: "一文字",
  axeThrow: "投擲",
  axeChop: "打ち割り",
  axeWhirl: "回し斬り",
  greatSplit: "大割り",
  guard: "構え",
  "guard.release": "盾押し",
  shieldThrust: "盾突き",
  shieldBash: "盾叩き",
  crush: "押し潰し",
  chainWeight: "分銅",
  sickleReturn: "鎌返し",
  chainSpin: "鎖回し",
  chainCinch: "鎖締め",
  hammerSweep: "大薙ぎ",
  hammerDown: "振り下ろし",
  hammerSide: "横殴り",
  earthSlam: "大地叩き",
  barrage: "乱れ撃ち",
  gunnerButt: "銃把打ち",
  spinShot: "回転撃ち",
  aimedShot: "狙い撃ち",
  sidearmButt: "銃把打ち",
  muzzleSweep: "銃口払い",
  bayonet: "銃剣突き",
  stockStrike: "銃床打ち",
  bayonetSweep: "銃剣払い",
  pointBlank: "零距離砲",
  barrelBash: "筒殴り",
  buttSwing: "尻叩き",
  recall: "手元返し",
  throughThrow: "投げ抜け",
  thrownKick: "蹴り",
  tubeBash: "筒払い",
  tubeThrust: "筒突き",
  kickAway: "蹴り飛ばし",
  scatterMines: "撒き散らし",
  trapKick: "罠蹴り",
  detonate: "起爆",
  ringSweep: "輪払い",
  ringThrow: "輪投げ",
  twinRings: "二輪",
  // 武器 Wave 4: 爪 / チェーンアレイ / チャクラム / 扇子
  fangBite: "獣噛み",
  rake: "引っ掻き",
  leapBack: "跳び退き",
  clawFlurry: "乱れ爪",
  throatSlit: "喉裂き",
  flailWhirl: "回し",
  chainSwing: "振り回し",
  ballDrop: "鉄球落とし",
  chainWrap: "鎖巻き",
  orbitRing: "周回",
  ringCut: "輪断ち",
  twinRingCut: "二輪断ち",
  ringLaunch: "投輪",
  fanning: "扇ぎ",
  "fanning.release": "突風",
  fanSnap: "扇打ち",
  petalWhirl: "花舞",
  windCutter: "風刃",
};

/** 右 1 段目の技の説明（「何ができるか」。2 段目以降の振りは HUD に名前だけ出すので持たない） */
const STEP2_DESC: Readonly<Record<string, string>> = {
  parry: "押した直後の被弾を無効にし、相手を大きく怯ませる。外すと一瞬硬直する",
  sweep: "広く薙ぎ払う",
  shadowStep: "踏み込んで突く。踏み込みの間は無敵",
  chargeThrust: "大きく踏み込んで突き、壁に叩きつける",
  hookPull: "鎌を突き出して引き寄せる",
  grabThrow: "掴んで背後へ放り、壁に叩きつける",
  entangle: "巻き付けて手前へ引き、恐怖を付ける",
  shoulderCharge: "肩から踏み込んで押し飛ばす",
  upswing: "払い上げて大きく押し返す",
  iceLance: "貫く氷の槍を撃ち、当たった敵を冷やす（射撃として当たる）",
  iai: "押して溜め、離して一閃。溜めずに離すと左の段を振る",
  axeThrow: "斧を投げる。行って戻り、行きと帰りで斬る（射撃として当たる）",
  guard: "押している間、前からの被弾を大きく減らし奥義ゲージを溜める。離すと盾押し",
  chainWeight: "分銅を投げて引き寄せ、崩勢にする",
  hammerSweep: "大きく薙ぎ払う",
  aimedShot: "足を止めて狙い、離すと強く貫く 1 発を撃つ",
  bayonet: "銃剣で踏み込んで突き、押し返す",
  pointBlank: "至近を吹き飛ばして後ろへ跳ぶ。床の自分の設置弾をすべて起爆する",
  recall: "飛んでいる自分の弾をすべて手元へ向け直す",
  barrage: "全方位へ弾をばら撒く",
  tubeBash: "筒で殴って敵を押し返し、自分も後ろへ下がる",
  scatterMines: "前方へ設置弾を扇に 3 つ撒く",
  ringSweep: "手元の輪で周りを広く斬る",
  fangBite: "踏み込んで噛みつき、出血させる",
  flailWhirl: "押している間、鉄球を回して周りを打ち続ける。離すと勢いのついた一撃",
  orbitRing: "輪を自分の周りに回らせる。回っている間、近くの敵に何度も当たる",
  fanning: "押している間、前からの被弾を減らす。離すと突風で押し返し、敵弾を払う",
};

/** 弾を出す段・cast の素性（ジャンル・属性）と弾の絵 */
interface VolleyProfile {
  readonly attack: AttackProfile;
  readonly sprite?: string;
}

/** 左の段の cast の表示名（HUD の「左: 火矢」）。キーは cast.key。数値は movesets.<武器種>.steps[n].cast */
export const CAST_NAMES: Readonly<Record<string, string>> = {
  fireDart: "火矢",
  fireDart2: "火矢",
  fireDartTwin: "二連火矢",
  blastOrb: "爆炎球",
  lightningBolt: "稲妻",
  venomMist: "毒泡",
  flash: "閃光",
  darkHand: "闇手",
  arcLightning: "跳ね雷",
};

/** cast の弾の素性と絵（キーは cast.key）。無ければ射撃・物理で点の弾 */
const CAST_VOLLEY: Readonly<Record<string, VolleyProfile>> = {
  fireDart: { attack: attack("ranged", "arcane", "fire") },
  fireDart2: { attack: attack("ranged", "arcane", "fire") },
  fireDartTwin: { attack: attack("ranged", "arcane", "fire") },
  blastOrb: { attack: attack("ranged", "arcane", "fire") },
  lightningBolt: { attack: attack("ranged", "arcane", "lightning") },
  venomMist: { attack: attack("area", "arcane", "poison") },
  flash: { attack: attack("ranged", "arcane", "light") },
  darkHand: { attack: attack("ranged", "arcane", "dark") },
  arcLightning: { attack: attack("ranged", "arcane", "lightning") },
};

/** 弾を出す段の素性（ジャンル・属性）と弾の絵。無ければ射撃・物理で点の弾 */
const STEP2_VOLLEY: Readonly<Record<string, VolleyProfile>> = {
  iceLance: { attack: attack("ranged", "arcane", "ice") },
  iceLance2: { attack: attack("ranged", "arcane", "ice") },
  iceLanceLong: { attack: attack("ranged", "arcane", "ice") },
  blizzard: { attack: attack("ranged", "arcane", "ice") },
  axeThrow: { attack: GUN_ATTACK, sprite: "weapon.axe" },
  scatterMines: { attack: attack("ranged", "physical", "fire") },
  orbitRing: { attack: GUN_ATTACK },
  ringLaunch: { attack: GUN_ATTACK, sprite: "weapon.ringBlades" },
  windCutter: { attack: attack("ranged", "hybrid") },
};

/** 技の弾の語（技そのものの語は武器種の keywords が持つので、弾は射撃であることだけ） */
const ART_BULLET_KEYWORDS: KeywordProfile = kw(["ranged"]);

/** 右 1 段目の構えの release を、構えを離したときだけ出す派生にする（押した瞬間には照合しない） */
function releaseBranches(first: ActionStepDef): BranchDef[] {
  if (first.kind !== "hold" || !first.hold.release) return [];
  const key = `${first.key}.release`;
  return [{ key, name: STEP2_NAMES[key] ?? key, sequence: ["secondary"], step: first.hold.release, next: first.hold.releaseNext, art: "release" }];
}

/**
 * 武器種の定義を仕上げる。右 1 段目の構えの release を派生として branches に混ぜ、
 * 長い列が先（同じ長さは元の順）に並べる。既存の matchBranch / 来歴の branchHits がそのまま効く
 */
export function defineMoveset(spec: MovesetDef): MovesetDef {
  const extra = releaseBranches(spec.steps2[0]);
  if (extra.length === 0) return spec;
  const branches = [...spec.branches, ...extra].sort((a, b) => b.sequence.length - a.sequence.length);
  return { ...spec, branches };
}

/** 空でない右レーンに絞る（JSON から段を並べたときの入口。空はデータの誤りなので読み込み時に落とす） */
export function actionLane(steps: readonly ActionStepDef[]): ActionLane {
  const [first, ...rest] = steps;
  if (first === undefined) throw new Error("右レーン（steps2）が空");
  return [first, ...rest];
}

const R = WEAPON.movesetRules;
const ALWAYS = 1;
const NO_ICD = 0;

interface MovesetRuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

/** 武器種の Rule（確定発動。id は持ち主 + 添字で決まる。ジョブの jobRule と同じ形） */
function movesetRule(key: MovesetKey, index: number, spec: MovesetRuleSpec): Rule {
  // EventSource に武器種の種類は無いので、プレイヤー由来として key で区別する
  const owner = { kind: "player" as const, key: `moveset.${key}` };
  return { id: ruleId(owner, index), when: spec.when, if: spec.if ?? [], then: spec.then, chance: ALWAYS, icd: spec.icd ?? NO_ICD, scope: SCOPE_ANY, owner };
}

export const MOVESETS: Readonly<Record<MovesetKey, MovesetDef>> = {
  sword: defineMoveset({
    key: "sword",
    name: "剣",
    desc: "3 段の素直な斬撃。右の 1 段目は受け流し、右右で受け流しから返し斬り。左左右で十字断ち、右左左で踏み込み斬り",
    steps: swordSteps(),
    dashAttack: { ...ACTION.dashAttack, scaling: meleeScaling(ACTION.dashAttack.scaling), shape: BOX, mana: MANA.onDashAttack },
    attackMoveMul: W.sword.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.sword.steps2),
    branches: reviveBranches(W.sword.branches),
    keywords: kw(["melee", "combo", "finisher"], [], ["counter"]),
    attack: attack("melee", "physical"),
  }),
  greatsword: defineMoveset({
    key: "greatsword",
    name: "大剣",
    desc: "広い弧の大振り 4 段。長押しで 3 段階まで溜める。右の連撃は薙ぎ払いから始まる",
    steps: reviveSteps(W.greatsword.steps),
    dashAttack: reviveStep(W.greatsword.dashAttack),
    charge: reviveCharge(W.greatsword.charge),
    attackMoveMul: W.greatsword.attackMoveMul,
    primary: "charge",
    steps2: reviveLane(W.greatsword.steps2),
    branches: reviveBranches(W.greatsword.branches),
    keywords: kw(["melee", "stagger", "finisher", "wall", "area"], ["still"], ["elite"]),
    attack: attack("melee", "physical"),
  }),
  twinBlades: defineMoveset({
    key: "twinBlades",
    name: "双剣",
    desc: "軽い 5 連撃（3 段目は 2 回斬る）。右の影踏みで踏み込む。手数が多く、トリガーや状態異常を起こしやすい",
    steps: reviveSteps(W.twinBlades.steps),
    dashAttack: reviveStep(W.twinBlades.dashAttack),
    attackMoveMul: W.twinBlades.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.twinBlades.steps2),
    branches: reviveBranches(W.twinBlades.branches),
    keywords: kw(["melee", "combo"], [], ["crit", "bleed"]),
    attack: attack("melee", "physical"),
  }),
  spear: defineMoveset({
    key: "spear",
    name: "槍",
    desc: "長い突き 4 段（3 段目は二連突き）。穂先で当てると怯み値が倍になる。右は突進突き",
    steps: reviveSteps(W.spear.steps),
    dashAttack: reviveStep(W.spear.dashAttack),
    tip: W.spear.tip,
    attackMoveMul: W.spear.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.spear.steps2),
    branches: reviveBranches(W.spear.branches),
    keywords: kw(["melee", "stagger", "wall"], [], ["crit", "counter"]),
    attack: attack("melee", "physical"),
  }),
  scythe: defineMoveset({
    key: "scythe",
    name: "大鎌",
    desc: "広い弧で敵を手前へ引き寄せ、最後に大きく刈る。右の鎌引きで遠くを引く",
    steps: reviveSteps(W.scythe.steps),
    dashAttack: reviveStep(W.scythe.dashAttack),
    attackMoveMul: W.scythe.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.scythe.steps2),
    branches: reviveBranches(W.scythe.branches),
    keywords: kw(["melee", "area"], ["poison", "bleed"], ["kill", "area"]),
    attack: attack("melee", "hybrid", "dark"),
  }),
  fists: defineMoveset({
    key: "fists",
    name: "拳",
    desc: "至近の速い連打。殴りながら歩ける。右とダッシュ攻撃で敵を背後へ投げる",
    steps: reviveSteps(W.fists.steps),
    dashAttack: reviveStep(W.fists.dashAttack),
    attackMoveMul: W.fists.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.fists.steps2),
    branches: reviveBranches(W.fists.branches),
    keywords: kw(["melee", "combo", "wall", "mana"], ["hurt"], ["heal"]),
    attack: attack("melee", "physical"),
  }),
  whip: defineMoveset({
    key: "whip",
    name: "鞭",
    desc: "細く長い一撃。先端で当てると最大威力で、根元は弱い。右の巻き付けで引き寄せて恐怖を付ける",
    steps: reviveSteps(W.whip.steps),
    dashAttack: reviveStep(W.whip.dashAttack),
    tip: W.whip.tip,
    attackMoveMul: W.whip.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.whip.steps2),
    branches: reviveBranches(W.whip.branches),
    keywords: kw(["melee", "area"], [], ["crit", "fear", "shock"]),
    attack: attack("melee", "physical", "lightning"),
  }),
  cleaver: defineMoveset({
    key: "cleaver",
    name: "鉈",
    desc: "重く遅い振り。どの段でも壁に叩きつける。右は肩当て",
    steps: reviveSteps(W.cleaver.steps),
    dashAttack: reviveStep(W.cleaver.dashAttack),
    attackMoveMul: W.cleaver.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.cleaver.steps2),
    branches: reviveBranches(W.cleaver.branches),
    keywords: kw(["melee", "wall", "stagger"], [], ["burn", "bleed"]),
    attack: attack("melee", "physical"),
  }),
  staff: defineMoveset({
    key: "staff",
    name: "棍",
    desc: "広く薙いで周りを打つ。威力は低いが気力がよく戻る。右の払い上げで押し返す",
    steps: reviveSteps(W.staff.steps),
    dashAttack: reviveStep(W.staff.dashAttack),
    attackMoveMul: W.staff.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.staff.steps2),
    branches: reviveBranches(W.staff.branches),
    keywords: kw(["melee", "area", "stagger", "mana"], [], ["mana"]),
    attack: attack("melee", "physical"),
  }),
  wand: defineMoveset({
    key: "wand",
    name: "杖",
    desc: "左で炎、右で氷の魔法を撃つ。左右を混ぜた 3 手で雷・毒・渦・光・闇の魔法に変わる",
    steps: reviveSteps(W.wand.steps),
    dashAttack: reviveStep(W.wand.dashAttack),
    attackMoveMul: W.wand.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.wand.steps2),
    branches: reviveBranches(W.wand.branches),
    keywords: kw(["melee", "ranged", "mana"], ["mana"], ["bullet"]),
    attack: attack("melee", "arcane", "light"),
  }),
  katana: defineMoveset({
    key: "katana",
    name: "刀",
    desc: "速い 4 段の斬りと突き。右の 1 段目は長押しで居合、カウンターで当てると勢いづく",
    steps: reviveSteps(W.katana.steps),
    dashAttack: reviveStep(W.katana.dashAttack),
    attackMoveMul: W.katana.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.katana.steps2),
    branches: reviveBranches(W.katana.branches),
    keywords: kw(["melee", "counter", "finisher"], ["still"], ["counter"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("katana", 0, {
        when: "onCounter",
        then: { kind: "damageBuff", magnitude: R.katanaCounterPct, duration: R.katanaCounterSec },
      }),
    ],
  }),
  axe: defineMoveset({
    key: "axe",
    name: "斧",
    desc: "扇の 4 段。最後の一振りで出血させ、出血した敵は崩れやすい。右は投擲（戻ってくる）",
    steps: reviveSteps(W.axe.steps),
    dashAttack: reviveStep(W.axe.dashAttack),
    attackMoveMul: W.axe.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.axe.steps2),
    branches: reviveBranches(W.axe.branches),
    keywords: kw(["melee", "bleed", "stagger"], ["bleed"], ["area"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("axe", 0, {
        when: "onMeleeHit",
        if: [{ kind: "targetHas", status: "bleed" }],
        then: { kind: "addPoise", magnitude: R.axeBleedPoise },
        icd: R.axeBleedIcd,
      }),
    ],
  }),
  shield: defineMoveset({
    key: "shield",
    name: "大盾",
    desc: "弱いが重く押す 4 段。当てるたびに一瞬身が固まる。右で構え、離すと盾押し",
    steps: reviveSteps(W.shield.steps),
    dashAttack: reviveStep(W.shield.dashAttack),
    attackMoveMul: W.shield.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.shield.steps2),
    branches: reviveBranches(W.shield.branches),
    keywords: kw(["melee", "ward", "wall", "stagger"], [], ["counter"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("shield", 0, {
        when: "onMeleeHit",
        then: { kind: "invuln", magnitude: R.shieldInvulnSec, duration: R.shieldInvulnSec },
        icd: R.shieldInvulnIcd,
      }),
    ],
  }),
  chainSickle: defineMoveset({
    key: "chainSickle",
    name: "鎖鎌",
    desc: "短く速い鎌の 4 段。右の分銅で遠くの敵を引き寄せて崩し、引いた敵を斬ると大きく怯む",
    steps: reviveSteps(W.chainSickle.steps),
    dashAttack: reviveStep(W.chainSickle.dashAttack),
    attackMoveMul: W.chainSickle.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.chainSickle.steps2),
    branches: reviveBranches(W.chainSickle.branches),
    keywords: kw(["melee", "combo", "stagger"], [], ["crit"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("chainSickle", 0, {
        when: "onMeleeHit",
        if: [{ kind: "lane", lane: "primary" }, { kind: "targetHas", status: "broken" }],
        then: { kind: "addPoise", magnitude: R.chainBrokenPoise },
      }),
    ],
  }),
  hammer: defineMoveset({
    key: "hammer",
    name: "戦鎚",
    desc: "遅く重い 4 段。左の長押しで溜め、最終段で衝撃波。堅守を叩き崩す。右は大薙ぎ",
    steps: reviveSteps(W.hammer.steps),
    dashAttack: reviveStep(W.hammer.dashAttack),
    charge: reviveCharge(W.hammer.charge),
    attackMoveMul: W.hammer.attackMoveMul,
    primary: "charge",
    steps2: reviveLane(W.hammer.steps2),
    branches: reviveBranches(W.hammer.branches),
    keywords: kw(["melee", "stagger", "area", "finisher"], ["still"], ["elite"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("hammer", 0, {
        when: "onMeleeHit",
        if: [{ kind: "finisher" }],
        then: { kind: "shockwave", magnitude: R.hammerShockwaveRatio, scaleBy: "slashBase" },
        icd: R.hammerShockwaveIcd,
      }),
      movesetRule("hammer", 1, {
        when: "onMeleeHit",
        if: [{ kind: "trigger", condition: "targetGuarded" }],
        then: { kind: "addPoise", magnitude: R.hammerGuardPoise },
      }),
    ],
  }),
  gunner: defineMoveset({
    key: "gunner",
    name: "二丁拳銃",
    desc: "左で撃ち、左右の銃口を交互に使う。右の連撃は乱れ撃ち・銃把打ち・回転撃ち。ダッシュの終わりに反転撃ち",
    steps: [],
    dashAttack: reviveStep(W.gunner.dashAttack),
    attackMoveMul: W.gunner.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.gunner.steps2),
    branches: reviveBranches(W.gunner.branches),
    keywords: kw(["ranged", "bullet", "combo"], [], ["energy", "dash"]),
    attack: attack("ranged", "physical"),
    rules: [
      movesetRule("gunner", 0, {
        when: "onRangedHit",
        then: { kind: "energy", magnitude: R.gunnerHitEnergy },
        icd: R.gunnerHitIcd,
      }),
    ],
  }),
  sidearm: defineMoveset({
    key: "sidearm",
    name: "短銃",
    desc: "左で撃ちながら軽く動ける。右の 1 段目は長押しで狙い撃ち（強い 1 発）",
    steps: [],
    dashAttack: reviveStep(W.sidearm.dashAttack),
    attackMoveMul: W.sidearm.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.sidearm.steps2),
    branches: reviveBranches(W.sidearm.branches),
    keywords: kw(["ranged", "bullet"], ["still"], ["crit"]),
    attack: attack("ranged", "physical"),
  }),
  longarm: defineMoveset({
    key: "longarm",
    name: "長銃",
    desc: "左で撃つ重い銃。右の銃剣の連撃で張り付いた敵を剥がす",
    steps: [],
    dashAttack: reviveStep(W.longarm.dashAttack),
    attackMoveMul: W.longarm.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.longarm.steps2),
    branches: reviveBranches(W.longarm.branches),
    keywords: kw(["ranged", "bullet", "stagger"], [], ["wall"]),
    attack: attack("ranged", "physical"),
  }),
  cannon: defineMoveset({
    key: "cannon",
    name: "砲",
    desc: "左で撃つ最も重い銃。右の零距離砲は周りを吹き飛ばして自分も跳び、床の設置弾をすべて起爆する",
    steps: [],
    dashAttack: reviveStep(W.cannon.dashAttack),
    attackMoveMul: W.cannon.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.cannon.steps2),
    branches: reviveBranches(W.cannon.branches),
    keywords: kw(["ranged", "explode", "area"], ["placed"], ["stagger"]),
    attack: attack("ranged", "physical"),
  }),
  thrown: defineMoveset({
    key: "thrown",
    name: "投擲",
    desc: "左で投げる。右の 1 段目の手元返しで飛んでいる弾を呼び戻し、帰りの弾は強く当たる",
    steps: [],
    dashAttack: reviveStep(W.thrown.dashAttack),
    attackMoveMul: W.thrown.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.thrown.steps2),
    branches: reviveBranches(W.thrown.branches),
    keywords: kw(["ranged", "bullet"], [], ["dash"]),
    attack: attack("ranged", "physical"),
  }),
  grenade: defineMoveset({
    key: "grenade",
    name: "擲弾",
    desc: "左で照準の地点へ砲弾を山なりに撃ち込む。至近には落とせないので、右の筒払いで押し返して間合いを作る",
    steps: [],
    dashAttack: reviveStep(W.grenade.dashAttack),
    attackMoveMul: W.grenade.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.grenade.steps2),
    branches: reviveBranches(W.grenade.branches),
    keywords: kw(["ranged", "explode", "area"], ["still"], ["stagger"]),
    attack: attack("ranged", "physical"),
  }),
  trapper: defineMoveset({
    key: "trapper",
    name: "仕掛け",
    desc: "左で床に設置弾を置き、近づいた敵を巻き込む。右で設置弾を扇に撒き散らし、3 段目で起爆する",
    steps: [],
    dashAttack: reviveStep(W.trapper.dashAttack),
    attackMoveMul: W.trapper.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.trapper.steps2),
    branches: reviveBranches(W.trapper.branches),
    keywords: kw(["ranged", "placed", "explode", "area"], [], ["dash"]),
    attack: attack("ranged", "physical"),
  }),
  warRing: defineMoveset({
    key: "warRing",
    name: "戦輪",
    desc: "左で刃の輪を投げる。右の輪払いで手に持った輪を振り、続けて右で輪を投げる",
    steps: [],
    dashAttack: reviveStep(W.warRing.dashAttack),
    attackMoveMul: W.warRing.attackMoveMul,
    primary: "shot",
    steps2: reviveLane(W.warRing.steps2),
    branches: reviveBranches(W.warRing.branches),
    keywords: kw(["ranged", "bullet", "area"], [], ["melee"]),
    attack: attack("ranged", "physical"),
  }),
  // ---- 武器 Wave 4（docs/ideas/weapons-wave4.md 2〜5 章） ----
  claws: defineMoveset({
    key: "claws",
    name: "爪",
    desc: "最速の 5 連撃。全段が 2 回以上当たり、踏み込みながら出血を重ねる。右の跳び退きで当てて離れる。出血した敵を刻むと気力が戻る",
    steps: reviveSteps(W.claws.steps),
    dashAttack: reviveStep(W.claws.dashAttack),
    attackMoveMul: W.claws.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.claws.steps2),
    branches: reviveBranches(W.claws.branches),
    keywords: kw(["melee", "combo", "bleed"], ["bleed"], ["crit", "dash"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("claws", 0, {
        when: "onMeleeHit",
        if: [{ kind: "targetHas", status: "bleed" }],
        then: { kind: "restoreMana", magnitude: R.clawsBleedMana, quiet: true },
        icd: R.clawsBleedManaIcd,
      }),
    ],
  }),
  flail: defineMoveset({
    key: "flail",
    name: "チェーンアレイ",
    desc: "鎖の先の鉄球で周りを広く打つ 4 段。右の長押しで鉄球を回し続けて周りを打ち、離すと勢いのついた一撃。3 段目以降は怯ませやすい",
    steps: reviveSteps(W.flail.steps),
    dashAttack: reviveStep(W.flail.dashAttack),
    attackMoveMul: W.flail.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.flail.steps2),
    branches: reviveBranches(W.flail.branches),
    keywords: kw(["melee", "stagger", "area", "wall"], ["still"], ["elite"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("flail", 0, {
        when: "onMeleeHit",
        if: [{ kind: "swingStep", atLeast: 2 }],
        then: { kind: "addPoise", magnitude: R.flailMomentumPoise },
      }),
    ],
  }),
  ringBlades: defineMoveset({
    key: "ringBlades",
    name: "チャクラム",
    desc: "両手の刃の輪で速く広く斬る 4 段。右の周回で輪を自分の周りに回らせ、4 段目で投げる（戻る）。輪が当たった直後の斬りは怯ませやすい",
    steps: reviveSteps(W.ringBlades.steps),
    dashAttack: reviveStep(W.ringBlades.dashAttack),
    attackMoveMul: W.ringBlades.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.ringBlades.steps2),
    branches: reviveBranches(W.ringBlades.branches),
    keywords: kw(["melee", "ranged", "combo", "area"], [], ["bullet", "crit"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("ringBlades", 0, {
        when: "onMeleeHit",
        if: [{ kind: "recent", event: "onRangedHit", within: R.ringRecentSec }],
        then: { kind: "addPoise", magnitude: R.ringRecentPoise },
      }),
    ],
  }),
  fan: defineMoveset({
    key: "fan",
    name: "扇子",
    desc: "舞いながら振る 4 段。威力は低いが大きく押し返し、4 段目は敵弾を払う。振るたびに風が床の炎・煙・毒沼を広げる。右は構え、離すと突風",
    steps: reviveSteps(W.fan.steps),
    dashAttack: reviveStep(W.fan.dashAttack),
    attackMoveMul: W.fan.attackMoveMul,
    primary: "melee",
    steps2: reviveLane(W.fan.steps2),
    branches: reviveBranches(W.fan.branches),
    keywords: kw(["melee", "area", "wall"], [], ["burn", "poison", "dash"]),
    // 風の属性は無いので、混成で防御と魔防の平均で受けさせる
    attack: attack("melee", "hybrid"),
    rules: [
      // 自分の足元で広げると炎・毒の上で自分を焼くので、当てた敵の足元で広げる
      movesetRule("fan", 0, {
        when: "onMeleeHit",
        then: { kind: "spreadTerrain", magnitude: 0, radius: R.fanSpreadRadius },
        icd: R.fanSpreadIcd,
      }),
      movesetRule("fan", 1, {
        when: "onMeleeHit",
        if: [{ kind: "targetOnTerrain", terrain: "fire" }],
        then: { kind: "addPoise", magnitude: R.fanEmberPoise },
      }),
    ],
  }),
};

/** 銃の家系（左で撃つ武器種）。祝福の loadout・性質の家系条件が読む */
export const GUN_MOVESETS: readonly MovesetKey[] = ["sidearm", "longarm", "cannon", "thrown", "gunner", "grenade", "trapper", "warRing"];

/** 武器種の固有効果の Rule（今の武器種のものだけ。定義が無ければ空） */
export function movesetRules(key: MovesetKey): readonly Rule[] {
  return MOVESETS[key]?.rules ?? [];
}

/** 銃の家系か（左で撃つ。近接の段を持たない） */
export function isGun(moveset: MovesetDef): boolean {
  return moveset.primary === "shot";
}

/** 弾を出す武器種か（銃の家系、右レーンに弾を出す段がある、または振りが cast を持つ）。祝福の「射撃」タグの生死判定 */
export function usesProjectiles(moveset: MovesetDef): boolean {
  return isGun(moveset) || moveset.steps2.some((s) => s.kind === "volley") || movesetCasts(moveset).length > 0;
}

/** レーンの段数（左 = steps、右 = steps2） */
export function laneLength(moveset: MovesetDef, lane: ButtonKey): number {
  return lane === "primary" ? moveset.steps.length : moveset.steps2.length;
}

/** レーンの index 段目の定義（左は振り、右は右レーンの段）。範囲外は undefined */
export function laneStep(moveset: MovesetDef, lane: "primary", index: number): MeleeStepDef | undefined;
export function laneStep(moveset: MovesetDef, lane: "secondary", index: number): ActionStepDef | undefined;
export function laneStep(moveset: MovesetDef, lane: ButtonKey, index: number): MeleeStepDef | ActionStepDef | undefined;
export function laneStep(moveset: MovesetDef, lane: ButtonKey, index: number): MeleeStepDef | ActionStepDef | undefined {
  return lane === "primary" ? moveset.steps[index] : moveset.steps2[index];
}

/** レーンの index 段目の振り（右の振り以外の段・範囲外は undefined）。player.ts の meleeStep が段を引くときに使う */
export function laneSwing(moveset: MovesetDef, lane: ButtonKey, index: number): MeleeStepDef | undefined {
  if (lane === "primary") return moveset.steps[index];
  const s = moveset.steps2[index];
  return s?.kind === "swing" ? s.step : undefined;
}

/** 右の段の表示名。名前の無い振りの段は「n 段目」 */
export function actionStepName(s: ActionStepDef, index: number): string {
  return s.name ?? `${index + 1} 段目`;
}

/** 右の段の再使用の秒（再使用の無い段は 0） */
export function actionCooldown(s: ActionStepDef): number {
  return s.cooldown ?? 0;
}

/** 右レーンの段を出した後の入力の窓（秒）。段の上書きが無ければ全武器共通の WEAPON.chainWindow */
export function laneChainWindow(s: ActionStepDef | undefined): number {
  if (s === undefined || s.kind === "swing") return WEAPON.chainWindow;
  return s.chainWindow ?? WEAPON.chainWindow;
}

/**
 * 武器種に派生を 1 本足した型（ジョブ固有の派生）。同じ入力列の派生を武器種が既に持つなら足さない（武器種が優先）。
 * 照合は長い列から（reviveBranches と同じ並び）
 */
export function withExtraBranch(moveset: MovesetDef, extra: BranchDef): MovesetDef {
  const seq = extra.sequence.join(",");
  if (moveset.branches.some((b) => b.sequence.join(",") === seq)) return moveset;
  const branches = [...moveset.branches, extra].sort((a, b) => b.sequence.length - a.sequence.length);
  return { ...moveset, branches };
}

/**
 * 近接の溜めの役割を持つボタン（刀の居合は右、大剣・戦鎚は左）。溜めを持たない武器種は undefined。
 * 短銃の狙い撃ちは右レーンの構えの経路（weaponArts.ts）で溜めるので含めない
 */
export function chargeButton(moveset: MovesetDef): ButtonKey | undefined {
  if (moveset.steps2.some((s) => s.kind === "charge")) return "secondary";
  return moveset.primary === "charge" ? "primary" : undefined;
}

/** 近接の溜めの定義（右レーンの居合の段、または左の溜め）。短銃の狙い撃ちは近接の溜めではないので含めない */
export function meleeChargeOf(moveset: MovesetDef): MeleeChargeDef | undefined {
  for (const s of moveset.steps2) {
    if (s.kind === "charge") return s.charge;
  }
  return moveset.primary === "charge" ? moveset.charge : undefined;
}

/** 右レーンの最初の弾の段の弾（派生の shots.from が "lane" のときに使う）。無ければ undefined */
export function laneVolley(moveset: MovesetDef): ThrowArtDef | undefined {
  for (const s of moveset.steps2) {
    if (s.kind === "volley") return s.throw;
  }
  return undefined;
}

/** 武器種のすべての振り（左の段・ダッシュ攻撃・派生・右の振り・構えの離し・溜め・回し）が持つ cast。弾の表（loot/bullets.ts）が拾う */
export function movesetCasts(moveset: MovesetDef): CastDef[] {
  const steps: (MeleeStepDef | undefined)[] = [...moveset.steps, moveset.dashAttack, ...moveset.branches.map((b) => b.step)];
  for (const s of moveset.steps2) {
    if (s.kind === "swing") steps.push(s.step);
    if (s.kind === "hold") steps.push(s.hold.release);
    if (s.kind === "charge") steps.push(s.charge.step, s.charge.spinning?.step);
  }
  steps.push(moveset.charge?.step, moveset.charge?.spinning?.step);
  const out: CastDef[] = [];
  for (const s of steps) {
    if (s?.cast) out.push(s.cast);
  }
  return out;
}

/** 構えを離した振りの派生の添字（構えの技に release が無ければ undefined） */
export function releaseBranchIndex(moveset: MovesetDef): number | undefined {
  const index = moveset.branches.findIndex((b) => b.art === "release");
  return index >= 0 ? index : undefined;
}

/** 入力列の末尾に一致する派生（長い列が先）。構えを離した振りは押した瞬間には照合しない。無ければ undefined */
export function matchBranch(moveset: MovesetDef, inputs: readonly ButtonKey[]): number | undefined {
  const index = moveset.branches.findIndex((b) => b.art !== "release" && endsWith(inputs, b.sequence));
  return index >= 0 ? index : undefined;
}

function endsWith(inputs: readonly ButtonKey[], tail: readonly ButtonKey[]): boolean {
  if (tail.length === 0 || tail.length > inputs.length) return false;
  const offset = inputs.length - tail.length;
  return tail.every((k, i) => inputs[offset + i] === k);
}

/** HUD の「次に押すと」に出す 1 件。button を押せば name の派生が出る */
export interface BranchHint {
  readonly button: ButtonKey;
  readonly name: string;
}

/**
 * いまの入力列に 1 手足すと成立する派生（docs/ideas/combat-feel-design.md D-1）。
 * moveset.branches は長い sequence から並ぶので、左右それぞれ最長一致の派生だけを返す
 */
export function branchHints(moveset: MovesetDef, inputs: readonly ButtonKey[]): BranchHint[] {
  const hints: BranchHint[] = [];
  const seen = new Set<ButtonKey>();
  for (const b of moveset.branches) {
    if (b.art === "release") continue;
    const need = b.sequence.slice(0, -1);
    const button = b.sequence[b.sequence.length - 1];
    if (button === undefined || seen.has(button) || !tailMatches(inputs, need)) continue;
    seen.add(button);
    hints.push({ button, name: b.name });
  }
  return hints;
}

/** 入力列の末尾が need と一致するか（need が空なら常に一致） */
function tailMatches(inputs: readonly ButtonKey[], need: readonly ButtonKey[]): boolean {
  if (need.length > inputs.length) return false;
  const offset = inputs.length - need.length;
  return need.every((k, i) => inputs[offset + i] === k);
}

/** 奥義の円月の素性。威力は精神 + 霊力なので範囲・魔法（docs/COMBAT_DESIGN.md A-8） */
export const BURST_ATTACK: AttackProfile = attack("area", "arcane");

/** 右手が空のときの型。拳の型を流用し、威力は WEAPON.unarmed.damageMul（loot/stats.ts の applyWeaponForms） */
export const DEFAULT_MOVESET: MovesetKey = "fists";

/** 右手が空のときの表示名（型は拳だが、武器を持っていないことを名前で示す） */
export const UNARMED_NAME = "素手";

/** 表示用の武器種名。素手なら拳ではなく「素手」 */
export function movesetLabel(moveset: Readonly<MovesetDef>, unarmed: boolean): string {
  return unarmed ? UNARMED_NAME : moveset.name;
}

export function movesetDef(key: MovesetKey): MovesetDef {
  return MOVESETS[key];
}

/** 溜めた秒数から段（0 = 段なし）を求める */
export function chargeLevelAt(levels: readonly { readonly time: number }[], held: number): number {
  let level = 0;
  for (const l of levels) {
    if (held >= l.time) level += 1;
  }
  return level;
}
