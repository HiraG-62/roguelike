import { describe, expect, it } from "vitest";
import { REACH } from "../data/tuning";
import { REACH_DEFS } from "../loot/reach";
import { REACH_KEYS } from "../loot/types";
import {
  BROKEN_PROBE_DEPTHS,
  BROKEN_WEAPONS,
  DEEP_HIT_SEEDS,
  DEEP_POWER_SEEDS,
  DEEP_PROBE_DEPTHS,
  REACH_PROBE_DEPTHS,
  buildDeepSection,
  deepOutliers,
  measureBrokenBuild,
  measureDeepCurve,
  measureReachOdds,
  tallyKeysOf,
  type BrokenRow,
} from "./deepProbe";
import { BOON_KEYS } from "../system/boonDefs";

// @types/node が無いため process の型は自前で最小限だけ宣言する
declare const process: { env: Record<string, string | undefined> };

/** SIM_PROBE=deep: 深みの表を測って probe.md の「## 深み」の節にする（`ppnpm run qa:probe --deep`） */
const PROBE_DEEP = process.env.SIM_PROBE === "deep";
const DEEP_START = "<<<QA_PROBE_DEEP_START>>>";
const DEEP_END = "<<<QA_PROBE_DEEP_END>>>";
/** 重い版の制限時間（ms） */
const DEEP_TIMEOUT_MS = 1_800_000;

const SMOKE_DEPTHS = [21, 22];
const SMOKE_SAMPLES = 200;
const SMOKE_BROKEN_SECONDS = 2;
/** 重い版: 到達の見積もりの抽選数・壊れの計測秒・被弾の計測秒 */
const FULL_SAMPLES = 20_000;
const FULL_BROKEN_SECONDS = 20;
const FULL_HIT_SECONDS = 20;

describe("深みの曲線の表", () => {
  const curve = measureDeepCurve(SMOKE_DEPTHS, [1, 2], [1], 3);

  it("深度ごとに 1 行で、値は有限", () => {
    expect(curve.map((r) => r.depth), "指定した深度の順").toEqual(SMOKE_DEPTHS);
    for (const r of curve) {
      for (const [key, v] of Object.entries(r)) {
        if (v === null) continue;
        expect(Number.isFinite(v), `深度 ${r.depth} の ${key}`).toBe(true);
      }
    }
  });

  it("深度 21 の要る倍は 1、深みの 1 層目は深度 22 と数える", () => {
    expect(curve[0]?.needMul, "基準の深度は自分自身").toBeCloseTo(1, 5);
    expect(curve[0]?.deepFloor, "21 は深みでない").toBe(0);
    expect(curve[1]?.deepFloor, "22 は深み 1 層目").toBe(1);
  });

  it("深みでは敵の生命が地力より速く伸びる（要る倍が 1 を超える）", () => {
    const deep = measureDeepCurve([21, 30], [1, 2, 3]);
    expect(deep[1]?.needMul ?? 0, "深度 30 は深度 21 より厳しい").toBeGreaterThan(1);
  });

  it("既定の深度は 21 から 40 で、被弾の計測は指定したときだけ走る", () => {
    expect(DEEP_PROBE_DEPTHS[0]).toBe(21);
    expect(DEEP_PROBE_DEPTHS[DEEP_PROBE_DEPTHS.length - 1]).toBe(40);
    expect(curve[0]?.hitsToDie === null || (curve[0]?.hitsToDie ?? 0) > 0, "被弾の計測は正の回数か null").toBe(true);
    expect(measureDeepCurve([21], [1])[0]?.hitsToDie, "hitSeeds なし").toBeNull();
  });
});

describe("到達の届き方", () => {
  it("同じ seed で同じ割合になる（決定性）", () => {
    const a = measureReachOdds(SMOKE_DEPTHS, SMOKE_SAMPLES, 7);
    const b = measureReachOdds(SMOKE_DEPTHS, SMOKE_SAMPLES, 7);
    expect(b).toEqual(a);
  });

  it("3 つの到達 × 深度の行が出て、割合は 0〜1 に収まる", () => {
    const rows = measureReachOdds(SMOKE_DEPTHS, SMOKE_SAMPLES, 7);
    expect(rows).toHaveLength(REACH_KEYS.length * SMOKE_DEPTHS.length);
    for (const r of rows) {
      expect(r.odds, `${r.key} 深度 ${r.depth}`).toBeGreaterThanOrEqual(0);
      expect(r.odds, `${r.key} 深度 ${r.depth}`).toBeLessThanOrEqual(1);
    }
  });

  it("深いほど届きやすい（深度 21 → 40 で減らない）", () => {
    const rows = measureReachOdds([21, 40], 2000, 11);
    for (const key of REACH_KEYS) {
      const shallow = rows.find((r) => r.key === key && r.depth === 21)?.odds ?? 1;
      const deep = rows.find((r) => r.key === key && r.depth === 40)?.odds ?? 0;
      expect(deep, `${key}: 深度 40 は 21 以上`).toBeGreaterThanOrEqual(shallow);
    }
  });

  it("閾値は REACH の値から組まれる", () => {
    expect(REACH_DEFS.chain.threshold).toBe(REACH.chain);
    expect(REACH_PROBE_DEPTHS).toContain(30);
  });
});

describe("壊れたビルドの計測", () => {
  it("有限の値を返し、同じ seed なら数えた弾・敵・捨てた数が同じ", () => {
    const a = measureBrokenBuild(22, SMOKE_BROKEN_SECONDS, 1);
    const b = measureBrokenBuild(22, SMOKE_BROKEN_SECONDS, 1);
    expect(a.finite, "状態が有限").toBe(true);
    expect(Number.isFinite(a.meanStepMs) && a.meanStepMs >= 0, "平均の step 時間").toBe(true);
    expect(a.maxStepMs, "最大は平均以上").toBeGreaterThanOrEqual(a.meanStepMs);
    expect(a.maxEnemies, "敵が置かれる").toBeGreaterThan(0);
    expect(a.trimmed, "短い計測では歯止めに当たらない").toBe(0);
    expect(
      { ...b, meanStepMs: 0, p99StepMs: 0, maxStepMs: 0 },
      "時間以外の数は決定的",
    ).toEqual({ ...a, meanStepMs: 0, p99StepMs: 0, maxStepMs: 0 });
  });

  it("研鑽の数えの key を札から集める（重複なし・研鑽の札の段を含む）", () => {
    const keys = tallyKeysOf(BOON_KEYS);
    expect(keys.length, "数えは 1 つ以上ある").toBeGreaterThan(0);
    expect(new Set(keys).size, "重複なし").toBe(keys.length);
  });

  it("壊れの深度は深みの中にある", () => {
    for (const d of BROKEN_PROBE_DEPTHS) expect(d, "深度 22 以上").toBeGreaterThanOrEqual(22);
  });
});

describe("probe.md の「## 深み」の節", () => {
  const curve = measureDeepCurve(SMOKE_DEPTHS, [1]);
  const odds = measureReachOdds(SMOKE_DEPTHS, SMOKE_SAMPLES, 3);
  const broken = [measureBrokenBuild(22, 1, 1)];

  it("見出しと 3 つの表を組め、NaN や Infinity が出ない", () => {
    const md = buildDeepSection(curve, odds, broken).join("\n");
    expect(md).toContain("## 深み");
    expect(md).toContain("### 曲線");
    expect(md).toContain("### 到達の届き方");
    expect(md).toContain("### 壊れたビルドの重さ");
    expect(md).not.toMatch(/NaN|Infinity/);
  });

  it("目標から外れた行を文にする（重い・切った・有限でない）", () => {
    const bad: BrokenRow = {
      weapon: "gun", depth: 40, seconds: 10, meanStepMs: 2, p99StepMs: 5, maxStepMs: 20, maxPlayerProjectiles: 300, maxShots: 10, maxPlacedPerPool: 4, maxEnemies: 30, trimmed: 5, droppedEvents: 0, finite: false,
    };
    const out = deepOutliers([], [], [bad]).join("\n");
    expect(out).toContain("1 step 平均");
    expect(out).toContain("1 step 最大");
    expect(out).toContain("歯止め");
    expect(deepOutliers([], [], [{ ...bad, meanStepMs: 0, p99StepMs: 0, maxStepMs: 0, trimmed: 0, finite: true, droppedEvents: 3 }]).join("\n"), "捨てたイベントも出す").toContain("イベントを 3 件捨てた");
    expect(out).toContain("有限でなくなった");
    expect(deepOutliers([], [], []), "何も無ければ空").toEqual([]);
  });
});

describe("深みの計測（重い版, SIM_PROBE=deep）", () => {
  it.runIf(PROBE_DEEP)(
    "曲線 × 到達 × 壊れを測って probe.md の節にする",
    () => {
      const curve = measureDeepCurve(DEEP_PROBE_DEPTHS, DEEP_POWER_SEEDS, DEEP_HIT_SEEDS, FULL_HIT_SECONDS);
      const odds = measureReachOdds(REACH_PROBE_DEPTHS, FULL_SAMPLES, 1);
      const broken = BROKEN_PROBE_DEPTHS.flatMap((d) => BROKEN_WEAPONS.map((w) => measureBrokenBuild(d, FULL_BROKEN_SECONDS, 1, w)));
      // @types/node が無くこのファイルは fs に触れられないので、標準出力に区切り付きで出す。
      // scripts/qa-probe.mjs がこのマーカー間を抜き出して src/qa/probe.md の「## 深み」の節を差し替える
      console.log(DEEP_START);
      console.log(buildDeepSection(curve, odds, broken).join("\n"));
      console.log(DEEP_END);
      const outliers = deepOutliers(curve, odds, broken);
      console.log(`[deep] 目標から外れたもの: ${outliers.length === 0 ? "なし" : ""}`);
      for (const o of outliers) console.log(`[deep] - ${o}`);
      expect(broken.every((b) => b.finite), "壊れたビルドの状態が有限").toBe(true);
    },
    DEEP_TIMEOUT_MS,
  );
});
