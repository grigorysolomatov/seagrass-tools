import test from 'node:test';
import assert from 'node:assert/strict';
import {Store, addSlices, reorder, align, editJoint, orient, mul, sub} from './model.mjs';
const geometry={ends:[[0,25],[100,25]],tangents:[[1,0],[1,0]]};
test('Align is explicit and undoable; joint edits rigidly move downstream chain',()=>{
 const st=new Store();st.edit(s=>addSlices(s,['a','b','c'].map(meta)));const initial=structuredClone(st.state);
 st.edit(s=>align(s,Object.fromEntries(s.slices.map(x=>[x.id,{geometry}]))));const aligned=structuredClone(st.state);
 st.begin();st.update(s=>editJoint(s,0,{along:1,across:2,angle:10}));st.update(s=>editJoint(s,0,{along:2,across:3,angle:20}));st.end();
 assert.deepEqual(st.state.slices[0].pose,aligned.slices[0].pose);
 const point=(s,p)=>mul(s.pose.matrix,p).map((v,i)=>v+s.pose.shift[i]);
 assert(Math.hypot(...sub(point(st.state.slices[1],[100,25]),point(st.state.slices[2],[0,25])))<1e-9);
 st.undo();assert.deepEqual(st.state,aligned);st.undo();assert.deepEqual(st.state,initial);st.redo();assert.deepEqual(st.state,aligned);
});
test('native mirrors and continuous orientation preserve center; numeric edits do not move slices',()=>{
 const st=new Store();st.edit(s=>addSlices(s,[meta('a')]));const s=st.state.slices[0];
 const center=()=>mul(s.pose.matrix,[50,25]).map((v,i)=>v+s.pose.shift[i]);const before=center();
 st.edit(state=>orient(state,0,{angle:27.35,mirrorH:true}));assert(Math.hypot(...sub(center(),before))<1e-10);
 const m=s.pose.matrix;assert(m[0][0]*m[1][1]-m[0][1]*m[1][0]<0);
 const pose=structuredClone(s.pose);st.edit(state=>{state.shared.top=6;state.shared.degree=2;});assert.deepEqual(s.pose,pose);
});
const meta=id=>({id,path:id,dimensions:[100,50],spacing:[.1,.1]});
test('Load creates unaligned visible placements; order is reflected; undo restores',()=>{
 const store=new Store();store.edit(s=>addSlices(s,[meta('a'),meta('b')]));
 assert.equal(store.state.aligned,false);assert.equal(store.state.slices.length,2);
 const initial=structuredClone(store.state);assert.notDeepEqual(initial.slices[0].pose.shift,initial.slices[1].pose.shift);
 store.edit(s=>reorder(s,0,1));assert.equal(store.state.slices[0].id,'b');assert(store.state.slices[0].pose.shift[0]<store.state.slices[1].pose.shift[0]);
 store.undo();assert.deepEqual(store.state,initial);store.undo();assert.equal(store.state.slices.length,0);store.redo();assert.deepEqual(store.state,initial);
});
