import { describe, expect, it } from "vitest";
import { defaultKeybinds } from "../core/input";
import { MOVESETS, MOVESET_KEYS } from "../data/weapons";
import { WEAPON_TIP_KEYS, weaponMechanics, weaponTipBody } from "./weaponTips";
import { TIP_CATEGORIES, tipEntries, tipsListTabs } from "./tips";

describe("武器種 Tips 本文", () => {
  it("全武器種を網羅する", () => {
    expect(WEAPON_TIP_KEYS.length, "件数").toBe(MOVESET_KEYS.length);
    for (const key of MOVESET_KEYS) expect(WEAPON_TIP_KEYS, key).toContain(key);
  });

  it("どの武器種でも本文が組み立てられ、空でない", () => {
    for (const key of MOVESET_KEYS) {
      const body = weaponTipBody(key, defaultKeybinds());
      expect(body.trim().length, key).toBeGreaterThan(0);
      // 奥義の候補が本文に含まれる（データから組み立てていることの確認）
      expect(body, `${key} は奥義の候補を含む`).toContain("奥義の候補");
      // Tips ノートの説明欄（render/codexUi.ts drawSideDetail）に収まる分量を超えない（見た目の破綻を防ぐ）
      expect(body.length, `${key} の本文の長さ`).toBeLessThan(420);
    }
  });

  it("派生を持つ武器種は本文に派生名を含む", () => {
    const sword = weaponTipBody("sword", defaultKeybinds());
    for (const b of MOVESETS.sword.branches) expect(sword, b.name).toContain(b.name);
  });

  it("キー設定を差し替えると操作の表記も変わる", () => {
    const before = weaponTipBody("sword", defaultKeybinds());
    expect(before).toContain("奥義ゲージが満ちると出せる");
  });

  it("固有の仕組みは武器の定義から検出する（手書きしない）", () => {
    expect(weaponMechanics(MOVESETS.scythe), "大鎌は引き寄せる").toContain("敵を引き寄せる");
    expect(weaponMechanics(MOVESETS.fists), "拳は敵を放り投げる").toContain("敵を放り投げる");
    expect(weaponMechanics(MOVESETS.sword), "剣は受け流しの構えを持つ").toContain("受け流しの構えがある");
    expect(weaponMechanics(MOVESETS.shield), "大盾は防御の構えを持つ").toContain("防御の構えがある");
  });
});

describe("Tips ノートの武器種タブ", () => {
  it("カテゴリに武器種を持ち、タブの件数が武器種の数と一致する", () => {
    expect(TIP_CATEGORIES, "武器種カテゴリ").toContain("weapon");
    const tabs = tipsListTabs(defaultKeybinds());
    const tab = tabs.find((t) => t.label === "武器種");
    expect(tab?.entries.length, "武器種タブの件数").toBe(MOVESET_KEYS.length);
  });

  it("tipEntries にも武器種の項目が含まれる", () => {
    const entries = tipEntries(defaultKeybinds()).filter((t) => t.category === "weapon");
    expect(entries.length).toBe(MOVESET_KEYS.length);
    expect(new Set(entries.map((e) => e.term)).size, "武器名が重ならない").toBe(MOVESET_KEYS.length);
  });
});
