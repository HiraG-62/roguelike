import type { FrameInput } from "../core/input";
import { EMPTY_INPUT } from "../core/input";
import { createRng, type Rng } from "../core/rng";
import type { Enemy, EnemyPhase, GameState, RoomState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { type Vec, dist, isZero, length, normalize, sub } from "../core/vec";
import { enemyDef } from "../data/enemies";
import type { AttrKey } from "../loot/types";
import { type GameMap, TILE_SIZE, Tile, getTile, inBounds, rectCenterPx, toIndex } from "../map/grid";
import { lineOfSight } from "../map/pathing";
import { isSolidTile, overlapsWall } from "../system/physics";
import { playerMoveset } from "../system/player";
import { type MovesetDef, isGun } from "../data/weapons";
import { BOONS, type BoonChoice, choiceGrade } from "../system/boons";
import { canAffordSkill } from "../system/keystones";
import { resolveSlot, slotBodyBlocked, slotTogglesForm, type ResolvedSlot } from "../system/skills";
import { isInPickupReach } from "../system/loot";
import { allocateAttribute } from "../ui/attributeAlloc";
import { SKILL } from "../skills/data";
import type { SkillKey } from "../skills/types";
import { statsBulletHas } from "../loot/bullets";

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

/** この距離未満なら近接コンボに専念する（遠ければ近づく。射撃は銃の家系だけ） */
const MELEE_RANGE = 30;
/** 敵の windup / strike をこの距離以内で検知したら回避を検討する */
const DANGER_RANGE = 55;
/** 「人間らしさ」: 危険を検知しても回避に失敗する確率 */
const DODGE_FAIL_CHANCE = 0.3;
/**
 * 敵の攻撃間隔（`EnemyDef.attackInterval`）がこの秒数以下なら「手数が多く近接圏内が危険な敵」と
 * みなす。windup/strike に入っていなくても、この手の敵が DANGER_RANGE 圏内にいるなら
 * PREEMPTIVE_DODGE_CHANCE の確率で距離を取る評価を行う（近接スキルの射程が DANGER_RANGE の
 * 内側にあり、windup/strike のときしか回避しないと詠唱のたびに撃たれ続けてしまうため。
 * QA 2026-09-23: 1 対 1 被弾 6.54→15.26 回/60秒の急増を受けた対応）
 */
const FAST_ATTACKER_INTERVAL = 1.0;
/** windup/strike でない先読み回避を、どの頻度で「そもそも評価するか」（人間の警戒レベルのばらつき相当） */
const PREEMPTIVE_DODGE_CHANCE = 0.5;
/**
 * 自分中心・短射程の近接スキル（`skillEngageRange` で radius ベースの射程を使うもの）。
 * これらを撃つと必ず DANGER_RANGE 圏内で被弾判定を受けるため、詠唱直後は評価を待たず
 * 必ず離脱を試みる（ヒット＆アウェイ）
 */
const MELEE_SKILL_KEYS: ReadonlySet<SkillKey> = new Set(["whirl", "quake", "parry", "lunge"]);
/**
 * 溜めのある武器種・銃の弾（src/data/weapons.ts）: 押しっぱなしのままだと撃たない / 振らないので、
 * この秒数だけ溜めたら離す（大剣は 2 段目、チャージ射撃は 2 段目に届く長さ）
 */
const MELEE_CHARGE_HOLD = 0.85;
const SHOT_CHARGE_HOLD = 0.75;
/**
 * 右クリックの固有技（docs/ideas/weapon-redesign.md 6 章）: strike / throw は射程内でこの秒ごとに右を 1 フレーム押す。
 * parry は敵の予備動作を見て PARRY_HOLD 秒押す。guard / charge / recall は使わない（QA の穴として report に注記）
 */
const ART_PERIOD = 1.0;
const PARRY_HOLD = 0.2;
/** 予備動作を見たとき、回避より受け流しを選ぶ確率（両方の経路を踏ませる） */
const PARRY_CHANCE = 0.5;
/** 投げる技を撃つ距離の上限（px） */
const ART_THROW_RANGE = 160;
/** 1 振りの技の射程に足す接近余地（px） */
const ART_STRIKE_MARGIN = 6;
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
/**
 * 交戦する敵の距離の上限（px）。開放型フロアでは気付いた敵が遠くから追ってくるので、壁の向こうで
 * 引っかかっている遠い追跡者へ直進して詰まらないよう、近い敵だけを相手にする（遠い敵は来るまで探索を続ける）
 */
const ENGAGE_RANGE = 240;
/** 部屋の目標地点にこの距離まで来ても制圧できていなければ、その部屋の残りの敵を探しに行く（px） */
const ROOM_ARRIVE_DIST = TILE_SIZE * 2;
/** 経路のウェイポイントに到達したとみなす距離（px） */
const WAYPOINT_REACH = TILE_SIZE * 0.6;
/** 目標地点がこの距離以上ずれたら経路を引き直す */
const GOAL_CHANGE_THRESHOLD = TILE_SIZE;
/** 祝福 3 択が出てから選ぶまで待つ秒数（提示直後 0.35 秒は inputDelay でどのみち無視されるが、指示通り 0.5 秒待つ） */
const BOON_CHOICE_WAIT = 0.5;
/**
 * スキルの有効射程の既定値（明示的な maxRange/range を持たないスキル用のフォールバック）。
 * この距離以内ならスキルの発動を試み、外なら通常攻撃・射撃で近づきながらマナを貯める
 */
const SKILL_ENGAGE_RANGE = 150;
/**
 * 自分中心の近接スキル（半径のみで maxRange を持たない）の射程に足す接近余地（px）。
 * 発動を判定するこのフレームの時点でまだ半径の外にいても、同フレームの移動でにじり寄れる分の猶予
 */
const MELEE_SKILL_RANGE_MARGIN = 20;
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
  /** 目標地点に着いた部屋（開放型: 以後はその部屋の残りの敵を探しに行く） */
  arrivedRoomIndex: number | null;
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
  /**
   * bot がスキルスロットを押した回数の累計（発動回数/分などの QA 指標用。ラン全体で単調増加）。
   * QA 側で runOnce 終了時に経過時間と合わせて発動頻度を出す想定
   */
  skillCastAttempts: number;
  /** 拾おうとしたドロップ品の id。倉庫が満杯で拾えなかったものを毎フレーム押し続けないため */
  triedDropIds: Set<number>;
  /** 次に固有技（strike / throw）を押せるまでの秒 */
  artTimer: number;
  /** 受け流しの右を押し続ける残り秒 */
  parryTimer: number;
}

export function createBotState(seed: number): BotState {
  return {
    rng: createRng(seed >>> 0),
    depth: 0,
    stairsPos: null,
    targetRoomIndex: null,
    arrivedRoomIndex: null,
    path: null,
    pathIndex: 0,
    pathGoal: null,
    wanderDir: { x: 1, y: 0 },
    wanderTimer: 0,
    stuckTimer: 0,
    lastCheckPos: { x: 0, y: 0 },
    allocCursor: 0,
    skillCastAttempts: 0,
    triedDropIds: new Set(),
    artTimer: 0,
    parryTimer: 0,
  };
}

/** bot が押せる札の数（skill1 / skill2 / attack の 3 つ。bot は呪いを受けないので 4 枚目は出ない） */
const BOT_PICKABLE_CARDS = 3;

/**
 * 呪い付き (cursed) でない候補のうち格が最も高い札の index（同じ格なら前の札）。
 * 呪い付きしか無ければ 1 枚目 (index 0)。格の効き（QA の格の分布・到達深度の差）を見るため高い格を取る
 */
export function pickBoonIndex(choice: Readonly<BoonChoice>): number {
  let best = -1;
  let bestGrade = 0;
  const count = Math.min(choice.options.length, BOT_PICKABLE_CARDS);
  for (let i = 0; i < count; i++) {
    const key = choice.options[i];
    if (key === undefined || BOONS[key].cursed) continue;
    const grade = choiceGrade(choice, i);
    if (grade <= bestGrade) continue;
    best = i;
    bestGrade = grade;
  }
  return best >= 0 ? best : 0;
}

/**
 * 祝福（boon）3 択への入力。src/system/boons.ts の selectedIndex は
 * skill1Pressed→0 枚目 / skill2Pressed→1 枚目 / attackPressed→2 枚目 を選ぶ。
 * 提示直後 0.35 秒は inputDelay でどのみち入力が無視されるが、指示通り
 * `state.boonChoice.timer`（提示からの経過秒。ゲーム本体が管理）が
 * BOON_CHOICE_WAIT（0.5 秒）に達するまでは何も押さずに待つ。
 * 待った後は呪い付き (cursed) でない候補のうち格の最も高い札を選ぶ（無ければ 1 枚目）
 */
function boonChoiceInput(state: GameState): FrameInput {
  const input = freshInput();
  const choice = state.boonChoice;
  if (!choice || choice.options.length === 0) return input;
  if (choice.timer < BOON_CHOICE_WAIT) return input;
  const index = pickBoonIndex(choice);
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
    // 壁の向こうの敵へ直進すると壁に張り付いたまま動けない。見えない敵は回り込んで来るのを待つ
    if (d > ENGAGE_RANGE || !lineOfSight(state.map, state.player.body.pos, e.body.pos)) continue;
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
 * スキルの有効射程。frag/thunder/gravityWell/frostField/chainHook は明示的な maxRange/range を
 * 持つのでそれを使う。lunge は突進距離 + ヒット判定の余白。旋風斬り・地裂き・パリィ・回転弾幕は
 * 自分中心の近接 AoE（半径のみで maxRange を持たない）なので、半径に接近余地を足した短い射程を使う。
 * これが無く一律 SKILL_ENGAGE_RANGE（150px）で判定していたときは、旋風斬り（半径28）等を遠距離から
 * 発動して素通り（空振り）することがあった（QA 2026-09-23 スキル由来与ダメ比率の伸び悩みの一因）。
 * バフ・地雷・撃ち抜きなど距離の意味が薄い／別ロジックで判定するものは既定値のまま
 */
function skillEngageRange(resolved: ResolvedSlot): number {
  const key: SkillKey = resolved.def.key;
  switch (key) {
    case "whirl":
      return SKILL.whirl.radius + MELEE_SKILL_RANGE_MARGIN;
    case "quake":
      return SKILL.quake.radius + MELEE_SKILL_RANGE_MARGIN;
    case "parry":
      return SKILL.parry.radius + MELEE_SKILL_RANGE_MARGIN;
    case "spiral":
      return SKILL.spiral.speed * SKILL.spiral.life;
    case "lunge":
      return SKILL.lunge.distance + SKILL.lunge.hitPad;
    case "chainHook":
      return SKILL.chainHook.range;
    case "frag":
      return SKILL.frag.maxRange;
    case "thunder":
      return SKILL.thunder.maxRange;
    case "gravityWell":
      return SKILL.gravityWell.maxRange;
    case "frostField":
      return SKILL.frostField.maxRange;
    default:
      return SKILL_ENGAGE_RANGE;
  }
}

/**
 * このスロットを今フレーム押せるか。GCD・最低間隔・射程・（マナ型なら）canAffordSkill 相当の
 * 判定・（CD 型なら）チャージ残数を見る。発動中の別スキルやパリィ失敗硬直中も不可
 */
function canCastSlotNow(state: GameState, index: number, distanceToTarget: number): boolean {
  const rs = state.skills;
  // 砲身化・業火の化身の最中に同じ石を押すと自分で解いてしまうので押さない
  if (rs.parryFailTimer > 0 || rs.stunTimer > 0 || slotBodyBlocked(state, index) || slotTogglesForm(state, index)) return false;
  const slot = rs.slots[index];
  if (!slot || slot.intervalLeft > 0) return false;
  const resolved = resolveSlot(state, index);
  if (!resolved) return false;
  if (distanceToTarget > skillEngageRange(resolved)) return false;
  if (resolved.def.resource === "mana") return canAffordSkill(state, resolved.cost);
  return slot.chargesLeft > 0;
}

/** 装着中のスロットをスロット順に見て、最初に撃てるものの index（無ければ -1）。決定的な優先順位 */
function chooseSkillSlot(state: GameState, distanceToTarget: number): number {
  for (let i = 0; i < SKILL_SLOT_COUNT; i++) {
    if (canCastSlotNow(state, i, distanceToTarget)) return i;
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

  // windup/strike は必ず評価する。それ以外のフェーズでも、手数の多い（攻撃間隔が短い）敵が
  // 近くにいるなら PREEMPTIVE_DODGE_CHANCE の確率で「そもそも危険を評価する」（毎フレーム
  // 評価すると近接スキルの射程内では常に離脱してしまい、スキルが全く当たらなくなるため）
  bot.artTimer = Math.max(0, bot.artTimer - dt);
  // 受け流しの途中は右を押したまま敵へ向く（離すと窓が閉じるわけではないが、押し直しで再使用を無駄にしない）
  if (bot.parryTimer > 0) {
    bot.parryTimer -= dt;
    input.shootHeld = true;
    return input;
  }
  if (tryParryInput(state, bot, enemy, d, input)) return input;

  const isFastAttacker = enemyDef(enemy.defKey).attackInterval <= FAST_ATTACKER_INTERVAL;
  const evaluateDanger = isThreatening(enemy) || (isFastAttacker && bot.rng.chance(PREEMPTIVE_DODGE_CHANCE));
  if (evaluateDanger && d < DANGER_RANGE && bot.rng.chance(1 - DODGE_FAIL_CHANCE)) {
    // 危険を検知して離脱: 敵の逆方向へダッシュ
    const away = normalize(sub(pos, enemy.body.pos));
    input.move = away;
    input.dashPressed = true;
    return input;
  }

  input.move = steerToward(state, bot, enemy.body.pos, dt);

  // マナ主体（docs/COMBAT_DESIGN.md B 章）: スキルごとの実際の射程内で撃てるならスキルを優先する
  const skillIndex = chooseSkillSlot(state, d);
  if (skillIndex >= 0) {
    pressSkillSlot(input, skillIndex);
    bot.skillCastAttempts++;
    const resolved = resolveSlot(state, skillIndex);
    if (resolved && MELEE_SKILL_KEYS.has(resolved.def.key)) {
      // ヒット&アウェイ: 自分中心の近接スキルは撃った時点で敵の DANGER_RANGE 圏内にいる。
      // 評価の確率判定を待たず、必ず逆方向へ動いて距離を取る（ダッシュは温存し歩行のみ）
      input.move = normalize(sub(pos, enemy.body.pos));
    }
    return input;
  }

  // スキルが撃てない（マナ不足・GCD・CD 中・未装備）ときは通常攻撃・射撃・固有技でマナを貯める
  const moveset = playerMoveset(state);
  if (pressArtInput(state, bot, moveset, d, input)) return input;
  // 射撃は銃の家系だけ。近接の武器種は近づいて振る（docs/ideas/weapon-redesign.md 0 章）
  if (isGun(moveset)) input.attackHeld = shootHeldFor(state);
  else if (d < MELEE_RANGE) pressAttack(state, input);
  return input;
}

/** 受け流し: 敵の予備動作を危険距離で見たら、確率で回避の代わりに右を押し続ける。押したら true */
function tryParryInput(state: GameState, bot: BotState, enemy: Enemy, d: number, input: FrameInput): boolean {
  const art = playerMoveset(state).art;
  if (art.kind !== "hold" || !art.hold.parry || state.player.art.cooldown > 0) return false;
  if (enemy.phase !== "windup" || d >= DANGER_RANGE || !bot.rng.chance(PARRY_CHANCE)) return false;
  bot.parryTimer = PARRY_HOLD;
  input.shootHeld = true;
  return true;
}

/**
 * 固有技（strike / throw）を射程内で ART_PERIOD 秒ごとに 1 フレームだけ押す。押したら true。
 * 前のフレームも右を押していると「押した瞬間」にならないので、押しっぱなしにはしない
 */
function pressArtInput(state: GameState, bot: BotState, moveset: MovesetDef, d: number, input: FrameInput): boolean {
  if (bot.artTimer > 0 || state.player.art.cooldown > 0 || state.player.secondaryWasHeld) return false;
  const range = artRange(moveset);
  if (range === undefined || d > range) return false;
  bot.artTimer = ART_PERIOD;
  input.shootHeld = true;
  return true;
}

/** bot が使う技の射程。構え・溜め・手元返しは使わない（undefined） */
function artRange(moveset: MovesetDef): number | undefined {
  const art = moveset.art;
  if (art.kind === "throw") return ART_THROW_RANGE;
  if (art.kind === "strike") return art.step.reach + art.step.size / 2 + ART_STRIKE_MARGIN;
  return undefined;
}

/** 近接の入力。溜めのある武器種は MELEE_CHARGE_HOLD 秒まで押しっぱなしにして離す */
function pressAttack(state: GameState, input: FrameInput): void {
  input.attackPressed = true;
  const a = state.player.attack;
  input.attackHeld = !(a.charging && a.chargeTime >= MELEE_CHARGE_HOLD);
}

/** 射撃の押しっぱなし。溜め撃ちの弾は SHOT_CHARGE_HOLD 秒溜めたら 1 フレーム離して撃つ */
function shootHeldFor(state: GameState): boolean {
  if (!statsBulletHas(state.stats, "charge")) return true;
  const p = state.player;
  return !(p.shotCharging && p.shotChargeTime >= SHOT_CHARGE_HOLD);
}

/** 未クリアの部屋 → 階段の順で、BFS 経路のウェイポイントを辿って進む */
function explorationInput(state: GameState, bot: BotState, dt: number): FrameInput {
  const pos = state.player.body.pos;
  const roomIndex = chooseTargetRoomIndex(state, bot);
  let goal: Vec;
  if (roomIndex !== null) {
    goal = roomTargetPoint(state, state.rooms[roomIndex]!);
    if (dist(goal, pos) < ROOM_ARRIVE_DIST) bot.arrivedRoomIndex = roomIndex;
    if (bot.arrivedRoomIndex === roomIndex) goal = nearestRoomEnemy(state, roomIndex) ?? goal;
  } else {
    if (!bot.stairsPos) bot.stairsPos = findStairsPos(state);
    goal = bot.stairsPos ?? pos;
  }

  ensurePath(state, bot, goal);
  const waypoint = currentWaypoint(bot, pos) ?? goal;
  return moveOnlyInput(steerToward(state, bot, waypoint, dt));
}

/** 開放型: 部屋の外へ出ていった（追ってきて引っかかった）その部屋の敵のうち最寄りの位置 */
function nearestRoomEnemy(state: GameState, roomIndex: number): Vec | null {
  let best: Vec | null = null;
  let bestDist = Infinity;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.roomIndex !== roomIndex) continue;
    const d = dist(e.body.pos, state.player.body.pos);
    if (d < bestDist) {
      bestDist = d;
      best = e.body.pos;
    }
  }
  return best;
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
    bot.arrivedRoomIndex = null;
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

  // 砲身化の構え中は動けない。bot は砲撃を狙わず、ダッシュで構えを解いて立ち往生しない
  if (state.skills.shape?.key === "siegeForm") return { ...freshInput(), dashPressed: true };
  const enemy = nearestEngagedEnemy(state);
  if (enemy) return combatInput(state, bot, enemy, dt);

  return withDropPickup(state, bot, explorationInput(state, bot, dt));
}

/** 手の届くドロップ品で最も近いもの（まだ拾おうとしていないもの） */
function reachableDrop(state: GameState, bot: BotState): { id: number; pos: Vec } | null {
  const drops = [...state.floorItems, ...state.skills.floorStones];
  let best: { id: number; pos: Vec } | null = null;
  let bestDist = Infinity;
  for (const d of drops) {
    if (bot.triedDropIds.has(d.id) || !isInPickupReach(state, d.pos)) continue;
    const dd = dist(d.pos, state.player.body.pos);
    if (dd >= bestDist) continue;
    best = d;
    bestDist = dd;
  }
  return best;
}

/**
 * 探索中、手の届く遺物・スキル石にカーソルを合わせてインタラクトする（触れて拾う仕様だった頃と同じく、
 * 寄り道はせず通り道で拾う）。1 つにつき 1 回だけ押す
 */
function withDropPickup(state: GameState, bot: BotState, input: FrameInput): FrameInput {
  const target = reachableDrop(state, bot);
  if (target === null) return input;
  bot.triedDropIds.add(target.id);
  input.aimScreen = worldToScreen(state, target.pos);
  input.interactPressed = true;
  return input;
}
