import { describe, expect, it } from "vitest";
import { FORM } from "./tuning";
import { FORMS, FORM_KEYS, type FormKey, formOf, movesetsOfForm } from "./weaponForms";
import { MOVESETS, MOVESET_KEYS, type MovesetKey, meleeChargeOf, shootsPrimary } from "./weapons";

/**
 * 武器の型（docs/ideas/weapon-forms-impl.md 3-1・3-10 の 4）。全武器種が型を持ち、型の放出の段が実在し、
 * 段数・重さが型の既定に収まる（外れるものは理由付きで WEIGHT_OVERRIDES に持つ）
 */

/** 型の既定の重さから外れる武器種（個性として今の重さを残す。docs/ideas/weapon-forms-impl.md「決めたこと」6） */
const WEIGHT_OVERRIDES: Readonly<Partial<Record<MovesetKey, string>>> = {
  flail: "連接棍は回しの溜めで振り回すので重打の中でも中（重いと回しの間ずっと足が遅い）",
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

  it("右レーンの段が放出の型（装薬の零距離砲を含む）は、束ねた武器種ごとに放出の段の key を右レーンに持つ", () => {
    for (const form of FORM_KEYS) {
      const release = FORMS[form].morale.release;
      if (release.kind !== "laneStep" && release.kind !== "nextShot") continue;
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

  it("満ちた後の左が放出の型のうち左で撃つ武器種は長銃だけ（射撃の放出は fireVolley が扱う）", () => {
    const gunPrimary = FORM_KEYS.filter((f) => FORMS[f].morale.release.kind === "nextPrimary" && movesetsOfForm(f).some((k) => shootsPrimary(MOVESETS[k])));
    expect(gunPrimary).toEqual(["rifle"]);
  });

  it("戦意が動く型（5a の剣・連刃・重打・長銃、銃の短銃・仕掛け・装薬・擲弾、他のレーンが増やす型）は全て上限と放出の最低を持つ", () => {
    expect(activeForms(), "溜まる出来事を持つ型").toEqual(expect.arrayContaining(["blade", "crusher", "flurry", "rifle", "pistol", "artillery", "powder", "shell"]));
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

  // 戦意の溜まる出来事の発生源が武器種に無いと、ゲージが事実上動かない（棍が先端を持たず長柄の戦意が溜まらなかった）
  it("先端の命中で溜まる型は、束ねた武器種すべてが先端判定と、先端を持つ段を持つ", () => {
    for (const form of FORM_KEYS) {
      if (!FORMS[form].morale.gain.some((g) => g.kind === "tipHit")) continue;
      for (const key of movesetsOfForm(form)) {
        const m = MOVESETS[key];
        expect(m.tip, `${key}（${form}）の先端判定`).toBeDefined();
        const tipped = m.steps.some((s) => s.shape.kind === "thrust" || (m.tip?.sweep === true && (s.shape.kind === "arc" || s.shape.kind === "circle")));
        expect(tipped, `${key} の左の段に先端を持つ段`).toBe(true);
      }
    }
  });

  it("繋いだ数で溜まる型は、束ねた武器種すべてが引き寄せの段を持つ", () => {
    for (const form of FORM_KEYS) {
      if (!FORMS[form].morale.gain.some((g) => g.kind === "pullHit")) continue;
      for (const key of movesetsOfForm(form)) {
        const m = MOVESETS[key];
        const pulls = [...m.steps, m.dashAttack, ...m.steps2.map((s) => (s.kind === "swing" ? s.step : undefined))].some((s) => s?.pull === true);
        expect(pulls, `${key}（${form}）の引き寄せ`).toBe(true);
      }
    }
  });

  it("敵の状態異常で溜まる型は、束ねた武器種すべてが左の段でその状態異常を付ける", () => {
    for (const form of FORM_KEYS) {
      for (const gain of FORMS[form].morale.gain) {
        if (gain.kind !== "applyStatus") continue;
        for (const key of movesetsOfForm(form)) {
          const applies = MOVESETS[key].steps.some((s) => (s.applies ?? []).some((a) => a.kind === gain.status));
          expect(applies, `${key}（${form}）の左の段が ${gain.status} を付ける`).toBe(true);
        }
      }
    }
  });
});
