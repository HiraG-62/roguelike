import { kw } from "../core/keywords";
import type { StatusKind } from "../core/status";
import { BALANCE } from "./balance";
import type { EnemyCombatDef } from "./enemyCombat";

/**
 * Wave 3 の敵の戦闘パラメータ(docs/ideas/enemies.md)。src/data/enemyCombat.ts の ENEMY_COMBAT に畳み込む。
 * 怯みの目安は 低 〜15 / 中 25〜50 / 高 60〜120。語は 出す = 使ってくる攻撃・場の変化、食う = 弱点
 */

const BOSS_IMMUNE: readonly StatusKind[] = ["freeze", "fear"];
/** 動かない設置物（旗・金床・卵・砲台・地雷）は行動停止で止める意味がない */
const FIXTURE_IMMUNE: readonly StatusKind[] = ["stagger", "freeze", "paralyze", "fear"];
const BLEED_POTENCY = 0.2;

/** poise/staggerTime/superArmorMul/strikeSuperArmorMul。src/data/balance/enemies.json の "combat" */
const C = BALANCE.enemies.combat;

export const WAVE3_COMBAT: Readonly<Record<string, EnemyCombatDef>> = {
  // ---- 地形を作る敵 ----
  mudman: { ...C.mudman, keywords: kw(["hurt", "area"], ["shock"]), inflicts: [{ on: "contact", kind: "wet", stacks: 1, duration: 4, potency: 0 }] },
  toad: { ...C.toad, keywords: kw(["area", "poison"], ["counter"]), inflicts: [{ on: "bomb", kind: "poison", stacks: 2, duration: 4, potency: 0 }] },
  oiler: { ...C.oiler, keywords: kw(["area", "hurt"], ["burn"]), inflicts: [{ on: "contact", kind: "oiled", stacks: 1, duration: 6, potency: 0 }] },
  flameEater: {
    ...C.flameEater,
    keywords: kw(["hurt", "burn"], ["chill"]),
    inflicts: [{ on: "contact", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
    immune: ["burn"],
  },
  windSprite: { ...C.windSprite, inflicts: [], keywords: kw(["area", "wall"], ["ranged"]) },
  mineLayer: { ...C.mineLayer, inflicts: [], keywords: kw(["placed", "explode"], ["ranged"]) },
  enemyMine: {
    ...C.enemyMine,
    keywords: kw(["explode", "placed"], ["ranged"]),
    inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 }],
    immune: FIXTURE_IMMUNE,
  },
  // ---- 支援・仕掛けの敵 ----
  bellImp: { ...C.bellImp, inflicts: [], keywords: kw(["area"], ["silence", "counter"]) },
  bannerBearer: { ...C.bannerBearer, keywords: kw(["ward"], ["ranged"]), inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }] },
  banner: { ...C.banner, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["ward", "placed"], ["area"]) },
  burrower: { ...C.burrower, keywords: kw(["hurt"], ["counter", "area"]), inflicts: [{ on: "bomb", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }] },
  dropper: { ...C.dropper, keywords: kw(["area", "stagger"], ["placed"]), inflicts: [{ on: "bomb", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }] },
  absorber: { ...C.absorber, inflicts: [], keywords: kw(["bullet"], ["melee"]), immune: ["fear"] },
  homunculus: { ...C.homunculus, keywords: kw(["reaction", "area"], ["silence"]), inflicts: [{ on: "bomb", kind: "weaken", stacks: 1, duration: 2.5, potency: 0 }] },
  scribeImp: {
    ...C.scribeImp,
    keywords: kw(["bullet", "area"], ["silence", "mana"]),
    inflicts: [{ on: "bullet", minDepth: 10, kind: "silence", stacks: 1, duration: 1.2, potency: 0 }],
  },
  crossGolem: { ...C.crossGolem, keywords: kw(["area", "wall"], ["stagger"]), inflicts: [{ on: "laser", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }] },
  chainWarden: { ...C.chainWarden, keywords: kw(["hurt", "stagger"], ["just", "counter"]), inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }] },
  hollow: {
    ...C.hollow,
    keywords: kw(["fear"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "fear", stacks: 1, duration: 1, potency: 0 }],
    immune: ["stagger"],
  },
  lurker: { ...C.lurker, keywords: kw(["hurt"], ["burn"]), inflicts: [{ on: "contact", minDepth: 7, kind: "fear", stacks: 1, duration: 1, potency: 0 }] },
  // ---- 再配色種 ----
  iceBoar: { ...C.iceBoar, keywords: kw(["hurt", "chill"], ["burn"]), inflicts: [{ on: "contact", kind: "chill", stacks: 2, duration: 2.5, potency: 0 }] },
  sootBomber: { ...C.sootBomber, keywords: kw(["explode", "area"], ["burn"]), inflicts: [{ on: "bomb", kind: "oiled", stacks: 2, duration: 6, potency: 0 }] },
  mossGolem: { ...C.mossGolem, keywords: kw(["area", "poison"], ["ranged", "burn"]), inflicts: [{ on: "shockwave", kind: "poison", stacks: 2, duration: 4, potency: 0 }] },
  swampWisp: {
    ...C.swampWisp,
    keywords: kw(["explode"], ["chill"]),
    inflicts: [{ on: "contact", kind: "poison", stacks: 1, duration: 4, potency: 0 }],
    immune: ["stagger"],
  },
  frostToad: { ...C.frostToad, keywords: kw(["area", "chill"], ["burn"]), inflicts: [{ on: "bomb", kind: "chill", stacks: 2, duration: 2.5, potency: 0 }] },
  magmaToad: { ...C.magmaToad, keywords: kw(["area", "burn"], ["chill"]), inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }] },
  oilSlime: { ...C.oilSlime, keywords: kw(["hurt", "area"], ["burn"]), inflicts: [{ on: "contact", kind: "oiled", stacks: 1, duration: 6, potency: 0 }] },
  stormEye: { ...C.stormEye, keywords: kw(["bullet", "shock"], ["counter"]), inflicts: [{ on: "bullet", kind: "shock", stacks: 1, duration: 2, potency: 3 }] },
  emberRat: { ...C.emberRat, keywords: kw(["explode", "burn"], ["ranged"]), inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }] },
  // ---- 部屋主 ----
  giantToad: {
    ...C.giantToad,
    keywords: kw(["elite", "area"], ["shock"]),
    inflicts: [{ on: "shockwave", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: ["fear"],
  },
  forgeMaster: {
    ...C.forgeMaster,
    keywords: kw(["elite", "burn", "bullet"], ["chill"]),
    inflicts: [{ on: "bullet", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
    immune: ["fear", "burn"],
  },
  anvil: { ...C.anvil, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["placed"], ["melee"]) },
  turretMaster: {
    ...C.turretMaster,
    keywords: kw(["elite", "bullet"], ["area"]),
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 2, potency: 0 }],
    immune: ["fear"],
  },
  turret: { ...C.turret, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["bullet", "placed"], ["explode"]) },
  basilisk: {
    ...C.basilisk,
    keywords: kw(["elite", "chill"], ["dash"]),
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
    immune: ["fear"],
  },
  shadowStalker: {
    ...C.shadowStalker,
    keywords: kw(["elite", "hurt"], ["just", "counter"]),
    inflicts: [{ on: "bomb", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: ["fear"],
  },
  // ---- ボス ----
  oilKing: {
    ...C.oilKing,
    keywords: kw(["elite", "area", "burn"], ["chill"]),
    inflicts: [
      { on: "bomb", kind: "oiled", stacks: 2, duration: 6, potency: 0 },
      { on: "shockwave", kind: "burn", stacks: 1, duration: 3, potency: 4 },
    ],
    immune: BOSS_IMMUNE,
  },
  broodMother: {
    ...C.broodMother,
    keywords: kw(["elite", "area"], ["area"]),
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY },
      { on: "shockwave", kind: "poison", stacks: 2, duration: 4, potency: 0 },
    ],
    immune: BOSS_IMMUNE,
  },
  broodEgg: { ...C.broodEgg, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["placed"], ["area"]) },
  librarian: {
    ...C.librarian,
    keywords: kw(["elite", "bullet", "wall"], ["silence"]),
    inflicts: [
      { on: "bullet", kind: "weaken", stacks: 1, duration: 2, potency: 0 },
      { on: "bomb", kind: "shock", stacks: 1, duration: 2, potency: 4 },
    ],
    immune: BOSS_IMMUNE,
  },
  mirrorKnight: {
    ...C.mirrorKnight,
    keywords: kw(["elite", "bullet"], ["counter", "reaction"]),
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY },
      { on: "bullet", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 },
    ],
    immune: BOSS_IMMUNE,
  },
  thiefKing: {
    ...C.thiefKing,
    keywords: kw(["elite", "bullet", "explode", "placed"], ["chill", "wall"]),
    inflicts: [
      { on: "bullet", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY },
      { on: "bomb", kind: "weaken", stacks: 1, duration: 3, potency: 0 },
    ],
    immune: BOSS_IMMUNE,
  },
  thief: { ...C.thief, keywords: kw(["melee"], ["chill"]), inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 3, potency: BLEED_POTENCY }] },
  mirrorImage: { ...C.mirrorImage, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  reaperShade: { ...C.reaperShade, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "weaken", stacks: 1, duration: 2, potency: 0 }] },
};
