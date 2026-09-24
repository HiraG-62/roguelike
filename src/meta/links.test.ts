import { describe, expect, it } from "vitest";
import { pushEvent } from "../core/events";
import type { GameState } from "../core/state";
import { DISCOVERY } from "../data/tuning";
import { createEmptyProfile } from "../loot/types";
import type { SkillKey } from "../skills/types";
import { resolveRules } from "../system/rules";
import { arena } from "../system/testHelpers";
import { createCodexRun, createCodexSave, recordCodex } from "./codex";
import { CODEX_KEY, loadCodex, parseCodexSave, saveCodex } from "./codexStore";
import {
  NAMED_CHAINS,
  chainNameOfWords,
  comboTargets,
  createLinkRun,
  discoveryCount,
  hasLinkPage,
  isLinkId,
  knownLinkIds,
  linkId,
  linkName,
  nextLinkMilestone,
  noteLink,
  parseLinkId,
  seedKnownLinks,
} from "./links";
import { LINK_MILESTONE_KEY, codexListTabs, codexPagesWithMilestones } from "./screens";
import { noteChainRecord, noteSkillCombo } from "./runRecord";
import { MemoryStorage } from "./testStorage";

const DT = 1 / 60;

function flush(state: GameState): void {
  resolveRules(state, DT, []);
}

function reactionEvent(state: GameState, tag: string): void {
  pushEvent(state, { kind: "onReaction", actor: "player", pos: { x: 0, y: 0 }, tag, source: { kind: "player", key: "reaction" } });
}

function whirl(): SkillKey {
  const target = comboTargets("hookWhirl")[0];
  if (target === undefined) throw new Error("引き回しの後に撃つ石が無い");
  return target;
}

/** スキルを手動で撃った記録（SkillRunState.lastCast）を置く */
function cast(state: GameState, skillKey: SkillKey, at: number): void {
  state.skills.lastCast = { skillKey, slot: 0, at, pos: { ...state.player.body.pos }, hitIds: new Set() };
}

describe("連携の発見: id", () => {
  it("系統と key で往復し、今の定義に無い key は落とす", () => {
    expect(parseLinkId(linkId("reaction", "vaporize")), "往復").toEqual({ kind: "reaction", key: "vaporize" });
    expect(isLinkId("combo:wellThunder"), "スキルの連携").toBe(true);
    expect(isLinkId("chain:burn>kill"), "連鎖").toBe(true);
    expect(isLinkId("reaction:noSuch"), "未知の反応").toBe(false);
    expect(isLinkId("chain:burn"), "1 語は連鎖ではない").toBe(false);
    expect(isLinkId("other:vaporize"), "未知の系統").toBe(false);
  });

  it("名のある連鎖は先頭 2 語で引き、名の無い並びは語の並びを名前にする", () => {
    const first = NAMED_CHAINS[0];
    if (!first) throw new Error("名のある連鎖が無い");
    expect(chainNameOfWords([...first.words, "kill"]), "3 語でも先頭 2 語で引く").toBe(first.name);
    expect(chainNameOfWords(["melee"]), "1 語は名前なし").toBeNull();
    expect(linkName("chain:melee>heal"), "名の無い並び").toBe("近接→回復");
  });
});

describe("連携の発見: ラン中の記録", () => {
  it("初めて成立した連携だけが新しい発見になり、初めての階を残す", () => {
    const run = createLinkRun();
    run.known.add("reaction:steam");
    expect(noteLink(run, "reaction:vaporize", 3, 10), "図鑑に無い").toBe(true);
    expect(noteLink(run, "reaction:vaporize", 5, 11), "2 回目は新しくない").toBe(false);
    expect(noteLink(run, "reaction:steam", 4, 12), "図鑑に既にある").toBe(false);
    expect(run.firstDepth.get("reaction:vaporize"), "初めての階は最初のまま").toBe(3);
    expect(run.firstDepth.get("reaction:steam"), "既知でもこのランの初成立の階は残す").toBe(4);
    expect(run.fresh, "直近の初発見").toEqual({ id: "reaction:vaporize", time: 10 });
  });

  it("反応のイベントは連携として記録し、図鑑の既知なら依頼の新しい発見に数えない", () => {
    const state = arena();
    const save = createCodexSave();
    save.reactions.steam = 2;
    seedKnownLinks(state.codexRun.links, save);
    reactionEvent(state, "steam");
    reactionEvent(state, "vaporize");
    flush(state);
    expect([...state.questRun.linkKinds].sort(), "成立した連携").toEqual(["reaction:steam", "reaction:vaporize"]);
    expect([...state.questRun.newLinks], "新しい発見は蒸発だけ").toEqual(["reaction:vaporize"]);
    expect(state.codexRun.links.firstDepth.get("reaction:vaporize"), "初めての階").toBe(state.depth);
  });

  it("連鎖は 2 語目がつながった瞬間に連携として記録する", () => {
    const state = arena();
    noteChainRecord(state, "burn", 0);
    expect(state.questRun.linkKinds.size, "1 語では記録しない").toBe(0);
    noteChainRecord(state, "burn", 1);
    noteChainRecord(state, "explode", 2);
    expect([...state.questRun.linkKinds], "2 語と 3 語の並び").toEqual(["chain:burn>burn", "chain:burn>burn>explode"]);
  });

  it("スキルの連携は key を渡されればそのまま記録する", () => {
    const state = arena();
    noteSkillCombo(state, "wellThunder");
    expect(state.codexRun.combos.get("wellThunder"), "回数").toBe(1);
    expect(state.questRun.linkKinds.has("combo:wellThunder"), "連携の発見").toBe(true);
  });

  it("スキルの連携は key が無くても、直前の発動と今撃った石から同じステップで引き直す", () => {
    const state = arena();
    state.skills.clock = 1;
    cast(state, "chainHook", 0.8);
    noteSkillCombo(state);
    cast(state, whirl(), 1);
    flush(state);
    expect(state.codexRun.combos.get("hookWhirl"), "引き回し").toBe(1);
    expect(state.codexRun.links.pendingCombo, "控えは解決済み").toBeNull();
  });

  it("受付秒を過ぎた直前の発動からは連携を引かない", () => {
    const state = arena();
    state.skills.clock = 100;
    cast(state, "chainHook", 0);
    noteSkillCombo(state);
    cast(state, whirl(), 100);
    flush(state);
    expect(state.codexRun.combos.size, "記録しない").toBe(0);
  });

  it("連携の記録はゲームの乱数を動かさない", () => {
    const a = arena(11);
    const b = arena(11);
    reactionEvent(a, "vaporize");
    noteSkillCombo(a, "wellThunder");
    flush(a);
    flush(b);
    expect(a.rng.next(), "同じ seed の乱数列がそろう").toBe(b.rng.next());
  });
});

describe("連携の発見: 図鑑への畳み込みと永続化", () => {
  it("スキルの連携の回数と初発見の階・シードを畳み、既にある初発見は上書きしない", () => {
    const run = createCodexRun();
    run.combos.set("wellThunder", 2);
    run.links.firstDepth.set("combo:wellThunder", 4);
    run.links.firstDepth.set("reaction:noSuch", 1);
    const save = createCodexSave();
    const added = recordCodex({ codexRun: run, boons: [], profile: createEmptyProfile(), seedText: "abc" }, save);
    expect(save.combos.wellThunder, "回数").toBe(2);
    expect(save.firstSeen["combo:wellThunder"], "初発見").toEqual({ depth: 4, seed: "abc" });
    expect(save.firstSeen["reaction:noSuch"], "未知の id は載せない").toBeUndefined();
    expect(added, "連携 1 件").toBe(1);
    run.links.firstDepth.set("combo:wellThunder", 9);
    recordCodex({ codexRun: run, boons: [], profile: createEmptyProfile(), seedText: "xyz" }, save);
    expect(save.firstSeen["combo:wellThunder"], "最初の記録のまま").toEqual({ depth: 4, seed: "abc" });
  });

  it("保存して読み直すと同じ内容に戻り、旧データ（欄が無い）・壊れた初発見は黙って補う", () => {
    const storage = new MemoryStorage();
    const save = createCodexSave();
    save.combos.wellThunder = 3;
    save.firstSeen["combo:wellThunder"] = { depth: 2, seed: "s" };
    saveCodex(save, storage);
    expect(loadCodex(storage), "往復").toEqual(save);
    const old = parseCodexSave({ version: 1, reactions: { vaporize: 1 } });
    expect(old?.combos, "旧データの連携は空").toEqual({});
    expect(old?.firstSeen, "旧データの初発見は空").toEqual({});
    const broken = parseCodexSave({
      version: 1,
      combos: { wellThunder: 1, noSuch: 4 },
      firstSeen: { "combo:wellThunder": { depth: 0, seed: "a" }, "reaction:vaporize": { depth: 3, seed: 7 }, bad: { depth: 1 } },
    });
    expect(broken?.combos, "未知の連携は捨てる").toEqual({ wellThunder: 1 });
    expect(broken?.firstSeen, "階の無い初発見は捨て、壊れたシードは空にする").toEqual({ "reaction:vaporize": { depth: 3, seed: "" } });
    storage.setItem(CODEX_KEY, "{broken");
    expect(loadCodex(storage), "壊れた JSON は空").toEqual(createCodexSave());
  });
});

describe("連携の発見: 節目", () => {
  function saveWith(n: number): ReturnType<typeof createCodexSave> {
    const save = createCodexSave();
    const words = ["melee", "ranged", "dash", "burn", "chill", "shock", "poison", "bleed"];
    let added = 0;
    for (const a of words) {
      for (const b of words) {
        if (added >= n) return save;
        save.chains[`${a}>${b}`] = 1;
        added += 1;
      }
    }
    return save;
  }

  it("3 系統の発見を合わせて数え、図鑑の既知として写せる", () => {
    const save = createCodexSave();
    save.combos.wellThunder = 1;
    save.reactions.vaporize = 2;
    save.chains["burn>kill"] = 1;
    save.chains["nope>x"] = 1;
    expect(discoveryCount(save), "3 系統で 3 種").toBe(3);
    expect([...knownLinkIds(save)].sort(), "既知の id").toEqual(["chain:burn>kill", "combo:wellThunder", "reaction:vaporize"]);
  });

  it("節目に届くと頁「連携」が開き、次の節目が進む", () => {
    const before = saveWith(DISCOVERY.milestonePage - 1);
    expect(hasLinkPage(before), "届く前は頁なし").toBe(false);
    expect(nextLinkMilestone(discoveryCount(before))?.count, "次は頁の節目").toBe(DISCOVERY.milestonePage);
    expect(codexPagesWithMilestones(before, new Set()).has("link"), "図鑑の頁にも無い").toBe(false);
    const after = saveWith(DISCOVERY.milestonePage);
    expect(hasLinkPage(after), "頁が開く").toBe(true);
    expect(codexPagesWithMilestones(after, new Set()).has("link"), "図鑑の頁に合流").toBe(true);
    expect(nextLinkMilestone(discoveryCount(after))?.count, "次は称号の節目").toBe(DISCOVERY.milestoneTitle);
    expect(nextLinkMilestone(DISCOVERY.milestoneGrand), "すべて越えた").toBeNull();
  });

  it("図鑑の連携タブの先頭は節目の行で、スキルの連携・反応が「？？？」で並ぶ", () => {
    const tabs = codexListTabs(createCodexSave(), new Set());
    const link = tabs.find((t) => t.entries.some((e) => e.key === LINK_MILESTONE_KEY));
    expect(link?.entries[0]?.key, "先頭は節目").toBe(LINK_MILESTONE_KEY);
    const combos = link?.entries.filter((e) => e.key.startsWith("combo:")) ?? [];
    expect(combos.length, "スキルの連携が並ぶ").toBeGreaterThan(0);
    expect(combos.every((e) => !e.known), "未発見").toBe(true);
  });
});
