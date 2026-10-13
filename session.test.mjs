import test from 'node:test';import assert from 'node:assert/strict';
import {buildSession,parseSession,sessionState,compareResults,sameValue,FORMAT} from './session.mjs';
import {Store,addSlices,align,editJoint,orient} from './model.mjs';
import {handResult} from './hand_stem.mjs';
const scan=n=>({folder:'leaf/'+n,name:n,files:{'a.tmd':{size:10,sha256:'00'}}});
function setup(){
 const st=new Store().state;addSlices(st,[{id:'/d/a',path:'/d/a',dimensions:[100,50],spacing:[.01,.01]},{id:'/d/b',path:'/d/b',dimensions:[100,50],spacing:[.01,.01]}]);
 orient(st,0,{angle:12.5,mirrorH:true});st.slices[1].reverse=true;st.slices[1].topLocked=false;st.slices[1].top=7;st.shared.overlap=.3;st.background.threshold=97;
 st.slices[1].handStem={points:[[0,25],[50,24.5],[99,25]]};
 const auto={geometry:{ends:[[0,20],[100,30]],tangents:[[1,.1],[1,.1]]}};
 align(st,{'/d/a':auto,'/d/b':handResult(st.slices[1])});editJoint(st,0,{along:.2,across:-.1,angle:3});
 return st;
}
test('round trip restores poses, joints, settings and hand stems exactly',()=>{
 const st=setup(),doc=buildSession(st,[scan('a'),scan('b')],{edited:[[[0,0],[1,1],[2,0],[3,1]],null],alignedCurrent:true,steps:{background:true,stems:true,merge:true},post:{settings:{stemTop:20}},results:{leaf_area:{flat_mm2:1}}});
 const text=JSON.stringify(doc);assert.ok(!text.includes('/d/a'),'no absolute paths');
 const back=parseSession(text);assert.equal(back.format,FORMAT);
 const loads=[{id:'/e/a',path:'/e/a',dimensions:[100,50],spacing:[.01,.01]},{id:'/e/b',path:'/e/b',dimensions:[100,50],spacing:[.01,.01]}];
 const re=sessionState(back,loads);
 assert.deepEqual(re.joints,st.joints);assert.equal(re.aligned,true);
 for(const k of [0,1])for(const f of ['pose','angle','mirrorH','mirrorV','reverse','top','topLocked','degree','degreeLocked','anchor','handStem'])assert.deepEqual(re.slices[k][f],st.slices[k][f],f);
 assert.equal(re.slices[0].path,'/e/a');assert.deepEqual(re.shared,st.shared);assert.equal(re.background.threshold,97);assert.equal(re.background.enabled,false);
 assert.deepEqual(back.setup.slices[0].editedCurve.handles,[[0,0],[1,1],[2,0],[3,1]]);assert.equal(back.setup.slices[1].editedCurve,undefined);
 assert.deepEqual(back.steps,{background:true,stems:true,merge:true});
});
test('parse rejects foreign, future and damaged files with plain messages',()=>{
 assert.throws(()=>parseSession('nope'),/not JSON/);assert.throws(()=>parseSession('{"a":1}'),/not a Seagrass Tools session/);
 const doc=buildSession(setup(),[scan('a'),scan('b')]);
 assert.throws(()=>parseSession({...doc,version:2}),/version 2 is not supported/);
 const bad=structuredClone(doc);bad.setup.slices[0].pose.matrix=[[1,0]];assert.throws(()=>parseSession(bad),/slice 1 pose/);
 const j=structuredClone(doc);j.setup.joints=[];assert.throws(()=>parseSession(j),/joint count/);
 const h=structuredClone(doc);h.setup.slices[1].handStem.points=[[0,'x']];assert.throws(()=>parseSession(h),/hand-drawn/);
});
test('unaligned setup saves no joints; result comparison tolerates only rounding',()=>{
 const st=new Store().state;addSlices(st,[{id:'/d/a',path:'/d/a',dimensions:[10,5],spacing:[.01,.01]}]);
 const doc=parseSession(buildSession(st,[scan('a')]));assert.deepEqual(doc.setup.joints,[]);assert.equal(doc.setup.aligned,false);
 assert.ok(sameValue({a:[1,2.0000000000001]},{a:[1,2]}));assert.ok(!sameValue({a:1},{a:1.001}));
 assert.deepEqual(compareResults({candidates:{count:5},stem:null},{candidates:{count:5}}),[]);
 assert.deepEqual(compareResults({candidates:{count:5},leaf_area:{flat_mm2:2}},{candidates:{count:6},leaf_area:{flat_mm2:2}}),['candidates']);
});
