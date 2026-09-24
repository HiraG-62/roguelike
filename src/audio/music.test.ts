import { describe, expect, it } from "vitest";
import type { FloorKind } from "../core/state";
import { MUSIC, SFX_WAVE3 } from "../data/tuning";
import {
  MusicPlayer,
  STEPS_PER_BAR,
  TRACKS,
  degreeSemitone,
  midiToFreq,
  HUB_TRACK,
  musicCue,
  notesAt,
  pickTrack,
  resolveChord,
  stepSeconds,
  trackVariant,
  type MusicInput,
} from "./music";
import { createMockAudio } from "./testAudioMock";

/** フロア種別の一覧（system/biomes.ts を読むと循環 import の初期化順に巻き込まれるので、型で漏れを検査する表をここに置く） */
const FLOOR_KINDS: readonly FloorKind[] = ["rooms", "cave", "dark", "forge", "ossuary", "swamp", "glacier", "mine", "meadow"];

function input(partial: Partial<MusicInput>): MusicInput {
  return { inRun: true, floorKind: "rooms", engaged: false, boss: false, bossDown: false, seed: 1, depth: 1, ...partial };
}

describe("曲の選択（pickTrack）", () => {
  it("フロア種別ごとに曲があり、交戦中だけ打楽器が入る", () => {
    for (const kind of FLOOR_KINDS) {
      expect(TRACKS[kind], `${kind} の曲`).toBeDefined();
      expect(pickTrack(kind, false, false)).toEqual({ track: kind, combat: false });
      expect(pickTrack(kind, true, false)).toEqual({ track: kind, combat: true });
    }
  });

  it("ボス戦はフロア種別に関係なくボス曲で、常に打楽器入り", () => {
    expect(pickTrack("cave", false, true)).toEqual({ track: "boss", combat: true });
    expect(pickTrack("glacier", true, true)).toEqual({ track: "boss", combat: true });
  });

  it("拠点は交戦・ボスに関係なく静かな拠点の曲で、打楽器なし・移調なし", () => {
    expect(pickTrack("forge", true, true, true)).toEqual({ track: HUB_TRACK, combat: false });
    const cue = musicCue(input({ hub: true, engaged: true, seed: 999, depth: 5 }));
    expect(cue.track).toBe(HUB_TRACK);
    expect(cue.combat, "打楽器を入れない").toBe(false);
    expect(cue.transpose, "移調しない").toBe(0);
    expect(TRACKS[HUB_TRACK].bpm, "ボス曲より遅い").toBeLessThan(TRACKS.boss.bpm);
  });

  it("ラン外（タイトル・死亡）は鳴らさない", () => {
    expect(musicCue(input({ inRun: false })).track).toBeNull();
  });

  it("ボスのダウン中はテンポが上がる", () => {
    expect(musicCue(input({ boss: true, bossDown: true })).tempoMul).toBe(MUSIC.bossDownTempoMul);
    expect(musicCue(input({ boss: true })).tempoMul).toBe(1);
    expect(musicCue(input({ bossDown: true })).tempoMul, "ボス戦でなければ変えない").toBe(1);
  });
});

describe("曲の揺らぎ（seed と深度だけで決まる）", () => {
  it("同じ seed・深度なら同じ移調と起点", () => {
    expect(trackVariant(123, 4)).toEqual(trackVariant(123, 4));
  });

  it("移調は ±2 半音、起点は 0..3 に収まる", () => {
    for (let seed = 0; seed < 50; seed++) {
      const v = trackVariant(seed * 7919, seed % 9);
      expect(Math.abs(v.transpose)).toBeLessThanOrEqual(2);
      expect(v.arpShift).toBeGreaterThanOrEqual(0);
      expect(v.arpShift).toBeLessThan(4);
    }
  });

  it("ボス曲は移調しない", () => {
    const cue = musicCue(input({ boss: true, seed: 999, depth: 5 }));
    expect(cue.transpose).toBe(0);
    expect(cue.arpShift).toBe(0);
  });
});

describe("音の高さの計算", () => {
  it("度数はオクターブを回り込む", () => {
    const major = [0, 2, 4, 5, 7, 9, 11];
    expect(degreeSemitone(major, 0)).toBe(0);
    expect(degreeSemitone(major, 7), "1 オクターブ上の主音").toBe(12);
    expect(degreeSemitone(major, -1), "1 つ下の導音").toBe(-1);
  });

  it("A4 は 440Hz", () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(81)).toBeCloseTo(880);
  });

  it("テンポが上がると 1 ステップが短くなる", () => {
    expect(stepSeconds(120, 1.2)).toBeLessThan(stepSeconds(120, 1));
  });

  it("小節の頭で低音が鳴り、打楽器は交戦中だけ", () => {
    const def = TRACKS.rooms;
    const calm = notesAt(def, 0, { combat: false, transpose: 0, arpShift: 0 });
    const fight = notesAt(def, 0, { combat: true, transpose: 0, arpShift: 0 });
    expect(calm.drone, "小節の頭の低音").not.toBeNull();
    expect(calm.perc, "交戦していなければ打楽器なし").toBeNull();
    expect(fight.perc, "交戦中は打楽器").toBe("k");
    expect(notesAt(def, 1, { combat: false, transpose: 0, arpShift: 0 }).drone, "小節の途中は低音なし").toBeNull();
  });

  it("ボス曲だけ旋律がある", () => {
    let leads = 0;
    for (let s = 0; s < STEPS_PER_BAR * 4; s++) if (notesAt(TRACKS.boss, s, { combat: true, transpose: 0, arpShift: 0 }).lead !== null) leads++;
    expect(leads, "ボス曲の旋律").toBeGreaterThan(0);
    expect(notesAt(TRACKS.cave, 0, { combat: true, transpose: 0, arpShift: 0 }).lead, "通常曲に旋律なし").toBeNull();
  });

  it("解決の和音は主音から始まる 4 音", () => {
    const chord = resolveChord(TRACKS.meadow, 0);
    expect(chord.length).toBe(4);
    expect((chord[0] ?? 0) % 12, "主音").toBe(TRACKS.meadow.root % 12);
  });
});

describe("MusicPlayer", () => {
  it("AudioContext が無い間は何もしない", () => {
    const player = new MusicPlayer(() => null);
    expect(() => player.update(musicCue(input({})))).not.toThrow();
    expect(player.currentKey()).toBeNull();
  });

  it("先読みの分だけ音を予約し、曲が変わると切り替わる", () => {
    const audio = createMockAudio();
    const player = new MusicPlayer(() => audio.ctx);
    player.update(musicCue(input({ floorKind: "cave" })));
    expect(player.currentKey(), "洞窟の曲").toMatch(/^cave\|/);
    expect(audio.sources(), "音を予約した").toBeGreaterThan(0);
    audio.setTime(0.5);
    player.update(musicCue(input({ floorKind: "cave", boss: true })));
    expect(player.currentKey(), "ボス曲へ").toMatch(/^boss\|/);
  });

  it("ミュート中は予約しない", () => {
    const audio = createMockAudio();
    const player = new MusicPlayer(() => audio.ctx);
    player.setMuted(true);
    player.update(musicCue(input({})));
    expect(player.currentKey()).toBeNull();
    expect(audio.sources()).toBe(0);
  });

  it("交戦が終わると解決の和音を鳴らす", () => {
    const audio = createMockAudio();
    const player = new MusicPlayer(() => audio.ctx);
    player.update(musicCue(input({ engaged: true })));
    const before = audio.sources();
    // 同じ時刻で交戦だけ解ける（先読みは済んでいるので増えるのは和音の分だけ）
    player.update(musicCue(input({ engaged: false })));
    expect(audio.sources() - before, "解決の和音 4 音").toBe(resolveChord(TRACKS.rooms, 0).length);
  });
});

describe("残響ノードの後始末", () => {
  it("曲を切り替えると、フェードし終えた旧曲のディレイ・フィードバック・戻りを外す", () => {
    const audio = createMockAudio();
    const player = new MusicPlayer(() => audio.ctx);
    // 洞窟は残響あり（echo > 0）。ディレイが 1 つできる
    player.update(musicCue(input({ floorKind: "cave" })));
    const [caveDelay] = audio.nodes("delay");
    expect(caveDelay, "洞窟の曲の残響ディレイ").toBeDefined();
    if (!caveDelay) return;
    const gainsBefore = audio.nodes("gain").length;

    audio.setTime(0.5);
    player.update(musicCue(input({ floorKind: "cave", boss: true })));
    expect(caveDelay.disconnects, "フェード中はまだ外さない").toBe(0);

    audio.setTime(0.5 + MUSIC.crossfade + 0.1);
    player.update(musicCue(input({ floorKind: "cave", boss: true })));
    expect(caveDelay.disconnects, "フェード後に旧曲のディレイを外す").toBeGreaterThan(0);
    const oldGains = audio.nodes("gain").slice(0, gainsBefore);
    // 旧曲の常駐ゲイン: 出力・打楽器の層・フィードバック・戻り の 4 つ（音符ごとのゲインは発音源の停止で消える）
    expect(oldGains.filter((g) => g.disconnects > 0).length, "旧曲の出力・打楽器・フィードバック・戻りを外す").toBeGreaterThanOrEqual(4);
    const bossDelay = audio.nodes("delay")[1];
    expect(bossDelay?.disconnects, "今鳴っているボス曲の残響は外さない").toBe(0);
  });

  it("後始末は曲ごとに 1 回で、同じ旧曲を何度も外さない", () => {
    const audio = createMockAudio();
    const player = new MusicPlayer(() => audio.ctx);
    player.update(musicCue(input({ floorKind: "glacier" })));
    audio.setTime(0.2);
    player.update(musicCue(input({ floorKind: "cave" })));
    audio.setTime(0.2 + MUSIC.crossfade + 0.1);
    player.update(musicCue(input({ floorKind: "cave" })));
    audio.setTime(5);
    player.update(musicCue(input({ floorKind: "cave" })));
    expect(audio.nodes("delay")[0]?.disconnects, "1 回だけ外す").toBe(1);
  });
});

describe("スロー中のこもり（8-15）", () => {
  it("スロー中の入力で cue にこもりが立つ。ラン外は立たない", () => {
    expect(musicCue(input({ slowmo: true })).muffle).toBe(true);
    expect(musicCue(input({})).muffle, "省略は false").toBe(false);
    expect(musicCue(input({ inRun: false, slowmo: true })).muffle, "ラン外").toBe(false);
  });

  it("スロー中は低域通過で閉じ、戻ると開く", () => {
    const audio = createMockAudio();
    const player = new MusicPlayer(() => audio.ctx);
    player.update(musicCue(input({})));
    expect(player.muffleCutoff(), "普段は開いている").toBe(SFX_WAVE3.muffle.open);
    player.update(musicCue(input({ slowmo: true })));
    expect(player.muffleCutoff(), "スロー中は閉じる").toBe(SFX_WAVE3.muffle.cutoff);
    player.update(musicCue(input({})));
    expect(player.muffleCutoff(), "戻ると開く").toBe(SFX_WAVE3.muffle.open);
  });

  it("AudioContext が無ければこもりの値も無い", () => {
    expect(new MusicPlayer(() => null).muffleCutoff()).toBeNull();
  });
});
