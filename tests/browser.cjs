const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const url=process.env.STITCHER_URL;if(!url)throw Error('Set STITCHER_URL');
const out=process.env.TEST_OUTPUT||'test-results';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||undefined,args:process.env.CHROMIUM?['--no-sandbox']:[]});
const p=await browser.newPage({viewport:{width:1280,height:800},acceptDownloads:true});const errors=[],checks=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(240000);
try{
 await p.goto(url);assert.equal(await p.locator('#sharedTop').inputValue(),'20');assert.equal(await p.locator('#stemTop').inputValue(),'20');
 assert(await p.locator('#resetSliceCurve').isHidden());assert(await p.locator('#mergedEditControls').isHidden());
 const positions=await p.evaluate(()=>Object.fromEntries(['fit','undo','redo'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x,right:r.right}]})));
 assert(positions.undo.x-positions.fit.right<15);checks.push('top20 defaults, hidden edit controls, adjacent left history');
 await p.locator('#add').click();await p.locator('.folderRow input:not([disabled])').first().waitFor();await p.locator('#selectAllFolders').click();const count=await p.locator('.folderRow input:checked').count();assert(count>0);await p.locator('#load').click();await p.waitForFunction(n=>window.stitcherDebug().state.slices.length===n&&!window.stitcherDebug().loading,count);
 await p.locator('#prepareBackground').click();await p.waitForFunction(()=>window.stitcherDebug().ready&&!window.stitcherDebug().masking);
 assert(await p.locator('#align').isDisabled());const poses=await p.evaluate(()=>window.stitcherDebug().state.slices.map(s=>s.pose));
 await p.locator('#computeSliceStems').click();await p.waitForFunction(()=>window.stitcherDebug().stemsReady&&!window.stitcherDebug().computingStems);
 assert.deepEqual(await p.evaluate(()=>window.stitcherDebug().state.slices.map(s=>s.pose)),poses);checks.push('real load, foreground preparation, placement-neutral slice stems');
 await p.locator('#editSliceCurve').check();assert(await p.locator('#resetSliceCurve').isVisible());await p.locator('#editSliceCurve').uncheck();assert(await p.locator('#resetSliceCurve').isHidden());
 await p.locator('#align').click();await p.waitForFunction(()=>window.stitcherDebug().state.aligned&&!window.stitcherDebug().aligning);
 await p.locator('#merge').click();await p.waitForFunction(()=>window.stitcherDebug().merged&&!window.stitcherDebug().merging);
 await p.waitForFunction(()=>!!window.postDebug().leafArea);{const a=await p.evaluate(()=>window.postDebug().leafArea);assert(a.flat_mm2>0&&a.surface_mm2>=a.flat_mm2*(1-1e-9));assert(!(await p.locator('#areaStatus').textContent()).includes('failed'));checks.push('leaf area after merge: flat and 3D mm², 3D ≥ flat');}
 await p.locator('#computeStem').click();await p.waitForFunction(()=>window.postDebug().stemCurrent&&!window.postDebug().busy);
 const cohort=await p.evaluate(()=>{const d=window.stitcherDebug(),s=window.postDebug().stem;return s.fit.sources.map(src=>({individual:d.results[src.path].fit,combined:src}));});
 for(const {individual,combined} of cohort){assert.equal(individual.cutoff_mm,combined.cutoff_mm);assert.equal(individual.selected_pixels,combined.selected_pixels);assert.equal(individual.valid_pixels,combined.valid_pixels);}
 checks.push('individual/combined top20 thresholds and cohort counts identical');
 const automatic=await p.evaluate(()=>window.postDebug().stem.key);await p.locator('#editMergedCurve').check();assert(await p.locator('#mergedEditControls').isVisible());
 const handle=await p.evaluate(()=>{const d=window.stitcherDebug(),h=window.postDebug().editHandles[1],b=document.getElementById('canvas').getBoundingClientRect();return h.map((v,k)=>(d.merged.origin_center_mm[k]+v*d.merged.spacing_mm[k])*d.camera.scale+(k?d.camera.y+b.y:d.camera.x+b.x));});
 await p.mouse.move(...handle);await p.mouse.down();await p.mouse.move(handle[0]+2,handle[1]-3,{steps:5});await p.mouse.up();await p.waitForFunction(k=>!window.postDebug().curveBusy&&window.postDebug().stem.key!==k,automatic);
 const manual=await p.evaluate(()=>window.postDebug().stem.key);await p.locator('#undoMergedCurve').click();assert.equal(await p.evaluate(()=>window.postDebug().stem.key),automatic);await p.locator('#redoMergedCurve').click();assert.equal(await p.evaluate(()=>window.postDebug().stem.key),manual);await p.locator('#resetMergedCurve').click();assert.equal(await p.evaluate(()=>window.postDebug().stem.key),automatic);await p.locator('#editMergedCurve').uncheck();assert(await p.locator('#mergedEditControls').isHidden());checks.push('real combined-handle drag, scoped undo/redo/reset');
 if(process.env.SMALL_FIXTURE){await p.locator('#medianWindow').fill('11');await p.locator('#peakWindow').fill('5');}
 await p.locator('#computeCandidates').click();await p.waitForFunction(()=>window.postDebug().peaksCurrent&&!window.postDebug().busy);
 await p.locator('#computeBorders').click();await p.waitForFunction(()=>window.postDebug().bordersCurrent&&!window.postDebug().busy);
 for(const base of ['a','b']){
  await p.locator('#leafBase').selectOption(base);await p.locator('#previewPlot').click();await p.waitForFunction(b=>window.stemPlotDebug().ready&&window.stemPlotDebug().base===b,base);
  {const got=p.waitForEvent('download');await p.locator('#downloadArea').click();const file=await got;await file.saveAs(path.join(out,`leaf-area-${base}.csv`));assert(!await file.failure());assert(fs.readFileSync(path.join(out,`leaf-area-${base}.csv`),'utf8').includes('candidates_per_3d_area'));}
  for(const [button,kind] of [['downloadBorders','borders'],['downloadTrichomes','trichomes']]){const got=p.waitForEvent('download');await p.locator('#'+button).click();const file=await got;await file.saveAs(path.join(out,`${kind}-${base}.csv`));assert(!await file.failure());}
  fs.writeFileSync(path.join(out,`plot-${base}.json`),JSON.stringify(await p.evaluate(()=>window.stemPlotDebug())));
 }
 checks.push('candidates, borders, both-base plot and actual CSV downloads');
 await p.locator('aside').evaluate(e=>e.scrollTop=0);await p.screenshot({path:path.join(out,'workflow-1280.png')});
 fs.writeFileSync(path.join(out,'state.json'),JSON.stringify(await p.evaluate(()=>({slice:window.stitcherDebug(),post:window.postDebug()}))));
 assert.equal(await p.locator('#error').textContent(),'');assert.deepEqual(errors,[]);
 const report={status:'passed',checks,cohort:cohort.map(x=>({cutoff:x.individual.cutoff_mm,valid:x.individual.valid_pixels,selected:x.individual.selected_pixels})),candidates:await p.evaluate(()=>window.postDebug().pointCount),errors};fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await p.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify(await p.evaluate(()=>({slice:window.stitcherDebug?.(),post:window.postDebug?.(),error:document.getElementById('error')?.textContent}))));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
