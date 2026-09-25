import { describe, expect, it } from "vitest";
import { CRAFT_KEY } from "../loot/craftingStore";
import { PROFILE_KEY } from "../loot/profile";
import { ACHIEVEMENTS_KEY } from "../meta/achievements";
import { CODEX_KEY } from "../meta/codexStore";
import { HUB_KEY } from "../meta/hubStore";
import { QUEST_KEY } from "../meta/questStore";
import { SKILL_PROFILE_KEY } from "../skills/persistence";
import { REPLAY_STORE_KEY } from "../ui/replayStore";
import { KEYBINDS_KEY, PADBINDS_KEY, SETTINGS_KEY } from "../ui/settings";
import { SAVE_FILES, SAVE_FILE_FORMAT, decodeEnvelope, encodeEnvelope, fileForKey } from "./fileEnvelope";

const KEY = "roguelike.profile.v1";

describe("セーブファイルの封筒", () => {
  it("encode → decode で JSON 文字列が往復する", () => {
    const json = JSON.stringify({ version: 1, stash: [{ id: "a" }], meta: { runs: 3 } });
    const text = encodeEnvelope(KEY, json, 1234, "0.0.12");
    expect(decodeEnvelope(text, KEY)).toBe(json);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.format, "ファイル形式の版").toBe(SAVE_FILE_FORMAT);
    expect(parsed.savedAt).toBe(1234);
    expect(parsed.app).toBe("0.0.12");
  });

  it("key が一致しない封筒は null", () => {
    const text = encodeEnvelope(KEY, "{}", 0, "0.0.12");
    expect(decodeEnvelope(text, "roguelike.skills.v1")).toBeNull();
  });

  it("format が未知なら null", () => {
    const text = JSON.stringify({ format: SAVE_FILE_FORMAT + 1, key: KEY, savedAt: 0, app: "x", data: {} });
    expect(decodeEnvelope(text, KEY)).toBeNull();
  });

  it("壊れた JSON は null", () => {
    expect(decodeEnvelope("{ broken", KEY)).toBeNull();
    expect(decodeEnvelope("[]", KEY), "オブジェクトでない").toBeNull();
    expect(decodeEnvelope(JSON.stringify({ format: SAVE_FILE_FORMAT, key: KEY }), KEY), "data が無い").toBeNull();
  });

  it("SAVE_FILES のキー集合が各ストアの *_KEY 定数の集合と一致する", () => {
    const storeKeys = [
      PROFILE_KEY,
      SKILL_PROFILE_KEY,
      CRAFT_KEY,
      SETTINGS_KEY,
      KEYBINDS_KEY,
      PADBINDS_KEY,
      REPLAY_STORE_KEY,
      CODEX_KEY,
      QUEST_KEY,
      ACHIEVEMENTS_KEY,
      HUB_KEY,
    ];
    expect(Object.keys(SAVE_FILES).sort(), "キーの追加漏れ").toEqual([...storeKeys].sort());
    const files = Object.values(SAVE_FILES);
    expect(new Set(files).size, "ファイル名は重複しない").toBe(files.length);
  });

  it("fileForKey は既知キーだけファイル名を返す", () => {
    expect(fileForKey(KEY)).toBe("profile.json");
    expect(fileForKey("roguelike.unknown.v1")).toBeNull();
    expect(fileForKey("toString"), "プロトタイプの名前は拒否").toBeNull();
  });
});
