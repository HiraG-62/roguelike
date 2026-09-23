/**
 * UI フォント定義。画面の文字は pixelText.ts（ドット風）で描き、uiFont() は DotGothic16 未ロード時のフォールバック描画にだけ使う。
 * 論理座標（480x270）上のサイズを渡す。実描画は Renderer の transform でデバイス解像度に拡大される
 */

export const UI_FONT_FAMILY = '"Noto Sans JP", "Yu Gothic UI", "Meiryo", "Hiragino Sans", "Segoe UI", sans-serif';

export type FontWeight = "normal" | "bold";

const cache = new Map<string, string>();

/** ctx.font に渡す文字列。毎フレーム呼ばれるのでキャッシュする */
export function uiFont(sizePx: number, weight: FontWeight = "bold"): string {
  const key = `${weight}|${sizePx}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = `${weight} ${sizePx}px ${UI_FONT_FAMILY}`;
  cache.set(key, made);
  return made;
}

/** CJK（空白で区切らない文字）は 1 文字単位で折り返してよい。範囲: U+3000-30FF, U+3400-9FFF, U+F900-FAFF, U+FF00-FFEF */
const BREAKABLE_CHAR = /[　-ヿ㐀-鿿豈-﫿＀-￯]/;
/** 行頭に来てはいけない記号（禁則の最小限） */
const NO_LINE_START = /^[、。，．）」』】！？ー…・]/;

/** 折り返し単位に分ける。英単語は空白ごと 1 単位、CJK は 1 文字 1 単位 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  for (const ch of text) {
    if (ch === " ") {
      buf += ch;
      tokens.push(buf);
      buf = "";
      continue;
    }
    if (BREAKABLE_CHAR.test(ch)) {
      if (buf) tokens.push(buf);
      buf = "";
      tokens.push(ch);
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/**
 * 実測幅で折り返す（等幅前提の文字数計算は日本語で破綻するため）。
 * measure には通常 (s) => ctx.measureText(s).width を渡す
 */
export function wrapByWidth(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokenize(text)) {
    const next = line + token;
    const fits = measure(next.trimEnd()) <= maxWidth;
    if (fits || !line.trim() || NO_LINE_START.test(token)) {
      line = next;
      continue;
    }
    lines.push(line.trimEnd());
    line = token.trimStart();
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** ドット風テキスト（PixelText）用のフォント。index.html の @font-face で public/fonts から読み込む */
export const PIXEL_FONT_FAMILY = "DotGothic16";
