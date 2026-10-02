import { describe, expect, it } from "vitest";
import { ENEMIES } from "../data/enemies";
import { ARC, HUB, HUB_DECOR } from "../data/tuning";
import { HUB_LOT_KEYS } from "../map/hubMap";
import { createAchievementSave } from "./achievements";
import { CODEX_ENEMIES, type CodexSave, codexRoomKinds, createCodexSave } from "./codex";
import { FACILITY_HINT, FACILITY_KEYS, FACILITY_NAME, FACILITY_OF_LOT, STARTER_FACILITIES } from "./hub";
import { addDonation, addHallResult, createHubSave } from "./hubStore";
import { type TownSource, townLook } from "./townLook";
import { UNIQUES } from "../loot/named";
import { FLOOR_KINDS } from "../system/biomes";
import { BOON_KEYS } from "../system/boonDefs";
import { hallBossKeys } from "../system/bossHallKeys";

function emptySource(): TownSource {
  return { runs: 0, codex: createCodexSave(), stoneCount: 0, hasBud: false, achievements: createAchievementSave() };
}

/** 図鑑を全部埋めた保存（書架が最大の段になる） */
function fullCodex(): CodexSave {
  const codex = createCodexSave();
  codex.enemiesSeen = CODEX_ENEMIES.map((d) => d.key);
  codex.relics = UNIQUES.map((u) => u.key);
  codex.boons = [...BOON_KEYS];
  codex.floorKinds = [...FLOOR_KINDS];
  codex.roomKinds = codexRoomKinds();
  for (const def of ENEMIES) if (def.boss === true) codex.enemyKills[def.key] = 1;
  return codex;
}

function maxSource(): TownSource {
  return {
    runs: 999,
    codex: fullCodex(),
    stoneCount: 3,
    hasBud: true,
    achievements: createAchievementSave(),
    clears: 99,
    bestClearTier: 20,
    bestDepth: 99,
  };
}

function maxSave() {
  let save = addDonation(createHubSave(), 1_000_000);
  for (const key of hallBossKeys()) save = addHallResult(save, key, { done: true, won: true, locked: true, seconds: 30, hits: 0, downs: 0 });
  return save;
}

describe("門前町の景色: 空の保存", () => {
  const look = townLook(emptySource(), createHubSave());

  it("最初の 5 設備だけが建っている", () => {
    expect([...look.built].sort(), "最初の設備").toEqual([...STARTER_FACILITIES].sort());
  });

  it("灯籠は基本の数・井戸は 0 段・幟と碑と篝火と蔵の灯は無い・賑わい 0", () => {
    expect(look.lanterns, "灯籠").toBe(HUB_DECOR.lanternBase);
    expect(look.wellTier, "井戸").toBe(0);
    expect(look.trophies, "幟").toEqual([]);
    expect(look.hallLit, "篝火").toBe(false);
    expect(look.archiveLights, "蔵の窓").toBe(0);
    expect(look.stele, "碑").toBe(0);
    expect(look.bustle, "賑わい").toBe(0);
    expect(look.title, "称号").toBeNull();
    expect(look.deepestChapter, "石段の奥の章").toBe(1);
  });
});

describe("門前町の景色: 最大の保存", () => {
  const look = townLook(maxSource(), maxSave());

  it("全設備が建つ", () => {
    expect([...look.built].sort(), "全設備").toEqual([...FACILITY_KEYS].sort());
  });

  it("各段が上限まで育つ", () => {
    expect(look.lanterns, "灯籠").toBe(HUB_DECOR.lanternMax);
    expect(look.wellTier, "井戸").toBe(HUB_DECOR.wellDonationBounds.length);
    expect(look.hallLit, "篝火").toBe(true);
    expect(look.archiveLights, "蔵の窓").toBe(HUB_DECOR.shelfMax);
    expect(look.stele, "碑").toBe(HUB_DECOR.steleClearBounds.length + 1);
    expect(look.bustle, "賑わい").toBe(HUB_DECOR.bustleRunBounds.length);
    expect(look.deepestChapter, "最深の章").toBe(ARC.maxChapter);
  });

  it("幟は最大数で打ち切られ、章の若い順に並ぶ", () => {
    expect(look.trophies.length, "幟の数").toBe(Math.min(HUB_DECOR.trophyMax, ENEMIES.filter((d) => d.boss === true).length));
    expect([...look.trophies].sort((a, b) => a - b), "章の昇順").toEqual([...look.trophies]);
    for (const chapter of look.trophies) {
      expect(chapter, "章は 1 以上").toBeGreaterThanOrEqual(1);
      expect(chapter, "章は最後の章以下").toBeLessThanOrEqual(ARC.maxChapter);
    }
  });
});

describe("門前町の景色: 段の境目", () => {
  it("灯籠は踏破 1 回につき増え、最大で止まる", () => {
    const at = (clears: number) => townLook({ ...emptySource(), clears }, createHubSave()).lanterns;
    expect(at(0), "0 回").toBe(HUB_DECOR.lanternBase);
    expect(at(1), "1 回").toBe(Math.min(HUB_DECOR.lanternMax, HUB_DECOR.lanternBase + HUB_DECOR.lanternPerClear));
    expect(at(1000), "上限").toBe(HUB_DECOR.lanternMax);
  });

  it("井戸の段は寄進の境目ちょうどで上がる", () => {
    HUB_DECOR.wellDonationBounds.forEach((bound, i) => {
      const tier = (n: number) => townLook(emptySource(), addDonation(createHubSave(), n)).wellTier;
      expect(tier(bound - 1), `境目 ${bound} の 1 手前`).toBe(i);
      expect(tier(bound), `境目 ${bound}`).toBe(i + 1);
    });
  });

  it("賑わいの段はランの回数の境目ちょうどで上がる", () => {
    HUB_DECOR.bustleRunBounds.forEach((bound, i) => {
      const bustle = (runs: number) => townLook({ ...emptySource(), runs }, createHubSave()).bustle;
      expect(bustle(bound - 1), `境目 ${bound} の 1 手前`).toBe(i);
      expect(bustle(bound), `境目 ${bound}`).toBe(i + 1);
    });
  });

  it("碑は踏破するまで無く、踏破すると 1 段、位階の境目で育つ", () => {
    const stele = (clears: number, tier: number) => townLook({ ...emptySource(), clears, bestClearTier: tier }, createHubSave()).stele;
    expect(stele(0, 0), "未踏破").toBe(0);
    expect(stele(1, 0), "位階 0 の踏破").toBe(1);
    HUB_DECOR.steleClearBounds.forEach((bound, i) => {
      expect(stele(1, bound), `位階 ${bound}`).toBeGreaterThanOrEqual(i + 1);
    });
    expect(stele(1, 1000), "位階の上限").toBe(HUB_DECOR.steleClearBounds.length + 1);
  });

  it("石段の奥の章は最深の階から引き、深みでも最後の章", () => {
    const chapter = (bestDepth: number) => townLook({ ...emptySource(), bestDepth }, createHubSave()).deepestChapter;
    expect(chapter(0), "未到達").toBe(1);
    expect(chapter(ARC.floorsPerChapter), "章 1 の最後の階").toBe(1);
    expect(chapter(ARC.floorsPerChapter + 1), "章 2 の最初の階").toBe(2);
    expect(chapter(ARC.floorsPerChapter * ARC.maxChapter + 10), "深み").toBe(ARC.maxChapter);
  });

  it("幟は倒したボス 1 体につき 1 本で、章ボスは自分の章の色", () => {
    const src = emptySource();
    ARC.chapters.forEach((c, i) => {
      src.codex.enemyKills[c.boss] = 1;
      const trophies = townLook(src, createHubSave()).trophies;
      expect(trophies.length, `章ボス ${i + 1} 体`).toBe(i + 1);
      expect(trophies[i], `${c.boss} の章`).toBe(i + 1);
    });
  });

  it("篝火はボスの間で勝ったときだけ灯る", () => {
    const key = hallBossKeys()[0] ?? "";
    const lost = addHallResult(createHubSave(), key, { done: true, won: false, locked: true, seconds: 0, hits: 0, downs: 0 });
    const won = addHallResult(createHubSave(), key, { done: true, won: true, locked: true, seconds: 20, hits: 0, downs: 0 });
    expect(townLook(emptySource(), lost).hallLit, "負けただけ").toBe(false);
    expect(townLook(emptySource(), won).hallLit, "勝った").toBe(true);
  });
});

describe("門前町の景色: key", () => {
  it("同じ入力なら同じ key", () => {
    const a = townLook(maxSource(), maxSave());
    const b = townLook(maxSource(), maxSave());
    expect(a.key, "同じ入力").toBe(b.key);
  });

  it("見た目が変わる材料が違えば違う key", () => {
    const base = townLook(emptySource(), createHubSave()).key;
    const variants: [string, TownSource, ReturnType<typeof createHubSave>][] = [
      ["スキル石", { ...emptySource(), stoneCount: 1 }, createHubSave()],
      ["踏破", { ...emptySource(), clears: 1 }, createHubSave()],
      ["寄進", emptySource(), addDonation(createHubSave(), HUB_DECOR.wellDonationBounds[0] ?? 1)],
      ["ラン", { ...emptySource(), runs: HUB_DECOR.bustleRunBounds[0] ?? 1 }, createHubSave()],
      ["最深の階", { ...emptySource(), bestDepth: ARC.floorsPerChapter + 1 }, createHubSave()],
    ];
    for (const [name, src, save] of variants) {
      expect(townLook(src, save).key, `${name}で key が変わる`).not.toBe(base);
    }
  });

  it("見た目に出ない差（段の内側の増減）では key が変わらない", () => {
    const low = townLook({ ...emptySource(), runs: 1 }, createHubSave()).key;
    const same = townLook({ ...emptySource(), runs: 2 }, createHubSave()).key;
    expect(same, "賑わい 1 段の内側").toBe(low);
  });
});

describe("設備の表示名と手がかり", () => {
  it("全設備に表示名と解放の手がかりがある", () => {
    for (const key of FACILITY_KEYS) {
      expect(FACILITY_NAME[key].length, `${key} の表示名`).toBeGreaterThan(0);
      expect(FACILITY_HINT[key].length, `${key} の手がかり`).toBeGreaterThan(0);
    }
  });

  it("稽古場の手がかりは解放の探索回数と揃っている", () => {
    expect(FACILITY_HINT.training, "稽古場の手がかりに探索の回数").toContain(String(HUB.trainingRuns));
  });

  it("全敷地が設備に対応し、設備の表示名は建物名", () => {
    for (const lot of HUB_LOT_KEYS) expect(FACILITY_KEYS, `${lot} の設備`).toContain(FACILITY_OF_LOT[lot]);
    expect(FACILITY_NAME.forge, "鍛冶屋").toBe("鍛冶屋");
    expect(FACILITY_NAME.hall, "御堂").toBe("御堂");
  });
});
