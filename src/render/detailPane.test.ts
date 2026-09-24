import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { BASES } from "../loot/bases";
import { createEmptyProvenance, type Item } from "../loot/types";
import { SKILL_KEYS, type SkillStone } from "../skills/types";
import { detailRect } from "../ui/inventoryLayout";
import { MOVESET_KEYS, MOVESETS } from "../data/weapons";
import { chunksText, formulaChunks, movesetFormulas, skillFormulas } from "../ui/scalingText";
import { ULTIMATES, defaultUltimate } from "../data/ultimates";
import { ultimateTipLine } from "./detailPane";

/**
 * 詳細欄の計算式の頁が欄に収まるか。文字幅は pixelText の未ロード時の推定（半角 8 / 全角 16 ドット）で測る。
 * DotGothic16 の実際の advance と同じなので、表示倍率ごとの見た目の幅と一致する
 */

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    fonts: { check: () => false, load: () => new Promise(() => undefined) },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * 表示倍率（論理 px → デバイス px）。文字が設計どおり論理 8px になる 2（960 幅）と 4（1080p）。
 * 倍率 3 はドット倍率の切り上げで文字が 1.33 倍になり、どの頁も詰めた行高と末尾の … に頼る（描画側の既存の方針）
 */
const SCALES = [2, 4] as const;
/** 1 つの式が折り返してよい行数 */
const MAX_ROWS_PER_FORMULA = 3;

async function withScale(scale: number): Promise<void> {
  const { pixelText, updateTextSizes } = await import("./pixelText");
  pixelText().setScale(scale);
  updateTextSizes();
}

function weaponItem(baseKey: string): Item {
  return {
    id: `w-${baseKey}`,
    seed: 1,
    baseKey,
    slot: "mainHand",
    rarity: "magic",
    itemLevel: 10,
    name: "計算式を見る武器",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 0,
    marginMax: 0,
    milestones: [],
    buds: [],
    budOffer: null,
  };
}

function stoneOf(key: (typeof SKILL_KEYS)[number]): SkillStone {
  return { id: `s-${key}`, seed: 1, skillKey: key, variants: [], links: 3, foundDepth: 1, foundAt: 0 };
}

describe("詳細欄の計算式の頁", () => {
  it("1 つの式は詳細欄の幅で折り返して数行に収まる", async () => {
    const { wrapChunks } = await import("./detailPane");
    const { TEXT } = await import("./pixelText");
    const game = createGame(1);
    const width = detailRect().w - 4;
    for (const scale of SCALES) {
      await withScale(scale);
      for (const key of MOVESET_KEYS) {
        for (const a of movesetFormulas(game.stats, MOVESETS[key], "single")) {
          for (const f of a.formulas) {
            const rows = wrapChunks(formulaChunks(f), width, TEXT.SMALL);
            expect(rows.length, `倍率 ${scale} ${key} ${a.name} ${chunksText(formulaChunks(f))}`).toBeLessThanOrEqual(MAX_ROWS_PER_FORMULA);
          }
        }
      }
    }
  });

  it("全武器のベースで、計算式の頁が詳細欄の高さに収まる", async () => {
    const { detailPaneFits } = await import("./detailPane");
    const { itemFormulaLines } = await import("./inventoryUi");
    const game = createGame(1);
    const rect = detailRect();
    const weapons = BASES.filter((b) => b.moveset !== undefined);
    expect(weapons.length, "武器のベースがある").toBeGreaterThan(0);
    for (const scale of SCALES) {
      await withScale(scale);
      for (const base of weapons) {
        const content = { lines: [], formulas: itemFormulaLines(game, weaponItem(base.key)), actions: ["クリック: 装備", "Shift+クリック: 砕く", "E: 要点だけ"] };
        const r = detailPaneFits(rect, content, "formula");
        expect(r.fits, `倍率 ${scale} ${base.name}（${r.rows} 行）が欄からはみ出す`).toBe(true);
      }
    }
  });

  it("全スキル石で、計算式の頁が詳細欄の高さに収まる", async () => {
    const { detailPaneFits } = await import("./detailPane");
    const { stoneFormulaLines } = await import("./inventoryUi");
    const game = createGame(1);
    const rect = detailRect();
    for (const scale of SCALES) {
      await withScale(scale);
      for (const key of SKILL_KEYS) {
        const content = { lines: [], formulas: stoneFormulaLines(stoneOf(key), skillFormulas(game.stats, key)), actions: ["クリック: 装着", "Shift+クリック: 分解", "E: 要点だけ"] };
        const r = detailPaneFits(rect, content, "formula");
        expect(r.fits, `倍率 ${scale} ${key}（${r.rows} 行）が欄からはみ出す`).toBe(true);
      }
    }
  });

  it("何も乗せていないときの参照一覧が、ステータス一覧の下の欄に収まる（行動の多い武器種 + スキル 4 つ）", async () => {
    const { detailPaneFits } = await import("./detailPane");
    const { summaryBelowRect, summaryFormulaLines } = await import("./inventoryUi");
    const game = createGame(1);
    const rect = summaryBelowRect(detailRect());
    // 名前の多いスキル（式の数が多い順）を 4 つ装着した想定
    const skills = [...SKILL_KEYS].sort((a, b) => skillFormulas(game.stats, b).length - skillFormulas(game.stats, a).length).slice(0, 4);
    game.skills.profile.stones = skills.map(stoneOf);
    game.skills.profile.loadout = skills.map((k) => `s-${k}`);
    for (const scale of SCALES) {
      await withScale(scale);
      for (const key of MOVESET_KEYS) {
        game.stats = { ...game.stats, moveset: key };
        const r = detailPaneFits(rect, { lines: [], formulas: summaryFormulaLines(game), actions: ["E: 要点だけ"] }, "formula");
        expect(r.fits, `倍率 ${scale} ${MOVESETS[key].name}（${r.rows} 行）が欄からはみ出す`).toBe(true);
      }
    }
  });

  it("計算式が無ければ計算式の頁は詳しくと同じ行数になる", async () => {
    const { detailPaneFits } = await import("./detailPane");
    await withScale(4);
    const rect = detailRect();
    const content = { lines: [{ text: "要点", color: "#fff" }], more: [{ text: "詳しく", color: "#fff" }] };
    expect(detailPaneFits(rect, content, "formula").rows).toBe(detailPaneFits(rect, content, "full").rows);
  });
});

describe("右手の要点の奥義の行", () => {
  it("武器種を持つ武器は、その武器種で選んでいる奥義の名前を出し、武器でなければ出さない", () => {
    const weapon = BASES.find((b) => b.moveset === "greatsword");
    const other = BASES.find((b) => b.moveset === undefined);
    if (!weapon || !other) throw new Error("ベースが無い");
    const set = ULTIMATES.greatsword;
    const pick = set[set.length - 1] ?? set[0];
    expect(ultimateTipLine({}, weaponItem(weapon.key))?.text, "選んでいなければ 1 本目").toContain(defaultUltimate("greatsword").name);
    expect(ultimateTipLine({ ultimates: { greatsword: pick.key } }, weaponItem(weapon.key))?.text, "選んだ奥義").toContain(pick.name);
    expect(ultimateTipLine({}, { ...weaponItem(other.key), slot: other.slot }), "武器でなければ行を出さない").toBeNull();
  });
});
