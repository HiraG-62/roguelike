import type { FrameInput } from "../core/input";
import type { KeywordProfile, ResonanceStep } from "../core/keywords";
import { type Enemy, type GameState, pushLog, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_W } from "../core/view";
import { BOON, MANA, PLAYER } from "../data/tuning";
import type { PlayerStats } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { ModifierKey, SkillResource, SkillTag } from "../skills/types";
import type { JobKey } from "../data/jobs";
import { type BulletFeature, MOVESETS, type MovesetKey, bulletFeatures, usesProjectiles } from "../data/weapons";
import { currentBullet } from "../loot/bullets";
import {
  BOONS,
  BOON_ACTIONS,
  BOON_KEYS,
  type BoonAction,
  type BoonCard,
  type BoonDef,
  type BoonKey,
  type BoonLoadout,
  type BoonTag,
  type LineageKey,
  type NumericStatKey,
  type TemperStat,
} from "./boonDefs";
import {
  BOON_GRADE_LABEL,
  type BoonGrade,
  boonGradeOf,
  canRaiseGrade,
  clampGrade,
  isGraded,
  rollGrade,
  temperGrade,
} from "./boonGrade";
import { coreCursedForced, coreGradeShift, foldCoreStats } from "./boonCores";
import {
  type BoonRuleState,
  createBoonRuleState,
  onBoonDashRules,
  onBoonKillRules,
  onBoonSkillCastRules,
  resetBoonRulesForFloor,
  updateBoonRules,
} from "./boonRules";
import { STATUS_BOON_TAGS, affinity, buildProfile, statsBoonTags } from "./keywords";
import { applyStats } from "./player";

/**
 * ラン内限定の祝福 3 択。docs/ideas/run-structure.md「祝福 3 択（Boon）」。
 * 数値盛りではなく「ルール変更」を中心にし、装備のタグ（burn / dash / just など）に反応して出やすさが変わる。
 * 各システムは hasBoon で分岐し、数値系は foldBoonStats（applyStats 内）で stats に畳み込む。
 */

export {
  BOONS,
  BOON_KEYS,
  LINEAGE_LABEL,
  type BoonDef,
  type BoonKey,
  type BoonLoadout,
  type BoonTag,
  type LineageKey,
  type BoonCard,
  type BoonAction,
  type BoonChange,
  LINEAGE_KEYS,
  BOON_ACTIONS,
  BOON_ACTION_LABEL,
  BOON_CARD_LABEL,
} from "./boonDefs";

export function boonDef(key: BoonKey): BoonDef {
  return BOONS[key];
}

// -----------------------------------------------------------------------------
// 状態
// -----------------------------------------------------------------------------

export interface BoonChoice {
  options: BoonKey[];
  /** マウスが乗っているカード（-1 = なし）。入力から決まるので決定的 */
  hover: number;
  /** マウスが「呪いを受けて 4 択」の札に乗っているか */
  curseHover: boolean;
  /** 提示からの経過（実時間秒）。inputDelay までは入力を無視 */
  timer: number;
  /** 呪いを受けて 4 択にした（1 回の提示につき 1 回まで） */
  curseTaken: boolean;
  /** 受けた呪い付き祝福（表示用）。受けていなければ null */
  curse: BoonKey | null;
  /**
   * 札ごとの格（options と同じ長さ。格なしの札は 1）。省略は並だけの提示（テストの直書き）。読むときは choiceGrade を通す
   */
  grades?: BoonGrade[];
  /** 芯の提示か（呪いの札を出さない） */
  core?: boolean;
  /** この提示の格の下駄（呪いを受けて足す 4 枚目がさらに gradeBoostCurseCard を足す） */
  boost?: number;
  /** 系譜の提示なら、その系譜（出口の予告で選んだもの）。省略は系譜を問わない提示 */
  lineage?: LineageKey;
  /** 錬磨の提示（選んだ札の格を 1 段上げる。grades は今の格） */
  mode?: "temper";
  /** 入れ替えの第 2 段。options は今の加護で、その後ろに見送りの札が 1 枚並ぶ */
  replace?: BoonReplace;
}

/** 加護の枠が満ちた行動の加護を選んだときの第 2 段（docs/ideas/boon-impl.md 2-2） */
export interface BoonReplace {
  /** 取ろうとしている加護とその格 */
  incoming: BoonKey;
  incomingGrade: BoonGrade;
  action: BoonAction;
  /** 今その行動に宿っている加護（外す候補） */
  outgoing: BoonKey[];
}

/** 並べる札の枚数（入れ替えの第 2 段は見送りの札が 1 枚増える） */
export function choiceCardCount(choice: Readonly<BoonChoice>): number {
  return choice.options.length + (choice.replace ? 1 : 0);
}

/** index 番目の札の格（grades の無い提示・範囲外は並） */
export function choiceGrade(choice: Readonly<BoonChoice>, index: number): BoonGrade {
  return choice.grades?.[index] ?? 1;
}

/** 祝福のラン内の作業領域 */
export interface BoonRunState {
  /** applyStats に渡された装備由来の stats（祝福を畳み込む前）。未設定なら null */
  baseStats: PlayerStats | null;
  /** Rule 効果 reserveVault: 次の階に宝物庫を確定させる */
  vaultNext: boolean;
  /** 不退（ダッシュの型 brace）の構えの残り秒。移動 0 と構えの中の見切り（boonMoveMul / boonJustEligible） */
  guardTimer: number;
  /** 拡張の祝福（system/boonRules.ts）の作業領域 */
  rules: BoonRuleState;
  /** 取得した祝福の格（並・格なしは持たない）。state.boons は変えず別に持つ。ランの途中は保存しないので永続化しない */
  grades: Partial<Record<BoonKey, BoonGrade>>;
  /** 次の提示で 1 回だけ使う格の下駄（試練の徒が 3 択の開いていないときに積む） */
  gradeBoost: number;
  /** 次の階の到着時に出す錬磨の提示の回数（契約・出口の予告「錬磨」が積む。system/exits.ts が消費） */
  temperQueued: number;
  /** 真髄で開いた加護の枠（行動ごとに足す枚数） */
  graceOpen: Partial<Record<BoonAction, number>>;
  /** 確定枠で出す融合（違う 2 系譜の加護が同じ行動に乗ると積む。取るか、入れ替えで条件が崩れるまで残す） */
  fusionDue: BoonKey[];
  /** 研鑽の数え（Rule 効果 tally が進め、Modifier の per tally と BoonDef.temperStat が読む）。ランの途中は保存しない */
  tallies: Record<string, number>;
  /** 号令（Rule 効果 retarget）: 従魔・召喚・設置物が狙う敵と、その終わりの state.time。無ければ null */
  focus: { id: number; until: number } | null;
  /** 源と糧の共鳴（段 1 以上の語だけ、KEYWORDS 順。system/resonance.ts の refreshResonance が作り直す）。ランの途中は保存しない */
  resonance: ResonanceStep[];
}

export function createBoonRunState(): BoonRunState {
  return {
    baseStats: null,
    vaultNext: false,
    guardTimer: 0,
    rules: createBoonRuleState(),
    grades: {},
    gradeBoost: 0,
    temperQueued: 0,
    graceOpen: {},
    fusionDue: [],
    tallies: {},
    focus: null,
    resonance: [],
  };
}

export function hasBoon(state: GameState, key: BoonKey): boolean {
  return state.boons.includes(key);
}

// -----------------------------------------------------------------------------
// 系譜の枚数と錬磨（docs/ideas/boon-impl.md 2-3・2-5）。出口の予告（system/exits.ts）が読む
// -----------------------------------------------------------------------------

/** その札がこの系譜に数えられるか（融合は 2 系譜のどちらにも数える） */
function inLineage(def: BoonDef, lineage: LineageKey): boolean {
  return def.lineage === lineage || (def.fusion?.includes(lineage) ?? false);
}

/** 持っている札のうち、この系譜に数えるものの枚数（真髄の条件・出口の系譜の重み） */
export function lineageCardsOwned(state: GameState, lineage: LineageKey): number {
  return state.boons.filter((k) => inLineage(BOONS[k], lineage)).length;
}

/** この系譜でまだ取っていない、提示に出る札（加護・摂理・研鑽）の枚数。0 の系譜は祝福の出口に出さない */
export function lineageCardsRemaining(state: GameState, lineage: LineageKey): number {
  return BOON_KEYS.filter((k) => {
    const def = BOONS[k];
    if (def.lineage !== lineage || def.card === "apex" || def.card === undefined) return false;
    return !state.boons.includes(k);
  }).length;
}

// -----------------------------------------------------------------------------
// 加護の枠・真髄・融合（docs/ideas/boon-impl.md 2-2・2-4）
// -----------------------------------------------------------------------------

/** その行動に宿っている加護（取得順。state.boons を正とし、別の配列は持たない） */
export function gracesOf(state: GameState, action: BoonAction): BoonKey[] {
  return state.boons.filter((k) => BOONS[k].card === "grace" && BOONS[k].action === action);
}

/** その行動の加護の枠の数（BOON.graceSlots + 真髄で開いた分。graceSlotsMax で止める） */
export function graceSlotsOf(state: GameState, action: BoonAction): number {
  // 真髄が開いた枠と、名のある遺物が開く枠（stats.graceSlotBonus）を足して上限で切る
  const open = (state.boonRun.graceOpen[action] ?? 0) + (state.stats.graceSlotBonus[action] ?? 0);
  return Math.min(BOON.graceSlotsMax, BOON.graceSlots + open);
}

function graceSlotFree(state: GameState, action: BoonAction): boolean {
  return gracesOf(state, action).length < graceSlotsOf(state, action);
}

/** 同じ行動に同じ系譜の加護を既に持っているか（同じ系譜の加護は 1 行動に 1 枚） */
function hasLineageGraceOn(owned: readonly BoonKey[], def: BoonDef): boolean {
  if (def.card !== "grace" || def.lineage === undefined) return false;
  return owned.some((k) => {
    const o = BOONS[k];
    return o.key !== def.key && o.card === "grace" && o.action === def.action && o.lineage === def.lineage;
  });
}

/** 系譜の真髄の札（無い系譜は undefined） */
function apexOf(lineage: LineageKey): BoonDef | undefined {
  return BOON_KEYS.map(boonDef).find((d) => d.lineage === lineage && d.card === "apex");
}

/** 次の系譜の提示の 1 枚目に確定で入る真髄（その系譜の札が apexMinCards 枚以上で、まだ持っていない） */
function dueApex(state: GameState, lineage: LineageKey): BoonKey | null {
  const def = apexOf(lineage);
  if (!def || hasBoon(state, def.key)) return null;
  return lineageCardsOwned(state, lineage) >= BOON.apexMinCards ? def.key : null;
}

/** 真髄を取ったら、その系譜の加護が宿っている行動の枠を 1 つずつ開く */
function openApexSlots(state: GameState, lineage: LineageKey): void {
  const open = state.boonRun.graceOpen;
  for (const action of BOON_ACTIONS) {
    const onAction = gracesOf(state, action).some((k) => BOONS[k].lineage === lineage);
    if (!onAction || graceSlotsOf(state, action) >= BOON.graceSlotsMax) continue;
    open[action] = (open[action] ?? 0) + 1;
  }
}

/** その行動に加護を宿している系譜（重複なし、取得順） */
function lineagesOnAction(owned: readonly BoonKey[], action: BoonAction): LineageKey[] {
  const out: LineageKey[] = [];
  for (const k of owned) {
    const d = BOONS[k];
    if (d.card !== "grace" || d.action !== action || d.lineage === undefined || out.includes(d.lineage)) continue;
    out.push(d.lineage);
  }
  return out;
}

/** 2 系譜の組の融合（無ければ null） */
function fusionFor(a: LineageKey, b: LineageKey): BoonKey | null {
  const def = BOON_KEYS.map(boonDef).find((d) => d.fusion !== undefined && d.fusion.includes(a) && d.fusion.includes(b));
  return def?.key ?? null;
}

/** 融合の条件（組の 2 系譜の加護が同じ行動に乗っている）が今も成り立つか */
function fusionHolds(owned: readonly BoonKey[], def: BoonDef): boolean {
  const pair = def.fusion;
  if (!pair) return false;
  return BOON_ACTIONS.some((action) => {
    const lineages = lineagesOnAction(owned, action);
    return pair.every((l) => lineages.includes(l));
  });
}

/** 融合の確定枠を数え直す（取ったもの・条件が崩れたものを外し、新しく揃った組を積む）。grant / remove の後に呼ぶ */
export function refreshFusionDue(state: GameState): void {
  const run = state.boonRun;
  run.fusionDue = run.fusionDue.filter((k) => !hasBoon(state, k) && fusionHolds(state.boons, BOONS[k]));
  for (const action of BOON_ACTIONS) {
    const lineages = lineagesOnAction(state.boons, action);
    for (let i = 0; i < lineages.length; i++) {
      for (let j = i + 1; j < lineages.length; j++) {
        const a = lineages[i];
        const b = lineages[j];
        if (a === undefined || b === undefined) continue;
        const key = fusionFor(a, b);
        if (key === null || hasBoon(state, key) || run.fusionDue.includes(key)) continue;
        run.fusionDue.push(key);
      }
    }
  }
}

/** 祝福を 1 つ外して stats を畳み直す（呪いを解く・呪詛の声・加護の入れ替え）。格も消し、融合の確定枠を数え直す */
export function removeBoon(state: GameState, key: BoonKey): void {
  const i = state.boons.indexOf(key);
  if (i < 0) return;
  state.boons.splice(i, 1);
  delete state.boonRun.grades[key];
  applyBoonsToStats(state);
  refreshFusionDue(state);
}

// -----------------------------------------------------------------------------
// 錬磨（docs/ideas/boon-impl.md 2-5）: 持っている札の格を 1 段上げる。至高・極致はここでだけ届く
// -----------------------------------------------------------------------------

/** 錬磨で格を上げられる札（格の対象で、極致に届いていない。取得順） */
export function temperCandidates(state: GameState): BoonKey[] {
  return state.boons.filter((k) => {
    const def = BOONS[k];
    return def.core !== true && isGraded(def) && canRaiseGrade(boonGradeOf(state, k));
  });
}

/** 錬磨で格を上げられる札を 1 枚以上持っているか（出口の予告「錬磨」を並べる条件） */
export function canTemper(state: GameState): boolean {
  return temperCandidates(state).length > 0;
}

/**
 * 錬磨の提示を開く（出口の予告「錬磨」の到着時・契約）。格を上げられる札から state.rng で最大 temperOfferCount 枚。
 * 既に提示が開いている・上げられる札が無いなら開かずに false（持ち越すかは呼び元が boonRun.temperQueued で決める）
 */
export function offerTemper(state: GameState): boolean {
  if (state.boonChoice) return false;
  const pool = temperCandidates(state);
  if (pool.length === 0) return false;
  const options: BoonKey[] = [];
  while (options.length < BOON.temperOfferCount && pool.length > 0) {
    const [picked] = pool.splice(state.rng.int(0, pool.length - 1), 1);
    if (picked) options.push(picked);
  }
  state.boonChoice = {
    options,
    hover: -1,
    curseHover: false,
    timer: 0,
    curseTaken: false,
    curse: null,
    grades: options.map((k) => boonGradeOf(state, k)),
    mode: "temper",
  };
  pushSfx(state, "boonOffer");
  return true;
}

/** 錬磨で 1 枚の格を上げる（極致で止まる）。ログは「錬磨: 火種 - 至高」 */
export function temperBoon(state: GameState, key: BoonKey): void {
  if (!hasBoon(state, key)) return;
  const def = boonDef(key);
  if (!isGraded(def)) return;
  const grade = temperGrade(boonGradeOf(state, key));
  state.boonRun.grades[key] = grade;
  applyBoonsToStats(state);
  const color = grantColor(def, grade);
  pushLog(state, `${TEMPER_LABEL}: ${def.name} - ${BOON_GRADE_LABEL[grade]}`, color);
  pushSfx(state, "boonSelect");
}

const TEMPER_LABEL = "錬磨";
/** 入れ替えで新しい札を取らなかったときのログ */
const PASS_LABEL = "見送り";

// -----------------------------------------------------------------------------
// 装備タグと抽選
// -----------------------------------------------------------------------------

/**
 * 装備（stats）から祝福タグを読む。keystones / triggers / 状態異常の有無に反応する。
 * 推論の表は共通語彙と共有している（system/keywords.ts の statsBoonTags）
 */
export function equipmentTags(stats: Readonly<PlayerStats>): Set<BoonTag> {
  return statsBoonTags(stats);
}

/** スキル石のタグ → 祝福タグ（範囲・強化・詠唱は対応する祝福の系統が無いので読まない） */
const SKILL_TAG_TO_BOON: Readonly<Partial<Record<SkillTag, BoonTag>>> = {
  melee: "melee",
  projectile: "ranged",
  movement: "dash",
  defense: "counter",
  placed: "placed",
  fire: "burn",
  cold: "chill",
  lightning: "shock",
};

/** 装着中のスキル石から祝福タグを読む（タグ・資源・命中で付ける状態異常） */
export function skillStoneTags(state: GameState): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  const rs = state.skills;
  for (let i = 0; i < rs.slots.length; i++) {
    const stone = stoneInSlot(rs.profile, i);
    if (!stone) continue;
    const def = SKILL_DEFS[stone.skillKey];
    tags.add("skill");
    if (def.resource === "mana") tags.add("mana");
    for (const t of def.tags) {
      const tag = SKILL_TAG_TO_BOON[t];
      if (tag) tags.add(tag);
    }
    for (const a of def.applies ?? []) {
      for (const tag of STATUS_BOON_TAGS[a.kind] ?? []) tags.add(tag);
    }
  }
  return tags;
}

/** 取得済みの祝福が「出す」タグ */
export function boonGivenTags(boons: readonly BoonKey[]): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  for (const key of boons) for (const t of BOONS[key].gives ?? []) tags.add(t);
  return tags;
}

/** 今の武器種・弾の性質・ジョブ（BoonDef.loadout の照合に使う） */
export interface LoadoutNow {
  moveset: MovesetKey;
  bullet: readonly BulletFeature[];
  job: JobKey;
}

/** 抽選に使うタグ。owned = 装備 + スキル石（requires はこちらだけを見る）、gives = 取得済み祝福が出すもの */
export interface BuildTags {
  owned: ReadonlySet<BoonTag>;
  gives: ReadonlySet<BoonTag>;
  loadout?: LoadoutNow;
}

export function buildTags(state: GameState): BuildTags {
  // 祝福を畳み込む前の装備 stats で判定する（triggerHappy の射撃速度 x2 などを「装備のタグ」と誤認しない）
  const base = state.boonRun.baseStats ?? state.stats;
  const owned = equipmentTags(base);
  // 指輪・首飾りの射撃性質だけでは撃てない（弾を出せない武器種なら装備由来の ranged タグを外す）。
  // スキル石由来の ranged（遠距離スキル石）は後で足すので、ここで消しても残らないようにする
  if (!usesProjectiles(MOVESETS[base.moveset])) owned.delete("ranged");
  for (const t of skillStoneTags(state)) owned.add(t);
  return { owned, gives: boonGivenTags(state.boons), loadout: { moveset: base.moveset, bullet: bulletFeatures(currentBullet(base)), job: state.job } };
}

/** loadout の列を持つなら、今の武器種・弾の性質・ジョブがその列に入っているか。now が無ければ（テストの直接呼び出し）通す */
export function loadoutMatches(want: BoonLoadout | undefined, now: LoadoutNow | undefined): boolean {
  if (want === undefined || now === undefined) return true;
  if (want.movesets && !want.movesets.includes(now.moveset)) return false;
  if (want.bullets && !want.bullets.some((f) => now.bullet.includes(f))) return false;
  if (want.jobs && !want.jobs.includes(now.job)) return false;
  return true;
}

const NO_TAGS: ReadonlySet<BoonTag> = new Set();

/**
 * 候補の重み。取得済み / requires を満たさない / 真髄の条件（その系譜の札 apexMinCards 枚）に届かない /
 * 融合の条件（組の 2 系譜の加護が同じ行動に乗る）が無い / 同じ行動に同じ系譜の加護を持っているなら 0。
 * 基礎は札の種類の重み（札の種類を持たない呪い付き・芯と真髄は BOON.baseWeight）。
 * 装備・スキル石のタグの一致で大きく、取得済み祝福の「出す」タグの一致で小さく上がる（同じタグは二重に数えない）
 */
export function boonWeight(
  def: BoonDef,
  tags: ReadonlySet<BoonTag>,
  owned: readonly BoonKey[],
  gives: ReadonlySet<BoonTag> = NO_TAGS,
  loadout?: LoadoutNow,
): number {
  if (owned.includes(def.key)) return 0;
  if (!loadoutMatches(def.loadout, loadout)) return 0;
  if (hasLineageGraceOn(owned, def)) return 0;
  if (def.requires && !tags.has(def.requires)) return 0;
  if (!apexReady(owned, def) || (def.fusion !== undefined && !fusionHolds(owned, def))) return 0;
  const matches = def.tags.filter((t) => tags.has(t)).length;
  const fed = def.tags.filter((t) => gives.has(t) && !tags.has(t)).length;
  let weight = baseWeight(def) * (1 + BOON.tagBonus * matches + BOON.givesTagBonus * fed);
  if (sharesCoreTag(def, owned)) weight *= BOON.coreTagBonus;
  return weight;
}

/** 抽選の基礎の重み（加護・摂理・研鑽・融合は札の種類の重み、それ以外は baseWeight） */
function baseWeight(def: BoonDef): number {
  return isDrawnCard(def.card) ? BOON.cardWeight[def.card] : BOON.baseWeight;
}

/** 真髄なら、その系譜の札を apexMinCards 枚以上持っているか（真髄でなければ true） */
function apexReady(owned: readonly BoonKey[], def: BoonDef): boolean {
  if (def.card !== "apex" || def.lineage === undefined) return true;
  const lineage = def.lineage;
  return owned.filter((k) => inLineage(BOONS[k], lineage)).length >= BOON.apexMinCards;
}

/** 持っている芯（1 ランに 1 つ）。無ければ null */
export function ownedCoreDef(owned: readonly BoonKey[]): BoonDef | null {
  for (const key of owned) {
    const def = BOONS[key];
    if (def.core === true) return def;
  }
  return null;
}

/** 芯のタグと 1 つでも重なる通常の祝福か（芯で方向性を決めたら、その系統を寄せる） */
function sharesCoreTag(def: BoonDef, owned: readonly BoonKey[]): boolean {
  if (def.core === true) return false;
  const core = ownedCoreDef(owned);
  return core !== null && def.tags.some((t) => core.tags.includes(t));
}

/** 芯の候補（core: true）。通常の 3 択・4 枚目からは除く */
function coreDefs(): BoonDef[] {
  return BOON_KEYS.map(boonDef).filter((d) => d.core === true);
}

/**
 * 共通語彙の相性による重み倍率。候補が今のビルドの飢え（食うのに誰も出さない語）を 1 つでも埋めるなら上げる。
 * 0 の重み（出ない候補）は 0 のまま
 */
export function boonAffinityMul(def: BoonDef, build: Readonly<KeywordProfile>): number {
  return affinity(def.keywords, build).fills.length > 0 ? BOON.affinityWeightMul : 1;
}

/** 重み付きで 1 つ取り出す（pool から除く）。全て 0 なら null */
function takeWeighted(state: GameState, pool: BoonDef[], tags: BuildTags, build: Readonly<KeywordProfile>): BoonDef | null {
  return takeWeightedBy(state, pool, (d) => boonWeight(d, tags.owned, state.boons, tags.gives, tags.loadout) * boonAffinityMul(d, build));
}

/** 重みの関数で 1 つ取り出す（pool から除く）。乱数は合計が正のときだけ 1 回引く。全て 0 なら null */
function takeWeightedBy(state: GameState, pool: BoonDef[], weightOf: (d: BoonDef) => number): BoonDef | null {
  const weights = pool.map(weightOf);
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  let roll = state.rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll > 0) continue;
    const [picked] = pool.splice(i, 1);
    return picked ?? null;
  }
  return pool.pop() ?? null;
}

/** 同じ 3 択に並べない組: 同じ系譜 / 融合同士 */
export function isSiblingBoon(a: BoonDef, b: BoonDef): boolean {
  if (a.lineage !== undefined && a.lineage === b.lineage) return true;
  return a.fusion !== undefined && b.fusion !== undefined;
}

function dropSiblings(pool: BoonDef[], picked: BoonDef): void {
  for (let i = pool.length - 1; i >= 0; i--) {
    const d = pool[i];
    if (d && isSiblingBoon(d, picked)) pool.splice(i, 1);
  }
}

/** 3 枚（重複なし）を抽選する。cursedChance で 1 枚が呪い付き祝福になる。同じ系譜・融合は 1 枚まで */
export function rollBoonOptions(state: GameState): BoonKey[] {
  const tags = buildTags(state);
  const build = buildProfile(state);
  const all = BOON_KEYS.map(boonDef).filter((d) => d.core !== true);
  const normal = all.filter((d) => !d.cursed);
  const cursed = all.filter((d) => d.cursed);
  const picks: BoonDef[] = [];
  const take = (pool: BoonDef[]): BoonDef | null => {
    const picked = takeWeighted(state, pool, tags, build);
    if (!picked) return null;
    dropSiblings(normal, picked);
    dropSiblings(cursed, picked);
    picks.push(picked);
    return picked;
  };
  const wantCursed = state.rng.chance(BOON.cursedChance) || coreCursedForced(state);
  if (wantCursed) take(cursed);
  while (picks.length < BOON.choiceCount) {
    if (!take(normal) && !take(cursed)) break;
  }
  // 呪い枠の位置もランダム（いつも左端だと読まれる）
  if (wantCursed && picks.length > 1) {
    const [first] = picks.splice(0, 1);
    if (first) picks.splice(state.rng.int(0, picks.length), 0, first);
  }
  return picks.map((d) => d.key);
}

// -----------------------------------------------------------------------------
// 系譜の提示（docs/ideas/boon-impl.md 2-7）: 出口の予告で選んだ 1 系譜の札だけが並ぶ
// -----------------------------------------------------------------------------

/** 系譜の提示に重みで出る札の種類（真髄・融合は確定枠でだけ出る） */
type DrawnCard = Exclude<BoonCard, "apex">;

function isDrawnCard(card: BoonCard | undefined): card is DrawnCard {
  return card === "grace" || card === "law" || card === "temper";
}

/** 系譜の提示の候補（その系譜の、取っていない加護・摂理・研鑽） */
function lineagePool(state: GameState, lineage: LineageKey): BoonDef[] {
  return BOON_KEYS.map(boonDef).filter((d) => d.lineage === lineage && d.cursed !== true && isDrawnCard(d.card) && !hasBoon(state, d.key));
}

/**
 * 系譜の提示での重み: BOON.cardWeight × 枠に空きのある加護なら graceFreeMul × 語の潤い。
 * 今の武器種・弾・ジョブに合わない札、同じ行動に同じ系譜の加護を持っている札は 0
 */
export function lineageCardWeight(state: GameState, def: BoonDef, loadout: LoadoutNow | undefined, build: Readonly<KeywordProfile>): number {
  if (!isDrawnCard(def.card) || !loadoutMatches(def.loadout, loadout) || hasLineageGraceOn(state.boons, def)) return 0;
  const free = def.card === "grace" && def.action !== undefined && graceSlotFree(state, def.action);
  return BOON.cardWeight[def.card] * (free ? BOON.graceFreeMul : 1) * boonAffinityMul(def, build);
}

/** 同じ提示に並べない組: 同じ札の種類 × 同じ行動 */
function sameSlot(a: BoonDef, b: BoonDef): boolean {
  return a.card === b.card && a.action === b.action;
}

/** 確定枠（rng を引かない）: 真髄 → 融合の順に 1 枚ずつ */
function fixedLineageCards(state: GameState, lineage: LineageKey): BoonKey[] {
  const out: BoonKey[] = [];
  const apex = dueApex(state, lineage);
  if (apex !== null) out.push(apex);
  const fusion = state.boonRun.fusionDue.find((k) => !hasBoon(state, k));
  if (fusion !== undefined) out.push(fusion);
  return out;
}

/**
 * 系譜の 3 枚を抽選する。確定枠（真髄・融合）を先頭に置き、呪い枠（cursedChance）は据え置き、残りを系譜の札から重みで引く。
 * 同じ札の種類 × 行動は 1 枚までにするが、それで 3 枚に届かない系譜は残りから重ねて埋める（札が少ない系譜で提示が痩せないように）
 */
export function rollLineageOptions(state: GameState, lineage: LineageKey): BoonKey[] {
  const tags = buildTags(state);
  const build = buildProfile(state);
  const fixed = fixedLineageCards(state, lineage);
  const picks: BoonDef[] = fixed.map(boonDef);
  const weightOf = (d: BoonDef): number => lineageCardWeight(state, d, tags.loadout, build);
  const wantCursed = state.rng.chance(BOON.cursedChance) || coreCursedForced(state);
  const cursedPool = BOON_KEYS.map(boonDef).filter((d) => d.cursed && d.core !== true);
  const cursed = wantCursed && picks.length < BOON.choiceCount ? takeWeighted(state, cursedPool, tags, build) : null;
  const room = (): boolean => picks.length + (cursed ? 1 : 0) < BOON.choiceCount;
  const pool = lineagePool(state, lineage).filter((d) => !fixed.includes(d.key));
  const spare: BoonDef[] = [];
  while (room()) {
    const picked = takeWeightedBy(state, pool, weightOf);
    if (!picked) break;
    picks.push(picked);
    for (let i = pool.length - 1; i >= 0; i--) {
      const d = pool[i];
      if (d && sameSlot(d, picked)) spare.push(...pool.splice(i, 1));
    }
  }
  while (room()) {
    const picked = takeWeightedBy(state, spare, weightOf);
    if (!picked) break;
    picks.push(picked);
  }
  // 呪い枠の位置もランダム（確定枠より後ろ。いつも同じ位置だと読まれる）
  if (cursed) picks.splice(state.rng.int(fixed.length, picks.length), 0, cursed);
  return picks.map((d) => d.key);
}

/** 芯だけの 3 択（呪い枠なし、coreChoiceCount 枚。重みは boonWeight と同じ） */
export function rollCoreOptions(state: GameState): BoonKey[] {
  const tags = buildTags(state);
  const build = buildProfile(state);
  const pool = coreDefs();
  const picks: BoonKey[] = [];
  while (picks.length < BOON.coreChoiceCount) {
    const picked = takeWeighted(state, pool, tags, build);
    if (!picked) break;
    dropSiblings(pool, picked);
    picks.push(picked.key);
  }
  return picks;
}

/** 芯を出す提示か（深度 coreDepth で、まだ芯を持っていない） */
function wantsCore(state: GameState): boolean {
  return state.depth === BOON.coreDepth && ownedCoreDef(state.boons) === null;
}

/** 格の確率への加算（芯の呪い喰い。boonCores.ts） */
function gradeShift(state: GameState): number {
  return coreGradeShift(state);
}

/** 札 1 枚の格。格の対象でない札（呪い付き・効果量を持たない祝福・芯）は並 */
function rollCardGrade(state: GameState, key: BoonKey, boost: number): BoonGrade {
  const def = boonDef(key);
  if (def.core === true || !isGraded(def)) return 1;
  return rollGrade(state.rng, state.depth, boost, gradeShift(state));
}

/** 階段で降りた提示の格の下駄（ボス階の直後だけ）。floor.ts が isBossDepth(depth - 1) を渡す */
export function stairsGradeBoost(afterBoss: boolean): number {
  return afterBoss ? BOON.gradeBoostAfterBoss : 0;
}

/**
 * 3 択を提示する（階段で降りた直後。depth 2 以降）。深度 coreDepth の最初の提示は芯だけの 3 択。
 * boost は格の下駄（試練の制圧・ボス階の直後）。boonRun.gradeBoost もここで 1 回だけ使う（芯の提示では使わない）
 */
export function offerBoons(state: GameState, boost = 0, lineage?: LineageKey): void {
  if (state.depth < 2) return;
  if (wantsCore(state)) {
    const cores = rollCoreOptions(state);
    if (cores.length > 0) {
      openChoice(state, cores, cores.map((): BoonGrade => 1), true, 0);
      return;
    }
  }
  const drawn = lineage === undefined ? null : rollLineageOptions(state, lineage);
  // 系譜の札が 1 枚も並ばない（取り尽くした系譜）なら、系譜を問わない抽選に戻す
  const byLineage = drawn !== null && drawn.some((k) => !BOONS[k].cursed);
  const options = byLineage && drawn !== null ? drawn : rollBoonOptions(state);
  if (options.length === 0) return;
  const total = boost + state.boonRun.gradeBoost;
  state.boonRun.gradeBoost = 0;
  openChoice(state, options, options.map((k) => rollCardGrade(state, k, total)), false, total, byLineage ? lineage : undefined);
}

function openChoice(state: GameState, options: BoonKey[], grades: BoonGrade[], core: boolean, boost: number, lineage?: LineageKey): void {
  state.boonChoice = { options, hover: -1, curseHover: false, timer: 0, curseTaken: false, curse: null, grades, core, boost };
  if (lineage !== undefined) state.boonChoice.lineage = lineage;
  pushSfx(state, "lootRare");
  pushSfx(state, "boonOffer");
}

/**
 * Rule の offerBoons（試練の徒）。試練の制圧で 3 択が既に開いていれば、その格の対象の札を gradeBoostTrialSeeker 段上げる。
 * 開いていなければ下駄を積んで提示する
 */
export function offerBoonsFromRule(state: GameState): void {
  const c = state.boonChoice;
  if (!c) {
    state.boonRun.gradeBoost += BOON.gradeBoostTrialSeeker;
    offerBoons(state);
    return;
  }
  if (c.core === true || c.mode === "temper" || c.replace) return;
  c.grades = c.options.map((key, i) => {
    const grade = choiceGrade(c, i);
    return isGraded(boonDef(key)) ? clampGrade(grade + BOON.gradeBoostTrialSeeker) : grade;
  });
}

// -----------------------------------------------------------------------------
// 呪いを受けて 4 択（docs/ideas/boons-expansion.md 4-5）
// -----------------------------------------------------------------------------

/** 表の候補と並べられない / 取得済みでない、呪いなしの候補 */
function extraPool(shown: readonly BoonKey[]): BoonDef[] {
  const shownDefs = shown.map(boonDef);
  return BOON_KEYS.map(boonDef).filter(
    (d) => !d.cursed && d.core !== true && !shown.includes(d.key) && !shownDefs.some((s) => isSiblingBoon(d, s)),
  );
}

/** 系譜の提示の 4 枚目の候補（同じ系譜の、並んでいない加護・摂理・研鑽） */
function lineageExtraPool(state: GameState, lineage: LineageKey, shown: readonly BoonKey[]): BoonDef[] {
  return lineagePool(state, lineage).filter((d) => !shown.includes(d.key));
}

/** 4 枚目の重み（系譜の提示なら系譜の重み、それ以外は今までの重み） */
function extraWeightOf(state: GameState, c: Readonly<BoonChoice>): (d: BoonDef) => number {
  const tags = buildTags(state);
  const build = buildProfile(state);
  if (c.lineage !== undefined) return (d) => lineageCardWeight(state, d, tags.loadout, build);
  return (d) => boonWeight(d, tags.owned, state.boons, tags.gives, tags.loadout) * boonAffinityMul(d, build);
}

/** 4 枚目の候補（系譜の提示は同じ系譜から。呪いを受けても 1 提示 1 系譜を崩さない） */
function extraCandidates(state: GameState, c: Readonly<BoonChoice>): BoonDef[] {
  return c.lineage === undefined ? extraPool(c.options) : lineageExtraPool(state, c.lineage, c.options);
}

/** いま呪いを受けて 4 択にできるか（未使用・受けられる呪いと 4 枚目の候補がある） */
export function canTakeCurse(state: GameState): boolean {
  const c = state.boonChoice;
  if (!c || c.core === true || c.mode === "temper" || c.replace || c.curseTaken || c.options.length >= BOON.choiceCountWithCurse) return false;
  const tags = buildTags(state);
  const owned = [...state.boons, ...c.options];
  const hasCurse = BOON_KEYS.some((k) => BOONS[k].cursed && boonWeight(BOONS[k], tags.owned, owned, tags.gives, tags.loadout) > 0);
  const weightOf = extraWeightOf(state, c);
  const hasExtra = extraCandidates(state, c).some((d) => weightOf(d) > 0);
  return hasCurse && hasExtra;
}

/**
 * 呪い付き祝福を 1 つ強制で受け、4 枚目の候補を足す。呪いは「罰」ではなく「選択肢を買う通貨」。
 * 呪いで真髄の枚数が揃うこともあるので、4 枚目は受けた後の持ち物で抽選する
 */
export function takeCurse(state: GameState): boolean {
  const c = state.boonChoice;
  if (!c || !canTakeCurse(state)) return false;
  const cursedPool = BOON_KEYS.map(boonDef).filter((d) => d.cursed && !c.options.includes(d.key));
  const curse = takeWeighted(state, cursedPool, buildTags(state), buildProfile(state));
  if (!curse) return false;
  grantBoon(state, curse.key);
  c.curseTaken = true;
  c.curse = curse.key;
  const extra = takeWeightedBy(state, extraCandidates(state, c), extraWeightOf(state, c));
  if (!extra) return true;
  // 呪いで買った 4 枚目は格が 1 段上がる（grades は options と同じ長さに揃えてから足す）
  const grades = c.options.map((_, i) => choiceGrade(c, i));
  c.options.push(extra.key);
  c.grades = [...grades, rollCardGrade(state, extra.key, (c.boost ?? 0) + BOON.gradeBoostCurseCard)];
  return true;
}

// -----------------------------------------------------------------------------
// 選択 UI のレイアウトと入力
// -----------------------------------------------------------------------------

export const BOON_CARD = {
  w: 128,
  /** 4 択（呪いを受けた後）のときの幅と間隔。480 px に 4 枚収める */
  narrowW: 108,
  h: 150,
  gap: 12,
  narrowGap: 8,
  y: 60,
  /** ホバーで浮く量（px） */
  hoverLift: 4,
  /** 「呪いを受けて 4 択」の札（カードの下） */
  curseW: 200,
  curseH: 14,
  curseGap: 8,
} as const;

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** index 番目のカード矩形（画面座標）。描画と当たり判定で共有する */
export function boonCardRect(index: number, count: number): CardRect {
  const narrow = count > BOON.choiceCount;
  const w = narrow ? BOON_CARD.narrowW : BOON_CARD.w;
  const gap = narrow ? BOON_CARD.narrowGap : BOON_CARD.gap;
  const total = count * w + (count - 1) * gap;
  const x0 = Math.round((VIEW_W - total) / 2);
  return { x: x0 + index * (w + gap), y: BOON_CARD.y, w, h: BOON_CARD.h };
}

/** 「呪いを受けて 4 択」の札の矩形 */
export function boonCurseRect(): CardRect {
  const w = BOON_CARD.curseW;
  return { x: Math.round((VIEW_W - w) / 2), y: BOON_CARD.y + BOON_CARD.h + BOON_CARD.curseGap, w, h: BOON_CARD.curseH };
}

function inRect(point: Vec, r: CardRect): boolean {
  return point.x >= r.x && point.x < r.x + r.w && point.y >= r.y && point.y < r.y + r.h;
}

export function cardIndexAt(point: Vec, count: number): number {
  for (let i = 0; i < count; i++) {
    const r = boonCardRect(i, count);
    if (inRect(point, { ...r, y: r.y - BOON_CARD.hoverLift, h: r.h + BOON_CARD.hoverLift })) return i;
  }
  return -1;
}

/**
 * 入力から選んだカード。クリックはカード上のみ。E（attack）は 3 枚目、4（skill4）は 4 枚目。無ければ -1
 * パッドの A は attackPressed も同時に立つが、ここでは confirm 扱いで 1 枚目にする
 * （3 枚目は attackPressed かつ padConfirmPressed でないときだけ＝RT 単独のときのみ）
 */
function selectedIndex(input: FrameInput, hover: number): number {
  if (input.skill1Pressed || input.padConfirmPressed) return 0;
  if (input.skill2Pressed) return 1;
  if (input.skill4Pressed) return 3;
  // クリックと attackPressed は同じ元なので、クリックならカード判定だけを使う
  if (input.clickPressed) return hover;
  if (input.attackPressed && !input.padConfirmPressed) return 2;
  return -1;
}

/** 呪いの札を押したか（3 / X か、札のクリック） */
function curseRequested(input: FrameInput, curseHover: boolean): boolean {
  return input.skill3Pressed || (input.clickPressed && curseHover);
}

/** 選択中の 1 ステップ（step から呼ぶ。他の更新は止まっている） */
export function updateBoonChoice(state: GameState, input: FrameInput, dt: number): void {
  const c = state.boonChoice;
  if (!c) return;
  c.timer += dt;
  const count = choiceCardCount(c);
  c.hover = input.aimScreen ? cardIndexAt(input.aimScreen, count) : -1;
  c.curseHover = input.aimScreen !== null && inRect(input.aimScreen, boonCurseRect());
  if (c.timer < BOON.inputDelay) return;
  if (curseRequested(input, c.curseHover)) {
    takeCurse(state);
    return;
  }
  const index = selectedIndex(input, c.hover);
  if (index < 0 || index >= count) return;
  chooseBoon(state, index);
}

/**
 * index 番目の札を選ぶ。錬磨なら格を上げ、入れ替えの第 2 段なら外す札（最後の札は見送り）を決める。
 * 枠の満ちた行動の加護を選んだら提示を閉じずに第 2 段へ進む
 */
export function chooseBoon(state: GameState, index: number): void {
  const c = state.boonChoice;
  if (!c) return;
  if (c.mode === "temper") {
    state.boonChoice = null;
    const key = c.options[index];
    if (key) temperBoon(state, key);
    return;
  }
  if (c.replace) {
    state.boonChoice = null;
    resolveReplace(state, c.replace, index);
    return;
  }
  const key = c.options[index];
  const grade = choiceGrade(c, index);
  if (key && openReplace(state, c, key, grade)) return;
  state.boonChoice = null;
  if (!key) return;
  grantBoon(state, key, grade);
}

/** 枠の満ちた行動の加護なら、同じ提示を入れ替えの第 2 段に差し替える（入力の待ちも数え直す）。差し替えたら true */
function openReplace(state: GameState, c: BoonChoice, key: BoonKey, grade: BoonGrade): boolean {
  const def = boonDef(key);
  if (def.card !== "grace" || def.action === undefined || hasBoon(state, key)) return false;
  const current = gracesOf(state, def.action);
  if (current.length < graceSlotsOf(state, def.action)) return false;
  c.replace = { incoming: key, incomingGrade: grade, action: def.action, outgoing: current };
  c.options = [...current];
  c.grades = current.map((k) => boonGradeOf(state, k));
  c.hover = -1;
  c.curseHover = false;
  c.timer = 0;
  return true;
}

/** 第 2 段の選択: 外す加護を選べば入れ替え、最後の札（見送り）なら新しい札を取らない */
function resolveReplace(state: GameState, r: Readonly<BoonReplace>, index: number): void {
  const out = r.outgoing[index];
  if (out === undefined) {
    pushLog(state, PASS_LABEL, BOON.cardColor.grace);
    return;
  }
  removeBoon(state, out);
  grantBoon(state, r.incoming, r.incomingGrade);
}

/** 祝福を得る（テストからも直接使う）。grade は格（呪いの祠・契約など格を持たない入手は並） */
export function grantBoon(state: GameState, key: BoonKey, grade: BoonGrade = 1): void {
  if (hasBoon(state, key)) return;
  const def = boonDef(key);
  const kept = isGraded(def) ? grade : 1;
  // 手放して取り直した祝福に前の格を残さない
  if (kept > 1) state.boonRun.grades[key] = kept;
  else delete state.boonRun.grades[key];
  state.boons.push(key);
  applyBoonsToStats(state);
  if (def.card === "apex" && def.lineage !== undefined) openApexSlots(state, def.lineage);
  refreshFusionDue(state);
  const color = grantColor(def, kept);
  const label = BOON_GRADE_LABEL[kept];
  const name = label === "" ? def.name : `${label} ${def.name}`;
  pushLog(state, `祝福: ${name} - ${def.desc}`, color);
  pushSfx(state, "lootRare");
  pushSfx(state, def.cursed ? "boonSelectCursed" : "boonSelect");
}

/** 取得時の文字の色: 呪い付き → 格（大祝福〜極致）→ 札の種類（札の種類を持たない芯は真髄の色） */
export function grantColor(def: BoonDef, grade: BoonGrade): string {
  if (def.cursed) return BOON.cursedColor;
  const gradeColor = gradeColorOf(grade);
  if (gradeColor !== null) return gradeColor;
  return BOON.cardColor[def.card ?? "apex"];
}

/** 格の色（並は null） */
function gradeColorOf(grade: BoonGrade): string | null {
  switch (grade) {
    case 5:
      return BOON.gradeColor.pinnacle;
    case 4:
      return BOON.gradeColor.supreme;
    case 3:
      return BOON.gradeColor.divine;
    case 2:
      return BOON.gradeColor.grand;
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// 数値系: stats への畳み込み
// -----------------------------------------------------------------------------

/** 装備由来の stats に祝福を畳み込む（元の stats は変更しない）。uncapped は深みで研鑽の上限を外す */
export function foldBoonStats(stats: Readonly<PlayerStats>, boons: readonly BoonKey[], run: Readonly<BoonRunState>, uncapped = false): PlayerStats {
  const out: PlayerStats = { ...stats };
  Object.assign(out, foldCoreStats(out, boons));
  foldAddStats(out, boons);
  foldTemperStats(out, boons, run.tallies, uncapped);
  // 最終段で下限を掛ける。0 だと capManaCost がコストを 0 に切り詰めて撃ち放題になる
  out.maxMana = Math.max(MANA.maxMin, out.maxMana);
  return out;
}

/** 常時の stats への足し（BoonDef.addStats）を取得順に足す */
function foldAddStats(out: PlayerStats, boons: readonly BoonKey[]): void {
  for (const key of boons) {
    const add = BOONS[key].addStats;
    if (add === undefined) continue;
    for (const [stat, amount] of Object.entries(add) as [NumericStatKey, number][]) out[stat] += amount;
  }
}

/** 研鑽の stats への効き（BoonDef.temperStat）を取得順に足す */
function foldTemperStats(out: PlayerStats, boons: readonly BoonKey[], tallies: Readonly<Record<string, number>>, uncapped: boolean): void {
  for (const key of boons) {
    const t = BOONS[key].temperStat;
    if (t === undefined) continue;
    out[t.stat] += temperAmount(t, tallies[t.tally] ?? 0, uncapped);
  }
}

/** 研鑽の段の数（every の未満は 0 段） */
function temperSteps(t: Readonly<TemperStat>, value: number): number {
  return Math.floor(value / Math.max(1, t.every));
}

/** 研鑽が足す量: per × 段。cap があればそこで止める（uncapped = 深みでは止めない） */
export function temperAmount(t: Readonly<TemperStat>, value: number, uncapped = false): number {
  const amount = t.per * temperSteps(t, value);
  return t.cap === undefined || uncapped ? amount : Math.min(t.cap, amount);
}

/**
 * 研鑽の数えを進める（Rule 効果 tally。mode: max は最長記録）。持っている研鑽の段が変わったときだけ stats を畳み直す
 * （毎撃破で applyStats を回さない）
 */
export function addTally(state: GameState, key: string, amount: number, mode: "add" | "max" = "add"): void {
  const tallies = state.boonRun.tallies;
  const prev = tallies[key] ?? 0;
  const next = mode === "max" ? Math.max(prev, amount) : prev + amount;
  if (next === prev) return;
  tallies[key] = next;
  if (temperStepChanged(state.boons, key, prev, next)) applyBoonsToStats(state);
}

function temperStepChanged(boons: readonly BoonKey[], key: string, prev: number, next: number): boolean {
  return boons.some((k) => {
    const t = BOONS[k].temperStat;
    return t !== undefined && t.tally === key && temperSteps(t, prev) !== temperSteps(t, next);
  });
}

/** 装備の stats（祝福前）を覚えて、祝福を畳み込み直す。何度呼んでも同じ結果 */
export function applyBoonsToStats(state: GameState): void {
  const base = state.boonRun.baseStats ?? state.stats;
  applyStats(state, base);
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

export function updateBoons(state: GameState, dt: number): void {
  const run = state.boonRun;
  run.guardTimer = Math.max(0, run.guardTimer - dt);
  updateBoonRules(state, dt);
}

// -----------------------------------------------------------------------------
// フック: player.ts（札の定義から「旧フック」として参照されているものだけが残る）
// -----------------------------------------------------------------------------

const LAST_COMBO = PLAYER.melee.length - 1;

/** 専心（finisherOnly）: 近接は常に最終段から（ダッシュ攻撃は除く） */
export function boonSwingCombo(state: GameState, combo: number, dashStrike: boolean): number {
  if (dashStrike || !hasBoon(state, "finisherOnly")) return combo;
  return LAST_COMBO;
}

/** ダッシュ開始: すり抜けの記録（抜き胴）を空にする */
export function onBoonDash(state: GameState): void {
  onBoonDashRules(state);
}

/**
 * 血の対価（bloodMana）: HP が閾値以下の間だけのコスト倍率。HP で変わるので stats（manaCostMul）には畳めず、
 * skills.ts の effectiveManaCost が払う瞬間に読む（下限 MANA.costMulMin は向こうで掛かる）
 */
export function boonManaCostMul(state: GameState): number {
  const p = state.player;
  return hasBoon(state, "bloodMana") && p.hp <= p.maxHp * BOON.bloodManaHpRatio ? BOON.bloodManaCostMul : 1;
}

/** スキルの加護（BoonDef.grantsModifier）が全スロットに足す刻印符（取得順、重複なし）。skills.ts の syncSlotModifiers が読む */
export function boonGrantedModifiers(state: GameState): ModifierKey[] {
  const out: ModifierKey[] = [];
  for (const key of state.boons) {
    const m = BOONS[key].grantsModifier;
    if (m !== undefined && !out.includes(m)) out.push(m);
  }
  return out;
}

/** 構え（不退）の間は動かない */
export function boonMoveMul(state: GameState): number {
  return state.boonRun.guardTimer > 0 ? 0 : 1;
}

// -----------------------------------------------------------------------------
// フック: skills.ts
// -----------------------------------------------------------------------------

/** スキル発動（castSlot。払った後）: 四重奏（eclipse）の数えと、窓の中の気力の払い戻し。slot / resource / manaPaid は省略するとテストの直接呼び出し */
export function onBoonSkillCast(state: GameState, slot = -1, resource: SkillResource | null = null, manaPaid = 0): void {
  onBoonSkillCastRules(state, slot, resource, manaPaid);
}

// -----------------------------------------------------------------------------
// フック: combat.ts
// -----------------------------------------------------------------------------

/** 撃破時: 徘徊の撃破の記録（条件 targetRoamer） */
export function onBoonKill(state: GameState, enemy: Enemy): void {
  onBoonKillRules(state, enemy);
}

/** 無敵中に JUST 回避になる追加条件（不退の構えの中） */
export function boonJustEligible(state: GameState): boolean {
  return state.boonRun.guardTimer > 0;
}

/** 被弾後のコンボ数。不断（comboKeeper）なら半分残す */
export function comboAfterHurt(state: GameState): number {
  if (!hasBoon(state, "comboKeeper")) return 0;
  return Math.floor(state.combo.count / 2);
}

// -----------------------------------------------------------------------------
// フック: floor.ts
// -----------------------------------------------------------------------------

/** 階の始まり: 階ごとの作業領域を捨て、宝物庫の予約（Rule 効果 reserveVault）があれば空いている部屋を 1 つ宝物庫にする */
export function applyBoonFloorRules(state: GameState, reserved: ReadonlySet<number>): void {
  resetBoonRulesForFloor(state);
  const run = state.boonRun;
  if (!run.vaultNext) return;
  if (state.rooms.some((r) => r.kind === "treasure")) {
    run.vaultNext = false;
    return;
  }
  const index = state.rooms.findIndex((r, i) => !reserved.has(i) && r.kind === "normal");
  const room = state.rooms[index];
  if (!room) return;
  room.kind = "treasure";
  run.vaultNext = false;
}

/** 血の饗宴（bloodFeast）を持っているとハートが出ない */
export function boonHeartsAllowed(state: GameState): boolean {
  return !hasBoon(state, "bloodFeast");
}
