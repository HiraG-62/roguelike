import type { GameState } from "../core/state";
import { STATUS_LABEL } from "../core/status";
import { BOONS } from "../system/boonDefs";
import { BOON_GRADE_LABEL, boonGradeOf } from "../system/boonGrade";
import { ownedCore } from "../system/boonCores";

/**
 * 装備画面のステータスタブ「効果」頁: 今かかっている状態異常・持っている祝福・芯・一時強化の一覧（読むだけ）。
 * ラン中（state.sandbox が立っていない）だけ意味がある。拠点では空。docs/GLOSSARY.md の表記に揃える
 */

export interface EffectRow {
  key: string;
  name: string;
  /** 右寄せの短い情報（残り秒・格など） */
  info: string;
  /** 効果の短い説明（状態異常・一時強化は空文字でよい） */
  detail: string;
}

/** 小数第 1 位までの秒表記（末尾の .0 は落とす） */
function formatSeconds(sec: number): string {
  const v = Number(Math.max(0, sec).toFixed(1));
  return `${v}秒`;
}

/** 今かかっている状態異常（プレイヤー）。良い状態・堅守なども含め、付いているものをすべて出す */
export function statusEffectRows(state: GameState): EffectRow[] {
  return state.player.status.effects.map((e) => ({
    key: `status:${e.kind}`,
    name: e.stacks > 1 ? `${STATUS_LABEL[e.kind]}×${e.stacks}` : STATUS_LABEL[e.kind],
    info: formatSeconds(e.time),
    detail: "",
  }));
}

/** 持っている祝福（芯を除く）。名前・格・効果の短い説明 */
export function boonRows(state: GameState): EffectRow[] {
  return state.boons
    .map((key) => BOONS[key])
    .filter((def) => def.core !== true)
    .map((def) => ({ key: `boon:${def.key}`, name: def.name, info: BOON_GRADE_LABEL[boonGradeOf(state, def.key)], detail: def.desc }));
}

const CORE_INFO = "芯";

/** 持っている芯（1 ランに 1 つ）。無ければ空配列 */
export function coreRows(state: GameState): EffectRow[] {
  const def = ownedCore(state);
  return def ? [{ key: `core:${def.key}`, name: def.name, info: CORE_INFO, detail: def.desc }] : [];
}

const BUFF_DAMAGE_NAME = "ダメージ強化";
const BUFF_SPEED_NAME = "移動速度強化";
const BUFF_INVULN_NAME = "無敵";

/** その他の一時強化（祝福・スキル・奥義が掛ける秒限りの倍率）。掛かっていなければ空配列 */
export function buffRows(state: GameState): EffectRow[] {
  const b = state.player.buffs;
  const rows: EffectRow[] = [];
  if (b.damage.time > 0 && b.damage.mul !== 1) {
    rows.push({ key: "buff:damage", name: BUFF_DAMAGE_NAME, info: formatSeconds(b.damage.time), detail: `与ダメージ ${Math.round(b.damage.mul * 100)}%` });
  }
  if (b.speed.time > 0 && b.speed.mul !== 1) {
    rows.push({ key: "buff:speed", name: BUFF_SPEED_NAME, info: formatSeconds(b.speed.time), detail: `移動速度 ${Math.round(b.speed.mul * 100)}%` });
  }
  if (b.invuln > 0) rows.push({ key: "buff:invuln", name: BUFF_INVULN_NAME, info: formatSeconds(b.invuln), detail: "攻撃を受けない" });
  return rows;
}

/** ラン中だけ意味がある効果の一覧（芯 → 祝福 → 状態異常 → 一時強化）。拠点では空 */
export function runEffectRows(state: GameState): EffectRow[] {
  if (state.sandbox === true) return [];
  return [...coreRows(state), ...boonRows(state), ...statusEffectRows(state), ...buffRows(state)];
}
