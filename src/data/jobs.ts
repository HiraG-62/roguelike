import type { EventKind, EventSource } from "../core/events";
import { type KeywordProfile, kw } from "../core/keywords";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { Attributes, PlayerStats } from "../loot/types";
import type { QuestKey } from "../meta/quests";
import type { SkillKey } from "../skills/types";
import { JOB, WEAPON } from "./tuning";
import type { BranchDef, ButtonKey, MovesetKey } from "./weapons";

/**
 * ジョブ（docs/COMBAT_DESIGN.md A-9）。起点とは別の軸で、ラン開始時に 1 つ選ぶ。
 * ジョブはステータスの偏り・得意な武器種・固有のルール 2 つ・初期スキル石・弱点を持つ。
 * 数値は src/data/tuning.ts の JOB、畳み込みと開始時の処理は src/system/jobs.ts
 */

export const JOB_KEYS = ["none", "swordsman", "hunter", "brawler", "shieldBearer", "hexer", "lancer", "invoker", "shadow", "alchemist"] as const;
export type JobKey = (typeof JOB_KEYS)[number];

/** 弱点・得意で掛ける倍率の対象（いずれも掛け算で効く数値） */
export type JobMulStat = "maxHp" | "meleeDamageMul" | "rangedDamageMul" | "moveSpeedMul" | "attackSpeedMul" | "dashCooldownMul";
export type JobStatMul = Partial<Record<JobMulStat, number>>;

export interface JobRuleDef {
  /** 何ができるかの 1 文（起点画面の説明） */
  text: string;
  rule: Rule;
}

export interface JobWeakness {
  text: string;
  mul: JobStatMul;
}

export interface JobDef {
  name: string;
  /** どう戦うジョブかの 1 行 */
  desc: string;
  /** 基礎値（各 5）に足す偏り。合計は 0（どれかを伸ばせばどれかが下がる） */
  attributes: Partial<Attributes>;
  /** この武器種を持つ間、近接の威力と攻撃速度が上がる（JOB.favoredMeleeMul / favoredAttackSpeedMul） */
  favored: readonly MovesetKey[];
  rules: readonly JobRuleDef[];
  /** 開始時に足元へ置くスキル石 */
  starterSkill: SkillKey | null;
  /** 開始時に渡す素の武器（src/loot/bases.ts の BASES の key）。得意な武器種の器。剣は武器なしで振れるので剣士は打刀 */
  starterWeapon: string | null;
  /** トレードオフ。単一最強を作らない */
  weakness: JobWeakness | null;
  keywords: KeywordProfile;
  /** この依頼を達成すると選べる（src/meta/quests.ts）。無ければ最初から選べる */
  unlockedBy?: QuestKey;
}

const ALWAYS = 1;
const NO_ICD = 0;
const PERCENT = 100;
/** 広げる状態異常の強さの倍率（元と同じ） */
const SAME_POTENCY = 1;

/** 倍率が 1 からどれだけ離れているか（%）。0.85 → 15、1.15 → 15。説明文の数値を tuning から作る */
function lessPct(mul: number): number {
  return Math.round(Math.abs(1 - mul) * PERCENT);
}

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
    desc: "ジョブを持たずに潜る。何も足さず、何も引かない。",
    attributes: {},
    favored: [],
    rules: [],
    starterSkill: null,
    starterWeapon: null,
    weakness: null,
    keywords: kw([]),
  },
  swordsman: {
    name: "剣士",
    desc: "連撃を締めくくる終撃で敵を崩し、見切りから斬り返す。",
    attributes: { str: 2, vit: 1, mnd: -1, spi: -2 },
    favored: ["sword", "greatsword", "katana"],
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
    weakness: { text: `射撃の威力が ${lessPct(JOB.swordsmanRangedMul)}% 落ちる。`, mul: { rangedDamageMul: JOB.swordsmanRangedMul } },
    keywords: kw(["melee", "finisher", "stagger"], ["just"]),
  },
  hunter: {
    name: "狩人",
    desc: "予備動作を射抜いて止め、精鋭に弱みを刻む。",
    attributes: { dex: 3, mnd: 1, str: -2, vit: -2 },
    favored: ["longarm", "thrown", "whip"],
    rules: [
      jobRule("hunter", 0, `予備動作中の敵を射撃で撃つと怯み値 ${JOB.hunterWindupPoise} を上乗せする。`, {
        when: "onRangedHit",
        if: [{ kind: "trigger", condition: "targetInWindup" }],
        then: { kind: "addPoise", magnitude: JOB.hunterWindupPoise },
      }),
      jobRule("hunter", 1, `精鋭を射撃で撃つと ${JOB.hunterVulnerableSec} 秒間脆弱にする。`, {
        when: "onRangedHit",
        if: [{ kind: "trigger", condition: "targetElite" }],
        then: { kind: "inflict", status: "vulnerable", magnitude: JOB.hunterVulnerableSec },
        icd: JOB.hunterEliteIcd,
      }),
    ],
    starterSkill: "railshot",
    starterWeapon: "crossbow",
    weakness: { text: `最大生命が ${lessPct(JOB.hunterHpMul)}% 減る。`, mul: { maxHp: JOB.hunterHpMul } },
    keywords: kw(["ranged", "stagger", "vulnerable"], ["elite"]),
  },
  brawler: {
    name: "拳闘士",
    desc: "殴り続けるほど衝撃波が出る。殴られると燃え上がる。",
    attributes: { str: 2, vit: 2, dex: -1, spi: -3 },
    favored: ["fists", "cleaver", "staff"],
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
    weakness: { text: `射撃の威力が ${lessPct(JOB.brawlerRangedMul)}% 落ちる。`, mul: { rangedDamageMul: JOB.brawlerRangedMul } },
    keywords: kw(["melee", "combo", "area"], ["hurt"]),
  },
  shieldBearer: {
    name: "盾持ち",
    desc: "被弾の直後に身を固め、カウンターで押し返す。",
    attributes: { vit: 3, str: 1, dex: -2, spi: -2 },
    favored: ["sword", "cleaver", "staff"],
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
    weakness: { text: `移動速度が ${lessPct(JOB.shieldMoveMul)}% 落ちる。`, mul: { moveSpeedMul: JOB.shieldMoveMul } },
    keywords: kw(["ward", "counter", "area"], ["hurt"]),
  },
  hexer: {
    name: "呪術師",
    desc: "状態異常を付けるたびに気力が満ち、毒を死体から広げる。",
    attributes: { spi: 3, mnd: 1, str: -2, vit: -2 },
    favored: ["scythe", "wand"],
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
    weakness: { text: `近接の威力が ${lessPct(JOB.hexerMeleeMul)}% 落ちる。`, mul: { meleeDamageMul: JOB.hexerMeleeMul } },
    keywords: kw(["mana", "poison"], ["poison", "kill"]),
    unlockedBy: "bloodPath",
  },
  lancer: {
    name: "槍兵",
    desc: "堅守を突き崩し、怯ませるたびに必殺ゲージを溜める。",
    attributes: { dex: 2, str: 1, mnd: -1, spi: -2 },
    favored: ["spear", "scythe"],
    rules: [
      jobRule("lancer", 0, `堅守中の敵に近接を当てると怯み値 ${JOB.lancerGuardPoise} を上乗せする。`, {
        when: "onMeleeHit",
        if: [{ kind: "trigger", condition: "targetGuarded" }],
        then: { kind: "addPoise", magnitude: JOB.lancerGuardPoise },
      }),
      jobRule("lancer", 1, `敵を怯ませると必殺ゲージ +${JOB.lancerStaggerEnergy}。`, {
        when: "onStagger",
        then: { kind: "energy", magnitude: JOB.lancerStaggerEnergy },
      }),
    ],
    starterSkill: "chainHook",
    starterWeapon: "spear",
    weakness: { text: `ダッシュの再使用時間が ${lessPct(JOB.lancerDashCdMul)}% 延びる。`, mul: { dashCooldownMul: JOB.lancerDashCdMul } },
    keywords: kw(["stagger", "energy"], ["melee"]),
    unlockedBy: "critStorm",
  },
  invoker: {
    name: "術士",
    desc: "スキルを撃つと続く攻撃が強まり、枯れた気力を撃破で取り戻す。",
    attributes: { mnd: 2, spi: 2, str: -2, vit: -2 },
    favored: ["wand", "whip"],
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
    weakness: { text: `最大生命が ${lessPct(JOB.invokerHpMul)}% 減る。`, mul: { maxHp: JOB.invokerHpMul } },
    keywords: kw(["mana"], ["mana", "kill"]),
    unlockedBy: "chainWeaver",
  },
  shadow: {
    name: "影",
    desc: "ダッシュで回り込んだ直後の一撃が急所を突く。見切りで駆け抜ける。",
    attributes: { dex: 3, spi: 1, str: -2, vit: -2 },
    favored: ["twinBlades", "fists"],
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
    weakness: { text: `最大生命が ${lessPct(JOB.shadowHpMul)}% 減る。`, mul: { maxHp: JOB.shadowHpMul } },
    keywords: kw(["dash", "vulnerable"], ["dash", "just"]),
    unlockedBy: "justDancer",
  },
  alchemist: {
    name: "錬金術師",
    desc: "反応を起こすたびに必殺ゲージが溜まり、状態異常の重なった敵は倒すと爆ぜる。",
    attributes: { mnd: 2, spi: 1, vit: 1, str: -2, dex: -2 },
    favored: ["staff", "cleaver"],
    rules: [
      jobRule("alchemist", 0, `状態異常の反応を起こすと必殺ゲージ +${JOB.alchemistReactionEnergy}。`, {
        when: "onReaction",
        if: [{ kind: "actor", actor: "player" }],
        then: { kind: "energy", magnitude: JOB.alchemistReactionEnergy },
      }),
      jobRule("alchemist", 1, "状態異常を 2 種以上抱えた敵を倒すと爆発する。", {
        when: "onKill",
        if: [{ kind: "trigger", condition: "targetMultiStatus" }],
        then: { kind: "explode", magnitude: JOB.alchemistBlastRatio, scaleBy: "slashBase" },
        icd: JOB.alchemistBlastIcd,
      }),
    ],
    starterSkill: "powderKeg",
    starterWeapon: "staff",
    weakness: { text: `攻撃速度が ${lessPct(JOB.alchemistAttackSpeedMul)}% 落ちる。`, mul: { attackSpeedMul: JOB.alchemistAttackSpeedMul } },
    keywords: kw(["reaction", "energy", "explode"], ["reaction", "kill"]),
    unlockedBy: "deepChain",
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
};

function jobBranchDef(job: Exclude<JobKey, "none">): BranchDef {
  return { key: `job.${job}`, name: JOB_BRANCH_NAMES[job], sequence: JOB_BRANCH_SEQUENCE, step: WEAPON.jobBranches[job] };
}

/** そのジョブの固有の派生（見習いは undefined） */
export function jobBranch(job: JobKey): BranchDef | undefined {
  return job === "none" ? undefined : JOB_BRANCHES[job];
}

/** 倍率を掛ける（PlayerStats の該当フィールドだけ。書き換えるのは渡した stats） */
export function applyJobMul(stats: PlayerStats, mul: Readonly<JobStatMul>): void {
  for (const [key, value] of Object.entries(mul) as [JobMulStat, number | undefined][]) {
    if (value !== undefined) stats[key] *= value;
  }
}
