// 予告の撮影の場面（docs/ideas/ink-telegraph-impl.md 段 0-c）。ゲーム本体からは import しない。
// ?scene=tele&tele=crowd|shapes|solo|idle で、プレイヤーの周りに予備動作・攻撃中の敵を並べる（時間は進めず、描画だけ）。
// 乱戦で黄と赤が線の質で読めるか・7 形の見え方を、章様式の明るさ違い（明るい氷河・暗闇の階）で確かめる
import type { Enemy, GameState } from "../core/state";
import { ENEMY_TEMPO } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { createEnemy } from "../system/enemies";
import { spawnBomb, spawnLanding } from "../system/hazards";

/** 乱戦で使う敵（予告の 7 形 + 無形をひと通り含める） */
const CROWD_KEYS = ["slime", "wolf", "boar", "golem", "windSprite", "crossGolem", "laserEye", "boarDouble", "eye", "shadowBat", "bellImp", "basilisk"] as const;
/** 形の並べ撮り: 左から 線・光線・輪・十字・扇・折れ線・無形 */
const SHAPE_KEYS = ["boar", "laserEye", "golem", "crossGolem", "windSprite", "boarDouble", "eye"] as const;

type Look = "yellowEarly" | "yellowLate" | "red" | "strike" | "idle";

const GOLDEN_ANGLE = 2.399963;
const CROWD_COUNT = 30;
const CROSS_ARM = 56;
const LASER_REACH = 130;
const SHAPE_GAP = 54;
const SHAPE_ROW_GAP = 70;
/** 並べ撮りの怯み値の割合（下絵の欠けを見る） */
const SHAPE_POISE = [0, 0.3, 0.6];

/** aim が無ければ自分（プレイヤー）へ向ける。並べ撮りは線が重ならないよう、真っ直ぐ向かい合う向きを渡す */
function setLook(e: Enemy, look: Look, state: GameState, aim?: { x: number; y: number }): void {
  const player = state.player.body.pos;
  const dx = aim ? aim.x : player.x - e.body.pos.x;
  const dy = aim ? aim.y : player.y - e.body.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  e.strikeDir = { x: dx / len, y: dy / len };
  e.facing = { x: e.strikeDir.x || 1, y: e.strikeDir.y };
  e.hidden = false;
  if (look === "idle") {
    e.phase = "idle";
    return;
  }
  e.phase = look === "strike" ? "strike" : "windup";
  e.windupTotal = 0.7;
  const ratio = look === "yellowEarly" ? 0.92 : look === "yellowLate" ? ENEMY_TEMPO.commitRatio + 0.06 : ENEMY_TEMPO.commitRatio - 0.12;
  e.phaseTimer = look === "strike" ? 0.2 : e.windupTotal * ratio;
  e.windupAt = state.time - 0.3;
  e.committedAt = look === "red" || look === "strike" ? state.time - 0.2 : -1;
  e.hitFlash = 0;
}

/** 形ごとの材料（光線の目標・十字の腕・折れ線の曲がり先） */
function setShapeParts(e: Enemy): void {
  const def = enemyDef(e.defKey);
  if (e.ai && def.behavior === "laser") e.ai.target = { x: e.body.pos.x + e.strikeDir.x * LASER_REACH, y: e.body.pos.y + e.strikeDir.y * LASER_REACH };
  if (e.ai && def.behavior === "crossGolem") {
    const { x, y } = e.body.pos;
    e.ai.points = [
      { x: x + CROSS_ARM, y },
      { x: x - CROSS_ARM, y },
      { x, y: y + CROSS_ARM },
      { x, y: y - CROSS_ARM },
    ];
  }
  if (def.doubleCharge) {
    const d = e.strikeDir;
    const turn = { x: e.body.pos.x + d.x * 60, y: e.body.pos.y + d.y * 60 };
    e.doubleCharge = { turn, end: { x: turn.x - d.y * 60, y: turn.y + d.x * 60 }, leg: 1 };
  }
}

function addEnemy(state: GameState, key: string, x: number, y: number, look: Look, poiseRatio: number, aim?: { x: number; y: number }): void {
  const e = createEnemy(state, enemyDef(key), { x, y }, 0, false);
  e.poise.damage = e.poise.max * poiseRatio;
  setLook(e, look, state, aim);
  setShapeParts(e);
  state.enemies.push(e);
}

/** 乱戦: 自分の周り 30 体。黄 10（浅い・深い）・赤 10・攻撃中 5・待機 5 */
/** idle = 同じ 30 体を待機のまま置く（予告の描画の増分を引き算で測るための比較用） */
function placeCrowd(state: GameState, idle: boolean): void {
  const p = state.player.body.pos;
  const looks: Look[] = ["yellowEarly", "yellowLate", "red", "red", "yellowEarly", "strike", "yellowLate", "red", "idle", "yellowEarly"];
  for (let i = 0; i < CROWD_COUNT; i++) {
    const angle = i * GOLDEN_ANGLE;
    const radius = 36 + (i % 6) * 22 + Math.floor(i / 6) * 4;
    const key = CROWD_KEYS[i % CROWD_KEYS.length] ?? "slime";
    const look = idle ? "idle" : (looks[i % looks.length] ?? "red");
    addEnemy(state, key, p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius * 0.7, look, (i % 4) / 6);
  }
}

/** 並べ撮り: 上の段は黄（怯み値 0 / 3 割 / 6 割の欠け違いの 3 行）、下の段は同じ敵の赤 */
function placeShapes(state: GameState): void {
  const p = state.player.body.pos;
  const left = p.x - ((SHAPE_KEYS.length - 1) * SHAPE_GAP) / 2;
  SHAPE_KEYS.forEach((key, col) => {
    SHAPE_POISE.forEach((ratio, row) => addEnemy(state, key, left + col * SHAPE_GAP, p.y - 118 + row * 30, "yellowEarly", ratio, { x: 0, y: 1 }));
    addEnemy(state, key, left + col * SHAPE_GAP, p.y + SHAPE_ROW_GAP, "red", 0, { x: 0, y: -1 });
  });
}

/** 筆致の確認用: 7 形を 1 つずつ離して置き、黄（上）と赤（下）で並べる。重なりがなく、線の質だけを見られる */
function placeSolo(state: GameState): void {
  const p = state.player.body.pos;
  const right = { x: 1, y: 0 };
  const left = { x: -1, y: 0 };
  const at = (key: string, dx: number, dy: number, look: Look, aim: { x: number; y: number }, poise = 0): void => addEnemy(state, key, p.x + dx, p.y + dy, look, poise, aim);
  at("boar", -225, -105, "yellowEarly", right);
  at("boar", -225, -85, "yellowEarly", right, 0.6);
  at("boar", -225, -55, "red", right);
  at("laserEye", -225, -20, "yellowEarly", right);
  at("laserEye", -225, 10, "red", right);
  at("boarDouble", -225, 60, "yellowEarly", { x: 0, y: -1 });
  at("boarDouble", -165, 110, "red", { x: 0, y: -1 });
  at("golem", -10, -75, "yellowEarly", right);
  at("golem", -10, 85, "red", right);
  at("windSprite", 210, -80, "yellowEarly", left);
  at("windSprite", 210, 80, "red", left);
  at("crossGolem", 80, -10, "yellowLate", right);
  // 地面の物（出た時から墨入れの輪）: 着地の影と爆弾
  spawnLanding(state, { x: p.x + 130, y: p.y + 100 }, 22, 1, undefined, false);
  spawnBomb(state, { x: p.x - 120, y: p.y + 100 }, 5, undefined, 1.2, 28);
}

export function placeTeleScene(state: GameState, kind: string): void {
  state.enemies = [];
  state.hazards = [];
  if (kind === "shapes") placeShapes(state);
  else if (kind === "solo") placeSolo(state);
  else placeCrowd(state, kind === "idle");
  state.camera.pos = { ...state.player.body.pos };
  state.camera.offset = { x: 0, y: 0 };
}
