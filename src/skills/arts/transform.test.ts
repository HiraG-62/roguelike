import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../../core/loop";
import type { Enemy, GameState } from "../../core/state";
import { FORM_KEYS, type FormKey, movesetsOfForm } from "../../data/weaponForms";
import type { MovesetKey } from "../../data/weapons";
import { updatePlayer } from "../../system/player";
import { createSkillRunState, updateSkills } from "../../system/skills";
import { arena, placeEnemy, withInput } from "../../system/testHelpers";
import { SKILL_DEFS, baseCastParams, transformLabel } from "../data";
import { stoneFromSeed } from "../generator";
import { castArt, updateArtQueue } from "./engine";
import { ART_DEFS } from "./index";
import { ART_SKILL_KEYS, type ArtSkillKey } from "./keys";
import { ART_TRANSFORMS, TRANSFORM_NUMBERS, transformActs } from "./transform";
import { ART_ACT_KINDS, type ArtAct } from "./types";

/**
 * 型の変形表（skills/arts/transform.ts）: 全 60 技 × 15 型で変形が純関数で決定的・形が壊れないこと、
 * 型ごとの中身（鎖の引き寄せ・振りの弾化・砲撃・鳴り返し …）と、遅れて出る行為が発動時の形のまま出ること
 */

const BIG_HP = 5000;
/** 壊れの検出で進める秒（遅れの最も長い行為 + 鈴の写し + 砲の遅れより長く） */
const SMOKE_SECONDS = 2;
const KIND_SET: ReadonlySet<string> = new Set(ART_ACT_KINDS);
const STRIKE_AREA: ReadonlySet<string> = new Set(["arc", "ring", "line"]);
const NUMERIC_FIELDS = [
  "delay",
  "ahead",
  "side",
  "angleDeg",
  "knockback",
  "hits",
  "reach",
  "deg",
  "radius",
  "length",
  "width",
  "distance",
  "invuln",
  "count",
  "spreadDeg",
  "speed",
  "life",
  "bulletRadius",
  "pierce",
  "bounces",
  "range",
  "jumps",
  "jumpRange",
  "toDistance",
  "duration",
  "poiseMul",
] as const;

function actsOf(key: ArtSkillKey): readonly ArtAct[] {
  return ART_DEFS[key].acts;
}

function movesetOf(form: FormKey): MovesetKey {
  const m = movesetsOfForm(form)[0];
  if (!m) throw new Error(`${form} の武器種が無い`);
  return m;
}

function isStrike(a: ArtAct): boolean {
  return a.damage !== undefined;
}

describe("変形表の形（全 60 技 × 15 型）", () => {
  it("どの型にも変形がある", () => {
    for (const form of FORM_KEYS) expect(ART_TRANSFORMS[form], form).toBeDefined();
  });

  it.each([...FORM_KEYS])("%s: 同じ入力に同じ出力で、元の列を書き換えない", (form) => {
    for (const key of ART_SKILL_KEYS) {
      const before = JSON.stringify(actsOf(key));
      const a = transformActs(form, actsOf(key));
      const b = transformActs(form, actsOf(key));
      expect(a, key).toEqual(b);
      expect(JSON.stringify(actsOf(key)), `${key} の元の列`).toBe(before);
    }
  });

  it.each([...FORM_KEYS])("%s: 行為の種類は ART_ACT_KINDS の中で、数値は有限・段と弾は 1 以上", (form) => {
    for (const key of ART_SKILL_KEYS) {
      const out = transformActs(form, actsOf(key));
      expect(out.length, key).toBeGreaterThan(0);
      for (const a of out) {
        expect(KIND_SET.has(a.kind), `${key}.${a.name} の種類 ${a.kind}`).toBe(true);
        for (const f of NUMERIC_FIELDS) expect(Number.isFinite(a[f]), `${key}.${a.name}.${f}`).toBe(true);
        expect(a.hits, `${key}.${a.name} の段`).toBeGreaterThanOrEqual(1);
        expect(a.count, `${key}.${a.name} の弾の数`).toBeGreaterThanOrEqual(1);
        if (a.damage) expect(Number.isFinite(a.damage.base) && a.damage.base >= 0, `${key}.${a.name} の威力`).toBe(true);
      }
    }
  });

  it("剣と書は行為を変えない", () => {
    for (const key of ART_SKILL_KEYS) {
      expect(transformActs("blade", actsOf(key)), key).toEqual(actsOf(key));
      expect(transformActs("tome", actsOf(key)), key).toEqual(actsOf(key));
    }
  });

  it("鎖は最初に当てる範囲の行為の前に、同じ起点の引き寄せを 1 つ挟む", () => {
    let checked = 0;
    for (const key of ART_SKILL_KEYS) {
      const src = actsOf(key);
      const first = src.findIndex((a) => isStrike(a) && STRIKE_AREA.has(a.kind));
      const out = transformActs("chain", src);
      if (first < 0) {
        expect(out.length, key).toBe(src.length);
        continue;
      }
      checked++;
      expect(out.length, key).toBe(src.length + 1);
      const pull = out[first];
      const next = out[first + 1];
      expect(pull?.kind, key).toBe("pull");
      expect(pull?.anchor, key).toBe(src[first]?.anchor);
      expect(pull?.delay, key).toBe(src[first]?.delay);
      expect(pull?.damage, "引き寄せは与ダメを持たない").toBeUndefined();
      expect(next?.kind, key).toBe(src[first]?.kind);
    }
    expect(checked, "範囲の行為を持つ技がある").toBeGreaterThan(10);
  });

  it("短銃・長銃・投具では扇と帯が残らず弾になる", () => {
    for (const form of ["pistol", "rifle", "thrower"] as const) {
      for (const key of ART_SKILL_KEYS) {
        const out = transformActs(form, actsOf(key));
        expect(out.some((a) => a.kind === "arc" || a.kind === "line"), `${form} ${key}`).toBe(false);
        const swings = actsOf(key).filter((a) => a.kind === "arc" || a.kind === "line").length;
        const shots = actsOf(key).filter((a) => a.kind === "shot").length;
        expect(out.filter((a) => a.kind === "shot").length, `${form} ${key} の弾`).toBe(swings + shots);
      }
    }
  });

  it("振りを弾にしても単体への威力は段を畳んで保つ（百裂の 1 発 = 段の数 × 1 撃 × 型の倍率）", () => {
    const src = actsOf("commonFlurry")[0];
    const out = transformActs("pistol", actsOf("commonFlurry"))[0];
    const mul = TRANSFORM_NUMBERS.pistol.damageMul ?? 0;
    expect(src?.hits ?? 0).toBeGreaterThan(1);
    expect(out?.hits).toBe(1);
    expect(out?.damage?.base).toBeCloseTo((src?.damage?.base ?? 0) * (src?.hits ?? 0) * mul);
  });

  it("砲は扇・自分の周りの円・弾を照準地点の円にし、少し遅らせる", () => {
    const n = TRANSFORM_NUMBERS.artillery;
    for (const key of ART_SKILL_KEYS) {
      const src = actsOf(key);
      const out = transformActs("artillery", src);
      expect(out.some((a) => a.kind === "arc" || a.kind === "shot" || (a.kind === "ring" && a.anchor === "self")), key).toBe(false);
      src.forEach((a, i) => {
        if (a.kind !== "arc") return;
        expect(out[i]?.anchor, key).toBe("target");
        expect(out[i]?.delay, key).toBeCloseTo(a.delay + (n.delayAdd ?? 0));
      });
    }
  });

  it("重打は範囲を広げ、段を 1 減らし（下限 1）、重い一撃にする", () => {
    const src = actsOf("commonWhirl")[0];
    const out = transformActs("crusher", actsOf("commonWhirl"))[0];
    const n = TRANSFORM_NUMBERS.crusher;
    expect(out?.radius).toBeCloseTo((src?.radius ?? 0) * (n.areaMul ?? 0));
    expect(out?.hits).toBe(Math.max(1, (src?.hits ?? 0) + (n.hitsAdd ?? 0)));
    expect(out?.heavy).toBe(true);
    expect(out?.poiseMul).toBeCloseTo(n.poiseMul ?? 0);
  });

  it("刃斧は当てる行為に出血を足す", () => {
    for (const key of ART_SKILL_KEYS) {
      for (const a of transformActs("hewer", actsOf(key))) {
        if (isStrike(a)) expect(a.applies.some((s) => s.kind === "bleed"), `${key}.${a.name}`).toBe(true);
      }
    }
  });

  it("長柄は扇を帯にする", () => {
    for (const key of ART_SKILL_KEYS) expect(transformActs("polearm", actsOf(key)).some((a) => a.kind === "arc"), key).toBe(false);
  });

  it("盾・扇は扇と円が敵弾を消す", () => {
    for (const form of ["bulwark", "warfan"] as const) {
      for (const a of transformActs(form, actsOf("commonShockwave"))) if (a.kind === "ring") expect(a.clearsBullets, form).toBe(true);
    }
  });

  it("鈴は当てる円の後に遅れて鳴る写しを足す", () => {
    const src = actsOf("commonShockwave");
    const out = transformActs("bell", src);
    expect(out.length).toBe(src.length + 1);
    expect(out[1]?.kind).toBe("ring");
    expect(out[1]?.delay).toBeCloseTo((src[0]?.delay ?? 0) + (TRANSFORM_NUMBERS.bell.echoDelay ?? 0));
    expect(out[1]?.damage?.base).toBeCloseTo((src[0]?.damage?.base ?? 0) * (TRANSFORM_NUMBERS.bell.echoMul ?? 0));
  });

  it("杖は付ける状態異常を重ね、攻撃の属性を武器に寄せる印を持つ", () => {
    expect(ART_TRANSFORMS.rod.element).toBe("weapon");
    const src = actsOf("commonFireball")[0];
    const out = transformActs("rod", actsOf("commonFireball"))[0];
    expect(out?.applies[0]?.stacks).toBe((src?.applies[0]?.stacks ?? 0) + (TRANSFORM_NUMBERS.rod.statusStacksAdd ?? 0));
  });
});

describe("型の表示（transformLabel）", () => {
  it("技には今の型の 1 行を出し、技でないスキルには出さない", () => {
    for (const form of FORM_KEYS) expect(transformLabel(form, "commonWhirl"), form).not.toBeNull();
    expect(transformLabel("crusher", "parry")).toBeNull();
  });

  it("行に型の数値が載る（重打の範囲の倍率）", () => {
    expect(transformLabel("crusher", "commonWhirl")).toContain(String(Number((TRANSFORM_NUMBERS.crusher.areaMul ?? 1).toFixed(2))));
  });
});

// ---------------------------------------------------------------------------
// 発動（engine.ts）
// ---------------------------------------------------------------------------

let seed = 9700;

function formArena(key: ArtSkillKey, form: FormKey): GameState {
  const state = arena(5, { moveset: movesetOf(form) });
  seed += 1;
  const stone = { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: key }), variants: [] };
  state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [stone] });
  updateSkills(state, withInput({}), 0);
  state.player.mana = state.stats.maxMana;
  return state;
}

function tough(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

function castAt(state: GameState, key: ArtSkillKey, dx: number): void {
  const p = state.player.body.pos;
  const params = { ...baseCastParams(SKILL_DEFS[key]), slot: 0 };
  castArt(state, key, { slot: 0, params, origin: { ...p }, dir: { x: 1, y: 0 }, target: { x: p.x + dx, y: p.y }, remote: false });
}

function runArtQueue(state: GameState, seconds: number): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) updateArtQueue(state, FIXED_DT);
}

describe("変形した技の発動", () => {
  it("遅れて出る行為は、撃った後に型を持ち替えても撃った時の形で出る（鈴の写しが予約に残る）", () => {
    const state = formArena("commonShockwave", "bell");
    const e = tough(state, 20);
    castAt(state, "commonShockwave", 20);
    const queued = state.skills.artQueue ?? [];
    const expected = transformActs("bell", actsOf("commonShockwave")).filter((a) => a.delay > 0);
    expect(queued.map((q) => q.act), "予約は解決済みの行為").toEqual(expected);
    const afterFirst = e.hp;
    expect(afterFirst, "1 打目").toBeLessThan(BIG_HP);
    // 剣へ持ち替える（剣の変形は写しを持たない）。予約は添字ではなく行為そのものなので、写しがそのまま鳴る
    state.stats = { ...state.stats, moveset: movesetOf("blade") };
    runArtQueue(state, 1);
    expect(state.skills.artQueue ?? [], "予約は出し切る").toEqual([]);
    expect(e.hp, "写しが当たる").toBeLessThan(afterFirst);
  });

  it("鎖は引き寄せてから当てる（離れた敵が寄る）", () => {
    const state = formArena("commonShockwave", "chain");
    const e = tough(state, 50);
    const before = e.body.pos.x - state.player.body.pos.x;
    castAt(state, "commonShockwave", 50);
    expect(e.body.pos.x - state.player.body.pos.x).toBeLessThan(before);
    expect(e.hp).toBeLessThan(BIG_HP);
  });

  it.each([...FORM_KEYS])("%s: 全 60 技を撃って進めても例外・NaN が出ない", (form) => {
    for (const key of ART_SKILL_KEYS) {
      const state = formArena(key, form);
      const enemies = [tough(state, 24), tough(state, 60, 16)];
      castAt(state, key, 60);
      for (let i = 0; i < Math.ceil(SMOKE_SECONDS / FIXED_DT); i++) updatePlayer(state, withInput({}), FIXED_DT);
      const p = state.player;
      expect(Number.isFinite(p.body.pos.x) && Number.isFinite(p.body.pos.y), `${key} 自分の位置`).toBe(true);
      for (const e of enemies) expect(Number.isFinite(e.hp) && Number.isFinite(e.body.pos.x), `${key} 敵`).toBe(true);
      expect(state.skills.artQueue ?? [], `${key} の予約が出し切られる`).toEqual([]);
    }
  });
});
