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
] as const;

export type SfxName = (typeof SFX_NAMES)[number];
