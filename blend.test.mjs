import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('photo blend normalizes overlap and respects fixed transforms',async()=>{
 assert(fs.existsSync(new URL('./blend.mjs',import.meta.url)),'normalized photo compositor is missing');
 const {featherWeights,blendPixels}=await import('./blend.mjs');
 const make=(id,color,shift)=>{const rgba=new Uint8ClampedArray(8*8*4);for(let i=0;i<64;i++)rgba.set([...color,255],i*4);return {id,width:8,height:8,rgba,weights:featherWeights(rgba,8,8),dimensions:[8,8],pose:{matrix:[[1,0],[0,1]],shift}};};
 const red=make('red',[200,20,40],[0,0]),blue=make('blue',[40,60,200],[4,0]);
 const a=blendPixels([red,blue],[0,0],[12,8],12,8),b=blendPixels([blue,red],[0,0],[12,8],12,8);
 assert.deepEqual(a,b);const at=(x,y)=>Array.from(a.slice((y*12+x)*4,(y*12+x)*4+4));
 assert.deepEqual(at(1,3),[200,20,40,255]);assert.deepEqual(at(10,3),[40,60,200,255]);
 const rw=red.weights[3*8+5],bw=blue.weights[3*8+1];assert.deepEqual(at(5,3),[Math.round((200*rw+40*bw)/(rw+bw)),Math.round((20*rw+60*bw)/(rw+bw)),Math.round((40*rw+200*bw)/(rw+bw)),255]);
 const gap=blendPixels([red],[0,0],[12,8],12,8);assert.equal(gap[(3*12+10)*4+3],0);
 assert(red.weights[3*8+3]>red.weights[0]);
});
