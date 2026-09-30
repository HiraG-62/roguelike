import type { RecentEvent } from "../core/events";
import { type ActiveBet, type BetKind, type BetRecord, type BetTier, type GameState, type Jin, pushLog, pushSfx } from "../core/state";
import { ECONOMY, SYNERGY } from "../data/tuning";
import { chapterOf } from "./chapters";
import { gainCoins } from "./economy";
import { addFloatingText } from "./effects";
import { buildProfile } from "./keywords";

/**
 * 賭場の主の賭け（docs/ideas/economy-impl.md 2-6）。品書きは運 2 + 腕 2（+ 生命を賭ける台。contractors.ts）。
 * - 運（丁半・大穴・一か八か）は張った瞬間に決まる。倍々勝負は勝つたびに「続ける / 降りる」を選ぶ
 * - 腕（無傷・速攻）は張った後に最初に起きた陣に束縛し、その陣の決着で判定する。凌ぎは階を降りるときに判定する
 * - 賭け金は張る瞬間の持ち金の割合。張ったら取り消せない。張っている賭けは 1 つだけ（state.economy.bet）
 * 乱数は品書きを並べるとき（buildFloor の契約者の中）と、運の型を張った瞬間だけ使う
 */

const B = ECONOMY.bet;

export const LUCK_BETS = ["chohan", "longshot", "allIn", "doubleUp"] as const satisfies readonly BetKind[];
export const SKILL_BETS = ["unscathed", "swift", "parries"] as const satisfies readonly BetKind[];
type LuckBetKind = (typeof LUCK_BETS)[number];
type TimedBetKind = "swift" | "parries";
const TIMED_TIERS: readonly BetTier[] = ["easy", "hard", "extreme"];

/** 台座・HUD の名前 */
export const BET_LABEL: Readonly<Record<BetKind, string>> = {
  chohan: "丁半",
  longshot: "大穴",
  allIn: "一か八か",
  doubleUp: "倍々勝負",
  unscathed: "無傷",
  swift: "速攻",
  parries: "凌ぎ",
};
const JACKPOT_LABEL = "大穴の陣";
const TEXT_WIN = "賭けの勝ち";
const TEXT_LOSE = "賭けの負け";
const TEXT_BOUND = "賭けの陣";

const TEXT_LIFT = 14;
const TEXT_SCALE = 1.2;
const TEXT_LIFE = 1.2;
/** 凌ぎが数える出来事（受け流しの成功と見切り） */
const PARRY_EVENTS = ["onParry", "onJustDodge"] as const;
/** 倍率の表示の桁（×1.5 のように小数 1 桁まで） */
const MUL_DIGITS = 10;

/** 台座に並べる賭けの中身（ContractOffer.bet）。stake は張る瞬間の持ち金から毎ステップ引き直す */
export interface BetOffer {
  kind: BetKind;
  tier: BetTier | null;
  /** 速攻の秒 / 凌ぎの回数（無傷・運の型は 0） */
  target: number;
  /** 勝ったときの倍率（無傷は易の倍率。束縛した陣に大将がいれば難の倍率に上がる） */
  mul: number;
  jackpot: boolean;
  /** 今張ると払う賭け金（倍々勝負の続ける / 降りるの台座では今の賭け金） */
  stake: number;
}

// -----------------------------------------------------------------------------
// 数値の読み出し
// -----------------------------------------------------------------------------

function isLuck(kind: BetKind): kind is LuckBetKind {
  return (LUCK_BETS as readonly BetKind[]).includes(kind);
}

/** 持ち金 coins のときの賭け金（割合を切り捨て、最低額を下回るなら最低額） */
export function stakeFor(kind: BetKind, coins: number): number {
  const def = B[kind];
  return Math.max(def.stakeMin, Math.floor(Math.max(0, coins) * def.stakeRatio));
}

function timedTier(kind: TimedBetKind, tier: BetTier): { target: number; mul: number } {
  return B[kind].tiers[tier];
}

function unscathedMul(tier: "easy" | "hard"): number {
  return B.unscathed.tiers[tier].mul;
}

/** 勝ったときの払い戻し（賭け金 × 倍率を丸める） */
export function payoutOf(stake: number, mul: number): number {
  return Math.round(stake * mul);
}

/** 見切りの語を持つビルドか（装備・スキル石・祝福のどれかが見切りを出す・食う・強める） */
export function hasJustKeyword(state: GameState): boolean {
  const p = buildProfile(state);
  return p.produces.includes("just") || p.consumes.includes("just") || p.amplifies.includes("just");
}

/** 凌ぎの必要回数（見切りの語を持つビルドは parryKeywordMul 倍に切り上げ） */
export function parriesTarget(state: GameState, tier: BetTier): number {
  const base = timedTier("parries", tier).target;
  return hasJustKeyword(state) ? Math.ceil(base * B.parryKeywordMul) : base;
}

// -----------------------------------------------------------------------------
// 品書き（契約者を立たせるとき。乱数: 運の型 → 腕の型 → 腕の型ごとの難しさ）
// -----------------------------------------------------------------------------

function pickDistinct<T>(state: GameState, pool: readonly T[], count: number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  while (out.length < count && rest.length > 0) {
    const [v] = rest.splice(state.rng.int(0, rest.length - 1), 1);
    if (v !== undefined) out.push(v);
  }
  return out;
}

function luckOffer(state: GameState, kind: LuckBetKind): BetOffer {
  return { kind, tier: null, target: 0, mul: B[kind].mul, jackpot: false, stake: stakeFor(kind, state.economy.coins) };
}

function skillOffer(state: GameState, kind: (typeof SKILL_BETS)[number]): BetOffer {
  const stake = stakeFor(kind, state.economy.coins);
  if (kind === "unscathed") return { kind, tier: null, target: 0, mul: unscathedMul("easy"), jackpot: false, stake };
  const tier = state.rng.pick(TIMED_TIERS);
  const target = kind === "parries" ? parriesTarget(state, tier) : timedTier(kind, tier).target;
  return { kind, tier, target, mul: timedTier(kind, tier).mul, jackpot: false, stake };
}

/** この章でまだ大穴の陣を出せるか */
function jackpotAvailable(state: GameState): boolean {
  const ch = chapterOf(state.depth);
  return state.economy.jackpotChapters.filter((c) => c === ch).length < B.jackpotPerChapter;
}

/** 賭場の主の品書き（運 luckOffers + 腕 skillOffers）。章に jackpotPerChapter 回、腕の 1 つ目が大穴の陣になる */
export function planBookieBets(state: GameState): BetOffer[] {
  const luck = pickDistinct(state, LUCK_BETS, B.luckOffers).map((k) => luckOffer(state, k));
  const skill = pickDistinct(state, SKILL_BETS, B.skillOffers).map((k) => skillOffer(state, k));
  if (skill.length > 0 && jackpotAvailable(state)) {
    skill[0] = { kind: "unscathed", tier: null, target: 0, mul: B.jackpotMul, jackpot: true, stake: stakeFor("unscathed", state.economy.coins) };
    state.economy.jackpotChapters.push(chapterOf(state.depth));
  }
  return [...luck, ...skill];
}

// -----------------------------------------------------------------------------
// 表示（描画が読む）
// -----------------------------------------------------------------------------

function mulText(mul: number): string {
  return String(Math.round(mul * MUL_DIGITS) / MUL_DIGITS);
}

function offerName(offer: Readonly<BetOffer>): string {
  if (offer.jackpot) return JACKPOT_LABEL;
  const name = BET_LABEL[offer.kind];
  if (offer.kind === "swift") return `${name} ${offer.target} 秒`;
  if (offer.kind === "parries") return `${name} ${offer.target} 回`;
  return name;
}

/** 台座の名札: 「丁半（銭 20 → 40）」。無傷は大将のいる陣の倍率まで幅で出す */
export function betOfferLabel(offer: Readonly<BetOffer>): string {
  const win = payoutOf(offer.stake, offer.mul);
  if (offer.kind === "unscathed" && !offer.jackpot) {
    return `${offerName(offer)}（銭 ${offer.stake} → ${win}〜${payoutOf(offer.stake, unscathedMul("hard"))}）`;
  }
  return `${offerName(offer)}（銭 ${offer.stake} → ${win}）`;
}

/** 倍々勝負の「続ける」の名札（今の払い戻し → 勝てば倍） */
export function doubleUpGoLabel(offer: Readonly<BetOffer>): string {
  const pot = payoutOf(offer.stake, offer.mul);
  return `続ける（銭 ${pot} → ${payoutOf(offer.stake, offer.mul * B.doubleUp.mul)}）`;
}

/** 倍々勝負の「降りる」の名札 */
export function doubleUpStopLabel(offer: Readonly<BetOffer>): string {
  return `降りる（銭 ${payoutOf(offer.stake, offer.mul)}）`;
}

/** HUD の賭けの行（張っていなければ null）。「賭け: 無傷 ×2（銭 30）」 */
export function betHudLine(state: GameState): string | null {
  const bet = state.economy.bet;
  if (!bet) return null;
  const name = bet.jackpot ? JACKPOT_LABEL : BET_LABEL[bet.kind];
  return `賭け: ${name} ×${mulText(bet.mul)}（銭 ${bet.stake}）${betProgress(state, bet)}`;
}

function betProgress(state: GameState, bet: ActiveBet): string {
  switch (bet.kind) {
    case "parries":
      return ` ${Math.min(bet.count, bet.target)}/${bet.target}`;
    case "swift": {
      const jin = boundJin(state, bet);
      if (!jin) return ` ${bet.target} 秒`;
      return ` 残り ${Math.max(0, Math.ceil(bet.target - elapsedOf(state, bet, jin)))} 秒`;
    }
    default:
      return "";
  }
}

// -----------------------------------------------------------------------------
// 張る・決着
// -----------------------------------------------------------------------------

function recordOf(state: GameState, kind: BetKind): BetRecord {
  const stats = state.economy.betStats;
  const rec = stats[kind] ?? { placed: 0, won: 0, staked: 0, paid: 0, tiers: {} };
  stats[kind] = rec;
  return rec;
}

function say(state: GameState, text: string): void {
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - TEXT_LIFT }, text, B.color, TEXT_SCALE, TEXT_LIFE);
}

/** 張った結果。open = 賭けが残った（倍々勝負の勝ち・腕の型） */
export type BetOutcome = "won" | "lost" | "open";

/**
 * 賭けを張る（賭け金は呼び出し側が払ってある）。運の型はここで決まる（乱数 1 回）。
 * 倍々勝負は勝てば賭けが残り、台座が「続ける / 降りる」に変わる（contractors.ts）
 */
export function placeBet(state: GameState, offer: Readonly<BetOffer>): BetOutcome {
  const rec = recordOf(state, offer.kind);
  rec.placed += 1;
  rec.staked += offer.stake;
  const kind = offer.kind;
  if (isLuck(kind)) return rollLuck(state, offer, kind);
  state.economy.bet = openBet(state, offer, offer.mul, 0);
  return "open";
}

function openBet(state: GameState, offer: Readonly<BetOffer>, mul: number, count: number): ActiveBet {
  const seen: ActiveBet["seen"] = {};
  for (const kind of PARRY_EVENTS) {
    const r = state.recent[kind];
    if (r) seen[kind] = { ...r };
  }
  return { kind: offer.kind, stake: offer.stake, mul, jinId: null, signedAt: state.time, count, target: offer.target, tier: offer.tier, jackpot: offer.jackpot, seen };
}

function rollLuck(state: GameState, offer: Readonly<BetOffer>, kind: LuckBetKind): BetOutcome {
  const def = B[kind];
  if (!state.rng.chance(def.chance)) {
    finish(state, kind, null, 0);
    return "lost";
  }
  if (kind === "doubleUp") {
    state.economy.bet = openBet(state, offer, def.mul, 1);
    say(state, `${BET_LABEL.doubleUp} ×${mulText(def.mul)}`);
    return "open";
  }
  finish(state, kind, null, payoutOf(offer.stake, def.mul));
  return "won";
}

/** 倍々勝負を続ける（乱数 1 回）。勝てば倍率が倍になって賭けが残り true、負ければ賭けが消えて false */
export function doubleUpGo(state: GameState): boolean {
  const bet = state.economy.bet;
  if (!bet || bet.kind !== "doubleUp") return false;
  if (!state.rng.chance(B.doubleUp.chance)) {
    settleBet(state, bet, false);
    return false;
  }
  bet.mul *= B.doubleUp.mul;
  bet.count += 1;
  say(state, `${BET_LABEL.doubleUp} ×${mulText(bet.mul)}`);
  return true;
}

/** 倍々勝負を降りる（今の倍率で払い戻す） */
export function doubleUpStop(state: GameState): void {
  const bet = state.economy.bet;
  if (!bet || bet.kind !== "doubleUp") return;
  settleBet(state, bet, true);
}

/** 張っている賭けを決着させて消す */
function settleBet(state: GameState, bet: ActiveBet, won: boolean): void {
  state.economy.bet = null;
  const payout = won ? payoutOf(bet.stake, bet.mul) : 0;
  // 張った数・賭け金は placeBet で数えてある（finish は決着の側だけ足す）
  finish(state, bet.kind, bet.tier, payout);
  const name = bet.jackpot ? JACKPOT_LABEL : BET_LABEL[bet.kind];
  pushLog(state, won ? `賭け「${name}」に勝った（銭 +${payout}）。` : `賭け「${name}」に負けた。`, B.color);
}

/** 決着の記録と払い戻し・浮き文字 */
function finish(state: GameState, kind: BetKind, tier: BetTier | null, payout: number): void {
  const rec = recordOf(state, kind);
  if (tier) {
    const t = rec.tiers[tier] ?? { settled: 0, won: 0 };
    t.settled += 1;
    if (payout > 0) t.won += 1;
    rec.tiers[tier] = t;
  }
  if (payout <= 0) {
    say(state, TEXT_LOSE);
    pushSfx(state, "betLose");
    return;
  }
  rec.won += 1;
  rec.paid += payout;
  say(state, TEXT_WIN);
  pushSfx(state, "betWin");
  gainCoins(state, payout, "bet");
}

// -----------------------------------------------------------------------------
// 腕の型の判定
// -----------------------------------------------------------------------------

function hurtSince(state: GameState, since: number): boolean {
  const hurt = state.recent.onHurt;
  return hurt !== undefined && hurt.lastTime > since;
}

function boundJin(state: GameState, bet: ActiveBet): Jin | undefined {
  if (bet.jinId === null) return undefined;
  return state.jins.find((j) => j.id === bet.jinId);
}

function elapsedOf(state: GameState, bet: ActiveBet, jin: Jin): number {
  return state.time - (jin.engagedAt ?? bet.signedAt);
}

/** 前に読んだ recent から増えた回数。窓（SYNERGY.recentWindow）を越えて数え直していれば今の count が全部新しい */
function newSince(prev: RecentEvent | undefined, now: RecentEvent | undefined): number {
  if (!now) return 0;
  if (!prev) return now.count;
  if (now.lastTime !== prev.lastTime && now.lastTime - prev.lastTime > SYNERGY.recentWindow) return now.count;
  return Math.max(0, now.count - prev.count);
}

function countParries(state: GameState, bet: ActiveBet): void {
  for (const kind of PARRY_EVENTS) {
    const now = state.recent[kind];
    bet.count += newSince(bet.seen[kind], now);
    if (now) bet.seen[kind] = { ...now };
  }
}

/**
 * 毎ステップ（contractors.ts の updateContractors から）: 凌ぎを数え、負けが決まった腕の賭けをその場で落とす
 * （無傷は張った後の被弾、速攻は束縛した陣の起床から秒を過ぎた）
 */
export function updateBets(state: GameState): void {
  const bet = state.economy.bet;
  if (!bet) return;
  switch (bet.kind) {
    case "parries":
      countParries(state, bet);
      return;
    case "unscathed":
      if (hurtSince(state, bet.signedAt)) settleBet(state, bet, false);
      return;
    case "swift": {
      if (bet.jinId === null) return;
      const jin = boundJin(state, bet);
      if (!jin || elapsedOf(state, bet, jin) > bet.target) settleBet(state, bet, false);
      return;
    }
    default:
      return;
  }
}

/** 陣が起きた（jin.ts の wakeJin から）。無傷・速攻の賭けが張った後に最初に起きた陣を束縛する */
export function onJinEngaged(state: GameState, jin: Jin): void {
  const bet = state.economy.bet;
  if (!bet || bet.jinId !== null) return;
  if (bet.kind !== "unscathed" && bet.kind !== "swift") return;
  // 張る前から戦っている陣は「次の陣」ではない
  if ((jin.engagedAt ?? state.time) < bet.signedAt) return;
  bet.jinId = jin.id;
  if (bet.kind === "unscathed" && !bet.jackpot) {
    bet.tier = jin.leaderId !== null ? "hard" : "easy";
    bet.mul = unscathedMul(bet.tier);
  }
  say(state, TEXT_BOUND);
}

/** 陣の決着（jin.ts の settleJin から。交戦した陣だけ）。束縛した陣なら無傷・速攻を判定する */
export function onBetJinSettled(state: GameState, jin: Jin): void {
  const bet = state.economy.bet;
  if (!bet || bet.jinId !== jin.id) return;
  if (bet.kind === "unscathed") settleBet(state, bet, !hurtSince(state, bet.signedAt));
  else if (bet.kind === "swift") settleBet(state, bet, elapsedOf(state, bet, jin) <= bet.target);
}

/**
 * 階を離れた（contractors.ts の onContractsFloorReached から）。凌ぎを判定し、倍々勝負は降りた扱いで払い戻す。
 * 束縛した陣を置いて降りた無傷・速攻は負け（陣はその階に残る）。まだ陣が起きていなければ次の階へ持ち越す
 */
export function onBetsFloorReached(state: GameState): void {
  const bet = state.economy.bet;
  if (!bet) return;
  switch (bet.kind) {
    case "parries":
      countParries(state, bet);
      settleBet(state, bet, bet.count >= bet.target);
      return;
    case "doubleUp":
      settleBet(state, bet, true);
      return;
    case "unscathed":
    case "swift":
      if (bet.jinId !== null) settleBet(state, bet, false);
      return;
    default:
      return;
  }
}
