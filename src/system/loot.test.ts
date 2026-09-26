import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { rectCenterPx } from "../map/grid";
import { createGame } from "../core/game";
import { LOOT_DROP, PICKUP, STASH_CAPACITY } from "../data/tuning";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { AIM_STICK_DISTANCE } from "../core/gamepad";
import { addToStash } from "../loot/profile";
import type { Item } from "../loot/types";
import {
  aimWorldOf,
  byDepth,
  dropBonusReward,
  dropDepthReward,
  dropItem,
  dropRoomReward,
  dropSkillStone,
  enemyDropChance,
  focusedDrop,
  roomClearDropChance,
  updateDropInteract,
  updateFloorItems,
} from "./loot";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { enemyDef } from "../data/enemies";
import { ROAMING_ROOM } from "./spawner";

function makeStashFiller(id: number): Item {
  return {
    id: `filler-${id}`,
    seed: id,
    baseKey: "shortsword",
    slot: "mainHand",
    rarity: "normal",
    itemLevel: 1,
    name: "Shortsword",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: 0,
  };
}

/** 世界座標をカーソル位置（画面座標）に直す（screenToWorld の逆） */
function screenOf(state: GameState, world: Vec): Vec {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: world.x + ox, y: world.y + oy };
}

/** プレイヤーから (dx, dy) の位置に遺物を 1 個置く */
function placeItem(state: GameState, dx: number, dy = 0): { id: number; item: Item; pos: Vec } {
  const item = dropItem(state, state.player.body.pos);
  const fi = state.floorItems[state.floorItems.length - 1]!;
  const p = state.player.body.pos;
  fi.pos = { x: p.x + dx, y: p.y + dy };
  return { id: fi.id, item, pos: fi.pos };
}

function interactAt(state: GameState, world: Vec | null): void {
  updateDropInteract(state, withInput({ interactPressed: true, aimScreen: world === null ? null : screenOf(state, world) }));
}

describe("装備ドロップと拾得", () => {
  it("落とした遺物は floorItems に入り、触れても拾わない", () => {
    const state = arena();
    const p = state.player.body.pos;
    dropItem(state, { x: p.x + 40, y: p.y });
    expect(state.floorItems).toHaveLength(1);
    expect(state.sfx.some((s) => s === "lootDrop" || s === "lootRare")).toBe(true);

    const fi = state.floorItems[0]!;
    state.player.body.pos = { ...fi.pos };
    updateFloorItems(state, 1);
    step(state, withInput({}), FIXED_DT);
    expect(state.floorItems, "触れただけでは床に残る").toHaveLength(1);
  });

  it("カーソルを合わせてインタラクトすると stash に入る", () => {
    const state = arena();
    const { item, pos } = placeItem(state, 20);
    state.sfx = [];
    interactAt(state, pos);
    expect(state.floorItems, "床から消える").toHaveLength(0);
    expect(state.profile.stash.map((it) => it.id), "倉庫に入る").toContain(item.id);
    expect(state.sfx.some((s) => s === "pickup" || s === "lootRare"), "拾得音").toBe(true);
    expect(state.texts.some((t) => t.text === item.name), "名前の浮き文字").toBe(true);
  });

  it("インタラクトを押していなければ注目していても拾わない", () => {
    const state = arena();
    const { pos } = placeItem(state, 20);
    updateDropInteract(state, withInput({ aimScreen: screenOf(state, pos) }));
    expect(state.floorItems).toHaveLength(1);
  });

  it("step 経由でもインタラクトで拾える（リプレイと同じ経路）", () => {
    const state = arena();
    const { item, pos } = placeItem(state, 20);
    step(state, withInput({ interactPressed: true, aimScreen: screenOf(state, pos) }), FIXED_DT);
    expect(state.profile.stash.map((it) => it.id)).toContain(item.id);
  });

  it("注目は照準から focusRadius 以内で最も近いもの。外れていれば注目しない", () => {
    const state = arena();
    const near = placeItem(state, 20);
    const far = placeItem(state, 20 + PICKUP.focusRadius * 3);
    const aim = { x: near.pos.x + 2, y: near.pos.y };
    expect(aimWorldOf(state, screenOf(state, aim)), "画面座標と世界座標が往復する").toEqual(aim);
    expect(focusedDrop(state, aim)?.id, "照準に近い方").toBe(near.id);
    expect(focusedDrop(state, { x: far.pos.x - 1, y: far.pos.y })?.id, "もう一方").toBe(far.id);
    const outside = { x: near.pos.x, y: near.pos.y + PICKUP.focusRadius + 1 };
    expect(focusedDrop(state, outside), "半径の外").toBeNull();
  });

  it("プレイヤーから reach より遠いものは注目できても拾えない", () => {
    const state = arena();
    const { pos } = placeItem(state, PICKUP.reach + 10);
    const focus = focusedDrop(state, pos);
    expect(focus, "注目はする").not.toBeNull();
    expect(focus?.inReach, "手が届かない").toBe(false);
    interactAt(state, pos);
    expect(state.floorItems, "拾えず床に残る").toHaveLength(1);
    expect(state.profile.stash).toHaveLength(0);
  });

  it("照準が無い（パッドの右スティック中立）ときは手の届く範囲で最も近いものを拾う", () => {
    const state = arena();
    const near = placeItem(state, 10);
    placeItem(state, 30);
    expect(focusedDrop(state, null)?.id).toBe(near.id);
    interactAt(state, null);
    expect(state.profile.stash.map((it) => it.id)).toContain(near.item.id);
    expect(state.floorItems).toHaveLength(1);
  });

  it("照準が手の届く距離より遠く、その先に何も無ければ、照準への線の近くで手の届くものを拾う（パッドの照準点は reach より遠い）", () => {
    const state = arena();
    const near = placeItem(state, 20);
    const p = state.player.body.pos;
    const stickAim = { x: p.x + AIM_STICK_DISTANCE, y: p.y + 4 };
    expect(focusedDrop(state, stickAim)?.id, "線の近くの手の届くもの").toBe(near.id);
    interactAt(state, stickAim);
    expect(state.profile.stash.map((it) => it.id)).toContain(near.item.id);
  });

  it("照準の先にあるものは、手前の線上のものより優先して注目する。照準が近ければ線はたどらない", () => {
    const state = arena();
    placeItem(state, 20);
    const far = placeItem(state, AIM_STICK_DISTANCE);
    const p = state.player.body.pos;
    expect(focusedDrop(state, { x: p.x + AIM_STICK_DISTANCE, y: p.y })?.id, "照準の先").toBe(far.id);
    const other = arena();
    placeItem(other, 20, PICKUP.focusRadius + 4);
    const q = other.player.body.pos;
    expect(focusedDrop(other, { x: q.x + 30, y: q.y }), "照準が手の届く距離なら線をたどらない").toBeNull();
  });

  it("スキル石もインタラクトでスキル倉庫に入る", () => {
    const state = arena();
    const before = state.skills.profile.stones.length;
    const stone = dropSkillStone(state, state.player.body.pos);
    const fs = state.skills.floorStones[0]!;
    fs.pos = { x: state.player.body.pos.x + 16, y: state.player.body.pos.y };
    const focus = focusedDrop(state, fs.pos);
    expect(focus?.kind, "石を注目する").toBe("stone");
    interactAt(state, fs.pos);
    expect(state.skills.floorStones).toHaveLength(0);
    expect(state.skills.profile.stones).toHaveLength(before + 1);
    expect(state.skills.profile.stones.map((s) => s.id)).toContain(stone.id);
  });

  it("stash が満杯だと拾えず「倉庫が満杯」を表示し、床に残る", () => {
    const state = arena();
    for (let i = 0; i < STASH_CAPACITY; i++) addToStash(state.profile, makeStashFiller(i));
    const { pos } = placeItem(state, 20);
    interactAt(state, pos);
    expect(state.floorItems).toHaveLength(1);
    expect(state.profile.stash).toHaveLength(STASH_CAPACITY);
    expect(state.texts.some((t) => t.text === "倉庫が満杯")).toBe(true);
    expect(state.log.some((l) => l.text.includes("倉庫が満杯"))).toBe(true);
  });

  it("ハート（消耗品系）は従来どおり触れて拾う", () => {
    const state = arena();
    state.player.hp = 1;
    state.pickups.push({ id: 999, kind: "heart", pos: { ...state.player.body.pos }, radius: 6, bobTime: 0 });
    step(state, withInput({}), FIXED_DT);
    expect(state.pickups, "触れただけで消える").toHaveLength(0);
    expect(state.player.hp, "回復する").toBeGreaterThan(1);
  });

  it("部屋を制圧すると制圧の音が鳴る（報酬は深度別の確率）", () => {
    const state = createGame(11);
    const room = state.rooms[1]!;
    state.player.body.pos = rectCenterPx(room.rect);
    step(state, withInput({}), FIXED_DT);
    for (const e of state.enemies) if (e.roomIndex === 1) e.hp = 0;
    step(state, withInput({}), FIXED_DT);
    expect(room.cleared).toBe(true);
    expect(state.sfx).toContain("roomClear");
  });

  it("階層を降りると LOOT_DROP.depthArrivalChance でボーナスが落ちる", async () => {
    const { descend } = await import("./floor");
    // seed 11 は着いた階が入れ替え部屋（invertHall）等で始めから遺物を置くため、統合チェックには使わない
    const state = createGame(1);
    descend(state);
    expect(state.floorItems.length, "多くても 1 個").toBeLessThanOrEqual(1);
    expect(state.sfx).toContain("descend");
    const trials = arena(9);
    let dropped = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      trials.floorItems = [];
      dropDepthReward(trials);
      dropped += trials.floorItems.length;
    }
    expect(Math.abs(dropped / TRIALS - LOOT_DROP.depthArrivalChance), "実測の確率").toBeLessThan(0.04);
  });

  it("同じ seed ならドロップ内容（id / foundAt 以外）が一致する", () => {
    const roll = (): string => {
      const state = arena(42);
      for (let i = 0; i < 5; i++) dropItem(state, state.player.body.pos);
      return state.floorItems.map((fi) => `${fi.item.seed}:${fi.item.rarity}:${fi.item.name}`).join(",");
    };
    expect(roll()).toBe(roll());
  });
});

describe("ドロップ率（深度別。通常敵は絞り、強敵は維持）", () => {
  const TRIALS = 4000;
  /** 確率の実測に許すずれ */
  const TOLERANCE = 0.04;

  it("byDepth は添字 0 = 深度 1、表より深ければ最後の値", () => {
    const table = [0.1, 0.2, 0.3] as const;
    expect(byDepth(table, 1)).toBe(0.1);
    expect(byDepth(table, 3)).toBe(0.3);
    expect(byDepth(table, 12), "表より深い").toBe(0.3);
    expect(byDepth(table, 0), "0 以下は深度 1").toBe(0.1);
    expect(byDepth([], 5), "空の表は 1").toBe(1);
  });

  it("通常敵のドロップ確率は深度別の倍率で絞られる（深度 1〜3 は特に低い）", () => {
    for (const depth of [1, 2, 3, 4, 8]) {
      const state = arena();
      state.depth = depth;
      const e = placeEnemy(state, "slime", 20);
      const base = enemyDef("slime").dropChance + depth * LOOT_DROP.depthChanceBonus;
      const mul = byDepth(LOOT_DROP.mobDropMulByDepth, depth);
      expect(enemyDropChance(state, e), `深度 ${depth}`).toBeCloseTo(base * mul);
      expect(mul, `深度 ${depth} は旧より 40% 以上低い`).toBeLessThanOrEqual(0.6);
    }
    expect(byDepth(LOOT_DROP.mobDropMulByDepth, 1), "深度 1 が最も絞られる").toBeLessThan(byDepth(LOOT_DROP.mobDropMulByDepth, 4));
  });

  it("徘徊・増援の通常敵は LOOT_DROP.roamingDropMul でさらに絞られ、エリートは絞らない", () => {
    const state = arena();
    const placed = placeEnemy(state, "slime", 20);
    const roamer = placeEnemy(state, "slime", 40);
    roamer.roomIndex = ROAMING_ROOM;
    expect(enemyDropChance(state, roamer), "徘徊").toBeCloseTo(enemyDropChance(state, placed) * LOOT_DROP.roamingDropMul);
    expect(LOOT_DROP.roamingDropMul, "通常より低い").toBeLessThan(1);
    const eliteRoamer = placeEnemy(state, "slime", 60);
    eliteRoamer.roomIndex = ROAMING_ROOM;
    eliteRoamer.elite = "hasted";
    expect(enemyDropChance(state, eliteRoamer), "徘徊のエリートは徘徊の倍率を受けない").toBeCloseTo(
      (enemyDef("slime").dropChance + LOOT_DROP.depthChanceBonus) * LOOT_DROP.eliteDropMul,
    );
  });

  it("エリートは eliteDropMul（通常敵より高い）、確定ドロップの敵（巣窟の主）は絞らない", () => {
    const state = arena();
    const elite = placeEnemy(state, "slime", 20);
    elite.elite = "hasted";
    const base = enemyDef("slime").dropChance + LOOT_DROP.depthChanceBonus;
    expect(enemyDropChance(state, elite), "エリート").toBeCloseTo(base * LOOT_DROP.eliteDropMul);
    expect(LOOT_DROP.eliteDropMul, "エリートは通常敵より出やすい").toBeGreaterThan(byDepth(LOOT_DROP.mobDropMulByDepth, 1));
    const lair = placeEnemy(state, "mimic", 40);
    expect(enemyDropChance(state, lair), "巣窟の主は確定").toBeGreaterThanOrEqual(1);
  });

  it("部屋制圧の報酬は深度別の確率で落ちる", () => {
    for (const depth of [1, 3, 6]) {
      const state = arena(7);
      state.depth = depth;
      let dropped = 0;
      for (let i = 0; i < TRIALS; i++) {
        state.floorItems = [];
        dropRoomReward(state, state.player.body.pos);
        dropped += state.floorItems.length;
      }
      const expected = roomClearDropChance(depth);
      expect(expected, `深度 ${depth} は必ずではない`).toBeLessThan(1);
      expect(Math.abs(dropped / TRIALS - expected), `深度 ${depth} の実測`).toBeLessThan(TOLERANCE);
    }
    expect(roomClearDropChance(1), "浅いほど出にくい").toBeLessThan(roomClearDropChance(6));
  });

  it("特別な報酬（dropBonusReward）は必ず 1 個落ちる", () => {
    const state = arena();
    for (let i = 0; i < 20; i++) dropBonusReward(state, state.player.body.pos);
    expect(state.floorItems).toHaveLength(20);
  });
});
