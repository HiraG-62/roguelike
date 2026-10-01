// 手前の縁（lip）を描き直す範囲（docs/ideas/map-visual-impl.md 1-5 節）。
// lip の画素は ground に焼いた画素と同じなので、上に何も描かれていない所で描き直しても見た目は変わらない。
// 描き直しが要るのは、縁の後ろへ回したい体（自分・敵・拾い物・床の物）と重なる所だけ。純関数（state は読むだけ）。
import type { GameState } from "../core/state";
import { TILE_SIZE, Tile, getTile } from "../map/grid";
import type { LightView } from "./mapLight";

/** 体の矩形の余白（論理 px）。スプライトは当たりの半径より横に広い */
export const LIP_BODY_PAD_X = 16;
/** 体の中心から上へ（半径に足す）。縁は足元にしか出ないので足元より少し上まで */
export const LIP_BODY_PAD_UP = 4;
/** 体の中心から下へ（半径に足す）。床へ張り出す 3px と壁の天面の帯 7px を覆う */
export const LIP_BODY_PAD_DOWN = 10;
/** 拾い物・床の物の半径（論理 px。当たりを持たないので見た目の大きさ） */
export const LIP_ITEM_RADIUS = 8;

/** 矩形（ワールド座標）の近くに、北が壁でない壁のマス（= 南の壁の上端。縁が出る所）がある。縁は上端の 3px 手前にも出るので 1 マス広げて見る */
function nearWallTop(state: GameState, x: number, y: number, w: number, h: number): boolean {
  const { map } = state;
  const x0 = Math.floor(x / TILE_SIZE) - 1;
  const y0 = Math.floor(y / TILE_SIZE) - 1;
  const x1 = Math.floor((x + w) / TILE_SIZE) + 1;
  const y1 = Math.floor((y + h) / TILE_SIZE) + 1;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (getTile(map, tx, ty) === Tile.Wall && getTile(map, tx, ty - 1) !== Tile.Wall) return true;
    }
  }
  return false;
}

/** 体 1 つの矩形が画面に掛かり、壁の近くにあれば out へ足す */
function pushBody(out: LightView[], state: GameState, view: LightView, cx: number, cy: number, radius: number): void {
  const half = radius + LIP_BODY_PAD_X;
  const x = cx - half;
  const y = cy - radius - LIP_BODY_PAD_UP;
  const w = half * 2;
  const h = radius * 2 + LIP_BODY_PAD_UP + LIP_BODY_PAD_DOWN;
  if (x + w <= view.x || x >= view.x + view.w || y + h <= view.y || y >= view.y + view.h) return;
  if (!nearWallTop(state, x, y, w, h)) return;
  out.push({ x, y, w, h });
}

/** 矩形どうしが重なる・接する（ドットの切り揃えで 1px 食い込むので、1px の余裕を見る） */
function touching(a: LightView, b: LightView): boolean {
  return a.x <= b.x + b.w + 1 && b.x <= a.x + a.w + 1 && a.y <= b.y + b.h + 1 && b.y <= a.y + a.h + 1;
}

/** 重なる矩形を 1 つの外接矩形に束ねる（描き直しで暗がりが 2 回掛からないよう、結果は互いに重ならない） */
function mergeTouching(rects: LightView[]): void {
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < rects.length && !again; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b || !touching(a, b)) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        rects[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        rects.splice(j, 1);
        again = true;
        break;
      }
    }
  }
}

/**
 * 縁を描き直す矩形（ワールド座標）。自分・敵・拾い物・床の物のうち、画面に掛かり壁の近くにあるものだけ。
 * 重なる矩形は束ねて互いに重ならない形で返す。体が縁に掛からないフレームは空（縁の描き直しを丸ごと省く）。out は呼び出し側が毎回使い回す
 */
export function lipRects(state: GameState, view: LightView, out: LightView[]): LightView[] {
  out.length = 0;
  const me = state.player.body;
  pushBody(out, state, view, me.pos.x, me.pos.y, me.radius);
  for (const e of state.enemies) {
    if (e.hidden) continue;
    pushBody(out, state, view, e.body.pos.x, e.body.pos.y, e.body.radius);
  }
  for (const pk of state.pickups) pushBody(out, state, view, pk.pos.x, pk.pos.y, LIP_ITEM_RADIUS);
  for (const fi of state.floorItems) pushBody(out, state, view, fi.pos.x, fi.pos.y, LIP_ITEM_RADIUS);
  mergeTouching(out);
  return out;
}
