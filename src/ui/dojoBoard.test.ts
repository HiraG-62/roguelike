import { describe, expect, it } from "vitest";
import { DOJO_ROWS, defaultDojoConfig, dojoRowRespawns, type DojoRowKey } from "../system/dojoConfig";
import {
  type DojoBoardInput,
  createDojoBoardUi,
  dojoArrowRect,
  dojoBoardRowGap,
  dojoBoardVisibleRows,
  dojoRowRect,
  stepDojoBoard,
} from "./dojoBoard";

const IDLE: DojoBoardInput = { navX: 0, navY: 0, wheel: 0, aim: null, aimMoved: false, click: false, confirm: false };
const input = (p: Partial<DojoBoardInput>): DojoBoardInput => ({ ...IDLE, ...p });
const GAP = dojoBoardRowGap(0);
const indexOf = (key: DojoRowKey): number => DOJO_ROWS.indexOf(key);

describe("稽古帳: 行の移動", () => {
  it("↓ で行が進み、↑ で戻り、端で止まる", () => {
    const ui = createDojoBoardUi();
    const cfg = defaultDojoConfig();
    expect(stepDojoBoard(ui, cfg, input({ navY: -1 }), GAP).kind, "先頭から ↑ は動かない").toBe("none");
    expect(stepDojoBoard(ui, cfg, input({ navY: 1 }), GAP).kind).toBe("moved");
    expect(ui.cursor).toBe(1);
    ui.cursor = DOJO_ROWS.length - 1;
    expect(stepDojoBoard(ui, cfg, input({ navY: 1 }), GAP).kind, "末尾から ↓ は動かない").toBe("none");
    expect(ui.cursor).toBe(DOJO_ROWS.length - 1);
  });
});

describe("稽古帳: 値の変更", () => {
  it("値の行で → すると値が変わり、respawn は dojoRowRespawns と一致する", () => {
    for (const key of ["count", "behavior", "undying"] as const) {
      const ui = createDojoBoardUi();
      ui.cursor = indexOf(key);
      const cfg = defaultDojoConfig();
      const a = stepDojoBoard(ui, cfg, input({ navX: 1 }), GAP);
      expect(a.kind, key).toBe("change");
      if (a.kind !== "change") continue;
      expect(a.config[key], `${key} が変わる`).not.toBe(cfg[key]);
      expect(a.respawn, `${key} の湧き直し`).toBe(dojoRowRespawns(key));
    }
  });

  it("← は逆向きに巡回する", () => {
    const ui = createDojoBoardUi();
    ui.cursor = indexOf("count");
    const cfg = defaultDojoConfig();
    const fwd = stepDojoBoard(ui, cfg, input({ navX: 1 }), GAP);
    const back = stepDojoBoard(ui, cfg, input({ navX: -1 }), GAP);
    expect(fwd.kind === "change" && back.kind === "change" && fwd.config.count !== back.config.count).toBe(true);
  });

  it("値の行で決定は +1 巡回、元の設定は書き換えない", () => {
    const ui = createDojoBoardUi();
    ui.cursor = indexOf("undying");
    const cfg = defaultDojoConfig();
    const before = cfg.undying;
    const a = stepDojoBoard(ui, cfg, input({ confirm: true }), GAP);
    expect(a.kind === "change" && a.config.undying === !before).toBe(true);
    expect(cfg.undying, "元は不変").toBe(before);
  });
});

describe("稽古帳: 動作の行", () => {
  it("動作の行の決定で action、← → は何もしない", () => {
    const ui = createDojoBoardUi();
    ui.cursor = indexOf("resetMeter");
    const cfg = defaultDojoConfig();
    expect(stepDojoBoard(ui, cfg, input({ confirm: true }), GAP)).toEqual({ kind: "action", row: "resetMeter" });
    expect(stepDojoBoard(ui, cfg, input({ navX: 1 }), GAP).kind).toBe("none");
  });
});

describe("稽古帳: マウス", () => {
  it("ホバーは動いたときだけ行を選ぶ", () => {
    const ui = createDojoBoardUi();
    const r = dojoRowRect(3, 0, GAP);
    expect(r).not.toBeNull();
    const aim = { x: (r?.x ?? 0) + 5, y: (r?.y ?? 0) + 2 };
    expect(stepDojoBoard(ui, defaultDojoConfig(), input({ aim }), GAP).kind, "動いていない").toBe("none");
    expect(stepDojoBoard(ui, defaultDojoConfig(), input({ aim, aimMoved: true }), GAP).kind).toBe("moved");
    expect(ui.cursor).toBe(3);
  });

  it("矢印のクリックは ±1、行のほかのクリックは +1、動作の行のクリックは action", () => {
    const cfg = defaultDojoConfig();
    const idx = indexOf("count");
    const center = (r: { x: number; y: number; w: number; h: number } | null): { x: number; y: number } => ({ x: (r?.x ?? 0) + (r?.w ?? 0) / 2, y: (r?.y ?? 0) + (r?.h ?? 0) / 2 });
    const plus = stepDojoBoard(createDojoBoardUi(), cfg, input({ click: true, aim: center(dojoArrowRect(idx, 0, 1, GAP)) }), GAP);
    const minus = stepDojoBoard(createDojoBoardUi(), cfg, input({ click: true, aim: center(dojoArrowRect(idx, 0, -1, GAP)) }), GAP);
    const body = stepDojoBoard(createDojoBoardUi(), cfg, input({ click: true, aim: { x: (dojoRowRect(idx, 0, GAP)?.x ?? 0) + 2, y: (dojoRowRect(idx, 0, GAP)?.y ?? 0) + 2 } }), GAP);
    expect(plus.kind === "change" && minus.kind === "change" && body.kind === "change").toBe(true);
    if (plus.kind !== "change" || minus.kind !== "change" || body.kind !== "change") return;
    expect(plus.config.count, "右矢印").not.toBe(minus.config.count);
    expect(body.config.count, "本体は +1").toBe(plus.config.count);
    const ui = createDojoBoardUi();
    const act = stepDojoBoard(ui, cfg, input({ click: true, aim: center(dojoRowRect(indexOf("restore"), 0, GAP)) }), GAP);
    expect(act).toEqual({ kind: "action", row: "restore" });
    expect(ui.cursor).toBe(indexOf("restore"));
  });
});

describe("稽古帳: 行の間隔とスクロール", () => {
  it("行の間隔は字の行高が大きければそれに従う", () => {
    expect(dojoBoardRowGap(0)).toBeGreaterThan(0);
    expect(dojoBoardRowGap(30)).toBe(30);
  });

  it("行が収まらないときはカーソルに追随して表示が送られる", () => {
    const gap = 30;
    const visible = dojoBoardVisibleRows(gap);
    expect(visible, "全行は収まらない").toBeLessThan(DOJO_ROWS.length);
    const ui = createDojoBoardUi();
    const cfg = defaultDojoConfig();
    for (let i = 0; i < visible; i++) stepDojoBoard(ui, cfg, input({ navY: 1 }), gap);
    expect(ui.scroll).toBe(1);
    expect(dojoRowRect(ui.cursor, ui.scroll, gap), "カーソルの行は見える").not.toBeNull();
  });
});
