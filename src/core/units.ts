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
