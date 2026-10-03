import { describe, expect, it } from "vitest";
import type { DamageTapEntry, DamageTapKind } from "../core/state";
import { DOJO } from "../data/tuning";
import { createDojoMeter, dojoMeterSnapshot, recordDojoDamage, recordDojoKills, recordDojoTaken } from "./dojoMeter";

function hit(amount: number, kind: DamageTapKind = "melee", crit = false): DamageTapEntry {
  return { amount, kind, crit, enemyId: 1 };
}

describe("稽古の間の計測", () => {
  it("合計・命中数・会心・最大・内訳を数える", () => {
    const m = createDojoMeter();
    recordDojoDamage(m, [hit(10), hit(30, "skill", true), hit(5, "dot")], 0);
    recordDojoDamage(m, [hit(20, "ranged"), hit(1, "other")], 1);
    const v = dojoMeterSnapshot(m, 1);
    expect(v.total).toBe(66);
    expect(v.hits).toBe(5);
    expect(v.crits).toBe(1);
    expect(v.maxHit).toBe(30);
    expect(v.byKind).toEqual({ melee: 10, ranged: 20, skill: 30, dot: 5, other: 1 });
  });

  it("経過は最初の命中から数え、毎秒の傷は合計 ÷ 経過", () => {
    const m = createDojoMeter();
    expect(dojoMeterSnapshot(m, 5).elapsed, "命中の前は時計が動かない").toBe(0);
    recordDojoDamage(m, [hit(10)], 5);
    recordDojoDamage(m, [hit(10)], 6);
    const v = dojoMeterSnapshot(m, 7);
    expect(v.elapsed).toBeCloseTo(2, 6);
    expect(v.dps).toBeCloseTo(10, 6);
  });

  it("直近の毎秒の傷は窓の内の命中だけを窓の秒で割る", () => {
    const m = createDojoMeter();
    recordDojoDamage(m, [hit(100)], 0);
    const later = DOJO.meterWindowSec + 0.5;
    recordDojoDamage(m, [hit(30)], later);
    const v = dojoMeterSnapshot(m, later);
    expect(v.recentDps).toBeCloseTo(30 / DOJO.meterWindowSec, 6);
  });

  it("傷が途切れたら最後の命中で時計が止まり、次の命中から続きを数える", () => {
    const m = createDojoMeter();
    recordDojoDamage(m, [hit(10)], 0);
    recordDojoDamage(m, [hit(10)], 1);
    const idle = 1 + DOJO.meterIdleSec + 5;
    expect(dojoMeterSnapshot(m, idle).elapsed, "区切りで止まる").toBeCloseTo(1, 6);
    recordDojoDamage(m, [hit(10)], idle);
    expect(dojoMeterSnapshot(m, idle + 2).elapsed, "止まっていた間は数えない").toBeCloseTo(3, 6);
  });

  it("0 以下の傷は数えない", () => {
    const m = createDojoMeter();
    recordDojoDamage(m, [hit(0)], 0);
    const v = dojoMeterSnapshot(m, 1);
    expect(v.hits).toBe(0);
    expect(v.elapsed).toBe(0);
    expect(v.dps).toBe(0);
  });

  it("被弾と撃破を数える", () => {
    const m = createDojoMeter();
    recordDojoTaken(m, 12, 1);
    recordDojoTaken(m, 3, 1);
    recordDojoKills(m, 2);
    const v = dojoMeterSnapshot(m, 0);
    expect(v.taken).toBe(15);
    expect(v.takenHits).toBe(2);
    expect(v.kills).toBe(2);
  });
});
