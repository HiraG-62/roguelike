/**
 * 財宝の札（docs/ideas/boon-impl.md 2-6、docs/ideas/economy-core.md 9-2。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）。
 * 軸は銭。持つ（守銭・黄金律）/ 使う（投銭・銭払い・散財・散）/ 稼ぐ（銭吐き・掏り・拾銭・稼）の張力を 1 系譜に置く
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_WEALTH = [
  "coinSpit",
  "coinToss",
  "pickpocket",
  "coinPay",
  "squander",
  "miser",
  "coinGleaner",
  "changeBack",
  "earnTally",
  "spendTally",
  "goldenRule",
] as const;

type WealthKey = (typeof BOON_KEYS_WEALTH)[number];

const W = BOON_LINEAGE.wealth;

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

const ALWAYS = 1;
const PERCENT = 100;
/** 散財で払う割合（持ち金の全部） */
const ALL_COINS = 1;
const PRIMARY: RuleCondition = { kind: "lane", lane: "primary" };
const HAS_COINS: RuleCondition = { kind: "coinsAtLeast", amount: 1 };

/** 確定発動の Rule。ICD は BOON.ruleMinIcd を下限にする */
function rulesOf(key: WealthKey, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: Math.max(BOON.ruleMinIcd, s.icd ?? 0),
    scope: SCOPE_ANY,
    owner,
  }));
}

function modifiersOf(key: WealthKey, specs: readonly Pick<Modifier, "kind" | "tag" | "amount" | "per">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), if: [], owner }));
}

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

export const BOONS_WEALTH: Readonly<Record<WealthKey, BoonDef>> = {
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  coinSpit: {
    key: "coinSpit",
    name: "銭吐き",
    desc: `左の通常攻撃が当たると銭+${W.coinSpit.coins}（${W.coinSpit.icd}秒に1回）。`,
    icon: "吐",
    tags: ["loot", "melee"],
    keywords: kw([], ["melee"]),
    cursed: false,
    lineage: "wealth",
    card: "grace",
    action: "primary",
    changes: "watch",
    rules: rulesOf("coinSpit", [{ when: "onSwingHit", if: [PRIMARY], then: { kind: "gainCoins", magnitude: W.coinSpit.coins }, icd: W.coinSpit.icd }]),
  },
  coinToss: {
    key: "coinToss",
    name: "投銭",
    desc: `戦意を使うと、持ち金の${pct(W.coinToss.share)}%を銭の弾にして照準へ投げる（銭1につき${W.coinToss.perCoin}ダメージ）。`,
    icon: "投",
    tags: ["loot", "ranged"],
    keywords: kw(["bullet"]),
    cursed: false,
    lineage: "wealth",
    card: "grace",
    action: "secondary",
    changes: "press",
    rules: rulesOf("coinToss", [
      { when: "onRelease", then: { kind: "coinShot", magnitude: W.coinToss.perCoin, share: W.coinToss.share }, icd: W.coinToss.icd },
    ]),
  },
  pickpocket: {
    key: "pickpocket",
    name: "掏り",
    desc: `ダッシュを終えると、周りの敵1体につき銭+${W.pickpocket.coins}（${W.pickpocket.icd}秒に1回）。`,
    icon: "掏",
    tags: ["loot", "dash"],
    keywords: kw([], ["dash"]),
    cursed: false,
    lineage: "wealth",
    card: "grace",
    action: "dash",
    changes: "position",
    // 設計の「通り抜けた敵から」は通過の判定が無いので、ダッシュの終わりの周りの敵で近似する
    rules: rulesOf("pickpocket", [
      {
        when: "onDashEnd",
        then: { kind: "gainCoins", magnitude: W.pickpocket.coins, scaleBy: "counter", counter: { kind: "nearbyEnemies", radius: W.pickpocket.radius } },
        icd: W.pickpocket.icd,
      },
    ]),
  },
  coinPay: {
    key: "coinPay",
    name: "銭払い",
    desc: `スキルを撃つたび、銭を${W.coinPay.cost}払って気力を${W.coinPay.mana}取り戻す（銭が足りなければ払わない）。`,
    icon: "払",
    tags: ["loot", "mana", "skill"],
    keywords: kw(["mana"], [], ["mana"]),
    cursed: false,
    lineage: "wealth",
    card: "grace",
    action: "skill",
    changes: "press",
    // 払う額と戻す量の釣り合いを崩さないよう格は持たない（払う額に格が掛かると払えずに戻るだけになる）
    graded: false,
    // 設計の刻印符「銭払い」（気力の代わりに銭）はまだ無いので、撃った後に銭で気力を買い戻す形で書く。戻す → 払うの順
    rules: rulesOf("coinPay", [
      {
        when: "onSkillCast",
        if: [{ kind: "coinsAtLeast", amount: W.coinPay.cost }],
        then: { kind: "restoreMana", magnitude: W.coinPay.mana, quiet: true },
        icd: W.coinPay.icd,
      },
      { when: "onSkillCast", if: [{ kind: "coinsAtLeast", amount: W.coinPay.cost }], then: { kind: "spendCoins", magnitude: W.coinPay.cost }, icd: W.coinPay.icd },
    ]),
  },
  squander: {
    key: "squander",
    name: "散財",
    desc: `奥義を放つと持ち金を全て払い、周りに払った額に比例した爆発を起こす（銭1につき${W.squander.perCoin}ダメージ）。`,
    icon: "散",
    tags: ["loot", "explode", "energy"],
    keywords: kw(["explode"], ["energy"]),
    gives: ["explode"],
    cursed: false,
    lineage: "wealth",
    card: "grace",
    action: "ultimate",
    changes: "press",
    // 威力は持ち金で伸びる。払う量に格が掛かると払えずに撃つだけになるので格は持たない
    graded: false,
    // 払う前の額で撃つため、爆発を先に並べる
    rules: rulesOf("squander", [
      {
        when: "onBurst",
        if: [HAS_COINS],
        then: { kind: "explode", magnitude: W.squander.perCoin, scaleBy: "coins", radius: W.squander.radius },
      },
      { when: "onBurst", if: [HAS_COINS], then: { kind: "spendCoins", magnitude: ALL_COINS, scaleBy: "coins" } },
    ]),
  },
  // ---- 摂理 ----
  miser: {
    key: "miser",
    name: "守銭",
    desc: `持ち金${W.miser.every}につき与ダメージ+${pct(W.miser.perStep)}%（最大+${pct(W.miser.cap)}%）。`,
    icon: "銭",
    tags: ["loot"],
    keywords: kw([], [], ["melee", "ranged"]),
    cursed: false,
    lineage: "wealth",
    card: "law",
    changes: "watch",
    modifiers: modifiersOf("miser", [
      { kind: "increased", tag: "all", amount: W.miser.perStep, per: { count: { kind: "coins" }, every: W.miser.every, cap: W.miser.cap } },
    ]),
  },
  coinGleaner: {
    key: "coinGleaner",
    name: "拾銭",
    desc: `銭を拾うたび${W.coinGleaner.time}秒間、移動速度+${W.coinGleaner.pct}%。`,
    icon: "拾",
    tags: ["loot", "dash"],
    keywords: kw([], [], ["dash"]),
    cursed: false,
    lineage: "wealth",
    card: "law",
    changes: "position",
    rules: rulesOf("coinGleaner", [
      { when: "onCoinPickup", then: { kind: "speedBuff", magnitude: W.coinGleaner.pct, duration: W.coinGleaner.time }, icd: W.coinGleaner.icd },
    ]),
  },
  changeBack: {
    key: "changeBack",
    name: "戻り銭",
    desc: `被弾でこぼれた銭の${pct(W.changeBack.ratio)}%が、すぐ自分の懐へ戻る。`,
    icon: "釣",
    tags: ["loot", "hp"],
    keywords: kw([], ["hurt"]),
    cursed: false,
    lineage: "wealth",
    card: "law",
    changes: "watch",
    // 戻る割合に格が掛かると被弾で銭が増えるので格は持たない
    graded: false,
    rules: rulesOf("changeBack", [{ when: "onCoinSpill", then: { kind: "gainCoins", magnitude: W.changeBack.ratio, scaleBy: "eventAmount" } }]),
  },
  // ---- 研鑽（数えは経済の記録 coinsEarned / coinsSpent。どちらもプレイヤーが稼ぎ・払った総額） ----
  earnTally: {
    key: "earnTally",
    name: "蓄財",
    desc: `このランで稼いだ銭${W.earnTally.every}につき与ダメージ+${pct(W.earnTally.amount)}%（上限なし）。`,
    icon: "儲",
    tags: ["loot"],
    keywords: kw([], [], ["melee", "ranged"]),
    cursed: false,
    lineage: "wealth",
    card: "temper",
    changes: "watch",
    modifiers: modifiersOf("earnTally", [
      { kind: "increased", tag: "all", amount: W.earnTally.amount, per: { count: { kind: "coinsEarned" }, every: W.earnTally.every } },
    ]),
  },
  spendTally: {
    key: "spendTally",
    name: "浪費",
    desc: `このランで使った銭${W.spendTally.every}につき与ダメージ×${1 + W.spendTally.amount}（上限なし）。`,
    icon: "費",
    tags: ["loot"],
    keywords: kw([], [], ["melee", "ranged"]),
    cursed: false,
    lineage: "wealth",
    card: "temper",
    changes: "watch",
    modifiers: modifiersOf("spendTally", [
      { kind: "more", tag: "all", amount: W.spendTally.amount, per: { count: { kind: "coinsSpent" }, every: W.spendTally.every } },
    ]),
  },
  // ---- 真髄 ----
  goldenRule: {
    key: "goldenRule",
    name: "黄金律",
    desc:
      `持ち金が${W.goldenRule.base}を超えると与ダメージ×${1 + W.goldenRule.amount}、以後2倍を超えるたび+${W.goldenRule.amount}。` +
      "代わりに被弾でこぼれる銭がおよそ倍になる。",
    icon: "金",
    tags: ["loot"],
    keywords: kw([], ["hurt"], ["melee", "ranged"]),
    cursed: false,
    lineage: "wealth",
    card: "apex",
    changes: "watch",
    // 代償の撒く量に格が掛かると格が上がるほど損をするので格は持たない
    graded: false,
    modifiers: modifiersOf("goldenRule", [
      { kind: "more", tag: "all", amount: W.goldenRule.amount, per: { count: { kind: "coinsLog", base: W.goldenRule.base } } },
    ]),
    rules: rulesOf("goldenRule", [{ when: "onCoinSpill", then: { kind: "scatterCoins", magnitude: W.goldenRule.spillShare } }]),
  },
};
