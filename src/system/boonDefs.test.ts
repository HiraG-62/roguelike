import { describe, expect, it } from "vitest";
import { STATUS_LABEL } from "../core/status";
import { REFORGES } from "../data/reforges";
import { ULTIMATES } from "../data/ultimates";
import { SKILL_DEFS } from "../skills/data";
import { BOON_ACTIONS, BOON_KEYS, BOONS, type BoonCard, type BoonDef, LINEAGE_KEYS } from "./boonDefs";

/**
 * 系譜と札の種類（docs/ideas/boon-impl.md 2-1・3-3）。9 系譜 × 11 枚（加護 5 / 摂理 3 / 研鑽 2 / 真髄 1）、
 * 融合 12、呪い付き 6、芯 8。札ごとの効き目は src/system/boonDefs/<系譜>.test.ts
 */

const ALL: readonly BoonDef[] = BOON_KEYS.map((k) => BOONS[k]);
/** 系譜を持たない据え置きの札（呪い付き・芯） */
const isFixedAside = (d: BoonDef): boolean => d.cursed || d.core === true;
/** 系譜の札（呪い・芯・融合 以外） */
const NORMAL = ALL.filter((d) => !isFixedAside(d) && d.fusion === undefined);
const FUSIONS = ALL.filter((d) => d.fusion !== undefined);
/** 系譜ごとの札の種類の枚数（2-1 の表） */
const CARDS_PER_LINEAGE: Readonly<Record<BoonCard, number>> = { grace: 5, law: 3, temper: 2, apex: 1 };
const FUSION_COUNT = 12;
const CURSED_COUNT = 6;
const CORE_COUNT = 8;

/** 祝福の名前と重なってはいけない表示名（奥義 / 状態異常 / スキル / 改鋳。docs/GLOSSARY.md の衝突表） */
function reservedNames(): Map<string, string> {
  const out = new Map<string, string>();
  for (const set of Object.values(ULTIMATES)) for (const u of set) out.set(u.name, `奥義 ${u.name}`);
  for (const label of Object.values(STATUS_LABEL)) out.set(label, `状態異常 ${label}`);
  for (const def of Object.values(SKILL_DEFS)) out.set(def.name, `スキル ${def.key}`);
  for (const def of Object.values(REFORGES)) out.set(def.name, `改鋳 ${def.key}`);
  return out;
}

describe("祝福の構成", () => {
  it("系譜の札・融合・呪い付き・芯だけで 125 種", () => {
    expect(NORMAL, "系譜の札").toHaveLength(LINEAGE_KEYS.length * 11);
    expect(FUSIONS, "融合").toHaveLength(FUSION_COUNT);
    expect(ALL.filter((d) => d.cursed), "呪い付き").toHaveLength(CURSED_COUNT);
    expect(ALL.filter((d) => d.core === true), "芯").toHaveLength(CORE_COUNT);
    expect(ALL).toHaveLength(LINEAGE_KEYS.length * 11 + FUSION_COUNT + CURSED_COUNT + CORE_COUNT);
  });

  it("各系譜は加護 5 / 摂理 3 / 研鑽 2 / 真髄 1", () => {
    for (const lineage of LINEAGE_KEYS) {
      for (const [card, n] of Object.entries(CARDS_PER_LINEAGE)) {
        const cards = NORMAL.filter((d) => d.lineage === lineage && d.card === card);
        expect(cards.length, `${lineage} の ${card}`).toBe(n);
      }
    }
  });

  it("系譜の加護は行動ごとに 1 枚（左 / 右 / ダッシュ / スキル / 奥義）、加護以外は行動を持たない", () => {
    for (const lineage of LINEAGE_KEYS) {
      const actions = NORMAL.filter((d) => d.lineage === lineage && d.card === "grace").map((d) => d.action);
      expect([...actions].sort(), `${lineage} の加護の行動`).toEqual([...BOON_ACTIONS].sort());
    }
    for (const d of ALL) if (d.card !== "grace") expect(d.action, `${d.key} は加護ではない`).toBeUndefined();
  });

  it("系譜の札と融合は何が変わるかを持つ", () => {
    for (const d of [...NORMAL, ...FUSIONS]) expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
  });

  it("呪い付き・芯は系譜も札の種類も持たない", () => {
    for (const d of ALL.filter(isFixedAside)) {
      expect(d.lineage, `${d.key} の系譜`).toBeUndefined();
      expect(d.card, `${d.key} の札の種類`).toBeUndefined();
    }
  });

  it("融合は違う 2 系譜を持ち、系譜は持たず、摂理扱い。組は重ならない", () => {
    const pairs = new Set<string>();
    for (const d of FUSIONS) {
      const [a, b] = d.fusion ?? [];
      expect(a, `${d.key} の組`).not.toBe(b);
      expect(d.lineage, `${d.key} は系譜を持たない`).toBeUndefined();
      expect(d.card, `${d.key} は摂理扱い`).toBe("law");
      const pair = [a, b].sort().join("+");
      expect(pairs.has(pair), `${d.key} の組 ${pair} が重なる`).toBe(false);
      pairs.add(pair);
    }
  });

  it("名前は二字以上で重複せず、アイコンは 1 文字", () => {
    const names = new Set<string>();
    for (const d of ALL) {
      expect([...d.name].length, `${d.key} の名前「${d.name}」`).toBeGreaterThanOrEqual(2);
      expect(names.has(d.name), `${d.key} の名前「${d.name}」が重なる`).toBe(false);
      names.add(d.name);
      expect([...d.icon].length, `${d.key} のアイコン`).toBe(1);
    }
  });

  it("名前が奥義・状態異常・スキル・改鋳の名前と重ならない", () => {
    const reserved = reservedNames();
    for (const d of ALL) expect(reserved.get(d.name), `${d.key} の名前「${d.name}」`).toBeUndefined();
  });
});
