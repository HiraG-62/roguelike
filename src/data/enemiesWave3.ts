import type { FloorKind } from "../core/state";
import { BALANCE } from "./balance";
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

/** 敵ごとの数値本体。src/data/balance/enemies/ の "stats"（変更したい場合はそこを編集する） */
const N = BALANCE.enemies.stats;

export const WAVE3_ENEMIES: readonly EnemyDef[] = [
  // ---- 地形を作る敵 ----
  { key: "mudman", name: "泥人形", sprite: "mudman", behavior: "chaser", color: "#8a6a40", deathTerrain: { kind: "mud", radius: 22 }, ...N.mudman },
  { key: "toad", name: "毒吐き蛙", sprite: "toad", behavior: "lobber", color: "#90e040", lob: { terrain: "bog", terrainRadius: 20, blastRadius: 18, damage: 10, color: "#90e040" }, ...N.toad },
  { key: "oiler", name: "油壺運び", sprite: "oiler", behavior: "oiler", color: "#6a5030", deathTerrain: { kind: "oil", radius: 28 }, ...N.oiler },
  { key: "flameEater", name: "火喰い", sprite: "flameEater", behavior: "flameEater", color: "#ff9040", ...N.flameEater },
  { key: "windSprite", name: "風吹き", sprite: "windSprite", behavior: "windSprite", color: "#d0f0ff", ...N.windSprite },
  { key: "mineLayer", name: "地雷撒き", sprite: "mineLayer", recolor: { base: "bomber", swap: { g: "S", G: "K", h: "r" } }, behavior: "mineLayer", color: "#ff6060", ...N.mineLayer },
  { key: "enemyMine", name: "地雷", sprite: "enemyMine", behavior: "mine", color: "#ff6060", noCorpse: true, ...N.enemyMine },
  // ---- 支援・仕掛けの敵 ----
  { key: "bellImp", name: "呼び鈴小鬼", sprite: "bellImp", behavior: "bellImp", color: "#f8d848", ...N.bellImp },
  { key: "bannerBearer", name: "旗持ち", sprite: "bannerBearer", behavior: "bannerBearer", color: "#f8d848", ...N.bannerBearer },
  { key: "banner", name: "旗", sprite: "banner", behavior: "inert", color: "#f8d848", noCorpse: true, aura: { kind: "warded", radius: 80 }, ...N.banner },
  { key: "burrower", name: "土潜り", sprite: "mole", behavior: "burrower", color: "#8a6a40", ...N.burrower },
  { key: "dropper", name: "天井吊り", sprite: "hanger", behavior: "dropper", color: "#5a4a40", ...N.dropper },
  { key: "absorber", name: "吸い込み蟲", sprite: "maw", behavior: "absorber", color: "#c0a0ff", ...N.absorber },
  { key: "homunculus", name: "ホムンクルス", sprite: "homunculus", behavior: "homunculus", color: "#e080c0", ...N.homunculus },
  { key: "scribeImp", name: "写本の小悪魔", sprite: "scribeImp", behavior: "scribeImp", color: "#e0d8c0", ...N.scribeImp },
  { key: "crossGolem", name: "十字ゴーレム", sprite: "crossGolem", recolor: { base: "golem", swap: { z: "D", Z: "E", d: "w" } }, behavior: "crossGolem", color: "#e0d8c0", ...N.crossGolem },
  { key: "chainWarden", name: "鎖の番人", sprite: "chainWarden", recolor: { base: "knight", swap: { b: "S", B: "k", a: "s", y: "S" } }, behavior: "chainWarden", color: "#a0a0b0", ...N.chainWarden },
  { key: "hollow", name: "虚ろ", sprite: "hollow", behavior: "hollow", color: "#9090a0", ...N.hollow },
  { key: "lurker", name: "闇潜み", sprite: "lurker", recolor: { base: "shade", swap: { "9": "k", r: "y" } }, behavior: "charger", color: "#2a2438", biomeWeight: DARK_ONLY, ...N.lurker },
  // ---- 再配色種（元の絵と behavior に、追加の挙動を 1 つ） ----
  { key: "iceBoar", name: "氷猪", sprite: "iceBoar", recolor: { base: "boar", swap: { o: "3", O: "4", q: "2" } }, behavior: "charger", color: "#8fd0ff", chargeTrail: "ice", ...N.iceBoar },
  { key: "sootBomber", name: "煤ゴブリン", sprite: "sootBomber", recolor: { base: "bomber", swap: { g: "K", G: "k", h: "S" } }, behavior: "bomber", color: "#3a3a48", bombTerrain: { kind: "smoke", radius: 20 }, ...N.sootBomber },
  { key: "mossGolem", name: "苔ゴーレム", sprite: "mossGolem", recolor: { base: "golem", swap: { z: "V", Z: "v", d: "G" } }, behavior: "golem", color: "#5b7e48", sporeOnHit: "bog", ...N.mossGolem },
  { key: "swampWisp", name: "沼鬼火", sprite: "swampWisp", recolor: { base: "wisp", swap: { c: "J", C: "G" } }, behavior: "wisp", color: "#a0e040", phasing: true, terrainSpeed: { on: ["water", "bog"], mul: 2 }, ...N.swampWisp },
  { key: "frostToad", name: "霜蛙", sprite: "frostToad", recolor: { base: "toad", swap: { g: "3", G: "4", J: "2" } }, behavior: "lobber", color: "#8fd0ff", lob: { terrain: "ice", terrainRadius: 22, blastRadius: 18, damage: 10, color: "#8fd0ff" }, ...N.frostToad },
  { key: "magmaToad", name: "熔岩蛙", sprite: "magmaToad", recolor: { base: "toad", swap: { g: "o", G: "O", J: "y" } }, behavior: "lobber", color: "#e88838", lob: { terrain: "lava", terrainRadius: 12, blastRadius: 18, damage: 12, color: "#ff6030" }, ...N.magmaToad },
  { key: "oilSlime", name: "油スライム", sprite: "oilSlime", recolor: { base: "slime", swap: { g: "K", G: "k", h: "S" } }, behavior: "chaser", color: "#3a3a48", deathTerrain: { kind: "oil", radius: 20 }, ...N.oilSlime },
  { key: "stormEye", name: "雷眼", sprite: "stormEye", recolor: { base: "eye", swap: { p: "N", P: "y", e: "1" } }, behavior: "shooter", color: "#fff4a0", ...N.stormEye },
  { key: "emberRat", name: "火種鼠", sprite: "emberRat", recolor: { base: "rat", swap: { S: "R", s: "r", r: "y" } }, behavior: "kamikaze", color: "#e04848", ...N.emberRat, explode: { ...N.emberRat.explode, terrain: "fire" } },
  // ---- 部屋主（巣に 1 体、通常の抽選にも低い重みで混ざる） ----
  { key: "giantToad", name: "大蝦蟇", sprite: "giantToad", behavior: "giantToad", color: "#58d058", lairMaster: true, ...N.giantToad },
  { key: "forgeMaster", name: "炎の鍛冶", sprite: "forgeMaster", behavior: "forgeMaster", color: "#ff8030", lairMaster: true, pack: { minion: "anvil", count: 1 }, ...N.forgeMaster },
  { key: "anvil", name: "金床", sprite: "anvil", behavior: "inert", color: "#70707e", noCorpse: true, ...N.anvil },
  { key: "turretMaster", name: "砲台長", sprite: "turretMaster", behavior: "turretMaster", color: "#c0c0c0", lairMaster: true, ...N.turretMaster },
  { key: "turret", name: "砲台", sprite: "turret", behavior: "turret", color: "#a0a8c0", noCorpse: true, ...N.turret },
  { key: "basilisk", name: "石化の蜥蜴", sprite: "basilisk", behavior: "basilisk", color: "#a0e0a0", lairMaster: true, ...N.basilisk },
  { key: "shadowStalker", name: "影踏み", sprite: "shadowStalker", behavior: "shadowStalker", color: "#5a4a8a", lairMaster: true, ...N.shadowStalker },
  // ---- ボスとその付き物（付き物は minDepth 99 で抽選に出さない） ----
  { key: "oilKing", name: "油壺の王", sprite: "oilKing", behavior: "oilKing", color: "#c09050", boss: true, ...N.oilKing },
  { key: "broodMother", name: "群れの母", sprite: "broodMother", behavior: "broodMother", color: "#a0c040", boss: true, ...N.broodMother },
  { key: "broodEgg", name: "卵", sprite: "broodEgg", behavior: "egg", color: "#e0e0a0", noCorpse: true, ...N.broodEgg },
  { key: "librarian", name: "図書館の司書", sprite: "librarian", behavior: "librarian", color: "#c0a0ff", boss: true, ...N.librarian },
  { key: "mirrorKnight", name: "鏡の騎士", sprite: "mirrorKnight", behavior: "mirrorKnight", color: "#c0e0ff", boss: true, ...N.mirrorKnight },
  { key: "mirrorImage", name: "写し身", sprite: "mirrorImage", recolor: { base: "player", swap: { b: "3", B: "4", a: "2", t: "1", T: "s" } }, behavior: "charger", color: "#c0e0ff", noCorpse: true, ...N.mirrorImage },
  // ---- 2026-09-24 第 4 弾: 盗賊王と盗賊（盗賊はボスの取り巻きとランイベント「盗賊の追跡」だけに出る）----
  { key: "thiefKing", name: "盗賊王", sprite: "thiefKing", behavior: "thiefKing", color: "#d0a040", boss: true, ...N.thiefKing },
  { key: "thief", name: "盗賊", sprite: "thief", recolor: { base: "player", swap: { b: "9", B: "k", a: "A", O: "9", o: "K", y: "S", r: "A", R: "n" } }, behavior: "chaser", color: "#a08060", ...N.thief },
  // ---- 死神の付き物（影の死神。src/system/reaper.ts が呼ぶ。倒せるが湧き直す） ----
  { key: "reaperShade", name: "死神の影", sprite: "reaperShade", recolor: { base: "shade", swap: { "9": "P", r: "p" } }, behavior: "chaser", color: "#8040c0", noCorpse: true, phasing: true, ...N.reaperShade },
];
