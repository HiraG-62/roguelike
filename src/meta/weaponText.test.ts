import { describe, expect, it } from "vitest";
import { defaultKeybinds } from "../core/input";
import { MOVESETS, MOVESET_KEYS } from "../data/weapons";
import { FORMS, FORM_KEYS, formOf } from "../data/weaponForms";
import { featureText, formText, weaponMechanics } from "./weaponText";
import { TIP_CATEGORY_LABEL, tipEntries, tipsListTabs } from "./tips";

describe("武器の特色の本文", () => {
  it("どの武器種でも本文が組み立てられ、空でない", () => {
    for (const key of MOVESET_KEYS) expect(featureText(MOVESETS[key]).trim().length, key).toBeGreaterThan(0);
  });

  it("特色に押し方（左右の列・長押し・右の何段目）を書かない", () => {
    const inputs = /[左右]{2}|[左右](の|で|は|と|を)|長押し/;
    for (const key of MOVESET_KEYS) expect(featureText(MOVESETS[key]), key).not.toMatch(inputs);
  });

  it("近接の武器種は間合いを書き、銃の家系は書かない", () => {
    expect(featureText(MOVESETS.sword)).toContain("間合いはおよそ");
    expect(featureText(MOVESETS.longarm)).not.toContain("間合いはおよそ");
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

describe("武器の型の文", () => {
  it("どの武器種も型の名と、戦意の名・応手を本文に含む（型の定義から組む）", () => {
    for (const key of MOVESET_KEYS) {
      const m = MOVESETS[key];
      const form = formOf(m);
      const body = formText(m);
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

describe("Tips ノートと武器指南書の分離", () => {
  it("Tips ノートに武器種のタブを持たない（武器種は武器指南書へ移した）", () => {
    expect(Object.values(TIP_CATEGORY_LABEL), "武器種タブ").not.toContain("武器種");
    const names = new Set(MOVESET_KEYS.map((k) => MOVESETS[k].name));
    for (const tab of tipsListTabs(defaultKeybinds())) for (const e of tab.entries) expect(e.key.startsWith("weapon_"), e.key).toBe(false);
    expect(tipEntries(defaultKeybinds()).some((t) => t.term === "武器指南書"), "指南書の項目").toBe(true);
    expect(names.size).toBe(MOVESET_KEYS.length);
  });
});
