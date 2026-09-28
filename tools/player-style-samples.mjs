// 比較専用。ゲームのアトラスは変更せず、既存のラスタライザと歩行の骨組みを使う。
import { ColorFrame, paint, polygon, capsule, ellipse, px, finish } from '../scripts/actor/paint.mjs';
import { bodySheets } from '../scripts/actor/rig.mjs';
import { ATLAS as current } from '../scripts/actor/sheets/bodyNone.mjs';

const steel = ['#303749','#65758b','#acbdcd','#eef4ea'];
const gold = ['#51402d','#907344','#c6a969','#f3dfa1'];
const skin = ['#815343','#bb896f','#dfb18d','#f4d9b2'];
const dark = ['#171b29','#2b3043','#444e65','#6c7c93'];
export const samples = [
  { id: 'current', name: '現行の探索者', tag: 'REFERENCE', text: '丸い頭巾と短い肩掛け。今のシルエットとの比較用。', color: '#7ea6a1', sheets: current.sheets },
  { id: 'noir', name: '黒衣の剣士', tag: '01 / NOIR', text: '小さな頭部、立ち襟、割れた長衣。細い縦のラインと銀髪で鋭さを出す。', color: '#9caccb', cloth: dark, accent: ['#352336','#60394f','#985169','#cf8092'] },
  { id: 'ivory', name: '白銀の騎士', tag: '02 / IVORY', text: '非対称の肩鎧と白いマント。明るい装甲を暗い胴に重ねた端正な姿。', color: '#e1c78f', cloth: ['#494858','#8b909c','#c8cbd0','#f0ece0'], accent: ['#21313d','#365768','#59818a','#90b5b0'] },
  { id: 'scarlet', name: '赤布の狩人', tag: '03 / SCARLET', text: '長く流れる赤いスカーフ、軽装と高いブーツ。動いたときの抜けのよさを重視。', color: '#df897c', cloth: ['#242638','#41445b','#646b80','#919cac'], accent: ['#4c202d','#8d3541','#c75a59','#ec9a7b'] },
  { id: 'wraith', name: '仮面の探索者', tag: '04 / WRAITH', text: '尖ったフードと骨色の仮面。青緑の裏地を覗かせる、不気味で静かな存在感。', color: '#77c9bc', cloth: ['#17292d','#2b474a','#426466','#698e8b'], accent: ['#193b40','#28676a','#46a29b','#92ddd0'] },
];

function draw(f, sk, v) {
  const h = { x: sk.head.x, y: sk.head.y - 2 };
  const c = { x: sk.chest.x, y: sk.chest.y - 2 };
  const hip = sk.hip;
  const sway = sk.ps.sway * 3;
  const poly = (points, mat, opts) => paint(f, polygon(points), mat, opts);
  const line = (a, b, r, mat) => paint(f, capsule(a.x, a.y, b.x, b.y, r), mat);
  // 布の輪郭も案ごとに変える。首から裾まで一枚の色面にしない。
  if (v.id !== 'scarlet') {
    poly([[c.x-5,c.y-5],[c.x+2,c.y-4],[hip.x+1,-5],[hip.x-7-sway,-3],[hip.x-5-sway,-10],[hip.x-12-sway,-5],[c.x-8,c.y+4]], v.cloth);
    poly([[c.x-5,c.y],[hip.x-7-sway,-5],[hip.x-9-sway,-7],[c.x-7,c.y+1]], v.accent);
  }
  if (v.id === 'scarlet' || v.id === 'noir') {
    poly([[c.x-2,c.y-4],[c.x-12,c.y-5],[c.x-23-sway,c.y-11],[c.x-18-sway,c.y-4],[c.x-24-sway,c.y-3],[c.x-11,c.y],[c.x,c.y-1]], v.accent);
  }
  for (const side of ['B','F']) {
    const knee = sk['knee'+side], foot = sk['foot'+side];
    line(sk['hip'+side], knee, 2.1, dark);
    line(knee, {x:foot.x,y:foot.y-2}, 2, dark);
    line({x:knee.x,y:knee.y+1}, {x:foot.x,y:foot.y-2}, 2.5, v.id === 'ivory' ? steel : dark);
    paint(f, ellipse(foot.x+1.5,foot.y-1.3,3.5,1.5), dark);
  }
  poly([[c.x-5,c.y-5],[c.x+4,c.y-5],[c.x+5,c.y],[hip.x+3,hip.y+1],[hip.x-3,hip.y+1],[c.x-5,c.y+1]], dark);
  poly([[c.x-4,c.y-5],[c.x,c.y-3],[hip.x-1,hip.y],[hip.x-4,hip.y-1]], v.cloth);
  poly([[c.x+1,c.y-4],[c.x+4,c.y-4],[hip.x+4,hip.y],[hip.x+1,hip.y]], v.cloth);
  line({x:hip.x-4,y:hip.y},{x:hip.x+4,y:hip.y},1,gold);
  line({x:c.x-3,y:c.y-3},{x:hip.x+3,y:hip.y-2},0.7,gold);
  if (v.id === 'ivory') {
    poly([[c.x-7,c.y-7],[c.x-2,c.y-6],[c.x,c.y-2],[c.x-6,c.y]], steel);
    poly([[c.x,c.y-3],[c.x+4,c.y-3],[c.x+3,c.y+2],[c.x,c.y+4]], steel);
  }
  line({x:c.x+3,y:c.y-2},{x:c.x+6,y:c.y+4},1.8,v.cloth);
  line({x:c.x+6,y:c.y+4},{x:c.x+9,y:c.y+5},1.6,dark);
  // 全案を同じ低い剣の構えで比較。
  line({x:c.x+9,y:c.y+3},{x:c.x+10,y:c.y+9},1,gold);
  poly([[c.x+10,c.y+6],[c.x+28,c.y+13],[c.x+32,c.y+16],[c.x+26,c.y+15],[c.x+10,c.y+8]],steel);
  paint(f,ellipse(c.x+9,c.y+5,1.8,1.8),dark);
  line({x:c.x,y:c.y-5},{x:h.x,y:h.y+4},2,skin);
  if (v.id === 'wraith') {
    poly([[h.x-7,h.y+5],[h.x-7,h.y-3],[h.x-2,h.y-11],[h.x+5,h.y-6],[h.x+7,h.y+5]],v.cloth);
    poly([[h.x-2,h.y-5],[h.x+5,h.y-4],[h.x+5,h.y+2],[h.x+1,h.y+6],[h.x-2,h.y+1]],['#565963','#989a94','#d2d3bb','#f3efd3']);
    line({x:h.x,y:h.y-1},{x:h.x+1,y:h.y},0.6,dark);
    px(f,h.x+4,h.y-1,'#17232b');
  } else {
    paint(f,ellipse(h.x+1,h.y,4.6,5.8),skin);
    const hair = v.id === 'noir' ? steel : v.id === 'ivory' ? gold : dark;
    poly([[h.x-5,h.y+1],[h.x-6,h.y-5],[h.x-2,h.y-8],[h.x+3,h.y-7],[h.x+7,h.y-4],[h.x+4,h.y-3],[h.x+3,h.y],[h.x+1,h.y-4],[h.x-1,h.y-1],[h.x-2,h.y-4],[h.x-3,h.y+3]],hair);
    px(f,h.x+3,h.y,'#17202c');
    px(f,h.x+4,h.y,'#17202c');
    if (v.id === 'scarlet') line({x:h.x-3,y:h.y+4},{x:h.x+4,y:h.y+5},1.5,v.accent);
  }
  if (v.id === 'noir') poly([[c.x-5,c.y-7],[c.x-3,c.y-2],[c.x+4,c.y-3],[c.x+5,c.y-8],[c.x+2,c.y-5]],v.cloth);
}

for (const v of samples.slice(1)) v.sheets = bodySheets(v.id, (f, sk) => draw(f, sk, v));

export function renderFrame(sample, action, index) {
  const sheet = sample.sheets.find(s => s.key.endsWith('.' + action));
  const f = new ColorFrame(sheet.w, sheet.h, sheet.ox, sheet.oy);
  sheet.draw(f, index % sheet.frames);
  if (sample.id === 'current') {
    const [x,y] = f.anchors.shoulderF;
    paint(f,capsule(x,y,x+6,y+7,2),['#33221f','#553729','#77503a','#946c4c']);
    paint(f,ellipse(x+7,y+8,2,2),dark);
    paint(f,polygon([[x+8,y+8],[x+26,y+15],[x+30,y+18],[x+24,y+17],[x+8,y+10]]),steel);
    paint(f,capsule(x+7,y+6,x+8,y+12,1),gold);
  }
  finish(f);
  return f;
}
