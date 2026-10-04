import { describe, expect, it } from "vitest";
import { ARC } from "../data/tuning";
import { BOSS_STAGE_COUNT, type BossFight } from "./bossMetrics";
import {
  FULL_BOSS_PROBE_CONFIG,
  SMOKE_BOSS_PROBE_CONFIG,
  buildBossSection,
  runBossFight,
  runBossProbe,
} from "./bossProbe";

// @types/node が無いため process の型は自前で最小限だけ宣言する
declare const process: { env: Record<string, string | undefined> };

/** SIM_PROBE=bosses: 章ボス 4 と最深の主を 1 体ずつ測る重い版（`ppnpm run qa:probe --bosses`） */
const PROBE_BOSSES = process.env.SIM_PROBE === "bosses";

const BOSSES_START = "<<<QA_PROBE_BOSSES_START>>>";
const BOSSES_END = "<<<QA_PROBE_BOSSES_END>>>";

/** 重い版の制限時間（ms）。5 体 × seed 5 × 最長 300 秒の step */
const PROBE_TIMEOUT_MS = 1_800_000;

function finiteFight(f: BossFight): boolean {
  const nums = [f.seconds, f.hits, f.downs, f.minionKills, ...f.stageSeconds, ...f.stageHits.flatMap((t) => [t.hits, t.near, t.mid, t.far, t.still, t.indirect])];
  return nums.every((n) => Number.isFinite(n) && n >= 0);
}

describe("ボスの計測（縮小版）", () => {
  const fights = runBossProbe(SMOKE_BOSS_PROBE_CONFIG);

  it("章ボス 4 と最深の主を設定どおり 1 seed ずつ測る", () => {
    const cfg = SMOKE_BOSS_PROBE_CONFIG;
    expect(fights, "ボス × seed").toHaveLength(cfg.bosses.length * cfg.seeds.length);
    expect(cfg.bosses.map((b) => b.key), "章ボスの並びは ARC.chapters、最後が最深の主").toEqual([
      ...ARC.chapters.map((c) => c.boss),
      ARC.finalBoss,
    ]);
    expect(fights.map((f) => f.key)).toEqual(cfg.bosses.map((b) => b.key));
  });

  it("どの戦いの値も有限で、段階の配列は 3 つある", () => {
    for (const f of fights) {
      expect(finiteFight(f), `${f.key} の生の数`).toBe(true);
      expect(f.stageSeconds, `${f.key} の段階ごとの秒`).toHaveLength(BOSS_STAGE_COUNT);
      expect(f.stageHits, `${f.key} の段階ごとの被弾`).toHaveLength(BOSS_STAGE_COUNT);
    }
  });

  it("ボス部屋で封鎖が起き、段階の秒の合計は決着までの秒を超えない", () => {
    for (const f of fights) {
      expect(f.outcome, `${f.key} は封鎖まで進む`).not.toBe("unlocked");
      const total = f.stageSeconds.reduce((a, b) => a + b, 0);
      expect(total, `${f.key} の段階の秒の合計`).toBeLessThanOrEqual(f.seconds + 0.5);
      expect(f.stageHits.reduce((n, t) => n + t.hits, 0), `${f.key} の段階ごとの被弾の合計は被弾の数以下`).toBeLessThanOrEqual(f.hits);
    }
  });

  it("制限時間までに決着しなければ打ち切りで、秒は制限を超えない", () => {
    for (const f of fights) {
      if (f.outcome !== "timeout") continue;
      expect(f.seconds, `${f.key} の打ち切りの秒`).toBeLessThanOrEqual(SMOKE_BOSS_PROBE_CONFIG.maxSeconds + 0.1);
    }
  });

  it("同じ設定で回すと同じ結果になる（決定性）", () => {
    const first = SMOKE_BOSS_PROBE_CONFIG.bosses[0];
    if (!first) throw new Error("ボスが無い");
    const a = runBossFight(first.key, first.depth, 1, 10);
    const b = runBossFight(first.key, first.depth, 1, 10);
    expect(b, "seed が同じなら生の数も同じ").toEqual(a);
  });

  it("Markdown の「## ボス」節に NaN や Infinity が出ない", () => {
    const md = buildBossSection(SMOKE_BOSS_PROBE_CONFIG, fights).join("\n");
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(md.startsWith("## ボス")).toBe(true);
  });
});

describe("ボスの計測（重い版, SIM_PROBE=bosses）", () => {
  it.runIf(PROBE_BOSSES)(
    "章ボス 4 と最深の主 × seed 5 を測って表にする",
    () => {
      const cfg = FULL_BOSS_PROBE_CONFIG;
      const fights = runBossProbe(cfg);
      // @types/node が無くこのファイルは fs に触れられないので、標準出力に区切り付きで出す。
      // scripts/qa-probe.mjs がこのマーカー間を抜き出して src/qa/probe.md の「## ボス」節を差し替える
      console.log(BOSSES_START);
      console.log(buildBossSection(cfg, fights).join("\n"));
      console.log(BOSSES_END);
      for (const f of fights) expect(finiteFight(f), `${f.key} seed ${f.seed} の生の数が有限`).toBe(true);
    },
    PROBE_TIMEOUT_MS,
  );
});
