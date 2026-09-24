import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import type { Enemy } from "../core/state";
import { HUB } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { ensureGrowthFields } from "../loot/migrate";
import { recordProvenance } from "../loot/provenance";
import { createEmptyProfile } from "../loot/types";
import { TILE_SIZE, Tile, getTile } from "../map/grid";
import { HUB_SPOT_KEYS, type HubSpotKey, buildHubMap } from "../map/hubMap";
import { KEYSTONES } from "../loot/affixes";
import { createDefaultSkillProfile } from "../skills/persistence";
import { stoneFromSeed } from "../skills/generator";
import type { SkillProfile } from "../skills/types";
import { damageEnemy, damagePlayer, recordRunOnce } from "./combat";
import { type HubSession, createHub, setTrialKeystone, stepHub, trialKeystoneKeys } from "./hub";
import { DUMMY_KEY } from "./specialRooms";
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
