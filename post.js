import {handlesFor,paintCurve,paintHandles,hitHandle} from './curve_edit.mjs';
import {floatingPlot} from './plot.mjs';
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
 const borderOptions=()=>({height_cutoff_enabled:$('heightCutoffEnabled').checked,height_cutoff_mm:value('heightCutoffMm'),inward_margin_mm:value('inwardMarginMm')});
 const exportReady=kind=>!busy&&!curveBusy&&!curveGesture&&!borderBusy&&stemCurrent()&&(kind==='borders'?bordersCurrent():peaksCurrent());
 const exportPayload=kind=>({kind,quality:$('exportQuality').checked,filename:$('filename'+(kind==='borders'?'Borders':'Trichomes')).value,base:$('leafBase').value,merge_key:get().merged?.key,stem_key:stem?.key,stem_parameters:stem?.parameters,...(kind==='borders'?{border_key:borders?.key,step_mm:value('borderStepMm'),...borderOptions()}:{peaks_key:peaks?.key,residual_key:residual?.key,residual_parameters:residual?.parameters,window:value('peakWindow')})});
 async function download(kind){
  if(exportBusy||!exportReady(kind))return;
  const revision=get().revision,generation=exportGeneration,payload=exportPayload(kind),signature=JSON.stringify(payload);
  exportBusy=true;error();$('exportStatus').textContent='Preparing CSV…';status();const job=beginBusy('Preparing '+kind+' CSV',{buttons:['download'+(kind==='borders'?'Borders':'Trichomes')],hints:['exportStatus']});
  try{
   const result=await api('/api/export',payload);
   if(revision!==get().revision||generation!==exportGeneration||!exportReady(kind)||signature!==JSON.stringify(exportPayload(kind)))throw Error('Discarded: export settings or scientific inputs changed. Download again.');
   const expected=kind==='borders'?borders.count:peaks.count;if(result.count!==expected)throw Error('Export row count mismatch');
   const blob=new Blob([result.csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=result.filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   $('filename'+(kind==='borders'?'Borders':'Trichomes')).value=result.filename;
   $('exportStatus').textContent=`Download ready · ${result.filename} · ${result.count.toLocaleString()} rows · base ${result.base.toUpperCase()}`;
  }catch(e){$('exportStatus').textContent='Failed · '+e.message;error(e.message);}
  finally{job.end();exportBusy=false;status();}
 }
 $('downloadBorders').onclick=()=>download('borders');$('downloadTrichomes').onclick=()=>download('trichomes');
 for(const id of ['filenameBorders','filenameTrichomes','leafBase','stemTop','stemDegree','medianWindow','medianBits','peakWindow','borderStepMm','heightCutoffEnabled','heightCutoffMm','inwardMarginMm','exportQuality'])$(id).addEventListener('input',()=>{exportGeneration++;if(!exportBusy)$('exportStatus').textContent='';});
 let borders=null,borderBusy=false,borderFailure='',borderGeneration=0;
 let connections=null,connectionBusy=false,connectionFailure='',connectionGeneration=0;
 let stem=null,residual=null,peaks=null,points=new Int32Array(),busy='',failure='',stemGeneration=0,detectionGeneration=0;
 const mergeCurrent=()=>{const g=get();return g.merged&&g.mergeRevision===g.revision&&!g.merging;};
 const baseCurrent=r=>!!(r&&mergeCurrent()&&r.merge_key===get().merged.key&&r.revision===get().revision);
 const stemCurrent=()=>baseCurrent(stem)&&stem.parameters.top===value('stemTop')&&stem.parameters.degree===value('stemDegree');
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
  $('heightCutoffMm').disabled=!$('heightCutoffEnabled').checked;
  for(const suffix of ['minus','plus'])$('heightCutoffMm-'+suffix).disabled=$('heightCutoffMm').disabled;
  plot.sync();
  for(const [kind,suffix] of [['borders','Borders'],['trichomes','Trichomes']]){
   const ready=exportReady(kind),button=$('download'+suffix);button.disabled=exportBusy||!ready;
   const count=kind==='borders'?borders?.count:peaks?.count;button.textContent=`Download ${kind}${ready?' · '+count.toLocaleString():''}`;
   button.title=ready?'CSV in millimetres, relative to selected Leaf base.':'Requires current '+(kind==='borders'?'stem and leaf borders.':'stem and candidates.');
  }
  $('exportContext').textContent=`mm · base ${$('leafBase').value.toUpperCase()} · left + / right −`;
  $('exportPrerequisites').textContent=!s?'Fit a current merged stem to export.':!bordersCurrent()&&!p?'Compute borders or candidates to export.':!bordersCurrent()?'Borders unavailable or stale · compute leaf borders.':!p?'Candidates unavailable or stale · compute candidates.':'';
  $('computeBorders').disabled=borderBusy||curveBusy||!!curveGesture||!s||!valid(['borderStepMm','inwardMarginMm',...($('heightCutoffEnabled').checked?['heightCutoffMm']:[])]);
  $('computeBorders').textContent=borderBusy?'Computing borders…':'Compute leaf borders';
  $('showBorders').disabled=!bordersCurrent();
  $('borderStatus').textContent=borderBusy?'Sampling normal cross-sections…':borderFailure?'Failed · '+borderFailure:!s?'Fit current merged stem first.':bordersCurrent()?`${borders.valid_count} / ${borders.count} sections · ${borders.step_mm} mm step · base ${$('leafBase').value.toUpperCase()}`:borders?'Stale · compute borders again.':'Ready · prepared foreground boundary.';
  for(const id of ['guideMedian','guideDetection']){$(id).disabled=!m;setHelp($(id),m?'':'Merge first to establish native spacing.');}
  $('computeStem').disabled=!!busy||curveBusy||!m||!valid(['stemTop','stemDegree']);
  $('computeCandidates').disabled=!!busy||!m||!s||!valid(['medianWindow','medianBits','peakWindow']);
  $('computeStem').textContent=busy==='stem'?'Fitting merged stem…':'Fit merged stem';
  $('computeCandidates').textContent=busy==='residual'?'Computing median…':busy==='peaks'?'Finding central maxima…':'Compute candidates';
  $('stemStatus').textContent=curveBusy?'Validating manual curve…':busy==='stem'?'Selecting raw top % independently in each prepared slice…':failure.startsWith('stem:')?'Failed · '+failure.slice(5):!m?'Merge first (step 5).':s?`${stem.fit.manual?'Manual':'Automatic'} · ${stem.fit.selected_pixels.toLocaleString()} observations · per slice ${stem.fit.sources.map(s=>s.selected_pixels.toLocaleString()).join(' / ')} · ${stem.segments} sections${stem.fit.clipped?' · requested ends outside tissue; geometry clipped':''}`:stem?'Stale · fit merged stem again.':'One curve from the top % of EACH prepared slice.';
  $('stemStatus').title=s?stem.fit.sources.map((v,i)=>`Slice ${i+1}: ${v.selected_pixels} / ${v.valid_pixels} (${v.selected_percent.toFixed(3)}%), raw cutoff ${v.cutoff_mm.toPrecision(7)} mm`).join('\n'):'';
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
  const payload={merge_key:key,top:value('stemTop'),degree:value('stemDegree')};busy='stem';failure='';error();status();const job=beginBusy('Fitting merged stem',{buttons:['computeStem'],hints:['stemStatus']});
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
 $('editMergedCurve').onchange=()=>{$('mergedEditControls').hidden=!$('editMergedCurve').checked;$('resetSliceCurve').hidden=true;if($('editMergedCurve').checked){$('editSliceCurve').checked=false;$('showStem').checked=true;}draw();};
 function changeStem(r){stem=r;$('stemTop').value=r.parameters.top;$('stemDegree').value=r.parameters.degree;automaticStem=automaticStems.get(r.automatic_key||r.key)||automaticStem;stemGeneration++;exportGeneration++;connectionGeneration++;borderGeneration++;failure='';status();draw();connect();}
 $('resetMergedCurve').onclick=()=>{if(!automaticStem||!stemCurrent())return;curvePast.push(stem);curveFuture=[];changeStem(automaticStem);};
 $('undoMergedCurve').onclick=()=>{if(!curvePast.length||curveBusy)return;curveFuture.push(stem);changeStem(curvePast.pop());};
 $('redoMergedCurve').onclick=()=>{if(!curveFuture.length||curveBusy)return;curvePast.push(stem);changeStem(curveFuture.pop());};
 const pointerScreen=e=>{const b=$('canvas').getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];};
 function pointerDown(e,camera){
  if(curveBusy||!mergeCurrent())return false;const p=pointerScreen(e),m=get().merged,r=m.spacing_mm[0],o=m.origin_center_mm;
  if($('editMergedCurve').checked&&stemCurrent()&&!busy){const h=handlesFor(stem),screen=q=>q.map((v,k)=>(o[k]+v*r)*camera.scale+(k?camera.y:camera.x)),index=hitHandle(h,screen,p);if(index>=0){curveGesture={id:e.pointerId,handles:structuredClone(h),start:p,index,original:stem,generation:stemGeneration,revision:get().revision,moved:false};$('canvas').setPointerCapture(e.pointerId);status();return true;}}
  if(guideScreen&&($('guideMedian').checked||$('guideDetection').checked)&&Math.abs(p[0]-guideScreen[0])<=guideRadius&&Math.abs(p[1]-guideScreen[1])<=guideRadius){guideGesture={id:e.pointerId,start:p,offset:[...guideOffset]};$('canvas').setPointerCapture(e.pointerId);return true;}return false;
 }
 function pointerMove(e,camera){const p=pointerScreen(e);if(curveGesture){const g=curveGesture;if(e.pointerId!==g.id)return true;const r=get().merged.spacing_mm[0];g.handles[g.index]=handlesFor(g.original)[g.index].map((v,k)=>v+(p[k]-g.start[k])/(r*camera.scale));g.moved=true;draw();return true;}if(guideGesture){guideOffset=guideGesture.offset.map((v,k)=>v+(p[k]-guideGesture.start[k])/camera.scale);draw();return true;}return false;}
 async function commitCurve(g){if(!g.moved){status();draw();return;}curveBusy=true;status();const job=beginBusy('Checking edited curve',{hints:['stemStatus']});try{const r=await api('/api/curve/edit',{kind:'stem',key:g.original.key,handles:g.handles});if(g.revision!==get().revision||g.generation!==stemGeneration||!stemCurrent())throw Error('Manual curve discarded: scientific inputs changed.');curvePast.push(stem);curveFuture=[];changeStem({...r,revision:g.revision});error();}catch(e){failure='stem:'+e.message;error(e.message);}finally{job.end();curveBusy=false;status();draw();}}
 function pointerUp(e){if(curveGesture){const g=curveGesture;curveGesture=null;if($('canvas').hasPointerCapture(e.pointerId))$('canvas').releasePointerCapture(e.pointerId);commitCurve(g);return true;}if(guideGesture){guideGesture=null;if($('canvas').hasPointerCapture(e.pointerId))$('canvas').releasePointerCapture(e.pointerId);return true;}return false;}
 function pointerCancel(){let changed=false;if(curveGesture){curveGesture=null;changed=true;}if(guideGesture){guideOffset=guideGesture.offset;guideGesture=null;changed=true;}if(changed){status();draw();}}
 return {status,paint,paintOverlays,pointerDown,pointerMove,pointerUp,pointerCancel,preview:()=>{if(!residualCurrent())diagnosticPreview='';return diagnosticPreview;},clearPreview:()=>{diagnosticPreview='';},debug:()=>({editHandles:stemCurrent()?handlesFor(stem):null,curveBusy,curveUndo:curvePast.length,curveRedo:curveFuture.length,guideScreen,guideOffset,selectedCandidate,borderCoordinates:directedBorders(),borders,bordersCurrent:bordersCurrent(),diagnosticPreview,stem,residual,peaks,busy,connections,connectionBusy,connectionsCurrent:connectionsCurrent(),leafBase:$('leafBase').value,stemCurrent:!!stemCurrent(),residualCurrent:!!residualCurrent(),peaksCurrent:!!peaksCurrent(),pointCount:points.length/2})};
}
