"""Display-only nearest points on the finite, mask-clipped polynomial stem.
No heights, segmentation, fit or detection arrays are changed.
"""
import json
import time
import numpy as np
from numpy.polynomial import Polynomial as P
import engine
import postmerge

CACHE = {}
# Distances within this numerical tolerance in native merged-grid pixels tie.
TIE_PX = 1e-7


def curve_domain(fit, xy, lengths):
    if 'intervals' in fit: return fit['intervals']
    # PCA projection defines t and remains linear under the coordinate fit.
    center, axis = np.array(fit['center']), np.array(fit['axis'])
    ts = ((xy-center) @ axis-fit['mid']) / fit['half']
    intervals = []
    offset = 0
    for n in lengths:
        intervals.append((float(ts[offset]), float(ts[offset+int(n)-1])))
        offset += int(n)
    return intervals


def nearest_points(coefficients, intervals, points):
    """Stationary squared-distance roots plus EVERY clipped interval endpoint.

    Normalize the complete finite t domain to [-1,1] before companion roots.
    Real roots are polished by Newton, checked against the stationary polynomial,
    and retained only within a displayed interval. Equal-distance choices use
    increasing/decreasing parameter: exactly the order of directed arclength,
    including across gaps, not Euclidean distance to the chosen endpoint.
    """
    c = np.asarray(coefficients, float)
    lo = min(a for a,b in intervals); hi = max(b for a,b in intervals)
    if not hi > lo: raise ValueError('Empty stem domain')
    mid, half = (hi+lo)/2, (hi-lo)/2
    transform = P([mid, half])
    x, y = P(c[:,0])(transform), P(c[:,1])(transform)
    dx, dy = x.deriv(), y.deriv()
    iv = np.array(intervals, float)
    iv = (iv-mid)/half
    ends = iv.ravel()
    base = x*dx+y*dy
    answers_a, answers_b, parameters_a, parameters_b = [], [], [], []
    for px, py in np.asarray(points, float).reshape(-1,2):
        f = base-px*dx-py*dy
        scale = max(float(np.max(np.abs(f.coef))), 1.)
        f = f/scale
        roots = f.roots()
        # A tiny imaginary component can arise at a repeated real root.
        roots = roots.real[np.abs(roots.imag) <= 1e-7*(1+np.abs(roots.real))]
        df = f.deriv()
        for _ in range(3):
            den = df(roots)
            safe = np.abs(den)>1e-14
            roots[safe] -= f(roots[safe])/den[safe]
        roots = roots[np.abs(f(roots)) < 1e-8]
        if len(roots):
            roots = roots[np.any((roots[:,None]>=iv[:,0]-1e-12)&(roots[:,None]<=iv[:,1]+1e-12),axis=1)]
        u = np.unique(np.r_[ends, roots])
        xx, yy = x(u), y(u)
        distances = np.hypot(xx-px, yy-py)
        tied = np.flatnonzero(distances <= distances.min()+TIE_PX)
        a, b = tied[0], tied[-1] # u is sorted, so arclength order is sorted too.
        answers_a.append([float(xx[a]),float(yy[a])])
        answers_b.append([float(xx[b]),float(yy[b])])
        parameters_a.append(float(mid+half*u[a]));parameters_b.append(float(mid+half*u[b]))
    return dict(targets_a=answers_a, targets_b=answers_b, parameters_a=parameters_a,parameters_b=parameters_b,
                ends=[[float(x(-1)),float(y(-1))],[float(x(1)),float(y(1))]],
                tie_tolerance_px=TIE_PX,
                method='normalized polynomial stationary roots plus clipped interval endpoints; numerical, not symbolic exact')


def request(body):
    sk, pk = body.get('stem_key'), body.get('peaks_key')
    if not isinstance(sk,str) or sk not in postmerge.ARTIFACTS:
        raise ValueError('Current registered stem required')
    if pk is not None and (not isinstance(pk,str) or pk not in postmerge.ARTIFACTS):
        raise ValueError('Current registered candidates required')
    root = engine.CACHE/'postmerge'
    sm = json.loads((root/sk/'meta.json').read_text())
    if sm['kind']!='stem': raise ValueError('Stem artifact required')
    if pk is not None:
        pm = json.loads((root/pk/'meta.json').read_text())
        if pm['kind']!='peaks' or pm['merge_key']!=sm['merge_key']:
            raise ValueError('Candidates must belong to the same merge')
    key = (sk,pk)
    if key in CACHE: return {**CACHE[key], 'cache_hit':True}
    start = time.monotonic()
    with np.load(root/sk/'native.npz',allow_pickle=False) as data:
        intervals = curve_domain(sm['fit'],data['curve_xy'],data['segment_lengths'])
    points = np.load(root/pk/'points.npy',allow_pickle=False) if pk else np.empty((0,2))
    result = nearest_points(sm['fit']['coefficients'],intervals,points)
    result.update(stem_key=sk,peaks_key=pk,merge_key=sm['merge_key'],
                  count=len(points),seconds=time.monotonic()-start,cache_hit=False)
    if len(CACHE)>=12: CACHE.pop(next(iter(CACHE)))
    CACHE[key]=result
    return result
