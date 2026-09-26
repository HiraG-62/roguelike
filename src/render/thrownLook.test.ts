import { describe, expect, it } from "vitest";
import type { Projectile } from "../core/state";
import { SPRITES } from "../data/sprites";
import { THROWN_SHAPES, thrownSpriteKey, unheldFrame } from "../data/sprites/weapons";
import { MOVESETS, MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { ULTIMATES } from "../data/ultimates";
import { BASES } from "../loot/bases";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import { WEAPON_ART } from "../skills/reshapes";
import { markShotBullet, withUltimateFx } from "../system/effects";
import { arena } from "../system/testHelpers";
import {
  BULLET_LOOK,
  GRENADE_LOOK,
  SKILL_LOOK,
  THROWN_ECHO_LOOK,
  ULTIMATE_LOOK,
  WEAPON_ART_LOOK,
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

  it("投げ短剣の左の弾は短刀の絵で、切っ先を進む向きへ向ける", () => {
    const pr = shot("player");
    markShotBullet(pr, "throwingKnives");
    expect(projectileLook(pr)?.sprite).toBe(thrownSpriteKey("knife"));
    expect(projectileLook(pr)?.motion).toBe("point");
  });

  it("奥義の弾は弾の key より奥義の表を優先する（大投擲は返し輪の弾で斧を投げる）", () => {
    const state = arena();
    const pr = shot("player");
    markShotBullet(pr, "returnChakram");
    expect(projectileLook(pr)?.sprite, "奥義でなければ輪").toBe(thrownSpriteKey("warRing"));
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

  it("技の弾は技の key で引き、極意は今の武器種で引く", () => {
    expect(skillShotLook("spearHurl", "spear")?.sprite).toBe(thrownSpriteKey("spear"));
    expect(skillShotLook("shieldThrow", "shield")?.sprite).toBe(thrownSpriteKey("shield"));
    expect(skillShotLook("weaponArt", "thrown")?.sprite, "投げ散らし").toBe(thrownSpriteKey("knife"));
    expect(skillShotLook("weaponArt", "warRing")?.sprite, "乱れ輪").toBe(thrownSpriteKey("warRing"));
    expect(skillShotLook("weaponArt", "sword"), "剣の極意は弾を出さない").toBeUndefined();
    expect(skillShotLook("wandDarkOrb", "wand"), "魔法の弾は対象外").toBeUndefined();
  });

  it("表のすべての絵がスプライトに登録されている", () => {
    const looks = [
      ...Object.values(BULLET_LOOK),
      ...Object.values(ULTIMATE_LOOK),
      ...Object.values(SKILL_LOOK),
      ...Object.values(WEAPON_ART_LOOK),
      GRENADE_LOOK,
      THROWN_ECHO_LOOK,
    ];
    for (const look of looks) expect(SPRITES[look?.sprite ?? ""], look?.sprite).toBeDefined();
  });

  it("表の key は実在する（弾の key・奥義・スキル・武器種）", () => {
    const bulletKeys = new Set<string>([
      ...BASES.map((b) => b.key),
      ...MOVESET_KEYS.flatMap((m) => MOVESETS[m].steps2.flatMap((s) => (s.kind === "volley" ? [`art.${s.key}`] : []))),
    ]);
    for (const key of Object.keys(BULLET_LOOK)) expect(bulletKeys.has(key), `弾 ${key}`).toBe(true);
    const ultKeys = new Set(MOVESET_KEYS.flatMap((m) => ULTIMATES[m].map((u) => u.key)));
    for (const key of Object.keys(ULTIMATE_LOOK)) expect(ultKeys.has(key), `奥義 ${key}`).toBe(true);
    for (const key of Object.keys(SKILL_LOOK)) expect(key in SKILL_DEFS, `スキル ${key}`).toBe(true);
  });
});

describe("投げた武器の角度と大きさ", () => {
  it("point は進む向き、spin は時刻で回り左へ飛ぶと逆回し", () => {
    const knife = skillShotLook("thrownDagger", "thrown");
    const axe = skillShotLook("axeHatchet", "axe");
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
  // 飛ぶ弾が無い（照準地点に即座に出る輪・引き寄せ・帯）
  "skill:thrownBomb": "照準地点に即座に爆ぜる輪で、飛ぶ弾が無い",
  "skill:grenadeCluster": "照準地点の周りに即座に出る輪で、飛ぶ弾が無い",
  "skill:grenadeBarrage": "前方に即座に出る輪で、飛ぶ弾が無い",
  "skill:trapperNet": "照準地点に即座に広がる輪で、飛ぶ弾が無い",
  "skill:trapperLure": "照準地点での引き寄せで、飛ぶ弾が無い",
  "skill:chainSickleHook": "引き寄せ（pull）で、飛ぶ弾が無い",
  "skill:chainSickleChainThrow": "鎖を伸ばす帯（line）の近接",
  "modifier:toLobbed": "置く物を照準地点に即座に置く型替えで、飛ぶ弾が無い",
  // 敵を投げる近接
  "moveset:fists": "敵を背後へ投げる近接の振り",
  "branch:grabToss": "敵を投げる近接の振り",
  "step2:grabThrow": "敵を投げる近接の振り",
  "step2:throughThrow": "突き抜ける近接の振り",
  "step2:chainWeight": "鎖の先の分銅を伸ばす近接の振り（振りの絵は武器種のエフェクトが持つ）",
  // 飛ぶのが武器でない（設置弾）
  "branch:trapToss": "設置弾を 1 つ置く派生で、飛ぶのは設置弾",
  // 持続の奥義（投げた物そのものの見た目は弾の key で決まる）
  "ult:thrown.swiftToss": "持続の奥義。飛ぶ弾の見た目は武器の弾の表が決める",
};

/** 描画は表ではなく別の経路で持つもの（thrownLook.ts の GRENADE_LOOK / THROWN_ECHO_LOOK） */
const DRAWN_ELSEWHERE = new Set(["skill:frag", "modifier:toThrown"]);

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
  for (const [m, art] of Object.entries(WEAPON_ART)) out.push({ id: `weaponArt:${m}`, text: art.name });
  return out;
}

/** 武器種の左の弾（ベースの弾）のうち、武器の絵を持つものがあるか（武器種の説明は左か右レーンの弾のどちらかで拾う） */
function movesetBulletCovered(m: MovesetKey): boolean {
  return BASES.some((b) => b.moveset === m && BULLET_LOOK[b.key] !== undefined);
}

function laneBulletCovered(m: MovesetKey): boolean {
  return MOVESETS[m].steps2.some((s) => s.kind === "volley" && BULLET_LOOK[`art.${s.key}`] !== undefined);
}

function covered(id: string): boolean {
  if (DRAWN_ELSEWHERE.has(id)) return true;
  const [kind, key = ""] = id.split(/:(.*)/s);
  switch (kind) {
    case "skill":
      return SKILL_LOOK[key] !== undefined;
    case "ult":
      return ULTIMATE_LOOK[key] !== undefined;
    case "step2":
      return BULLET_LOOK[`art.${key}`] !== undefined;
    case "weaponArt":
      return WEAPON_ART_LOOK[key as MovesetKey] !== undefined;
    case "moveset":
      return movesetBulletCovered(key as MovesetKey) || laneBulletCovered(key as MovesetKey);
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
