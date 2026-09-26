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
 * footF, footB: 前足・後ろ足の { x, lift } / sway: 布の揺れ（-1..1、+ で後ろへなびく）/ tilt: 頭の傾き（+ で前へ）
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
    shoulderF: { x: chest.x + 3, y: chest.y - 3 },
    shoulderB: { x: chest.x - 4, y: chest.y - 3.5 },
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

/** 歩き: 8 枚で 1 歩ずつ 2 歩。上体は接地で沈み、蹴り出しで浮く */
export const WALK_FRAMES = 8;
function walkPose(f) {
  const t = (f / WALK_FRAMES) * TAU;
  const stride = 5;
  const fx = Math.cos(t) * stride;
  const bx = -fx;
  const liftF = Math.max(0, Math.sin(t)) * 3;
  const liftB = Math.max(0, -Math.sin(t)) * 3;
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
