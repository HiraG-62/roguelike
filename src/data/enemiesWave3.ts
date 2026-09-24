import type { FloorKind } from "../core/state";
import type { EnemyDef } from "./enemies";

/**
 * Wave 3 の敵（docs/ideas/enemies.md の未実装分）。地形を作る敵を優先し、「敵の地形は敵にも効く」を守る。
 * 並びは 地形を作る敵 → 支援・仕掛けの敵 → 再配色種 → 部屋主 → ボスとその付き物。
 * 行動の中身は src/system/enemyWave3.ts、地形・鼓舞・両陣営に当たる爆発は src/system/enemyTerrain.ts
 */

/** 暗闇の階だけに出る敵（闇潜み）の重み。暗闇以外は 0 */
const DARK_ONLY: Partial<Record<FloorKind, number>> = {
  rooms: 0,
  cave: 0,
  dark: 4,
  forge: 0,
  ossuary: 0,
  swamp: 0,
  glacier: 0,
  mine: 0,
  meadow: 0,
};

export const WAVE3_ENEMIES: readonly EnemyDef[] = [
  // ---- 地形を作る敵 ----
  {
    key: "mudman", name: "泥人形", sprite: "mudman",
    radius: 7, hp: 44, speed: 30, behavior: "chaser", contactDamage: 14,
    windup: 0.6, strikeTime: 0.25, recover: 0.7, engageRange: 40, attackInterval: 0.9,
    score: 28, minDepth: 2, weight: 2.5, color: "#8a6a40", dropChance: 0.12,
    deathTerrain: { kind: "mud", radius: 22 },
  },
  {
    key: "toad", name: "毒吐き蛙", sprite: "toad",
    radius: 6, hp: 26, speed: 40, behavior: "lobber", contactDamage: 0,
    windup: 0.7, strikeTime: 0.1, recover: 0.6, engageRange: 140, attackInterval: 2.2,
    score: 26, minDepth: 2, weight: 2.5, color: "#90e040", dropChance: 0.1,
    lob: { terrain: "bog", terrainRadius: 20, blastRadius: 18, damage: 10, color: "#90e040" },
  },
  {
    key: "oiler", name: "油壺運び", sprite: "oiler",
    radius: 6, hp: 34, speed: 52, behavior: "oiler", contactDamage: 12,
    windup: 0.45, strikeTime: 0.25, recover: 0.6, engageRange: 40, attackInterval: 1.0,
    score: 30, minDepth: 3, weight: 2, color: "#6a5030", dropChance: 0.12,
    deathTerrain: { kind: "oil", radius: 28 },
  },
  {
    key: "flameEater", name: "火喰い", sprite: "flameEater",
    radius: 7, hp: 50, speed: 40, behavior: "flameEater", contactDamage: 14,
    windup: 0.5, strikeTime: 0.25, recover: 0.6, engageRange: 44, attackInterval: 0.9,
    score: 40, minDepth: 5, weight: 1.5, color: "#ff9040", dropChance: 0.15,
  },
  {
    key: "windSprite", name: "風吹き", sprite: "windSprite",
    radius: 5, hp: 22, speed: 45, behavior: "windSprite", contactDamage: 0,
    windup: 0.8, strikeTime: 1.5, recover: 0.8, engageRange: 120, attackInterval: 2.6,
    score: 28, minDepth: 4, weight: 2, color: "#d0f0ff", dropChance: 0.1,
  },
  {
    key: "mineLayer", name: "地雷撒き", sprite: "mineLayer", recolor: { base: "bomber", swap: { g: "S", G: "K", h: "r" } },
    radius: 6, hp: 28, speed: 50, behavior: "mineLayer", contactDamage: 0,
    windup: 0.3, strikeTime: 0.1, recover: 0.4, engageRange: 9999, attackInterval: 2,
    score: 30, minDepth: 5, weight: 1.5, color: "#ff6060", dropChance: 0.12,
  },
  {
    key: "enemyMine", name: "地雷", sprite: "enemyMine",
    radius: 4, hp: 4, speed: 0, behavior: "mine", contactDamage: 0,
    windup: 0.4, strikeTime: 0.05, recover: 0.1, engageRange: 16, attackInterval: 0,
    score: 0, minDepth: 99, weight: 0, color: "#ff6060", dropChance: 0, noCorpse: true,
  },
  // ---- 支援・仕掛けの敵 ----
  {
    key: "bellImp", name: "呼び鈴小鬼", sprite: "bellImp",
    radius: 5, hp: 20, speed: 55, behavior: "bellImp", contactDamage: 0,
    windup: 1.0, strikeTime: 0.1, recover: 0.6, engageRange: 9999, attackInterval: 4,
    score: 30, minDepth: 3, weight: 1.5, color: "#f8d848", dropChance: 0.1,
  },
  {
    key: "bannerBearer", name: "旗持ち", sprite: "bannerBearer",
    radius: 6, hp: 36, speed: 40, behavior: "bannerBearer", contactDamage: 10,
    windup: 0.8, strikeTime: 0.25, recover: 0.6, engageRange: 44, attackInterval: 1.2,
    score: 34, minDepth: 5, weight: 1.5, color: "#f8d848", dropChance: 0.12,
  },
  {
    key: "banner", name: "旗", sprite: "banner",
    radius: 5, hp: 12, speed: 0, behavior: "inert", contactDamage: 0,
    windup: 1, strikeTime: 0.1, recover: 1, engageRange: 0, attackInterval: 99,
    score: 5, minDepth: 99, weight: 0, color: "#f8d848", dropChance: 0, noCorpse: true,
    aura: { kind: "warded", radius: 80 },
  },
  {
    key: "burrower", name: "土潜り", sprite: "mole",
    radius: 6, hp: 32, speed: 50, behavior: "burrower", contactDamage: 0,
    windup: 0.6, strikeTime: 0.1, recover: 1.4, engageRange: 26, attackInterval: 0.8,
    score: 30, minDepth: 3, weight: 2, color: "#8a6a40", dropChance: 0.1,
  },
  {
    key: "dropper", name: "天井吊り", sprite: "hanger",
    radius: 6, hp: 30, speed: 28, behavior: "dropper", contactDamage: 12,
    windup: 0.8, strikeTime: 0.25, recover: 0.8, engageRange: 36, attackInterval: 1.1,
    score: 26, minDepth: 2, weight: 1.5, color: "#5a4a40", dropChance: 0.1,
  },
  {
    key: "absorber", name: "吸い込み蟲", sprite: "maw",
    radius: 8, hp: 60, speed: 0, behavior: "absorber", contactDamage: 0,
    windup: 1.2, strikeTime: 0.1, recover: 0.8, engageRange: 9999, attackInterval: 1.5,
    score: 40, minDepth: 6, weight: 1.5, color: "#c0a0ff", dropChance: 0.15,
  },
  {
    key: "homunculus", name: "ホムンクルス", sprite: "homunculus",
    radius: 6, hp: 34, speed: 38, behavior: "homunculus", contactDamage: 0,
    windup: 0.9, strikeTime: 0.1, recover: 0.8, engageRange: 170, attackInterval: 3,
    score: 40, minDepth: 6, weight: 1.5, color: "#e080c0", dropChance: 0.15,
  },
  {
    key: "scribeImp", name: "写本の小悪魔", sprite: "scribeImp",
    radius: 5, hp: 30, speed: 45, behavior: "scribeImp", contactDamage: 0,
    windup: 1.2, strikeTime: 0.1, recover: 0.8, engageRange: 180, attackInterval: 2.6,
    score: 45, minDepth: 8, weight: 1.5, color: "#e0d8c0", dropChance: 0.15,
  },
  {
    key: "crossGolem", name: "十字ゴーレム", sprite: "crossGolem", recolor: { base: "golem", swap: { z: "D", Z: "E", d: "w" } },
    radius: 10, hp: 150, speed: 22, behavior: "crossGolem", contactDamage: 22,
    windup: 1.0, strikeTime: 0.35, recover: 1.08, engageRange: 90, attackInterval: 1.6,
    score: 75, minDepth: 6, weight: 1.5, color: "#e0d8c0", dropChance: 0.3,
  },
  {
    key: "chainWarden", name: "鎖の番人", sprite: "chainWarden", recolor: { base: "knight", swap: { b: "S", B: "k", a: "s", y: "S" } },
    radius: 7, hp: 70, speed: 32, behavior: "chainWarden", contactDamage: 0,
    windup: 0.8, strikeTime: 0.2, recover: 0.8, engageRange: 130, attackInterval: 2.2,
    score: 55, minDepth: 7, weight: 1.5, color: "#a0a0b0", dropChance: 0.2,
  },
  {
    key: "hollow", name: "虚ろ", sprite: "hollow",
    radius: 6, hp: 40, speed: 62, behavior: "hollow", contactDamage: 20,
    windup: 0.5, strikeTime: 0.25, recover: 0.7, engageRange: 36, attackInterval: 1.0,
    score: 50, minDepth: 10, weight: 1.5, color: "#9090a0", dropChance: 0.15,
  },
  {
    key: "lurker", name: "闇潜み", sprite: "lurker", recolor: { base: "shade", swap: { "9": "k", r: "y" } },
    radius: 6, hp: 34, speed: 60, behavior: "charger", contactDamage: 16,
    windup: 0.6, strikeTime: 0.45, recover: 0.7, engageRange: 90, attackInterval: 1.2,
    score: 36, minDepth: 4, weight: 2, color: "#2a2438", dropChance: 0.12,
    biomeWeight: DARK_ONLY,
  },
  // ---- 再配色種（元の絵と behavior に、追加の挙動を 1 つ） ----
  {
    key: "iceBoar", name: "氷猪", sprite: "iceBoar", recolor: { base: "boar", swap: { o: "3", O: "4", q: "2" } },
    radius: 7, hp: 65, speed: 38, behavior: "charger", contactDamage: 18,
    windup: 0.6, strikeTime: 0.7, recover: 0.54, engageRange: 130, attackInterval: 0.9,
    score: 45, minDepth: 5, weight: 2, color: "#8fd0ff", dropChance: 0.25,
    chargeTrail: "ice",
  },
  {
    key: "sootBomber", name: "煤ゴブリン", sprite: "sootBomber", recolor: { base: "bomber", swap: { g: "K", G: "k", h: "S" } },
    radius: 6, hp: 28, speed: 48, behavior: "bomber", contactDamage: 0,
    windup: 0.45, strikeTime: 0.1, recover: 0.45, engageRange: 110, attackInterval: 2.1,
    score: 28, minDepth: 4, weight: 2, color: "#3a3a48", dropChance: 0.12,
    bombTerrain: { kind: "smoke", radius: 20 },
  },
  {
    key: "mossGolem", name: "苔ゴーレム", sprite: "mossGolem", recolor: { base: "golem", swap: { z: "V", Z: "v", d: "G" } },
    radius: 10, hp: 150, speed: 22, behavior: "golem", contactDamage: 22,
    windup: 1.0, strikeTime: 0.6, recover: 1.08, engageRange: 60, attackInterval: 1.44,
    score: 70, minDepth: 5, weight: 1.5, color: "#5b7e48", dropChance: 0.3,
    sporeOnHit: "bog",
  },
  {
    key: "swampWisp", name: "沼鬼火", sprite: "swampWisp", recolor: { base: "wisp", swap: { c: "J", C: "G" } },
    radius: 5, hp: 18, speed: 40, behavior: "wisp", contactDamage: 8,
    windup: 0.3, strikeTime: 0.3, recover: 0.54, engageRange: 30, attackInterval: 1.08,
    score: 22, minDepth: 3, weight: 2, color: "#a0e040", dropChance: 0.1, phasing: true,
    terrainSpeed: { on: ["water", "bog"], mul: 2 },
  },
  {
    key: "frostToad", name: "霜蛙", sprite: "frostToad", recolor: { base: "toad", swap: { g: "3", G: "4", J: "2" } },
    radius: 6, hp: 28, speed: 40, behavior: "lobber", contactDamage: 0,
    windup: 0.7, strikeTime: 0.1, recover: 0.6, engageRange: 140, attackInterval: 2.2,
    score: 28, minDepth: 4, weight: 2, color: "#8fd0ff", dropChance: 0.1,
    lob: { terrain: "ice", terrainRadius: 22, blastRadius: 18, damage: 10, color: "#8fd0ff" },
  },
  {
    key: "magmaToad", name: "熔岩蛙", sprite: "magmaToad", recolor: { base: "toad", swap: { g: "o", G: "O", J: "y" } },
    radius: 6, hp: 30, speed: 40, behavior: "lobber", contactDamage: 0,
    windup: 0.8, strikeTime: 0.1, recover: 0.6, engageRange: 140, attackInterval: 2.6,
    score: 32, minDepth: 6, weight: 1.5, color: "#e88838", dropChance: 0.12,
    lob: { terrain: "lava", terrainRadius: 12, blastRadius: 18, damage: 12, color: "#ff6030" },
  },
  {
    key: "oilSlime", name: "油スライム", sprite: "oilSlime", recolor: { base: "slime", swap: { g: "K", G: "k", h: "S" } },
    radius: 6, hp: 22, speed: 52, behavior: "chaser", contactDamage: 9,
    windup: 0.35, strikeTime: 0.22, recover: 0.4, engageRange: 44, attackInterval: 0.18,
    score: 14, minDepth: 3, weight: 2.5, color: "#3a3a48", dropChance: 0.09,
    deathTerrain: { kind: "oil", radius: 20 },
  },
  {
    key: "stormEye", name: "雷眼", sprite: "stormEye", recolor: { base: "eye", swap: { p: "N", P: "y", e: "1" } },
    radius: 6, hp: 16, speed: 42, behavior: "shooter", contactDamage: 0,
    windup: 0.45, strikeTime: 0.05, recover: 0.32, engageRange: 150, attackInterval: 1.35,
    score: 20, minDepth: 5, weight: 2, color: "#fff4a0", dropChance: 0.08,
  },
  {
    key: "emberRat", name: "火種鼠", sprite: "emberRat", recolor: { base: "rat", swap: { S: "R", s: "r", r: "y" } },
    radius: 5, hp: 10, speed: 80, behavior: "kamikaze", contactDamage: 0,
    windup: 0.9, strikeTime: 0.05, recover: 0.3, engageRange: 26, attackInterval: 0.3,
    score: 10, minDepth: 4, weight: 1.5, color: "#e04848", dropChance: 0.03,
    swarm: { min: 2, max: 3 }, explode: { radius: 28, damage: 14, color: "#ff5020", terrain: "fire" },
  },
  // ---- 部屋主（巣に 1 体、通常の抽選にも低い重みで混ざる） ----
  {
    key: "giantToad", name: "大蝦蟇", sprite: "giantToad",
    radius: 11, hp: 240, speed: 30, behavior: "giantToad", contactDamage: 20,
    windup: 0.8, strikeTime: 0.3, recover: 1.0, engageRange: 130, attackInterval: 1.4,
    score: 320, minDepth: 4, weight: 0.3, color: "#58d058", dropChance: 1, lairMaster: true,
  },
  {
    key: "forgeMaster", name: "炎の鍛冶", sprite: "forgeMaster",
    radius: 10, hp: 260, speed: 26, behavior: "forgeMaster", contactDamage: 18,
    windup: 0.9, strikeTime: 0.2, recover: 1.0, engageRange: 170, attackInterval: 1.8,
    score: 350, minDepth: 5, weight: 0.3, color: "#ff8030", dropChance: 1, lairMaster: true,
    pack: { minion: "anvil", count: 1 },
  },
  {
    key: "anvil", name: "金床", sprite: "anvil",
    radius: 7, hp: 60, speed: 0, behavior: "inert", contactDamage: 0,
    windup: 1, strikeTime: 0.1, recover: 1, engageRange: 0, attackInterval: 99,
    score: 20, minDepth: 99, weight: 0, color: "#70707e", dropChance: 0, noCorpse: true,
  },
  {
    key: "turretMaster", name: "砲台長", sprite: "turretMaster",
    radius: 10, hp: 220, speed: 18, behavior: "turretMaster", contactDamage: 0,
    windup: 0.8, strikeTime: 0.1, recover: 0.8, engageRange: 9999, attackInterval: 2.2,
    score: 330, minDepth: 6, weight: 0.3, color: "#c0c0c0", dropChance: 1, lairMaster: true,
  },
  {
    key: "turret", name: "砲台", sprite: "turret",
    radius: 6, hp: 40, speed: 0, behavior: "turret", contactDamage: 0,
    windup: 0.6, strikeTime: 0.05, recover: 0.4, engageRange: 240, attackInterval: 2.0,
    score: 15, minDepth: 99, weight: 0, color: "#a0a8c0", dropChance: 0, noCorpse: true,
  },
  {
    key: "basilisk", name: "石化の蜥蜴", sprite: "basilisk",
    radius: 10, hp: 250, speed: 34, behavior: "basilisk", contactDamage: 20,
    windup: 1.0, strikeTime: 1.5, recover: 1.0, engageRange: 130, attackInterval: 1.6,
    score: 340, minDepth: 5, weight: 0.3, color: "#a0e0a0", dropChance: 1, lairMaster: true,
  },
  {
    key: "shadowStalker", name: "影踏み", sprite: "shadowStalker",
    radius: 9, hp: 220, speed: 45, behavior: "shadowStalker", contactDamage: 0,
    windup: 1.0, strikeTime: 0.2, recover: 0.8, engageRange: 9999, attackInterval: 1.8,
    score: 340, minDepth: 7, weight: 0.3, color: "#5a4a8a", dropChance: 1, lairMaster: true,
  },
  // ---- ボスとその付き物（付き物は minDepth 99 で抽選に出さない） ----
  {
    key: "oilKing", name: "油壺の王", sprite: "oilKing",
    radius: 14, hp: 1000, speed: 34, behavior: "oilKing", contactDamage: 20,
    windup: 0.9, strikeTime: 0.7, recover: 0.9, engageRange: 400, attackInterval: 1.2,
    score: 2500, minDepth: 99, weight: 0, color: "#c09050", dropChance: 0, boss: true,
  },
  {
    key: "broodMother", name: "群れの母", sprite: "broodMother",
    radius: 14, hp: 1000, speed: 36, behavior: "broodMother", contactDamage: 18,
    windup: 0.8, strikeTime: 0.45, recover: 0.9, engageRange: 400, attackInterval: 1.3,
    score: 2500, minDepth: 99, weight: 0, color: "#a0c040", dropChance: 0, boss: true,
  },
  {
    key: "broodEgg", name: "卵", sprite: "broodEgg",
    radius: 5, hp: 20, speed: 0, behavior: "egg", contactDamage: 0,
    windup: 1, strikeTime: 0.1, recover: 1, engageRange: 0, attackInterval: 99,
    score: 5, minDepth: 99, weight: 0, color: "#e0e0a0", dropChance: 0, noCorpse: true,
  },
  {
    key: "librarian", name: "図書館の司書", sprite: "librarian",
    radius: 12, hp: 950, speed: 30, behavior: "librarian", contactDamage: 0,
    windup: 0.9, strikeTime: 0.3, recover: 0.8, engageRange: 400, attackInterval: 1.5,
    score: 2500, minDepth: 99, weight: 0, color: "#c0a0ff", dropChance: 0, boss: true,
  },
  {
    key: "mirrorKnight", name: "鏡の騎士", sprite: "mirrorKnight",
    radius: 12, hp: 1000, speed: 40, behavior: "mirrorKnight", contactDamage: 20,
    windup: 0.7, strikeTime: 0.45, recover: 0.8, engageRange: 400, attackInterval: 1.2,
    score: 2500, minDepth: 99, weight: 0, color: "#c0e0ff", dropChance: 0, boss: true,
  },
  {
    key: "mirrorImage", name: "写し身", sprite: "mirrorImage", recolor: { base: "player", swap: { b: "3", B: "4", a: "2", t: "1", T: "s" } },
    radius: 6, hp: 60, speed: 50, behavior: "charger", contactDamage: 14,
    windup: 0.6, strikeTime: 0.45, recover: 0.6, engageRange: 110, attackInterval: 1.0,
    score: 0, minDepth: 99, weight: 0, color: "#c0e0ff", dropChance: 0, noCorpse: true,
  },
  // ---- 死神の付き物（影の死神。src/system/reaper.ts が呼ぶ。倒せるが湧き直す） ----
  {
    key: "reaperShade", name: "死神の影", sprite: "reaperShade", recolor: { base: "shade", swap: { "9": "P", r: "p" } },
    radius: 5, hp: 12, speed: 30, behavior: "chaser", contactDamage: 8,
    windup: 0.3, strikeTime: 0.25, recover: 0.5, engageRange: 30, attackInterval: 0.8,
    score: 0, minDepth: 99, weight: 0, color: "#8040c0", dropChance: 0, noCorpse: true, phasing: true,
  },
];
