import type { FrameInput } from "../core/input";
import type { Rule } from "../core/rules";
import { type Enemy, type GameState, type Projectile, pushLog, pushSfx } from "../core/state";
import { type Vec, add, dist, normalize, scale, sub } from "../core/vec";
import { REFORGE_KEYS, REFORGES, type ReforgeFlag, type ReforgeKey, hasReforgeFlag, isOfferable, reforgeRulesOf } from "../data/reforges";
import { REFORGE } from "../data/tuning";
import { type FormKey, formOfKey } from "../data/weaponForms";
import { MOVESETS } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { cardIndexAt } from "./boons";
import { finishReloadNow } from "./magazine";
import { gainMorale } from "./morale";

/**
 * 改鋳の 3 択と、改鋳の挙動の切り替え（docs/ideas/weapon-forms-impl.md 3-6）。
 * 3 択は祝福の 3 択（system/boons.ts の boonChoice）と同じ入力経路: 提示中は core/game.ts の step が止まり、
 * updateReforgeChoice が skill1〜3 / クリックを読む（リプレイは入力列だけで再現できる）。
 * 改鋳の中身（段・戦意・Rule）は data/reforges.ts。ここは出し方・選び方と、flags の挙動
 */

export interface ReforgeChoice {
  options: ReforgeKey[];
  /** カーソルが乗っている札（無ければ -1） */
  hover: number;
  /** 提示からの秒（REFORGE.inputDelay までは入力を受けない） */
  timer: number;
}

/** 札ごとの選ぶ入力（祝福の 3 択と同じ並び: スキル 1・スキル 2・攻撃） */
const PICK_SECOND = 1;
const PICK_THIRD = 2;

/** 装備の武器種の型（旧形式の stats でも落ちないよう剣へ） */
function equippedForm(state: GameState): FormKey {
  return formOfKey((MOVESETS[state.stats.moveset] ?? MOVESETS.sword).key).key;
}

/** 装備の型に合う改鋳がこの挙動の切り替えを持つか */
export function hasFlag(state: GameState, flag: ReforgeFlag): boolean {
  return state.reforges.length > 0 && hasReforgeFlag(equippedForm(state), state.reforges, flag);
}

/** 改鋳の Rule（system/rules.ts の collectRules が武器種の固有効果の後に足す）。持ち替えた型の改鋳は集めない */
export function reforgeRules(state: GameState): Rule[] {
  if (state.reforges.length === 0) return [];
  return reforgeRulesOf(equippedForm(state), state.reforges);
}

// ---------------------------------------------------------------------------
// 3 択
// ---------------------------------------------------------------------------

/** rng で並べ替えた写し（Fisher–Yates。決定性のため state.rng だけを使う） */
function shuffled<T>(state: GameState, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = state.rng.int(0, i);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * 3 択の候補。まだ取っていない改鋳のうち、装備中の型のものを先に、足りなければ他の型のもので埋める
 * （持ち替えに賭ける札。型に武器種が無い改鋳は出さない）
 */
export function rollReforgeOptions(state: GameState): ReforgeKey[] {
  const form = equippedForm(state);
  const pool = REFORGE_KEYS.filter((k) => !state.reforges.includes(k) && isOfferable(k));
  const own = shuffled(state, pool.filter((k) => REFORGES[k].form === form));
  const others = shuffled(state, pool.filter((k) => REFORGES[k].form !== form));
  return [...own, ...others].slice(0, REFORGE.offerCount);
}

/** 5 の倍数の階のボスの撃破（system/boss.ts の onBossDeath）。1 ランの上限まで 3 択を出す */
export function offerReforges(state: GameState): void {
  if (state.reforgeChoice || state.reforges.length >= REFORGE.perRun) return;
  const options = rollReforgeOptions(state);
  if (options.length === 0) return;
  state.reforgeChoice = { options, hover: -1, timer: 0 };
  pushSfx(state, "boonOffer");
}

/** 入力から選んだ札。祝福の 3 択と同じ: スキル 1 / パッドの決定 = 1 枚目、スキル 2 = 2 枚目、攻撃 = 3 枚目、クリック = 札の上。無ければ -1 */
function selectedIndex(input: FrameInput, hover: number): number {
  if (input.skill1Pressed || input.padConfirmPressed) return 0;
  if (input.skill2Pressed) return PICK_SECOND;
  // クリックと attackPressed は同じ元なので、クリックなら札の判定だけを使う
  if (input.clickPressed) return hover;
  if (input.attackPressed) return PICK_THIRD;
  return -1;
}

/** 選択中の 1 ステップ（step から呼ぶ。他の更新は止まっている） */
export function updateReforgeChoice(state: GameState, input: FrameInput, dt: number): void {
  const c = state.reforgeChoice;
  if (!c) return;
  c.timer += dt;
  c.hover = input.aimScreen ? cardIndexAt(input.aimScreen, c.options.length) : -1;
  if (c.timer < REFORGE.inputDelay) return;
  const index = selectedIndex(input, c.hover);
  if (index < 0 || index >= c.options.length) return;
  chooseReforge(state, index);
}

export function chooseReforge(state: GameState, index: number): void {
  const key = state.reforgeChoice?.options[index];
  state.reforgeChoice = null;
  if (key !== undefined) grantReforge(state, key);
}

/** 改鋳を得る（テストからも直接使う）。取得済みなら何もしない */
export function grantReforge(state: GameState, key: ReforgeKey): void {
  if (state.reforges.includes(key)) return;
  state.reforges.push(key);
  const def = REFORGES[key];
  pushLog(state, `改鋳: ${def.name} - ${def.desc}`, REFORGE.textColor);
  pushSfx(state, "boonSelect");
}

// ---------------------------------------------------------------------------
// 挙動の切り替え（system/morale.ts から呼ぶ）
// ---------------------------------------------------------------------------

/** 毎ステップ（system/morale.ts の tickMorale の頭）。込めの最中のダッシュと設置弾の這い寄り */
export function tickReforges(state: GameState): void {
  if (state.reforges.length === 0) return;
  if (hasFlag(state, "dashReload")) dashReload(state);
  if (hasFlag(state, "minesCling")) clingMines(state);
}

/**
 * 疾駆: 込めの最中にダッシュすると、その場で込め終わる（system/magazine.ts）。primes なら早込めが決まったことにもする
 * （戦意への反映は型の早込めの出来事。段 3）
 */
function dashReload(state: GameState): void {
  if (state.player.dashTimer <= 0 || !finishReloadNow(state)) return;
  if (REFORGE.pistol.pistolDash.primes) gainMorale(state, "quickReload");
}

/** 床に据えた自分の設置弾（曲射は山なりに飛んでいるので除く） */
function isOwnMine(pr: Projectile): boolean {
  if (pr.owner !== "player" || pr.life <= 0 || !pr.shot || pr.shot.detonated) return false;
  return BULLETS[pr.shot.key]?.mine !== undefined;
}

function nearestEnemy(state: GameState, pos: Vec, range: number): Enemy | undefined {
  let best: Enemy | undefined;
  let bestDist = range;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden) continue;
    const d = dist(pos, e.body.pos);
    if (d > bestDist) continue;
    best = e;
    bestDist = d;
  }
  return best;
}

/** 吸着: 設置弾が range の内の最も近い敵へ speed で這い寄る（速さを毎ステップ向け直す。設置弾の減速は projectiles.ts） */
function clingMines(state: GameState): void {
  const r = REFORGE.artillery.artilleryCling;
  for (const pr of state.projectiles) {
    if (!isOwnMine(pr)) continue;
    const target = nearestEnemy(state, pr.pos, r.range);
    if (!target) continue;
    pr.vel = scale(normalize(sub(target.body.pos, pr.pos)), r.speed);
  }
}

/** 騎射: 動いている間に狙いが溜まる速さ（止まっているときの速さに掛ける倍率）。改鋳が無ければ 0（動くと減る） */
export function movingAimGainMul(state: GameState): number {
  return hasFlag(state, "aimWhileMoving") ? REFORGE.rifle.rifleStride.movingGainMul : 0;
}

/** 飛んでいる自分の武器の弾（床の設置弾・山なりの曲射は除く） */
function isFlyingOwnShot(pr: Projectile): boolean {
  if (pr.owner !== "player" || pr.life <= 0 || pr.lane === undefined) return false;
  const def = pr.shot ? BULLETS[pr.shot.key] : undefined;
  return def === undefined || (def.mine === undefined && def.lob === undefined);
}

/** 牽引: 投具の放出（呼び戻し・投げ放ち）で、いちばん遠くを飛ぶ自分の刃の方へ引き寄せられる */
export function pullTowardShots(state: GameState): void {
  if (!hasFlag(state, "pullToShots")) return;
  const r = REFORGE.thrower.throwerPull;
  const p = state.player;
  let far: Projectile | undefined;
  let farDist = r.minDistance;
  for (const pr of state.projectiles) {
    if (!isFlyingOwnShot(pr)) continue;
    const d = dist(p.body.pos, pr.pos);
    if (d <= farDist) continue;
    far = pr;
    farDist = d;
  }
  if (!far) return;
  p.knock = add(p.knock, scale(normalize(sub(far.pos, p.body.pos)), r.pullSpeed));
}
