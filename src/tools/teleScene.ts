// 予告の撮影の場面（docs/ideas/ink-telegraph-impl.md 段 0-c）。ゲーム本体からは import しない。
// ?scene=tele&tele=crowd|shapes|solo|idle で、プレイヤーの周りに予備動作・攻撃中の敵を並べる（時間は進めず、描画だけ）。
// 乱戦で黄と赤が線の質で読めるか・7 形の見え方を、章様式の明るさ違い（明るい氷河・暗闇の階）で確かめる
import { step } from "../core/game";
import { EMPTY_INPUT } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Jin } from "../core/state";
import type { Vec } from "../core/vec";
import { Tile } from "../map/grid";
import { invalidatePathing } from "../map/pathing";
import { KS_JUMP } from "../system/bossKingSlime";
import { makeHonjin } from "../system/jinzu";
import { markWindupStart } from "../system/readTiming";
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
/** 鶴翼の本陣の撮影: 大将から的（プレイヤー）までと、陣図を書かせる上限秒 */
const JINZU_REACH = 150;
const JINZU_MAX_SEC = 12;
const JINZU_ROOM = 1;
/** スライム王の撮影: 滞空の高さに入るまでの残り秒と、着地の影の半径・残り秒 */
const KING_HOVER_TIMER = 1.4;
const KING_WINDUP_TOTAL = 2;
const KING_LANDING_RADIUS = 30;
const KING_LANDING_TIME = 0.8;
const CROWN_OFFSET = 70;

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

function jinMember(state: GameState, jin: Jin, key: string, at: Vec): Enemy {
  const e = createEnemy(state, enemyDef(key), at, 0, false);
  e.roomIndex = jin.roomIndex;
  e.jinId = jin.id;
  e.phase = "chase";
  e.attackCooldown = 99;
  state.enemies.push(e);
  return e;
}

/** 鶴翼の本陣が陣図を書いている途中: 本物の step を進め、墨の入った画と下絵の画が同時に見える所で止める（jinzu.test.ts の広場と同じ並べ方） */
function placeJinzu(state: GameState): void {
  state.map.tiles.fill(Tile.Floor);
  invalidatePathing(state.map);
  const pl = { x: Math.floor(state.map.width / 2) * 16, y: Math.floor(state.map.height / 2) * 16 };
  state.player.body.pos = { ...pl };
  state.player.invulnTimer = 999;
  state.player.maxHp = 9999;
  state.player.hp = 9999;
  state.jins = [];
  const room = state.rooms[JINZU_ROOM];
  if (room) {
    room.locked = false;
    room.engaged = false;
    room.cleared = false;
  }
  const L = { x: pl.x - JINZU_REACH, y: pl.y };
  const jin: Jin = {
    id: 1,
    roomIndex: JINZU_ROOM,
    formation: "craneWing",
    center: { x: L.x + 20, y: L.y },
    facing: { x: 1, y: 0 },
    leaderId: null,
    hpMul: 1,
    morale: 0,
    moraleMax: 0,
    phase: "engaged",
    engagedAt: state.time - 10,
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
  };
  state.jins.push(jin);
  jinMember(state, jin, "eye", L);
  jinMember(state, jin, "eye", { x: L.x + 8, y: L.y + 14 });
  jinMember(state, jin, "eye", { x: L.x + 8, y: L.y - 14 });
  for (const side of [1, -1]) {
    for (const [du, dv] of [[60, 62], [60, 42], [40, 22]] as const) jinMember(state, jin, "slime", { x: L.x + du, y: L.y + side * dv });
  }
  if (!makeHonjin(state, jin)) return;
  const jz = jin.jinzu;
  const ready = (): boolean => (jz?.strokes.some((st) => st.state === "ink") ?? false) && (jz?.strokes.some((st) => st.state === "sketch") ?? false);
  for (let i = 0; i < Math.ceil(JINZU_MAX_SEC / FIXED_DT) && !ready(); i++) step(state, EMPTY_INPUT, FIXED_DT);
}

/** スライム王の跳躍の滞空（予告は黄）。王は影の上に浮き、足元に着地の影、脇に冠スライム */
function placeSlime(state: GameState): void {
  const p = state.player.body.pos;
  const king = createEnemy(state, enemyDef("kingSlime"), { x: p.x, y: p.y - 40 }, 0, false);
  king.hidden = false;
  king.phase = "windup";
  markWindupStart(state, king);
  king.windupTotal = KING_WINDUP_TOTAL;
  king.phaseTimer = KING_HOVER_TIMER;
  king.windupAt = state.time - 1;
  if (king.ai) king.ai.move = KS_JUMP;
  state.enemies.push(king);
  const crown = createEnemy(state, enemyDef("crownSlime"), { x: p.x + CROWN_OFFSET, y: p.y - 40 }, 0, false);
  crown.hidden = false;
  state.enemies.push(crown);
  spawnLanding(state, { x: p.x, y: p.y + 20 }, KING_LANDING_RADIUS, KING_LANDING_TIME, king.id, false);
}

export function placeTeleScene(state: GameState, kind: string): void {
  state.enemies = [];
  state.hazards = [];
  if (kind === "jinzu") placeJinzu(state);
  else if (kind === "slime") placeSlime(state);
  else if (kind === "shapes") placeShapes(state);
  else if (kind === "solo") placeSolo(state);
  else placeCrowd(state, kind === "idle");
  state.camera.pos = { ...state.player.body.pos };
  state.camera.offset = { x: 0, y: 0 };
}
