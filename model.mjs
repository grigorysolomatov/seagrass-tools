export const clone=x=>structuredClone(x);
export const mul=(A,p)=>[A[0][0]*p[0]+A[0][1]*p[1],A[1][0]*p[0]+A[1][1]*p[1]];
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const effective=(state,s)=>({top:s.topLocked?state.shared.top:s.top,degree:s.degreeLocked?state.shared.degree:s.degree});
export class Store {
 constructor(){this.state={shared:{top:20,degree:3,overlap:0},background:{enabled:false,threshold:99,closing:4,core:16,halo:8,iterations:6},slices:[],aligned:false,joints:[]};this.past=[];this.future=[];this.pending=null;this.revision=0;}
 begin(){if(!this.pending)this.pending=clone(this.state);}
 update(fn){this.begin();fn(this.state);this.revision++;}
 end(){if(!this.pending)return;if(JSON.stringify(this.pending)!==JSON.stringify(this.state)){this.past.push(this.pending);this.future=[];}this.pending=null;}
 edit(fn){this.end();this.update(fn);this.end();}
 undo(){this.end();if(!this.past.length)return;this.future.push(clone(this.state));this.state=this.past.pop();this.revision++;}
 redo(){this.end();if(!this.future.length)return;this.past.push(clone(this.state));this.state=this.future.pop();this.revision++;}
}
export function localMatrix(s){const a=-s.angle*Math.PI/180,c=Math.cos(a),t=Math.sin(a),dx=s.spacing[0]*(s.mirrorH?-1:1),dy=s.spacing[1]*(s.mirrorV?-1:1);return [[c*dx,-t*dy],[t*dx,c*dy]];}
export function arrange(state){let x=0;for(const s of state.slices){const matrix=localMatrix(s),corners=[[0,0],[s.dimensions[0],0],s.dimensions,[0,s.dimensions[1]]].map(p=>mul(matrix,p));const lo=[0,1].map(k=>Math.min(...corners.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...corners.map(p=>p[k])));s.pose={matrix,shift:[x-lo[0],-lo[1]]};x+=hi[0]-lo[0]+2;}state.aligned=false;state.joints=[];}
export function addSlices(state,metas){for(const m of metas)if(!state.slices.some(s=>s.id===m.id))state.slices.push({...m,angle:0,mirrorH:false,mirrorV:false,reverse:false,top:state.shared.top,degree:state.shared.degree,topLocked:true,degreeLocked:true});arrange(state);}
const rotation=degrees=>{const a=-degrees*Math.PI/180;return [[Math.cos(a),-Math.sin(a)],[Math.sin(a),Math.cos(a)]];};
const mmul=(A,B)=>[[A[0][0]*B[0][0]+A[0][1]*B[1][0],A[0][0]*B[0][1]+A[0][1]*B[1][1]],[A[1][0]*B[0][0]+A[1][1]*B[1][0],A[1][0]*B[0][1]+A[1][1]*B[1][1]]];
export function orient(state,index,values){const s=state.slices[index],center=s.dimensions.map(x=>x/2),world=add(mul(s.pose.matrix,center),s.pose.shift);const old=s.angle;const h=s.mirrorH,v=s.mirrorV;Object.assign(s,values);let A=mmul(rotation(s.angle-old),s.pose.matrix);if(h!==s.mirrorH){A[0][0]*=-1;A[1][0]*=-1;}if(v!==s.mirrorV){A[0][1]*=-1;A[1][1]*=-1;}// Transport only this slice's incoming joint frame; other slices did not move.
if(state.aligned && index>0){const j=state.joints[index-1],B=s.pose.matrix,det=B[0][0]*B[1][1]-B[0][1]*B[1][0];const native=[(B[1][1]*j.axis[0]-B[0][1]*j.axis[1])/det,(-B[1][0]*j.axis[0]+B[0][0]*j.axis[1])/det],axis=mul(A,native);j.axis=axis.map(x=>x/Math.hypot(...axis));}
s.pose={matrix:A,shift:sub(world,mul(A,center))};if(state.aligned){state.joints.forEach((j,i)=>{const next=state.slices[i+1];j.pivot=add(mul(next.pose.matrix,next.anchor),next.pose.shift);});}}
// Align preserves only the first slice's global orientation. Followers solve
// their absolute rotation from endpoint derivatives, not prior manual offsets.
export function align(state,results){let prev=null;state.joints=[];for(let i=0;i<state.slices.length;i++){const s=state.slices[i],g=results[s.id].geometry;let ends=g.ends,tang=g.tangents;if(s.reverse){ends=[ends[1],ends[0]];tang=[tang[1].map(x=>-x),tang[0].map(x=>-x)];}const dx=s.spacing[0]*(s.mirrorH?-1:1),dy=s.spacing[1]*(s.mirrorV?-1:1),vin=[dx*tang[0][0],dy*tang[0][1]];const angle=prev?(Math.atan2(vin[1],vin[0])-Math.atan2(prev.direction[1],prev.direction[0]))*180/Math.PI:s.angle;s.angle=prev?((angle+180)%360+360)%360-180:angle;const A=mmul(rotation(s.angle),[[dx,0],[0,dy]]);const axis=prev?prev.direction.map(v=>v/Math.hypot(...prev.direction)):[1,0];const target=prev?prev.end.map((x,k)=>x-state.shared.overlap*prev.direction[k]/Math.hypot(...prev.direction)):[0,0];s.pose={matrix:A,shift:sub(target,mul(A,ends[0]))};s.anchor=ends[0];prev={end:add(mul(A,ends[1]),s.pose.shift),direction:mul(A,tang[1])};if(i)state.joints.push({along:0,across:0,angle:0,pivot:target,axis});}state.aligned=true;}
export function editJoint(state,index,values){const j=state.joints[index],next={...j,...values},R=rotation(next.angle-j.angle),axis=mul(R,j.axis),delta=add(axis.map(v=>v*(next.along-j.along)),[axis[1],-axis[0]].map(v=>v*(next.across-j.across))),pivot=j.pivot;const transform=p=>add(add(pivot,mul(R,sub(p,pivot))),delta);for(const s of state.slices.slice(index+1)){s.pose={matrix:mmul(R,s.pose.matrix),shift:transform(s.pose.shift)};}for(const downstream of state.joints.slice(index+1)){downstream.pivot=transform(downstream.pivot);downstream.axis=mul(R,downstream.axis);}state.joints[index]={...next,axis,pivot:transform(pivot)};}
export function reorder(state,from,to){if(to<0||to>=state.slices.length)return;const [s]=state.slices.splice(from,1);state.slices.splice(to,0,s);arrange(state);}