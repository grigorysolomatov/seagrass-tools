import test from 'node:test';import assert from 'node:assert/strict';
import {toBezier,fromBezier,evaluate,tessellate} from './curve_edit.mjs';
test('degree 1–8 power/Bernstein conversion and screen tolerance',()=>{
 let worst=0;
 for(let n=1;n<=8;n++){
  const c=Array.from({length:n+1},(_,i)=>[Math.sin(i+1),Math.cos(i+2)]),h=toBezier(c,[-.7,1.4]),b=fromBezier(h);
  for(let j=0;j<=100;j++){const u=j/100,p=evaluate(c,-.7+2.1*u),q=evaluate(b,u);worst=Math.max(worst,Math.hypot(p[0]-q[0],p[1]-q[1]));}
  assert.ok(worst<1e-9);assert.deepEqual(h[0],evaluate(c,-.7));
  const seg=tessellate(c,-.7,1.4,p=>p.map(x=>3000*x));assert.ok(seg.length>=(n===1?2:3));
 }
 console.log('JS exact conversion max error',worst);
});
