import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,addSlices,align,orient,editJoint,mul,add,localMatrix} from './model.mjs';
const results=Object.fromEntries(['a','b','c'].map((id,i)=>[id,{geometry:{ends:[[3+i,8],[90,22+i]],tangents:[[1,.2+i*.15],[1,-.3+i*.2]]}}]));
const unit=v=>v.map(x=>x/Math.hypot(...v));
function measure(state){return state.slices.slice(1).map((s,i)=>{const prev=state.slices[i],pg=results[prev.id].geometry,g=results[s.id].geometry,out=prev.reverse?0:1,inc=s.reverse?1:0;
const a=unit(mul(prev.pose.matrix,pg.tangents[out].map(x=>x*(prev.reverse?-1:1)))),b=unit(mul(s.pose.matrix,g.tangents[inc].map(x=>x*(s.reverse?-1:1))));
const end=add(mul(prev.pose.matrix,pg.ends[out]),prev.pose.shift),start=add(mul(s.pose.matrix,g.ends[inc]),s.pose.shift);
return {cross:a[0]*b[1]-a[1]*b[0],dot:a[0]*b[0]+a[1]*b[1],gap:Math.hypot(...end.map((x,k)=>x-start[k]))};});}
test('Align solves endpoint tangency despite prior rotations, mirrors and reversal; reset is idempotent',()=>{
let maxCross=0,maxGap=0,cases=0;
for(let bits=0;bits<64;bits++){
 const store=new Store();addSlices(store.state,['a','b','c'].map(id=>({id,path:id,dimensions:[100,50],spacing:[.12,.07]})));
 for(let i=0;i<3;i++)orient(store.state,i,{angle:[23,-41,72][i],mirrorH:!!(bits&(1<<(i*2))),mirrorV:!!(bits&(1<<(i*2+1))),reverse:!!(bits&(1<<i))});
 const before=structuredClone(store.state);store.edit(s=>align(s,results));assert.equal(store.state.slices[0].angle,23);
 for(const m of measure(store.state)){maxCross=Math.max(maxCross,Math.abs(m.cross));maxGap=Math.max(maxGap,m.gap);assert(Math.abs(m.cross)<1e-12);assert(Math.abs(m.dot-1)<1e-12);assert(m.gap<1e-10);}
 for(const s of store.state.slices){const M=localMatrix(s);for(let r=0;r<2;r++)for(let c=0;c<2;c++)assert(Math.abs(M[r][c]-s.pose.matrix[r][c])<1e-12,'Angle field reflects applied orientation');}
 const aligned=structuredClone(store.state);align(store.state,results);assert.deepEqual(store.state,aligned);editJoint(store.state,0,{angle:17,along:1,across:.1});assert(Math.abs(measure(store.state)[0].cross)>.1);align(store.state,results);assert.deepEqual(store.state,aligned);
 store.undo();assert.deepEqual(store.state,before);cases++;
}
console.log(JSON.stringify({cases,maxCross,maxGap}));
});
