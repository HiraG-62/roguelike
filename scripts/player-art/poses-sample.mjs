// 素材シートの各コマから読み取った関節の位置（素材の画素、y は下向き）→ リグの角度。
// 位置は切り出しごとの座標で、向き（角度）だけを使う。骨の長さは体格（styles.mjs）のまま。
// N = 手前（剣を持つ腕・前の脚）、F = 奥。mirror は素材で左を向いているコマ（出力も左向きにする）

const deg = (r) => (r * 180) / Math.PI;
const norm = (a) => {
  let v = a;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
};
/** 下 = 0、前（右）= +90 の角度 */
const ang = (a, b) => deg(Math.atan2(b[0] - a[0], b[1] - a[1]));

/** 関節の位置 → 姿勢 */
export function kpToPose(kp, extra = {}) {
  const m = extra.mirror ? -1 : 1;
  const P = {};
  for (const [k, v] of Object.entries(kp)) P[k] = [v[0] * m, v[1]];
  const neckV = [P.neck[0] - P.hip[0], P.neck[1] - P.hip[1]];
  const lean = deg(Math.atan2(neckV[0], -neckV[1]));
  const headA = ang(P.neck, P.head);
  const headTilt = norm(180 - lean - headA);
  const leg = (h, knee, ankle, toe) => {
    const t = ang(h, knee);
    const s = ang(knee, ankle);
    const foot = toe ? ang(ankle, toe) : 90;
    // 正面寄りの素材では横から見ると膝が逆に曲がる読みになるので、自然な向きだけにする
    return { t: norm(t), k: Math.max(4, norm(t - s)), toe: Math.max(-20, Math.min(70, norm(90 - foot))) };
  };
  const arm = (sh, el, hand) => {
    const a = ang(sh, el);
    const f = ang(el, hand);
    return { a: norm(a), b: norm(f - a) };
  };
  const pose = {
    lean: norm(lean),
    headTilt: Math.max(-30, Math.min(30, headTilt)),
    legN: leg(P.hip, P.kneeN, P.ankleN, P.toeN),
    legF: leg(P.hip, P.kneeF, P.ankleF, P.toeF),
    armN: arm(P.shN, P.elbowN, P.handN),
    armF: arm(P.shF, P.elbowF, P.handF),
    ...extra,
  };
  if (P.tip) pose.weaponA = norm(ang(P.handN, P.tip));
  delete pose.mirror;
  if (extra.mirror) pose.mirrorOut = true;
  return pose;
}

/** 読み取った位置（素材の切り出しごとの画素） */
const KP = {
  // 斬り: 振りかぶり（右向き、剣を頭上の後ろへ、左拳を前へ）
  slashWind: {
    kp: { head: [77, 72], neck: [75, 90], hip: [72, 117], kneeN: [115, 130], ankleN: [127, 145], toeN: [137, 150], kneeF: [40, 135], ankleF: [25, 152], toeF: [18, 160], shN: [60, 84], elbowN: [40, 80], handN: [24, 70], tip: [82, 12], shF: [90, 86], elbowF: [106, 88], handF: [118, 89] },
    extra: { phase: 0.1, speed: 0.6, shiftX: -2 },
  },
  // 斬り 1: 低く沈んで回り込む（素材では左向き。剣は後ろ下へ流れる）
  slash1: {
    kp: { head: [27, 42], neck: [38, 55], hip: [62, 74], kneeN: [30, 84], ankleN: [42, 104], toeN: [30, 112], kneeF: [72, 96], ankleF: [58, 116], toeF: [70, 122], shN: [45, 58], elbowN: [56, 66], handN: [67, 75], tip: [155, 125], shF: [42, 58], elbowF: [48, 66], handF: [60, 72] },
    extra: { mirror: true, phase: 0.35, speed: 2.2, coatTrail: -80, lift: 0 },
  },
  // 斬り 2: 大きく踏み込み、前下へ振り下ろす
  slash2: {
    kp: { head: [90, 60], neck: [87, 76], hip: [83, 98], kneeN: [110, 113], ankleN: [123, 130], toeN: [135, 137], kneeF: [50, 107], ankleF: [37, 123], toeF: [26, 130], shN: [96, 80], elbowN: [110, 93], handN: [118, 100], tip: [170, 147], shF: [74, 79], elbowF: [58, 86], handF: [46, 90] },
    extra: { phase: 0.55, speed: 2.6, coatTrail: -78 },
  },
  // 振り抜き: 深く沈んで前へ、剣は後ろへ流す
  slashFollow: {
    kp: { head: [140, 37], neck: [133, 50], hip: [117, 74], kneeN: [148, 90], ankleN: [144, 108], toeN: [158, 112], kneeF: [93, 100], ankleF: [67, 113], toeF: [55, 122], shN: [128, 50], elbowN: [102, 42], handN: [82, 38], tip: [13, 62], shF: [130, 54], elbowF: [118, 64], handF: [104, 62] },
    extra: { phase: 0.8, speed: 1.8, coatTrail: -72 },
  },
  // 突き: 構え（深く沈み、剣先を後ろ下へ）
  thrustPrep: {
    kp: { head: [100, 37], neck: [93, 53], hip: [87, 83], kneeN: [122, 96], ankleN: [114, 117], toeN: [126, 121], kneeF: [63, 110], ankleF: [57, 133], toeF: [48, 143], shN: [82, 58], elbowN: [60, 68], handN: [44, 90], tip: [7, 153], shF: [98, 58], elbowF: [108, 68], handF: [111, 78] },
    extra: { phase: 0.1, speed: 0.4 },
  },
  // 戻り（素材では左向き、低く構え直す）
  thrustRecover: {
    kp: { head: [33, 33], neck: [43, 47], hip: [55, 70], kneeN: [23, 90], ankleN: [17, 110], toeN: [8, 115], kneeF: [77, 93], ankleF: [93, 127], toeF: [100, 134], shN: [48, 50], elbowN: [62, 58], handN: [77, 67], tip: [110, 100], shF: [46, 50], elbowF: [58, 60], handF: [70, 64] },
    extra: { mirror: true, phase: 0.7, speed: 1.0, coatTrail: -70 },
  },
  // ダッシュ: 溜め（大きく前傾、後ろ脚を伸ばす）
  dashStart: {
    kp: { head: [133, 35], neck: [117, 43], hip: [83, 67], kneeN: [120, 80], ankleN: [100, 94], toeN: [110, 100], kneeF: [50, 87], ankleF: [23, 107], toeF: [12, 115], shN: [108, 44], elbowN: [96, 56], handN: [110, 52], tip: [30, 80], shF: [112, 46], elbowF: [124, 56], handF: [134, 52] },
    extra: { phase: 0.1, speed: 1.4, coatTrail: -70 },
  },
  dash1: {
    kp: { head: [320, 37], neck: [300, 42], hip: [260, 67], kneeN: [292, 80], ankleN: [280, 94], toeN: [292, 99], kneeF: [233, 87], ankleF: [207, 100], toeF: [198, 107], shN: [293, 45], elbowN: [276, 54], handN: [288, 50], tip: [197, 78], shF: [296, 46], elbowF: [306, 56], handF: [318, 52] },
    extra: { phase: 0.3, speed: 2.8, coatTrail: -78, lift: -2 },
  },
  dash2: {
    kp: { head: [175, 42], neck: [156, 50], hip: [110, 75], kneeN: [140, 86], ankleN: [116, 100], toeN: [124, 106], kneeF: [85, 90], ankleF: [55, 100], toeF: [40, 104], shN: [150, 53], elbowN: [136, 62], handN: [152, 60], tip: [80, 92], shF: [152, 55], elbowF: [162, 64], handF: [172, 60] },
    extra: { phase: 0.55, speed: 3.2, coatTrail: -84, lift: -4 },
  },
  dash3: {
    kp: { head: [385, 35], neck: [362, 43], hip: [310, 60], kneeN: [345, 70], ankleN: [320, 81], toeN: [328, 88], kneeF: [265, 75], ankleF: [235, 85], toeF: [220, 90], shN: [356, 46], elbowN: [340, 56], handN: [352, 60], tip: [225, 92], shF: [358, 48], elbowF: [368, 58], handF: [378, 56] },
    extra: { phase: 0.8, speed: 3.0, coatTrail: -86, lift: -3 },
  },
  // 踏みとどまり: 前の脚を突っ張り、手を前下へ
  dashEnd: {
    kp: { head: [555, 45], neck: [540, 56], hip: [515, 80], kneeN: [575, 86], ankleN: [590, 105], toeN: [602, 112], kneeF: [485, 96], ankleF: [480, 111], toeF: [468, 116], shN: [546, 58], elbowN: [540, 70], handN: [528, 76], tip: [470, 90], shF: [546, 60], elbowF: [566, 68], handF: [588, 76] },
    extra: { phase: 0.95, speed: 1.6, coatTrail: -60 },
  },
  // 被弾: 頭が後ろへ跳ね、体が反る。腕は前へ投げ出される
  hurt: {
    kp: { head: [37, 27], neck: [50, 38], hip: [67, 73], kneeN: [107, 93], ankleN: [127, 117], toeN: [138, 125], kneeF: [63, 94], ankleF: [57, 120], toeF: [66, 128], shN: [70, 40], elbowN: [90, 37], handN: [110, 43], tip: [128, 12], shF: [56, 42], elbowF: [50, 58], handF: [57, 73] },
    extra: { phase: 0.9, speed: 1.0, coatTrail: -30 },
  },
  // 倒れる 1: 腰を落として前かがみ、腕は垂れる
  dieHit: {
    kp: { head: [76, 40], neck: [70, 52], hip: [65, 80], kneeN: [100, 100], ankleN: [107, 120], toeN: [116, 131], kneeF: [30, 100], ankleF: [17, 120], toeF: [10, 131], shN: [80, 52], elbowN: [90, 67], handN: [95, 80], tip: [100, 125], shF: [62, 52], elbowF: [48, 64], handF: [40, 76] },
    extra: { phase: 0.9, speed: 0.4 },
  },
  // 倒れる 2: 膝をつく
  dieFall: {
    kp: { head: [212, 52], neck: [205, 62], hip: [200, 90], kneeN: [234, 96], ankleN: [240, 125], toeN: [250, 131], kneeF: [172, 112], ankleF: [150, 128], toeF: [140, 128], shN: [210, 64], elbowN: [226, 76], handN: [236, 86], tip: [250, 130], shF: [200, 64], elbowF: [180, 72], handF: [168, 82] },
    extra: { phase: 0.2, speed: 0.4 },
  },
};

export const SAMPLE_POSES = Object.fromEntries(Object.entries(KP).map(([k, v]) => [k, kpToPose(v.kp, v.extra)]));

/** 位置の読み取りが難しいコマ（後ろ姿の突き上げ・伏せ）は角度で直接置く */
Object.assign(SAMPLE_POSES, {
  // 倒れる 1・2 は素材が正面向きで、横から見ると構えに見えてしまうので角度で置く（前かがみのよろめき → 膝をつく）
  dieHit: { lean: 22, headTilt: 26, legN: { t: 22, k: 28, toe: 5 }, legF: { t: -16, k: 30, toe: 25 }, armN: { a: 16, b: 10 }, armF: { a: -8, b: 14 }, weaponA: 18, phase: 0.9, speed: 0.4, coatTrail: -8 },
  dieFall: { lean: 28, headTilt: 28, legN: { t: 78, k: 96, toe: 0 }, legF: { t: 8, k: 96, toe: 75 }, armN: { a: 30, b: 6 }, armF: { a: 12, b: 8 }, weaponA: 34, phase: 0.2, speed: 0.3, coatTrail: -20 },
  thrust: { lean: -4, headTilt: 12, legN: { t: 30, k: 6, toe: 10 }, legF: { t: -30, k: 6, toe: 20 }, armN: { a: 172, b: 4 }, armF: { a: 160, b: 12 }, weaponA: 180, phase: 0.4, speed: 1.6, coatTrail: -20, lift: -3 },
  dieDown1: { lean: 72, headTilt: 18, legN: { t: 84, k: 150, toe: 80 }, legF: { t: 70, k: 150, toe: 80 }, armN: { a: 20, b: 10 }, armF: { a: 40, b: 8 }, noWeapon: true, dropWeapon: { dx: 18, a: 100 }, phase: 0.4, speed: 0.6, coatTrail: -70, coatFront: 10 },
});
