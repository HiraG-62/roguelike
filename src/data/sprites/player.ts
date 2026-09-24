/**
 * プレイヤーの体（24x24、docs/ideas/graphics-style.md）。剣は描き込まず、手に持つ武器は
 * src/data/sprites/weapons.ts の `weapon.<武器種>` を描画側が手の位置に重ねる（docs/ideas/combat-feel-design.md C-1）。
 * 前の腕は武器の拳が担うので、体には肩口の袖までを描く。
 * 原画は歩き A / B・構え（予備動作）・振り抜き（攻撃）の 4 枚。歩きは walkCycle で 4 フレーム、
 * 構えと振り抜きは `player.windup` / `player.strike` の 1 フレーム
 */
import type { SpriteFrames } from "../sprites";
import { type Frame, poseKey, walkCycle } from "./frameKit";

export const PLAYER_KEY = "player";

const PLAYER_WALK_A: Frame = [
  "........................",
  "........................",
  "........................",
  ".........kkkkkk.........",
  ".......kkyyyoookk.......",
  "......kyyyoooooOOk......",
  "......kyooooooooOk......",
  "......kooOoooOoOOk......",
  "......koOOtttttttk......",
  "......kOOTttt1ktTk......",
  "......kOOtttttttTk......",
  ".......kOkTttttTk.......",
  "....rrrkkrrrrrrRk.......",
  "...rRRkaabbbbbbBk.......",
  "...R..kabbbbbbBBBk......",
  "......kabbbbbbBBBk......",
  "......kTTTTyTTTTk.......",
  "......kbbbbbbBBBk.......",
  "......kSSKkkkSSKk.......",
  ".....kSSKk...kSSKk......",
  ".....kSKk.....kSKk......",
  "....kWWwk.....kWWwk.....",
  "...kwwwwk.....kwwwwk....",
  "...kkkkkk.....kkkkkk....",
];
const PLAYER_WALK_B: Frame = [
  "........................",
  "........................",
  "........................",
  ".........kkkkkk.........",
  ".......kkyyyoookk.......",
  "......kyyyoooooOOk......",
  "......kyooooooooOk......",
  "......kooOoooOoOOk......",
  "......koOOtttttttk......",
  "......kOOTttt1ktTk......",
  "......kOOtttttttTk......",
  ".......kOkTttttTk.......",
  ".....rrkkrrrrrrRk.......",
  "..rrRRkaabbbbbbBk.......",
  "..R...kabbbbbbBBBk......",
  "......kabbbbbbBBBk......",
  "......kTTTTyTTTTk.......",
  "......kbbbbbbBBBk.......",
  ".......kSSKkSSKk........",
  ".......kSSKkSKk.........",
  "........kSKkSKk.........",
  "........kWWkWWwk........",
  ".......kwwwkwwwwk.......",
  ".......kkkkkkkkkk.......",
];
/** 構え: 腰を落とし、上体を後ろへ引く（足を大きく開いて踏ん張る） */
const PLAYER_WINDUP: Frame = [
  "........................",
  "........................",
  "........................",
  "........................",
  "........kkkkkk..........",
  "......kkyyyoookk........",
  ".....kyyyoooooOOk.......",
  ".....kyooooooooOk.......",
  ".....kooOoooOoOOk.......",
  ".....koOOtttttttk.......",
  ".....kOOTtttkktTk.......",
  ".....kOOtttttttTk.......",
  "......kOkTttttTk........",
  "..rrrrkkrrrrrrRk........",
  ".rRR.kaabbbbbbBk........",
  ".R...kabbbbbbBBBk.......",
  ".....kabbbbbbBBBk.......",
  ".....kTTTTyTTTTk........",
  "....kbbbbbbbBBBBk.......",
  "...kSSKk....kSSKk.......",
  "..kSSKk......kSSKk......",
  "..kSKk........kSKk......",
  ".kWWwk........kWWwk.....",
  ".kkkkk........kkkkkk....",
];
/** 振り抜き: 前の足で踏み込み、上体が前へ出る */
const PLAYER_STRIKE: Frame = [
  "........................",
  "........................",
  "........................",
  "..........kkkkkk........",
  "........kkyyyoookk......",
  ".......kyyyoooooOOk.....",
  ".......kyooooooooOk.....",
  ".......kooOoooOoOOk.....",
  ".......koOOtttttttk.....",
  ".......kOOTttt1ktTk.....",
  ".......kOOtttttttTk.....",
  "........kOkTttttTk......",
  "rrrrrrkkkrrrrrrRk.......",
  "RR...RkaabbbbbbBk.......",
  ".......kabbbbbbBBBk.....",
  ".......kabbbbbbBBBk.....",
  ".......kTTTTyTTTTk......",
  "......kbbbbbbBBBk.......",
  ".....kSSKk..kSSKk.......",
  "....kSSKk....kSSKk......",
  "...kSKk.......kSSKk.....",
  "..kWWk.........kWWwk....",
  "..kwwk.........kwwwwk...",
  "..kkkk.........kkkkkk...",
];

export const PLAYER_SPRITES: Record<string, SpriteFrames> = {
  [PLAYER_KEY]: walkCycle(PLAYER_WALK_A, PLAYER_WALK_B),
  [poseKey(PLAYER_KEY, "windup")]: [PLAYER_WINDUP],
  [poseKey(PLAYER_KEY, "strike")]: [PLAYER_STRIKE],
};
