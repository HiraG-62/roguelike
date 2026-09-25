import { describe, expect, it } from "vitest";
import { JOB_KEYS } from "../data/jobs";
import { jobDetailLines } from "../system/jobs";

/**
 * 表示文字列のキー名。キー設定で変わるアクション（移動・ダッシュ・攻撃・奥義・スキル・拾う・装備画面…）の
 * キー名は core/input.ts の keyLabel を通して組み、文字列に直書きしない（キー設定を変えると嘘になる）。
 * Enter / Esc / 矢印 / Shift+クリック / タイトルのホットキーは固定の操作なので対象外
 */

/** 本体の .ts（テストを除く）の中身 */
const SOURCES = import.meta.glob<string>(["../**/*.ts", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true });

/** キー名を定義する側（表示名の表）は対象外 */
const ALLOWED_FILES: readonly string[] = ["../core/input.ts"];

/** タイトル画面のホットキー（ui/title.ts の processMenuKeys が固定のキーで拾う。キー設定の対象外） */
const ALLOWED_LITERALS: readonly string[] = ['"C: 図鑑   Q: 依頼   A: 実績   T: Tips ノート"'];

/** 束縛で変わるキーを直書きした表示の形 */
const FIXED_KEY_PATTERNS: readonly RegExp[] = [
  /(^|[^A-Za-z0-9_])F ?[:：で]/,
  /(^|[^A-Za-z0-9_])[EQG] ?[:：]/,
  /（Tab）|(^|[^A-Za-z])Tab ?[:：で]/,
  /左クリック|右クリック/,
  /WASD/,
  /Space ?[:：で]/,
  /(^|[^0-9])1 \/ C|2 \/ V|3 \/ X|4 \/ Z/,
];

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:"'`])\/\/[^\n]*/g;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, (m) => m.replace(/[^\n]/g, "")).replace(LINE_COMMENT, "$1");
}

/** 日本語を含む文字列リテラル（表示文字列）だけを見る。key・色・コードは対象外 */
const JAPANESE = /[ぁ-んァ-ヶ一-龠]/;

function fixedKeyHits(path: string, text: string): string[] {
  const code = stripComments(text);
  const hits: string[] = [];
  for (const m of code.matchAll(STRING_LITERAL)) {
    if (!JAPANESE.test(m[0]) || ALLOWED_LITERALS.includes(m[0])) continue;
    const pattern = FIXED_KEY_PATTERNS.find((p) => p.test(m[0]));
    if (pattern === undefined) continue;
    const line = code.slice(0, m.index).split("\n").length;
    hits.push(`${path}:${line} ${m[0].slice(0, 60)}`);
  }
  return hits;
}

describe("表示文字列のキー名", () => {
  it("本体のソースを読めている", () => {
    expect(Object.keys(SOURCES).length, "src の .ts").toBeGreaterThan(100);
  });

  it("表示文字列に固定のキー名（F: など）が残っていない", () => {
    const hits = Object.entries(SOURCES)
      .filter(([path]) => !ALLOWED_FILES.includes(path))
      .flatMap(([path, text]) => fixedKeyHits(path, text));
    expect(hits, "core/input.ts の keyLabel / moveKeyLabel で組む").toEqual([]);
  });

  it("奥義ゲージの下にキーの文字を出さない", () => {
    const renderer = SOURCES["../render/renderer.ts"] ?? "";
    expect(renderer.length, "renderer.ts を読めている").toBeGreaterThan(0);
    expect(renderer.includes("奥義を終える"), "持続中は色で分かるので案内を出さない").toBe(false);
    expect(/["`][^"`\n]*: 奥義["`]/.test(renderer), "満タンの案内を出さない").toBe(false);
  });
});

/** 以前は括弧で仕組みを説明していた行の見出し（説明は Tips ノートへ移した） */
const EXPLAINED_HEADS: readonly string[] = ["得意な武器:", "初期武器:", "初期スキル石:"];

describe("ジョブの説明", () => {
  it("ジョブの説明に括弧書きの説明が無い", () => {
    for (const job of JOB_KEYS) {
      // 固有のルール・弱点は効果の記述（データ側）なので対象外。仕組みの補足を付けていた行だけを見る
      const lines = jobDetailLines(job).filter((l) => EXPLAINED_HEADS.some((h) => l.startsWith(h)));
      for (const line of lines) expect(line.includes("（"), `${job}: ${line}`).toBe(false);
    }
  });
});
