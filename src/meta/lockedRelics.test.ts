import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { EMPTY_INPUT } from "../core/input";
import { FIXED_DT } from "../core/loop";
import { ReplayRecorder, createReplaySession, sanitizeReplay } from "../core/replay";
import { createRng, hashSeed } from "../core/rng";
import { generateItem, uniquesFor } from "../loot/generator";
import { createEmptyProfile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import type { RunSetup } from "../system/runSetup";
import { createQuestSave, lockedRelicKeys } from "./quests";

/** 名のある遺物が必ず出る揺らぎ（namedChance が 1 に張り付く大きさ） */
const NAMED_BOOST = 1000;
const ITEM_LEVEL = 30;
const ROLLS = 200;

function rollNamedKeys(exclude: readonly string[] | undefined, seed = 3): (string | undefined)[] {
  const rng = createRng(seed);
  return Array.from({ length: ROLLS }, () =>
    generateItem(rng, { itemLevel: ITEM_LEVEL, foundDepth: ITEM_LEVEL, rarityBoost: NAMED_BOOST, slot: "mainHand", now: 0, excludeNamed: exclude }).namedKey,
  );
}

describe("依頼報酬の遺物の除外: 生成", () => {
  it("除外した名のある遺物は出ない", () => {
    const pool = uniquesFor("mainHand", ITEM_LEVEL).map((u) => u.key);
    const [first] = pool;
    if (first === undefined) throw new Error("武器の名のある遺物が無い");
    const keys = rollNamedKeys([first]);
    expect(keys.some((k) => k !== undefined), "名のある遺物は出る").toBe(true);
    expect(keys.includes(first), "除外したものは出ない").toBe(false);
  });

  it("除外が空・省略なら従来と同じ結果", () => {
    expect(rollNamedKeys([]), "空").toEqual(rollNamedKeys(undefined));
  });

  it("未達成の依頼の遺物が除外集合に入る", () => {
    expect(lockedRelicKeys(createQuestSave()).length, "報酬の遺物 6 種").toBe(6);
  });
});

describe("依頼報酬の遺物の除外: リプレイ", () => {
  it("記録に除外集合が入り、再生のランも同じ集合で始まる", () => {
    const seedText = "locked-relics";
    const setup: RunSetup = { origin: "wanderer", modifiers: [], lockedRelics: ["unshakenScale", "lastBell"] };
    const profile = createEmptyProfile();
    const skillProfile = createDefaultSkillProfile();
    const recorder = new ReplayRecorder({ seedText, startedAt: 1, daily: false, setup }, profile, skillProfile);
    const state = createGame(hashSeed(seedText), seedText, profile, skillProfile, setup);
    expect(state.lockedRelics, "ランに写る").toEqual(["unshakenScale", "lastBell"]);
    for (let i = 0; i < 5; i++) step(state, recorder.record(EMPTY_INPUT), FIXED_DT);
    const data = recorder.finish({ depth: state.depth, kills: state.kills, score: state.score }, 2);
    const loaded = sanitizeReplay(JSON.parse(JSON.stringify(data)));
    expect(loaded?.lockedRelics, "保存の往復").toEqual(["unshakenScale", "lastBell"]);
    if (!loaded) throw new Error("sanitize failed");
    expect(createReplaySession(loaded).state.lockedRelics, "再生側").toEqual(["unshakenScale", "lastBell"]);
  });

  it("除外が無い旧データは [] で再生する", () => {
    const seedText = "old-data";
    const profile = createEmptyProfile();
    const skillProfile = createDefaultSkillProfile();
    const recorder = new ReplayRecorder({ seedText, startedAt: 1, daily: false }, profile, skillProfile);
    const data = recorder.finish({ depth: 1, kills: 0, score: 0 }, 2);
    expect("lockedRelics" in data, "空なら書かない").toBe(false);
    expect(createReplaySession(data).state.lockedRelics, "[]").toEqual([]);
  });
});
