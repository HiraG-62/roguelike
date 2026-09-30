import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { BOON, ECONOMY, EXIT } from "../data/tuning";
import { TILE_SIZE, Tile, toIndex } from "../map/grid";
import { BOONS, BOON_KEYS, type BoonKey, type LineageKey, LINEAGE_KEYS, canTemper, lineageCardsRemaining } from "./boons";
import { isGraded } from "./boonGrade";
import {
  NO_EXIT,
  type ExitReward,
  applyDangerReward,
  applyExitArrival,
  exitColor,
  exitLabel,
  offerArrivalChoices,
  replacesArrivalRelic,
  rollExitLineage,
  rollExitRewards,
} from "./exits";
import { buildFloor, descend, updateRooms } from "./floor";
import { ensureForkStairs, planForkStairs } from "./specialRooms";
import { slayFloorLord } from "./testHelpers";

const SEEDS = 40;

function freshState(seed: number, depth = 3): GameState {
  const state = createGame(seed);
  state.job = "swordsman";
  state.depth = depth;
  return state;
}

/** 格の対象の札（錬磨できる札）を 1 枚持たせる */
function giveGradedBoon(state: GameState): void {
  const key = BOON_KEYS.find((k) => BOONS[k].card !== undefined && isGraded(BOONS[k]));
  if (!key) throw new Error("格の対象の札が無い");
  state.boons = [key];
}

/** その系譜の提示に出る札を n 枚持たせる */
function giveLineageCards(state: GameState, lineage: LineageKey, n: number): void {
  const keys: BoonKey[] = BOON_KEYS.filter((k) => BOONS[k].lineage === lineage && BOONS[k].card !== undefined && BOONS[k].card !== "apex").slice(0, n);
  state.boons = keys;
}

function boonLineages(rewards: readonly ExitReward[]): LineageKey[] {
  return rewards.flatMap((r) => (r.kind === "boon" ? [r.lineage] : []));
}

describe("出口の予告: 報酬の抽選", () => {
  it("1 階に祝福の出口が 1 つ以上ある", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const count of [1, 2, 3]) {
        const rewards = rollExitRewards(freshState(seed), count);
        expect(rewards.length, `seed=${seed} 本数`).toBe(count);
        expect(rewards.some((r) => r.kind === "boon"), `seed=${seed} count=${count} 祝福`).toBe(true);
      }
    }
  });

  it("同じ報酬は並ばない（祝福は違う系譜なら並んでよい）", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const rewards = rollExitRewards(freshState(seed), 3);
      const others = rewards.filter((r) => r.kind !== "boon").map((r) => r.kind);
      expect(new Set(others).size, `seed=${seed} 祝福以外の種類`).toBe(others.length);
      const lineages = boonLineages(rewards);
      expect(new Set(lineages).size, `seed=${seed} 祝福の系譜`).toBe(lineages.length);
    }
  });

  it("深度 1 の出口は祝福・遺物・銭だけ", () => {
    const allowed: readonly string[] = EXIT.firstFloorKinds;
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = freshState(seed, EXIT.firstFloorDepth);
      state.player.hp = 1;
      giveGradedBoon(state);
      for (const r of rollExitRewards(state, 3)) expect(allowed, `seed=${seed} ${r.kind}`).toContain(r.kind);
    }
  });

  it("章ボス階の階段は全部祝福で、系譜は重ならない", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const rewards = rollExitRewards(freshState(seed, 5), 3);
      expect(rewards.every((r) => r.kind === "boon"), `seed=${seed} 全部祝福`).toBe(true);
      const lineages = boonLineages(rewards);
      expect(new Set(lineages).size, `seed=${seed} 系譜`).toBe(3);
    }
  });

  it("見習いの増えた階段は必ず祝福", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = freshState(seed);
      state.job = "none";
      const rewards = rollExitRewards(state, 3);
      expect(rewards[2]?.kind, `seed=${seed} 最後の階段`).toBe("boon");
    }
  });

  it("同じ seed なら同じ報酬（決定的）", () => {
    const a = rollExitRewards(freshState(11), 3);
    const b = rollExitRewards(freshState(11), 3);
    expect(a).toEqual(b);
    expect(createGame(21).stairs).toEqual(createGame(21).stairs);
  });

  it("祝福を持てる系譜が残っていなければ祝福の出口を出さない", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = freshState(seed);
      state.boons = [...BOON_KEYS];
      for (const l of LINEAGE_KEYS) expect(lineageCardsRemaining(state, l), `${l} の残り`).toBe(0);
      expect(rollExitRewards(state, 3).some((r) => r.kind === "boon"), `seed=${seed}`).toBe(false);
      expect(rollExitLineage(state), "系譜の候補が無い").toBeNull();
    }
  });

  it("錬磨は錬磨できる札があるときだけ、瓶は生命が半分以下のときだけ並ぶ", () => {
    const seen = (make: (s: GameState) => void, kind: string): boolean => {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = freshState(seed);
        make(state);
        if (rollExitRewards(state, 3).some((r) => r.kind === kind)) return true;
      }
      return false;
    };
    expect(seen(() => undefined, "temper"), "札が無ければ出ない").toBe(false);
    expect(seen(giveGradedBoon, "temper"), "錬磨できる札があれば出る").toBe(true);
    expect(seen((s) => (s.player.hp = s.player.maxHp), "flask"), "生命が満ちていれば瓶は出ない").toBe(false);
    expect(seen((s) => (s.player.hp = s.player.maxHp * EXIT.flaskMaxHpRatio), "flask"), "生命が半分以下なら瓶が出る").toBe(true);
  });

  it("危険は深度 1 以外で並ぶ", () => {
    let danger = false;
    for (let seed = 0; seed < SEEDS; seed++) danger ||= rollExitRewards(freshState(seed), 3).some((r) => r.kind === "danger");
    expect(danger).toBe(true);
  });

  it("planForkStairs は階段ごとに reward を持ち、祝福の出口が 1 つ以上ある", () => {
    for (let seed = 0; seed < 10; seed++) {
      const state = freshState(seed);
      buildFloor(state, "rooms");
      planForkStairs(state);
      expect(state.stairs.length, `seed=${seed}`).toBeGreaterThan(0);
      for (const s of state.stairs) expect(s.reward, `seed=${seed} 報酬`).toBeDefined();
      expect(state.stairs.some((s) => s.reward.kind === "boon"), `seed=${seed} 祝福`).toBe(true);
    }
  });

  it("ボス撃破で階段が置かれても、行き先ごとの報酬は変わらない", () => {
    const state = createGame(5);
    state.job = "swordsman";
    const planned = state.stairs.map((s) => ({ kind: s.nextKind, reward: s.reward }));
    expect(state.stairs.every((s) => s.tile < 0), "撃破前は tile -1").toBe(true);
    slayFloorLord(state);
    ensureForkStairs(state);
    expect(state.stairs.length, "階段が置かれた").toBeGreaterThan(0);
    for (const s of state.stairs) {
      const p = planned.find((x) => x.kind === s.nextKind);
      expect(s.reward, `${s.nextKind} の報酬`).toEqual(p?.reward);
    }
  });
});

describe("出口の予告: 祝福の出口の系譜", () => {
  it("候補は残りの札がある系譜だけ。同じ階の別の出口が使った系譜は除く", () => {
    const state = freshState(3);
    const rest = new Set<LineageKey>(LINEAGE_KEYS.filter((l) => l !== "frost"));
    for (let n = 0; n < 20; n++) expect(rollExitLineage(state, rest), "使っていない系譜は 1 つだけ").toBe("frost");
    const all = new Set<LineageKey>(LINEAGE_KEYS);
    expect(rollExitLineage(state, all), "全部使ったら候補なし").toBeNull();
  });

  it("持っている札が多い系譜ほど選ばれやすい", () => {
    const state = freshState(9);
    const trials = 400;
    const share = (lineage: LineageKey): number => {
      let n = 0;
      for (let i = 0; i < trials; i++) if (rollExitLineage(state) === lineage) n++;
      return n / trials;
    };
    const before = share("ash");
    giveLineageCards(state, "ash", 4);
    expect(state.boons.length, "札を持たせた").toBe(4);
    const after = share("ash");
    expect(after, "札を持つと ash が増える").toBeGreaterThan(before * 2);
    expect(EXIT.lineageOwnedMul, "倍率は 1 より大きい").toBeGreaterThan(1);
  });
});

describe("出口の予告: 到着時に確定すること", () => {
  it("降りた階では pendingExit が消えている（次の階へ持ち越さない）", () => {
    const state = freshState(4, 2);
    expect(state.pendingExit, "生成直後").toBeNull();
    descend(state, "rooms", { kind: "coins" });
    expect(state.pendingExit, "降りた後").toBeNull();
  });

  it("戻ってから降り直した階では報酬を取らない", () => {
    const state = freshState(4, 2);
    state.runEvents.strata.deepest = 6;
    const before = state.economy.coins;
    descend(state, "rooms", { kind: "coins" });
    expect(state.economy.coins, "降り直しでは銭も増えない").toBe(before);
  });

  it("遺物の出口は到着報酬の遺物を確定で落とす", () => {
    for (let seed = 0; seed < 10; seed++) {
      const state = freshState(seed, 2);
      state.floorItems = [];
      descend(state, "rooms", { kind: "relic" });
      expect(state.floorItems.length, `seed=${seed}`).toBeGreaterThanOrEqual(1);
    }
    expect(replacesArrivalRelic({ kind: "relic" }), "通常の到着報酬の代わり").toBe(true);
    expect(replacesArrivalRelic({ kind: "coins" })).toBe(false);
    expect(replacesArrivalRelic(undefined)).toBe(false);
  });

  it("銭の出口は初めて着いた階の銭が coinsMul 倍になる", () => {
    const withReward = freshState(6, 2);
    const plain = freshState(6, 2);
    descend(withReward, "rooms", { kind: "coins" });
    descend(plain, "rooms", { kind: "boon", lineage: "ash" });
    const floorPlain = plain.economy.earned.floor;
    expect(ECONOMY.income.floor, "床の銭の設定が 0 でない").toBeGreaterThan(0);
    expect(floorPlain, "普通の階の銭").toBeGreaterThan(0);
    // 端数の丸めで 1 ずれてよい
    expect(withReward.economy.earned.floor, "銭の出口は倍率ぶん").toBeGreaterThanOrEqual(floorPlain * EXIT.coinsMul - 1);
    expect(withReward.economy.earned.floor, "銭の出口は倍率ぶん").toBeLessThanOrEqual(floorPlain * EXIT.coinsMul + 1);
  });

  it("鍵・瓶の出口は足元の少し先に 1 つ落とし、予告なしは何も落とさない", () => {
    const key = freshState(2, 2);
    descend(key, "rooms", { kind: "key" });
    expect(key.pickups.filter((p) => p.kind === "key").length, "鍵").toBe(1);
    const flask = freshState(2, 2);
    descend(flask, "rooms", { kind: "flask" });
    expect(flask.pickups.filter((p) => p.kind === "flask").length, "瓶").toBe(1);
    const none = freshState(2, 2);
    descend(none, "rooms", NO_EXIT);
    expect(none.pickups.filter((p) => p.kind === "key" || p.kind === "flask").length, "予告なし").toBe(0);
  });

  it("危険の出口は巣窟・闘技場・試練のどれかを 1 つ強制する（最後の部屋は除く）", () => {
    let forced = 0;
    for (let seed = 0; seed < 10; seed++) {
      const state = freshState(seed, 3);
      descend(state, "rooms", { kind: "danger" });
      const dangers = state.rooms.filter((r) => r.danger === true);
      if (dangers.length === 0) continue;
      forced++;
      expect(dangers.length, `seed=${seed} 危険な部屋は 1 つ`).toBe(1);
      expect(["horde", "arena", "challenge"], `seed=${seed} 種類`).toContain(dangers[0]?.kind);
      expect(dangers[0], `seed=${seed} 最後の部屋ではない`).not.toBe(state.rooms[state.rooms.length - 1]);
    }
    expect(forced, "多くの階で置ける").toBeGreaterThanOrEqual(5);
  });

  it("危険でない出口では部屋を作り替えない", () => {
    for (let seed = 0; seed < 5; seed++) {
      const state = freshState(seed, 3);
      descend(state, "rooms", { kind: "relic" });
      expect(state.rooms.some((r) => r.danger === true), `seed=${seed}`).toBe(false);
    }
  });

  it("危険の部屋を作れなかった階は銭で代える", () => {
    const state = freshState(3, 2);
    state.rooms = state.rooms.slice(0, 1);
    const before = state.economy.earned.floor;
    applyExitArrival(state, { kind: "danger" });
    expect(state.rooms.some((r) => r.danger === true)).toBe(false);
    expect(state.economy.earned.floor, "銭で代える").toBeGreaterThan(before);
  });

  it("危険な部屋の制圧報酬は倍率ぶん増える", () => {
    const state = freshState(1, 3);
    const room = state.rooms[1];
    if (!room) throw new Error("部屋が無い");
    const center = { x: 100, y: 100 };
    const items = state.floorItems.length;
    applyDangerReward(state, room, center);
    expect(state.floorItems.length, "危険でない部屋は増えない").toBe(items);
    room.danger = true;
    applyDangerReward(state, room, center);
    expect(state.floorItems.length - items, "遺物が (倍率 - 1) 個").toBe(Math.round(EXIT.dangerRewardMul) - 1);
  });
});

describe("出口の予告: 到着時の選択（階段を踏んだとき）", () => {
  const boost = 1;

  it("祝福の出口は 3 択を出す", () => {
    const state = freshState(1, 3);
    offerArrivalChoices(state, { kind: "boon", lineage: "moon" }, boost);
    expect(state.boonChoice, "祝福の 3 択").not.toBeNull();
    expect(state.boonChoice?.mode, "錬磨ではない").toBeUndefined();
  });

  it("祝福以外の出口・予告なし（none）の出口では 3 択が出ない", () => {
    for (const reward of [{ kind: "relic" }, { kind: "coins" }, { kind: "danger" }, { kind: "key" }, NO_EXIT] as const) {
      const state = freshState(1, 3);
      offerArrivalChoices(state, reward, 0);
      expect(state.boonChoice, `${reward.kind} では 3 択なし`).toBeNull();
    }
  });

  it("予告の無い階段（分岐路に無い階段）は今までどおり 3 択を出す", () => {
    const state = freshState(1, 3);
    offerArrivalChoices(state, undefined, boost);
    expect(state.boonChoice).not.toBeNull();
  });

  it("芯の提示の階は祝福の出口を選ばなくても芯の 3 択を出す", () => {
    const state = freshState(1, BOON.coreDepth);
    offerArrivalChoices(state, { kind: "coins" }, 0);
    expect(state.boonChoice?.core, "芯の提示").toBe(true);
  });

  it("錬磨の出口は錬磨の提示を開く", () => {
    const state = freshState(1, 3);
    giveGradedBoon(state);
    expect(canTemper(state), "前提: 錬磨できる").toBe(true);
    offerArrivalChoices(state, { kind: "temper" }, 0);
    expect(state.boonChoice?.mode).toBe("temper");
    expect(state.boonRun.temperQueued, "積みは残らない").toBe(0);
  });

  it("錬磨できる札が無い間は積んだまま持ち越し、できるようになった階で 1 回開く", () => {
    const state = freshState(1, 3);
    state.boonRun.temperQueued = 2;
    offerArrivalChoices(state, { kind: "relic" }, 0);
    expect(state.boonChoice, "錬磨できない").toBeNull();
    expect(state.boonRun.temperQueued, "積んだまま").toBe(2);
    giveGradedBoon(state);
    offerArrivalChoices(state, { kind: "relic" }, 0);
    expect(state.boonChoice?.mode, "開いた").toBe("temper");
    expect(state.boonRun.temperQueued, "残りは次の階").toBe(1);
  });

  it("祝福の 3 択が開いた階では錬磨を後回しにする（3 択が先）", () => {
    const state = freshState(1, 3);
    giveGradedBoon(state);
    state.boonRun.temperQueued = 1;
    offerArrivalChoices(state, { kind: "boon", lineage: "ash" }, 0);
    expect(state.boonChoice?.mode, "祝福の 3 択が先").toBeUndefined();
    expect(state.boonRun.temperQueued, "錬磨は積んだまま").toBe(1);
  });

  it("階段を踏むと、その階段の報酬で降りた階が確定し、選択が開く", () => {
    const state = freshState(2, 2);
    const room = state.rooms[0];
    if (!room) throw new Error("部屋が無い");
    const c = { x: Math.floor(room.rect.x + room.rect.w / 2), y: Math.floor(room.rect.y + room.rect.h / 2) };
    const tile = toIndex(state.map, c.x, c.y);
    state.map.tiles[tile] = Tile.StairsDown;
    state.stairs = [{ tile, nextKind: "rooms", reward: { kind: "boon", lineage: "thunder" } }];
    state.player.body.pos = { x: (c.x + 0.5) * TILE_SIZE, y: (c.y + 0.5) * TILE_SIZE };
    state.enemies = [];
    updateRooms(state, FIXED_DT);
    expect(state.depth, "降りた").toBe(3);
    expect(state.boonChoice, "祝福の出口で 3 択").not.toBeNull();
    expect(state.pendingExit, "持ち越さない").toBeNull();
  });

  it("祝福以外の階段を踏むと 3 択は出ない", () => {
    const state = freshState(2, 2);
    const room = state.rooms[0];
    if (!room) throw new Error("部屋が無い");
    const c = { x: Math.floor(room.rect.x + room.rect.w / 2), y: Math.floor(room.rect.y + room.rect.h / 2) };
    const tile = toIndex(state.map, c.x, c.y);
    state.map.tiles[tile] = Tile.StairsDown;
    state.stairs = [{ tile, nextKind: "rooms", reward: { kind: "coins" } }];
    state.player.body.pos = { x: (c.x + 0.5) * TILE_SIZE, y: (c.y + 0.5) * TILE_SIZE };
    state.enemies = [];
    updateRooms(state, FIXED_DT);
    expect(state.depth, "降りた").toBe(3);
    // 深度 3 は芯の階（BOON.coreDepth = 2）ではない
    expect(BOON.coreDepth, "前提: 芯の階ではない").toBeLessThan(state.depth);
    expect(state.boonChoice, "銭の出口では 3 択なし").toBeNull();
  });
});

describe("出口の予告: 表示の名前と色", () => {
  it("祝福は系譜名を添え、予告の無い階段は名前も色も無い", () => {
    expect(exitLabel({ kind: "boon", lineage: "ash" })).toBe("祝福 灰燼");
    expect(exitLabel({ kind: "temper" })).toBe("錬磨");
    expect(exitLabel(NO_EXIT)).toBe("");
    expect(exitColor(NO_EXIT), "none は色なし").toBeNull();
    expect(exitColor(undefined), "未設定は色なし").toBeNull();
    expect(exitColor({ kind: "danger" })).toBe(EXIT.colors.danger);
  });
});
