import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,addSlices,align,editJoint,mul,sub} from './model.mjs';
const near=(a,b)=>assert(Math.hypot(...sub(a,b))<1e-8,`${a} != ${b}`);
test('local joint axes follow upstream tangent and downstream frames rotate rigidly',()=>{
 const st=new Store();addSlices(st.state,['a','b','c'].map(id=>({id,path:id,dimensions:[100,50],spacing:[.1,.1]})));
 const geometry={ends:[[50,0],[50,50]],tangents:[[0,1],[0,1]]};align(st.state,Object.fromEntries(st.state.slices.map(s=>[s.id,{geometry}])));
 const before=structuredClone(st.state),p=before.joints[0].pivot;
 editJoint(st.state,0,{along:2,across:3});near(sub(st.state.joints[0].pivot,p),[3,2]);
 const second=structuredClone(st.state.joints[1]);editJoint(st.state,0,{angle:90});
 near(st.state.joints[1].axis,[1,0]);const q=structuredClone(st.state.joints[1].pivot);editJoint(st.state,1,{along:1});near(sub(st.state.joints[1].pivot,q),[1,0]);
 assert.deepEqual(st.state.slices[0].pose,before.slices[0].pose);
});
