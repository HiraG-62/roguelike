import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { pushEvent } from "../core/events";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { REFORGES, REFORGE_KEYS, type ReforgeKey, reforgesOfForm, withReforges } from "../data/reforges";
import { FORM, REFORGE } from "../data/tuning";
import { FORMS, FORM_KEYS, type FormKey, movesetsOfForm } from "../data/weaponForms";
import { MOVESETS, meleeChargeOf } from "../data/weapons";
import { terrainAt } from "./terrain";
import { onBossDeath } from "./boss";
import { currentForm, moraleMax, tickMorale } from "./morale";
import { startReload, tickMagazine } from "./magazine";
import { BULLETS } from "../loot/bullets";
import { playerMoveset, updatePlayer } from "./player";
import { chooseReforge, grantReforge, offerReforges, reforgeRules, rollReforgeOptions } from "./reforge";
import { resolveRules } from "./rules";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { botInput, createBotState } from "../qa/bot";

/**
 * 改鋳（docs/ideas/weapon-forms-impl.md 3-6。data/reforges.ts / system/reforge.ts）。
 * 3 択の出し方・祝福と同じ入力経路での選択・武器種の段の書き換え・戦意の上書き・挙動の切り替え・起点の Rule を確かめる
 */

const PER_FORM = 2;
/**
 * 改鋳の数が 2 つに満たない型（銃と投擲物の見直しで、働かなくなった改鋳を消し、新しい型の改鋳は後で作る。
 * docs/ideas/gun-bases-review.md 4-3 の 3）。投具は牽引・双刃（手元返し・投げ放ちが消える）、仕掛けは連爆を装薬へ移した残り、
 * 装薬は連爆だけ、擲弾はまだ無い
 */
const UNDER_FILLED: Readonly<Partial<Record<FormKey, number>>> = { thrower: 0, artillery: 1, powder: 1, shell: 0, akimbo: 0 };
const INPUT_WAIT = REFORGE.inputDelay + FIXED_DT;
const EPS = 1e-6;
/** 放出の粒が届いて炸裂するまで待つステップ */
const CHAIN_STEPS = 30;
/** bot が 3 択を閉じるまで待つ上限のステップ（待ちは祝福と同じ 0.5 秒） */
const BOT_STEPS = 120;

/** 5 の倍数の階のボス（major）を置いて倒す */
function slayMajorBoss(state: GameState, major = true): void {
  const e = placeEnemy(state, "slime", 60);
  state.boss = { enemyId: e.id, name: "試しのボス", roomIndex: 0, introTimer: 0, defeated: false, major };
  e.hp = 0;
  onBossDeath(state, e);
}

function withReforge(moveset: GameState["stats"]["moveset"], ...keys: ReforgeKey[]): GameState {
  const state = arena(5, { moveset });
  state.reforges = [...keys];
  return state;
}

function laneSwing(state: GameState, key: string) {
  const s = playerMoveset(state).steps2.find((a) => a.key === key);
  if (!s) throw new Error(`右の段 ${key} が無い`);
  return s;
}

describe("改鋳のデータ", () => {
  it("型ごとに 2 つ（理由付きで 0〜1 の型は UNDER_FILLED）。key と表示名は重ならない", () => {
    for (const form of FORM_KEYS) expect(reforgesOfForm(form), `${form} の改鋳`).toHaveLength(UNDER_FILLED[form] ?? PER_FORM);
    const total = FORM_KEYS.reduce((n, form) => n + (UNDER_FILLED[form] ?? PER_FORM), 0);
    expect(REFORGE_KEYS, "合計").toHaveLength(total);
    const names = REFORGE_KEYS.map((k) => REFORGES[k].name);
    expect(new Set(names).size, "表示名の重なり").toBe(names.length);
    for (const k of REFORGE_KEYS) expect(REFORGES[k].key, "key の写し").toBe(k);
  });

  it("数値の JSON（REFORGE/<型>.json）の key と改鋳の key が型ごとに一致する", () => {
    const blocks = REFORGE as unknown as Readonly<Record<string, unknown>>;
    for (const form of FORM_KEYS) {
      const block = blocks[form];
      // 改鋳の無い型はブロックを置かない（空のブロックは balance の検査が禁じる）
      if (reforgesOfForm(form).length === 0) {
        expect(block, `${form} のブロック`).toBeUndefined();
        continue;
      }
      expect(typeof block, `${form} のブロック`).toBe("object");
      expect(Object.keys(block as object).sort(), `${form} の key`).toEqual(reforgesOfForm(form).sort());
    }
  });

  it("どの改鋳も段・戦意・起点・挙動のどれかを書き換える", () => {
    for (const k of REFORGE_KEYS) {
      const d = REFORGES[k];
      const any = d.patch !== undefined || d.morale !== undefined || (d.rules?.length ?? 0) > 0 || (d.flags?.length ?? 0) > 0;
      expect(any, `${k} が何も書き換えない`).toBe(true);
    }
  });
});

describe("改鋳の 3 択の出し方", () => {
  it("5 の倍数の階のボスを倒すと 3 択が出て、階の主では出ない", () => {
    const state = arena(5);
    slayMajorBoss(state, false);
    expect(state.reforgeChoice, "階の主").toBeNull();
    slayMajorBoss(state);
    expect(state.reforgeChoice?.options, "ボス").toHaveLength(REFORGE.offerCount);
  });

  it("装備中の型の改鋳が先に並び、取得済みと武器種の無い型（書・鈴）は出ない", () => {
    const state = arena(5, { moveset: "twinBlades" });
    const first = rollReforgeOptions(state);
    expect(first.slice(0, PER_FORM).every((k) => REFORGES[k].form === "flurry"), "連刃が先").toBe(true);
    for (const k of first) expect(movesetsOfForm(REFORGES[k].form).length, `${k} の型に武器種がある`).toBeGreaterThan(0);
    grantReforge(state, "flurryHoard");
    const next = rollReforgeOptions(state);
    expect(next, "取得済みは出ない").not.toContain("flurryHoard");
    expect(next[0], "残りの連刃の改鋳が先").toBe("flurryTwin");
  });

  it("同じ seed なら同じ 3 択（state.rng だけで決まる）", () => {
    const a = arena(7);
    const b = arena(7);
    expect(rollReforgeOptions(a)).toEqual(rollReforgeOptions(b));
  });

  it("1 ランの上限に達したら出ない", () => {
    const state = arena(5);
    const keys = REFORGE_KEYS.slice(0, REFORGE.perRun);
    for (const k of keys) grantReforge(state, k);
    offerReforges(state);
    expect(state.reforgeChoice, "上限").toBeNull();
  });
});

describe("改鋳の選択（祝福の 3 択と同じ入力経路）", () => {
  function offered(): GameState {
    const state = arena(5);
    slayMajorBoss(state);
    if (!state.reforgeChoice) throw new Error("3 択が出ていない");
    return state;
  }

  function press(state: GameState, input: Partial<FrameInput>): void {
    step(state, withInput(input), FIXED_DT);
  }

  it("提示の直後は押しても選ばれず、step は止まる", () => {
    const state = offered();
    const tick = state.tick;
    press(state, { skill1Pressed: true });
    expect(state.reforgeChoice, "待ちの間").not.toBeNull();
    expect(state.tick, "step は止まる").toBe(tick);
  });

  it("待ちの後、スキル 2 で 2 枚目を選ぶと reforges に入って 3 択が閉じる", () => {
    const state = offered();
    const second = state.reforgeChoice?.options[1];
    for (let t = 0; t < INPUT_WAIT; t += FIXED_DT) press(state, {});
    press(state, { skill2Pressed: true });
    expect(state.reforgeChoice, "閉じる").toBeNull();
    expect(state.reforges, "2 枚目").toEqual([second]);
  });

  it("攻撃で 3 枚目、クリックは札の上だけ", () => {
    const state = offered();
    const third = state.reforgeChoice?.options[2];
    for (let t = 0; t < INPUT_WAIT; t += FIXED_DT) press(state, {});
    press(state, { clickPressed: true, attackPressed: true, aimScreen: { x: 1, y: 1 } });
    expect(state.reforgeChoice, "札の外のクリック").not.toBeNull();
    press(state, { attackPressed: true });
    expect(state.reforges, "3 枚目").toEqual([third]);
  });

  it("chooseReforge で選んだ改鋳は二度入らない", () => {
    const state = offered();
    const key = state.reforgeChoice?.options[0];
    chooseReforge(state, 0);
    if (key) grantReforge(state, key);
    expect(state.reforges, "1 つだけ").toEqual([key]);
  });
});

describe("改鋳の段の書き換え（playerMoveset の withReforges）", () => {
  it("型の合わない武器種には効かず、同じ入力の型は同じオブジェクトを返す", () => {
    const state = withReforge("twinBlades", "bladeWave");
    expect(playerMoveset(state), "連刃に剣の改鋳").toBe(MOVESETS.twinBlades);
    const sword = withReforge("sword", "bladeWave");
    expect(playerMoveset(sword), "cache").toBe(playerMoveset(sword));
    expect(withReforges(MOVESETS.sword, []), "改鋳なし").toBe(MOVESETS.sword);
  });

  it("剣「飛閃」: 返し斬りが飛ぶ斬撃を撃ち、範囲が狭まる。「反撥」: 返し斬りが重く、崩しが強い", () => {
    const base = MOVESETS.sword.steps2.find((s) => s.key === "returnCut");
    const wave = laneSwing(withReforge("sword", "bladeWave"), "returnCut");
    if (base?.kind !== "swing" || wave.kind !== "swing") throw new Error("返し斬りが振りでない");
    expect(wave.step.cast?.name, "飛ぶ斬撃").toBe(REFORGES.bladeWave.name);
    expect(wave.step.size, "範囲").toBeCloseTo(base.step.size * REFORGE.blade.bladeWave.sizeMul);
    const repel = withReforge("sword", "bladeRepel");
    const cut = laneSwing(repel, "returnCut");
    const parry = laneSwing(repel, "parry");
    if (cut.kind !== "swing" || parry.kind !== "hold") throw new Error("段の種類");
    expect(cut.step.heavy, "壁叩きつけ").toBe(true);
    expect(cut.step.knockback, "押し出し").toBeCloseTo(base.step.knockback * REFORGE.blade.bladeRepel.knockbackMul);
    const baseParry = MOVESETS.sword.steps2[0];
    if (baseParry.kind !== "hold") throw new Error("受け流しが構えでない");
    expect(parry.hold.parry?.staggerPoise, "崩し").toBe((baseParry.hold.parry?.staggerPoise ?? 0) * REFORGE.blade.bladeRepel.staggerMul);
  });

  it("連刃「双影」: 乱舞の当たる回数が倍", () => {
    const base = MOVESETS.claws.steps2.find((s) => s.key === "frenzy");
    const twin = laneSwing(withReforge("claws", "flurryTwin"), "frenzy");
    if (base?.kind !== "swing" || twin.kind !== "swing") throw new Error("乱舞が振りでない");
    expect(twin.step.hits, "多段").toBe(Math.round((base.step.hits ?? 1) * REFORGE.flurry.flurryTwin.hitsMul));
  });

  it("重打「闊歩」: 溜めの段が 2 までで歩ける。戦意の上限も 2", () => {
    const state = withReforge("greatsword", "crusherStride");
    const charge = meleeChargeOf(playerMoveset(state));
    expect(charge?.levels, "段").toHaveLength(REFORGE.crusher.crusherStride.maxLevels);
    expect(charge?.moveMul, "歩ける").toBeGreaterThanOrEqual(REFORGE.crusher.crusherStride.moveMul);
    expect(moraleMax(state), "戦意の上限").toBe(REFORGE.crusher.crusherStride.maxLevels);
  });

  it("長柄「釘付」: 突きが押し出さず麻痺で縫い留める", () => {
    const moveset = playerMoveset(withReforge("spear", "polearmPin"));
    const thrusts = moveset.steps.filter((s) => s.shape.kind === "thrust");
    expect(thrusts.length, "突きの段がある").toBeGreaterThan(0);
    for (const s of thrusts) {
      expect(s.knockback, "押し出さない").toBe(0);
      expect(s.applies?.some((a) => a.kind === "paralyze"), "縫い留め").toBe(true);
    }
  });

  it("盾「八方」: 構えが全方位で動けない", () => {
    const guard = laneSwing(withReforge("shield", "bulwarkRound"), "guard");
    if (guard.kind !== "hold") throw new Error("構えでない");
    expect(guard.hold.guard?.arcDeg, "全方位").toBe(REFORGE.bulwark.bulwarkRound.arcDeg);
    expect(guard.hold.moveMul, "動けない").toBe(REFORGE.bulwark.bulwarkRound.moveMul);
  });

  it("杖「四重詠唱」: 3 手の魔法の頭を重ねた 4 手の派生が足され、入力列は重ならず長い順。術式の上限は 4", () => {
    const state = withReforge("wand", "rodQuad");
    const moveset = playerMoveset(state);
    const quads = moveset.branches.filter((b) => b.sequence.length === 4);
    expect(quads.length, "4 手の派生").toBeGreaterThan(0);
    const seqs = moveset.branches.filter((b) => b.art !== "release").map((b) => b.sequence.join(","));
    expect(new Set(seqs).size, "入力列の重なり").toBe(seqs.length);
    const lengths = moveset.branches.map((b) => b.sequence.length);
    expect(lengths, "長い順").toEqual([...lengths].sort((a, b) => b - a));
    expect(moraleMax(state), "術式の上限").toBe(REFORGE.rod.rodQuad.max);
  });

  it("杖「残滓」: 属性のある魔法の弾が地形を残す", () => {
    const moveset = playerMoveset(withReforge("wand", "rodResidue"));
    const bolt = moveset.branches.find((b) => b.key === "lightningBolt");
    expect(bolt?.step.cast?.throw.bullet.leaves?.terrain, "雷は水たまり").toBe("water");
    const base = MOVESETS.wand.branches.find((b) => b.key === "lightningBolt");
    expect(base?.step.cast?.throw.bullet.leaves, "元の定義は変えない").toBeUndefined();
  });
});

describe("改鋳の戦意の上書き（currentForm の reforgedForm）", () => {
  it("連刃「蓄勢」: 冷めず、上限と放出の最低が上がる。型の定義は変えない", () => {
    const state = withReforge("twinBlades", "flurryHoard");
    const n = currentForm(state).morale.numbers;
    expect(n.decayPerSec, "冷めない").toBe(0);
    expect(n.max, "上限").toBe(REFORGE.flurry.flurryHoard.max);
    expect(n.perUnit.hitsAdd, "抱えるほど長い").toBe(REFORGE.flurry.flurryHoard.perUnit.hitsAdd);
    expect(n.perUnit.damageMul, "書いていない項目はそのまま").toBe(FORM.flurry.perUnit.damageMul);
    expect(FORMS.flurry.morale.numbers.max, "元の型").toBe(FORM.flurry.max);
    state.player.morale.value = FORM.flurry.max;
    state.player.morale.sinceGain = FORM.flurry.decayDelaySec + 1;
    tickMorale(state, withInput({}), FIXED_DT);
    expect(state.player.morale.value, "手を止めても冷めない").toBe(FORM.flurry.max);
  });
});

describe("改鋳の挙動の切り替え（morale.ts から読む）", () => {
  const rifle = { moveset: "longarm" as const, bullet: "rifle" };
  const MID = 50;

  it("長銃「騎射」: 動いても狙いが減らず、半分の速さで溜まる", () => {
    const plain = arena(5, rifle);
    plain.player.morale.value = MID;
    tickMorale(plain, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
    expect(plain.player.morale.value, "改鋳なしは減る").toBeLessThan(MID);
    const state = arena(5, rifle);
    state.reforges = ["rifleStride"];
    state.player.morale.value = MID;
    tickMorale(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
    const gain = FORM.rifle.gain.still * FIXED_DT * REFORGE.rifle.rifleStride.movingGainMul;
    expect(state.player.morale.value - MID, "半分の速さで溜まる").toBeCloseTo(gain);
  });

  it("短銃「疾駆」: 込めの最中にダッシュすると、その場で弾倉が満ちる", () => {
    const state = arena(5, { moveset: "sidearm", bullet: "pistol" });
    state.reforges = ["pistolDash"];
    tickMagazine(state, withInput({}), FIXED_DT);
    const hand = state.player.magazine.hands[0];
    hand.rounds = 0;
    startReload(state, 0);
    state.player.dashTimer = FIXED_DT * 2;
    tickMorale(state, withInput({}), FIXED_DT);
    expect(hand.reloadLeft, "込めが終わる").toBe(0);
    expect(hand.rounds, "弾倉が満ちる").toBe(BULLETS.pistol?.magazine?.capacity);
  });

  it("砲「吸着」: 設置弾が近くの敵へ向かって動く", () => {
    const state = arena(5, { moveset: "trapper", bullet: "mineLauncher" });
    state.reforges = ["artilleryCling"];
    state.player.shootCooldown = 0;
    updatePlayer(state, withInput({ attackHeld: true }), FIXED_DT);
    const mine = state.projectiles.find((pr) => pr.owner === "player");
    if (!mine) throw new Error("設置弾が無い");
    mine.vel = { x: 0, y: 0 };
    const e = placeEnemy(state, "slime", 0, 60);
    e.body.pos = { x: mine.pos.x, y: mine.pos.y + REFORGE.artillery.artilleryCling.range / 2 };
    tickMorale(state, withInput({}), FIXED_DT);
    expect(mine.vel.y, "敵の方へ").toBeCloseTo(REFORGE.artillery.artilleryCling.speed);
  });
});

describe("改鋳の起点（統一ルール文法）", () => {
  it("型の合う改鋳の Rule だけを集める", () => {
    expect(reforgeRules(withReforge("greatsword")), "改鋳なし").toHaveLength(0);
    expect(reforgeRules(withReforge("greatsword", "crusherQuake")), "重打").toHaveLength(1);
    expect(reforgeRules(withReforge("sword", "crusherQuake")), "持ち替えた型").toHaveLength(0);
  });

  it("重打「余震」: 放出の一撃の命中で崩れる床が残る。放出でない終撃では残らない", () => {
    const state = withReforge("greatsword", "crusherQuake");
    const e = placeEnemy(state, "slime", 40);
    const at = { ...e.body.pos };
    pushEvent(state, { kind: "onFinisher", actor: "player", source: { kind: "player", key: "finisher" }, pos: at, targetId: e.id });
    resolveRules(state, FIXED_DT);
    expect(terrainAt(state, at.x, at.y), "ただの終撃").not.toBe("rubble");
    pushEvent(state, { kind: "onFinisher", actor: "player", source: { kind: "player", key: "finisher" }, tag: "release", pos: at, targetId: e.id });
    resolveRules(state, FIXED_DT);
    expect(terrainAt(state, at.x, at.y), "崩れる床").toBe("rubble");
  });

  it("盾「投盾」: 受け溜めが満ちると照準の方へ衝撃波が飛ぶ", () => {
    const state = withReforge("shield", "bulwarkThrow");
    const before = state.projectiles.length;
    pushEvent(state, { kind: "onBrim", actor: "player", source: { kind: "player", key: "morale" }, pos: { ...state.player.body.pos }, tag: "bulwark" });
    resolveRules(state, FIXED_DT);
    expect(state.projectiles.length, "衝撃波の弾").toBeGreaterThan(before);
  });

  it("装薬「連爆」: 詰めた放出の粒が当たった敵が炸裂し、周りの敵を巻き込む", () => {
    const hurt = (reforges: ReforgeKey[]): number => {
      const state = arena(5, { moveset: "cannon", bullet: "shotgun" });
      state.reforges = [...reforges];
      tickMagazine(state, withInput({}), 0);
      const target = placeEnemy(state, "slime", 24);
      // 粒の扇の外（真横）で、炸裂の半径の内に立つ敵
      const side = placeEnemy(state, "slime", 24, REFORGE.powder.powderChain.radius - 4);
      for (const e of [target, side]) {
        e.hp = 99999;
        e.maxHp = 99999;
        e.attackCooldown = 99;
      }
      state.player.morale.value = FORM.powder.max;
      state.player.shootCooldown = 0;
      step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
      for (let i = 0; i < CHAIN_STEPS; i++) step(state, withInput({}), FIXED_DT);
      return side.maxHp - side.hp;
    };
    expect(hurt(["powderChain"]), "炸裂が横の敵を巻き込む").toBeGreaterThan(hurt([]));
  });

  it("選んだ改鋳の数値は型の定義に残らない（ランを跨がない）", () => {
    const state = withReforge("twinBlades", "flurryHoard");
    expect(moraleMax(state), "改鋳あり").toBe(REFORGE.flurry.flurryHoard.max);
    state.reforges = [];
    expect(moraleMax(state), "改鋳なし").toBeCloseTo(FORM.flurry.max, EPS);
  });
});

describe("QA bot と改鋳の 3 択", () => {
  it("bot は 3 択で止まらず、装備中の型の札を選ぶ", () => {
    const state = arena(5, { moveset: "twinBlades" });
    slayMajorBoss(state);
    const bot = createBotState(1);
    for (let i = 0; i < BOT_STEPS && state.reforgeChoice; i++) step(state, botInput(state, bot, FIXED_DT), FIXED_DT);
    expect(state.reforgeChoice, "閉じる").toBeNull();
    expect(state.reforges.map((k) => REFORGES[k].form), "連刃の改鋳").toEqual(["flurry"]);
  });
});
