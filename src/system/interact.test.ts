import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState, Merchant, Ware, WareKind } from "../core/state";
import type { Vec } from "../core/vec";
import { PICKUP, ROOM_KIND } from "../data/tuning";
import { focusedInteract, pedestalVerb } from "./interact";
import { withBaseAreaMul } from "./floor";
import { dropItem } from "./loot";
import { type PropKind, type RoomProp, isInteractProp, setupSpecialRoom } from "./specialRooms";
import { arena, interactAt, pressInteract, screenOfWorld, withInput } from "./testHelpers";

/** 注目とインタラクト（system/interact.ts）: 台座は触れても使わず、照準を合わせてインタラクトで使う */

const RICH = 1_000;
/** 隣り合う台座の間隔（市の台座の間隔 2 タイルより少し詰める） */
const NEIGHBOR = 20;

/** 商人・契約者・部屋の台座・床の物を片付けた試しの場 */
function cleanArena(seed = 3): GameState {
  const state = arena(seed);
  state.economy.merchants = [];
  state.contracts.contractor = null;
  state.floorItems = [];
  state.skills.floorStones = [];
  for (const room of state.rooms) room.special = undefined;
  state.economy.coins = RICH;
  state.player.flasks = 0;
  return state;
}

function ware(kind: WareKind, pos: Vec, price = 10): Ware {
  return { kind, key: "", price, base: price, pos: { ...pos }, used: false };
}

/** プレイヤーの右に台座を並べた市（体は無い。インタラクトの経路だけ見る） */
function stall(state: GameState, wares: Ware[]): Merchant {
  const m: Merchant = { enemyId: -1, kind: "market", pos: { ...state.player.body.pos }, wares, greeted: true, provoked: false, rerolls: 0 };
  state.economy.merchants.push(m);
  return m;
}

function rightOf(state: GameState, dx: number): Vec {
  const p = state.player.body.pos;
  return { x: p.x + dx, y: p.y };
}

describe("インタラクトで台座を使う", () => {
  it("台座に触れているだけでは買わず、照準を合わせてインタラクトを押すと買う", () => {
    // 商人の体が要る（体の無い商人は updateMerchants が外す）ので、本物の市が立つ階で確かめる
    const state = withBaseAreaMul(() => createGame(3));
    const m = state.economy.merchants[0];
    const w = m?.wares.find((x) => x.kind === "key");
    if (!m || !w) throw new Error("市の鍵が無い");
    state.economy.coins = RICH;
    state.economy.keys = 0;
    state.player.body.pos = { ...w.pos };
    step(state, withInput({ aimScreen: screenOfWorld(state, w.pos) }), FIXED_DT);
    expect(w.used, "触れているだけ").toBe(false);
    expect(state.economy.keys, "鍵は増えない").toBe(0);
    pressInteract(state, w.pos);
    expect(w.used, "インタラクトで買った").toBe(true);
    expect(state.economy.keys, "鍵").toBe(1);
  });

  it("手が届かない台座は注目しても買えない", () => {
    const state = cleanArena();
    const w = ware("key", rightOf(state, PICKUP.reach + NEIGHBOR));
    stall(state, [w]);
    const focus = focusedInteract(state, w.pos);
    expect(focus?.kind, "注目はする").toBe("pedestal");
    expect(focus?.inReach, "手は届かない").toBe(false);
    pressInteract(state, w.pos);
    expect(w.used, "買えない").toBe(false);
    expect(state.economy.coins, "銭は減らない").toBe(RICH);
  });

  it("隣り合う台座は照準に近い方だけを買う", () => {
    const state = cleanArena();
    const a = ware("key", rightOf(state, NEIGHBOR));
    const b = ware("key", rightOf(state, NEIGHBOR * 2));
    stall(state, [a, b]);
    pressInteract(state, { x: b.pos.x - 1, y: b.pos.y });
    expect(b.used, "照準に近い方").toBe(true);
    expect(a.used, "もう一方は残る").toBe(false);
  });

  it("照準が無いとき（パッドで右スティック中立）は手の届く範囲で最も近い台座を使う", () => {
    const state = cleanArena();
    const near = ware("key", rightOf(state, NEIGHBOR));
    const far = ware("key", rightOf(state, NEIGHBOR * 2));
    stall(state, [far, near]);
    step(state, withInput({ interactPressed: true, aimScreen: null }), FIXED_DT);
    expect(near.used, "近い方").toBe(true);
    expect(far.used, "遠い方は残る").toBe(false);
  });

  it("部屋の台座（封印）も触れているだけでは開かず、インタラクトで開く", () => {
    const state = cleanArena();
    const room = state.rooms[1];
    if (!room) throw new Error("部屋が無い");
    room.kind = "vault";
    setupSpecialRoom(state, room);
    const seal = room.special?.props.find((p) => p.kind === "seal");
    if (!seal) throw new Error("封印が無い");
    state.economy.coins = ROOM_KIND.vaultCoinCost;
    state.player.body.pos = { ...seal.pos };
    step(state, withInput({}), FIXED_DT);
    expect(seal.used, "触れているだけ").toBe(false);
    interactAt(state, seal.pos);
    expect(seal.used, "インタラクトで開いた").toBe(true);
  });
});

describe("注目の候補と順序", () => {
  it("台座と遺物が同じ位置なら遺物を先に注目し、何度求めても同じ（決定的）", () => {
    const state = cleanArena();
    const w = ware("key", rightOf(state, NEIGHBOR));
    stall(state, [w]);
    dropItem(state, w.pos);
    const fi = state.floorItems[0];
    if (!fi) throw new Error("遺物が無い");
    fi.pos = { ...w.pos };
    const first = focusedInteract(state, w.pos);
    expect(first?.kind, "同距離は遺物が先").toBe("item");
    expect(focusedInteract(state, w.pos), "同じ結果").toEqual(first);
  });

  it("台座と遺物が近いときは照準に近い方を注目する", () => {
    const state = cleanArena();
    const w = ware("key", rightOf(state, NEIGHBOR));
    stall(state, [w]);
    dropItem(state, w.pos);
    const fi = state.floorItems[0];
    if (!fi) throw new Error("遺物が無い");
    fi.pos = { x: w.pos.x + PICKUP.focusRadius / 2, y: w.pos.y };
    expect(focusedInteract(state, { x: w.pos.x - 1, y: w.pos.y })?.kind, "台座寄り").toBe("pedestal");
    expect(focusedInteract(state, { x: fi.pos.x + 1, y: fi.pos.y })?.kind, "遺物寄り").toBe("item");
    pressInteract(state, { x: w.pos.x - 1, y: w.pos.y });
    expect(w.used, "台座を買った").toBe(true);
    expect(state.floorItems.some((f) => f.id === fi.id), "遺物は拾わない").toBe(true);
  });

  it("使い終えた品・店を広げていない旅商人の品は注目しない", () => {
    const state = cleanArena();
    const sold = ware("key", rightOf(state, NEIGHBOR));
    sold.used = true;
    stall(state, [sold]);
    expect(focusedInteract(state, sold.pos), "使い終えた品").toBeNull();
    const closed = ware("key", rightOf(state, NEIGHBOR));
    const m = stall(state, [closed]);
    m.open = false;
    expect(focusedInteract(state, closed.pos), "店を広げていない").toBeNull();
  });

  it("上り階段・地上への道（乗り続けて使う）と捕らわれ人はインタラクトの台座に入らない", () => {
    const prop = (kind: PropKind): RoomProp => ({ kind, pos: { x: 0, y: 0 }, used: false, key: "" });
    expect(isInteractProp(prop("ascend")), "上り階段").toBe(false);
    expect(isInteractProp(prop("surface")), "地上への道").toBe(false);
    expect(isInteractProp(prop("captive")), "捕らわれ人").toBe(false);
    expect(isInteractProp(prop("lever")), "賭け台").toBe(true);
    expect(isInteractProp({ ...prop("lever"), used: true }), "使い終えた台座").toBe(false);
  });

  it("キー案内の動詞: 商人の品は買う、契約者は選ぶ、レバーは使う、宝箱は開ける", () => {
    const state = cleanArena();
    const w = ware("key", rightOf(state, NEIGHBOR));
    const merchant = stall(state, [w]);
    const room = state.rooms[0];
    if (!room) throw new Error("部屋が無い");
    const prop = (kind: PropKind): RoomProp => ({ kind, pos: { x: 0, y: 0 }, used: false, key: "" });
    expect(pedestalVerb({ kind: "ware", merchant, ware: w })).toBe("buy");
    const offer = { kind: "buyItem" as const, key: "", cost: 1, pos: { x: 0, y: 0 }, used: false };
    expect(pedestalVerb({ kind: "offer", contractor: { key: "peddler", pos: { x: 0, y: 0 }, offers: [offer], greeted: true }, offer })).toBe("choose");
    expect(pedestalVerb({ kind: "prop", room, roomIndex: 0, prop: prop("lever") })).toBe("use");
    expect(pedestalVerb({ kind: "prop", room, roomIndex: 0, prop: prop("lockedChest") })).toBe("open");
    expect(pedestalVerb({ kind: "prop", room, roomIndex: 0, prop: prop("keystone") })).toBe("choose");
  });
});
