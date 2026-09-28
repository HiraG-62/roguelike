// 人体のリグ（関節の順運動学）と姿勢の表。右向き・やや 3/4 の横向き。
// 角度は「真下 = 0、前（右）= +90、真上 = 180、後ろ = -90」の度。
import { lerp } from "./engine.mjs";
import { SAMPLE_POSES } from "./poses-sample.mjs";

const DEG = Math.PI / 180;
export const dirDown = (a) => ({ x: Math.sin(a * DEG), y: Math.cos(a * DEG) });
export const add = (p, v, k = 1) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
export const mid = (a, b, t = 0.5) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const pt = (x, y) => ({ x, y });

/**
 * 姿勢から関節を求める。腰の中心を原点に組み、最後に足裏が地面に着くよう平行移動する。
 * fig: 体格（styles.mjs）、pose: 姿勢（POSES）、anchor: { x, ground }
 */
export function skeleton(fig, pose, anchor) {
  const lean = pose.lean ?? 0;
  const up = dirDown(180 - lean);
  const hip = pt(0, 0);
  const waist = add(hip, up, fig.pelvis);
  const chest = add(waist, up, fig.torso * 0.55);
  const neckBase = add(waist, up, fig.torso);
  const headUp = dirDown(180 - lean - (pose.headTilt ?? 0));
  const head = add(add(neckBase, headUp, fig.neck + fig.headRy), { x: fig.faceFwd, y: 0 });
  const shN = add(add(neckBase, up, -fig.shoulderDrop), { x: fig.shoulderOff[0], y: 0 });
  const shF = add(add(neckBase, up, -fig.shoulderDrop - 0.6), { x: fig.shoulderOff[1], y: 0 });
  const hipN = add(hip, { x: fig.hipOff[0], y: 0 });
  const hipF = add(hip, { x: fig.hipOff[1], y: -0.5 });

  const leg = (h, L) => {
    const knee = add(h, dirDown(L.t), fig.thigh);
    const shinA = L.t - L.k;
    const ankle = add(knee, dirDown(shinA), fig.shin);
    const footA = 90 - (L.toe ?? 0);
    const toe = add(ankle, dirDown(footA), fig.foot);
    const heel = add(ankle, dirDown(footA + 180), fig.foot * 0.3);
    return { hip: h, knee, ankle, toe, heel, thighA: L.t, shinA, footA };
  };
  const arm = (s, A) => {
    const elbow = add(s, dirDown(A.a), fig.upperArm);
    const foreA = A.a + A.b;
    const wrist = add(elbow, dirDown(foreA), fig.forearm);
    const hand = add(wrist, dirDown(foreA), fig.handR * 0.7);
    return { sh: s, elbow, wrist, hand, upperA: A.a, foreA };
  };
  const legN = leg(hipN, pose.legN);
  const legF = leg(hipF, pose.legF);
  const armN = arm(shN, pose.armN);
  const armF = arm(shF, pose.armF);

  // 接地: 最も低い足裏を ground に
  const soleOf = (l) => Math.max(l.toe.y + fig.footR, l.ankle.y + fig.footR + 0.6, l.heel.y + fig.footR);
  // 倒れた姿勢では足より体・頭・手・膝が低くなるので、それらの下端も数える
  const bodyLow = [
    head.y + fig.headRy,
    hip.y + fig.hipR,
    chest.y + fig.chestR * 0.8,
    armN.hand.y + fig.handR,
    armF.hand.y + fig.handR,
    legN.knee.y + fig.thighR[1],
    legF.knee.y + fig.thighR[1],
  ];
  const sole = Math.max(soleOf(legN), soleOf(legF), ...bodyLow);
  const dx = anchor.x + (pose.shiftX ?? 0);
  const dy = anchor.ground - sole + (pose.lift ?? 0);
  const T = (p) => ({ x: p.x + dx, y: p.y + dy });
  const mapObj = (o) => {
    const r = {};
    for (const [k, v] of Object.entries(o)) r[k] = typeof v === "object" ? T(v) : v;
    return r;
  };
  return {
    fig,
    pose,
    lean,
    up,
    hip: T(hip),
    waist: T(waist),
    chest: T(chest),
    neckBase: T(neckBase),
    head: T(head),
    legN: mapObj(legN),
    legF: mapObj(legF),
    armN: mapObj(armN),
    armF: mapObj(armF),
    weaponA: pose.weaponA ?? 60,
    phase: pose.phase ?? 0,
    speed: pose.speed ?? 0,
  };
}

/** 姿勢。N = 手前（見る側）、F = 奥。walk は 4 枚（接地・通過・接地・通過）で 1 周 */
export const POSES = {
  idle0: {
    lean: 3,
    legN: { t: 10, k: 6 },
    legF: { t: -9, k: 5, toe: 8 },
    armN: { a: 12, b: 38 },
    armF: { a: -8, b: 22 },
    weaponA: 58,
    phase: 0,
  },
  idle1: {
    lean: 4,
    legN: { t: 12, k: 12 },
    legF: { t: -8, k: 11, toe: 8 },
    armN: { a: 14, b: 42 },
    armF: { a: -6, b: 26 },
    weaponA: 62,
    headTilt: -2,
    phase: 0.5,
  },
  walk0: {
    lean: 8,
    legN: { t: 30, k: 6 },
    legF: { t: -26, k: 18, toe: 38 },
    armN: { a: -18, b: 42 },
    armF: { a: 26, b: 34 },
    weaponA: 40,
    phase: 0,
    speed: 1,
  },
  walk1: {
    lean: 8,
    legN: { t: -4, k: 6 },
    legF: { t: 22, k: 70, toe: -5 },
    armN: { a: 2, b: 36 },
    armF: { a: 4, b: 28 },
    weaponA: 50,
    phase: 0.25,
    speed: 1,
    lift: -1,
  },
  walk2: {
    lean: 8,
    legN: { t: -26, k: 18, toe: 38 },
    legF: { t: 30, k: 6 },
    armN: { a: 22, b: 40 },
    armF: { a: -20, b: 30 },
    weaponA: 64,
    phase: 0.5,
    speed: 1,
  },
  walk3: {
    lean: 8,
    legN: { t: 22, k: 70, toe: -5 },
    legF: { t: -4, k: 6 },
    armN: { a: 4, b: 38 },
    armF: { a: 2, b: 28 },
    weaponA: 52,
    phase: 0.75,
    speed: 1,
    lift: -1,
  },
  windup: {
    lean: -6,
    headTilt: 4,
    legN: { t: 34, k: 34 },
    legF: { t: -34, k: 14, toe: 30 },
    armN: { a: -128, b: -6 },
    armF: { a: 46, b: 56 },
    weaponA: 222,
    phase: 0.1,
    shiftX: -2,
  },
  strike: {
    lean: 18,
    headTilt: -6,
    legN: { t: 52, k: 34 },
    legF: { t: -44, k: 4, toe: 45 },
    armN: { a: 80, b: 4 },
    armF: { a: -48, b: 24 },
    weaponA: 92,
    phase: 0.6,
    speed: 1.4,
    shiftX: 3,
  },
};

/** ダッシュ: 深い前傾、後ろ脚を伸ばし切る。布は大きくなびく */
POSES.dash = {
  lean: 30,
  headTilt: -14,
  legN: { t: 34, k: 72 },
  legF: { t: -48, k: 32, toe: 55 },
  armN: { a: -62, b: 26 },
  armF: { a: -48, b: 20 },
  weaponA: -96,
  phase: 0.3,
  speed: 2.2,
  lift: -2,
};
/** 被弾: のけぞり、腕が跳ね上がる */
POSES.hurt = {
  lean: -16,
  headTilt: 12,
  legN: { t: 18, k: 22 },
  legF: { t: -18, k: 26, toe: 15 },
  armN: { a: -38, b: 58 },
  armF: { a: -12, b: 64 },
  weaponA: 200,
  phase: 0.9,
  speed: 0.6,
  shiftX: -2,
};

// ---------------------------------------------------------------------------
// 行動ごとの連番（素材シートの行動に合わせる）。右向き
// ---------------------------------------------------------------------------

const STANCE_N = { t: 40, k: 36 };
const STANCE_F = { t: -36, k: 14, toe: 32 };

/** 斬り: 振りかぶり → 斬り 1（前上）→ 斬り 2（前下）→ 振り抜き（後ろ下へ流す） */
Object.assign(POSES, {
  slashWind: { lean: -8, headTilt: 4, legN: { t: 38, k: 40 }, legF: { t: -36, k: 18, toe: 30 }, armN: { a: -140, b: -12 }, armF: { a: 52, b: 60 }, weaponA: 222, shiftX: -2, phase: 0.1 },
  slash1: { lean: 6, headTilt: -2, legN: { t: 44, k: 38 }, legF: { t: -38, k: 12, toe: 36 }, armN: { a: 150, b: -40 }, armF: { a: 20, b: 60 }, weaponA: 140, phase: 0.3, speed: 1.2 },
  slash2: { lean: 18, headTilt: -8, legN: { t: 52, k: 40 }, legF: { t: -44, k: 6, toe: 44 }, armN: { a: 70, b: 4 }, armF: { a: -30, b: 50 }, weaponA: 72, shiftX: 3, phase: 0.5, speed: 1.6 },
  slashFollow: { lean: 20, headTilt: -6, legN: { t: 50, k: 44 }, legF: { t: -42, k: 8, toe: 44 }, armN: { a: -6, b: 16 }, armF: { a: -46, b: 30 }, weaponA: -36, shiftX: 3, phase: 0.7, speed: 1.0 },
  /** 突き: 構え（引き絞る）→ 突き → 戻り */
  thrustPrep: { lean: -6, headTilt: 3, legN: { t: 30, k: 36 }, legF: { t: -30, k: 20, toe: 26 }, armN: { a: -64, b: 100 }, armF: { a: 62, b: 34 }, weaponA: 92, shiftX: -3, phase: 0.1 },
  thrust: { lean: 24, headTilt: -8, legN: { t: 60, k: 32 }, legF: { t: -52, k: 0, toe: 52 }, armN: { a: 88, b: 0 }, armF: { a: -52, b: 20 }, weaponA: 90, shiftX: 5, phase: 0.4, speed: 1.8 },
  thrustRecover: { lean: 10, legN: STANCE_N, legF: STANCE_F, armN: { a: 46, b: 36 }, armF: { a: -12, b: 42 }, weaponA: 76, shiftX: 2, phase: 0.6, speed: 0.6 },
  /** ダッシュ: 溜め → 飛び出し 3 枚 → 踏みとどまり */
  dashStart: { lean: 24, headTilt: -8, legN: { t: 34, k: 76 }, legF: { t: -22, k: 62, toe: 34 }, armN: { a: -44, b: 44 }, armF: { a: -52, b: 30 }, weaponA: -52, phase: 0.1, speed: 0.6 },
  dash1: { lean: 30, headTilt: -14, legN: { t: 34, k: 72 }, legF: { t: -48, k: 32, toe: 55 }, armN: { a: -62, b: 26 }, armF: { a: -48, b: 20 }, weaponA: -48, phase: 0.3, speed: 2.2, lift: -2 },
  dash2: { lean: 34, headTilt: -16, legN: { t: 54, k: 62 }, legF: { t: -62, k: 18, toe: 62 }, armN: { a: -72, b: 20 }, armF: { a: -60, b: 16 }, weaponA: -44, phase: 0.55, speed: 2.8, lift: -3 },
  dash3: { lean: 30, headTilt: -12, legN: { t: 22, k: 84 }, legF: { t: -42, k: 40, toe: 44 }, armN: { a: -58, b: 30 }, armF: { a: -44, b: 26 }, weaponA: -48, phase: 0.8, speed: 2.2, lift: -2 },
  dashEnd: { lean: 28, headTilt: -6, legN: { t: 62, k: 84 }, legF: { t: -52, k: 30, toe: 50 }, armN: { a: -64, b: 34 }, armF: { a: 36, b: 8 }, weaponA: -56, phase: 0.95, speed: 1.0 },
  /** 倒れる: 被弾 → 膝をつく → 伏せる 3 枚（外套が落ち着く） */
  dieHit: { lean: -24, headTilt: 16, legN: { t: 12, k: 30 }, legF: { t: -24, k: 30, toe: 20 }, armN: { a: -34, b: 52 }, armF: { a: -120, b: 40 }, weaponA: 232, shiftX: -2, phase: 0.9, speed: 0.8 },
  dieFall: { lean: 34, headTilt: -24, legN: { t: 84, k: 122 }, legF: { t: 2, k: 104, toe: 80 }, armN: { a: 8, b: 16 }, armF: { a: 36, b: 8 }, weaponA: 150, phase: 0.2, speed: 0.6 },
  dieDown1: { lean: 88, headTilt: 6, legN: { t: -84, k: 10, toe: 85 }, legF: { t: -88, k: 22, toe: 85 }, armN: { a: 78, b: 8 }, armF: { a: 64, b: 14 }, coatTrail: -84, coatFront: -70, noWeapon: true, dropWeapon: { dx: 22, a: 96 }, phase: 0.5, speed: 0.8 },
  dieDown2: { lean: 90, headTilt: 10, legN: { t: -86, k: 8, toe: 88 }, legF: { t: -90, k: 18, toe: 88 }, armN: { a: 82, b: 6 }, armF: { a: 66, b: 12 }, coatTrail: -86, coatFront: -74, noWeapon: true, dropWeapon: { dx: 22, a: 96 }, phase: 0.75, speed: 0.35 },
  dieDown3: { lean: 90, headTilt: 12, legN: { t: -86, k: 8, toe: 88 }, legF: { t: -90, k: 18, toe: 88 }, armN: { a: 84, b: 4 }, armF: { a: 68, b: 10 }, coatTrail: -88, coatFront: -76, noWeapon: true, dropWeapon: { dx: 22, a: 96 }, phase: 0, speed: 0 },
  /** 納刀: 納めた待機 ← 刀を腰へ運ぶ 3 枚 */
  sheathIdle: { ...POSES.idle0, armN: { a: 4, b: 52 }, noWeapon: true, scabbard: true, hilt: true },
  sheath1: { ...POSES.idle0, lean: 4, armN: { a: 30, b: 92 }, weaponA: -58, scabbard: true, phase: 0.2 },
  sheath2: { ...POSES.idle0, lean: 5, armN: { a: 12, b: 88 }, weaponA: -60, bladeFrac: 0.35, scabbard: true, phase: 0.4 },
  sheath3: { ...POSES.idle0, lean: 3, armN: { a: 2, b: 70 }, noWeapon: true, scabbard: true, hilt: true, phase: 0.6 },
});

// 素材から読み取った姿勢で上書きする（斬り・突き・ダッシュ・被弾・倒れるの前半）
Object.assign(POSES, SAMPLE_POSES);

/** 行動の表: 表示名・コマ（POSES の key）・各コマの時間（ms）・繰り返すか */
export const ACTIONS = [
  { key: "idle", label: "待機", frames: ["idle0", "idle1"], ms: [520, 520], loop: true },
  { key: "walk", label: "歩き", frames: ["walk0", "walk1", "walk2", "walk3"], ms: [120, 120, 120, 120], loop: true },
  { key: "slash", label: "斬り", frames: ["slashWind", "slash1", "slash2", "slashFollow"], ms: [300, 60, 70, 360], loop: false },
  { key: "thrust", label: "突き", frames: ["thrustPrep", "thrust", "thrustRecover"], ms: [320, 180, 300], loop: false },
  { key: "dash", label: "ダッシュ", frames: ["dashStart", "dash1", "dash2", "dash3", "dashEnd"], ms: [90, 70, 70, 70, 240], loop: false },
  { key: "hurt", label: "被弾", frames: ["hurt"], ms: [360], loop: false },
  { key: "death", label: "倒れる", frames: ["dieHit", "dieFall", "dieDown1", "dieDown2", "dieDown3"], ms: [220, 260, 200, 260, 900], loop: false },
  { key: "sheath", label: "納刀", frames: ["sheath1", "sheath2", "sheath3", "sheathIdle"], ms: [180, 160, 200, 800], loop: false },
];

/** 旧来の 10 枚（windup / strike / dash は ACTIONS の代表でも引ける） */
export const FRAME_ORDER = [...new Set(["idle0", "idle1", "walk0", "walk1", "walk2", "walk3", "windup", "strike", "dash", "hurt", ...ACTIONS.flatMap((a) => a.frames)])];
