import { describe, expect, it } from "vitest";
// system の循環参照は core/game を先に読むと解ける（runEvents を単独で読むと落ちる）。他の system のテストと同じ順にする
import "../core/game";
import { FLOOR_KINDS } from "../system/biomes";
import { mutationsFor } from "../system/runEvents";
import { DEEP, TELEGRAPH } from "../data/tuning";
import { PIT_COLORS } from "../data/mapThemes";
import { deepFloorOf } from "../system/chapters";
import {
  colorB,
  colorG,
  colorMutationsFor,
  colorR,
  derivePalette,
  hexColor,
  lighten,
  mapThemeFor,
  mixColor,
  packColors,
  packedPitColors,
  rotateHue,
  styleFor,
} from "./mapTheme";
import { STYLE_DEFS } from "../data/mapThemes";
import type { MapPalette, MapTheme } from "./mapTypes";

const DEPTHS = Array.from({ length: 25 }, (_, i) => i + 1);

/** 予告の色（黄 / 赤）と、描画側の定数の赤 */
const TELEGRAPH_COLORS = [TELEGRAPH.readyColor, TELEGRAPH.commitColor, "#ff4040"];
/** 地図の面として広く出る色（床・天面・側面・奈落）。差し色（accent）や光源の色は点・線にしか出ないので含めない */
const SURFACE_KEYS: readonly (keyof MapPalette)[] = ["fD", "fB", "fL", "fH", "fO", "tB", "tD", "tL", "sB", "sL", "sD", "v1", "v2", "vD"];
const RGB_DISTANCE_MIN = 60;

function distance(a: number, b: number): number {
  return Math.hypot(colorR(a) - colorR(b), colorG(a) - colorG(b), colorB(a) - colorB(b));
}

describe("mapTheme: テーマの決定", () => {
  it("深度 1〜25 × 9 バイオームのすべてでテーマが決まり、key が空でなく全色が不透明", () => {
    for (const depth of DEPTHS) {
      for (const kind of FLOOR_KINDS) {
        const theme = mapThemeFor(depth, kind);
        expect(theme.key.length, `深度 ${depth} ${kind} の key`).toBeGreaterThan(0);
        for (const [name, color] of Object.entries(theme.palette)) {
          expect(Number.isInteger(color) && color >>> 24 === 255, `深度 ${depth} ${kind} の ${name}`).toBe(true);
        }
        expect(theme.props.length, `深度 ${depth} ${kind} の置物`).toBeGreaterThan(0);
        expect(theme.dark, `深度 ${depth} ${kind} の暗さ`).toBeGreaterThan(0);
      }
    }
  });

  it("同じ引数なら同じテーマ（参照も同じ）を返す", () => {
    expect(mapThemeFor(8, "mine")).toBe(mapThemeFor(8, "mine"));
    expect(mapThemeFor(8, "mine"), "章が同じでもバイオームが違えば別").not.toBe(mapThemeFor(8, "rooms"));
  });

  it("章の様式: 1〜5 は苔・6〜10 は寺院・11〜15 は廃城・16〜20 は異界・21 は最深・22 以降は異界", () => {
    expect(styleFor(1, "cave")).toBe("moss");
    expect(styleFor(5, "cave")).toBe("moss");
    expect(styleFor(6, "cave")).toBe("temple");
    expect(styleFor(10, "cave")).toBe("temple");
    expect(styleFor(11, "forge")).toBe("castleFire");
    expect(styleFor(15, "glacier")).toBe("castleFrost");
    expect(styleFor(16, "cave")).toBe("deep");
    expect(styleFor(20, "cave")).toBe("deep");
    expect(styleFor(21, "cave")).toBe("final");
    expect(styleFor(22, "cave")).toBe("deep");
    expect(styleFor(40, "forge")).toBe("deep");
  });

  it("章 3 の炎 / 霜はバイオームで分かれる（洞窟・沼・氷窟・草原は霜、ほかは炎）", () => {
    const frost = new Set(["cave", "swamp", "glacier", "meadow"]);
    for (const kind of FLOOR_KINDS) {
      expect(styleFor(12, kind), `${kind}`).toBe(frost.has(kind) ? "castleFrost" : "castleFire");
    }
  });

  it("側面の高さは章 1 が 16、章 2・3 が 32、異界・最深の間が 24", () => {
    expect(mapThemeFor(3, "cave").sideH).toBe(16);
    expect(mapThemeFor(8, "cave").sideH).toBe(32);
    expect(mapThemeFor(13, "cave").sideH).toBe(32);
    expect(mapThemeFor(18, "cave").sideH).toBe(24);
    expect(mapThemeFor(21, "cave").sideH).toBe(24);
    expect(mapThemeFor(30, "cave").sideH).toBe(24);
  });

  it("暗さは章 1 < 2 < 3 < 4", () => {
    const dark = (depth: number): number => mapThemeFor(depth, "cave").dark;
    expect(dark(1)).toBeLessThan(dark(6));
    expect(dark(6)).toBeLessThan(dark(11));
    expect(dark(11)).toBeLessThan(dark(16));
    expect(dark(21), "最深の間は章 4 より明るい").toBeLessThan(dark(16));
  });

  it("岩盤の奥を奈落に描くのは章 4 と深みだけ。穴は章 4・深みが奈落でほかはバイオームの対応", () => {
    for (const depth of DEPTHS.concat([22, 30])) {
      const theme = mapThemeFor(depth, "cave");
      const deep = theme.style === "deep";
      expect(theme.voidBeyond, `深度 ${depth}`).toBe(deep);
      expect(theme.pit === "abyss", `深度 ${depth} の穴`).toBe(deep);
    }
    expect(mapThemeFor(3, "forge").pit).toBe("lava");
    expect(mapThemeFor(3, "glacier").pit).toBe("ice");
    expect(mapThemeFor(3, "mine").pit).toBe("oil");
    expect(mapThemeFor(3, "dark").pit).toBe("ink");
    expect(mapThemeFor(3, "swamp").pit).toBe("water");
    expect(mapThemeFor(21, "forge").pit, "最深の間はバイオームの穴").toBe("lava");
  });

  it("角は洞窟が丸め 16・人工物が面取り 12、縁の揺らぎは洞窟 3・人工物 0", () => {
    const moss = mapThemeFor(3, "cave");
    expect([moss.corner, moss.cornerR, moss.edgeNoise]).toEqual(["round", 16, 3]);
    const temple = mapThemeFor(8, "cave");
    expect([temple.corner, temple.cornerR, temple.edgeNoise]).toEqual(["chamfer", 12, 0]);
    expect(mapThemeFor(21, "cave").edgeNoise).toBe(1);
  });
});

describe("mapTheme: バイオームの寄せ", () => {
  it("熔鉱炉は床が赤みへ、氷窟は青みへ、暗闇は暗くなる", () => {
    const base = mapThemeFor(3, "cave").palette.fB;
    const forge = mapThemeFor(3, "forge").palette.fB;
    const glacier = mapThemeFor(3, "glacier").palette.fB;
    expect(colorR(forge), "熔鉱炉の赤").toBeGreaterThan(colorR(base));
    expect(colorB(glacier), "氷窟の青").toBeGreaterThan(colorB(base));
    const dark = mapThemeFor(3, "dark").palette;
    expect(colorR(dark.fB) + colorG(dark.fB) + colorB(dark.fB), "暗闇は床が暗い").toBeLessThan(colorR(base) + colorG(base) + colorB(base));
  });

  it("バイオームの印: 熔鉱炉は煤、氷窟は霜、坑道は梁、草原は章 1 だけ光の柱", () => {
    expect(mapThemeFor(3, "forge").flags.soot).toBe(true);
    expect(mapThemeFor(3, "glacier").flags.frost).toBe(true);
    expect(mapThemeFor(3, "mine").flags.beams).toBe(true);
    expect(mapThemeFor(3, "meadow").flags.shafts).toBe(true);
    expect(mapThemeFor(8, "meadow").flags.shafts, "章 2 の草原").toBe(false);
    expect(mapThemeFor(3, "cave").flags.soot).toBe(false);
  });

  it("暗闇は光る置物の重みが半分になる", () => {
    const weight = (kind: string, theme: MapTheme): number => theme.props.find((p) => p.kind === kind)?.weight ?? 0;
    expect(weight("mush", mapThemeFor(3, "dark"))).toBeCloseTo(weight("mush", mapThemeFor(3, "cave")) * 0.5, 5);
    expect(weight("skull", mapThemeFor(3, "dark")), "光らない置物は変わらない").toBe(weight("skull", mapThemeFor(3, "cave")));
  });

  it("回廊の章 1 は石畳の地帯が広がり、沼は苔の地帯が広がる", () => {
    const rooms = mapThemeFor(3, "rooms").floorZone;
    const cave = mapThemeFor(3, "cave").floorZone;
    expect(cave, "洞窟は既定").toBeUndefined();
    expect(rooms?.stone ?? 1, "石畳の地帯（土の閾値が小さい）").toBeLessThan(0.42);
    expect(mapThemeFor(3, "swamp").floorZone?.moss ?? 1, "苔の斑の閾値が小さい").toBeLessThan(0.64);
  });

  it("回廊の章 2 は朱の柱が増え、骨の墓所の章 2 は骨壺が 3", () => {
    const weight = (kind: string, theme: MapTheme): number => theme.props.find((p) => p.kind === kind)?.weight ?? 0;
    expect(weight("pillar", mapThemeFor(8, "rooms"))).toBeGreaterThan(weight("pillar", mapThemeFor(8, "cave")));
    expect(weight("urn", mapThemeFor(8, "ossuary"))).toBe(3);
  });

  it("骨の墓所は骨の汚しが増える。最深の間は汚しを足さない", () => {
    const bones = (theme: MapTheme): number => theme.decals.filter((d) => d === "bones").length;
    expect(bones(mapThemeFor(8, "ossuary"))).toBeGreaterThan(bones(mapThemeFor(8, "cave")));
    expect(mapThemeFor(21, "ossuary").decals, "最深の間").toEqual([]);
  });
});

describe("mapTheme: 深みの変異", () => {
  const FIRST_DEEP = 22;

  it("colorMutationsFor は runEvents.mutationsFor（積む順・個数）と同じ", () => {
    for (let depth = 1; depth <= 80; depth++) {
      expect(colorMutationsFor(depth), `深度 ${depth}`).toEqual(mutationsFor(depth));
    }
  });

  it("深みの 1 層目は血の月の配色で、章 4（深度 16〜20）の配色と変わる", () => {
    const deep = mapThemeFor(18, "cave");
    const blood = mapThemeFor(FIRST_DEEP, "cave");
    expect(blood.key, "key が別").not.toBe(deep.key);
    expect(blood.palette.fB, "床の色").not.toBe(deep.palette.fB);
    expect(colorR(blood.palette.tB), "血の月は赤み").toBeGreaterThan(colorR(deep.palette.tB));
  });

  it("霧が積まれる層（変異 2 つ）は暗さが増え、色が灰色へ寄る", () => {
    const one = mapThemeFor(FIRST_DEEP, "cave");
    const two = mapThemeFor(FIRST_DEEP + DEEP.mutationEvery, "cave");
    expect(two.key).not.toBe(one.key);
    expect(two.dark, "霧の分だけ暗い").toBeGreaterThan(one.dark);
    const spread = (c: number): number => Math.max(colorR(c), colorG(c), colorB(c)) - Math.min(colorR(c), colorG(c), colorB(c));
    expect(spread(two.palette.light), "霧で光の色が灰色へ寄る").toBeLessThan(spread(one.palette.light));
  });

  it("属性の嵐が積まれる層は色相が層ごとに回り、深度で決まる（決定的）", () => {
    const stormStart = FIRST_DEEP + DEEP.mutationEvery * 2;
    const a = mapThemeFor(stormStart, "cave");
    const b = mapThemeFor(stormStart + 1, "cave");
    expect(a.key, "層が変われば key も変わる").not.toBe(b.key);
    expect(a.palette.fB, "色相が回る").not.toBe(b.palette.fB);
    expect(mapThemeFor(stormStart, "cave"), "同じ深度は同じテーマ").toBe(a);
    expect(deepFloorOf(stormStart)).toBeGreaterThan(0);
  });

  it("章 4 までの深度には変異が掛からない", () => {
    for (let depth = 1; depth <= 21; depth++) expect(colorMutationsFor(depth), `深度 ${depth}`).toEqual([]);
  });
});

describe("mapTheme: 予告の色との距離", () => {
  const targets = TELEGRAPH_COLORS.map(hexColor);

  it("すべてのテーマの地図の面の色が、予告の色（黄 / 赤 / #ff4040）と RGB 距離 60 以上離れている", () => {
    const shown = new Set<string>();
    for (const depth of DEPTHS.concat([22, 27, 32, 33, 40])) {
      for (const kind of FLOOR_KINDS) {
        const theme = mapThemeFor(depth, kind);
        if (shown.has(theme.key)) continue;
        shown.add(theme.key);
        for (const key of SURFACE_KEYS) {
          const color = theme.palette[key];
          for (const [i, target] of targets.entries()) {
            expect(distance(color, target), `${theme.key} の ${key} と ${TELEGRAPH_COLORS[i]}`).toBeGreaterThanOrEqual(RGB_DISTANCE_MIN);
          }
        }
      }
    }
    expect(shown.size, "調べたテーマの数").toBeGreaterThan(30);
  });

  it("穴の本体の色（割れ目の rip を除く）も予告の色と離れている", () => {
    for (const pit of Object.keys(PIT_COLORS) as (keyof typeof PIT_COLORS)[]) {
      const colors = packedPitColors(pit);
      expect(colors, pit).not.toBeNull();
      if (!colors) continue;
      for (const key of ["a", "deep", "foam", "bank", "mid"] as const) {
        for (const [i, target] of targets.entries()) {
          expect(distance(colors[key], target), `${pit} の ${key} と ${TELEGRAPH_COLORS[i]}`).toBeGreaterThanOrEqual(RGB_DISTANCE_MIN);
        }
      }
    }
  });
});

describe("mapTheme: 色の計算", () => {
  it("hexColor は ABGR に詰め、mixColor は端で元の色・中間で平均になる", () => {
    const red = hexColor("#ff0000");
    const blue = hexColor("#0000ff");
    expect([colorR(red), colorG(red), colorB(red)]).toEqual([255, 0, 0]);
    expect(mixColor(red, blue, 0)).toBe(red);
    expect(mixColor(red, blue, 1)).toBe(blue);
    const mid = mixColor(red, blue, 0.5);
    expect(Math.abs(colorR(mid) - 128), "赤").toBeLessThanOrEqual(1);
    expect(Math.abs(colorB(mid) - 128), "青").toBeLessThanOrEqual(1);
    expect(mid >>> 24, "不透明").toBe(255);
  });

  it("derivePalette の派生色: 天面の明は基本より明るく、床の暗がりは床の暗より暗い", () => {
    const palette = derivePalette(packColors(STYLE_DEFS.moss.colors));
    const sum = (c: number): number => colorR(c) + colorG(c) + colorB(c);
    expect(sum(palette.tL)).toBeGreaterThan(sum(palette.tB));
    expect(sum(palette.tD)).toBeLessThan(sum(palette.tB));
    expect(sum(palette.fO)).toBeLessThan(sum(palette.fD));
    expect(sum(palette.vD)).toBeLessThan(sum(palette.sB));
    expect(palette.fH).toBe(lighten(palette.fL, 0.07));
  });

  it("rotateHue: 0 度・360 度で元の色、灰色は変わらず、赤を 120 度回すと緑になる", () => {
    const c = hexColor("#b0342c");
    expect(rotateHue(c, 0)).toBe(c);
    expect(rotateHue(c, 360)).toBe(c);
    const grey = hexColor("#808080");
    expect(rotateHue(grey, 77)).toBe(grey);
    const green = rotateHue(hexColor("#ff0000"), 120);
    expect(colorG(green), "緑が最大").toBeGreaterThan(colorR(green));
    expect(colorG(green)).toBeGreaterThan(colorB(green));
  });
});
