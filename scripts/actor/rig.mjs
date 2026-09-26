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

/**
 * 骨の長さ（絵のドット）。頭を小さく脚を長く（4 頭身強）、肩を張り腰を絞った立ち姿にする。
 * 頭身を上げると踏み込み・仰け反り・半身の差が大きく付き、攻撃の動きを作り込む余地が広がる
 */
const THIGH = 12.5;
const SHIN = 12;
const HIP_Y = -24;
const CHEST_Y = -35;
const NECK_Y = -41;
const HEAD_Y = -47;

/**
 * 姿勢の値。
 * bob: 上体の上下（+ で下がる）/ lean: 上体の前後（+ で前へ）/ breath: 胸の膨らみ（0..1）/
 * footF, footB: 前足・後ろ足の { x, lift } / sway: 布の揺れ（-1..1）/ flow: 布が後ろへなびく強さ（動きの勢い、0..1.5）/
 * tilt: 頭の傾き（+ で前へ）/ twist: 胸を腰より前へ出す量（半身のひねり）/ squash: 被弾の潰れ
 */
export function pose(p = {}) {
  return {
    bob: p.bob ?? 0,
    lean: p.lean ?? 0,
    breath: p.breath ?? 0,
    footF: p.footF ?? { x: 3, lift: 0 },
    footB: p.footB ?? { x: -3, lift: 0 },
    sway: p.sway ?? 0,
    flow: p.flow ?? 0,
    tilt: p.tilt ?? 0,
    twist: p.twist ?? 0,
    squash: p.squash ?? 0,
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
  const hip = { x: ps.lean * 0.3, y: HIP_Y + up + ps.squash };
  const chest = { x: ps.lean * 0.8 + ps.twist * 0.5, y: CHEST_Y + up - ps.breath * 0.6 + ps.squash * 0.7 };
  const neck = { x: ps.lean * 1.0 + ps.twist * 0.6, y: NECK_Y + up - ps.breath * 0.4 + ps.squash * 0.5 };
  const head = { x: ps.lean * 1.1 + 1 + ps.twist * 0.6 + ps.tilt * 0.6, y: HEAD_Y + up - ps.breath * 0.3 + ps.squash * 0.4 };
  const hipF = { x: hip.x + 1.8, y: hip.y };
  const hipB = { x: hip.x - 1.8, y: hip.y };
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
    shoulderF: { x: chest.x + 3.5, y: chest.y - 3.5 },
    shoulderB: { x: chest.x - 4.5, y: chest.y - 4 },
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
  ready: { front: 8, back: -9, crouch: 3.5, lean: 2, twist: 1, tilt: 0.5, breath: 1.3, sink: 0.8, bounce: 0, heel: 0 },
  heavy: { front: 10.5, back: -10.5, crouch: 5.5, lean: 1.5, twist: 0.5, tilt: 0.3, breath: 1.5, sink: 1, bounce: 0, heel: 0 },
  light: { front: 8, back: -9, crouch: 4, lean: 3.5, twist: 1.5, tilt: 1, breath: 1.1, sink: 0, bounce: 1.4, heel: 2 },
  aim: { front: 7, back: -9.5, crouch: 2.5, lean: 0.8, twist: 0.5, tilt: 0, breath: 1.2, sink: 0.5, bounce: 0, heel: 0 },
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
      twist: c.twist,
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
 * 移動: 8 枚で 2 歩の走り。前へ傾き、前へ運ぶ脚の膝を高く上げる。脚が開ききった接地で沈み、脚が交差する所で浮く。
 * 布は後ろへなびき、歩みの倍の周期で揺れる（シートの名前は walk のまま。実行時の BODY_CLIPS と同じ）
 */
export const WALK_FRAMES = 8;
function walkPose(f) {
  const t = (f / WALK_FRAMES) * TAU;
  const stride = 9;
  const fx = Math.cos(t) * stride;
  const liftF = Math.max(0, Math.sin(t)) * 6;
  const liftB = Math.max(0, -Math.sin(t)) * 6;
  const bob = 1 + 2 * Math.abs(Math.cos(t));
  return pose({
    bob,
    lean: 3.5,
    twist: 0.8,
    footF: { x: fx + 1, lift: liftF },
    footB: { x: -fx + 1, lift: liftB },
    flow: 1,
    sway: Math.sin(t * 2) * 0.3,
    tilt: 0.5,
  });
}

/** ダッシュ: 前へ大きく倒れ、後ろ足を伸ばす */
export const DASH_FRAMES = 2;
function dashPose(f) {
  return pose({ lean: 7 + f, bob: 5, twist: 1.5, footF: { x: 11, lift: 1 }, footB: { x: -12, lift: 3 + f }, flow: 1.5, tilt: 1 });
}

/** 構え（予備動作）: 腰を落とし上体を引く / 振り抜き: 前足を踏み込み上体を前へ / 被弾: 仰け反る */
function windupPose() {
  return pose({ lean: -3, bob: 4.5, twist: -1, footF: { x: 10, lift: 0 }, footB: { x: -10, lift: 0 }, flow: 0.2, sway: -0.3, tilt: -1 });
}
function strikePose() {
  return pose({ lean: 5, bob: 4, twist: 2, footF: { x: 13, lift: 0 }, footB: { x: -10, lift: 0 }, flow: 1, tilt: 1 });
}
function hitPose() {
  return pose({ lean: -4, bob: 2, twist: -1, footF: { x: 6, lift: 0 }, footB: { x: -6, lift: 1 }, flow: -0.4, tilt: -2, squash: 1 });
}

/** 体のシートの並び（名前・枚数・姿勢）。実行時の render/playerRig.ts の BODY_CLIPS と同じ名前 */
export const BODY_CLIPS = [
  ...IDLE_STANCE_KEYS.map((k) => ({ name: `idle${capital(k)}`, frames: IDLE_FRAMES, pose: idlePose(k) })),
  { name: "walk", frames: WALK_FRAMES, pose: walkPose },
  { name: "dash", frames: DASH_FRAMES, pose: dashPose },
  { name: "windup", frames: 1, pose: windupPose },
  { name: "strike", frames: 1, pose: strikePose },
  { name: "hit", frames: 1, pose: hitPose },
];

/**
 * ジョブの体のシート一式。draw(frame, sk, clip) で部品を塗る。
 * 肩・頭・腰の位置の印は骨組みから置く（腕と頭上の印を実行時に合わせる）
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
    },
  }));
}

/** 2 点の間の点 */
export function mid(a, b, t = 0.5) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
