import {handlesFor,paintCurve,paintHandles,hitHandle} from './curve_edit.mjs';
import {floatingPlot} from './plot.mjs';
import {applyEdits,strokeTarget,cleanStroke} from './outline.mjs';
// Working-state indicators shared by every long action. Spinners are pure CSS
// transforms; JS only toggles classes and short N/M · elapsed text once a second.
// Display only: never touches scientific state or request ownership.
export function elapsed(ms){const s=Math.max(0,Math.floor(ms/1000));return s<60?s+' s':Math.floor(s/60)+' min '+String(s%60).padStart(2,'0')+' s';}
export function progressText({done=0,total=0,phase=''}={}){return [phase,total>0?`${Math.min(done,total)}/${total}`:''].filter(Boolean).join(' ');}
const jobs=new Set();let busyTimer=null;
function paintBusy(){
 const now=Date.now(),line=document.getElementById('activity');
 for(const job of jobs){
  const text=progressText(job),detail=[text,elapsed(now-job.start)].filter(Boolean).join(' · ');
  for(const el of job.buttons){el.classList.add('busy');el.setAttribute('aria-busy','true');el.dataset.progress=job.total>0?`${Math.min(job.done,job.total)}/${job.total}`:'';}
  for(const el of job.hints){el.classList.add('working');el.dataset.progress=detail;}
  // Stable element per job: rewriting it would restart the CSS spinner.
  if(!job.item&&line){job.item=document.createElement('span');job.item.className='activityItem';job.item.innerHTML='<span class="spinner" aria-hidden="true"></span><span></span>';line.append(job.item);}
  if(job.item)job.item.lastChild.textContent=[job.label,detail].join(' · ');
 }
 document.body.classList.toggle('working',jobs.size>0);
 if(line)line.hidden=!jobs.size;
}
function releaseBusy(job){
 const held=el=>[...jobs].some(j=>j.buttons.includes(el)||j.hints.includes(el));
 for(const el of job.buttons)if(!held(el)){el.classList.remove('busy');el.removeAttribute('aria-busy');delete el.dataset.progress;}
 for(const el of job.hints)if(!held(el)){el.classList.remove('working');delete el.dataset.progress;}
 job.item?.remove();
}
// Usage: beginBusy(label,{total,buttons,hints}) returns a job; call job.tick() per item and job.end() in finally.
export function beginBusy(label,{total=0,buttons=[],hints=[]}={}){
 const find=x=>typeof x==='string'?document.getElementById(x):x;
 const job={label,total,done:0,phase:'',start:Date.now(),buttons:buttons.map(find).filter(Boolean),hints:hints.map(find).filter(Boolean),item:null};
 jobs.add(job);
 job.tick=(n=1)=>{job.done+=n;paintBusy();};
 job.set=(v={})=>{for(const k of ['done','total','phase','label'])if(v[k]!==undefined)job[k]=v[k];paintBusy();};
 job.end=()=>{if(!jobs.delete(job))return;releaseBusy(job);paintBusy();if(!jobs.size&&busyTimer){clearInterval(busyTimer);busyTimer=null;}};
 if(!busyTimer)busyTimer=setInterval(paintBusy,1000);
 paintBusy();return job;
}
export async function trackBusy(label,options,fn){const job=beginBusy(label,options);try{return await fn(job);}finally{job.end();}}
export function busyJobs(){return [...jobs].map(j=>({label:j.label,done:j.done,total:j.total,phase:j.phase,elapsed_ms:Date.now()-j.start}));}
const fitTopHelp='Select the highest raw heights within each slice’s finite prepared foreground (default 20%), then clip the fitted curve to its prepared leaf boundary. The same population and inclusive percentile are used for the combined stem. Higher % includes more, lower pixels. This is not the mask cutoff; the mask seed stays fixed at top 5%. Edits retain placement until Align.';
const degreeHelp='Polynomial degree (1–8). Increase only when a simpler curve misses real bending; higher degrees can oscillate or overshoot, especially at the ends. Inspect Curve & ends rather than assuming higher is more accurate.';
const HELP={
 guideMedian:'Actual square pixel support: window width × native merged-grid spacing, not center-to-center span. Drag either square to move both guides near endpoint A. Follows world axes and camera zoom. Display only; merge first.',
 guideDetection:'Actual detection-window footprint, centered cross marks its central pixel. Drag either square to move both guides. Dashed outline distinguishes detection from the solid median guide. Display only; merge first.',
 computeBorders:'Sample normal cross-sections of the combined stem at physical arclength intervals. First exit of connected prepared finite foreground containing the stem; holes and gaps are not bridged. This is a prepared-mask border, not an anatomically validated edge.',
 showBorders:'Overlay solid cyan left and solid amber right borders looking from Leaf base toward the other end. Left positive; right negative. Real gaps remain disconnected. Display only.',
 borderStepMm:'Cross-section spacing along physical stem arclength in mm (default 0.05). The final interval may be shorter. Distance includes gaps, but border samples outside foreground or clipped stem intervals are missing.', 
 'bg-threshold':'Percentile of the calibrated photometric background score at the image border, not a height percentile. Increase to make the initial foreground test more selective; decrease if weak leaf signal is missed. Later segmentation can change the final shape. Default 99%.',
 'bg-closing':'Closing radius in calibration-grid pixels, not full-resolution pixels. Increase to bridge small gaps in the initial foreground; too large can connect unwanted regions. Zero disables this initial closing. Default 4 px.',
 'bg-core':'Erosion radius in calibration-grid pixels. Increase to shrink the locked sure-foreground interior, letting refinement reconsider more of the initial mask; decrease to protect more interior. This does not expand the mask. Default 16 px.',
 'bg-halo':'Dilation radius in calibration-grid pixels around the initial mask: the region where refinement may add foreground. Increase if edges are cut off; too large may admit background. Default 8 px.',
 'bg-iterations':'Number of GrabCut refinement passes. Increase to allow more refinement when the outline is poor; more passes take longer and do not guarantee a better mask. Default 6. Inspect the cut-out after Remove background.',
 mode:'Photo shows source photographs with display-only overlap blending. Heightmap stretches each slice independently; equal gray does not mean equal height across slices. Merged heightmap uses one global stretch of raw maximum heights.',
 source:'Display only: show original acquisition background instead of the cut-out. Does not change the prepared mask, fitted ends, raw heights or merge.',
 curve:'Show each slice’s fitted curve and incoming/outgoing ends. Ends meet the prepared leaf boundary, not the scan rectangle. These are slice fits, not the combined merged stem.',
 highlight:'Show the slice-fit top-height selection within the prepared foreground. Its percentile is computed over finite prepared foreground, exactly as in the combined per-source selection; separate and pooled polynomial fits can still differ.',
 sharedTop:fitTopHelp,sharedDegree:degreeHelp,
 sharedOverlap:'Initial spacing applied only by Align, in mm. Positive pulls consecutive ends together into overlap; negative creates a gap; zero joins the ends. Use Along after Align for local corrections.',
 angle:'Rotate this slice counterclockwise for positive degrees. Align retains the first slice as the orientation anchor but solves and replaces follower angles.',
 angleSlider:'Rotate the selected slice counterclockwise for positive degrees (slider −180° to 180°). The numeric field accepts a wider range. Align replaces follower angles.',
 mirrorH:'Mirror across the native horizontal image coordinate (left ↔ right before rotation). Transforms the photo, heightmap, mask and overlays together; it is not an endpoint swap.',
 mirrorV:'Mirror across the native vertical image coordinate (top ↔ bottom before rotation). Transforms the photo, heightmap, mask and overlays together; it is not an endpoint swap.',
 reverse:'Exchange incoming and outgoing fitted ends for the next Align, including tangent direction. Does not mirror or rotate the image and does not infer leaf tip or base.',
 'local-top':fitTopHelp,'local-degree':degreeHelp,
 'lock-top':'Locked uses shared Top %. Unlock to edit this slice, initially copying the shared value. Lock again to restore the current shared value.',
 'lock-degree':'Locked uses shared Degree. Unlock to edit this slice, initially copying the shared value. Lock again to restore the current shared value.',
 jointSelect:'Choose which join to refine. Corrections move that join’s downstream slice and all later slices together, preserving their internal joins.',
 align:'Join CURRENT prepared stems (including manual handles) by their endpoint tangents. Does not compute or replace curves. Retains the first slice orientation, replaces follower rotations and resets joint refinements. Compute slice stems first.',
 prepareBackground:'Compute the leaf mask from calibrated acquisition images. Required before Align. Mask edits need this action again; existing placement is retained. Inspect the cut-out before joining.',
 merge:'Merge finite raw heights inside prepared masks onto one physical grid; overlaps use the maximum. No height offset or tilt leveling is performed. Requires preparation and Align; edits make the previous merge stale.',
 stemTop:'Apply this top percentage independently to each original slice’s finite prepared foreground raw heights, then pool the transformed observations for one merged stem. Higher % includes more, lower pixels. Like step 3, background is excluded from each percentile; this is not a global percentile of the merged maximum.',
 stemDegree:'Polynomial degree (1–8) for the combined merged stem. Higher degrees allow more bending but may oscillate or overshoot. Inspect the stem; this does not straighten slices or restrict candidate detection.',
 computeStem:'Fit one shared curve from per-source foreground top-height observations at the current merge poses. Does not move slices, level heights or filter candidates by distance to the curve.',
 medianWindow:'Odd square window width in native merged-grid pixels (default 101), not screen or calibration-grid pixels. Larger windows estimate background over a wider region and change the residual feature scale. Only complete finite foreground windows are kept; larger windows exclude more edges.',
 peakWindow:'Odd square window width in native merged-grid pixels (default 21). A candidate must be a centered residual maximum with full finite window support. Larger windows make maxima compete over a wider neighborhood and exclude more edges. This is separate from median smoothing; candidates are not confirmed trichomes.',
 medianBits:'Histogram quantization precision for the median (default 12 bits), not source-file bit depth. More bits reduce bin width but can cost more time and memory. Even a 1-pixel window uses quantized values; original minus median remains signed in mm.',
 computeCandidates:'Subtract the quantized local median from raw merged heights, then find centered residual maxima. Requires full windows; one representative per exact tied maximum plateau, with a lower neighbor. No amplitude threshold, area filter or biological validation.',
 previewMedian:'Temporarily preview the computed median background in place of the selected main display. Turn off to restore Photo, Heightmap or Merged. Only one diagnostic preview is active; changing the main display clears it. Display only; no computation or source changes.',
 previewResidual:'Temporarily preview signed raw height minus median; negative values are retained. Turn off to restore the selected main display. Only one diagnostic preview is active; changing the main display clears it. Display only; no computation or source changes.',
 showStem:'Overlay the current combined merged stem, not the separate slice-fit curves. Dashed sections are extrapolated; this does not filter candidate detection.',
 showTop:'Overlay the union of transformed top-height selections made independently within each source’s prepared foreground. The fit retains observations from both sources in overlaps.',
 leafBase:'Choose which existing combined-curve endpoint is the leaf base: End A or End B, labelled on the canvas. No anatomical base is inferred and no endpoint is moved. For equally near curve points (within 1e-7 native-grid pixels), choose the point reached first along the curve from this base. This updates nearest-point ties and reverses border arclength origin, left/right sides and signed distances, without refitting or detecting again.',
 showLines:'Display thin connections to numerically nearest points on the finite, mask-clipped combined polynomial stem, including valid extrapolated sections. Lines and candidate rings are independent. Requires BOTH current stem and candidates; gaps cannot be targets. Equal-distance ties follow arclength from Leaf base. No measurements or detection filters are added.',
 showCandidates:'Overlay computed residual-maximum candidate positions. Markers are exploratory candidates, not biologically validated trichomes.',
 showOutline:'Draw the leaf outline used for leaf area and borders. Lavender = current outline; dashed grey = original outline from the merged mask, shown once you edit. Display only.',
 outlineSmooth:'Smooth the outline along its length (Gaussian, in mm of outline length). 0 = original outline from the merged mask. Removes small zigzags from stitching; large values round off real detail. Leaf area, candidate density and leaf borders use the edited outline.',
 redrawOutline:'Then drag on the canvas from one point on the outline to another: the shorter stretch of outline between them is replaced by your stroke. Start and end within about 15 screen pixels of the outline. Cells your stroke encloses are added (counted flat where no height exists); cells it cuts off are removed.',
 undoOutline:'Undo the last outline change (smoothing, redrawn section or reset).',
 resetOutline:'Return to the original outline from the merged mask. Undo brings the edits back.',
 markerSize:'Marker radius in screen pixels only (default 2). Changes visibility, not the detection window, candidate count or physical feature size.',
 fit:'Fit all original acquisition frames into view. Changes the camera only, not placement, masks or fit parameters.',
 canvas:'Click a slice to select it; drag to pan; wheel to zoom. Blank clicks retain selection. These viewing actions do not change the scientific data or edit history.',
 undo:'Undo composition and parameter edits, preparation, Align or joint corrections in this tab. View mode, overlays, selection, pan and zoom are not edit history. Refresh clears the setup and history.',
 redo:'Redo an undone composition edit in this tab. Does not restore view changes or a setup lost on refresh.',
 folderPath:'Current folder (address bar). Type a path under the data folder and press Enter or Go. Moving to another folder clears ticked scans.',
 browse:'Go to the folder typed in the path box. Tick scans there, then Load.',
};
const jointHelp={
 along:'Incremental translation in mm along the moving slice’s current joint direction, including its own rotation. Positive moves forward along that direction; all downstream slices move together. Buttons / arrow keys: 0.1 mm. After rotations, setting zero is not a reset; use Undo or Align again.',
 across:'Incremental translation in mm perpendicular to the moving slice’s current joint direction, including its own rotation. Positive moves toward its local upper side (up when Along points right). All downstream slices move together. Buttons / arrow keys: 0.1 mm; zero is not a reset after rotations.',
 angle:'Positive degrees rotate the downstream chain counterclockwise around the current joint pivot. Along/Across axes rotate with it; past translations are not reapplied. Buttons / arrow keys: 1°. Align again resets all refinements.',
};
let focusTip;
export function setHelp(el,reason=''){
 if(!el)return;
 const base=HELP[el.id]||jointHelp[el.id.match(/^joint-\d+-(along|across|angle)(?:-minus|-plus)?$/)?.[1]];
 if(!base)return;
 const text=base+(reason?' '+reason:'');
 el.title=text;el.setAttribute('aria-description',text);
 for(const label of el.labels||[])label.title=text;
 if(focusTip&&!focusTip.hidden&&document.activeElement===el)focusTip.textContent=text;
}
export function applyHelp(root=document){
 for(const el of root.querySelectorAll('[id]'))setHelp(el);
 for(const el of root.querySelectorAll('summary[title]'))el.setAttribute('aria-description',el.title);
}
export function installHelp(){
 installNumericControls();
 applyHelp();
 focusTip=document.createElement('div');focusTip.id='focusHelp';focusTip.setAttribute('role','tooltip');focusTip.hidden=true;document.body.append(focusTip);
 // Native titles cover hover (including labels of disabled controls); focus help
 // makes the same descriptions visible to keyboard users without changing names.
 document.addEventListener('focusin',e=>{
  const text=e.target.getAttribute('aria-description');if(!text){focusTip.hidden=true;return;}
  (e.target.closest('dialog')||document.body).append(focusTip);
  focusTip.textContent=text;focusTip.hidden=false;
  const rect=e.target.getBoundingClientRect();focusTip.style.left=Math.max(8,Math.min(rect.left,innerWidth-368))+'px';
  focusTip.style.top=Math.max(8,Math.min(rect.bottom+8,innerHeight-focusTip.offsetHeight-8))+'px';
 });
 document.addEventListener('focusout',()=>{focusTip.hidden=true;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')focusTip.hidden=true;});
 document.addEventListener('pointerdown',()=>{focusTip.hidden=true;});
 document.addEventListener('scroll',()=>{focusTip.hidden=true;},true);
}

// Native editors retain their identity and handlers; adjacent clicks survive blur.
function installNumericControls(){
 const steps={sharedTop:1,sharedDegree:1,stemTop:1,stemDegree:1,medianWindow:2,peakWindow:2,medianBits:1,borderStepMm:.005,heightCutoffMm:.001,inwardMarginMm:.01};
 for(const [id,step] of Object.entries(steps)){
  const input=document.getElementById(id);if(!input||input.closest('.numericEditor'))continue;
  const originalLabel=input.labels?.[0],label=originalLabel?.textContent.trim()||id;
  const wrap=document.createElement('span');wrap.className='numericEditor';
  if(originalLabel?.contains(input)){
   // Buttons inside an implicit label would steal its input association.
   const field=document.createElement('div');field.className=(originalLabel.className+' numericField').trim();
   originalLabel.before(field);originalLabel.className='';originalLabel.htmlFor=id;field.append(originalLabel,wrap);wrap.append(input);
  }else{input.before(wrap);wrap.append(input);}
  const change=direction=>{
   if(input.disabled||input.value===''||!Number.isFinite(input.valueAsNumber))return;
   const value=Number((input.valueAsNumber+direction*step).toPrecision(12));
   if(value<Number(input.min)||value>Number(input.max))return;
   input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  for(const [direction,name,text] of [[-1,'minus','−'],[1,'plus','+']]){
   const button=document.createElement('button');button.type='button';button.id=id+'-'+name;button.className='numericStep';button.textContent=text;
   button.setAttribute('aria-label',`${direction<0?'Decrease':'Increase'} ${label} by ${step}`);button.title=button.getAttribute('aria-label');button.onclick=()=>change(direction);
   if(direction<0)wrap.prepend(button);else wrap.append(button);
  }
  input.addEventListener('keydown',event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();change(event.key==='ArrowUp'?1:-1);}});
 }
}

// Derived scientific state is separate from editable slice geometry/history.
export function postMerge({get,api,image,images,draw,error}){
 const $=id=>document.getElementById(id),value=id=>Number($(id).value);
 let diagnosticPreview='';
 let exportBusy=false,exportGeneration=0;
 let automaticStem=null,curveBusy=false,curveGesture=null,curvePast=[],curveFuture=[],guideOffset=null,guideMerge=null,guideScreen=null,guideRadius=13,guideGesture=null,selectedCandidate=null;
 const automaticStems=new Map();
 const borderOptions=()=>({height_cutoff_enabled:$('heightCutoffEnabled').checked,height_cutoff_mm:value('heightCutoffMm'),inward_margin_mm:value('inwardMarginMm'),outline_key:outlineKey()});
 const exportReady=kind=>!busy&&!curveBusy&&!curveGesture&&!borderBusy&&stemCurrent()&&(kind==='borders'?bordersCurrent():peaksCurrent());
 // One Export chooser (step 9): kind + filename (remembered per kind) + one Download button.
 const exportNames={trichomes:'trichomes.csv',borders:'leaf-borders.csv',area:'leaf-area.csv',outline:'leaf-outline.csv',heightmap:'heightmap.tif'};
 const exportKind=()=>$('exportKind').value;
 function saveFile(blob,name){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 function savedName(kind,name){exportNames[kind]=name;if(exportKind()===kind)$('exportFilename').value=name;}
 const exportPayload=kind=>({kind,quality:$('exportQuality').checked,filename:exportNames[kind],base:$('leafBase').value,merge_key:get().merged?.key,stem_key:stem?.key,stem_parameters:stem?.parameters,...(kind==='borders'?{border_key:borders?.key,step_mm:value('borderStepMm'),...borderOptions()}:{peaks_key:peaks?.key,residual_key:residual?.key,residual_parameters:residual?.parameters,window:value('peakWindow')})});
 async function download(kind){
  if(exportBusy||!exportReady(kind))return;
  const revision=get().revision,generation=exportGeneration,payload=exportPayload(kind),signature=JSON.stringify(payload);
  exportBusy=true;error();$('exportStatus').textContent='Preparing CSV…';status();const job=beginBusy('Preparing '+kind+' CSV',{buttons:['downloadExport'],hints:['exportStatus']});
  try{
   const result=await api('/api/export',payload);
   if(revision!==get().revision||generation!==exportGeneration||!exportReady(kind)||signature!==JSON.stringify(exportPayload(kind)))throw Error('Discarded: export settings or scientific inputs changed. Download again.');
   const expected=kind==='borders'?borders.count:peaks.count;if(result.count!==expected)throw Error('Export row count mismatch');
   saveFile(new Blob([result.csv],{type:'text/csv;charset=utf-8'}),result.filename);savedName(kind,result.filename);
   $('exportStatus').textContent=`Download ready · ${result.filename} · ${result.count.toLocaleString()} rows · base ${result.base.toUpperCase()}`;
  }catch(e){$('exportStatus').textContent='Failed · '+e.message;error(e.message);}
  finally{job.end();exportBusy=false;status();}
 }
 // Leaf outline CSV: the edited outline when there is one (else the original), stitched world mm.
 const outlineExportReady=()=>outlineReady()&&!outlinePending()&&!outlineBusy;
 async function downloadOutline(){
  if(exportBusy||!outlineExportReady())return;const key=get().merged.key,ok=outlineKey(),generation=exportGeneration;
  exportBusy=true;error();$('exportStatus').textContent='Preparing CSV…';status();const job=beginBusy('Preparing leaf outline CSV',{buttons:['downloadExport'],hints:['exportStatus']});
  try{const r=await api('/api/export/outline',{merge_key:key,outline_key:ok,filename:exportNames.outline});
   if(!outlineExportReady()||get().merged.key!==key||outlineKey()!==ok||generation!==exportGeneration)throw Error('Discarded: merge or outline changed. Download again.');
   saveFile(new Blob([r.csv],{type:'text/csv;charset=utf-8'}),r.filename);savedName('outline',r.filename);
   $('exportStatus').textContent=`Download ready · ${r.filename} · ${r.points.toLocaleString()} points · ${r.rings} ring${r.rings===1?'':'s'} · ${r.edited?'edited':'original'} outline · mm`;
  }catch(e){$('exportStatus').textContent='Failed · '+e.message;error(e.message);}
  finally{job.end();exportBusy=false;status();}
 }
 // Height map: binary float32 TIFF straight from the cached merge (can be tens of MB).
 async function downloadHeightmap(){
  if(exportBusy||!mergeCurrent())return;const key=get().merged.key,revision=get().revision;
  exportBusy=true;error();$('exportStatus').textContent='Preparing height map TIFF…';status();const job=beginBusy('Preparing height map TIFF',{buttons:['downloadExport'],hints:['exportStatus']});
  try{const r=await fetch('/api/export/heightmap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({merge_key:key,filename:exportNames.heightmap})});
   if(!r.ok){let m=r.statusText;try{m=(await r.json()).error||m;}catch{}throw Error(m);}
   const blob=await r.blob(),name=r.headers.get('X-Filename')||exportNames.heightmap;
   if(!mergeCurrent()||get().merged.key!==key||get().revision!==revision)throw Error('Discarded: merge changed. Download again.');
   saveFile(blob,name);savedName('heightmap',name);
   $('exportStatus').textContent=`Download ready · ${name} · ${(blob.size/1e6).toFixed(1)} MB · float32 heights in mm, NaN = no data`;
  }catch(e){$('exportStatus').textContent='Failed · '+e.message;error(e.message);}
  finally{job.end();exportBusy=false;status();}
 }
 $('downloadExport').onclick=()=>{const k=exportKind();if(k==='borders'||k==='trichomes')download(k);else if(k==='area')downloadArea();else if(k==='outline')downloadOutline();else downloadHeightmap();};
 $('exportKind').addEventListener('change',()=>{$('exportFilename').value=exportNames[exportKind()];if(!exportBusy)$('exportStatus').textContent='';status();});
 $('exportFilename').addEventListener('input',()=>{exportNames[exportKind()]=$('exportFilename').value;});
 // Readiness of the chosen export: [ready, reason when not ready, button suffix].
 function exportChoice(){
  const k=exportKind(),s=stemCurrent();
  if(k==='trichomes')return exportReady(k)?[true,'',' · '+peaks.count.toLocaleString()]:[false,!s?'Fit a current merged stem (step 6) and compute candidates (step 7).':'Compute candidates (step 7).'];
  if(k==='borders')return exportReady(k)?[true,'',' · '+borders.count.toLocaleString()]:[false,!s?'Fit a current merged stem (step 6) and compute leaf borders (step 8).':'Compute leaf borders (step 8).'];
  if(!mergeCurrent())return [false,'Merge first (step 5).'];
  if(k==='area')return areaCurrent()?[true,'']:[false,areaFailure?'Leaf area failed · '+areaFailure:'Measuring leaf area…'];
  if(k==='outline')return outlineExportReady()?[true,'',edited()?' · edited':'']:[false,outlineFailure?'Outline failed · '+outlineFailure:'Preparing leaf outline…'];
  return [true,''];
 }
 const exportHelp={trichomes:'One row per candidate: stem coordinates (x along the stem from the leaf base, y signed distance), PCA coordinates (straight axes of the stem fit) and stitched global x/y, all in mm, plus height.',borders:'Left and right leaf border distance along the stem, mm, from the selected leaf base.',area:'Flat and 3D leaf area (mm²), per-slice areas and pixel sizes; with candidates also candidates per mm².',outline:'Leaf outline points in stitched global mm (x right, y down): the edited outline if you edited it in step 5, else the original.',heightmap:'Merged height map as a 32-bit float TIFF: heights in mm, NaN where there is no leaf, pixel size in mm (ImageJ/Fiji reads it directly).'};
 // Leaf outline (step 5): original = outer boundary of the merged mask; edits = smoothing + redrawn
 // sections (outline.mjs). Edits are kept per merge key, so Undo/Redo of the setup finds them again.
 // With no edits every downstream request sends outline_key null = original mask, unchanged science.
 let outlineOriginal=null,outlineFetch=null,outlineFailure='',outlineGesture=null,outlineBusy=false,sliderSnapshot=null,outlineTimer=null;
 const outlineEdits=new Map(),outlineKeys=new Map(),outlineStats=new Map();let editedMemo={sig:null,rings:null};
 const noEdits=()=>({sigmaMm:0,strokes:[],past:[],future:[]});
 const outlineState=()=>{const k=get().merged?.key;if(!k)return noEdits();if(!outlineEdits.has(k))outlineEdits.set(k,noEdits());return outlineEdits.get(k);};
 const outlineReady=()=>!!(outlineOriginal&&mergeCurrent()&&outlineOriginal.merge_key===get().merged.key);
 const edited=()=>{const e=outlineState();return e.sigmaMm>0||e.strokes.length>0;};
 const outlineSig=()=>JSON.stringify([get().merged?.key,outlineState().sigmaMm,outlineState().strokes]);
 const outlineKey=()=>edited()?outlineKeys.get(outlineSig())||null:null;
 const outlinePending=()=>edited()&&!outlineKey();
 function editedRings(){
  if(!outlineReady())return null;const sig=outlineSig();if(editedMemo.sig===sig)return editedMemo.rings;
  const e=outlineState(),sigmaPx=e.sigmaMm/get().merged.spacing_mm[0];
  editedMemo={sig,rings:edited()?applyEdits(outlineOriginal.rings,{sigmaPx,strokes:e.strokes}):outlineOriginal.rings};return editedMemo.rings;
 }
 async function fetchOutline(){
  const key=get().merged.key;outlineFetch=key;outlineFailure='';
  const job=beginBusy('Tracing leaf outline',{hints:['outlineStatus']});
  try{const r=await api('/api/outline',{merge_key:key});if(outlineFetch===key)outlineOriginal={...r,rings:r.rings.map(a=>Float64Array.from(a))};}
  catch(e){if(outlineFetch===key)outlineFailure=e.message;}
  finally{job.end();status();draw();}
 }
 // Register the edited outline once the user pauses; area and borders wait for the key.
 function scheduleRegister(){clearTimeout(outlineTimer);if(edited()&&!outlineKey())outlineTimer=setTimeout(registerOutline,350);status();draw();}
 async function registerOutline(){
  if(!outlineReady()||!edited()||outlineKey()||outlineBusy)return;
  const sig=outlineSig(),e=outlineState(),rings=editedRings();outlineBusy=true;outlineFailure='';status();
  const job=beginBusy('Saving edited outline',{hints:['outlineStatus']});
  try{const r=await api('/api/outline/edit',{merge_key:get().merged.key,smoothing_mm:e.sigmaMm,redrawn_sections:e.strokes.length,rings:rings.map(a=>Array.from(a,v=>Math.round(v*1000)/1000))});outlineKeys.set(sig,r.key);outlineStats.set(r.key,r);}
  catch(err){outlineFailure=err.message;error(err.message);}
  finally{job.end();outlineBusy=false;if(edited()&&!outlineKey()&&!outlineFailure)scheduleRegister();status();draw();}
 }
 function outlineChange(mutate){const e=outlineState();e.past.push({sigmaMm:e.sigmaMm,strokes:e.strokes});e.future=[];mutate(e);syncOutlineInputs();exportGeneration++;borderGeneration++;outlineFailure='';scheduleRegister();}
 function syncOutlineInputs(){const v=outlineState().sigmaMm;$('outlineSmooth').value=v;$('outlineSmoothValue').textContent=v?v.toFixed(3)+' mm':'off';}
 function outlineStatus(){
  const g=get(),ready=outlineReady(),e=outlineState();$('outlineEdit').hidden=!g.merged;
  if(mergeCurrent()&&outlineFetch!==g.merged.key)fetchOutline();
  for(const id of ['outlineSmooth','redrawOutline','showOutline'])$(id).disabled=!ready;
  $('undoOutline').disabled=!ready||!e.past.length;$('redoOutline').disabled=!ready||!e.future.length;$('resetOutline').disabled=!ready||!edited();
  if(!ready&&$('redrawOutline').checked)$('redrawOutline').checked=false;
  $('canvas').classList.toggle('drawing',ready&&$('redrawOutline').checked);
  const st=outlineStats.get(outlineKey()),mm2=v=>v.toFixed(3)+' mm²';
  $('outlineStatus').textContent=!mergeCurrent()?(g.merging?'':'Merge again to edit the outline.'):outlineFailure?'Outline failed · '+outlineFailure:!ready?'Tracing leaf outline…':outlineBusy||outlinePending()?'Saving edited outline…':!edited()?'Original outline from the merged mask.':
   `Edited · ${e.sigmaMm?'smoothing '+e.sigmaMm.toFixed(3)+' mm':'no smoothing'}${e.strokes.length?' · '+e.strokes.length+' redrawn':''}${st?[st.cells_without_height?` · +${mm2(st.cells_without_height*st.cell_mm**2)} added`:'',st.cells_removed?` · −${mm2(st.cells_removed*st.cell_mm**2)} cut`:''].join(''):''} · used for leaf area and borders.`;
  syncOutlineInputs();
 }
 $('outlineSmooth').addEventListener('input',()=>{const e=outlineState();if(!sliderSnapshot)sliderSnapshot={sigmaMm:e.sigmaMm,strokes:e.strokes};e.sigmaMm=Number($('outlineSmooth').value);e.future=[];$('showOutline').checked=true;syncOutlineInputs();exportGeneration++;borderGeneration++;scheduleRegister();});
 $('outlineSmooth').addEventListener('change',()=>{const e=outlineState();if(sliderSnapshot&&sliderSnapshot.sigmaMm!==e.sigmaMm)e.past.push(sliderSnapshot);sliderSnapshot=null;status();});
 $('undoOutline').onclick=()=>{const e=outlineState();if(!e.past.length)return;e.future.push({sigmaMm:e.sigmaMm,strokes:e.strokes});Object.assign(e,e.past.pop());syncOutlineInputs();exportGeneration++;borderGeneration++;scheduleRegister();};
 $('redoOutline').onclick=()=>{const e=outlineState();if(!e.future.length)return;e.past.push({sigmaMm:e.sigmaMm,strokes:e.strokes});Object.assign(e,e.future.pop());syncOutlineInputs();exportGeneration++;borderGeneration++;scheduleRegister();};
 $('resetOutline').onclick=()=>{if(edited())outlineChange(e=>{e.sigmaMm=0;e.strokes=[];});};
 $('redrawOutline').onchange=()=>{if($('redrawOutline').checked){$('showOutline').checked=true;$('editMergedCurve').checked=false;$('mergedEditControls').hidden=true;$('editSliceCurve').checked=false;$('resetSliceCurve').hidden=true;}status();draw();};
 $('showOutline').onchange=()=>{status();draw();};
 $('outlineEdit').addEventListener('toggle',()=>{if($('outlineEdit').open&&outlineReady())$('showOutline').checked=true;status();draw();});
 function paintOutline(ctx,camera){
  const rings=editedRings();if(!rings||!($('showOutline').checked||$('redrawOutline').checked||outlineGesture))return;
  const m=get().merged,r=m.spacing_mm[0],o=m.origin_center_mm,sx=v=>camera.x+(o[0]+v*r)*camera.scale,sy=v=>camera.y+(o[1]+v*r)*camera.scale;
  const path=(list,close=true)=>{ctx.beginPath();for(const a of list){for(let i=0;i<a.length;i+=2){const x=sx(a[i]),y=sy(a[i+1]);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}if(close)ctx.closePath();}};
  ctx.save();
  if(edited()){ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(200,200,200,.65)';ctx.lineWidth=1;path(outlineOriginal.rings);ctx.stroke();ctx.setLineDash([]);}
  for(const [ink,width] of [['#000',3],['#c58cff',1.5]]){ctx.strokeStyle=ink;ctx.lineWidth=width;path(rings);ctx.stroke();}
  if(outlineGesture&&outlineGesture.points.length>=4){ctx.strokeStyle='#ff0088';ctx.lineWidth=2;path([outlineGesture.points],false);ctx.stroke();}
  ctx.restore();
 }
 function outlineDown(e,camera,p){
  if(!$('redrawOutline').checked||!outlineReady())return false;
  const m=get().merged,r=m.spacing_mm[0],o=m.origin_center_mm,native=q=>q.map((v,k)=>((v-(k?camera.y:camera.x))/camera.scale-o[k])/r);
  outlineGesture={id:e.pointerId,points:[...native(p)],native,tol:15/(r*camera.scale)};$('canvas').setPointerCapture(e.pointerId);draw();return true;
 }
 function outlineUp(){
  const g=outlineGesture;outlineGesture=null;const stroke=cleanStroke(g.points,.5);
  if(stroke.length<6){draw();return;}
  const target=strokeTarget(editedRings(),stroke,g.tol);
  if(!target){error('Start and end the stroke on the lavender outline (within about 15 screen pixels).');draw();return;}
  error();outlineChange(e=>{e.strokes=[...e.strokes,{ring:target.ring,points:stroke.map(v=>Math.round(v*100)/100)}];});
 }
 // Leaf area follows each current merge automatically (cached server-side). Display and export only.
 let leafArea=null,areaBusy=false,areaFailure='',areaRequested=null;
 const areaWant=()=>get().merged.key+'|'+(outlineKey()||'');
 const areaCurrent=()=>!!(leafArea&&mergeCurrent()&&!outlinePending()&&leafArea.merge_key===get().merged.key&&(leafArea.outline_key||null)===outlineKey());
 const mm2=v=>v.toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3})+' mm²';
 async function computeArea(){
  const key=get().merged.key,ok=outlineKey(),want=areaWant();areaRequested=want;areaBusy=true;areaFailure='';status();
  const job=beginBusy('Measuring leaf area',{hints:['areaStatus']});
  try{const r=await api('/api/area',{merge_key:key,outline_key:ok});if(areaRequested===want){leafArea=r;insideCounts=new Map();}}
  catch(e){if(areaRequested===want)areaFailure=e.message;}
  finally{job.end();if(areaRequested===want)areaBusy=false;status();}
 }
 function areaStatus(){
  const g=get(),el=$('areaStatus'),p=peaksCurrent();el.hidden=!g.merged;
  if(mergeCurrent()&&!outlinePending()&&!areaBusy&&areaRequested!==areaWant())computeArea();
  const a=areaCurrent()?leafArea:null,n=a&&p?(a.outline_key?areaCandidates(a):peaks.count):null;
  el.textContent=areaBusy||(mergeCurrent()&&outlinePending())?'Measuring leaf area…':areaFailure?'Leaf area failed · '+areaFailure:!mergeCurrent()?(g.merging?'':'Leaf area · merge again to update.'):a?`Leaf area · flat ${mm2(a.flat_mm2)} · 3D ${mm2(a.surface_mm2)} (×${a.ratio.toFixed(3)})${a.outline_key?' · edited outline':''}`+(n!==null&&n!==undefined?` · ${n.toLocaleString()} candidates${a.outline_key?' inside':''} = ${(n/a.flat_mm2).toFixed(1)} / ${(n/a.surface_mm2).toFixed(1)} per mm² (flat / 3D)`:''):'';
  const cal=a?a.calibration.map((c,i)=>`Slice ${i+1}: ${(c.pixel_mm[0]*1000).toFixed(4)} × ${(c.pixel_mm[1]*1000).toFixed(4)} µm/px${c.scan_yaml_relative_difference!==null&&c.scan_yaml_relative_difference<1e-6?' (matches scan.yaml)':''} · flat ${mm2(a.slices[i].flat_mm2)} · 3D ${mm2(a.slices[i].surface_mm2)}`).join('\n'):'';
  el.title=a?`Prepared-foreground area of the current merge, in mm². Flat = projected area: covered cells × (${(a.cell_mm*1000).toFixed(4)} µm)². 3D = area of the measured height surface, including trichomes: each cell × √(1 + slope²), slopes from raw TMD heights (mm) on each slice's native grid, between foreground neighbours only. Leaf-edge walls, background and slice seams are not counted; overlaps count once.${a.outline_key?' Uses the edited outline: cells outside it are dropped, cells it adds without height count flat; candidate density counts candidates inside it.':''} Calibration from each TMD header:\n${cal}`:'Leaf area in mm², measured automatically after each Merge.';
  el.setAttribute('aria-description',el.title);
 }
 // Candidates inside an edited outline need the region; counted server-side once per (area, candidates).
 let insideCounts=new Map();
 function areaCandidates(a){
  const k=a.key+'|'+peaks.key;if(insideCounts.has(k))return insideCounts.get(k);insideCounts.set(k,null);
  api('/api/area',{merge_key:a.merge_key,outline_key:a.outline_key,peaks_key:peaks.key}).then(r=>{insideCounts.set(k,r.candidates);status();}).catch(e=>{insideCounts.delete(k);error(e.message);});
  return null;
 }
 async function downloadArea(){
  if(exportBusy||!areaCurrent())return;const key=leafArea.merge_key,pk=peaksCurrent()?peaks.key:null;
  exportBusy=true;error();$('exportStatus').textContent='Preparing CSV…';status();const job=beginBusy('Preparing leaf area CSV',{buttons:['downloadExport'],hints:['exportStatus']});
  const ok=leafArea.outline_key||null;
  try{const r=await api('/api/area/export',{merge_key:key,outline_key:ok,peaks_key:pk,filename:exportNames.area});
   if(!areaCurrent()||leafArea.merge_key!==key||(leafArea.outline_key||null)!==ok)throw Error('Discarded: merge or outline changed. Download again.');
   saveFile(new Blob([r.csv],{type:'text/csv;charset=utf-8'}),r.filename);savedName('area',r.filename);
   $('exportStatus').textContent=`Download ready · ${r.filename} · mm²${r.candidates!==null?' · with candidate density':''}`;
  }catch(e){$('exportStatus').textContent='Failed · '+e.message;error(e.message);}
  finally{job.end();exportBusy=false;status();}
 }
 for(const id of ['exportFilename','leafBase','stemTop','stemDegree','medianWindow','medianBits','peakWindow','borderStepMm','heightCutoffEnabled','heightCutoffMm','inwardMarginMm','exportQuality'])$(id).addEventListener('input',()=>{exportGeneration++;if(!exportBusy)$('exportStatus').textContent='';});
 let borders=null,borderBusy=false,borderFailure='',borderGeneration=0;
 let connections=null,connectionBusy=false,connectionFailure='',connectionGeneration=0;
 let stem=null,residual=null,peaks=null,points=new Int32Array(),busy='',failure='',stemGeneration=0,detectionGeneration=0;
 const mergeCurrent=()=>{const g=get();return g.merged&&g.mergeRevision===g.revision&&!g.merging;};
 const baseCurrent=r=>!!(r&&mergeCurrent()&&r.merge_key===get().merged.key&&r.revision===get().revision);
 // Hand-drawn slice stems are inputs of the combined stem: any change makes it stale.
 // Only slices in the current merge count (the server rejects others).
 const mergedHand=()=>{const g=get(),paths=new Set((g.merged?.sources||[]).map(x=>x.path));return Object.fromEntries(Object.entries(g.hand||{}).filter(([p])=>paths.has(p)));};
 const handKey=h=>JSON.stringify(Object.entries(h||{}).sort());
 const stemCurrent=()=>baseCurrent(stem)&&stem.parameters.top===value('stemTop')&&stem.parameters.degree===value('stemDegree')&&handKey(stem.parameters.hand)===handKey(mergedHand());
 const residualCurrent=()=>baseCurrent(residual)&&residual.parameters.window===value('medianWindow')&&residual.parameters.bits===value('medianBits');
 const peaksCurrent=()=>baseCurrent(peaks)&&residualCurrent()&&peaks.parameters.residual_key===residual.key&&peaks.parameters.window===value('peakWindow');
 const connectionsCurrent=()=>!!(connections&&stemCurrent()&&peaksCurrent()&&connections.stem_key===stem.key&&connections.peaks_key===peaks.key);
 const endsCurrent=()=>!!(connections&&stemCurrent()&&connections.stem_key===stem.key);
 const bordersCurrent=()=>!!(borders&&stemCurrent()&&borders.stem_key===stem.key&&borders.revision===get().revision&&borders.step_mm===value('borderStepMm')&&Object.entries(borderOptions()).every(([k,v])=>borders[k]===v));
 const valid=ids=>ids.every(id=>$(id).value!==''&&$(id).validity.valid);
 function status(){
  const m=mergeCurrent(),s=stemCurrent(),r=residualCurrent(),p=peaksCurrent(),g=get();
  $('mergedEditControls').hidden=!$('editMergedCurve').checked;
  $('editMergedCurve').disabled=!s||curveBusy||!!busy;
  $('resetMergedCurve').disabled=!s||!stem.fit.manual||curveBusy||!!busy;
  $('undoMergedCurve').disabled=!s||!curvePast.length||curveBusy||!!busy;
  $('redoMergedCurve').disabled=!s||!curveFuture.length||curveBusy||!!busy;
  $('previewPlot').disabled=!exportReady('borders')&&!exportReady('trichomes');
  outlineStatus();areaStatus();
  $('heightCutoffMm').disabled=!$('heightCutoffEnabled').checked;
  for(const suffix of ['minus','plus'])$('heightCutoffMm-'+suffix).disabled=$('heightCutoffMm').disabled;
  plot.sync();
  {const [ready,why,suffix='']=exportChoice(),k=exportKind(),button=$('downloadExport');button.disabled=exportBusy||!ready;
   if(!exportBusy)button.textContent='Download'+(ready?suffix:'');button.title=exportHelp[k];
   $('exportContext').textContent=k==='trichomes'||k==='borders'?`mm · base ${$('leafBase').value.toUpperCase()} · left + / right −`:k==='heightmap'?'32-bit float TIFF · heights mm · NaN = no data':k==='area'?'mm²':'global mm · x right, y down';
   $('exportPrerequisites').textContent=ready?'':why;}
  $('computeBorders').disabled=borderBusy||curveBusy||outlinePending()||!!curveGesture||!s||!valid(['borderStepMm','inwardMarginMm',...($('heightCutoffEnabled').checked?['heightCutoffMm']:[])]);
  $('computeBorders').textContent=borderBusy?'Computing borders…':'Compute leaf borders';
  $('showBorders').disabled=!bordersCurrent();
  $('borderStatus').textContent=borderBusy?'Sampling normal cross-sections…':borderFailure?'Failed · '+borderFailure:!s?'Fit current merged stem first.':bordersCurrent()?`${borders.valid_count} / ${borders.count} sections · ${borders.step_mm} mm step · base ${$('leafBase').value.toUpperCase()}`:borders?'Stale · compute borders again.':'Ready · prepared foreground boundary.';
  for(const id of ['guideMedian','guideDetection']){$(id).disabled=!m;setHelp($(id),m?'':'Merge first to establish native spacing.');}
  $('computeStem').disabled=!!busy||curveBusy||!m||!valid(['stemTop','stemDegree']);
  $('computeCandidates').disabled=!!busy||!m||!s||!valid(['medianWindow','medianBits','peakWindow']);
  $('computeStem').textContent=busy==='stem'?'Fitting merged stem…':'Fit merged stem';
  $('computeCandidates').textContent=busy==='residual'?'Computing median…':busy==='peaks'?'Finding central maxima…':'Compute candidates';
  $('stemStatus').textContent=curveBusy?'Validating manual curve…':busy==='stem'?'Selecting raw top % independently in each prepared slice…':failure.startsWith('stem:')?'Failed · '+failure.slice(5):!m?'Merge first (step 5).':s?`${stem.fit.manual?'Manual':'Automatic'} · ${stem.fit.selected_pixels.toLocaleString()} observations · per slice ${stem.fit.sources.map(s=>s.selected_pixels.toLocaleString()+(s.hand?' (hand-drawn)':'')).join(' / ')} · ${stem.segments} sections${stem.fit.clipped?' · requested ends outside tissue; geometry clipped':''}`:stem?'Stale · fit merged stem again.':(Object.keys(mergedHand()).length?'One curve from the top % of each prepared slice; hand-drawn slices use their line.':'One curve from the top % of EACH prepared slice.');
  $('stemStatus').title=s?stem.fit.sources.map((v,i)=>`Slice ${i+1}: `+(v.hand?`hand-drawn line, ${v.hand_points} points, sampled at ${v.selected_pixels} equally spaced observations (the slice's Top % count)`:`${v.selected_pixels} / ${v.valid_pixels} (${v.selected_percent.toFixed(3)}%), raw cutoff ${v.cutoff_mm.toPrecision(7)} mm`)).join('\n'):'';
  $('candidateStatus').textContent=busy==='residual'?'Median background, then centered maxima…':busy==='peaks'?'Finding centered maxima…':failure.startsWith('detection:')?'Failed · '+failure.slice(10):!m?'Merge first (step 5).':p?`Current · ${peaks.count.toLocaleString()} candidates · ${residual.quantization.bits}-bit median (bin ${residual.quantization.bin_width_mm.toPrecision(3)} mm)` :!s?'Fit current merged stem first.':peaks?'Stale candidates · '+(r?'median retained; compute peaks again.':'compute median and peaks again.'):'Ready · median subtraction then centered maximum.';
  $('windowHint').textContent='';$('windowHint').title=m?`Native grid: median ${(value('medianWindow')*g.merged.spacing_mm[0]).toFixed(3)} mm; detection ${(value('peakWindow')*g.merged.spacing_mm[0]).toFixed(3)} mm. Edge exclusion radius ${(value('medianWindow')-1)/2+(value('peakWindow')-1)/2} px.`:'';
  if(!r)diagnosticPreview='';
  for(const [id,mode] of [['previewMedian','median'],['previewResidual','residual']]){
   $(id).disabled=!r;$(id).checked=diagnosticPreview===mode;
   setHelp($(id),r?'':'Compute candidates with current median settings first. Unavailable after merge or median settings change.');
  }
  $('diagnosticStatus').textContent=diagnosticPreview?`Temporary preview: ${diagnosticPreview==='median'?'Median background':'Signed residual'} · turn off to restore ${g.mode==='photo'?'Photo':g.mode==='height'?'Heightmap':'Merged heightmap'}.`:'';
  $('showLines').disabled=!connectionsCurrent();$('leafBase').disabled=!endsCurrent();
  $('connectionStatus').textContent=connectionBusy?'Finding nearest stem points…':connectionFailure?'Connections unavailable · '+connectionFailure:'';
  setHelp($('showLines'),connectionsCurrent()?'':'Fit a current stem and compute current candidates first.');
  setHelp($('leafBase'),endsCurrent()?'':'Fit the current combined stem first.');
  $('showStem').disabled=!s;$('showTop').disabled=!s;$('showCandidates').disabled=!p;
  for(const id of ['showStem','showTop'])setHelp($(id),s?'':'Fit the current merged stem in step 6 to enable this overlay.');
  setHelp($('showCandidates'),p?'':'Compute current candidates in step 7 to enable this overlay.');
 }
 async function connect(){
  if(!stemCurrent())return;
  const generation=++connectionGeneration,sg=stemGeneration,dg=detectionGeneration,revision=get().revision,sk=stem.key,pk=peaksCurrent()?peaks.key:null;
  connectionBusy=true;connectionFailure='';status();const job=beginBusy('Finding nearest stem points',{hints:['connectionStatus']});
  try{const r=await api('/api/post/connections',{stem_key:sk,peaks_key:pk});
   if(generation===connectionGeneration&&sg===stemGeneration&&dg===detectionGeneration&&get().revision===revision&&stemCurrent()&&stem.key===sk&&(!pk||(peaksCurrent()&&peaks.key===pk)))connections=r;
  }catch(e){if(generation===connectionGeneration)connectionFailure=e.message;}
  finally{job.end();if(generation===connectionGeneration)connectionBusy=false;status();draw();}
 }
 async function assets(r){await Promise.all(Object.entries(r.assets).filter(([k])=>k!=='points').map(([,url])=>image(url)));return r;}
 async function fit(){
  if($('computeStem').disabled)return;
  const g=get(),revision=g.revision,generation=stemGeneration,key=g.merged.key;
  const hand=mergedHand(),payload={merge_key:key,top:value('stemTop'),degree:value('stemDegree'),...(Object.keys(hand).length?{hand}:{})};busy='stem';failure='';error();status();const job=beginBusy('Fitting merged stem',{buttons:['computeStem'],hints:['stemStatus']});
  try{const r=await assets(await api('/api/post/stem',payload));
   if(get().revision!==revision||get().merged?.key!==key||generation!==stemGeneration)throw Error('Discarded: setup or stem settings changed. Fit again.');
   if(stem&&stem.revision===revision){curvePast.push(stem);curveFuture=[];}else{curvePast=[];curveFuture=[];}stem={...r,revision};automaticStem=stem;automaticStems.set(stem.key,stem);stemGeneration++;diagnosticPreview='';$('mode').value='merged';await connect();
  }catch(e){failure='stem:'+e.message;error(e.message);}finally{job.end();busy='';status();draw();}
 }
 async function detect(){
  if($('computeCandidates').disabled)return;
  const g=get(),revision=g.revision,generation=detectionGeneration,key=g.merged.key;
  const unchanged=()=>get().revision===revision&&get().merged?.key===key&&generation===detectionGeneration;
  const window=value('peakWindow'),median=value('medianWindow'),bits=value('medianBits');failure='';error();
  const steps=residualCurrent()?1:2,job=beginBusy('Computing candidates',{total:steps,buttons:['computeCandidates'],hints:['candidateStatus']});
  try{
   if(!residualCurrent()){
    job.set({phase:'median'});busy='residual';status();const r=await assets(await api('/api/post/residual',{merge_key:key,window:median,bits}));
    if(!unchanged())throw Error('Discarded: setup or detection settings changed. Compute again.');
    residual={...r,revision};job.tick();
   }
   job.set({phase:'maxima'});busy='peaks';status();const r=await api('/api/post/peaks',{merge_key:key,residual_key:residual.key,window});
   const response=await fetch(r.assets.points);if(!response.ok)throw Error('Could not read candidate coordinates');
   const xy=new Int32Array(await response.arrayBuffer());if(xy.length!==r.count*2)throw Error('Candidate coordinate count mismatch');
   if(!unchanged())throw Error('Discarded: setup or detection settings changed. Compute again.');
   peaks={...r,revision};points=xy;job.tick();diagnosticPreview='';$('mode').value='merged';await connect();
  }catch(e){failure='detection:'+e.message;error(e.message);}finally{job.end();busy='';status();draw();}
 }
 async function computeBorders(){
  if($('computeBorders').disabled)return;
  const generation=++borderGeneration,sg=stemGeneration,revision=get().revision,sk=stem.key,step=value('borderStepMm'),options=borderOptions();
  borderBusy=true;borderFailure='';status();const job=beginBusy('Computing leaf borders',{buttons:['computeBorders'],hints:['borderStatus']});
  try{const r=await api('/api/post/borders',{stem_key:sk,step_mm:step,...options});
   if(generation!==borderGeneration||sg!==stemGeneration||revision!==get().revision||!stemCurrent()||stem.key!==sk||step!==value('borderStepMm'))throw Error('Discarded: stem, merge or sampling changed. Compute again.');
   borders={...r,revision};
  }catch(e){borderFailure=e.message;error(e.message);}finally{job.end();borderBusy=false;status();draw();}
 }
 $('computeBorders').onclick=computeBorders;
 for(const id of ['borderStepMm','heightCutoffEnabled','heightCutoffMm','inwardMarginMm'])$(id).oninput=()=>{borderGeneration++;borderFailure='';status();draw();};
 for(const id of ['guideMedian','guideDetection','showBorders'])$(id).oninput=()=>{status();draw();};
 for(const id of ['stemTop','stemDegree'])$(id).oninput=()=>{stemGeneration++;failure='';status();draw();};
 for(const id of ['medianWindow','medianBits','peakWindow'])$(id).oninput=()=>{detectionGeneration++;failure='';status();draw();};
 for(const id of ['showStem','showTop','showCandidates','markerSize','showLines','leafBase'])$(id).oninput=()=>{status();draw();};
 for(const [id,mode] of [['previewMedian','median'],['previewResidual','residual']])$(id).onchange=()=>{diagnosticPreview=$(id).checked&&residualCurrent()?mode:'';status();draw();};
 $('computeStem').onclick=fit;$('computeCandidates').onclick=detect;
 function paint(ctx,ratio,camera){
  status();const m=get().merged,r=m.spacing_mm[0],o=m.origin_center_mm,sc=ratio*camera.scale;
  ctx.setTransform(sc,0,0,sc,ratio*camera.x,ratio*camera.y);
  const mode=diagnosticPreview||'height',source=mode==='height'?m:residual;
  const offset=source.offset_xy||[0,0],url=mode==='height'?m.asset:source.assets[mode];
  ctx.drawImage(images.get(url),o[0]+(offset[0]-.5)*r,o[1]+(offset[1]-.5)*r,source.dimensions[0]*r,source.dimensions[1]*r);
  paintOverlays(ctx,ratio,camera);
  const limits=mode==='height'?m.height_range_mm:source[mode+'_range_mm'];
  $('heightLegend').textContent=` · ${diagnosticPreview?'TEMPORARY PREVIEW · ':''}${mergeCurrent()?'':'STALE '}${mode==='residual'?'Height − median':mode} ${limits.map(v=>v.toFixed(5)).join(' … ')} mm · black → white${peaksCurrent()?' · '+peaks.count.toLocaleString()+' candidates':''}`;
 }
 function paintOverlays(ctx,ratio,camera){
  if(!mergeCurrent())return;
  const m=get().merged,r=m.spacing_mm[0],o=m.origin_center_mm,sc=ratio*camera.scale;
  ctx.setTransform(sc,0,0,sc,ratio*camera.x,ratio*camera.y);
  if(stemCurrent()&&$('showTop').checked){ctx.imageSmoothingEnabled=false;ctx.drawImage(images.get(stem.assets.top),o[0]-r/2,o[1]-r/2,m.dimensions[0]*r,m.dimensions[1]*r);ctx.imageSmoothingEnabled=true;}
  ctx.setTransform(ratio,0,0,ratio,0,0);
  const screen=p=>[camera.x+(o[0]+p[0]*r)*camera.scale,camera.y+(o[1]+p[1]*r)*camera.scale];
  if(stemCurrent()&&($('showStem').checked||$('editMergedCurve').checked))paintCurve(ctx,stem,screen,{preview:curveGesture?.handles});
  paintGuides(ctx,camera,m);
  if(bordersCurrent()&&$('showBorders').checked){
   const reverse=$('leafBase').value==='b';
   for(const [side,color,dash] of [['left','#61e5dc',[]],['right','#ffc56b',[]]]){
    const source=reverse?(side==='left'?'right':'left'):side;
    const data=borders[source+'_world_mm'];
    for(const [ink,width] of [['#111',3],[color,1.5]]){ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();let started=false;
     for(const [i,p] of data.entries()){if(borders.break_before[i])started=false;if(!p){started=false;continue;}const x=camera.x+p[0]*camera.scale,y=camera.y+p[1]*camera.scale;if(started)ctx.lineTo(x,y);else ctx.moveTo(x,y);started=true;}ctx.stroke();}
   }ctx.setLineDash([]);
  }
  paintOutline(ctx,camera);
  if(connectionsCurrent()&&$('showLines').checked){
   const targets=connections['targets_'+$('leafBase').value];
   ctx.strokeStyle='rgba(220,240,245,0.48)';ctx.lineWidth=.65;ctx.beginPath();
   for(let i=0;i<targets.length;i++){ctx.moveTo(...screen([points[2*i],points[2*i+1]]));ctx.lineTo(...screen(targets[i]));}ctx.stroke();
  }
  if(peaksCurrent()&&$('showCandidates').checked){
   ctx.strokeStyle='#ff0088';ctx.lineWidth=1;ctx.beginPath();const size=Math.min(8,Math.max(1,value('markerSize')||2));
   for(let i=0;i<points.length;i+=2){const x=camera.x+(o[0]+points[i]*r)*camera.scale,y=camera.y+(o[1]+points[i+1]*r)*camera.scale;if(x<0||y<0||x>ctx.canvas.width/ratio||y>ctx.canvas.height/ratio)continue;ctx.moveTo(x+size,y);ctx.arc(x,y,size,0,Math.PI*2);}ctx.stroke();
  }
  if(peaksCurrent()&&selectedCandidate!==null){const i=selectedCandidate-1;if(i>=0&&i<points.length/2){ctx.strokeStyle='#fff';ctx.lineWidth=2;const q=screen([points[2*i],points[2*i+1]]);ctx.beginPath();ctx.arc(...q,8,0,2*Math.PI);ctx.stroke();ctx.fillStyle='#fff';ctx.fillText('#'+selectedCandidate,q[0]+10,q[1]-10);}}
  if(endsCurrent()&&!$('editMergedCurve').checked&&($('showStem').checked||$('showLines').checked)){
   for(const [i,p] of connections.ends.entries()){
    const [x,y]=screen(p),base=$('leafBase').value===(i?'b':'a');
    ctx.fillStyle=base?'#00ffc8':'#fff';ctx.strokeStyle='#000';ctx.lineWidth=2;ctx.beginPath();ctx.rect(x-4,y-4,8,8);ctx.fill();ctx.stroke();
    const label=(i?'B':'A')+(base?' · Leaf base':'');ctx.font='bold 12px system-ui';ctx.lineWidth=3;ctx.strokeText(label,x+8,y-18);ctx.fillText(label,x+8,y-18);
   }
  }
  // Editing affordances are last: dense candidate rings must not bury handles.
  if(stemCurrent()&&$('editMergedCurve').checked)paintHandles(ctx,curveGesture?.handles||handlesFor(stem),screen);
 }
 function paintGuides(ctx,camera,m){
  const r=m.spacing_mm[0],o=m.origin_center_mm;
  const maxWidth=Math.max(value('medianWindow')||1,value('peakWindow')||1)*r;
  if(guideMerge!==m.key){guideOffset=null;guideMerge=m.key;}
  const a=endsCurrent()?connections.ends[0].map((v,k)=>o[k]+v*r):o;
  if(!guideOffset)guideOffset=[maxWidth/2+24/camera.scale,-maxWidth/2-24/camera.scale];
  const anchor=a.map((v,k)=>v+guideOffset[k]);
  guideScreen=anchor.map((v,k)=>v*camera.scale+(k?camera.y:camera.x));guideRadius=Math.max(13,maxWidth*camera.scale/2);
  let labelRow=0;
  for(const [toggle,input,name,color,dash] of [['guideMedian','medianWindow','Median','#61e5dc',[]],['guideDetection','peakWindow','Detection','#ffc56b',[4,3]]]){
   if(!$(toggle).checked||!valid([input]))continue;
   const n=value(input),size=n*r*camera.scale,x=camera.x+anchor[0]*camera.scale,y=camera.y+anchor[1]*camera.scale;
   for(const [ink,width] of [['#000',3],[color,1]]){ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.strokeRect(x-size/2,y-size/2,size,size);}
   ctx.setLineDash([]);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x-3,y);ctx.lineTo(x+3,y);ctx.moveTo(x,y-3);ctx.lineTo(x,y+3);ctx.stroke();
   ctx.font='11px system-ui';ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.fillStyle=color;
   const label=`${name} ${n} px · ${(n*r).toFixed(3)} mm`,lx=x+maxWidth*camera.scale/2+6,ly=y+labelRow*15;
   ctx.strokeText(label,lx,ly);ctx.fillText(label,lx,ly);labelRow++;
  }
 }
 function directedBorders(){
  if(!bordersCurrent())return null;
  const reverse=$('leafBase').value==='b',order=a=>reverse?[...a].reverse():a;
  const left=reverse?'right':'left',right=reverse?'left':'right',signed=a=>order(a).map(v=>v===null?null:reverse?-v:v);
  return {base:$('leafBase').value,arclength_mm:order(borders.arclength_mm).map(s=>reverse?borders.length_mm-s:s),left_world_mm:order(borders[left+'_world_mm']),right_world_mm:order(borders[right+'_world_mm']),left_signed_mm:signed(borders[left+'_signed_mm']),right_signed_mm:signed(borders[right+'_signed_mm'])};
 }
 const plot=floatingPlot({getState:()=>{const payload=kind=>{const p=exportPayload(kind);delete p.filename;delete p.quality;return p;};return {revision:get().revision,base:$('leafBase').value,borders:exportReady('borders')?payload('borders'):null,candidates:exportReady('trichomes')?payload('trichomes'):null};},api,onSelect:id=>{selectedCandidate=id;draw();}});
 $('previewPlot').onclick=()=>plot.open();
 $('resetGuides').onclick=()=>{guideOffset=null;draw();};
 $('editMergedCurve').onchange=()=>{$('mergedEditControls').hidden=!$('editMergedCurve').checked;$('resetSliceCurve').hidden=true;if($('editMergedCurve').checked){$('editSliceCurve').checked=false;$('redrawOutline').checked=false;$('showStem').checked=true;}status();draw();};
 function changeStem(r){stem=r;$('stemTop').value=r.parameters.top;$('stemDegree').value=r.parameters.degree;automaticStem=automaticStems.get(r.automatic_key||r.key)||automaticStem;stemGeneration++;exportGeneration++;connectionGeneration++;borderGeneration++;failure='';status();draw();connect();}
 $('resetMergedCurve').onclick=()=>{if(!automaticStem||!stemCurrent())return;curvePast.push(stem);curveFuture=[];changeStem(automaticStem);};
 $('undoMergedCurve').onclick=()=>{if(!curvePast.length||curveBusy)return;curveFuture.push(stem);changeStem(curvePast.pop());};
 $('redoMergedCurve').onclick=()=>{if(!curveFuture.length||curveBusy)return;curvePast.push(stem);changeStem(curveFuture.pop());};
 const pointerScreen=e=>{const b=$('canvas').getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];};
 function pointerDown(e,camera){
  if(curveBusy||!mergeCurrent())return false;const p=pointerScreen(e),m=get().merged,r=m.spacing_mm[0],o=m.origin_center_mm;
  if(outlineDown(e,camera,p))return true;
  if($('editMergedCurve').checked&&stemCurrent()&&!busy){const h=handlesFor(stem),screen=q=>q.map((v,k)=>(o[k]+v*r)*camera.scale+(k?camera.y:camera.x)),index=hitHandle(h,screen,p);if(index>=0){curveGesture={id:e.pointerId,handles:structuredClone(h),start:p,index,original:stem,generation:stemGeneration,revision:get().revision,moved:false};$('canvas').setPointerCapture(e.pointerId);status();return true;}}
  if(guideScreen&&($('guideMedian').checked||$('guideDetection').checked)&&Math.abs(p[0]-guideScreen[0])<=guideRadius&&Math.abs(p[1]-guideScreen[1])<=guideRadius){guideGesture={id:e.pointerId,start:p,offset:[...guideOffset]};$('canvas').setPointerCapture(e.pointerId);return true;}return false;
 }
 function pointerMove(e,camera){const p=pointerScreen(e);if(outlineGesture){if(e.pointerId===outlineGesture.id){outlineGesture.points.push(...outlineGesture.native(p));draw();}return true;}if(curveGesture){const g=curveGesture;if(e.pointerId!==g.id)return true;const r=get().merged.spacing_mm[0];g.handles[g.index]=handlesFor(g.original)[g.index].map((v,k)=>v+(p[k]-g.start[k])/(r*camera.scale));g.moved=true;draw();return true;}if(guideGesture){guideOffset=guideGesture.offset.map((v,k)=>v+(p[k]-guideGesture.start[k])/camera.scale);draw();return true;}return false;}
 async function commitCurve(g){if(!g.moved){status();draw();return;}curveBusy=true;status();const job=beginBusy('Checking edited curve',{hints:['stemStatus']});try{const r=await api('/api/curve/edit',{kind:'stem',key:g.original.key,handles:g.handles});if(g.revision!==get().revision||g.generation!==stemGeneration||!stemCurrent())throw Error('Manual curve discarded: scientific inputs changed.');curvePast.push(stem);curveFuture=[];changeStem({...r,revision:g.revision});error();}catch(e){failure='stem:'+e.message;error(e.message);}finally{job.end();curveBusy=false;status();draw();}}
 function pointerUp(e){if(outlineGesture){if($('canvas').hasPointerCapture(e.pointerId))$('canvas').releasePointerCapture(e.pointerId);outlineUp();return true;}if(curveGesture){const g=curveGesture;curveGesture=null;if($('canvas').hasPointerCapture(e.pointerId))$('canvas').releasePointerCapture(e.pointerId);commitCurve(g);return true;}if(guideGesture){guideGesture=null;if($('canvas').hasPointerCapture(e.pointerId))$('canvas').releasePointerCapture(e.pointerId);return true;}return false;}
 function pointerCancel(){let changed=false;if(outlineGesture){outlineGesture=null;changed=true;}if(curveGesture){curveGesture=null;changed=true;}if(guideGesture){guideOffset=guideGesture.offset;guideGesture=null;changed=true;}if(changed){status();draw();}}
 // Saved session (session.mjs): settings, outline edits, which stages were current, combined-curve handles and headline numbers.
 const SETTINGS=['stemTop','stemDegree','medianWindow','peakWindow','medianBits','borderStepMm','heightCutoffMm','inwardMarginMm','markerSize'],CHECKS=['heightCutoffEnabled','exportQuality','showStem','showTop','showCandidates','showLines','showBorders','showOutline'],TEXTS=['leafBase','exportKind'];
 function sessionData(){
  const s=stemCurrent(),p=peaksCurrent(),b=bordersCurrent(),e=mergeCurrent()?outlineState():noEdits();
  return {settings:{...Object.fromEntries(SETTINGS.map(id=>[id,value(id)])),...Object.fromEntries(CHECKS.map(id=>[id,$(id).checked])),...Object.fromEntries(TEXTS.map(id=>[id,$(id).value])),exportNames:{...exportNames}},
   outline:{smoothing_mm:e.sigmaMm,strokes:structuredClone(e.strokes)},
   computed:{stem:!!s,stemHandles:s&&stem.fit.manual?stem.fit.handles:null,candidates:!!p,borders:!!b}};
 }
 function sessionResults(){
  const a=areaCurrent()?leafArea:null,s=stemCurrent(),p=peaksCurrent(),b=bordersCurrent();
  return {leaf_area:a?{flat_mm2:a.flat_mm2,surface_mm2:a.surface_mm2,outline_edited:!!a.outline_key}:null,
   stem:s?{selected_pixels:stem.fit.selected_pixels,coefficients:stem.fit.coefficients,manual:!!stem.fit.manual,segments:stem.segments}:null,
   candidates:p?{count:peaks.count}:null,borders:b?{count:borders.count,valid_count:borders.valid_count,length_mm:borders.length_mm}:null};
 }
 const until=async(test,ms=600000)=>{const t=Date.now();while(!test()){if(Date.now()-t>ms)throw Error('Timed out waiting for the result');await new Promise(r=>setTimeout(r,100));}};
 function applySettings(settings={}){
  for(const id of SETTINGS)if(Number.isFinite(settings[id]))$(id).value=settings[id];
  for(const id of CHECKS)if(typeof settings[id]==='boolean')$(id).checked=settings[id];
  for(const id of TEXTS)if(typeof settings[id]==='string'&&[...$(id).options].some(o=>o.value===settings[id]))$(id).value=settings[id];
  for(const [k,v] of Object.entries(settings.exportNames||{}))if(k in exportNames&&typeof v==='string'&&v)exportNames[k]=v;
  $('exportFilename').value=exportNames[exportKind()];
  stemGeneration++;detectionGeneration++;borderGeneration++;exportGeneration++;status();draw();
 }
 // Recompute what was current when saved, in order: outline edits, leaf area, stem, edited stem, candidates, borders.
 async function restore(saved,job){
  const c=saved?.computed||{},o=saved?.outline;
  if(!mergeCurrent())return;
  if(o&&(o.smoothing_mm>0||o.strokes?.length)){
   job?.set({phase:'leaf outline'});status();await until(()=>outlineReady()||!!outlineFailure);if(outlineFailure)throw Error('Leaf outline failed: '+outlineFailure);
   const e=outlineState();e.sigmaMm=Number(o.smoothing_mm)||0;e.strokes=structuredClone(o.strokes||[]);e.past=[];e.future=[];syncOutlineInputs();exportGeneration++;borderGeneration++;scheduleRegister();
   await until(()=>!!outlineKey()||!!outlineFailure);if(outlineFailure)throw Error('Edited outline could not be restored: '+outlineFailure);
  }
  job?.set({phase:'leaf area'});status();await until(()=>areaCurrent()||!!areaFailure);if(areaFailure)throw Error('Leaf area failed: '+areaFailure);
  if(!c.stem)return;
  job?.set({phase:'combined stem'});await fit();if(!stemCurrent())throw Error('Combined stem failed: '+(failure.replace(/^stem:/,'')||'unknown error'));
  if(c.stemHandles){job?.set({phase:'edited combined curve'});await commitCurve({moved:true,original:stem,handles:c.stemHandles,revision:get().revision,generation:stemGeneration});if(!stemCurrent()||!stem.fit.manual)throw Error('Edited combined curve could not be restored: '+failure.replace(/^stem:/,''));}
  if(c.candidates){job?.set({phase:'candidates'});await detect();if(!peaksCurrent())throw Error('Candidates failed: '+failure.replace(/^detection:/,''));}
  if(c.borders){job?.set({phase:'leaf borders'});await computeBorders();if(!bordersCurrent())throw Error('Leaf borders failed: '+borderFailure);}
  await until(()=>!connectionBusy);
 }
 return {sessionData,sessionResults,applySettings,restore,status,paint,paintOverlays,pointerDown,pointerMove,pointerUp,pointerCancel,preview:()=>{if(!residualCurrent())diagnosticPreview='';return diagnosticPreview;},clearPreview:()=>{diagnosticPreview='';},debug:()=>({outline:{ready:outlineReady(),edited:edited(),key:outlineKey(),pending:outlinePending(),busy:outlineBusy,failure:outlineFailure,state:outlineState(),originalRings:outlineOriginal?.rings.length,originalPoints:outlineOriginal?.rings.reduce((n,a)=>n+a.length/2,0),editedPoints:editedRings()?.reduce((n,a)=>n+a.length/2,0),stats:outlineStats.get(outlineKey())||null,rings:()=>editedRings()?.map(a=>Array.from(a))},leafArea:areaCurrent()?leafArea:null,areaBusy,areaFailure,editHandles:stemCurrent()?handlesFor(stem):null,curveBusy,curveUndo:curvePast.length,curveRedo:curveFuture.length,guideScreen,guideOffset,selectedCandidate,borderCoordinates:directedBorders(),borders,bordersCurrent:bordersCurrent(),diagnosticPreview,stem,residual,peaks,busy,connections,connectionBusy,connectionsCurrent:connectionsCurrent(),leafBase:$('leafBase').value,stemCurrent:!!stemCurrent(),residualCurrent:!!residualCurrent(),peaksCurrent:!!peaksCurrent(),pointCount:points.length/2})};
}
