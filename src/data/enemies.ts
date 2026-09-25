import type { StatusKind } from "../core/status";
import type { FloorKind, RallyKind } from "../core/state";
import type { TerrainKind } from "../core/terrain";
import { BALANCE } from "./balance";
import { ENEMY_SCALE } from "./tuning";
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
  | "mirrorKnight"
  /** ボス: 盗賊王（逃げながら罠を撒き、追い詰めるとダウン。src/system/bossThiefKing.ts） */
  | "thiefKing";

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
  /** 攻撃間隔（秒）。数値は src/data/balance/enemies/ の "stats"（変更したい場合はそこを編集する） */
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
  /** 突進が折れ線の 2 本になる（二度突きの猪。数値は tuning の DOUBLE_CHARGE、処理は src/system/enemyBehaviors.ts） */
  doubleCharge?: boolean;
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
  /** 倒れた跡に地形を残す（予告の影の後に置く。泥人形の泥・油壺運びの油） */
  deathTerrain?: EnemyTerrainDrop;
  /** 山なりに吐く玉（lobber） */
  lob?: EnemyLob;
  /** 投げた爆弾の跡に地形を残す（煤ゴブリンの煙） */
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
 * 敵ごとの数値本体（radius/hp/speed/windup など + swarm/volley/explode などの数値だけの構造）。
 * src/data/balance/enemies/ の "stats"。値を変えたいときはここではなく JSON を編集する
 * (docs/ideas/data-externalization.md 2 章)
 */
const N = BALANCE.enemies.stats;

/**
 * 量産した敵（docs/ideas/enemies.md）。行数を抑えるため 1 行に関連する項目をまとめて書く。
 * 並びは 再配色種 → 既存 behavior の流用 → 新しい behavior → 部屋主 → ボスとその付き物
 */
const WAVE2_ENEMIES: readonly EnemyDef[] = [
  // ---- 再配色種（元の敵の絵と behavior に、追加の挙動を 1 つ） ----
  { key: "poisonSlime", name: "毒スライム", sprite: "poisonSlime", recolor: { base: "slime", swap: { g: "p", G: "P", h: "e" } }, behavior: "chaser", color: "#b060e0", deathTerrain: { kind: "bog", radius: 16 }, ...N.poisonSlime },
  { key: "iceSlime", name: "氷スライム", sprite: "iceSlime", recolor: { base: "slime", swap: { g: "3", G: "4", h: "2" } }, behavior: "chaser", color: "#8fd0ff", deathTerrain: { kind: "ice", radius: 16 }, ...N.iceSlime },
  { key: "fireSlime", name: "炎スライム", sprite: "fireSlime", recolor: { base: "slime", swap: { g: "o", G: "O", h: "y" } }, behavior: "chaser", color: "#e88838", ...N.fireSlime },
  { key: "goldSlime", name: "金色スライム", sprite: "goldSlime", recolor: { base: "slime", swap: { g: "y", G: "Y", h: "1" } }, behavior: "chaser", color: "#f8d848", ...N.goldSlime },
  { key: "boneBoar", name: "骨猪", sprite: "boneBoar", recolor: { base: "boar", swap: { o: "D", O: "E", q: "s", r: "R" } }, behavior: "charger", color: "#e0d8c0", chargeTrail: "boneWall", ...N.boneBoar },
  { key: "boarDouble", name: "二度突きの猪", sprite: "boarDouble", recolor: { base: "boar", swap: { o: "r", O: "R", r: "y" } }, behavior: "charger", color: "#d04040", doubleCharge: true, ...N.boarDouble },
  { key: "curseEye", name: "呪い眼", sprite: "curseEye", recolor: { base: "eye", swap: { p: "r", P: "R", e: "q" } }, behavior: "shooter", color: "#e04848", ...N.curseEye },
  { key: "frostEye", name: "氷眼", sprite: "frostEye", recolor: { base: "eye", swap: { p: "3", P: "4", e: "2" } }, behavior: "shooter", color: "#8fd0ff", ...N.frostEye },
  { key: "blackKnight", name: "黒鉄騎士", sprite: "blackKnight", recolor: { base: "knight", swap: { s: "S", S: "m", b: "K", B: "k", a: "M" } }, behavior: "knight", color: "#5a5a6a", blocks: true, rout: true, ...N.blackKnight },
  { key: "lavaGolem", name: "溶岩ゴーレム", sprite: "lavaGolem", recolor: { base: "golem", swap: { z: "o", Z: "O", d: "R", V: "r", v: "R" } }, behavior: "golem", color: "#e88838", ...N.lavaGolem },
  { key: "frostGolem", name: "霜ゴーレム", sprite: "frostGolem", recolor: { base: "golem", swap: { z: "2", Z: "3", d: "4", V: "c", v: "C" } }, behavior: "golem", color: "#8fd0ff", ...N.frostGolem },
  { key: "crystalGolem", name: "結晶ゴーレム", sprite: "crystalGolem", recolor: { base: "golem", swap: { z: "c", Z: "C", d: "B", V: "1", v: "c" } }, behavior: "golem", color: "#60e0f0", ...N.crystalGolem },
  { key: "frostWisp", name: "氷鬼火", sprite: "frostWisp", recolor: { base: "wisp", swap: { c: "2", C: "3" } }, behavior: "wisp", color: "#e0f4ff", phasing: true, ...N.frostWisp },
  { key: "purpleLaser", name: "紫光線眼", sprite: "purpleLaser", recolor: { base: "laserEye", swap: { p: "A", P: "n", r: "p", R: "P" } }, behavior: "laser", color: "#c060e0", ...N.purpleLaser },
  { key: "flyingBook", name: "飛ぶ本", sprite: "flyingBook", recolor: { base: "bat", swap: { P: "W", p: "1", r: "k" } }, behavior: "bat", color: "#e0d8c0", ...N.flyingBook },
  { key: "ashBat", name: "灰蝙蝠", sprite: "ashBat", recolor: { base: "bat", swap: { P: "S", p: "s", r: "o" } }, behavior: "bat", color: "#70707e", ...N.ashBat },
  // ---- 既存 behavior の流用 ----
  { key: "sproutSlime", name: "若苗スライム", sprite: "sproutSlime", recolor: { base: "slime", swap: { g: "V", G: "v" } }, behavior: "chaser", color: "#5b7e48", ...N.sproutSlime },
  { key: "spikeRat", name: "棘鼠", sprite: "rat", behavior: "bat", color: "#70707e", ...N.spikeRat },
  { key: "twinEye", name: "双眼", sprite: "twinEye", recolor: { base: "eye", swap: { p: "y", P: "Y", e: "1" } }, behavior: "shooter", color: "#f8d848", ...N.twinEye },
  { key: "triLaser", name: "三叉光線眼", sprite: "triLaser", recolor: { base: "laserEye", swap: { p: "o", P: "O", r: "y", R: "Y" } }, behavior: "laser", color: "#e88838", ...N.triLaser },
  { key: "shadowBat", name: "影蝙蝠", sprite: "shadowBat", recolor: { base: "bat", swap: { P: "9", p: "A" } }, behavior: "bat", color: "#5a4a8a", phasing: true, ...N.shadowBat },
  { key: "wolf", name: "狼", sprite: "wolf", behavior: "chaser", color: "#a0a0b0", ...N.wolf },
  { key: "multiBomber", name: "連投ゴブリン", sprite: "multiBomber", recolor: { base: "bomber", swap: { g: "o", G: "O", h: "q" } }, behavior: "bomber", color: "#e88838", ...N.multiBomber },
  { key: "spearman", name: "槍兵", sprite: "spearman", recolor: { base: "knight", swap: { b: "o", B: "O", a: "q" } }, behavior: "charger", color: "#e88838", ...N.spearman },
  { key: "hornBeetle", name: "角甲虫", sprite: "beetle", behavior: "charger", color: "#58d058", chargeTrail: "rockfall", ...N.hornBeetle },
  { key: "netter", name: "投網兵", sprite: "netter", recolor: { base: "bomber", swap: { g: "c", G: "C", h: "1" } }, behavior: "shooter", color: "#60e0f0", ...N.netter },
  { key: "carrionFly", name: "腐肉蝿", sprite: "carrionFly", recolor: { base: "bat", swap: { P: "v", p: "J" } }, behavior: "bat", color: "#a0e040", frenzy: { vs: ["bleed", "poison"], speedMul: 1.5 }, ...N.carrionFly },
  { key: "thunderWisp", name: "雷鬼火", sprite: "thunderWisp", recolor: { base: "wisp", swap: { c: "N", C: "y" } }, behavior: "wisp", color: "#fff4a0", phasing: true, deathRally: { kind: "charged", radius: 60, time: 5 }, ...N.thunderWisp },
  { key: "skeleton", name: "骸骨兵", sprite: "skeleton", behavior: "chaser", color: "#e0d8c0", ...N.skeleton },
  // ---- 新しい behavior ----
  { key: "fuseRat", name: "導火鼠", sprite: "fuseRat", recolor: { base: "rat", swap: { S: "O", s: "o", r: "y" } }, behavior: "kamikaze", color: "#e88838", ...N.fuseRat },
  { key: "crystalMite", name: "結晶ダニ", sprite: "mite", behavior: "kamikaze", color: "#60e0f0", ...N.crystalMite },
  { key: "echoStriker", name: "残像打ち", sprite: "hooded", behavior: "echoStriker", color: "#5a4a8a", ...N.echoStriker },
  { key: "packLeader", name: "群れの長", sprite: "packLeader", recolor: { base: "wolf", swap: { S: "W", s: "q" } }, behavior: "packLeader", color: "#7a6a58", pack: { minion: "wolf", count: 3 }, ...N.packLeader },
  { key: "manaLeech", name: "気力喰い", sprite: "leech", behavior: "manaLeech", color: "#3c7ad8", ...N.manaLeech },
  { key: "scavenger", name: "骨拾い", sprite: "ghoul", behavior: "scavenger", color: "#5b7e48", ...N.scavenger },
  { key: "graveBell", name: "墓守の鐘", sprite: "bell", behavior: "graveBell", color: "#f8d848", noCorpse: true, ...N.graveBell },
  { key: "silencer", name: "沈黙の修道士", sprite: "silencer", recolor: { base: "hooded", swap: { "9": "k", A: "n", c: "p" } }, behavior: "silencer", color: "#c060e0", ...N.silencer },
  { key: "frostCrusher", name: "霜砕き", sprite: "frostCrusher", recolor: { base: "golem", swap: { z: "S", Z: "4", d: "k", V: "3", v: "2" } }, behavior: "frostCrusher", color: "#3c6ea8", ...N.frostCrusher },
  { key: "twinShade", name: "双子の影", sprite: "shade", behavior: "twinShade", color: "#5a4a8a", pack: { minion: "twinShade", count: 1 }, ...N.twinShade },
  // ---- 部屋主（通常の抽選に低い重みで混ぜる） ----
  { key: "mimic", name: "喰らう宝箱", sprite: "mimic", behavior: "mimic", color: "#b88a50", lairMaster: true, ...N.mimic },
  { key: "hollowArmor", name: "鎧の中身", sprite: "hollowArmor", behavior: "hollowArmor", color: "#c8c8d0", lairMaster: true, blocks: true, transformTo: { key: "hollowWraith", hpRatio: 0.5 }, ...N.hollowArmor },
  { key: "hollowWraith", name: "鎧の中身・亡霊", sprite: "hollowWraith", recolor: { base: "hooded", swap: { "9": "2", A: "3", c: "r" } }, behavior: "charger", color: "#8fd0ff", lairMaster: true, phasing: true, ...N.hollowWraith },
  { key: "boneConductor", name: "骨の楽団長", sprite: "boneConductor", recolor: { base: "skeleton", swap: { D: "p", E: "P" } }, behavior: "conductor", color: "#c060e0", lairMaster: true, pack: { minion: "skeleton", count: 4 }, ...N.boneConductor },
  // ---- ボスとその付き物（付き物は minDepth 99 で抽選に出さない） ----
  { key: "twinBrother", name: "双子の騎士・兄", sprite: "twinBrother", bossTitle: "双子の騎士", behavior: "twinBlade", color: "#c8c8d0", boss: true, blocks: true, ...N.twinBrother },
  { key: "twinSister", name: "双子の騎士・妹", sprite: "twinSister", behavior: "twinBow", color: "#58d058", noCorpse: true, bossPart: true, ...N.twinSister },
  { key: "frostGiant", name: "霜の巨人", sprite: "frostGiant", behavior: "frostGiant", color: "#8fd0ff", boss: true, ...N.frostGiant },
  { key: "icePillar", name: "氷柱", sprite: "icePillar", behavior: "inert", color: "#8fd0ff", noCorpse: true, ...N.icePillar },
  // ---- 試し場の木人（src/system/specialRooms.ts が置く。動かず殴り返さず、撃破数・報酬に数えない）----
  { key: "trainingDummy", name: "木人", sprite: "trainingDummy", recolor: { base: "icePillar", swap: { "1": "T", "2": "T", "3": "T", "4": "X" } }, behavior: "inert", color: "#c8a070", noCorpse: true, ...N.trainingDummy },
  // ---- 鏡の部屋の写し（src/system/specialRooms.ts が HP・エリート修飾子をプレイヤーの今のビルドから決める）----
  { key: "mirrorSelf", name: "鏡像", sprite: "mirrorSelf", recolor: { base: "player", swap: { b: "p", B: "P", a: "e", t: "3", T: "4", o: "A", O: "9" } }, behavior: "charger", color: "#c0e0ff", noCorpse: true, ...N.mirrorSelf },
];

export const ENEMIES: readonly EnemyDef[] = [
  { key: "slime", name: "スライム", sprite: "slime", behavior: "chaser", color: "#40c040", ...N.slime },
  { key: "eye", name: "浮遊眼", sprite: "eye", behavior: "shooter", color: "#b050d0", ...N.eye },
  { key: "boar", name: "猪", sprite: "boar", behavior: "charger", color: "#e08030", ...N.boar },
  { key: "knight", name: "盾騎士", sprite: "knight", behavior: "knight", color: "#a0a8c0", blocks: true, ...N.knight },
  { key: "bomber", name: "爆弾ゴブリン", sprite: "bomber", behavior: "bomber", color: "#70b040", ...N.bomber },
  { key: "laserEye", name: "光線眼", sprite: "laserEye", behavior: "laser", color: "#ff5050", ...N.laserEye },
  { key: "golem", name: "ゴーレム", sprite: "golem", behavior: "golem", color: "#a8a290", ...N.golem },
  { key: "bat", name: "蝙蝠", sprite: "bat", behavior: "bat", color: "#8060a0", ...N.bat },
  { key: "wisp", name: "鬼火", sprite: "wisp", behavior: "wisp", color: "#60c0ff", phasing: true, ...N.wisp },
  { key: "kingSlime", name: "スライム王", sprite: "kingSlime", behavior: "kingSlime", color: "#40c040", boss: true, ...N.kingSlime },
  { key: "boneLord", name: "骸骨卿", sprite: "boneLord", behavior: "boneLord", color: "#d0c8a8", boss: true, ...N.boneLord },
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
  return 1 + (depth - 1) * ENEMY_SCALE.hpPerDepth;
}

export function depthDamageBonus(depth: number): number {
  return Math.floor((depth - 1) / 2) * 2;
}
