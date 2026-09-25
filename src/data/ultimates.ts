import { type AttackProfile, attack } from "../core/element";
import { type Rule, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { EventKind } from "../core/events";
import { STATUS_KINDS, type StatusApply, type StatusKind } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { bulletDef } from "../loot/bullets";
import { ATTR_KEYS, type AttrKey, type AttrRatio, type Scaling } from "../loot/types";
import { ULTIMATE } from "./tuning";
import {
  type BulletDef,
  type HitShape,
  type MeleeStepDef,
  type MovesetKey,
  type OrbitDef,
  type RecallHomingDef,
  type ThrowArtDef,
  BURST_ATTACK,
  MOVESETS,
  MOVESET_KEYS,
} from "./weapons";

/**
 * 奥義（F で奥義ゲージを使って出す技）の型と定義。docs/ideas/ougi-and-dual-actions.md 3 章。
 * 武器種ごとに 3 本（拠点の武器掛けで 1 本選ぶ。0 番目が既定）。数値は src/data/balance/ultimates/ の
 * ULTIMATE.defs.<武器種>.<名前>、形・状態異常・弾の種類など union 文字列はここ。動きは system/ultimates.ts
 */

export const ULTIMATE_KINDS = ["instant", "sustain"] as const;
export type UltimateKind = (typeof ULTIMATE_KINDS)[number];

/** 周囲攻撃。radius に burstRadiusMul、威力に burstDamageMul が掛かる */
export interface NovaAct {
  readonly kind: "nova";
  readonly radius: number;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
  readonly knockback: number;
  readonly applies?: readonly StatusApply[];
  /** 多段（省略は 1） */
  readonly hits?: number;
  /** 範囲内の敵弾を消す */
  readonly clearsBullets?: boolean;
  /** 重い一撃（壁叩きつけ・重いヒットストップ） */
  readonly heavy?: boolean;
  /** 生命がこの割合以下の敵（ボスを除く）を即死させる */
  readonly execute?: number;
  /** 中心を照準方向へ distance だけ離す（着弾の爆発）。近くに敵がいればその位置へ寄せる。省略は自分の周り */
  readonly distance?: number;
  /** 着弾の数（distance があるときだけ。spreadDeg 間隔の扇に並べる） */
  readonly count?: number;
  readonly spreadDeg?: number;
  /** 着弾点に残す地形と秒 */
  readonly terrain?: TerrainKind;
  readonly terrainDuration?: number;
}

/** 突進（照準方向へ distance 進みながら、通り道を step の幅で斬る） */
export interface LungeAct {
  readonly kind: "lunge";
  readonly distance: number;
  readonly step: MeleeStepDef;
  readonly invuln: number;
}

/** 引き寄せ。single なら最も近い 1 体だけ */
export interface PullAct {
  readonly kind: "pull";
  readonly radius: number;
  readonly toDistance: number;
  readonly applies?: readonly StatusApply[];
  readonly single?: boolean;
}

/** 自分への効果（強化・無敵・回復・気力・反動） */
export interface BuffAct {
  readonly kind: "buff";
  readonly damageMul?: number;
  readonly speedMul?: number;
  readonly duration: number;
  readonly invuln?: number;
  /** 最大生命に対する割合 */
  readonly heal?: number;
  readonly mana?: number;
  /** 照準と逆向きに自分を押す強さ（px/秒） */
  readonly selfKnock?: number;
}

/**
 * instant の 1 行為。列に並べて順に出す（照準方向・自分の位置は発動時に固定）。swing / lunge は列の最後にだけ置く
 * （振りの列を待つ仕組みを持たないため。data/ultimates.test.ts で固定）
 */
export type UltimateAct =
  | NovaAct
  /** 1 振り（形・多段・重さ・引き寄せ・付与は step のもの）。発動の瞬間に出し切る */
  | { readonly kind: "swing"; readonly step: MeleeStepDef }
  /** 弾を出す（射撃扱い）。弾の挙動（設置・曲射・回転刃・追尾）は bullet の key の弾のもの */
  | { readonly kind: "volley"; readonly throw: ThrowArtDef }
  | LungeAct
  | PullAct
  | BuffAct
  /** 床の自分の設置弾を全部起爆（damageMul は起爆する弾の威力の倍率。省略は等倍） */
  | { readonly kind: "detonate"; readonly damageMul?: number };

/** 持続中の近接の段の差し替え（system/ultimates.ts の ultimateMoveset が型に畳む） */
export interface SustainPatch {
  readonly reachMul?: number;
  readonly sizeMul?: number;
  readonly hitsAdd?: number;
  readonly heavy?: boolean;
  readonly pull?: boolean;
  readonly trail?: string;
  /** 突きの先端判定を全長に広げる（槍・鞭の先端の倍率が常に乗る） */
  readonly tipAll?: boolean;
  /** 溜めの段に届く秒の倍率 */
  readonly chargeTimeMul?: number;
  /** 攻撃中・溜め中の移動速度の倍率 */
  readonly attackMoveMul?: number;
}

/** 持続中の射撃の弾の差し替え（key はそのままなので弾の挙動は変わらない） */
export interface SustainShot {
  readonly pelletsAdd?: number;
  readonly pierceAdd?: number;
  readonly speedMul?: number;
  readonly damageMul?: number;
  readonly recoilMul?: number;
  /** 設置弾の信管の秒の倍率 */
  readonly fuseMul?: number;
  readonly bounceAdd?: number;
  /** 撃った弾が自分の周りを回り続ける（円環の理） */
  readonly orbit?: OrbitDef;
}

/** 命中の衝撃波（鉄槌の律）。半径に burstRadiusMul、威力に burstDamageMul が掛かる */
export interface HitQuakeDef {
  readonly radius: number;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
  readonly knockback: number;
  /** ヒットストップ（ステップ） */
  readonly hitstop: number;
  readonly shake: number;
  readonly icd: number;
}

/** 持続（sustain）の奥義: ゲージが減る間の倍率・段の差し替え・弾の差し替え・命中付与・Rule の束 */
export interface SustainDef {
  /** 毎秒減るゲージ。0 になったら終わる。もう一度 F で早く終える（残りは保つ） */
  readonly drainPerSec: number;
  readonly minSec: number;
  /** 通常攻撃に掛ける倍率（burstDamageMul は掛けない） */
  readonly mul: {
    readonly damage?: number;
    readonly attackSpeed?: number;
    readonly fireRate?: number;
    readonly moveSpeed?: number;
    readonly poise?: number;
    readonly incoming?: number;
  };
  /** 会心率の上乗せ（0..1） */
  readonly critAdd?: number;
  /** 予備動作中の敵への与ダメ倍率 */
  readonly vsWindup?: number;
  /** その状態異常を持つ敵への与ダメ倍率 */
  readonly vsStatus?: { readonly status: StatusKind; readonly mul: number };
  /** 正面 arcDeg 以内からの被弾の倍率 */
  readonly guard?: { readonly arcDeg: number; readonly mul: number };
  /** 立ち止まっているときの射撃の速さの倍率 */
  readonly stillFireRate?: number;
  readonly patch?: SustainPatch;
  readonly shot?: SustainShot;
  /** 近接の命中で付ける状態異常（段に畳む） */
  readonly applies?: readonly StatusApply[];
  /** 自分の周りに毎 interval 秒ダメージ（radius は burstRadiusMul が掛かる） */
  readonly aura?: { readonly radius: number; readonly interval: number; readonly scaling: Scaling; readonly poise: number };
  /** interval 秒ごとに飛んでいる自分の弾を手元へ戻す */
  readonly recall?: { readonly interval: number; readonly returnDamageMul: number; readonly speedMul: number; readonly homing?: RecallHomingDef };
  /** 床の自分の設置弾が近くの敵を引き寄せる */
  readonly minePull?: { readonly radius: number; readonly speed: number };
  /** 左の振りを始めるたびに体の前から照準方向へ撃つ弾（射撃扱い。威力は係数表そのまま、burstDamageMul は掛けない） */
  readonly swingVolley?: ThrowArtDef;
  /** 近接の振りが当たるたびに当てた敵の位置で起こす衝撃波（icd 秒に 1 回） */
  readonly hitQuake?: HitQuakeDef;
  /** 近い敵ほど与ダメが上がる（零距離）。敵の縁までの距離 0 で mul、range 以上で 1 */
  readonly pointBlank?: { readonly range: number; readonly mul: number };
  /** 持続中だけ効く Rule（system/rules.ts の collectRules が Player.ultimate.active のとき集める） */
  readonly rules?: readonly Rule[];
  /** 終わりに出す行為 */
  readonly onEnd?: readonly UltimateAct[];
}

interface UltimateBase {
  /** `<武器種>.<名前>`（武器種をまたいで一意。Profile.ultimates の値） */
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly moveset: MovesetKey;
  /** 素性（ジャンル・属性）。行為の威力はこれで受けさせる */
  readonly attack: AttackProfile;
  /** 出すのに要る奥義ゲージ（ULTIMATE.defs の cost、省略は ULTIMATE.common.cost。PLAYER.maxEnergy 以下） */
  readonly cost: number;
}

export type UltimateDef =
  | (UltimateBase & {
      readonly kind: "instant";
      readonly acts: readonly UltimateAct[];
      readonly invuln: number;
      /** 倒した数 × 最大生命のこの割合を回復 */
      readonly healPerKill?: number;
    })
  | (UltimateBase & { readonly kind: "sustain"; readonly sustain: SustainDef });

/** 武器種ごとの奥義（0 番目が既定）。どの武器種も 3 本（data/ultimates.test.ts） */
export type UltimateSet = readonly [UltimateDef, ...UltimateDef[]];

// ---------------------------------------------------------------------------
// JSON（ULTIMATE.defs）の読み取り。数値の欠けは読み込み時に throw（balance の打ち間違いを早く落とす）
// ---------------------------------------------------------------------------

type Raw = Readonly<Record<string, unknown>>;

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sub(r: Raw, k: string): Raw {
  const v = r[k];
  if (!isRaw(v)) throw new Error(`ultimates.json: ${k} が無い`);
  return v;
}

function optSub(r: Raw, k: string): Raw | undefined {
  const v = r[k];
  return isRaw(v) ? v : undefined;
}

function num(r: Raw, k: string): number {
  const v = r[k];
  if (typeof v !== "number") throw new Error(`ultimates.json: 数値 ${k} が無い`);
  return v;
}

function optNum(r: Raw, k: string): number | undefined {
  const v = r[k];
  return typeof v === "number" ? v : undefined;
}

function isAttrKey(k: string): k is AttrKey {
  return (ATTR_KEYS as readonly string[]).includes(k);
}

function attrTable(r: Raw): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "base") continue;
    if (!isAttrKey(k) || typeof v !== "number") throw new Error(`ultimates.json: 不正な係数 ${k}`);
    out[k] = v;
  }
  return out;
}

function scalingOf(r: Raw): Scaling {
  const s = sub(r, "scaling");
  return { base: num(s, "base"), ...attrTable(s) };
}

function ratioOf(r: Raw): AttrRatio | undefined {
  const s = optSub(r, "poiseRatio");
  return s === undefined ? undefined : attrTable(s);
}

function applyOf(kind: StatusKind, r: Raw): StatusApply {
  if (!(STATUS_KINDS as readonly string[]).includes(kind)) throw new Error(`未知の状態異常: ${kind}`);
  return { kind, stacks: num(r, "stacks"), duration: num(r, "duration"), potency: num(r, "potency") };
}

/** 奥義ごとの数値ブロック（ULTIMATE.defs.<武器種>.<名前>） */
function block(moveset: MovesetKey, id: string): Raw {
  const defs: unknown = ULTIMATE.defs;
  if (!isRaw(defs)) throw new Error("ultimates.json: defs が無い");
  return sub(sub(defs, moveset), id);
}

// ---------------------------------------------------------------------------
// 行為の組み立て
// ---------------------------------------------------------------------------

/** 一瞬で出し切る振りは振りの時間・気力の回収を持たない（MeleeStepDef の形に合わせるための 0） */
const INSTANT_TIMING = 0;
const NO_MANA = 0;
/** 振りの残像の色（奥義の振りは金） */
const STRIKE_TRAIL = "#ffe9a0";

interface NovaExtra {
  readonly applies?: readonly StatusApply[];
  readonly clearsBullets?: boolean;
  readonly terrain?: TerrainKind;
}

function nova(r: Raw, extra: NovaExtra = {}): NovaAct {
  return {
    kind: "nova",
    radius: num(r, "radius"),
    scaling: scalingOf(r),
    poise: num(r, "poise"),
    poiseRatio: ratioOf(r),
    knockback: num(r, "knockback"),
    hits: optNum(r, "hits"),
    heavy: r.heavy === true,
    execute: optNum(r, "execute"),
    distance: optNum(r, "distance"),
    count: optNum(r, "count"),
    spreadDeg: optNum(r, "spreadDeg"),
    terrainDuration: optNum(r, "terrainDuration"),
    ...extra,
  };
}

interface StrikeExtra {
  readonly applies?: readonly StatusApply[];
  readonly pull?: boolean;
}

/** 一瞬の振りの段（形は TS、数値は JSON） */
function strikeStep(r: Raw, shape: HitShape, extra: StrikeExtra = {}): MeleeStepDef {
  return {
    windup: INSTANT_TIMING,
    active: INSTANT_TIMING,
    recover: INSTANT_TIMING,
    mana: NO_MANA,
    scaling: scalingOf(r),
    poise: num(r, "poise"),
    poiseRatio: ratioOf(r),
    reach: optNum(r, "reach") ?? 0,
    size: optNum(r, "size") ?? num(r, "width"),
    knockback: num(r, "knockback"),
    heavy: r.heavy === true,
    shape,
    hits: optNum(r, "hits"),
    trail: STRIKE_TRAIL,
    ...extra,
  };
}

type ShapeKind = HitShape["kind"];

function shapeOf(kind: ShapeKind, r: Raw): HitShape {
  return kind === "arc" ? { kind, deg: num(r, "deg") } : { kind };
}

function swing(r: Raw, kind: ShapeKind, extra: StrikeExtra = {}): UltimateAct {
  return { kind: "swing", step: strikeStep(r, shapeOf(kind, r), extra) };
}

function lunge(r: Raw, extra: StrikeExtra = {}): LungeAct {
  return { kind: "lunge", distance: num(r, "distance"), invuln: num(r, "invuln"), step: strikeStep(r, { kind: "thrust" }, extra) };
}

/** 弾の種類（銃のベースの弾の key）。挙動（設置・曲射・回転刃・追尾）は弾のものを借り、数だけ差し替える */
const PLAIN_BULLET = "pistol";
/** 少し追尾する弾（導きの珠）。詠唱の魔弾が近接の間合いの外の敵へ届くように借りる */
const SEEKER_BULLET = "seekerOrb";

function volley(r: Raw, profile: AttackProfile, bullet: string = PLAIN_BULLET, sprite?: string): UltimateAct {
  return { kind: "volley", throw: throwOf(r, profile, bullet, sprite) };
}

/** 弾を出す段の中身（奥義の volley と、持続の swingVolley が共有する） */
function throwOf(r: Raw, profile: AttackProfile, bullet: string, sprite?: string): ThrowArtDef {
  const base: BulletDef = bulletDef(bullet);
  const shot: BulletDef = {
    ...base,
    speedMul: num(r, "speedMul"),
    lifeMul: num(r, "lifeMul"),
    radius: num(r, "bulletRadius"),
    pierceBonus: num(r, "pierceBonus"),
  };
  const count = num(r, "count");
  return { bullet: shot, scaling: scalingOf(r), poise: num(r, "poise"), poiseRatio: ratioOf(r), count, spreadDeg: num(r, "spreadDeg"), attack: profile, sprite };
}

function pull(r: Raw, extra: { readonly applies?: readonly StatusApply[]; readonly single?: boolean } = {}): PullAct {
  return { kind: "pull", radius: num(r, "radius"), toDistance: num(r, "toDistance"), ...extra };
}

function buff(r: Raw): BuffAct {
  return {
    kind: "buff",
    duration: num(r, "duration"),
    damageMul: optNum(r, "damageMul"),
    speedMul: optNum(r, "speedMul"),
    invuln: optNum(r, "invuln"),
    heal: optNum(r, "heal"),
    mana: optNum(r, "mana"),
    selfKnock: optNum(r, "selfKnock"),
  };
}

function detonate(r: Raw): UltimateAct {
  return { kind: "detonate", damageMul: optNum(r, "damageMul") };
}

/** 反動（撃った向きと逆へ下がる）。volley の数値ブロックの selfKnock を buff に移す */
function recoil(r: Raw): BuffAct {
  return { kind: "buff", duration: 0, selfKnock: num(r, "selfKnock") };
}

// ---------------------------------------------------------------------------
// 持続の組み立て
// ---------------------------------------------------------------------------

const ALWAYS = 1;

/** 持続中だけ効く Rule（id は奥義の key + 添字で決まる。条件に ultimateActive を必ず持つ） */
function sustainRule(key: string, index: number, when: EventKind, then: RuleEffect, icd: number): Rule {
  const owner = { kind: "player" as const, key: `ultimate.${key}` };
  return { id: ruleId(owner, index), when, if: [{ kind: "ultimateActive" }], then, chance: ALWAYS, icd, scope: SCOPE_ANY, owner };
}

function mulOf(r: Raw): SustainDef["mul"] {
  const m = optSub(r, "mul");
  if (m === undefined) return {};
  return {
    damage: optNum(m, "damage"),
    attackSpeed: optNum(m, "attackSpeed"),
    fireRate: optNum(m, "fireRate"),
    moveSpeed: optNum(m, "moveSpeed"),
    poise: optNum(m, "poise"),
    incoming: optNum(m, "incoming"),
  };
}

function patchOf(r: Raw, extra: Pick<SustainPatch, "tipAll" | "heavy" | "pull" | "trail"> = {}): SustainPatch {
  const p = optSub(r, "patch") ?? {};
  return {
    reachMul: optNum(p, "reachMul"),
    sizeMul: optNum(p, "sizeMul"),
    hitsAdd: optNum(p, "hitsAdd"),
    chargeTimeMul: optNum(p, "chargeTimeMul"),
    attackMoveMul: optNum(p, "attackMoveMul"),
    ...extra,
  };
}

function shotOf(r: Raw): SustainShot {
  const s = sub(r, "shot");
  return {
    pelletsAdd: optNum(s, "pelletsAdd"),
    pierceAdd: optNum(s, "pierceAdd"),
    speedMul: optNum(s, "speedMul"),
    damageMul: optNum(s, "damageMul"),
    recoilMul: optNum(s, "recoilMul"),
    fuseMul: optNum(s, "fuseMul"),
    bounceAdd: optNum(s, "bounceAdd"),
    orbit: orbitOf(s),
  };
}

function orbitOf(r: Raw): OrbitDef | undefined {
  const o = optSub(r, "orbit");
  return o === undefined ? undefined : { radius: num(o, "radius"), turnRate: num(o, "turnRate"), laps: num(o, "laps") };
}

function recallOf(r: Raw): SustainDef["recall"] {
  const s = sub(r, "recall");
  const h = optSub(s, "homing");
  const homing = h === undefined ? {} : { homing: { turnRate: num(h, "turnRate"), range: num(h, "range") } };
  return { interval: num(s, "interval"), returnDamageMul: num(s, "returnDamageMul"), speedMul: num(s, "speedMul"), ...homing };
}

function quakeOf(r: Raw): HitQuakeDef {
  return {
    radius: num(r, "radius"),
    scaling: scalingOf(r),
    poise: num(r, "poise"),
    poiseRatio: ratioOf(r),
    knockback: num(r, "knockback"),
    hitstop: num(r, "hitstop"),
    shake: num(r, "shake"),
    icd: num(r, "icd"),
  };
}

function pointBlankOf(r: Raw): SustainDef["pointBlank"] {
  const s = sub(r, "pointBlank");
  return { range: num(s, "range"), mul: num(s, "mul") };
}

function auraOf(r: Raw): SustainDef["aura"] {
  const s = sub(r, "aura");
  return { radius: num(s, "radius"), interval: num(s, "interval"), scaling: scalingOf(s), poise: num(s, "poise") };
}

/** 持続の共通部（drain・最短秒・倍率・会心・予備動作の敵への倍率） */
function sustainCore(r: Raw): SustainDef {
  return {
    drainPerSec: num(r, "drainPerSec"),
    minSec: num(r, "minSec"),
    mul: mulOf(r),
    critAdd: optNum(r, "critAdd"),
    vsWindup: optNum(r, "vsWindup"),
    stillFireRate: optNum(r, "stillFireRate"),
  };
}

// ---------------------------------------------------------------------------
// 定義
// ---------------------------------------------------------------------------

function instantDef(
  moveset: MovesetKey,
  id: string,
  name: string,
  desc: string,
  profile: AttackProfile,
  acts: (n: Raw) => readonly UltimateAct[],
): UltimateDef {
  const n = block(moveset, id);
  return {
    key: `${moveset}.${id}`,
    name,
    desc,
    moveset,
    attack: profile,
    cost: costOf(n),
    kind: "instant",
    acts: acts(n),
    invuln: optNum(n, "invuln") ?? ULTIMATE.common.invuln,
    healPerKill: optNum(n, "healPerKill"),
  };
}

function sustainDef(moveset: MovesetKey, id: string, name: string, desc: string, build: (n: Raw, key: string) => SustainDef): UltimateDef {
  const n = block(moveset, id);
  const key = `${moveset}.${id}`;
  return { key, name, desc, moveset, attack: MOVESETS[moveset].attack, cost: costOf(n), kind: "sustain", sustain: build(n, key) };
}

/** 奥義ごとの必要ゲージ（省略は共通の ULTIMATE.common.cost） */
function costOf(n: Raw): number {
  return optNum(n, "cost") ?? ULTIMATE.common.cost;
}

const AREA = attack("area", "physical");
const RANGED = attack("ranged", "physical");
const FIRE_RANGED = attack("ranged", "physical", "fire");
const DARK_AREA = attack("area", "hybrid", "dark");
const ARCANE_LIGHT = attack("ranged", "arcane", "light");
const ARCANE_AREA = attack("area", "arcane", "light");
const THUNDER_AREA = attack("area", "physical", "lightning");
const THRUST: ShapeKind = "thrust";
const CIRCLE: ShapeKind = "circle";
const ARC: ShapeKind = "arc";
const BOX: ShapeKind = "box";

function melee(moveset: MovesetKey): AttackProfile {
  return MOVESETS[moveset].attack;
}

function swordSet(): UltimateSet {
  const m = "sword";
  return [
    instantDef(m, "fullMoon", "円月", "周囲をまとめて打ち払い、近くの敵弾を消す", BURST_ATTACK, (n) => [nova(sub(n, "nova"), { clearsBullets: true })]),
    instantDef(m, "flashCut", "瞬閃", "照準の方向へ一瞬で駆け抜け、通り道の敵をまとめて斬る。駆ける間は無敵", melee(m), (n) => [lunge(sub(n, "lunge"))]),
    sustainDef(m, "swordAura", "剣気解放", "持続。振りが長く大きくなり、振るたびに剣気の波が飛ぶ", (n, key) => ({
      ...sustainCore(n),
      patch: patchOf(n, { trail: "#a0f0ff" }),
      rules: [sustainRule(key, 0, "onSwing", { kind: "wave", magnitude: num(sub(n, "wave"), "magnitude"), scaleBy: "eventAmount" }, num(sub(n, "wave"), "icd"))],
    })),
  ];
}

function greatswordSet(): UltimateSet {
  const m = "greatsword";
  return [
    instantDef(m, "judgment", "断罪", "前方の広い扇を溜め切った一振りで薙ぐ。怯み値が大きい", melee(m), (n) => [swing(sub(n, "swing"), ARC)]),
    sustainDef(m, "titanMight", "巨人の膂力", "持続。溜めが速く、攻撃中も大きく動け、怯み値が増える", (n) => ({ ...sustainCore(n), patch: patchOf(n) })),
    instantDef(m, "earthSplit", "地割り", "前方へ地を這う衝撃波を 3 本放つ。すべて貫く", AREA, (n) => [volley(sub(n, "volley"), AREA)]),
  ];
}

function twinBladesSet(): UltimateSet {
  const m = "twinBlades";
  return [
    instantDef(m, "thousandBlades", "千刃", "周囲へ刃の嵐。近くの敵に何度も当たる", melee(m), (n) => [nova(sub(n, "nova"))]),
    instantDef(m, "hazeWalk", "朧渡り", "照準の方向へすり抜けながら 2 度斬り、出血させる。駆ける間は無敵", melee(m), (n) => [
      lunge(sub(n, "lunge"), { applies: [applyOf("bleed", sub(n, "bleed"))] }),
    ]),
    sustainDef(m, "afterimage", "残影", "持続。振りが 1 回ずつ多く当たり、速く動け、会心しやすい", (n) => ({ ...sustainCore(n), patch: patchOf(n) })),
  ];
}

function spearSet(): UltimateSet {
  const m = "spear";
  return [
    instantDef(m, "dragonPierce", "龍穿", "前方へ長い突きを放ち、並んだ敵をまとめて貫く", melee(m), (n) => [swing(sub(n, "swing"), THRUST)]),
    instantDef(m, "meteorThrust", "流星突き", "照準の方向へ突進し、通り道の敵を 3 度突く", melee(m), (n) => [lunge(sub(n, "lunge"))]),
    sustainDef(m, "formation", "陣の構え", "持続。突きが長くなり、どこに当てても穂先の威力。予備動作中の敵へ強い", (n) => ({
      ...sustainCore(n),
      patch: patchOf(n, { tipAll: true }),
    })),
  ];
}

function scytheSet(): UltimateSet {
  const m = "scythe";
  return [
    instantDef(m, "soulReap", "魂刈り", "周囲の敵を引き寄せて一周薙ぐ。倒した数だけ生命を取り戻す", DARK_AREA, (n) => [pull(sub(n, "pull")), swing(sub(n, "swing"), CIRCLE)]),
    instantDef(m, "netherVortex", "冥府の渦", "周囲の敵を引き込みながら 3 度薙ぐ", DARK_AREA, (n) => [swing(sub(n, "swing"), CIRCLE, { pull: true })]),
    sustainDef(m, "reaperReach", "死神の間合い", "持続。振りが広くなり敵を引き寄せ、倒すたびに気力が戻る", (n, key) => ({
      ...sustainCore(n),
      patch: patchOf(n, { pull: true }),
      rules: [sustainRule(key, 0, "onKill", { kind: "restoreMana", magnitude: num(sub(n, "killMana"), "magnitude"), quiet: true }, num(sub(n, "killMana"), "icd"))],
    })),
  ];
}

function fistsSet(): UltimateSet {
  const m = "fists";
  return [
    instantDef(m, "hakkei", "発勁", "足元から気を放ち、周囲の敵を大きく怯ませて崩す", AREA, (n) => [nova(sub(n, "nova"), { applies: [applyOf("broken", sub(n, "broken"))] })]),
    instantDef(m, "collapseFist", "崩拳", "踏み込んで重い一撃。壁へ叩きつける", melee(m), (n) => [lunge(sub(n, "lunge"))]),
    sustainDef(m, "fightingSpirit", "闘気開放", "持続。すべての振りが重い一撃になって 1 回多く当たり、受けるダメージが減る", (n) => ({
      ...sustainCore(n),
      patch: patchOf(n, { heavy: true }),
    })),
  ];
}

function whipSet(): UltimateSet {
  const m = "whip";
  return [
    instantDef(m, "serpentBind", "蛇縛り", "周囲の敵を絡め取って引き寄せ、恐怖させて打つ", THUNDER_AREA, (n) => [
      pull(sub(n, "pull"), { applies: [applyOf("fear", sub(n, "fear"))] }),
      nova(sub(n, "nova")),
    ]),
    instantDef(m, "hundredCracks", "百鳴り", "全周へ鞭を鳴らし、周りの敵に何度も当てる", THUNDER_AREA, (n) => [nova(sub(n, "nova"))]),
    sustainDef(m, "thunderWhip", "雷鞭", "持続。どこに当てても先端の威力になり、当てた敵を感電させる。周りに雷がほとばしる", (n) => ({
      ...sustainCore(n),
      patch: patchOf(n, { tipAll: true, trail: "#fff080" }),
      applies: [applyOf("shock", sub(n, "shock"))],
      aura: auraOf(n),
    })),
  ];
}

function cleaverSet(): UltimateSet {
  const m = "cleaver";
  return [
    instantDef(m, "fleshRend", "血肉断ち", "前方を重い一振りで断ち、深く出血させる", melee(m), (n) => [
      swing(sub(n, "swing"), ARC, { applies: [applyOf("bleed", sub(n, "bleed"))] }),
    ]),
    instantDef(m, "beheading", "首落とし", "周囲を薙ぎ、生命の少ない敵（ボスを除く）をその場で倒す", melee(m), (n) => [nova(sub(n, "nova"))]),
    sustainDef(m, "asura", "修羅", "持続。振りも足も速くなるが、受けるダメージが増え、終わると少しの間弱る", (n) => ({
      ...sustainCore(n),
      onEnd: [buff(sub(n, "onEnd"))],
    })),
  ];
}

function staffSet(): UltimateSet {
  const m = "staff";
  return [
    instantDef(m, "tornado", "竜巻", "棍を振り回して周囲に何度も当て、気力を取り戻す", AREA, (n) => [nova(sub(n, "nova")), buff(sub(n, "buff"))]),
    instantDef(m, "thousandThrusts", "千本突き", "前方へ目にも止まらぬ突きを浴びせる", melee(m), (n) => [swing(sub(n, "swing"), THRUST)]),
    sustainDef(m, "flowBreath", "柔の呼吸", "持続。近接の命中で気力が戻り、スキルの再使用が早く進む", (n, key) => ({
      ...sustainCore(n),
      rules: [
        sustainRule(key, 0, "onMeleeHit", { kind: "restoreMana", magnitude: num(sub(n, "hitMana"), "magnitude"), quiet: true }, num(sub(n, "hitMana"), "icd")),
        sustainRule(key, 1, "onMeleeHit", { kind: "skillHaste", magnitude: num(sub(n, "hitHaste"), "magnitude") }, num(sub(n, "hitHaste"), "icd")),
      ],
    })),
  ];
}

function wandSet(): UltimateSet {
  const m = "wand";
  return [
    instantDef(m, "arcaneCannon", "魔導砲", "照準の方向へ巨大な光弾を放つ。すべて貫く", ARCANE_LIGHT, (n) => [volley(sub(n, "volley"), ARCANE_LIGHT)]),
    instantDef(m, "magicCircle", "魔法陣", "足元の陣で周囲を打ち、敵弾を消し、気力を満たす", ARCANE_AREA, (n) => [
      nova(sub(n, "nova"), { clearsBullets: true }),
      buff(sub(n, "buff")),
    ]),
    sustainDef(m, "incantation", "詠唱", "持続。振るたびに体の前から敵を追う魔弾が 3 発飛び、威力が上がるが足は遅くなる", (n) => ({
      ...sustainCore(n),
      swingVolley: throwOf(sub(n, "swingVolley"), ARCANE_LIGHT, SEEKER_BULLET),
    })),
  ];
}

function katanaSet(): UltimateSet {
  const m = "katana";
  return [
    instantDef(m, "ittou", "一刀両断", "照準の方向へ踏み込み、通り道を重い一太刀で断つ。踏み込む間は無敵", melee(m), (n) => [lunge(sub(n, "lunge"))]),
    instantDef(m, "swallowDance", "燕舞", "身を翻して周囲を 3 度斬る", melee(m), (n) => [swing(sub(n, "swing"), CIRCLE)]),
    sustainDef(m, "mushin", "無想", "持続。居合の溜めが速くなり、予備動作中の敵へ大きく強い", (n) => ({ ...sustainCore(n), patch: patchOf(n) })),
  ];
}

function axeSet(): UltimateSet {
  const m = "axe";
  return [
    instantDef(m, "bloodFeast", "血祭り", "周囲を叩き割り、深く出血させる", AREA, (n) => [nova(sub(n, "nova"), { applies: [applyOf("bleed", sub(n, "bleed"))] })]),
    instantDef(m, "greatThrow", "大投擲", "斧を 3 本扇に投げる。行って戻り、行きと帰りで斬る", RANGED, (n) => [volley(sub(n, "volley"), RANGED, "returnChakram", "weapon.axe")]),
    sustainDef(m, "madAxe", "狂斧", "持続。振りが出血させ、出血した敵への威力が上がる", (n) => ({
      ...sustainCore(n),
      applies: [applyOf("bleed", sub(n, "bleed"))],
      vsStatus: { status: "bleed", mul: num(n, "vsStatus") },
    })),
  ];
}

function shieldSet(): UltimateSet {
  const m = "shield";
  return [
    instantDef(m, "siegeBreaker", "城門崩し", "盾ごと前方へぶつかり、大きく突き飛ばす", melee(m), (n) => [swing(sub(n, "swing"), ARC)]),
    instantDef(m, "beacon", "反撃の狼煙", "周囲を押し返し、生命を取り戻し、少しの間無敵になる", AREA, (n) => [nova(sub(n, "nova")), buff(sub(n, "buff"))]),
    sustainDef(m, "ironWall", "鉄壁", "持続。構えずとも正面からの攻撃を大きく減らし、怯み値が増える", (n) => ({
      ...sustainCore(n),
      guard: { arcDeg: num(n, "guardArcDeg"), mul: num(n, "guardMul") },
    })),
  ];
}

function chainSickleSet(): UltimateSet {
  const m = "chainSickle";
  return [
    instantDef(m, "spiderWeb", "蜘蛛の巣", "周囲へ鎖を張って敵を引き寄せ、崩して打つ", AREA, (n) => [
      pull(sub(n, "pull"), { applies: [applyOf("broken", sub(n, "broken"))] }),
      nova(sub(n, "nova")),
    ]),
    instantDef(m, "hangman", "縛り首", "最も近い敵を鎖で引き寄せ、重い一撃を入れる", melee(m), (n) => [pull(sub(n, "pull"), { single: true }), swing(sub(n, "swing"), BOX)]),
    sustainDef(m, "weightSpin", "分銅回し", "持続。振りが広がって 1 回多く当たり、崩れた敵への威力が上がる", (n) => ({
      ...sustainCore(n),
      patch: patchOf(n),
      vsStatus: { status: "broken", mul: num(n, "vsStatus") },
    })),
  ];
}

function hammerSet(): UltimateSet {
  const m = "hammer";
  return [
    instantDef(m, "skyfall", "天墜", "跳び上がって地へ叩きつけ、周囲を大きく怯ませて壁へ叩きつける", AREA, (n) => [nova(sub(n, "nova"))]),
    instantDef(m, "groundSmash", "砕地", "前方へ地を砕く衝撃波を 3 本放つ。すべて貫く", AREA, (n) => [volley(sub(n, "volley"), AREA)]),
    sustainDef(m, "ironLaw", "鉄槌の律", "持続。振りを当てるたびに当てた所で衝撃波が起きて周りの敵も打ち、怯み値が増える", (n) => ({
      ...sustainCore(n),
      hitQuake: quakeOf(sub(n, "hitQuake")),
    })),
  ];
}

function gunnerSet(): UltimateSet {
  const m = "gunner";
  return [
    instantDef(m, "deathRondo", "死の輪舞", "全周へ弾をばら撒く", RANGED, (n) => [volley(sub(n, "volley"), RANGED)]),
    instantDef(m, "godspeed", "神速撃ち", "照準の方向へ速い弾を 6 発まとめて撃ち込む", RANGED, (n) => [volley(sub(n, "volley"), RANGED)]),
    sustainDef(m, "barrage", "弾幕", "持続。弾が 1 発増え、速く撃て、反動がなくなる", (n) => ({ ...sustainCore(n), shot: shotOf(n) })),
  ];
}

function sidearmSet(): UltimateSet {
  const m = "sidearm";
  return [
    instantDef(m, "sixShooter", "六連射", "照準の方向へ貫く弾を 6 発まとめて撃ち込む", RANGED, (n) => [volley(sub(n, "volley"), RANGED)]),
    instantDef(m, "pointBlank", "零距離乱射", "全周へ弾を撃ちながら後ろへ跳ぶ", RANGED, (n) => [volley(sub(n, "volley"), RANGED), recoil(sub(n, "volley"))]),
    sustainDef(m, "focus", "集中", "持続。弾が 1 体多く貫き、会心しやすく、足が速くなる", (n) => ({ ...sustainCore(n), shot: shotOf(n) })),
  ];
}

function longarmSet(): UltimateSet {
  const m = "longarm";
  return [
    instantDef(m, "armorPiercer", "徹甲弾", "並んだ敵をすべて貫く重い 1 発を撃つ", RANGED, (n) => [volley(sub(n, "volley"), RANGED)]),
    instantDef(m, "sweepFire", "掃射", "前方の扇へ 8 発を撃ち広げる", RANGED, (n) => [volley(sub(n, "volley"), RANGED)]),
    sustainDef(m, "sniperBreath", "狙撃手の息", "持続。弾が速くなり、予備動作中の敵へ強く、立ち止まると速く撃てる", (n) => ({ ...sustainCore(n), shot: shotOf(n) })),
  ];
}

function cannonSet(): UltimateSet {
  const m = "cannon";
  return [
    instantDef(m, "grandShell", "大砲撃", "照準の先に大爆発を起こす。近くに敵がいればそこへ落ちる", FIRE_RANGED, (n) => [nova(sub(n, "blast"))]),
    instantDef(m, "fullSalvo", "全弾発射", "床の設置弾を強めて全部起爆し、前方へ曲射を 5 発撃つ", FIRE_RANGED, (n) => [
      detonate(sub(n, "detonate")),
      volley(sub(n, "volley"), FIRE_RANGED, "mortar"),
    ]),
    sustainDef(m, "powderKeg", "火薬庫", "持続。散弾が 1 発増えて速く撃て、近い敵ほど大きな傷を与える", (n) => ({
      ...sustainCore(n),
      shot: shotOf(n),
      pointBlank: pointBlankOf(n),
    })),
  ];
}

function thrownSet(): UltimateSet {
  const m = "thrown";
  return [
    instantDef(m, "thousandHands", "千手", "前方の広い扇へ 12 本を投げ放つ", RANGED, (n) => [volley(sub(n, "volley"), RANGED)]),
    instantDef(m, "pinpoint", "一点集中", "敵を追う刃を 8 本投げる", RANGED, (n) => [volley(sub(n, "volley"), RANGED, "seekerOrb")]),
    sustainDef(m, "returnArt", "手返しの理", "持続。飛んでいる投げ物が一定の間隔で近くの敵へ曲がりながら手元へ戻り、戻りの威力が上がる", (n) => ({ ...sustainCore(n), recall: recallOf(n) })),
  ];
}

function grenadeSet(): UltimateSet {
  const m = "grenade";
  return [
    instantDef(m, "ironRain", "鉄の雨", "照準の先へ曲射を 5 発降らせる", RANGED, (n) => [volley(sub(n, "volley"), RANGED, "grenadeLauncher")]),
    instantDef(m, "incendiary", "焼夷弾", "照準の先 3 か所を焼き、炎の床を残す", FIRE_RANGED, (n) => [
      nova(sub(n, "blast"), { applies: [applyOf("burn", sub(n, "burn"))], terrain: "fire" }),
    ]),
    sustainDef(m, "shellFeast", "榴弾の宴", "持続。曲射が 1 発増え、威力が上がる", (n) => ({ ...sustainCore(n), shot: shotOf(n) })),
  ];
}

function trapperSet(): UltimateSet {
  const m = "trapper";
  return [
    instantDef(m, "minefield", "地雷原", "周囲へ設置弾を 8 個撒く", FIRE_RANGED, (n) => [volley(sub(n, "volley"), FIRE_RANGED, "mineLauncher")]),
    instantDef(m, "chainBlast", "連鎖爆破", "床の設置弾を強めて全部起爆し、足元も爆ぜさせる", FIRE_RANGED, (n) => [detonate(sub(n, "detonate")), nova(sub(n, "nova"))]),
    sustainDef(m, "trapperSense", "罠師の勘", "持続。設置弾の威力が上がってすぐ起爆し、床の設置弾が近くの敵を引き寄せる", (n) => {
      const pullBlock = sub(n, "minePull");
      return { ...sustainCore(n), shot: shotOf(n), minePull: { radius: num(pullBlock, "radius"), speed: num(pullBlock, "speed") } };
    }),
  ];
}

function warRingSet(): UltimateSet {
  const m = "warRing";
  return [
    instantDef(m, "ringDance", "輪舞", "全周へ輪を 4 本投げる。行って戻り、行きと帰りで当たる", RANGED, (n) => [volley(sub(n, "volley"), RANGED, "returnChakram")]),
    instantDef(m, "headsman", "断頭輪", "巨大な輪を 1 本ゆっくり投げる。すべて貫き、戻りでも当たる", RANGED, (n) => [volley(sub(n, "volley"), RANGED, "returnChakram")]),
    sustainDef(m, "circleLaw", "円環の理", "持続。撃った輪が自分の周りを回り続け、1 周ごとに同じ敵へもう一度当たる", (n) => ({ ...sustainCore(n), shot: shotOf(n) })),
  ];
}

const SET_BUILDERS: Readonly<Record<MovesetKey, () => UltimateSet>> = {
  sword: swordSet,
  greatsword: greatswordSet,
  twinBlades: twinBladesSet,
  spear: spearSet,
  scythe: scytheSet,
  fists: fistsSet,
  whip: whipSet,
  cleaver: cleaverSet,
  staff: staffSet,
  wand: wandSet,
  katana: katanaSet,
  axe: axeSet,
  shield: shieldSet,
  chainSickle: chainSickleSet,
  hammer: hammerSet,
  gunner: gunnerSet,
  sidearm: sidearmSet,
  longarm: longarmSet,
  cannon: cannonSet,
  thrown: thrownSet,
  grenade: grenadeSet,
  trapper: trapperSet,
  warRing: warRingSet,
};

export const ULTIMATES: Readonly<Record<MovesetKey, UltimateSet>> = Object.fromEntries(MOVESET_KEYS.map((k) => [k, SET_BUILDERS[k]()])) as Record<
  MovesetKey,
  UltimateSet
>;

const BY_KEY: ReadonlyMap<string, UltimateDef> = new Map(MOVESET_KEYS.flatMap((k) => ULTIMATES[k].map((u) => [u.key, u] as const)));

/** key から奥義を引く。無ければ undefined */
export function ultimateDef(key: string): UltimateDef | undefined {
  return BY_KEY.get(key);
}

/** 武器種の既定の奥義（配列の 0 番目） */
export function defaultUltimate(moveset: MovesetKey): UltimateDef {
  return ULTIMATES[moveset][0];
}

/** 定義済みの奥義の key か（永続化・リプレイの sanitize 用） */
export function isUltimateKey(v: unknown): v is string {
  return typeof v === "string" && BY_KEY.has(v);
}

const NO_RULES: readonly Rule[] = [];

/** 持続中の奥義の Rule（system/rules.ts の collectRules が毎回呼ぶ。active でなければ空） */
export function sustainRules(active: string | null): readonly Rule[] {
  if (active === null) return NO_RULES;
  const def = BY_KEY.get(active);
  return def?.kind === "sustain" ? (def.sustain.rules ?? NO_RULES) : NO_RULES;
}
