// Leaf-outline editing on the merged native grid: (column,row) cell centres, y down.
// Rings are closed polygons as flat arrays [x0,y0,x1,y1,...]; the last point is not repeated.
// Pipeline (applyEdits): original rings → optional Gaussian smoothing along the perimeter →
// redrawn sections spliced in order. The server only rasterizes the resulting rings; this is
// the single implementation of the editing geometry.
const len=r=>r.length/2;
export function perimeter(r){let s=0;const n=len(r);for(let i=0;i<n;i++){const j=(i+1)%n;s+=Math.hypot(r[2*j]-r[2*i],r[2*j+1]-r[2*i+1]);}return s;}
export function ringArea(r){let s=0;const n=len(r);for(let i=0;i<n;i++){const j=(i+1)%n;s+=r[2*i]*r[2*j+1]-r[2*j]*r[2*i+1];}return Math.abs(s)/2;}
// Evenly spaced points along the closed perimeter (spacing ≈ step px).
export function resample(r,step=1){
 const n=len(r),total=perimeter(r),m=Math.max(3,Math.round(total/step)),d=total/m,out=new Float64Array(2*m);
 let i=0,acc=0,seg=Math.hypot(r[2]-r[0],r[3]-r[1]);
 for(let k=0;k<m;k++){
  const target=k*d;
  while(acc+seg<target&&i<n-1){acc+=seg;i++;const j=(i+1)%n;seg=Math.hypot(r[2*j]-r[2*i],r[2*j+1]-r[2*i+1]);}
  const j=(i+1)%n,t=seg>0?Math.min(1,(target-acc)/seg):0;
  out[2*k]=r[2*i]+t*(r[2*j]-r[2*i]);out[2*k+1]=r[2*i+1]+t*(r[2*j+1]-r[2*i+1]);
 }
 return out;
}
// Circular Gaussian of the perimeter coordinates. sigma in px of arclength; 0 returns a copy.
export function smooth(r,sigma){
 if(!(sigma>0))return Float64Array.from(r);
 const p=resample(r,1),n=len(p),radius=Math.min(Math.ceil(3*sigma),Math.floor((n-1)/2)),w=new Float64Array(2*radius+1);
 let sum=0;for(let k=-radius;k<=radius;k++){w[k+radius]=Math.exp(-k*k/(2*sigma*sigma));sum+=w[k+radius];}
 const out=new Float64Array(2*n);
 for(let i=0;i<n;i++){let x=0,y=0;for(let k=-radius;k<=radius;k++){const j=((i+k)%n+n)%n,v=w[k+radius];x+=v*p[2*j];y+=v*p[2*j+1];}out[2*i]=x/sum;out[2*i+1]=y/sum;}
 return out;
}
export function nearest(r,[x,y]){let best=-1,d=Infinity;for(let i=0;i<len(r);i++){const v=Math.hypot(r[2*i]-x,r[2*i+1]-y);if(v<d){d=v;best=i;}}return {index:best,distance:d};}
// Which ring a stroke edits: both ends must lie within tol px of the same ring.
export function strokeTarget(rings,stroke,tol){
 const a=[stroke[0],stroke[1]],b=[stroke.at(-2),stroke.at(-1)];let best=null;
 rings.forEach((r,k)=>{const p=nearest(r,a),q=nearest(r,b),d=Math.max(p.distance,q.distance);if(d<=tol&&p.index!==q.index&&(!best||d<best.d))best={ring:k,d,i:p.index,j:q.index};});
 return best;
}
// Replace the SHORTER perimeter arc between the points nearest to the stroke ends with the stroke.
export function splice(r,stroke,i=nearest(r,[stroke[0],stroke[1]]).index,j=nearest(r,[stroke.at(-2),stroke.at(-1)]).index){
 const n=len(r);if(i===j)throw Error('Start and end the stroke at two different places on the outline.');
 const arc=(a,b)=>{let s=0;for(let k=a;k!==b;k=(k+1)%n){const q=(k+1)%n;s+=Math.hypot(r[2*q]-r[2*k],r[2*q+1]-r[2*k+1]);}return s;};
 const out=[],push=k=>out.push(r[2*k],r[2*k+1]);
 if(arc(i,j)<=arc(j,i)){out.push(...stroke);for(let k=(j+1)%n;k!==i;k=(k+1)%n)push(k);}
 else{for(let k=i;k!==(j+1)%n;k=(k+1)%n)push(k);for(let k=len(stroke)-2;k>=1;k--)out.push(stroke[2*k],stroke[2*k+1]);}
 return Float64Array.from(out);
}
// Drop pointer samples closer than minStep px; keeps the last sample.
export function cleanStroke(points,minStep=.5){const out=[];for(let i=0;i<points.length;i+=2){if(out.length&&Math.hypot(points[i]-out.at(-2),points[i+1]-out.at(-1))<minStep&&i<points.length-2)continue;out.push(points[i],points[i+1]);}return out;}
// edits: {sigmaPx, strokes:[{ring,points}]}; strokes keep their ring index from when they were drawn.
export function applyEdits(rings,{sigmaPx=0,strokes=[]}={}){
 // Rings shorter than the kernel (specks) would collapse; they stay unsmoothed.
 const out=rings.map(r=>perimeter(r)>6*sigmaPx?smooth(r,sigmaPx):Float64Array.from(r));
 for(const s of strokes){const r=out[s.ring];if(!r)continue;const a=nearest(r,[s.points[0],s.points[1]]).index,b=nearest(r,[s.points.at(-2),s.points.at(-1)]).index;if(a!==b)out[s.ring]=splice(r,s.points,a,b);}
 return out;
}
