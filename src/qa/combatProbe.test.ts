import { describe, expect, it } from "vitest";
import {
  buildProbeReport,
  buildWeaponSection,
  FULL_PROBE_CONFIG,
  probeMetrics,
  runDuel,
  runProbe,
  runWeaponProbe,
  SMOKE_PROBE_CONFIG,
  weaponMedians,
  type ProbeCounts,
  type WeaponProbeRow,
} from "./combatProbe";
import { MOVESET_KEYS } from "../data/weapons";

// @types/node が無いため process の型は自前で最小限だけ宣言する
declare const process: { env: Record<string, string | undefined> };

/** SIM_PROBE=1: 武器種の表を除いた重い版 / SIM_PROBE=weapons: 武器種 × 敵の表だけ（`npm run qa:probe -- --weapons`） */
const PROBE = process.env.SIM_PROBE === "1";
const PROBE_WEAPONS = process.env.SIM_PROBE === "weapons";

const PROBE_START = "<<<QA_PROBE_START>>>";
const PROBE_END = "<<<QA_PROBE_END>>>";
const WEAPONS_START = "<<<QA_PROBE_WEAPONS_START>>>";
const WEAPONS_END = "<<<QA_PROBE_WEAPONS_END>>>";

/** 重い版の制限時間（ms）。1 対 1 が 720 本 + 集団が 60 本 × 60 秒（武器種 × 敵の 486 本は別） */
const PROBE_TIMEOUT_MS = 1_800_000;

function finiteCounts(c: ProbeCounts): boolean {
  const nums = [
    c.runs, c.maxHpSum, c.seconds, c.kills, c.hitsTaken, c.damageTaken, c.deaths, c.counters, c.dodges, c.enemySteps, c.staggeredEnemySteps,
    c.band.steps, c.band.hitstopSteps, c.band.windups, c.band.strikes, c.band.engagedSteps,
    c.retreats, c.punishShrunkSeconds, c.punishSteps, c.maxRedTelegraphs, c.holdSeconds,
  ];
  return nums.every((n) => Number.isFinite(n) && n >= 0);
}

describe("連打計測（縮小版）", () => {
  const result = runProbe(SMOKE_PROBE_CONFIG);

  it("縮小版の設定どおりの行数が出る", () => {
    const cfg = SMOKE_PROBE_CONFIG;
    expect(result.duels, "敵 × 装備 × 深度 × bot").toHaveLength(cfg.enemies.length * cfg.gears.length * cfg.depths.length * cfg.duelBots.length);
    expect(result.groups, "組 × 装備 × 深度 × bot").toHaveLength(
      Object.keys(cfg.groups).length * cfg.gears.length * cfg.depths.length * cfg.groupBots.length,
    );
    expect(result.power, "深度ごとの地力の行").toHaveLength(cfg.depths.length);
    const w = cfg.weaponProbe;
    expect(result.weapons, "武器種 × 敵 × 深度").toHaveLength(cfg.weapons.length * w.enemies.length * w.depths.length);
  });

  it("どの行の数も有限で、NaN が無い", () => {
    for (const r of [...result.duels, ...result.groups]) {
      expect(finiteCounts(r.counts), `${r.label} d${r.depth} ${r.gear} ${r.bot} の生の数`).toBe(true);
      for (const [key, value] of Object.entries(probeMetrics(r.counts))) {
        if (value === null) continue;
        expect(Number.isFinite(value), `${r.label} d${r.depth} ${r.gear} ${r.bot} の ${key}`).toBe(true);
      }
    }
  });

  it("観測秒は設定の長さ × seed 数で、ヒットストップの割合は 0〜1 に収まる", () => {
    const cfg = SMOKE_PROBE_CONFIG;
    for (const r of result.duels) {
      expect(r.counts.seconds, `${r.label} の観測秒`).toBeCloseTo(cfg.seconds * cfg.seeds.length, 1);
      const rate = probeMetrics(r.counts).hitstopRate;
      expect(rate, `${r.label} のヒットストップ割合`).not.toBeNull();
      expect(rate ?? -1).toBeGreaterThanOrEqual(0);
      expect(rate ?? 2).toBeLessThanOrEqual(1);
    }
  });

  it("攻撃への完遂数は予備動作の開始数を超えない", () => {
    for (const r of [...result.duels, ...result.groups]) {
      expect(r.counts.band.strikes, `${r.label} d${r.depth} ${r.gear} ${r.bot}`).toBeLessThanOrEqual(r.counts.band.windups);
    }
  });

  it("同じ設定で回すと同じ結果になる（決定性）", () => {
    const a = runDuel(1, "slime", "mash", 5, 1);
    const b = runDuel(1, "slime", "mash", 5, 1);
    expect(b, "seed と bot が同じなら生の数も同じ").toEqual(a);
  });

  it("Markdown の表に NaN や Infinity が出ない", () => {
    const md = buildProbeReport(SMOKE_PROBE_CONFIG, result);
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(md).toContain("## 1 対 1");
    expect(md).toContain("## 集団");
    expect(md).toContain("## 地力 ÷ 敵の生命");
    expect(md).toContain("## 武器種 × 敵");
  });

  it("深度相応の装備は装備なしより最大 HP か 1 撃が伸び、同じ seed なら同じ結果になる", () => {
    const none = runDuel(10, "slime", "mash", 5, 1, "none");
    const fitted = runDuel(10, "slime", "mash", 5, 1, "fitted");
    expect(fitted.maxHpSum, "装備で最大 HP が伸びる").toBeGreaterThan(none.maxHpSum);
    expect(fitted.kills, "装備があれば同じ時間でより多く倒す").toBeGreaterThanOrEqual(none.kills);
    expect(runDuel(10, "slime", "mash", 5, 1, "fitted"), "seed が同じなら生の数も同じ").toEqual(fitted);
  });
});

describe("武器種 × 敵の計測", () => {
  it("フル版は 27 武器種すべてを測り、bot は連打+ダッシュ・敵は 3 種・深度 1 / 5・60 秒 × seed 3", () => {
    const cfg = FULL_PROBE_CONFIG;
    expect(cfg.weapons, "全武器種").toEqual(MOVESET_KEYS);
    expect(cfg.weapons).toHaveLength(27);
    expect(cfg.weaponProbe.bot).toBe("mashDodge");
    expect(cfg.weaponProbe.enemies).toEqual(["slime", "knight", "eye"]);
    expect(cfg.weaponProbe.depths).toEqual([1, 5]);
    expect(cfg.weaponProbe.seconds).toBe(60);
    expect(cfg.weaponProbe.seeds).toHaveLength(3);
  });

  it("武器種の軸は装備なしの素の能力のまま武器種と弾だけを替え、同じ seed なら同じ結果になる", () => {
    const a = runDuel(1, "slime", "mashDodge", 5, 1, { moveset: "longarm" });
    const b = runDuel(1, "slime", "mashDodge", 5, 1, { moveset: "longarm" });
    expect(b, "武器種と seed が同じなら生の数も同じ").toEqual(a);
    expect(a.runs).toBe(1);
    expect(a.seconds, "観測秒").toBeCloseTo(5, 1);
    expect(a.maxHpSum, "装備なしと最大 HP が同じ").toBe(runDuel(1, "slime", "mashDodge", 5, 1, "none").maxHpSum);
  });

  it("武器種が違えば戦い方が変わる（剣と長銃で生の数が同じにならない）", () => {
    const sword = runDuel(1, "slime", "mashDodge", 10, 1, { moveset: "sword" });
    const longarm = runDuel(1, "slime", "mashDodge", 10, 1, { moveset: "longarm" });
    expect(longarm, "剣と長銃").not.toEqual(sword);
  });

  it("縮小版の武器種の行は有限で、武器種の指定順に並ぶ", () => {
    const rows = runWeaponProbe(SMOKE_PROBE_CONFIG);
    expect(rows.map((r) => r.moveset)).toEqual(SMOKE_PROBE_CONFIG.weapons.flatMap((m) => Array<string>(SMOKE_PROBE_CONFIG.weaponProbe.enemies.length * SMOKE_PROBE_CONFIG.weaponProbe.depths.length).fill(m)));
    for (const r of rows) expect(finiteCounts(r.counts), `${r.moveset} の生の数`).toBe(true);
  });

  it("中央値の比を出し、目標の幅の外は * を付けて表に出す", () => {
    const counts = (kills: number, hits: number): ProbeCounts => ({
      runs: 1, maxHpSum: 100, seconds: 60, kills, hitsTaken: hits, damageTaken: hits * 10, deaths: 0, counters: 0, dodges: 0, enemySteps: 0, staggeredEnemySteps: 0,
      band: { steps: 3600, hitstopSteps: 0, windups: 0, strikes: 0, engagedSteps: 0, engagementSeconds: [] },
      retreats: 0, punishShrunkSeconds: 0, punishSteps: 0, maxRedTelegraphs: 0, holdSeconds: 0,
    });
    const rows: WeaponProbeRow[] = [
      { moveset: "sword", enemy: "slime", depth: 1, counts: counts(30, 10) },
      { moveset: "axe", enemy: "slime", depth: 1, counts: counts(30, 10) },
      { moveset: "hammer", enemy: "slime", depth: 1, counts: counts(10, 20) },
    ];
    const med = weaponMedians(rows).get("slime@1");
    expect(med?.secondsPerKill, "撃破秒 2 / 2 / 6 の中央値").toBeCloseTo(2, 5);
    expect(med?.hitsPer60, "被弾 10 / 10 / 20 の中央値").toBeCloseTo(10, 5);
    const md = buildProbeReport({ ...SMOKE_PROBE_CONFIG, weapons: ["sword", "axe", "hammer"] }, {
      duels: [], groups: [], power: [], weapons: rows,
    });
    const hammerLine = md.split("\n").find((l) => l.startsWith("| hammer |")) ?? "";
    expect(hammerLine, "hammer は撃破秒 3.00 倍・被弾 2.00 倍で両方が幅の外").toContain("| 3.00* |");
    expect(hammerLine).toContain("| 2.00* |");
    const swordLine = md.split("\n").find((l) => l.startsWith("| sword |")) ?? "";
    expect(swordLine, "剣は中央値と同じで印が付かない").not.toContain("*");
  });
});

describe("連打計測の指標", () => {
  it("撃破が 0 のときの撃破秒と、予備動作が 0 のときの完遂率は null にする", () => {
    const m = probeMetrics({
      runs: 1, maxHpSum: 100, seconds: 10, kills: 0, hitsTaken: 0, damageTaken: 0, deaths: 0, counters: 0, dodges: 0, enemySteps: 0, staggeredEnemySteps: 0,
      band: { steps: 600, hitstopSteps: 60, windups: 0, strikes: 0, engagedSteps: 0, engagementSeconds: [] },
      retreats: 6, punishShrunkSeconds: 3, punishSteps: 10, maxRedTelegraphs: 2, holdSeconds: 0.5,
    });
    expect(m.secondsPerKill, "撃破 0").toBeNull();
    expect(m.completionRate, "予備動作 0").toBeNull();
    expect(m.hitstopRate, "60 / 600").toBeCloseTo(0.1, 5);
  });

  it("反応ルールの指標は 60 秒あたりに直し、赤い予告の最大はそのまま出す", () => {
    const m = probeMetrics({
      runs: 1, maxHpSum: 100, seconds: 30, kills: 1, hitsTaken: 0, damageTaken: 0, deaths: 0, counters: 0, dodges: 0, enemySteps: 0, staggeredEnemySteps: 0,
      band: { steps: 1800, hitstopSteps: 0, windups: 1, strikes: 1, engagedSteps: 0, engagementSeconds: [] },
      retreats: 6, punishShrunkSeconds: 3, punishSteps: 10, maxRedTelegraphs: 2, holdSeconds: 0.5,
    });
    expect(m.retreatsPer60, "30 秒で 6 回 → 60 秒で 12 回").toBeCloseTo(12, 5);
    expect(m.punishSecondsPer60).toBeCloseTo(6, 5);
    expect(m.holdSecondsPer60).toBeCloseTo(1, 5);
    expect(m.maxRedTelegraphs).toBe(2);
  });
});

describe("被弾で死ぬまでの回数", () => {
  const base: ProbeCounts = {
    runs: 2, maxHpSum: 200, seconds: 60, kills: 1, hitsTaken: 10, damageTaken: 50, deaths: 0, counters: 0, dodges: 0, enemySteps: 0,
    staggeredEnemySteps: 0, band: { steps: 3600, hitstopSteps: 0, windups: 0, strikes: 0, engagedSteps: 0, engagementSeconds: [] },
    retreats: 0, punishShrunkSeconds: 0, punishSteps: 0, maxRedTelegraphs: 0, holdSeconds: 0,
  };

  it("最大 HP の平均 ÷ 1 回の被弾の平均ダメージで出し、被弾が 0 なら null にする", () => {
    const m = probeMetrics(base);
    expect(m.damagePerHit, "50 ÷ 10").toBeCloseTo(5, 5);
    expect(m.hitsToDie, "最大 HP 100 ÷ 5").toBeCloseTo(20, 5);
    expect(probeMetrics({ ...base, hitsTaken: 0, damageTaken: 0 }).hitsToDie, "被弾 0").toBeNull();
  });
});

describe("連打計測の反応ルールの観測", () => {
  it("連打 bot は前衛の間合い取りを起こし、隙狙いの時計も進める", () => {
    const c = runDuel(1, "golem", "mash", 20, 1);
    expect(c.retreats, "殴り続けると前衛は離れる").toBeGreaterThan(0);
    expect(c.punishShrunkSeconds, "連打は終撃の硬直を晒す").toBeGreaterThan(0);
  });
});

describe("連打計測（重い版, SIM_PROBE=1）", () => {
  it.runIf(PROBE)(
    "敵 8 種 × 深度 1/5/10/15/20 × 装備 2 通り × seed 3 と集団 3 組を測って表にする（武器種 × 敵は別の run）",
    () => {
      const cfg = { ...FULL_PROBE_CONFIG, weapons: [] };
      const result = runProbe(cfg);
      // @types/node が無くこのファイルは fs に触れられないので、標準出力に区切り付きで出す。
      // scripts/qa-probe.mjs がこのマーカー間を抜き出して src/qa/probe.md に保存する
      console.log(PROBE_START);
      console.log(buildProbeReport(cfg, result));
      console.log(PROBE_END);
      for (const r of [...result.duels, ...result.groups]) {
        expect(finiteCounts(r.counts), `${r.label} d${r.depth} ${r.gear} ${r.bot} の生の数が有限`).toBe(true);
      }
    },
    PROBE_TIMEOUT_MS,
  );

  it.runIf(PROBE_WEAPONS)(
    "武器種 27 × 敵 3 × 深度 2 × seed 3 を測って表にする",
    () => {
      const cfg = FULL_PROBE_CONFIG;
      const rows = runWeaponProbe(cfg);
      console.log(WEAPONS_START);
      console.log(buildWeaponSection(cfg, rows).join("\n"));
      console.log(WEAPONS_END);
      for (const r of rows) {
        expect(finiteCounts(r.counts), `${r.moveset} × ${r.enemy} d${r.depth} の生の数が有限`).toBe(true);
      }
    },
    PROBE_TIMEOUT_MS,
  );
});
