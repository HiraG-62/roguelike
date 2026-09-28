// imagegenで描き直した原画を実寸へ整える。原画はそのまま保存する。
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from './fx/png.mjs';
const source=decodePng(readFileSync('public/assets/player-redesign/noir64-source.png'));
if(source.width!==1448||source.height!==1086)throw Error('原画サイズが変わったため切り出し位置の再確認が必要');
const palette=['#12121b','#22222a','#33323b','#494650','#655d66','#89838d','#b8b4be','#eee8ed','#36202b','#552732','#79343f','#a94e5b','#633f36','#986b51','#bf9270','#e7bd9d','#f5d6b7','#453d37','#71604e','#aa9070','#3c4452','#677184','#99a4b4','#d1dae1'].map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
const height=Number(process.argv[2] ?? 64);
if(![48,64].includes(height))throw Error('身長は48または64を指定');
const cell=height*1.5,center=cell/2,ground=height*1.25;
const W=cell*4,H=cell*3,out=new Uint8Array(W*H*4);
const rows=[[42,381,374],[398,706,698],[718,1052,1042]];
// 大きい踏み込みだけ横幅を広く取る（全コマの縮尺は同じ）。
const regions=[[[0,362],[362,724],[724,1086],[1086,1448]],[[0,362],[362,724],[724,1086],[1086,1448]],[[0,329],[337,771],[738,1144],[1146,1448]]];
const scale=height/310;
const colors=new Map();
function color(r,g,b){const key=(r<<16)|(g<<8)|b;if(colors.has(key))return colors.get(key);let best=palette[0],dist=Infinity;for(const c of palette){const d=(c[0]-r)**2+(c[1]-g)**2+(c[2]-b)**2;if(d<dist){dist=d;best=c;}}colors.set(key,best);return best;}
for(let row=0;row<3;row++)for(let col=0;col<4;col++){
  const [left,right]=regions[row][col],[top,bottom,baseline]=rows[row];
  const w=right-left,h=bottom-top,mask=new Uint8Array(w*h),seen=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)mask[y*w+x]=source.rgba[((top+y)*source.width+left+x)*4+3]>=48?1:0;
  // 余白に入った隣コマの刃先や孤立ノイズを除く。主な連結領域だけを切り出す。
  let largest=[];
  for(let i=0;i<mask.length;i++)if(mask[i]&&!seen[i]){
    const queue=[i];seen[i]=1;
    for(let k=0;k<queue.length;k++){const at=queue[k],x=at%w,y=Math.floor(at/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(mask[j]&&!seen[j]){seen[j]=1;queue.push(j);}}}
    if(queue.length>largest.length)largest=queue;
  }
  const keep=new Uint8Array(w*h);for(const i of largest)keep[i]=1;
  const origin=181+col*362;
  for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
    const sx=Math.floor(origin+(x-center+.5)/scale),sy=Math.floor(baseline+(y-ground+.5)/scale);
    if(sx<left||sx>=right||sy<top||sy>=bottom||!keep[(sy-top)*w+sx-left])continue;
    const s=(sy*source.width+sx)*4,o=((row*cell+y)*W+col*cell+x)*4;
    out.set([...color(...source.rgba.subarray(s,s+3)),255],o);
  }
}
writeFileSync('public/assets/player-redesign/noir'+height+'.png',encodePng(W,H,out));
const heights=[];
for(let col=0;col<4;col++){let lo=cell,hi=-1;for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)if(out[(y*W+col*cell+x)*4+3]){lo=Math.min(lo,y);hi=Math.max(hi,y);}heights.push(hi-lo+1);}
console.log({sheet:[W,H],cell:[cell,cell],idleHeights:heights,colors:palette.length});
