import { type KeywordProfile, kw } from "../core/keywords";
import type { StatusKind } from "../core/status";
import { FORM } from "./tuning";
import { type MovesetDef, type MovesetKey, type WeaponWeight, MOVESETS, MOVESET_KEYS, reviveWeight } from "./weapons";
import { type CastDef, type MeleeStepDef, reviveCast } from "./weapons";

/**
 * 武器の型（docs/ideas/weapon-forms-impl.md 2〜3 章）。27 の武器種（MovesetKey）の上に置く層で、
 * 重さの既定・戦意（溜まる出来事と放出）・共通の瞬間（応手・終撃）の出し方・段数の幅を型ごとに揃える。
 * 武器種は型の「個性」（リーチ・速さ・右の段の 1 つ）。数値は src/data/balance/weapons/FORM/<型>.json、
 * ここは union・表示名・構造だけを持つ（data/ultimates.ts と同じ流儀）。処理は system/morale.ts / system/moments.ts
 */

export const FORM_KEYS = [
  "blade",
  "flurry",
  "crusher",
  "hewer",
  "polearm",
  "chain",
  "bulwark",
  "warfan",
  "rod",
  "thrower",
  "pistol",
  "rifle",
  "artillery",
  "tome",
  "bell",
] as const;
export type FormKey = (typeof FORM_KEYS)[number];

/** 応手になる出来事（system/moments.ts の noteRiposte に渡す） */
export type RiposteSource = "parry" | "counter" | "justDodge" | "guardBlock" | "bulletCut" | "iai" | "pullInterrupt" | "recallCut" | "chargeEndure";

/** 終撃になる出来事。lastStep（連撃の最終段・フィニッシュ派生）は全型 */
export type FinisherSource = "lastStep" | "maxCharge" | "release" | "detonate" | "aimedShot";

/**
 * 戦意の溜まる出来事。amount / perSec / perDamage は FORM.<型>.gain の値を差し込む。
 * 導出（derived）の型は値を溜め込まず、system/morale.ts の tickMorale が毎ステップ数え直す
 */
export type MoraleGain =
  /** 通常の振りの命中（連刃の熱・扇の風） */
  | { kind: "meleeHit"; amount: number }
  /** 型の応手（剣の応報: 受け流し・カウンター・見切り・居合） */
  | { kind: "riposte"; amount: number }
  /** 溜めの段（重打。導出） */
  | { kind: "chargeLevel" }
  /** 近くの敵の status の最大スタック（刃斧の傷。導出） */
  | { kind: "applyStatus"; status: StatusKind }
  /** 突きの先端の命中（長柄の穂先） */
  | { kind: "tipHit"; amount: number }
  /** 繋いだ敵の数（鎖。導出） */
  | { kind: "pullHit" }
  /** 構えで受けたダメージ（盾の受け溜め） */
  | { kind: "guardBlock"; perDamage: number }
  /** 敵弾を消した（扇） */
  | { kind: "bulletCut"; amount: number }
  /** この連撃で出た詠唱・魔弾の数（杖。導出） */
  | { kind: "cast" }
  /** 自分の飛んでいる弾の数（投具。導出） */
  | { kind: "flyingShots" }
  /** 撃った弾（短銃の弾倉） */
  | { kind: "shotFired"; amount: number }
  /** 止まっている秒（長銃の狙い）。動く・ダッシュすると lossPerSec で減る */
  | { kind: "still"; perSec: number; lossPerSec: number }
  /** 床の自分の設置弾・曲射弾の数（砲。導出） */
  | { kind: "placedShots" }
  /** スキルの命中（書） */
  | { kind: "skillHit"; amount: number }
  /** 設置物・連動体の命中（鈴） */
  | { kind: "minionHit"; amount: number };

/**
 * 放出の形。laneStep の keys は右レーンの段の key（型に束ねた武器種ごとに 1 つ。設計の key を 1 つから列へ広げた）。
 * 放出の消費は命中ではなく振りの開始（空振りでも消える = 放つ時機を読む。7 章 9）
 */
export type MoraleRelease =
  /** 右レーンのこの key の段（振り・居合の溜め）が放出 */
  | { kind: "laneStep"; keys: readonly string[] }
  /** 3 手の派生が放出（杖） */
  | { kind: "branch" }
  /** 満ちた後の最初の左が放出（長柄の突き・長銃の 1 発） */
  | { kind: "nextPrimary" }
  /** 最大段の溜め攻撃が放出（重打） */
  | { kind: "maxCharge" }
  /** 構えを離した振りが放出（盾押し） */
  | { kind: "release" }
  /** 弾倉が空で装填、窓の中で右を押すと強装填（短銃。数値は FORM.pistol.reload） */
  | { kind: "reload"; windowSec: number; primeFrom: number; primeTo: number };

/** 放出の戦意 1 あたりの上乗せ（FORM.<型>.perUnit） */
export interface ReleasePerUnit {
  readonly damageMul: number;
  readonly poiseMul: number;
  readonly reachMul: number;
  readonly hitsAdd: number;
  readonly knockbackMul: number;
  readonly pierceAdd: number;
}

/** 戦意の数値（FORM.<型> から写す） */
export interface MoraleNumbers {
  readonly max: number;
  readonly releaseMin: number;
  /** 0 = すべて */
  readonly consumeUnits: number;
  readonly decayDelaySec: number;
  readonly decayPerSec: number;
  readonly releaseCrit: boolean;
  readonly perUnit: ReleasePerUnit;
}

export interface MoraleDef {
  /** ゲージの名（応報・熱・溜め・狙い…。HUD が読む） */
  readonly label: string;
  readonly gain: readonly MoraleGain[];
  readonly release: MoraleRelease;
  /** 導出なら tickMorale が毎ステップ数え直し、溜め込まない */
  readonly derived: boolean;
  readonly numbers: MoraleNumbers;
}

export interface FormDef {
  readonly key: FormKey;
  /** 表示名（剣・連刃…） */
  readonly name: string;
  /** 手触りの 1 行 */
  readonly desc: string;
  /** 既定の重さ（武器種の weight が違えばそちらが優先） */
  readonly weight: WeaponWeight;
  /** 左の段数の幅（銃の家系は右レーンの段数） */
  readonly steps: { readonly min: number; readonly max: number };
  readonly morale: MoraleDef;
  /** 応手になる出来事 */
  readonly riposte: readonly RiposteSource[];
  /** 終撃になる出来事 */
  readonly finisher: readonly FinisherSource[];
  /** 改鋳の key（段取り 5c の data/reforges.ts で埋める。5a は空） */
  readonly reforges: readonly string[];
  /** 共鳴の数えに使う語（今の型 1 つを出どころ 1 と数える。system/resonance.ts） */
  readonly keywords?: KeywordProfile;
}

/** 共通の瞬間の浮き文字（体言止め。見た目の数値は MOMENT） */
export const MOMENT_TEXT = {
  brim: "充溢",
  release: "放出",
  twinStrike: "双撃",
  firstStrike: "先制",
  /** 短銃の装填（弾倉が空。充溢の代わり）と強装填（窓の中で右を押せた） */
  reload: "装填",
  primed: "強装填",
} as const;

type FormNumbers = (typeof FORM)[FormKey];

function numbersOf(f: FormNumbers): MoraleNumbers {
  return {
    max: f.max,
    releaseMin: f.releaseMin,
    consumeUnits: f.consumeUnits,
    decayDelaySec: f.decayDelaySec,
    decayPerSec: f.decayPerSec,
    releaseCrit: f.releaseCrit,
    perUnit: { ...f.perUnit },
  };
}

/** 型に束ねた武器種（MOVESET_KEYS の並び） */
export function movesetsOfForm(form: FormKey): MovesetKey[] {
  return MOVESET_KEYS.filter((k) => MOVESETS[k].form === form);
}

/** 型に束ねた武器種の右レーンの最終段の key（骨の型の仮の放出の段） */
function lastLaneKeys(form: FormKey): string[] {
  return movesetsOfForm(form).flatMap((k) => {
    const lane = MOVESETS[k].steps2;
    const key = lane[lane.length - 1]?.key;
    return key === undefined ? [] : [key];
  });
}

/** 型に束ねた武器種の右レーンのうち、床の設置弾・曲射弾を一斉に起爆する段の key（砲の放出の段。段の JSON の detonateMines が元） */
function detonateLaneKeys(form: FormKey): string[] {
  return movesetsOfForm(form).flatMap((k) =>
    MOVESETS[k].steps2.flatMap((s) => (s.kind === "swing" && s.extras?.detonateMines && s.key !== undefined ? [s.key] : [])),
  );
}

interface FormSpec {
  name: string;
  desc: string;
  label: string;
  gain?: readonly MoraleGain[];
  release?: MoraleRelease;
  derived?: boolean;
  riposte: readonly RiposteSource[];
  finisher?: readonly FinisherSource[];
  /** 共鳴の数えに使う語（源と糧の共鳴。system/resonance.ts） */
  keywords: KeywordProfile;
}

/** 型の定義を仕上げる。放出の形を持たない骨の型は右レーンの最終段を仮の放出の段にする（溜まる出来事が無いので放出は起きない） */
function defineForm(key: FormKey, spec: FormSpec): FormDef {
  const f = FORM[key];
  return {
    key,
    name: spec.name,
    desc: spec.desc,
    weight: reviveWeight(f.weight),
    steps: { min: f.stepsMin, max: f.stepsMax },
    morale: {
      label: spec.label,
      gain: spec.gain ?? [],
      release: spec.release ?? { kind: "laneStep", keys: lastLaneKeys(key) },
      derived: spec.derived ?? false,
      numbers: numbersOf(f),
    },
    riposte: spec.riposte,
    finisher: spec.finisher ?? ["lastStep"],
    reforges: [],
    keywords: spec.keywords,
  };
}

export const FORMS: Readonly<Record<FormKey, FormDef>> = {
  // ---- 5a: 戦意が動く 4 型（3-4 の表） ----
  blade: defineForm("blade", {
    name: "剣",
    desc: "敵の攻撃を待って取り、応報を溜めて放つ",
    label: "応報",
    gain: [{ kind: "riposte", amount: FORM.blade.gain.riposte }],
    // 剣は右 2 段目の返し斬り、刀は居合（右の溜め）を離した振り。frenzy のような新しい key は 5b で足す
    release: { kind: "laneStep", keys: ["returnCut", "iai"] },
    keywords: kw(["melee", "counter"], ["just"]),
    riposte: ["parry", "counter", "justDodge", "iai"],
  }),
  flurry: defineForm("flurry", {
    name: "連刃",
    desc: "手を止めずに張り付き、熱を溜めて乱舞する",
    label: "熱",
    gain: [{ kind: "meleeHit", amount: FORM.flurry.gain.meleeHit }],
    // 双剣・爪・拳とも右の最終段が乱舞
    release: { kind: "laneStep", keys: ["frenzy"] },
    keywords: kw(["melee", "finisher"], ["combo"]),
    riposte: ["justDodge"],
    finisher: ["lastStep", "release"],
  }),
  crusher: defineForm("crusher", {
    name: "重打",
    desc: "溜めて耐え、最大の溜めで叩き潰す",
    label: "溜め",
    gain: [{ kind: "chargeLevel" }],
    release: { kind: "maxCharge" },
    derived: true,
    keywords: kw(["melee", "stagger", "finisher"], ["hurt"]),
    riposte: ["chargeEndure", "justDodge"],
    finisher: ["lastStep", "maxCharge", "release"],
  }),
  rifle: defineForm("rifle", {
    name: "長銃",
    desc: "足を止めて狙い、満ちた 1 発で貫く",
    label: "狙い",
    gain: [{ kind: "still", perSec: FORM.rifle.gain.still, lossPerSec: FORM.rifle.moveLossPerSec }],
    release: { kind: "nextPrimary" },
    keywords: kw(["ranged", "bullet", "finisher"], ["still"]),
    riposte: ["justDodge"],
    finisher: ["lastStep", "release", "aimedShot"],
  }),
  // ---- 5b・5d で戦意を埋める骨の型（名前と応手は 3-4 の表のまま） ----
  // ---- 5b-D1: 刃斧・長柄・鎖（固有の仕組みは system/formMarks.ts） ----
  hewer: defineForm("hewer", {
    name: "刃斧",
    desc: "傷を刻んで重ね、裂いて一度に開く",
    label: "傷",
    // 近くの敵の傷の最大スタック（導出）。右の最終段の裂きが放出で、命中した敵の傷を消して重ねた数だけ強い
    gain: [{ kind: "applyStatus", status: "wound" }],
    release: { kind: "laneStep", keys: ["rend"] },
    derived: true,
    keywords: kw(["melee", "bleed"], ["counter"]),
    riposte: ["counter", "justDodge"],
  }),
  polearm: defineForm("polearm", {
    name: "長柄",
    desc: "先端で当てて間合いを制し、満ちた突きで貫く",
    // 棍は武器種の moraleLabel で「棒先」と言い換える（data/weapons.ts）
    label: "穂先",
    gain: [{ kind: "tipHit", amount: FORM.polearm.gain.tipHit }],
    // 満ちた後の最初の突きが放出で、貫く穂先の弾（FORM.polearm.cast）を撃つ
    release: { kind: "nextPrimary" },
    keywords: kw(["melee", "finisher"], ["bullet"]),
    riposte: ["counter", "bulletCut"],
    finisher: ["lastStep", "release"],
  }),
  chain: defineForm("chain", {
    name: "鎖",
    desc: "敵を繋いで引き寄せ、まとめて叩きつける",
    label: "繋ぎ",
    // 繋いだ敵の数（導出）。右の最終段の束ね打ちが放出で、振り始めに繋いだ敵を前へ寄せる
    gain: [{ kind: "pullHit" }],
    release: { kind: "laneStep", keys: ["slam"] },
    derived: true,
    keywords: kw(["melee", "area"], ["counter"]),
    riposte: ["pullInterrupt", "justDodge"],
  }),
  // ---- 5b-D2: 盾・扇・杖・投具 ----
  bulwark: defineForm("bulwark", {
    name: "盾",
    desc: "構えて受け、受けた分を盾押しで返す",
    label: "受け溜め",
    gain: [{ kind: "guardBlock", perDamage: FORM.bulwark.gain.guardBlock }],
    // 構えを離した盾押し（hold.release の派生）が放出
    release: { kind: "release" },
    keywords: kw(["ward", "counter"], ["hurt"]),
    riposte: ["guardBlock"],
    finisher: ["lastStep", "release"],
  }),
  warfan: defineForm("warfan", {
    name: "扇",
    desc: "払って風を溜め、突風で押し流す",
    label: "風",
    gain: [
      { kind: "meleeHit", amount: FORM.warfan.gain.meleeHit },
      { kind: "bulletCut", amount: FORM.warfan.gain.bulletCut },
    ],
    // 構えを離した突風（hold.release の派生）が放出
    release: { kind: "release" },
    keywords: kw(["area", "wall"], ["bullet"]),
    riposte: ["bulletCut"],
    finisher: ["lastStep", "release"],
  }),
  rod: defineForm("rod", {
    name: "杖",
    desc: "詠唱を重ねて 3 手の魔法を放つ",
    label: "術式",
    // 連撃の入力数が術式（導出）。3 手の派生が放出で終撃
    gain: [{ kind: "cast" }],
    release: { kind: "branch" },
    derived: true,
    keywords: kw(["ranged", "finisher"], ["combo"]),
    riposte: ["justDodge"],
    finisher: ["lastStep", "release"],
  }),
  thrower: defineForm("thrower", {
    name: "投具",
    desc: "投げて飛ばし、戻りの刃で刻む",
    label: "飛んでいる数",
    // 飛んでいる自分の弾の数（導出）。手元返し（投擲）・輪刃の投げ放ち・戦輪の払いが放出
    gain: [{ kind: "flyingShots" }],
    release: { kind: "laneStep", keys: ["recall", "ringLaunch", "ringSweep"] },
    derived: true,
    keywords: kw(["ranged", "bullet"], ["just"]),
    riposte: ["recallCut", "justDodge"],
    finisher: ["lastStep", "release"],
  }),
  // ---- 5b-E: 銃の型 2（短銃の装填・砲の一斉起爆） ----
  pistol: defineForm("pistol", {
    name: "短銃",
    desc: "弾倉を撃ち切り、装填の拍で強装填する",
    label: "弾倉",
    gain: [{ kind: "shotFired", amount: FORM.pistol.gain.shotFired }],
    release: { kind: "reload", ...FORM.pistol.reload },
    // 応手は零距離の見切りだけ（範囲は moments.ts の noteRiposte が FORM.pistol.zeroDistance で絞る）
    keywords: kw(["ranged", "bullet"], ["just"]),
    riposte: ["justDodge"],
    finisher: ["lastStep", "release"],
  }),
  artillery: defineForm("artillery", {
    name: "砲",
    desc: "弾を置いて広げ、一斉に起爆する",
    label: "置いた弾",
    gain: [{ kind: "placedShots" }],
    // 右の一斉起爆の段（零距離砲・起爆・蹴り飛ばし）が放出。一斉起爆した数が単位で、その一撃が終撃
    release: { kind: "laneStep", keys: detonateLaneKeys("artillery") },
    derived: true,
    keywords: kw(["placed", "explode"], ["placed"]),
    riposte: ["justDodge"],
    finisher: ["lastStep", "release"],
  }),
  // ---- 5d-L: 書・鈴（固有の仕組みは system/tomeBell.ts） ----
  tome: defineForm("tome", {
    name: "書",
    desc: "スキルを当てて術を溜め、無詠唱で撃つ",
    label: "術",
    // スキルの命中（設置物・連動体の命中は鈴の分）で溜まり、右 1 段目の無詠唱が放出で次のスキル 1 回の気力が 0
    gain: [{ kind: "skillHit", amount: FORM.tome.gain.skillHit }],
    release: { kind: "laneStep", keys: ["freeCast"] },
    keywords: kw(["mana"], ["mana"]),
    riposte: ["justDodge"],
  }),
  bell: defineForm("bell", {
    name: "鈴",
    desc: "式を鳴らして鈴音を溜め、打ち鳴らして動かす",
    label: "鈴音",
    // 設置物・連動体の命中で溜まり、右 1 段目の打ち鳴らしが放出で近くの設置物を即発動し、連動体を強める
    gain: [{ kind: "minionHit", amount: FORM.bell.gain.minionHit }],
    release: { kind: "laneStep", keys: ["toll"] },
    keywords: kw(["placed", "stagger"], ["placed"]),
    riposte: ["justDodge"],
  }),
};

/** 武器種（変身・奥義の差し替え後の型でも key と form は装備のまま）の型 */
export function formOf(moveset: Pick<MovesetDef, "form">): FormDef {
  return FORMS[moveset.form];
}

/** 武器種の key から型 */
export function formOfKey(key: MovesetKey): FormDef {
  return FORMS[MOVESETS[key].form];
}

// ---------------------------------------------------------------------------
// 長柄の段の差し替え（system/player.ts の scaleStep が読む。武器種の定義は変えず、型と放出で決まる）
// ---------------------------------------------------------------------------

/** 長柄の放出の突きが撃つ貫く穂先の弾 */
const PIERCE_THRUST_CAST: CastDef = reviveCast(FORM.polearm.cast);

/** 突きの段か */
function isThrust(step: Readonly<MeleeStepDef>): boolean {
  return step.shape.kind === "thrust";
}

/** 放出の振りで段に差し込む弾（長柄の満ちた突き）。差し込まなければ undefined */
export function formReleaseCast(moveset: Pick<MovesetDef, "form">, step: Readonly<MeleeStepDef>, release: boolean): CastDef | undefined {
  if (!release || moveset.form !== "polearm" || !isThrust(step)) return undefined;
  return PIERCE_THRUST_CAST;
}

/** 型が段に敵弾を払わせるか（長柄: 穂先を持つ突きの段は active の間に敵弾を払う。FORM.polearm.tipCutsBullets） */
export function formCutsBullets(moveset: Pick<MovesetDef, "form" | "tip">, step: Readonly<MeleeStepDef>): boolean {
  return moveset.form === "polearm" && FORM.polearm.tipCutsBullets && moveset.tip !== undefined && isThrust(step);
}
