import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARRY } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { createEmptyProfile, type Slot } from "../loot/types";
import {
  autoEquip,
  buildGearReport,
  buildRunProfile,
  GEAR_SWAP_MARGIN,
  gearPatterns,
  type GearRunRecord,
  type GearSummary,
  meanInterval,
  pairedDelta,
  pickEquip,
  quantile,
  runGearOnce,
  selectPatterns,
  standardCarry,
  summarizeAll,
} from "./gearMatrix";
import { arena } from "../system/testHelpers";

/**
 * 装備パターンの行列（src/qa/gearMatrix.ts）。既定の vitest では純関数と短いランだけを確かめる。
 * scripts/qa-gear.mjs が SIM_GEAR を付けて呼ぶと:
 * - SIM_GEAR=run: GEAR_SHARD / GEAR_SHARDS で分けた分のランを回し、1 ランごとに JSON を 1 行 GEAR_OUT へ足す
 *   （vitest は console 出力をテストの終わりまで溜めるので、途中で止まっても記録が残り進み具合も見えるようファイルへ書く）
 * - SIM_GEAR=report: GEAR_RUNS（全ランの JSON）と GEAR_PREV（前回の集計）を読み、REPORT / SUMMARY のマーカー間に書き出す
 */

const MODE = process.env.SIM_GEAR;
const REPORT_START = "<<<GEAR_REPORT_START>>>";
const REPORT_END = "<<<GEAR_REPORT_END>>>";
const SUMMARY_START = "<<<GEAR_SUMMARY_START>>>";
const SUMMARY_END = "<<<GEAR_SUMMARY_END>>>";
/** seed の列の始まり（フル QA の 50,000〜 と重ねない） */
const GEAR_SEED_BASE = 80_000;
const DEFAULT_SEEDS = 20;
const DEFAULT_STEPS = 180_000;
/** 重い版の上限（1 シャードが何時間も回ることはないが、vitest の既定 20 秒では足りない） */
const HEAVY_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const SMOKE_STEPS = 1_500;

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

describe("装備パターンの行列", () => {
  it("パターンの key は一意で、標準が先頭", () => {
    const patterns = gearPatterns();
    expect(patterns[0]?.key).toBe("standard");
    expect(new Set(patterns.map((p) => p.key)).size).toBe(patterns.length);
  });

  it("標準の持ち込みはゲームの枠（CARRY.carrySlots）の数で、右手を含まない", () => {
    const carry = standardCarry();
    expect(carry).toHaveLength(CARRY.carrySlots);
    expect(carry).not.toContain("mainHand");
  });

  it("ラン用のプロフィールは右手と持ち込む部位だけを装備し、袋は空", () => {
    for (const pattern of gearPatterns()) {
      const run = buildRunProfile(pattern, 1);
      const worn = (Object.keys(run.equipment) as Slot[]).filter((s) => run.equipment[s] !== null);
      const expected: Slot[] = pattern.weaponBase === null ? [...pattern.carry] : ["mainHand", ...pattern.carry];
      expect([...worn].sort(), pattern.key).toEqual([...expected].sort());
      expect(run.stash, pattern.key).toHaveLength(0);
      if (pattern.weaponBase !== null) expect(run.equipment.mainHand?.baseKey, pattern.key).toBe(pattern.weaponBase);
    }
  });

  it("同じ seed なら同じ装備になる（決定性。id は生成の通し番号を含むので比べない）", () => {
    const pattern = gearPatterns()[0]!;
    const strip = (seed: number) => Object.values(buildRunProfile(pattern, seed).equipment).map((it) => (it === null ? null : { ...it, id: "" }));
    expect(strip(7)).toEqual(strip(7));
  });

  it("--only は軸の名前と key で絞り、標準は常に残す", () => {
    const all = gearPatterns();
    const weapon = selectPatterns(all, "weapon");
    expect(weapon[0]?.key).toBe("standard");
    expect(weapon.slice(1).every((p) => p.group === "weapon")).toBe(true);
    expect(selectPatterns(all, "job.hunter").map((p) => p.key)).toEqual(["standard", "job.hunter"]);
    expect(selectPatterns(all, undefined)).toHaveLength(all.length);
  });

  it("付け替え: 空いた部位は付け、埋まった部位は十分に深い物だけ、右手は替えない", () => {
    const profile = createEmptyProfile();
    const make = (slot: Slot, level: number) => generateItem(arena().rng, { itemLevel: level, slot, foundDepth: level, now: 0 });
    profile.equipment.head = make("head", 5);
    profile.stash.push(make("head", 5 + GEAR_SWAP_MARGIN - 1), make("mainHand", 30));
    expect(pickEquip(profile)).toBeNull();
    const boots = make("boots", 2);
    profile.stash.push(boots);
    expect(pickEquip(profile)?.id).toBe(boots.id);
    const deepHead = make("head", 5 + GEAR_SWAP_MARGIN);
    profile.stash.push(deepHead);
    expect(pickEquip(profile)?.id).toBe(deepHead.id);
  });

  it("autoEquip は付けた数を返し、付けた遺物が装備に入る", () => {
    const state = arena();
    const ring = generateItem(state.rng, { itemLevel: 4, slot: "ring", foundDepth: 4, now: 0 });
    state.profile.equipment.ring = null;
    state.profile.stash.push(ring);
    expect(autoEquip(state)).toBeGreaterThanOrEqual(1);
    const worn = state.profile.equipment;
    expect(worn["ring"]?.id).toBe(ring.id);
  });

  it("分位・平均の区間・対の差", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(meanInterval([2]).half).toBe(0);
    expect(meanInterval([1, 3]).mean).toBe(2);
    const rec = (seed: number, maxDepth: number, pattern = "x"): GearRunRecord => ({
      pattern, seed, maxDepth, died: true, cleared: false, seconds: 60, floors: maxDepth, kills: 10,
      damageDealt: 100, damageTaken: 50, hitsTaken: 5, bossEncounters: 1, bossDefeats: 1, picked: 2, equipped: 1, deathCause: "slime", exception: null,
    });
    const d = pairedDelta([rec(1, 5), rec(2, 7), rec(3, 9)], [rec(1, 4, "standard"), rec(2, 6, "standard")]);
    expect(d?.mean).toBe(1);
    expect(pairedDelta([rec(9, 5)], [rec(1, 4)])).toBeNull();
  });

  it("集計と書き出し: 軸ごとの節に標準の行が並び、記録の無いパターンは出ない", () => {
    const patterns = gearPatterns();
    const weapon = patterns.find((p) => p.group === "weapon")!;
    const rec = (pattern: string, seed: number, maxDepth: number): GearRunRecord => ({
      pattern, seed, maxDepth, died: true, cleared: false, seconds: 120, floors: maxDepth, kills: 30,
      damageDealt: 600, damageTaken: 90, hitsTaken: 9, bossEncounters: 0, bossDefeats: 0, picked: 3, equipped: 2, deathCause: "slime", exception: null,
    });
    const summaries = summarizeAll(patterns, [rec("standard", 1, 4), rec("standard", 2, 6), rec(weapon.key, 1, 6), rec(weapon.key, 2, 8)]);
    expect(summaries.map((s) => s.pattern)).toEqual(["standard", weapon.key]);
    expect(summaries[1]?.depthDelta?.mean).toBe(2);
    expect(summaries[0]?.killsPerMinute).toBeCloseTo(15);
    const md = buildGearReport(summaries, { generatedAt: "t", seeds: 2, maxSteps: 10 }, [{ ...summaries[1]!, depthMean: 5 } satisfies GearSummary]);
    expect(md).toContain("## 武器種");
    expect(md).not.toContain("## ジョブ");
    expect(md).toContain("+2.0");
  });

  it(`短いラン（${SMOKE_STEPS} step）で例外が出ず、記録が埋まる`, () => {
    const patterns = gearPatterns();
    for (const key of ["standard", "carry.none", "job.hunter"]) {
      const pattern = patterns.find((p) => p.key === key)!;
      const r = runGearOnce(pattern, GEAR_SEED_BASE, SMOKE_STEPS);
      expect(r.exception, key).toBeNull();
      expect(r.seconds, key).toBeGreaterThan(0);
      expect(r.maxDepth, key).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("装備パターンの行列（重い版, SIM_GEAR）", () => {
  it.runIf(MODE === "run")(
    "割り当てられたランを回し、1 ランごとに記録を出す",
    () => {
      // シャードの番号は 0 始まり（"0" は envInt の既定 0 に落ちる）
      const shard = envInt("GEAR_SHARD", 0);
      const shards = envInt("GEAR_SHARDS", 1);
      const seeds = envInt("GEAR_SEEDS", DEFAULT_SEEDS);
      const steps = envInt("GEAR_STEPS", DEFAULT_STEPS);
      const patterns = selectPatterns(gearPatterns(), process.env.GEAR_ONLY);
      const out = process.env.GEAR_OUT;
      if (out === undefined) throw new Error("GEAR_OUT が無い");
      let index = 0;
      for (let i = 0; i < seeds; i++) {
        for (const pattern of patterns) {
          if (index++ % shards !== shard % shards) continue;
          const r = runGearOnce(pattern, GEAR_SEED_BASE + i, steps);
          appendFileSync(out, `${JSON.stringify(r)}\n`, "utf8");
        }
      }
      expect(shard).toBeLessThan(shards);
    },
    HEAVY_TIMEOUT_MS,
  );

  it.runIf(MODE === "report")("全ランの記録を集計して書き出す", () => {
    const runsPath = process.env.GEAR_RUNS;
    if (runsPath === undefined) throw new Error("GEAR_RUNS が無い");
    const runs = JSON.parse(readFileSync(runsPath, "utf8")) as { meta: { seeds: number; maxSteps: number }; records: GearRunRecord[] };
    const prevPath = process.env.GEAR_PREV;
    const prev = prevPath !== undefined && existsSync(prevPath) ? (JSON.parse(readFileSync(prevPath, "utf8")) as { summaries: GearSummary[] }).summaries : [];
    const summaries = summarizeAll(gearPatterns(), runs.records);
    const report = buildGearReport(summaries, { generatedAt: new Date().toISOString(), ...runs.meta }, prev);
    console.log(REPORT_START);
    console.log(report);
    console.log(REPORT_END);
    console.log(SUMMARY_START);
    console.log(JSON.stringify({ meta: runs.meta, summaries }, null, 2));
    console.log(SUMMARY_END);
    expect(summaries.length).toBeGreaterThan(0);
  });
});
