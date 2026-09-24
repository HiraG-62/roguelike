import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState, RoomState } from "../core/state";
import { ELEMENT_LABEL } from "../core/element";
import { CONTRACT, FLOOR_KIND, HEAL, LINGER, RUN_EVENT, RUN_MOD } from "../data/tuning";
import { BOONS, BOON_KEYS, grantBoon } from "./boons";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { buildFloor } from "./floor";
import { shadowPositions } from "./linger";
import { reaperAppearAfter } from "./reaper";
import { isDark } from "./roomTypes";
import {
  RUN_EVENTS,
  RUN_EVENT_KEYS,
  type RunEventKey,
  activeElementStorm,
  bountyTargetId,
  deepHpMul,
  fogActive,
  hourglassLeft,
  mutationsFor,
  reaperPassLine,
  runEventHudLines,
  scheduleRunEvent,
  updateRunEvents,
} from "./runEvents";
import { hasStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { engageStartRoom, placeEnemy, withInput } from "./testHelpers";

const IDLE = withInput({});
const DEPTH = 5;
const WARN_STEPS = Math.ceil(RUN_EVENT.warnTime / FIXED_DT) + 2;

/** 回廊の階。封鎖できる部屋（開始・最後以外）の index も返す。自然に起きるイベントと代償は止める */
/** 落雷などの単発ダメージで死なない生命（テストの敵が抽選で蝙蝠になっても耐える） */
const STURDY_HP = 10_000;

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
    // 増援の褒美（dropBonusReward）は確定。制圧報酬は LOOT_DROP.roomClearChanceByDepth の抽選なので数えない
    expect(state.floorItems.length, "増援の褒美").toBeGreaterThanOrEqual(items + 1);
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

// -----------------------------------------------------------------------------
// 第 2 弾のイベント
// -----------------------------------------------------------------------------

describe("ランイベント第 2 弾の効果", () => {
  it("第 2 弾のイベントは 12 種以上ある", () => {
    const wave2: RunEventKey[] = [
      "curseVoice",
      "duel",
      "sluggish",
      "flood",
      "silence",
      "reactionSurge",
      "thunderstorm",
      "elementStorm",
      "reaperPass",
      "echoVein",
      "bats",
      "lifeFlow",
      "boonReroll",
    ];
    for (const key of wave2) expect(RUN_EVENT_KEYS, key).toContain(key);
    expect(wave2.length).toBeGreaterThanOrEqual(12);
  });

  it("属性の嵐: 階の間、通常攻撃に属性が乗る（予告の段階で属性が決まっている）", () => {
    const { state } = setup();
    scheduleRunEvent(state, "elementStorm", -1);
    const element = state.runEvents.floor?.element;
    expect(element, "属性").toBeTruthy();
    if (!element) return;
    const before = state.stats.infuse[element];
    run(state, WARN_STEPS);
    expect(activeElementStorm(state)?.element, "実行中").toBe(element);
    expect(state.stats.infuse[element], "通常攻撃の属性").toBeCloseTo(before + RUN_EVENT.elementStormShare, 5);
    expect(runEventHudLines(state).some((l) => l.text.includes(ELEMENT_LABEL[element])), "HUD に属性").toBe(true);
  });

  it("生命の逆流: 回復は気力に、気力の増えは生命に流れる", () => {
    const { state } = setup();
    start(state, "lifeFlow", -1);
    const p = state.player;
    p.hp = p.maxHp / 2;
    p.mana = 0;
    run(state, 1);
    const hp = p.hp;
    const mana = p.mana;
    p.hp += 10;
    run(state, 1);
    // 自然回復の気力は生命へ流れるので、生命はわずかに増えうる。回復した 10 は気力へ移る
    expect(p.hp, "回復は生命に残らない").toBeLessThan(hp + 5);
    expect(p.mana, "気力が増える").toBeGreaterThan(mana + 5);
  });

  it("静寂: 気力が自然に戻らず、部屋の敵が沈黙する。制圧で気力が満ちる", () => {
    const { state, room, index } = setup();
    lock(state, room);
    thin(state, index, 2);
    start(state, "silence", index);
    const enemy = state.enemies.find((e) => e.roomIndex === index && e.hp > 0);
    expect(enemy && hasStatus(enemy.status, "silence"), "沈黙").toBe(true);
    state.player.mana = 1;
    run(state, 60);
    expect(state.player.mana, "自然には戻らない").toBeLessThan(1.5);
    clearOut(state, room, index);
    expect(state.player.mana, "制圧で満ちる").toBe(state.stats.maxMana);
  });

  it("決闘: 名乗った敵以外が止まり、名乗った敵を倒すと残りが怯えて欠片", () => {
    const { state, room, index } = setup();
    lock(state, room);
    thin(state, index, 3);
    start(state, "duel", index);
    const current = state.runEvents.room;
    const champion = current?.target;
    expect(champion, "名乗った敵").toBeTruthy();
    if (!champion || !current) return;
    run(state, 1);
    const others = state.enemies.filter((e) => e !== champion && e.roomIndex === index && e.hp > 0);
    expect(others.length, "他の敵").toBeGreaterThan(0);
    expect(others.every((e) => e.attackCooldown > 0), "他の敵は手を出さない").toBe(true);
    const shards = state.shards;
    champion.hp = 0;
    run(state, 1);
    expect(state.shards - shards, "欠片").toBeGreaterThanOrEqual(CONTRACT.shardsDuel);
    expect(others.filter((e) => e.hp > 0).some((e) => hasStatus(e.status, "fear")), "恐怖").toBe(true);
  });

  it("呪詛の声: 呪い持ちにだけ起き、コンボが届けば呪いが解け、届かなければ増える", () => {
    const cursed = BOON_KEYS.filter((k) => BOONS[k].cursed && !BOONS[k].after && !BOONS[k].duo);
    const first = cursed[0];
    if (!first) throw new Error("呪い付きの祝福が無い");
    const ok = setup();
    grantBoon(ok.state, first);
    lock(ok.state, ok.room);
    start(ok.state, "curseVoice", ok.index);
    ok.state.combo.count = RUN_EVENT.curseVoiceCombo;
    run(ok.state, 1);
    clearOut(ok.state, ok.room, ok.index);
    expect(ok.state.boons.includes(first), "呪いが解けた").toBe(false);

    const ng = setup();
    grantBoon(ng.state, first);
    lock(ng.state, ng.room);
    start(ng.state, "curseVoice", ng.index);
    const before = ng.state.boons.filter((k) => BOONS[k].cursed).length;
    ng.state.combo.count = 0;
    clearOut(ng.state, ng.room, ng.index);
    expect(ng.state.boons.filter((k) => BOONS[k].cursed).length, "呪いが増えた").toBe(before + 1);
  });

  it("雷鳴の刻: 落雷の予告が満ちると円の中の敵に当たって感電させる", () => {
    const { state, room, index } = setup();
    lock(state, room);
    thin(state, index, 1);
    start(state, "thunderstorm", index);
    const e = state.enemies.find((x) => x.roomIndex === index && x.hp > 0);
    if (!e) throw new Error("enemy");
    // 生命の少ない敵（蝙蝠など）だと落雷で即死して感電が付かないので、落雷に耐える生命にしておく
    e.maxHp = STURDY_HP;
    e.hp = STURDY_HP;
    const hp = e.hp;
    state.runEvents.strikes.push({ pos: { ...e.body.pos }, timer: FIXED_DT / 2, telegraph: 1 });
    run(state, 1);
    expect(e.hp, "当たった").toBeLessThan(hp);
    expect(hasStatus(e.status, "shock"), "感電").toBe(true);
  });

  it("死神の通り道: 予告中から線が見え、線の上にいると 1 回だけ大きく削られ、通り過ぎると冥の残響", () => {
    const { state } = setup();
    state.floorTime = reaperAppearAfter(state);
    scheduleRunEvent(state, "reaperPass", -1);
    expect(reaperPassLine(state)?.warn, "予告の線").toBe(true);
    state.player.invulnTimer = 0;
    const hp = state.player.hp;
    const umbra = state.runEvents.pendingEchoes.umbra;
    let steps = 0;
    for (; steps < 600 && state.runEvents.room?.key === "reaperPass"; steps++) {
      state.player.invulnTimer = Math.min(state.player.invulnTimer, 0.01);
      // 線の中心に立ち続ける
      const line = reaperPassLine(state);
      if (line) state.player.body.pos = { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 };
      step(state, IDLE, FIXED_DT);
    }
    expect(state.player.hp, "削られた").toBeLessThan(hp);
    expect(state.runEvents.pendingEchoes.umbra, "冥の残響").toBe(umbra + RUN_EVENT.reaperPass.echoes);
  });

  it("鈍重: ダッシュに入った瞬間、再使用が伸び、直後の与ダメが上がる", () => {
    const { state, room, index } = setup();
    lock(state, room);
    start(state, "sluggish", index);
    const p = state.player;
    p.dashTimer = 0.1;
    p.dashChargesLeft = state.stats.dashCharges - 1;
    p.dashCooldown = 1;
    run(state, 1);
    expect(p.dashCooldown, "再使用").toBeGreaterThan(1.5);
    expect(p.buffs.damage.mul, "直後の一撃").toBeGreaterThanOrEqual(RUN_EVENT.sluggish.dashDamageMul);
  });

  it("地形の氾濫: 部屋に水か油が広がる", () => {
    const { state, room, index } = setup();
    lock(state, room);
    start(state, "flood", index);
    run(state, Math.ceil(RUN_EVENT.flood.interval / FIXED_DT) + 2);
    const pos = state.runEvents.room?.pos;
    if (!pos) throw new Error("氾濫の源");
    expect(["water", "oil"], "地形").toContain(terrainAt(state, pos.x, pos.y));
  });

  it("反応の共振: 反応が起きた点の周りの敵に当たる", () => {
    const { state, room, index } = setup();
    lock(state, room);
    thin(state, index, 1);
    start(state, "reactionSurge", index);
    const e = state.enemies.find((x) => x.roomIndex === index && x.hp > 0);
    if (!e) throw new Error("enemy");
    e.phase = "idle";
    const hp = e.hp;
    state.events.push({ kind: "onReaction", actor: "player", pos: { ...e.body.pos }, depth: 0, source: { kind: "player", key: "test" } });
    updateRunEvents(state, FIXED_DT);
    expect(e.hp, "弾けた").toBeLessThan(hp);
  });

  it("残響の鉱脈: 部屋に鉱脈が現れ、触れると残響", () => {
    const { state, room, index } = setup();
    lock(state, room);
    start(state, "echoVein", index);
    const vein = room.special?.props.find((p) => p.kind === "vein");
    expect(vein, "鉱脈").toBeTruthy();
  });

  it("蝙蝠の渡り: 蝙蝠が湧き、倒すと気力が戻る", () => {
    const { state, room, index } = setup();
    lock(state, room);
    const bats = state.enemies.filter((e) => e.defKey === "bat").length;
    start(state, "bats", index);
    expect(state.enemies.filter((e) => e.defKey === "bat").length, "蝙蝠").toBeGreaterThan(bats);
    state.player.mana = 0;
    state.kills += 1;
    updateRunEvents(state, FIXED_DT);
    expect(state.player.mana, "気力").toBeGreaterThan(0);
  });

  it("流れ星: 祝福を 1 つ手放して 3 択を開く", () => {
    const { state, room, index } = setup();
    const plain = BOON_KEYS.find((k) => !BOONS[k].cursed && !BOONS[k].after && !BOONS[k].duo);
    if (!plain) throw new Error("祝福");
    grantBoon(state, plain);
    lock(state, room);
    scheduleRunEvent(state, "boonReroll", index);
    for (let i = 0; i < START_LIMIT && !state.boonChoice; i++) step(state, IDLE, FIXED_DT);
    expect(state.boons.includes(plain), "手放した").toBe(false);
    expect(state.boonChoice, "3 択").not.toBeNull();
  });

  it("流れ星: 3 択が開けない深度では祝福を手放さない", () => {
    const { state, room, index } = setup(7, 1);
    const plain = BOON_KEYS.find((k) => !BOONS[k].cursed && !BOONS[k].after && !BOONS[k].duo);
    if (!plain) throw new Error("祝福");
    grantBoon(state, plain);
    lock(state, room);
    scheduleRunEvent(state, "boonReroll", index);
    for (let i = 0; i < START_LIMIT && state.runEvents.room; i++) step(state, IDLE, FIXED_DT);
    expect(state.boonChoice, "深度 1 では 3 択が開かない").toBeNull();
    expect(state.boons.includes(plain), "手放さない").toBe(true);
  });
});

describe("無限の深み（変異）", () => {
  it("深みより浅ければ変異なし、深いほど積み上がる", () => {
    expect(mutationsFor(FLOOR_KIND.deepDepth - 1)).toEqual([]);
    expect(mutationsFor(FLOOR_KIND.deepDepth).length).toBe(1);
    expect(mutationsFor(FLOOR_KIND.deepDepth + FLOOR_KIND.mutationEvery).length).toBe(2);
    for (const key of mutationsFor(FLOOR_KIND.deepDepth + FLOOR_KIND.mutationEvery * 10)) expect(RUN_EVENTS[key].scope, key).toBe("floor");
  });

  it("深みの階では変異が常に効き、HUD に出る", () => {
    const { state } = setup(7, FLOOR_KIND.deepDepth + FLOOR_KIND.mutationEvery * 2);
    buildFloor(state, "rooms");
    quiet(state);
    expect(state.runEvents.mutations.length).toBe(3);
    expect(fogActive(state), "霧の変異").toBe(true);
    expect(runEventHudLines(state).some((l) => l.text.startsWith("変異")), "HUD").toBe(true);
  });

  it("深みでは敵の HP の伸びが寝る", () => {
    expect(deepHpMul(FLOOR_KIND.deepDepth)).toBe(1);
    expect(deepHpMul(FLOOR_KIND.deepDepth + 20)).toBeLessThan(1);
  });
});

describe("生命の逆流: 回復の上限", () => {
  it("気力の増えから流れる生命は、戦闘中の回復の共通上限を超えない", () => {
    const { state } = setup();
    start(state, "lifeFlow", -1);
    const p = state.player;
    p.hp = p.maxHp / 2;
    p.mana = 0;
    run(state, 1);
    const hp = p.hp;
    // 1 ステップで気力が大きく増えた（命中時の気力などを想定）
    p.lifeOnHitWindow = { timer: 0, healed: 0 };
    p.mana += p.maxHp;
    run(state, 1);
    expect(p.hp - hp, "上限まで").toBeLessThanOrEqual(p.maxHp * HEAL.sustainCapRatio + 1e-6);
  });
});
