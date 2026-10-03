import { type GameState, pushSfx } from "../core/state";
import type { ButtonKey } from "../data/weapons";
import type { SkillResource } from "../skills/types";
import { FORM } from "../data/tuning";
import { tollPlaced } from "../skills/placed";
import { tollSummons } from "../skills/summons";
import { currentForm } from "./morale";

/**
 * 書・鈴の型の固有の仕組み（docs/ideas/weapon-forms-impl.md 3-4 の書・鈴の行、3-8）。
 * 書: 持っている間はスキルの再使用が短く、放出（右 1 段目の無詠唱）で次の気力のスキル 1 回の気力が 0。
 * 鈴: 放出（右 1 段目の打ち鳴らし）で近くの自分の設置物を即発動・連動体に 1 回撃たせ、設置物・従魔の命中を少しの間強める。
 * 強化の間の左の振りで強化が延びる。戦意の数の出し入れは system/morale.ts、ここは放出の後の効き目だけ
 */

/** 打ち鳴らしの合図の音（スキルが撃てるようになった澄んだ音を流用） */
const TOLL_SFX = "skillReady";

/**
 * 近接の振り始め（system/moments.ts の startSwingMoments）。units は放出で使った戦意（0 = 放出でない）。
 * 書・鈴の放出の効き目と、鈴の強化の延長をここで畳む
 */
export function onFormSwing(state: GameState, lane: ButtonKey, units: number): void {
  const form = currentForm(state).key;
  if (form === "tome" && units > 0) {
    state.skills.freeCast = true;
    return;
  }
  if (form !== "bell") return;
  if (units > 0) {
    tollBell(state);
    return;
  }
  if (lane === "primary") extendBellBuff(state);
}

/** 打ち鳴らし: 半径内の設置物・連動体を動かし、設置物・従魔の強化を立てる */
function tollBell(state: GameState): void {
  const t = FORM.bell.toll;
  const center = state.player.body.pos;
  tollPlaced(state, center, t.radius);
  tollSummons(state, center, t.radius);
  state.skills.bellBuff = { time: t.buffSec, mul: t.buffMul };
  pushSfx(state, TOLL_SFX);
}

/** 強化の間の左の振り 1 回で残りを延ばす（上限 maxSec）。強化が切れていれば何もしない（振りだけで立てない） */
function extendBellBuff(state: GameState): void {
  const buff = state.skills.bellBuff;
  if (!buff || buff.time <= 0) return;
  const t = FORM.bell.toll;
  buff.time = Math.min(t.maxSec, buff.time + t.extendSec);
}

/** 毎ステップ（system/skills.ts の tickTimers）。鈴の強化の残りを減らす */
export function tickTomeBell(state: GameState, dt: number): void {
  const buff = state.skills.bellBuff;
  if (buff) buff.time = Math.max(0, buff.time - dt);
}

/** 設置物・従魔の命中の威力の倍率（skills/hit.ts の skillHit）。鈴の強化の間だけ 1 より大きい */
export function minionDamageMul(state: GameState, minion: boolean): number {
  const buff = state.skills.bellBuff;
  if (!minion || !buff || buff.time <= 0) return 1;
  return buff.mul;
}

/** スキルの再使用（CD 型の秒）の倍率。書を持つ間だけ FORM.tome.skillCooldownMul */
export function formSkillCooldownMul(state: GameState): number {
  return currentForm(state).key === "tome" ? FORM.tome.skillCooldownMul : 1;
}

/** 無詠唱が立っていれば気力のコストを 0 にする（HUD の表示と実際の支払いを揃えるため resolveSlot で掛ける） */
export function freeCastCost(state: GameState, cost: number): number {
  return state.skills.freeCast === true ? 0 : cost;
}

/** この発動が無詠唱で撃つものか（気力のスキルだけが無詠唱を使う。consumeFreeCast の前に読む） */
export function isFreeCast(state: GameState, resource: SkillResource): boolean {
  return resource === "mana" && state.skills.freeCast === true;
}

/** 気力のスキルを撃ったら無詠唱を使い切る */
export function consumeFreeCast(state: GameState): void {
  state.skills.freeCast = false;
}
