import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EFFECTS, FLOAT_TEXT } from "../data/tuning";
import { MOMENT_TEXT } from "../data/weaponForms";
import { damageEnemy } from "./combat";
import { addFloatingText, addFloatingTextOnce, addHeadLabel, onHitFx } from "./effects";
import { noteBrim, noteRelease } from "./moments";
import { arena, placeEnemy } from "./testHelpers";

/**
 * 浮き文字（状態表示）は名詞・体言止め（docs/GLOSSARY.md「表示文字列の書き方」）。
 * 資料を読まずに文の形（「奥義が終わった」「鎧が砕けた」）で足しても、ここで落ちるようにする
 */

const ROOT = join(__dirname, "..", "..");
/** 浮き文字を出すロジックの置き場所 */
const SCAN_DIRS = ["src/system", "src/skills"];
/** addFloatingText / addFloatingTextOnce / addHeadLabel に直接渡した文字列 */
const FLOAT_LITERAL = /(?:addFloatingText|addFloatingTextOnce|addHeadLabel)\([^;]*?"([^"]+)"/g;
/** 浮き文字に渡す定数（XXX_TEXT） */
const TEXT_CONST = /const [A-Z_]*TEXT = "([^"]+)"/g;
/** 文の終わり（動詞の過去・終止形、断定、否定、です・ます） */
const SENTENCE_END = /(た|だ|る|ない|ます|です)[!！。]?$/;
/** 体言止めにしないもの。足すときは理由を書く */
const ALLOW = new Set([
  // ボスの台詞（フレーバーは雰囲気を残してよい）
  "手下ども、出番だ",
  // 迫る脅威の予告。今の状態ではなく、これから起きることの警告
  "死神が来る",
  "狙われている",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".test.ts"))
    .map((d) => join(d.parentPath, d.name));
}

function sentenceTexts(): string[] {
  const found: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      for (const re of [FLOAT_LITERAL, TEXT_CONST]) {
        for (const m of src.matchAll(re)) {
          const text = m[1];
          if (text === undefined || ALLOW.has(text) || !SENTENCE_END.test(text)) continue;
          found.push(`${relative(ROOT, file)}: 「${text}」`);
        }
      }
    }
  }
  return found;
}

describe("浮き文字の表記", () => {
  it("状態の浮き文字は文にせず体言止めにする（奥義終了・鎧破壊 など）", () => {
    expect(sentenceTexts(), "GLOSSARY の「状態表示は名詞・体言止め」に直す").toEqual([]);
  });
});

const ORIGIN = { x: 0, y: 0 };

describe("浮き文字を減らす（撃破・コンボ・瞬間）", () => {
  it("撃破でスコアの「+N」は出ない", () => {
    const state = arena(31);
    const e = placeEnemy(state, "slime", 30);
    state.texts = [];
    damageEnemy(state, e, 99999, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(e.hp, "倒れている").toBeLessThanOrEqual(0);
    expect(state.texts.filter((t) => /^\+\d+$/.test(t.text)), "スコアの文字").toEqual([]);
    expect(state.texts.filter((t) => t.kind === "normal").length, "ダメージの数字は 1 つ").toBe(1);
  });

  it("コンボの節目では文字を出さない（輪と音だけ）", () => {
    const state = arena(32);
    const e = placeEnemy(state, "slime", 30);
    state.texts = [];
    state.combo.count = EFFECTS.comboMilestones[0] ?? 10;
    onHitFx(state, e, { kind: "melee" });
    expect(state.texts, "「N コンボ！」が出ない").toEqual([]);
    expect(state.shapes.length, "輪は出る").toBeGreaterThan(0);
  });

  it("先制・放出の語は出ないが、充溢は小さい頭上の文字として残る", () => {
    const state = arena(33);
    state.texts = [];
    noteRelease(state, 3);
    expect(state.texts.map((t) => t.text), "放出").not.toContain(MOMENT_TEXT.release);
    noteBrim(state);
    const brim = state.texts.filter((t) => t.text === MOMENT_TEXT.brim || t.text === MOMENT_TEXT.reload);
    expect(brim.length, "充溢か装填が出る").toBe(1);
    expect(brim[0]?.kind, "技名の扱い").toBe("label");
    expect(brim[0]?.head, "頭上の文字").toBe(true);
  });
});

describe("技名は自分の頭上に 1 つだけ", () => {
  it("新しい技名が出たら前の技名を消す", () => {
    const state = arena(34);
    state.texts = [];
    addHeadLabel(state, ORIGIN, "二連斬", "#fff");
    addHeadLabel(state, ORIGIN, "パリィ！", "#fff");
    const heads = state.texts.filter((t) => t.head === true);
    expect(heads.map((t) => t.text), "最後の語だけ残る").toEqual(["パリィ！"]);
  });

  it("敵の状態の文字や数字は技名に消されない", () => {
    const state = arena(35);
    state.texts = [];
    addFloatingText(state, ORIGIN, "12", "#fff", 1, 0.6, "normal");
    addFloatingText(state, ORIGIN, "鎧割れ", "#fff", 1, 0.6, "status");
    addHeadLabel(state, ORIGIN, "二連斬", "#fff");
    addHeadLabel(state, ORIGIN, "三連斬", "#fff");
    expect(state.texts.map((t) => t.text).sort()).toEqual(["12", "三連斬", "鎧割れ"].sort());
  });

  it("技名は label で、寿命の上限に切り詰められる", () => {
    const state = arena(36);
    state.texts = [];
    addHeadLabel(state, ORIGIN, "二連斬", "#fff", 5);
    expect(state.texts[0]?.kind).toBe("label");
    expect(state.texts[0]?.maxLife, "寿命の上限").toBeLessThanOrEqual(FLOAT_TEXT.lifeCap.label);
  });
});

describe("同じ文字の重複を抑える（addFloatingTextOnce）", () => {
  it("同じ敵の近くに同じ文字が濃く残っていれば出さない（反応名・弱点）", () => {
    const state = arena(37);
    state.texts = [];
    expect(addFloatingTextOnce(state, ORIGIN, "蒸発", "#fff", 1, 0.5, "status"), "最初は出る").toBe(true);
    expect(addFloatingTextOnce(state, { x: 3, y: 2 }, "蒸発", "#fff", 1, 0.5, "status"), "近くの同じ文字は出ない").toBe(false);
    expect(state.texts.length).toBe(1);
  });

  it("離れた敵・別の語・薄れた文字なら出す", () => {
    const state = arena(38);
    state.texts = [];
    addFloatingTextOnce(state, ORIGIN, "蒸発", "#fff", 1, 0.5, "status");
    expect(addFloatingTextOnce(state, { x: 200, y: 0 }, "蒸発", "#fff", 1, 0.5, "status"), "離れた敵").toBe(true);
    expect(addFloatingTextOnce(state, ORIGIN, "凍結", "#fff", 1, 0.5, "status"), "別の語").toBe(true);
    for (const t of state.texts) t.life = t.maxLife * 0.1;
    expect(addFloatingTextOnce(state, ORIGIN, "蒸発", "#fff", 1, 0.5, "status"), "消えかけなら出る").toBe(true);
  });

  it("sameWord は位置が違っても同じ語を sameWordSec 秒に 1 回までにする", () => {
    const state = arena(39);
    state.texts = [];
    state.time = 10;
    expect(addFloatingTextOnce(state, ORIGIN, "湧水", "#fff", 1, 0.5, "label", { sameWord: true })).toBe(true);
    state.texts = [];
    state.time = 10 + FLOAT_TEXT.sameWordSec / 2;
    expect(addFloatingTextOnce(state, { x: 300, y: 0 }, "湧水", "#fff", 1, 0.5, "label", { sameWord: true }), "半分の間隔では出ない").toBe(false);
    state.time = 10 + FLOAT_TEXT.sameWordSec + 0.01;
    expect(addFloatingTextOnce(state, ORIGIN, "湧水", "#fff", 1, 0.5, "label", { sameWord: true }), "間隔が空けば出る").toBe(true);
  });

  it("sameWord でなければ位置だけで判定し、時刻を記憶しない", () => {
    const state = arena(40);
    state.texts = [];
    addFloatingTextOnce(state, ORIGIN, "湧水", "#fff", 1, 0.5, "label");
    state.texts = [];
    expect(addFloatingTextOnce(state, ORIGIN, "湧水", "#fff", 1, 0.5, "label"), "文字が消えていれば出る").toBe(true);
  });
});

describe("種類ごとの寿命の上限", () => {
  it("status・label は上限で切り詰め、数字と告知の長い寿命は保つ", () => {
    const state = arena(41);
    state.texts = [];
    addFloatingText(state, ORIGIN, "鎧割れ", "#fff", 1, 9, "status");
    addFloatingText(state, ORIGIN, "拾い物", "#fff", 1, 9, "label");
    addFloatingText(state, ORIGIN, "CLEAR", "#fff", 1, 9, "notice");
    addFloatingText(state, ORIGIN, "12", "#fff", 1, 9, "normal");
    const life = (text: string): number => state.texts.find((t) => t.text === text)?.maxLife ?? -1;
    expect(life("鎧割れ")).toBe(FLOAT_TEXT.lifeCap.status);
    expect(life("拾い物")).toBe(FLOAT_TEXT.lifeCap.label);
    expect(life("CLEAR")).toBe(FLOAT_TEXT.lifeCap.notice);
    expect(life("12"), "数字は呼び出し側のまま").toBe(9);
  });
});
