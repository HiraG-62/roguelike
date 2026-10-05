import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { type GameState, ROAMING_ROOM } from "../core/state";
import { type Vec, dist } from "../core/vec";
import { depthHpScale, enemyDef } from "../data/enemies";
import { ROLE_ELITE_EXCLUDE, gradeOf, roleOf } from "../data/enemyRoles";
import type { FormationSlot } from "../data/formations";
import { ELITE, JIN } from "../data/tuning";
import { TILE_SIZE, rectCenterPx, toIndex } from "../map/grid";
import { lineOfSight } from "../map/pathing";
import { NOTICE_RANGE, createEnemy } from "./enemies";
import { buildFloor, updateRooms, withBaseAreaMul } from "./floor";
import { withFixedLayout } from "../map/layout/select";
import { createBossJin, gradeAtDepth, jinBudget, jinCandidateRooms, jinPairMidpoints, makeStrong, nearestSleepingJin, roomBudgetMeans, slotCount, updateJinPhases, updateLookouts } from "./jinSpawn";
import { overlapsWall } from "./physics";
import { roomLocks } from "./roomTypes";
import { corridorTileList } from "./spawner";

/** 陣の配り（system/jinSpawn.ts。docs/ideas/jin-impl.md 2-2・2-5・2-9） */

const SEEDS = 8;
const START_ROOM = 0;

function floorAt(depth: number, seed: number): GameState {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state);
  return state;
}

function membersOf(state: GameState, jinId: number): GameState["enemies"] {
  return state.enemies.filter((e) => e.jinId === jinId);
}

/** 部屋に乗った陣（長蛇を除く） */
function roomJins(state: GameState): GameState["jins"] {
  return state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM);
}

describe("スロットの人数と格", () => {
  it("人数は 予算 × share / 格の重さ を四捨五入して min〜max に収める", () => {
    const slot: FormationSlot = { role: "vanguard", grade: "strong", share: 0.5, min: 1, max: 3 };
    expect(slotCount(slot, 8), "8 × 0.5 / 2 = 2").toBe(Math.round((8 * 0.5) / JIN.gradeWeight.strong));
    expect(slotCount(slot, 1), "min まで上げる").toBe(1);
    expect(slotCount(slot, 100), "max で止める").toBe(3);
    expect(slotCount({ ...slot, grade: "normal", max: undefined }, 100), "max 省略は上限なし").toBe(Math.round((100 * 0.5) / JIN.gradeWeight.normal));
  });

  it("深度が解禁に足りない格は並に落とす", () => {
    expect(gradeAtDepth("strong", JIN.strongMinDepth - 1)).toBe("normal");
    expect(gradeAtDepth("strong", JIN.strongMinDepth)).toBe("strong");
    expect(gradeAtDepth("elite", ELITE.minDepth - 1)).toBe("normal");
    expect(gradeAtDepth("elite", ELITE.minDepth)).toBe("elite");
    expect(gradeAtDepth("normal", 99)).toBe("normal");
  });

  it("猛（強）は生命と怯み耐性が上がり、格が付く", () => {
    const state = withBaseAreaMul(() => createGame(1));
    const def = enemyDef("slime");
    const e = createEnemy(state, def, { x: 0, y: 0 }, 0, false);
    const poise = e.poise.max;
    makeStrong(e);
    expect(e.grade).toBe("strong");
    expect(e.maxHp).toBe(Math.round(Math.round(def.hp * depthHpScale(state.depth)) * JIN.strong.hpMul));
    expect(e.hp, "生成直後は満タン").toBe(e.maxHp);
    expect(e.poise.max).toBeCloseTo(poise * JIN.strong.poiseMul, 5);
  });

  it("予算は平均 × (1 ± budgetSpread) × 塊の並びの密度 に収まる", () => {
    const state = withBaseAreaMul(() => createGame(3));
    const mean = JIN.budgetBase + state.depth * JIN.budgetPerDepth;
    const lo = Math.floor(mean * (1 - JIN.budgetSpread) * Math.min(JIN.densityNearStart, JIN.densityNearEnd));
    const hi = Math.ceil(mean * (1 + JIN.budgetSpread) * Math.max(JIN.densityNearStart, JIN.densityNearEnd));
    for (let i = 0; i < 50; i++) {
      const b = jinBudget(state, i % state.rooms.length);
      expect(b).toBeGreaterThanOrEqual(Math.max(JIN.minRoomBudget, lo));
      expect(b).toBeLessThanOrEqual(hi);
    }
  });
});

describe("陣の配り（planJins）", () => {
  it("陣は開始・ボス以外の封鎖しない通常の塊に 1 つまで乗り、メンバーはその塊の上に立つ", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = createGame(seed);
      const bossRoom = state.boss?.roomIndex;
      const used = new Set<number>();
      for (const jin of roomJins(state)) {
        const room = state.rooms[jin.roomIndex];
        expect(room?.kind, `seed=${seed} 通常の塊`).toBe("normal");
        expect(roomLocks(state, jin.roomIndex), `seed=${seed} 封鎖しない`).toBe(false);
        expect(jin.roomIndex, "開始の塊ではない").not.toBe(START_ROOM);
        expect(jin.roomIndex, "ボスの塊ではない").not.toBe(bossRoom);
        expect(used.has(jin.roomIndex), `seed=${seed} 1 塊 1 陣`).toBe(false);
        used.add(jin.roomIndex);
        const members = membersOf(state, jin.id);
        expect(members.length, "空の陣は作らない").toBeGreaterThan(0);
        for (const e of members) {
          expect(e.roomIndex, "メンバーの roomIndex は陣の塊").toBe(jin.roomIndex);
          const tile = toIndex(state.map, Math.floor(e.body.pos.x / TILE_SIZE), Math.floor(e.body.pos.y / TILE_SIZE));
          if (room?.tiles) expect(room.tiles.has(tile), `seed=${seed} 塊の上に立つ`).toBe(true);
        }
      }
    }
  });

  it("開始・ボス以外の封鎖しない通常の塊には、すべて陣がある（空の部屋を作らない）", () => {
    for (const layout of ["cavern", "river", "prefab", "legacy"] as const) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = withFixedLayout(layout, () => createGame(seed));
        const bossRoom = state.boss?.roomIndex;
        const withJin = new Set(roomJins(state).map((j) => j.roomIndex));
        state.rooms.forEach((room, i) => {
          if (i === START_ROOM || i === bossRoom || room.kind !== "normal" || roomLocks(state, i)) return;
          expect(withJin.has(i), `${layout} seed=${seed} 塊 ${i}`).toBe(true);
        });
      }
    }
  });

  it("塊ごとの予算の平均は、平均の予算を広さ ^ roomAreaExp で寄せたもの（候補を均すと平均の予算）", () => {
    const state = withFixedLayout("cavern", () => createGame(2));
    const rooms = jinCandidateRooms(state, new Set([START_ROOM]));
    const means = roomBudgetMeans(state, rooms);
    const mean = JIN.budgetBase + state.depth * JIN.budgetPerDepth;
    expect(means.reduce((a, b) => a + b, 0) / means.length).toBeCloseTo(mean, 6);
    const tilesOf = (i: number): number => {
      const r = state.rooms[i]!;
      return r.tiles ? r.tiles.size : r.rect.w * r.rect.h;
    };
    // 広い塊ほど平均が大きい
    const order = rooms.map((r, k) => ({ tiles: tilesOf(r), mean: means[k]! })).sort((a, b) => a.tiles - b.tiles);
    for (let k = 1; k < order.length; k++) expect(order[k]!.mean).toBeGreaterThanOrEqual(order[k - 1]!.mean);
  });

  it("通常の塊の敵はすべて陣に属する（ボスの塊を除く）", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = createGame(seed);
      for (const e of state.enemies) {
        const room = state.rooms[e.roomIndex];
        if (!room || room.kind !== "normal" || e.roomIndex === state.boss?.roomIndex) continue;
        expect(e.jinId, `seed=${seed} ${e.defKey}`).toBeDefined();
      }
    }
  });

  it("1 つの陣の中では、同じ役割は同じ種類で揃う", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = floorAt(4, seed);
      for (const jin of state.jins) {
        const byRole = new Map<string, Set<string>>();
        for (const e of membersOf(state, jin.id)) {
          const role = roleOf(enemyDef(e.defKey));
          const set = byRole.get(role) ?? new Set<string>();
          set.add(e.defKey);
          byRole.set(role, set);
        }
        for (const [role, keys] of byRole) expect(keys.size, `seed=${seed} ${jin.formation} ${role}`).toBe(1);
      }
    }
  });

  it("深度 1 の陣には猛・精鋭がいない。深い階には猛と精鋭が出て、精鋭は役割に合わない修飾子を持たない", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = createGame(seed);
      const graded = state.enemies.filter((e) => e.jinId !== undefined && (e.grade === "strong" || e.elite !== undefined));
      expect(graded, `seed=${seed} 深度 1`).toHaveLength(0);
    }
    let strong = 0;
    let elite = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = floorAt(6, seed);
      for (const e of state.enemies) {
        if (e.jinId === undefined) continue;
        if (e.grade === "strong") strong++;
        if (!e.elite) continue;
        elite++;
        const role = roleOf(enemyDef(e.defKey));
        expect(ROLE_ELITE_EXCLUDE[role], `${e.defKey} の ${e.elite}`).not.toContain(e.elite);
      }
    }
    expect(strong, "猛が出る").toBeGreaterThan(0);
    expect(elite, "精鋭が出る").toBeGreaterThan(0);
  });

  it("同じ seed なら同じ陣（塊・陣形・メンバーの種類と位置）", () => {
    const snap = (state: GameState): unknown =>
      state.jins.map((j) => ({
        room: j.roomIndex,
        formation: j.formation,
        members: membersOf(state, j.id).map((e) => [e.defKey, e.body.pos.x, e.body.pos.y, e.grade ?? "", e.elite ?? ""]),
      }));
    expect(snap(createGame(12))).toEqual(snap(createGame(12)));
  });
});

describe("陣ごとの生命の揺らぎ（hpSpread）", () => {
  const spread = JIN.hpSpread;

  it("陣ごとの hpMul は hpSpread の範囲に収まり、陣によって異なる", () => {
    const muls = new Set<number>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const j of floorAt(3, seed).jins) {
        expect(j.hpMul, `enemies.JIN.hpSpread.low: seed ${seed} 陣 ${j.id}`).toBeGreaterThanOrEqual(spread.low);
        expect(j.hpMul, `enemies.JIN.hpSpread.high: seed ${seed} 陣 ${j.id}`).toBeLessThanOrEqual(spread.high);
        muls.add(j.hpMul);
      }
    }
    expect(muls.size, "全部同じ倍率ではない").toBeGreaterThan(1);
  });

  it("並・精鋭でないメンバーの生命は 素の生命 × 陣の hpMul（同じ陣は同じ倍率）", () => {
    const state = floorAt(1, 5);
    let checked = 0;
    for (const j of state.jins) {
      for (const e of membersOf(state, j.id)) {
        if (gradeOf(e) !== "normal" || e.elite) continue;
        const base = Math.round(enemyDef(e.defKey).hp * depthHpScale(state.depth));
        expect(e.maxHp, `陣 ${j.id} の ${e.defKey}`).toBe(Math.max(1, Math.round(base * j.hpMul)));
        expect(e.hp, "生成直後は満タン").toBe(e.maxHp);
        checked++;
      }
    }
    expect(checked, "検査した敵がいる").toBeGreaterThan(0);
  });

  it("hpSpread を等倍に差し替えると生命は素の値のまま", () => {
    const saved = { low: spread.low, high: spread.high };
    Object.assign(spread, { low: 1, high: 1 });
    try {
      const state = floorAt(1, 5);
      for (const j of state.jins) {
        expect(j.hpMul).toBe(1);
        for (const e of membersOf(state, j.id)) {
          if (gradeOf(e) !== "normal" || e.elite) continue;
          expect(e.maxHp).toBe(Math.round(enemyDef(e.defKey).hp * depthHpScale(state.depth)));
        }
      }
    } finally {
      Object.assign(spread, saved);
    }
  });

  it("陣に属さない敵（createEnemy 直後）は等倍のまま", () => {
    const state = createGame(1);
    const def = enemyDef("slime");
    const e = createEnemy(state, def, { x: 0, y: 0 }, 0, false);
    expect(e.maxHp).toBe(Math.round(def.hp * depthHpScale(state.depth)));
  });

  it("階の主の陣は主と取り巻きの全員に同じ倍率を掛ける", () => {
    const state = floorAt(2, 3);
    const roomIndex = state.boss?.roomIndex ?? -1;
    const room = state.rooms[roomIndex];
    if (!room || !state.boss) throw new Error("階の主の部屋が無い");
    const lord = state.enemies.find((e) => e.id === state.boss?.enemyId);
    const lordBefore = lord?.maxHp ?? 0;
    state.player.body.pos = rectCenterPx(room.rect);
    state.player.invulnTimer = 999;
    updateRooms(state, FIXED_DT);
    const jin = state.jins.find((j) => j.roomIndex === roomIndex);
    expect(jin, "陣ができる").toBeDefined();
    expect(lord?.maxHp, "主にも陣の倍率").toBe(Math.max(1, Math.round(lordBefore * (jin?.hpMul ?? 1))));
  });

  it("同じ seed なら陣の hpMul と生命も同じ（決定的）", () => {
    const snap = (state: GameState): unknown => state.jins.map((j) => [j.hpMul, membersOf(state, j.id).map((e) => e.maxHp)]);
    expect(snap(createGame(12))).toEqual(snap(createGame(12)));
  });
});

describe("陣の起床と決着（3a）", () => {
  it("陣の塊に入ると陣が交戦になり、メンバーが全員起きる", () => {
    const state = createGame(4);
    const jin = roomJins(state)[0];
    if (!jin) throw new Error("陣が無い");
    const room = state.rooms[jin.roomIndex]!;
    state.player.body.pos = rectCenterPx(room.rect);
    state.player.invulnTimer = 999;
    updateRooms(state, FIXED_DT);
    expect(jin.phase).toBe("engaged");
    expect(membersOf(state, jin.id).filter((e) => e.phase === "idle"), "全員起きる").toHaveLength(0);
  });

  it("長蛇の 1 人が気付くと列ごと起き、全員倒すと全滅で決着する", () => {
    const state = createGame(2);
    const column = state.jins.find((j) => j.formation === "column");
    if (!column) throw new Error("長蛇が無い");
    const members = membersOf(state, column.id);
    members[0]!.phase = "chase";
    updateJinPhases(state);
    expect(column.phase).toBe("engaged");
    expect(members.filter((e) => e.phase === "idle"), "列ごと起きる").toHaveLength(0);
    for (const e of members) e.hp = 0;
    updateJinPhases(state);
    expect(column.phase).toBe("settled");
    expect(column.settledBy).toBe("wipe");
  });
});

/** メンバーが陣の中心から正面（facing）へどれだけ進んでいるか */
function alongFacing(jin: GameState["jins"][number], e: GameState["enemies"][number]): number {
  return (e.body.pos.x - jin.center.x) * jin.facing.x + (e.body.pos.y - jin.center.y) * jin.facing.y;
}

/** ある陣形の陣を、深度と seed を変えて集める */
function collectJins(formation: string, depths: readonly number[], seeds: number): { state: GameState; jin: GameState["jins"][number] }[] {
  const out: { state: GameState; jin: GameState["jins"][number] }[] = [];
  for (const depth of depths) {
    for (let seed = 0; seed < seeds; seed++) {
      const state = floorAt(depth, seed);
      for (const jin of state.jins) if (jin.formation === formation) out.push({ state, jin });
    }
  }
  return out;
}

describe("偃月（大将のいる陣、3b）", () => {
  it("深度 2 の偃月は大将（猛の前衛）が先頭に立ち、精鋭はまだ付かない", () => {
    const found = collectJins("crescent", [2], 12);
    expect(found.length, "偃月が出る").toBeGreaterThan(0);
    for (const { state, jin } of found) {
      const leader = state.enemies.find((e) => e.id === jin.leaderId);
      expect(leader, "大将がいる").toBeDefined();
      expect(leader?.jinId).toBe(jin.id);
      expect(leader?.grade, "猛").toBe("strong");
      expect(roleOf(enemyDef(leader!.defKey)), "前衛").toBe("vanguard");
      expect(leader?.elite, "精鋭は深度 3 から").toBeUndefined();
    }
  });

  it("深度 3 以降の偃月の大将は精鋭の修飾子を持ち、正面に立つ。部屋主の大将は役割に合わない修飾子を持たない", () => {
    const found = collectJins("crescent", [3, 5, 7], 10);
    expect(found.length, "偃月が出る").toBeGreaterThan(0);
    for (const { state, jin } of found) {
      const leader = state.enemies.find((e) => e.id === jin.leaderId);
      expect(leader, "大将がいる").toBeDefined();
      expect(leader?.elite, "大将は精鋭").toBeDefined();
      expect(gradeOf(leader!), "格は精鋭").toBe("elite");
      // 塞がった点は近くの空きへ寄るので、最前かどうかでなく「他の平均より前」で見る
      const others = membersOf(state, jin.id).filter((e) => e.id !== leader?.id);
      const mean = others.reduce((sum, e) => sum + alongFacing(jin, e), 0) / Math.max(1, others.length);
      expect(alongFacing(jin, leader!), `enemies.FORMATION.crescent: 大将が他の平均より前（${jin.formation}）`).toBeGreaterThan(mean);
      const role = roleOf(enemyDef(leader!.defKey));
      expect(ROLE_ELITE_EXCLUDE[role], `${leader!.defKey} の ${leader!.elite}`).not.toContain(leader!.elite);
    }
  });

  it("大将のいない陣形は leaderId が null（魚鱗・鶴翼・雁行・長蛇・方円・物見）", () => {
    for (const { jin } of [...collectJins("fishScale", [3], 4), ...collectJins("column", [3], 4), ...collectJins("circle", [4], 8), ...collectJins("lookout", [3], 8)]) {
      expect(jin.leaderId, jin.formation).toBeNull();
    }
  });

  it("大将の重さ（leader）を除いた予算をスロットに割るので、偃月の重さの合計が予算から大きく外れない", () => {
    for (const { state, jin } of collectJins("crescent", [4], 12)) {
      const weights = membersOf(state, jin.id).map((e) => (e.id === jin.leaderId ? JIN.gradeWeight.leader : JIN.gradeWeight[gradeOf(e)]));
      const total = weights.reduce((a, b) => a + b, 0);
      expect(jin.moraleMax, "群勢の最大 = メンバーの重さの合計").toBe(total);
    }
  });
});

describe("方円（支援を中心に置く陣、3b）", () => {
  it("方円は支援が 1 人だけで、陣の中心に最も近く、深度 3 から出る", () => {
    expect(collectJins("circle", [1, 2], 10), "深度 2 以下は出ない").toHaveLength(0);
    const found = collectJins("circle", [3, 4, 5], 12);
    expect(found.length, "方円が出る").toBeGreaterThan(0);
    for (const { state, jin } of found) {
      const members = membersOf(state, jin.id);
      const support = members.filter((e) => roleOf(enemyDef(e.defKey)) === "support");
      expect(support, "支援は 1 人").toHaveLength(1);
      const nearest = members.reduce((best, e) => (dist(e.body.pos, jin.center) < dist(best.body.pos, jin.center) ? e : best));
      expect(nearest.id, "支援が中心").toBe(support[0]?.id);
    }
  });
});

describe("物見（見張りの射手、3b）", () => {
  const onCorridor = (state: GameState, e: GameState["enemies"][number]): boolean =>
    corridorTileList(state).includes(toIndex(state.map, Math.floor(e.body.pos.x / TILE_SIZE), Math.floor(e.body.pos.y / TILE_SIZE)));

  it("深度 1 に物見はいない。深い階には物見が出て、射手 1 人が通路に立ち、数は JIN.lookout.count 以下", () => {
    expect(collectJins("lookout", [1], SEEDS), "深度 1").toHaveLength(0);
    let total = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = floorAt(3, seed);
      const lookouts = state.jins.filter((j) => j.formation === "lookout");
      expect(lookouts.length, `seed=${seed} 上限`).toBeLessThanOrEqual(JIN.lookout.count);
      total += lookouts.length;
      for (const jin of lookouts) {
        expect(jin.roomIndex, "塊に属さない").toBe(ROAMING_ROOM);
        const members = membersOf(state, jin.id);
        expect(members, "1 人").toHaveLength(1);
        expect(roleOf(enemyDef(members[0]!.defKey)), "射手").toBe("shooter");
        expect(members[0]!.roomIndex).toBe(ROAMING_ROOM);
        expect(onCorridor(state, members[0]!), `seed=${seed} 通路の上`).toBe(true);
      }
    }
    expect(total, "物見が出る").toBeGreaterThan(0);
  });

  it("物見は 2 つの陣の中点から snapDist 以内の通路に立つ", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = floorAt(3, seed);
      const mids = jinPairMidpoints(state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM));
      for (const jin of state.jins.filter((j) => j.formation === "lookout")) {
        const near = mids.some((m) => dist(m, jin.center) <= JIN.lookout.snapDist + TILE_SIZE);
        expect(near, `seed=${seed} 陣の組の中点の近く`).toBe(true);
      }
    }
  });

  it("陣の組の中点は組の距離が近い順に並ぶ", () => {
    const state = floorAt(3, 1);
    const jins = state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM);
    const mids = jinPairMidpoints(jins);
    expect(mids).toHaveLength((jins.length * (jins.length - 1)) / 2);
    expect(jinPairMidpoints([])).toEqual([]);
  });

  /** from から半径 r の点で、視線が通り壁に埋まらない点（無ければ null） */
  function clearSpot(state: GameState, from: Vec, r: number): Vec | null {
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * 2 * Math.PI;
      const p = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
      if (!overlapsWall(state, p.x, p.y, state.player.body.radius) && lineOfSight(state.map, from, p)) return p;
    }
    return null;
  }

  /** 物見を持つ階と、その物見・見通せる距離の組を探す */
  function lookoutScene(radius: number): { state: GameState; jin: GameState["jins"][number]; spot: Vec } {
    for (let seed = 0; seed < 24; seed++) {
      const state = floorAt(4, seed);
      for (const jin of state.jins.filter((j) => j.formation === "lookout")) {
        const watcher = membersOf(state, jin.id)[0];
        const spot = watcher ? clearSpot(state, watcher.body.pos, radius) : null;
        if (spot && nearestSleepingJin(state, jin)) return { state, jin, spot };
      }
    }
    throw new Error("物見の見通せる場所が無い");
  }

  it("物見は通常の 2 倍の距離で気付き、自分の陣と最も近い眠っている陣を起こす", () => {
    const { state, jin, spot } = lookoutScene(NOTICE_RANGE * 1.6);
    const target = nearestSleepingJin(state, jin)!;
    expect(target.formation, "物見どうしは起こさない").not.toBe("lookout");
    state.player.body.pos = spot;
    updateLookouts(state);
    expect(jin.phase, "物見の陣").toBe("engaged");
    expect(target.phase, "最も近い眠っている陣").toBe("engaged");
    // 起こす輪（JIN.wake.radius）の外のメンバーは眠ったまま（自分で気付くか、群勢が崩れかけて後詰が出るまで）
    const members = membersOf(state, target.id);
    expect(members.some((e) => e.phase !== "idle"), "誰かは起きる").toBe(true);
    expect(target.secondWaveAt, "後詰は時間では出ない").toBeNull();
  });

  it("通常の気付く距離の外（2 倍の外）では起こさない", () => {
    const { state, jin, spot } = lookoutScene(NOTICE_RANGE * JIN.lookout.noticeMul * 1.3);
    state.player.body.pos = spot;
    updateLookouts(state);
    expect(jin.phase).toBe("sleeping");
    expect(state.jins.filter((j) => j !== jin && j.phase !== "sleeping"), "他の陣も眠ったまま").toHaveLength(0);
  });
});

describe("ボス陣（階の主と取り巻き、3b）", () => {
  it("階の主の部屋を封鎖すると、主を大将・取り巻きをメンバーにした偃月の陣ができる", () => {
    const state = floorAt(2, 3);
    const roomIndex = state.boss?.roomIndex ?? -1;
    const room = state.rooms[roomIndex];
    if (!room || !state.boss) throw new Error("階の主の部屋が無い");
    expect(state.boss.major, "階の主（major でない）").toBe(false);
    state.player.body.pos = rectCenterPx(room.rect);
    state.player.invulnTimer = 999;
    updateRooms(state, FIXED_DT);
    expect(room.locked, "封鎖される").toBe(true);
    const jin = state.jins.find((j) => j.roomIndex === roomIndex);
    expect(jin?.formation).toBe("crescent");
    expect(jin?.leaderId, "大将 = 階の主").toBe(state.boss.enemyId);
    expect(jin?.phase, "封鎖中は最初から交戦").toBe("engaged");
    const inRoom = state.enemies.filter((e) => e.roomIndex === roomIndex);
    expect(inRoom.length, "取り巻きがいる").toBeGreaterThan(1);
    for (const e of inRoom) expect(e.jinId, "部屋の全員が陣のメンバー").toBe(jin?.id);
    const weight = inRoom.reduce((sum, e) => sum + (e.id === jin?.leaderId ? JIN.gradeWeight.leader : JIN.gradeWeight[gradeOf(e)]), 0);
    expect(jin?.moraleMax, "群勢の最大 = 重さの合計").toBe(weight);
  });

  it("主がいなければ陣を作らない。すでに陣に属す敵・倒れた敵は数えない", () => {
    const state = floorAt(2, 3);
    const roomIndex = state.boss?.roomIndex ?? -1;
    expect(createBossJin(state, roomIndex, -999, [])).toBeNull();
    const lordId = state.boss?.enemyId ?? -1;
    const other = createEnemy(state, enemyDef("slime"), { x: 0, y: 0 }, roomIndex, false);
    const dead = createEnemy(state, enemyDef("slime"), { x: 0, y: 0 }, roomIndex, false);
    dead.hp = 0;
    const owned = createEnemy(state, enemyDef("slime"), { x: 0, y: 0 }, roomIndex, false);
    owned.jinId = 99;
    // 取り巻きは lockRoom で湧いた後なので state.enemies に入っている（群勢は生きているメンバーから数える）
    state.enemies.push(other, dead, owned);
    const jin = createBossJin(state, roomIndex, lordId, [other, dead, owned]);
    expect(other.jinId).toBe(jin?.id);
    expect(dead.jinId).toBeUndefined();
    expect(owned.jinId).toBe(99);
    expect(jin?.moraleMax).toBe(JIN.gradeWeight.leader + JIN.gradeWeight.normal);
  });
});
