import {Store,addSlices,arrange,reorder,orient,align,editJoint,effective,mul,add} from './model.mjs';
import {postMerge,installHelp,applyHelp,setHelp} from './post.js';
import {photoCompositor} from './blend.mjs';
import {handlesFor,paintCurve,paintHandles,hitHandle} from './curve_edit.mjs';
const photoBlend=photoCompositor();
window.photoBlendDebug=()=>photoBlend.debug();
const $=id=>document.getElementById(id),store=new Store(),canvas=$('canvas'),ctx=canvas.getContext('2d');
const images=new Map(),fits=new Map(),pendingFits=new Map(),maskedHeights=new Map(),masks=new Map(),pendingMasks=new Map();
let selected=null,loading=false,aligning=false,masking=false,preparing=0,previewTimer=null,dragId=null,selectedJoint=0,showSource=false;
let merging=false,merged=null,mergeRevision=-1,mergeError='';
let computingStems=false,curveBusy=false,sliceGesture=null;
let camera={scale:20,x:30,y:70},layers={highlight:false,curve:false};
const name=s=>s.path.split('/').pop(),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parameters=state=>({...state.background,enabled:true});
const fitKey=(s,state=store.state)=>JSON.stringify([s.id,effective(state,s).top,effective(state,s).degree,parameters(state)]);
const result=s=>s.computedFitKey===fitKey(s)?(s.manualResult||fits.get(fitKey(s))):null;
const stemsReady=()=>ready()&&store.state.slices.every(s=>result(s));
const maskKey=(s,state=store.state)=>JSON.stringify([s.id,parameters(state)]);
const maskResult=s=>store.state.background.enabled?masks.get(maskKey(s)):null;
const ready=()=>!!store.state.slices.length&&store.state.background.enabled&&store.state.slices.every(s=>maskResult(s));
const setupKey=(st=store.state)=>JSON.stringify([st.slices.map(s=>[fitKey(s,st),s.manualResult?.key,s.reverse,s.angle,s.mirrorH,s.mirrorV]),st.shared.overlap]);
const stale=()=>store.state.aligned&&store.state.alignedSetup!==setupKey();
function error(s=''){$('error').textContent=s;}
async function api(path,data){const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),v=await r.json();if(!r.ok)throw Error(v.error||r.statusText);return v;}
async function image(url){if(images.has(url))return images.get(url);const im=new Image();im.src=url;await im.decode();images.set(url,im);return im;}
function status(){
 post.status();
 const s=store.state,ok=ready(),busy=loading||masking||aligning||computingStems||curveBusy;
 const chosen=s.slices.find(s=>s.id===selected),current=chosen&&result(chosen);
 $('computeSliceStems').disabled=busy||!ok;
 $('computeSliceStems').textContent=computingStems?'Computing slice stems…':'Compute slice stems';
 $('sliceStemStatus').textContent=computingStems?'Fitting native curves · placement unchanged.':!ok?'Remove background first.':!stemsReady()?'Compute automatic stems; placement stays unchanged.':current?.fit.clipped?'Manual handle outside tissue · displayed curve clipped to foreground.':current?.fit.manual?'Manual curve · placement unchanged until Align.':'Current automatic stems · optional handle editing.';
 $('editSliceCurve').disabled=busy||!current||$('mode').value==='merged';
 $('resetSliceCurve').hidden=!$('editSliceCurve').checked;
 $('resetSliceCurve').disabled=busy||!current?.fit.manual;
 const mergeStale=!!merged&&mergeRevision!==store.revision;
 $('merge').disabled=busy||merging||!ok||!s.aligned;
 $('merge').textContent=merging?'Merging raw heights…':merged?'Merge again':'Merge maximum heights';
 $('mode').querySelector('[value=merged]').disabled=!merged;
 $('mergeStatus').textContent=merging?'Computing raw foreground maximum… Edits will discard this run.':mergeError?'Merge failed · '+mergeError:mergeStale?'Stale · setup edited. Merge again; slices remain editable.':merged?`Current · ${merged.dimensions.join(' × ')} · ${merged.spacing_mm[0].toPrecision(4)} mm/pixel · max of raw heights`:!ok||!s.aligned?'Prepare and align first.':'Ready · max of raw foreground heights on one physical grid.';
 for(const card of $('slices').children){const item=s.slices[+card.dataset.index];if(item)card.querySelector('small').textContent=`${item.angle}°${item.reverse?' · ends swapped':''}`;}
 $('undo').disabled=busy||(!store.past.length&&!store.pending);$('redo').disabled=busy||!store.future.length;
 $('add').disabled=busy;$('add').classList.toggle('accent',!s.slices.length);$('load').disabled=loading;
 $('align').disabled=busy||!stemsReady()||s.slices.length<2;
 $('align').textContent=aligning?'Aligning…':s.aligned?'Align again · reset refinements':'Align leaf ends';
 $('align').classList.toggle('accent',ok&&!s.aligned||stale());
 $('prepareBackground').disabled=busy||!s.slices.length||ok;
 $('prepareBackground').textContent=masking?'Removing background…':ok?'Background removed ✓':'Remove background';
 $('prepareBackground').classList.toggle('accent',!ok&&!!s.slices.length);
 $('count').textContent=s.slices.length;
 $('maskStatus').textContent=masking?'Preparing leaf boundaries… Keep this page open.':!s.slices.length?'Load scans first.':ok?'Ready · Inspect the cut-out before Align.':s.background.enabled?'Mask settings changed. Remove background again; placement retained.':'Required before Align.';
 for(const k of ['curve','highlight']){$(k).disabled=!ok||$('mode').value==='merged';setHelp($(k),$('mode').value==='merged'?'Unavailable in merged view: switch to Photo or Heightmap.':ok?'':'First remove background in step 2.');}
 $('source').disabled=!ok||$('mode').value==='merged';$('source').checked=!ok||showSource;
 setHelp($('source'),$('mode').value==='merged'?'Unavailable in merged view: switch to Photo or Heightmap.':ok?'':'Original background is shown until step 2 is complete.');
 $('alignmentStatus').textContent=!ok?'First remove background in step 2.':!stemsReady()?'Compute current slice stems in step 3.':s.slices.length<2?'Load at least two slices to join.':stale()?'Setup changed · placement retained. Align again when ready.':s.aligned?'Aligned · refine the selected joint.':'Inspect stems, then Align.';
 $('empty').hidden=!!s.slices.length;
 $('status').textContent=merging?'Merging raw foreground heights…':$('mode').value==='merged'?(mergeStale?'Stale merged result · edit slices or Merge again':'Merged maximum heights · switch to Photo / Heightmap to inspect slices'):loading?'Loading native photo + TMD…':masking?'Removing background…':aligning?'Fitting curves and aligning leaf ends…':preparing?`Preparing preview (${preparing}) · placement unchanged`:!s.slices.length?'Start: add scan folders':!ok?'Next: remove background':stale()?'Setup changed · Align again to apply':s.aligned?'Aligned · inspect and refine joints':'Next: inspect boundaries, then Align';
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
 $('slices').innerHTML=state.slices.map((s,i)=>`<div class="card ${s.id===selected?'selected':''}" data-index="${i}" draggable="true" tabindex="0" role="button" aria-label="Select slice ${i+1}" title="${esc(s.path)}"><div class="cardName"><b>${i+1}</b>${esc(name(s))}</div><small>${s.angle}°${s.reverse?' · ends swapped':''}</small><div class="cardControls"><button class="remove" aria-label="Remove slice ${i+1}">Remove</button><button class="up" aria-label="Move slice ${i+1} up" ${i===0?'disabled':''}>↑</button><button class="down" aria-label="Move slice ${i+1} down" ${i===state.slices.length-1?'disabled':''}>↓</button></div></div>`).join('');
 for(const card of $('slices').children){const i=+card.dataset.index,s=state.slices[i];const select=()=>selectSlice(s.id);card.onclick=e=>{if(!e.target.closest('button'))select();};card.onkeydown=e=>{if(e.key==='Enter')select();};card.querySelector('.up').onclick=()=>edit(st=>reorder(st,i,i-1));card.querySelector('.down').onclick=()=>edit(st=>reorder(st,i,i+1));card.querySelector('.remove').onclick=()=>edit(st=>{st.slices.splice(i,1);arrange(st);});card.ondragstart=()=>dragId=s.id;card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();edit(st=>reorder(st,st.slices.findIndex(s=>s.id===dragId),i));};}
 const index=state.slices.findIndex(s=>s.id===selected),s=state.slices[index];$('inspector').hidden=!s;if(!s)$('sliceFit').innerHTML='';
 if(s){const values=effective(state,s);$('inspector').innerHTML=`<h3>Slice ${index+1}</h3><label class="field">Angle ° <input id="angle" type="number" min="-3600" max="3600" step="any" value="${s.angle}"></label><input id="angleSlider" aria-label="Rotation slider" type="range" min="-180" max="180" step=".1" value="${s.angle}"><label><input id="mirrorH" type="checkbox" ${s.mirrorH?'checked':''}> Mirror H</label> <label><input id="mirrorV" type="checkbox" ${s.mirrorV?'checked':''}> Mirror V</label><label class="block"><input id="reverse" type="checkbox" ${s.reverse?'checked':''}> Swap incoming / outgoing ends</label>`; $('sliceFit').innerHTML=`<h3>Slice ${index+1} fit</h3>${['top','degree'].map(k=>`<div class="field"><label for="local-${k}">${k==='top'?'Top %':'Degree'}</label><input id="local-${k}" type="number" min="${k==='top'?'.001':'1'}" max="${k==='top'?'100':'8'}" step="${k==='top'?'any':'1'}" value="${values[k]}" ${s[k+'Locked']?'disabled':''}><button id="lock-${k}">${s[k+'Locked']?'Locked':'Unlocked'}</button></div>`).join('')}<div class="fitinfo">Native ${s.dimensions.join(' × ')} pixels<br>Height display ${s.height_range_mm.map(v=>v.toFixed(4)).join(' … ')} mm<br>Black = minimum; white = maximum, per slice.</div>`;
 for(const k of ['top','degree']){numeric($('local-'+k),(st,v)=>{st.slices.find(s=>s.id===selected)[k]=v;},{scientific:true,min:k==='top'?.001:1,max:k==='top'?100:8,integer:k==='degree'});$('lock-'+k).onclick=()=>edit(st=>{const item=st.slices.find(s=>s.id===selected);item[k]=st.shared[k];item[k+'Locked']=!item[k+'Locked'];});}
 numeric($('angle'),(st,v)=>{orient(st,st.slices.findIndex(s=>s.id===selected),{angle:v});$('angleSlider').value=v;},{min:-3600,max:3600});
 numeric($('angleSlider'),(st,v)=>{orient(st,st.slices.findIndex(s=>s.id===selected),{angle:v});$('angle').value=v;},{min:-180,max:180});
 for(const k of ['mirrorH','mirrorV'])$(k).onchange=e=>edit(st=>orient(st,st.slices.findIndex(s=>s.id===selected),{[k]:e.target.checked}));
 $('reverse').onchange=e=>edit(st=>{st.slices.find(s=>s.id===selected).reverse=e.target.checked;});
 }
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
 const snapshot=structuredClone(store.state),revision=store.revision;computingStems=true;error();status();
 try{await Promise.all(snapshot.slices.map(s=>prepare(s,snapshot)));if(revision!==store.revision)throw Error('Setup changed; compute again.');store.edit(st=>{for(const s of st.slices){s.computedFitKey=fitKey(s,st);delete s.manualResult;}});layers.curve=true;$('curve').checked=true;refresh();}
 catch(e){error('Stem computation failed: '+e.message);}finally{computingStems=false;status();}
}
async function removeBackground(){
 if(masking||loading||aligning||!store.state.slices.length)return;
 store.end();if([...$('backgroundStep').querySelectorAll('input')].some(e=>!e.validity.valid||e.value==='')){error('Correct mask parameters before removing background.');return;}
 const snapshot=structuredClone(store.state),revision=store.revision;masking=true;error();status();
 try{await Promise.all(snapshot.slices.map(s=>prepareMask(s,snapshot)));
 if(revision!==store.revision){error('Setup changed during preparation. Press Remove background again.');return;}
 store.edit(st=>{st.background.enabled=true;});showSource=false;refresh();
 }catch(e){error('Background removal failed; placement retained. Check mask parameters and retry. '+e.message);}
 finally{masking=false;status();}
}
async function doMerge(){
 if(merging||loading||aligning||masking||!ready()||!store.state.aligned)return;
 store.end();if([...document.querySelectorAll('#loadStep input[type=number]:not(:disabled), #backgroundStep input[type=number]:not(:disabled), #alignmentStep input[type=number]:not(:disabled), #jointSection input[type=number]:not(:disabled)')].some(e=>e.value===''||!e.validity.valid)){error('Correct numeric values before Merge.');return;}
 const snapshot=structuredClone(store.state),revision=store.revision;
 const payload={background:parameters(snapshot),slices:snapshot.slices.map(s=>({path:s.path,pose:s.pose,mask_key:masks.get(maskKey(s,snapshot)).key}))};
 merging=true;mergeError='';error();status();
 try{const r=await api('/api/merge',payload);await image(r.asset);
 if(revision!==store.revision){error('Merge discarded: setup changed during computation. Merge again.');return;}
 merged=r;mergeRevision=revision;post.clearPreview();$('mode').value='merged';draw();
 }catch(e){mergeError=e.message;error('Merge failed; slices and last result retained. '+e.message);}
 finally{merging=false;status();}
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
  const items=store.state.slices.map(s=>{const m=ready()&&!$('source').checked?maskResult(s):null,url=m?m.assets.photo:s.assets.photo;return {...s,url,image:images.get(url)};}).filter(s=>s.image);
  const blended=photoBlend.get(items);if(blended){const sc=ratio*camera.scale;ctx.setTransform(sc,0,0,sc,ratio*camera.x,ratio*camera.y);ctx.drawImage(blended.canvas,...blended.lo,...blended.extent);}
 }
 for(const s of store.state.slices){const A=s.pose.matrix,r=ready()?result(s):null,m=ready()?maskResult(s):null,displayMask=$('source').checked?null:m,sc=ratio*camera.scale;ctx.setTransform(sc*A[0][0],sc*A[1][0],sc*A[0][1],sc*A[1][1],ratio*(camera.x+camera.scale*s.pose.shift[0]),ratio*(camera.y+camera.scale*s.pose.shift[1]));const base=$('mode').value==='height'?heightImage(s,displayMask):null;if(base)ctx.drawImage(base,0,0,...s.dimensions);if(r&&layers.highlight){ctx.imageSmoothingEnabled=false;ctx.drawImage(images.get(r.assets.improved.highlight),-.5,-.5,...s.dimensions);ctx.imageSmoothingEnabled=true;}if(r&&(layers.curve||($('editSliceCurve').checked&&s.id===selected))){ctx.setTransform(ratio,0,0,ratio,0,0);const map=p=>screen(transformed(s,p));paintCurve(ctx,r,map,{preview:sliceGesture?.slice.id===s.id?sliceGesture.handles:null});}}
 ctx.setTransform(ratio,0,0,ratio,0,0);for(const [i,s] of store.state.slices.entries()){const p=corners(s).map(screen);ctx.strokeStyle=s.id===selected?'#ff0088':'#ffffff';ctx.lineWidth=s.id===selected?3:1;ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.closePath();ctx.stroke();const [x,y]=p[0];ctx.fillStyle=s.id===selected?'#ff0088':'#fff';ctx.fillRect(x,y,24,21);ctx.fillStyle='#000';ctx.font='bold 12px system-ui';ctx.fillText(String(i+1),x+7,y+15);}
 if(layers.curve&&ready())for(const [si,s] of store.state.slices.entries()){const r=result(s);if(!r)continue;for(const [i,p] of r.geometry.ends.entries()){const q=screen(transformed(s,p)),incoming=s.reverse?i===1:i===0;ctx.fillStyle=incoming?'#00ffc8':'#ff0088';ctx.beginPath();ctx.arc(...q,4,0,Math.PI*2);ctx.fill();ctx.font='11px system-ui';if(!store.state.aligned||(incoming?si===0:si===store.state.slices.length-1))ctx.fillText(incoming?'in':'out',q[0]+7,q[1]-7);}}
 for(const [i,j] of store.state.joints.entries()){const p=screen(j.pivot);ctx.beginPath();ctx.arc(...p,5,0,Math.PI*2);ctx.strokeStyle=i===selectedJoint?'#ff0088':'#fff';ctx.lineWidth=2;ctx.stroke();if(layers.curve){ctx.fillStyle='#fff';ctx.font='11px system-ui';ctx.fillText(`${i+1}→${i+2}`,p[0]+8,p[1]-9);}}
 post.paintOverlays(ctx,ratio,camera);
 if($('editSliceCurve').checked){const s=store.state.slices.find(s=>s.id===selected),r=s&&result(s);if(r){ctx.setTransform(ratio,0,0,ratio,0,0);paintHandles(ctx,sliceGesture?.handles||handlesFor(r),p=>screen(transformed(s,p)));}}
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
  $('folderEntries').innerHTML=v.entries.map((e,i)=>`<div class="folderRow" data-i="${i}"><input id="scan-folder-${i}" type="checkbox" ${e.valid?'':'disabled'} ${folderSelection.has(e.path)?'checked':''}><label for="scan-folder-${i}">${esc(e.name)}${e.error||!e.valid?`<small>${esc(e.error||'Not a scan folder')}</small>`:''}</label></div>`).join('')||'<p>No subfolders; go up to select this scan.</p>';
  for(const row of $('folderEntries').children){if(row.dataset.i===undefined)continue;const e=v.entries[+row.dataset.i];row.querySelector('input').onchange=event=>{if(event.target.checked)folderSelection.set(e.path,e);else folderSelection.delete(e.path);selectionCount();};}
  selectionCount();
 }catch(e){if(generation!==browseGeneration)return;$('folderError').textContent=e.message;if(folderRoot)$('folderPath').value=folderRoot;}
}
$('add').onclick=()=>{folderSelection.clear();selectionCount();for(const input of $('folderEntries').querySelectorAll('input'))input.checked=false;$('folders').showModal();browse();};$('folders').onclose=()=>{++browseGeneration;};$('closeFolders').onclick=()=>$('folders').close();$('parent').onclick=()=>browse(folderParent);$('browse').onclick=()=>browse($('folderPath').value);$('folderPath').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();browse(e.target.value);}};
$('load').onclick=async()=>{if(loading)return;const paths=[...folderSelection.keys()].filter(p=>!store.state.slices.some(s=>s.id===p));if(!paths.length){error('Select at least one new scan folder.');return;}if(paths.length+store.state.slices.length>30){error('Maximum 30 slices.');return;}store.end();const revision=store.revision;loading=true;error();$('folders').close();status();try{const loaded=[];for(const path of paths){const r=await api('/api/load',{path});await Promise.all(Object.values(r.assets).map(image));loaded.push(r);}if(revision!==store.revision){error('Load discarded: setup changed while decoding. Load again.');return;}store.edit(st=>addSlices(st,loaded));refresh();fitView();}catch(e){error('Load failed; existing arrangement retained. '+e.message);}finally{loading=false;status();}};
for(const [id,k] of [['sharedTop','top'],['sharedDegree','degree'],['sharedOverlap','overlap']])numeric($(id),(st,v)=>{st.shared[k]=v;},{scientific:k!=='overlap',min:k==='top'?.001:k==='degree'?1:-50,max:k==='top'?100:k==='degree'?8:50,integer:k==='degree'});
$('merge').onclick=doMerge;
$('align').onclick=doAlign;$('undo').onclick=()=>{store.undo();error();refresh();};$('redo').onclick=()=>{store.redo();error();refresh();};$('fit').onclick=fitView;
$('prepareBackground').onclick=removeBackground;
 $('computeSliceStems').onclick=computeSliceStems;
 $('editSliceCurve').onchange=()=>{$('resetSliceCurve').hidden=!$('editSliceCurve').checked;$('mergedEditControls').hidden=true;if($('editSliceCurve').checked){$('editMergedCurve').checked=false;layers.curve=true;$('curve').checked=true;}draw();};
 $('resetSliceCurve').onclick=()=>edit(st=>{delete st.slices.find(s=>s.id===selected).manualResult;});
$('source').onchange=e=>{showSource=e.target.checked;draw();};
for(const [k,min,max,integer] of [['threshold',50,99.99,false],['closing',0,30,true],['core',1,40,true],['halo',1,40,true],['iterations',1,20,true]])numeric($('bg-'+k),(st,v)=>{st.background[k]=v;},{scientific:true,min,max,integer});
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
function beginSlice(e){if(curveBusy||!$('editSliceCurve').checked||$('mode').value==='merged')return false;const s=store.state.slices.find(s=>s.id===selected),r=s&&result(s);if(!r)return false;const h=handlesFor(r),b=canvas.getBoundingClientRect(),map=p=>transformed(s,p).map((v,k)=>v*camera.scale+(k?camera.y:camera.x)),index=hitHandle(h,map,[e.clientX-b.left,e.clientY-b.top]);if(index<0)return false;store.end();sliceGesture={id:e.pointerId,slice:structuredClone(s),r,handles:structuredClone(h),index,revision:store.revision,start:nativePointer(e,s),moved:false};canvas.setPointerCapture(e.pointerId);return true;}
async function finishSlice(e){const g=sliceGesture;sliceGesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(!g.moved){draw();return;}curveBusy=true;status();try{const r=await api('/api/curve/edit',{kind:'slice',key:g.r.key,handles:g.handles});if(store.revision!==g.revision)throw Error('Setup changed; manual edit discarded.');store.edit(st=>{st.slices.find(s=>s.id===g.slice.id).manualResult=r;});error();refresh();}catch(e){error(e.message);draw();}finally{curveBusy=false;status();}}
canvas.onpointerdown=e=>{if(pointer||sliceGesture||e.button!==0)return;if(beginSlice(e)||post.pointerDown(e,camera))return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,cameraX:camera.x,cameraY:camera.y,dragging:false};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(sliceGesture){const g=sliceGesture,p=nativePointer(e,g.slice),h=handlesFor(g.r)[g.index];g.handles[g.index]=h.map((v,k)=>v+p[k]-g.start[k]);g.moved=true;draw();return;}if(post.pointerMove(e,camera))return;if(!pointer||e.pointerId!==pointer.id)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(dx,dy)>4)pointer.dragging=true;if(pointer.dragging){camera.x=pointer.cameraX+dx;camera.y=pointer.cameraY+dy;draw();}};
canvas.onpointerup=e=>{if(sliceGesture){finishSlice(e);return;}if(post.pointerUp(e,camera))return;if(!pointer||e.pointerId!==pointer.id)return;const click=!pointer.dragging&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)<=4;pointer=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(click){const id=sliceAt(e.clientX,e.clientY);if(id)selectSlice(id);}};
canvas.onpointercancel=canvas.onlostpointercapture=()=>{pointer=null;if(sliceGesture){sliceGesture=null;draw();}post.pointerCancel();};
installHelp();
const post=postMerge({get:()=>({merged,mergeRevision,revision:store.revision,merging,mode:$('mode').value}),api,image,images,draw,error});
window.postDebug=()=>post.debug();
new ResizeObserver(draw).observe($('stage'));
window.stitcherDebug=()=>({state:structuredClone(store.state),selected,merging,merged,mergeRevision,mergeStale:!!merged&&mergeRevision!==store.revision,revision:store.revision,undo:store.past.length,redo:store.future.length,loading,aligning,masking,ready:ready(),stemsReady:stemsReady(),computingStems,curveBusy,editHandles:store.state.slices.find(s=>s.id===selected)&&result(store.state.slices.find(s=>s.id===selected))?handlesFor(result(store.state.slices.find(s=>s.id===selected))):null,stale:stale(),preparing,mode:$('mode').value,masks:Object.fromEntries(store.state.slices.filter(s=>maskResult(s)).map(s=>[s.id,maskResult(s)])),layers:{...layers},camera:{...camera},images:images.size,results:Object.fromEntries(store.state.slices.filter(s=>result(s)).map(s=>[s.id,result(s)]))});
refresh();