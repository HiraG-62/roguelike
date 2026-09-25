import { describe, expect, it } from "vitest";
import { assignBinding, defaultKeybinds } from "../core/input";
import glossary from "../../docs/GLOSSARY.md?raw";
import { ATTR_LABEL } from "../loot/resonance";
import { ATTR_KEYS } from "../loot/types";
import { TIP_CATEGORIES, tipEntries, tipsListTabs } from "./tips";

describe("Tips ノート", () => {
  it("Tips ノートの項目は GLOSSARY の語を持ち、本文が空でない", () => {
    const entries = tipEntries(defaultKeybinds());
    expect(entries.length, "項目がある").toBeGreaterThan(0);
    for (const t of entries) {
      expect(glossary.includes(t.term), `${t.key}「${t.term}」が docs/GLOSSARY.md にある`).toBe(true);
      expect(t.body.trim().length, `${t.key} の本文`).toBeGreaterThan(0);
    }
  });

  it("項目の key は重ならず、どのカテゴリにも項目がある", () => {
    const entries = tipEntries(defaultKeybinds());
    expect(new Set(entries.map((t) => t.key)).size, "key が一意").toBe(entries.length);
    for (const c of TIP_CATEGORIES) expect(entries.some((t) => t.category === c), c).toBe(true);
  });

  it("ステータス 5 種すべてに項目がある", () => {
    const terms = tipEntries(defaultKeybinds()).map((t) => t.term);
    for (const k of ATTR_KEYS) expect(terms, k).toContain(ATTR_LABEL[k]);
  });

  it("操作の本文はキー設定どおりの表記になる", () => {
    const body = (binds: ReturnType<typeof defaultKeybinds>): string => tipEntries(binds).find((t) => t.key === "special")?.body ?? "";
    expect(body(defaultKeybinds()), "既定は F").toContain("F");
    const next = assignBinding(defaultKeybinds(), "special", 0, "KeyH");
    if (!next) throw new Error("割り当てできない");
    expect(body(next), "差し替えると H").toContain("H");
    expect(body(next), "F は残らない").not.toMatch(/(^|[^A-Za-z])F([^A-Za-z]|$)/);
  });

  it("一覧はカテゴリごとの 1 タブ", () => {
    const tabs = tipsListTabs(defaultKeybinds());
    expect(tabs.length, "カテゴリ数").toBe(TIP_CATEGORIES.length);
    expect(tabs.reduce((n, t) => n + t.entries.length, 0), "全項目").toBe(tipEntries(defaultKeybinds()).length);
  });
});
