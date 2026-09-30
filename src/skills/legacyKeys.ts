import type { SkillKey } from "./types";

/**
 * 旧スキル key → 新 key の写し表（docs/ideas/skills-7c-plan.md 2 章）。
 * 技の圧縮（F）と手書きの整理（G）で key を消すとき、同じコミットで行を足す。
 * 値が null の行は「写し先が無い」印で、その石は読み込みで捨てる。
 * 石のセーブは黙って壊れる作りなので、key を消して表に足し忘れると石が消える
 */
export const LEGACY_SKILL_MAP: Readonly<Record<string, SkillKey | null>> = {};

/**
 * 表を引数に取る純関数（テストで表を差し替えるため）。
 * 表に無い key はそのまま返し、null の行は null。継承されたプロパティ名（toString など）を旧 key と取り違えない
 */
export function mapSkillKey(table: Readonly<Record<string, SkillKey | null>>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(table, key)) return key;
  return table[key] ?? null;
}

/** 保存された skillKey を今の key へ写す。null = 石を消す。写した先が有効な key かは呼び出し側（isSkillKey）が検査する */
export function migrateSkillKey(key: string): string | null {
  return mapSkillKey(LEGACY_SKILL_MAP, key);
}
