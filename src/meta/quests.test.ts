import { describe, expect, it } from "vitest";
import { pushEvent } from "../core/events";
import type { GameState } from "../core/state";
import { ENEMIES } from "../data/enemies";
import { uniqueDef } from "../loot/named";
import { resolveRules } from "../system/rules";
import { ORIGINS, ORIGIN_KEYS } from "../system/runSetup";
import { arena, placeEnemy } from "../system/testHelpers";
import {
  QUESTS,
  QUEST_KEYS,
  type QuestKey,
  type QuestSnapshot,
  carriedQuest,
  codexPages,
  createQuestCounters,
  createQuestRun,
  createQuestSave,
  isOriginUnlocked,
  lockedOrigins,
  lockedRelicKeys,
  pickQuestOffers,
  questProgress,
  questSnapshot,
  questTitles,
  recordQuest,
} from "./quests";
import { QUEST_KEY, loadQuests, parseQuestSave, saveQuests } from "./questStore";
import { noteSkillCombo } from "./runRecord";
import { MemoryStorage } from "./testStorage";

const DT = 1 / 60;

function emptySnapshot(): QuestSnapshot {
  return {
    ...createQuestCounters(),
    depth: 1,
    keystones: 0,
    cursedBoons: 0,
    tier: 0,
    reactionKinds: 0,
    statusKinds: 0,
    linkKinds: 0,
    comboKinds: 0,
    chainKinds: 0,
    newLinks: 0,
    newReactions: 0,
  };
}

/** 各依頼をちょうど満たす値（依頼を足したらここにも足す。漏れは下のテストが落ちる） */
const SATISFY: Readonly<Record<QuestKey, Partial<QuestSnapshot>>> = {
  burnout: { burnKills: 50 },
  steamHand: { vaporizes: 10 },
  shaker: { staggers: 100 },
  oathless: { depth: 5, keystones: 0 },
  alchemist: { reactionKinds: 10 },
  comboArtist: { skillCombos: 5 },
  hordeBreaker: { hordesCleared: 3 },
  kingslayer: { bossKills: 2 },
  bladeOnly: { bossNoShot: 1 },
  untouched: { floorsNoHurt: 1 },
  justDancer: { justDodges: 15 },
  counterman: { counters: 10 },
  plague: { statusKinds: 5 },
  cursedDepth: { cursedBoons: 2, depth: 4 },
  highStakes: { tier: 3, depth: 3 },
  reaperDance: { reaperEscapes: 1 },
  chainWeaver: { chains: 20 },
  deepChain: { maxChainLen: 3 },
  frostbite: { chillKills: 30 },
  venomGarden: { poisonKills: 30 },
  bloodPath: { bleedKills: 30 },
  critStorm: { crits: 150 },
  spellweaver: { skillCasts: 60 },
  deepDiver: { depth: 8 },
  trialWalker: { challengesCleared: 2 },
  lairHunter: { lairKills: 3 },
  thunderRing: { shockKills: 30 },
  burstMaster: { bursts: 8 },
  pathfinder: { newLinks: 2 },
  newReaction: { newReactions: 1 },
  comboForms: { comboKinds: 3 },
  chainForms: { chainKinds: 4 },
  linkWeb: { linkKinds: 10 },
};

/** 条件の片側だけ満たしても達成しない依頼（複合条件） */
const HALF_SATISFY: Readonly<Partial<Record<QuestKey, Partial<QuestSnapshot>>>> = {
  oathless: { depth: 5, keystones: 1 },
  cursedDepth: { cursedBoons: 1, depth: 6 },
  highStakes: { tier: 2, depth: 6 },
};

function flush(state: GameState): void {
  resolveRules(state, DT, []);
}

describe("依頼: 定義", () => {
  it("20 種以上あり、名前が重ならない", () => {
    expect(QUEST_KEYS.length, "20 種以上").toBeGreaterThanOrEqual(20);
    const names = new Set(QUEST_KEYS.map((k) => QUESTS[k].name));
    expect(names.size, "名前が重ならない").toBe(QUEST_KEYS.length);
  });

  it("各依頼は条件を満たすと達成、何もしていなければ未達成", () => {
    for (const key of QUEST_KEYS) {
      expect(questProgress(key, emptySnapshot()).done, `${key} は最初は未達成`).toBe(false);
      const snap = { ...emptySnapshot(), ...SATISFY[key] };
      const p = questProgress(key, snap);
      expect(p.done, `${key} は条件で達成`).toBe(true);
      expect(p.value, `${key} の進みは goal で頭打ち`).toBe(QUESTS[key].goal);
    }
  });

  it("複合条件の依頼は片側だけでは達成しない", () => {
    for (const [key, half] of Object.entries(HALF_SATISFY)) {
      expect(questProgress(key as QuestKey, { ...emptySnapshot(), ...half }).done, `${key}`).toBe(false);
    }
  });

  it("報酬の起点・遺物は実在し、起点の unlockedBy と依頼の報酬が一致する", () => {
    for (const key of QUEST_KEYS) {
      const reward = QUESTS[key].reward;
      if (reward.kind === "relic") expect(uniqueDef(reward.relic), `${key} の遺物`).toBeDefined();
      if (reward.kind === "origin") expect(ORIGINS[reward.origin].unlockedBy, `${key} が解放する起点`).toBe(key);
    }
    for (const origin of ORIGIN_KEYS) {
      const by = ORIGINS[origin].unlockedBy;
      if (by === undefined) continue;
      const reward = QUESTS[by].reward;
      expect(reward.kind === "origin" && reward.origin === origin, `${origin} を解放する依頼の報酬`).toBe(true);
    }
  });
});

describe("依頼: ラン中の数え上げ", () => {
  it("燃焼中の撃破・ボス撃破・部屋主撃破を数える", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    pushEvent(state, { kind: "onKill", actor: "player", pos: { ...e.body.pos }, targetId: e.id, targetKey: e.defKey, targetStatus: [{ kind: "burn", stacks: 1, potency: 1 }], source: { kind: "player", key: "kill" } });
    const boss = ENEMIES.find((d) => d.boss === true);
    const lair = ENEMIES.find((d) => d.lairMaster === true);
    if (!boss || !lair) throw new Error("ボスか部屋主が無い");
    pushEvent(state, { kind: "onKill", actor: "player", pos: { x: 0, y: 0 }, targetKey: boss.key, source: { kind: "player", key: "kill" } });
    pushEvent(state, { kind: "onKill", actor: "player", pos: { x: 0, y: 0 }, targetKey: lair.key, source: { kind: "player", key: "kill" } });
    flush(state);
    const c = state.questRun.counters;
    expect(c.kills, "撃破 3").toBe(3);
    expect(c.burnKills, "燃焼中の撃破 1").toBe(1);
    expect(c.bossKills, "ボス 1").toBe(1);
    expect(c.bossNoShot, "射撃なしのボス 1").toBe(1);
    expect(c.lairKills, "部屋主 1").toBe(1);
  });

  it("通常の射撃を撃った後のボス撃破は「刃のみ」に数えない。スキルの射撃は数えない", () => {
    const state = arena();
    const boss = ENEMIES.find((d) => d.boss === true);
    if (!boss) throw new Error("ボスが無い");
    pushEvent(state, { kind: "onShoot", actor: "player", pos: { x: 0, y: 0 }, source: { kind: "skill", key: "pierceShot" } });
    flush(state);
    expect(state.questRun.counters.shots, "スキルの射撃は数えない").toBe(0);
    pushEvent(state, { kind: "onShoot", actor: "player", pos: { x: 0, y: 0 }, source: { kind: "player", key: "shoot" } });
    pushEvent(state, { kind: "onKill", actor: "player", pos: { x: 0, y: 0 }, targetKey: boss.key, source: { kind: "player", key: "kill" } });
    flush(state);
    expect(state.questRun.counters.bossNoShot, "撃った後は数えない").toBe(0);
  });

  it("怯み・反応・状態異常の種類・巣窟の制圧・連携を数える", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    const target = { pos: { ...e.body.pos }, targetId: e.id, targetKey: e.defKey };
    pushEvent(state, { kind: "onStagger", actor: "player", source: { kind: "player", key: "stagger" }, ...target });
    pushEvent(state, { kind: "onReaction", actor: "player", tag: "vaporize", source: { kind: "player", key: "reaction" }, ...target });
    pushEvent(state, { kind: "onStatusApplied", actor: "player", tag: "burn", source: { kind: "player", key: "burn" }, ...target });
    pushEvent(state, { kind: "onStatusApplied", actor: "player", tag: "chill", source: { kind: "player", key: "chill" }, ...target });
    pushEvent(state, { kind: "onRoomClear", actor: "player", pos: { x: 0, y: 0 }, tag: "horde", source: { kind: "room", key: "horde" } });
    noteSkillCombo(state);
    flush(state);
    const snap = questSnapshot(state);
    expect(snap.staggers, "怯み").toBe(1);
    expect(snap.vaporizes, "蒸発").toBe(1);
    expect(snap.reactionKinds, "反応の種類").toBe(1);
    expect(snap.statusKinds, "状態異常の種類").toBe(2);
    expect(snap.hordesCleared, "巣窟").toBe(1);
    expect(snap.skillCombos, "連携").toBe(1);
  });

  it("連携の発見を系統ごとに数え、図鑑に無かったものを新しい発見として数える", () => {
    const state = arena();
    state.codexRun.links.known.add("reaction:steam");
    pushEvent(state, { kind: "onReaction", actor: "player", pos: { x: 0, y: 0 }, tag: "steam", source: { kind: "player", key: "reaction" } });
    pushEvent(state, { kind: "onReaction", actor: "player", pos: { x: 0, y: 0 }, tag: "vaporize", source: { kind: "player", key: "reaction" } });
    noteSkillCombo(state, "wellThunder");
    flush(state);
    const snap = questSnapshot(state);
    expect(snap.linkKinds, "成立した連携").toBe(3);
    expect(snap.comboKinds, "スキルの連携").toBe(1);
    expect(snap.newLinks, "図鑑に無かった連携").toBe(2);
    expect(snap.newReactions, "図鑑に無かった反応").toBe(1);
    expect(questProgress("newReaction", snap).done, "新しい反応を達成").toBe(true);
    expect(questProgress("pathfinder", snap).done, "未踏の連携を達成").toBe(true);
  });

  it("被弾せずに降りた階と、死神の出現中に降りた階を数える", () => {
    const state = arena();
    flush(state);
    state.reaper = { pos: { x: 0, y: 0 }, radius: 8, animTime: 0 };
    flush(state);
    state.reaper = null;
    state.depth = 2;
    flush(state);
    expect(state.questRun.counters.floorsNoHurt, "無傷で降りた").toBe(1);
    expect(state.questRun.counters.reaperEscapes, "死神を背に降りた").toBe(1);
    pushEvent(state, { kind: "onHurt", actor: "enemy", pos: { x: 0, y: 0 }, source: { kind: "enemy", key: "slime" } });
    flush(state);
    state.depth = 3;
    flush(state);
    expect(state.questRun.counters.floorsNoHurt, "被弾した階は数えない").toBe(1);
  });
});

describe("依頼: ラン終了時の判定と報酬", () => {
  it("達成すると保存され、起点・頁・遺物・称号が解放される", () => {
    const save = createQuestSave();
    expect(isOriginUnlocked(save, "wanderer") && isOriginUnlocked(save, "swordPilgrim") && isOriginUnlocked(save, "unarmed"), "既定の 3 起点は最初から").toBe(true);
    expect(lockedOrigins(save).has("chanter"), "詠み手は未解放").toBe(true);
    const state = arena();
    state.questRun = createQuestRun("alchemist");
    for (let i = 0; i < 10; i++) state.questRun.reactionKinds.add(`r${i}`);
    const outcome = recordQuest(state, save, 123);
    expect(outcome?.newlyCompleted, "初めての達成").toBe(true);
    expect(save.completed.alchemist, "達成の時刻").toBe(123);
    expect(save.active, "達成したら引き継がない").toBeNull();
    expect(lockedOrigins(save).has("chanter"), "詠み手が解放").toBe(false);

    const again = recordQuest(state, save, 456);
    expect(again?.newlyCompleted, "2 回目は報酬なし").toBe(false);
    expect(save.completed.alchemist, "時刻は最初のまま").toBe(123);

    expect(lockedRelicKeys(save), "遺物の報酬は未達成なら抽選外").toContain("unshakenScale");
    save.completed.shaker = 1;
    expect(lockedRelicKeys(save), "達成で抽選に加わる").not.toContain("unshakenScale");
    save.completed.steamHand = 1;
    expect(codexPages(save).has("link"), "連携の頁").toBe(true);
    save.completed.burnout = 1;
    expect(questTitles(save).map((t) => t.key), "称号").toContain("burnout");
  });

  it("未達成なら受けた依頼を引き継ぎ、受けていなければ何もしない", () => {
    const save = createQuestSave();
    const state = arena();
    state.questRun = createQuestRun("burnout");
    const outcome = recordQuest(state, save, 1);
    expect(outcome?.done, "未達成").toBe(false);
    expect(save.active, "引き継ぐ").toBe("burnout");
    expect(carriedQuest(save), "引き継ぐ依頼").toBe("burnout");
    state.questRun = createQuestRun(null);
    expect(recordQuest(state, save, 1), "受けていない").toBeNull();
  });
});

describe("依頼: 3 択の抽選", () => {
  it("同じ seed なら同じ 3 つ、重ならず、未達成を優先する", () => {
    const save = createQuestSave();
    const a = pickQuestOffers(save, 42);
    expect(a, "決定的").toEqual(pickQuestOffers(save, 42));
    expect(new Set(a).size, "重ならない 3 つ").toBe(3);
    for (const key of QUEST_KEYS) save.completed[key] = 1;
    delete save.completed.burnout;
    const offers = pickQuestOffers(save, 7);
    expect(offers[0], "未達成が先").toBe("burnout");
    expect(offers.length, "達成済みで埋める").toBe(3);
  });
});

describe("依頼: 永続化", () => {
  it("保存して読み直すと同じ内容に戻る", () => {
    const storage = new MemoryStorage();
    const save = createQuestSave();
    save.completed.burnout = 10;
    save.active = "shaker";
    saveQuests(save, storage);
    expect(loadQuests(storage), "往復").toEqual(save);
  });

  it("壊れたデータ・未知の key は黙って既定へ落とす", () => {
    const storage = new MemoryStorage();
    storage.setItem(QUEST_KEY, "oops");
    expect(loadQuests(storage), "壊れた JSON").toEqual(createQuestSave());
    expect(parseQuestSave({ version: 2 }), "未知の version").toBeNull();
    const parsed = parseQuestSave({ version: 1, completed: { burnout: 5, nothing: 1 }, active: "nothing" });
    expect(parsed?.completed, "既知の依頼だけ").toEqual({ burnout: 5 });
    expect(parsed?.active, "未知の active は null").toBeNull();
  });
});
