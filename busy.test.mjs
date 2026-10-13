import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {elapsed,progressText} from './post.js';
test('busy labels: plain N/M progress and elapsed time',()=>{
 assert.equal(progressText({done:2,total:5}),'2/5');assert.equal(progressText({done:7,total:5}),'5/5');
 assert.equal(progressText({done:0,total:0}),'');assert.equal(progressText({done:1,total:2,phase:'median'}),'median 1/2');
 assert.equal(elapsed(950),'0 s');assert.equal(elapsed(12500),'12 s');assert.equal(elapsed(125000),'2 min 05 s');
});
test('every long action reports a working state and the footer has an activity line',()=>{
 const html=fs.readFileSync(new URL('index.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('app.js',import.meta.url),'utf8'),post=fs.readFileSync(new URL('post.js',import.meta.url),'utf8');
 assert(html.includes('id="activity"'));assert(html.includes('id="loadStatus"'));
 for(const label of ['Loading scans','Removing background','Computing slice stems','Merging raw heights'])assert(app.includes(`beginBusy('${label}'`),label);
 for(const label of ['Fitting merged stem','Computing candidates','Computing leaf borders','Finding nearest stem points'])assert(post.includes(`beginBusy('${label}'`),label);
 assert(post.includes("beginBusy('Preparing '+kind+' CSV'"));
 // Every job is ended in a finally block.
 for(const src of [app,post])assert.equal((src.match(/=beginBusy\(/g)||[]).length,(src.match(/finally\{job\.end\(\);/g)||[]).length);
});
