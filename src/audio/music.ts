/**
 * Web Audio 合成のループ BGM（docs/ideas/meta-and-weapons.md 8-11〜8-13）。
 * - 曲はバイオーム（フロア種別）ごとの基調 + ボス曲。交戦中は打楽器の層が入り、交戦が終わると解決の和音に着地する
 * - ゲームの state は音楽を知らない。main.ts が state を読んで musicCue を作り、MusicPlayer.update に渡す
 * - 曲の揺らぎ（移調・分散和音の起点）はラン seed と深度のハッシュで決まるので、リプレイでも同じ曲になる
 * - スロー中（8-15）は曲全体に低域通過を掛けてこもらせ、戻る瞬間に開く
 * - 切り替えでフェードし終えた曲は、残響の輪（ディレイ ↔ フィードバック）も含めて全ノードを外す
 * - Math.random は使わない（打楽器のノイズバッファだけ synth.ts が作る）
 */
import type { FloorKind } from "../core/state";
import { MUSIC, SFX_WAVE3 } from "../data/tuning";
import { applyEnvelope, createFilter, createGainNode, createNoiseSource, createOsc, pitchSweep, safeStopTime } from "./synth";

export type TrackKey = FloorKind | "boss";

/** 1 小節 = 16 分音符 16 個 */
export const STEPS_PER_BAR = 16;
/** 分散和音・旋律は 8 分音符（16 分の 2 つごと） */
const EIGHTH = 2;
const EIGHTHS_PER_BAR = STEPS_PER_BAR / EIGHTH;
const SEMITONES_PER_OCTAVE = 12;
const A4_MIDI = 69;
const A4_FREQ = 440;
const SECONDS_PER_MINUTE = 60;
/** 1 拍 = 16 分音符 4 個 */
const STEPS_PER_BEAT = 4;
/** 休符 */
const REST = -99;

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
} as const;

export interface TrackDef {
  bpm: number;
  /** 主音の MIDI 番号（低音の音域） */
  root: number;
  scale: readonly number[];
  /** 小節ごとの和音の根音（音階の度数、0 始まり） */
  progression: readonly number[];
  /** 8 分音符ごとの分散和音（和音の根音からの度数。REST は休符）。8 個 = 1 小節 */
  arp: readonly number[];
  /** 旋律（ボス曲など。8 分音符ごと、主音からの度数）。無ければ鳴らさない */
  lead?: readonly number[];
  arpOctave: number;
  droneWave: OscillatorType;
  arpWave: OscillatorType;
  droneGain: number;
  padGain: number;
  arpGain: number;
  leadGain: number;
  /** 曲全体のローパス（暗い階ほど低い） */
  cutoff: number;
  /** 残響（ディレイの戻り 0..1）。洞窟・氷河は多め */
  echo: number;
  /** 打楽器（16 文字。k = 低い太鼓、s = 小太鼓、h = 金物、. = 休み） */
  perc: string;
}

const R = REST;

/** 曲の表。数値は音楽の中身（音階・旋律）なので tuning ではなくここに置く（sfx.ts の TUNING と同じ扱い） */
export const TRACKS: Readonly<Record<TrackKey, TrackDef>> = {
  rooms: {
    bpm: 84, root: 45, scale: SCALES.dorian, progression: [0, 5, 3, 4],
    arp: [0, 2, 4, 7, 4, 2, R, 2], arpOctave: 2, droneWave: "triangle", arpWave: "triangle",
    droneGain: 0.5, padGain: 0.12, arpGain: 0.16, leadGain: 0, cutoff: 2400, echo: 0.2, perc: "k...h.s.k.k.h.s.",
  },
  cave: {
    bpm: 72, root: 38, scale: SCALES.minor, progression: [0, 0, 5, 6],
    arp: [0, R, 4, R, 7, R, 4, 2], arpOctave: 2, droneWave: "sine", arpWave: "sine",
    droneGain: 0.55, padGain: 0.1, arpGain: 0.18, leadGain: 0, cutoff: 1600, echo: 0.5, perc: "k.......k..s....",
  },
  dark: {
    bpm: 60, root: 33, scale: SCALES.phrygian, progression: [0, 1, 0, 6],
    arp: [0, R, R, R, 1, R, R, R], arpOctave: 1, droneWave: "sawtooth", arpWave: "sine",
    droneGain: 0.45, padGain: 0, arpGain: 0.14, leadGain: 0, cutoff: 600, echo: 0.35, perc: "k.......k.......",
  },
  forge: {
    bpm: 96, root: 40, scale: SCALES.phrygian, progression: [0, 1, 0, 5],
    arp: [0, 0, 4, 0, 1, 0, 4, 2], arpOctave: 1, droneWave: "sawtooth", arpWave: "square",
    droneGain: 0.4, padGain: 0.06, arpGain: 0.1, leadGain: 0, cutoff: 1400, echo: 0.15, perc: "k.k.s..kk.k.s.h.",
  },
  ossuary: {
    bpm: 78, root: 47, scale: SCALES.harmonicMinor, progression: [0, 3, 6, 4],
    arp: [0, 2, 4, 2, 6, 4, 2, R], arpOctave: 1, droneWave: "triangle", arpWave: "square",
    droneGain: 0.45, padGain: 0.08, arpGain: 0.09, leadGain: 0, cutoff: 1800, echo: 0.3, perc: "k...s...k.h.s...",
  },
  swamp: {
    bpm: 70, root: 43, scale: SCALES.minor, progression: [0, 3, 0, 4],
    arp: [0, R, 2, 4, R, 2, R, 1], arpOctave: 2, droneWave: "triangle", arpWave: "sine",
    droneGain: 0.5, padGain: 0.12, arpGain: 0.15, leadGain: 0, cutoff: 1200, echo: 0.4, perc: "k..h..s.k..h..s.",
  },
  glacier: {
    bpm: 66, root: 42, scale: SCALES.lydian, progression: [0, 1, 4, 0],
    arp: [7, 4, 2, 4, 9, 7, 4, R], arpOctave: 2, droneWave: "sine", arpWave: "sine",
    droneGain: 0.45, padGain: 0.14, arpGain: 0.16, leadGain: 0, cutoff: 3200, echo: 0.55, perc: "k.......h...s...",
  },
  mine: {
    bpm: 100, root: 36, scale: SCALES.mixolydian, progression: [0, 6, 3, 4],
    arp: [0, 4, 7, 4, 0, 4, 6, 4], arpOctave: 2, droneWave: "square", arpWave: "square",
    droneGain: 0.25, padGain: 0.06, arpGain: 0.08, leadGain: 0, cutoff: 2000, echo: 0.2, perc: "k.h.s.h.k.hks.h.",
  },
  meadow: {
    bpm: 88, root: 43, scale: SCALES.major, progression: [0, 3, 5, 4],
    arp: [0, 2, 4, 2, 7, 4, 2, 4], arpOctave: 2, droneWave: "triangle", arpWave: "triangle",
    droneGain: 0.45, padGain: 0.14, arpGain: 0.15, leadGain: 0, cutoff: 3000, echo: 0.25, perc: "k...h.s.k.h.h.s.",
  },
  boss: {
    bpm: 132, root: 36, scale: SCALES.harmonicMinor, progression: [0, 0, 5, 4],
    arp: [0, 0, 4, 0, 7, 0, 4, 0], arpOctave: 1, droneWave: "sawtooth", arpWave: "sawtooth",
    droneGain: 0.35, padGain: 0.06, arpGain: 0.08, leadGain: 0.12, cutoff: 2600, echo: 0.2, perc: "k.hsk.h.kkhsk.hs",
    lead: [7, R, 6, 7, 9, R, 7, R, 4, R, 5, 4, 3, R, 2, R, 7, R, 6, 7, 11, R, 9, R, 7, 9, 7, 6, 7, R, R, R],
  },
};

// -----------------------------------------------------------------------------
// 曲の選択（純関数。テスト: src/audio/music.test.ts）
// -----------------------------------------------------------------------------

export interface TrackChoice {
  track: TrackKey;
  /** 打楽器の層を入れるか（交戦中・ボス戦） */
  combat: boolean;
}

/** 拠点の曲。拠点は戦わない休息の場なので、既存曲のうちテンポが遅く打楽器の薄い氷河の曲を流用する */
export const HUB_TRACK: TrackKey = "glacier";

/** フロア種別・交戦中か・ボス戦中か から曲を選ぶ。ボス戦はボス曲で常に打楽器入り。拠点は交戦が無いので打楽器なし */
export function pickTrack(floorKind: FloorKind, engaged: boolean, boss: boolean, hub = false): TrackChoice {
  if (hub) return { track: HUB_TRACK, combat: false };
  if (boss) return { track: "boss", combat: true };
  return { track: floorKind, combat: engaged };
}

/** main.ts が state から集める入力（state 全体を渡さない） */
export interface MusicInput {
  /** ラン中（プレイ中・一時停止中・祝福の選択中）。false ならタイトル・死亡などで止める */
  inRun: boolean;
  floorKind: FloorKind;
  engaged: boolean;
  /** ボスが生きていて交戦している */
  boss: boolean;
  /** ボスがダウン中（テンポが上がる） */
  bossDown: boolean;
  seed: number;
  depth: number;
  /** スローモーション中（ラストキル・見切り）。音楽に低域通過を掛けてこもらせる（8-15）。省略は false */
  slowmo?: boolean;
  /** 拠点にいる（HUB_TRACK を流す）。省略は false */
  hub?: boolean;
}

export interface MusicCue {
  /** null = 鳴らさない */
  track: TrackKey | null;
  combat: boolean;
  tempoMul: number;
  transpose: number;
  /** 分散和音の起点のずれ（同じバイオームでもランごとに少し違う） */
  arpShift: number;
  /** 低域通過でこもらせる（スロー中） */
  muffle: boolean;
}

/** 32bit の整数ハッシュ（seed と深度を混ぜる） */
function mixHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x85ebca6b, 0x27d4eb2d) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return h >>> 0;
}

/** 移調の幅（±2 半音）と分散和音の起点（0..3）。seed と深度だけで決まる */
const TRANSPOSE_SPAN = 5;
const TRANSPOSE_CENTER = 2;
const ARP_SHIFTS = 4;
const ARP_SHIFT_BITS = 8;

export function trackVariant(seed: number, depth: number): { transpose: number; arpShift: number } {
  const h = mixHash(seed >>> 0, depth);
  return { transpose: (h % TRANSPOSE_SPAN) - TRANSPOSE_CENTER, arpShift: (h >>> ARP_SHIFT_BITS) % ARP_SHIFTS };
}

export function musicCue(input: Readonly<MusicInput>): MusicCue {
  if (!input.inRun) return { track: null, combat: false, tempoMul: 1, transpose: 0, arpShift: 0, muffle: false };
  const choice = pickTrack(input.floorKind, input.engaged, input.boss, input.hub === true);
  // ボス曲と拠点の曲は移調しない（固定の旋律として覚えさせる）。バイオーム曲だけ seed で揺らす
  const fixed = choice.track === "boss" || input.hub === true;
  const variant = fixed ? { transpose: 0, arpShift: 0 } : trackVariant(input.seed, input.depth);
  const tempoMul = input.boss && input.bossDown ? MUSIC.bossDownTempoMul : 1;
  return { track: choice.track, combat: choice.combat, tempoMul, ...variant, muffle: input.slowmo === true };
}

// -----------------------------------------------------------------------------
// 音の高さの計算（純関数）
// -----------------------------------------------------------------------------

/** 音階の度数 → 主音からの半音数（7 以上・負の度数はオクターブを回り込む） */
export function degreeSemitone(scale: readonly number[], degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return (scale[idx] ?? 0) + octave * SEMITONES_PER_OCTAVE;
}

export function midiToFreq(midi: number): number {
  return A4_FREQ * 2 ** ((midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
}

/** 16 分音符 1 つの秒 */
export function stepSeconds(bpm: number, tempoMul: number): number {
  return SECONDS_PER_MINUTE / (bpm * Math.max(0.1, tempoMul)) / STEPS_PER_BEAT;
}

/** 1 ステップで鳴らす音（テストできるよう、Web Audio を触らずに列挙する） */
export interface StepNotes {
  drone: number | null;
  pad: readonly number[];
  arp: number | null;
  lead: number | null;
  perc: "k" | "s" | "h" | null;
}

function percAt(pattern: string, step: number): StepNotes["perc"] {
  const c = pattern[step % STEPS_PER_BAR];
  return c === "k" || c === "s" || c === "h" ? c : null;
}

/** ステップ番号 → 鳴らす MIDI 番号（null = 鳴らさない）。combat でなければ打楽器は null */
export function notesAt(def: Readonly<TrackDef>, step: number, cue: Pick<MusicCue, "combat" | "transpose" | "arpShift">): StepNotes {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const inBar = step % STEPS_PER_BAR;
  const chord = def.progression[bar % def.progression.length] ?? 0;
  const base = def.root + cue.transpose;
  const at = (degree: number, octave: number): number => base + octave * SEMITONES_PER_OCTAVE + degreeSemitone(def.scale, degree);
  const barStart = inBar === 0;
  const eighth = inBar % EIGHTH === 0;
  const arpDegree = eighth ? def.arp[(inBar / EIGHTH + cue.arpShift) % def.arp.length] : undefined;
  const leadIndex = bar * EIGHTHS_PER_BAR + inBar / EIGHTH;
  const leadDegree = eighth && def.lead ? def.lead[leadIndex % def.lead.length] : undefined;
  return {
    drone: barStart ? at(chord, 0) : null,
    pad: barStart && def.padGain > 0 ? [at(chord, 1), at(chord + 2, 1), at(chord + 4, 1)] : [],
    arp: arpDegree !== undefined && arpDegree !== REST ? at(chord + arpDegree, def.arpOctave) : null,
    lead: leadDegree !== undefined && leadDegree !== REST ? at(leadDegree, def.arpOctave + 1) : null,
    perc: cue.combat ? percAt(def.perc, inBar) : null,
  };
}

/** 解決の和音（主音の 3 和音 + オクターブ）。制圧の瞬間に鳴らす */
export function resolveChord(def: Readonly<TrackDef>, transpose: number): number[] {
  const base = def.root + transpose + SEMITONES_PER_OCTAVE * 2;
  return [0, 2, 4, 7].map((d) => base + degreeSemitone(def.scale, d));
}

// -----------------------------------------------------------------------------
// 再生（Web Audio）
// -----------------------------------------------------------------------------

/** 音の長さ・立ち上がり（秒）。曲の手触りの定数 */
const VOICE = {
  droneAttack: 0.4,
  padAttack: 0.25,
  arpDur: 0.22,
  leadDur: 0.2,
  kick: { from: 150, to: 45, dur: 0.14, peak: 0.55 },
  snare: { freq: 1800, dur: 0.1, peak: 0.3, bodyFreq: 190, bodyPeak: 0.12 },
  hat: { freq: 7000, dur: 0.03, peak: 0.12 },
  resolveGain: 0.13,
  echoDelay: 0.28,
  echoMaxFeedback: 0.6,
  minRamp: 0.0001,
} as const;

function playNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  type: OscillatorType,
  midi: number,
  start: number,
  dur: number,
  peak: number,
  attack = 0.01,
): void {
  const gain = createGainNode(ctx, dest);
  const osc = createOsc(ctx, gain, type, midiToFreq(midi));
  osc.frequency.setValueAtTime(midiToFreq(midi), start);
  applyEnvelope(gain, ctx, start, Math.max(0, dur - attack), { attack, decay: 0.05, sustain: 0.7, release: dur * 0.4, peak });
  osc.start(start);
  osc.stop(safeStopTime(start, dur * 1.5 + attack));
}

function playPerc(ctx: BaseAudioContext, dest: AudioNode, kind: "k" | "s" | "h", start: number): void {
  if (kind === "k") {
    const g = createGainNode(ctx, dest);
    const osc = createOsc(ctx, g, "sine", VOICE.kick.from);
    pitchSweep(osc, ctx, start, VOICE.kick.from, VOICE.kick.to, VOICE.kick.dur);
    applyEnvelope(g, ctx, start, 0, { attack: 0.002, decay: VOICE.kick.dur * 0.6, release: VOICE.kick.dur * 0.4, peak: VOICE.kick.peak });
    osc.start(start);
    osc.stop(safeStopTime(start, VOICE.kick.dur));
    return;
  }
  const c = kind === "s" ? VOICE.snare : VOICE.hat;
  const g = createGainNode(ctx, dest);
  const filter = createFilter(ctx, g, kind === "s" ? "bandpass" : "highpass", c.freq);
  const noise = createNoiseSource(ctx, filter);
  applyEnvelope(g, ctx, start, 0, { attack: 0.001, decay: c.dur * 0.6, release: c.dur * 0.4, peak: c.peak });
  noise.start(start);
  noise.stop(safeStopTime(start, c.dur));
  if (kind !== "s") return;
  // 小太鼓の胴鳴り
  const body = createGainNode(ctx, dest);
  const osc = createOsc(ctx, body, "triangle", VOICE.snare.bodyFreq);
  osc.frequency.setValueAtTime(VOICE.snare.bodyFreq, start);
  applyEnvelope(body, ctx, start, 0, { attack: 0.001, decay: c.dur * 0.5, release: c.dur * 0.5, peak: VOICE.snare.bodyPeak });
  osc.start(start);
  osc.stop(safeStopTime(start, c.dur));
}

/** 1 曲ぶんのノード群と予約の進み */
class TrackVoice {
  readonly out: GainNode;
  private readonly music: BiquadFilterNode;
  private readonly perc: GainNode;
  /**
   * この曲が作った常駐ノード（出力・フィルタ・打楽器の層・残響のディレイ / フィードバック / 戻り）。
   * ディレイとフィードバックは互いに繋がった輪なので、出力だけ外しても輪が残る。切り替え後に全部外して参照を捨てる
   */
  private nodes: AudioNode[] = [];
  private step = 0;
  private nextTime: number;
  private combat = false;
  /** フェードアウト中なら消し終わる時刻 */
  endAt: number | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    readonly key: string,
    private readonly def: TrackDef,
    private cue: MusicCue,
  ) {
    const now = ctx.currentTime;
    this.out = createGainNode(ctx, dest);
    this.out.gain.setValueAtTime(VOICE.minRamp, now);
    this.out.gain.linearRampToValueAtTime(1, now + MUSIC.crossfade);
    this.music = createFilter(ctx, this.out, "lowpass", def.cutoff);
    this.perc = createGainNode(ctx, this.out);
    this.nodes.push(this.out, this.music, this.perc);
    this.connectEcho(def.echo);
    this.nextTime = now + MUSIC.percFade / 2;
  }

  /** 残響: 曲のバスからディレイへ送り、戻りを出力へ */
  private connectEcho(amount: number): void {
    if (amount <= 0) return;
    const delay = this.ctx.createDelay(1);
    delay.delayTime.setValueAtTime(VOICE.echoDelay, this.ctx.currentTime);
    const feedback = this.ctx.createGain();
    feedback.gain.setValueAtTime(Math.min(VOICE.echoMaxFeedback, amount), this.ctx.currentTime);
    this.music.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    const wet = this.ctx.createGain();
    wet.gain.setValueAtTime(amount, this.ctx.currentTime);
    delay.connect(wet);
    wet.connect(this.out);
    this.nodes.push(delay, feedback, wet);
  }

  /** フェードし終えた曲のノードをすべて外す（2 回呼んでも安全） */
  dispose(): void {
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
  }

  setCue(cue: MusicCue): void {
    const wasCombat = this.combat;
    this.cue = cue;
    this.combat = cue.combat;
    if (wasCombat === cue.combat) return;
    const now = this.ctx.currentTime;
    this.perc.gain.cancelScheduledValues(now);
    this.perc.gain.setValueAtTime(this.perc.gain.value, now);
    this.perc.gain.linearRampToValueAtTime(cue.combat ? 1 : 0, now + MUSIC.percFade);
    // 交戦が終わった（制圧・全滅）: 解決の和音に着地する
    if (wasCombat && !cue.combat) this.playResolve(now);
  }

  private playResolve(start: number): void {
    for (const midi of resolveChord(this.def, this.cue.transpose)) {
      playNote(this.ctx, this.music, "triangle", midi, start, MUSIC.resolveTime, VOICE.resolveGain, 0.02);
    }
  }

  /** until までの拍を予約する。遅れすぎていたら今から打ち直す */
  schedule(until: number): void {
    const now = this.ctx.currentTime;
    if (this.nextTime < now - MUSIC.resyncGap) this.nextTime = now;
    const dur = stepSeconds(this.def.bpm, this.cue.tempoMul);
    while (this.nextTime < until) {
      this.playStep(this.step, this.nextTime, dur);
      this.step += 1;
      this.nextTime += dur;
    }
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const n = notesAt(this.def, step, this.cue);
    const d = this.def;
    const barDur = stepDur * STEPS_PER_BAR;
    if (n.drone !== null) playNote(this.ctx, this.music, d.droneWave, n.drone, t, barDur, d.droneGain * 0.3, VOICE.droneAttack);
    for (const midi of n.pad) playNote(this.ctx, this.music, "triangle", midi, t, barDur, d.padGain * 0.3, VOICE.padAttack);
    if (n.arp !== null) playNote(this.ctx, this.music, d.arpWave, n.arp, t, VOICE.arpDur, d.arpGain);
    if (n.lead !== null) playNote(this.ctx, this.music, "square", n.lead, t, VOICE.leadDur, d.leadGain);
    if (n.perc !== null) playPerc(this.ctx, this.perc, n.perc, t);
  }

  fadeOut(): void {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(Math.max(VOICE.minRamp, this.out.gain.value), now);
    this.out.gain.linearRampToValueAtTime(VOICE.minRamp, now + MUSIC.crossfade);
    this.endAt = now + MUSIC.crossfade;
  }
}

/**
 * 音楽の再生。AudioContext は効果音（SfxPlayer）と共有する（main.ts が getContext で渡す）。
 * 毎フレーム update(cue) を呼ぶと、曲の切り替え・打楽器の出し入れ・先読みの予約をする
 */
export class MusicPlayer {
  private master: GainNode | null = null;
  /** 曲全体のこもり（8-15）。master → muffle → 出力 */
  private muffle: BiquadFilterNode | null = null;
  private muffled = false;
  private masterCtx: BaseAudioContext | null = null;
  private current: TrackVoice | null = null;
  private fading: TrackVoice[] = [];
  private volume: number = MUSIC.defaultVolume;
  private muted = false;

  constructor(private readonly getContext: () => BaseAudioContext | null) {}

  /** 0..1（main.ts が 設定の音量 × 音楽の音量 を渡す） */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** 今鳴っている曲（テスト・デバッグ用） */
  currentKey(): string | null {
    return this.current?.key ?? null;
  }

  private applyGain(): void {
    if (!this.master || !this.masterCtx) return;
    const level = this.muted ? 0 : this.volume * MUSIC.gain;
    this.master.gain.setValueAtTime(level, this.masterCtx.currentTime);
  }

  private ensureMaster(ctx: BaseAudioContext): GainNode {
    if (this.master && this.masterCtx === ctx) return this.master;
    this.muffle = createFilter(ctx, ctx.destination, "lowpass", SFX_WAVE3.muffle.open);
    this.muffled = false;
    this.master = createGainNode(ctx, this.muffle);
    this.masterCtx = ctx;
    this.applyGain();
    return this.master;
  }

  /** こもりの今の上限周波数（テスト・デバッグ用）。AudioContext が無ければ null */
  muffleCutoff(): number | null {
    return this.muffle?.frequency.value ?? null;
  }

  /** スロー中は素早く閉じ、戻る瞬間はゆっくり開く（開く方を遅くして「戻った」手応えを出す） */
  private applyMuffle(ctx: BaseAudioContext, muffle: boolean): void {
    if (!this.muffle || muffle === this.muffled) return;
    this.muffled = muffle;
    const c = SFX_WAVE3.muffle;
    const f = this.muffle.frequency;
    const now = ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setValueAtTime(Math.max(c.cutoff, f.value), now);
    f.exponentialRampToValueAtTime(muffle ? c.cutoff : c.open, now + (muffle ? c.closeTime : c.openTime));
  }

  update(cue: MusicCue): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const master = this.ensureMaster(ctx);
    this.applyMuffle(ctx, cue.muffle);
    this.dropFaded(ctx.currentTime);
    // ミュート中・ラン外は予約を止める（ミュート解除で頭から鳴り直す）
    if (this.muted || cue.track === null || this.volume <= 0) {
      this.stopCurrent();
      return;
    }
    const key = `${cue.track}|${cue.transpose}|${cue.arpShift}`;
    if (!this.current || this.current.key !== key) {
      this.stopCurrent();
      this.current = new TrackVoice(ctx, master, key, TRACKS[cue.track], cue);
    }
    this.current.setCue(cue);
    this.current.schedule(ctx.currentTime + MUSIC.lookahead);
  }

  private stopCurrent(): void {
    if (!this.current) return;
    this.current.fadeOut();
    this.fading.push(this.current);
    this.current = null;
  }

  /** フェードし終えた曲のノードを外す（タイマーを使わず update のたびに掃除する） */
  private dropFaded(now: number): void {
    this.fading = this.fading.filter((v) => {
      if (v.endAt === null || v.endAt > now) return true;
      v.dispose();
      return false;
    });
  }
}
