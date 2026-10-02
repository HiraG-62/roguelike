/**
 * 効果音の名前。ゲームロジックは state.sfx にこの名前を push するだけで、
 * 実際の再生は main.ts が audio/sfx.ts を通して行う（ロジックと音を分離）。
 */
import type { Element } from "../core/element";
import { WEAPON_HIT_NAMES } from "./weaponHitNames";

export const SFX_NAMES = [
  "slash1",
  "slash2",
  "slash3",
  "hit",
  "hitHeavy",
  "kill",
  "shoot",
  "bulletHit",
  "dash",
  "just",
  "hurt",
  "death",
  "burst",
  "roomLock",
  "roomClear",
  "pickup",
  "lootDrop",
  "lootRare",
  "descend",
  "levelStart",
  "uiOpen",
  "uiClose",
  "uiClick",
  "enemyWindup",
  "enemyShoot",
  "wallHit",
  "burn",
  "shock",
  "freeze",
  "explode",
  "heal",
  // スキル（docs/ideas/skills.md）
  "skillCast",
  "skillReady",
  "parry",
  "railshot",
  "runeAttach",
  /** スキルの連携が成立した（docs/ideas/skills-expansion.md 4 章） */
  "synergy",
  /** マナ不足の不発（docs/COMBAT_DESIGN.md B-2） */
  "manaEmpty",
  // アクション手触り（docs/ideas/action-feel.md）
  "counter",
  "reflect",
  "lastKill",
  // ボス演出
  "bossAppear",
  "bossDefeat",
  "bossPhaseChange",
  // 祝福（boons）
  "boonOffer",
  "boonSelect",
  "boonSelectCursed",
  // エリート・ガード
  "guardBreak",
  "eliteKill",
  // Reaper（追跡者）
  "reaperWarnPulse",
  "reaperAppear",
  // 部屋の種類
  "treasureOpen",
  "waveStart",
  "fountainHeal",
  "ambush",
  // ラン構造（台座・ランイベントの予告と開始・長居の代償の予告）
  "pedestalUse",
  "runEventWarn",
  "runEventStart",
  "lingerWarn",
  // 敵の攻撃演出
  "bombFuse",
  "laserCharge",
  "laserFire",
  "shockwave",
  // クラフト
  "craftReforge",
  "craftAugment",
  "craftAnnul",
  "craftCorrupt",
  "craftFuse",
  // 装備・分解
  "equipOn",
  "equipOff",
  "dismantle",
  // Wave 3 の敵（油の撒き・風・鎖。docs/ideas/enemies.md）
  "oilSplash",
  "windGust",
  "chainThrow",
  // タイトル/メニュー
  "menuMove",
  /** 溜め攻撃・チャージ射撃の段が上がった（src/data/weapons.ts） */
  "chargeLevel",
  /** 属性の弱点 / 耐性に当たった（docs/COMBAT_DESIGN.md A-8） */
  "weakHit",
  "resistHit",
  // ---- 武器種ごとの振り音（docs/ideas/meta-and-weapons.md 8-1。段の slash1〜3 に重ねる）----
  "swingSword",
  "swingGreatsword",
  "swingTwinBlades",
  "swingSpear",
  "swingScythe",
  "swingFists",
  "swingWhip",
  "swingCleaver",
  "swingStaff",
  "swingWand",
  "swingKatana",
  "swingAxe",
  "swingShield",
  "swingChainSickle",
  "swingHammer",
  "swingGunner",
  // 銃の家系のダッシュ攻撃・固有技の振り音（docs/ideas/weapon-redesign.md 4 章）
  "swingSidearm",
  "swingLongarm",
  "swingCannon",
  "swingThrown",
  "swingGrenade",
  "swingTrapper",
  "swingWarRing",
  // ---- 銃の弾ごとの発射音（8-2。単発は shoot のまま）----
  "shotRapid",
  "shotSpread",
  "shotPierce",
  "shotHoming",
  "shotRicochet",
  "shotCharge",
  "shotMine",
  "shotBurst",
  "shotBoomerang",
  "shotLob",
  // ---- 属性の命中音（無属性は hit / bulletHit のまま）----
  "hitFire",
  "hitIce",
  "hitLightning",
  "hitPoison",
  "hitDark",
  "hitLight",
  // ---- 状態異常の付与音（8-3）と怯みの成立（8-6）----
  "statusPoison",
  "statusBleed",
  "statusParalyze",
  "statusFear",
  "statusCurse",
  "statusWet",
  "statusBuff",
  "stagger",
  "bossDown",
  // ---- 変身 第 3 弾（skills/forms.ts）----
  /** 変身した瞬間 / 狼化の遠吠え / 砲身化の砲撃 */
  "formShift",
  "wolfHowl",
  "siegeCannon",
  // ---- 響きの色ごとのドロップ音（8-5）----
  "dropCrimson",
  "dropAzure",
  "dropJade",
  "dropGold",
  "dropUmbra",
  // ---- 演出に合わせた音 ----
  "crit",
  "comboMilestone",
  "hordeSeal",
  "execute",
  // ---- 地形の層「泥」と精鋭「強欲の」（system/terrain.ts・system/elites.ts）----
  "mudHarden",
  "greedySnatch",
  // ---- 演出と音の第 3 弾（docs/ideas/meta-and-weapons.md 8-4 / 8-7〜8-10 / 8-14）----
  /** 反応の成立（8-4）。反応の系統ごとに音程と質感を変える */
  "reactionSteam",
  "reactionShatter",
  "reactionBlaze",
  "reactionSpark",
  "reactionBlight",
  "reactionSurge",
  /** 溜めの段（8-7）。段が上がるほど高い */
  "chargeStep1",
  "chargeStep2",
  "chargeStep3",
  /** 気力が満タンになった瞬間（8-8） */
  "manaFull",
  /** 芽が出た（8-9）/ 銘が刻まれた */
  "budSprout",
  "inscribe",
  /** 依頼の達成（8-10） */
  "questComplete",
  /** 死神の接近の鼓動（8-14） */
  "reaperHeartbeat",
  // ---- 崩れる床が抜ける / 盗賊の煙玉（system/terrain.ts・bossThiefKing.ts・runEvents.ts）----
  "rubbleFall",
  "smokeBomb",
  // ---- コンボの可視化と爽快感パッケージ（docs/ideas/combat-feel-design.md D-1 / D-5）----
  /** コンボ派生が成立した瞬間 */
  "branch",
  /** 武器種の最終段・フィニッシュ派生の命中 */
  "finisherHit",
  /** 近接命中の低域のドン（hit と一緒に積む） */
  "hitThump",
  /** 墨入れの間に振り始めた近接の命中（出端でない普通の命中。低く鈍い木の打音。1 振りに 1 回） */
  "hitCommitted",
  /** 下絵の予告を怯みで崩した: 紙を擦る短い音（線が擦れて散る絵と同時） */
  "sketchErase",
  /** 柝頭: 自分に掛かる攻撃が墨入れに入った合図。高く乾いた木の小さな 1 打（左右に振る。audio/narimono.ts） */
  "commitClack",
  /** 附打: 受け流しの成功。板を打つ低く強い 1 打（読みが当たった合図。音の家は柝頭と別） */
  "tsukeHeavy",
  // ---- 本陣の陣図（docs/ideas/jinzu-impl.md。system/jinzu.ts）----
  /** 軍配を掲げた: 太鼓 1 打と低い法螺 */
  "jinzuRaise",
  /** 陣図の画が 1 本出た: 筆の擦れ */
  "jinzuStroke",
  /** 画に墨が入った: 柝のような短い打音 */
  "jinzuInk",
  /** 筆が折れた: 竹が割れる音 */
  "jinzuBreak",
  /** 総掛かり: 鬨の声 */
  "jinzuCharge",
  /** 旗倒れ: 布の倒れる音と太鼓の乱れ打ち */
  "flagFall",
  // ---- 命中音の系統（刃・打撃・刺突・鞭打）× 重さ（docs/recipes/audio.md）。武器種ごとの impact が選ぶ ----
  "hitSlashLight",
  "hitSlashMid",
  "hitSlashHeavy",
  "hitBluntLight",
  "hitBluntMid",
  "hitBluntHeavy",
  "hitPierceLight",
  "hitPierceMid",
  "hitPierceHeavy",
  /** 鞭打（鞭の命中）の軽・中・重 */
  "hitLashLight",
  "hitLashMid",
  "hitLashHeavy",
  /** 弾の命中（砲・溜め弾・擲弾の直撃） */
  "bulletHitHeavy",
  // ---- スキルの属性ごとの発動音（skillCast に重ねる。system/skills.ts が castSfxName で選ぶ）----
  "castFire",
  "castIce",
  "castLightning",
  "castPoison",
  "castDark",
  "castLight",
  // ---- 隠し部屋（system/hiddenRoom.ts）----
  /** ひび割れた壁に近づいたときの一度きりの手がかり */
  "hiddenHint",
  /** 押し当てて隠し部屋が開いた */
  "hiddenOpen",
  // ---- 銭・瓶・商人・賭け・壺と木箱（docs/ideas/economy-impl.md 4 章 6e）----
  "coinPickup",
  "coinSpill",
  "flaskDrink",
  "merchantProvoked",
  "betWin",
  "betLose",
  "containerBreak",
  // 武器種ごとの近接命中音 hitW_<武器種>_<重さ>（audio/weaponHitNames.ts が生成、層は audio/weaponHits.ts）
  ...WEAPON_HIT_NAMES,
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/** スキルの属性ごとの発動音。無属性は共通の skillCast だけ（重ねる音なし） */
const CAST_SFX: Readonly<Record<Element, SfxName | null>> = {
  none: null,
  fire: "castFire",
  ice: "castIce",
  lightning: "castLightning",
  poison: "castPoison",
  dark: "castDark",
  light: "castLight",
};

export function castSfxName(element: Element): SfxName | null {
  return CAST_SFX[element];
}
