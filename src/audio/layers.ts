/**
 * 層（ノイズ・単音・スイープ・分散和音・和音）を並べて 1 つの効果音にする小さな合成器。
 * 新しい効果音は sfxLayers.ts の表に層を足すだけで作れる（sfx.ts の個別関数を増やさない）。
 * 音の揺らぎ（jitterPitch）以外で Math.random は使わない
 */
import {
  applyEnvelope,
  createFilter,
  createGainNode,
  createNoiseSource,
  createOsc,
  jitterPitch,
  pitchSweep,
  safeStopTime,
} from "./synth";

/** at は発音開始からの遅れ（秒）。peak は 0..1 */
export type Layer =
  | { k: "noise"; filter: BiquadFilterType; from: number; to: number; dur: number; peak: number; q?: number; at?: number }
  | { k: "tone"; type: OscillatorType; freq: number; dur: number; peak: number; at?: number }
  | { k: "sweep"; type: OscillatorType; from: number; to: number; dur: number; peak: number; at?: number }
  | { k: "arp"; type: OscillatorType; freqs: readonly number[]; note: number; gap: number; peak: number; at?: number }
  | { k: "chord"; type: OscillatorType; freqs: readonly number[]; dur: number; peak: number; at?: number };

const MIN_FREQ = 20;
const TAIL_SECONDS = 0.1;

function playNoise(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "noise" }>, start: number, pitch: number): number {
  const gain = createGainNode(ctx, dest);
  const filter = createFilter(ctx, gain, l.filter, Math.max(MIN_FREQ, l.from * pitch), l.q ?? 1);
  filter.frequency.setValueAtTime(Math.max(MIN_FREQ, l.from * pitch), start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(MIN_FREQ, l.to * pitch), start + l.dur);
  const noise = createNoiseSource(ctx, filter);
  applyEnvelope(gain, ctx, start, 0, { attack: 0.002, decay: l.dur * 0.6, release: l.dur * 0.4, peak: l.peak });
  noise.start(start);
  noise.stop(safeStopTime(start, l.dur));
  return start + l.dur;
}

function playTone(ctx: BaseAudioContext, dest: AudioNode, type: OscillatorType, freq: number, dur: number, peak: number, start: number): number {
  const gain = createGainNode(ctx, dest);
  const osc = createOsc(ctx, gain, type, Math.max(MIN_FREQ, freq));
  osc.frequency.setValueAtTime(Math.max(MIN_FREQ, freq), start);
  applyEnvelope(gain, ctx, start, 0, { attack: 0.004, decay: dur * 0.5, release: dur * 0.5, peak });
  osc.start(start);
  osc.stop(safeStopTime(start, dur));
  return start + dur;
}

function playSweep(ctx: BaseAudioContext, dest: AudioNode, l: Extract<Layer, { k: "sweep" }>, start: number, pitch: number): number {
  const gain = createGainNode(ctx, dest);
  const from = Math.max(MIN_FREQ, l.from * pitch);
  const osc = createOsc(ctx, gain, l.type, from);
  pitchSweep(osc, ctx, start, from, Math.max(MIN_FREQ, l.to * pitch), l.dur);
  applyEnvelope(gain, ctx, start, Math.max(l.dur - 0.05, 0), { attack: 0.003, decay: 0.03, sustain: 0.7, release: 0.05, peak: l.peak });
  osc.start(start);
  osc.stop(safeStopTime(start, l.dur + 0.05));
  return start + l.dur + 0.05;
}

function playLayer(ctx: BaseAudioContext, dest: AudioNode, l: Layer, now: number, pitch: number): number {
  const start = now + (l.at ?? 0);
  switch (l.k) {
    case "noise":
      return playNoise(ctx, dest, l, start, pitch);
    case "tone":
      return playTone(ctx, dest, l.type, l.freq * pitch, l.dur, l.peak, start);
    case "sweep":
      return playSweep(ctx, dest, l, start, pitch);
    case "arp": {
      let t = start;
      for (const f of l.freqs) {
        playTone(ctx, dest, l.type, f * pitch, l.note, l.peak, t);
        t += l.note + l.gap;
      }
      return t;
    }
    case "chord": {
      let end = start;
      for (const f of l.freqs) end = Math.max(end, playTone(ctx, dest, l.type, f * pitch, l.dur, l.peak, start));
      return end;
    }
  }
}

/** 層をまとめて鳴らし、音の長さ（秒）を返す。pitch は元のピッチ倍率（揺らぎはここで 1 回だけ乗せる） */
export function playLayers(ctx: BaseAudioContext, dest: AudioNode, layers: readonly Layer[], pitch: number): number {
  const now = ctx.currentTime;
  const p = pitch * jitterPitch();
  let end = now;
  for (const l of layers) end = Math.max(end, playLayer(ctx, dest, l, now, p));
  return end - now + TAIL_SECONDS;
}
