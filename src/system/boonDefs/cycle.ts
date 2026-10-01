/**
 * 輪廻の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）。
 * 軸は気力・スキル・奥義ゲージ。旧 月蝕の 4 種（月読 / 満ち潮 / 新月 / 月蝕 → 四重奏）はここへ写した
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_CYCLE = [
  "fullMana",
  "moonRead",
  "newMoon",
  "echoCall",
  "highTide",
  "circulation",
  "bloodMana",
  "eclipse",
  "chantTally",
  "returnTally",
  "flowTurn",
] as const;

type CycleKey = (typeof BOON_KEYS_CYCLE)[number];

const C = BOON_LINEAGE.cycle;

/** 流転が次の発動の倍を置いておく数えの key（system/skills.ts の flowTurnMul が読み書きする） */
export const FLOW_TURN_TALLY = "flowTurn";
/** 詠: スキルの発動の数え */
export const CHANT_TALLY = "chant";
/** 還: スキルの命中の数え */
export const RETURN_TALLY = "return";

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

const ALWAYS = 1;
const NO_AMOUNT = 0;
const PERCENT = 100;
const PRIMARY: RuleCondition = { kind: "lane", lane: "primary" };
const MANA_FULL: RuleCondition = { kind: "manaFull" };

/** 確定発動の Rule。数え（tally）以外の ICD は BOON.ruleMinIcd を下限にする（語の回数上限は resolveRules が掛ける） */
function rulesOf(key: CycleKey, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: s.then.kind === "tally" ? (s.icd ?? 0) : Math.max(BOON.ruleMinIcd, s.icd ?? 0),
    scope: SCOPE_ANY,
    owner,
  }));
}

function modifiersOf(key: CycleKey, specs: readonly Pick<Modifier, "kind" | "tag" | "amount" | "per">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), if: [], owner }));
}

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

export const BOONS_CYCLE: Readonly<Record<CycleKey, BoonDef>> = {
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  fullMana: {
    key: "fullMana",
    name: "満気",
    desc: `気力が満タンの間、左の通常攻撃が当たると照準へ気の波を放つ（近接1段目の威力の${pct(C.fullMana.ratio)}%）。`,
    icon: "盈",
    tags: ["mana", "melee"],
    keywords: kw(["area"], ["mana", "melee"]),
    cursed: false,
    lineage: "cycle",
    card: "grace",
    action: "primary",
    changes: "timing",
    rules: rulesOf("fullMana", [
      { when: "onSwingHit", if: [PRIMARY, MANA_FULL], then: { kind: "wave", magnitude: C.fullMana.ratio, scaleBy: "slashBase" }, icd: C.fullMana.icd },
    ]),
  },
  moonRead: {
    key: "moonRead",
    name: "月読",
    desc: `応手のたび、気力が最大の${pct(C.moonRead.manaRatio)}%戻り、スキルの再使用時間が${pct(C.moonRead.refresh)}%戻る。`,
    icon: "月",
    tags: ["mana", "skill", "counter"],
    keywords: kw(["mana"], ["counter"]),
    gives: ["mana"],
    cursed: false,
    lineage: "cycle",
    card: "grace",
    action: "secondary",
    changes: "timing",
    rules: rulesOf("moonRead", [
      {
        when: "onRiposte",
        then: { kind: "restoreMana", magnitude: C.moonRead.manaRatio, scaleBy: "counter", counter: { kind: "stat", stat: "maxMana" } },
        icd: C.moonRead.icd,
      },
      { when: "onRiposte", then: { kind: "refreshSkills", magnitude: C.moonRead.refresh }, icd: C.moonRead.icd },
    ]),
  },
  newMoon: {
    key: "newMoon",
    name: "新月",
    desc: `ダッシュを終えると、直前に撃ったスキルを気力を払わずにもう一度撃つ（威力${pct(C.newMoon.echoMul)}%、${C.newMoon.icd}秒に1回）。`,
    icon: "朔",
    tags: ["skill", "dash"],
    keywords: kw([], ["dash"], ["mana"]),
    cursed: false,
    lineage: "cycle",
    card: "grace",
    action: "dash",
    changes: "position",
    rules: rulesOf("newMoon", [{ when: "onDashEnd", then: { kind: "echoLast", magnitude: C.newMoon.echoMul }, icd: C.newMoon.icd }]),
  },
  echoCall: {
    key: "echoCall",
    name: "木霊",
    // 符の名前は skills/data.ts の MODIFIERS.echo.name（skills/data を読むと起動時の循環になるので名前だけ書く）
    desc: "装着中の全てのスキルに刻印符「反響」が付く（少し遅れてもう一度撃つ）。",
    icon: "霊",
    tags: ["skill"],
    keywords: kw([], [], ["mana"]),
    cursed: false,
    lineage: "cycle",
    card: "grace",
    action: "skill",
    changes: "timing",
    grantsModifier: "echo",
  },
  highTide: {
    key: "highTide",
    name: "満ち潮",
    desc: "奥義を放つと、全てのスキルの再使用時間が戻り、気力が満タンになる。",
    icon: "潮",
    tags: ["mana", "energy", "skill"],
    keywords: kw(["mana"], ["energy"]),
    gives: ["mana"],
    cursed: false,
    lineage: "cycle",
    card: "grace",
    action: "ultimate",
    changes: "timing",
    rules: rulesOf("highTide", [
      { when: "onBurst", then: { kind: "refreshSkills", magnitude: NO_AMOUNT, fill: true } },
      { when: "onBurst", then: { kind: "restoreMana", magnitude: NO_AMOUNT, fill: true } },
    ]),
  },
  // ---- 摂理 ----
  circulation: {
    key: "circulation",
    name: "循環",
    desc: `スキルが命中するたび気力が${C.circulation.mana}戻る（${C.circulation.icd}秒に1回）。`,
    icon: "循",
    tags: ["mana", "skill"],
    keywords: kw(["mana"], [], ["mana"]),
    gives: ["mana"],
    cursed: false,
    lineage: "cycle",
    card: "law",
    changes: "watch",
    // 旧フックの「1 回の発動で 8 まで」は ICD で近似する（同じ発動の多段命中を間引く）
    rules: rulesOf("circulation", [
      { when: "onSkillHit", then: { kind: "restoreMana", magnitude: C.circulation.mana, quiet: true }, icd: C.circulation.icd },
    ]),
  },
  bloodMana: {
    key: "bloodMana",
    name: "血の対価",
    // 効果は boons.ts の boonManaCostMul（stats の気力コストを条件付きで下げる口が Modifier に無いので既存の分岐を使う）
    desc: `生命が${pct(BOON.bloodManaHpRatio)}%以下の間、スキルの気力コストが-${pct(1 - BOON.bloodManaCostMul)}%になる。`,
    icon: "贖",
    tags: ["mana", "hp"],
    keywords: kw([], ["lowHp"], ["mana"]),
    cursed: false,
    lineage: "cycle",
    card: "law",
    changes: "timing",
  },
  eclipse: {
    key: "eclipse",
    name: "四重奏",
    // 効果は boonRules.ts の trackEclipse（装着中のスキルを重複なく撃ち切る窓。SkillRunState の窓を持つ既存の分岐を使う）
    desc: `装着中のスキル（${BOON.eclipseMinSlots}つ以上）を重複なく続けて全て撃つと、${BOON.eclipseWindow}秒間スキルで払った気力が戻る。`,
    icon: "奏",
    tags: ["mana", "skill"],
    keywords: kw(["mana"], ["mana"]),
    cursed: false,
    lineage: "cycle",
    card: "law",
    changes: "timing",
  },
  // ---- 研鑽 ----
  chantTally: {
    key: "chantTally",
    name: "吟詠",
    desc: `スキルを撃つたび数える。${C.chantTally.every}回ごとに最大気力+${C.chantTally.per}（上限なし）。`,
    icon: "唱",
    tags: ["mana", "skill"],
    keywords: kw([], [], ["mana"]),
    cursed: false,
    lineage: "cycle",
    card: "temper",
    changes: "watch",
    rules: rulesOf("chantTally", [{ when: "onSkillCast", then: { kind: "tally", magnitude: 1, key: CHANT_TALLY } }]),
    temperStat: { tally: CHANT_TALLY, stat: "maxMana", per: C.chantTally.per, every: C.chantTally.every },
  },
  returnTally: {
    key: "returnTally",
    name: "還流",
    desc: `スキルが命中するたび数える。${C.returnTally.every}回ごとにスキルの与ダメージ+${pct(C.returnTally.amount)}%（上限なし）。`,
    icon: "環",
    tags: ["skill"],
    keywords: kw([], [], ["mana"]),
    cursed: false,
    lineage: "cycle",
    card: "temper",
    changes: "watch",
    // 設計の「戻した気力の総量」は気力の回収にイベントが無いので、気力の源になりやすいスキルの命中で数える
    rules: rulesOf("returnTally", [{ when: "onSkillHit", then: { kind: "tally", magnitude: 1, key: RETURN_TALLY } }]),
    modifiers: modifiersOf("returnTally", [
      { kind: "increased", tag: "skill", amount: C.returnTally.amount, per: { count: { kind: "tally", key: RETURN_TALLY }, every: C.returnTally.every } },
    ]),
  },
  // ---- 真髄 ----
  flowTurn: {
    key: "flowTurn",
    name: "流転",
    // 効果は system/skills.ts の flowTurnMul（発動のたびに払った気力を次の発動の倍へ回す）
    desc: `スキルで払った気力 ÷ 最大気力が、次に撃つスキルの威力の倍になる（最大×${1 + C.flowTurn.cap}）。`,
    icon: "遷",
    tags: ["mana", "skill"],
    keywords: kw([], ["mana"], ["mana"]),
    cursed: false,
    lineage: "cycle",
    card: "apex",
    changes: "timing",
    graded: false,
  },
};
