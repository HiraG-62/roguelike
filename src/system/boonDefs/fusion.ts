/**
 * 融合の札（docs/ideas/boon-impl.md 2-4・2-6 末尾。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）。
 * 融合は系譜を持たず fusion の 2 系譜のどちらにも数える。枠を取らない（card は摂理扱い）。
 * 結びの中身を写したもの（雷爆走 thunderBlast / 冬籠り winterNest / 明鏡 clearMirror）は旧 key のまま
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import type { StatusKind } from "../../core/status";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_FUSION = [
  "thunderBlast",
  "chainHerd",
  "counterSlam",
  "shadowHorde",
  "bindExecuted",
  "winterNest",
  "bulwark",
  "galeStrike",
  "reactionChain",
  "clearMirror",
  "lavishBlade",
  "bribe",
] as const;

type FusionKey = (typeof BOON_KEYS_FUSION)[number];

const F = BOON_LINEAGE.fusion;

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

const ALWAYS = 1;
const NO_AMOUNT = 0;
const PERCENT = 100;
const BY_PLAYER: RuleCondition = { kind: "actor", actor: "player" };

/** 確定発動の Rule。ICD は BOON.ruleMinIcd を下限にする */
function rulesOf(key: FusionKey, specs: readonly RuleSpec[]): Rule[] {
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

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

function targetHas(status: StatusKind): RuleCondition {
  return { kind: "targetHas", status };
}

export const BOONS_FUSION: Readonly<Record<FusionKey, BoonDef>> = {
  thunderBlast: {
    key: "thunderBlast",
    name: "雷火",
    desc: `燃えている敵を倒すと、そこから連鎖雷が走る（近接1段目の威力の${pct(F.thunderBlast.ratio)}%）。`,
    icon: "轟",
    tags: ["burn", "shock"],
    keywords: kw(["shock"], ["burn", "kill"]),
    gives: ["shock"],
    cursed: false,
    fusion: ["ash", "thunder"],
    card: "law",
    changes: "target",
    rules: rulesOf("thunderBlast", [
      {
        when: "onKill",
        if: [targetHas("burn")],
        then: { kind: "chainLightning", magnitude: F.thunderBlast.ratio, scaleBy: "slashBase", statFloor: "shockDamage" },
        icd: F.thunderBlast.icd,
      },
    ]),
  },
  chainHerd: {
    key: "chainHerd",
    name: "鎖牧",
    desc: `宣告の付いた敵を倒すと、周りの敵が${F.chainHerd.duration}秒間従う（同時に${F.chainHerd.count}体まで）。`,
    icon: "牧",
    tags: ["placed"],
    keywords: kw(["placed"], ["kill"]),
    gives: ["placed"],
    cursed: false,
    fusion: ["moon", "horde"],
    card: "law",
    changes: "target",
    graded: true,
    rules: rulesOf("chainHerd", [
      {
        when: "onKill",
        if: [targetHas("doom")],
        then: { kind: "tameEnemy", magnitude: NO_AMOUNT, radius: F.chainHerd.radius, count: F.chainHerd.count, duration: F.chainHerd.duration },
      },
    ]),
  },
  counterSlam: {
    key: "counterSlam",
    name: "返し打ち",
    desc: `応手から${F.counterSlam.window}秒以内の通常攻撃の命中に、怯み値+${F.counterSlam.poise}と追撃（近接1段目の威力の${pct(F.counterSlam.ratio)}%）が乗る。`,
    icon: "返",
    tags: ["stagger", "counter", "melee"],
    keywords: kw(["stagger"], ["counter"]),
    gives: ["stagger"],
    cursed: false,
    fusion: ["blade", "earth"],
    card: "law",
    changes: "timing",
    // 応手 1 回に 1 度（窓と同じ ICD）。設計の「壁叩きつけ確定」は吹き飛びの分岐が要るので、怯み値と追撃で近似する
    rules: rulesOf("counterSlam", [
      {
        when: "onSwingHit",
        if: [{ kind: "recent", event: "onRiposte", within: F.counterSlam.window }],
        then: { kind: "addPoise", magnitude: F.counterSlam.poise },
        icd: F.counterSlam.window,
      },
      {
        when: "onSwingHit",
        if: [{ kind: "recent", event: "onRiposte", within: F.counterSlam.window }],
        then: { kind: "strike", magnitude: F.counterSlam.ratio, scaleBy: "slashBase" },
        icd: F.counterSlam.window,
      },
    ]),
  },
  shadowHorde: {
    key: "shadowHorde",
    name: "影群",
    desc: `コンボ${F.shadowHorde.combo}以上の終撃を当てた敵を${F.shadowHorde.duration}秒間従える（同時に${F.shadowHorde.count}体まで、${F.shadowHorde.icd}秒に1回）。`,
    icon: "蔭",
    tags: ["combo", "placed"],
    keywords: kw(["placed"], ["combo", "finisher"]),
    gives: ["placed"],
    cursed: false,
    fusion: ["blade", "horde"],
    card: "law",
    changes: "target",
    rules: rulesOf("shadowHorde", [
      {
        when: "onFinisher",
        if: [{ kind: "comboAbove", count: F.shadowHorde.combo }],
        then: { kind: "tameEnemy", magnitude: NO_AMOUNT, count: F.shadowHorde.count, duration: F.shadowHorde.duration },
        icd: F.shadowHorde.icd,
      },
    ]),
  },
  bindExecuted: {
    key: "bindExecuted",
    name: "使役",
    desc: `処刑すると、周りの怯んだ敵が${F.bindExecuted.duration}秒間従う（同時に${F.bindExecuted.count}体まで）。`,
    icon: "役",
    tags: ["stagger", "placed"],
    keywords: kw(["placed"], ["stagger", "kill"]),
    gives: ["placed"],
    cursed: false,
    fusion: ["earth", "horde"],
    card: "law",
    changes: "target",
    graded: true,
    // 処刑した敵はもういないので、処刑の場の怯んだ敵を従える
    rules: rulesOf("bindExecuted", [
      {
        when: "onExecute",
        then: {
          kind: "tameEnemy",
          magnitude: NO_AMOUNT,
          radius: F.bindExecuted.radius,
          onlyWith: "stagger",
          count: F.bindExecuted.count,
          duration: F.bindExecuted.duration,
        },
      },
    ]),
  },
  winterNest: {
    key: "winterNest",
    name: "玻璃",
    desc: `冷えた敵に会心を当てると${F.winterNest.duration}秒凍らせる（次の一撃で砕ける。${F.winterNest.icd}秒に1回）。`,
    icon: "玻",
    tags: ["crit", "chill", "freeze"],
    keywords: kw(["chill"], ["crit", "chill"]),
    gives: ["freeze"],
    cursed: false,
    fusion: ["thunder", "frost"],
    card: "law",
    changes: "target",
    rules: rulesOf("winterNest", [
      {
        when: "onCrit",
        if: [targetHas("chill")],
        then: { kind: "afflict", status: "freeze", magnitude: NO_AMOUNT, duration: F.winterNest.duration },
        icd: F.winterNest.icd,
      },
    ]),
  },
  bulwark: {
    key: "bulwark",
    name: "磐石",
    desc: `被弾から${F.bulwark.window}秒以内に敵を壁へ叩きつけると、最大生命の${pct(F.bulwark.hpRatio)}%の追撃を返す。`,
    icon: "磐",
    tags: ["stagger", "hp"],
    keywords: kw([], ["hurt", "wall"]),
    cursed: false,
    fusion: ["earth", "moon"],
    card: "law",
    changes: "timing",
    // 設計の「受けたダメージを溜めて返す」は被ダメージの溜め（Player.deferredDamage）が要るので、最大生命の割合で近似する
    rules: rulesOf("bulwark", [
      {
        when: "onWallSlam",
        if: [{ kind: "recent", event: "onHurt", within: F.bulwark.window }],
        then: { kind: "strike", magnitude: F.bulwark.hpRatio, scaleBy: "maxHp" },
      },
    ]),
  },
  galeStrike: {
    key: "galeStrike",
    name: "迅雷",
    desc: `コンボ${F.galeStrike.combo}以上でダッシュを終えると、足元から連鎖雷が走る（近接1段目の威力の${pct(F.galeStrike.ratio)}%）。`,
    icon: "迅",
    tags: ["dash", "combo", "shock"],
    keywords: kw(["shock"], ["dash", "combo"]),
    gives: ["shock"],
    cursed: false,
    fusion: ["thunder", "blade"],
    card: "law",
    changes: "timing",
    rules: rulesOf("galeStrike", [
      {
        when: "onDashEnd",
        if: [{ kind: "comboAbove", count: F.galeStrike.combo }],
        then: { kind: "chainLightning", magnitude: F.galeStrike.ratio, scaleBy: "slashBase", statFloor: "shockDamage" },
        icd: F.galeStrike.icd,
      },
    ]),
  },
  reactionChain: {
    key: "reactionChain",
    name: "寒熱",
    desc: `反応を起こすと、その周りの敵に燃焼と冷気を付ける（次の反応を呼ぶ。${F.reactionChain.icd}秒に1回）。`,
    icon: "寒",
    tags: ["burn", "chill", "element"],
    keywords: kw(["burn", "chill"], ["reaction"]),
    gives: ["burn", "chill"],
    cursed: false,
    fusion: ["ash", "frost"],
    card: "law",
    changes: "watch",
    rules: rulesOf("reactionChain", [
      {
        when: "onReaction",
        if: [BY_PLAYER],
        then: { kind: "nearbyEnemies", status: "burn", magnitude: F.reactionChain.burn, duration: F.reactionChain.duration, radius: F.reactionChain.radius },
        icd: F.reactionChain.icd,
      },
      {
        when: "onReaction",
        if: [BY_PLAYER],
        then: { kind: "nearbyEnemies", status: "chill", magnitude: F.reactionChain.chill, duration: F.reactionChain.duration, radius: F.reactionChain.radius },
        icd: F.reactionChain.icd,
      },
    ]),
  },
  clearMirror: {
    key: "clearMirror",
    name: "両替",
    desc: `銭を拾うたび、拾った額×${F.clearMirror.manaPerCoin}の気力が戻る。`,
    icon: "両",
    tags: ["loot", "mana"],
    keywords: kw(["mana"]),
    gives: ["mana"],
    cursed: false,
    fusion: ["cycle", "wealth"],
    card: "law",
    changes: "watch",
    rules: rulesOf("clearMirror", [
      { when: "onCoinPickup", then: { kind: "restoreMana", magnitude: F.clearMirror.manaPerCoin, scaleBy: "eventAmount", quiet: true } },
    ]),
  },
  lavishBlade: {
    key: "lavishBlade",
    name: "豪遊",
    desc:
      `終撃を当てるたび銭+${F.lavishBlade.coins}。銭が${F.lavishBlade.cost}以上あれば、先に${F.lavishBlade.cost}を払って照準へ銭の弾を投げる` +
      `（銭1につき${F.lavishBlade.perCoin}ダメージ）。`,
    icon: "豪",
    tags: ["loot", "combo", "melee"],
    keywords: kw(["bullet"], ["finisher"]),
    cursed: false,
    fusion: ["wealth", "blade"],
    card: "law",
    changes: "press",
    // 払う → 得るの順（前の終撃で得た銭を次の終撃で払う）。弾は払えなければ出ない（coinShot は不発）
    rules: rulesOf("lavishBlade", [
      {
        when: "onFinisher",
        if: [{ kind: "coinsAtLeast", amount: F.lavishBlade.cost }],
        then: { kind: "coinShot", magnitude: F.lavishBlade.perCoin, count: F.lavishBlade.cost },
      },
      { when: "onFinisher", then: { kind: "gainCoins", magnitude: F.lavishBlade.coins } },
    ]),
  },
  bribe: {
    key: "bribe",
    name: "買収",
    desc: `敵が怯むと、銭を${F.bribe.cost}払ってその敵を${F.bribe.duration}秒間従える（同時に${F.bribe.count}体まで、${F.bribe.icd}秒に1回）。`,
    icon: "買",
    tags: ["loot", "stagger", "placed"],
    keywords: kw(["placed"], ["stagger"]),
    gives: ["placed"],
    cursed: false,
    fusion: ["wealth", "horde"],
    card: "law",
    changes: "press",
    graded: false,
    // 払いは従えた 1 体ごとに tameEnemy の中で行う（従えられない相手・上限に達したときに銭だけ減らない）
    rules: rulesOf("bribe", [
      {
        when: "onStagger",
        if: [{ kind: "coinsAtLeast", amount: F.bribe.cost }],
        then: { kind: "tameEnemy", magnitude: NO_AMOUNT, count: F.bribe.count, duration: F.bribe.duration, cost: F.bribe.cost },
        icd: F.bribe.icd,
      },
    ]),
  },
};
