import { saveStorage } from "../save/backend";
import { SKILL, SKILL_DEFS } from "./data";
import { stoneFromSeed } from "./generator";
import { migrateSkillKey } from "./legacyKeys";
import {
  SKILL_KEYS,
  VARIANT_AXES,
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
 * スキル石の永続化。装備プロフィール（roguelike.profile.v1）とは別キーにする
 * （Profile.version を上げると既存装備が空になるため）。
 * 刻印符はラン内だけの物（SkillSlotState.runModifiers）で、ここには持たない。
 * 旧セーブの runes（所持品と石に付けた分）は読み捨てて件数を返し、次の保存で消える（キー形式は変えないので v2 は切らない）。
 * 石の links も読まない（リンクは SKILL.slotLinks でスロットごとに固定）。旧「枠」の芽は「威力」の芽へ写す
 */
export const SKILL_PROFILE_KEY = "roguelike.skills.v1";

const CURRENT_VERSION = 1;
/** 初期所持の石。seed 固定で毎回同じ中身 */
const STARTER_STONES: readonly { seed: number; skillKey: SkillKey }[] = [
  { seed: 101, skillKey: "whirl" },
  { seed: 202, skillKey: "frag" },
];
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

/** 旧セーブの芽は "link"（枠）と "power"（威力）。枠は意味を失ったので、どちらも威力の芽として数える */
function isLegacyWearBud(v: unknown): boolean {
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
  const buds: WearBud[] = Array.isArray(v.buds)
    ? v.buds
        .filter(isLegacyWearBud)
        .slice(0, WEAR_TUNING.milestones.length)
        .map((): WearBud => "power")
    : [];
  return { casts: countOf(v.casts), hits: countOf(v.hits), buds };
}

function wearField(wear: StoneWear | null): { wear?: StoneWear } {
  return wear ? { wear } : {};
}

function sanitizeStone(v: unknown): SkillStone | null {
  if (!isRecord(v)) return null;
  const { id, seed, variants, foundDepth, foundAt, wear } = v;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof seed !== "number") return null;
  // key を消した版のセーブを新しい key へ写してから検査する（写し先が無い石は捨てる）
  const skillKey = typeof v.skillKey === "string" ? migrateSkillKey(v.skillKey) : null;
  if (!isSkillKey(skillKey)) return null;
  if (!Array.isArray(variants)) return null;
  if (typeof foundDepth !== "number" || typeof foundAt !== "number") return null;
  const rolls = variants.map(sanitizeVariant).filter((r): r is VariantRoll => r !== null);
  return {
    id,
    seed,
    skillKey,
    variants: rolls.filter((r) => SKILL_DEFS[skillKey].axes.includes(r.axis)),
    // リンクはスロットで固定（SKILL.slotLinks）。石の値は読まない
    links: 0,
    foundDepth,
    foundAt,
    ...wearField(sanitizeWear(wear)),
  };
}

/** 旧セーブの刻印符の数（所持品 + 石に付けた分）。ラン内化で読み捨てるので、拠点のお知らせ用に数えるだけ */
function countLegacyRunes(parsed: Record<string, unknown>, rawStones: readonly unknown[]): number {
  const owned = Array.isArray(parsed.runes) ? parsed.runes.filter(isRecord).length : 0;
  const attached = rawStones.reduce<number>((sum, s) => {
    const runes = isRecord(s) && Array.isArray(s.runes) ? s.runes.filter(isRecord).length : 0;
    return sum + runes;
  }, 0);
  return owned + attached;
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
  }));
  return { version: CURRENT_VERSION, loadout: sanitizeLoadout(stones.map((s) => s.id), stones), stones };
}

/** 読み込みの結果。droppedRunes は旧セーブから読み捨てた刻印符の数（新しいセーブは 0） */
export interface LoadedSkillProfile {
  profile: SkillProfile;
  droppedRunes: number;
}

/**
 * 無い / 壊れている / version 不一致なら初期プロフィール（droppedRunes は 0）。
 * 旧セーブの runes は読み捨てて件数を返す。次に saveSkillProfile すると runes が消えるので、
 * 呼び出し側が件数を知らせてすぐ保存すれば知らせは 1 回だけになる
 */
export function loadSkillProfileWithNotice(storage?: Storage): LoadedSkillProfile {
  const fresh = (): LoadedSkillProfile => ({ profile: createDefaultSkillProfile(), droppedRunes: 0 });
  const target = storage ?? saveStorage();
  if (!target) return fresh();
  let raw: string | null;
  try {
    raw = target.getItem(SKILL_PROFILE_KEY);
  } catch {
    return fresh();
  }
  if (!raw) return fresh();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fresh();
  }
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION || !Array.isArray(parsed.stones)) return fresh();
  const stones = parsed.stones.map(sanitizeStone).filter((s): s is SkillStone => s !== null);
  const profile: SkillProfile = { version: CURRENT_VERSION, loadout: sanitizeLoadout(parsed.loadout, stones), stones };
  return { profile, droppedRunes: countLegacyRunes(parsed, parsed.stones) };
}

/** 無い / 壊れている / version 不一致なら初期プロフィール */
export function loadSkillProfile(storage?: Storage): SkillProfile {
  return loadSkillProfileWithNotice(storage).profile;
}

export function saveSkillProfile(profile: SkillProfile, storage?: Storage): void {
  const target = storage ?? saveStorage();
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

/** 分解（削除）。装着中なら外す */
export function salvageStone(profile: SkillProfile, stoneId: string): boolean {
  const idx = profile.stones.findIndex((s) => s.id === stoneId);
  if (idx < 0) return false;
  profile.stones.splice(idx, 1);
  profile.loadout = profile.loadout.map((id) => (id === stoneId ? null : id));
  return true;
}

/** スロット i の石（無ければ null） */
export function stoneInSlot(profile: SkillProfile, slot: number): SkillStone | null {
  return findStone(profile, profile.loadout[slot]);
}
