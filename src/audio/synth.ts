/**
 * 低レベルの Web Audio 合成ユーティリティ。
 * オシレーター、ノイズバッファ、エンベロープ、フィルタ、ピッチスイープなど
 * 効果音を組み立てるための小さな部品を提供する。sfx.ts はこれらを組み合わせて
 * 各効果音を定義する。
 */

/** 疑似ランダムなピッチ揺らぎの最大幅（±3%） */
export const PITCH_JITTER_RATIO = 0.03;

/** ノイズバッファの長さの目安（秒）。必要な長さに応じて slice して使う */
const NOISE_BUFFER_SECONDS = 2;

let cachedNoiseBuffer: AudioBuffer | null = null;
let cachedNoiseBufferCtx: BaseAudioContext | null = null;

/**
 * ホワイトノイズ用の AudioBuffer を取得する（AudioContext ごとにキャッシュ）。
 */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (cachedNoiseBuffer !== null && cachedNoiseBufferCtx === ctx) {
    return cachedNoiseBuffer;
  }
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  cachedNoiseBuffer = buffer;
  cachedNoiseBufferCtx = ctx;
  return buffer;
}

/**
 * ノイズバッファを再生する BufferSource を生成して接続する。
 * 呼び出し側が start/stop のタイミングを管理する。
 */
export function createNoiseSource(
  ctx: BaseAudioContext,
  destination: AudioNode,
  loop = false,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  source.loop = loop;
  source.connect(destination);
  return source;
}

/** 音量エンベロープの各段階（秒） */
export interface EnvelopeOptions {
  /** 立ち上がり時間 */
  attack?: number;
  /** attack 後にピークから減衰する時間 */
  decay?: number;
  /** decay 後に維持する音量比（0..1） */
  sustain?: number;
  /** sustain 状態からの解放時間 */
  release?: number;
  /** ピーク音量 */
  peak?: number;
}

const DEFAULT_ENVELOPE: Required<EnvelopeOptions> = {
  attack: 0.005,
  decay: 0.1,
  sustain: 0,
  release: 0.05,
  peak: 1,
};

/** AudioParam の値がゼロ付近になると exponentialRampToValueAtTime が例外を出すための下限 */
const MIN_RAMP_VALUE = 0.0001;

/**
 * GainNode に ADSR 風のエンベロープを適用する。
 * `startAt` から音が始まり、`attack + decay + sustainDuration + release` 経過後に無音へ戻る。
 */
export function applyEnvelope(
  gain: GainNode,
  _ctx: BaseAudioContext,
  startAt: number,
  sustainDuration: number,
  opts: EnvelopeOptions = {},
): number {
  const { attack, decay, sustain, release, peak } = { ...DEFAULT_ENVELOPE, ...opts };
  const g = gain.gain;
  g.cancelScheduledValues(startAt);
  g.setValueAtTime(MIN_RAMP_VALUE, startAt);
  g.linearRampToValueAtTime(peak, startAt + attack);
  const sustainLevel = Math.max(peak * sustain, MIN_RAMP_VALUE);
  g.linearRampToValueAtTime(sustainLevel, startAt + attack + decay);
  const releaseStart = startAt + attack + decay + Math.max(sustainDuration, 0);
  g.setValueAtTime(sustainLevel, releaseStart);
  g.exponentialRampToValueAtTime(MIN_RAMP_VALUE, releaseStart + release);
  return releaseStart + release;
}

/** オシレーターを生成して接続する */
export function createOsc(
  ctx: BaseAudioContext,
  destination: AudioNode,
  type: OscillatorType,
  frequency: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc.connect(destination);
  return osc;
}

/**
 * オシレーターの周波数を指数的にスイープさせる（0 やマイナスは避けて下限を設ける）。
 */
export function pitchSweep(
  osc: OscillatorNode,
  _ctx: BaseAudioContext,
  startAt: number,
  fromFreq: number,
  toFreq: number,
  duration: number,
): void {
  const freq = osc.frequency;
  freq.cancelScheduledValues(startAt);
  freq.setValueAtTime(Math.max(fromFreq, MIN_RAMP_VALUE), startAt);
  freq.exponentialRampToValueAtTime(Math.max(toFreq, MIN_RAMP_VALUE), startAt + duration);
}

/** BiquadFilter を生成して接続する */
export function createFilter(
  ctx: BaseAudioContext,
  destination: AudioNode,
  type: BiquadFilterType,
  frequency: number,
  q = 1,
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, ctx.currentTime);
  filter.Q.setValueAtTime(q, ctx.currentTime);
  filter.connect(destination);
  return filter;
}

/** GainNode を生成して接続する（初期ゲインは 0） */
export function createGainNode(ctx: BaseAudioContext, destination: AudioNode): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.connect(destination);
  return gain;
}

/**
 * 疑似ランダムなピッチ倍率を返す（1 ± PITCH_JITTER_RATIO の範囲）。
 * ゲームロジックの決定性には関与しないため Math.random を使う。
 */
export function jitterPitch(baseRatio = 1): number {
  const offset = (Math.random() * 2 - 1) * PITCH_JITTER_RATIO;
  return baseRatio * (1 + offset);
}

/** 単純な指数フェードアウト（stop 忘れによるノード滞留を避けるための停止タイミング計算用） */
export function safeStopTime(startAt: number, duration: number): number {
  return startAt + Math.max(duration, 0.02);
}

/** 長さの揺らぎ（±5%）。同じ音の連打で耳が疲れないよう、音程と一緒に長さもわずかに変える */
export const DURATION_JITTER_RATIO = 0.05;
/** 音量の揺らぎ（±8%） */
export const LEVEL_JITTER_RATIO = 0.08;

/** 1 ± ratio の範囲の揺らぎ倍率。音の揺らぎ専用（ゲームロジックの決定性には関与しない） */
export function jitterRatio(ratio: number): number {
  return 1 + (Math.random() * 2 - 1) * ratio;
}

/** 打撃系の減衰の終点（ピーク比）。-40dB まで指数で落としてから 0 へ閉じる */
const PERC_FLOOR_RATIO = 0.01;
/** 減衰の終点から無音へ閉じる時間（プチノイズを出さないため） */
const PERC_CLOSE_SECONDS = 0.008;

/**
 * 打撃・斬撃向けの音量エンベロープ。attack で直線に立ち上がり、残りを指数で -40dB まで落とす。
 * ADSR の直線の減衰より「叩いた」感じが出る。無音へ閉じる時刻を返す
 */
export function percEnvelope(gain: GainNode, startAt: number, attack: number, duration: number, peak: number): number {
  const g = gain.gain;
  const a = Math.max(attack, 0.0005);
  const end = startAt + Math.max(duration, a + 0.002);
  g.cancelScheduledValues(startAt);
  g.setValueAtTime(MIN_RAMP_VALUE, startAt);
  g.linearRampToValueAtTime(Math.max(peak, MIN_RAMP_VALUE), startAt + a);
  g.exponentialRampToValueAtTime(Math.max(peak * PERC_FLOOR_RATIO, MIN_RAMP_VALUE), end);
  g.linearRampToValueAtTime(0, end + PERC_CLOSE_SECONDS);
  return end + PERC_CLOSE_SECONDS;
}

/** 歪みの曲線の解像度 */
const DRIVE_CURVE_SAMPLES = 1024;
const driveCurves = new Map<number, Float32Array<ArrayBuffer>>();

/** tanh のソフトクリップ曲線（amount が大きいほど潰れて太くなる）。量ごとにキャッシュ */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const cached = driveCurves.get(amount);
  if (cached) return cached;
  const curve = new Float32Array(DRIVE_CURVE_SAMPLES);
  const norm = Math.tanh(amount);
  for (let i = 0; i < DRIVE_CURVE_SAMPLES; i++) {
    const x = (i / (DRIVE_CURVE_SAMPLES - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / norm;
  }
  driveCurves.set(amount, curve);
  return curve;
}

/**
 * 軽いサチュレーション（WaveShaper）を作って destination へ繋ぐ。
 * 打撃のボディ・爆発・銃声を「ビープ」でなく太い音にするため
 */
export function createDrive(ctx: BaseAudioContext, destination: AudioNode, amount: number): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(amount);
  shaper.oversample = "2x";
  shaper.connect(destination);
  return shaper;
}
