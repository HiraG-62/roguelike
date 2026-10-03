import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { type Vec, add, normalize, scale, sub } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { enemyDef } from "../data/enemies";
import { MANUAL } from "../data/tuning";
import { type ButtonKey, type MovesetKey, shootsPrimary } from "../data/weapons";
import { chooseUltimate } from "../loot/profile";
import { createEmptyProfile } from "../loot/types";
import { type DemoArena, buildDemoArena } from "../map/demoArena";
import { createDefaultSkillProfile } from "../skills/persistence";
import { updateCamera } from "./camera";
import { createEnemy } from "./enemies";
import { borrowWeapon } from "./hub";
import { currentForm, isReloading, moraleMax } from "./morale";
import { isDashing, latchFrozenInput, playerMoveset } from "./player";
import { createSandboxState, simulateSandbox } from "./sandbox";
import { DUMMY_KEY } from "./specialRooms";

/**
 * 武器指南書の実演（docs/ideas/weapon-manual.md）。稽古場の箱庭（system/sandbox.ts）に木人を 1 体立て、
 * 技の入力の台本（DemoScript）を本物の FrameInput にして 1 ステップずつ流す。描画は本編と同じ絵（render が state を読むだけ）。
 * 台本は「押せる瞬間」を state から読んで次の入力を出すので、段の秒数が JSON で変わっても台本を直さなくてよい。
 * 乱数は箱庭の state.rng と固定の seed だけ（決定的。同じ台本なら毎回同じ動き）
 */

/** 入力の後に待つ条件（台本の waitUntil / holdUntil） */
export type DemoCondition =
  /** 撃ち切って装填中（短銃の戦意） */
  | "reloading"
  /** 装填の拍（強装填を押せる窓）に入った */
  | "reloadPrime"
  /** 振り・溜め・構え・持続の奥義がすべて終わった */
  | "idle"
  /** idle で、連撃の段と入力の列も 1 段目へ戻った（下ごしらえの連撃の後、見せる手を 1 段目から始める） */
  | "fresh";

/** 台本の 1 手。表示の入力の札（meta/weaponManual.ts の cueToken）は待ちと hidden の手を除いて 1 対 1 */
export type DemoCue =
  /** 押して離す（次の押下を受けられるまで待ってから）。hidden = 表示の札にしない手（持続の奥義の間に振って見せる連撃） */
  | { readonly kind: "tap"; readonly button: ButtonKey; readonly hidden?: boolean }
  /** sec 秒押し続けて離す（溜め・構え・射撃） */
  | { readonly kind: "hold"; readonly button: ButtonKey; readonly sec: number; readonly hidden?: boolean }
  /** 条件を満たすまで押し続けて離す */
  | { readonly kind: "holdUntil"; readonly button: ButtonKey; readonly until: DemoCondition; readonly maxSec: number }
  /** 木人の方へダッシュ */
  | { readonly kind: "dash" }
  /** 奥義キー */
  | { readonly kind: "special" }
  | { readonly kind: "wait"; readonly sec: number }
  | { readonly kind: "waitUntil"; readonly until: DemoCondition; readonly maxSec: number };

/** 実演の前の下ごしらえ（state を作った直後に 1 回） */
export interface DemoSetup {
  /** 戦意を満たしておく（溜め込む型だけ。導出の型は prelude で溜める） */
  readonly moraleFull?: boolean;
  /** 奥義ゲージを満たし、この奥義を選んでおく（`<武器種>.<名前>`） */
  readonly ultimate?: string;
  /** 木人までの距離（px。省略は MANUAL.foeDistance） */
  readonly foeDistance?: number;
}

export interface DemoScript {
  readonly setup: DemoSetup;
  /** 見せる入力の前の下ごしらえの手（導出の戦意を溜める連撃など）。表示の入力の列には出さない */
  readonly prelude?: readonly DemoCue[];
  readonly cues: readonly DemoCue[];
}

/** 台本を読む手の作業領域。stage 0 = 押せるのを待つ / 1 = 押している / 2 = 離した */
interface DemoDriver {
  index: number;
  stage: 0 | 1 | 2;
  /** 今の手に入ってからの秒 */
  timer: number;
  /** 押し始めてからの秒（hold） */
  held: number;
  /** すべての手を終えてからの秒 */
  tail: number;
}

export interface DemoSession {
  readonly moveset: MovesetKey;
  readonly script: DemoScript;
  /** 稽古場の地図は作り直さずに使い回す（描画のチャンクを焼き直させない） */
  readonly arena: DemoArena;
  readonly hitstopScale: number;
  state: GameState;
  foeId: number;
  driver: DemoDriver;
  /** 台本を最初からやり直した回数 */
  loops: number;
}

/** 実演の箱庭の seed（固定。乱数は箱庭の中だけ） */
const DEMO_SEED = 0x5eed;
/** 借りた器の作られた時刻（Date.now の代わり。保存しないので固定でよい） */
const LOAN_NOW = 0;

function allCues(script: DemoScript): DemoCue[] {
  return [...(script.prelude ?? []), ...script.cues];
}

function createDriver(): DemoDriver {
  return { index: 0, stage: 0, timer: 0, held: 0, tail: 0 };
}

/** 実演の箱庭を作る。武器種の一番早い器を借りて持たせ、木人を正面に立てる */
export function createManualDemo(moveset: MovesetKey, script: DemoScript, hitstopScale = 1, arena: DemoArena = buildDemoArena()): DemoSession {
  const session: DemoSession = { moveset, script, arena, hitstopScale, state: buildDemoState(moveset, script, arena, hitstopScale), foeId: 0, driver: createDriver(), loops: 0 };
  session.foeId = placeFoe(session);
  return session;
}

function buildDemoState(moveset: MovesetKey, script: DemoScript, arena: DemoArena, hitstopScale: number): GameState {
  const profile = createEmptyProfile();
  borrowWeapon(profile, moveset, LOAN_NOW);
  const ult = script.setup.ultimate;
  if (ult !== undefined) chooseUltimate(profile, moveset, ult);
  const start = { x: arena.center.x - foeDistanceOf(script) / 2, y: arena.center.y };
  const state = createSandboxState({ profile, skillProfile: createDefaultSkillProfile(), map: arena.map, start, seed: DEMO_SEED, hitstopScale });
  const p = state.player;
  p.facing = { x: 1, y: 0 };
  if (ult !== undefined) p.energy = p.maxEnergy;
  if (script.setup.moraleFull === true && !currentForm(state).morale.derived) p.morale.value = moraleMax(state);
  return state;
}

function foeDistanceOf(script: DemoScript): number {
  return script.setup.foeDistance ?? MANUAL.foeDistance;
}

/** 木人を立てる（倒れない体力にして、撃破数・ドロップに数えない印を付ける）。置いた敵の id */
function placeFoe(session: DemoSession): number {
  const { state, arena, script } = session;
  const pos = { x: arena.center.x + foeDistanceOf(script) / 2, y: arena.center.y };
  const e = createEnemy(state, enemyDef(DUMMY_KEY), pos, 0, false);
  e.revived = true;
  e.maxHp = MANUAL.foeHp;
  e.hp = MANUAL.foeHp;
  state.enemies.push(e);
  return e.id;
}

/** 台本を最初からやり直す（state を作り直す。稽古場の地図はそのまま） */
export function restartManualDemo(session: DemoSession): void {
  session.state = buildDemoState(session.moveset, session.script, session.arena, session.hitstopScale);
  session.foeId = placeFoe(session);
  session.driver = createDriver();
  session.loops += 1;
}

/** 実演の 1 固定ステップ。台本の手から入力を作って箱庭を進め、終えて眺め終わったら最初からやり直す */
export function stepManualDemo(session: DemoSession, dt: number): void {
  const input = driverInput(session, dt);
  stepDemoState(session.state, input, dt);
  topUp(session.state);
  if (demoFinished(session)) restartManualDemo(session);
}

function stepDemoState(state: GameState, input: FrameInput, dt: number): void {
  if (state.hitstop > 0) {
    state.hitstop -= 1;
    latchFrozenInput(state, input);
    updateCamera(state, dt, VIEW_W, VIEW_H);
    return;
  }
  simulateSandbox(state, input, dt, true);
}

/** 気力と生命は満たし続ける（資源切れで技が出ない実演にしない） */
function topUp(state: GameState): void {
  const p = state.player;
  p.mana = state.stats.maxMana;
  p.hp = p.maxHp;
}

/** 台本の表示の手のうち、今の手（cues の添字）。下ごしらえの間は -1、終えた後は cues.length */
export function demoCueIndex(session: DemoSession): number {
  const pre = session.script.prelude?.length ?? 0;
  return session.driver.index - pre;
}

/** 今の手が押し続ける手（hold）なら、押している割合（0..1）。押していない・押し続けない手は null */
export function demoHoldRatio(session: DemoSession): number | null {
  const d = session.driver;
  const cue = allCues(session.script)[d.index];
  if (cue?.kind !== "hold" || d.stage !== 1) return null;
  return cue.sec > 0 ? Math.min(1, d.held / cue.sec) : 1;
}

/** すべての手を終え、眺める秒も過ぎて、技が出終わった */
function demoFinished(session: DemoSession): boolean {
  const d = session.driver;
  if (d.index < allCues(session.script).length) return false;
  if (d.tail < MANUAL.tailSec) return false;
  return d.tail >= MANUAL.tailSec + MANUAL.tailMaxExtraSec || conditionMet(session.state, "idle");
}

// ---------------------------------------------------------------------------
// 木人の距離の合わせ込み
// ---------------------------------------------------------------------------

/** 実演で確かめること。hit = 木人に当たる / release = 戦意を放つ / none = 確かめない（受け流しの構え） */
export type DemoExpect = "hit" | "release" | "none";

/** 台本を 1 周だけ画面に出さずに回した結果 */
export interface DemoOutcome {
  hit: boolean;
  release: boolean;
}

/** 1 周を回す上限の秒（撃ち切りを待つ台本でも収まる長さ） */
const OUTCOME_MAX_SEC = 14;

/** 台本を 1 周だけ回し、木人に当たったか・戦意を放ったかを返す（描画しない。決定的） */
export function demoOutcome(moveset: MovesetKey, script: DemoScript, arena: DemoArena): DemoOutcome {
  const session = createManualDemo(moveset, script, 1, arena);
  const out: DemoOutcome = { hit: false, release: false };
  const steps = Math.ceil(OUTCOME_MAX_SEC / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    stepManualDemo(session, FIXED_DT);
    if (session.loops > 0) break;
    const foe = session.state.enemies.find((e) => e.id === session.foeId);
    if (foe !== undefined && foe.hp < foe.maxHp) out.hit = true;
    if (session.state.recent.onRelease !== undefined) out.release = true;
  }
  return out;
}

function meets(outcome: DemoOutcome, expect: DemoExpect): boolean {
  if (expect === "hit") return outcome.hit;
  if (expect === "release") return outcome.release;
  return true;
}

/**
 * 実演が expect を満たす木人の距離を探す（台本の距離 → MANUAL.foeDistanceCandidates の近い順）。
 * 段の届き・反動・弾の寿命は武器ごとに違い、定義から距離を決めきれないので、実際に回して確かめる。
 * どれでも満たさなければ台本の距離のまま（undefined）
 */
export function calibrateFoeDistance(moveset: MovesetKey, script: DemoScript, expect: DemoExpect, arena: DemoArena): number | undefined {
  if (expect === "none") return script.setup.foeDistance;
  const first = foeDistanceOf(script);
  const candidates = [first, ...[...MANUAL.foeDistanceCandidates].sort((a, b) => Math.abs(a - first) - Math.abs(b - first))];
  for (const d of candidates) {
    const trial: DemoScript = { ...script, setup: { ...script.setup, foeDistance: d } };
    if (meets(demoOutcome(moveset, trial, arena), expect)) return d;
  }
  return script.setup.foeDistance;
}

// ---------------------------------------------------------------------------
// 台本の手 → FrameInput
// ---------------------------------------------------------------------------

function driverInput(session: DemoSession, dt: number): FrameInput {
  const cues = allCues(session.script);
  const d = session.driver;
  const cue = cues[d.index];
  const base = idleInput(session);
  if (cue === undefined) {
    d.tail += dt;
    return base;
  }
  d.timer += dt;
  const prev = cues[d.index - 1];
  return cueInput(session, cue, prev, base, dt);
}

function cueInput(session: DemoSession, cue: DemoCue, prev: DemoCue | undefined, base: FrameInput, dt: number): FrameInput {
  const { state, driver: d } = session;
  switch (cue.kind) {
    case "wait":
      if (d.timer >= cue.sec) advance(d);
      return base;
    case "waitUntil":
      if (conditionMet(state, cue.until) || d.timer >= cue.maxSec) advance(d);
      return base;
    case "special":
      advance(d);
      return { ...base, specialPressed: true };
    case "dash":
      if (!readyOrTimedOut(state, prev, d, "primary")) return base;
      advance(d);
      return { ...base, dashPressed: true, move: towardFoe(session) };
    case "tap":
      return pressInput(session, cue.button, prev, base, dt, () => false);
    case "hold":
      return pressInput(session, cue.button, prev, base, dt, () => d.held < cue.sec);
    case "holdUntil":
      return pressInput(session, cue.button, prev, base, dt, () => !conditionMet(state, cue.until) && d.held < cue.maxSec);
  }
}

/**
 * 押す手（tap / hold）。押せるまで待ち → 押した最初のステップは「押した瞬間」も立てる → keep が false になるまで押し続け →
 * 1 ステップ離してから次の手へ（右は前ステップとの差で押した瞬間を取るので、離すステップが要る）
 */
function pressInput(session: DemoSession, button: ButtonKey, prev: DemoCue | undefined, base: FrameInput, dt: number, keep: () => boolean): FrameInput {
  const { state, driver: d } = session;
  if (d.stage === 0) {
    if (!readyOrTimedOut(state, prev, d, button)) return base;
    d.stage = 1;
    d.held = 0;
    return withButton(base, button, true);
  }
  if (d.stage === 1) {
    // 押している秒は止め（ヒットストップ）の間も進める（実時間で押し続けるのと同じ）
    d.held += dt;
    if (keep()) return withButton(base, button, false);
    d.stage = 2;
    return base;
  }
  advance(d);
  return base;
}

function withButton(base: FrameInput, button: ButtonKey, pressed: boolean): FrameInput {
  if (button === "primary") return { ...base, attackPressed: pressed, attackHeld: true };
  return { ...base, shootHeld: true };
}

function advance(d: DemoDriver): void {
  d.index += 1;
  d.stage = 0;
  d.timer = 0;
  d.held = 0;
}

function readyOrTimedOut(state: GameState, prev: DemoCue | undefined, d: DemoDriver, button: ButtonKey): boolean {
  return readyForPress(state, prev, button) || d.timer >= MANUAL.readyTimeoutSec;
}

/**
 * 次の押下を受けられる瞬間か。振りの戻り（recover）か振っていないときで、先行入力・予約中の派生・溜め・
 * 弾の段の後の間・受け流しの硬直が無いとき。ダッシュの直後の手（ダッシュ攻撃）はダッシュ中でも押す
 */
export function readyForPress(state: GameState, prev: DemoCue | undefined, button: ButtonKey): boolean {
  const p = state.player;
  const a = p.attack;
  if (state.hitstop > 0) return false;
  if (isDashing(p)) return prev?.kind === "dash";
  if (a.charging || a.buffered) return false;
  if (a.pendingBranch >= 0 && a.phase !== "none") return false;
  if (p.art.cooldown > 0 || p.art.recover > 0 || p.parry.recover > 0) return false;
  // 左で撃つ武器種の左（射撃）は振りの最中に押しても派生の列に入らないので、振り終えてから押す
  if (button === "primary" && shootsPrimary(playerMoveset(state))) return a.phase === "none";
  return a.phase === "none" || a.phase === "recover";
}

function conditionMet(state: GameState, cond: DemoCondition): boolean {
  const p = state.player;
  switch (cond) {
    case "reloading":
      return isReloading(state);
    case "reloadPrime":
      return reloadPrimeOpen(state);
    case "idle":
      return p.attack.phase === "none" && !p.attack.charging && !p.art.holding && p.ultimate.active === null && !isDashing(p);
    case "fresh":
      return conditionMet(state, "idle") && p.attack.step === 0 && p.attack.inputs.length === 0;
  }
}

/** 装填の窓のうち、強装填を押せる拍（FORM.pistol.reload の primeFrom〜primeTo）に入ったか */
function reloadPrimeOpen(state: GameState): boolean {
  const release = currentForm(state).morale.release;
  if (release.kind !== "reload" || !isReloading(state)) return false;
  const elapsed = release.windowSec - state.player.morale.window;
  return elapsed >= release.primeFrom && elapsed <= release.primeTo;
}

// ---------------------------------------------------------------------------
// 照準（木人へ向ける）
// ---------------------------------------------------------------------------

function foeOf(session: DemoSession): { body: { pos: Vec } } | undefined {
  return session.state.enemies.find((e) => e.id === session.foeId && e.hp > 0);
}

/** 照準の先（木人。居なければ正面） */
function aimWorld(session: DemoSession): Vec {
  const foe = foeOf(session);
  if (foe) return foe.body.pos;
  const p = session.state.player;
  return add(p.body.pos, scale(p.facing, MANUAL.foeDistance));
}

function towardFoe(session: DemoSession): Vec {
  return normalize(sub(aimWorld(session), session.state.player.body.pos));
}

/** 何も押さない入力（照準だけ木人へ）。照準は画面座標なので、本編の screenToWorld の逆でカメラから戻す */
function idleInput(session: DemoSession): FrameInput {
  const cam = session.state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  const w = aimWorld(session);
  return { ...EMPTY_INPUT, move: { x: 0, y: 0 }, aimScreen: { x: w.x + ox, y: w.y + oy } };
}
