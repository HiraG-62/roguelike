import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { ENEMY_AI } from "../data/tuning";
import { segmentCircleHit, spawnBomb, spawnLaser, spawnShockwave, updateHazards } from "./hazards";
import { arena } from "./testHelpers";

describe("segmentCircleHit", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  it("線分の太さ + 半径以内なら当たる", () => {
    expect(segmentCircleHit(a, b, 4, { x: 50, y: 8 }, 5)).toBe(true);
    expect(segmentCircleHit(a, b, 4, { x: 50, y: 10 }, 5)).toBe(false);
  });
  it("端点の外側は端点からの距離で判定する", () => {
    expect(segmentCircleHit(a, b, 4, { x: 107, y: 0 }, 5)).toBe(true);
    expect(segmentCircleHit(a, b, 4, { x: 110, y: 0 }, 5)).toBe(false);
    expect(segmentCircleHit(a, b, 4, { x: -8, y: 0 }, 5)).toBe(true);
  });
});

describe("hazards", () => {
  it("爆弾は fuse まで無害で、爆発で範囲内にダメージ", () => {
    const state = arena();
    const p = state.player.body.pos;
    spawnBomb(state, { x: p.x + 10, y: p.y }, 15);
    const hp = state.player.hp;
    const fuseSteps = Math.floor(ENEMY_AI.bomber.fuse / FIXED_DT) - 2;
    for (let i = 0; i < fuseSteps; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBe(hp);
    for (let i = 0; i < 5; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBeLessThan(hp);
    expect(state.hazards.length).toBe(0);
  });

  it("爆弾の範囲外なら無傷", () => {
    const state = arena();
    const p = state.player.body.pos;
    spawnBomb(state, { x: p.x + ENEMY_AI.bomber.radius + 20, y: p.y }, 15);
    const hp = state.player.hp;
    for (let i = 0; i < 200; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBe(hp);
  });

  it("レーザーは線分上のプレイヤーにだけ当たる", () => {
    const state = arena();
    const p = state.player.body.pos;
    spawnLaser(state, { x: p.x - 50, y: p.y + 30 }, { x: p.x + 50, y: p.y + 30 }, 0.4, 10);
    const hp = state.player.hp;
    updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBe(hp);
    spawnLaser(state, { x: p.x - 50, y: p.y + 2 }, { x: p.x + 50, y: p.y + 2 }, 0.4, 10);
    updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBeLessThan(hp);
  });

  it("衝撃波は縁だけに判定がある（中心にいれば広がった後は当たらない）", () => {
    const state = arena();
    const p = state.player.body.pos;
    // 中心 = プレイヤー位置。最初のステップで縁は既にプレイヤーより外側 → 当たらない
    const center = { ...p };
    spawnShockwave(state, center, 70, 20);
    // 1 ステップ目は半径が小さいので当たる可能性があるため、プレイヤーを縁から離れた位置に置く
    state.player.body.pos = { x: p.x + 60, y: p.y };
    const hp = state.player.hp;
    // 縁が 60px に達する前はダメージなし
    updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBe(hp);
    for (let i = 0; i < 60; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBeLessThan(hp);
  });

  it("ダッシュ無敵中は衝撃波を抜けられる", () => {
    const state = arena();
    const p = state.player.body.pos;
    spawnShockwave(state, { ...p }, 70, 20);
    state.player.body.pos = { x: p.x + 40, y: p.y };
    state.player.invulnTimer = 10;
    const hp = state.player.hp;
    for (let i = 0; i < 60; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBe(hp);
  });
});
