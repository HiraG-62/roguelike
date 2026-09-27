import { describe, expect, it } from "vitest";
import {
  constName,
  editRequest,
  frameLiteral,
  generateRequest,
  parseServerMessage,
  quantizeToRows,
  rowsToRgba,
  type RgbaImage,
} from "./spriteGenCore";

const PALETTE = { k: "#000000", r: "#ff0000", w: "#ffffff" };

function image(width: number, height: number, pixels: readonly (readonly [number, number, number, number])[]): RgbaImage {
  return { width, height, rgba: new Uint8Array(pixels.flat()) };
}

describe("quantizeToRows", () => {
  it("PALETTE の色は文字に、α が低い画素は透明にする", () => {
    const img = image(3, 1, [
      [0, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 255, 255, 10],
    ]);
    expect(quantizeToRows(img, PALETTE)).toEqual({ rows: ["kr."], offPalette: 0 });
  });

  it("PALETTE に無い色は最も近い色に丸め、その画素数を数える", () => {
    const img = image(2, 1, [
      [240, 20, 10, 255],
      [250, 250, 245, 255],
    ]);
    expect(quantizeToRows(img, PALETTE)).toEqual({ rows: ["rw"], offPalette: 2 });
  });

  it("rowsToRgba と往復すると元の行に戻る", () => {
    const rows = [".kr", "wk."];
    expect(quantizeToRows(rowsToRgba(rows, PALETTE), PALETTE).rows).toEqual(rows);
  });
});

describe("frameLiteral / constName", () => {
  it("import と同じ形の Frame リテラルを書く", () => {
    expect(frameLiteral("SLIME", ["k.", ".k"])).toBe('const SLIME: Frame = [\n  "k.",\n  ".k",\n];');
  });

  it("定数名は英数字と _ の大文字に寄せ、空なら FRAME、数字始まりは _ を前に付ける", () => {
    expect(constName("skeleton knight-2")).toBe("SKELETON_KNIGHT_2");
    expect(constName("  ")).toBe("FRAME");
    expect(constName("2head")).toBe("_2HEAD");
  });
});

describe("依頼の組み立て", () => {
  it("生成は見え方の型に主題を入れ、seed とパレットは指定したときだけ載せる", () => {
    const req = generateRequest("x", { subject: "slime", view: "none", extra: "", width: 48, height: 32, variants: 4, background: "auto" });
    expect(req).toEqual({ id: "x", mode: "generate", prompt: "slime", target_size: [48, 32], variants: 4, background: "auto" });
    const withSeed = generateRequest("x", { subject: "slime", view: "none", extra: "", width: 48, height: 48, variants: 1, background: "keep", seed: 7, palette: [[0, 0, 0]] });
    expect(withSeed.seed).toBe(7);
    expect(withSeed.palette).toEqual([[0, 0, 0]]);
  });

  it("描き変えは元のフレームを frames に載せ、指示をそのまま送る", () => {
    const req = editRequest("y", { instruction: "add a hat", width: 24, height: 24, imagePngB64: "AAA", variants: 2, background: "remove" });
    expect(req.mode).toBe("edit");
    expect(req.prompt).toBe("add a hat");
    expect(req.frames).toEqual([{ image: "AAA" }]);
  });
});

describe("parseServerMessage", () => {
  it("result の画素を base64 から戻し、寸法の合わない画像は捨てる", () => {
    const px = btoa(String.fromCharCode(1, 2, 3, 255));
    const msg = parseServerMessage(JSON.stringify({ type: "result", images: [{ w: 1, h: 1, px }, { w: 2, h: 2, px }], seeds: [42] }));
    expect(msg).toEqual({ type: "result", images: [{ width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]) }], seeds: [42] });
  });

  it("壊れた JSON と知らない type は null", () => {
    expect(parseServerMessage("{")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "hello" }))).toBeNull();
  });

  it("pong と progress は欠けた値を既定で埋める", () => {
    expect(parseServerMessage(JSON.stringify({ type: "pong", model: "ready" }))).toEqual({ type: "pong", model: "ready", progress: 0, stage: "" });
    expect(parseServerMessage(JSON.stringify({ type: "progress", value: 0.5 }))).toEqual({ type: "progress", value: 0.5, stage: "" });
  });
});
