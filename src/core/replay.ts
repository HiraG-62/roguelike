/**
 * リプレイの記録・エンコード・デコード・再生。
 *
 * ゲームは固定 60Hz の決定的シミュレーションなので、seed と「step に渡した FrameInput 列」と
 * 開始時点の装備スナップショットがあれば同じランを再現できる。
 * ラン中に装備画面で装備/スキルを付け替えたりステータスを振ったりすると結果が変わるため、
 * その変更も「何フレーム目の前に適用されたか」をイベントとして記録する。
 *
 * エンコード形式（inputs 文字列）:
 *   ラン = `code` または `count*code`、ラン同士は `;` 区切り（連続する同一 code をまとめる）
 *   code = `bits,mx,my,aim[,wheel]`
 *     bits  : 押下フラグのビットマスク（36 進）
 *     mx,my : 移動ベクトル。0 / 1 / -1 / 斜め(d, -d) はそのまま、アナログ値は数値文字列
 *     aim   : `n` = null、`=x:y` = 絶対座標（直前が null のとき）、`dx:dy` = 直前フレームからの差分
 *   aim を差分にしているので、マウス静止中や等速移動中は同じ code になりランレングスで縮む
 */
import { createGame, step } from "./game";
import { EMPTY_INPUT, type FrameInput } from "./input";
import { hashSeed } from "./rng";
import type { GameState } from "./state";
import { normalize, type Vec } from "./vec";
import { computeStats } from "../loot/stats";
import { ATTR_KEYS, SLOTS, createEmptyProfile, type Attributes, type Equipment, type Item, type Profile, uniformAttributes } from "../loot/types";
import { PROFILE_KEY } from "../loot/profile";
import { SKILL_PROFILE_KEY, stoneInSlot } from "../skills/persistence";
import { SKILL_KEYS, type SkillProfile, type SkillStone } from "../skills/types";
import { applyStats } from "../system/player";
import { ALLOC_ORDER, allocateAttribute } from "../ui/attributeAlloc";
import { type OriginKey, type RunModKey, type RunSetup, defaultRunSetup, sanitizeLockedRelics, sanitizeRunSetup } from "../system/runSetup";

/**
 * 4: ステータス振り分けが step 内のキー入力から装備画面のイベントに移った。
 * 5: 起点とラン修飾子（縛り）を記録する（ラン開始の条件が変わり、分岐路・バイオームで生成も変わった）
 * 6: 武器種とコンボ派生・attackHeld・GCD 廃止・開放型マップ・回復の再設計（同じ入力列でも進行が変わる）
 */
export const REPLAY_VERSION = 6;

// ---------------------------------------------------------------------------
// データ型
// ---------------------------------------------------------------------------

/** ラン開始時点 / 装備変更時点の、シミュレーションに影響する持ち物の状態 */
export interface ReplayLoadout {
  equipment: Equipment;
  /** スキルスロット i に装着していた石（無ければ null） */
  skillStones: (SkillStone | null)[];
  /** stash の件数（満杯だと拾えない挙動を再現するため。中身は不要） */
  stashCount: number;
  /** スキル石 stash の件数 */
  stoneCount: number;
}

/** 装備画面での付け替え・ステータス振り分け。frame 番目の step の直前に適用する */
export interface ReplayEvent {
  frame: number;
  loadout: ReplayLoadout;
  /**
   * 装備か振り分けが変わった場合のみ: 操作直後のプレイヤー値（applyStats の丸め差や、
   * 操作の順序で変わるマナの切り詰めを消すため直接上書きする）。mana は REPLAY_VERSION 4 から
   */
  player: { hp: number; dashChargesLeft: number; mana?: number } | null;
  /** 振り分けが変わった場合のみ: 操作直後の runAttributes.alloc（差分を allocateAttribute で振り直す） */
  alloc: Attributes | null;
}

export interface ReplayResult {
  depth: number;
  kills: number;
  score: number;
}

export interface ReplayData {
  version: number;
  seedText: string;
  /** ラン開始時刻（epoch ms） */
  startedAt: number;
  /** ラン終了時刻（epoch ms）。ラン履歴エントリの date と一致させて紐付ける */
  endedAt: number;
  daily: boolean;
  /** 起点（REPLAY_VERSION 5 から。無ければ放浪者） */
  origin?: OriginKey;
  /** ラン修飾子（REPLAY_VERSION 5 から。無ければ縛りなし） */
  modifiers?: RunModKey[];
  /** 抽選に出ない名のある遺物（依頼の報酬。無ければ []。空のときは書かない） */
  lockedRelics?: string[];
  snapshot: ReplayLoadout;
  events: ReplayEvent[];
  /** エンコード済みの入力列 */
  inputs: string;
  /** 入力のフレーム数（デコード結果の検証用） */
  frameCount: number;
  result: ReplayResult;
}

// ---------------------------------------------------------------------------
// FrameInput のエンコード
// ---------------------------------------------------------------------------

const RUN_SEP = ";";
const COUNT_SEP = "*";
const FIELD_SEP = ",";
const AIM_SEP = ":";
const AIM_NULL = "n";
const AIM_ABS_PREFIX = "=";
const DIAG_TOKEN = "d";
const NEG_DIAG_TOKEN = "-d";
const NEG_ZERO_TOKEN = "-0";
const BITS_RADIX = 36;
const MIN_FIELDS = 4;
const MAX_FIELDS = 5;

/** キーボード斜め入力の正規化値（input.ts と同じ計算で求め、表記を短くする） */
const DIAG = normalize({ x: 1, y: 1 }).x;

type ButtonKey =
  | "dashPressed"
  | "attackPressed"
  | "shootHeld"
  | "specialPressed"
  | "confirmPressed"
  | "restartPressed"
  | "inventoryPressed"
  | "skill1Pressed"
  | "skill2Pressed"
  | "clickPressed"
  | "shiftHeld"
  | "skill1Held"
  | "skill2Held"
  | "padConfirmPressed"
  | "skill3Pressed"
  | "skill4Pressed"
  | "skill3Held"
  | "skill4Held"
  | "attackHeld"
  | "interactPressed";

/** ビット順。末尾に追加するのは可、並べ替えは不可（過去のリプレイが壊れる） */
const BUTTON_BITS: readonly ButtonKey[] = [
  "dashPressed",
  "attackPressed",
  "shootHeld",
  "specialPressed",
  "confirmPressed",
  "restartPressed",
  "inventoryPressed",
  "skill1Pressed",
  "skill2Pressed",
  "clickPressed",
  "shiftHeld",
  // Charge 刻印符の溜め入力。step が読むので記録しないと再生がずれる
  "skill1Held",
  "skill2Held",
  // パッド A のエッジのみ。boons.ts の選択判定が見るので記録しないと再生がずれる
  "padConfirmPressed",
  // スキルスロット 3 / 4（REPLAY_VERSION 3 で追加）
  "skill3Pressed",
  "skill4Pressed",
  "skill3Held",
  "skill4Held",
  // 攻撃キーの押しっぱなし（大剣の溜め）。末尾に足したので旧リプレイは 0 として読める
  "attackHeld",
  // 床の遺物・スキル石を拾う。末尾に足したので旧リプレイは 0（押していない）として読める
  "interactPressed",
];

/** 照準を 1px 単位に量子化する。-0 は 0 に寄せる */
export function quantizeAim(aim: Vec | null): Vec | null {
  if (!aim) return null;
  return { x: Math.round(aim.x) + 0, y: Math.round(aim.y) + 0 };
}

/** 記録と実プレイで同じ値を使うための正規化（照準の量子化 + 参照の切り離し） */
export function normalizeFrame(input: FrameInput): FrameInput {
  return { ...input, move: { ...input.move }, aimScreen: quantizeAim(input.aimScreen) };
}

function encodeNumber(n: number): string {
  if (Object.is(n, -0)) return NEG_ZERO_TOKEN;
  if (n === DIAG) return DIAG_TOKEN;
  if (n === -DIAG) return NEG_DIAG_TOKEN;
  return String(n);
}

function decodeNumber(s: string): number {
  if (s === NEG_ZERO_TOKEN) return -0;
  if (s === DIAG_TOKEN) return DIAG;
  if (s === NEG_DIAG_TOKEN) return -DIAG;
  const n = Number(s);
  if (s.length === 0 || !Number.isFinite(n)) throw new Error(`replay: bad number "${s}"`);
  return n;
}

function encodeBits(input: FrameInput): string {
  let bits = 0;
  BUTTON_BITS.forEach((key, i) => {
    if (input[key]) bits |= 1 << i;
  });
  return bits.toString(BITS_RADIX);
}

function encodeAim(aim: Vec | null, prev: Vec | null): string {
  if (!aim) return AIM_NULL;
  if (!prev) return `${AIM_ABS_PREFIX}${aim.x}${AIM_SEP}${aim.y}`;
  return `${aim.x - prev.x}${AIM_SEP}${aim.y - prev.y}`;
}

/** 1 フレームを code 文字列にする。aim は量子化済みであること */
function encodeFrame(input: FrameInput, prevAim: Vec | null): string {
  const fields = [
    encodeBits(input),
    encodeNumber(input.move.x),
    encodeNumber(input.move.y),
    encodeAim(input.aimScreen, prevAim),
  ];
  if (input.wheel !== 0) fields.push(encodeNumber(input.wheel));
  return fields.join(FIELD_SEP);
}

interface ParsedCode {
  bits: number;
  move: Vec;
  aim: { kind: "null" } | { kind: "abs"; x: number; y: number } | { kind: "delta"; x: number; y: number };
  wheel: number;
}

function parseAimPair(s: string): { x: number; y: number } {
  const parts = s.split(AIM_SEP);
  const [xs, ys] = parts;
  if (parts.length !== 2 || xs === undefined || ys === undefined) throw new Error(`replay: bad aim "${s}"`);
  return { x: decodeNumber(xs), y: decodeNumber(ys) };
}

function parseCode(code: string): ParsedCode {
  const fields = code.split(FIELD_SEP);
  if (fields.length < MIN_FIELDS || fields.length > MAX_FIELDS) throw new Error(`replay: bad code "${code}"`);
  const [bitsText = "", mx = "", my = "", aimText = "", wheelText] = fields;
  const bits = parseInt(bitsText, BITS_RADIX);
  if (!Number.isInteger(bits) || bits < 0) throw new Error(`replay: bad bits "${bitsText}"`);
  let aim: ParsedCode["aim"];
  if (aimText === AIM_NULL) aim = { kind: "null" };
  else if (aimText.startsWith(AIM_ABS_PREFIX)) aim = { kind: "abs", ...parseAimPair(aimText.slice(1)) };
  else aim = { kind: "delta", ...parseAimPair(aimText) };
  return {
    bits,
    move: { x: decodeNumber(mx), y: decodeNumber(my) },
    aim,
    wheel: wheelText === undefined ? 0 : decodeNumber(wheelText),
  };
}

function frameFromParsed(parsed: ParsedCode, aim: Vec | null): FrameInput {
  const input: FrameInput = {
    ...EMPTY_INPUT,
    move: { ...parsed.move },
    aimScreen: aim ? { ...aim } : null,
    wheel: parsed.wheel,
  };
  BUTTON_BITS.forEach((key, i) => {
    input[key] = (parsed.bits & (1 << i)) !== 0;
  });
  return input;
}

/** 入力列をランレングス付きでエンコードする（逐次版）。録画中に 1 フレームずつ積む */
export class InputEncoder {
  private readonly runs: string[] = [];
  private lastCode: string | null = null;
  private lastCount = 0;
  private prevAim: Vec | null = null;
  private frames = 0;

  /** input は normalizeFrame 済みであること */
  push(input: FrameInput): void {
    const code = encodeFrame(input, this.prevAim);
    this.prevAim = input.aimScreen ? { ...input.aimScreen } : null;
    this.frames += 1;
    if (code === this.lastCode) {
      this.lastCount += 1;
      return;
    }
    this.flushRun();
    this.lastCode = code;
    this.lastCount = 1;
  }

  get frameCount(): number {
    return this.frames;
  }

  toString(): string {
    const pending = this.lastCode === null ? [] : [runText(this.lastCode, this.lastCount)];
    return [...this.runs, ...pending].join(RUN_SEP);
  }

  private flushRun(): void {
    if (this.lastCode === null) return;
    this.runs.push(runText(this.lastCode, this.lastCount));
  }
}

function runText(code: string, count: number): string {
  return count === 1 ? code : `${count}${COUNT_SEP}${code}`;
}

export function encodeInputs(inputs: readonly FrameInput[]): string {
  const enc = new InputEncoder();
  for (const input of inputs) enc.push(normalizeFrame(input));
  return enc.toString();
}

export function decodeInputs(text: string): FrameInput[] {
  const out: FrameInput[] = [];
  if (text.length === 0) return out;
  let aim: Vec | null = null;
  for (const run of text.split(RUN_SEP)) {
    const star = run.indexOf(COUNT_SEP);
    const count = star < 0 ? 1 : Number(run.slice(0, star));
    if (!Number.isInteger(count) || count < 1) throw new Error(`replay: bad run "${run}"`);
    const parsed = parseCode(star < 0 ? run : run.slice(star + 1));
    for (let i = 0; i < count; i++) {
      if (parsed.aim.kind === "null") aim = null;
      else if (parsed.aim.kind === "abs") aim = { x: parsed.aim.x, y: parsed.aim.y };
      else {
        if (!aim) throw new Error("replay: aim delta without base");
        aim = { x: aim.x + parsed.aim.x, y: aim.y + parsed.aim.y };
      }
      out.push(frameFromParsed(parsed, aim));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ロードアウト（装備スナップショット）
// ---------------------------------------------------------------------------

export function captureLoadout(profile: Profile, skillProfile: SkillProfile): ReplayLoadout {
  return {
    equipment: structuredClone(profile.equipment),
    skillStones: skillProfile.loadout.map((_, i) => {
      const stone = stoneInSlot(skillProfile, i);
      return stone ? structuredClone(stone) : null;
    }),
    stashCount: profile.stash.length,
    stoneCount: skillProfile.stones.length,
  };
}

function equipmentSignature(equipment: Equipment): string {
  return JSON.stringify(equipment);
}

function loadoutSignature(l: ReplayLoadout): string {
  return JSON.stringify([l.equipment, l.skillStones, l.stashCount, l.stoneCount]);
}

function allocSignature(alloc: Attributes): string {
  return JSON.stringify(ATTR_KEYS.map((k) => alloc[k]));
}

const PLACEHOLDER_ID_PREFIX = "replay-placeholder-";
const PLACEHOLDER_SKILL_KEY = SKILL_KEYS[0];

/** stash 件数を合わせるためだけのダミー。シミュレーションは stash の件数しか見ない */
function placeholderItem(index: number): Item {
  return {
    id: `${PLACEHOLDER_ID_PREFIX}${index}`,
    seed: 0,
    baseKey: "placeholder",
    slot: SLOTS[0],
    rarity: "normal",
    itemLevel: 0,
    name: "placeholder",
    implicit: null,
    affixes: [],
    foundDepth: 0,
    foundAt: 0,
  };
}

function placeholderStone(index: number): SkillStone {
  return {
    id: `${PLACEHOLDER_ID_PREFIX}${index}`,
    seed: 0,
    skillKey: PLACEHOLDER_SKILL_KEY,
    variants: [],
    links: 0,
    foundDepth: 0,
    foundAt: 0,
  };
}

/** 件数を count に合わせる（多ければ末尾から削り、少なければダミーで埋める） */
function resizeWith<T>(list: T[], count: number, make: (i: number) => T): void {
  if (list.length > count) list.length = count;
  while (list.length < count) list.push(make(list.length));
}

/** 再生用の一時プロフィールにロードアウトを反映する。skillProfile は state.skills が参照しているので同じオブジェクトを書き換える */
function applyLoadout(profile: Profile, skillProfile: SkillProfile, loadout: ReplayLoadout): void {
  profile.equipment = structuredClone(loadout.equipment);
  resizeWith(profile.stash, loadout.stashCount, placeholderItem);

  const equipped = loadout.skillStones.map((s) => (s ? structuredClone(s) : null));
  const stones = equipped.filter((s): s is SkillStone => s !== null);
  resizeWith(stones, Math.max(loadout.stoneCount, stones.length), placeholderStone);
  skillProfile.stones = stones;
  skillProfile.loadout = equipped.map((s) => (s ? s.id : null));
}

export function createReplayProfiles(snapshot: ReplayLoadout): { profile: Profile; skillProfile: SkillProfile } {
  const profile = createEmptyProfile();
  const skillProfile: SkillProfile = { version: 1, loadout: [], stones: [] };
  applyLoadout(profile, skillProfile, snapshot);
  return { profile, skillProfile };
}

// ---------------------------------------------------------------------------
// 記録
// ---------------------------------------------------------------------------

export interface RecorderOptions {
  seedText: string;
  startedAt: number;
  daily: boolean;
  /** 起点と縛り。省略時は放浪者・縛りなし */
  setup?: RunSetup;
}

export class ReplayRecorder {
  private readonly encoder = new InputEncoder();
  private readonly events: ReplayEvent[] = [];
  private readonly snapshot: ReplayLoadout;
  private lastSignature: string;
  private lastEquipmentSignature: string;
  /** ラン開始時は振り分け 0（createGame が作る） */
  private lastAllocSignature = allocSignature(uniformAttributes(0));

  constructor(
    private readonly options: RecorderOptions,
    profile: Profile,
    skillProfile: SkillProfile,
  ) {
    this.snapshot = captureLoadout(profile, skillProfile);
    this.lastSignature = loadoutSignature(this.snapshot);
    this.lastEquipmentSignature = equipmentSignature(this.snapshot.equipment);
  }

  /**
   * 装備画面を触った後に呼ぶ。前回から変わっていれば次の step の直前に適用するイベントとして積む。
   * state.profile / state.skills.profile / state.runAttributes.alloc を見る
   */
  noteLoadout(state: GameState): void {
    const loadout = captureLoadout(state.profile, state.skills.profile);
    const signature = loadoutSignature(loadout);
    const allocSig = allocSignature(state.runAttributes.alloc);
    const allocChanged = allocSig !== this.lastAllocSignature;
    if (signature === this.lastSignature && !allocChanged) return;
    this.lastSignature = signature;
    this.lastAllocSignature = allocSig;
    const eqSig = equipmentSignature(loadout.equipment);
    const equipmentChanged = eqSig !== this.lastEquipmentSignature;
    this.lastEquipmentSignature = eqSig;
    const p = state.player;
    const player = equipmentChanged || allocChanged ? { hp: p.hp, dashChargesLeft: p.dashChargesLeft, mana: p.mana } : null;
    const alloc = allocChanged ? { ...state.runAttributes.alloc } : null;
    this.events.push({ frame: this.encoder.frameCount, loadout, player, alloc });
  }

  /** step に渡す直前に呼ぶ。量子化済みの入力を返すので、それをそのまま step に渡すこと */
  record(input: FrameInput): FrameInput {
    const normalized = normalizeFrame(input);
    this.encoder.push(normalized);
    // step が入力を書き換えても記録済みの値に影響しないよう、渡す側は別オブジェクトにする
    return normalizeFrame(normalized);
  }

  get frameCount(): number {
    return this.encoder.frameCount;
  }

  finish(result: ReplayResult, endedAt: number): ReplayData {
    return {
      version: REPLAY_VERSION,
      seedText: this.options.seedText,
      startedAt: this.options.startedAt,
      endedAt,
      daily: this.options.daily,
      origin: (this.options.setup ?? defaultRunSetup()).origin,
      modifiers: [...(this.options.setup ?? defaultRunSetup()).modifiers],
      ...lockedRelicsField(this.options.setup?.lockedRelics),
      snapshot: structuredClone(this.snapshot),
      events: structuredClone(this.events),
      inputs: this.encoder.toString(),
      frameCount: this.encoder.frameCount,
      result: { ...result },
    };
  }
}

// ---------------------------------------------------------------------------
// 再生
// ---------------------------------------------------------------------------

export interface ReplaySession {
  readonly data: ReplayData;
  readonly state: GameState;
  /** 再生専用の一時プロフィール（本物とは別オブジェクト） */
  readonly profile: Profile;
  readonly skillProfile: SkillProfile;
  readonly inputs: readonly FrameInput[];
  cursor: number;
  eventCursor: number;
  /** 直近に流した入力（照準カーソルの描画用） */
  lastInput: FrameInput;
}

/**
 * このリプレイが今のシミュレーションで再生可能か（記録時の version が現行と一致するか）。
 * 装備システムの再設計など、生成・共鳴のロジックが変わると旧リプレイは入力列を流しても
 * 別の結果になり再生が壊れるため、version が違うものは再生を拒否する。
 * データ自体は sanitizeReplay で捨てずに残すので、UI（main.ts のリプレイ一覧）側でこれを見て
 * 「再生不可（旧バージョン）」の表示にし、再生ボタンを無効化する想定
 */
export function isPlayable(replay: ReplayData): boolean {
  return replay.version === REPLAY_VERSION;
}

export function createReplaySession(data: ReplayData): ReplaySession {
  if (!isPlayable(data)) {
    throw new Error(`replay: unsupported version ${data.version} (current: ${REPLAY_VERSION})`);
  }
  const inputs = decodeInputs(data.inputs);
  if (inputs.length !== data.frameCount) {
    throw new Error(`replay: frame count mismatch (${inputs.length} vs ${data.frameCount})`);
  }
  const { profile, skillProfile } = createReplayProfiles(data.snapshot);
  const setup = { ...sanitizeRunSetup(data.origin, data.modifiers), lockedRelics: sanitizeLockedRelics(data.lockedRelics) };
  const state = createGame(hashSeed(data.seedText), data.seedText, profile, skillProfile, setup);
  return { data, state, profile, skillProfile, inputs, cursor: 0, eventCursor: 0, lastInput: EMPTY_INPUT };
}

export function isReplayFinished(session: ReplaySession): boolean {
  return session.cursor >= session.inputs.length;
}

export function replayProgress(session: ReplaySession): number {
  return session.inputs.length === 0 ? 1 : session.cursor / session.inputs.length;
}

function applyDueEvents(session: ReplaySession): void {
  const events = session.data.events;
  for (;;) {
    const ev = events[session.eventCursor];
    if (!ev || ev.frame > session.cursor) return;
    session.eventCursor += 1;
    applyEvent(session, ev);
  }
}

/** 装備の付け替え → 振り分けの順に反映し、最後に記録時のプレイヤー値で上書きする */
function applyEvent(session: ReplaySession, ev: ReplayEvent): void {
  const state = session.state;
  const equipmentChanged = equipmentSignature(session.profile.equipment) !== equipmentSignature(ev.loadout.equipment);
  applyLoadout(session.profile, session.skillProfile, ev.loadout);
  if (equipmentChanged) applyStats(state, computeStats(session.profile.equipment));
  if (ev.alloc) replayAllocation(state, ev.alloc);
  if (!ev.player) return;
  state.player.hp = ev.player.hp;
  state.player.dashChargesLeft = ev.player.dashChargesLeft;
  if (ev.player.mana !== undefined) state.player.mana = ev.player.mana;
}

/**
 * 記録時の振り分けに追いつくまで allocateAttribute を呼ぶ。実プレイと同じ関数を通すので
 * 浮き文字が消費する state.rng の回数も一致する（振った順序は記録しないが、回数は同じ）
 */
function replayAllocation(state: GameState, target: Attributes): void {
  for (const key of ALLOC_ORDER) {
    const missing = target[key] - state.runAttributes.alloc[key];
    for (let i = 0; i < missing; i++) {
      if (!allocateAttribute(state, key)) return;
    }
  }
}

/**
 * 記録された入力を 1 フレーム流す。入力を使い切った後は空入力で進める（死亡演出の続き）。
 * 戻り値は入力を消費したかどうか
 */
export function stepReplay(session: ReplaySession, dt: number): boolean {
  if (isReplayFinished(session)) {
    // 死亡で終わったランは演出の続きだけ流す。中断で終わったランはその場で止める
    if (session.state.status === "dead") step(session.state, { ...EMPTY_INPUT, move: { x: 0, y: 0 } }, dt);
    return false;
  }
  applyDueEvents(session);
  const input = session.inputs[session.cursor];
  if (!input) return false;
  session.cursor += 1;
  session.lastInput = input;
  step(session.state, { ...input, move: { ...input.move }, aimScreen: input.aimScreen ? { ...input.aimScreen } : null }, dt);
  return true;
}

// ---------------------------------------------------------------------------
// 再生中の永続化ガード
// ---------------------------------------------------------------------------

/** 再生中に step 内の拾得処理が書き込もうとするキー */
export const GUARDED_STORAGE_KEYS: readonly string[] = [PROFILE_KEY, SKILL_PROFILE_KEY];

/**
 * 再生中だけ、指定キーへの localStorage 書き込みを捨てる。戻り値で元に戻す。
 * step 内の saveProfile / saveSkillProfile は一時プロフィールを保存しようとするため。
 * Storage が無い環境（テスト等）では何もしない
 */
export function guardStorageWrites(keys: readonly string[] = GUARDED_STORAGE_KEYS): () => void {
  if (typeof Storage === "undefined") return () => undefined;
  const proto = Storage.prototype;
  const original = proto.setItem;
  const blocked = new Set(keys);
  proto.setItem = function guardedSetItem(this: Storage, key: string, value: string): void {
    if (blocked.has(key)) return;
    original.call(this, key, value);
  };
  return () => {
    proto.setItem = original;
  };
}

// ---------------------------------------------------------------------------
// デイリーシード
// ---------------------------------------------------------------------------

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_PAD = 2;

/** UTC の YYYY-MM-DD */
export function dailySeedText(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(DATE_PAD, "0");
  const d = String(now.getUTCDate()).padStart(DATE_PAD, "0");
  return `${y}-${m}-${d}`;
}

export function isDailySeedText(seedText: string): boolean {
  return DAILY_RE.test(seedText);
}

// ---------------------------------------------------------------------------
// 保存データの検証
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isItemLike(v: unknown): v is Item {
  return isRecord(v) && typeof v.id === "string" && typeof v.slot === "string" && Array.isArray(v.affixes);
}

function isStoneLike(v: unknown): v is SkillStone {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.skillKey === "string" &&
    (SKILL_KEYS as readonly string[]).includes(v.skillKey) &&
    Array.isArray(v.variants) &&
    isFiniteNumber(v.links)
  );
}

function sanitizeLoadout(v: unknown): ReplayLoadout | null {
  if (!isRecord(v) || !isRecord(v.equipment) || !Array.isArray(v.skillStones)) return null;
  if (!isFiniteNumber(v.stashCount) || !isFiniteNumber(v.stoneCount)) return null;
  const equipment: Partial<Equipment> = {};
  for (const slot of SLOTS) {
    const item: unknown = v.equipment[slot];
    if (item === null || item === undefined) equipment[slot] = null;
    else if (isItemLike(item) && item.slot === slot) equipment[slot] = item;
    else return null;
  }
  const skillStones: (SkillStone | null)[] = [];
  for (const s of v.skillStones) {
    if (s === null) skillStones.push(null);
    else if (isStoneLike(s)) skillStones.push(s);
    else return null;
  }
  return {
    equipment: { ...createEmptyProfile().equipment, ...equipment },
    skillStones,
    stashCount: Math.max(0, Math.floor(v.stashCount)),
    stoneCount: Math.max(0, Math.floor(v.stoneCount)),
  };
}

/** 壊れていれば undefined（イベントごと捨てる） */
function sanitizePlayer(v: unknown): ReplayEvent["player"] | undefined {
  if (v === null || v === undefined) return null;
  if (!isRecord(v) || !isFiniteNumber(v.hp) || !isFiniteNumber(v.dashChargesLeft)) return undefined;
  if (v.mana === undefined) return { hp: v.hp, dashChargesLeft: v.dashChargesLeft };
  if (!isFiniteNumber(v.mana)) return undefined;
  return { hp: v.hp, dashChargesLeft: v.dashChargesLeft, mana: v.mana };
}

/** 振り分けは各ステータス 0 以上の整数。旧版（alloc 欠損）は null、壊れていれば undefined */
function sanitizeAlloc(v: unknown): Attributes | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isRecord(v)) return undefined;
  const out = uniformAttributes(0);
  for (const key of ATTR_KEYS) {
    const n = v[key];
    if (!isFiniteNumber(n) || n < 0 || !Number.isInteger(n)) return undefined;
    out[key] = n;
  }
  return out;
}

function sanitizeEvent(v: unknown): ReplayEvent | null {
  if (!isRecord(v) || !isFiniteNumber(v.frame)) return null;
  const loadout = sanitizeLoadout(v.loadout);
  if (!loadout) return null;
  const player = sanitizePlayer(v.player);
  const alloc = sanitizeAlloc(v.alloc);
  if (player === undefined || alloc === undefined) return null;
  return { frame: v.frame, loadout, player, alloc };
}

/**
 * 保存データを検証して ReplayData にする。壊れていれば null。
 * version が現行と違っても構造が正しければ一覧に残すため null にはしない（再生可否は isPlayable で見る）
 */
/** 除外遺物があるときだけ書く（旧データ・依頼を持たないランの形を変えない） */
function lockedRelicsField(keys: readonly string[] | undefined): Pick<ReplayData, "lockedRelics"> {
  return keys !== undefined && keys.length > 0 ? { lockedRelics: [...keys] } : {};
}

export function sanitizeReplay(v: unknown): ReplayData | null {
  if (!isRecord(v) || !isFiniteNumber(v.version)) return null;
  const { seedText, startedAt, endedAt, daily, inputs, frameCount, result } = v;
  if (typeof seedText !== "string" || typeof inputs !== "string") return null;
  if (!isFiniteNumber(startedAt) || !isFiniteNumber(endedAt) || !isFiniteNumber(frameCount)) return null;
  if (!isRecord(result) || !isFiniteNumber(result.depth) || !isFiniteNumber(result.kills) || !isFiniteNumber(result.score)) {
    return null;
  }
  const snapshot = sanitizeLoadout(v.snapshot);
  if (!snapshot || !Array.isArray(v.events)) return null;
  const events: ReplayEvent[] = [];
  for (const raw of v.events) {
    const ev = sanitizeEvent(raw);
    if (!ev) return null;
    events.push(ev);
  }
  const setup = sanitizeRunSetup(v.origin, v.modifiers);
  return {
    version: v.version,
    seedText,
    startedAt,
    endedAt,
    daily: daily === true,
    origin: setup.origin,
    modifiers: setup.modifiers,
    ...lockedRelicsField(sanitizeLockedRelics(v.lockedRelics)),
    snapshot,
    events,
    inputs,
    frameCount,
    result: { depth: result.depth, kills: result.kills, score: result.score },
  };
}
