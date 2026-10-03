// 人型の骨組みと、体のシート（待機・歩き・ダッシュ・構え・振り抜き・被弾）の時間割。docs/ideas/player-sprites.md 4 章
//
// ジョブの体は「骨組みの点」を受け取って部品を塗るだけにする（sheets/body<ジョブ>.mjs）。
// 姿勢（足の位置・上体の上下と傾き・布の揺れ）はここで決め、全ジョブで同じ時間割で動く。
// 腕は体に描かない（実行時に肩から武器の握りまで引く。render/playerRig.ts）。肩の位置を位置の印で渡す

import { clamp01, lerp } from "./paint.mjs";

/** 体の作業面（絵のドット）。原点 = 足元の中心 */
export const BODY_W = 72;
export const BODY_H = 80;
export const BODY_OX = 36;
export const BODY_OY = 72;

/** 骨の長さ（絵のドット） */
const THIGH = 7;
const SHIN = 7;
const HIP_Y = -14;

/**
 * 姿勢の値。
 * bob: 上体の上下（+ で下がる）/ lean: 上体の前後（+ で前へ）/ breath: 胸の膨らみ（0..1）/
 * footF, footB: 前足・後ろ足の { x, lift } / sway: 布の揺れ（-1..1、+ で後ろへなびく）/ tilt: 頭の傾き（+ で前へ）/
 * reach: 振りで肩を前へ入れる量（+ で前の肩が前・後ろの肩が後ろへ。上体をひねって腕を伸ばす）
 */
export function pose(p = {}) {
  return {
    bob: p.bob ?? 0,
    lean: p.lean ?? 0,
    breath: p.breath ?? 0,
    footF: p.footF ?? { x: 3, lift: 0 },
    footB: p.footB ?? { x: -3, lift: 0 },
    sway: p.sway ?? 0,
    tilt: p.tilt ?? 0,
    squash: p.squash ?? 0,
    reach: p.reach ?? 0,
  };
}

/** 2 本の骨の関節（膝）。膝は前（+x）へ曲げる */
function knee(hip, foot, bend = 1) {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const d = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 0.01);
  const a = Math.acos(clamp01((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
  const base = Math.atan2(dy, dx);
  const ang = base - a * bend;
  return { x: hip.x + Math.cos(ang) * THIGH, y: hip.y + Math.sin(ang) * THIGH };
}

/** 姿勢 → 骨組みの点（絵のドット、原点 = 足元の中心） */
export function skeleton(ps) {
  const up = ps.bob;
  const hip = { x: ps.lean * 0.35, y: HIP_Y + up + ps.squash };
  const chest = { x: ps.lean * 0.75, y: -21 + up - ps.breath * 0.6 + ps.squash * 0.7 };
  const neck = { x: ps.lean * 0.95, y: -26 + up - ps.breath * 0.4 + ps.squash * 0.5 };
  const head = { x: ps.lean + 1 + ps.tilt * 0.6, y: -34 + up - ps.breath * 0.3 + ps.squash * 0.4 };
  const hipF = { x: hip.x + 2, y: hip.y };
  const hipB = { x: hip.x - 2, y: hip.y };
  const footF = { x: ps.footF.x, y: -ps.footF.lift };
  const footB = { x: ps.footB.x, y: -ps.footB.lift };
  return {
    ps,
    hip,
    chest,
    neck,
    head,
    hipF,
    hipB,
    footF,
    footB,
    kneeF: knee(hipF, footF),
    kneeB: knee(hipB, footB),
    shoulderF: { x: chest.x + 3 + ps.reach * 0.7, y: chest.y - 3 },
    shoulderB: { x: chest.x - 4 - ps.reach * 0.3, y: chest.y - 3.5 },
  };
}

const TAU = Math.PI * 2;

/**
 * 待機の構え（武器の系統ごと。実行時の render/playerRig.ts の STANCES が選ぶ）。棒立ちにせず、足を前後に開いて腰を落とす。
 * 呼吸で胸と頭が上下し、腰がわずかに沈み、布がゆっくり揺れる（IDLE_FRAMES 枚で 1 巡）。
 * ready: 近接の既定（半身に開いて腰を落とし、上体をやや前へ）/ heavy: 重い武器（足を大きく開いて低く踏ん張る）/
 * light: 軽い武器・素手（前のめりで後ろの踵を浮かせ、小さく弾む）/ aim: 銃（足を前後に開き、上体を起こして狙う）
 */
export const IDLE_FRAMES = 8;
const IDLE_STANCES = {
  ready: { front: 6, back: -6, crouch: 2.5, lean: 1.5, tilt: 0.5, breath: 1.2, sink: 0.6, bounce: 0, heel: 0 },
  heavy: { front: 7.5, back: -7.5, crouch: 3.5, lean: 1, tilt: 0.3, breath: 1.4, sink: 0.8, bounce: 0, heel: 0 },
  light: { front: 5.5, back: -6, crouch: 2.5, lean: 2.5, tilt: 1, breath: 1, sink: 0, bounce: 1.1, heel: 1.2 },
  aim: { front: 5, back: -6.5, crouch: 1.5, lean: 0.5, tilt: 0, breath: 1.1, sink: 0.4, bounce: 0, heel: 0 },
};
export const IDLE_STANCE_KEYS = Object.keys(IDLE_STANCES);

function idlePose(stance) {
  const c = IDLE_STANCES[stance];
  return (f) => {
    const t = f / IDLE_FRAMES;
    const b = (1 - Math.cos(t * TAU)) / 2;
    // 弾む構えは呼吸の倍の速さで上下する（つま先で刻むリズム）
    const hop = c.bounce * (1 - Math.cos(t * TAU * 2)) / 2;
    return pose({
      breath: b * c.breath,
      bob: c.crouch + b * c.sink + hop,
      lean: c.lean,
      tilt: c.tilt,
      sway: Math.sin(t * TAU) * 0.5,
      footF: { x: c.front, lift: 0 },
      footB: { x: c.back, lift: c.heel },
    });
  };
}

function capital(key) {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * 歩き: 8 枚で 1 歩ずつ 2 歩。上体は接地で沈み、蹴り出しで浮く。
 * 前へ歩く足は「浮いて前（+x）へ振り出し、着いたら体の下を後ろへ流れる」。浮かせるのは足の x が増えている間
 * （fx = cos t の増える側は sin t < 0）。逆にすると、着いた足が前へ滑って後ずさりに見える
 */
export const WALK_FRAMES = 8;
function walkPose(f) {
  const t = (f / WALK_FRAMES) * TAU;
  const stride = 5;
  const fx = Math.cos(t) * stride;
  const bx = -fx;
  const liftF = Math.max(0, -Math.sin(t)) * 3;
  const liftB = Math.max(0, Math.sin(t)) * 3;
  const bob = Math.abs(Math.cos(t)) > 0.7 ? 1 : 0;
  return pose({ bob, lean: 1, footF: { x: fx + 0.5, lift: liftF }, footB: { x: bx - 0.5, lift: liftB }, sway: 0.6 + Math.sin(t * 2) * 0.25 });
}

/** ダッシュ: 前へ大きく倒れ、後ろ足を伸ばす */
export const DASH_FRAMES = 2;
function dashPose(f) {
  return pose({ lean: 4 + f, bob: 2, footF: { x: 6, lift: 1 }, footB: { x: -7, lift: 2 + f }, sway: 1, tilt: 1 });
}

/** 構え（予備動作）: 腰を落とし上体を引く / 振り抜き: 前足を踏み込み上体を前へ / 被弾: 仰け反る */
function windupPose() {
  return pose({ lean: -2, bob: 2, footF: { x: 6, lift: 0 }, footB: { x: -6, lift: 0 }, sway: -0.3, tilt: -1 });
}
function strikePose() {
  return pose({ lean: 3, bob: 1.5, footF: { x: 8, lift: 0 }, footB: { x: -6, lift: 0 }, sway: 0.9, tilt: 1 });
}
function hitPose() {
  return pose({ lean: -3, bob: 1, footF: { x: 4, lift: 0 }, footB: { x: -4, lift: 1 }, sway: -0.6, tilt: -2, squash: 1 });
}

/**
 * 攻撃の体のコマ（docs/ideas/player-sprites.md 5 章）。振りの形ごとに 6 枚: 0-1 = 予備動作（溜め → 溜め切り）、
 * 2-3 = 振り（踏み込み → 伸び切り）、4 = 振り抜き（残心で伸びたまま）、5 = 戻し（構えへ落ち着く）。
 * 実行時は render/playerRig.ts の bodyClip が段階と進みからコマを選ぶ
 */
export const ATTACK_FRAMES = 6;
const f = (x, lift = 0) => ({ x, lift });
const ATTACK_KEYS = {
  // 振り下ろし（順手）: 肩の上へ振りかぶって前足を浮かせ、踏み込んで上体を前へ倒しながら斜めに斬り下ろす
  atkSlash: [
    { lean: -1.5, bob: 2.5, footF: f(6), footB: f(-6), tilt: -1, sway: -0.3, breath: 0.6, reach: -0.5 },
    { lean: -2.5, bob: 2, footF: f(5, 1.5), footB: f(-6), tilt: -1.5, sway: -0.5, breath: 1, reach: -1 },
    { lean: 3, bob: 3, footF: f(9, 0.5), footB: f(-6), tilt: 1, sway: 0.6, reach: 1.2 },
    { lean: 4.5, bob: 4, footF: f(10), footB: f(-7, 1), tilt: 1.5, sway: 1, reach: 2, squash: 0.5 },
    { lean: 4, bob: 4.5, footF: f(10), footB: f(-7, 1.5), tilt: 1.5, sway: 1.2, reach: 1.5 },
    { lean: 2.5, bob: 3.5, footF: f(8), footB: f(-6.5, 0.5), tilt: 0.8, sway: 0.7, reach: 0.5 },
  ],
  // 斬り上げ（逆手）: 低く沈んで溜め、後ろ足の踵を上げて伸び上がりながら下から上へ
  atkRise: [
    { lean: 0.5, bob: 4, footF: f(7), footB: f(-6), tilt: 0.5, sway: 0, reach: -0.5 },
    { lean: 1, bob: 5, footF: f(7), footB: f(-7), tilt: 0.5, sway: -0.3, reach: -1 },
    { lean: 2.5, bob: 2, footF: f(8), footB: f(-6, 1.5), tilt: -0.5, sway: 0.8, breath: 1, reach: 1.5 },
    { lean: 3, bob: 0.5, footF: f(8), footB: f(-5, 3), tilt: -1, sway: 1.2, breath: 1.2, reach: 2 },
    { lean: 2.5, bob: 0.5, footF: f(8), footB: f(-5, 2.5), tilt: -1, sway: 1.3, breath: 1, reach: 1.5 },
    { lean: 2, bob: 2, footF: f(7), footB: f(-6, 0.5), tilt: 0, sway: 0.7, reach: 0.5 },
  ],
  // 叩きつけ（重い振り下ろし）: 伸び上がって大きく反り、深く沈み込んで全身で叩き下ろす
  atkSlam: [
    { lean: -2, bob: 0.5, footF: f(6, 1), footB: f(-6), tilt: -1.5, sway: -0.5, breath: 1.5, reach: -0.5 },
    { lean: -3, bob: 0, footF: f(5, 2.5), footB: f(-6, 0.5), tilt: -2, sway: -0.7, breath: 1.5, reach: -1 },
    { lean: 3.5, bob: 4, footF: f(9), footB: f(-7), tilt: 1.5, sway: 0.8, reach: 1 },
    { lean: 5, bob: 6, footF: f(10), footB: f(-8), tilt: 2, sway: 1.2, squash: 1.5, reach: 2 },
    { lean: 5, bob: 6, footF: f(10), footB: f(-8), tilt: 2, sway: 0.9, squash: 1.2, reach: 1.5 },
    { lean: 3, bob: 4.5, footF: f(9), footB: f(-7), tilt: 1, sway: 0.5, reach: 0.5 },
  ],
  // 突き: 後ろへ体重を引いて前足を浮かせ、大きく踏み込んで肩ごと突き出す
  atkThrust: [
    { lean: -1.5, bob: 3, footF: f(5), footB: f(-7), tilt: -0.5, sway: -0.3, reach: -1 },
    { lean: -2.5, bob: 3.5, footF: f(4, 1), footB: f(-8), tilt: -0.5, sway: -0.5, reach: -1.5 },
    { lean: 4, bob: 3.5, footF: f(11, 0.5), footB: f(-8), tilt: 1, sway: 1, reach: 2.5 },
    { lean: 5.5, bob: 4, footF: f(12), footB: f(-9, 0.5), tilt: 1, sway: 1.3, reach: 3 },
    { lean: 5, bob: 4, footF: f(12), footB: f(-9, 1), tilt: 1, sway: 1.1, reach: 2.5 },
    { lean: 3, bob: 3, footF: f(9), footB: f(-7), tilt: 0.5, sway: 0.6, reach: 1 },
  ],
  // 居合（刀の右の溜め）: 0-1 = 足を大きく開いて腰を深く落とし、上体をわずかに前へ（鞘に手を添えて柄を握る構え）、
  // 2-3 = 低いまま前足を大きく踏み出し、肩を入れて抜き付ける、4 = 抜き切った残心、5 = 戻し
  atkIai: [
    { lean: 1.5, bob: 5, footF: f(8), footB: f(-8), tilt: 0.5, sway: -0.2, reach: -1 },
    { lean: 2, bob: 6, footF: f(8.5), footB: f(-8.5, 0.5), tilt: 0.5, sway: -0.3, breath: 0.4, reach: -1.5 },
    { lean: 5, bob: 4.5, footF: f(12), footB: f(-9, 1), tilt: 1, sway: 1, reach: 2.5 },
    { lean: 6, bob: 4, footF: f(13), footB: f(-9, 1.5), tilt: 1, sway: 1.3, reach: 3 },
    { lean: 5, bob: 4, footF: f(13), footB: f(-9, 1), tilt: 0.5, sway: 1.1, reach: 2.5 },
    { lean: 3, bob: 3, footF: f(9), footB: f(-7), tilt: 0.5, sway: 0.6, reach: 1 },
  ],
  // 回転: 腰を落として逆へひねり、足を開いたまま布を振り回す
  atkSpin: [
    { lean: -1, bob: 3.5, footF: f(7), footB: f(-7), sway: -0.4, reach: -0.5 },
    { lean: -1.5, bob: 4, footF: f(7), footB: f(-7), sway: -0.6, reach: -1 },
    { lean: 1.5, bob: 3, footF: f(8), footB: f(-8, 1), sway: 1.2, reach: 1.5 },
    { lean: 0, bob: 2.5, footF: f(7, 1), footB: f(-8), sway: -1, reach: -1 },
    { lean: 1, bob: 3, footF: f(8), footB: f(-7), sway: 1, reach: 1 },
    { lean: 1, bob: 3, footF: f(7), footB: f(-6.5), sway: 0.5, reach: 0.5 },
  ],
};
export const ATTACK_CLIP_KEYS = Object.keys(ATTACK_KEYS);

/**
 * 受け流し（docs/ideas/parry-motion.md）: 0 = 受けの構え（足を大きく開いて腰を落とし、上体をわずかに引いて踏ん張る）/
 * 1 = 受け止めた衝撃（後ろへ押されて深く沈み、後ろ足が滑る）。腕と武器の形は武器の絵の meta.stance.parry
 */
export const PARRY_FRAMES = 2;
const PARRY_KEYS = [
  { lean: -1, bob: 4, footF: f(8), footB: f(-8), tilt: -0.5, sway: -0.4, breath: 0.6, reach: 0.5 },
  { lean: -3, bob: 5, footF: f(7), footB: f(-9.5, 0.5), tilt: -1.5, sway: -1, squash: 1, reach: -0.5 },
];

/** 体のシートの並び（名前・枚数・姿勢）。実行時の render/playerRig.ts の BODY_CLIPS と同じ名前 */
export const BODY_CLIPS = [
  ...IDLE_STANCE_KEYS.map((k) => ({ name: `idle${capital(k)}`, frames: IDLE_FRAMES, pose: idlePose(k) })),
  { name: "walk", frames: WALK_FRAMES, pose: walkPose },
  { name: "dash", frames: DASH_FRAMES, pose: dashPose },
  { name: "windup", frames: 1, pose: windupPose },
  { name: "strike", frames: 1, pose: strikePose },
  { name: "hit", frames: 1, pose: hitPose },
  ...ATTACK_CLIP_KEYS.map((k) => ({ name: k, frames: ATTACK_FRAMES, pose: (i) => pose(ATTACK_KEYS[k][i]) })),
  { name: "parry", frames: PARRY_FRAMES, pose: (i) => pose(PARRY_KEYS[i]) },
];

/**
 * ジョブの体のシート一式。draw(frame, sk, clip) で部品を塗る。
 * 肩・頭・腰の位置の印は骨組みから置く（腰は鞘を下げる位置）（腕と頭上の印を実行時に合わせる）
 */
export function bodySheets(key, draw) {
  return BODY_CLIPS.map((clip) => ({
    key: `${key}.${clip.name}`,
    frames: clip.frames,
    dirs: 1,
    w: BODY_W,
    h: BODY_H,
    ox: BODY_OX,
    oy: BODY_OY,
    draw(frame, f) {
      const sk = skeleton(clip.pose(f));
      draw(frame, sk, clip.name, f);
      frame.anchor("shoulderF", sk.shoulderF.x, sk.shoulderF.y);
      frame.anchor("shoulderB", sk.shoulderB.x, sk.shoulderB.y);
      frame.anchor("head", sk.head.x, sk.head.y);
      frame.anchor("hip", sk.hip.x, sk.hip.y);
    },
  }));
}

/** 2 点の間の点 */
export function mid(a, b, t = 0.5) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
