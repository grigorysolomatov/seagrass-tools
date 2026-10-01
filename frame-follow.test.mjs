import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,addSlices,align,editJoint,orient,mul,sub,clone} from './model.mjs';
const near=(a,b)=>assert(Math.hypot(...sub(a,b))<1e-9,`${a} != ${b}`);
const unit=v=>v.map(x=>x/Math.hypot(...v));
const geometry={ends:[[0,2],[10,2]],tangents:[[1,0],[1,0]]};
function setup(){const st=new Store();addSlices(st.state,['a','b','c'].map(id=>({id,dimensions:[10,4],spacing:[.1,.2]})));align(st.state,Object.fromEntries(st.state.slices.map(s=>[s.id,{geometry}])));return st;}
test('standalone downstream orientation transports its joint frame, including mirrors',()=>{
 const st=setup();editJoint(st.state,0,{angle:23});const other=clone(st.state.joints[1]);
 orient(st.state,1,{angle:71,mirrorH:true});
 near(st.state.joints[0].axis,unit(mul(st.state.slices[1].pose.matrix,[1,0])));
 near(st.state.joints[1].axis,other.axis);
 const p=[...st.state.joints[0].pivot],a=unit(mul(st.state.slices[1].pose.matrix,[1,0]));
 editJoint(st.state,0,{along:.1,across:.2});near(sub(st.state.joints[0].pivot,p),[a[0]*.1+a[1]*.2,a[1]*.1-a[0]*.2]);
});
test('combined edit equals rotate then translate; repeated rotations do not double-rotate',()=>{
 const a=setup(),b=setup();editJoint(a.state,0,{angle:37,along:.3,across:-.2});editJoint(b.state,0,{angle:37});editJoint(b.state,0,{along:.3,across:-.2});
 assert.deepEqual(a.state,b.state);const pivot=[...a.state.joints[0].pivot];editJoint(a.state,0,{angle:51});near(a.state.joints[0].pivot,pivot);near(a.state.joints[0].axis,unit(mul(a.state.slices[1].pose.matrix,[1,0])));
 editJoint(a.state,1,{angle:19});editJoint(a.state,0,{angle:-28});
 near(a.state.joints[1].axis,unit(mul(a.state.slices[2].pose.matrix,[1,0])));
 const q=[...a.state.joints[1].pivot],u=[...a.state.joints[1].axis];editJoint(a.state,1,{along:.1});near(sub(a.state.joints[1].pivot,q),u.map(x=>x*.1));
 align(a.state,Object.fromEntries(a.state.slices.map(s=>[s.id,{geometry}])));assert(a.state.joints.every(j=>j.along===0&&j.across===0&&j.angle===0));near(a.state.joints[0].axis,[1,0]);near(a.state.joints[0].pivot,[1,0]);
});
test('selected joint translation follows its own rotated downstream frame',()=>{
 const st=setup(),before=clone(st.state);st.edit(s=>editJoint(s,0,{angle:90}));
 near(st.state.joints[0].axis,[0,-1]);
 const p=[...st.state.joints[0].pivot];st.edit(s=>editJoint(s,0,{along:.1}));near(sub(st.state.joints[0].pivot,p),[0,-.1]);
 const q=[...st.state.joints[0].pivot];st.edit(s=>editJoint(s,0,{across:.1}));near(sub(st.state.joints[0].pivot,q),[-.1,0]);
 assert.deepEqual(st.state.slices[0].pose,before.slices[0].pose);
 st.undo();st.undo();st.undo();assert.deepEqual(st.state,before);st.redo();near(st.state.joints[0].axis,[0,-1]);
});
