import { type Vec, dist } from "../core/vec";
import { BLAST_FALLOFF } from "../data/tuning";

/**
 * 爆発の距離減衰（敵味方すべての爆発が使う共通の倍率）。
 * 爆心に近いほど重く当て、縁をかすめただけなら軽くする。「爆心から離れる」判断に報酬を出すため。
 *
 * 仕様:
 * - 距離 d は爆心から対象の近い側の縁まで（中心間距離 − 対象の半径、0 未満は 0）。
 *   当たり判定が「爆発の円と対象の円の重なり」なので、縁に触れただけの対象がちょうど edgeMul になり、
 *   爆心を体で覆う大きな敵（ボス）は等倍になる
 * - d ≤ innerRatio × radius は 1。そこから radius に向けて線形に edgeMul まで下がる
 * - d ≥ radius は edgeMul（当てるかどうかは呼び出し側の判定に任せ、ここでは 0 にしない）
 * - radius ≤ 0（半径の無い単体の起爆）は 1
 * ダメージ・怯み値・ノックバックに掛ける。状態異常の付与には掛けない
 */
export function blastFalloff(d: number, radius: number): number {
  if (radius <= 0) return 1;
  const inner = radius * BLAST_FALLOFF.innerRatio;
  if (d <= inner) return 1;
  const span = radius - inner;
  if (span <= 0) return BLAST_FALLOFF.edgeMul;
  const t = Math.min(1, (d - inner) / span);
  return 1 - t * (1 - BLAST_FALLOFF.edgeMul);
}

/** 爆心 center・半径 radius の爆発が、位置 pos・半径 targetRadius の対象へ当たるときの倍率 */
export function blastMulAt(center: Vec, radius: number, pos: Vec, targetRadius: number): number {
  return blastFalloff(Math.max(0, dist(center, pos) - targetRadius), radius);
}
