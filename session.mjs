// Saved session file: how the slices relate, not derived arrays. Pure functions
// (no DOM) so the format is testable in node. The server checks the scans
// (sizes + SHA-256 of every input file, see session.py); everything derived is
// recomputed from them on open, with poses restored exactly instead of re-aligned.
export const FORMAT='seagrass-tools-session',VERSION=1;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const pair=v=>Array.isArray(v)&&v.length===2&&v.every(finite);
const matrix=m=>Array.isArray(m)&&m.length===2&&m.every(pair);
const SLICE_FIELDS=['angle','mirrorH','mirrorV','reverse','top','degree','topLocked','degreeLocked'];

// scans: records from POST /api/session/describe, in slice order.
// extra: {steps, post, results} gathered by the app (plain JSON values).
// edited[i]: Bézier handles of slice i's current edited automatic curve, or null.
export function buildSession(state,scans,{steps={},post=null,results={},edited=[],alignedCurrent=false,savedAt=new Date().toISOString()}={}){
 if(scans.length!==state.slices.length)throw Error('Scan records do not match the loaded slices');
 const {enabled,...background}=state.background;
 return {format:FORMAT,version:VERSION,saved:savedAt,
  note:'Seagrass Tools session. Open it with "Open session…" while the same scan folders are under the data root; files are checked by size and SHA-256.',
  setup:{shared:{...state.shared},background,aligned:!!state.aligned,alignedCurrent:!!(state.aligned&&alignedCurrent),
   joints:state.aligned?state.joints.map(j=>({along:j.along,across:j.across,angle:j.angle,pivot:[...j.pivot],axis:[...j.axis]})):[],
   slices:state.slices.map((s,i)=>{const out={scan:scans[i]};for(const k of SLICE_FIELDS)out[k]=s[k];
    out.pose={matrix:s.pose.matrix.map(r=>[...r]),shift:[...s.pose.shift]};if(s.anchor)out.anchor=[...s.anchor];
    if(s.handStem?.points?.length)out.handStem={points:s.handStem.points.map(p=>[...p])};
    if(edited[i])out.editedCurve={handles:edited[i].map(p=>[...p])};
    return out;})},
  steps:{background:!!steps.background,stems:!!steps.stems,merge:!!steps.merge},
  post,results};
}

// Throws a plain-language Error for anything that is not a usable v1 session.
export function parseSession(value){
 let v=value;if(typeof v==='string'){try{v=JSON.parse(v);}catch{throw Error('This file is not a Seagrass Tools session (not JSON).');}}
 if(!v||typeof v!=='object'||v.format!==FORMAT)throw Error('This file is not a Seagrass Tools session.');
 if(v.version!==VERSION)throw Error(`Session version ${v.version} is not supported (this tool reads version ${VERSION}).`);
 const st=v.setup;if(!st||typeof st!=='object')throw Error('Session has no setup.');
 const bad=what=>{throw Error('Session file is damaged: '+what+'.');};
 const sh=st.shared||{};if(!finite(sh.top)||!finite(sh.degree)||!finite(sh.overlap))bad('shared stem settings');
 for(const k of ['threshold','closing','core','halo','iterations'])if(!finite(st.background?.[k]))bad('mask settings');
 if(!Array.isArray(st.slices)||!st.slices.length||st.slices.length>30)bad('slice list');
 st.slices.forEach((s,i)=>{const at=`slice ${i+1} `;
  if(!s?.scan||typeof s.scan.folder!=='string'||typeof s.scan.name!=='string'||!s.scan.files||typeof s.scan.files!=='object')bad(at+'scan identity');
  for(const k of ['angle','top','degree'])if(!finite(s[k]))bad(at+k);
  for(const k of ['mirrorH','mirrorV','reverse','topLocked','degreeLocked'])if(typeof s[k]!=='boolean')bad(at+k);
  if(!matrix(s.pose?.matrix)||!pair(s.pose?.shift))bad(at+'pose');
  if(s.anchor!==undefined&&!pair(s.anchor))bad(at+'anchor');
  if(s.handStem!==undefined&&(!Array.isArray(s.handStem.points)||s.handStem.points.length<1||!s.handStem.points.every(pair)))bad(at+'hand-drawn stem');
  if(s.editedCurve!==undefined&&(!Array.isArray(s.editedCurve.handles)||s.editedCurve.handles.length<2||!s.editedCurve.handles.every(pair)))bad(at+'edited curve');
 });
 if(typeof st.aligned!=='boolean'||!Array.isArray(st.joints))bad('alignment');
 if(st.aligned&&st.joints.length!==st.slices.length-1)bad('joint count');
 for(const j of st.joints)if(!['along','across','angle'].every(k=>finite(j?.[k]))||!pair(j.pivot)||!pair(j.axis))bad('joint');
 const steps=v.steps||{};
 return {...v,steps:{background:!!steps.background,stems:!!steps.stems,merge:!!steps.merge}};
}

// Store state for the opened session. loads[i] = /api/load metadata of slice i.
export function sessionState(session,loads){
 const st=session.setup;
 return {shared:{...st.shared},background:{...st.background,enabled:false},aligned:st.aligned,joints:structuredClone(st.joints),
  slices:st.slices.map((s,i)=>{const out={...loads[i]};for(const k of SLICE_FIELDS)out[k]=s[k];out.pose=structuredClone(s.pose);
   if(s.anchor)out.anchor=[...s.anchor];if(s.handStem?.points?.length)out.handStem={points:structuredClone(s.handStem.points)};return out;})};
}

// Plain-language comparison of headline results (saved vs reopened). [] = identical.
// Numbers agree to 1e-9 relative (another machine's BLAS may differ in the last bits).
export function sameValue(a,b,tol=1e-9){
 if(typeof a==='number'&&typeof b==='number')return a===b||Math.abs(a-b)<=tol*Math.max(Math.abs(a),Math.abs(b));
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameValue(v,b[i],tol));
 if(a&&b&&typeof a==='object'&&typeof b==='object'){const k=Object.keys(a);return k.length===Object.keys(b).length&&k.every(x=>sameValue(a[x],b[x],tol));}
 return a===b;
}
export function compareResults(saved={},now={}){
 const out=[];
 const same=(a,b)=>sameValue(a,b);
 for(const [k,label] of [['merge','merged grid'],['leaf_area','leaf area'],['stem','combined stem'],['candidates','candidates'],['borders','leaf borders']])
  if(saved[k]!==undefined&&saved[k]!==null&&!same(saved[k],now[k]))out.push(label);
 return out;
}
export function sessionFilename(date=new Date()){const p=n=>String(n).padStart(2,'0');return `seagrass-session-${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;}
