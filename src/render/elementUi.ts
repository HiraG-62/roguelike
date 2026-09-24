import { ELEMENT_COLOR, attackLabel } from "../core/element";
import type { Enemy, GameState } from "../core/state";
import { enemyGuard } from "../data/enemyCombat";
import { enemyWeaknesses } from "../data/enemyDefense";
import { ELEMENT } from "../data/tuning";
import { MOVESETS, actionStepName, isGun } from "../data/weapons";
import { BULLETS, currentBullet } from "../loot/bullets";
import { baseDef } from "../loot/bases";
import type { Item, PlayerStats } from "../loot/types";
import { SKILL_ATTACK } from "../skills/data";
import type { SkillKey } from "../skills/types";
import { TEXT, drawText } from "./pixelText";

/**
 * 攻撃ジャンル・属性の表示（docs/COMBAT_DESIGN.md A-8）。state を読むだけ。
 * - ツールチップの 1 行（武器種・銃の弾 / スキルの「近接・物理 / 無属性」）
 * - 装備画面のステータスの箱の先頭行（いまの近接・射撃の素性）
 * - 敵の頭上の弱点の印（このランで 1 体倒した種類だけ色で見せ、未知は「？」）
 */

/** 武器・銃のツールチップの 1 行（銃は弾の素性）。武器種を持たないベースは null */
export function itemAttackLine(item: Item): string | null {
  const base = baseDef(item.baseKey);
  if (base?.moveset === undefined) return null;
  const m = MOVESETS[base.moveset];
  const bullet = isGun(m) ? BULLETS[base.key] : undefined;
  return `${m.name}: ${attackLabel(bullet?.attack ?? m.attack)}`;
}

/** スキル石のツールチップの 1 行。与ダメを持たないスキルは null */
export function skillAttackLine(key: SkillKey): string | null {
  const atk = SKILL_ATTACK[key];
  return atk ? attackLabel(atk) : null;
}

/**
 * いまの近接・射撃の素性（属性の変換はステータス一覧の「近接・射撃の炎属性 n%」が別に出す）。
 * 銃の家系（isGun）以外は「射撃: …」の代わりに右クリックの固有技を出す。
 * 固有技が弾を出す型（斧の投擲・杖の魔弾など）はその素性、それ以外は「固有技」とだけ出す
 */
/** 射撃の行の見出し（弾の名前はベース名と同じなので、武器種の行と並べたとき紛れないよう「射撃」とだけ出す） */
const SHOT_LINE_LABEL = "射撃";

export function loadoutAttackLines(stats: Readonly<PlayerStats>): string[] {
  const m = MOVESETS[stats.moveset];
  const meleeLine = `${m.name}: ${attackLabel(m.attack)}`;
  if (isGun(m)) return [meleeLine, `${SHOT_LINE_LABEL}: ${attackLabel(currentBullet(stats).attack)}`];
  const art = m.steps2[0];
  if (art.kind === "volley") return [meleeLine, `${art.name}: ${attackLabel(art.throw.attack)}`];
  return [meleeLine, `${actionStepName(art, 0)}: 固有技`];
}

export interface WeaknessMark {
  /** このランでその種類を倒したか（倒すまでは「？」） */
  known: boolean;
  /** 弱点の属性の色（耐性の低い順） */
  colors: string[];
}

/** 敵の弱点の印。弱点が無ければ null。ボスは今の段階の弱点 */
export function weaknessMark(state: Readonly<GameState>, e: Readonly<Enemy>): WeaknessMark | null {
  const weak = enemyWeaknesses(enemyGuard(e.defKey), e.ai?.stage ?? 0);
  if (weak.length === 0) return null;
  const known = state.codexRun.killed.has(e.defKey);
  return { known, colors: known ? weak.map((w) => ELEMENT_COLOR[w]) : [] };
}

/** 印の 1 マスの間隔 */
const MARK_GAP = 1;

/** スプライトの右上（x = 右端、top = 上端）に弱点の小さな四角を並べる。未知は「？」 */
export function drawWeaknessMark(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, e: Readonly<Enemy>, right: number, top: number): void {
  const mark = weaknessMark(state, e);
  if (mark === null) return;
  const m = ELEMENT.mark;
  if (!mark.known) {
    drawText(ctx, m.unknownGlyph, Math.round(right), Math.round(top), TEXT.SMALL, m.unknownColor, "left");
    return;
  }
  const y = Math.round(top - m.size);
  mark.colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(right + i * (m.size + MARK_GAP)), y, m.size, m.size);
  });
}
