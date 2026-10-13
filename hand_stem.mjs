// Hand-drawn slice stem: native (column,row) polyline, y down. Same geometry
// contract as automatic fits (ends + tangents), so Align treats both alike.
export const MAX_POINTS=500;
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
export function handGeometry(points){
 const n=points?.length||0;if(n<2)return null;
 return {ends:[points[0],points[n-1]],tangents:[sub(points[1],points[0]),sub(points[n-1],points[n-2])],interval:[0,1]};
}
// A slice uses its hand stem as soon as it has two points; fewer points = automatic stem.
export function handResult(s){
 const points=s.handStem?.points,geometry=handGeometry(points);if(!geometry)return null;
 return {id:s.id,path:s.path,key:'hand:'+JSON.stringify(points),hand:true,fit:{hand:true,points},geometry};
}
export function insideSlice(s,p){return p[0]>=-.5&&p[1]>=-.5&&p[0]<=s.dimensions[0]-.5&&p[1]<=s.dimensions[1]-.5;}
// Append unless it would repeat the last point (the server rejects zero-length segments).
export function appendPoint(points,p){const last=points.at(-1);if(points.length>=MAX_POINTS)throw Error(`A hand-drawn stem holds at most ${MAX_POINTS} points.`);if(last&&Math.hypot(p[0]-last[0],p[1]-last[1])<.5)return false;points.push(p.map(v=>Math.round(v*100)/100));return true;}
export function hitPoint(points,screen,p,radius=10){let best=-1,d=radius;(points||[]).forEach((v,i)=>{const q=screen(v),dist=Math.hypot(q[0]-p[0],q[1]-p[1]);if(dist<d){best=i;d=dist;}});return best;}
export function paintHand(ctx,points,screen,{active=false}={}){
 const p=points.map(screen);ctx.save();
 if(p.length>1){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.stroke();}
 for(const v of p){ctx.beginPath();ctx.arc(...v,active?5:2.5,0,2*Math.PI);ctx.fillStyle=active?'#ff0088':'#fff';ctx.fill();if(active){ctx.strokeStyle='#000';ctx.lineWidth=2;ctx.stroke();}}
 ctx.restore();
}
