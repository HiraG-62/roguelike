import { describe, expect, it } from "vitest";
import { FORM } from "./tuning";
import { FORMS, FORM_KEYS, type FormKey, formOf, movesetsOfForm } from "./weaponForms";
import { MOVESETS, MOVESET_KEYS, type MovesetKey, isGun, meleeChargeOf } from "./weapons";

/**
 * 武器の型（docs/ideas/weapon-forms-impl.md 3-1・3-10 の 4）。全武器種が型を持ち、型の放出の段が実在し、
 * 段数・重さが型の既定に収まる（外れるものは理由付きで WEIGHT_OVERRIDES に持つ）
 */

/** 型の既定の重さから外れる武器種（個性として今の重さを残す。docs/ideas/weapon-forms-impl.md「決めたこと」6） */
const WEIGHT_OVERRIDES: Readonly<Partial<Record<MovesetKey, string>>> = {
  flail: "連接棍は回しの溜めで振り回すので重打の中でも中（重いと回しの間ずっと止まる）",
  grenade: "擲弾は曲射を置いて下がる砲なので中（重いと置いた後に逃げられない）",
  trapper: "仕掛けは設置弾を撒いて誘う砲なので中（重いと撒く間に囲まれる）",
};

/** 段数: 近接は左の連撃、銃の家系は左に段が無いので右レーン */
function stepCount(key: MovesetKey): number {
  const m = MOVESETS[key];
  return m.steps.length > 0 ? m.steps.length : m.steps2.length;
}

/** 戦意の溜まる出来事を持つ型（5a の 4 型。5b で増える） */
function activeForms(): FormKey[] {
  return FORM_KEYS.filter((k) => FORMS[k].morale.gain.length > 0);
}

describe("武器の型", () => {
  it("型の数値（balance/weapons/FORM）のキー集合が FORM_KEYS と一致する", () => {
    expect(Object.keys(FORM).sort(), "FORM の JSON と FORM_KEYS").toEqual([...FORM_KEYS].sort());
  });

  it("型の key は武器種の key と重ならない（grep とログで混ざらないように）", () => {
    const movesets: ReadonlySet<string> = new Set(MOVESET_KEYS);
    expect(FORM_KEYS.filter((k) => movesets.has(k)), "重なった key").toEqual([]);
  });

  it("全ての武器種が型を持つ", () => {
    for (const key of MOVESET_KEYS) {
      expect(FORM_KEYS, `${key} の型`).toContain(MOVESETS[key].form);
      expect(formOf(MOVESETS[key]).key, `${key} の formOf`).toBe(MOVESETS[key].form);
    }
  });

  it("武器種の段数が型の段数の幅に入る", () => {
    for (const key of MOVESET_KEYS) {
      const form = formOf(MOVESETS[key]);
      const n = stepCount(key);
      expect(n, `${key}（${form.key}）の段数の下限`).toBeGreaterThanOrEqual(form.steps.min);
      expect(n, `${key}（${form.key}）の段数の上限`).toBeLessThanOrEqual(form.steps.max);
    }
  });

  it("武器種の重さは型の既定か、理由付きの個性（WEIGHT_OVERRIDES）", () => {
    for (const key of MOVESET_KEYS) {
      const form = formOf(MOVESETS[key]);
      const differs = MOVESETS[key].weight !== form.weight;
      expect(differs, `${key}: 型 ${form.key} の既定 ${form.weight} と今の ${MOVESETS[key].weight}`).toBe(WEIGHT_OVERRIDES[key] !== undefined);
    }
  });

  it("右レーンの段が放出の型は、束ねた武器種ごとに放出の段の key を右レーンに持つ", () => {
    for (const form of FORM_KEYS) {
      const release = FORMS[form].morale.release;
      if (release.kind !== "laneStep") continue;
      for (const key of movesetsOfForm(form)) {
        const keys = MOVESETS[key].steps2.map((s) => s.key);
        expect(
          keys.some((k) => k !== undefined && release.keys.includes(k)),
          `${key}（${form}）の右レーン ${keys.join(",")} に放出の段 ${release.keys.join(",")}`,
        ).toBe(true);
      }
    }
  });

  it("最大段の溜めが放出の型は、束ねた武器種すべてが溜めを持つ", () => {
    for (const form of FORM_KEYS) {
      if (FORMS[form].morale.release.kind !== "maxCharge") continue;
      for (const key of movesetsOfForm(form)) expect(meleeChargeOf(MOVESETS[key]), `${key} の溜め`).toBeDefined();
    }
  });

  it("満ちた後の左が放出の型のうち銃の家系は長銃だけ（射撃の放出は fireVolley が扱う）", () => {
    const gunPrimary = FORM_KEYS.filter((f) => FORMS[f].morale.release.kind === "nextPrimary" && movesetsOfForm(f).some((k) => isGun(MOVESETS[k])));
    expect(gunPrimary).toEqual(["rifle"]);
  });

  it("5a で戦意が動くのは剣・連刃・重打・長銃の 4 型で、全て上限と放出の最低を持つ", () => {
    expect(activeForms().sort(), "溜まる出来事を持つ型").toEqual(["blade", "crusher", "flurry", "rifle"]);
    for (const form of activeForms()) {
      const n = FORMS[form].morale.numbers;
      expect(n.max, `${form} の上限`).toBeGreaterThan(0);
      expect(n.releaseMin, `${form} の放出の最低`).toBeGreaterThan(0);
      expect(n.releaseMin, `${form} の放出の最低は上限以下`).toBeLessThanOrEqual(n.max);
    }
  });

  it("全ての型が終撃に最終段を含み、応手を 1 つ以上持つ", () => {
    for (const form of FORM_KEYS) {
      expect(FORMS[form].finisher, `${form} の終撃`).toContain("lastStep");
      expect(FORMS[form].riposte.length, `${form} の応手`).toBeGreaterThan(0);
    }
  });
});
