import { samples, renderFrame } from './player-style-samples.mjs';

const $ = id => document.getElementById(id);
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let flipped = false;
let elapsed = 0;
let previous = 0;
const cache = new Map();
function sprite(sample, action, index) {
  const key = `${sample.id}/${action}/${index}`;
  if (cache.has(key)) return cache.get(key);
  const f = renderFrame(sample, action, index);
  const canvas = document.createElement('canvas');
  canvas.width = f.w; canvas.height = f.h;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(f.w, f.h);
  f.rgba.forEach((c,i) => data.data.set([c>>>24,(c>>>16)&255,(c>>>8)&255,c&255],i*4));
  ctx.putImageData(data,0,0);
  cache.set(key,canvas);
  return canvas;
}
const cards = samples.map(sample => {
  const card = document.createElement('article');
  card.className = 'card'; card.style.setProperty('--accent',sample.color);
  card.innerHTML = `<div class="stage"><canvas width="288" height="288" role="img" aria-label="${sample.name}の拡大プレビュー"></canvas></div><div class="mini"><span>ゲーム内サイズ / 1×</span><canvas width="80" height="48" role="img" aria-label="${sample.name}のゲーム内サイズ"></canvas></div><div class="info"><div class="tag">${sample.tag}</div><h2>${sample.name}</h2><p>${sample.text}</p><div class="actions"><button class="choose" aria-pressed="false">この案が好み</button><button class="download">PNG保存 ↓</button></div></div>`;
  $('cards').append(card);
  card.querySelector('.choose').onclick = () => {
    const choose = !card.classList.contains('chosen');
    document.querySelectorAll('.card').forEach(c => {
      c.classList.remove('chosen'); c.querySelector('.choose').setAttribute('aria-pressed','false');
    });
    card.classList.toggle('chosen',choose);
    card.querySelector('.choose').setAttribute('aria-pressed',String(choose));
    $('selection').textContent = choose ? `選択中：${sample.name} — この名前で希望を伝えられます。` : '気になる案を選んで比較できます。';
  };
  card.querySelector('.download').onclick = () => {
    const source = sprite(sample,$('motion').value,frameIndex());
    const output = document.createElement('canvas');
    output.width=source.width; output.height=source.height;
    const ctx=output.getContext('2d');
    if(flipped){ctx.translate(output.width,0);ctx.scale(-1,1);}
    ctx.drawImage(source,0,0);
    const a=document.createElement('a');
    a.download=`player-${sample.id}-${$('motion').value}-${frameIndex()}.png`;
    a.href=output.toDataURL('image/png'); a.click();
  };
  return {sample,large:card.querySelector('.stage canvas'),small:card.querySelector('.mini canvas')};
});
function pauseLabel(){ $('pause').textContent=paused?'再生':'一時停止';$('pause').setAttribute('aria-pressed',String(paused)); }
pauseLabel();
$('pause').onclick=()=>{paused=!paused;pauseLabel();};
$('flip').onclick=()=>{flipped=!flipped;$('flip').setAttribute('aria-pressed',String(flipped));};
$('motion').onchange=()=>{elapsed=0;};
function frameIndex(){return Math.floor(elapsed/($('motion').value==='walk'?95:180))%8;}
function draw(canvas,source,scale){
  const ctx=canvas.getContext('2d'); const w=canvas.width,h=canvas.height;
  ctx.imageSmoothingEnabled=false;
  const bg=$('background').value;
  ctx.fillStyle=bg==='light'?'#d0cec4':bg==='dark'?'#12151d':'#282a33';ctx.fillRect(0,0,w,h);
  if(bg==='grid'||bg==='dungeon'){
    const size=bg==='grid'?12:32;
    for(let y=0;y<h;y+=size)for(let x=0;x<w;x+=size){
      ctx.fillStyle=(x/size+y/size)%2?'#2e303a':'#252731';
      ctx.fillRect(x,y,size-1,size-1);
      if(bg==='dungeon'){ctx.fillStyle='#373941';ctx.fillRect(x+2,y+1,size-4,1);}
    }
  }
  const ground=Math.round(h*.84);
  ctx.fillStyle=bg==='light'?'#a3a298':'#171a22';
  ctx.beginPath();ctx.ellipse(w/2,ground,9*scale,2*scale,0,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.translate(w/2,ground);ctx.scale(flipped?-1:1,1);
  ctx.drawImage(source,-36*scale,-72*scale,source.width*scale,source.height*scale);ctx.restore();
}
function tick(now){
  if(previous&&!paused&&!document.hidden)elapsed+=Math.min(now-previous,100);
  previous=now;
  for(const card of cards){
    const source=sprite(card.sample,$('motion').value,frameIndex());
    draw(card.large,source,Number($('zoom').value));draw(card.small,source,.5);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
