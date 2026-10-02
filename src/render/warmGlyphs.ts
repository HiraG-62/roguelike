/**
 * 起動時に先に焼いておく字（pixelText の warm）。ゲーム中に初めて出る字は 1 字ずつ焼くので、
 * 浮き文字・HUD によく出る字をここに並べておくと、初めての命中や撃破のフレームが重くならない。
 * 載っていない字もその場で焼けるので、漏れても見た目は変わらない（そのフレームが少し重くなるだけ）
 */

/** 半角の英数字・記号（0x20〜0x7e） */
const ASCII_FIRST = 0x20;
const ASCII_LAST = 0x7e;
/** ひらがな（ぁ〜ゖ）とカタカナ（ァ〜ヺ・中黒・ー） */
const HIRAGANA_FIRST = 0x3041;
const HIRAGANA_LAST = 0x3096;
const KATAKANA_FIRST = 0x30a1;
const KATAKANA_LAST = 0x30fc;

/** 浮き文字・HUD の記号 */
const SYMBOLS = "、。「」『』（）！？：％＋－×÷…→←↑↓★☆◆◇●○■□▲△▼▽～";

/**
 * 浮き文字の漢字（system / skills の addFloatingText の文字列と XXX_TEXT 定数から集めたもの）。
 * warmGlyphs.test.ts が源を走査して、足りない字があれば落ちる
 */
export const FLOAT_KANJI =
  "三上下中了仇付代伏倉倒倣充先兵写処出刀分切刑刻剥割力加助効動化反収取吐否吸吹告呑呪四回地填壊変太奏契奥奪宝宣容封層崩巣常床庫引張強形復怒態成手承拒捕放敗敵断昂暴書未本来杯棚模死気氷没油法深満激火無物状狙瓶生番異発直相盾着砕破神禁穫突窟第約終継義羽者膨芽落蘇血裂補見解討誓読貪走踏身転込逃速道重金銭鎖鎧鏡長門開限除陥雨顔食墜冠損導用";

function range(first: number, last: number): string {
  let out = "";
  for (let c = first; c <= last; c++) out += String.fromCodePoint(c);
  return out;
}

/** 先に焼く字の全部 */
export const WARM_GLYPHS: string =
  range(ASCII_FIRST, ASCII_LAST) + range(HIRAGANA_FIRST, HIRAGANA_LAST) + range(KATAKANA_FIRST, KATAKANA_LAST) + SYMBOLS + FLOAT_KANJI;
