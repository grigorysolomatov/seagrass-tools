"""Normal first exits of prepared finite foreground; not anatomical validation."""
import json
import time
import numpy as np
from stem_arc import StemArc
from scipy.optimize import brentq
import engine
import postmerge
from nearest_stem import curve_domain


def first_exit(mask, point, direction, stop_at=np.inf):
    """Exact ray traversal of pixel cells centered at integer coordinates."""
    x, y = map(float, point)
    dx, dy = map(float, direction)
    ix, iy = int(np.floor(x+.5)), int(np.floor(y+.5))
    h, w = mask.shape
    if not (0 <= ix < w and 0 <= iy < h and mask[iy, ix]):
        return np.nan
    sx, sy = (1 if dx > 0 else -1), (1 if dy > 0 else -1)
    tx = (ix+sx*.5-x)/dx if abs(dx)>1e-14 else np.inf
    ty = (iy+sy*.5-y)/dy if abs(dy)>1e-14 else np.inf
    ax = 1/abs(dx) if abs(dx)>1e-14 else np.inf
    ay = 1/abs(dy) if abs(dy)>1e-14 else np.inf
    for _ in range(w+h+2):
        t = min(tx, ty)
        if t >= stop_at: return stop_at
        # At a corner cross both cell faces, not an arbitrary raster axis.
        hitx, hity = tx <= ty+1e-12, ty <= tx+1e-12
        if hitx: ix += sx; tx += ax
        if hity: iy += sy; ty += ay
        if not (0 <= ix < w and 0 <= iy < h and mask[iy, ix]):
            return max(0., t)
    raise ValueError('Ray traversal failed')


def border_support(mask,z,enabled=False,cutoff=0.):
    if type(enabled) is not bool or not np.isfinite(cutoff):raise ValueError('Invalid raw-height cutoff')
    support=np.asarray(mask,bool)&np.isfinite(z)
    return support&(z>=cutoff) if enabled else support


def controls(body):
    enabled=body.get('height_cutoff_enabled',False)
    if type(enabled) is not bool:raise ValueError('Height cutoff enabled must be boolean')
    cutoff=engine.number(body.get('height_cutoff_mm',0),-1e6,1e6,'Raw height cutoff mm')
    margin=engine.number(body.get('inward_margin_mm',0),0,100,'Inward margin mm')
    return dict(height_cutoff_enabled=enabled,height_cutoff_mm=cutoff,inward_margin_mm=margin)


def compute(mask, coefficients, intervals, spacing, origin, step=.05,inward_margin_mm=0):
    if not np.isfinite(step) or not .005 <= step <= 1:
        raise ValueError('Border step must be 0.005–1 mm')
    if not np.isfinite(inward_margin_mm) or inward_margin_mm<0:raise ValueError('Inward margin must be nonnegative')
    arc = StemArc(coefficients,intervals,spacing)
    x,y,dx,dy=arc.x,arc.y,arc.dx,arc.dy
    lo,hi,length=arc.lo,arc.hi,arc.length
    if length/step > 30000: raise ValueError('Too many cross-sections; increase step')
    s = np.r_[np.arange(0,length,step),length]
    ts = np.array([lo if v==0 else hi if v==length else brentq(lambda t:arc.at(t)-v,lo,hi,xtol=1e-12) for v in s])
    centers = np.column_stack((x(ts),y(ts)))
    tangent = np.column_stack((dx(ts),dy(ts)))
    norms = np.linalg.norm(tangent,axis=1)
    normal = np.column_stack((tangent[:,1],-tangent[:,0]))/np.maximum(norms[:,None],1e-30)
    left = np.full(len(s),np.nan); right=left.copy()
    domain = np.any([(ts>=a-1e-10)&(ts<=b+1e-10) for a,b in intervals],axis=0)
    for i in np.flatnonzero(domain & (norms>1e-10)):
        left[i] = first_exit(mask,centers[i],normal[i])
        right[i] = first_exit(mask,centers[i],-normal[i])
    left-=inward_margin_mm/spacing;right-=inward_margin_mm/spacing
    valid = np.isfinite(left)&np.isfinite(right)&(left>1e-9)&(right>1e-9)
    left[~valid]=np.nan;right[~valid]=np.nan
    # Split even a sub-sampling-interval gap; never join across clipped domains.
    groups=[]
    for a,b in sorted(intervals):
        if groups and a <= groups[-1][1]+1e-10: groups[-1][1]=max(groups[-1][1],b)
        else: groups.append([a,b])
    group_ids=np.full(len(ts),-1)
    for i,(a,b) in enumerate(groups): group_ids[(ts>=a-1e-10)&(ts<=b+1e-10)]=i
    breaks=np.r_[True,(group_ids[1:]!=group_ids[:-1]) | ~valid[1:] | ~valid[:-1]]
    # Conservative continuity check between sections, not just at sample centers.
    # Short polynomial chords (~half a grid pixel) expose sub-step mask gaps.
    for i in np.flatnonzero(~breaks):
        n=max(1,int(np.ceil((s[i]-s[i-1])/(spacing*.5))))
        tt=np.linspace(ts[i-1],ts[i],n+1)
        pp=np.column_stack((x(tt),y(tt)))
        if inward_margin_mm>0:
            tangent=np.column_stack((dx(tt),dy(tt)));norm=np.linalg.norm(tangent,axis=1)
            nn=np.column_stack((tangent[:,1],-tangent[:,0]))/np.maximum(norm[:,None],1e-30)
            margin=inward_margin_mm/spacing
            for point,normal_i,speed in zip(pp,nn,norm):
                widths=[first_exit(mask,point,sign*normal_i,stop_at=margin+1e-8) for sign in [1,-1]]
                if speed<=1e-10 or not np.isfinite(widths).all() or min(widths)<=margin+1e-9:
                    breaks[i]=True;break
            if breaks[i]:continue
        for a,b in zip(pp[:-1],pp[1:]):
            delta=b-a;distance=float(np.linalg.norm(delta))
            if distance<=1e-12:continue
            exit_distance=first_exit(mask,a,delta/distance,stop_at=distance)
            if not np.isfinite(exit_distance) or exit_distance<distance-1e-9:
                breaks[i]=True;break
    return dict(arclength_mm=s,parameter=ts,break_before=breaks,stem_world_mm=centers*spacing+origin,
                left_world_mm=(centers+normal*left[:,None])*spacing+origin,
                right_world_mm=(centers-normal*right[:,None])*spacing+origin,
                left_signed_mm=left*spacing,right_signed_mm=-right*spacing,valid=valid,
                domain_valid=domain,tangent_valid=norms>1e-10)


def request(body):
    sk=body.get('stem_key')
    if not isinstance(sk,str) or sk not in postmerge.ARTIFACTS: raise ValueError('Current registered stem required')
    root=engine.CACHE/'postmerge'
    sm=json.loads((root/sk/'meta.json').read_text())
    if sm['kind']!='stem': raise ValueError('Stem required')
    step=engine.number(body.get('step_mm',.05),.005,1,'Border step mm')
    options=controls(body)
    deps=dict(stem_key=sk,merge_key=sm['merge_key'],step_mm=step,**options,algorithm_sha256=engine.signature([engine.digest(engine.HERE/'leaf_borders.py'),engine.digest(engine.HERE/'stem_arc.py')]))
    key=engine.signature(deps);dest=engine.CACHE/'borders'/key
    if (dest/'meta.json').exists():return {**json.loads((dest/'meta.json').read_text()),'cache_hit':True}
    start=time.monotonic()
    mm=json.loads((engine.CACHE/'merges'/sm['merge_key']/'meta.json').read_text())
    with np.load(root/sk/'native.npz',allow_pickle=False) as data: intervals=curve_domain(sm['fit'],data['curve_xy'],data['segment_lengths'])
    with np.load(engine.CACHE/'merges'/sm['merge_key']/'raw.npz',allow_pickle=False) as data: mask=border_support(data['valid_mask'],data['height_mm'],options['height_cutoff_enabled'],options['height_cutoff_mm'])
    result=compute(mask,sm['fit']['coefficients'],intervals,mm['spacing_mm'][0],np.array(mm['origin_center_mm']),step,options['inward_margin_mm'])
    dest.mkdir(parents=True,exist_ok=True);np.savez_compressed(dest/'native.npz',**result)
    # JSON nulls preserve gaps. Base B reverses these arrays, swaps sides and signs.
    serial=lambda a: [v if np.isfinite(v).all() else None for v in a.tolist()]
    meta={**deps,'key':key,'cache_hit':False,'count':len(result['valid']),'valid_count':int(result['valid'].sum()),'length_mm':float(result['arclength_mm'][-1]),'break_before':result['break_before'].tolist(),'arclength_mm':result['arclength_mm'].tolist(),'left_signed_mm':serial(result['left_signed_mm']),'right_signed_mm':serial(result['right_signed_mm']),'left_world_mm':serial(result['left_world_mm']),'right_world_mm':serial(result['right_world_mm']),'seconds':time.monotonic()-start,'raw_artifact':str(dest/'native.npz'),'policy':'first pixel-cell exit of connected finite prepared foreground containing stem; left positive looking base to tip in y-down world; arclength includes gaps; missing sections not interpolated','boundary_tolerance_px':1}
    (dest/'meta.json').write_text(json.dumps(meta));return meta
