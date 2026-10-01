/**
 * 大地の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）
 *
 * 軸は 怯み・重さ・壁。真髄は設計の「地投げ」（怯んだ敵を掴んで投げる）が engine 大なので、
 * 設計の落とし先「怯んだ敵の撃破で衝撃波 + 周りを怯ませる」（激震）で入れた
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import { formatMeters } from "../../core/units";
import { BOON, BOON_LINEAGE, STATUS } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_EARTH = [
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  "leyLine",
  "earthWallSlam",
  "footBreak",
  "earthQuake",
  "earthWrath",
  // ---- 摂理 ----
  "crumble",
  "usurp",
  "earthDomain",
  // ---- 研鑽 ----
  "earthTrophy",
  "earthRampart",
  // ---- 真髄 ----
  "earthTremor",
] as const;

type EarthKey = (typeof BOON_KEYS_EARTH)[number];

/** 壁際（放出の一撃が壁に叩きつける。player.ts の releaseSlamMul が読む） */
export const EARTH_WALL_SLAM_KEY: EarthKey = "earthWallSlam";

const E = BOON_LINEAGE.earth;
const ALWAYS = 1;
const PERCENT = 100;
/** 量を持たない効果（地形・状態異常を付ける）の magnitude */
const NO_AMOUNT = 0;

// -----------------------------------------------------------------------------
// 組み立て
// -----------------------------------------------------------------------------

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

/** 確定発動の Rule。ICD は BOON.ruleMinIcd 以上、数えだけの Rule は ICD 0（全部数える） */
function rulesOf(key: EarthKey, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: s.then.kind === "tally" ? 0 : Math.max(BOON.ruleMinIcd, s.icd ?? 0),
    scope: SCOPE_ANY,
    owner,
  }));
}

function modifiersOf(key: EarthKey, specs: readonly Omit<Modifier, "id" | "owner">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), owner }));
}

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

/** 倍率 → 増減の %（1.2 → 20、0.9 → 10） */
function mulPct(mul: number): number {
  return Math.round(Math.abs(mul - 1) * PERCENT);
}

const PRIMARY: RuleCondition = { kind: "lane", lane: "primary" };
const TARGET_STAGGERED: RuleCondition = { kind: "targetHas", status: "stagger" };
const NEAR: RuleCondition = { kind: "targetWithin", radius: E.earthDomain.radius };

/** 激震: 怯ませる周りの敵（ボスは怯み値の器が別なので除く） */
const TREMOR_STAGGER: RuleEffect = {
  kind: "nearbyEnemies",
  status: "stagger",
  magnitude: NO_AMOUNT,
  duration: E.earthTremor.staggerTime,
  radius: E.earthTremor.radius,
  skipBoss: true,
  color: BOON.ruleTextColor,
};

// -----------------------------------------------------------------------------
// 札
// -----------------------------------------------------------------------------

export const BOONS_EARTH: Readonly<Record<EarthKey, BoonDef>> = {
  // ---- 加護 ----
  leyLine: {
    key: "leyLine",
    name: "地脈",
    desc: `左の連撃が当たるたび怯み値+${E.leyLine.poise}。`,
    icon: "脈",
    tags: ["melee", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["melee"]),
    cursed: false,
    lineage: "earth",
    card: "grace",
    action: "primary",
    changes: "target",
    rules: rulesOf("leyLine", [{ when: "onSwingHit", if: [PRIMARY], then: { kind: "addPoise", magnitude: E.leyLine.poise }, icd: E.leyLine.icd }]),
  },
  earthWallSlam: {
    key: "earthWallSlam",
    name: "壁際",
    // 放出の一撃を叩きつけにするのは player.ts の releaseSlamMul
    desc: `右の放出の一撃が敵を大きく弾き、壁に叩きつける。放出の後${E.earthWallSlam.window}秒、壁に叩きつけた敵へ追撃。`,
    icon: "壁",
    tags: ["melee", "stagger"],
    keywords: kw(["wall"], ["melee"], ["stagger"]),
    cursed: false,
    lineage: "earth",
    card: "grace",
    action: "secondary",
    changes: "position",
    rules: rulesOf("earthWallSlam", [
      {
        when: "onWallSlam",
        if: [{ kind: "recent", event: "onRelease", within: E.earthWallSlam.window }],
        then: { kind: "strike", magnitude: E.earthWallSlam.strikeRatio, scaleBy: "slashBase" },
        icd: E.earthWallSlam.icd,
      },
    ]),
  },
  footBreak: {
    key: "footBreak",
    name: "足場崩し",
    desc: `ダッシュを終えた足元が崩れる床になる（${E.footBreak.duration}秒）。乗り続けた敵は落ちて怯む。`,
    icon: "場",
    tags: ["dash", "terrain", "stagger"],
    gives: ["terrain", "stagger"],
    keywords: kw(["placed", "stagger"], ["dash"]),
    cursed: false,
    lineage: "earth",
    card: "grace",
    action: "dash",
    changes: "position",
    rules: rulesOf("footBreak", [
      { when: "onDashEnd", then: { kind: "placeTerrain", terrain: "rubble", magnitude: NO_AMOUNT, radius: E.footBreak.radius, duration: E.footBreak.duration } },
    ]),
  },
  earthQuake: {
    key: "earthQuake",
    name: "震撼",
    desc: `スキルが当たるたび怯み値+${E.earthQuake.poise}。`,
    icon: "震",
    tags: ["skill", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["mana"]),
    cursed: false,
    lineage: "earth",
    card: "grace",
    action: "skill",
    changes: "target",
    rules: rulesOf("earthQuake", [{ when: "onSkillHit", then: { kind: "addPoise", magnitude: E.earthQuake.poise }, icd: E.earthQuake.icd }]),
  },
  earthWrath: {
    key: "earthWrath",
    name: "大地の怒り",
    desc: `奥義を撃つと、交戦中の部屋の敵すべてに怯み値+${E.earthWrath.poise}。`,
    icon: "怒",
    tags: ["energy", "stagger", "room"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["energy"]),
    cursed: false,
    lineage: "earth",
    card: "grace",
    action: "ultimate",
    changes: "timing",
    rules: rulesOf("earthWrath", [{ when: "onBurst", then: { kind: "roomEnemies", magnitude: E.earthWrath.poise } }]),
  },
  // ---- 摂理 ----
  crumble: {
    key: "crumble",
    name: "崩し",
    desc: `怯ませた敵を${E.crumble.duration}秒間脆弱にする（${E.crumble.icd}秒に 1 回）。`,
    icon: "脆",
    tags: ["stagger", "vulnerable"],
    gives: ["vulnerable"],
    keywords: kw(["vulnerable"], ["stagger"]),
    cursed: false,
    lineage: "earth",
    card: "law",
    changes: "target",
    rules: rulesOf("crumble", [
      { when: "onStagger", then: { kind: "afflict", status: "vulnerable", magnitude: NO_AMOUNT, duration: E.crumble.duration }, icd: E.crumble.icd },
    ]),
  },
  usurp: {
    key: "usurp",
    name: "力の簒奪",
    desc: `処刑すると${E.usurp.duration}秒間、与える怯み値+${pct(E.usurp.wrathStacks * STATUS.wrath.poisePerStack)}%（怒気）。`,
    icon: "簒",
    tags: ["stagger"],
    keywords: kw([], ["kill"], ["stagger"]),
    cursed: false,
    lineage: "earth",
    card: "law",
    changes: "target",
    rules: rulesOf("usurp", [
      { when: "onExecute", then: { kind: "selfStatus", status: "wrath", magnitude: NO_AMOUNT, count: E.usurp.wrathStacks, duration: E.usurp.duration } },
    ]),
  },
  earthDomain: {
    key: "earthDomain",
    name: "領域",
    desc: `自分から${formatMeters(E.earthDomain.radius)}以内の敵への与ダメ+${mulPct(E.earthDomain.nearMul)}%、それより遠い敵へは-${mulPct(E.earthDomain.farMul)}%。`,
    icon: "域",
    tags: ["melee"],
    keywords: kw([], [], ["melee"]),
    cursed: false,
    lineage: "earth",
    card: "law",
    changes: "position",
    modifiers: modifiersOf("earthDomain", [
      { kind: "more", tag: "all", amount: E.earthDomain.nearMul, if: [NEAR] },
      { kind: "more", tag: "all", amount: E.earthDomain.farMul, if: [{ kind: "not", condition: NEAR }] },
    ]),
  },
  // ---- 研鑽 ----
  earthTrophy: {
    key: "earthTrophy",
    name: "斬獲",
    desc: `処刑${E.earthTrophy.every}回につき与える怯み値+${pct(E.earthTrophy.amount)}%（上限なし）。`,
    icon: "獲",
    tags: ["stagger"],
    keywords: kw([], ["kill"], ["stagger"]),
    cursed: false,
    lineage: "earth",
    card: "temper",
    changes: "watch",
    rules: rulesOf("earthTrophy", [{ when: "onExecute", then: { kind: "tally", magnitude: 1, key: "earthTrophy" } }]),
    modifiers: modifiersOf("earthTrophy", [
      { kind: "more", tag: "poise", amount: E.earthTrophy.amount, per: { count: { kind: "tally", key: "earthTrophy" }, every: E.earthTrophy.every }, if: [] },
    ]),
  },
  earthRampart: {
    key: "earthRampart",
    name: "破壁",
    desc: `壁叩きつけ${E.earthRampart.every}回につき近接の与ダメ+${pct(E.earthRampart.amount)}%（上限なし）。`,
    icon: "破",
    tags: ["melee"],
    keywords: kw([], ["wall"], ["melee"]),
    cursed: false,
    lineage: "earth",
    card: "temper",
    changes: "watch",
    rules: rulesOf("earthRampart", [{ when: "onWallSlam", then: { kind: "tally", magnitude: 1, key: "earthRampart" } }]),
    modifiers: modifiersOf("earthRampart", [
      { kind: "more", tag: "melee", amount: E.earthRampart.amount, per: { count: { kind: "tally", key: "earthRampart" }, every: E.earthRampart.every }, if: [] },
    ]),
  },
  // ---- 真髄 ----
  earthTremor: {
    key: "earthTremor",
    name: "激震",
    desc: `怯んだ敵を倒すと、その場に衝撃波が起き、周り${formatMeters(E.earthTremor.radius)}の敵が${E.earthTremor.staggerTime}秒怯む（ボスは除く）。`,
    icon: "激",
    tags: ["stagger", "explode"],
    gives: ["stagger"],
    keywords: kw(["stagger", "area"], ["kill", "stagger"]),
    cursed: false,
    lineage: "earth",
    card: "apex",
    changes: "target",
    rules: rulesOf("earthTremor", [
      { when: "onKill", if: [TARGET_STAGGERED], then: { kind: "shockwave", magnitude: E.earthTremor.waveRatio, scaleBy: "slashBase" }, icd: E.earthTremor.icd },
      { when: "onKill", if: [TARGET_STAGGERED], then: TREMOR_STAGGER, icd: E.earthTremor.icd },
    ]),
  },
};
