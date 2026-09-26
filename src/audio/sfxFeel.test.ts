import { describe, expect, it } from "vitest";
import { ELEMENTS } from "../core/element";
import { type Layer, playLayers } from "./layers";
import { LAYERED_SFX, type LayeredSfxName } from "./sfxLayers";
import { SFX_NAMES, castSfxName } from "./sfxNames";
import { createMockAudio } from "./testAudioMock";

/** 層の中でいちばん低い周波数（フィルタ・ピッチの終点を含む） */
function lowestFreq(layers: readonly Layer[]): number {
  let low = Infinity;
  for (const l of layers) {
    if (l.k === "noise" || l.k === "kick" || l.k === "sweep") low = Math.min(low, l.from, l.to);
    if (l.k === "tone" || l.k === "metal" || l.k === "fm" || l.k === "click" || l.k === "crackle") low = Math.min(low, l.freq);
  }
  return low;
}

/** 層の中でいちばん長い持続（秒） */
function longestDur(layers: readonly Layer[]): number {
  let long = 0;
  for (const l of layers) {
    if ("dur" in l) long = Math.max(long, (l.at ?? 0) + l.dur);
  }
  return long;
}

const has = (name: LayeredSfxName, k: Layer["k"]): boolean => (LAYERED_SFX[name] as readonly Layer[]).some((l) => l.k === k);

describe("攻撃の効果音の構成", () => {
  it("重い武器の振りほど低く長い（戦鎚・大剣 > 剣・刀）", () => {
    for (const heavy of ["swingHammer", "swingGreatsword"] as const) {
      for (const light of ["swingSword", "swingKatana", "swingTwinBlades"] as const) {
        expect(lowestFreq(LAYERED_SFX[heavy]), `${heavy} は ${light} より低い`).toBeLessThan(lowestFreq(LAYERED_SFX[light]));
        expect(longestDur(LAYERED_SFX[heavy]), `${heavy} は ${light} より長い`).toBeGreaterThan(longestDur(LAYERED_SFX[light]));
      }
    }
  });

  it("段の斬撃は段が進むほど長く、終段だけ低いキックを持つ", () => {
    expect(longestDur(LAYERED_SFX.slash2), "2 段目は 1 段目より長い").toBeGreaterThan(longestDur(LAYERED_SFX.slash1));
    expect(longestDur(LAYERED_SFX.slash3), "3 段目は 2 段目より長い").toBeGreaterThan(longestDur(LAYERED_SFX.slash2));
    expect(has("slash1", "kick"), "1 段目はキックなし").toBe(false);
    expect(has("slash3", "kick"), "3 段目はキックあり").toBe(true);
  });

  it("命中・銃声・爆発はトランジェント（click）とボディ（kick か歪ませたノイズ）を持つ", () => {
    const punchy: readonly LayeredSfxName[] = ["hit", "hitHeavy", "shoot", "shotSpread", "shotPierce", "bulletHit", "explode", "counter"];
    for (const name of punchy) {
      expect(has(name, "click"), `${name} のトランジェント`).toBe(true);
      const body = (LAYERED_SFX[name] as readonly Layer[]).some((l) => l.k === "kick" || (l.k === "noise" && (l.drive ?? 0) > 0));
      expect(body, `${name} のボディ`).toBe(true);
    }
  });

  it("攻撃の音は矩形波・のこぎり波の単音（ビープ）で作らない", () => {
    const attacks: readonly LayeredSfxName[] = ["slash1", "slash2", "slash3", "hit", "hitHeavy", "hitThump", "kill", "shoot", "shotRapid", "shotBurst", "crit"];
    for (const name of attacks) {
      const beep = (LAYERED_SFX[name] as readonly Layer[]).some((l) => (l.k === "tone" || l.k === "arp") && (l.type === "square" || l.type === "sawtooth"));
      expect(beep, `${name} に電子音の単音がない`).toBe(false);
    }
  });

  it("連射は散弾より短く、散弾の最低音は連射より低い", () => {
    expect(longestDur(LAYERED_SFX.shotRapid), "連射は短い").toBeLessThan(longestDur(LAYERED_SFX.shotSpread));
    expect(lowestFreq(LAYERED_SFX.shotSpread), "散弾は太い").toBeLessThan(lowestFreq(LAYERED_SFX.shotRapid));
  });

  it("新しい命中音の名前はすべて LAYERED_SFX に層があり、トランジェントを持つ", () => {
    const names: readonly LayeredSfxName[] = [
      "hitSlashLight",
      "hitSlashMid",
      "hitSlashHeavy",
      "hitBluntLight",
      "hitBluntMid",
      "hitBluntHeavy",
      "hitPierceLight",
      "hitPierceMid",
      "hitPierceHeavy",
      "hitLashLight",
      "hitLashMid",
      "hitLashHeavy",
      "bulletHitHeavy",
    ];
    for (const name of names) {
      expect(LAYERED_SFX[name].length, `${name} は 1 層以上`).toBeGreaterThan(0);
      expect(has(name, "click") || has(name, "kick"), `${name} のトランジェント`).toBe(true);
    }
  });

  it("重い命中音は軽い命中音より低く長い（系統ごと）", () => {
    for (const family of ["Slash", "Blunt", "Pierce", "Lash"] as const) {
      const light = LAYERED_SFX[`hit${family}Light`];
      const heavy = LAYERED_SFX[`hit${family}Heavy`];
      expect(longestDur(heavy), `${family} 重い方が長い`).toBeGreaterThan(longestDur(light));
    }
  });

  it("斬撃の命中は「ザ」（歪ませた広い帯域）・遅れて抜ける「シュッ」・湿った中低域を持ち、刃鳴りは控えめ", () => {
    for (const name of ["hitSlashLight", "hitSlashMid", "hitSlashHeavy"] as const) {
      const layers = LAYERED_SFX[name] as readonly Layer[];
      const noises = layers.filter((l): l is Extract<Layer, { k: "noise" }> => l.k === "noise");
      const za = noises.some((l) => (l.drive ?? 0) > 0 && l.from >= 3000 && (l.at ?? 0) === 0);
      const shu = noises.some((l) => (l.at ?? 0) > 0 && l.from > l.to && l.from >= 5000);
      const wet = noises.some((l) => (l.drive ?? 0) > 0 && l.from <= 1200);
      expect(za, `${name} のザ`).toBe(true);
      expect(shu, `${name} のシュッ`).toBe(true);
      expect(wet, `${name} の湿った肉`).toBe(true);
      // 高域の「ザ」が小さいと低域に埋もれて鈍い音にしか聞こえない（2026-09-26 のプレイ所見）
      const zaPeak = noises.filter((l) => (l.drive ?? 0) > 0 && l.from >= 3000 && (l.at ?? 0) === 0).reduce((m, l) => Math.max(m, l.peak), 0);
      expect(zaPeak, `${name} のザは十分な音量`).toBeGreaterThanOrEqual(MIN_ZA_PEAK);
      const ring = layers.filter((l) => l.k === "metal").reduce((m, l) => Math.max(m, l.peak), 0);
      expect(ring, `${name} の刃鳴りは小さい`).toBeLessThanOrEqual(MAX_RING_PEAK);
    }
  });

  it("剣の振りは膨らむ上昇 → 頂点から抜ける下降の風切りで、トランジェントを押した瞬間に置かない", () => {
    for (const name of ["slash1", "slash2", "slash3"] as const) {
      const layers = LAYERED_SFX[name] as readonly Layer[];
      const rise = layers.find((l) => l.k === "noise" && l.to > l.from);
      const fall = layers.find((l) => l.k === "noise" && l.from > l.to && (l.at ?? 0) > 0);
      expect(rise, `${name} の上昇`).toBeDefined();
      expect(fall, `${name} の下降`).toBeDefined();
      const clickAt = layers.filter((l) => l.k === "click").map((l) => l.at ?? 0);
      expect(clickAt.every((at) => at > 0), `${name} のクリックは頂点へ遅らせる`).toBe(true);
    }
  });

  it("鞭の振りはうなりが上昇して膨らみ、頂点で鋭いクラック（クリック + 歪んだ短いノイズ）が鳴る", () => {
    const layers = LAYERED_SFX.swingWhip as readonly Layer[];
    const swell = layers.find((l): l is Extract<Layer, { k: "noise" }> => l.k === "noise" && l.to > l.from && (l.at ?? 0) === 0);
    expect(swell, "上昇するうなり").toBeDefined();
    if (!swell) return;
    expect(swell.attack ?? 0, "うなりは長さの半分以上かけて膨らむ").toBeGreaterThan(swell.dur / 2);
    const crackAt = layers.find((l) => l.k === "click")?.at ?? 0;
    expect(crackAt, "クラックはうなりの頂点").toBeGreaterThanOrEqual(swell.attack ?? 0);
    const crack = layers.find((l) => l.k === "noise" && (l.drive ?? 0) > 0 && (l.at ?? 0) === crackAt);
    expect(crack && "dur" in crack ? crack.dur : Infinity, "クラックの本体は 30ms 未満").toBeLessThan(MAX_CRACK_SECONDS);
  });

  it("鞭打の命中は打撃より短く軽い（深いキックは重い段だけ）", () => {
    expect(has("hitLashLight", "kick"), "軽い鞭打にキックなし").toBe(false);
    expect(has("hitLashMid", "kick"), "中の鞭打にキックなし").toBe(false);
    expect(longestDur(LAYERED_SFX.hitLashLight), "軽い鞭打は軽い打撃より短い").toBeLessThan(longestDur(LAYERED_SFX.hitBluntLight));
    expect(lowestFreq(LAYERED_SFX.hitLashLight), "軽い鞭打は軽い打撃より高い").toBeGreaterThan(lowestFreq(LAYERED_SFX.hitBluntLight));
  });
});

/** 斬撃の命中で刃鳴り（metal）が主張しすぎない上限。金属どうしの「キーン」でなく肉を断つ音にするため */
const MAX_RING_PEAK = 0.04;
/** 斬撃の命中の「ザ」の音量の下限。これより小さいと同時に鳴る低域に負けて斬った音に聞こえない */
const MIN_ZA_PEAK = 0.45;
/** 鞭のクラック本体の長さの上限（秒）。これより長いと「パン」でなく「バフッ」になる */
const MAX_CRACK_SECONDS = 0.03;

describe("スキルの属性ごとの発動音（castSfxName）", () => {
  it("無属性以外はすべて SFX_NAMES の名前を返し、無属性は null", () => {
    const names: ReadonlySet<string> = new Set(SFX_NAMES);
    for (const element of ELEMENTS) {
      const name = castSfxName(element);
      if (element === "none") {
        expect(name, "無属性は重ねない").toBeNull();
        continue;
      }
      expect(name !== null && names.has(name), `${element} の発動音`).toBe(true);
    }
  });
});

describe("層の合成器（playLayers）", () => {
  it("キック・クリック・金属・FM・パチパチ・泡の層が例外なく鳴り、部分音の数だけ発音源を作る", () => {
    const audio = createMockAudio();
    const dest = audio.ctx.createGain();
    const layers: readonly Layer[] = [
      { k: "kick", from: 120, to: 40, drop: 0.08, dur: 0.2, peak: 0.5, drive: 2 },
      { k: "click", freq: 3000, peak: 0.4 },
      { k: "metal", freq: 2000, ratios: [1, 1.5, 2.2], dur: 0.2, peak: 0.1 },
      { k: "fm", freq: 440, ratio: 1.4, index: 2, dur: 0.3, peak: 0.1, to: 220 },
      { k: "crackle", freq: 3000, count: 4, gap: 0.03, peak: 0.2 },
      { k: "blips", type: "sine", from: 300, to: 600, count: 2, note: 0.03, gap: 0.01, peak: 0.1 },
    ];
    const seconds = playLayers(audio.ctx, dest, layers, 1);
    // kick 1 + click 1 + metal 3 + fm 2（搬送波・変調波）+ crackle 4 + blips 2
    expect(audio.sources(), "発音源の数").toBe(13);
    expect(seconds, "音の長さは最長の層より長い").toBeGreaterThan(0.3);
  });

  it("drive を持つ層だけ歪み（WaveShaper）を挟む", () => {
    const withDrive = createMockAudio();
    playLayers(withDrive.ctx, withDrive.ctx.createGain(), [{ k: "kick", from: 100, to: 40, drop: 0.1, dur: 0.2, peak: 0.5, drive: 2 }], 1);
    const without = createMockAudio();
    playLayers(without.ctx, without.ctx.createGain(), [{ k: "kick", from: 100, to: 40, drop: 0.1, dur: 0.2, peak: 0.5 }], 1);
    expect(withDrive.nodes("other").length, "歪みあり").toBe(1);
    expect(without.nodes("other").length, "歪みなし").toBe(0);
  });
});
