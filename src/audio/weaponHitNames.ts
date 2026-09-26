/**
 * 武器種ごとの近接命中音の名前（`hitW_<武器種>_<重さ>`）。層は audio/weaponHits.ts が作る。
 * sfxNames.ts が SFX_NAMES に混ぜるので、ここは他の音声モジュールを import しない（循環を避ける）
 */
import type { MovesetKey } from "../data/weapons";

export type HitWeightKey = "light" | "mid" | "heavy";
export const HIT_WEIGHT_KEYS: readonly HitWeightKey[] = ["light", "mid", "heavy"];

/** 命中音を武器種ごとに持つ武器種（Record なので武器種を足すと型エラーで気付く） */
const WEAPON_HIT_KEYS_TABLE: Readonly<Record<MovesetKey, true>> = {
  sword: true,
  greatsword: true,
  twinBlades: true,
  spear: true,
  scythe: true,
  fists: true,
  whip: true,
  cleaver: true,
  staff: true,
  wand: true,
  katana: true,
  axe: true,
  shield: true,
  chainSickle: true,
  hammer: true,
  gunner: true,
  sidearm: true,
  longarm: true,
  cannon: true,
  thrown: true,
  grenade: true,
  trapper: true,
  warRing: true,
  claws: true,
  flail: true,
  ringBlades: true,
  fan: true,
};

export const WEAPON_HIT_MOVESETS = Object.keys(WEAPON_HIT_KEYS_TABLE) as readonly MovesetKey[];

export type WeaponHitName = `hitW_${MovesetKey}_${HitWeightKey}`;

export function weaponHitName(moveset: MovesetKey, weight: HitWeightKey): WeaponHitName {
  return `hitW_${moveset}_${weight}`;
}

export const WEAPON_HIT_NAMES: readonly WeaponHitName[] = WEAPON_HIT_MOVESETS.flatMap((m) => HIT_WEIGHT_KEYS.map((w) => weaponHitName(m, w)));
