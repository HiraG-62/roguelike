import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 画面に出す字が DotGothic16（public/fonts）に収録されているかの検査。
 * 収録されていない字（▶ や ✦ など）は pixelText が環境の代わりのフォントで描くので、端末によっては豆腐「□」になる。
 * ここでは src の本体ファイルの文字列リテラルにある非 ASCII の字を、フォントの cmap と突き合わせる
 */

const FONT_PATH = path.resolve("public/fonts/DotGothic16-Regular.ttf");
const SRC_DIR = path.resolve("src");

/** TrueType の cmap から収録された字の集合を作る（format 4 = BMP / format 12 = 全面。他の形式は読まない） */
function coveredCodePoints(buf: Buffer): Set<number> {
  const tableCount = buf.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < tableCount; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("ascii", rec, rec + 4) === "cmap") cmapOffset = buf.readUInt32BE(rec + 8);
  }
  if (cmapOffset < 0) throw new Error("cmap が無い");
  const out = new Set<number>();
  const subCount = buf.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < subCount; i++) {
    const start = cmapOffset + buf.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(start);
    if (format === 4) readFormat4(buf, start, out);
    else if (format === 12) readFormat12(buf, start, out);
  }
  return out;
}

function readFormat4(buf: Buffer, start: number, out: Set<number>): void {
  const segX2 = buf.readUInt16BE(start + 6);
  const endBase = start + 14;
  const startBase = endBase + segX2 + 2;
  const deltaBase = startBase + segX2;
  const rangeBase = deltaBase + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = buf.readUInt16BE(endBase + s * 2);
    const first = buf.readUInt16BE(startBase + s * 2);
    const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);
    const delta = buf.readInt16BE(deltaBase + s * 2);
    for (let c = first; c <= end && c < 0xffff; c++) {
      if (rangeOffset === 0) {
        out.add(c);
        continue;
      }
      const glyphAt = rangeBase + s * 2 + rangeOffset + (c - first) * 2;
      const glyph = buf.readUInt16BE(glyphAt);
      if (glyph !== 0 && ((glyph + delta) & 0xffff) !== 0) out.add(c);
    }
  }
}

function readFormat12(buf: Buffer, start: number, out: Set<number>): void {
  const groups = buf.readUInt32BE(start + 12);
  for (let g = 0; g < groups; g++) {
    const at = start + 16 + g * 12;
    const first = buf.readUInt32BE(at);
    const last = buf.readUInt32BE(at + 4);
    for (let c = first; c <= last; c++) out.add(c);
  }
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.endsWith(".gen.ts")) out.push(full);
  }
  return out;
}

const STRING_LITERAL = /"([^"\n]*)"|`([^`\n]*)`/gu;
/** 非 ASCII の制御・結合・全角空白などは検査しない（描かない・フォントの字ではない） */
const SKIP = /[\u0080-ÿ -‏　️]/u;

describe("画面の字のフォント収録", () => {
  const covered = coveredCodePoints(readFileSync(FONT_PATH));

  it("cmap を読めている（日本語の字と矢印・三角が収録されている）", () => {
    for (const ch of "剣気円返新合名→▲▼◆") expect(covered.has(ch.codePointAt(0) ?? 0), `${ch} は収録`).toBe(true);
    expect(covered.has("▶".codePointAt(0) ?? 0), "▶ は収録されていない（代わりに ◆ を使う）").toBe(false);
  });

  it("本体の文字列リテラルの字はすべてフォントに収録されている（豆腐を出さない）", () => {
    const missing = new Map<string, Set<string>>();
    for (const file of sourceFiles(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(STRING_LITERAL)) {
        for (const ch of m[1] ?? m[2] ?? "") {
          if (ch.charCodeAt(0) < 0x80 || SKIP.test(ch)) continue;
          if (covered.has(ch.codePointAt(0) ?? 0)) continue;
          const files = missing.get(ch) ?? new Set<string>();
          files.add(path.relative(SRC_DIR, file));
          missing.set(ch, files);
        }
      }
    }
    const report = [...missing].map(([ch, files]) => `${ch}(U+${(ch.codePointAt(0) ?? 0).toString(16)}): ${[...files].slice(0, 3).join(", ")}`);
    expect(report, "フォントに無い字を使っている").toEqual([]);
  });
});
