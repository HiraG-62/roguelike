/**
 * 効果音の再生を担う SfxPlayer。
 *
 * ゲームロジックは音の実装を知らず、`state.sfx` のようなキューに SfxName を push するだけ
 * （実際のキュー配線は main.ts 側の責務）。main.ts はフレーム末尾でキューを drain し、
 * それぞれの名前で `sfxPlayer.play(name)` を呼ぶ想定。
 *
 * AudioContext はブラウザの autoplay 制約により、最初のユーザー操作（keydown / mousedown）
 * のハンドラから `unlock()` を呼ぶことで生成する。生成前に play() が呼ばれても無視される。
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
import { SFX_NAMES, type SfxName } from "./sfxNames";
import { type Layer, playLayers } from "./layers";
import { LAYERED_SFX, type LayeredSfxName } from "./sfxLayers";

/** play() に渡せる再生オプション */
export interface SfxPlayOptions {
  /** 0..1 のこの発音だけの音量倍率（デフォルト 1） */
  volume?: number;
  /** 周波数の倍率（デフォルト 1 = 元のピッチ） */
  pitch?: number;
}

/** 効果音定義に渡す内部オプション（ピッチ倍率にランダムな揺らぎが乗った後の値ではなく元の倍率） */
interface SfxDefOpts {
  pitch: number;
}

/** 効果音1つ分の合成処理。呼び出し元に音の長さ（秒）を返す。 */
type SfxDefinition = (ctx: BaseAudioContext, dest: AudioNode, opts: SfxDefOpts) => number;

/** 同時発音の上限。近接の命中は hit + hitThump + 会心 + 属性 + 弱点で 1 撃 5 音まで積むので、乱戦で重要な音が落ちない幅にする */
const MAX_POLYPHONY = 24;
const RETRIGGER_SUPPRESS_SECONDS = 0.03;
const DEFAULT_MASTER_VOLUME = 0.5;
/**
 * マスターの 2 段のダイナミクス。1 段目（まとめ）は立ち上がりを 6ms 通してから抑え、打撃のアタックを潰さずに音量を揃える。
 * 2 段目（リミッター）は同時に重なったときの音割れだけを止める
 */
const COMPRESSOR_THRESHOLD_DB = -16;
const COMPRESSOR_KNEE_DB = 8;
const COMPRESSOR_RATIO = 4;
const COMPRESSOR_ATTACK_SECONDS = 0.006;
const COMPRESSOR_RELEASE_SECONDS = 0.12;
const LIMITER_THRESHOLD_DB = -2;
const LIMITER_KNEE_DB = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SECONDS = 0.001;
const LIMITER_RELEASE_SECONDS = 0.08;

const MIN_SWEEP_FREQ = 20;
const TAIL_MARGIN_SECONDS = 0.1;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** ピッチ倍率 + 軽いランダム揺らぎを周波数に適用する */
function applyPitch(freq: number, opts: SfxDefOpts): number {
  return freq * opts.pitch * jitterPitch();
}

// ---- 汎用パーツ ----------------------------------------------------------

/** ノイズをフィルタで加工して短く鳴らす（斬撃・爆発・ダッシュなどの基礎） */
function noiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  opts: SfxDefOpts,
  params: {
    filterType: BiquadFilterType;
    freqFrom: number;
    freqTo: number;
    duration: number;
    q?: number;
    peak?: number;
  },
): number {
  const now = ctx.currentTime;
  const gain = createGainNode(ctx, dest);
  const from = applyPitch(params.freqFrom, opts);
  const to = Math.max(applyPitch(params.freqTo, opts), MIN_SWEEP_FREQ);
  const filter = createFilter(ctx, gain, params.filterType, from, params.q ?? 1);
  filter.frequency.exponentialRampToValueAtTime(to, now + params.duration);
  const noise = createNoiseSource(ctx, filter);
  applyEnvelope(gain, ctx, now, 0, {
    attack: 0.002,
    decay: params.duration * 0.6,
    release: params.duration * 0.4,
    peak: params.peak ?? 0.9,
  });
  noise.start(now);
  noise.stop(safeStopTime(now, params.duration));
  return params.duration + TAIL_MARGIN_SECONDS;
}

/** 単発の固定ピッチの音 */
function tone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  opts: SfxDefOpts,
  params: { type: OscillatorType; freq: number; duration: number; peak?: number; startAt?: number },
): number {
  const now = params.startAt ?? ctx.currentTime;
  const gain = createGainNode(ctx, dest);
  const osc = createOsc(ctx, gain, params.type, applyPitch(params.freq, opts));
  applyEnvelope(gain, ctx, now, 0, {
    attack: 0.004,
    decay: params.duration * 0.5,
    release: params.duration * 0.5,
    peak: params.peak ?? 0.8,
  });
  osc.start(now);
  osc.stop(safeStopTime(now, params.duration));
  return params.duration + TAIL_MARGIN_SECONDS;
}

/** ピッチが時間とともに変化する単発音（斬撃のスイング感、射撃、降下など） */
function toneSweep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  opts: SfxDefOpts,
  params: { type: OscillatorType; freqFrom: number; freqTo: number; duration: number; peak?: number },
): number {
  const now = ctx.currentTime;
  const gain = createGainNode(ctx, dest);
  const fromFreq = applyPitch(params.freqFrom, opts);
  const toFreq = Math.max(applyPitch(params.freqTo, opts), MIN_SWEEP_FREQ);
  const osc = createOsc(ctx, gain, params.type, fromFreq);
  pitchSweep(osc, ctx, now, fromFreq, toFreq, params.duration);
  applyEnvelope(gain, ctx, now, Math.max(params.duration - 0.05, 0), {
    attack: 0.003,
    decay: 0.03,
    sustain: 0.7,
    release: 0.05,
    peak: params.peak ?? 0.8,
  });
  osc.start(now);
  osc.stop(safeStopTime(now, params.duration));
  return params.duration + TAIL_MARGIN_SECONDS;
}

/** 音階を並べて鳴らす（キル演出、ファンファーレ、アイテム取得など） */
function arpeggio(
  ctx: BaseAudioContext,
  dest: AudioNode,
  opts: SfxDefOpts,
  params: { type: OscillatorType; freqs: readonly number[]; noteDuration: number; gap: number; peak?: number },
): number {
  const now = ctx.currentTime;
  let t = now;
  for (const freq of params.freqs) {
    const gain = createGainNode(ctx, dest);
    const osc = createOsc(ctx, gain, params.type, applyPitch(freq, opts));
    applyEnvelope(gain, ctx, t, 0, {
      attack: 0.003,
      decay: params.noteDuration * 0.6,
      release: params.noteDuration * 0.4,
      peak: params.peak ?? 0.7,
    });
    osc.start(t);
    osc.stop(safeStopTime(t, params.noteDuration));
    t += params.noteDuration + params.gap;
  }
  return t - now;
}

// ---- チューニング表（周波数・長さなどの手触り定数） ----------------------

const TUNING = {
  death: { freqFrom: 320, freqTo: 35, duration: 0.9 },
  roomLock: { freqA: 95, freqB: 101, duration: 0.5, metallicFreq: 1900, metallicDuration: 0.3 },
  roomClear: { tones: [523.25, 659.25, 783.99] as const, noteDuration: 0.13, gap: 0.05 },
  pickup: { freqFrom: 500, freqTo: 950, duration: 0.08 },
  lootDrop: { tones: [700, 1050] as const, noteDuration: 0.05, gap: 0.015 },
  lootRare: { tones: [523.25, 659.25, 783.99, 1046.5] as const, noteDuration: 0.09, gap: 0.03 },
  descend: { freqFrom: 750, freqTo: 110, duration: 0.6 },
  levelStart: { tones: [392, 523.25] as const, noteDuration: 0.1, gap: 0.04 },
  uiOpen: { freqFrom: 500, freqTo: 950, duration: 0.05 },
  uiClose: { freqFrom: 950, freqTo: 500, duration: 0.05 },
  uiClick: { freq: 1200, duration: 0.02 },
  enemyWindup: { freqFrom: 280, freqTo: 520, duration: 0.35 },
  heal: { tones: [660, 880, 1100] as const, noteDuration: 0.08, gap: 0.02 },
  skillReady: { tones: [880, 1320] as const, noteDuration: 0.04, gap: 0.01 },
  runeAttach: { tones: [440, 660, 990] as const, noteDuration: 0.06, gap: 0.02 },
  synergy: { tones: [784, 1175, 1568] as const, noteDuration: 0.05, gap: 0.015 },
  manaEmpty: { freqFrom: 260, freqTo: 140, duration: 0.09 },
  reflect: { freqFrom: 900, freqTo: 2600, duration: 0.09, noiseFreqFrom: 6000, noiseFreqTo: 2500, noiseDuration: 0.06 },
  bossAppear: { lowFreq: 50, lowDuration: 0.7, riseFreqFrom: 100, riseFreqTo: 800, riseDuration: 0.6 },
  bossDefeat: {
    tones: [523.25, 659.25, 783.99, 1046.5, 1318.5] as const,
    noteDuration: 0.15,
    gap: 0.05,
    noiseFreqFrom: 1800,
    noiseFreqTo: 80,
    noiseDuration: 0.7,
    lowFreq: 50,
    lowDuration: 0.8,
  },
  bossPhaseChange: {
    tones: [660, 831, 990] as const,
    noteDuration: 0.12,
    gap: 0.01,
    noiseFreqFrom: 3000,
    noiseFreqTo: 1200,
    noiseDuration: 0.15,
  },
  boonOffer: { tones: [440, 554.37, 659.25] as const, noteDuration: 0.18, gap: 0.02 },
  boonSelect: { tones: [784, 987.77, 1174.66] as const, noteDuration: 0.05, gap: 0.015 },
  boonSelectCursed: { freqFrom: 400, freqTo: 90, duration: 0.35, noiseFreqFrom: 1200, noiseFreqTo: 200, noiseDuration: 0.3 },
  reaperWarnPulse: { freq: 70, duration: 0.25, detuneFreq: 74, noiseFreqFrom: 500, noiseFreqTo: 150, noiseDuration: 0.2 },
  reaperAppear: { noiseFreqFrom: 700, noiseFreqTo: 60, noiseDuration: 0.8, lowFreqFrom: 140, lowFreqTo: 40, lowDuration: 0.9 },
  treasureOpen: { tones: [1046.5, 1318.5, 1568, 1864.66, 2093] as const, noteDuration: 0.05, gap: 0.015 },
  waveStart: { pulseFreq: 130, pulseDuration: 0.12, riseFreqFrom: 300, riseFreqTo: 900, riseDuration: 0.2 },
  fountainHeal: {
    tones: [523.25, 659.25, 783.99, 987.77] as const,
    noteDuration: 0.09,
    gap: 0.03,
    noiseFreqFrom: 2000,
    noiseFreqTo: 800,
    noiseDuration: 0.15,
  },
  ambush: { noiseFreqFrom: 4000, noiseFreqTo: 300, noiseDuration: 0.2, lowFreq: 90, lowDuration: 0.25 },
  pedestalUse: { tones: [392, 587.33, 783.99] as const, noteDuration: 0.07, gap: 0.02 },
  runEventWarn: { freqFrom: 880, freqTo: 440, duration: 0.35, pulseFreq: 220, pulseDuration: 0.12 },
  runEventStart: { noiseFreqFrom: 2500, noiseFreqTo: 200, noiseDuration: 0.3, lowFreq: 110, lowDuration: 0.3 },
  lingerWarn: { freq: 55, duration: 0.5, detuneFreq: 58 },
  bombFuse: { noiseFreqFrom: 5000, noiseFreqTo: 2500, noiseDuration: 0.08 },
  laserCharge: { freqFrom: 200, freqTo: 1400, duration: 0.35 },
  laserFire: { freqFrom: 1800, freqTo: 200, duration: 0.18, noiseFreqFrom: 6000, noiseFreqTo: 1000, noiseDuration: 0.12 },
  shockwave: { lowFreq: 65, lowDuration: 0.4, noiseFreqFrom: 1200, noiseFreqTo: 100, noiseDuration: 0.35 },
  craftReforge: { noiseFreqFrom: 2500, noiseFreqTo: 700, noiseDuration: 0.12, freqFrom: 500, freqTo: 850, duration: 0.1 },
  craftAugment: { tones: [660, 880, 1100] as const, noteDuration: 0.05, gap: 0.015 },
  craftAnnul: { freqFrom: 700, freqTo: 250, duration: 0.18 },
  craftCorrupt: { freqFrom: 220, freqTo: 90, duration: 0.3, noiseFreqFrom: 1500, noiseFreqTo: 300, noiseDuration: 0.25 },
  craftFuse: { toneA: 440, toneB: 660, toneDuration: 0.15, mergeFreq: 550, mergeDuration: 0.14, mergeDelay: 0.08 },
  equipOn: { freq: 700, duration: 0.05, noiseFreqFrom: 1200, noiseFreqTo: 400, noiseDuration: 0.04 },
  equipOff: { freqFrom: 700, freqTo: 350, duration: 0.05 },
  dismantle: { noiseFreqFrom: 2500, noiseFreqTo: 200, noiseDuration: 0.15, lowFreq: 100, lowDuration: 0.12 },
  oilSplash: { noiseFreqFrom: 900, noiseFreqTo: 200, noiseDuration: 0.18, lowFreq: 90, lowDuration: 0.12 },
  windGust: { noiseFreqFrom: 600, noiseFreqTo: 1800, noiseDuration: 0.5 },
  chainThrow: { freqFrom: 1200, freqTo: 500, duration: 0.12, noiseFreqFrom: 5000, noiseFreqTo: 2500, noiseDuration: 0.1 },
  menuMove: { freq: 900, duration: 0.015 },
  chargeLevel: { tones: [660, 990] as const, noteDuration: 0.035, gap: 0.01 },
} as const;

// ---- 各効果音の定義 -------------------------------------------------------

/** sfxLayers.ts の表から層で組む効果音の定義を作る */
function layeredDefinitions(): Record<LayeredSfxName, SfxDefinition> {
  const out: Partial<Record<LayeredSfxName, SfxDefinition>> = {};
  for (const name of Object.keys(LAYERED_SFX) as LayeredSfxName[]) {
    const layers: readonly Layer[] = LAYERED_SFX[name];
    out[name] = (ctx, dest, opts) => playLayers(ctx, dest, layers, opts.pitch);
  }
  return out as Record<LayeredSfxName, SfxDefinition>;
}

const SFX_DEFINITIONS: Record<SfxName, SfxDefinition> = {
  ...layeredDefinitions(),
  death: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.death.freqFrom,
      freqTo: TUNING.death.freqTo,
      duration: TUNING.death.duration,
      peak: 0.7,
    }),

  roomLock: (ctx, dest, opts) => {
    const now = ctx.currentTime;
    const low = tone(ctx, dest, opts, { type: "square", freq: TUNING.roomLock.freqA, duration: TUNING.roomLock.duration, peak: 0.7 });
    const beat = tone(ctx, dest, opts, {
      type: "square",
      freq: TUNING.roomLock.freqB,
      duration: TUNING.roomLock.duration,
      peak: 0.5,
      startAt: now,
    });
    const metallic = tone(ctx, dest, opts, {
      type: "triangle",
      freq: TUNING.roomLock.metallicFreq,
      duration: TUNING.roomLock.metallicDuration,
      peak: 0.3,
      startAt: now,
    });
    return Math.max(low, beat, metallic);
  },

  roomClear: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.roomClear.tones,
      noteDuration: TUNING.roomClear.noteDuration,
      gap: TUNING.roomClear.gap,
      peak: 0.7,
    }),

  pickup: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "triangle",
      freqFrom: TUNING.pickup.freqFrom,
      freqTo: TUNING.pickup.freqTo,
      duration: TUNING.pickup.duration,
      peak: 0.6,
    }),

  lootDrop: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "square",
      freqs: TUNING.lootDrop.tones,
      noteDuration: TUNING.lootDrop.noteDuration,
      gap: TUNING.lootDrop.gap,
      peak: 0.55,
    }),

  lootRare: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.lootRare.tones,
      noteDuration: TUNING.lootRare.noteDuration,
      gap: TUNING.lootRare.gap,
      peak: 0.65,
    }),

  descend: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "sine",
      freqFrom: TUNING.descend.freqFrom,
      freqTo: TUNING.descend.freqTo,
      duration: TUNING.descend.duration,
      peak: 0.6,
    }),

  levelStart: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.levelStart.tones,
      noteDuration: TUNING.levelStart.noteDuration,
      gap: TUNING.levelStart.gap,
      peak: 0.6,
    }),

  uiOpen: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "sine",
      freqFrom: TUNING.uiOpen.freqFrom,
      freqTo: TUNING.uiOpen.freqTo,
      duration: TUNING.uiOpen.duration,
      peak: 0.4,
    }),

  uiClose: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "sine",
      freqFrom: TUNING.uiClose.freqFrom,
      freqTo: TUNING.uiClose.freqTo,
      duration: TUNING.uiClose.duration,
      peak: 0.4,
    }),

  uiClick: (ctx, dest, opts) =>
    tone(ctx, dest, opts, { type: "square", freq: TUNING.uiClick.freq, duration: TUNING.uiClick.duration, peak: 0.35 }),

  enemyWindup: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.enemyWindup.freqFrom,
      freqTo: TUNING.enemyWindup.freqTo,
      duration: TUNING.enemyWindup.duration,
      peak: 0.45,
    }),

  heal: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "sine",
      freqs: TUNING.heal.tones,
      noteDuration: TUNING.heal.noteDuration,
      gap: TUNING.heal.gap,
      peak: 0.55,
    }),

  skillReady: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "sine",
      freqs: TUNING.skillReady.tones,
      noteDuration: TUNING.skillReady.noteDuration,
      gap: TUNING.skillReady.gap,
      peak: 0.35,
    }),

  // 連携: 短く明るい 3 音の上昇（刻印符の装着音より高く速い）
  synergy: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.synergy.tones,
      noteDuration: TUNING.synergy.noteDuration,
      gap: TUNING.synergy.gap,
      peak: 0.4,
    }),

  runeAttach: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.runeAttach.tones,
      noteDuration: TUNING.runeAttach.noteDuration,
      gap: TUNING.runeAttach.gap,
      peak: 0.5,
    }),

  // マナ不足: 撃てなかったことが分かる短く鈍い下降音（発動音と聞き分けられるよう矩形波で低く）
  manaEmpty: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "square",
      freqFrom: TUNING.manaEmpty.freqFrom,
      freqTo: TUNING.manaEmpty.freqTo,
      duration: TUNING.manaEmpty.duration,
      peak: 0.25,
    }),

  reflect: (ctx, dest, opts) => {
    const ping = toneSweep(ctx, dest, opts, {
      type: "triangle",
      freqFrom: TUNING.reflect.freqFrom,
      freqTo: TUNING.reflect.freqTo,
      duration: TUNING.reflect.duration,
      peak: 0.5,
    });
    const tick = noiseBurst(ctx, dest, opts, {
      filterType: "highpass",
      freqFrom: TUNING.reflect.noiseFreqFrom,
      freqTo: TUNING.reflect.noiseFreqTo,
      duration: TUNING.reflect.noiseDuration,
      peak: 0.5,
    });
    return Math.max(ping, tick);
  },

  bossAppear: (ctx, dest, opts) => {
    const boom = tone(ctx, dest, opts, { type: "sine", freq: TUNING.bossAppear.lowFreq, duration: TUNING.bossAppear.lowDuration, peak: 0.9 });
    const rise = toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.bossAppear.riseFreqFrom,
      freqTo: TUNING.bossAppear.riseFreqTo,
      duration: TUNING.bossAppear.riseDuration,
      peak: 0.55,
    });
    return Math.max(boom, rise);
  },

  bossDefeat: (ctx, dest, opts) => {
    const arp = arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.bossDefeat.tones,
      noteDuration: TUNING.bossDefeat.noteDuration,
      gap: TUNING.bossDefeat.gap,
      peak: 0.7,
    });
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.bossDefeat.noiseFreqFrom,
      freqTo: TUNING.bossDefeat.noiseFreqTo,
      duration: TUNING.bossDefeat.noiseDuration,
      peak: 0.9,
    });
    const low = tone(ctx, dest, opts, { type: "sine", freq: TUNING.bossDefeat.lowFreq, duration: TUNING.bossDefeat.lowDuration, peak: 0.85 });
    return Math.max(arp, noise, low);
  },

  bossPhaseChange: (ctx, dest, opts) => {
    const chord = arpeggio(ctx, dest, opts, {
      type: "sawtooth",
      freqs: TUNING.bossPhaseChange.tones,
      noteDuration: TUNING.bossPhaseChange.noteDuration,
      gap: TUNING.bossPhaseChange.gap,
      peak: 0.5,
    });
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "bandpass",
      freqFrom: TUNING.bossPhaseChange.noiseFreqFrom,
      freqTo: TUNING.bossPhaseChange.noiseFreqTo,
      duration: TUNING.bossPhaseChange.noiseDuration,
      peak: 0.5,
    });
    return Math.max(chord, noise);
  },

  boonOffer: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "sine",
      freqs: TUNING.boonOffer.tones,
      noteDuration: TUNING.boonOffer.noteDuration,
      gap: TUNING.boonOffer.gap,
      peak: 0.4,
    }),

  boonSelect: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.boonSelect.tones,
      noteDuration: TUNING.boonSelect.noteDuration,
      gap: TUNING.boonSelect.gap,
      peak: 0.6,
    }),

  boonSelectCursed: (ctx, dest, opts) => {
    const sweep = toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.boonSelectCursed.freqFrom,
      freqTo: TUNING.boonSelectCursed.freqTo,
      duration: TUNING.boonSelectCursed.duration,
      peak: 0.55,
    });
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.boonSelectCursed.noiseFreqFrom,
      freqTo: TUNING.boonSelectCursed.noiseFreqTo,
      duration: TUNING.boonSelectCursed.noiseDuration,
      peak: 0.4,
    });
    return Math.max(sweep, noise);
  },

  reaperWarnPulse: (ctx, dest, opts) => {
    const now = ctx.currentTime;
    const low = tone(ctx, dest, opts, {
      type: "sine",
      freq: TUNING.reaperWarnPulse.freq,
      duration: TUNING.reaperWarnPulse.duration,
      peak: 0.5,
    });
    const detuned = tone(ctx, dest, opts, {
      type: "sawtooth",
      freq: TUNING.reaperWarnPulse.detuneFreq,
      duration: TUNING.reaperWarnPulse.duration,
      peak: 0.25,
      startAt: now,
    });
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.reaperWarnPulse.noiseFreqFrom,
      freqTo: TUNING.reaperWarnPulse.noiseFreqTo,
      duration: TUNING.reaperWarnPulse.noiseDuration,
      peak: 0.3,
    });
    return Math.max(low, detuned, noise);
  },

  reaperAppear: (ctx, dest, opts) => {
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.reaperAppear.noiseFreqFrom,
      freqTo: TUNING.reaperAppear.noiseFreqTo,
      duration: TUNING.reaperAppear.noiseDuration,
      peak: 0.8,
    });
    const growl = toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.reaperAppear.lowFreqFrom,
      freqTo: TUNING.reaperAppear.lowFreqTo,
      duration: TUNING.reaperAppear.lowDuration,
      peak: 0.7,
    });
    return Math.max(noise, growl);
  },

  treasureOpen: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.treasureOpen.tones,
      noteDuration: TUNING.treasureOpen.noteDuration,
      gap: TUNING.treasureOpen.gap,
      peak: 0.55,
    }),

  waveStart: (ctx, dest, opts) => {
    const pulse = tone(ctx, dest, opts, { type: "square", freq: TUNING.waveStart.pulseFreq, duration: TUNING.waveStart.pulseDuration, peak: 0.7 });
    const rise = toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.waveStart.riseFreqFrom,
      freqTo: TUNING.waveStart.riseFreqTo,
      duration: TUNING.waveStart.riseDuration,
      peak: 0.5,
    });
    return Math.max(pulse, rise);
  },

  fountainHeal: (ctx, dest, opts) => {
    const arp = arpeggio(ctx, dest, opts, {
      type: "sine",
      freqs: TUNING.fountainHeal.tones,
      noteDuration: TUNING.fountainHeal.noteDuration,
      gap: TUNING.fountainHeal.gap,
      peak: 0.5,
    });
    const splash = noiseBurst(ctx, dest, opts, {
      filterType: "bandpass",
      freqFrom: TUNING.fountainHeal.noiseFreqFrom,
      freqTo: TUNING.fountainHeal.noiseFreqTo,
      duration: TUNING.fountainHeal.noiseDuration,
      peak: 0.3,
    });
    return Math.max(arp, splash);
  },

  ambush: (ctx, dest, opts) => {
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "bandpass",
      freqFrom: TUNING.ambush.noiseFreqFrom,
      freqTo: TUNING.ambush.noiseFreqTo,
      duration: TUNING.ambush.noiseDuration,
      peak: 0.7,
    });
    const stab = tone(ctx, dest, opts, { type: "square", freq: TUNING.ambush.lowFreq, duration: TUNING.ambush.lowDuration, peak: 0.75 });
    return Math.max(noise, stab);
  },

  // 台座に触れた: 上がる 3 音
  pedestalUse: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "triangle",
      freqs: TUNING.pedestalUse.tones,
      noteDuration: TUNING.pedestalUse.noteDuration,
      gap: TUNING.pedestalUse.gap,
      peak: 0.5,
    }),

  // ランイベントの予告: 下がるサイレン + 短い脈
  runEventWarn: (ctx, dest, opts) => {
    const siren = toneSweep(ctx, dest, opts, {
      type: "triangle",
      freqFrom: TUNING.runEventWarn.freqFrom,
      freqTo: TUNING.runEventWarn.freqTo,
      duration: TUNING.runEventWarn.duration,
      peak: 0.45,
    });
    const pulse = tone(ctx, dest, opts, { type: "square", freq: TUNING.runEventWarn.pulseFreq, duration: TUNING.runEventWarn.pulseDuration, peak: 0.35 });
    return Math.max(siren, pulse);
  },

  // ランイベントの開始: 吹き下ろすノイズ + 低い打撃
  runEventStart: (ctx, dest, opts) => {
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "bandpass",
      freqFrom: TUNING.runEventStart.noiseFreqFrom,
      freqTo: TUNING.runEventStart.noiseFreqTo,
      duration: TUNING.runEventStart.noiseDuration,
      peak: 0.6,
    });
    const hit = tone(ctx, dest, opts, { type: "sine", freq: TUNING.runEventStart.lowFreq, duration: TUNING.runEventStart.lowDuration, peak: 0.7 });
    return Math.max(noise, hit);
  },

  // 長居の代償の予告: うなる低音 2 本
  lingerWarn: (ctx, dest, opts) => {
    const low = tone(ctx, dest, opts, { type: "sine", freq: TUNING.lingerWarn.freq, duration: TUNING.lingerWarn.duration, peak: 0.55 });
    const beat = tone(ctx, dest, opts, { type: "sawtooth", freq: TUNING.lingerWarn.detuneFreq, duration: TUNING.lingerWarn.duration, peak: 0.2 });
    return Math.max(low, beat);
  },

  bombFuse: (ctx, dest, opts) =>
    noiseBurst(ctx, dest, opts, {
      filterType: "bandpass",
      freqFrom: TUNING.bombFuse.noiseFreqFrom,
      freqTo: TUNING.bombFuse.noiseFreqTo,
      duration: TUNING.bombFuse.noiseDuration,
      q: 3,
      peak: 0.35,
    }),

  laserCharge: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "sine",
      freqFrom: TUNING.laserCharge.freqFrom,
      freqTo: TUNING.laserCharge.freqTo,
      duration: TUNING.laserCharge.duration,
      peak: 0.45,
    }),

  laserFire: (ctx, dest, opts) => {
    const sweep = toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.laserFire.freqFrom,
      freqTo: TUNING.laserFire.freqTo,
      duration: TUNING.laserFire.duration,
      peak: 0.6,
    });
    const crack = noiseBurst(ctx, dest, opts, {
      filterType: "highpass",
      freqFrom: TUNING.laserFire.noiseFreqFrom,
      freqTo: TUNING.laserFire.noiseFreqTo,
      duration: TUNING.laserFire.noiseDuration,
      peak: 0.5,
    });
    return Math.max(sweep, crack);
  },

  shockwave: (ctx, dest, opts) => {
    const low = tone(ctx, dest, opts, { type: "sine", freq: TUNING.shockwave.lowFreq, duration: TUNING.shockwave.lowDuration, peak: 0.7 });
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.shockwave.noiseFreqFrom,
      freqTo: TUNING.shockwave.noiseFreqTo,
      duration: TUNING.shockwave.noiseDuration,
      peak: 0.6,
    });
    return Math.max(low, noise);
  },

  craftReforge: (ctx, dest, opts) => {
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "bandpass",
      freqFrom: TUNING.craftReforge.noiseFreqFrom,
      freqTo: TUNING.craftReforge.noiseFreqTo,
      duration: TUNING.craftReforge.noiseDuration,
      peak: 0.5,
    });
    const sweep = toneSweep(ctx, dest, opts, {
      type: "triangle",
      freqFrom: TUNING.craftReforge.freqFrom,
      freqTo: TUNING.craftReforge.freqTo,
      duration: TUNING.craftReforge.duration,
      peak: 0.5,
    });
    return Math.max(noise, sweep);
  },

  craftAugment: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "sine",
      freqs: TUNING.craftAugment.tones,
      noteDuration: TUNING.craftAugment.noteDuration,
      gap: TUNING.craftAugment.gap,
      peak: 0.55,
    }),

  craftAnnul: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "triangle",
      freqFrom: TUNING.craftAnnul.freqFrom,
      freqTo: TUNING.craftAnnul.freqTo,
      duration: TUNING.craftAnnul.duration,
      peak: 0.45,
    }),

  craftCorrupt: (ctx, dest, opts) => {
    const sweep = toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.craftCorrupt.freqFrom,
      freqTo: TUNING.craftCorrupt.freqTo,
      duration: TUNING.craftCorrupt.duration,
      peak: 0.55,
    });
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.craftCorrupt.noiseFreqFrom,
      freqTo: TUNING.craftCorrupt.noiseFreqTo,
      duration: TUNING.craftCorrupt.noiseDuration,
      peak: 0.4,
    });
    return Math.max(sweep, noise);
  },

  craftFuse: (ctx, dest, opts) => {
    const now = ctx.currentTime;
    const a = tone(ctx, dest, opts, {
      type: "triangle",
      freq: TUNING.craftFuse.toneA,
      duration: TUNING.craftFuse.toneDuration,
      peak: 0.45,
      startAt: now,
    });
    const b = tone(ctx, dest, opts, {
      type: "triangle",
      freq: TUNING.craftFuse.toneB,
      duration: TUNING.craftFuse.toneDuration,
      peak: 0.45,
      startAt: now,
    });
    const merge = tone(ctx, dest, opts, {
      type: "sine",
      freq: TUNING.craftFuse.mergeFreq,
      duration: TUNING.craftFuse.mergeDuration,
      peak: 0.6,
      startAt: now + TUNING.craftFuse.mergeDelay,
    });
    return Math.max(a, b, TUNING.craftFuse.mergeDelay + merge);
  },

  equipOn: (ctx, dest, opts) => {
    const click = tone(ctx, dest, opts, { type: "square", freq: TUNING.equipOn.freq, duration: TUNING.equipOn.duration, peak: 0.5 });
    const thud = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.equipOn.noiseFreqFrom,
      freqTo: TUNING.equipOn.noiseFreqTo,
      duration: TUNING.equipOn.noiseDuration,
      peak: 0.35,
    });
    return Math.max(click, thud);
  },

  equipOff: (ctx, dest, opts) =>
    toneSweep(ctx, dest, opts, {
      type: "square",
      freqFrom: TUNING.equipOff.freqFrom,
      freqTo: TUNING.equipOff.freqTo,
      duration: TUNING.equipOff.duration,
      peak: 0.4,
    }),

  dismantle: (ctx, dest, opts) => {
    const noise = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.dismantle.noiseFreqFrom,
      freqTo: TUNING.dismantle.noiseFreqTo,
      duration: TUNING.dismantle.noiseDuration,
      peak: 0.6,
    });
    const thud = tone(ctx, dest, opts, { type: "sine", freq: TUNING.dismantle.lowFreq, duration: TUNING.dismantle.lowDuration, peak: 0.5 });
    return Math.max(noise, thud);
  },

  // 油・毒液が床に撒かれる: 低いどさっと、湿った雑音
  oilSplash: (ctx, dest, opts) => {
    const low = tone(ctx, dest, opts, { type: "sine", freq: TUNING.oilSplash.lowFreq, duration: TUNING.oilSplash.lowDuration, peak: 0.5 });
    const wet = noiseBurst(ctx, dest, opts, {
      filterType: "lowpass",
      freqFrom: TUNING.oilSplash.noiseFreqFrom,
      freqTo: TUNING.oilSplash.noiseFreqTo,
      duration: TUNING.oilSplash.noiseDuration,
      peak: 0.45,
    });
    return Math.max(low, wet);
  },

  // 風吹きの一吹き: 上がっていく帯域の雑音
  windGust: (ctx, dest, opts) =>
    noiseBurst(ctx, dest, opts, {
      filterType: "bandpass",
      freqFrom: TUNING.windGust.noiseFreqFrom,
      freqTo: TUNING.windGust.noiseFreqTo,
      duration: TUNING.windGust.noiseDuration,
      q: 1.5,
      peak: 0.4,
    }),

  // 鎖・舌を投げる: 金属の擦れと下がる音
  chainThrow: (ctx, dest, opts) => {
    const sweep = toneSweep(ctx, dest, opts, {
      type: "sawtooth",
      freqFrom: TUNING.chainThrow.freqFrom,
      freqTo: TUNING.chainThrow.freqTo,
      duration: TUNING.chainThrow.duration,
      peak: 0.3,
    });
    const rattle = noiseBurst(ctx, dest, opts, {
      filterType: "highpass",
      freqFrom: TUNING.chainThrow.noiseFreqFrom,
      freqTo: TUNING.chainThrow.noiseFreqTo,
      duration: TUNING.chainThrow.noiseDuration,
      peak: 0.3,
    });
    return Math.max(sweep, rattle);
  },

  menuMove: (ctx, dest, opts) => tone(ctx, dest, opts, { type: "square", freq: TUNING.menuMove.freq, duration: TUNING.menuMove.duration, peak: 0.25 }),

  // 溜めの段: 短い 2 音の上昇（離すタイミングを耳で計れるように）
  chargeLevel: (ctx, dest, opts) =>
    arpeggio(ctx, dest, opts, {
      type: "square",
      freqs: TUNING.chargeLevel.tones,
      noteDuration: TUNING.chargeLevel.noteDuration,
      gap: TUNING.chargeLevel.gap,
      peak: 0.3,
    }),
};

// SFX_NAMES 全件に定義があることを型レベルで保証（Record が満たされていないとコンパイルエラーになる）
const _exhaustiveCheck: readonly SfxName[] = SFX_NAMES;
void _exhaustiveCheck;

// ---- SfxPlayer -------------------------------------------------------------

interface DynamicsSettings {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

/** DynamicsCompressor を作って destination へ繋ぐ */
function createDynamics(ctx: BaseAudioContext, destination: AudioNode, d: DynamicsSettings): DynamicsCompressorNode {
  const node = ctx.createDynamicsCompressor();
  const t = ctx.currentTime;
  node.threshold.setValueAtTime(d.threshold, t);
  node.knee.setValueAtTime(d.knee, t);
  node.ratio.setValueAtTime(d.ratio, t);
  node.attack.setValueAtTime(d.attack, t);
  node.release.setValueAtTime(d.release, t);
  node.connect(destination);
  return node;
}

export class SfxPlayer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private readonly lastPlayedAt = new Map<SfxName, number>();
  private activeVoiceEndTimes: number[] = [];

  /**
   * ユーザー操作（keydown / mousedown）ハンドラから呼ぶ。
   * 未生成なら AudioContext を生成し、生成済みで suspended なら resume する。
   */
  unlock(): void {
    if (this.ctx === null) {
      const AudioContextCtor = globalThis.AudioContext;
      if (typeof AudioContextCtor !== "function") return;
      const ctx = new AudioContextCtor();

      const limiter = createDynamics(ctx, ctx.destination, {
        threshold: LIMITER_THRESHOLD_DB,
        knee: LIMITER_KNEE_DB,
        ratio: LIMITER_RATIO,
        attack: LIMITER_ATTACK_SECONDS,
        release: LIMITER_RELEASE_SECONDS,
      });
      const compressor = createDynamics(ctx, limiter, {
        threshold: COMPRESSOR_THRESHOLD_DB,
        knee: COMPRESSOR_KNEE_DB,
        ratio: COMPRESSOR_RATIO,
        attack: COMPRESSOR_ATTACK_SECONDS,
        release: COMPRESSOR_RELEASE_SECONDS,
      });

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, ctx.currentTime);
      masterGain.connect(compressor);

      this.ctx = ctx;
      this.masterGain = masterGain;
      return;
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  /** 効果音を再生する。unlock() 前は何もしない。 */
  play(name: SfxName, opts: SfxPlayOptions = {}): void {
    if (this.ctx === null || this.masterGain === null || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const last = this.lastPlayedAt.get(name);
    if (last !== undefined && now - last < RETRIGGER_SUPPRESS_SECONDS) return;

    this.activeVoiceEndTimes = this.activeVoiceEndTimes.filter((end) => end > now);
    if (this.activeVoiceEndTimes.length >= MAX_POLYPHONY) return;

    this.lastPlayedAt.set(name, now);

    const voiceGain = createGainNode(ctx, this.masterGain);
    voiceGain.gain.setValueAtTime(clamp01(opts.volume ?? 1), now);

    const definition = SFX_DEFINITIONS[name];
    const duration = definition(ctx, voiceGain, { pitch: opts.pitch ?? 1 });
    this.activeVoiceEndTimes.push(now + duration);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain !== null && this.ctx !== null) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = clamp01(volume);
    if (this.masterGain !== null && this.ctx !== null && !this.muted) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  /** 音楽（music.ts）が同じ AudioContext を使うための公開。unlock() 前は null */
  context(): AudioContext | null {
    return this.ctx;
  }

  /** 現在同時発音中のボイス数（テスト・デバッグ用） */
  getActiveVoiceCount(): number {
    if (this.ctx === null) return 0;
    const now = this.ctx.currentTime;
    return this.activeVoiceEndTimes.filter((end) => end > now).length;
  }
}

export { SFX_DEFINITIONS };
