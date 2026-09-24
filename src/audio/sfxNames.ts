/**
 * 効果音の名前。ゲームロジックは state.sfx にこの名前を push するだけで、
 * 実際の再生は main.ts が audio/sfx.ts を通して行う（ロジックと音を分離）。
 */
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
  // ---- 射撃の型ごとの発射音（8-2。単発は shoot のまま）----
  "shotRapid",
  "shotSpread",
  "shotPierce",
  "shotHoming",
  "shotRicochet",
  "shotCharge",
  "shotMine",
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
] as const;

export type SfxName = (typeof SFX_NAMES)[number];
