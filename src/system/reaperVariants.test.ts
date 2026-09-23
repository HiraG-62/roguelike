import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { GameState, Reaper } from "../core/state";
import { dist } from "../core/vec";
import { REAPER } from "../data/tuning";
import { BOONS } from "./boonDefs";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { spawnReaper, updateReaper } from "./reaper";
import { chooseReaperVariant, reaperBodyVisible } from "./reaperVariants";
import { arena } from "./testHelpers";

const V = REAPER.variants;

function withReaper(state: GameState): Reaper {
  spawnReaper(state);
  const r = state.reaper;
  if (!r) throw new Error("no reaper");
  return r;
}

function tick(state: GameState, n = 1): void {
  for (let i = 0; i < n; i++) {
    updateReaper(state, FIXED_DT);
    state.player.invulnTimer = 0;
  }
}

function cursedBoonKey() {
  const def = Object.values(BOONS).find((d) => d.cursed);
  if (!def) throw new Error("呪い付きの祝福が無い");
  return def.key;
}

describe("死神のバリアントの抽選", () => {
  it("浅い階は既定、深度 7 から鎖、深度 12 から双子", () => {
    const state = arena();
    state.depth = 1;
    expect(chooseReaperVariant(state)).toBe("default");
    state.depth = V.chain.minDepth;
    expect(chooseReaperVariant(state)).toBe("chain");
    state.depth = V.twin.minDepth;
    expect(chooseReaperVariant(state)).toBe("twin");
  });

  it("暗闇は影、死神の友は静か、呪い付きの祝福を持つと取り立て屋（優先の高い順）", () => {
    const state = arena();
    state.floorKind = "dark";
    expect(chooseReaperVariant(state)).toBe("shadow");
    state.floorKind = "rooms";
    state.origin = "reaperFriend";
    expect(chooseReaperVariant(state)).toBe("silent");
    state.boons = [cursedBoonKey()];
    expect(chooseReaperVariant(state)).toBe("collector");
  });
});

describe("鎖の死神", () => {
  it("間隔ごとに予告線を出して止まり、鎖が当たると引き寄せられる", () => {
    const state = arena();
    state.depth = V.chain.minDepth;
    const r = withReaper(state);
    expect(r.variant).toBe("chain");
    r.pos = { x: state.player.body.pos.x + 100, y: state.player.body.pos.y };
    r.timer = 0;
    tick(state);
    expect(r.charging, "予告の溜め").toBeGreaterThan(0);
    expect(r.aim).toBeDefined();
    const hp = state.player.hp;
    tick(state, Math.ceil(V.chain.charge / FIXED_DT) + 1);
    expect(state.player.hp).toBeLessThan(hp);
    expect(state.player.knock.x, "死神の方（+x）へ").toBeGreaterThan(0);
  });
});

describe("取り立て屋", () => {
  it("輪の中に留まると HP の一部を取って去り、去った後は触れても痛くない", () => {
    const state = arena();
    state.boons = [cursedBoonKey()];
    const r = withReaper(state);
    expect(r.variant).toBe("collector");
    r.pos = { x: state.player.body.pos.x + 25, y: state.player.body.pos.y };
    const hp = state.player.hp;
    tick(state, Math.ceil(V.collector.offerTime / FIXED_DT) + 2);
    expect(r.departed).toBe(true);
    expect(state.player.hp).toBe(hp - Math.floor(hp * V.collector.tollRatio));
    expect(reaperBodyVisible(r)).toBe(false);
    r.pos = { ...state.player.body.pos };
    const after = state.player.hp;
    tick(state, 5);
    expect(state.player.hp).toBe(after);
  });

  it("輪の外へ出ると待ちが消え、また追ってくる", () => {
    const state = arena();
    state.boons = [cursedBoonKey()];
    const r = withReaper(state);
    r.pos = { x: state.player.body.pos.x + 25, y: state.player.body.pos.y };
    tick(state, 10);
    expect(r.timer ?? 0).toBeGreaterThan(0);
    r.pos = { x: state.player.body.pos.x + 150, y: state.player.body.pos.y };
    const before = dist(r.pos, state.player.body.pos);
    tick(state, 10);
    expect(r.timer).toBe(0);
    expect(dist(r.pos, state.player.body.pos)).toBeLessThan(before);
  });
});

describe("双子の死神・静かな死神・影の死神", () => {
  it("双子の死神はもう 1 体いて、どちらに触れても痛い", () => {
    const state = arena();
    state.depth = V.twin.minDepth;
    const r = withReaper(state);
    expect(r.twin).toBeDefined();
    r.pos = { x: state.player.body.pos.x + 150, y: state.player.body.pos.y };
    r.twin = { ...state.player.body.pos };
    const hp = state.player.hp;
    tick(state);
    expect(state.player.hp).toBeLessThan(hp);
  });

  it("静かな死神はプレイヤーが止まっている間は近づかない", () => {
    const state = arena();
    state.origin = "reaperFriend";
    const r = withReaper(state);
    expect(r.variant).toBe("silent");
    r.pos = { x: state.player.body.pos.x + 100, y: state.player.body.pos.y };
    state.player.body.vel = { x: 0, y: 0 };
    const start = { ...r.pos };
    tick(state, 30);
    expect(dist(r.pos, start)).toBe(0);
    state.player.body.vel = { x: 60, y: 0 };
    tick(state, 30);
    expect(dist(r.pos, start)).toBeGreaterThan(0);
  });

  it("影の死神は本体を出さず、倒せる影の群れが湧き、時間で数が戻る", () => {
    const state = arena();
    state.floorKind = "dark";
    const r = withReaper(state);
    expect(reaperBodyVisible(r)).toBe(false);
    const shades = () => state.enemies.filter((e) => e.defKey === "reaperShade" && e.hp > 0);
    expect(shades().length).toBe(V.shadow.shades);
    for (const s of shades().slice(0, 2)) damageEnemy(state, s, 999_999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(shades().length).toBe(V.shadow.shades - 2);
    tick(state, Math.ceil(V.shadow.respawn / FIXED_DT) + 1);
    expect(shades().length).toBe(V.shadow.shades);
    expect(shades().every((s) => s.revived === true), "倒しても撃破数・ドロップにならない").toBe(true);
  });
});
