import { describe, expect, it } from "vitest";
import { BASES } from "../loot/bases";
import { BULLETS, bulletDef, bulletOfBase } from "../loot/bullets";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import { BOONS } from "../system/boonDefs";
import { JOB_BRANCHES } from "./jobs";
import { PLAYER, ULTIMATE } from "./tuning";
import { ULTIMATES, type SustainShot, type UltimateAct, type UltimateDef, defaultUltimate, isUltimateKey, sustainRules, ultimateDef } from "./ultimates";
import { type BulletDef, type BulletFeature, MOVESETS, MOVESET_KEYS, hasBulletFeature } from "./weapons";

/** 奥義の定義（docs/ideas/ougi-and-dual-actions.md 3.3）: 本数・名前・行為の並び・数値の対応 */

const PER_MOVESET = 3;
const TOTAL = MOVESET_KEYS.length * PER_MOVESET;

const ALL: readonly UltimateDef[] = MOVESET_KEYS.flatMap((k) => [...ULTIMATES[k]]);

/** 奥義と重ねてはいけない既存の名前（派生・右の段・ジョブ派生・祝福・スキル・刻印符・極意） */
function takenNames(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (name: string | undefined, where: string): void => {
    if (name) out.set(name, where);
  };
  for (const k of MOVESET_KEYS) {
    const m = MOVESETS[k];
    for (const b of m.branches) add(b.name, `派生 ${k}.${b.key}`);
    for (const s of m.steps2) add(s.name, `右の段 ${k}`);
  }
  for (const b of Object.values(JOB_BRANCHES)) add(b.name, `ジョブ派生 ${b.key}`);
  for (const b of Object.values(BOONS)) add(b.name, `祝福 ${b.key}`);
  for (const s of Object.values(SKILL_DEFS)) add(s.name, `スキル ${s.key}`);
  for (const m of Object.values(MODIFIERS)) add(m.name, `刻印符 ${m.key}`);
  return out;
}

function actsOf(def: UltimateDef): readonly UltimateAct[] {
  return def.kind === "instant" ? def.acts : (def.sustain.onEnd ?? []);
}

describe("奥義の定義", () => {
  it("すべての武器種が 3 本の奥義を持ち、名前が派生・技・祝福・スキルと重ならない", () => {
    for (const k of MOVESET_KEYS) {
      expect(ULTIMATES[k], `${k} の本数`).toHaveLength(PER_MOVESET);
      expect(defaultUltimate(k), `${k} の既定は 0 番目`).toBe(ULTIMATES[k][0]);
    }
    expect(new Set(ALL.map((u) => u.key)).size, "key は一意").toBe(TOTAL);
    expect(new Set(ALL.map((u) => u.name)).size, "名前は一意").toBe(TOTAL);
    const taken = takenNames();
    for (const u of ALL) {
      expect(taken.get(u.name), `${u.key}（${u.name}）が既存の名前と重なる`).toBeUndefined();
      expect(u.key.startsWith(`${u.moveset}.`), `${u.key} は武器種で始まる`).toBe(true);
      expect(ultimateDef(u.key), `${u.key} を引き直せる`).toBe(u);
      expect(isUltimateKey(u.key)).toBe(true);
    }
    expect(isUltimateKey("sword.nope"), "未知の key").toBe(false);
  });

  it("どの武器種にも一撃と持続の両方がある", () => {
    for (const k of MOVESET_KEYS) {
      const kinds = new Set(ULTIMATES[k].map((u) => u.kind));
      expect(kinds.has("instant"), `${k} の一撃`).toBe(true);
      expect(kinds.has("sustain"), `${k} の持続`).toBe(true);
    }
  });

  it("swing / lunge の行為は列の最後にだけ置かれている", () => {
    for (const u of ALL) {
      const acts = actsOf(u);
      acts.forEach((a, i) => {
        if (a.kind !== "swing" && a.kind !== "lunge") return;
        expect(i, `${u.key} の ${a.kind} は最後`).toBe(acts.length - 1);
      });
    }
  });

  it("一撃の奥義は行為を 1 つ以上持ち、弾の行為の弾は弾の表から引ける", () => {
    for (const u of ALL) {
      if (u.kind !== "instant") continue;
      expect(u.acts.length, `${u.key} の行為`).toBeGreaterThan(0);
      for (const a of u.acts) {
        if (a.kind === "volley") expect(BULLETS[a.throw.bullet.key], `${u.key} の弾 ${a.throw.bullet.key}`).toBeDefined();
      }
    }
  });

  it("持続の奥義はゲージが減り、Rule は持続中の条件を持ち、持続中の key でだけ引ける", () => {
    for (const u of ALL) {
      if (u.kind !== "sustain") continue;
      expect(u.sustain.drainPerSec, `${u.key} の減り`).toBeGreaterThan(0);
      for (const r of u.sustain.rules ?? []) expect(r.if, `${u.key} の Rule の条件`).toContainEqual({ kind: "ultimateActive" });
      expect(sustainRules(u.key), `${u.key} の Rule`).toBe(u.sustain.rules ?? sustainRules(null));
    }
    expect(sustainRules(null), "持続中でない").toHaveLength(0);
    expect(sustainRules(defaultUltimate("sword").key), "一撃の key").toHaveLength(0);
  });

  it("ultimates.json の defs の武器種と名前の集合が定義と一致する", () => {
    const defs: Readonly<Record<string, Readonly<Record<string, unknown>>>> = ULTIMATE.defs;
    expect(Object.keys(defs).sort(), "武器種").toEqual([...MOVESET_KEYS].sort());
    for (const k of MOVESET_KEYS) {
      const ids = ULTIMATES[k].map((u) => u.key.slice(k.length + 1));
      expect(Object.keys(defs[k] ?? {}).sort(), `${k} の名前`).toEqual([...ids].sort());
    }
  });
});

describe("奥義ごとの必要ゲージ（cost）", () => {
  /** JSON の defs.<武器種>.<名前>.cost（書いていなければ undefined） */
  function jsonCost(moveset: string, id: string): number | undefined {
    const byMoveset: Readonly<Record<string, unknown>> = ULTIMATE.defs;
    const set = byMoveset[moveset];
    if (typeof set !== "object" || set === null) return undefined;
    const block: unknown = (set as Readonly<Record<string, unknown>>)[id];
    if (typeof block !== "object" || block === null) return undefined;
    const cost: unknown = (block as Readonly<Record<string, unknown>>).cost;
    return typeof cost === "number" ? cost : undefined;
  }

  it("奥義ごとの cost が JSON の値", () => {
    for (const u of ALL) {
      const id = u.key.slice(u.moveset.length + 1);
      const expected = jsonCost(u.moveset, id) ?? ULTIMATE.common.cost;
      expect(u.cost, u.key).toBe(expected);
    }
  });

  it("cost は奥義ゲージの上限以下で正", () => {
    for (const u of ALL) {
      expect(u.cost, u.key).toBeGreaterThan(0);
      expect(u.cost, u.key).toBeLessThanOrEqual(PLAYER.maxEnergy);
    }
  });
});

describe("持続の射撃の差し替え", () => {
  /** 差し替えの項目 → それが効くために弾が持っていなければならない性質（持たない弾では何も起きない） */
  const NEEDS: ReadonlyArray<readonly [keyof SustainShot, BulletFeature]> = [
    ["fuseMul", "mine"],
    ["bounceAdd", "ricochet"],
  ];

  it("持続の shot の差し替えは、その武器種の全ベースの弾が持つ性質だけを触る", () => {
    for (const u of ALL) {
      if (u.kind !== "sustain" || !u.sustain.shot) continue;
      const shot = u.sustain.shot;
      const bases = BASES.filter((b) => b.moveset === u.moveset);
      expect(bases.length, `${u.key} の武器種のベース`).toBeGreaterThan(0);
      for (const [field, feature] of NEEDS) {
        if (shot[field] === undefined) continue;
        for (const b of bases) {
          expect(hasBulletFeature(bulletDef(bulletOfBase(b.key)), feature), `${u.key}.${field} は ${b.key} の弾に効かない`).toBe(true);
        }
      }
      // 周回（orbit）は弾の性質を足す差し替えなので、どのベースの弾にも効く
    }
  });
});

describe("武器 Wave 4 の奥義", () => {
  it("爪・チェーンアレイ・チャクラム・扇子が 3 本ずつ持ち、既定はどれも一撃", () => {
    for (const k of ["claws", "flail", "ringBlades", "fan"] as const) {
      expect(ULTIMATES[k], k).toHaveLength(PER_MOVESET);
      expect(defaultUltimate(k).kind, `${k} の既定`).toBe("instant");
    }
  });

  it("大旋風は敵弾を消す", () => {
    const gale = ultimateDef("fan.greatGale");
    const nova = gale?.kind === "instant" ? gale.acts[0] : undefined;
    expect(nova?.kind === "nova" ? nova.clearsBullets : false, "大旋風は敵弾を消す").toBe(true);
  });
});

describe("投擲物の奥義（docs/ideas/gun-bases-review.md 0-5・2-9）", () => {
  const volleyBullet = (key: string): BulletDef | undefined => {
    const def = ultimateDef(key);
    const act = def?.kind === "instant" ? def.acts[0] : undefined;
    return act?.kind === "volley" ? act.throw.bullet : undefined;
  };

  it("戦輪は断頭輪・輪舞・輪の舞の 3 本。断頭輪と輪舞は近投げの戻る輪を投げる", () => {
    expect(ULTIMATES.ringBlades.map((u) => u.key)).toEqual(["ringBlades.headsman", "ringBlades.ringDance", "ringBlades.ringWaltz"]);
    for (const key of ["ringBlades.headsman", "ringBlades.ringDance"]) {
      expect(volleyBullet(key)?.key, `${key} の弾の型`).toBe("cast.ringToss");
      expect(volleyBullet(key)?.boomerang, `${key} は戻る`).toBeDefined();
    }
    expect(ultimateDef("ringBlades.ringWaltz")?.kind, "輪の舞は持続").toBe("sustain");
  });

  it("消した奥義（千手・一点集中・早業・円環の理・環の陣・乱輪）は定義に無い", () => {
    for (const key of ["thrown.thousandHands", "thrown.pinpoint", "thrown.swiftToss", "warRing.circleLaw", "ringBlades.ringFormation", "ringBlades.wildRings"]) {
      expect(ultimateDef(key), key).toBeUndefined();
    }
  });

  it("大投擲は斧の投擲の弾（行って戻る）を投げる（無い key は拳銃の弾へ黙って落ちるので key を固定する）", () => {
    expect(volleyBullet("axe.greatThrow")?.key).toBe("art.axeThrow");
    expect(volleyBullet("axe.greatThrow")?.boomerang, "戻る").toBeDefined();
  });

  it("クナイ・手裏剣は 3 本ずつ（一撃と持続を両方含む）。八方手裏剣は全周へ 16 本、大車輪は周回する", () => {
    for (const k of ["kunai", "shuriken"] as const) {
      expect(ULTIMATES[k], k).toHaveLength(PER_MOVESET);
      expect(ULTIMATES[k].some((u) => u.kind === "sustain"), `${k} に持続`).toBe(true);
    }
    const eight = ultimateDef("shuriken.eightfold");
    const act = eight?.kind === "instant" ? eight.acts[0] : undefined;
    expect(act?.kind === "volley" ? act.throw.count : 0, "16 本").toBe(16);
    expect(volleyBullet("shuriken.greatWheel")?.orbit, "大車輪は周回").toBeDefined();
    expect(volleyBullet("kunai.shadowStitch")?.key, "影縫いの陣はクナイを投げる（仮）").toBe("kunai");
  });
});
