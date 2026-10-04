import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  boons as boonsJson,
  combat as combatJson,
  enemies as enemiesJson,
  feel as feelJson,
  jobs as jobsJson,
  loot as lootJson,
  skills as skillsJson,
  ultimates as ultimatesJson,
  weapons as weaponsJson,
  world as worldJson,
} from "./assembled.gen";
import { buildSections, renderDictionary } from "./dictionary";

/** 辞書の置き場所（リポジトリのルートからの相対。vitest はルートで動く） */
const DICT_FILE = "docs/BALANCE_DICTIONARY.md";
/** npm run balance:dict がこれを付けて走らせ、辞書を書き出す */
const WRITE = process.env.BALANCE_DICT_WRITE === "1";

const DIRS: readonly (readonly [string, unknown])[] = [
  ["combat", combatJson],
  ["enemies", enemiesJson],
  ["jobs", jobsJson],
  ["weapons", weaponsJson],
  ["skills", skillsJson],
  ["boons", boonsJson],
  ["loot", lootJson],
  ["world", worldJson],
  ["feel", feelJson],
  ["ultimates", ultimatesJson],
];

describe("バランス数値の辞書", () => {
  it("同じ形の行が並ぶ表は * に畳み、配列は [] にして、オブジェクト名の説明で足りる葉は載せない", () => {
    const root = {
      stats: {
        _fields: { hp: "生命", resist: "属性耐性" },
        a: { hp: 1, resist: { fire: 1 }, speed: 1 },
        b: { hp: 2, resist: { ice: 1 }, speed: 1 },
        c: { hp: 3, speed: 1 },
      },
      moves: { steps: [{ _id: "primary1.slash", windup: 1 }, { _id: "primary2.slash", windup: 1 }] },
    };
    const sections = buildSections("x", root);
    expect(sections.map((s) => s.title)).toEqual(["x/stats", "x/moves"]);
    expect(sections[0]?.entries).toEqual([
      { path: "*.hp", description: "生命" },
      { path: "*.resist", description: "属性耐性" },
      { path: "*.speed", description: undefined },
    ]);
    expect(sections[1]?.entries).toEqual([{ path: "steps[].windup", description: undefined }]);
  });

  it(`${DICT_FILE} が各 JSON の _fields と食い違っていない（ずれたら npm run balance:dict）`, () => {
    const text = renderDictionary(DIRS);
    if (WRITE) writeFileSync(DICT_FILE, text);
    const current = existsSync(DICT_FILE) ? readFileSync(DICT_FILE, "utf8").replace(/\r\n/g, "\n") : "";
    expect(current === text, `${DICT_FILE} が古い（npm run balance:dict で書き直す）`).toBe(true);
  });
});
