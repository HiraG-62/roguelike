import { kw } from "../core/keywords";
import type { StatusKind } from "../core/status";
import type { EnemyCombatDef } from "./enemyCombat";

/**
 * Wave 3 の敵の戦闘パラメータ（docs/ideas/enemies.md）。src/data/enemyCombat.ts の ENEMY_COMBAT に畳み込む。
 * 怯みの目安は 低 〜15 / 中 25〜50 / 高 60〜120。語は 出す = 使ってくる攻撃・場の変化、食う = 弱点
 */

const BOSS_IMMUNE: readonly StatusKind[] = ["freeze", "fear"];
/** 動かない設置物（旗・金床・卵・砲台・地雷）は行動停止で止める意味がない */
const FIXTURE_IMMUNE: readonly StatusKind[] = ["stagger", "freeze", "paralyze", "fear"];
const BLEED_POTENCY = 0.2;

export const WAVE3_COMBAT: Readonly<Record<string, EnemyCombatDef>> = {
  // ---- 地形を作る敵 ----
  mudman: {
    poise: 40,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    keywords: kw(["hurt", "area"], ["shock"]),
    inflicts: [{ on: "contact", kind: "wet", stacks: 1, duration: 4, potency: 0 }],
  },
  toad: {
    poise: 20,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["area", "poison"], ["counter"]),
    inflicts: [{ on: "bomb", kind: "poison", stacks: 2, duration: 4, potency: 0 }],
  },
  oiler: {
    poise: 20,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["area", "hurt"], ["burn"]),
    inflicts: [{ on: "contact", kind: "oiled", stacks: 1, duration: 6, potency: 0 }],
  },
  flameEater: {
    poise: 35,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    keywords: kw(["hurt", "burn"], ["chill"]),
    inflicts: [{ on: "contact", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
    immune: ["burn"],
  },
  windSprite: { poise: 15, staggerTime: 0.5, superArmorMul: 1, inflicts: [], keywords: kw(["area", "wall"], ["ranged"]) },
  mineLayer: { poise: 20, staggerTime: 0.5, superArmorMul: 1, inflicts: [], keywords: kw(["placed", "explode"], ["ranged"]) },
  enemyMine: {
    staggerTime: 0,
    superArmorMul: 1,
    keywords: kw(["explode", "placed"], ["ranged"]),
    inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 }],
    immune: FIXTURE_IMMUNE,
  },
  // ---- 支援・仕掛けの敵 ----
  bellImp: { poise: 10, staggerTime: 0.5, superArmorMul: 1.5, inflicts: [], keywords: kw(["area"], ["silence", "counter"]) },
  bannerBearer: {
    poise: 35,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    keywords: kw(["ward"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  banner: { staggerTime: 0, superArmorMul: 1, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["ward", "placed"], ["area"]) },
  burrower: {
    poise: 30,
    staggerTime: 0.7,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["counter", "area"]),
    inflicts: [{ on: "bomb", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }],
  },
  dropper: {
    poise: 30,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["area", "stagger"], ["placed"]),
    inflicts: [{ on: "bomb", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  absorber: { poise: 45, staggerTime: 0.8, superArmorMul: 0.5, inflicts: [], keywords: kw(["bullet"], ["melee"]), immune: ["fear"] },
  homunculus: {
    poise: 30,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["reaction", "area"], ["silence"]),
    inflicts: [{ on: "bomb", kind: "weaken", stacks: 1, duration: 2.5, potency: 0 }],
  },
  scribeImp: {
    poise: 15,
    staggerTime: 0.6,
    superArmorMul: 1.5,
    keywords: kw(["bullet", "area"], ["silence", "mana"]),
    inflicts: [{ on: "bullet", minDepth: 10, kind: "silence", stacks: 1, duration: 1.2, potency: 0 }],
  },
  crossGolem: {
    poise: 120,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    keywords: kw(["area", "wall"], ["stagger"]),
    inflicts: [{ on: "laser", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
  },
  chainWarden: {
    poise: 60,
    staggerTime: 0.7,
    superArmorMul: 0.5,
    keywords: kw(["hurt", "stagger"], ["just", "counter"]),
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
  },
  hollow: {
    staggerTime: 0,
    superArmorMul: 1,
    keywords: kw(["fear"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "fear", stacks: 1, duration: 1, potency: 0 }],
    immune: ["stagger"],
  },
  lurker: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["burn"]),
    inflicts: [{ on: "contact", minDepth: 7, kind: "fear", stacks: 1, duration: 1, potency: 0 }],
  },
  // ---- 再配色種 ----
  iceBoar: {
    poise: 60,
    staggerTime: 0.6,
    superArmorMul: 0.25,
    keywords: kw(["hurt", "chill"], ["burn"]),
    inflicts: [{ on: "contact", kind: "chill", stacks: 2, duration: 2.5, potency: 0 }],
  },
  sootBomber: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["explode", "area"], ["burn"]),
    inflicts: [{ on: "bomb", kind: "oiled", stacks: 2, duration: 6, potency: 0 }],
  },
  mossGolem: {
    poise: 120,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    keywords: kw(["area", "poison"], ["ranged", "burn"]),
    inflicts: [{ on: "shockwave", kind: "poison", stacks: 2, duration: 4, potency: 0 }],
  },
  swampWisp: {
    staggerTime: 0,
    superArmorMul: 1,
    keywords: kw(["explode"], ["chill"]),
    inflicts: [{ on: "contact", kind: "poison", stacks: 1, duration: 4, potency: 0 }],
    immune: ["stagger"],
  },
  frostToad: {
    poise: 20,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["area", "chill"], ["burn"]),
    inflicts: [{ on: "bomb", kind: "chill", stacks: 2, duration: 2.5, potency: 0 }],
  },
  magmaToad: {
    poise: 22,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["area", "burn"], ["chill"]),
    inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
  },
  oilSlime: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 0.5,
    keywords: kw(["hurt", "area"], ["burn"]),
    inflicts: [{ on: "contact", kind: "oiled", stacks: 1, duration: 6, potency: 0 }],
  },
  stormEye: {
    poise: 20,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["bullet", "shock"], ["counter"]),
    inflicts: [{ on: "bullet", kind: "shock", stacks: 1, duration: 2, potency: 3 }],
  },
  emberRat: {
    poise: 8,
    staggerTime: 0.4,
    superArmorMul: 1,
    keywords: kw(["explode", "burn"], ["ranged"]),
    inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
  },
  // ---- 部屋主 ----
  giantToad: {
    poise: 100,
    staggerTime: 1.2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "area"], ["shock"]),
    inflicts: [{ on: "shockwave", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: ["fear"],
  },
  forgeMaster: {
    poise: 110,
    staggerTime: 1.2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "burn", "bullet"], ["chill"]),
    inflicts: [{ on: "bullet", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
    immune: ["fear", "burn"],
  },
  anvil: { staggerTime: 0, superArmorMul: 1, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["placed"], ["melee"]) },
  turretMaster: {
    poise: 90,
    staggerTime: 1.2,
    superArmorMul: 1,
    keywords: kw(["elite", "bullet"], ["area"]),
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 2, potency: 0 }],
    immune: ["fear"],
  },
  turret: { staggerTime: 0, superArmorMul: 1, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["bullet", "placed"], ["explode"]) },
  basilisk: {
    poise: 110,
    staggerTime: 1.2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "chill"], ["dash"]),
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
    immune: ["fear"],
  },
  shadowStalker: {
    poise: 90,
    staggerTime: 1.2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "hurt"], ["just", "counter"]),
    inflicts: [{ on: "bomb", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: ["fear"],
  },
  // ---- ボス ----
  oilKing: {
    poise: 300,
    staggerTime: 2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "area", "burn"], ["chill"]),
    inflicts: [
      { on: "bomb", kind: "oiled", stacks: 2, duration: 6, potency: 0 },
      { on: "shockwave", kind: "burn", stacks: 1, duration: 3, potency: 4 },
    ],
    immune: BOSS_IMMUNE,
  },
  broodMother: {
    poise: 280,
    staggerTime: 2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "area"], ["area"]),
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY },
      { on: "shockwave", kind: "poison", stacks: 2, duration: 4, potency: 0 },
    ],
    immune: BOSS_IMMUNE,
  },
  broodEgg: { staggerTime: 0, superArmorMul: 1, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["placed"], ["area"]) },
  librarian: {
    poise: 260,
    staggerTime: 2,
    superArmorMul: 1,
    keywords: kw(["elite", "bullet", "wall"], ["silence"]),
    inflicts: [
      { on: "bullet", kind: "weaken", stacks: 1, duration: 2, potency: 0 },
      { on: "bomb", kind: "shock", stacks: 1, duration: 2, potency: 4 },
    ],
    immune: BOSS_IMMUNE,
  },
  mirrorKnight: {
    poise: 280,
    staggerTime: 2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "bullet"], ["counter", "reaction"]),
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY },
      { on: "bullet", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 },
    ],
    immune: BOSS_IMMUNE,
  },
  mirrorImage: { poise: 20, staggerTime: 0.5, superArmorMul: 1, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  reaperShade: {
    poise: 10,
    staggerTime: 0.4,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "weaken", stacks: 1, duration: 2, potency: 0 }],
  },
};
