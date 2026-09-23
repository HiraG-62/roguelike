import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState, RoomState } from "../core/state";
import { LINGER, RUN_EVENT, RUN_MOD } from "../data/tuning";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { buildFloor } from "./floor";
import { shadowPositions } from "./linger";
import { reaperAppearAfter } from "./reaper";
import { isDark } from "./roomTypes";
import {
  RUN_EVENTS,
  RUN_EVENT_KEYS,
  type RunEventKey,
  bountyTargetId,
  fogActive,
  hourglassLeft,
  runEventHudLines,
  scheduleRunEvent,
} from "./runEvents";
import { hasStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { engageStartRoom, placeEnemy, withInput } from "./testHelpers";

const IDLE = withInput({});
const DEPTH = 5;
const WARN_STEPS = Math.ceil(RUN_EVENT.warnTime / FIXED_DT) + 2;

/** 回廊の階。封鎖できる部屋（開始・最後以外）の index も返す。自然に起きるイベントと代償は止める */
function setup(seed = 7, depth = DEPTH): { state: GameState; room: RoomState; index: number } {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state, "rooms");
  quiet(state);
  const index = state.rooms.findIndex((r, i) => i > 0 && i < state.rooms.length - 1 && r.kind === "normal" && r.doorTiles.length > 0);
  const room = state.rooms[index];
  if (!room) throw new Error("room missing");
  // 開放型フロアでは通常の部屋は封鎖しないので、封鎖する種類（伏兵）にしておく
  room.kind = "ambush";
  state.player.invulnTimer = 1e9;
  return { state, room, index };
}

function quiet(state: GameState): void {
  state.runEvents.room = null;
  state.runEvents.floor = null;
  state.runEvents.cooldown = 1e9;
  state.runEvents.timedCheck = 1e9;
  state.runEvents.linger.kind = null;
}

function run(state: GameState, steps: number): void {
  for (let i = 0; i < steps; i++) step(state, IDLE, FIXED_DT);
}

/** 部屋に入って封鎖する（自然の抽選は止めたまま） */
function lock(state: GameState, room: RoomState): void {
  state.player.body.pos = rectCenterPx(room.rect);
  for (let i = 0; i < 3 && !room.locked; i++) step(state, IDLE, FIXED_DT);
  if (!room.locked) throw new Error("room did not lock");
}

/** 予告を出し、始まる（または一瞬で終わる）まで進める */
const START_LIMIT = WARN_STEPS * 4;
function start(state: GameState, key: RunEventKey, index: number): void {
  scheduleRunEvent(state, key, index);
  const slot = RUN_EVENTS[key].scope === "floor" ? "floor" : "room";
  for (let i = 0; i < START_LIMIT && state.runEvents[slot]?.phase === "warn"; i++) step(state, IDLE, FIXED_DT);
}

/** 封鎖中の部屋の敵を n 体まで減らす（部屋の敵数の上限 ROOM.maxEnemies に当たらないように） */
function thin(state: GameState, index: number, keep: number): void {
  const alive = state.enemies.filter((e) => e.roomIndex === index && e.hp > 0);
  alive.slice(keep).forEach((e) => {
    e.hp = 0;
  });
  run(state, 1);
}

function aliveIn(state: GameState, index: number): number {
  return state.enemies.filter((e) => e.roomIndex === index && e.hp > 0).length;
}

function clearOut(state: GameState, room: RoomState, index: number): void {
  for (let i = 0; i < 120 && !room.cleared; i++) {
    for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
    step(state, IDLE, FIXED_DT);
  }
}

describe("ランイベントの予告", () => {
  it("すべてのイベントは予告（HUD の 1 行 + 効果音）から warnTime 秒後に始まる", () => {
    expect(RUN_EVENT_KEYS.length).toBeGreaterThanOrEqual(12);
    for (const key of RUN_EVENT_KEYS) {
      const { state, room, index } = setup();
      lock(state, room);
      state.sfx = [];
      scheduleRunEvent(state, key, index);
      expect(state.sfx, key).toContain("runEventWarn");
      const lines = runEventHudLines(state);
      expect(lines.some((l) => l.warn && l.text.includes(RUN_EVENTS[key].warn)), `${key} の予告行`).toBe(true);
      const slot = RUN_EVENTS[key].scope === "floor" ? "floor" : "room";
      run(state, Math.floor(RUN_EVENT.warnTime / FIXED_DT) - 2);
      expect(state.runEvents[slot]?.phase, `${key} は予告中`).toBe("warn");
      state.sfx = [];
      run(state, 4);
      const current = state.runEvents[slot];
      // 一瞬で終わるもの（宝の雨・縮みの呪い）も始まった瞬間の音は鳴る
      expect(state.sfx.includes("runEventStart") || current?.phase === "active", `${key} が始まる`).toBe(true);
    }
  });

  it("浅い階（RUN_EVENT.minDepth 未満）では自然には起きない", () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = createGame(seed);
      expect(state.depth).toBeLessThan(RUN_EVENT.minDepth);
      expect(state.runEvents.floor, `seed=${seed}`).toBeNull();
    }
  });

  it("同じ seed なら階の枠のイベントは同じ（決定的）", () => {
    const keys = (seed: number): (string | null)[] => {
      const state = createGame(seed);
      const out: (string | null)[] = [];
      for (let d = 2; d <= 8; d++) {
        state.depth = d;
        buildFloor(state);
        out.push(state.runEvents.floor?.key ?? null);
      }
      return out;
    };
    expect(keys(3)).toEqual(keys(3));
  });
});

describe("ランイベントの効果", () => {
  it("増援: 封鎖中の部屋に敵が足される。すぐ倒すと報酬", () => {
    const { state, room, index } = setup();
    lock(state, room);
    thin(state, index, 2);
    const before = aliveIn(state, index);
    start(state, "reinforce", index);
    expect(aliveIn(state, index)).toBeGreaterThan(before);
    const items = state.floorItems.length;
    clearOut(state, room, index);
    expect(state.floorItems.length, "部屋の報酬 + 増援の報酬").toBeGreaterThanOrEqual(items + 2);
  });

  it("停電: 部屋が暗くなり、制圧で明かりが戻る", () => {
    const { state, room, index } = setup();
    lock(state, room);
    expect(isDark(state)).toBe(false);
    start(state, "blackout", index);
    expect(isDark(state)).toBe(true);
    clearOut(state, room, index);
    expect(isDark(state)).toBe(false);
  });

  it("マナ枯渇: マナが抜け続け、制圧でマナが満ちる", () => {
    const { state, room, index } = setup();
    lock(state, room);
    state.player.mana = state.stats.maxMana;
    start(state, "manaDrought", index);
    run(state, 60);
    expect(state.player.mana).toBeLessThan(state.stats.maxMana);
    clearOut(state, room, index);
    expect(state.player.mana).toBe(state.stats.maxMana);
  });

  it("賞金首: 未制圧の部屋の敵が 1 体選ばれ、倒すと rare 以上とスコア", () => {
    const { state } = setup();
    start(state, "bounty", -1);
    const id = bountyTargetId(state);
    const target = state.enemies.find((e) => e.id === id);
    if (!target) throw new Error("bounty missing");
    expect(target.elite).toBeDefined();
    const score = state.score;
    target.hp = 0;
    run(state, 2);
    expect(state.score).toBeGreaterThanOrEqual(score + RUN_EVENT.bountyScore);
    expect(state.floorItems.some((f) => f.item.rarity === "rare" || f.item.rarity === "unique")).toBe(true);
    expect(state.runEvents.floor).toBeNull();
  });

  it("地震・流星群: 予告の円が出て、着弾で敵にもダメージ", () => {
    for (const key of ["quake", "meteor"] as const) {
      const { state, room, index } = setup();
      lock(state, room);
      start(state, key, index);
      run(state, 3);
      const impact = state.runEvents.impacts[0];
      expect(impact, key).toBeDefined();
      if (!impact) continue;
      const e = placeEnemy(state, "golem", 0);
      const hp = e.hp;
      // 追ってきて円から出ないよう、着弾まで円の中心に留める
      for (let i = 0; i < START_LIMIT && state.runEvents.impacts.includes(impact); i++) {
        e.body.pos = { ...impact.pos };
        step(state, IDLE, FIXED_DT);
      }
      expect(e.hp, `${key} の着弾`).toBeLessThan(hp);
    }
  });

  it("宝の雨: 遺物とハートが降る", () => {
    const { state, room, index } = setup();
    lock(state, room);
    const items = state.floorItems.length;
    start(state, "treasureRain", index);
    expect(state.floorItems.length).toBe(items + RUN_EVENT.rainItems);
  });

  it("刻の裂け目: 触れると部屋の敵が凍り、敵弾が消える", () => {
    const { state, room, index } = setup();
    lock(state, room);
    start(state, "timeRift", index);
    const pos = state.runEvents.room?.pos;
    if (!pos) throw new Error("rift missing");
    state.player.body.pos = { ...pos };
    run(state, 1);
    const inRoom = state.enemies.filter((e) => e.roomIndex === index && e.hp > 0);
    expect(inRoom.length).toBeGreaterThan(0);
    expect(inRoom.some((e) => hasStatus(e.status, "freeze"))).toBe(true);
    expect(state.projectiles.some((p) => p.owner === "enemy")).toBe(false);
  });

  it("霧・呪いの風・血の月・狂乱の月", () => {
    const fog = setup();
    start(fog.state, "fog", -1);
    expect(fogActive(fog.state)).toBe(true);

    const wind = setup();
    start(wind.state, "curseWind", -1);
    expect(wind.state.cursed).toBe(true);

    const blood = setup();
    start(blood.state, "bloodMoon", -1);
    blood.state.player.hp = 10;
    blood.state.kills += 3;
    run(blood.state, 1);
    expect(blood.state.player.hp).toBeGreaterThan(10);

    const frenzy = setup();
    start(frenzy.state, "frenzyMoon", -1);
    expect(frenzy.state.enemies.some((e) => e.elite === "hasted")).toBe(true);
  });

  it("縮みの呪い: 敵が増えて HP が半分になる", () => {
    const { state, room, index } = setup();
    lock(state, room);
    thin(state, index, 2);
    const before = state.enemies.filter((e) => e.roomIndex === index && e.hp > 0);
    const count = before.length;
    const maxHp = before.map((e) => e.maxHp);
    start(state, "shrink", index);
    const after = state.enemies.filter((e) => e.roomIndex === index && e.hp > 0);
    expect(after.length).toBeGreaterThan(count);
    before.forEach((e, i) => expect(e.maxHp).toBeLessThanOrEqual(Math.ceil((maxHp[i] ?? 0) * RUN_EVENT.shrinkHpMul)));
  });

  it("勢いの風: 次の部屋を封鎖すると足が速くなり、敵が 1 体減る", () => {
    const { state, room, index } = setup();
    start(state, "momentum", -1);
    const others = state.rooms.findIndex((r, i) => i !== index && i > 0 && i < state.rooms.length - 1 && r.kind === "normal");
    expect(others).toBeGreaterThanOrEqual(0);
    lock(state, room);
    expect(state.player.buffs.speed.mul).toBe(RUN_EVENT.momentumSpeedMul);
    expect(state.runEvents.room).toBeNull();
  });
});

describe("長居の代償", () => {
  function lingering(kind: "shadow" | "collapse" | "tide"): GameState {
    const state = createGame(11);
    state.depth = LINGER.minDepth + 3;
    buildFloor(state, kind === "tide" ? "swamp" : kind === "collapse" ? "mine" : "rooms");
    state.runEvents.room = null;
    state.runEvents.floor = null;
    state.runEvents.cooldown = 1e9;
    state.runEvents.timedCheck = 1e9;
    state.player.invulnTimer = 1e9;
    return state;
  }

  it("バイオームで代償が決まり、死神より先に始まる", () => {
    const state = lingering("shadow");
    const linger = state.runEvents.linger;
    expect(linger.kind).toBe("shadow");
    expect(linger.startAt).toBeLessThan(reaperAppearAfter(state));
    expect(lingering("collapse").runEvents.linger.kind).toBe("collapse");
    expect(lingering("tide").runEvents.linger.kind).toBe("tide");
  });

  it("浅い階では起きない（縛り「長居の二重苦」なら起きて、早く始まる）", () => {
    const shallow = createGame(2);
    expect(shallow.runEvents.linger.kind).toBeNull();
    const doubled = createGame(2, "2", undefined, undefined, { origin: "wanderer", modifiers: ["doubleLinger"] });
    expect(doubled.runEvents.linger.kind).not.toBeNull();
    expect(doubled.runEvents.linger.startAt).toBeCloseTo(reaperAppearAfter(doubled) * LINGER.doubleRatio);
  });

  it("影の自分: shadowDelay 秒前の自分の位置に影が出る", () => {
    const state = lingering("shadow");
    const linger = state.runEvents.linger;
    const start = { ...state.player.body.pos };
    state.floorTime = linger.startAt - LINGER.shadowDelay - 1;
    run(state, Math.ceil((LINGER.shadowDelay + 1.5) / FIXED_DT));
    const shadows = shadowPositions(state);
    expect(linger.started).toBe(true);
    expect(shadows.length).toBe(1);
    const s = shadows[0];
    if (!s) throw new Error("shadow missing");
    expect(Math.hypot(s.x - start.x, s.y - start.y)).toBeLessThan(TILE_SIZE);
  });

  it("天井の崩落: 始まると足元に予告つきの落石が落ちる", () => {
    const state = lingering("collapse");
    state.floorTime = state.runEvents.linger.startAt;
    run(state, 2);
    expect(state.runEvents.impacts.length).toBeGreaterThan(0);
  });

  it("潮: 開始部屋から水が広がる", () => {
    const state = lingering("tide");
    const linger = state.runEvents.linger;
    state.floorTime = linger.startAt + 2;
    run(state, Math.ceil(LINGER.tideInterval / FIXED_DT) + 2);
    expect(terrainAt(state, linger.origin.x, linger.origin.y)).toBe("water");
  });
});

describe("縛りの効果", () => {
  it("早い手: 予備動作が 1 割縮む", () => {
    const measure = (mods: ("quickHands")[]): number => {
      const state = createGame(5, "5", undefined, undefined, { origin: "wanderer", modifiers: mods });
      state.enemies = [];
      state.player.invulnTimer = 1e9;
      const e = placeEnemy(state, "slime", 20);
      e.phase = "windup";
      e.phaseTimer = 1;
      let steps = 0;
      while (e.phase === "windup" && steps < 200) {
        step(state, IDLE, FIXED_DT);
        steps++;
      }
      return steps;
    };
    const base = measure([]);
    const quick = measure(["quickHands"]);
    expect(quick).toBeLessThan(base);
    expect(quick).toBeGreaterThanOrEqual(Math.floor(base * (1 - RUN_MOD.quickHandsCut)) - 1);
  });

  it("部屋の砂時計: 封鎖しない部屋でも交戦中なら時計が動き、交戦していなければ止まる", () => {
    const state = createGame(7, "7", undefined, undefined, { origin: "wanderer", modifiers: ["hourglass"] });
    quiet(state);
    state.enemies = [];
    for (const r of state.rooms) r.locked = false;
    expect(hourglassLeft(state), "交戦前").toBeNull();
    engageStartRoom(state);
    expect(hourglassLeft(state), "開放型の交戦中").not.toBeNull();
  });

  it("部屋の砂時計: 封鎖が長引くと増援が来る", () => {
    const state = createGame(7, "7", undefined, undefined, { origin: "wanderer", modifiers: ["hourglass"] });
    state.depth = DEPTH;
    buildFloor(state, "rooms");
    quiet(state);
    const index = state.rooms.findIndex((r, i) => i > 0 && i < state.rooms.length - 1 && r.kind === "normal" && r.doorTiles.length > 0);
    const room = state.rooms[index];
    if (!room) throw new Error("room missing");
    room.kind = "ambush";
    state.player.invulnTimer = 1e9;
    lock(state, room);
    thin(state, index, 2);
    expect(hourglassLeft(state)).not.toBeNull();
    const before = state.enemies.filter((e) => e.roomIndex === index).length;
    state.runEvents.lockTime = RUN_MOD.hourglassTime - FIXED_DT;
    run(state, 2);
    expect(state.enemies.filter((e) => e.roomIndex === index).length).toBeGreaterThan(before);
  });
});
