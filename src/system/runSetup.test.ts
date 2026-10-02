import { describe, expect, it } from "vitest";
import { ORIGIN, RUN_MOD } from "../data/tuning";
import { ORIGINS, RUN_MODS } from "./runSetup";

/**
 * 起点と縛りの説明文（ui/origin.ts が出す）は数値を直書きせず、balance/world の ORIGIN / RUN_MOD から組む。
 * JSON を調整したのに文が古いまま、を防ぐ
 */

const WARI = 10;
const wari = (ratio: number): string => `${Math.round(Math.abs(ratio) * WARI)} 割`;

describe("起点と縛りの説明文", () => {
  it("起点の銭・深度・刻印符の数・生命の割合が ORIGIN の値と一致する", () => {
    expect(ORIGINS.cursedOne.desc).toContain(`呪い付きの祝福を ${ORIGIN.cursedBoons} つ`);
    expect(ORIGINS.cursedOne.desc).toContain(`銭を ${ORIGIN.cursedCoins} 得る`);
    expect(ORIGINS.unarmed.desc).toContain(`地下 ${ORIGIN.unarmedUnsealDepth} 階`);
    expect(ORIGINS.unarmed.desc).toContain(`銭を ${ORIGIN.unarmedCoins} 得る`);
    expect(ORIGINS.chanter.desc).toContain(`刻印符を ${ORIGIN.chanterRunes} つ`);
    expect(ORIGINS.chanter.desc).toContain(`${wari(1 - ORIGIN.chanterHpMul)}減る`);
    expect(ORIGINS.reaperFriend.desc).toContain(`銭を ${ORIGIN.reaperFriendCoins} 得る`);
  });

  it("縛りの割合と秒が RUN_MOD の値と一致する", () => {
    expect(RUN_MODS.thickHide.desc).toContain(`${wari(RUN_MOD.thickHideHpMul - 1)}増える`);
    expect(RUN_MODS.quickHands.desc).toContain(`${wari(RUN_MOD.quickHandsCut)}縮む`);
    expect(RUN_MODS.hastyReaper.desc).toContain(`${wari(1 - RUN_MOD.hastyReaperMul)}縮む`);
    expect(RUN_MODS.glassBody.desc).toContain(`${wari(1 - RUN_MOD.glassBodyHpMul)}減る`);
    expect(RUN_MODS.hourglass.desc).toContain(`${RUN_MOD.hourglassTime} 秒`);
  });
});
