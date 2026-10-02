import { describe, expect, it } from "vitest";
import { fid, fidArgs, hitAt, nearestInDirection } from "./menuFocus";
import type { MenuHit } from "./menuState";

function hit(id: string, x: number, y: number, nav = true): MenuHit {
  return { id, rect: { x, y, w: 10, h: 10 }, act: null, hold: null, nav };
}

/** 中央・右に 2 つ（近いが斜め / 遠いがまっすぐ）・下 */
const HITS: MenuHit[] = [hit("center", 100, 100), hit("rightDiag", 130, 130), hit("rightFar", 150, 100), hit("down", 100, 160)];

describe("装備画面の焦点", () => {
  it("右へ押すと右側でいちばん近い当たりへ移る", () => {
    expect(nearestInDirection(HITS, "center", 1, 0), "まっすぐ先を斜めより優先").toBe("rightFar");
    expect(nearestInDirection(HITS, "center", 0, 1), "下").toBe("down");
    expect(nearestInDirection(HITS, "rightFar", -1, 0), "左へ戻る").toBe("center");
  });

  it("その向きに当たりが無ければ動かない", () => {
    expect(nearestInDirection(HITS, "center", 0, -1), "上には何も無い").toBeNull();
    expect(nearestInDirection(HITS, "center", -1, 0), "左には何も無い").toBeNull();
  });

  it("焦点が当たりに無ければ先頭の当たりにする", () => {
    expect(nearestInDirection(HITS, null, 1, 0), "焦点なし").toBe("center");
    expect(nearestInDirection(HITS, "gone", 0, 1), "消えた焦点").toBe("center");
    expect(nearestInDirection([], null, 1, 0), "当たりが無ければ null").toBeNull();
  });

  it("nav が false の当たりには止まらない", () => {
    const hits = [hit("face", 8, 3, false), ...HITS, hit("chipRight", 112, 100, false)];
    expect(nearestInDirection(hits, null, 1, 0), "先頭の nav でない当たりを飛ばす").toBe("center");
    expect(nearestInDirection(hits, "center", 1, 0), "すぐ右の面の札を飛ばす").toBe("rightFar");
    expect(hitAt(hits, { x: 9, y: 4 })?.id, "マウスの当たりには入る").toBe("face");
  });

  it("出どころの key に区切りが入っていても最後の欄にまとめて読める", () => {
    const id = fid.bead("burn", "produces", "relic|mainHand|a:b");
    expect(fidArgs(id, "bead", 3), "最後の欄に残りをまとめる").toEqual(["burn", "produces", "relic|mainHand|a:b"]);
    expect(fidArgs(id, "part"), "頭が違えば null").toBeNull();
  });
});
