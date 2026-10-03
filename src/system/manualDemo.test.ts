import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { MANUAL } from "../data/tuning";
import { buildDemoArena } from "../map/demoArena";
import { weaponManualPage } from "../meta/weaponManual";
import { type DemoScript, calibrateFoeDistance, createManualDemo, demoCueIndex, demoOutcome, stepManualDemo } from "./manualDemo";

const SWORD_CHAIN: DemoScript = { setup: {}, cues: [{ kind: "tap", button: "primary" }, { kind: "tap", button: "primary" }, { kind: "tap", button: "primary" }] };

function run(script: DemoScript, steps: number): string {
  const s = createManualDemo("sword", script);
  for (let i = 0; i < steps; i++) stepManualDemo(s, FIXED_DT);
  const p = s.state.player;
  return JSON.stringify({ x: p.body.pos.x, y: p.body.pos.y, step: p.attack.step, foe: s.state.enemies.map((e) => e.hp), loops: s.loops, rng: s.state.rng.next(), particles: s.state.particles.length });
}

describe("武器指南書の実演", () => {
  it("同じ台本なら毎回同じ動きになる（決定的）", () => {
    expect(run(SWORD_CHAIN, 90)).toBe(run(SWORD_CHAIN, 90));
  });

  it("剣の左の連撃は 3 段目まで振って木人に当たる", () => {
    const s = createManualDemo("sword", SWORD_CHAIN);
    let maxStep = -1;
    for (let i = 0; i < 200 && s.loops === 0; i++) {
      stepManualDemo(s, FIXED_DT);
      if (s.loops === 0 && s.state.player.attack.phase !== "none") maxStep = Math.max(maxStep, s.state.player.attack.step);
    }
    expect(maxStep).toBe(2);
    expect(demoOutcome("sword", SWORD_CHAIN, buildDemoArena()).hit).toBe(true);
  });

  it("手を終えて眺め終わると最初からやり直し、木人は立て直される", () => {
    const s = createManualDemo("sword", { setup: {}, cues: [{ kind: "tap", button: "primary" }] });
    for (let i = 0; i < 60 * 6 && s.loops === 0; i++) stepManualDemo(s, FIXED_DT);
    expect(s.loops).toBe(1);
    expect(demoCueIndex(s)).toBe(0);
    const foe = s.state.enemies.find((e) => e.id === s.foeId);
    expect(foe?.hp).toBe(MANUAL.foeHp);
  });

  it("下ごしらえの手の間は表示の手の添字が負", () => {
    const s = createManualDemo("sword", { setup: {}, prelude: [{ kind: "wait", sec: 0.5 }], cues: [{ kind: "tap", button: "primary" }] });
    stepManualDemo(s, FIXED_DT);
    expect(demoCueIndex(s)).toBeLessThan(0);
  });

  it("稽古場の地図はやり直しても作り直さない（描画のチャンクを焼き直させない）", () => {
    const s = createManualDemo("sword", { setup: {}, cues: [{ kind: "tap", button: "primary" }] });
    const map = s.state.map;
    for (let i = 0; i < 60 * 6 && s.loops === 0; i++) stepManualDemo(s, FIXED_DT);
    expect(s.state.map).toBe(map);
  });

  it("届かない距離では当たらず、合わせ込みで当たる距離を見つける", () => {
    const arena = buildDemoArena();
    const far: DemoScript = { ...SWORD_CHAIN, setup: { foeDistance: 160 } };
    expect(demoOutcome("sword", far, arena).hit).toBe(false);
    const d = calibrateFoeDistance("sword", far, "hit", arena);
    expect(d).toBeLessThan(160);
    expect(demoOutcome("sword", { ...far, setup: { foeDistance: d } }, arena).hit).toBe(true);
  });

  it("戦意を満たす下ごしらえで、剣の返し斬りは戦意を放つ", () => {
    const move = weaponManualPage("sword").moves.find((m) => m.key === "morale");
    expect(move).toBeDefined();
    if (move === undefined) return;
    expect(demoOutcome("sword", move.script, buildDemoArena()).release).toBe(true);
  });
});
