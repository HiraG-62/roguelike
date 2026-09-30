import { type Enemy, type GameState, pushSfx } from "../core/state";
import { enemyTarget, pushEvent } from "../core/events";
import { type Vec, angle, length, sub } from "../core/vec";
import { enemyDef, isBossClass } from "../data/enemies";
import { enemyCombat } from "../data/enemyCombat";
import { FX_ATTACK, PARRY, WEAPON } from "../data/tuning";
import { addFloatingText, addMark, spawnBurst } from "./effects";
import { gainMana } from "./mana";
import { noteRiposte } from "./moments";
import { addPoise, applyStagger } from "./poise";
import { skillLocksAttack } from "./skills";
import { hasStatus } from "./statusEffects";
import { onTraitCounter } from "./traitHooks";

/**
 * 全武器共通の受け流し（docs/ideas/combat-core-impl.md 2-8）。振っていなければいつでも押せて、窓（PARRY.windowSec）の間の被弾を
 * 無効にして相手を怯ませる。敵の「コミットした攻撃」（poise.ts）を止められる唯一の手段なので、強靭・コミット・堅守を無視する。
 * 外す（窓の間に被弾が無い）と PARRY.recoverSec の硬直で攻撃・射撃・ダッシュが出せない。
 * 剣の右 1 段目の構えの受け流し（weaponArts.ts）の成功処理も parrySucceed に通して、コミットを破る効果を揃える
 */

const A = WEAPON.artDefaults;
const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN = Math.PI * 2;
const FULL_ARC_DEG = 360;
const TEXT_SCALE = 1.4;
const TEXT_LIFE = 0.6;
const FX_SPEED = 120;
const FX_LIFE = 0.3;
const FX_SIZE = 2;

function isStaggeredPlayer(state: GameState): boolean {
  return hasStatus(state.player.status, "stagger");
}

/** 受け流しの窓が開いているか */
export function parryWindowOpen(state: GameState): boolean {
  return state.player.parry.window > 0;
}

/** 外した硬直の間か */
export function parryRecovering(state: GameState): boolean {
  return state.player.parry.recover > 0;
}

/** 窓の間と外した硬直の間は攻撃・射撃を受け付けない（窓の間に振ると「振りながらの受け流し」になってしまう） */
export function parryLocksActions(state: GameState): boolean {
  return parryWindowOpen(state) || parryRecovering(state);
}

/** 窓の間と外した硬直の間はダッシュで抜けられない（押したら受け流しに賭ける） */
export function parryLocksDash(state: GameState): boolean {
  return parryLocksActions(state);
}

/** 受け流し中の移動速度倍率（窓 PARRY.windowMoveMul、硬直 PARRY.recoverMoveMul。どちらでもなければ 1） */
export function parryMoveMul(state: GameState): number {
  if (parryRecovering(state)) return PARRY.recoverMoveMul;
  if (parryWindowOpen(state)) return PARRY.windowMoveMul;
  return 1;
}

/**
 * 受け流しを構えられるか。振り・ダッシュ・怯み・剣の構え（右 1 段目の受け流し・盾の構え）・受け流し自身の窓と硬直・
 * スキルの硬直の間は構えられない
 */
export function canStartParry(state: GameState): boolean {
  const p = state.player;
  if (state.status !== "playing") return false;
  if (p.attack.phase !== "none" || p.dashTimer > 0) return false;
  if (p.art.holding || p.art.recover > 0) return false;
  if (isStaggeredPlayer(state) || parryLocksActions(state)) return false;
  return !skillLocksAttack(state);
}

/**
 * 受け流しを押した瞬間（player.ts の readActions から）。構えられれば窓を開ける。開けたら true。
 * 溜め中なら溜めを捨てる（ダッシュと同じ。溜めたまま窓を開けると離した瞬間に大振りが出てしまう）
 */
export function startParry(state: GameState): boolean {
  if (!canStartParry(state)) return false;
  const p = state.player;
  p.parry.window = PARRY.windowSec;
  p.attack.charging = false;
  p.attack.chargeTime = 0;
  return true;
}

/** 窓と硬直を進める（player.ts の tickTimers から毎ステップ）。窓が何もなく閉じたら外した硬直を付ける */
export function tickParry(state: GameState, dt: number): void {
  const parry = state.player.parry;
  if (parry.window <= 0) {
    parry.recover = Math.max(0, parry.recover - dt);
    return;
  }
  // 怯まされたら窓は閉じるだけ（怯み自体が硬直なので二重に罰しない）
  if (isStaggeredPlayer(state)) {
    parry.window = 0;
    return;
  }
  parry.window -= dt;
  if (parry.window > 0) return;
  parry.window = 0;
  parry.recover = PARRY.recoverSec;
}

/** from が向き facing から arcDeg の扇の内側か。真上に重なっている（向きが無い）なら内側とみなす */
function withinArc(origin: Vec, facing: Vec, from: Vec, arcDeg: number): boolean {
  if (arcDeg >= FULL_ARC_DEG) return true;
  const rel = sub(from, origin);
  if (length(rel) === 0) return true;
  let diff = (angle(rel) - angle(facing)) % FULL_TURN;
  if (diff > Math.PI) diff -= FULL_TURN;
  if (diff < -Math.PI) diff += FULL_TURN;
  return Math.abs(diff) <= (arcDeg * DEG_TO_RAD) / 2;
}

/**
 * 窓の中の被弾を受け流す（weaponArts.ts の tryParry が剣の構えの受け流しの次に呼ぶ）。
 * 窓が開いていて、攻撃が受け流せる向きから来ていれば成功して true
 */
export function tryWindowParry(state: GameState, fromPos: Vec | undefined, attacker?: Enemy): boolean {
  const p = state.player;
  if (!parryWindowOpen(state)) return false;
  if (fromPos && !withinArc(p.body.pos, p.facing, fromPos, PARRY.arcDeg)) return false;
  parrySucceed(state, attacker, PARRY.bossPoise);
  return true;
}

/**
 * 受け流しの成功（共通の処理）。窓を閉じ、無敵・浮き文字・気力・カウンター扱いのイベント（刀のルール・祝福が乗る）を出し、
 * 攻撃した敵を止める。bossPoise はボスに入れる怯み値（剣の構えは自前の値を渡す）
 */
export function parrySucceed(state: GameState, attacker: Enemy | undefined, bossPoise: number): void {
  const p = state.player;
  p.parry.window = 0;
  p.invulnTimer = Math.max(p.invulnTimer, A.parryInvuln);
  addFloatingText(state, p.body.pos, A.parryText, A.parryColor, TEXT_SCALE, TEXT_LIFE);
  spawnBurst(state, p.body.pos, A.parryColor, A.parryParticles, FX_SPEED, FX_LIFE, FX_SIZE);
  addMark(state, "parry", p.body.pos, FX_ATTACK.sprite.parryLife, A.parryColor);
  pushSfx(state, "counter");
  gainMana(state, PARRY.mana);
  noteRiposte(state, "parry", attacker);
  if (!attacker || attacker.hp <= 0) return;
  stopAttacker(state, attacker, bossPoise);
  onTraitCounter(state, attacker);
  pushEvent(state, { kind: "onCounter", actor: "player", source: { kind: "player", key: "counter" }, ...enemyTarget(attacker) });
}

/**
 * 攻撃した敵を止める。非ボスはコミット・強靭・堅守を無視して直に怯ませる（先送り中の怯みも清算する）。
 * ボス（と直に怯ませられない敵）は怯み値だけ入れる（ダウンのゲージに入るが、受け流しで毎回ダウンはしない）
 */
function stopAttacker(state: GameState, e: Enemy, bossPoise: number): void {
  if (!isBossClass(enemyDef(e.defKey)) && applyStagger(state, e, enemyCombat(e.defKey).staggerTime)) {
    e.poise.damage = 0;
    e.poise.pending = false;
    return;
  }
  addPoise(state, e, bossPoise * state.stats.poiseDamageMul, { ignoreSuperArmor: true, ignoreCommit: true });
}
