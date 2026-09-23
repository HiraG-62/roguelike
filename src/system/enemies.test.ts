import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { dist } from "../core/vec";
import { ENEMIES, enemiesForDepth, enemyDef } from "../data/enemies";
import { ENEMY_AI } from "../data/tuning";
import { damageEnemy } from "./combat";
import { enemyTelegraph, moveEnemy, updateEnemies } from "./enemies";
import { updateHazards } from "./hazards";
import { updateProjectiles } from "./projectiles";
import { interceptEnemyDamage } from "./elites";
import { reviveCorpse } from "./enemyTraits";
import { isStaggered } from "./poise";
import { applyStatus, hasStatus, updateStatusEffects } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";

const STEPS = 500;
const HUGE_HP = 1_000_000;

describe("追加敵の behavior", () => {
  for (const def of ENEMIES) {
    it(`${def.key} が 500 ステップ例外なく動く`, () => {
      const state = arena(11);
      state.player.maxHp = HUGE_HP;
      state.player.hp = HUGE_HP;
      state.depth = 4;
      placeEnemy(state, def.key, 50, 10);
      placeEnemy(state, def.key, -40, -20);
      expect(() => {
        for (let i = 0; i < STEPS; i++) {
          step(state, withInput({ move: { x: i % 80 < 40 ? 1 : -1, y: 0 }, attackPressed: i % 25 === 0 }), FIXED_DT);
        }
      }).not.toThrow();
      expect(state.status).toBe("playing");
    });
  }

  it("ボスは通常の抽選に出ない", () => {
    for (let d = 1; d <= 12; d++) expect(enemiesForDepth(d).some((e) => e.boss)).toBe(false);
  });
});

describe("knight", () => {
  it("正面からの近接は盾で無効、背後からは通る", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 14);
    k.facing = { x: -1, y: 0 };
    // プレイヤー(左) → knight(右) へ振る攻撃 = 正面
    expect(interceptEnemyDamage(state, k, 10, { x: 1, y: 0 }, "melee")).toBe(0);
    expect(state.texts.some((t) => t.text === "ブロック")).toBe(true);
    // 背後から
    expect(interceptEnemyDamage(state, k, 10, { x: -1, y: 0 }, "melee")).toBe(10);
  });

  it("damageEnemy 経由の近接も正面は無効、背後は通る", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 14);
    k.facing = { x: -1, y: 0 };
    const hp = k.hp;
    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(k.hp).toBe(hp);
    damageEnemy(state, k, 10, { x: -1, y: 0 }, 0, { kind: "melee" });
    expect(k.hp).toBe(hp - 10);
  });

  it("guardBreak（カウンター相当）なら正面の盾を無視してダメージが通り、GUARD BREAK 表示（確定の怯みにはならない）", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 14);
    k.facing = { x: -1, y: 0 };
    const hp = k.hp;
    // 通常の正面攻撃は防がれる
    expect(interceptEnemyDamage(state, k, 10, { x: 1, y: 0 }, "melee")).toBe(0);
    // guardBreak なら通る
    expect(interceptEnemyDamage(state, k, 10, { x: 1, y: 0 }, "melee", true)).toBe(10);
    expect(state.texts.some((t) => t.text === "ガードブレイク")).toBe(true);

    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee", guardBreak: true });
    expect(k.hp).toBe(hp - 10);
    expect(isStaggered(k), "怯み値なしのカウンターでは怯まない").toBe(false);
  });

  it("正面から来た弾は消えてダメージを受けない", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 30);
    k.facing = { x: -1, y: 0 };
    const before = k.hp;
    const p = state.player.body.pos;
    state.projectiles.push({
      id: 999,
      owner: "player",
      pos: { x: p.x + 30 - k.body.radius - 1, y: p.y },
      vel: { x: 300, y: 0 },
      radius: 2,
      damage: 5,
      life: 1,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    updateProjectiles(state, FIXED_DT);
    expect(k.hp).toBe(before);
    expect(state.projectiles.length).toBe(0);
  });
});

describe("bomber", () => {
  it("置いた爆弾は fuse 後に爆発し、範囲内のプレイヤーにダメージ", () => {
    const state = arena();
    const b = placeEnemy(state, "bomber", 60);
    b.phase = "chase";
    b.attackCooldown = 0;
    // 投げる → fuse ぶん待つ
    let exploded = false;
    for (let i = 0; i < 400 && !exploded; i++) {
      // プレイヤーを爆弾の上に置き続ける
      const bomb = state.hazards.find((h) => h.kind === "bomb");
      if (bomb) state.player.body.pos = { ...bomb.pos };
      const hpBefore = state.player.hp;
      updateEnemies(state, FIXED_DT);
      updateHazards(state, FIXED_DT);
      if (state.player.hp < hpBefore) exploded = true;
    }
    expect(exploded).toBe(true);
  });

  it("倒すと持っていた爆弾がその場に落ち、deathFuse 秒の予告の後に爆ぜる（倒した瞬間は無害）", () => {
    const state = arena();
    const b = placeEnemy(state, "bomber", 20);
    const hp = state.player.hp;
    damageEnemy(state, b, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(state.player.hp, "倒した瞬間は無害").toBe(hp);
    const bomb = state.hazards.find((h) => h.kind === "bomb");
    expect(bomb?.time, "予告の長さ").toBeCloseTo(ENEMY_AI.bomber.deathFuse, 5);
    const fuseSteps = Math.ceil(ENEMY_AI.bomber.deathFuse / FIXED_DT) + 1;
    for (let i = 0; i < fuseSteps; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp, "予告の後に爆ぜる").toBeLessThan(hp);
    expect(ENEMY_AI.bomber.radius).toBeGreaterThan(20);
  });
});

describe("wisp", () => {
  it("死亡直後は無ダメで、deathExplodeFuse 後にテレグラフの爆発で範囲内にダメージ", () => {
    const state = arena();
    const w = placeEnemy(state, "wisp", 20);
    const wispPos = { ...w.body.pos };
    state.player.body.pos = { ...wispPos };
    const hpBeforeDeath = state.player.hp;
    damageEnemy(state, w, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);

    // 死亡直後: まだテレグラフ中でダメージなし
    expect(state.player.hp).toBe(hpBeforeDeath);
    expect(state.hazards.some((h) => h.kind === "bomb")).toBe(true);

    const fuseSteps = Math.floor(ENEMY_AI.wisp.deathExplodeFuse / FIXED_DT) - 2;
    for (let i = 0; i < fuseSteps; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBe(hpBeforeDeath);

    for (let i = 0; i < 5; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBeLessThan(hpBeforeDeath);
  });
});

describe("laserEye", () => {
  it("チャージ中は動かず、照射でプレイヤーに当たる", () => {
    const state = arena();
    const l = placeEnemy(state, "laserEye", 80);
    Object.assign(l, { phase: "chase", attackCooldown: 0 });
    updateEnemies(state, FIXED_DT);
    expect(l.phase).toBe("windup");
    const pos = { ...l.body.pos };
    const hp = state.player.hp;
    for (let i = 0; i < 100; i++) {
      updateEnemies(state, FIXED_DT);
      updateHazards(state, FIXED_DT);
      if (l.phase === "windup") expect(l.body.pos).toEqual(pos);
    }
    expect(state.player.hp).toBeLessThan(hp);
  });
});

// -----------------------------------------------------------------------------
// 量産した敵（docs/ideas/enemies.md）。step 全体ではなく敵まわりの更新だけを回し、他の仕組みの変化に左右されないようにする
// -----------------------------------------------------------------------------

/** 敵まわりの更新を n ステップ（状態異常 → 敵 → 弾 → 地面の攻撃） */
function tickEnemies(state: GameState, n = 1): void {
  for (let i = 0; i < n; i++) {
    updateStatusEffects(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    updateProjectiles(state, FIXED_DT);
    updateHazards(state, FIXED_DT);
    state.player.invulnTimer = Math.max(0, state.player.invulnTimer - FIXED_DT);
  }
}

/** 攻撃できる状態にして置く */
function readyEnemy(state: GameState, key: string, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.phase = "chase";
  e.attackCooldown = 0;
  return e;
}

/** 予備動作が終わるまで回す（上限つき） */
function runWindup(state: GameState, e: Enemy, limit = 600): void {
  for (let i = 0; i < limit && e.phase === "windup"; i++) tickEnemies(state);
}

function kill(state: GameState, e: Enemy): void {
  damageEnemy(state, e, 999_999, { x: 1, y: 0 }, 0);
  updateEnemies(state, FIXED_DT);
}

const ORIGINAL_KEYS: ReadonlySet<string> = new Set([
  "slime",
  "eye",
  "boar",
  "knight",
  "bomber",
  "laserEye",
  "golem",
  "bat",
  "wisp",
  "kingSlime",
  "boneLord",
]);
const WAVE2_KEYS = ENEMIES.filter((d) => !ORIGINAL_KEYS.has(d.key)).map((d) => d.key);

describe("量産した敵: 全体", () => {
  it("量産した敵は 30 種以上ある", () => {
    expect(WAVE2_KEYS.length, "敵の種類").toBeGreaterThanOrEqual(30);
  });

  it.each(WAVE2_KEYS)("%s が敵の更新だけで 900 ステップ例外なく動き、倒せる", (key) => {
    const state = arena(11);
    state.player.maxHp = HUGE_HP;
    state.player.hp = HUGE_HP;
    state.depth = 4;
    const room = state.rooms[0];
    if (room) room.locked = true;
    placeEnemy(state, key, 50, 10);
    placeEnemy(state, key, -40, -20);
    expect(() => {
      for (let i = 0; i < 900; i++) {
        state.player.body.pos.x += i % 80 < 40 ? 0.5 : -0.5;
        tickEnemies(state);
      }
    }).not.toThrow();
    // 氷の鎧（氷柱）が残っていても、柱から先に倒れるので数回で部屋が空になる
    for (let round = 0; round < 3; round++) {
      for (const e of [...state.enemies]) damageEnemy(state, e, 999_999, { x: 1, y: 0 }, 0);
      updateEnemies(state, FIXED_DT);
    }
    expect(state.enemies.length, "倒した後に残った敵").toBe(0);
  });

  it("抽選に出る敵はすべてボス以外で、付き物（minDepth 99）は出ない", () => {
    const pool = enemiesForDepth(20);
    expect(pool.some((d) => d.key === "twinSister" || d.key === "icePillar" || d.key === "hollowWraith")).toBe(false);
    expect(pool.some((d) => d.lairMaster), "部屋主は通常の抽選に混ざる").toBe(true);
  });
});

describe("自爆（導火鼠・結晶ダニ）", () => {
  it("予備動作中は影が出るだけで無害、炸裂で当たり、自爆は死骸も報酬も残さない", () => {
    const state = arena();
    const m = readyEnemy(state, "crystalMite", 15);
    const hp = state.player.hp;
    const mana = state.player.mana;
    tickEnemies(state);
    expect(m.phase).toBe("windup");
    expect(state.hazards.some((h) => h.kind === "landing"), "予告の影").toBe(true);
    while (m.phase === "windup") {
      expect(state.player.hp, "予告中は無害").toBe(hp);
      tickEnemies(state);
    }
    tickEnemies(state);
    expect(state.player.hp).toBeLessThan(hp);
    expect(state.enemies.includes(m), "自爆した本体は消える").toBe(false);
    expect(state.corpses.length, "死骸を残さない").toBe(0);
    expect(state.player.mana, "自爆ではマナは戻らない").toBe(mana);
    expect(state.kills).toBe(0);
  });

  it("冷気で予備動作が延びても影は炸裂まで残り、押し出されれば影も付いて動く", () => {
    const state = arena();
    const m = readyEnemy(state, "fuseRat", 20);
    m.hp = 9999;
    tickEnemies(state);
    expect(m.phase).toBe("windup");
    applyStatus(state, { kind: "enemy", enemy: m }, { kind: "chill", stacks: 4, duration: 30, potency: 0.5 }, "player");
    m.body.pos = { x: m.body.pos.x, y: m.body.pos.y + 10 };
    tickEnemies(state);
    const landing = state.hazards.find((h) => h.kind === "landing");
    expect(landing?.pos, "影は本体の位置に付いて動く").toEqual(m.body.pos);
    for (let i = 0; i < 600 && m.phase === "windup"; i++) {
      expect(state.hazards.some((h) => h.kind === "landing"), `${i} ステップ目: 予備動作の間は影がある`).toBe(true);
      tickEnemies(state);
    }
    expect(m.hp, "最後は自爆する").toBe(0);
  });

  it("結晶ダニを倒すとマナが戻る", () => {
    const state = arena();
    const m = placeEnemy(state, "crystalMite", 40);
    state.player.mana = 0;
    kill(state, m);
    expect(state.player.mana).toBeGreaterThan(0);
  });
});

describe("残像打ち", () => {
  it("delay 秒前の位置を狙う。予告中は無害で、動いていれば当たらず、留まれば当たる", () => {
    const state = arena();
    const e = placeEnemy(state, "echoStriker", 120);
    e.phase = "chase";
    e.attackCooldown = 99;
    const a = { ...state.player.body.pos };
    tickEnemies(state, Math.ceil(ENEMY_AI.echoStriker.delay / FIXED_DT) + 10);
    // 過去の位置 a から離れる
    state.player.body.pos = { x: a.x, y: a.y + 70 };
    e.attackCooldown = 0;
    tickEnemies(state);
    expect(e.phase).toBe("windup");
    expect(dist(e.ai?.target ?? { x: 0, y: 0 }, a), "狙いは過去の位置").toBeLessThan(2);
    const hp = state.player.hp;
    runWindup(state, e);
    tickEnemies(state, 3);
    expect(state.player.hp, "動いていれば当たらない").toBe(hp);

    // 留まる: 過去の位置 = 今の位置
    const b = { ...state.player.body.pos };
    e.phase = "chase";
    e.attackCooldown = 99;
    tickEnemies(state, Math.ceil(ENEMY_AI.echoStriker.delay / FIXED_DT) + 10);
    state.player.body.pos = { ...b };
    e.attackCooldown = 0;
    tickEnemies(state);
    runWindup(state, e);
    tickEnemies(state, 3);
    expect(state.player.hp, "留まっていると当たる").toBeLessThan(hp);
  });
});

describe("沈黙の修道士", () => {
  it("足元の円の中に居続けると沈黙が付く", () => {
    const state = arena();
    const e = readyEnemy(state, "silencer", 100);
    const p = { ...state.player.body.pos };
    tickEnemies(state);
    expect(e.phase).toBe("windup");
    expect(state.hazards.some((h) => h.kind === "landing")).toBe(true);
    runWindup(state, e);
    state.player.body.pos = p;
    tickEnemies(state);
    expect(hasStatus(state.player.status, "silence")).toBe(true);
  });
});

describe("霜砕き", () => {
  it("プレイヤーが冷えていなければ攻撃を始めず、冷気が付くと予備動作に入る", () => {
    const state = arena();
    const e = readyEnemy(state, "frostCrusher", 30);
    tickEnemies(state);
    expect(e.phase).toBe("chase");
    applyStatus(state, { kind: "player" }, { kind: "chill", stacks: 1, duration: 3, potency: 0 }, "enemy");
    tickEnemies(state);
    expect(e.phase).toBe("windup");
    expect(enemyTelegraph(e, enemyDef("frostCrusher"))).toEqual({ kind: "ring", radius: ENEMY_AI.frostCrusher.ringRadius });
  });
});

describe("マナ喰い", () => {
  it("噛まれるとマナを奪われ、倒すと奪われた量の returnMul 倍が戻る", () => {
    const state = arena();
    const e = readyEnemy(state, "manaLeech", 12);
    state.player.mana = 50;
    const hp = state.player.hp;
    for (let i = 0; i < 300 && state.player.hp === hp; i++) tickEnemies(state);
    expect(state.player.hp).toBeLessThan(hp);
    expect(state.player.mana).toBe(50 - ENEMY_AI.manaLeech.steal);
    expect(e.stolenMana).toBe(ENEMY_AI.manaLeech.steal);
    const before = state.player.mana;
    kill(state, e);
    // 撃破の通常のマナ回収（MANA.onKill）に、奪われた量の returnMul 倍が上乗せされる
    const returned = ENEMY_AI.manaLeech.steal * ENEMY_AI.manaLeech.returnMul;
    expect(state.player.mana - before, "取り返したマナ").toBeGreaterThanOrEqual(returned);
  });
});

describe("死骸と骨拾い・墓守の鐘", () => {
  it("倒した敵は死骸を残し、階が変わると消える", () => {
    const state = arena();
    kill(state, placeEnemy(state, "slime", 60));
    expect(state.corpses.length).toBe(1);
    state.depth += 1;
    updateEnemies(state, FIXED_DT);
    expect(state.corpses.length).toBe(0);
  });

  it("骨拾いは死骸へ向かって食べ、HP と体が大きくなる", () => {
    const state = arena();
    const s = placeEnemy(state, "scavenger", 60);
    kill(state, placeEnemy(state, "slime", 85));
    s.phase = "chase";
    s.attackCooldown = 99;
    const maxHp = s.maxHp;
    for (let i = 0; i < 400 && (s.ai?.counter ?? 0) === 0; i++) tickEnemies(state);
    expect(s.ai?.counter, "育った段").toBe(1);
    expect(s.maxHp).toBeGreaterThan(maxHp);
    expect(s.body.radius).toBeGreaterThan(enemyDef("scavenger").radius);
    expect(state.corpses.length, "食べた死骸は消える").toBe(0);
  });

  it("墓守の鐘は rings 回鳴ると死骸を 1 体蘇らせる", () => {
    const state = arena();
    const bell = readyEnemy(state, "graveBell", 60);
    kill(state, placeEnemy(state, "slime", -60));
    const corpse = state.corpses[0];
    if (corpse) corpse.time = 999;
    let revived = false;
    for (let i = 0; i < 2000 && !revived; i++) {
      tickEnemies(state);
      revived = state.enemies.some((e) => e.defKey === "slime");
    }
    expect(revived).toBe(true);
    expect(bell.hp).toBeGreaterThan(0);
    expect(state.corpses.length).toBe(0);
  });

  it("鐘の蘇生体は倒しても撃破数・ドロップ・死骸を出さない（蘇生と撃破の繰り返しで稼げない）", () => {
    const state = arena();
    // 金色スライムはドロップ確定（dropChance 1）なので、落ちないことを確かめられる
    kill(state, placeEnemy(state, "goldSlime", -60));
    const corpse = state.corpses[0];
    if (!corpse) throw new Error("no corpse");
    const revived = reviveCorpse(state, corpse);
    expect(revived.revived).toBe(true);
    revived.phase = "chase";
    const kills = state.kills;
    const items = state.floorItems.length;
    kill(state, revived);
    expect(state.kills, "撃破数は増えない").toBe(kills);
    expect(state.floorItems.length, "ドロップしない").toBe(items);
    expect(state.corpses.length, "死骸を残さない").toBe(0);
  });
});

describe("取り巻き: 群れの長", () => {
  it("目覚めると取り巻きを連れ、長が倒れると取り巻きは怯える", () => {
    const state = arena();
    const leader = readyEnemy(state, "packLeader", 80);
    leader.attackCooldown = 99;
    tickEnemies(state);
    const wolves = state.enemies.filter((e) => e.leaderId === leader.id);
    expect(wolves.length).toBe(enemyDef("packLeader").pack?.count);
    tickEnemies(state, 60);
    kill(state, leader);
    expect(wolves.every((w) => hasStatus(w.status, "fear")), "長を失った群れは怯える").toBe(true);
  });

  it("遠吠えで取り巻きが一斉に予備動作に入る", () => {
    const state = arena();
    const leader = readyEnemy(state, "packLeader", 60);
    leader.attackCooldown = 99;
    tickEnemies(state, 60);
    for (const w of state.enemies) if (w !== leader) w.attackCooldown = 99;
    leader.attackCooldown = 0;
    tickEnemies(state);
    runWindup(state, leader);
    const wolves = state.enemies.filter((e) => e.leaderId === leader.id);
    expect(wolves.length).toBeGreaterThan(0);
    expect(wolves.every((w) => w.phase === "windup"), "号令で全員が振りかぶる").toBe(true);
  });
});

describe("双子の影", () => {
  it("片方を倒して猶予内にもう片方を倒さないと、倒した方が蘇る", () => {
    const state = arena();
    const a = placeEnemy(state, "twinShade", 80);
    a.phase = "chase";
    tickEnemies(state, 60);
    const b = state.enemies.find((e) => e.defKey === "twinShade" && e !== a);
    expect(b?.leaderId).toBe(a.id);
    expect(a.leaderId).toBe(b?.id);
    kill(state, a);
    tickEnemies(state, Math.ceil(ENEMY_AI.twinShade.reviveTime / FIXED_DT) + 5);
    expect(state.enemies.filter((e) => e.defKey === "twinShade").length, "蘇った").toBe(2);
  });

  it("2 体を同時に倒せば蘇らない", () => {
    const state = arena();
    const a = placeEnemy(state, "twinShade", 80);
    a.phase = "chase";
    tickEnemies(state, 60);
    for (const e of [...state.enemies]) damageEnemy(state, e, 999_999, { x: 1, y: 0 }, 0);
    tickEnemies(state, Math.ceil(ENEMY_AI.twinShade.reviveTime / FIXED_DT) + 5);
    expect(state.enemies.length).toBe(0);
  });
});

describe("再配色種と性質", () => {
  it("金色スライムは攻撃せずに逃げ、寿命で消える（撃破にならず報酬もない）", () => {
    const state = arena();
    const g = placeEnemy(state, "goldSlime", 40);
    g.phase = "chase";
    const before = dist(g.body.pos, state.player.body.pos);
    tickEnemies(state, 30);
    expect(dist(g.body.pos, state.player.body.pos), "離れていく").toBeGreaterThan(before);
    tickEnemies(state, Math.ceil((enemyDef("goldSlime").timid?.lifetime ?? 0) / FIXED_DT) + 5);
    expect(state.enemies.length).toBe(0);
    expect(state.kills).toBe(0);
    expect(state.floorItems.length).toBe(0);
  });

  it("双眼は 2 発、氷眼は 3 発を扇に撃つ", () => {
    const cases: readonly (readonly [string, number])[] = [
      ["twinEye", 2],
      ["frostEye", 3],
    ];
    for (const [key, count] of cases) {
      const state = arena();
      const e = readyEnemy(state, key, 100);
      tickEnemies(state);
      runWindup(state, e);
      expect(state.projectiles.filter((p) => p.owner === "enemy").length, key).toBe(count);
    }
  });

  it("三叉光線眼は中央 → 左 → 右の 3 本を順に撃つ", () => {
    const state = arena();
    readyEnemy(state, "triLaser", 90);
    const seen = new Set<number>();
    for (let i = 0; i < 260; i++) {
      tickEnemies(state);
      for (const h of state.hazards) if (h.kind === "laser") seen.add(h.id);
    }
    expect(seen.size).toBe(3);
  });

  it("飛ぶ本は倒れるとページ（弾）を 3 方向へ散らし、炎スライムは時限爆発を残す", () => {
    const state = arena();
    kill(state, placeEnemy(state, "flyingBook", 60));
    expect(state.projectiles.filter((p) => p.owner === "enemy").length).toBe(3);
    kill(state, placeEnemy(state, "fireSlime", -60));
    expect(state.hazards.some((h) => h.kind === "bomb")).toBe(true);
  });

  it("骨猪は突進の終わりに骨の壁を残す", () => {
    const state = arena();
    const b = placeEnemy(state, "boneBoar", 40);
    b.phase = "strike";
    b.phaseTimer = FIXED_DT / 2;
    b.strikeDir = { x: -1, y: 0 };
    updateEnemies(state, FIXED_DT);
    expect(state.hazards.some((h) => h.kind === "boneWall")).toBe(true);
  });

  it("黒鉄騎士は盾を割られると脆弱になって逃げる", () => {
    const state = arena();
    const k = placeEnemy(state, "blackKnight", 14);
    k.facing = { x: -1, y: 0 };
    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee", guardBreak: true });
    expect(hasStatus(k.status, "vulnerable")).toBe(true);
    expect(hasStatus(k.status, "fear")).toBe(true);
  });

  it("盾は EnemyDef.blocks で決まる（槍兵は防がない）", () => {
    const state = arena();
    const s = placeEnemy(state, "spearman", 14);
    s.facing = { x: -1, y: 0 };
    expect(interceptEnemyDamage(state, s, 10, { x: 1, y: 0 }, "melee")).toBe(10);
  });
});

describe("部屋主", () => {
  it("喰らう宝箱は舌（レーザーの予告）と噛みつき（線の予告）を交互に使う", () => {
    const state = arena();
    const m = readyEnemy(state, "mimic", 50);
    const def = enemyDef("mimic");
    tickEnemies(state);
    expect(m.phase).toBe("windup");
    const first = enemyTelegraph(m, def)?.kind;
    runWindup(state, m);
    for (let i = 0; i < 400 && m.phase !== "windup"; i++) {
      m.attackCooldown = 0;
      tickEnemies(state);
    }
    const second = enemyTelegraph(m, def)?.kind;
    expect(new Set([first, second])).toEqual(new Set(["laser", "line"]));
  });

  it("鎧の中身は HP が半分を切ると鎧が割れて亡霊になり、しばらく怯む", () => {
    const state = arena();
    const a = placeEnemy(state, "hollowArmor", 60);
    a.phase = "chase";
    damageEnemy(state, a, Math.ceil(a.maxHp / 2) + 1, { x: -1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(a.defKey).toBe("hollowWraith");
    expect(isStaggered(a)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 敵側から見たシナジーの穴（docs/ideas/enemies.md 7 章 H2 / H4）
// -----------------------------------------------------------------------------

describe("シナジーの穴: 鬼火の実体化（H2）", () => {
  /** 右へ歩かせ続けたときの到達 x */
  function walkRight(chilled: boolean): number {
    const state = arena();
    const w = placeEnemy(state, "wisp", 0, 0);
    if (chilled) applyStatus(state, { kind: "enemy", enemy: w }, { kind: "chill", stacks: 1, duration: 99, potency: 0 }, "player");
    for (let i = 0; i < 300; i++) moveEnemy(state, w, enemyDef("wisp"), 8, 0);
    return w.body.pos.x;
  }

  it("冷気の間は壁を抜けられず、冷気が無ければ壁を抜けてさらに先へ進む", () => {
    expect(walkRight(false)).toBeGreaterThan(walkRight(true));
  });
});

describe("シナジーの穴: 沈黙で詠唱が止まる（H4）", () => {
  it("予備動作の途中で沈黙すると、詠唱する敵（残像打ち）は攻撃を取り消す", () => {
    const state = arena();
    const e = readyEnemy(state, "echoStriker", 120);
    tickEnemies(state);
    expect(e.phase).toBe("windup");
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "silence", stacks: 1, duration: 3, potency: 0 }, "player");
    tickEnemies(state);
    expect(e.phase).toBe("chase");
    expect(e.attackCooldown).toBeGreaterThan(0);
  });

  it("光線眼もチャージ中の沈黙でレーザーを撃たない", () => {
    const state = arena();
    const l = readyEnemy(state, "laserEye", 80);
    tickEnemies(state);
    expect(l.phase).toBe("windup");
    applyStatus(state, { kind: "enemy", enemy: l }, { kind: "silence", stacks: 1, duration: 3, potency: 0 }, "player");
    tickEnemies(state, 90);
    expect(state.hazards.some((h) => h.kind === "laser")).toBe(false);
  });
});
