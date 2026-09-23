import { SKILL, SKILL_DEFS } from "./data";
import { stoneFromSeed } from "./generator";
import {
  SKILL_KEYS,
  VARIANT_AXES,
  type SkillKey,
  type SkillProfile,
  type SkillStone,
  type VariantAxis,
  type VariantRoll,
} from "./types";

/**
 * スキル石の永続化。装備プロフィール（roguelike.profile.v1）とは別キーにする
 * （Profile.version を上げると既存装備が空になるため）。
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

function sanitizeStone(v: unknown): SkillStone | null {
  if (!isRecord(v)) return null;
  const { id, seed, skillKey, variants, links, foundDepth, foundAt } = v;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof seed !== "number") return null;
  if (!isSkillKey(skillKey)) return null;
  if (!Array.isArray(variants)) return null;
  if (typeof links !== "number" || !Number.isInteger(links)) return null;
  if (typeof foundDepth !== "number" || typeof foundAt !== "number") return null;
  const rolls = variants.map(sanitizeVariant).filter((r): r is VariantRoll => r !== null);
  return {
    id,
    seed,
    skillKey,
    variants: rolls.filter((r) => SKILL_DEFS[skillKey].axes.includes(r.axis)),
    links: Math.max(0, Math.min(SKILL.maxLinks, links)),
    foundDepth,
    foundAt,
  };
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
  return { version: CURRENT_VERSION, loadout: sanitizeLoadout(stones.map((s) => s.id), stones), stones };
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
  return { version: CURRENT_VERSION, loadout: sanitizeLoadout(parsed.loadout, stones), stones };
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
