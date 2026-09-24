import { describe, expect, it } from "vitest";
import "../core/game";
import { ATTR_KEYS, type AttrKey, type AttrRatio, type Scaling } from "../loot/types";
import { SKILL, SKILL_ATTACK, SKILL_DEFS } from "../skills/data";
import { scaledAtBase } from "../system/attributes";
import combatJson from "./balance/combat.json";
import skillsJson from "./balance/skills.json";
import weaponsJson from "./balance/weapons.json";
import { PLAYER } from "./tuning";
import { MOVESETS, SHOT_TYPES } from "./weapons";

/**
 * 行動ごとの係数の振り直し（docs/COMBAT_DESIGN.md A-10、2026-09-24）。
 * 参照ステータスは行動の中身から決める（筋力 = 重さ・押し込み / 技巧 = 速さ・精度・刃 / 体力 = 体を張る /
 * 精神 = 集中・溜め / 霊力 = 魔法・闇・状態異常）。振り直しでは「どこを参照するか」だけを変え、
 * ステータスが基礎値（各 5）のときの威力と Σ係数（成長の速さ）は変えない
 */

const FLOAT_DIGITS = 6;
/** 1 行動の Σ係数を振り直し前からどこまで動かしてよいか（±25%） */
const SUM_TOLERANCE = 0.25;
/** 怯み値の係数は「怯み値 × 3% / 点」前後（丸めの誤差を含めて 2〜4%） */
const POISE_RATIO_MIN = 0.02;
const POISE_RATIO_MAX = 0.04;
/** 射撃 1 発の基礎値での威力（PLAYER.shoot.scaling） */
const SHOT_AT_BASE = 4.3;

/**
 * ステータスを参照しない（基礎値だけの）行動。道具・仕掛け・固定の爆発に限る
 * （JSON のパス。振り直し前の表に無い射撃の型は shots.* で書く）
 */
const FIXED_ACTIONS: readonly string[] = [
  "skills.SKILL.mines.damage",
  "skills.EXTRA_SKILL_TUNING.powderKeg.damage",
  "skills.EXTRA_SKILL_TUNING.turret.damage",
  "weapons.WEAPON.shots.mine.scaling",
];

/**
 * 振り直し前（6b1b778）の [基礎値での威力, Σ係数]。キーは balance JSON のパス。
 * 生成: 6b1b778 の weapons / skills / combat.json から Scaling を全部拾って評価した値
 */
const PINNED: Readonly<Record<string, readonly [number, number]>> = {
  "weapons.WEAPON.movesets.sword.branches.crossCut.step.scaling": [16.5, 1.3],
  "weapons.WEAPON.movesets.sword.branches.steppingCut.step.scaling": [10, 0.9],
  "weapons.WEAPON.movesets.greatsword.steps[0].scaling": [14, 1.2],
  "weapons.WEAPON.movesets.greatsword.steps[1].scaling": [14, 1.2],
  "weapons.WEAPON.movesets.greatsword.steps[2].scaling": [17.5, 1.5],
  "weapons.WEAPON.movesets.greatsword.steps[3].scaling": [25, 2.2],
  "weapons.WEAPON.movesets.greatsword.dashAttack.scaling": [13, 1],
  "weapons.WEAPON.movesets.greatsword.charge.step.scaling": [18, 1.6],
  "weapons.WEAPON.movesets.greatsword.art.step.scaling": [16, 1.4],
  "weapons.WEAPON.movesets.greatsword.branches.helmSplitter.step.scaling": [29, 2.6],
  "weapons.WEAPON.movesets.twinBlades.steps[0].scaling": [4.65, 0.45],
  "weapons.WEAPON.movesets.twinBlades.steps[1].scaling": [4.65, 0.45],
  "weapons.WEAPON.movesets.twinBlades.steps[2].scaling": [3.1, 0.3],
  "weapons.WEAPON.movesets.twinBlades.steps[3].scaling": [4.65, 0.45],
  "weapons.WEAPON.movesets.twinBlades.steps[4].scaling": [9.5, 0.9],
  "weapons.WEAPON.movesets.twinBlades.dashAttack.scaling": [9, 0.8],
  "weapons.WEAPON.movesets.twinBlades.art.step.scaling": [7.5, 0.7],
  "weapons.WEAPON.movesets.twinBlades.branches.flurry.step.scaling": [4, 0.4],
  "weapons.WEAPON.movesets.twinBlades.branches.crossing.step.scaling": [8, 0.8],
  "weapons.WEAPON.movesets.spear.steps[0].scaling": [7.5, 0.7],
  "weapons.WEAPON.movesets.spear.steps[1].scaling": [7.5, 0.7],
  "weapons.WEAPON.movesets.spear.steps[2].scaling": [5.5, 0.5],
  "weapons.WEAPON.movesets.spear.steps[3].scaling": [14.5, 1.3],
  "weapons.WEAPON.movesets.spear.dashAttack.scaling": [11.5, 1],
  "weapons.WEAPON.movesets.spear.art.step.scaling": [10.5, 0.9],
  "weapons.WEAPON.movesets.spear.branches.spearSweep.step.scaling": [9.5, 0.9],
  "weapons.WEAPON.movesets.scythe.steps[0].scaling": [8.5, 0.8],
  "weapons.WEAPON.movesets.scythe.steps[1].scaling": [8.5, 0.8],
  "weapons.WEAPON.movesets.scythe.steps[2].scaling": [5.75, 0.55],
  "weapons.WEAPON.movesets.scythe.steps[3].scaling": [16.5, 1.5],
  "weapons.WEAPON.movesets.scythe.dashAttack.scaling": [11, 1],
  "weapons.WEAPON.movesets.scythe.branches.reaping.step.scaling": [18, 1.6],
  "weapons.WEAPON.movesets.scythe.art.step.scaling": [8, 0.6],
  "weapons.WEAPON.movesets.fists.steps[0].scaling": [5.2, 0.6],
  "weapons.WEAPON.movesets.fists.steps[1].scaling": [5.2, 0.6],
  "weapons.WEAPON.movesets.fists.steps[2].scaling": [5.2, 0.6],
  "weapons.WEAPON.movesets.fists.steps[3].scaling": [3.4, 0.4],
  "weapons.WEAPON.movesets.fists.steps[4].scaling": [11, 1.2],
  "weapons.WEAPON.movesets.fists.dashAttack.scaling": [12, 1.2],
  "weapons.WEAPON.movesets.fists.art.step.scaling": [10, 1],
  "weapons.WEAPON.movesets.fists.branches.uppercut.step.scaling": [12, 1.2],
  "weapons.WEAPON.movesets.fists.branches.hundredFists.step.scaling": [3.6, 0.4],
  "weapons.WEAPON.movesets.whip.steps[0].scaling": [9, 0.8],
  "weapons.WEAPON.movesets.whip.steps[1].scaling": [6.5, 0.6],
  "weapons.WEAPON.movesets.whip.steps[2].scaling": [5, 0.5],
  "weapons.WEAPON.movesets.whip.steps[3].scaling": [14.5, 1.3],
  "weapons.WEAPON.movesets.whip.dashAttack.scaling": [9, 0.8],
  "weapons.WEAPON.movesets.whip.art.step.scaling": [12.5, 1.1],
  "weapons.WEAPON.movesets.whip.branches.whirl.step.scaling": [5, 0.5],
  "weapons.WEAPON.movesets.cleaver.steps[0].scaling": [11, 0.9],
  "weapons.WEAPON.movesets.cleaver.steps[1].scaling": [11, 0.9],
  "weapons.WEAPON.movesets.cleaver.steps[2].scaling": [12, 1],
  "weapons.WEAPON.movesets.cleaver.steps[3].scaling": [21, 1.6],
  "weapons.WEAPON.movesets.cleaver.dashAttack.scaling": [13, 1],
  "weapons.WEAPON.movesets.cleaver.branches.slamDown.step.scaling": [24, 1.8],
  "weapons.WEAPON.movesets.cleaver.art.step.scaling": [10, 0.8],
  "weapons.WEAPON.movesets.staff.steps[0].scaling": [6.5, 0.6],
  "weapons.WEAPON.movesets.staff.steps[1].scaling": [6.5, 0.6],
  "weapons.WEAPON.movesets.staff.steps[2].scaling": [6.5, 0.6],
  "weapons.WEAPON.movesets.staff.steps[3].scaling": [11, 1],
  "weapons.WEAPON.movesets.staff.dashAttack.scaling": [8, 0.7],
  "weapons.WEAPON.movesets.staff.art.step.scaling": [7.5, 0.7],
  "weapons.WEAPON.movesets.staff.branches.tempest.step.scaling": [4.5, 0.4],
  "weapons.WEAPON.movesets.wand.steps[0].scaling": [6.5, 0.7],
  "weapons.WEAPON.movesets.wand.steps[1].scaling": [6.5, 0.7],
  "weapons.WEAPON.movesets.wand.steps[2].scaling": [7.5, 0.8],
  "weapons.WEAPON.movesets.wand.steps[3].scaling": [10, 1],
  "weapons.WEAPON.movesets.wand.dashAttack.scaling": [8, 0.8],
  "weapons.WEAPON.movesets.wand.art.throw.scaling": [6, 0.5],
  "weapons.WEAPON.movesets.wand.branches.arcaneStrike.step.scaling": [12.5, 1.3],
  "weapons.WEAPON.movesets.wand.branches.staffSweep.step.scaling": [8, 0.8],
  "weapons.WEAPON.movesets.katana.steps[0].scaling": [7.1, 0.7],
  "weapons.WEAPON.movesets.katana.steps[1].scaling": [7.1, 0.7],
  "weapons.WEAPON.movesets.katana.steps[2].scaling": [7.1, 0.7],
  "weapons.WEAPON.movesets.katana.steps[3].scaling": [14.5, 1.3],
  "weapons.WEAPON.movesets.katana.dashAttack.scaling": [11, 1],
  "weapons.WEAPON.movesets.katana.charge.step.scaling": [13.5, 1.3],
  "weapons.WEAPON.movesets.katana.branches.tsubame.step.scaling": [9.5, 0.9],
  "weapons.WEAPON.movesets.katana.branches.quickDraw.step.scaling": [10, 1],
  "weapons.WEAPON.movesets.axe.steps[0].scaling": [9.5, 0.9],
  "weapons.WEAPON.movesets.axe.steps[1].scaling": [9.5, 0.9],
  "weapons.WEAPON.movesets.axe.steps[2].scaling": [10, 0.9],
  "weapons.WEAPON.movesets.axe.steps[3].scaling": [18, 1.6],
  "weapons.WEAPON.movesets.axe.dashAttack.scaling": [11.5, 0.9],
  "weapons.WEAPON.movesets.axe.art.throw.scaling": [13, 1],
  "weapons.WEAPON.movesets.axe.branches.axeSpin.step.scaling": [7.5, 0.7],
  "weapons.WEAPON.movesets.axe.branches.cleave.step.scaling": [21, 1.8],
  "weapons.WEAPON.movesets.shield.steps[0].scaling": [6.5, 0.7],
  "weapons.WEAPON.movesets.shield.steps[1].scaling": [6.5, 0.7],
  "weapons.WEAPON.movesets.shield.steps[2].scaling": [6.5, 0.7],
  "weapons.WEAPON.movesets.shield.steps[3].scaling": [12, 1.2],
  "weapons.WEAPON.movesets.shield.dashAttack.scaling": [9.5, 0.9],
  "weapons.WEAPON.movesets.shield.art.hold.release.scaling": [8, 0.8],
  "weapons.WEAPON.movesets.shield.branches.shieldDrop.step.scaling": [14, 1.4],
  "weapons.WEAPON.movesets.chainSickle.steps[0].scaling": [5.6, 0.6],
  "weapons.WEAPON.movesets.chainSickle.steps[1].scaling": [5.6, 0.6],
  "weapons.WEAPON.movesets.chainSickle.steps[2].scaling": [5.6, 0.6],
  "weapons.WEAPON.movesets.chainSickle.steps[3].scaling": [11, 1.2],
  "weapons.WEAPON.movesets.chainSickle.dashAttack.scaling": [8.5, 0.9],
  "weapons.WEAPON.movesets.chainSickle.art.step.scaling": [6, 0.6],
  "weapons.WEAPON.movesets.chainSickle.branches.reelIn.step.scaling": [6.5, 0.7],
  "weapons.WEAPON.movesets.hammer.steps[0].scaling": [13, 1.2],
  "weapons.WEAPON.movesets.hammer.steps[1].scaling": [13, 1.2],
  "weapons.WEAPON.movesets.hammer.steps[2].scaling": [14.5, 1.3],
  "weapons.WEAPON.movesets.hammer.steps[3].scaling": [25.5, 2.3],
  "weapons.WEAPON.movesets.hammer.dashAttack.scaling": [13, 1],
  "weapons.WEAPON.movesets.hammer.charge.step.scaling": [21.5, 1.9],
  "weapons.WEAPON.movesets.hammer.art.step.scaling": [14.5, 1.3],
  "weapons.WEAPON.movesets.hammer.branches.groundBreaker.step.scaling": [29, 2.6],
  "weapons.WEAPON.movesets.gunner.dashAttack.scaling": [8, 0.8],
  "weapons.WEAPON.movesets.gunner.art.throw.scaling": [3.9, 0.3],
  "weapons.WEAPON.movesets.sidearm.dashAttack.scaling": [8, 0.8],
  "weapons.WEAPON.movesets.longarm.dashAttack.scaling": [9, 0.8],
  "weapons.WEAPON.movesets.longarm.art.step.scaling": [9, 0.8],
  "weapons.WEAPON.movesets.cannon.dashAttack.scaling": [10, 0.8],
  "weapons.WEAPON.movesets.cannon.art.step.scaling": [13, 1],
  "weapons.WEAPON.movesets.thrown.dashAttack.scaling": [7.5, 0.6],
  "weapons.WEAPON.jobBranches.swordsman.scaling": [11.5, 1.1],
  "weapons.WEAPON.jobBranches.hunter.scaling": [10, 1],
  "weapons.WEAPON.jobBranches.brawler.scaling": [4.1, 0.5],
  "weapons.WEAPON.jobBranches.shieldBearer.scaling": [10.5, 1.1],
  "weapons.WEAPON.jobBranches.hexer.scaling": [8.5, 0.9],
  "weapons.WEAPON.jobBranches.lancer.scaling": [10, 1],
  "weapons.WEAPON.jobBranches.invoker.scaling": [9.5, 1.1],
  "weapons.WEAPON.jobBranches.shadow.scaling": [8.5, 0.9],
  "weapons.WEAPON.jobBranches.alchemist.scaling": [8, 0.8],
  "weapons.PLAYER_MELEE[0].scaling": [7.8, 0.6],
  "weapons.PLAYER_MELEE[1].scaling": [7.8, 0.6],
  "weapons.PLAYER_MELEE[2].scaling": [15.6, 1.2],
  "weapons.ACTION_DASH_ATTACK.scaling": [11.2, 0.8],
  "skills.SKILL.whirl.damage": [8.9, 0.8],
  "skills.SKILL.lunge.damage": [18.4, 1.6],
  "skills.SKILL.frag.damage": [33.8, 2.8],
  "skills.SKILL.railshot.damage": [39, 3.2],
  "skills.SKILL.parry.damage": [12, 1.2],
  "skills.SKILL.bloodPact.buff": [1, 0.02],
  "skills.SKILL.quake.damage": [24.7, 2.4],
  "skills.SKILL.thunder.damage": [26.7, 2.8],
  "skills.SKILL.gravityWell.tickDamage": [3.3, 0.4],
  "skills.SKILL.gravityWell.burstDamage": [20.1, 2],
  "skills.SKILL.mines.damage": [22.1, 2.4],
  "skills.SKILL.haste.buff": [1, 0.02],
  "skills.SKILL.chainHook.damage": [15.6, 1.6],
  "skills.SKILL.spiral.damage": [5.5, 0.6],
  "skills.SKILL.frostField.tickDamage": [4.3, 0.6],
  "skills.EXTRA_SKILL_TUNING.unravel.damage": [12, 1.2],
  "skills.EXTRA_SKILL_TUNING.unravel.perKind": [10, 1],
  "skills.EXTRA_SKILL_TUNING.kindle.damage": [7, 0.6],
  "skills.EXTRA_SKILL_TUNING.prismShard.damage": [11, 1.2],
  "skills.EXTRA_SKILL_TUNING.fullMoon.damage": [50, 4],
  "skills.EXTRA_SKILL_TUNING.dregsBlade.damage": [11, 1.2],
  "skills.EXTRA_SKILL_TUNING.powderKeg.damage": [26, 2.4],
  "skills.EXTRA_SKILL_TUNING.swordGrave.damage": [12, 1.4],
  "skills.EXTRA_SKILL_TUNING.iceBreaker.damage": [19, 1.8],
  "skills.EXTRA_SKILL_TUNING.iceBreaker.shardDamage": [5, 0.4],
  "skills.EXTRA_SKILL_TUNING.bloodlet.damage": [9, 1],
  "skills.EXTRA_SKILL_TUNING.harvest.damage": [10, 1.2],
  "skills.EXTRA_SKILL_TUNING.discharge.damage": [18, 2],
  "skills.EXTRA_SKILL_TUNING.rout.damage": [8, 0.8],
  "skills.EXTRA_SKILL_TUNING.verdict.damage": [34, 3.2],
  "skills.EXTRA_SKILL_TUNING.exploit.damage": [17, 1.6],
  "skills.EXTRA_SKILL_TUNING.strip.damage": [10, 1],
  "skills.EXTRA_SKILL_TUNING.lastStand.damage": [18, 1.6],
  "skills.EXTRA_SKILL_TUNING.comboChain.damage": [9, 1],
  "skills.EXTRA_SKILL_TUNING.grudge.damage": [11, 1.4],
  "skills.EXTRA_SKILL_TUNING.guillotine.damage": [19, 1.8],
  "skills.EXTRA_SKILL_TUNING.ricochet.damage": [12, 1],
  "skills.EXTRA_SKILL_TUNING.galeSlash.damage": [14, 1.4],
  "skills.EXTRA_SKILL_TUNING.scatterSigil.damage": [5, 0.5],
  "skills.EXTRA_SKILL_TUNING.stomp.damage": [8, 1],
  "skills.EXTRA_SKILL_TUNING.threadReel.damage": [9, 1],
  "skills.EXTRA_SKILL_TUNING.meteorDive.damage": [30, 2.8],
  "skills.EXTRA_SKILL_TUNING.swallowFlip.damage": [14, 1.6],
  "skills.EXTRA_SKILL_TUNING.backflow.damage": [10, 1.2],
  "skills.EXTRA_SKILL_TUNING.scarRoar.damage": [10, 1.2],
  "skills.EXTRA_SKILL_TUNING.turret.damage": [8, 1],
  "skills.EXTRA_MODIFIER_TUNING.landing.damage": [5, 0.4],
  "skills.WAVE2_SKILL_TUNING.waterJar.damage": [8, 1],
  "skills.WAVE2_SKILL_TUNING.oilPot.damage": [5, 0.6],
  "skills.WAVE2_SKILL_TUNING.scorchLine.damage": [15, 1.8],
  "skills.WAVE2_SKILL_TUNING.iceSlide.damage": [10, 1.2],
  "skills.WAVE2_SKILL_TUNING.levelGround.damage": [16, 2],
  "skills.WAVE2_SKILL_TUNING.emberDraw.damage": [11.5, 1.5],
  "skills.WAVE2_SKILL_TUNING.bogCall.damage": [6.5, 0.9],
  "skills.WAVE2_SKILL_TUNING.brandSear.damage": [11.5, 1.3],
  "skills.WAVE2_SKILL_TUNING.brandBlast.damage": [10, 1.2],
  "skills.WAVE2_SKILL_TUNING.breakKick.damage": [11, 1.2],
  "skills.WAVE2_SKILL_TUNING.collapseHammer.damage": [19, 2],
  "skills.WAVE2_SKILL_TUNING.tideSlash.damage": [11, 1.2],
  "skills.WAVE2_SKILL_TUNING.flashFreeze.damage": [10.5, 1.3],
  "skills.WAVE2_SKILL_TUNING.hueEtch.damage": [11, 1.2],
  "skills.WAVE2_SKILL_TUNING.hueRelease.damage": [10, 1.2],
  "skills.WAVE2_SKILL_TUNING.siphonMark.damage": [8, 1],
  "skills.WAVE2_SKILL_TUNING.doomSentence.damage": [10, 1.2],
  "skills.WAVE2_SKILL_TUNING.shiftingEdge.damage": [13, 1.4],
  "skills.WAVE2_SKILL_TUNING.weaponArt.damage": [20, 2],
  "skills.WAVE2_SKILL_TUNING.titanForm.damage": [14, 1.6],
  "skills.WAVE2_SKILL_TUNING.swiftForm.damage": [10, 1.2],
  "skills.WAVE2_SKILL_TUNING.spiritForm.damage": [10, 1.2],
  "skills.WAVE2_SKILL_TUNING.wardStake.damage": [5.5, 0.7],
  "skills.WAVE2_SKILL_TUNING.mire.damage": [4, 0.6],
  "skills.WAVE2_SKILL_TUNING.mire.tickDamage": [2, 0.3],
  "skills.WAVE3_SKILL_TUNING.siegeForm.damage": [28, 2.8],
  "combat.PLAYER.shoot.scaling": [4.3, 0.3],
  "combat.PLAYER.special.scaling": [34, 2],
};

const ATTR_FIELDS = new Set(["base", ...ATTR_KEYS]);

function isScaling(v: unknown): v is Scaling {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.base === "number" && Object.keys(r).every((k) => ATTR_FIELDS.has(k));
}

/** JSON の中の Scaling をパスつきで全部拾う（振り直し前の表と同じパスの書き方） */
function collectPaths(v: unknown, path: string, out: Map<string, Scaling>): Map<string, Scaling> {
  if (Array.isArray(v)) {
    v.forEach((c, i) => collectPaths(c, `${path}[${i}]`, out));
    return out;
  }
  if (isScaling(v)) {
    out.set(path, v);
    return out;
  }
  if (v && typeof v === "object") {
    for (const [k, c] of Object.entries(v)) if (k !== "_note") collectPaths(c, `${path}.${k}`, out);
  }
  return out;
}

function collectScalings(v: unknown, out: Scaling[] = []): Scaling[] {
  if (isScaling(v)) {
    out.push(v);
    return out;
  }
  if (v && typeof v === "object") for (const c of Object.values(v)) collectScalings(c, out);
  return out;
}

function coefSum(s: Readonly<AttrRatio>): number {
  return ATTR_KEYS.reduce((a, k) => a + (s[k] ?? 0), 0);
}

function refs(s: Readonly<AttrRatio>): AttrKey[] {
  return ATTR_KEYS.filter((k) => (s[k] ?? 0) > 0);
}

/** 係数が最大のステータス（同率なら全部） */
function mainAttrs(s: Readonly<AttrRatio>): AttrKey[] {
  const max = Math.max(...ATTR_KEYS.map((k) => s[k] ?? 0));
  if (max <= 0) return [];
  return ATTR_KEYS.filter((k) => (s[k] ?? 0) === max);
}

const CURRENT = new Map<string, Scaling>();
collectPaths(weaponsJson, "weapons", CURRENT);
collectPaths(skillsJson, "skills", CURRENT);
collectPaths(combatJson, "combat", CURRENT);

interface Action {
  readonly label: string;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
}

/** 武器種ごとの全行動（3 段・ダッシュ攻撃・派生（固有技の振りを含む）・溜め・投げる技） */
function movesetActions(key: keyof typeof MOVESETS): Action[] {
  const m = MOVESETS[key];
  const out: Action[] = [];
  m.steps.forEach((s, i) => out.push({ label: `${key}.${i + 1} 段`, ...s }));
  out.push({ label: `${key}.ダッシュ攻撃`, ...m.dashAttack });
  for (const b of m.branches) out.push({ label: `${key}.${b.name}`, ...b.step });
  if (m.charge) out.push({ label: `${key}.溜め`, ...m.charge.step });
  if (m.art.kind === "throw") out.push({ label: `${key}.${m.art.name}`, ...m.art.throw });
  return out;
}

const MOVESET_KEYS = Object.keys(MOVESETS) as (keyof typeof MOVESETS)[];
const WEAPON_ACTIONS: readonly Action[] = MOVESET_KEYS.flatMap(movesetActions);

/** 与ダメを持つスキルの係数表 */
const SKILL_BLOCKS: Readonly<Record<string, unknown>> = SKILL;
const SKILL_SCALINGS: readonly { key: string; scaling: Scaling }[] = Object.values(SKILL_DEFS)
  .filter((d) => SKILL_ATTACK[d.key] !== null)
  .flatMap((d) => collectScalings(SKILL_BLOCKS[d.key]).map((scaling) => ({ key: d.key, scaling })));

const SHOT_SCALINGS: readonly Scaling[] = Object.values(SHOT_TYPES).map((s) => s.scaling ?? PLAYER.shoot.scaling);

const ALL_SCALINGS: readonly Scaling[] = [...WEAPON_ACTIONS.map((a) => a.scaling), ...SKILL_SCALINGS.map((s) => s.scaling), ...SHOT_SCALINGS];

describe("振り直しで基礎値の値は変わらない", () => {
  it.each(Object.entries(PINNED))("%s: 基礎値での威力が振り直し前と同じ", (path, [atBase]) => {
    const s = CURRENT.get(path);
    expect(s, `${path} が見つからない`).toBeDefined();
    if (!s) return;
    expect(scaledAtBase(s), `${path} の基礎値での威力`).toBeCloseTo(atBase, FLOAT_DIGITS);
  });

  it("Σ係数（成長の速さ）は振り直し前の ±25% 以内。固定値の行動だけ 0", () => {
    for (const [path, [, sum]] of Object.entries(PINNED)) {
      const s = CURRENT.get(path);
      if (!s) continue;
      const now = coefSum(s);
      if (FIXED_ACTIONS.includes(path)) {
        expect(now, `${path} は固定値`).toBe(0);
        continue;
      }
      expect(now, `${path} の Σ係数 ${sum} → ${now}`).toBeGreaterThanOrEqual(sum * (1 - SUM_TOLERANCE) - 1e-9);
      expect(now, `${path} の Σ係数 ${sum} → ${now}`).toBeLessThanOrEqual(sum * (1 + SUM_TOLERANCE) + 1e-9);
    }
  });

  it("振り直し前に無かった係数表は射撃の型だけで、基礎値で 1 発 4.3", () => {
    for (const [path, s] of CURRENT) {
      if (path in PINNED) continue;
      expect(path, "新しい係数表は射撃の型だけ").toMatch(/^weapons\.WEAPON\.shots\.\w+\.scaling$/);
      expect(scaledAtBase(s), `${path} の基礎値での威力`).toBeCloseTo(SHOT_AT_BASE, FLOAT_DIGITS);
    }
  });

  it("射撃の型はどれも基礎値で 1 発の威力が共通の係数表と同じ", () => {
    for (const s of Object.values(SHOT_TYPES)) {
      expect(scaledAtBase(s.scaling ?? PLAYER.shoot.scaling), s.key).toBeCloseTo(scaledAtBase(PLAYER.shoot.scaling), FLOAT_DIGITS);
    }
  });
});

describe("参照ステータスが行動ごとに違う", () => {
  it("武器種ごとの主な参照先（全行動の係数の合計が最大のステータス）が 5 ステータスすべてに散らばる", () => {
    const mains = new Set<AttrKey>();
    for (const key of MOVESET_KEYS) {
      const total: Partial<Record<AttrKey, number>> = {};
      for (const a of movesetActions(key)) for (const k of ATTR_KEYS) total[k] = (total[k] ?? 0) + (a.scaling[k] ?? 0);
      for (const k of mainAttrs(total)) mains.add(k);
    }
    expect([...mains].sort(), "武器種の主な参照先").toEqual([...ATTR_KEYS].sort());
  });

  it("武器種の 1 段目の参照ステータスの組は 6 種類以上ある（全武器種が同じ型ではない）", () => {
    const sigs = new Set<string>();
    for (const key of MOVESET_KEYS) {
      const first = MOVESETS[key].steps[0];
      if (first) sigs.add(refs(first.scaling).join("+"));
    }
    expect(sigs.size, [...sigs].join(" / ")).toBeGreaterThanOrEqual(6);
  });

  it("5 ステータスそれぞれを主に参照する行動が、武器とスキルの両方にある", () => {
    for (const k of ATTR_KEYS) {
      expect(WEAPON_ACTIONS.some((a) => mainAttrs(a.scaling).includes(k)), `${k} を主に参照する武器の行動`).toBe(true);
      expect(SKILL_SCALINGS.some((s) => mainAttrs(s.scaling).includes(k)), `${k} を主に参照するスキル`).toBe(true);
    }
  });

  it("3 種以上を参照する行動と、5 種すべてを参照する行動がある", () => {
    expect(ALL_SCALINGS.filter((s) => refs(s).length >= 3).length, "3 種以上を参照する行動").toBeGreaterThanOrEqual(5);
    expect(ALL_SCALINGS.some((s) => refs(s).length === ATTR_KEYS.length), "5 種すべてを参照する行動").toBe(true);
  });

  it("ステータスを参照しない行動は数個（3〜6）だけで、表に挙げたもの", () => {
    const fixed = [...CURRENT].filter(([, s]) => coefSum(s) === 0).map(([p]) => p);
    expect(fixed.sort()).toEqual([...FIXED_ACTIONS].sort());
    expect(fixed.length).toBeGreaterThanOrEqual(3);
    expect(fixed.length).toBeLessThanOrEqual(6);
  });
});

describe("怯み値・状態異常の係数", () => {
  it("武器の段の怯み値の係数は、合計が怯み値 × 2〜4% / 点に収まる", () => {
    const withRatio = WEAPON_ACTIONS.filter((a) => a.poiseRatio !== undefined);
    expect(withRatio.length, "怯み値の係数を持つ段").toBeGreaterThan(0);
    for (const a of withRatio) {
      const sum = coefSum(a.poiseRatio ?? {});
      expect(sum, `${a.label}`).toBeGreaterThanOrEqual(a.poise * POISE_RATIO_MIN);
      expect(sum, `${a.label}`).toBeLessThanOrEqual(a.poise * POISE_RATIO_MAX);
    }
  });

  it("スキルの怯み値の係数は SkillDef に通り、合計が怯み値 × 2〜4% / 点に収まる", () => {
    const withRatio = Object.values(SKILL_DEFS).filter((d) => d.poiseRatio !== undefined);
    expect(withRatio.length, "怯み値の係数を持つスキル").toBeGreaterThan(20);
    for (const d of withRatio) {
      const sum = coefSum(d.poiseRatio ?? {});
      expect(sum, d.key).toBeGreaterThanOrEqual(d.poise * POISE_RATIO_MIN);
      expect(sum, d.key).toBeLessThanOrEqual(d.poise * POISE_RATIO_MAX);
    }
  });

  it("状態異常の効果量の係数は非負で、霊力以外を参照するものもある", () => {
    const ratios = Object.values(SKILL_DEFS).flatMap((d) => (d.applies ?? []).flatMap((a) => (a.ratio ? [a.ratio] : [])));
    expect(ratios.length, "効果量の係数を持つ付与").toBeGreaterThan(0);
    for (const r of ratios) for (const k of ATTR_KEYS) expect(r[k] ?? 0).toBeGreaterThanOrEqual(0);
    expect(ratios.some((r) => refs(r).some((k) => k !== "spi")), "霊力以外を参照する効果量の係数").toBe(true);
  });
});
