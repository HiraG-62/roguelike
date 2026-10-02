import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { ARC, ECONOMY, ROOM_KIND } from "../data/tuning";
import { MemoryStorage } from "../meta/testStorage";
import { setSaveStorage } from "../save/backend";
import { type RoomProp, updateRoomProps } from "./specialRooms";
import { buildFloor, withBaseAreaMul } from "./floor";
import { donate, donationAmount } from "./donation";
import { interactAt, screenOfWorld, withInput } from "./testHelpers";

/** 寄進の祠（system/donation.ts。docs/ideas/economy-impl.md 2-9） */

const SEEDS = 8;
/** 章の休符（章の 1 階目。深度 1 は含まない） */
const REST_DEPTH = ARC.floorsPerChapter + 1;

function floorAt(seed: number, depth: number): GameState {
  const state = withBaseAreaMul(() => createGame(seed));
  state.depth = depth;
  buildFloor(state);
  return state;
}

function shrineOf(state: GameState): RoomProp | undefined {
  return state.rooms.flatMap((r) => r.special?.props ?? []).find((p) => p.kind === "donation");
}

function requireShrine(state: GameState): RoomProp {
  const shrine = shrineOf(state);
  if (!shrine) throw new Error("祠がない");
  return shrine;
}

describe("寄進の額", () => {
  it("持ち金の step、ただし最低 min。持ち金がそれ未満なら全額、0 なら 0", () => {
    expect(donationAmount(100), "25%").toBe(Math.round(100 * ECONOMY.donation.step));
    expect(donationAmount(1000), "大きな持ち金は 25%").toBe(Math.round(1000 * ECONOMY.donation.step));
    expect(donationAmount(20), "25% が最低額に満たなければ最低額").toBe(ECONOMY.donation.min);
    expect(donationAmount(ECONOMY.donation.min - 3), "最低額に満たない持ち金は全額").toBe(ECONOMY.donation.min - 3);
    expect(donationAmount(0), "持ち金 0").toBe(0);
  });
});

describe("寄進する", () => {
  it("納めた額が持ち金から引かれ、economy.donated と使い道の集計に積まれる", () => {
    const state = floorAt(3, REST_DEPTH);
    state.economy.coins = 100;
    const paid = donate(state, { x: 0, y: 0 });
    expect(paid, "納めた額").toBe(donationAmount(100));
    expect(state.economy.coins, "持ち金が減る").toBe(100 - paid);
    expect(state.economy.donated, "総額").toBe(paid);
    expect(state.economy.spent.donation, "使い道の集計").toBe(paid);
    expect(state.texts.some((t) => t.text === `寄進 ${paid}`), "浮き文字「寄進 n」").toBe(true);
  });

  it("全額になるまで繰り返せて、持ち金が尽きたら何も起きない", () => {
    const state = floorAt(3, REST_DEPTH);
    state.economy.coins = 60;
    let guard = 0;
    while (state.economy.coins > 0 && guard++ < 50) donate(state, { x: 0, y: 0 });
    expect(state.economy.coins, "全額まで納められる").toBe(0);
    expect(state.economy.donated, "総額は最初の持ち金").toBe(60);
    expect(donate(state, { x: 0, y: 0 }), "持ち金 0 は 0").toBe(0);
    expect(state.economy.donated, "変わらない").toBe(60);
  });
});

describe("祠の配置", () => {
  it("章の休符の開始部屋に立ち、プレイヤーの出現位置とは重ならない", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const state = floorAt(seed, REST_DEPTH);
      const shrine = shrineOf(state);
      expect(shrine, `seed ${seed}: 祠がある`).toBeDefined();
      if (!shrine) continue;
      expect(state.rooms[0]?.special?.props.includes(shrine), `seed ${seed}: 開始部屋`).toBe(true);
      const p = state.player.body;
      const d = Math.hypot(shrine.pos.x - p.pos.x, shrine.pos.y - p.pos.y);
      expect(d, `seed ${seed}: 出現位置から離れている`).toBeGreaterThan(ROOM_KIND.propRadius + p.radius);
      expect(shrine.used, `seed ${seed}: 使用済みではない`).toBe(false);
    }
  });

  it("休符でない階には立たない（深度 1・章ボスの階・休符の次の階）", () => {
    for (const depth of [1, ARC.floorsPerChapter, REST_DEPTH + 1]) {
      expect(shrineOf(floorAt(3, depth)), `深度 ${depth}`).toBeUndefined();
    }
  });

  it("同じ seed なら同じ位置（乱数を使わない）", () => {
    expect(requireShrine(floorAt(5, REST_DEPTH)).pos).toEqual(requireShrine(floorAt(5, REST_DEPTH)).pos);
  });
});

describe("祠を使う", () => {
  it("インタラクトを押すたびに 1 回寄進し、触れているだけでは寄進しない（使用済みにならない）", () => {
    const state = floorAt(3, REST_DEPTH);
    const shrine = requireShrine(state);
    state.economy.coins = 200;
    state.player.body.pos = { ...shrine.pos };
    updateRoomProps(state);
    expect(state.economy.donated, "触れているだけ").toBe(0);
    interactAt(state, shrine.pos);
    const first = state.economy.donated;
    expect(first, "1 回目").toBe(donationAmount(200));
    interactAt(state, shrine.pos);
    expect(state.economy.donated, "押し直すと 2 回目").toBe(first + donationAmount(200 - first));
    expect(shrine.used, "使用済みにならない").toBe(false);
  });

  it("step の中では保存しない（永続化は endRun だけ）", () => {
    const storage = new MemoryStorage();
    setSaveStorage(storage);
    try {
      const state = floorAt(3, REST_DEPTH);
      const shrine = requireShrine(state);
      state.economy.coins = 100;
      state.player.body.pos = { ...shrine.pos };
      step(state, withInput({ interactPressed: true, aimScreen: screenOfWorld(state, shrine.pos) }), FIXED_DT);
      expect(state.economy.donated, "step でインタラクトして寄進した").toBeGreaterThan(0);
      expect(storage.length, "保存先には何も書かない").toBe(0);
    } finally {
      setSaveStorage(null);
    }
  });
});
