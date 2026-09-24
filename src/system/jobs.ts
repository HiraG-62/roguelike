import type { Rule } from "../core/rules";
import type { GameState } from "../core/state";
import { JOBS, JOB_KEYS, type JobKey, applyJobMul } from "../data/jobs";
import { JOB } from "../data/tuning";
import { MOVESETS, isGun } from "../data/weapons";
import { createRng } from "../core/rng";
import { baseDef } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { addToStash } from "../loot/profile";
import { ATTR_LABEL } from "../loot/resonance";
import { computeStats } from "../loot/stats";
import { ATTR_KEYS, type Item, type PlayerStats, type Profile } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { applyStats } from "./player";
import { stoneFromSeed } from "../skills/generator";
import { addStone } from "../skills/persistence";
import type { SkillKey, SkillProfile } from "../skills/types";

/**
 * ジョブの効果（定義は src/data/jobs.ts）。
 * - ステータスの偏り・得意な武器種・弱点: applyJobStats（system/runSetup.ts の applyRunStats が畳み込む）
 * - 固有のルール: jobRules（system/rules.ts の collectRules が祝福より前に集める）
 * - 初期スキル石・初期武器: startJob（createGame が呼ぶ。未所持のときだけ）
 */

/** ジョブごとの Rule（定義の写しを 1 度だけ作る。collectRules は毎ステップ呼ばれるため） */
const JOB_RULES: ReadonlyMap<JobKey, readonly Rule[]> = new Map(JOB_KEYS.map((key) => [key, JOBS[key].rules.map((r) => r.rule)]));
const NO_RULES: readonly Rule[] = [];

export function jobRules(job: JobKey): readonly Rule[] {
  return JOB_RULES.get(job) ?? NO_RULES;
}

/** 見習い以外は stats を変える（applyRunStats の早期リターンの判定） */
export function jobChangesStats(job: JobKey): boolean {
  return job !== "none";
}

/** 今の武器種がこのジョブの得意か */
export function isFavoredWeapon(stats: Readonly<PlayerStats>, job: JobKey): boolean {
  return JOBS[job].favored.includes(stats.moveset);
}

/**
 * ジョブのステータスの偏り・得意な武器種の上乗せ・弱点を stats に足す（渡した stats を書き換える。呼び出し側で複製済みのもの）。
 * 偏りは生値に足すので、逓減（deriveAttributes）はこの後にまとめて掛かる
 */
export function applyJobStats(stats: PlayerStats, job: JobKey): void {
  const def = JOBS[job];
  for (const k of ATTR_KEYS) stats.attributes[k] += def.attributes[k] ?? 0;
  if (isFavoredWeapon(stats, job)) {
    // 銃の家系なら射撃側、それ以外は近接側へ上乗せする（docs/ideas/weapon-redesign.md 6 章）
    if (isGun(MOVESETS[stats.moveset])) {
      stats.rangedDamageMul *= JOB.favoredMeleeMul;
      stats.fireRateMul *= JOB.favoredAttackSpeedMul;
    } else {
      stats.meleeDamageMul *= JOB.favoredMeleeMul;
      stats.attackSpeedMul *= JOB.favoredAttackSpeedMul;
    }
  }
  if (def.weakness) applyJobMul(stats, def.weakness.mul);
}

// -----------------------------------------------------------------------------
// 開始時
// -----------------------------------------------------------------------------

/** 初期スキル石の種をランの seed から離す（state.rng を使わない。他の乱数列をずらさない） */
const STONE_SALT = 0x10b5;

/** そのスキルの石を 1 つでも持っているか（装着中・倉庫を問わない） */
export function ownsSkillStone(profile: Readonly<SkillProfile>, skillKey: SkillKey): boolean {
  return profile.stones.some((s) => s.skillKey === skillKey);
}

/**
 * ジョブの初期スキル石を倉庫へ加える。そのスキルの石をまだ 1 つも持っていないときだけ（探索のたびに増やさない）。
 * 倉庫が満杯なら加えない（addStone が断る）。見習いは何もしない
 */
export function startJob(state: GameState): void {
  startJobWeapon(state);
  const skillKey = JOBS[state.job].starterSkill;
  if (skillKey === null) return;
  const profile = state.skills.profile;
  if (ownsSkillStone(profile, skillKey)) return;
  const seed = (state.seed ^ (STONE_SALT + JOB_KEYS.indexOf(state.job))) >>> 0;
  // now は id と foundAt の表示用（決定性に影響しない）
  const stone = { ...stoneFromSeed(seed, { foundDepth: state.depth, now: Date.now(), skillKey }), variants: [], links: JOB.starterStoneLinks };
  addStone(profile, stone);
}

/** 初期武器の種をランの seed から離す（初期スキル石とも別の列にする） */
const WEAPON_SALT = 0x3a7e;

/** そのベースの武器を 1 つでも持っているか（装着中・倉庫を問わない。借り物は数えない） */
export function ownsWeaponBase(profile: Readonly<Profile>, baseKey: string): boolean {
  const owned = (it: Item | null | undefined): boolean => it?.baseKey === baseKey && it.loaned !== true;
  return owned(profile.equipment.mainHand) || profile.stash.some(owned);
}

/**
 * ジョブの初期武器（素の器）を渡す。そのベースを持っていないときだけ（探索のたびに増やさない）。
 * 武器スロットが空なら装着して stats を作り直し、空でなければ倉庫へ（満杯なら渡さない）
 */
export function startJobWeapon(state: GameState): void {
  const baseKey = JOBS[state.job].starterWeapon;
  if (baseKey === null) return;
  const profile = state.profile;
  if (ownsWeaponBase(profile, baseKey)) return;
  const seed = (state.seed ^ (WEAPON_SALT + JOB_KEYS.indexOf(state.job))) >>> 0;
  const level = JOB.starterWeaponLevel;
  // now は id と foundAt の表示用（決定性に影響しない）
  const item = generateItem(createRng(seed), { baseKey, plain: true, itemLevel: level, foundDepth: level, now: Date.now() });
  if (profile.equipment.mainHand) {
    addToStash(profile, item);
    return;
  }
  profile.equipment.mainHand = item;
  // createGame は applyStats の後に startJob を呼ぶので、装着した武器種をここで stats へ流す
  applyStats(state, computeStats(profile.equipment));
}

// -----------------------------------------------------------------------------
// 表示（起点画面・装備画面が読む。何ができるかを語る）
// -----------------------------------------------------------------------------

/** 「筋力 +2 / 霊力 -2」。偏りが無ければ空文字 */
export function jobAttributeText(job: JobKey): string {
  const attrs = JOBS[job].attributes;
  return ATTR_KEYS.filter((k) => (attrs[k] ?? 0) !== 0)
    .map((k) => {
      const v = attrs[k] ?? 0;
      return `${ATTR_LABEL[k]} ${v > 0 ? "+" : ""}${v}`;
    })
    .join(" / ");
}

/** 「剣 / 大剣 / 双剣」 */
export function jobFavoredText(job: JobKey): string {
  return JOBS[job].favored.map((m) => MOVESETS[m].name).join(" / ");
}

/** 説明欄の行（1 行目の概要の後に並べる） */
export function jobDetailLines(job: JobKey): string[] {
  const def = JOBS[job];
  const lines: string[] = [];
  const attrs = jobAttributeText(job);
  if (attrs !== "") lines.push(`ステータス: ${attrs}`);
  if (def.favored.length > 0) lines.push(`得意な武器: ${jobFavoredText(job)}（近接が強く速くなる）`);
  for (const r of def.rules) lines.push(`・${r.text}`);
  const weapon = def.starterWeapon === null ? undefined : baseDef(def.starterWeapon);
  if (weapon) lines.push(`初期武器: ${weapon.name}（持っていなければ渡される）`);
  if (def.starterSkill !== null) lines.push(`初期スキル石: ${SKILL_DEFS[def.starterSkill].name}（持っていなければ倉庫に入る）`);
  if (def.weakness) lines.push(`弱点: ${def.weakness.text}`);
  return lines;
}
