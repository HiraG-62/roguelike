import { describe, expect, it } from "vitest";
import { NARIMONO } from "../data/tuning";
import { addMark } from "../system/effects";
import { arena, placeEnemy } from "../system/testHelpers";
import { NARIMONO_TABLE, Narimono } from "./narimono";
import { SFX_NAMES } from "./sfxNames";

describe("鳴物帳の表", () => {
  it("名前は音の名として実在し、重複せず、1 つの家に意味は 1 つ", () => {
    const names = NARIMONO_TABLE.map((x) => x.name);
    expect(new Set(names).size, "名前の重複").toBe(names.length);
    for (const n of names) expect((SFX_NAMES as readonly string[]).includes(n), n).toBe(true);
    const meaningOfHouse = new Map<string, string>();
    for (const x of NARIMONO_TABLE) {
      const had = meaningOfHouse.get(x.house);
      expect(had === undefined || had === x.meaning, `${x.house} に意味が 2 つ`).toBe(true);
      meaningOfHouse.set(x.house, x.meaning);
    }
    const houseOfMeaning = new Map<string, string>();
    for (const x of NARIMONO_TABLE) {
      const had = houseOfMeaning.get(x.meaning);
      expect(had === undefined || had === x.house, `${x.meaning} が 2 つの家に`).toBe(true);
      houseOfMeaning.set(x.meaning, x.house);
    }
  });
});

describe("受け流しの附打", () => {
  it("新しい受け流しの印があるときだけ counter を附打へ替える（出端の counter は残す）", () => {
    const state = arena();
    const n = new Narimono();
    expect(n.arrange(state, ["counter"]), "印が無ければ出端の音のまま").toEqual(["counter"]);
    addMark(state, "parry", state.player.body.pos, 0.3, "#fff");
    expect(n.arrange(state, ["counter", "hit"])).toEqual(["tsukeHeavy", "hit"]);
    expect(n.arrange(state, ["counter"]), "同じ印を 2 回は使わない").toEqual(["counter"]);
  });

  it("附打は tsukeGapSec 以内に重ねない", () => {
    const state = arena();
    const n = new Narimono();
    addMark(state, "parry", state.player.body.pos, 0.3, "#fff");
    expect(n.arrange(state, ["counter"])).toEqual(["tsukeHeavy"]);
    addMark(state, "parry", state.player.body.pos, 0.3, "#fff");
    state.time += NARIMONO.tsukeGapSec * 0.5;
    expect(n.arrange(state, ["counter"]), "間隔内").toEqual([]);
    addMark(state, "parry", state.player.body.pos, 0.3, "#fff");
    state.time += NARIMONO.tsukeGapSec;
    expect(n.arrange(state, ["counter"]), "間隔を空けた").toEqual(["tsukeHeavy"]);
  });
});

describe("予備動作の唸り enemyWindup", () => {
  function startWindup(state: ReturnType<typeof arena>, key: string, elite = false) {
    const e = placeEnemy(state, key, 100);
    e.phase = "windup";
    e.windupAt = state.time;
    if (elite) e.elite = "hasted";
    return e;
  }

  it("並の敵が予備動作に入ったフレームの唸りは止める", () => {
    const state = arena();
    startWindup(state, "slime");
    expect(new Narimono().arrange(state, ["enemyWindup", "hit"])).toEqual(["hit"]);
  });

  it("精鋭が予備動作に入ったフレームの唸りは残す", () => {
    const state = arena();
    startWindup(state, "slime", true);
    expect(new Narimono().arrange(state, ["enemyWindup"])).toEqual(["enemyWindup"]);
  });

  it("新しい予備動作が無いフレームの唸り（ボスの技・鐘など他の積み元）はそのまま", () => {
    const state = arena();
    const e = startWindup(state, "slime");
    const n = new Narimono();
    n.arrange(state, []);
    state.time += 1;
    expect(e.phase).toBe("windup");
    expect(n.arrange(state, ["enemyWindup"])).toEqual(["enemyWindup"]);
  });
});

describe("柝頭", () => {
  function redLaser(state: ReturnType<typeof arena>, dx: number) {
    const e = placeEnemy(state, "laserEye", dx);
    e.phase = "windup";
    e.windupTotal = 1;
    e.phaseTimer = 0.4;
    e.windupAt = state.time - 0.3;
    e.committedAt = -1;
    if (e.ai) e.ai.target = { ...state.player.body.pos };
    return e;
  }

  it("自分に掛かる攻撃が赤に入った瞬間に 1 回だけ鳴り、敵の側へ振る", () => {
    const state = arena();
    const e = redLaser(state, 150);
    const n = new Narimono();
    expect(n.clack(state), "黄の間").toBeNull();
    e.committedAt = state.time;
    const c = n.clack(state);
    expect(c, "赤の立ち上がり").not.toBeNull();
    expect(c?.pan, "敵は右").toBeGreaterThan(0);
    expect(c?.volume).toBe(NARIMONO.clackVolume);
    expect(n.clack(state), "赤のままなら鳴らさない").toBeNull();
  });

  it("左の敵は左へ振る", () => {
    const state = arena();
    const e = redLaser(state, -150);
    const n = new Narimono();
    n.clack(state);
    e.committedAt = state.time;
    expect(n.clack(state)?.pan).toBeLessThan(0);
  });

  it("自分に掛からない赤・遠すぎる敵の赤は鳴らさない", () => {
    const state = arena();
    const away = redLaser(state, 150);
    if (away.ai) away.ai.target = { x: away.body.pos.x + 80, y: away.body.pos.y + 30 };
    const n = new Narimono();
    n.clack(state);
    away.committedAt = state.time;
    expect(n.clack(state), "掛からない").toBeNull();

    const state2 = arena();
    const far = redLaser(state2, NARIMONO.clackMaxDist + 60);
    const n2 = new Narimono();
    n2.clack(state2);
    far.committedAt = state2.time;
    expect(n2.clack(state2), "遠い").toBeNull();
  });

  it("同時に赤に入った敵のうち一番早く当たる 1 体だけ、clackGapSec 内は重ねない", () => {
    const state = arena();
    const slow = redLaser(state, 150);
    const fast = redLaser(state, -150);
    slow.phaseTimer = 0.5;
    fast.phaseTimer = 0.2;
    const n = new Narimono();
    n.clack(state);
    slow.committedAt = state.time;
    fast.committedAt = state.time;
    const c = n.clack(state);
    expect(c?.pan, "早く当たる左の敵").toBeLessThan(0);
    const third = redLaser(state, 120);
    n.clack(state);
    third.committedAt = state.time;
    expect(n.clack(state), "間隔内").toBeNull();
  });
});
