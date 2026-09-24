import { describe, expect, it } from "vitest";
import { pushEvent, pushKillEvents } from "../core/events";
import { REACTION_KEYS, STATUS_LABEL } from "../core/status";
import { createRng } from "../core/rng";
import { generateItem } from "../loot/generator";
import { UNIQUES } from "../loot/named";
import { createEmptyProfile } from "../loot/types";
import { applyStatus } from "../system/statusEffects";
import { resolveRules } from "../system/rules";
import { arena, placeEnemy } from "../system/testHelpers";
import {
  CHAIN_SEPARATOR,
  CODEX_ENEMIES,
  CODEX_TABS,
  CONSTANT_REACTIONS,
  REACTION_PARTS,
  UNKNOWN_NAME,
  codexEntries,
  codexTabCount,
  createCodexRun,
  createCodexSave,
  noteChainStep,
  recordCodex,
} from "./codex";
import { CODEX_KEY, loadCodex, parseCodexSave, saveCodex } from "./codexStore";
import { noteChainRecord } from "./runRecord";
import { MemoryStorage } from "./testStorage";

const DT = 1 / 60;

/** 積んだイベントを図鑑の記録へ流す（Rule は照合しない） */
function flush(state: ReturnType<typeof arena>): void {
  resolveRules(state, DT, []);
}

describe("図鑑: ラン中の記録", () => {
  it("撃破のイベントで敵が「見た」と「倒した」の両方に載る", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    pushKillEvents(state, e);
    flush(state);
    expect(state.codexRun.seen.has("slime"), "見た敵に載る").toBe(true);
    expect(state.codexRun.killed.get("slime"), "倒した回数").toBe(1);
  });

  it("予兆・命中だけの敵は見た敵に載るが、倒した数は増えない", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    pushEvent(state, { kind: "onEnemyWindup", actor: "enemy", pos: { ...e.body.pos }, targetId: e.id, targetKey: e.defKey, source: { kind: "enemy", key: e.defKey } });
    flush(state);
    expect(state.codexRun.seen.has("slime"), "見た敵に載る").toBe(true);
    expect(state.codexRun.killed.size, "倒した敵は無い").toBe(0);
  });

  it("反応のイベントを種類ごとに数える", () => {
    const state = arena();
    pushEvent(state, { kind: "onReaction", actor: "player", pos: { x: 0, y: 0 }, tag: "vaporize", source: { kind: "player", key: "reaction" } });
    pushEvent(state, { kind: "onReaction", actor: "player", pos: { x: 0, y: 0 }, tag: "vaporize", source: { kind: "player", key: "reaction" } });
    flush(state);
    expect(state.codexRun.reactions.get("vaporize"), "蒸発 2 回").toBe(2);
  });

  it("常時の反応は、2 つの状態異常が同時に付いた瞬間に記録される", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    const target = { kind: "enemy" as const, enemy: e };
    applyStatus(state, target, { kind: "corrode", stacks: 1, duration: 5, potency: 1 }, "player");
    flush(state);
    expect(state.codexRun.reactions.has("dissolve"), "片方だけでは起きない").toBe(false);
    applyStatus(state, target, { kind: "poison", stacks: 1, duration: 5, potency: 0.01 }, "player");
    flush(state);
    expect(state.codexRun.reactions.has("dissolve"), "腐食 + 毒 = 溶解").toBe(true);
  });

  it("場所: 今の階の種類と、封鎖・制圧した部屋の種類を記録する", () => {
    const state = arena();
    pushEvent(state, { kind: "onRoomClear", actor: "player", pos: { x: 0, y: 0 }, tag: "horde", source: { kind: "room", key: "horde" } });
    flush(state);
    expect(state.codexRun.floorKinds.has(state.floorKind), "今の階").toBe(true);
    expect(state.codexRun.roomKinds.has("horde"), "制圧した巣窟").toBe(true);
  });

  it("記録はゲームの乱数を動かさない", () => {
    const a = arena(11);
    const b = arena(11);
    const e = placeEnemy(a, "slime", 40);
    placeEnemy(b, "slime", 40);
    pushKillEvents(a, e);
    flush(a);
    flush(b);
    expect(a.rng.next(), "同じ seed の乱数列がそろう").toBe(b.rng.next());
  });
});

describe("図鑑: 連鎖の組み立て", () => {
  it("深さが増える間は 1 本の連鎖、2 語目から記録する", () => {
    const run = createCodexRun();
    expect(noteChainStep(run, "burn", 0), "1 語目は連鎖ではない").toBe(0);
    expect(noteChainStep(run, "melee", 1), "2 語目で連鎖").toBe(2);
    expect(noteChainStep(run, "chill", 2), "3 語目").toBe(3);
    expect(run.chains.get(["burn", "melee"].join(CHAIN_SEPARATOR)), "2 語の並び").toBe(1);
    expect(run.chains.get(["burn", "melee", "chill"].join(CHAIN_SEPARATOR)), "3 語の並び").toBe(1);
  });

  it("深さが戻ったら新しい連鎖になる。語にならない効果は飛ばす", () => {
    const run = createCodexRun();
    noteChainStep(run, "burn", 0);
    noteChainStep(run, "notAKeyword", 1);
    noteChainStep(run, "melee", 1);
    noteChainStep(run, "chill", 0);
    noteChainStep(run, "burn", 1);
    expect([...run.chains.keys()].sort(), "2 本の連鎖").toEqual(["burn>melee", "chill>burn"]);
  });

  it("連鎖の記録は依頼の連鎖数と最長も数える", () => {
    const state = arena();
    noteChainRecord(state, "burn", 0);
    noteChainRecord(state, "melee", 1);
    noteChainRecord(state, "chill", 2);
    expect(state.questRun.counters.chains, "2 語目で 1 回").toBe(1);
    expect(state.questRun.counters.maxChainLen, "最長 3 語").toBe(3);
  });
});

describe("図鑑: 保存データへの畳み込み", () => {
  it("ランの記録・祝福・持っている名のある遺物を畳み、初めての件数を返す", () => {
    const state = arena();
    const relic = UNIQUES[0];
    if (!relic) throw new Error("名のある遺物が無い");
    state.codexRun.seen.add("slime");
    state.codexRun.killed.set("slime", 3);
    state.codexRun.reactions.set("vaporize", 2);
    state.boons = ["dashGun"];
    const profile = createEmptyProfile();
    profile.stash.push({ ...generateItem(createRng(1), { itemLevel: 1, foundDepth: 1, now: 0 }), namedKey: relic.key });
    const save = createCodexSave();
    const added = recordCodex({ codexRun: state.codexRun, boons: state.boons, profile }, save);
    expect(save.enemyKills.slime, "撃破数").toBe(3);
    expect(save.relics, "遺物").toEqual([relic.key]);
    expect(save.boons, "祝福").toEqual(["dashGun"]);
    expect(added, "見た敵・撃破・遺物・祝福・反応の 5 件").toBe(5);
    const again = recordCodex({ codexRun: state.codexRun, boons: state.boons, profile }, save);
    expect(again, "2 回目は新しい記録が無い").toBe(0);
    expect(save.enemyKills.slime, "撃破数は足し込む").toBe(6);
  });

  it("未知の key は載せない", () => {
    const run = createCodexRun();
    run.seen.add("noSuchEnemy");
    run.reactions.set("noSuchReaction", 1);
    const save = createCodexSave();
    recordCodex({ codexRun: run, boons: [], profile: createEmptyProfile() }, save);
    expect(save.enemiesSeen.length + Object.keys(save.reactions).length, "何も載らない").toBe(0);
  });
});

describe("図鑑: 未発見のヒント", () => {
  it("未発見の反応は名前が？で、出す側だけを見せる", () => {
    const entries = codexEntries(createCodexSave(), "link");
    const vaporize = entries.find((e) => e.key === "reaction:vaporize");
    expect(REACTION_PARTS.vaporize.parts, "蒸発は燃焼 + 冷気").toEqual(["burn", "chill"]);
    expect(vaporize?.name, "名前は？").toBe(UNKNOWN_NAME);
    expect(vaporize?.detail.includes(STATUS_LABEL.burn), "出す側は見える").toBe(true);
    expect(vaporize?.detail.includes(STATUS_LABEL.chill), "食う側は隠れる").toBe(false);
  });

  it("連携の頁があれば両側が見え、発見済みは名前が出る", () => {
    const save = createCodexSave();
    const paged = codexEntries(save, "link", new Set(["link"])).find((e) => e.key === "reaction:vaporize");
    expect(paged?.detail.includes(STATUS_LABEL.chill), "頁があれば食う側も見える").toBe(true);
    save.reactions.vaporize = 1;
    const known = codexEntries(save, "link").find((e) => e.key === "reaction:vaporize");
    expect(known?.known, "発見済み").toBe(true);
    expect(known?.name, "名前が出る").not.toBe(UNKNOWN_NAME);
  });

  it("全タブが項目を返し、発見数は 0 から始まる", () => {
    const save = createCodexSave();
    for (const tab of CODEX_TABS) {
      const count = codexTabCount(save, tab);
      expect(count.known, `${tab} は未発見`).toBe(0);
      if (tab !== "link") expect(count.total, `${tab} の総数`).toBeGreaterThan(0);
    }
    expect(codexTabCount(save, "enemy").total, "敵の総数は図鑑の敵").toBe(CODEX_ENEMIES.length);
    const reactions = codexEntries(save, "link").filter((e) => e.key.startsWith("reaction:"));
    expect(reactions.length, "反応は全種が連携の頁に並ぶ").toBe(REACTION_KEYS.length);
  });

  it("常時の反応はすべて状態異常 2 つの組", () => {
    for (const r of CONSTANT_REACTIONS) expect(r.a, `${r.key}`).not.toBe(r.b);
    expect(CONSTANT_REACTIONS.length, "常時の反応がある").toBeGreaterThan(0);
  });
});

describe("図鑑: 永続化", () => {
  it("保存して読み直すと同じ内容に戻る", () => {
    const storage = new MemoryStorage();
    const save = createCodexSave();
    save.enemiesSeen.push("slime");
    save.enemyKills.slime = 4;
    save.reactions.vaporize = 2;
    save.chains["burn>melee"] = 3;
    save.floorKinds.push("cave");
    save.roomKinds.push("horde");
    saveCodex(save, storage);
    expect(loadCodex(storage), "往復").toEqual(save);
  });

  it("壊れたデータ・未知の version・未知の key は黙って落とす", () => {
    const storage = new MemoryStorage();
    storage.setItem(CODEX_KEY, "{not json");
    expect(loadCodex(storage), "壊れた JSON は空").toEqual(createCodexSave());
    expect(parseCodexSave({ version: 99 }), "未知の version").toBeNull();
    const parsed = parseCodexSave({ version: 1, enemiesSeen: ["slime", "ghostOfNothing", 3], enemyKills: { slime: -2 }, chains: { "burn>x": 1 } });
    expect(parsed?.enemiesSeen, "既知の敵だけ").toEqual(["slime"]);
    expect(parsed?.enemyKills, "負の回数は捨てる").toEqual({});
    expect(parsed?.chains, "未知の語の連鎖は捨てる").toEqual({});
  });
});
