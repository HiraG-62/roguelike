import type { FrameInput } from "../core/input";
import { EMPTY_INPUT } from "../core/input";
import { createRng, type Rng } from "../core/rng";
import type { Enemy, EnemyPhase, GameState, RoomState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { type Vec, dist, isZero, length, normalize, sub } from "../core/vec";
import type { AttrKey } from "../loot/types";
import { type GameMap, TILE_SIZE, Tile, getTile, inBounds, rectCenterPx, toIndex } from "../map/grid";
import { isSolidTile, overlapsWall } from "../system/physics";
import { BOONS, type BoonKey } from "../system/boons";
import { canAffordSkill } from "../system/keystones";
import { resolveSlot } from "../system/skills";
import { allocateAttribute } from "../ui/attributeAlloc";

/**
 * ヘッドレス自動プレイ用のヒューリスティック bot。
 * 毎ステップ state を見て FrameInput を合成する。ゲーム本体の乱数（state.rng）は
 * 消費せず、bot 専用の RNG だけを使う（決定性・再現性を壊さないため）。
 *
 * 経路探索について: 最初は「目標へ直進し、詰まったらランダム方向」だけの単純な steering
 * だったが、通路が入り組んだフロアでは部屋の入口が直進経路上に無いことが多く、
 * 壁際で堂々巡りして Reaper に狩られる（＝バグではなく bot の限界による偽陽性の死亡）
 * ケースを大量に確認した。そのため探索モードの長距離移動だけは、タイルグリッド上の
 * BFS で実際に通れる経路を求めてから追従する。交戦中の接近など短距離の移動は
 * 直進 + 壁回避の簡易 steering のままにしている。
 */

/** この距離より遠いと近づきながら撃つ */
const SHOOT_RANGE = 40;
/** この距離未満なら近接コンボに専念する */
const MELEE_RANGE = 30;
/** 敵の windup / strike をこの距離以内で検知したら回避を検討する */
const DANGER_RANGE = 55;
/** 「人間らしさ」: 危険を検知しても回避に失敗する確率 */
const DODGE_FAIL_CHANCE = 0.3;
/** この割合以下の HP でハートが見えていれば拾いに行く */
const LOW_HP_RATIO = 0.3;
/** 詰まり判定のチェック間隔（秒） */
const STUCK_CHECK_INTERVAL = 0.4;
/** この間隔で動いた距離がこれ未満なら「壁に引っかかった」とみなす（px） */
const STUCK_DIST_THRESHOLD = 6;
/** 詰まったときにランダム方向へ進む時間（秒） */
const WANDER_DURATION = 0.6;
/** まだロックされていない部屋の idle な敵は狙わない（壁越しの直進で詰まるのを防ぐ） */
const NON_ENGAGEABLE_PHASES: ReadonlySet<EnemyPhase> = new Set(["idle", "spawning"]);
/** 経路のウェイポイントに到達したとみなす距離（px） */
const WAYPOINT_REACH = TILE_SIZE * 0.6;
/** 目標地点がこの距離以上ずれたら経路を引き直す */
const GOAL_CHANGE_THRESHOLD = TILE_SIZE;
/** 祝福 3 択が出てから選ぶまで待つ秒数（提示直後 0.35 秒は inputDelay でどのみち無視されるが、指示通り 0.5 秒待つ） */
const BOON_CHOICE_WAIT = 0.5;
/**
 * スキルの有効射程（docs/COMBAT_DESIGN.md B-4 の各スキル maxRange 目安 110〜140 に、
 * 近接スキル（旋風斬り・突進斬り等）の接近余地を足した目安値）。この距離以内なら
 * スキルの発動を試み、外なら通常攻撃・射撃で近づきながらマナを貯める
 */
const SKILL_ENGAGE_RANGE = 150;
const SKILL_SLOT_COUNT = 4;
const SKILL_PRESSED_KEYS = ["skill1Pressed", "skill2Pressed", "skill3Pressed", "skill4Pressed"] as const;
/**
 * ラン内ステータス振り分け（`allocateAttribute`、src/ui/attributeAlloc.ts）の決定的な優先順位。
 * 「体力 → 筋力 → 技巧 → 精神 → 霊力」の順で 1 点ずつ振り、末尾まで行ったら先頭に戻る（循環）
 */
const ALLOC_PRIORITY: readonly AttrKey[] = ["vit", "str", "dex", "mnd", "spi"];

/** bot が手番をまたいで保持する内部状態 */
export interface BotState {
  rng: Rng;
  depth: number;
  stairsPos: Vec | null;
  /** 追いかけている未クリア部屋の index。クリアされたら選び直す */
  targetRoomIndex: number | null;
  /** BFS で求めた経路（タイル中心の px 座標列） */
  path: Vec[] | null;
  pathIndex: number;
  pathGoal: Vec | null;
  wanderDir: Vec;
  wanderTimer: number;
  stuckTimer: number;
  lastCheckPos: Vec;
  /** ラン内ステータス振り分けで、ALLOC_PRIORITY の何番目を次に選ぶか（循環） */
  allocCursor: number;
}

export function createBotState(seed: number): BotState {
  return {
    rng: createRng(seed >>> 0),
    depth: 0,
    stairsPos: null,
    targetRoomIndex: null,
    path: null,
    pathIndex: 0,
    pathGoal: null,
    wanderDir: { x: 1, y: 0 },
    wanderTimer: 0,
    stuckTimer: 0,
    lastCheckPos: { x: 0, y: 0 },
    allocCursor: 0,
  };
}

/** 呪い付き (cursed) でない最初の候補の index。無ければ 1 枚目 (index 0) */
function pickBoonIndex(options: readonly BoonKey[]): number {
  const index = options.findIndex((key) => !BOONS[key].cursed);
  return index >= 0 ? index : 0;
}

/**
 * 祝福（boon）3 択への入力。src/system/boons.ts の selectedIndex は
 * skill1Pressed→0 枚目 / skill2Pressed→1 枚目 / attackPressed→2 枚目 を選ぶ。
 * 提示直後 0.35 秒は inputDelay でどのみち入力が無視されるが、指示通り
 * `state.boonChoice.timer`（提示からの経過秒。ゲーム本体が管理）が
 * BOON_CHOICE_WAIT（0.5 秒）に達するまでは何も押さずに待つ。
 * 待った後は呪い付き (cursed) でない候補を優先して選ぶ（無ければ 1 枚目）
 */
function boonChoiceInput(state: GameState): FrameInput {
  const input = freshInput();
  const choice = state.boonChoice;
  if (!choice || choice.options.length === 0) return input;
  if (choice.timer < BOON_CHOICE_WAIT) return input;
  const index = pickBoonIndex(choice.options);
  if (index === 0) input.skill1Pressed = true;
  else if (index === 1) input.skill2Pressed = true;
  else input.attackPressed = true;
  return input;
}

/** screenToWorld (src/core/view.ts) の逆変換 */
function worldToScreen(state: GameState, world: Vec): Vec {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: world.x + ox, y: world.y + oy };
}

function tileCenterPx(map: GameMap, index: number): Vec {
  const x = index % map.width;
  const y = Math.floor(index / map.width);
  return { x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE };
}

function findStairsPos(state: GameState): Vec | null {
  const map = state.map;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (getTile(map, x, y) === Tile.StairsDown) return tileCenterPx(map, toIndex(map, x, y));
    }
  }
  return null;
}

/**
 * 部屋の目標地点。矩形の部屋は中心。塊（洞窟）の部屋は所属タイルの重心を使い、
 * 凹形状で重心が塊の外に出た場合は塊内で最も近いタイルに寄せる
 */
function roomTargetPoint(state: GameState, room: RoomState): Vec {
  if (!room.tiles || room.tiles.size === 0) return rectCenterPx(room.rect);
  let sx = 0;
  let sy = 0;
  for (const idx of room.tiles) {
    const p = tileCenterPx(state.map, idx);
    sx += p.x;
    sy += p.y;
  }
  const centroid = { x: sx / room.tiles.size, y: sy / room.tiles.size };
  const tx = Math.floor(centroid.x / TILE_SIZE);
  const ty = Math.floor(centroid.y / TILE_SIZE);
  if (room.tiles.has(toIndex(state.map, tx, ty))) return centroid;
  let best = centroid;
  let bestDist = Infinity;
  for (const idx of room.tiles) {
    const p = tileCenterPx(state.map, idx);
    const d = dist(p, centroid);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/**
 * 現在の目標部屋を選ぶ。まだクリアされていなければ前回と同じ部屋を維持し続ける
 * （毎ティック最寄りを選び直すと、僅差の 2 部屋の間で目標が振動して経路が安定しない）
 */
function chooseTargetRoomIndex(state: GameState, bot: BotState): number | null {
  const current = bot.targetRoomIndex;
  if (current !== null) {
    const room = state.rooms[current];
    if (room && !room.cleared) return current;
  }
  const pos = state.player.body.pos;
  let best = -1;
  let bestDist = Infinity;
  state.rooms.forEach((room, i) => {
    if (room.cleared) return;
    const d = dist(roomTargetPoint(state, room), pos);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  bot.targetRoomIndex = best >= 0 ? best : null;
  return bot.targetRoomIndex;
}

/**
 * 交戦対象にする最寄りの敵。
 * まだ部屋がロックされていない idle / spawning 中の敵は含めない。
 * 含めてしまうと、フロア生成時点で全部屋に散らばった敵まで直線的に狙って
 * 壁に頭を突っ込んだまま止まってしまう（実際にこれで詰まるバグを確認した）
 */
function nearestEngagedEnemy(state: GameState): Enemy | null {
  let best: Enemy | null = null;
  let bestDist = Infinity;
  for (const e of state.enemies) {
    if (e.hp <= 0 || NON_ENGAGEABLE_PHASES.has(e.phase)) continue;
    const d = dist(e.body.pos, state.player.body.pos);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function isThreatening(e: Enemy): boolean {
  return e.phase === "windup" || e.phase === "strike";
}

// ---------------------------------------------------------------------------
// スキル（docs/COMBAT_DESIGN.md B 章）: マナを見て 4 スロットを撃つ
// ---------------------------------------------------------------------------

/**
 * このスロットを今フレーム押せるか。GCD・最低間隔・（マナ型なら）canAffordSkill 相当の
 * 判定・（CD 型なら）チャージ残数を見る。発動中の別スキルやパリィ失敗硬直中も不可
 */
function canCastSlotNow(state: GameState, index: number): boolean {
  const rs = state.skills;
  if (rs.active || rs.parryFailTimer > 0 || rs.stunTimer > 0 || rs.gcd > 0) return false;
  const slot = rs.slots[index];
  if (!slot || slot.intervalLeft > 0) return false;
  const resolved = resolveSlot(state, index);
  if (!resolved) return false;
  if (resolved.def.resource === "mana") return canAffordSkill(state, resolved.cost);
  return slot.chargesLeft > 0;
}

/** 装着中のスロットをスロット順に見て、最初に撃てるものの index（無ければ -1）。決定的な優先順位 */
function chooseSkillSlot(state: GameState): number {
  for (let i = 0; i < SKILL_SLOT_COUNT; i++) {
    if (canCastSlotNow(state, i)) return i;
  }
  return -1;
}

function pressSkillSlot(input: FrameInput, index: number): void {
  const key = SKILL_PRESSED_KEYS[index];
  if (key) input[key] = true;
}

/**
 * ラン内ステータス振り分け（src/ui/attributeAlloc.ts）。振り分け UI は装備画面（Tab）へ移り、
 * 探索中の攻撃・スキルキーを奪わなくなったため、bot は画面操作を模す（キーを押す）のではなく
 * `allocateAttribute` を直接呼んで、未消化の点を ALLOC_PRIORITY の順で即座に消化する
 */
function drainAttributePoints(state: GameState, bot: BotState): void {
  while (state.runAttributes.unspent > 0) {
    const attr = ALLOC_PRIORITY[bot.allocCursor % ALLOC_PRIORITY.length]!;
    bot.allocCursor++;
    allocateAttribute(state, attr);
  }
}

/** target 方向への正規化ベクトル。真上に乗っていれば無入力 */
function moveToward(target: Vec, pos: Vec): Vec {
  const delta = sub(target, pos);
  if (length(delta) < 1) return { x: 0, y: 0 };
  return normalize(delta);
}

/** 前方確認の距離（px）。プレイヤーの移動量より少し長めに取る */
const PROBE_DIST = 10;
/** 望む方向が壁なら、この角度オフセット（度）を順に試して開いている方向を探す */
const PROBE_ANGLE_OFFSETS_DEG = [0, 25, -25, 50, -50, 75, -75, 100, -100, 130, -130, 160, -160, 180];
const DEG_TO_RAD = Math.PI / 180;

/**
 * desired 方向へ少し進んだ先が壁なら、近い角度から順に開いている方向を探して返す。
 * 単純な角度スイープだが、部屋の中や小さな障害物での引っかかりを減らせる
 */
function pickOpenDirection(state: GameState, desired: Vec): Vec {
  if (isZero(desired)) return desired;
  const pos = state.player.body.pos;
  const radius = state.player.body.radius;
  const baseAngle = Math.atan2(desired.y, desired.x);
  for (const offsetDeg of PROBE_ANGLE_OFFSETS_DEG) {
    const a = baseAngle + offsetDeg * DEG_TO_RAD;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const probeX = pos.x + dir.x * PROBE_DIST;
    const probeY = pos.y + dir.y * PROBE_DIST;
    if (!overlapsWall(state, probeX, probeY, radius)) return dir;
  }
  // 全方位塞がっている（起こらないはずだが）: 動かないよりはましなので直進を返す
  return desired;
}

function pickHeartTarget(state: GameState): Vec | null {
  let best: Vec | null = null;
  let bestDist = Infinity;
  const pos = state.player.body.pos;
  for (const pk of state.pickups) {
    if (pk.kind !== "heart") continue;
    const d = dist(pk.pos, pos);
    if (d < bestDist) {
      bestDist = d;
      best = pk.pos;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// タイルグリッド上の BFS 経路探索
// ---------------------------------------------------------------------------

const NEIGHBOR_STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** ロック中のタイルも壁扱いする isSolidTile を使い、実際に歩ける経路だけを辿る */
function findPath(state: GameState, fromPx: Vec, toPx: Vec): Vec[] | null {
  const map = state.map;
  const startX = Math.floor(fromPx.x / TILE_SIZE);
  const startY = Math.floor(fromPx.y / TILE_SIZE);
  const goalX = Math.floor(toPx.x / TILE_SIZE);
  const goalY = Math.floor(toPx.y / TILE_SIZE);
  if (!inBounds(map, startX, startY) || !inBounds(map, goalX, goalY)) return null;

  const startIdx = toIndex(map, startX, startY);
  const goalIdx = toIndex(map, goalX, goalY);
  if (startIdx === goalIdx) return [tileCenterPx(map, goalIdx)];

  const size = map.width * map.height;
  const cameFrom = new Int32Array(size).fill(-1);
  const visited = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIdx;
  visited[startIdx] = 1;
  let found = false;

  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    const cx = cur % map.width;
    const cy = Math.floor(cur / map.width);
    for (const [dx, dy] of NEIGHBOR_STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(map, nx, ny)) continue;
      if (isSolidTile(state, nx, ny)) continue;
      const nIdx = toIndex(map, nx, ny);
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      cameFrom[nIdx] = cur;
      queue[tail++] = nIdx;
    }
  }
  if (!found) return null;

  const pathIdx: number[] = [];
  let cur = goalIdx;
  while (cur !== -1 && cur !== startIdx) {
    pathIdx.push(cur);
    cur = cameFrom[cur]!;
  }
  pathIdx.reverse();
  return pathIdx.map((idx) => tileCenterPx(map, idx));
}

/** 経路が無効（未計算・目標が変わった・辿り終えた）なら引き直す */
function ensurePath(state: GameState, bot: BotState, goal: Vec): void {
  const stale =
    bot.path === null || bot.pathGoal === null || dist(bot.pathGoal, goal) > GOAL_CHANGE_THRESHOLD || bot.pathIndex >= bot.path.length;
  if (!stale) return;
  bot.path = findPath(state, state.player.body.pos, goal);
  bot.pathGoal = { ...goal };
  bot.pathIndex = 0;
}

/** 経路上の次のウェイポイント。到達済みの分は進める */
function currentWaypoint(bot: BotState, pos: Vec): Vec | null {
  const path = bot.path;
  if (!path || path.length === 0) return null;
  while (bot.pathIndex < path.length - 1 && dist(pos, path[bot.pathIndex]!) < WAYPOINT_REACH) {
    bot.pathIndex++;
  }
  return path[bot.pathIndex] ?? null;
}

// ---------------------------------------------------------------------------
// 入力の組み立て
// ---------------------------------------------------------------------------

function freshInput(): FrameInput {
  return { ...EMPTY_INPUT, move: { x: 0, y: 0 } };
}

/** 移動のみ行う入力（ハート回収・詰まり回避の乱数移動などで使う） */
function moveOnlyInput(move: Vec): FrameInput {
  const input = freshInput();
  input.move = move;
  return input;
}

/**
 * target へ向かう移動ベクトルを作る。詰まり検知を共有し、壁に引っかかって
 * 一定時間ほぼ動けていなければランダム方向へ切り替える（交戦中の接近などの短距離移動用）
 */
function steerToward(state: GameState, bot: BotState, target: Vec, dt: number): Vec {
  const pos = state.player.body.pos;
  bot.stuckTimer += dt;
  if (bot.stuckTimer >= STUCK_CHECK_INTERVAL) {
    const moved = dist(pos, bot.lastCheckPos);
    if (moved < STUCK_DIST_THRESHOLD) {
      const angle = bot.rng.next() * Math.PI * 2;
      bot.wanderDir = { x: Math.cos(angle), y: Math.sin(angle) };
      bot.wanderTimer = WANDER_DURATION;
    }
    bot.stuckTimer = 0;
    bot.lastCheckPos = { ...pos };
  }

  if (bot.wanderTimer > 0) {
    bot.wanderTimer -= dt;
    return pickOpenDirection(state, bot.wanderDir);
  }
  return pickOpenDirection(state, moveToward(target, pos));
}

function combatInput(state: GameState, bot: BotState, enemy: Enemy, dt: number): FrameInput {
  const input = freshInput();
  const pos = state.player.body.pos;
  const d = dist(enemy.body.pos, pos);
  input.aimScreen = worldToScreen(state, enemy.body.pos);

  if (isThreatening(enemy) && d < DANGER_RANGE && bot.rng.chance(1 - DODGE_FAIL_CHANCE)) {
    // 危険を検知して離脱: 敵の逆方向へダッシュ
    const away = normalize(sub(pos, enemy.body.pos));
    input.move = away;
    input.dashPressed = true;
    return input;
  }

  input.move = steerToward(state, bot, enemy.body.pos, dt);

  // マナ主体（docs/COMBAT_DESIGN.md B 章）: 射程内でスキルが撃てるならスキルを優先する
  const skillIndex = d <= SKILL_ENGAGE_RANGE ? chooseSkillSlot(state) : -1;
  if (skillIndex >= 0) {
    pressSkillSlot(input, skillIndex);
    return input;
  }

  // スキルが撃てない（マナ不足・GCD・CD 中・未装備）ときは通常攻撃・射撃でマナを貯める
  if (d > SHOOT_RANGE) {
    input.shootHeld = true;
  } else if (d < MELEE_RANGE) {
    input.attackPressed = true;
  } else {
    input.shootHeld = true;
  }
  return input;
}

/** 未クリアの部屋 → 階段の順で、BFS 経路のウェイポイントを辿って進む */
function explorationInput(state: GameState, bot: BotState, dt: number): FrameInput {
  const pos = state.player.body.pos;
  const roomIndex = chooseTargetRoomIndex(state, bot);
  let goal: Vec;
  if (roomIndex !== null) {
    goal = roomTargetPoint(state, state.rooms[roomIndex]!);
  } else {
    if (!bot.stairsPos) bot.stairsPos = findStairsPos(state);
    goal = bot.stairsPos ?? pos;
  }

  ensurePath(state, bot, goal);
  const waypoint = currentWaypoint(bot, pos) ?? goal;
  return moveOnlyInput(steerToward(state, bot, waypoint, dt));
}

/**
 * 1 ステップぶんの FrameInput を作る。
 * 優先順位: 低 HP でハートが見えていれば回収 > 交戦中の最寄りの敵 > 探索（未クリア部屋 → 階段）
 */
export function botInput(state: GameState, bot: BotState, dt: number): FrameInput {
  if (state.status !== "playing") return freshInput();

  // 祝福 3 択の間は他の処理が止まる（core/game.ts の step 参照）ので最優先で処理する
  if (state.boonChoice) return boonChoiceInput(state);

  // 装備の芽（state.pendingBud）は boonChoice と違い core/game.ts の step を止めない
  // （system/loot.ts の chooseBud を呼ぶ副作用が要るだけで、FrameInput とは無関係）ため、
  // ここでは何もしない。芽の選択・出現回数の計測は呼び出し側（qa/simulation.test.ts の
  // runOnce）が state.pendingBud を見て chooseBud(state, 0) を直接呼んでいる

  // ラン内ステータス振り分けも同様に FrameInput 非依存の直接呼び出し（drainAttributePoints 参照）
  drainAttributePoints(state, bot);

  if (bot.depth !== state.depth) {
    bot.depth = state.depth;
    bot.stairsPos = null;
    bot.targetRoomIndex = null;
    bot.path = null;
    bot.pathIndex = 0;
    bot.pathGoal = null;
    bot.wanderTimer = 0;
    bot.stuckTimer = 0;
    bot.lastCheckPos = { ...state.player.body.pos };
  }

  const p = state.player;
  if (p.hp / p.maxHp <= LOW_HP_RATIO) {
    const heart = pickHeartTarget(state);
    if (heart) return moveOnlyInput(steerToward(state, bot, heart, dt));
  }

  const enemy = nearestEngagedEnemy(state);
  if (enemy) return combatInput(state, bot, enemy, dt);

  return explorationInput(state, bot, dt);
}
