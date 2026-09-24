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
/** 反応の共通の 1 音の基音（A5）。系統ごとの音程はここからの比 */
const REACTION_PING = 880;
/** 溜めの段の基音（E5）。段ごとに主和音（根音・長 3 度・5 度）を上る */
const CHARGE_ROOT = 659.25;
/** 鐘らしさを出す非整数倍音の比（金属の円板の第 2 倍音に近い） */
const BELL_PARTIAL = 2.76;

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
  // 2026-09-24 レーン B の武器種
  swingKatana: [
    { k: "noise", filter: "bandpass", from: 7000, to: 2400, dur: 0.06, q: 3, peak: 0.24 },
    { k: "tone", type: "sine", freq: 2600, dur: 0.05, peak: 0.07 },
  ],
  swingAxe: [
    { k: "noise", filter: "bandpass", from: 2000, to: 500, dur: 0.14, q: 1.4, peak: 0.32 },
    { k: "tone", type: "triangle", freq: 130, dur: 0.12, peak: 0.18 },
  ],
  swingShield: [
    { k: "noise", filter: "lowpass", from: 700, to: 160, dur: 0.12, peak: 0.36 },
    { k: "tone", type: "square", freq: 95, dur: 0.08, peak: 0.12 },
  ],
  swingChainSickle: [
    { k: "noise", filter: "highpass", from: 5000, to: 2600, dur: 0.05, peak: 0.2 },
    { k: "tone", type: "triangle", freq: 3400, dur: 0.03, peak: 0.08, at: 0.03 },
  ],
  swingHammer: [
    { k: "noise", filter: "lowpass", from: 1000, to: 120, dur: 0.3, peak: 0.4 },
    { k: "tone", type: "sine", freq: 55, dur: 0.32, peak: 0.3 },
  ],
  swingGunner: [
    { k: "noise", filter: "bandpass", from: 3000, to: 1200, dur: 0.05, q: 1.5, peak: 0.2 },
    { k: "tone", type: "square", freq: 620, dur: 0.03, peak: 0.1 },
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
  // 2026-09-24 レーン B の射撃の型（三点は 1 発ごとに鳴る）
  shotBurst: [{ k: "sweep", type: "square", from: 1700, to: 700, dur: 0.035, peak: 0.22 }],
  shotBoomerang: [
    { k: "sweep", type: "triangle", from: 900, to: 1600, dur: 0.1, peak: 0.2 },
    { k: "noise", filter: "bandpass", from: 3000, to: 5000, dur: 0.1, q: 2, peak: 0.12 },
  ],
  shotLob: [
    { k: "tone", type: "sine", freq: 120, dur: 0.1, peak: 0.35 },
    { k: "noise", filter: "lowpass", from: 1400, to: 200, dur: 0.12, peak: 0.3 },
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

  // ---- 変身 第 3 弾（skills/forms.ts）: 変身は低い唸りに高い倍音、遠吠えは上がって下がる、砲撃は低く重い ----
  formShift: [
    { k: "sweep", type: "sawtooth", from: 120, to: 480, dur: 0.25, peak: 0.16 },
    { k: "noise", filter: "lowpass", from: 2400, to: 300, dur: 0.3, peak: 0.24 },
  ],
  wolfHowl: [
    { k: "sweep", type: "triangle", from: 380, to: 720, dur: 0.22, peak: 0.2 },
    { k: "sweep", type: "triangle", from: 720, to: 420, dur: 0.4, peak: 0.18, at: 0.22 },
  ],
  siegeCannon: [
    { k: "tone", type: "sine", freq: 55, dur: 0.35, peak: 0.5 },
    { k: "noise", filter: "lowpass", from: 1800, to: 120, dur: 0.3, peak: 0.5 },
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
  // ---- 泥が火で固まる（乾いた割れ）/ 強欲のが床の物をひったくる（短い上昇音）----
  mudHarden: [
    { k: "noise", filter: "lowpass", from: 1200, to: 200, dur: 0.18, peak: 0.3 },
    { k: "noise", filter: "bandpass", from: 2400, to: 900, dur: 0.06, q: 3, peak: 0.2, at: 0.05 },
  ],
  greedySnatch: [
    { k: "sweep", type: "triangle", from: 500, to: 1400, dur: 0.1, peak: 0.16 },
    { k: "tone", type: "square", freq: 1760, dur: 0.05, peak: 0.08, at: 0.08 },
  ],

  // ---- 反応の音（8-4）: 共通の短い 1 音（REACTION_PING の比で系統ごとに音程を変える）+ 系統の質感 1 層 ----
  reactionSteam: [
    { k: "tone", type: "sine", freq: REACTION_PING * 1.5, dur: 0.1, peak: 0.16 },
    { k: "noise", filter: "highpass", from: 1500, to: 6000, dur: 0.18, peak: 0.3 },
  ],
  reactionShatter: [
    { k: "tone", type: "triangle", freq: REACTION_PING * 2, dur: 0.1, peak: 0.18 },
    { k: "tone", type: "triangle", freq: REACTION_PING * 3.1, dur: 0.12, peak: 0.12, at: 0.015 },
    { k: "noise", filter: "highpass", from: 7000, to: 3500, dur: 0.1, peak: 0.34 },
  ],
  reactionBlaze: [
    { k: "tone", type: "sine", freq: REACTION_PING, dur: 0.1, peak: 0.18 },
    { k: "noise", filter: "bandpass", from: 600, to: 2600, dur: 0.2, q: 1.2, peak: 0.36 },
  ],
  reactionSpark: [
    { k: "tone", type: "square", freq: REACTION_PING * 1.78, dur: 0.06, peak: 0.12 },
    { k: "sweep", type: "sawtooth", from: 2400, to: 700, dur: 0.08, peak: 0.14 },
  ],
  reactionBlight: [
    { k: "tone", type: "sine", freq: REACTION_PING * 0.75, dur: 0.14, peak: 0.2 },
    { k: "noise", filter: "lowpass", from: 900, to: 200, dur: 0.16, peak: 0.28 },
  ],
  reactionSurge: [
    { k: "tone", type: "triangle", freq: REACTION_PING * 1.26, dur: 0.1, peak: 0.18 },
    { k: "sweep", type: "triangle", from: 300, to: 700, dur: 0.12, peak: 0.14 },
  ],

  // ---- 溜めの段（8-7）: 段ごとに主和音を上る 1 音。既存の chargeLevel（2 音の上昇）に重なる ----
  chargeStep1: [{ k: "tone", type: "triangle", freq: CHARGE_ROOT, dur: 0.12, peak: 0.2 }],
  chargeStep2: [{ k: "tone", type: "triangle", freq: CHARGE_ROOT * 2 ** (4 / 12), dur: 0.12, peak: 0.21 }],
  chargeStep3: [
    { k: "tone", type: "triangle", freq: CHARGE_ROOT * 2 ** (7 / 12), dur: 0.14, peak: 0.22 },
    { k: "tone", type: "sine", freq: CHARGE_ROOT * 2, dur: 0.18, peak: 0.12, at: 0.03 },
  ],

  // ---- 気力満タン（8-8）: 小さな鈴。鐘らしさは整数倍でない倍音で出す ----
  manaFull: [
    { k: "tone", type: "sine", freq: 1568, dur: 0.35, peak: 0.14 },
    { k: "tone", type: "sine", freq: 1568 * BELL_PARTIAL, dur: 0.2, peak: 0.06 },
  ],

  // ---- 芽と銘（8-9）: 芽は上昇の分散和音、銘は低めの鐘 ----
  budSprout: [{ k: "arp", type: "triangle", freqs: [523.25, 659.25, 783.99, 1046.5], note: 0.06, gap: 0.015, peak: 0.2 }],
  inscribe: [
    { k: "tone", type: "sine", freq: 392, dur: 1.2, peak: 0.3 },
    { k: "tone", type: "sine", freq: 392 * BELL_PARTIAL, dur: 0.8, peak: 0.12 },
    { k: "tone", type: "sine", freq: 392 * BELL_PARTIAL * 2, dur: 0.4, peak: 0.05 },
    { k: "noise", filter: "bandpass", from: 3000, to: 1500, dur: 0.05, q: 2, peak: 0.16 },
  ],

  // ---- 依頼の達成（8-10）: 短い 3 音のファンファーレ + 締めの和音 ----
  questComplete: [
    { k: "arp", type: "square", freqs: [523.25, 659.25, 783.99], note: 0.08, gap: 0.02, peak: 0.16 },
    { k: "chord", type: "triangle", freqs: [523.25, 783.99, 1046.5], dur: 0.45, peak: 0.12, at: 0.3 },
  ],

  // ---- 死神の接近の鼓動（8-14）: 低い 2 拍（どくん）。間隔は system/effects.ts が近さで縮める ----
  reaperHeartbeat: [
    { k: "tone", type: "sine", freq: 55, dur: 0.14, peak: 0.55 },
    { k: "noise", filter: "lowpass", from: 260, to: 60, dur: 0.1, peak: 0.25 },
    { k: "tone", type: "sine", freq: 48, dur: 0.16, peak: 0.42, at: 0.18 },
  ],

  // ---- 崩れる床が抜ける（低い崩落 + 砂利）/ 盗賊の煙玉（こもった破裂 + 噴き出す息）----
  rubbleFall: [
    { k: "noise", filter: "lowpass", from: 900, to: 90, dur: 0.35, peak: 0.45 },
    { k: "tone", type: "sine", freq: 65, dur: 0.3, peak: 0.3 },
    { k: "noise", filter: "bandpass", from: 3200, to: 1200, dur: 0.12, q: 2, peak: 0.16, at: 0.08 },
  ],
  smokeBomb: [
    { k: "noise", filter: "lowpass", from: 700, to: 150, dur: 0.12, peak: 0.35 },
    { k: "noise", filter: "highpass", from: 1800, to: 5000, dur: 0.4, peak: 0.22, at: 0.05 },
  ],

  // ---- コンボの可視化と爽快感パッケージ（docs/ideas/combat-feel-design.md D-1 / D-5）----
  /** 派生成立: 短い上昇の 2 音 */
  branch: [{ k: "arp", type: "triangle", freqs: [880, 1318.5], note: 0.05, gap: 0.01, peak: 0.2 }],
  /** 武器種の最終段・フィニッシュ派生の命中: 低い衝撃 + 高い刃音 */
  finisherHit: [
    { k: "tone", type: "sine", freq: 55, dur: 0.16, peak: 0.4 },
    { k: "noise", filter: "highpass", from: 8000, to: 3000, dur: 0.08, peak: 0.3 },
  ],
  /** 近接命中の低域のドン。hit と一緒に積む */
  hitThump: [{ k: "tone", type: "sine", freq: 70, dur: 0.07, peak: 0.3 }],
} as const satisfies Partial<Record<SfxName, readonly Layer[]>>;

export type LayeredSfxName = keyof typeof LAYERED_SFX;
