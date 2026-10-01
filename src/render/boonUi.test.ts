import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { BOON } from "../data/tuning";
import { BOONS, BOON_KEYS, type BoonDef, type BoonKey, boonDef, grantBoon } from "../system/boons";
import { isGraded } from "../system/boonGrade";
import {
  BOON_MARKS,
  BOON_MARK_LABEL,
  boonCardColor,
  boonCardSubtitle,
  boonChoiceHeading,
  boonGradeTipLine,
  graceActionHead,
  temperLine,
  boonHudOrder,
  boonMark,
  curseOfferView,
} from "./boonUi";

describe("祝福カードの印", () => {
  it("枯れを満たすなら「潤い」、溢れを使うなら「受け皿」、どちらでもなければ「新たな系統」", () => {
    expect(boonMark({ fills: ["burn"], feeds: [] }), "潤い").toBe("fill");
    expect(boonMark({ fills: [], feeds: ["kill"] }), "受け皿").toBe("feed");
    expect(boonMark({ fills: [], feeds: [] }), "新たな系統").toBe("fresh");
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

/** 系譜の札で格の対象になる祝福 */
const plainGraded = (): BoonDef => findDef((d) => isGraded(d) && d.lineage !== undefined && d.card !== undefined, "系譜の札で格を持つ");

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
    expect(plain.text.startsWith("大祝福"), "並は格の語を出さない").toBe(false);
    expect(boonCardColor(def, 1), "並は札の種類の色").toBe(BOON.cardColor[def.card ?? "apex"]);

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

describe("系譜の札・加護の枠・錬磨の表示（段取り 7a）", () => {
  it("並の札は札の種類の色、至高・極致は格の色", () => {
    const law = findDef((d) => d.card === "law" && !d.cursed, "摂理");
    expect(boonCardColor(law, 1), "摂理の色").toBe(BOON.cardColor.law);
    const grace = findDef((d) => d.card === "grace" && !d.cursed, "加護");
    expect(boonCardColor(grace, 1), "加護の色").toBe(BOON.cardColor.grace);
    expect(boonCardColor(grace, 4), "至高の色").toBe(BOON.gradeColor.supreme);
    expect(boonCardColor(grace, 5), "極致の色").toBe(BOON.gradeColor.pinnacle);
  });

  it("加護の行動の見出しは今の枚数と枠で変わり、副題に載る", () => {
    const state = createGame(1);
    const before = graceActionHead(state, "primary");
    grantBoon(state, "emberSeed");
    const after = graceActionHead(state, "primary");
    expect(after, "1 枚宿ると見出しが変わる").not.toBe(before);
    const sub = boonCardSubtitle(BOONS.emberSeed, 1, after);
    expect(sub.text.endsWith(after), "副題の末尾に行動の見出し").toBe(true);
    expect(boonCardSubtitle(BOONS.emberSeed, 1).text, "見出しを渡さなくても注記は出る").not.toBe("");
  });

  it("融合の札は系譜ではなく融合の注記を出す", () => {
    const fused = boonCardSubtitle(BOONS.thunderBlast, 1);
    expect(fused.text.startsWith("融合"), "融合の注記").toBe(true);
    expect(fused.text, "系譜の札とは違う注記").not.toBe(boonCardSubtitle(BOONS.emberSeed, 1).text);
  });

  it("錬磨・入れ替えの第 2 段・系譜の提示は題が変わり、呪いの札を出さない", () => {
    const state = createGame(1);
    const base = { hover: -1, curseHover: false, timer: 1, curseTaken: false, curse: null };
    const plain = boonChoiceHeading(state, { ...base, options: ["emberSeed"] });
    const lineage = boonChoiceHeading(state, { ...base, options: ["emberSeed"], lineage: "ash" });
    const temper = boonChoiceHeading(state, { ...base, options: ["emberSeed"], mode: "temper" });
    const replace = boonChoiceHeading(state, {
      ...base,
      options: ["emberSeed"],
      replace: { incoming: "frostBreath", incomingGrade: 1, action: "primary", outgoing: ["emberSeed"] },
    });
    expect(new Set([plain.title, lineage.title, temper.title, replace.title]).size, "4 つの題は別").toBe(4);
    state.boonChoice = { ...base, options: ["emberSeed"], mode: "temper" };
    expect(curseOfferView(state), "錬磨に呪いの札なし").toBe("none");
    expect(temperLine(2), "錬磨の行は格 2 → 3").not.toBe(temperLine(3));
  });
});
