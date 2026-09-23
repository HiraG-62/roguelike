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
  // タイトル/メニュー
  "menuMove",
] as const;

export type SfxName = (typeof SFX_NAMES)[number];
