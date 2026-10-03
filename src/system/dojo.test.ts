import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { FrameInput } from "../core/input";
import type { EliteKind } from "../core/state";
import { depthHpScale, enemyDef } from "../data/enemies";
import { DOJO } from "../data/tuning";
import { createEmptyProfile } from "../loot/types";
import { overlapsWall } from "./physics";
import { createDefaultSkillProfile } from "../skills/persistence";
import { damageEnemy, damagePlayerDot } from "./combat";
import { type DojoSession, createDojo, dojoMeterView, dojoSpawnPoints, resetDojoMeter, restoreDojoPlayer, setDojoConfig, setDojoTrialWeapon, stepDojo } from "./dojo";
import { type DojoConfig, defaultDojoConfig, dojoEliteOptions, dojoEnemyKeys } from "./dojoConfig";
import { fireEnemyBullet } from "./enemyTraits";
import { createSandboxState } from "./sandbox";
import { DUMMY_KEY } from "./specialRooms";
import { withInput } from "./testHelpers";

const CHASER = "skeleton";
const IDLE: FrameInput = withInput({});
/** 命中のヒットストップを越えて、ステップの後の処理まで回す秒 */
const PAST_HITSTOP = 0.3;
/** 時計の減りを比べるときに入れておく攻撃間隔の時計（1 ステップで尽きない長さ） */
const COOLDOWN_PROBE = 5;

function dojo(patch: Partial<DojoConfig> = {}): DojoSession {
  return createDojo({
    profile: createEmptyProfile(),
    skillProfile: createDefaultSkillProfile(),
    hitstopScale: 1,
    config: { ...defaultDojoConfig(), ...patch },
    trialMoveset: null,
    trialBase: null,
    trialKeystone: null,
  });
}

function run(session: DojoSession, sec: number, input: FrameInput = IDLE): void {
  const frames = Math.round(sec / FIXED_DT);
  for (let i = 0; i < frames; i++) stepDojo(session, input, FIXED_DT);
}

function ids(session: DojoSession): number[] {
  return session.state.enemies.map((e) => e.id);
}

describe("稽古の間の湧き", () => {
  it("作ると設定どおりの数・種類・深さで湧く", () => {
    const s = dojo({ enemy: CHASER, count: 5, depth: 10 });
    const def = enemyDef(CHASER);
    expect(s.state.enemies.length, "数").toBe(5);
    expect(s.state.depth, "深さ").toBe(10);
    for (const e of s.state.enemies) {
      expect(e.defKey, "種類").toBe(CHASER);
      expect(e.maxHp, "深さの生命").toBe(Math.round(def.hp * depthHpScale(10)));
      expect(e.revived, "撃破数・ドロップに数えない").toBe(true);
      expect(overlapsWall(s.state, e.body.pos.x, e.body.pos.y, e.body.radius), "壁に掛からない").toBe(false);
    }
  });

  it("修飾を付けるとエリートで湧く", () => {
    const s = dojo({ enemy: CHASER, count: 2, elite: "hasted" });
    expect(s.state.enemies.every((e) => e.elite === "hasted")).toBe(true);
  });

  it("並びは乱数を使わず毎回同じ点になる", () => {
    for (const formation of ["line", "ring", "scatter"] as const) {
      const a = dojo({ formation, count: 8 });
      const b = dojo({ formation, count: 8 });
      expect(dojoSpawnPoints(a.dojo.layout, a.dojo.config), formation).toEqual(dojoSpawnPoints(b.dojo.layout, b.dojo.config));
    }
  });

  it("どの並び・間合い・数でも敵は壁に掛からない", () => {
    for (const formation of ["line", "ring", "scatter"] as const) {
      for (const distance of DOJO.distanceOptions) {
        const s = dojo({ formation, distance, count: Math.max(...DOJO.countOptions) });
        for (const e of s.state.enemies) {
          expect(overlapsWall(s.state, e.body.pos.x, e.body.pos.y, e.body.radius), `${formation} ${distance}`).toBe(false);
        }
      }
    }
  });

  it("湧き直しの行を変えると湧き直し、他の行では湧き直さない", () => {
    const s = dojo({ enemy: CHASER, count: 3 });
    const first = ids(s);
    setDojoConfig(s, { ...s.dojo.config, tempo: 2, behavior: "still", undying: false });
    expect(ids(s), "攻めの速さ・動き・倒れないは今の敵のまま").toEqual(first);
    setDojoConfig(s, { ...s.dojo.config, count: 5 });
    expect(s.state.enemies.length).toBe(5);
    expect(ids(s).some((id) => first.includes(id)), "数を変えたら湧き直す").toBe(false);
    const second = ids(s);
    setDojoConfig(s, { ...s.dojo.config, depth: 20 });
    expect(s.state.depth).toBe(20);
    expect(ids(s).some((id) => second.includes(id)), "深さを変えたら湧き直す").toBe(false);
  });

  it("湧き直しが入りなら全滅の後に湧き直す", () => {
    const s = dojo({ enemy: DUMMY_KEY, count: 2, undying: false, respawn: true });
    const first = ids(s);
    for (const e of [...s.state.enemies]) damageEnemy(s.state, e, e.hp + 1, { x: 1, y: 0 }, 0);
    run(s, FIXED_DT);
    expect(s.state.enemies.filter((e) => e.hp > 0).length, "倒した直後は空").toBe(0);
    run(s, DOJO.respawnDelay + 0.1);
    expect(s.state.enemies.length).toBe(2);
    expect(ids(s).some((id) => first.includes(id))).toBe(false);
  });

  it("湧き直しが切りなら全滅のままにする", () => {
    const s = dojo({ enemy: DUMMY_KEY, count: 1, undying: false, respawn: false });
    for (const e of [...s.state.enemies]) damageEnemy(s.state, e, e.hp + 1, { x: 1, y: 0 }, 0);
    run(s, DOJO.respawnDelay + 0.5);
    expect(s.state.enemies.length).toBe(0);
  });
});

describe("稽古の間の敵の動き", () => {
  /** 自分の隣に立ち続けて、生命が減らず敵の弾・地面の攻撃が残らないか */
  function standsHarmless(enemy: string, behavior: "passive" | "still", sec: number, elite: EliteKind | null = null): string | null {
    const s = dojo({ enemy, count: 1, distance: Math.min(...DOJO.distanceOptions), behavior, undying: true, elite });
    const p = s.state.player;
    const frames = Math.round(sec / FIXED_DT);
    for (let i = 0; i < frames; i++) {
      const before = p.hp;
      stepDojo(s, IDLE, FIXED_DT);
      if (p.hp < before) return `生命が減った（${i} コマ目）`;
      if (s.state.projectiles.some((q) => q.owner === "enemy")) return `敵の弾が残った（${i} コマ目）`;
      if (s.state.hazards.some((h) => h.kind !== "boneWall")) return `地面の攻撃が残った（${i} コマ目）`;
    }
    const taken = dojoMeterView(s).takenHits;
    return taken > 0 ? `被弾が ${taken} 回` : null;
  }

  it("追うだけ・棒立ちでは、どの敵も隣に立った自分を攻撃しない", () => {
    const failures: string[] = [];
    for (const key of dojoEnemyKeys()) {
      for (const behavior of ["passive", "still"] as const) {
        const why = standsHarmless(key, behavior, 10);
        if (why) failures.push(`${key} ${behavior}: ${why}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("追うだけ・棒立ちでは、どの修飾を付けても攻撃しない", () => {
    const failures: string[] = [];
    for (const elite of dojoEliteOptions(CHASER)) {
      if (elite === null) continue;
      for (const behavior of ["passive", "still"] as const) {
        const why = standsHarmless(CHASER, behavior, 10, elite);
        if (why) failures.push(`${elite} ${behavior}: ${why}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("その場で攻める・棒立ちでは敵の位置が動かない", () => {
    for (const behavior of ["anchored", "still"] as const) {
      const s = dojo({ enemy: CHASER, count: 3, behavior });
      const start = s.state.enemies.map((e) => ({ ...e.body.pos }));
      run(s, 3);
      expect(s.state.enemies.map((e) => e.body.pos), behavior).toEqual(start);
    }
  });

  it("本気なら敵は寄ってくる", () => {
    const s = dojo({ enemy: CHASER, count: 1, behavior: "normal", distance: Math.max(...DOJO.distanceOptions) });
    const e = s.state.enemies[0];
    if (!e) throw new Error("敵が湧いていない");
    const p = s.state.player.body.pos;
    const before = Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y);
    run(s, 2);
    expect(Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y)).toBeLessThan(before);
  });

  it("攻めの速さは攻撃間隔の時計を倍で進める", () => {
    const fast = dojo({ enemy: CHASER, count: 1, behavior: "anchored", tempo: 2, distance: Math.max(...DOJO.distanceOptions) });
    const base = dojo({ enemy: CHASER, count: 1, behavior: "anchored", tempo: 1, distance: Math.max(...DOJO.distanceOptions) });
    // 湧きの演出の後、遠くで追っている間の時計の減りを比べる
    run(fast, 1);
    run(base, 1);
    const f = fast.state.enemies[0];
    const b = base.state.enemies[0];
    if (!f || !b) throw new Error("敵が湧いていない");
    const fBefore = (f.attackCooldown = COOLDOWN_PROBE);
    const bBefore = (b.attackCooldown = COOLDOWN_PROBE);
    stepDojo(fast, IDLE, FIXED_DT);
    stepDojo(base, IDLE, FIXED_DT);
    const fSpent = fBefore - f.attackCooldown;
    const bSpent = bBefore - b.attackCooldown;
    expect(bSpent).toBeGreaterThan(0);
    expect(fSpent).toBeCloseTo(bSpent * 2, 6);
  });
});

describe("稽古の間の修飾の行", () => {
  it("倒れないなら一撃で削り切っても倒れず、傷は計測に入る", () => {
    const s = dojo({ enemy: DUMMY_KEY, count: 1, undying: true });
    const e = s.state.enemies[0];
    if (!e) throw new Error("敵が湧いていない");
    const half = Math.floor(e.maxHp / 2);
    const big = e.maxHp * 3;
    damageEnemy(s.state, e, half, { x: 1, y: 0 }, 0, { kind: "melee" });
    run(s, PAST_HITSTOP);
    expect(e.hp, "次のステップで満タンへ").toBe(e.maxHp);
    damageEnemy(s.state, e, big, { x: 1, y: 0 }, 0, { kind: "melee" });
    run(s, PAST_HITSTOP);
    expect(s.state.enemies.filter((o) => o.hp > 0).length, "作り直して 1 体のまま").toBe(1);
    const view = dojoMeterView(s);
    expect(view.total, "超過ぶんも合計に入る").toBe(half + big);
    expect(view.hits).toBe(2);
    expect(view.byKind.melee).toBe(view.total);
  });

  it("無傷なら生命は減らないが被弾は数える", () => {
    const s = dojo({ enemy: DUMMY_KEY, invincible: true });
    const p = s.state.player;
    const hp = p.hp;
    fireEnemyBullet(s.state, { pos: { x: p.body.pos.x + 4, y: p.body.pos.y }, dir: { x: -1, y: 0 }, speed: 60, damage: 10, color: "#fff" });
    run(s, 0.3);
    expect(p.hp).toBe(hp);
    const view = dojoMeterView(s);
    expect(view.takenHits).toBe(1);
    expect(view.taken).toBeGreaterThan(0);
  });

  it("無傷でなければ被弾で生命が減り、計測にも入る", () => {
    const s = dojo({ enemy: DUMMY_KEY, invincible: false });
    const p = s.state.player;
    const hp = p.hp;
    fireEnemyBullet(s.state, { pos: { x: p.body.pos.x + 4, y: p.body.pos.y }, dir: { x: -1, y: 0 }, speed: 60, damage: 10, color: "#fff" });
    run(s, 0.3);
    expect(p.hp).toBeLessThan(hp);
    expect(dojoMeterView(s).taken).toBeCloseTo(hp - p.hp, 6);
  });

  it("倒れて満タンに戻る一撃も、受けた量のまま数える", () => {
    const s = dojo({ enemy: DUMMY_KEY, invincible: false });
    const p = s.state.player;
    p.hp = 1;
    fireEnemyBullet(s.state, { pos: { x: p.body.pos.x + 4, y: p.body.pos.y }, dir: { x: -1, y: 0 }, speed: 60, damage: 10, color: "#fff" });
    run(s, 0.3);
    expect(p.hp, "箱庭では倒れず満タンへ").toBe(p.maxHp);
    const view = dojoMeterView(s);
    expect(view.takenHits).toBe(1);
    expect(view.taken, "残っていた生命ではなく受けた量").toBeGreaterThan(1);
  });

  it("継続ダメージは 1 発ずつ数え、生命の代償は数えない", () => {
    const s = dojo({ enemy: DUMMY_KEY });
    const p = s.state.player;
    damagePlayerDot(s.state, 3);
    damagePlayerDot(s.state, 4);
    p.hp -= 5;
    run(s, FIXED_DT);
    const view = dojoMeterView(s);
    expect(view.taken).toBe(7);
    expect(view.takenHits).toBe(2);
  });

  it("無傷でも生命の代償は戻さない", () => {
    const s = dojo({ enemy: DUMMY_KEY, invincible: true });
    const p = s.state.player;
    const hp = p.hp;
    p.hp -= 5;
    run(s, FIXED_DT);
    expect(p.hp).toBe(hp - 5);
    expect(dojoMeterView(s).takenHits).toBe(0);
  });

  it("気力・奥義ゲージが尽きないなら毎ステップ満たす", () => {
    const s = dojo({ infiniteMana: true, infiniteEnergy: true });
    const p = s.state.player;
    p.mana = 0;
    p.energy = 0;
    run(s, FIXED_DT);
    expect(p.mana).toBe(s.state.stats.maxMana);
    expect(p.energy).toBe(p.maxEnergy);
  });

  it("時の流れ 0.5 倍では state.time の進みが半分", () => {
    const s = dojo({ timeScale: 0.5 });
    run(s, 1);
    expect(s.state.time).toBeCloseTo(0.5, 6);
  });

  it("計測を始めからにすると空になる", () => {
    const s = dojo({ enemy: DUMMY_KEY });
    const e = s.state.enemies[0];
    if (!e) throw new Error("敵が湧いていない");
    damageEnemy(s.state, e, 5, { x: 1, y: 0 }, 0, { kind: "melee" });
    run(s, PAST_HITSTOP);
    expect(dojoMeterView(s).total).toBe(5);
    resetDojoMeter(s);
    expect(dojoMeterView(s).total).toBe(0);
  });
});

describe("与えた傷の記録（damageTap）", () => {
  it("出どころを継続・スキル・近接・射撃・付帯に分ける", () => {
    const s = dojo({ enemy: DUMMY_KEY, undying: true });
    const e = s.state.enemies[0];
    if (!e) throw new Error("敵が湧いていない");
    const dir = { x: 1, y: 0 };
    damageEnemy(s.state, e, 1, dir, 0, { kind: "melee", silent: true });
    damageEnemy(s.state, e, 2, dir, 0, { kind: "ranged", skill: true });
    damageEnemy(s.state, e, 3, dir, 0, { kind: "melee", crit: true });
    damageEnemy(s.state, e, 4, dir, 0, { kind: "ranged" });
    damageEnemy(s.state, e, 5, dir, 0);
    expect(s.state.damageTap?.map((t) => [t.kind, t.amount, t.crit])).toEqual([
      ["dot", 1, false],
      ["skill", 2, false],
      ["melee", 3, true],
      ["ranged", 4, false],
      ["other", 5, false],
    ]);
  });

  it("本編の state には付かない", () => {
    const s = dojo();
    expect(s.state.damageTap).toEqual([]);
    const plain = createSandboxState({ profile: createEmptyProfile(), skillProfile: createDefaultSkillProfile(), map: s.state.map, start: { x: 0, y: 0 }, seed: 1, hitstopScale: 1 });
    expect(plain.damageTap).toBeUndefined();
    expect(plain.hurtTap).toBeUndefined();
    expect(s.state.hurtTap).toEqual([]);
  });
});

describe("稽古の間の台", () => {
  it("手水鉢に触れると生命・気力・奥義ゲージが満ちる", () => {
    const s = dojo();
    const p = s.state.player;
    p.hp = 1;
    p.mana = 0;
    p.energy = 0;
    p.body.pos = { ...s.dojo.layout.spots.spring };
    run(s, FIXED_DT);
    expect(p.hp).toBe(p.maxHp);
    expect(p.mana).toBe(s.state.stats.maxMana);
    expect(p.energy).toBe(p.maxEnergy);
    expect(s.state.sfx).toContain("fountainHeal");
  });

  it("手水鉢は満ちていれば何もせず、使った後は間を置く", () => {
    const s = dojo();
    const p = s.state.player;
    restoreDojoPlayer(s);
    p.body.pos = { ...s.dojo.layout.spots.spring };
    run(s, FIXED_DT);
    expect(s.dojo.springTimer, "満ちていれば間を置かない").toBe(0);
    p.hp = 1;
    run(s, FIXED_DT);
    expect(s.dojo.springTimer).toBeGreaterThan(0);
    p.hp = 1;
    run(s, FIXED_DT);
    expect(p.hp, "間の内は満たさない").toBe(1);
  });

  it("台の近くで決定を押すと開く", () => {
    for (const spot of ["rack", "board", "exit"] as const) {
      const s = dojo();
      s.state.player.body.pos = { ...s.dojo.layout.spots[spot] };
      expect(stepDojo(s, IDLE, FIXED_DT)).toEqual({ kind: "none" });
      expect(s.dojo.near).toBe(spot);
      expect(stepDojo(s, withInput({ interactPressed: true }), FIXED_DT)).toEqual({ kind: "open", spot });
    }
  });

  it("台から離れると near は null", () => {
    const s = dojo();
    stepDojo(s, IDLE, FIXED_DT);
    expect(s.dojo.near).toBeNull();
  });

  it("生命・気力・奥義を満たす", () => {
    const s = dojo();
    const p = s.state.player;
    p.hp = 1;
    p.mana = 0;
    p.energy = 0;
    restoreDojoPlayer(s);
    expect(p.hp).toBe(p.maxHp);
    expect(p.mana).toBe(s.state.stats.maxMana);
    expect(p.energy).toBe(p.maxEnergy);
  });
});

describe("稽古の間の武器の試し", () => {
  it("銃の家系は拠点で選んだ器の弾を持ち込み、器を替えて試せる", () => {
    const session = createDojo({
      profile: createEmptyProfile(),
      skillProfile: createDefaultSkillProfile(),
      hitstopScale: 1,
      config: defaultDojoConfig(),
      trialMoveset: "longarm",
      trialBase: "rifle",
      trialKeystone: null,
    });
    expect(session.state.stats.bullet, "持ち込んだ小銃").toBe("rifle");
    run(session, FIXED_DT);
    expect(session.state.stats.bullet, "ステップ後も小銃").toBe("rifle");
    setDojoTrialWeapon(session, "longarm", "tripleCrossbow");
    run(session, FIXED_DT);
    expect(session.state.stats.bullet, "三連弩に替える").toBe("tripleCrossbow");
    setDojoTrialWeapon(session, null, "rifle");
    expect(session.dojo.trialBase, "装備のままでは器を持たない").toBeNull();
  });
});
