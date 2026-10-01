import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,addSlices,align,editJoint,localMatrix,mul,sub} from './model.mjs';
test('positive Across is up and positive angle is counterclockwise',()=>{
 const st=new Store();addSlices(st.state,['a','b','c'].map(id=>({id,dimensions:[10,4],spacing:[1,1]})));
 const geometry={ends:[[0,2],[10,2]],tangents:[[1,0],[1,0]]};align(st.state,Object.fromEntries(st.state.slices.map(s=>[s.id,{geometry}])));
 const p=[...st.state.joints[0].pivot];editJoint(st.state,0,{across:1});assert.deepEqual(sub(st.state.joints[0].pivot,p),[0,-1]);
 editJoint(st.state,0,{angle:90});const v=mul(st.state.slices[1].pose.matrix,[1,0]);assert(Math.abs(v[0])<1e-12);assert(v[1]<0);
 assert(mul(localMatrix({...st.state.slices[0],angle:90}),[1,0])[1]<0);
});
