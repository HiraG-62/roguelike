import type { DamageTag } from "../core/damage";
import { KEYWORDS, KEYWORD_DEFS, type Keyword, type KeywordProfile, type ResonanceStep } from "../core/keywords";
import type { Modifier } from "../core/rules";
import type { GameState } from "../core/state";
import { JOBS } from "../data/jobs";
import { REFORGES } from "../data/reforges";
import { RESONANCE } from "../data/tuning";
import { formOfKey } from "../data/weaponForms";
import { SLOTS, TRAIT_COLORS, type Item, type PlayerStats, type TraitColor } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { BOONS } from "./boonDefs";
import { keystoneKeywords, relicKeywords, skillKeywords } from "./keywords";
import { equipmentSealed } from "./runSetup";

/**
 * 源と糧の共鳴（docs/ideas/relics-7d-plan.md 4 章）。
 * 遺物 1 つ・スキル石 1 つ・祝福 1 枚・流儀・武器の型・改鋳 1 つ・ラン内の誓約 1 つをそれぞれ出どころ 1 と数え、
 * 同じ語を出す（源）出どころと食う（糧）出どころが両方そろうと、その語に段が立つ。
 * 段は boonRun.resonance に持ち（refreshResonance が作り直す）、倍は resonanceModifiers、倍の無い語は applyResonanceStats が stats へ畳む
 */

/** 数えない語。色と反転は色の共鳴の名残で源も糧も無く、無属性は大多数なので語にしない */
export const RESONANCE_EXCLUDED: readonly Keyword[] = ["crimson", "azure", "jade", "gold", "umbra", "inverted", "elNone"];

const EXCLUDED: ReadonlySet<Keyword> = new Set(RESONANCE_EXCLUDED);

/** 倍を掛けるタグ（all = 与ダメ全部）。stats へ畳む語（KEYWORD_STAT）と数えない語はここに無い */
export const KEYWORD_TAG: Readonly<Partial<Record<Keyword, DamageTag | "all">>> = {
  melee: "melee",
  ranged: "ranged",
  bullet: "ranged",
  still: "ranged",
  placed: "placed",
  area: "area",
  explode: "area",
  combo: "melee",
  finisher: "melee",
  counter: "counter",
  crit: "critMulti",
  energy: "ultimate",
  burn: "fire",
  chill: "ice",
  shock: "lightning",
  poison: "poison",
  bleed: "dot",
  reaction: "reaction",
  stagger: "vsStaggered",
  elite: "vsElite",
  elFire: "fire",
  elIce: "ice",
  elLightning: "lightning",
  elPoison: "poison",
  elDark: "dark",
  elLight: "light",
  vulnerable: "all",
  weaken: "all",
  fear: "all",
  silence: "all",
  wall: "all",
  kill: "all",
  clear: "all",
  lowHp: "all",
  hurt: "all",
};

/** 倍の無い語が stats のどこへ効くか（量は RESONANCE.statPerStep） */
export type ResonanceStatKeyword = keyof typeof RESONANCE.statPerStep;
export const KEYWORD_STAT: readonly ResonanceStatKeyword[] = ["dash", "just", "mana", "heal", "ward"];

/** 彩痕の色 → 共鳴している状態異常の語（system/statusReactions.ts の HUE_TRIGGER と同じ対応） */
export const HUE_KEYWORD: Readonly<Record<TraitColor, Keyword>> = {
  crimson: "burn",
  azure: "chill",
  jade: "poison",
  gold: "shock",
  umbra: "vulnerable",
};

/** 語 1 つの数え（その語を出す / 食う / 強める出どころの数） */
export interface KeywordCount {
  produces: number;
  consumes: number;
  amplifies: number;
}

// -----------------------------------------------------------------------------
// 数え
// -----------------------------------------------------------------------------

/** 数えの出どころ。武器の型は祝福を畳む前の stats の武器種で決める（buildProfile と同じ） */
function resonanceSources(state: Readonly<GameState>): KeywordProfile[] {
  const out: KeywordProfile[] = [];
  // 素手の起点で封じられている間の遺物は効かないので数えない
  const equipment = equipmentSealed(state) ? null : state.profile.equipment;
  for (const slot of SLOTS) {
    const item = equipment?.[slot];
    if (item) out.push(cachedProfile(RELIC_PROFILES, relicSignature(item), () => relicKeywords(item)));
  }
  const rs = state.skills;
  for (let i = 0; i < rs.slots.length; i++) {
    const stone = stoneInSlot(rs.profile, i);
    if (!stone) continue;
    const modifiers = rs.slots[i]?.modifiers ?? [];
    out.push(cachedProfile(SKILL_PROFILES, `${stone.skillKey}|${modifiers.join(",")}`, () => skillKeywords(SKILL_DEFS[stone.skillKey], modifiers)));
  }
  for (const key of state.boons) out.push(BOONS[key].keywords);
  out.push(JOBS[state.job].keywords);
  const form = formOfKey((state.boonRun.baseStats ?? state.stats).moveset);
  if (form.keywords) out.push(form.keywords);
  // 持ち替えた型の改鋳は効かないので数えない
  for (const key of state.reforges) {
    const def = REFORGES[key];
    if (def.form === form.key && def.keywords) out.push(def.keywords);
  }
  for (const key of state.runKeystones) out.push(cachedProfile(KEYSTONE_PROFILES, key, () => keystoneKeywords(key)));
  return out;
}

/**
 * 出どころの語の写し。遺物・石・誓約の語は key（性質の key・石と符の key・誓約の key）だけで決まるので、
 * 同じ key には同じ参照を返す（refreshResonance が「出どころの参照が前と同じなら数え直さない」と判定できるように）。
 * 中身は数えるときに読むだけで書き換えない。表が膨らみすぎたら捨てて作り直す
 */
const RELIC_PROFILES = new Map<string, KeywordProfile>();
const SKILL_PROFILES = new Map<string, KeywordProfile>();
const KEYSTONE_PROFILES = new Map<string, KeywordProfile>();
const PROFILE_CACHE_MAX = 1024;

function cachedProfile(cache: Map<string, KeywordProfile>, key: string, build: () => KeywordProfile): KeywordProfile {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size >= PROFILE_CACHE_MAX) cache.clear();
  const built = build();
  cache.set(key, built);
  return built;
}

/** relicKeywords が読むもの（名のある遺物の key と、反転していない性質の key の並び） */
function relicSignature(item: Readonly<Item>): string {
  let sig = item.namedKey ?? "";
  for (const roll of item.affixes) if (roll.inverted !== true) sig += `\n${roll.key}`;
  return sig;
}

function emptyCounts(): Record<Keyword, KeywordCount> {
  return Object.fromEntries(KEYWORDS.map((k) => [k, { produces: 0, consumes: 0, amplifies: 0 }])) as Record<Keyword, KeywordCount>;
}

/** 出どころ 1 つにつき、語ごと・動詞ごとに最大 1 と数える（KeywordProfile は語の重複を持たない） */
export function countProfiles(sources: readonly Readonly<KeywordProfile>[]): Record<Keyword, KeywordCount> {
  const counts = emptyCounts();
  for (const p of sources) {
    for (const k of new Set(p.produces)) counts[k].produces += 1;
    for (const k of new Set(p.consumes)) counts[k].consumes += 1;
    for (const k of new Set(p.amplifies)) counts[k].amplifies += 1;
  }
  return counts;
}

/** 今のビルドの語の数え（遺物・スキル石・祝福・流儀・型・改鋳・ラン内の誓約） */
export function countKeywords(state: Readonly<GameState>): Record<Keyword, KeywordCount> {
  return countProfiles(resonanceSources(state));
}

/** 双頭の指輪の implicit（あと 1 つで揃う共鳴の語を成立させる。affixes.ts の IMPLICITS） */
export const TWIN_RING_IMPLICIT = "implicit.twinRing";

/**
 * 双頭の指輪が成立させる語の数（0 = 指輪なし）。implicit の値を読み、RESONANCE.ringEaseMax で切る
 * （旧セーブの遺物は昔の値 2〜4 を持つため）。装備が封じられている間は効かない
 */
export function resonanceEaseOf(state: Readonly<GameState>): number {
  if (equipmentSealed(state)) return 0;
  const implicit = state.profile.equipment.ring?.implicit;
  if (implicit?.key !== TWIN_RING_IMPLICIT) return 0;
  return Math.min(RESONANCE.ringEaseMax, Math.max(0, Math.floor(implicit.value)));
}

/** 語 1 つの段。源と糧がそれぞれ下限に届いて 1 段、その先は数と強めで上がる */
export function resonanceStepOf(c: Readonly<KeywordCount>): number {
  if (c.produces < RESONANCE.minSources || c.consumes < RESONANCE.minSinks) return 0;
  const extra = Math.floor((c.produces + c.consumes - RESONANCE.minSources - RESONANCE.minSinks) / RESONANCE.stepEvery);
  return Math.min(RESONANCE.maxSteps, 1 + extra + c.amplifies * RESONANCE.amplifyStep);
}

/** 源か糧のどちらか 1 側があと 1 つ足りない（もう 1 側は届いている）語か。双頭の指輪の対象 */
function oneShort(c: Readonly<KeywordCount>): boolean {
  const sourceShort = c.produces === RESONANCE.minSources - 1 && c.produces >= 1 && c.consumes >= RESONANCE.minSinks;
  const sinkShort = c.consumes === RESONANCE.minSinks - 1 && c.consumes >= 1 && c.produces >= RESONANCE.minSources;
  return sourceShort || sinkShort;
}

/** 双頭の指輪が成立させる語: あと 1 つで揃う語のうち、源 + 糧の多い順（同数は KEYWORDS 順）に ease 語 */
function easedKeywords(counts: Readonly<Record<Keyword, KeywordCount>>, ease: number): ReadonlySet<Keyword> {
  if (ease <= 0) return new Set();
  const candidates = KEYWORDS.filter((k) => !EXCLUDED.has(k) && oneShort(counts[k]));
  const size = (k: Keyword): number => counts[k].produces + counts[k].consumes;
  // sort は安定なので、同数は KEYWORDS 順のまま
  candidates.sort((a, b) => size(b) - size(a));
  return new Set(candidates.slice(0, ease));
}

/** 足りない側を下限まで満たした数え（段の計算だけに使う。表示の源・糧の数は実際のまま） */
function fulfilled(c: Readonly<KeywordCount>): KeywordCount {
  return { ...c, produces: Math.max(c.produces, RESONANCE.minSources), consumes: Math.max(c.consumes, RESONANCE.minSinks) };
}

/** 段 1 以上の語だけ、KEYWORDS 順。ease = 双頭の指輪が成立させる語の数（省略 = 0） */
export function resonanceSteps(counts: Readonly<Record<Keyword, KeywordCount>>, ease = 0): ResonanceStep[] {
  const out: ResonanceStep[] = [];
  const eased = easedKeywords(counts, ease);
  for (const keyword of KEYWORDS) {
    if (EXCLUDED.has(keyword)) continue;
    const c = counts[keyword];
    const step = resonanceStepOf(eased.has(keyword) ? fulfilled(c) : c);
    if (step > 0) out.push({ keyword, step, produces: c.produces, consumes: c.consumes, amplifies: c.amplifies });
  }
  return out;
}

function sameSteps(a: readonly ResonanceStep[], b: readonly ResonanceStep[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const t = b[i];
    return t !== undefined && s.keyword === t.keyword && s.step === t.step && s.produces === t.produces && s.consumes === t.consumes && s.amplifies === t.amplifies;
  });
}

/** boonRun.resonance を数え直す。変わったら true（stats 側を畳み直す合図） */
export function refreshResonance(state: GameState): boolean {
  const sources = resonanceSources(state);
  const ease = resonanceEaseOf(state);
  const last = LAST_COUNT.get(state);
  // 出どころが前と同じ参照の並びで、段の列も前に置いたままなら、数え直しても同じ段になる
  if (last !== undefined && last.ease === ease && last.steps === state.boonRun.resonance && sameRefs(last.sources, sources)) return false;
  const next = resonanceSteps(countProfiles(sources), ease);
  const changed = !sameSteps(state.boonRun.resonance, next);
  if (changed) state.boonRun.resonance = next;
  LAST_COUNT.set(state, { sources, ease, steps: state.boonRun.resonance });
  return changed;
}

/** 前の数えの出どころ（ランの state ごと）。毎ステップの数え直し（updateSkills）を、出どころが変わったときだけにする */
const LAST_COUNT = new WeakMap<GameState, { sources: readonly KeywordProfile[]; ease: number; steps: readonly ResonanceStep[] }>();

function sameRefs<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// -----------------------------------------------------------------------------
// 効果
// -----------------------------------------------------------------------------

/**
 * 段の列 → 倍の列の写し。collectModifiers は 1 撃ごとに何度も呼ばれるので、毎回 Modifier と文字列を作らない。
 * refreshResonance は段が変わったときだけ列を差し替える（中身は書き換えない）ので、列の同一性を鍵にできる
 */
const MODIFIER_CACHE = new WeakMap<readonly ResonanceStep[], readonly Modifier[]>();

/** 語の段の倍（1 語 1 出所 resonance:<語>）。boonRun.resonance を読むだけ */
export function resonanceModifiers(state: Readonly<GameState>): readonly Modifier[] {
  const steps = state.boonRun.resonance;
  const cached = MODIFIER_CACHE.get(steps);
  if (cached !== undefined) return cached;
  const built = buildResonanceModifiers(steps);
  MODIFIER_CACHE.set(steps, built);
  return built;
}

function buildResonanceModifiers(steps: readonly ResonanceStep[]): Modifier[] {
  const out: Modifier[] = [];
  for (const s of steps) {
    const tag = KEYWORD_TAG[s.keyword];
    if (tag === undefined) continue;
    out.push({
      id: `resonance:${s.keyword}`,
      kind: "more",
      tag,
      amount: 1 + (RESONANCE.stepMul - 1) * s.step,
      if: [],
      owner: { kind: "resonance", key: s.keyword },
      label: `共鳴 ${KEYWORD_DEFS[s.keyword].label}`,
    });
  }
  return out;
}

function isStatKeyword(k: Keyword): k is ResonanceStatKeyword {
  return (KEYWORD_STAT as readonly Keyword[]).includes(k);
}

/** 倍の無い語の段を stats へ畳む（祝福を畳んだ後の写しに。基の stats は触らない） */
export function applyResonanceStats(stats: PlayerStats, steps: readonly ResonanceStep[]): void {
  const per = RESONANCE.statPerStep;
  for (const s of steps) {
    if (!isStatKeyword(s.keyword)) continue;
    switch (s.keyword) {
      case "dash":
        stats.dashCooldownMul *= 1 - per.dash * s.step;
        break;
      case "just":
        stats.justDodgeWindow += per.just * s.step;
        break;
      case "mana":
        stats.manaGainMul += per.mana * s.step;
        break;
      case "heal":
        stats.lifeOnHit += per.heal * s.step;
        break;
      case "ward":
        stats.damageTakenMul *= 1 - per.ward * s.step;
        break;
    }
  }
}

/** stats へ畳む語（KEYWORD_STAT）の段が a と b で違うか。倍だけの語が変わっても stats は畳み直さなくてよい */
export function resonanceStatsDiffer(a: readonly ResonanceStep[], b: readonly ResonanceStep[]): boolean {
  return KEYWORD_STAT.some((k) => (a.find((s) => s.keyword === k)?.step ?? 0) !== (b.find((s) => s.keyword === k)?.step ?? 0));
}

/** applyStats から: 数え直して、倍の無い語を祝福を畳んだ stats に足す */
export function applyResonance(state: GameState, stats: PlayerStats): void {
  refreshResonance(state);
  applyResonanceStats(stats, state.boonRun.resonance);
}

// -----------------------------------------------------------------------------
// 読む側（彩痕・HUD・纏い）
// -----------------------------------------------------------------------------

/** その語の今の段（共鳴していなければ 0） */
export function resonanceStep(state: Readonly<GameState>, keyword: Keyword): number {
  return state.boonRun.resonance.find((s) => s.keyword === keyword)?.step ?? 0;
}

/** 段の高い順（同段は KEYWORDS 順。sort は安定） */
export function stepsByHeight(steps: readonly ResonanceStep[]): ResonanceStep[] {
  return [...steps].sort((a, b) => b.step - a.step);
}

/** 共鳴している状態異常の語の色で、段の最も高い色（同段は TRAIT_COLORS 順）。無ければ null（彩刻・彩りが読む） */
export function resonantHue(state: Readonly<GameState>): TraitColor | null {
  let best: TraitColor | null = null;
  let bestStep = 0;
  for (const color of TRAIT_COLORS) {
    const step = resonanceStep(state, HUE_KEYWORD[color]);
    if (step > bestStep) {
      best = color;
      bestStep = step;
    }
  }
  return best;
}

/** 彩痕の色の語が 1 段以上共鳴しているか（被ダメが増える） */
export function hueResonates(state: Readonly<GameState>, color: TraitColor): boolean {
  return resonanceStep(state, HUE_KEYWORD[color]) > 0;
}

/** HUD の 1 行「共鳴 燃焼 2・感電 1」。共鳴が無ければ空文字 */
export function resonanceSummary(state: Readonly<GameState>): string {
  const steps = stepsByHeight(state.boonRun.resonance);
  if (steps.length === 0) return "";
  return `共鳴 ${steps.map((s) => `${KEYWORD_DEFS[s.keyword].label} ${s.step}`).join("・")}`;
}
