import test from 'node:test';import assert from 'node:assert/strict';
import {handGeometry,handResult,appendPoint,insideSlice,hitPoint,MAX_POINTS} from './hand_stem.mjs';
import {align,Store,addSlices} from './model.mjs';
test('hand geometry: ends and end-segment tangents',()=>{
 assert.equal(handGeometry([[1,1]]),null);
 assert.deepEqual(handGeometry([[0,0],[2,1],[5,1]]),{ends:[[0,0],[5,1]],tangents:[[2,1],[3,0]],interval:[0,1]});
 const s={id:'a',path:'a',handStem:{points:[[0,0],[4,0]]}};assert.equal(handResult(s).hand,true);assert.equal(handResult({id:'b'}),null);
});
test('append, bounds and hit testing',()=>{
 const p=[];assert.equal(appendPoint(p,[1.234,2]),true);assert.equal(appendPoint(p,[1.3,2.1]),false);assert.deepEqual(p,[[1.23,2]]);
 const big=Array.from({length:MAX_POINTS},(_,i)=>[i,0]);assert.throws(()=>appendPoint(big,[1e4,1]));
 const s={dimensions:[10,5]};assert.ok(insideSlice(s,[-.5,4.5]));assert.ok(!insideSlice(s,[9.6,0]));
 assert.equal(hitPoint([[0,0],[10,0]],p=>p,[9,1]),1);assert.equal(hitPoint([[0,0]],p=>p,[30,30]),-1);
});
test('Align consumes hand geometry like an automatic fit',()=>{
 const st=new Store().state;addSlices(st,[{id:'a',path:'a',dimensions:[100,50],spacing:[.01,.01]},{id:'b',path:'b',dimensions:[100,50],spacing:[.01,.01]}]);
 st.slices[1].handStem={points:[[0,25],[50,25],[100,25]]};
 const auto={geometry:{ends:[[0,20],[100,30]],tangents:[[1,.1],[1,.1]]}};
 align(st,{a:auto,b:handResult(st.slices[1])});
 const s=st.slices[1],start=[0,1].map(k=>s.pose.matrix[k][0]*0+s.pose.matrix[k][1]*25+s.pose.shift[k]);
 const A=st.slices[0].pose,end=[0,1].map(k=>A.matrix[k][0]*100+A.matrix[k][1]*30+A.shift[k]);
 assert.ok(Math.hypot(start[0]-end[0],start[1]-end[1])<1e-12);
 // Follower's incoming direction equals leader's outgoing direction.
 const dirIn=[s.pose.matrix[0][0],s.pose.matrix[1][0]],dirOut=[A.matrix[0][0]+.1*A.matrix[0][1],A.matrix[1][0]+.1*A.matrix[1][1]];
 assert.ok(Math.abs(dirIn[0]*dirOut[1]-dirIn[1]*dirOut[0])<1e-12&&dirIn[0]*dirOut[0]+dirIn[1]*dirOut[1]>0);
});
