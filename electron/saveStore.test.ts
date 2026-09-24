import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope } from "../src/save/fileEnvelope";
import { createSaveStore } from "./saveStore";

const PROFILE_KEY = "roguelike.profile.v1";
const SKILLS_KEY = "roguelike.skills.v1";
const APP = "0.0.0-test";

let root = "";
let dir = "";
let clock = 1000;
const now = (): number => clock++;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "depthbreaker-save-"));
  dir = path.join(root, "save");
  clock = 1000;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("saveStore", () => {
  it("save/ が無ければ作る", () => {
    createSaveStore(dir, APP, now).readAll();
    expect(fs.existsSync(dir), "readAll で save/ が作られる").toBe(true);
  });

  it("write したキーを readAll で読み戻せる", () => {
    const store = createSaveStore(dir, APP, now);
    store.write(PROFILE_KEY, JSON.stringify({ version: 1, gold: 5 }));
    expect(store.readAll()).toEqual({ [PROFILE_KEY]: JSON.stringify({ version: 1, gold: 5 }) });
    const text = fs.readFileSync(path.join(dir, "profile.json"), "utf8");
    expect(decodeEnvelope(text, PROFILE_KEY), "ファイルは封筒に包まれている").toBe(JSON.stringify({ version: 1, gold: 5 }));
    expect(fs.existsSync(path.join(dir, "profile.json.tmp")), "tmp は残らない").toBe(false);
  });

  it("write は前の版を .bak に残す", () => {
    const store = createSaveStore(dir, APP, now);
    store.write(PROFILE_KEY, JSON.stringify({ n: 1 }));
    store.write(PROFILE_KEY, JSON.stringify({ n: 2 }));
    store.write(PROFILE_KEY, JSON.stringify({ n: 3 }));
    const bak = fs.readFileSync(path.join(dir, "profile.json.bak"), "utf8");
    expect(decodeEnvelope(bak, PROFILE_KEY), ".bak は直前の版（既存の .bak も上書きできる）").toBe(JSON.stringify({ n: 2 }));
  });

  it("本体が壊れていれば .bak から読み、本体を .corrupt-* に改名する", () => {
    const store = createSaveStore(dir, APP, now);
    store.write(PROFILE_KEY, JSON.stringify({ n: 1 }));
    store.write(PROFILE_KEY, JSON.stringify({ n: 2 }));
    fs.writeFileSync(path.join(dir, "profile.json"), "{壊れた", "utf8");
    expect(store.readAll()[PROFILE_KEY], ".bak の版が読める").toBe(JSON.stringify({ n: 1 }));
    const names = fs.readdirSync(dir);
    expect(names.includes("profile.json"), "壊れた本体は元の名前に残らない").toBe(false);
    expect(names.some((n) => n.startsWith("profile.json.corrupt-")), "壊れた本体は .corrupt-* に保全される").toBe(true);
  });

  it("別のキーの封筒が置かれていたら読まない", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "profile.json"), encodeEnvelope(SKILLS_KEY, "{}", 1, APP), "utf8");
    expect(createSaveStore(dir, APP, now).readAll()[PROFILE_KEY], "key 不一致は読めない扱い").toBeUndefined();
  });

  it("未知のキーは write で例外", () => {
    const store = createSaveStore(dir, APP, now);
    expect(() => store.write("../evil", "{}"), "任意パスへは書かせない").toThrow();
  });

  it("remove は本体を .bak に回し readAll から消える", () => {
    const store = createSaveStore(dir, APP, now);
    store.write(PROFILE_KEY, JSON.stringify({ n: 1 }));
    store.remove(PROFILE_KEY);
    expect(fs.existsSync(path.join(dir, "profile.json")), "本体は無くなる").toBe(false);
    expect(store.readAll()[PROFILE_KEY], "本体が無ければ .bak から読める（1 世代は戻せる）").toBe(JSON.stringify({ n: 1 }));
  });

  it("import.json があれば取り込んで import.done-* に改名する", () => {
    fs.mkdirSync(dir, { recursive: true });
    const entries = { [PROFILE_KEY]: JSON.stringify({ n: 7 }), "other.key": "{}", [SKILLS_KEY]: 3 };
    fs.writeFileSync(path.join(dir, "import.json"), JSON.stringify({ format: 1, entries }), "utf8");
    const store = createSaveStore(dir, APP, now);
    expect(store.consumeImportFile(), "既知キーかつ文字列の値だけ取り込む").toEqual([PROFILE_KEY]);
    expect(store.readAll()[PROFILE_KEY]).toBe(JSON.stringify({ n: 7 }));
    const names = fs.readdirSync(dir);
    expect(names.includes("import.json"), "取り込んだ import.json は残らない").toBe(false);
    expect(names.some((n) => /^import\.done-\d+\.json$/.test(n)), "import.done-* に改名される").toBe(true);
    expect(store.consumeImportFile(), "2 回目は何もしない").toEqual([]);
  });

  it("形式の違う import.json は取り込まずに残す", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "import.json"), JSON.stringify({ format: 99, entries: {} }), "utf8");
    expect(createSaveStore(dir, APP, now).consumeImportFile()).toEqual([]);
    expect(fs.existsSync(path.join(dir, "import.json")), "直して再起動できるよう残す").toBe(true);
  });
});
