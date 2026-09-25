import type { AttackProfile } from "../../core/element";
import { BALANCE } from "../../data/balance";
import { MOVESETS, type MovesetKey } from "../../data/weapons";
import type { SkillDef } from "../types";
import { buildArtDef, buildArtSkillDef } from "./build";
import { BLADE_ART_SPECS } from "./blades";
import { COMMON_ART_SPECS } from "./common";
import { GUN_ART_SPECS } from "./guns";
import { HEAVY_ART_SPECS } from "./heavy";
import { ART_SKILL_KEYS, type ArtSkillKey } from "./keys";
import { POLEARM_ART_SPECS } from "./polearms";
import { THROWING_ART_SPECS } from "./throwing";
import type { ArtDef, ArtSpec } from "./types";

/**
 * 技（共通技・武器技）の定義の集約。data.ts の SKILL_DEFS / SKILL_ATTACK / SKILL_WEIGHTS / SKILL_MIN_DEPTH に混ぜる。
 * 発動は skills/arts/engine.ts。一覧と狙いは docs/ideas/weapon-skills.md
 */

export const ART_SPECS: readonly ArtSpec[] = [
  ...COMMON_ART_SPECS,
  ...BLADE_ART_SPECS,
  ...POLEARM_ART_SPECS,
  ...HEAVY_ART_SPECS,
  ...GUN_ART_SPECS,
  ...THROWING_ART_SPECS,
];

function specTable(): Record<ArtSkillKey, ArtSpec> {
  const out: Partial<Record<ArtSkillKey, ArtSpec>> = {};
  for (const s of ART_SPECS) {
    if (out[s.key]) throw new Error(`skills/arts: ${s.key} が重複している`);
    out[s.key] = s;
  }
  const table: Record<string, ArtSpec> = {};
  for (const key of ART_SKILL_KEYS) {
    const s = out[key];
    if (!s) throw new Error(`skills/arts: ${key} の定義が無い`);
    table[key] = s;
  }
  return table as Record<ArtSkillKey, ArtSpec>;
}

const SPECS = specTable();

function mapKeys<T>(f: (spec: ArtSpec) => T): Record<ArtSkillKey, T> {
  const out: Record<string, T> = {};
  for (const key of ART_SKILL_KEYS) out[key] = f(SPECS[key]);
  return out as Record<ArtSkillKey, T>;
}

export const ART_DEFS: Readonly<Record<ArtSkillKey, ArtDef>> = mapKeys(buildArtDef);

export const ART_SKILL_DEFS: Record<ArtSkillKey, SkillDef> = mapKeys((s) => buildArtSkillDef(s, ART_DEFS[s.key]));

export const ART_ATTACK: Readonly<Record<ArtSkillKey, AttackProfile | null>> = mapKeys((s) => s.attack);

export const ART_MIN_DEPTH: Record<ArtSkillKey, number> = mapKeys((s) => ART_DEFS[s.key].minDepth);

/** 照準地点を使う技の最大射程（system/skills.ts の CAST_RANGE に足す） */
export const ART_CAST_RANGE: Partial<Record<ArtSkillKey, number>> = Object.fromEntries(
  ART_SKILL_KEYS.flatMap((k) => {
    const r = ART_DEFS[k].castRange;
    return r === undefined ? [] : [[k, r]];
  }),
);

const W = BALANCE.skills.ART.weights;

/**
 * 抽選の重み（名目）。共通技は common、武器技は other（装備と違う武器種のときの重み）。
 * 装備中の武器種の武器技は抽選のときに matched へ差し替える（skills/generator.ts の skillWeight）
 */
export const ART_WEIGHTS: Record<ArtSkillKey, number> = mapKeys((s) => (s.moveset === null ? W.common : W.other));

/** 武器技の重みを装備中の武器種に合わせて返す（共通技・既存のスキルは null = 差し替えない） */
export function artWeightFor(key: string, moveset: MovesetKey | undefined): number | null {
  if (!isArtKey(key)) return null;
  const m = SPECS[key].moveset;
  if (m === null) return null;
  return m === moveset ? W.matched : W.other;
}

const ART_KEY_SET: ReadonlySet<string> = new Set(ART_SKILL_KEYS);

export function isArtKey(key: string): key is ArtSkillKey {
  return ART_KEY_SET.has(key);
}

/** 武器技の表示（「剣専用」）。石のツールチップと、違う武器種で撃ったときの浮き文字 */
export function weaponArtLabel(moveset: MovesetKey): string {
  return `${MOVESETS[moveset].name}専用`;
}

/** 技の武器種（共通技・技でないスキルは null） */
export function artMoveset(key: string): MovesetKey | null {
  return isArtKey(key) ? SPECS[key].moveset : null;
}
