import { MODIFIERS, SKILL, SKILL_DEFS, canAttach, maxStoneLinks, modifierLinkCost, modifiersClash } from "./data";
import { stoneFromSeed } from "./generator";
import {
  MODIFIER_KEYS,
  SKILL_KEYS,
  VARIANT_AXES,
  type ModifierKey,
  type RuneItem,
  type SkillKey,
  type SkillProfile,
  type SkillStone,
  type StoneWear,
  type VariantAxis,
  type VariantRoll,
  type WearBud,
} from "./types";
import { WEAR_TUNING } from "./tuning2";

/**
 * スキル石と所持刻印符の永続化。装備プロフィール（roguelike.profile.v1）とは別キーにする
 * （Profile.version を上げると既存装備が空になるため）。
 * 刻印符は SkillProfile.runes（所持）と SkillStone.runes（石に付けたもの）に持つ。
 * どちらも省略可の追加フィールドなのでキー形式は変えない（v2 は切らない）
 */
export const SKILL_PROFILE_KEY = "roguelike.skills.v1";

const CURRENT_VERSION = 1;
/** 初期所持の石。seed 固定で毎回同じ中身 */
const STARTER_STONES: readonly { seed: number; skillKey: SkillKey }[] = [
  { seed: 101, skillKey: "whirl" },
  { seed: 202, skillKey: "frag" },
];
const STARTER_LINKS = 1;
const MIN_VARIANT = -1;
const MAX_VARIANT = 1;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isSkillKey(v: unknown): v is SkillKey {
  return typeof v === "string" && (SKILL_KEYS as readonly string[]).includes(v);
}

function isAxis(v: unknown): v is VariantAxis {
  return typeof v === "string" && (VARIANT_AXES as readonly string[]).includes(v);
}

function sanitizeVariant(v: unknown): VariantRoll | null {
  if (!isRecord(v) || !isAxis(v.axis) || typeof v.value !== "number" || !Number.isFinite(v.value)) return null;
  return { axis: v.axis, value: Math.max(MIN_VARIANT, Math.min(MAX_VARIANT, v.value)) };
}

function isModifierKey(v: unknown): v is ModifierKey {
  return typeof v === "string" && (MODIFIER_KEYS as readonly string[]).includes(v);
}

function sanitizeRune(v: unknown): RuneItem | null {
  if (!isRecord(v)) return null;
  const { id, modifier, foundAt } = v;
  if (typeof id !== "string" || id.length === 0) return null;
  if (!isModifierKey(modifier)) return null;
  return { id, modifier, foundAt: typeof foundAt === "number" && Number.isFinite(foundAt) ? foundAt : 0 };
}

function sanitizeRunes(v: unknown): RuneItem[] {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeRune).filter((r): r is RuneItem => r !== null);
}

function isWearBud(v: unknown): v is WearBud {
  return v === "link" || v === "power";
}

function countOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/**
 * 使い込み（省略可）。壊れていれば無しとして扱う。芽は節目の数まで。
 * 旧セーブ・未使用の石は wear を持たないので、キー形式は変えない（v2 は切らない）
 */
function sanitizeWear(v: unknown): StoneWear | null {
  if (!isRecord(v)) return null;
  const buds = Array.isArray(v.buds) ? v.buds.filter(isWearBud).slice(0, WEAR_TUNING.milestones.length) : [];
  return { casts: countOf(v.casts), hits: countOf(v.hits), buds };
}

function wearField(wear: StoneWear | null): { wear?: StoneWear } {
  return wear ? { wear } : {};
}

function sanitizeStone(v: unknown): SkillStone | null {
  if (!isRecord(v)) return null;
  const { id, seed, skillKey, variants, links, foundDepth, foundAt, runes, wear } = v;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof seed !== "number") return null;
  if (!isSkillKey(skillKey)) return null;
  if (!Array.isArray(variants)) return null;
  if (typeof links !== "number" || !Number.isInteger(links)) return null;
  if (typeof foundDepth !== "number" || typeof foundAt !== "number") return null;
  const rolls = variants.map(sanitizeVariant).filter((r): r is VariantRoll => r !== null);
  const worn = wearField(sanitizeWear(wear));
  // 使い込みの枠の芽で増えたリンクは上限を超えてよい
  const maxLinks = maxStoneLinks({ skillKey, links: 0, id, seed, variants: [], foundDepth, foundAt, ...worn });
  return {
    id,
    seed,
    skillKey,
    variants: rolls.filter((r) => SKILL_DEFS[skillKey].axes.includes(r.axis)),
    links: Math.max(0, Math.min(maxLinks, links)),
    foundDepth,
    foundAt,
    ...runesField(sanitizeRunes(runes)),
    ...worn,
  };
}

/** 付いた符が無い石は runes を持たない（旧セーブ・生成直後の石と同じ形に揃え、比較とリプレイの差分を出さない） */
function runesField(runes: RuneItem[]): { runes?: RuneItem[] } {
  return runes.length > 0 ? { runes } : {};
}

function setStoneRunes(stone: SkillStone, runes: RuneItem[]): void {
  if (runes.length > 0) stone.runes = runes;
  else delete stone.runes;
}

/**
 * 石に付いた刻印符のうち、今の規則で付けられないもの（相性・リンク数・重複・型替え符・排他）を外して返す。
 * 石には付けられる分だけを古い順に残す。旧セーブの移行と、壊れたデータの救済を兼ねる
 */
function settleStoneRunes(stone: SkillStone): RuneItem[] {
  const kept: RuneItem[] = [];
  const loose: RuneItem[] = [];
  for (const rune of stoneRunes(stone)) {
    if (runeAttachBlock({ ...stone, runes: kept }, rune.modifier) === null) kept.push(rune);
    else loose.push(rune);
  }
  setStoneRunes(stone, kept);
  return loose;
}

/** id の重複を捨てる（同じ刻印符が石と所持品の両方に居るような壊れ方の救済）。先に出た方を残す */
function dedupeRunes(stones: readonly SkillStone[], owned: readonly RuneItem[]): RuneItem[] {
  const seen = new Set<string>();
  const firstSeen = (r: RuneItem): boolean => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  };
  for (const stone of stones) setStoneRunes(stone, stoneRunes(stone).filter(firstSeen));
  return owned.filter(firstSeen);
}

/**
 * loadout を SKILL.slots 要素にそろえる。旧 2 スロットのセーブは残りを null で埋める
 * （docs/COMBAT_DESIGN.md B-3。キー形式は変えないので v2 は切らない）
 */
function sanitizeLoadout(v: unknown, stones: readonly SkillStone[]): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: SKILL.slots }, () => null);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < SKILL.slots; i++) {
    const id: unknown = v[i];
    if (typeof id !== "string" || !stones.some((s) => s.id === id)) continue;
    // 同じ石を 2 スロットに入れない
    if (out.includes(id)) continue;
    out[i] = id;
  }
  return out;
}

/** 初回用: 旋風斬りとグレネードをスロット 1 / 2 に装着済み、残りは空 */
export function createDefaultSkillProfile(): SkillProfile {
  const stones = STARTER_STONES.map(({ seed, skillKey }) => ({
    ...stoneFromSeed(seed, { foundDepth: 0, now: 0, skillKey }),
    variants: [],
    links: STARTER_LINKS,
  }));
  return { version: CURRENT_VERSION, loadout: sanitizeLoadout(stones.map((s) => s.id), stones), stones, runes: [] };
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 無い / 壊れている / version 不一致なら初期プロフィール */
export function loadSkillProfile(storage?: Storage): SkillProfile {
  const target = storage ?? defaultStorage();
  if (!target) return createDefaultSkillProfile();
  let raw: string | null;
  try {
    raw = target.getItem(SKILL_PROFILE_KEY);
  } catch {
    return createDefaultSkillProfile();
  }
  if (!raw) return createDefaultSkillProfile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createDefaultSkillProfile();
  }
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION || !Array.isArray(parsed.stones)) {
    return createDefaultSkillProfile();
  }
  const stones = parsed.stones.map(sanitizeStone).filter((s): s is SkillStone => s !== null);
  // 旧セーブは runes が無い（刻印符はラン内だった）ので空の所持品から始まる。付けられない付属符は所持品へ戻す
  const displaced = stones.flatMap(settleStoneRunes);
  const runes = dedupeRunes(stones, [...sanitizeRunes(parsed.runes), ...displaced]);
  return { version: CURRENT_VERSION, loadout: sanitizeLoadout(parsed.loadout, stones), stones, runes };
}

export function saveSkillProfile(profile: SkillProfile, storage?: Storage): void {
  const target = storage ?? defaultStorage();
  if (!target) return;
  try {
    target.setItem(SKILL_PROFILE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn("saveSkillProfile failed", err);
  }
}

/** 容量を超えるなら追加せず false */
export function addStone(profile: SkillProfile, stone: SkillStone): boolean {
  if (profile.stones.length >= SKILL.stashCapacity) return false;
  profile.stones.push(stone);
  return true;
}

export function findStone(profile: SkillProfile, id: string | null | undefined): SkillStone | null {
  if (!id) return null;
  return profile.stones.find((s) => s.id === id) ?? null;
}

/** 石をスロットへ。他スロットに入っていたら移動する */
export function equipStone(profile: SkillProfile, stoneId: string, slot: number): boolean {
  if (slot < 0 || slot >= SKILL.slots) return false;
  if (!findStone(profile, stoneId)) return false;
  profile.loadout = profile.loadout.map((id) => (id === stoneId ? null : id));
  profile.loadout[slot] = stoneId;
  return true;
}

export function unequipSlot(profile: SkillProfile, slot: number): void {
  if (slot < 0 || slot >= profile.loadout.length) return;
  profile.loadout[slot] = null;
}

/** 分解（削除）。装着中なら外す。付いていた刻印符は所持品へ戻す（上限を超えても失わない） */
export function salvageStone(profile: SkillProfile, stoneId: string): boolean {
  const idx = profile.stones.findIndex((s) => s.id === stoneId);
  if (idx < 0) return false;
  const [removed] = profile.stones.splice(idx, 1);
  if (removed) ownedRunes(profile).push(...stoneRunes(removed));
  profile.loadout = profile.loadout.map((id) => (id === stoneId ? null : id));
  return true;
}

/** スロット i の石（無ければ null） */
export function stoneInSlot(profile: SkillProfile, slot: number): SkillStone | null {
  return findStone(profile, profile.loadout[slot]);
}

// ---------------------------------------------------------------------------
// 刻印符（所持品と石への付け外し）
// ---------------------------------------------------------------------------

/** 所持刻印符（石に付けていないもの）。旧セーブ・リプレイのプロフィールには無いのでここで作る */
export function ownedRunes(profile: SkillProfile): RuneItem[] {
  if (!profile.runes) profile.runes = [];
  return profile.runes;
}

/** 石に付けた刻印符（古い順）。無ければ空 */
export function stoneRunes(stone: Readonly<SkillStone>): readonly RuneItem[] {
  return stone.runes ?? [];
}

/** 石に付けた刻印符の種類（古い順）。スロットの実効の並びの前半になる */
export function stoneModifierKeys(stone: Readonly<SkillStone>): ModifierKey[] {
  return stoneRunes(stone).map((r) => r.modifier);
}

/** 所持品へ加える。上限なら加えず false */
export function addRune(profile: SkillProfile, rune: RuneItem): boolean {
  const owned = ownedRunes(profile);
  if (owned.length >= SKILL.runeCapacity) return false;
  owned.push(rune);
  return true;
}

/**
 * 付けられない理由。notFit = 相性表で不可 / duplicate = 同じ符が付いている / noLinks = リンクの空きが無い /
 * reshape = 型替え符は 1 枚まで / clash = 排他の符が付いている
 */
export type RuneAttachBlock = "notFit" | "duplicate" | "noLinks" | "reshape" | "clash";

/** この石にこの刻印符を付けられるか。付けられるなら null（canAttach とリンク数の制約は activeModifiers と同じ） */
export function runeAttachBlock(stone: Readonly<SkillStone>, modifier: ModifierKey): RuneAttachBlock | null {
  const def = SKILL_DEFS[stone.skillKey];
  if (!canAttach(def, modifier)) return "notFit";
  const current = stoneModifierKeys(stone);
  if (current.includes(modifier)) return "duplicate";
  const used = current.reduce((sum, k) => sum + modifierLinkCost(k), 0);
  if (used + modifierLinkCost(modifier) > stone.links) return "noLinks";
  if (MODIFIERS[modifier].reshape && current.some((k) => MODIFIERS[k].reshape)) return "reshape";
  if (current.some((k) => modifiersClash(k, modifier))) return "clash";
  return null;
}

/** 付け外しの結果。missing = 刻印符か石が見つからない */
export type RuneAttachResult = "ok" | "missing" | RuneAttachBlock;

/** 所持刻印符を石に付ける（所持品から石へ移す）。付けた符は石の中で最も新しい */
export function attachRuneToStone(profile: SkillProfile, runeId: string, stoneId: string): RuneAttachResult {
  const owned = ownedRunes(profile);
  const idx = owned.findIndex((r) => r.id === runeId);
  const stone = findStone(profile, stoneId);
  const rune = owned[idx];
  if (!rune || !stone) return "missing";
  const block = runeAttachBlock(stone, rune.modifier);
  if (block) return block;
  owned.splice(idx, 1);
  setStoneRunes(stone, [...stoneRunes(stone), rune]);
  return "ok";
}

/** 石から外して所持品へ戻す。外すのは上限を超えても受け付ける（刻印符を失わせない） */
export function detachRuneFromStone(profile: SkillProfile, stoneId: string, runeId: string): boolean {
  const stone = findStone(profile, stoneId);
  const rune = stone ? stoneRunes(stone).find((r) => r.id === runeId) : undefined;
  if (!stone || !rune) return false;
  setStoneRunes(stone, stoneRunes(stone).filter((r) => r.id !== runeId));
  ownedRunes(profile).push(rune);
  return true;
}

/** 所持刻印符を捨てる（石に付いているものは捨てられない） */
export function discardRune(profile: SkillProfile, runeId: string): boolean {
  const owned = ownedRunes(profile);
  const idx = owned.findIndex((r) => r.id === runeId);
  if (idx < 0) return false;
  owned.splice(idx, 1);
  return true;
}
