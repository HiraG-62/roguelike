import { describe, expect, it } from "vitest";
import { PARRY_POSE } from "../data/tuning";
import { parryJar, parryMotion } from "./parryMotion";

const none = { raised: null, impactAge: null, slack: null } as const;

describe("parryMotion: 受け流しの時間割", () => {
  it("構えていない・決まっていない・外していなければ動かない", () => {
    expect(parryMotion(none)).toBeUndefined();
    expect(parryMotion({ ...none, impactAge: PARRY_POSE.impactSec + 0.01 })).toBeUndefined();
  });

  it("押した瞬間から raiseSec で受けの構えになり切り、体は受けの構えのコマ", () => {
    const start = parryMotion({ ...none, raised: 0 });
    expect(start?.blend).toBe(0);
    expect(start?.body).toBeNull();
    const done = parryMotion({ ...none, raised: PARRY_POSE.raiseSec });
    expect(done?.blend).toBeCloseTo(1);
    expect(done?.body).toEqual({ impact: false });
    expect(done?.push).toBe(0);
  });

  it("決まった直後は押されて衝撃のコマ、押しは減り、settleFrom の後に待機へ戻る", () => {
    const hit = parryMotion({ ...none, impactAge: 0 });
    expect(hit?.blend).toBe(1);
    expect(hit?.body).toEqual({ impact: true });
    expect(hit?.push).toBeCloseTo(PARRY_POSE.pushDots);
    expect(hit?.tilt).toBeGreaterThan(0);
    const later = parryMotion({ ...none, impactAge: PARRY_POSE.jarSec });
    expect(later?.push).toBeCloseTo(0);
    expect(later?.body).toEqual({ impact: false });
    const end = parryMotion({ ...none, impactAge: PARRY_POSE.impactSec * 0.99 });
    expect(end?.blend).toBeLessThan(0.1);
  });

  it("構えている間は前の受け流しの余韻より構えを優先する", () => {
    expect(parryMotion({ raised: PARRY_POSE.raiseSec, impactAge: 0.01, slack: null })?.push).toBe(0);
  });

  it("外した硬直は手が下がり、終わりに待機へ戻る", () => {
    const early = parryMotion({ ...none, slack: PARRY_POSE.slackHold });
    expect(early?.sag).toBeCloseTo(PARRY_POSE.sagDots);
    expect(early?.blend).toBeCloseTo(1);
    expect(parryMotion({ ...none, slack: 1 })?.blend).toBeCloseTo(0);
  });

  it("押しの残りは決まった瞬間 1 で jarSec に 0", () => {
    expect(parryJar(0)).toBe(1);
    expect(parryJar(PARRY_POSE.jarSec)).toBe(0);
    expect(parryJar(PARRY_POSE.jarSec / 2)).toBeLessThan(0.5);
  });
});
