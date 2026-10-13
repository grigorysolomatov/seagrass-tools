import test from 'node:test';import assert from 'node:assert/strict';
import {perimeter,ringArea,resample,smooth,splice,strokeTarget,applyEdits,cleanStroke} from './outline.mjs';
const circle=(r,n,cx=0,cy=0,noise=0)=>Float64Array.from({length:2*n},(_,i)=>{const k=i>>1,a=2*Math.PI*k/n,rr=r+(k%2?noise:-noise);return i%2?cy+rr*Math.sin(a):cx+rr*Math.cos(a);});
const square=s=>Float64Array.from([0,0,s,0,s,s,0,s]);
test('perimeter, area and resampling of a square',()=>{
 const q=square(10);assert.equal(perimeter(q),40);assert.equal(ringArea(q),100);
 const r=resample(q,1);assert.equal(r.length/2,40);assert.ok(Math.abs(ringArea(r)-100)<1e-9);
});
test('smoothing removes zigzag, keeps a circle and is identity at 0',()=>{
 const z=circle(200,2000,5,7,1.5),s=smooth(z,10);
 let worst=0;for(let i=0;i<s.length;i+=2)worst=Math.max(worst,Math.abs(Math.hypot(s[i]-5,s[i+1]-7)-200));
 assert.ok(worst<.2,'zigzag left '+worst);
 // Gaussian shrink of a circle: r·exp(-σ²/2r²) — about 0.25 px here.
 assert.ok(Math.abs(ringArea(s)-Math.PI*200**2)/(Math.PI*200**2)<.004);
 assert.deepEqual(Array.from(smooth(z,0)),Array.from(z));
});
test('splice replaces the shorter arc with the stroke',()=>{
 const q=resample(square(100),1);// notch: dent along the bottom edge y=0, x 40..60
 const stroke=[40,0,50,10,60,0];const out=splice(q,stroke);
 assert.ok(Math.abs(ringArea(out)-(10000-100))<1e-6,'area '+ringArea(out));
 // outward bump: stroke in reverse order gives the same region
 const rev=splice(q,[60,0,50,-10,40,0]);assert.ok(Math.abs(ringArea(rev)-(10000+100))<1e-6);
 assert.throws(()=>splice(q,[40,0,40,5,40,0]));
});
test('stroke must start and end on the same ring',()=>{
 const rings=[resample(square(100),1)];
 assert.equal(strokeTarget(rings,[40,1,50,10,60,-1],3).ring,0);
 assert.equal(strokeTarget(rings,[40,30,50,10,60,0],3),null);
});
test('applyEdits: smoothing then strokes in order; specks stay unsmoothed',()=>{
 const big=resample(square(100),1),speck=Float64Array.from([300,300,301,300,301,301]);
 const out=applyEdits([big,speck],{sigmaPx:2,strokes:[{ring:0,points:[40,0,50,10,60,0]}]});
 assert.deepEqual(Array.from(out[1]),Array.from(speck));
 assert.ok(ringArea(out[0])<10000-90&&ringArea(out[0])>10000-110,'area '+ringArea(out[0]));
 assert.equal(cleanStroke([0,0,.1,0,.2,0,1,0,1.1,0]).length,6);
});
