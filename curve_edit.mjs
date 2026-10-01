// Exact arbitrary-degree Bernstein controls; polynomial evaluation stays native.
const choose=(n,k)=>{let r=1;for(let i=1;i<=k;i++)r=r*(n-i+1)/i;return r;};
export function evaluate(c,t){const p=[0,0];for(let i=c.length-1;i>=0;i--)for(let k=0;k<2;k++)p[k]=p[k]*t+c[i][k];return p;}
export function toBezier(c,[lo,hi]){const n=c.length-1,d=hi-lo,a=Array.from({length:n+1},()=>[0,0]);for(let k=0;k<=n;k++)for(let j=k;j<=n;j++)for(let q=0;q<2;q++)a[k][q]+=c[j][q]*choose(j,k)*lo**(j-k)*d**k;const b=a.map((_,i)=>[0,1].map(q=>a.slice(0,i+1).reduce((s,v,k)=>s+choose(i,k)/choose(n,k)*v[q],0)));b[0]=evaluate(c,lo);return b;}
export function fromBezier(b){const n=b.length-1;return b.map((_,k)=>[0,1].map(q=>choose(n,k)*b.slice(0,k+1).reduce((s,v,j)=>s+(-1)**(k-j)*choose(k,j)*v[q],0)));}
export function handlesFor(r){const iv=r.fit.intervals||[r.geometry.interval];return r.fit.handles||toBezier(r.fit.coefficients,[iv[0][0],iv.at(-1)[1]]);}
// A Bernstein control hull bounds distance from its endpoint chord, unlike a
// midpoint-only test which can miss inflections. De Casteljau subdivides exactly.
export function tessellate(c,a,b,screen,tolerance=.35){
 const out=[],h=toBezier(c,[a,b]).map(screen);
 function split(p,depth){const start=p[0],end=p.at(-1),d=[end[0]-start[0],end[1]-start[1]],length=Math.hypot(...d),flat=Math.max(...p.map(v=>length?Math.abs(d[0]*(v[1]-start[1])-d[1]*(v[0]-start[0]))/length:Math.hypot(v[0]-start[0],v[1]-start[1])));
 // Include projection overshoot: collinear backtracking must not collapse.
 const ordered=p.every(v=>length===0||((v[0]-start[0])*d[0]+(v[1]-start[1])*d[1]>=-tolerance*length&&(v[0]-end[0])*d[0]+(v[1]-end[1])*d[1]<=tolerance*length));
 if(depth>=22||(flat<=tolerance&&ordered)){if(!out.length)out.push(start);out.push(end);return;}
 let row=p,left=[row[0]],right=[row.at(-1)];while(row.length>1){row=row.slice(1).map((v,i)=>v.map((x,k)=>(x+row[i][k])/2));left.push(row[0]);right.push(row.at(-1));}split(left,depth+1);split(right.reverse(),depth+1);
 }split(h,0);return out;
}
export function paintCurve(ctx,r,screen,{preview=null}={}){
 const c=preview?fromBezier(preview):r.fit.coefficients,iv=preview?[[0,1]]:r.fit.intervals||[r.geometry.interval];
 ctx.save();ctx.lineWidth=1.5;ctx.strokeStyle=preview?'#ff88c8':'#fff';
 for(const [a,b] of iv){const cuts=r.fit.manual||preview?[a,b]:[a,...[-1,1].filter(t=>t>a&&t<b),b];for(let i=1;i<cuts.length;i++){ctx.setLineDash(!r.fit.manual&&!preview&&(cuts[i]<=-1||cuts[i-1]>=1)?[6,4]:[]);const pts=tessellate(c,cuts[i-1],cuts[i],screen);ctx.beginPath();pts.forEach((p,j)=>j?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();}}
 ctx.restore();
}
export function paintHandles(ctx,handles,screen){const p=handles.map(screen);ctx.save();ctx.strokeStyle='#e7a5ca';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.stroke();ctx.setLineDash([]);p.forEach((v,i)=>{ctx.fillStyle=i===0||i===p.length-1?'#00ffc8':'#ff0088';ctx.strokeStyle='#000';ctx.lineWidth=2;ctx.beginPath();ctx.arc(...v,5,0,2*Math.PI);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='12px system-ui';const label=i===0?'A':i===p.length-1?'B':String(i);ctx.lineWidth=3;ctx.strokeText(label,v[0]+8,v[1]+13);ctx.fillText(label,v[0]+8,v[1]+13);});ctx.restore();}
export function hitHandle(handles,screen,p){let best=-1,d=13;handles.forEach((v,i)=>{const q=screen(v),dist=Math.hypot(q[0]-p[0],q[1]-p[1]);if(dist<d){best=i;d=dist;}});return best;}
