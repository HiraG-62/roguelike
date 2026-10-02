import { describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import type { GameState, RoomKind, WareKind } from "../core/state";
import { ARC, ROOM_KIND } from "../data/tuning";
import { withFixedLayout } from "../map/layout/select";
import { CONTRACTOR_KEYS, type ContractorKey } from "./contractors";
import { buildFloor, withBaseAreaMul } from "./floor";
import { stockPlan } from "./merchants";
import { RUN_EVENT_KEYS, rollFloorEventKey } from "./runEvents";
import { assignExtraRoomKinds, planForkStairs } from "./specialRooms";
import { tierPerks } from "../meta/tierRewards";

/** 解放制の封じと位階の見返り（state.runMeta を読む側。docs/ideas/meta-impl.md 2-5・2-6） */

const SEEDS = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
const EXTRA_ROOM_KEYS = Object.keys(ROOM_KIND.extra) as RoomKind[];

function game(seed: number): GameState {
  return withBaseAreaMul(() => createGame(seed));
}

describe("解放制: 契約者の封じ", () => {
  it("封じた契約者は立たず、残りだけが立つ", () => {
    const open: ContractorKey[] = ["peddler", "mender"];
    const stood = new Set<ContractorKey>();
    for (const seed of SEEDS) {
      const state = game(seed);
      state.runMeta.lockedContractors = CONTRACTOR_KEYS.filter((k) => !open.includes(k));
      state.depth = 4;
      buildFloor(state, "rooms");
      const key = state.contracts.contractor?.key;
      if (key) stood.add(key);
    }
    expect(stood.size, "立った契約者がいる").toBeGreaterThan(0);
    for (const key of stood) expect(open, `${key} は封じていない契約者`).toContain(key);
  });

  it("封じても契約者の抽選は乱数を 1 回だけ引く", () => {
    // 旧生成の階に固定する。立つ契約者が変わると後の抽選（旅商人など）の出方も変わるので、引く回数が揃うのは seed と地図の形しだい
    withFixedLayout("legacy", () => {
      const base = game(3);
      base.depth = 6;
      const locked = game(3);
      locked.depth = 6;
      locked.runMeta.lockedContractors = ["notary", "bookie"];
      const spyBase = vi.spyOn(base.rng, "next");
      const spyLocked = vi.spyOn(locked.rng, "next");
      buildFloor(base, "rooms");
      buildFloor(locked, "rooms");
      // 階の生成全体で引く回数が同じ（封じは重みを外すだけで、引く回数を増減させない）
      expect(spyLocked.mock.calls.length, "next の回数").toBe(spyBase.mock.calls.length);
    });
  });
});

describe("解放制: 追加の部屋の封じ", () => {
  it("封じた部屋の種類は置かれず、乱数も引かない", () => {
    const state = game(4);
    state.depth = 8;
    buildFloor(state, "rooms");
    for (const r of state.rooms) r.kind = "normal";
    state.runMeta.lockedRooms = [...EXTRA_ROOM_KEYS];
    const chance = vi.spyOn(state.rng, "chance");
    const int = vi.spyOn(state.rng, "int");
    assignExtraRoomKinds(state, new Set());
    expect(state.rooms.every((r) => r.kind === "normal"), "何も置かれない").toBe(true);
    expect(chance.mock.calls.length, "chance").toBe(0);
    expect(int.mock.calls.length, "int").toBe(0);
  });

  it("開いている種類だけが置かれる", () => {
    const open: RoomKind = "library";
    for (const seed of SEEDS) {
      const state = game(seed);
      state.runMeta.lockedRooms = EXTRA_ROOM_KEYS.filter((k) => k !== open);
      state.depth = 8;
      buildFloor(state, "rooms");
      for (const r of state.rooms) expect(EXTRA_ROOM_KEYS.includes(r.kind) ? r.kind : open, `seed=${seed}`).toBe(open);
    }
  });

  it("起点「賭博師」の賭博の部屋は封じない", () => {
    const state = createGame(3, "3", undefined, undefined, { origin: "gambler", modifiers: [], runMeta: { nemesis: null, lockedRooms: ["gamble"], lockedContractors: [], lockedEvents: [], perks: [] } });
    state.depth = 2;
    buildFloor(state, "rooms");
    expect(state.rooms.some((r) => r.kind === "gamble"), "賭博").toBe(true);
  });
});

describe("解放制: ランイベントの封じ", () => {
  it("封じたランイベントは抽選されず、占いの先読みにも出ない", () => {
    let opened = 0;
    for (const seed of SEEDS) {
      const free = game(seed);
      free.depth = 6;
      for (let i = 0; i < 40; i++) if (rollFloorEventKey(free) !== null) opened++;
      const state = game(seed);
      state.depth = 6;
      state.runMeta.lockedEvents = [...RUN_EVENT_KEYS];
      const chance = vi.spyOn(state.rng, "chance");
      for (let i = 0; i < 40; i++) expect(rollFloorEventKey(state), `seed=${seed}`).toBeNull();
      expect(chance.mock.calls.length, "封じた種類は乱数を引かない").toBe(0);
    }
    expect(opened, "封じなしなら階のイベントは起きる（前提）").toBeGreaterThan(0);
  });
});

describe("位階の見返り", () => {
  it("見返り exit で出口が 1 本増える", () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const counts = [false, true].map((perk) => {
        const state = game(seed);
        state.depth = ARC.floorsPerChapter;
        buildFloor(state, "rooms");
        state.runMeta.perks = perk ? tierPerks({ clears: 1, bestClearTier: 99 }) : [];
        state.rng = createRng(77);
        planForkStairs(state);
        return state.stairs.length;
      });
      const [base, withPerk] = counts;
      expect(withPerk, `seed=${seed} 出口`).toBe((base ?? 0) + 1);
    }
  });

  it("見返り market で章の市の品が 1 つ増え、ふつうの市は変わらない", () => {
    const market = (perk: boolean, depth: number): WareKind[] => {
      const state = game(2);
      state.runMeta.perks = perk ? ["market"] : [];
      state.depth = depth;
      buildFloor(state, "rooms");
      const m = state.economy.merchants.find((x) => x.kind !== "peddler");
      return m?.wares.map((w) => w.kind) ?? [];
    };
    const chapter = ARC.floorsPerChapter;
    expect(market(false, chapter), "見返りなしの章の市").toEqual(stockPlan("chapterMarket"));
    expect(market(true, chapter), "見返りありの章の市").toEqual([...stockPlan("chapterMarket"), "rune"]);
    expect(market(true, chapter - 1), "ふつうの市").toEqual(stockPlan("market"));
  });

  it("見返り perks が空なら出口・市は今と同じ（runMeta が空の状態）", () => {
    const state = game(2);
    expect(state.runMeta.perks).toEqual([]);
    state.depth = ARC.floorsPerChapter;
    buildFloor(state, "rooms");
    const m = state.economy.merchants.find((x) => x.kind !== "peddler");
    expect(m?.wares.map((w) => w.kind)).toEqual(stockPlan("chapterMarket"));
  });
});
