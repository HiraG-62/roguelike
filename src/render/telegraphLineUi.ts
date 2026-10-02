import type { Enemy, GameState } from "../core/state";
import { GOFUN_COLOR } from "../data/signs";
import { TELEGRAPH } from "../data/tuning";
import { relicTelegraphLeadSec } from "../system/namedRelics";
import type { Vec } from "../core/vec";
import { attackCommitted } from "../system/poise";
import { telegraphAimDir } from "../system/threat";

/**
 * 敵の予告の線の向きと色（docs/ideas/combat-core-impl.md 2-3）。state を読むだけで、rng も書き込みも使わない。
 * 小さな印の色は「まだ怯ませて潰せる（薄墨 = 下絵）」と「コミット済みで必ず出る（朱 = 墨入れ）」の 2 つ。線を引く筆致は telegraphInk.ts・telegraphLayer.ts
 */

/** 予告の小さな印（縁取り・点）の色。予備動作の前半（下絵）は薄墨、コミット窓に入ったら（墨入れ）朱 */
export function telegraphColor(e: Enemy): string {
  return attackCommitted(e) ? TELEGRAPH.shuColor : TELEGRAPH.usuzumiLightColor;
}

/** 線の向き（system/threat.ts の telegraphAimDir。描画も判定も同じ向きを読む） */
export const telegraphLineDir = telegraphAimDir;

/**
 * 星読みの眼: 予備動作の残りが leadSec を切ると、線の先から敵へ寄る目盛りを描く（着けていなければ何もしない）。
 * 予告を早く出すのは描画の呼び出し元（予備動作中だけ）を越えるので、残り秒を見せて読みやすくする形にした。
 * 胡粉の小さな四角で描く（薄墨の帯・濃墨の線のどちらの上でも読める）
 */
export function drawLeadMark(ctx: CanvasRenderingContext2D, state: GameState, e: Enemy, dir: Vec, length: number): void {
  const lead = relicTelegraphLeadSec(state);
  if (lead <= 0) return;
  const t = Math.min(1, Math.max(0, e.phaseTimer / lead));
  const half = TELEGRAPH.leadMarkSize / 2;
  ctx.fillStyle = GOFUN_COLOR;
  ctx.fillRect(e.body.pos.x + dir.x * length * t - half, e.body.pos.y + dir.y * length * t - half, TELEGRAPH.leadMarkSize, TELEGRAPH.leadMarkSize);
}
