import { describe, expect, it } from "vitest";
import {
  JINZU_POLICIES,
  JINZU_POLICY_LABEL,
  type JinzuRunResult,
  type SurgeRecord,
  buildJinzuSection,
  measureJinzu,
  runJinzuProbe,
  summarizeJinzu,
} from "./jinzuProbe";

// @types/node が無いため process の型は自前で最小限だけ宣言する
declare const process: { env: Record<string, string | undefined> };

/** SIM_PROBE=jinzu: 試し陣を 3 方針で測って probe.md の「## 本陣と陣図」の節にする（`npm run qa:probe -- --jinzu`） */
const PROBE_JINZU = process.env.SIM_PROBE === "jinzu";
const JINZU_START = "<<<QA_PROBE_JINZU_START>>>";
const JINZU_END = "<<<QA_PROBE_JINZU_END>>>";
const PROBE_TIMEOUT_MS = 1_800_000;
const SMOKE_SEEDS = [1];
const SMOKE_SECONDS = 6;
const FULL_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

function surge(patch: Partial<SurgeRecord> = {}): SurgeRecord {
  return { raisedAt: 5, strokes: 5, brokeAt: null, brokeSec: null, charged: true, hits: 0, damage: 0, otherHits: 0, strokesHit: 0, strokesMissed: 0, maxRed: 1, maxStrikers: 2, ...patch };
}

function result(surges: SurgeRecord[], patch: Partial<JinzuRunResult> = {}): JinzuRunResult {
  return { policy: "rush", seed: 1, skipped: false, surges, ending: "open", died: false, seconds: 30, ...patch };
}

describe("試し陣の計測（集計）", () => {
  it("筆が折れた割合・折れた画の中央値・総掛かりあたりの被弾を数える", () => {
    const rows = [
      result([surge({ brokeAt: 2, brokeSec: 1.8, charged: true, hits: 1, damage: 10 })]),
      result([surge({ brokeAt: 4, brokeSec: 3.4, charged: true, hits: 3, damage: 30 }), surge({ charged: true, hits: 2, damage: 20 })]),
      result([surge({ brokeAt: 1, brokeSec: 0.6, charged: false })]),
    ];
    const s = summarizeJinzu("rush", rows);
    expect(s.runs, "盤の数").toBe(3);
    expect(s.surges, "掲げの数").toBe(4);
    expect(s.brokeRate, "折れた割合").toBeCloseTo(3 / 4, 6);
    expect(s.zeroStrokeRate, "1 画目で折れた割合").toBeCloseTo(1 / 3, 6);
    expect(s.brokeAtMedian, "折れた画の中央値").toBe(2);
    expect(s.hitsPerCharge, "走りまで進んだ総掛かり 3 つの被弾").toBeCloseTo(2, 6);
    expect(s.chargedRate, "走りまで進んだ盤の割合").toBeCloseTo(2 / 3, 6);
  });

  it("測れなかった盤（skipped）は数えない。掲げが無ければ率は 0 で NaN にならない", () => {
    const s = summarizeJinzu("ignore", [result([], { skipped: true }), result([])]);
    expect(s.runs).toBe(1);
    expect(s.surges).toBe(0);
    expect(Number.isFinite(s.brokeRate)).toBe(true);
    expect(s.brokeAtMedian).toBeNull();
  });

  it("節の Markdown に NaN や Infinity が出ず、3 方針の行がある", () => {
    const summaries = JINZU_POLICIES.map((p) => summarizeJinzu(p, [result([surge()])]));
    const md = buildJinzuSection(summaries, [1]);
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(md.startsWith("## 本陣と陣図")).toBe(true);
    for (const p of JINZU_POLICIES) expect(md, `${p} の行`).toContain(`| ${JINZU_POLICY_LABEL[p]} |`);
  });
});

describe("試し陣の計測（短い実行）", () => {
  it("同じ seed・方針で回すと同じ結果になる（決定性）", () => {
    const a = runJinzuProbe("ignore", 1, SMOKE_SECONDS);
    const b = runJinzuProbe("ignore", 1, SMOKE_SECONDS);
    expect(b).toEqual(a);
  });

  it("3 方針とも回り、置いた盤の秒数は上限以内", () => {
    const { summaries, results } = measureJinzu(SMOKE_SEEDS, SMOKE_SECONDS);
    expect(summaries.map((s) => s.policy), "方針の順").toEqual([...JINZU_POLICIES]);
    for (const r of results) expect(r.seconds, `seed ${r.seed} ${r.policy}`).toBeLessThanOrEqual(SMOKE_SECONDS + 0.1);
  });
});

describe("試し陣の計測（重い版, SIM_PROBE=jinzu）", () => {
  it.runIf(PROBE_JINZU)(
    "鶴翼の本陣を 3 方針 × seed 16 で測って表にする",
    () => {
      const { summaries } = measureJinzu(FULL_SEEDS);
      // scripts/qa-probe.mjs がこのマーカー間を抜き出して src/qa/probe.md の「## 本陣と陣図」節を差し替える
      console.log(JINZU_START);
      console.log(buildJinzuSection(summaries, FULL_SEEDS));
      console.log(JINZU_END);
      for (const s of summaries) expect(s.runs, `${s.policy} の測れた盤`).toBeGreaterThan(0);
    },
    PROBE_TIMEOUT_MS,
  );
});
