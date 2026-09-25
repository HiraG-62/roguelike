/**
 * 層（ノイズ・単音・スイープ・分散和音・和音・キック・クリック・金属・FM・パチパチ・泡）を並べて 1 つの効果音にする小さな合成器。
 * 新しい効果音は sfxLayers.ts の表に層を足すだけで作れる（sfx.ts の個別関数を増やさない）。
 * 打撃・斬撃は「トランジェント（click）+ ボディ（kick / 歪ませた noise）+ テール（遅れて減衰する noise）」の 3 層で組む。
 * 音の揺らぎ（synth.ts の jitterPitch / jitterRatio）以外で Math.random は使わない
 */
import {
  DURATION_JITTER_RATIO,
  LEVEL_JITTER_RATIO,
  applyEnvelope,
  createDrive,
  createFilter,
  createGainNode,
  createNoiseSource,
  createOsc,
  jitterPitch,
  jitterRatio,
  percEnvelope,
  pitchSweep,
  safeStopTime,
} from "./synth";

/**
 * at は発音開始からの遅れ（秒）。peak は 0..1。
 * - noise: フィルタの周波数を from → to へ掃引したノイズ。attack を伸ばすと「シュッ」の膨らみ、drive で太く歪む
 * - kick: ピッチが from → to へ drop 秒で落ちる正弦波（打撃・爆発の重さ）。drive で歪ませる
 * - click: 数 ms の高域ノイズ（当たった瞬間のトランジェント）
 * - metal: 非整数倍の部分音（高い部分音ほど早く減衰する）。刃鳴り・金属音・結晶
 * - fm: 周波数変調。index（変調の深さ）が時間とともに減り、明るい立ち上がりから丸く落ち着く（鐘・魔法・うねり）
 * - crackle: 短いノイズの粒を不規則な間隔で並べる（炎のパチパチ・雷のバチバチ）
 * - blips: 短いピッチの跳ね上がりを並べる（毒の泡・ちらつき）
 */
export type Layer =
  | { k: "noise"; filter: BiquadFilterType; from: number; to: number; dur: number; peak: number; q?: number; at?: number; attack?: number; drive?: number }
  | { k: "tone"; type: OscillatorType; freq: number; dur: number; peak: number; at?: number }
  | { k: "sweep"; type: OscillatorType; from: number; to: number; dur: number; peak: number; at?: number }
  | { k: "arp"; type: OscillatorType; freqs: readonly number[]; note: number; gap: number; peak: number; at?: number }
  | { k: "chord"; type: OscillatorType; freqs: readonly number[]; dur: number; peak: number; at?: number }
  | { k: "kick"; from: number; to: number; drop: number; dur: number; peak: number; drive?: number; at?: number }
  | { k: "click"; freq: number; peak: number; at?: number }
  | { k: "metal"; freq: number; ratios: readonly number[]; dur: number; peak: number; at?: number }
  | { k: "fm"; freq: number; ratio: number; index: number; dur: number; peak: number; to?: number; at?: number }
  | { k: "crackle"; freq: number; count: number; gap: number; peak: number; q?: number; at?: number }
  | { k: "blips"; type: OscillatorType; from: number; to: number; count: number; note: number; gap: number; peak: number; at?: number };

/** 1 回の発音に共通の揺らぎ（音程・長さ・音量） */
interface Voice {
  pitch: number;
  stretch: number;
  level: number;
}

const MIN_FREQ = 20;
const MAX_FREQ = 18000;
const TAIL_SECONDS = 0.1;
/** noise の既定の立ち上がり（秒） */
const NOISE_ATTACK = 0.002;
/** click の長さと立ち上がり（秒） */
const CLICK_SECONDS = 0.006;
const CLICK_ATTACK = 0.0005;
/** kick の立ち上がり（秒） */
const KICK_ATTACK = 0.001;
/** metal: 部分音が 1 つ上がるごとの音量の落ち方と減衰の速まり方 */
const METAL_LEVEL_FALLOFF = 0.7;
const METAL_DECAY_FALLOFF = 0.4;
/** fm: 変調の深さが最後に残る比（明るさが抜けきらないよう少し残す） */
const FM_INDEX_FLOOR = 0.05;
const FM_ATTACK = 0.002;
/** crackle: 粒 1 つの長さ・帯域の鋭さ・間隔と音程のばらつき */
const CRACKLE_GRAIN = 0.012;
const CRACKLE_Q = 4;
const CRACKLE_GAP_JITTER = 0.45;
const CRACKLE_PITCH_JITTER = 0.25;
/** blips: 粒ごとの音程のばらつき */
const BLIP_PITCH_JITTER = 0.15;
const BLIP_ATTACK = 0.003;

const clampFreq = (f: number): number => Math.min(MAX_FREQ, Math.max(MIN_FREQ, f));

/** drive があれば歪みを挟んだ入口を、無ければ dest をそのまま返す */
function withDrive(ctx: BaseAudioContext, dest: AudioNode, drive: number | undefined): AudioNode {
  return drive !== undefined && drive > 0 ? createDrive(ctx, dest, drive) : dest;
}

function playNoise(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "noise" }>, start: number, v: Voice): number {
  const dur = l.dur * v.stretch;
  const gain = createGainNode(ctx, dest);
  const input = withDrive(ctx, gain, l.drive);
  const from = clampFreq(l.from * v.pitch);
  const filter = createFilter(ctx, input, l.filter, from, l.q ?? 1);
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(clampFreq(l.to * v.pitch), start + dur);
  const noise = createNoiseSource(ctx, filter);
  const end = percEnvelope(gain, start, (l.attack ?? NOISE_ATTACK) * v.stretch, dur, l.peak * v.level);
  noise.start(start);
  noise.stop(safeStopTime(start, end - start));
  return end;
}

function playTone(ctx: BaseAudioContext, dest: AudioNode, type: OscillatorType, freq: number, dur: number, peak: number, start: number): number {
  const gain = createGainNode(ctx, dest);
  const osc = createOsc(ctx, gain, type, clampFreq(freq));
  osc.frequency.setValueAtTime(clampFreq(freq), start);
  applyEnvelope(gain, ctx, start, 0, { attack: 0.004, decay: dur * 0.5, release: dur * 0.5, peak });
  osc.start(start);
  osc.stop(safeStopTime(start, dur));
  return start + dur;
}

function playSweep(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "sweep" }>, start: number, v: Voice): number {
  const dur = l.dur * v.stretch;
  const gain = createGainNode(ctx, dest);
  const from = clampFreq(l.from * v.pitch);
  const osc = createOsc(ctx, gain, l.type, from);
  pitchSweep(osc, ctx, start, from, clampFreq(l.to * v.pitch), dur);
  applyEnvelope(gain, ctx, start, Math.max(dur - 0.05, 0), { attack: 0.003, decay: 0.03, sustain: 0.7, release: 0.05, peak: l.peak * v.level });
  osc.start(start);
  osc.stop(safeStopTime(start, dur + 0.05));
  return start + dur + 0.05;
}

function playKick(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "kick" }>, start: number, v: Voice): number {
  const gain = createGainNode(ctx, dest);
  const input = withDrive(ctx, gain, l.drive);
  const from = clampFreq(l.from * v.pitch);
  const osc = createOsc(ctx, input, "sine", from);
  pitchSweep(osc, ctx, start, from, clampFreq(l.to * v.pitch), l.drop * v.stretch);
  const end = percEnvelope(gain, start, KICK_ATTACK, l.dur * v.stretch, l.peak * v.level);
  osc.start(start);
  osc.stop(safeStopTime(start, end - start));
  return end;
}

function playClick(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "click" }>, start: number, v: Voice): number {
  const gain = createGainNode(ctx, dest);
  const filter = createFilter(ctx, gain, "highpass", clampFreq(l.freq * v.pitch));
  const noise = createNoiseSource(ctx, filter);
  const end = percEnvelope(gain, start, CLICK_ATTACK, CLICK_SECONDS, l.peak * v.level);
  noise.start(start);
  noise.stop(safeStopTime(start, end - start));
  return end;
}

function playMetal(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "metal" }>, start: number, v: Voice): number {
  let end = start;
  l.ratios.forEach((ratio, i) => {
    const gain = createGainNode(ctx, dest);
    const osc = createOsc(ctx, gain, "sine", clampFreq(l.freq * ratio * v.pitch));
    const peak = (l.peak * v.level) / (1 + i * METAL_LEVEL_FALLOFF);
    const partialEnd = percEnvelope(gain, start, KICK_ATTACK, (l.dur * v.stretch) / (1 + i * METAL_DECAY_FALLOFF), peak);
    osc.start(start);
    osc.stop(safeStopTime(start, partialEnd - start));
    end = Math.max(end, partialEnd);
  });
  return end;
}

function playFm(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "fm" }>, start: number, v: Voice): number {
  const dur = l.dur * v.stretch;
  const from = clampFreq(l.freq * v.pitch);
  const to = clampFreq((l.to ?? l.freq) * v.pitch);
  const gain = createGainNode(ctx, dest);
  const carrier = createOsc(ctx, gain, "sine", from);
  pitchSweep(carrier, ctx, start, from, to, dur);
  const modGain = ctx.createGain();
  const depth = l.index * from;
  modGain.gain.setValueAtTime(depth, start);
  modGain.gain.exponentialRampToValueAtTime(Math.max(depth * FM_INDEX_FLOOR, 1), start + dur);
  modGain.connect(carrier.frequency);
  const modulator = ctx.createOscillator();
  modulator.type = "sine";
  modulator.connect(modGain);
  pitchSweep(modulator, ctx, start, from * l.ratio, to * l.ratio, dur);
  const end = percEnvelope(gain, start, FM_ATTACK, dur, l.peak * v.level);
  for (const osc of [carrier, modulator]) {
    osc.start(start);
    osc.stop(safeStopTime(start, end - start));
  }
  return end;
}

function playCrackle(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "crackle" }>, start: number, v: Voice): number {
  let t = start;
  let end = start;
  for (let i = 0; i < l.count; i++) {
    const gain = createGainNode(ctx, dest);
    const freq = clampFreq(l.freq * v.pitch * jitterRatio(CRACKLE_PITCH_JITTER));
    const filter = createFilter(ctx, gain, "bandpass", freq, l.q ?? CRACKLE_Q);
    const noise = createNoiseSource(ctx, filter);
    // 粒ごとに大きさも揺らし、機械的な等間隔の連打に聞こえないようにする
    const grainEnd = percEnvelope(gain, t, CLICK_ATTACK, CRACKLE_GRAIN, l.peak * v.level * jitterRatio(CRACKLE_GAP_JITTER));
    noise.start(t);
    noise.stop(safeStopTime(t, grainEnd - t));
    end = Math.max(end, grainEnd);
    t += l.gap * v.stretch * jitterRatio(CRACKLE_GAP_JITTER);
  }
  return end;
}

function playBlips(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "blips" }>, start: number, v: Voice): number {
  let t = start;
  let end = start;
  for (let i = 0; i < l.count; i++) {
    const wobble = jitterRatio(BLIP_PITCH_JITTER);
    const note = l.note * v.stretch;
    const from = clampFreq(l.from * v.pitch * wobble);
    const gain = createGainNode(ctx, dest);
    const osc = createOsc(ctx, gain, l.type, from);
    pitchSweep(osc, ctx, t, from, clampFreq(l.to * v.pitch * wobble), note);
    const blipEnd = percEnvelope(gain, t, BLIP_ATTACK, note, l.peak * v.level);
    osc.start(t);
    osc.stop(safeStopTime(t, blipEnd - t));
    end = Math.max(end, blipEnd);
    t += note + l.gap * v.stretch;
  }
  return end;
}

function playLayer(ctx: BaseAudioContext, dest: AudioNode, l: Layer, now: number, v: Voice): number {
  const start = now + (l.at ?? 0) * v.stretch;
  switch (l.k) {
    case "noise":
      return playNoise(ctx, dest, l, start, v);
    case "tone":
      return playTone(ctx, dest, l.type, l.freq * v.pitch, l.dur * v.stretch, l.peak * v.level, start);
    case "sweep":
      return playSweep(ctx, dest, l, start, v);
    case "arp": {
      let t = start;
      for (const f of l.freqs) {
        playTone(ctx, dest, l.type, f * v.pitch, l.note * v.stretch, l.peak * v.level, t);
        t += (l.note + l.gap) * v.stretch;
      }
      return t;
    }
    case "chord": {
      let end = start;
      for (const f of l.freqs) end = Math.max(end, playTone(ctx, dest, l.type, f * v.pitch, l.dur * v.stretch, l.peak * v.level, start));
      return end;
    }
    case "kick":
      return playKick(ctx, dest, l, start, v);
    case "click":
      return playClick(ctx, dest, l, start, v);
    case "metal":
      return playMetal(ctx, dest, l, start, v);
    case "fm":
      return playFm(ctx, dest, l, start, v);
    case "crackle":
      return playCrackle(ctx, dest, l, start, v);
    case "blips":
      return playBlips(ctx, dest, l, start, v);
  }
}

/**
 * 層をまとめて鳴らし、音の長さ（秒）を返す。pitch は元のピッチ倍率。
 * 音程・長さ・音量の揺らぎはここで発音ごとに 1 回だけ決め、全層に同じだけ乗せる（層どうしの噛み合わせを崩さない）
 */
export function playLayers(ctx: BaseAudioContext, dest: AudioNode, layers: readonly Layer[], pitch: number): number {
  const now = ctx.currentTime;
  const v: Voice = { pitch: pitch * jitterPitch(), stretch: jitterRatio(DURATION_JITTER_RATIO), level: jitterRatio(LEVEL_JITTER_RATIO) };
  let end = now;
  for (const l of layers) end = Math.max(end, playLayer(ctx, dest, l, now, v));
  return end - now + TAIL_SECONDS;
}
