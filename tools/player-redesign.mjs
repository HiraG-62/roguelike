// 独立した新デザインの描き下ろしシート。既存のキャラクターリグは使用しない。
const designs = [
  {id:'noir48-polished',native:true,name:'灰冠の剣士 / 調整版',en:'ASHEN / REFINED 48',color:'#8dbbb1',description:'銀髪・顔・肩鎧の色面を整理。立ち姿を48ドットに揃え、剣の線と足元の位置を調整した版。',motion:'72×72px／コマ・24色・透過PNG'},
  {id:'noir48',native:true,name:'灰冠の剣士 / 調整前',en:'ASHEN / BEFORE',color:'#9a9ca8',description:'サイズ比較用に作った48ドット版。顔や装備の読みやすさ、動きのまとまりを調整版と比較。',motion:'72×72px／コマ・24色・透過PNG'},
];
const $=id=>document.getElementById(id);
const clips={idle:{row:0,times:[220,220,220,220]},run:{row:1,times:[110,110,110,110]},attack:{row:2,times:[260,90,170,440]}};
let paused=matchMedia('(prefers-reduced-motion: reduce)').matches,flipped=false,time=0,previous=0,selected=null;
const cards=[];
const guide=document.createElement('button');guide.textContent='接地線';guide.setAttribute('aria-pressed','true');
const onion=document.createElement('button');onion.textContent='前コマを重ねる';onion.setAttribute('aria-pressed','false');
for(const b of [guide,onion]){b.onclick=()=>b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));document.querySelector('.controls').append(b);}
function index(){const times=clips[$('motion').value].times;let t=time%times.reduce((a,b)=>a+b,0);for(let i=0;i<4;i++){if(t<times[i])return i;t-=times[i];}return 3;}
function pauseLabel(){$('pause').textContent=paused?'再生':'一時停止';$('pause').setAttribute('aria-pressed',String(paused));}
pauseLabel();
$('pause').onclick=()=>{paused=!paused;pauseLabel();};
$('flip').onclick=()=>{flipped=!flipped;$('flip').setAttribute('aria-pressed',String(flipped));};
$('motion').onchange=()=>{time=0;};
$('step').onclick=()=>{paused=true;pauseLabel();const n=(index()+1)%4;time=clips[$('motion').value].times.slice(0,n).reduce((a,b)=>a+b,0);};
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
// 生成シートの攻撃行の最後のセルには隣の斬撃が入り込むため、復帰には待機の先頭を使う。
function sourceCell(n,row,card){return !card.native&&row===2&&n===3?{n:0,row:0}:{n,row};}
function frame(card,n,row){
  ({n,row}=sourceCell(n,row,card));
  const img=card.image,w=img.naturalWidth/4,h=img.naturalHeight/3;
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');
  if(flipped){ctx.translate(c.width,0);ctx.scale(-1,1);}
  ctx.drawImage(img,n*w,row*h,w,h,0,0,c.width,c.height);return c;
}
for(const d of designs){
  const el=document.createElement('article');el.className='card';el.style.setProperty('--accent',d.color);
  el.innerHTML=`<div class="card-heading"><span>${d.en}</span><span class="badge">${d.native ? '24 COLORS' : 'REFERENCE'}</span></div><div class="stage"><canvas width="480" height="440" role="img" aria-label="${d.name}のアニメーション"></canvas></div><div class="small-view"><span>原寸 / 1×</span><canvas width="120" height="96" role="img" aria-label="${d.name}の縮小表示"></canvas></div><div class="info"><h2>${d.name}</h2><p>${d.description}</p><div class="motion-note">${d.motion}</div><div class="strip" aria-label="アニメーションの4コマ"></div><div class="actions"><button class="choose" aria-pressed="false">この方向が好み</button><button class="png" disabled>PNG保存</button></div><a class="sheet" href="/assets/player-redesign/${d.id}.png" download>全12コマのシート ↓</a><p class="load-status" role="status">画像を読み込み中…</p></div>`;
  $('cards').append(el);
  const card={...d,el,large:el.querySelector('.stage canvas'),small:el.querySelector('.small-view canvas'),image:new Image(),loaded:false,strip:[]};cards.push(card);
  for(let n=0;n<4;n++){const button=document.createElement('button');button.setAttribute('aria-label',`${n+1}コマ目を表示`);const c=document.createElement('canvas');c.width=112;c.height=112;button.append(c);button.onclick=()=>{paused=true;pauseLabel();time=clips[$('motion').value].times.slice(0,n).reduce((a,b)=>a+b,0);};el.querySelector('.strip').append(button);card.strip.push(c);}
  el.querySelector('.choose').onclick=()=>{selected=selected===d.id?null:d.id;for(const c of cards){const active=selected===c.id;c.el.classList.toggle('chosen',active);c.el.querySelector('.choose').setAttribute('aria-pressed',String(active));}$('selection').textContent=selected?`選択中：${d.name}`:'気になる方向を選んでください。';};
  el.querySelector('.png').onclick=()=>download(frame(card,index(),clips[$('motion').value].row).toDataURL(),`${d.id}-${$('motion').value}-${index()+1}.png`);
  card.image.onload=()=>{card.loaded=true;el.querySelector('.png').disabled=false;el.querySelector('.load-status').textContent='';};
  card.image.onerror=()=>{el.querySelector('.load-status').textContent='読み込めませんでした。ページを再読み込みしてください。';};
  card.image.src=`/assets/player-redesign/${d.id}.png`;
}
function draw(canvas,card,n,row,mini=false){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const bg=$('background').value;
  ctx.imageSmoothingEnabled=false;ctx.fillStyle=bg==='light'?'#c4c4bd':bg==='dark'?'#10131a':'#20262b';ctx.fillRect(0,0,w,h);
  if(bg==='grid'){for(let y=0;y<h;y+=16)for(let x=0;x<w;x+=16)if((x/16+y/16)%2){ctx.fillStyle='#30363a';ctx.fillRect(x,y,16,16);}}
  if(bg==='dungeon'){
    ctx.strokeStyle='#30393f';ctx.lineWidth=1;
    for(let y=28;y<h;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();for(let x=(y%96?0:40);x<w;x+=80){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+48);ctx.stroke();}}
    const glow=ctx.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,w*.6);glow.addColorStop(0,'#80909618');glow.addColorStop(1,'#070b1266');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
  }
  if(!card.loaded)return;
  const sw=card.image.naturalWidth/4,sh=card.image.naturalHeight/3;
  const scale=mini?1:4*Number($('zoom').value);
  // 立ち姿が同程度の高さになるよう原案を縮小。低解像度版の小窓は実寸。
  const size=(card.native?sw:67)*scale,dw=size,dh=size*sh/sw;
  ({n,row}=sourceCell(n,row,card));
  ctx.save();ctx.translate(w/2,(h-dh)/2);if(flipped)ctx.scale(-1,1);
  if(onion.getAttribute('aria-pressed')==='true'&&!mini){ctx.globalAlpha=.22;ctx.drawImage(card.image,((n+3)%4)*sw,row*sh,sw,sh,-dw/2,0,dw,dh);ctx.globalAlpha=1;}
  ctx.drawImage(card.image,n*sw,row*sh,sw,sh,-dw/2,0,dw,dh);ctx.restore();
  if(guide.getAttribute('aria-pressed')==='true'){
    const ground=Math.round((h-dh)/2+60*scale)+.5;
    ctx.strokeStyle='#c4b58e80';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,ground);ctx.lineTo(w,ground);ctx.stroke();ctx.setLineDash([]);
  }
}
function tick(now){if(previous&&!paused&&!document.hidden)time+=Math.min(now-previous,100)*Number($('speed').value);previous=now;const n=index(),row=clips[$('motion').value].row;
  for(const c of cards){draw(c.large,c,n,row);draw(c.small,c,n,row,true);c.strip.forEach((canvas,i)=>{draw(canvas,c,i,row,true);canvas.parentElement.classList.toggle('active',i===n);});}
  $('frame').textContent=`${n+1} / 4`;requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
