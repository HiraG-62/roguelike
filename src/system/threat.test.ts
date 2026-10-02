import { describe, expect, it } from "vitest";
import { enemyDef } from "../data/enemies";
import { THREAT_CUE } from "../data/tuning";
import { enemyTelegraph } from "./enemies";
import { arena, placeEnemy } from "./testHelpers";
import { threatShapes, threatensPlayer } from "./threat";

function windup(key: string, dx: number, dy = 0, aim = { x: -1, y: 0 }) {
  const state = arena();
  const e = placeEnemy(state, key, dx, dy);
  e.phase = "windup";
  e.windupTotal = 1;
  e.phaseTimer = 0.4;
  e.strikeDir = aim;
  return { state, e };
}

describe("敵の攻撃の形", () => {
  it("予備動作の突進の敵は、体から狙いの向きへ線を 1 本持ち、先に止めを置く", () => {
    const { state, e } = windup("boar", 100);
    const shapes = threatShapes(state, e);
    expect(shapes?.strokes.length).toBe(1);
    const s = shapes?.strokes[0];
    expect(s?.stop).toBe(true);
    expect(s?.seg.x0).toBeCloseTo(e.body.pos.x, 5);
    expect(s?.seg.x1, "自分の方（x の小さい側）へ").toBeLessThan(e.body.pos.x);
  });

  it("待機中・倒れた敵・隠れた敵は形を持たない", () => {
    const { state, e } = windup("boar", 100);
    e.phase = "idle";
    expect(threatShapes(state, e)).toBeNull();
    e.phase = "windup";
    e.hidden = true;
    expect(threatShapes(state, e)).toBeNull();
    e.hidden = false;
    e.hp = 0;
    expect(threatShapes(state, e)).toBeNull();
  });
});

describe("自分に掛かるか", () => {
  it("狙いを予備動作の終わりで更新する突進は自分へ向かうので掛かる", () => {
    const { state, e } = windup("boar", 100);
    expect(threatensPlayer(state, e)).toBe(true);
  });

  it("光線は、目標までの線が自分を通るなら掛かり、目標が自分から離れていれば掛からない", () => {
    const { state, e } = windup("laserEye", 100);
    if (!e.ai) throw new Error("光線の敵は ai を持つはず");
    const p = state.player.body.pos;
    e.ai.target = { x: p.x, y: p.y };
    expect(threatensPlayer(state, e), "目標が自分").toBe(true);
    e.ai.target = { x: e.body.pos.x + 80, y: e.body.pos.y + 20 };
    expect(threatensPlayer(state, e), "目標が反対側").toBe(false);
  });

  it("輪の叩きつけは、自分が半径の内側なら掛かり、外側なら掛からない", () => {
    const { state, e } = windup("golem", 0);
    const tele = enemyTelegraph(e, enemyDef("golem"));
    expect(tele?.kind).toBe("ring");
    const radius = tele?.kind === "ring" ? tele.radius : 0;
    e.body.pos = { x: state.player.body.pos.x + radius - 2, y: state.player.body.pos.y };
    expect(threatensPlayer(state, e), "半径の内側").toBe(true);
    e.body.pos = { x: state.player.body.pos.x + radius + state.player.body.radius + THREAT_CUE.hitPad + 10, y: state.player.body.pos.y };
    expect(threatensPlayer(state, e), "半径の外側").toBe(false);
  });

  it("扇は向きが自分へ向いていれば掛かり、背を向けていれば掛からない", () => {
    const facing = windup("windSprite", 30, 0, { x: -1, y: 0 });
    expect(threatensPlayer(facing.state, facing.e), "自分へ向く").toBe(true);
    const back = windup("windSprite", 30, 0, { x: 1, y: 0 });
    expect(threatensPlayer(back.state, back.e), "背を向ける").toBe(false);
  });

  it("線も範囲も持たない敵は、狙いの向きが自分へ寄っているときだけ掛かる", () => {
    const { state, e } = windup("eye", 150, 0, { x: -1, y: 0 });
    expect(threatShapes(state, e)?.strokes.length, "形が無い敵のはず").toBe(0);
    expect(threatShapes(state, e)?.areas.length).toBe(0);
    expect(threatensPlayer(state, e), "狙いが自分").toBe(true);
    e.strikeDir = { x: 0, y: -1 };
    expect(threatensPlayer(state, e), "狙いが逸れる").toBe(false);
  });

  it("決定的: 状態を書き換えず、同じ状態なら同じ答え", () => {
    const { state, e } = windup("boar", 100);
    const before = JSON.stringify({ pos: e.body.pos, dir: e.strikeDir, hp: state.player.hp });
    const a = threatensPlayer(state, e);
    expect(threatensPlayer(state, e)).toBe(a);
    expect(JSON.stringify({ pos: e.body.pos, dir: e.strikeDir, hp: state.player.hp })).toBe(before);
  });
});
