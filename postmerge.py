"""Post-merge operations on measured mm, never display pixels."""
import warnings
import json
import time
from PIL import Image, ImageDraw
import engine
from science import foreground_selection
import merge

ARTIFACTS=set()
ASSETS={'curve.png','top.png','median.png','residual.png','points.bin'}

def request(kind,body):
 merge_key=body.get('merge_key')
 if not isinstance(merge_key,str) or merge_key not in merge.MERGES:raise ValueError('Current registered merge required; Merge again')
 if kind not in ['stem','residual','peaks']:raise ValueError('Unknown post-merge operation')
 params={}
 if kind=='stem':
  params=dict(top=engine.number(body.get('top'),0,100,'Top %',exclusive=True),degree=engine.number(body.get('degree'),1,8,'Degree',True))
 elif kind=='residual':
  params=dict(window=odd(body.get('window')),bits=engine.number(body.get('bits',12),1,16,'Bits',True))
 else:
  params=dict(window=odd(body.get('window',21)),residual_key=body.get('residual_key'))
  if params['residual_key'] not in ARTIFACTS:raise ValueError('Current registered residual required')
  prior=json.loads((engine.CACHE/'postmerge'/params['residual_key']/'meta.json').read_text())
  if prior['kind']!='residual' or prior['merge_key']!=merge_key:raise ValueError('Residual belongs to another merge')
 deps=dict(kind=kind,merge_key=merge_key,parameters=params,algorithm_sha256=engine.digest(engine.HERE/'postmerge.py'),selection_sha256=engine.digest(engine.HERE/'science.py'))
 key=engine.signature(deps);dest=engine.CACHE/'postmerge'/key
 mm=json.loads((engine.CACHE/'merges'/merge_key/'meta.json').read_text())
 if (dest/'meta.json').exists():
  if kind=='stem':source_cohort(mm,params['top'],validate_only=True)
  ARTIFACTS.add(key);return {**json.loads((dest/'meta.json').read_text()),'cache_hit':True}
 start=time.monotonic();dest.mkdir(parents=True,exist_ok=True)
 result={**deps,'key':key,'units':'mm','spacing_mm':mm['spacing_mm'],'assets':{},'cache_hit':False}
 if kind=='peaks':
  src=engine.CACHE/'postmerge'/params['residual_key']
  residual=np.load(src/'residual.npy',mmap_mode='r')
  xy=peak_candidates(residual,params['window']);xy+=np.array(prior['offset_xy'],np.int32)
  xy.astype('<i4').tofile(dest/'points.bin');np.save(dest/'points.npy',xy)
  result.update(count=len(xy),raw_artifact=str(dest/'points.npy'),combined_radius_px=prior['parameters']['window']//2+params['window']//2,plateau_policy='one per exact-equality 8-connected regional maximum plateau; eligible member nearest full-plateau centroid; ties row then column; must touch a lower finite neighbour; no area filtering')
  result['assets']['points']=f'/post-asset/{key}/points.bin'
 else:
  with np.load(engine.CACHE/'merges'/merge_key/'raw.npz',allow_pickle=False) as data:
   z=data['height_mm'];valid=data['valid_mask']&np.isfinite(z)
  if z.size>80_000_000:raise ValueError('Post-merge processing limited to 80 million cells')
  if kind=='stem':
   points,source_stats=source_cohort(mm,params['top'])
   fit,selected,segments=stem_fit(z,valid,params['top'],params['degree'],points=points,source_stats=source_stats)
   h,w=z.shape;size=(max(1,round(w*min(1,1800/max(w,h)))),max(1,round(h*min(1,1800/max(w,h)))))
   alpha=Image.fromarray(selected.astype(np.uint8)*200)
   im=Image.new('RGBA',(w,h),(255,0,136,0));im.putalpha(alpha);im.save(dest/'top.png')
   stroke=Image.new('L',(w,h));draw=ImageDraw.Draw(stroke)
   for seg in segments:
    xy=seg['xy'];distance=0.
    for a,b in zip(xy[:-1],xy[1:]):
     if not seg['extrapolated'] or int(distance//28)%2==0:draw.line([tuple(a),tuple(b)],fill=255,width=10)
     distance+=math.hypot(b[0]-a[0],b[1]-a[1])
   alpha=np.asarray(stroke).copy();alpha[~valid]=0
   im=Image.new('RGBA',(w,h),(255,255,255,0));im.putalpha(Image.fromarray(alpha));im.resize(size,Image.Resampling.LANCZOS).save(dest/'curve.png')
   rows,cols=np.nonzero(selected)
   from nearest_stem import curve_domain
   fit['intervals']=curve_domain(fit,np.concatenate([s['xy'] for s in segments]),[len(s['xy']) for s in segments])
   np.savez_compressed(dest/'native.npz',selected_xy=points,source_counts=np.array([s['selected_pixels'] for s in source_stats]),curve_xy=np.concatenate([s['xy'] for s in segments]),segment_lengths=np.array([len(s['xy']) for s in segments]),extrapolated=np.array([s['extrapolated'] for s in segments]),coefficients=fit['coefficients'])
   result.update(fit=fit,segments=len(segments),raw_artifact=str(dest/'native.npz'),offset_xy=[0,0],dimensions=[w,h])
   result['assets']={n:f'/post-asset/{key}/{n}.png' for n in ['curve','top']}
  else:
   ys=np.flatnonzero(valid.any(axis=1));xs=np.flatnonzero(valid.any(axis=0))
   if not len(ys):raise ValueError('No finite foreground')
   x0,x1=int(xs[0]),int(xs[-1])+1;y0,y1=int(ys[0]),int(ys[-1])+1
   z=z[y0:y1,x0:x1].copy();valid=valid[y0:y1,x0:x1].copy()
   # Bound histogram work independently of the raw-grid allocation guard.
   # This is a conservative workload limit, not an accuracy-changing shortcut.
   if int(valid.sum())*((1<<params['bits'])-1)>200_000_000_000:
    raise ValueError('Median histogram workload exceeds limit; reduce precision bits (12 recommended for full scans)')
   med,res,metadata=median_residual(z,valid,params['window'],params['bits'])
   if not np.isfinite(res).any():raise ValueError('No full median windows remain; reduce Median window')
   np.save(dest/'median.npy',med);np.save(dest/'residual.npy',res)
   result.update(quantization=metadata,offset_xy=[x0,y0],dimensions=list(z.shape[::-1]),raw_artifact=str(dest/'residual.npy'))
   for name,values in [('median',med),('residual',res)]:
    im,limits,count=merge.preview(values.astype(np.float32));im.save(dest/(name+'.png'))
    result[name+'_range_mm']=limits
    result['assets'][name]=f'/post-asset/{key}/{name}.png'
 result['seconds']=round(time.monotonic()-start,3)
 (dest/'meta.json').write_text(json.dumps(result));ARTIFACTS.add(key)
 return result
import math
from skimage.morphology import local_maxima

def peak_candidates(residual,window):
 odd(window)
 if window==1:return np.empty((0,2),np.int32)
 valid=np.isfinite(residual);ok=support(valid,window)
 if not ok.any():return np.empty((0,2),np.int32)
 work=np.where(valid,residual,-np.inf)
 regional=local_maxima(work,connectivity=2,allow_borders=True)&valid
 maxima=ndi.maximum_filter(work,size=window,mode='constant',cval=-np.inf)
 eligible=regional&ok&(work==maxima);del maxima
 # Reject constant foreground even if surrounded by no-data. A plateau needs
 # at least one strictly lower *finite* 8-neighbour, with no epsilon.
 low=ndi.minimum_filter(np.where(valid,residual,np.inf),size=3,mode='constant',cval=np.inf)
 lower=regional&(low<work);del low,work
 labels,count=ndi.label(regional,structure=np.ones((3,3),bool))
 objects=ndi.find_objects(labels);points=[]
 for i,sl in enumerate(objects,1):
  if sl is None:continue
  region=labels[sl]==i
  if not np.any(lower[sl]&region):continue
  yy,xx=np.nonzero(region);cy,cx=yy.mean(),xx.mean()
  y,x=np.nonzero(region&eligible[sl])
  if not len(y):continue
  # nonzero gives row/column order, argmin resolves equal distances stably.
  j=np.argmin((y-cy)**2+(x-cx)**2)
  points.append((int(x[j]+sl[1].start),int(y[j]+sl[0].start)))
 return np.asarray(points,np.int32).reshape(-1,2)

def select_source_points(z,mask,pose,grid,percent):
 """Inclusive raw-Z quantile per source; return unrounded merged-grid XY."""
 selected,selection=foreground_selection(z,mask,percent)
 rows,cols=np.nonzero(selected)
 if len(rows)>5_000_000:raise ValueError('Stem fit exceeds 5 million selected pixels; reduce Top %')
 a,t=merge.validate_pose(pose)
 points=(np.column_stack((cols,rows))@a.T+t-np.asarray(grid['origin_center_mm']))/np.asarray(grid['spacing_mm'])
 return points,selection

def source_cohort(meta,percent,validate_only=False):
 """Read the immutable sources/masks/poses of THIS merge, not UI fit settings."""
 batches=[];stats=[];total=0
 for source in meta['sources']:
  folder,scan,cal,files,height=engine.inspect_source(source['path'])
  md=engine.CACHE/'masks'/source['mask_key']
  maskmeta=json.loads((md/'meta.json').read_text());provenance=maskmeta['provenance']
  if str(height)!=source['height_file'] or engine.digest(height)!=source['height_sha256'] or engine.digest(md/'mask.png')!=source['mask_sha256']:
   raise ValueError('Merge source or prepared mask changed; prepare and Merge again')
  if engine.signature(provenance)!=source['mask_key'] or provenance['inputs']!={p.name:engine.digest(p) for p in files} or provenance['algorithm_sha256']!=engine.digest(engine.HERE/'masking.py'):
   raise ValueError('Prepared mask provenance changed; prepare and Merge again')
  if validate_only:continue
  z,spacing=merge.decode(height)
  with Image.open(md/'mask.png') as im:mask=np.asarray(im)>0
  if list(z.shape)!=source['shape'] or mask.shape!=z.shape:raise ValueError('Source/mask dimensions changed')
  points,stat=select_source_points(z,mask,source['pose'],meta,percent)
  total+=len(points)
  if total>5_000_000:raise ValueError('Stem fit exceeds 5 million selected pixels; reduce Top %')
  batches.append(points);stats.append({**source,**stat})
 if validate_only:return
 return np.concatenate(batches),stats

def stem_fit(z,valid,percent,degree,points=None,source_stats=None):
 if isinstance(degree,bool) or not isinstance(degree,int) or not 1<=degree<=8 or not math.isfinite(percent) or not 0<percent<=100:raise ValueError('Top % >0–100; degree integer 1–8')
 valid=np.asarray(valid,bool)&np.isfinite(z)
 if not valid.any():raise ValueError('No finite foreground')
 cutoff=None
 if points is None:
  selected,selection=foreground_selection(z,valid,percent);cutoff=selection['cutoff_mm']
  rows,cols=np.nonzero(selected);points=np.column_stack((cols,rows)).astype(float)
 else:
  points=np.asarray(points,float)
  selected=np.zeros(z.shape,bool)
  ij=np.floor(points+.5).astype(int)
  inside=(ij[:,0]>=0)&(ij[:,0]<z.shape[1])&(ij[:,1]>=0)&(ij[:,1]<z.shape[0])
  selected[ij[inside,1],ij[inside,0]]=True
  selected&=valid  # Display union only; regression keeps every source observation.
 if len(points)>5_000_000:raise ValueError('Stem fit exceeds 5 million selected pixels; reduce Top %')
 if len(points)<degree+1:raise ValueError('Insufficient selected pixels')
 center=points.mean(0);delta=points-center
 _,vectors=np.linalg.eigh(delta.T@delta/len(points));axis=vectors[:,-1]
 if axis[0]<0:axis=-axis
 s=delta@axis;mid=float((s.min()+s.max())/2);half=float((s.max()-s.min())/2)
 if half<=0:raise ValueError('No longitudinal support')
 coef,stats=np.polynomial.polynomial.polyfit((s-mid)/half,points,degree,full=True)
 if stats[1]!=degree+1 or not np.isfinite(coef).all():raise ValueError('Rank deficient fit')
 fit=dict(cutoff_mm=cutoff,selected_pixels=len(points),selected_percent=100*len(points)/(sum(s['valid_pixels'] for s in source_stats) if source_stats else int(valid.sum())),center=center.tolist(),axis=axis.tolist(),mid=mid,half=half,coefficients=coef.tolist(),degree=degree,top=percent,rank=int(stats[1]),population='per-source finite prepared foreground; equal observation weights; overlapping source observations retained' if source_stats else 'finite valid merged foreground; equal pixel weights',sources=source_stats or [],coordinate_system='unrounded merged-grid pixel centres; world = origin_center_mm + XY * spacing_mm')
 h,w=z.shape;corners=np.array([[0,0],[w-1,0],[0,h-1],[w-1,h-1]])
 limits=((corners-center)@axis-mid)/half
 ts=np.linspace(limits.min(),limits.max(),int(np.ceil((limits.max()-limits.min())*half*4))+1)
 xy=np.column_stack([np.polynomial.polynomial.polyval(ts,coef[:,k]) for k in range(2)])
 ij=np.rint(xy).astype(int);inside=(ij[:,0]>=0)&(ij[:,0]<w)&(ij[:,1]>=0)&(ij[:,1]<h)
 inside[inside]=valid[ij[inside,1],ij[inside,0]]
 # Keep every valid run, not only the centre interval. Missing-mask gaps split
 # strokes explicitly; extrapolation is independently dashed.
 kind=np.where(inside,np.where(abs(ts)<=1,1,2),0)
 edges=np.r_[0,np.flatnonzero(np.diff(kind))+1,len(kind)];segments=[]
 for a,b in zip(edges[:-1],edges[1:]):
  if kind[a] and b-a>=2:segments.append(dict(xy=xy[a:b].tolist(),extrapolated=bool(kind[a]==2)))
 if not segments:raise ValueError('Fitted curve has no valid masked interval')
 return fit,selected,segments
import numpy as np
from scipy import ndimage as ndi
from skimage.filters.rank import median as rank_median

def odd(value):
 if isinstance(value,bool) or not isinstance(value,int) or not 1<=value<=301 or value%2!=1:
  raise ValueError('Window must be an odd integer from 1 to 301 pixels')
 return value

def support(valid,window):
 return ndi.minimum_filter(valid,size=window,mode='constant',cval=0).astype(bool)

def median_residual(z,valid,window=101,bits=12):
 odd(window)
 if isinstance(bits,bool) or not isinstance(bits,int) or not 1<=bits<=16:raise ValueError('Bits must be an integer from 1 to 16')
 valid=np.asarray(valid,bool)&np.isfinite(z)
 if z.ndim!=2 or valid.shape!=z.shape or not valid.any():raise ValueError('No finite foreground')
 values=z[valid];low=float(values.min());high=float(values.max());del values
 levels=(1<<bits)-1
 out=np.full(z.shape,np.nan,np.float32);ok=support(valid,window)
 # Same truncation/reconstruction as Image Workshop histogram_median. Full
 # support makes its nearest-edge padding irrelevant to all retained values.
 # Tile with true halos, bounding each tile to foreground support; no zero-fill
 # enters a retained median. Quantization uses global finite foreground limits.
 radius=window//2
 for y in range(0,z.shape[0],256):
  stop=min(y+256,z.shape[0]);cols=np.flatnonzero(ok[y:stop].any(axis=0))
  if not len(cols):continue
  x0=max(0,int(cols[0])-radius);x1=min(z.shape[1],int(cols[-1])+radius+1)
  a=max(0,y-radius);b=min(z.shape[0],stop+radius)
  tile=z[a:b,x0:x1];mask=valid[a:b,x0:x1]
  if high==low:filtered=np.full(tile.shape,low,np.float32)
  else:
   q=np.zeros(tile.shape,np.uint16);q[mask]=np.clip((tile[mask]-low)/(high-low)*levels,0,levels).astype(np.uint16)
   with warnings.catch_warnings():
    warnings.filterwarnings('ignore',message='Bad rank filter performance')
    filtered=rank_median(q,footprint=np.ones((window,window),np.uint8),mask=mask)
   filtered=filtered.astype(np.float32)/levels*(high-low)+low
  target=out[y:stop,x0:x1];keep=ok[y:stop,x0:x1]
  target[keep]=filtered[y-a:stop-a][keep]
 residual=z.astype(np.float64)-out.astype(np.float64)
 return out,residual,dict(levels=levels,bits=bits,window=window,range_mm=[low,high],bin_width_mm=(high-low)/levels,valid_cells=int(ok.sum()),border='full square support; missing values excluded, not zero-filled')
