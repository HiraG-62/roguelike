// 戦鎚（ウォーハンマー）: 長柄の先に巨大な角ばった鎚頭、反対に嘴状の突起、頭の先に短い棘。
// 鎚頭は鋼の打面に黒鉄の胴、金の帯金と鋲で締める。柄は鉄の当て板と帯金、尻に重りの石突。
// 片頭なので写しの絵（heldM）も持つ。打面は正準の -y（上）側、嘴は +y 側
import { capsule, ellipse, paint, polygon, px, union } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, WOOD, grip, shaft, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから柄の尻の側へ） */
const OFF_GRIP = -11;
/** 鎚頭の中心（柄の上） */
const HEAD_X = 26;
/** 鎚頭の胴の半幅（柄の向き） */
const HEAD_HALF = 6.5;

function draw(frame) {
  // 柄: 木の芯、握りの間は革巻き、鎚頭の下に鉄の当て板
  shaft(frame, -17, HEAD_X, 1.7, WOOD, [-14, 10], DARK_STEEL);
  grip(frame, -13, 3, 1.8, LEATHER, 3);
  paint(frame, capsule(12, 0, HEAD_X - 4, 0, 2), DARK_STEEL, { bias: 0.1 });
  px(frame, 14, -0.8, DARK_STEEL[3]);
  px(frame, 18, -0.8, DARK_STEEL[3]);
  // 石突: 重りの鉄塊
  paint(frame, union(capsule(-20, 0, -16, 0, 2.6, 2.2), ellipse(-20.5, 0, 2.2, 2.2)), DARK_STEEL);
  paint(frame, capsule(-17.2, 0, -16.2, 0, 2.8), GOLD);

  // 嘴: 胴から反対へ伸び、柄の尻の側へわずかに曲がる鋭い突起
  paint(
    frame,
    polygon([[HEAD_X - 4.5, 3], [HEAD_X + 4.5, 3], [HEAD_X + 3, 7], [HEAD_X + 0.5, 11], [HEAD_X - 2.5, 14.5], [HEAD_X - 5, 16.5], [HEAD_X - 3.6, 12], [HEAD_X - 3.4, 7]], { round: 1.4, tilt: { nx: 0.1, ny: 0.3 } }),
    DARK_STEEL,
  );
  paint(frame, polygon([[HEAD_X - 2.2, 5], [HEAD_X - 0.4, 5], [HEAD_X - 2.2, 12], [HEAD_X - 3.6, 14.2]]), STEEL, { rim: false, maxShade: 2 });

  // 胴: 柄を包む黒鉄の角ばった塊
  paint(frame, polygon([[HEAD_X - HEAD_HALF, -5], [HEAD_X + HEAD_HALF, -5], [HEAD_X + HEAD_HALF - 1, 4], [HEAD_X - HEAD_HALF + 1, 4]], { round: 1.6 }), DARK_STEEL, { bias: 0.1 });
  // 打面の塊: 胴より一回り大きい鋼の角柱。上の縁は面取り
  const face = [
    [HEAD_X - 9, -5.5],
    [HEAD_X + 9, -5.5],
    [HEAD_X + 9.5, -14],
    [HEAD_X + 8, -16],
    [HEAD_X - 8, -16],
    [HEAD_X - 9.5, -14],
  ];
  paint(frame, polygon(face, { round: 2, tilt: { nx: 0.05, ny: -0.2 } }), STEEL);
  // 打面（先端の平らな面）: 明るい帯
  paint(frame, polygon([[HEAD_X - 7.5, -16], [HEAD_X + 7.5, -16], [HEAD_X + 7, -14.6], [HEAD_X - 7, -14.6]]), STEEL, { minShade: 2, maxShade: 3, rim: false, bias: 0.3 });
  // 打面の格子の刻み（滑り止めのぎざ）
  for (let x = HEAD_X - 6; x <= HEAD_X + 6; x += 3) px(frame, x, -15.4, STEEL[1]);
  // 帯金: 打面の塊と胴の境に金の太い帯、鋲 3 つ
  paint(frame, polygon([[HEAD_X - 9.6, -8.4], [HEAD_X + 9.6, -8.4], [HEAD_X + 9.6, -5], [HEAD_X - 9.6, -5]], { round: 1 }), GOLD);
  for (const dx of [-6, 0, 6]) {
    paint(frame, ellipse(HEAD_X + dx, -6.6, 1.1, 1.1), GOLD, { bias: 0.25, rim: false });
  }
  // 側面の艶（左上の縁）
  paint(frame, polygon([[HEAD_X - 8.2, -13.5], [HEAD_X - 7, -13.5], [HEAD_X - 7, -9.5], [HEAD_X - 8.2, -9.5]]), STEEL, { minShade: 3, maxShade: 3, rim: false });
  // 頭の先の短い棘
  paint(
    frame,
    (x, y) => {
      const t = (x - (HEAD_X + HEAD_HALF - 1)) / 8;
      if (t < 0 || t > 1) return null;
      const w = 2.2 * (1 - t) + 0.1;
      if (Math.abs(y) > w) return null;
      return y < 0 ? { nx: 0.2, ny: -0.8 } : { nx: 0.2, ny: 0.6 };
    },
    STEEL,
  );
  // 胴の鋲（柄を留める）
  px(frame, HEAD_X - 3, 0, GOLD[3]);
  px(frame, HEAD_X + 3, 0, GOLD[3]);
}

export const ATLAS = {
  key: "wpnHammer",
  sheets: weaponSheets("wpnHammer", draw, { size: 84, edge: true }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "heavy", restDeg: -55, restHand: [7, 9], swayDeg: 2, restMirror: true } },
};
