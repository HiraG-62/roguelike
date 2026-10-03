import { type GameState, type Player, pushSfx } from "../core/state";
import { scale, sub } from "../core/vec";
import { FEEL, WEAPON } from "../data/tuning";
import { type ButtonKey, type MovesetDef, type ThrowArtDef, firesByHand } from "../data/weapons";
import { addHeadLabel } from "./effects";
import { type HandIndex, magazineView, spendRounds, startReload } from "./magazine";
import { breakMoraleStreak, consumeBothHandsRelease, gainMorale } from "./morale";
import { noteRelease } from "./moments";
import { currentShot, emitShotRounds, fireHandVolley, isAttacking, isDashing, playerMoveset, startHandSwing } from "./player";
import { ultimateShot } from "./ultimates";
import { emitArtVolley } from "./weaponArts";

/**
 * 二丁拳銃の左右の手（docs/ideas/gun-bases-review.md 0-4・4-3 の 6）。左クリック = 左手、右クリック = 右手で、
 * それぞれの手の弾倉（system/magazine.ts）から 1 クリック 1 発撃つ。player.ts の onButtonPress が左右とも pressHand へ送る。
 * - 左右を交互に撃つと戦意「拍」（型 akimbo の alternateShot）が溜まり、同じ手が続くとそこで 0 へ途切れる
 * - 同じ手を続けて押すと技: 左は 2 回目 蹴り → 3 回目 回し蹴り（steps）、右は 2 回目 銃把打ち → 3 回目 回転撃ち（steps2）
 * - 弾倉が空で込めている手のクリックは銃把打ち（steps2 の emptyHandStrike。込めは止まらない）
 * - 先に押した手の 1 発から猶予（bothHandsSec）の中にもう片方を押すと、撃ち尽くし（両手の残りを扇へ。拍の段ぶん強い）
 * 連続の回数・最後の手・猶予は共有の段カウンタ（AttackState.step）ではなくここが持つ。数値は movesets/gunner.json の hands
 */

const H = WEAPON.movesets.gunner.hands;
/** 秒の比べで丸めの誤差に負けないための許容 */
const EPS = 1e-6;
/** 同じ手の連続の数え（1 = 射撃、2・3 = 技。4 回目はまた射撃から） */
const CHAIN_LENGTH = 3;
const LEFT: HandIndex = 0;
const RIGHT: HandIndex = 1;
const HANDS: readonly HandIndex[] = [LEFT, RIGHT];
/** 段の key（movesets/gunner.json の steps2） */
const BUTT_KEY = "gunnerButt";
const SPIN_KEY = "spinShot";
const EMPTY_KEY = "emptyHandStrike";
/** 左手の技の段（steps の添字） */
const KICK_STEP = 0;
const ROUND_KICK_STEP = 1;
/** 円周（度） */
const FULL_CIRCLE_DEG = 360;
const DEG_TO_RAD = Math.PI / 180;
/** 撃ち尽くしの合図の文字（docs/GLOSSARY.md「撃ち尽くし」） */
const UNLOAD_LABEL = "撃ち尽くし";

/** 押した手が出すもの */
export type HandAction = "shot" | "empty" | "kick" | "roundKick" | "butt" | "spin";

/** 手の出すものの表示名（HUD・指南書。docs/GLOSSARY.md） */
export const HAND_ACTION_NAME: Readonly<Record<HandAction, string>> = {
  shot: "射撃",
  empty: "銃把打ち",
  kick: "蹴り",
  roundKick: "回し蹴り",
  butt: "銃把打ち",
  spin: "回転撃ち",
};

/** 押した手の時刻 */
interface HandPress {
  readonly hand: HandIndex;
  readonly at: number;
}

/** 手の作業領域（state.time 基準） */
interface HandsState {
  /** 最後に出した押下の手（撃ち尽くしの後は空） */
  lastHand: HandIndex | undefined;
  lastAt: number;
  /** 最後の手を続けた回数（1..CHAIN_LENGTH） */
  count: number;
  /** 振りの最中・手の間に押した押下（覚えておき、出せるようになったら出す） */
  pending: HandPress | undefined;
  /** 撃ち尽くしの猶予を待っている先の 1 発 */
  opener: HandPress | undefined;
}

/**
 * Player ごとの手の作業領域。Player は run ごとに作り直されるので、同じ seed と入力列なら同じ流れになる（決定性）。
 * 共有の core/state.ts の型を広げずに済むよう WeakMap に持つ（読むだけの handsView / nextHandAction は作らない）
 */
const STATES = new WeakMap<Player, HandsState>();

function createHandsState(): HandsState {
  return { lastHand: undefined, lastAt: 0, count: 0, pending: undefined, opener: undefined };
}

function handsStateOf(p: Player): HandsState {
  const found = STATES.get(p);
  if (found) return found;
  const created = createHandsState();
  STATES.set(p, created);
  return created;
}

/** 手のレーン（左手 = 左クリック、右手 = 右クリック。Rule の lane 条件・双撃が読む） */
export function handLane(hand: HandIndex): ButtonKey {
  return hand === LEFT ? "primary" : "secondary";
}

/** その手で今撃てる弾の数（込めの最中は 0） */
function loadedRounds(state: GameState, hand: HandIndex): number {
  const h = magazineView(state).hands[hand];
  if (!h || h.busy) return 0;
  return h.rounds;
}

/** 手の弾倉が働かない（銃の器でない）なら弾は尽きない扱い */
function handLoaded(state: GameState, hand: HandIndex): boolean {
  if (!magazineView(state).active) return true;
  return loadedRounds(state, hand) > 0;
}

/** 次にその手を押したときの連続の回数（同じ手を chainSec の内に続けると増え、CHAIN_LENGTH の次は 1 へ戻る） */
function nextCount(hs: Readonly<HandsState>, hand: HandIndex, now: number): number {
  if (hs.lastHand !== hand || now - hs.lastAt > H.chainSec + EPS) return 1;
  return (hs.count % CHAIN_LENGTH) + 1;
}

/** 連続の回数と手の弾から、押した手が出すもの（純関数） */
export function handActionFor(hand: HandIndex, count: number, loaded: boolean): HandAction {
  if (count <= 1) return loaded ? "shot" : "empty";
  if (hand === LEFT) return count === 2 ? "kick" : "roundKick";
  if (count === 2) return "butt";
  // 回転撃ちは右手の残りを撒くので、弾が無ければ弾切れの銃把打ち
  return loaded ? "spin" : "empty";
}

/** 今その手を押すと出るもの（state を書き換えない。HUD・bot が読む） */
export function nextHandAction(state: GameState, hand: HandIndex): HandAction {
  const hs = STATES.get(state.player) ?? createHandsState();
  return handActionFor(hand, nextCount(hs, hand, state.time), handLoaded(state, hand));
}

export interface HandsView {
  /** 最後に押した手（連続が切れていれば undefined） */
  readonly lastHand: HandIndex | undefined;
  /** 最後の手を続けた回数（連続が切れていれば 0） */
  readonly count: number;
  /** 最後の押下からの秒（押していなければ無限） */
  readonly sinceLast: number;
}

/** 手の連続の様子（HUD・bot。state を書き換えない） */
export function handsView(state: GameState): HandsView {
  const hs = STATES.get(state.player);
  if (!hs || hs.lastHand === undefined) return { lastHand: undefined, count: 0, sinceLast: Number.POSITIVE_INFINITY };
  const since = state.time - hs.lastAt;
  const alive = since <= H.chainSec + EPS;
  return { lastHand: alive ? hs.lastHand : undefined, count: alive ? hs.count : 0, sinceLast: since };
}

/** 段の key の右レーンの添字（今の型に無ければ undefined） */
function laneIndexOf(moveset: MovesetDef, key: string): number | undefined {
  const i = moveset.steps2.findIndex((s) => s.key === key);
  return i < 0 ? undefined : i;
}

/** 回転撃ちの弾の段（右レーンの spinShot） */
function spinThrow(moveset: MovesetDef): ThrowArtDef | undefined {
  const s = moveset.steps2.find((x) => x.key === SPIN_KEY);
  return s?.kind === "volley" ? s.throw : undefined;
}

/** 押した手を今出せるか（振りの最中・撃つ手の間が明けていなければ覚えておく） */
function readyFor(state: GameState, hs: Readonly<HandsState>, hand: HandIndex): boolean {
  if (isAttacking(state.player)) return false;
  const action = handActionFor(hand, nextCount(hs, hand, state.time), handLoaded(state, hand));
  if (action !== "shot") return true;
  return (state.player.magazine.hands[hand]?.cooldown ?? 0) <= 0;
}

/**
 * 左右のクリックの押した瞬間（player.ts の onButtonPress から。左 = 手 0、右 = 手 1）。
 * ダッシュ中は反転撃ち（ダッシュ攻撃）の予約、猶予の中のもう片方の手は撃ち尽くし、出せなければ覚えておく
 */
export function pressHand(state: GameState, hand: HandIndex): void {
  const p = state.player;
  if (isDashing(p)) {
    p.dashAttackQueued = true;
    return;
  }
  const hs = handsStateOf(p);
  if (tryUnload(state, hs, hand)) return;
  if (!readyFor(state, hs, hand)) {
    hs.pending = { hand, at: state.time };
    return;
  }
  hs.pending = undefined;
  act(state, hs, hand);
}

/**
 * 毎ステップ（player.ts の readActions。攻撃を出せる間だけ）。覚えておいた押下を、出せるようになったら出す。
 * bufferSec を過ぎた押下と、二丁拳銃でなくなった後の押下は捨てる
 */
export function tickDualPistols(state: GameState): void {
  const hs = STATES.get(state.player);
  const pending = hs?.pending;
  if (!hs || !pending) return;
  if (!firesByHand(playerMoveset(state)) || state.time - pending.at > H.bufferSec + EPS) {
    hs.pending = undefined;
    return;
  }
  if (isDashing(state.player) || !readyFor(state, hs, pending.hand)) return;
  hs.pending = undefined;
  act(state, hs, pending.hand);
}

/** 押下を出す: 連続を数え、同じ手が続けば拍を途切れさせ、連続の回数の技・射撃・弾切れの銃把打ちを出す */
function act(state: GameState, hs: HandsState, hand: HandIndex): void {
  const now = state.time;
  const count = nextCount(hs, hand, now);
  const previous = hs.lastHand;
  hs.lastHand = hand;
  hs.lastAt = now;
  hs.count = count;
  hs.opener = undefined;
  // 同じ手が続いた（連続が切れていても）ら拍はそこで途切れる
  if (previous === hand) breakMoraleStreak(state, "alternateShot");
  const action = handActionFor(hand, count, handLoaded(state, hand));
  if (action === "shot") {
    if (!fireHandVolley(state, hand)) return;
    if (previous !== undefined && previous !== hand) gainMorale(state, "alternateShot");
    hs.opener = { hand, at: now };
    return;
  }
  runTechnique(state, hand, action);
}

/** 射撃以外（技・弾切れの銃把打ち） */
function runTechnique(state: GameState, hand: HandIndex, action: Exclude<HandAction, "shot">): void {
  const moveset = playerMoveset(state);
  switch (action) {
    case "kick":
      startHandSwing(state, "primary", KICK_STEP, false);
      return;
    case "roundKick":
      startHandSwing(state, "primary", ROUND_KICK_STEP, true);
      return;
    case "butt":
      swingLaneKey(state, moveset, BUTT_KEY, false);
      return;
    case "empty":
      swingLaneKey(state, moveset, EMPTY_KEY, false);
      return;
    case "spin":
      if (!spinShot(state, moveset, hand)) swingLaneKey(state, moveset, EMPTY_KEY, false);
      return;
  }
}

/** 右レーンの key の振りを振る（今の型に無ければ何もしない） */
function swingLaneKey(state: GameState, moveset: MovesetDef, key: string, finisher: boolean): void {
  const index = laneIndexOf(moveset, key);
  if (index !== undefined) startHandSwing(state, "secondary", index, finisher);
}

/**
 * 回転撃ち: 回りながらその手の弾倉の残りを全部、全周へ等間隔に撒く（弾倉の 1 発あたり throw.count 発）。撒いたら true
 */
function spinShot(state: GameState, moveset: MovesetDef, hand: HandIndex): boolean {
  const t = spinThrow(moveset);
  if (!t) return false;
  const spent = spendRounds(state, hand, loadedRounds(state, hand));
  if (spent <= 0) return false;
  const count = spent * Math.max(1, t.count);
  return emitArtVolley(state, t, { count, spreadDeg: FULL_CIRCLE_DEG / count, lane: handLane(hand) });
}

/**
 * 撃ち尽くし: 先の 1 発（opener）から猶予の中にもう片方の手を押した。両手の弾倉の残りを一気に扇へ撃ち、
 * 拍をすべて使って段ぶん強める（0 でも撃てる）。先の 1 発は撃ち尽くしの 1 発に数え、撃ち直さない。
 * 撃ち終えると両手とも込めへ。撃てる弾が無ければ普通の押下として扱う（false）
 */
function tryUnload(state: GameState, hs: HandsState, hand: HandIndex): boolean {
  const opener = hs.opener;
  if (!opener || opener.hand === hand || state.time - opener.at > H.bothHandsSec + EPS) return false;
  const rounds = HANDS.map((h) => loadedRounds(state, h));
  if (rounds.every((n) => n <= 0)) return false;
  hs.opener = undefined;
  hs.pending = undefined;
  hs.lastHand = undefined;
  hs.count = 0;
  unload(state, rounds);
  return true;
}

/** 両手の残り rounds を、左手は扇の左半分・右手は右半分として 1 つの扇に撃つ */
function unload(state: GameState, rounds: readonly number[]): void {
  const r = consumeBothHandsRelease(state);
  if (r) noteRelease(state, r.units);
  const shot = ultimateShot(state, currentShot(state.stats));
  const release = r && r.units > 0 ? { release: { finisher: r.finisher, crit: r.crit } } : {};
  const left = rounds[LEFT] ?? 0;
  const right = rounds[RIGHT] ?? 0;
  for (const hand of HANDS) {
    const spent = spendRounds(state, hand, hand === LEFT ? left : right);
    if (spent <= 0) continue;
    // 1 つの扇の中の位置: 左手は右手の数の半分だけ左、右手は左手の数の半分だけ右へ中心をずらす
    const shift = hand === LEFT ? -right / 2 : left / 2;
    emitShotRounds(
      state,
      shot,
      { count: spent, spreadDeg: H.unload.spreadDeg },
      {
        lane: handLane(hand),
        hand,
        damageMul: H.unload.damageMul * (r?.mul.damageMul ?? 1),
        pierceBonus: r?.mul.pierceAdd ?? 0,
        angleOffset: shift * H.unload.spreadDeg * DEG_TO_RAD,
        recoil: false,
        steady: true,
        ...release,
      },
    );
  }
  // 撃ち切った手は spendRounds が込め始める。残りが無く撃たなかった手も込めへ
  for (const hand of HANDS) startReload(state, hand);
  const p = state.player;
  p.knock = sub(p.knock, scale(p.facing, H.unload.selfKnock));
  addHeadLabel(state, p.body.pos, UNLOAD_LABEL, FEEL.branchTextColor, FEEL.branchTextLife);
  pushSfx(state, "branch");
}
