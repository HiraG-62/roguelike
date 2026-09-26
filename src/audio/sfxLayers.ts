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

/**
 * 金属・刃・結晶の非整数倍の部分音の比（metal 層）。整数倍だと「ピー」という電子音になるので、ずらした比で鳴らす
 * - BLADE_RING: 薄い刃の「シャリン」、CLANG: 厚い金属のぶつかり、CRYSTAL: 氷・ガラスのきらめき、CHAIN: 鎖・小さな金具
 */
const BLADE_RING = [1, 1.47, 2.09] as const;
const CLANG = [1, 1.34, 2.19, 2.83] as const;
const CRYSTAL = [1, 1.53, 2.37, 3.1] as const;
const CHAIN = [1, 1.37, 1.93, 2.61] as const;
/** 鐘（FM）の変調比。整数でない比が鐘らしい濁った倍音を作る */
const BELL_FM_RATIO = 1.4;

export const LAYERED_SFX = {
  // ==== 近接の段の斬撃音（player.ts が段 1〜3 で積む。スキルが単独でも使う）====
  // 風切りは「膨らむ → 頂点 → 抜ける」。低 → 高へ上がりながら膨らむ帯域ノイズ（ヒュ）と、頂点から高 → 低へ抜ける帯域ノイズ（ッ）を
  // 繋いで刃が通り過ぎるドップラーを作る。頂点に細い刃先の笛（高 Q の帯域）と小さなクリックを置いて「鋭さ」を出す。
  // 押した瞬間にクリックを鳴らすと命中音と紛れるので、トランジェントは頂点（振りの windup が明ける頃）へ遅らせる。段が進むほど低く長く重い
  slash1: [
    { k: "noise", filter: "bandpass", from: 3500, to: 7500, dur: 0.035, q: 1.6, attack: 0.03, peak: 0.22 },
    { k: "noise", filter: "bandpass", from: 7500, to: 2000, dur: 0.08, q: 2, attack: 0.006, peak: 0.4, at: 0.028 },
    { k: "noise", filter: "bandpass", from: 8500, to: 4000, dur: 0.07, q: 7, attack: 0.012, peak: 0.1, at: 0.02 },
    { k: "click", freq: 7500, peak: 0.12, at: 0.03 },
  ],
  slash2: [
    { k: "noise", filter: "bandpass", from: 3000, to: 6500, dur: 0.045, q: 1.5, attack: 0.038, peak: 0.24 },
    { k: "noise", filter: "bandpass", from: 6500, to: 1600, dur: 0.1, q: 1.8, attack: 0.008, peak: 0.44, at: 0.036 },
    { k: "noise", filter: "bandpass", from: 7500, to: 3500, dur: 0.085, q: 6, attack: 0.014, peak: 0.1, at: 0.025 },
    { k: "noise", filter: "lowpass", from: 1800, to: 400, dur: 0.09, attack: 0.02, peak: 0.15, at: 0.03 },
    { k: "click", freq: 6500, peak: 0.12, at: 0.038 },
  ],
  slash3: [
    { k: "noise", filter: "bandpass", from: 2400, to: 5500, dur: 0.06, q: 1.4, attack: 0.05, peak: 0.26 },
    { k: "noise", filter: "bandpass", from: 5500, to: 900, dur: 0.15, q: 1.5, attack: 0.01, peak: 0.48, at: 0.05 },
    { k: "noise", filter: "bandpass", from: 6500, to: 2800, dur: 0.1, q: 5, attack: 0.02, peak: 0.09, at: 0.04 },
    { k: "kick", from: 160, to: 55, drop: 0.08, dur: 0.16, peak: 0.3, drive: 2, at: 0.05 },
    { k: "noise", filter: "lowpass", from: 1200, to: 150, dur: 0.2, attack: 0.02, peak: 0.2, at: 0.05 },
    { k: "click", freq: 5500, peak: 0.14, at: 0.05 },
  ],

  // ---- 武器種の振り音（8-1）: 段の slash1〜3 に重ねる。軽い武器ほど高く鋭く短く、重い武器ほど低く、立ち上がりを遅らせて「ブンッ」と膨らませる ----
  // 剣: 段の slash の高い「シュッ」に、刃の幅が押しのける中域の「フォッ」を足す（同じ帯域を重ねると位相で濁るので 2.2k 以下に置く）
  swingSword: [
    { k: "noise", filter: "bandpass", from: 2200, to: 800, dur: 0.1, q: 1.2, attack: 0.03, peak: 0.18 },
    { k: "metal", freq: 3400, ratios: BLADE_RING, dur: 0.06, peak: 0.03, at: 0.03 },
  ],
  swingGreatsword: [
    { k: "noise", filter: "lowpass", from: 1800, to: 180, dur: 0.28, attack: 0.09, peak: 0.55 },
    { k: "noise", filter: "bandpass", from: 1400, to: 400, dur: 0.22, q: 1.2, attack: 0.07, peak: 0.24 },
    { k: "kick", from: 90, to: 40, drop: 0.15, dur: 0.3, peak: 0.34 },
  ],
  // 双剣: 短い 2 本の「シュッ」。立ち上がりを 6ms → 18ms に伸ばし、打鍵のような「チッ」でなく空気の膨らみにする
  swingTwinBlades: [
    { k: "noise", filter: "bandpass", from: 8000, to: 3000, dur: 0.05, q: 3, attack: 0.018, peak: 0.28 },
    { k: "noise", filter: "bandpass", from: 9000, to: 3400, dur: 0.05, q: 3, attack: 0.018, peak: 0.28, at: 0.055 },
    { k: "metal", freq: 4000, ratios: BLADE_RING, dur: 0.05, peak: 0.03, at: 0.07 },
  ],
  // 突き: 帯域を低 → 高へ上げて「ヒュッ」と前へ出る感じ、穂先が止まる所にクリック
  swingSpear: [
    { k: "noise", filter: "bandpass", from: 1500, to: 5500, dur: 0.08, q: 2, attack: 0.03, peak: 0.32 },
    { k: "click", freq: 4500, peak: 0.2, at: 0.07 },
  ],
  swingScythe: [
    { k: "noise", filter: "bandpass", from: 2400, to: 700, dur: 0.24, q: 3, attack: 0.08, peak: 0.4 },
    { k: "metal", freq: 1900, ratios: BLADE_RING, dur: 0.2, peak: 0.04, at: 0.06 },
  ],
  swingFists: [
    { k: "noise", filter: "lowpass", from: 1500, to: 300, dur: 0.06, attack: 0.004, peak: 0.4 },
    { k: "kick", from: 200, to: 90, drop: 0.03, dur: 0.06, peak: 0.22 },
  ],
  // 鞭: しなりが先端へ加速していく上昇のうなり（ヒュゥ↑、立ち上がりを長くして膨らませる）+ 同じく上がる細い笛 →
  // 先端が音速を超える「パシッ」。クラックは 1ms 未満で立つ歪んだ中高域（パ）+ 45ms の高域の擦れ（シッ）。
  // 頂点は鞭の windup（60〜100ms）が明ける 75ms に合わせる
  swingWhip: [
    { k: "noise", filter: "bandpass", from: 700, to: 3000, dur: 0.085, q: 1.3, attack: 0.07, peak: 0.2 },
    { k: "noise", filter: "bandpass", from: 1800, to: 6000, dur: 0.08, q: 5, attack: 0.065, peak: 0.07 },
    { k: "click", freq: 3500, peak: 0.34, at: 0.075 },
    { k: "noise", filter: "bandpass", from: 3000, to: 1500, dur: 0.02, q: 0.8, attack: 0.0005, peak: 0.28, drive: 3, at: 0.075 },
    { k: "noise", filter: "highpass", from: 7000, to: 4000, dur: 0.045, attack: 0.001, peak: 0.16, at: 0.078 },
  ],
  swingCleaver: [
    { k: "noise", filter: "bandpass", from: 3000, to: 700, dur: 0.13, q: 1.4, attack: 0.02, peak: 0.42 },
    { k: "kick", from: 150, to: 70, drop: 0.05, dur: 0.1, peak: 0.2 },
  ],
  swingStaff: [
    { k: "noise", filter: "lowpass", from: 2600, to: 500, dur: 0.16, attack: 0.05, peak: 0.38 },
    { k: "kick", from: 120, to: 70, drop: 0.08, dur: 0.12, peak: 0.15 },
  ],
  swingWand: [
    { k: "noise", filter: "highpass", from: 7000, to: 4000, dur: 0.08, attack: 0.02, peak: 0.15 },
    { k: "fm", freq: 1760, ratio: 2.01, index: 1.5, dur: 0.12, peak: 0.08 },
  ],
  // 刀: いちばん鋭い。狭い帯域の高い掃引 + 細い笛 + 長めの刃鳴り（クリックは膨らみの頂点へ）
  swingKatana: [
    { k: "noise", filter: "bandpass", from: 9000, to: 2800, dur: 0.07, q: 3.5, attack: 0.02, peak: 0.34 },
    { k: "noise", filter: "bandpass", from: 10000, to: 5000, dur: 0.06, q: 8, attack: 0.015, peak: 0.08, at: 0.01 },
    { k: "click", freq: 7000, peak: 0.16, at: 0.02 },
    { k: "metal", freq: 4200, ratios: BLADE_RING, dur: 0.12, peak: 0.05, at: 0.02 },
  ],
  swingAxe: [
    { k: "noise", filter: "bandpass", from: 2200, to: 450, dur: 0.16, q: 1.4, attack: 0.04, peak: 0.45 },
    { k: "kick", from: 130, to: 55, drop: 0.06, dur: 0.14, peak: 0.24, drive: 1.5 },
  ],
  swingShield: [
    { k: "noise", filter: "lowpass", from: 900, to: 160, dur: 0.13, attack: 0.03, peak: 0.45 },
    { k: "kick", from: 110, to: 55, drop: 0.05, dur: 0.1, peak: 0.24 },
    { k: "metal", freq: 620, ratios: CLANG, dur: 0.1, peak: 0.05 },
  ],
  swingChainSickle: [
    { k: "noise", filter: "highpass", from: 6000, to: 2600, dur: 0.06, attack: 0.01, peak: 0.26 },
    { k: "metal", freq: 3400, ratios: CHAIN, dur: 0.06, peak: 0.05, at: 0.02 },
  ],
  // 戦鎚: いちばん重い。遅い立ち上がりの低い風切り + 深いサブ
  swingHammer: [
    { k: "noise", filter: "lowpass", from: 1200, to: 120, dur: 0.32, attack: 0.11, peak: 0.6 },
    { k: "kick", from: 70, to: 35, drop: 0.2, dur: 0.34, peak: 0.42, drive: 2 },
  ],
  swingGunner: [
    { k: "noise", filter: "bandpass", from: 3000, to: 1200, dur: 0.06, q: 1.5, attack: 0.01, peak: 0.3 },
    { k: "metal", freq: 1400, ratios: [1, 1.6], dur: 0.05, peak: 0.04 },
  ],
  // 銃の家系のダッシュ攻撃・固有技: 軽い銃ほど高く短く、砲は低く重く
  swingSidearm: [
    { k: "noise", filter: "bandpass", from: 3600, to: 1500, dur: 0.05, q: 1.5, attack: 0.008, peak: 0.28 },
    { k: "click", freq: 5000, peak: 0.2 },
  ],
  swingLongarm: [
    { k: "noise", filter: "bandpass", from: 2400, to: 700, dur: 0.09, q: 1.2, attack: 0.02, peak: 0.32 },
    { k: "metal", freq: 900, ratios: [1, 1.52], dur: 0.06, peak: 0.04 },
  ],
  swingCannon: [
    { k: "noise", filter: "lowpass", from: 1500, to: 200, dur: 0.14, attack: 0.03, peak: 0.45 },
    { k: "kick", from: 100, to: 50, drop: 0.06, dur: 0.12, peak: 0.24 },
  ],
  swingThrown: [{ k: "noise", filter: "bandpass", from: 5000, to: 2000, dur: 0.07, q: 2.5, attack: 0.015, peak: 0.3 }],
  // 擲弾: 筒の鈍い打撃（砲より高く短い）
  swingGrenade: [
    { k: "noise", filter: "lowpass", from: 2000, to: 300, dur: 0.1, attack: 0.02, peak: 0.38 },
    { k: "kick", from: 150, to: 80, drop: 0.04, dur: 0.08, peak: 0.2 },
  ],
  // 仕掛け: 金具の軽い擦れ
  swingTrapper: [
    { k: "noise", filter: "bandpass", from: 3200, to: 1300, dur: 0.05, q: 1.5, attack: 0.01, peak: 0.25 },
    { k: "metal", freq: 1800, ratios: [1, 1.43], dur: 0.04, peak: 0.04 },
  ],
  // 戦輪: 刃の輪が風を切って回る（うなる FM）
  swingWarRing: [
    { k: "noise", filter: "bandpass", from: 6000, to: 2800, dur: 0.12, q: 3, attack: 0.03, peak: 0.3 },
    { k: "fm", freq: 1600, ratio: 1.41, index: 2, dur: 0.12, peak: 0.06, to: 900 },
  ],

  // ==== 近接の命中（combat.ts: 軽撃は hit + hitThump、重撃は hitHeavy）====
  // トランジェント（click）+ 肉を斬るボディ（歪ませた帯域ノイズ）+ 刃の縁（高域）+ 湿ったテール
  hit: [
    { k: "click", freq: 3000, peak: 0.5 },
    { k: "noise", filter: "bandpass", from: 1800, to: 450, dur: 0.07, q: 1.2, peak: 0.55, drive: 2 },
    { k: "noise", filter: "highpass", from: 5000, to: 2500, dur: 0.03, peak: 0.22 },
    { k: "noise", filter: "lowpass", from: 800, to: 200, dur: 0.1, peak: 0.18, at: 0.01 },
  ],
  /** 近接命中の低域のドン。hit と一緒に積む（重撃は hitHeavy が自分で低域を持つ） */
  hitThump: [{ k: "kick", from: 150, to: 50, drop: 0.05, dur: 0.1, peak: 0.5, drive: 1.5 }],
  hitHeavy: [
    { k: "click", freq: 2000, peak: 0.6 },
    { k: "kick", from: 120, to: 38, drop: 0.09, dur: 0.26, peak: 0.7, drive: 2.5 },
    { k: "noise", filter: "bandpass", from: 1200, to: 250, dur: 0.14, q: 1, peak: 0.6, drive: 2.5 },
    { k: "noise", filter: "lowpass", from: 600, to: 80, dur: 0.3, peak: 0.28, at: 0.02 },
  ],
  // ---- 命中音の系統（刃・打撃・刺突・鞭打）× 重さ（system/effects.ts の hitSfxName が選ぶ）----
  // 斬撃「ザシュッ」: 刃が入る瞬間のクリック + 歪ませた広い帯域ノイズ（ザ）+ 刃が抜けていく高 → 低の帯域ノイズ（シュッ、15ms 遅れて膨らむ）
  // + 湿った肉の中低域（歪ませた 1k → 300Hz の帯域ノイズ）。刃鳴りは金属どうしの音に聞こえないよう短く小さく添えるだけ
  hitSlashLight: [
    { k: "click", freq: 5000, peak: 0.22 },
    { k: "noise", filter: "bandpass", from: 4500, to: 1800, dur: 0.045, q: 0.9, attack: 0.001, peak: 0.3, drive: 1.5 },
    { k: "noise", filter: "bandpass", from: 6000, to: 2500, dur: 0.07, q: 1.8, attack: 0.012, peak: 0.2, at: 0.012 },
    { k: "noise", filter: "bandpass", from: 1100, to: 350, dur: 0.05, q: 1.4, attack: 0.002, peak: 0.16, drive: 2, at: 0.004 },
    { k: "metal", freq: 4200, ratios: BLADE_RING, dur: 0.06, peak: 0.025, at: 0.004 },
  ],
  hitSlashMid: [
    { k: "click", freq: 4500, peak: 0.25 },
    { k: "noise", filter: "bandpass", from: 4000, to: 1400, dur: 0.06, q: 0.9, attack: 0.001, peak: 0.34, drive: 1.8 },
    { k: "noise", filter: "bandpass", from: 5500, to: 2000, dur: 0.09, q: 1.6, attack: 0.015, peak: 0.22, at: 0.015 },
    { k: "noise", filter: "bandpass", from: 900, to: 260, dur: 0.07, q: 1.3, attack: 0.002, peak: 0.2, drive: 2, at: 0.005 },
    { k: "metal", freq: 3600, ratios: BLADE_RING, dur: 0.09, peak: 0.03, at: 0.005 },
  ],
  hitSlashHeavy: [
    { k: "click", freq: 3800, peak: 0.3 },
    { k: "noise", filter: "bandpass", from: 3400, to: 1000, dur: 0.075, q: 0.8, attack: 0.001, peak: 0.38, drive: 2.2 },
    { k: "noise", filter: "bandpass", from: 5000, to: 1500, dur: 0.12, q: 1.4, attack: 0.02, peak: 0.24, at: 0.02 },
    { k: "noise", filter: "bandpass", from: 750, to: 200, dur: 0.1, q: 1.2, attack: 0.002, peak: 0.24, drive: 2.2, at: 0.006 },
    { k: "kick", from: 110, to: 45, drop: 0.07, dur: 0.18, peak: 0.4, drive: 2 },
    { k: "metal", freq: 2600, ratios: BLADE_RING, dur: 0.14, peak: 0.035, at: 0.008 },
  ],
  // 打撃「バシッ」: クリック + 歪ませた帯域ノイズ + 深いキック
  hitBluntLight: [
    { k: "click", freq: 2800, peak: 0.5 },
    { k: "noise", filter: "bandpass", from: 1800, to: 500, dur: 0.035, q: 0.9, peak: 0.55, drive: 2 },
    { k: "kick", from: 220, to: 90, drop: 0.03, dur: 0.06, peak: 0.4, drive: 1.5 },
  ],
  hitBluntMid: [
    { k: "click", freq: 2200, peak: 0.6 },
    { k: "noise", filter: "bandpass", from: 1400, to: 300, dur: 0.05, q: 0.8, peak: 0.7, drive: 3 },
    { k: "kick", from: 170, to: 55, drop: 0.04, dur: 0.09, peak: 0.55, drive: 2 },
  ],
  hitBluntHeavy: [
    { k: "click", freq: 1800, peak: 0.65 },
    { k: "noise", filter: "bandpass", from: 1200, to: 250, dur: 0.06, q: 0.8, peak: 0.65, drive: 3 },
    { k: "kick", from: 100, to: 35, drop: 0.1, dur: 0.3, peak: 0.75, drive: 3 },
    { k: "noise", filter: "lowpass", from: 500, to: 80, dur: 0.25, peak: 0.3, at: 0.03 },
  ],
  // 刺突: クリック + 低→高の狭い帯域ノイズ（突き刺す）+ 抜けの低域 + 刃鳴り
  hitPierceLight: [
    { k: "click", freq: 7200, peak: 0.25 },
    { k: "noise", filter: "bandpass", from: 3400, to: 7500, dur: 0.035, q: 3.2, peak: 0.3 },
    { k: "noise", filter: "lowpass", from: 800, to: 250, dur: 0.05, peak: 0.22, drive: 1.5 },
    { k: "metal", freq: 4600, ratios: BLADE_RING, dur: 0.08, peak: 0.035, at: 0.015 },
  ],
  hitPierceMid: [
    { k: "click", freq: 6500, peak: 0.3 },
    { k: "noise", filter: "bandpass", from: 3000, to: 7000, dur: 0.05, q: 3, peak: 0.35 },
    { k: "noise", filter: "lowpass", from: 700, to: 200, dur: 0.08, peak: 0.3, drive: 2 },
    { k: "metal", freq: 4200, ratios: BLADE_RING, dur: 0.12, peak: 0.04, at: 0.02 },
  ],
  hitPierceHeavy: [
    { k: "click", freq: 5500, peak: 0.35 },
    { k: "noise", filter: "bandpass", from: 2800, to: 6500, dur: 0.06, q: 2.5, peak: 0.4 },
    { k: "noise", filter: "lowpass", from: 650, to: 180, dur: 0.1, peak: 0.32, drive: 2 },
    { k: "metal", freq: 3800, ratios: BLADE_RING, dur: 0.15, peak: 0.05, at: 0.02 },
    { k: "kick", from: 130, to: 50, drop: 0.06, dur: 0.15, peak: 0.4 },
  ],
  // 鞭打「ピシッ」: 高めのクリック + 1ms 未満で立ち 20〜35ms で消える歪んだ中高域（パ）+ 高域の擦れ（シッ）+ 皮膚を打つ短い中域。
  // 打撃（blunt）のような深いキックは重い段にだけ小さく置く（近接命中には hitThump のドンが別に重なるため）
  hitLashLight: [
    { k: "click", freq: 4500, peak: 0.32 },
    { k: "noise", filter: "bandpass", from: 3200, to: 1600, dur: 0.022, q: 0.9, attack: 0.0005, peak: 0.3, drive: 3 },
    { k: "noise", filter: "highpass", from: 8000, to: 4500, dur: 0.04, attack: 0.002, peak: 0.16, at: 0.004 },
    { k: "noise", filter: "bandpass", from: 1200, to: 500, dur: 0.03, q: 1, attack: 0.001, peak: 0.14, drive: 1.5 },
  ],
  hitLashMid: [
    { k: "click", freq: 4000, peak: 0.36 },
    { k: "noise", filter: "bandpass", from: 2800, to: 1300, dur: 0.028, q: 0.9, attack: 0.0005, peak: 0.34, drive: 3 },
    { k: "noise", filter: "highpass", from: 7500, to: 4000, dur: 0.05, attack: 0.002, peak: 0.18, at: 0.004 },
    { k: "noise", filter: "bandpass", from: 1000, to: 400, dur: 0.04, q: 1, attack: 0.001, peak: 0.18, drive: 1.5 },
  ],
  hitLashHeavy: [
    { k: "click", freq: 3500, peak: 0.4 },
    { k: "noise", filter: "bandpass", from: 2500, to: 1000, dur: 0.035, q: 0.8, attack: 0.0005, peak: 0.38, drive: 3.5 },
    { k: "noise", filter: "highpass", from: 7000, to: 3500, dur: 0.065, attack: 0.002, peak: 0.2, at: 0.005 },
    { k: "noise", filter: "bandpass", from: 900, to: 300, dur: 0.06, q: 1, attack: 0.001, peak: 0.22, drive: 2 },
    { k: "kick", from: 140, to: 60, drop: 0.04, dur: 0.09, peak: 0.25, drive: 1.5 },
  ],
  /** 弾の命中（砲・溜め弾・擲弾の直撃）: bulletHit に低域の衝撃を足す */
  bulletHitHeavy: [
    { k: "click", freq: 2500, peak: 0.4 },
    { k: "noise", filter: "bandpass", from: 2000, to: 500, dur: 0.05, q: 1, peak: 0.4, drive: 1.5 },
    { k: "kick", from: 180, to: 80, drop: 0.03, dur: 0.05, peak: 0.2 },
    { k: "noise", filter: "lowpass", from: 600, to: 100, dur: 0.2, peak: 0.3 },
    { k: "kick", from: 90, to: 35, drop: 0.08, dur: 0.22, peak: 0.5 },
  ],

  /** 武器種の最終段・フィニッシュ派生の命中: 深い衝撃 + 高い刃音 + 金属の余韻 */
  finisherHit: [
    { k: "kick", from: 90, to: 32, drop: 0.12, dur: 0.35, peak: 0.6, drive: 3 },
    { k: "noise", filter: "highpass", from: 9000, to: 3000, dur: 0.1, peak: 0.35 },
    { k: "metal", freq: 2200, ratios: CLANG, dur: 0.3, peak: 0.07, at: 0.005 },
    { k: "noise", filter: "lowpass", from: 900, to: 90, dur: 0.4, peak: 0.28, at: 0.03 },
  ],
  /** 会心: 高い金属のきらめき（命中音の上に乗る） */
  crit: [
    { k: "click", freq: 8000, peak: 0.4 },
    { k: "metal", freq: 3100, ratios: [1, 1.47, 2.09, 2.76], dur: 0.28, peak: 0.09 },
    { k: "fm", freq: 4200, ratio: 1.414, index: 3, dur: 0.15, peak: 0.05 },
  ],
  /** 弱点: 上がる 2 音のきらめき（会心の金属音とは聞き分けられるよう音程で鳴らす） */
  weakHit: [
    { k: "arp", type: "sine", freqs: [1318.5, 1760], note: 0.04, gap: 0, peak: 0.12 },
    { k: "metal", freq: 3520, ratios: [1, 1.34], dur: 0.15, peak: 0.05, at: 0.04 },
  ],
  /** 耐性: こもった鈍い当たり */
  resistHit: [
    { k: "kick", from: 200, to: 120, drop: 0.04, dur: 0.06, peak: 0.2 },
    { k: "noise", filter: "lowpass", from: 600, to: 200, dur: 0.05, peak: 0.2 },
  ],
  /** 撃破: 弾ける破裂 + 低い落ち + 小さなご褒美のきらめき */
  kill: [
    { k: "kick", from: 110, to: 40, drop: 0.06, dur: 0.16, peak: 0.5, drive: 2 },
    { k: "noise", filter: "bandpass", from: 2200, to: 300, dur: 0.18, q: 0.9, peak: 0.5, drive: 1.5 },
    { k: "noise", filter: "lowpass", from: 1200, to: 100, dur: 0.3, peak: 0.22, at: 0.03 },
    { k: "arp", type: "sine", freqs: [880, 1320], note: 0.04, gap: 0, peak: 0.08, at: 0.02 },
  ],

  // ==== 射撃（8-2）: 銃声 = クリック + 歪ませた破裂ノイズ + 短いキック + 尾。弾の性質ごとに太さと尾を変える ====
  shoot: [
    { k: "click", freq: 3000, peak: 0.5 },
    { k: "noise", filter: "bandpass", from: 3000, to: 700, dur: 0.08, q: 0.9, peak: 0.5, drive: 2.5 },
    { k: "kick", from: 220, to: 80, drop: 0.03, dur: 0.07, peak: 0.3 },
    { k: "noise", filter: "lowpass", from: 1400, to: 200, dur: 0.15, peak: 0.14, at: 0.01 },
  ],
  // 連射: 短く乾いた破裂音（尾を持たない）
  shotRapid: [
    { k: "click", freq: 4000, peak: 0.4 },
    { k: "noise", filter: "bandpass", from: 4000, to: 1400, dur: 0.04, q: 1, peak: 0.42, drive: 3 },
    { k: "kick", from: 300, to: 140, drop: 0.02, dur: 0.035, peak: 0.18 },
  ],
  // 散弾: 太い。深いキックと広い帯域の破裂 + 長めの尾
  shotSpread: [
    { k: "click", freq: 2000, peak: 0.6 },
    { k: "kick", from: 140, to: 45, drop: 0.06, dur: 0.2, peak: 0.6, drive: 3 },
    { k: "noise", filter: "lowpass", from: 3500, to: 200, dur: 0.22, peak: 0.6, drive: 2 },
    { k: "noise", filter: "bandpass", from: 1200, to: 300, dur: 0.35, peak: 0.18, at: 0.02 },
  ],
  // 貫通（長銃）: 鋭い高音の割れ + 遠くへ抜ける尾
  shotPierce: [
    { k: "click", freq: 6000, peak: 0.5 },
    { k: "noise", filter: "highpass", from: 7000, to: 2500, dur: 0.06, peak: 0.4, drive: 2 },
    { k: "kick", from: 180, to: 60, drop: 0.05, dur: 0.12, peak: 0.34, drive: 2 },
    { k: "noise", filter: "bandpass", from: 2500, to: 600, dur: 0.4, q: 1.5, peak: 0.16, at: 0.03 },
    { k: "noise", filter: "bandpass", from: 1800, to: 500, dur: 0.3, q: 1.5, peak: 0.07, at: 0.16 },
  ],
  shotHoming: [
    { k: "click", freq: 4000, peak: 0.25 },
    { k: "sweep", type: "sine", from: 600, to: 1400, dur: 0.12, peak: 0.2 },
    { k: "noise", filter: "bandpass", from: 2500, to: 5000, dur: 0.1, q: 2, attack: 0.03, peak: 0.15 },
  ],
  shotRicochet: [
    { k: "click", freq: 4000, peak: 0.4 },
    { k: "noise", filter: "bandpass", from: 3500, to: 1500, dur: 0.05, peak: 0.35, drive: 2 },
    { k: "metal", freq: 3200, ratios: [1, 1.43, 2.1], dur: 0.12, peak: 0.08 },
  ],
  // 溜め撃ち（砲）: 解放の唸り → 低いドン + 崩れる尾
  shotCharge: [
    { k: "sweep", type: "sawtooth", from: 300, to: 2400, dur: 0.1, peak: 0.12 },
    { k: "click", freq: 1500, peak: 0.6, at: 0.06 },
    { k: "kick", from: 90, to: 32, drop: 0.12, dur: 0.35, peak: 0.6, drive: 3, at: 0.06 },
    { k: "noise", filter: "lowpass", from: 3000, to: 100, dur: 0.35, peak: 0.5, drive: 1.5, at: 0.06 },
  ],
  shotMine: [
    { k: "click", freq: 3000, peak: 0.3 },
    { k: "metal", freq: 880, ratios: [1, 1.5], dur: 0.08, peak: 0.1 },
    { k: "noise", filter: "lowpass", from: 600, to: 200, dur: 0.06, peak: 0.3 },
  ],
  // 三点（1 発ごとに鳴る）: 連射より少し高く短い
  shotBurst: [
    { k: "click", freq: 4500, peak: 0.4 },
    { k: "noise", filter: "bandpass", from: 4500, to: 1600, dur: 0.035, q: 1, peak: 0.4, drive: 3 },
    { k: "kick", from: 320, to: 150, drop: 0.02, dur: 0.03, peak: 0.16 },
  ],
  shotBoomerang: [
    { k: "noise", filter: "bandpass", from: 3000, to: 5000, dur: 0.12, q: 2, attack: 0.04, peak: 0.3 },
    { k: "fm", freq: 900, ratio: 1.5, index: 1, dur: 0.1, peak: 0.08, to: 1600 },
  ],
  // 曲射（砲・擲弾）: 筒の低い「ドン」
  shotLob: [
    { k: "click", freq: 1500, peak: 0.3 },
    { k: "kick", from: 90, to: 40, drop: 0.08, dur: 0.22, peak: 0.55, drive: 2 },
    { k: "noise", filter: "lowpass", from: 1400, to: 150, dur: 0.18, peak: 0.35 },
  ],
  /** 弾の命中: 小さな破裂 */
  bulletHit: [
    { k: "click", freq: 2500, peak: 0.4 },
    { k: "noise", filter: "bandpass", from: 2000, to: 500, dur: 0.05, q: 1, peak: 0.4, drive: 1.5 },
    { k: "kick", from: 180, to: 80, drop: 0.03, dur: 0.05, peak: 0.2 },
  ],
  /** 敵の射撃: 自分の銃声より軽く、聞き分けられる「ポン」 */
  enemyShoot: [
    { k: "noise", filter: "bandpass", from: 2000, to: 800, dur: 0.06, q: 1.2, peak: 0.25 },
    { k: "sweep", type: "triangle", from: 700, to: 260, dur: 0.08, peak: 0.15 },
  ],
  wallHit: [
    { k: "click", freq: 1500, peak: 0.2 },
    { k: "kick", from: 160, to: 60, drop: 0.03, dur: 0.06, peak: 0.3 },
    { k: "noise", filter: "lowpass", from: 600, to: 150, dur: 0.05, peak: 0.3 },
  ],

  // ==== 爆発: ドン（歪ませたキック）+ 崩れるノイズ + 低音の尾 ====
  explode: [
    { k: "click", freq: 1000, peak: 0.6 },
    { k: "kick", from: 80, to: 28, drop: 0.15, dur: 0.6, peak: 0.8, drive: 3 },
    { k: "noise", filter: "lowpass", from: 4000, to: 120, dur: 0.7, peak: 0.72, drive: 2 },
    { k: "noise", filter: "bandpass", from: 900, to: 150, dur: 1, q: 0.7, peak: 0.28, at: 0.05 },
    { k: "crackle", freq: 1800, count: 5, gap: 0.06, peak: 0.18, at: 0.08 },
    { k: "noise", filter: "lowpass", from: 300, to: 40, dur: 1.2, peak: 0.3, at: 0.1 },
  ],
  /** 大技（バースト）: 力が溜まって放たれる。上がる唸り + 深いドン + 吹き抜ける風 */
  burst: [
    { k: "fm", freq: 220, ratio: 2, index: 2, dur: 0.15, peak: 0.1, to: 880 },
    { k: "kick", from: 70, to: 30, drop: 0.18, dur: 0.6, peak: 0.75, drive: 2.5, at: 0.08 },
    { k: "noise", filter: "lowpass", from: 2500, to: 100, dur: 0.5, peak: 0.6, at: 0.08 },
    { k: "noise", filter: "highpass", from: 3000, to: 8000, dur: 0.25, attack: 0.05, peak: 0.15, at: 0.08 },
  ],

  // ==== 動き・見切り・反撃・処刑 ====
  dash: [
    { k: "noise", filter: "bandpass", from: 3000, to: 900, dur: 0.16, q: 1.5, attack: 0.04, peak: 0.45 },
    { k: "noise", filter: "highpass", from: 6000, to: 2500, dur: 0.06, peak: 0.14 },
  ],
  /** 見切り: 時間が止まるような高い金属のきらめき + 吸い込む風 */
  just: [
    { k: "noise", filter: "highpass", from: 8000, to: 4000, dur: 0.12, attack: 0.02, peak: 0.2 },
    { k: "metal", freq: 2637, ratios: [1, 1.5, 2.76], dur: 0.35, peak: 0.1 },
    { k: "fm", freq: 1760, ratio: 3.01, index: 2, dur: 0.25, peak: 0.08, at: 0.02 },
  ],
  /** 反撃: 金属の打ち合い + 深い衝撃 */
  counter: [
    { k: "click", freq: 3000, peak: 0.6 },
    { k: "kick", from: 110, to: 35, drop: 0.08, dur: 0.26, peak: 0.7, drive: 3 },
    { k: "noise", filter: "bandpass", from: 3200, to: 400, dur: 0.16, q: 1, peak: 0.5, drive: 2 },
    { k: "metal", freq: 2400, ratios: CLANG, dur: 0.3, peak: 0.1 },
  ],
  parry: [
    { k: "click", freq: 5000, peak: 0.6 },
    { k: "noise", filter: "highpass", from: 6000, to: 1800, dur: 0.08, peak: 0.5 },
    { k: "metal", freq: 1800, ratios: CLANG, dur: 0.45, peak: 0.14 },
    { k: "fm", freq: 1800, ratio: 1.41, index: 3, dur: 0.2, peak: 0.07 },
  ],
  execute: [
    { k: "noise", filter: "highpass", from: 9000, to: 2500, dur: 0.12, peak: 0.55 },
    { k: "kick", from: 90, to: 30, drop: 0.12, dur: 0.4, peak: 0.7, drive: 3 },
    { k: "metal", freq: 1500, ratios: [1, 1.47, 2.09, 2.76], dur: 0.5, peak: 0.08, at: 0.02 },
    { k: "noise", filter: "lowpass", from: 1000, to: 60, dur: 0.5, peak: 0.3, at: 0.03 },
  ],
  /** 部屋の最後の 1 体: 大きなドン + 余韻の鐘 */
  lastKill: [
    { k: "kick", from: 60, to: 25, drop: 0.2, dur: 0.8, peak: 0.8, drive: 2 },
    { k: "noise", filter: "lowpass", from: 2400, to: 100, dur: 0.6, peak: 0.6 },
    { k: "metal", freq: 1600, ratios: [1, 1.5, 2.76], dur: 0.6, peak: 0.1 },
    { k: "noise", filter: "bandpass", from: 800, to: 100, dur: 1, peak: 0.2, at: 0.1 },
  ],
  guardBreak: [
    { k: "click", freq: 4000, peak: 0.5 },
    { k: "noise", filter: "highpass", from: 8000, to: 2000, dur: 0.18, peak: 0.7, drive: 1.5 },
    { k: "metal", freq: 3200, ratios: [1, 1.31, 1.72, 2.35], dur: 0.25, peak: 0.1 },
    { k: "kick", from: 140, to: 60, drop: 0.05, dur: 0.12, peak: 0.4 },
  ],
  eliteKill: [
    { k: "kick", from: 80, to: 30, drop: 0.12, dur: 0.35, peak: 0.6, drive: 2.5 },
    { k: "noise", filter: "lowpass", from: 3500, to: 150, dur: 0.3, peak: 0.6, drive: 1.5 },
    { k: "arp", type: "sine", freqs: [440, 660, 880, 1108.73], note: 0.06, gap: 0.02, peak: 0.14, at: 0.04 },
    { k: "metal", freq: 2200, ratios: BLADE_RING, dur: 0.4, peak: 0.06, at: 0.3 },
  ],
  /** 被弾: 歪んだ重い衝撃 + うなる低音（攻撃の音と取り違えない暗い音色） */
  hurt: [
    { k: "click", freq: 1500, peak: 0.4 },
    { k: "kick", from: 180, to: 60, drop: 0.06, dur: 0.2, peak: 0.6, drive: 3 },
    { k: "noise", filter: "bandpass", from: 1500, to: 300, dur: 0.15, q: 0.8, peak: 0.45, drive: 3 },
    { k: "sweep", type: "sawtooth", from: 240, to: 90, dur: 0.2, peak: 0.12 },
  ],

  // ==== スキルの発動と属性（炎 = ゴォッ、氷 = 結晶のきらめき、雷 = バチッ、毒 = 泡、闇 = 低いうねり、光 = 鐘）====
  /** 発動の共通音: 魔力が集まって放たれる風 */
  skillCast: [
    { k: "click", freq: 5000, peak: 0.25 },
    { k: "noise", filter: "bandpass", from: 1500, to: 4000, dur: 0.15, q: 1.5, attack: 0.04, peak: 0.35 },
    { k: "fm", freq: 440, ratio: 2, index: 1.5, dur: 0.15, peak: 0.08, to: 880 },
  ],
  railshot: [
    { k: "click", freq: 5000, peak: 0.5 },
    { k: "noise", filter: "highpass", from: 8000, to: 3000, dur: 0.08, peak: 0.5, drive: 2 },
    { k: "fm", freq: 1400, ratio: 0.5, index: 3, dur: 0.3, peak: 0.14, to: 120 },
    { k: "kick", from: 120, to: 40, drop: 0.08, dur: 0.2, peak: 0.45, drive: 2 },
  ],
  burn: [
    { k: "noise", filter: "lowpass", from: 3000, to: 300, dur: 0.4, attack: 0.06, peak: 0.55, drive: 2.5 },
    { k: "kick", from: 90, to: 50, drop: 0.1, dur: 0.2, peak: 0.28 },
    { k: "crackle", freq: 3200, count: 5, gap: 0.05, peak: 0.3, at: 0.04 },
  ],
  freeze: [
    { k: "click", freq: 7000, peak: 0.3 },
    { k: "fm", freq: 2093, ratio: 3.53, index: 2.5, dur: 0.5, peak: 0.08 },
    { k: "metal", freq: 3136, ratios: CRYSTAL, dur: 0.4, peak: 0.08, at: 0.03 },
    { k: "noise", filter: "highpass", from: 6000, to: 9000, dur: 0.3, attack: 0.05, peak: 0.15 },
  ],
  shock: [
    { k: "click", freq: 4000, peak: 0.6 },
    { k: "noise", filter: "bandpass", from: 4000, to: 1500, dur: 0.12, q: 0.8, peak: 0.5, drive: 5 },
    { k: "crackle", freq: 5000, count: 6, gap: 0.025, peak: 0.3 },
    { k: "kick", from: 150, to: 60, drop: 0.05, dur: 0.1, peak: 0.28 },
  ],
  hitFire: [
    { k: "noise", filter: "lowpass", from: 2500, to: 600, dur: 0.2, attack: 0.03, peak: 0.42, drive: 2 },
    { k: "crackle", freq: 3000, count: 3, gap: 0.04, peak: 0.22 },
  ],
  hitIce: [
    { k: "click", freq: 7000, peak: 0.35 },
    { k: "metal", freq: 2600, ratios: CRYSTAL, dur: 0.25, peak: 0.1 },
    { k: "noise", filter: "highpass", from: 7000, to: 4000, dur: 0.06, peak: 0.22 },
  ],
  hitLightning: [
    { k: "click", freq: 4000, peak: 0.6 },
    { k: "noise", filter: "highpass", from: 5000, to: 2000, dur: 0.05, peak: 0.42, drive: 4 },
    { k: "crackle", freq: 5000, count: 3, gap: 0.02, peak: 0.28 },
  ],
  hitPoison: [
    { k: "blips", type: "sine", from: 300, to: 750, count: 3, note: 0.03, gap: 0.015, peak: 0.16 },
    { k: "noise", filter: "bandpass", from: 800, to: 400, dur: 0.08, q: 2, peak: 0.2 },
  ],
  hitDark: [
    { k: "fm", freq: 110, ratio: 1.5, index: 2, dur: 0.25, peak: 0.2, to: 70 },
    { k: "noise", filter: "lowpass", from: 700, to: 120, dur: 0.18, peak: 0.34, drive: 1.5 },
    { k: "kick", from: 90, to: 40, drop: 0.06, dur: 0.12, peak: 0.24 },
  ],
  hitLight: [
    { k: "click", freq: 6000, peak: 0.3 },
    { k: "fm", freq: 1568, ratio: BELL_FM_RATIO, index: 3, dur: 0.5, peak: 0.12 },
    { k: "tone", type: "sine", freq: 3136, dur: 0.2, peak: 0.05 },
  ],
  castFire: [
    { k: "noise", filter: "bandpass", from: 400, to: 1600, dur: 0.3, q: 0.8, attack: 0.08, peak: 0.45, drive: 2.5 },
    { k: "crackle", freq: 2800, count: 4, gap: 0.05, peak: 0.2, at: 0.05 },
  ],
  castIce: [
    { k: "metal", freq: 3520, ratios: CRYSTAL, dur: 0.35, peak: 0.08 },
    { k: "blips", type: "sine", from: 2600, to: 3400, count: 3, note: 0.03, gap: 0.02, peak: 0.05, at: 0.03 },
  ],
  castLightning: [
    { k: "crackle", freq: 5500, count: 5, gap: 0.018, peak: 0.26 },
    { k: "noise", filter: "bandpass", from: 3000, to: 6000, dur: 0.1, q: 1, peak: 0.25, drive: 4 },
  ],
  castPoison: [
    { k: "blips", type: "sine", from: 220, to: 600, count: 4, note: 0.035, gap: 0.02, peak: 0.16 },
    { k: "noise", filter: "lowpass", from: 900, to: 300, dur: 0.15, peak: 0.18 },
  ],
  castDark: [
    { k: "fm", freq: 80, ratio: 1.5, index: 3, dur: 0.45, peak: 0.24, to: 55 },
    { k: "noise", filter: "lowpass", from: 500, to: 120, dur: 0.35, attack: 0.08, peak: 0.25 },
  ],
  castLight: [
    { k: "fm", freq: 1046.5, ratio: BELL_FM_RATIO, index: 3, dur: 0.7, peak: 0.12 },
    { k: "fm", freq: 1568, ratio: BELL_FM_RATIO, index: 2, dur: 0.5, peak: 0.06, at: 0.04 },
  ],


  // ---- 状態異常の付与音（8-3）と怯み（8-6）----
  statusPoison: [
    { k: "blips", type: "sine", from: 260, to: 520, count: 3, note: 0.04, gap: 0.02, peak: 0.24 },
    { k: "noise", filter: "bandpass", from: 700, to: 350, dur: 0.1, q: 2, peak: 0.16 },
  ],
  statusBleed: [
    { k: "noise", filter: "lowpass", from: 1200, to: 300, dur: 0.08, peak: 0.38 },
    { k: "tone", type: "sine", freq: 180, dur: 0.05, peak: 0.18 },
  ],
  statusParalyze: [
    { k: "crackle", freq: 4500, count: 6, gap: 0.03, peak: 0.26 },
    { k: "noise", filter: "bandpass", from: 2500, to: 1200, dur: 0.18, q: 3, peak: 0.14, drive: 4 },
  ],
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
  comboMilestone: [{ k: "arp", type: "square", freqs: [784, 987.77, 1174.66, 1568], note: 0.045, gap: 0.01, peak: 0.22 }],
  hordeSeal: [
    { k: "tone", type: "sawtooth", freq: 60, dur: 0.5, peak: 0.3 },
    { k: "noise", filter: "lowpass", from: 1500, to: 80, dur: 0.5, peak: 0.55 },
    { k: "tone", type: "square", freq: 1900, dur: 0.25, peak: 0.12, at: 0.05 },
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

  // ---- 隠し部屋（system/hiddenRoom.ts）: 手がかりは控えめな風の掃引、開くときは崩落 + 低い鐘の解放感 ----
  hiddenHint: [
    { k: "noise", filter: "bandpass", from: 500, to: 1400, dur: 0.5, q: 1.2, attack: 0.15, peak: 0.14 },
    { k: "noise", filter: "highpass", from: 3000, to: 5000, dur: 0.35, attack: 0.1, peak: 0.05 },
  ],
  hiddenOpen: [
    { k: "noise", filter: "lowpass", from: 800, to: 90, dur: 0.3, attack: 0.02, peak: 0.4 },
    { k: "noise", filter: "bandpass", from: 3000, to: 1100, dur: 0.12, q: 2, peak: 0.14, at: 0.06 },
    { k: "tone", type: "sine", freq: 261.6, dur: 0.6, peak: 0.22, at: 0.1 },
    { k: "tone", type: "sine", freq: 261.6 * BELL_PARTIAL, dur: 0.4, peak: 0.09, at: 0.1 },
  ],
} as const satisfies Partial<Record<SfxName, readonly Layer[]>>;

export type LayeredSfxName = keyof typeof LAYERED_SFX;
