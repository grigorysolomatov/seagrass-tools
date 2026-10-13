"""Leaf surface area in mm² on the merged physical grid.

Flat (projected) area = valid merged cells × cell area. 3D area weights each
cell by sqrt(1 + gx² + gy²): the area of the measured height surface above
that cell, including trichomes resolved by the height map. Gradients are taken
on each source's NATIVE grid (raw TMD heights in mm, TMD pixel pitch in mm) and
only between prepared-foreground neighbours, so leaf edge walls, gel
background and the height steps at seams between unlevelled slices never count
as surface. Each merged cell takes the slope of the source that supplied its
maximum height, so overlaps are counted once.
"""
import json
import time
import numpy as np
from PIL import Image
import engine
import merge
import postmerge
from science import decode

POLICY=('flat = valid merged cells × cell area; 3D = Σ cell area × sqrt(1+gx²+gy²); '
        'gradients on native source grids between prepared-foreground neighbours only '
        '(central where both neighbours, one-sided at the mask edge, 0 if isolated); '
        'edge walls, background and seams excluded; overlaps counted once (slope of the source supplying the maximum height)')


def _axis_gradient(z,mask,step,axis):
 """d z / d axis in mm/mm using only foreground neighbours along that axis."""
 z=np.moveaxis(np.asarray(z,np.float32),axis,0);m=np.moveaxis(np.asarray(mask,bool),axis,0)
 g=np.zeros(z.shape,np.float32)
 if z.shape[0]<2:return np.moveaxis(g,0,axis)
 prev=np.zeros(z.shape,bool);nxt=np.zeros(z.shape,bool)
 prev[1:]=m[1:]&m[:-1];nxt[:-1]=m[:-1]&m[1:]
 dprev=np.zeros(z.shape,np.float32);dnext=np.zeros(z.shape,np.float32)
 dprev[1:]=(z[1:]-z[:-1])/step;dnext[:-1]=(z[1:]-z[:-1])/step
 both=prev&nxt
 g[both]=(dprev[both]+dnext[both])/2
 g[prev&~nxt]=dprev[prev&~nxt];g[nxt&~prev]=dnext[nxt&~prev]
 return np.moveaxis(g,0,axis)


def slope_factor(z,mask,spacing):
 """Per-pixel surface/projected area ratio; 0 outside the mask."""
 mask=np.asarray(mask,bool)&np.isfinite(z)
 sx,sy=float(spacing[0]),float(spacing[1])
 gx=_axis_gradient(z,mask,sx,1);gy=_axis_gradient(z,mask,sy,0)
 f=np.sqrt(1+gx*gx+gy*gy);f[~mask]=0
 return f


def native_area(z,mask,spacing):
 """Flat and 3D area (mm²) of one source's prepared foreground on its own grid."""
 mask=np.asarray(mask,bool)&np.isfinite(z);cell=float(spacing[0])*float(spacing[1])
 return float(mask.sum())*cell,float(slope_factor(z,mask,spacing).sum(dtype=np.float64))*cell


def merged_area(merged,meta,sources):
 """sources: [(z, mask, pose, spacing)] exactly as merged. Returns (flat, 3D, cells).

 Sampling repeats merge.accumulate's nearest index floor(native + .5) so every
 merged cell is matched to the very source sample that produced its height.
 """
 merged=np.asarray(merged);valid=np.isfinite(merged)
 r=meta['spacing_mm'][0];ox,oy=meta['origin_center_mm'];height,width=merged.shape
 assigned=np.zeros(merged.shape,bool);total=0.
 xs=ox+np.arange(width)*r;rows=max(1,min(128,1_000_000//width))
 for z,mask,pose,spacing in sources:
  a,t=merge.validate_pose(pose);inv=np.linalg.inv(a);h,w=z.shape
  mask=np.asarray(mask,bool)&np.isfinite(z);factor=slope_factor(z,mask,spacing)
  for start in range(0,height,rows):
   ys=oy+np.arange(start,min(start+rows,height))*r
   u=np.floor(inv[0,0]*(xs[None,:]-t[0])+inv[0,1]*(ys[:,None]-t[1])+.5).astype(np.int64)
   v=np.floor(inv[1,0]*(xs[None,:]-t[0])+inv[1,1]*(ys[:,None]-t[1])+.5).astype(np.int64)
   inside=(u>=0)&(v>=0)&(u<w)&(v<h);np.clip(u,0,w-1,out=u);np.clip(v,0,h-1,out=v)
   tile=merged[start:start+len(ys)];done=assigned[start:start+len(ys)]
   take=inside&mask[v,u]&~done&(z[v,u]==tile)
   total+=float(factor[v,u][take].sum(dtype=np.float64));done|=take
 cells=int(valid.sum())
 if int((assigned&valid).sum())!=cells:raise ValueError('Merged cells could not be matched to their source heights; Merge again')
 return cells*r*r,total*r*r,cells


def calibration(sources):
 """Pixel pitch per source from the TMD header, checked against scan.yaml when present."""
 out=[]
 for s in sources:
  sx,sy=s['spacing_mm'];note=None
  try:
   scan=engine.inspect_source(s['path'])[1];stated=scan.get('mmperpixel')
   if isinstance(stated,(int,float)) and stated>0:note=max(abs(sx-stated),abs(sy-stated))/stated
  except Exception:pass
  out.append(dict(path=s['path'],pixel_mm=[sx,sy],scan_yaml_relative_difference=note))
 return out


def request(body):
 key=body.get('merge_key')
 if not isinstance(key,str) or key not in merge.MERGES:raise ValueError('Current registered merge required; Merge again')
 mm=json.loads((engine.CACHE/'merges'/key/'meta.json').read_text())
 postmerge.source_cohort(mm,20,validate_only=True)  # sources and masks unchanged since Merge
 deps=dict(merge_key=key,algorithm_sha256=engine.signature([engine.digest(engine.HERE/'area.py'),engine.digest(engine.HERE/'merge.py')]))
 akey=engine.signature(deps);dest=engine.CACHE/'areas'/akey
 if (dest/'meta.json').exists():return {**json.loads((dest/'meta.json').read_text()),'cache_hit':True}
 start=time.monotonic()
 with np.load(engine.CACHE/'merges'/key/'raw.npz',allow_pickle=False) as data:merged=data['height_mm']
 sources=[];slices=[]
 for s in mm['sources']:
  z,spacing=decode(engine.file_in(engine.safe_path(s['path']),engine.Path(s['height_file']).name))
  with Image.open(engine.CACHE/'masks'/s['mask_key']/'mask.png') as im:mask=np.asarray(im)>0
  flat,surface=native_area(z,mask,spacing)
  slices.append(dict(path=s['path'],flat_mm2=flat,surface_mm2=surface,pixel_mm=spacing))
  sources.append((z,mask,s['pose'],spacing))
 flat,surface,cells=merged_area(merged,mm,sources);del sources,merged
 meta={**deps,'key':akey,'cache_hit':False,'units':'mm²','flat_mm2':flat,'surface_mm2':surface,'ratio':surface/flat if flat else None,
       'cells':cells,'cell_mm':mm['spacing_mm'][0],'height_units':'mm (raw TMD)','calibration':calibration(mm['sources']),
       'slices':slices,'policy':POLICY,'seconds':round(time.monotonic()-start,3)}
 dest.mkdir(parents=True,exist_ok=True);(dest/'meta.json').write_text(json.dumps(meta))
 return meta


def csv_text(meta,candidates=None):
 """Area table; optional current candidate count adds densities per mm²."""
 from csv_exports import number,table
 rows=[['leaf_flat_area','merged',number(meta['flat_mm2']),'mm2'],['leaf_3d_area','merged',number(meta['surface_mm2']),'mm2'],
       ['area_ratio_3d_to_flat','merged',number(meta['ratio']),''],['merged_cell_size','merged',number(meta['cell_mm']),'mm']]
 if candidates is not None:
  rows+=[['trichome_candidates','merged',str(int(candidates)),'count'],['candidates_per_flat_area','merged',number(candidates/meta['flat_mm2']),'1/mm2'],
         ['candidates_per_3d_area','merged',number(candidates/meta['surface_mm2']),'1/mm2']]
 for i,(s,c) in enumerate(zip(meta['slices'],meta['calibration']),1):
  name=engine.Path(s['path']).name
  rows+=[['slice_flat_area',f'{i} {name}',number(s['flat_mm2']),'mm2'],['slice_3d_area',f'{i} {name}',number(s['surface_mm2']),'mm2'],
         ['slice_pixel_size_x',f'{i} {name}',number(c['pixel_mm'][0]),'mm'],['slice_pixel_size_y',f'{i} {name}',number(c['pixel_mm'][1]),'mm']]
 return table(['quantity','scope','value','unit'],rows)


def export(body):
 from csv_exports import filename
 name=filename(body.get('filename'));meta=request(body);count=None
 pk=body.get('peaks_key')
 if pk is not None:
  if not isinstance(pk,str) or pk not in postmerge.ARTIFACTS:raise ValueError('Current registered candidates required')
  pm=json.loads((engine.CACHE/'postmerge'/pk/'meta.json').read_text())
  if pm['kind']!='peaks' or pm['merge_key']!=meta['merge_key']:raise ValueError('Candidates belong to another merge')
  count=pm['count']
 return dict(filename=name,csv=csv_text(meta,count),candidates=count,units='mm²')
