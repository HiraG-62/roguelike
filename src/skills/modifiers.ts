import { kw } from "../core/keywords";
import { formatMeters } from "../core/units";
import { BALANCE } from "../data/balance";
import type { BaseModifierKey, ExtraModifierKey, ModifierDef } from "./types";

/**
 * 刻印符の変形（A = CastParams を変える）と循環（段取り 7c。docs/ideas/skills-7c-plan.md 4 章）。data.ts の MODIFIERS に展開する。
 * apply は CastParams に旗や倍率を立てるだけ。発動時の状態で変わるもの（溢れ撃ち・刻み撃ち・過熱・蓄え・呼応・背水・捧げ・帳）は
 * system/skills.ts が、命中ごとのもの（連鎖・爆ぜ・巡り・地形化）は skills/hit.ts が読む。
 * 行為の列・起点・発動の時機を変える符は skills/modifiers2.ts
 */

const PERCENT = 100;

/** data.ts の SKILL.modifier と同じ数値（data.ts は MODIFIERS を組むためにこのファイルを読むので、BALANCE から直接読む） */
const B = BALANCE.skills.SKILL.modifier;
const E = BALANCE.skills.EXTRA_MODIFIER_TUNING;

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

export const BASE_MODIFIERS: Record<BaseModifierKey, ModifierDef> = {
  delay: {
    key: "delay",
    name: "遅延",
    verb: `発動地点で${B.delay.time}秒後に発動、ダメージ x${B.delay.damageMul}`,
    color: "#ff80c0",
    family: "shape",
    keywords: kw(["placed"]),
    // 変身は発動地点で後から起こしても変身しない（衝撃だけになる）
    excludesTags: ["defense", "buff", "movement", "channel", "form"],
    apply: (p) => ({ ...p, delay: { time: B.delay.time, damageMul: B.delay.damageMul } }),
  },
  echo: {
    key: "echo",
    name: "反響",
    verb: `${B.echo.delay}秒後に${pct(B.echo.damageMul)}%の威力で再発動、再使用時間 x${B.echo.burdenMul}`,
    manaVerb: `${B.echo.delay}秒後に${pct(B.echo.damageMul)}%の威力で再発動、コスト x${B.echo.burdenMul}`,
    color: "#c080ff",
    family: "shape",
    keywords: kw([], [], ["area"]),
    excludesTags: ["defense", "buff"],
    apply: (p) => ({ ...p, echo: { delay: B.echo.delay, damageMul: B.echo.damageMul }, burdenMul: p.burdenMul * B.echo.burdenMul }),
  },
  charge: {
    key: "charge",
    name: "溜め",
    verb: `長押しで溜める（最大${B.charge.maxTime}秒）: ダメージ x1〜${B.charge.maxDamageMul}、範囲 x1〜${B.charge.maxAreaMul}`,
    manaVerb: `長押しで溜める（最大${B.charge.maxTime}秒）: ダメージ x1〜${B.charge.maxDamageMul}、範囲 x1〜${B.charge.maxAreaMul}。コストは離した瞬間に払う`,
    color: "#ffd060",
    family: "shape",
    keywords: kw(["still"]),
    // パリィ/血の契約/加速は「押した瞬間」に意味がある即応スキル、チャネル系（砲身化）は「溜めて離す」と噛み合わない
    excludesTags: ["defense", "buff", "channel"],
    // 実際の倍率は system/skills.ts が発動時の経過秒から計算して CastParams に掛けるので、ここでは素通し
    apply: (p) => p,
  },
  pierce: {
    key: "pierce",
    name: "貫き",
    verb: `弾・鎖が+${B.pierce.count}体貫通`,
    color: "#80ffc0",
    family: "shape",
    keywords: kw([], [], ["bullet"]),
    excludesTags: ["placed"],
    requiresTags: ["projectile"],
    apply: (p) => ({ ...p, pierce: p.pierce + B.pierce.count }),
  },
  tether: {
    key: "tether",
    name: "手繰り",
    verb: `ノックバックが逆向き（発動地点へ引く）、ダメージ x${B.tether.damageMul}`,
    color: "#90b0ff",
    family: "shape",
    keywords: kw(["area"]),
    excludesTags: ["buff", "movement"],
    requiresDamage: true,
    apply: (p) => ({ ...p, knockbackMul: -Math.abs(p.knockbackMul), damageMul: p.damageMul * B.tether.damageMul }),
  },
  focus: {
    key: "focus",
    name: "収束",
    verb: `範囲 x${B.focus.areaMul}、ダメージ x${B.focus.damageMul}`,
    color: "#60a0ff",
    family: "shape",
    keywords: kw([], [], ["area"]),
    excludesTags: ["buff"],
    requiresDamage: true,
    apply: (p) => ({ ...p, areaMul: p.areaMul * B.focus.areaMul, damageMul: p.damageMul * B.focus.damageMul }),
  },
  ghost: {
    key: "ghost",
    name: "分身",
    verb: `撃った位置から${B.ghost.delay}秒後に${pct(B.ghost.damageMul)}%の威力でもう一度発動、再使用時間 x${B.ghost.burdenMul}`,
    manaVerb: `撃った位置から${B.ghost.delay}秒後に${pct(B.ghost.damageMul)}%の威力でもう一度発動、コスト x${B.ghost.burdenMul}`,
    color: "#b0a0ff",
    family: "shape",
    keywords: kw([], [], ["area"]),
    // 反響と同じ写しの仕組み（写しは自分を動かさないので、身を守る・強化するスキルでは空振りになる）
    excludesTags: ["defense", "buff"],
    apply: (p) => ({ ...p, ghost: { delay: B.ghost.delay, damageMul: B.ghost.damageMul }, burdenMul: p.burdenMul * B.ghost.burdenMul }),
  },
  chain: {
    key: "chain",
    name: "連鎖",
    verb: `命中した敵から${formatMeters(B.chain.range)}以内の別の敵へ跳ぶ（${pct(B.chain.damageMul)}%の威力。1回の発動で${B.chain.maxPerCast}回まで）`,
    color: "#ffff80",
    family: "shape",
    keywords: kw(["area"]),
    excludesTags: [],
    requiresDamage: true,
    apply: (p) => ({ ...p, chain: true }),
  },
  burst: {
    key: "burst",
    name: "爆ぜ",
    verb: `命中点で小爆発（半径${formatMeters(B.burst.radius)}・${pct(B.burst.damageMul)}%の威力。1回の発動で${B.burst.maxPerCast}回まで）`,
    color: "#ff9060",
    family: "shape",
    keywords: kw(["explode", "area"]),
    excludesTags: [],
    requiresDamage: true,
    apply: (p) => ({ ...p, burst: true }),
  },
  leyline: {
    key: "leyline",
    name: "地形化",
    verb: `命中した位置に攻撃の属性の地形が湧く（炎 炎 / 氷 氷床 / 雷・光 水たまり / 毒 毒沼 / 闇 油 / 無 草むら。1回の発動で${B.leyline.maxPerCast}か所まで）、再使用時間 x${B.leyline.burdenMul}`,
    manaVerb: `命中した位置に攻撃の属性の地形が湧く（炎 炎 / 氷 氷床 / 雷・光 水たまり / 毒 毒沼 / 闇 油 / 無 草むら。1回の発動で${B.leyline.maxPerCast}か所まで）、コスト x${B.leyline.burdenMul}`,
    color: "#a0c070",
    family: "shape",
    keywords: kw(["placed"], [], ["burn", "chill", "poison"]),
    excludesTags: [],
    requiresDamage: true,
    apply: (p) => ({ ...p, leyline: true, burdenMul: p.burdenMul * B.leyline.burdenMul }),
  },
};

export const EXTRA_MODIFIERS: Record<ExtraModifierKey, ModifierDef> = {
  bloodPrice: {
    key: "bloodPrice",
    name: "血の代償",
    verb: `気力が足りなくても撃てる（足りない気力1につき最大生命の${E.bloodPrice.hpPerMana * PERCENT}%を払う）`,
    color: "#ff4040",
    family: "cycle",
    keywords: kw(["lowHp"], ["mana"]),
    excludesTags: [],
    requiresResource: "mana",
    apply: (p) => ({ ...p, bloodPrice: true }),
  },
  spillover: {
    key: "spillover",
    name: "溢れ撃ち",
    verb: `気力満タンで撃つとダメージ x${E.spillover.fullMul}`,
    color: "#80c0ff",
    family: "cycle",
    keywords: kw([], ["mana"]),
    excludesTags: ["buff"],
    requiresResource: "mana",
    requiresDamage: true,
    apply: (p) => ({ ...p, spillover: true }),
  },
  streak: {
    key: "streak",
    name: "刻み撃ち",
    verb: `同じスロットを続けて撃つたびダメージ +${pct(E.streak.stepMul)}%（最大+${pct(E.streak.stepMul * E.streak.maxStacks)}%。他のスキルを撃つと途切れる）`,
    color: "#c0ffc0",
    family: "cycle",
    keywords: kw([], [], ["combo"]),
    excludesTags: ["buff"],
    requiresDamage: true,
    apply: (p) => ({ ...p, streak: true }),
  },
  refund: {
    key: "refund",
    name: "巡り",
    verb: `命中1回ごとに払った気力の${pct(E.refund.perHit)}%を返す（払った額まで）、ダメージ x${E.refund.damageMul}`,
    color: "#60e0a0",
    family: "cycle",
    keywords: kw(["mana"]),
    excludesTags: ["buff"],
    requiresResource: "mana",
    requiresDamage: true,
    apply: (p) => ({ ...p, refundPerHit: E.refund.perHit, damageMul: p.damageMul * E.refund.damageMul }),
  },
  overheat: {
    key: "overheat",
    name: "過熱",
    verb: `続けて撃つたびダメージ +${pct(E.overheat.stepMul)}%。${E.overheat.maxStacks}回続けると暴発（最大生命の${pct(E.overheat.hpFraction)}%を失い${E.overheat.lockTime}秒撃てない）`,
    color: "#ff6030",
    family: "cycle",
    keywords: kw(["hurt"]),
    excludesTags: ["buff"],
    requiresDamage: true,
    apply: (p) => ({ ...p, overheat: true }),
  },
  patience: {
    key: "patience",
    name: "蓄え",
    verb: `撃たずに待った1秒ごとにダメージ +${pct(E.patience.perSec)}%（最大+${pct(E.patience.cap)}%）`,
    color: "#e0a040",
    family: "cycle",
    keywords: kw([], [], ["still"]),
    excludesTags: ["buff"],
    requiresDamage: true,
    apply: (p) => ({ ...p, patience: true }),
  },
  sympathy: {
    key: "sympathy",
    name: "呼応",
    verb: `他のスキルを撃ってから${E.sympathy.window}秒以内に撃つとダメージ x${E.sympathy.damageMul}`,
    color: "#f0d0ff",
    family: "cycle",
    keywords: kw([], [], ["combo"]),
    excludesTags: ["buff"],
    requiresDamage: true,
    apply: (p) => ({ ...p, sympathy: true }),
  },
  desperate: {
    key: "desperate",
    name: "背水",
    verb: `減った生命の割合に比例して再使用時間が縮む（生命が尽きかけで x${round2(1 - E.desperate.maxCut)}）`,
    manaVerb: `減った生命の割合に比例してコストが縮む（生命が尽きかけで x${round2(1 - E.desperate.maxCut)}）`,
    color: "#ff5050",
    family: "cycle",
    keywords: kw([], ["lowHp"]),
    excludesTags: [],
    // 背水の一閃は生命で負担が変わる仕組みを内蔵している
    excludesSkills: ["lastStand"],
    apply: (p) => ({ ...p, desperate: true }),
  },
  offering: {
    key: "offering",
    name: "捧げ",
    verb: `奥義ゲージを${E.offering.energyCost}払えればダメージ・効果量 x${E.offering.damageMul}（足りなければ払わず等倍）`,
    color: "#ffe070",
    family: "cycle",
    keywords: kw([], ["energy"]),
    excludesTags: [],
    apply: (p) => ({ ...p, offering: true }),
  },
  ledger: {
    key: "ledger",
    name: "帳",
    verb: `撃った数を数え、${E.ledger.every}発ごとに1発を再使用時間なしで撃つ`,
    manaVerb: `撃った数を数え、${E.ledger.every}発ごとに1発を気力なしで撃つ`,
    color: "#d0d0d0",
    family: "cycle",
    keywords: kw([], [], ["mana"]),
    excludesTags: [],
    apply: (p) => ({ ...p, ledger: true }),
  },
};

/** 小数 2 桁に丸める（説明文の倍率の表示） */
function round2(v: number): number {
  return Math.round(v * PERCENT) / PERCENT;
}

/** 刻印符の抽選の重み。型替え符（照準起点・足元起点・据え置き）は珍しい */
export function modifierWeight(def: Readonly<ModifierDef>): number {
  return def.reshape ? BALANCE.skills.WAVE2_MODIFIER_TUNING.reshapeWeight : 1;
}
