import { kw } from "../core/keywords";
import { EXTRA_MODIFIER_TUNING as M } from "./tuning";
import type { ExtraModifierKey, ModifierDef, ModifierKey, SkillKey } from "./types";

/**
 * 大拡張の刻印符（docs/ideas/skills-expansion.md 2 章）と型替え符（3 章）。data.ts の MODIFIERS に展開する。
 * apply は CastParams に旗や倍率を立てるだけ。状態で変わる効果（溢れ・渇き撃ちなど）は
 * 発動時に system/skills.ts が、命中ごとの効果（背面・至近など）は skills/hit.ts が読む。
 */

const PERCENT = 100;

/** マナの払い方が特殊なスキル。コストを動かす刻印符は意味が無い（または壊れる）ので付けない */
const SPECIAL_MANA: readonly SkillKey[] = ["fullMoon", "dregsBlade"];

/** 怯み値を持たないスキル。重撃・軽打（怯み値を動かすことが得失）が片方だけになる */
const NO_POISE: readonly SkillKey[] = ["frostField", "contagion", "shadowStep", "boneRing"];

/** 定刻（マナ → CD）と同時に効かせると意味の無くなるマナ経済の刻印符 */
const MANA_ECONOMY: readonly ModifierKey[] = ["deferred", "refund", "bloodTithe", "spillover", "dryFire", "bladeFeed", "overheat"];

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

export const EXTRA_MODIFIERS: Record<ExtraModifierKey, ModifierDef> = {
  // ---- マナ経済 ----
  deferred: {
    key: "deferred",
    name: "後払い",
    verb: `撃つときは払わず、${M.deferred.delay}秒後にコスト x${M.deferred.costMul}を払う（足りない分は生命）`,
    color: "#e0a040",
    keywords: kw(["lowHp"]),
    excludesTags: [],
    requiresResource: "mana",
    // 業火の化身は維持の気力を毎秒払うので、入口だけ後払いにしても意味が無い
    excludesSkills: [...SPECIAL_MANA, "pyreForm"],
    apply: (p) => ({ ...p, deferredMul: M.deferred.costMul }),
  },
  refund: {
    key: "refund",
    name: "返金",
    verb: `命中1回ごとにコストの${pct(M.refund.perHit)}%を返す（最大${pct(M.refund.cap)}%）、ダメージ x${M.refund.damageMul}`,
    color: "#60e0a0",
    keywords: kw(["mana"]),
    excludesTags: ["buff"],
    requiresResource: "mana",
    excludesSkills: SPECIAL_MANA,
    apply: (p) => ({ ...p, refundPerHit: M.refund.perHit, damageMul: p.damageMul * M.refund.damageMul }),
  },
  bloodTithe: {
    key: "bloodTithe",
    name: "血の肩代わり",
    verb: `気力が足りなくても撃てる（不足分は生命で払う）、コスト x${M.bloodTithe.costMul}`,
    color: "#c03050",
    keywords: kw(["lowHp"], ["mana"]),
    excludesTags: [],
    requiresResource: "mana",
    excludesSkills: SPECIAL_MANA,
    apply: (p) => ({ ...p, bloodTithe: true, burdenMul: p.burdenMul * M.bloodTithe.costMul }),
  },
  spillover: {
    key: "spillover",
    name: "溢れ",
    verb: `気力満タンで撃つとダメージ x${M.spillover.fullMul}（満タンでなければ x${M.spillover.otherMul}）`,
    color: "#80c0ff",
    keywords: kw([], ["mana"]),
    excludesTags: ["buff"],
    requiresResource: "mana",
    excludesSkills: SPECIAL_MANA,
    apply: (p) => ({ ...p, spillover: true }),
  },
  dryFire: {
    key: "dryFire",
    name: "渇き撃ち",
    verb: `気力が最大の${pct(M.dryFire.lowRatio)}%未満ならダメージ x${M.dryFire.damageMul}（それ以上ならコスト x${M.dryFire.costMul}）`,
    color: "#a08060",
    keywords: kw([], ["mana"]),
    excludesTags: ["buff"],
    requiresResource: "mana",
    excludesSkills: ["fullMoon"],
    apply: (p) => ({ ...p, dryFire: true }),
  },
  bladeFeed: {
    key: "bladeFeed",
    name: "刃の給油",
    verb: `直前${M.bladeFeed.window}秒以内に近接を当てていればコスト x${M.bladeFeed.costMul}（当てていなければ x${M.bladeFeed.missMul}）`,
    color: "#ffa060",
    keywords: kw([], ["melee"], ["mana"]),
    excludesTags: [],
    requiresResource: "mana",
    excludesSkills: SPECIAL_MANA,
    apply: (p) => ({ ...p, bladeFeed: true }),
  },
  timeLock: {
    key: "timeLock",
    name: "定刻",
    verb: `気力を使わず再使用時間で撃つ（再使用時間 = コスト x${M.timeLock.cooldownPerCost}秒）、連打間隔 x${M.timeLock.intervalMul}`,
    color: "#a0a0ff",
    keywords: kw([], [], ["mana"]),
    excludesTags: [],
    requiresResource: "mana",
    excludesSkills: SPECIAL_MANA,
    excludesModifiers: MANA_ECONOMY,
    apply: (p) => ({
      ...p,
      resource: "cooldown",
      baseCooldown: p.baseCost * M.timeLock.cooldownPerCost,
      baseCost: 0,
      charges: 1,
      intervalMul: p.intervalMul * M.timeLock.intervalMul,
    }),
  },
  fuelize: {
    key: "fuelize",
    name: "燃料化",
    verb: `再使用時間を使わず気力で撃つ（コスト = 再使用時間 x${M.fuelize.costPerCooldown}）、チャージは1`,
    color: "#40a0ff",
    keywords: kw([], ["mana"]),
    excludesTags: [],
    requiresResource: "cooldown",
    // パリィは CD の一部返却がご褒美なので、連打できる形にしない
    excludesSkills: ["parry"],
    apply: (p) => ({
      ...p,
      resource: "mana",
      baseCost: p.baseCooldown * M.fuelize.costPerCooldown,
      baseCooldown: 0,
      charges: 1,
    }),
  },
  overheat: {
    key: "overheat",
    name: "過熱",
    verb: `続けて撃つたびコスト x${M.overheat.stepMul}（最大${M.overheat.maxStacks}回）。${M.overheat.maxStacks}回目の後${M.overheat.lockTime}秒撃てない`,
    color: "#ff6030",
    keywords: kw([], [], ["mana"]),
    excludesTags: [],
    requiresResource: "mana",
    excludesSkills: SPECIAL_MANA,
    apply: (p) => ({ ...p, overheat: true }),
  },
  // ---- 当て方 ----
  heavy: {
    key: "heavy",
    name: "重撃",
    verb: `怯み値 x${M.heavy.poiseMul}、ダメージ x${M.heavy.damageMul}、連打間隔 x${M.heavy.intervalMul}`,
    color: "#c0a080",
    keywords: kw([], [], ["stagger"]),
    excludesTags: ["buff"],
    excludesSkills: NO_POISE,
    excludesModifiers: ["feather"],
    apply: (p) => ({
      ...p,
      poiseMul: p.poiseMul * M.heavy.poiseMul,
      damageMul: p.damageMul * M.heavy.damageMul,
      intervalMul: p.intervalMul * M.heavy.intervalMul,
    }),
  },
  feather: {
    key: "feather",
    name: "軽打",
    verb: `再使用時間 x${M.feather.burdenMul}、怯み値 0`,
    manaVerb: `コスト x${M.feather.burdenMul}、怯み値 0`,
    color: "#e0f0ff",
    keywords: kw([], [], ["mana"]),
    excludesTags: ["buff"],
    excludesSkills: NO_POISE,
    apply: (p) => ({ ...p, burdenMul: p.burdenMul * M.feather.burdenMul, poiseMul: 0 }),
  },
  repel: {
    key: "repel",
    name: "突き放し",
    verb: `ノックバック x${M.repel.knockbackMul}（怯んでいない敵も押し出し、壁に叩きつける）、ダメージ x${M.repel.damageMul}`,
    color: "#ff9090",
    keywords: kw(["wall"]),
    excludesTags: ["buff", "movement"],
    excludesModifiers: ["tether"],
    apply: (p) => ({ ...p, repel: true, knockbackMul: p.knockbackMul * M.repel.knockbackMul, damageMul: p.damageMul * M.repel.damageMul }),
  },
  tether: {
    key: "tether",
    name: "手繰り",
    verb: `ノックバックが逆向き（発動地点へ引く）、ダメージ x${M.tether.damageMul}`,
    color: "#90b0ff",
    keywords: kw(["area"]),
    excludesTags: ["buff", "movement"],
    apply: (p) => ({ ...p, knockbackMul: -Math.abs(p.knockbackMul), damageMul: p.damageMul * M.tether.damageMul }),
  },
  // ---- 状態異常 ----
  linger: {
    key: "linger",
    name: "延命",
    verb: `付ける状態異常の持続 x${M.linger.durationMul}、ダメージ x${M.linger.damageMul}`,
    color: "#b0ff80",
    keywords: kw([], [], ["burn", "chill", "shock", "poison", "bleed", "vulnerable", "weaken", "fear", "silence"]),
    excludesTags: [],
    requiresApplies: true,
    apply: (p) => ({ ...p, statusDurationMul: p.statusDurationMul * M.linger.durationMul, damageMul: p.damageMul * M.linger.damageMul }),
  },
  spread: {
    key: "spread",
    name: "伝播",
    verb: `付けた状態異常が近くの1体にも持続${pct(M.spread.durationMul)}%で付く（重ねる数は1減る）`,
    color: "#80ff60",
    keywords: kw(["area"], [], ["burn", "chill", "shock", "poison", "bleed"]),
    excludesTags: [],
    requiresApplies: true,
    apply: (p) => ({ ...p, spread: true }),
  },
  followUp: {
    key: "followUp",
    name: "追撃",
    verb: `命中した敵に${M.followUp.time}秒の印。印の敵に近接を当てると追加で${pct(M.followUp.powerRatio)}%の一撃、ダメージ x${M.followUp.damageMul}`,
    color: "#ffe0a0",
    keywords: kw([], ["melee"]),
    excludesTags: ["buff"],
    apply: (p) => ({ ...p, followUp: true, damageMul: p.damageMul * M.followUp.damageMul }),
  },
  // ---- 形 ----
  lastGasp: {
    key: "lastGasp",
    name: "散り際",
    verb: `このスキルで倒した敵の位置で、${pct(M.lastGasp.damageMul)}%の威力で同じスキルが発動する（1回の発動で最大${M.lastGasp.maxPerCast}回）、再使用時間 x${M.lastGasp.burdenMul}`,
    manaVerb: `このスキルで倒した敵の位置で、${pct(M.lastGasp.damageMul)}%の威力で同じスキルが発動する（1回の発動で最大${M.lastGasp.maxPerCast}回）、コスト x${M.lastGasp.burdenMul}`,
    color: "#ff70a0",
    keywords: kw(["area"], ["kill"]),
    excludesTags: ["buff", "defense", "movement"],
    apply: (p) => ({ ...p, lastGasp: M.lastGasp.damageMul, burdenMul: p.burdenMul * M.lastGasp.burdenMul }),
  },
  sustain: {
    key: "sustain",
    name: "延長",
    verb: `置いたものの持続 x${M.sustain.durationMul}、効果量 x${M.sustain.potencyMul}`,
    color: "#70d0d0",
    keywords: kw([], ["placed"], ["placed"]),
    excludesTags: [],
    // 第 3 弾の変身（狼化・霊体化・鉄塊化）は持続が伸びる（durationMul）
    requiresTags: ["placed", "form"],
    // グレネード・雷撃は置いたものが残らない（導火線・落雷の予告だけ）。第 2 弾の変身と、時間で切れない変身（砲身化・業火の化身）は除く
    excludesSkills: ["frag", "thunder", "titanForm", "swiftForm", "spiritForm", "siegeForm", "pyreForm"],
    apply: (p) => ({ ...p, durationMul: p.durationMul * M.sustain.durationMul, potencyMul: p.potencyMul * M.sustain.potencyMul }),
  },
  landing: {
    key: "landing",
    name: "着地衝撃",
    verb: `移動の終わりに小さな衝撃波（怯み値${M.landing.poise}）、再使用時間 x${M.landing.burdenMul}`,
    manaVerb: `移動の終わりに小さな衝撃波（怯み値${M.landing.poise}）、コスト x${M.landing.burdenMul}`,
    color: "#d0b070",
    keywords: kw(["stagger", "area"], ["dash"]),
    excludesTags: ["buff"],
    requiresTags: ["movement"],
    apply: (p) => ({ ...p, landing: true, burdenMul: p.burdenMul * M.landing.burdenMul }),
  },
  // ---- 状況 ----
  desperate: {
    key: "desperate",
    name: "背水",
    verb: `生命${pct(M.desperate.hpRatio)}%未満の間はダメージ x${M.desperate.lowMul}（それ以上なら x${M.desperate.highMul}）`,
    color: "#ff5050",
    keywords: kw([], ["lowHp"]),
    excludesTags: ["buff"],
    // 背水の一閃は同じ条件を内蔵している
    excludesSkills: ["lastStand"],
    apply: (p) => ({ ...p, desperate: true }),
  },
  attune: {
    key: "attune",
    name: "同調",
    verb: `装備の支配共鳴の色がスキルの種類と合えば x${M.attune.matchMul}（紅 近接 / 蒼 射撃・移動 / 翠 防御・強化 / 金 会心の一撃 / 冥 状態異常付き）。合わなければ x${M.attune.missMul}`,
    color: "#f0d0ff",
    keywords: kw([], ["crimson", "azure", "jade", "gold", "umbra"]),
    excludesTags: [],
    apply: (p) => ({ ...p, attune: true }),
  },
  cycle: {
    key: "cycle",
    name: "巡り",
    verb: `直前に他のスキルを2回撃っていれば再使用時間 x${M.cycle.freshMul}（直前も同じスキルなら x${M.cycle.repeatMul}）`,
    manaVerb: `直前に他のスキルを2回撃っていればコスト x${M.cycle.freshMul}（直前も同じスキルなら x${M.cycle.repeatMul}）`,
    color: "#c0ffc0",
    keywords: kw([], [], ["mana"]),
    excludesTags: [],
    apply: (p) => ({ ...p, cycle: true }),
  },
  flank: {
    key: "flank",
    name: "背面",
    verb: `敵の背後から当てるとダメージと怯み値 x${M.flank.backMul}（正面からは x${M.flank.frontMul}）`,
    color: "#8080c0",
    keywords: kw([], ["fear"], ["stagger"]),
    excludesTags: [],
    requiresTags: ["melee"],
    apply: (p) => ({ ...p, flank: true }),
  },
  pointBlank: {
    key: "pointBlank",
    name: "至近",
    verb: `撃った位置から${M.pointBlank.range}px以内の敵に x${M.pointBlank.nearMul}（遠い敵には x${M.pointBlank.farMul}）`,
    color: "#ffb0b0",
    keywords: kw([], [], ["ranged"]),
    excludesTags: ["placed"],
    requiresTags: ["projectile"],
    excludesModifiers: ["longshot"],
    apply: (p) => ({ ...p, rangeBias: "pointBlank" }),
  },
  longshot: {
    key: "longshot",
    name: "遠当て",
    verb: `遠い敵ほど強い（${M.longshot.range}pxで x${M.longshot.farMul}、至近は x${M.longshot.nearMul}）`,
    color: "#b0b0ff",
    keywords: kw([], [], ["ranged"]),
    excludesTags: ["placed"],
    requiresTags: ["projectile"],
    apply: (p) => ({ ...p, rangeBias: "longshot" }),
  },
  // ---- 型替え符（リンク 2 本・1 スロットに 1 枚） ----
  toThrown: {
    key: "toThrown",
    name: "投げ刃",
    verb: `【型替え】近接を投擲に変える: カーソル地点へ刃が飛び、着いた所で元の形のまま発動（ノックバック x${M.toThrown.knockbackMul}）`,
    color: "#ffd0ff",
    keywords: kw(["ranged", "bullet"], ["melee"]),
    excludesTags: ["movement", "defense", "projectile"],
    requiresTags: ["melee"],
    // 恨み返しは自分が受けたダメージを返す技なので、離れた着弾点では意味が無い
    excludesSkills: ["grudge"],
    linkCost: M.reshapeLinkCost,
    reshape: "toThrown",
    apply: (p) => ({ ...p, reshape: "toThrown", knockbackMul: p.knockbackMul * M.toThrown.knockbackMul }),
  },
  toLobbed: {
    key: "toLobbed",
    name: "投げ込み",
    verb: `【型替え】置くものをカーソル地点へ投げ込み、着いた瞬間に起動（持続 x${M.toLobbed.durationMul}、ダメージ x${M.toLobbed.damageMul}）`,
    color: "#ffe0c0",
    keywords: kw([], ["placed"]),
    excludesTags: ["buff"],
    requiresTags: ["placed"],
    linkCost: M.reshapeLinkCost,
    reshape: "toLobbed",
    apply: (p) => ({
      ...p,
      reshape: "toLobbed",
      durationMul: p.durationMul * M.toLobbed.durationMul,
      timeMul: p.timeMul * M.toLobbed.timeMul,
      damageMul: p.damageMul * M.toLobbed.damageMul,
    }),
  },
  toStaged: {
    key: "toStaged",
    name: "段階溜め",
    verb: `【型替え】長押しで3段まで溜める: 2段目 範囲 x${M.toStaged.stage2.areaMul} / 3段目 さらに回数 +${M.toStaged.stage3.countBonus}・貫通 +${M.toStaged.stage3.pierce}（溜め中は遅く、被弾で段が下がる）`,
    color: "#fff0a0",
    keywords: kw(["still"], [], ["area"]),
    excludesTags: ["channel", "buff", "defense"],
    excludesModifiers: ["charge"],
    linkCost: M.reshapeLinkCost,
    reshape: "toStaged",
    apply: (p) => ({ ...p, reshape: "toStaged" }),
  },
};

/** 資源を差し替える刻印符（定刻・燃料化）。ほかの刻印符が差し替え後の資源で読み替えられるよう先に適用する */
export const RESOURCE_CONVERTERS: readonly ModifierKey[] = ["timeLock", "fuelize"];

/** 刻印符の抽選の重み。型替え符は珍しい */
export function modifierWeight(def: Readonly<ModifierDef>): number {
  return def.reshape ? M.reshapeWeight : 1;
}
