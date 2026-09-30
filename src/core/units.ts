/**
 * 距離の単位。ロジックと座標は論理 px（`core/view.ts` の 480x270）のまま持ち、
 * プレイヤーに見せる距離だけメートルに直す。人型のスプライト（16px）が 1.6m の背丈に
 * 見える縮尺として 10px = 1m とする（1 タイル 16px = 1.6m）。この定義自体は表示に出さない
 */
export const PX_PER_METER = 10;

/** 表示の小数桁。1 桁あれば 0.5m 刻みの違いまで読める */
const METER_DIGITS = 1;

export function pxToMeters(px: number): number {
  return px / PX_PER_METER;
}

/** 表示用の「4m」「2.5m」。末尾の .0 は落とす */
export function formatMeters(px: number): string {
  return `${Number(pxToMeters(px).toFixed(METER_DIGITS))}m`;
}

/** ダメージなど大きな数の表示を短くし始める値（これ未満は整数のまま） */
const AMOUNT_SHORT_FROM = 10_000;
/** 大きな数の単位（小さい順）。K = 千・M = 百万・B = 十億・T = 兆 */
const AMOUNT_UNITS: readonly { readonly value: number; readonly suffix: string }[] = [
  { value: 1e3, suffix: "K" },
  { value: 1e6, suffix: "M" },
  { value: 1e9, suffix: "B" },
  { value: 1e12, suffix: "T" },
];
/** 単位を付けた数がこの値未満なら小数 1 桁を出す（12.3K / 123K） */
const AMOUNT_DECIMAL_BELOW = 100;
/** 1 つ上の単位へ繰り上げる境目（丸めて 1000K になるなら 1M と出す） */
const AMOUNT_UNIT_STEP = 1000;

function shortAmount(a: number, unit: number): string {
  const scaled = a / unit;
  return scaled < AMOUNT_DECIMAL_BELOW ? String(Number(scaled.toFixed(1))) : String(Math.round(scaled));
}

/** 浮き文字の数字。1 万未満は整数のまま、1 万以上は K / M / B / T（「12.3K」「123K」「1.2M」。末尾の .0 は落とす） */
export function formatAmount(n: number): string {
  const v = Math.round(n);
  const a = Math.abs(v);
  if (a < AMOUNT_SHORT_FROM) return String(v);
  const sign = v < 0 ? "-" : "";
  for (let i = AMOUNT_UNITS.length - 1; i >= 0; i--) {
    const u = AMOUNT_UNITS[i];
    if (!u || a < u.value) continue;
    const text = shortAmount(a, u.value);
    const next = AMOUNT_UNITS[i + 1];
    // 999,950 は丸めると 1000K になるので 1M と出す
    if (next && Number(text) >= AMOUNT_UNIT_STEP) return `${sign}${shortAmount(a, next.value)}${next.suffix}`;
    return `${sign}${text}${u.suffix}`;
  }
  return String(v);
}
