/**
 * 下りの階段の章別の絵（docs/ideas/map-visual-impl.md 3 章）。密度 2・1 マス（32x32 ドット）。
 * 色は置物の役の文字（mapProps.ts の MAP_PROP_ROLES）に奥の闇の 2 つ（STAIRS_ROLES の y / z）を足して書き、
 * 章のテーマの MapPalette で塗る（render/stairsArt.ts）。
 * 階段は焼かずに上描きで毎フレーム描く。光（mapLight の階段の光）と出口の予告（exitUi）はマスの中心を使うので、絵は 1 マスに収める。
 * 光源は左上。段は下（南）へ降りるほど暗くし、底は奥の闇（z）。
 *
 * キー: moss（岩の裂け目に掘った段と蔓）/ temple（石段と石灯籠の欠片）/ castle（崩れた石の螺旋。炎と霜で配色だけ変わる）/
 * deep（奈落へ浮く石と燐光）/ final（墨の階と朱の印）。SPRITES に合流しない（PALETTE の文字ではないため）
 */
import type { MapPalette, MapStyle } from "../../render/mapTypes";
import { MAP_PROP_ROLES, type MapPropRole } from "./mapProps";

/** 階段の絵の一辺のドット数（1 マス = 論理 16px の密度 2） */
export const STAIRS_DOTS = 32;

/**
 * 階段の役の文字。置物の役（同じ意味）に、穴の奥の闇を足す。
 * y / z は門前町の役（townProps.ts）とも重ならない文字を選んでいる
 */
export const STAIRS_ROLES = {
  ...MAP_PROP_ROLES,
  y: { from: "v2", shade: 0 }, // 奥の闇（岩盤の闇の 2 段目）
  z: { from: "vD", shade: 0 }, // 奥の闇の最暗（段の底・奈落）
} as const satisfies Readonly<Record<string, MapPropRole>>;

/** 絵のある様式（拠点は今の絵のまま） */
export type StairsStyle = Exclude<MapStyle, "town">;

export interface StairsSprite {
  /** 行の文字列（STAIRS_DOTS 四方）。'.' は透明、それ以外は STAIRS_ROLES の文字 */
  readonly rows: readonly string[];
  /** 輪郭 k の代わりに当てる色 */
  readonly outline?: keyof MapPalette;
}

const MOSS: StairsSprite = {
  rows: [
    "................................",
    "..............kk................",
    "..........kkkkHHkkkkk...........",
    "........kkmMHHHSHHHmMkkk........",
    "......kkmMHHHHMESmmmMSSSk.......",
    ".....kHMmMHHHEEEEEMmMSSBSkk.....",
    ".....kmMmMmEEHHHSSSmMmBBBBSk....",
    ".....kHHmMMSSSSSSSSSmMEBBBSSk...",
    "....kHHmmmMSSSSSEmmmMSSEEEBBBk..",
    "...kHHHEMmMEEEEEEEMEmMEEEDBBBk..",
    ".kkHHHEEEEEESSSSSSSSmMmSEEEBBk..",
    ".kHHHHEESSSSBBBBBBBBmMMBSSSEBBk.",
    ".kHHHEEBBBBBBBBBBBmmmMBBBBBDDDk.",
    "kHHHHEEBBBBBEEEEEEEMmMEEBBBDDDk.",
    ".kHHHEEEEEEEzzzzzzzzmMmzEEEDBk..",
    ".kHHHEEBBBBBBBBBzzzmMBMBBBBDDk..",
    ".kHHEEDDDDDDDDDDBmmmMDDDDDDDDk..",
    ".kHHEEDDDDDDDDDDDDMmMDDDDDDDDk..",
    ".kHHzzzzzzzzzzzzDDDDzzzzzzzEDDk.",
    ".kHHEzzzzzzzzzzzzzzzzzzzzzEDDk..",
    ".kSSSEzDDDDDDDDDDDDDzzzzzzEDDk..",
    ".kkSSSzzEEEEEEEEEEEEDDDDDDEDDk..",
    "...kSSEzEEEEEEEEEEEEEEEEEEDDk...",
    "....kSSEzzzzzzzzzzzzEEEEDDDk....",
    ".....kSBEEzzzzzzzzzzzzEDDDk.....",
    ".....kBBBBEzzEzzzzzzzEDDDDk.....",
    "......kSBBBEEBEEEEEEEDDDDk......",
    ".......kBBBBBBDDDDDDDDDkk.......",
    "........kkBBkkkDDDDDkkk.........",
    "..........kk...kkkkk............",
    "................................",
    "................................",
  ],
};

const TEMPLE: StairsSprite = {
  rows: [
    "................................",
    "................................",
    "..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..",
    "..kSSSSSSSBSSSSSSSSBSSSSSSSBBk..",
    "..kSSSSSSSBSSSSSSSSBSSSSSSSBBk..",
    "..kSSEHHHHHHHHHHHSSHHHHHHHHBBk..",
    "..kSSESSSSSSSSSSSSSSSSSSSSSBBk..",
    "..kSSESSSSSSSSSSSSSSSSSSSSSBBk..",
    "..kSSEDDDDDDDDDDDDDDDDDDDDDBBk..",
    "..kSSEEEEEEEEEEEEEEEEEEEEEEBBk..",
    "..kSSEESSBSSSSSSSSSSSSSSSSSBBk..",
    "..kBBEEBBBBBBBBBBBBBBBBBBBBEEk..",
    "..kSSEEBBBBBBBBBBBBBBBBBBBBBBk..",
    "..kSSEEEEEEEEEEEEEEEEEEEEEEBBk..",
    "..kSSEEEEEEEEEEEEEEEEEEEEEEBBk..",
    "..kSSzzzBBBBBBBBBBBBBBDBBBDBBk..",
    "..kSSzzzDDDDDDDDDDDDDDDDDDDBBk..",
    "..kSSzzzDDDDDDDDDDDDDDDDDDDBBk..",
    "..kSSzzzEEEEEEEEEEEEEEEEEEDBBk..",
    "..kBBzzzzzzzzzzzzzzzzzzzzzDEEk..",
    "..kSSzzzzDDDDDDDDDDDDDDDDDDBBk..",
    "..kSSzzzzEEEEEEEEEEEEEEkkkkkkk..",
    "..kSSzzzzEEEEEEEEEEEEEkHHSSSBk..",
    "..kSSzzzzzzzzzzzzzzzzkHSSSSBBDk.",
    "..kSSzzzzzzzzzzzzzzzzkkkkkkkkkk.",
    "..kSSzzzzzzzzzzzzzzzzzkSkYLkDk..",
    "..kSSzzzzzzzzzzzzzzzzzkSkLlkDk..",
    "..kDDDDDDDEDDDDDDDDEDDkBkllkEk..",
    "..kDDDDDDDEDDDDDDDDEDkSSBBBDDEk.",
    "..kkkkkkkkkkkkkkkkkkkkkkkkkkkkk.",
    "................................",
    "................................",
  ],
};

/** 廃城の炎 / 霜は同じ形（配色で燠と氷に分かれる） */
const CASTLE: StairsSprite = {
  rows: [
    "................................",
    ".............kkkkkk.............",
    "..........kkkHHHEHHkkk...kkkk...",
    "........kkEHHHHHEHHHHHk..kHSk...",
    ".......kHHHESSSSESSSSEk..kSBk...",
    "......kHHSSzzzzzzzzzzSk..kkkk...",
    ".....kEHSSzzzzEEzzzzzzBk........",
    "....kHHEzzzEEEEzzzzzzlzzk...kkk.",
    "...kHHSEzzEEEEEzzzzLzzzzzk..kSk.",
    "...kHSSEzzEEEEEzzzlzlzzzzBk.kkk.",
    "..kHHSEEDzEEEEEzzzzzzzzzzzk.....",
    "..kEEEEDDDzEEEEzzzzzzzlzzzzk....",
    "..kHSEEDDDzzEEEzzzzzzzzzzzzk....",
    ".kHHSEEDDDDzzEESSzzzzzzzLzzk....",
    ".kHHSEDDDDDDDzSSSDzzzzzzzzzk....",
    ".kHHSzDDDDDDDSSSDDDzzzzzzzzk....",
    ".kHHSzzzDDDDDSSDDDDzzzzzzzzk....",
    ".kHHSDBzzzzzBBDDDDHHBzzzzzzk....",
    ".kHHSDDBBBBBBBBDDDHHHBBzzzzDkk..",
    "..kHSDDBBBBBBBESSDHHHHBBzzzDBk..",
    "..kHSDDBBBBBBESSSDHHHHHBBzzDBk..",
    "..kHHEDDBBBBEESSSSHHHHHHBBDBBk..",
    "...kESBDDBBEESSSSSDHHHHSBDEBk...",
    "...kHSBDDEESSSSSSDDHHHSSSDBEk...",
    "....kSSBEEBSSSSSSDDHHSSSDBBk....",
    ".....kSSEBBBBBSSSDSSSSEDBBk.....",
    "......kESDDBBBBBBDSSSDDEBk......",
    ".......kBBBDDEDDDDDDDBBEk.......",
    "........kkBBBBBBBBEBBBkk........",
    "..........kkkBBBBBEkkk..........",
    ".............kkkkkk.............",
    "................................",
  ],
};

const DEEP: StairsSprite = {
  rows: [
    "................................",
    "................................",
    "................................",
    "..........kkkkkkkkkk............",
    "..........kBBBBBBBBBk...........",
    ".........kDDDDDDDDDDBkkkk.......",
    ".......kkBEEEEEEEEEEDBBBBkk.....",
    "...kkkkkkkkkkkzzzzzzEDDDDBk.....",
    "...kHHSSSSSSSkzzzzzzzEEEEDDk....",
    "...kSSSSSSSSBkzzzzzzzzzzzEEk....",
    "...kDDDDDDDDDkzzzzzzzzzzzzyDk...",
    "..kkDDDDDDDDDkzzzzzzzzzzzzzEBk..",
    "...kkkkkkkkkkkkkkkkkkzzzzzzyDBk.",
    "..kEzzzzlzzkHHSSSSSSkzzzzzzzEDk.",
    "..kyzzzzzzzkSSSSSSSBkzzzzzzzyk..",
    "..kyzzzzzzzkDDDDDDDDkzzzzzzzyk..",
    ".kyyzzzzzzlkDDDDDDDDkzzzzzzLyyk.",
    ".kyyzzzzzzzkkkkkkkkkkkkkkzzzyyk.",
    ".kyyzzzzzzzzzzzzlkHHBBBBkzzzyk..",
    ".kkyzzzzzzzzzzzzzkBBBBBDkzzzyk..",
    "...kzzzzzzzzzzzzzkEEEEEEkzzzyk..",
    "...kyzzzLzzzzzzzzkEEEEEEkzzyyk..",
    "..kyyzzzzzzzzzzzzkkkkkkkkkkyyk..",
    "..kkyyzzzzzzzzzzzzzzzkHHBBkykk..",
    "....kyzzzzzzzzzzzzzzzkBBBDkk....",
    ".....kyzzzzzzzzzzzzzzkEEEEk.....",
    "......kyyzzzzzzlzzzzzkEEEEk.....",
    "......kkkyzzzzzzzzzzzkkkkkk.....",
    ".........kyyyzzzzzzyLykk........",
    "..........kyyykkkkyykk..........",
    "...........kkk....kk............",
    "................................",
  ],
};

const FINAL: StairsSprite = {
  rows: [
    "................................",
    "................................",
    "................................",
    "................................",
    "....kkkkkkkkkkkkkk.k.k..........",
    "...kSSSSSSSSSSSSSSkk............",
    "...kBBBBBBBBBBBBBk........kk....",
    "....kBBBBBBBBBBBBBkk............",
    "...kDDDDDDDDDDDDDDk.............",
    "...kkkkkEEEEEEEEEEk.............",
    "........kLLHHHHHHHHk.kkkk.......",
    ".......kSSSSSSSSSSSSkk..........",
    ".......kBBBBBBBBBBBBk..k........",
    "....kk..kBBBBBBBBBBBk...........",
    ".......kDDDDDDDDDDDDDk..........",
    ".......kkkkkEEEEEEEEEk..........",
    "............kLLHHHHHHHk..k.k....",
    "...........kSSSSSSSSSSSk........",
    "...........kBBBBBBBBBBk....k....",
    "............kBBBBBBBBBBkkk......",
    "...........kDDDDDDDDDDDDk.......",
    "...........kkkkkEEEEEEEEk.......",
    "................kLLHHHHHk.......",
    "...............kSSSSSSSSSk.k....",
    ".............kkBBBBBBBBBkkkkkkk.",
    "..........kkkEzzBBBBBBBBkAARRrk.",
    "........kkEEzzzzzzzzzzzzkARkkrk.",
    ".........kEEEzzzzzzzzzzzkRkRkrk.",
    ".........kEEzzzzzzzzzzzzkRkkRrk.",
    "..........kEEzzzzzzzzzzzkrrrrrk.",
    "...........kkkkkkkkkkkkkkkkkkkk.",
    "................................",
  ],
};

export const STAIRS_SPRITES: Readonly<Record<StairsStyle, StairsSprite>> = {
  moss: MOSS,
  temple: TEMPLE,
  castleFire: CASTLE,
  castleFrost: CASTLE,
  deep: DEEP,
  final: FINAL,
};
