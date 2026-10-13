"""Leaf outline of the current merge, and the user-edited leaf region derived from it.

The original outline is the outer boundary of the merged valid mask, traced through boundary
cell centres on the native merged grid ((column,row), y down). Editing (smoothing, redrawn
sections) happens in outline.mjs; this module only validates and rasterizes the edited rings.

Edited leaf region = (valid & inside(edited)) | (inside(edited) & ~inside(original)):
inside the original outline the measured mask is kept as is (holes preserved) except where the
edit cuts it away; outside it, cells enclosed by the edit are added even without height data
(e.g. a filled seam notch). `inside` = OpenCV fillPoly plus the ring's own boundary line at 1/256 px,
which reproduces the mask exactly for the unedited outline. Without an outline key everything downstream uses the
original merged mask unchanged.
"""
import json
import time
import numpy as np
import cv2
import engine
import merge

OUTLINES=set()
MAX_POINTS=400_000
POLICY=('edited region = (merged valid & inside edited outline) | (inside edited outline & outside original outline); '
        'inside = OpenCV fillPoly + boundary line at 1/256 px; cells added without height data count as flat area')


def trace(valid):
 """Outer rings of a boolean mask as float (N,2) arrays of boundary cell centres."""
 cs,_=cv2.findContours(np.ascontiguousarray(valid,np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
 return [c[:,0,:].astype(np.float64) for c in sorted(cs,key=lambda c:-cv2.contourArea(c))]


def inside(rings,shape):
 out=np.zeros(shape,np.uint8)
 # One fill per ring and OR: a joint fillPoly would XOR rings that overlap after editing.
 for r in rings:
  if not len(r):continue
  p=np.round(np.asarray(r,np.float64)*256).astype(np.int64)
  lo=np.maximum((p.min(0)>>8)-1,0);hi=np.minimum((p.max(0)>>8)+2,[shape[1],shape[0]])
  if (hi<=lo).any():continue
  ring=np.zeros((hi[1]-lo[1],hi[0]-lo[0]),np.uint8)
  q=[(p-(lo<<8)).astype(np.int32).reshape(-1,1,2)]
  # The polygon through boundary cell centres plus its own 8-connected boundary line: the
  # unedited outline then reproduces the mask exactly, including 1–2 cell specks.
  if len(p)>=3:cv2.fillPoly(ring,q,1,lineType=cv2.LINE_8,shift=8)
  cv2.polylines(ring,q,True,1,1,lineType=cv2.LINE_8,shift=8)
  out[lo[1]:hi[1],lo[0]:hi[0]]|=ring
 return out.astype(bool)


def region(valid,original,edited):
 a=inside(edited,valid.shape);o=inside(original,valid.shape)
 return (valid&a)|(a&~o)


def _merge(key):
 if not isinstance(key,str) or key not in merge.MERGES:raise ValueError('Current registered merge required; Merge again')
 return json.loads((engine.CACHE/'merges'/key/'meta.json').read_text())


def _valid(key):
 with np.load(engine.CACHE/'merges'/key/'raw.npz',allow_pickle=False) as data:return data['valid_mask']&np.isfinite(data['height_mm'])


def original(body):
 """Original outer rings of the current merge, native merged px."""
 key=body.get('merge_key');mm=_merge(key)
 deps=dict(kind='original',merge_key=key,algorithm_sha256=engine.digest(engine.HERE/'outline.py'))
 okey=engine.signature(deps);dest=engine.CACHE/'outlines'/okey
 if not (dest/'meta.json').exists():
  rings=trace(_valid(key))
  meta={**deps,'key':okey,'rings':[r.astype(int).ravel().tolist() for r in rings],'units':'native merged px (column,row centres, y down)'}
  dest.mkdir(parents=True,exist_ok=True);(dest/'meta.json').write_text(json.dumps(meta))
 meta=json.loads((dest/'meta.json').read_text())
 return {**meta,'spacing_mm':mm['spacing_mm'],'origin_center_mm':mm['origin_center_mm'],'dimensions':mm['dimensions']}


def parse_rings(value,shape):
 if not isinstance(value,list) or not 1<=len(value)<=10_000:raise ValueError('Outline must have 1–10,000 rings')
 out=[];total=0;h,w=shape
 for r in value:
  if not isinstance(r,list) or len(r)%2 or len(r)<2:raise ValueError('Each outline ring needs at least one point')
  a=np.asarray(r,np.float64).reshape(-1,2);total+=len(a)
  if total>MAX_POINTS:raise ValueError('Outline has too many points')
  if not np.isfinite(a).all() or (a<-w-h).any() or (a[:,0]>2*w+h).any() or (a[:,1]>2*h+w).any():raise ValueError('Outline points must be finite and near the merged grid')
  out.append(a)
 return out


def edit(body):
 """Register an edited outline; returns its key and region statistics."""
 key=body.get('merge_key');mm=_merge(key)
 sigma=engine.number(body.get('smoothing_mm',0),0,10,'Smoothing mm')
 sections=engine.number(body.get('redrawn_sections',0),0,10_000,'Redrawn sections',True)
 shape=tuple(mm['dimensions'][::-1]);rings=parse_rings(body.get('rings'),shape)
 orig=original(dict(merge_key=key))
 deps=dict(kind='edited',merge_key=key,original_key=orig['key'],smoothing_mm=sigma,redrawn_sections=sections,
           rings_sha256=engine.signature([np.round(r,4).ravel().tolist() for r in rings]),algorithm_sha256=engine.digest(engine.HERE/'outline.py'))
 okey=engine.signature(deps);dest=engine.CACHE/'outlines'/okey
 if (dest/'meta.json').exists():
  OUTLINES.add(okey);return {**_public(json.loads((dest/'meta.json').read_text())),'cache_hit':True}
 start=time.monotonic();valid=_valid(key)
 o=[np.asarray(r,np.float64).reshape(-1,2) for r in orig['rings']]
 reg=region(valid,o,rings);r=mm['spacing_mm'][0];origin=np.asarray(mm['origin_center_mm'])
 cells=int(reg.sum());without=int((reg&~valid).sum());removed=int((valid&~reg).sum())
 dest.mkdir(parents=True,exist_ok=True)
 np.savez_compressed(dest/'region.npz',region=np.packbits(reg),shape=np.asarray(reg.shape))
 meta={**deps,'key':okey,'cache_hit':False,'cells':cells,'cells_without_height':without,'cells_removed':removed,'original_cells':int(valid.sum()),
       'cell_mm':r,'region_area_mm2':cells*r*r,'policy':POLICY,'seconds':round(time.monotonic()-start,3),
       'rings_mm':[(a*r+origin).ravel().tolist() for a in rings],'units':'rings_mm: merged world mm (x right, y down)'}
 (dest/'meta.json').write_text(json.dumps(meta));OUTLINES.add(okey)
 return _public(meta)


def _public(meta):
 """Response without the mm ring copy (kept in meta.json for exports; the browser has the rings)."""
 return {k:v for k,v in meta.items() if k!='rings_mm'}


def load_region(okey,merge_key):
 """Edited leaf region for downstream measurement, checked against its merge."""
 if not isinstance(okey,str) or okey not in OUTLINES:raise ValueError('Current edited outline required; edit the outline again')
 dest=engine.CACHE/'outlines'/okey;meta=json.loads((dest/'meta.json').read_text())
 if meta['kind']!='edited' or meta['merge_key']!=merge_key:raise ValueError('Edited outline belongs to another merge')
 with np.load(dest/'region.npz',allow_pickle=False) as data:
  shape=tuple(int(v) for v in data['shape']);return np.unpackbits(data['region'],count=shape[0]*shape[1]).reshape(shape).astype(bool)


def optional_key(value):
 if value is None:return None
 if not isinstance(value,str) or value not in OUTLINES:raise ValueError('Current edited outline required; edit the outline again')
 return value
