import type { EventKind, EventSource } from "../core/events";
import { type KeywordProfile, kw } from "../core/keywords";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { Attributes } from "../loot/types";
import type { QuestKey } from "../meta/quests";
import type { SkillKey } from "../skills/types";
import type { LineageKey } from "../system/boonDefs";
import { BALANCE } from "./balance";
import { JOB, MANA_SOURCE, WEAPON } from "./tuning";
import { reviveStep } from "./weapons";
import type { BranchDef, ButtonKey, MovesetKey } from "./weapons";

/** 数値は src/data/balance/jobs/ の attributes / MANA_SOURCE（見習いは数値を持たないのでここで空を渡す） */
const JOB_ATTRIBUTES = BALANCE.jobs.attributes;
const MS = MANA_SOURCE;

/**
 * ジョブ = 流儀（docs/COMBAT_DESIGN.md A-9、docs/ideas/weapon-forms-impl.md 3-7）。起点とは別の軸で、ラン開始時に 1 つ選ぶ。
 * ジョブはステータスの偏り・ダッシュの形・気力の源・固有のルール 2 つ・初期スキル石・初期武器を持つ。
 * 得意武器の倍率と弱点は段取り 5c で削った（武器の型と直交させ、どの武器でも流儀の指の動きが変わるようにする）。
 * 数値は src/data/tuning.ts の JOB / DASH_FORM / MANA_SOURCE、畳み込みと開始時の処理は src/system/jobs.ts、
 * ダッシュの形は src/system/dashForms.ts、気力の源は src/system/manaSources.ts
 */

export const JOB_KEYS = ["none", "swordsman", "hunter", "brawler", "shieldBearer", "hexer", "lancer", "invoker", "shadow", "alchemist", "onmyoji", "miko"] as const;
export type JobKey = (typeof JOB_KEYS)[number];

/** ダッシュの形（src/system/dashForms.ts）。数値は DASH_FORM.<形>。新しい形は末尾に足す */
export const DASH_FORM_KEYS = ["standard", "step", "leap", "slip", "brace", "mist", "vault", "blink", "shadow", "flask", "swap", "ward"] as const;
export type DashForm = (typeof DASH_FORM_KEYS)[number];

/** ダッシュの形の表示名（docs/GLOSSARY.md）。「踏み込み」「飛び退き」「跳躍」「瞬歩」「霧」「結界」（スキル「結界杭」）は既存の語と重なるので避けた */
export const DASH_FORM_NAMES: Readonly<Record<DashForm, string>> = {
  standard: "駆け",
  step: "詰め足",
  leap: "退き足",
  slip: "紙一重",
  brace: "不退",
  mist: "霧隠れ",
  vault: "跳び越え",
  blink: "転移",
  shadow: "影潜り",
  flask: "瓶投げ",
  swap: "入れ替わり",
  ward: "護り足",
};

/**
 * 気力の源（src/system/manaSources.ts）。流儀ごとに気力がどこから湧くか。
 * attackHit は通常攻撃の命中の回収（MANA.onMelee / onShot）に掛ける倍率。見習いは 1、他は JOB.manaBaseMul の下地。
 * minionHit（陰陽師。skills/hit.ts の SkillHitSpec.minion）・boonFired（巫女。system/rules.ts の加護の発火）
 */
export type ManaSource =
  | { readonly kind: "attackHit"; readonly mul: number }
  | { readonly kind: "riposte"; readonly amount: number }
  | { readonly kind: "finisher"; readonly amount: number }
  | { readonly kind: "rangedHitFar"; readonly perMeter: number; readonly minDistance: number }
  | { readonly kind: "comboHit"; readonly perCombo: number; readonly comboCap: number }
  | { readonly kind: "guardBlock"; readonly perDamage: number }
  | { readonly kind: "statusTick"; readonly perSec: number }
  | { readonly kind: "tipHit"; readonly amount: number }
  | { readonly kind: "skillHit"; readonly amount: number }
  | { readonly kind: "backstab"; readonly amount: number }
  | { readonly kind: "reaction"; readonly amount: number }
  | { readonly kind: "minionHit"; readonly amount: number }
  | { readonly kind: "boonFired"; readonly amount: number };
export type ManaSourceKind = ManaSource["kind"];

/** 見習い以外の通常攻撃の命中の下地（枯渇で遊べなくならない保険） */
const BASE_ATTACK_MANA: ManaSource = { kind: "attackHit", mul: JOB.manaBaseMul };
/** 見習いは通常攻撃の命中だけで今までどおり湧く */
const PLAIN_ATTACK_MANA: ManaSource = { kind: "attackHit", mul: 1 };

export interface JobRuleDef {
  /** 何ができるかの 1 文（起点画面の説明） */
  text: string;
  rule: Rule;
}

export interface JobDef {
  name: string;
  /** どう戦うジョブかの 1 行 */
  desc: string;
  /** 基礎値（各 5）に足す偏り。合計は 0（どれかを伸ばせばどれかが下がる） */
  attributes: Partial<Attributes>;
  /** ダッシュの形（src/system/dashForms.ts） */
  dash: DashForm;
  /** 気力の源（src/system/manaSources.ts）。attackHit を必ず 1 つ持つ */
  mana: readonly ManaSource[];
  rules: readonly JobRuleDef[];
  /** 開始時に足元へ置くスキル石 */
  starterSkill: SkillKey | null;
  /** 開始時に渡す素の武器（src/loot/bases.ts の BASES の key）。剣は武器なしで振れるので剣士は打刀 */
  starterWeapon: string | null;
  keywords: KeywordProfile;
  /** この依頼を達成すると選べる（src/meta/quests.ts）。無ければ最初から選べる */
  unlockedBy?: QuestKey;
  /** 流儀の専用系譜（docs/ideas/boon-impl.md 2-1）。出口の予告で祝福の系譜に選ばれやすい。見習いは持たない */
  lineage?: LineageKey;
}

const ALWAYS = 1;
const PERCENT = 100;
const NO_ICD = 0;
/** 広げる状態異常の強さの倍率（元と同じ） */
const SAME_POTENCY = 1;

function owner(job: JobKey): EventSource {
  // EventSource に job の種類は無いので、プレイヤー由来として key で区別する
  return { kind: "player", key: `job.${job}` };
}

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

/** 確定発動の Rule を組む（id は持ち主 + 添字。決定性） */
function jobRule(job: JobKey, index: number, text: string, spec: RuleSpec): JobRuleDef {
  const o = owner(job);
  return {
    text,
    rule: { id: ruleId(o, index), when: spec.when, if: spec.if ?? [], then: spec.then, chance: ALWAYS, icd: spec.icd ?? NO_ICD, scope: SCOPE_ANY, owner: o },
  };
}

export const JOBS: Readonly<Record<JobKey, JobDef>> = {
  none: {
    name: "見習い",
    desc: "ジョブなし。ステータスの増減も固有のルールもない。",
    attributes: {},
    dash: "standard",
    mana: [PLAIN_ATTACK_MANA],
    rules: [],
    starterSkill: null,
    starterWeapon: null,
    keywords: kw([]),
  },
  swordsman: {
    lineage: "blade",
    name: "剣士",
    desc: "連撃を締めくくる終撃で敵を崩し、見切りから斬り返す。",
    attributes: JOB_ATTRIBUTES.swordsman,
    dash: "step",
    mana: [BASE_ATTACK_MANA, { kind: "riposte", amount: MS.swordsman.riposte }, { kind: "finisher", amount: MS.swordsman.finisher }],
    rules: [
      jobRule("swordsman", 0, `終撃が当たると怯み値 ${JOB.swordsmanFinisherPoise} を上乗せする。`, {
        when: "onMeleeHit",
        if: [{ kind: "finisher" }],
        then: { kind: "addPoise", magnitude: JOB.swordsmanFinisherPoise },
      }),
      jobRule("swordsman", 1, `見切りを決めると ${JOB.swordsmanJustBuffSec} 秒間ダメージ +${JOB.swordsmanJustBuffPct}%。`, {
        when: "onJustDodge",
        then: { kind: "damageBuff", magnitude: JOB.swordsmanJustBuffPct, duration: JOB.swordsmanJustBuffSec },
      }),
    ],
    starterSkill: "lunge",
    starterWeapon: "katana",
    keywords: kw(["melee", "finisher", "stagger"], ["just"]),
  },
  hunter: {
    lineage: "thunder",
    name: "狩人",
    desc: "予備動作中の敵を射撃・遠距離スキルで怯ませ、精鋭を脆弱にする。",
    attributes: JOB_ATTRIBUTES.hunter,
    dash: "leap",
    mana: [BASE_ATTACK_MANA, { kind: "rangedHitFar", perMeter: MS.hunter.perMeter, minDistance: MS.hunter.minDistance }],
    rules: [
      jobRule("hunter", 0, `予備動作中の敵を射撃・遠距離スキルで撃つと怯み値 ${JOB.hunterWindupPoise} を上乗せする。`, {
        when: "onRangedHit",
        if: [{ kind: "trigger", condition: "targetInWindup" }],
        then: { kind: "addPoise", magnitude: JOB.hunterWindupPoise },
      }),
      jobRule("hunter", 1, `精鋭を射撃・遠距離スキルで撃つと ${JOB.hunterVulnerableSec} 秒間脆弱にする。`, {
        when: "onRangedHit",
        if: [{ kind: "trigger", condition: "targetElite" }],
        then: { kind: "inflict", status: "vulnerable", magnitude: JOB.hunterVulnerableSec },
        icd: JOB.hunterEliteIcd,
      }),
    ],
    starterSkill: "railshot",
    starterWeapon: "crossbow",
    keywords: kw(["ranged", "stagger", "vulnerable"], ["elite"]),
  },
  brawler: {
    lineage: "blade",
    name: "拳闘士",
    desc: "殴り続けると衝撃波を放ち、被弾すると攻撃が強まる。",
    attributes: JOB_ATTRIBUTES.brawler,
    dash: "slip",
    mana: [BASE_ATTACK_MANA, { kind: "comboHit", perCombo: MS.brawler.perCombo, comboCap: MS.brawler.comboCap }],
    rules: [
      jobRule("brawler", 0, `近接を ${JOB.brawlerEveryHits} 回当てるごとに周りへ衝撃波。`, {
        when: "onMeleeHit",
        if: [{ kind: "nthMeleeHit", every: JOB.brawlerEveryHits }],
        then: { kind: "shockwave", magnitude: JOB.brawlerShockwaveRatio, scaleBy: "slashBase" },
      }),
      jobRule("brawler", 1, `被弾すると ${JOB.brawlerHurtBuffSec} 秒間ダメージ +${JOB.brawlerHurtBuffPct}%。`, {
        when: "onHurt",
        then: { kind: "damageBuff", magnitude: JOB.brawlerHurtBuffPct, duration: JOB.brawlerHurtBuffSec },
      }),
    ],
    starterSkill: "quake",
    starterWeapon: "gauntlets",
    keywords: kw(["melee", "combo", "area"], ["hurt"]),
  },
  shieldBearer: {
    lineage: "earth",
    name: "盾持ち",
    desc: "被弾の直後は無敵になり、カウンターで衝撃波を放つ。",
    attributes: JOB_ATTRIBUTES.shieldBearer,
    dash: "brace",
    mana: [BASE_ATTACK_MANA, { kind: "guardBlock", perDamage: MS.shieldBearer.perDamage }],
    rules: [
      jobRule("shieldBearer", 0, `被弾すると ${JOB.shieldHurtInvulnSec} 秒間無敵（${JOB.shieldHurtIcd} 秒に 1 回）。`, {
        when: "onHurt",
        then: { kind: "invuln", magnitude: JOB.shieldHurtInvulnSec, duration: JOB.shieldHurtInvulnSec },
        icd: JOB.shieldHurtIcd,
      }),
      jobRule("shieldBearer", 1, "カウンターを決めると周りへ衝撃波。", {
        when: "onCounter",
        then: { kind: "shockwave", magnitude: JOB.shieldCounterRatio, scaleBy: "slashBase" },
      }),
    ],
    starterSkill: "parry",
    starterWeapon: "machete",
    keywords: kw(["ward", "counter", "area"], ["hurt"]),
  },
  hexer: {
    lineage: "moon",
    name: "呪術師",
    desc: "状態異常を付けるたびに気力が戻り、倒した敵から毒を広げる。",
    attributes: JOB_ATTRIBUTES.hexer,
    dash: "mist",
    mana: [BASE_ATTACK_MANA, { kind: "statusTick", perSec: MS.hexer.perSec }],
    rules: [
      jobRule("hexer", 0, `敵に状態異常を付けるたびに気力 +${JOB.hexerStatusMana}。`, {
        when: "onStatusApplied",
        if: [{ kind: "actor", actor: "player" }],
        then: { kind: "restoreMana", magnitude: JOB.hexerStatusMana },
        icd: JOB.hexerStatusIcd,
      }),
      jobRule("hexer", 1, "毒の付いた敵を倒すと、周りへ同じ強さの毒が広がる。", {
        when: "onKill",
        if: [{ kind: "targetHas", status: "poison" }],
        then: { kind: "spreadStatus", status: "poison", magnitude: SAME_POTENCY, radius: JOB.hexerSpreadRadius, duration: JOB.hexerSpreadSec },
      }),
    ],
    starterSkill: "contagion",
    starterWeapon: "sickle",
    keywords: kw(["mana", "poison"], ["poison", "kill"]),
    unlockedBy: "bloodPath",
  },
  lancer: {
    lineage: "earth",
    name: "槍兵",
    desc: "堅守中の敵を崩しやすく、怯ませるたびに奥義ゲージが溜まる。",
    attributes: JOB_ATTRIBUTES.lancer,
    dash: "vault",
    mana: [BASE_ATTACK_MANA, { kind: "tipHit", amount: MS.lancer.tipHit }],
    rules: [
      jobRule("lancer", 0, `堅守中の敵に近接を当てると怯み値 ${JOB.lancerGuardPoise} を上乗せする。`, {
        when: "onMeleeHit",
        if: [{ kind: "trigger", condition: "targetGuarded" }],
        then: { kind: "addPoise", magnitude: JOB.lancerGuardPoise },
      }),
      jobRule("lancer", 1, `敵を怯ませると奥義ゲージ +${JOB.lancerStaggerEnergy}。`, {
        when: "onStagger",
        then: { kind: "energy", magnitude: JOB.lancerStaggerEnergy },
      }),
    ],
    starterSkill: "chainHook",
    starterWeapon: "spear",
    keywords: kw(["stagger", "energy"], ["melee"]),
    unlockedBy: "critStorm",
  },
  invoker: {
    lineage: "cycle",
    name: "術士",
    desc: "スキルを使うと攻撃が強まり、気力が少ないときは撃破で気力を取り戻す。",
    attributes: JOB_ATTRIBUTES.invoker,
    dash: "blink",
    mana: [BASE_ATTACK_MANA, { kind: "skillHit", amount: MS.invoker.skillHit }],
    rules: [
      jobRule("invoker", 0, `スキルを使うと ${JOB.invokerCastBuffSec} 秒間ダメージ +${JOB.invokerCastBuffPct}%。`, {
        when: "onSkillCast",
        then: { kind: "damageBuff", magnitude: JOB.invokerCastBuffPct, duration: JOB.invokerCastBuffSec },
      }),
      jobRule("invoker", 1, `気力が少ないときに敵を倒すと気力 +${JOB.invokerLowManaKill}。`, {
        when: "onKill",
        if: [{ kind: "manaLow" }],
        then: { kind: "restoreMana", magnitude: JOB.invokerLowManaKill },
      }),
    ],
    starterSkill: "thunder",
    starterWeapon: "wand",
    keywords: kw(["mana"], ["mana", "kill"]),
    unlockedBy: "chainWeaver",
  },
  shadow: {
    lineage: "blade",
    name: "影",
    desc: "ダッシュ直後の近接で敵を脆弱にし、見切りで移動が速くなる。",
    attributes: JOB_ATTRIBUTES.shadow,
    dash: "shadow",
    mana: [BASE_ATTACK_MANA, { kind: "backstab", amount: MS.shadow.backstab }],
    rules: [
      jobRule("shadow", 0, `ダッシュを終えて ${JOB.shadowAfterDashSec} 秒以内の近接は敵を ${JOB.shadowVulnerableSec} 秒間脆弱にする。`, {
        when: "onMeleeHit",
        if: [{ kind: "recent", event: "onDashEnd", within: JOB.shadowAfterDashSec }],
        then: { kind: "inflict", status: "vulnerable", magnitude: JOB.shadowVulnerableSec },
        icd: JOB.shadowVulnerableIcd,
      }),
      jobRule("shadow", 1, `見切りを決めると ${JOB.shadowJustSpeedSec} 秒間移動速度 +${JOB.shadowJustSpeedPct}%。`, {
        when: "onJustDodge",
        then: { kind: "speedBuff", magnitude: JOB.shadowJustSpeedPct, duration: JOB.shadowJustSpeedSec },
      }),
    ],
    starterSkill: "shadowStep",
    starterWeapon: "twinDaggers",
    keywords: kw(["dash", "vulnerable"], ["dash", "just"]),
    unlockedBy: "justDancer",
  },
  alchemist: {
    lineage: "ash",
    name: "錬金術師",
    desc: "反応を起こすたびに奥義ゲージが溜まり、状態異常が 2 種以上付いた敵は倒すと爆発する。",
    attributes: JOB_ATTRIBUTES.alchemist,
    dash: "flask",
    mana: [BASE_ATTACK_MANA, { kind: "reaction", amount: MS.alchemist.reaction }],
    rules: [
      jobRule("alchemist", 0, `状態異常の反応を起こすと奥義ゲージ +${JOB.alchemistReactionEnergy}。`, {
        when: "onReaction",
        if: [{ kind: "actor", actor: "player" }],
        then: { kind: "energy", magnitude: JOB.alchemistReactionEnergy },
      }),
      jobRule("alchemist", 1, "状態異常が 2 種以上付いた敵を倒すと爆発する。", {
        when: "onKill",
        if: [{ kind: "trigger", condition: "targetMultiStatus" }],
        then: { kind: "explode", magnitude: JOB.alchemistBlastRatio, scaleBy: "slashBase" },
        icd: JOB.alchemistBlastIcd,
      }),
    ],
    starterSkill: "powderKeg",
    starterWeapon: "staff",
    keywords: kw(["reaction", "energy", "explode"], ["reaction", "kill"]),
    unlockedBy: "deepChain",
  },
  onmyoji: {
    lineage: "horde",
    name: "陰陽師",
    desc: "設置物・従魔を敵に当てて気力を得る。ダッシュで自分の設置物と入れ替わり、スキルを当てた敵を弱らせる。",
    attributes: JOB_ATTRIBUTES.onmyoji,
    dash: "swap",
    mana: [BASE_ATTACK_MANA, { kind: "minionHit", amount: MS.onmyoji.minionHit }],
    rules: [
      jobRule("onmyoji", 0, `スキルが敵に当たると ${JOB.onmyojiWeakenSec} 秒間弱体にする。`, {
        when: "onSkillHit",
        // 敵ごとの再付与の間隔は inflict 自身が持つ（規則の ICD だと範囲の命中で 1 体にしか付かない）
        then: { kind: "inflict", status: "weaken", magnitude: JOB.onmyojiWeakenSec },
      }),
      jobRule("onmyoji", 1, `弱体の敵を倒すと奥義ゲージ +${JOB.onmyojiKillEnergy}。`, {
        when: "onKill",
        if: [{ kind: "targetHas", status: "weaken" }],
        then: { kind: "energy", magnitude: JOB.onmyojiKillEnergy },
      }),
    ],
    starterSkill: "mines",
    starterWeapon: "ironFan",
    keywords: kw(["placed", "weaken", "energy"], ["kill"]),
  },
  miko: {
    name: "巫女",
    desc: "祝福の加護が発動するたびに気力が湧く。ダッシュの着地に結界を張り、被弾を祓う。",
    attributes: JOB_ATTRIBUTES.miko,
    dash: "ward",
    mana: [BASE_ATTACK_MANA, { kind: "boonFired", amount: MS.miko.boonFired }],
    rules: [
      jobRule("miko", 0, `被弾すると状態異常を 1 つ祓う（${JOB.mikoHurtIcd} 秒に 1 回）。`, {
        when: "onHurt",
        then: { kind: "cleanse", magnitude: 1 },
        icd: JOB.mikoHurtIcd,
      }),
      jobRule("miko", 1, `部屋を制圧すると最大生命の ${Math.round(JOB.mikoClearHealRatio * PERCENT)}% を回復する。`, {
        when: "onRoomClear",
        then: { kind: "healDirect", magnitude: JOB.mikoClearHealRatio, scaleBy: "maxHp" },
      }),
    ],
    starterSkill: "manaSpring",
    starterWeapon: "wand",
    keywords: kw(["ward", "heal"], ["hurt", "clear"]),
  },
};

export function isJobKey(v: unknown): v is JobKey {
  return typeof v === "string" && (JOB_KEYS as readonly string[]).includes(v);
}

/** 保存データから読む。未知の値は見習いへ落とす */
export function sanitizeJob(v: unknown): JobKey {
  return isJobKey(v) ? v : "none";
}

/** ジョブ固有の派生の入力（左左左右）。武器種の派生（多くは 2〜3 手）と重ならない 4 手にする */
export const JOB_BRANCH_SEQUENCE: readonly ButtonKey[] = ["primary", "primary", "primary", "secondary"];

/** ジョブ固有の派生の表示名（数値は tuning の WEAPON.jobBranches） */
const JOB_BRANCH_NAMES: Readonly<Record<Exclude<JobKey, "none">, string>> = {
  swordsman: "残月",
  hunter: "射抜き",
  brawler: "猛連打",
  shieldBearer: "盾殴り",
  hexer: "呪い刃",
  lancer: "穂先返し",
  invoker: "魔力放出",
  shadow: "影縫い",
  alchemist: "反応刃",
  onmyoji: "式打ち",
  miko: "祓い斬り",
};

/**
 * ジョブ固有の派生（docs/ideas/combat-feel-design.md B-3）。どの武器種にも 1 本足される（system/player.ts の playerMoveset）。
 * フィニッシュ（next なし）。見習いは持たない
 */
export const JOB_BRANCHES: Readonly<Record<Exclude<JobKey, "none">, BranchDef>> = {
  swordsman: jobBranchDef("swordsman"),
  hunter: jobBranchDef("hunter"),
  brawler: jobBranchDef("brawler"),
  shieldBearer: jobBranchDef("shieldBearer"),
  hexer: jobBranchDef("hexer"),
  lancer: jobBranchDef("lancer"),
  invoker: jobBranchDef("invoker"),
  shadow: jobBranchDef("shadow"),
  alchemist: jobBranchDef("alchemist"),
  onmyoji: jobBranchDef("onmyoji"),
  miko: jobBranchDef("miko"),
};

function jobBranchDef(job: Exclude<JobKey, "none">): BranchDef {
  return { key: `job.${job}`, name: JOB_BRANCH_NAMES[job], sequence: JOB_BRANCH_SEQUENCE, step: reviveStep(WEAPON.jobBranches[job]) };
}

/** そのジョブの固有の派生（見習いは undefined） */
export function jobBranch(job: JobKey): BranchDef | undefined {
  return job === "none" ? undefined : JOB_BRANCHES[job];
}

/**
 * 旧「得意な武器」（段取り 5c で流儀から外した。ジョブの倍率はもう無く、起点画面にも出さない）。
 * 得意武器を読む性質・誓約・祝福・刻印符（system/jobs.ts の isFavoredWeapon・favoredWeapon 条件・心得・変身の持続）を
 * 段取り 7 で整理するまでの橋渡し。ここを消すときはそれらを先に外す
 */
const LEGACY_FAVORED: Readonly<Record<JobKey, readonly MovesetKey[]>> = {
  none: [],
  swordsman: ["sword", "greatsword", "katana"],
  hunter: ["longarm", "thrown", "whip"],
  brawler: ["fists", "cleaver", "staff"],
  shieldBearer: ["sword", "cleaver", "staff"],
  hexer: ["scythe", "wand"],
  lancer: ["spear", "scythe"],
  invoker: ["wand", "whip"],
  shadow: ["twinBlades", "fists"],
  alchemist: ["staff", "cleaver"],
  onmyoji: ["fan", "wand"],
  miko: ["wand", "staff"],
};

/** 旧「得意な武器」の武器種（見習いは空） */
export function favoredMovesets(job: JobKey): readonly MovesetKey[] {
  return LEGACY_FAVORED[job];
}
