import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import type { Enemy } from "../core/state";
import { HUB, STASH_CAPACITY } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { ensureGrowthFields } from "../loot/migrate";
import { recordProvenance } from "../loot/provenance";
import { returnLoaned } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { createEmptyProfile } from "../loot/types";
import { TILE_SIZE, Tile, getTile } from "../map/grid";
import { HUB_SPOT_KEYS, type HubSpotKey, buildHubMap } from "../map/hubMap";
import { KEYSTONES } from "../loot/affixes";
import { createDefaultSkillProfile } from "../skills/persistence";
import { stoneFromSeed } from "../skills/generator";
import type { SkillProfile } from "../skills/types";
import { damageEnemy, damagePlayer, recordRunOnce } from "./combat";
import { type HubSession, borrowGun, borrowRackEntry, borrowWeapon, createHub, setTrialKeystone, setTrialWeapon, stepHub, trialKeystoneKeys } from "./hub";
import { DUMMY_KEY } from "./specialRooms";
import { applyStats } from "./player";
import { withInput } from "./testHelpers";

const ALL: ReadonlySet<HubSpotKey> = new Set(HUB_SPOT_KEYS);

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
    const item = ensureGrowthFields(generateItem(createRng(7), { itemLevel: 3, foundDepth: 1, slot: "weapon", now: 0 }));
    profile.equipment.weapon = item;
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

  it("setTrialWeapon で stats.moveset / shot が差し替わり、null で装備のものに戻る", () => {
    const session = hub();
    const { state } = session;
    expect(state.stats.moveset, "武器なしは剣").toBe("sword");
    setTrialWeapon(session, "greatsword", "spread");
    expect(state.stats.moveset, "大剣を試す").toBe("greatsword");
    expect(state.stats.shot, "散弾を試す").toBe("spread");
    setTrialWeapon(session, null, null);
    expect(state.stats.moveset, "装備の剣に戻る").toBe("sword");
    expect(state.stats.shot, "装備の単発に戻る").toBe("single");
  });

  it("装備画面を経由して applyStats が走っても試し中の武器種が保たれる", () => {
    const session = hub();
    const { state } = session;
    setTrialWeapon(session, "whip", null);
    // 装備画面で付け替えると applyStats が装備から作り直す
    applyStats(state, computeStats(state.profile.equipment));
    expect(state.stats.moveset, "作り直した直後は装備の型").toBe("sword");
    idle(session, 1);
    expect(state.stats.moveset, "次のステップで試し中の型へ戻る").toBe("whip");
  });

  it("borrowWeapon は素の器を装着し、元の武器を倉庫へ移す", () => {
    const profile = createEmptyProfile();
    const own = ownWeapon(1);
    profile.equipment.weapon = own;
    const loan = borrowWeapon(profile, "greatsword", 0);
    expect(loan?.loaned, "借り物の印").toBe(true);
    expect(loan?.affixes, "性質なし").toEqual([]);
    expect(profile.equipment.weapon?.id, "借り物を装着").toBe(loan?.id);
    expect(computeStats(profile.equipment).moveset, "武器種が大剣になる").toBe("greatsword");
    expect(profile.stash.map((it) => it.id), "元の武器は倉庫へ").toEqual([own.id]);
  });

  it("借り物を返すと、借りたときに倉庫へ移した元の武器が武器スロットへ戻る", () => {
    const profile = createEmptyProfile();
    const own = ownWeapon(3);
    profile.equipment.weapon = own;
    borrowWeapon(profile, "spear", 0);
    // 借り物どうしの付け替えでも、最初の自分の武器を覚えている
    borrowWeapon(profile, "whip", 0);
    expect(returnLoaned(profile), "借り物を外す").toBe(true);
    expect(profile.equipment.weapon?.id, "元の武器が戻る").toBe(own.id);
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
    profile.equipment.weapon = own;
    for (let i = 0; i < STASH_CAPACITY; i++) profile.stash.push(ownWeapon(10 + i));
    expect(borrowWeapon(profile, "greatsword", 0), "断る").toBeNull();
    expect(profile.equipment.weapon?.id, "装備はそのまま").toBe(own.id);
    expect(profile.stash, "倉庫もそのまま").toHaveLength(STASH_CAPACITY);
  });

  it("borrowGun は射撃の型の素の器を銃スロットに装着する", () => {
    const profile = createEmptyProfile();
    const loan = borrowGun(profile, "charge", 0);
    expect(loan?.slot, "銃スロット").toBe("gun");
    expect(computeStats(profile.equipment).shot, "溜め撃ちになる").toBe("charge");
  });

  it("borrowRackEntry は借りた種類の「試す」を外し、stats を装備から作り直す", () => {
    const session = hub();
    setTrialWeapon(session, "fists", "rapid");
    borrowRackEntry(session, { kind: "moveset", key: "staff" }, 0);
    expect(session.hub.trialMoveset, "武器種の試しは外れる").toBeNull();
    expect(session.hub.trialShot, "射撃の型の試しは残る").toBe("rapid");
    expect(session.state.stats.moveset, "借りた棍になる").toBe("staff");
    expect(session.state.stats.shot, "射撃は試し中のまま").toBe("rapid");
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
