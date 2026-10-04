import { describe, expect, it } from "vitest";
import { createEmptyProfile, type RunHistoryEntry } from "../loot/types";
import { ARC } from "../data/tuning";
import {
  TITLE_CHAPTER_NAMES,
  TITLE_MAIN_ITEMS,
  TITLE_MENU_PANEL,
  TITLE_RECORD_ITEMS,
  TITLE_START_SECONDS,
  activateTitleItem,
  backTitleMenu,
  beginTitleStart,
  computeTitleRecord,
  createTitleMenu,
  moveTitleCursor,
  pointTitleItem,
  stepTitleStart,
  titleChapterIndex,
  titleItemAt,
  titleItemRects,
  titleMenuItems,
  titleOutcomeText,
  titleStartView,
} from "./title";

function entry(over: Partial<RunHistoryEntry>): RunHistoryEntry {
  return { date: 0, seedText: "s", depth: 1, kills: 0, score: 0, bestCombo: 0, durationSec: 0, ...over };
}

describe("タイトルのメニュー: 項目とカーソル", () => {
  it("主メニューは 拠点へ / デイリー / 記録 / 設定 / ゲームを終了する の 5 つ", () => {
    expect(TITLE_MAIN_ITEMS, "主メニューの項目").toEqual(["hub", "daily", "records", "settings", "quit"]);
    expect(createTitleMenu(), "最初は拠点へにカーソル").toEqual({ level: "main", index: 0 });
  });

  it("カーソルは端で回る", () => {
    const menu = createTitleMenu();
    expect(moveTitleCursor(menu, -1), "上へ動いた").toBe(true);
    expect(menu.index, "先頭から上は末尾").toBe(TITLE_MAIN_ITEMS.length - 1);
    moveTitleCursor(menu, 1);
    expect(menu.index, "末尾から下は先頭").toBe(0);
    expect(moveTitleCursor(menu, 0), "0 は動かない").toBe(false);
  });

  it("記録を決定すると下の階層に入り、戻るで記録の項目へ戻る", () => {
    const menu = createTitleMenu();
    menu.index = TITLE_MAIN_ITEMS.indexOf("records");
    expect(activateTitleItem(menu), "階層を開くだけで何も起動しない").toEqual({ kind: "none" });
    expect(menu, "記録の下の階層の先頭").toEqual({ level: "records", index: 0 });
    expect(titleMenuItems(menu.level), "探索履歴・図鑑・依頼・実績・Tips ノート・戻る").toEqual(TITLE_RECORD_ITEMS);
    menu.index = TITLE_RECORD_ITEMS.indexOf("back");
    expect(activateTitleItem(menu), "戻るも階層の移動だけ").toEqual({ kind: "none" });
    expect(menu, "主メニューの記録に戻る").toEqual({ level: "main", index: TITLE_MAIN_ITEMS.indexOf("records") });
  });

  it("Esc 相当の backTitleMenu は記録の下でだけ戻る", () => {
    const menu = createTitleMenu();
    expect(backTitleMenu(menu), "主メニューでは何もしない").toBe(false);
    menu.level = "records";
    menu.index = 3;
    expect(backTitleMenu(menu), "記録の下では戻る").toBe(true);
    expect(menu.level, "主メニューへ").toBe("main");
  });

  it("決定の結果: 拠点へ・デイリーは開始、設定は設定、終了は終了、記録の頁は開く先", () => {
    const at = (level: "main" | "records", item: string) => {
      const menu = { level, index: titleMenuItems(level).findIndex((i) => i === item) };
      return activateTitleItem(menu);
    };
    expect(at("main", "hub"), "拠点へ").toEqual({ kind: "start", start: "hub" });
    expect(at("main", "daily"), "デイリー").toEqual({ kind: "start", start: "daily" });
    expect(at("main", "settings"), "設定").toEqual({ kind: "settings" });
    expect(at("main", "quit"), "ゲームを終了する").toEqual({ kind: "quit" });
    for (const target of ["history", "codex", "quests", "achievements", "tips"] as const) {
      expect(at("records", target), `${target} を開く`).toEqual({ kind: "open", target });
    }
  });

  it("マウスが乗った行へカーソルが移り、同じ行・範囲外では動かない", () => {
    const menu = createTitleMenu();
    expect(pointTitleItem(menu, 2), "別の行へ移った").toBe(true);
    expect(menu.index).toBe(2);
    expect(pointTitleItem(menu, 2), "同じ行は変化なし").toBe(false);
    expect(pointTitleItem(menu, 9), "範囲外は無視").toBe(false);
    expect(pointTitleItem(menu, -1), "負は無視").toBe(false);
  });
});

describe("タイトルのメニュー: 当たり判定", () => {
  it("行の矩形の中心は自分の index を返し、面の外は null", () => {
    for (const level of ["main", "records"] as const) {
      titleItemRects(level).forEach((r, i) => {
        expect(titleItemAt(r.x + r.w / 2, r.y + r.h / 2, level), `${level} の ${i} 行目`).toBe(i);
      });
    }
    expect(titleItemAt(1, 1, "main"), "左上の隅は項目ではない").toBeNull();
    expect(titleItemAt(240, 135, "main"), "画面中央（門）は項目ではない").toBeNull();
  });

  it("全行が面の中に収まる（記録の下の 6 行も）", () => {
    for (const level of ["main", "records"] as const) {
      const rects = titleItemRects(level);
      const last = rects[rects.length - 1];
      if (!last) throw new Error("行が無い");
      expect(last.y + last.h, `${level} の最下行が面の下端以内`).toBeLessThanOrEqual(TITLE_MENU_PANEL.y + TITLE_MENU_PANEL.h);
      expect(rects[0]?.y, `${level} の最上行が面の上端以降`).toBeGreaterThanOrEqual(TITLE_MENU_PANEL.y);
    }
  });

  it("行は隙間なく縦に並ぶ（なぞっても途切れない）", () => {
    const rects = titleItemRects("main");
    rects.slice(1).forEach((r, i) => {
      const prev = rects[i];
      expect(r.y, "前の行の下端から始まる").toBe((prev?.y ?? 0) + (prev?.h ?? 0));
    });
  });
});

describe("タイトルの石碑の記録", () => {
  it("深度から章の添字を引く（章 1〜4・最深の間・深みは最後の章）", () => {
    expect(titleChapterIndex(1), "地下 1 階は苔の洞").toBe(0);
    expect(titleChapterIndex(ARC.floorsPerChapter + 1), "章 2 の最初").toBe(1);
    expect(titleChapterIndex(ARC.floorsPerChapter * ARC.maxChapter), "章 4 の最後").toBe(ARC.maxChapter - 1);
    expect(titleChapterIndex(ARC.floorsPerChapter * ARC.maxChapter + 1), "最深の間").toBe(TITLE_CHAPTER_NAMES.length - 1);
    expect(titleChapterIndex(ARC.floorsPerChapter * ARC.maxChapter + 6), "深みは深みの異界のまま").toBe(ARC.maxChapter - 1);
    expect(titleChapterIndex(0), "深度 0 以下でも壊れない").toBe(0);
  });

  it("前回の終わり方: 敗北・離脱・踏破・相手不明", () => {
    expect(titleOutcomeText(entry({ cause: "abandoned" })), "離脱").toBe("離脱");
    expect(titleOutcomeText(entry({ cause: "cleared" })), "踏破").toBe("踏破");
    expect(titleOutcomeText(entry({ cause: "defeated", killer: { kind: "fall", key: "x" } })), "相手に敗北").toBe("落下物に敗北");
    expect(titleOutcomeText(entry({ cause: "defeated" })), "相手の記録が無い旧データ").toBe("力尽きた");
  });

  it("記録が無ければ前回なし、あれば最新の履歴と最深・回数", () => {
    const empty = createEmptyProfile();
    expect(computeTitleRecord(empty), "はじめての探索").toEqual({ last: null, bestDepth: 0, runs: 0 });
    const p = createEmptyProfile();
    p.meta.runs = 3;
    p.meta.bestDepth = 12;
    p.meta.history = [entry({ depth: 7, cause: "abandoned" }), entry({ depth: 12, cause: "defeated" })];
    const rec = computeTitleRecord(p);
    expect(rec.last?.depth, "先頭が前回").toBe(7);
    expect(rec.last?.chapter, "地下 7 階は章 2").toBe(1);
    expect(rec.last?.outcome, "離脱").toBe("離脱");
    expect(rec.bestDepth, "最深").toBe(12);
    expect(rec.runs, "回数").toBe(3);
  });
});

describe("タイトルの開始の演出", () => {
  it("経過に応じて 歩く → 寄る → 暗転 の順に進む", () => {
    const at = (t: number) => titleStartView({ kind: "hub", t });
    const start = at(0);
    expect(start.uiAlpha, "始めは UI が見える").toBe(1);
    expect(start.zoom, "始めは寄らない").toBe(1);
    expect(start.fade, "始めは暗くない").toBe(0);
    expect(at(0.5).walk, "歩き出している").toBeGreaterThan(0);
    expect(at(0.5).stepping, "歩く間は足が動く").toBe(true);
    expect(at(0.4).uiAlpha, "UI は早く消え始める").toBeLessThan(1);
    expect(at(1.2).zoom, "歩いた後に門へ寄る").toBeGreaterThan(1);
    expect(at(1.1).walk, "1.1 秒で石段の入口").toBeCloseTo(1, 5);
    expect(at(2.0).fade, "終わり際に暗転").toBeGreaterThan(0);
    expect(at(TITLE_START_SECONDS).fade, "最後は真っ黒").toBeCloseTo(1, 5);
    expect(at(TITLE_START_SECONDS).zoom, "最大 4.2 倍").toBeCloseTo(4.2, 5);
    expect(at(-1).zoom, "負の時刻でも崩れない").toBe(1);
  });

  it("演出が無いときは待機の見た目", () => {
    const idle = titleStartView(null);
    expect(idle.uiAlpha).toBe(1);
    expect(idle.zoom).toBe(1);
    expect(idle.fade).toBe(0);
    expect(idle.walk).toBe(0);
  });

  it("2.4 秒で終わり、決定で飛ばせる", () => {
    const s = beginTitleStart("daily");
    expect(stepTitleStart(s, 1, false), "1 秒ではまだ").toBe(false);
    expect(stepTitleStart(s, 1, false), "2 秒でもまだ").toBe(false);
    expect(stepTitleStart(s, 0.5, false), "2.5 秒で終わり").toBe(true);
    const skipped = beginTitleStart("hub");
    expect(stepTitleStart(skipped, 0.016, true), "飛ばしたら即終わり").toBe(true);
    expect(skipped.kind, "種類は保たれる").toBe("hub");
  });
});
