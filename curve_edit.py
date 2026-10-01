"""Exact finite-domain polynomial/Bernstein edits; no weighted refitting.

The binomial basis expansion gives a_k = C(n,k) Δ^k b_0;
its triangular inverse gives b_i = sum_{k<=i} C(i,k)/C(n,k) a_k.
All edited polynomials use explicit u in [0,1], never PCA inversion.
"""
import json
from math import comb
import numpy as np
from numpy.polynomial import Polynomial as P
from PIL import Image
import engine


def to_bezier(coefficients, domain):
    c=np.asarray(coefficients,float);lo,hi=map(float,domain);n=len(c)-1
    if not hi>lo: raise ValueError('Empty edit domain')
    a=np.column_stack([np.pad(P(c[:,k])(P([lo,hi-lo])).coef,(0,n+1-len(P(c[:,k])(P([lo,hi-lo])).coef))) for k in range(2)])
    return np.array([sum((comb(i,k)/comb(n,k))*a[k] for k in range(i+1)) for i in range(n+1)])


def from_bezier(handles):
    b=np.asarray(handles,float)
    if b.ndim!=2 or b.shape[1]!=2 or not 2<=len(b)<=9 or not np.isfinite(b).all() or np.max(np.abs(b))>1e7:
        raise ValueError('Expected 2–9 finite XY handles in native pixel coordinates')
    n=len(b)-1
    return np.array([comb(n,k)*sum((-1)**(k-j)*comb(k,j)*b[j] for j in range(k+1)) for k in range(n+1)])


def edited_geometry(handles, mask):
    c=from_bezier(handles);x,y=P(c[:,0]),P(c[:,1]);dx,dy=x.deriv(),y.deriv()
    speed2=dx*dx+dy*dy
    roots=speed2.deriv().roots();roots=roots.real[np.abs(roots.imag)<1e-9]
    critical=np.r_[0.,1.,roots[(roots>=0)&(roots<=1)]]
    if np.min(np.hypot(dx(critical),dy(critical)))<1e-8:raise ValueError('Curve has a singular tangent; move handles apart')
    # Convex-hull derivative bound guarantees <= 0.25 pixel sample spacing.
    max_speed=(len(handles)-1)*np.max(np.linalg.norm(np.diff(handles,axis=0),axis=1))
    n=int(np.ceil(max_speed*4))+1
    if n>1_000_000:raise ValueError('Control polygon too long')
    ts=np.linspace(0,1,max(n,3));xy=np.column_stack((x(ts),y(ts)))
    ij=np.floor(xy+.5).astype(int);h,w=mask.shape
    inside=(ij[:,0]>=0)&(ij[:,0]<w)&(ij[:,1]>=0)&(ij[:,1]<h)
    inside[inside]=mask[ij[inside,1],ij[inside,0]]
    edges=np.r_[0,np.flatnonzero(np.diff(inside))+1,len(inside)]
    runs=[(a,b) for a,b in zip(edges[:-1],edges[1:]) if inside[a] and b-a>=2]
    if not runs:raise ValueError('Edited curve has no usable foreground support')
    intervals=[[float(ts[a]),float(ts[b-1])] for a,b in runs]
    ends_t=[intervals[0][0],intervals[-1][1]]
    fit=dict(coefficients=c.tolist(),manual=True,handles=np.asarray(handles).tolist(),edit_domain=[0.,1.],intervals=intervals,clipped=not (inside[0] and inside[-1]))
    geometry=dict(ends=np.column_stack((x(ends_t),y(ends_t))).tolist(),tangents=np.column_stack((dx(ends_t),dy(ends_t))).tolist(),interval=ends_t)
    return fit,geometry,np.concatenate([xy[a:b] for a,b in runs]),np.array([b-a for a,b in runs])


def request(body):
    import postmerge
    from nearest_stem import curve_domain
    kind=body.get('kind');key=body.get('key');handles=body.get('handles')
    if kind=='slice':
        if not isinstance(key,str) or key not in engine.REGISTERED:raise ValueError('Registered automatic slice fit required')
        root=engine.CACHE/'results';source=json.loads((root/key/'result.json').read_text())
        # Validate actual source hashes and foreground before accepting edits.
        _,_,_,files,_=engine.inspect_source(source['path'])
        if source['provenance']['source']!={p.name:engine.digest(p) for p in files}:raise ValueError('Source changed; compute automatic stems again')
        md=engine.CACHE/'masks'/source['provenance']['mask_key']
        with Image.open(md/'mask.png') as im:mask=np.asarray(im)>0
    elif kind=='stem':
        if not isinstance(key,str) or key not in postmerge.ARTIFACTS:raise ValueError('Registered automatic merged stem required')
        root=engine.CACHE/'postmerge';source=json.loads((root/key/'meta.json').read_text())
        if source['kind']!='stem':raise ValueError('Stem required')
        mm=json.loads((engine.CACHE/'merges'/source['merge_key']/'meta.json').read_text())
        postmerge.source_cohort(mm,source['parameters']['top'],validate_only=True)
        with np.load(engine.CACHE/'merges'/source['merge_key']/'raw.npz',allow_pickle=False) as d:mask=d['valid_mask']&np.isfinite(d['height_mm'])
    else:raise ValueError('Curve kind must be slice or stem')
    if len(handles or [])!=len(source['fit']['coefficients']):raise ValueError('Keep the automatic polynomial degree')
    fit,geometry,xy,lengths=edited_geometry(handles,mask)
    deps=dict(automatic_key=source.get('automatic_key',key),handles=handles,algorithm_sha256=engine.digest(engine.HERE/'curve_edit.py'))
    new_key=engine.signature(deps);dest=root/new_key;dest.mkdir(parents=True,exist_ok=True)
    result={**source,'key':new_key,'automatic_key':deps['automatic_key'],'edit_provenance':deps,'fit':{**source['fit'],**fit},'geometry':geometry,'cache_hit':False}
    if kind=='slice':
        (dest/'result.json').write_text(json.dumps(result));engine.REGISTERED.add(new_key)
    else:
        with np.load(root/key/'native.npz',allow_pickle=False) as d:arrays={k:d[k] for k in d.files}
        arrays.update(coefficients=fit['coefficients'],curve_xy=xy,segment_lengths=lengths,extrapolated=np.zeros(len(lengths),bool))
        np.savez_compressed(dest/'native.npz',**arrays)
        result.update(segments=len(lengths),raw_artifact=str(dest/'native.npz'))
        (dest/'meta.json').write_text(json.dumps(result));postmerge.ARTIFACTS.add(new_key)
    return result
