import { ELEMENTS, type Element, ELEMENT_LABEL } from "../core/element";
import type { GameState, RoomState, SpendKind } from "../core/state";
import { pushLog, pushSfx } from "../core/state";
import { GOOD_STATUS_KINDS, NEUTRAL_STATUS_KINDS } from "../core/status";
import type { Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { CONTRACT, ECONOMY } from "../data/tuning";
import { recordProvenance } from "../loot/provenance";
import { type PlayerStats, TRAIT_COLORS } from "../loot/types";
import { TILE_SIZE, inBounds, rectCenterPx, toIndex } from "../map/grid";
import { BOONS, BOON_KEYS, type BoonKey, applyBoonsToStats, grantBoon, hasBoon, offerBoons, removeBoon } from "./boons";
import { coreKeepsCurses } from "./boonCores";
import { type BetOffer, betHudLine, betOfferLabel, doubleUpGo, doubleUpGoLabel, doubleUpStop, doubleUpStopLabel, onBetsFloorReached, placeBet, planBookieBets, stakeFor, updateBets } from "./bets";
import { bossKeyForDepth, isBossDepth } from "./boss";
import { healPlayer } from "./combat";
import { gainCoins, spendCoins } from "./economy";
import { addFloatingText, spawnBurst } from "./effects";
import { dropItem } from "./loot";
import { refillMana } from "./mana";
import { circlesOverlap, overlapsWall } from "./physics";
import { dropRareItem } from "./roomTypes";
import { RUN_EVENTS, type RunEventKey, activeElementStorm, rollFloorEventKey } from "./runEvents";
import { dropRune } from "./skills";
import { addForkStair, revealRoomTiles, revealWholeFloor } from "./specialRooms";
import { removeStatus } from "./statusEffects";

/**
 * 契約者（docs/ideas/run-expansion.md 6 章）。銭の出入りは system/economy.ts（gainCoins / spendCoins）。
 * 契約者は階の入口（開始部屋）に立つ人物で、台座と同じく「触れて選ぶ」（モーダルなし。触れなければ何も起きないので QA bot も止まらない）。
 * 取引の代価は銭（ラン内だけの資源）か生命。契約（灰の公証人）は state.contracts.pacts に積み、
 * 失敗は起きた瞬間に、達成は次の階に着いたとき（onContractsFloorReached）に判定する。
 * 鍛冶・属性の祭壇・属性の嵐の「通常攻撃に乗る属性」は、装備から畳んだ stats に後から足す（ensureContractStats）
 */

// -----------------------------------------------------------------------------
// 型と定義
// -----------------------------------------------------------------------------

export const CONTRACTOR_KEYS = ["notary", "peddler", "mender", "seer", "bookie", "bard", "smith", "guide", "ferryman"] as const;
export type ContractorKey = (typeof CONTRACTOR_KEYS)[number];

export const PACT_KEYS = ["unscathed", "swift", "slayer", "silent"] as const;
export type PactKey = (typeof PACT_KEYS)[number];

/** 台座の種類（契約者ごとに 2〜3 個並ぶ） */
export type OfferKind =
  | "pact"
  | "buyItem"
  | "buyEchoes"
  | "buyRune"
  | "stitch"
  | "uncurse"
  | "cleanse"
  | "foretell"
  | "ward"
  | "farsight"
  | "bet"
  | "betGo"
  | "betStop"
  | "betLife"
  | "tale"
  | "witness"
  | "infuse"
  | "fork"
  | "reveal"
  | "ferryLife"
  | "ferryCoins";

export interface ContractOffer {
  kind: OfferKind;
  /** 契約の key・属性の key など */
  key: string;
  /** 払う銭（0 は銭なし。生命で払うものは 0） */
  cost: number;
  pos: Vec;
  used: boolean;
  /** false の間は触れても反応しない（離れると true に戻る。連打と出現直後の誤爆を防ぐ） */
  armed: boolean;
  /** 賭場の主の賭けの中身（bet / betGo / betStop。system/bets.ts） */
  bet?: BetOffer;
}

export interface Contractor {
  key: ContractorKey;
  pos: Vec;
  offers: ContractOffer[];
  /** 近づいたときの一言を出したか */
  greeted: boolean;
}

export interface ActivePact {
  key: PactKey;
  /** 結んだ state.time（これより後の被弾・詠唱で破れる） */
  signedAt: number;
  /** 結んだときの撃破数（狩りの契約） */
  killsAt: number;
  /** 結んだ階 */
  depth: number;
  failed: boolean;
}

/** 通常攻撃に乗る属性（鍛冶・属性の祭壇・属性の嵐） */
export interface Infusion {
  element: Element;
  share: number;
}

export interface ContractState {
  /** この階の契約者（いなければ null） */
  contractor: Contractor | null;
  /** 結んでいる契約（次の階に着くと判定して空になる） */
  pacts: ActivePact[];
  /** 鍛冶で焼き付けた属性（このランの間） */
  smith: Infusion | null;
  /** 属性の祭壇で選んだ属性（この階の間） */
  altar: Infusion | null;
  /** 占いが読んだ次の階のイベント。calm = 何も起きない。null = 読んでいない */
  foretold: RunEventKey | "calm" | null;
  /** 語り部の目撃の残り秒（この間の制圧は来歴に 2 回刻まれる） */
  witness: number;
  /** 渡し守に時を買った回数 */
  ferried: number;
  /** 疾走の契約に破れた: 次の階の死神の猶予を先に進める秒 */
  reaperPenalty: number;
  /**
   * 契約の報酬でまだ開いていない祝福の 3 択の数。契約の判定は階段の 3 択と同じステップに起きるので、
   * その場で開くと階段の 3 択に上書きされて消える。3 択が閉じてから updateContractors が 1 つずつ開く
   */
  boonsOwed: number;
}

export function createContractState(): ContractState {
  return { contractor: null, pacts: [], smith: null, altar: null, foretold: null, witness: 0, ferried: 0, reaperPenalty: 0, boonsOwed: 0 };
}

export interface ContractorDef {
  name: string;
  /** 近づいたときの一言 */
  line: string;
  color: string;
}

export const CONTRACTORS: Readonly<Record<ContractorKey, ContractorDef>> = {
  notary: { name: "灰の公証人", line: "腕に賭けるか。署名は灰で書く", color: "#b8b0a8" },
  peddler: { name: "行商", line: "銭があるなら、何でも売るよ", color: "#e0c070" },
  mender: { name: "修理屋", line: "傷も呪いも、縫えば塞がる", color: "#90d0a0" },
  seer: { name: "占い", line: "次の階の匂いがする…", color: "#c090ff" },
  bookie: { name: "賭場の主", line: "倍か、無か。さあ張った", color: "#ffd040" },
  bard: { name: "語り部", line: "その遺物の話を聞かせておくれ", color: "#ffb0c0" },
  smith: { name: "鍛冶", line: "刃に属性を焼き付けてやろう", color: "#ff9040" },
  guide: { name: "案内人", line: "道はひとつじゃない", color: "#90e0ff" },
  ferryman: { name: "渡し守", line: "死神なら、しばらく待たせられる", color: "#8080c0" },
};

export interface PactDef {
  name: string;
  /** 条件と、成功・失敗で何が起きるか */
  desc: string;
}

export const PACTS: Readonly<Record<PactKey, PactDef>> = {
  unscathed: { name: "無傷の契約", desc: "次の階まで被弾しない → 祝福と銭 / 破れば呪い" },
  swift: { name: "疾走の契約", desc: `${CONTRACT.pactSwiftTime} 秒で次の階へ → 次の階で錬磨 / 破れば死神が早まる` },
  slayer: { name: "狩りの契約", desc: `次の階までに ${CONTRACT.pactSlayerKills} 体倒す → 遺物 / 破れば呪い` },
  silent: { name: "沈黙の契約", desc: "次の階までスキルを使わない → 銭と気力 / 破れば銭を失う" },
};

// -----------------------------------------------------------------------------
// 浮き文字
// -----------------------------------------------------------------------------

const TEXT_LIFT = 12;
const TEXT_SCALE = 1.2;
const TEXT_LIFE = 1.4;
const BURST_PARTICLES = 14;
const BURST_SPEED = 80;
const BURST_LIFE = 0.5;

function sayAt(state: GameState, text: string, color: string): void {
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - TEXT_LIFT }, text, color, TEXT_SCALE, TEXT_LIFE);
}

// -----------------------------------------------------------------------------
// 置く（buildFloor の最後）
// -----------------------------------------------------------------------------

const START_ROOM = 0;
/** 台座・立ち位置が壁から離れているべき距離（px） */
const SPOT_CLEARANCE = 6;

/** 解放制で封じた契約者を重み 0 として外す（乱数は 1 回のまま。封じが空なら今と同じ結果） */
function pickContractor(state: GameState): ContractorKey {
  const open = CONTRACTOR_KEYS.filter((k) => !state.runMeta.lockedContractors.includes(k));
  const total = open.reduce((s, k) => s + CONTRACT.weights[k], 0);
  let roll = state.rng.next() * total;
  for (const k of open) {
    roll -= CONTRACT.weights[k];
    if (roll < 0) return k;
  }
  return "peddler";
}

function spotFree(state: GameState, room: RoomState, pos: Vec): boolean {
  if (overlapsWall(state, pos.x, pos.y, SPOT_CLEARANCE)) return false;
  if (!room.tiles) return true;
  const tx = Math.floor(pos.x / TILE_SIZE);
  const ty = Math.floor(pos.y / TILE_SIZE);
  return inBounds(state.map, tx, ty) && room.tiles.has(toIndex(state.map, tx, ty));
}

/**
 * 中心から dir 側（上 = -1 / 下 = 1）に、契約者 1 人と台座 n 個が置けるか。置けるなら位置を返す。
 * spacing は台座の間隔（タイル）。市の商人（system/merchants.ts）も使う
 */
export function layout(state: GameState, room: RoomState, n: number, dir: number, spacing: number = CONTRACT.offerSpacing): { stand: Vec; offers: Vec[] } | null {
  const c = rectCenterPx(room.rect);
  const stand = { x: c.x, y: c.y + dir * CONTRACT.standOffset * TILE_SIZE };
  if (!spotFree(state, room, stand)) return null;
  const y = c.y + dir * CONTRACT.offerOffset * TILE_SIZE;
  const offers: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = { x: c.x + (i - (n - 1) / 2) * spacing * TILE_SIZE, y };
    if (!spotFree(state, room, p)) return null;
    offers.push(p);
  }
  return { stand, offers };
}

/**
 * 階の入口に契約者を立たせる（深度 CONTRACT.minDepth から確率で。ボスを倒した次の階は必ず）。
 * 場所が取れなければ立たない。属性の祭壇の属性（この階だけ）もここで捨てる
 */
export function placeContractor(state: GameState): void {
  const c = state.contracts;
  c.contractor = null;
  c.altar = null;
  if (state.depth < CONTRACT.minDepth) return;
  const afterBoss = isBossDepth(state.depth - 1);
  if (!afterBoss && !state.rng.chance(CONTRACT.appearChance)) return;
  standContractor(state, pickContractor(state));
}

/** 決まった契約者を階の入口に立たせる（台座の中身はここで決まる）。場所が取れなければ false */
export function standContractor(state: GameState, key: ContractorKey): boolean {
  const room = state.rooms[START_ROOM];
  if (!room) return false;
  const plan = offerPlan(state, key);
  const spacing = key === "bookie" ? ECONOMY.bet.offerSpacing : CONTRACT.offerSpacing;
  const spots = layout(state, room, plan.length, -1, spacing) ?? layout(state, room, plan.length, 1, spacing);
  if (!spots) return false;
  const offers = plan.map((o, i) => ({ ...o, pos: spots.offers[i] ?? spots.stand, used: false, armed: false }));
  state.contracts.contractor = { key, pos: spots.stand, offers, greeted: false };
  return true;
}

type OfferPlan = Pick<ContractOffer, "kind" | "key" | "cost" | "bet">;

/** 重複なしで count 個 */
function pickDistinct<T>(state: GameState, pool: readonly T[], count: number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  while (out.length < count && rest.length > 0) {
    const [v] = rest.splice(state.rng.int(0, rest.length - 1), 1);
    if (v !== undefined) out.push(v);
  }
  return out;
}

const PACT_CHOICES = 3;
const INFUSE_ELEMENTS: readonly Element[] = ELEMENTS.filter((e) => e !== "none");

function offerPlan(state: GameState, key: ContractorKey): OfferPlan[] {
  switch (key) {
    case "notary":
      return pickDistinct(state, PACT_KEYS, PACT_CHOICES).map((k) => ({ kind: "pact", key: k, cost: 0 }));
    case "peddler":
      return [
        { kind: "buyItem", key: "", cost: CONTRACT.peddlerItemCost },
        { kind: "buyEchoes", key: "", cost: CONTRACT.peddlerEchoCost },
        { kind: "buyRune", key: "", cost: CONTRACT.peddlerSalveCost },
      ];
    case "mender":
      return [
        { kind: "stitch", key: "", cost: CONTRACT.menderStitchCost },
        { kind: "cleanse", key: "", cost: CONTRACT.menderCleanseCost },
        { kind: "uncurse", key: "", cost: CONTRACT.menderUncurseCost },
      ];
    case "seer":
      return [
        { kind: "foretell", key: "", cost: CONTRACT.seerReadCost },
        { kind: "ward", key: "", cost: CONTRACT.seerWardCost },
        { kind: "farsight", key: "", cost: CONTRACT.seerMapCost },
      ];
    case "bookie":
      // 運 2 + 腕 2 の賭け（system/bets.ts）と生命を賭ける台。賭け金は持ち金で変わるので毎ステップ引き直す（refreshBookie）
      return [...planBookieBets(state).map((bet): OfferPlan => ({ kind: "bet", key: bet.kind, cost: bet.stake, bet })), { kind: "betLife", key: "", cost: 0 }];
    case "bard":
      return [
        { kind: "tale", key: "", cost: CONTRACT.bardTaleCost },
        { kind: "witness", key: "", cost: 0 },
      ];
    case "smith":
      return pickDistinct(state, INFUSE_ELEMENTS, CONTRACT.smithChoices).map((e) => ({ kind: "infuse", key: e, cost: CONTRACT.smithCost }));
    case "guide":
      return [
        { kind: "fork", key: "", cost: CONTRACT.guideForkCost },
        { kind: "reveal", key: "", cost: CONTRACT.guideRevealCost },
      ];
    case "ferryman":
      return [
        { kind: "ferryLife", key: "", cost: 0 },
        { kind: "ferryCoins", key: "", cost: CONTRACT.ferryCoinCost },
      ];
    default:
      return [];
  }
}

// -----------------------------------------------------------------------------
// 表示（描画が読む）
// -----------------------------------------------------------------------------

const OFFER_NAME: Readonly<Record<OfferKind, string>> = {
  pact: "契約",
  buyItem: "遺物",
  buyEchoes: "残響",
  buyRune: "刻印符",
  stitch: "傷の手当て",
  uncurse: "解呪",
  cleanse: "浄化",
  foretell: "次の階の占い",
  ward: "厄払い",
  farsight: "この階の地図",
  bet: "賭け",
  betGo: "続ける",
  betStop: "降りる",
  betLife: "生命を賭ける",
  tale: "来歴を刻む",
  witness: "立ち会い",
  infuse: "焼き付け",
  fork: "階段を増やす",
  reveal: "階段の場所",
  ferryLife: "死神の足止め（生命）",
  ferryCoins: "死神の足止め",
};

/** 台座の上に出す名前（代価つき） */
export function offerLabel(offer: Readonly<ContractOffer>): string {
  if (offer.bet) return betLabel(offer.kind, offer.bet);
  const name = offerName(offer);
  return offer.cost > 0 ? `${name}（銭 ${offer.cost}）` : name;
}

function offerName(offer: Readonly<ContractOffer>): string {
  if (offer.kind === "pact") return PACTS[offer.key as PactKey]?.name ?? OFFER_NAME.pact;
  if (offer.kind === "infuse") return `${ELEMENT_LABEL[offer.key as Element] ?? ""}の${OFFER_NAME.infuse}`;
  return OFFER_NAME[offer.kind];
}

/** 賭けの台座の名札（賭け金 → 払い戻し） */
function betLabel(kind: OfferKind, bet: Readonly<BetOffer>): string {
  if (kind === "betGo") return doubleUpGoLabel(bet);
  if (kind === "betStop") return doubleUpStopLabel(bet);
  return betOfferLabel(bet);
}

/** HUD に出す結んでいる契約の行（張っている賭けも 1 行） */
export function pactHudLines(state: GameState): string[] {
  const lines = state.contracts.pacts.map((p) => `${PACTS[p.key].name}: ${pactProgress(state, p)}`);
  const bet = betHudLine(state);
  if (bet) lines.push(bet);
  return lines;
}

function pactProgress(state: GameState, pact: ActivePact): string {
  switch (pact.key) {
    case "swift":
      return `残り ${Math.max(0, Math.ceil(CONTRACT.pactSwiftTime - (state.time - pact.signedAt)))} 秒`;
    case "slayer":
      return `${Math.min(CONTRACT.pactSlayerKills, state.kills - pact.killsAt)}/${CONTRACT.pactSlayerKills}`;
    case "unscathed":
      return "被弾なし";
    case "silent":
      return "スキル禁止";
    default:
      return "";
  }
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

/** floor.ts の updateRooms から毎ステップ。契約の失敗・目撃の時間・属性の上乗せ・台座 */
export function updateContractors(state: GameState, dt: number): void {
  const c = state.contracts;
  c.witness = Math.max(0, c.witness - dt);
  payOwedBoons(state);
  tickPacts(state);
  updateBets(state);
  ensureContractStats(state);
  const who = c.contractor;
  if (!who) return;
  greet(state, who);
  if (who.key === "bookie") refreshBookie(state, who);
  const body = state.player.body;
  for (const offer of who.offers) {
    if (offer.used) continue;
    const touching = circlesOverlap(offer.pos.x, offer.pos.y, CONTRACT_TOUCH_RADIUS, body.pos.x, body.pos.y, body.radius);
    if (!touching) {
      offer.armed = true;
      continue;
    }
    if (!offer.armed) continue;
    offer.armed = false;
    useOffer(state, who, offer);
  }
}

/** 契約の報酬の 3 択を、ほかの 3 択が開いていないときに 1 つ開く（開けなくても 1 つ減らす） */
function payOwedBoons(state: GameState): void {
  const c = state.contracts;
  if (c.boonsOwed <= 0 || state.boonChoice) return;
  c.boonsOwed -= 1;
  offerBoons(state);
}

/** 台座に触れたと判定する半径（px）。部屋の台座と同じ */
const CONTRACT_TOUCH_RADIUS = 9;

function greet(state: GameState, who: Contractor): void {
  if (who.greeted) return;
  const p = state.player.body.pos;
  if (Math.hypot(p.x - who.pos.x, p.y - who.pos.y) > CONTRACT.greetRange) return;
  who.greeted = true;
  const def = CONTRACTORS[who.key];
  addFloatingText(state, { x: who.pos.x, y: who.pos.y - TEXT_LIFT }, def.line, def.color, 1, TEXT_LIFE * 2);
  pushLog(state, `${def.name}「${def.line}」`, def.color);
}

/** 台座の代価を支出の集計のどこへ入れるか（賭けは賭け、それ以外は契約者との取引） */
function offerSpendKind(offer: Readonly<ContractOffer>): SpendKind {
  return offer.kind === "bet" ? "bet" : "contract";
}

/** 契約の破れなどで持ち金から失う（持ち金を超えては失わない） */
function loseCoins(state: GameState, amount: number): void {
  const lost = Math.min(state.economy.coins, amount);
  if (lost <= 0) return;
  spendCoins(state, lost, "contract");
}

/** 条件を満たさない・払えないときは何も起きない（台座は残る） */
function useOffer(state: GameState, who: Contractor, offer: ContractOffer): void {
  const color = CONTRACTORS[who.key].color;
  if (state.economy.coins < offer.cost) {
    sayAt(state, `銭が足りない（${offer.cost}）`, color);
    return;
  }
  const blocked = offerBlocked(state, offer);
  if (blocked) {
    sayAt(state, blocked, color);
    return;
  }
  // 払えることは上で確かめてある（額 0 の台座は spendCoins が集計に積まない）
  spendCoins(state, offer.cost, offerSpendKind(offer));
  offer.used = true;
  // 契約・焼き付け・賭けは品書きから 1 つだけ選ぶ
  if (offer.kind === "pact" || offer.kind === "infuse" || offer.kind === "bet") {
    for (const o of who.offers) if (o.kind === offer.kind) o.used = true;
  }
  applyOffer(state, offer, color);
  spawnBurst(state, offer.pos, color, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, 2);
  pushSfx(state, "pedestalUse");
}

/** 使えない理由（使えるなら null） */
function offerBlocked(state: GameState, offer: ContractOffer): string | null {
  switch (offer.kind) {
    case "uncurse":
      return cursedBoons(state).length === 0 ? "呪いがない" : null;
    case "bet":
      return state.economy.bet ? "賭けは 1 つまで" : null;
    case "betGo":
    case "betStop":
      return state.economy.bet?.kind === "doubleUp" ? null : "賭けがない";
    case "betLife":
      return canPayLife(state, CONTRACT.bookieLifeCost) ? null : "生命が足りない";
    case "ferryLife":
      if (state.contracts.ferried >= CONTRACT.ferryMaxUses) return "舟はもう出ない";
      return canPayLife(state, CONTRACT.ferryLifeCost) ? null : "生命が足りない";
    case "ferryCoins":
      return state.contracts.ferried >= CONTRACT.ferryMaxUses ? "舟はもう出ない" : null;
    case "fork":
      return addForkStair(state, true) ? null : "これ以上は増やせない";
    default:
      return null;
  }
}

/** 最大生命の ratio を払っても CONTRACT.lifeFloor 以上が残るか（取引で死なせない。QA bot の通りすがりでも） */
function canPayLife(state: GameState, ratio: number): boolean {
  const p = state.player;
  return p.hp - p.maxHp * ratio >= CONTRACT.lifeFloor;
}

function applyOffer(state: GameState, offer: ContractOffer, color: string): void {
  const below = { x: offer.pos.x, y: offer.pos.y + TILE_SIZE };
  switch (offer.kind) {
    case "pact":
      signPact(state, offer.key as PactKey, color);
      return;
    case "buyItem":
      dropItem(state, below, CONTRACT.peddlerItemBoost);
      return;
    case "buyEchoes": {
      const echo = state.rng.pick(TRAIT_COLORS);
      state.runEvents.pendingEchoes[echo] += CONTRACT.peddlerEchoes;
      sayAt(state, `残響 +${CONTRACT.peddlerEchoes}`, color);
      return;
    }
    case "buyRune":
      dropRune(state, below);
      return;
    case "stitch":
      healPlayer(state, state.player.maxHp * CONTRACT.menderStitchHeal);
      return;
    case "cleanse":
      cleansePlayer(state);
      sayAt(state, "身が清まった", color);
      return;
    case "uncurse":
      liftCurse(state, color);
      return;
    case "foretell":
      foretell(state, color);
      return;
    case "ward":
      state.contracts.foretold = "calm";
      sayAt(state, "次の階は静かだ", color);
      return;
    case "farsight":
      revealWholeFloor(state);
      sayAt(state, "階の地図が分かった", color);
      return;
    case "bet":
    case "betGo":
    case "betStop":
      applyBet(state, offer);
      return;
    case "betLife":
      betLife(state, below, color);
      return;
    case "tale":
      for (let i = 0; i < CONTRACT.bardTales; i++) recordProvenance(state, { kind: "roomClear" });
      sayAt(state, "来歴が刻まれた", color);
      return;
    case "witness":
      state.contracts.witness = CONTRACT.bardWitnessTime;
      sayAt(state, "語り部が立ち会う", color);
      pushLog(state, `語り部が立ち会う（${CONTRACT.bardWitnessTime} 秒間、制圧が来歴に 2 回刻まれる）。`, color);
      return;
    case "infuse":
      setSmith(state, offer.key as Element, color);
      return;
    case "fork":
      addForkStair(state, false);
      sayAt(state, "新しい階段が現れた", color);
      return;
    case "reveal":
      revealRoomTiles(state, state.rooms.length - 1);
      sayAt(state, "階段の場所を聞いた", color);
      return;
    case "ferryLife":
      state.player.hp -= state.player.maxHp * CONTRACT.ferryLifeCost;
      buyTime(state, color);
      return;
    case "ferryCoins":
      buyTime(state, color);
      return;
    default:
      return;
  }
}

// ---- 個別 ----

function signPact(state: GameState, key: PactKey, color: string): void {
  state.contracts.pacts.push({ key, signedAt: state.time, killsAt: state.kills, depth: state.depth, failed: false });
  sayAt(state, PACTS[key].name, color);
  pushLog(state, `灰の公証人と契約した: ${PACTS[key].desc}`, color);
}

function cursedBoons(state: GameState): BoonKey[] {
  // 呪い喰い（芯）の間は呪い付きを手放せない（解呪の対象が無い扱い）
  if (coreKeepsCurses(state)) return [];
  return state.boons.filter((k) => BOONS[k].cursed);
}

/** 呪い付きの祝福を 1 つ手放す */
function liftCurse(state: GameState, color: string): void {
  const cursed = cursedBoons(state);
  if (cursed.length === 0) return;
  const key = state.rng.pick(cursed);
  removeBoon(state, key);
  sayAt(state, `呪いが解けた: ${BOONS[key].name}`, color);
}

/** 祝福を 1 つ外す処理は加護の入れ替えと共用なので boons.ts に置く（runEvents.ts などの既存の import 口として再 export） */
export { removeBoon } from "./boons";

/** 呪い付きの祝福を 1 つ受ける（契約の失敗・呪詛の声の失敗）。受けられるものが無ければ何もしない */
export function grantCurse(state: GameState): void {
  const pool = BOON_KEYS.filter((k) => BOONS[k].cursed && !hasBoon(state, k));
  if (pool.length === 0) return;
  grantBoon(state, state.rng.pick(pool));
}

function cleansePlayer(state: GameState): void {
  const kinds = state.player.status.effects.map((e) => e.kind).filter((k) => !GOOD_STATUS_KINDS.has(k) && !NEUTRAL_STATUS_KINDS.has(k));
  for (const kind of kinds) removeStatus(state, { kind: "player" }, kind);
  state.cursed = false;
}

/** 次の階のイベントを先に抽選して確定し、次のボスの名も告げる */
function foretell(state: GameState, color: string): void {
  const key = rollFloorEventKey(state);
  state.contracts.foretold = key ?? "calm";
  sayAt(state, key ? `次の階: ${RUN_EVENTS[key].name}` : "次の階は静かだ", color);
  const bossDepth = nextBossDepth(state.depth);
  const boss = enemyDef(bossKeyForDepth(bossDepth));
  pushLog(state, `占い: 次の階は${key ? `「${RUN_EVENTS[key].name}」` : "静か"}。地下 ${bossDepth} 階に${boss.bossTitle ?? boss.name}が待つ。`, color);
}

/** depth より深い最初のボス階 */
export function nextBossDepth(depth: number): number {
  let d = depth + 1;
  while (!isBossDepth(d)) d++;
  return d;
}

// ---- 賭場の主（賭けの本体は system/bets.ts）----

/** 賭け金を今の持ち金から引き直し、倍々勝負の続ける / 降りるの台座を今の賭けに合わせる（毎ステップ） */
function refreshBookie(state: GameState, who: Contractor): void {
  const active = state.economy.bet;
  for (const offer of who.offers) {
    if (offer.used || !offer.bet) continue;
    if (offer.kind === "bet") {
      offer.bet.stake = stakeFor(offer.bet.kind, state.economy.coins);
      offer.cost = offer.bet.stake;
      continue;
    }
    // 倍々勝負が終わった（負けた・降りた）ら続ける / 降りるの台座も消す
    if (active?.kind !== "doubleUp") {
      offer.used = true;
      continue;
    }
    offer.bet.stake = active.stake;
    offer.bet.mul = active.mul;
  }
}

/** 賭けの台座を使った（代価の賭け金は useOffer が払ってある） */
function applyBet(state: GameState, offer: ContractOffer): void {
  const bet = offer.bet;
  if (!bet) return;
  if (offer.kind === "betGo") {
    // 勝てば同じ台座で続けられる（一度離れてから）
    if (doubleUpGo(state)) offer.used = false;
    return;
  }
  if (offer.kind === "betStop") {
    doubleUpStop(state);
    return;
  }
  const outcome = placeBet(state, bet);
  if (outcome === "open" && bet.kind === "doubleUp") openDoubleUp(state, offer);
}

/**
 * 倍々勝負に勝った: 台座を「続ける」（倍々勝負の台座の位置）と「降りる」（最も近い、使い終えた賭けの台座の位置）に変える。
 * 賭けの台座は 1 つ選ぶと全部使い終えるので、その場所を借りる（壁との重なりは置いたときに確かめてある）
 */
function openDoubleUp(state: GameState, from: ContractOffer): void {
  const who = state.contracts.contractor;
  const bet = from.bet;
  if (!who || !bet) return;
  const others = who.offers.filter((o) => o !== from && o.kind === "bet");
  others.sort((a, b) => Math.abs(a.pos.x - from.pos.x) - Math.abs(b.pos.x - from.pos.x));
  const stopPos = others[0]?.pos ?? { x: from.pos.x, y: from.pos.y + TILE_SIZE * 2 };
  who.offers.push({ kind: "betGo", key: bet.kind, cost: 0, pos: { ...from.pos }, used: false, armed: false, bet: { ...bet } });
  who.offers.push({ kind: "betStop", key: bet.kind, cost: 0, pos: { ...stopPos }, used: false, armed: false, bet: { ...bet } });
}

function betLife(state: GameState, below: Vec, color: string): void {
  const p = state.player;
  p.hp -= p.maxHp * CONTRACT.bookieLifeCost;
  if (!state.rng.chance(CONTRACT.bookieLifeWinChance)) {
    sayAt(state, "負け", color);
    return;
  }
  sayAt(state, "勝ち: 遺物", color);
  dropRareItem(state, below);
}

function setSmith(state: GameState, element: Element, color: string): void {
  state.contracts.smith = { element, share: CONTRACT.smithShare };
  sayAt(state, `${ELEMENT_LABEL[element]}を焼き付けた`, color);
  pushLog(state, `鍛冶が刃に${ELEMENT_LABEL[element]}を焼き付けた（この探索の間）。`, color);
  ensureContractStats(state);
}

/** 死神の猶予を買う: 経過時間を戻し、出ている死神は一度去る */
function buyTime(state: GameState, color: string): void {
  state.contracts.ferried += 1;
  state.floorTime = Math.max(0, state.floorTime - CONTRACT.ferryTime);
  state.reaper = null;
  sayAt(state, `死神が ${CONTRACT.ferryTime} 秒遠のいた`, color);
}

// -----------------------------------------------------------------------------
// 契約の判定
// -----------------------------------------------------------------------------

function happenedSince(state: GameState, kind: "onHurt" | "onSkillCast", since: number): boolean {
  const r = state.recent[kind];
  return r !== undefined && r.lastTime > since;
}

/** 破れた契約をその場で判定して代償を払わせる */
function tickPacts(state: GameState): void {
  const c = state.contracts;
  if (c.pacts.length === 0) return;
  for (const pact of c.pacts) {
    if (pact.failed || !pactBroken(state, pact)) continue;
    pact.failed = true;
    failPact(state, pact);
  }
  c.pacts = c.pacts.filter((p) => !p.failed);
}

function pactBroken(state: GameState, pact: ActivePact): boolean {
  switch (pact.key) {
    case "unscathed":
      return happenedSince(state, "onHurt", pact.signedAt);
    case "silent":
      return happenedSince(state, "onSkillCast", pact.signedAt);
    case "swift":
      return state.time - pact.signedAt > CONTRACT.pactSwiftTime;
    default:
      return false;
  }
}

function failPact(state: GameState, pact: ActivePact): void {
  sayAt(state, `契約が破れた: ${PACTS[pact.key].name}`, CONTRACT.pactColor);
  pushLog(state, `${PACTS[pact.key].name}が破れた。灰が舞う。`, CONTRACT.pactColor);
  pushSfx(state, "runEventWarn");
  switch (pact.key) {
    case "unscathed":
    case "slayer":
      grantCurse(state);
      return;
    case "swift":
      state.contracts.reaperPenalty += CONTRACT.pactSwiftPenalty;
      return;
    case "silent":
      loseCoins(state, ECONOMY.income.pactSilentPenalty);
      return;
    default:
      return;
  }
}

function fulfilPact(state: GameState, pact: ActivePact): void {
  sayAt(state, `契約を果たした: ${PACTS[pact.key].name}`, CONTRACT.pactColor);
  pushLog(state, `${PACTS[pact.key].name}を果たした。`, CONTRACT.pactColor);
  switch (pact.key) {
    case "unscathed":
      gainCoins(state, ECONOMY.income.pactUnscathed, "contract");
      state.contracts.boonsOwed += 1;
      return;
    case "swift":
      // 次の階の到着時に錬磨の提示を出す（消費は system/exits.ts）
      state.boonRun.temperQueued += CONTRACT.pactSwiftTempers;
      return;
    case "slayer":
      dropRareItem(state, { ...state.player.body.pos });
      return;
    case "silent":
      gainCoins(state, ECONOMY.income.pactSilent, "contract");
      refillMana(state);
      return;
    default:
      return;
  }
}

/**
 * 次の階に着いた（降りた・戻った）。残っている契約を判定して空にし、疾走の契約の代償（死神の前倒し）を払わせる。
 * floor.ts の descend / ascend が buildFloor の後に呼ぶ
 */
export function onContractsFloorReached(state: GameState): void {
  onBetsFloorReached(state);
  const c = state.contracts;
  const pacts = c.pacts;
  c.pacts = [];
  for (const pact of pacts) {
    if (pact.key === "slayer" && state.kills - pact.killsAt < CONTRACT.pactSlayerKills) {
      failPact(state, pact);
      continue;
    }
    fulfilPact(state, pact);
  }
  if (c.reaperPenalty > 0) {
    state.floorTime += c.reaperPenalty;
    c.reaperPenalty = 0;
  }
}

/**
 * 部屋を制圧した（floor.ts の clearRoom から）。語り部の目撃中なら来歴をもう 1 回。制圧の銭は economy.ts が出す。
 * _room は floor.ts の呼び出しに合わせて残してある（欠片を出していた頃の名残。呼び出し側が直ったら消す）
 */
export function onContractsRoomCleared(state: GameState, _room: RoomState): void {
  if (state.contracts.witness > 0) recordProvenance(state, { kind: "roomClear" });
}

// -----------------------------------------------------------------------------
// 通常攻撃に乗る属性（鍛冶・属性の祭壇・属性の嵐）
// -----------------------------------------------------------------------------

/** 今効いている属性の上乗せ（並び順は鍛冶 → 祭壇 → 嵐で固定） */
export function activeInfusions(state: GameState): Infusion[] {
  const c = state.contracts;
  const storm = activeElementStorm(state);
  const out: Infusion[] = [];
  if (c.smith) out.push(c.smith);
  if (c.altar) out.push(c.altar);
  if (storm) out.push(storm);
  return out;
}

function infusionSignature(list: readonly Infusion[]): string {
  return list.map((i) => `${i.element}:${i.share}`).join(",");
}

/** 上乗せを済ませた stats と、そのときの上乗せの中身。オブジェクトの同一性だけを見るので決定性に影響しない */
const PATCHED = new WeakMap<PlayerStats, string>();

/**
 * stats を一部だけ差し替えた写し（変身の武器種など）に、上乗せ済みの印を引き継ぐ。
 * 写しは上乗せをすでに含むので、印が無いと ensureContractStats がもう一度足してしまう
 */
export function carryContractPatch(from: PlayerStats, to: PlayerStats): void {
  const sig = PATCHED.get(from);
  if (sig !== undefined) PATCHED.set(to, sig);
}

/**
 * 装備・祝福から畳んだ stats（applyStats が作る）に、属性の上乗せを足す。
 * applyStats は stats を毎回作り直すので、作り直された（まだ上乗せしていない）stats を見つけたら足し直す。
 * 上乗せの中身が変わったら、祝福の畳み込みからやり直してから足す（前の上乗せを残さない）
 */
export function ensureContractStats(state: GameState): void {
  const list = activeInfusions(state);
  const sig = infusionSignature(list);
  const done = PATCHED.get(state.stats);
  if (done === sig) return;
  if (done !== undefined) applyBoonsToStats(state);
  if (list.length === 0) {
    PATCHED.set(state.stats, sig);
    return;
  }
  const infuse = { ...state.stats.infuse };
  for (const inf of list) infuse[inf.element] += inf.share;
  state.stats = { ...state.stats, infuse };
  PATCHED.set(state.stats, sig);
}
