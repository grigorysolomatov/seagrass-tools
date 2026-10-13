import {Store,addSlices,arrange,reorder,orient,align,editJoint,effective,mul,add} from './model.mjs';
import {postMerge,installHelp,applyHelp,setHelp,beginBusy,busyJobs} from './post.js';
import {photoCompositor} from './blend.mjs';
import {handlesFor,paintCurve,paintHandles,hitHandle} from './curve_edit.mjs';
import {handResult,insideSlice,appendPoint,hitPoint,paintHand} from './hand_stem.mjs';
import {buildSession,parseSession,sessionState,compareResults,sessionFilename} from './session.mjs';
const photoBlend=photoCompositor();
window.photoBlendDebug=()=>photoBlend.debug();
const $=id=>document.getElementById(id),store=new Store(),canvas=$('canvas'),ctx=canvas.getContext('2d');
const images=new Map(),fits=new Map(),pendingFits=new Map(),maskedHeights=new Map(),masks=new Map(),pendingMasks=new Map();
let selected=null,loading=false,aligning=false,masking=false,preparing=0,previewTimer=null,dragId=null,selectedJoint=0,showSource=false;
let merging=false,merged=null,mergeRevision=-1,mergeError='';
let computingStems=false,curveBusy=false,sliceGesture=null,handGesture=null,sessionBusy=false;
// Per-slice job badges for steps 2-3; results stream into the workspace as each slice finishes.
const sliceJobs=new Map();let streamState=null,workerLimit=null;
let camera={scale:20,x:30,y:70},layers={highlight:false,curve:false};
const name=s=>s.path.split('/').pop(),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parameters=state=>({...state.background,enabled:true});
const fitKey=(s,state=store.state)=>JSON.stringify([s.id,effective(state,s).top,effective(state,s).degree,parameters(state)]);
const autoResult=s=>s.computedFitKey===fitKey(s)?(s.manualResult||fits.get(fitKey(s))):null;
// A hand-drawn stem (two or more points) replaces the automatic stem everywhere downstream.
const result=s=>handResult(s)||autoResult(s);
const stemKind=s=>handResult(s)?'hand-drawn stem':s.computedFitKey===fitKey(s)&&s.manualResult?'edited stem':autoResult(s)?'auto stem':'';
const handOn=()=>$('handSliceStem').checked&&$('mode').value!=='merged';
const stemsReady=()=>ready()&&store.state.slices.every(s=>result(s));
const maskKey=(s,state=store.state)=>JSON.stringify([s.id,parameters(state)]);
const maskResult=s=>store.state.background.enabled?masks.get(maskKey(s)):null;
const ready=()=>!!store.state.slices.length&&store.state.background.enabled&&store.state.slices.every(s=>maskResult(s));
// Display-only: slices already finished in a running step, before the whole step commits.
const liveMask=s=>ready()?maskResult(s):masking&&streamState?masks.get(maskKey(s,streamState))||null:null;
const liveResult=s=>{const r=ready()?result(s):null;if(!r&&handResult(s))return handResult(s);if(r||!computingStems||!streamState)return r;const key=fitKey(s,streamState);return key===fitKey(s)?fits.get(key)||null:null;};
async function workers(){if(workerLimit)return workerLimit;try{workerLimit=Math.max(1,Math.min(8,(await api('/api/health')).workers||1));}catch{workerLimit=1;}return workerLimit;}
// Run fn over slices with bounded concurrency; record queued/working/done/error per slice.
async function runSlices(kind,slices,fn){
 for(const s of slices)sliceJobs.set(s.id,{kind,state:'queued'});status();
 const queue=[...slices],failures=[],limit=await workers();
 await Promise.all(Array.from({length:Math.min(limit,queue.length)},async()=>{for(let s;(s=queue.shift());){sliceJobs.set(s.id,{kind,state:'working'});status();try{await fn(s);sliceJobs.set(s.id,{kind,state:'done'});}catch(e){sliceJobs.set(s.id,{kind,state:'error',message:e.message});failures.push(name(s)+': '+e.message);}status();draw();}}));
 return failures;
}
// Success badges clear when the step commits; failures stay on their card until retried.
function clearJobs(kind){for(const [id,j] of sliceJobs)if(j.kind===kind&&j.state!=='error')sliceJobs.delete(id);}
function jobCount(kind){const j=[...sliceJobs.values()].filter(j=>j.kind===kind);return `${j.filter(j=>j.state==='done'||j.state==='error').length}/${j.length}`;}
function jobBadge(id){const j=sliceJobs.get(id);if(!j)return '';const item=store.state.slices.find(s=>s.id===id);if(j.kind==='fit'&&j.state==='error'&&item&&handResult(item))return '';const what=j.kind==='mask'?'background':'stem';return j.state==='queued'?`<span class="sliceJob queued">waiting · ${what}</span>`:j.state==='working'?`<span class="sliceJob working"><i class="sliceSpin" aria-hidden="true"></i>${j.kind==='mask'?'removing background':'fitting stem'}</span>`:j.state==='done'?`<span class="sliceJob done">✓ ${what}</span>`:`<span class="sliceJob failed" title="${esc(j.message||'')}">✕ ${what} failed</span>`;}
const setupKey=(st=store.state)=>JSON.stringify([st.slices.map(s=>[fitKey(s,st),s.manualResult?.key,s.handStem?.points,s.reverse,s.angle,s.mirrorH,s.mirrorV]),st.shared.overlap]);
const stale=()=>store.state.aligned&&store.state.alignedSetup!==setupKey();
function error(s=''){$('error').textContent=s;}
async function api(path,data){const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),v=await r.json();if(!r.ok)throw Error(v.error||r.statusText);return v;}
async function image(url){if(images.has(url))return images.get(url);const im=new Image();im.src=url;await im.decode();images.set(url,im);return im;}
function status(){
 post.status();
 const s=store.state,ok=ready(),busy=loading||masking||aligning||computingStems||curveBusy||sessionBusy;
 const chosen=s.slices.find(s=>s.id===selected),current=chosen&&result(chosen);
 $('computeSliceStems').disabled=busy||!ok;
 $('computeSliceStems').textContent=computingStems?'Computing slice stems…':'Compute slice stems';$('computeSliceStems').classList.toggle('working',computingStems);
 $('sliceStemStatus').textContent=computingStems?'Each curve appears as it finishes.':chosen&&handResult(chosen)?`Slice ${s.slices.indexOf(chosen)+1}: hand-drawn stem · ${chosen.handStem.points.length} points · used by Align and the combined stem.`:!ok?'Remove background first.':!stemsReady()?'Compute automatic stems; placement stays unchanged.':current?.fit.clipped?'Manual handle outside tissue · displayed curve clipped to foreground.':current?.fit.manual?'Manual curve · placement unchanged until Align.':'Current automatic stems · optional handle editing.';
 $('editSliceCurve').disabled=busy||!current||current.hand||$('mode').value==='merged';if(current?.hand&&$('editSliceCurve').checked)$('editSliceCurve').checked=false;
 handStatus(chosen,busy);
 $('resetSliceCurve').hidden=!$('editSliceCurve').checked;
 $('resetSliceCurve').disabled=busy||!current?.fit.manual;
 const mergeStale=!!merged&&mergeRevision!==store.revision;
 $('merge').disabled=busy||merging||!ok||!s.aligned;
 $('merge').textContent=merging?'Merging raw heights…':merged?'Merge again':'Merge maximum heights';
 $('mode').querySelector('[value=merged]').disabled=!merged;
 $('mergeStatus').textContent=merging?'Computing raw foreground maximum… Edits will discard this run.':mergeError?'Merge failed · '+mergeError:mergeStale?'Stale · setup edited. Merge again; slices remain editable.':merged?`Current · ${merged.dimensions.join(' × ')} · ${merged.spacing_mm[0].toPrecision(4)} mm/pixel · max of raw heights`:!ok||!s.aligned?'Remove background and align first.':'Ready · max of raw foreground heights on one physical grid.';
 for(const card of $('slices').children){const item=s.slices[+card.dataset.index];if(item){card.querySelector('small').textContent=cardLabel(item);const badge=jobBadge(item.id),box=card.querySelector('.sliceJobBox');if(box&&box.dataset.html!==badge){box.dataset.html=badge;box.innerHTML=badge;}}}
 $('saveSession').disabled=busy||merging||sessionBusy||!s.slices.length;$('openSession').disabled=busy||merging||sessionBusy;
 $('saveSession').title=s.slices.length?'Download a small JSON file describing this work: scans (checked by size and SHA-256), order, orientation, mask and stem settings, hand-drawn and edited stems, alignment and joint corrections, outline edits and later settings. Open it later, or on another computer with the same scans, to continue.':'Load scans first.';
 $('undo').disabled=busy||(!store.past.length&&!store.pending);$('redo').disabled=busy||!store.future.length;
 $('add').disabled=busy;$('add').classList.toggle('accent',!s.slices.length);$('load').disabled=loading;
 $('align').disabled=busy||!stemsReady()||s.slices.length<2;
 $('align').textContent=aligning?'Aligning…':s.aligned?'Align again · reset refinements':'Align leaf ends';
 $('align').classList.toggle('accent',ok&&!s.aligned||stale());
 $('prepareBackground').disabled=busy||!s.slices.length||ok;
 $('prepareBackground').classList.toggle('working',masking);$('prepareBackground').textContent=masking?'Removing background…':ok?'Background removed ✓':'Remove background';
 $('prepareBackground').classList.toggle('accent',!ok&&!!s.slices.length);
 $('count').textContent=s.slices.length;$('loadStatus').textContent=loading?'Decoding photo + height data…':'';
 $('maskStatus').textContent=masking?'Each cut-out appears as it finishes.':!s.slices.length?'Load scans first.':ok?'Ready · Inspect the cut-out before Align.':s.background.enabled?'Mask settings changed. Remove background again; placement retained.':'Required before Align.';
 const noStems=!s.slices.some(x=>result(x))&&!computingStems;for(const k of ['curve','highlight']){$(k).disabled=!ok||noStems||$('mode').value==='merged';setHelp($(k),$('mode').value==='merged'?'Unavailable in merged view: switch to Photo or Heightmap.':!ok?'First remove background in step 2.':noStems?'Compute slice stems first; this shows their result.':'');}
 $('source').disabled=!ok||$('mode').value==='merged';$('source').checked=(!ok&&!masking)||showSource;
 setHelp($('source'),$('mode').value==='merged'?'Unavailable in merged view: switch to Photo or Heightmap.':ok?'':'Original background is shown until step 2 is complete.');
 $('alignmentStatus').textContent=!ok?'First remove background in step 2.':!stemsReady()?'Compute current slice stems in step 3.':s.slices.length<2?'Load at least two slices to join.':stale()?'Setup changed · placement retained. Align again when ready.':s.aligned?'Aligned · refine the selected joint.':'Inspect stems, then Align.';
 $('empty').hidden=!!s.slices.length;
 $('status').textContent=merging?'Merging raw foreground heights…':$('mode').value==='merged'?(mergeStale?'Stale merged result · edit slices or Merge again':'Merged maximum heights · pick Photo or Heightmap at the top to see slices'):loading?'Loading native photo + TMD…':masking?'Removing background…':aligning?'Fitting curves and aligning leaf ends…':preparing?`Preparing preview (${preparing}) · placement unchanged`:!s.slices.length?'Start: add scan folders':!ok?'Next: remove background':stale()?'Setup changed · Align again to apply':s.aligned?'Aligned · inspect and refine joints':!stemsReady()?'Next: inspect the cut-outs, then compute slice stems':'Next: inspect stems, then Align';
}
const cardLabel=s=>[`${+s.angle.toFixed(1)}°`,s.reverse?'ends swapped':'',stemKind(s)].filter(Boolean).join(' · ');
// Step 3 hand-drawn stem controls for the selected slice.
function handStatus(chosen,busy){
 const n=chosen?.handStem?.points.length||0,on=$('handSliceStem').checked;
 $('handSliceStem').disabled=busy||!chosen||$('mode').value==='merged';
 $('undoHandPoint').disabled=busy||!n;$('clearHandStem').disabled=busy||!n;
 $('handStemHint').textContent=!chosen?'Select a slice first.':$('mode').value==='merged'?'Switch to Photo or Heightmap to draw.':!on?(n?`${n} points · tick Draw to edit.`:'For slices where the automatic stem fails.'):n<2?'Click along the stem, starting at the incoming end. Drag empty space to pan.':`${n} points · click to add at the end · drag a point to move it · right-click a point to delete it.`;
}
function refresh(){if(!store.state.slices.some(s=>s.id===selected))selected=store.state.slices[0]?.id||null;renderSide();status();draw();schedulePreview();}
function edit(fn){store.edit(fn);error();refresh();}
// Input gestures snapshot once at first actual change, not on focus. Blur/change
// commits without replacing DOM, so the following lock or Align click survives.
function numeric(el,fn,{scientific=false,min=-Infinity,max=Infinity,integer=false,relativeStep=false}={}){
 el.oninput=()=>{const value=Number(el.value);if(el.value===''||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))){if(relativeStep)el.setCustomValidity(`Enter a number from ${min} to ${max}.`);error('Correct the highlighted numeric value.');return;}
 // Without a min, the current value anchors native spinner steps; typed fractions stay valid.
 if(relativeStep){el.setCustomValidity('');el.setAttribute('value',el.value);}
 store.update(s=>fn(s,value));error();status();draw();if(scientific){syncLocked();schedulePreview();}};
 el.onchange=()=>{store.end();status();};el.onblur=()=>{store.end();status();};
}
function selectSlice(id){store.end();selected=id;renderSide();draw();}
function syncLocked(){const s=store.state.slices.find(s=>s.id===selected);if(!s)return;for(const k of ['top','degree'])if(s[k+'Locked']&&$('local-'+k))$('local-'+k).value=store.state.shared[k];}
function renderSide(){
 const state=store.state;
 for(const k of ['threshold','closing','core','halo','iterations'])$('bg-'+k).value=state.background[k];
 for(const [id,k] of [['sharedTop','top'],['sharedDegree','degree'],['sharedOverlap','overlap']])$(id).value=state.shared[k];
 $('slices').innerHTML=state.slices.map((s,i)=>`<div class="card ${s.id===selected?'selected':''}" data-index="${i}" draggable="true" tabindex="0" role="button" aria-label="Select slice ${i+1}" title="${esc(s.path)}"><div class="cardName"><b>${i+1}</b>${esc(name(s))}</div><small>${esc(cardLabel(s))}</small><div class="sliceJobBox" aria-live="polite"></div><div class="cardControls"><button class="remove" aria-label="Remove slice ${i+1}">Remove</button><button class="up" aria-label="Move slice ${i+1} up" ${i===0?'disabled':''}>↑</button><button class="down" aria-label="Move slice ${i+1} down" ${i===state.slices.length-1?'disabled':''}>↓</button></div></div>`).join('');
 for(const card of $('slices').children){const i=+card.dataset.index,s=state.slices[i];const select=()=>selectSlice(s.id);card.onclick=e=>{if(!e.target.closest('button'))select();};card.onkeydown=e=>{if(e.key==='Enter')select();};card.querySelector('.up').onclick=()=>edit(st=>reorder(st,i,i-1));card.querySelector('.down').onclick=()=>edit(st=>reorder(st,i,i+1));card.querySelector('.remove').onclick=()=>edit(st=>{st.slices.splice(i,1);arrange(st);});card.ondragstart=()=>dragId=s.id;card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();edit(st=>reorder(st,st.slices.findIndex(s=>s.id===dragId),i));};}
 const index=state.slices.findIndex(s=>s.id===selected),s=state.slices[index];$('inspector').hidden=!s;if(!s)$('sliceFit').innerHTML='';
 if(s){const values=effective(state,s);$('inspector').innerHTML=`<h3>Slice ${index+1}</h3><label class="field">Angle ° <input id="angle" type="number" min="-3600" max="3600" step="any" value="${s.angle}"></label><input id="angleSlider" aria-label="Rotation slider" type="range" min="-180" max="180" step=".1" value="${s.angle}"><label><input id="mirrorH" type="checkbox" ${s.mirrorH?'checked':''}> Mirror H</label> <label><input id="mirrorV" type="checkbox" ${s.mirrorV?'checked':''}> Mirror V</label><label class="block"><input id="reverse" type="checkbox" ${s.reverse?'checked':''}> Swap incoming / outgoing ends</label>`; $('sliceFit').innerHTML=`<h3>Slice ${index+1} fit</h3>${['top','degree'].map(k=>`<div class="field"><label for="local-${k}">${k==='top'?'Top %':'Degree'}</label><input id="local-${k}" type="number" min="${k==='top'?'.001':'1'}" max="${k==='top'?'100':'8'}" step="${k==='top'?'any':'1'}" value="${values[k]}" ${s[k+'Locked']?'disabled':''}><button id="lock-${k}">${s[k+'Locked']?'Locked':'Unlocked'}</button></div>`).join('')}<div class="fitinfo">Native ${s.dimensions.join(' × ')} pixels<br>Height display ${s.height_range_mm.map(v=>v.toFixed(4)).join(' … ')} mm<br>Black = minimum; white = maximum, per slice.</div>`;
 for(const k of ['top','degree']){numeric($('local-'+k),(st,v)=>{st.slices.find(s=>s.id===selected)[k]=v;},{scientific:true,min:k==='top'?.001:1,max:k==='top'?100:8,integer:k==='degree'});$('lock-'+k).onclick=()=>edit(st=>{const item=st.slices.find(s=>s.id===selected);item[k]=st.shared[k];item[k+'Locked']=!item[k+'Locked'];});}
 numeric($('angle'),(st,v)=>{orient(st,st.slices.findIndex(s=>s.id===selected),{angle:v});$('angleSlider').value=v;},{min:-3600,max:3600});
 numeric($('angleSlider'),(st,v)=>{orient(st,st.slices.findIndex(s=>s.id===selected),{angle:v});$('angle').value=v;},{min:-180,max:180});
 for(const k of ['mirrorH','mirrorV'])$(k).onchange=e=>edit(st=>orient(st,st.slices.findIndex(s=>s.id===selected),{[k]:e.target.checked}));
 $('reverse').onchange=e=>edit(st=>{st.slices.find(s=>s.id===selected).reverse=e.target.checked;});
 }
$('stemReverse').disabled=!s;$('stemReverse').checked=!!s?.reverse;
 $('jointSection').hidden=!state.aligned||!state.joints.length;
 selectedJoint=Math.min(selectedJoint,Math.max(0,state.joints.length-1));
 $('jointSelect').innerHTML=state.joints.map((j,i)=>`<option value="${i}" ${i===selectedJoint?'selected':''}>${i+1} → ${i+2}</option>`).join('');
 $('jointSelect').onchange=e=>{selectedJoint=+e.target.value;renderSide();draw();};
 $('joints').innerHTML=state.joints.map((j,i)=>i!==selectedJoint?'':`<div class="join"><h3>${i+1} → ${i+2}</h3>${[['along','Along mm'],['across','Across mm'],['angle','Angle °']].map(([k,label])=>`<div class="field jointField"><label for="joint-${i}-${k}">${label}</label><button type="button" id="joint-${i}-${k}-minus" class="jointStep" aria-label="Decrease ${k==='angle'?'Angle by 1 degree':k==='along'?'Along by 0.1 mm':'Across by 0.1 mm'}">−</button><input id="joint-${i}-${k}" type="number" max="3600" step="${k==='angle'?'1':'0.1'}" value="${j[k]}"><button type="button" id="joint-${i}-${k}-plus" class="jointStep" aria-label="Increase ${k==='angle'?'Angle by 1 degree':k==='along'?'Along by 0.1 mm':'Across by 0.1 mm'}">+</button></div>`).join('')}</div>`).join('');
 state.joints.forEach((j,i)=>{if(i!==selectedJoint)return;for(const k of ['along','across','angle']){
  const el=$(`joint-${i}-${k}`);
  numeric(el,(st,v)=>editJoint(st,i,{[k]:v}),{min:-3600,max:3600,relativeStep:true});
  for(const [suffix,direction] of [['minus',-1],['plus',1]])$(`joint-${i}-${k}-${suffix}`).onclick=()=>{
   // Commit typing separately; keep this DOM intact so blur cannot eat the click.
   store.end();
   if(el.value===''||!el.validity.valid){error('Correct the highlighted numeric value.');el.reportValidity();return;}
   const value=Number((Number(el.value)+direction*(k==='angle'?1:.1)).toFixed(12));
   if(value< -3600||value>3600){error('Joint values must stay between −3600 and 3600.');return;}
   store.edit(st=>editJoint(st,i,{[k]:value}));
   el.value=value;el.setAttribute('value',el.value);el.setCustomValidity('');error();status();draw();
  };
 }});
 for(const id of ['inspector','sliceFit','joints'])applyHelp($(id));
}
async function prepareMask(s,state){
 const key=maskKey(s,state);if(masks.has(key))return masks.get(key);if(pendingMasks.has(key))return pendingMasks.get(key);
 const promise=(async()=>{preparing++;status();try{const r=await api('/api/mask',{path:s.path,background:parameters(state)});await Promise.all(Object.values(r.assets).map(image));const im=images.get(r.assets.outline),c=document.createElement('canvas');c.width=im.width;c.height=im.height;const q=c.getContext('2d');q.drawImage(im,0,0);const pixels=q.getImageData(0,0,c.width,c.height).data;let lo=[c.width,c.height],hi=[0,0];for(let i=3;i<pixels.length;i+=4)if(pixels[i]){const n=(i-3)/4,x=n%c.width,y=Math.floor(n/c.width);lo=[Math.min(lo[0],x),Math.min(lo[1],y)];hi=[Math.max(hi[0],x),Math.max(hi[1],y)];}r.bounds=[lo,hi].map(p=>p.map((v,k)=>v*s.dimensions[k]/[c.width,c.height][k]));masks.set(key,r);draw();return r;}finally{preparing--;pendingMasks.delete(key);status();}})();pendingMasks.set(key,promise);return promise;
}
async function prepare(s,state){
 const key=fitKey(s,state);if(fits.has(key))return fits.get(key);if(pendingFits.has(key))return pendingFits.get(key);
 const promise=(async()=>{preparing++;status();try{const r=await api('/api/fit',{path:s.path,...effective(state,s),background:parameters(state)});await Promise.all(Object.values(r.assets.improved).map(image));fits.set(key,r);draw();return r;}finally{preparing--;pendingFits.delete(key);status();}})();pendingFits.set(key,promise);return promise;
}
function schedulePreview(){} // Explicit Compute owns scientific fitting; visibility never does.
async function computeSliceStems(){
 if(computingStems||curveBusy||!ready())return;
 store.end();if([...$('alignmentStep').querySelectorAll('input[type=number]:not(:disabled)')].some(e=>!e.validity.valid||e.value==='')){error('Correct stem parameters first.');return;}
 const snapshot=structuredClone(store.state),revision=store.revision;computingStems=true;error();status();const job=beginBusy('Computing slice stems',{total:snapshot.slices.length,buttons:['computeSliceStems'],hints:['sliceStemStatus']});
 streamState=snapshot;layers.curve=true;$('curve').checked=true;
 try{const failures=await runSlices('fit',snapshot.slices,s=>prepare(s,snapshot).finally(()=>job.tick()));if(revision!==store.revision)throw Error('Setup changed; compute again.');
  // Commit every slice that succeeded; a failed slice keeps no automatic stem and can be drawn by hand.
  store.edit(st=>{for(const s of st.slices){if(fits.has(fitKey(s,st)))s.computedFitKey=fitKey(s,st);else delete s.computedFitKey;delete s.manualResult;}});clearJobs('fit');layers.curve=true;$('curve').checked=true;refresh();
  if(failures.length)error('Automatic stem failed · '+failures.join(' · ')+(store.state.slices.every(s=>result(s))?'':' · Draw these stems by hand (step 3) or change Top % / Degree.'));}
 catch(e){error('Stem computation failed: '+e.message);}finally{job.end();computingStems=false;streamState=null;status();draw();}
}
async function removeBackground(){
 if(masking||loading||aligning||!store.state.slices.length)return;
 store.end();if([...$('backgroundStep').querySelectorAll('input')].some(e=>!e.validity.valid||e.value==='')){error('Correct mask parameters before removing background.');return;}
 const snapshot=structuredClone(store.state),revision=store.revision;masking=true;error();status();const job=beginBusy('Removing background',{total:snapshot.slices.length,buttons:['prepareBackground'],hints:['maskStatus']});
 streamState=snapshot;showSource=false;
 try{const failures=await runSlices('mask',snapshot.slices,s=>prepareMask(s,snapshot).finally(()=>job.tick()));if(failures.length)throw Error(failures.join(' · '));
 if(revision!==store.revision){error('Setup changed during preparation. Press Remove background again.');return;}
 store.edit(st=>{st.background.enabled=true;});showSource=false;clearJobs('mask');refresh();
 }catch(e){error('Background removal failed; placement retained. Check mask parameters and retry. '+e.message);}
 finally{job.end();masking=false;streamState=null;status();draw();}
}
async function doMerge(){
 if(merging||loading||aligning||masking||!ready()||!store.state.aligned)return;
 store.end();if([...document.querySelectorAll('#loadStep input[type=number]:not(:disabled), #backgroundStep input[type=number]:not(:disabled), #alignmentStep input[type=number]:not(:disabled), #jointSection input[type=number]:not(:disabled)')].some(e=>e.value===''||!e.validity.valid)){error('Correct numeric values before Merge.');return;}
 const snapshot=structuredClone(store.state),revision=store.revision;
 const payload={background:parameters(snapshot),slices:snapshot.slices.map(s=>({path:s.path,pose:s.pose,mask_key:masks.get(maskKey(s,snapshot)).key}))};
 merging=true;mergeError='';error();status();const job=beginBusy('Merging raw heights',{buttons:['merge'],hints:['mergeStatus']});
 try{const r=await api('/api/merge',payload);await image(r.asset);
 if(revision!==store.revision){error('Merge discarded: setup changed during computation. Merge again.');return;}
 merged=r;mergeRevision=revision;post.clearPreview();$('mode').value='merged';draw();
 }catch(e){mergeError=e.message;error('Merge failed; slices and last result retained. '+e.message);}
 finally{job.end();merging=false;status();draw();}
}
async function doAlign(){
 if(aligning||loading||curveBusy||!stemsReady()||store.state.slices.length<2)return;store.end();if([...document.querySelectorAll('#loadStep input[type=number]:not(:disabled), #backgroundStep input[type=number]:not(:disabled), #alignmentStep input[type=number]:not(:disabled), #alignRefineStep input[type=number]:not(:disabled)')].some(e=>e.value===''||!e.validity.valid)){error('Correct invalid numeric values before Align.');return;}
 const snapshot=structuredClone(store.state),revision=store.revision;aligning=true;error();status();
 try{const rs=store.state.slices.map(result);if(store.revision!==revision){error('Align discarded: setup changed.');return;}
 store.edit(st=>{align(st,Object.fromEntries(rs.map(r=>[r.id,r])));st.alignedSetup=setupKey(st);});refresh();fitView();
 }catch(e){error('Align failed; arrangement retained. '+e.message);}finally{aligning=false;status();}
}
function transformed(s,p){return add(mul(s.pose.matrix,p),s.pose.shift);}
// Acquisition footprint is display decoration, never scientific foreground geometry.
function corners(s){return [[0,0],[s.dimensions[0],0],s.dimensions,[0,s.dimensions[1]]].map(p=>transformed(s,p));}
function fitView(){const points=store.state.slices.flatMap(corners);if(!points.length)return;const lo=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...points.map(p=>p[k])));camera.scale=Math.min((canvas.clientWidth-80)/(hi[0]-lo[0]),(canvas.clientHeight-80)/(hi[1]-lo[1]));camera.x=canvas.clientWidth/2-camera.scale*(lo[0]+hi[0])/2;camera.y=canvas.clientHeight/2-camera.scale*(lo[1]+hi[1])/2;draw();}
function heightImage(s,r){if(!r)return images.get(s.assets.height);const key=s.key+r.key;if(maskedHeights.has(key))return maskedHeights.get(key);const c=document.createElement('canvas');[c.width,c.height]=s.asset_size;const x=c.getContext('2d');x.drawImage(images.get(s.assets.height),0,0);x.globalCompositeOperation='destination-in';x.drawImage(images.get(r.assets.photo),0,0,c.width,c.height);maskedHeights.set(key,c);return c;}
function draw(){const ratio=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.fillStyle='#050505';ctx.fillRect(0,0,canvas.width,canvas.height);const screen=p=>[camera.x+p[0]*camera.scale,camera.y+p[1]*camera.scale];
 if(post.preview()||($('mode').value==='merged'&&merged)){
 post.paint(ctx,ratio,camera);
 $('scale').textContent=camera.scale.toFixed(1)+' px/mm';status();return;
 }
 if($('mode').value==='photo'){
  const items=store.state.slices.map(s=>{const m=!$('source').checked?liveMask(s):null,url=m?m.assets.photo:s.assets.photo;return {...s,url,image:images.get(url)};}).filter(s=>s.image);
  const blended=photoBlend.get(items);if(blended){const sc=ratio*camera.scale;ctx.setTransform(sc,0,0,sc,ratio*camera.x,ratio*camera.y);ctx.drawImage(blended.canvas,...blended.lo,...blended.extent);}
 }
 for(const s of store.state.slices){const A=s.pose.matrix,r=liveResult(s),m=liveMask(s),displayMask=$('source').checked?null:m,sc=ratio*camera.scale;ctx.setTransform(sc*A[0][0],sc*A[1][0],sc*A[0][1],sc*A[1][1],ratio*(camera.x+camera.scale*s.pose.shift[0]),ratio*(camera.y+camera.scale*s.pose.shift[1]));const base=$('mode').value==='height'?heightImage(s,displayMask):null;if(base)ctx.drawImage(base,0,0,...s.dimensions);const auto=r&&!r.hand?r:autoResult(s);if(auto&&layers.highlight&&images.get(auto.assets.improved.highlight)){ctx.imageSmoothingEnabled=false;ctx.drawImage(images.get(auto.assets.improved.highlight),-.5,-.5,...s.dimensions);ctx.imageSmoothingEnabled=true;}const drawing=handOn()&&s.id===selected,hand=handGesture?.slice===s.id?handGesture.points:s.handStem?.points;if(drawing||(r?.hand&&layers.curve)){ctx.setTransform(ratio,0,0,ratio,0,0);if(hand?.length)paintHand(ctx,hand,p=>screen(transformed(s,p)),{active:drawing});}else if(r&&!r.hand&&(layers.curve||($('editSliceCurve').checked&&s.id===selected))){ctx.setTransform(ratio,0,0,ratio,0,0);const map=p=>screen(transformed(s,p));paintCurve(ctx,r,map,{preview:sliceGesture?.slice.id===s.id?sliceGesture.handles:null});}}
 ctx.setTransform(ratio,0,0,ratio,0,0);for(const [i,s] of store.state.slices.entries()){const p=corners(s).map(screen);ctx.strokeStyle=s.id===selected?'#ff0088':'#ffffff';ctx.lineWidth=s.id===selected?3:1;ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.closePath();ctx.stroke();const [x,y]=p[0];ctx.fillStyle=s.id===selected?'#ff0088':'#fff';ctx.fillRect(x,y,24,21);ctx.fillStyle='#000';ctx.font='bold 12px system-ui';ctx.fillText(String(i+1),x+7,y+15);}
 if(layers.curve&&(ready()||computingStems))for(const [si,s] of store.state.slices.entries()){const r=liveResult(s);if(!r)continue;for(const [i,p] of r.geometry.ends.entries()){const q=screen(transformed(s,p)),incoming=s.reverse?i===1:i===0;ctx.fillStyle=incoming?'#00ffc8':'#ff0088';ctx.beginPath();ctx.arc(...q,4,0,Math.PI*2);ctx.fill();ctx.font='11px system-ui';if(!store.state.aligned||(incoming?si===0:si===store.state.slices.length-1))ctx.fillText(incoming?'in':'out',q[0]+7,q[1]-7);}}
 for(const [i,j] of store.state.joints.entries()){const p=screen(j.pivot);ctx.beginPath();ctx.arc(...p,5,0,Math.PI*2);ctx.strokeStyle=i===selectedJoint?'#ff0088':'#fff';ctx.lineWidth=2;ctx.stroke();if(layers.curve){ctx.fillStyle='#fff';ctx.font='11px system-ui';ctx.fillText(`${i+1}→${i+2}`,p[0]+8,p[1]-9);}}
 post.paintOverlays(ctx,ratio,camera);
 if($('editSliceCurve').checked){const s=store.state.slices.find(s=>s.id===selected),r=s&&result(s);if(r&&!r.hand){ctx.setTransform(ratio,0,0,ratio,0,0);paintHandles(ctx,sliceGesture?.handles||handlesFor(r),p=>screen(transformed(s,p)));}}
 $('scale').textContent=camera.scale.toFixed(1)+' px/mm';const item=store.state.slices.find(s=>s.id===selected);$('heightLegend').textContent=$('mode').value==='height'&&item?' · Height '+item.height_range_mm.map(v=>v.toFixed(4)).join(' … ')+' mm · black → white (per slice)':'';status();
}
let folderSelection=new Map(),folderEntries=[],folderParent=null,folderRoot=null,browseGeneration=0;
function selectionCount(){
 $('selectionCount').textContent=folderSelection.size+' selected';
 const valid=folderEntries.filter(e=>e.valid);
 $('selectAllFolders').disabled=!valid.some(e=>!folderSelection.has(e.path));
 $('unselectAllFolders').disabled=!folderSelection.size;
}
function selectFolders(all){
 folderSelection.clear();
 if(all)for(const e of folderEntries)if(e.valid)folderSelection.set(e.path,e);
 for(const row of $('folderEntries').children){if(row.dataset.i===undefined)continue;const e=folderEntries[+row.dataset.i];row.querySelector('input').checked=!!e.valid&&folderSelection.has(e.path);}
 selectionCount();
}
$('selectAllFolders').onclick=()=>selectFolders(true);
$('unselectAllFolders').onclick=()=>selectFolders(false);
async function browse(path=folderRoot||''){
 const generation=++browseGeneration;
 $('folderError').textContent='';
 try{
  const v=await api('/api/browse?path='+encodeURIComponent(path));if(generation!==browseGeneration)return;
  // A successful root change starts a new selection; failed/stale requests do not.
  if(v.path!==folderRoot)folderSelection.clear();
  const available=new Set(v.entries.filter(e=>e.valid).map(e=>e.path));
  for(const selectedPath of folderSelection.keys())if(!available.has(selectedPath))folderSelection.delete(selectedPath);
  folderEntries=v.entries;
  folderRoot=v.path;$('folderPath').value=v.path;folderParent=v.parent;$('parent').disabled=!v.parent;
  // File-picker rows: scan folders are checkable; other folders open on click, like a normal file dialog.
  $('folderEntries').innerHTML=v.entries.map((e,i)=>e.valid?`<div class="folderRow scan" data-i="${i}"><input id="scan-folder-${i}" type="checkbox" ${folderSelection.has(e.path)?'checked':''}><label for="scan-folder-${i}">${esc(e.name)}</label></div>`:e.error?`<div class="folderRow" data-i="${i}"><input type="checkbox" disabled><label>${esc(e.name)}<small>${esc(e.error)}</small></label></div>`:`<div class="folderRow dir" data-i="${i}"><button type="button" class="openFolder" title="Open this folder">📁 ${esc(e.name)} <span aria-hidden="true">›</span></button></div>`).join('')||'<p class="hint">No folders here. Use ↑ to go up.</p>';
  for(const row of $('folderEntries').children){if(row.dataset.i===undefined)continue;const e=v.entries[+row.dataset.i];const open=row.querySelector('.openFolder');if(open){open.onclick=()=>browse(e.path);continue;}row.querySelector('input').onchange=event=>{if(event.target.checked)folderSelection.set(e.path,e);else folderSelection.delete(e.path);selectionCount();};}
  selectionCount();
 }catch(e){if(generation!==browseGeneration)return;$('folderError').textContent=e.message;if(folderRoot)$('folderPath').value=folderRoot;}
}
$('add').onclick=()=>{folderSelection.clear();selectionCount();for(const input of $('folderEntries').querySelectorAll('input'))input.checked=false;$('folders').showModal();browse();};$('folders').onclose=()=>{++browseGeneration;};$('closeFolders').onclick=()=>$('folders').close();$('parent').onclick=()=>browse(folderParent);$('browse').onclick=()=>browse($('folderPath').value);$('folderPath').onfocus=e=>e.target.select();$('folderPath').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();browse(e.target.value);}};
$('load').onclick=async()=>{if(loading)return;const paths=[...folderSelection.keys()].filter(p=>!store.state.slices.some(s=>s.id===p));if(!paths.length){error('Select at least one new scan folder.');return;}if(paths.length+store.state.slices.length>30){error('Maximum 30 slices.');return;}store.end();const revision=store.revision;loading=true;error();$('folders').close();status();const job=beginBusy('Loading scans',{total:paths.length,buttons:['add'],hints:['loadStatus']});try{const loaded=[];for(const path of paths){const r=await api('/api/load',{path});await Promise.all(Object.values(r.assets).map(image));loaded.push(r);job.tick();}if(revision!==store.revision){error('Load discarded: setup changed while decoding. Load again.');return;}store.edit(st=>addSlices(st,loaded));refresh();fitView();}catch(e){error('Load failed; existing arrangement retained. '+e.message);}finally{job.end();loading=false;status();}};
for(const [id,k] of [['sharedTop','top'],['sharedDegree','degree'],['sharedOverlap','overlap']])numeric($(id),(st,v)=>{st.shared[k]=v;},{scientific:k!=='overlap',min:k==='top'?.001:k==='degree'?1:-50,max:k==='top'?100:k==='degree'?8:50,integer:k==='degree'});
$('merge').onclick=doMerge;
$('align').onclick=doAlign;$('undo').onclick=()=>{store.undo();error();refresh();};$('redo').onclick=()=>{store.redo();error();refresh();};$('fit').onclick=fitView;
$('prepareBackground').onclick=removeBackground;
 $('computeSliceStems').onclick=computeSliceStems;
 $('editSliceCurve').onchange=()=>{$('resetSliceCurve').hidden=!$('editSliceCurve').checked;$('mergedEditControls').hidden=true;if($('editSliceCurve').checked){$('editMergedCurve').checked=false;$('handSliceStem').checked=false;$('redrawOutline').checked=false;layers.curve=true;$('curve').checked=true;}draw();};
 $('handSliceStem').onchange=()=>{if($('handSliceStem').checked){$('editSliceCurve').checked=false;$('resetSliceCurve').hidden=true;layers.curve=true;$('curve').checked=true;}store.end();status();draw();};
 $('undoHandPoint').onclick=()=>edit(st=>{const item=st.slices.find(s=>s.id===selected);if(!item?.handStem)return;item.handStem.points.pop();if(!item.handStem.points.length)delete item.handStem;});
 $('clearHandStem').onclick=()=>edit(st=>{delete st.slices.find(s=>s.id===selected)?.handStem;});
 $('resetSliceCurve').onclick=()=>edit(st=>{delete st.slices.find(s=>s.id===selected).manualResult;});
$('source').onchange=e=>{showSource=e.target.checked;draw();};
for(const [k,min,max,integer] of [['threshold',50,99.99,false],['closing',0,30,true],['core',1,40,true],['halo',1,40,true],['iterations',1,20,true]])numeric($('bg-'+k),(st,v)=>{st.background[k]=v;},{scientific:true,min,max,integer});
$('stemReverse').onchange=e=>{if(!$('curve').checked){$('curve').checked=true;layers.curve=true;}edit(st=>{const s=st.slices.find(s=>s.id===selected);if(s)s.reverse=e.target.checked;});};
for(const k of ['highlight','curve'])$(k).onchange=e=>{layers[k]=e.target.checked;draw();schedulePreview();};// Read the display selector at render time: no duplicate mode state or fit gate.
$('mode').oninput=$('mode').onchange=()=>{post.clearPreview();draw();};
document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||!['z','y'].includes(e.key.toLowerCase()))return;e.preventDefault();if(e.shiftKey||e.key.toLowerCase()==='y')store.redo();else store.undo();error();refresh();});
canvas.onwheel=e=>{e.preventDefault();const box=canvas.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top,newScale=Math.min(3000,Math.max(.1,camera.scale*Math.exp(-e.deltaY*.001))),r=newScale/camera.scale;camera.x=x-(x-camera.x)*r;camera.y=y-(y-camera.y)*r;camera.scale=newScale;draw();};
// Pick in native coordinates, front to back. Transparent masked rectangles
// must not hide visible leaves below; retain their full footprint as a fallback.
const pickCanvas=document.createElement('canvas');pickCanvas.width=pickCanvas.height=1;
const pickContext=pickCanvas.getContext('2d',{willReadFrequently:true});
function sliceAt(clientX,clientY){
 const box=canvas.getBoundingClientRect(),world=[(clientX-box.left-camera.x)/camera.scale,(clientY-box.top-camera.y)/camera.scale];let fallback=null;
 for(const s of [...store.state.slices].reverse()){
  const A=s.pose.matrix,det=A[0][0]*A[1][1]-A[0][1]*A[1][0],x=world[0]-s.pose.shift[0],y=world[1]-s.pose.shift[1];if(!det)continue;
  const u=(A[1][1]*x-A[0][1]*y)/det,v=(A[0][0]*y-A[1][0]*x)/det;
  if(u<0||v<0||u>=s.dimensions[0]||v>=s.dimensions[1])continue;
  fallback??=s.id;
  const mask=ready()&&!$('source').checked?maskResult(s):null;if(!mask)return s.id;
  const im=images.get(mask.assets.photo);if(!im)continue;
  pickContext.clearRect(0,0,1,1);pickContext.drawImage(im,Math.floor(u/s.dimensions[0]*im.width),Math.floor(v/s.dimensions[1]*im.height),1,1,0,0,1,1);
  if(pickContext.getImageData(0,0,1,1).data[3])return s.id;
 }
 return fallback;
}
let pointer=null;
function nativePointer(e,s){const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left-camera.x)/camera.scale-s.pose.shift[0],y=(e.clientY-b.top-camera.y)/camera.scale-s.pose.shift[1],A=s.pose.matrix,d=A[0][0]*A[1][1]-A[0][1]*A[1][0];return [(A[1][1]*x-A[0][1]*y)/d,(-A[1][0]*x+A[0][0]*y)/d];}
function beginSlice(e){if(curveBusy||!$('editSliceCurve').checked||$('mode').value==='merged')return false;const s=store.state.slices.find(s=>s.id===selected),r=s&&result(s);if(!r||r.hand)return false;const h=handlesFor(r),b=canvas.getBoundingClientRect(),map=p=>transformed(s,p).map((v,k)=>v*camera.scale+(k?camera.y:camera.x)),index=hitHandle(h,map,[e.clientX-b.left,e.clientY-b.top]);if(index<0)return false;store.end();sliceGesture={id:e.pointerId,slice:structuredClone(s),r,handles:structuredClone(h),index,revision:store.revision,start:nativePointer(e,s),moved:false};canvas.setPointerCapture(e.pointerId);return true;}
async function finishSlice(e){const g=sliceGesture;sliceGesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(!g.moved){draw();return;}curveBusy=true;status();const job=beginBusy('Checking edited curve',{hints:['sliceStemStatus']});try{const r=await api('/api/curve/edit',{kind:'slice',key:g.r.key,handles:g.handles});if(store.revision!==g.revision)throw Error('Setup changed; manual edit discarded.');store.edit(st=>{st.slices.find(s=>s.id===g.slice.id).manualResult=r;});error();refresh();}catch(e){error(e.message);draw();}finally{job.end();curveBusy=false;status();}}
// Hand-drawn stem: click adds a point (native coordinates of the selected slice), drag a point moves it,
// right-click a point deletes it, dragging empty space still pans. Every change is one Undo step.
const handSlice=()=>handOn()?store.state.slices.find(s=>s.id===selected):null;
const handScreen=s=>p=>transformed(s,p).map((v,k)=>v*camera.scale+(k?camera.y:camera.x));
const canvasPoint=e=>{const b=canvas.getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];};
function beginHand(e){const s=handSlice();if(!s?.handStem)return false;const index=hitPoint(s.handStem.points,handScreen(s),canvasPoint(e));if(index<0)return false;store.end();handGesture={id:e.pointerId,slice:s.id,index,points:structuredClone(s.handStem.points),moved:false};canvas.setPointerCapture(e.pointerId);return true;}
function addHandPoint(e){const s=handSlice();if(!s)return false;const p=nativePointer(e,s);if(!insideSlice(s,p)){error('Click inside the selected slice to add a stem point.');return true;}try{const points=structuredClone(s.handStem?.points||[]);if(appendPoint(points,p))edit(st=>{st.slices.find(x=>x.id===s.id).handStem={points};});}catch(err){error(err.message);}return true;}
function finishHand(e){const g=handGesture;handGesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);const s=store.state.slices.find(x=>x.id===g.slice);if(g.moved&&s&&insideSlice(s,g.points[g.index]))edit(st=>{st.slices.find(x=>x.id===g.slice).handStem={points:g.points};});else{if(g.moved)error('Keep stem points inside the selected slice.');draw();}}
canvas.oncontextmenu=e=>{const s=handSlice();if(!s?.handStem)return;const index=hitPoint(s.handStem.points,handScreen(s),canvasPoint(e));if(index<0)return;e.preventDefault();edit(st=>{const item=st.slices.find(x=>x.id===s.id),points=item.handStem.points.filter((_,i)=>i!==index);if(points.length)item.handStem={points};else delete item.handStem;});};
canvas.onpointerdown=e=>{if(pointer||sliceGesture||handGesture||e.button!==0)return;if(beginHand(e)||beginSlice(e)||post.pointerDown(e,camera))return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,cameraX:camera.x,cameraY:camera.y,dragging:false};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(handGesture){const s=store.state.slices.find(x=>x.id===handGesture.slice);handGesture.points[handGesture.index]=nativePointer(e,s).map(v=>Math.round(v*100)/100);handGesture.moved=true;draw();return;}if(sliceGesture){const g=sliceGesture,p=nativePointer(e,g.slice),h=handlesFor(g.r)[g.index];g.handles[g.index]=h.map((v,k)=>v+p[k]-g.start[k]);g.moved=true;draw();return;}if(post.pointerMove(e,camera))return;if(!pointer||e.pointerId!==pointer.id)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(dx,dy)>4)pointer.dragging=true;if(pointer.dragging){camera.x=pointer.cameraX+dx;camera.y=pointer.cameraY+dy;draw();}};
canvas.onpointerup=e=>{if(handGesture){finishHand(e);return;}if(sliceGesture){finishSlice(e);return;}if(post.pointerUp(e,camera))return;if(!pointer||e.pointerId!==pointer.id)return;const click=!pointer.dragging&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)<=4;pointer=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(click){if(handSlice()){addHandPoint(e);return;}const id=sliceAt(e.clientX,e.clientY);if(id)selectSlice(id);}};
canvas.onpointercancel=canvas.onlostpointercapture=()=>{pointer=null;if(handGesture){handGesture=null;draw();}if(sliceGesture){sliceGesture=null;draw();}post.pointerCancel();};
// Save / open a session (session.mjs, session.py). The file holds how the slices relate; derived
// arrays are recomputed from the checked scans on open. Poses and joints are restored exactly.
let sessionReport=null;
const sessionStatus=t=>{$('sessionStatus').textContent=t;};
const mergeCurrentNow=()=>!!merged&&mergeRevision===store.revision&&!merging;
const anyBusy=()=>loading||masking||aligning||computingStems||curveBusy||merging||sessionBusy||busyJobs().length>0;
function sessionResults(){const r=post.sessionResults();return {merge:mergeCurrentNow()?{dimensions:merged.dimensions,spacing_mm:merged.spacing_mm,origin_center_mm:merged.origin_center_mm,valid_cells:merged.valid_cells,height_range_mm:merged.height_range_mm}:null,...r};}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function saveSession(){
 if(!store.state.slices.length)return;if(anyBusy()){error('Wait for the running step to finish, then save.');return;}store.end();
 sessionBusy=true;error();status();const job=beginBusy('Saving session',{buttons:['saveSession'],hints:['sessionStatus']});sessionStatus('Checking scan files');
 try{const revision=store.revision,{sources}=await api('/api/session/describe',{paths:store.state.slices.map(s=>s.path)});
  if(revision!==store.revision)throw Error('Setup changed while saving; save again.');
  const st=store.state,edited=st.slices.map(s=>s.computedFitKey===fitKey(s)&&s.manualResult?s.manualResult.fit.handles:null);
  const doc=buildSession(st,sources,{edited,alignedCurrent:st.aligned&&!stale(),steps:{background:ready(),stems:st.slices.some(s=>autoResult(s)),merge:mergeCurrentNow()},post:post.sessionData(),results:sessionResults()});
  const filename=sessionFilename();download(filename,JSON.stringify(doc,null,1),'application/json');
  sessionStatus(`Saved ${filename}`);
 }catch(e){sessionStatus('Save failed');error('Save failed · '+e.message);}
 finally{job.end();sessionBusy=false;status();}
}
async function openSession(file){
 let doc;try{doc=parseSession(await file.text());}catch(e){error('Open failed · '+e.message);return;}
 if(anyBusy()){error('Wait for the running step to finish, then open the session.');return;}
 if(store.state.slices.length&&!confirm('Open this session? It replaces the slices and work in this tab. Save first if you need them.'))return;
 store.end();sessionBusy=true;error();sessionReport=null;status();
 const job=beginBusy('Opening session',{buttons:['openSession'],hints:['sessionStatus']}),phase=p=>{job.set({phase:p});sessionStatus('Opening session');};
 try{
  phase('checking scan files');const {paths}=await api('/api/session/resolve',{sources:doc.setup.slices.map(s=>s.scan)});
  phase('loading scans');const loads=[];for(const path of paths){const r=await api('/api/load',{path});await Promise.all(Object.values(r.assets).map(image));loads.push(r);}
  merged=null;mergeError='';mergeRevision=-1;sliceJobs.clear();$('mode').value='photo';post.clearPreview();
  store.state=sessionState(doc,loads);store.past=[];store.future=[];store.pending=null;store.revision++;selected=null;
  post.applySettings(doc.post?.settings);refresh();fitView();
  const fail=what=>{throw Error(what+($('error').textContent?' · '+$('error').textContent:''));};
  if(doc.steps.background){phase('removing background');await removeBackground();if(!ready())fail('Background removal failed');}
  if(doc.steps.stems){phase('computing slice stems');await computeSliceStems();const missing=store.state.slices.map((s,i)=>result(s)?null:i+1).filter(Boolean);if(missing.length)fail('Slice stems failed for slice '+missing.join(', '));error();}
  for(const [i,s] of doc.setup.slices.entries()){if(!s.editedCurve)continue;phase('restoring edited slice curves');const item=store.state.slices[i],auto=fits.get(fitKey(item));if(!auto||item.computedFitKey!==fitKey(item))fail(`Slice ${i+1}: automatic stem needed for its edited curve`);
   const r=await api('/api/curve/edit',{kind:'slice',key:auto.key,handles:s.editedCurve.handles});store.edit(st=>{st.slices[i].manualResult=r;});}
  if(doc.setup.alignedCurrent)store.edit(st=>{st.alignedSetup=setupKey(st);});
  refresh();
  if(doc.steps.merge){phase('merging');await doMerge();if(!mergeCurrentNow())fail('Merge failed');}
  phase('restoring results');await post.restore(doc.post,job);
  store.past=[];store.future=[];
  const differences=compareResults(doc.results||{},sessionResults());sessionReport={differences,results:sessionResults(),saved:doc.results||{}};
  sessionStatus(differences.length?'Opened · differs from saved: '+differences.join(', '):`Opened · ${paths.length} scans · results match the saved session`);
  if(differences.length)error('Session reopened, but these results differ from when it was saved: '+differences.join(', ')+'. The scans match, so the program version may differ.');
 }catch(e){sessionStatus('Open failed');error('Open failed · '+e.message);}
 finally{job.end();sessionBusy=false;status();draw();}
}
$('saveSession').onclick=saveSession;
$('openSession').onclick=()=>{$('sessionFile').value='';$('sessionFile').click();};
$('sessionFile').onchange=()=>{const f=$('sessionFile').files[0];if(f)openSession(f);};
window.sessionDebug=()=>({busy:sessionBusy,report:sessionReport,status:$('sessionStatus').textContent});
installHelp();
const post=postMerge({get:()=>({merged,mergeRevision,revision:store.revision,merging,mode:$('mode').value,hand:Object.fromEntries(store.state.slices.filter(handResult).map(s=>[s.path,s.handStem.points]))}),api,image,images,draw,error});
window.postDebug=()=>post.debug();
new ResizeObserver(draw).observe($('stage'));
window.busyDebug=busyJobs;
window.stitcherDebug=()=>({state:structuredClone(store.state),selected,merging,merged,mergeRevision,mergeStale:!!merged&&mergeRevision!==store.revision,revision:store.revision,undo:store.past.length,redo:store.future.length,loading,aligning,masking,ready:ready(),stemsReady:stemsReady(),stemKinds:store.state.slices.map(stemKind),handMode:handOn(),computingStems,curveBusy,editHandles:store.state.slices.find(s=>s.id===selected)&&result(store.state.slices.find(s=>s.id===selected))&&!result(store.state.slices.find(s=>s.id===selected)).hand?handlesFor(result(store.state.slices.find(s=>s.id===selected))):null,stale:stale(),preparing,mode:$('mode').value,masks:Object.fromEntries(store.state.slices.filter(s=>maskResult(s)).map(s=>[s.id,maskResult(s)])),layers:{...layers},camera:{...camera},images:images.size,results:Object.fromEntries(store.state.slices.filter(s=>result(s)).map(s=>[s.id,result(s)]))});
refresh();
// Update chip: poll served frontend files; never reload (the session lives in this tab).
(()=>{const files=['/','/app.js','/post.js','/blend.mjs','/model.mjs','/curve_edit.mjs','/hand_stem.mjs','/session.mjs','/plot.mjs','/outline.mjs','/style.css'];let base=null,seen=null;
 const digest=async()=>{const parts=await Promise.all(files.map(f=>fetch(f,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();})));const all=new Uint8Array(parts.reduce((n,b)=>n+b.byteLength+1,0));let o=0;for(const b of parts){all.set(new Uint8Array(b),o);o+=b.byteLength+1;}return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',all)),x=>x.toString(16).padStart(2,'0')).join('');};
 const chip=document.createElement('div');chip.id='updateChip';chip.hidden=true;chip.setAttribute('role','status');chip.innerHTML='<span>New version available. Refresh when convenient. Download CSVs first.</span><button type="button" aria-label="Hide notice" title="Hide">×</button>';document.body.append(chip);
 chip.querySelector('button').onclick=()=>{chip.hidden=true;};
 const check=async()=>{if(document.hidden&&base!==null)return;try{const d=await digest();if(base===null)base=d;else if(d!==base&&d!==seen){seen=d;chip.hidden=false;}}catch{}};
 check();setInterval(check,30000);document.addEventListener("visibilitychange",check);window.updateDebug=()=>({base,seen,shown:!chip.hidden});})();
