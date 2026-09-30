import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import type { GameState, HiddenRoom, Merchant, Ware, WareKind } from "../core/state";
import { ULTIMATES } from "../data/ultimates";
import { placeEnemy, arena, slayFloorLord } from "../system/testHelpers";
import type { BoonGrade } from "../system/boonGrade";
import { BOONS, BOON_KEYS, type BoonChoice, type BoonKey } from "../system/boons";
import { HIDDEN_DOOR_GIVE_UP, botInput, chooseTargetRoomIndex, createBotState, pickBoonIndex, shouldDrinkFlask, shouldPressUltimate } from "./bot";
import { isZero } from "../core/vec";
import { buildFloor } from "../system/floor";
import { planHidden } from "../system/hiddenRoom";
import { setupFloorLordRoom } from "../system/floorLord";

/** bot が待ち終えた後の提示時間（BOON_CHOICE_WAIT 0.5 秒より長く） */
const WAITED = 1;

function choiceOf(options: BoonKey[], grades: BoonGrade[]): BoonChoice {
  return { options, hover: -1, curseHover: false, timer: WAITED, curseTaken: false, curse: null, grades };
}

const clean = BOON_KEYS.filter((k) => !BOONS[k].cursed);
const cursed = BOON_KEYS.filter((k) => BOONS[k].cursed);

function key(list: readonly BoonKey[], i: number): BoonKey {
  const k = list[i];
  if (k === undefined) throw new Error("祝福が足りない");
  return k;
}

describe("bot の祝福の選び方", () => {
  it("bot は格の高い札を選ぶ", () => {
    const options = [key(clean, 0), key(clean, 1), key(clean, 2)];
    expect(pickBoonIndex(choiceOf(options, [1, 3, 2])), "神威の札").toBe(1);
    expect(pickBoonIndex(choiceOf(options, [1, 1, 2])), "大祝福の札").toBe(2);
    expect(pickBoonIndex(choiceOf(options, [1, 1, 1])), "同じ格なら前の札").toBe(0);
  });

  it("呪い付きの札は格が高くても選ばない", () => {
    const options = [key(clean, 0), key(cursed, 0), key(clean, 1)];
    expect(pickBoonIndex(choiceOf(options, [1, 3, 2])), "呪いでない方の最上位").toBe(2);
    const allCursed = [key(cursed, 0), key(cursed, 1), key(cursed, 2)];
    expect(pickBoonIndex(choiceOf(allCursed, [1, 1, 1])), "呪い付きしか無ければ 1 枚目").toBe(0);
  });

  it("格の無い提示（grades 省略）では呪いでない最初の札", () => {
    const options = [key(cursed, 0), key(clean, 0), key(clean, 1)];
    const choice: BoonChoice = { options, hover: -1, curseHover: false, timer: WAITED, curseTaken: false, curse: null };
    expect(pickBoonIndex(choice), "2 枚目").toBe(1);
  });

  it("選んだ札に対応するキーを押す", () => {
    const state = createGame(1);
    state.boonChoice = choiceOf([key(clean, 0), key(clean, 1), key(clean, 2)], [1, 1, 3]);
    const input = botInput(state, createBotState(1), 1 / 60);
    expect(input.attackPressed, "3 枚目は攻撃のキー").toBe(true);
    expect(input.skill1Pressed || input.skill2Pressed, "他の札のキーは押さない").toBe(false);
  });
});

const DT = 1 / 60;
/** 回避の危険距離（55px）より外で、奥義の距離（8m = 80px）より内 */
const NEAR_ENEMY_DX = 70;
/** 奥義の距離（8m）より外 */
const FAR_ENEMY_DX = 120;
/** 殴り続けても倒れない・倒されない体力 */
const ENDLESS_HP = 1e9;

/** 開始部屋で追ってくる敵 1 体と向き合う（互いに倒れない。待機中の敵は bot が交戦相手に選ばないので追跡にする） */
function facingEnemy(dx: number): GameState {
  const state = arena(3);
  const e = placeEnemy(state, "slime", dx);
  e.phase = "chase";
  e.hp = ENDLESS_HP;
  e.maxHp = ENDLESS_HP;
  state.player.hp = ENDLESS_HP;
  state.player.maxHp = ENDLESS_HP;
  return state;
}

function fullGauge(state: GameState): void {
  state.player.energy = state.player.maxEnergy;
}

describe("bot の奥義", () => {
  it("bot は奥義ゲージが満タンなら敵の近くで F を押す", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    fullGauge(state);
    expect(botInput(state, createBotState(1), DT).specialPressed, "満タン・8m 以内なら押す").toBe(true);
  });

  it("ゲージが満タンでない・敵が 8m より遠いときは F を押さない", () => {
    const half = facingEnemy(NEAR_ENEMY_DX);
    half.player.energy = half.player.maxEnergy / 2;
    expect(botInput(half, createBotState(1), DT).specialPressed, "ゲージが半分").toBe(false);
    const far = facingEnemy(FAR_ENEMY_DX);
    fullGauge(far);
    expect(botInput(far, createBotState(1), DT).specialPressed, "敵が 8m より遠い").toBe(false);
  });

  it("持続の奥義の間は F を押さず、ゲージが減るのを待つ（押し直すと終わるため）", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    const sustain = Object.values(ULTIMATES).flat().find((u) => u.kind === "sustain");
    expect(sustain, "持続の奥義がある").toBeDefined();
    fullGauge(state);
    state.player.ultimate.active = sustain?.key ?? null;
    expect(shouldPressUltimate(state, NEAR_ENEMY_DX), "持続中").toBe(false);
  });

  it("bot に任せると満タンのゲージで奥義が出てゲージが減る", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    fullGauge(state);
    const bot = createBotState(1);
    const before = state.player.energy;
    step(state, botInput(state, bot, DT), DT);
    const used = state.player.energy < before || state.player.ultimate.active !== null;
    expect(used, "一撃ならゲージが 0、持続なら持続中").toBe(true);
  });
});

describe("bot の左右の連撃", () => {
  it("bot は近接なら左右を混ぜた列で連撃を出し、名前付き派生を踏む", () => {
    const state = facingEnemy(20);
    const bot = createBotState(2);
    let right = false;
    let branch = false;
    const FRAMES = 60 * 30;
    for (let i = 0; i < FRAMES && !(right && branch); i++) {
      step(state, botInput(state, bot, DT), DT);
      const a = state.player.attack;
      if (a.phase !== "none" && a.lane === "secondary") right = true;
      if (a.branch >= 0) branch = true;
    }
    expect(right, "右の段を振った").toBe(true);
    expect(branch, "名前付き派生を踏んだ").toBe(true);
  });
});

describe("bot の隠し部屋", () => {
  /** rng.chance を強制的に true にして隠し部屋を計画させる（抽選自体は planHiddenRoom のまま） */
  function forceHidden(state: GameState): HiddenRoom {
    state.hiddenRoom = null;
    state.rng = { ...state.rng, chance: () => true };
    planHidden(state);
    const hr = state.hiddenRoom;
    if (!hr) throw new Error("隠し部屋が計画されなかった（テストの前提が崩れている）");
    return hr;
  }

  /** 隠し部屋のある rooms 型の階（HIDDEN_ROOM.minDepth 以上・ボス階を避ける）。手がかりは立てておく */
  function hiddenFloor(seed: number): GameState {
    const state = arena(seed);
    state.depth = 3;
    buildFloor(state, "rooms");
    forceHidden(state).hinted = true;
    return state;
  }

  it("手がかりの出た扉へ動き、届かないまま上限秒を超えたら諦める（壁に押し当て続けて止まらない）", () => {
    const state = hiddenFloor(9);
    const bot = createBotState(1);
    const first = botInput(state, bot, 1);
    expect(isZero(first.move), "扉へ向かって動く").toBe(false);
    expect(bot.hiddenDoorTime).toBeGreaterThan(0);
    // state を進めないので扉は開かない。追った秒が上限を超えたら以後は数えない（= 扉を追わない）
    for (let i = 0; i < HIDDEN_DOOR_GIVE_UP * 2; i++) botInput(state, bot, 1);
    expect(bot.hiddenDoorTime).toBeLessThanOrEqual(HIDDEN_DOOR_GIVE_UP + 1);
  });
});

describe("bot の瓶", () => {
  function withHpRatio(state: GameState, ratio: number): void {
    state.player.hp = state.player.maxHp * ratio;
  }

  it("瓶が 1 本以上で生命が 40% 以下なら飲む（ちょうど 40% は飲み、超えれば飲まない）", () => {
    const state = arena(4);
    state.player.flasks = 1;
    withHpRatio(state, 0.4);
    expect(botInput(state, createBotState(1), DT).flaskPressed, "40% で飲む").toBe(true);
    withHpRatio(state, 0.41);
    expect(botInput(state, createBotState(1), DT).flaskPressed, "41% では飲まない").toBe(false);
  });

  it("瓶が 0 本なら生命が低くても押さない", () => {
    const state = arena(4);
    state.player.flasks = 0;
    withHpRatio(state, 0.1);
    expect(shouldDrinkFlask(state), "0 本").toBe(false);
    expect(botInput(state, createBotState(1), DT).flaskPressed).toBe(false);
  });

  it("交戦中でも低 HP なら攻撃の入力に重ねて飲む", () => {
    const state = arena(4);
    placeEnemy(state, "slime", 20).phase = "chase";
    state.player.flasks = 2;
    withHpRatio(state, 0.2);
    const input = botInput(state, createBotState(1), DT);
    expect(input.flaskPressed, "戦闘の入力にも重なる").toBe(true);
    expect(isZero(input.move) && !input.attackPressed && !input.attackHeld && !input.shootHeld && !input.dashPressed, "戦闘の入力そのものは残る").toBe(false);
  });
});

describe("bot の市", () => {
  const WARE_OFFSET = 40;

  function ware(state: GameState, kind: WareKind, price: number, dx = WARE_OFFSET): Ware {
    const p = state.player.body.pos;
    return { kind, key: kind, price, base: price, pos: { x: p.x + dx, y: p.y }, used: false, armed: false };
  }

  function stand(state: GameState, wares: Ware[], provoked = false): void {
    const merchant: Merchant = { enemyId: -1, kind: "market", pos: { ...state.player.body.pos }, wares, greeted: false, provoked, rerolls: 0 };
    state.economy.merchants = [merchant];
  }

  it("瓶が上限未満で払えるなら瓶の台座へ寄り、触れたらその台座は済ませたことにして探索へ戻る", () => {
    const state = arena(4);
    state.player.flasks = 0;
    state.economy.coins = 100;
    const target = ware(state, "flask", 40, 0);
    stand(state, [target]);
    const bot = createBotState(1);
    botInput(state, bot, DT);
    expect(bot.marketTime, "台座を追った").toBeGreaterThan(0);
    expect(bot.triedWares.has(target), "台座の真上にいれば触れたとみなす").toBe(true);
    const before = bot.marketTime;
    botInput(state, bot, DT);
    expect(bot.marketTime, "済んだ台座には寄り続けない").toBe(before);
  });

  it("払えない・瓶が上限・瓶以外の台座には寄らない（他は買わない）", () => {
    const poor = arena(4);
    poor.player.flasks = 0;
    poor.economy.coins = 39;
    stand(poor, [ware(poor, "flask", 40)]);
    const poorBot = createBotState(1);
    botInput(poor, poorBot, DT);
    expect(poorBot.marketTime, "銭が足りなければ寄らない").toBe(0);

    const full = arena(4);
    full.economy.coins = 100;
    full.player.flasks = full.stats.flaskMax;
    stand(full, [ware(full, "flask", 40)]);
    const fullBot = createBotState(1);
    botInput(full, fullBot, DT);
    expect(fullBot.marketTime, "瓶が上限なら寄らない").toBe(0);

    const other = arena(4);
    other.player.flasks = 0;
    other.economy.coins = 500;
    stand(other, [ware(other, "item", 70), ware(other, "rune", 50), ware(other, "key", 30)]);
    const otherBot = createBotState(1);
    botInput(other, otherBot, DT);
    expect(otherBot.marketTime, "瓶以外の台座には寄らない").toBe(0);
  });

  it("怒った商人の台座には寄らない（売らないので）", () => {
    const state = arena(4);
    state.player.flasks = 0;
    state.economy.coins = 100;
    stand(state, [ware(state, "flask", 40)], true);
    const bot = createBotState(1);
    botInput(state, bot, DT);
    expect(bot.marketTime, "怒った商人").toBe(0);
  });

  it("買われて used になった台座には寄らず、寄り道の秒の上限を超えたら諦める", () => {
    const sold = arena(4);
    sold.player.flasks = 0;
    sold.economy.coins = 100;
    const w = ware(sold, "flask", 40);
    w.used = true;
    stand(sold, [w]);
    const soldBot = createBotState(1);
    botInput(sold, soldBot, DT);
    expect(soldBot.marketTime, "used の台座は対象外").toBe(0);

    const far = arena(4);
    far.player.flasks = 0;
    far.economy.coins = 100;
    stand(far, [ware(far, "flask", 40, 5000)]);
    const bot = createBotState(1);
    for (let i = 0; i < 100; i++) botInput(far, bot, 1);
    expect(bot.marketTime, "追った秒は上限を少し超えたところで止まる").toBeLessThanOrEqual(31 + 1);
  });
});

describe("bot の進み方（封鎖の部屋 → 階の主 → 階段）", () => {
  /** 階の主がいて、封鎖中の部屋は無い盤面（階段は主を倒すまで現れないので、全部屋を掃除して待つ bot は進めない） */
  function lordFloor(seed: number): GameState {
    const state = arena(seed);
    state.rooms.forEach((room) => {
      room.locked = false;
    });
    // arena は敵を空にするので、主は置き直す（slayFloorLord が倒せるよう敵としても立てる）
    state.boss = null;
    setupFloorLordRoom(state, state.rooms.length - 1);
    return state;
  }

  it("封鎖中の部屋を最優先で目標にする（主の部屋より先）", () => {
    const state = lordFloor(3);
    expect(state.boss, "前提: 階の主がいる").not.toBeNull();
    const lockedIndex = 0;
    expect(state.boss?.roomIndex, "前提: 封鎖する部屋は主の部屋と別").not.toBe(lockedIndex);
    const room = state.rooms[lockedIndex];
    if (!room) throw new Error("部屋が無い");
    room.locked = true;
    expect(chooseTargetRoomIndex(state, createBotState(1)), "封鎖中の部屋").toBe(lockedIndex);
  });

  it("主が生きている間は主の部屋を目標にする（未制圧の近い部屋は後回し）", () => {
    const state = lordFloor(3);
    const boss = state.boss;
    if (!boss) throw new Error("階の主がいない");
    expect(boss.defeated, "前提: 主は未撃破").toBe(false);
    const bot = createBotState(1);
    expect(chooseTargetRoomIndex(state, bot), "主の部屋").toBe(boss.roomIndex);
    expect(bot.targetRoomIndex, "bot の目標にも残る").toBe(boss.roomIndex);
  });

  it("主を倒した後は階段へ向かう（目標の部屋が null）", () => {
    const state = lordFloor(3);
    slayFloorLord(state);
    expect(state.boss?.defeated, "前提: 主を倒した").toBe(true);
    state.rooms.forEach((room) => {
      room.locked = false;
    });
    const bot = createBotState(1);
    bot.targetRoomIndex = state.boss?.roomIndex ?? null;
    expect(chooseTargetRoomIndex(state, bot), "階段へ").toBeNull();
    expect(bot.targetRoomIndex, "覚えていた目標も捨てる").toBeNull();
  });
});
