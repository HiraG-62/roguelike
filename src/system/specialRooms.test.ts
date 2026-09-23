import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState, RoomKind, RoomState } from "../core/state";
import type { Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { ELITE, ROOM_KIND } from "../data/tuning";
import { keystoneDef } from "../loot/affixes";
import { TRAIT_COLORS } from "../loot/types";
import { TILE_SIZE, isWalkable, rectCenterPx } from "../map/grid";
import { BOONS } from "./boons";
import { buildFloor } from "./floor";
import { hasStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { ESCAPE_GRACE, assignExtraRoomKinds, isPropRoom, setupSpecialRoom, startsEmptySpecial } from "./specialRooms";
import { withInput } from "./testHelpers";

const IDLE = withInput({});
const DEPTH = 5;
/** 1 回の遷移に掛けるステップの上限（湧きの予告・波の切り替えを待つ） */
const SETTLE_STEPS = 90;

/** 回廊のフロアの真ん中の部屋を kind にして準備する。ランイベントと長居の代償は止めておく */
function roomOf(kind: RoomKind, seed = 3): { state: GameState; room: RoomState; index: number } {
  const state = createGame(seed);
  state.depth = DEPTH;
  buildFloor(state, "rooms");
  const index = state.rooms.findIndex((r, i) => i > 1 && i < state.rooms.length - 1 && r.rect.w >= 9 && r.rect.h >= 9);
  const room = state.rooms[index];
  if (!room) throw new Error("room missing");
  room.kind = kind;
  room.cleared = false;
  room.locked = false;
  room.wave = 0;
  room.special = undefined;
  state.enemies = state.enemies.filter((e) => e.roomIndex !== index);
  state.floorItems = [];
  setupSpecialRoom(state, room);
  quietEvents(state);
  state.player.invulnTimer = 999;
  return { state, room, index };
}

function quietEvents(state: GameState): void {
  state.runEvents.room = null;
  state.runEvents.floor = null;
  state.runEvents.cooldown = 1e9;
  state.runEvents.timedCheck = 1e9;
  state.runEvents.linger.kind = null;
  state.floorTime = 0;
}

function standAt(state: GameState, pos: Vec): void {
  state.player.body.pos = { ...pos };
  step(state, IDLE, FIXED_DT);
}

function stepOff(state: GameState, room: RoomState): void {
  state.player.body.pos = { x: (room.rect.x + 1.5) * TILE_SIZE, y: (room.rect.y + 1.5) * TILE_SIZE };
  step(state, IDLE, FIXED_DT);
}

function enter(state: GameState, room: RoomState): void {
  state.player.body.pos = rectCenterPx(room.rect);
  for (let i = 0; i < 3 && !room.locked && !room.cleared; i++) step(state, IDLE, FIXED_DT);
}

function aliveIn(state: GameState, index: number): number {
  return state.enemies.filter((e) => e.roomIndex === index && e.hp > 0).length;
}

/** 部屋の敵を倒し続け、制圧されるまで進める（波・死に際の湧きも含む） */
function clearOut(state: GameState, room: RoomState, index: number): void {
  for (let i = 0; i < SETTLE_STEPS && !room.cleared; i++) {
    for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
    step(state, IDLE, FIXED_DT);
  }
}

function pendingEchoTotal(state: GameState): number {
  return TRAIT_COLORS.reduce((s, c) => s + state.runEvents.pendingEchoes[c], 0);
}

describe("追加の部屋種類の割り当て", () => {
  it("1 フロアに ROOM_KIND.extraMax まで、出始める深度より浅い階には出ない", () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const depth of [2, 3, 5, 8]) {
        const state = createGame(seed);
        state.depth = depth;
        buildFloor(state, "rooms");
        const extras = state.rooms.filter((r) => r.kind in ROOM_KIND.extra);
        expect(extras.length, `seed=${seed} depth=${depth}`).toBeLessThanOrEqual(ROOM_KIND.extraMax);
        for (const r of extras) {
          const rule = ROOM_KIND.extra[r.kind as keyof typeof ROOM_KIND.extra];
          expect(depth, `${r.kind} の深度`).toBeGreaterThanOrEqual(rule.minDepth);
        }
        expect(state.rooms[0]?.kind, "開始部屋は通常").toBe("normal");
        expect(state.rooms[state.rooms.length - 1]?.kind, "階段の部屋は通常").toBe("normal");
      }
    }
  });

  it("起点「賭博師」は毎階に賭博の部屋が出る", () => {
    for (let seed = 0; seed < 10; seed++) {
      const state = createGame(seed, String(seed), undefined, undefined, { origin: "gambler", modifiers: [] });
      state.depth = 2;
      buildFloor(state, "rooms");
      expect(state.rooms.some((r) => r.kind === "gamble"), `seed=${seed}`).toBe(true);
    }
  });

  it("同じ seed なら同じ割り当て（決定的）", () => {
    const kinds = (seed: number): string[] => {
      const state = createGame(seed);
      state.depth = 6 + 2;
      buildFloor(state);
      return state.rooms.map((r) => r.kind);
    };
    expect(kinds(12)).toEqual(kinds(12));
  });

  it("台座の部屋は制圧済みで敵がおらず、戦う特別な部屋は最初は無人", () => {
    for (const kind of ["altar", "library", "gamble", "forge", "exchange", "curseShrine", "watchtower", "reaperNest"] as const) {
      const { state, room, index } = roomOf(kind);
      expect(isPropRoom(kind)).toBe(true);
      expect(room.cleared, kind).toBe(true);
      expect(aliveIn(state, index), kind).toBe(0);
    }
    for (const kind of ["arena", "escort", "escape", "mirror"] as const) expect(startsEmptySpecial(kind), kind).toBe(true);
  });

  it("assignExtraRoomKinds は reserved の部屋を変えない", () => {
    const state = createGame(4);
    state.depth = 8;
    buildFloor(state, "rooms");
    for (const r of state.rooms) r.kind = "normal";
    const reserved = new Set(state.rooms.map((_, i) => i));
    assignExtraRoomKinds(state, reserved);
    expect(state.rooms.every((r) => r.kind === "normal")).toBe(true);
  });
});

describe("台座の部屋", () => {
  it("祭壇: 排他グループの重ならない誓約が 3 つ並び、触れるとこのランだけ誓約が付く（他の台座は消える）", () => {
    const { state, room } = roomOf("altar");
    const props = room.special?.props ?? [];
    expect(props.length).toBe(3);
    const groups = props.map((p) => keystoneDef(p.key)?.exclusiveGroup);
    expect(new Set(props.map((p) => p.key)).size).toBe(3);
    expect(groups.every((g) => g !== undefined)).toBe(true);
    const pick = props[0];
    if (!pick) throw new Error("prop missing");
    standAt(state, pick.pos);
    expect(state.runKeystones).toContain(pick.key);
    expect(state.stats.keystones, "stats に誓約が畳み込まれる").toContain(pick.key);
    expect(props.every((p) => p.used)).toBe(true);
    expect(state.sfx).toContain("pedestalUse");
  });

  it("図書館: 刻印符 3 冊から 1 つを所持品へ取り（スキルには付かない）、残りは消える", () => {
    const { state, room } = roomOf("library");
    const props = room.special?.props ?? [];
    expect(props.length).toBeGreaterThan(0);
    expect(new Set(props.map((p) => p.key)).size).toBe(props.length);
    const pick = props[0];
    if (!pick) throw new Error("prop missing");
    standAt(state, pick.pos);
    expect(state.skills.profile.runes?.map((r) => r.modifier), "所持品に入る").toContain(pick.key);
    expect(props.every((p) => p.used), "残りの台座も消える").toBe(true);
  });

  it("賭博: 最大 HP の 1 割を払って回し、一度離れるまで再び回らない。回数を使い切ると消える", () => {
    const { state, room } = roomOf("gamble");
    const lever = room.special?.props[0];
    if (!lever || !room.special) throw new Error("lever missing");
    state.player.hp = state.player.maxHp;
    const cost = state.player.maxHp * ROOM_KIND.gambleHpCost;
    standAt(state, lever.pos);
    expect(room.special.uses).toBe(ROOM_KIND.gambleUses - 1);
    expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp - cost + 1e-6);
    standAt(state, lever.pos);
    expect(room.special.uses, "離れるまでは回らない").toBe(ROOM_KIND.gambleUses - 1);
    for (let i = 1; i < ROOM_KIND.gambleUses; i++) {
      stepOff(state, room);
      state.player.hp = state.player.maxHp;
      standAt(state, lever.pos);
    }
    expect(room.special.uses).toBe(0);
    expect(lever.used).toBe(true);
  });

  it("賭博: HP が払えないと回らない", () => {
    const { state, room } = roomOf("gamble");
    const lever = room.special?.props[0];
    if (!lever || !room.special) throw new Error("lever missing");
    state.player.hp = 1;
    standAt(state, lever.pos);
    expect(room.special.uses).toBe(ROOM_KIND.gambleUses);
  });

  it("鍛冶場: 金床を打つと残響が溜まり（main が保存へ移す）、炉の熱で燃焼が付く", () => {
    const { state, room } = roomOf("forge");
    const anvil = room.special?.props[0];
    if (!anvil) throw new Error("anvil missing");
    standAt(state, anvil.pos);
    expect(pendingEchoTotal(state)).toBe(ROOM_KIND.forgeEchoes);
    expect(hasStatus(state.player.status, "burn")).toBe(true);
    expect(anvil.used).toBe(true);
  });

  it("交換所: 部屋に置かれた遺物が残響に換わって床から消える", () => {
    const { state, room } = roomOf("exchange");
    expect(state.floorItems.length).toBe(ROOM_KIND.exchangeItems);
    const altar = room.special?.props.find((p) => p.kind === "exchange");
    if (!altar) throw new Error("altar missing");
    // 置かれた遺物を拾ってしまわないよう、台座の位置だけに立つ（遺物は横に並んでいる）
    state.player.body.pos = { ...altar.pos };
    const before = state.floorItems.length;
    step(state, IDLE, FIXED_DT);
    expect(state.floorItems.length).toBeLessThan(before);
    expect(pendingEchoTotal(state)).toBeGreaterThan(0);
  });

  it("呪いの祠: 呪い付きの祝福を 1 つ受け、祝福の 3 択が開く", () => {
    const { state, room } = roomOf("curseShrine");
    const shrine = room.special?.props[0];
    if (!shrine) throw new Error("shrine missing");
    standAt(state, shrine.pos);
    expect(state.boons.some((k) => BOONS[k].cursed)).toBe(true);
    expect(state.boonChoice).not.toBeNull();
  });

  it("見張り台: 鐘を鳴らすと階の全ての床が探索済みになり、死神の猶予が縮む", () => {
    const { state, room } = roomOf("watchtower");
    const bell = room.special?.props[0];
    if (!bell) throw new Error("bell missing");
    state.player.body.pos = { ...bell.pos };
    step(state, IDLE, FIXED_DT);
    expect(state.floorTime).toBeGreaterThanOrEqual(ROOM_KIND.watchtowerReaperCost);
    const map = state.map;
    let unexplored = 0;
    for (let i = 0; i < map.tiles.length; i++) {
      if (isWalkable(map, i % map.width, Math.floor(i / map.width)) && !state.explored[i]) unexplored++;
    }
    expect(unexplored).toBe(0);
  });

  it("死神の巣: 箱を開けると深い遺物が出て、死神が来る", () => {
    const { state, room } = roomOf("reaperNest");
    const chest = room.special?.props[0];
    if (!chest) throw new Error("chest missing");
    standAt(state, chest.pos);
    expect(state.reaper).not.toBeNull();
    expect(state.floorItems.some((f) => f.item.itemLevel >= DEPTH + ROOM_KIND.reaperNestDepthBonus)).toBe(true);
  });
});

describe("戦う特別な部屋", () => {
  it("闘技場: 4 波。制圧で rare 以上と祝福の 3 択", () => {
    const { state, room, index } = roomOf("arena");
    enter(state, room);
    expect(room.locked).toBe(true);
    expect(room.wave).toBe(1);
    let maxWave = 1;
    for (let i = 0; i < SETTLE_STEPS * 4 && !room.cleared; i++) {
      for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
      step(state, IDLE, FIXED_DT);
      maxWave = Math.max(maxWave, room.wave);
    }
    expect(maxWave).toBe(ROOM_KIND.arenaWaves);
    expect(room.cleared).toBe(true);
    expect(state.boonChoice).not.toBeNull();
    expect(state.floorItems.some((f) => f.item.rarity === "rare" || f.item.rarity === "unique")).toBe(true);
  });

  it("共鳴炉: 扉の色と共鳴の色が合えば、制圧の報酬が増える", () => {
    const drops = (match: boolean): number => {
      const { state, room, index } = roomOf("resonance");
      const color = room.special?.color;
      if (!color) throw new Error("color missing");
      const other = TRAIT_COLORS.find((c) => c !== color) ?? color;
      state.stats.resonance = { ...state.stats.resonance, kind: "dominant", colors: [match ? color : other] };
      // 共鳴炉は封鎖しないので、入った瞬間に（敵がいなければ）制圧になる。入る前から数える
      const before = state.floorItems.length;
      enter(state, room);
      clearOut(state, room, index);
      return state.floorItems.length - before;
    };
    expect(drops(true) - drops(false)).toBe(ROOM_KIND.resonanceBonusDrops);
  });

  it("護衛: 近くの敵が捕らわれ人を削り、倒れると報酬が出ない。守り抜けば回復と遺物", () => {
    const fail = roomOf("escort");
    enter(fail.state, fail.room);
    expect(fail.room.locked).toBe(true);
    const special = fail.room.special;
    const captive = special?.props.find((p) => p.kind === "captive");
    if (!special || !captive) throw new Error("captive missing");
    const hp = special.hp;
    for (const e of fail.state.enemies) if (e.roomIndex === fail.index) e.body.pos = { ...captive.pos };
    for (let i = 0; i < 10; i++) {
      for (const e of fail.state.enemies) if (e.roomIndex === fail.index) e.body.pos = { ...captive.pos };
      step(fail.state, IDLE, FIXED_DT);
    }
    expect(special.hp).toBeLessThan(hp);
    special.hp = 0.001;
    for (const e of fail.state.enemies) if (e.roomIndex === fail.index) e.body.pos = { ...captive.pos };
    step(fail.state, IDLE, FIXED_DT);
    expect(special.failed).toBe(true);

    const ok = roomOf("escort");
    enter(ok.state, ok.room);
    ok.state.player.hp = 1;
    const items = ok.state.floorItems.length;
    clearOut(ok.state, ok.room, ok.index);
    expect(ok.room.special?.failed).toBe(false);
    expect(ok.state.player.hp).toBeGreaterThan(1);
    expect(ok.state.floorItems.length).toBeGreaterThan(items);
  });

  it("逃走: 入ると封鎖されず、奥に宝箱が出て、入口から床が溶岩になっていく", () => {
    const { state, room } = roomOf("escape");
    const entry = { x: (room.rect.x + 1.5) * TILE_SIZE, y: (room.rect.y + room.rect.h / 2) * TILE_SIZE };
    state.player.body.pos = { ...rectCenterPx(room.rect) };
    step(state, IDLE, FIXED_DT);
    expect(room.locked).toBe(false);
    expect(room.cleared).toBe(true);
    const special = room.special;
    const chest = special?.props.find((p) => p.kind === "chest");
    if (!special?.origin || !chest) throw new Error("escape not started");
    const origin = special.origin;
    expect(Math.hypot(chest.pos.x - origin.x, chest.pos.y - origin.y)).toBeGreaterThan(TILE_SIZE);
    expect(state.sfx).toContain("runEventWarn");
    // 宝箱を踏まない場所で待つ
    state.player.body.pos = { ...entry };
    const steps = Math.ceil((ESCAPE_GRACE + ROOM_KIND.escapeTickInterval * 2) / FIXED_DT);
    for (let i = 0; i < steps; i++) step(state, IDLE, FIXED_DT);
    expect(terrainAt(state, origin.x, origin.y)).toBe("lava");
    state.player.invulnTimer = 999;
    standAt(state, chest.pos);
    expect(chest.used).toBe(true);
  });

  it("巣: 封鎖で HP を増やしたエリートの主が湧く", () => {
    const { state, room, index } = roomOf("nest");
    enter(state, room);
    const lair = state.enemies.filter((e) => e.roomIndex === index && e.elite !== undefined);
    expect(lair.length).toBeGreaterThan(0);
    const strongest = Math.max(...state.enemies.filter((e) => e.roomIndex === index).map((e) => e.maxHp));
    expect(strongest).toBeGreaterThan(enemyDef("slime").hp * ROOM_KIND.nestHpMul);
  });

  it("鏡: 自分の最大 HP を写した鏡像が 1 体だけ湧き、倒すと祝福の 3 択", () => {
    const { state, room, index } = roomOf("mirror");
    enter(state, room);
    const inRoom = state.enemies.filter((e) => e.roomIndex === index);
    expect(inRoom.length).toBe(1);
    const mirror = inRoom[0];
    if (!mirror) throw new Error("mirror missing");
    expect(mirror.defKey).toBe("mirrorSelf");
    const base = Math.round(state.player.maxHp * ROOM_KIND.mirrorHpMul);
    expect(mirror.maxHp).toBe(mirror.elite ? Math.round(base * ELITE.hpMul) + (mirror.shieldMax ?? 0) : base);
    clearOut(state, room, index);
    expect(state.boonChoice).not.toBeNull();
  });
});
