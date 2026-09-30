import type { AttackProfile } from "../../core/element";
import { BALANCE } from "../../data/balance";
import { MOVESETS, type MovesetKey } from "../../data/weapons";
import type { SkillDef } from "../types";
import { buildArtDef, buildArtSkillDef } from "./build";
import { COMMON_ART_SPECS } from "./common";
import { COMMON_ART_SPECS_2 } from "./common2";
import { ART_SKILL_KEYS, type ArtSkillKey } from "./keys";
import type { ArtDef, ArtSpec } from "./types";

/**
 * 技（共通技 60）の定義の集約。data.ts の SKILL_DEFS / SKILL_ATTACK / SKILL_WEIGHTS / SKILL_MIN_DEPTH に混ぜる。
 * 発動は skills/arts/engine.ts、型ごとの形の変化は skills/arts/transform.ts。一覧は docs/ideas/skills-7c-plan.md 1 章
 */

export const ART_SPECS: readonly ArtSpec[] = [...COMMON_ART_SPECS, ...COMMON_ART_SPECS_2];

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

/** 照準地点を使う技の最大射程（system/skills.ts の CAST_RANGE に足す）。型の変形で照準地点へ移った技は SKILL.defaultCastRange に落ちる */
export const ART_CAST_RANGE: Partial<Record<ArtSkillKey, number>> = Object.fromEntries(
  ART_SKILL_KEYS.flatMap((k) => {
    const r = ART_DEFS[k].castRange;
    return r === undefined ? [] : [[k, r]];
  }),
);

/** 抽選の重み（共通技 1 種あたり。武器種に依らない） */
export const ART_WEIGHTS: Record<ArtSkillKey, number> = mapKeys(() => BALANCE.skills.ART.weight);

const ART_KEY_SET: ReadonlySet<string> = new Set(ART_SKILL_KEYS);

export function isArtKey(key: string): key is ArtSkillKey {
  return ART_KEY_SET.has(key);
}

/** 武器種の縛りの表示（「剣専用」）。段取り 7c から技は縛りを持たないが、SkillDef.moveset を持つ石の表示に残す */
export function weaponArtLabel(moveset: MovesetKey): string {
  return `${MOVESETS[moveset].name}専用`;
}

/** 技の武器種の縛り（段取り 7c から技は全て null。技でないスキルも null） */
export function artMoveset(key: string): MovesetKey | null {
  return isArtKey(key) ? SPECS[key].moveset : null;
}
