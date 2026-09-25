import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import type { Enemy } from "../core/state";
import { HUB, STASH_CAPACITY } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { ensureGrowthFields } from "../loot/migrate";
import { recordProvenance } from "../loot/provenance";
import { loadProfile, returnLoaned, saveProfile, ultimateChoice } from "../loot/profile";
import { ULTIMATES, defaultUltimate } from "../data/ultimates";
import { MemoryStorage } from "../meta/testStorage";
import { computeStats } from "../loot/stats";
import { createEmptyProfile } from "../loot/types";
import { TILE_SIZE, Tile, getTile } from "../map/grid";
import { HUB_SPOT_KEYS, type HubSpotKey, buildHubMap } from "../map/hubMap";
import { KEYSTONES } from "../loot/affixes";
import { createDefaultSkillProfile } from "../skills/persistence";
import { stoneFromSeed } from "../skills/generator";
import type { SkillProfile } from "../skills/types";
import { damageEnemy, damagePlayer, recordRunOnce } from "./combat";
import {
  HUB_RESOURCES,
  type HubSession,
  borrowRackEntry,
  borrowWeapon,
  chooseRackUltimate,
  createHub,
  fillHubResources,
  hubResourceRatio,
  setHubResource,
  setTrialKeystone,
  setTrialWeapon,
  stepHub,
  trialKeystoneKeys,
} from "./hub";
import { DUMMY_KEY } from "./specialRooms";
import { applyStats } from "./player";
import { withInput } from "./testHelpers";
import { MOVESET_KEYS, bulletFeatures } from "../data/weapons";
import { DEFAULT_BULLET, currentBullet } from "../loot/bullets";

const ALL: ReadonlySet<HubSpotKey> = new Set(HUB_SPOT_KEYS);
/** 持続の奥義の始めのヒットストップを越えるための余りのフレーム */
const HITSTOP_ALLOWANCE = 30;

function hub(available: ReadonlySet<HubSpotKey> = ALL, skillProfile: SkillProfile = createDefaultSkillProfile()): HubSession {
  return createHub(createEmptyProfile(), skillProfile, available);
}

function idle(session: HubSession, frames: number): void {
  for (let i = 0; i < frames; i++) stepHub(session, withInput({}), FIXED_DT);
}

function dummies(session: HubSession): Enemy[] {
  return session.state.enemies.filter((e) => e.defKey === DUMMY_KEY);
}

function standAt(session: HubSession, spot: HubSpotKey): void {
  session.state.player.body.pos = { ...session.hub.layout.spots[spot] };
}

describe("拠点の state", () => {
  it("createHub は profile.meta.runs を増やさない", () => {
    const profile = createEmptyProfile();
    const before = profile.meta.runs;
    createHub(profile, createDefaultSkillProfile(), ALL);
    expect(profile.meta.runs, "拠点に入ってもラン数は数えない").toBe(before);
  });

  it("拠点の state は sandbox を持ち、階段・死神を生成しない", () => {
    const session = hub();
    expect(session.state.sandbox).toBe(true);
    idle(session, 600);
    expect(session.state.reaper, "長居しても死神は出ない").toBeNull();
    expect(session.state.stairs).toHaveLength(0);
    expect([...session.state.map.tiles].includes(Tile.StairsDown), "下り階段のタイルが無い").toBe(false);
    expect(dummies(session), "木人が並んでいる").toHaveLength(HUB.dummyCount);
  });
});

describe("永続データへ書かない", () => {
  it("拠点で木人を倒しても来歴が積もらない", () => {
    const profile = createEmptyProfile();
    const item = ensureGrowthFields(generateItem(createRng(7), { itemLevel: 3, foundDepth: 1, slot: "mainHand", now: 0 }));
    profile.equipment.mainHand = item;
    const session = createHub(profile, createDefaultSkillProfile(), ALL);
    const before = JSON.stringify(item.provenance);
    for (const d of dummies(session)) damageEnemy(session.state, d, 99999, { x: 1, y: 0 }, 0, { kind: "melee", poise: 999 });
    recordProvenance(session.state, { kind: "kill", enemyKey: DUMMY_KEY, boss: false });
    idle(session, 10);
    expect(JSON.stringify(item.provenance), "来歴が変わらない").toBe(before);
    // 対照: 印を外せば同じ呼び出しで積もる（ガードが効いていることの確認）
    delete session.state.sandbox;
    recordProvenance(session.state, { kind: "kill", enemyKey: DUMMY_KEY, boss: false });
    expect(JSON.stringify(item.provenance)).not.toBe(before);
  });

  it("拠点でスキルを撃っても石の使い込みが増えない", () => {
    const stone = { ...stoneFromSeed(3, { foundDepth: 1, now: 0, skillKey: "whirl" }), variants: [], links: 0 };
    const skillProfile: SkillProfile = { version: 1, loadout: [stone.id, null, null, null], stones: [stone] };
    const session = hub(ALL, skillProfile);
    const target = dummies(session)[0];
    if (!target) throw new Error("木人が無い");
    target.hp = 99999;
    session.state.player.body.pos = { x: target.body.pos.x - 12, y: target.body.pos.y };
    idle(session, 1);
    session.state.player.mana = session.state.stats.maxMana;
    const manaBefore = session.state.player.mana;
    stepHub(session, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(session.state.player.mana, "スキルは発動している").toBeLessThan(manaBefore);
    idle(session, 60);
    expect(stone.wear?.casts ?? 0, "発動回数が増えない").toBe(0);
    expect(stone.wear?.hits ?? 0, "命中数が増えない").toBe(0);
  });

  it("拠点で HP が尽きても死亡せずラン記録も書かない", () => {
    const session = hub();
    const meta = JSON.stringify(session.state.profile.meta);
    damagePlayer(session.state, 99999, { x: 0, y: 0 });
    expect(session.state.status).toBe("playing");
    expect(session.state.player.hp, "HP は満タンに戻る").toBe(session.state.player.maxHp);
    recordRunOnce(session.state);
    expect(session.state.runRecorded).toBe(false);
    expect(JSON.stringify(session.state.profile.meta), "ラン記録が変わらない").toBe(meta);
  });
});

describe("訓練場と台", () => {
  it("木人は倒されると HUB.dummyRespawn 秒後に立ち直る", () => {
    const session = hub();
    const first = dummies(session)[0];
    if (!first) throw new Error("木人が無い");
    const pos = { ...first.body.pos };
    damageEnemy(session.state, first, 99999, { x: 1, y: 0 }, 0);
    // 撃破のヒットストップ分だけ遅れないよう、立ち直りの秒だけを数える
    session.state.hitstop = 0;
    idle(session, 1);
    expect(dummies(session), "倒れた木人は外れる").toHaveLength(HUB.dummyCount - 1);
    const frames = Math.round(HUB.dummyRespawn / FIXED_DT);
    idle(session, frames - 2);
    expect(dummies(session), "立ち直りの前").toHaveLength(HUB.dummyCount - 1);
    idle(session, 3);
    expect(dummies(session), "立ち直った").toHaveLength(HUB.dummyCount);
    const back = dummies(session).find((d) => d.body.pos.x === pos.x && d.body.pos.y === pos.y);
    expect(back, "同じ位置に立つ").toBeDefined();
    expect(back?.revived, "撃破数・ドロップに数えない").toBe(true);
  });

  it("台の近くで interactPressed を押すと open を返す", () => {
    const session = hub();
    standAt(session, "forge");
    expect(stepHub(session, withInput({ interactPressed: true }), FIXED_DT)).toEqual({ kind: "open", spot: "forge" });
    expect(session.hub.near).toBe("forge");
  });

  it("使えない台では open を返さない", () => {
    const session = hub(new Set<HubSpotKey>(["well", "board", "forge"]));
    standAt(session, "library");
    expect(stepHub(session, withInput({ interactPressed: true }), FIXED_DT).kind).toBe("none");
    expect(session.hub.near).toBeNull();
  });

  it("決定キーを HUB.departHold 秒押し続けると depart を返す", () => {
    const session = hub();
    const frames = Math.ceil(HUB.departHold / FIXED_DT);
    for (let i = 0; i < frames - 1; i++) {
      expect(stepHub(session, withInput({}), FIXED_DT, true).kind, `${i} フレーム目では出ない`).toBe("none");
    }
    const tail = [stepHub(session, withInput({}), FIXED_DT, true).kind, stepHub(session, withInput({}), FIXED_DT, true).kind];
    expect(tail, "押し続けた秒が届いたら出撃").toContain("depart");
    stepHub(session, withInput({}), FIXED_DT, true);
    stepHub(session, withInput({}), FIXED_DT, false);
    expect(session.hub.departHold, "離すと数え直し").toBe(0);
  });
});

describe("祭壇の試し打ち", () => {
  it("setTrialKeystone で誓約の数値効果が stats に入り、null で外れる", () => {
    const session = hub();
    const before = JSON.stringify(session.state.stats);
    const key = trialKeystoneKeys().find((k) => {
      setTrialKeystone(session, k);
      const changed = JSON.stringify({ ...session.state.stats, keystones: [] }) !== JSON.stringify({ ...JSON.parse(before), keystones: [] });
      setTrialKeystone(session, null);
      return changed;
    });
    if (!key) throw new Error("数値の変わる誓約が無い");
    setTrialKeystone(session, key);
    expect(session.state.stats.keystones).toContain(key);
    expect(session.hub.trialKeystone).toBe(key);
    expect(JSON.stringify(session.state.stats)).not.toBe(before);
    setTrialKeystone(session, null);
    expect(session.state.stats.keystones).not.toContain(key);
    expect(JSON.stringify(session.state.stats), "外すと元に戻る").toBe(before);
    expect(trialKeystoneKeys(), "全誓約を並べる").toHaveLength(KEYSTONES.length);
  });
});

describe("拠点のマップ", () => {
  it("buildHubMap の台と木人の位置はすべて床タイル上にある", () => {
    const layout = buildHubMap();
    const points = [...HUB_SPOT_KEYS.map((k) => layout.spots[k]), ...layout.dummySpots, layout.playerStart];
    for (const p of points) {
      const tile = getTile(layout.map, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
      expect(tile, `(${p.x}, ${p.y}) が床`).toBe(Tile.Floor);
    }
    expect(layout.dummySpots).toHaveLength(HUB.dummyCount);
  });
});

describe("武器掛け", () => {
  function ownWeapon(seed: number): ReturnType<typeof generateItem> {
    return generateItem(createRng(seed), { baseKey: "dagger", plain: true, itemLevel: 1, foundDepth: 1, now: 0 });
  }

  it("setTrialWeapon で stats.moveset が差し替わり、null で装備のものに戻る", () => {
    const session = hub();
    const { state } = session;
    expect(state.stats.moveset, "武器なしは拳の型（素手）").toBe("fists");
    setTrialWeapon(session, "greatsword");
    expect(state.stats.moveset, "大剣を試す").toBe("greatsword");
    setTrialWeapon(session, null);
    expect(state.stats.moveset, "装備（空）の拳に戻る").toBe("fists");
  });

  it("銃の家系を試すと、借りるときと同じ器の弾で撃ち、外すと装備の弾に戻る", () => {
    const session = hub();
    const { state } = session;
    const expected = { grenade: "lob", trapper: "mine", warRing: "boomerang" } as const;
    for (const [moveset, feature] of Object.entries(expected)) {
      setTrialWeapon(session, moveset as keyof typeof expected);
      expect(bulletFeatures(currentBullet(state.stats)), `${moveset} の弾`).toContain(feature);
      // 装備画面で作り直されても次のステップで戻る
      applyStats(state, computeStats(state.profile.equipment));
      idle(session, 1);
      expect(bulletFeatures(currentBullet(state.stats)), `${moveset} の弾（作り直し後）`).toContain(feature);
    }
    setTrialWeapon(session, "greatsword");
    expect(state.stats.bullet, "近接は装備の弾のまま").toBe(DEFAULT_BULLET);
    setTrialWeapon(session, null);
    expect(state.stats.bullet, "装備の剣の弾に戻る").toBe(DEFAULT_BULLET);
  });

  it("装備画面を経由して applyStats が走っても試し中の武器種が保たれる", () => {
    const session = hub();
    const { state } = session;
    setTrialWeapon(session, "whip");
    // 装備画面で付け替えると applyStats が装備から作り直す
    applyStats(state, computeStats(state.profile.equipment));
    expect(state.stats.moveset, "作り直した直後は装備の型（空なので素手の拳）").toBe("fists");
    idle(session, 1);
    expect(state.stats.moveset, "次のステップで試し中の型へ戻る").toBe("whip");
  });

  it("borrowWeapon は素の器を装着し、元の武器を倉庫へ移す", () => {
    const profile = createEmptyProfile();
    const own = ownWeapon(1);
    profile.equipment.mainHand = own;
    const loan = borrowWeapon(profile, "greatsword", 0);
    expect(loan?.loaned, "借り物の印").toBe(true);
    expect(loan?.affixes, "性質なし").toEqual([]);
    expect(profile.equipment.mainHand?.id, "借り物を装着").toBe(loan?.id);
    expect(computeStats(profile.equipment).moveset, "武器種が大剣になる").toBe("greatsword");
    expect(profile.stash.map((it) => it.id), "元の武器は倉庫へ").toEqual([own.id]);
  });

  it("借り物を返すと、借りたときに倉庫へ移した元の武器が武器スロットへ戻る", () => {
    const profile = createEmptyProfile();
    const own = ownWeapon(3);
    profile.equipment.mainHand = own;
    borrowWeapon(profile, "spear", 0);
    // 借り物どうしの付け替えでも、最初の自分の武器を覚えている
    borrowWeapon(profile, "whip", 0);
    expect(returnLoaned(profile), "借り物を外す").toBe(true);
    expect(profile.equipment.mainHand?.id, "元の武器が戻る").toBe(own.id);
    expect(profile.stash, "倉庫からは消える").toHaveLength(0);
  });

  it("借り物どうしの付け替えは前の借り物を倉庫へ入れない", () => {
    const profile = createEmptyProfile();
    borrowWeapon(profile, "spear", 0);
    borrowWeapon(profile, "scythe", 0);
    expect(computeStats(profile.equipment).moveset, "後から借りた型").toBe("scythe");
    expect(profile.stash, "倉庫は膨らまない").toHaveLength(0);
  });

  it("倉庫が満杯なら borrowWeapon は null を返し装備を変えない", () => {
    const profile = createEmptyProfile();
    const own = ownWeapon(2);
    profile.equipment.mainHand = own;
    for (let i = 0; i < STASH_CAPACITY; i++) profile.stash.push(ownWeapon(10 + i));
    expect(borrowWeapon(profile, "greatsword", 0), "断る").toBeNull();
    expect(profile.equipment.mainHand?.id, "装備はそのまま").toBe(own.id);
    expect(profile.stash, "倉庫もそのまま").toHaveLength(STASH_CAPACITY);
  });

  it("借りる武器種が銃の家系なら、右手に装着され shot もそのベースの型になる", () => {
    const profile = createEmptyProfile();
    const loan = borrowWeapon(profile, "longarm", 0);
    expect(loan?.slot, "右手").toBe("mainHand");
    expect(computeStats(profile.equipment).moveset, "銃の家系になる").toBe("longarm");
    expect(bulletFeatures(currentBullet(computeStats(profile.equipment))), "そのベースの弾（溜め撃ち）").toEqual(["charge"]);
  });

  it("borrowRackEntry は借りた武器種の「試す」を外し、stats を装備から作り直す", () => {
    const session = hub();
    setTrialWeapon(session, "fists");
    borrowRackEntry(session, { kind: "moveset", key: "staff" }, 0);
    expect(session.hub.trialMoveset, "武器種の試しは外れる").toBeNull();
    expect(session.state.stats.moveset, "借りた棍になる").toBe("staff");
  });

  it("武器掛けは木人の近くにあり、他の台と近すぎない", () => {
    const layout = buildHubMap();
    const rack = layout.spots.rack;
    const nearest = Math.min(...layout.dummySpots.map((d) => Math.hypot(d.x - rack.x, d.y - rack.y)));
    expect(nearest, "木人まで 5 タイル以内").toBeLessThanOrEqual(TILE_SIZE * 5);
    for (const key of HUB_SPOT_KEYS) {
      if (key === "rack") continue;
      const p = layout.spots[key];
      expect(Math.hypot(p.x - rack.x, p.y - rack.y), `${key} と離れている`).toBeGreaterThan(HUB.interactRadius * 2);
    }
  });
});

describe("武器掛けの奥義", () => {
  it("武器掛けで奥義を選ぶと profile.ultimates に保存され、読み直しても残る", () => {
    const session = hub();
    const set = ULTIMATES.greatsword;
    const pick = set[set.length - 1] ?? set[0];
    expect(chooseRackUltimate(session, "greatsword", pick.key), "選べた").toBe(true);
    expect(session.state.profile.ultimates?.greatsword, "profile に書かれる").toBe(pick.key);
    const storage = new MemoryStorage();
    saveProfile(session.state.profile, storage);
    const loaded = loadProfile(storage);
    expect(loaded.ultimates?.greatsword, "読み直しても残る").toBe(pick.key);
    expect(ultimateChoice(loaded, "greatsword").key, "選んだ奥義が引ける").toBe(pick.key);
  });

  it("武器種の違う奥義は選べず、選択は変わらない", () => {
    const session = hub();
    const swordKey = defaultUltimate("sword").key;
    expect(chooseRackUltimate(session, "greatsword", swordKey), "剣の奥義を大剣に付けない").toBe(false);
    expect(chooseRackUltimate(session, "greatsword", "no-such-ultimate"), "知らない key").toBe(false);
    expect(session.state.profile.ultimates, "何も書かない").toBeUndefined();
  });
});

describe("試し打ちの資源の調整", () => {
  it("setHubResource は上限で止まり、割合を上限に掛けて書く", () => {
    const session = hub();
    const p = session.state.player;
    setHubResource(session, "hp", 0.5);
    expect(p.hp, "生命の半分").toBeCloseTo(p.maxHp * 0.5);
    setHubResource(session, "hp", 3);
    expect(p.hp, "上限で止まる").toBe(p.maxHp);
    setHubResource(session, "energy", 2);
    expect(p.energy, "奥義ゲージも上限で止まる").toBe(p.maxEnergy);
    setHubResource(session, "mana", -1);
    expect(p.mana, "気力は 0 で止まる").toBe(0);
    expect(hubResourceRatio(session, "energy"), "割合で読める").toBe(1);
  });

  it("生命は 0 にしても 1 残して倒れない", () => {
    const session = hub();
    setHubResource(session, "hp", 0);
    expect(session.state.player.hp, "1 残る").toBe(1);
    idle(session, 2);
    expect(session.state.status, "倒れない").toBe("playing");
  });

  it("fillHubResources は生命・気力・奥義ゲージをすべて満たす", () => {
    const session = hub();
    for (const kind of HUB_RESOURCES) setHubResource(session, kind, 0);
    fillHubResources(session);
    for (const kind of HUB_RESOURCES) expect(hubResourceRatio(session, kind), kind).toBe(1);
  });

  it("持続の奥義の最中に奥義ゲージを 0 にすると、最短の持続秒の後に尽きて終わる", () => {
    const moveset = MOVESET_KEYS.find((k) => ULTIMATES[k].some((d) => d.kind === "sustain"));
    const def = moveset === undefined ? undefined : ULTIMATES[moveset].find((d) => d.kind === "sustain");
    if (moveset === undefined || def === undefined || def.kind !== "sustain") throw new Error("持続の奥義が無い");
    const session = hub();
    setTrialWeapon(session, moveset);
    expect(chooseRackUltimate(session, moveset, def.key), "持続の奥義を選ぶ").toBe(true);
    fillHubResources(session);
    stepHub(session, withInput({ specialPressed: true }), FIXED_DT);
    expect(session.state.player.ultimate.active, "持続が始まる").toBe(def.key);
    setHubResource(session, "energy", 0);
    // 始めの溜め（ヒットストップ）の間は時間が進まないので、その分を足して回す
    const frames = Math.ceil(def.sustain.minSec / FIXED_DT) + HITSTOP_ALLOWANCE;
    idle(session, frames);
    expect(session.state.player.ultimate.active, "尽きて終わる").toBeNull();
  });
});
