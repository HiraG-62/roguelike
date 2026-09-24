import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { MOVESET_KEYS } from "../data/weapons";
import { generateItem } from "../loot/generator";
import { createEmptyProfile } from "../loot/types";
import { HUB_SPOT_KEYS } from "../map/hubMap";
import { createAchievementSave } from "../meta/achievements";
import { createCodexSave } from "../meta/codex";
import { createQuestSave } from "../meta/quests";
import { createDefaultSkillProfile } from "../skills/persistence";
import { createHub, trialKeystoneKeys } from "../system/hub";
import {
  NO_TRIAL_KEY,
  altarTabs,
  createHoldLatch,
  hubOpenFor,
  hubProgressSource,
  latchedHold,
  openInventoryAt,
  rackEntryOf,
  rackTabs,
  resetHoldLatch,
  trialKeyOfEntry,
} from "./hubFlow";
import { createInventoryUi } from "./inventory";

describe("拠点の台から開く画面", () => {
  it("鍛冶場は残響タブを開く", () => {
    expect(hubOpenFor("forge"), "鍛冶場 → 装備画面の残響タブ").toEqual({ kind: "inventory", tab: "echo" });
  });

  it("図書館はスキルタブを開く", () => {
    expect(hubOpenFor("library"), "図書館 → 装備画面のスキルタブ").toEqual({ kind: "inventory", tab: "skills" });
  });

  it("庭は芽の 2 択つきの装備タブを開く", () => {
    expect(hubOpenFor("garden"), "庭 → 装備タブ + 芽").toEqual({ kind: "inventory", tab: "equipment", bud: true });
  });

  it("井戸は起点画面へ進む", () => {
    expect(hubOpenFor("well"), "井戸 → 起点画面").toEqual({ kind: "screen", screen: "origin" });
  });

  it("掲示板は依頼の一覧を開く", () => {
    expect(hubOpenFor("board"), "掲示板 → 依頼の一覧").toEqual({ kind: "screen", screen: "questBoard" });
  });

  it("記録室の 3 台は履歴・図鑑・実績を開く", () => {
    expect(hubOpenFor("history"), "履歴の台").toEqual({ kind: "screen", screen: "history" });
    expect(hubOpenFor("codex"), "図鑑の台").toEqual({ kind: "screen", screen: "codex" });
    expect(hubOpenFor("achievements"), "実績の台").toEqual({ kind: "screen", screen: "achievements" });
  });

  it("祭壇は祭壇の一覧を開き、全ての台に行き先がある", () => {
    expect(hubOpenFor("altar"), "祭壇 → 祭壇の一覧").toEqual({ kind: "altar" });
    for (const spot of HUB_SPOT_KEYS) expect(hubOpenFor(spot), `${spot} の行き先`).toBeDefined();
  });
});

describe("祭壇の一覧", () => {
  it("祭壇の一覧は全誓約を並べ、試している誓約に印を付ける", () => {
    const keys = trialKeystoneKeys();
    const target = keys[0];
    if (target === undefined) throw new Error("誓約が 1 つも無い");
    const entries = altarTabs(target)[0]?.entries ?? [];
    const listed = entries.map((e) => e.key).filter((k) => k !== NO_TRIAL_KEY);
    expect(listed, "全誓約が並ぶ").toEqual(keys);
    const marked = entries.filter((e) => e.marked).map((e) => e.key);
    expect(marked, "試している誓約だけに印").toEqual([target]);
  });

  it("何も試していなければ「誓約を外す」行に印が付く", () => {
    const entries = altarTabs(null)[0]?.entries ?? [];
    expect(entries.filter((e) => e.marked).map((e) => e.key), "外す行に印").toEqual([NO_TRIAL_KEY]);
  });

  it("行の key を試す誓約に読み替える（外す行は null）", () => {
    expect(trialKeyOfEntry(NO_TRIAL_KEY), "外す行").toBeNull();
    expect(trialKeyOfEntry("ks_glassCannon"), "誓約の行").toBe("ks_glassCannon");
  });
});

describe("拠点で装備画面を開く", () => {
  it("指定のタブで開き、拠点の state を止める", () => {
    const session = createHub(createEmptyProfile(), createDefaultSkillProfile(), new Set());
    const ui = createInventoryUi();
    openInventoryAt(session.state, ui, "skills");
    expect(ui.open, "装備画面が開く").toBe(true);
    expect(ui.tab, "スキルタブ").toBe("skills");
    expect(session.state.paused, "拠点の時間を止める").toBe(true);
    expect(ui.bud.open, "芽の指定が無ければモーダルは開かない").toBe(false);
  });

  it("芽が無ければ庭でもモーダルは開かない", () => {
    const session = createHub(createEmptyProfile(), createDefaultSkillProfile(), new Set());
    const ui = createInventoryUi();
    openInventoryAt(session.state, ui, "equipment", true);
    expect(session.state.pendingBud, "芽は無い").toBeNull();
    expect(ui.bud.open, "芽が無いのでモーダルは閉じたまま").toBe(false);
  });
});

describe("拠点の成長の材料", () => {
  it("ラン数・スキル石の数・芽の有無を保存データから集める", () => {
    const profile = createEmptyProfile();
    profile.meta.runs = 4;
    const skills = createDefaultSkillProfile();
    const src = hubProgressSource(profile, skills, createCodexSave(), createAchievementSave(), createQuestSave());
    expect(src.runs, "通算ラン数").toBe(4);
    expect(src.stoneCount, "スキル石の数").toBe(skills.stones.length);
    expect(src.hasBud, "芽を持ったことが無い").toBe(false);
  });

  it("芽吹いた履歴のある遺物があれば芽を持ったとみなす", () => {
    const profile = createEmptyProfile();
    const item = generateItem(createRng(1), { itemLevel: 1, foundDepth: 1, now: 0 });
    const roll = { key: "life", value: 1 };
    item.buds = [{ milestone: "kills:50", options: [roll, roll], chosen: 0 }];
    profile.stash.push(item);
    const src = hubProgressSource(profile, createDefaultSkillProfile(), createCodexSave(), createAchievementSave(), createQuestSave());
    expect(src.hasBud, "芽の履歴がある").toBe(true);
  });
});

describe("出撃の長押し", () => {
  it("拠点に入った時点で押していた決定キーは、一度離すまで数えない", () => {
    const latch = createHoldLatch();
    expect(latchedHold(latch, true), "入った直後の押しっぱなしは数えない").toBe(false);
    expect(latchedHold(latch, false), "離した").toBe(false);
    expect(latchedHold(latch, true), "押し直しは数える").toBe(true);
    resetHoldLatch(latch);
    expect(latchedHold(latch, true), "リセット後は再び離すまで数えない").toBe(false);
  });
});

describe("武器掛けの一覧", () => {
  it("武器掛けの台は武器掛けの一覧を開く", () => {
    expect(hubOpenFor("rack"), "武器掛け → 一覧").toEqual({ kind: "rack" });
  });

  it("武器掛けの一覧は全武器種（銃の家系を含む）を並べ、試しているものに印を付ける", () => {
    const [movesets] = rackTabs("greatsword");
    if (!movesets) throw new Error("タブが無い");
    const movesetKeys = movesets.entries.map((e) => rackEntryOf(e.key)).filter((r) => r?.key !== null);
    expect(movesetKeys.map((r) => r?.key), "全武器種").toEqual([...MOVESET_KEYS]);
    expect(movesets.entries.filter((e) => e.marked).map((e) => e.key), "試している武器種だけに印").toEqual(["moveset:greatsword"]);
    const [clear] = rackTabs(null)[0]?.entries ?? [];
    expect(clear?.marked, "何も試していなければ「装備のまま」に印").toBe(true);
  });

  it("rackEntryOf は moveset の行を読む", () => {
    expect(rackEntryOf("moveset:whip"), "武器種").toEqual({ kind: "moveset", key: "whip" });
    expect(rackEntryOf("moveset:none"), "武器種を外す").toEqual({ kind: "moveset", key: null });
    expect(rackEntryOf("shot:mine"), "shot の行はもう無い").toBeNull();
    expect(rackEntryOf("ks_glass"), "知らない行は null").toBeNull();
  });
});
