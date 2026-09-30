import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { MemoryStorage } from "../meta/testStorage";
import { CORRUPTED_KEY, affixDef, isConversionKey } from "./affixes";
import { defaultColorOfKey, traitColorOf } from "./colors";
import { describeItem } from "./describe";
import { fluxedValues, scaledNominalAt } from "./flux";
import { generateItem } from "./generator";
import {
  LEGACY_AFFIX_MAP,
  LEGACY_RARITY_MARGIN,
  LEGACY_TIER_FLUX,
  LEGACY_UNIQUE_MAP,
  applyRelicMigration,
  migrateItem,
  migrateRelicKey,
} from "./migrate";
import { UNIQUES, uniqueDef } from "./named";
import { PROFILE_KEY, loadProfile, saveProfile } from "./profile";
import { computeStats } from "./stats";
import { type AffixRoll, type Item, type Slot, createEmptyProfile, createEmptyProvenance } from "./types";

/** 7d の後も残る性質（数値を見る旧形式の fixture に使う） */
const KEPT_KEY = "damageVsStaggered";
/** 残る誓約 */
const KEPT_VOW = "ks_blink";

/** 旧形式（prefix / suffix / tier / rarity）のアイテム */
function legacyRare(): Item {
  return {
    id: "old-rare",
    seed: 9,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "rare",
    itemLevel: 20,
    name: "嵐の牙",
    implicit: { key: "implicit.longsword", kind: "prefix", tier: 1, value: 40 },
    affixes: [
      { key: KEPT_KEY, kind: "prefix", tier: 1, value: 56 },
      { key: "readAhead", kind: "prefix", tier: 3, value: -20 },
      { key: "tr:onKill:always:heal", kind: "suffix", tier: 1, value: 5, value2: 400 },
      { key: KEPT_VOW, kind: "suffix", tier: 1, value: 0 },
      { key: CORRUPTED_KEY, kind: "suffix", tier: 1, value: 0 },
    ],
    foundDepth: 18,
    foundAt: 123,
  };
}

describe("migrateItem", () => {
  it("tier → 揺らぎ、期待値を逆算。値は変えない", () => {
    const migrated = migrateItem(legacyRare());
    const kept = migrated.affixes.find((r) => r.key === KEPT_KEY);
    expect(kept?.value).toBe(56);
    expect(kept?.flux).toBeCloseTo(LEGACY_TIER_FLUX[1] ?? 0);
    expect(kept?.nominal).toBeCloseTo(56 / (1 + (LEGACY_TIER_FLUX[1] ?? 0)));
    expect(kept?.kind).toBeUndefined();
    expect(kept?.tier).toBeUndefined();
    expect(kept && traitColorOf(kept)).toBe(defaultColorOfKey(KEPT_KEY));
  });

  it("負の値（旧 Corrupt）は反転（冥）。腐敗の印は捨てる。誓約は冥", () => {
    const migrated = migrateItem(legacyRare());
    const read = migrated.affixes.find((r) => r.key === "readAhead");
    expect(read?.inverted).toBe(true);
    expect(read?.flux ?? 0).toBeLessThan(-1);
    expect(read && traitColorOf(read)).toBe("umbra");
    expect(migrated.affixes.some((r) => r.key === CORRUPTED_KEY)).toBe(false);
    expect(migrated.affixes.find((r) => r.key === KEPT_VOW)?.color).toBe("umbra");
    expect(migrated.rarity).toBe("unique");
  });

  it("旧 rarity → 余白、旧 rare 名 → 銘、来歴は空", () => {
    const migrated = migrateItem(legacyRare());
    expect(migrated.margin).toBe(LEGACY_RARITY_MARGIN.rare);
    expect(migrated.marginMax).toBe(LEGACY_RARITY_MARGIN.rare);
    expect(migrated.inscription).toBe("嵐の牙");
    expect(migrated.name).toBe("嵐の牙");
    expect(migrated.provenance).toEqual(createEmptyProvenance());
    expect(migrated.implicit).toEqual({ key: "implicit.longsword", value: 40 });
  });

  it("旧 unique は固有名から名のある遺物の key を引く", () => {
    const relic = UNIQUES[0];
    if (relic === undefined) throw new Error("名のある遺物が無い");
    const old: Item = { ...legacyRare(), rarity: "unique", name: relic.name, baseKey: relic.baseKey };
    expect(migrateItem(old).namedKey).toBe(relic.key);
  });

  it("名のある遺物を引けない旧 unique は固有名を銘として残す（固定の性質の無い遺物に誤って当てない）", () => {
    const old: Item = { ...legacyRare(), rarity: "unique", name: "失われた遺物", baseKey: "wakizashi" };
    const migrated = migrateItem(old);
    expect(migrated.namedKey, "無地の刃（性質なし）に当てない").toBeUndefined();
    expect(migrated.inscription).toBe("失われた遺物");
    expect(migrated.name).toBe("失われた遺物");
  });

  it("同じ旧セーブを 2 回読むと同じ結果（色・値・トリガー・誓約が保たれる）", () => {
    const storage = new MemoryStorage();
    const legacyProfile = {
      version: 1,
      equipment: { weapon: legacyRare(), gun: null, armor: null, boots: null, ring: null, amulet: null },
      stash: [],
      meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0, history: [] },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(legacyProfile));
    const first = loadProfile(storage);
    expect(loadProfile(storage)).toEqual(first);
    const weapon = first.equipment.mainHand;
    const trigger = weapon?.affixes.find((r) => r.key === "tr:onKill:always:heal");
    expect(trigger?.value).toBe(5);
    expect(trigger?.value2).toBe(400);
    expect(computeStats(first.equipment).keystones).toContain(KEPT_VOW);
  });

  it("冪等: 新形式にもう一度掛けても変わらない。写し表の key を持たない生成品も変わらない", () => {
    const once = migrateItem(legacyRare());
    expect(migrateItem(once)).toEqual(once);
    const rng = createRng(3);
    for (let i = 0; i < 20; i++) {
      const fresh = generateItem(rng, { itemLevel: 20, foundDepth: 20, now: 0 });
      const migrated = migrateItem(fresh);
      expect(migrateItem(migrated), "2 回目は変わらない").toEqual(migrated);
      if (fresh.affixes.every((r) => !(r.key in LEGACY_AFFIX_MAP))) expect(migrated).toEqual(fresh);
    }
  });

  it("旧 stash は読み込みで消えずに新形式になり、保存 → 読み込みで一致する（round-trip）", () => {
    const storage = new MemoryStorage();
    const legacyProfile = {
      version: 1,
      equipment: { weapon: legacyRare(), gun: null, armor: null, boots: null, ring: null, amulet: null },
      stash: [legacyRare(), { ...legacyRare(), id: "old-2", rarity: "magic", name: "獰猛な長剣" }],
      meta: { runs: 3, bestDepth: 9, totalKills: 40, bestScore: 100, history: [] },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(legacyProfile));
    const loaded = loadProfile(storage);
    expect(loaded.stash).toHaveLength(2);
    expect(loaded.equipment.mainHand?.provenance).toBeDefined();
    expect(loaded.stash[1]?.margin).toBe(LEGACY_RARITY_MARGIN.magic);
    saveProfile(loaded, storage);
    expect(loadProfile(storage)).toEqual(loaded);
    expect(() => computeStats(loaded.equipment)).not.toThrow();
  });

  it("空プロフィールはそのまま", () => {
    const storage = new MemoryStorage();
    saveProfile(createEmptyProfile(), storage);
    expect(loadProfile(storage)).toEqual(createEmptyProfile());
  });
});

describe("describeItem", () => {
  it("名前・副題・色の配合・性質の行・来歴を返す。反転は印付き", () => {
    const item = migrateItem(legacyRare());
    item.provenance = { ...createEmptyProvenance(), kills: 12, killsByEnemy: { slime: 10, bat: 2 }, justDodges: 3 };
    const desc = describeItem(item);
    expect(desc.name).toBe("嵐の牙");
    expect(desc.subtitle.startsWith("剣・"), "種類の行は武器種名で始まる").toBe(true);
    expect(desc.baseName, "ベース名は別に持つ").toBe("長剣");
    expect(desc.subtitle).toContain("反転あり");
    expect(desc.inscription).toBe("嵐の牙");
    expect(desc.implicit).toBeDefined();
    expect(desc.lines).toHaveLength(item.affixes.length);
    const inverted = desc.lines.find((l) => l.inverted === true);
    expect(inverted?.text.startsWith("反転")).toBe(true);
    expect(inverted?.fluxLevel).toBe(3);
    expect(desc.colorBar.reduce((s, seg) => s + seg.ratio, 0)).toBeCloseTo(1);
    expect(desc.provenanceLines[0]).toBe("地下 18 階で入手");
    expect(desc.provenanceLines.some((l) => l.startsWith("撃破 12（スライム 10"))).toBe(true);
    expect(desc.summary.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// 段取り 7d の写し（docs/ideas/relics-7d-plan.md 1-5・3 章）
// -----------------------------------------------------------------------------

const ITEM_LEVEL = 20;

/** 新形式（来歴あり）の遺物。7d の前に倉庫へ入っていたもの */
function savedItem(slot: Slot, baseKey: string, affixes: AffixRoll[], extra: Partial<Item> = {}): Item {
  return {
    id: `saved-${slot}`,
    seed: 1,
    baseKey,
    slot,
    rarity: "magic",
    itemLevel: ITEM_LEVEL,
    name: "",
    implicit: null,
    affixes,
    innate: [],
    innateLuck: 1,
    foundDepth: ITEM_LEVEL,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 1,
    marginMax: 2,
    milestones: [],
    buds: [],
    budOffer: null,
    ...extra,
  };
}

function roll(key: string, value = 10): AffixRoll {
  return { key, value, nominal: value, flux: 0.2, origin: "found" };
}

/** 写し先の期待値（揺らぎ 0。生成と同じく強さの係数を掛ける） */
function expectedValue(key: string): number {
  const def = affixDef(key);
  if (def === undefined) throw new Error(`写し先 ${key} が無い`);
  return fluxedValues(scaledNominalAt(def, ITEM_LEVEL, !isConversionKey(key)), 0, def.decimals ?? 0, def.decimals2 ?? 0).value;
}

/** 7d の前の倉庫（6 部位 + 名のある遺物 + 誓約の性質）。fixture の数え方は各部位のコメント */
function savedEquipment(): Record<Exclude<Slot, "offHand">, Item> {
  return {
    // 残る 1・消える 1・写す 1（emberWalk → emberTrail）・誓約の写し 1（ks_earthOath → groundMend）
    mainHand: savedItem("mainHand", "longsword", [roll(KEPT_KEY), roll("meleeDamagePct"), roll("emberWalk"), { key: "ks_earthOath", value: 0 }]),
    // 地金の行が性質に紛れたもの（消す）と地金そのもの（触らない）
    armor: savedItem("armor", "leather", [roll("maxLife"), roll("attr_str", 3)], { innate: [{ key: "attr_str", value: 3 }], margin: 0, marginMax: 0 }),
    // 名のある遺物の写し（旅の垢 → 旅人の靴）。性質は写し表だけ通す
    boots: savedItem("boots", "sandals", [roll("moveSpeed")], { namedKey: "wayfarerSandals", name: "旅の垢", rarity: "unique" }),
    // 写し先の無い名のある遺物（狂戦士の印章）は普通の遺物に。固有名は銘へ
    ring: savedItem("ring", "bloodRing", [roll(KEPT_KEY), { key: "ks_monochrome", value: 0 }], { namedKey: "berserkersSignet", name: "狂戦士の印章" }),
    // 写し先が既にあるもの（emberTrail があるのに emberWalk）は消す
    amulet: savedItem("amulet", "jadeAmulet", [roll("emberTrail"), roll("emberWalk"), roll("frostWalk")]),
    // 銘のある名のある遺物の写し（読み手の額冠 → 星読みの眼）。表示名は銘のまま
    head: savedItem("head", "circlet", [roll("readAhead"), roll("weakRead")], { namedKey: "readersCirclet", name: "銘の額冠", inscription: "銘の額冠" }),
  };
}

function loadSaved(): ReturnType<typeof loadProfile> {
  const storage = new MemoryStorage();
  const profile = createEmptyProfile();
  const eq = savedEquipment();
  profile.equipment = { ...profile.equipment, ...eq };
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return loadProfile(storage);
}

describe("段取り 7d の写し: 旧セーブの倉庫", () => {
  it("消えた性質・誓約は 1 つにつき余白 +1、残る性質は値を変えない", () => {
    const { equipment } = loadSaved();
    const hand = equipment.mainHand;
    expect(hand?.affixes.map((r) => r.key), "残る → 写し → 誓約の写し の順を保つ").toEqual([KEPT_KEY, "emberTrail", "groundMend"]);
    expect(hand?.margin, "meleeDamagePct の 1 つ分").toBe(2);
    expect(hand?.marginMax, "余白の最大も広げる").toBe(2);
    expect(hand?.affixes[0]?.value, "残る性質の値").toBe(10);
    const armor = equipment.armor;
    expect(armor?.affixes, "地金の行も性質からは消す").toEqual([]);
    expect(armor?.margin).toBe(2);
    expect(armor?.innate, "地金は触らない").toEqual([{ key: "attr_str", value: 3 }]);
  });

  it("写した性質は写し先の期待値で作り直す（揺らぎ 0・色は既定）", () => {
    const trail = loadSaved().equipment.mainHand?.affixes.find((r) => r.key === "emberTrail");
    expect(trail?.value).toBe(expectedValue("emberTrail"));
    expect(trail?.flux).toBe(0);
    expect(trail?.color).toBe(defaultColorOfKey("emberTrail"));
    expect(trail?.origin, "出どころは保つ").toBe("found");
  });

  it("写し先が既にあれば後の方は消して余白へ", () => {
    const amulet = loadSaved().equipment.amulet;
    const keys = amulet?.affixes.map((r) => r.key) ?? [];
    expect(keys.filter((k) => k === "emberTrail"), "emberTrail は 1 つだけ").toHaveLength(1);
    expect(keys).not.toContain("emberWalk");
    expect(amulet?.affixes[0]?.value, "元からある方を残す").toBe(10);
    // frostWalk → frostTrail は写る。emberWalk だけ消えて余白 +1
    expect(amulet?.margin).toBe(1 + 1);
  });

  it("名のある遺物は写し先へ、写し先の無いものは普通の遺物になり固有名を銘に写す", () => {
    const { equipment } = loadSaved();
    expect(equipment.boots?.namedKey).toBe("wanderShoes");
    expect(equipment.boots?.name).toBe(uniqueDef("wanderShoes")?.name);
    expect(equipment.boots?.margin, "moveSpeed の分").toBe(2);
    expect(equipment.ring?.namedKey).toBeUndefined();
    expect(equipment.ring?.inscription).toBe("狂戦士の印章");
    expect(equipment.ring?.name).toBe("狂戦士の印章");
    expect(equipment.ring?.margin, "誓約 ks_monochrome の分").toBe(2);
    expect(equipment.head?.namedKey).toBe("starReader");
    expect(equipment.head?.name, "銘があれば銘のまま").toBe("銘の額冠");
  });

  it("写した倉庫を保存して読み直すと同じ（冪等）。装備の集計も落ちない", () => {
    const loaded = loadSaved();
    const storage = new MemoryStorage();
    saveProfile(loaded, storage);
    expect(loadProfile(storage)).toEqual(loaded);
    expect(() => computeStats(loaded.equipment)).not.toThrow();
  });

  it("旧形式の旧 unique も写す（固有名 → 銘、余白は旧 rarity + 消えた数）", () => {
    const old: Item = {
      ...legacyRare(),
      rarity: "unique",
      name: "喪服の剣",
      baseKey: "greatsword",
      affixes: [
        { key: "meleeDamagePct", kind: "prefix", tier: 1, value: 50 },
        { key: "critMultiplier", kind: "prefix", tier: 1, value: 40 },
        { key: "ks_monochrome", kind: "suffix", tier: 1, value: 0 },
      ],
    };
    const migrated = migrateItem(old);
    expect(migrated.namedKey).toBeUndefined();
    expect(migrated.inscription).toBe("喪服の剣");
    expect(migrated.affixes).toEqual([]);
    expect(migrated.margin).toBe(LEGACY_RARITY_MARGIN.unique + 3);
  });
});

describe("段取り 7d の写し: 芽", () => {
  it("提示中の芽に消えた性質があれば提示を捨て、節目を未到達に戻す", () => {
    const item = savedItem("mainHand", "longsword", [roll(KEPT_KEY)], {
      milestones: ["kills:50", "kills:100"],
      budOffer: { milestone: "kills:100", options: [roll("meleeDamagePct"), roll(KEPT_KEY)] },
    });
    applyRelicMigration(item);
    expect(item.budOffer).toBeNull();
    expect(item.milestones).toEqual(["kills:50"]);
  });

  it("提示中の芽の写しのある候補は写し先へ", () => {
    const item = savedItem("mainHand", "longsword", [], { budOffer: { milestone: "kills:50", options: [roll("emberWalk"), roll("readAhead")] } });
    applyRelicMigration(item);
    expect(item.budOffer?.options.map((r) => r.key)).toEqual(["emberTrail", "readAhead"]);
  });

  it("芽の履歴: 候補が消えた履歴は捨て、写しのある候補は写す", () => {
    const item = savedItem("mainHand", "longsword", [], {
      buds: [
        { milestone: "kills:50", options: [roll("maxLife"), roll("readAhead")], chosen: 1 },
        { milestone: "kills:100", options: [roll("emberWalk"), roll("readAhead")], chosen: 0 },
        { milestone: "kills:200", options: [roll("readAhead"), roll(KEPT_KEY)], chosen: 0 },
      ],
    });
    applyRelicMigration(item);
    expect(item.buds?.map((b) => b.milestone)).toEqual(["kills:100", "kills:200"]);
    expect(item.buds?.[0]?.options[0]?.key).toBe("emberTrail");
  });
});

describe("段取り 7d の写し表", () => {
  it("性質の表は 210 件、名のある遺物の表は旧 76 件を持つ", () => {
    expect(Object.keys(LEGACY_AFFIX_MAP)).toHaveLength(210);
    expect(Object.keys(LEGACY_UNIQUE_MAP)).toHaveLength(76);
    expect(Object.values(LEGACY_UNIQUE_MAP).filter((v) => v !== null), "写す 8").toHaveLength(8);
  });

  it("写し先は表の key にならない（冪等）", () => {
    for (const target of Object.values(LEGACY_AFFIX_MAP)) {
      if (target !== null) expect(target in LEGACY_AFFIX_MAP, target).toBe(false);
    }
    for (const target of Object.values(LEGACY_UNIQUE_MAP)) {
      if (target !== null) expect(target in LEGACY_UNIQUE_MAP, target).toBe(false);
    }
  });

  it("名のある遺物の写し先は今の UNIQUES にあり、部位とベースが同じ", () => {
    for (const target of Object.values(LEGACY_UNIQUE_MAP)) {
      if (target === null) continue;
      expect(uniqueDef(target), target).toBeDefined();
    }
    expect(UNIQUES.some((u) => u.key in LEGACY_UNIQUE_MAP), "今の key は表に無い").toBe(false);
  });

  it("migrateRelicKey: 旧 key は写し先 / null、今の key はそのまま", () => {
    expect(migrateRelicKey("matedFangs")).toBe("twinSerpent");
    expect(migrateRelicKey("widowmaker")).toBeNull();
    expect(migrateRelicKey("twinSerpent")).toBe("twinSerpent");
  });

  it("性質の写し先はすべて AFFIXES にある", () => {
    const missing = [...new Set(Object.values(LEGACY_AFFIX_MAP))].filter((k): k is string => k !== null && affixDef(k) === undefined);
    expect(missing).toEqual([]);
  });
});
