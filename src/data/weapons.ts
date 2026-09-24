import { type AttackProfile, attack } from "../core/element";
import { type KeywordProfile, kw } from "../core/keywords";
import type { EventKind } from "../core/events";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { StatusApply } from "../core/status";
import type { Scaling } from "../loot/types";
import { ACTION, MANA, PLAYER, WEAPON } from "./tuning";

/**
 * 武器種（通常攻撃の型）と射撃の型。docs/COMBAT_DESIGN.md「武器種」/ docs/ideas/meta-and-weapons.md 1〜2 章。
 * 武器スロットのベースが moveset、銃スロットのベースが shot を決める（src/loot/bases.ts）。
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
  /** 威力の係数（docs/COMBAT_DESIGN.md A-6）。呼び出し側で scaled を通す */
  readonly scaling: Scaling;
  /** 1 ヒットの基礎怯み値 */
  readonly poise: number;
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
}

/** 左クリック（攻撃キー）= primary、右クリック（射撃キー）= secondary */
export type ButtonKey = "primary" | "secondary";

/**
 * ボタンの役割。melee = 押すたびに連撃の次の段 / shot = 押している間、銃の射撃の型で撃つ /
 * charge = 押して溜め、離して振る（tap は連撃）
 */
export type ActionKind = "melee" | "shot" | "charge";

/** コンボ派生: 入力列の末尾が sequence と一致したら、次の振りを step に差し替える */
export interface BranchDef {
  readonly key: string;
  /** 表示名 */
  readonly name: string;
  readonly sequence: readonly ButtonKey[];
  readonly step: MeleeStepDef;
  /** 派生の後に連撃を続ける段（0 始まり）。省略はフィニッシュ（連撃がここで終わる） */
  readonly next?: number;
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
  readonly charge?: MeleeChargeDef;
  readonly tip?: TipDef;
  /** 攻撃中の移動速度倍率 */
  readonly attackMoveMul: number;
  /** 左クリック / 右クリックの役割。剣は 近接 / 射撃（従来の操作） */
  readonly primary: ActionKind;
  readonly secondary: ActionKind;
  /** コンボ派生（入力列の長いものから照合する） */
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
  readonly keywords: KeywordProfile;
  /** 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）。威力は PLAYER.shoot の Scaling（技巧）なので遠距離・物理に揃える */
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

const W = WEAPON.movesets;

/** 派生の表示名（数値は tuning の WEAPON.movesets[].branches） */
const BRANCH_NAMES: Readonly<Record<string, string>> = {
  crossCut: "十字断ち",
  steppingCut: "踏み込み斬り",
  sweep: "薙ぎ払い",
  helmSplitter: "兜割り",
  flurry: "乱れ斬り",
  crossing: "交差斬り",
  shadowStep: "影踏み",
  spearSweep: "石突き回し",
  divingThrust: "飛び込み突き",
  reaping: "刈り取り",
  hookPull: "鎌引き",
  uppercut: "昇り拳",
  hundredFists: "百裂拳",
  steppingFist: "踏み込み拳",
  whirl: "巻き打ち",
  crack: "鞭鳴らし",
  slamDown: "叩き落とし",
  shoulderCharge: "肩当て",
  tempest: "旋風",
  upswing: "払い上げ",
  arcaneStrike: "魔力撃",
  staffSweep: "杖払い",
  tsubame: "燕返し",
  quickDraw: "抜き打ち",
  axeSpin: "回転斬り",
  cleave: "断ち割り",
  shieldPush: "盾押し",
  shieldDrop: "盾落とし",
  chainWeight: "分銅",
  reelIn: "巻き取り",
  hammerSweep: "大薙ぎ",
  groundBreaker: "地砕き",
};

type BranchTable = Readonly<Record<string, { readonly sequence: readonly ButtonKey[]; readonly step: MeleeStepDef; readonly next?: number }>>;

/** tuning の派生表を BranchDef の配列にする。照合は長い列から（「左左右」を「左右」より先に見る） */
function branchesOf(table: BranchTable): BranchDef[] {
  return Object.entries(table)
    .map(([key, b]) => ({ key, name: BRANCH_NAMES[key] ?? key, sequence: b.sequence, step: b.step, next: b.next }))
    .sort((a, b) => b.sequence.length - a.sequence.length);
}

/** 既定の操作（左 = 近接、右 = 射撃） */
const MELEE_SHOT = { primary: "melee", secondary: "shot" } as const;
/** 左右とも近接（大剣の右以外で、右単独の派生を持つ武器種） */
const MELEE_MELEE = { primary: "melee", secondary: "melee" } as const;

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
  sword: {
    key: "sword",
    name: "剣",
    desc: "3 段の素直な斬撃。左左右で十字断ち、撃ってすぐ斬ると踏み込み斬り",
    steps: swordSteps(),
    dashAttack: { ...ACTION.dashAttack, shape: BOX, mana: MANA.onDashAttack },
    attackMoveMul: W.sword.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.sword.branches),
    keywords: kw(["melee", "combo", "finisher"], [], ["counter"]),
    attack: attack("melee", "physical"),
  },
  greatsword: {
    key: "greatsword",
    name: "大剣",
    desc: "広い弧の大振り 4 段。長押しで 3 段階まで溜める。右クリックは薙ぎ払い",
    steps: W.greatsword.steps,
    dashAttack: W.greatsword.dashAttack,
    charge: W.greatsword.charge,
    attackMoveMul: W.greatsword.attackMoveMul,
    primary: "charge",
    secondary: "melee",
    branches: branchesOf(W.greatsword.branches),
    keywords: kw(["melee", "stagger", "finisher", "wall", "area"], ["still"], ["elite"]),
    attack: attack("melee", "physical"),
  },
  twinBlades: {
    key: "twinBlades",
    name: "双剣",
    desc: "軽い 5 連撃（3 段目は 2 回斬る）。手数でトリガーと状態異常を回す",
    steps: W.twinBlades.steps,
    dashAttack: W.twinBlades.dashAttack,
    attackMoveMul: W.twinBlades.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.twinBlades.branches),
    keywords: kw(["melee", "combo"], [], ["crit", "bleed"]),
    attack: attack("melee", "physical"),
  },
  spear: {
    key: "spear",
    name: "槍",
    desc: "長い突き 4 段（3 段目は二連突き）。穂先で当てると怯み値が倍になる",
    steps: W.spear.steps,
    dashAttack: W.spear.dashAttack,
    tip: W.spear.tip,
    attackMoveMul: W.spear.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.spear.branches),
    keywords: kw(["melee", "stagger", "wall"], [], ["crit", "counter"]),
    attack: attack("melee", "physical"),
  },
  scythe: {
    key: "scythe",
    name: "大鎌",
    desc: "広い弧で敵を手前へ引き寄せ、最後に大きく刈る",
    steps: W.scythe.steps,
    dashAttack: W.scythe.dashAttack,
    attackMoveMul: W.scythe.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.scythe.branches),
    keywords: kw(["melee", "area"], ["poison", "bleed"], ["kill", "area"]),
    attack: attack("melee", "hybrid", "dark"),
  },
  fists: {
    key: "fists",
    name: "拳",
    desc: "至近の速い連打。殴りながら歩け、ダッシュ攻撃で背後へ投げる",
    steps: W.fists.steps,
    dashAttack: W.fists.dashAttack,
    attackMoveMul: W.fists.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.fists.branches),
    keywords: kw(["melee", "combo", "wall", "mana"], ["hurt"], ["heal"]),
    attack: attack("melee", "physical"),
  },
  whip: {
    key: "whip",
    name: "鞭",
    desc: "細く長い一撃。先端でだけ満額が入り、根元は弱い",
    steps: W.whip.steps,
    dashAttack: W.whip.dashAttack,
    tip: W.whip.tip,
    attackMoveMul: W.whip.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.whip.branches),
    keywords: kw(["melee", "area"], [], ["crit", "fear", "shock"]),
    attack: attack("melee", "physical", "lightning"),
  },
  cleaver: {
    key: "cleaver",
    name: "鉈",
    desc: "重く遅い振り。どの段でも壁に叩きつける",
    steps: W.cleaver.steps,
    dashAttack: W.cleaver.dashAttack,
    attackMoveMul: W.cleaver.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.cleaver.branches),
    keywords: kw(["melee", "wall", "stagger"], [], ["burn", "bleed"]),
    attack: attack("melee", "physical"),
  },
  staff: {
    key: "staff",
    name: "棍",
    desc: "広く薙いで周りを打つ。威力は低いが気力がよく戻る",
    steps: W.staff.steps,
    dashAttack: W.staff.dashAttack,
    attackMoveMul: W.staff.attackMoveMul,
    ...MELEE_SHOT,
    branches: branchesOf(W.staff.branches),
    keywords: kw(["melee", "area", "stagger", "mana"], [], ["mana"]),
    attack: attack("melee", "physical"),
  },
  wand: {
    key: "wand",
    name: "杖",
    desc: "左で銃の射撃、右で杖打ちの連撃。撃ってから打つと魔力撃",
    steps: W.wand.steps,
    dashAttack: W.wand.dashAttack,
    attackMoveMul: W.wand.attackMoveMul,
    primary: "shot",
    secondary: "melee",
    branches: branchesOf(W.wand.branches),
    keywords: kw(["melee", "ranged", "mana"], ["mana"], ["bullet"]),
    attack: attack("melee", "arcane", "light"),
  },
  katana: {
    key: "katana",
    name: "刀",
    desc: "速い 3 段の斬りと突き。右の長押しで居合、カウンターで当てると勢いづく",
    steps: W.katana.steps,
    dashAttack: W.katana.dashAttack,
    charge: W.katana.charge,
    attackMoveMul: W.katana.attackMoveMul,
    primary: "melee",
    secondary: "charge",
    branches: branchesOf(W.katana.branches),
    keywords: kw(["melee", "counter", "finisher"], ["still"], ["counter"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("katana", 0, {
        when: "onCounter",
        then: { kind: "damageBuff", magnitude: R.katanaCounterPct, duration: R.katanaCounterSec },
      }),
    ],
  },
  axe: {
    key: "axe",
    name: "斧",
    desc: "扇の 4 段。最後の一振りで出血させ、出血した敵は崩れやすい。右は回転斬り",
    steps: W.axe.steps,
    dashAttack: W.axe.dashAttack,
    attackMoveMul: W.axe.attackMoveMul,
    ...MELEE_MELEE,
    branches: branchesOf(W.axe.branches),
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
  },
  shield: {
    key: "shield",
    name: "大盾",
    desc: "弱いが重く押す 4 段。当てるたびに一瞬身が固まる。右は盾押し",
    steps: W.shield.steps,
    dashAttack: W.shield.dashAttack,
    attackMoveMul: W.shield.attackMoveMul,
    ...MELEE_MELEE,
    branches: branchesOf(W.shield.branches),
    keywords: kw(["melee", "ward", "wall", "stagger"], [], ["counter"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("shield", 0, {
        when: "onMeleeHit",
        then: { kind: "invuln", magnitude: R.shieldInvulnSec, duration: R.shieldInvulnSec },
        icd: R.shieldInvulnIcd,
      }),
    ],
  },
  chainSickle: {
    key: "chainSickle",
    name: "鎖鎌",
    desc: "短く速い鎌の 4 段。右の分銅で遠くの敵を引き寄せて崩し、引いた敵を斬ると大きく怯む",
    steps: W.chainSickle.steps,
    dashAttack: W.chainSickle.dashAttack,
    attackMoveMul: W.chainSickle.attackMoveMul,
    ...MELEE_MELEE,
    branches: branchesOf(W.chainSickle.branches),
    keywords: kw(["melee", "combo", "stagger"], [], ["crit"]),
    attack: attack("melee", "physical"),
    rules: [
      movesetRule("chainSickle", 0, {
        when: "onMeleeHit",
        if: [{ kind: "not", condition: { kind: "branchSwing" } }, { kind: "targetHas", status: "broken" }],
        then: { kind: "addPoise", magnitude: R.chainBrokenPoise },
      }),
    ],
  },
  hammer: {
    key: "hammer",
    name: "戦鎚",
    desc: "遅く重い 4 段。左の長押しで溜め、最終段で衝撃波。堅守を叩き崩す",
    steps: W.hammer.steps,
    dashAttack: W.hammer.dashAttack,
    charge: W.hammer.charge,
    attackMoveMul: W.hammer.attackMoveMul,
    primary: "charge",
    secondary: "melee",
    branches: branchesOf(W.hammer.branches),
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
  },
  gunner: {
    key: "gunner",
    name: "二丁拳銃",
    desc: "左右どちらでも銃の射撃の型で撃つ。近接はダッシュの終わりの反転撃ちだけ",
    steps: [],
    dashAttack: W.gunner.dashAttack,
    attackMoveMul: W.gunner.attackMoveMul,
    primary: "shot",
    secondary: "shot",
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
  },
};

/** 武器種の固有効果の Rule（今の武器種のものだけ。定義が無ければ空） */
export function movesetRules(key: MovesetKey): readonly Rule[] {
  return MOVESETS[key]?.rules ?? [];
}

/** 近接の段を持たない射撃専用の武器種か（二丁拳銃） */
export function isShotOnly(moveset: MovesetDef): boolean {
  return moveset.steps.length === 0;
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

/** 近接の連撃を出すボタン（melee か charge の役割を持つ方）。両方なら primary */
export function meleeButton(moveset: MovesetDef): ButtonKey | undefined {
  if (moveset.primary !== "shot") return "primary";
  if (moveset.secondary !== "shot") return "secondary";
  return undefined;
}

/** 射撃のボタン。どちらも近接なら undefined（その武器種では銃を撃てない）。両方射撃（二丁拳銃）なら右 */
export function shotButton(moveset: MovesetDef): ButtonKey | undefined {
  if (moveset.secondary === "shot") return "secondary";
  if (moveset.primary === "shot") return "primary";
  return undefined;
}

/** 射撃の役割を持つボタンすべて（二丁拳銃は左右の両方） */
export function shotButtons(moveset: MovesetDef): ButtonKey[] {
  const out: ButtonKey[] = [];
  if (moveset.primary === "shot") out.push("primary");
  if (moveset.secondary === "shot") out.push("secondary");
  return out;
}

/** 溜めの役割を持つボタン（大剣・戦鎚は左、刀は右）。溜めを持たない武器種は undefined */
export function chargeButton(moveset: MovesetDef): ButtonKey | undefined {
  if (moveset.primary === "charge") return "primary";
  if (moveset.secondary === "charge") return "secondary";
  return undefined;
}

/** 入力列の末尾に一致する派生（長い列が先）。無ければ undefined */
export function matchBranch(moveset: MovesetDef, inputs: readonly ButtonKey[]): number | undefined {
  const index = moveset.branches.findIndex((b) => endsWith(inputs, b.sequence));
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
