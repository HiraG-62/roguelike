import { describe, expect, it } from "vitest";
import { MOVESETS, MOVESET_KEYS, type MovesetKey, matchBranch } from "../data/weapons";
import { ULTIMATES } from "../data/ultimates";
import { buildDemoArena } from "../map/demoArena";
import { calibrateFoeDistance, demoOutcome } from "../system/manualDemo";
import { MANUAL_GROUPS, MANUAL_KEYS, type ManualMove, cueToken, laneSequence, weaponManualPage } from "./weaponManual";

function movesOf(key: MovesetKey, group: ManualMove["group"]): ManualMove[] {
  return weaponManualPage(key).moves.filter((m) => m.group === group);
}

describe("武器指南書の頁", () => {
  it("全武器種の頁がある", () => {
    expect([...MANUAL_KEYS]).toEqual([...MOVESET_KEYS]);
  });

  it("どの頁も特色と型の文を持ち、技の key が重ならない", () => {
    for (const key of MANUAL_KEYS) {
      const page = weaponManualPage(key);
      expect(page.sections.length, key).toBeGreaterThan(0);
      for (const s of page.sections) expect(s.body.trim().length, `${key} ${s.heading}`).toBeGreaterThan(0);
      expect(new Set(page.moves.map((m) => m.key)).size, `${key} の技の key`).toBe(page.moves.length);
      for (const m of page.moves) expect(MANUAL_GROUPS, m.key).toContain(m.group);
    }
  });

  it("技の一覧は右の段・コンボ派生（構えを離す振りを除く）・奥義をすべて載せる", () => {
    for (const key of MANUAL_KEYS) {
      const m = MOVESETS[key];
      expect(movesOf(key, "lane").length, `${key} の右の段`).toBe(m.steps2.length);
      expect(movesOf(key, "branch").length, `${key} の派生`).toBe(m.branches.filter((b) => b.art !== "release").length);
      expect(movesOf(key, "ultimate").map((u) => u.name), `${key} の奥義`).toEqual(ULTIMATES[key].map((u) => u.name));
      expect(movesOf(key, "dash").length, `${key} のダッシュ攻撃`).toBe(1);
    }
  });

  it("コンボ派生の入力の札は派生の入力列そのもの", () => {
    for (const b of MOVESETS.sword.branches) {
      const move = movesOf("sword", "branch").find((x) => x.name === b.name);
      const labels = move?.script.cues.map(cueToken).filter((t) => t !== null).map((t) => t.label);
      expect(labels, b.name).toEqual(b.sequence.map((s) => (s === "primary" ? "左" : "右")));
    }
  });

  it("右の段の押し方は途中で派生に当たらず、最後が右", () => {
    for (const key of MANUAL_KEYS) {
      const m = MOVESETS[key];
      m.steps2.forEach((_, i) => {
        const seq = laneSequence(m, i);
        expect(seq[seq.length - 1], `${key} 右 ${i}`).toBe("secondary");
        for (let k = 1; k <= seq.length; k++) expect(matchBranch(m, seq.slice(0, k)), `${key} 右 ${i} の ${k} 手目`).toBeUndefined();
      });
    }
  });

  it("剣の斬り上げ（右 3 段目）は左左右（十字断ち）を避けて押す", () => {
    expect(laneSequence(MOVESETS.sword, 2)).not.toEqual(["primary", "primary", "secondary"]);
  });

  it("溜めの武器種は溜め攻撃を長押しの札で載せる", () => {
    const charge = movesOf("greatsword", "charge")[0];
    expect(charge?.script.cues.map(cueToken)).toEqual([{ label: "左", long: true }]);
  });
});

/**
 * 全武器種の全技の実演を実際に回し、狙いどおりになるか（当たる / 戦意を放つ）。木人の距離は画面と同じく合わせ込む。
 * 反動で下がる段（砲・擲弾の筒の振り）と受け流しの構えは expect が none（当たりを確かめない）
 */
describe("武器指南書の実演", () => {
  const arena = buildDemoArena();

  it("全武器種の全技が実演で狙いを満たす", () => {
    const failed: string[] = [];
    for (const key of MANUAL_KEYS) {
      for (const move of weaponManualPage(key).moves) {
        if (move.expect === "none") continue;
        const distance = calibrateFoeDistance(key, move.script, move.expect, arena);
        const out = demoOutcome(key, { ...move.script, setup: { ...move.script.setup, foeDistance: distance } }, arena);
        const ok = move.expect === "hit" ? out.hit : out.release;
        if (!ok) failed.push(`${key} ${move.name}（${move.expect}）`);
      }
    }
    expect(failed).toEqual([]);
  }, 120_000);

  it("確かめない技は受け流しの構え・反動を挟む振り・床に残らない弾の放出だけ", () => {
    const skipped = MANUAL_KEYS.flatMap((key) => weaponManualPage(key).moves.filter((m) => m.expect === "none").map((m) => `${key}:${m.key}`));
    // 剣の受け流し・爪の跳び退き・砲 / 擲弾 / 短銃の反動の振りと、砲の型の放出（床に残る弾を撃たない器）
    for (const s of skipped) expect(s, s).toMatch(/^(sword:lane\.0|claws:lane\.1|cannon:|grenade:|sidearm:)/);
  });
});
