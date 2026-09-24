import { type AttackProfile, attack } from "../core/element";
import { type KeywordProfile, kw } from "../core/keywords";
import type { EventKind } from "../core/events";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import { STATUS_KINDS, type StatusApply, type StatusKind } from "../core/status";
import type { AttrRatio, Scaling } from "../loot/types";
import { ACTION, MANA, PLAYER, WEAPON } from "./tuning";

/**
 * 武器種（通常攻撃の型・右クリックの固有技）と射撃の型。docs/COMBAT_DESIGN.md「武器種」/ docs/ideas/weapon-redesign.md。
 * 右手のベースが moveset を決め、銃の家系（GUN_MOVESETS）のベースは撃つ弾の型 shot も決める（src/loot/bases.ts）。
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
] as const;
export type MovesetKey = (typeof MOVESET_KEYS)[number];

export const SHOT_KEYS = ["single", "rapid", "spread", "pierce", "homing", "ricochet", "charge", "mine", "burst", "boomerang", "lob"] as const;
export type ShotKey = (typeof SHOT_KEYS)[number];

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
}

/** 左クリック（攻撃キー）= primary、右クリック（固有技のキー）= secondary */
export type ButtonKey = "primary" | "secondary";

/**
 * 左クリックの役割。melee = 押すたびに連撃の次の段 / charge = 長押しで溜め、離して振る（大剣・戦鎚。tap は連撃）/
 * shot = 押している間、ベースの射撃の型で撃つ（銃の家系だけ）
 */
export type PrimaryKind = "melee" | "charge" | "shot";

/** 右クリックの固有技の種類（docs/ideas/weapon-redesign.md 3 章） */
export type WeaponArtKind = "strike" | "charge" | "hold" | "throw" | "recall";

interface ArtBase {
  /** "parry" など。名前は ART_NAMES（BRANCH_NAMES と同じ流儀） */
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  /** 再使用までの秒。0 なら連撃と同じで制限なし（strike / charge は 0 が基本） */
  readonly cooldown: number;
}

/** 1 振りの技の付随効果（砲の零距離砲） */
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

export type WeaponArtDef =
  | (ArtBase & { readonly kind: "strike"; readonly step: MeleeStepDef; readonly next?: number; readonly extras?: StrikeExtras })
  | (ArtBase & { readonly kind: "charge"; readonly charge: MeleeChargeDef; readonly aim?: undefined })
  | (ArtBase & { readonly kind: "charge"; readonly aim: AimArtDef; readonly charge?: undefined })
  | (ArtBase & { readonly kind: "hold"; readonly hold: HoldArtDef })
  | (ArtBase & { readonly kind: "throw"; readonly throw: ThrowArtDef })
  | (ArtBase & { readonly kind: "recall"; readonly recall: RecallArtDef });

/** 押している間の構え。parry か guard のどちらかを持つ */
export interface HoldArtDef {
  readonly moveMul: number;
  /** これ以上押しても自動で解除する秒 */
  readonly maxSec: number;
  /** 受け流し: 押してから windowSec の間の被弾を無効化し、相手に怯み値 staggerPoise を入れてカウンター扱い（onCounter を発火）。失敗時は recoverSec の硬直 */
  readonly parry?: { readonly windowSec: number; readonly recoverSec: number; readonly staggerPoise: number };
  /** 構え: 向きから arcDeg の被弾を damageMul 倍にし、受けるたびに必殺ゲージ energyGain */
  readonly guard?: { readonly arcDeg: number; readonly damageMul: number; readonly energyGain: number };
  /** 離した瞬間に出す振り（盾押し）。内部では `${key}.release` の派生として branches に入れる */
  readonly release?: MeleeStepDef;
  /** 離した振りの後に続ける連撃の段（省略はフィニッシュ） */
  readonly releaseNext?: number;
}

/** 弾を出す技。弾の挙動は射撃の型（SHOT_TYPES）を借り、威力・怯み値・素性は技のもの */
export interface ThrowArtDef {
  readonly shot: ShotKey;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
  readonly count: number;
  readonly spreadDeg: number;
  readonly attack: AttackProfile;
  /** 弾の絵のキー（省略は BULLET の点。斧は武器の絵を回す） */
  readonly sprite?: string;
}

/** 自分の弾を手元へ戻す。戻りの弾は威力 returnDamageMul 倍 */
export interface RecallArtDef {
  readonly returnDamageMul: number;
  readonly speedMul: number;
}

/** 固有技から作った派生の印。strike = 右単独の技、release = 構えを離した振り（押した瞬間には照合しない） */
export type BranchArtRole = "strike" | "release";

/** コンボ派生: 入力列の末尾が sequence と一致したら、次の振りを step に差し替える */
export interface BranchDef {
  readonly key: string;
  /** 表示名 */
  readonly name: string;
  readonly sequence: readonly ButtonKey[];
  readonly step: MeleeStepDef;
  /** 派生の後に連撃を続ける段（0 始まり）。省略はフィニッシュ（連撃がここで終わる） */
  readonly next?: number;
  /** 固有技から作った派生（defineMoveset が付ける） */
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
  /** 右クリックの固有技 */
  readonly art: WeaponArtDef;
  /** コンボ派生（入力列の長いものから照合する）。strike の技と hold の release は defineMoveset が ["secondary"] の派生として混ぜる */
  readonly branches: readonly BranchDef[];
  /** 出す / 食う / 強める語 */
  readonly keywords: KeywordProfile;
  /** 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）。近接の段・ダッシュ攻撃・派生すべてに掛かる */
  readonly attack: AttackProfile;
  /** 武器種の固有効果（統一ルール文法）。system/rules.ts の collectRules が今の武器種の分だけ集める */
  readonly rules?: readonly Rule[];
}

export interface ShotChargeLevelDef {
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

export interface ShotDef {
  readonly key: ShotKey;
  readonly name: string;
  readonly desc: string;
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
  readonly charge?: { readonly levels: readonly ShotChargeLevelDef[] };
  readonly mine?: MineDef;
  /** 三点: 1 押しで count 発を interval 秒おきに撃つ */
  readonly burst?: { readonly count: number; readonly interval: number };
  /** 回転刃: 寿命の returnAt の割合で反転して手元へ戻り、catchRadius で手に収まる */
  readonly boomerang?: { readonly returnAt: number; readonly catchRadius: number };
  /** 曲射: 照準の距離（minRange〜射程）で炸裂する。peak は描画の山の高さ（px） */
  readonly lob?: { readonly blastRadius: number; readonly minRange: number; readonly peak: number; readonly color: string };
  /** 1 発の威力の係数（A-10）。省略は PLAYER.shoot.scaling。damageMul はこの後に掛かる */
  readonly scaling?: Scaling;
  /** 怯み値のステータス係数（A-10）。PLAYER.shoot.poise × poiseMul に上乗せする。省略はステータスで伸びない */
  readonly poiseRatio?: AttrRatio;
  readonly keywords: KeywordProfile;
  /** 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）。敵の防御 / 魔防のどちらで受けるかを決める */
  readonly attack: AttackProfile;
}

/** 弾ごとの型の作業領域（Projectile.shot）。projectiles.ts が読む */
export interface ShotRuntime {
  key: ShotKey;
  /** 跳弾の残り回数 */
  bouncesLeft?: number;
  /** 設置弾が炸裂したか（二重に炸裂させない） */
  detonated?: boolean;
  /** 撃った瞬間の寿命（回転刃の反転・曲射の山の高さの基準） */
  lifeTotal?: number;
  /** 回転刃が手元へ戻っている最中 */
  returning?: boolean;
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
  return PLAYER.melee.map((s, i) => ({ ...s, shape: BOX, mana: MANA.onMelee[i] ?? 0 }));
}

/**
 * WEAPON（src/data/balance/weapons.json）は union 文字列（shape.kind / applies[].kind / sequence の要素 / art.throw.shot）を
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
  return { kind: raw.kind as StatusKind, stacks: raw.stacks, duration: raw.duration, potency: raw.potency };
}

function buttonKey(raw: unknown): ButtonKey {
  if (raw === "primary" || raw === "secondary") return raw;
  throw new Error(`未知の ButtonKey: ${String(raw)}`);
}

function shotKeyOf(raw: unknown): ShotKey {
  if (typeof raw === "string" && (SHOT_KEYS as readonly string[]).includes(raw)) return raw as ShotKey;
  throw new Error(`未知の ShotKey: ${String(raw)}`);
}

/** JSON の段（steps / dashAttack / branches[].step / art.step など）を MeleeStepDef に絞る。jobs.ts の jobBranches も使う */
export function reviveStep(raw: unknown): MeleeStepDef {
  const r = raw as Record<string, unknown>;
  const rawApplies = r.applies as readonly unknown[] | undefined;
  const step = { ...r, shape: hitShape(r.shape) } as unknown as MeleeStepDef;
  return rawApplies ? { ...step, applies: rawApplies.map(statusApply) } : step;
}

function reviveSteps(raw: unknown): MeleeStepDef[] {
  return (raw as readonly unknown[]).map(reviveStep);
}

function reviveBranches(raw: unknown): BranchTable {
  const out: Record<string, { sequence: readonly ButtonKey[]; step: MeleeStepDef; next?: number }> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const b = v as { readonly sequence: readonly unknown[]; readonly step: unknown; readonly next?: number };
    out[key] = { sequence: b.sequence.map(buttonKey), step: reviveStep(b.step), next: b.next };
  }
  return out;
}

function reviveCharge(raw: unknown): MeleeChargeDef {
  const r = raw as { readonly moveMul: number; readonly step: unknown; readonly levels: readonly ChargeLevelDef[] };
  return { moveMul: r.moveMul, step: reviveStep(r.step), levels: r.levels };
}

function reviveStrikeTuning(raw: unknown): StrikeTuning {
  const r = raw as { readonly cooldown: number; readonly next?: number; readonly step: unknown; readonly selfKnock?: number; readonly detonateMines?: boolean };
  return { cooldown: r.cooldown, next: r.next, step: reviveStep(r.step), selfKnock: r.selfKnock, detonateMines: r.detonateMines };
}

/** 押している間の構え（HoldArtDef）。release（離した振り）が無ければそのまま */
function reviveHold(raw: unknown): HoldArtDef {
  const r = raw as Record<string, unknown>;
  return { ...(r as unknown as HoldArtDef), release: r.release !== undefined ? reviveStep(r.release) : undefined };
}

/** 弾を出す技（ThrowTuning）。throw.shot だけ絞る */
function reviveThrowTuning(raw: unknown): ThrowTuning {
  const r = raw as { readonly cooldown: number; readonly throw: Record<string, unknown> };
  return { cooldown: r.cooldown, throw: { ...(r.throw as unknown as ThrowTuning["throw"]), shot: shotKeyOf(r.throw.shot) } };
}

const W = WEAPON.movesets;

/** 派生の表示名（数値は tuning の WEAPON.movesets[].branches） */
const BRANCH_NAMES: Readonly<Record<string, string>> = {
  crossCut: "十字断ち",
  steppingCut: "踏み込み斬り",
  helmSplitter: "兜割り",
  flurry: "乱れ斬り",
  crossing: "交差斬り",
  spearSweep: "石突き回し",
  reaping: "刈り取り",
  uppercut: "昇り拳",
  hundredFists: "百裂拳",
  whirl: "巻き打ち",
  slamDown: "叩き落とし",
  tempest: "旋風",
  arcaneStrike: "魔力撃",
  staffSweep: "杖払い",
  tsubame: "燕返し",
  quickDraw: "抜き打ち",
  axeSpin: "回転斬り",
  cleave: "断ち割り",
  shieldDrop: "盾落とし",
  reelIn: "巻き取り",
  groundBreaker: "地砕き",
};

/** 固有技の表示名（数値は tuning の WEAPON.movesets[].art）。構えの離した振りは `${key}.release` */
export const ART_NAMES: Readonly<Record<string, string>> = {
  parry: "受け流し",
  sweep: "薙ぎ払い",
  shadowStep: "影踏み",
  chargeThrust: "突進突き",
  hookPull: "鎌引き",
  grabThrow: "掴み投げ",
  entangle: "巻き付け",
  shoulderCharge: "肩当て",
  upswing: "払い上げ",
  arcaneBolt: "魔弾",
  iai: "居合",
  axeThrow: "投擲",
  guard: "構え",
  "guard.release": "盾押し",
  chainWeight: "分銅",
  hammerSweep: "大薙ぎ",
  aimedShot: "狙い撃ち",
  bayonet: "銃剣突き",
  pointBlank: "零距離砲",
  recall: "手元返し",
  barrage: "乱れ撃ち",
};

type BranchTable = Readonly<Record<string, { readonly sequence: readonly ButtonKey[]; readonly step: MeleeStepDef; readonly next?: number }>>;

/** tuning の派生表を BranchDef の配列にする。照合は長い列から（「左左右」を「左右」より先に見る） */
function branchesOf(table: BranchTable): BranchDef[] {
  return Object.entries(table)
    .map(([key, b]) => ({ key, name: BRANCH_NAMES[key] ?? key, sequence: b.sequence, step: b.step, next: b.next }))
    .sort((a, b) => b.sequence.length - a.sequence.length);
}

/** 固有技を派生として出すときの入力列（右 1 手） */
const ART_SEQUENCE: readonly ButtonKey[] = ["secondary"];

function artName(key: string): string {
  return ART_NAMES[key] ?? key;
}

interface StrikeTuning {
  readonly cooldown: number;
  readonly next?: number;
  readonly step: MeleeStepDef;
  readonly selfKnock?: number;
  readonly detonateMines?: boolean;
}

/** 1 振りの技（右単独の派生として branches に入る） */
function strikeArt(key: string, desc: string, t: StrikeTuning): WeaponArtDef {
  const hasExtras = t.selfKnock !== undefined || t.detonateMines === true;
  const extras: StrikeExtras | undefined = hasExtras ? { selfKnock: t.selfKnock, detonateMines: t.detonateMines } : undefined;
  return { kind: "strike", key, name: artName(key), desc, cooldown: t.cooldown, step: t.step, next: t.next, extras };
}

interface ThrowTuning {
  readonly cooldown: number;
  readonly throw: {
    readonly shot: ShotKey;
    readonly scaling: Scaling;
    readonly poise: number;
    readonly poiseRatio?: AttrRatio;
    readonly count: number;
    readonly spreadDeg: number;
  };
}

/** 弾を出す技。素性（ジャンル・属性）は技ごとに決める */
function throwArt(key: string, desc: string, t: ThrowTuning, profile: AttackProfile, sprite?: string): WeaponArtDef {
  return { kind: "throw", key, name: artName(key), desc, cooldown: t.cooldown, throw: { ...t.throw, attack: profile, sprite } };
}

/** 固有技から派生を作る。strike は右単独の派生、hold の release は構えを離したときだけ出す派生（押した瞬間には照合しない） */
function artBranches(art: WeaponArtDef): BranchDef[] {
  if (art.kind === "strike") return [{ key: art.key, name: art.name, sequence: ART_SEQUENCE, step: art.step, next: art.next, art: "strike" }];
  if (art.kind !== "hold" || !art.hold.release) return [];
  const key = `${art.key}.release`;
  return [{ key, name: artName(key), sequence: ART_SEQUENCE, step: art.hold.release, next: art.hold.releaseNext, art: "release" }];
}

/**
 * 武器種の定義を仕上げる。strike の技と hold の release を ["secondary"] の派生として branches に混ぜ、
 * branchesOf と同じ並び（長い列が先。同じ長さは元の順）にする。既存の matchBranch / 来歴の branchHits がそのまま効く
 */
export function defineMoveset(def: MovesetDef): MovesetDef {
  const extra = artBranches(def.art);
  if (extra.length === 0) return def;
  const branches = [...def.branches, ...extra].sort((a, b) => b.sequence.length - a.sequence.length);
  return { ...def, branches };
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

const GUN_ATTACK = attack("ranged", "physical");

export const MOVESETS: Readonly<Record<MovesetKey, MovesetDef>> = {
  sword: defineMoveset({
    key: "sword",
    name: "剣",
    desc: "3 段の素直な斬撃。右で受け流し、左左右で十字断ち、受け流してすぐ斬ると踏み込み斬り",
    steps: swordSteps(),
    dashAttack: { ...ACTION.dashAttack, shape: BOX, mana: MANA.onDashAttack },
    attackMoveMul: W.sword.attackMoveMul,
    primary: "melee",
    art: { kind: "hold", key: "parry", name: artName("parry"), desc: "押した直後の被弾を無効にし、相手を大きく怯ませる。外すと一瞬硬直する", cooldown: W.sword.art.cooldown, hold: reviveHold(W.sword.art.hold) },
    branches: branchesOf(reviveBranches(W.sword.branches)),
    keywords: kw(["melee", "combo", "finisher"], [], ["counter"]),
    attack: attack("melee", "physical"),
  }),
  greatsword: defineMoveset({
    key: "greatsword",
    name: "大剣",
    desc: "広い弧の大振り 4 段。長押しで 3 段階まで溜める。右クリックは薙ぎ払い",
    steps: reviveSteps(W.greatsword.steps),
    dashAttack: reviveStep(W.greatsword.dashAttack),
    charge: reviveCharge(W.greatsword.charge),
    attackMoveMul: W.greatsword.attackMoveMul,
    primary: "charge",
    art: strikeArt("sweep", "広く薙ぎ払う。続けて左で 3 段目へ", reviveStrikeTuning(W.greatsword.art)),
    branches: branchesOf(reviveBranches(W.greatsword.branches)),
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
    art: strikeArt("shadowStep", "踏み込んで突く。踏み込みの間は無敵。続けて左で 2 段目へ", reviveStrikeTuning(W.twinBlades.art)),
    branches: branchesOf(reviveBranches(W.twinBlades.branches)),
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
    art: strikeArt("chargeThrust", "大きく踏み込んで突き、壁に叩きつける。続けて左で 2 段目へ", reviveStrikeTuning(W.spear.art)),
    branches: branchesOf(reviveBranches(W.spear.branches)),
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
    art: strikeArt("hookPull", "鎌を突き出して引き寄せる。続けて左で 2 段目へ", reviveStrikeTuning(W.scythe.art)),
    branches: branchesOf(reviveBranches(W.scythe.branches)),
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
    art: strikeArt("grabThrow", "掴んで背後へ放り、壁に叩きつける", reviveStrikeTuning(W.fists.art)),
    branches: branchesOf(reviveBranches(W.fists.branches)),
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
    art: strikeArt("entangle", "巻き付けて手前へ引き、恐怖を付ける。続けて左で 2 段目へ", reviveStrikeTuning(W.whip.art)),
    branches: branchesOf(reviveBranches(W.whip.branches)),
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
    art: strikeArt("shoulderCharge", "肩から踏み込んで押し飛ばす。続けて左で 2 段目へ", reviveStrikeTuning(W.cleaver.art)),
    branches: branchesOf(reviveBranches(W.cleaver.branches)),
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
    art: strikeArt("upswing", "払い上げて大きく押し返す。続けて左で 2 段目へ", reviveStrikeTuning(W.staff.art)),
    branches: branchesOf(reviveBranches(W.staff.branches)),
    keywords: kw(["melee", "area", "stagger", "mana"], [], ["mana"]),
    attack: attack("melee", "physical"),
  }),
  wand: defineMoveset({
    key: "wand",
    name: "杖",
    desc: "左で杖打ちの連撃、右で魔弾を撃つ。打ってから撃つと魔力撃",
    steps: reviveSteps(W.wand.steps),
    dashAttack: reviveStep(W.wand.dashAttack),
    attackMoveMul: W.wand.attackMoveMul,
    primary: "melee",
    art: throwArt("arcaneBolt", "光の魔弾を 1 発撃つ（射撃として当たる）", reviveThrowTuning(W.wand.art), attack("ranged", "arcane", "light")),
    branches: branchesOf(reviveBranches(W.wand.branches)),
    keywords: kw(["melee", "ranged", "mana"], ["mana"], ["bullet"]),
    attack: attack("melee", "arcane", "light"),
  }),
  katana: defineMoveset({
    key: "katana",
    name: "刀",
    desc: "速い 3 段の斬りと突き。右の長押しで居合、カウンターで当てると勢いづく",
    steps: reviveSteps(W.katana.steps),
    dashAttack: reviveStep(W.katana.dashAttack),
    attackMoveMul: W.katana.attackMoveMul,
    primary: "melee",
    art: { kind: "charge", key: "iai", name: artName("iai"), desc: "押して溜め、離して一閃。溜めずに離すと抜き打ちに繋がる", cooldown: 0, charge: reviveCharge(W.katana.charge) },
    branches: branchesOf(reviveBranches(W.katana.branches)),
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
    art: throwArt("axeThrow", "斧を投げる。行って戻り、行きと帰りで斬る（射撃として当たる）", reviveThrowTuning(W.axe.art), GUN_ATTACK, "weapon.axe"),
    branches: branchesOf(reviveBranches(W.axe.branches)),
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
    art: { kind: "hold", key: "guard", name: artName("guard"), desc: "押している間、前からの被弾を大きく減らし必殺ゲージを溜める。離すと盾押し", cooldown: W.shield.art.cooldown, hold: reviveHold(W.shield.art.hold) },
    branches: branchesOf(reviveBranches(W.shield.branches)),
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
    art: strikeArt("chainWeight", "分銅を投げて引き寄せ、崩勢にする。続けて左で 2 段目へ", reviveStrikeTuning(W.chainSickle.art)),
    branches: branchesOf(reviveBranches(W.chainSickle.branches)),
    keywords: kw(["melee", "combo", "stagger"], [], ["crit"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("chainSickle", 0, {
        when: "onMeleeHit",
        if: [{ kind: "not", condition: { kind: "branchSwing" } }, { kind: "targetHas", status: "broken" }],
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
    art: strikeArt("hammerSweep", "大きく薙ぎ払う。続けて左で 3 段目へ", reviveStrikeTuning(W.hammer.art)),
    branches: branchesOf(reviveBranches(W.hammer.branches)),
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
    desc: "左で撃ち、左右の銃口を交互に使う。右の乱れ撃ちで周りを撃ち払う。近接はダッシュの終わりの反転撃ちだけ",
    steps: [],
    dashAttack: reviveStep(W.gunner.dashAttack),
    attackMoveMul: W.gunner.attackMoveMul,
    primary: "shot",
    art: throwArt("barrage", "全方位へ弾をばら撒く", reviveThrowTuning(W.gunner.art), GUN_ATTACK),
    branches: [],
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
    desc: "左で撃ちながら軽く動ける。右の長押しで狙い撃ち（強い 1 発）",
    steps: [],
    dashAttack: reviveStep(W.sidearm.dashAttack),
    attackMoveMul: W.sidearm.attackMoveMul,
    primary: "shot",
    art: { kind: "charge", key: "aimedShot", name: artName("aimedShot"), desc: "足を止めて狙い、離すと強く貫く 1 発を撃つ", cooldown: W.sidearm.art.cooldown, aim: W.sidearm.art.aim },
    branches: [],
    keywords: kw(["ranged", "bullet"], ["still"], ["crit"]),
    attack: attack("ranged", "physical"),
  }),
  longarm: defineMoveset({
    key: "longarm",
    name: "長銃",
    desc: "左で撃つ重い銃。右の銃剣突きで張り付いた敵を剥がす",
    steps: [],
    dashAttack: reviveStep(W.longarm.dashAttack),
    attackMoveMul: W.longarm.attackMoveMul,
    primary: "shot",
    art: strikeArt("bayonet", "銃剣で踏み込んで突き、押し返す", reviveStrikeTuning(W.longarm.art)),
    branches: [],
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
    art: strikeArt("pointBlank", "至近を吹き飛ばして後ろへ跳ぶ。床の自分の設置弾をすべて起爆する", reviveStrikeTuning(W.cannon.art)),
    branches: [],
    keywords: kw(["ranged", "explode", "area"], ["placed"], ["stagger"]),
    attack: attack("ranged", "physical"),
  }),
  thrown: defineMoveset({
    key: "thrown",
    name: "投擲",
    desc: "左で投げる。右の手元返しで飛んでいる弾を呼び戻し、帰りの弾は強く当たる",
    steps: [],
    dashAttack: reviveStep(W.thrown.dashAttack),
    attackMoveMul: W.thrown.attackMoveMul,
    primary: "shot",
    art: { kind: "recall", key: "recall", name: artName("recall"), desc: "飛んでいる自分の弾をすべて手元へ向け直す", cooldown: W.thrown.art.cooldown, recall: W.thrown.art.recall },
    branches: [],
    keywords: kw(["ranged", "bullet"], [], ["dash"]),
    attack: attack("ranged", "physical"),
  }),
};

/** 銃の家系（左で撃つ武器種）。祝福の loadout・性質の家系条件が読む */
export const GUN_MOVESETS: readonly MovesetKey[] = ["sidearm", "longarm", "cannon", "thrown", "gunner"];

/** 武器種の固有効果の Rule（今の武器種のものだけ。定義が無ければ空） */
export function movesetRules(key: MovesetKey): readonly Rule[] {
  return MOVESETS[key]?.rules ?? [];
}

/** 銃の家系か（左で撃つ。近接の段を持たない） */
export function isGun(moveset: MovesetDef): boolean {
  return moveset.primary === "shot";
}

/** @deprecated isGun の別名（段階的に消す） */
export function isShotOnly(moveset: MovesetDef): boolean {
  return isGun(moveset);
}

/** 弾を出す武器種か（銃の家系、または固有技が弾を出す）。祝福の「射撃」タグの生死判定 */
export function usesProjectiles(moveset: MovesetDef): boolean {
  return isGun(moveset) || moveset.art.kind === "throw";
}

/**
 * 武器種に派生を 1 本足した型（ジョブ固有の派生）。同じ入力列の派生を武器種が既に持つなら足さない（武器種が優先）。
 * 照合は長い列から（branchesOf と同じ並び）
 */
export function withExtraBranch(moveset: MovesetDef, extra: BranchDef): MovesetDef {
  const seq = extra.sequence.join(",");
  if (moveset.branches.some((b) => b.sequence.join(",") === seq)) return moveset;
  const branches = [...moveset.branches, extra].sort((a, b) => b.sequence.length - a.sequence.length);
  return { ...moveset, branches };
}

/** 近接の連撃を出すボタン。銃の家系は持たない */
export function meleeButton(moveset: MovesetDef): ButtonKey | undefined {
  return isGun(moveset) ? undefined : "primary";
}

/** 射撃のボタン（銃の家系だけ左） */
export function shotButton(moveset: MovesetDef): ButtonKey | undefined {
  return isGun(moveset) ? "primary" : undefined;
}

/** 射撃の役割を持つボタンすべて（銃の家系は左だけ） */
export function shotButtons(moveset: MovesetDef): ButtonKey[] {
  return isGun(moveset) ? ["primary"] : [];
}

/** 溜めの役割を持つボタン（大剣・戦鎚は左、刀の居合・短銃の狙い撃ちは右）。溜めを持たない武器種は undefined */
export function chargeButton(moveset: MovesetDef): ButtonKey | undefined {
  if (moveset.primary === "charge") return "primary";
  return moveset.art.kind === "charge" ? "secondary" : undefined;
}

/** 近接の溜めの定義（左の溜め、または右の居合）。短銃の狙い撃ちは近接の溜めではないので含めない */
export function meleeChargeOf(moveset: MovesetDef): MeleeChargeDef | undefined {
  if (moveset.primary === "charge") return moveset.charge;
  return moveset.art.kind === "charge" ? moveset.art.charge : undefined;
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

/** need が空なら常に一致（1 手だけの派生はいつでも「次に押すと」に出る） */
function tailMatches(inputs: readonly ButtonKey[], need: readonly ButtonKey[]): boolean {
  if (need.length > inputs.length) return false;
  const offset = inputs.length - need.length;
  return need.every((k, i) => inputs[offset + i] === k);
}

const S = WEAPON.shots;

export const SHOT_TYPES: Readonly<Record<ShotKey, ShotDef>> = {
  single: { key: "single", name: "単発", desc: "まっすぐ飛ぶ 1 発", ...S.single, keywords: kw(["ranged", "bullet"]), attack: attack("ranged", "physical") },
  rapid: { key: "rapid", name: "連射", desc: "間隔が短く軽い弾。弾筋が揺れる", ...S.rapid, keywords: kw(["ranged", "bullet", "combo"], [], ["crit"]), attack: attack("ranged", "physical") },
  spread: {
    key: "spread",
    name: "散弾",
    desc: "近距離に弾をばら撒き、反動で後ろへ跳ねる",
    ...S.spread,
    keywords: kw(["ranged", "bullet", "stagger"], [], ["melee", "dash"]), attack: attack("ranged", "physical"),
  },
  pierce: { key: "pierce", name: "貫通", desc: "重い弾が敵を 2 体抜ける", ...S.pierce, keywords: kw(["ranged", "bullet", "stagger"], [], ["area"]), attack: attack("ranged", "physical") },
  homing: { key: "homing", name: "追尾", desc: "遅い弾が近くの敵へ曲がる", ...S.homing, keywords: kw(["ranged", "bullet"], [], ["dash"]), attack: attack("ranged", "physical", "poison") },
  ricochet: { key: "ricochet", name: "跳弾", desc: "壁で 2 回跳ね、跳ねるたびに強くなる", ...S.ricochet, keywords: kw(["ranged", "bullet", "wall"]), attack: attack("ranged", "physical") },
  charge: { key: "charge", name: "チャージ", desc: "押して溜め、離して撃つ。溜めるほど大きく貫く", ...S.charge, keywords: kw(["ranged", "bullet", "stagger"], ["still"]), attack: attack("ranged", "physical", "fire") },
  mine: { key: "mine", name: "設置弾", desc: "床で止まり、近づいた敵を巻き込んで炸裂する", ...S.mine, keywords: kw(["ranged", "placed", "explode", "area"]), attack: attack("ranged", "physical", "fire") },
  burst: { key: "burst", name: "三点", desc: "1 回押すと 3 発を続けて撃つ。次の 3 発までは間が空く", ...S.burst, keywords: kw(["ranged", "bullet", "combo"], [], ["crit"]), attack: attack("ranged", "physical") },
  boomerang: {
    key: "boomerang",
    name: "回転刃",
    desc: "刃が射程の半ばで折り返して手元へ戻り、行きと帰りで同じ敵を 2 度斬る",
    ...S.boomerang,
    keywords: kw(["ranged", "bullet", "area"], [], ["still"]),
    attack: attack("ranged", "physical"),
  },
  lob: {
    key: "lob",
    name: "曲射",
    desc: "照準の地点へ山なりに撃ち込んで炸裂する。飛んでいる間は何にも当たらない",
    ...S.lob,
    keywords: kw(["ranged", "explode", "area"], ["still"]),
    attack: attack("ranged", "physical"),
  },
};

/** 必殺（バースト）の素性。威力は精神 + 霊力（PLAYER.special）なので範囲・魔法（docs/COMBAT_DESIGN.md A-8） */
export const BURST_ATTACK: AttackProfile = attack("area", "arcane");

export const DEFAULT_MOVESET: MovesetKey = "sword";
export const DEFAULT_SHOT: ShotKey = "single";

export function movesetDef(key: MovesetKey): MovesetDef {
  return MOVESETS[key];
}

export function shotDef(key: ShotKey): ShotDef {
  return SHOT_TYPES[key];
}

/** 溜めた秒数から段（0 = 段なし）を求める */
export function chargeLevelAt(levels: readonly { readonly time: number }[], held: number): number {
  let level = 0;
  for (const l of levels) {
    if (held >= l.time) level += 1;
  }
  return level;
}
