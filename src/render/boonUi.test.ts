import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { BOON } from "../data/tuning";
import { BOONS, BOON_KEYS, type BoonDef, type BoonKey, boonDef } from "../system/boons";
import { isGraded } from "../system/boonGrade";
import {
  BOON_MARKS,
  BOON_MARK_LABEL,
  boonCardColor,
  boonCardSubtitle,
  boonGradeTipLine,
  boonHudOrder,
  boonMark,
  curseOfferView,
} from "./boonUi";

describe("祝福カードの印", () => {
  it("枯れを満たすなら「潤い」、溢れを使うなら「受け皿」、どちらでもなければ「新たな流れ」", () => {
    expect(boonMark({ fills: ["burn"], feeds: [] }), "潤い").toBe("fill");
    expect(boonMark({ fills: [], feeds: ["kill"] }), "受け皿").toBe("feed");
    expect(boonMark({ fills: [], feeds: [] }), "新たな流れ").toBe("fresh");
    expect(boonMark({ fills: ["burn"], feeds: ["kill"] }), "両方なら穴を先に").toBe("fill");
  });

  it("3 種の印すべてに表示名がある", () => {
    for (const mark of BOON_MARKS) expect(BOON_MARK_LABEL[mark].length, mark).toBeGreaterThan(0);
  });
});

function findDef(pred: (d: BoonDef) => boolean, what: string): BoonDef {
  const def = BOON_KEYS.map(boonDef).find(pred);
  if (!def) throw new Error(`${what} の祝福が見つからない`);
  return def;
}

/** 系譜・結び・呪いの注記を持たず、格の対象になる祝福 */
const plainGraded = (): BoonDef => findDef((d) => isGraded(d) && !d.lineage && !d.duo && d.core !== true, "注記なしで格を持つ");

/** 芯を持たない今の定義でも試せるよう、一時的に芯にする（終わったら戻す） */
function withTempCore<T>(key: BoonKey, run: () => T): T {
  const def = BOONS[key];
  const had = def.core;
  def.core = true;
  try {
    return run();
  } finally {
    if (had === undefined) delete def.core;
    else def.core = had;
  }
}

describe("祝福カードの格の表示", () => {
  it("大祝福・神威のカードは格の語と色で描かれ、並は今までの副題のまま", () => {
    const def = plainGraded();
    const plain = boonCardSubtitle(def, 1);
    expect(plain.text, "注記の無い並は副題なし（希少度の語は出さない）").toBe("");
    expect(boonCardColor(def, 1), "並は希少度の色").toBe(BOON.rarityColor[def.rarity]);

    const grand = boonCardSubtitle(def, 2);
    expect(grand.text.startsWith("大祝福"), "大祝福の語が先頭").toBe(true);
    expect(grand.color, "大祝福の色").toBe(BOON.gradeColor.grand);
    expect(boonCardColor(def, 2), "札の枠も大祝福の色").toBe(BOON.gradeColor.grand);

    const divine = boonCardSubtitle(def, 3);
    expect(divine.text.startsWith("神威"), "神威の語が先頭").toBe(true);
    expect(divine.color, "神威の色").toBe(BOON.gradeColor.divine);
  });

  it("系譜の注記は並ではそのまま、格が付くと格の語の後ろに残る", () => {
    const def = findDef((d) => d.lineage !== undefined && isGraded(d), "系譜で格を持つ");
    const plain = boonCardSubtitle(def, 1);
    expect(plain.text.length, "並は系譜の注記だけ").toBeGreaterThan(0);
    const grand = boonCardSubtitle(def, 2);
    expect(grand.text.endsWith(plain.text), "格の語の後ろに系譜の注記").toBe(true);
  });

  it("呪い付きの札は格の色にならない", () => {
    const def = findDef((d) => d.cursed === true, "呪い付き");
    expect(boonCardColor(def, 3), "呪いの色のまま").toBe(BOON.cursedColor);
  });

  it("芯のカードは芯の注記を出す", () => {
    const key = plainGraded().key;
    const sub = withTempCore(key, () => boonCardSubtitle(boonDef(key), 1));
    expect(sub.text.startsWith("芯"), "芯の注記").toBe(true);
  });

  it("ツールチップの格の行は何が増えるかを語り、並・格なしでは出さない", () => {
    const def = plainGraded();
    expect(boonGradeTipLine(def, 1), "並は出さない").toBeNull();
    const grand = boonGradeTipLine(def, 2);
    expect(grand, "大祝福の行").not.toBeNull();
    expect(grand?.includes("効果量"), "効果量を語る").toBe(true);
    const cursed = findDef((d) => d.cursed === true, "呪い付き");
    expect(boonGradeTipLine(cursed, 3), "呪い付きは格を持たない").toBeNull();
  });
});

describe("芯の提示と HUD", () => {
  it("芯の提示では呪いの札を描かない", () => {
    const state = createGame(1);
    const keys = BOON_KEYS.filter((k) => !BOONS[k].cursed).slice(0, 3);
    state.depth = BOON.coreDepth + 1;
    state.boonChoice = { options: keys, hover: -1, curseHover: false, timer: 1, curseTaken: false, curse: null, core: false };
    const normal = curseOfferView(state);
    state.boonChoice = { ...state.boonChoice, core: true };
    expect(curseOfferView(state), "芯の提示は呪いの札なし").toBe("none");
    // 通常の提示で札が出るかは候補次第なので、芯だけが消す側であることを確かめる
    expect(["offer", "none"], "通常の提示").toContain(normal);
  });

  it("受けた呪いは通常の提示では名前を出す", () => {
    const state = createGame(1);
    const curse = findDef((d) => d.cursed === true, "呪い付き").key;
    const keys = BOON_KEYS.filter((k) => !BOONS[k].cursed).slice(0, 4);
    state.boonChoice = { options: keys, hover: -1, curseHover: false, timer: 1, curseTaken: true, curse };
    expect(curseOfferView(state), "受けた呪い").toBe("taken");
  });

  it("HUD の芯は先頭に出る", () => {
    const keys = BOON_KEYS.filter((k) => !BOONS[k].cursed && BOONS[k].core !== true).slice(0, 4);
    const coreKey = keys[2];
    if (coreKey === undefined) throw new Error("祝福が足りない");
    const order = withTempCore(coreKey, () => boonHudOrder(keys));
    expect(order[0], "芯が先頭").toBe(coreKey);
    expect(order, "残りは取得順").toEqual([coreKey, ...keys.filter((k) => k !== coreKey)]);
    expect(boonHudOrder(keys), "芯が無ければ取得順のまま").toEqual(keys);
  });
});
