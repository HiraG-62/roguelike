/**
 * 武器掛けのカードの武器種アイコン。手に持つ絵（public/assets/actor/wpn<武器種>.png の `.held` シート）から
 * 向きを 1 つ選んで切り出して使う（描き下ろさない）。アイコンの絵は手に持つ絵に自動で追随する。
 * renderer の ActorSpriteBank は今の武器種のアトラスしか持たず、取り合いになるので、ここは専用の bank を持つ
 */
import { MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { ACTOR_ART_SCALE, type ActorCell, ActorSpriteBank, actorDir, actorSheet, weaponAtlas } from "./actorSprites";

/** アイコンの枠（論理 px）。カード 48x42 の上 4px から、名前の行の手前まで */
export const ICON_BOX_W = 44;
export const ICON_BOX_H = 26;

const DEG = Math.PI / 180;
/** 斜め（右上がり）で揃える既定の向き。画面の角度は 0 = 右、時計回り */
const DEFAULT_ICON_DEG = -35;
/**
 * 武器種ごとの向き（度）。長物は斜めだと枠の高さ（26px）に収まらないので、ほぼ寝かせる。
 * 槍は寝かせても幅が枠ぎりぎりなので、-11° 付近（幅 88 ドットの向き）にする。実測は weaponIcons.test.ts
 */
const ICON_DEG: Partial<Record<MovesetKey, number>> = {
  spear: -11,
  scythe: 0,
};

/** アイコンの向きの角度（ラジアン）。向きの数 1 のシート（書）は actorDir が 0 に丸める */
export function weaponIconAngle(moveset: MovesetKey): number {
  return (ICON_DEG[moveset] ?? DEFAULT_ICON_DEG) * DEG;
}

/** アイコンに使う `.held` のシートの鍵と向きの番号。アトラスが無い武器種は undefined */
export function weaponIconSheetDir(moveset: MovesetKey): { key: string; dir: number } | undefined {
  const atlas = weaponAtlas(moveset);
  if (atlas === undefined) return undefined;
  const key = `${atlas}.held`;
  const sheet = actorSheet(key);
  if (!sheet) return undefined;
  return { key, dir: actorDir(weaponIconAngle(moveset), sheet.dirs) };
}

const ATLASES = MOVESET_KEYS.map((key) => weaponAtlas(key));
const bank = new ActorSpriteBank();
/** focus は 1 回だけ（ATLASES は変わらないので 2 回目以降は何もしないのに、カードごと・毎フレームに鍵の配列と文字列を作っていた） */
let focused = false;

/** アイコンのアトラスを読み始める（main.ts が描く前に呼ぶ。初めて武器掛けを開いた 1 フレーム目に欠けたカードを見せない） */
export function primeWeaponIcons(): void {
  if (focused) return;
  bank.focus(ATLASES);
  focused = true;
}

/** 武器種のアイコンのセル。アトラスがまだ読めていない・絵が無い間は undefined（呼び側が旧い絵で代わりに描く） */
export function weaponIconCell(moveset: MovesetKey): ActorCell | undefined {
  primeWeaponIcons();
  const pick = weaponIconSheetDir(moveset);
  if (!pick) return undefined;
  return bank.cell(pick.key, pick.dir, 0);
}

/** 切り詰めた矩形を論理 px にした大きさ（等倍。縮小しないので 1 ドットは背面バッファの粒のまま） */
export function weaponIconSize(cell: Pick<ActorCell, "w" | "h">): { w: number; h: number } {
  return { w: cell.w / ACTOR_ART_SCALE, h: cell.h / ACTOR_ART_SCALE };
}
