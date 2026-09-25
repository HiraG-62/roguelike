import { describe, expect, it } from "vitest";
import { FX_ATTACK } from "../data/tuning";
import { isBlastShape, spawnBlast, spawnRing } from "./effects";
import { arena } from "./testHelpers";

describe("spawnBlast（爆発の輪）", () => {
  it("爆発の印が付いた輪を積み、普通の輪には印が付かない", () => {
    const state = arena();
    spawnRing(state, { x: 0, y: 0 }, 20, "#ffffff", 0.3);
    spawnBlast(state, { x: 10, y: 10 }, 30, "#ffb040", 0.25);
    const [ring, blast] = state.shapes;
    expect(ring && isBlastShape(ring), "普通の輪").toBe(false);
    expect(blast && isBlastShape(blast), "爆発の輪").toBe(true);
    expect(blast?.radius).toBe(30);
  });

  it("段階を見せるため寿命は FX_ATTACK.blast.life 以上に延びる", () => {
    const state = arena();
    spawnBlast(state, { x: 0, y: 0 }, 30, "#ffb040", 0.1);
    expect(state.shapes[0]?.maxLife).toBe(FX_ATTACK.blast.life);
    spawnBlast(state, { x: 0, y: 0 }, 30, "#ffb040", FX_ATTACK.blast.life * 2);
    expect(state.shapes[1]?.maxLife, "長い寿命はそのまま").toBe(FX_ATTACK.blast.life * 2);
  });

  it("ゲームの乱数（state.rng）を消費しない", () => {
    const a = arena(11);
    const b = arena(11);
    spawnBlast(a, { x: 0, y: 0 }, 30, "#ffb040");
    expect(a.rng.next()).toBe(b.rng.next());
    expect(a.particles.length, "火の粉").toBe(FX_ATTACK.blast.embers);
  });
});
