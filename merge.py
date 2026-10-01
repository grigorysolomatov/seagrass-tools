"""Raw-height maximum mosaic. Native integer coordinates are pixel centres.

Nearest-neighbour inverse sampling (floor(u + .5)) uses the SAME index for
height and foreground. No interpolation across masked edges, no normalization,
levelling or blending. Uncovered/nonfinite samples are NaN, not zero. World y
points down, consistently with native rows and the canvas. Grid centres are
integer multiples of the smallest source spacing; bounds enclose native support.
"""
import json
import math
import time
import numpy as np
from PIL import Image
import engine
from science import decode

MAX_CELLS=80_000_000
MAX_SIDE=40_000
MERGES=set()

def validate_pose(pose):
 a=np.asarray(pose['matrix'],dtype=float);t=np.asarray(pose['shift'],dtype=float)
 if a.shape!=(2,2) or t.shape!=(2,) or not np.isfinite(a).all() or not np.isfinite(t).all():
  raise ValueError('Pose must be finite 2×2 matrix and 2-vector shift')
 sv=np.linalg.svd(a,compute_uv=False)
 if sv[-1]<1e-9 or sv[0]>100 or np.max(np.abs(t))>1e6:
  raise ValueError('Pose is singular or outside supported physical bounds')
 return a,t

def grid_for(shapes_poses,resolution):
 r=float(resolution)
 if not math.isfinite(r) or r<=0:raise ValueError('Grid resolution must be positive and finite')
 bounds=[]
 for shape,pose in shapes_poses:
  h,w=shape;a,t=validate_pose(pose)
  if h<1 or w<1:raise ValueError('Empty height map')
  bounds.extend(np.array([[-.5,-.5],[w-.5,-.5],[w-.5,h-.5],[-.5,h-.5]])@a.T+t)
 if not bounds:raise ValueError('No source heightmaps')
 bounds=np.asarray(bounds);lo=np.floor(bounds.min(0)/r+.5)*r
 size=np.ceil((bounds.max(0)-lo)/r+.5-1e-9).astype(np.int64)
 if np.any(size<1) or np.any(size>MAX_SIDE) or int(size[0])*int(size[1])>MAX_CELLS:
  raise ValueError('Merged grid exceeds 80 million cells or 40,000 pixels per side; reduce spread/rotation')
 return {'origin_center_mm':lo.tolist(),'spacing_mm':[r,r],'dimensions':size.tolist(),
         'units':'mm','interpolation':'nearest; floor(native + 0.5); same height/mask index',
         'invalid':'NaN; valid_mask excludes uncovered, nonfinite and background',
         'pixel_coordinates':'native integer column,row are centres; world y increases downward'}

def accumulate(out,z,mask,pose,meta):
 z=np.asarray(z);mask=np.asarray(mask)
 if z.ndim!=2 or mask.shape!=z.shape or mask.dtype!=np.bool_:raise ValueError('Height/mask shape mismatch or nonboolean mask')
 a,t=validate_pose(pose);inv=np.linalg.inv(a);h,w=z.shape
 r=meta['spacing_mm'][0];ox,oy=meta['origin_center_mm'];width=out.shape[1]
 xs=ox+np.arange(width)*r
 # At most ~1M inverse-map cells per chunk; source arrays are processed singly.
 rows=max(1,min(128,1_000_000//width))
 for start in range(0,len(out),rows):
  ys=oy+np.arange(start,min(start+rows,len(out)))*r
  u=np.floor(inv[0,0]*(xs[None,:]-t[0])+inv[0,1]*(ys[:,None]-t[1])+.5).astype(np.int64)
  v=np.floor(inv[1,0]*(xs[None,:]-t[0])+inv[1,1]*(ys[:,None]-t[1])+.5).astype(np.int64)
  inside=(u>=0)&(v>=0)&(u<w)&(v<h)
  np.clip(u,0,w-1,out=u);np.clip(v,0,h-1,out=v)
  sample=z[v,u];valid=inside & mask[v,u] & np.isfinite(sample)
  tile=out[start:start+len(ys)]
  np.fmax(tile,sample,out=tile,where=valid)

def merge_arrays(sources,resolution):
 meta=grid_for([(z.shape,pose) for z,mask,pose in sources],resolution)
 out=np.full(meta['dimensions'][::-1],np.nan,np.float32)
 for z,mask,pose in sources:accumulate(out,z,mask,pose,meta)
 return out,meta

def preview(z):
 valid=np.isfinite(z)
 if not valid.any():raise ValueError('Merged grid contains no valid foreground heights')
 lo=float(np.nanmin(z));hi=float(np.nanmax(z));h,w=z.shape
 factor=min(1,1800/max(h,w));size=(max(1,round(w*factor)),max(1,round(h*factor)))
 # Decimate raw values first, then ONE global stretch. Alpha retains no-data.
 small=np.asarray(Image.fromarray(z).resize(size,Image.Resampling.NEAREST))
 gray=np.clip((np.nan_to_num(small,nan=lo)-lo)/max(hi-lo,1e-12)*255,0,255).astype(np.uint8)
 im=Image.fromarray(gray).convert('RGBA');im.putalpha(Image.fromarray(np.isfinite(small).astype(np.uint8)*255))
 return im,[lo,hi],int(valid.sum())

def merge_request(body):
 items=body.get('slices')
 if not isinstance(items,list) or not 1<=len(items)<=30:raise ValueError('Merge requires 1–30 prepared slices')
 params=engine.validate_background(body.get('background',{}))
 if not params['enabled']:raise ValueError('Remove background before Merge')
 sources=[];seen=set();resolution=math.inf
 for item in items:
  folder,scan,cal,files,height=engine.inspect_source(item['path'])
  if str(folder) in seen:raise ValueError('Duplicate source')
  seen.add(str(folder));a,t=validate_pose(item['pose'])
  key=item.get('mask_key')
  if not isinstance(key,str) or key not in engine.MASKS:raise ValueError('Current prepared mask required')
  md=engine.CACHE/'masks'/key;maskmeta=json.loads((md/'meta.json').read_text())
  deps={'inputs':{p.name:engine.digest(p) for p in files},'algorithm_sha256':engine.digest(engine.HERE/'masking.py'),'parameters':params,'seed_top':5,'asset_version':1}
  if maskmeta['provenance']!=deps or engine.signature(deps)!=key:raise ValueError('Prepared mask does not match source/settings; prepare again')
  z,spacing=decode(height)
  # Accept rigid calibrated transforms, including reflections, not arbitrary rescaling/shear.
  if not np.allclose(a.T@a,np.diag(np.square(spacing)),rtol=1e-6,atol=1e-12):raise ValueError('Pose must preserve native physical calibration')
  with Image.open(md/'mask.png') as im:
   if im.size!=z.shape[::-1]:raise ValueError('Prepared mask dimensions do not match heightmap')
  sources.append({'path':str(folder),'height_file':str(height),'height_sha256':engine.digest(height),'mask_key':key,'mask_sha256':engine.digest(md/'mask.png'),'pose':{'matrix':a.tolist(),'shift':t.tolist()},'shape':list(z.shape),'spacing_mm':spacing})
  resolution=min(resolution,*spacing)
  del z
 meta=grid_for([(s['shape'],s['pose']) for s in sources],resolution)
 meta.update(sources=sources,algorithm_sha256=engine.digest(engine.HERE/'merge.py'))
 key=engine.signature(meta);dest=engine.CACHE/'merges'/key
 if (dest/'meta.json').exists():
  MERGES.add(key);return json.loads((dest/'meta.json').read_text())
 start=time.monotonic();out=np.full(meta['dimensions'][::-1],np.nan,np.float32)
 for source in sources:
  z,_=decode(engine.file_in(engine.safe_path(source['path']),engine.Path(source['height_file']).name))
  with Image.open(engine.CACHE/'masks'/source['mask_key']/'mask.png') as im:mask=np.asarray(im)>0
  accumulate(out,z,mask,source['pose'],meta)
  del z,mask
 im,limits,count=preview(out);meta.update(height_range_mm=limits,valid_cells=count)
 dest.mkdir(parents=True,exist_ok=True)
 np.savez_compressed(dest/'raw.npz',height_mm=out,valid_mask=np.isfinite(out),metadata=np.array(json.dumps(meta)))
 im.save(dest/'height.png')
 result={**meta,'key':key,'asset':f'/merge-asset/{key}/height.png','raw_artifact':str(dest/'raw.npz'),'seconds':round(time.monotonic()-start,3)}
 (dest/'meta.json').write_text(json.dumps(result));MERGES.add(key)
 return result
