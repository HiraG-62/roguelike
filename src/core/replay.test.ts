import { describe, expect, it } from "vitest";
import { createGame, step } from "./game";
import { EMPTY_INPUT, type FrameInput } from "./input";
import { FIXED_DT } from "./loop";
import { createRng, hashSeed } from "./rng";
import {
  InputEncoder,
  REPLAY_VERSION,
  ReplayRecorder,
  createReplaySession,
  dailySeedText,
  decodeInputs,
  encodeInputs,
  isDailySeedText,
  isPlayable,
  isReplayFinished,
  normalizeFrame,
  quantizeAim,
  sanitizeReplay,
  stepReplay,
  type ReplayData,
} from "./replay";
import { createEmptyProfile, type Item, type Profile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { computeStats } from "../loot/stats";
import { applyStats } from "../system/player";
import { descend } from "../system/floor";
import { allocateAttribute } from "../ui/attributeAlloc";
import type { GameState } from "./state";
import type { RunSetup } from "../system/runSetup";

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/** game.test.ts と同じ観点のハッシュ（Date.now 由来の値は除く） */
function fingerprint(state: GameState): string {
  const p = state.player.body.pos;
  return [
    state.tick,
    state.depth,
    p.x.toFixed(6),
    p.y.toFixed(6),
    state.player.hp,
    state.player.maxHp,
    state.enemies.length,
    state.enemies.map((e) => `${e.id}:${e.hp}:${e.body.pos.x.toFixed(4)}`).join(","),
    state.score,
    state.kills,
    state.projectiles.length,
    state.floorItems.map((fi) => `${fi.item.seed}:${fi.item.rarity}:${fi.pos.x.toFixed(2)}`).join(","),
  ].join("|");
}

function armor(value: number): Item {
  return {
    id: `armor-${value}`,
    seed: value,
    baseKey: "leather",
    slot: "armor",
    rarity: "magic",
    itemLevel: 1,
    name: "Test Armor",
    implicit: null,
    affixes: [{ key: "maxLife", kind: "prefix", tier: 1, value }],
    foundDepth: 1,
    foundAt: 0,
  };
}

/** ランダムな入力（照準は小数を含む生の値） */
function randomInputs(seed: number, frames: number): FrameInput[] {
  const rng = createRng(seed);
  const out: FrameInput[] = [];
  let aimX = 240.3;
  let aimY = 135.7;
  for (let i = 0; i < frames; i++) {
    if (rng.chance(0.3)) {
      aimX += (rng.next() - 0.5) * 9;
      aimY += (rng.next() - 0.5) * 9;
    }
    const dx = rng.int(-1, 1);
    const dy = rng.int(-1, 1);
    const len = Math.hypot(dx, dy);
    out.push(
      withInput({
        move: len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len },
        aimScreen: i % 400 < 350 ? { x: aimX, y: aimY } : null,
        attackPressed: rng.chance(0.08),
        dashPressed: rng.chance(0.03),
        shootHeld: rng.chance(0.3),
        specialPressed: rng.chance(0.01),
        skill1Pressed: rng.chance(0.01),
        skill2Pressed: rng.chance(0.01),
        wheel: rng.chance(0.01) ? 1 : 0,
      }),
    );
  }
  return out;
}

describe("encodeInputs / decodeInputs", () => {
  it("往復で同じ入力列（照準は量子化後）に戻る", () => {
    const inputs = randomInputs(1, 2000);
    const decoded = decodeInputs(encodeInputs(inputs));
    expect(decoded).toEqual(inputs.map(normalizeFrame));
  });

  it("連続する同一入力はランレングスで 1 つにまとまる", () => {
    const idle = withInput({});
    const moving = withInput({ move: { x: 1, y: 0 }, shootHeld: true });
    const text = encodeInputs([idle, idle, idle, moving, moving, idle]);
    expect(text.split(";")).toHaveLength(3);
    expect(text.startsWith("3*")).toBe(true);
    expect(decodeInputs(text)).toHaveLength(6);
  });

  it("ランの境界: 1 件だけ / 最後だけ違う / 空", () => {
    const a = withInput({ attackPressed: true });
    const b = withInput({ dashPressed: true });
    expect(decodeInputs(encodeInputs([a]))).toEqual([a]);
    expect(encodeInputs([a]).includes("*")).toBe(false);
    const tail = [a, a, a, b];
    expect(decodeInputs(encodeInputs(tail))).toEqual(tail);
    expect(encodeInputs([])).toBe("");
    expect(decodeInputs("")).toEqual([]);
  });

  it("照準が等速で動く区間は差分が同じなので 1 ランになる", () => {
    const inputs = Array.from({ length: 50 }, (_, i) => withInput({ aimScreen: { x: 100 + i, y: 50 } }));
    const text = encodeInputs(inputs);
    // 先頭の絶対座標 + 差分 (1,0) の 49 連続
    expect(text.split(";")).toHaveLength(2);
    expect(decodeInputs(text)).toEqual(inputs);
  });

  it("照準 null を挟んでも絶対座標で復帰する", () => {
    const inputs = [
      withInput({ aimScreen: { x: 10, y: 20 } }),
      withInput({ aimScreen: null }),
      withInput({ aimScreen: { x: 300, y: 200 } }),
    ];
    expect(decodeInputs(encodeInputs(inputs))).toEqual(inputs);
  });

  it("アナログ移動値・斜め・-0 がそのまま往復する", () => {
    const inputs = [
      withInput({ move: { x: 0.123456789, y: -0.987654321 } }),
      withInput({ move: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } }),
      withInput({ move: { x: 1 / Math.hypot(1, 1), y: -1 / Math.hypot(1, 1) } }),
      withInput({ move: { x: -0, y: 0 } }),
    ];
    const decoded = decodeInputs(encodeInputs(inputs));
    expect(decoded).toEqual(inputs);
    expect(Object.is(decoded[3]?.move.x, -0)).toBe(true);
  });

  it("全ボタンのビットが往復する", () => {
    const all = withInput({
      dashPressed: true,
      attackPressed: true,
      shootHeld: true,
      specialPressed: true,
      confirmPressed: true,
      restartPressed: true,
      inventoryPressed: true,
      skill1Pressed: true,
      skill2Pressed: true,
      clickPressed: true,
      shiftHeld: true,
      skill1Held: true,
      skill2Held: true,
      skill3Pressed: true,
      skill4Pressed: true,
      skill3Held: true,
      skill4Held: true,
      wheel: -3,
    });
    expect(decodeInputs(encodeInputs([all]))).toEqual([all]);
  });

  it("スキル 3 / 4 のビットは他のボタンと混ざらない", () => {
    const only = withInput({ skill3Pressed: true, skill4Held: true });
    const decoded = decodeInputs(encodeInputs([only]))[0];
    expect(decoded?.skill3Pressed, "skill3Pressed が落ちた").toBe(true);
    expect(decoded?.skill4Held, "skill4Held が落ちた").toBe(true);
    expect(decoded?.skill4Pressed, "skill4Pressed が立った").toBe(false);
    expect(decoded?.skill1Pressed, "skill1Pressed が立った").toBe(false);
  });

  it("壊れた文字列は例外", () => {
    expect(() => decodeInputs("zz")).toThrow();
    expect(() => decodeInputs("0*0,0,0,n")).toThrow();
    expect(() => decodeInputs("0,0,0,1:1")).toThrow();
  });

  it("逐次エンコーダとまとめてエンコードの結果が同じ", () => {
    const inputs = randomInputs(3, 300);
    const enc = new InputEncoder();
    for (const input of inputs) enc.push(normalizeFrame(input));
    expect(enc.toString()).toBe(encodeInputs(inputs));
    expect(enc.frameCount).toBe(300);
  });
});

describe("quantizeAim", () => {
  it("1px 単位に丸め、-0 を 0 にする", () => {
    expect(quantizeAim({ x: 10.4, y: 10.6 })).toEqual({ x: 10, y: 11 });
    const q = quantizeAim({ x: -0.2, y: 0 });
    expect(Object.is(q?.x, 0)).toBe(true);
    expect(quantizeAim(null)).toBeNull();
  });
});

/** main.ts と同じ流れでランを記録する（記録器が返した量子化済み入力を step に渡す） */
function recordRun(
  seedText: string,
  profile: Profile,
  inputs: readonly FrameInput[],
  onFrame?: (state: GameState, frame: number) => boolean,
  setup?: RunSetup,
): { data: ReplayData; state: GameState } {
  const skillProfile = createDefaultSkillProfile();
  const recorder = new ReplayRecorder({ seedText, startedAt: 1, daily: false, setup }, profile, skillProfile);
  const state = createGame(hashSeed(seedText), seedText, profile, skillProfile, setup);
  inputs.forEach((input, i) => {
    if (onFrame?.(state, i)) recorder.noteLoadout(state);
    step(state, recorder.record(input), FIXED_DT);
  });
  const data = recorder.finish({ depth: state.depth, kills: state.kills, score: state.score }, 2);
  return { data, state };
}

function playBack(data: ReplayData): GameState {
  // 保存 → 読み込みの往復も通す
  const loaded = sanitizeReplay(JSON.parse(JSON.stringify(data)));
  if (!loaded) throw new Error("sanitize failed");
  const session = createReplaySession(loaded);
  while (!isReplayFinished(session)) stepReplay(session, FIXED_DT);
  return session.state;
}

describe("記録 → 再生", () => {
  it("最終 fingerprint が一致する", () => {
    const profile = createEmptyProfile();
    profile.equipment.armor = armor(30);
    const { data, state } = recordRun("replay-test", profile, randomInputs(42, 3000));
    expect(data.frameCount).toBe(3000);
    expect(fingerprint(playBack(data))).toBe(fingerprint(state));
  });

  it("別シードでも一致する（量子化前の小数照準を与えても、記録と実プレイが同じ入力を見ている）", () => {
    const { data, state } = recordRun("abc", createEmptyProfile(), randomInputs(7, 2500));
    expect(fingerprint(playBack(data))).toBe(fingerprint(state));
  });

  it("ラン途中の装備変更もイベントとして再現される", () => {
    const profile = createEmptyProfile();
    const { data, state } = recordRun("equip", profile, randomInputs(9, 1500), (s, frame) => {
      if (frame !== 500 && frame !== 1000) return false;
      // 装備画面での付け替え相当
      s.profile.equipment.armor = frame === 500 ? armor(50) : null;
      applyStats(s, computeStats(s.profile.equipment));
      return true;
    });
    expect(data.events).toHaveLength(2);
    expect(data.events[0]?.frame).toBe(500);
    expect(data.events[0]?.player).not.toBeNull();
    expect(fingerprint(playBack(data))).toBe(fingerprint(state));
  });

  it("再生しても本物のプロフィールは変わらない", () => {
    const profile = createEmptyProfile();
    profile.equipment.armor = armor(10);
    const { data } = recordRun("isolation", profile, randomInputs(5, 800));
    const before = JSON.stringify(profile);
    playBack(data);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it("stash 件数もスナップショットされ、ダミーで埋めて再現する", () => {
    const profile = createEmptyProfile();
    profile.stash.push(armor(1), armor(2));
    const { data } = recordRun("stash", profile, randomInputs(4, 10));
    expect(data.snapshot.stashCount).toBe(2);
    const session = createReplaySession(data);
    expect(session.profile.stash).toHaveLength(2);
    expect(session.profile).not.toBe(profile);
  });

  it("フレーム数が合わないデータは再生を拒否する", () => {
    const { data } = recordRun("bad", createEmptyProfile(), randomInputs(4, 10));
    expect(() => createReplaySession({ ...data, frameCount: 11 })).toThrow();
  });

  it("起点と縛りを記録し、再生でも同じ条件でランが始まる（REPLAY_VERSION 5）", () => {
    const setup: RunSetup = { origin: "cursedOne", modifiers: ["thickHide", "quickHands", "eternalNight"] };
    const { data, state } = recordRun("origin-replay", createEmptyProfile(), randomInputs(11, 1500), undefined, setup);
    expect(data.version).toBe(5);
    expect(data.origin).toBe("cursedOne");
    expect(data.modifiers).toEqual(["thickHide", "quickHands", "eternalNight"]);
    const replayed = playBack(data);
    expect(replayed.origin, "起点が再生側にも入る").toBe("cursedOne");
    expect(replayed.modifiers).toEqual(setup.modifiers);
    expect(fingerprint(replayed)).toBe(fingerprint(state));
  });

  it("起点・縛りの未知の key は sanitize で捨てる（起点は放浪者に戻る）", () => {
    const { data } = recordRun("origin-sanitize", createEmptyProfile(), randomInputs(3, 10));
    const broken = { ...data, origin: "unknownOrigin", modifiers: ["thickHide", "nope", 3] };
    const loaded = sanitizeReplay(JSON.parse(JSON.stringify(broken)));
    expect(loaded?.origin).toBe("wanderer");
    expect(loaded?.modifiers).toEqual(["thickHide"]);
  });

  it("版数が違うリプレイは再生を拒否する", () => {
    const { data } = recordRun("old-version", createEmptyProfile(), randomInputs(4, 10));
    const old: ReplayData = { ...data, version: REPLAY_VERSION - 1 };
    expect(isPlayable(old)).toBe(false);
    expect(() => createReplaySession(old)).toThrow();
  });
});

describe("装備画面でのステータス振り分けの記録 → 再生", () => {
  const SEED = "alloc-replay";
  /** 開始直後に 2 回降りて点を 2 得る（記録側と再生側で同じ操作をする） */
  const DESCENTS = 2;

  function prepare(state: GameState): void {
    for (let i = 0; i < DESCENTS; i++) descend(state);
  }

  /** frame 300 で体力と精神、frame 700 で装備の付け替えと同時に最後の 1 点を振る */
  function record(): { data: ReplayData; state: GameState } {
    const profile = createEmptyProfile();
    const skillProfile = createDefaultSkillProfile();
    const recorder = new ReplayRecorder({ seedText: SEED, startedAt: 1, daily: false }, profile, skillProfile);
    const state = createGame(hashSeed(SEED), SEED, profile, skillProfile);
    prepare(state);
    state.runAttributes.unspent += 1;
    randomInputs(11, 1200).forEach((input, i) => {
      if (i === 300) {
        allocateAttribute(state, "vit");
        allocateAttribute(state, "mnd");
        recorder.noteLoadout(state);
      }
      if (i === 700) {
        state.profile.equipment.armor = armor(40);
        applyStats(state, computeStats(state.profile.equipment));
        allocateAttribute(state, "str");
        recorder.noteLoadout(state);
      }
      step(state, recorder.record(input), FIXED_DT);
    });
    return { data: recorder.finish({ depth: state.depth, kills: state.kills, score: state.score }, 2), state };
  }

  function replay(data: ReplayData): GameState {
    const loaded = sanitizeReplay(JSON.parse(JSON.stringify(data)));
    if (!loaded) throw new Error("sanitize failed");
    const session = createReplaySession(loaded);
    prepare(session.state);
    session.state.runAttributes.unspent += 1;
    while (!isReplayFinished(session)) stepReplay(session, FIXED_DT);
    return session.state;
  }

  it("振り分けがイベントとして記録され、再生で同じ状態になる", () => {
    const { data, state } = record();
    expect(data.events, "振り分け 2 回ぶんのイベント").toHaveLength(2);
    expect(data.events[0]?.alloc, "1 回目は振り分けだけ").toEqual({ str: 0, dex: 0, vit: 1, mnd: 1, spi: 0 });
    expect(data.events[1]?.alloc?.str, "2 回目は装備と同時").toBe(1);
    const played = replay(data);
    expect(played.runAttributes).toEqual(state.runAttributes);
    expect(played.stats).toEqual(state.stats);
    expect(played.player.mana).toBe(state.player.mana);
    expect(played.rng.next(), "浮き文字の乱数消費も一致").toBe(state.rng.next());
    expect(fingerprint(played)).toBe(fingerprint(state));
  });

  it("振り分けが無ければイベントは積まれない", () => {
    const profile = createEmptyProfile();
    const skillProfile = createDefaultSkillProfile();
    const recorder = new ReplayRecorder({ seedText: SEED, startedAt: 1, daily: false }, profile, skillProfile);
    const state = createGame(hashSeed(SEED), SEED, profile, skillProfile);
    recorder.noteLoadout(state);
    expect(recorder.finish({ depth: 1, kills: 0, score: 0 }, 2).events).toHaveLength(0);
  });

  it("壊れた振り分けのイベントは sanitize で捨てる", () => {
    const { data } = record();
    const broken = JSON.parse(JSON.stringify(data)) as { events: { alloc: unknown }[] };
    const first = broken.events[0];
    if (!first) throw new Error("イベントが無い");
    first.alloc = { str: -1, dex: 0, vit: 0, mnd: 0, spi: 0 };
    expect(sanitizeReplay(broken)).toBeNull();
  });
});

describe("sanitizeReplay", () => {
  it("version 違いは一覧に残すが再生不可、version 欠損・破損は null", () => {
    const { data } = recordRun("s", createEmptyProfile(), randomInputs(4, 10));
    const oldVersion = sanitizeReplay({ ...data, version: REPLAY_VERSION - 1 });
    expect(oldVersion).not.toBeNull();
    expect(isPlayable(oldVersion!)).toBe(false);
    const { version: _version, ...withoutVersion } = data;
    expect(sanitizeReplay(withoutVersion)).toBeNull();
    expect(sanitizeReplay({ ...data, inputs: 1 })).toBeNull();
    expect(sanitizeReplay(null)).toBeNull();
    const sanitized = sanitizeReplay(JSON.parse(JSON.stringify(data)));
    expect(sanitized).toEqual(data);
    expect(isPlayable(sanitized!)).toBe(true);
  });
});

describe("デイリーシード", () => {
  it("UTC の YYYY-MM-DD になる", () => {
    expect(dailySeedText(new Date(Date.UTC(2026, 8, 3, 23, 59)))).toBe("2026-09-03");
    // ローカル時刻ではなく UTC の日付
    expect(dailySeedText(new Date("2026-12-31T23:30:00-05:00"))).toBe("2027-01-01");
  });

  it("日付形式だけをデイリーと判定する", () => {
    expect(isDailySeedText("2026-09-23")).toBe(true);
    expect(isDailySeedText(dailySeedText(new Date()))).toBe(true);
    expect(isDailySeedText("20260923")).toBe(false);
    expect(isDailySeedText("abc")).toBe(false);
  });
});

