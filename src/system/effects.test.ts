import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { STATUS_KINDS, type StatusKind } from "../core/status";
import { SFX_NAMES } from "../audio/sfxNames";
import { EFFECTS } from "../data/tuning";
import { MOVESET_KEYS, SHOT_KEYS } from "../data/weapons";
import { generateItem } from "../loot/generator";
import { TRAIT_COLORS } from "../loot/types";
import { damageEnemy } from "./combat";
import {
  type DeathCause,
  addFloatingText,
  addMark,
  comboDamageText,
  comboTier,
  deathKindOf,
  dropSfxName,
  fxState,
  itemTraitColor,
  markExecuted,
  roomClearFx,
  roomLockFx,
  shotSfxName,
  spawnBurst,
  spawnDeathFx,
  statusSfxName,
  swingSfxName,
  updateEffects,
} from "./effects";
import { applyStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

function cause(partial: Partial<DeathCause>): DeathCause {
  return { statuses: new Set<StatusKind>(), element: "none", executed: false, silent: false, kind: "melee", crit: false, ...partial };
}

describe("演出の上限", () => {
  it("粒は EFFECTS.maxParticles を超えない（古いものから消える）", () => {
    const state = createGame(1);
    state.particles = [];
    spawnBurst(state, { x: 0, y: 0 }, "#fff", EFFECTS.maxParticles + 50, 100);
    expect(state.particles.length, "上限で止まる").toBe(EFFECTS.maxParticles);
  });

  it("浮き文字と演出の印も上限を超えない", () => {
    const state = createGame(1);
    state.texts = [];
    for (let i = 0; i < EFFECTS.maxTexts + 10; i++) addFloatingText(state, { x: 0, y: 0 }, "1", "#fff");
    expect(state.texts.length, "浮き文字の上限").toBe(EFFECTS.maxTexts);
    for (let i = 0; i < EFFECTS.maxMarks + 10; i++) addMark(state, "justRing", { x: 0, y: 0 }, 1, "#fff");
    expect(fxState(state).marks.length, "印の上限").toBe(EFFECTS.maxMarks);
  });

  it("印は寿命で消える", () => {
    const state = arena(1);
    addMark(state, "justRing", { x: 0, y: 0 }, 0.1, "#fff");
    updateEffects(state, 0.2);
    expect(fxState(state).marks.some((m) => m.kind === "justRing"), "寿命を過ぎた印は残らない").toBe(false);
  });
});

describe("演出の決定性", () => {
  it("粒を出してもゲームの乱数（state.rng）を消費しない", () => {
    const a = createGame(7);
    const b = createGame(7);
    spawnBurst(a, { x: 0, y: 0 }, "#fff", 40, 100);
    addFloatingText(a, { x: 0, y: 0 }, "12", "#fff");
    expect(a.rng.next(), "演出の有無で次の乱数が変わらない").toBe(b.rng.next());
  });

  it("同じ seed なら粒の位置と速度が同じになる", () => {
    const a = createGame(9);
    const b = createGame(9);
    a.particles = [];
    b.particles = [];
    spawnBurst(a, { x: 5, y: 5 }, "#fff", 10, 100);
    spawnBurst(b, { x: 5, y: 5 }, "#fff", 10, 100);
    expect(a.particles, "同じ粒").toEqual(b.particles);
  });
});

describe("死に方", () => {
  it("処刑は両断、凍結は砕けになる", () => {
    expect(deathKindOf(cause({ executed: true, element: "fire" }))).toBe("sever");
    expect(deathKindOf(cause({ statuses: new Set<StatusKind>(["freeze"]) }))).toBe("shatter");
  });

  it("継続ダメージで倒れたら状態異常の死に方になる", () => {
    expect(deathKindOf(cause({ silent: true, statuses: new Set<StatusKind>(["burn"]) })), "燃焼は灰").toBe("ash");
    expect(deathKindOf(cause({ silent: true, statuses: new Set<StatusKind>(["poison"]) })), "毒は溶ける").toBe("melt");
    expect(deathKindOf(cause({ silent: true, statuses: new Set<StatusKind>(["bleed"]) })), "出血は血飛沫").toBe("blood");
    expect(deathKindOf(cause({ silent: true, statuses: new Set<StatusKind>(["shock"]) })), "感電は放電").toBe("discharge");
    expect(deathKindOf(cause({ silent: true })), "何も無ければ従来の飛び散り").toBe("burst");
  });

  it("最後の一撃の属性で死に方が決まる", () => {
    expect(deathKindOf(cause({ element: "fire" }))).toBe("ash");
    expect(deathKindOf(cause({ element: "ice" }))).toBe("shatter");
    expect(deathKindOf(cause({ element: "lightning" }))).toBe("discharge");
    expect(deathKindOf(cause({ element: "poison" }))).toBe("melt");
    expect(deathKindOf(cause({ element: "dark" }))).toBe("void");
    expect(deathKindOf(cause({ element: "light" }))).toBe("holy");
  });

  it("会心の近接は両断、ただの近接は飛び散り", () => {
    expect(deathKindOf(cause({ crit: true }))).toBe("sever");
    expect(deathKindOf(cause({}))).toBe("burst");
    expect(deathKindOf(cause({ crit: true, kind: "ranged" })), "射撃の会心は両断にしない").toBe("burst");
  });

  it("燃えている敵を継続ダメージで倒すと灰の演出が残る", () => {
    const state = arena(3);
    const e = placeEnemy(state, "slime", 30);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 5, potency: 1 }, "player");
    e.hp = 1;
    const killed = damageEnemy(state, e, 5, { x: 1, y: 0 }, 0, { silent: true });
    expect(killed, "倒れる").toBe(true);
    expect(fxState(state).deaths.map((d) => d.kind), "灰になる").toContain("ash");
  });

  it("処刑の印は次の撃破演出を両断にして消える", () => {
    const state = arena(4);
    const e = placeEnemy(state, "slime", 30);
    markExecuted(state, e);
    spawnDeathFx(state, e, { kind: "melee" });
    expect(fxState(state).deaths[0]?.kind, "両断").toBe("sever");
    expect(fxState(state).executedId, "印は使い切る").toBe(-1);
  });
});

describe("コンボの浮き文字", () => {
  it("コンボ数の段で大きさと色が変わる", () => {
    expect(comboTier(5), "10 未満は段なし").toBeUndefined();
    const low = comboDamageText(10, "#ffffff", 1, false);
    const high = comboDamageText(100, "#ffffff", 1, false);
    expect(low.scale, "10 コンボで少し大きい").toBeGreaterThan(1);
    expect(high.scale, "100 コンボはもっと大きい").toBeGreaterThan(low.scale);
    expect(high.color, "色も変わる").not.toBe("#ffffff");
  });

  it("会心の色はコンボの色で上書きしない", () => {
    expect(comboDamageText(50, "#ff4040", 1.5, true).color).toBe("#ff4040");
  });
});

describe("効果音の名前", () => {
  const names: ReadonlySet<string> = new Set(SFX_NAMES);

  it("武器種 10 種・射撃の型ごとの音が SFX_NAMES にある", () => {
    for (const key of MOVESET_KEYS) expect(names.has(swingSfxName(key)), `振り音 ${key}`).toBe(true);
    for (const key of SHOT_KEYS) expect(names.has(shotSfxName(key)), `発射音 ${key}`).toBe(true);
    expect(new Set(MOVESET_KEYS.map(swingSfxName)).size, "武器種ごとに別の音").toBe(MOVESET_KEYS.length);
  });

  it("響きの 5 色は別々のドロップ音", () => {
    const drops = TRAIT_COLORS.map(dropSfxName);
    expect(new Set(drops).size).toBe(TRAIT_COLORS.length);
    for (const n of drops) expect(names.has(n), n).toBe(true);
  });

  it("ボスの怯みは銅鑼、通常の敵は金属音", () => {
    expect(statusSfxName("stagger", true)).toBe("bossDown");
    expect(statusSfxName("stagger", false)).toBe("stagger");
    for (const kind of STATUS_KINDS) {
      const n = statusSfxName(kind, false);
      if (n) expect(names.has(n), `付与音 ${kind}`).toBe(true);
    }
  });

  it("毒を付けると付与音が積まれる", () => {
    const state = arena(5);
    const e = placeEnemy(state, "slime", 30);
    state.sfx = [];
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "poison", stacks: 1, duration: 3, potency: 0.01 }, "player");
    expect(state.sfx).toContain("statusPoison");
  });
});

describe("部屋・ドロップの演出", () => {
  it("封鎖は扉の印、巣窟は専用の音", () => {
    const state = arena(6);
    state.sfx = [];
    roomLockFx(state, 0, true);
    expect(fxState(state).marks.some((m) => m.kind === "doorSlam" && m.value === 0), "扉の印").toBe(true);
    expect(state.sfx).toContain("hordeSeal");
  });

  it("制圧の波は最後の撃破地点から始まる", () => {
    const state = arena(6);
    const e = placeEnemy(state, "slime", 40);
    spawnDeathFx(state, e, { kind: "melee", crit: true });
    roomClearFx(state, 0);
    const wave = fxState(state).marks.find((m) => m.kind === "clearWave");
    expect(wave?.pos, "撃破地点が起点").toEqual(e.body.pos);
  });

  it("色を持つ遺物が落ちると、その色のドロップ音と光柱が出る", () => {
    const state = arena(8);
    const item = generateItem(createRng(11), { itemLevel: 5, foundDepth: 5, now: 0 });
    const color = itemTraitColor(item);
    expect(color, "生成した遺物は色を持つ").toBeDefined();
    if (!color) return;
    fxState(state).lastDropId = -1;
    state.sfx = [];
    state.floorItems.push({ id: 99999, item, pos: { x: 10, y: 10 }, bobTime: 0 });
    updateEffects(state, 0.016);
    expect(state.sfx, "色のドロップ音").toContain(dropSfxName(color));
    expect(fxState(state).marks.some((m) => m.kind === "dropBeam"), "光柱").toBe(true);
    state.sfx = [];
    updateEffects(state, 0.016);
    expect(state.sfx, "同じ遺物では二度鳴らさない").not.toContain(dropSfxName(color));
  });

  it("ダッシュ中は残像を置く", () => {
    const state = arena(2);
    state.player.dashTimer = 0.2;
    updateEffects(state, 0.016);
    expect(fxState(state).marks.some((m) => m.kind === "dashGhost")).toBe(true);
  });
});
