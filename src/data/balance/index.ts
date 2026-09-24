/**
 * バランス数値(JSON)の読み込み・_note の剥ぎ取り・ハッシュ化。
 * data/tuning.ts などはここから `BALANCE.<file>.<ブロック名>` を再 export するだけで、
 * 既存の参照経路(`PLAYER.dash.speed` など)は変えない。設計は docs/ideas/data-externalization.md
 */
import { hashSeed } from "../../core/rng";
import boonsJson from "./boons.json";
import combatJson from "./combat.json";
import enemiesJson from "./enemies.json";
import skillsJson from "./skills.json";
import feelJson from "./feel.json";
import lootJson from "./loot.json";
import worldJson from "./world.json";
import jobsJson from "./jobs.json";
import ultimatesJson from "./ultimates.json";
import weaponsJson from "./weapons.json";

/** `_` で始まるキー(_note)を型から消し、全体を readonly にする */
export type Clean<T> = T extends readonly (infer U)[]
  ? readonly Clean<U>[]
  : T extends object
    ? { readonly [K in keyof T as K extends `_${string}` ? never : K]: Clean<T[K]> }
    : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 実行時にも _note を剥がす(state に紛れ込ませない)。JSON.parse 済みの値を深く写すだけ */
export function stripNotes<T>(value: T): Clean<T> {
  if (Array.isArray(value)) return value.map((v) => stripNotes(v)) as Clean<T>;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith("_")) continue;
      out[key] = stripNotes(v);
    }
    return out as Clean<T>;
  }
  return value as Clean<T>;
}

export const BALANCE = {
  combat: stripNotes(combatJson),
  enemies: stripNotes(enemiesJson),
  jobs: stripNotes(jobsJson),
  weapons: stripNotes(weaponsJson),
  skills: stripNotes(skillsJson),
  boons: stripNotes(boonsJson),
  loot: stripNotes(lootJson),
  world: stripNotes(worldJson),
  feel: stripNotes(feelJson),
  ultimates: stripNotes(ultimatesJson),
} as const;

const HASH_RADIX = 16;
const HASH_HEX_DIGITS = 8;

/** 数値の版(8 桁 hex)。リプレイに記録し、再生時の不一致を注記する(docs/ideas/data-externalization.md 5.3) */
export const BALANCE_HASH: string = hashSeed(JSON.stringify(BALANCE)).toString(HASH_RADIX).padStart(HASH_HEX_DIGITS, "0");
