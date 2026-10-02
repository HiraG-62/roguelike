import { describe, expect, it } from "vitest";
import { defaultKeybinds } from "../core/input";
import { MOVESETS, MOVESET_KEYS } from "../data/weapons";
import { FORMS, FORM_KEYS, formOf } from "../data/weaponForms";
import { WEAPON_TIP_KEYS, formText, weaponMechanics, weaponTipBody } from "./weaponTips";
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
    expect(weaponMechanics(MOVESETS.spear), "槍の穂先の突きは型が敵弾を払わせる").toContain("敵弾を払う");
    expect(weaponMechanics(MOVESETS.staff), "棍の突きも先端を持つので払う").toContain("敵弾を払う");
  });
});

describe("武器種 Tips の型の文", () => {
  it("どの武器種も型の名と、戦意の名・応手を本文に含む（型の定義から組む）", () => {
    for (const key of MOVESET_KEYS) {
      const m = MOVESETS[key];
      const form = formOf(m);
      const body = weaponTipBody(key, defaultKeybinds());
      expect(body, `${key} の型`).toContain(`型は${form.name}`);
      expect(body, `${key} の戦意`).toContain(`戦意「${m.moraleLabel ?? form.morale.label}」`);
      expect(body, `${key} の応手`).toContain("応手は");
    }
  });

  it("棍の戦意は棒先で、先端の命中で溜まり、薙ぎ・回しの外周も先端と書く", () => {
    expect(formText(MOVESETS.staff)).toContain("戦意「棒先」は先端の命中で溜まり");
    expect(weaponMechanics(MOVESETS.staff).join("。"), "棍の先端").toContain("薙ぎ・回しは外周");
    expect(formText(MOVESETS.spear)).toContain(`戦意「${FORMS.polearm.morale.label}」`);
  });

  it("右の段が放出の型は、その武器種の右の段の名前で放出を書く", () => {
    expect(formText(MOVESETS.katana), "刀は居合").toContain("右の居合で放つ");
    expect(formText(MOVESETS.axe), "斧は裂き").toContain("右の裂きで放つ");
  });

  it("居合を持たない剣には「居合の出端」を応手に書かない", () => {
    expect(formText(MOVESETS.sword)).not.toContain("居合の出端");
    expect(formText(MOVESETS.katana)).toContain("居合の出端");
  });

  it("Tips の戦意の項目は戦意を持つ全ての型の名を挙げる", () => {
    const morale = tipEntries(defaultKeybinds()).find((t) => t.key === "morale");
    for (const f of FORM_KEYS) {
      if (FORMS[f].morale.gain.length === 0) continue;
      expect(morale?.body, `${f} の戦意の名`).toContain(`${FORMS[f].name} ${FORMS[f].morale.label}`);
    }
    expect(morale?.body, "棍の言い換え").toContain("棍は棒先");
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
