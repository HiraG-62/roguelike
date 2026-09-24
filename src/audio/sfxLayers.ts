/**
 * 層で組む効果音の表（docs/ideas/meta-and-weapons.md 8 章）。周波数（Hz）・長さ（秒）・音量（0..1）は音の手触りの定数。
 * sfx.ts の SFX_DEFINITIONS がこの表を展開する。キーは SfxName の一部（型で漏れを検査する）
 */
import type { Layer } from "./layers";
import type { SfxName } from "./sfxNames";

/** 響きのドロップ音の基音（C5）。色ごとの音程はここからの比 */
const DROP_ROOT = 523.25;
/** 半音の比 */
const semitone = (n: number): number => DROP_ROOT * 2 ** (n / 12);

export const LAYERED_SFX = {
  // ---- 武器種の振り音（8-1）: 重い武器ほど低く長い。段の slash1〜3 に重なるので控えめの音量 ----
  swingSword: [
    { k: "noise", filter: "bandpass", from: 5200, to: 1800, dur: 0.08, q: 2, peak: 0.22 },
    { k: "tone", type: "sine", freq: 1900, dur: 0.06, peak: 0.06 },
  ],
  swingGreatsword: [
    { k: "noise", filter: "lowpass", from: 1400, to: 180, dur: 0.24, peak: 0.38 },
    { k: "tone", type: "sine", freq: 70, dur: 0.28, peak: 0.26 },
  ],
  swingTwinBlades: [
    { k: "noise", filter: "bandpass", from: 6500, to: 2600, dur: 0.045, q: 2, peak: 0.22 },
    { k: "noise", filter: "bandpass", from: 7200, to: 3000, dur: 0.045, q: 2, peak: 0.21, at: 0.06 },
  ],
  swingSpear: [
    { k: "noise", filter: "highpass", from: 2800, to: 6500, dur: 0.07, peak: 0.22 },
    { k: "sweep", type: "triangle", from: 900, to: 1500, dur: 0.06, peak: 0.08 },
  ],
  swingScythe: [
    { k: "noise", filter: "bandpass", from: 1800, to: 650, dur: 0.22, q: 3, peak: 0.3 },
    { k: "sweep", type: "sine", from: 420, to: 200, dur: 0.2, peak: 0.09 },
  ],
  swingFists: [
    { k: "noise", filter: "lowpass", from: 900, to: 280, dur: 0.05, peak: 0.34 },
    { k: "tone", type: "square", freq: 140, dur: 0.04, peak: 0.14 },
  ],
  swingWhip: [
    { k: "noise", filter: "bandpass", from: 1200, to: 3200, dur: 0.08, q: 1.5, peak: 0.17 },
    { k: "noise", filter: "highpass", from: 8000, to: 3000, dur: 0.035, peak: 0.41, at: 0.08 },
  ],
  swingCleaver: [
    { k: "noise", filter: "bandpass", from: 2500, to: 600, dur: 0.12, q: 1.2, peak: 0.32 },
    { k: "tone", type: "triangle", freq: 180, dur: 0.1, peak: 0.17 },
  ],
  swingStaff: [
    { k: "noise", filter: "lowpass", from: 2200, to: 480, dur: 0.15, peak: 0.26 },
    { k: "tone", type: "sine", freq: 110, dur: 0.12, peak: 0.17 },
  ],
  swingWand: [
    { k: "arp", type: "sine", freqs: [1760, 2349], note: 0.04, gap: 0.01, peak: 0.12 },
    { k: "noise", filter: "highpass", from: 7000, to: 4000, dur: 0.06, peak: 0.09 },
  ],

  // ---- 射撃の型の発射音（8-2）----
  shotRapid: [{ k: "sweep", type: "square", from: 1400, to: 500, dur: 0.04, peak: 0.25 }],
  shotSpread: [
    { k: "noise", filter: "lowpass", from: 2600, to: 150, dur: 0.18, peak: 0.65 },
    { k: "tone", type: "sine", freq: 90, dur: 0.12, peak: 0.35 },
  ],
  shotPierce: [
    { k: "sweep", type: "sawtooth", from: 2200, to: 300, dur: 0.12, peak: 0.28 },
    { k: "noise", filter: "highpass", from: 6000, to: 2000, dur: 0.08, peak: 0.18 },
  ],
  shotHoming: [
    { k: "sweep", type: "sine", from: 600, to: 1400, dur: 0.12, peak: 0.3 },
    { k: "tone", type: "triangle", freq: 1800, dur: 0.05, peak: 0.12, at: 0.08 },
  ],
  shotRicochet: [
    { k: "tone", type: "triangle", freq: 3200, dur: 0.05, peak: 0.25 },
    { k: "sweep", type: "square", from: 2600, to: 1200, dur: 0.06, peak: 0.15 },
  ],
  shotCharge: [
    { k: "sweep", type: "sawtooth", from: 300, to: 2400, dur: 0.1, peak: 0.25 },
    { k: "noise", filter: "lowpass", from: 3000, to: 100, dur: 0.3, peak: 0.65, at: 0.08 },
    { k: "tone", type: "sine", freq: 60, dur: 0.3, peak: 0.4, at: 0.08 },
  ],
  shotMine: [
    { k: "tone", type: "square", freq: 440, dur: 0.03, peak: 0.22 },
    { k: "tone", type: "square", freq: 660, dur: 0.03, peak: 0.22, at: 0.05 },
    { k: "noise", filter: "lowpass", from: 600, to: 200, dur: 0.06, peak: 0.3 },
  ],

  // ---- 属性の命中音 ----
  hitFire: [{ k: "noise", filter: "bandpass", from: 2500, to: 700, dur: 0.15, peak: 0.35 }],
  hitIce: [
    { k: "tone", type: "triangle", freq: 2600, dur: 0.08, peak: 0.22 },
    { k: "tone", type: "triangle", freq: 3900, dur: 0.08, peak: 0.15, at: 0.02 },
  ],
  hitLightning: [
    { k: "sweep", type: "sawtooth", from: 3000, to: 600, dur: 0.07, peak: 0.2 },
    { k: "noise", filter: "highpass", from: 5000, to: 2000, dur: 0.05, peak: 0.28 },
  ],
  hitPoison: [{ k: "sweep", type: "sine", from: 300, to: 700, dur: 0.08, peak: 0.28 }],
  hitDark: [
    { k: "sweep", type: "triangle", from: 500, to: 120, dur: 0.14, peak: 0.28 },
    { k: "noise", filter: "lowpass", from: 800, to: 150, dur: 0.12, peak: 0.28 },
  ],
  hitLight: [{ k: "arp", type: "sine", freqs: [1568, 2093], note: 0.05, gap: 0, peak: 0.22 }],

  // ---- 状態異常の付与音（8-3）と怯み（8-6）----
  statusPoison: [{ k: "arp", type: "sine", freqs: [260, 340, 300], note: 0.04, gap: 0.02, peak: 0.28 }],
  statusBleed: [
    { k: "noise", filter: "lowpass", from: 1200, to: 300, dur: 0.08, peak: 0.38 },
    { k: "tone", type: "sine", freq: 180, dur: 0.05, peak: 0.18 },
  ],
  statusParalyze: [{ k: "arp", type: "square", freqs: [1000, 1000, 1000], note: 0.025, gap: 0.03, peak: 0.18 }],
  statusFear: [{ k: "arp", type: "triangle", freqs: [523.25, 415.3, 311.13], note: 0.07, gap: 0.005, peak: 0.24 }],
  statusCurse: [
    { k: "sweep", type: "sawtooth", from: 400, to: 180, dur: 0.18, peak: 0.16 },
    { k: "tone", type: "sine", freq: 90, dur: 0.18, peak: 0.2 },
  ],
  statusWet: [{ k: "noise", filter: "bandpass", from: 800, to: 2400, dur: 0.07, q: 3, peak: 0.32 }],
  statusBuff: [{ k: "arp", type: "triangle", freqs: [660, 880, 1320], note: 0.04, gap: 0.01, peak: 0.26 }],
  stagger: [
    { k: "tone", type: "square", freq: 520, dur: 0.08, peak: 0.3 },
    { k: "tone", type: "triangle", freq: 1300, dur: 0.12, peak: 0.18 },
    { k: "noise", filter: "highpass", from: 4000, to: 1500, dur: 0.06, peak: 0.28 },
  ],
  bossDown: [
    { k: "tone", type: "sine", freq: 70, dur: 1.2, peak: 0.55 },
    { k: "tone", type: "sine", freq: 104, dur: 1, peak: 0.3 },
    { k: "tone", type: "sine", freq: 157, dur: 0.8, peak: 0.2 },
    { k: "noise", filter: "lowpass", from: 900, to: 100, dur: 0.4, peak: 0.32 },
  ],

  // ---- 響きの色のドロップ音（8-5）: 紅 = 長 3 度、蒼 = 短 3 度、翠 = 4 度、金 = 5 度、冥 = 減 5 度 ----
  dropCrimson: [{ k: "chord", type: "triangle", freqs: [DROP_ROOT, semitone(4), semitone(12)], dur: 0.4, peak: 0.16 }],
  dropAzure: [{ k: "chord", type: "triangle", freqs: [DROP_ROOT, semitone(3), semitone(12)], dur: 0.4, peak: 0.16 }],
  dropJade: [{ k: "chord", type: "triangle", freqs: [DROP_ROOT, semitone(5), semitone(12)], dur: 0.4, peak: 0.16 }],
  dropGold: [{ k: "chord", type: "triangle", freqs: [DROP_ROOT, semitone(7), semitone(12)], dur: 0.45, peak: 0.16 }],
  dropUmbra: [{ k: "chord", type: "sawtooth", freqs: [DROP_ROOT / 2, semitone(6) / 2, DROP_ROOT], dur: 0.45, peak: 0.1 }],

  // ---- 演出に合わせた音 ----
  crit: [
    { k: "tone", type: "square", freq: 2400, dur: 0.04, peak: 0.2 },
    { k: "noise", filter: "highpass", from: 7000, to: 3000, dur: 0.05, peak: 0.28 },
  ],
  comboMilestone: [{ k: "arp", type: "square", freqs: [784, 987.77, 1174.66, 1568], note: 0.045, gap: 0.01, peak: 0.22 }],
  hordeSeal: [
    { k: "tone", type: "sawtooth", freq: 60, dur: 0.5, peak: 0.3 },
    { k: "noise", filter: "lowpass", from: 1500, to: 80, dur: 0.5, peak: 0.55 },
    { k: "tone", type: "square", freq: 1900, dur: 0.25, peak: 0.12, at: 0.05 },
  ],
  execute: [
    { k: "noise", filter: "highpass", from: 9000, to: 2500, dur: 0.12, peak: 0.55 },
    { k: "tone", type: "sine", freq: 80, dur: 0.3, peak: 0.45 },
    { k: "sweep", type: "sawtooth", from: 2600, to: 400, dur: 0.15, peak: 0.18 },
  ],
} as const satisfies Partial<Record<SfxName, readonly Layer[]>>;

export type LayeredSfxName = keyof typeof LAYERED_SFX;
