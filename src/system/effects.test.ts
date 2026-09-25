import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { REACTION_KEYS, STATUS_KINDS, type StatusKind } from "../core/status";
import { SFX_NAMES } from "../audio/sfxNames";
import { EFFECTS, FX_WAVE3, REAPER } from "../data/tuning";
import { MOVESET_KEYS } from "../data/weapons";
import { BULLETS, bulletDef } from "../loot/bullets";
import { generateItem } from "../loot/generator";
import { DEFAULT_STATS, TRAIT_COLORS } from "../loot/types";
import { damageEnemy } from "./combat";
import { reaperAppearAfter, updateReaper } from "./reaper";
import {
  type DeathCause,
  addFloatingText,
  addMark,
  budBloomFx,
  chargeStepSfxName,
  chargeUpFx,
  comboDamageText,
  damageTextKind,
  damageTextLook,
  dotTextColor,
  heartbeatInterval,
  inscribeFx,
  noteReaperWarning,
  reactionSfxName,
  reaperThreat,
  comboTier,
  deathKindOf,
  dropSfxName,
  fxState,
  hitFamily,
  hitSfxName,
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
  hitstop,
} from "./effects";
import { applyStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

const DEFAULT_INFUSE = DEFAULT_STATS.infuse;

function cause(partial: Partial<DeathCause>): DeathCause {
  return { statuses: new Set<StatusKind>(), element: "none", executed: false, silent: false, kind: "melee", crit: false, ...partial };
}

describe("ヒットストップの強度（hitstopScale）", () => {
  it("既定（1）ではそのままのステップ数が積まれる", () => {
    const state = createGame(1);
    hitstop(state, 6);
    expect(state.hitstop).toBe(6);
  });

  it("0 では積まれない", () => {
    const state = createGame(1, "seed", undefined, undefined, undefined, 0);
    hitstop(state, 6);
    expect(state.hitstop, "hitstopScale 0 は無効化される").toBe(0);
  });

  it("強さ 0 ではどの命中でもヒットストップが 0", () => {
    const state = createGame(1, "seed", undefined, undefined, undefined, 0);
    for (const steps of [1, 3, 6, 7, 20]) {
      state.hitstop = 0;
      hitstop(state, steps);
      expect(state.hitstop, `steps=${steps}`).toBe(0);
    }
  });

  it("0.5 では四捨五入で半分になる", () => {
    const state = createGame(1, "seed", undefined, undefined, undefined, 0.5);
    hitstop(state, 7);
    expect(state.hitstop, "7 * 0.5 = 3.5 → 4").toBe(4);
  });

  it("ヒットストップの強さは 2.0 まで上げられる", () => {
    const state = createGame(1, "seed", undefined, undefined, undefined, 2);
    expect(state.hitstopScale).toBe(2);
    hitstop(state, 6);
    expect(state.hitstop, "6 * 2.0 = 12").toBe(12);
  });

  it("範囲外の値は createGame で 0..HITSTOP_SCALE_MAX にクランプされる", () => {
    const over = createGame(1, "seed", undefined, undefined, undefined, 5);
    expect(over.hitstopScale).toBe(2);
    const under = createGame(1, "seed", undefined, undefined, undefined, -5);
    expect(under.hitstopScale).toBe(0);
  });
});

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

  it("武器種ごとの振り音・弾ごとの発射音が SFX_NAMES にある", () => {
    for (const key of MOVESET_KEYS) expect(names.has(swingSfxName(key)), `振り音 ${key}`).toBe(true);
    for (const b of Object.values(BULLETS)) expect(names.has(shotSfxName(b)), `発射音 ${b.key}`).toBe(true);
    expect(shotSfxName(bulletDef("pistol")), "性質の無い弾は shoot").toBe("shoot");
    expect(shotSfxName(bulletDef("mortar")), "曲射筒は曲射の音").toBe("shotLob");
    // 武器 Wave 4 の 4 種（爪・チェーンアレイ・チャクラム・扇子）は既存の振り音を流用する（docs/ideas/weapons-wave4.md 8 章 9）
    const sharedSwing = 4;
    expect(new Set(MOVESET_KEYS.map(swingSfxName)).size, "武器種ごとに別の音（流用の 4 種を除く）").toBe(MOVESET_KEYS.length - sharedSwing);
  });

  it("27 武器種すべてに命中音の系統がある", () => {
    for (const key of MOVESET_KEYS) {
      const family = hitFamily(key);
      expect(["slash", "blunt", "pierce", "lash"], `${key} の系統`).toContain(family);
    }
    expect(MOVESET_KEYS.length, "武器種は 27 種").toBe(27);
  });

  it("命中音は系統と重さで名前が決まり、SFX_NAMES にすべて登録されている", () => {
    const families = ["slash", "blunt", "pierce", "lash"] as const;
    const weights = ["light", "mid", "heavy"] as const;
    const found = new Set<string>();
    for (const family of families) {
      for (const weight of weights) {
        const name = hitSfxName(family, weight);
        expect(names.has(name), `命中音 ${family}/${weight}`).toBe(true);
        found.add(name);
      }
    }
    expect(found.size, "系統 × 重さごとに別の音").toBe(families.length * weights.length);
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

describe("ダメージ文字の種類（7-19）", () => {
  /** スライムは雷が弱点・毒に耐性（data/enemyDefense.ts の沼の敵） */
  const LIGHTNING = { ...DEFAULT_INFUSE, lightning: 1 };
  const POISON = { ...DEFAULT_INFUSE, poison: 1 };

  it("会心 > 弱点 > 耐性 > 通常 の順に種類が決まる", () => {
    const weak = arena(21, { infuse: LIGHTNING });
    const e = placeEnemy(weak, "slime", 30);
    expect(damageTextKind(weak, e, { kind: "melee", crit: true }), "会心が最優先").toBe("crit");
    expect(damageTextKind(weak, e, { kind: "melee" }), "雷の近接は弱点").toBe("weak");
    const resist = arena(21, { infuse: POISON });
    const r = placeEnemy(resist, "slime", 30);
    expect(damageTextKind(resist, r, { kind: "melee" }), "毒の近接は耐性").toBe("resist");
    expect(damageTextKind(resist, r, { kind: "proc" }), "素性なしは通常").toBe("normal");
  });

  it("反応の直後の素性なしの一撃は reaction", () => {
    const state = arena(22);
    const e = placeEnemy(state, "slime", 30);
    e.status.lastReaction = { key: "vaporize", tick: state.tick };
    expect(damageTextKind(state, e, { kind: "proc" })).toBe("reaction");
    e.status.lastReaction = { key: "vaporize", tick: state.tick - FX_WAVE3.damageText.reaction.ticks - 1 };
    expect(damageTextKind(state, e, { kind: "proc" }), "古い反応は数えない").toBe("normal");
    expect(damageTextKind(state, e, { kind: "melee" }), "近接は反応にしない").toBe("normal");
  });

  it("弱点は大きく、耐性は小さく、継続は小さい固定の大きさになる", () => {
    const base = { color: "#ffffff", scale: 1 };
    expect(damageTextLook("weak", base).scale).toBeGreaterThan(1);
    expect(damageTextLook("resist", base).scale).toBeLessThan(1);
    expect(damageTextLook("weak", base).color, "弱点の色").toBe(FX_WAVE3.damageText.weak.color);
    expect(damageTextLook("dot", base).scale).toBe(FX_WAVE3.damageText.dot.scale);
    expect(damageTextLook("normal", base), "通常はそのまま").toEqual(base);
  });

  it("damageEnemy の数字に種類が付く", () => {
    const state = arena(23, { infuse: LIGHTNING });
    const e = placeEnemy(state, "slime", 30);
    e.hp = 999;
    state.texts = [];
    damageEnemy(state, e, 3, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(state.texts.find((t) => t.text === "3")?.kind, "弱点の数字").toBe("weak");
  });

  it("継続ダメージは敵ごとに束ねて、間隔ごとに 1 つの小さな数字にする", () => {
    const state = arena(24);
    const e = placeEnemy(state, "slime", 30);
    e.hp = 999;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 5, potency: 1 }, "player");
    state.texts = [];
    damageEnemy(state, e, 1, { x: 0, y: 0 }, 0, { silent: true });
    damageEnemy(state, e, 2, { x: 0, y: 0 }, 0, { silent: true });
    expect(state.texts.length, "tick ごとには出さない").toBe(0);
    updateEffects(state, FX_WAVE3.damageText.dot.interval);
    const dots = state.texts.filter((t) => t.kind === "dot");
    expect(dots.map((t) => t.text), "合計 1 つ").toEqual(["3"]);
    expect(dots[0]?.color, "燃焼の色").toBe(FX_WAVE3.damageText.dot.burn);
    expect(fxState(state).dots.length, "出し終えた束は捨てる").toBe(0);
  });

  it("継続ダメージの字色は状態異常で変わる", () => {
    expect(dotTextColor(new Set<StatusKind>(["poison"]))).toBe(FX_WAVE3.damageText.dot.poison);
    expect(dotTextColor(new Set<StatusKind>(["bleed"]))).toBe(FX_WAVE3.damageText.dot.bleed);
    expect(dotTextColor(new Set<StatusKind>())).toBe(FX_WAVE3.damageText.dot.other);
  });

  it("ダメージ以外の浮き文字は種類を持たない", () => {
    const state = arena(25);
    state.texts = [];
    addFloatingText(state, { x: 0, y: 0 }, "見切り！", "#fff");
    expect(state.texts[0]?.kind).toBeUndefined();
  });
});

describe("カウンターの白黒（7-10）", () => {
  it("カウンターが起きたら短い間だけ白黒になり、同じカウンターでは繰り返さない", () => {
    const state = arena(26);
    fxState(state);
    state.recent.onCounter = { lastTime: state.time, count: 1 };
    updateEffects(state, 0.001);
    expect(fxState(state).counterMono, "白黒が始まる").toBeGreaterThan(0);
    updateEffects(state, FX_WAVE3.counterMono.time);
    expect(fxState(state).counterMono, "時間で消える").toBe(0);
    updateEffects(state, 0.001);
    expect(fxState(state).counterMono, "同じカウンターでは始めない").toBe(0);
  });
});

describe("芽吹きと銘（7-15 / 8-9）", () => {
  it("芽が出た瞬間に光柱の印と音。同じ芽では繰り返さない", () => {
    const state = arena(27);
    const item = generateItem(createRng(3), { itemLevel: 5, foundDepth: 5, now: 0 });
    const roll = item.affixes[0];
    expect(roll, "性質を持つ遺物").toBeDefined();
    if (!roll) return;
    fxState(state);
    state.sfx = [];
    state.pendingBud = { itemId: item.id, slot: "mainHand", milestone: "kills50", milestoneLabel: "撃破 50", options: [roll, roll] };
    updateEffects(state, 0.016);
    expect(fxState(state).marks.some((m) => m.kind === "budBloom"), "芽吹きの印").toBe(true);
    expect(state.sfx).toContain("budSprout");
    state.sfx = [];
    updateEffects(state, 0.016);
    expect(state.sfx, "同じ芽では鳴らさない").not.toContain("budSprout");
  });

  it("作る前から出ていた芽では芽吹かない", () => {
    const state = arena(28);
    const item = generateItem(createRng(4), { itemLevel: 5, foundDepth: 5, now: 0 });
    const roll = item.affixes[0];
    if (!roll) return;
    state.effects = undefined;
    state.pendingBud = { itemId: item.id, slot: "mainHand", milestone: "kills50", milestoneLabel: "撃破 50", options: [roll, roll] };
    state.sfx = [];
    updateEffects(state, 0.016);
    expect(state.sfx).not.toContain("budSprout");
  });

  it("芽吹きと銘の演出は印と音を積む", () => {
    const state = arena(29);
    state.sfx = [];
    budBloomFx(state);
    inscribeFx(state);
    expect(fxState(state).marks.map((m) => m.kind)).toEqual(expect.arrayContaining(["budBloom", "inscribe"]));
    expect(state.sfx).toEqual(expect.arrayContaining(["budSprout", "inscribe"]));
  });
});

describe("反応と溜めの音（8-4 / 8-7）", () => {
  const names: ReadonlySet<string> = new Set(SFX_NAMES);

  it("すべての反応に音があり、SFX_NAMES にある", () => {
    for (const key of REACTION_KEYS) expect(names.has(reactionSfxName(key)), `反応 ${key}`).toBe(true);
  });

  it("反応が起きると、その系統の音が積まれる", () => {
    const state = arena(30);
    const e = placeEnemy(state, "slime", 30);
    e.hp = 999;
    state.sfx = [];
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 5, potency: 1 }, "player");
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "chill", stacks: 1, duration: 5, potency: 0.3 }, "player");
    const last = e.status.lastReaction;
    expect(last, "燃焼に冷気で反応が起きる").toBeDefined();
    if (!last) return;
    expect(state.sfx).toContain(reactionSfxName(last.key));
  });

  it("溜めの段が上がるたびに段の音。段が多すぎても最後の音", () => {
    const state = arena(31);
    state.sfx = [];
    chargeUpFx(state, 2, "#fff");
    expect(state.sfx).toContain("chargeStep2");
    expect(chargeStepSfxName(1)).toBe("chargeStep1");
    expect(chargeStepSfxName(9)).toBe("chargeStep3");
    expect(chargeStepSfxName(0), "0 段は 1 段目の音").toBe("chargeStep1");
  });
});

describe("気力満タンの音（8-8）", () => {
  it("満タンに達した瞬間だけ鳴る", () => {
    const state = arena(32);
    state.player.mana = 0;
    updateEffects(state, 0.016);
    state.sfx = [];
    state.player.mana = state.stats.maxMana;
    updateEffects(state, 0.016);
    expect(state.sfx, "満ちた瞬間").toContain("manaFull");
    state.sfx = [];
    updateEffects(state, 0.016);
    expect(state.sfx, "満タンのままなら鳴らさない").not.toContain("manaFull");
  });
});

describe("死神の接近の鼓動（8-14）", () => {
  it("警告も死神も無ければ 0。警告が進むほど、死神が近いほど高い", () => {
    expect(reaperThreat(null, null)).toBe(0);
    expect(reaperThreat(1, null), "出現の直前は警告の始まりより近い").toBeGreaterThan(reaperThreat(REAPER.warnMargin, null));
    expect(reaperThreat(null, FX_WAVE3.heartbeat.near), "すぐ近くで最大").toBe(1);
    expect(reaperThreat(null, FX_WAVE3.heartbeat.far * 2), "遠くても追われている").toBe(FX_WAVE3.heartbeat.chaseMin);
    expect(reaperThreat(null, FX_WAVE3.heartbeat.far * 2), "出現後は警告より速い").toBeGreaterThanOrEqual(reaperThreat(0, null));
  });

  it("近いほど鼓動の間隔が縮む", () => {
    expect(heartbeatInterval(1)).toBeCloseTo(FX_WAVE3.heartbeat.fast);
    expect(heartbeatInterval(0)).toBeCloseTo(FX_WAVE3.heartbeat.slow);
    expect(heartbeatInterval(0.8)).toBeLessThan(heartbeatInterval(0.2));
  });

  it("警告中は鼓動を積み、間隔が来るまで次を積まない", () => {
    const state = arena(33);
    state.sfx = [];
    noteReaperWarning(state, REAPER.warnMargin / 2);
    updateEffects(state, 0.016);
    expect(state.sfx, "最初の鼓動").toContain("reaperHeartbeat");
    const threat = fxState(state).reaperThreat;
    expect(threat, "近さを state に持つ").toBeGreaterThan(0);
    state.sfx = [];
    updateEffects(state, 0.016);
    expect(state.sfx, "間隔の途中").not.toContain("reaperHeartbeat");
    updateEffects(state, heartbeatInterval(threat));
    expect(state.sfx, "間隔が来たら次の鼓動").toContain("reaperHeartbeat");
  });

  it("updateReaper は警告中だけ残り秒を渡す", () => {
    const state = arena(34);
    state.floorTime = 0;
    updateReaper(state, 0.016);
    expect(fxState(state).reaperWarnLeft, "警告前").toBeNull();
    state.floorTime = reaperAppearAfter(state) - 5;
    updateReaper(state, 0.016);
    expect(fxState(state).reaperWarnLeft ?? 0, "残り約 5 秒").toBeCloseTo(5, 0);
  });

  it("死神が出ていなければ、警告が無い間は鳴らさない", () => {
    const state = arena(35);
    state.sfx = [];
    noteReaperWarning(state, null);
    updateEffects(state, 1);
    expect(state.sfx).not.toContain("reaperHeartbeat");
  });
});
