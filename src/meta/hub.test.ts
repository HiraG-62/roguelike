import { describe, expect, it } from "vitest";
import { ENEMIES } from "../data/enemies";
import { ARC, HUB } from "../data/tuning";
import { HUB_SPOT_KEYS, buildHubMap } from "../map/hubMap";
import type { HallOutcome } from "../system/bossHall";
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
import {
  HUB_KEY,
  addDonation,
  addHallResult,
  createHubSave,
  donatedOf,
  hallRecordOf,
  loadHub,
  markFacilitiesSeen,
  parseHubSave,
  saveHub,
} from "./hubStore";
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
    src.codex.enemyKills[ARC.finalBoss] = 1;
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

describe("拠点の寄進の総額", () => {
  it("donated は任意項目で、数値以外・負・NaN は 0 として扱う（version は 1 のまま）", () => {
    expect(donatedOf(createHubSave()), "既定").toBe(0);
    expect(donatedOf(parseHubSave({ version: 1, seenFacilities: [] }) ?? createHubSave()), "項目なし（古い保存）").toBe(0);
    for (const bad of ["12", null, -5, Number.NaN, Number.POSITIVE_INFINITY, {}, [3]]) {
      const parsed = parseHubSave({ version: 1, seenFacilities: [], donated: bad });
      expect(parsed, `壊れた値 ${String(bad)} でも読める`).not.toBeNull();
      expect(donatedOf(parsed ?? createHubSave()), `壊れた値 ${String(bad)}`).toBe(0);
    }
    expect(donatedOf(parseHubSave({ version: 1, seenFacilities: [], donated: 42.9 }) ?? createHubSave()), "小数は切り捨て").toBe(42);
  });

  it("addDonation は総額に足した新しい保存データを返し、元は変えない", () => {
    const base = createHubSave();
    const once = addDonation(base, 30);
    expect(donatedOf(once), "30").toBe(30);
    expect(donatedOf(addDonation(once, 25)), "積み上がる").toBe(55);
    expect(donatedOf(base), "元は変わらない").toBe(0);
    expect(donatedOf(addDonation(once, 0)), "0 を足しても変わらない").toBe(30);
    expect(donatedOf(addDonation(once, -10)), "負は足さない").toBe(30);
  });

  it("書いて読み戻せ、設備の既読を更新しても総額は残る", () => {
    const storage = new MemoryStorage();
    const withDonation = addDonation(createHubSave(), 80);
    saveHub(markFacilitiesSeen(withDonation, ["forge"]), storage);
    const loaded = loadHub(storage);
    expect(donatedOf(loaded), "総額").toBe(80);
    expect(loaded.seenFacilities, "既読").toEqual(["forge"]);
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

function outcome(partial: Partial<HallOutcome>): HallOutcome {
  return { done: true, won: false, locked: true, seconds: 0, hits: 0, downs: 0, ...partial };
}

describe("ボスの間", () => {
  const chapterBoss = ARC.chapters[0]?.boss ?? "";

  it("章ボスを 1 体倒すとボスの間が建ち、台が使える", () => {
    const src = freshSource();
    expect(builtFacilities(src), "倒す前").not.toContain("hall");
    src.codex.enemyKills[chapterBoss] = 1;
    const built = builtFacilities(src);
    expect(built, "倒した後").toContain("hall");
    expect(availableSpots(built).has("hall"), "台に反応する").toBe(true);
    expect(newlyBuilt(built, createHubSave()), "建った演出を出す").toContain("hall");
  });

  it("章ボスでない敵を倒しても建たない", () => {
    const src = freshSource();
    const other = ENEMIES.find((d) => d.boss !== true);
    if (other) src.codex.enemyKills[other.key] = 5;
    expect(builtFacilities(src), "雑魚だけ").not.toContain("hall");
  });

  it("台どうしは HUB.interactRadius の 2 倍より離れている", () => {
    const layout = buildHubMap();
    const hall = layout.spots.hall;
    for (const key of HUB_SPOT_KEYS) {
      if (key === "hall") continue;
      const p = layout.spots[key];
      expect(Math.hypot(p.x - hall.x, p.y - hall.y), `${key} と離れている`).toBeGreaterThan(HUB.interactRadius * 2);
    }
  });

  it("addHallResult は挑戦・撃破・最速・最少の被弾を更新し、封鎖前にやめた挑戦は数えない", () => {
    const base = createHubSave();
    const quit = addHallResult(base, chapterBoss, outcome({ done: false, locked: false }));
    expect(hallRecordOf(quit, chapterBoss), "封鎖前は数えない").toBeUndefined();
    const lost = addHallResult(base, chapterBoss, outcome({ seconds: 12, hits: 3 }));
    expect(hallRecordOf(lost, chapterBoss), "力尽きた").toEqual({ tries: 1, wins: 0 });
    const won = addHallResult(lost, chapterBoss, outcome({ won: true, seconds: 40, hits: 2 }));
    expect(hallRecordOf(won, chapterBoss), "初めての撃破").toEqual({ tries: 2, wins: 1, bestSeconds: 40, fewestHits: 2 });
    const faster = addHallResult(won, chapterBoss, outcome({ won: true, seconds: 30, hits: 5 }));
    expect(hallRecordOf(faster, chapterBoss), "最速だけ更新").toEqual({ tries: 3, wins: 2, bestSeconds: 30, fewestHits: 2 });
    const cleaner = addHallResult(faster, chapterBoss, outcome({ won: true, seconds: 50, hits: 0 }));
    expect(hallRecordOf(cleaner, chapterBoss), "最少の被弾だけ更新").toEqual({ tries: 4, wins: 3, bestSeconds: 30, fewestHits: 0 });
    expect(hallRecordOf(base, chapterBoss), "元は変わらない").toBeUndefined();
    expect(hallRecordOf(lost, chapterBoss)?.tries, "前の保存データも変わらない").toBe(1);
  });

  it("hall の記録は保存と読み込みで往復し、他の欄も残る", () => {
    const storage = new MemoryStorage();
    const save = markFacilitiesSeen(addHallResult(addDonation(createHubSave(), 5), chapterBoss, outcome({ won: true, seconds: 21.5, hits: 1 })), ["forge"]);
    saveHub(save, storage);
    const loaded = loadHub(storage);
    expect(loaded, "往復").toEqual(save);
    expect(hallRecordOf(loaded, chapterBoss)?.bestSeconds, "最速").toBe(21.5);
  });

  it("壊れた hall の値は捨て、欄の無い旧データも読める", () => {
    expect(parseHubSave({ version: 1, seenFacilities: [] })?.hall, "欄なし").toBeUndefined();
    for (const bad of [null, 3, "x", [1]]) {
      expect(parseHubSave({ version: 1, seenFacilities: [], hall: bad })?.hall, `壊れた hall ${String(bad)}`).toBeUndefined();
    }
    const parsed = parseHubSave({
      version: 1,
      seenFacilities: [],
      hall: {
        [chapterBoss]: { tries: 3, wins: 9, bestSeconds: -1, fewestHits: "2" },
        slime: { tries: 1, wins: 1 },
        unknownBoss: { tries: 1, wins: 0 },
        [ARC.finalBoss]: { tries: 0, wins: 0 },
      },
    });
    expect(parsed?.hall, "ボス以外・未知・挑戦 0 は捨て、撃破は挑戦を超えない・壊れた最速と被弾は捨てる").toEqual({ [chapterBoss]: { tries: 3, wins: 3 } });
  });
});

describe("踏破の碑", () => {
  it("踏破していなければ飾らず、踏破していると回数と最高位階つきで先頭に飾る", () => {
    expect(hubDecorations(freshSource()).some((d) => d.key === "stele"), "踏破なし").toBe(false);
    const decor = hubDecorations({ ...freshSource(), clears: 2, bestClearTier: 6 });
    expect(decor[0]?.key).toBe("stele");
    expect(decor[0]?.label).toContain("2 回");
    expect(decor[0]?.label).toContain("最高位階 6");
  });
});
