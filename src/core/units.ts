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

/** ダメージなど大きな数の表示の区切り。10 万から「万」、1 億から「億」 */
const AMOUNT_MAN = 10_000;
const AMOUNT_OKU = 100_000_000;
const AMOUNT_MAN_FROM = 100_000;
/** 大きな数の小数桁 */
const AMOUNT_DIGITS = 1;

function scaledAmount(n: number, unit: number): string {
  return String(Number((n / unit).toFixed(AMOUNT_DIGITS)));
}

/** 浮き文字の数字。10 万未満は整数のまま、10 万以上は「12.3万」、1 億以上は「1.2億」（小数 1 桁、末尾の .0 は落とす） */
export function formatAmount(n: number): string {
  const v = Math.round(n);
  const a = Math.abs(v);
  if (a < AMOUNT_MAN_FROM) return String(v);
  // 9999.95万 のように丸めて 1 億に届く値は億で出す
  if (a >= AMOUNT_OKU || Number((a / AMOUNT_MAN).toFixed(AMOUNT_DIGITS)) >= AMOUNT_OKU / AMOUNT_MAN) return `${scaledAmount(v, AMOUNT_OKU)}億`;
  return `${scaledAmount(v, AMOUNT_MAN)}万`;
}
