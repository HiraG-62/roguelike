import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { JOB_KEYS } from "../data/jobs";
import { ULTIMATES, defaultUltimate } from "../data/ultimates";
import { MOVESETS, MOVESET_KEYS } from "../data/weapons";
import { BASES } from "../loot/bases";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import { SKILL_KEYS, type SkillStone } from "../skills/types";
import { createInventoryUi } from "../ui/inventory";
import { openMenu } from "../ui/menuActions";
import { fid } from "../ui/menuFocus";
import type { SheetSubject, ViewOf } from "../ui/menuState";
import { ATTR_KEYS } from "../loot/types";
import { BODY_PAGE_BREAKDOWN, BODY_PAGE_ULTIMATE, BREAKDOWN_MOD_RECT, BREAKDOWN_REF_RECT, BREAKDOWN_SOURCE_RECT, BODY_FORMULA_RECT, ITEM_BODY } from "../ui/sheet";
import { bodyActionChunks } from "../ui/sheetBody";
import { chunksText, movesetFormulas, skillFormulas } from "../ui/scalingText";

/**
 * 書付の描画。文字幅は pixelText の未ロード時の推定（半角 8 / 全角 16 ドット）で測る。
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

/** 表示倍率（論理 px → デバイス px）。文字が設計どおり論理 8px になる 2（960 幅）と 4（1080p） */
const SCALES = [2, 4] as const;

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

/** 呼び出しを数えるだけの偽の Canvas */
function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === "measureText") return () => ({ width: 8 });
      if (prop === "getTransform") return () => ({ a: 1, d: 1, e: 0, f: 0 });
      return (..._args: unknown[]) => {
        const name = String(prop);
        calls.set(name, (calls.get(name) ?? 0) + 1);
      };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("書付の計算式", () => {
  it("計算式が書付 1 枚に収まる（全武器種）", async () => {
    const { formulaRowsFit, wrapChunks } = await import("./sheetUi");
    const { TEXT } = await import("./pixelText");
    const game = createGame(1);
    for (const scale of SCALES) {
      await withScale(scale);
      const fit = formulaRowsFit(BODY_FORMULA_RECT);
      for (const key of MOVESET_KEYS) {
        for (const a of movesetFormulas(game.stats, MOVESETS[key], "pistol")) {
          const rows = wrapChunks(bodyActionChunks(a), BODY_FORMULA_RECT.w, TEXT.SMALL);
          expect(rows.length, `倍率 ${scale} ${key} ${a.name}`).toBeLessThanOrEqual(fit);
        }
      }
    }
  });

  it("全スキル石の計算式が石の書付の右の列に収まる", async () => {
    const { columnFits } = await import("./sheetUi");
    const { stoneFormulaLines } = await import("./itemTips");
    const game = createGame(1);
    const half = Math.floor((ITEM_BODY.w - 12) / 2);
    const rect = { x: 0, y: 0, w: half, h: 160 };
    for (const scale of SCALES) {
      await withScale(scale);
      for (const key of SKILL_KEYS) {
        const lines = stoneFormulaLines(stoneOf(key), skillFormulas(game.stats, key)).slice(1).map((line) => ({ line }));
        expect(columnFits(lines, rect), `倍率 ${scale} ${key}`).toBe(true);
      }
    }
  });
});

describe("書付「内訳」の頁", () => {
  /** 内訳の頁の 3 つの欄の行が、描画の欄に収まるか */
  async function expectBreakdownFits(state: ReturnType<typeof createGame>, label: string): Promise<void> {
    const { breakdownLines, columnFits } = await import("./sheetUi");
    for (const attr of ATTR_KEYS) {
      const lines = breakdownLines(state, attr);
      expect(columnFits(lines.sources, BREAKDOWN_SOURCE_RECT), `${label} ${attr} 出どころ`).toBe(true);
      expect(columnFits(lines.references, BREAKDOWN_REF_RECT), `${label} ${attr} 参照する行動`).toBe(true);
      expect(columnFits(lines.modifiers, BREAKDOWN_MOD_RECT), `${label} ${attr} 増と倍`).toBe(true);
    }
  }

  it("全ジョブ・全武器種で 3 つの欄が書付 1 画面に収まる", async () => {
    for (const scale of SCALES) {
      await withScale(scale);
      for (const job of JOB_KEYS) {
        const base = createGame(1, "1", undefined, undefined, { origin: "wanderer", modifiers: [], job });
        for (const moveset of MOVESET_KEYS) {
          const state = { ...base, stats: { ...base.stats, moveset, bullet: "pistol" } };
          await expectBreakdownFits(state, `倍率 ${scale} ${job} ${moveset}`);
        }
      }
    }
  });

  it("どのスキル石を腰に付けても、参照する行動の欄に収まる（全スキル石を 4 つずつ）", async () => {
    await withScale(4);
    const base = createGame(1);
    for (let i = 0; i < SKILL_KEYS.length; i += 4) {
      const keys = SKILL_KEYS.slice(i, i + 4);
      base.skills.profile.stones = keys.map(stoneOf);
      base.skills.profile.loadout = keys.map((k) => `s-${k}`);
      for (const moveset of ["greatsword", "fists", "book"] as const) {
        const state = { ...base, stats: { ...base.stats, moveset } };
        await expectBreakdownFits(state, `${keys.join(",")} ${moveset}`);
      }
    }
  });

  it("焦点のステータスの出どころ・参照する行動と、攻撃に掛かる増と倍の行が出る", async () => {
    await withScale(4);
    const { breakdownLines } = await import("./sheetUi");
    const state = createGame(1);
    state.stats = {
      ...state.stats,
      increased: { ...state.stats.increased, melee: 0.2 },
      more: [{ source: "keystone:ks_glassCannon", label: "硝子の砲", mul: 2, tags: ["melee"] }],
    };
    const text = (lines: { line: unknown }[]): string[] =>
      lines.map((l) => {
        const line = l.line;
        if (typeof line !== "object" || line === null) return "";
        if ("chunks" in line && Array.isArray(line.chunks)) return chunksText(line.chunks);
        return "text" in line && typeof line.text === "string" ? line.text : "";
      });
    const lines = breakdownLines(state, "str");
    expect(text(lines.modifiers), "増と倍の行").toEqual(["増 近接ダメージ +20%", "倍 硝子の砲 ×2"]);
    const refs = text(lines.references);
    expect(refs[0], "見出しは焦点のステータス").toContain("筋力");
    expect(refs.some((r) => r.startsWith("威力")), "威力の行").toBe(true);
    expect(text(lines.sources)[0], "出どころの見出し").toBe("出どころ");
    const spirit = text(breakdownLines(state, "def").references);
    expect(spirit[0], "別のステータスは別の見出し").toContain("防御");
  });
});

describe("右手の要点の奥義の行", () => {
  it("右手の要点に奥義の行が出る", async () => {
    const { ultimateTipLine } = await import("./itemTips");
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

describe("書付の描画のスモーク", () => {
  it("全ての書付と鍛冶の段を例外なく描く（fillText を使わないことは inventoryUi.test.ts がフォント読み込み済みの形で見る）", async () => {
    await withScale(4);
    const { drawInventoryUi } = await import("./inventoryUi");
    const state = createGame(1);
    const grown: AffixRoll = { key: "attr_dex", value: 4, nominal: 4, flux: 0, color: "gold", origin: "bud" };
    const worn = { ...weaponItem("longsword"), id: "worn", affixes: [grown], inscription: "銘の試し" };
    state.profile.equipment.mainHand = worn;
    addToStash(state.profile, { ...weaponItem("longsword"), id: "cand", affixes: [grown] });
    state.skills.profile.stones = [stoneOf(SKILL_KEYS[0])];
    state.skills.profile.loadout = [`s-${SKILL_KEYS[0]}`];
    state.boons.push("ashBlaze");
    const ui = createInventoryUi(createCraftSave());
    openMenu(state, ui, "attire");
    const subjects: SheetSubject[] = [
      { kind: "item", itemId: "worn" },
      { kind: "item", itemId: "gone" },
      { kind: "pair", itemId: "cand", slot: "mainHand" },
      { kind: "stone", stoneId: `s-${SKILL_KEYS[0]}` },
      { kind: "stonePair", stoneId: `s-${SKILL_KEYS[0]}`, index: 1 },
      { kind: "rune", key: "pierce" },
      { kind: "body" },
      { kind: "boon", key: "ashBlaze" },
      { kind: "lineage", lineage: "ash" },
    ];
    const { ctx, calls } = fakeContext();
    const root = ui.stack[0];
    if (root === undefined) throw new Error("開いていない");
    const draw = (view: ViewOf<"sheet">): void => {
      ui.stack = [root, view];
      drawInventoryUi(ctx, state, ui);
    };
    for (const subject of subjects) {
      draw({ kind: "sheet", focus: null, subject, page: 0, offset: 0, forge: null });
      draw({ kind: "sheet", focus: fid.row(ATTR_KEYS.length - 1), subject, page: BODY_PAGE_BREAKDOWN, offset: 0, forge: null });
      draw({ kind: "sheet", focus: fid.ult(0), subject, page: BODY_PAGE_ULTIMATE, offset: 1, forge: null });
    }
    const item: SheetSubject = { kind: "item", itemId: "cand" };
    for (const op of ["shatter", "pour", "transfer", "recall", "stir"] as const) {
      draw({ kind: "sheet", focus: fid.exec, subject: item, page: 0, offset: 0, forge: { subjectId: "cand", op, partnerId: null, pick: null } });
      draw({ kind: "sheet", focus: fid.trait(0), subject: item, page: 0, offset: 0, forge: { subjectId: "cand", op, partnerId: "worn", pick: null } });
    }
    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
  });
});
