import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { damagePlayer } from "../system/combat";
import { chooseBud } from "../system/loot";
import { ascend, buildFloor } from "../system/floor";
import { affixDef } from "./affixes";
import { traitColorOf } from "./colors";
import { generateItem } from "./generator";
import { engraveName } from "./names";
import {
  MILESTONES,
  chooseBudOnItem,
  findPendingBud,
  makeBudOffer,
  milestoneDef,
  offerNextBud,
  recordProvenance,
} from "./provenance";
import { OPPOSITE_COLOR } from "./colors";
import { createEmptyProfile, createEmptyProvenance, type Item, type Profile } from "./types";

const NOW = 1_700_000_000_000;
const KILLS_FOR_FIRST_BUD = 50;

function weapon(seed = 1, margin = 3): Item {
  const item = generateItem(createRng(seed), { itemLevel: 10, foundDepth: 10, slot: "mainHand", now: NOW });
  return { ...item, affixes: item.affixes.slice(0, 1), margin, marginMax: margin };
}

function profileWith(item: Item): Profile {
  const profile = createEmptyProfile();
  profile.equipment[item.slot] = item;
  return profile;
}

function kill(state: ReturnType<typeof createGame>, times: number, enemyKey = "slime"): void {
  for (let i = 0; i < times; i++) recordProvenance(state, { kind: "kill", enemyKey, boss: false });
}

describe("recordProvenance: 来歴の加算", () => {
  it("装備中のアイテムにだけ出来事を積む（敵種別の撃破・ボス・JUST・被弾・部屋・階層）", () => {
    const equipped = weapon();
    const stashed = weapon(2);
    const profile = profileWith(equipped);
    profile.stash.push(stashed);
    const state = createGame(1, "1", profile);
    kill(state, 3);
    recordProvenance(state, { kind: "kill", enemyKey: "kingSlime", boss: true });
    recordProvenance(state, { kind: "just" });
    recordProvenance(state, { kind: "hurt" });
    recordProvenance(state, { kind: "roomClear" });
    recordProvenance(state, { kind: "floorClear" });
    const p = state.profile.equipment.mainHand?.provenance;
    expect(p?.kills).toBe(4);
    expect(p?.killsByEnemy).toEqual({ slime: 3, kingSlime: 1 });
    expect(p?.bosses).toBe(1);
    expect(p?.justDodges).toBe(1);
    expect(p?.hurtTaken).toBe(1);
    expect(p?.roomsCleared).toBe(1);
    expect(p?.floorsCleared).toBe(1);
    expect(p?.deepest).toBe(state.depth);
    expect(state.profile.stash[0]?.provenance).toEqual(createEmptyProvenance());
  });

  it("旧形式のアイテム（provenance 無し）を装備していても積める", () => {
    const legacy: Item = {
      id: "legacy",
      seed: 3,
      baseKey: "shortsword",
      slot: "mainHand",
      rarity: "magic",
      itemLevel: 5,
      name: "old",
      implicit: null,
      affixes: [{ key: "meleeDamagePct", kind: "prefix", tier: 3, value: 30 }],
      foundDepth: 5,
      foundAt: 0,
    };
    const state = createGame(1, "1", profileWith(legacy));
    kill(state, 1);
    expect(state.profile.equipment.mainHand?.provenance?.kills).toBe(1);
    expect(state.profile.equipment.mainHand?.margin).toBe(3);
  });

  it("戦闘のフック: 被弾で hurtTaken が増える", () => {
    const state = createGame(1, "1", profileWith(weapon()));
    state.player.invulnTimer = 0;
    damagePlayer(state, 5, { x: state.player.body.pos.x + 10, y: state.player.body.pos.y });
    expect(state.profile.equipment.mainHand?.provenance?.hurtTaken).toBe(1);
  });
});

describe("芽", () => {
  it(`撃破 ${KILLS_FOR_FIRST_BUD} で芽が出て state.pendingBud に載る。片方は節目の色、もう片方は反対色`, () => {
    const state = createGame(1, "1", profileWith(weapon()));
    kill(state, KILLS_FOR_FIRST_BUD - 1);
    expect(state.pendingBud).toBeNull();
    kill(state, 1);
    const pending = state.pendingBud;
    expect(pending).not.toBeNull();
    if (pending === null) return;
    expect(pending.milestone).toBe(`kills:${KILLS_FOR_FIRST_BUD}`);
    expect(pending.slot).toBe("mainHand");
    const def = milestoneDef(pending.milestone);
    expect(def?.color).toBe("crimson");
    expect(traitColorOf(pending.options[0])).toBe("crimson");
    expect(traitColorOf(pending.options[1])).toBe(OPPOSITE_COLOR.crimson);
    const item = state.profile.equipment.mainHand;
    const existing = new Set(item?.affixes.map((r) => r.key));
    for (const option of pending.options) expect(existing.has(option.key)).toBe(false);
  });

  it("同じアイテム・同じ節目なら同じ候補（純関数）", () => {
    const def = MILESTONES[0];
    if (def === undefined) throw new Error("no milestones");
    expect(makeBudOffer(weapon(7), def)).toEqual(makeBudOffer(weapon(7), def));
  });

  it("右手の家系を守る: 銃の芽は family:melee を出さず、剣の芽は family:gun を出さない", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const def of MILESTONES) {
        const gun = { ...generateItem(createRng(seed), { itemLevel: 10, foundDepth: 10, slot: "mainHand", baseKey: "pistol", now: NOW }), affixes: [] };
        const gunOffer = makeBudOffer(gun, def);
        for (const option of gunOffer?.options ?? []) {
          expect(affixDef(option.key)?.family, `seed ${seed} ${def.key}: ${option.key}`).not.toBe("melee");
        }
        const sword = { ...generateItem(createRng(seed), { itemLevel: 10, foundDepth: 10, slot: "mainHand", baseKey: "longsword", now: NOW }), affixes: [] };
        const swordOffer = makeBudOffer(sword, def);
        for (const option of swordOffer?.options ?? []) {
          expect(affixDef(option.key)?.family, `seed ${seed} ${def.key}: ${option.key}`).not.toBe("gun");
        }
      }
    }
  });

  it("chooseBud: 選んだ性質が芽として加わり、余白が 1 減り、履歴に 2 択が残る。stats も畳み込み直す", () => {
    const state = createGame(1, "1", profileWith(weapon(1, 3)));
    kill(state, KILLS_FOR_FIRST_BUD);
    const pending = state.pendingBud;
    if (pending === null) throw new Error("no bud");
    const statsBefore = state.stats;
    const chosen = chooseBud(state, 1);
    expect(chosen?.key).toBe(pending.options[1].key);
    const item = state.profile.equipment.mainHand;
    expect(item?.affixes.at(-1)?.key).toBe(pending.options[1].key);
    expect(item?.affixes.at(-1)?.origin).toBe("bud");
    expect(item?.margin).toBe(2);
    expect(item?.buds).toEqual([{ milestone: pending.milestone, options: pending.options, chosen: 1 }]);
    expect(item?.budOffer).toBeNull();
    expect(state.pendingBud).toBeNull();
    expect(state.stats).not.toBe(statsBefore);
    expect(chooseBud(state, 0)).toBeNull();
  });

  it("選ばなかった枝は二度と出ない（以降の芽の候補にも現れない）", () => {
    const item = weapon(11, 4);
    item.provenance = { ...createEmptyProvenance(), kills: 600, justDodges: 100, hurtTaken: 200 };
    const rejected = new Set<string>();
    for (let i = 0; i < 4; i++) {
      offerNextBud(item);
      const offer = item.budOffer;
      if (offer === null || offer === undefined) break;
      for (const option of offer.options) expect(rejected.has(option.key)).toBe(false);
      rejected.add(offer.options[1].key);
      chooseBudOnItem(item, 0);
    }
    expect(item.buds?.length).toBe(4);
    for (const key of rejected) expect(item.affixes.some((r) => r.key === key)).toBe(false);
  });

  it("余白が 0 なら芽は出ない。余白を使い切ると来歴から銘が刻まれ、名前が銘になる", () => {
    const item = weapon(12, 1);
    item.provenance = { ...createEmptyProvenance(), kills: 300, killsByEnemy: { slime: 300 }, justDodges: 50 };
    expect(offerNextBud(item)).toBe(true);
    chooseBudOnItem(item, 0);
    expect(item.margin).toBe(0);
    expect(item.inscription).toBe("見切りのスライム喰らい");
    expect(item.name).toBe(item.inscription);
    expect(offerNextBud(item)).toBe(false);
    expect(item.budOffer).toBeNull();
  });

  it("findPendingBud は装備中で芽を持つ最初のアイテム", () => {
    const item = weapon(13, 2);
    item.provenance = { ...createEmptyProvenance(), justDodges: 20 };
    offerNextBud(item);
    const pending = findPendingBud(profileWith(item));
    expect(pending?.itemId).toBe(item.id);
    expect(pending?.milestoneLabel).toBe("見切り 20");
  });
});

describe("銘", () => {
  it("来歴の最も目立つものが名詞、2 番目が修飾。来歴が無ければ静かな銘", () => {
    const p = { ...createEmptyProvenance(), hurtTaken: 160, bosses: 1 };
    expect(engraveName(p, 0)).toBe("王殺しの不屈");
    expect(engraveName({ ...createEmptyProvenance(), justDodges: 5 }, 0)).toBe("見切り");
    expect(engraveName(createEmptyProvenance(), 0).length).toBeGreaterThan(0);
  });
});

describe("帰還の節目（2026-09-24 第 4 弾）", () => {
  it("帰還の出来事で returns が積もり、最初の帰還で芽が 1 つ出る", () => {
    const state = createGame(1, "1", profileWith(weapon(21, 3)));
    recordProvenance(state, { kind: "returned" });
    const item = state.profile.equipment.mainHand;
    expect(item?.provenance?.returns).toBe(1);
    expect(item?.budOffer?.milestone, "帰還の節目の芽").toBe("returns:1");
    expect(state.pendingBud?.milestone).toBe("returns:1");
    expect(milestoneDef("returns:1")?.label).toBe("帰還 1");
  });

  it("上り階段で戻る（ascend）と装備中の遺物に帰還が積もる", () => {
    const state = createGame(5, "5", profileWith(weapon(22, 3)));
    state.depth = 6;
    state.runEvents.strata.deepest = 6;
    buildFloor(state, "rooms");
    ascend(state);
    expect(state.profile.equipment.mainHand?.provenance?.returns).toBe(1);
    expect(state.profile.equipment.mainHand?.milestones).toContain("returns:1");
  });

  it("旧セーブの来歴（returns 無し）は 0 で補われる", () => {
    const { returns: _r, ...old } = createEmptyProvenance();
    const item = weapon(23, 3);
    item.provenance = old as ReturnType<typeof createEmptyProvenance>;
    offerNextBud(item);
    expect(item.provenance.returns).toBe(0);
  });
});
