import type { Rule } from "../core/rules";
import type { GameState } from "../core/state";
import { DASH_FORM_NAMES, JOBS, JOB_KEYS, type JobKey, favoredMovesets } from "../data/jobs";
import { MOVESETS } from "../data/weapons";
import type { FormKey } from "../data/weaponForms";
import { JOB } from "../data/tuning";
import { createRng } from "../core/rng";
import { baseDef } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { addToStash } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { ATTR_KEYS, ATTR_LABEL, type Item, type PlayerStats, type Profile } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { applyStats } from "./player";
import { dashFormText } from "./dashForms";
import { manaSourcesText } from "./manaSources";
import { stoneFromSeed } from "../skills/generator";
import { addStone } from "../skills/persistence";
import type { SkillKey, SkillProfile } from "../skills/types";

/**
 * ジョブ = 流儀の効果（定義は src/data/jobs.ts）。
 * - ステータスの偏り: applyJobStats（system/runSetup.ts の applyRunStats が畳み込む）
 * - ダッシュの形: system/dashForms.ts、気力の源: system/manaSources.ts（各フックから呼ばれる）
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

/**
 * 今の武器種がこのジョブの旧「得意な武器」か（data/jobs.ts の favoredMovesets。ジョブの倍率はもう無い）。
 * 得意武器を読む性質・誓約・祝福（favoredWeapon 条件）のためだけに残す
 */
export function isFavoredWeapon(stats: Readonly<PlayerStats>, job: JobKey): boolean {
  // 素手は型が拳でも武器を持っていないので、拳を得意とするジョブでも得意に数えない
  return !stats.unarmed && favoredMovesets(job).includes(stats.moveset);
}

/** ジョブの初期武器の型（武器種ではなく型。見習いは初期武器が無いので undefined） */
export function starterForm(job: JobKey): FormKey | undefined {
  const baseKey = JOBS[job].starterWeapon;
  if (baseKey === null) return undefined;
  const moveset = baseDef(baseKey)?.moveset;
  return moveset === undefined ? undefined : MOVESETS[moveset].form;
}

/**
 * 今の武器がジョブの初期武器と同じ型か（来歴の節目「初期武器と同じ型での撃破」が読む）。
 * 初期武器の武器種そのものではなく型で見る: 剣士の打刀なら、同じ型に束ねた武器種も数える。
 * 素手は武器を持っていないので、型が拳でも数えない
 */
export function isStarterFormWeapon(stats: Readonly<PlayerStats>, job: JobKey): boolean {
  if (stats.unarmed) return false;
  const form = starterForm(job);
  return form !== undefined && MOVESETS[stats.moveset].form === form;
}

/**
 * ジョブのステータスの偏りを stats に足す（渡した stats を書き換える。呼び出し側で複製済みのもの）。
 * 偏りは生値に足すので、逓減（deriveAttributes）はこの後にまとめて掛かる
 */
export function applyJobStats(stats: PlayerStats, job: JobKey): void {
  const def = JOBS[job];
  for (const k of ATTR_KEYS) stats.attributes[k] += def.attributes[k] ?? 0;
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
  const stone = { ...stoneFromSeed(seed, { foundDepth: state.depth, now: Date.now(), skillKey }), variants: [] };
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

/** 説明欄の行（1 行目の概要の後に並べる）。見習いはジョブなしなので何も並べない */
export function jobDetailLines(job: JobKey): string[] {
  if (job === "none") return [];
  const def = JOBS[job];
  const lines: string[] = [];
  const attrs = jobAttributeText(job);
  if (attrs !== "") lines.push(`ステータス: ${attrs}`);
  lines.push(`ダッシュ「${DASH_FORM_NAMES[def.dash]}」: ${dashFormText(def.dash)}`);
  lines.push(`気力: ${manaSourcesText(def.mana)}`);
  for (const r of def.rules) lines.push(`・${r.text}`);
  const weapon = def.starterWeapon === null ? undefined : baseDef(def.starterWeapon);
  if (weapon) lines.push(`初期武器: ${weapon.name}`);
  if (def.starterSkill !== null) lines.push(`初期スキル石: ${SKILL_DEFS[def.starterSkill].name}`);
  return lines;
}
