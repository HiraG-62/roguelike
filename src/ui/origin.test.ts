import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { ORIGIN, REAPER, RUN_MOD } from "../data/tuning";
import { computeStats } from "../loot/stats";
import { type Item, createEmptyEquipment, createEmptyProfile } from "../loot/types";
import { BOONS } from "../system/boons";
import { descend } from "../system/floor";
import { reaperAppearAfter } from "../system/reaper";
import { isDark } from "../system/roomTypes";
import { ORIGIN_KEYS, RUN_MODS, RUN_MOD_KEYS, type RunSetup, runTier, sanitizeRunSetup } from "../system/runSetup";
import { withInput } from "../system/testHelpers";
import { JOBS, type JobKey } from "../data/jobs";
import {
  JOB_ROWS,
  LOCKED_ORIGIN_NAME,
  ORIGIN_ROWS,
  activateOriginCursor,
  backOriginStage,
  jobCursorDetail,
  pointOriginRow,
  createOriginScreen,
  cursorDescription,
  moveOriginCursor,
  originItemAt,
  originRowTop,
  originSetup,
  toggleModifier,
} from "./origin";

const ROW_GAP = 14;

function game(setup: RunSetup, seed = 21) {
  return createGame(seed, String(seed), createEmptyProfile(), undefined, setup);
}

describe("起点画面の操作", () => {
  it("ジョブの段から開き、決定で起点の段の「出発」へ進み、もう一度の決定で始められる", () => {
    const ui = createOriginScreen();
    expect(ui.stage, "ジョブの段から").toBe("job");
    expect(JOB_ROWS[ui.jobCursor], "前回が無ければ見習い").toBe("none");
    expect(activateOriginCursor(ui), "ジョブを決める").toBe("changed");
    expect(ui.stage, "起点の段へ進む").toBe("origin");
    expect(ORIGIN_ROWS[ui.originCursor]).toBe("start");
    expect(activateOriginCursor(ui)).toBe("start");
    expect(originSetup(ui)).toEqual({ origin: "wanderer", modifiers: [], job: "none" });
  });

  it("ジョブの段で選んだジョブが出発の設定に入り、Esc で 1 段戻れる", () => {
    const ui = createOriginScreen();
    moveOriginCursor(ui, 0, 1);
    expect(moveOriginCursor(ui, 1, 0), "ジョブの段に列は無い").toBe(false);
    activateOriginCursor(ui);
    expect(ui.job, "2 行目のジョブ").toBe(JOB_ROWS[1]);
    expect(cursorDescription(ui).desc, "出発の説明にジョブ名").toContain(JOBS[JOB_ROWS[1] ?? "none"].name);
    expect(backOriginStage(ui), "起点の段から戻る").toBe(true);
    expect(ui.stage).toBe("job");
    expect(JOB_ROWS[ui.jobCursor], "カーソルは選んだジョブ").toBe(JOB_ROWS[1]);
    expect(backOriginStage(ui), "ジョブの段ではタイトルへ（false）").toBe(false);
    expect(originSetup(ui).job).toBe(JOB_ROWS[1]);
  });

  it("未解放のジョブは選べず、前回のジョブが未解放なら見習いで開く", () => {
    const locked = new Set<JobKey>(["shadow"]);
    const ui = createOriginScreen({ origin: "wanderer", modifiers: [], job: "shadow" }, new Set(), locked);
    expect(ui.job, "見習いへ戻る").toBe("none");
    ui.jobCursor = JOB_ROWS.indexOf("shadow");
    expect(activateOriginCursor(ui), "選べない").toBe("none");
    expect(ui.stage).toBe("job");
    expect(cursorDescription(ui).name, "？？？で出る").toBe(LOCKED_ORIGIN_NAME);
    expect(jobCursorDetail(ui), "詳細は出さない").toEqual([]);
  });

  it("ジョブの段のマウスの当たり判定は左の一覧だけ", () => {
    const top = originRowTop(3, ROW_GAP);
    expect(originItemAt(40, top + 1, ROW_GAP, "job")).toEqual({ column: "job", row: 3 });
    expect(originItemAt(300, top + 1, ROW_GAP, "job"), "詳細欄は行ではない").toBeNull();
    const ui = createOriginScreen();
    expect(pointOriginRow(ui, { column: "job", row: 3 })).toBe(true);
    expect(ui.jobCursor).toBe(3);
  });

  it("起点の行で決定すると起点が変わり、右の列で縛りを積み外しできる", () => {
    const ui = createOriginScreen();
    activateOriginCursor(ui);
    moveOriginCursor(ui, 0, 1);
    expect(ORIGIN_ROWS[ui.originCursor]).toBe(ORIGIN_KEYS[0]);
    moveOriginCursor(ui, 0, 1);
    expect(activateOriginCursor(ui)).toBe("changed");
    expect(ui.origin).toBe(ORIGIN_KEYS[1]);
    moveOriginCursor(ui, 1, 0);
    expect(ui.column).toBe("modifier");
    activateOriginCursor(ui);
    expect(ui.modifiers).toEqual([RUN_MOD_KEYS[0]]);
    activateOriginCursor(ui);
    expect(ui.modifiers, "もう一度で外れる").toEqual([]);
  });

  it("縛りの並びは RUN_MOD_KEYS の順にそろい、位階は点の合計", () => {
    const ui = createOriginScreen();
    toggleModifier(ui, "glassBody");
    toggleModifier(ui, "thickHide");
    const setup = originSetup(ui);
    expect(setup.modifiers).toEqual(["thickHide", "glassBody"]);
    expect(runTier(setup.modifiers)).toBe(RUN_MODS.thickHide.points + RUN_MODS.glassBody.points);
  });

  it("前回の選択を引き継いで開く", () => {
    const ui = createOriginScreen({ origin: "chanter", modifiers: ["roughLand"], job: "hunter" });
    expect(ui.origin).toBe("chanter");
    expect(ui.modifiers).toEqual(["roughLand"]);
    expect(ui.job).toBe("hunter");
    activateOriginCursor(ui);
    expect(cursorDescription(ui).desc).toContain("詠み手");
  });

  it("マウスの当たり判定は描画と同じ行の位置", () => {
    const top = originRowTop(2, ROW_GAP);
    expect(originItemAt(40, top + 1, ROW_GAP)).toEqual({ column: "origin", row: 2 });
    expect(originItemAt(300, top + 1, ROW_GAP)).toEqual({ column: "modifier", row: 2 });
    expect(originItemAt(40, 0, ROW_GAP)).toBeNull();
  });

  it("起点は 5 種以上、縛りは 8 種以上", () => {
    expect(ORIGIN_KEYS.length).toBeGreaterThanOrEqual(5);
    expect(RUN_MOD_KEYS.length).toBeGreaterThanOrEqual(8);
  });

  it("壊れた設定は sanitize で放浪者・既知の縛りだけに落ちる", () => {
    expect(sanitizeRunSetup("??", ["thickHide", "thickHide", 1, "x"])).toEqual({ origin: "wanderer", modifiers: ["thickHide"] });
  });
});

describe("起点の適用", () => {
  it("放浪者は何も変えない（stats も祝福も同じ）", () => {
    const a = game({ origin: "wanderer", modifiers: [] });
    const b = createGame(21, "21", createEmptyProfile());
    expect(a.stats.maxHp).toBe(b.stats.maxHp);
    expect(a.boons).toEqual([]);
    expect(a.runKeystones).toEqual([]);
  });

  it("剣の巡礼者: 剣の誓いを背負い、近接の祝福を 1 つ持って始まる", () => {
    const s = game({ origin: "swordPilgrim", modifiers: [] });
    expect(s.stats.keystones).toContain("ks_bladeOath");
    expect(s.boons.length).toBe(1);
    const boon = s.boons[0];
    expect(boon && BOONS[boon].tags.includes("melee")).toBe(true);
  });

  it("呪われた者: 呪い付きの祝福 2 つと振り分け点 4", () => {
    const s = game({ origin: "cursedOne", modifiers: [] });
    expect(s.boons.filter((k) => BOONS[k].cursed).length).toBe(ORIGIN.cursedBoons);
    expect(s.runAttributes.unspent).toBe(ORIGIN.cursedPoints);
  });

  it("素手: 地下 3 階までは装備が封印され、着くと解ける", () => {
    const profile = createEmptyProfile();
    const armor: Item = {
      id: "t-armor",
      seed: 1,
      baseKey: "leather",
      slot: "armor",
      rarity: "magic",
      itemLevel: 1,
      name: "試しの鎧",
      implicit: null,
      affixes: [{ key: "maxLife", value: 40 }],
      foundDepth: 1,
      foundAt: 0,
    };
    profile.equipment.armor = armor;
    const s = createGame(21, "21", profile, undefined, { origin: "unarmed", modifiers: [] });
    const bare = computeStats(createEmptyEquipment());
    expect(s.runAttributes.unspent).toBe(ORIGIN.unarmedPoints);
    expect(s.stats.maxHp).toBe(bare.maxHp);
    while (s.depth < ORIGIN.unarmedUnsealDepth) descend(s);
    expect(s.stats.maxHp, "封印が解けて装備の最大 HP が乗る").toBeGreaterThan(bare.maxHp);
  });

  it("詠み手: 刻印符を差して始まり、最大 HP が 2 割減る", () => {
    const base = game({ origin: "wanderer", modifiers: [] });
    const s = game({ origin: "chanter", modifiers: [] });
    const runes = s.skills.slots.reduce((n, slot) => n + slot.modifiers.length, 0);
    expect(runes).toBeGreaterThan(0);
    expect(s.stats.maxHp).toBeCloseTo(base.stats.maxHp * ORIGIN.chanterHpMul);
  });

  it("賭博師: 誓約「賭博師」を背負う", () => {
    const s = game({ origin: "gambler", modifiers: [] });
    expect(s.stats.keystones).toContain("ks_gambler");
  });

  it("死神の友: 階に入ってすぐ死神が出て、足は遅い。降りるたびに振り分け点が 1 多い", () => {
    const s = game({ origin: "reaperFriend", modifiers: [] });
    step(s, withInput({}), FIXED_DT);
    expect(s.reaper).not.toBeNull();
    const before = s.runAttributes.unspent;
    const plain = game({ origin: "wanderer", modifiers: [] });
    const plainBefore = plain.runAttributes.unspent;
    descend(s);
    descend(plain);
    expect(s.runAttributes.unspent - before).toBe(plain.runAttributes.unspent - plainBefore + ORIGIN.reaperFriendPoints);
    expect(ORIGIN.reaperFriendSpeedMul * REAPER.speed).toBeLessThan(REAPER.speed);
  });
});

describe("縛りの適用", () => {
  it("厚い皮: 湧く敵の HP が増える", () => {
    const plain = game({ origin: "wanderer", modifiers: [] });
    const thick = game({ origin: "wanderer", modifiers: ["thickHide"] });
    const hp = (s: typeof plain) => s.enemies.reduce((sum, e) => sum + e.maxHp, 0);
    expect(hp(thick)).toBeGreaterThan(hp(plain));
  });

  it("薄氷: 最大 HP が 3 割減る", () => {
    const plain = game({ origin: "wanderer", modifiers: [] });
    const glass = game({ origin: "wanderer", modifiers: ["glassBody"] });
    expect(glass.stats.maxHp).toBeCloseTo(plain.stats.maxHp * RUN_MOD.glassBodyHpMul);
  });

  it("常夜: どの階も暗い", () => {
    expect(isDark(game({ origin: "wanderer", modifiers: ["eternalNight"] }))).toBe(true);
    expect(isDark(game({ origin: "wanderer", modifiers: [] }))).toBe(false);
  });

  it("急かす死神: 猶予が縮む", () => {
    const plain = game({ origin: "wanderer", modifiers: [] });
    const hasty = game({ origin: "wanderer", modifiers: ["hastyReaper"] });
    expect(reaperAppearAfter(hasty)).toBeCloseTo(reaperAppearAfter(plain) * RUN_MOD.hastyReaperMul);
  });

  it("乾いた泉: 泉の部屋が出ない", () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = createGame(seed, String(seed), createEmptyProfile(), undefined, { origin: "wanderer", modifiers: ["dryFountain"] });
      for (let d = 0; d < 3; d++) descend(s);
      expect(s.rooms.some((r) => r.kind === "shrine"), `seed=${seed}`).toBe(false);
    }
  });

  it("位階が高いほど階段で得るスコアが増える", () => {
    const plain = game({ origin: "wanderer", modifiers: [] });
    const hard = game({ origin: "wanderer", modifiers: ["thickHide", "quickHands"] });
    const a = plain.score;
    const b = hard.score;
    descend(plain);
    descend(hard);
    expect(hard.score - b).toBeGreaterThan(plain.score - a);
  });
});
