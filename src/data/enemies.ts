import type { StatusKind } from "../core/status";
import type { FloorKind, RallyKind } from "../core/state";
import type { TerrainKind } from "../core/terrain";
import { WAVE3_ENEMIES } from "./enemiesWave3";

export type EnemyBehavior =
  | "chaser"
  | "shooter"
  | "charger"
  | "knight"
  | "bomber"
  | "laser"
  | "golem"
  | "bat"
  | "wisp"
  | "kingSlime"
  | "boneLord"
  // ---- 以下 2026-09-24 追加（docs/ideas/enemies.md） ----
  /** 近寄って予告の円を出し、自分ごと爆ぜる（導火鼠・結晶ダニ） */
  | "kamikaze"
  /** プレイヤーの少し前の位置を狙って炸裂させる（残像打ち） */
  | "echoStriker"
  /** 取り巻きを連れて湧き、遠吠えで一斉に飛びかからせる（群れの長） */
  | "packLeader"
  /** 骸骨兵を連れて湧き、指揮で一斉に攻撃させる（骨の楽団長） */
  | "conductor"
  /** 噛みついてマナを奪う（マナ喰い） */
  | "manaLeech"
  /** 死骸を食べて育つ（骨拾い） */
  | "scavenger"
  /** 動かず、鳴るたびに数を減らし、0 で死骸を蘇らせる（墓守の鐘） */
  | "graveBell"
  /** 足元に予告の円を出し、炸裂で沈黙を付ける（沈黙の修道士） */
  | "silencer"
  /** プレイヤーが冷気・凍結のときだけ大技を狙う（霜砕き） */
  | "frostCrusher"
  /** 2 体 1 組。片方が倒れて猶予内にもう片方を倒さないと蘇る（双子の影） */
  | "twinShade"
  /** 噛みつきと舌の薙ぎ払いを交互に使う部屋主（喰らう宝箱） */
  | "mimic"
  /** 盾で守る重装の部屋主。HP 半分で鎧が割れて亡霊になる（鎧の中身） */
  | "hollowArmor"
  /** 動かず攻撃もしない（霜の巨人の氷柱） */
  | "inert"
  /** ボス: 双子の騎士・兄（剣と盾） */
  | "twinBlade"
  /** ボス: 双子の騎士・妹（弓） */
  | "twinBow"
  /** ボス: 霜の巨人 */
  | "frostGiant"
  // ---- 以下 Wave 3（src/system/enemyWave3.ts。地形を作る敵を優先） ----
  /** 山なりに吐いて着弾点に地形を残す（毒吐き蛙・霜蛙・熔岩蛙） */
  | "lobber"
  /** 走り回って油を撒く（油壺運び） */
  | "oiler"
  /** 鐘を鳴らして周りの敵を急かす（呼び鈴小鬼） */
  | "bellImp"
  /** 旗を立てて周りの敵を守る（旗持ち） */
  | "bannerBearer"
  /** 地中を進み、足元で飛び出す（土潜り） */
  | "burrower"
  /** 天井に潜み、頭上の影から落ちてくる（天井吊り） */
  | "dropper"
  /** プレイヤーの弾を吸い込み、吐き返す（吸い込み蟲） */
  | "absorber"
  /** プレイヤーの状態異常を吸い取り、炸裂に乗せて返す（ホムンクルス） */
  | "homunculus"
  /** プレイヤーが最後に撃ったスキルを写して撃ち返す（写本の小悪魔） */
  | "scribeImp"
  /** 十字の 4 本の線を走らせる（十字ゴーレム） */
  | "crossGolem"
  /** 扇形の風でプレイヤー・敵・弾を押し流す（風吹き） */
  | "windSprite"
  /** 逃げながら地雷を撒く（地雷撒き） */
  | "mineLayer"
  /** 踏まれると爆ぜる設置物（地雷撒きの地雷） */
  | "mine"
  /** 鎖で引き寄せてから叩きつける（鎖の番人） */
  | "chainWarden"
  /** 照準を向けられている間は固まる（虚ろ） */
  | "hollow"
  /** 燃えているものを食べて育つ（火喰い） */
  | "flameEater"
  /** 時間で孵る卵（群れの母） */
  | "egg"
  /** 動かずに撃つ砲台（砲台長） */
  | "turret"
  /** 部屋主: 大蝦蟇 / 炎の鍛冶 / 砲台長 / 石化の蜥蜴 / 影踏み */
  | "giantToad"
  | "forgeMaster"
  | "turretMaster"
  | "basilisk"
  | "shadowStalker"
  /** ボス: 油壺の王 / 群れの母 / 図書館の司書 / 鏡の騎士 */
  | "oilKing"
  | "broodMother"
  | "librarian"
  | "mirrorKnight";

/** 再配色種: 元の絵のパレット文字を差し替えて別の絵にする（render/sprites.ts） */
export interface SpriteRecolor {
  /** 元にする SPRITES のキー */
  base: string;
  /** パレット文字 → 差し替え先のパレット文字 */
  swap: Readonly<Record<string, string>>;
}

/** 射撃（shooter）の弾の数と広がり、爆弾魔（bomber）の投げる数 */
export interface EnemyVolley {
  count: number;
  /** 両端の弾の角度差（度） */
  spreadDeg: number;
  /** 弾速の倍率 */
  speedMul?: number;
  /** 1 発の威力の倍率 */
  damageMul?: number;
  /** 弾の半径（px） */
  radius?: number;
}

/** 死んだときに全方位へ撒く弾 */
export interface EnemyDeathBurst {
  count: number;
  speed: number;
  damage: number;
  color: string;
}

/** 死んだ場所に残す時限爆発（爆弾の予告付き） */
export interface EnemyDeathBomb {
  radius: number;
  damage: number;
  fuse: number;
}

/** 自爆の範囲と威力 */
export interface EnemyExplode {
  radius: number;
  damage: number;
  color: string;
  /** 爆ぜた跡に残す地形（火種鼠の炎） */
  terrain?: TerrainKind;
}

/** 山なりに吐く玉（lobber）: 着弾の炸裂と、跡に残す地形 */
export interface EnemyLob {
  terrain: TerrainKind;
  terrainRadius: number;
  blastRadius: number;
  damage: number;
  color: string;
}

/** 地形を置く指定（倒れた跡・爆弾の跡） */
export interface EnemyTerrainDrop {
  kind: TerrainKind;
  radius: number;
}

export interface EnemyDef {
  key: string;
  name: string;
  sprite: string;
  radius: number;
  hp: number;
  speed: number;
  behavior: EnemyBehavior;
  /** strike 中に接触したときのダメージ */
  contactDamage: number;
  /** 攻撃の予備動作時間（秒）。長いほど避けやすい */
  windup: number;
  strikeTime: number;
  recover: number;
  /** 攻撃を始める距離（px） */
  engageRange: number;
  /**
   * 攻撃間隔（秒）。recover と合わせて全敵を旧値の ×0.9 にしてある（docs/COMBAT_DESIGN.md C-2）:
   * 手数を増やし反撃の窓を狭めて、1 対 1 でも被弾が起きるようにする。
   * QA 2026-09-23: 1 対 1 被弾 9.33 回/60 秒（目標 1〜3）と過多だったため ×0.8 → ×0.9 に戻した
   */
  attackInterval: number;
  score: number;
  minDepth: number;
  /** 出現の重み */
  weight: number;
  color: string;
  /** 撃破時の装備ドロップ基本確率 */
  dropChance: number;
  /** ボス。通常の抽選には出ず、エリートにもならない */
  boss?: boolean;
  /**
   * ボスの片割れ（双子の妹）。ボスの座（HP バー・撃破判定）は持たないが、
   * 状態異常・処刑・怯みの扱いはボスと同じにする（isBossClass）
   */
  bossPart?: boolean;
  /** 群れで湧く数（min..max）。抽選 1 回でこの数だけ出る */
  swarm?: { min: number; max: number };
  /** 壁をすり抜けて移動する */
  phasing?: boolean;
  /** 再配色種。sprite は自分の key にし、絵は元の絵から作る */
  recolor?: SpriteRecolor;
  /** 射撃・爆弾の数と広がり */
  volley?: EnemyVolley;
  /** レーザーを扇状に続けて撃つ（中央 → 左 → 右） */
  laserBeams?: { count: number; spreadDeg: number; followWindup: number };
  /** 追う途中で横へ回り込む強さ（0..1。狼） */
  flank?: number;
  /** 盾で正面の近接と弾を防ぐ */
  blocks?: boolean;
  /** 盾が割れると脆弱になって逃げる（黒鉄騎士） */
  rout?: boolean;
  /** 突進の終わりに残すもの（骨の壁 / 落石）。ice は突進の跡そのものが氷床になる（氷猪） */
  chargeTrail?: "boneWall" | "rockfall" | "ice";
  /** 攻撃せずに逃げ回り、lifetime 秒で消える（金色スライム） */
  timid?: { lifetime: number };
  /** プレイヤーがこの状態異常のとき足が速くなる（腐肉蝿） */
  frenzy?: { vs: readonly StatusKind[]; speedMul: number };
  /** 湧いたときに連れてくる取り巻き */
  pack?: { minion: string; count: number };
  /** 自爆（kamikaze） */
  explode?: EnemyExplode;
  /** 死んだときに撒く弾 */
  deathBurst?: EnemyDeathBurst;
  /** 死んだ場所の時限爆発 */
  deathBomb?: EnemyDeathBomb;
  /** 倒されたときにプレイヤーへ返すマナ */
  deathMana?: number;
  /** 死骸を残さない（設置物・氷柱など） */
  noCorpse?: boolean;
  /** 部屋主（ミニボス）。表示と QA の集計用 */
  lairMaster?: boolean;
  /** HP がこの割合を切ると別の敵に変わる（鎧の中身 → 亡霊） */
  transformTo?: { key: string; hpRatio: number };
  /** ボスの表示名（兄妹のように、個体名と別に部屋の主の名前を出す） */
  bossTitle?: string;
  /** バイオームごとの出現の重みの倍率（省略時は src/system/biomes.ts のファミリー表で決まる） */
  biomeWeight?: Partial<Record<FloorKind, number>>;
  // ---- Wave 3 の性質（src/system/enemyTerrain.ts / enemyWave3.ts）----
  /** 倒れた跡に地形を残す（予告の影の後に置く。泥人形の水たまり・油壺運びの油） */
  deathTerrain?: EnemyTerrainDrop;
  /** 山なりに吐く玉（lobber） */
  lob?: EnemyLob;
  /** 投げた爆弾の跡に地形を残す（煤ゴブリンの油） */
  bombTerrain?: EnemyTerrainDrop;
  /** 倒れたとき周りの敵に掛ける鼓舞（雷鬼火の帯電） */
  deathRally?: { kind: RallyKind; radius: number; time: number };
  /** 周りの敵に掛け続ける鼓舞（旗の加護） */
  aura?: { kind: RallyKind; radius: number };
  /** この地形の上では足が速い（沼鬼火） */
  terrainSpeed?: { on: readonly TerrainKind[]; mul: number };
  /** 被弾すると足元に小さな地形を出す（苔ゴーレムの胞子） */
  sporeOnHit?: TerrainKind;
}

/**
 * 量産した敵（docs/ideas/enemies.md）。行数を抑えるため 1 行に関連する数値をまとめて書く。
 * 並びは 再配色種 → 既存 behavior の流用 → 新しい behavior → 部屋主 → ボスとその付き物
 */
const WAVE2_ENEMIES: readonly EnemyDef[] = [
  // ---- 再配色種（元の敵の絵と behavior に、追加の挙動を 1 つ） ----
  {
    key: "poisonSlime", name: "毒スライム", sprite: "poisonSlime", recolor: { base: "slime", swap: { g: "p", G: "P", h: "e" } },
    radius: 6, hp: 22, speed: 55, behavior: "chaser", contactDamage: 9,
    windup: 0.35, strikeTime: 0.22, recover: 0.4, engageRange: 44, attackInterval: 0.18,
    score: 14, minDepth: 2, weight: 3, color: "#b060e0", dropChance: 0.09,
    deathTerrain: { kind: "bog", radius: 16 },
  },
  {
    key: "iceSlime", name: "氷スライム", sprite: "iceSlime", recolor: { base: "slime", swap: { g: "3", G: "4", h: "2" } },
    radius: 6, hp: 24, speed: 50, behavior: "chaser", contactDamage: 9,
    windup: 0.35, strikeTime: 0.22, recover: 0.4, engageRange: 44, attackInterval: 0.18,
    score: 15, minDepth: 3, weight: 3, color: "#8fd0ff", dropChance: 0.09,
    deathTerrain: { kind: "ice", radius: 16 },
  },
  {
    key: "fireSlime", name: "炎スライム", sprite: "fireSlime", recolor: { base: "slime", swap: { g: "o", G: "O", h: "y" } },
    radius: 6, hp: 22, speed: 60, behavior: "chaser", contactDamage: 10,
    windup: 0.35, strikeTime: 0.22, recover: 0.4, engageRange: 44, attackInterval: 0.18,
    score: 16, minDepth: 4, weight: 3, color: "#e88838", dropChance: 0.09,
    deathBomb: { radius: 26, damage: 10, fuse: 0.6 },
  },
  {
    key: "goldSlime", name: "金色スライム", sprite: "goldSlime", recolor: { base: "slime", swap: { g: "y", G: "Y", h: "1" } },
    radius: 6, hp: 30, speed: 72, behavior: "chaser", contactDamage: 0,
    windup: 0.35, strikeTime: 0.22, recover: 0.4, engageRange: 0, attackInterval: 1,
    score: 150, minDepth: 2, weight: 0.5, color: "#f8d848", dropChance: 1,
    timid: { lifetime: 10 },
  },
  {
    key: "boneBoar", name: "骨猪", sprite: "boneBoar", recolor: { base: "boar", swap: { o: "D", O: "E", q: "s", r: "R" } },
    radius: 7, hp: 70, speed: 38, behavior: "charger", contactDamage: 20,
    windup: 0.6, strikeTime: 0.7, recover: 0.54, engageRange: 130, attackInterval: 0.9,
    score: 50, minDepth: 5, weight: 2, color: "#e0d8c0", dropChance: 0.25,
    chargeTrail: "boneWall",
  },
  {
    key: "curseEye", name: "呪い眼", sprite: "curseEye", recolor: { base: "eye", swap: { p: "r", P: "R", e: "q" } },
    radius: 6, hp: 16, speed: 42, behavior: "shooter", contactDamage: 0,
    windup: 0.4, strikeTime: 0.05, recover: 0.32, engageRange: 150, attackInterval: 1.26,
    score: 18, minDepth: 4, weight: 3, color: "#e04848", dropChance: 0.08,
  },
  {
    key: "frostEye", name: "氷眼", sprite: "frostEye", recolor: { base: "eye", swap: { p: "3", P: "4", e: "2" } },
    radius: 6, hp: 16, speed: 40, behavior: "shooter", contactDamage: 0,
    windup: 0.5, strikeTime: 0.05, recover: 0.4, engageRange: 150, attackInterval: 1.5,
    score: 22, minDepth: 5, weight: 3, color: "#8fd0ff", dropChance: 0.09,
    volley: { count: 3, spreadDeg: 30, speedMul: 0.7 },
  },
  {
    key: "blackKnight", name: "黒鉄騎士", sprite: "blackKnight",
    recolor: { base: "knight", swap: { s: "S", S: "m", b: "K", B: "k", a: "M" } },
    radius: 7, hp: 75, speed: 32, behavior: "knight", contactDamage: 18,
    windup: 0.55, strikeTime: 0.25, recover: 0.63, engageRange: 40, attackInterval: 0.99,
    score: 50, minDepth: 6, weight: 2, color: "#5a5a6a", dropChance: 0.25,
    blocks: true, rout: true,
  },
  {
    key: "lavaGolem", name: "溶岩ゴーレム", sprite: "lavaGolem", recolor: { base: "golem", swap: { z: "o", Z: "O", d: "R", V: "r", v: "R" } },
    radius: 10, hp: 150, speed: 22, behavior: "golem", contactDamage: 22,
    windup: 1.0, strikeTime: 0.6, recover: 1.08, engageRange: 60, attackInterval: 1.44,
    score: 70, minDepth: 6, weight: 1.5, color: "#e88838", dropChance: 0.3,
  },
  {
    key: "frostGolem", name: "霜ゴーレム", sprite: "frostGolem", recolor: { base: "golem", swap: { z: "2", Z: "3", d: "4", V: "c", v: "C" } },
    radius: 10, hp: 150, speed: 22, behavior: "golem", contactDamage: 22,
    windup: 1.0, strikeTime: 0.6, recover: 1.08, engageRange: 60, attackInterval: 1.44,
    score: 80, minDepth: 8, weight: 1.5, color: "#8fd0ff", dropChance: 0.3,
    deathBurst: { count: 8, speed: 110, damage: 8, color: "#8fd0ff" },
  },
  {
    key: "crystalGolem", name: "結晶ゴーレム", sprite: "crystalGolem", recolor: { base: "golem", swap: { z: "c", Z: "C", d: "B", V: "1", v: "c" } },
    radius: 10, hp: 130, speed: 22, behavior: "golem", contactDamage: 20,
    windup: 1.0, strikeTime: 0.6, recover: 1.08, engageRange: 60, attackInterval: 1.44,
    score: 70, minDepth: 5, weight: 1, color: "#60e0f0", dropChance: 0.3,
    deathMana: 40,
  },
  {
    key: "frostWisp", name: "氷鬼火", sprite: "frostWisp", recolor: { base: "wisp", swap: { c: "2", C: "3" } },
    radius: 5, hp: 18, speed: 40, behavior: "wisp", contactDamage: 8,
    windup: 0.3, strikeTime: 0.3, recover: 0.54, engageRange: 30, attackInterval: 1.08,
    score: 22, minDepth: 5, weight: 2, color: "#e0f4ff", dropChance: 0.1, phasing: true,
  },
  {
    key: "purpleLaser", name: "紫光線眼", sprite: "purpleLaser", recolor: { base: "laserEye", swap: { p: "A", P: "n", r: "p", R: "P" } },
    radius: 6, hp: 24, speed: 30, behavior: "laser", contactDamage: 0,
    windup: 1.2, strikeTime: 0.4, recover: 0.54, engageRange: 170, attackInterval: 2.16,
    score: 34, minDepth: 5, weight: 2, color: "#c060e0", dropChance: 0.15,
  },
  {
    key: "flyingBook", name: "飛ぶ本", sprite: "flyingBook", recolor: { base: "bat", swap: { P: "W", p: "1", r: "k" } },
    radius: 4, hp: 8, speed: 85, behavior: "bat", contactDamage: 6,
    windup: 0.25, strikeTime: 0.25, recover: 0.45, engageRange: 36, attackInterval: 0.6,
    score: 8, minDepth: 4, weight: 2, color: "#e0d8c0", dropChance: 0.04,
    swarm: { min: 2, max: 3 }, deathBurst: { count: 3, speed: 90, damage: 6, color: "#f0f0f0" },
  },
  {
    key: "ashBat", name: "灰蝙蝠", sprite: "ashBat", recolor: { base: "bat", swap: { P: "S", p: "s", r: "o" } },
    radius: 4, hp: 4, speed: 95, behavior: "bat", contactDamage: 5,
    windup: 0.25, strikeTime: 0.25, recover: 0.45, engageRange: 36, attackInterval: 0.54,
    score: 4, minDepth: 5, weight: 1.5, color: "#70707e", dropChance: 0.02,
    swarm: { min: 4, max: 6 },
  },
  // ---- 既存 behavior の流用 ----
  {
    key: "sproutSlime", name: "若苗スライム", sprite: "sproutSlime", recolor: { base: "slime", swap: { g: "V", G: "v" } },
    radius: 5, hp: 8, speed: 62, behavior: "chaser", contactDamage: 5,
    windup: 0.3, strikeTime: 0.2, recover: 0.4, engageRange: 40, attackInterval: 0.3,
    score: 5, minDepth: 1, weight: 1.5, color: "#5b7e48", dropChance: 0.03,
    swarm: { min: 3, max: 5 },
  },
  {
    key: "spikeRat", name: "棘鼠", sprite: "rat",
    radius: 5, hp: 10, speed: 85, behavior: "bat", contactDamage: 6,
    windup: 0.25, strikeTime: 0.25, recover: 0.45, engageRange: 36, attackInterval: 0.6,
    score: 7, minDepth: 2, weight: 3, color: "#70707e", dropChance: 0.04,
    swarm: { min: 3, max: 4 },
  },
  {
    key: "twinEye", name: "双眼", sprite: "twinEye", recolor: { base: "eye", swap: { p: "y", P: "Y", e: "1" } },
    radius: 6, hp: 16, speed: 42, behavior: "shooter", contactDamage: 0,
    windup: 0.5, strikeTime: 0.05, recover: 0.32, engageRange: 150, attackInterval: 1.35,
    score: 18, minDepth: 3, weight: 3, color: "#f8d848", dropChance: 0.08,
    volley: { count: 2, spreadDeg: 26 },
  },
  {
    key: "triLaser", name: "三叉光線眼", sprite: "triLaser", recolor: { base: "laserEye", swap: { p: "o", P: "O", r: "y", R: "Y" } },
    radius: 6, hp: 30, speed: 28, behavior: "laser", contactDamage: 0,
    windup: 1.2, strikeTime: 0.3, recover: 0.7, engageRange: 170, attackInterval: 2.6,
    score: 45, minDepth: 7, weight: 2, color: "#e88838", dropChance: 0.18,
    laserBeams: { count: 3, spreadDeg: 22, followWindup: 0.45 },
  },
  {
    key: "shadowBat", name: "影蝙蝠", sprite: "shadowBat", recolor: { base: "bat", swap: { P: "9", p: "A" } },
    radius: 4, hp: 7, speed: 95, behavior: "bat", contactDamage: 6,
    windup: 0.25, strikeTime: 0.25, recover: 0.45, engageRange: 36, attackInterval: 0.6,
    score: 8, minDepth: 6, weight: 2, color: "#5a4a8a", dropChance: 0.03,
    swarm: { min: 3, max: 4 }, phasing: true,
  },
  {
    key: "wolf", name: "狼", sprite: "wolf",
    radius: 6, hp: 22, speed: 70, behavior: "chaser", contactDamage: 9,
    windup: 0.4, strikeTime: 0.25, recover: 0.5, engageRange: 50, attackInterval: 0.6,
    score: 14, minDepth: 3, weight: 2, color: "#a0a0b0", dropChance: 0.06,
    swarm: { min: 2, max: 3 }, flank: 0.8,
  },
  {
    key: "multiBomber", name: "連投ゴブリン", sprite: "multiBomber", recolor: { base: "bomber", swap: { g: "o", G: "O", h: "q" } },
    radius: 6, hp: 28, speed: 48, behavior: "bomber", contactDamage: 0,
    windup: 0.5, strikeTime: 0.1, recover: 0.5, engageRange: 110, attackInterval: 2.3,
    score: 30, minDepth: 4, weight: 2, color: "#e88838", dropChance: 0.12,
    volley: { count: 3, spreadDeg: 50, damageMul: 0.6 },
  },
  {
    key: "spearman", name: "槍兵", sprite: "spearman", recolor: { base: "knight", swap: { b: "o", B: "O", a: "q" } },
    radius: 7, hp: 45, speed: 34, behavior: "charger", contactDamage: 16,
    windup: 0.55, strikeTime: 0.22, recover: 0.6, engageRange: 70, attackInterval: 1.0,
    score: 30, minDepth: 4, weight: 3, color: "#e88838", dropChance: 0.15,
  },
  {
    key: "hornBeetle", name: "角甲虫", sprite: "beetle",
    radius: 7, hp: 50, speed: 36, behavior: "charger", contactDamage: 16,
    windup: 0.5, strikeTime: 0.45, recover: 0.6, engageRange: 110, attackInterval: 1.1,
    score: 32, minDepth: 3, weight: 2, color: "#58d058", dropChance: 0.15,
    chargeTrail: "rockfall",
  },
  {
    key: "netter", name: "投網兵", sprite: "netter", recolor: { base: "bomber", swap: { g: "c", G: "C", h: "1" } },
    radius: 6, hp: 30, speed: 40, behavior: "shooter", contactDamage: 0,
    windup: 0.7, strikeTime: 0.05, recover: 0.5, engageRange: 130, attackInterval: 2.0,
    score: 26, minDepth: 5, weight: 2, color: "#60e0f0", dropChance: 0.1,
    volley: { count: 1, spreadDeg: 0, speedMul: 0.55, damageMul: 0.6, radius: 5 },
  },
  {
    key: "carrionFly", name: "腐肉蝿", sprite: "carrionFly", recolor: { base: "bat", swap: { P: "v", p: "J" } },
    radius: 4, hp: 6, speed: 80, behavior: "bat", contactDamage: 4,
    windup: 0.25, strikeTime: 0.25, recover: 0.45, engageRange: 36, attackInterval: 0.6,
    score: 6, minDepth: 3, weight: 2, color: "#a0e040", dropChance: 0.03,
    swarm: { min: 3, max: 5 }, frenzy: { vs: ["bleed", "poison"], speedMul: 1.5 },
  },
  {
    key: "thunderWisp", name: "雷鬼火", sprite: "thunderWisp", recolor: { base: "wisp", swap: { c: "N", C: "y" } },
    radius: 5, hp: 18, speed: 40, behavior: "wisp", contactDamage: 8,
    windup: 0.3, strikeTime: 0.3, recover: 0.54, engageRange: 30, attackInterval: 1.08,
    score: 22, minDepth: 5, weight: 2, color: "#fff4a0", dropChance: 0.1, phasing: true,
    deathRally: { kind: "charged", radius: 60, time: 5 },
  },
  {
    key: "skeleton", name: "骸骨兵", sprite: "skeleton",
    radius: 6, hp: 26, speed: 45, behavior: "chaser", contactDamage: 11,
    windup: 0.45, strikeTime: 0.22, recover: 0.5, engageRange: 42, attackInterval: 0.5,
    score: 16, minDepth: 4, weight: 2, color: "#e0d8c0", dropChance: 0.08,
  },
  // ---- 新しい behavior ----
  {
    key: "fuseRat", name: "導火鼠", sprite: "fuseRat", recolor: { base: "rat", swap: { S: "O", s: "o", r: "y" } },
    radius: 5, hp: 10, speed: 80, behavior: "kamikaze", contactDamage: 0,
    windup: 0.9, strikeTime: 0.05, recover: 0.3, engageRange: 26, attackInterval: 0.3,
    score: 9, minDepth: 3, weight: 2, color: "#e88838", dropChance: 0.03,
    swarm: { min: 2, max: 3 }, explode: { radius: 30, damage: 16, color: "#ff8030" },
  },
  {
    key: "crystalMite", name: "結晶ダニ", sprite: "mite",
    radius: 5, hp: 8, speed: 60, behavior: "kamikaze", contactDamage: 0,
    windup: 0.6, strikeTime: 0.05, recover: 0.3, engageRange: 22, attackInterval: 0.3,
    score: 8, minDepth: 3, weight: 2, color: "#60e0f0", dropChance: 0.03,
    swarm: { min: 3, max: 5 }, explode: { radius: 24, damage: 12, color: "#60e0f0" }, deathMana: 5,
  },
  {
    key: "echoStriker", name: "残像打ち", sprite: "hooded",
    radius: 6, hp: 34, speed: 40, behavior: "echoStriker", contactDamage: 0,
    windup: 1.0, strikeTime: 0.1, recover: 0.6, engageRange: 180, attackInterval: 2.4,
    score: 45, minDepth: 6, weight: 2, color: "#5a4a8a", dropChance: 0.15,
  },
  {
    key: "packLeader", name: "群れの長", sprite: "packLeader", recolor: { base: "wolf", swap: { S: "W", s: "q" } },
    radius: 7, hp: 55, speed: 55, behavior: "packLeader", contactDamage: 12,
    windup: 1.0, strikeTime: 0.3, recover: 0.8, engageRange: 70, attackInterval: 3.0,
    score: 60, minDepth: 4, weight: 1, color: "#7a6a58", dropChance: 0.3,
    pack: { minion: "wolf", count: 3 },
  },
  {
    key: "manaLeech", name: "気力喰い", sprite: "leech",
    radius: 6, hp: 30, speed: 58, behavior: "manaLeech", contactDamage: 8,
    windup: 0.5, strikeTime: 0.25, recover: 0.6, engageRange: 40, attackInterval: 0.9,
    score: 30, minDepth: 4, weight: 2, color: "#3c7ad8", dropChance: 0.12,
  },
  {
    key: "scavenger", name: "骨拾い", sprite: "ghoul",
    radius: 6, hp: 40, speed: 48, behavior: "scavenger", contactDamage: 12,
    windup: 0.5, strikeTime: 0.25, recover: 0.6, engageRange: 44, attackInterval: 0.9,
    score: 35, minDepth: 4, weight: 2, color: "#5b7e48", dropChance: 0.15,
  },
  {
    key: "graveBell", name: "墓守の鐘", sprite: "bell",
    radius: 7, hp: 60, speed: 0, behavior: "graveBell", contactDamage: 0,
    windup: 1.0, strikeTime: 0.1, recover: 0.3, engageRange: 9999, attackInterval: 2.5,
    score: 40, minDepth: 5, weight: 1, color: "#f8d848", dropChance: 0.2, noCorpse: true,
  },
  {
    key: "silencer", name: "沈黙の修道士", sprite: "silencer", recolor: { base: "hooded", swap: { A: "n", "9": "k", c: "p" } },
    radius: 6, hp: 38, speed: 32, behavior: "silencer", contactDamage: 0,
    windup: 1.2, strikeTime: 0.1, recover: 0.8, engageRange: 160, attackInterval: 4.0,
    score: 40, minDepth: 5, weight: 2, color: "#c060e0", dropChance: 0.15,
  },
  {
    key: "frostCrusher", name: "霜砕き", sprite: "frostCrusher", recolor: { base: "golem", swap: { z: "S", Z: "4", d: "k", V: "3", v: "2" } },
    radius: 10, hp: 160, speed: 20, behavior: "frostCrusher", contactDamage: 30,
    windup: 1.0, strikeTime: 0.5, recover: 1.2, engageRange: 55, attackInterval: 1.6,
    score: 80, minDepth: 8, weight: 1.5, color: "#3c6ea8", dropChance: 0.3,
  },
  {
    key: "twinShade", name: "双子の影", sprite: "shade",
    radius: 6, hp: 36, speed: 55, behavior: "twinShade", contactDamage: 12,
    windup: 0.45, strikeTime: 0.25, recover: 0.5, engageRange: 50, attackInterval: 0.8,
    score: 40, minDepth: 7, weight: 1.5, color: "#5a4a8a", dropChance: 0.12,
    pack: { minion: "twinShade", count: 1 },
  },
  // ---- 部屋主（通常の抽選に低い重みで混ぜる） ----
  {
    key: "mimic", name: "喰らう宝箱", sprite: "mimic",
    radius: 10, hp: 220, speed: 40, behavior: "mimic", contactDamage: 22,
    windup: 0.8, strikeTime: 0.35, recover: 1.2, engageRange: 90, attackInterval: 1.2,
    score: 300, minDepth: 3, weight: 0.3, color: "#b88a50", dropChance: 1, lairMaster: true,
  },
  {
    key: "hollowArmor", name: "鎧の中身", sprite: "hollowArmor",
    radius: 10, hp: 260, speed: 24, behavior: "hollowArmor", contactDamage: 24,
    windup: 1.0, strikeTime: 0.5, recover: 1.0, engageRange: 60, attackInterval: 1.5,
    score: 350, minDepth: 5, weight: 0.3, color: "#c8c8d0", dropChance: 1, lairMaster: true,
    blocks: true, transformTo: { key: "hollowWraith", hpRatio: 0.5 },
  },
  {
    key: "hollowWraith", name: "鎧の中身・亡霊", sprite: "hollowWraith", recolor: { base: "hooded", swap: { A: "3", "9": "2", c: "r" } },
    radius: 7, hp: 260, speed: 50, behavior: "charger", contactDamage: 18,
    windup: 0.5, strikeTime: 0.45, recover: 0.7, engageRange: 130, attackInterval: 0.8,
    score: 350, minDepth: 99, weight: 0, color: "#8fd0ff", dropChance: 1, lairMaster: true, phasing: true,
  },
  {
    key: "boneConductor", name: "骨の楽団長", sprite: "boneConductor", recolor: { base: "skeleton", swap: { D: "p", E: "P" } },
    radius: 7, hp: 160, speed: 30, behavior: "conductor", contactDamage: 0,
    windup: 1.0, strikeTime: 0.2, recover: 1.0, engageRange: 170, attackInterval: 2.6,
    score: 300, minDepth: 6, weight: 0.3, color: "#c060e0", dropChance: 1, lairMaster: true,
    pack: { minion: "skeleton", count: 4 },
  },
  // ---- ボスとその付き物（付き物は minDepth 99 で抽選に出さない） ----
  {
    key: "twinBrother", name: "双子の騎士・兄", sprite: "twinBrother", bossTitle: "双子の騎士",
    radius: 12, hp: 650, speed: 42, behavior: "twinBlade", contactDamage: 18,
    windup: 0.7, strikeTime: 0.3, recover: 0.8, engageRange: 70, attackInterval: 1.1,
    score: 1500, minDepth: 99, weight: 0, color: "#c8c8d0", dropChance: 0, boss: true, blocks: true,
  },
  {
    key: "twinSister", name: "双子の騎士・妹", sprite: "twinSister",
    radius: 12, hp: 450, speed: 38, behavior: "twinBow", contactDamage: 14,
    windup: 0.8, strikeTime: 0.1, recover: 0.7, engageRange: 220, attackInterval: 1.4,
    score: 800, minDepth: 99, weight: 0, color: "#58d058", dropChance: 0, noCorpse: true, bossPart: true,
  },
  {
    key: "frostGiant", name: "霜の巨人", sprite: "frostGiant",
    radius: 14, hp: 1100, speed: 26, behavior: "frostGiant", contactDamage: 22,
    windup: 1.0, strikeTime: 0.5, recover: 1.0, engageRange: 90, attackInterval: 1.4,
    score: 2500, minDepth: 99, weight: 0, color: "#8fd0ff", dropChance: 0, boss: true,
  },
  {
    key: "icePillar", name: "氷柱", sprite: "icePillar",
    radius: 6, hp: 40, speed: 0, behavior: "inert", contactDamage: 0,
    windup: 1, strikeTime: 0.1, recover: 1, engageRange: 0, attackInterval: 99,
    score: 20, minDepth: 99, weight: 0, color: "#8fd0ff", dropChance: 0, noCorpse: true,
  },
  // ---- 試し場の木人（src/system/specialRooms.ts が置く。動かず殴り返さず、撃破数・報酬に数えない）----
  {
    key: "trainingDummy", name: "木人", sprite: "trainingDummy", recolor: { base: "icePillar", swap: { "1": "T", "2": "T", "3": "T", "4": "X" } },
    radius: 6, hp: 120, speed: 0, behavior: "inert", contactDamage: 0,
    windup: 1, strikeTime: 0.1, recover: 1, engageRange: 0, attackInterval: 99,
    score: 0, minDepth: 99, weight: 0, color: "#c8a070", dropChance: 0, noCorpse: true,
  },
  // ---- 鏡の部屋の写し（src/system/specialRooms.ts が HP・エリート修飾子をプレイヤーの今のビルドから決める）----
  {
    key: "mirrorSelf", name: "鏡像", sprite: "mirrorSelf", recolor: { base: "player", swap: { b: "p", B: "P", a: "e", t: "3", T: "4", o: "A", O: "9" } },
    radius: 6, hp: 60, speed: 46, behavior: "charger", contactDamage: 16,
    windup: 0.55, strikeTime: 0.5, recover: 0.5, engageRange: 120, attackInterval: 0.8,
    score: 400, minDepth: 99, weight: 0, color: "#c0e0ff", dropChance: 0, noCorpse: true,
  },
];

export const ENEMIES: readonly EnemyDef[] = [
  {
    key: "slime",
    name: "スライム",
    sprite: "slime",
    radius: 6,
    hp: 20,
    speed: 55,
    behavior: "chaser",
    contactDamage: 10,
    windup: 0.35,
    strikeTime: 0.22,
    recover: 0.4,
    engageRange: 44,
    attackInterval: 0.18,
    score: 10,
    minDepth: 1,
    weight: 10,
    color: "#40c040",
    dropChance: 0.08,
  },
  {
    key: "eye",
    name: "浮遊眼",
    sprite: "eye",
    radius: 6,
    hp: 14,
    speed: 42,
    behavior: "shooter",
    contactDamage: 0,
    /** 0.4 → 0.5（QA 2026-09-24: 1 対 1 被弾の主因が浮遊眼の弾。予告を読める長さに） */
    windup: 0.5,
    strikeTime: 0.05,
    recover: 0.32,
    engageRange: 150,
    attackInterval: 1.26,
    score: 15,
    minDepth: 1,
    weight: 6,
    color: "#b050d0",
    dropChance: 0.08,
  },
  {
    key: "boar",
    name: "猪",
    sprite: "boar",
    radius: 7,
    hp: 60,
    speed: 38,
    behavior: "charger",
    contactDamage: 20,
    windup: 0.6,
    strikeTime: 0.7,
    recover: 0.54,
    engageRange: 130,
    attackInterval: 0.9,
    score: 40,
    minDepth: 2,
    weight: 3,
    color: "#e08030",
    dropChance: 0.25,
  },
  {
    key: "knight",
    name: "盾騎士",
    sprite: "knight",
    radius: 7,
    hp: 55,
    speed: 30,
    behavior: "knight",
    contactDamage: 16,
    windup: 0.55,
    strikeTime: 0.25,
    recover: 0.63,
    engageRange: 40,
    attackInterval: 0.99,
    score: 35,
    minDepth: 3,
    weight: 3,
    color: "#a0a8c0",
    dropChance: 0.2,
    blocks: true,
  },
  {
    key: "bomber",
    name: "爆弾ゴブリン",
    sprite: "bomber",
    radius: 6,
    hp: 26,
    speed: 50,
    behavior: "bomber",
    contactDamage: 0,
    windup: 0.45,
    strikeTime: 0.1,
    recover: 0.45,
    engageRange: 110,
    attackInterval: 1.98,
    score: 25,
    minDepth: 2,
    weight: 4,
    color: "#70b040",
    dropChance: 0.12,
  },
  {
    key: "laserEye",
    name: "光線眼",
    sprite: "laserEye",
    radius: 6,
    hp: 24,
    speed: 30,
    behavior: "laser",
    contactDamage: 0,
    windup: 1.2,
    strikeTime: 0.4,
    recover: 0.54,
    engageRange: 170,
    attackInterval: 2.16,
    score: 30,
    minDepth: 3,
    weight: 3,
    color: "#ff5050",
    dropChance: 0.15,
  },
  {
    key: "golem",
    name: "ゴーレム",
    sprite: "golem",
    radius: 10,
    hp: 140,
    speed: 22,
    behavior: "golem",
    contactDamage: 22,
    windup: 1.0,
    strikeTime: 0.6,
    recover: 1.08,
    engageRange: 60,
    attackInterval: 1.44,
    score: 60,
    minDepth: 4,
    weight: 2,
    color: "#a8a290",
    dropChance: 0.3,
  },
  {
    key: "bat",
    name: "蝙蝠",
    sprite: "bat",
    radius: 4,
    hp: 7,
    speed: 95,
    behavior: "bat",
    contactDamage: 6,
    windup: 0.25,
    strikeTime: 0.25,
    recover: 0.45,
    engageRange: 36,
    attackInterval: 0.54,
    score: 6,
    minDepth: 1,
    weight: 3,
    color: "#8060a0",
    dropChance: 0.03,
    swarm: { min: 3, max: 5 },
  },
  {
    key: "wisp",
    name: "鬼火",
    sprite: "wisp",
    radius: 5,
    hp: 18,
    speed: 40,
    behavior: "wisp",
    contactDamage: 8,
    windup: 0.3,
    strikeTime: 0.3,
    recover: 0.54,
    engageRange: 30,
    attackInterval: 1.08,
    score: 20,
    minDepth: 3,
    weight: 3,
    color: "#60c0ff",
    dropChance: 0.1,
    phasing: true,
  },
  {
    key: "kingSlime",
    name: "スライム王",
    sprite: "kingSlime",
    radius: 14,
    hp: 700,
    speed: 45,
    behavior: "kingSlime",
    contactDamage: 18,
    windup: 0.9,
    strikeTime: 0.7,
    recover: 0.72,
    engageRange: 400,
    attackInterval: 1.08,
    score: 1000,
    minDepth: 99,
    weight: 0,
    color: "#40c040",
    dropChance: 0,
    boss: true,
  },
  {
    key: "boneLord",
    name: "骸骨卿",
    sprite: "boneLord",
    radius: 12,
    hp: 900,
    speed: 35,
    behavior: "boneLord",
    contactDamage: 16,
    windup: 0.8,
    strikeTime: 1.2,
    recover: 0.72,
    engageRange: 400,
    attackInterval: 0.9,
    score: 2000,
    minDepth: 99,
    weight: 0,
    color: "#d0c8a8",
    dropChance: 0,
    boss: true,
  },
  ...WAVE2_ENEMIES,
  ...WAVE3_ENEMIES,
];

const ENEMY_BY_KEY: ReadonlyMap<string, EnemyDef> = new Map(ENEMIES.map((e) => [e.key, e]));

/** 毎ステップ何度も引くので Map で引く（敵の種類が 40 を超えたため） */
export function enemyDef(key: string): EnemyDef {
  const def = ENEMY_BY_KEY.get(key);
  if (!def) throw new Error(`unknown enemy: ${key}`);
  return def;
}

/** ボスとして扱う敵か（ボス本体と、双子の妹のようなボスの片割れ）。凍結・処刑・状態異常の上限はこれで判定する */
export function isBossClass(def: EnemyDef): boolean {
  return def.boss === true || def.bossPart === true;
}

/** 処刑（即死）が効かない敵: ボス・部屋主・変身する敵（鎧の中身に亡霊の段階を飛ばさせない） */
export function isExecuteImmune(def: EnemyDef): boolean {
  return isBossClass(def) || def.lairMaster === true || def.transformTo !== undefined;
}

/** 描画の見た目の元（再配色種は元の敵）。浮遊・影の扱いを元の敵に揃える */
export function spriteBaseKey(def: EnemyDef): string {
  return def.recolor?.base ?? def.sprite;
}

export function enemiesForDepth(depth: number): EnemyDef[] {
  return ENEMIES.filter((e) => !e.boss && depth >= e.minDepth);
}

/** 深さによるステータス倍率 */
export function depthHpScale(depth: number): number {
  return 1 + (depth - 1) * 0.18;
}

export function depthDamageBonus(depth: number): number {
  return Math.floor((depth - 1) / 2) * 2;
}
