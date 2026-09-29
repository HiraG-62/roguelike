import type { DamageTag } from "../core/damage";
import type { EventSource } from "../core/events";
import { type Modifier, type Rule, type RuleCondition, ruleId } from "../core/rules";
import type { GameState } from "../core/state";
import { JOBS, JOB_KEYS, type JobKey, applyJobMul } from "../data/jobs";
import { JOB } from "../data/tuning";
import { MOVESETS, MOVESET_KEYS, type MovesetKey, isGun } from "../data/weapons";
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
 * - ステータスの偏り・得意な武器種の攻撃速度・弱点: applyJobStats（system/runSetup.ts の applyRunStats が畳み込む）
 * - 得意な武器種の威力: jobModifiers（Modifier。system/modifiers.ts の collectModifiers が誓約の後に集める）
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
  // 素手は型が拳でも武器を持っていないので、拳を得意とするジョブでも補正を取らない
  return !stats.unarmed && JOBS[job].favored.includes(stats.moveset);
}

/** 得意武器の倍の表示名 */
export const FAVORED_WEAPON_LABEL = "得意武器";

/** 銃の家系の武器種（得意武器の倍を射撃側に掛ける判定） */
const GUN_KEYS: readonly MovesetKey[] = MOVESET_KEYS.filter((k) => isGun(MOVESETS[k]));

/**
 * 得意武器の倍（ジョブの顔。装備の増と足さずに掛ける）。銃の家系なら射撃、それ以外は近接に掛かる
 * （docs/ideas/weapon-redesign.md 6 章）。見習いは得意武器を持たないので条件が満たされず効かない
 */
function favoredModifiers(job: JobKey): readonly Modifier[] {
  // EventSource に job の種類は無いので、data/jobs.ts の Rule と同じくプレイヤー由来として key で区別する
  const owner: EventSource = { kind: "player", key: `job.${job}` };
  const favored: RuleCondition = { kind: "favoredWeapon" };
  const gun: RuleCondition = { kind: "moveset", movesets: GUN_KEYS };
  const spec: readonly [DamageTag, RuleCondition][] = [
    ["melee", { kind: "not", condition: gun }],
    ["ranged", gun],
  ];
  return spec.map(([tag, weapon], i) => ({
    id: ruleId(owner, i),
    kind: "more",
    tag,
    amount: JOB.favoredMeleeMul,
    if: [favored, weapon],
    owner,
    label: FAVORED_WEAPON_LABEL,
  }));
}

const JOB_MODIFIERS: ReadonlyMap<JobKey, readonly Modifier[]> = new Map(
  JOB_KEYS.map((key) => [key, JOBS[key].favored.length > 0 ? favoredModifiers(key) : []]),
);
const NO_MODIFIERS: readonly Modifier[] = [];

/** ジョブの常時の増・倍（Modifier）。今は得意武器の倍だけ */
export function jobModifiers(job: JobKey): readonly Modifier[] {
  return JOB_MODIFIERS.get(job) ?? NO_MODIFIERS;
}

/**
 * ジョブのステータスの偏り・得意な武器種の上乗せ・弱点を stats に足す（渡した stats を書き換える。呼び出し側で複製済みのもの）。
 * 偏りは生値に足すので、逓減（deriveAttributes）はこの後にまとめて掛かる
 */
export function applyJobStats(stats: PlayerStats, job: JobKey): void {
  const def = JOBS[job];
  for (const k of ATTR_KEYS) stats.attributes[k] += def.attributes[k] ?? 0;
  if (isFavoredWeapon(stats, job)) {
    // 銃の家系なら射撃側、それ以外は近接側の速さを上げる（docs/ideas/weapon-redesign.md 6 章）。威力は jobModifiers
    if (isGun(MOVESETS[stats.moveset])) stats.fireRateMul *= JOB.favoredAttackSpeedMul;
    else stats.attackSpeedMul *= JOB.favoredAttackSpeedMul;
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
  applyStats(state, computeStats(profile.equipment, state.depth));
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
  if (def.favored.length > 0) lines.push(`得意な武器: ${jobFavoredText(job)}`);
  for (const r of def.rules) lines.push(`・${r.text}`);
  const weapon = def.starterWeapon === null ? undefined : baseDef(def.starterWeapon);
  if (weapon) lines.push(`初期武器: ${weapon.name}`);
  if (def.starterSkill !== null) lines.push(`初期スキル石: ${SKILL_DEFS[def.starterSkill].name}`);
  if (def.weakness) lines.push(`弱点: ${def.weakness.text}`);
  return lines;
}
