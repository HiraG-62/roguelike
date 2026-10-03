import type { FrameInput } from "../core/input";
import { type GameState, type MagazineHand, type MagazineState, pushSfx } from "../core/state";
import { WEAPON } from "../data/tuning";
import { type BulletDef, MOVESETS, MOVESET_KEYS, type MovesetDef, type MovesetKey, isGun } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import type { PlayerStats } from "../loot/types";
import { gainMorale } from "./morale";

/**
 * 銃の弾倉（docs/ideas/gun-bases-review.md 0-3・2-8）。戦意とは別に、銃の器ごとの容量だけ撃てて、撃ち切ると込める。
 * 弾倉は引き金を引いた回数で数える（散弾の粒・三点の 3 本は 1 回）。込めの最中は撃てない（砲は 1 発込めた後なら込めを止めて撃てる）。
 * 込めは振り・ダッシュの最中も進み、近接で止まらない。足は込めの最中だけ武器種の reloadMoveMul 倍。
 * 短銃の早込め（込めの最中の押下が窓の中なら即込め終わり）と砲の詰め（満ちた後も押し続けて段を溜める）の数えもここ。
 * 戦意への反映は型の出来事（quickReload / pack）として gainMorale へ渡すだけ（効き目は型が決める）。
 * 数値は WEAPON.bullets.<器>.magazine と WEAPON.movesets.<武器種> の reloadMoveMul / quickReload / pack
 */

/** 弾倉の手（0 = 普段の手。二丁拳銃だけ 1 も使う） */
export type HandIndex = 0 | 1;

type MagazineDef = NonNullable<BulletDef["magazine"]>;

/** 早込めの窓。from は込めの進みの割合（0..1）、sec は窓の秒、missSec は窓の外で押したときに込めが延びる秒 */
export interface QuickReloadDef {
  readonly from: number;
  readonly sec: number;
  readonly missSec: number;
}

/** 砲の詰め。levelSec ごとに 1 段、max 段まで */
export interface PackDef {
  readonly levelSec: number;
  readonly max: number;
}

/** 銃の武器種の弾倉まわりの数値（movesets/<武器種>.json） */
interface GunNumbers {
  readonly reloadMoveMul: number;
  readonly quickReload?: QuickReloadDef;
  readonly pack?: PackDef;
}

/** 早込めの押下の結果（hit = 窓の中で即込め終わり / miss = 窓の外で込めが延びた / none = 早込めにならない押下） */
export type QuickReloadResult = "hit" | "miss" | "none";

/** 左右の手で別の弾倉を持つ武器種 */
const TWO_HANDED: ReadonlySet<MovesetKey> = new Set<MovesetKey>(["gunner"]);
const ONE_HAND: readonly HandIndex[] = [0];
const BOTH_HANDS: readonly HandIndex[] = [0, 1];
/** dt の足し引きの丸めで 1 ステップ遅れないための許容 */
const EPS = 1e-6;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readNumber(raw: Record<string, unknown>, key: string, where: string): number {
  const v = raw[key];
  if (typeof v !== "number") throw new Error(`弾倉の数値 ${key} が無い（${where}）`);
  return v;
}

function readQuickReload(raw: unknown, where: string): QuickReloadDef | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error(`不正な quickReload（${where}）`);
  return { from: readNumber(raw, "from", where), sec: readNumber(raw, "sec", where), missSec: readNumber(raw, "missSec", where) };
}

function readPack(raw: unknown, where: string): PackDef | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error(`不正な pack（${where}）`);
  return { levelSec: readNumber(raw, "levelSec", where), max: readNumber(raw, "max", where) };
}

/** 銃の武器種の数値（JSON の形は武器種ごとに違うので、ここで読んで型を揃える。銃なのに足の倍率が無ければデータの誤り） */
function readGunNumbers(): Partial<Record<MovesetKey, GunNumbers>> {
  const out: Partial<Record<MovesetKey, GunNumbers>> = {};
  for (const key of MOVESET_KEYS) {
    if (!isGun(MOVESETS[key])) continue;
    const raw: unknown = WEAPON.movesets[key];
    if (!isRecord(raw)) throw new Error(`武器種の数値が無い: ${key}`);
    const quickReload = readQuickReload(raw.quickReload, key);
    const pack = readPack(raw.pack, key);
    out[key] = {
      reloadMoveMul: readNumber(raw, "reloadMoveMul", key),
      ...(quickReload ? { quickReload } : {}),
      ...(pack ? { pack } : {}),
    };
  }
  return out;
}

const GUN_NUMBERS = readGunNumbers();

/** 武器種の弾倉まわりの数値（銃でなければ undefined） */
export function gunNumbersOf(key: MovesetKey): GunNumbers | undefined {
  return GUN_NUMBERS[key];
}

/** 装備の武器種（変身・奥義の差し替えではなく装備のまま。旧形式の stats でも落ちないよう剣へ） */
function equippedMoveset(stats: Readonly<Pick<PlayerStats, "moveset">>): MovesetDef {
  return MOVESETS[stats.moveset] ?? MOVESETS.sword;
}

/** stats の弾倉の定義。銃の群で、器が弾倉を持つときだけ（それ以外は弾倉が働かない） */
function magazineDefFor(stats: Readonly<Pick<PlayerStats, "moveset" | "bullet">>): MagazineDef | undefined {
  if (!isGun(equippedMoveset(stats))) return undefined;
  return BULLETS[stats.bullet]?.magazine;
}

/** 装備の銃の弾倉の定義（銃でなければ undefined） */
export function magazineDefOf(state: GameState): MagazineDef | undefined {
  return magazineDefFor(state.stats);
}

function gunNumbers(state: GameState): GunNumbers | undefined {
  return GUN_NUMBERS[equippedMoveset(state.stats).key];
}

/** 1 発ずつ込める器（砲） */
function perRoundSecOf(def: MagazineDef): number | undefined {
  return def.perRoundSec !== undefined && def.perRoundSec > 0 ? def.perRoundSec : undefined;
}

function fullHand(capacity: number): MagazineHand {
  return { rounds: capacity, reloadLeft: 0, reloadTotal: 0, cooldown: 0 };
}

/**
 * stats の弾倉を満タンで作る。弾倉が働かない武器種は key を空にする
 * （同じ器の key のまま銃でない武器種から銃へ持ち替えても作り直されるように）
 */
export function createMagazineFor(stats: Readonly<Pick<PlayerStats, "moveset" | "bullet">>): MagazineState {
  const def = magazineDefFor(stats);
  const capacity = def?.capacity ?? 0;
  return { bulletKey: def ? stats.bullet : "", hands: [fullHand(capacity), fullHand(capacity)], fresh: true, primed: false, quickTried: false, packSec: 0 };
}

/** 弾（器）が替わっていたら新しい容量で満タンに作り直す（武器掛けの試用・持ち替え）。今の弾倉を返す */
function syncMagazine(state: GameState): MagazineState {
  const p = state.player;
  const key = magazineDefOf(state) ? state.stats.bullet : "";
  if (p.magazine.bulletKey !== key) p.magazine = createMagazineFor(state.stats);
  return p.magazine;
}

/**
 * 今の弾倉を読むだけ（作り直さない）。弾が替わった直後で tickMagazine がまだ作り直していなければ、作り直した後の満タンの写し。
 * 問い合わせ（撃てるか・HUD・bot）が state を書き換えないように
 */
function readMagazine(state: GameState): MagazineState {
  const key = magazineDefOf(state) ? state.stats.bullet : "";
  return state.player.magazine.bulletKey === key ? state.player.magazine : createMagazineFor(state.stats);
}

/** 使う手（二丁拳銃は左右、他は 0 だけ） */
function handsOf(state: GameState): readonly HandIndex[] {
  return TWO_HANDED.has(equippedMoveset(state.stats).key) ? BOTH_HANDS : ONE_HAND;
}

function handOf(m: MagazineState, hand: HandIndex): MagazineHand {
  return m.hands[hand];
}

function isHandBusy(h: Readonly<MagazineHand>): boolean {
  return h.reloadLeft > 0;
}

/** 砲の詰めの最中か（満ちた弾倉でリロードを押し続けている。込めの残り秒を詰めの段の残りに使う） */
function isPacking(def: MagazineDef, h: Readonly<MagazineHand>): boolean {
  return isHandBusy(h) && h.rounds >= def.capacity;
}

/**
 * 今その手で撃てる回数（再使用は見ない）。込めの最中は 0、ただし 1 発ずつ込める器は込めた分を撃てる（詰めの最中は撃てない）。
 * 弾倉が働かない武器種は無限
 */
function availableRounds(state: GameState, hand: HandIndex): number {
  const def = magazineDefOf(state);
  if (!def) return Number.POSITIVE_INFINITY;
  const h = handOf(readMagazine(state), hand);
  if (!isHandBusy(h)) return h.rounds;
  if (perRoundSecOf(def) === undefined || isPacking(def, h)) return 0;
  return h.rounds;
}

/** その手で今撃てるか（弾が残り、込め・詰めの最中でなく、手の間が明けている）。弾倉が働かない武器種は常に true */
export function canFireHand(state: GameState, hand: HandIndex): boolean {
  if (!magazineDefOf(state)) return true;
  if (handOf(readMagazine(state), hand).cooldown > 0) return false;
  return availableRounds(state, hand) > 0;
}

/** どれかの手で撃てるか */
export function canFireAny(state: GameState): boolean {
  return handsOf(state).some((hand) => canFireHand(state, hand));
}

/** 二丁拳銃の次の銃口の手（銃口の左右 shotBurst.side が 1 なら手 0）。他の武器種は 0 */
function preferredHand(state: GameState): HandIndex {
  if (handsOf(state).length < 2) return 0;
  return state.player.shotBurst.side >= 0 ? 0 : 1;
}

/**
 * 次に撃つ手。二丁拳銃は銃口の左右の順の手が撃てなければもう片方で撃ち、銃口の左右をその手に合わせる
 * （片手で込めながら片手で撃てる）。撃てる手が無ければ undefined
 */
export function nextFireHand(state: GameState): HandIndex | undefined {
  const first = preferredHand(state);
  const order: HandIndex[] = handsOf(state).length < 2 ? [0] : [first, first === 0 ? 1 : 0];
  const hand = order.find((h) => canFireHand(state, h));
  if (hand !== undefined && handsOf(state).length >= 2) state.player.shotBurst.side = hand === 0 ? 1 : -1;
  return hand;
}

/**
 * その手の弾倉から n 回ぶん使い、実際に使えた回数を返す（足りなければ残りの分だけ。込めの最中は 0）。
 * 撃ったので「込め終えてからの 1 発目」と詰めの段は消え、砲は込めを止める。空になったら自動で込める。
 * 弾倉が働かない武器種は n をそのまま返す
 */
export function spendRounds(state: GameState, hand: HandIndex, n: number): number {
  const def = magazineDefOf(state);
  if (!def) return n;
  const spent = Math.max(0, Math.min(n, availableRounds(state, hand)));
  if (spent <= 0) return 0;
  const m = syncMagazine(state);
  const h = handOf(m, hand);
  h.rounds -= spent;
  m.fresh = false;
  m.packSec = 0;
  // 1 発ずつ込める器は込めを止めて撃つ（込めた分はそのまま）
  stopBusy(h);
  if (h.rounds <= 0) startReload(state, hand);
  return spent;
}

/**
 * 弾倉の残りを全部使い、使った回数を返す（砲の奥義「全弾発射」。込め・詰めの最中でも残りを使い切る）。
 * 使い切ったので込め終えてからの 1 発目と詰めの段は消え、込めを始める。弾倉が働かない武器種は 0
 */
export function emptyMagazine(state: GameState): number {
  const def = magazineDefOf(state);
  if (!def) return 0;
  const m = syncMagazine(state);
  let used = 0;
  for (const hand of handsOf(state)) {
    const h = handOf(m, hand);
    used += h.rounds;
    h.rounds = 0;
    stopBusy(h);
    startReload(state, hand);
  }
  m.fresh = false;
  m.packSec = 0;
  return used;
}

function stopBusy(h: MagazineHand): void {
  h.reloadLeft = 0;
  h.reloadTotal = 0;
}

/**
 * その手の込めを始める（弾倉が満ちている・既に込めている・銃でないなら何もしない）。始めたら true。
 * 込めの秒は器の reloadSec（1 発ずつ込める器は 1 発の秒を繰り返す）
 */
export function startReload(state: GameState, hand: HandIndex): boolean {
  const def = magazineDefOf(state);
  if (!def) return false;
  const m = syncMagazine(state);
  const h = handOf(m, hand);
  if (isHandBusy(h) || h.rounds >= def.capacity) return false;
  const total = perRoundSecOf(def) ?? def.reloadSec;
  h.reloadLeft = total;
  h.reloadTotal = total;
  m.quickTried = false;
  pushSfx(state, "reloadStart");
  return true;
}

/** 込め終わり: 満タンにし、込め終えてからの 1 発目を立てる */
function finishReload(state: GameState, def: MagazineDef, hand: HandIndex): void {
  const m = state.player.magazine;
  const h = handOf(m, hand);
  h.rounds = def.capacity;
  stopBusy(h);
  m.fresh = true;
  m.quickTried = false;
  pushSfx(state, "reloadDone");
}

/** 1 発ずつ込める器の 1 発。満ちたら込め終わり、まだなら次の 1 発へ（余った秒は持ち越す） */
function loadOneRound(state: GameState, def: MagazineDef, hand: HandIndex, perRound: number): void {
  const h = handOf(state.player.magazine, hand);
  h.rounds = Math.min(def.capacity, h.rounds + 1);
  if (h.rounds >= def.capacity) {
    finishReload(state, def, hand);
    return;
  }
  h.reloadLeft += perRound;
  h.reloadTotal = perRound;
  pushSfx(state, "reloadBeat");
}

/** 手 1 本の込めを進める（詰めの最中は tickPack が進める） */
function tickHand(state: GameState, def: MagazineDef, hand: HandIndex, dt: number): void {
  const h = handOf(state.player.magazine, hand);
  h.cooldown = Math.max(0, h.cooldown - dt);
  if (!isHandBusy(h) || isPacking(def, h)) return;
  h.reloadLeft -= dt;
  if (h.reloadLeft > EPS) return;
  const perRound = perRoundSecOf(def);
  if (perRound !== undefined) loadOneRound(state, def, hand, perRound);
  else finishReload(state, def, hand);
}

/** リロードの押下: 込めている手（短銃）は早込め、満ちていない手は込め始める（二丁拳銃は両手とも） */
function pressReload(state: GameState, def: MagazineDef): void {
  if (tryQuickReload(state) !== "none") return;
  const m = state.player.magazine;
  for (const hand of handsOf(state)) {
    if (handOf(m, hand).rounds < def.capacity) startReload(state, hand);
  }
}

/** 詰めの段（packSec を levelSec で割った切り捨て、max で頭打ち） */
function packLevelOf(packSec: number, pack: PackDef): number {
  if (pack.levelSec <= 0) return 0;
  return Math.min(pack.max, Math.floor(packSec / pack.levelSec + EPS));
}

/**
 * 砲の詰め: 満ちた弾倉でリロードを押し続けると levelSec ごとに 1 段（max まで）。詰めている間は込めの残り秒を
 * 次の段までの秒にして「込めの最中」と同じに扱う（撃てず、足が遅い）。離す・max に届くと止める（段は撃つまで残る）
 */
function tickPack(state: GameState, def: MagazineDef, held: boolean, dt: number): void {
  const pack = gunNumbers(state)?.pack;
  if (!pack) return;
  const m = state.player.magazine;
  const h = handOf(m, 0);
  const level = packLevelOf(m.packSec, pack);
  const full = h.rounds >= def.capacity;
  if (!held || !full || level >= pack.max) {
    if (isPacking(def, h)) stopBusy(h);
    return;
  }
  m.packSec += dt;
  const after = packLevelOf(m.packSec, pack);
  if (after > level) {
    pushSfx(state, "packLevel");
    // 詰めの段は型の出来事（段 3 の装薬の戦意）。今の型が持たなければ何もしない
    gainMorale(state, "pack", after - level);
  }
  if (after >= pack.max) {
    stopBusy(h);
    return;
  }
  h.reloadTotal = pack.levelSec;
  h.reloadLeft = Math.max(EPS * 2, pack.levelSec * (after + 1) - m.packSec);
}

/** 砲の今の詰めの段（詰めない武器種は 0） */
export function packLevel(state: GameState): number {
  const pack = gunNumbers(state)?.pack;
  if (!pack || !magazineDefOf(state)) return 0;
  return packLevelOf(readMagazine(state).packSec, pack);
}

/**
 * 毎ステップ（player.ts の updatePlayer）。弾が替わったら作り直し、込めを進め、リロードの押下・砲の詰め・
 * 撃ち切った手の自動の込めを扱う
 */
export function tickMagazine(state: GameState, input: Readonly<Pick<FrameInput, "reloadPressed" | "reloadHeld">>, dt: number): void {
  const m = syncMagazine(state);
  const def = magazineDefOf(state);
  if (!def) return;
  for (const hand of handsOf(state)) tickHand(state, def, hand, dt);
  if (input.reloadPressed) pressReload(state, def);
  tickPack(state, def, input.reloadHeld, dt);
  // 撃ち切った手は自動で込める（どの経路で空になっても）
  for (const hand of handsOf(state)) {
    if (handOf(m, hand).rounds <= 0) startReload(state, hand);
  }
}

/**
 * 早込め（短銃）: 込めの最中にリロードか左を押した。1 回の込めに 1 回だけで、進みが窓（from から sec 秒）の中なら即込め終わり、
 * 外なら込めが missSec 秒延びる。決まったら型の出来事 quickReload を渡す（戦意への反映は段 3 の型が決める）
 */
export function tryQuickReload(state: GameState): QuickReloadResult {
  const quick = gunNumbers(state)?.quickReload;
  const def = magazineDefOf(state);
  if (!quick || !def) return "none";
  const m = syncMagazine(state);
  const h = handOf(m, 0);
  if (!isHandBusy(h) || m.quickTried) return "none";
  m.quickTried = true;
  const elapsed = h.reloadTotal - h.reloadLeft;
  const from = quick.from * h.reloadTotal;
  if (elapsed + EPS >= from && elapsed <= from + quick.sec + EPS) {
    finishReload(state, def, 0);
    pushSfx(state, "quickReload");
    gainMorale(state, "quickReload");
    return "hit";
  }
  h.reloadLeft += quick.missSec;
  h.reloadTotal += quick.missSec;
  pushSfx(state, "quickMiss");
  return "miss";
}

/**
 * 左（引き金）の押した瞬間（player.ts の onButtonPress）。込めの最中の短銃は早込めに使う（押下を引き受けたら true）。
 * どの手でも撃てない（空・込めの最中）なら空撃ちの音
 */
export function pressTrigger(state: GameState): boolean {
  if (!magazineDefOf(state)) return false;
  if (tryQuickReload(state) !== "none") return true;
  if (!handsOf(state).some((hand) => availableRounds(state, hand) > 0)) pushSfx(state, "dryFire");
  return false;
}

/** どれかの手が込め・詰めの最中か */
export function isMagazineBusy(state: GameState): boolean {
  if (!magazineDefOf(state)) return false;
  const m = readMagazine(state);
  return handsOf(state).some((hand) => isHandBusy(handOf(m, hand)));
}

/** 込めの最中の足の倍率（武器種の reloadMoveMul。込めていなければ 1） */
export function reloadMoveMul(state: GameState): number {
  if (!isMagazineBusy(state)) return 1;
  return gunNumbers(state)?.reloadMoveMul ?? 1;
}

/**
 * 込めの最中ならその場で込め終える（改鋳「疾駆」のダッシュ。詰めは込めではないので除く）。込め終えた手があれば true
 */
export function finishReloadNow(state: GameState): boolean {
  const def = magazineDefOf(state);
  if (!def) return false;
  const m = syncMagazine(state);
  let done = false;
  for (const hand of handsOf(state)) {
    const h = handOf(m, hand);
    if (!isHandBusy(h) || isPacking(def, h)) continue;
    finishReload(state, def, hand);
    done = true;
  }
  return done;
}

// ---------------------------------------------------------------------------
// HUD の材料（render/magazineHud.ts が読む）
// ---------------------------------------------------------------------------

export interface MagazineHandView {
  readonly rounds: number;
  readonly capacity: number;
  /** 込め・詰めの最中 */
  readonly busy: boolean;
  /** 今の込め（1 発ずつ込める器は次の 1 発、詰めは次の段）の進み（0..1） */
  readonly progress: number;
}

export interface MagazineView {
  /** 弾倉が働く（銃の器を持つ）。偽なら描かない */
  readonly active: boolean;
  readonly hands: readonly MagazineHandView[];
  /** 早込めの窓（込めの進みの割合 0..1）。早込めを持ち、込めの最中で、まだ押していないときだけ */
  readonly quickWindow: { readonly from: number; readonly to: number } | null;
  /** 砲の詰めの段と上限（詰めない武器種は max 0） */
  readonly pack: { readonly level: number; readonly max: number; readonly packing: boolean };
}

const INACTIVE_VIEW: MagazineView = { active: false, hands: [], quickWindow: null, pack: { level: 0, max: 0, packing: false } };

function handView(def: MagazineDef, h: Readonly<MagazineHand>): MagazineHandView {
  const busy = isHandBusy(h);
  const progress = busy && h.reloadTotal > 0 ? Math.min(1, Math.max(0, 1 - h.reloadLeft / h.reloadTotal)) : 0;
  return { rounds: h.rounds, capacity: def.capacity, busy, progress };
}

function quickWindowOf(state: GameState, m: MagazineState): MagazineView["quickWindow"] {
  const quick = gunNumbers(state)?.quickReload;
  const h = handOf(m, 0);
  if (!quick || m.quickTried || !isHandBusy(h) || h.reloadTotal <= 0) return null;
  return { from: quick.from, to: Math.min(1, quick.from + quick.sec / h.reloadTotal) };
}

/** 弾倉の HUD の材料（state を読むだけ。弾が替わった直後は作り直した後の満タンとして見せる） */
export function magazineView(state: GameState): MagazineView {
  const def = magazineDefOf(state);
  if (!def) return INACTIVE_VIEW;
  const m = readMagazine(state);
  const pack = gunNumbers(state)?.pack;
  return {
    active: true,
    hands: handsOf(state).map((hand) => handView(def, handOf(m, hand))),
    quickWindow: quickWindowOf(state, m),
    pack: { level: pack ? packLevelOf(m.packSec, pack) : 0, max: pack?.max ?? 0, packing: isPacking(def, handOf(m, 0)) && pack !== undefined },
  };
}
