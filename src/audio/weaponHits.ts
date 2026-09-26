/**
 * 武器種ごとの近接命中音（`hitW_<武器種>_<重さ>`）の層を作る。
 * - 斬撃の系統は参考音（docs/example/SE の「剣で斬る」。特徴量は sfxLayers.ts の hitSlash* の注記）を基準の剣とし、
 *   武器の性格（明るさ・余韻の長さ・低い芯・肉の音・刃鳴り・連撃の粒）の倍率で作り分ける
 * - 打撃・刺突・鞭打の系統は sfxLayers.ts の系統の音を、武器ごとに高さ・長さ・芯をずらして作る
 * 系統の対応は system/effects.ts の HIT_FAMILY と同じ（weaponHits.test.ts が照合する）
 */
import type { MovesetKey } from "../data/weapons";
import type { Layer } from "./layers";
import { LAYERED_SFX } from "./sfxLayers";
import { HIT_WEIGHT_KEYS, type HitWeightKey, type WeaponHitName, WEAPON_HIT_MOVESETS, weaponHitName } from "./weaponHitNames";

export type WeaponHitFamily = "slash" | "blunt" | "pierce" | "lash";

/** 斬撃の武器の性格。1 が基準の剣 */
interface SlashCharacter {
  family: "slash";
  /** 全体の高さ（明るさ）。1 より大きいほど鋭く軽い */
  pitch: number;
  /** 高域の余韻（シャー）と刃鳴りの長さ */
  tail: number;
  /** 当たりの低い芯（kick）の大きさ */
  low: number;
  /** 湿った肉の中低域の大きさ */
  wet: number;
  /** 余韻に残る刃鳴りの大きさ */
  ring: number;
  /** 当たりの「ザ」の大きさ */
  za: number;
  /** 「ザ」を何粒に分けて鳴らすか（爪の 3 本・双剣の 2 枚） */
  bursts?: number;
  /** 刃鳴りの部分音の比。省略は刀剣の SLASH_RING */
  ringRatios?: readonly number[];
}

/** 打撃・刺突・鞭打の武器の性格。系統の音をずらす倍率 */
interface ShiftCharacter {
  family: "blunt" | "pierce" | "lash";
  pitch: number;
  /** 長さ（dur・at・attack に掛ける） */
  stretch: number;
  /** 全体の音量 */
  level: number;
  /** kick の音量に追加で掛ける */
  low: number;
}

type WeaponCharacter = SlashCharacter | ShiftCharacter;

/** 参考音の余韻に残る刀剣の部分音の比（3.3k / 4.9k / 5.3k / 5.9k / 6.6k / 7.6k Hz） */
const SLASH_RING = [1, 1.5, 1.62, 1.82, 2.03, 2.33] as const;
/** 鎖・輪刃の金属の比（刀剣より不協和で「チャリン」寄り） */
const CHAIN_RING = [1, 1.37, 1.94, 2.61, 3.12] as const;

const slash = (c: Omit<SlashCharacter, "family">): SlashCharacter => ({ family: "slash", ...c });
const shift = (family: ShiftCharacter["family"], pitch: number, stretch: number, level: number, low: number): ShiftCharacter => ({ family, pitch, stretch, level, low });

/**
 * 武器ごとの性格。数値は音色の作り分けで、ゲームバランスには関わらない。
 * 刀は細く澄んで長く鳴る、大剣・斧・鉈は低く太く短め、双剣・爪は軽い粒が重なる、大鎌は長く薙ぐ、輪刃・戦輪は金属がよく鳴る
 */
const CHARACTERS: Readonly<Record<MovesetKey, WeaponCharacter>> = {
  sword: slash({ pitch: 1, tail: 1, low: 1, wet: 1, ring: 1, za: 1 }),
  katana: slash({ pitch: 1.12, tail: 1.25, low: 0.6, wet: 0.6, ring: 1.6, za: 0.9 }),
  greatsword: slash({ pitch: 0.78, tail: 1.3, low: 1.8, wet: 1.4, ring: 0.6, za: 1.2 }),
  twinBlades: slash({ pitch: 1.15, tail: 0.6, low: 0.6, wet: 0.8, ring: 0.7, za: 0.8, bursts: 2 }),
  scythe: slash({ pitch: 0.95, tail: 1.5, low: 0.8, wet: 0.9, ring: 0.8, za: 0.8 }),
  cleaver: slash({ pitch: 0.85, tail: 0.55, low: 1.5, wet: 1.8, ring: 0.4, za: 1.3 }),
  axe: slash({ pitch: 0.8, tail: 0.7, low: 1.9, wet: 1.6, ring: 0.5, za: 1.3 }),
  chainSickle: slash({ pitch: 1.05, tail: 0.8, low: 0.8, wet: 1, ring: 1.3, za: 1, ringRatios: CHAIN_RING }),
  claws: slash({ pitch: 1.1, tail: 0.45, low: 0.7, wet: 1.3, ring: 0.2, za: 0.7, bursts: 3 }),
  thrown: slash({ pitch: 1.2, tail: 0.5, low: 0.5, wet: 0.8, ring: 0.8, za: 0.8 }),
  trapper: slash({ pitch: 1.05, tail: 0.6, low: 0.8, wet: 1, ring: 0.6, za: 1 }),
  warRing: slash({ pitch: 1.1, tail: 1, low: 0.8, wet: 0.8, ring: 2, za: 0.9, ringRatios: CHAIN_RING }),
  ringBlades: slash({ pitch: 1.2, tail: 1.1, low: 0.6, wet: 0.7, ring: 2.2, za: 0.8, ringRatios: CHAIN_RING }),
  // 打撃: 拳は軽く短く、戦鎚・砲は低く長く、盾は板を叩く中域、棍はしなって乾いた音
  fists: shift("blunt", 1.15, 0.8, 0.9, 0.8),
  staff: shift("blunt", 1.1, 0.9, 0.9, 0.7),
  shield: shift("blunt", 0.95, 1, 1, 1),
  hammer: shift("blunt", 0.78, 1.3, 1.05, 1.4),
  flail: shift("blunt", 0.85, 1.15, 1, 1.2),
  cannon: shift("blunt", 0.75, 1.25, 1, 1.4),
  grenade: shift("blunt", 0.9, 1.05, 0.95, 1.1),
  fan: shift("blunt", 1.25, 0.75, 0.85, 0.6),
  // 刺突: 槍は深く抜け、杖（魔法の杖の殴り）と銃床は軽く短い
  spear: shift("pierce", 0.92, 1.15, 1, 1.2),
  wand: shift("pierce", 1.2, 0.8, 0.85, 0.7),
  gunner: shift("pierce", 1.05, 0.9, 0.9, 0.9),
  sidearm: shift("pierce", 1.1, 0.85, 0.9, 0.8),
  longarm: shift("pierce", 0.95, 1, 0.95, 1),
  // 鞭打
  whip: shift("lash", 1, 1, 1, 1),
};

export function weaponHitFamily(moveset: MovesetKey): WeaponHitFamily {
  return CHARACTERS[moveset].family;
}

/** 重さの段の番号（0 軽 / 1 中 / 2 重） */
const WEIGHT_INDEX: Readonly<Record<HitWeightKey, number>> = { light: 0, mid: 1, heavy: 2 };
/** 基準の剣の高域の余韻の長さ（秒）。軽・中・重 */
const SLASH_TAIL_SECONDS = [0.36, 0.44, 0.55] as const;
/** 「ザ」を粒に分けるときの粒の間隔（秒） */
const BURST_GAP = 0.024;
/** 刃鳴りの長さは高域の余韻の何倍か */
const RING_TAIL_MUL = 1.3;
/** 余韻の上の空気（8kHz 以上）の長さは高域の余韻の何倍か */
const AIR_TAIL_MUL = 0.3;

const round = (v: number): number => Math.round(v * 1000) / 1000;

/** 斬撃の命中の層。数値の基準は参考音に合わせた剣（sfxLayers.ts の hitSlash*）と同じ */
function slashLayers(c: SlashCharacter, weight: HitWeightKey): Layer[] {
  const w = WEIGHT_INDEX[weight];
  const p = c.pitch;
  const tail = (SLASH_TAIL_SECONDS[w] ?? SLASH_TAIL_SECONDS[0]) * c.tail;
  const bursts = Math.max(1, c.bursts ?? 1);
  const layers: Layer[] = [];
  for (let i = 0; i < bursts; i++) {
    const at = round(i * BURST_GAP);
    // 粒が多い武器は 1 粒を小さく短く（重ねたときの合計を揃える）
    const share = 1 / Math.sqrt(bursts);
    layers.push({ k: "click", freq: round((5000 - 600 * w) * p), peak: round((0.22 + 0.04 * w) * share), at });
    layers.push({
      k: "noise",
      filter: "bandpass",
      from: round(5200 * p),
      to: round(3200 * p),
      dur: round((0.06 + 0.02 * w) * (bursts > 1 ? 0.6 : 1)),
      q: 0.8,
      attack: 0.001,
      peak: round(0.3 * c.za * share),
      drive: 1.5,
      at,
    });
  }
  layers.push({ k: "kick", from: round((150 - 20 * w) * p), to: round((50 - 5 * w) * p), drop: round(0.04 + 0.02 * w), dur: round(0.09 + 0.05 * w), peak: round((0.2 + 0.05 * w) * c.low), drive: 1.5 });
  layers.push({ k: "noise", filter: "bandpass", from: round(6200 * p), to: round((4200 - 300 * w) * p), dur: round(tail), q: 1.3, attack: 0.004, peak: round(0.4 + 0.03 * w), at: 0.006 });
  layers.push({ k: "noise", filter: "highpass", from: round(9000 * p), to: round(6500 * p), dur: round(tail * AIR_TAIL_MUL), attack: 0.003, peak: 0.03, at: 0.004 });
  layers.push({ k: "noise", filter: "bandpass", from: round(1200 * p), to: round(500 * p), dur: round(0.07 + 0.02 * w), q: 1.2, attack: 0.002, peak: round(0.2 * c.wet), drive: 2, at: 0.003 });
  layers.push({ k: "metal", freq: round((3273 - 250 * w) * p), ratios: c.ringRatios ?? SLASH_RING, dur: round(tail * RING_TAIL_MUL), peak: round((0.07 + 0.01 * w) * c.ring), at: 0.004 });
  return layers;
}

const FAMILY_BASE: Readonly<Record<ShiftCharacter["family"], Readonly<Record<HitWeightKey, readonly Layer[]>>>> = {
  blunt: { light: LAYERED_SFX.hitBluntLight, mid: LAYERED_SFX.hitBluntMid, heavy: LAYERED_SFX.hitBluntHeavy },
  pierce: { light: LAYERED_SFX.hitPierceLight, mid: LAYERED_SFX.hitPierceMid, heavy: LAYERED_SFX.hitPierceHeavy },
  lash: { light: LAYERED_SFX.hitLashLight, mid: LAYERED_SFX.hitLashMid, heavy: LAYERED_SFX.hitLashHeavy },
};

/** 系統の音の 1 層を武器の性格でずらす（高さ・長さ・音量。kick は芯の倍率も） */
function shiftLayer(l: Layer, c: ShiftCharacter): Layer {
  const t = (v: number | undefined): number | undefined => (v === undefined ? undefined : round(v * c.stretch));
  const at = t(l.at);
  switch (l.k) {
    case "noise":
      return { ...l, from: round(l.from * c.pitch), to: round(l.to * c.pitch), dur: round(l.dur * c.stretch), attack: t(l.attack), peak: round(l.peak * c.level), at };
    case "kick":
      return { ...l, from: round(l.from * c.pitch), to: round(l.to * c.pitch), drop: round(l.drop * c.stretch), dur: round(l.dur * c.stretch), peak: round(l.peak * c.level * c.low), at };
    case "click":
      return { ...l, freq: round(l.freq * c.pitch), peak: round(l.peak * c.level), at };
    case "metal":
      return { ...l, freq: round(l.freq * c.pitch), dur: round(l.dur * c.stretch), peak: round(l.peak * c.level), at };
    default:
      return l;
  }
}

export function weaponHitLayers(moveset: MovesetKey, weight: HitWeightKey): readonly Layer[] {
  const c = CHARACTERS[moveset];
  if (c.family === "slash") return slashLayers(c, weight);
  return FAMILY_BASE[c.family][weight].map((l) => shiftLayer(l, c));
}

/** 全武器種 × 重さの層の表（sfx.ts が効果音の定義に混ぜる） */
export const WEAPON_HIT_LAYERS: Readonly<Record<WeaponHitName, readonly Layer[]>> = Object.fromEntries(
  WEAPON_HIT_MOVESETS.flatMap((m) => HIT_WEIGHT_KEYS.map((w) => [weaponHitName(m, w), weaponHitLayers(m, w)] as const)),
) as Record<WeaponHitName, readonly Layer[]>;
