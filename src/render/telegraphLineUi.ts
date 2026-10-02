import type { Enemy, GameState } from "../core/state";
import { type Vec, normalize, sub } from "../core/vec";
import { GOFUN_COLOR } from "../data/signs";
import { TELEGRAPH } from "../data/tuning";
import { relicTelegraphLeadSec } from "../system/namedRelics";
import { attackCommitted } from "../system/poise";

/**
 * 敵の予告の線の向きと色（docs/ideas/combat-core-impl.md 2-3）。state を読むだけで、rng も書き込みも使わない。
 * 色は「まだ怯ませて潰せる（黄 = 下絵）」と「コミット済みで必ず出る（赤 = 墨入れ）」の 2 つ。線を引く筆致は telegraphInk.ts・telegraphLayer.ts
 */

/** 予告の色。予備動作の前半は黄、コミット窓に入ったら赤 */
export function telegraphColor(e: Enemy): string {
  return attackCommitted(e) ? TELEGRAPH.commitColor : TELEGRAPH.readyColor;
}

/**
 * 線の向き。狙いを予備動作の終わりで更新する敵（beginStrike が player 方向へ向け直す）は、
 * 今のプレイヤー方向を向く。予備動作の始まりで狙いを固定する敵は strikeDir のまま
 */
export function telegraphLineDir(e: Enemy, aimFixed: boolean, playerPos: Vec): Vec {
  if (aimFixed) return e.strikeDir;
  return normalize(sub(playerPos, e.body.pos), e.strikeDir);
}

/**
 * 星読みの眼: 予備動作の残りが leadSec を切ると、線の先から敵へ寄る目盛りを描く（着けていなければ何もしない）。
 * 予告を早く出すのは描画の呼び出し元（予備動作中だけ）を越えるので、残り秒を見せて読みやすくする形にした。
 * 線の質（黄の欠けた線 / 赤の芯）と紛れないよう胡粉で描く
 */
export function drawLeadMark(ctx: CanvasRenderingContext2D, state: GameState, e: Enemy, dir: Vec, length: number): void {
  const lead = relicTelegraphLeadSec(state);
  if (lead <= 0) return;
  const t = Math.min(1, Math.max(0, e.phaseTimer / lead));
  const half = TELEGRAPH.leadMarkSize / 2;
  ctx.fillStyle = GOFUN_COLOR;
  ctx.fillRect(e.body.pos.x + dir.x * length * t - half, e.body.pos.y + dir.y * length * t - half, TELEGRAPH.leadMarkSize, TELEGRAPH.leadMarkSize);
}
