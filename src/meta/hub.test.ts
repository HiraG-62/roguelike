import { describe, expect, it } from "vitest";
import { ENEMIES } from "../data/enemies";
import { HUB } from "../data/tuning";
import { createAchievementSave } from "./achievements";
import { createCodexSave } from "./codex";
import {
  FACILITY_KEYS,
  FACILITY_OF_SPOT,
  STARTER_FACILITIES,
  type HubProgressSource,
  availableSpots,
  builtFacilities,
  facilityBuiltBanner,
  hubDecorations,
  newlyBuilt,
} from "./hub";
import { HUB_KEY, createHubSave, loadHub, markFacilitiesSeen, parseHubSave, saveHub } from "./hubStore";
import { MemoryStorage } from "./testStorage";

function freshSource(): HubProgressSource {
  return { runs: 0, codex: createCodexSave(), stoneCount: 0, hasBud: false, achievements: createAchievementSave() };
}

describe("拠点の設備の解放", () => {
  it("初回は井戸・掲示板・鍛冶場・記録室・武器掛けだけが建っている", () => {
    expect(builtFacilities(freshSource()), "初回の設備").toEqual(["well", "board", "forge", "archive", "rack"]);
  });

  it("武器掛けは最初から建っていて、台が使える", () => {
    const built = builtFacilities(freshSource());
    expect(built, "最初から建っている").toContain("rack");
    expect(availableSpots(built).has("rack"), "武器掛けの台に反応する").toBe(true);
    expect(newlyBuilt(built, createHubSave()), "建った演出は出さない").not.toContain("rack");
  });

  it("スキル石を持つと図書館が建つ", () => {
    const src = { ...freshSource(), stoneCount: 1 };
    expect(builtFacilities(src), "石 1 つ").toContain("library");
    expect(builtFacilities(freshSource()), "石なし").not.toContain("library");
  });

  it("試し場に出会うか 3 ラン遊ぶと訓練場が建つ", () => {
    const met = freshSource();
    met.codex.roomKinds.push("dummyHall");
    expect(builtFacilities(met), "試し場に出会った").toContain("training");
    expect(builtFacilities({ ...freshSource(), runs: HUB.trainingRuns }), "閾値のラン数").toContain("training");
    expect(builtFacilities({ ...freshSource(), runs: HUB.trainingRuns - 1 }), "閾値の 1 つ手前").not.toContain("training");
  });

  it("祭壇の部屋に出会うと祭壇が建つ", () => {
    const src = freshSource();
    expect(builtFacilities(src), "出会う前").not.toContain("altar");
    src.codex.roomKinds.push("altar");
    expect(builtFacilities(src), "出会った後").toContain("altar");
  });

  it("芽を持つと庭が建つ", () => {
    expect(builtFacilities({ ...freshSource(), hasBud: true }), "芽あり").toContain("garden");
    expect(builtFacilities(freshSource()), "芽なし").not.toContain("garden");
  });

  it("解放は強さを変えない（builtFacilities は stats に触れない純関数）", () => {
    const src = { ...freshSource(), runs: 5, stoneCount: 3, hasBud: true };
    src.codex.roomKinds.push("altar", "dummyHall");
    const before = JSON.stringify(src);
    const a = builtFacilities(src);
    const b = builtFacilities(src);
    expect(a, "同じ入力で同じ結果").toEqual(b);
    expect(JSON.stringify(src), "入力を書き換えない").toBe(before);
    expect(a, "全設備").toEqual([...FACILITY_KEYS]);
  });

  it("availableSpots は記録室が建つと履歴・図鑑・実績の 3 台を返す", () => {
    const spots = availableSpots(["archive"]);
    expect([...spots].sort(), "記録室の台").toEqual(["achievements", "codex", "history"]);
    expect(availableSpots(["training"]).size, "訓練場は台を持たない").toBe(0);
    const all = availableSpots(builtFacilities(freshSource()));
    for (const spot of all) {
      expect(STARTER_FACILITIES, `${spot} の設備`).toContain(FACILITY_OF_SPOT[spot]);
    }
  });
});

describe("拠点の既読と保存", () => {
  it("newlyBuilt は既読の設備を返さない", () => {
    const built = builtFacilities({ ...freshSource(), stoneCount: 1, hasBud: true });
    expect(newlyBuilt(built, createHubSave()), "未読（最初からの設備は除く）").toEqual(["library", "garden"]);
    const seen = markFacilitiesSeen(createHubSave(), ["library"]);
    expect(newlyBuilt(built, seen), "図書館は既読").toEqual(["garden"]);
    expect(newlyBuilt(built, markFacilitiesSeen(seen, built)), "全部既読").toEqual([]);
    expect(facilityBuiltBanner([]), "何も建っていなければバナーなし").toBeNull();
  });

  it("壊れた HubSave は既定値に戻る", () => {
    const storage = new MemoryStorage();
    storage.setItem(HUB_KEY, "{壊れた");
    expect(loadHub(storage), "壊れた JSON").toEqual(createHubSave());
    expect(parseHubSave({ version: 2, seenFacilities: ["well"] }), "未知の version").toBeNull();
    expect(parseHubSave({ version: 1, seenFacilities: ["forge", "unknown", 3, "forge"] }), "未知の key と重複を落とす").toEqual({
      version: 1,
      seenFacilities: ["forge"],
    });
    const save = markFacilitiesSeen(createHubSave(), ["altar"]);
    saveHub(save, storage);
    expect(loadHub(storage), "書いて読み戻す").toEqual(save);
  });
});

describe("拠点の飾り", () => {
  it("ボスの撃破記録から記念品の飾りが増える", () => {
    const boss = ENEMIES.find((d) => d.boss === true);
    expect(boss, "ボスの定義がある").toBeDefined();
    if (!boss) return;
    const src = freshSource();
    const before = hubDecorations(src).filter((d) => d.key.startsWith("trophy:")).length;
    src.codex.enemyKills[boss.key] = 1;
    const after = hubDecorations(src).filter((d) => d.key.startsWith("trophy:"));
    expect(after.length, "記念品が 1 つ増える").toBe(before + 1);
    expect(after.map((d) => d.key), "倒したボスの key").toContain(`trophy:${boss.key}`);
  });
});
