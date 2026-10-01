import type { Element } from "../core/element";
import type { EventKind } from "../core/events";
import { type KeywordProfile, kw } from "../core/keywords";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { TerrainKind } from "../core/terrain";
import { REFORGE } from "./tuning";
import { type FormDef, type FormKey, type MoraleNumbers, type ReleasePerUnit, FORM_KEYS, movesetsOfForm } from "./weaponForms";
import {
  type ActionStepDef,
  type BranchDef,
  type ButtonKey,
  type CastDef,
  type HoldArtDef,
  type MeleeChargeDef,
  type MeleeStepDef,
  type MovesetDef,
  actionLane,
  reviveCast,
} from "./weapons";

/**
 * 改鋳（docs/ideas/weapon-forms-impl.md 3-6、docs/ideas/build-core.md 4-1）。5 の倍数の階のボスの後に 3 択から選び、
 * 武器の型の「行動そのもの」を書き換える（ラン内。永続化しない）。型ごとに 2 つ、計 30。
 * 書き換えは 4 つの口のどれか（複数可）で表す:
 * - patch: 武器種の段の書き換え（system/player.ts の playerMoveset が withReforges を通す）
 * - morale: 戦意の数値の上書き（system/morale.ts の currentForm が reforgedForm を通す）
 * - rules: 共通の瞬間（終撃・放出・充溢・応手）を起点にした効果。統一ルール文法（system/rules.ts の collectRules が集める）
 * - flags: 上の 3 つで表せない挙動の切り替え（system/reforge.ts が読み、system/morale.ts から呼ばれる）
 * 数値は src/data/balance/weapons/REFORGE/<型>.json。ここは key・表示名・書き換えの形だけ
 */

export const REFORGE_KEYS = [
  "bladeRepel",
  "bladeWave",
  "flurryHoard",
  "flurryTwin",
  "crusherStride",
  "crusherQuake",
  "hewerSpread",
  "hewerPass",
  "polearmLeap",
  "polearmPin",
  "chainString",
  "chainFling",
  "bulwarkRound",
  "bulwarkThrow",
  "warfanHaze",
  "warfanReturn",
  "rodQuad",
  "rodResidue",
  "throwerPull",
  "throwerTwin",
  "pistolDash",
  "pistolChain",
  "rifleStride",
  "rifleScatter",
  "artilleryCling",
  "artilleryChain",
  "tomeHaste",
  "tomeFont",
  "bellToll",
  "bellWard",
] as const;
export type ReforgeKey = (typeof REFORGE_KEYS)[number];

/**
 * 段・戦意・ルールで表せない挙動の切り替え（system/reforge.ts が読む）。
 * aimWhileMoving = 動いても狙いが減らず溜まる / dashReload = 装填の窓のダッシュで即座に装填 /
 * pullToShots = 放出で飛んでいる自分の弾の方へ引き寄せられる / minesCling = 設置弾が近くの敵へ這い寄る
 */
export const REFORGE_FLAGS = ["aimWhileMoving", "dashReload", "pullToShots", "minesCling"] as const;
export type ReforgeFlag = (typeof REFORGE_FLAGS)[number];

/** 戦意の数値の上書き（書いた項目だけ置き換える） */
export type MoraleOverride = Partial<Omit<MoraleNumbers, "perUnit">> & { readonly perUnit?: Partial<ReleasePerUnit> };

/** 改鋳の Rule の形（id・持ち主・確率・範囲は reforgeRulesOf が付ける） */
export interface ReforgeRuleSpec {
  readonly when: EventKind;
  readonly if?: readonly RuleCondition[];
  readonly then: RuleEffect;
  readonly icd?: number;
}

export interface ReforgeDef {
  readonly key: ReforgeKey;
  readonly form: FormKey;
  /** 表示名（熟語。docs/GLOSSARY.md「改鋳」） */
  readonly name: string;
  /** 効果そのものの 1〜2 文 */
  readonly desc: string;
  readonly patch?: (m: MovesetDef) => MovesetDef;
  readonly morale?: MoraleOverride;
  readonly rules?: readonly ReforgeRuleSpec[];
  readonly flags?: readonly ReforgeFlag[];
  /** 共鳴の数えに使う語（改鋳 1 つを出どころ 1 と数える。system/resonance.ts） */
  readonly keywords?: KeywordProfile;
}

// ---------------------------------------------------------------------------
// 段の書き換えの道具（武器種の定義は変えず、写しを返す）
// ---------------------------------------------------------------------------

type StepFn = (step: MeleeStepDef) => MeleeStepDef;

function mapLane(m: MovesetDef, fn: (s: ActionStepDef) => ActionStepDef): MovesetDef {
  return { ...m, steps2: actionLane(m.steps2.map(fn)) };
}

/** 右レーンの key の段の振り（swing の段・溜めの段の離した振り）を書き換える */
function patchLaneSwings(m: MovesetDef, keys: readonly string[], fn: StepFn): MovesetDef {
  return mapLane(m, (s) => {
    if (s.key === undefined || !keys.includes(s.key)) return s;
    if (s.kind === "swing") return { ...s, step: fn(s.step) };
    if (s.kind === "charge") return { ...s, charge: { ...s.charge, step: fn(s.charge.step) } };
    return s;
  });
}

/** 右レーンの key の構えを書き換える */
function patchHold(m: MovesetDef, key: string, fn: (h: HoldArtDef) => HoldArtDef): MovesetDef {
  return mapLane(m, (s) => (s.kind === "hold" && s.key === key ? { ...s, hold: fn(s.hold) } : s));
}

/** 左の溜めと右レーンの溜めの段をすべて書き換える */
function patchCharges(m: MovesetDef, fn: (c: MeleeChargeDef) => MeleeChargeDef): MovesetDef {
  const withLeft = m.charge ? { ...m, charge: fn(m.charge) } : m;
  return mapLane(withLeft, (s) => (s.kind === "charge" ? { ...s, charge: fn(s.charge) } : s));
}

/** 近接の振りの段すべて（左・ダッシュ攻撃・右の振り・溜めの振り・派生）のうち when を満たすものを書き換える */
function patchEverySwing(m: MovesetDef, when: (step: MeleeStepDef) => boolean, fn: StepFn): MovesetDef {
  const one = (step: MeleeStepDef): MeleeStepDef => (when(step) ? fn(step) : step);
  const charged = patchCharges(m, (c) => ({ ...c, step: one(c.step) }));
  const laned = mapLane(charged, (s) => (s.kind === "swing" ? { ...s, step: one(s.step) } : s));
  return {
    ...laned,
    steps: laned.steps.map(one),
    dashAttack: one(laned.dashAttack),
    branches: laned.branches.map((b) => ({ ...b, step: one(b.step) })),
  };
}

/** 右レーンの弾を出す段と手元返しを書き換える */
function patchVolleys(m: MovesetDef, countAdd: number, spreadMin: number, returnMul: number): MovesetDef {
  return mapLane(m, (s) => {
    if (s.kind === "volley") {
      const count = s.throw.count + countAdd;
      return { ...s, throw: { ...s.throw, count, spreadDeg: Math.max(s.throw.spreadDeg, spreadMin) } };
    }
    if (s.kind === "recall") return { ...s, recall: { ...s.recall, returnDamageMul: s.recall.returnDamageMul * returnMul } };
    return s;
  });
}

/** 改鋳が撃たせる弾。弾の名前は改鋳の名前（data/weapons.ts の CAST_NAMES には載せない） */
function reforgeCast(raw: unknown, name: string): CastDef {
  const cast = reviveCast(raw);
  return { ...cast, name, throw: { ...cast.throw, bullet: { ...cast.throw.bullet, name } } };
}

// ---------------------------------------------------------------------------
// 型ごとの書き換え
// ---------------------------------------------------------------------------

/** 剣の放出の段（剣の返し斬り・刀の居合） */
const BLADE_RELEASE_KEYS = ["returnCut", "iai"] as const;
const BLADE_WAVE_NAME = "飛閃";
const BLADE_WAVE_CAST = reforgeCast(REFORGE.blade.bladeWave.cast, BLADE_WAVE_NAME);

function bladeRepel(m: MovesetDef): MovesetDef {
  const r = REFORGE.blade.bladeRepel;
  const parried = patchHold(m, "parry", (h) => (h.parry ? { ...h, parry: { ...h.parry, staggerPoise: h.parry.staggerPoise * r.staggerMul } } : h));
  // 重い一撃にすると壁叩きつけが起きる（combat の heavy）
  return patchLaneSwings(parried, BLADE_RELEASE_KEYS, (s) => ({ ...s, heavy: true, knockback: s.knockback * r.knockbackMul }));
}

function bladeWave(m: MovesetDef): MovesetDef {
  const r = REFORGE.blade.bladeWave;
  return patchLaneSwings(m, BLADE_RELEASE_KEYS, (s) => ({ ...s, size: s.size * r.sizeMul, cast: BLADE_WAVE_CAST }));
}

/** 連刃の放出の段（乱舞） */
const FLURRY_RELEASE_KEYS = ["frenzy"] as const;

function flurryTwin(m: MovesetDef): MovesetDef {
  const r = REFORGE.flurry.flurryTwin;
  return patchLaneSwings(m, FLURRY_RELEASE_KEYS, (s) => ({ ...s, hits: Math.round((s.hits ?? 1) * r.hitsMul), size: s.size * r.sizeMul }));
}

function crusherStride(m: MovesetDef): MovesetDef {
  const r = REFORGE.crusher.crusherStride;
  return patchCharges(m, (c) => ({ ...c, moveMul: Math.max(c.moveMul, r.moveMul), levels: c.levels.slice(0, r.maxLevels) }));
}

/** 長柄: 突きの段を押し出さず、その場に縫い留める */
function polearmPin(m: MovesetDef): MovesetDef {
  const r = REFORGE.polearm.polearmPin;
  const pin = { kind: "paralyze" as const, stacks: 1, duration: r.pinSec, potency: 0 };
  return patchEverySwing(
    m,
    (s) => s.shape.kind === "thrust",
    (s) => ({ ...s, knockback: s.knockback * r.knockbackMul, applies: [...(s.applies ?? []), pin] }),
  );
}

/** 鎖の放出の段（束ね打ち） */
const CHAIN_RELEASE_KEYS = ["slam"] as const;

function chainFling(m: MovesetDef): MovesetDef {
  const r = REFORGE.chain.chainFling;
  return patchLaneSwings(m, CHAIN_RELEASE_KEYS, (s) => ({ ...s, heavy: true, knockback: s.knockback * r.knockbackMul, size: s.size * r.sizeMul }));
}

function bulwarkRound(m: MovesetDef): MovesetDef {
  const r = REFORGE.bulwark.bulwarkRound;
  return patchHold(m, "guard", (h) => (h.guard ? { ...h, moveMul: r.moveMul, guard: { ...h.guard, arcDeg: r.arcDeg } } : h));
}

/** 3 手の派生（魔法）の頭の手をもう一度重ねた 4 手の派生を足す。既にある入力列とは重ねない */
function rodQuad(m: MovesetDef): MovesetDef {
  const taken = new Set(m.branches.map((b) => b.sequence.join(",")));
  const quads: BranchDef[] = [];
  for (const b of m.branches) {
    const head = b.sequence[0];
    if (b.art === "release" || b.sequence.length !== 3 || head === undefined) continue;
    const sequence: ButtonKey[] = [head, ...b.sequence];
    if (taken.has(sequence.join(","))) continue;
    taken.add(sequence.join(","));
    quads.push({ ...b, key: `${b.key}.quad`, name: `四重${b.name}`, sequence });
  }
  // 入力列の長いものから照合する（data/weapons.ts の defineMoveset と同じ並び）
  const branches = [...quads, ...m.branches].sort((a, b) => b.sequence.length - a.sequence.length);
  return { ...m, branches };
}

/** 魔法の属性 → 弾が消える位置に残す地形（属性の無い魔法は残さない） */
const RESIDUE_TERRAIN: Readonly<Partial<Record<Element, TerrainKind>>> = {
  fire: "fire",
  ice: "ice",
  lightning: "water",
  poison: "bog",
  dark: "smoke",
};

function withResidue(cast: CastDef): CastDef {
  const r = REFORGE.rod.rodResidue;
  const terrain = RESIDUE_TERRAIN[cast.throw.attack.element];
  // 既に地形を残す魔法（毒泡）はそのまま
  if (terrain === undefined || cast.throw.bullet.leaves !== undefined) return cast;
  const leaves = { terrain, radius: r.radius, duration: r.duration };
  return { ...cast, throw: { ...cast.throw, bullet: { ...cast.throw.bullet, leaves } } };
}

function rodResidue(m: MovesetDef): MovesetDef {
  const branches = m.branches.map((b) => (b.step.cast && b.sequence.length >= 3 ? { ...b, step: { ...b.step, cast: withResidue(b.step.cast) } } : b));
  return { ...m, branches };
}

function throwerTwin(m: MovesetDef): MovesetDef {
  const r = REFORGE.thrower.throwerTwin;
  return patchVolleys(m, r.countAdd, r.spreadDeg, r.returnDamageMul);
}

// ---------------------------------------------------------------------------
// 起点（統一ルール文法の条件）
// ---------------------------------------------------------------------------

/** 放出の一撃の命中（onFinisher の tag release） */
const RELEASE_HIT: RuleCondition = { kind: "eventTag", tag: "release" };
/** 扇で敵弾を払った応手（onRiposte の tag） */
const BULLET_CUT: RuleCondition = { kind: "eventTag", tag: "bulletCut" };

const R = REFORGE;
const PERCENT = 100;

/**
 * 改鋳の語（源と糧の共鳴で改鋳 1 つを出どころ 1 と数える。system/resonance.ts）。
 * 放出・終撃を起点にする改鋳は終撃を食い、型の放出（終撃を出す）と噛み合う
 */
const REFORGE_KEYWORDS: Readonly<Record<ReforgeKey, KeywordProfile>> = {
  bladeRepel: kw(["wall", "stagger"], ["counter"]),
  bladeWave: kw(["ranged"], ["counter"]),
  flurryHoard: kw([], ["combo"], ["finisher"]),
  flurryTwin: kw(["finisher"], [], ["melee"]),
  crusherStride: kw([], [], ["finisher"]),
  crusherQuake: kw(["area"], ["finisher"]),
  hewerSpread: kw(["bleed", "area"], ["finisher"]),
  hewerPass: kw(["bleed"], ["kill"]),
  polearmLeap: kw(["dash"], ["finisher"]),
  polearmPin: kw(["stagger"], ["melee"]),
  chainString: kw([], [], ["area"]),
  chainFling: kw(["area", "wall"], ["finisher"]),
  bulwarkRound: kw(["ward"], [], ["counter"]),
  bulwarkThrow: kw(["ranged", "area"], ["hurt"]),
  warfanHaze: kw(["ward"], ["bullet"]),
  warfanReturn: kw(["ranged", "bullet"], ["bullet"]),
  rodQuad: kw(["finisher"], ["combo"]),
  rodResidue: kw(["placed"], ["ranged"]),
  throwerPull: kw(["dash"], ["bullet"]),
  throwerTwin: kw(["bullet"], [], ["ranged"]),
  pistolDash: kw([], ["dash"]),
  pistolChain: kw(["shock"], ["finisher"]),
  rifleStride: kw([], [], ["ranged"]),
  rifleScatter: kw(["area", "bullet"], ["finisher"]),
  artilleryCling: kw([], [], ["placed"]),
  artilleryChain: kw(["explode"], ["finisher"]),
  tomeHaste: kw([], ["finisher"], ["mana"]),
  tomeFont: kw(["mana"]),
  bellToll: kw(["stagger"]),
  bellWard: kw(["ward"]),
};

function def(key: ReforgeKey, form: FormKey, name: string, desc: string, rest: Omit<ReforgeDef, "key" | "form" | "name" | "desc" | "keywords"> = {}): ReforgeDef {
  return { key, form, name, desc, keywords: REFORGE_KEYWORDS[key], ...rest };
}

export const REFORGES: Readonly<Record<ReforgeKey, ReforgeDef>> = {
  // ---- 剣 ----
  bladeRepel: def("bladeRepel", "blade", "反撥", "剣の構えの受け流しの崩しが強まり、返し斬りと居合が敵を弾き飛ばして壁に叩きつける", { patch: bladeRepel }),
  bladeWave: def("bladeWave", "blade", BLADE_WAVE_NAME, "返し斬りと居合が飛ぶ斬撃を放つ。振りの範囲は狭まる", { patch: bladeWave }),
  // ---- 連刃 ----
  flurryHoard: def("flurryHoard", "flurry", "蓄勢", `熱が冷めず、上限が ${R.flurry.flurryHoard.max} に上がる。乱舞は熱が ${R.flurry.flurryHoard.releaseMin} から放て、抱えた熱ほど当たる回数が増える`, {
    morale: R.flurry.flurryHoard,
  }),
  flurryTwin: def("flurryTwin", "flurry", "双影", "乱舞に分身が重なり、当たる回数が倍になり範囲が広がる", { patch: flurryTwin }),
  // ---- 重打 ----
  crusherStride: def("crusherStride", "crusher", "闊歩", `溜めながら歩ける。溜めの段は ${R.crusher.crusherStride.maxLevels} まで`, { patch: crusherStride, morale: { max: R.crusher.crusherStride.maxLevels } }),
  crusherQuake: def("crusherQuake", "crusher", "余震", "最大溜め攻撃が当たった場所に崩れる床が残り、乗った敵が落ちる", {
    rules: [
      {
        when: "onFinisher",
        if: [RELEASE_HIT],
        then: { kind: "placeTerrain", magnitude: 0, terrain: "rubble", radius: R.crusher.crusherQuake.radius, duration: R.crusher.crusherQuake.duration },
        icd: R.crusher.crusherQuake.icd,
      },
    ],
  }),
  // ---- 刃斧 ----
  hewerSpread: def("hewerSpread", "hewer", "満身創痍", "裂きが当たると、周りの敵にも傷が刻まれる", {
    rules: [
      {
        when: "onFinisher",
        if: [RELEASE_HIT],
        then: {
          kind: "nearbyEnemies",
          magnitude: 0,
          status: "wound",
          count: R.hewer.hewerSpread.stacks,
          duration: R.hewer.hewerSpread.duration,
          radius: R.hewer.hewerSpread.radius,
          color: R.hewer.hewerSpread.color,
        },
        icd: R.hewer.hewerSpread.icd,
      },
    ],
  }),
  hewerPass: def("hewerPass", "hewer", "波及", "傷のある敵を倒すと、その傷が近くの敵へ移る", {
    rules: [
      {
        when: "onKill",
        if: [{ kind: "targetHas", status: "wound" }],
        then: { kind: "passStatus", magnitude: 0, status: "wound", radius: R.hewer.hewerPass.radius, color: R.hewer.hewerPass.color },
      },
    ],
  }),
  // ---- 長柄 ----
  polearmLeap: def("polearmLeap", "polearm", "飛槍", `満ちた突きを放つと、放った先を追って跳べるようダッシュが ${R.polearm.polearmLeap.count} 回戻る`, {
    rules: [{ when: "onRelease", then: { kind: "refillDash", magnitude: 0, count: R.polearm.polearmLeap.count }, icd: R.polearm.polearmLeap.icd }],
  }),
  polearmPin: def("polearmPin", "polearm", "釘付", "突きが敵を押し出さず、その場に短い間縫い留める", { patch: polearmPin }),
  // ---- 鎖 ----
  chainString: def("chainString", "chain", "連珠", `繋ぎの上限が ${R.chain.chainString.max} に増え、束ね打ちで寄せる敵が増える`, { morale: { max: R.chain.chainString.max } }),
  chainFling: def("chainFling", "chain", "振子", "束ね打ちが寄せた敵を大きく振り飛ばし、当たった敵の周りを巻き込む", {
    patch: chainFling,
    rules: [
      {
        when: "onFinisher",
        if: [RELEASE_HIT],
        then: { kind: "shockwave", magnitude: R.chain.chainFling.magnitude, scaleBy: "slashBase" },
        icd: R.chain.chainFling.icd,
      },
    ],
  }),
  // ---- 盾 ----
  bulwarkRound: def("bulwarkRound", "bulwark", "八方", "構えが全方位の攻撃を受ける。構えの間は動けない", { patch: bulwarkRound }),
  bulwarkThrow: def("bulwarkThrow", "bulwark", "投盾", "受け溜めが満ちると、照準の方へ盾を投げて貫く衝撃波を放つ", {
    rules: [{ when: "onBrim", then: { kind: "wave", magnitude: R.bulwark.bulwarkThrow.magnitude, scaleBy: "slashBase" }, icd: R.bulwark.bulwarkThrow.icd }],
  }),
  // ---- 扇 ----
  warfanHaze: def("warfanHaze", "warfan", "煙嵐", "突風を放った場所に煙が残り、中に入った弾を消す", {
    rules: [
      {
        when: "onRelease",
        then: { kind: "placeTerrain", magnitude: 0, terrain: "smoke", radius: R.warfan.warfanHaze.radius, duration: R.warfan.warfanHaze.duration },
        icd: R.warfan.warfanHaze.icd,
      },
    ],
  }),
  warfanReturn: def("warfanReturn", "warfan", "返弾", "敵の弾を払うと、照準の方へ弾を撃ち返す", {
    rules: [
      {
        when: "onRiposte",
        if: [BULLET_CUT],
        then: { kind: "volley", magnitude: R.warfan.warfanReturn.magnitude, count: R.warfan.warfanReturn.count },
        icd: R.warfan.warfanReturn.icd,
      },
    ],
  }),
  // ---- 杖 ----
  rodQuad: def("rodQuad", "rod", "四重詠唱", `術式が ${R.rod.rodQuad.max} つまで並ぶ。3 手の魔法の頭の手を重ねた 4 手で、強い魔法を放つ`, { patch: rodQuad, morale: { max: R.rod.rodQuad.max } }),
  rodResidue: def("rodResidue", "rod", "残滓", "魔法の弾が消えた場所に、属性に合った地形が残る", { patch: rodResidue }),
  // ---- 投具 ----
  throwerPull: def("throwerPull", "thrower", "牽引", "呼び戻しや投げ放ちで、自分も飛んでいる刃の方へ引き寄せられる", { flags: ["pullToShots"] }),
  throwerTwin: def("throwerTwin", "thrower", "双刃", `投げる刃が ${R.thrower.throwerTwin.countAdd} 枚増え、戻りの刃が強まる。飛んでいる数の上限が ${R.thrower.throwerTwin.max} になる`, {
    patch: throwerTwin,
    morale: { max: R.thrower.throwerTwin.max },
  }),
  // ---- 短銃 ----
  pistolDash: def("pistolDash", "pistol", "疾駆", "装填の間にダッシュすると、その場で弾倉が満ちて強装填になる", { flags: ["dashReload"] }),
  pistolChain: def("pistolChain", "pistol", "雷管", "強装填の 1 発目が当たると、近くの敵へ雷が連鎖する", {
    rules: [
      {
        when: "onFinisher",
        if: [RELEASE_HIT],
        then: { kind: "chainLightning", magnitude: R.pistol.pistolChain.magnitude, scaleBy: "slashBase" },
        icd: R.pistol.pistolChain.icd,
      },
    ],
  }),
  // ---- 長銃 ----
  rifleStride: def("rifleStride", "rifle", "騎射", `動いても狙いが減らず、止まっているときの ${Math.round(R.rifle.rifleStride.movingGainMul * PERCENT)}% の速さで溜まる`, { flags: ["aimWhileMoving"] }),
  rifleScatter: def("rifleScatter", "rifle", "散華", "満ちた 1 発が敵を貫くたびに、破片が周りへ散る", {
    rules: [
      {
        when: "onFinisher",
        if: [RELEASE_HIT],
        then: { kind: "shards", magnitude: R.rifle.rifleScatter.magnitude, scaleBy: "slashBase", count: R.rifle.rifleScatter.count },
        icd: R.rifle.rifleScatter.icd,
      },
    ],
  }),
  // ---- 砲 ----
  artilleryCling: def("artilleryCling", "artillery", "吸着", "置いた設置弾が、近くの敵へ這い寄る", { flags: ["minesCling"] }),
  artilleryChain: def("artilleryChain", "artillery", "連爆", "一斉起爆が当たった敵の場所で、もう一度爆ぜる", {
    rules: [
      {
        when: "onFinisher",
        if: [RELEASE_HIT],
        then: { kind: "explode", magnitude: R.artillery.artilleryChain.magnitude, scaleBy: "slashBase", radius: R.artillery.artilleryChain.radius, excludeTarget: true },
        icd: R.artillery.artilleryChain.icd,
      },
    ],
  }),
  // ---- 書 ----
  tomeHaste: def("tomeHaste", "tome", "速読", "無詠唱を放つと、スキルの再使用が縮む", {
    rules: [{ when: "onRelease", then: { kind: "skillHaste", magnitude: R.tome.tomeHaste.seconds } }],
  }),
  tomeFont: def("tomeFont", "tome", "熟読", "術が満ちると、気力が湧く", {
    rules: [{ when: "onBrim", then: { kind: "restoreMana", magnitude: R.tome.tomeFont.mana } }],
  }),
  // ---- 鈴 ----
  bellToll: def("bellToll", "bell", "鳴動", "打ち鳴らしの音が、周りの敵を怯ませる", {
    rules: [{ when: "onRelease", then: { kind: "addPoise", magnitude: R.bell.bellToll.poise } }],
  }),
  bellWard: def("bellWard", "bell", "空蝉", "打ち鳴らすと、短い間攻撃をすり抜ける", {
    rules: [{ when: "onRelease", then: { kind: "iframes", magnitude: 0, duration: R.bell.bellWard.seconds } }],
  }),
};

// ---------------------------------------------------------------------------
// 引く・畳む
// ---------------------------------------------------------------------------

/** 型の改鋳（REFORGE_KEYS の並び） */
export function reforgesOfForm(form: FormKey): ReforgeKey[] {
  return REFORGE_KEYS.filter((k) => REFORGES[k].form === form);
}

/** 3 択に出せる改鋳か（型に武器種が 1 つも無い型の改鋳は、効き先が無いので出さない） */
export function isOfferable(key: ReforgeKey): boolean {
  return movesetsOfForm(REFORGES[key].form).length > 0;
}

/** 型の数と改鋳の数の対応（テストと資料の件数） */
export const REFORGES_PER_FORM: Readonly<Record<FormKey, number>> = Object.fromEntries(FORM_KEYS.map((f) => [f, reforgesOfForm(f).length])) as Record<FormKey, number>;

function keysFor(form: FormKey, reforges: readonly ReforgeKey[]): ReforgeKey[] {
  return reforges.filter((k) => REFORGES[k].form === form);
}

/** 入力の型ごとの合成済みの型（毎ステップ新しいオブジェクトを作らない。中身は定義から決まるので決定性に影響しない） */
const MOVESET_CACHE = new WeakMap<MovesetDef, Map<string, MovesetDef>>();

/**
 * 武器種に改鋳の段の書き換えを畳む。型の合う改鋳だけを取得順に掛ける（持ち替えた型の改鋳は効かない）。
 * cache は入力の型のオブジェクトごと（ジョブ派生を足した型・素の型を取り違えない）
 */
export function withReforges(moveset: MovesetDef, reforges: readonly ReforgeKey[]): MovesetDef {
  const keys = keysFor(moveset.form, reforges).filter((k) => REFORGES[k].patch !== undefined);
  if (keys.length === 0) return moveset;
  const cacheKey = keys.join(",");
  let byKeys = MOVESET_CACHE.get(moveset);
  if (!byKeys) {
    byKeys = new Map();
    MOVESET_CACHE.set(moveset, byKeys);
  }
  const cached = byKeys.get(cacheKey);
  if (cached) return cached;
  const merged = keys.reduce((m, k) => REFORGES[k].patch?.(m) ?? m, moveset);
  byKeys.set(cacheKey, merged);
  return merged;
}

const FORM_CACHE = new WeakMap<FormDef, Map<string, FormDef>>();

function overrideNumbers(n: MoraleNumbers, o: MoraleOverride): MoraleNumbers {
  const { perUnit, ...rest } = o;
  return { ...n, ...rest, perUnit: { ...n.perUnit, ...perUnit } };
}

/** 型に改鋳の戦意の上書きを畳む（system/morale.ts の currentForm が通す） */
export function reforgedForm(form: FormDef, reforges: readonly ReforgeKey[]): FormDef {
  const keys = keysFor(form.key, reforges).filter((k) => REFORGES[k].morale !== undefined);
  if (keys.length === 0) return form;
  const cacheKey = keys.join(",");
  let byKeys = FORM_CACHE.get(form);
  if (!byKeys) {
    byKeys = new Map();
    FORM_CACHE.set(form, byKeys);
  }
  const cached = byKeys.get(cacheKey);
  if (cached) return cached;
  const numbers = keys.reduce((n, k) => overrideNumbers(n, REFORGES[k].morale ?? {}), form.morale.numbers);
  const merged: FormDef = { ...form, morale: { ...form.morale, numbers } };
  byKeys.set(cacheKey, merged);
  return merged;
}

const ALWAYS = 1;
const NO_ICD = 0;

/** 改鋳の Rule（型の合う改鋳だけ。system/rules.ts の collectRules が武器種の固有効果の後に足す） */
export function reforgeRulesOf(form: FormKey, reforges: readonly ReforgeKey[]): Rule[] {
  const out: Rule[] = [];
  for (const key of keysFor(form, reforges)) {
    // EventSource に改鋳の種類は無いので、武器種の固有効果と同じくプレイヤー由来として key で区別する
    const owner = { kind: "player" as const, key: `reforge.${key}` };
    (REFORGES[key].rules ?? []).forEach((spec, i) => {
      out.push({ id: ruleId(owner, i), when: spec.when, if: spec.if ?? [], then: spec.then, chance: ALWAYS, icd: spec.icd ?? NO_ICD, scope: SCOPE_ANY, owner });
    });
  }
  return out;
}

/** 改鋳の挙動の切り替えを持つか（型の合う改鋳だけ） */
export function hasReforgeFlag(form: FormKey, reforges: readonly ReforgeKey[], flag: ReforgeFlag): boolean {
  return keysFor(form, reforges).some((k) => REFORGES[k].flags?.includes(flag) === true);
}
