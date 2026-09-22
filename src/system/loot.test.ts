import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { rectCenterPx } from "../map/grid";
import { createGame } from "../core/game";
import { LOOT_DROP } from "../data/tuning";
import { dropItem, updateFloorItems } from "./loot";
import { arena, withInput } from "./testHelpers";

describe("装備ドロップと拾得", () => {
  it("落としたアイテムは floorItems に入り、触れると stash に入る", () => {
    const state = arena();
    const p = state.player.body.pos;
    const item = dropItem(state, { x: p.x + 40, y: p.y });
    expect(state.floorItems).toHaveLength(1);
    expect(state.sfx.some((s) => s === "lootDrop" || s === "lootRare")).toBe(true);

    state.sfx = [];
    const fi = state.floorItems[0]!;
    state.player.body.pos = { ...fi.pos };
    // 拾得猶予中は拾わない
    updateFloorItems(state, 0);
    expect(state.floorItems).toHaveLength(1);
    updateFloorItems(state, LOOT_DROP.pickupDelay);
    expect(state.floorItems).toHaveLength(0);
    expect(state.profile.stash.map((it) => it.id)).toContain(item.id);
    expect(state.sfx.some((s) => s === "pickup" || s === "lootRare")).toBe(true);
    expect(state.texts.some((t) => t.text === item.name)).toBe(true);
  });

  it("部屋クリアで必ず 1 個落ちる", () => {
    const state = createGame(11);
    const room = state.rooms[1]!;
    state.player.body.pos = rectCenterPx(room.rect);
    step(state, withInput({}), FIXED_DT);
    for (const e of state.enemies) if (e.roomIndex === 1) e.hp = 0;
    step(state, withInput({}), FIXED_DT);
    expect(room.cleared).toBe(true);
    expect(state.floorItems.length).toBeGreaterThanOrEqual(1);
    expect(state.sfx).toContain("roomClear");
  });

  it("階層を降りるとボーナスが 1 個落ちる", async () => {
    const { descend } = await import("./floor");
    const state = createGame(11);
    descend(state);
    expect(state.floorItems).toHaveLength(1);
    expect(state.sfx).toContain("descend");
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
