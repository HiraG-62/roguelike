import { describe, expect, it } from "vitest";
import type { Projectile } from "../core/state";
import { SPRITES } from "../data/sprites";
import { THROWN_SHAPES, thrownSpriteKey, unheldFrame } from "../data/sprites/weapons";
import { MOVESETS, MOVESET_KEYS, type MovesetKey, movesetCasts } from "../data/weapons";
import { ULTIMATES } from "../data/ultimates";
import { BASES } from "../loot/bases";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import { markShotBullet, withUltimateFx } from "../system/effects";
import { arena } from "../system/testHelpers";
import {
  BULLET_LOOK,
  MOVESET_THROWN_LOOK,
  SKILL_LOOK,
  THROWN_ART_KEYS,
  THROWN_ECHO_LOOK,
  ULTIMATE_LOOK,
  arcPoint,
  projectileLook,
  skillShotLook,
  thrownAngle,
  thrownScale,
} from "./thrownLook";

function shot(owner: Projectile["owner"], radius = 3): Projectile {
  return {
    id: 1,
    owner,
    pos: { x: 0, y: 0 },
    vel: { x: 200, y: 0 },
    radius,
    damage: 1,
    life: 1,
    color: "#ffffff",
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
  };
}

describe("投げた武器の見た目の表（弾・奥義・技の key → 絵）", () => {
  it("斧の投擲の弾は斧の絵を回して飛ばす", () => {
    const pr = shot("player");
    markShotBullet(pr, "art.axeThrow");
    expect(projectileLook(pr)?.sprite).toBe(thrownSpriteKey("axe"));
    expect(projectileLook(pr)?.motion).toBe("spin");
  });

  it("クナイの左の弾はクナイの絵で、切っ先を進む向きへ向ける", () => {
    const pr = shot("player");
    markShotBullet(pr, "kunai");
    expect(projectileLook(pr)?.sprite).toBe(thrownSpriteKey("kunai"));
    expect(projectileLook(pr)?.motion).toBe("point");
  });

  it("奥義の弾は弾の key より奥義の表を優先する（戦輪の近投げの弾でも、大投擲の弾なら斧の絵）", () => {
    const state = arena();
    const pr = shot("player");
    markShotBullet(pr, "cast.ringToss");
    expect(projectileLook(pr)?.sprite, "奥義でなければ輪").toBe(thrownSpriteKey("ringBlades"));
    withUltimateFx(state, "axe.greatThrow", 0, () => state.projectiles.push(pr));
    expect(projectileLook(pr)?.sprite, "大投擲なら斧").toBe(thrownSpriteKey("axe"));
  });

  it("敵の弾・表に無い弾（拳銃）は武器の絵を持たない", () => {
    const enemy = shot("enemy");
    markShotBullet(enemy, "art.axeThrow");
    expect(projectileLook(enemy)).toBeUndefined();
    const pistol = shot("player");
    markShotBullet(pistol, "pistol");
    expect(projectileLook(pistol)).toBeUndefined();
  });

  it("技の弾は技の key で引き、武器を投げる技は今の武器種で引く", () => {
    expect(skillShotLook("commonIceLance", "sword")?.sprite, "決まった絵").toBe(thrownSpriteKey("iceSpear"));
    expect(skillShotLook("commonRicochet", "shield")?.sprite, "跳弾は盾を投げる").toBe(thrownSpriteKey("shield"));
    expect(skillShotLook("commonRicochet", "axe")?.sprite, "跳弾は斧を投げる").toBe(thrownSpriteKey("axe"));
    expect(skillShotLook("commonKiBlast", "chainSickle")?.sprite, "気弾は分銅").toBe(thrownSpriteKey("weight"));
    expect(skillShotLook("commonRicochet", "gunner"), "投げる絵の無い武器種はふつうの弾").toBeUndefined();
    expect(skillShotLook("commonShadowBolt", "wand"), "魔法の弾は対象外").toBeUndefined();
  });

  it("表のすべての絵がスプライトに登録されている", () => {
    const looks = [
      ...Object.values(BULLET_LOOK),
      ...Object.values(ULTIMATE_LOOK),
      ...Object.values(SKILL_LOOK),
      ...Object.values(MOVESET_THROWN_LOOK),
      THROWN_ECHO_LOOK,
    ];
    for (const look of looks) expect(SPRITES[look?.sprite ?? ""], look?.sprite).toBeDefined();
  });

  it("表の key は実在する（弾の key・奥義・スキル・武器種）", () => {
    const bulletKeys = new Set<string>([
      ...BASES.map((b) => b.key),
      ...MOVESET_KEYS.flatMap((m) => MOVESETS[m].steps2.flatMap((s) => (s.kind === "volley" ? [`art.${s.key}`] : []))),
      ...MOVESET_KEYS.flatMap((m) => movesetCasts(MOVESETS[m]).map((c) => c.throw.bullet.key)),
    ]);
    for (const key of Object.keys(BULLET_LOOK)) expect(bulletKeys.has(key), `弾 ${key}`).toBe(true);
    const ultKeys = new Set(MOVESET_KEYS.flatMap((m) => ULTIMATES[m].map((u) => u.key)));
    for (const key of Object.keys(ULTIMATE_LOOK)) expect(ultKeys.has(key), `奥義 ${key}`).toBe(true);
    for (const key of Object.keys(SKILL_LOOK)) expect(key in SKILL_DEFS, `スキル ${key}`).toBe(true);
    for (const key of THROWN_ART_KEYS) expect(key in SKILL_DEFS, `武器を投げる技 ${key}`).toBe(true);
  });
});

describe("投げた武器の角度と大きさ", () => {
  it("point は進む向き、spin は時刻で回り左へ飛ぶと逆回し", () => {
    const knife = skillShotLook("commonKnifeFan", "sword");
    const axe = skillShotLook("commonRicochet", "axe");
    if (!knife || !axe) throw new Error("表に無い");
    expect(thrownAngle(knife, 3, 1, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
    const right = thrownAngle(axe, 0.5, 0, { x: 10, y: 0 });
    const left = thrownAngle(axe, 0.5, 0, { x: -10, y: 0 });
    expect(right).toBeGreaterThan(0);
    expect(left).toBeCloseTo(-right);
    expect(thrownAngle(axe, 0.5, 0, { x: 10, y: 0 }), "同じ時刻・同じ弾なら同じ角度").toBe(right);
  });

  it("小さい弾は等倍、大きい弾は半径に合わせて拡大する", () => {
    expect(thrownScale(3)).toBe(1);
    expect(thrownScale(12)).toBeGreaterThan(2);
  });

  it("放物線は両端が始点と終点で、真ん中が持ち上がる", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    expect(arcPoint(from, to, 0, 10)).toEqual({ x: 0, y: 0 });
    expect(arcPoint(from, to, 0.5, 10).y).toBeCloseTo(-10);
  });
});

describe("投げた武器の絵（data/sprites/weapons.ts）", () => {
  it.each([...THROWN_SHAPES])("%s は 1 フレームで、拳（肌）を含まず、塗りがある", (shape) => {
    const frames = SPRITES[thrownSpriteKey(shape)];
    expect(frames?.length).toBe(1);
    const flat = (frames?.[0] ?? []).join("");
    expect(/[tT]/.test(flat), "肌の画素").toBe(false);
    expect(/[^.k]/.test(flat), "塗りの画素").toBe(true);
  });

  it("持ち手の絵から拳を外すと、柄の端が輪郭で閉じ、透明の縁が削られる", () => {
    const out = unheldFrame(["......", "kttUUk", "kTTXXk", "......"]);
    expect(out).toEqual(["kUUk", "kXXk"]);
  });
});

// ---- 説明に「投げる」とある技の洗い出し ----

const THROW_WORDS = /投げ|投擲|放る|放り|一投/;

/**
 * 説明に投げる語があっても武器の絵を飛ばさないもの（理由つき）。
 * 新しく「投げる」技を足したら、表（thrownLook.ts）に載せるかここへ理由を書く
 */
const EXCLUDED: Readonly<Record<string, string>> = {
  // 飛ぶ弾が無い（照準地点に即座に出る輪）
  "skill:commonBomb": "照準地点に即座に爆ぜる輪で、飛ぶ弾が無い",
  // 敵を投げる近接
  "moveset:fists": "敵を背後へ投げる近接の振り",
  "step2:grabThrow": "敵を投げる近接の振り",
  "step2:chainWeight": "鎖の先の分銅を伸ばす近接の振り（振りの絵は武器種のエフェクトが持つ）",
  // 飛ぶのが武器でない（設置弾）
  "branch:trapToss": "設置弾を 1 つ置く派生で、飛ぶのは設置弾",
  // 持続の奥義（投げた物そのものの見た目は弾の key で決まる）
  "ult:kunai.hiddenArms": "持続の奥義。飛ぶ弾の見た目は武器の弾の表が決める",
};

/** 描画は表ではなく別の経路で持つもの（thrownLook.ts の THROWN_ECHO_LOOK。照準起点の近接が飛ばす刃） */
const DRAWN_ELSEWHERE = new Set(["modifier:toTarget"]);

interface Described {
  readonly id: string;
  readonly text: string;
}

function described(): Described[] {
  const out: Described[] = [];
  for (const def of Object.values(SKILL_DEFS)) out.push({ id: `skill:${def.key}`, text: `${def.name} ${def.verb}` });
  for (const def of Object.values(MODIFIERS)) out.push({ id: `modifier:${def.key}`, text: `${def.name} ${def.verb}` });
  for (const m of MOVESET_KEYS) {
    const set = MOVESETS[m];
    out.push({ id: `moveset:${m}`, text: set.desc });
    for (const s of set.steps2) out.push({ id: `step2:${s.key ?? ""}`, text: `${s.name ?? ""} ${s.desc ?? ""}` });
    for (const b of set.branches) out.push({ id: `branch:${b.key}`, text: b.name });
    for (const u of ULTIMATES[m]) out.push({ id: `ult:${u.key}`, text: `${u.name} ${u.desc}` });
  }
  return out;
}

/** 武器種の左の弾（ベースの弾）のうち、武器の絵を持つものがあるか（武器種の説明は左か右レーンの弾のどちらかで拾う） */
function movesetBulletCovered(m: MovesetKey): boolean {
  return BASES.some((b) => b.moveset === m && BULLET_LOOK[b.key] !== undefined);
}

function laneBulletCovered(m: MovesetKey): boolean {
  return MOVESETS[m].steps2.some((s) => s.kind === "volley" && BULLET_LOOK[`art.${s.key}`] !== undefined);
}

/** 振りが撃つ弾（cast。手裏剣の左右・戦輪の近投げ）のうち、武器の絵を持つものがあるか */
function castBulletCovered(m: MovesetKey): boolean {
  return movesetCasts(MOVESETS[m]).some((c) => BULLET_LOOK[c.throw.bullet.key] !== undefined);
}

/** 右の段の弾: 弾の段（`art.<key>`）か、振りの段が撃つ cast の弾 */
function step2Covered(key: string): boolean {
  if (BULLET_LOOK[`art.${key}`] !== undefined) return true;
  return MOVESET_KEYS.some((m) =>
    MOVESETS[m].steps2.some((s) => s.key === key && s.kind === "swing" && s.step.cast !== undefined && BULLET_LOOK[s.step.cast.throw.bullet.key] !== undefined),
  );
}

function covered(id: string): boolean {
  if (DRAWN_ELSEWHERE.has(id)) return true;
  const [kind, key = ""] = id.split(/:(.*)/s);
  switch (kind) {
    case "skill":
      return SKILL_LOOK[key] !== undefined || THROWN_ART_KEYS.has(key);
    case "ult":
      return ULTIMATE_LOOK[key] !== undefined;
    case "step2":
      return step2Covered(key);
    case "moveset":
      return movesetBulletCovered(key as MovesetKey) || laneBulletCovered(key as MovesetKey) || castBulletCovered(key as MovesetKey);
    case "branch":
      return branchCovered(key);
    default:
      return false;
  }
}

/** 派生の弾: 右レーンの弾を借りるならその弾、借りなければ武器種の左の弾の表 */
function branchCovered(key: string): boolean {
  for (const m of MOVESET_KEYS) {
    const b = MOVESETS[m].branches.find((x) => x.key === key);
    if (!b?.shots) continue;
    return b.shots.from === "lane" ? laneBulletCovered(m) : movesetBulletCovered(m);
  }
  return false;
}

describe("説明に「投げる」とある技の洗い出し", () => {
  const throws = described().filter((d) => THROW_WORDS.test(d.text));

  it("投げる語を含む技は、武器の絵の表に載っているか、除外の理由がある", () => {
    const missing = throws.filter((d) => !covered(d.id) && EXCLUDED[d.id] === undefined).map((d) => `${d.id}（${d.text}）`);
    expect(missing, "表にも除外にも無い").toEqual([]);
  });

  it("除外の一覧は実在する投げる技だけを持つ（消えた技の除外を残さない）", () => {
    const ids = new Set(throws.map((d) => d.id));
    for (const id of Object.keys(EXCLUDED)) expect(ids.has(id), id).toBe(true);
  });

  it("洗い出しが空でない（語の検出が働いている）", () => {
    expect(throws.length).toBeGreaterThan(20);
  });
});
