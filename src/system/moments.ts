import type { FrameInput } from "../core/input";
import { type DamageKind, type Enemy, type GameState, type Player, pushSfx } from "../core/state";
import { type Vec, dist } from "../core/vec";
import { enemyTarget, pushEvent, pushPlayerEvent } from "../core/events";
import { FORM, MOMENT } from "../data/tuning";
import { type FormKey, MOMENT_TEXT, type RiposteSource } from "../data/weaponForms";
import type { ButtonKey, MovesetDef } from "../data/weapons";
import { addFloatingText } from "./effects";
import { noteFinisherMana, onManaSource } from "./manaSources";
import { isEngaged } from "./engagement";
import { onFormSwing } from "./tomeBell";
import { breakTwinSerpent } from "./namedRelics";
import {
  type ReleaseMul,
  type ReleaseSwingSpec,
  beginSwingMorale,
  consumeShotRelease,
  currentForm,
  gainMorale,
  moraleMax,
  swingReleaseMul,
  tickMorale,
  tryPrimeReload,
} from "./morale";

/**
 * 共通の瞬間（docs/ideas/weapon-forms-impl.md 3-3）。先制・終撃・充溢・放出・応手・双撃の 6 つのイベントを 1 か所から積む。
 * 戦意の数の出し入れは system/morale.ts、ここはイベント・浮き文字と、瞬間に付く戦意の出し入れの呼び出し
 */

export type MomentState = Player["moment"];

/** 浮き文字を出す瞬間（応手は既存の「受け流し」「見切り！」「カウンター」を残して出さない） */
type MomentTextKey = keyof typeof MOMENT_TEXT;

/** 充溢の合図の音（溜めの段が上がった音を流用） */
const BRIM_SFX = "chargeLevel";

export function createMoment(): MomentState {
  // ランの始まりは交戦の外なので、最初の一撃は先制
  return { firstStrikeArmed: true, idleSec: 0, lastHitLane: null, lastHitAt: 0, swingRiposte: false, backstabUntil: 0, wardUntil: 0 };
}

function showMoment(state: GameState, pos: Vec, key: MomentTextKey): void {
  const look = MOMENT[key];
  addFloatingText(state, pos, MOMENT_TEXT[key], look.color, look.scale, look.life);
}

/** 毎ステップ（player.ts の updatePlayer）。戦意を進めて満ちた瞬間に充溢を出し、先制の構えを戻す */
export function tickFormState(state: GameState, input: FrameInput, dt: number): void {
  if (tickMorale(state, input, dt)) noteBrim(state);
  tickMoments(state, dt);
}

/** 先制: 交戦の外に firstStrikeIdleSec いたら次の一撃を先制にする */
export function tickMoments(state: GameState, dt: number): void {
  const m = state.player.moment;
  // 構えている間は数えない（交戦の判定は敵を舐めるので、要るときだけ）
  if (m.firstStrikeArmed) return;
  if (isEngaged(state)) {
    m.idleSec = 0;
    return;
  }
  m.idleSec += dt;
  if (m.idleSec >= MOMENT.firstStrikeIdleSec) m.firstStrikeArmed = true;
}

/** 充溢（戦意が満ちた瞬間） */
export function noteBrim(state: GameState): void {
  const p = state.player;
  const form = currentForm(state);
  // 短銃の弾倉が空になった瞬間は充溢ではなく装填（窓が開く合図）
  showMoment(state, p.body.pos, form.morale.release.kind === "reload" ? "reload" : "brim");
  // 導出の型（溜め）は溜めの段が上がった音が既に鳴っているので重ねない
  if (!form.morale.derived) pushSfx(state, BRIM_SFX);
  pushPlayerEvent(state, "onBrim", "morale", { amount: moraleMax(state), tag: form.key });
}

/** 放出（戦意を使った）。units は使った量（「放出の量につき」の札の元） */
export function noteRelease(state: GameState, units: number): void {
  if (units <= 0) return;
  showMoment(state, state.player.body.pos, "release");
  pushPlayerEvent(state, "onRelease", "morale", { amount: units, tag: currentForm(state).key });
}

/**
 * 近接の振り始め（player.ts の beginSwing）。応手の数えを振りごとに戻し、放出の段なら戦意を使って放出を出す。
 * 放出ならその振りの倍率を返す
 */
export function startSwingMoments(state: GameState, moveset: MovesetDef, spec: ReleaseSwingSpec): ReleaseMul | undefined {
  state.player.moment.swingRiposte = false;
  const units = beginSwingMorale(state, moveset, spec);
  // 書・鈴の放出の効き目と鈴の強化の延長（system/tomeBell.ts）
  onFormSwing(state, spec.lane, units);
  if (units <= 0) return undefined;
  noteRelease(state, units);
  return swingReleaseMul(state);
}

/** 左の射撃の放出（player.ts の fireVolley）が弾に写す値。放出でなければ空 */
export interface ShotReleaseOverride {
  damageMul?: number;
  pierceBonus?: number;
  release?: { finisher: boolean; crit: boolean };
}

export function startShotMoments(state: GameState): ShotReleaseOverride {
  const r = consumeShotRelease(state);
  if (!r) return {};
  noteRelease(state, r.units);
  // 強装填の弾倉は 1 発目だけが放出の弾（units 0 の 2 発目以降は威力の上乗せだけ）
  const release = r.units > 0 ? { release: { finisher: r.finisher, crit: r.crit } } : {};
  return { damageMul: r.mul.damageMul, pierceBonus: r.mul.pierceAdd, ...release };
}

/**
 * 応手。今の型の応手の一覧にある出来事だけ onRiposte を積み、戦意の riposte を溜める。
 * 近接の振りの中の応手（カウンター・居合）は 1 振り 1 回まで（多段・複数の敵で重ねない）
 */
export function noteRiposte(state: GameState, source: RiposteSource, enemy?: Enemy): void {
  const form = currentForm(state);
  if (!form.riposte.includes(source) || !inRiposteRange(state, form.key, source, enemy)) return;
  const m = state.player.moment;
  const inSwing = source === "counter" || source === "iai";
  if (inSwing && m.swingRiposte) return;
  if (inSwing) m.swingRiposte = true;
  gainMorale(state, "riposte");
  // 剣士の流儀の気力の源（system/manaSources.ts）
  onManaSource(state, "riposte");
  const where = enemy && enemy.hp > 0 ? enemyTarget(enemy) : { pos: { ...state.player.body.pos } };
  pushEvent(state, { kind: "onRiposte", actor: "player", source: { kind: "player", key: "riposte" }, tag: source, ...where });
}

/** 短銃の見切りは零距離（FORM.pistol.zeroDistance）の敵のときだけ応手。他の型・出来事は距離を問わない */
function inRiposteRange(state: GameState, form: FormKey, source: RiposteSource, enemy?: Enemy): boolean {
  if (form !== "pistol" || source !== "justDodge") return true;
  return enemy !== undefined && dist(enemy.body.pos, state.player.body.pos) <= FORM.pistol.zeroDistance;
}

/** 強装填（player.ts の右の押下）。装填の窓の拍に押せたら立てて浮き文字を出す。立てたら true（押下は強装填が使う） */
export function primeReload(state: GameState): boolean {
  if (!tryPrimeReload(state)) return false;
  showMoment(state, state.player.body.pos, "primed");
  pushSfx(state, BRIM_SFX);
  return true;
}

/** damageEnemy から渡す命中の中身（combat.ts の HitOptions の部分） */
export interface MomentHit {
  kind: DamageKind;
  skill?: boolean;
  silent?: boolean;
  finisher?: boolean;
  release?: boolean;
  lane?: ButtonKey;
}

/** 命中の瞬間（combat.ts の damageEnemy）: 先制・終撃・双撃。継続ダメージ・素性なしの追撃は数えない */
export function noteHitMoments(state: GameState, enemy: Enemy, hit: MomentHit): void {
  if (hit.silent) return;
  if (hit.kind === "proc" && !hit.skill) return;
  noteFirstStrike(state, enemy);
  if (hit.finisher) noteFinisherMana(state, hit.kind);
  if (hit.finisher) pushEvent(state, { kind: "onFinisher", actor: "player", source: { kind: "player", key: "finisher" }, ...(hit.release ? { tag: "release" } : {}), ...enemyTarget(enemy) });
  if (hit.lane !== undefined && !hit.skill) noteTwinStrike(state, enemy, hit.lane);
}

function noteFirstStrike(state: GameState, enemy: Enemy): void {
  const m = state.player.moment;
  if (!m.firstStrikeArmed) return;
  m.firstStrikeArmed = false;
  m.idleSec = 0;
  showMoment(state, state.player.body.pos, "firstStrike");
  pushEvent(state, { kind: "onFirstStrike", actor: "player", source: { kind: "player", key: "firstStrike" }, ...enemyTarget(enemy) });
}

/** 双撃: 直前の命中と違うレーンの命中が窓の中で続いた。同じレーンの連続では出ない */
function noteTwinStrike(state: GameState, enemy: Enemy, lane: ButtonKey): void {
  const m = state.player.moment;
  const alternated = m.lastHitLane !== null && m.lastHitLane !== lane && state.time - m.lastHitAt <= MOMENT.twinStrikeWindowSec;
  // 同じ振りが複数の敵に当たった 2 体目以降（同じ時刻）は途切れに数えない
  if (!alternated && state.time > m.lastHitAt) breakTwinSerpent(state);
  m.lastHitLane = lane;
  m.lastHitAt = state.time;
  if (!alternated) return;
  showMoment(state, enemy.body.pos, "twinStrike");
  pushEvent(state, { kind: "onTwinStrike", actor: "player", source: { kind: "player", key: "twinStrike" }, tag: lane, ...enemyTarget(enemy) });
}
